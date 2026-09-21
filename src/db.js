const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const dataDirectory = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new Database(path.join(dataDirectory, 'habbo.sqlite'));
database.pragma('journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL,
    unique_id TEXT,
    habbo_name TEXT,
    motto TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_name)
  );

  CREATE TABLE IF NOT EXISTS name_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_id TEXT NOT NULL,
    habbo_name TEXT NOT NULL,
    motto TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(unique_id, habbo_name)
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const findBySourceName = database.prepare('SELECT * FROM users WHERE source_name = ?');
const findAll = database.prepare(`
  SELECT users.* FROM users
  WHERE (@status = '' OR users.status = @status)
    AND (@query = ''
     OR users.source_name LIKE @pattern COLLATE NOCASE
     OR users.habbo_name LIKE @pattern COLLATE NOCASE
     OR EXISTS (
       SELECT 1 FROM name_history
       WHERE name_history.unique_id = users.unique_id
         AND name_history.habbo_name LIKE @pattern COLLATE NOCASE
     ))
  ORDER BY users.source_name COLLATE NOCASE
  LIMIT @limit OFFSET @offset
`);
const countAll = database.prepare(`
  SELECT COUNT(*) AS total FROM users
  WHERE (@status = '' OR users.status = @status)
    AND (@query = ''
     OR users.source_name LIKE @pattern COLLATE NOCASE
     OR users.habbo_name LIKE @pattern COLLATE NOCASE
     OR EXISTS (
       SELECT 1 FROM name_history
       WHERE name_history.unique_id = users.unique_id
         AND name_history.habbo_name LIKE @pattern COLLATE NOCASE
     ))
`);
const findById = database.prepare('SELECT * FROM users WHERE id = ?');
const renameUser = database.prepare('UPDATE users SET source_name = ?, status = \'pending\', updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const findHistory = database.prepare('SELECT * FROM name_history WHERE unique_id = ? ORDER BY last_seen_at DESC, id DESC');
const insertSyncLog = database.prepare('INSERT INTO sync_log (message, created_at) VALUES (?, ?)');
const findSyncLogs = database.prepare('SELECT * FROM sync_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?');
const countSyncLogs = database.prepare('SELECT COUNT(*) AS total FROM sync_log');
const insertUser = database.prepare(`
  INSERT INTO users (source_name, unique_id, habbo_name, motto, status, last_checked_at)
  VALUES (@sourceName, @uniqueId, @habboName, @motto, @status, @lastCheckedAt)
`);
const updateUser = database.prepare(`
  UPDATE users
  SET unique_id = @uniqueId,
      habbo_name = @habboName,
      motto = @motto,
      status = @status,
      last_checked_at = @lastCheckedAt,
      updated_at = CURRENT_TIMESTAMP
  WHERE source_name = @sourceName
`);
const insertHistory = database.prepare(`
  INSERT INTO name_history (unique_id, habbo_name, motto)
  VALUES (@uniqueId, @habboName, @motto)
  ON CONFLICT(unique_id, habbo_name) DO UPDATE SET motto = excluded.motto, last_seen_at = CURRENT_TIMESTAMP
`);

function saveUser(user) {
  const existing = findBySourceName.get(user.sourceName);
  if (existing) {
    updateUser.run(user);
  } else {
    insertUser.run(user);
  }
  if (user.uniqueId && user.habboName) insertHistory.run(user);
  return findBySourceName.get(user.sourceName);
}

function listUsers({ query = '', status = '', page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100000, Math.max(1, Number(pageSize) || 25));
  const allowedStatuses = new Set(['found', 'not_found', 'error']);
  const safeStatus = allowedStatuses.has(status) ? status : '';
  const params = { query: query.trim(), status: safeStatus, pattern: `%${query.trim()}%`, limit: safePageSize, offset: (safePage - 1) * safePageSize };
  const total = countAll.get(params).total;
  return { users: findAll.all(params), total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}

function addSyncLog(message, createdAt = new Date().toISOString()) {
  insertSyncLog.run(message, createdAt);
}

function listSyncLogs({ page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const total = countSyncLogs.get().total;
  return { logs: findSyncLogs.all(safePageSize, (safePage - 1) * safePageSize), total, page: safePage, pageSize: safePageSize, totalPages: Math.max(1, Math.ceil(total / safePageSize)) };
}

module.exports = { database, findBySourceName, listUsers, findById, renameUser, findHistory, saveUser, addSyncLog, listSyncLogs };
