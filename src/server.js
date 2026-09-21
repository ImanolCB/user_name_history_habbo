const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { findBySourceName, listUsers, findById, renameUser, findHistory, saveUser, addSyncLog, listSyncLogs } = require('./db');
const { findByName, findByUniqueId } = require('./habbo');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || 'habbo-admin';
const adminTokens = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function now() { return new Date().toISOString(); }

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRows(csvText) {
  const records = parse(csvText.replace(/^\uFEFF/, ''), { skip_empty_lines: true, relax_column_count: true });
  if (!records.length) return [];
  const firstRow = records[0].map((value) => String(value).trim().toLowerCase());
  const nameIndex = firstRow.findIndex((value) => ['name', 'nombre', 'username', 'user'].includes(value));
  const startAt = nameIndex >= 0 ? 1 : 0;
  const firstDataRow = records.slice(startAt).find((row) => row.some((value) => String(value || '').trim() !== ''));
  const firstNonEmptyIndex = firstDataRow?.findIndex((value) => String(value || '').trim() !== '') ?? -1;
  const columnIndex = nameIndex >= 0 ? nameIndex : Math.max(firstNonEmptyIndex, 0);
  return records.slice(startAt).map((row) => cleanName(row[columnIndex])).filter(Boolean);
}

function saveCurrentUser(existing, result, status = 'found') {
  return saveUser({ sourceName: existing.source_name, uniqueId: result?.uniqueId || existing.unique_id, habboName: result?.name || existing.habbo_name, motto: result?.motto || existing.motto || '', status, lastCheckedAt: now() });
}

async function syncUser(user) {
  try {
    const result = user.unique_id ? await findByUniqueId(user.unique_id) : await findByName(user.source_name);
    if (!result) return user;
    const status = user.unique_id && user.status !== 'error' ? user.status : 'found';
    return saveCurrentUser(user, result, status);
  } catch (_error) {
    return user;
  }
}

async function refreshUser(sourceName) {
  const existing = findBySourceName.get(sourceName);
  try {
    const result = existing?.unique_id
      ? await findByUniqueId(existing.unique_id)
      : await findByName(sourceName);

    if (!result) {
      return saveUser({ sourceName, uniqueId: existing?.unique_id || null, habboName: existing?.habbo_name || null, motto: existing?.motto || null, status: 'not_found', lastCheckedAt: now() });
    }

    if (existing?.unique_id && result.name.trim().toLowerCase() !== sourceName.trim().toLowerCase()) {
      return saveCurrentUser(existing, result, 'not_found');
    }

    return saveUser({ sourceName, uniqueId: result.uniqueId, habboName: result.name, motto: result.motto || '', status: 'found', lastCheckedAt: now() });
  } catch (error) {
    return saveUser({ sourceName, uniqueId: existing?.unique_id || null, habboName: existing?.habbo_name || null, motto: existing?.motto || null, status: 'error', lastCheckedAt: now() });
  }
}

app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.get('/api/users', (request, response) => response.json(listUsers(request.query)));
app.get('/api/users/:id/history', (request, response) => {
  const user = findById.get(request.params.id);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  response.json({ user, history: user.unique_id ? findHistory.all(user.unique_id) : [] });
});

app.post('/api/import', upload.single('file'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Debes seleccionar un archivo CSV.' });
  let names;
  try {
    names = normalizeRows(request.file.buffer.toString('utf8'));
  } catch (_error) {
    return response.status(400).json({ error: 'No se pudo leer el CSV.' });
  }
  if (!names.length) return response.status(400).json({ error: 'El CSV no contiene nombres.' });

  const uniqueNames = [...new Set(names)];
  const results = [];
  for (const name of uniqueNames) {
    const existing = findBySourceName.get(name);
    results.push(existing || await refreshUser(name));
  }
  response.json({ imported: results.length, users: results });
});

app.post('/api/users', async (request, response) => {
  const sourceName = cleanName(request.body?.name);
  if (!sourceName) return response.status(400).json({ error: 'Escribe un nombre.' });
  if (findBySourceName.get(sourceName)) return response.status(409).json({ error: 'Ese nombre ya está registrado.' });
  response.status(201).json(await refreshUser(sourceName));
});

app.post('/api/refresh', async (_request, response) => {
  const users = listUsers({ page: 1, pageSize: 100000 }).users;
  const results = [];
  const updatedAt = now();
  for (const user of users) {
    const refreshed = await syncUser(user);
    results.push(refreshed);
    if (user.status !== 'error' && user.habbo_name && refreshed.habbo_name !== user.habbo_name) {
      addSyncLog(`Registro de ${user.source_name} actualizado.`, updatedAt);
    }
  }
  response.json({ refreshed: results.length, users: results });
});

app.post('/api/users/:id/refresh', async (request, response) => {
  const user = findById.get(request.params.id);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  const refreshed = await refreshUser(user.source_name);
  if (user.status !== 'error' && user.habbo_name && refreshed.habbo_name !== user.habbo_name) {
    addSyncLog(`Registro de ${user.source_name} actualizado.`);
  }
  response.json(refreshed);
});

app.patch('/api/users/:id', async (request, response) => {
  const user = findById.get(request.params.id);
  const sourceName = cleanName(request.body?.name);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  if (!sourceName) return response.status(400).json({ error: 'Escribe un nombre.' });
  const duplicate = findBySourceName.get(sourceName);
  if (duplicate && duplicate.id !== user.id) return response.status(409).json({ error: 'Ese nombre ya está registrado.' });
  renameUser.run(sourceName, user.id);
  response.json(await refreshUser(sourceName));
});

function requireAdmin(request, response, next) {
  if (!request.headers['x-admin-token'] || !adminTokens.has(request.headers['x-admin-token'])) return response.status(403).json({ error: 'Se requiere permiso de administrador.' });
  next();
}

app.post('/api/admin/unlock', (request, response) => {
  if (request.body?.password !== adminPassword) return response.status(401).json({ error: 'Contraseña incorrecta.' });
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  response.json({ token });
});
app.get('/api/admin/sync-logs', requireAdmin, (request, response) => response.json(listSyncLogs(request.query)));

app.listen(port, () => console.log(`HabboNames disponible en http://localhost:${port}`));
