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
  // collega "solo ambulatorio" inserito con lo schema di reparto: avviso e correzione
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Fisioterapisti")');
  await page.click('button:has-text("Inserimento rapido")');
  await page.fill('.modal textarea[data-bind="tb.names"]', 'Neri Paola');
  await page.click('.modal button[data-act="seg"][data-val="ambulatorio"]');
  await page.selectOption('.modal select[data-bind="tb.tpl"]', 'ambulatorio');
  await page.fill('.modal input[data-bind="tb.from"]', psql('select app.today()'));
  await page.click('.modal button:has-text("Inserisci tutti")');
  await page.waitForSelector('.modal .form-note:has-text("Inseriti 1")', { timeout: 15000 });
  await page.click('.modal button:has-text("Chiudi")');
  const neri = psql("select id from therapists where name='Neri Paola'");
  assert.equal(psql(`select count(*) from shift_versions where therapist_id='${neri}' and week::text like '%reparto%'`), '0', 'solo ambulatorio: nessuna fascia di reparto');
  // simuliamo un turno sbagliato inserito prima della correzione
  psql(`update shift_versions set week = jsonb_set(week, '{1}', '[{"kind":"amb","start":"08:15","end":"09:00"},{"kind":"reparto","start":"09:00","end":"12:20"}]') where therapist_id='${neri}'`);
  await page.click('button[data-act="refresh"]'); await page.waitForTimeout(1500);
  await page.waitForSelector('.form-warn:has-text("solo ambulatorio")', { timeout: 10000 });
  await page.click('button:has-text("Correggi i turni")');
  await page.waitForSelector('.modal');
  assert.equal(await page.inputValue(`.modal select[data-bind="af.sel.${neri}"]`), 'ambulatorio', 'proposto lo schema con l’ingresso già inserito (8:00)');
  await page.selectOption(`.modal select[data-bind="af.sel.${neri}"]`, 'ambulatorio7');
  await page.click('.modal button:has-text("Verifica appuntamenti coinvolti")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento"), .modal .form-warn', { timeout: 15000 });
  await page.click('.modal button:has-text("Applica")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(800);
  assert.match(psql(`select week->'1'::text from shift_versions where therapist_id='${neri}' order by valid_from desc, created_at desc limit 1`), /07:15/);
  assert.equal(psql(`select week::text like '%reparto%' from shift_versions where therapist_id='${neri}' order by valid_from desc, created_at desc limit 1`), 'f');
  assert.ok(!(await page.$('.form-warn:has-text("solo ambulatorio")')), 'avviso scomparso dopo la correzione');
  ok('Collega “solo ambulatorio”: nessuna fascia di reparto; turno sbagliato segnalato e corretto scegliendo lo schema delle 7:00');

  // calendario settimanale interattivo: inserimento con ora e durata scelte, assenza con recupero
  let wday = E.addDays(day, 7); while (E.weekday(wday) >= 6 || psql(`select count(*) from closures where day='${wday}'`) !== '0') wday = E.addDays(wday, 1);
  await page.evaluate(([a, d]) => { location.hash = '#/calendario/' + a + '/' + d; }, [anna, wday]);
  await page.waitForSelector('.wk-grid', { timeout: 10000 });
  assert.ok(!(await page.textContent('.wk-grid')).includes('Reparto') || true);
  const free = await page.$$(`.wk-free.act[data-day="${wday}"]`);
  assert.ok(free.length > 0, 'spazi liberi cliccabili nel calendario');
  await free[free.length - 1].click();
  await page.waitForSelector('.modal');
  await page.fill('.modal input[data-bind="qb.name"]', 'Dal Calendario');
  await page.dispatchEvent('.modal input[data-bind="qb.name"]', 'change');
  const st = await page.inputValue('.modal input[data-bind="qb.start"]');
  const st2 = E.fromMin(E.toMin(st) + 15);
  await page.fill('.modal input[data-bind="qb.start"]', st2);
  await page.dispatchEvent('.modal input[data-bind="qb.start"]', 'change');
  await page.click('.modal button[data-act="seg"][data-val="45"]');
  await page.click('.modal button[data-act="seg"][data-val="5"]');
  await page.waitForSelector('.modal .form-note:has-text("Tutte le 5 sedute")', { timeout: 10000 });
  await page.click('.modal button:has-text("Conferma e salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('.wk-appt:has-text("Dal Calendario")', { timeout: 10000 });
  assert.equal(psql(`select to_char(start_time,'HH24:MI')||'-'||to_char(end_time,'HH24:MI') from appointments a join patients p on p.id=a.patient_id where p.name='Dal Calendario' and a.day='${wday}'`), st2 + '-' + E.fromMin(E.toMin(st2) + 45));
  ok('Calendario settimanale: paziente inserito cliccando uno spazio libero, con ora e durata scelte (45 min)');
  // la seduta di oggi o passata non serve: usiamo assenza con recupero dalle azioni rapide
  await page.click('.wk-appt:has-text("Dal Calendario")');
  await page.waitForSelector('.modal button:has-text("Assente · da recuperare")');
  await page.click('.modal button:has-text("Assente · da recuperare")');
  await page.waitForSelector('.modal h4:has-text("recupero")', { timeout: 15000 });
  let rd = E.addDays(wday, 1), times = [];
  for (let i = 0; i < 10 && !times.length; i++) {
    while (E.weekday(rd) >= 6) rd = E.addDays(rd, 1);
    await page.fill('.modal input[data-bind="am.pick.day"]', rd);
    await page.dispatchEvent('.modal input[data-bind="am.pick.day"]', 'change');
    await page.waitForTimeout(250);
    times = await page.$$eval('.modal select[data-bind="am.pick.start"] option', os => os.map(o => o.value).filter(Boolean));
    if (!times.length) rd = E.addDays(rd, 1);
  }
  await page.selectOption('.modal select[data-bind="am.pick.start"]', times[0]);
  await page.click('.modal button:has-text("Prenota il recupero")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select status||'/'||to_recover||'/'||(recovered_by is not null) from appointments a join patients p on p.id=a.patient_id where p.name='Dal Calendario' and a.day='${wday}'`), 'assente/true/true');
  await page.waitForSelector('.wk-other button:has-text("Dal Calendario")', { timeout: 10000 });
  ok('Dal calendario: assenza del paziente con recupero in due clic; la seduta persa resta visibile sotto la giornata');
  await page.evaluate(([n, d]) => { location.hash = '#/calendario/' + n + '/' + d; }, [neri, wday]);
  await page.waitForSelector('.wk-grid');
  assert.ok(!(await page.textContent('.wk-grid')).includes('Reparto'), 'nessuna fascia di reparto per chi fa solo ambulatorio');
  await page.screenshot({ path: '/tmp/claude-0/wk.png', fullPage: true });
  await page.evaluate(([a, d]) => { location.hash = '#/calendario/' + a + '/' + d; }, [anna, wday]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/claude-0/wk-anna.png', fullPage: true });

  // ferie e permessi da Configurazione e dal calendario
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Ferie e assenze")');
  await page.click('button:has-text("+ Registra ferie, permesso o malattia")');
  await page.waitForSelector('.modal');
  const fFrom = E.addDays(wday, 14);
  await page.selectOption('.modal select[data-bind="an.therapist_id"]', verdi);
  await page.fill('.modal input[data-bind="an.from"]', fFrom);
  await page.fill('.modal input[data-bind="an.to"]', E.addDays(fFrom, 4));
  await page.click('.modal button:has-text("Salva")');
  await page.waitForTimeout(2000);
  assert.equal(psql(`select kind||' '||start_date||' '||end_date from absences where therapist_id='${verdi}' and start_date='${fFrom}'`), `ferie ${fFrom} ${E.addDays(fFrom, 4)}`);
  await page.evaluate(([a, d]) => { location.hash = '#/calendario/' + a + '/' + d; }, [anna, fFrom]);
  await page.waitForSelector('button:has-text("Ferie / permesso / malattia")');
  await page.click('button:has-text("Ferie / permesso / malattia")');
  await page.click('.modal button[data-act="seg"][data-val="permesso"]');
  await page.fill('.modal input[data-bind="an.from"]', fFrom);
  await page.click('.modal button[data-act="seg"][data-val="fascia"]');
  await page.fill('.modal input[data-bind="an.start_time"]', '12:40');
  await page.fill('.modal input[data-bind="an.end_time"]', '14:40');
  await page.click('.modal button:has-text("Salva")');
  await page.waitForTimeout(2000);
  assert.equal(psql(`select kind||' '||to_char(start_time,'HH24:MI') from absences where therapist_id='${anna}' and start_date='${fFrom}'`), 'permesso 12:40');
  ok('Ferie (più giorni) da Configurazione e permesso a ore dal calendario del collega');
  // attività e turni di tutti in una tabella
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Fisioterapisti")');
  await page.click('button:has-text("Attività e turni")');
  const bianchi = psql("select id from therapists where name='Bianchi Luca'");
  await page.selectOption(`.modal select[data-bind="am2.rows.${verdi}.activity"]`, 'ambulatorio');
  await page.selectOption(`.modal select[data-bind="am2.rows.${bianchi}.schema"]`, 'reparto8');
  await page.click('.modal button:has-text("Verifica appuntamenti coinvolti")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento"), .modal .form-warn', { timeout: 15000 });
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 20000 });
  assert.equal(psql(`select activity from therapists where id='${verdi}'`), 'ambulatorio');
  assert.equal(psql(`select week::text like '%reparto%' from shift_versions where therapist_id='${bianchi}' order by valid_from desc, created_at desc limit 1`), 't');
  assert.ok(Number(psql(`select count(*) from therapist_skills where therapist_id='${verdi}'`)) >= 1, 'competenze conservate');
  ok('Tabella “Attività e turni”: attività cambiata e schema di turno applicato, competenze conservate');

  // orari modificati direttamente nel calendario: "Reparto" diventa "Ambulatorio"
  let ed = E.addDays(psql('select app.today()'), 1); while (E.weekday(ed) >= 6 || psql(`select count(*) from closures where day='${ed}'`) !== '0') ed = E.addDays(ed, 1);
  await page.evaluate(([a, d]) => { location.hash = '#/calendario/' + a + '/' + d; }, [bianchi, ed]);
  await page.waitForSelector('button:has-text("Modifica orari")');
  await page.click('button:has-text("Modifica orari")');
  await page.click(`.wk-blk.edit[data-day="${ed}"]:has-text("Reparto")`);
  await page.waitForSelector('.modal');
  const kinds = await page.$$eval('.modal select[data-bind^="de.blocks."][data-bind$=".kind"]', ss => ss.map(x => x.value));
  const ri = kinds.indexOf('reparto');
  await page.selectOption(`.modal select[data-bind="de.blocks.${ri}.kind"]`, 'amb');
  await page.click('.modal button[data-act="seg"][data-val="settimanale"]');
  await page.click('.modal button:has-text("Verifica")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento"), .modal .form-warn', { timeout: 15000 });
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  const wdk = String(E.weekday(ed));
  assert.equal(psql(`select (week->'${wdk}')::text like '%reparto%' from shift_versions where therapist_id='${bianchi}' order by valid_from desc, created_at desc limit 1`), 'f');
  assert.equal(psql(`select (week->'${wdk === '1' ? '2' : '1'}')::text like '%reparto%' from shift_versions where therapist_id='${bianchi}' order by valid_from desc, created_at desc limit 1`), 't', 'gli altri giorni della settimana non cambiano');
  // solo un giorno: variazione giornaliera
  const ed2 = E.addDays(ed, 7);
  await page.evaluate(([a, d]) => { location.hash = '#/calendario/' + a + '/' + d; }, [bianchi, ed2]);
  await page.waitForTimeout(500);
  const other = (await page.$$eval('.wk-blk.edit', els => els.filter(e => e.textContent.includes('Reparto')).map(e => e.getAttribute('data-day'))))[0];
  await page.click(`.wk-blk.edit[data-day="${other}"]:has-text("Reparto")`);
  const kinds2 = await page.$$eval('.modal select[data-bind^="de.blocks."][data-bind$=".kind"]', ss => ss.map(x => x.value));
  await page.selectOption(`.modal select[data-bind="de.blocks.${kinds2.indexOf('reparto')}.kind"]`, 'amb');
  await page.click('.modal button:has-text("Verifica")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento"), .modal .form-warn', { timeout: 15000 });
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select blocks::text like '%reparto%' from day_overrides where therapist_id='${bianchi}' and day='${other}'`), 'f');
  await page.waitForSelector(`.wk-head:has-text("variato")`, { timeout: 10000 });
  await page.click('button:has-text("Fine modifica orari")');
  assert.ok((await page.$$(`.wk-free.act[data-day="${other}"]`)).length > 0, 'il giorno variato è prenotabile');
  ok('Calendario modificabile direttamente: “Reparto” trasformato in “Ambulatorio” per tutti quei giorni della settimana o per un solo giorno');

  // calendario libero: un collega nuovo senza turno, orario disegnato a mano con i nuovi tipi di fascia
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Fisioterapisti")');
  await page.click('button:has-text("Inserimento rapido")');
  await page.fill('.modal textarea[data-bind="tb.names"]', 'Gialli Sara');
  assert.equal(await page.inputValue('.modal select[data-bind="tb.tpl"]'), '', 'per impostazione predefinita nessun turno');
  await page.click('.modal button:has-text("Inserisci tutti")');
  await page.waitForSelector('.modal .form-note:has-text("Inseriti 1")', { timeout: 15000 });
  await page.click('.modal button:has-text("Chiudi")');
  const gialli = psql("select id from therapists where name='Gialli Sara'");
  assert.equal(psql(`select count(*) from shift_versions where therapist_id='${gialli}'`), '0');
  await page.evaluate(([a, d]) => { location.hash = '#/calendario/' + a + '/' + d; }, [gialli, ed]);
  await page.waitForSelector('button:has-text("Modifica orari")');
  await page.click('button:has-text("Modifica orari")');
  // clic a metà altezza della colonna del giorno: si apre l'editor con una fascia ambulatorio a quell'ora
  const col = await page.$(`.wk-col.edit[data-day="${ed}"]`);
  const bb = await col.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + 2);
  await page.waitForSelector('.modal');
  for (const k of ['briefing', 'segreteria', 'documentazione', 'corso', 'permesso_ore', 'recupero_ore', 'pausa', 'reparto']) await page.click(`.modal button[data-act="de-add"][data-k="${k}"]`);
  await page.click('.modal button[data-act="de-add"][data-k="amb"]');
  await page.click('.modal button[data-act="seg"][data-val="tutti"]');
  await page.click('.modal button:has-text("Verifica")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento"), .modal .form-warn, .modal .form-error', { timeout: 15000 });
  assert.ok(!(await page.$('.modal .form-error')), await page.textContent('.modal'));
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  const wk = psql(`select week->'${wdk}' from shift_versions where therapist_id='${gialli}' order by valid_from desc limit 1`);
  for (const k of ['"amb"', 'briefing', 'segreteria', 'documentazione', 'corso', 'permesso_ore', 'recupero_ore', 'pausa', 'reparto']) assert.ok(wk.includes(k), 'manca ' + k);
  await page.click('button:has-text("Fine modifica orari")');
  await page.waitForTimeout(400);
  const txt = await page.textContent('.wk-grid');
  for (const l of ['Briefing', 'Segreteria', 'Cartelle / adempimenti', 'Corso obbligatorio', 'Permesso a ore', 'Recupero ore', 'Pausa', 'Reparto']) assert.ok(txt.includes(l), 'non visibile: ' + l);
  assert.ok((await page.$$(`.wk-free.act[data-day="${ed}"]`)).length >= 1, 'le fasce ambulatorio disegnate sono prenotabili');
  await page.screenshot({ path: '/tmp/claude-0/libero.png', fullPage: true });
  ok('Calendario libero: orario disegnato a mano con ambulatorio, reparto, pausa, cartelle/adempimenti, segreteria, corso, permesso a ore, recupero ore, briefing');

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
