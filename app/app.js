/* RE-HAND · Opuscoli riabilitazione mano
   App web installabile (PWA): libreria brochure, editor, aggiornamenti con scelta Sì/No, stampa A4. */
(function () {
"use strict";

/* ------------------------------------------------------------------ utilità */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => { if (!d) return ""; const [y, m, g] = d.split("-"); return `${g}/${m}/${y}`; };
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();
const slug = (s) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "doc";
const lines = (v) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms); }
function getPath(o, p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach((k) => { if (a[k] == null) a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }
function download(name, text, type = "application/json") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function readFile(file, as = "text") { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; as === "url" ? r.readAsDataURL(file) : r.readAsText(file); }); }
async function imageToDataUrl(file, max = 1200) {
  const url = await readFile(file, "url");
  const img = new Image(); img.src = url; await img.decode();
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86);
}

/* ------------------------------------------------------------------ database (IndexedDB) */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("rehand-opuscoli", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("docs", { keyPath: "id" }); d.createObjectStore("kv"); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); });
  },
  all() { return this.tx("docs", "readonly", (s) => s.getAll()); },
  put(doc) { return this.tx("docs", "readwrite", (s) => s.put(doc)); },
  del(id) { return this.tx("docs", "readwrite", (s) => s.delete(id)); },
  get(k) { return this.tx("kv", "readonly", (s) => s.get(k)); },
  set(k, v) { return this.tx("kv", "readwrite", (s) => s.put(v, k)); },
};

/* ------------------------------------------------------------------ stato */
const S = { docs: [], settings: null, decisions: {}, feed: null, feedError: "", edited: new Set(), installEvt: null };
const PANEL_NAMES = {
  cover: "Esterno · Copertina (anta destra)",
  e2: "Esterno · Retro (anta centrale)",
  e1: "Esterno · Aletta interna (anta sinistra)",
  i1: "Interno · Anta sinistra",
  i2: "Interno · Anta centrale",
  i3: "Interno · Anta destra",
};
const PANEL_ORDER = ["cover", "e1", "e2", "i1", "i2", "i3"];
const docById = (id) => S.docs.find((d) => d.id === id);
/* protocolli alternativi (es. flessori: Kleinert / attivo precoce / pull-out): un elemento con "protocolli" compare solo se è attivo uno di quelli */
const vis = (item, doc) => !item.protocolli || !item.protocolli.length || !doc.protocollo || item.protocolli.includes(doc.protocollo);
const protoName = (doc) => { const p = (doc.protocolli || []).find((x) => x.id === doc.protocollo); return p ? p.nome : ""; };
const ill = (d) => (window.RH_ILL && d ? window.RH_ILL.disegno(window.RH_ILL.risolvi(d)) : "");

async function saveDoc(doc) { await DB.put(doc); const i = S.docs.findIndex((d) => d.id === doc.id); if (i >= 0) S.docs[i] = doc; else S.docs.push(doc); }
/* ruoli: locale (nessun cloud) · ospite (cloud senza accesso) · admin · editor · lettore */
const C = () => window.Cloud || { enabled: false };
const MODE = () => (!C().enabled ? "locale" : !C().user ? "ospite" : C().ruolo || "errore");
const cloudErrText = () => { const e = (C().error || "") + ""; return /rehand_registrati|function|schema cache|does not exist|PGRST/i.test(e) ? "Le tabelle RE-HAND non risultano nel progetto Supabase: lo script schema.sql va eseguito in hand-lab (SQL Editor → Run). Dettaglio: " + e : e || "errore sconosciuto"; };
const canEdit = () => ["locale", "admin", "editor"].includes(MODE());
const canPublish = () => ["locale", "admin"].includes(MODE());
const RUOLI = { admin: "Amministratrice/ore", editor: "Editor (propone modifiche)", lettore: "Lettore (solo lettura)", in_attesa: "In attesa di approvazione" };
/* salva una modifica: l'admin pubblica subito sul cloud, l'editor la tiene come bozza da inviare */
async function commit(doc) {
  if (MODE() === "editor") doc._modificheLocali = true;
  await saveDoc(doc);
  if (MODE() === "admin") { try { await C().pushDoc(doc); } catch (e) { toast("⚠ Non salvato sul cloud: " + e.message, 5000); } }
}
let setTimer;
async function saveSettings() {
  await DB.set("settings", S.settings); applyTheme();
  if (MODE() === "admin") { clearTimeout(setTimer); setTimer = setTimeout(() => C().pushSettings(S.settings).catch((e) => toast("⚠ Impostazioni non salvate sul cloud: " + e.message)), 600); }
}
async function setDecision(id, d) {
  if (d) S.decisions[id] = d; else delete S.decisions[id];
  await DB.set("decisions", S.decisions);
  if (MODE() === "admin") { try { d ? await C().pushDecision(id, d) : await C().deleteDecision(id); } catch (e) { toast("⚠ " + e.message); } }
}
async function syncFromCloud() {
  if (!C().enabled || !C().user) return;
  if (MODE() === "in_attesa") { renderNav(); return; }
  try {
    const remote = await C().pullDocs();
    S.cloudEmpty = !remote.length; S.unpublished = [];
    if (remote.length) {
      const ids = new Set(remote.map((d) => d.id));
      for (const d of remote) { const l = docById(d.id); if (l && l._modificheLocali && MODE() === "editor") continue; await saveDoc(d); }
      for (const l of S.docs.slice()) if (!ids.has(l.id)) {
        if (MODE() === "admin") S.unpublished.push(l.id);
        else if (!l._modificheLocali) { await DB.del(l.id); S.docs = S.docs.filter((x) => x.id !== l.id); }
      }
    }
    const st = await C().pullSettings(); if (st) { S.settings = Object.assign(S.settings, st); await DB.set("settings", S.settings); applyTheme(); }
    S.decisions = await C().pullDecisions(); await DB.set("decisions", S.decisions);
    S.userPending = MODE() === "admin" ? (await C().listProfiles()).filter((u) => u.ruolo === "in_attesa").length : 0;
    S.reqPending = MODE() === "admin" ? (await C().listRequests("in_attesa")).length : 0;
    S.syncError = "";
  } catch (e) { S.syncError = e.message; }
  renderNav(); updateBadge();
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("connessione lenta: riprovo più tardi")), ms))]);
/* applica le modifiche di contenuto; l'amministratrice pubblica una sola volta ogni opuscolo cambiato */
async function runMigrations(publish) {
  const touched = [];
  for (const d of S.docs.slice()) {
    let t = false;
    for (const m of window.REHAND_MIGRAZIONI || []) {
      if ((d.migrazioni || []).includes(m.id)) continue;
      let changed = false;
      try { changed = m.apply(d); } catch (e) { console.warn("migrazione", m.id, d.id, e); }
      d.migrazioni = (d.migrazioni || []).concat(m.id); t = true;
      if (changed) { d.storico = d.storico || []; d.storico.push({ data: today(), testo: m.nota, fonte: "" }); d.versione = (d.versione || 1) + 1; d.aggiornato = today(); }
    }
    if (t) { await saveDoc(d); touched.push(d.id); }
  }
  if (publish && MODE() === "admin") for (const id of touched) { try { await withTimeout(C().pushDoc(docById(id)), 15000); } catch (e) { console.warn(e); } }
  return touched.length;
}
/* ridisegna la pagina dopo la sincronizzazione, senza disturbare chi sta scrivendo */
function refreshView() {
  renderNav(); updateBadge();
  const h = location.hash;
  if (/\/(testi|esercizi|paziente)$/.test(h) || /impostazioni|nuova-password/.test(h)) return;
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  route();
}
function renderNav() {
  const n = $("#topnav"); if (!n) return;
  const m = MODE();
  n.innerHTML = `${m === "admin" ? `<button class="btn" data-go="richieste" title="Richieste di modifica">📨<span class="lbl-s"> Richieste</span> ${S.reqPending ? `<span class="badge">${S.reqPending}</span>` : ""}</button>` : ""}
    <button class="btn btn-update" data-go="aggiorna" title="Aggiornamenti">⟳<span class="lbl-s"> Aggiorna</span> <span class="badge" id="upd-badge" hidden>0</span></button>
    ${m === "admin" && S.userPending ? `<button class="btn" data-go="utenti" title="Nuovi utenti">👥<span class="lbl-s"> Nuovi utenti</span> <span class="badge">${S.userPending}</span></button>` : ""}
    ${C().enabled ? `<button class="btn ghost" data-go="account" title="Account">${m === "ospite" ? `🔑<span class="lbl-s"> Accedi</span>` : m === "errore" ? `⚠<span class="lbl-s"> Errore</span>` : `👤<span class="lbl-s"> ${({ admin: "Admin", editor: "Editor", lettore: "Lettore", in_attesa: "In attesa" }[m] || "")}</span>`}</button>` : ""}
    <button class="btn ghost" data-go="impostazioni" title="Impostazioni">⚙︎</button>`;
  updateBadge();
}
function applyTheme() { document.documentElement.style.setProperty("--blu", S.settings.colore || "#1d4f9c"); document.documentElement.style.setProperty("--verde", S.settings.colore2 || "#3aa635"); }

async function init() {
  const recupero = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
  await DB.open();
  S.settings = Object.assign(clone(window.DEFAULT_SETTINGS), (await DB.get("settings")) || {});
  if (!S.settings.regoleEsercizi) S.settings.regoleEsercizi = ["Esegui gli esercizi lentamente e senza provocare dolore.", "Tempi e ripetizioni possono essere personalizzati dal tuo fisioterapista.", "Contatta il centro se compaiono dolore forte, gonfiore marcato o formicolii nuovi."];
  S.decisions = (await DB.get("decisions")) || {};
  S.docs = await DB.all();
  const seeded = (await DB.get("seedVersion")) || 0;
  if (seeded < window.SEED_VERSION) {
    for (const d of window.SEED_DOCS) { const cur = docById(d.id); if (!cur || ((cur.versione || 1) === 1 && (d.versione || 1) >= 1 && (cur.storico || []).length <= 1)) await saveDoc(clone(d)); }
    await DB.set("seedVersion", window.SEED_VERSION);
  }
  // completa sempre gli opuscoli originali con disegni e campi nuovi (senza toccare i testi modificati)
  for (const sd of window.SEED_DOCS) {
    const cur = docById(sd.id); if (!cur) { await saveDoc(clone(sd)); continue; }
    let ch = false;
    if (!cur.disegno && sd.disegno) { cur.disegno = sd.disegno; ch = true; }
    (cur.esercizi || []).forEach((e) => { const se = sd.esercizi.find((x) => x.id === e.id); if (se && se.disegno && !e.disegno) { e.disegno = se.disegno; ch = true; } });
    if (ch) await saveDoc(cur);
  }
  applyTheme();
  await runMigrations(false); // solo sul dispositivo: veloce
  if (window.Cloud) { try { await window.Cloud.init(); } catch (e) { console.warn(e); } if (window.Cloud.sb) window.Cloud.sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") go("account/nuova-password"); }); }
  if (recupero && C().user) location.hash = "#/account/nuova-password";
  renderNav();
  window.addEventListener("hashchange", route);
  document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go === "home" ? "" : g.dataset.go); } });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });
  window.addEventListener("resize", () => { clearTimeout(init._r); init._r = setTimeout(scalePreviews, 120); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  route(); // la schermata compare subito con i dati salvati sul dispositivo
  // poi, in sottofondo: ruolo aggiornato, brochure dal cloud, modifiche da pubblicare
  (async () => {
    if (C().user) {
      try { await withTimeout(C()._setUser(C().user), 10000); C().error = ""; } catch (e) { if (!C().ruolo) C().error = e.message; }
      if (C().ruolo) { try { await withTimeout(syncFromCloud(), 20000); } catch (e) { S.syncError = e.message; } await runMigrations(true); }
      refreshView();
    }
    checkFeed(true);
  })();
}
function go(h) { location.hash = "#/" + h; }

/* ------------------------------------------------------------------ aggiornamenti: feed */
async function checkFeed(silent) {
  S.feedError = "";
  try {
    const url = S.settings.feedUrl || "aggiornamenti.json";
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    S.feed = await r.json();
    await DB.set("feedCache", S.feed);
  } catch (e) {
    const cached = await DB.get("feedCache"); const local = window.FEED_LOCALE;
    // aperta dal disco (doppio clic su index.html): usa la copia allegata all'app
    S.feed = [cached, local].filter(Boolean).sort((a, b) => String(b.generato).localeCompare(String(a.generato)))[0] || S.feed;
    if (location.protocol !== "file:") S.feedError = "Non riesco a scaricare gli aggiornamenti (" + e.message + "). Mostro l’ultimo elenco salvato.";
  }
  updateBadge();
  const n = pending().length;
  if (silent && n && canPublish()) toast(`🔔 ${n} aggiornamenti da valutare`, 3000);
  return n;
}
function pending(docId) {
  const ps = (S.feed && S.feed.proposte) || [];
  return ps.filter((p) => !S.decisions[p.id] && (p.op === "nuova_patologia" ? !docById(p.proposto.id) && !docId : docById(p.patologia) && (!docId || p.patologia === docId)));
}
function updateBadge() { const n = pending().length; const b = $("#upd-badge"); if (!b) return; b.textContent = n; b.hidden = !n || !canPublish(); }

/* ------------------------------------------------------------------ router */
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const v = $("#view");
  window.scrollTo(0, 0);
  if (MODE() === "in_attesa" && parts[0] !== "impostazioni") return viewAccount(v, parts[0] === "account" ? parts[1] : undefined);
  if (parts[0] === "doc" && docById(parts[1])) return viewDoc(v, docById(parts[1]), parts[2] || "pieghevole");
  if (parts[0] === "aggiorna") return viewUpdates(v);
  if (parts[0] === "impostazioni") return viewSettings(v);
  if (parts[0] === "account") return viewAccount(v, parts[1]);
  if (parts[0] === "richieste" && MODE() === "admin") return viewRequests(v);
  if (parts[0] === "utenti" && MODE() === "admin") return viewUsers(v);
  if ((MODE() === "ospite" && !S.guestOk) || MODE() === "in_attesa") return viewAccount(v, parts[0] === "account" ? parts[1] : undefined);
  return viewHome(v);
}

