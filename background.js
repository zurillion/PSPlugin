import { getAccessToken } from './lib/auth.js';
import { fetchPurchasedGames, fetchTrophyTitles } from './lib/psn.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('sidePanel.setPanelBehavior:', e));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'extract') return;
  runExtraction(msg.target)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

async function runExtraction(target) {
  const npssoPresent = await hasNpsso();
  if (!npssoPresent) {
    return {
      ok: false,
      error:
        'Cookie npsso non trovato. Apri https://www.playstation.com e fai login, poi riprova.'
    };
  }

  const token = await getAccessToken();

  const onProgress = (progress) => {
    chrome.runtime
      .sendMessage({ type: 'progress', target, progress })
      .catch(() => {});
  };

  if (target === 'purchased') {
    const data = await fetchPurchasedGames(token, onProgress);
    return { ok: true, data };
  }
  if (target === 'trophies') {
    const data = await fetchTrophyTitles(token, onProgress);
    return { ok: true, data };
  }
  return { ok: false, error: `Target sconosciuto: ${target}` };
}

async function hasNpsso() {
  const cookies = await chrome.cookies.getAll({ name: 'npsso' });
  return cookies.length > 0 && Boolean(cookies[0].value);
}
