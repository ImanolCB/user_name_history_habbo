const fileInput = document.querySelector('#csv-file');
const importButton = document.querySelector('#import-button');
const refreshButton = document.querySelector('#refresh-button');
const addButton = document.querySelector('#add-button');
const adminButton = document.querySelector('#admin-button');
const searchInput = document.querySelector('#search-input');
const body = document.querySelector('#users-body');
const message = document.querySelector('#message');
const state = { page: 1, query: '', status: '', totalPages: 1, editingId: null, adminToken: null };

fileInput.addEventListener('change', () => { importButton.disabled = !fileInput.files.length; });
importButton.addEventListener('click', submitImport);
refreshButton.addEventListener('click', submitRefresh);
addButton.addEventListener('click', () => openRecordDialog());
adminButton.addEventListener('click', () => document.querySelector('#admin-dialog').showModal());
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
});
document.querySelector('#activity-body').addEventListener('click', (event) => {
  const button = event.target.closest('[data-log-message]');
  if (!button) return;
  document.querySelector('#update-detail').textContent = button.dataset.logMessage;
  document.querySelector('#update-dialog').showModal();
});

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
    const response = await fetch('/api/import', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    state.page = 1;
    message.textContent = `${result.imported} registro(s) importado(s).`;
    await loadUsers();
  } catch (error) { message.textContent = error.message; } finally { setBusy(false); }
}

async function submitRefresh() {
  setBusy(true, 'Sincronizando todos los registros por uniqueId...');
  try {
    const response = await fetch('/api/refresh', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message.textContent = `${result.refreshed} registro(s) actualizado(s).`;
    await loadUsers();
  } catch (error) { message.textContent = error.message; } finally { setBusy(false); }
}

async function refreshOne(button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/users/${button.dataset.id}/refresh`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message.textContent = `Registro de ${result.source_name} actualizado.`;
    await loadUsers();
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
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
  const name = document.querySelector('#record-name').value;
  const endpoint = state.editingId ? `/api/users/${state.editingId}` : '/api/users';
  const response = await fetch(endpoint, { method: state.editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const result = await response.json();
  if (!response.ok) { document.querySelector('#record-message').textContent = result.error; return; }
  document.querySelector('#record-dialog').close();
  message.textContent = `Registro de ${result.source_name} guardado.`;
  await loadUsers();
}

async function showHistory(id, name) {
  const response = await fetch(`/api/users/${id}/history`);
  const result = await response.json();
  document.querySelector('#history-title').textContent = name;
  document.querySelector('#history-list').innerHTML = result.history.length ? result.history.map((entry) => `<div class="history-entry"><strong>${escapeHtml(entry.habbo_name)}</strong><span>${escapeHtml(entry.motto || 'Sin motto')}</span><small>Visto desde ${new Date(entry.first_seen_at).toLocaleDateString('es-ES')}</small></div>`).join('') : '<p class="empty">Todavía no hay nombres históricos.</p>';
  document.querySelector('#history-dialog').showModal();
}

async function unlockAdmin(event) {
  event.preventDefault();
  const response = await fetch('/api/admin/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.querySelector('#admin-password').value }) });
  const result = await response.json();
  if (!response.ok) { document.querySelector('#admin-message').textContent = result.error; return; }
  state.adminToken = result.token;
  document.querySelector('#admin-dialog').close();
  document.querySelector('#admin-password').value = '';
  loadActivity();
}

async function loadActivity() {
  const response = await fetch('/api/admin/sync-logs', { headers: { 'x-admin-token': state.adminToken } });
  const result = await response.json();
  if (!response.ok) { message.textContent = result.error; return; }
  document.querySelector('#activity-body').innerHTML = result.logs.length ? result.logs.map((log) => `<tr><td>${new Date(log.created_at).toLocaleString('es-ES')}</td><td>${escapeHtml(log.message.replace(' actualizado.', ''))}</td><td><button class="link-button" data-log-message="${escapeHtml(log.message)}">Ver actualización</button></td></tr>`).join('') : '<tr><td colspan="3" class="empty">Todavía no hay actualizaciones.</td></tr>';
  document.querySelector('#activity-dialog').showModal();
}

function render(result) {
  const users = result.users || [];
  document.querySelector('#total-count').textContent = result.total ?? users.length;
  document.querySelector('#found-count').textContent = users.filter((user) => user.status === 'found').length;
  document.querySelector('#missing-count').textContent = users.filter((user) => user.status === 'not_found').length;
  state.totalPages = result.totalPages || 1;
  document.querySelector('#page-label').textContent = `Página ${result.page || 1} de ${state.totalPages}`;
  document.querySelector('#previous-page').disabled = state.page <= 1;
  document.querySelector('#next-page').disabled = state.page >= state.totalPages;
  body.innerHTML = users.length ? users.map((user) => `<tr><td>${escapeHtml(user.source_name)}</td><td><strong>${escapeHtml(user.habbo_name || '—')}</strong>${user.unique_id ? `<button class="link-button" data-action="history" data-id="${user.id}" data-name="${escapeHtml(user.habbo_name || user.source_name)}">Ver historial</button>` : ''}</td><td>${escapeHtml(user.motto || '—')}</td><td>${escapeHtml(user.unique_id || '—')}</td><td><span class="badge ${user.status}">${label(user.status)}</span></td><td>${user.last_checked_at ? new Date(user.last_checked_at).toLocaleString('es-ES') : '—'}</td><td><button class="row-action" data-action="refresh" data-id="${user.id}">Actualizar</button>${user.status === 'error' ? `<button class="link-button" data-action="edit" data-id="${user.id}" data-name="${escapeHtml(user.source_name)}">Editar</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No hay registros para esta búsqueda.</td></tr>';
}

function changePage(delta) { state.page = Math.min(state.totalPages, Math.max(1, state.page + delta)); loadUsers(); }
function label(status) { return ({ found: 'Encontrado', not_found: 'No existe', error: 'Error', pending: 'Pendiente' })[status] || status; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
function setBusy(busy, text = '') { importButton.disabled = busy || !fileInput.files.length; refreshButton.disabled = busy; addButton.disabled = busy; message.textContent = text; }
function debounce(callback, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => callback(...args), delay); }; }

loadUsers().catch(() => { message.textContent = 'No se pudo cargar la base local.'; });
