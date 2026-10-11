import type { FingerId, Hand } from '../types.ts';
import { BaseEngine, round, roundOrNull, type EngineSetup, type Shape } from './base.ts';
import { comfortRegion, scaleRect } from './comfort.ts';
import { dist, mean, pointSegment, type Pt } from './tracker.ts';

export type PathType = 'straight' | 'curve' | 'wave' | 'zigzag';

const N = 120;

/** Tracciato nel quadrato unitario (mano destra); speculare per la sinistra. */
export function unitPath(type: PathType, hand: Hand): Pt[] {
  let raw: Pt[] = [];
  if (type === 'straight') raw = [{ x: 0.05, y: 0.6 }, { x: 0.95, y: 0.4 }];
  else if (type === 'curve') {
    const p0 = { x: 0.05, y: 0.85 }, p1 = { x: 0.5, y: -0.25 }, p2 = { x: 0.95, y: 0.85 };
    for (let i = 0; i <= 40; i++) { const t = i / 40; raw.push({ x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x, y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y }); }
  } else if (type === 'wave') {
    for (let i = 0; i <= 60; i++) { const x = 0.05 + (0.9 * i) / 60; raw.push({ x, y: 0.5 - 0.38 * Math.sin(2 * Math.PI * ((x - 0.05) / 0.9)) }); }
  } else {
    raw = [{ x: 0.05, y: 0.8 }, { x: 0.35, y: 0.2 }, { x: 0.65, y: 0.8 }, { x: 0.95, y: 0.2 }];
  }
  if (hand === 'left') raw = raw.map((p) => ({ x: 1 - p.x, y: p.y }));
  return resample(raw, N);
}

export function resample(pts: Pt[], n: number): Pt[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const L = cum[cum.length - 1];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (L * k) / (n - 1);
    while (j < pts.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[j]) / seg));
    out.push({ x: pts[j].x + t * (pts[j + 1].x - pts[j].x), y: pts[j].y + t * (pts[j + 1].y - pts[j].y) });
  }
  return out;
}

export function pathLength(pts: Pt[]): number {
  let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L;
}

type Sub = 'start' | 'tracing';

/** Segui la strada. */
export class PathEngine extends BaseEngine {
  f: FingerId;
  forward: Pt[];
  half: number; startR: number;
  sub: Sub = 'start';
  progress = 0; repStart = 0; inside = true; samples = 0; inSamples = 0; devSum = 0; exits = 0;
  pathTimes: number[] = []; speeds: number[] = []; totalSamples = 0; totalIn = 0; totalDev = 0; totalExits = 0;
  fromCalibration: boolean;

