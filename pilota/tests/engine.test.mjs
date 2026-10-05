// Test del motore delle proposte (senza server): node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('../web/js/engine.js');

const TODAY = '2026-10-05'; // lunedì
const DAY = [{ kind: 'preparazione', start: '07:45', end: '08:00' }, { kind: 'amb', start: '08:00', end: '09:00', max: 1 },
  { kind: 'reparto', start: '09:00', end: '12:00' }, { kind: 'pausa', start: '12:00', end: '12:20' },
  { kind: 'amb', start: '12:20', end: '14:00' }, { kind: 'documentazione', start: '14:00', end: '14:30' }];
const WEEK = { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: [], 7: [] };

function base() {
  const th = ['A', 'B', 'C', 'D'].map((k, i) => ({ id: k, name: 'Fisio ' + k, active: true, sort: i, max_daily: null, activity: 'ambulatorio_reparto' }));
  return {
    categories: [{ id: 'mano', name: 'Mano', active: true, sort: 1 }, { id: 'raro', name: 'Raro', active: true, sort: 2 }],
    therapists: th,
    therapist_skills: [
      { therapist_id: 'A', category_id: 'mano', level: 'specifica' }, { therapist_id: 'A', category_id: 'raro', level: 'specifica' },
      { therapist_id: 'B', category_id: 'mano', level: 'specifica' }, { therapist_id: 'C', category_id: 'mano', level: 'abilitato' }
    ],
    shift_versions: th.map(t => ({ therapist_id: t.id, valid_from: '2026-01-01', week: WEEK })),
    day_overrides: [], closures: [{ day: '2026-11-01', label: 'Ognissanti' }, { day: '2026-12-08', label: 'Immacolata' }],
    absences: [], patients: [], cycles: [], appointments: []
  };
}
let n = 0;
function book(d, th, day, start, end, o = {}) {
  const pid = 'p' + (++n), cid = 'c' + n;
  d.patients.push({ id: pid, name: 'Paziente ' + n });
  d.cycles.push({ id: cid, patient_id: pid, category_id: o.cat || 'mano', duration: E.toMin(end) - E.toMin(start), planned_sessions: 10, status: 'attivo',
    therapist_id: th, start_time: start, weekdays: [E.weekday(day)], forecast: o.forecast || 'conclusione_confermata', priority: 'NI' });
  const a = { id: 'a' + n, cycle_id: cid, patient_id: pid, therapist_id: th, day, start_time: start, end_time: end, status: 'programmata', version: 1 };
  d.appointments.push(a);
  return a;
}
const ctxOf = d => E.makeCtx(E.normalize(d), { today: TODAY });

test('turni individuali: fasce protette, pause, documentazione e limite per fascia', () => {
  const d = base();
  book(d, 'B', TODAY, '08:00', '08:30');
  const ctx = ctxOf(d);
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '12:20', '12:50'), null);
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '09:00', '09:30').code, 'blocco');
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '13:45', '14:15').code, 'blocco', 'documentazione protetta');
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '12:00', '12:30').code, 'blocco', 'pausa protetta');
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '08:30', '09:00').code, 'max_fascia', 'un solo paziente al mattino');
  assert.equal(E.checkSlot(ctx, 'B', '2026-10-10', '12:20', '12:50').code, 'fuori_turno', 'sabato non in servizio');
  assert.equal(E.checkSlot(ctx, 'B', '2026-12-08', '12:20', '12:50').code, 'chiusura');
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '12:20', '13:05'), null, 'seduta da 45 minuti');
});

test('nuovo turno con decorrenza: vale solo dalla data indicata', () => {
  const d = base();
  d.shift_versions.push({ therapist_id: 'B', valid_from: '2026-10-12', week: { 1: [{ kind: 'amb', start: '10:00', end: '12:00' }] } });
  const ctx = ctxOf(d);
  assert.equal(E.checkSlot(ctx, 'B', TODAY, '12:20', '12:50'), null);
  assert.equal(E.checkSlot(ctx, 'B', '2026-10-12', '12:20', '12:50').code, 'fuori_turno');
  assert.equal(E.checkSlot(ctx, 'B', '2026-10-12', '10:00', '10:30'), null);
});

