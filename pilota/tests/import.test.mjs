// Importazione dei tabulati e correzioni rapide dal calendario: verifiche sul server locale REALE.
// Prerequisito: `npm run db:start` (Docker). Solo pazienti fittizi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, S, ensureUser, login, today, workdays, psql, expectError } from './helpers.mjs';

const RUN = Date.now().toString(36).slice(-5);
let admin, op1, T0;
const DAY = [{ kind: 'amb', start: '07:00', end: '12:00' }, { kind: 'pausa', start: '12:00', end: '12:20' }, { kind: 'amb', start: '12:20', end: '14:30' }];
const WEEK = { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: [], 7: [] };

async function therapist(tag) {
  const id = await S.rpc(admin, 'admin_save_therapist', { p: { name: `Imp ${tag} ${RUN}`, activity: 'ambulatorio', skills: [{ category_id: 'mano', level: 'specifica' }] } });
  await S.rpc(admin, 'admin_save_shift', { p_th: id, p_valid_from: E.addDays(T0, -60), p_week: WEEK, p_note: 'test', p_dry_run: false });
  return id;
}
/** prossime n date (da `from`) nei giorni della settimana indicati, senza chiusure */
function days(from, wds, n) {
  const closures = new Set(psql("select coalesce(string_agg(day::text, ','), '') from public.closures").split(',').filter(Boolean));
  const out = []; let d = from;
  while (out.length < n) { if (wds.includes(E.weekday(d)) && !closures.has(d)) out.push(d); d = E.addDays(d, 1); }
  return out;
}
const month = d => d.slice(0, 8) + '01';
const q = sql => psql(sql);

test.before(async () => {
  await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
  await ensureUser('op1@pilota.test', 'operatore', 'Operatore Uno');
  [admin, op1] = await Promise.all(['coord', 'op1'].map(u => login(u + '@pilota.test')));
  T0 = today();
});

