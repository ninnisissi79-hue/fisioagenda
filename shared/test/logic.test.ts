import { describe, expect, it } from 'vitest';
import { computeAdherence } from '../src/adherence.ts';
import { effectiveVersionAt, validateProgramItems, diffVersions } from '../src/program.ts';
import { computeProgression } from '../src/progression.ts';
import { CATALOG, getExercise, normalizeParams, validateFingers } from '../src/catalog.ts';
import { comparabilityIssues } from '../src/comparability.ts';
import { toCsv, parseCsv } from '../src/csv.ts';
import { addDays, weekday, dayRange } from '../src/dates.ts';
import type { ProgramItem, ProgramVersion, ExerciseRun } from '../src/types.ts';

const item = (over: Partial<ProgramItem> = {}): ProgramItem => ({
  itemId: 'item-pinch-1', exerciseId: 'pinch', exerciseVersion: '1.0.0', mode: 'training', status: 'active', hand: 'right',
  fingers: ['T', 'I'], params: { sets: 2, reps: 8 }, frequency: { timesPerDay: 1, days: [0, 1, 2, 3, 4, 5, 6] }, progression: null, ...over,
});
const version = (v: number, from: string, items: ProgramItem[]): ProgramVersion => ({
  id: `pv-${v}-xxxxxx`, patientId: 'p', version: v, effectiveFrom: from, createdAt: '', createdBy: '', changeNote: '', restBetweenExercisesSec: 30, items,
});

