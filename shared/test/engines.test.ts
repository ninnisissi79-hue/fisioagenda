import { describe, expect, it } from 'vitest';
import { PinchEngine, SlideEngine, PianoEngine, PathEngine, ChaseEngine, ContactTracker, createEngine } from '../src/engines/index.ts';
import type { EngineSetup } from '../src/engines/base.ts';
import { Sim } from './sim.ts';

const area = { w: 1000, h: 600 }; // lato corto = 600 px
const now = new Date().toISOString();

function setup(over: Partial<EngineSetup>): EngineSetup {
  return {
    exerciseId: 'pinch', hand: 'right', fingers: ['T', 'I'], params: {}, area,
    anchors: { T: { x: 300, y: 450 }, I: { x: 500, y: 200 }, M: { x: 600, y: 180 }, R: { x: 700, y: 210 } },
    comfort: null, pxPerMm: null, seed: 42, ...over,
  };
}

describe('ContactTracker', () => {
  it('associa i contatti alle dita per vicinanza, non per identificativo del puntatore', () => {
    const tr = new ContactTracker(['T', 'I'], { T: { x: 100, y: 100 }, I: { x: 400, y: 100 } }, 120);
    expect(tr.down(7, 390, 110, 0).finger).toBe('I');
    expect(tr.down(3, 110, 90, 0).finger).toBe('T');
    tr.up(7);
    // lo stesso dito ricompare con un identificativo diverso vicino all'ultima posizione nota
    expect(tr.down(99, 405, 100, 10).finger).toBe('I');
    expect(tr.recontacts).toBe(1);
    expect(tr.losses.I).toBe(1);
    // un contatto lontano non viene attribuito
    expect(tr.down(5, 900, 500, 10).finger).toBeNull();
    expect(tr.extraContacts).toBe(1);
  });

  it('non assegna due contatti allo stesso dito', () => {
    const tr = new ContactTracker(['I'], { I: { x: 100, y: 100 } }, 200);
    expect(tr.down(1, 100, 100, 0).finger).toBe('I');
    expect(tr.down(2, 110, 100, 0).finger).toBeNull();
  });
});