test('assente oggi: pazienti distribuiti tra più sostituti, prima la competenza specifica', () => {
  const d = base();
  const a1 = book(d, 'A', TODAY, '12:20', '12:50');
  const a2 = book(d, 'A', TODAY, '12:50', '13:20');
  const a3 = book(d, 'A', TODAY, '13:20', '13:50');
  book(d, 'B', TODAY, '12:50', '13:20');
  book(d, 'B', TODAY, '13:20', '13:50');
  d.absences.push({ id: 'x', therapist_id: 'A', start_date: TODAY, end_date: TODAY, cancelled: false });
  const ctx = ctxOf(d);
  const abs = d.absences[0];
  const rows = E.affectedByAbsence(ctx, abs);
  assert.deepEqual(rows.map(r => r.id), [a1.id, a2.id, a3.id]);
  const o = E.substitutionOptions(ctx, rows[0]);
  assert.deepEqual(o.sameTime.map(x => [x.therapist_id, x.level]), [['B', 'specifica'], ['C', 'abilitato']]);
  assert.ok(!o.sameTime.concat(o.otherTime).some(x => x.therapist_id === 'D'), 'non abilitato escluso');
  const plan = E.proposeDistribution(ctx, rows);
  assert.equal(plan.get(a1.id).therapist_id, 'B');
  assert.equal(plan.get(a2.id).therapist_id, 'C');
  assert.equal(plan.get(a3.id).therapist_id, 'C');
  assert.ok([...plan.values()].every(s => s.sameTime));
  assert.ok([...E.validateSelections(ctx, rows, plan).values()].every(v => v.ok));
});

test('nessun sostituto compatibile: da riprogrammare con il motivo, senza forzare', () => {
  const d = base();
  const a = book(d, 'A', TODAY, '12:20', '12:50', { cat: 'raro' });
  d.absences.push({ id: 'x', therapist_id: 'A', start_date: TODAY, end_date: TODAY, cancelled: false });
  const ctx = ctxOf(d);
  const plan = E.proposeDistribution(ctx, [ctx.appt.get(a.id)]);
  assert.equal(plan.get(a.id).action, 'da_riprogrammare');
  assert.match(plan.get(a.id).reason, /Nessun altro collega è abilitato al percorso Raro/);
});

test('cambio di orario proposto come alternativa chiaramente distinta', () => {
  const d = base();
  const a = book(d, 'A', TODAY, '12:20', '12:50');
  book(d, 'B', TODAY, '12:20', '12:50');
  book(d, 'C', TODAY, '12:20', '12:50');
  d.absences.push({ id: 'x', therapist_id: 'A', start_date: TODAY, end_date: TODAY, cancelled: false });
  const ctx = ctxOf(d);
  const o = E.substitutionOptions(ctx, ctx.appt.get(a.id));
  assert.equal(o.sameTime.length, 0);
  assert.ok(o.otherTime.length >= 1);
  assert.equal(o.otherTime[0].sameTime, false);
  assert.equal(o.otherTime[0].therapist_id, 'B', 'competenza specifica per prima anche con cambio orario');
  assert.equal(o.otherTime[0].start, '12:50');
  const plan = E.proposeDistribution(ctx, [ctx.appt.get(a.id)]);
  assert.equal(plan.get(a.id).sameTime, false);
});

test('due scelte sullo stesso posto sono alternative', () => {
  const d = base();
  const a1 = book(d, 'A', TODAY, '12:20', '12:50');
  const a2 = book(d, 'A', TODAY, '12:50', '13:20');
  const ctx = ctxOf(d);
  const sel = new Map([[a1.id, { action: 'sostituisci', therapist_id: 'B', day: TODAY, start: '12:20', end: '12:50' }],
    [a2.id, { action: 'sostituisci', therapist_id: 'B', day: TODAY, start: '12:30', end: '13:00' }]]);
  const v = E.validateSelections(ctx, [a1, a2].map(a => ctx.appt.get(a.id)), sel);
  assert.equal(v.get(a1.id).ok, false);
  assert.equal(v.get(a2.id).alternativeOf, a1.id);
  // il limite di una sola persona nella fascia del mattino vale anche tra proposte
  const b1 = book(d, 'A', '2026-10-06', '08:00', '08:30');
  const b2 = book(d, 'A', '2026-10-06', '08:30', '09:00');
  const ctx2 = ctxOf(d);
  const s2 = new Map([[b1.id, { action: 'sostituisci', therapist_id: 'B', day: '2026-10-06', start: '08:00', end: '08:30' }],
    [b2.id, { action: 'sostituisci', therapist_id: 'B', day: '2026-10-06', start: '08:30', end: '09:00' }]]);
  const v2 = E.validateSelections(ctx2, [b1, b2].map(a => ctx2.appt.get(a.id)), s2);
  assert.ok(!v2.get(b1.id).ok || !v2.get(b2.id).ok);
});

