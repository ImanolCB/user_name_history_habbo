const fileInput = document.querySelector('#csv-file');
const importButton = document.querySelector('#import-button');
const refreshButton = document.querySelector('#refresh-button');
const addButton = document.querySelector('#add-button');
const adminButton = document.querySelector('#admin-button');
const searchInput = document.querySelector('#search-input');
const body = document.querySelector('#users-body');
const message = document.querySelector('#message');
const state = { page: 1, query: '', status: '', totalPages: 1, editingId: null, adminToken: null };
let isAdmin = false;
let busy = false;

state.adminToken = sessionStorage.getItem('habbo_admin_token');

function adminHeaders(extra = {}) {
  return state.adminToken ? { ...extra, 'x-admin-token': state.adminToken } : extra;
}

fileInput.addEventListener('change', () => {
  importButton.disabled = !fileInput.files.length;
  document.querySelector('#file-name').textContent = fileInput.files[0]?.name || 'Ningún archivo seleccionado';
});
importButton.addEventListener('click', submitImport);
refreshButton.addEventListener('click', submitRefresh);
addButton.addEventListener('click', () => openRecordDialog());
adminButton.addEventListener('click', () => isAdmin ? loadActivity() : document.querySelector('#admin-dialog').showModal());
document.querySelector('#suggestion-form').addEventListener('submit', submitSuggestion);
searchInput.addEventListener('input', debounce(() => { state.query = searchInput.value.trim(); state.page = 1; loadUsers(); }, 250));
document.querySelector('#status-filter').addEventListener('change', (event) => { state.status = event.target.value; state.page = 1; loadUsers(); });
document.querySelector('#previous-page').addEventListener('click', () => changePage(-1));
document.querySelector('#next-page').addEventListener('click', () => changePage(1));
document.querySelector('#record-form').addEventListener('submit', saveRecord);
document.querySelector('#admin-login-form').addEventListener('submit', unlockAdmin);
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
body.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'history') showHistory(button.dataset.id, button.dataset.name);
  if (button.dataset.action === 'refresh') refreshOne(button);
  if (button.dataset.action === 'edit') openRecordDialog(button.dataset.id, button.dataset.name);
  if (button.dataset.action === 'delete') deleteUser(button.dataset.id);
});
document.querySelector('#activity-body').addEventListener('click', (event) => {
  const button = event.target.closest('[data-log-message]');
  if (!button) return;
  document.querySelector('#update-detail').textContent = button.dataset.logMessage;
  document.querySelector('#update-dialog').showModal();
});
document.querySelector('#suggestions-body').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-suggestion]');
  if (!button) return;
  await fetch(`/api/admin/suggestions/${button.dataset.id}`, { method: 'PATCH', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ status: button.dataset.suggestion === 'accept' ? 'accepted' : 'rejected' }) });
  await loadActivity();
});
document.querySelector('#approve-all').addEventListener('click', () => processAllSuggestions('accepted'));
document.querySelector('#reject-all').addEventListener('click', () => processAllSuggestions('rejected'));

async function loadAuth() {
  const response = await fetch('/api/auth/me', { headers: adminHeaders() });
  const auth = await response.json();
  isAdmin = auth.admin;
  const adminSurface = location.pathname.startsWith('/admin/');
  applyAdminVisibility(adminSurface);
}

function applyAdminVisibility(adminSurface = location.pathname.startsWith('/admin/')) {
  [fileInput.closest('.upload-group'), importButton, refreshButton, addButton].forEach((element) => { element.hidden = !isAdmin; });
  adminButton.hidden = !adminSurface;
  adminButton.textContent = isAdmin ? 'Abrir dashboard' : 'Acceder';
  document.querySelector('#suggestion-section').hidden = isAdmin;
}

async function submitSuggestion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await fetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.value, note: form.note.value }) });
  const result = await response.json();
  document.querySelector('#suggestion-message').textContent = response.ok ? 'Sugerencia enviada para revisión.' : result.error;
  if (response.ok) form.reset();
}

