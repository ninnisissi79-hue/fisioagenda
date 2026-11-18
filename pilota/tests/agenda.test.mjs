// Agenda del fisioterapista: permessi (consultazione / modifica / autorizzazione a tempo), settimana tipo
// gestita da chi ha il calendario, scambio di due appuntamenti, annullamento di una modifica, conteggio 10 → 1.
// Server locale REALE (`npm run db:start`), solo dati fittizi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, S, ensureUser, login, today, psql, expectError, ctxFor } from './helpers.mjs';

const RUN = 'c' + (Date.now() % 100000); // con una cifra: il paziente è un codice cartella
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

test('conteggio 10 → 1: le sedute passate contano da sole, l’assenza no; una correzione riallinea; il ciclo segue il paziente', async () => {
  const A = await therapist('C1'), B = await therapist('C2');
  const past = days(E.addDays(T0, -20), [1, 2, 3, 4, 5], 3);
  const fut = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 5);
  // paziente già a metà ciclo: 2 sedute fatte prima, poi 3 nel passato e 5 future → 10
  const c = await patient(seg, A, 'Conta', past.map(d => ({ day: d })).concat(fut.map(d => ({ day: d }))), { prior: 2 });
  const counts = async () => { const ctx = await ctxFor(seg, T0); return E.cycleCounts(ctx, c); };
  assert.equal((await counts()).effettuate, 5, 'la presenza non si segna: le 3 sedute passate contano da sole');
  const out = async (d, st) => { const x = appt(c, d); await S.rpc(seg, 'register_outcome', { p_id: x.id, p_version: x.version, p_status: st, p_cancel_by: null, p_to_recover: false, p_note: '' }); };
  // registrare comunque «effettuata» non scala due volte
  await out(past[0], 'effettuata');
  assert.equal((await counts()).effettuate, 5);
  // un'assenza non consuma una seduta
  await out(past[2], 'assente');
  let k = await counts();
  assert.equal(k.effettuate, 4); assert.equal(k.previste - k.effettuate, 6, 'ne restano 6');
  // il numero a ritroso sulla prossima seduta: 6, poi 5…
  let ctx = await ctxFor(seg, T0);
  const left = d => { const x = (ctx.byCycle.get(c) || []).find(y => y.day === d); return ctx.cyc.get(c).planned_sessions + 1 - E.sessionNumber(ctx, x); };
  assert.deepEqual(fut.slice(0, 3).map(left), [6, 5, 4]);
  // la seduta passa a un collega: il conteggio non cambia
  const f0 = appt(c, fut[0]);
  await S.rpc(seg, 'edit_appointment', { p_id: f0.id, p_version: f0.version, p: { therapist_id: B } });
  ctx = await ctxFor(seg, T0);
  assert.equal(left(fut[0]), 6);
  // assenza segnata per errore e tolta: il conteggio torna come prima
  await out(past[2], 'programmata');
  assert.equal((await counts()).effettuate, 5);
  // correzione manuale delle sedute già fatte, con traccia
  const cy = row(`select row_to_json(c) from cycles c where id='${c}'`);
  await S.rpc(seg, 'quick_edit_cycle', { p_cycle: c, p_version: cy.version, p: { prior_sessions: 3 } });
  assert.equal((await counts()).effettuate, 6);
  assert.ok(Number(q(`select count(*) from audit_log where entity_id='${c}'`)) >= 1, 'correzione registrata nello storico');
});

