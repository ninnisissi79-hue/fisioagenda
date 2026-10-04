/* Test di priorità, termini di inizio, percorso Mano e aggiornamento dei dati salvati: node --test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const D = require('../js/demo-data.js');

const TODAY = '2026-10-05'; // lunedì
const O = { today: TODAY };

function baseState() {
  const settings = E.clone(E.DEFAULT_SETTINGS);
  const th = (id, profile, comp, ido, skills) => ({
    id, name: 'Collega ' + id, profile, competenze: comp, idoneita: ido, handSkills: skills || [],
    week: E.buildWeek(profile, settings), exceptions: [], maxPatientsDay: null
  });
  return {
    settings,
    categories: [{ id: 'orto', name: 'Ortopedia' }, { id: 'mano', name: 'Mano / Chirurgia della mano', hand: true, subcategories: E.clone(E.HAND_SUBCATEGORIES) }],
    therapists: [th('SPEC', 'reparto8', ['orto', 'mano'], [], ['postop']), th('ALTRO', 'ambulatorio', [], ['orto', 'mano'], ['ortesi']), th('NOMANO', 'reparto7', ['orto'], [])],
    closures: [], absences: [], patients: [], paths: [], cycles: [], sessions: [], waitlist: [], log: []
  };
}
const R = o => E.emptyRequest(Object.assign({}, o, { startTerm: Object.assign(E.emptyRequest().startTerm, o.startTerm || {}) }));
/** Occupa tutte le fasce ambulatoriali di un collega dal giorno indicato per N settimane (lun-ven), con percorsi a conclusione confermata. */
function fillTherapist(st, thId, fromDate, weeks) {
  const th = st.therapists.find(t => t.id === thId);
  const day = E.buildDay(th.profile, st.settings);
  for (const b of day.blocks.filter(x => x.type === 'amb')) {
    for (let t = E.toMin(b.start); t + 30 <= E.toMin(b.end); t += 30) {
      const r = E.bookCycle(st, { patientName: 'Occ', categoryId: 'orto', therapistId: thId, duration: 30, weekdays: [1, 2, 3, 4, 5], startTime: E.fromMin(t), startDate: fromDate, sessions: weeks * 5 }, O);
      st = E.setForecast(r.state, r.pathId, { state: 'conclusione_confermata' }, O).state;
    }
  }
  return st;
}

/* ---------------- U: 72 ore ---------------- */
test('richiesta U con regola applicabile: scadenza a 72 ore di calendario (non giorni lavorativi)', () => {
  const st = baseState();
  // giovedì 08/10 10:30 → domenica 11/10 10:30, anche se sabato e domenica il servizio è chiuso
  const r = R({ priorityClass: 'U', service: 'visita_fisiatrica', accessType: 'primo', requestDate: '2026-10-08', requestTime: '10:30' });
  const dl = E.computeDeadline(st, r);
  assert.equal(dl.status, 'ok');
  assert.deepEqual(dl.due, { date: '2026-10-11', min: 10 * 60 + 30 });
  assert.equal(dl.validation, 'regionale');
  assert.equal(E.deadlineStatus(dl, { date: '2026-10-10', min: 12 * 60 }, st.settings).code, 'vicino');
  assert.equal(E.deadlineStatus(dl, { date: '2026-10-11', min: 10 * 60 + 31 }, st.settings).code, 'scaduto');
  assert.equal(E.compareStart(dl, '2026-10-12', 8 * 60 + 15).code, 'oltre', 'lunedì mattina è oltre le 72 ore');
});

test('U senza ora della richiesta: dato mancante segnalato, nessun termine inventato', () => {
  const st = baseState();
  const dl = E.computeDeadline(st, R({ priorityClass: 'U', service: 'visita_fisiatrica', accessType: 'primo', requestDate: '2026-10-08' }));
  assert.equal(dl.status, 'da_verificare');
  assert.equal(dl.due, null);
  assert.ok(dl.missing.some(m => /ora della richiesta/.test(m)));
  assert.equal(E.deadlineStatus(dl).code, 'da_verificare');
});

