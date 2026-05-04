// Flusso OAuth standard di psn-api:
// 1. lettura del cookie npsso (gia' presente dopo il login dell'utente)
// 2. ri-set esplicito del cookie su .account.sony.com con SameSite=None,
//    altrimenti il fetch dal service worker (richiesta cross-site) non lo
//    include
// 3. GET /authorize -> Sony risponde 302 con Location: com.scee.psxstore://...
// 4. l'header Location viene letto via chrome.webRequest.onHeadersReceived
//    (in MV3 fetch non puo' leggere headers di un redirect manuale; e
//    onBeforeRedirect non scatta in modo affidabile con redirect:'manual')
// 5. POST /token per scambiare il code con un access_token JWT

const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_SECRET = 'UcPN42zz9iRcddvEJ8mt2rD2iOuC79pkGSOjjTHh3Xw=';
const REDIRECT_URI = 'com.scee.psxstore://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

const AUTHORIZE_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize';
const TOKEN_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/token';

const SONY_URL_FILTERS = ['*://*.account.sony.com/*', '*://*.playstation.com/*'];

export async function getAccessToken() {
  const npsso = await readNpsso();
  if (!npsso) {
    throw new Error(
      'Cookie npsso non trovato. Vai su https://www.playstation.com, fai login, poi riprova.'
    );
  }

  await ensureCookieOnTarget(npsso);

  const code = await getAuthCode();
  return await exchangeCodeForToken(code);
}

async function readNpsso() {
  const cookies = await chrome.cookies.getAll({ name: 'npsso' });
  console.log(
    '[PSN auth] npsso cookies trovati:',
    cookies.map((c) => ({ domain: c.domain, sameSite: c.sameSite, secure: c.secure }))
  );
  if (!cookies.length) return null;
  const preferred =
    cookies.find((c) => c.domain.includes('account.sony.com')) || cookies[0];
  return preferred.value;
}

async function ensureCookieOnTarget(value) {
  const oneYear = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const result = await chrome.cookies.set({
    url: 'https://ca.account.sony.com/',
    name: 'npsso',
    value,
    domain: '.account.sony.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
    expirationDate: oneYear
  });
  console.log('[PSN auth] cookies.set result:', result ? 'OK' : 'FALLITO');
  if (!result) {
    throw new Error(
      'Impossibile scrivere il cookie npsso su .account.sony.com. Verifica i permessi dell\'estensione.'
    );
  }
}

