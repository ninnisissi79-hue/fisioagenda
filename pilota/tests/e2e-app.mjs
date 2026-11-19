// App installabile (cellulare e PC): manifest con icone, service worker attivo, apertura anche senza rete,
// istruzioni per iPhone, Android e PC. Server locale, nessun dato reale.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from './helpers.mjs';

const PORT = 8096;
let step = 0;
const ok = m => console.log(`✓ ${++step}. ${m}`);
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.js'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#em');
  // manifest valido con icone vere
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return { type: r.headers.get('content-type'), json: await r.json() }; });
  assert.match(man.type, /manifest\+json/);
  assert.equal(man.json.display, 'standalone'); assert.equal(man.json.start_url, './');
  for (const ic of man.json.icons) {
    const st = await page.evaluate(async src => { const r = await fetch(src); const b = await r.blob(); const im = await createImageBitmap(b); return [r.status, im.width, im.height]; }, ic.src);
    assert.deepEqual(st, [200, Number(ic.sizes.split('x')[0]), Number(ic.sizes.split('x')[1])], ic.src);
  }
  assert.ok(man.json.icons.some(i => i.purpose === 'maskable'), 'icona adattabile per Android');
  assert.ok(await page.$('link[rel=apple-touch-icon]'), 'icona per iPhone');
  ok('Scheda dell’app (manifest) con nome, schermo intero e icone per PC, Android e iPhone');
  // service worker attivo che controlla la pagina
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('#em');
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  const cdp = await ctx.newCDPSession(page);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, [], 'Chrome la considera installabile');
  ok('Service worker attivo: l’app si installa e si aggiorna da sola (Chrome: nessun ostacolo all’installazione)');
  // senza rete: l'app si apre comunque (copia dell'ultima versione)
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector('#em', { timeout: 10000 });
  assert.match(await page.textContent('body'), /FisioAgenda/);
  await ctx.setOffline(false);
  ok('Senza rete l’app si apre lo stesso (i dati arrivano quando torna la connessione)');
  // istruzioni d'installazione
  await page.click('button[data-act="install-app"]');
  await page.waitForSelector('.modal');
  const how = await page.textContent('.modal');
  assert.match(how, /iPhone/); assert.match(how, /Android/); assert.match(how, /PC/); assert.match(how, /Aggiungi alla schermata Home/);
  await page.click('.modal button:has-text("Ho capito")');
  ok('«Come installare l’app»: istruzioni per iPhone, Android e PC');
  // iPhone: il pulsante «Installa l'app» compare (Safari non ha il pulsante automatico)
  const ip = await browser.newContext({ ...devices['iPhone 13'] });
  const pi = await ip.newPage();
  await pi.goto(`http://localhost:${PORT}/`); await pi.waitForSelector('#em');
  assert.match(await pi.textContent('button[data-act="install-app"]'), /Installa l’app su questo dispositivo/);
  ok('Su iPhone il pulsante «Installa l’app» spiega come aggiungerla alla schermata Home');
  assert.deepEqual(errors, []);
} finally { await browser.close(); server.kill(); }
console.log('Tutte le prove dell’app installabile superate.');
