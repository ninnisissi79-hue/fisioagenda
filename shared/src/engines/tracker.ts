import type { FingerId } from '../types.ts';

export interface Pt { x: number; y: number }

export interface TrackedContact { pointerId: number; finger: FingerId | null; x: number; y: number; downAt: number }

/**
 * Associa i contatti del touchscreen alle dita previste.
 *
 * Il touchscreen non identifica anatomicamente le dita e gli identificativi dei
 * puntatori del browser non sono stabili tra un sollevamento e l'altro: ogni nuovo
 * contatto viene quindi associato al dito libero la cui posizione di riferimento
 * (ultima posizione nota o, in mancanza, posizione di taratura) è la più vicina,
 * entro un raggio massimo. I contatti lontani restano "non assegnati".
 */
export class ContactTracker {
  readonly contacts = new Map<number, TrackedContact>();
  readonly lastKnown = new Map<FingerId, Pt>();
  losses: Record<string, number> = {};
  recontacts = 0;
  extraContacts = 0;

  constructor(
    public expected: FingerId[],
    public anchors: Partial<Record<FingerId, Pt>>,
    public assignRadius: number,
  ) {}

  fingerDown(f: FingerId): TrackedContact | undefined {
    for (const c of this.contacts.values()) if (c.finger === f) return c;
    return undefined;
  }

  isDown(f: FingerId): boolean { return !!this.fingerDown(f); }

  pos(f: FingerId): Pt | undefined { const c = this.fingerDown(f); return c ? { x: c.x, y: c.y } : undefined; }

  reference(f: FingerId): Pt | undefined { return this.lastKnown.get(f) ?? this.anchors[f]; }

  /** dito libero più vicino a (x,y) entro il raggio, oppure null */
  candidate(x: number, y: number, restrictTo?: FingerId[]): FingerId | null {
    let best: FingerId | null = null;
    let bestD = Infinity;
    for (const f of restrictTo ?? this.expected) {
      if (this.isDown(f)) continue;
      const r = this.reference(f);
      if (!r) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return bestD <= this.assignRadius ? best : null;
  }

  down(pointerId: number, x: number, y: number, t: number, restrictTo?: FingerId[]): TrackedContact {
    const finger = this.candidate(x, y, restrictTo);
    if (finger && this.lastKnown.has(finger)) this.recontacts++;
    if (!finger) this.extraContacts++;
    const c: TrackedContact = { pointerId, finger, x, y, downAt: t };
    this.contacts.set(pointerId, c);
    if (finger) this.lastKnown.set(finger, { x, y });
    return c;
  }

  move(pointerId: number, x: number, y: number): TrackedContact | undefined {
    const c = this.contacts.get(pointerId);
    if (!c) return undefined;
    c.x = x; c.y = y;
    if (c.finger) this.lastKnown.set(c.finger, { x, y });
    return c;
  }

  /** @param counted se true il sollevamento è conteggiato come contatto perso */
  up(pointerId: number, counted = true): TrackedContact | undefined {
    const c = this.contacts.get(pointerId);
    if (!c) return undefined;
    this.contacts.delete(pointerId);
    if (c.finger && counted) this.losses[c.finger] = (this.losses[c.finger] ?? 0) + 1;
    return c;
  }

  totalLosses(): number { return Object.values(this.losses).reduce((a, b) => a + b, 0); }

  extraActive(): number { let n = 0; for (const c of this.contacts.values()) if (!c.finger) n++; return n; }

  clear(): void { this.contacts.clear(); }
}

export function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** generatore pseudo-casuale riproducibile (mulberry32) */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** distanza di un punto dal segmento ab, con parametro di proiezione */
export function pointSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return { d: Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)), t };
}
