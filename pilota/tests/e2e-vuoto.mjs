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
psql(`delete from patient_events where true; delete from appointments where true; delete from cycles where true; delete from patients where true; delete from absences where true;
  delete from day_overrides where true; delete from shift_versions where true; delete from therapist_skills where true; delete from import_batches where true; delete from therapists where true;`);
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
  {
    // l'amministratore aggiunge una competenza con il solo nome e sceglie chi la tratta
    await page.evaluate(() => { location.hash = '#/config'; });
    await page.waitForSelector('.tabs'); await page.click('.tabs button:has-text("Competenze e percorsi")');
    assert.match(await page.textContent('main'), /Linfodrenaggio/); assert.match(await page.textContent('main'), /Breast unit/);
    await page.click('button:has-text("+ Nuova competenza")');
    await page.fill('.modal input[data-bind="ce.name"]', 'Riabilitazione vestibolare');
    const bianchi = psql("select id from therapists where name='Bianchi Luca'");
    await page.click(`.modal button[data-path="ce.sk.${verdi}"][data-val="specifica"]`);
    await page.click(`.modal button[data-path="ce.sk.${bianchi}"][data-val="abilitato"]`);
    await page.click('.modal button[data-act="cat-save"]');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
    const cid = psql("select id from categories where name='Riabilitazione vestibolare'");
    assert.equal(cid, 'riabilitazione_vestibolare');
    assert.equal(psql(`select string_agg(t.name || '=' || s.level, ',' order by t.name) from therapist_skills s join therapists t on t.id=s.therapist_id where s.category_id='${cid}'`), 'Bianchi Luca=abilitato,Verdi Marco=specifica');
    await page.waitForSelector('tr:has-text("Riabilitazione vestibolare"):has-text("★ 1 · A 1")');
    ok('L’amministratore aggiunge una competenza (solo il nome) e sceglie in un passo chi la tratta: ★ specifica, A abilitato');
  }

  // paziente fittizio dal posto libero in agenda
  let day = E.addDays(psql('select app.today()'), 1);
  while (E.weekday(day) >= 6 || psql(`select count(*) from closures where day='${day}'`) !== '0') day = E.addDays(day, 1);
  const anna = psql("select id from therapists where name='Rossi Anna'");
  await page.evaluate(d => { location.hash = '#/agenda/' + d; }, day);
  await page.waitForTimeout(300);
  await page.selectOption('select[data-bind="ag.th"]', anna);
  await page.click('[data-act="ag-book"] >> nth=0');
  await page.fill('.modal input[data-bind="qb.name"]', '2026/0001');
  await page.dispatchEvent('.modal input[data-bind="qb.name"]', 'change');
  await page.click('.modal button[data-act="seg"][data-val="5"]');
  await page.waitForSelector('.modal .form-note:has-text("Tutte le 5 sedute")');
  await page.click('.modal button:has-text("Conferma e salva")');
  await page.waitForSelector('h2:has-text("2026/0001")', { timeout: 15000 });
  ok('Paziente fittizio inserito e assegnato: occupa il suo posto per 5 sedute');

  // paziente con ciclo già in corso: 10 sedute di cui 3 già svolte -> se ne prenotano 7
  await page.evaluate(d => { location.hash = '#/agenda/' + d; }, day);
  await page.waitForTimeout(300);
  await page.selectOption('select[data-bind="ag.th"]', verdi);
  await page.click('[data-act="ag-book"] >> nth=-1');
  await page.fill('.modal input[data-bind="qb.name"]', '2026/0002');
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
  await page.waitForSelector('h2:has-text("2026/0002")', { timeout: 15000 });
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
  assert.match(await page.textContent('.subst'), /2026\/0001/);
  assert.match(await page.textContent('.subst'), /Stesso orario con Verdi Marco/);
  await page.click('button:has-text("Rivedi e conferma")');
  await page.click('.modal button:has-text("Conferma e salva")');
  await page.waitForSelector('text=Esito del salvataggio', { timeout: 15000 });
  assert.equal(psql(`select t.name from appointments a join therapists t on t.id=a.therapist_id join patients p on p.id=a.patient_id where a.day='${day}' and p.name='2026/0001'`), 'Verdi Marco');
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
  await page.waitForSelector('button:has-text("Ferie / permesso")');
  await page.click('button:has-text("Ferie / permesso")');
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
  // orario della settimana compilato una volta dal riquadro «Orario»: fasce scritte a mano, giornata copiata, un giorno ritoccato
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/mese'; }, [gialli, ed]);
  await page.waitForSelector('button[data-act="or-open"]');
  await page.click('button[data-act="or-open"]');
  await page.waitForSelector('.modal .or-day');
  const fasce = [['amb', '07:15', '09:00'], ['reparto', '09:00', '12:00'], ['pausa', '12:00', '12:20'], ['amb', '12:20', '13:40'], ['documentazione', '13:40', '1412']];
  for (let i = 0; i < fasce.length; i++) {
    await page.click('.modal button[data-act="or-add"][data-k="1"]');
    await page.selectOption(`.modal select[data-bind="or.week.1.${i}.kind"]`, fasce[i][0]);
    for (const [k, v] of [['start', fasce[i][1]], ['end', fasce[i][2]]]) {
      await page.fill(`.modal input[data-bind="or.week.1.${i}.${k}"]`, '');
      await page.type(`.modal input[data-bind="or.week.1.${i}.${k}"]`, v, { delay: 40 });
      await page.press(`.modal input[data-bind="or.week.1.${i}.${k}"]`, 'Tab');
    }
  }
  assert.equal(await page.inputValue('.modal input[data-bind="or.week.1.4.end"]'), '14:12', '1412 scritto a mano diventa 14:12');
  await page.click('.modal button[data-act="or-copy"][data-k="1"]');
  await page.fill('.modal input[data-bind="or.week.3.1.end"]', '11:30'); await page.press('.modal input[data-bind="or.week.3.1.end"]', 'Tab');
  await page.fill('.modal input[data-bind="or.from"]', ed); await page.dispatchEvent('.modal input[data-bind="or.from"]', 'change');
  await page.click('.modal button:has-text("Controlla")');
  await page.waitForSelector('.modal .form-note:has-text("Nessun paziente")', { timeout: 15000 });
  await page.click('.modal button[data-act="or-save"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  const w1 = JSON.parse(psql(`select week->'1' from shift_versions where therapist_id='${gialli}' and valid_from='${ed}'`));
  assert.deepEqual(w1.map(b => b.kind + ' ' + b.start + '-' + b.end), ['amb 07:15-09:00', 'reparto 09:00-12:00', 'pausa 12:00-12:20', 'amb 12:20-13:40', 'documentazione 13:40-14:12']);
  assert.match(psql(`select (week->'3')::text from shift_versions where therapist_id='${gialli}' and valid_from='${ed}'`), /"end": "11:30"/);
  const wed = E.addDays(ed, 2);
  ok('Orario della settimana dal riquadro «Orario»: fasce scritte a mano (14:12 digitato 1412), lunedì copiato sugli altri giorni, mercoledì ritoccato, valido da lunedì');
  // un solo giorno diverso (corso) e da una data in poi (segreteria ogni lunedì), toccando la giornata
  const thu2 = E.addDays(ed, 10);
  async function tapDay(d, hhmm) {
    await page.evaluate(([g, x]) => { location.hash = '#/calendario/' + g + '/' + x + '/giorno'; }, [gialli, d]);
    const col = page.locator(`.wk-col[data-day="${d}"]`).first(); await col.waitFor();
    const min0 = Number(await col.getAttribute('data-min'));
    await col.click({ position: { x: 12, y: (E.toMin(hhmm) - min0) * 1.25 + 2 } });
    await page.waitForSelector('.drawer');
    await page.click('.drawer button[data-act="seg"][data-path="pd.kind"][data-val="attivita"]');
  }
  await tapDay(thu2, '09:30');
  await page.selectOption('.drawer select[data-bind="pd.act.kind"]', 'corso');
  await page.fill('.drawer input[data-bind="pd.act.start"]', '09:00'); await page.press('.drawer input[data-bind="pd.act.start"]', 'Tab');
  await page.fill('.drawer input[data-bind="pd.act.end"]', '12:00'); await page.press('.drawer input[data-bind="pd.act.end"]', 'Tab');
  await page.click('.drawer button[data-act="pd-save"]');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.match(psql(`select blocks::text from day_overrides where therapist_id='${gialli}' and day='${thu2}'`), /corso/);
  const mon3 = E.addDays(ed, 14);
  await tapDay(mon3, '12:30');
  await page.selectOption('.drawer select[data-bind="pd.act.kind"]', 'segreteria');
  await page.fill('.drawer input[data-bind="pd.act.start"]', '12:20'); await page.press('.drawer input[data-bind="pd.act.start"]', 'Tab');
  await page.fill('.drawer input[data-bind="pd.act.end"]', '13:00'); await page.press('.drawer input[data-bind="pd.act.end"]', 'Tab');
  await page.click('.drawer button[data-act="seg"][data-path="pd.act.scope"][data-val="sempre"]');
  await page.click('.drawer button[data-act="pd-save"]');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.match(psql(`select (week->'1')::text from shift_versions where therapist_id='${gialli}' and valid_from='${mon3}'`), /segreteria/);
  assert.doesNotMatch(psql(`select (week->'1')::text from shift_versions where therapist_id='${gialli}' and valid_from='${ed}'`), /segreteria/, 'prima di quella data l’orario non cambia');
  ok('Toccando la giornata: corso solo per un giovedì; segreteria ogni lunedì da una data in poi (il passato non cambia)');
  // paziente alla quarta seduta di dieci, Lun-Mer-Ven, dal pannello laterale
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/giorno'; }, [gialli, ed]);
  await page.waitForSelector(`.wk-free.act[data-day="${ed}"]`);
  await page.click(`.wk-free.act[data-day="${ed}"] >> nth=0`, { position: { x: 20, y: 4 } }); // in alto: inizio dello spazio libero
  await page.waitForSelector('.drawer');
  await page.fill('.drawer input[data-bind="pd.q"]', '2026/0004');
  // alla quarta seduta di dieci: ne restano 7 (totale del ciclo nei dettagli)
  await page.fill('.drawer input[data-bind="pd.left"]', '7');
  await page.dispatchEvent('.drawer input[data-bind="pd.left"]', 'change');
  await page.click('.drawer button[data-act="pd-more"]');
  await page.fill('.drawer input[data-bind="pd.planned"]', '10');
  await page.dispatchEvent('.drawer input[data-bind="pd.planned"]', 'change');
  await page.click('.drawer button[data-act="pd-day"][data-wd="3"]');
  await page.click('.drawer button[data-act="pd-day"][data-wd="5"]');
  await page.waitForSelector('.drawer .form-note:has-text("Tutti i posti liberi")', { timeout: 10000 });
  assert.equal(await page.$eval('.drawer .pd-list li .cnt', e => e.textContent), '7', 'la prima seduta porta il 7 (conto alla rovescia)');
  assert.equal((await page.$$('.wk-ghost')).length >= 1, true, 'anteprima delle sedute sul calendario');
  await page.click('.drawer button[data-act="pd-save"]');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  const qs = psql(`select c.prior_sessions||'/'||c.planned_sessions||'/'||count(a.*) from cycles c join patients p on p.id=c.patient_id join appointments a on a.cycle_id=c.id where p.name='2026/0004' group by c.id`);
  assert.equal(qs, '3/10/7');
  assert.equal(psql(`select string_agg(distinct extract(isodow from a.day)::text, ',') from appointments a join patients p on p.id=a.patient_id where p.name='2026/0004'`), '1,3,5');
  ok('Paziente alla 4ª seduta di 10 inserito dal calendario (pannello laterale, anteprima): 3 già svolte, 7 programmate Lun-Mer-Ven');
  // orari diversi per giorno: dal mercoledì, solo i mercoledì alle 12:20 (dal nome del paziente nel tabulato)
  await page.evaluate(([g, d]) => { location.hash = '#/calendario/' + g + '/' + d + '/mese'; }, [gialli, ed]);
  await page.click('.tg .tg-name button:has-text("2026/0004")');
  await page.click('.modal button:has-text("Cambia ora dal")');
  await page.fill('.modal input[data-bind="tp.time"]', '12.20'); await page.press('.modal input[data-bind="tp.time"]', 'Tab');
  await page.fill('.modal input[data-bind="tp.from"]', wed); await page.dispatchEvent('.modal input[data-bind="tp.from"]', 'change');
  await page.uncheck('.modal input[data-bind="tp.wds"][value="1"]');
  await page.uncheck('.modal input[data-bind="tp.wds"][value="5"]');
  await page.click('.modal button[data-act="tp-save"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select string_agg(distinct to_char(a.start_time,'HH24:MI'), ',') from appointments a join patients p on p.id=a.patient_id where p.name='2026/0004' and extract(isodow from a.day)=3`), '12:20');
  assert.equal(psql(`select string_agg(distinct to_char(a.start_time,'HH24:MI'), ',') from appointments a join patients p on p.id=a.patient_id where p.name='2026/0004' and extract(isodow from a.day)=1`), '07:15');
  ok('Dal nome del paziente: dal mercoledì in poi, solo i mercoledì alle 12:20 (scritto 12.20); lunedì e venerdì restano alle 7:15');
  // assenza dalla casella del tabulato, con una seduta aggiunta in fondo al ciclo
  await page.click(`.tg tr:has(.tg-name:has-text("2026/0004")) td:nth-child(${Number(ed.slice(8)) + 1}) button`);
  await page.click('.modal button[data-act="ts-absent"][data-rec="1"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select count(*) filter (where a.status='assente')||'/'||count(*) filter (where a.status='programmata') from appointments a join patients p on p.id=a.patient_id where p.name='2026/0004'`), '1/7', 'l’assenza non scala: le 7 sedute restano tutte in programma');
  ok('Dal tabulato: assenza del paziente con una seduta aggiunta in fondo, il conteggio resta giusto');

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
  assert.match(await pf.textContent('.pilot-banner'), /il tuo tabulato/);
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
