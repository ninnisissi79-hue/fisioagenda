/**
 * Verifica end-to-end in Chromium (tocchi multipli simulati via CDP).
 * Prerequisiti: server avviato con database dimostrativo e interfaccia compilata
 *   HANDLAB_DB=/tmp/e2e.sqlite npm run seed -- --reset && npm run build && HANDLAB_DB=/tmp/e2e.sqlite npm start
 * Uso: BASE=http://localhost:8787 node e2e/run.mjs
 * Nota: è una simulazione nel browser desktop; non sostituisce le prove su iPad e tablet Android.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = new URL('./output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const results = [];
const pageErrors = [];
const ONLY = process.env.ONLY;
const step = async (name, fn) => {
  if (ONLY && !name.includes(ONLY)) return;
  try { await fn(); results.push(['OK', name]); console.log('✓', name); }
  catch (e) {
    results.push(['FAIL', name, e.message]); console.log('✗', name, '\n ', e.message);
    const tag = 'FAIL-' + results.length;
    for (const [k, p] of [['ft', globalThis.pt], ['paz', globalThis.pp], ['cal', globalThis.pc]]) if (p) await p.screenshot({ path: OUT + `${tag}-${k}.png` }).catch(() => {});
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page, user) {
  await page.goto(BASE + '/');
  await page.getByTestId('login-user').fill(user);
  await page.getByTestId('login-password').fill('demo-handlab');
  await page.getByTestId('login-submit').click();
}

/** tocchi via CDP: mantiene l'elenco dei contatti attivi */
class Touch {
  constructor(cdp) { this.cdp = cdp; this.points = new Map(); }
  list() { return [...this.points.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 })); }
  async down(id, x, y) { this.points.set(id, { x, y }); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.list() }); }
  async move(targets, ms = 300) {
    const steps = Math.max(1, Math.round(ms / 20));
    const from = new Map([...Object.keys(targets)].map((k) => [Number(k), { ...this.points.get(Number(k)) }]));
    for (let i = 1; i <= steps; i++) {
      for (const [k, to] of Object.entries(targets)) { const f = from.get(Number(k)); this.points.set(Number(k), { x: f.x + (to.x - f.x) * i / steps, y: f.y + (to.y - f.y) * i / steps }); }
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
      await sleep(20);
    }
  }
  // in CDP touchEnd elenca i punti che vengono sollevati
  async up(id) { const p = this.points.get(id); this.points.delete(id); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }); }
  async upAll() { if (!this.points.size) return; const l = this.list(); this.points.clear(); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: l }); }
}

async function areaGeom(page) {
  const r = await page.getByTestId('exercise-area').boundingBox();
  const s = Math.min(r.width, r.height);
  return { r, s, at: (u) => ({ x: r.x + u.x * s, y: r.y + u.y * s }) };
}

// ---------------- Fisioterapista: cruscotto e schede
const ctxT = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'it-IT' });
const pt = await ctxT.newPage();
globalThis.pt = pt;
pt.on('pageerror', (e) => pageErrors.push('ft: ' + e.message));
await step('fisioterapista: accesso e cruscotto con pazienti dimostrativi', async () => {
  await login(pt, 'ft.demo');
  await pt.getByTestId('patients-table').waitFor();
  const txt = await pt.getByTestId('patients-table').innerText();
  assert.match(txt, /DEMO-001/); assert.match(txt, /DEMO-002/); assert.match(txt, /DEMO-003/);
  await pt.screenshot({ path: OUT + '01-cruscotto.png', fullPage: true });
});
await step('scheda paziente: esecuzione (aderenza, sedute, esecuzioni)', async () => {
  await pt.getByText('DEMO-001').first().click();
  await pt.getByRole('tab', { name: 'Esecuzione' }).click();
  await pt.getByTestId('adherence-grid').waitFor();
  await pt.getByTestId('runs-table').waitFor();
  await pt.screenshot({ path: OUT + '02-esecuzione.png', fullPage: true });
});
await step('scheda paziente: progressi (grafici separati per condizione)', async () => {
  await pt.getByRole('tab', { name: 'Progressi' }).click();
  await pt.locator('svg.chart').first().waitFor();
  await pt.screenshot({ path: OUT + '03-progressi.png', fullPage: true });
});
await step('programma: nuova versione con decorrenza futura, la precedente resta nello storico', async () => {
  await pt.getByRole('tab', { name: 'Programma' }).click();
  await pt.getByTestId('edit-program').click();
  await pt.getByTestId('item-editor').first().waitFor();
  await pt.getByTestId('item-editor').nth(1).getByRole('button', { name: 'Sospendi' }).click();
  const tomorrow = new Date(Date.now() + 86400000);
  const d = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await pt.getByTestId('effective-from').fill(d);
  await pt.screenshot({ path: OUT + '04-editor-programma.png', fullPage: true });
  await pt.getByTestId('save-program').click();
  await pt.getByText('Versione 3', { exact: true }).waitFor();
  await pt.getByText(/La versione 3 entrerà in vigore/).waitFor();
});