/* ------------------------------------------------------------------ HOME */
function viewHome(v) {
  const cats = [...new Set(S.docs.map((d) => d.categoria || "Altro"))].sort();
  v.innerHTML = `
    <h1>Opuscoli e brochure</h1>
    <div class="toolbar">
      <input class="search" id="q" placeholder="Cerca patologia…" autocomplete="off">
      <select id="cat" class="search" style="flex:0 0 auto;min-width:150px"><option value="">Tutte le categorie</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
    </div>
    ${MODE() === "errore" ? `<div class="warnbox" style="background:#fdecea;border-color:#f3b6af">⚠ <b>Collegamento a RE-HAND non riuscito.</b> ${esc(cloudErrText())}<div class="row" style="margin-top:8px"><button class="btn small" id="retry">⟳ Riprova</button><button class="btn small red" id="logout2">Esci</button></div></div>` : ""}
    ${S.syncError ? `<div class="warnbox">⚠ Cloud non raggiungibile (${esc(S.syncError)}): lavori sulla copia salvata su questo dispositivo.</div>` : ""}
    ${MODE() === "admin" && S.cloudEmpty ? `<div class="warnbox" style="background:#e7f6e5;border-color:#a9dca3">☁️ Il cloud è vuoto. <button class="btn small green" id="upall">Pubblica le ${S.docs.length} brochure, le impostazioni e le decisioni</button></div>` : ""}
    ${MODE() === "admin" && !S.cloudEmpty && S.unpublished && S.unpublished.length ? `<div class="warnbox">🆕 ${S.unpublished.length} opuscoli presenti nell’app non sono ancora nel cloud (${S.unpublished.map((id) => esc((docById(id) || {}).titolo || id)).join(", ")}). <button class="btn small green" id="upnew">Pubblica</button></div>` : ""}
    ${MODE() === "editor" ? `<div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">✏️ Sei <b>editor</b>: puoi modificare le brochure, ma le modifiche vanno all’amministratrice per l’approvazione.</div>` : ""}
    ${MODE() === "lettore" || MODE() === "ospite" ? `<div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">👁 Sola lettura: puoi vedere e stampare le brochure.</div>` : ""}
    <div class="toolbar">
      ${canEdit() ? `<button class="btn green" id="new">＋ Nuova patologia</button>` : ""}
      ${canPublish() ? `<label class="btn ghost" style="color:var(--blu)">⇪ Importa opuscolo<input type="file" id="imp" accept=".json,application/json" hidden></label>` : ""}
      ${S.installEvt ? `<button class="btn ghost" id="inst" style="color:var(--blu)">⤓ Installa app</button>` : ""}
    </div>
    ${installHint()}
    <div class="grid" id="list"></div>
    <div id="richiedi"></div>
    <div id="patric"></div>`;
  const draw = () => {
    const q = norm($("#q").value), c = $("#cat").value;
    const list = S.docs.filter((d) => (!q || norm(d.titolo).includes(q)) && (!c || (d.categoria || "Altro") === c)).sort((a, b) => a.titolo.localeCompare(b.titolo, "it"));
    $("#list").innerHTML = list.map((d) => { const n = pending(d.id).length; return `
      <div class="card" data-id="${esc(d.id)}">
        <div class="row"><span class="pill">${esc(d.categoria || "Altro")}</span>${n ? `<span class="pill warn">🔔 ${n} aggiornament${n > 1 ? "i" : "o"}</span>` : ""}${d.stato === "bozza" ? `<span class="pill" style="background:#eef3fa">📝 bozza</span>` : ""}${d._modificheLocali ? `<span class="pill warn">✏️ modifiche da inviare</span>` : ""}${d.protocolli ? `<span class="pill">${d.protocolli.length} protocolli</span>` : ""}</div>
        <h3>${esc(d.titolo)}</h3>
        <div class="meta">Aggiornato il ${fmtDate(d.aggiornato)} · versione ${d.versione || 1} · ${d.esercizi.length} esercizi</div>
      </div>`; }).join("") || `<p class="muted">Nessun opuscolo trovato.</p>`;
  };
  const drawReq = () => {
    const q = $("#q").value.trim(); const box = $("#richiedi");
    const found = S.docs.some((d) => norm(d.titolo).includes(norm(q)));
    if (q.length < 3) { box.innerHTML = `<p class="muted" style="font-size:13px;margin-top:14px">🔎 Non trovi una patologia? Scrivila nella ricerca: se non c’è ancora potrai chiederne la preparazione.</p>`; return; }
    const canReq = C().enabled && ["admin", "editor", "lettore"].includes(MODE());
    box.innerHTML = `<div class="ed-panel" style="padding:14px;margin-top:14px"><b>${found ? "Non è quella che cercavi?" : `🔎 “${esc(q)}” non c’è ancora.`}</b>
      ${canReq ? `<p class="muted" style="font-size:13px;margin:4px 0 8px">Chiedi la preparazione della brochure: verrà cercata in letteratura scientifica e linee guida alla prossima ricerca automatica (ogni settimana) e comparirà in “Aggiorna” per l’approvazione.</p>
        <label class="f">Dettagli (facoltativi): tipo di intervento, protocollo, conservativo/chirurgico…<input id="rq-det" maxlength="600"></label>
        <button class="btn green" id="rq-go" style="margin-top:8px">📨 Richiedi la brochure “${esc(q)}”</button>`
      : `<p class="muted" style="font-size:13px">Chiedila a Claude in chat${C().enabled ? " oppure accedi per inviare la richiesta" : ""}.</p>`}</div>`;
    if ($("#rq-go")) $("#rq-go").onclick = async () => { try { await C().requestPathology(q, $("#rq-det").value.trim()); toast("📨 Richiesta inviata"); $("#q").value = ""; draw(); drawReq(); drawPat(); } catch (e) { alert("Richiesta non inviata: " + e.message); } };
  };
  const drawPat = async () => {
    const box = $("#patric"); if (!box || !C().enabled || !["admin", "editor", "lettore"].includes(MODE())) return;
    let rs; try { rs = await C().listPathologyRequests(); } catch { return; }
    if (!rs.length) { box.innerHTML = ""; return; }
    const props = ((S.feed && S.feed.proposte) || []).filter((p) => p.op === "nuova_patologia");
    const stato = (r) => { const pr = props.find((p) => p.richiesta === r.id); if (pr && docById(pr.proposto.id)) return `<span class="pill ok">pubblicata</span>`; if (pr && S.decisions[pr.id] && S.decisions[pr.id].stato === "rifiutata") return `<span class="pill">non accettata</span>`; if (pr) return `<span class="pill warn">pronta in “Aggiorna”</span>`; return `<span class="pill">in preparazione</span>`; };
    box.innerHTML = `<h2>Patologie richieste</h2>${rs.map((r) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--bd)">${stato(r)}<b style="flex:1">${esc(r.patologia)}</b><small class="muted">${new Date(r.creato).toLocaleDateString("it-IT")}${r.dettagli ? " · " + esc(r.dettagli) : ""}</small>${MODE() === "admin" ? `<button class="iconbtn" data-delpr="${r.id}">✕</button>` : ""}</div>`).join("")}`;
    $$("[data-delpr]", box).forEach((b) => (b.onclick = async () => { if (!confirm("Eliminare la richiesta?")) return; await C().deletePathologyRequest(+b.dataset.delpr); drawPat(); }));
  };
  $("#q").oninput = () => { draw(); drawReq(); }; $("#cat").onchange = draw; draw(); drawReq(); drawPat();
  $("#list").onclick = (e) => { const c = e.target.closest(".card"); if (c) go("doc/" + c.dataset.id); };
  const pubAll = async (ids) => { try { for (const id of ids) await C().pushDoc(docById(id)); await C().pushSettings(S.settings); for (const [k, d] of Object.entries(S.decisions)) await C().pushDecision(k, d); toast("Pubblicato sul cloud ✓"); await syncFromCloud(); viewHome(v); } catch (e) { alert("Errore: " + e.message); } };
  if ($("#retry")) $("#retry").onclick = () => location.reload();
  if ($("#logout2")) $("#logout2").onclick = async () => { await C().signOut(); location.reload(); };
  if ($("#upall")) $("#upall").onclick = () => pubAll(S.docs.map((d) => d.id));
  if ($("#upnew")) $("#upnew").onclick = () => pubAll(S.unpublished);
  if ($("#new")) $("#new").onclick = async () => {
    const t = prompt("Nome della patologia (es. Rizoartrosi, Frattura di scafoide…)"); if (!t) return;
    const d = clone(window.TEMPLATE_DOC); d.titolo = "Riabilitazione – " + t.trim(); d.id = uniqueId(slug(t)); d.aggiornato = today(); d.versione = 1;
    d.storico = [{ data: today(), testo: "Creato dal modello vuoto.", fonte: "" }];
    await commit(d); go("doc/" + d.id + "/testi");
  };
  if ($("#imp")) $("#imp").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await readFile(f)); if (!d.pannelli) throw 0; if (docById(d.id) && !confirm(`Esiste già “${docById(d.id).titolo}”. Sostituirlo?`)) d.id = uniqueId(d.id); await commit(d); toast("Opuscolo importato"); draw(); }
    catch { alert("File non valido."); }
  };
  if ($("#inst")) $("#inst").onclick = () => S.installEvt.prompt();
}
/* avviso di installazione sul telefono (iPhone non mostra mai il pulsante "Installa") */
function installHint() {
  const ua = navigator.userAgent || "";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || localStorage.getItem("rehand-hint-off") || !/Android|iPhone|iPad|iPod/i.test(ua)) return "";
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|GSA\/|wv\)/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const txt = inApp ? "Hai aperto il link dentro un’altra app (WhatsApp, Gmail…): tocca ⋮ e scegli <b>Apri nel browser</b> (Chrome o Safari), poi installa."
    : ios ? "Per installare RE-HAND: in <b>Safari</b> tocca <b>Condividi</b> (quadrato con la freccia ↑) → <b>Aggiungi alla schermata Home</b>."
    : "Per installare RE-HAND: in <b>Chrome</b> tocca <b>⋮</b> → <b>Installa app</b> (o <b>Aggiungi a schermata Home</b>).";
  setTimeout(() => { const x = document.getElementById("hint-off"); if (x) x.onclick = () => { localStorage.setItem("rehand-hint-off", "1"); x.parentElement.remove(); }; }, 0);
  return `<div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">📲 ${txt} <button class="iconbtn" id="hint-off" style="float:right">✕</button></div>`;
}
function uniqueId(base) { let id = base, i = 2; while (docById(id)) id = base + "-" + i++; return id; }

