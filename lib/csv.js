export function toCsv(rows, columns) {
  if (!rows?.length) return '';
  const cols = columns || autoColumns(rows);
  const header = cols.map((c) => csvCell(c.label ?? c.key)).join(',');
  const lines = rows.map((row) =>
    cols.map((c) => csvCell(getNested(row, c.key))).join(',')
  );
  return [header, ...lines].join('\n');
}

function autoColumns(rows) {
  const keys = new Set();
  for (const row of rows) collectKeys(row, '', keys, 0);
  return [...keys].map((k) => ({ key: k, label: k }));
}

function collectKeys(obj, prefix, set, depth) {
  if (depth > 3 || obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) set.add(prefix);
    return;
  }
  for (const k of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      collectKeys(v, path, set, depth + 1);
    } else {
      set.add(path);
    }
  }
}

function getNested(obj, path) {
  return path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (Array.isArray(v)) s = v.join('|');
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
