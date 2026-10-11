import type { ComfortZone, FingerId, Hand } from '../types.ts';
import type { Pt } from './tracker.ts';
import { dist } from './tracker.ts';

/** Conversione dell'area confortevole (u) in pixel, con valori prudenti se manca la taratura. */
export function comfortDistance(c: ComfortZone | null, s: number, anchors: Partial<Record<FingerId, Pt>>, a: FingerId, b: FingerId): { min: number; max: number; fromCalibration: boolean } {
  if (c && c.kind === 'distance' && c.minDist !== undefined && c.maxDist !== undefined && c.maxDist > c.minDist) {
    return { min: c.minDist * s, max: c.maxDist * s, fromCalibration: true };
  }
  const pa = anchors[a], pb = anchors[b];
  const d0 = pa && pb ? dist(pa, pb) : 0.35 * s;
  return { min: Math.max(0.08 * s, d0 * 0.45), max: Math.max(d0, 0.2 * s), fromCalibration: false };
}

export function comfortSegment(c: ComfortZone | null, s: number, anchor: Pt | undefined, hand: Hand): { start: Pt; end: Pt; fromCalibration: boolean } {
  if (c && c.kind === 'segment' && c.start && c.end) {
    return { start: { x: c.start.x * s, y: c.start.y * s }, end: { x: c.end.x * s, y: c.end.y * s }, fromCalibration: true };
  }
  const st = anchor ?? { x: 0.8 * s, y: 0.7 * s };
  const dx = (hand === 'right' ? 0.1 : -0.1) * s;
  return { start: st, end: { x: st.x + dx, y: Math.max(0.1 * s, st.y - 0.35 * s) }, fromCalibration: false };
}

export function comfortRegion(c: ComfortZone | null, s: number, area: { w: number; h: number }, anchor: Pt | undefined): { x: number; y: number; w: number; h: number; fromCalibration: boolean } {
  if (c && c.kind === 'region' && c.rect && c.rect.w > 0 && c.rect.h > 0) {
    return { x: c.rect.x * s, y: c.rect.y * s, w: c.rect.w * s, h: c.rect.h * s, fromCalibration: true };
  }
  const center = anchor ?? { x: area.w / 2, y: area.h / 2 };
  const w = Math.min(0.7 * s, area.w * 0.8), h = Math.min(0.5 * s, area.h * 0.8);
  const x = Math.max(0.05 * s, Math.min(area.w - w - 0.05 * s, center.x - w / 2));
  const y = Math.max(0.05 * s, Math.min(area.h - h - 0.05 * s, center.y - h / 2));
  return { x, y, w, h, fromCalibration: false };
}

/** riduce un rettangolo attorno al centro secondo l'ampiezza (0–1): mai oltre l'area approvata */
export function scaleRect(r: { x: number; y: number; w: number; h: number }, amplitude: number) {
  const a = Math.max(0.05, Math.min(1, amplitude));
  const w = r.w * a, h = r.h * a;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}