async function loadUsers() {
  const params = new URLSearchParams({ page: state.page, pageSize: 25, query: state.query, status: state.status });
  const response = await fetch(`/api/users?${params}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudieron cargar los registros.');
  render(result);
}

async function submitImport() {
  setBusy(true, 'Consultando nombres nuevos en Habbo...');
  try {
    const data = new FormData();
    data.append('file', fileInput.files[0]);
    const response = await fetch('/api/import', { method: 'POST', headers: adminHeaders(), body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    state.page = 1;
    message.textContent = `OK: ${result.imported} registro(s) cargado(s).`;
    await loadUsers();
  } catch (error) { message.textContent = error.message; } finally { setBusy(false); }
}

async function submitRefresh() {
  setBusy(true, 'Sincronizando todos los registros por uniqueId...');
  try {
    const response = await fetch('/api/refresh', { method: 'POST', headers: adminHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message.textContent = `${result.refreshed} registro(s) actualizado(s).`;
    await loadUsers();
  } catch (error) { message.textContent = error.message; } finally { setBusy(false); }
}

async function refreshOne(button) {
  button.disabled = true;
  setBusy(true, 'Actualizando este registro...');
  try {
    const response = await fetch(`/api/users/${button.dataset.id}/refresh`, { method: 'POST', headers: adminHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message.textContent = `Registro de ${result.source_name} actualizado.`;
    await loadUsers();
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; setBusy(false); }
}

async function deleteUser(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  setBusy(true, 'Eliminando registro...');
  const response = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: adminHeaders() });
  if (!response.ok) { setBusy(false, 'No se pudo eliminar el registro.'); return; }
  await loadUsers();
  setBusy(false, 'Registro eliminado.');
}

function openRecordDialog(id = null, name = '') {
  state.editingId = id;
  document.querySelector('#record-title').textContent = id ? 'Editar registro' : 'Añadir registro';
  document.querySelector('#record-name').value = name;
  document.querySelector('#record-message').textContent = '';
  document.querySelector('#record-dialog').showModal();
}

async function saveRecord(event) {
  event.preventDefault();
  setBusy(true, 'Guardando y consultando registro...');
  const name = document.querySelector('#record-name').value;
  const endpoint = state.editingId ? `/api/users/${state.editingId}` : '/api/users';
  const response = await fetch(endpoint, { method: state.editingId ? 'PATCH' : 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ name }) });
  const result = await response.json();
  if (!response.ok) { document.querySelector('#record-message').textContent = result.error; setBusy(false); return; }
  document.querySelector('#record-dialog').close();
  message.textContent = `Registro de ${result.source_name} guardado.`;
  await loadUsers();
  setBusy(false, `Registro de ${result.source_name} guardado.`);
}

async function showHistory(id, name) {
  const response = await fetch(`/api/users/${id}/history`);
  const result = await response.json();
  document.querySelector('#history-title').textContent = name;
  document.querySelector('#history-list').innerHTML = result.history.length ? result.history.map((entry) => `<div class="history-entry"><strong>${escapeHtml(entry.habbo_name)}</strong><span>${escapeHtml(entry.motto || 'Sin misión')}</span><small>Visto desde ${new Date(entry.first_seen_at).toLocaleDateString('es-ES')}</small></div>`).join('') : '<p class="empty">Todavía no hay nombres históricos.</p>';
  document.querySelector('#history-dialog').showModal();
}

async function unlockAdmin(event) {
  event.preventDefault();
  const response = await fetch('/api/admin/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.querySelector('#admin-password').value }) });
  const result = await response.json();
  if (!response.ok) { document.querySelector('#admin-message').textContent = result.error; return; }
  state.adminToken = result.token;
  sessionStorage.setItem('habbo_admin_token', result.token);
  isAdmin = true;
  applyAdminVisibility(true);
  document.querySelector('#admin-dialog').close();
  document.querySelector('#admin-password').value = '';
  loadActivity();
}

async function loadActivity() {
  const response = await fetch('/api/admin/sync-logs', { headers: adminHeaders() });
  const result = await response.json();
  if (!response.ok) { message.textContent = result.error; return; }
  document.querySelector('#activity-body').innerHTML = result.logs.length ? result.logs.map((log) => `<tr><td>${new Date(log.created_at).toLocaleString('es-ES')}</td><td>${escapeHtml(log.message.replace(' actualizado.', ''))}</td><td><button class="link-button" data-log-message="${escapeHtml(log.message)}">Ver actualización</button></td></tr>`).join('') : '<tr><td colspan="3" class="empty">Todavía no hay actualizaciones.</td></tr>';
  const suggestionsResponse = await fetch('/api/admin/suggestions', { headers: adminHeaders() });
  const suggestions = await suggestionsResponse.json();
  document.querySelector('#suggestion-count').textContent = suggestions.length;
  document.querySelector('#suggestions-body').innerHTML = suggestions.length ? suggestions.map((suggestion) => `<tr><td>${new Date(suggestion.created_at).toLocaleString('es-ES')}</td><td><strong>${escapeHtml(suggestion.name)}</strong></td><td>${escapeHtml(suggestion.note || 'Sin nota')}</td><td><button class="row-action" data-suggestion="accept" data-id="${suggestion.id}">Aprobar</button><button class="link-button" data-suggestion="reject" data-id="${suggestion.id}">Rechazar</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No hay sugerencias pendientes.</td></tr>';
  document.querySelector('#activity-dialog').showModal();
}

async function processAllSuggestions(status) {
  const action = status === 'accepted' ? 'aprobar' : 'rechazar';
  if (!confirm(`¿Quieres ${action} todas las sugerencias pendientes?`)) return;
  const response = await fetch('/api/admin/suggestions/bulk', { method: 'PATCH', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ status }) });
  const result = await response.json();
  if (!response.ok) { message.textContent = result.error; return; }
  message.textContent = `${result.processed} sugerencia(s) procesada(s).`;
  await loadActivity();
}