  constructor(setup: EngineSetup) {
    super(setup);
    this.f = setup.fingers[0];
    const reg = comfortRegion(setup.comfort, this.s, setup.area, setup.anchors[this.f]);
    this.fromCalibration = reg.fromCalibration;
    const r = scaleRect(reg, this.p('amplitude', 0.7));
    const type = (String(setup.params.pathType ?? 'straight')) as PathType;
    this.forward = unitPath(type, setup.hand).map((p) => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h }));
    this.half = this.px(this.p('corridor', 0.12)) / 2;
    this.startR = Math.max(this.half, 0.06 * this.s);
    this.tracker.anchors = { [this.f]: this.forward[0] };
  }

  /** percorso della ripetizione corrente (alterna andata e ritorno) */
  current(): Pt[] { return this.attempts % 2 === 0 ? this.forward : [...this.forward].reverse(); }

  missingFingers(): FingerId[] { return this.tracker.isDown(this.f) ? [] : [this.f]; }

  resetRep(): void { this.sub = 'start'; this.progress = 0; this.samples = 0; this.inSamples = 0; this.devSum = 0; this.exits = 0; this.inside = true; }

  onSetStart(): void { this.phase = 'waiting'; this.resetRep(); this.tracker.lastKnown.delete(this.f); this.tracker.anchors = { [this.f]: this.current()[0] }; }
  onPauseReset(): void { if (this.phase === 'active') { this.phase = 'waiting'; this.resetRep(); } }
  onDown(): void {}

  onMove(f: FingerId | null, x: number, y: number): void {
    if (f !== this.f || this.sub !== 'tracing') return;
    const path = this.current();
    // avanzamento limitato a una finestra per evitare scorciatoie
    const hi = Math.min(path.length - 1, this.progress + 12);
    let bestI = this.progress, bestD = Infinity;
    for (let i = Math.max(0, this.progress - 2); i <= hi; i++) {
      const d = dist({ x, y }, path[i]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD <= this.half * 2) this.progress = Math.max(this.progress, bestI);
  }

  distToPath(p: Pt): number {
    const path = this.current();
    let best = Infinity;
    const lo = Math.max(0, this.progress - 6), hi = Math.min(path.length - 1, this.progress + 6);
    for (let i = lo; i < hi; i++) best = Math.min(best, pointSegment(p, path[i], path[i + 1]).d);
    return best;
  }

  onUp(f: FingerId | null, t: number, lost: boolean): void {
    if (f !== this.f || !lost || this.phase !== 'active') return;
    if (this.sub === 'tracing') this.failRep(t, 'contact_lost');
    if (this.phase === 'active') { this.phase = 'waiting'; this.resetRep(); }
  }

  failRep(t: number, reason: string): void {
    this.flushTotals();
    this.registerRep(t, false, { reason, ms: Math.round(t - this.repStart), progress: round(this.progress / (N - 1), 3) });
    this.tracker.anchors = { [this.f]: this.current()[0] };
  }

  flushTotals(): void { this.totalSamples += this.samples; this.totalIn += this.inSamples; this.totalDev += this.devSum; this.totalExits += this.exits; }

  onTick(t: number): void {
    const p = this.tracker.pos(this.f);
    const path = this.current();
    if (this.phase === 'waiting') {
      if (p && dist(p, path[0]) <= this.startR) { this.phase = 'active'; this.resetRep(); }
      else return;
    }
    if (!p) return;
    if (this.sub === 'start') {
      if (dist(p, path[0]) > this.startR * 0.6 || this.progress > 0) { this.sub = 'tracing'; this.repStart = t; }
      return;
    }
    // campionamento a tempo (ogni frame)
    const d = this.distToPath(p);
    this.samples++; this.devSum += d;
    const inside = d <= this.half;
    if (inside) this.inSamples++;
    if (this.inside && !inside) this.exits++;
    this.inside = inside;
    if (t - this.repStart > this.p('maxRepSec', 30) * 1000) { this.failRep(t, 'timeout'); if (this.phase === 'active') { this.phase = 'waiting'; this.resetRep(); } return; }
    if (this.progress >= path.length - 2 && dist(p, path[path.length - 1]) <= this.startR) {
      const ratio = this.samples ? this.inSamples / this.samples : 0;
      const valid = ratio >= this.p('minInCorridor', 0.7);
      const ms = t - this.repStart;
      this.flushTotals();
      if (valid) { this.pathTimes.push(ms); this.speeds.push(this.u(pathLength(path)) / (ms / 1000)); }
      this.registerRep(t, valid, { ms: Math.round(ms), inCorridor: round(ratio, 4), deviationU: round(this.u(this.devSum / Math.max(1, this.samples)), 4), exits: this.exits, reason: valid ? undefined : 'below_min_corridor' });
      if (this.phase === 'active') this.resetRep();
      this.tracker.anchors = { [this.f]: this.current()[0] };
    }
  }

  activeMessage(): { message: string; detail?: string } {
    if (this.sub === 'start') return { message: 'Parti dal cerchio verde e segui la strada' };
    return { message: this.inside ? 'Segui la strada fino all\'arrivo' : 'Rientra nella strada', detail: undefined };
  }

  waitingDetail(): string { return 'Appoggia il dito sul cerchio di partenza.'; }

  progressFraction(): number {
    const within = this.sub === 'tracing' ? this.progress / (N - 1) : 0;
    return (this.validReps + within) / this.targetReps;
  }

  scene(): Shape[] {
    const path = this.current();
    const out: Shape[] = [
      { kind: 'line', pts: path, width: this.half * 2, tone: 'track', alpha: 0.3 },
      { kind: 'line', pts: path, width: 3, tone: 'muted', dash: [10, 10] },
    ];
    if (this.progress > 0) out.push({ kind: 'line', pts: path.slice(0, this.progress + 1), width: Math.max(6, this.half * 0.6), tone: 'ok', alpha: 0.8 });
    out.push({ kind: 'circle', ...path[0], r: this.startR, fill: 'ok', alpha: 0.5 });
    out.push({ kind: 'circle', ...path[path.length - 1], r: this.startR, stroke: 'target', width: 5, fill: 'target', alpha: 0.35 });
    return [...out, ...this.fingerShapes()];
  }

  specificMetrics(): Record<string, number | null> {
    return {
      meanPathMs: roundOrNull(mean(this.pathTimes), 0),
      inCorridorRatio: this.totalSamples ? round(this.totalIn / this.totalSamples, 4) : null,
      meanDeviationU: this.totalSamples ? round(this.u(this.totalDev / this.totalSamples), 4) : null,
      corridorExits: this.totalExits,
      meanSpeed: roundOrNull(mean(this.speeds), 4),
    };
  }
}
