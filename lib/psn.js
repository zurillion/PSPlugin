import { RateLimitedQueue } from './queue.js';

const GRAPHQL_URL = 'https://m.np.playstation.com/api/graphql/v1/op';
const TROPHY_TITLES_URL = 'https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles';

// Hash del persisted query "getPurchasedGameList" usato dall'app PS App.
// Sony lo ruota di tanto in tanto: se la chiamata torna PersistedQueryNotFound
// va aggiornato. Per recuperarlo: DevTools su store.playstation.com -> Library
// -> filtra per "graphql/v1/op" e copia sha256Hash dalla query string.
const PURCHASED_QUERY_HASH = '2c045408b29bf196a42a86adf6f6044ce6dca3ea210ac4397f6cc01b1d4e6b38';

const PURCHASED_PAGE_SIZE = 50;
const TROPHY_PAGE_SIZE = 100;
const MIN_DELAY_MS = 1500;

export async function fetchPurchasedGames(accessToken, onProgress) {
  const queue = new RateLimitedQueue({ minDelayMs: MIN_DELAY_MS });
  const all = [];
  let start = 0;
  let total = null;

  while (true) {
    const page = await queue.run(() => purchasedPage(accessToken, start));
    const root = page?.data?.purchasedTitlesRetrieve;
    const games = root?.games || [];
    if (total === null) total = root?.total ?? games.length;
    all.push(...games);
    onProgress?.({ fetched: all.length, total });
    if (games.length < PURCHASED_PAGE_SIZE || all.length >= total) break;
    start += PURCHASED_PAGE_SIZE;
  }

  return all;
}

async function purchasedPage(token, start) {
  const body = {
    operationName: 'getPurchasedGameList',
    variables: {
      isActive: true,
      platform: ['ps3', 'ps4', 'ps5'],
      size: PURCHASED_PAGE_SIZE,
      start,
      subscriptionService: 'NONE'
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: PURCHASED_QUERY_HASH
      }
    }
  };

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = new Error(`Libreria GraphQL ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  if (json.errors?.length) {
    const codes = json.errors.map((e) => e?.extensions?.code).filter(Boolean).join(',');
    if (codes.includes('PERSISTED_QUERY_NOT_FOUND')) {
      throw new Error(
        'Persisted query non riconosciuto da Sony. Aggiorna PURCHASED_QUERY_HASH in lib/psn.js (vedi commento nel file).'
      );
    }
    throw new Error(`Errori GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json;
}

export async function fetchTrophyTitles(accessToken, onProgress) {
  const queue = new RateLimitedQueue({ minDelayMs: MIN_DELAY_MS });
  const all = [];
  let offset = 0;
  let total = null;

  while (true) {
    const page = await queue.run(() => trophyTitlesPage(accessToken, offset, TROPHY_PAGE_SIZE));
    const titles = page?.trophyTitles || [];
    if (total === null) total = page?.totalItemCount ?? titles.length;
    all.push(...titles);
    onProgress?.({ fetched: all.length, total });
    if (titles.length < TROPHY_PAGE_SIZE || all.length >= total) break;
    offset += TROPHY_PAGE_SIZE;
  }

  return all;
}

async function trophyTitlesPage(token, offset, limit) {
  const url = `${TROPHY_TITLES_URL}?limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = new Error(`Trofei ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