test('importazione di un tabulato: numeri a ritroso, R, V, date passate solo programmate, nessun doppione', async () => {
  const th = await therapist('A');
  const past = days(E.addDays(T0, -14), [1, 3, 5], 2);             // due caselle già passate
  const fut = days(E.addDays(T0, 1), [1, 3, 5], 3);                 // tre future
  const sheet = {
    therapist_id: th, month: month(T0), from_date: past[0], photo_hash: 'foto-' + RUN, source_hash: 'src-' + RUN, label: 'prova',
    rows: [{
      ref: 'r1', target: 'nuovo', patient_name: 'Rossi ' + RUN, category_id: 'mano', treatment: 'GC', planned: 10, prior: 5, duration: 30,
      weekdays: [1, 3, 5], start: '07:15',
      cells: [{ day: past[0], number: 5 }, { day: past[1], number: 4 }, { day: fut[0], number: 3 }, { day: fut[1], number: 2 }, { day: fut[2], number: 1 }],
      visits: [fut[2]]
    }, {
      ref: 'r2', target: 'nuovo', patient_name: 'Favano ' + RUN, category_id: 'mano', treatment: 'RM', planned: 10, prior: 7, duration: 30,
      weekdays: [2, 4], start: '07:15',
      cells: [{ day: days(E.addDays(T0, 1), [2, 4], 1)[0], number: 3 }, { day: days(E.addDays(T0, 1), [2, 4], 2)[1], mark: 'R' }]
    }]
  };
  const r = await S.rpc(op1, 'import_sheet', { p: sheet });
  assert.equal(r.patients, 2); assert.equal(r.cycles, 2); assert.equal(r.appointments, 7); assert.equal(r.visits, 1); assert.equal(r.duplicates, 0);
  const pat = q(`select id from patients where name='Rossi ${RUN}'`);
  const cyc = JSON.parse(q(`select row_to_json(c) from cycles c where patient_id='${pat}'`));
  assert.equal(cyc.status, 'attivo'); assert.equal(cyc.prior_sessions, 5); assert.equal(cyc.treatment, 'GC'); assert.equal(cyc.therapist_id, th);
  assert.deepEqual(cyc.weekdays, [1, 3, 5]); assert.equal(cyc.weekday_times['3'], '07:15');
  assert.equal(q(`select string_agg(sheet_number::text, ',' order by day) from appointments where patient_id='${pat}'`), '5,4,3,2,1');
  // il tabulato non dimostra la presenza: anche le date passate restano "programmate" (esito da registrare)
  assert.equal(q(`select string_agg(distinct status, ',') from appointments where patient_id='${pat}'`), 'programmata');
  const issues = await S.rpc(op1, 'appointment_issues', { p_from: T0, p_to: E.addDays(T0, 60) });
  const pastIds = q(`select string_agg(id::text, ',') from appointments where patient_id='${pat}' and day < '${T0}'`).split(',');
  assert.ok(pastIds.every(id => issues.some(i => i.appointment_id === id && i.kind === 'esito_mancante')), 'le sedute passate chiedono l’esito');
  // la V è un evento del paziente, non una seduta
  assert.equal(q(`select count(*) from patient_events where patient_id='${pat}' and day='${fut[2]}' and kind='visita_fisiatrica'`), '1');
  assert.equal(q(`select count(*) from appointments where patient_id='${pat}' and day='${fut[2]}'`), '1');
  // R: recupero, senza numero
  const fav = q(`select id from patients where name='Favano ${RUN}'`);
  assert.equal(q(`select string_agg(coalesce(sheet_number::text, sheet_mark), ',' order by day) from appointments where patient_id='${fav}'`), '3,R');
  assert.equal(q(`select count(*) from import_batches where id='${r.batch_id}' and summary->>'appointments'='7'`), '1');

  // stesso tabulato ricaricato: i pazienti ora esistono, la conferma come "nuovo" è rifiutata…
  await expectError(S.rpc(op1, 'import_sheet', { p: sheet }), 'FA_CONFLICT', /esiste già un paziente/);
  // …e collegandolo al ciclo esistente nessuna seduta viene duplicata
  const cycFav = q(`select id from cycles where patient_id='${fav}'`);
  const again = JSON.parse(JSON.stringify(sheet));
  again.rows[0] = Object.assign(again.rows[0], { target: 'ciclo', cycle_id: cyc.id });
  again.rows[1] = Object.assign(again.rows[1], { target: 'ciclo', cycle_id: cycFav });
  const r2 = await S.rpc(op1, 'import_sheet', { p: again });
  assert.equal(r2.appointments, 0); assert.equal(r2.duplicates, 7); assert.equal(r2.visits, 0);
  assert.equal(q(`select count(*) from appointments where patient_id in ('${pat}','${fav}')`), '7');
  // omonimo esplicito: nuovo paziente con lo stesso nome
  const homo = { therapist_id: th, month: month(T0), from_date: T0, rows: [{ ref: 'h', target: 'nuovo', homonym: true, patient_name: 'Rossi ' + RUN, category_id: 'mano', planned: 10, prior: 9, duration: 30, weekdays: [2], start: '13:00', cells: [{ day: days(E.addDays(T0, 1), [2], 1)[0], number: 1 }] }] };
  await S.rpc(op1, 'import_sheet', { p: homo });
  assert.equal(q(`select count(*) from patients where name='Rossi ${RUN}'`), '2');
});

