// Verifiche sul server condiviso REALE in esecuzione locale (database, account, permessi, tempo reale).
// Prerequisito: `npm run db:start` (Docker). Ogni test crea i propri fisioterapisti e pazienti fittizi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, S, ensureUser, login, anon, ctxFor, today, workdays, psql, expectError } from './helpers.mjs';

const RUN = Date.now().toString(36).slice(-5);
let admin, op1, op2, reader, T0;

const WEEK = (() => {
  const day = [
    { kind: 'preparazione', start: '07:45', end: '08:00' },
    { kind: 'amb', start: '08:00', end: '12:00' },
    { kind: 'pausa', start: '12:00', end: '12:30' },
    { kind: 'amb', start: '12:30', end: '14:00' },
    { kind: 'documentazione', start: '14:00', end: '14:30' }
  ];
  return { 1: day, 2: day, 3: day, 4: day, 5: day, 6: [], 7: [] };
})();

async function team(tag, defs) {
  const ids = {};
  for (const [key, skills] of Object.entries(defs)) {
    const id = await S.rpc(admin, 'admin_save_therapist', { p: {
      name: `Test ${tag}-${key} ${RUN}`, activity: 'ambulatorio', skills: skills.map(([c, l]) => ({ category_id: c, level: l }))
    } });
    await S.rpc(admin, 'admin_save_shift', { p_th: id, p_valid_from: E.addDays(T0, -30), p_week: WEEK, p_note: 'test', p_dry_run: false });
    ids[key] = id;
  }
  return ids;
}

/** n date settimanali dallo stesso giorno, saltando le chiusure. */
function weekly(d0, n) {
  const closures = new Set(psql("select coalesce(string_agg(day::text, ','), '') from public.closures").split(',').filter(Boolean));
  const out = []; let d = d0;
  while (out.length < n) { if (!closures.has(d)) out.push(d); d = E.addDays(d, 7); }
  return out;
}

async function book(sb, { name, cat, th, start, dur = 30, dates, forecast }) {
  const r = await S.rpc(sb, 'create_request', { p: { patient_name: name + ' ' + RUN, category_id: cat, duration: dur, planned_sessions: dates.length, weekdays: [E.weekday(dates[0])] } });
  const ver = Number(psql(`select version from cycles where id='${r.cycle_id}'`));
  await S.rpc(sb, 'book_cycle', { p_cycle: r.cycle_id, p_version: ver, p_therapist: th, p_start: start, p_weekdays: [E.weekday(dates[0])], p_dates: dates });
  if (forecast) {
    const v2 = Number(psql(`select version from cycles where id='${r.cycle_id}'`));
    await S.rpc(sb, 'update_cycle_info', { p_cycle: r.cycle_id, p_version: v2, p: { forecast } });
  }
  return r;
}
const apptOf = (cycleId, day) => JSON.parse(psql(`select row_to_json(a) from appointments a where cycle_id='${cycleId}' and day='${day}' and status <> 'spostata' order by created_at desc limit 1`));

test.before(async () => {
  await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
  await ensureUser('op1@pilota.test', 'operatore', 'Operatore Uno');
  await ensureUser('op2@pilota.test', 'operatore', 'Operatore Due');
  await ensureUser('lettore@pilota.test', 'lettura', 'Consultazione');
  [admin, op1, op2, reader] = await Promise.all(['coord', 'op1', 'op2', 'lettore'].map(u => login(u + '@pilota.test')));
  T0 = today();
  await S.rpc(admin, 'admin_save_category', { p_id: 'solo_a_' + RUN, p_name: 'Percorso raro ' + RUN, p_active: true, p_sort: 99 });
});

