// Flusso OAuth standard di psn-api: il cookie npsso (gia' presente nel browser
// dopo il login dell'utente) viene incluso automaticamente nella richiesta di
// authorize grazie a host_permissions. Il server risponde con un 302 verso
// com.scee.psxstore://redirect?code=...; in MV3 fetch non puo' leggere
// l'header Location dei redirect opachi, quindi il code viene catturato con
// chrome.webRequest.onBeforeRedirect.

const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_SECRET = 'UcPN42zz9iRcddvEJ8mt2rD2iOuC79pkGSOjjTHh3Xw=';
const REDIRECT_URI = 'com.scee.psxstore://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

const AUTHORIZE_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize';
const TOKEN_URL = 'https://ca.account.sony.com/api/authz/v3/oauth/token';

export async function getAccessToken() {
  const code = await getAuthCode();
  return await exchangeCodeForToken(code);
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

    const listener = (details) => {
      const url = details?.redirectUrl;
      if (!url || !url.startsWith('com.scee.psxstore://')) return;
      try {
        const code = new URL(url).searchParams.get('code');
        if (code) captured = code;
      } catch {
        // ignore malformed redirect
      }
    };

    chrome.webRequest.onBeforeRedirect.addListener(listener, {
      urls: ['*://ca.account.sony.com/*']
    });

    fetch(`${AUTHORIZE_URL}?${params.toString()}`, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'include'
    })
      .catch(() => {
        // Il fetch fallisce perche' il redirect punta a uno schema custom:
        // e' atteso. Il code e' gia' stato catturato dal listener.
      })
      .finally(() => {
        chrome.webRequest.onBeforeRedirect.removeListener(listener);
        if (captured) resolve(captured);
        else
          reject(
            new Error(
              'Codice autorizzazione non ottenuto. Il cookie npsso potrebbe essere scaduto: rifai login su playstation.com.'
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
  return json.access_token;
}
