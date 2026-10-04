/* Verifica dei dati demo generati */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const D = require('../js/demo-data.js');

const TODAY = '2026-10-05';
const st = D.generateDemo({ today: TODAY });

test('18 colleghi: 16 ambulatorio + reparto (entrambi i turni) e 2 solo ambulatorio', () => {
  assert.equal(st.therapists.length, 18);
  assert.equal(st.therapists.filter(t => t.profile === 'ambulatorio').length, 2);
  assert.equal(st.therapists.filter(t => t.profile === 'reparto7').length, 8);
  assert.equal(st.therapists.filter(t => t.profile === 'reparto8').length, 8);
  st.therapists.forEach(t => assert.ok(t.competenze.length + t.idoneita.length > 0));
});

test('sedute da 30 e 45, schemi lun-mer-ven e mar-gio, rinnovi', () => {
  const durs = new Set(st.paths.map(p => p.duration));
  assert.ok(durs.has(30) && durs.has(45));
  const pats = new Set(st.paths.map(p => p.weekdays.join(',')));
  assert.ok(pats.has('1,3,5') && pats.has('2,4'));
  const multi = st.paths.filter(p => st.cycles.filter(c => c.pathId === p.id).length >= 2);
  assert.ok(multi.length >= 1, 'almeno un percorso con rinnovo');
});

test('tutte le previsioni sono rappresentate', () => {
  const states = new Set(st.paths.map(p => p.forecast.state));
  ['da_valutare', 'prosecuzione', 'probabile_conclusione', 'conclusione_confermata', 'sospensione', 'interruzione', 'non_avviato'].forEach(s => assert.ok(states.has(s), s));
});

test('ferie, malattia con rientro non noto e lista d\'attesa', () => {
  assert.ok(st.absences.some(a => a.type === 'Ferie'));
  assert.ok(st.absences.some(a => a.type === 'Malattia' && a.endDate == null));
  assert.ok(st.absences.some(a => a.allDay === false));
  assert.ok(st.waitlist.length >= 10);
  assert.ok(new Set(st.waitlist.map(w => w.status)).size >= 3);
});

test('nessuna sovrapposizione tra sedute dello stesso collega', () => {
  const by = new Map();
  st.sessions.filter(s => E.OCCUPYING.has(s.status)).forEach(s => {
    const k = s.therapistId + '|' + s.date;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push([E.toMin(s.start), E.toMin(s.start) + s.duration]);
  });
  for (const [k, iv] of by) {
    iv.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < iv.length; i++) assert.ok(iv[i][0] >= iv[i - 1][1], 'sovrapposizione in ' + k);
  }
});

test('le sedute rispettano le fasce ambulatoriali e le chiusure', () => {
  const ctx = E.makeContext(st, { today: TODAY });
  for (const s of st.sessions.filter(x => E.OCCUPYING.has(x.status))) {
    const day = E.getDay(ctx, ctx.therapists.get(s.therapistId), s.date);
    assert.ok(!day.closure, 'seduta in chiusura ' + s.date);
    const a = E.toMin(s.start), b = a + s.duration;
    const ok = day.blocks.some(x => x.type === 'amb' && x.start <= a && b <= x.end);
    assert.ok(ok, 'seduta fuori fascia ' + s.therapistId + ' ' + s.date + ' ' + s.start);
  }
});

test('una ricerca sui dati demo trova posti certi e probabili ben separati', () => {
  const res = E.search(st, { categoryId: 'orto', duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: '2026-10-12' }, { today: TODAY });
  const all = res.groups.flatMap(g => g.options);
  assert.ok(all.some(o => o.bookable));
  assert.ok(all.some(o => o.status === 'prob'));
  all.filter(o => o.status === 'prob').forEach(o => { assert.equal(o.bookable, false); assert.ok(o.deps.length > 0); });
  // specifici prima degli idonei
  const kinds = res.groups.map(g => g.kind);
  assert.ok(kinds.indexOf('idoneo') === -1 || kinds.lastIndexOf('specifica') < kinds.indexOf('idoneo'));
});
