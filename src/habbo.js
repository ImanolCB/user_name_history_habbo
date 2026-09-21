const HABBO_BASE_URL = 'https://www.habbo.es/api/public/users';
const requestDelayMs = Math.max(250, Number(process.env.HABBO_REQUEST_DELAY_MS || 400));
let requestChain = Promise.resolve();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response) {
  const header = Number(response.headers.get('retry-after'));
  return Number.isFinite(header) && header > 0 ? header * 1000 : 2000;
}

async function requestJson(url) {
  let response;
  requestChain = requestChain.catch(() => undefined).then(async () => {
    await wait(requestDelayMs);
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'HabboNames/1.0 (respectful client)' }
    });
    if (response.status === 429) {
      await wait(Math.min(retryDelay(response), 15000));
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'HabboNames/1.0 (respectful client)' }
      });
    }
  });
  await requestChain;

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
