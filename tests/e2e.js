/*
 * Prova completa dell'interfaccia nel browser (Chromium via Playwright).
 * Uso: npm run test:e2e   (richiede Playwright installato)
 * Scenario: nuovo paziente → ricerca → conferma → agenda → ricarica pagina → dati ancora presenti.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const URL = process.env.E2E_URL || ('file://' + path.resolve(__dirname, '..', process.env.E2E_FILE || 'index.html'));
const SHOTS = process.env.SHOTS_DIR || null;
let failures = 0;
function ok(cond, msg) { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; }

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };

  console.log('1. Apertura e dati demo');
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.search-form');
  ok(await page.locator('.demo-pill').isVisible(), 'etichetta DEMO visibile');
  const banner = await page.locator('.public-banner').innerText();
  ok(/Demo con dati fittizi: non inserire dati reali/.test(banner), 'avviso "Demo con dati fittizi: non inserire dati reali" visibile');
  ok(/propria copia/.test(banner), 'indicazione che ogni visitatore modifica solo la propria copia');
  ok(await page.locator('.public-banner button:has-text("Ripristina esempi")').isVisible(), 'pulsante "Ripristina esempi" nell\'avviso');
  ok(await page.locator('input[type=password]').count() === 0, 'nessuna password nella pagina');
  const meta = await page.evaluate(() => ({ robots: document.querySelector('meta[name=robots]')?.content, og: document.querySelector('meta[property="og:title"]')?.content, desc: document.querySelector('meta[property="og:description"]')?.content, title: document.title }));
  ok(/noindex/.test(meta.robots || ''), 'direttiva noindex presente');
  ok(meta.og && meta.desc && meta.title, 'titolo e descrizione per la condivisione presenti');
  const nTh = await page.evaluate(() => window.FisioApp.state.therapists.length);
  ok(nTh === 18, '18 fisioterapisti nei dati demo');

  console.log('2. Inserimento nuovo paziente e ricerca');
  await page.fill('#sf-name', 'Prova E2E');
  await page.selectOption('#sf-cat', 'protesi');
  await page.click('text=Mar-Gio');
  await page.click('label:has(input[name=ses][value="5"])');
  await page.click('button[type=submit]');
  await page.waitForSelector('#results');
  await shot('e2e-1-risultati');
  const rows = await page.locator('#results tr.group-row').count();
  ok(rows > 0, 'risultati presenti (' + rows + ' colleghi nella scheda attiva)');
  const firstKind = await page.locator('#results tr.group-row').first().innerText();
  ok(/Competenza specifica/.test(firstKind), 'in testa un collega con competenza specifica');

  console.log('3. Posti probabili non prenotabili');
  await page.click('.scard.prob');
  const probRows = await page.locator('#results tr.group-row').count();
  if (probRows) {
    ok(await page.locator('#results tr.group-row button:has-text("Conferma")').first().isDisabled(), 'pulsante Conferma disabilitato sui posti probabili');
    ok(await page.locator('#results tr.group-row button:has-text("Preaccordo")').count() > 0, 'disponibile solo il preaccordo');
  } else ok(true, 'nessun posto probabile in questa ricerca');
  await page.click('.scard.ok');

  console.log('4. Calendario del ciclo e conferma');
  await page.locator('#results tr.group-row button:has-text("Calendario")').first().click();
  await page.waitForSelector('.modal .date-list');
  const nDates = await page.locator('.modal .date-item:not(.skip)').count();
  ok(nDates === 5, 'il calendario mostra le 5 date del ciclo');
  await page.click('.modal [data-act=close-modal] >> nth=0');
  const btn = page.locator('#results tr.group-row button:has-text("✓ Conferma")').first();
  const thName = (await page.locator('#results tr.group-row .who').first().innerText()).trim();
  await btn.click();
  await page.waitForSelector('.modal #bk-name');
  ok((await page.inputValue('#bk-name')) === 'Prova E2E', 'nome del paziente precompilato');
  await shot('e2e-2-conferma');
  await page.click('[data-act=book-confirm]');
  await page.waitForSelector('.cal');
  await page.waitForTimeout(200);
  ok(/#\/agenda/.test(page.url()), 'dopo la conferma si apre l\'agenda');
  const hl = await page.locator('.appt.hl').count();
  ok(hl >= 1, 'il nuovo appuntamento è evidenziato in agenda (' + hl + ' nella settimana)');
  ok(/Prova E2E/.test(await page.locator('.appt.hl').first().innerText()), 'il nome del paziente compare in agenda');
  ok((await page.locator('.agenda-tools select[data-act=ag-th]').inputValue()) !== '', 'agenda settimanale del collega ' + thName);
  await shot('e2e-3-agenda');

  console.log('5. Persistenza dopo il ricaricamento');
  await page.reload();
  await page.goto(URL + '#/pazienti');
  await page.fill('[data-act=path-filter]', 'Prova E2E');
  await page.waitForTimeout(400);
  ok(await page.locator('td.who:has-text("Prova E2E")').count() === 1, 'il paziente è ancora presente dopo il ricaricamento');
  await page.locator('a:has-text("Apri")').first().click();
  await page.waitForSelector('text=Ciclo 1');
  ok(await page.locator('select[data-act=session-status]').count() === 5, '5 sedute programmate nel ciclo');

  console.log('6. Esito seduta e recupero senza doppio conteggio');
  const sel = page.locator('select[data-act=session-status]').first();
  await sel.selectOption('da_recuperare');
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Programma recupero")').first().click();
  await page.waitForSelector('.modal');
  const endBtn = page.locator('.modal button:has-text("Programma in coda al ciclo")');
  if (await endBtn.count()) {
    await endBtn.click();
    await page.waitForTimeout(200);
    const txt = await page.locator('.panel-head:has-text("Ciclo 1")').innerText();
    ok(/Conteggio: 5 \/ 5/.test(txt), 'il conteggio resta 5/5 dopo il recupero');
    ok(/1 recuperate/.test(txt), 'la seduta persa risulta recuperata');
  } else { ok(true, 'recupero in coda non disponibile (posto occupato): verificato nei test del motore'); await page.click('.modal [data-act=close-modal] >> nth=0'); }

  console.log('7. Assenza con rientro non noto');
  await page.goto(URL + '#/assenze');
  await page.waitForSelector('form[data-form=absence]');
  await page.click('text=Più giorni');
  await page.click('text=Non conosciuto');
  await page.click('button:has-text("Registra assenza")');
  await page.waitForSelector('.modal');
  ok(/non sono stati cancellati/.test(await page.locator('.modal').innerText()), 'appuntamenti coinvolti segnalati, non cancellati');
  await page.click('.modal [data-act=close-modal] >> nth=0');

  console.log('8. Lista d\'attesa → Trova posto senza reinserire i dati');
  await page.goto(URL + '#/lista');
  await page.locator('button:has-text("Trova posto")').first().click();
  await page.waitForSelector('#results');
  ok(/lista d'attesa/.test(await page.locator('.notice.warn').first().innerText()), 'dati caricati dalla lista d\'attesa');

  console.log('9. Tablet (1024×768) e sezioni secondarie');
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const r of ['agenda', 'lista', 'previsioni', 'fisioterapisti', 'impostazioni']) {
    await page.goto(URL + '#/' + r); await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!overflow, 'nessuno scorrimento orizzontale della pagina in ' + r);
  }
  await shot('e2e-4-tablet');

  console.log('10. Ripristino esempi con conferma');
  await page.goto(URL + '#/impostazioni');
  await page.click('text=Dati e salvataggio');
  await page.click('button:has-text("Ripristina i dati di esempio")');
  ok(await page.locator('.modal:has-text("Ripristinare")').isVisible(), 'richiesta di conferma prima del ripristino');
  await page.click('[data-act=modal-ok]');
  await page.waitForSelector('.search-form');
  const still = await page.evaluate(() => window.FisioApp.state.patients.some(p => p.name === 'Prova E2E'));
  ok(!still, 'dati di esempio ripristinati');

  console.log('11. Ripristino dall\'avviso in alto, con conferma (e annullamento)');
  await page.fill('#sf-name', 'Da non perdere');
  await page.evaluate(() => { const s = window.FisioApp.state; s.patients.push({ id: 'ptx', name: 'Marcatore', note: '' }); window.FisioApp.Store.save(s); });
  await page.click('.public-banner button:has-text("Ripristina esempi")');
  ok(await page.locator('.modal:has-text("Ripristinare")').isVisible(), 'il pulsante chiede conferma');
  await page.click('.modal button:has-text("Annulla")');
  ok(await page.evaluate(() => window.FisioApp.state.patients.some(p => p.name === 'Marcatore')), 'annullando, i dati restano invariati');
  await page.click('.public-banner button:has-text("Ripristina esempi")');
  await page.click('[data-act=modal-ok]');
  await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => window.FisioApp.state.patients.some(p => p.name === 'Marcatore'))), 'confermando, tornano i dati di esempio');
  await page.reload(); await page.waitForSelector('.search-form');
  ok(!(await page.evaluate(() => window.FisioApp.state.patients.some(p => p.name === 'Marcatore'))), 'il ripristino resta dopo il ricaricamento');

  console.log('12. Lista d\'attesa: classe prescritta, termine, filtri');
  await page.goto(URL + '#/lista'); await page.waitForSelector('.wl-table');
  const head = await page.locator('.wl-table thead').innerText();
  ok(/Classe prescritta/i.test(head) && /Termine applicato/i.test(head) && /Residuo/i.test(head), 'colonne classe, termine applicato e residuo presenti');
  ok(await page.locator('.wl-table .tag:has-text("Scaduto")').count() > 0, 'stato "Scaduto" mostrato con testo');
  ok(await page.locator('.wl-table:has-text("Configurazione demo da validare dal servizio")').count() === 1, 'regole demo etichettate come da validare');
  ok(await page.locator('.wl-table:has-text("Riferimento regionale")').count() === 1, 'origine regionale indicata');
  await page.click('label:has(input[name=wlPrio][value=U])'); await page.waitForTimeout(150);
  const uCells = await page.locator('.wl-table tbody tr td:nth-child(2)').allInnerTexts();
  ok(uCells.length > 0 && uCells.every(t => /Classe U/.test(t)), 'filtro U: solo richieste di classe U (' + uCells.length + ')');
  await page.click('label:has(input[name=wlPrio][value=senza])'); await page.waitForTimeout(150);
  const niCells = await page.locator('.wl-table tbody tr td:nth-child(2)').allInnerTexts();
  ok(niCells.length > 0 && niCells.every(t => /Non indicata|Da inserire/.test(t)), 'filtro "senza priorità": valore originale "Non indicata" conservato');
  await page.click('label:has(input[name=wlPrio][value=tutte])');
  await page.click('label:has(input[name=wlDue][value=scaduto])'); await page.waitForTimeout(150);
  const scad = await page.locator('.wl-table tbody tr').count();
  ok(scad > 0 && scad === await page.locator('.wl-table tbody tr.due-scaduto').count(), 'filtro scadute');
  await page.click('label:has(input[name=wlDue][value=tutte])');
  await page.click('button:has-text("Mano / Chirurgia della mano")'); await page.waitForTimeout(150);
  const handRows = await page.locator('.wl-table tbody tr').count();
  ok(handRows === 3 && await page.locator('.wl-table tbody tr:has-text("Mano / Chirurgia")').count() === 3, 'filtro percorso Mano (' + handRows + ' richieste)');

  console.log('13. Mano: ricerca con termine, conflitto e competenza');
  const conflictRow = page.locator('.wl-table tbody tr:has-text("Conflitto")');
  await conflictRow.locator('button:has-text("Trova posto")').click();
  await page.waitForSelector('#results'); await page.waitForTimeout(200);
  ok(await page.locator('#results .notice.bad:has-text("Conflitto tra le indicazioni")').count() === 1, 'data minima successiva alla scadenza: conflitto segnalato');
  ok(await page.locator('#results .dl-alert:has-text("Nessun posto confermato")').count() === 1, 'avviso evidente: nessun posto entro il termine');
  ok(await page.locator('#results .dl-alert li').count() > 0, 'prime alternative successive con ritardo');
  ok(await page.locator('#results tr.group-row .tag:has-text("Ritardo")').count() > 0, 'ritardo indicato nelle proposte');
  ok(/Mano/.test(await page.locator('#sf-cat').inputValue().then(v => page.locator('#sf-cat option[value="' + v + '"]').innerText())), 'percorso Mano caricato nella ricerca');
  await shot('e2e-5-mano');
  const lateBtn = page.locator('#results tr.group-row button:has-text("✓ Conferma")').first();
  if (await lateBtn.count()) {
    await lateBtn.click(); await page.waitForSelector('.modal #bk-name');
    ok(await page.locator('.modal #bk-late').count() === 1, 'conferma di un posto oltre il termine: richiesta presa d\'atto esplicita');
    ok(/Fine prevista del ciclo/.test(await page.locator('.modal').innerText()), 'fine del ciclo distinta dal termine di inizio');
    await page.click('[data-act=book-confirm]'); await page.waitForTimeout(150);
    ok(await page.locator('.modal #bk-name').count() === 1, 'senza presa d\'atto la conferma non procede');
    await page.check('#bk-late'); await page.click('[data-act=book-confirm]'); await page.waitForSelector('.cal');
    ok(true, 'assegnazione confermata dall\'operatore nonostante il ritardo');
  }

  console.log('14. Agenda e fisioterapisti: filtro Mano');
  await page.goto(URL + '#/agenda'); await page.waitForSelector('.cal');
  await page.click('label:has(input[name=am][value=giorno])'); await page.waitForTimeout(100);
  await page.click('button:has-text("✋ Mano")'); await page.waitForTimeout(150);
  const cols = await page.locator('.cal-col').count();
  ok(cols > 0 && cols < 18, 'agenda filtrata sui colleghi idonei al percorso Mano (' + cols + ')');
  await page.goto(URL + '#/fisioterapisti'); await page.click('button:has-text("Idonei Mano")'); await page.waitForTimeout(150);
  ok(await page.locator('.card').count() === cols, 'schede filtrate: stessi colleghi idonei');
  ok(await page.locator('.card .tag:has-text("Ortesi")').count() > 0, 'competenza ortesi visibile');
  await page.goto(URL + '#/impostazioni'); await page.click('text=Priorità e scadenze'); await page.waitForTimeout(150);
  ok(await page.locator('table.rules tbody tr').count() >= 10, 'regole dei termini configurabili');

  console.log('15. Aggiornamento dei dati salvati con la versione precedente');
  const v1 = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'stato-v1-demo.json.gz'))).toString();
  const oldState = JSON.parse(v1);
  await page.evaluate(t => localStorage.setItem('fisioagenda.v1', t), v1);
  await page.goto(URL + '#/lista'); await page.reload(); await page.waitForSelector('.wl-table');
  const mig = await page.evaluate(() => { const s = window.FisioApp.state; return { sessions: s.sessions.length, paths: s.paths.length, patients: s.patients.length, wl: s.waitlist.length, hand: s.categories.filter(c => c.hand).length, cls: s.waitlist.map(w => w.request.priorityClass) }; });
  ok(mig.sessions === oldState.sessions.length && mig.paths === oldState.paths.length && mig.patients === oldState.patients.length && mig.wl === oldState.waitlist.length, 'sedute, percorsi, pazienti e lista conservati');
  ok(mig.hand === 1, 'percorso Mano aggiunto una sola volta');
  ok(mig.cls.every(c => c === ''), 'nessuna classe di priorità attribuita automaticamente');
  ok(await page.locator('.wl-table .tag:has-text("Da completare")').count() > 0, 'richieste precedenti segnalate come da completare');
  ok(await page.locator('.toast:has-text("aggiornati alla nuova versione")').count() === 1, 'avviso di aggiornamento dei dati');
  await page.reload(); await page.waitForSelector('.wl-table');
  ok(await page.evaluate(() => window.FisioApp.state.sessions.length) === oldState.sessions.length, 'dati aggiornati conservati dopo un nuovo ricaricamento');

  ok(errors.length === 0, 'nessun errore JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? '\n' + failures + ' VERIFICHE FALLITE' : '\nTutte le verifiche dell\'interfaccia sono riuscite.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
