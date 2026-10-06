// Lettura dei tabulati: numeri a ritroso, R, V, salti, frequenza, data di inizio (senza server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../web/js/sheet.js');

const O = { month: '2026-10', from: '2026-10-01', planned: 10 };

test('caselle: numeri, R, V, dubbi e valori non validi', () => {
  assert.deepEqual(['3', '1V', 'v1', 'R', 'RV', 'V', '?', '4?', 'X', '3R', '12-3'].map(s => { const c = H.parseCell(s); return [c.num, c.R, c.V, c.doubt, !!c.bad]; }), [
    [3, false, false, false, false], [1, false, true, false, false], [1, false, true, false, false], [null, true, false, false, false],
    [null, true, true, false, false], [null, false, true, false, false], [null, false, false, true, false], [4, false, false, true, false],
    [null, false, false, false, true], [3, true, false, false, true], [12, false, false, false, true]]);
});

test('numeri a ritroso: progressivo = 11 − numero, V non consuma sedute, R senza numero', () => {
  // Rossi (Barile, ottobre 2026): Ven 2 → 3, Lun 5 → 2, Mer 7 → 1 + V, Ven 9 → R
  const r = H.analyzeRow({ cells: { 2: '3', 5: '2', 7: '1V', 9: 'R' }, freq: '3v' }, O);
  assert.deepEqual(r.numbered.map(c => [c.day, c.num, c.p]), [['2026-10-02', 3, 8], ['2026-10-05', 2, 9], ['2026-10-07', 1, 10]]);
  assert.equal(r.prior, 7, 'prima seduta importata = 8ª → 7 precedenti');
  assert.deepEqual(r.visits, ['2026-10-07']);
  assert.deepEqual(r.imported.map(c => c.R ? 'R' : c.num), [3, 2, 1, 'R']);
  assert.deepEqual(r.weekdays, [1, 3, 5]);
  assert.deepEqual(r.blocking, []); assert.deepEqual(r.issues, []);
});

test('data di inizio: le caselle precedenti non si importano ma fissano la numerazione', () => {
  const r = H.analyzeRow({ cells: { 2: '8', 5: '7', 7: '6', 9: '5', 12: '4' } }, Object.assign({}, O, { from: '2026-10-07' }));
  assert.equal(r.before.length, 2); assert.equal(r.imported.length, 3); assert.equal(r.prior, 4);
  const none = H.analyzeRow({ cells: { 2: '8', 5: '7' } }, Object.assign({}, O, { from: '2026-10-20' }));
  assert.equal(none.imported.length, 0); assert.equal(none.prior, 4, 'nulla da importare: le sedute fatte restano conteggiate');
});

test('salto nella numerazione (seduta con un collega) e numeri fuori ordine', () => {
  const g = H.analyzeRow({ cells: { 1: '5', 6: '3' } }, O);
  assert.match(g.issues.join(' '), /Manca il n\. 4/); assert.deepEqual(g.blocking, []);
  const b = H.analyzeRow({ cells: { 1: '3', 6: '4' } }, O);
  assert.match(b.blocking.join(' '), /non in successione/);
});

test('dubbi del trascrittore e "?" bloccano finché non si corregge', () => {
  const r = H.analyzeRow({ cells: { 8: '4?', 13: '3' }, doubts: { 13: '3 o 2?' } }, O);
  assert.equal(r.blocking.length, 2);
  const ok = H.analyzeRow({ cells: { 8: '4', 13: '3' } }, O);
  assert.equal(ok.blocking.length, 0);
});

test('frequenza: 3v, 2v, Lu, Ven; giorni incoerenti segnalati', () => {
  assert.deepEqual(H.parseFrequency('3V'), { perWeek: 3 });
  assert.deepEqual(H.parseFrequency('Lu'), { days: [1], perWeek: 1 });
  assert.deepEqual(H.parseFrequency('Ven'), { days: [5], perWeek: 1 });
  const v = H.analyzeRow({ cells: { 2: '4', 9: '3', 16: '2', 23: '1' }, freq: 'Ven' }, O);
  assert.deepEqual(v.weekdays, [5]); assert.deepEqual(v.issues, []);
  const w = H.analyzeRow({ cells: { 1: '8', 7: '7', 9: '6' }, freq: '2v' }, O);
  assert.match(w.issues.join(' '), /indica i giorni/);
});

test('visita in un giorno senza trattamento: suggerisce i giorni vicini', () => {
  const r = H.analyzeRow({ cells: { 8: '2', 12: 'V', 13: '1' } }, O);
  assert.match(r.issues.join(' '), /Lun 12\/10 in un giorno senza trattamento.*Mar 13\/10/);
});

test('sedute oltre quelle lette solo su scelta esplicita', () => {
  const base = { cells: { 1: '10', 6: '9' }, weekdays: [2, 4] };
  assert.equal(H.analyzeRow(base, O).generated.length, 0);
  const g = H.analyzeRow(base, Object.assign({}, O, { generate: true, today: '2026-10-06', closures: new Set(['2026-10-13']) }));
  assert.equal(g.generated.length, 8);
  assert.deepEqual(g.generated.slice(0, 3).map(c => [c.day, c.num]), [['2026-10-08', 8], ['2026-10-15', 7], ['2026-10-20', 6]]);
});

test('trascrizione: formato, fogli, posizione delle caselle sulla foto', () => {
  const { sheets, errors } = H.fromTranscript({ formato: H.FORMAT, fogli: [{ fisioterapista: 'Barile', mese: '2026-10', griglia: { x_giorno1: 30, x_giorno31: 90 },
    righe: [{ rif: 'B1', ora: '07:15', paziente: 'Rossi', frequenza: '3v', caselle: { 2: '3' }, y: 20, dubbi_riga: ['nome incerto'] }] }] });
  assert.deepEqual(errors, []);
  assert.equal(sheets[0].rows[0].rowDoubts[0].ok, false);
  assert.deepEqual(H.cellPos(sheets[0].grid, 31, 20), { x: 90, y: 20, w: 2, h: 3 });
  assert.ok(H.fromTranscript({ formato: 'altro' }).errors.length);
});
