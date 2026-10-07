// Prova nel browser dei casi d'uso quotidiani del tabulato (dati fittizi, database LOCALE):
// 1 il fisioterapista entra e vede subito i pazienti di oggi; 2 la segreteria scrive un paziente toccando un posto vuoto
// (su più giorni, orario 12:20 scritto a mano); 3 un'attività toccando il tabulato; 4 spostamento con «Annulla» e scambio;
// 5 passaggio temporaneo a un collega con il conteggio invariato; 6 assenza che non scala ed effettuata che scala una volta;
// 7 ferie con i pazienti da ricollocare; 8 mesi precedenti consultabili e non modificabili con un tocco;
// 9 modifiche visibili agli altri utenti in tempo reale, nel rispetto dei permessi.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, ensureUser, login, PASSWORD, psql, E, S } from './helpers.mjs';

const PORT = 8095, RUN = Date.now().toString(36).slice(-4);
let step = 0;
const ok = m => console.log(`✓ ${++step}. ${m}`);
const q = sql => psql(sql);
const row = sql => JSON.parse(q(sql));
await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
await ensureUser('seg-e2e@pilota.test', 'operatore', 'Segreteria Prova');
await ensureUser('fisio-e2e@pilota.test', 'lettura', 'Fisio Prova');
const admin = await login('coord@pilota.test');
const T0 = q('select app.today()');
const closures = new Set(q("select coalesce(string_agg(day::text, ','), '') from closures").split(',').filter(Boolean));
const work = (from, n, wds = [1, 2, 3, 4, 5]) => { const o = []; let d = from; while (o.length < n) { if (wds.includes(E.weekday(d)) && !closures.has(d)) o.push(d); d = E.addDays(d, 1); } return o; };
const DAY = [{ kind: 'amb', start: '07:00', end: '12:00' }, { kind: 'pausa', start: '12:00', end: '12:20' }, { kind: 'amb', start: '12:20', end: '15:00' }];
const ALL = { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: DAY, 7: DAY };
const mk = async name => {
  const id = await S.rpc(admin, 'admin_save_therapist', { p: { name: name + ' ' + RUN, activity: 'ambulatorio', skills: [{ category_id: 'mano', level: 'specifica' }] } });
  await S.rpc(admin, 'admin_save_shift', { p_th: id, p_valid_from: E.addDays(T0, -60), p_week: ALL, p_note: 'prova', p_dry_run: false });
  return id;
};
const A = await mk('Agenda'), B = await mk('Collega');
const fisioUid = q("select user_id from profiles where email='fisio-e2e@pilota.test'");
await S.rpc(admin, 'admin_set_user', { p_user: fisioUid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Prova', p_therapist: A });
const seg = await login('seg-e2e@pilota.test');
// pazienti di oggi per il fisioterapista (anche oggi è un giorno di lavoro nella settimana tipo di prova)
const imp = async (th, rows, from) => S.rpc(seg, 'import_sheet', { p: { therapist_id: th, month: from.slice(0, 8) + '01', from_date: from, rows } });
const F = work(E.addDays(T0, 7), 6);   // giorni futuri di lavoro
const r0 = await imp(A, [
  { ref: 'o1', target: 'nuovo', patient_name: 'Oggi Uno ' + RUN, category_id: 'mano', planned: 10, prior: 6, duration: 30, weekdays: [], start: '07:30', cells: [{ day: T0 }, { day: F[0] }] },
  { ref: 'o2', target: 'nuovo', patient_name: 'Oggi Due ' + RUN, category_id: 'mano', planned: 10, prior: 2, duration: 45, weekdays: [], start: '08:30', cells: [{ day: T0 }, { day: F[0] }, { day: F[1] }] },
  { ref: 'o3', target: 'nuovo', patient_name: 'Scambio ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [], start: '10:00', cells: [{ day: F[0] }] }], T0);
assert.ok(r0.results.every(x => x.ok), JSON.stringify(r0.results));
const cyc = n => q(`select c.id from cycles c join patients p on p.id=c.patient_id where p.name='${n} ${RUN}'`);
const ap = (n, d) => row(`select row_to_json(a) from appointments a join patients p on p.id=a.patient_id where p.name='${n} ${RUN}' and a.day='${d}' and a.status not in ('spostata','liberata')`);

const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.js'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const browser = await chromium.launch();
const errors = [];
async function open(email, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(email + ': ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.fill('#em', email); await page.fill('#pw', PASSWORD); await page.click('button[type=submit]');
  await page.waitForSelector('nav a[href="#/calendario"]', { timeout: 20000 });
  return page;
}
const goCal = (page, th, d, mode) => page.evaluate(([t, x, m]) => { location.hash = '#/calendario/' + t + '/' + x + '/' + m; }, [th, d, mode]);
/** tocco su un punto del tabulato all'ora indicata */
async function tap(page, d, hhmm) {
  const col = page.locator(`.wk-col[data-day="${d}"]`);
  await col.waitFor();
  const min0 = Number(await col.getAttribute('data-min'));
  await col.click({ position: { x: 12, y: (E.toMin(hhmm) - min0) * 1.25 + 2 } });
}
try {
  // ------------------------------------------------------------------ 1
  const fp = await open('fisio-e2e@pilota.test', { width: 820, height: 1000 });
  await fp.waitForSelector('.today-list');
  const tl = await fp.textContent('.today-list');
  assert.match(tl, new RegExp('Oggi Uno ' + RUN)); assert.match(tl, new RegExp('Oggi Due ' + RUN));
  assert.match(tl, /07:30–08:00/); assert.match(tl, /\(45′\)/);
  assert.match(tl, /restano 4 sedute, compresa questa/, 'Oggi Uno: 6 fatte su 10 → oggi è la 7ª, ne restano 4');
  await fp.click('.today-list button:has-text("Il mio tabulato")');
  await fp.waitForSelector('.mo-grid');
  assert.match(await fp.textContent('h2'), /Tabulato di Agenda/);
  ok('Il fisioterapista entra e vede subito i pazienti di oggi (orario, durata, sedute che restano); un tocco apre il tabulato del mese');

  // ------------------------------------------------------------------ 2
  const sp = await open('seg-e2e@pilota.test');
  await goCal(sp, A, F[2], 'settimana');
  await tap(sp, F[2], '13:00');
  await sp.waitForSelector('.drawer');
  assert.equal(await sp.$eval('.drawer select[data-bind="pd.th"]', e => e.value), A, 'fisioterapista già compilato');
  assert.equal(await sp.$eval('.drawer input[data-bind="pd.day"]', e => e.value), F[2], 'giorno già compilato');
  assert.equal(await sp.$eval('.drawer input[data-bind="pd.start"]', e => e.value), '13:00', 'ora già compilata');
  await sp.fill('.drawer input[data-bind="pd.q"]', 'Nuovo ' + RUN);
  // orario scritto a mano, con il cursore che resta al suo posto: 12:20 resta 12:20
  await sp.fill('.drawer input[data-bind="pd.start"]', '');
  await sp.type('.drawer input[data-bind="pd.start"]', '12:20', { delay: 60 });
  await sp.press('.drawer input[data-bind="pd.start"]', 'Tab');
  assert.equal(await sp.$eval('.drawer input[data-bind="pd.start"]', e => e.value), '12:20');
  // tre giorni la settimana, 6 sedute rimanenti, 45 minuti
  const wd = E.weekday(F[2]);
  for (const w of [1, 3, 5]) if (w !== wd) await sp.click(`.drawer button[data-act="pd-day"][data-wd="${w}"]`);
  if (![1, 3, 5].includes(wd)) await sp.click(`.drawer button[data-act="pd-day"][data-wd="${wd}"]`);
  await sp.click('.drawer button[data-act="seg"][data-path="pd.dur"][data-val="45"]');
  await sp.fill('.drawer input[data-bind="pd.left"]', '6'); await sp.press('.drawer input[data-bind="pd.left"]', 'Tab');
  await sp.waitForFunction(() => document.querySelectorAll('.drawer .pd-list li').length === 6);
  assert.match(await sp.textContent('.drawer .pd-list'), /6.*5.*4.*3.*2.*1/s, 'anteprima con il conto alla rovescia');
  await sp.click('.drawer button[data-act="pd-save"]');
  await sp.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  const nuovo = q(`select string_agg(to_char(a.start_time,'HH24:MI')||'/'||extract(isodow from a.day)||'/'||(extract(epoch from a.end_time-a.start_time)/60)::int, ',' order by a.day) from appointments a join patients p on p.id=a.patient_id where p.name='Nuovo ${RUN}'`);
  assert.equal(nuovo.split(',').length, 6);
  assert.ok(nuovo.split(',').every(x => /^12:20\/[135]\/45$/.test(x)), nuovo);
  assert.equal(q(`select planned_sessions||'/'||prior_sessions from cycles c join patients p on p.id=c.patient_id where p.name='Nuovo ${RUN}'`), '6/0');
  ok('La segreteria tocca un posto vuoto: fisioterapista, giorno e ora già compilati; paziente nuovo su lunedì, mercoledì e venerdì alle 12:20 (scritto a mano), 45 minuti, 6 sedute');

  // ------------------------------------------------------------------ 3
  await goCal(sp, A, F[3], 'giorno');
  await tap(sp, F[3], '14:00');
  await sp.waitForSelector('.drawer');
  await sp.click('.drawer button[data-act="seg"][data-path="pd.kind"][data-val="attivita"]');
  await sp.selectOption('.drawer select[data-bind="pd.act.kind"]', 'reparto');
  await sp.fill('.drawer input[data-bind="pd.act.start"]', '14:00'); await sp.press('.drawer input[data-bind="pd.act.start"]', 'Tab');
  await sp.fill('.drawer input[data-bind="pd.act.end"]', '14:45'); await sp.press('.drawer input[data-bind="pd.act.end"]', 'Tab');
  await sp.click('.drawer button[data-act="pd-save"]');
  await sp.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.match(q(`select blocks::text from day_overrides where therapist_id='${A}' and day='${F[3]}'`), /reparto.*14:00.*14:45|14:00.*14:45.*reparto/);
  await sp.waitForSelector(`.wk-col[data-day="${F[3]}"] .k-reparto`);
  ok('Attività scritta toccando il tabulato (reparto 14:00–14:45, solo quel giorno), senza passare da «Orario»');

  // ------------------------------------------------------------------ 4
  const s1 = ap('Scambio', F[0]);
  await goCal(sp, A, F[0], 'giorno');
  await sp.click(`.wk-appt[data-id="${s1.id}"]`);
  await sp.click('.modal button:has-text("Cambia giorno, ora o durata")');
  await sp.fill('.modal input[data-bind="am.pick.start"]', '11:10'); await sp.press('.modal input[data-bind="am.pick.start"]', 'Tab');
  await sp.waitForSelector('.modal .form-note:has-text("Posto libero")');
  await sp.click('.modal button:has-text("Salva la modifica")');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(ap('Scambio', F[0]).start_time, '11:10:00');
  await sp.click('.toast.undo button');
  await sp.waitForFunction(id => { const e = document.querySelector('.wk-appt[data-id="' + id + '"]'); return e && e.textContent.includes('10:00'); }, s1.id, { timeout: 15000 });
  assert.equal(ap('Scambio', F[0]).start_time, '10:00:00', '«Annulla» riporta la seduta com’era');
  // scambio con il paziente delle 8:30 (45′): un'unica operazione
  const o2 = ap('Oggi Due', F[0]);
  await sp.click(`.wk-appt[data-id="${s1.id}"]`);
  await sp.click('.modal button:has-text("Scambia con un altro paziente")');
  await sp.click(`.modal button[data-act="sw-pick"][data-b="${o2.id}"]`);
  await sp.waitForSelector('.modal .form-note:has-text("compatibili")');
  await sp.click('.modal button:has-text("⇄ Scambia")');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(ap('Scambio', F[0]).start_time, '08:30:00'); assert.equal(ap('Oggi Due', F[0]).start_time, '10:00:00');
  assert.equal(ap('Oggi Due', F[0]).end_time, '10:45:00', 'ognuno con la propria durata');
  ok('Seduta spostata alle 11:10 e riportata com’era con «Annulla»; due pazienti scambiati di posto in un’unica operazione, ognuno con la propria durata');

  // ------------------------------------------------------------------ 5
  const leftBefore = await sp.$eval(`.wk-appt[data-id="${o2.id}"] .cnt`, e => e.textContent);
  await sp.click(`.wk-appt[data-id="${o2.id}"]`);
  await sp.click('.modal button:has-text("Passa a un altro fisioterapista")');
  await sp.selectOption('.modal select[data-bind="am.pick.th"]', B);
  await sp.waitForSelector('.modal .form-note:has-text("Posto libero")');
  await sp.click('.modal button:has-text("Salva la modifica")');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await goCal(sp, B, F[0], 'giorno');
  await sp.waitForSelector(`.wk-appt[data-id="${o2.id}"]`);
  assert.equal(await sp.$eval(`.wk-appt[data-id="${o2.id}"] .cnt`, e => e.textContent), leftBefore, 'dal collega il conteggio resta lo stesso');
  assert.match(await sp.textContent(`.wk-appt[data-id="${o2.id}"]`), /sostituisce Agenda/);
  assert.equal(q(`select therapist_id from cycles where id='${cyc('Oggi Due')}'`), A, 'il ciclo resta del titolare');
  ok('Paziente passato temporaneamente a un collega: stesso conto alla rovescia (' + leftBefore + '), il ciclo resta del titolare');

  // ------------------------------------------------------------------ 6
  const today1 = ap('Oggi Uno', T0), today2 = ap('Oggi Due', T0);
  await fp.click('nav a[href="#/oggi"]');
  await fp.waitForSelector(`.today-list button[data-act="today-out"][data-id="${today2.id}"][data-s="assente_rec"]`);
  await fp.click(`.today-list button[data-act="today-out"][data-id="${today2.id}"][data-s="assente_rec"]`);
  await fp.waitForFunction(() => !document.querySelector('.toast:not(.undo)') || true);
  await fp.waitForFunction(id => !document.querySelector('.today-list button[data-id="' + id + '"]'), today2.id, { timeout: 15000 });
  const eff = c => Number(q(`select prior_sessions + (select count(*) from appointments where cycle_id=c.id and status='effettuata') from cycles c where id='${c}'`));
  assert.equal(eff(cyc('Oggi Due')), 2, 'l’assenza non scala la seduta');
  await fp.click(`.today-list button[data-act="today-out"][data-id="${today1.id}"][data-s="effettuata"]`);
  await fp.waitForFunction(id => !document.querySelector('.today-list button[data-id="' + id + '"]'), today1.id, { timeout: 15000 });
  assert.equal(eff(cyc('Oggi Uno')), 7);
  assert.ok(!(await fp.$(`.today-list button[data-id="${today1.id}"]`)), 'una volta registrata, non si può scalare di nuovo');
  assert.match(await fp.textContent('.today-list'), /1 già registrati come effettuati/);
  ok('Dal fisioterapista: assenza (da recuperare) che non scala la seduta; «Effettuata» che la scala una sola volta');

  // ------------------------------------------------------------------ 7
  const ferie = q(`select min(a.day) from appointments a join patients p on p.id=a.patient_id where p.name='Nuovo ${RUN}' and a.day > '${F[2]}'`);
  await goCal(sp, A, ferie, 'giorno');
  await tap(sp, ferie, '09:30');
  await sp.waitForSelector('.drawer');
  await sp.click('.drawer button[data-act="seg"][data-path="pd.kind"][data-val="assenza"]');
  await sp.click('.drawer button[data-act="seg"][data-path="pd.ab.kind"][data-val="ferie"]');
  await sp.check('.drawer input[data-bind="pd.ab.allDay"]');
  await sp.waitForSelector('.drawer .form-warn:has-text("da ricollocare")');
  await sp.click('.drawer button[data-act="pd-save"]');
  await sp.waitForURL(/#\/assenze\/piano\//, { timeout: 15000 });
  await sp.waitForSelector(`text=Nuovo ${RUN}`);
  ok('Ferie registrate dal tabulato: i pazienti di quel giorno compaiono subito da ricollocare, con i colleghi proposti');

  // ------------------------------------------------------------------ 8
  const past = E.addDays(T0, -35);
  const before = q(`select count(*) from appointments where therapist_id='${A}' and day < '${T0}'`);
  await goCal(fp, A, past, 'mese');
  await fp.waitForSelector('.mo-grid');
  await fp.click('button[aria-label="Avanti"]');
  await fp.waitForSelector('.mo-grid');
  await goCal(fp, A, E.addDays(T0, -1 - (E.weekday(T0) === 1 ? 2 : 0)), 'giorno');
  const pastDay = E.addDays(T0, -1 - (E.weekday(T0) === 1 ? 2 : 0));
  await tap(fp, pastDay, '09:00');
  await fp.waitForTimeout(300);
  assert.ok(!(await fp.$('.drawer')), 'un giorno passato non si scrive con un tocco');
  assert.equal(q(`select count(*) from appointments where therapist_id='${A}' and day < '${T0}'`), before);
  ok('Mesi precedenti consultabili (vista mese, avanti/indietro); un giorno passato non si modifica per sbaglio');

  // ------------------------------------------------------------------ 9
  // il fisioterapista vede l'agenda del collega in consultazione: il tocco non scrive, il server rifiuta comunque
  await goCal(fp, B, F[1], 'giorno');
  await fp.waitForSelector('.cal-bar');
  assert.match(await fp.textContent('main'), /serve l’autorizzazione del coordinatore/);
  await tap(fp, F[1], '09:00');
  await fp.waitForTimeout(300);
  assert.ok(!(await fp.$('.drawer')), 'consultazione: nessun inserimento sull’agenda del collega');
  // la segreteria sposta un paziente del fisioterapista: compare da lui senza ricaricare la pagina
  await goCal(fp, A, F[1], 'giorno');
  const o2b = ap('Oggi Due', F[1]);
  await fp.waitForSelector(`.wk-appt[data-id="${o2b.id}"]`);
  await S.rpc(seg, 'edit_appointment', { p_id: o2b.id, p_version: o2b.version, p: { start: '13:15' } });
  await fp.waitForFunction(id => { const e = document.querySelector('.wk-appt[data-id="' + id + '"]'); return e && e.textContent.includes('13:15'); }, o2b.id, { timeout: 20000 });
  // autorizzazione del coordinatore: ora può scrivere anche nell'agenda del collega
  await S.rpc(admin, 'admin_set_user', { p_user: fisioUid, p_role: 'fisioterapista', p_active: true, p_full_name: 'Fisio Prova', p_therapist: A, p_edit_until: E.addDays(T0, 3) });
  await fp.reload(); await fp.waitForSelector('nav a[href="#/calendario"]');
  await goCal(fp, B, F[1], 'giorno');
  await tap(fp, F[1], '09:00');
  await fp.waitForSelector('.drawer');
  assert.match(await fp.textContent('.pilot-banner'), /autorizzato a gestire tutte le agende/);
  ok('Le modifiche della segreteria compaiono al fisioterapista in tempo reale; l’agenda del collega è in consultazione finché il coordinatore non autorizza');

  assert.deepEqual(errors, [], 'nessun errore nella pagina');
} finally {
  await browser.close(); server.kill();
}
console.log('Tutte le prove del tabulato superate.');
