/* Test del motore di disponibilità: node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');

const TODAY = '2026-10-05'; // lunedì
const O = { today: TODAY };

function baseState() {
  const settings = E.clone(E.DEFAULT_SETTINGS);
  const th = (id, profile, comp, ido, variant) => ({
    id, name: 'Collega ' + id, profile, competenze: comp, idoneita: ido,
    week: E.buildWeek(profile, settings, variant), exceptions: [], maxPatientsDay: null
  });
  return {
    settings,
    categories: [{ id: 'orto', name: 'Ortopedia' }, { id: 'neuro', name: 'Neurologico' }, { id: 'linf', name: 'Linfedema' }],
    therapists: [th('T7', 'reparto7', ['orto'], ['neuro']), th('T8', 'reparto8', ['neuro'], ['orto']), th('TA', 'ambulatorio', [], ['neuro'])],
    closures: [], absences: [], patients: [], paths: [], cycles: [], sessions: [], waitlist: [], log: []
  };
}
function book(st, a) {
  return E.bookCycle(st, Object.assign({ patientName: 'Paz ' + Math.random().toString(36).slice(2, 6), categoryId: 'orto', duration: 30, sessions: 10 }, a), O);
}
/** Seduta singola "chiusa" (conclusione confermata), utile per riempire un orario in una data. */
function single(st, thId, date, start, duration) {
  const r = book(st, { therapistId: thId, weekdays: [E.weekday(date)], startTime: start, startDate: date, sessions: 1, duration: duration || 30, categoryId: thId === 'TA' ? 'neuro' : 'orto' });
  const s2 = E.setForecast(r.state, r.pathId, { state: 'conclusione_confermata' }, O).state;
  return s2;
}
const check = (st, thId, date, start, dur, opts) => {
  const ctx = E.makeContext(st, O);
  return E.checkSlot(ctx, ctx.therapists.get(thId), date, E.toMin(start), dur, opts);
};

/* ---------------- durate e spazi ---------------- */
test('uno spazio di 30 minuti non ospita una seduta da 45', () => {
  let st = baseState();
  st = single(st, 'T8', '2026-10-12', '12:40');
  st = single(st, 'T8', '2026-10-12', '13:40');
  assert.equal(check(st, 'T8', '2026-10-12', '13:10', 45).status, 'fail');
  assert.equal(check(st, 'T8', '2026-10-12', '13:10', 30).status, 'ok');
});

test('un appuntamento può iniziare esattamente quando finisce il precedente', () => {
  let st = baseState();
  st = single(st, 'T8', '2026-10-12', '12:40');
  assert.equal(check(st, 'T8', '2026-10-12', '13:10', 30).status, 'ok');
  assert.equal(check(st, 'T8', '2026-10-12', '13:05', 30).status, 'fail', 'sovrapposizione di 5 minuti');
});

test('nessuna sovrapposizione con reparto, pausa o cartelle', () => {
  const st = baseState();
  const r1 = check(st, 'T7', '2026-10-12', '08:45', 30); // sconfinerebbe oltre le 9
  assert.equal(r1.status, 'fail'); assert.equal(r1.code, 'protetto');
  assert.equal(check(st, 'T7', '2026-10-12', '08:30', 30).status, 'ok', 'termina alle 9:00 esatte');
  assert.equal(check(st, 'T7', '2026-10-12', '08:15', 45).status, 'ok');
  assert.equal(check(st, 'T7', '2026-10-12', '10:00', 30).code, 'protetto', 'reparto');
  assert.equal(check(st, 'T7', '2026-10-12', '12:00', 30).code, 'protetto', 'pausa 12:00–12:20');
  assert.equal(check(st, 'T7', '2026-10-12', '12:20', 30).status, 'ok', 'ripresa 12:20');
  assert.equal(check(st, 'TA', '2026-10-12', '14:00', 30).code, 'protetto', 'cartelle a fine turno');
  assert.equal(check(st, 'T7', '2026-10-12', '13:55', 30).status, 'fail', 'oltre la fine turno 14:12');
  assert.equal(check(st, 'T7', '2026-10-12', '07:00', 30).code, 'protetto', 'primo paziente alle 7:15');
  assert.equal(check(st, 'T7', '2026-10-12', '07:15', 30).status, 'ok');
  assert.equal(check(st, 'T8', '2026-10-12', '12:30', 30).code, 'protetto', 'pausa sfalsata 12:20–12:40');
  assert.equal(check(st, 'TA', '2026-10-12', '10:00', 30).status, 'ok', 'solo ambulatorio: niente reparto');
});

