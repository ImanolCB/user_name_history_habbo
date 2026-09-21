require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { useTurso, ready, findBySourceName, findByComparableName, listUsers, findById, renameUser, findHistory, saveUser, addActivity, listActivity, createSuggestion, listSuggestions, updateSuggestion, updateSuggestionAvailability, deleteUser } = require('./db');
const { findByName, findByUniqueId } = require('./habbo');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || (useTurso ? null : 'habbo-admin');
const adminPathSecret = process.env.ADMIN_PATH_SECRET || (useTurso ? null : 'local-admin-path');
const sessionLifetimeSeconds = 60 * 60 * 8;
const suggestionCheckTtlMs = Math.max(60000, Number(process.env.SUGGESTION_CHECK_TTL_MS || 900000));

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', adminPassword).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySession(token) {
  if (!adminPassword || !token) return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const expected = crypto.createHmac('sha256', adminPassword).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch (_error) {
    return false;
  }
}

function isAdminPath(value) {
  if (!adminPathSecret || !value || value.length !== adminPathSecret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(adminPathSecret));
}

app.get('/admin/:adminPath', (request, response) => {
  if (!isAdminPath(request.params.adminPath)) return response.status(404).send('Not found');
  response.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

function now() { return new Date().toISOString(); }

function isAdmin(request) {
  return verifySession(request.headers['x-admin-token']);
}

function requireAdmin(request, response, next) {
  if (!isAdmin(request)) return response.status(403).json({ error: 'Se requiere permiso de administrador.' });
  next();
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function comparableName(value) {
  return cleanName(value).replace(/\s/g, '').toLowerCase();
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
    const result = user.unique_id ? await findByUniqueId(user.unique_id) : await findByName(comparableName(user.source_name));
    if (!result) return user;
    const status = user.unique_id && user.status !== 'error' ? user.status : 'found';
    return saveCurrentUser(user, result, status);
  } catch (_error) {
    return user;
  }
}

async function refreshUser(sourceName) {
  const existing = await findByComparableName(sourceName);
  try {
    const result = existing?.unique_id
      ? await findByUniqueId(existing.unique_id)
      : await findByName(sourceName);

    if (!result) {
      return saveUser({ sourceName, uniqueId: existing?.unique_id || null, habboName: existing?.habbo_name || null, motto: existing?.motto || null, status: 'not_found', lastCheckedAt: now() });
    }

    if (existing?.unique_id && comparableName(result.name) !== comparableName(sourceName)) {
      return saveCurrentUser(existing, result, 'not_found');
    }

    return saveUser({ sourceName, uniqueId: result.uniqueId, habboName: result.name, motto: result.motto || '', status: 'found', lastCheckedAt: now() });
  } catch (error) {
    return saveUser({ sourceName, uniqueId: existing?.unique_id || null, habboName: existing?.habbo_name || null, motto: existing?.motto || null, status: 'error', lastCheckedAt: now() });
  }
}

app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.get('/api/auth/me', (request, response) => response.json({ admin: Boolean(isAdmin(request)), turso: useTurso }));
app.get('/api/users', async (request, response) => {
  response.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  response.json(await listUsers(request.query));
});
app.get('/api/users/:id/history', async (request, response) => {
  const user = await findById(request.params.id);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  response.json({ user, history: user.unique_id ? await findHistory(user.unique_id) : [] });
});

app.post('/api/import', requireAdmin, upload.single('file'), async (request, response) => {
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
    const existing = await findBySourceName(name);
    results.push(existing || await saveUser({ sourceName: name, uniqueId: null, habboName: null, motto: '', status: 'pending', lastCheckedAt: null }));
  }
  response.json({ imported: results.length, users: results });
});

app.post('/api/users', requireAdmin, async (request, response) => {
  const sourceName = cleanName(request.body?.name);
  if (!sourceName) return response.status(400).json({ error: 'Escribe un nombre.' });
  if (await findBySourceName(sourceName)) return response.status(409).json({ error: 'Ese nombre ya está registrado.' });
    if (await findByComparableName(sourceName)) return response.status(409).json({ error: 'Ese nombre ya está registrado.' });
    const existing = await findByComparableName(name);
  response.status(201).json(await refreshUser(sourceName));
});

app.post('/api/refresh', requireAdmin, async (_request, response) => {
  const users = (await listUsers({ page: 1, pageSize: 100000 })).users;
  const results = [];
  const updatedAt = now();
  for (const user of users) {
    const refreshed = await syncUser(user);
    results.push(refreshed);
    if (user.status !== 'error' && user.habbo_name && refreshed.habbo_name !== user.habbo_name) {
      await addActivity(`Registro de ${user.source_name} actualizado.`, updatedAt);
    }
  }
  response.json({ refreshed: results.length, users: results });
});

app.post('/api/users/:id/refresh', requireAdmin, async (request, response) => {
  const user = await findById(request.params.id);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  const refreshed = await refreshUser(user.source_name);
  if (user.status !== 'error' && user.habbo_name && refreshed.habbo_name !== user.habbo_name) {
    await addActivity(`Registro de ${user.source_name} actualizado.`);
  }
  response.json(refreshed);
});

app.patch('/api/users/:id', requireAdmin, async (request, response) => {
  const user = await findById(request.params.id);
  const sourceName = cleanName(request.body?.name);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  if (!sourceName) return response.status(400).json({ error: 'Escribe un nombre.' });
  const duplicate = await findBySourceName(sourceName);
  if (duplicate && duplicate.id !== user.id) {
    if (user.status === 'not_found') {
      await deleteUser(user.id);
      return response.json(duplicate);
    }
    return response.status(409).json({ error: 'Ese nombre ya está registrado.' });
  }
  await renameUser(user.id, sourceName);
  response.json(await refreshUser(sourceName));
});

app.delete('/api/users/:id', requireAdmin, async (request, response) => {
  const user = await findById(request.params.id);
  if (!user) return response.status(404).json({ error: 'Registro no encontrado.' });
  await deleteUser(user.id);
  response.status(204).end();
});

app.post('/api/suggestions', async (request, response) => {
  const name = cleanName(request.body?.name);
  const note = cleanName(request.body?.note);
  if (!name) return response.status(400).json({ error: 'Escribe un nombre.' });
  response.status(201).json(await createSuggestion(name, note));
});

app.post('/api/admin/unlock', (request, response) => {
  if (!adminPassword) return response.status(503).json({ error: 'ADMIN_PASSWORD no está configurada.' });
  if (request.body?.password !== adminPassword) return response.status(401).json({ error: 'Contraseña incorrecta.' });
  const token = signSession({ exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds });
  response.json({ token });
});
app.post('/api/admin/logout', requireAdmin, (request, response) => {
  response.status(204).end();
});
app.get('/api/admin/sync-logs', requireAdmin, async (request, response) => response.json(await listActivity(request.query)));
app.get('/api/admin/suggestions', requireAdmin, async (_request, response) => response.json(await listSuggestions('pending')));
app.post('/api/admin/suggestions/check', requireAdmin, async (_request, response) => {
  const suggestions = await listSuggestions('pending');
  const results = [];
  for (const suggestion of suggestions) {
    if (suggestion.checked_at && Date.now() - new Date(suggestion.checked_at).getTime() < suggestionCheckTtlMs) {
      results.push(suggestion);
      continue;
    }
    try {
      const result = await findByName(suggestion.name);
      results.push(await updateSuggestionAvailability(suggestion.id, result ? 'found' : 'not_found'));
    } catch (_error) {
      results.push(await updateSuggestionAvailability(suggestion.id, 'error'));
    }
  }
  response.json({ checked: results.length, suggestions: results });
});
app.patch('/api/admin/suggestions/bulk', requireAdmin, async (request, response) => {
  const status = request.body?.status;
  if (!['accepted', 'rejected'].includes(status)) return response.status(400).json({ error: 'Estado de sugerencia no válido.' });
  const suggestions = await listSuggestions('pending');
  for (const suggestion of suggestions) {
    await updateSuggestion(suggestion.id, status);
    if (status === 'accepted') await refreshUser(suggestion.name);
  }
  response.json({ processed: suggestions.length, status });
});
app.patch('/api/admin/suggestions/:id', requireAdmin, async (request, response) => {
  const status = request.body?.status;
  if (!['accepted', 'rejected'].includes(status)) return response.status(400).json({ error: 'Estado de sugerencia no válido.' });
  const suggestion = await updateSuggestion(request.params.id, status);
  if (!suggestion) return response.status(404).json({ error: 'Sugerencia no encontrada.' });
  if (status === 'accepted') await refreshUser(suggestion.name);
  response.json(suggestion);
});

function startServer() {
  app.listen(port, () => console.log(`HabboNames disponible en http://localhost:${port}${useTurso ? ' (Turso)' : ''}`));
}

if (require.main === module) ready.then(startServer);

module.exports = app;