test('permessi: sola consultazione e operatore non possono fare modifiche riservate (verifica sul server)', async () => {
  const [d] = workdays(E.addDays(T0, 1), 1);
  const ids = await team('perm', { A: [['mano', 'specifica']] });
  await expectError(S.rpc(reader, 'create_request', { p: { patient_name: 'X', category_id: 'mano', duration: 30, planned_sessions: 5 } }), 'FA_PERM');
  await expectError(S.rpc(op1, 'admin_save_shift', { p_th: ids.A, p_valid_from: d, p_week: WEEK, p_note: '', p_dry_run: false }), 'FA_PERM', /coordinatore/);
  await expectError(S.rpc(op1, 'admin_set_user', { p_user: '00000000-0000-0000-0000-000000000000', p_role: 'admin', p_active: true, p_full_name: '' }), 'FA_PERM');
  await expectError(S.rpc(op1, 'admin_export', {}), 'FA_PERM');
  // scrittura diretta sulle tabelle, aggirando l'interfaccia: rifiutata dal database
  const ins = await op1.from('therapists').insert({ name: 'Intruso', activity: 'ambulatorio' });
  assert.ok(ins.error, 'inserimento diretto rifiutato');
  const upd = await op1.from('appointments').update({ status: 'effettuata' }).neq('id', '00000000-0000-0000-0000-000000000000').select();
  assert.ok(upd.error || upd.data.length === 0, 'modifica diretta rifiutata');
  // chi non ha effettuato l'accesso non vede nulla
  const a = await anon().from('appointments').select('id').limit(1);
  assert.ok(a.error || a.data.length === 0);
  await expectError(S.rpc(anon(), 'appointment_issues', {}), null);
  // un account disattivato perde subito l'accesso
  await ensureUser('ex@pilota.test', 'operatore');
  const ex = await login('ex@pilota.test');
  psql("update profiles set active=false where email='ex@pilota.test'");
  await expectError(S.rpc(ex, 'create_request', { p: { patient_name: 'X', category_id: 'mano', duration: 30, planned_sessions: 5 } }), 'FA_AUTH');
  // il coordinatore invece può
  const conf = await S.rpc(admin, 'admin_save_shift', { p_th: ids.A, p_valid_from: E.addDays(T0, 60), p_week: WEEK, p_note: '', p_dry_run: true });
  assert.equal(conf.dry_run, true);
});

test('due utenti prenotano lo stesso posto nello stesso momento: uno solo riesce', async () => {
  const ids = await team('conc', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 2), 1);
  const dates = weekly(d, 5);
  for (let round = 0; round < 3; round++) {
    const start = E.fromMin(8 * 60 + round * 30);
    const r1 = await S.rpc(op1, 'create_request', { p: { patient_name: 'Conc1 ' + RUN, category_id: 'mano', duration: 30, planned_sessions: 5 } });
    const r2 = await S.rpc(op2, 'create_request', { p: { patient_name: 'Conc2 ' + RUN, category_id: 'mano', duration: 30, planned_sessions: 5 } });
    const res = await Promise.allSettled([
      S.rpc(op1, 'book_cycle', { p_cycle: r1.cycle_id, p_version: 1, p_therapist: ids.A, p_start: start, p_weekdays: [E.weekday(d)], p_dates: dates }),
      S.rpc(op2, 'book_cycle', { p_cycle: r2.cycle_id, p_version: 1, p_therapist: ids.A, p_start: start, p_weekdays: [E.weekday(d)], p_dates: dates })
    ]);
    const ok = res.filter(r => r.status === 'fulfilled');
    const ko = res.filter(r => r.status === 'rejected');
    assert.equal(ok.length, 1, 'una sola prenotazione confermata');
    assert.equal(ko.length, 1);
    assert.equal(ko[0].reason.kind, 'FA_SLOT');
    // la richiesta perdente non ha alcuna seduta salvata e resta in lista d'attesa
    const lost = ok[0] === res[0] ? r2 : r1;
    assert.equal(psql(`select count(*) from appointments where cycle_id='${lost.cycle_id}'`), '0');
    assert.equal(psql(`select status from cycles where id='${lost.cycle_id}'`), 'in_attesa');
  }
  // anche aggirando i controlli, il vincolo del database impedisce la sovrapposizione
  assert.throws(() => psql(`insert into appointments (cycle_id, patient_id, therapist_id, day, start_time, end_time)
    select cycle_id, patient_id, therapist_id, day, start_time + interval '10 minutes', end_time + interval '10 minutes' from appointments
    where therapist_id='${ids.A}' and status='programmata' limit 1`), /no_double_booking|no_patient_overlap/);
});