describe('Pinza sul piano', () => {
  const anchors = { T: { x: 300, y: 300 }, I: { x: 600, y: 300 } };
  const comfort = { exerciseId: 'pinch', kind: 'distance' as const, fingers: ['T', 'I'] as any, minDist: 0.1, maxDist: 0.5, approvedAt: now };
  it('conta solo ripetizioni complete (chiusura, mantenimento, apertura)', () => {
    const e = new PinchEngine(setup({ anchors, params: { sets: 1, reps: 2, restSec: 0, amplitude: 1, tolerance: 0.02, holdMs: 200, maxRepSec: 10 }, comfort }));
    // intervallo approvato 0.1–0.5 u = 60–300 px; con ampiezza 1 → chiusura 60, apertura 300
    expect(Math.round(e.closeT)).toBe(60);
    expect(Math.round(e.openT)).toBe(300);
    const s = new Sim(e);
    s.down(1, 300, 300); s.down(2, 600, 300); // distanza 300
    expect(e.phase).toBe('active');
    for (let r = 0; r < 2; r++) {
      s.moveTo({ 1: { x: 420, y: 300 }, 2: { x: 480, y: 300 } }, 400); // distanza 60
      s.wait(250);
      s.moveTo({ 1: { x: 300, y: 300 }, 2: { x: 600, y: 300 } }, 400);
    }
    expect(e.phase).toBe('done');
    const res = e.result();
    expect(res.completionMet).toBe(true);
    expect(res.metrics.validReps).toBe(2);
    expect(res.metrics.successRate).toBe(1);
    expect(res.metrics.minDistanceU).toBeCloseTo(0.1, 2);
    expect(res.metrics.meanRangeMm).toBeNull(); // nessuna calibrazione fisica
    expect(res.metrics.meanRangeU).toBeCloseTo(0.4, 1);
  });

  it('senza mantenimento sufficiente la ripetizione non è conteggiata', () => {
    const e = new PinchEngine(setup({ anchors, params: { sets: 1, reps: 1, restSec: 0, amplitude: 1, tolerance: 0.02, holdMs: 1000, maxRepSec: 10 }, comfort }));
    const s = new Sim(e);
    s.down(1, 300, 300); s.down(2, 600, 300);
    s.moveTo({ 1: { x: 420, y: 300 }, 2: { x: 480, y: 300 } }, 300);
    s.moveTo({ 1: { x: 300, y: 300 }, 2: { x: 600, y: 300 } }, 300);
    expect(e.validReps).toBe(0);
  });

  it('la perdita di un contatto invalida la ripetizione e attende il riappoggio', () => {
    const e = new PinchEngine(setup({ anchors, params: { sets: 1, reps: 1, restSec: 0, amplitude: 1, tolerance: 0.02, holdMs: 0, maxRepSec: 10 }, comfort }));
    const s = new Sim(e);
    s.down(1, 300, 300); s.down(2, 600, 300);
    s.moveTo({ 1: { x: 350, y: 300 } }, 100);
    s.up(2);
    expect(e.phase).toBe('waiting');
    expect(e.attempts).toBe(1);
    expect(e.status(s.t).missingFingers).toEqual(['I']);
    // ricompare con un nuovo id vicino all'ultima posizione
    s.down(8, 590, 305);
    expect(e.tracker.fingerDown('I')?.pointerId).toBe(8);
    s.moveTo({ 1: { x: 300, y: 300 }, 8: { x: 600, y: 300 } }, 100);
    s.moveTo({ 1: { x: 420, y: 300 }, 8: { x: 480, y: 300 } }, 300);
    s.moveTo({ 1: { x: 300, y: 300 }, 8: { x: 600, y: 300 } }, 300);
    expect(e.validReps).toBe(1);
    const r = e.result();
    expect(r.metrics.contactLosses).toBe(1);
    expect(r.metrics.successRate).toBe(0.5);
  });

  it('il tempo attivo esclude pause e riposo tra le serie', () => {
    const e = new PinchEngine(setup({ anchors, params: { sets: 2, reps: 1, restSec: 5, amplitude: 1, tolerance: 0.02, holdMs: 0, maxRepSec: 10 }, comfort }));
    const s = new Sim(e);
    s.down(1, 300, 300); s.down(2, 600, 300);
    e.pause(s.t, 'user'); s.wait(3000); e.resume(s.t);
    s.moveTo({ 1: { x: 420, y: 300 }, 2: { x: 480, y: 300 } }, 400);
    s.moveTo({ 1: { x: 300, y: 300 }, 2: { x: 600, y: 300 } }, 400);
    expect(e.phase).toBe('rest');
    s.wait(5100);
    expect(e.phase).not.toBe('rest');
    s.moveTo({ 1: { x: 420, y: 300 }, 2: { x: 480, y: 300 } }, 400);
    s.moveTo({ 1: { x: 300, y: 300 }, 2: { x: 600, y: 300 } }, 400);
    const r = e.result();
    expect(r.completionMet).toBe(true);
    expect(r.pausedMs).toBeGreaterThanOrEqual(2990);
    expect(r.restMs).toBeGreaterThanOrEqual(4990);
    expect(r.activeMs).toBeLessThan(2500);
  });

  it('il limite di tentativi termina l\'esercizio senza segnarlo come completato', () => {
    const e = new PinchEngine(setup({ anchors, params: { sets: 1, reps: 1, restSec: 0, amplitude: 1, tolerance: 0.02, holdMs: 0, maxRepSec: 3 }, comfort }));
    const s = new Sim(e);
    s.down(1, 300, 300); s.down(2, 600, 300);
    s.wait(3100); s.wait(3100);
    expect(e.phase).toBe('done');
    expect(e.result().completionMet).toBe(false);
    expect(e.result().endReason).toBe('attempt_limit');
  });

  it('con calibrazione fisica riporta anche i millimetri', () => {
    const e = new PinchEngine(setup({ anchors, params: { sets: 1, reps: 1, restSec: 0, amplitude: 1, tolerance: 0.02, holdMs: 0, maxRepSec: 10 }, comfort, pxPerMm: 4 }));
    const s = new Sim(e);
    s.down(1, 300, 300); s.down(2, 600, 300);
    s.moveTo({ 1: { x: 420, y: 300 }, 2: { x: 480, y: 300 } }, 300);
    s.moveTo({ 1: { x: 300, y: 300 }, 2: { x: 600, y: 300 } }, 300);
    expect(e.result().metrics.meanRangeMm).toBeCloseTo(60, 0); // 240 px / 4
  });
});

