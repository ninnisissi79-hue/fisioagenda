import { defaultAnchors, type Calibration, type ComfortZone, type FingerId, type Hand, type NPoint, type AreaSize } from '@handlab/shared';
import type { Pt } from '@handlab/shared';

/** Contesto spaziale: taratura (coordinate normalizzate) + scostamento del riposizionamento di inizio seduta. */
export interface Placement { calibration: Calibration | null; offset: NPoint }

export function calibrationFor(cal: Calibration | null, hand: Hand): Calibration | null {
  return cal && cal.hand === hand ? cal : null;
}

export function anchorsNormalized(cal: Calibration | null, hand: Hand, area: AreaSize): Record<FingerId, NPoint> {
  const def = defaultAnchors(hand, area);
  if (!cal) return def;
  const out = { ...def };
  for (const f of Object.keys(def) as FingerId[]) {
    const p = cal.layout?.[f] ?? cal.singleAnchors?.[f];
    if (p) out[f] = p;
  }
  return out;
}

export function anchorsPx(pl: Placement, hand: Hand, area: AreaSize): Partial<Record<FingerId, Pt>> {
  const s = Math.min(area.w, area.h);
  const cal = calibrationFor(pl.calibration, hand);
  const n = anchorsNormalized(cal, hand, area);
  const out: Partial<Record<FingerId, Pt>> = {};
  for (const [f, p] of Object.entries(n) as [FingerId, NPoint][]) {
    out[f] = { x: clamp((p.x + pl.offset.x) * s, 0.03 * s, area.w - 0.03 * s), y: clamp((p.y + pl.offset.y) * s, 0.03 * s, area.h - 0.03 * s) };
  }
  return out;
}

export function comfortFor(pl: Placement, hand: Hand, exerciseId: string): ComfortZone | null {
  const cal = calibrationFor(pl.calibration, hand);
  const c = cal?.comfort.find((z) => z.exerciseId === exerciseId) ?? null;
  if (!c) return null;
  const o = pl.offset;
  const mv = (p?: NPoint) => (p ? { x: p.x + o.x, y: p.y + o.y } : undefined);
  return { ...c, start: mv(c.start), end: mv(c.end), rect: c.rect ? { ...c.rect, x: c.rect.x + o.x, y: c.rect.y + o.y } : undefined };
}

/** differenza relativa tra l'area attuale e quella della taratura */
export function areaMismatch(cal: Calibration | null, area: AreaSize): number {
  if (!cal) return 0;
  return Math.max(Math.abs(cal.area.w - area.w) / cal.area.w, Math.abs(cal.area.h - area.h) / cal.area.h);
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
