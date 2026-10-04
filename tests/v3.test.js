/* Test della versione semplice v3: percorsi Mano, priorità U/B/D/P, tipo di richiesta, aggiornamento dei dati salvati */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const D = require('../js/demo-data.js');

const TODAY = '2026-10-05';
const O = { today: TODAY };
const demo = D.generateDemo({ today: TODAY });

test('percorsi Mano e Chirurgia della mano / postoperatorio presenti una sola volta e associati alle competenze', () => {
  const names = demo.categories.map(c => c.name);
  assert.equal(names.filter(n => n === 'Mano').length, 1);
  assert.equal(names.filter(n => n === 'Chirurgia della mano / postoperatorio').length, 1);
  for (const id of ['mano', 'chir_mano']) {
    assert.ok(demo.therapists.some(t => t.competenze.includes(id)), 'competenza specifica ' + id);
    assert.ok(demo.therapists.some(t => t.idoneita.includes(id)), 'altra idoneità ' + id);
  }
});

test('ricerca Mano: prima i colleghi con competenza specifica, poi gli altri abilitati; esclusi i non abilitati', () => {
  for (const cat of ['mano', 'chir_mano']) {
    const res = E.search(demo, { categoryId: cat, duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, O);
    const kinds = res.groups.map(g => g.kind);
    assert.ok(kinds.length > 0);
    const firstIdoneo = kinds.indexOf('idoneo');
    assert.ok(firstIdoneo === -1 || kinds.slice(firstIdoneo).every(k => k === 'idoneo'), 'specifici prima degli idonei');
    res.groups.forEach(g => assert.ok(E.eligibility(g.therapist, cat)));
    demo.therapists.filter(t => !E.eligibility(t, cat)).forEach(t => assert.ok(res.groups.every(g => g.therapist.id !== t.id)));
    // nessuna sovrapposizione: ogni proposta prenotabile supera il doppio controllo
    const g = res.groups.find(x => x.options.some(o => o.bookable));
    const o = g.options.find(x => x.bookable);
    assert.ok(E.recheckOption(demo, o, { categoryId: cat, duration: 30, weekdays: [1, 3, 5], sessions: 10 }, O).ok);
  }
});

test('assegnazione a un collega non abilitato al percorso Mano: rifiutata', () => {
  const no = demo.therapists.find(t => !E.eligibility(t, 'chir_mano'));
  assert.throws(() => E.bookCycle(demo, { patientName: 'X', categoryId: 'chir_mano', therapistId: no.id, duration: 30, weekdays: [1, 3, 5], startTime: '12:40', startDate: '2026-10-12', sessions: 5 }, O));
});

test('priorità: solo U, B, D, P, Non indicata, in quest\'ordine; scelta dall\'operatore e mai dedotta dalla patologia', () => {
  assert.deepEqual(E.PRIORITY_ORDER, ['U', 'B', 'D', 'P', 'NI']);
  assert.deepEqual(Object.values(E.PRIORITY_CLASSES), ['U – Urgente', 'B – Breve', 'D – Differibile', 'P – Programmabile', 'Non indicata']);
  // senza scelta dell'operatore: "Non indicata", qualunque sia il percorso
  for (const p of demo.paths) assert.equal(p.priority, 'NI');
  const res = E.search(demo, { categoryId: 'chir_mano', duration: 30, weekdays: [1, 3, 5], sessions: 5, earliestDate: '2026-10-12' }, O);
  const g = res.groups.find(x => x.options.some(y => y.status === 'ok'));
  const th = g.therapist, o = g.options.find(x => x.status === 'ok');
  const r = E.bookCycle(demo, { patientName: 'Prova', categoryId: 'chir_mano', therapistId: th.id, duration: 30, weekdays: [1, 3, 5], startTime: E.fromMin(o.start), startDate: o.startDate, sessions: 5 }, O);
  assert.equal(r.state.paths.find(p => p.id === r.pathId).priority, 'NI');
  const r2 = E.bookCycle(demo, { patientName: 'Prova', categoryId: 'chir_mano', therapistId: th.id, duration: 30, weekdays: [1, 3, 5], startTime: E.fromMin(o.start), startDate: o.startDate, sessions: 5, priority: 'B' }, O);
  assert.equal(r2.state.paths.find(p => p.id === r2.pathId).priority, 'B');
});

test('nessuna data, scadenza o conteggio legato alla priorità nei dati', () => {
  const keys = new Set(demo.waitlist.flatMap(w => Object.keys(w)));
  ['deadline', 'scadenza', 'prescriptionDate', 'requestDate', 'request', 'dueDate'].forEach(k => assert.ok(!keys.has(k), k));
  assert.ok(demo.waitlist.every(w => E.PRIORITY_CLASSES[w.priority]));
  assert.ok(new Set(demo.waitlist.map(w => w.priority)).size === 5, 'demo con tutte le categorie');
});

test('lista compatibile con un posto: ordinata per priorità U → Non indicata', () => {
  const ov = E.forecastOverview(demo, O).find(r => r.slot.freeFrom && r.slot.code === 'libero');
  const list = E.compatibleWaitlist(demo, { therapistId: ov.path.therapistId, weekdays: [1, 2, 3, 4, 5], start: E.toMin(ov.path.startTime), duration: 45, freeFrom: ov.slot.freeFrom }, O);
  const idx = list.map(x => E.PRIORITY_ORDER.indexOf(x.entry.priority));
  assert.deepEqual(idx, idx.slice().sort((a, b) => a - b));
});

test('tipo di richiesta "Continuazione ciclo": non azzera né modifica cicli e sedute', () => {
  const res = E.search(demo, { categoryId: 'mano', duration: 30, weekdays: [2, 4], sessions: 5, earliestDate: '2026-10-12' }, O);
  const g = res.groups.find(x => x.options.some(y => y.status === 'ok'));
  const th = g.therapist, o = g.options.find(x => x.status === 'ok');
  const a = { patientName: 'C', categoryId: 'mano', therapistId: th.id, duration: 30, weekdays: [2, 4], startTime: E.fromMin(o.start), startDate: o.startDate, sessions: 5 };
  const r1 = E.bookCycle(demo, Object.assign({ requestType: 'prima' }, a), O);
  const r2 = E.bookCycle(demo, Object.assign({ requestType: 'continuazione' }, a), O);
  assert.deepEqual(r1.dates, r2.dates);
  assert.equal(r2.state.paths.find(p => p.id === r2.pathId).requestType, 'continuazione');
  const before = demo.sessions.filter(s => s.status === 'effettuata').length;
  assert.equal(r2.state.sessions.filter(s => s.status === 'effettuata').length, before, 'sedute effettuate invariate');
  assert.equal(r2.state.sessions.length, demo.sessions.length + 5);
});

test('aggiornamento dei dati salvati con la prima versione: nulla va perso, nessuna priorità dedotta', () => {
  const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'stato-v1-demo.json.gz'))).toString());
  const st = E.clone(old);
  const ch = E.upgradeState(st);
  assert.ok(ch.length > 0);
  for (const k of ['patients', 'paths', 'cycles', 'sessions', 'absences', 'closures', 'therapists']) assert.deepEqual(st[k], old[k], k);
  assert.equal(st.categories.length, old.categories.length + 2);
  st.waitlist.forEach((w, i) => {
    assert.equal(w.priority, 'NI', 'Alta/Media/Bassa non convertite automaticamente');
    assert.equal(w.previousPriority, old.waitlist[i].priority, 'valore precedente conservato');
  });
  assert.equal(E.upgradeState(st).length, 0, 'idempotente');
});

test('categorie equivalenti già presenti vengono riusate senza duplicati', () => {
  const st = { categories: [{ id: 'c1', name: 'Mano' }, { id: 'c2', name: 'Chirurgia della mano' }], settings: {}, waitlist: [] };
  E.upgradeState(st);
  assert.deepEqual(st.categories.map(c => c.id), ['c1', 'c2']);
  const st2 = { categories: [{ id: 'mano', name: 'Ortopedia' }], settings: {}, waitlist: [] };
  E.upgradeState(st2);
  assert.equal(st2.categories.length, 3);
  assert.equal(new Set(st2.categories.map(c => c.id)).size, 3, 'codici univoci');
});