describe('date', () => {
  it('aritmetica dei giorni', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(weekday('2026-10-11')).toBe(0); // domenica
    expect(dayRange('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('versioni del programma', () => {
  it('sceglie la versione in vigore per data di decorrenza', () => {
    const vs = [version(1, '2026-10-01', []), version(2, '2026-10-10', [])];
    expect(effectiveVersionAt(vs, '2026-09-30')).toBeNull();
    expect(effectiveVersionAt(vs, '2026-10-05')?.version).toBe(1);
    expect(effectiveVersionAt(vs, '2026-10-10')?.version).toBe(2);
  });

  it('valida dita, parametri e progressione', () => {
    expect(validateProgramItems([item()])).toEqual([]);
    expect(validateProgramItems([item({ fingers: ['I', 'M'] })]).join()).toMatch(/pollice/);
    expect(validateProgramItems([item({ params: { sets: 99 } })]).join()).toMatch(/massimo/);
    expect(validateProgramItems([item({ exerciseId: 'rotate' })]).join()).toMatch(/non è ancora disponibile/);
    const prog = { enabled: true, param: 'amplitude', step: 0.1, limit: 1.2, windowRuns: 3, upThreshold: 0.8, downThreshold: null };
    expect(validateProgramItems([item({ params: { amplitude: 0.5 }, progression: prog })]).join()).toMatch(/limite fuori/);
    expect(validateProgramItems([item({ params: { amplitude: 0.5 }, progression: { ...prog, param: 'sets' } })]).join()).toMatch(/non ammesso/);
  });

  it('differenze tra versioni', () => {
    const a = version(1, '2026-10-01', [item(), item({ itemId: 'item-path-1', exerciseId: 'path', fingers: ['I'] })]);
    const b = version(2, '2026-10-05', [item({ params: { sets: 3, reps: 8 } }), item({ itemId: 'item-chase-1', exerciseId: 'chase', fingers: ['I'] })]);
    const d = diffVersions(a, b);
    expect(d.find((c) => c.itemId === 'item-pinch-1')).toMatchObject({ kind: 'modified', fields: ['sets'] });
    expect(d.find((c) => c.itemId === 'item-chase-1')?.kind).toBe('added');
    expect(d.find((c) => c.itemId === 'item-path-1')?.kind).toBe('removed');
  });
});

describe('aderenza', () => {
  const run = (date: string, status: ExerciseRun['status'], itemId = 'item-pinch-1') => ({ programItemId: itemId, exerciseId: 'pinch', localDate: date, status });

  it('distingue completato, interrotto, non effettuato e nessuna attività ricevuta', () => {
    const vs = [version(1, '2026-10-01', [item()])];
    const rep = computeAdherence({
      versions: vs, from: '2026-10-01', to: '2026-10-07', today: '2026-10-06', confirmedThrough: '2026-10-03',
      runs: [run('2026-10-01', 'completed'), run('2026-10-02', 'interrupted'), run('2026-10-02', 'started')],
    });
    const st = Object.fromEntries(rep.cells.map((c) => [c.date, c.state]));
    expect(st['2026-10-01']).toBe('completed');
    expect(st['2026-10-02']).toBe('interrupted');
    expect(st['2026-10-03']).toBe('not_done');      // confermato dalla sincronizzazione
    expect(st['2026-10-04']).toBe('pending_sync');  // potrebbe esserci attività non ancora ricevuta
    expect(st['2026-10-05']).toBe('pending_sync');
    expect(st['2026-10-06']).toBe('due');
    expect(st['2026-10-07']).toBe('future');
    expect(rep.items[0].prescribed).toBe(6);
    expect(rep.items[0].completedWithinPrescription).toBe(1);
    expect(rep.items[0].interrupted).toBe(1);
    expect(rep.items[0].started).toBe(1);
    expect(rep.totals.notDone).toBe(1);
    expect(rep.totals.pending).toBe(2);
  });

  it('rispetta giorni prescritti, sospensioni e decorrenza delle modifiche', () => {
    const v1 = version(1, '2026-10-01', [item({ frequency: { timesPerDay: 2, days: [1, 3, 5] } })]); // lun mer ven
    const v2 = version(2, '2026-10-08', [item({ status: 'suspended' })]);
    const rep = computeAdherence({ versions: [v1, v2], runs: [run('2026-10-05', 'completed'), run('2026-10-05', 'completed'), run('2026-10-05', 'completed')], from: '2026-10-01', to: '2026-10-10', today: '2026-10-10', confirmedThrough: '2026-10-09' });
    // lun 5, mer 7 (ven 2 e 9: il 9 è sospeso, il 2 previsto)
    expect(rep.items[0].prescribed).toBe(6); // 2 (ven 2) + 2 (lun 5) + 2 (mer 7)
    expect(rep.items[0].completedTotal).toBe(3);
    expect(rep.items[0].completedWithinPrescription).toBe(2); // eccedenza non aumenta l'aderenza
    expect(rep.cells.find((c) => c.date === '2026-10-09')?.state).toBe('not_prescribed');
  });

  it('le esecuzioni di una versione precedente restano visibili', () => {
    const v1 = version(1, '2026-10-01', [item()]);
    const v2 = version(2, '2026-10-03', [item({ itemId: 'item-new-1' })]);
    const rep = computeAdherence({ versions: [v1, v2], runs: [run('2026-10-03', 'completed', 'item-pinch-1')], from: '2026-10-01', to: '2026-10-03', today: '2026-10-03', confirmedThrough: null });
    const old = rep.cells.find((c) => c.date === '2026-10-03' && c.itemId === 'item-pinch-1');
    expect(old?.state).toBe('extra');
  });
});

describe('progressione automatica', () => {
  const def = getExercise('pinch')!.params.find((p) => p.key === 'amplitude');
  const rule = { enabled: true, param: 'amplitude', step: 0.1, limit: 0.8, windowRuns: 2, upThreshold: 0.8, downThreshold: 0.4 };
  it('sale solo con esecuzioni completate sopra soglia e non supera il limite autorizzato', () => {
    const h = (level: number, sr: number, completed = true) => ({ level, successRate: sr, completed });
    expect(computeProgression(rule, 0.6, def, [])?.value).toBe(0.6);
    expect(computeProgression(rule, 0.6, def, [h(0, 0.9), h(0, 0.9)])?.value).toBe(0.7);
    expect(computeProgression(rule, 0.6, def, [h(0, 0.9), h(0, 0.9, false)])?.value).toBe(0.6);
    const many = [h(0, 1), h(0, 1), h(1, 1), h(1, 1), h(2, 1), h(2, 1), h(2, 1), h(2, 1)];
    const p = computeProgression(rule, 0.6, def, many)!;
    expect(p.value).toBe(0.8);
    expect(p.level).toBe(2);
    expect(p.reason).toMatch(/limite autorizzato/);
  });
  it('scende sotto la soglia inferiore', () => {
    const p = computeProgression(rule, 0.6, def, [{ level: 0, successRate: 1, completed: true }, { level: 0, successRate: 1, completed: true }, { level: 1, successRate: 0.2, completed: true }])!;
    expect(p.level).toBe(0);
  });
  it('l\'ampiezza non supera mai 1 (area approvata)', () => {
    const p = computeProgression({ ...rule, limit: 1, step: 0.5, windowRuns: 1 }, 0.9, def, [{ level: 0, successRate: 1, completed: true }, { level: 1, successRate: 1, completed: true }])!;
    expect(p.value).toBe(1);
  });
  it('disattivata = nessuna modifica', () => {
    expect(computeProgression({ ...rule, enabled: false }, 0.6, def, [])).toBeNull();
  });
});

describe('catalogo', () => {
  it('cinque esercizi disponibili e gli altri segnalati come non disponibili', () => {
    expect(CATALOG.filter((e: any) => e.status === 'available').map((e: any) => e.id)).toEqual(['pinch', 'slide', 'piano', 'path', 'chase']);
    expect(CATALOG.filter((e: any) => e.status === 'planned')).toHaveLength(8);
  });
  it('normalizza i parametri', () => {
    const def = getExercise('path')!;
    const r = normalizeParams(def, { pathType: 'nonexistent', corridor: '0.1' as any });
    expect(r.errors.length).toBe(1);
    expect(r.params.corridor).toBe(0.1);
    expect(validateFingers(def, ['I', 'M'])).toMatch(/Al massimo/);
  });
});

describe('confrontabilità', () => {
  const base: any = { exerciseId: 'pinch', exerciseVersion: '1.0.0', metricsVersion: '1.0.0', mode: 'training', hand: 'right', fingers: ['T', 'I'], params: { amplitude: 0.6, tolerance: 0.04, sets: 2 }, calibrationId: 'c1', area: { w: 1000, h: 700 }, device: { deviceId: 'd1' } };
  it('segnala differenze di difficoltà, taratura, dispositivo e modalità', () => {
    expect(comparabilityIssues(base, { ...base, params: { ...base.params, sets: 5 } })).toEqual([]);
    const other = { ...base, mode: 'assessment', params: { ...base.params, amplitude: 0.8 }, calibrationId: 'c2', device: { deviceId: 'd2' } };
    const issues = comparabilityIssues(base, other).join(' | ');
    expect(issues).toMatch(/condizioni fisse/);
    expect(issues).toMatch(/amplitude/);
    expect(issues).toMatch(/Taratura/);
    expect(issues).toMatch(/Tablet/);
  });
});

describe('CSV', () => {
  it('andata e ritorno con separatore, virgolette e a capo', () => {
    const rows = [{ a: 'x;y', b: 'he said "hi"', c: 'l1\nl2', d: 0, e: null }];
    const parsed = parseCsv(toCsv(rows, ['a', 'b', 'c', 'd', 'e']));
    expect(parsed[0]).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(parsed[1]).toEqual(['x;y', 'he said "hi"', 'l1\nl2', '0', '']);
  });
});
