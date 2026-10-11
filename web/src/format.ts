import { fmtDayIt, type MetricDef } from '@handlab/shared';

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
export function fmtDay(d: string | null | undefined): string { return d ? fmtDayIt(d) : '—'; }
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}
export function fmtPct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
}
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'mai';
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 2) return 'pochi istanti fa';
  if (m < 60) return `${m} minuti fa`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} ore fa`;
  return `${Math.round(h / 24)} giorni fa`;
}
export function fmtMetric(def: MetricDef | undefined, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (!def) return String(v);
  switch (def.unit) {
    case 'ratio': return fmtPct(v);
    case 'ms': return v >= 10000 ? fmtDuration(v) : `${(v / 1000).toFixed(1)} s`;
    case 'u': return `${v.toFixed(3)} u`;
    case 'mm': return `${v.toFixed(1)} mm`;
    case 'u/s': return `${v.toFixed(3)} u/s`;
    default: return String(v);
  }
}
export function unitLabel(u: MetricDef['unit']): string {
  return { count: 'numero', ms: 'secondi', u: 'unità normalizzate (lato corto dell\'area)', mm: 'mm (con calibrazione fisica)', ratio: '%', 'u/s': 'unità normalizzate al secondo' }[u];
}
export function metricChartValue(def: MetricDef, v: number): number {
  if (def.unit === 'ratio') return v * 100;
  if (def.unit === 'ms') return v / 1000;
  return v;
}
export function metricChartUnit(def: MetricDef): string {
  return def.unit === 'ratio' ? '%' : def.unit === 'ms' ? 's' : def.unit === 'count' ? '' : def.unit;
}
