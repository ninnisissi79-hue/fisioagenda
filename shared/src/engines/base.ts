import type { AreaSize, ComfortZone, FingerId, Hand, Params, RunEvent } from '../types.ts';
import { ContactTracker, type Pt } from './tracker.ts';
import { fingerLabel } from '../fingers.ts';

export type Tone = 'target' | 'active' | 'ok' | 'warn' | 'muted' | 'finger' | 'track' | 'ghost' | 'error' | 'cue';

export type Shape =
  | { kind: 'circle'; x: number; y: number; r: number; fill?: Tone; stroke?: Tone; width?: number; label?: string; alpha?: number }
  | { kind: 'line'; pts: Pt[]; width: number; tone: Tone; dash?: number[]; alpha?: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; tone: Tone };

export interface EngineSetup {
  exerciseId: string;
  hand: Hand;
  fingers: FingerId[];
  params: Params;
  /** area di gioco in pixel CSS */
  area: AreaSize;
  /** posizioni di riferimento delle dita in pixel CSS (taratura + riposizionamento) */
  anchors: Partial<Record<FingerId, Pt>>;
  /** area confortevole approvata, in unità normalizzate */
  comfort: ComfortZone | null;
  pxPerMm: number | null;
  seed: number;
}

export type Phase = 'waiting' | 'active' | 'rest' | 'done';

export interface EngineStatus {
  phase: Phase;
  paused: boolean;
  message: string;
  detail?: string;
  set: number;
  sets: number;
  validReps: number;
  targetReps: number;
  restRemainingMs: number;
  missingFingers: FingerId[];
  progress: number;
}

export interface EngineResult {
  completionMet: boolean;
  endReason: 'completed' | 'attempt_limit' | null;
  setsDone: number;
  repsValid: number;
  attempts: number;
  activeMs: number;
  restMs: number;
  pausedMs: number;
  metrics: Record<string, number | null>;
  reps: Record<string, unknown>[];
  events: RunEvent[];
}

const MAX_EVENTS = 3000;

/**
 * Logica comune: tempo attivo, pause, serie/ripetizioni, riposo, limite di
 * tentativi, eventi tecnici e associazione dei contatti alle dita.
 * Le coordinate sono in pixel CSS; le metriche vengono convertite in unità
 * normalizzate (u = lato corto dell'area).
 */
export abstract class BaseEngine {
  readonly s: number;
  readonly tracker: ContactTracker;
  phase: Phase = 'waiting';
  paused = false;
  activeMs = 0;
  restMs = 0;
  pausedMs = 0;
  setIdx = 0;
  repsInSet = 0;
  validReps = 0;
  attempts = 0;
  endReason: EngineResult['endReason'] = null;
  restUntil = 0;
  lastT: number | null = null;
  t0 = 0;
  readonly events: RunEvent[] = [];
  readonly reps: Record<string, unknown>[] = [];

  readonly sets: number;
  readonly repsPerSet: number;
  readonly restSec: number;

  constructor(public setup: EngineSetup) {
    this.s = Math.min(setup.area.w, setup.area.h);
    this.sets = Math.max(1, Math.round(Number(setup.params.sets ?? 1)));
    this.repsPerSet = Math.max(1, Math.round(Number(setup.params.reps ?? 1)));
    this.restSec = Math.max(0, Number(setup.params.restSec ?? 0));
    this.tracker = new ContactTracker(setup.fingers, setup.anchors, this.assignRadius());
  }

  /** raggio entro cui un nuovo contatto viene associato a un dito */
  assignRadius(): number { return 0.22 * this.s; }

  u(px: number): number { return px / this.s; }
  px(u: number): number { return u * this.s; }
  p(name: string, fallback = 0): number { const v = Number(this.setup.params[name]); return Number.isFinite(v) ? v : fallback; }

  get targetReps(): number { return this.sets * this.repsPerSet; }

  log(t: number, type: string, finger?: FingerId | null, data?: Record<string, unknown>): void {
    if (this.events.length < MAX_EVENTS) this.events.push({ t: Math.round(t - this.t0), type, finger: finger ?? null, data });
  }

