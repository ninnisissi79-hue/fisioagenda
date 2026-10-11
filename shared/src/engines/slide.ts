import type { FingerId } from '../types.ts';
import { BaseEngine, round, roundOrNull, type EngineSetup, type Shape } from './base.ts';
import { comfortSegment } from './comfort.ts';
import { dist, mean, pointSegment, type Pt } from './tracker.ts';

type Sub = 'start' | 'out' | 'back';

/** Scorrimento di un dito tra due bersagli con eventuali dita ferme nelle zone. */
export class SlideEngine extends BaseEngine {
  mover: FingerId;
  stabs: FingerId[];
  near: Pt; far: Pt;
  targetR: number; zoneR: number;
  zones = new Map<FingerId, Pt>();
  inZone = new Map<FingerId, boolean>();
  sub: Sub = 'start';
  repStart = 0; reachAt = 0; violation = false; repDev: number[] = []; repMaxProj = 0;
  reachTimes: number[] = []; returnTimes: number[] = []; devs: number[] = []; amps: number[] = [];
  stabExits = 0; stabInMs = 0; stabTotalMs = 0;
  fromCalibration: boolean;

  constructor(setup: EngineSetup) {
    super(setup);
    this.mover = setup.fingers[0];
    this.stabs = setup.fingers.slice(1);
    const seg = comfortSegment(setup.comfort, this.s, setup.anchors[this.mover], setup.hand);
    const amp = Math.max(0.05, Math.min(1, this.p('amplitude', 0.6)));
    this.near = seg.start;
    this.far = { x: seg.start.x + amp * (seg.end.x - seg.start.x), y: seg.start.y + amp * (seg.end.y - seg.start.y) };
    this.fromCalibration = seg.fromCalibration;
    this.targetR = this.px(this.p('targetRadius', 0.08));
    this.zoneR = this.px(this.p('zoneRadius', 0.12));
    for (const f of this.stabs) { const a = setup.anchors[f]; if (a) this.zones.set(f, a); }
    // il dito che scorre si riaggancia vicino al punto di partenza
    this.tracker.anchors = { ...setup.anchors, [this.mover]: this.near };
  }

  missingFingers(): FingerId[] {
    return [this.mover, ...this.stabs].filter((f) => !this.tracker.isDown(f));
  }

  stabsOk(): boolean {
    return this.stabs.every((f) => this.inZone.get(f) === true);
  }

  updateZones(t: number, dt: number): void {
    for (const f of this.stabs) {
      const p = this.tracker.pos(f);
      if (p && !this.zones.has(f)) this.zones.set(f, p);
      const z = this.zones.get(f);
      const ok = !!p && !!z && dist(p, z) <= this.zoneR;
      const prev = this.inZone.get(f);
      if (prev === true && !ok) {
        this.stabExits++;
        this.log(t, 'violation', f);
        if (this.sub !== 'start') this.violation = true;
      }
      this.inZone.set(f, ok);
    }
    if (this.stabs.length && this.phase === 'active' && this.sub !== 'start') {
      this.stabTotalMs += dt;
      if (this.stabsOk()) this.stabInMs += dt;
    }
  }

  onSetStart(): void { this.phase = 'waiting'; this.sub = 'start'; }
  onPauseReset(): void { if (this.phase === 'active') { this.phase = 'waiting'; this.sub = 'start'; } }
  onDown(): void {}
  onMove(f: FingerId | null, x: number, y: number): void {
    if (f !== this.mover || this.phase !== 'active' || this.sub === 'start') return;
    const ps = pointSegment({ x, y }, this.near, this.far);
    this.repDev.push(ps.d);
    this.repMaxProj = Math.max(this.repMaxProj, ps.t * dist(this.near, this.far));
  }

  onUp(f: FingerId | null, t: number, lost: boolean): void {
    if (f === this.mover && lost && this.phase === 'active') {
      if (this.sub !== 'start') this.registerRep(t, false, { reason: 'contact_lost', ms: Math.round(t - this.repStart) });
      if (this.phase === 'active') { this.phase = 'waiting'; this.sub = 'start'; }
    }
  }

