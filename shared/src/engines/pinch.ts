import type { FingerId } from '../types.ts';
import { BaseEngine, round, roundOrNull, type EngineSetup, type Shape } from './base.ts';
import { comfortDistance } from './comfort.ts';
import { dist, mean, type Pt } from './tracker.ts';

type Sub = 'preopen' | 'close' | 'hold' | 'open';

/** Pinza sul piano: avvicinare e allontanare pollice e dito selezionato. */
export class PinchEngine extends BaseEngine {
  a: FingerId; b: FingerId;
  openT: number; closeT: number; tol: number;
  fromCalibration: boolean;
  sub: Sub = 'preopen';
  repStart = 0; holdStart = 0;
  repMin = Infinity; repMax = 0; mid0: Pt | null = null; driftSamples: number[] = [];
  allMin = Infinity; allMax = 0;
  repTimes: number[] = []; ranges: number[] = []; drifts: number[] = [];

  constructor(setup: EngineSetup) {
    super(setup);
    [this.a, this.b] = setup.fingers as [FingerId, FingerId];
    const c = comfortDistance(setup.comfort, this.s, setup.anchors, this.a, this.b);
    const amp = Math.max(0.05, Math.min(1, this.p('amplitude', 0.6)));
    const range = c.max - c.min;
    this.openT = c.max - ((1 - amp) * range) / 2;
    this.closeT = c.min + ((1 - amp) * range) / 2;
    this.tol = this.px(this.p('tolerance', 0.04));
    this.fromCalibration = c.fromCalibration;
  }

  missingFingers(): FingerId[] { return [this.a, this.b].filter((f) => !this.tracker.isDown(f)); }

  d(): number | null {
    const pa = this.tracker.pos(this.a), pb = this.tracker.pos(this.b);
    return pa && pb ? dist(pa, pb) : null;
  }

  mid(): Pt | null {
    const pa = this.tracker.pos(this.a), pb = this.tracker.pos(this.b);
    return pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : null;
  }

  beginWaiting(): void { this.phase = 'waiting'; this.sub = 'preopen'; }

  startRep(t: number): void {
    this.sub = 'close'; this.repStart = t; this.repMin = Infinity; this.repMax = 0; this.mid0 = this.mid(); this.driftSamples = [];
  }

  onPauseReset(): void { if (this.phase === 'active') this.beginWaiting(); }
  onSetStart(): void { this.beginWaiting(); }

  onDown(): void {}
  onMove(): void {}
  onUp(f: FingerId | null, t: number, lost: boolean): void {
    if (!f || !lost) return;
    if (this.phase === 'active' && (this.sub === 'close' || this.sub === 'hold' || this.sub === 'open')) {
      this.registerRep(t, false, { reason: 'contact_lost', ms: Math.round(t - this.repStart) });
    }
    if (this.phase === 'active') this.beginWaiting();
  }

  onTick(t: number): void {
    const d = this.d();
    if (d === null) { if (this.phase === 'active') this.beginWaiting(); return; }
    if (this.phase === 'waiting') { this.phase = 'active'; this.sub = 'preopen'; }
    this.allMin = Math.min(this.allMin, d); this.allMax = Math.max(this.allMax, d);
    if (this.sub === 'preopen') {
      if (d >= this.openT - this.tol) this.startRep(t);
      return;
    }
    this.repMin = Math.min(this.repMin, d); this.repMax = Math.max(this.repMax, d);
    const m = this.mid();
    if (m && this.mid0) this.driftSamples.push(dist(m, this.mid0));
    if (t - this.repStart > this.p('maxRepSec', 15) * 1000) {
      this.registerRep(t, false, { reason: 'timeout', ms: Math.round(t - this.repStart) });
      if (this.phase === 'active') this.sub = 'preopen';
      return;
    }
    if (this.sub === 'close' && d <= this.closeT + this.tol) { this.sub = 'hold'; this.holdStart = t; }
    if (this.sub === 'hold') {
      if (d > this.closeT + this.tol) this.sub = 'close';
      else if (t - this.holdStart >= this.p('holdMs', 0)) this.sub = 'open';
    } else if (this.sub === 'open') {
      if (d >= this.openT - this.tol) {
        const ms = t - this.repStart;
        const range = this.repMax - this.repMin;
        const drift = mean(this.driftSamples) ?? 0;
        this.repTimes.push(ms); this.ranges.push(range); this.drifts.push(drift);
        this.registerRep(t, true, { ms: Math.round(ms), rangeU: round(this.u(range), 4), minU: round(this.u(this.repMin), 4), driftU: round(this.u(drift), 4) });
        if (this.phase === 'active') this.startRep(t);
      }
    }
  }

  activeMessage(): { message: string; detail?: string } {
    switch (this.sub) {
      case 'preopen': return { message: 'Allontana le dita fino al segno esterno' };
      case 'close': return { message: 'Avvicina le dita' };
      case 'hold': return { message: 'Mantieni…' };
      case 'open': return { message: 'Allontana le dita' };
    }
  }

  scene(): Shape[] {
    const out: Shape[] = [];
    const pa = this.tracker.pos(this.a) ?? this.tracker.reference(this.a);
    const pb = this.tracker.pos(this.b) ?? this.tracker.reference(this.b);
    if (pa && pb) {
      const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const d = Math.max(1, dist(pa, pb));
      const ux = (pb.x - pa.x) / d, uy = (pb.y - pa.y) / d;
      const at = (r: number, sign: number) => ({ x: m.x + (sign * ux * r) / 2, y: m.y + (sign * uy * r) / 2 });
      const closing = this.sub === 'close' || this.sub === 'hold';
      for (const sign of [-1, 1]) {
        out.push({ kind: 'circle', ...at(this.openT, sign), r: 0.05 * this.s, stroke: closing ? 'ghost' : 'target', width: 4 });
        out.push({ kind: 'circle', ...at(this.closeT, sign), r: 0.05 * this.s, stroke: closing ? 'target' : 'ghost', width: 4 });
      }
      if (this.tracker.isDown(this.a) && this.tracker.isDown(this.b)) {
        out.push({ kind: 'line', pts: [pa, pb], width: 6, tone: this.sub === 'hold' ? 'ok' : 'track' });
      }
    }
    // posizioni di partenza quando le dita non sono appoggiate
    for (const f of this.missingFingers()) {
      const r = this.tracker.reference(f);
      if (r) out.push({ kind: 'circle', x: r.x, y: r.y, r: 0.06 * this.s, stroke: 'cue', width: 5, label: f === 'T' ? 'P' : 'D' });
    }
    return [...out, ...this.fingerShapes()];
  }

  specificMetrics(): Record<string, number | null> {
    const range = mean(this.ranges);
    return {
      meanRepMs: roundOrNull(mean(this.repTimes), 0),
      minDistanceU: Number.isFinite(this.allMin) ? round(this.u(this.allMin), 4) : null,
      maxDistanceU: this.allMax > 0 ? round(this.u(this.allMax), 4) : null,
      meanRangeU: range === null ? null : round(this.u(range), 4),
      meanRangeMm: this.mm(range),
      planeDriftU: (() => { const m = mean(this.drifts); return m === null ? null : round(this.u(m), 4); })(),
    };
  }
}