test('chiusura nel giorno della scadenza: segnalata, ma la scadenza non si sposta', () => {
  const st = baseState();
  st.closures.push({ date: '2026-10-15', label: 'Chiusura di prova', type: 'chiusura' });
  const dl = E.computeDeadline(st, R({ priorityClass: 'B', service: 'visita_fisiatrica', accessType: 'primo', requestDate: '2026-10-05' }));
  assert.equal(dl.due.date, '2026-10-15');
  assert.equal(dl.closureOnDue.label, 'Chiusura di prova');
});

/* ---------------- B: posto entro e oltre il termine ---------------- */
test('richiesta B (ciclo, regola demo): proposte entro e oltre il termine con ritardo indicato', () => {
  let st = baseState();
  st.therapists = st.therapists.filter(t => t.id !== 'NOMANO');
  st = fillTherapist(st, 'SPEC', '2026-10-05', 3); // lo specialista è pieno per 3 settimane
  const request = R({ priorityClass: 'B', service: 'ciclo', accessType: 'primo', listDate: '2026-10-05' });
  const dl = E.computeDeadline(st, request);
  assert.equal(dl.due.date, '2026-10-15', '10 giorni dall\'inserimento in lista');
  assert.equal(dl.validation, 'demo', 'regola etichettata come configurazione demo');
  assert.equal(dl.official, false);
  const res = E.search(st, { categoryId: 'orto', duration: 30, weekdays: [1, 3, 5], sessions: 5, earliestDate: '2026-10-07' }, O);
  const an = E.deadlineAnalysis(res, dl);
  assert.ok(an.within.length > 0, 'un collega idoneo può iniziare entro il termine');
  assert.ok(an.within.every(x => x.o.bookable && x.o.startDate <= '2026-10-15'));
  const spec = res.groups.find(g => g.therapist.id === 'SPEC');
  const cmp = E.compareStart(dl, spec.options[0].startDate, spec.options[0].start);
  assert.equal(cmp.code, 'oltre');
  assert.ok(cmp.delayDays > 0 && /ritardo di \d+ giorn/.test(cmp.text));
  assert.equal(an.specialistLate, true, 'evidenzia: specialista solo dopo, altro collega entro il termine');
  assert.equal(an.bestOtherWithin.g.kind, 'idoneo');
  assert.equal(res.groups[0].kind, 'specifica', 'il raggruppamento per competenza non cambia');
});

test('nessun posto entro il termine: avviso e prime alternative successive, senza modificare nulla', () => {
  let st = baseState();
  st.therapists = st.therapists.filter(t => t.id === 'SPEC');
  st = fillTherapist(st, 'SPEC', '2026-10-05', 3);
  const before = JSON.stringify(st);
  const dl = E.computeDeadline(st, R({ priorityClass: 'B', service: 'ciclo', accessType: 'primo', listDate: '2026-10-05' }));
  const res = E.search(st, { categoryId: 'orto', duration: 30, weekdays: [1, 3, 5], sessions: 5, earliestDate: '2026-10-07' }, O);
  const an = E.deadlineAnalysis(res, dl);
  assert.equal(an.noneWithin, true);
  assert.ok(an.alternatives.length >= 1);
  assert.ok(an.alternatives[0].cmp.code === 'oltre' && an.alternatives[0].cmp.delayDays > 0);
  assert.equal(JSON.stringify(st), before, 'priorità, scadenze e appuntamenti invariati');
});

/* ---------------- D visita / D accertamento ---------------- */
test('D: 30 giorni per la visita, 60 giorni per l\'accertamento diagnostico', () => {
  const st = baseState();
  const base = { priorityClass: 'D', accessType: 'primo', requestDate: '2026-10-05' };
  assert.equal(E.computeDeadline(st, R(Object.assign({ service: 'visita_fisiatrica' }, base))).due.date, '2026-11-04');
  assert.equal(E.computeDeadline(st, R(Object.assign({ service: 'accertamento' }, base))).due.date, '2026-12-04');
});

