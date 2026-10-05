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

  const wday = E.addDays(day, 7);

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

  // ===== calendario come posto di lavoro: orario disegnato con pennelli, bozza + salva, paziente alla 4ª seduta di 10 =====
  await page.evaluate(() => { location.hash = '#/config'; });
  await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Fisioterapisti")');
  await page.click('button:has-text("Inserimento rapido")');
  await page.fill('.modal textarea[data-bind="tb.names"]', 'Gialli Sara');
  assert.equal(await page.inputValue('.modal select[data-bind="tb.tpl"]'), '', 'per impostazione predefinita nessun turno');
  await page.click('.modal button:has-text("Inserisci tutti")');
  await page.waitForSelector('.modal .form-note:has-text("Inseriti 1")', { timeout: 15000 });
  await page.click('.modal button:has-text("Chiudi")');
  const gialli = psql("select id from therapists where name='Gialli Sara'");
  await page.evaluate(g => { const th = window.FA.state.ctx.th.get(g); }, gialli);
  // competenza mano per poter prenotare
  await page.click('button:has-text("Tabella competenze")');
  await page.selectOption(`.modal select[data-bind="sk.m.${gialli}.mano"]`, 'specifica');
  await page.click('.modal button:has-text("Salva le competenze")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  let ed = E.addDays(psql('select app.today()'), 1);
  while (E.weekday(ed) !== 1) ed = E.addDays(ed, 1);          // il prossimo lunedì
  const closed = d => psql(`select count(*) from closures where day='${d}'`) !== '0';
  assert.ok(![0, 1, 2, 3, 4].some(i => closed(E.addDays(ed, i))), 'settimana di prova senza festività');
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/settimana'; }, [gialli, ed]);
  await page.waitForSelector('button:has-text("✎ Orario")');
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.click('button:has-text("✎ Orario")');
  await page.waitForSelector('.wk-col.paint');
  async function colInfo(d) { const col = await page.$(`.wk-col.paint[data-day="${d}"]`); const bb = await col.boundingBox(); const min = Number(await col.getAttribute('data-min')); return { bb, y: t => bb.y + (E.toMin(t) - min) * 1.25 + 1 }; }
  async function dragOn(d, from, to) { const c = await colInfo(d); await page.mouse.move(c.bb.x + c.bb.width / 2, c.y(from)); await page.mouse.down(); await page.mouse.move(c.bb.x + c.bb.width / 2, c.y(to), { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(120); }
  async function clickAt(d, t) { const c = await colInfo(d); await page.mouse.click(c.bb.x + c.bb.width / 2, c.y(t)); await page.waitForTimeout(120); }
  const brush = async k => { await page.click(`button.brush[data-k="${k}"]`); await page.waitForTimeout(80); };
  await dragOn(ed, '07:15', '09:00');                                  // ambulatorio (pennello predefinito)
  await brush('reparto'); await dragOn(ed, '09:00', '12:00');
  await brush('pausa'); await clickAt(ed, '12:00');                    // clic: durata rapida 20′ -> 12:00-12:20
  await brush('amb'); await dragOn(ed, '12:22', '13:45');             // l'inizio si aggancia alla fine della pausa (12:20)
  await brush('documentazione'); await clickAt(ed, '13:50');           // 13:45-14:15 (durata rapida 30′)
  // orari precisi scritti a mano (13:40 e 14:12), digitati cifra per cifra
  await page.click(`.wk-col.paint[data-day="${ed}"] [data-blk]:has-text("Cartelle")`);
  await page.waitForSelector('.modal input[data-bind="bk1.end"]');
  await page.fill('.modal input[data-bind="bk1.start"]', '');
  await page.type('.modal input[data-bind="bk1.start"]', '13:40', { delay: 60 });
  assert.equal(await page.inputValue('.modal input[data-bind="bk1.start"]'), '13:40');
  await page.fill('.modal input[data-bind="bk1.end"]', '');
  await page.type('.modal input[data-bind="bk1.end"]', '1412', { delay: 60 });
  assert.equal(await page.inputValue('.modal input[data-bind="bk1.end"]'), '1412', 'mentre si scrive il campo non viene modificato');
  await page.click('.modal button:has-text("Applica")');
  await page.waitForSelector('.modal', { state: 'detached' });
  const monday = await page.evaluate(d => window.FA.state.ui.pt.drafts[d].map(b => b.kind + ' ' + b.start + '-' + b.end).join(', '), ed);
  assert.equal(monday, 'amb 07:15-09:00, reparto 09:00-12:00, pausa 12:00-12:20, amb 12:20-13:40, documentazione 13:40-14:12');
  // copia della giornata sugli altri giorni
  await page.click(`.wk-head[data-day="${ed}"]`);
  for (let i = 1; i <= 4; i++) await page.check(`.modal input[data-bind="dy.to"][value="${E.addDays(ed, i)}"]`);
  await page.click('.modal button:has-text("Copia")');
  await page.waitForSelector('.modal', { state: 'detached' });
  // mercoledì il reparto finisce alle 11:30: si trascina il bordo inferiore
  const wed = E.addDays(ed, 2);
  await brush('reparto');
  const rep = await page.$(`.wk-col.paint[data-day="${wed}"] [data-blk]:has-text("Reparto")`);
  const rb = await rep.boundingBox(); const wc = await colInfo(wed);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height - 3); await page.mouse.down(); await page.mouse.move(rb.x + rb.width / 2, wc.y('11:30'), { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(150);
  assert.match(await page.evaluate(d => window.FA.state.ui.pt.drafts[d].map(b => b.kind + ' ' + b.start + '-' + b.end).join(', '), wed), /reparto 09:00-11:30/);
  // salva come orario abituale da lunedì in poi
  await page.click('button:has-text("Salva…")');
  await page.click('.modal button[data-act="seg"][data-val="from"]');
  await page.click('.modal button:has-text("Verifica")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun appuntamento")', { timeout: 15000 });
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  const w1 = JSON.parse(psql(`select week->'1' from shift_versions where therapist_id='${gialli}' and valid_from='${ed}'`));
  assert.deepEqual(w1.map(b => b.kind + ' ' + b.start + '-' + b.end), ['amb 07:15-09:00', 'reparto 09:00-12:00', 'pausa 12:00-12:20', 'amb 12:20-13:40', 'documentazione 13:40-14:12']);
  assert.match(psql(`select (week->'3')::text from shift_versions where therapist_id='${gialli}' and valid_from='${ed}'`), /"end": "11:30"/);
  ok('Orario disegnato nel calendario con pennelli (trascina e clic), un orario scritto a mano (14:12) senza correzioni durante la digitazione, giornata copiata, bordo trascinato, salvato da lunedì in poi');
  // un solo giorno diverso (corso) e un periodo (segreteria) con ritorno automatico
  const thu2 = E.addDays(ed, 10);
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/settimana'; }, [gialli, thu2]);
  await page.waitForSelector(`.wk-col.paint[data-day="${thu2}"]`);
  await brush('corso'); await dragOn(thu2, '09:00', '12:00');
  await page.click('button:has-text("Salva…")');
  await page.click('.modal button:has-text("Verifica")');
  await page.waitForSelector('.modal .form-note, .modal .form-warn', { timeout: 15000 });
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.match(psql(`select blocks::text from day_overrides where therapist_id='${gialli}' and day='${thu2}'`), /corso/);
  const mon3 = E.addDays(ed, 14);
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/settimana'; }, [gialli, mon3]);
  await page.waitForSelector(`.wk-col.paint[data-day="${mon3}"]`);
  await brush('segreteria'); await dragOn(mon3, '12:20', '13:00');
  await page.click('button:has-text("Salva…")');
  await page.click('.modal button[data-act="seg"][data-val="range"]');
  await page.fill('.modal input[data-bind="sv.to"]', E.addDays(mon3, 4));
  await page.dispatchEvent('.modal input[data-bind="sv.to"]', 'change');
  await page.click('.modal button:has-text("Verifica")');
  await page.waitForSelector('.modal .form-note, .modal .form-warn', { timeout: 15000 });
  await page.click('.modal button:has-text("Salva")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.match(psql(`select (week->'1')::text from shift_versions where therapist_id='${gialli}' and valid_from='${mon3}'`), /segreteria/);
  assert.equal(psql(`select (week->'1')::text like '%segreteria%' from shift_versions where therapist_id='${gialli}' and valid_from='${E.addDays(mon3, 5)}'`), 'f', 'dopo il periodo torna l’orario precedente');
  ok('Variazione di un solo giorno (corso) e di un periodo (segreteria, dal … al …) con ritorno automatico all’orario abituale');
  await page.click('button:has-text("Fine orario")');
  // paziente alla quarta seduta di dieci, Lun-Mer-Ven, dal pannello laterale
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/settimana'; }, [gialli, ed]);
  await page.waitForSelector(`.wk-free.act[data-day="${ed}"]`);
  await page.click(`.wk-free.act[data-day="${ed}"] >> nth=0`);
  await page.waitForSelector('.drawer');
  await page.fill('.drawer input[data-bind="pd.name"]', 'Quarta Seduta');
  await page.dispatchEvent('.drawer input[data-bind="pd.name"]', 'change');
  await page.fill('.drawer input[data-bind="pd.at"]', '4');
  await page.dispatchEvent('.drawer input[data-bind="pd.at"]', 'change');
  await page.click('.drawer button[data-act="pd-day"][data-wd="3"]');
  await page.click('.drawer button[data-act="pd-day"][data-wd="5"]');
  await page.waitForSelector('.drawer .form-note:has-text("Tutte disponibili")', { timeout: 10000 });
  assert.match(await page.textContent('.drawer'), /3 sedute già svolte/);
  assert.equal((await page.$$('.wk-ghost')).length >= 3, true, 'anteprima delle sedute sul calendario');
  await page.click('.drawer button:has-text("Conferma")');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  const qs = psql(`select c.prior_sessions||'/'||c.planned_sessions||'/'||count(a.*) from cycles c join patients p on p.id=c.patient_id join appointments a on a.cycle_id=c.id where p.name='Quarta Seduta' group by c.id`);
  assert.equal(qs, '3/10/7');
  assert.equal(psql(`select string_agg(distinct extract(isodow from a.day)::text, ',') from appointments a join patients p on p.id=a.patient_id where p.name='Quarta Seduta'`), '1,3,5');
  ok('Paziente alla 4ª seduta di 10 inserito dal calendario (pannello laterale, anteprima): 3 già svolte, 7 programmate Lun-Mer-Ven');
  // orari diversi per giorno: il mercoledì alle 12:20 da quella seduta in poi
  await page.waitForSelector('.wk-appt:has-text("Quarta Seduta")');
  const wedAppt = psql(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='Quarta Seduta' and a.day='${wed}'`);
  await page.click(`.wk-appt[data-id="${wedAppt}"]`);
  await page.click('.modal button:has-text("Sposta solo questa seduta")');
  await page.click('.modal button[data-act="seg"][data-val="successive"]');
  await page.fill('.modal input[data-bind="am.rg.time"]', '12.20');
  await page.dispatchEvent('.modal input[data-bind="am.rg.time"]', 'change');
  await page.waitForSelector('.modal button:has-text("Applica alle"):not([disabled])', { timeout: 10000 });
  await page.click('.modal button:has-text("Applica alle")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select string_agg(distinct to_char(a.start_time,'HH24:MI'), ',') from appointments a join patients p on p.id=a.patient_id where p.name='Quarta Seduta' and extract(isodow from a.day)=3`), '12:20');
  assert.equal(psql(`select string_agg(distinct to_char(a.start_time,'HH24:MI'), ',') from appointments a join patients p on p.id=a.patient_id where p.name='Quarta Seduta' and extract(isodow from a.day)=1`), '07:15');
  ok('Variazione “questa e le successive”: il mercoledì passa alle 12:20 (scritto 12.20), lunedì e venerdì restano alle 7:15');
  // assenza con recupero dal calendario
  await page.click(`.wk-appt:has-text("Quarta Seduta") >> nth=0`);
  await page.click('.modal button:has-text("Assente · da recuperare")');
  await page.waitForSelector('.modal h4:has-text("recupero")', { timeout: 15000 });
  let rd = E.addDays(ed, 1), times = [];
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
  assert.equal(psql(`select count(*) from appointments a join patients p on p.id=a.patient_id where p.name='Quarta Seduta' and a.status='assente' and a.recovered_by is not null`), '1');
  await page.screenshot({ path: '/tmp/claude-0/cal-new.png', fullPage: true });
  ok('Dal calendario: assenza del paziente con recupero');

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
