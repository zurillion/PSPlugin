import { toCsv } from '../lib/csv.js';

const state = {
  purchased: null,
  trophies: null
};

const COLUMNS = {
  purchased: [
    { key: 'image.url', label: 'Cover', type: 'image' },
    { key: 'name', label: 'Titolo' },
    { key: 'platform', label: 'Piattaforma' },
    { key: 'productType', label: 'Tipo' },
    { key: 'entitlementType', label: 'Entitlement' },
    { key: 'isActive', label: 'Attivo' },
    { key: 'titleId', label: 'Title ID' },
    { key: 'productId', label: 'Product ID' }
  ],
  trophies: [
    { key: 'trophyTitleIconUrl', label: 'Icona', type: 'image' },
    { key: 'trophyTitleName', label: 'Titolo' },
    { key: 'trophyTitlePlatform', label: 'Piattaforma' },
    { key: 'definedTrophies.bronze', label: 'B' },
    { key: 'definedTrophies.silver', label: 'S' },
    { key: 'definedTrophies.gold', label: 'G' },
    { key: 'definedTrophies.platinum', label: 'P' },
    { key: 'progress', label: 'Prog %' },
    { key: 'lastUpdatedDateTime', label: 'Ultimo agg.' }
  ]
};

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.tab);
    });
  });
});

document.getElementById('extract-purchased').addEventListener('click', () => extract('purchased'));
document.getElementById('extract-trophies').addEventListener('click', () => extract('trophies'));
document.getElementById('export-purchased').addEventListener('click', () => exportCsv('purchased'));
document.getElementById('export-trophies').addEventListener('click', () => exportCsv('trophies'));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'progress') {
    const { fetched, total } = msg.progress || {};
    setStatus(msg.target, `Scaricati ${fetched}${total ? ` / ${total}` : ''}…`);
  }
});

async function extract(target) {
  const extractBtn = document.getElementById(`extract-${target}`);
  const exportBtn = document.getElementById(`export-${target}`);
  extractBtn.disabled = true;
  exportBtn.disabled = true;
  setStatus(target, 'Avvio…');

  try {
    const res = await chrome.runtime.sendMessage({ type: 'extract', target });
    if (!res?.ok) throw new Error(res?.error || 'Errore sconosciuto');
    state[target] = res.data;
    setStatus(target, `Completato.`);
    setCount(target, res.data.length);
    renderTable(target, res.data);
    exportBtn.disabled = res.data.length === 0;
  } catch (e) {
    setStatus(target, `Errore: ${e.message}`, true);
  } finally {
    extractBtn.disabled = false;
  }
}

function setStatus(target, text, isError = false) {
  const el = document.getElementById(`status-${target}`);
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function setCount(target, n) {
  document.getElementById(`count-${target}`).textContent = `${n} elementi`;
}

function renderTable(target, rows) {
  const wrap = document.getElementById(`table-${target}`);
  if (!rows?.length) {
    wrap.innerHTML = '<p class="empty">Nessun dato.</p>';
    return;
  }

  const cols = COLUMNS[target];
  const head = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows
    .map((r) => {
      const cells = cols
        .map((c) => {
          const v = getNested(r, c.key);
          if (c.type === 'image' && v) {
            return `<td class="img"><img src="${escapeHtml(v)}" alt="" loading="lazy"></td>`;
          }
          return `<td>${escapeHtml(formatCell(v))}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function getNested(obj, path) {
  return path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

function formatCell(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function exportCsv(target) {
  const data = state[target];
  if (!data?.length) return;
  const csv = toCsv(data);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `psn-${target}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