// ---------------- Paziente: seduta con multitouch, offline, pausa, ridimensionamento
const ctxP = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, locale: 'it-IT' });
const pp = await ctxP.newPage();
globalThis.pp = pp;
pp.on('pageerror', (e) => pageErrors.push('paz: ' + e.message));
const cdp = await ctxP.newCDPSession(pp);
const touch = new Touch(cdp);
const T = { x: 0.55, y: 0.72 }, I = { x: 0.72, y: 0.36 }; // posizioni della taratura dimostrativa (u)

await step('paziente: accesso e programma di oggi', async () => {
  await login(pp, 'demo001');
  await pp.getByTestId('start-session').waitFor();
  await pp.screenshot({ path: OUT + '05-paziente-home.png' });
});

await step('offline: la seduta parte con il programma salvato sul tablet', async () => {
  await ctxP.setOffline(true);
  await pp.getByTestId('start-session').click();
  await pp.getByTestId('report-cancel').click(); // salta domanda iniziale
  const g = await areaGeom(pp);
  await touch.down(1, g.at(T).x, g.at(T).y);
  await touch.down(2, g.at(I).x, g.at(I).y);
  await pp.getByTestId('confirm-reposition').waitFor({ timeout: 5000 });
  await touch.upAll();
  await pp.getByTestId('confirm-reposition').click();
  await pp.getByTestId('start-exercise').waitFor();
  await pp.screenshot({ path: OUT + '06-istruzioni-pinza.png' });
});

let g;
async function pinchRep() {
  const p = { 1: g.at(T), 2: g.at(I) };
  const mid = { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 };
  const toward = (a, k) => ({ x: mid.x + (a.x - mid.x) * k, y: mid.y + (a.y - mid.y) * k });
  await touch.move({ 1: toward(p[1], 0.35), 2: toward(p[2], 0.35) }, 400); // chiusura
  await sleep(650);                                                       // mantenimento
  await touch.move({ 1: p[1], 2: p[2] }, 400);                            // apertura
  await sleep(80);
}

await step('multitouch: pinza con due contatti simultanei conteggia le ripetizioni', async () => {
  await pp.getByTestId('start-exercise').click();
  await pp.getByTestId('exercise-area').waitFor();
  await sleep(300);
  g = await areaGeom(pp);
  await touch.down(1, g.at(T).x, g.at(T).y);
  await touch.down(2, g.at(I).x, g.at(I).y);
  await sleep(200);
  for (let i = 0; i < 3; i++) await pinchRep();
  await pp.screenshot({ path: OUT + '07-pinza-in-corso.png' });
  const c = await pp.getByTestId('rep-counter').innerText();
  assert.equal(c.split('/')[0].trim(), '3', 'ripetizioni contate: ' + c);
});

await step('perdita di un contatto: la ripetizione non viene conteggiata e si attende il riappoggio', async () => {
  const p = { 1: g.at(T), 2: g.at(I) };
  await touch.move({ 1: { x: p[1].x + 40, y: p[1].y - 40 } }, 200);
  await touch.up(2);
  await sleep(200);
  const msg = await pp.getByTestId('exercise-message').innerText();
  assert.match(msg, /Appoggia: Indice/);
  await touch.down(2, p[2].x + 5, p[2].y + 5); // ricompare (nuovo identificativo di puntatore nel browser)
  await touch.move({ 1: p[1], 2: p[2] }, 200);
  await sleep(200);
  assert.doesNotMatch(await pp.getByTestId('exercise-message').innerText(), /Appoggia/);
  const c = await pp.getByTestId('rep-counter').innerText();
  assert.equal(c.split('/')[0].trim(), '3');
});