/* ---------------- cicli senza regola validata ---------------- */
test('ciclo fisioterapico senza regola: nessuna scadenza automatica (il termine delle visite non si applica)', () => {
  const st = baseState();
  const dl = E.computeDeadline(st, R({ priorityClass: 'D', service: 'ciclo', accessType: 'primo', requestDate: '2026-10-05', listDate: '2026-10-05' }));
  assert.equal(dl.status, 'da_verificare');
  assert.equal(dl.due, null);
  assert.ok(dl.reasons.some(x => /Nessuna regola/.test(x)));
  // con la regola demo: il termine c'è ma non è presentato come ufficiale
  const dlB = E.computeDeadline(st, R({ priorityClass: 'B', service: 'ciclo', accessType: 'primo', listDate: '2026-10-05' }));
  assert.equal(dlB.official, false);
  assert.match(dlB.originLabel, /Configurazione demo da validare dal servizio/);
  // una regola validata dal servizio è riconosciuta come tale
  st.settings.deadlineRules.find(r => r.id === 'demo-b-ciclo').validation = 'validata';
  assert.equal(E.computeDeadline(st, R({ priorityClass: 'B', service: 'ciclo', accessType: 'primo', listDate: '2026-10-05' })).official, true);
});

test('mancanza della data di decorrenza: "da verificare", senza presumere un\'altra data', () => {
  const st = baseState();
  // la regola B visita decorre dalla richiesta: la sola data di prescrizione non basta
  const dl = E.computeDeadline(st, R({ priorityClass: 'B', service: 'visita_fisiatrica', accessType: 'primo', prescriptionDate: '2026-10-01', listDate: '2026-10-02' }));
  assert.equal(dl.status, 'da_verificare');
  assert.ok(dl.missing.some(m => /richiesta di prenotazione/.test(m)));
});

/* ---------------- priorità non indicata ---------------- */
test('richiesta senza priorità: il dato originale "Non indicata" è conservato, la gestione come P è separata', () => {
  let st = baseState();
  const request = R({ priorityClass: 'NI', service: 'visita_fisiatrica', accessType: 'primo', requestDate: '2026-10-05' });
  const copy = JSON.stringify(request);
  const dl = E.computeDeadline(st, request);
  assert.equal(dl.original, 'NI');
  assert.equal(dl.effective, 'P');
  assert.equal(dl.due.date, E.addDays('2026-10-05', 120));
  assert.equal(JSON.stringify(request), copy, 'la richiesta non viene modificata');
  const r = E.bookCycle(st, { patientName: 'NI', categoryId: 'orto', therapistId: 'SPEC', duration: 30, weekdays: [1, 3, 5], startTime: '12:40', startDate: '2026-10-07', sessions: 5, request }, O);
  assert.equal(r.state.paths.find(p => p.id === r.pathId).request.priorityClass, 'NI', 'conservata anche dopo l\'assegnazione');
  st.settings.unspecifiedAs = '';
  assert.equal(E.computeDeadline(st, request).status, 'da_verificare', 'senza regola di gestione: da verificare');
});

/* ---------------- controllo / rinnovo ---------------- */
test('controllo e rinnovo distinti dal primo accesso', () => {
  const st = baseState();
  const r = a => E.computeDeadline(st, R({ priorityClass: 'U', service: 'visita_fisiatrica', accessType: a, requestDate: '2026-10-05', requestTime: '09:00' }));
  assert.equal(r('primo').status, 'ok');
  assert.equal(r('controllo').status, 'da_verificare');
  assert.equal(r('prosecuzione').status, 'da_verificare');
});

