// Prova nel browser: importazione di un tabulato FITTIZIO, ricarica senza doppioni, annullamento,
// correzioni rapide dal calendario (trascinamento, numerazione, visita, elimina, seduta aggiunta).
// Usa il database LOCALE di prova; crea i propri dati con nomi inventati.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, ensureUser, login, PASSWORD, psql, E, S } from './helpers.mjs';

const PORT = 8094, RUN = Date.now().toString(36).slice(-4);
let step = 0;
const ok = m => console.log(`✓ ${++step}. ${m}`);
await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
const admin = await login('coord@pilota.test');
const T0 = psql('select app.today()');
const TH = 'Fittizio ' + RUN;
const DAY = [{ kind: 'amb', start: '07:00', end: '12:00' }, { kind: 'pausa', start: '12:00', end: '12:20' }, { kind: 'amb', start: '12:20', end: '14:30' }];
const thId = await S.rpc(admin, 'admin_save_therapist', { p: { name: TH, activity: 'ambulatorio', skills: [{ category_id: 'mano', level: 'specifica' }] } });
await S.rpc(admin, 'admin_save_shift', { p_th: thId, p_valid_from: T0, p_week: { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: [], 7: [] }, p_note: '', p_dry_run: false });
const colId = await S.rpc(admin, 'admin_save_therapist', { p: { name: 'Collega ' + RUN, activity: 'ambulatorio', skills: [{ category_id: 'mano', level: 'specifica' }] } });
await S.rpc(admin, 'admin_save_shift', { p_th: colId, p_valid_from: T0, p_week: { 1: DAY, 2: DAY, 3: DAY, 4: DAY, 5: DAY, 6: [], 7: [] }, p_note: '', p_dry_run: false });

// tabulato del mese prossimo, costruito sulle date reali di quel mese
let first = E.addDays(T0, 1); while (first.slice(8) !== '01') first = E.addDays(first, 1);
const M = first.slice(0, 7);
const closures = new Set(psql("select coalesce(string_agg(day::text, ','), '') from closures").split(',').filter(Boolean));
const daysOf = (wds, n) => { const out = []; let d = first; while (out.length < n && d.slice(0, 7) === M) { if (wds.includes(E.weekday(d)) && !closures.has(d)) out.push(d); d = E.addDays(d, 1); } return out; };
const cells = (dates, vals) => Object.fromEntries(dates.map((d, i) => [String(Number(d.slice(8))), vals[i]]));
const bi = daysOf([1, 3, 5], 4), ne = daysOf([2, 4], 6), gi = daysOf([2, 4], 4), vi = daysOf([5], 3);
const name = n => n + ' ' + RUN;
let ferieDay = E.addDays(first, 40); while (ferieDay.slice(0, 7) !== M || E.weekday(ferieDay) >= 6 || closures.has(ferieDay)) ferieDay = E.addDays(ferieDay, -1);
ferieDay = Number(ferieDay.slice(8));
const transcript = { formato: 'fisioagenda-tabulato-1', fogli: [{ fisioterapista: TH, mese: M, foto: 'tabulato-fittizio.png', durata: null, durata_suggerita: 30, sedute_ciclo: 10,
  griglia: { x_giorno1: 27.16, x_giorno31: 96.84, h_riga: 4.6 },
  righe: [
    { rif: 'F1', ora: '07:15', paziente: name('Bianchi'), frequenza: '3v', giorni: [1, 3, 5], tipo: 'GC', y: 17.69, caselle: cells(bi, ['3', '2', '1V', 'R']), orari: { [String(Number(bi[1].slice(8)))]: '09:30' } },
    { rif: 'F2', ora: '07:15', paziente: name('Neri'), frequenza: '2v', giorni: [2, 4], tipo: 'RM', y: 22.31, caselle: cells(ne, ['6', '5', '4', '3', '2', '1']), sostituti: { [String(Number(ne[2].slice(8)))]: 'XY' } },
    { rif: 'F3', ora: '08:15', paziente: name('Gialli'), frequenza: '2v', giorni: [2, 4], tipo: 'GC', y: 26.92, caselle: cells(gi, ['4', '3', '2', '1']), dubbi: { [String(Number(gi[1].slice(8)))]: '3 poco leggibile' } },
    { rif: 'F4', ora: '06:30', paziente: name('Viola'), frequenza: 'Ven', giorni: [5], tipo: 'GC', y: 31.54, caselle: cells(vi, ['10', '9', '8']), dubbi_riga: ['orario 6:30?'] }
  ], estemporanei: [], note: [{ giorni: [20], testo: 'Corso' }], assenze: [{ giorni: [ferieDay], tipo: 'ferie', nota: 'F sul foglio' }] }] };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-imp-'));