test('assenza parziale e assenza senza rientro', () => {
  const d = base();
  const early = book(d, 'A', TODAY, '08:00', '08:30');
  const late = book(d, 'A', TODAY, '12:20', '12:50');
  const next = book(d, 'A', '2026-10-12', '12:20', '12:50');
  d.absences.push({ id: 'p', therapist_id: 'A', start_date: TODAY, end_date: TODAY, start_time: '07:45', end_time: '09:00', cancelled: false });
  d.absences.push({ id: 'u', therapist_id: 'A', start_date: '2026-10-07', end_date: null, plan_until: '2026-10-09', cancelled: false });
  const ctx = ctxOf(d);
  assert.deepEqual(E.affectedByAbsence(ctx, d.absences[0]).map(a => a.id), [early.id]);
  assert.equal(E.checkSlot(ctx, 'A', TODAY, '12:50', '13:20'), null);
  assert.deepEqual(E.toVerifyAfter(ctx, d.absences[1]).map(a => a.id), [next.id]);
  assert.match(E.checkSlot(ctx, 'A', '2027-02-01', '12:20', '12:50').msg, /rientro non noto/);
  void late;
});

test('posto futuro solo probabile: non è una disponibilità certa', () => {
  const d = base();
  book(d, 'B', TODAY, '12:20', '12:50', { forecast: 'probabile_conclusione' });
  const ctx = ctxOf(d);
  assert.equal(E.checkSlot(ctx, 'B', '2026-10-12', '12:20', '12:50').code, 'probabile');
  const res = E.searchCycle(ctx, { categoryId: 'mano', duration: 30, weekdays: [1], sessions: 5, from: '2026-10-12', weeks: 1 });
  const b = res.filter(r => r.therapist_id === 'B' && r.start === '12:20');
  assert.equal(b[0].status, 'probabile');
  assert.ok(res.some(r => r.status === 'certo'));
});

test('ciclo: date ricorrenti saltando festività; conteggi senza sedute non svolte', () => {
  const d = base();
  const ctx = ctxOf(d);
  const dates = E.cycleDates(ctx, '2026-10-26', [1, 3, 5], 5);
  assert.deepEqual(dates, ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02', '2026-11-04']);
  const a = book(d, 'B', TODAY, '12:20', '12:50');
  a.status = 'assente'; a.to_recover = true;
  const ctx2 = ctxOf(d);
  const c = E.cycleCounts(ctx2, a.cycle_id);
  assert.equal(c.effettuate, 0);
  assert.equal(c.daRecuperare, 1);
  assert.equal(E.checkSlot(ctx2, 'B', TODAY, '12:20', '12:50'), null, 'il posto della seduta non svolta torna libero');
});

test('ricerca: prima competenza specifica, stesso orario per tutte le date', () => {
  const d = base();
  book(d, 'B', '2026-10-14', '12:20', '12:50');
  const ctx = ctxOf(d);
  const res = E.searchCycle(ctx, { categoryId: 'mano', duration: 30, weekdays: [1, 3, 5], sessions: 10, from: TODAY });
  assert.ok(res.length);
  assert.equal(res[0].level, 'specifica');
  const idx = res.findIndex(r => r.level === 'abilitato');
  assert.ok(res.slice(idx).every(r => r.level === 'abilitato'));
  assert.ok(!res.some(r => r.therapist_id === 'B' && r.start === '12:20' && r.firstDate <= '2026-10-14'), 'un buco solo in alcune date non basta');
  res.filter(r => r.status === 'certo').forEach(r => r.dates.forEach(dd => assert.equal(E.checkSlot(ctx, r.therapist_id, dd, r.start, r.end), null)));
});