test('nessuna estensione supera la fine del turno o cancella un blocco protetto', () => {
  const st = baseState();
  const r = check(st, 'T8', '2026-10-12', '14:45', 30); // 14:45–15:15 > fine estensione 15:00
  assert.equal(r.status, 'fail');
  assert.equal(check(st, 'T8', '2026-10-12', '15:00', 30).status, 'fail');
  // la scheda non è stata modificata
  assert.ok(st.therapists[1].week[1].blocks.some(b => b.type === 'cartelle' && b.start === '15:00'));
});

/* ---------------- cicli ---------------- */
test('un buco presente solo il lunedì non basta per un ciclo lun-mer-ven', () => {
  let st = baseState();
  st = single(st, 'T8', '2026-10-14', '12:40'); // mercoledì occupato
  const ctx = E.makeContext(st, O);
  const { dates } = E.cycleDates(ctx, '2026-10-12', [1, 3, 5], 10);
  const ev = E.evaluateCycle(ctx, ctx.therapists.get('T8'), dates, E.toMin('12:40'), 30);
  assert.equal(ev.status, 'fail');
  assert.equal(ev.firstFail.date, '2026-10-14');
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
  const g = res.groups.find(x => x.therapist.id === 'T8');
  const at1240 = g.options.filter(o => o.start === E.toMin('12:40'));
  assert.ok(at1240.every(o => o.startDate > '2026-10-14'), 'alle 12:40 il ciclo può iniziare solo dopo il mercoledì occupato');
});

test('tutte le date del ciclo sono controllate (anche la decima)', () => {
  let st = baseState();
  const ctx0 = E.makeContext(st, O);
  const { dates } = E.cycleDates(ctx0, '2026-10-12', [1, 3, 5], 10);
  st = single(st, 'T8', dates[9], '12:40');
  const ctx = E.makeContext(st, O);
  const ev = E.evaluateCycle(ctx, ctx.therapists.get('T8'), dates, E.toMin('12:40'), 30);
  assert.equal(ev.status, 'fail');
  assert.equal(ev.firstFail.date, dates[9]);
});

test('festività e chiusure sono rispettate (saltate e non contate)', () => {
  const st = baseState();
  st.closures.push({ date: '2026-12-08', label: 'Immacolata' }, { date: '2026-11-02', label: 'Chiusura servizio' });
  const ctx = E.makeContext(st, O);
  const { dates, skipped } = E.cycleDates(ctx, '2026-12-01', [2, 4], 5);
  assert.deepEqual(dates, ['2026-12-01', '2026-12-03', '2026-12-10', '2026-12-15', '2026-12-17']);
  assert.deepEqual(skipped.map(s => s.date), ['2026-12-08']);
  assert.equal(check(st, 'T8', '2026-11-02', '12:40', 30).code, 'chiusura');
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-11-02' }, O);
  res.groups.forEach(g => g.options.forEach(o => assert.ok(!o.dates.includes('2026-11-02'))));
});