const jsonFile = path.join(tmp, 'trascrizione.json');
fs.writeFileSync(jsonFile, JSON.stringify(transcript));
const photo = path.join(ROOT, 'esempi/tabulato-fittizio.png');

const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.js'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const browser = await chromium.launch();
const errors = [];
const count = sql => Number(psql(sql));
const pats = `(select id from patients where name like '% ${RUN}')`;
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`http://localhost:${PORT}/`);
  await page.fill('#em', 'coord@pilota.test'); await page.fill('#pw', PASSWORD); await page.click('button[type=submit]');
  await page.waitForSelector('nav a[href="#/importa"]', { timeout: 20000 });
  await page.click('nav a[href="#/importa"]');
  const load = async () => {
    await page.setInputFiles('input[data-imp-files]', [jsonFile, photo]);
    await page.waitForSelector('.imp-row[data-ref="F4"]', { timeout: 10000 });
  };
  await load();
  assert.equal(await page.$eval(`select[data-bind$=".th"]`, el => el.value), thId, 'fisioterapista riconosciuto dal nome sul foglio');
  assert.ok(await page.$('.imp-ph-wrap img'), 'foto accanto ai dati');
  assert.ok(await page.$('.imp-grid td.doubt'), 'lettura incerta evidenziata');
  assert.match(await page.textContent('main'), /Durata predefinita delle sedute/);
  assert.equal(await page.$eval('.panel button[data-act="seg"][data-path$=".durSel"].on', b => b.getAttribute('data-val')), '30', 'durata proposta dal foglio, modificabile');
  assert.match(await page.textContent('main'), /Proposta in base al foglio/);
  ok('Foto e trascrizione caricate: fisioterapista riconosciuto, foto accanto, letture incerte evidenziate, durata predefinita proposta (30 minuti)');

  // clic su una casella: evidenziata sulla foto
  await page.click('.imp-row[data-ref="F1"] input[data-imp-cell] >> nth=' + (Number(bi[0].slice(8)) - 1));
  assert.equal(await page.$eval('.imp-mark', el => el.style.display), 'block');
  await page.click('.imp-split ~ * button[data-val="30"], .panel button[data-act="seg"][data-val="30"]');
  await page.waitForSelector('.imp-row[data-ref="F4"] .imp-conf');
  assert.match(await page.textContent('.imp-row[data-ref="F4"]'), /fuori dalle fasce/);
  // correzioni: lettura confermata, orario controllato, "importa comunque" per il fuori turno
  await page.click('.imp-row[data-ref="F3"] .imp-okc');
  // sigla sotto il numero: il collega che ha fatto la seduta
  await page.selectOption('.panel:has(h3:has-text("sigle dei colleghi")) select', colId);
  await page.click('.imp-row[data-ref="F4"] input[data-act-change="imp-rd"]');
  const nForce = (await page.$$('.imp-row[data-ref="F4"] input[data-act-change="imp-force"]')).length;
  assert.equal(nForce, 3);
  for (let k = 0; k < nForce; k++) { await page.click(`.imp-row[data-ref="F4"] input[data-act-change="imp-force"] >> nth=${k}`); await page.waitForTimeout(100); }
  await page.waitForFunction(() => !document.querySelector('button[data-act="imp-go"]').disabled, null, { timeout: 5000 });
  assert.match(await page.textContent('.imp-confirm'), /4 pazienti \(4 nuovi\) e 17 sedute, 1 visite fisiatriche/);
  ok('Correzioni nell’anteprima: casella confermata, orario controllato, fuori turno importati consapevolmente');

  await page.click('button[data-act="imp-go"]');
  await page.waitForSelector('h3:has-text("salvata")', { timeout: 15000 });
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats}`), 17);
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats} and status <> 'programmata'`), 0, 'nessuna seduta segnata come svolta');
  assert.equal(psql(`select c.prior_sessions from cycles c join patients p on p.id=c.patient_id where p.name='${name('Bianchi')}'`), '7');
  assert.equal(count(`select count(*) from patient_events where patient_id in ${pats}`), 1);
  assert.equal(psql(`select sheet_mark from appointments a join patients p on p.id=a.patient_id where p.name='${name('Bianchi')}' and a.day='${bi[3]}'`), 'R');
  assert.equal(psql(`select to_char(start_time,'HH24:MI') from appointments a join patients p on p.id=a.patient_id where p.name='${name('Bianchi')}' and a.day='${bi[1]}'`), '09:30', 'orario della singola casella');
  assert.equal(psql(`select (a.therapist_id='${colId}')::text||' '||a.substitute_kind||' '||(a.original_therapist_id='${thId}')::text from appointments a join patients p on p.id=a.patient_id where p.name='${name('Neri')}' and a.day='${ne[2]}'`), 'true singola true', 'sigla del collega: sostituzione');
  // ferie segnate sul foglio (F): registrate solo con il pulsante
  assert.equal(count(`select count(*) from absences where therapist_id='${thId}'`), 0, 'le ferie non si registrano da sole');
  await page.click('button[data-act="imp-abs"]');
  await page.waitForSelector('.panel:has(h3:has-text("segnate sul foglio")) .chip.ok', { timeout: 15000 });
  assert.equal(psql(`select kind||' '||start_date||' '||end_date from absences where therapist_id='${thId}'`), `ferie ${M}-${String(ferieDay).padStart(2, '0')} ${M}-${String(ferieDay).padStart(2, '0')}`);
  ok('Importazione confermata: 4 pazienti, 17 sedute programmate (numeri a ritroso → 8ª, 9ª, 10ª), R come recupero, V come visita, sigla del collega come sostituzione, orario della singola casella; ferie del foglio registrate con un clic');

  // stessa foto e stessa trascrizione di nuovo: nessun doppione
  await load();
  await page.waitForSelector('text=Questa foto è già stata importata');
  assert.match(await page.textContent('.imp-row[data-ref="F1"]'), /già nel calendario/);
  assert.ok(await page.$eval('button[data-act="imp-go"]', b => b.disabled), 'niente di nuovo da importare');
  ok('Stessa foto ricaricata: riconosciuta, pazienti collegati ai cicli esistenti, nessuna seduta doppia');

  // annullamento dall'elenco delle importazioni
  await page.click('.panel:has(h3:has-text("Importazioni recenti")) button[data-act="imp-undo"] >> nth=0');
  await page.waitForFunction(() => document.body.textContent.includes('annullata'), null, { timeout: 15000 });
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats}`), 0);
  assert.equal(count(`select count(*) from patients where name like '% ${RUN}'`), 0);
  ok('Importazione annullata: sedute, cicli e pazienti creati eliminati');

  // di nuovo, per le correzioni dal calendario
  for (const x of await page.$$('button[data-act="imp-close"]')) { await page.click('button[data-act="imp-close"] >> nth=0'); }
  await load();
  await page.click('.panel button[data-act="seg"][data-val="30"]');
  await page.click('.imp-row[data-ref="F3"] .imp-okc');
  await page.uncheck('.imp-row[data-ref="F4"] input[data-bind$=".include"]');
  await page.selectOption('.imp-row[data-ref="F2"] select.imp-dur', '60');
  await page.waitForFunction(() => !document.querySelector('button[data-act="imp-go"]').disabled, null, { timeout: 5000 });
  await page.click('button[data-act="imp-go"]');
  await page.waitForSelector('h3:has-text("salvata")', { timeout: 15000 });
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats}`), 14);
  assert.equal(psql(`select string_agg(distinct (extract(epoch from end_time - start_time)/60)::int::text, ',') from appointments a join patients p on p.id=a.patient_id where p.name='${name('Neri')}'`), '60', 'durata di 1 ora scelta per il paziente');
  assert.equal(psql(`select string_agg(distinct (extract(epoch from end_time - start_time)/60)::int::text, ',') from appointments a join patients p on p.id=a.patient_id where p.name='${name('Gialli')}'`), '30', 'gli altri con la durata del foglio');

  // trascinamento: Bianchi dalle 7:15 alle 9:00 dello stesso giorno
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, bi[0]]);
  const b0 = psql(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='${name('Bianchi')}' and a.day='${bi[0]}'`);
  await page.waitForSelector(`.wk-appt[data-id="${b0}"]`);
  await page.waitForTimeout(800); // attende eventuali aggiornamenti in tempo reale
  const el = page.locator(`.wk-appt[data-id="${b0}"]`);
  assert.match(await el.textContent(), /8\/10/);
  const box = await el.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 5); await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 4 }); await page.mouse.move(box.x + 20, box.y + 5 + 105 * 1.25, { steps: 6 });
  assert.match(await page.textContent('.wk-ghost'), /09:00/);
  await page.mouse.up();
  await page.waitForFunction(id => { const e = document.querySelector('.wk-appt[data-id="' + id + '"]'); return e && e.textContent.includes('09:00'); }, b0, { timeout: 15000 });
  assert.equal(psql(`select to_char(start_time,'HH24:MI') from appointments where id='${b0}'`), '09:00');
  ok('Durata per paziente (1 ora per Neri, 30′ gli altri); seduta trascinata sul calendario alle 9:00, con controllo del posto');

  // ✎ Correggi: numerazione, tipo, visita, elimina
  await page.click(`.wk-appt[data-id="${b0}"]`);
  await page.click('.modal button:has-text("✎ Correggi")');
  await page.fill('.modal input[data-bind="am.fx.n"]', '7'); await page.dispatchEvent('.modal input[data-bind="am.fx.n"]', 'change');
  await page.fill('.modal input[data-bind="am.fx.treatment"]', 'rm');
  await page.click('.modal button:has-text("Salva le correzioni")');
  await page.waitForFunction(() => document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('Seduta 7 di 10'), null, { timeout: 15000 });
  assert.equal(psql(`select prior_sessions||' '||treatment from cycles c join patients p on p.id=c.patient_id where p.name='${name('Bianchi')}'`), '6 RM');
  await page.click('.modal button:has-text("✎ Correggi")');
  await page.click('.modal input[data-act-change="am-visit"]');
  await page.waitForFunction(() => document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('V visita fisiatrica'), null, { timeout: 15000 });
  assert.equal(count(`select count(*) from patient_events e join patients p on p.id=e.patient_id where p.name='${name('Bianchi')}'`), 2);
  await page.click('.modal button:has-text("Chiudi")');
  const n1 = psql(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='${name('Neri')}' and a.day='${ne[1]}'`);
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, ne[1]]);
  await page.click(`.wk-appt[data-id="${n1}"]`);
  await page.click('.modal button:has-text("✎ Correggi")');
  await page.click('.modal button:has-text("Elimina questa seduta")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(count(`select count(*) from appointments where id='${n1}'`), 0);
  ok('Correzioni rapide dalla seduta: numerazione (ora 7ª di 10), tipo, visita fisiatrica, seduta inserita per errore eliminata');

  // spazio libero → paziente in archivio già in trattamento → si aggiunge la seduta mancante
  await page.waitForSelector(`.wk-free.act[data-day="${ne[1]}"]`);
  await page.click(`.wk-free.act[data-day="${ne[1]}"] >> nth=0`, { position: { x: 20, y: 4 } }); // in alto: le 7:00
  await page.waitForSelector('.drawer');
  await page.click('.drawer button[data-act="seg"][data-val="esistente"]');
  await page.fill('.drawer input[data-bind="pd.q"]', 'Neri ' + RUN); await page.dispatchEvent('.drawer input[data-bind="pd.q"]', 'change');
  await page.click('.drawer button[data-act="pd-pick"]:has-text("Neri")');
  await page.waitForSelector('.drawer .form-note:has-text("Manca 1 seduta da programmare")');
  await page.waitForSelector('.drawer .form-note:has-text("Disponibile")', { timeout: 10000 });
  await page.click('.drawer button:has-text("Conferma")');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.equal(count(`select count(*) from appointments a join patients p on p.id=a.patient_id where p.name='${name('Neri')}'`), 6);
  ok('Dallo spazio libero: paziente già in trattamento scelto dall’archivio, aggiunta la seduta mancante');

  // "+ Aggiungi paziente": fisioterapista e giorno del calendario aperto, modificabili
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, gi[0]]);
  await page.click('button[data-act="pd-add"]');
  await page.waitForSelector('.drawer');
  assert.equal(await page.$eval('.drawer select[data-bind="pd.th"]', e => e.value), thId);
  assert.equal(await page.$eval('.drawer input[data-bind="pd.day"]', e => e.value), gi[0]);
  await page.click('.drawer button[data-act="pd-close"]');
  // una seduta di Gialli eliminata per errore, poi rimessa dall'elenco dei pazienti in trattamento
  const g1 = psql(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='${name('Gialli')}' and a.day='${gi[1]}'`);
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, gi[1]]);
  await page.click(`.wk-appt[data-id="${g1}"]`);
  await page.click('.modal button:has-text("✎ Correggi")');
  await page.click('.modal button:has-text("Elimina questa seduta")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  const before = count(`select count(*) from appointments a join patients p on p.id=a.patient_id where p.name='${name('Gialli')}'`);
  await page.click('button[data-act="pl-open"]');
  await page.waitForSelector('.drawer .pl-list');
  await page.fill('.drawer input[data-bind="pl.q"]', 'Gialli'); await page.dispatchEvent('.drawer input[data-bind="pl.q"]', 'change');
  await page.waitForSelector('.drawer .pl-list li:has-text("1 da programmare")');
  await page.click('.drawer .pl-list li:has-text("Gialli") button[data-act="pl-add"]');
  await page.waitForSelector('.drawer select[data-bind="pd.th"]');
  assert.match(await page.textContent('.drawer'), /Manca 1 seduta da programmare/);
  await page.fill('.drawer input[data-bind="pd.start"]', '10:00'); await page.dispatchEvent('.drawer input[data-bind="pd.start"]', 'change');
  await page.waitForSelector('.drawer .form-note:has-text("Disponibile")', { timeout: 10000 });
  await page.click('.drawer button:has-text("Conferma")');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.equal(count(`select count(*) from appointments a join patients p on p.id=a.patient_id where p.name='${name('Gialli')}'`), before + 1);
  assert.equal(count(`select count(*) from cycles c join patients p on p.id=c.patient_id where p.name='${name('Gialli')}'`), 1, 'nessun ciclo nuovo');
  assert.equal(count(`select count(*) from patients where name='${name('Gialli')}'`), 1, 'nessuna anagrafica duplicata');
  assert.equal(psql(`select a.status||' '||to_char(a.start_time,'HH24:MI') from appointments a join patients p on p.id=a.patient_id where p.name='${name('Gialli')}' order by a.created_at desc limit 1`), 'programmata 10:00');
  ok('Dal calendario: “+ Aggiungi paziente” con collega e giorno precompilati; elenco dei pazienti in trattamento → una seduta aggiunta al suo ciclo, senza nuova anagrafica né nuovo ciclo');
  // percorso completo delle sostituzioni: tabulato del collega con un paziente del titolare (Neri) trattato in sostituzione
  const kd = daysOf([1, 3], 2), sd = daysOf([1], 3)[2];
  const t2 = { formato: 'fisioagenda-tabulato-1', fogli: [{ fisioterapista: 'Collega ' + RUN, mese: M, durata: null, durata_suggerita: 30, sedute_ciclo: 10,
    righe: [{ rif: 'K1', ora: '09:00', paziente: name('Arancio'), frequenza: '2v', giorni: [1, 3], tipo: 'GC', caselle: cells(kd, ['10', '9']) }],
    estemporanei: [{ paziente: name('Neri'), giorno: Number(sd.slice(8)), ora: '11:00', valore: '', nota: 'paziente di ' + TH }], note: [], assenze: [] }] };
  const f2 = path.join(tmp, 'collega.json'); fs.writeFileSync(f2, JSON.stringify(t2));
  await page.click('nav a[href="#/importa"]');
  await page.waitForSelector('input[data-imp-files]', { state: 'attached' });
  for (const x of await page.$$('button[data-act="imp-close"]')) { await page.click('button[data-act="imp-close"] >> nth=0'); }
  await page.setInputFiles('input[data-imp-files]', [f2]);
  await page.waitForSelector('.imp-row[data-ref="K1"]');
  assert.equal(await page.$eval(`select[data-bind$=".th"]`, el => el.value), colId);
  // durata di una sola seduta: 45 minuti per la prima, la seconda resta di 30
  await page.click('.imp-row[data-ref="K1"] button[data-act="imp-cells"]');
  await page.selectOption(`.imp-row[data-ref="K1"] select[data-bind$="rows.0.cellDur.${Number(kd[0].slice(8))}"]`, '45');
  // sostituzione: Importa, paziente scelto dall'elenco (ciclo con il titolare), sostituto = chi ha il tabulato
  assert.match(await page.textContent('.imp-row[data-ref="E1"]'), /Da decidere/);
  await page.click('.imp-row[data-ref="E1"] button[data-act="seg"][data-val="importa"]');
  const neriCyc = psql(`select c.id from cycles c join patients p on p.id=c.patient_id where p.name='${name('Neri')}' and c.status='attivo'`);
  await page.selectOption('.imp-row[data-ref="E1"] select[data-bind$=".pick"]', 'c:' + neriCyc);
  await page.waitForSelector('.imp-row[data-ref="E1"] .ok-txt:has-text("Pronta")');
  assert.match(await page.textContent('.imp-row[data-ref="E1"]'), new RegExp('sostituisce ' + TH));
  assert.match(await page.textContent('.imp-confirm'), /di cui 1 sostituzioni/);
  // correzione scritta e clic subito su «Importa» (senza uscire dal campo): la correzione vale e il clic non si perde
  await page.fill('.imp-row[data-ref="K1"] input.imp-tipo', 'RM');
  await page.click('button[data-act="imp-go"]');
  await page.waitForSelector('h3:has-text("salvata")', { timeout: 15000 });
  assert.equal(psql(`select string_agg((extract(epoch from end_time - start_time)/60)::int::text, ',' order by day) from appointments a join patients p on p.id=a.patient_id where p.name='${name('Arancio')}'`), '45,30', 'durata per singola seduta');
  assert.equal(psql(`select treatment from cycles c join patients p on p.id=c.patient_id where p.name='${name('Arancio')}'`), 'RM', 'correzione dell’ultimo momento salvata');
  const sub = JSON.parse(psql(`select row_to_json(a) from appointments a where a.cycle_id='${neriCyc}' and a.day='${sd}'`));
  assert.equal(sub.therapist_id, colId); assert.equal(sub.original_therapist_id, thId); assert.equal(sub.end_time, '12:00:00', 'durata del ciclo di Neri (1 ora)');
  ok('Tabulato del collega: correzione e clic immediato su «Importa», durata 45′ per una sola seduta, sostituzione «Importa» con il paziente scelto, salvata nel calendario del sostituto');
  // sezione Sostituzioni: data, orario, titolare, sostituto, paziente, durata, stato; distribuzione
  await page.click('nav a[href="#/sostituzioni"]');
  await page.fill('input[data-bind="sb.to"]', E.addDays(sd, 1)); await page.dispatchEvent('input[data-bind="sb.to"]', 'change');
  await page.selectOption('select[data-bind="sb.th"]', thId);
  const srow = page.locator('.sb-table tr', { hasText: name('Neri') });
  await srow.waitFor();
  const stxt = await srow.textContent();
  assert.match(stxt, /11:00–12:00/); assert.match(stxt, /60′/); assert.match(stxt, new RegExp(TH)); assert.match(stxt, /confermata/);
  assert.equal(await srow.locator('select').inputValue(), colId);
  assert.match(await page.textContent('main'), new RegExp('Chi prende i pazienti[\\s\\S]*' + TH + ' → Collega ' + RUN + ': 1'));
  // nei calendari: dal sostituto come sostituzione, dal titolare come promemoria
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [colId, sd]);
  await page.waitForSelector(`.wk-appt.sub[data-id="${sub.id}"]`);
  assert.match(await page.textContent(`.wk-appt[data-id="${sub.id}"]`), new RegExp('sostituisce ' + TH));
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, sd]);
  await page.waitForSelector(`.wk-given[data-id="${sub.id}"]`);
  ok('Sezione Sostituzioni: data, orario, titolare, sostituto, paziente, durata e stato; distribuzione dei pazienti; visibile nei due calendari');
  // annullare la sostituzione: la seduta torna al titolare; poi solo questa seduta portata a 45 minuti dal calendario
  await page.click('nav a[href="#/sostituzioni"]');
  await page.click(`.sb-table button[data-act="sb-cancel"][data-id="${sub.id}"]`);
  await page.waitForFunction(id => !document.querySelector('button[data-act="sb-cancel"][data-id="' + id + '"]'), sub.id, { timeout: 15000 });
  assert.equal(psql(`select (therapist_id='${thId}')::text||' '||coalesce(original_therapist_id::text,'-') from appointments where id='${sub.id}'`), 'true -');
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, sd]);
  await page.click(`.wk-appt[data-id="${sub.id}"]`);
  await page.click('.modal button:has-text("Modifica: giorno, ora, durata")');
  await page.click('.modal button[data-act="seg"][data-path="am.pick.dur"][data-val="45"]');
  await page.waitForSelector('.modal .form-note:has-text("Posto libero")');
  await page.click('.modal button:has-text("Salva la modifica")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select to_char(end_time,'HH24:MI') from appointments where id='${sub.id}'`), '11:45');
  assert.equal(psql(`select duration from cycles where id='${neriCyc}'`), '60', 'le altre sedute del ciclo non cambiano');
  ok('Sostituzione annullata (la seduta torna al titolare); dal calendario solo questa seduta portata a 45 minuti');
  // assenza del titolare: le sue sedute diventano «da assegnare»; si assegnano dal riepilogo
  await S.rpc(admin, 'save_absence', { p: { therapist_id: thId, kind: 'malattia', start_date: sd, end_date: sd } });
  await page.click('nav a[href="#/sostituzioni"]');
  await page.click('button[data-act="refresh"]').catch(() => {});
  await page.click('button[data-act="seg"][data-path="sb.show"][data-val="da_assegnare"]');
  const trow = page.locator('.sb-table tr', { hasText: name('Neri') });
  await trow.waitFor({ timeout: 15000 });
  assert.match(await trow.textContent(), /da assegnare/);
  await trow.locator('select').selectOption(colId);
  await trow.locator('button[data-act="sb-assign"]').click();
  await page.waitForFunction(() => document.querySelector('button[data-path="sb.show"][data-val="da_assegnare"]').textContent.includes('(0)'), null, { timeout: 15000 });
  assert.equal(psql(`select (therapist_id='${colId}')::text||' '||(original_therapist_id='${thId}')::text from appointments where id='${sub.id}'`), 'true true');
  ok('Assenza del titolare: la seduta compare «da assegnare» in Sostituzioni e si assegna a un collega con due clic');

  // tutto lo zip delle trascrizioni in un colpo: una scheda per tabulato (l'esempio fittizio è escluso)
  const zipFile = path.join(tmp, 'trascrizioni.zip');
  (await import('node:child_process')).execFileSync('zip', ['-qr', zipFile, '.'], { cwd: path.join(ROOT, 'esempi') });
  await page.click('nav a[href="#/importa"]');
  await page.waitForSelector('input[data-imp-files]', { state: 'attached' });
  for (const x of await page.$$('button[data-act="imp-close"]')) { await page.click('button[data-act="imp-close"] >> nth=0'); }
  await page.setInputFiles('input[data-imp-files]', [zipFile]);
  await page.waitForSelector('text=Caricati 17 tabulati', { timeout: 15000 });
  assert.equal((await page.$$('.imp-tabs button[data-act="imp-tab"]')).length, 17);
  assert.match(await page.textContent('.imp-tabs'), /Barile 2026-10/);
  assert.ok(!(await page.textContent('.imp-tabs')).includes('Fittizio'), 'esempio fittizio escluso');
  ok('Zip con tutte le trascrizioni caricato in un colpo: 17 tabulati, uno per scheda');
  // foglio reale (Barile): fisioterapista creato dall'importazione, correzioni veloci, importate le righe pronte
  assert.match(await page.textContent('.imp-tab .btn.primary'), /Barile/);
  if (await page.$('button[data-act="imp-newth"]')) { await page.click('button[data-act="imp-newth"]'); await page.waitForSelector('button[data-act="imp-newth"]', { state: 'detached', timeout: 15000 }); }
  await page.click('.panel button[data-act="seg"][data-val="30"]');
  for (const k of ['dubbi', 'nomi']) { const bt = await page.$(`button[data-act="imp-bulk"][data-k="${k}"]`); if (bt) { await bt.click(); await page.waitForTimeout(300); } }
  if (await page.$eval('button[data-act="imp-go"]', bt => bt.disabled)) {
    // database di prova già usato: il foglio di Barile è già tutto in calendario
    assert.match(await page.textContent('.imp-row[data-ref="B1"]'), /già nel calendario/);
  } else {
    assert.match(await page.textContent('button[data-act="imp-go"]'), /Importa nel calendario/);
    await page.click('button[data-act="imp-go"]');
    await page.waitForSelector('h3:has-text("salvata")', { timeout: 20000 });
  }
  const barile = psql("select id from therapists where name='Barile' limit 1");
  assert.ok(count(`select count(*) from appointments where therapist_id='${barile}'`) > 0);
  assert.ok(count(`select count(*) from shift_versions where therapist_id='${barile}'`) > 0, 'orario standard assegnato');
  ok('Foglio reale di Barile: fisioterapista creato con l’orario standard, letture accettate in blocco, righe pronte importate');
  assert.deepEqual(errors, [], 'nessun errore nella pagina');
} finally {
  await browser.close(); server.kill();
}
console.log('Tutte le prove dell’importazione superate.');
