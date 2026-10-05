// Prova nel browser partendo da un archivio VUOTO (come sul progetto reale):
// fisioterapisti e turni inseriti dall'app, un paziente fittizio, assenza del fisioterapista e sostituzione.
// ATTENZIONE: cancella tutti i dati del database LOCALE di prova.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, ensureUser, PASSWORD, psql, E } from './helpers.mjs';

const PORT = 8093;
let step = 0;
const ok = m => console.log(`✓ ${++step}. ${m}`);
psql(`delete from appointments where true; delete from cycles where true; delete from patients where true; delete from absences where true;
  delete from day_overrides where true; delete from shift_versions where true; delete from therapist_skills where true; delete from therapists where true;`);
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.js'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.fill('#em', 'coord@pilota.test'); await page.fill('#pw', PASSWORD); await page.click('button[type=submit]');
  await page.waitForSelector('text=Primi passi', { timeout: 20000 });
  ok('Archivio vuoto: la schermata iniziale mostra i primi passi');

  async function addTherapist(name, level) {
    await page.click('text=Inserisci fisioterapisti').catch(async () => { await page.evaluate(() => { location.hash = '#/config'; }); });
    await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Fisioterapisti")');
    await page.waitForSelector('button:has-text("+ Nuovo fisioterapista")');
    await page.click('button:has-text("+ Nuovo fisioterapista")');
    await page.fill('.modal input[data-bind="te.name"]', name);
    await page.selectOption('.modal select[data-bind="te.skills.mano"]', level);
    await page.click('.modal button:has-text("Salva")');
    await page.waitForSelector('.modal h3:has-text("Nuovo turno"), button:has-text("Nuovo turno con decorrenza")', { timeout: 15000 });
    await page.click('button:has-text("Nuovo turno con decorrenza")');
    await page.selectOption('.modal select[data-bind="sh.tpl"]', 'ambulatorio');
    await page.fill('.modal input[data-bind="sh.valid_from"]', psql('select app.today()'));
    await page.click('.modal button:has-text("Verifica appuntamenti coinvolti")');
    await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento")', { timeout: 15000 });
    await page.click('.modal button:has-text("Salva il nuovo turno")');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
    await page.evaluate(() => { location.hash = '#/oggi'; });
  }
  await addTherapist('Rossi Anna', 'specifica');
  // inserimento rapido di più colleghi + tabella competenze
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Fisioterapisti")');
  await page.click('button:has-text("Inserimento rapido")');
  await page.fill('.modal textarea[data-bind="tb.names"]', 'Verdi Marco\nBianchi Luca\nRossi Anna');
  await page.selectOption('.modal select[data-bind="tb.tpl"]', 'ambulatorio');
  await page.fill('.modal input[data-bind="tb.from"]', psql('select app.today()'));
  await page.click('.modal button:has-text("Inserisci tutti")');
  await page.waitForSelector('.modal .form-note:has-text("Inseriti 2 fisioterapisti")', { timeout: 20000 });
  assert.match(await page.textContent('.modal .form-note'), /Saltati 1 nomi già presenti/);
  await page.click('.modal button:has-text("Chiudi")');
  await page.click('button:has-text("Tabella competenze")');
  const verdi = psql("select id from therapists where name='Verdi Marco'");
  await page.selectOption(`.modal select[data-bind="sk.m.${verdi}.mano"]`, 'specifica');
  await page.click('.modal button:has-text("Salva le competenze")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select level from therapist_skills where therapist_id='${verdi}' and category_id='mano'`), 'specifica');
  assert.equal(psql('select count(*) from therapists'), '3');
  await page.waitForTimeout(500);
  assert.ok(!(await page.$('text=Primi passi')), 'guida nascosta quando fisioterapisti e turni ci sono');
  assert.equal(psql('select count(*) from shift_versions'), '3');
  ok('Fisioterapisti inseriti (uno dalla scheda, due con l’inserimento rapido), competenze dalla tabella, turni da schema pronto');

  // paziente fittizio dal posto libero in agenda
  let day = E.addDays(psql('select app.today()'), 1);
  while (E.weekday(day) >= 6 || psql(`select count(*) from closures where day='${day}'`) !== '0') day = E.addDays(day, 1);
  const anna = psql("select id from therapists where name='Rossi Anna'");
  await page.evaluate(d => { location.hash = '#/agenda/' + d; }, day);
  await page.waitForTimeout(300);
  await page.selectOption('select[data-bind="ag.th"]', anna);
  await page.click('[data-act="ag-book"] >> nth=0');
  await page.fill('.modal input[data-bind="qb.name"]', 'Paziente Prova');
  await page.dispatchEvent('.modal input[data-bind="qb.name"]', 'change');
  await page.click('.modal button[data-act="seg"][data-val="5"]');
  await page.waitForSelector('.modal .form-note:has-text("Tutte le 5 sedute")');
  await page.click('.modal button:has-text("Conferma e salva")');
  await page.waitForSelector('h2:has-text("Paziente Prova")', { timeout: 15000 });
  ok('Paziente fittizio inserito e assegnato: occupa il suo posto per 5 sedute');

  // paziente con ciclo già in corso: 10 sedute di cui 3 già svolte -> se ne prenotano 7
  await page.evaluate(d => { location.hash = '#/agenda/' + d; }, day);
  await page.waitForTimeout(300);
  await page.selectOption('select[data-bind="ag.th"]', verdi);
  await page.click('[data-act="ag-book"] >> nth=-1');
  await page.fill('.modal input[data-bind="qb.name"]', 'Paziente In Corso');
  await page.dispatchEvent('.modal input[data-bind="qb.name"]', 'change');
  await page.selectOption('.modal select[data-bind="qb.request_type"]', 'continuazione');
  const started = E.addDays(day, -21);
  await page.fill('.modal input[data-bind="qb.started"]', started);
  await page.dispatchEvent('.modal input[data-bind="qb.started"]', 'change');
  await page.selectOption('.modal select[data-bind="qb.expected_cycles"]', '2');
  const t0 = psql('select app.today()');
  let k = 0; for (let x = started; x < t0; x = E.addDays(x, 1)) if (E.weekday(x) === E.weekday(day) && psql(`select count(*) from closures where day='${x}'`) === '0') k++;
  await page.waitForSelector(`.modal .form-note:has-text("Tutte le ${10 - k} sedute")`, { timeout: 10000 });
  await page.click('.modal button:has-text("Conferma e salva")');
  await page.waitForSelector('h2:has-text("Paziente In Corso")', { timeout: 15000 });
  const sheet = await page.textContent('main');
  assert.match(sheet, new RegExp('Effettuate: ' + k + ' \\(di cui ' + k + ' prima dell’inserimento\\)'));
  assert.match(sheet, new RegExp('Programmate: ' + (10 - k)));
  assert.match(sheet, /Ciclo 1 di 2 previsti \(ipotetico\)/);
  ok('Ciclo iniziato prima di oggi: dalla data di inizio l’app conta le sedute già svolte e prenota solo le rimanenti; previsione 1 di 2 cicli (ipotetica)');

  // assenza del fisioterapista e sostituzione
  await page.evaluate(() => { location.hash = '#/oggi'; });
  await page.click('text=Gestisci assenza fisioterapista');
  await page.selectOption('#abs-th', { label: 'Rossi Anna' });
  await page.click('button[data-val="giorno"]');
  await page.fill('#abs-day', day);
  await page.click('button:has-text("Registra l’assenza e cerca i sostituti")');
  await page.waitForSelector('.subst', { timeout: 15000 });
  assert.match(await page.textContent('.subst'), /Paziente Prova/);
  assert.match(await page.textContent('.subst'), /Stesso orario con Verdi Marco/);
  await page.click('button:has-text("Rivedi e conferma")');
  await page.click('.modal button:has-text("Conferma e salva")');
  await page.waitForSelector('text=Esito del salvataggio', { timeout: 15000 });
  assert.equal(psql(`select t.name from appointments a join therapists t on t.id=a.therapist_id join patients p on p.id=a.patient_id where a.day='${day}' and p.name='Paziente Prova'`), 'Verdi Marco');
  assert.equal(psql(`select count(*) from appointments where therapist_id='${anna}' and day > '${day}'`), '4', 'il resto del ciclo resta a Rossi Anna');
  ok('Assenza di Rossi Anna: il paziente passa a Verdi Marco allo stesso orario solo per quel giorno');
  // account di un fisioterapista: modifica solo il proprio calendario
  await ensureUser('fisio@pilota.test', 'lettura', 'Fisio Prova');
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Utenti")');
  const fuid = psql("select user_id from profiles where email='fisio@pilota.test'");
  await page.selectOption(`select[data-bind="us.${fuid}.role"]`, 'fisioterapista');
  await page.selectOption(`select[data-bind="us.${fuid}.therapist_id"]`, anna);
  await page.click(`button[data-act="us-save"][data-id="${fuid}"]`);
  await page.waitForTimeout(1500);
  assert.equal(psql(`select role||'/'||therapist_id from profiles where user_id='${fuid}'`), 'fisioterapista/' + anna);
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pf = await ctx2.newPage(); pf.on('pageerror', e => errors.push('fisio: ' + e.message));
  await pf.goto(`http://localhost:${PORT}/#/agenda/${day}`);
  await pf.fill('#em', 'fisio@pilota.test'); await pf.fill('#pw', PASSWORD); await pf.click('button[type=submit]');
  await pf.waitForSelector('.agenda-grid', { timeout: 20000 });
  assert.match(await pf.textContent('.pilot-banner'), /solo il tuo calendario/);
  const cards = await pf.$$eval('.th-card', cs => cs.map(c => ({ name: c.querySelector('h4 span').textContent, book: !!c.querySelector('[data-act="ag-book"]') })));
  assert.ok(cards.find(c => c.name === 'Rossi Anna').book, 'prenota sul proprio calendario');
  assert.ok(!cards.filter(c => c.name !== 'Rossi Anna').some(c => c.book), 'nessun "+ prenota" sui colleghi');
  await pf.click('.th-card:has-text("Verdi Marco") .slot.appt[data-act="open-appt"] >> nth=0');
  await pf.waitForSelector('.modal');
  assert.match(await pf.textContent('.modal'), /Puoi modificare solo il tuo calendario/);
  ok('Account fisioterapista collegato a Rossi Anna: modifica solo il proprio calendario, vede quelli dei colleghi');
  assert.deepEqual(errors, []);
  ok('Nessun errore JavaScript');
  console.log('\nProva da archivio vuoto riuscita.');
} catch (e) {
  console.error('\n✗ PROVA NON RIUSCITA:', e.message, errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close(); server.kill();
}