function getAuthCode() {
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: REDIRECT_URI
  });

  return new Promise((resolve, reject) => {
    let captured = null;
    let lastStatus = null;
    let lastLocation = null;
    let lastSentCookieHeader = null;
    let headersFired = 0;
    let completedFired = 0;
    let errorFired = null;

    const onSent = (details) => {
      const cookie = details.requestHeaders?.find(
        (h) => h.name.toLowerCase() === 'cookie'
      );
      lastSentCookieHeader = cookie?.value || '(nessuno)';
      const npssoSent = /(?:^|;\s*)npsso=/.test(lastSentCookieHeader);
      console.log(
        '[PSN auth] onSendHeaders url=' + details.url,
        'npsso_inviato=' + npssoSent,
        'cookie=' + (lastSentCookieHeader || '').slice(0, 300)
      );
    };

    const onHeaders = (details) => {
      headersFired++;
      lastStatus = details.statusCode;
      const headers = details.responseHeaders || [];
      const loc = headers.find((h) => h.name.toLowerCase() === 'location');
      if (loc) {
        lastLocation = loc.value;
        console.log(
          '[PSN auth] onHeadersReceived status=' + details.statusCode,
          'url=' + details.url,
          'Location=' + loc.value.slice(0, 200)
        );
        if (loc.value.startsWith('com.scee.psxstore://')) {
          try {
            const code = new URL(loc.value).searchParams.get('code');
            if (code) captured = code;
          } catch {
            // ignora redirect malformato
          }
        }
      } else {
        console.log(
          '[PSN auth] onHeadersReceived status=' + details.statusCode,
          'url=' + details.url,
          '(nessun Location header)'
        );
      }
    };

    const onCompleted = (details) => {
      completedFired++;
      console.log(
        '[PSN auth] onCompleted status=' + details.statusCode,
        'url=' + details.url
      );
    };

    const onError = (details) => {
      errorFired = details.error;
      console.log('[PSN auth] onErrorOccurred', details.error, 'url=' + details.url);
    };

    chrome.webRequest.onSendHeaders.addListener(
      onSent,
      { urls: SONY_URL_FILTERS },
      ['requestHeaders', 'extraHeaders']
    );
    chrome.webRequest.onHeadersReceived.addListener(
      onHeaders,
      { urls: SONY_URL_FILTERS },
      ['responseHeaders', 'extraHeaders']
    );
    chrome.webRequest.onCompleted.addListener(onCompleted, { urls: SONY_URL_FILTERS });
    chrome.webRequest.onErrorOccurred.addListener(onError, { urls: SONY_URL_FILTERS });

    const cleanup = () => {
      chrome.webRequest.onSendHeaders.removeListener(onSent);
      chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
      chrome.webRequest.onCompleted.removeListener(onCompleted);
      chrome.webRequest.onErrorOccurred.removeListener(onError);
    };

    const fullUrl = `${AUTHORIZE_URL}?${params.toString()}`;
    console.log('[PSN auth] GET', fullUrl);

    let responseBody = null;

    fetch(fullUrl, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'include'
    })
      .then(async (res) => {
        console.log(
          '[PSN auth] fetch resolved: type=' + res.type,
          'status=' + res.status,
          'url=' + res.url
        );
        // Per status non 30x (manual lascia leggere il body) leggiamo il body
        // cosi' Sony spesso ci dice cosa c'e' che non va.
        if (res.type !== 'opaqueredirect') {
          try {
            responseBody = (await res.text()).slice(0, 500);
            console.log('[PSN auth] response body:', responseBody);
          } catch (e) {
            console.log('[PSN auth] body read error:', e?.message);
          }
        }
      })
      .catch((e) => {
        console.log('[PSN auth] fetch rejected:', e?.message);
      })
      .finally(() => {
        // Piccolo delay per permettere a onCompleted/onErrorOccurred di scattare
        setTimeout(() => {
          cleanup();
          console.log(
            '[PSN auth] riepilogo: headers=' + headersFired,
            'completed=' + completedFired,
            'error=' + errorFired,
            'lastStatus=' + lastStatus,
            'captured=' + Boolean(captured)
          );

          if (captured) return resolve(captured);

          if (headersFired === 0) {
            return reject(
              new Error(
                "Nessuna risposta intercettata dal server. Apri DevTools del service worker per vedere i log [PSN auth]."
              )
            );
          }
          if (lastLocation && /signin|login|authentication/i.test(lastLocation)) {
            return reject(
              new Error(
                "Sony ha reindirizzato al login: cookie npsso non valido. Apri https://my.account.sony.com/ e fai login."
              )
            );
          }
          if (lastStatus && lastStatus >= 400) {
            const npssoSent = /(?:^|;\s*)npsso=/.test(lastSentCookieHeader || '');
            const hint = npssoSent
              ? 'npsso e\' stato inviato ma rifiutato.'
              : 'npsso NON e\' stato inviato nel Cookie header.';
            return reject(
              new Error(
                `Sony status ${lastStatus}. ${hint} Body: ${responseBody || '(vuoto)'}`
              )
            );
          }
          reject(
            new Error(
              `Codice non trovato. status=${lastStatus}, Location=${(lastLocation || '(nessuna)').slice(0, 200)}`
            )
          );
        }, 100);
      });
  });
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    token_format: 'jwt'
  });

  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scambio token fallito (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error('Risposta token senza access_token.');
  console.log('[PSN auth] access_token ottenuto, scadenza in', json.expires_in, 's');
  return json.access_token;
}