  start(t: number): void { this.t0 = t; this.lastT = t; this.log(t, 'start'); this.onStart(t); }

  pause(t: number, reason: string): void {
    if (this.paused || this.phase === 'done') return;
    this.advance(t);
    this.paused = true;
    this.log(t, 'pause', null, { reason });
    this.onPauseReset(t);
  }

  resume(t: number): void {
    if (!this.paused) return;
    this.advance(t);
    this.paused = false;
    if (this.phase === 'rest') this.restUntil = t + Math.max(0, this.restUntil - t);
    this.log(t, 'resume');
  }

  /** aggiorna i contatori di tempo */
  advance(t: number): number {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(t - this.lastT, 1000));
    this.lastT = t;
    if (this.phase === 'done') return 0;
    if (this.paused) { this.pausedMs += dt; return 0; }
    if (this.phase === 'rest') { this.restMs += dt; return 0; }
    this.activeMs += dt;
    return dt;
  }

  tick(t: number): void {
    if (this.phase === 'rest' && !this.paused) {
      // eventuale riposo residuo calcolato prima di avanzare
      if (t >= this.restUntil) { this.advance(this.restUntil); this.lastT = t; this.endRest(t); return; }
    }
    const dt = this.advance(t);
    if (!this.paused && (this.phase === 'waiting' || this.phase === 'active')) this.onTick(t, dt);
  }

  endRest(t: number): void {
    this.phase = 'waiting';
    this.log(t, 'rest_end');
    this.onSetStart(t);
  }

  pointerDown(id: number, x: number, y: number, t: number): void {
    const c = this.tracker.down(id, x, y, t, this.restrictAssignment());
    this.log(t, c.finger ? 'down' : 'extra', c.finger, { x: +this.u(x).toFixed(4), y: +this.u(y).toFixed(4) });
    if (!this.running()) return;
    this.onDown(c.finger, x, y, t);
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    const c = this.tracker.move(id, x, y);
    if (!c || !this.running()) return;
    this.onMove(c.finger, x, y, t);
  }

  pointerUp(id: number, t: number, cancelled = false): void {
    const existing = this.tracker.contacts.get(id);
    if (!existing) return;
    const expected = !this.running() || (existing.finger ? this.isExpectedLift(existing.finger) : true);
    const c = this.tracker.up(id, !expected && !!existing.finger);
    if (!c) return;
    this.log(t, cancelled ? 'cancel' : 'up', c.finger, expected ? undefined : { lost: true });
    if (!this.running()) return;
    this.onUp(c.finger, t, !expected);
  }

  running(): boolean { return !this.paused && (this.phase === 'waiting' || this.phase === 'active'); }

  /** registra una ripetizione/tentativo */
  registerRep(t: number, valid: boolean, data: Record<string, unknown>): void {
    this.attempts++;
    if (valid) { this.validReps++; this.repsInSet++; }
    this.reps.push({ set: this.setIdx + 1, valid, ...data });
    this.log(t, 'rep', null, { valid, ...pick(data, ['reason']) });
    if (this.repsInSet >= this.repsPerSet) this.completeSet(t);
    else if (this.attempts >= this.targetReps * 2) this.finish(t, 'attempt_limit');
  }

  completeSet(t: number): void {
    this.log(t, 'set_done', null, { set: this.setIdx + 1 });
    if (this.setIdx + 1 >= this.sets) { this.finish(t, 'completed'); return; }
    this.setIdx++;
    this.repsInSet = 0;
    if (this.restSec > 0) {
      this.phase = 'rest';
      this.restUntil = t + this.restSec * 1000;
      this.log(t, 'rest_start');
    } else {
      this.phase = 'waiting';
      this.onSetStart(t);
    }
  }

  finish(t: number, reason: 'completed' | 'attempt_limit'): void {
    this.advance(t);
    this.phase = 'done';
    this.endReason = reason;
    this.log(t, 'done', null, { reason });
  }

  status(t: number): EngineStatus {
    const base = {
      phase: this.phase,
      paused: this.paused,
      set: Math.min(this.setIdx + 1, this.sets),
      sets: this.sets,
      validReps: this.validReps,
      targetReps: this.targetReps,
      restRemainingMs: this.phase === 'rest' ? Math.max(0, this.restUntil - t) : 0,
      missingFingers: this.missingFingers(),
      progress: Math.min(1, this.progressFraction()),
    };
    if (this.phase === 'done') return { ...base, message: this.endReason === 'completed' ? 'Esercizio completato' : 'Esercizio terminato', detail: this.endReason === 'attempt_limit' ? 'Raggiunto il limite di tentativi.' : undefined };
    if (this.phase === 'rest') return { ...base, message: 'Pausa: riposa la mano', detail: `Serie ${this.setIdx + 1} di ${this.sets} tra poco` };
    const missing = base.missingFingers;
    if (missing.length) return { ...base, message: `Appoggia: ${missing.map(fingerLabel).join(', ')}`, detail: this.waitingDetail() };
    return { ...base, ...this.activeMessage(t) };
  }

  progressFraction(): number { return this.validReps / this.targetReps; }

  waitingDetail(): string | undefined { return 'Metti le dita sui cerchi indicati.'; }

  result(): EngineResult {
    return {
      completionMet: this.endReason === 'completed',
      endReason: this.endReason,
      setsDone: this.endReason === 'completed' ? this.sets : this.setIdx,
      repsValid: this.validReps,
      attempts: this.attempts,
      activeMs: Math.round(this.activeMs),
      restMs: Math.round(this.restMs),
      pausedMs: Math.round(this.pausedMs),
      metrics: {
        validReps: this.validReps,
        attempts: this.attempts,
        successRate: this.attempts ? round(this.validReps / this.attempts, 4) : null,
        activeMs: Math.round(this.activeMs),
        contactLosses: this.tracker.totalLosses(),
        extraContacts: this.tracker.extraContacts,
        ...this.specificMetrics(),
      },
      reps: this.reps,
      events: this.events,
    };
  }

  mm(px: number | null): number | null {
    if (px === null || !this.setup.pxPerMm) return null;
    return round(px / this.setup.pxPerMm, 2);
  }

  // --- da implementare/ridefinire nelle sottoclassi
  restrictAssignment(): FingerId[] | undefined { return undefined; }
  isExpectedLift(_f: FingerId): boolean { return false; }
  onStart(_t: number): void {}
  onSetStart(_t: number): void {}
  onPauseReset(_t: number): void {}
  abstract missingFingers(): FingerId[];
  abstract activeMessage(t: number): { message: string; detail?: string };
  abstract onTick(t: number, dt: number): void;
  abstract onDown(f: FingerId | null, x: number, y: number, t: number): void;
  abstract onMove(f: FingerId | null, x: number, y: number, t: number): void;
  abstract onUp(f: FingerId | null, t: number, lost: boolean): void;
  abstract scene(t: number): Shape[];
  abstract specificMetrics(): Record<string, number | null>;

  /** cerchi delle dita appoggiate (comune a tutti gli esercizi) */
  fingerShapes(): Shape[] {
    const out: Shape[] = [];
    for (const c of this.tracker.contacts.values()) {
      out.push({ kind: 'circle', x: c.x, y: c.y, r: 0.045 * this.s, fill: c.finger ? 'finger' : 'error', alpha: 0.85, label: c.finger ? shortFinger(c.finger) : '?' });
    }
    return out;
  }
}

export function shortFinger(f: FingerId): string {
  return { T: 'P', I: 'I', M: 'M', R: 'A', L: 'Mi' }[f];
}

export function round(x: number, d = 3): number { const k = 10 ** d; return Math.round(x * k) / k; }
export function roundOrNull(x: number | null, d = 3): number | null { return x === null || !Number.isFinite(x) ? null : round(x, d); }
function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of keys) if (k in o) r[k] = o[k];
  return r;
}