test('importazione: conflitti segnalati e tutto o niente; "importa comunque" solo per fuori turno', async () => {
  const th = await therapist('B');
  const [d1, d2] = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 2);
  const base = n => ({ ref: 'x' + n, target: 'nuovo', patient_name: `Conflitto${n} ${RUN}`, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [E.weekday(d1)], start: '06:30' });
  // fuori dalla fascia ambulatoriale: rifiutato, nulla salvato
  await expectError(S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(d1), from_date: d1, rows: [Object.assign(base(1), { cells: [{ day: d1, number: 10 }] })] } }), 'FA_SLOT', /fuori dalle fasce/);
  assert.equal(q(`select count(*) from patients where name='Conflitto1 ${RUN}'`), '0');
  assert.equal(q(`select count(*) from import_batches where therapist_id='${th}'`), '0', 'nulla resta del tentativo');
  // "importa comunque": la seduta entra e compare tra quelle da sistemare
  const r = await S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(d1), from_date: d1, rows: [Object.assign(base(1), { cells: [{ day: d1, number: 10, force: true }] })] } });
  assert.equal(r.forced, 1);
  const id = q(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='Conflitto1 ${RUN}'`);
  const iss = await S.rpc(op1, 'appointment_issues', { p_from: T0, p_to: E.addDays(T0, 30) });
  assert.ok(iss.some(i => i.appointment_id === id && i.kind === 'conflitto'));
  // due pazienti nello stesso posto: impossibile anche con "importa comunque"
  const r2 = Object.assign(base(2), { start: '08:00', cells: [{ day: d2, number: 10, force: true }] });
  const r3 = Object.assign(base(3), { start: '08:00', cells: [{ day: d2, number: 10, force: true }] });
  await expectError(S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(d2), from_date: d2, rows: [r2, r3] } }), 'FA_SLOT', /sovrappongono/);
  assert.equal(q(`select count(*) from patients where name in ('Conflitto2 ${RUN}', 'Conflitto3 ${RUN}')`), '0');
  // assenza del fisioterapista: segnalata
  await S.rpc(op1, 'save_absence', { p: { therapist_id: th, kind: 'ferie', start_date: d2, end_date: d2 } });
  await expectError(S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(d2), from_date: d2, rows: [Object.assign(base(4), { start: '09:00', cells: [{ day: d2, number: 10 }] })] } }), 'FA_SLOT', /assente/);
});

test('annullare un’importazione: elimina ciò che ha creato, conserva le sedute con esito', async () => {
  const th = await therapist('C');
  const past = days(E.addDays(T0, -7), [1, 2, 3, 4, 5], 1)[0];
  const fut = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 2);
  const r = await S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(past), from_date: past, rows: [
    { ref: 'a', target: 'nuovo', patient_name: 'Annulla1 ' + RUN, category_id: 'mano', planned: 10, prior: 2, duration: 30, weekdays: [1, 2, 3, 4, 5], start: '09:00',
      cells: [{ day: past, number: 8 }, { day: fut[0], number: 7 }, { day: fut[1], number: 6 }], visits: [fut[1]] },
    { ref: 'b', target: 'nuovo', patient_name: 'Annulla2 ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 45, weekdays: [1, 2, 3, 4, 5], start: '10:00',
      cells: [{ day: fut[0], number: 10 }] }
  ] } });
  // la seduta passata viene registrata come effettuata: deve restare
  const pastId = q(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='Annulla1 ${RUN}' and a.day='${past}'`);
  await S.rpc(op1, 'register_outcome', { p_id: pastId, p_version: 1, p_status: 'effettuata', p_cancel_by: null, p_to_recover: false, p_note: '' });
  const u = await S.rpc(op1, 'undo_import', { p_batch: r.batch_id });
  assert.deepEqual(u, { appointments: 3, kept: 1, cycles: 1, patients: 1, visits: 1 });
  assert.equal(q(`select count(*) from patients where name='Annulla2 ${RUN}'`), '0', 'paziente creato e non usato: eliminato');
  assert.equal(q(`select count(*) from patients where name='Annulla1 ${RUN}'`), '1', 'paziente con una seduta effettuata: resta');
  assert.equal(q(`select count(*) from appointments where import_batch_id='${r.batch_id}'`), '1');
  assert.notEqual(q(`select undone_at from import_batches where id='${r.batch_id}'`), '');
  await expectError(S.rpc(op1, 'undo_import', { p_batch: r.batch_id }), 'FA_CONFLICT', /già stata annullata/);
  assert.match(q(`select summary from audit_log where action='importazione' and entity_id='${r.batch_id}' order by at desc limit 1`), /annullata/);
});