await step('app in secondo piano: pausa automatica e ripresa manuale', async () => {
  await pp.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pp.getByTestId('pause-overlay').waitFor();
  assert.match(await pp.getByTestId('pause-overlay').innerText(), /secondo piano/);
  await pp.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await touch.upAll();
  await pp.getByTestId('resume').click();
  await touch.down(1, g.at(T).x, g.at(T).y); await touch.down(2, g.at(I).x, g.at(I).y);
  await sleep(200);
});

await step('cambio dimensioni/orientamento: pausa e ripresa solo con area ripristinata', async () => {
  await touch.upAll();
  await pp.setViewportSize({ width: 820, height: 1180 });
  await pp.getByTestId('pause-overlay').waitFor();
  assert.equal(await pp.getByTestId('resume').isDisabled(), true);
  await pp.screenshot({ path: OUT + '08-pausa-orientamento.png' });
  await pp.setViewportSize({ width: 1180, height: 820 });
  await sleep(300);
  assert.equal(await pp.getByTestId('resume').isDisabled(), false);
  await pp.getByTestId('resume').click();
  await touch.down(1, g.at(T).x, g.at(T).y); await touch.down(2, g.at(I).x, g.at(I).y);
  await sleep(200);
});

await step('completamento della pinza (2 serie con pausa tra le serie) secondo i criteri espliciti', async () => {
  for (let i = 0; i < 3; i++) await pinchRep();
  await pp.getByText(/Pausa: riposa la mano/).waitFor({ timeout: 3000 });
  await touch.upAll();
  await sleep(20500);
  await touch.down(1, g.at(T).x, g.at(T).y); await touch.down(2, g.at(I).x, g.at(I).y);
  await sleep(200);
  for (let i = 0; i < 6; i++) await pinchRep();
  await touch.upAll();
  await pp.getByTestId('continue').waitFor({ timeout: 5000 });
  assert.match(await pp.locator('h1').first().innerText(), /completato/);
  await pp.screenshot({ path: OUT + '09-risultati.png' });
  await pp.getByTestId('continue').click();
});

await step('interruzione con motivo e sintomi riferiti (secondo esercizio)', async () => {
  // eventuale pausa tra esercizi
  const cont = pp.getByRole('button', { name: 'Continua subito' });
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await pp.getByTestId('start-exercise').click();
  await pp.getByTestId('exercise-area').waitFor();
  await sleep(300);
  await pp.getByTestId('stop').click();
  await pp.getByTestId('reason-fatigue').click();
  await pp.locator('.scale').nth(1).getByRole('radio', { name: '3', exact: true }).click();
  await pp.getByTestId('confirm-stop').click();
  await pp.getByTestId('report-cancel').click(); // domanda finale saltata
  await pp.getByTestId('back-home').waitFor();
  await pp.screenshot({ path: OUT + '10-fine-seduta-offline.png' });
  const s = await pp.getByTestId('sync-status').innerText();
  assert.match(s, /da inviare/, 'offline: dati in attesa → ' + s);
});

await step('ritorno della connessione: sincronizzazione automatica', async () => {
  await ctxP.setOffline(false);
  await pp.evaluate(() => window.dispatchEvent(new Event('online')));
  await pp.getByText('Tutto inviato').waitFor({ timeout: 15000 });
});

await step('il fisioterapista vede sedute, esecuzioni e motivo di interruzione senza duplicati', async () => {
  const data = await pt.evaluate(async () => {
    const list = await (await fetch('/api/patients')).json();
    const p = list.find((x) => x.code === 'DEMO-001');
    return (await fetch(`/api/patients/${p.id}/activity`)).json();
  });
  const today = data.to;
  const runs = data.runs.filter((r) => r.localDate === today);
  const pinch = runs.filter((r) => r.exerciseId === 'pinch');
  assert.equal(pinch.length, 1, 'una sola esecuzione della pinza');
  assert.equal(pinch[0].status, 'completed');
  assert.equal(pinch[0].repsValid, 12);
  assert.ok(pinch[0].metrics.contactLosses >= 1, 'contatto perso registrato');
  assert.ok(pinch[0].activeMs > 0);
  const path = runs.filter((r) => r.exerciseId === 'path');
  assert.equal(path.length, 1); assert.equal(path[0].status, 'interrupted'); assert.equal(path[0].interruptionReason, 'fatigue');
  const sess = data.sessions.filter((s) => s.localDate === today);
  assert.equal(sess.length, 1); assert.equal(sess[0].status, 'interrupted');
  assert.equal(sess[0].programVersion, 2, 'eseguita la versione in vigore oggi (la v3 decorre da domani)');
  assert.ok(data.symptoms.some((s) => s.context === 'stop' && s.fatigue === 3));
});

