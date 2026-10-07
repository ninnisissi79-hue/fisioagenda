// Agenda del fisioterapista: permessi (consultazione / modifica / autorizzazione a tempo), settimana tipo
// gestita da chi ha il calendario, scambio di due appuntamenti, annullamento di una modifica, conteggio 10 → 1.
// Server locale REALE (`npm run db:start`), solo dati fittizi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, S, ensureUser, login, today, psql, expectError, ctxFor } from './helpers.mjs';

const RUN = Date.now().toString(36).slice(-5);
let admin, seg, T0;
const DAY = [{ kind: 'amb', start: '07:00', end: '12:00' }, { kind: 'pausa', start: '12:00', end: '12:20' }, { kind: 'amb', start: '12:20', end: '14:30' }];
const WEEK = { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: [], 7: [] };
const q = sql => psql(sql);
const row = sql => JSON.parse(q(sql));

async function therapist(tag) {
  const id = await S.rpc(admin, 'admin_save_therapist', { p: { name: `Ag ${tag} ${RUN}`, activity: 'ambulatorio', skills: [{ category_id: 'mano', level: 'specifica' }] } });
  await S.rpc(admin, 'admin_save_shift', { p_th: id, p_valid_from: E.addDays(T0, -60), p_week: WEEK, p_note: 'test', p_dry_run: false });
  return id;
}
function days(from, wds, n) {
  const closures = new Set(psql("select coalesce(string_agg(day::text, ','), '') from public.closures").split(',').filter(Boolean));
  const out = []; let d = from;
  while (out.length < n) { if (wds.includes(E.weekday(d)) && !closures.has(d)) out.push(d); d = E.addDays(d, 1); }
  return out;
}
/** paziente con un ciclo attivo e sedute programmate (dall'importazione: il modo più breve per crearne uno) */
async function patient(sb, th, name, cells, o = {}) {
  const r = await S.rpc(sb, 'import_sheet', { p: { therapist_id: th, month: cells[0].day.slice(0, 8) + '01', from_date: cells[0].day, rows: [
    Object.assign({ ref: 'x', target: 'nuovo', patient_name: name + ' ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [], start: '09:00', cells }, o)] } });
  assert.equal(r.results[0].ok, true, JSON.stringify(r.results));
  return r.results[0].cycle_id;
}
const appt = (cyc, day) => row(`select row_to_json(a) from appointments a where cycle_id='${cyc}' and day='${day}'`);

test.before(async () => {
  await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
  await ensureUser('seg-ag@pilota.test', 'operatore', 'Segreteria Agenda');
  [admin, seg] = await Promise.all(['coord', 'seg-ag'].map(u => login(u + '@pilota.test')));
  T0 = today();
});

test('permessi: il fisioterapista modifica il proprio calendario, consulta gli altri; autorizzazione a tempo per le agende altrui', async () => {
  const A = await therapist('A'), B = await therapist('B');
  const [d1] = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 1);
  const ca = await patient(seg, A, 'PermA', [{ day: d1, number: 10 }]);
  const cb = await patient(seg, B, 'PermB', [{ day: d1, number: 10 }]);
  await ensureUser('fisio-ag@pilota.test', 'lettura', 'Fisio Agenda');
  const uid = q("select user_id from profiles where email='fisio-ag@pilota.test'");
  await S.rpc(admin, 'admin_set_user', { p_user: uid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Agenda', p_therapist: A });
  const fisio = await login('fisio-ag@pilota.test');
  const me = await S.rpc(fisio, 'whoami', {});
  assert.equal(me.role, 'fisioterapista'); assert.equal(me.therapist_id, A);
  // consultazione: vede anche l'agenda del collega
  const { data: seen } = await fisio.from('appointments').select('id').eq('cycle_id', cb);
  assert.equal(seen.length, 1, 'consulta le agende dei colleghi');
  const a = appt(ca, d1), b = appt(cb, d1);
  await S.rpc(fisio, 'edit_appointment', { p_id: a.id, p_version: a.version, p: { start: '10:00' } });
  await expectError(S.rpc(fisio, 'edit_appointment', { p_id: b.id, p_version: b.version, p: { start: '10:00' } }), 'FA_PERM', /solo il tuo calendario/);
  // settimana tipo: il proprio sì, quella del collega no
  await S.rpc(fisio, 'admin_set_day_override', { p_th: A, p_day: d1, p_blocks: DAY.concat([]).map(x => x.kind === 'pausa' ? Object.assign({}, x, { kind: 'reparto' }) : x), p_note: 'test', p_dry_run: false });
  await expectError(S.rpc(fisio, 'admin_set_day_override', { p_th: B, p_day: d1, p_blocks: DAY, p_note: 'test', p_dry_run: false }), 'FA_PERM');
  // autorizzazione del coordinatore fino a una data: modifica anche le agende altrui (anche sul server)
  await S.rpc(admin, 'admin_set_user', { p_user: uid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Agenda', p_therapist: A, p_edit_until: E.addDays(T0, 7) });
  assert.equal((await S.rpc(fisio, 'whoami', {})).role, 'operatore', 'strumenti della segreteria finché vale l’autorizzazione');
  await S.rpc(fisio, 'edit_appointment', { p_id: b.id, p_version: b.version, p: { start: '10:00' } });
  // scaduta: di nuovo solo il proprio calendario
  await S.rpc(admin, 'admin_set_user', { p_user: uid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Agenda', p_therapist: A, p_edit_until: E.addDays(T0, -1) });
  const b2 = appt(cb, d1);
  await expectError(S.rpc(fisio, 'edit_appointment', { p_id: b2.id, p_version: b2.version, p: { start: '11:00' } }), 'FA_PERM');
  // sostituto della segreteria con un account di sola consultazione
  await ensureUser('sost-seg@pilota.test', 'lettura', 'Sostituto Segreteria');
  const sid = q("select user_id from profiles where email='sost-seg@pilota.test'");
  const sost = await login('sost-seg@pilota.test');
  await expectError(S.rpc(sost, 'edit_appointment', { p_id: b2.id, p_version: b2.version, p: { start: '11:00' } }), 'FA_PERM', /consultazione/);
  await S.rpc(admin, 'admin_set_user', { p_user: sid, p_role: 'lettura', p_active: true, p_full_name: 'Sostituto Segreteria', p_therapist: null, p_edit_until: T0 });
  await S.rpc(sost, 'edit_appointment', { p_id: b2.id, p_version: b2.version, p: { start: '11:00' } });
  assert.match(q(`select summary from audit_log where action='utenti' order by at desc limit 1`), /gestire tutte le agende fino al/);
});

test('scambio di due appuntamenti: un’unica operazione, durate compatibili, stesso o altro fisioterapista; annullabile', async () => {
  const A = await therapist('S1'), B = await therapist('S2');
  const [d1, d2] = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 2);
  const c1 = await patient(seg, A, 'Scambio1', [{ day: d1, number: 10 }], { start: '08:00' });
  const c2 = await patient(seg, A, 'Scambio2', [{ day: d1, number: 10 }], { start: '09:00', duration: 45 });
  const c3 = await patient(seg, B, 'Scambio3', [{ day: d2, number: 10 }], { start: '11:00' });
  const c4 = await patient(seg, A, 'Vicino', [{ day: d1, number: 10 }], { start: '08:30' });
  let a = appt(c1, d1), b = appt(c2, d1);
  // 45 minuti alle 8:00 toccherebbero il paziente delle 8:30: scambio rifiutato, nulla cambia
  await expectError(S.rpc(seg, 'swap_appointments', { p_a: a.id, p_va: a.version, p_b: b.id, p_vb: b.version }), 'FA_SLOT', /Scambio2.*sovrappone a Vicino/);
  assert.equal(appt(c1, d1).start_time, '08:00:00'); assert.equal(appt(c2, d1).start_time, '09:00:00');
  // libero il vicino: lo scambio riesce, ognuno con la propria durata
  const v = appt(c4, d1);
  await S.rpc(seg, 'edit_appointment', { p_id: v.id, p_version: v.version, p: { start: '10:30' } });
  await S.rpc(seg, 'swap_appointments', { p_a: a.id, p_va: a.version, p_b: b.id, p_vb: b.version });
  a = appt(c1, d1); b = appt(c2, d1);
  assert.equal(a.start_time + '-' + a.end_time, '09:00:00-09:30:00'); assert.equal(b.start_time + '-' + b.end_time, '08:00:00-08:45:00');
  assert.equal(q(`select count(*) from row_changes where tbl='appointments' and row_id='${a.id}' and at > now() - interval '1 minute'`), '2', 'una sola modifica per seduta nello storico tecnico (più la creazione)');
  // annulla lo scambio: entrambi tornano com'erano
  await S.rpc(seg, 'undo_appointment_change', { p_ids: [a.id, b.id], p_versions: [a.version, b.version] });
  assert.equal(appt(c1, d1).start_time, '08:00:00'); assert.equal(appt(c2, d1).start_time, '09:00:00');
  // scambio con un collega: diventano sostituzioni, il ciclo resta del titolare
  a = appt(c1, d1); const c = appt(c3, d2);
  await S.rpc(seg, 'swap_appointments', { p_a: a.id, p_va: a.version, p_b: c.id, p_vb: c.version });
  a = appt(c1, d2);
  assert.equal(a.therapist_id, B); assert.equal(a.original_therapist_id, A); assert.equal(a.start_time, '11:00:00');
  assert.equal(q(`select therapist_id from cycles where id='${c1}'`), A);
  assert.match(q(`select summary from audit_log where action='scambio' order by at desc limit 1`), /Scambiati di posto/);
});

test('annullare una modifica: solo se nessuno l’ha cambiata dopo', async () => {
  const A = await therapist('U');
  const [d1] = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 1);
  const c = await patient(seg, A, 'Annulla', [{ day: d1, number: 10 }]);
  let x = appt(c, d1);
  await S.rpc(seg, 'edit_appointment', { p_id: x.id, p_version: x.version, p: { start: '10:00', minutes: 45 } });
  const mine = appt(c, d1).version;
  // un collega cambia di nuovo la stessa seduta
  await S.rpc(admin, 'edit_appointment', { p_id: x.id, p_version: mine, p: { start: '11:00' } });
  await expectError(S.rpc(seg, 'undo_appointment_change', { p_ids: [x.id], p_versions: [mine] }), 'FA_CONFLICT', /modificata di nuovo/);
  assert.equal(appt(c, d1).start_time, '11:00:00', 'la modifica successiva del collega resta');
  // l'ultima modifica si annulla
  const last = appt(c, d1);
  await S.rpc(admin, 'undo_appointment_change', { p_ids: [x.id], p_versions: [last.version] });
  x = appt(c, d1);
  assert.equal(x.start_time + '-' + x.end_time, '10:00:00-10:45:00');
});

test('conteggio 10 → 1: si scala solo con «effettuata», una volta sola; assenze e spostamenti no; il ciclo segue il paziente', async () => {
  const A = await therapist('C1'), B = await therapist('C2');
  const past = days(E.addDays(T0, -20), [1, 2, 3, 4, 5], 3);
  const fut = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 5);
  // paziente già a metà ciclo: 3 sedute fatte prima, poi 3 nel passato e 5 future → 10
  const c = await patient(seg, A, 'Conta', past.map(d => ({ day: d })).concat(fut.map(d => ({ day: d }))), { prior: 2 });
  const counts = async () => { const ctx = await ctxFor(seg, T0); return E.cycleCounts(ctx, c); };
  assert.equal((await counts()).effettuate, 2);
  const out = async (d, st, rec) => { const x = appt(c, d); await S.rpc(seg, 'register_outcome', { p_id: x.id, p_version: x.version, p_status: st, p_cancel_by: null, p_to_recover: !!rec, p_note: '' }); };
  await out(past[0], 'effettuata');
  await out(past[1], 'effettuata');
  // la stessa seduta registrata di nuovo non scala due volte
  await out(past[1], 'effettuata');
  assert.equal((await counts()).effettuate, 4);
  // un'assenza non consuma una seduta
  await out(past[2], 'assente', true);
  let k = await counts();
  assert.equal(k.effettuate, 4); assert.equal(k.previste - k.effettuate, 6, 'ne restano 6');
  // il numero a ritroso sulla prossima seduta: 6, poi 5…
  let ctx = await ctxFor(seg, T0);
  const left = d => { const x = (ctx.byCycle.get(c) || []).find(y => y.day === d); return ctx.cyc.get(c).planned_sessions + 1 - E.sessionNumber(ctx, x); };
  assert.deepEqual(fut.slice(0, 3).map(left), [6, 5, 4]);
  // la seduta passa a un collega: il conteggio non cambia; effettuata con lui → 5; torna al titolare con 5
  const f0 = appt(c, fut[0]);
  await S.rpc(seg, 'edit_appointment', { p_id: f0.id, p_version: f0.version, p: { therapist_id: B } });
  ctx = await ctxFor(seg, T0);
  assert.equal(left(fut[0]), 6);
  // correzione di un esito sbagliato: riallinea il conteggio
  await out(past[2], 'effettuata');
  assert.equal((await counts()).effettuate, 5);
  await out(past[2], 'assente', true);
  assert.equal((await counts()).effettuate, 4);
  // correzione manuale delle sedute già fatte, con traccia
  const cy = row(`select row_to_json(c) from cycles c where id='${c}'`);
  await S.rpc(seg, 'quick_edit_cycle', { p_cycle: c, p_version: cy.version, p: { prior_sessions: 3 } });
  assert.equal((await counts()).effettuate, 5);
  assert.ok(Number(q(`select count(*) from audit_log where entity_id='${c}'`)) >= 1, 'correzione registrata nello storico');
});