test('cambio dell\'ora (25/10/2026): l\'orario non si sposta e le date sono corrette', () => {
  assert.equal(E.addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(E.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(E.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(E.weekday('2026-10-25'), 7);
  assert.equal(E.weekday('2026-10-26'), 1);
  assert.equal(E.todayRome(new Date('2026-10-24T23:30:00Z')), '2026-10-25', 'mezzanotte e mezza a Roma');
  assert.equal(E.todayRome(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
  let st = baseState();
  const r = book(st, { therapistId: 'T7', weekdays: [1, 3, 5], startTime: '07:15', startDate: '2026-10-19', sessions: 6 });
  const ss = r.state.sessions.filter(s => s.pathId === r.pathId);
  assert.deepEqual(ss.map(s => s.date), ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30']);
  assert.ok(ss.every(s => s.start === '07:15'));
});

/* ---------------- gruppo delle 8 e calcoli in minuti ---------------- */
test('il gruppo delle 8 ha un solo paziente mattutino (30 termina 8:45, 45 termina 9:00)', () => {
  let st = baseState();
  assert.equal(check(st, 'T8', '2026-10-12', '08:15', 30).status, 'ok');
  assert.equal(check(st, 'T8', '2026-10-12', '08:15', 45).status, 'ok');
  assert.equal(E.fromMin(E.toMin('08:15') + 45), '09:00');
  // giornata con fascia mattutina più lunga, ma sempre max 1 paziente
  const t8 = st.therapists.find(t => t.id === 'T8');
  const day = E.clone(t8.week[1]);
  day.blocks = day.blocks.map(b => b.type === 'amb' && b.start === '08:15' ? Object.assign(b, { end: '09:30' }) : b.type === 'reparto' ? Object.assign(b, { start: '09:30' }) : b);
  t8.exceptions.push(Object.assign({ date: '2026-10-12' }, day));
  st = single(st, 'T8', '2026-10-12', '08:15');
  const r = check(st, 'T8', '2026-10-12', '08:45', 30);
  assert.equal(r.status, 'fail'); assert.equal(r.code, 'limite_fascia');
});

test('quattro sedute da 30 minuti dalle 12:40 terminano alle 14:40', () => {
  let st = baseState();
  ['12:40', '13:10', '13:40'].forEach(t => { st = single(st, 'T8', '2026-10-12', t); });
  const r = check(st, 'T8', '2026-10-12', '14:10', 30);
  assert.equal(r.status, 'ok');
  assert.equal(E.fromMin(E.toMin('14:10') + 30), '14:40');
});

test('una da 45 e tre da 30 dalle 12:40 terminano alle 14:55 e chiedono di verificare fascia e cartelle', () => {
  let st = baseState();
  st = single(st, 'T8', '2026-10-12', '12:40', 45);
  ['13:25', '13:55'].forEach(t => { st = single(st, 'T8', '2026-10-12', t); });
  const r = check(st, 'T8', '2026-10-12', '14:25', 30);
  assert.equal(r.status, 'ext', 'estensione da confermare, non disponibilità ordinaria');
  assert.equal(E.fromMin(r.extInfo.end), '14:55');
  assert.equal(r.extInfo.residual, 17, 'minuti fino a fine turno 15:12');
  assert.match(r.extInfo.text, /14:55.*14:45.*cartelle/);
  // e non è prenotabile senza conferma esplicita
  assert.throws(() => book(st, { therapistId: 'T8', weekdays: [1], startTime: '14:25', startDate: '2026-10-12', sessions: 1 }), /estensione/);
  assert.doesNotThrow(() => book(st, { therapistId: 'T8', weekdays: [1], startTime: '14:25', startDate: '2026-10-12', sessions: 1, acceptExtension: true }));
});

test('avviso sedute da 45: configurabile, non è un divieto e non si applica ai solo ambulatoriali', () => {
  let st = baseState();
  st = single(st, 'T8', '2026-10-12', '12:40', 45);
  st = single(st, 'T8', '2026-10-12', '13:25', 45);
  const r = check(st, 'T8', '2026-10-12', '14:10', 30);
  assert.equal(r.warnings.length, 0);
  const r45 = check(st, 'T8', '2026-10-12', '08:15', 45);
  assert.equal(r45.status, 'ok'); assert.equal(r45.warnings.length, 1);
  let sa = baseState();
  sa = single(sa, 'TA', '2026-10-12', '08:00', 45);
  sa = single(sa, 'TA', '2026-10-12', '08:45', 45);
  assert.equal(check(sa, 'TA', '2026-10-12', '09:30', 45).warnings.length, 0);
  st.settings.warn45.enabled = false;
  assert.equal(check(st, 'T8', '2026-10-12', '08:15', 45).warnings.length, 0);
});

/* ---------------- assenze ---------------- */
test('la malattia a metà ciclo viene rilevata', () => {
  let st = baseState();
  const r = book(st, { therapistId: 'T7', weekdays: [1, 3, 5], startTime: '12:20', startDate: '2026-10-12' });
  st = r.state;
  const abs = { id: 'a1', therapistId: 'T7', type: 'Malattia', startDate: '2026-10-21', endDate: '2026-10-23', allDay: true };
  st.absences.push(abs);
  const imp = E.impactedByAbsence(st, abs, O);
  assert.deepEqual(imp.map(s => s.date), ['2026-10-21', '2026-10-23']);
  const conf = E.conflicts(st, O);
  assert.equal(conf.length, 2);
  assert.ok(st.sessions.every(s => s.status === 'programmata'), 'nessuna cancellazione silenziosa');
  // un nuovo ciclo che attraversa la malattia non è proponibile
  const ctx = E.makeContext(st, O);
  const { dates } = E.cycleDates(ctx, '2026-10-12', [1, 3, 5], 10);
  const ev = E.evaluateCycle(ctx, ctx.therapists.get('T7'), dates, E.toMin('07:15'), 30);
  assert.equal(ev.firstFail.date, '2026-10-21');
  assert.equal(ev.firstFail.r.code, 'assenza');
});

test('assenza di alcune ore: blocca solo quell\'intervallo', () => {
  const st = baseState();
  st.absences.push({ id: 'a2', therapistId: 'T8', type: 'Permesso', startDate: '2026-10-12', endDate: '2026-10-12', allDay: false, startTime: '13:00', endTime: '14:00' });
  assert.equal(check(st, 'T8', '2026-10-12', '12:40', 30).status, 'fail');
  assert.equal(check(st, 'T8', '2026-10-12', '14:00', 30).status, 'ok');
  assert.equal(check(st, 'T8', '2026-10-12', '08:15', 30).status, 'ok');
});

test('il rientro ignoto non produce disponibilità certe', () => {
  const st = baseState();
  st.absences.push({ id: 'a3', therapistId: 'T8', type: 'Malattia', startDate: '2026-10-08', endDate: null, allDay: true });
  const r = check(st, 'T8', '2026-12-14', '12:40', 30);
  assert.equal(r.status, 'fail'); assert.ok(r.unknownReturn);
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
  assert.ok(!res.groups.some(g => g.therapist.id === 'T8'));
  const ex = res.excluded.find(x => x.therapist.id === 'T8');
  assert.match(ex.reason, /rientro non noto/);
  // un ciclo che terminerebbe prima della malattia resta valido
  const ctx = E.makeContext(st, O);
  const ev = E.evaluateCycle(ctx, ctx.therapists.get('T8'), ['2026-10-06'], E.toMin('12:40'), 30);
  assert.equal(ev.status, 'ok');
});

/* ---------------- previsioni ---------------- */
function tenSessionPath(forecast) {
  let st = baseState();
  const r = book(st, { therapistId: 'T8', weekdays: [2, 4], startTime: '12:40', startDate: '2026-10-06', categoryId: 'neuro' });
  st = r.state;
  if (forecast) st = E.setForecast(st, r.pathId, forecast, Object.assign({ confirmRelease: true }, O)).state;
  const last = st.sessions.filter(s => s.pathId === r.pathId).map(s => s.date).sort().pop();
  return { st, pathId: r.pathId, last };
}
test('la decima seduta non libera il posto senza una previsione adeguata', () => {
  const { st, last } = tenSessionPath(null); // da valutare
  assert.equal(last, '2026-11-05');
  const after = E.addDays(last, 5); // martedì successivo
  const r = check(st, 'T8', after, '12:40', 30);
  assert.equal(r.status, 'fail'); assert.equal(r.code, 'riserva');
  const p2 = tenSessionPath({ state: 'prosecuzione' });
  assert.equal(check(p2.st, 'T8', after, '12:40', 30).code, 'riserva');
  // oltre la riserva provvisoria: solo probabile, mai certo
  const far = E.addDays(last, 7 * 6 + 5);
  const rf = check(p2.st, 'T8', far, '12:40', 30);
  assert.equal(rf.status, 'prob');
});

test('probabile conclusione: posto futuro condizionato con dipendenza indicata', () => {
  const { st, pathId, last } = tenSessionPath({ state: 'probabile_conclusione' });
  const r = check(st, 'T8', E.addDays(last, 5), '12:40', 30);
  assert.equal(r.status, 'prob');
  assert.equal(r.deps[0].pathId, pathId);
});

test('un posto probabile non è prenotabile definitivamente', () => {
  const { st, last } = tenSessionPath({ state: 'probabile_conclusione' });
  assert.throws(() => book(st, { therapistId: 'T8', weekdays: [2, 4], startTime: '12:40', startDate: E.addDays(last, 5), categoryId: 'neuro' }), /probabile/);
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [2, 4], sessions: 10, earliestDate: E.addDays(last, 5) }, O);
  const g = res.groups.find(x => x.therapist.id === 'T8');
  const o = g.options.find(x => x.start === E.toMin('12:40') && x.startDate === E.addDays(last, 5));
  assert.equal(o.status, 'prob'); assert.equal(o.bookable, false); assert.equal(o.category, 'futuro_probabile');
});

test('un ciclo candidato che dipende da più conclusioni le mostra tutte', () => {
  let st = baseState();
  const a = book(st, { therapistId: 'T8', weekdays: [2], startTime: '12:40', startDate: '2026-10-06', sessions: 2, categoryId: 'neuro' });
  st = E.setForecast(a.state, a.pathId, { state: 'probabile_conclusione' }, O).state;
  const b = book(st, { therapistId: 'T8', weekdays: [4], startTime: '12:40', startDate: '2026-10-08', sessions: 4, categoryId: 'neuro' });
  st = E.setForecast(b.state, b.pathId, { state: 'probabile_conclusione' }, O).state;
  const ctx = E.makeContext(st, O);
  const { dates } = E.cycleDates(ctx, '2026-11-03', [2, 4], 4);
  const ev = E.evaluateCycle(ctx, ctx.therapists.get('T8'), dates, E.toMin('12:40'), 30);
  assert.equal(ev.status, 'prob');
  assert.deepEqual(ev.deps.map(d => d.pathId).sort(), [a.pathId, b.pathId].sort());
});

test('la seduta finale resta occupata anche con conclusione confermata', () => {
  const { st, last } = tenSessionPath({ state: 'conclusione_confermata' });
  assert.equal(check(st, 'T8', last, '12:40', 30).code, 'occupato');
  assert.equal(check(st, 'T8', E.addDays(last, 5), '12:40', 30).status, 'ok');
  // posto futuro confermato nella ricerca
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [2, 4], sessions: 10, earliestDate: '2026-10-13' }, O);
  const g = res.groups.find(x => x.therapist.id === 'T8');
  const o = g.options.find(x => x.start === E.toMin('12:40'));
  assert.equal(o.status, 'ok'); assert.ok(o.startDate > last); assert.equal(o.category, 'futuro_confermato');
});

test('sospensione con posto mantenuto e con posto liberato hanno effetti diversi', () => {
  const keep = tenSessionPath(null);
  assert.throws(() => E.setForecast(keep.st, keep.pathId, { state: 'sospensione', keepSlots: true }, O), /riesame/);
  const k = E.setForecast(keep.st, keep.pathId, { state: 'sospensione', keepSlots: true, reviewDate: '2026-12-01', date: '2026-10-20' }, O).state;
  assert.equal(k.sessions.filter(s => s.status === 'programmata').length, 10);
  assert.equal(check(k, 'T8', '2026-10-27', '12:40', 30).code, 'occupato');
  assert.equal(check(k, 'T8', '2026-11-10', '12:40', 30).code, 'riserva', 'riservato fino al riesame');
  const free = tenSessionPath(null);
  assert.throws(() => E.setForecast(free.st, free.pathId, { state: 'sospensione', keepSlots: false, reviewDate: '2026-12-01', date: '2026-10-20' }, O), /Conferma necessaria/);
  const f = E.setForecast(free.st, free.pathId, { state: 'sospensione', keepSlots: false, reviewDate: '2026-12-01', date: '2026-10-20' }, Object.assign({ confirmRelease: true }, O)).state;
  assert.equal(f.sessions.filter(s => s.status === 'annullata').length, 6, 'liberate le 6 sedute dal 20/10');
  assert.equal(f.sessions.length, 10, 'lo storico resta');
  assert.equal(check(f, 'T8', '2026-10-27', '12:40', 30).status, 'ok');
  assert.equal(check(f, 'T8', '2026-11-10', '12:40', 30).status, 'ok');
});

test('interruzione o non avviato: libera gli appuntamenti futuri solo dopo conferma', () => {
  const p = tenSessionPath(null);
  assert.throws(() => E.setForecast(p.st, p.pathId, { state: 'interruzione' }, O), /Conferma/);
  const r = E.setForecast(p.st, p.pathId, { state: 'interruzione' }, Object.assign({ confirmRelease: true }, O));
  assert.equal(r.released.length, 10);
  assert.equal(check(r.state, 'T8', '2026-10-13', '12:40', 30).status, 'ok');
});

test('un rinnovo aggiorna le previsioni e segnala i conflitti', () => {
  const p = tenSessionPath({ state: 'prosecuzione' });
  const pv = E.previewRenewal(p.st, p.pathId, 10, O);
  assert.equal(pv.dates[0], '2026-11-10');
  assert.equal(pv.conflicts.length, 0, 'la riserva del percorso stesso non è un conflitto');
  const r = E.renewCycle(p.st, p.pathId, 10, O);
  const path = r.state.paths.find(x => x.id === p.pathId);
  assert.equal(path.forecast.state, 'da_valutare');
  assert.equal(r.state.cycles.filter(c => c.pathId === p.pathId).length, 2, 'cicli collegati, storico conservato');
  const pc = E.pathCounts(r.state, p.pathId);
  assert.equal(pc.planned, 20); assert.equal(pc.lastDate, '2026-12-10');
  const ov = E.forecastOverview(r.state, O).find(x => x.path.id === p.pathId);
  assert.equal(ov.last, '2026-12-10');
  // conflitto: ferie del collega durante il rinnovo
  const st2 = E.clone(p.st);
  st2.absences.push({ id: 'f', therapistId: 'T8', type: 'Ferie', startDate: '2026-11-16', endDate: '2026-11-20', allDay: true });
  const pv2 = E.previewRenewal(st2, p.pathId, 10, O);
  assert.deepEqual(pv2.conflicts.map(c => c.date), ['2026-11-17', '2026-11-19']);
  assert.throws(() => E.renewCycle(st2, p.pathId, 10, O), /conflitto/);
});

test('avviso di aggiornamento previsione quando mancano poche sedute (soglia modificabile)', () => {
  const p = tenSessionPath(null);
  const t = { today: '2026-10-28' }; // restano 3 sedute future (29/10, 3/11, 5/11)
  let ov = E.forecastOverview(p.st, t).find(x => x.path.id === p.pathId);
  assert.ok(ov.alerts.some(a => a.code === 'aggiorna'));
  p.st.settings.updateThreshold = 2;
  ov = E.forecastOverview(p.st, t).find(x => x.path.id === p.pathId);
  assert.ok(!ov.alerts.some(a => a.code === 'aggiorna'));
});

/* ---------------- stati delle sedute e recuperi ---------------- */
test('programmato non significa effettuato: le date passate restano da registrare', () => {
  const p = tenSessionPath(null);
  const ov = E.forecastOverview(p.st, { today: '2026-10-20' }).find(x => x.path.id === p.pathId);
  assert.ok(p.st.sessions.every(s => s.status === 'programmata'));
  assert.ok(ov.alerts.some(a => a.code === 'esiti'));
});

test('un recupero non viene contato due volte e aggiorna la fine prevista', () => {
  const p = tenSessionPath({ state: 'probabile_conclusione' });
  const s3 = p.st.sessions.filter(s => s.pathId === p.pathId).sort((a, b) => a.date < b.date ? -1 : 1)[2];
  let st = E.setSessionStatus(p.st, s3.id, 'da_recuperare').state;
  const cyc = st.cycles.find(c => c.pathId === p.pathId);
  assert.equal(E.cycleCounts(st, cyc).total, 10);
  assert.equal(E.cycleCounts(st, cyc).programmata, 9);
  const r = E.scheduleRecovery(st, s3.id, { mode: 'fine' }, O);
  st = r.state;
  const c = E.cycleCounts(st, cyc);
  assert.equal(c.total, 10, 'sempre 10: la seduta persa è sostituita dal recupero');
  assert.equal(c.recuperata, 1); assert.equal(c.programmata, 10);
  assert.equal(r.recovery.date, '2026-11-10'); assert.equal(c.lastDate, '2026-11-10');
  assert.equal(r.recovery.recoveryOf, s3.id);
  // il recupero non si può programmare due volte
  assert.throws(() => E.scheduleRecovery(st, s3.id, { mode: 'fine' }, O));
  // annullando il recupero la seduta originale torna da recuperare
  const st2 = E.setSessionStatus(st, r.recovery.id, 'annullata').state;
  assert.equal(st2.sessions.find(s => s.id === s3.id).status, 'da_recuperare');
  assert.equal(E.cycleCounts(st2, cyc).total, 10);
});

test('l\'assenza del paziente non richiede recupero automatico: decide l\'operatore', () => {
  const p = tenSessionPath(null);
  const s1 = p.st.sessions.find(s => s.pathId === p.pathId);
  const st = E.setSessionStatus(p.st, s1.id, 'assente').state;
  assert.equal(st.sessions.filter(s => s.pathId === p.pathId).length, 10, 'nessun recupero creato in automatico');
  assert.equal(E.cycleCounts(st, st.cycles[0]).total, 10);
});

/* ---------------- ricerca e ordinamento ---------------- */
test('idoneità esplicita: prima competenza specifica, poi altri idonei; i non idonei sono esclusi', () => {
  const st = baseState();
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
  assert.deepEqual(res.groups.map(g => g.therapist.id + ':' + g.kind), ['T8:specifica', 'T7:idoneo', 'TA:idoneo']);
  const res2 = E.search(st, { categoryId: 'linf', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
  assert.equal(res2.groups.length, 0);
  assert.equal(res2.excluded.length, 3);
});

test('fascia oraria: obbligatoria filtra, flessibile ordina soltanto', () => {
  const st = baseState();
  const req = { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' };
  const mand = E.search(st, Object.assign({}, req, { pref: { from: '07:00', to: '09:00', mode: 'obbligatoria' } }), O);
  mand.groups.forEach(g => g.options.forEach(o => { assert.ok(o.start >= 420 && o.end <= 540); }));
  assert.ok(mand.excluded.some(x => x.therapist.id === 'TA' || x.therapist.id === 'T8') || mand.groups.length);
  const flex = E.search(st, Object.assign({}, req, { pref: { from: '07:00', to: '09:00', mode: 'flessibile' } }), O);
  const g7 = flex.groups.find(g => g.therapist.id === 'T7');
  assert.equal(g7.options[0].pref.level, 0);
  assert.ok(g7.options.some(o => o.pref.level === 2), 'gli orari fuori preferenza restano visibili');
});

test('le alternative sovrapposte non contano come posti indipendenti', () => {
  const o = (s, e) => ({ start: E.toMin(s), end: E.toMin(e) });
  assert.equal(E.independentCount([o('12:40', '13:10'), o('12:50', '13:20'), o('13:10', '13:40')]), 2);
  assert.equal(E.independentCount([o('12:40', '13:10'), o('12:45', '13:15'), o('12:50', '13:20')]), 1);
});

test('ordinamento per prima disponibilità assoluta', () => {
  let st = baseState();
  // T8 (specifica) libero solo più avanti alle sue ore pomeridiane e mattutine: occupiamo i primi giorni
  for (const t of ['08:15', '12:40', '13:10', '13:40', '14:10']) st = book(st, { therapistId: 'T8', weekdays: [1, 3, 5], startTime: t, startDate: '2026-10-12', sessions: 3, categoryId: 'neuro' }).state;
  st.paths.forEach(p => { p.forecast = { state: 'conclusione_confermata' }; });
  const req = { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' };
  const byComp = E.search(st, Object.assign({ sort: 'competenza' }, req), O);
  assert.equal(byComp.groups[0].therapist.id, 'T8');
  const byDate = E.search(st, Object.assign({ sort: 'data' }, req), O);
  assert.notEqual(byDate.groups[0].therapist.id, 'T8');
  assert.equal(byDate.groups[0].options[0].startDate, '2026-10-12');
});

test('prima di confermare i conflitti vengono ricontrollati (prenotazione concorrente)', () => {
  const st = baseState();
  const res = E.search(st, { categoryId: 'neuro', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
  const o = res.groups[0].options[0];
  const a = { therapistId: o.therapistId, weekdays: [1, 3, 5], startTime: E.fromMin(o.start), startDate: o.startDate, categoryId: 'neuro' };
  const first = book(st, a);
  assert.throws(() => book(first.state, a), /non è più disponibile/);
});

test('buchi singoli per recuperi: spazi certi, contati senza sovrapposizioni', () => {
  let st = baseState();
  st = single(st, 'T8', '2026-10-12', '13:10');
  const gaps = E.findGaps(st, { categoryId: 'neuro', duration: 30, fromDate: '2026-10-12', days: 1 }, O);
  const g8 = gaps.find(g => g.therapist.id === 'T8');
  const pm = g8.items.filter(i => i.start >= E.toMin('12:40'));
  assert.deepEqual(pm.map(i => E.fromMin(i.start) + '-' + E.fromMin(i.end) + ':' + i.seats), ['12:40-13:10:1', '13:40-14:45:2']);
  const am = g8.items.find(i => i.start === E.toMin('08:15'));
  assert.equal(am.seats, 1, 'fascia mattutina del gruppo 8: un solo posto');
});

test('sostituzione esplicita: solo colleghi idonei e liberi', () => {
  let st = baseState();
  const r = book(st, { therapistId: 'T8', weekdays: [1], startTime: '12:40', startDate: '2026-10-12', sessions: 1, categoryId: 'neuro' });
  st = r.state;
  const s = st.sessions[0];
  const subs = E.findSubstitutes(st, s.id, O);
  assert.deepEqual(subs.map(x => x.therapist.id).sort(), ['T7', 'TA'].filter(id => {
    const ctx = E.makeContext(st, O); return E.checkSlot(ctx, ctx.therapists.get(id), s.date, E.toMin(s.start), 30).status === 'ok';
  }).sort());
  const st2 = E.substitute(st, s.id, 'TA', O).state;
  assert.equal(st2.sessions[0].therapistId, 'TA'); assert.equal(st2.sessions[0].originalTherapistId, 'T8');
});

test('validazione della settimana tipo', () => {
  assert.equal(E.validateDay(E.buildDay('reparto7')).length, 0);
  assert.equal(E.validateDay(E.buildDay('reparto8')).length, 0);
  assert.equal(E.validateDay(E.buildDay('ambulatorio', null, 'B')).length, 0);
  const bad = { in: '08:00', out: '15:12', blocks: [{ type: 'amb', start: '08:15', end: '09:30' }, { type: 'reparto', start: '09:00', end: '12:00' }] };
  assert.ok(E.validateDay(bad).some(e => /sovrappongono/.test(e)));
});

test('orari di riferimento: 7:00–14:12 e 8:00–15:12, pause sfalsate, nessun appuntamento fisso alle 13:10', () => {
  const d7 = E.buildDay('reparto7'), d8 = E.buildDay('reparto8');
  assert.equal(d7.in + '-' + d7.out, '07:00-14:12');
  assert.equal(d8.in + '-' + d8.out, '08:00-15:12');
  assert.ok(d7.blocks.some(b => b.type === 'pausa' && b.start === '12:00' && b.end === '12:20'));
  assert.ok(d8.blocks.some(b => b.type === 'pausa' && b.start === '12:20' && b.end === '12:40'));
  assert.ok(![...d7.blocks, ...d8.blocks].some(b => b.start === '13:10' || b.end === '13:10'));
});

test('se la scheda del collega cambia, gli appuntamenti fuori fascia sono segnalati (non spostati)', () => {
  let st = baseState();
  st = book(st, { therapistId: 'T8', weekdays: [1], startTime: '14:10', startDate: '2026-10-12', sessions: 2, categoryId: 'neuro' }).state;
  assert.equal(E.conflicts(st, O).length, 0);
  const t8 = st.therapists.find(t => t.id === 'T8');
  t8.week[1].blocks = t8.week[1].blocks.map(b => b.type === 'amb' && b.start === '12:40' ? Object.assign(b, { end: '14:00' }) : b.type === 'est' ? Object.assign(b, { start: '14:00', end: '14:05' }) : b.type === 'cartelle' && b.start === '15:00' ? Object.assign(b, { start: '14:05' }) : b);
  const conf = E.conflicts(st, O);
  assert.equal(conf.length, 2);
  assert.equal(conf[0].issue.code, 'fuori_fascia');
  assert.ok(st.sessions.every(s => s.start === '14:10' && s.status === 'programmata'));
});