await step('reinvio forzato: nessun duplicato sul server', async () => {
  const r = await pp.evaluate(async () => {
    const res = await fetch('/api/patients/' + (await (await fetch('/api/auth/me')).json()).user.patientId + '/activity');
    const d = await res.json();
    const run = d.runs.find((x) => x.exerciseId === 'pinch' && x.localDate === d.to);
    const full = await (await fetch('/api/runs/' + run.id)).json();
    const { receivedAt, isDemo, technicalInvalid, technicalInvalidReason, patientId, ...payload } = full;
    const body = { deviceId: 'x', clientLocalDate: d.to, tz: 'UTC', outboxEmptyAfter: false, sessions: [], runs: [payload], symptoms: [] };
    const out = await (await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-handlab': '1' }, body: JSON.stringify(body) })).json();
    const d2 = await (await fetch(res.url)).json();
    return { out, n: d2.runs.filter((x) => x.id === run.id).length };
  });
  assert.equal(r.out.inserted.runs, 0); assert.equal(r.n, 1);
});

await step('isolamento: il paziente non accede ai dati di un altro paziente', async () => {
  const st = await pp.evaluate(async () => {
    const ids = await (await fetch('/api/patients')).status;
    return ids;
  });
  assert.equal(st, 403);
});

await step('verifica guidata del touchscreen: conta i contatti realmente rilevati', async () => {
  await pp.goto(BASE + '/verifica');
  await pp.getByTestId('touch-message').waitFor();
  const r = await pp.getByTestId('exercise-area').boundingBox();
  const pts = [[0.3, 0.6], [0.4, 0.3], [0.5, 0.25], [0.6, 0.3], [0.7, 0.45]];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i < n; i++) if (!touch.points.has(i + 1)) await touch.down(i + 1, r.x + pts[i][0] * r.width, r.y + pts[i][1] * r.height);
    await sleep(800);
  }
  await touch.upAll();
  await pp.getByTestId('touch-skip').click();
  await pp.getByTestId('touch-finish').click();
  assert.equal(await pp.getByTestId('touch-max').innerText(), '3');
  await pp.screenshot({ path: OUT + '11-verifica-touch.png' });
});