describe('Scorrimento di un dito', () => {
  const comfort = { exerciseId: 'slide', kind: 'segment' as const, fingers: ['I'] as any, start: { x: 0.5, y: 0.6 }, end: { x: 0.5, y: 0.1 }, approvedAt: now };
  it('ripetizione valida andata e ritorno con dito fermo in zona', () => {
    const e = new SlideEngine(setup({ exerciseId: 'slide', fingers: ['I', 'T'], params: { sets: 1, reps: 1, restSec: 0, amplitude: 1, targetRadius: 0.05, zoneRadius: 0.1, requireStabilizers: true, maxRepSec: 10 }, comfort }));
    const s = new Sim(e);
    s.down(1, 300, 360); // vicino → assegnato a I (ancora = near) 
    s.down(2, 300, 450); // pollice sulla sua zona
    expect(e.tracker.fingerDown('I')?.pointerId).toBe(1);
    expect(e.tracker.fingerDown('T')?.pointerId).toBe(2);
    s.moveTo({ 1: { x: 300, y: 60 } }, 500);
    s.moveTo({ 1: { x: 300, y: 360 } }, 500);
    const r = e.result();
    expect(r.completionMet).toBe(true);
    expect(r.metrics.stabilizerExits).toBe(0);
    expect(r.metrics.meanDeviationU).toBeCloseTo(0, 3);
  });

  it('uscita del dito fermo dalla zona rende la ripetizione non valida', () => {
    const e = new SlideEngine(setup({ exerciseId: 'slide', fingers: ['I', 'T'], params: { sets: 1, reps: 1, restSec: 0, amplitude: 1, targetRadius: 0.05, zoneRadius: 0.1, requireStabilizers: true, maxRepSec: 10 }, comfort }));
    const s = new Sim(e);
    s.down(1, 300, 360); s.down(2, 300, 450);
    s.moveTo({ 1: { x: 300, y: 60 }, 2: { x: 450, y: 450 } }, 500);
    s.moveTo({ 1: { x: 300, y: 360 } }, 500);
    expect(e.validReps).toBe(0);
    expect(e.attempts).toBe(1);
    expect(e.result().metrics.stabilizerExits).toBe(1);
  });
});

describe('Pianoforte', () => {
  it('risposte corrette, dito sbagliato e omissione', () => {
    const e = new PianoEngine(setup({ exerciseId: 'piano', fingers: ['I', 'M', 'R'], params: { sets: 1, reps: 2, restSec: 0, responseSec: 2, zoneRadius: 0.08, order: 'sequence' } }));
    const s = new Sim(e);
    s.down(1, 500, 200); s.down(2, 600, 180); s.down(3, 700, 210);
    s.wait(1000);
    expect(e.cueFinger).toBe('I');
    s.up(1); s.wait(200); s.down(11, 505, 205); // corretto
    expect(e.validReps).toBe(1);
    s.wait(1000);
    expect(e.cueFinger).toBe('M');
    s.up(3); // dito sbagliato
    expect(e.validReps).toBe(1);
    s.down(13, 700, 210);
    s.wait(1000);
    expect(e.cueFinger).toBe('R');
    s.wait(2100); // omissione
    s.wait(1000);
    expect(e.cueFinger).toBe('I');
    s.up(11); s.wait(300); s.down(21, 500, 200);
    const r = e.result();
    expect(r.completionMet).toBe(true);
    expect(r.metrics.validReps).toBe(2);
    expect(r.metrics.wrongLifts).toBe(1);
    expect(r.metrics.omissions).toBe(1);
    expect(r.metrics.attempts).toBe(4);
    // il sollevamento richiesto non è un contatto perso; quello sbagliato sì
    expect(r.metrics.contactLosses).toBe(1);
    expect(r.metrics.meanReactionMs).not.toBeNull();
  });

  it('ordine casuale riproducibile con lo stesso seme', () => {
    const seq = (seed: number) => {
      const e = new PianoEngine(setup({ exerciseId: 'piano', fingers: ['I', 'M', 'R'], params: { order: 'random' }, seed }));
      return Array.from({ length: 8 }, () => { const f = e.nextCue(); e.cueFinger = f; return f; }).join('');
    };
    expect(seq(7)).toBe(seq(7));
  });
});