test('mese successivo, sostituzioni di un collega e ruolo fisioterapista', async () => {
  const A = await therapist('D'), B = await therapist('E');
  const fut = days(E.addDays(T0, 1), [1, 3], 4);
  const r = await S.rpc(op1, 'import_sheet', { p: { therapist_id: A, month: month(fut[0]), from_date: fut[0], rows: [
    { ref: 'm', target: 'nuovo', patient_name: 'Mese ' + RUN, category_id: 'mano', planned: 10, prior: 4, duration: 30, weekdays: [1, 3], start: '08:15',
      cells: [{ day: fut[0], number: 6 }, { day: fut[1], number: 5 }] }] } });
  const cyc = q(`select c.id from cycles c join patients p on p.id=c.patient_id where p.name='Mese ${RUN}'`);
  // il tabulato del mese dopo continua lo stesso ciclo
  await S.rpc(op1, 'import_sheet', { p: { therapist_id: A, month: month(fut[3]), from_date: fut[2], rows: [
    { ref: 'm', target: 'ciclo', cycle_id: cyc, start: '08:15', cells: [{ day: fut[2], number: 4 }, { day: fut[1], number: 5 }] }] } });
  assert.equal(q(`select string_agg(sheet_number::text, ',' order by day) from appointments where cycle_id='${cyc}'`), '6,5,4');
  // sul tabulato di B compare il paziente di A trattato in sostituzione (numero 3)
  const sub = days(E.addDays(fut[2], 1), [5], 1)[0];
  await S.rpc(op1, 'import_sheet', { p: { therapist_id: B, month: month(sub), from_date: sub, rows: [], extra: [{ cycle_id: cyc, day: sub, start: '11:00', number: 3 }] } });
  const a = JSON.parse(q(`select row_to_json(a) from appointments a where cycle_id='${cyc}' and day='${sub}'`));
  assert.equal(a.therapist_id, B); assert.equal(a.original_therapist_id, A); assert.equal(a.substitute_kind, 'singola'); assert.equal(a.sheet_number, 3);
  // il fisioterapista importa solo il proprio tabulato
  await ensureUser('fisio-imp@pilota.test', 'lettura', 'Fisio Import');
  const uid = q("select user_id from profiles where email='fisio-imp@pilota.test'");
  await S.rpc(admin, 'admin_set_user', { p_user: uid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Import', p_therapist: A });
  const fisio = await login('fisio-imp@pilota.test');
  const d = days(E.addDays(T0, 1), [2], 1)[0];
  await expectError(S.rpc(fisio, 'import_sheet', { p: { therapist_id: B, month: month(d), from_date: d, rows: [
    { ref: 'f', target: 'nuovo', patient_name: 'Altrui ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [2], start: '09:00', cells: [{ day: d, number: 10 }] }] } }), 'FA_PERM');
  await S.rpc(fisio, 'import_sheet', { p: { therapist_id: A, month: month(d), from_date: d, rows: [
    { ref: 'f', target: 'nuovo', patient_name: 'Proprio ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [2], start: '09:00', cells: [{ day: d, number: 10 }] }] } });
  await expectError(S.rpc(fisio, 'undo_import', { p_batch: q(`select id from import_batches where therapist_id='${B}' order by created_at desc limit 1`) }), 'FA_PERM');
  // backup: importazioni e visite incluse
  const exp = await S.rpc(admin, 'admin_export', {});
  assert.ok(exp.import_batches.some(b => b.id === r.batch_id)); assert.ok(Array.isArray(exp.patient_events));
});

test('correzioni rapide dal calendario: elimina, numerazione, durata, sedute aggiunte, visita, spostamento di una seduta passata', async () => {
  const th = await therapist('F');
  const past = days(E.addDays(T0, -10), [1, 2, 3, 4, 5], 1)[0];
  const fut = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 4);
  await S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(past), from_date: past, rows: [
    { ref: 'q', target: 'nuovo', patient_name: 'Rapido ' + RUN, category_id: 'mano', planned: 10, prior: 6, duration: 30, weekdays: [1, 2, 3, 4, 5], start: '09:00',
      cells: [{ day: past, number: 4 }, { day: fut[0], number: 3 }, { day: fut[1], number: 2 }] },
    { ref: 'z', target: 'nuovo', patient_name: 'Vicino ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [1, 2, 3, 4, 5], start: '09:40',
      cells: [{ day: fut[1], number: 10 }] }] } });
  const cyc = JSON.parse(q(`select row_to_json(c) from cycles c join patients p on p.id=c.patient_id where p.name='Rapido ${RUN}'`));
  const ap = day => JSON.parse(q(`select row_to_json(a) from appointments a where cycle_id='${cyc.id}' and day='${day}'`));
  // seduta inserita per errore: eliminata (solo se programmata), traccia nello storico
  await S.rpc(op1, 'delete_appointment', { p_id: ap(fut[0]).id, p_version: 1, p_note: 'errore di lettura' });
  assert.equal(q(`select count(*) from appointments where cycle_id='${cyc.id}' and day='${fut[0]}'`), '0');
  assert.match(q(`select summary from audit_log where action='eliminazione' order by at desc limit 1`), /errore di lettura/);
  await S.rpc(op1, 'register_outcome', { p_id: ap(past).id, p_version: 1, p_status: 'effettuata', p_cancel_by: null, p_to_recover: false, p_note: '' });
  await expectError(S.rpc(op1, 'delete_appointment', { p_id: ap(past).id, p_version: 2, p_note: '' }), 'FA_INPUT', /ancora programmate/);
  // numerazione: le sedute precedenti diventano 5; numerazione impossibile rifiutata
  await S.rpc(op1, 'quick_edit_cycle', { p_cycle: cyc.id, p_version: cyc.version, p: { prior_sessions: 5, treatment: 'RM' } });
  let c2 = JSON.parse(q(`select row_to_json(c) from cycles c where id='${cyc.id}'`));
  assert.equal(c2.prior_sessions, 5); assert.equal(c2.treatment, 'RM');
  await expectError(S.rpc(op1, 'quick_edit_cycle', { p_cycle: cyc.id, p_version: c2.version, p: { prior_sessions: 10 } }), 'FA_INPUT', /Numerazione/);
  // durata 45′: la seduta futura delle 9:00 toccherebbe quella delle 9:40 di un altro paziente
  await expectError(S.rpc(op1, 'quick_edit_cycle', { p_cycle: cyc.id, p_version: c2.version, p: { duration: 45 } }), 'FA_SLOT', /occupato/);
  const r35 = await S.rpc(op1, 'quick_edit_cycle', { p_cycle: cyc.id, p_version: c2.version, p: { duration: 40 } });
  assert.equal(r35.resized, 1);
  assert.equal(q(`select to_char(end_time,'HH24:MI') from appointments where cycle_id='${cyc.id}' and day='${fut[1]}'`), '09:40');
  assert.equal(q(`select to_char(end_time,'HH24:MI') from appointments where cycle_id='${cyc.id}' and day='${past}'`), '09:30', 'il passato non cambia');
  // sedute aggiunte entro il numero previsto (5 precedenti + 2 + 3 = 10)
  c2 = JSON.parse(q(`select row_to_json(c) from cycles c where id='${cyc.id}'`));
  const add = [{ day: fut[2], start: '09:00' }, { day: fut[3], start: '09:00' }, { day: days(E.addDays(fut[3], 1), [1, 2, 3, 4, 5], 1)[0], start: '09:00' }];
  await expectError(S.rpc(op1, 'add_cycle_slots', { p_cycle: cyc.id, p_version: c2.version, p_therapist: th, p_slots: add.concat([{ day: E.addDays(fut[3], 14), start: '09:00' }]) }), 'FA_INPUT', /già 7 sedute su 10/);
  await S.rpc(op1, 'add_cycle_slots', { p_cycle: cyc.id, p_version: c2.version, p_therapist: th, p_slots: add });
  assert.equal(q(`select count(*) from appointments where cycle_id='${cyc.id}' and status in ('programmata','effettuata')`), '5');
  // visita fisiatrica in un giorno di trattamento
  await S.rpc(op1, 'save_patient_event', { p_patient: cyc.patient_id, p_day: fut[2], p_note: '', p_delete: false });
  await S.rpc(op1, 'save_patient_event', { p_patient: cyc.patient_id, p_day: fut[2], p_note: 'ore 11', p_delete: false });
  assert.equal(q(`select note from patient_events where patient_id='${cyc.patient_id}' and day='${fut[2]}'`), 'ore 11');
  await S.rpc(op1, 'save_patient_event', { p_patient: cyc.patient_id, p_day: fut[2], p_note: '', p_delete: true });
  assert.equal(q(`select count(*) from patient_events where patient_id='${cyc.patient_id}'`), '0');
  // correzione di una seduta passata importata nel giorno sbagliato (rimasta programmata)
  const wrong = days(E.addDays(T0, -9), [1, 2, 3, 4, 5], 2);
  const r = await S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(wrong[0]), from_date: wrong[0], rows: [
    { ref: 'w', target: 'nuovo', patient_name: 'Passato ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [1, 2, 3, 4, 5], start: '11:00', cells: [{ day: wrong[0], number: 10 }] }] } });
  const w = JSON.parse(q(`select row_to_json(a) from appointments a where import_batch_id='${r.batch_id}'`));
  await S.rpc(op1, 'move_appointment', { p_id: w.id, p_version: w.version, p_therapist: th, p_day: wrong[1], p_start: '11:30', p_note: '' });
  assert.equal(q(`select day||' '||to_char(start_time,'HH24:MI') from appointments where id='${w.id}'`), wrong[1] + ' 11:30');
  // una seduta futura non si sposta nel passato
  const f = JSON.parse(q(`select row_to_json(a) from appointments a where cycle_id='${cyc.id}' and day='${fut[2]}'`));
  await expectError(S.rpc(op1, 'move_appointment', { p_id: f.id, p_version: f.version, p_therapist: th, p_day: wrong[1], p_start: '12:30', p_note: '' }), 'FA_INPUT', /passata/);
});

test('nuovo ciclo sulla stessa riga del tabulato: due cicli dello stesso paziente', async () => {
  const th = await therapist('G');
  const tue = days(E.addDays(T0, 1), [2], 4);
  const r = await S.rpc(op1, 'import_sheet', { p: { therapist_id: th, month: month(tue[0]), from_date: tue[0], rows: [
    { ref: 'n', target: 'nuovo', patient_name: 'Ricomincia ' + RUN, category_id: 'mano', treatment: 'GC', planned: 10, prior: 9, duration: 30, weekdays: [2], start: '08:15',
      cells: [{ day: tue[0], number: 1 }], next: { planned: 10, prior: 0, cells: [{ day: tue[1], number: 10 }, { day: tue[2], number: 9 }] } },
    { ref: 'f', target: 'nuovo', patient_name: 'Finito ' + RUN, category_id: 'mano', planned: 10, prior: 9, duration: 30, weekdays: [2], start: '09:15', concluded: true,
      cells: [{ day: tue[0], number: 1 }] }] } });
  assert.equal(q(`select forecast from cycles c join patients p on p.id=c.patient_id where p.name='Finito ${RUN}'`), 'conclusione_confermata', '"//" = fine ciclo');
  assert.equal(r.cycles, 3); assert.equal(r.appointments, 4); assert.equal(r.patients, 2);
  assert.equal(q(`select string_agg(c.prior_sessions||':'||(select count(*) from appointments a where a.cycle_id=c.id)||':'||c.treatment, ',' order by c.prior_sessions desc)
    from cycles c join patients p on p.id=c.patient_id where p.name='Ricomincia ${RUN}'`), '9:1:GC,0:2:GC');
  const u = await S.rpc(op1, 'undo_import', { p_batch: r.batch_id });
  assert.equal(u.cycles, 3); assert.equal(u.patients, 2);
});

test('sigla di un collega sotto il numero: la seduta va al collega come sostituzione', async () => {
  const A = await therapist('S1'), B = await therapist('S2');
  const [d1, d2] = days(E.addDays(T0, 1), [2, 4], 2);
  const r = await S.rpc(op1, 'import_sheet', { p: { therapist_id: A, month: month(d1), from_date: d1, rows: [
    { ref: 's', target: 'nuovo', patient_name: 'Sostituito ' + RUN, category_id: 'mano', planned: 10, prior: 4, duration: 30, weekdays: [2, 4], start: '09:00',
      cells: [{ day: d1, number: 6, therapist_id: B }, { day: d2, number: 5 }] }] } });
  assert.equal(r.appointments, 2);
  const rows = q(`select string_agg(case when a.therapist_id='${B}' then 'B' else 'A' end||':'||coalesce(a.substitute_kind,'-')||':'||case when a.original_therapist_id='${A}' then 'A' else '-' end, ',' order by a.day)
    from appointments a join patients p on p.id=a.patient_id where p.name='Sostituito ${RUN}'`);
  assert.equal(rows, 'B:singola:A,A:-:-');
  assert.equal(q(`select c.therapist_id from cycles c join patients p on p.id=c.patient_id where p.name='Sostituito ${RUN}'`), A, 'il ciclo resta del titolare');
});
