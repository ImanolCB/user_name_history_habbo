const HABBO_BASE_URL = 'https://www.habbo.es/api/public/users';

async function requestJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'HabboNames/1.0' }
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Habbo respondió con HTTP ${response.status}`);
  return response.json();
}

async function findByName(name) {
  return requestJson(`${HABBO_BASE_URL}?name=${encodeURIComponent(name)}`);
}

async function findByUniqueId(uniqueId) {
  return requestJson(`${HABBO_BASE_URL}/${encodeURIComponent(uniqueId)}`);
}

module.exports = { findByName, findByUniqueId };
