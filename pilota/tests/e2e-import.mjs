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

// tabulato del mese prossimo, costruito sulle date reali di quel mese
let first = E.addDays(T0, 1); while (first.slice(8) !== '01') first = E.addDays(first, 1);
const M = first.slice(0, 7);
const closures = new Set(psql("select coalesce(string_agg(day::text, ','), '') from closures").split(',').filter(Boolean));
const daysOf = (wds, n) => { const out = []; let d = first; while (out.length < n && d.slice(0, 7) === M) { if (wds.includes(E.weekday(d)) && !closures.has(d)) out.push(d); d = E.addDays(d, 1); } return out; };
const cells = (dates, vals) => Object.fromEntries(dates.map((d, i) => [String(Number(d.slice(8))), vals[i]]));
const bi = daysOf([1, 3, 5], 4), ne = daysOf([2, 4], 6), gi = daysOf([2, 4], 4), vi = daysOf([5], 3);
const name = n => n + ' ' + RUN;
const transcript = { formato: 'fisioagenda-tabulato-1', fogli: [{ fisioterapista: TH, mese: M, foto: 'tabulato-fittizio.png', durata: null, durata_suggerita: 30, sedute_ciclo: 10,
  griglia: { x_giorno1: 27.16, x_giorno31: 96.84, h_riga: 4.6 },
  righe: [
    { rif: 'F1', ora: '07:15', paziente: name('Bianchi'), frequenza: '3v', giorni: [1, 3, 5], tipo: 'GC', y: 17.69, caselle: cells(bi, ['3', '2', '1V', 'R']) },
    { rif: 'F2', ora: '07:15', paziente: name('Neri'), frequenza: '2v', giorni: [2, 4], tipo: 'RM', y: 22.31, caselle: cells(ne, ['6', '5', '4', '3', '2', '1']) },
    { rif: 'F3', ora: '08:15', paziente: name('Gialli'), frequenza: '2v', giorni: [2, 4], tipo: 'GC', y: 26.92, caselle: cells(gi, ['4', '3', '2', '1']), dubbi: { [String(Number(gi[1].slice(8)))]: '3 poco leggibile' } },
    { rif: 'F4', ora: '06:30', paziente: name('Viola'), frequenza: 'Ven', giorni: [5], tipo: 'GC', y: 31.54, caselle: cells(vi, ['10', '9', '8']), dubbi_riga: ['orario 6:30?'] }
  ], estemporanei: [], note: [{ giorni: [20], testo: 'Corso' }] }] };
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
  assert.match(await page.textContent('.imp-confirm'), /Scegli la durata/);
  assert.ok(await page.$eval('button[data-act="imp-go"]', b => b.disabled), 'senza durata non si importa');
  ok('Foto e trascrizione caricate: fisioterapista riconosciuto, foto accanto, letture incerte evidenziate, durata da confermare');

  // clic su una casella: evidenziata sulla foto
  await page.click('.imp-row[data-ref="F1"] input[data-imp-cell] >> nth=' + (Number(bi[0].slice(8)) - 1));
  assert.equal(await page.$eval('.imp-mark', el => el.style.display), 'block');
  await page.click('.imp-split ~ * button[data-val="30"], .panel button[data-act="seg"][data-val="30"]');
  await page.waitForSelector('.imp-row[data-ref="F4"] .imp-conf');
  assert.match(await page.textContent('.imp-row[data-ref="F4"]'), /fuori dalle fasce/);
  // correzioni: lettura confermata, orario controllato, "importa comunque" per il fuori turno
  await page.click('.imp-row[data-ref="F3"] .imp-okc');
  await page.click('.imp-row[data-ref="F4"] input[data-act-change="imp-rd"]');
  const nForce = (await page.$$('.imp-row[data-ref="F4"] input[data-act-change="imp-force"]')).length;
  assert.equal(nForce, 3);
  for (let k = 0; k < nForce; k++) { await page.click(`.imp-row[data-ref="F4"] input[data-act-change="imp-force"] >> nth=${k}`); await page.waitForTimeout(100); }
  await page.waitForFunction(() => !document.querySelector('button[data-act="imp-go"]').disabled, null, { timeout: 5000 });
  assert.match(await page.textContent('.imp-confirm'), /4 pazienti \(4 nuovi\), 17 sedute, 1 visite fisiatriche, di cui 3 fuori turno/);
  ok('Correzioni nell’anteprima: casella confermata, orario controllato, fuori turno importati consapevolmente');

  await page.click('button[data-act="imp-go"]');
  await page.waitForSelector('h3:has-text("completata")', { timeout: 15000 });
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats}`), 17);
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats} and status <> 'programmata'`), 0, 'nessuna seduta segnata come svolta');
  assert.equal(psql(`select c.prior_sessions from cycles c join patients p on p.id=c.patient_id where p.name='${name('Bianchi')}'`), '7');
  assert.equal(count(`select count(*) from patient_events where patient_id in ${pats}`), 1);
  assert.equal(psql(`select sheet_mark from appointments a join patients p on p.id=a.patient_id where p.name='${name('Bianchi')}' and a.day='${bi[3]}'`), 'R');
  ok('Importazione confermata: 4 pazienti, 17 sedute programmate (numeri a ritroso → 8ª, 9ª, 10ª), R come recupero, V come visita');

  // stessa foto e stessa trascrizione di nuovo: nessun doppione
  await load();
  await page.waitForSelector('text=Questa foto è già stata importata');
  assert.match(await page.textContent('.imp-row[data-ref="F1"]'), /già presenti/);
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
  await page.waitForFunction(() => !document.querySelector('button[data-act="imp-go"]').disabled, null, { timeout: 5000 });
  await page.click('button[data-act="imp-go"]');
  await page.waitForSelector('h3:has-text("completata")', { timeout: 15000 });
  assert.equal(count(`select count(*) from appointments where patient_id in ${pats}`), 14);

  // trascinamento: Bianchi dalle 7:15 alle 9:00 dello stesso giorno
  await page.evaluate(([t, d]) => { location.hash = '#/calendario/' + t + '/' + d + '/settimana'; }, [thId, bi[0]]);
  const b0 = psql(`select a.id from appointments a join patients p on p.id=a.patient_id where p.name='${name('Bianchi')}' and a.day='${bi[0]}'`);
  const el = await page.waitForSelector(`.wk-appt[data-id="${b0}"]`);
  assert.match(await el.textContent(), /8\/10/);
  const box = await el.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 5); await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 4 }); await page.mouse.move(box.x + 20, box.y + 5 + 105 * 1.25, { steps: 6 });
  assert.match(await page.textContent('.wk-ghost'), /09:00/);
  await page.mouse.up();
  await page.waitForFunction(id => { const e = document.querySelector('.wk-appt[data-id="' + id + '"]'); return e && e.textContent.includes('09:00'); }, b0, { timeout: 15000 });
  assert.equal(psql(`select to_char(start_time,'HH24:MI') from appointments where id='${b0}'`), '09:00');
  ok('Seduta trascinata sul calendario: spostata alle 9:00, con controllo del posto');

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
  await page.click(`.wk-free.act[data-day="${ne[1]}"] >> nth=0`);
  await page.waitForSelector('.drawer');
  await page.click('.drawer button[data-act="seg"][data-val="esistente"]');
  await page.fill('.drawer input[data-bind="pd.q"]', 'Neri ' + RUN); await page.dispatchEvent('.drawer input[data-bind="pd.q"]', 'change');
  await page.click('.drawer button[data-act="pd-pick"]:has-text("Neri")');
  await page.waitForSelector('.drawer .form-note:has-text("Si aggiungono le 1 che mancano")');
  await page.waitForSelector('.drawer .form-note:has-text("Tutte disponibili")', { timeout: 10000 });
  await page.click('.drawer button:has-text("Conferma")');
  await page.waitForSelector('.drawer', { state: 'detached', timeout: 15000 });
  assert.equal(count(`select count(*) from appointments a join patients p on p.id=a.patient_id where p.name='${name('Neri')}'`), 6);
  ok('Dallo spazio libero: paziente già in trattamento scelto dall’archivio, aggiunta la seduta mancante');
  assert.deepEqual(errors, [], 'nessun errore nella pagina');
} finally {
  await browser.close(); server.kill();
}
console.log('Tutte le prove dell’importazione superate.');