function render(result) {
  const users = result.users || [];
  document.querySelector('#total-count').textContent = result.total ?? users.length;
  document.querySelector('#found-count').textContent = result.counts?.found ?? users.filter((user) => user.status === 'found').length;
  document.querySelector('#missing-count').textContent = result.counts?.not_found ?? users.filter((user) => user.status === 'not_found').length;
  state.totalPages = result.totalPages || 1;
  document.querySelector('#page-label').textContent = `Página ${result.page || 1} de ${state.totalPages}`;
  document.querySelector('#previous-page').disabled = state.page <= 1;
  document.querySelector('#next-page').disabled = state.page >= state.totalPages;
  body.innerHTML = users.length ? users.map((user) => `<tr><td>${escapeHtml(user.source_name)}</td><td><strong>${escapeHtml(user.habbo_name || '—')}</strong>${user.unique_id ? `<button class="link-button" data-action="history" data-id="${user.id}" data-name="${escapeHtml(user.habbo_name || user.source_name)}">Ver historial</button>` : ''}</td><td>${escapeHtml(user.motto || '—')}</td><td>${escapeHtml(user.unique_id || '—')}</td><td><span class="badge ${user.status}">${label(user.status)}</span></td><td>${user.last_checked_at ? new Date(user.last_checked_at).toLocaleString('es-ES') : '—'}</td><td>${isAdmin ? `<button class="row-action" data-action="refresh" data-id="${user.id}">Actualizar</button>${['error', 'not_found'].includes(user.status) ? `<button class="link-button" data-action="edit" data-id="${user.id}" data-name="${escapeHtml(user.source_name)}">Editar</button>` : ''}<button class="link-button" data-action="delete" data-id="${user.id}">Eliminar</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No hay registros para esta búsqueda.</td></tr>';
}

function changePage(delta) { state.page = Math.min(state.totalPages, Math.max(1, state.page + delta)); loadUsers(); }
function label(status) { return ({ found: 'Encontrado', not_found: 'No existe', error: 'Error', pending: 'Pendiente' })[status] || status; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
function setBusy(nextBusy, text = '') {
  busy = nextBusy;
  importButton.disabled = busy || !fileInput.files.length;
  refreshButton.disabled = busy;
  addButton.disabled = busy;
  document.querySelector('#loading-indicator').hidden = !busy;
  document.querySelector('#loading-text').textContent = text || 'Cargando...';
  if (text) message.textContent = text;
}
function debounce(callback, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => callback(...args), delay); }; }

loadAuth().then(loadUsers).catch(() => { message.textContent = 'No se pudo cargar la aplicación.'; });