// ---------------- Taratura guidata completa (DEMO-003, senza taratura)
const ctxC = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, locale: 'it-IT' });
const pc = await ctxC.newPage();
globalThis.pc = pc;
pc.on('pageerror', (e) => pageErrors.push('cal: ' + e.message));
const tc = new Touch(await ctxC.newCDPSession(pc));
await step('taratura guidata: dita una alla volta, disposizione, aree confortevoli, prova, salvataggio versionato', async () => {
  await login(pc, 'ft.demo');
  await pc.getByTestId('patients-table').waitFor();
  const pid = await pc.evaluate(async () => (await (await fetch('/api/patients')).json()).find((p) => p.code === 'DEMO-003').id);
  await pc.goto(`${BASE}/taratura/${pid}/nuova`);
  await pc.getByRole('button', { name: 'Avanti' }).click();
  await pc.getByRole('checkbox').check();
  await pc.getByRole('button', { name: 'Avanti' }).click();
  await pc.getByTestId('exercise-area').waitFor();
  const r = await pc.getByTestId('exercise-area').boundingBox();
  const pos = [[0.35, 0.75], [0.48, 0.35], [0.58, 0.3], [0.68, 0.35], [0.77, 0.5]].map(([x, y]) => ({ x: r.x + x * r.width, y: r.y + y * r.height }));
  for (let i = 0; i < 5; i++) { await tc.down(1, pos[i].x, pos[i].y); await sleep(1100); await tc.up(1); await sleep(300); }
  await pc.getByTestId('calib-next').click();
  for (let i = 0; i < 5; i++) await tc.down(i + 1, pos[i].x + 3, pos[i].y + 3);
  await sleep(1400);
  await tc.upAll();
  await pc.screenshot({ path: OUT + '12-taratura-disposizione.png' });
  await pc.getByTestId('calib-next').click();
  await pc.getByRole('button', { name: 'Inizia' }).click();
  // pinza: distanza tra pollice e indice
  await pc.getByTestId('comfort-start').click();
  await tc.down(1, pos[0].x, pos[0].y); await tc.down(2, pos[1].x, pos[1].y);
  const mid = { x: (pos[0].x + pos[1].x) / 2, y: (pos[0].y + pos[1].y) / 2 };
  await tc.move({ 1: { x: mid.x - 30, y: mid.y + 30 }, 2: { x: mid.x + 30, y: mid.y - 30 } }, 500);
  await tc.move({ 1: pos[0], 2: pos[1] }, 500);
  await tc.upAll();
  await pc.getByTestId('comfort-stop').click(); await pc.getByTestId('comfort-approve').click();
  // scorrimento
  await pc.getByTestId('comfort-start').click();
  await tc.down(1, pos[1].x, pos[1].y); await tc.move({ 1: { x: pos[1].x + 10, y: pos[1].y - 200 } }, 500); await tc.upAll();
  await pc.getByTestId('comfort-stop').click(); await pc.getByTestId('comfort-approve').click();
  // area di movimento
  await pc.getByTestId('comfort-start').click();
  await tc.down(1, pos[1].x, pos[1].y);
  await tc.move({ 1: { x: pos[1].x + 250, y: pos[1].y } }, 300); await tc.move({ 1: { x: pos[1].x + 250, y: pos[1].y + 200 } }, 300); await tc.move({ 1: { x: pos[1].x - 100, y: pos[1].y + 200 } }, 300);
  await tc.upAll();
  await pc.getByTestId('comfort-stop').click();
  await pc.screenshot({ path: OUT + '13-taratura-area.png' });
  await pc.getByTestId('comfort-approve').click();
  // prova: toccare ogni posizione con il dito indicato
  await pc.getByTestId('exercise-area').waitFor();
  for (let i = 0; i < 5; i++) { await tc.down(1, pos[i].x + 3, pos[i].y + 3); await sleep(100); await tc.up(1); await sleep(150); }
  if (process.env.DEBUG) console.log(await pc.evaluate(() => document.body.innerText.slice(0, 300)), pos, r);
  assert.match(await pc.getByTestId('calib-message').innerText(), /Prova superata/);
  await pc.getByTestId('calib-next').click();
  await pc.getByTestId('save-calibration').click();
  await pc.getByText('Versione 1').waitFor();
  const cals = await pc.evaluate(async (id) => (await fetch(`/api/patients/${id}/calibrations`)).json(), pid);
  assert.equal(cals.length, 1);
  assert.equal(cals[0].isReference, true);
  assert.equal(cals[0].layoutMethod, 'simultaneous');
  assert.deepEqual(cals[0].comfort.map((c) => c.exerciseId).sort(), ['chase', 'path', 'pinch', 'slide']);
  assert.ok(cals[0].layout.T.y > cals[0].layout.I.y, 'pollice associato alla posizione corretta');
  assert.equal(cals[0].trial.ok, true);
  await pc.screenshot({ path: OUT + '14-tarature.png' });
});

await step('catalogo: ogni esercizio disponibile si avvia in prova libera (destra e sinistra) e si interrompe', async () => {
  await pc.goto(BASE + '/esercizi');
  for (const name of ['Pinza sul piano', 'Scorrimento di un dito', 'Pianoforte', 'Segui la strada', 'Insegui il bersaglio']) {
    for (const side of ['destra', 'sinistra']) {
      const card = pc.locator('.card', { has: pc.getByRole('heading', { name }) });
      await card.getByRole('button', { name: `Prova (${side})` }).click();
      await pc.getByTestId('start-exercise').click();
      await pc.getByTestId('exercise-area').waitFor();
      await sleep(400);
      const msg = await pc.getByTestId('exercise-message').innerText();
      assert.ok(msg.length > 3, `${name}: messaggio presente`);
      if (side === 'sinistra' && name === 'Segui la strada') await pc.screenshot({ path: OUT + '15-strada-sinistra.png' });
      await pc.getByTestId('stop').click();
      await pc.getByTestId('reason-other').click();
      await pc.getByTestId('confirm-stop').click();
      await pc.getByRole('heading', { name: 'Esercizi' }).waitFor();
    }
  }
});

await step('nessun errore JavaScript non gestito', async () => {
  assert.deepEqual(pageErrors, []);
});


await browser.close();
console.log('\nRiepilogo:');
for (const r of results) console.log(r[0], '-', r[1], r[2] ? `(${r[2]})` : '');
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