/* ------------------------------------------------------------------ DOCUMENTO */
function viewDoc(v, doc, tab) {
  const n = pending(doc.id).length;
  const tabs = [["paziente", "👤 Per il paziente"], ["pieghevole", "Pieghevole A4"], ["esercizi-a4", "Opuscolo esercizi A4"]].concat(canEdit() ? [["testi", "Modifica testi"], ["esercizi", "Modifica esercizi"]] : [], [["storico", "Storico e fonti"]]);
  if (!canEdit() && (tab === "testi" || tab === "esercizi")) tab = "pieghevole";
  v.innerHTML = `
    <div class="row"><button class="btn ghost small" data-go="home" style="color:var(--blu)">← Tutti</button><span class="spacer"></span><span class="saved" id="saved"></span></div>
    <h1>${esc(doc.titolo)}</h1>
    <p class="muted" style="margin-top:-8px">Aggiornato il ${fmtDate(doc.aggiornato)} · versione ${doc.versione || 1}</p>
    ${doc._modificheLocali && MODE() === "editor" ? `<div class="warnbox">✏️ <b>Hai modifiche non ancora approvate.</b> Sono solo su questo dispositivo. <button class="btn small green" id="invia">📨 Invia all’amministratrice</button> <button class="btn small red" id="annulla">↺ Annulla le mie modifiche</button></div>` : ""}
    ${doc.stato === "bozza" ? `<div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">📝 <b>Bozza da revisionare.</b> Preparata da Claude su letteratura scientifica e linee guida (vedi “Storico e fonti”).${canPublish() ? ` Controllate i testi e premete <button class="btn small green" id="approva">✓ Approva</button>` : " In attesa di approvazione dell’amministratrice."}</div>` : ""}
    ${doc.protocolli && doc.protocolli.length ? `<div class="toolbar"><label class="f" style="margin:0;flex:1;min-width:260px">Protocollo usato (cambia esercizi, fasi e ortesi)<select id="proto">${doc.protocolli.map((p) => `<option value="${esc(p.id)}" ${p.id === doc.protocollo ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select></label></div><p class="muted" style="margin-top:-6px;font-size:13px">${esc(((doc.protocolli.find((p) => p.id === doc.protocollo) || {}).descrizione) || "")}</p>` : ""}
    ${n ? `<div class="warnbox">🔔 Ci sono <b>${n}</b> aggiornamenti proposti per questa patologia. <a href="#/aggiorna">Valutali ora →</a></div>` : ""}
    <div class="toolbar doc-actions">
      <button class="btn" id="p-broch">🖨 Pieghevole</button>
      <button class="btn" id="p-ex">🖨 Esercizi</button>
    </div>
    <div class="toolbar doc-more">
      ${canEdit() ? `<button class="btn ghost small" id="dup" style="color:var(--blu)">Duplica</button>` : ""}
      <button class="btn ghost small" id="exp" style="color:var(--blu)">Esporta</button>
      ${canPublish() ? `<button class="btn red small" id="del">Elimina</button>` : ""}
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="tabbody"></div>`;
  $$(".tabs button", v).forEach((b) => (b.onclick = () => go(`doc/${doc.id}/${b.dataset.tab}`)));
  if ($("#proto")) $("#proto").onchange = async (e) => { doc.protocollo = e.target.value; await saveDoc(doc); viewDoc(v, doc, tab); }; // scelta di visualizzazione: resta sul dispositivo
  if ($("#approva")) $("#approva").onclick = async () => { doc.stato = "approvata"; doc.versione = (doc.versione || 1) + 1; doc.aggiornato = today(); doc.storico = doc.storico || []; doc.storico.push({ data: today(), testo: `Bozza revisionata e approvata${C().email ? " da " + C().email : ""}.`, fonte: "" }); await commit(doc); viewDoc(v, doc, tab); };
  if ($("#invia")) $("#invia").onclick = async () => {
    const nota = prompt("Spiega in breve cosa hai cambiato e perché (la leggerà l’amministratrice):", ""); if (nota === null) return;
    try { await C().submitRequest(doc, nota); await revertLocal(doc.id); toast("📨 Richiesta inviata all’amministratrice"); go("account"); } catch (e) { alert("Invio non riuscito: " + e.message); }
  };
  if ($("#annulla")) $("#annulla").onclick = async () => { if (!confirm("Annullare tutte le tue modifiche a questa brochure?")) return; await revertLocal(doc.id); go("doc/" + doc.id); route(); };
  $("#p-broch").onclick = () => printDoc(doc, "pieghevole");
  $("#p-ex").onclick = () => printDoc(doc, "esercizi");
  $("#exp").onclick = () => download(`${doc.id}.json`, JSON.stringify(doc, null, 1));
  if ($("#dup")) $("#dup").onclick = async () => { const t = prompt("Nome della copia", doc.titolo + " (copia)"); if (!t) return; const d = clone(doc); d.titolo = t; d.id = uniqueId(slug(t)); d.storico = [{ data: today(), testo: `Creato come copia di “${doc.titolo}”.`, fonte: "" }]; delete d._modificheLocali; await commit(d); go("doc/" + d.id + "/testi"); };
  if ($("#del")) $("#del").onclick = async () => { if (!confirm(`Eliminare definitivamente “${doc.titolo}”?\n(Consiglio: prima usa “Esporta” per tenerne una copia.)`)) return; if (MODE() === "admin") { try { await C().deleteDoc(doc.id); } catch (e) { return alert(e.message); } } await DB.del(doc.id); S.docs = S.docs.filter((d) => d.id !== doc.id); go(""); };
  const body = $("#tabbody");
  if (tab === "pieghevole") tabBrochure(body, doc);
  else if (tab === "esercizi-a4") tabBooklet(body, doc);
  else if (tab === "testi") tabEditTexts(body, doc);
  else if (tab === "esercizi") tabEditExercises(body, doc);
  else if (tab === "paziente") tabPatient(body, doc);
  else tabHistory(body, doc);
}

/* ---------- anteprime */
function tabBrochure(body, doc) {
  body.innerHTML = `<div id="ovf"></div><div class="preview-wrap"><div class="scaler">${brochureHTML(doc, true)}</div></div>
  <p class="muted" style="font-size:13px">Pagina 1 = esterno (copertina a destra), pagina 2 = interno. Stampa <b>fronte-retro, capovolgi sul lato corto</b>, poi piega in tre. Il testo si rimpicciolisce da solo per stare nelle ante; se un’anta è bordata di rosso il testo è troppo lungo: accorcialo o spostane una sezione.</p>`;
  afterImages(body).then(() => { const o = fitPanels(body, doc); $("#ovf").innerHTML = o.length ? `<div class="warnbox">⚠️ Testo troppo lungo in: <b>${o.map((k) => PANEL_NAMES[k]).join(", ")}</b>. Vai su “Modifica testi” per accorciare o spostare una sezione.</div>` : ""; scalePreviews(); });
  scalePreviews();
}
function tabBooklet(body, doc) {
  body.innerHTML = `<div class="preview-wrap"><div class="scaler" id="bk"></div></div>
  <p class="muted" style="font-size:13px">Opuscolo A4 verticale, si impagina da solo. Le foto e i link ai video si inseriscono in “Modifica esercizi”: per ogni video viene creato il QR code.</p>`;
  buildBooklet(doc, $("#bk"), true).then(scalePreviews);
}
function scalePreviews() {
  $$(".preview-wrap").forEach((w) => {
    const sc = $(".scaler", w); const first = $(".sheet", sc); if (!first) return;
    const k = Math.min(1, (w.clientWidth - 24) / first.offsetWidth);
    sc.style.transform = `scale(${k})`; sc.style.width = first.offsetWidth + "px";
    w.style.height = sc.scrollHeight * k + 24 + "px";
  });
}
function afterImages(el) { return Promise.all($$("img", el).map((i) => (i.complete ? 0 : i.decode().catch(() => 0)))); }

/* ---------- pieghevole: HTML */
function brochureHTML(doc, preview) {
  const P = (k, extra = "") => `<section class="panel ${k === "cover" ? "cover" : ""}" data-panel="${k}">${extra}${(doc.pannelli[k] || []).filter((b) => vis(b, doc)).map((b) => blockHTML(b, doc, preview)).join("")}${k === "e2" ? `<div class="footer-agg">${esc(S.settings.ente)} · ${esc(doc.titolo)} · aggiornato il ${fmtDate(doc.aggiornato)} (v.${doc.versione || 1})</div>` : ""}</section>`;
  const s = S.settings;
  const coverHead = `<div class="logos">${s.logoEnte ? `<img src="${esc(s.logoEnte)}" alt="${esc(s.ente)}">` : ""}${s.logoProgetto ? `<img class="proj" src="${esc(s.logoProgetto)}" alt="">` : ""}</div>
    <h1>${esc(doc.titolo)}</h1>${protoName(doc) ? `<p class="protocollo">Protocollo: ${esc(protoName(doc))}</p>` : ""}<p class="centro">${esc(s.centro)}</p><p class="progetto">${esc(s.progetto)}</p><div class="bar"></div>`;
  // piega "a portafoglio": l'aletta che si ripiega dentro (e1 / i3) è 3 mm più stretta
  const marks = (xs) => xs.map((x) => `<i class="fold" style="left:${x}mm"></i><i class="fold b" style="left:${x}mm"></i>`).join("");
  return `<div class="sheet land out">${P("e1")}${P("e2")}${P("cover", coverHead)}${marks([97, 197])}</div><div class="sheet land in">${P("i1")}${P("i2")}${P("i3")}${marks([100, 200])}</div>`;
}
/* disegno del tutore per patologia (se il blocco non ne ha uno proprio) */
const ORT_DIS = { "dito-a-scatto": "tutore-mf", "de-quervain": "spica", "tunnel-carpale": "tutore-polso", "tendini-estensori": "tutore-ifd",
  "tendini-flessori:kleinert": "kleinert", "tendini-flessori": "tutore-dorsale", "tfcc": "tutore-polso", "rizoartrosi": "spica", "frattura-radio-distale": "tutore-polso",
  "frattura-scafoide": "spica", "rigidita-ifp": "tutore-ifp", "rigidita-mf": "tutore-flessione-mf", "dupuytren": "tutore-ifp" };
const ortDis = (b, doc) => b.disegno || ORT_DIS[doc.id + ":" + (doc.protocollo || "")] || ORT_DIS[doc.id] || "";
function blockHTML(b, doc, preview) {
  const cls = "blk" + (preview && b._nuovo ? " nuovo" : "");
  const h = b.titolo ? `<h3>${esc(b.titolo)}</h3>` : "";
  if (b.tipo === "ortesi") {
    const c = b.campi || {}; const rows = [["Quale", c.tipo], ["Quando", c.quando], ["Quanto", c.quanto], ["Per quanto tempo", c.durata], ["Note", c.note]].filter((r) => r[1]);
    const od = ortDis(b, doc);
    return `<div class="${cls} box-ortesi">${od ? `<div class="ort-ill">${ill(od)}</div>` : ""}${h}<table>${rows.map((r) => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join("")}</table></div>`;
  }
  if (b.tipo === "personalizzate") { const t = b.paz || []; return `<div class="${cls} box-pers">${h}${t.map((x) => `<p class="paz">${esc(x)}</p>`).join("")}${'<div class="line"></div>'.repeat(t.length ? Math.max(1, (b.righe || 5) - t.length) : b.righe || 5)}</div>`; }
  if (b.tipo === "contatti") return `<div class="${cls} box-contatti">${h}${S.settings.contatti.map((c) => `<p><b>${esc(c.nome)}</b>Tel. ${esc(c.tel)}${c.orari ? " – " + esc(c.orari) : ""}</p>`).join("")}</div>`;
  if (b.tipo === "qr") {
    const ex = doc.esercizi.filter((e) => e.video && vis(e, doc));
    if (!ex.length) return `<div class="${cls}">${h}<p>Gli esercizi sono spiegati nell’<b>opuscolo esercizi</b> consegnato insieme a questa brochure.</p></div>`;
    return `<div class="${cls}">${h}<div class="qr-grid">${ex.slice(0, 9).map((e) => `<figure>${qrSvg(e.video)}<figcaption>${esc(e.nome)}</figcaption></figure>`).join("")}</div></div>`;
  }
  let img = !b.immagine ? "" : doc.immagine ? `<img class="cover-img" src="${esc(doc.immagine)}" alt="">` : doc.disegno ? `<div class="cover-ill">${ill(doc.disegno)}</div>` : "";
  if (b.disegno) img += `<div class="blk-ill">${ill(b.disegno)}</div>`;
  return `<div class="${cls}">${h}${b.testo ? `<p>${esc(b.testo)}</p>` : ""}${img}${b.punti && b.punti.length ? `<ul>${b.punti.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}${b.nota ? `<p class="nota">${esc(b.nota)}</p>` : ""}</div>`;
}
function qrSvg(text) {
  try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); } catch { return ""; }
}
/* riduce il carattere di ogni anta finché il testo ci sta (parte da un corpo pieno) */
function fitPanels(root, doc) {
  const over = [];
  if (doc) enrichPanels(root, doc);
  $$(".panel", root).forEach((p) => {
    let fs = 11.5; p.style.fontSize = fs + "pt"; p.classList.remove("overflow");
    while (p.scrollHeight > p.clientHeight + 1 && fs > 6.75) { fs -= 0.25; p.style.fontSize = fs + "pt"; }
    // se non entra, prima si toglie il disegno del tutore, poi si segnala
    if (p.scrollHeight > p.clientHeight + 1 && p.querySelector(".ort-ill")) { $$(".ort-ill", p).forEach((x) => x.parentNode.removeChild(x)); fs = 9.5; p.style.fontSize = fs + "pt"; while (p.scrollHeight > p.clientHeight + 1 && fs > 6.75) { fs -= 0.25; p.style.fontSize = fs + "pt"; } }
    if (p.scrollHeight > p.clientHeight + 1) { p.classList.add("overflow"); over.push(p.dataset.panel); }
  });
  return over;
}
/* spazio libero in fondo a un’anta (px) */
function freeSpace(p) {
  const cs = getComputedStyle(p); let bottom = parseFloat(cs.paddingTop);
  [...p.children].forEach((c) => { if (getComputedStyle(c).position !== "absolute") bottom = Math.max(bottom, c.offsetTop + c.offsetHeight + parseFloat(getComputedStyle(c).marginBottom || 0)); });
  return p.clientHeight - parseFloat(cs.paddingBottom) - bottom;
}
/* approfondimenti pertinenti a questo opuscolo */
function approFor(doc) {
  const txt = JSON.stringify([PANEL_ORDER.flatMap((k) => (doc.pannelli[k] || []).filter((b) => vis(b, doc))), (doc.esercizi || []).filter((e) => vis(e, doc))]).toLowerCase();
  return (window.APPROFONDIMENTI || []).filter((a) => !(a.escludi || []).includes(doc.id) && (a.sempre || new RegExp(a.chiavi, "i").test(txt))).sort((a, b) => (a.sempre ? 1 : 0) - (b.sempre ? 1 : 0));
}
const approHTML = (a, tag) => `<div class="${tag}"><h3>ℹ️ ${esc(a.titolo)}</h3><p>${esc(a.testo)}</p></div>`;
/* riempie gli spazi vuoti delle ante: prima approfondimenti, poi disegni degli esercizi */
function enrichPanels(root, doc) {
  $$(".auto-fig, .appro", root).forEach((x) => x.remove());
  const appro = approFor(doc); let ai = 0;
  const MM = 3.78; const seen = new Set();
  const cand = (doc.esercizi || []).filter((e) => vis(e, doc) && e.disegno && !e.foto).filter((e) => { const k = JSON.stringify(e.disegno); if (seen.has(k)) return false; seen.add(k); return true; });
  let ci = 0;
  for (const p of $$(".panel", root)) {
    p.style.fontSize = "11pt";
    if (p.dataset.panel === "cover") continue;
    while (p.scrollHeight > p.clientHeight + 1 && parseFloat(p.style.fontSize) > 6.75) p.style.fontSize = parseFloat(p.style.fontSize) - 0.25 + "pt";
    // approfondimenti (se uno non entra, prova il successivo)
    let tries = 0;
    while (ai < appro.length && tries < 4 && freeSpace(p) > 26 * MM) {
      const t = document.createElement("div"); t.innerHTML = approHTML(appro[ai], "blk appro"); const el = t.firstElementChild;
      p.insertBefore(el, p.querySelector(".footer-agg"));
      if (p.scrollHeight > p.clientHeight + 1) { el.remove(); const [x] = appro.splice(ai, 1); appro.push(x); tries++; } else { ai++; tries = 0; }
    }
    let guard = 0;
    while (ci < cand.length && guard++ < 4 && freeSpace(p) > 34 * MM) {
      const e = cand[ci]; const seq = Array.isArray(window.RH_ILL.risolvi(e.disegno)) && window.RH_ILL.risolvi(e.disegno).length > 1;
      const fig = document.createElement("div"); fig.className = "blk auto-fig" + (seq ? " seq" : "");
      fig.innerHTML = `${ill(e.disegno)}<p class="cap">${esc(e.nome)}</p>`;
      p.insertBefore(fig, p.querySelector(".footer-agg"));
      if (p.scrollHeight > p.clientHeight + 1) { fig.remove(); break; }
      ci++;
    }
  }
}

/* consiglio pratico per eseguire bene l’esercizio (in base al tipo di esercizio) */
const CONSIGLI = [
  [/^gliding/, "Passa da una posizione all’altra lentamente e fermati 2–3 secondi in ognuna; il polso resta dritto."],
  [/^pugno-apri/, "Apri le dita fino in fondo e chiudi il pugno senza stringere forte."],
  [/^polso/, "Appoggia bene l’avambraccio e muovi solo il polso, lentamente e senza slancio."],
  [/^deviazioni/, "Fai scivolare la mano sul tavolo senza sollevarla e senza ruotare l’avambraccio."],
  [/^pronosupinazione/, "Tieni il gomito attaccato al fianco: così ruota solo l’avambraccio."],
  [/^(ventaglio|elastico)/, "Apri le dita lentamente, tieni un attimo la posizione e torna con controllo."],
  [/^(opposizione|pinch)/, "Forma una “O” rotonda: le punte delle dita si toccano senza schiacciare."],
  [/^pollice/, "Muovi solo il pollice: il resto della mano rimane appoggiato e rilassato."],
  [/^(rotazione-pallina|pallina)/, "Fai ruotare la pallina con le dita tenendo la mano rilassata: non va mai stretta."],
  [/^presa/, "Impugna l’oggetto con delicatezza, senza stringere forte."],
  [/^cicatrice/, "Solo a ferita chiusa: crema neutra, pressione decisa ma sopportabile, piccoli cerchi."],
  [/^elevazione/, "La mano deve stare più in alto del cuore, sostenuta da un cuscino."],
  [/^blocking/, "Tieni ben ferma con l’altra mano la parte sotto: deve muoversi solo l’articolazione indicata."],
  [/^(estensione|flessione)-ifp/, "Vai lentamente fino al limite senza dolore e mantieni la posizione 3–5 secondi."],
  [/^(kleinert|place-hold|tenodesi|tutore-dorsale)/, "Sempre dentro il tutore e senza forza: segui esattamente le istruzioni del terapista."],
  [/^(tutore|spica)/, "Ogni volta che togli il tutore controlla la pelle: niente arrossamenti che durano."],
  [/^(lateralita|immaginazione|specchio)/, "Scegli un luogo tranquillo; se il dolore aumenta fermati e riprova più tardi."],
  [/^desensibilizzazione/, "Passa al materiale successivo solo quando il fastidio è diminuito."],
  [/^carico/, "Aumenta il peso sulla mano molto gradualmente; fermati se il dolore aumenta."],
  [/mf$|^(flessione|blocking)-mf/, "Il movimento parte dalla base delle dita: piega bene le nocche."],
  [/^mano-tavolo/, "Mano rilassata e ben appoggiata, spalle sciolte."],
];
const consiglio = (e) => { const k = typeof e.disegno === "string" ? e.disegno : ""; const c = CONSIGLI.find(([rx]) => rx.test(k)); return c ? c[1] : "Esegui lentamente, con movimenti completi e senza provocare dolore."; };
/* scheda esercizio: figure con il passo accanto/sotto, poi raccomandazioni */
function exerciseCard(e, n, preview) {
  const hasFoto = !!e.foto;
  const frames = !hasFoto && e.disegno ? window.RH_ILL.risolvi(e.disegno) || [] : [];
  const passi = e.passi || [];
  const head = `<div class="ex-h"><h4><span class="n">${n}</span>${esc(e.nome)}</h4>${e.obiettivo ? `<p class="ob">${esc(e.obiettivo)}</p>` : ""}</div>`;
  const pos = e.posizione ? `<p class="pos"><b>Posizione di partenza:</b> ${esc(e.posizione)}</p>` : "";
  const qr = e.video ? `<div class="qr">${qrSvg(e.video)}video</div>` : "";
  const reco = `<div class="ex-r">${e.dosaggio ? `<span class="dose">⏱ ${esc(e.dosaggio)}</span>` : ""}${e.attenzione ? `<span class="att">⚠ ${esc(e.attenzione)}</span>` : ""}<span class="tip">💡 ${esc(consiglio(e))}</span></div>`;
  const fig = (o) => window.RH_ILL.one(o);
  let body;
  if (frames.length >= 3 && passi.length === frames.length) {
    // sequenza: ogni figura con il suo passo scritto sotto
    body = `${qr}${pos}<div class="ex-steps">${frames.map((o, i) => `<figure><div class="f">${fig(o)}</div><figcaption><b>${i + 1}</b> ${esc(passi[i])}</figcaption></figure>`).join("")}</div>`;
  } else if (frames.length >= 3) {
    body = `${qr}<div class="ex-steps lab">${frames.map((o, i) => `<figure><div class="f">${fig(o)}</div><figcaption><b>${i + 1}</b> ${esc(o.label || "")}</figcaption></figure>`).join("")}</div>${pos}${passi.length ? `<p class="come"><b>Come si fa</b></p><ol class="cols">${passi.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}`;
  } else {
    // una o due figure a sinistra, istruzioni a destra
    const media = hasFoto ? `<div class="ph" style="background-image:url('${e.foto}')"></div>` : frames.length ? frames.map((o) => `<figure><div class="f">${fig(o)}</div>${o.label ? `<figcaption>${esc(o.label)}</figcaption>` : ""}</figure>`).join("") : preview ? `<div class="ph">foto o disegno<br>non inseriti</div>` : "";
    body = `<div class="ex-side ${media ? "" : "nomedia"} ${frames.length === 2 ? "two" : ""}">${media ? `<div class="ex-media">${media}</div>` : ""}<div class="ex-txt">${qr}${pos}${passi.length ? `<p class="come"><b>Come si fa</b></p><ol>${passi.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}</div></div>`;
  }
  return `<div class="ex2">${head}${body}${reco}</div>`;
}

/* ---------- opuscolo esercizi A4 */
async function buildBooklet(doc, target, preview) {
  const s = S.settings;
  target.innerHTML = "";
  const pages = [];
  const newPage = () => {
    const pg = document.createElement("div"); pg.className = "sheet port";
    pg.innerHTML = `<div class="bk-head">${s.logoEnte ? `<img src="${esc(s.logoEnte)}" alt="">` : ""}${s.logoProgetto ? `<img src="${esc(s.logoProgetto)}" alt="" style="max-height:11mm">` : ""}<div class="t"><b>${esc(doc.titolo)}</b>${esc(s.centro)} · ${esc(s.progetto)}</div></div><div class="bk-body"></div><div class="bk-foot"><span>${esc(s.ente)} · Opuscolo esercizi · aggiornato il ${fmtDate(doc.aggiornato)} (v.${doc.versione || 1})</span><span class="pn"></span></div>`;
    target.appendChild(pg); pages.push(pg); return $(".bk-body", pg);
  };
  let body = newPage();
  const fits = () => body.scrollHeight <= body.clientHeight + 1;
  // consigli della patologia, usati per riempire gli spazi vuoti a fine pagina
  const tips = []; const tipSeen = new Set();
  const TIPRX = /fare|evitare|regol|consigl|educazion|allarm|attenzion|ricorda|prevenzion|important|proteggi|ogni giorno|ritmo|gonfiore|edema|primi giorni|da subito|post-operatorio/i;
  const NOTIP = /sintom|chirurg|opzion|zone|intervento|quando si opera|cos[’']?è|cosa sono|trattamenti$|segni da|cosa si nota|perch/i;
  const pushTips = (ok) => PANEL_ORDER.forEach((k) => (doc.pannelli[k] || []).filter((b) => vis(b, doc) && !b.tipo && b.punti && b.punti.length && ok(b.titolo || "")).forEach((b) => b.punti.forEach((t) => { if (!tipSeen.has(t)) { tipSeen.add(t); tips.push(t); } })));
  pushTips((t) => TIPRX.test(t)); pushTips((t) => !NOTIP.test(t));
  (s.regoleEsercizi || []).forEach((t) => { if (!tipSeen.has(t)) tips.push(t); });
  let tipI = 0;
  const usedH = () => { let m = 0; [...body.children].forEach((c) => (m = Math.max(m, c.offsetTop - body.offsetTop + c.offsetHeight))); return m; };
  const appro = approFor(doc); let apI = 0;
  const fillGap = () => {
    let tries = 0;
    while (apI < appro.length && tries < 4 && body.clientHeight - usedH() > body.clientHeight * 0.1) {
      const t = document.createElement("div"); t.innerHTML = approHTML(appro[apI], "bk-appro"); const el = t.firstElementChild; body.appendChild(el);
      if (!fits()) { el.remove(); const [x] = appro.splice(apI, 1); appro.push(x); tries++; } else { apI++; tries = 0; }
    }
    if (body.clientHeight - usedH() < body.clientHeight * 0.1 || tipI >= tips.length) return;
    const box = document.createElement("div"); box.className = "bk-tip"; box.innerHTML = `<h4>💡 Ricorda</h4><ul></ul>`; body.appendChild(box);
    const ul = $("ul", box); let added = 0;
    while (tipI < tips.length) { const li = document.createElement("li"); li.textContent = tips[tipI]; ul.appendChild(li); if (!fits()) { li.remove(); break; } tipI++; added++; }
    if (!added) box.remove();
  };
  const add = (html, keepWithNext) => {
    const t = document.createElement("div"); t.innerHTML = html; const el = t.firstElementChild;
    body.appendChild(el);
    if (!fits() && body.children.length > 1) {
      if (el.classList.contains("ex2")) { el.classList.add("compact"); if (fits()) return el; el.classList.remove("compact"); }
      body.removeChild(el); fillGap(); body = newPage(); body.appendChild(el);
    }
    return el;
  };
  const faseInfo = (f) => { const d = (x) => (String(x || "").match(/\d+\s*[–-]\s*\d+/) || [""])[0].replace(/\s/g, "").replace("-", "–"); const k = d(f);
    return PANEL_ORDER.flatMap((x) => doc.pannelli[x] || []).find((b) => vis(b, doc) && b.titolo && (norm(b.titolo) === norm(f) || (k && d(b.titolo) === k)) && (b.testo || b.punti)); };
  const intro = (doc.pannelli.cover || []).find((b) => b.testo);
  const ort = PANEL_ORDER.flatMap((k) => doc.pannelli[k] || []).find((b) => b.tipo === "ortesi" && vis(b, doc));
  const oc = (ort && ort.campi) || {};
  add(`<div><h1 class="bk-title">Esercizi a casa</h1><p class="bk-sub">${esc(doc.titolo)}${protoName(doc) ? ` · Protocollo: ${esc(protoName(doc))}` : ""}</p></div>`);
  if (intro) add(`<div class="bk-intro">${intro.titolo ? `<b>${esc(intro.titolo)}</b>` : ""}<p>${esc(intro.testo)}</p></div>`);
  add(`<div class="bk-rules"><div><h4>Regole generali</h4><ul>${(s.regoleEsercizi || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>
       <div><h4>Ortesi</h4>${ort ? `<ul>${[["Quale", oc.tipo], ["Quando", oc.quando], ["Quanto", oc.quanto], ["Per quanto", oc.durata]].filter((r) => r[1]).map((r) => `<li><b>${r[0]}:</b> ${esc(r[1])}</li>`).join("")}</ul>` : "<p>Nessuna ortesi prevista, salvo diversa indicazione.</p>"}</div></div>`);
  await afterImages(target);
  let fase = null, n = 0, pendingHead = null;
  for (const e of doc.esercizi.filter((x) => vis(x, doc))) {
    if (e.fase !== fase) { fase = e.fase; const fi = faseInfo(fase); const ob = fi ? (fi.testo || "") + (fi.punti && fi.punti.length ? (fi.testo ? " " : "Obiettivi: ") + fi.punti.slice(0, 4).join(" · ") : "") : "";
      pendingHead = add(`<div class="bk-fase">${esc(fase || "Esercizi")}${ob ? `<small>${esc(ob.length > 260 ? ob.slice(0, 257) + "…" : ob)}</small>` : ""}</div>`); }
    n++;
    const card = exerciseCard(e, n, preview);
    const before = body;
    const el = add(card);
    // il titolo della fase non resta da solo in fondo alla pagina
    if (pendingHead && el.parentElement !== before && pendingHead.parentElement === before) { before.removeChild(pendingHead); body.insertBefore(pendingHead, el); }
    pendingHead = null;
  }
  if (doc.bibliografia && doc.bibliografia.length) add(`<div class="bk-refs"><b>Riferimenti bibliografici</b><ol>${doc.bibliografia.map((r) => `<li>${esc(r.testo)}</li>`).join("")}</ol></div>`);
  fillGap();
  add(`<div class="bk-notes"><h4>Note del fisioterapista</h4>${(doc._pazNote || []).map((x) => `<p class="paz">${esc(x)}</p>`).join("")}${'<div class="line"></div>'.repeat(doc._pazNote && doc._pazNote.length ? 2 : 4)}
    <table class="bk-diary"><tr><th>Diario esercizi – settimana</th>${["L", "M", "M", "G", "V", "S", "D"].map((g) => `<th>${g}</th>`).join("")}</tr>${'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(3)}</table></div>`);
  add(`<div class="bk-notes"><h4>Contatti</h4>${s.contatti.map((c) => `<p style="margin:0 0 1mm"><b>${esc(c.nome)}</b> – Tel. ${esc(c.tel)}${c.orari ? " – " + esc(c.orari) : ""}</p>`).join("")}</div>`);
  // ultima pagina: se avanza spazio, il diario si allunga con altre settimane
  const diary = $(".bk-diary", pages[pages.length - 1]);
  if (diary) for (let k = 0; k < 40 && fits(); k++) { const tr = diary.insertRow(-1); tr.innerHTML = "<td></td>".repeat(8); if (!fits()) { tr.remove(); break; } }
  pages.forEach((p, i) => ($(".pn", p).textContent = `Pag. ${i + 1} di ${pages.length}`));
  return pages.length;
}

/* ---------- stampa */
async function printDoc(doc, kind) {
  const root = $("#print-root");
  root.innerHTML = "";
  const land = kind === "pieghevole";
  $("#page-style").textContent = `@page{size:A4 ${land ? "landscape" : "portrait"};margin:0}`;
  if (land) { root.innerHTML = brochureHTML(doc, false); await afterImages(root); const o = fitPanels(root, doc); if (o.length && !confirm("Attenzione: in alcune ante il testo è troppo lungo e verrà tagliato:\n" + o.map((k) => "• " + PANEL_NAMES[k]).join("\n") + "\n\nStampare comunque?")) { root.innerHTML = ""; return; } }
  else await buildBooklet(doc, root, false);
  await afterImages(root);
  const oldTitle = document.title;
  document.title = `${doc.id}_${land ? "pieghevole" : "esercizi"}_${doc.aggiornato}`;
  const done = () => { document.title = oldTitle; root.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 50);
}

const protoBoxes = (item, path, doc) => !doc.protocolli || !doc.protocolli.length ? "" : `<div class="f" style="font-size:12px;font-weight:600;color:var(--mut);margin-top:6px">Vale per il protocollo: ${doc.protocolli.map((p) => `<label style="font-weight:400;margin-right:10px;white-space:nowrap"><input type="checkbox" data-proto="${path}" value="${esc(p.id)}" ${!item.protocolli || item.protocolli.includes(p.id) ? "checked" : ""}> ${esc(p.nome)}</label>`).join("")}</div>`;
async function onProtoBox(e, doc) {
  const el = e.target; if (!el.dataset || !el.dataset.proto) return false;
  const item = getPath(doc, el.dataset.proto); const all = doc.protocolli.map((p) => p.id);
  const sel = $$(`input[data-proto="${el.dataset.proto}"]`).filter((c) => c.checked).map((c) => c.value);
  if (sel.length === all.length) delete item.protocolli; else item.protocolli = sel;
  autosave(doc); return true;
}
/* ---------- personalizzazione per il singolo paziente (non modifica la brochure) */
const PERS_DEFAULT = [
  { id: "edema", nome: "Gonfiore importante", testo: "Gonfiore importante: tieni la mano sollevata sopra il cuore più volte al giorno e muovi le dita ogni ora; bendaggio o guanto compressivo solo se indicato.", attenzione: "", esercizio: "elevazione" },
  { id: "dolore", nome: "Dolore elevato", testo: "Dolore elevato: esegui gli esercizi con ampiezza e ripetizioni ridotte; fermati se il dolore supera 3–4 su 10.", attenzione: "Con dolore: riduci ampiezza e ripetizioni." },
  { id: "diabete", nome: "Diabete", testo: "Diabete: la guarigione può essere più lenta e la rigidità maggiore. Sii costante con gli esercizi e controlla ogni giorno la pelle sotto l’ortesi.", attenzione: "" },
  { id: "manuale", nome: "Lavoro manuale / pesante", testo: "Lavoro manuale: il ritorno al lavoro va graduale, con pause frequenti; prese forti e carichi solo con il via libera.", attenzione: "" },
  { id: "anziano", nome: "Persona anziana / fragile", testo: "Esegui gli esercizi con calma, seduto, anche con l’aiuto di un familiare; meglio pochi minuti più volte al giorno.", attenzione: "" },
  { id: "pelle", nome: "Pelle fragile o sensibilità ridotta", testo: "Pelle fragile o poco sensibile: controlla la pelle a ogni rimozione dell’ortesi; arrossamenti che non passano in 20 minuti vanno segnalati.", attenzione: "" },
  { id: "fumo", nome: "Fumatore", testo: "Il fumo rallenta la guarigione di ossa, tendini e ferite: ridurlo o sospenderlo aiuta il recupero.", attenzione: "" },
  { id: "aderenza", nome: "Fatica a seguire il programma", testo: "Programma ridotto: fai solo gli esercizi indicati, ma tutti i giorni. Usa il diario in fondo all’opuscolo.", attenzione: "" }
];
const persList = () => (S.settings.personalizzazioni && S.settings.personalizzazioni.length ? S.settings.personalizzazioni : PERS_DEFAULT);
S.paz = {}; // solo in memoria, per sessione: nulla viene salvato
const addDays = (iso, d) => { const t = new Date(iso + "T12:00:00"); t.setDate(t.getDate() + d); return t; };
const dm = (t) => t.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
function withDates(title, iso) {
  if (!iso || !title || !/settiman/i.test(title) || /\(dal /.test(title)) return title;
  const m = title.match(/(\d+)\s*[–-]\s*(\d+)/); if (m) return `${title} (dal ${dm(addDays(iso, +m[1] * 7))} al ${dm(addDays(iso, +m[2] * 7))})`;
  const m2 = title.match(/dalla?\s+(\d+)/i); if (m2) return `${title} (dal ${dm(addDays(iso, +m2[1] * 7))})`;
  return title;
}
function personalize(doc, P) {
  const d = clone(doc);
  const mods = persList().filter((m) => P.mods && P.mods[m.id]);
  const righe = [];
  if (P.lato) righe.push("Mano: " + P.lato + (P.dominante ? " (dominante)" : ""));
  if (P.dataInt) righe.push("Intervento / inizio trattamento: " + new Date(P.dataInt + "T12:00:00").toLocaleDateString("it-IT"));
  lines(P.testo).forEach((x) => righe.push(x));
  mods.forEach((m) => righe.push(m.testo));
  if (P.controllo) righe.push("Prossimo controllo: " + P.controllo);
  // riquadro personalizzato: se non c’è nelle ante visibili, lo aggiungo sul retro
  let pers = PANEL_ORDER.flatMap((k) => d.pannelli[k] || []).filter((b) => vis(b, d)).find((b) => b.tipo === "personalizzate");
  if (!pers && righe.length) { pers = { id: "personalizzate", tipo: "personalizzate", titolo: "Indicazioni personalizzate", righe: 3 }; (d.pannelli.e2 = d.pannelli.e2 || []).unshift(pers); }
  if (pers) pers.paz = righe;
  d._pazNote = righe;
  // ortesi
  PANEL_ORDER.forEach((k) => (d.pannelli[k] || []).forEach((b) => { if (b.tipo === "ortesi" && vis(b, d) && P.ortesi) b.campi = Object.assign({}, b.campi, P.ortesi); }));
  // date sulle fasi
  if (P.dataInt) { PANEL_ORDER.forEach((k) => (d.pannelli[k] || []).forEach((b) => (b.titolo = withDates(b.titolo, P.dataInt)))); d.esercizi.forEach((e) => (e.fase = withDates(e.fase, P.dataInt))); }
  // esercizi
  d.esercizi = d.esercizi.filter((e) => !(P.escludi && P.escludi[e.id])).map((e) => { const x = Object.assign({}, e); if (P.dosi && P.dosi[e.id]) x.dosaggio = P.dosi[e.id]; mods.forEach((m) => { if (m.attenzione) x.attenzione = x.attenzione ? x.attenzione + " " + m.attenzione : m.attenzione; }); return x; });
  mods.forEach((m) => { if (m.esercizio && window.RH_ILL.LIB[m.esercizio] && !d.esercizi.some((e) => e.id === "paz-" + m.id)) d.esercizi.unshift({ id: "paz-" + m.id, fase: "Per te", nome: window.RH_ILL.LIB[m.esercizio].nome, obiettivo: m.testo, posizione: "", passi: [], dosaggio: "Più volte al giorno", attenzione: "", disegno: m.esercizio }); });
  return d;
}
function tabPatient(body, doc) {
  const P = (S.paz[doc.id] = S.paz[doc.id] || { mods: {}, escludi: {}, dosi: {} });
  const ort = PANEL_ORDER.flatMap((k) => doc.pannelli[k] || []).find((b) => b.tipo === "ortesi" && vis(b, doc));
  if (ort && !P.ortesi) P.ortesi = Object.assign({}, ort.campi);
  const exs = doc.esercizi.filter((e) => vis(e, doc));
  body.innerHTML = `<div class="paz-grid"><div class="paz-form">
    <div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6;margin-top:0">👤 Personalizza la stampa per <b>questo paziente</b>. La brochure ufficiale <b>non cambia</b> e qui non viene salvato nulla: chiudendo la pagina tutto si azzera.<br><small>Non scrivere nome o dati identificativi: puoi aggiungerli a penna sulla stampa.</small></div>
    <label class="f">Particolarità del paziente / indicazioni (una per riga)<textarea id="pz-testo" rows="4" placeholder="es. Evitare carichi con la mano destra fino al controllo">${esc(P.testo || "")}</textarea></label>
    <div class="row"><label class="f" style="flex:1">Mano<select id="pz-lato"><option value="">—</option><option ${P.lato === "destra" ? "selected" : ""}>destra</option><option ${P.lato === "sinistra" ? "selected" : ""}>sinistra</option></select></label>
      <label class="f" style="display:flex;gap:6px;align-items:center;margin-top:22px"><input type="checkbox" id="pz-dom" ${P.dominante ? "checked" : ""}> dominante</label></div>
    <div class="row"><label class="f" style="flex:1">Data intervento / inizio<input type="date" id="pz-data" value="${esc(P.dataInt || "")}"></label><label class="f" style="flex:1">Prossimo controllo<input id="pz-ctrl" value="${esc(P.controllo || "")}" placeholder="es. 3 dicembre, ore 10"></label></div>
    <p class="muted" style="font-size:12px;margin:2px 0 0">Con la data, accanto a ogni fase (“Settimane 0–4”…) compaiono le date reali.</p>
    <h3 style="margin:14px 0 4px;font-size:15px">Caratteristiche del paziente</h3>
    <div class="paz-mods">${persList().map((m) => `<label title="${esc(m.testo)}"><input type="checkbox" data-mod="${m.id}" ${P.mods[m.id] ? "checked" : ""}> ${esc(m.nome)}</label>`).join("")}</div>
    ${ort ? `<h3 style="margin:14px 0 4px;font-size:15px">Ortesi per questo paziente</h3>${[["tipo", "Quale"], ["quando", "Quando"], ["quanto", "Quanto"], ["durata", "Per quanto tempo"], ["note", "Note"]].map(([k, l]) => `<label class="f">${l}<input data-ort="${k}" value="${esc((P.ortesi || {})[k] || "")}"></label>`).join("")}` : ""}
    <h3 style="margin:14px 0 4px;font-size:15px">Esercizi da consegnare</h3>
    <div class="paz-ex">${exs.map((e) => `<div class="row" style="align-items:flex-start;gap:6px;border-bottom:1px solid var(--bd);padding:5px 0"><input type="checkbox" data-ex="${esc(e.id)}" ${P.escludi[e.id] ? "" : "checked"} style="margin-top:4px"><div style="flex:1"><b style="font-size:14px">${esc(e.nome)}</b><br><input data-dose="${esc(e.id)}" value="${esc(P.dosi[e.id] || e.dosaggio || "")}" style="width:100%;padding:4px 8px;border:1px solid var(--bd);border-radius:6px;font-size:13px" placeholder="ripetizioni / volte al giorno"></div></div>`).join("")}</div>
    <div class="row" style="margin-top:12px"><button class="btn" id="pz-pb">🖨 Stampa pieghevole</button><button class="btn" id="pz-pe">🖨 Stampa esercizi</button><button class="btn red small" id="pz-reset">Azzera</button></div>
  </div><div class="paz-prev"><div class="tabs" style="margin-bottom:6px"><button class="on" data-pv="b">Pieghevole</button><button data-pv="e">Esercizi</button></div><div class="preview-wrap"><div class="scaler" id="pz-sc"></div></div></div></div>`;
  let which = "b", t;
  const draw = async () => { const d = personalize(doc, P); const sc = $("#pz-sc"); if (which === "b") { sc.innerHTML = brochureHTML(d, false); await afterImages(sc); fitPanels(sc, d); } else await buildBooklet(d, sc, false); scalePreviews(); };
  const upd = () => { clearTimeout(t); t = setTimeout(draw, 250); };
  const onEdit = (e) => {
    const el = e.target;
    if (el.id === "pz-testo") P.testo = el.value; else if (el.id === "pz-ctrl") P.controllo = el.value; else if (el.id === "pz-data") P.dataInt = el.value; else if (el.id === "pz-lato") P.lato = el.value; else if (el.id === "pz-dom") P.dominante = el.checked;
    else if (el.dataset.mod) P.mods[el.dataset.mod] = el.checked; else if (el.dataset.ort) P.ortesi[el.dataset.ort] = el.value;
    else if (el.dataset.ex) P.escludi[el.dataset.ex] = !el.checked; else if (el.dataset.dose) P.dosi[el.dataset.dose] = el.value; else return;
    upd();
  };
  body.addEventListener("input", onEdit); body.addEventListener("change", onEdit);
  $$("[data-pv]", body).forEach((b) => (b.onclick = () => { which = b.dataset.pv; $$("[data-pv]", body).forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  $("#pz-pb").onclick = () => printDoc(personalize(doc, P), "pieghevole");
  $("#pz-pe").onclick = () => printDoc(personalize(doc, P), "esercizi");
  $("#pz-reset").onclick = () => { delete S.paz[doc.id]; tabPatient(body, doc); };
  draw();
}

/* ---------- editor testi */
function markEdited(doc) {
  if (!S.edited.has(doc.id)) {
    S.edited.add(doc.id);
    doc.versione = (doc.versione || 1) + 1; doc.aggiornato = today();
    doc.storico = doc.storico || []; doc.storico.push({ data: today(), testo: "Modifiche manuali ai testi.", fonte: "" });
  }
}
let saveTimer;
function autosave(doc) { clearTimeout(saveTimer); const sv = $("#saved"); if (sv) sv.textContent = "…"; saveTimer = setTimeout(async () => { markEdited(doc); await commit(doc); if ($("#saved")) $("#saved").textContent = "✓ Salvato"; }, 500); }
function bindInputs(root, doc) {
  root.addEventListener("input", (e) => {
    const el = e.target; const p = el.dataset.bind; if (!p) return;
    let val = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.kind === "lines") val = lines(val);
    setPath(doc, p, val); autosave(doc);
  });
}
function tabEditTexts(body, doc) {
  const blockForm = (b, k, i) => {
    const base = `pannelli.${k}.${i}`;
    const auto = ["contatti", "qr"].includes(b.tipo);
    const ctl = `<div class="head"><b>${esc(b.titolo || (b.tipo ? b.tipo : "Sezione senza titolo"))}</b>
      <button class="iconbtn" data-act="up" title="Su">↑</button><button class="iconbtn" data-act="down" title="Giù">↓</button>
      <select class="iconbtn" data-act="move" title="Sposta in un’altra anta"><option value="">Sposta…</option>${PANEL_ORDER.filter((x) => x !== k).map((x) => `<option value="${x}">${PANEL_NAMES[x]}</option>`).join("")}</select>
      <button class="iconbtn" data-act="del" title="Elimina" style="color:var(--rosso)">✕</button></div>`;
    let f = `<label class="f">Titolo<input data-bind="${base}.titolo" value="${esc(b.titolo || "")}"></label>`;
    if (b.tipo === "ortesi") {
      const c = b.campi || {};
      f += [["tipo", "Quale ortesi"], ["quando", "Quando portarla"], ["quanto", "Quanto (ore al giorno / giorno e notte)"], ["durata", "Per quanto tempo (settimane)"], ["note", "Note"]].map(([kk, l]) => `<label class="f">${l}<input data-bind="${base}.campi.${kk}" value="${esc(c[kk] || "")}"></label>`).join("");
    } else if (b.tipo === "personalizzate") {
      f += `<label class="f">Numero di righe vuote<input type="number" min="1" max="15" data-bind="${base}.righe" value="${b.righe || 5}"></label>`;
    } else if (auto) {
      f += `<p class="muted" style="font-size:13px">${b.tipo === "contatti" ? "I contatti si modificano una volta sola in ⚙︎ Impostazioni e valgono per tutti gli opuscoli." : "I QR code vengono creati dai link video inseriti in “Modifica esercizi”."}</p>`;
    } else {
      f += `<label class="f">Testo<textarea data-bind="${base}.testo">${esc(b.testo || "")}</textarea></label>
        <label class="f">Elenco puntato (una voce per riga)<textarea data-kind="lines" data-bind="${base}.punti" rows="${Math.max(3, (b.punti || []).length + 1)}">${esc((b.punti || []).join("\n"))}</textarea></label>
        <label class="f">Nota finale (corsivo)<textarea data-bind="${base}.nota" rows="2">${esc(b.nota || "")}</textarea></label>
        <label class="f" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-bind="${base}.immagine" ${b.immagine ? "checked" : ""}> Mostra qui l’immagine della copertina</label>`;
    }
    return `<div class="ed-block ${b.tipo === "ortesi" ? "t-ortesi" : auto ? "t-auto" : ""}" data-k="${k}" data-i="${i}">${ctl}${f}${protoBoxes(b, base, doc)}</div>`;
  };
  body.innerHTML = `
    <div class="ed-panel" style="padding:12px 14px">
      <label class="f">Titolo dell’opuscolo<input data-bind="titolo" value="${esc(doc.titolo)}"></label>
      <label class="f">Categoria<input data-bind="categoria" value="${esc(doc.categoria || "")}" list="cats"></label>
      <datalist id="cats">${[...new Set(S.docs.map((d) => d.categoria).filter(Boolean))].map((c) => `<option>${esc(c)}</option>`).join("")}</datalist>
      <label class="f">Immagine di copertina</label>
      <div class="row"><label class="photo-slot ${doc.immagine ? "has" : ""}" style="background-image:${doc.immagine ? `url('${esc(doc.immagine)}')` : "none"}">${doc.immagine ? "" : "Tocca per<br>inserire"}<input type="file" accept="image/*" id="cover-img"></label>
      ${doc.immagine ? `<button class="iconbtn" id="rm-cover">Rimuovi immagine</button>` : ""}</div>
    </div>
    ${PANEL_ORDER.map((k) => `<details class="ed-panel" ${k === "cover" ? "open" : ""}><summary>${PANEL_NAMES[k]}</summary><div class="body">
      ${(doc.pannelli[k] || []).map((b, i) => blockForm(b, k, i)).join("")}
      <div class="row"><button class="btn small light" data-add="${k}" data-type="">＋ Sezione di testo</button><button class="btn small light" data-add="${k}" data-type="ortesi">＋ Ortesi</button><button class="btn small light" data-add="${k}" data-type="personalizzate">＋ Indicazioni personalizzate</button><button class="btn small light" data-add="${k}" data-type="qr">＋ QR video</button><button class="btn small light" data-add="${k}" data-type="contatti">＋ Contatti</button></div>
    </div></details>`).join("")}`;
  bindInputs(body, doc);
  const rerender = async () => { markEdited(doc); await commit(doc); const open = $$("details", body).map((d) => d.open); tabEditTexts(body, doc); $$("details", body).forEach((d, i) => (d.open = open[i])); };
  body.addEventListener("click", async (e) => {
    const add = e.target.closest("[data-add]");
    if (add) { const k = add.dataset.add, t = add.dataset.type; const nb = { id: (t || "sez") + "-" + Date.now().toString(36), titolo: { ortesi: "Ortesi (tutore)", personalizzate: "Indicazioni personalizzate", qr: "Esercizi – QR code video", contatti: "Contattaci" }[t] || "Nuova sezione" }; if (t) nb.tipo = t; if (t === "ortesi") nb.campi = { tipo: "", quando: "", quanto: "", durata: "", note: "" }; if (!t) nb.punti = []; (doc.pannelli[k] = doc.pannelli[k] || []).push(nb); return rerender(); }
    const act = e.target.closest("[data-act]"); if (!act || act.tagName === "SELECT") return;
    const blk = act.closest(".ed-block"); const k = blk.dataset.k, i = +blk.dataset.i; const arr = doc.pannelli[k];
    if (act.dataset.act === "up" && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (act.dataset.act === "down" && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    else if (act.dataset.act === "del") { if (!confirm("Eliminare questa sezione?")) return; arr.splice(i, 1); }
    else return;
    rerender();
  });
  body.addEventListener("change", async (e) => {
    if (await onProtoBox(e, doc)) return;
    if (e.target.dataset.act === "move" && e.target.value) { const blk = e.target.closest(".ed-block"); const [b] = doc.pannelli[blk.dataset.k].splice(+blk.dataset.i, 1); (doc.pannelli[e.target.value] = doc.pannelli[e.target.value] || []).push(b); rerender(); }
    if (e.target.id === "cover-img" && e.target.files[0]) { doc.immagine = await imageToDataUrl(e.target.files[0]); rerender(); }
  });
  if ($("#rm-cover")) $("#rm-cover").onclick = () => { doc.immagine = ""; rerender(); };
}

/* ---------- editor esercizi */
function tabEditExercises(body, doc) {
  const fasi = [...new Set(doc.esercizi.map((e) => e.fase).filter(Boolean))];
  body.innerHTML = `<p class="muted">Gli esercizi compaiono nell’opuscolo A4 nello stesso ordine, raggruppati per fase. Se inserisci il link di un video (YouTube, Drive…) viene generato il QR code sia nell’opuscolo che nel pieghevole.</p>
    <datalist id="fasi">${fasi.map((f) => `<option>${esc(f)}</option>`).join("")}</datalist>
    ${doc.esercizi.map((e, i) => `<div class="ed-block" data-i="${i}"><div class="head"><b>${i + 1}. ${esc(e.nome)}</b>
      <button class="iconbtn" data-act="up">↑</button><button class="iconbtn" data-act="down">↓</button><button class="iconbtn" data-act="del" style="color:var(--rosso)">✕</button></div>
      <div class="ed-ex"><div><label class="photo-slot ${e.foto ? "has" : ""}" style="background-image:${e.foto ? `url('${e.foto}')` : "none"}">${e.foto ? "" : e.disegno ? `<span class="mini-ill">${ill(e.disegno)}</span>` : "Tocca per<br>inserire foto"}<input type="file" accept="image/*" data-photo="${i}"></label>${e.foto ? `<button class="iconbtn" data-act="rmfoto" style="margin-top:4px">Rimuovi foto</button>` : ""}
        <label class="f">Disegno<select data-dis="${i}"><option value="">— nessuno —</option>${Object.entries(window.RH_ILL.LIB).map(([k, v]) => `<option value="${k}" ${e.disegno === k ? "selected" : ""}>${esc(v.nome)}</option>`).join("")}${e.disegno && typeof e.disegno !== "string" ? `<option selected value="__custom">(personalizzato)</option>` : ""}</select></label>
        <small class="muted">La foto, se c’è, ha la precedenza sul disegno.</small></div>
      <div>
        <label class="f">Nome<input data-bind="esercizi.${i}.nome" value="${esc(e.nome)}"></label>
        <label class="f">Fase<input data-bind="esercizi.${i}.fase" value="${esc(e.fase || "")}" list="fasi"></label>
        <label class="f">Obiettivo<input data-bind="esercizi.${i}.obiettivo" value="${esc(e.obiettivo || "")}"></label>
        <label class="f">Posizione di partenza<input data-bind="esercizi.${i}.posizione" value="${esc(e.posizione || "")}"></label>
        <label class="f">Passi (uno per riga)<textarea data-kind="lines" data-bind="esercizi.${i}.passi" rows="${Math.max(3, (e.passi || []).length + 1)}">${esc((e.passi || []).join("\n"))}</textarea></label>
        <label class="f">Quanto (ripetizioni, serie, volte al giorno)<input data-bind="esercizi.${i}.dosaggio" value="${esc(e.dosaggio || "")}"></label>
        <label class="f">Attenzione<input data-bind="esercizi.${i}.attenzione" value="${esc(e.attenzione || "")}"></label>
        <label class="f">Link video (per il QR code)<input type="url" data-bind="esercizi.${i}.video" value="${esc(e.video || "")}" placeholder="https://…"></label>${protoBoxes(e, "esercizi." + i, doc)}
      </div></div></div>`).join("")}
    <button class="btn green" id="add-ex">＋ Aggiungi esercizio</button>`;
  bindInputs(body, doc);
  const rerender = async () => { markEdited(doc); await commit(doc); tabEditExercises(body, doc); };
  $("#add-ex").onclick = () => { doc.esercizi.push({ id: "ex-" + Date.now().toString(36), fase: fasi[fasi.length - 1] || "", nome: "Nuovo esercizio", obiettivo: "", posizione: "", passi: [], dosaggio: "", attenzione: "", foto: "", video: "" }); rerender(); };
  body.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]"); if (!a) return; const i = +a.closest(".ed-block").dataset.i; const arr = doc.esercizi;
    if (a.dataset.act === "up" && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (a.dataset.act === "down" && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    else if (a.dataset.act === "del") { if (!confirm("Eliminare l’esercizio?")) return; arr.splice(i, 1); }
    else if (a.dataset.act === "rmfoto") arr[i].foto = "";
    else return;
    rerender();
  });
  body.addEventListener("change", async (e) => { if (await onProtoBox(e, doc)) return; const di = e.target.dataset.dis; if (di != null && e.target.value !== "__custom") { doc.esercizi[+di].disegno = e.target.value; return rerender(); } const i = e.target.dataset.photo; if (i != null && e.target.files[0]) { doc.esercizi[+i].foto = await imageToDataUrl(e.target.files[0], 900); rerender(); } });
}

/* ---------- ricerca delle evidenze: PubMed (revisioni sistematiche, meta-analisi, RCT), PEDro, Cochrane */
const TERMINI = { "dito-a-scatto": "trigger finger", "de-quervain": "de Quervain tenosynovitis", "tunnel-carpale": "carpal tunnel syndrome",
  "tendini-estensori": "extensor tendon injury hand", "edema-cicatrice-dolore": "hand surgery postoperative edema OR scar", "tendini-flessori": "flexor tendon repair",
  "tfcc": "triangular fibrocartilage complex", "rizoartrosi": "thumb carpometacarpal osteoarthritis", "frattura-radio-distale": "distal radius fracture",
  "frattura-scafoide": "scaphoid fracture", "rigidita-ifp": "proximal interphalangeal joint stiffness OR volar plate injury", "dupuytren": "Dupuytren",
  "crps": "complex regional pain syndrome", "rigidita-mf": "metacarpophalangeal joint stiffness" };
const termine = (doc) => doc.ricerca || TERMINI[doc.id] || doc.titolo.replace(/^Riabilitazione\s*[–-]\s*/i, "");
const RIAB = "(rehabilitation OR therapy OR orthosis OR splint* OR exercise*)";
function linkEvidenze(doc) {
  const t = termine(doc); const q = encodeURIComponent(`(${t}) AND ${RIAB}`);
  const pm = "https://pubmed.ncbi.nlm.nih.gov/?sort=date&term=" + q;
  return `<div class="ed-panel" style="padding:12px 14px"><b>🔎 Cerca le evidenze per “${esc(t)}”</b>
    <div class="row" style="margin-top:8px">
      <a class="btn small" target="_blank" rel="noopener" href="${pm}&filter=pubt.systematicreview&filter=pubt.meta-analysis">PubMed · revisioni sistematiche e meta-analisi</a>
      <a class="btn small light" target="_blank" rel="noopener" href="${pm}&filter=pubt.randomizedcontrolledtrial">PubMed · RCT</a>
      <a class="btn small light" target="_blank" rel="noopener" href="https://www.cochranelibrary.com/search?searchBy=1&searchText=${encodeURIComponent(t)}">Cochrane</a>
      <a class="btn small light" target="_blank" rel="noopener" href="https://search.pedro.org.au/search" data-copy="${esc(t)}">PEDro</a>
    </div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Su PEDro il termine di ricerca viene copiato: incollalo nel campo “Abstract & Title” e filtra per “systematic review” o per punteggio PEDro ≥ 6.</p></div>`;
}
/* ---------- storico e fonti */
function tabHistory(body, doc) {
  const st = (doc.storico || []).slice().reverse();
  body.innerHTML = `${linkEvidenze(doc)}<h2>Cosa è cambiato</h2><ul class="hist">${st.map((h) => `<li><span class="d">${fmtDate(h.data)}</span>${esc(h.testo)}${h.fonte ? `<br><small class="muted">Fonte: ${esc(h.fonte)}</small>` : ""}</li>`).join("") || "<li>Nessuna modifica registrata.</li>"}</ul>
    <h2>Riferimenti bibliografici</h2>
    <p class="muted" style="font-size:13px">Vengono aggiunti in automatico quando accetti un aggiornamento e stampati in fondo all’opuscolo esercizi. Uno per riga; il link (se presente) va alla fine.</p>
    <label class="f"><textarea id="bib" rows="6">${esc((doc.bibliografia || []).map((r) => r.testo + (r.url ? " " + r.url : "")).join("\n"))}</textarea></label>`;
  $$("[data-copy]", body).forEach((a) => (a.onclick = () => { try { navigator.clipboard.writeText(a.dataset.copy); toast("Termine copiato: incollalo su PEDro"); } catch {} }));
  $("#bib").oninput = (e) => { doc.bibliografia = lines(e.target.value).map((l) => { const m = l.match(/\s(https?:\/\/\S+)$/); return m ? { testo: l.slice(0, m.index).trim(), url: m[1] } : { testo: l, url: "" }; }); autosave(doc); };
}

/* ------------------------------------------------------------------ AGGIORNAMENTI */
function findBlock(doc, id) { for (const k of PANEL_ORDER) { const arr = doc.pannelli[k] || []; const i = arr.findIndex((b) => b.id === id); if (i >= 0) return { k, i, b: arr[i] }; } return null; }
function check(p) {
  if (p.op === "nuova_patologia") return { ok: !docById(p.proposto.id), why: "Opuscolo già presente" };
  const doc = docById(p.patologia); if (!doc) return { ok: false, why: "Opuscolo non presente" };
  if (p.op === "aggiungi_esercizio") return { ok: !doc.esercizi.some((e) => e.id === p.proposto.id), why: "Esercizio già presente" };
  if (p.op === "modifica_esercizio") { const e = doc.esercizi.find((x) => x.id === p.esercizio); if (!e) return { ok: false, why: "Esercizio non trovato (forse rinominato o eliminato)" }; const cur = Array.isArray(e[p.campo]) ? e[p.campo].join(" ") : e[p.campo]; return { ok: !p.attuale || norm(cur).includes(norm(Array.isArray(p.attuale) ? p.attuale.join(" ") : p.attuale)), why: "Il testo attuale dell’esercizio è stato modificato a mano" }; }
  if (p.op === "aggiungi_blocco") return { ok: !findBlock(doc, p.proposto.id), why: "Sezione già presente" };
  if (p.op === "aggiungi_bibliografia") return { ok: true };
  const f = findBlock(doc, p.blocco); if (!f) return { ok: false, why: "Sezione non trovata (forse eliminata)" };
  const b = f.b;
  if (p.op === "sostituisci_testo") return { ok: norm(b.testo).includes(norm(p.attuale)), why: "Il testo attuale è stato modificato a mano" };
  if (p.op === "sostituisci_nota") return { ok: !p.attuale ? true : norm(b.nota).includes(norm(p.attuale)), why: "La nota è stata modificata a mano" };
  if (p.op === "sostituisci_punto" || p.op === "rimuovi_punto") return { ok: (b.punti || []).some((x) => norm(x) === norm(p.attuale)), why: "La voce dell’elenco è stata modificata a mano" };
  if (p.op === "aggiungi_punto") return { ok: !(b.punti || []).some((x) => norm(x) === norm(p.proposto)), why: "Voce già presente" };
  if (p.op === "sostituisci_campo") return { ok: norm((b.campi || {})[p.campo]) === norm(p.attuale), why: "Il campo è stato modificato a mano" };
  return { ok: false, why: "Tipo di modifica sconosciuto" };
}
function apply(p) {
  const t = today();
  if (p.op === "nuova_patologia") {
    const d = clone(p.proposto); d.stato = "bozza"; d.versione = 1; d.aggiornato = t; d.storico = d.storico || [];
    d.storico.push({ data: t, testo: "Nuova patologia preparata da Claude su letteratura scientifica e accettata dall’amministratrice: da revisionare e approvare.", fonte: "" });
    S.docs.push(d); return d;
  }
  const doc = docById(p.patologia);
  if (p.op === "aggiungi_esercizio") doc.esercizi.push(clone(p.proposto));
  else if (p.op === "modifica_esercizio") { const e = doc.esercizi.find((x) => x.id === p.esercizio); if (typeof e[p.campo] === "string" && typeof p.attuale === "string" && p.attuale && norm(e[p.campo]) !== norm(p.attuale)) e[p.campo] = e[p.campo].replace(p.attuale, p.proposto); else e[p.campo] = clone(p.proposto); }
  else if (p.op === "aggiungi_blocco") { const nb = clone(p.proposto); nb._nuovo = t; (doc.pannelli[p.pannello || "i3"] = doc.pannelli[p.pannello || "i3"] || []).push(nb); }
  else if (p.op !== "aggiungi_bibliografia") {
    const { b } = findBlock(doc, p.blocco);
    if (p.op === "sostituisci_testo") b.testo = norm(b.testo) === norm(p.attuale) ? p.proposto : b.testo.replace(p.attuale, p.proposto);
    else if (p.op === "sostituisci_nota") b.nota = !p.attuale || norm(b.nota) === norm(p.attuale) ? p.proposto : b.nota.replace(p.attuale, p.proposto);
    else if (p.op === "sostituisci_punto") b.punti[b.punti.findIndex((x) => norm(x) === norm(p.attuale))] = p.proposto;
    else if (p.op === "rimuovi_punto") b.punti.splice(b.punti.findIndex((x) => norm(x) === norm(p.attuale)), 1);
    else if (p.op === "aggiungi_punto") { b.punti = b.punti || []; const j = p.dopo ? b.punti.findIndex((x) => norm(x) === norm(p.dopo)) : -1; j >= 0 ? b.punti.splice(j + 1, 0, p.proposto) : b.punti.push(p.proposto); }
    else if (p.op === "sostituisci_campo") b.campi[p.campo] = p.proposto;
    b._nuovo = t;
  }
  doc.bibliografia = doc.bibliografia || [];
  for (const f of p.fonti || []) { const testo = citation(f); if (!doc.bibliografia.some((r) => (f.url && r.url === f.url) || norm(r.testo) === norm(testo))) doc.bibliografia.push({ testo, url: f.url || "" }); }
  doc.storico = doc.storico || [];
  doc.storico.push({ data: t, testo: `Aggiornamento accettato – ${p.sezione ? p.sezione + ": " : ""}${p.titolo}`, fonte: (p.fonti || []).map(citation).join("; ") });
  doc.aggiornato = t;
  return doc;
}
const tipoFonte = (f) => f.tipo ? `<span class="pill" style="margin-right:4px">${esc(f.tipo)}${f.pedro ? " · PEDro " + esc(f.pedro) + "/10" : ""}</span>` : "";
function citation(f) { return [f.autori, f.anno ? `(${f.anno})` : "", f.titolo, f.rivista].filter(Boolean).join(". ").replace(/([.?!])\./g, "$1"); }
function showVal(v) {
  if (v == null || v === "") return "<i class='muted'>(niente)</i>";
  if (Array.isArray(v)) return `<ul style="margin:0;padding-left:18px">${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  if (typeof v === "object") { if (v.nome) return `<b>${esc(v.nome)}</b>${v.passi ? showVal(v.passi) : ""}${v.dosaggio ? `<br>⏱ ${esc(v.dosaggio)}` : ""}`; return `${v.titolo ? `<b>${esc(v.titolo)}</b><br>` : ""}${esc(v.testo || "")}${v.punti ? showVal(v.punti) : ""}`; }
  return esc(v);
}
const OP_LABEL = { sostituisci_testo: "Modifica testo", sostituisci_nota: "Modifica nota", sostituisci_punto: "Modifica voce", rimuovi_punto: "Rimuovi voce", aggiungi_punto: "Aggiungi voce", sostituisci_campo: "Modifica ortesi", aggiungi_blocco: "Nuova sezione", aggiungi_esercizio: "Nuovo esercizio", modifica_esercizio: "Modifica esercizio", aggiungi_bibliografia: "Nuovo riferimento" };

function viewUpdates(v) {
  const list = pending();
  const byDoc = {}; list.forEach((p) => { const k = p.op === "nuova_patologia" ? "__nuove" : p.patologia; (byDoc[k] = byDoc[k] || []).push(p); });
  const decided = ((S.feed && S.feed.proposte) || []).filter((p) => S.decisions[p.id]);
  v.innerHTML = `
    <h1>Aggiornamenti proposti</h1>
    <p class="muted">Le proposte nascono da ricerche su letteratura scientifica peer-reviewed (Consensus: revisioni sistematiche, RCT, linee guida e consensus). <b>Nessuna modifica viene applicata senza il tuo Sì.</b> Spunta solo quelle che vuoi inserire: il testo dell’opuscolo viene corretto in automatico ed è subito pronto da stampare.</p>
    ${S.feedError ? `<div class="warnbox">${esc(S.feedError)}</div>` : ""}
    <div class="toolbar">
      <button class="btn light" id="refresh">⟳ Controlla di nuovo</button>
      <label class="btn ghost" style="color:var(--blu)">⇪ Carica file aggiornamenti<input type="file" id="feedfile" accept=".json" hidden></label>
      <span class="muted" style="font-size:13px">${S.feed && S.feed.generato ? `Ultima ricerca: ${fmtDate(S.feed.generato)}` : ""}</span>
    </div>
    ${S.feed && S.feed.nota ? `<div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">${esc(S.feed.nota)}</div>` : ""}
    ${list.length ? Object.entries(byDoc).map(([id, ps]) => `<h2>${ps[0].op === "nuova_patologia" ? "🆕 Nuove patologie proposte" : esc(docById(id).titolo)} <span class="pill warn">${ps.length}</span></h2>${ps.map(updCard).join("")}`).join("") : `<div class="ed-panel" style="padding:16px">✅ Nessun nuovo aggiornamento da valutare.</div>`}
    ${list.length ? `<div class="sticky-actions"><button class="btn small light" id="selall">Seleziona tutte</button><span class="spacer"></span><button class="btn red" id="rej" disabled>✕ No, scarta selezionate</button><button class="btn green" id="acc" disabled>✓ Sì, applica selezionate</button></div>` : ""}
    ${decided.length ? `<details class="ed-panel" style="margin-top:16px"><summary>Già valutate (${decided.length})</summary><div class="body">${decided.map((p) => `<div class="row" style="padding:4px 0;border-bottom:1px solid var(--bd)"><span class="pill ${S.decisions[p.id].stato === "accettata" ? "ok" : ""}">${S.decisions[p.id].stato}</span> <span style="flex:1">${esc((docById(p.patologia) || {}).titolo || (p.proposto && p.proposto.titolo) || p.patologia)} – ${esc(p.titolo || "nuova patologia")}</span> <small class="muted">${fmtDate(S.decisions[p.id].data)}</small>${S.decisions[p.id].stato === "rifiutata" ? ` <button class="iconbtn" data-undo="${esc(p.id)}">Rivaluta</button>` : ""}</div>`).join("")}</div></details>` : ""}`;
  const sel = () => $$("input[data-pid]:checked", v).map((c) => c.dataset.pid);
  const refreshBtns = () => { const n = sel().length; if ($("#acc")) { $("#acc").disabled = $("#rej").disabled = !n; $("#acc").textContent = `✓ Sì, applica selezionate (${n})`; } };
  v.addEventListener("change", (e) => { if (e.target.dataset.pid) refreshBtns(); });
  $("#refresh").onclick = async () => { const n = await checkFeed(false); toast(n ? `${n} aggiornamenti da valutare` : "Nessun nuovo aggiornamento"); viewUpdates(v); };
  $("#feedfile").onchange = async (e) => { try { S.feed = JSON.parse(await readFile(e.target.files[0])); await DB.set("feedCache", S.feed); S.feedError = ""; updateBadge(); viewUpdates(v); } catch { alert("File non valido"); } };
  if ($("#selall")) $("#selall").onclick = () => { $$("input[data-pid]:not(:disabled)", v).forEach((c) => (c.checked = true)); refreshBtns(); };
  if ($("#acc")) $("#acc").onclick = async () => {
    const ids = sel(); const changed = new Set();
    for (const id of ids) { const p = S.feed.proposte.find((x) => x.id === id); if (!check(p).ok) continue; const d = apply(p); changed.add(d.id); S.decisions[id] = { stato: "accettata", data: today() }; }
    for (const id of changed) { const d = docById(id); d.versione = (d.versione || 1) + 1; await commit(d); }
    for (const id of ids) if (S.decisions[id]) await setDecision(id, S.decisions[id]);
    updateBadge();
    viewUpdates(v);
    v.insertAdjacentHTML("afterbegin", `<div class="warnbox" style="background:#e7f6e5;border-color:#a9dca3">✓ Applicati ${ids.length} aggiornamenti. Opuscoli pronti da stampare: ${[...changed].map((id) => `<a href="#/doc/${id}">${esc(docById(id).titolo)}</a>`).join(", ")}. Le parti modificate sono evidenziate in giallo nell’anteprima (non in stampa).</div>`);
  };
  if ($("#rej")) $("#rej").onclick = async () => { for (const id of sel()) await setDecision(id, { stato: "rifiutata", data: today() }); updateBadge(); viewUpdates(v); };
  $$("[data-undo]", v).forEach((b) => (b.onclick = async () => { await setDecision(b.dataset.undo, null); updateBadge(); viewUpdates(v); }));
  $$("[data-prev]", v).forEach((b) => (b.onclick = () => { const p = S.feed.proposte.find((x) => x.id === b.dataset.prev); const box = b.nextElementSibling; box.className = "preview-wrap"; box.innerHTML = `<div class="scaler">${brochureHTML(p.proposto, true)}</div>`; afterImages(box).then(() => { fitPanels(box, p.proposto); scalePreviews(); }); scalePreviews(); b.remove(); }));
  if (!canPublish()) { $$("input[data-pid]", v).forEach((c) => (c.disabled = true)); const sa = $(".sticky-actions", v); if (sa) sa.innerHTML = `<span class="muted">Solo l’amministratrice può applicare o scartare gli aggiornamenti.</span>`; $$("[data-undo]", v).forEach((b) => b.remove()); }
}
function updCard(p) {
  const c = check(p);
  if (p.op === "nuova_patologia") { const d = p.proposto; return `<div class="upd"><input type="checkbox" data-pid="${esc(p.id)}" ${c.ok ? "" : "disabled"}>
    <div><h4>${esc(d.titolo)}</h4><div class="row"><span class="pill">Nuova patologia</span>${d.categoria ? `<span class="pill">${esc(d.categoria)}</span>` : ""}${p.richiesta ? `<span class="pill ok">richiesta dai colleghi</span>` : `<span class="pill">suggerita</span>`}<span class="pill">${(d.esercizi || []).length} esercizi</span>${d.protocolli ? `<span class="pill">${d.protocolli.length} protocolli</span>` : ""}</div>
    ${p.motivazione ? `<p class="why"><b>Perché:</b> ${esc(p.motivazione)}</p>` : ""}
    ${(d.pannelli.cover || []).filter((b) => b.testo).slice(0, 1).map((b) => `<p class="why">${esc(b.testo).slice(0, 400)}</p>`).join("")}
    ${(d.bibliografia || []).length ? `<ol class="fonti">${d.bibliografia.map((r) => `<li>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.testo)}</a>` : esc(r.testo)}</li>`).join("")}</ol>` : ""}
    <button class="btn small light" data-prev="${esc(p.id)}">👁 Anteprima brochure</button><div class="prevbox"></div>
    ${c.ok ? "" : `<p class="conflict">⚠ ${esc(c.why)}</p>`}</div></div>`; }
  return `<div class="upd"><input type="checkbox" data-pid="${esc(p.id)}" ${c.ok ? "" : "disabled"}>
    <div><h4>${esc(p.titolo)}</h4>
      <div class="row"><span class="pill">${OP_LABEL[p.op] || p.op}</span>${p.sezione ? `<span class="pill">${esc(p.sezione)}</span>` : ""}${p.evidenza ? `<span class="pill ok">Evidenza: ${esc(p.evidenza)}</span>` : ""}${p.complessita ? `<span class="pill">${esc(p.complessita)}</span>` : ""}</div>
      <div class="diff"><div class="old"><small>Ora c’è scritto</small><div class="t">${showVal(p.attuale)}</div></div><div class="new"><small>Diventerebbe</small>${showVal(p.proposto)}</div></div>
      ${p.motivazione ? `<p class="why"><b>Perché:</b> ${esc(p.motivazione)}</p>` : ""}
      ${p.fonti && p.fonti.length ? `<ol class="fonti">${p.fonti.map((f) => `<li>${tipoFonte(f)}${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(citation(f))}</a>` : esc(citation(f))}</li>`).join("")}</ol>` : ""}
      ${c.ok ? "" : `<p class="conflict">⚠ Non applicabile in automatico: ${esc(c.why)}. Puoi copiare il testo proposto in “Modifica testi”.</p>`}
    </div></div>`;
}

/* ------------------------------------------------------------------ IMPOSTAZIONI */
function viewSettings(v) {
  const s = S.settings;
  const logoSlot = (key, label) => `<div><label class="f">${label}</label><div class="row"><label class="photo-slot has" style="width:200px;height:90px;background-size:contain;background-image:${s[key] ? `url('${esc(s[key])}')` : "none"}">${s[key] ? "" : "Tocca per caricare"}<input type="file" accept="image/*" data-logo="${key}"></label><button class="iconbtn" data-rmlogo="${key}">Rimuovi</button><button class="iconbtn" data-deflogo="${key}">Originale</button></div></div>`;
  const cc = C().config ? C().config() : { url: "", key: "" };
  const cloudBox = `<div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">☁️ Libreria condivisa (Supabase)</h2>
    <p class="muted" style="font-size:13px">${C().enabled ? (C().user ? `Collegata come <b>${esc(C().email)}</b> – ruolo <b>${esc(RUOLI[C().ruolo] || C().ruolo)}</b>.` : "Collegata, ma non hai effettuato l’accesso.") : "Non collegata: i dati restano solo su questo dispositivo."}</p>
    <label class="f">Project URL<input id="sb-url" value="${esc(cc.url)}" placeholder="https://xxxx.supabase.co"></label>
    <label class="f">Anon public key<input id="sb-key" value="${esc(cc.key)}" placeholder="eyJ…"></label>
    <div class="row" style="margin-top:8px"><button class="btn light" id="sb-save">Salva e ricollega</button>${C().user ? `<button class="btn red" id="sb-out">Esci</button>` : ""}</div>
    <p class="muted" style="font-size:12px">Non inserire mai la “service_role key”.</p></div>`;
  if (!canPublish()) { v.innerHTML = `<h1>Impostazioni</h1><div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">Le impostazioni comuni (loghi, contatti, testi) le modifica l’amministratrice.</div>${cloudBox}`; bindCloudBox(); return; }
  v.innerHTML = `<h1>Impostazioni</h1>${cloudBox}
  <div class="ed-panel" style="padding:14px">
    <h2 style="margin-top:0">Intestazione (vale per tutti gli opuscoli)</h2>
    <label class="f">Ente<input data-s="ente" value="${esc(s.ente)}"></label>
    <label class="f">Centro<input data-s="centro" value="${esc(s.centro)}"></label>
    <label class="f">Progetto<input data-s="progetto" value="${esc(s.progetto)}"></label>
    <div class="row" style="gap:20px;margin-top:8px">${logoSlot("logoEnte", "Logo ente")}${logoSlot("logoProgetto", "Logo progetto")}</div>
    <p class="muted" style="font-size:13px">Per la stampa usa il file del logo ufficiale ATS Liguria ad alta risoluzione (PNG o SVG, Ufficio Comunicazione).</p>
    <div class="row"><label class="f">Colore principale <input type="color" data-s="colore" value="${esc(s.colore)}"></label><label class="f">Colore secondario <input type="color" data-s="colore2" value="${esc(s.colore2)}"></label></div>
  </div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Contatti</h2><div id="cts"></div><button class="btn small light" id="addct">＋ Aggiungi contatto</button></div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Caratteristiche del paziente (personalizzazione)</h2><p class="muted" style="font-size:13px">Il testo che compare nella stampa quando un collega spunta la caratteristica. Una per riga, nel formato: <b>Nome | testo</b></p><label class="f"><textarea id="persmods" rows="8">${esc(persList().map((m) => m.nome + " | " + m.testo).join("\n"))}</textarea></label></div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Regole generali (opuscolo esercizi)</h2><label class="f">Una per riga<textarea id="regole" rows="4">${esc((s.regoleEsercizi || []).join("\n"))}</textarea></label></div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Aggiornamenti</h2>
    <label class="f">Indirizzo dell’elenco aggiornamenti<input data-s="feedUrl" value="${esc(s.feedUrl)}"></label>
    <p class="muted" style="font-size:13px">L’app controlla questo elenco ogni volta che si apre e mostra 🔔 quando ci sono novità.</p></div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Backup e condivisione</h2>
    <p class="muted" style="font-size:13px">I contenuti sono salvati su questo dispositivo. Esporta un backup per non perderli o per passarli a un collega.</p>
    <div class="row"><button class="btn light" id="bk-exp">⤓ Esporta tutto</button><label class="btn light">⇪ Importa backup<input type="file" id="bk-imp" accept=".json" hidden></label>${S.installEvt ? `<button class="btn light" id="inst">⤓ Installa app</button>` : ""}<button class="btn red" id="reset">Ripristina opuscoli originali</button></div></div>`;
  bindCloudBox();
  const drawCts = () => { $("#cts").innerHTML = s.contatti.map((c, i) => `<div class="ed-block"><div class="head"><b>Contatto ${i + 1}</b><button class="iconbtn" data-rmct="${i}" style="color:var(--rosso)">✕</button></div><label class="f">Nome<input data-ct="${i}.nome" value="${esc(c.nome)}"></label><label class="f">Telefono<input data-ct="${i}.tel" value="${esc(c.tel)}"></label><label class="f">Orari<input data-ct="${i}.orari" value="${esc(c.orari || "")}"></label></div>`).join(""); };
  drawCts();
  let t;
  const sv = () => { clearTimeout(t); t = setTimeout(() => { saveSettings(); toast("Impostazioni salvate", 1200); }, 400); };
  v.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.s) { s[el.dataset.s] = el.value; sv(); }
    if (el.dataset.ct) { const [i, k] = el.dataset.ct.split("."); s.contatti[+i][k] = el.value; sv(); }
    if (el.id === "regole") { s.regoleEsercizi = lines(el.value); sv(); }
    if (el.id === "persmods") { const old = persList(); s.personalizzazioni = lines(el.value).map((l, i) => { const [n, ...r] = l.split("|"); const prev = old.find((m) => m.nome.trim() === n.trim()) || {}; return { id: prev.id || "m" + i + "-" + slug(n), nome: n.trim(), testo: r.join("|").trim(), attenzione: prev.attenzione || "", esercizio: prev.esercizio || "" }; }); sv(); }
  });
  v.addEventListener("change", async (e) => { const k = e.target.dataset.logo; if (k && e.target.files[0]) { s[k] = await imageToDataUrl(e.target.files[0], 1400); await saveSettings(); viewSettings(v); } });
  v.addEventListener("click", async (e) => {
    const d = e.target.dataset;
    if (d.rmlogo) { s[d.rmlogo] = ""; await saveSettings(); viewSettings(v); }
    if (d.deflogo) { s[d.deflogo] = window.DEFAULT_SETTINGS[d.deflogo]; await saveSettings(); viewSettings(v); }
    if (d.rmct) { s.contatti.splice(+d.rmct, 1); await saveSettings(); drawCts(); }
  });
  $("#addct").onclick = async () => { s.contatti.push({ nome: "", tel: "", orari: "" }); await saveSettings(); drawCts(); };
  $("#bk-exp").onclick = () => download(`rehand-backup-${today()}.json`, JSON.stringify({ tipo: "rehand-backup", data: today(), settings: s, decisions: S.decisions, docs: S.docs }));
  $("#bk-imp").onchange = async (e) => {
    try { const b = JSON.parse(await readFile(e.target.files[0])); if (b.tipo !== "rehand-backup") throw 0; if (!confirm(`Importare ${b.docs.length} opuscoli? Quelli con lo stesso nome verranno sostituiti.`)) return; for (const d of b.docs) await commit(d); if (b.settings) S.settings = Object.assign(S.settings, b.settings); S.decisions = Object.assign(S.decisions, b.decisions || {}); await saveSettings(); await DB.set("decisions", S.decisions); toast("Backup importato"); viewSettings(v); }
    catch { alert("File di backup non valido."); }
  };
  if ($("#inst")) $("#inst").onclick = () => S.installEvt.prompt();
  $("#reset").onclick = async () => { if (!confirm("Ripristinare gli opuscoli originali? Le modifiche a quegli opuscoli andranno perse (gli opuscoli nuovi restano).")) return; for (const d of window.SEED_DOCS) await commit(clone(d)); toast("Opuscoli originali ripristinati"); };
}

function bindCloudBox() {
  $("#sb-save").onclick = () => { C().saveConfig($("#sb-url").value, $("#sb-key").value); location.hash = "#/"; location.reload(); };
  if ($("#sb-out")) $("#sb-out").onclick = async () => { await C().signOut(); location.hash = "#/account"; location.reload(); };
}
async function revertLocal(id) {
  const remote = (await C().pullDocs()).find((d) => d.id === id);
  if (remote) await saveDoc(remote); else { await DB.del(id); S.docs = S.docs.filter((d) => d.id !== id); }
}

/* ------------------------------------------------------------------ ACCESSO / ACCOUNT */
async function viewAccount(v, sub) {
  if (!C().enabled) { v.innerHTML = `<h1>Account</h1><p>La libreria condivisa non è collegata: vai in ⚙︎ Impostazioni.</p>`; return; }
  if (sub === "nuova-password") {
    v.innerHTML = `<h1>Scegli la tua password</h1><div class="ed-panel" style="padding:14px;max-width:420px"><p class="muted" style="margin-top:0">Almeno 6 caratteri. Ricordala: servirà per entrare con “Accedi”.</p><label class="f">Nuova password<input id="np" type="password" autocomplete="new-password"></label><label class="f">Ripeti la password<input id="np2" type="password" autocomplete="new-password"></label><button class="btn" id="npok" style="margin-top:10px">Salva ed entra</button></div>`;
    $("#npok").onclick = async () => { const a = $("#np").value, b = $("#np2").value; if (a.length < 6) return alert("La password deve avere almeno 6 caratteri."); if (a !== b) return alert("Le due password non coincidono."); const { error } = await C().sb.auth.updateUser({ password: a }); if (error) return alert(error.message); toast("Password salvata ✓"); location.hash = "#/"; location.reload(); };
    return;
  }
  if (!C().user) {
    v.innerHTML = `<h1>Accedi a RE-HAND</h1>
      <div class="ed-panel" style="padding:16px;max-width:420px">
        <label class="f">Email<input id="lg-mail" type="email" autocomplete="username"></label>
        <label class="f">Password<input id="lg-pw" type="password" autocomplete="current-password"></label>
        <div class="row" style="margin-top:12px"><button class="btn" id="lg-in">Accedi</button><button class="btn light" id="lg-up">Registrati</button></div>
        <p style="margin:10px 0 0"><a href="#" id="lg-reset">Password dimenticata?</a></p>
        <p id="lg-msg" class="muted" style="font-size:13px"></p>
      </div>
      <p class="muted" style="font-size:13px">Il primo utente che si registra diventa amministratore. Gli altri restano in attesa finché l’amministratrice non li abilita.<br><b>Se l’amministratrice ti ha creato l’account, premi “Accedi”</b> con l’email e la password che ti ha dato.</p>
      <button class="btn ghost small" id="lg-guest" style="color:var(--blu)">Continua senza accesso (sola lettura)</button>`;
    const msg = (t) => ($("#lg-msg").textContent = t);
    const done = async () => { await syncFromCloud(); toast("Benvenuta/o " + C().email); go(""); route(); };
    const fail = (e) => { C().error = e.message; msg("⚠ " + (C().user ? cloudErrText() : e.message)); };
    $("#lg-in").onclick = async () => { try { msg("Accesso…"); await C().signIn($("#lg-mail").value.trim(), $("#lg-pw").value); await done(); } catch (e) { fail(e); } };
    $("#lg-up").onclick = async () => { try { msg("Registrazione…"); const ok = await C().signUp($("#lg-mail").value.trim(), $("#lg-pw").value); if (ok) await done(); else msg("Controlla la tua email e clicca il link di conferma, poi torna qui e premi Accedi."); } catch (e) { fail(e); } };
    $("#lg-reset").onclick = async (e) => { e.preventDefault(); if (!$("#lg-mail").value.trim()) { msg("Scrivi prima la tua email qui sopra, poi premi di nuovo “Password dimenticata?”."); return; } try { await C().resetPassword($("#lg-mail").value.trim()); msg("📧 Ti abbiamo mandato un’email: aprila su questo dispositivo, tocca il link e scegli la tua password."); } catch (er) { msg("⚠ " + er.message); } };
    $("#lg-guest").onclick = () => { S.guestOk = true; go(""); route(); };
    return;
  }
  if (MODE() === "errore") { v.innerHTML = `<h1>Collegamento non riuscito</h1><div class="warnbox" style="background:#fdecea;border-color:#f3b6af">${esc(cloudErrText())}</div><p>Sei entrata come <b>${esc(C().email)}</b>.</p><div class="row"><button class="btn" id="rl">⟳ Riprova</button><button class="btn red" id="out">Esci</button></div>`; $("#rl").onclick = () => location.reload(); $("#out").onclick = async () => { await C().signOut(); location.reload(); }; return; }
  if (MODE() === "in_attesa") { v.innerHTML = `<h1>Account in attesa</h1><div class="ed-panel" style="padding:16px"><p>Ciao <b>${esc(C().email)}</b>, la tua registrazione è arrivata. L’amministratrice deve abilitarti: appena lo fa, ricarica la pagina.</p><div class="row"><button class="btn" id="rl">⟳ Ricarica</button><button class="btn red" id="out">Esci</button></div></div>`; $("#rl").onclick = () => location.reload(); $("#out").onclick = async () => { await C().signOut(); location.reload(); }; return; }
  v.innerHTML = `<h1>Il mio account</h1>
    <div class="ed-panel" style="padding:14px"><p style="margin:0">${esc(C().email)} · <b>${esc(RUOLI[C().ruolo] || C().ruolo)}</b></p>
    <div class="row" style="margin-top:10px">${MODE() === "admin" ? `<button class="btn" data-go="richieste">📨 Richieste</button><button class="btn" data-go="utenti">👥 Utenti e permessi</button>` : ""}<button class="btn light" id="sync">⟳ Sincronizza</button><button class="btn red" id="out">Esci</button></div></div>
    <h2>Le mie richieste di modifica</h2><div id="myreq" class="muted">Caricamento…</div>`;
  $("#out").onclick = async () => { await C().signOut(); location.reload(); };
  $("#sync").onclick = async () => { await syncFromCloud(); toast(S.syncError ? "⚠ " + S.syncError : "Sincronizzato ✓"); };
  try {
    const rs = (await C().listRequests()).filter((r) => r.autore === C().user.id);
    $("#myreq").innerHTML = rs.length ? rs.map((r) => `<div class="ed-block"><div class="head"><b>${esc((docById(r.opuscolo_id) || r.dati || {}).titolo || r.opuscolo_id)}</b><span class="pill ${r.stato === "approvata" ? "ok" : r.stato === "rifiutata" ? "" : "warn"}">${esc(r.stato.replace("_", " "))}</span>${r.stato === "in_attesa" ? `<button class="iconbtn" data-wd="${r.id}">Ritira</button>` : ""}</div><small class="muted">Inviata il ${new Date(r.creato).toLocaleString("it-IT")}</small>${r.nota ? `<p style="margin:4px 0">${esc(r.nota)}</p>` : ""}${r.commento ? `<p style="margin:4px 0"><b>Risposta:</b> ${esc(r.commento)}</p>` : ""}</div>`).join("") : "<p>Nessuna richiesta.</p>";
    $$("[data-wd]", v).forEach((b) => (b.onclick = async () => { if (!confirm("Ritirare la richiesta?")) return; await C().withdrawRequest(+b.dataset.wd); viewAccount(v); }));
  } catch (e) { $("#myreq").textContent = "⚠ " + e.message; }
}

/* ------------------------------------------------------------------ RICHIESTE (admin) */
function flatDoc(d) {
  const m = new Map(); const F = { titolo: "titolo", testo: "testo", punti: "elenco", nota: "nota" };
  const put = (k, label, v) => m.set(k, { label, v: v == null ? "" : Array.isArray(v) ? v.join("\n") : typeof v === "object" ? JSON.stringify(v) : String(v) });
  put("titolo", "Titolo dell’opuscolo", d.titolo); put("categoria", "Categoria", d.categoria);
  put("immagine", "Immagine di copertina", d.immagine ? "immagine (" + String(d.immagine).length + ")" : "");
  for (const k of PANEL_ORDER) (d.pannelli[k] || []).forEach((b, i) => {
    const L = `${PANEL_NAMES[k]} › ${b.titolo || b.tipo || b.id}`;
    put(`b:${b.id}:pos`, `${L} – posizione`, `${PANEL_NAMES[k]} #${i + 1}`);
    Object.keys(F).forEach((f) => b[f] != null && put(`b:${b.id}:${f}`, `${L} – ${F[f]}`, b[f]));
    if (b.campi) Object.entries(b.campi).forEach(([c, x]) => put(`b:${b.id}:c:${c}`, `${L} – ortesi: ${c}`, x));
  });
  (d.esercizi || []).forEach((e, i) => {
    const L = `Esercizio “${e.nome}”`;
    ["nome", "fase", "obiettivo", "posizione", "passi", "dosaggio", "attenzione", "video", "disegno"].forEach((f) => put(`e:${e.id}:${f}`, `${L} – ${f}`, e[f]));
    put(`e:${e.id}:foto`, `${L} – foto`, e.foto ? "foto (" + e.foto.length + ")" : ""); put(`e:${e.id}:ord`, `${L} – ordine`, i + 1);
  });
  (d.bibliografia || []).forEach((r, i) => put(`bib:${i}`, `Bibliografia ${i + 1}`, r.testo));
  return m;
}
function diffDocs(a, b) {
  const A = a ? flatDoc(a) : new Map(), B = flatDoc(b); const out = [];
  for (const k of new Set([...A.keys(), ...B.keys()])) { const x = A.get(k), y = B.get(k); const va = x ? x.v : "", vb = y ? y.v : ""; if (va !== vb) out.push({ label: (y || x).label, prima: va, dopo: vb }); }
  return out;
}
const showDiffVal = (t) => (/^(foto|immagine) \(\d+\)$/.test(t) ? "<i>(immagine)</i>" : esc(t).replace(/\n/g, "<br>") || "<i class='muted'>(niente)</i>");
async function viewRequests(v) {
  v.innerHTML = `<h1>Richieste di modifica</h1><p class="muted">Gli editor propongono modifiche; tu decidi se pubblicarle. Approvando, la brochure viene aggiornata per tutti.</p><div id="rq">Caricamento…</div>`;
  let rs; try { rs = await C().listRequests(); } catch (e) { $("#rq").textContent = "⚠ " + e.message; return; }
  const pend = rs.filter((r) => r.stato === "in_attesa"), past = rs.filter((r) => r.stato !== "in_attesa").slice(0, 30);
  S.reqPending = pend.length; renderNav();
  $("#rq").innerHTML = (pend.length ? pend.map((r) => {
    const cur = docById(r.opuscolo_id); const df = diffDocs(cur, r.dati);
    return `<div class="upd" style="grid-template-columns:1fr"><div>
      <h4>${esc(r.dati.titolo || r.opuscolo_id)} ${cur ? "" : `<span class="pill warn">nuovo opuscolo</span>`}</h4>
      <div class="muted" style="font-size:13px">Da <b>${esc(r.autore_email || "")}</b> · ${new Date(r.creato).toLocaleString("it-IT")}</div>
      ${r.nota ? `<p class="why"><b>Nota:</b> ${esc(r.nota)}</p>` : ""}
      ${df.length ? df.slice(0, 60).map((x) => `<div style="margin-top:8px"><small style="font-weight:700;color:var(--mut)">${esc(x.label)}</small><div class="diff"><div class="old"><small>Prima</small><div class="t">${showDiffVal(x.prima)}</div></div><div class="new"><small>Dopo</small>${showDiffVal(x.dopo)}</div></div></div>`).join("") + (df.length > 60 ? `<p class="muted">…e altre ${df.length - 60} modifiche</p>` : "") : `<p class="muted">Nessuna differenza nei testi.</p>`}
      <div class="row" style="margin-top:10px"><button class="btn green" data-ok="${r.id}">✓ Approva e pubblica</button><button class="btn red" data-no="${r.id}">✕ Rifiuta</button><button class="btn light" data-see="${r.id}">👁 Anteprima</button></div>
    </div></div>`; }).join("") : `<div class="ed-panel" style="padding:16px">✅ Nessuna richiesta in attesa.</div>`)
    + (past.length ? `<details class="ed-panel" style="margin-top:16px"><summary>Già decise (${past.length})</summary><div class="body">${past.map((r) => `<div class="row" style="padding:4px 0;border-bottom:1px solid var(--bd)"><span class="pill ${r.stato === "approvata" ? "ok" : ""}">${r.stato}</span><span style="flex:1">${esc(r.dati.titolo || r.opuscolo_id)} – ${esc(r.autore_email || "")}</span><small class="muted">${r.deciso_il ? new Date(r.deciso_il).toLocaleDateString("it-IT") : ""}</small></div>`).join("")}</div></details>` : "");
  const byId = (id) => rs.find((r) => r.id === +id);
  $$("[data-ok]", v).forEach((b) => (b.onclick = async () => {
    const r = byId(b.dataset.ok); const commento = prompt("Commento per l’editor (facoltativo):", "") ; if (commento === null) return;
    const cur = docById(r.opuscolo_id); const d = clone(r.dati); delete d._modificheLocali;
    d.versione = ((cur && cur.versione) || 0) + 1; d.aggiornato = today(); d.storico = d.storico || [];
    d.storico.push({ data: today(), testo: `Modifica proposta da ${r.autore_email || "editor"} approvata${commento ? " – " + commento : ""}.`, fonte: r.nota || "" });
    try { await saveDoc(d); await C().pushDoc(d); await C().decideRequest(r.id, "approvata", commento); toast("Pubblicato ✓"); viewRequests(v); } catch (e) { alert(e.message); }
  }));
  $$("[data-no]", v).forEach((b) => (b.onclick = async () => { const commento = prompt("Motivo del rifiuto (lo vedrà l’editor):", ""); if (commento === null) return; try { await C().decideRequest(+b.dataset.no, "rifiutata", commento); viewRequests(v); } catch (e) { alert(e.message); } }));
  $$("[data-see]", v).forEach((b) => (b.onclick = () => { const r = byId(b.dataset.see); const w = document.createElement("div"); w.className = "preview-wrap"; w.innerHTML = `<div class="scaler">${brochureHTML(r.dati, true)}</div>`; b.closest(".upd").appendChild(w); afterImages(w).then(() => { fitPanels(w, r.dati); scalePreviews(); }); scalePreviews(); b.remove(); }));
}

/* ------------------------------------------------------------------ UTENTI (admin) */
async function viewUsers(v) {
  v.innerHTML = `<h1>Utenti e permessi</h1><p class="muted">Chi si registra resta <b>in attesa</b> finché non lo abiliti: scegli <b>lettore</b> (vede e stampa) o <b>editor</b> (propone modifiche). Qui decidi chi può proporre modifiche (<b>editor</b>) e chi è <b>amministratore</b>.</p><div id="us">Caricamento…</div>`;
  try {
    const us = (await C().listProfiles()).sort((a, b) => (a.ruolo === "in_attesa" ? -1 : 0) - (b.ruolo === "in_attesa" ? -1 : 0));
    $("#us").innerHTML = us.map((u) => `<div class="ed-block"><div class="head"><b>${esc(u.email || u.id)}</b>${u.id === C().user.id ? `<span class="pill">tu</span>` : ""}
      <select class="iconbtn" data-role="${u.id}">${Object.entries(RUOLI).map(([k, l]) => `<option value="${k}" ${u.ruolo === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <small class="muted">Registrato il ${new Date(u.creato).toLocaleDateString("it-IT")}</small>${u.ruolo === "in_attesa" ? ` <span class="pill warn">da approvare</span>` : ""}</div>`).join("");
    $$("[data-role]", v).forEach((s) => (s.onchange = async () => { try { await C().setRole(s.dataset.role, s.value); toast("Permesso aggiornato"); S.userPending = (await C().listProfiles()).filter((u) => u.ruolo === "in_attesa").length; renderNav(); } catch (e) { alert(e.message); viewUsers(v); } }));
  } catch (e) { $("#us").textContent = "⚠ " + e.message; }
}

init().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:20px;color:#c0392b">Errore di avvio: ${esc(e.message)}</p>`); console.error(e); });
window.__rehand = { S, printDoc, buildBooklet, brochureHTML, fitPanels, check, apply, diffDocs, MODE, syncFromCloud };
})();
