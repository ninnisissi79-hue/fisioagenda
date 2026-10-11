/** CSV con separatore ";" (compatibile con Excel in italiano) e BOM UTF-8 facoltativo. */
export function toCsv(rows: Record<string, unknown>[], columns: string[], sep = ';'): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(sep), ...rows.map((r) => columns.map((c) => esc(r[c])).join(sep))].join('\r\n') + '\r\n';
}

export function parseCsv(text: string, sep = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
