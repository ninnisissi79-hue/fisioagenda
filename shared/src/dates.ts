/** Utilità per date di calendario "YYYY-MM-DD" (senza fuso). */
export function parseDay(d: string): Date { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
export function fmtDay(d: Date): string { return d.toISOString().slice(0, 10); }
export function addDays(d: string, n: number): string { const x = parseDay(d); x.setUTCDate(x.getUTCDate() + n); return fmtDay(x); }
export function weekday(d: string): number { return parseDay(d).getUTCDay(); }
export function daysBetween(a: string, b: string): number { return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000); }
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 3700; d = addDays(d, 1)) out.push(d);
  return out;
}
/** data locale del dispositivo, "YYYY-MM-DD" */
export function localDay(date = new Date()): string {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
export function fmtDayIt(d: string): string { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