test('modifiche contemporanee: la seconda modifica su dati vecchi è rifiutata', async () => {
  const ids = await team('ver', { A: [['mano', 'specifica']], B: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const r = await book(op1, { name: 'Versione', cat: 'mano', th: ids.A, start: '09:00', dates: weekly(d, 5) });
  const a = apptOf(r.cycle_id, d);
  await S.rpc(op1, 'move_appointment', { p_id: a.id, p_version: a.version, p_therapist: ids.A, p_day: d, p_start: '10:00', p_note: '' });
  const e = await expectError(S.rpc(op2, 'move_appointment', { p_id: a.id, p_version: a.version, p_therapist: ids.B, p_day: d, p_start: '09:00', p_note: '' }), 'FA_CONFLICT');
  assert.match(e.message, /Operatore Uno/);
});

test('fisioterapista assente oggi: pazienti distribuiti tra più sostituti, stesso orario, ciclo invariato', async () => {
  const ids = await team('ass', { A: [['mano', 'specifica']], B: [['mano', 'specifica']], C: [['mano', 'abilitato']], D: [['orto', 'specifica']] });
  const [d] = workdays(T0, 1);
  const p1 = await book(op1, { name: 'Distrib1', cat: 'mano', th: ids.A, start: '08:00', dates: weekly(d, 5) });
  const p2 = await book(op1, { name: 'Distrib2', cat: 'mano', th: ids.A, start: '08:30', dates: weekly(d, 5) });
  const p3 = await book(op1, { name: 'Distrib3', cat: 'mano', th: ids.A, start: '09:00', dates: weekly(d, 5) });
  // B (competenza specifica) è libero solo alle 8:00
  await book(op1, { name: 'OccB1', cat: 'mano', th: ids.B, start: '08:30', dates: weekly(d, 5), forecast: 'conclusione_confermata' });
  await book(op1, { name: 'OccB2', cat: 'mano', th: ids.B, start: '09:00', dates: weekly(d, 5), forecast: 'conclusione_confermata' });
  const abs = await S.rpc(op1, 'save_absence', { p: { therapist_id: ids.A, kind: 'malattia', start_date: d, end_date: d } });
  let ctx = await ctxFor(op1, T0);
  const affected = E.affectedByAbsence(ctx, abs).filter(a => [p1, p2, p3].some(p => p.cycle_id === a.cycle_id));
  assert.equal(affected.length, 3);
  // altri team creati da test diversi non devono interferire: limitiamo ai sostituti di questo test
  const own = new Set(Object.values(ids));
  ctx.th.forEach((t, k) => { if (!own.has(k)) ctx.th.set(k, Object.assign({}, t, { active: false })); });
  const opt1 = E.substitutionOptions(ctx, affected[0]);
  assert.deepEqual(opt1.sameTime.map(o => o.therapist_id), [ids.B, ids.C], 'prima la competenza specifica, poi gli abilitati');
  assert.ok(!opt1.sameTime.some(o => o.therapist_id === ids.D), 'il collega non abilitato non è proposto');
  const plan = E.proposeDistribution(ctx, affected);
  const sel = affected.map(a => plan.get(a.id));
  assert.ok(sel.every(s => s.action === 'sostituisci' && s.sameTime), 'tutti allo stesso orario');
  assert.equal(sel[0].therapist_id, ids.B);
  assert.equal(sel[1].therapist_id, ids.C);
  assert.equal(sel[2].therapist_id, ids.C);
  assert.ok([...E.validateSelections(ctx, affected, plan).values()].every(v => v.ok));
  const res = await S.rpc(op1, 'apply_substitutions', { p_items: affected.map(a => {
    const s = plan.get(a.id);
    return { appointment_id: a.id, version: a.version, action: 'sostituisci', therapist_id: s.therapist_id, day: s.day, start_time: s.start, kind: 'singola' };
  }) });
  assert.ok(res.every(r => r.ok), JSON.stringify(res));
  const after = apptOf(p1.cycle_id, d);
  assert.equal(after.therapist_id, ids.B);
  assert.equal(after.substitute_kind, 'singola');
  assert.equal(after.original_therapist_id, ids.A);
  assert.equal(after.start_time, '08:00:00');
  // il ciclo e le sedute dei giorni successivi restano con il titolare
  assert.equal(psql(`select therapist_id from cycles where id='${p1.cycle_id}'`), ids.A);
  assert.equal(psql(`select count(*) from appointments where cycle_id='${p1.cycle_id}' and day > '${d}' and therapist_id='${ids.A}'`), '4');
  // nessun appuntamento coinvolto resta in conflitto
  const issues = await S.rpc(op1, 'appointment_issues', { p_from: d, p_to: d });
  assert.ok(!issues.some(i => affected.some(a => a.id === i.appointment_id)));
  // storico: chi ha fatto cosa
  const log = psql(`select user_name || ' | ' || summary from audit_log where action='sostituzione' and summary like '%Distrib1 ${RUN}%' order by id desc limit 1`);
  assert.match(log, /^Operatore Uno \| .*affidata a Test ass-B/);
});

test('nessun sostituto compatibile: il paziente resta "da riprogrammare" con il motivo', async () => {
  const cat = 'solo_a_' + RUN;
  const ids = await team('nos', { A: [[cat, 'specifica']], B: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const p = await book(op1, { name: 'Raro', cat, th: ids.A, start: '10:00', dates: weekly(d, 5) });
  const abs = await S.rpc(op1, 'save_absence', { p: { therapist_id: ids.A, kind: 'malattia', start_date: d, end_date: d } });
  const ctx = await ctxFor(op1, T0);
  const aff = E.affectedByAbsence(ctx, abs);
  assert.equal(aff.length, 1);
  const plan = E.proposeDistribution(ctx, aff);
  const s = plan.get(aff[0].id);
  assert.equal(s.action, 'da_riprogrammare');
  assert.match(s.reason, /Nessun altro collega è abilitato al percorso Percorso raro/);
  // il server rifiuta comunque un'assegnazione incompatibile
  const bad = await S.rpc(op1, 'apply_substitutions', { p_items: [{ appointment_id: aff[0].id, version: aff[0].version, action: 'sostituisci', therapist_id: ids.B, start_time: '10:00', kind: 'singola' }] });
  assert.equal(bad[0].ok, false);
  assert.match(bad[0].message, /non è abilitato/);
  const res = await S.rpc(op1, 'apply_substitutions', { p_items: [{ appointment_id: aff[0].id, version: aff[0].version, action: 'da_riprogrammare', reason: s.reason }] });
  assert.ok(res[0].ok);
  const a = apptOf(p.cycle_id, d);
  assert.equal(a.status, 'da_riprogrammare');
  assert.match(a.reason, /Nessun altro collega/);
  const issues = await S.rpc(op1, 'appointment_issues', {});
  assert.ok(issues.some(i => i.appointment_id === a.id && i.kind === 'da_riprogrammare'), 'resta visibile tra le attività da sistemare');
});

test('due proposte sullo stesso posto sono alternative: non si possono confermare entrambe', async () => {
  const ids = await team('alt', { A: [['mano', 'specifica']], B: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const p1 = await book(op1, { name: 'Alt1', cat: 'mano', th: ids.A, start: '11:00', dates: weekly(d, 5) });
  const p2 = await book(op1, { name: 'Alt2', cat: 'mano', th: ids.A, start: '11:15', dur: 45, dates: weekly(d, 5) }).catch(() => null);
  assert.equal(p2, null, 'sovrapposto sullo stesso fisioterapista: rifiutato');
  const p3 = await book(op1, { name: 'Alt3', cat: 'mano', th: ids.A, start: '11:30', dates: weekly(d, 5) });
  const ctx = await ctxFor(op1, T0);
  const a1 = apptOf(p1.cycle_id, d), a3 = apptOf(p3.cycle_id, d);
  const appts = [a1, a3].map(a => ctx.appt.get(a.id));
  const sel = new Map([
    [a1.id, { action: 'sostituisci', therapist_id: ids.B, day: d, start: '11:00', end: '11:30' }],
    [a3.id, { action: 'sostituisci', therapist_id: ids.B, day: d, start: '11:00', end: '11:30' }]
  ]);
  const v = E.validateSelections(ctx, appts, sel);
  assert.equal(v.get(a1.id).ok, false);
  assert.equal(v.get(a3.id).ok, false);
  assert.match(v.get(a3.id).msg, /alternative/);
  // anche se inviate insieme, il server ne conferma una sola
  const res = await S.rpc(op1, 'apply_substitutions', { p_items: [a1, a3].map(a => ({ appointment_id: a.id, version: a.version, action: 'sostituisci', therapist_id: ids.B, day: d, start_time: '11:00', kind: 'singola' })) });
  assert.deepEqual(res.map(r => r.ok), [true, false]);
  assert.match(res[1].message, /Posto già occupato|paziente/);
});

test('assenza parziale (fascia oraria): coinvolge solo gli appuntamenti nella fascia', async () => {
  const ids = await team('par', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const early = await book(op1, { name: 'Presto', cat: 'mano', th: ids.A, start: '08:00', dates: weekly(d, 5) });
  const late = await book(op1, { name: 'Tardi', cat: 'mano', th: ids.A, start: '12:30', dates: weekly(d, 5) });
  const abs = await S.rpc(op1, 'save_absence', { p: { therapist_id: ids.A, kind: 'permesso', start_date: d, end_date: d, start_time: '08:00', end_time: '10:00' } });
  const ctx = await ctxFor(op1, T0);
  const aff = E.affectedByAbsence(ctx, abs);
  assert.deepEqual(aff.map(a => a.cycle_id), [early.cycle_id]);
  assert.equal(E.checkSlot(ctx, ids.A, d, '10:00', '10:30'), null, 'disponibile dopo la fascia di assenza');
  assert.ok(E.checkSlot(ctx, ids.A, d, '09:30', '10:00'));
  const issues = await S.rpc(op1, 'appointment_issues', { p_from: d, p_to: d });
  assert.ok(issues.some(i => i.appointment_id === apptOf(early.cycle_id, d).id));
  assert.ok(!issues.some(i => i.appointment_id === apptOf(late.cycle_id, d).id));
});

test('assenza senza data di rientro: serve la data fino a cui organizzare, i giorni successivi sono da verificare', async () => {
  const ids = await team('unk', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const p = await book(op1, { name: 'Rientro', cat: 'mano', th: ids.A, start: '13:00', dates: weekly(d, 5) });
  await expectError(S.rpc(op1, 'save_absence', { p: { therapist_id: ids.A, kind: 'malattia', start_date: d } }), 'FA_INPUT', /fino a quale data/);
  const planUntil = E.addDays(d, 7);
  const abs = await S.rpc(op1, 'save_absence', { p: { therapist_id: ids.A, kind: 'malattia', start_date: d, plan_until: planUntil } });
  assert.equal(abs.end_date, null);
  const ctx = await ctxFor(op1, T0);
  const aff = E.affectedByAbsence(ctx, abs);
  assert.deepEqual(aff.map(a => a.day), [d, E.addDays(d, 7)].filter(x => x <= planUntil));
  const later = E.toVerifyAfter(ctx, abs);
  assert.ok(later.length >= 3, 'giornate successive segnalate');
  // nessuna disponibilità certa successiva: non si presume il rientro
  const [far] = workdays(E.addDays(d, 63), 1);
  assert.match(E.checkSlot(ctx, ids.A, far, '10:00', '10:30').msg, /rientro non noto/);
  const issues = await S.rpc(op1, 'appointment_issues', { p_from: d, p_to: E.addDays(d, 60) });
  const mine = issues.filter(i => later.some(a => a.id === i.appointment_id));
  assert.ok(mine.length >= 3 && mine.every(i => i.kind === 'da_verificare'));
  assert.ok(issues.some(i => i.appointment_id === aff[0].id && i.kind === 'conflitto'));
  void p;
});

test('paziente assente con recupero: la seduta non svolta non conta, il recupero sì', async () => {
  const ids = await team('rec', { A: [['mano', 'specifica']] });
  const [d] = workdays(T0, 1);
  const p = await book(op1, { name: 'Recupero', cat: 'mano', th: ids.A, start: '08:00', dates: weekly(d, 5) });
  const a = apptOf(p.cycle_id, d);
  const future = apptOf(p.cycle_id, E.addDays(d, 7));
  await expectError(S.rpc(op1, 'register_outcome', { p_id: future.id, p_version: future.version, p_status: 'effettuata' }), 'FA_INPUT', /futura/);
  await S.rpc(op1, 'register_outcome', { p_id: a.id, p_version: a.version, p_status: 'assente', p_to_recover: true, p_note: 'febbre' });
  let ctx = await ctxFor(op1, T0);
  let c = E.cycleCounts(ctx, p.cycle_id);
  assert.equal(c.effettuate, 0);
  assert.equal(c.assenze, 1);
  assert.equal(c.daRecuperare, 1);
  const [r] = workdays(E.addDays(d, 1), 1);
  const a2 = apptOf(p.cycle_id, d);
  const rid = await S.rpc(op1, 'book_recovery', { p_orig: a.id, p_version: a2.version, p_therapist: ids.A, p_day: r, p_start: '11:00' });
  await expectError(S.rpc(op2, 'book_recovery', { p_orig: a.id, p_version: a2.version + 1, p_therapist: ids.A, p_day: r, p_start: '11:30' }), 'FA_CONFLICT');
  ctx = await ctxFor(op1, T0);
  c = E.cycleCounts(ctx, p.cycle_id);
  assert.equal(c.daRecuperare, 0);
  assert.equal(c.recuperi, 1);
  assert.equal(c.programmate, 5, '4 sedute del ciclo + 1 recupero');
  assert.equal(c.effettuate, 0);
  assert.equal(c.mancanoDaProgrammare, 0);
  assert.equal(psql(`select recovery_of from appointments where id='${rid}'`), a.id);
});

test('sospensione per ticket non regolarizzato e ripresa senza ripristinare posti in conflitto', async () => {
  const ids = await team('sos', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const dates = weekly(d, 5);
  const p = await book(op1, { name: 'Ticket', cat: 'mano', th: ids.A, start: '12:30', dates, forecast: 'conclusione_confermata' });
  const ver = () => Number(psql(`select version from cycles where id='${p.cycle_id}'`));
  await expectError(S.rpc(op1, 'suspend_cycle', { p_cycle: p.cycle_id, p_version: ver(), p_reason: 'ticket', p_note: '', p_keep: true, p_review: null, p_from: d }), 'FA_INPUT', /rivalutazione/);
  const s = await S.rpc(op1, 'suspend_cycle', { p_cycle: p.cycle_id, p_version: ver(), p_reason: 'ticket', p_note: 'in attesa di regolarizzazione', p_keep: false, p_review: null, p_from: d });
  assert.equal(s.changed, 5);
  assert.equal(psql(`select count(*) from appointments where cycle_id='${p.cycle_id}' and status='liberata' and freed_for='sospensione'`), '5');
  // un altro paziente occupa uno dei posti liberati
  await book(op2, { name: 'Occupa', cat: 'mano', th: ids.A, start: '12:30', dates: [dates[2], ...weekly(E.addDays(dates[4], 7), 4)] });
  const prev = await S.rpc(op1, 'resume_cycle', { p_cycle: p.cycle_id, p_version: ver(), p_from: dates[1], p_dry_run: true });
  assert.equal(prev.dry_run, true);
  assert.equal(prev.restored, 3);
  assert.equal(prev.to_reschedule, 1);
  assert.equal(psql(`select status from cycles where id='${p.cycle_id}'`), 'sospeso', 'l\'anteprima non modifica nulla');
  const res = await S.rpc(op1, 'resume_cycle', { p_cycle: p.cycle_id, p_version: ver(), p_from: dates[1], p_dry_run: false });
  assert.equal(res.restored, 3);
  assert.equal(psql(`select status from appointments where cycle_id='${p.cycle_id}' and day='${dates[2]}'`), 'da_riprogrammare');
  assert.equal(psql(`select status from appointments where cycle_id='${p.cycle_id}' and day='${dates[0]}'`), 'liberata', 'data precedente alla ripresa non ripristinata');
  assert.equal(psql(`select status from cycles where id='${p.cycle_id}'`), 'attivo');
  assert.match(psql(`select summary from audit_log where action='sospensione' and entity_id='${p.cycle_id}'`), /ticket non regolarizzato/);
});

test('chiusura anticipata: posti futuri liberati, storico e sedute effettuate conservati', async () => {
  const ids = await team('chi', { A: [['mano', 'specifica']], B: [['mano', 'specifica']] });
  const [d] = workdays(T0, 1);
  const p = await book(op1, { name: 'Chiusura', cat: 'mano', th: ids.A, start: '09:30', dates: weekly(d, 5) });
  const a = apptOf(p.cycle_id, d);
  await S.rpc(op1, 'register_outcome', { p_id: a.id, p_version: a.version, p_status: 'effettuata' });
  const from = E.addDays(d, 1);
  const r = await S.rpc(op1, 'close_cycle', { p_cycle: p.cycle_id, p_version: Number(psql(`select version from cycles where id='${p.cycle_id}'`)), p_reason: 'obiettivi raggiunti', p_from: from });
  assert.deepEqual(r, { freed: 4, done: 1 });
  assert.equal(psql(`select count(*) from appointments where cycle_id='${p.cycle_id}'`), '5', 'nessun appuntamento cancellato');
  assert.equal(psql(`select status from cycles where id='${p.cycle_id}'`), 'chiuso');
  // il posto liberato è subito prenotabile da un altro paziente
  await book(op2, { name: 'Dopo', cat: 'mano', th: ids.A, start: '09:30', dates: weekly(E.addDays(d, 7), 5) });
});

test('modifica di una sola seduta: il resto del ciclo non cambia', async () => {
  const ids = await team('one', { A: [['mano', 'specifica']], B: [['mano', 'abilitato']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const p = await book(op1, { name: 'Singola', cat: 'mano', th: ids.A, start: '10:30', dates: weekly(d, 5) });
  const before = psql(`select string_agg(id::text||therapist_id::text||day||start_time||version, ',' order by day) from appointments where cycle_id='${p.cycle_id}' and day <> '${E.addDays(d, 7)}'`);
  const a = apptOf(p.cycle_id, E.addDays(d, 7));
  await S.rpc(op1, 'move_appointment', { p_id: a.id, p_version: a.version, p_therapist: ids.B, p_day: E.addDays(d, 8), p_start: '13:00', p_note: 'richiesta del paziente' });
  const after = psql(`select string_agg(id::text||therapist_id::text||day||start_time||version, ',' order by day) from appointments where cycle_id='${p.cycle_id}' and id <> '${a.id}'`);
  assert.equal(after, before);
  const moved = JSON.parse(psql(`select row_to_json(a) from appointments a where id='${a.id}'`));
  assert.equal(moved.therapist_id, ids.B);
  assert.equal(moved.substitute_kind, 'singola');
  assert.equal(psql(`select therapist_id from cycles where id='${p.cycle_id}'`), ids.A);
  // modifica del ciclo da una data: solo le sedute successive, con traccia delle precedenti
  const ver = Number(psql(`select version from cycles where id='${p.cycle_id}'`));
  const from = E.addDays(d, 14);
  const newDates = weekly(E.addDays(from, 1), 3);
  await S.rpc(op1, 'reschedule_cycle', { p_cycle: p.cycle_id, p_version: ver, p_from: from, p_therapist: ids.A, p_start: '13:30', p_weekdays: [E.weekday(newDates[0])], p_dates: newDates });
  assert.equal(psql(`select count(*) from appointments where cycle_id='${p.cycle_id}' and status='spostata'`), '3');
  assert.equal(psql(`select status||start_time from appointments where cycle_id='${p.cycle_id}' and day='${d}'`), 'programmata10:30:00');
});

test('cambio di turno con decorrenza: storico conservato e appuntamenti incompatibili segnalati', async () => {
  const ids = await team('tur', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 7), 1);
  const p = await book(op1, { name: 'Turno', cat: 'mano', th: ids.A, start: '08:00', dates: weekly(d, 5) });
  const p2 = await book(op1, { name: 'TurnoOk', cat: 'mano', th: ids.A, start: '10:00', dates: weekly(d, 5) });
  const late = { ...WEEK };
  const day = [{ kind: 'reparto', start: '08:00', end: '09:30' }, { kind: 'amb', start: '09:30', end: '13:30' }, { kind: 'documentazione', start: '13:30', end: '14:00' }];
  [1, 2, 3, 4, 5].forEach(k => { late[k] = day; });
  const from = E.addDays(d, 7);
  await expectError(S.rpc(admin, 'admin_save_shift', { p_th: ids.A, p_valid_from: E.addDays(T0, -1), p_week: late, p_note: '', p_dry_run: false }), 'FA_INPUT', /passato/);
  const prev = await S.rpc(admin, 'admin_save_shift', { p_th: ids.A, p_valid_from: from, p_week: late, p_note: 'reparto al mattino', p_dry_run: true });
  assert.equal(prev.conflicts.length, 4, 'segnalate le 4 sedute dalle 8:00 dalla decorrenza');
  assert.match(prev.conflicts[0].message, /reparto 08:00–09:30/);
  assert.equal(psql(`select count(*) from shift_versions where therapist_id='${ids.A}'`), '1', 'anteprima: nulla salvato');
  const res = await S.rpc(admin, 'admin_save_shift', { p_th: ids.A, p_valid_from: from, p_week: late, p_note: 'reparto al mattino', p_dry_run: false });
  assert.equal(res.conflicts.length, 4);
  assert.equal(psql(`select count(*) from shift_versions where therapist_id='${ids.A}'`), '2', 'storico dei turni conservato');
  assert.equal(psql(`select count(*) from appointments where cycle_id='${p.cycle_id}' and status='programmata'`), '5', 'nessun appuntamento spostato in automatico');
  const issues = await S.rpc(op1, 'appointment_issues', { p_from: d, p_to: E.addDays(d, 60) });
  assert.equal(issues.filter(i => res.conflicts.some(c => c.appointment_id === i.appointment_id)).length, 4);
  assert.ok(!issues.some(i => i.appointment_id === apptOf(p2.cycle_id, from).id));
  assert.ok(!issues.some(i => i.appointment_id === apptOf(p.cycle_id, d).id), 'prima della decorrenza vale il turno precedente');
  // variazione di una singola giornata
  const ov = await S.rpc(admin, 'admin_set_day_override', { p_th: ids.A, p_day: d, p_blocks: [{ kind: 'amb', start: '11:00', end: '14:00' }], p_note: 'riunione', p_dry_run: true });
  assert.equal(ov.conflicts.length, 2);
});

test('un posto futuro soltanto probabile non è prenotabile finché la conclusione non è confermata', async () => {
  const ids = await team('pro', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const p = await book(op1, { name: 'Probabile', cat: 'mano', th: ids.A, start: '13:00', dates: weekly(d, 5), forecast: 'probabile_conclusione' });
  const after = weekly(E.addDays(d, 35), 5);
  const ctx = await ctxFor(op1, T0);
  const opts = E.searchCycle(ctx, { categoryId: 'mano', duration: 30, weekdays: [E.weekday(d)], sessions: 5, from: after[0], weeks: 1 })
    .filter(o => o.therapist_id === ids.A && o.start === '13:00');
  assert.equal(opts.length, 1);
  assert.equal(opts[0].status, 'probabile');
  assert.deepEqual(opts[0].dependsOn, [p.cycle_id]);
  await expectError(book(op2, { name: 'Troppo presto', cat: 'mano', th: ids.A, start: '13:00', dates: after }), 'FA_SLOT', /solo probabile/);
  await S.rpc(op1, 'update_cycle_info', { p_cycle: p.cycle_id, p_version: Number(psql(`select version from cycles where id='${p.cycle_id}'`)), p: { forecast: 'conclusione_confermata' } });
  await book(op2, { name: 'Ora sì', cat: 'mano', th: ids.A, start: '13:00', dates: after });
});

test('aggiornamento visibile agli altri colleghi in tempo reale', async () => {
  const ids = await team('rt', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const got = [];
  const ch = op2.channel('test-rt-' + RUN).on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, p => got.push(p));
  await new Promise((res, rej) => ch.subscribe(s => { if (s === 'SUBSCRIBED') res(); if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') rej(new Error(s)); }));
  await new Promise(r => setTimeout(r, 2500));
  const p = await book(op1, { name: 'TempoReale', cat: 'mano', th: ids.A, start: '08:30', dates: weekly(d, 5) });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !got.some(g => g.new && g.new.cycle_id === p.cycle_id)) await new Promise(r => setTimeout(r, 100));
  await op2.removeChannel(ch);
  assert.ok(got.some(g => g.new && g.new.cycle_id === p.cycle_id), 'il secondo utente riceve la nuova prenotazione');
});

test('backup e ripristino da parte del coordinatore', async () => {
  const before = await S.rpc(admin, 'admin_export', {});
  assert.equal(before.format, 'fisioagenda-pilota');
  const nAppt = before.appointments.length;
  assert.ok(nAppt > 100);
  assert.ok(!('slot' in before.appointments[0]));
  const extra = await S.rpc(op1, 'create_request', { p: { patient_name: 'Dopo il backup ' + RUN, category_id: 'mano', duration: 30, planned_sessions: 5 } });
  await expectError(S.rpc(admin, 'admin_restore', { p: before, p_confirm: 'si' }), 'FA_INPUT', /RIPRISTINA/);
  await expectError(S.rpc(op1, 'admin_restore', { p: before, p_confirm: 'RIPRISTINA' }), 'FA_PERM');
  const counts = await S.rpc(admin, 'admin_restore', { p: before, p_confirm: 'RIPRISTINA' });
  assert.equal(counts.appointments, nAppt);
  assert.equal(psql(`select count(*) from cycles where id='${extra.cycle_id}'`), '0', 'tornati allo stato del backup');
  assert.equal(psql('select count(*) from appointments'), String(nAppt));
  assert.match(psql("select user_name || ' ' || action from audit_log order by id desc limit 1"), /Coordinatrice Prova ripristino/);
});

test('ciclo già in corso: si prenotano solo le sedute rimanenti, quelle già svolte contano come effettuate', async () => {
  const ids = await team('cor', { A: [['mano', 'specifica']] });
  const [d] = workdays(E.addDays(T0, 1), 1);
  const r = await S.rpc(op1, 'create_request', { p: { patient_name: 'In corso ' + RUN, category_id: 'mano', duration: 30, planned_sessions: 10, prior_sessions: 4,
    request_type: 'continuazione', weekdays: [E.weekday(d)] } });
  await expectError(S.rpc(op1, 'book_cycle', { p_cycle: r.cycle_id, p_version: 1, p_therapist: ids.A, p_start: '12:30', p_weekdays: [E.weekday(d)], p_dates: weekly(d, 10) }), 'FA_INPUT', /6 date/);
  await S.rpc(op1, 'book_cycle', { p_cycle: r.cycle_id, p_version: 1, p_therapist: ids.A, p_start: '12:30', p_weekdays: [E.weekday(d)], p_dates: weekly(d, 6) });
  const ctx = await ctxFor(op1, T0);
  const c = E.cycleCounts(ctx, r.cycle_id);
  assert.equal(c.effettuate, 4);
  assert.equal(c.precedenti, 4);
  assert.equal(c.programmate, 6);
  assert.equal(c.mancanoDaProgrammare, 0);
  await expectError(S.rpc(op1, 'create_request', { p: { patient_name: 'Troppe ' + RUN, category_id: 'mano', duration: 30, planned_sessions: 5, prior_sessions: 5 } }), null);
});