/* ---------------- posto probabile ---------------- */
test('un posto probabile entro il termine non conta come prenotazione confermata', () => {
  let st = baseState();
  st.therapists = st.therapists.filter(t => t.id === 'ALTRO');
  // tutto pieno fino al 09/10 con "probabile conclusione": dopo il posto è solo probabile
  const th = st.therapists[0];
  const day = E.buildDay(th.profile, st.settings);
  for (const b of day.blocks.filter(x => x.type === 'amb')) {
    for (let t = E.toMin(b.start); t + 30 <= E.toMin(b.end); t += 30) {
      const r = E.bookCycle(st, { patientName: 'P', categoryId: 'orto', therapistId: 'ALTRO', duration: 30, weekdays: [1, 2, 3, 4, 5], startTime: E.fromMin(t), startDate: '2026-10-05', sessions: 5 }, O);
      st = E.setForecast(r.state, r.pathId, { state: 'probabile_conclusione' }, O).state;
    }
  }
  const dl = E.computeDeadline(st, R({ startTerm: { date: '2026-10-16', source: 'prescrittore' } }));
  const res = E.search(st, { categoryId: 'orto', duration: 30, weekdays: [1, 3, 5], sessions: 5, earliestDate: '2026-10-12' }, O);
  const an = E.deadlineAnalysis(res, dl);
  assert.ok(an.probWithin.length > 0, 'ci sono posti probabili entro il termine');
  assert.ok(an.probWithin.every(x => !x.o.bookable));
  assert.equal(an.within.length, 0, 'ma nessuno conta come richiesta soddisfatta');
  assert.equal(an.noneWithin, true);
});

/* ---------------- data minima successiva alla scadenza ---------------- */
test('data "non prima del" successiva alla scadenza: conflitto segnalato', () => {
  const st = baseState();
  const dl = E.computeDeadline(st, R({ priorityClass: 'P', service: 'ciclo', accessType: 'primo', startTerm: { date: '2026-10-10', notBefore: '2026-10-17', source: 'prescrittore' } }));
  assert.equal(dl.kind, 'indicazione');
  assert.equal(dl.conflictNotBefore, true);
  assert.equal(E.compareStart(dl, '2026-10-09', 600).code, 'prima_minimo');
});

test('scadenza di inizio distinta dalla fine prevista del ciclo', () => {
  let st = baseState();
  const request = R({ startTerm: { date: '2026-10-09', source: 'protocollo' } });
  const r = E.bookCycle(st, { patientName: 'X', categoryId: 'orto', therapistId: 'SPEC', duration: 30, weekdays: [1, 3, 5], startTime: '12:40', startDate: '2026-10-07', sessions: 10, request }, O);
  const pd = E.pathDeadline(r.state, r.pathId, O);
  assert.equal(pd.first.date, '2026-10-07');
  assert.equal(pd.cmp.code, 'entro');
  assert.ok(pd.cycleEnd > pd.dl.due.date, 'la fine del ciclo è oltre il termine di inizio, ed è un dato diverso');
});

/* ---------------- percorso Mano ---------------- */
test('percorso Mano: abbinato a idoneità e competenza specifica richiesta; la provenienza non rende urgente', () => {
  const st = baseState();
  const base = { categoryId: 'mano', duration: 30, weekdays: [1, 3, 5], sessions: 5, earliestDate: '2026-10-07' };
  const all = E.search(st, base, O);
  assert.deepEqual(all.groups.map(g => g.therapist.id).sort(), ['ALTRO', 'SPEC']);
  assert.ok(all.excluded.some(x => x.therapist.id === 'NOMANO'));
  assert.equal(all.groups[0].therapist.id, 'SPEC', 'competenza specifica prima');
  const ortesi = E.search(st, Object.assign({ requiredSkill: 'ortesi' }, base), O);
  assert.deepEqual(ortesi.groups.map(g => g.therapist.id), ['ALTRO']);
  assert.ok(ortesi.excluded.some(x => x.therapist.id === 'SPEC' && /competenza richiesta/.test(x.reason)));
  const o = ortesi.groups[0].options.find(x => x.bookable);
  assert.throws(() => E.bookCycle(st, { patientName: 'M', categoryId: 'mano', therapistId: 'SPEC', duration: 30, weekdays: [1, 3, 5], startTime: E.fromMin(o.start), startDate: o.startDate, sessions: 5, hand: { requiredSkill: 'ortesi' } }, O));
  const dl = E.computeDeadline(st, R({ priorityClass: 'B', service: 'ciclo', accessType: 'primo', origin: 'chir_mano', listDate: '2026-10-05' }));
  assert.equal(dl.original, 'B');
  assert.equal(dl.effective, 'B', 'dalla Chirurgia della mano non diventa U');
});

