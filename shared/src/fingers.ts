import type { FingerId, Hand } from './types.ts';

export const FINGERS: { id: FingerId; label: string; short: string }[] = [
  { id: 'T', label: 'Pollice', short: 'P' },
  { id: 'I', label: 'Indice', short: 'I' },
  { id: 'M', label: 'Medio', short: 'M' },
  { id: 'R', label: 'Anulare', short: 'A' },
  { id: 'L', label: 'Mignolo', short: 'Mi' },
];

export const ALL_FINGERS: FingerId[] = ['T', 'I', 'M', 'R', 'L'];

export function fingerLabel(f: FingerId): string {
  return FINGERS.find((x) => x.id === f)?.label ?? f;
}

export function fingerShort(f: FingerId): string {
  return FINGERS.find((x) => x.id === f)?.short ?? f;
}

export function handLabel(h: Hand): string {
  return h === 'left' ? 'Sinistra' : 'Destra';
}

/**
 * Disposizione predefinita (in unità normalizzate, area 1.6 × 1) usata solo
 * quando manca una taratura (es. prova degli esercizi da parte del fisioterapista).
 * È speculare per la mano sinistra.
 */
export function defaultAnchors(hand: Hand, area: { w: number; h: number }): Record<FingerId, { x: number; y: number }> {
  const s = Math.min(area.w, area.h);
  const W = area.w / s;
  // mano destra: pollice in basso a sinistra, dita a ventaglio sopra
  const right: Record<FingerId, { x: number; y: number }> = {
    T: { x: 0.30, y: 0.72 },
    I: { x: 0.48, y: 0.36 },
    M: { x: 0.64, y: 0.30 },
    R: { x: 0.80, y: 0.36 },
    L: { x: 0.94, y: 0.50 },
  };
  const cx = W / 2 - 0.62;
  const out = {} as Record<FingerId, { x: number; y: number }>;
  for (const f of ALL_FINGERS) {
    const p = right[f];
    const x = cx + p.x;
    out[f] = { x: hand === 'right' ? x : W - x, y: p.y };
  }
  return out;
}
