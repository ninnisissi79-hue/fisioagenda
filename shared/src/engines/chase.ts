import type { FingerId } from '../types.ts';
import { BaseEngine, round, type EngineSetup, type Shape } from './base.ts';
import { comfortRegion, scaleRect } from './comfort.ts';
import { dist, type Pt } from './tracker.ts';
import { resample } from './path.ts';

/** Insegui il bersaglio: il bersaglio si muove a velocità costante su una figura a otto. */
export class ChaseEngine extends BaseEngine {
  f: FingerId;
  curve: Pt[]; cum: number[]; L: number;
  speedPx: number; targetR: number;
  sAcc = 0;
  tracking = false;
  setTrackingMs = 0; trackingMs = 0; onTargetMs = 0; distWeighted = 0; streak = 0; longest = 0;
  fromCalibration: boolean;

  constructor(setup: EngineSetup) {
    super(setup);
    this.f = setup.fingers[0];
    const reg = comfortRegion(setup.comfort, this.s, setup.area, setup.anchors[this.f]);
    this.fromCalibration = reg.fromCalibration;
    const r = scaleRect(reg, this.p('amplitude', 0.7));
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const raw: Pt[] = [];
    for (let i = 0; i <= 240; i++) {
      const th = (2 * Math.PI * i) / 240;
      raw.push({ x: cx + (r.w / 2) * Math.sin(th), y: cy + (r.h / 2) * Math.sin(2 * th) * (setup.hand === 'left' ? -1 : 1) });
    }
    this.curve = resample(raw, 240);
    this.cum = [0];
    for (let i = 1; i < this.curve.length; i++) this.cum.push(this.cum[i - 1] + dist(this.curve[i - 1], this.curve[i]));
    this.L = this.cum[this.cum.length - 1];
    this.speedPx = this.px(this.p('speed', 0.08));
    this.targetR = this.px(this.p('targetRadius', 0.09));
    this.tracker.anchors = { [this.f]: this.curve[0] };
  }

  get targetReps(): number { return this.sets; }

  target(): Pt {
    const s = this.sAcc % this.L;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (s - this.cum[i - 1]) / seg;
    const a = this.curve[i - 1], b = this.curve[i];
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }

  missingFingers(): FingerId[] { return this.tracker.isDown(this.f) ? [] : [this.f]; }

  onSetStart(): void { this.phase = 'waiting'; this.setTrackingMs = 0; this.tracking = false; this.tracker.anchors = { [this.f]: this.target() }; this.tracker.lastKnown.delete(this.f); }
  onPauseReset(): void { this.tracking = false; this.streak = 0; }
  onDown(): void {}
  onMove(): void {}
  onUp(f: FingerId | null, t: number, lost: boolean): void {
    if (f === this.f && lost) { this.tracking = false; this.streak = 0; this.log(t, 'target_wait'); this.tracker.anchors = { [this.f]: this.target() }; this.tracker.lastKnown.delete(this.f); }
  }

  onTick(t: number, dt: number): void {
    const p = this.tracker.pos(this.f);
    if (!p) { this.tracking = false; return; }
    if (!this.tracking) {
      // riparte solo quando il dito è di nuovo sul bersaglio
      if (dist(p, this.target()) <= this.targetR * 1.5) {
        this.tracking = true;
        if (this.phase === 'waiting') { this.phase = 'active'; this.attempts++; }
      }
      return;
    }
    this.sAcc += (this.speedPx * dt) / 1000;
    this.trackingMs += dt; this.setTrackingMs += dt;
    const d = dist(p, this.target());
    this.distWeighted += d * dt;
    if (d <= this.targetR) { this.onTargetMs += dt; this.streak += dt; this.longest = Math.max(this.longest, this.streak); }
    else this.streak = 0;
    if (this.setTrackingMs >= this.p('durationSec', 30) * 1000) {
      this.validReps++; this.repsInSet = 0;
      this.reps.push({ set: this.setIdx + 1, valid: true, trackingMs: Math.round(this.setTrackingMs) });
      this.tracking = false;
      this.completeSet(t);
    }
  }

  activeMessage(): { message: string; detail?: string } {
    if (!this.tracking) return { message: 'Appoggia il dito sul bersaglio' };
    return { message: 'Segui il bersaglio', detail: undefined };
  }

  waitingDetail(): string { return 'Il bersaglio parte quando lo tocchi.'; }

  progressFraction(): number {
    const per = this.p('durationSec', 30) * 1000;
    return (this.validReps + Math.min(1, this.setTrackingMs / per)) / this.sets;
  }

  scene(): Shape[] {
    const tg = this.target();
    const p = this.tracker.pos(this.f);
    const on = !!p && dist(p, tg) <= this.targetR;
    return [
      { kind: 'line', pts: this.curve, width: 2, tone: 'muted', dash: [6, 12], alpha: 0.5 },
      { kind: 'circle', ...tg, r: this.targetR, fill: on ? 'ok' : 'target', alpha: 0.55, stroke: on ? 'ok' : 'target', width: 4 },
      ...this.fingerShapes(),
    ];
  }

  result() {
    const r = super.result();
    // per questo esercizio la "quota valida" è la quota di tempo sul bersaglio
    r.metrics.successRate = this.trackingMs > 0 ? round(this.onTargetMs / this.trackingMs, 4) : null;
    r.metrics.attempts = null;
    return r;
  }

  specificMetrics(): Record<string, number | null> {
    return {
      trackingMs: Math.round(this.trackingMs),
      onTargetRatio: this.trackingMs > 0 ? round(this.onTargetMs / this.trackingMs, 4) : null,
      meanDistanceU: this.trackingMs > 0 ? round(this.u(this.distWeighted / this.trackingMs), 4) : null,
      longestOnTargetMs: Math.round(this.longest),
    };
  }
}
