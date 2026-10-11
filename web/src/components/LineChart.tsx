import { useEffect, useMemo, useRef, useState } from 'react';

export interface ChartPoint { x: number; y: number; group: string; tip: string[]; id?: string }

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

/**
 * Grafico a punti e linee per una singola misura nel tempo.
 * Le condizioni diverse (gruppi) sono serie separate: non vengono unite in una linea unica.
 * Oltre tre condizioni, le successive confluiscono in "altre condizioni" (grigio).
 */
export function LineChart({ points, unit, height = 220, groupLabels, onSelect, selected }: { points: ChartPoint[]; unit: string; height?: number; groupLabels: Record<string, string>; onSelect?: (p: ChartPoint) => void; selected?: Set<string> }) {
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const [asTable, setAsTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(720);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el); return () => ro.disconnect();
  }, [asTable]);
  // larghezza del grafico = larghezza reale: il testo resta leggibile anche nei riquadri piccoli
  const W = cw, H = height, L = 48, R = 14, T = 12, B = 30;
  const groups = useMemo(() => [...new Set(points.map((p) => p.group))], [points]);
  const colorOf = (g: string) => { const i = groups.indexOf(g); return i < 3 ? COLORS[i] : 'var(--series-other)'; };
  if (!points.length) return <p className="muted small">Nessun dato.</p>;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 86400000) { x0 -= 43200000; x1 += 43200000; }
  let y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.08;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = niceTicks(y0, y1, 4);
  const dateTicks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

  if (asTable) {
    return (
      <div>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Data</th><th>Valore</th><th>Condizione</th><th>Dettagli</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i}><td>{new Date(p.x).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{fmt(p.y)} {unit}</td><td>{groupLabels[p.group] ?? p.group}</td><td>{p.tip.slice(1).join(' · ')}</td></tr>)}</tbody></table></div>
        <button className="btn-small btn-ghost" onClick={() => setAsTable(false)}>Mostra grafico</button>
      </div>
    );
  }

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Andamento nel tempo" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" /><text x={L - 6} y={sy(t) + 4} textAnchor="end">{fmt(t)}</text></g>)}
        {dateTicks.map((d, i) => <text key={i} x={sx(d)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}</text>)}
        <text x={4} y={T + 4} textAnchor="start">{unit}</text>
        {groups.map((g) => {
          const ps = points.filter((p) => p.group === g).sort((a, b) => a.x - b.x);
          return (
            <g key={g}>
              {ps.length > 1 && <polyline fill="none" stroke={colorOf(g)} strokeWidth={2} points={ps.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} />}
              {ps.map((p, i) => {
                const sel = p.id && selected?.has(p.id);
                return (
                  <g key={i}>
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={sel ? 7 : 5} fill={colorOf(g)} stroke={sel ? 'var(--text)' : 'var(--surface)'} strokeWidth={2} />
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={14} fill="transparent" style={{ cursor: onSelect ? 'pointer' : 'default' }}
                      onMouseEnter={() => setHover(p)} onClick={() => { setHover(p); onSelect?.(p); }} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: `${Math.min(70, (sx(hover.x) / W) * 100)}%`, top: `${(sy(hover.y) / H) * 100}%`, transform: 'translate(8px, -110%)' }}>
          <b>{fmt(hover.y)} {unit}</b>
          {hover.tip.map((t, i) => <div key={i}>{t}</div>)}
        </div>
      )}
      <div className="row between">
        {groups.length > 1 ? (
          <div className="chart-legend">{groups.slice(0, 3).map((g) => <span key={g}><i style={{ background: colorOf(g) }} />{groupLabels[g] ?? g}</span>)}{groups.length > 3 && <span><i style={{ background: 'var(--series-other)' }} />altre condizioni ({groups.length - 3})</span>}</div>
        ) : <span />}
        <button className="btn-small btn-ghost" onClick={() => setAsTable(true)}>Tabella</button>
      </div>
    </div>
  );
}

function niceTicks(a: number, b: number, n: number): number[] {
  const span = b - a;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