/* ---------------- dati demo ---------------- */
test('dati demo: richieste complete, casi di tutte le classi e percorso Mano', () => {
  const st = D.generateDemo({ today: TODAY });
  const cls = new Set(st.waitlist.map(w => w.request.priorityClass));
  ['U', 'B', 'D', 'P', 'NI'].forEach(c => assert.ok(cls.has(c), c));
  const hand = st.categories.filter(c => c.hand);
  assert.equal(hand.length, 1);
  assert.ok(hand[0].subcategories.length >= 8);
  assert.ok(st.waitlist.some(w => w.categoryId === 'mano' && w.request.origin === 'chir_mano'));
  assert.ok(st.therapists.some(t => (t.handSkills || []).includes('ortesi')));
  assert.equal(E.migrateState(E.clone(st)).length, 0, 'i dati demo nuovi non richiedono aggiornamento');
});

/* ---------------- conservazione dei dati salvati ---------------- */
test('aggiornamento dei dati demo salvati con la versione precedente: nulla va perso', () => {
  const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'stato-v1-demo.json.gz'))).toString());
  const st = E.clone(old);
  const changes = E.migrateState(st);
  assert.ok(changes.length > 0);
  for (const k of ['patients', 'paths', 'cycles', 'sessions', 'absences', 'closures', 'therapists']) assert.deepEqual(st[k].length, old[k].length, k);
  assert.deepEqual(st.sessions, old.sessions, 'sedute invariate');
  assert.deepEqual(st.paths, old.paths, 'percorsi invariati');
  st.therapists.forEach((t, i) => { assert.deepEqual(t.competenze, old.therapists[i].competenze); assert.deepEqual(t.week, old.therapists[i].week); });
  st.waitlist.forEach((w, i) => {
    assert.equal(w.priority, old.waitlist[i].priority, 'priorità interna conservata');
    assert.equal(w.request.priorityClass, '', 'nessuna classe attribuita automaticamente');
    assert.equal(w.request.listDate, old.waitlist[i].insertedAt);
  });
  assert.equal(st.categories.filter(c => c.hand).length, 1);
  assert.equal(E.migrateState(st).length, 0, 'idempotente');
  // il motore funziona sui dati aggiornati
  const res = E.search(st, { categoryId: 'orto', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
  assert.ok(res.groups.length > 0);
});

test('una categoria "Mano" già esistente viene riusata (stesso codice, assegnazioni conservate)', () => {
  const st = baseState();
  st.categories = [{ id: 'orto', name: 'Ortopedia' }, { id: 'c77', name: 'Mano' }];
  st.therapists[0].competenze = ['c77'];
  st.waitlist.push({ id: 'w1', name: 'A', categoryId: 'c77', insertedAt: '2026-10-01' });
  const ch = E.migrateState(st);
  assert.equal(st.categories.length, 2, 'nessun duplicato');
  const h = st.categories.find(c => c.hand);
  assert.equal(h.id, 'c77');
  assert.equal(h.name, 'Mano / Chirurgia della mano');
  assert.deepEqual(st.therapists[0].competenze, ['c77']);
  assert.ok(ch.some(x => /riusata/.test(x)));
});