  onTick(t: number, dt: number): void {
    this.updateZones(t, dt);
    const p = this.tracker.pos(this.mover);
    if (this.phase === 'waiting') {
      if (p && this.missingFingers().length === 0 && this.stabsOk() && dist(p, this.near) <= this.targetR * 1.5) {
        this.phase = 'active'; this.sub = 'start';
      } else return;
    }
    if (!p) return;
    if (this.sub === 'start') {
      // la ripetizione inizia quando il dito lascia il bersaglio vicino
      if (dist(p, this.near) > this.targetR) {
        this.sub = 'out'; this.repStart = t; this.violation = !this.stabsOk(); this.repDev = []; this.repMaxProj = 0;
      }
      return;
    }
    if (t - this.repStart > this.p('maxRepSec', 15) * 1000) {
      this.registerRep(t, false, { reason: 'timeout', ms: Math.round(t - this.repStart) });
      if (this.phase === 'active') { this.phase = 'waiting'; this.sub = 'start'; }
      return;
    }
    if (this.sub === 'out' && dist(p, this.far) <= this.targetR) { this.sub = 'back'; this.reachAt = t; }
    else if (this.sub === 'back' && dist(p, this.near) <= this.targetR) {
      const strict = this.setup.params.requireStabilizers !== false && this.stabs.length > 0;
      const valid = !(strict && this.violation);
      const reach = this.reachAt - this.repStart, ret = t - this.reachAt;
      const dev = mean(this.repDev) ?? 0;
      if (valid) { this.reachTimes.push(reach); this.returnTimes.push(ret); this.devs.push(dev); this.amps.push(this.repMaxProj); }
      this.registerRep(t, valid, { reason: valid ? undefined : 'stabilizer_out', reachMs: Math.round(reach), returnMs: Math.round(ret), deviationU: round(this.u(dev), 4) });
      if (this.phase === 'active') this.sub = 'start';
    }
  }

  activeMessage(): { message: string; detail?: string } {
    const warn = this.stabs.length && !this.stabsOk() ? 'Tieni ferme le altre dita nelle loro zone' : undefined;
    if (this.sub === 'out') return { message: 'Scorri fino al bersaglio lontano', detail: warn };
    if (this.sub === 'back') return { message: 'Torna al bersaglio vicino', detail: warn };
    return { message: 'Parti verso il bersaglio lontano', detail: warn };
  }

  waitingDetail(): string { return 'Dito che scorre sul cerchio di partenza, altre dita nelle zone.'; }

  scene(): Shape[] {
    const out: Shape[] = [];
    out.push({ kind: 'line', pts: [this.near, this.far], width: this.targetR * 0.6, tone: 'track', alpha: 0.35 });
    const goingOut = this.sub === 'out' || (this.sub === 'start' && this.phase === 'active');
    out.push({ kind: 'circle', ...this.far, r: this.targetR, fill: goingOut ? 'target' : 'ghost', alpha: goingOut ? 0.6 : 0.3 });
    out.push({ kind: 'circle', ...this.near, r: this.targetR, fill: this.sub === 'back' || this.phase === 'waiting' ? 'target' : 'ghost', alpha: 0.5 });
    for (const f of this.stabs) {
      const z = this.zones.get(f) ?? this.tracker.reference(f);
      if (z) out.push({ kind: 'circle', ...z, r: this.zoneR, stroke: this.inZone.get(f) ? 'ok' : 'warn', width: 4, alpha: 0.9 });
    }
    return [...out, ...this.fingerShapes()];
  }

  specificMetrics(): Record<string, number | null> {
    const dev = mean(this.devs);
    return {
      meanReachMs: roundOrNull(mean(this.reachTimes), 0),
      meanReturnMs: roundOrNull(mean(this.returnTimes), 0),
      meanDeviationU: dev === null ? null : round(this.u(dev), 4),
      stabilizerExits: this.stabs.length ? this.stabExits : null,
      stabilizerInZoneRatio: this.stabs.length && this.stabTotalMs > 0 ? round(this.stabInMs / this.stabTotalMs, 4) : null,
    };
  }
}
