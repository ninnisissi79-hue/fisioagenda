// Prova completa dell'interfaccia nel browser (Chromium), collegata al server condiviso LOCALE.
// Prerequisiti: `npm run db:start` (oppure `npx supabase db reset` per ripartire dai dati demo).
// Due colleghi lavorano in contemporanea in due browser separati.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, ensureUser, PASSWORD, psql, E } from './helpers.mjs';

const PORT = 8091;
const URL0 = process.env.E2E_URL || `http://localhost:${PORT}/`;
const RUN = Date.now().toString(36).slice(-4);
let step = 0;
const ok = msg => console.log(`✓ ${++step}. ${msg}`);

const server = process.env.E2E_URL ? null : spawn(process.execPath, [path.join(ROOT, 'tools/serve.js'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
await ensureUser('coord@pilota.test', 'admin', 'Coordinatrice Prova');
await ensureUser('op1@pilota.test', 'operatore', 'Operatore Uno');
await ensureUser('op2@pilota.test', 'operatore', 'Operatore Due');
await ensureUser('lettore@pilota.test', 'lettura', 'Consultazione');

const browser = await chromium.launch();
const errors = [];
async function session(email, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(email + ' pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(URL0);
  await page.fill('#em', email);
  await page.fill('#pw', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.big-action', { timeout: 20000 });
  await page.waitForFunction(() => /aggiornato alle \d/.test(document.querySelector('#conn').textContent), null, { timeout: 20000 });
  return { ctx, page };
}
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(300); };
const text = async (page, sel) => (await page.textContent(sel)) || '';

try {
  // ---------------------------------------------------------------- accesso e schermata iniziale
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(URL0);
  await anon.fill('#em', 'op1@pilota.test'); await anon.fill('#pw', 'password-sbagliata'); await anon.click('button[type=submit]');
  await anon.waitForSelector('.form-error');
  assert.match(await text(anon, '.form-error'), /non corrette/);
  assert.equal(await anon.$('text=Registrati'), null);
  ok('Accesso rifiutato con password errata; nessuna registrazione libera');

  const { page: p1 } = await session('op1@pilota.test');
  const { page: p2 } = await session('op2@pilota.test');
  const home = await text(p1, 'main');
  assert.match(home, /Gestisci assenza fisioterapista/);
  assert.match(home, /Trova posto per un paziente/);
  assert.match(home, /Assent[ei] oggi/);
  assert.match(home, /Appuntamenti da sistemare/);
  assert.match(home, /Posti certi liberi oggi/);
  assert.ok(!(await p1.$('main input')), 'schermata iniziale senza campi da compilare');
  ok('Schermata iniziale: due azioni principali e riepilogo (assenti, da sistemare, posti liberi)');

  // ---------------------------------------------------------------- assenza oggi, distribuzione su più sostituti
  const today = psql('select app.today()');
  // il collega (non di prova) con più pazienti oggi
  const conti = psql(`select a.therapist_id from appointments a join therapists t on t.id=a.therapist_id where a.day='${today}' and a.status='programmata' and t.name not like 'Test %' group by 1 order by count(*) desc, 1 limit 1`);
  const contiName = psql(`select name from therapists where id='${conti}'`);
  const nToday = Number(psql(`select count(*) from appointments where therapist_id='${conti}' and day='${today}' and status='programmata'`));
  assert.ok(nToday >= 2, contiName + ' ha pazienti oggi nei dati demo');
  await p1.click('text=Gestisci assenza fisioterapista');
  await p1.selectOption('#abs-th', { label: contiName });
  await p1.click('button:has-text("Registra l’assenza e cerca i sostituti")');
  await p1.waitForSelector('.subst', { timeout: 20000 });
  const rows = await p1.$$('.subst');
  assert.equal(rows.length, nToday);
  const chosen = await p1.$$eval('.subst select', ss => ss.map(s => s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : ''));
  assert.ok(chosen.every(t => t && !t.startsWith('—')), 'una proposta per ogni paziente');
  const subs = new Set(chosen.filter(t => !/riprogrammare/.test(t)).map(t => t.replace(/^⚠ /, '').split(' (')[0].split(' alle ')[0]));
  assert.ok(subs.size >= 2, 'pazienti distribuiti tra più sostituti: ' + [...subs].join(', '));
  ok(`Assenza di oggi registrata: ${nToday} pazienti proposti a ${subs.size} sostituti diversi`);

  // due scelte sullo stesso posto: segnalate come alternative, conferma bloccata.
  // (Nei dati demo gli orari dello stesso collega non coincidono: imponiamo alla seconda riga la stessa scelta della prima.)
  const absId = decodeURIComponent((await p1.evaluate(() => location.hash)).split('/')[3]);
  const rowIds = await p1.$$eval('.subst', els => els.map(e => e.getAttribute('data-row')));
  await p1.evaluate(([absId, r0, r1]) => {
    const P = window.FA.state.ui.plans[absId];
    P.saved = JSON.stringify(P.sel[r1]);
    const s0 = P.sel[r0];
    const a1 = window.FA.state.ctx.appt.get(r1);
    P.sel[r1] = Object.assign({}, s0, { day: a1.day });
    window.FA.render();
  }, [absId, rowIds[0], rowIds[1]]);
  assert.match(await text(p1, `.subst[data-row="${rowIds[1]}"]`), /Alternativa|alternative|già occupato/i);
  assert.ok(await p1.isDisabled('button:has-text("Rivedi e conferma")'));
  ok('Due proposte sullo stesso posto segnalate come alternative: la conferma è bloccata');
  await p1.evaluate(([absId, r1]) => { const P = window.FA.state.ui.plans[absId]; P.sel[r1] = JSON.parse(P.saved); window.FA.render(); }, [absId, rowIds[1]]);
  assert.ok(!(await p1.isDisabled('button:has-text("Rivedi e conferma")')));
  // la seconda collega vede l'agenda del sostituto prima della conferma
  const firstSub = chosen.find(t => !/riprogrammare/.test(t)).replace(/^⚠ /, '').split(' (')[0].split(' alle ')[0];
  await go(p2, '#/agenda');
  await p2.selectOption('select[data-bind="ag.th"]', { label: firstSub });
  await p2.waitForTimeout(300);
  const before = await text(p2, '.agenda-grid');
  assert.ok(!before.includes('sostituisce ' + contiName));
  // riepilogo e conferma
  await p1.click('button:has-text("Rivedi e conferma")');
  await p1.waitForSelector('.modal');
  assert.match(await text(p1, '.modal'), /Riepilogo prima della conferma/);
  await p1.click('.modal button:has-text("Conferma e salva")');
  await p1.waitForSelector('text=Esito del salvataggio', { timeout: 20000 });
  assert.match(await text(p1, 'main'), /✓ \d+ salvat/);
  assert.equal(Number(psql(`select count(*) from appointments where original_therapist_id='${conti}' and day='${today}' and substitute_kind='singola'`)) +
    Number(psql(`select count(*) from appointments where therapist_id='${conti}' and day='${today}' and status='da_riprogrammare'`)), nToday);
  assert.equal(psql(`select count(*) from appointments where therapist_id='${conti}' and day > '${today}' and status='programmata'`) !== '0', true, 'il resto dei cicli resta al titolare');
  ok('Riepilogo, conferma e salvataggio: sostituzioni per singola seduta, cicli invariati');
  // aggiornamento visibile all'altra collega senza ricaricare
  await p2.waitForFunction(n => document.querySelector('.agenda-grid').textContent.includes('sostituisce ' + n), contiName, { timeout: 15000 });
  ok('La seconda collega vede la sostituzione in agenda senza ricaricare (tempo reale)');

  // ---------------------------------------------------------------- trova posto + prenotazione simultanea
  async function search(page, name) {
    await go(page, '#/trova');
    await page.fill('#f-name', name);
    await page.selectOption('#f-cat', 'mano');
    await page.click('button:has-text("Cerca disponibilità")');
    await page.waitForSelector('text=Con competenza specifica');
  }
  await search(p1, 'E2E Uno ' + RUN);
  await search(p2, 'E2E Due ' + RUN);
  const firstRow = async page => (await page.$$eval('tbody tr', trs => trs.filter(t => t.querySelector('[data-act="find-book"]')).map(t => t.textContent)))[0];
  assert.equal(await firstRow(p1), await firstRow(p2), 'stessa proposta per i due colleghi');
  assert.match(await text(p1, 'main'), /★ Con competenza specifica[\s\S]*Altri abilitati/);
  await p1.click('[data-act="find-book"] >> nth=0');
  await p2.click('[data-act="find-book"] >> nth=0');
  await p1.waitForSelector('.modal'); await p2.waitForSelector('.modal');
  await Promise.all([p1.click('.modal button:has-text("Conferma e salva")'), p2.click('.modal button:has-text("Conferma e salva")')]);
  await p1.waitForTimeout(4000);
  const booked = Number(psql(`select count(distinct c.id) from cycles c join patients p on p.id=c.patient_id where p.name like 'E2E % ${RUN}' and c.status='attivo'`));
  assert.equal(booked, 1, 'una sola delle due prenotazioni simultanee è confermata');
  const loser = (await p1.$('.modal .form-error')) ? p1 : p2;
  const winner = loser === p1 ? p2 : p1;
  assert.match(await text(loser, '.modal .form-error'), /appena prenotato da un altro utente|già occupato/);
  assert.match(await text(loser, '.modal .form-error'), /lista d’attesa/);
  ok('Due colleghi prenotano lo stesso posto insieme: una conferma, l’altra riceve un messaggio chiaro e la richiesta resta in lista d’attesa');
  await loser.click('.modal button:has-text("Annulla")');
  await winner.waitForSelector('h2:has-text("E2E")', { timeout: 15000 });
  const sheet = await text(winner, 'main');
  assert.match(sheet, /Programmate: 10/);
  assert.match(sheet, /Effettuate: 0/);
  ok('Prenotazione salvata e visibile nella scheda paziente (10 sedute programmate)');

  // ---------------------------------------------------------------- assenza del paziente con recupero
  const wp = winner;
  const patId = decodeURIComponent((await wp.evaluate(() => location.hash)).split('/')[2]);
  const firstAppt = psql(`select a.id from appointments a where a.patient_id='${patId}' order by day limit 1`);
  await wp.click(`tr[data-id="${firstAppt}"]`);
  await wp.waitForSelector('.modal');
  await wp.click('.modal button:has-text("Registra esito")');
  await wp.click('.modal button[data-val="assente"]');
  await wp.check('.modal input[data-bind="am.out.to_recover"]');
  await wp.click('.modal button:has-text("Salva esito")');
  await wp.waitForSelector('.modal h4:has-text("recupero")', { timeout: 15000 });
  let d = psql(`select day from appointments where id='${firstAppt}'`), times = [];
  for (let tries = 0; tries < 15 && !times.length; tries++) {
    d = E.addDays(d, 1);
    while (E.weekday(d) >= 6 || psql(`select count(*) from closures where day='${d}'`) !== '0') d = E.addDays(d, 1);
    await wp.fill('.modal input[data-bind="am.pick.day"]', d);
    await wp.dispatchEvent('.modal input[data-bind="am.pick.day"]', 'change');
    await wp.waitForTimeout(250);
    times = await wp.$$eval('.modal select[data-bind="am.pick.start"] option', os => os.map(o => o.value).filter(Boolean));
  }
  assert.ok(times.length > 0, 'orari liberi proposti per il recupero');
  await wp.selectOption('.modal select[data-bind="am.pick.start"]', times[0]);
  await wp.waitForTimeout(200);
  await wp.click('.modal button:has-text("Prenota il recupero")');
  await wp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await wp.waitForTimeout(800);
  const s2 = await text(wp, 'main');
  assert.match(s2, /Effettuate: 0/);
  assert.match(s2, /Assenze: 1/);
  assert.match(s2, /Recuperi: 1/);
  ok('Assenza del paziente con recupero: non conteggiata come svolta, recupero programmato');

  // ---------------------------------------------------------------- sospensione per ticket e ripresa
  await wp.click('button:has-text("Sospendi")');
  await wp.waitForSelector('.modal');
  await wp.click('.modal button[data-val="ticket"]');
  assert.ok(await wp.$('.modal button:has-text("Conferma la sospensione")'));
  await wp.click('.modal button:has-text("Conferma la sospensione")');
  assert.match(await text(wp, '.modal .form-error'), /mantenere o liberare/);
  await wp.click('.modal button[data-val="no"]');
  assert.match(await text(wp, '.modal'), /Effetto:.*liberati/);
  await wp.click('.modal button:has-text("Conferma la sospensione")');
  await wp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await wp.waitForTimeout(500);
  assert.match(await text(wp, 'main'), /Sospeso dal .*Ticket non regolarizzato.*posti liberati/);
  await wp.click('button:has-text("Riprendi")');
  await wp.click('.modal button:has-text("Verifica le disponibilità")');
  await wp.waitForSelector('.modal .form-note:has-text("Effetto")', { timeout: 15000 });
  await wp.click('.modal button:has-text("Conferma la ripresa")');
  await wp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await wp.waitForTimeout(500);
  assert.match(await text(wp, 'main'), /Attivo/);
  ok('Sospensione per ticket con scelta esplicita sui posti, poi ripresa con verifica delle disponibilità');

  // ---------------------------------------------------------------- modifica di una sola seduta
  const target = psql(`select id from appointments where patient_id='${patId}' and status='programmata' and recovery_of is null order by day offset 2 limit 1`);
  const others = () => psql(`select string_agg(id::text||day||start_time||therapist_id::text, ',' order by day) from appointments where patient_id='${patId}' and id<>'${target}'`);
  const othersBefore = others();
  await wp.click(`tr[data-id="${target}"]`);
  await wp.click('.modal button:has-text("Sposta solo questa seduta")');
  await wp.waitForTimeout(300);
  const tOpts = await wp.$$eval('.modal select[data-bind="am.pick.start"] option', os => os.map(o => o.value).filter(Boolean));
  const cur = psql(`select to_char(start_time,'HH24:MI') from appointments where id='${target}'`);
  const newT = tOpts.find(t => t !== cur);
  await wp.selectOption('.modal select[data-bind="am.pick.start"]', newT);
  await wp.waitForTimeout(200);
  await wp.click('.modal button:has-text("Sposta la seduta")');
  await wp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select to_char(start_time,'HH24:MI') from appointments where id='${target}'`), newT);
  assert.equal(others(), othersBefore);
  ok('Spostata una sola seduta: il resto del ciclo non è cambiato');

  // ---------------------------------------------------------------- chiusura anticipata
  await wp.click('button:has-text("Chiudi anticipatamente")');
  await wp.click('.modal button[data-val="Obiettivi raggiunti"]');
  assert.match(await text(wp, '.modal'), /Sedute effettuate: 0 su 10/);
  await wp.click('.modal button:has-text("Conferma la chiusura")');
  await wp.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await wp.waitForTimeout(500);
  assert.match(await text(wp, 'main'), /Chiuso/);
  assert.equal(psql(`select count(*) from appointments where patient_id='${patId}' and status in ('programmata','trattenuta')`), '0');
  assert.ok(Number(psql(`select count(*) from appointments where patient_id='${patId}' and status='liberata'`)) >= 8);
  ok('Chiusura anticipata: posti futuri liberati, storico e numero reale di sedute conservati');

  // ---------------------------------------------------------------- storico
  await go(wp, '#/storico');
  await wp.waitForSelector('td:has-text("Chiuso") , td:has-text("chiuso")', { timeout: 15000 });
  assert.match(await text(wp, 'main'), /Operatore (Uno|Due)/);
  ok('Storico: chi ha fatto cosa e quando');

  // ---------------------------------------------------------------- sola consultazione e permessi
  const { page: pr } = await session('lettore@pilota.test');
  assert.match(await text(pr, '.pilot-banner'), /sola consultazione/);
  await go(pr, '#/assenze');
  assert.ok(await pr.isDisabled('button:has-text("Registra l’assenza")'));
  const r = await pr.evaluate(async () => (await window.FA.state.sb.rpc('save_absence', { p: { therapist_id: '00000000-0000-0000-0000-000000000000', start_date: '2030-01-01', end_date: '2030-01-01' } })).error);
  assert.match(r.message, /sola consultazione/);
  await go(p1, '#/config');
  assert.match(await text(p1, 'main'), /solo il coordinatore/);
  const r2 = await p1.evaluate(async () => (await window.FA.state.sb.rpc('admin_save_category', { p_id: 'x', p_name: 'x', p_active: true, p_sort: 1 })).error);
  assert.match(r2.message, /riservata al coordinatore/);
  ok('Sola consultazione e operatore: pulsanti disattivati e modifiche riservate rifiutate dal server');

  // ---------------------------------------------------------------- cambio turno con conflitti (coordinatore)
  const { page: pc } = await session('coord@pilota.test');
  await go(pc, '#/config');
  await pc.click('.tabs button:has-text("Turni")');
  await pc.selectOption('select[data-bind="shTh"]', { label: 'Federico Serra' });
  await pc.waitForTimeout(300);
  await pc.click('button:has-text("Nuovo turno con decorrenza")');
  const from = E.addDays(today, 7);
  await pc.fill('.modal input[data-bind="sh.valid_from"]', from);
  // lunedì: il primo blocco ambulatorio diventa reparto
  await pc.selectOption('.modal select[data-bind="sh.week.1.1.kind"]', 'reparto');
  await pc.click('.modal button:has-text("Verifica appuntamenti coinvolti")');
  await pc.waitForSelector('.modal .form-warn:has-text("incompatibili"), .modal .form-note:has-text("Nessun appuntamento")', { timeout: 15000 });
  const confText = await text(pc, '.modal');
  await pc.click('.modal button:has-text("Salva il nuovo turno")');
  await pc.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select count(*) from shift_versions s join therapists t on t.id=s.therapist_id where t.name='Federico Serra'`), '2');
  if (/incompatibili/.test(confText)) {
    await go(pc, '#/dasistemare');
    assert.match(await text(pc, 'main'), /Federico Serra/);
    ok('Cambio turno con decorrenza: conflitti mostrati prima del salvataggio e poi segnalati da sistemare; storico conservato');
  } else ok('Cambio turno con decorrenza salvato con storico (nessun conflitto nei dati demo)');

  // ---------------------------------------------------------------- nuovo collega con turno copiato, prenotazione in un posto scelto
  await go(pc, '#/config');
  await pc.click('.tabs button:has-text("Fisioterapisti")');
  await pc.click('button:has-text("+ Nuovo fisioterapista")');
  await pc.fill('.modal input[data-bind="te.name"]', 'Collega Nuovo ' + RUN);
  await pc.selectOption('.modal select[data-bind="te.skills.mano"]', 'specifica');
  await pc.click('.modal button:has-text("Salva")');
  await pc.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await pc.waitForSelector('button:has-text("Nuovo turno con decorrenza")');
  await pc.click('button:has-text("Nuovo turno con decorrenza")');
  await pc.selectOption('.modal select[data-bind="sh.from_th"]', { label: 'Alessia Villa' });
  await pc.fill('.modal input[data-bind="sh.valid_from"]', today);
  await pc.click('.modal button:has-text("Verifica appuntamenti coinvolti")');
  await pc.waitForSelector('.modal .form-note:has-text("Nessun appuntamento")', { timeout: 15000 });
  await pc.click('.modal button:has-text("Salva il nuovo turno")');
  await pc.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  assert.equal(psql(`select count(*) from shift_versions s join therapists t on t.id=s.therapist_id where t.name='Collega Nuovo ${RUN}'`), '1');
  ok('Nuovo collega inserito dall’app con competenze e turno copiato da un altro collega');
  const newTh = psql(`select id from therapists where name='Collega Nuovo ${RUN}'`);
  let bookDay = E.addDays(today, 1); while (E.weekday(bookDay) >= 6 || psql(`select count(*) from closures where day='${bookDay}'`) !== '0') bookDay = E.addDays(bookDay, 1);
  await go(pc, '#/agenda/' + bookDay);
  await pc.selectOption('select[data-bind="ag.th"]', newTh);
  await pc.waitForTimeout(300);
  await pc.click('[data-act="ag-book"] >> nth=0');
  await pc.waitForSelector('.modal');
  await pc.fill('.modal input[data-bind="qb.name"]', 'Scelto ' + RUN);
  await pc.dispatchEvent('.modal input[data-bind="qb.name"]', 'change');
  await pc.click('.modal button[data-act="seg"][data-val="5"]');
  await pc.waitForSelector('.modal .form-note:has-text("Tutte le 5 sedute")', { timeout: 10000 });
  await pc.click('.modal button:has-text("Conferma e salva")');
  await pc.waitForSelector('h2:has-text("Scelto")', { timeout: 15000 });
  assert.match(await text(pc, 'main'), /Programmate: 5/);
  assert.equal(psql(`select count(*) from appointments a join patients p on p.id=a.patient_id where p.name='Scelto ${RUN}' and a.therapist_id='${newTh}' and a.status='programmata'`), '5');
  ok('Paziente fittizio prenotato direttamente in un posto libero scelto dall’agenda');

  // ---------------------------------------------------------------- connessione assente
  await p1.context().setOffline(true);
  await p1.evaluate(() => window.dispatchEvent(new Event('offline')));
  await go(p1, '#/assenze');
  assert.match(await text(p1, '.net-banner'), /Connessione assente/);
  assert.ok(await p1.isDisabled('button:has-text("Registra l’assenza")'));
  await p1.context().setOffline(false);
  await p1.evaluate(() => window.dispatchEvent(new Event('online')));
  await p1.waitForTimeout(500);
  ok('Senza connessione: avviso chiaro e salvataggi disattivati');

  // ---------------------------------------------------------------- tablet
  const { page: pt } = await session('op2@pilota.test', { width: 1024, height: 768 });
  for (const v of ['oggi', 'assenze', 'trova', 'agenda', 'pazienti', 'attesa']) {
    await go(pt, '#/' + v);
    const over = await pt.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, 'nessuno scorrimento orizzontale su tablet in ' + v);
  }
  ok('Layout tablet 1024×768 senza scorrimento orizzontale');

  assert.deepEqual(errors, [], 'nessun errore JavaScript');
  ok('Nessun errore JavaScript nelle pagine');
  console.log('\nTutte le prove nel browser sono riuscite.');
} catch (e) {
  console.error('\n✗ PROVA NON RIUSCITA:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  if (server) server.kill();
}
