const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@libsql/client');

const dataDirectory = path.join(__dirname, '..', 'data');
const tursoUrl = process.env.TURSO_DATABASE_URL_ADMIN || process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN_ADMIN || process.env.TURSO_AUTH_TOKEN;
const useTurso = Boolean(tursoUrl && tursoToken);

if (!useTurso) fs.mkdirSync(dataDirectory, { recursive: true });

const client = createClient({
  url: tursoUrl || `file:${path.join(dataDirectory, 'habbo.sqlite')}`,
  authToken: tursoToken
});

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL UNIQUE,
    unique_id TEXT,
    habbo_name TEXT,
    motto TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS name_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_id TEXT NOT NULL,
    habbo_name TEXT NOT NULL,
    motto TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(unique_id, habbo_name)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  )`
];

const ready = schema.reduce((promise, sql) => promise.then(() => client.execute(sql)), Promise.resolve())
  .then(() => client.execute("ALTER TABLE suggestions ADD COLUMN availability TEXT NOT NULL DEFAULT 'pending'" ).catch(() => undefined))
  .then(() => client.execute('ALTER TABLE suggestions ADD COLUMN checked_at TEXT').catch(() => undefined));

async function one(sql, args = []) {
  await ready;
  const result = await client.execute({ sql, args });
  return result.rows[0] || null;
}

async function many(sql, args = []) {
  await ready;
  const result = await client.execute({ sql, args });
  return result.rows;
}

async function run(sql, args = []) {
  await ready;
  return client.execute({ sql, args });
}

async function findBySourceName(sourceName) {
  return one('SELECT * FROM users WHERE source_name = ?', [sourceName]);
}

async function findByComparableName(sourceName) {
  const comparable = String(sourceName || '').replace(/\s/g, '').toLowerCase();
  return one("SELECT * FROM users WHERE lower(replace(source_name, ' ', '')) = ? ORDER BY CASE status WHEN 'found' THEN 0 WHEN 'not_found' THEN 1 ELSE 2 END, id LIMIT 1", [comparable]);
}

async function findById(id) {
  return one('SELECT * FROM users WHERE id = ?', [id]);
}

async function listUsers({ query = '', status = '', page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100000, Math.max(1, Number(pageSize) || 25));
  const safeStatus = ['found', 'not_found', 'error', 'pending'].includes(status) ? status : '';
  const text = query.trim();
  const filter = `%${text}%`;
  const textWhere = `(? = '' OR users.source_name LIKE ? COLLATE NOCASE OR users.habbo_name LIKE ? COLLATE NOCASE
      OR EXISTS (SELECT 1 FROM name_history WHERE name_history.unique_id = users.unique_id AND name_history.habbo_name LIKE ? COLLATE NOCASE))`;
  const where = `WHERE (? = '' OR users.status = ?) AND ${textWhere}`;
  const args = [safeStatus, safeStatus, text, filter, filter, filter];
  const totalRow = await one(`SELECT COUNT(*) AS total FROM users ${where}`, args);
  const users = await many(`SELECT users.* FROM users ${where} ORDER BY users.source_name COLLATE NOCASE LIMIT ? OFFSET ?`, [...args, safePageSize, (safePage - 1) * safePageSize]);
  const countRows = await many(`SELECT users.status, COUNT(*) AS total FROM users WHERE ${textWhere} GROUP BY users.status`, [text, filter, filter, filter]);
  const counts = Object.fromEntries(countRows.map((row) => [row.status, Number(row.total)]));
  const total = Number(totalRow.total);
  return { users, total, counts: { found: counts.found || 0, not_found: counts.not_found || 0, error: counts.error || 0, pending: counts.pending || 0 }, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}

async function saveUser(user) {
  await run(`INSERT INTO users (source_name, unique_id, habbo_name, motto, status, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_name) DO UPDATE SET unique_id = excluded.unique_id, habbo_name = excluded.habbo_name,
      motto = excluded.motto, status = excluded.status, last_checked_at = excluded.last_checked_at, updated_at = CURRENT_TIMESTAMP`,
  [user.sourceName, user.uniqueId, user.habboName, user.motto, user.status, user.lastCheckedAt]);
  if (user.uniqueId && user.habboName) {
    await run(`INSERT INTO name_history (unique_id, habbo_name, motto) VALUES (?, ?, ?)
      ON CONFLICT(unique_id, habbo_name) DO UPDATE SET motto = excluded.motto, last_seen_at = CURRENT_TIMESTAMP`,
    [user.uniqueId, user.habboName, user.motto || '']);
  }
  return findBySourceName(user.sourceName);
}

async function renameUser(id, sourceName) {
  return run("UPDATE users SET source_name = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceName, id]);
}

async function findHistory(uniqueId) {
  return many('SELECT * FROM name_history WHERE unique_id = ? ORDER BY last_seen_at DESC, id DESC', [uniqueId]);
}

async function addActivity(message, createdAt = new Date().toISOString()) {
  return run('INSERT INTO admin_activity (message, created_at) VALUES (?, ?)', [message, createdAt]);
}

async function listActivity({ page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const totalRow = await one('SELECT COUNT(*) AS total FROM admin_activity');
  const logs = await many('SELECT * FROM admin_activity ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [safePageSize, (safePage - 1) * safePageSize]);
  const total = Number(totalRow.total);
  return { logs, total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}

async function createSuggestion(name, note = '') {
  const result = await run('INSERT INTO suggestions (name, note) VALUES (?, ?)', [name, note]);
  return one('SELECT * FROM suggestions WHERE id = ?', [result.lastInsertRowid]);
}

async function listSuggestions(status = 'pending') {
  return many('SELECT * FROM suggestions WHERE status = ? ORDER BY created_at ASC, id ASC', [status]);
}

async function updateSuggestion(id, status) {
  await run('UPDATE suggestions SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
  return one('SELECT * FROM suggestions WHERE id = ?', [id]);
}

async function updateSuggestionAvailability(id, availability) {
  await run('UPDATE suggestions SET availability = ?, checked_at = CURRENT_TIMESTAMP WHERE id = ?', [availability, id]);
  return one('SELECT * FROM suggestions WHERE id = ?', [id]);
}

async function deleteUser(id) {
  return run('DELETE FROM users WHERE id = ?', [id]);
}

async function deletePendingUsers() {
  return run("DELETE FROM users WHERE status = 'pending'");
}

module.exports = { client, useTurso, ready, findBySourceName, findByComparableName, findById, listUsers, saveUser, renameUser, findHistory, addActivity, listActivity, createSuggestion, listSuggestions, updateSuggestion, updateSuggestionAvailability, deleteUser, deletePendingUsers };