describe('Segui la strada', () => {
  it('percorso completato dentro il tracciato e alternanza della direzione', () => {
    const comfort = { exerciseId: 'path', kind: 'region' as const, fingers: ['I'] as any, rect: { x: 0.2, y: 0.2, w: 1, h: 0.6 }, approvedAt: now };
    const e = new PathEngine(setup({ exerciseId: 'path', fingers: ['I'], params: { sets: 1, reps: 2, restSec: 0, pathType: 'wave', amplitude: 1, corridor: 0.1, minInCorridor: 0.8, maxRepSec: 30 }, comfort }));
    const s = new Sim(e);
    const fwd = e.forward;
    s.down(1, fwd[0].x, fwd[0].y);
    s.follow(1, fwd.slice(1), 20);
    expect(e.validReps).toBe(1);
    const back = e.current();
    expect(back[0]).toEqual(fwd[fwd.length - 1]);
    s.follow(1, back.slice(1), 20);
    const r = e.result();
    expect(r.completionMet).toBe(true);
    expect(r.metrics.inCorridorRatio).toBeGreaterThan(0.95);
    expect(r.metrics.corridorExits).toBe(0);
  });

  it('una scorciatoia fuori strada non fa avanzare il percorso', () => {
    const comfort = { exerciseId: 'path', kind: 'region' as const, fingers: ['I'] as any, rect: { x: 0.2, y: 0.2, w: 1, h: 0.6 }, approvedAt: now };
    const e = new PathEngine(setup({ exerciseId: 'path', fingers: ['I'], params: { sets: 1, reps: 1, restSec: 0, pathType: 'curve', amplitude: 1, corridor: 0.08, minInCorridor: 0.7, maxRepSec: 30 }, comfort }));
    const s = new Sim(e);
    const p = e.forward;
    s.down(1, p[0].x, p[0].y);
    s.moveTo({ 1: p[p.length - 1] }, 600); // linea retta tra partenza e arrivo
    s.wait(100);
    expect(e.validReps).toBe(0);
    expect(e.progress).toBeLessThan(p.length / 2);
  });

  it('la strada della mano sinistra è speculare', () => {
    const comfort = { exerciseId: 'path', kind: 'region' as const, fingers: ['I'] as any, rect: { x: 0, y: 0, w: 1, h: 1 }, approvedAt: now };
    const r = new PathEngine(setup({ exerciseId: 'path', fingers: ['I'], params: { pathType: 'curve', amplitude: 1 }, comfort }));
    const l = new PathEngine(setup({ exerciseId: 'path', hand: 'left', fingers: ['I'], params: { pathType: 'curve', amplitude: 1 }, comfort }));
    expect(l.forward[0].x).toBeCloseTo(600 - r.forward[0].x, 5);
  });
});

describe('Insegui il bersaglio', () => {
  it('il tempo con dito sollevato non conta e il bersaglio aspetta', () => {
    const comfort = { exerciseId: 'chase', kind: 'region' as const, fingers: ['I'] as any, rect: { x: 0.2, y: 0.2, w: 1, h: 0.6 }, approvedAt: now };
    const e = new ChaseEngine(setup({ exerciseId: 'chase', fingers: ['I'], params: { sets: 1, durationSec: 2, restSec: 0, speed: 0.1, targetRadius: 0.08, amplitude: 1 }, comfort }));
    const s = new Sim(e);
    const t0 = e.target();
    s.down(1, t0.x, t0.y);
    for (let i = 0; i < 60; i++) { const p = e.target(); s.moveTo({ 1: p }, 16); }
    s.up(1);
    const frozen = e.target();
    s.wait(2000);
    expect(e.target()).toEqual(frozen);
    s.down(2, frozen.x, frozen.y);
    for (let i = 0; i < 100 && e.phase !== 'done'; i++) { const p = e.target(); s.moveTo({ 2: p }, 16); }
    const r = e.result();
    expect(r.completionMet).toBe(true);
    expect(r.metrics.trackingMs).toBeGreaterThanOrEqual(2000);
    expect(r.metrics.trackingMs).toBeLessThan(2200);
    expect(r.metrics.onTargetRatio).toBeGreaterThan(0.9);
    expect(r.metrics.contactLosses).toBe(1);
  });
});

describe('createEngine', () => {
  it('rifiuta esercizi non disponibili', () => {
    expect(() => createEngine(setup({ exerciseId: 'rotate' }))).toThrow();
  });
});