test('tabulato semplice: spia gialla per le modifiche degli altri, fisioterapisti gestiti dalla segreteria, presenza non da segnare, nuove attività', async () => {
  const A = await therapist('Y');
  const [d1] = days(E.addDays(T0, 1), [1, 2, 3, 4, 5], 1);
  await ensureUser('fisio-y@pilota.test', 'lettura', 'Fisio Y');
  const uid = q("select user_id from profiles where email='fisio-y@pilota.test'");
  await S.rpc(admin, 'admin_set_user', { p_user: uid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Y', p_therapist: A });
  const fisio = await login('fisio-y@pilota.test');
  const c = await patient(seg, A, 'Giallo', [{ day: d1 }]);
  await S.rpc(seg, 'mark_changes_seen', { p_ids: null });
  // il fisioterapista sposta un suo paziente: alla segreteria si accende la spia gialla, a lui no
  const x = appt(c, d1);
  await S.rpc(fisio, 'edit_appointment', { p_id: x.id, p_version: x.version, p: { start: '10:30' } });
  const mine = await S.rpc(seg, 'my_changes', {});
  const it = mine.find(m => m.action === 'spostamento' && m.summary.includes('Giallo'));
  assert.ok(it, 'modifica del collega visibile alla segreteria'); assert.equal(it.user_name, 'Fisio Y');
  assert.deepEqual(await S.rpc(fisio, 'my_changes', {}), [], 'i fisioterapisti non hanno la spia');
  // «Visto» personale
  await S.rpc(seg, 'mark_changes_seen', { p_ids: [it.id] });
  assert.ok(!(await S.rpc(seg, 'my_changes', {})).some(m => m.id === it.id));
  assert.ok((await S.rpc(admin, 'my_changes', {})).some(m => m.id === it.id), 'al coordinatore resta finché non la vede lui');
  // fisioterapisti: li aggiunge la segreteria, non il fisioterapista
  const nid = await S.rpc(seg, 'admin_save_therapist', { p: { name: 'Nuovo dalla segreteria ' + RUN, activity: 'ambulatorio', skills: [{ category_id: 'mano', level: 'abilitato' }] } });
  assert.ok(nid);
  await expectError(S.rpc(fisio, 'admin_save_therapist', { p: { name: 'Non ammesso ' + RUN, activity: 'ambulatorio', skills: [] } }), 'FA_PERM');
  // presenza: le sedute passate non chiedono più l'esito
  const past = days(E.addDays(T0, -10), [1, 2, 3, 4, 5], 1)[0];
  await patient(seg, A, 'Passato', [{ day: past }]);
  const iss = await S.rpc(seg, 'appointment_issues', { p_from: E.addDays(T0, -30), p_to: E.addDays(T0, 30) });
  assert.ok(!iss.some(i => i.kind === 'esito_mancante'));
  // nuove attività scritte a mano, con un nome libero
  await S.rpc(fisio, 'admin_set_day_override', { p_th: A, p_day: d1, p_blocks: [{ kind: 'amb', start: '07:00', end: '12:00' }, { kind: 'gruppo', start: '12:00', end: '13:00', label: 'Gruppo schiena' }, { kind: 'ortesi', start: '13:00', end: '14:00' }], p_note: '', p_dry_run: false });
  assert.match(q(`select blocks::text from day_overrides where therapist_id='${A}' and day='${d1}'`), /Gruppo schiena/);
});

test('avvisi: al fisioterapista paziente nuovo o sostituzione (uno per operazione, con le sedute); spia gialla solo per le modifiche dei fisioterapisti', async () => {
  const A = await therapist('Av'), B = await therapist('Bv');
  await ensureUser('fisio-av@pilota.test', 'lettura', 'Fisio Avvisi');
  const uid = q("select user_id from profiles where email='fisio-av@pilota.test'");
  await S.rpc(admin, 'admin_set_user', { p_user: uid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Avvisi', p_therapist: A });
  const fisio = await login('fisio-av@pilota.test');
  await S.rpc(fisio, 'mark_alerts_seen', { p_ids: null });
  const [d1, d2, d3] = days(E.addDays(T0, 2), [1, 3, 5], 3);
  // la segreteria scrive un paziente nuovo nel tabulato del fisioterapista: un avviso con le 3 sedute
  const c = await patient(seg, A, 'Nuovo', [{ day: d1 }, { day: d2 }, { day: d3 }]);
  let al = await S.rpc(fisio, 'my_alerts', {});
  assert.equal(al.length, 1, JSON.stringify(al));
  assert.equal(al[0].kind, 'nuovo_paziente'); assert.match(al[0].patient_name, /Nuovo/); assert.equal(al[0].sessions.length, 3);
  assert.equal(al[0].by_name, 'Segreteria Agenda');
  // sedute aggiunte o spostate a un paziente che ha già: nessun nuovo avviso
  const x = appt(c, d1);
  await S.rpc(seg, 'edit_appointment', { p_id: x.id, p_version: x.version, p: { start: '10:30' } });
  assert.equal((await S.rpc(fisio, 'my_alerts', {})).length, 1);
  // il fisioterapista sul proprio tabulato: nessun avviso a se stesso
  const y = appt(c, d2);
  await S.rpc(fisio, 'edit_appointment', { p_id: y.id, p_version: y.version, p: { start: '11:00' } });
  assert.equal((await S.rpc(fisio, 'my_alerts', {})).length, 1);
  // collega malato: due pazienti affidati in due momenti = due avvisi, con titolare e motivo
  const cb1 = await patient(seg, B, 'DiCollega1', [{ day: d1, start: '08:00' }], { start: '08:00' });
  const cb2 = await patient(seg, B, 'DiCollega2', [{ day: d1, start: '08:30' }], { start: '08:30' });
  await S.rpc(seg, 'save_absence', { p: { therapist_id: B, kind: 'malattia', start_date: d1, end_date: d1 } });
  for (const cy of [cb1, cb2]) { const a = appt(cy, d1); await S.rpc(seg, 'edit_appointment', { p_id: a.id, p_version: a.version, p: { therapist_id: A, force: true } }); }
  al = await S.rpc(fisio, 'my_alerts', {});
  const subs = al.filter(a => a.kind === 'sostituzione');
  assert.equal(subs.length, 2, JSON.stringify(al));
  assert.equal(subs[0].owner_id, B); assert.match(subs[0].owner_name, /Ag Bv/); assert.equal(subs[0].owner_absence, 'malattia');
  // la seduta torna al titolare: nessun avviso per lui
  const back = appt(cb1, d1);
  await S.rpc(seg, 'edit_appointment', { p_id: back.id, p_version: back.version, p: { therapist_id: B, force: true } });
  assert.equal(q(`select count(*) from therapist_alerts where therapist_id='${B}' and cycle_id='${cb1}'`), '1', 'solo l’avviso dell’inserimento');
  // «Visto»: uno alla volta o tutti
  const sent = id => S.rpc(seg, 'office_alerts', {}).then(l => l.find(x => x.id === id));
  assert.equal((await sent(subs[0].id)).seen_at, null, 'la segreteria vede l’avviso inviato, non ancora letto');
  assert.equal((await sent(subs[0].id)).therapist_id, A);
  await S.rpc(fisio, 'mark_alerts_seen', { p_ids: [subs[0].id] });
  assert.equal((await S.rpc(fisio, 'my_alerts', {})).length, 2);
  assert.ok((await sent(subs[0].id)).seen_at, 'segreteria: ✓✓ letto');
  assert.ok((await S.rpc(admin, 'office_alerts', {})).some(x => x.id === subs[0].id && x.seen_at), 'anche il coordinatore');
  assert.deepEqual(await S.rpc(fisio, 'office_alerts', {}), [], 'i fisioterapisti non vedono gli avvisi dei colleghi');
  assert.deepEqual(await S.rpc(seg, 'my_alerts', {}), [], 'la segreteria non ha un tabulato suo');
  await S.rpc(fisio, 'mark_alerts_seen', { p_ids: null });
  assert.deepEqual(await S.rpc(fisio, 'my_alerts', {}), []);
  // spia gialla: la modifica del fisioterapista sì (con il suo tabulato), quella della segreteria no
  const ch = await S.rpc(admin, 'my_changes', {});
  const byFisio = ch.find(m => m.user_name === 'Fisio Avvisi' && m.summary.includes('Nuovo'));
  assert.ok(byFisio); assert.equal(byFisio.by_therapist, A);
  assert.ok(!ch.some(m => m.user_name === 'Segreteria Agenda'), 'le modifiche della segreteria non accendono la spia gialla');
});

test('codice cartella al posto del nome: un nome viene rifiutato, un codice è un paziente solo', async () => {
  const req = name => S.rpc(seg, 'create_request', { p: { patient_name: name, category_id: 'mano', duration: 30, planned_sessions: 5 } });
  await expectError(req('Mario Rossi'), 'FA_INPUT', /almeno una cifra/);
  await expectError(req('Rossì 12'), 'FA_INPUT', /non valido/);
  await expectError(req('2026/' + RUN + '-abcdefghijklm'), 'FA_INPUT', /20 caratteri/);
  const code = '2026/' + RUN;
  const r = await req('  ' + code + ' ');
  assert.equal(q(`select name from patients p join cycles c on c.patient_id=p.id where c.id='${r.cycle_id}'`), code, 'spazi tolti');
  await expectError(req(code.toLowerCase().replace('/', ' / ')), 'FA_INPUT', /Esiste già un paziente con il codice cartella/);
  const pat = row(`select row_to_json(p) from patients p join cycles c on c.patient_id=p.id where c.id='${r.cycle_id}'`);
  await expectError(S.rpc(seg, 'update_patient', { p_id: pat.id, p_version: pat.version, p_name: 'Bianchi', p_note: '' }), 'FA_INPUT', /almeno una cifra/);
  await S.rpc(seg, 'update_patient', { p_id: pat.id, p_version: pat.version, p_name: code + 'B', p_note: '' });
  assert.match(q(`select summary from audit_log where action='paziente' order by id desc limit 1`), /codice cartella cambiato in/);
});

test('svuota pazienti e sedute: solo coordinatore, con conferma scritta; fisioterapisti e orari restano', async () => {
  const nTh = q('select count(*) from therapists');
  await expectError(S.rpc(seg, 'admin_clear_patients', { p_confirm: 'SVUOTA' }), 'FA_PERM');
  await expectError(S.rpc(admin, 'admin_clear_patients', { p_confirm: 'si' }), 'FA_INPUT', /SVUOTA/);
  const r = await S.rpc(admin, 'admin_clear_patients', { p_confirm: 'SVUOTA' });
  assert.ok(r.patients > 0);
  assert.equal(q('select count(*) from patients') + '/' + q('select count(*) from appointments') + '/' + q('select count(*) from cycles'), '0/0/0');
  assert.equal(q('select count(*) from therapists'), nTh);
  assert.ok(Number(q('select count(*) from shift_versions')) > 0);
  assert.match(q("select summary from audit_log where action='svuotamento' order by at desc limit 1"), /svuotato/);
});
