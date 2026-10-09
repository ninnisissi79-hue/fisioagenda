// Prova nel browser del tabulato mensile a griglia (dati fittizi, database LOCALE), anche a misura di cellulare:
// 1 il fisioterapista entra e vede i pazienti di oggi (la presenza non si segna); 2 paziente nuovo scritto in una riga vuota
// del tabulato (lun-mer-ven alle 12:20, 6 sedute: 6…1 nelle caselle); 3 attività scritta a mano (gruppo con un nome);
// 4 seduta spostata dalla casella con «Annulla», poi scambio; 5 una seduta a un collega con il conteggio invariato;
// 6 assenza che non scala, seduta passata che conta da sola; 7 ferie → spia rossa e pazienti da ricollocare;
// 8 mesi precedenti consultabili e non modificabili; 9 tempo reale, permessi e spia gialla; 10 orario della settimana;
// 11 avvisi di primo livello al fisioterapista (paziente nuovo, sostituzione per collega malato).
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
const fisioSb = await login('fisio-e2e@pilota.test');
const imp = async (th, rows, from) => S.rpc(seg, 'import_sheet', { p: { therapist_id: th, month: from.slice(0, 8) + '01', from_date: from, rows } });
const P = work(E.addDays(T0, -12), 3);        // giorni passati
const F = work(E.addDays(T0, 3), 6);          // giorni futuri
const r0 = await imp(A, [
  { ref: 'o1', target: 'nuovo', patient_name: 'Oggi Uno ' + RUN, category_id: 'mano', planned: 10, prior: 4, duration: 30, weekdays: [], start: '07:30', cells: [{ day: P[0] }, { day: P[1] }, { day: T0 }, { day: F[0] }] },
  { ref: 'o2', target: 'nuovo', patient_name: 'Oggi Due ' + RUN, category_id: 'mano', planned: 10, prior: 2, duration: 45, weekdays: [], start: '08:30', cells: [{ day: T0 }, { day: F[0] }, { day: F[1] }] },
  { ref: 'o3', target: 'nuovo', patient_name: 'Scambio ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [], start: '10:00', cells: [{ day: F[0] }] }], P[0]);
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
/** casella del tabulato: riga del paziente, colonna del giorno */
const cell = (n, d) => `.tg tr:has(.tg-name:has-text("${n} ${RUN}")) td:nth-child(${Number(d.slice(8)) + 1}) button`;
async function tap(page, d, hhmm) {
  const col = page.locator(`.wk-col[data-day="${d}"]`).first();
  await col.waitFor();
  const min0 = Number(await col.getAttribute('data-min'));
  await col.click({ position: { x: 12, y: (E.toMin(hhmm) - min0) * 1.25 + 2 } });
}
try {
  // ------------------------------------------------------------------ 1
  const fp = await open('fisio-e2e@pilota.test', { width: 390, height: 844 });
  await fp.waitForSelector('.today-list');
  const tl = await fp.textContent('.today-list');
  assert.match(tl, new RegExp('Oggi Uno ' + RUN)); assert.match(tl, /\(45′\)/);
  assert.match(tl, /restano 4 sedute, compresa questa/, 'Oggi Uno: 4 prima + 2 passate (contano da sole) → oggi la 7ª, ne restano 4');
  assert.ok(!(await fp.$('.today-list button:has-text("Effettuata")')), 'la presenza non si segna');
  await fp.click('.today-list button:has-text("Il mio tabulato")');
  await fp.waitForSelector('.tg');
  assert.ok(!(await fp.$('nav a[href="#/trova"]')), 'Trova posto solo per la segreteria');
  ok('Il fisioterapista (dal cellulare) vede subito i pazienti di oggi con le sedute che restano; la presenza non si segna; un tocco apre il tabulato del mese');

  // ------------------------------------------------------------------ 2
  const sp = await open('seg-e2e@pilota.test');
  await goCal(sp, A, F[2], 'mese');
  await sp.waitForSelector('.tg tr.tg-new');
  await sp.fill('.tg tr.tg-new >> nth=0 >> input', 'Nuovo ' + RUN);
  await sp.click(`.tg tr.tg-new >> nth=0 >> td:nth-child(${Number(F[2].slice(8)) + 1}) button`);
  await sp.waitForSelector('.drawer');
  assert.equal(await sp.$eval('.drawer input[data-bind="pd.q"]', e => e.value), 'Nuovo ' + RUN, 'il nome scritto nel tabulato');
  assert.equal(await sp.$eval('.drawer input[data-bind="pd.day"]', e => e.value), F[2]);
  await sp.fill('.drawer input[data-bind="pd.start"]', '');
  await sp.type('.drawer input[data-bind="pd.start"]', '12:20', { delay: 50 });
  await sp.press('.drawer input[data-bind="pd.start"]', 'Tab');
  assert.equal(await sp.$eval('.drawer input[data-bind="pd.start"]', e => e.value), '12:20');
  const wd = E.weekday(F[2]);
  for (const w of [1, 3, 5]) if (w !== wd) await sp.click(`.drawer button[data-act="pd-day"][data-wd="${w}"]`);
  if (![1, 3, 5].includes(wd)) await sp.click(`.drawer button[data-act="pd-day"][data-wd="${wd}"]`);
  await sp.fill('.drawer input[data-bind="pd.left"]', '6'); await sp.press('.drawer input[data-bind="pd.left"]', 'Tab');
  await sp.waitForFunction(() => document.querySelectorAll('.drawer .pd-list li').length === 6);
  await sp.click('.drawer button[data-act="pd-save"]');
  await sp.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  const nuovo = q(`select string_agg(to_char(a.start_time,'HH24:MI')||'/'||extract(isodow from a.day), ',' order by a.day) from appointments a join patients p on p.id=a.patient_id where p.name='Nuovo ${RUN}'`);
  assert.equal(nuovo.split(',').length, 6); assert.ok(nuovo.split(',').every(x => /^12:20\/[135]$/.test(x)), nuovo);
  await sp.waitForSelector(`.tg .tg-name:has-text("Nuovo ${RUN}")`);
  const first = q(`select min(a.day) from appointments a join patients p on p.id=a.patient_id where p.name='Nuovo ${RUN}'`);
  assert.equal(await sp.textContent(cell('Nuovo', first)), '6', 'nella casella il numero a ritroso');
  ok('Paziente nuovo scritto in una riga vuota del tabulato: lunedì, mercoledì e venerdì alle 12:20 (scritto a mano), 6 sedute, nelle caselle 6, 5, 4…');

  // ------------------------------------------------------------------ 3
  await goCal(sp, A, F[3], 'giorno');
  await tap(sp, F[3], '14:00');
  await sp.waitForSelector('.drawer');
  await sp.click('.drawer button[data-act="seg"][data-path="pd.kind"][data-val="attivita"]');
  await sp.selectOption('.drawer select[data-bind="pd.act.kind"]', 'gruppo');
  await sp.fill('.drawer input[data-bind="pd.act.label"]', 'Gruppo schiena');
  await sp.fill('.drawer input[data-bind="pd.act.start"]', '14:00'); await sp.press('.drawer input[data-bind="pd.act.start"]', 'Tab');
  await sp.fill('.drawer input[data-bind="pd.act.end"]', '14:45'); await sp.press('.drawer input[data-bind="pd.act.end"]', 'Tab');
  await sp.click('.drawer button[data-act="pd-save"]');
  await sp.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.match(q(`select blocks::text from day_overrides where therapist_id='${A}' and day='${F[3]}'`), /Gruppo schiena/);
  await sp.waitForSelector(`.wk-col[data-day="${F[3]}"] .k-gruppo:has-text("Gruppo schiena")`);
  ok('Attività scritta a mano toccando la giornata: «Gruppo schiena» 14:00–14:45, senza nomi dei pazienti');

  // ------------------------------------------------------------------ 4
  await goCal(sp, A, F[0], 'mese');
  await sp.click(cell('Scambio', F[0]));
  await sp.click('.modal button:has-text("Sposta (giorno o ora)")');
  await sp.fill('.modal input[data-bind="ts.start"]', '11:10'); await sp.press('.modal input[data-bind="ts.start"]', 'Tab');
  await sp.waitForSelector('.modal .form-note:has-text("Va bene")');
  await sp.click('.modal button:has-text("Salva")');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(ap('Scambio', F[0]).start_time, '11:10:00');
  await sp.click('.toast.undo button');
  await sp.waitForFunction(() => !document.querySelector('.toast.undo') && !FA.state.saving);
  assert.equal(ap('Scambio', F[0]).start_time, '10:00:00', '«Annulla» riporta la seduta com’era');
  const o2 = ap('Oggi Due', F[0]);
  await sp.click(cell('Scambio', F[0]));
  await sp.click('.modal button:has-text("Scambia con un altro paziente")');
  await sp.click(`.modal button[data-act="sw-pick"][data-b="${o2.id}"]`);
  await sp.waitForSelector('.modal .form-note:has-text("compatibili")');
  await sp.click('.modal button:has-text("⇄ Scambia")');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(ap('Scambio', F[0]).start_time, '08:30:00'); assert.equal(ap('Oggi Due', F[0]).end_time, '10:45:00');
  ok('Dalla casella: seduta spostata e riportata com’era con «Annulla»; due pazienti scambiati di posto, ognuno con la propria durata');

  // ------------------------------------------------------------------ 5
  const left0 = await sp.textContent(cell('Oggi Due', F[1]));
  await sp.click(cell('Oggi Due', F[1]));
  await sp.click('.modal button:has-text("Altro fisioterapista")');
  await sp.selectOption('.modal select[data-bind="ts.th"]', B);
  await sp.waitForSelector('.modal .form-note:has-text("Va bene")');
  await sp.click('.modal button:has-text("Salva")');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await sp.waitForSelector(cell('Oggi Due', F[1]) + ' sub');
  { const now = await sp.textContent(cell('Oggi Due', F[1])); assert.equal(now.replace(/[A-Z][A-Z0-9]*$/, ''), left0, 'conteggio invariato, sigla del collega nella casella: ' + left0 + ' → ' + now); }
  assert.equal(q(`select therapist_id from cycles where id='${cyc('Oggi Due')}'`), A, 'il ciclo resta del titolare');
  await goCal(sp, B, F[1], 'mese');
  await sp.waitForSelector(`.tg tr.tg-guestrow:has-text("Oggi Due ${RUN}")`);
  ok('Una seduta passata a un collega: nel tabulato del titolare resta con la sigla del collega, stesso numero (' + left0 + '); il collega la vede come paziente di un altro');

  // ------------------------------------------------------------------ 6
  const eff = c => { const k = q(`select prior_sessions || '/' || (select count(*) from appointments where cycle_id=c.id and (status='effettuata' or (status='programmata' and day < app.today()))) from cycles c where id='${c}'`).split('/'); return Number(k[0]) + Number(k[1]); };
  assert.equal(eff(cyc('Oggi Uno')), 6, 'le sedute passate contano da sole');
  await goCal(sp, A, F[0], 'mese');
  const before = await sp.textContent(cell('Oggi Uno', T0));
  await sp.click(cell('Oggi Uno', T0 > F[0] ? F[0] : T0));
  await sp.click('.modal button[data-act="ts-absent"][data-rec="0"]');
  await sp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(ap('Oggi Uno', T0).status, 'assente');
  assert.equal(await sp.textContent(cell('Oggi Uno', F[0])), before, 'l’assenza non scala: la seduta dopo prende il numero di quella saltata');
  assert.equal(await sp.textContent(cell('Oggi Uno', T0)), 'A');
  ok('Assenza dalla casella: segnata «A», non scala la seduta; le sedute passate contano da sole, senza segnare la presenza');

  // ------------------------------------------------------------------ 7
  const ferie = q(`select min(a.day) from appointments a join patients p on p.id=a.patient_id where p.name='Nuovo ${RUN}' and a.day > '${F[2]}'`);
  const red0 = await sp.$eval('.spia.red', e => e.textContent);
  await goCal(sp, A, ferie, 'giorno');
  await tap(sp, ferie, '09:30');
  await sp.waitForSelector('.drawer');
  await sp.click('.drawer button[data-act="seg"][data-path="pd.kind"][data-val="assenza"]');
  await sp.click('.drawer button[data-act="seg"][data-path="pd.ab.kind"][data-val="ferie"]');
  await sp.check('.drawer input[data-bind="pd.ab.allDay"]');
  await sp.waitForSelector('.drawer .form-warn:has-text("da ricollocare")');
  await sp.click('.drawer button[data-act="pd-save"]');
  await sp.waitForURL(/#\/assenze\/piano\//, { timeout: 15000 });
  await sp.waitForFunction(r => { const e = document.querySelector('.spia.red.on'); return e && e.textContent !== r; }, red0, { timeout: 15000 });
  await sp.click('.spia.red');
  await sp.waitForSelector(`.sb-table tr:has-text("Nuovo ${RUN}")`);
  ok('Ferie registrate dal tabulato: la spia rossa si accende per chi gestisce le agende e porta subito ai pazienti da ricollocare');

  // ------------------------------------------------------------------ 8
  const past = E.addDays(T0, -45);
  await goCal(fp, A, past, 'mese');
  await fp.waitForSelector('.tg');
  assert.ok(!(await fp.$('.tg button[data-act="tg-add"]')) && !(await fp.$('.tg tr.tg-new td button')), 'un mese passato non si scrive con un tocco');
  await fp.click('button[aria-label="Avanti"]'); await fp.waitForSelector('.tg');
  await fp.click('button[aria-label="Avanti"]'); await fp.waitForSelector('.tg');
  ok('Mesi precedenti consultabili con le frecce; nei giorni passati non si aggiunge nulla per sbaglio');

  // ------------------------------------------------------------------ 9
  await goCal(fp, B, F[1], 'mese');
  await fp.waitForSelector('.tg');
  assert.ok(!(await fp.$('.tg tr.tg-new')) && !(await fp.$('.tg button[data-act="tg-add"]')), 'agenda del collega in consultazione');
  await goCal(fp, A, F[1], 'mese');
  const nx = q(`select min(a.day) from appointments a join patients p on p.id=a.patient_id where p.name='Nuovo ${RUN}' and a.day > '${ferie}'`);
  const n1 = ap('Nuovo', nx);
  await fp.waitForSelector(cell('Nuovo', nx));
  await S.rpc(seg, 'edit_appointment', { p_id: n1.id, p_version: n1.version, p: { start: '13:15' } });
  await fp.waitForSelector(cell('Nuovo', nx) + ' sup:has-text("13:15")', { timeout: 20000 });
  // modifica del fisioterapista → spia gialla alla segreteria
  const o1 = ap('Oggi Uno', F[0]);
  await S.rpc(fisioSb, 'edit_appointment', { p_id: o1.id, p_version: o1.version, p: { start: '07:45' } });
  await sp.waitForSelector('.spia.yellow.on', { timeout: 20000 });
  await sp.click('.spia.yellow');
  await sp.waitForSelector('.modal li:has-text("Oggi Uno")');
  assert.match(await sp.textContent('.modal'), /Fisio Prova/);
  await sp.click('.modal button:has-text("Segna tutti come visti")');
  await sp.waitForFunction(() => !document.querySelector('.spia.yellow.on'), null, { timeout: 15000 });
  assert.ok(!(await fp.$('.spia.red, .spia.yellow')), 'i fisioterapisti non hanno le spie della segreteria');
  ok('Tempo reale: la modifica della segreteria compare al fisioterapista; la sua modifica accende la spia gialla alla segreteria («Visto» la spegne); agenda del collega in consultazione');

  // ------------------------------------------------------------------ 10
  await goCal(fp, A, T0, 'mese');
  await fp.click('button[data-act="or-open"]');
  await fp.waitForSelector('.modal .or-day');
  await fp.click('.modal button[data-act="or-add"][data-k="2"]');
  const n2 = await fp.$$eval('.modal .or-day >> nth=1 >> .or-row', l => l.length).catch(() => 0);
  const lastRow = `.modal .or-day:nth-of-type(2) .or-row:last-child`;
  await fp.selectOption('.modal select[data-bind="or.week.2.' + (DAY.length) + '.kind"]', 'ortesi');
  await fp.fill('.modal input[data-bind="or.week.2.' + DAY.length + '.start"]', '15:00');
  await fp.fill('.modal input[data-bind="or.week.2.' + DAY.length + '.end"]', '16:00');
  await fp.fill('.modal input[data-bind="or.week.2.' + DAY.length + '.label"]', 'Ortesi mano');
  const from = work(E.addDays(T0, 14), 1, [1])[0];
  await fp.fill('.modal input[data-bind="or.from"]', from);
  await fp.click('.modal button:has-text("Controlla")');
  await fp.waitForSelector('.modal .form-note:has-text("Nessun paziente"), .modal .form-warn');
  await fp.click('.modal button[data-act="or-save"]');
  await fp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.match(q(`select week::text from shift_versions where therapist_id='${A}' and valid_from='${from}'`), /Ortesi mano/);
  assert.equal(q(`select count(*) from shift_versions where therapist_id='${A}'`), '2', 'il passato resta: nuova versione dell’orario da quella data');
  void n2; void lastRow;
  ok('Il fisioterapista cambia il proprio orario (ambulatorio ortesi il martedì) da una data: il passato non cambia');

  {
  }

  // ------------------------------------------------------------------ 11
  await S.rpc(fisioSb, 'mark_alerts_seen', { p_ids: null });
  await goCal(fp, A, F[2], 'mese');
  await fp.waitForSelector('.tg');
  await fp.waitForFunction(() => !document.querySelector('.alert1-panel'), null, { timeout: 15000 });
  const G2 = work(E.addDays(F[2], 1), 1)[0];
  const ra = await imp(A, [{ ref: 'av', target: 'nuovo', patient_name: 'Avviso Nuovo ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [], start: '09:00', cells: [{ day: F[2], start: '09:00' }, { day: G2, start: '09:00' }] }], F[2]);
  assert.ok(ra.results[0].ok, JSON.stringify(ra.results));
  const rb = await imp(B, [{ ref: 'bv', target: 'nuovo', patient_name: 'Di Collega ' + RUN, category_id: 'mano', planned: 10, prior: 0, duration: 30, weekdays: [], start: '09:30', cells: [{ day: F[2], start: '09:30' }] }], F[2]);
  assert.ok(rb.results[0].ok, JSON.stringify(rb.results));
  await S.rpc(seg, 'save_absence', { p: { therapist_id: B, kind: 'malattia', start_date: F[2], end_date: F[2] } });
  const dc = ap('Di Collega', F[2]);
  await S.rpc(seg, 'edit_appointment', { p_id: dc.id, p_version: dc.version, p: { therapist_id: A, force: true } });
  await fp.waitForSelector('.alert1-panel .alert1-item >> nth=1', { timeout: 20000 });
  const panel = await fp.textContent('.alert1-panel');
  assert.match(panel, /2 avvisi/); assert.match(panel, /Paziente nuovo:\s*Avviso Nuovo/); assert.match(panel, /2 sedute/);
  assert.match(panel, /Sostituzione:\s*Di Collega/); assert.match(panel, /paziente di Collega .*\(in malattia\)/); assert.match(panel, /Segreteria Prova/);
  assert.match(await fp.textContent('.spia.avviso1'), /2 avvisi/);
  if (process.env.SHOTS) await fp.screenshot({ path: path.join(process.env.SHOTS, 'avvisi-telefono.png'), fullPage: false });
  assert.equal(await fp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'nessuno scorrimento orizzontale sul telefono');
  // la segreteria vede gli avvisi inviati: ✓ non ancora letti
  if (await sp.$('.modal')) { await sp.click('.modal button:has-text("Chiudi")'); await sp.waitForSelector('.modal', { state: 'detached' }); }
  await goCal(sp, A, F[2], 'mese');
  await sp.waitForSelector('.sent-bar:has-text("2 non ancora letti")', { timeout: 20000 });
  await fp.click('.alert1-item:has-text("Avviso Nuovo") button:has-text("Vedi")');
  await fp.waitForSelector('.tg tr.tg-booked:has-text("Avviso Nuovo")');
  await fp.click('.alert1-item:has-text("Avviso Nuovo") button:has-text("Visto")');
  await fp.waitForFunction(() => document.querySelectorAll('.alert1-item').length === 1, null, { timeout: 15000 });
  await fp.click('.alert1-item button:has-text("Visto")');
  await fp.waitForFunction(() => !document.querySelector('.alert1-panel') && !document.querySelector('.spia.avviso1'), null, { timeout: 15000 });
  assert.ok(!(await sp.$('.spia.avviso1')), 'la segreteria non riceve gli avvisi del tabulato del collega');
  // ✓✓ letti: la segreteria lo vede subito, senza ricaricare
  await sp.waitForFunction(() => { const b = document.querySelector('.sent-bar'); return b && /letti/.test(b.textContent) && !/non ancora/.test(b.textContent); }, null, { timeout: 20000 });
  await sp.click('.sent-bar button:has-text("Dettagli")');
  await sp.waitForSelector('.modal .sent-item:has-text("Di Collega") .read-mark.read');
  if (process.env.SHOTS) await sp.screenshot({ path: path.join(process.env.SHOTS, 'avvisi-segreteria.png') });
  await sp.click('.modal button:has-text("Chiudi")');
  ok('Avvisi al fisioterapista (paziente nuovo, paziente del collega malato), uno per operazione, con le sedute; «Vedi» e «Visto»; la segreteria vede ✓ inviato e ✓✓ letto');

  assert.deepEqual(errors, [], 'nessun errore nella pagina');
} finally {
  await browser.close(); server.kill();
}
console.log('Tutte le prove del tabulato superate.');
