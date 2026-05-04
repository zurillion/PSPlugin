// Flusso OAuth standard di psn-api:
// 1. lettura del cookie npsso (gia' presente dopo il login dell'utente)
// 2. ri-set esplicito del cookie su .account.sony.com con SameSite=None,
//    altrimenti il fetch dal service worker (richiesta cross-site) non lo
//    include
// 3. GET /authorize -> Sony risponde 302 verso com.scee.psxstore://redirect?code=...
// 4. il code viene catturato con chrome.webRequest.onBeforeRedirect (in MV3
//    fetch non puo' leggere l'header Location di un redirect manuale)
// 5. POST /token per scambiare il code con un access_token JWT

const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_SECRET = 'UcPN42zz9iRcddvEJ8mt2rD2iOuC79pkGSOjjTHh3Xw=';
const REDIRECT_URI = 'com.scee.psxstore://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

const AUTHORIZE_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize';
const TOKEN_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/token';

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

// Forza la presenza del cookie su .account.sony.com con SameSite=None: senza
// questo passaggio il cookie originale (spesso SameSite=Lax/Strict) NON viene
// inviato dalla fetch del service worker, perche' una richiesta da estensione
// e' considerata cross-site.
async function ensureCookieOnTarget(value) {
  const oneYear = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  await chrome.cookies.set({
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
    let lastRedirectUrl = null;
    let redirectCount = 0;

    const listener = (details) => {
      const url = details?.redirectUrl;
      if (!url) return;
      redirectCount++;
      lastRedirectUrl = url;
      console.log('[PSN auth] redirect', redirectCount, '->', url.slice(0, 200));
      if (url.startsWith('com.scee.psxstore://')) {
        try {
          const code = new URL(url).searchParams.get('code');
          if (code) captured = code;
        } catch {
          // ignore malformed redirect
        }
      }
    };

    chrome.webRequest.onBeforeRedirect.addListener(listener, {
      urls: ['*://*.account.sony.com/*', '*://*.playstation.com/*']
    });

    const fullUrl = `${AUTHORIZE_URL}?${params.toString()}`;
    console.log('[PSN auth] GET', fullUrl);

    fetch(fullUrl, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'include'
    })
      .then((res) => {
        console.log(
          '[PSN auth] authorize response: type=' + res.type,
          'status=' + res.status,
          'url=' + res.url
        );
      })
      .catch((e) => {
        console.log('[PSN auth] authorize fetch error:', e?.message);
      })
      .finally(() => {
        chrome.webRequest.onBeforeRedirect.removeListener(listener);
        if (captured) return resolve(captured);

        if (redirectCount === 0) {
          return reject(
            new Error(
              'Nessun redirect intercettato dalla richiesta authorize. ' +
                'Apri DevTools del service worker (chrome://extensions -> Inspect views -> service worker) per vedere lo status della risposta.'
            )
          );
        }
        if (lastRedirectUrl && /signin|login|authentication/i.test(lastRedirectUrl)) {
          return reject(
            new Error(
              "Sony ha reindirizzato alla pagina di login: il cookie npsso non e' valido. Apri https://my.account.sony.com/, fai login, poi riprova."
            )
          );
        }
        reject(
          new Error(
            `Codice autorizzazione non trovato dopo ${redirectCount} redirect. Ultimo: ${String(
              lastRedirectUrl
            ).slice(0, 200)}`
          )
        );
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
