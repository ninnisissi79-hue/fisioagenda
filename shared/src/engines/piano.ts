import type { FingerId } from '../types.ts';
import { fingerLabel } from '../fingers.ts';
import { BaseEngine, round, roundOrNull, shortFinger, type EngineSetup, type Shape } from './base.ts';
import { dist, mean, prng, type Pt } from './tracker.ts';

type Sub = 'settle' | 'cue' | 'lifted';

const SETTLE_MS = 900;

/** Pianoforte: sollevare e riappoggiare il dito indicato. */
export class PianoEngine extends BaseEngine {
  keys = new Map<FingerId, Pt>();
  zoneR: number;
  sub: Sub = 'settle';
  settleSince = 0;
  cueFinger: FingerId | null = null;
  cueAt = 0; liftAt = 0; cueIdx = 0;
  rand: () => number;
  cueOrder: FingerId[] = [];
  wrongLifts = 0; omissions = 0;
  reactions: number[] = []; liftDurations: number[] = []; replaceErrors: number[] = [];

  constructor(setup: EngineSetup) {
    super(setup);
    this.zoneR = this.px(this.p('zoneRadius', 0.09));
    for (const f of setup.fingers) { const a = setup.anchors[f]; if (a) this.keys.set(f, a); }
    this.rand = prng(setup.seed);
  }

  assignRadius(): number { return Math.max(0.12 * this.s, this.px(Number(this.setup.params.zoneRadius ?? 0.09)) * 2); }

  missingFingers(): FingerId[] {
    if (this.sub === 'lifted' && this.cueFinger) return this.setup.fingers.filter((f) => f !== this.cueFinger && !this.tracker.isDown(f));
    return this.setup.fingers.filter((f) => !this.tracker.isDown(f));
  }

  isExpectedLift(f: FingerId): boolean { return this.phase === 'active' && this.sub === 'cue' && f === this.cueFinger; }

  nextCue(): FingerId {
    const fs = this.setup.fingers;
    if (this.setup.params.order === 'random' && fs.length > 1) {
      const options = fs.filter((f) => f !== this.cueFinger);
      return options[Math.floor(this.rand() * options.length)];
    }
    const f = fs[this.cueIdx % fs.length];
    this.cueIdx++;
    return f;
  }

  onSetStart(t: number): void { this.phase = 'waiting'; this.sub = 'settle'; this.settleSince = t; }
  onPauseReset(t: number): void { if (this.phase === 'active') { this.phase = 'waiting'; this.sub = 'settle'; this.settleSince = t; } }
  onMove(): void {}

  onDown(f: FingerId | null, x: number, y: number, t: number): void {
    if (!f || this.phase !== 'active' || this.sub !== 'lifted' || f !== this.cueFinger) return;
    const key = this.keys.get(f)!;
    const err = dist({ x, y }, key);
    const ok = err <= this.zoneR;
    this.liftDurations.push(t - this.liftAt);
    this.replaceErrors.push(err);
    this.registerRep(t, ok, { finger: f, reactionMs: Math.round(this.liftAt - this.cueAt), liftMs: Math.round(t - this.liftAt), replaceErrorU: round(this.u(err), 4), reason: ok ? undefined : 'replace_outside' });
    if (ok) this.reactions.push(this.liftAt - this.cueAt);
    this.afterRep(t);
  }

  afterRep(t: number): void {
    this.cueFinger = this.phase === 'active' ? this.cueFinger : null;
    if (this.phase === 'active') { this.sub = 'settle'; this.settleSince = t; }
  }

  onUp(f: FingerId | null, t: number): void {
    if (!f || this.phase !== 'active') return;
    if (this.sub === 'cue') {
      if (f === this.cueFinger) { this.sub = 'lifted'; this.liftAt = t; this.log(t, 'lift', f); }
      else {
        this.wrongLifts++;
        this.registerRep(t, false, { finger: this.cueFinger, wrong: f, reason: 'wrong_finger' });
        this.afterRep(t);
      }
    } else if (this.sub === 'settle') {
      this.settleSince = t;
    } else if (this.sub === 'lifted' && f !== this.cueFinger) {
      this.wrongLifts++;
    }
  }

  allDown(): boolean { return this.setup.fingers.every((f) => this.tracker.isDown(f)); }

  onTick(t: number): void {
    const respMs = this.p('responseSec', 4) * 1000;
    if (this.phase === 'waiting') {
      if (!this.allDown()) { this.settleSince = t; return; }
      this.phase = 'active'; this.sub = 'settle'; this.settleSince = t;
    }
    if (this.sub === 'settle') {
      if (!this.allDown()) { this.settleSince = t; return; }
      if (t - this.settleSince >= SETTLE_MS) {
        this.cueFinger = this.nextCue();
        this.cueAt = t; this.sub = 'cue';
        this.log(t, 'cue', this.cueFinger);
      }
    } else if (this.sub === 'cue') {
      if (t - this.cueAt > respMs) {
        this.omissions++;
        this.registerRep(t, false, { finger: this.cueFinger, reason: 'omission' });
        this.afterRep(t);
      }
    } else if (this.sub === 'lifted') {
      if (t - this.liftAt > respMs) {
        this.registerRep(t, false, { finger: this.cueFinger, reason: 'not_replaced', reactionMs: Math.round(this.liftAt - this.cueAt) });
        this.afterRep(t);
      }
    }
  }

  activeMessage(): { message: string; detail?: string } {
    if (this.sub === 'cue' && this.cueFinger) return { message: `Solleva: ${fingerLabel(this.cueFinger)}` };
    if (this.sub === 'lifted' && this.cueFinger) return { message: `Riappoggia: ${fingerLabel(this.cueFinger)}` };
    return { message: 'Tieni tutte le dita appoggiate', detail: 'Aspetta il segnale.' };
  }

  waitingDetail(): string { return 'Appoggia ogni dito sul suo tasto.'; }

  scene(): Shape[] {
    const out: Shape[] = [];
    for (const [f, k] of this.keys) {
      const cued = this.phase === 'active' && (this.sub === 'cue' || this.sub === 'lifted') && f === this.cueFinger;
      out.push({ kind: 'circle', ...k, r: this.zoneR, fill: cued ? 'cue' : 'muted', alpha: cued ? 0.85 : 0.35, stroke: this.tracker.isDown(f) ? 'ok' : 'target', width: 4 });
      out.push({ kind: 'text', x: k.x, y: k.y + this.zoneR + 0.04 * this.s, text: shortFinger(f), size: 0.04 * this.s, tone: 'muted' });
    }
    return [...out, ...this.fingerShapes()];
  }

  specificMetrics(): Record<string, number | null> {
    const err = mean(this.replaceErrors);
    return {
      wrongLifts: this.wrongLifts,
      omissions: this.omissions,
      meanReactionMs: roundOrNull(mean(this.reactions), 0),
      meanLiftMs: roundOrNull(mean(this.liftDurations), 0),
      meanReplaceErrorU: err === null ? null : round(this.u(err), 4),
    };
  }
}
