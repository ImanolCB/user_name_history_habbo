require('dotenv').config();

const path = require('node:path');
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');

const tursoUrl = process.env.TURSO_DATABASE_URL_ADMIN || process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN_ADMIN || process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoToken) {
  throw new Error('Define TURSO_DATABASE_URL_ADMIN y TURSO_AUTH_TOKEN_ADMIN antes de migrar.');
}

const source = new Database(path.join(__dirname, '..', 'data', 'habbo.sqlite'), { readonly: true });
const target = createClient({ url: tursoUrl, authToken: tursoToken });

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT NOT NULL UNIQUE, unique_id TEXT, habbo_name TEXT, motto TEXT, status TEXT NOT NULL DEFAULT 'pending', last_checked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS name_history (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_id TEXT NOT NULL, habbo_name TEXT NOT NULL, motto TEXT, first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(unique_id, habbo_name))`,
  `CREATE TABLE IF NOT EXISTS admin_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT)`
];

async function migrateTable(table, columns, insertSql) {
  const rows = source.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
  for (const row of rows) await target.execute({ sql: insertSql, args: columns.map((column) => row[column]) });
  return rows.length;
}

(async () => {
  for (const sql of schema) await target.execute(sql);
  const counts = {};
  counts.users = await migrateTable('users', ['id', 'source_name', 'unique_id', 'habbo_name', 'motto', 'status', 'last_checked_at', 'created_at', 'updated_at'], 'INSERT OR REPLACE INTO users (id, source_name, unique_id, habbo_name, motto, status, last_checked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  counts.name_history = await migrateTable('name_history', ['id', 'unique_id', 'habbo_name', 'motto', 'first_seen_at', 'last_seen_at'], 'INSERT OR REPLACE INTO name_history (id, unique_id, habbo_name, motto, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)');
  if (source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_log'").get()) {
    counts.activity = await migrateTable('sync_log', ['id', 'message', 'created_at'], 'INSERT OR REPLACE INTO admin_activity (id, message, created_at) VALUES (?, ?, ?)');
  }
  console.log(JSON.stringify(counts));
  source.close();
})();