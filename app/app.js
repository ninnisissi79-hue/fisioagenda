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
async function saveSettings() { await DB.set("settings", S.settings); applyTheme(); }
function applyTheme() { document.documentElement.style.setProperty("--blu", S.settings.colore || "#1d4f9c"); document.documentElement.style.setProperty("--verde", S.settings.colore2 || "#3aa635"); }

async function init() {
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
  applyTheme();
  window.addEventListener("hashchange", route);
  document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go === "home" ? "" : g.dataset.go); } });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });
  window.addEventListener("resize", () => { clearTimeout(init._r); init._r = setTimeout(scalePreviews, 120); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  route();
  checkFeed(true);
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
  if (silent && n) toast(`🔔 ${n} aggiornamenti proposti: tocca “Aggiorna”`, 4500);
  return n;
}
function pending(docId) {
  const ps = (S.feed && S.feed.proposte) || [];
  return ps.filter((p) => !S.decisions[p.id] && docById(p.patologia) && (!docId || p.patologia === docId));
}
function updateBadge() { const n = pending().length; const b = $("#upd-badge"); b.textContent = n; b.hidden = !n; }

/* ------------------------------------------------------------------ router */
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const v = $("#view");
  window.scrollTo(0, 0);
  if (parts[0] === "doc" && docById(parts[1])) return viewDoc(v, docById(parts[1]), parts[2] || "pieghevole");
  if (parts[0] === "aggiorna") return viewUpdates(v);
  if (parts[0] === "impostazioni") return viewSettings(v);
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
    <div class="toolbar">
      <button class="btn green" id="new">＋ Nuova patologia</button>
      <label class="btn ghost" style="color:var(--blu)">⇪ Importa opuscolo<input type="file" id="imp" accept=".json,application/json" hidden></label>
      ${S.installEvt ? `<button class="btn ghost" id="inst" style="color:var(--blu)">⤓ Installa app</button>` : ""}
    </div>
    <div class="grid" id="list"></div>`;
  const draw = () => {
    const q = norm($("#q").value), c = $("#cat").value;
    const list = S.docs.filter((d) => (!q || norm(d.titolo).includes(q)) && (!c || (d.categoria || "Altro") === c)).sort((a, b) => a.titolo.localeCompare(b.titolo, "it"));
    $("#list").innerHTML = list.map((d) => { const n = pending(d.id).length; return `
      <div class="card" data-id="${esc(d.id)}">
        <div class="row"><span class="pill">${esc(d.categoria || "Altro")}</span>${n ? `<span class="pill warn">🔔 ${n} aggiornament${n > 1 ? "i" : "o"}</span>` : ""}${d.stato === "bozza" ? `<span class="pill" style="background:#eef3fa">📝 bozza</span>` : ""}${d.protocolli ? `<span class="pill">${d.protocolli.length} protocolli</span>` : ""}</div>
        <h3>${esc(d.titolo)}</h3>
        <div class="meta">Aggiornato il ${fmtDate(d.aggiornato)} · versione ${d.versione || 1} · ${d.esercizi.length} esercizi</div>
      </div>`; }).join("") || `<p class="muted">Nessun opuscolo trovato.</p>`;
  };
  $("#q").oninput = draw; $("#cat").onchange = draw; draw();
  $("#list").onclick = (e) => { const c = e.target.closest(".card"); if (c) go("doc/" + c.dataset.id); };
  $("#new").onclick = async () => {
    const t = prompt("Nome della patologia (es. Rizoartrosi, Frattura di scafoide…)"); if (!t) return;
    const d = clone(window.TEMPLATE_DOC); d.titolo = "Riabilitazione – " + t.trim(); d.id = uniqueId(slug(t)); d.aggiornato = today(); d.versione = 1;
    d.storico = [{ data: today(), testo: "Creato dal modello vuoto.", fonte: "" }];
    await saveDoc(d); go("doc/" + d.id + "/testi");
  };
  $("#imp").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await readFile(f)); if (!d.pannelli) throw 0; if (docById(d.id) && !confirm(`Esiste già “${docById(d.id).titolo}”. Sostituirlo?`)) d.id = uniqueId(d.id); await saveDoc(d); toast("Opuscolo importato"); draw(); }
    catch { alert("File non valido."); }
  };
  if ($("#inst")) $("#inst").onclick = () => S.installEvt.prompt();
}
function uniqueId(base) { let id = base, i = 2; while (docById(id)) id = base + "-" + i++; return id; }

/* ------------------------------------------------------------------ DOCUMENTO */
function viewDoc(v, doc, tab) {
  const n = pending(doc.id).length;
  const tabs = [["pieghevole", "Pieghevole A4"], ["esercizi-a4", "Opuscolo esercizi A4"], ["testi", "Modifica testi"], ["esercizi", "Modifica esercizi"], ["storico", "Storico e fonti"]];
  v.innerHTML = `
    <div class="row"><button class="btn ghost small" data-go="home" style="color:var(--blu)">← Tutti</button><span class="spacer"></span><span class="saved" id="saved"></span></div>
    <h1>${esc(doc.titolo)}</h1>
    <p class="muted" style="margin-top:-8px">Aggiornato il ${fmtDate(doc.aggiornato)} · versione ${doc.versione || 1}</p>
    ${doc.stato === "bozza" ? `<div class="warnbox" style="background:#eef3fa;border-color:#b9cbe6">📝 <b>Bozza da revisionare.</b> Preparata da Claude su letteratura scientifica e linee guida (vedi “Storico e fonti”). Controllate i testi e premete <button class="btn small green" id="approva">✓ Approva</button></div>` : ""}
    ${doc.protocolli && doc.protocolli.length ? `<div class="toolbar"><label class="f" style="margin:0;flex:1;min-width:260px">Protocollo usato (cambia esercizi, fasi e ortesi)<select id="proto">${doc.protocolli.map((p) => `<option value="${esc(p.id)}" ${p.id === doc.protocollo ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select></label></div><p class="muted" style="margin-top:-6px;font-size:13px">${esc(((doc.protocolli.find((p) => p.id === doc.protocollo) || {}).descrizione) || "")}</p>` : ""}
    ${n ? `<div class="warnbox">🔔 Ci sono <b>${n}</b> aggiornamenti proposti per questa patologia. <a href="#/aggiorna">Valutali ora →</a></div>` : ""}
    <div class="toolbar">
      <button class="btn" id="p-broch">🖨 Stampa / PDF pieghevole</button>
      <button class="btn" id="p-ex">🖨 Stampa / PDF esercizi</button>
      <span class="spacer"></span>
      <button class="btn ghost small" id="dup" style="color:var(--blu)">Duplica</button>
      <button class="btn ghost small" id="exp" style="color:var(--blu)">Esporta</button>
      <button class="btn red small" id="del">Elimina</button>
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="tabbody"></div>`;
  $$(".tabs button", v).forEach((b) => (b.onclick = () => go(`doc/${doc.id}/${b.dataset.tab}`)));
  if ($("#proto")) $("#proto").onchange = async (e) => { doc.protocollo = e.target.value; await saveDoc(doc); viewDoc(v, doc, tab); };
  if ($("#approva")) $("#approva").onclick = async () => { doc.stato = "approvata"; doc.storico = doc.storico || []; doc.storico.push({ data: today(), testo: "Bozza revisionata e approvata dal fisioterapista.", fonte: "" }); await saveDoc(doc); viewDoc(v, doc, tab); };
  $("#p-broch").onclick = () => printDoc(doc, "pieghevole");
  $("#p-ex").onclick = () => printDoc(doc, "esercizi");
  $("#exp").onclick = () => download(`${doc.id}.json`, JSON.stringify(doc, null, 1));
  $("#dup").onclick = async () => { const t = prompt("Nome della copia", doc.titolo + " (copia)"); if (!t) return; const d = clone(doc); d.titolo = t; d.id = uniqueId(slug(t)); d.storico = [{ data: today(), testo: `Creato come copia di “${doc.titolo}”.`, fonte: "" }]; await saveDoc(d); go("doc/" + d.id + "/testi"); };
  $("#del").onclick = async () => { if (!confirm(`Eliminare definitivamente “${doc.titolo}”?\n(Consiglio: prima usa “Esporta” per tenerne una copia.)`)) return; await DB.del(doc.id); S.docs = S.docs.filter((d) => d.id !== doc.id); go(""); };
  const body = $("#tabbody");
  if (tab === "pieghevole") tabBrochure(body, doc);
  else if (tab === "esercizi-a4") tabBooklet(body, doc);
  else if (tab === "testi") tabEditTexts(body, doc);
  else if (tab === "esercizi") tabEditExercises(body, doc);
  else tabHistory(body, doc);
}

/* ---------- anteprime */
function tabBrochure(body, doc) {
  body.innerHTML = `<div id="ovf"></div><div class="preview-wrap"><div class="scaler">${brochureHTML(doc, true)}</div></div>
  <p class="muted" style="font-size:13px">Pagina 1 = esterno (copertina a destra), pagina 2 = interno. Stampa <b>fronte-retro, capovolgi sul lato corto</b>, poi piega in tre. Il testo si rimpicciolisce da solo per stare nelle ante; se un’anta è bordata di rosso il testo è troppo lungo: accorcialo o spostane una sezione.</p>`;
  afterImages(body).then(() => { const o = fitPanels(body); $("#ovf").innerHTML = o.length ? `<div class="warnbox">⚠️ Testo troppo lungo in: <b>${o.map((k) => PANEL_NAMES[k]).join(", ")}</b>. Vai su “Modifica testi” per accorciare o spostare una sezione.</div>` : ""; scalePreviews(); });
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
function blockHTML(b, doc, preview) {
  const cls = "blk" + (preview && b._nuovo ? " nuovo" : "");
  const h = b.titolo ? `<h3>${esc(b.titolo)}</h3>` : "";
  if (b.tipo === "ortesi") {
    const c = b.campi || {}; const rows = [["Quale", c.tipo], ["Quando", c.quando], ["Quanto", c.quanto], ["Per quanto tempo", c.durata], ["Note", c.note]].filter((r) => r[1]);
    return `<div class="${cls} box-ortesi">${h}<table>${rows.map((r) => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join("")}</table></div>`;
  }
  if (b.tipo === "personalizzate") return `<div class="${cls} box-pers">${h}${'<div class="line"></div>'.repeat(b.righe || 5)}</div>`;
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
/* riduce il carattere di ogni anta finché il testo ci sta */
function fitPanels(root) {
  const over = [];
  $$(".panel", root).forEach((p) => {
    let fs = 9.5; p.style.fontSize = fs + "pt"; p.classList.remove("overflow");
    while (p.scrollHeight > p.clientHeight + 1 && fs > 6.75) { fs -= 0.25; p.style.fontSize = fs + "pt"; }
    if (p.scrollHeight > p.clientHeight + 1) { p.classList.add("overflow"); over.push(p.dataset.panel); }
  });
  return over;
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
  const add = (html, keepWithNext) => {
    const t = document.createElement("div"); t.innerHTML = html; const el = t.firstElementChild;
    body.appendChild(el);
    if (!fits() && body.children.length > 1) { body.removeChild(el); body = newPage(); body.appendChild(el); }
    return el;
  };
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
    if (e.fase !== fase) { fase = e.fase; pendingHead = add(`<div class="bk-fase">${esc(fase || "Esercizi")}</div>`); }
    n++;
    const hasFoto = !!e.foto;
    const dis = !hasFoto && e.disegno ? window.RH_ILL.risolvi(e.disegno) : null;
    const seq = dis && Array.isArray(dis) && dis.length > 1;
    const media = hasFoto ? `<div class="ph" style="background-image:url('${e.foto}')"></div>` : dis && !seq ? `<div class="ph ill-ph">${ill(dis)}</div>` : !seq && preview ? `<div class="ph">foto o disegno<br>non inseriti</div>` : "";
    const card = `<div class="ex ${seq ? "seqx" : ""} ${media ? "" : "nofoto"}">${seq ? `<div class="strip">${ill(dis)}</div>` : media}
      <div>${e.video ? `<div class="qr">${qrSvg(e.video)}video</div>` : ""}<h4><span class="n">${n}</span>${esc(e.nome)}</h4>
      ${e.obiettivo ? `<p class="ob">${esc(e.obiettivo)}</p>` : ""}${e.posizione ? `<p class="pos"><b>Posizione:</b> ${esc(e.posizione)}</p>` : ""}
      ${e.passi && e.passi.length ? `<ol>${e.passi.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>` : ""}
      <div class="tags">${e.dosaggio ? `<span class="dose">⏱ ${esc(e.dosaggio)}</span>` : ""}${e.attenzione ? `<span class="att">⚠ ${esc(e.attenzione)}</span>` : ""}</div></div></div>`;
    const before = body;
    const el = add(card);
    // il titolo della fase non resta da solo in fondo alla pagina
    if (pendingHead && el.parentElement !== before && pendingHead.parentElement === before) { before.removeChild(pendingHead); body.insertBefore(pendingHead, el); }
    pendingHead = null;
  }
  add(`<div class="bk-notes"><h4>Note del fisioterapista</h4>${'<div class="line"></div>'.repeat(4)}
    <table class="bk-diary"><tr><th>Diario esercizi – settimana</th>${["L", "M", "M", "G", "V", "S", "D"].map((g) => `<th>${g}</th>`).join("")}</tr>${'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(3)}</table></div>`);
  add(`<div class="bk-notes"><h4>Contatti</h4>${s.contatti.map((c) => `<p style="margin:0 0 1mm"><b>${esc(c.nome)}</b> – Tel. ${esc(c.tel)}${c.orari ? " – " + esc(c.orari) : ""}</p>`).join("")}</div>`);
  if (doc.bibliografia && doc.bibliografia.length) add(`<div class="bk-refs"><b>Riferimenti bibliografici</b><ol>${doc.bibliografia.map((r) => `<li>${esc(r.testo)}</li>`).join("")}</ol></div>`);
  pages.forEach((p, i) => ($(".pn", p).textContent = `Pag. ${i + 1} di ${pages.length}`));
  return pages.length;
}

/* ---------- stampa */
async function printDoc(doc, kind) {
  const root = $("#print-root");
  root.innerHTML = "";
  const land = kind === "pieghevole";
  $("#page-style").textContent = `@page{size:A4 ${land ? "landscape" : "portrait"};margin:0}`;
  if (land) { root.innerHTML = brochureHTML(doc, false); await afterImages(root); const o = fitPanels(root); if (o.length && !confirm("Attenzione: in alcune ante il testo è troppo lungo e verrà tagliato:\n" + o.map((k) => "• " + PANEL_NAMES[k]).join("\n") + "\n\nStampare comunque?")) { root.innerHTML = ""; return; } }
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
/* ---------- editor testi */
function markEdited(doc) {
  if (!S.edited.has(doc.id)) {
    S.edited.add(doc.id);
    doc.versione = (doc.versione || 1) + 1; doc.aggiornato = today();
    doc.storico = doc.storico || []; doc.storico.push({ data: today(), testo: "Modifiche manuali ai testi.", fonte: "" });
  }
}
let saveTimer;
function autosave(doc) { clearTimeout(saveTimer); const sv = $("#saved"); if (sv) sv.textContent = "…"; saveTimer = setTimeout(async () => { markEdited(doc); await saveDoc(doc); if ($("#saved")) $("#saved").textContent = "✓ Salvato"; }, 500); }
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
  const rerender = async () => { markEdited(doc); await saveDoc(doc); const open = $$("details", body).map((d) => d.open); tabEditTexts(body, doc); $$("details", body).forEach((d, i) => (d.open = open[i])); };
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
  const rerender = async () => { markEdited(doc); await saveDoc(doc); tabEditExercises(body, doc); };
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

/* ---------- storico e fonti */
function tabHistory(body, doc) {
  const st = (doc.storico || []).slice().reverse();
  body.innerHTML = `<h2>Cosa è cambiato</h2><ul class="hist">${st.map((h) => `<li><span class="d">${fmtDate(h.data)}</span>${esc(h.testo)}${h.fonte ? `<br><small class="muted">Fonte: ${esc(h.fonte)}</small>` : ""}</li>`).join("") || "<li>Nessuna modifica registrata.</li>"}</ul>
    <h2>Riferimenti bibliografici</h2>
    <p class="muted" style="font-size:13px">Vengono aggiunti in automatico quando accetti un aggiornamento e stampati in fondo all’opuscolo esercizi. Uno per riga; il link (se presente) va alla fine.</p>
    <label class="f"><textarea id="bib" rows="6">${esc((doc.bibliografia || []).map((r) => r.testo + (r.url ? " " + r.url : "")).join("\n"))}</textarea></label>`;
  $("#bib").oninput = (e) => { doc.bibliografia = lines(e.target.value).map((l) => { const m = l.match(/\s(https?:\/\/\S+)$/); return m ? { testo: l.slice(0, m.index).trim(), url: m[1] } : { testo: l, url: "" }; }); autosave(doc); };
}

/* ------------------------------------------------------------------ AGGIORNAMENTI */
function findBlock(doc, id) { for (const k of PANEL_ORDER) { const arr = doc.pannelli[k] || []; const i = arr.findIndex((b) => b.id === id); if (i >= 0) return { k, i, b: arr[i] }; } return null; }
function check(p) {
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
  const doc = docById(p.patologia); const t = today();
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
  const byDoc = {}; list.forEach((p) => (byDoc[p.patologia] = byDoc[p.patologia] || []).push(p));
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
    ${list.length ? Object.entries(byDoc).map(([id, ps]) => `<h2>${esc(docById(id).titolo)} <span class="pill warn">${ps.length}</span></h2>${ps.map(updCard).join("")}`).join("") : `<div class="ed-panel" style="padding:16px">✅ Nessun nuovo aggiornamento da valutare.</div>`}
    ${list.length ? `<div class="sticky-actions"><button class="btn small light" id="selall">Seleziona tutte</button><span class="spacer"></span><button class="btn red" id="rej" disabled>✕ No, scarta selezionate</button><button class="btn green" id="acc" disabled>✓ Sì, applica selezionate</button></div>` : ""}
    ${decided.length ? `<details class="ed-panel" style="margin-top:16px"><summary>Già valutate (${decided.length})</summary><div class="body">${decided.map((p) => `<div class="row" style="padding:4px 0;border-bottom:1px solid var(--bd)"><span class="pill ${S.decisions[p.id].stato === "accettata" ? "ok" : ""}">${S.decisions[p.id].stato}</span> <span style="flex:1">${esc((docById(p.patologia) || {}).titolo || p.patologia)} – ${esc(p.titolo)}</span> <small class="muted">${fmtDate(S.decisions[p.id].data)}</small>${S.decisions[p.id].stato === "rifiutata" ? ` <button class="iconbtn" data-undo="${esc(p.id)}">Rivaluta</button>` : ""}</div>`).join("")}</div></details>` : ""}`;
  const sel = () => $$("input[data-pid]:checked", v).map((c) => c.dataset.pid);
  const refreshBtns = () => { const n = sel().length; if ($("#acc")) { $("#acc").disabled = $("#rej").disabled = !n; $("#acc").textContent = `✓ Sì, applica selezionate (${n})`; } };
  v.addEventListener("change", (e) => { if (e.target.dataset.pid) refreshBtns(); });
  $("#refresh").onclick = async () => { const n = await checkFeed(false); toast(n ? `${n} aggiornamenti da valutare` : "Nessun nuovo aggiornamento"); viewUpdates(v); };
  $("#feedfile").onchange = async (e) => { try { S.feed = JSON.parse(await readFile(e.target.files[0])); await DB.set("feedCache", S.feed); S.feedError = ""; updateBadge(); viewUpdates(v); } catch { alert("File non valido"); } };
  if ($("#selall")) $("#selall").onclick = () => { $$("input[data-pid]:not(:disabled)", v).forEach((c) => (c.checked = true)); refreshBtns(); };
  if ($("#acc")) $("#acc").onclick = async () => {
    const ids = sel(); const changed = new Set();
    for (const id of ids) { const p = S.feed.proposte.find((x) => x.id === id); if (!check(p).ok) continue; const d = apply(p); changed.add(d.id); S.decisions[id] = { stato: "accettata", data: today() }; }
    for (const id of changed) { const d = docById(id); d.versione = (d.versione || 1) + 1; await saveDoc(d); }
    await DB.set("decisions", S.decisions); updateBadge();
    viewUpdates(v);
    v.insertAdjacentHTML("afterbegin", `<div class="warnbox" style="background:#e7f6e5;border-color:#a9dca3">✓ Applicati ${ids.length} aggiornamenti. Opuscoli pronti da stampare: ${[...changed].map((id) => `<a href="#/doc/${id}">${esc(docById(id).titolo)}</a>`).join(", ")}. Le parti modificate sono evidenziate in giallo nell’anteprima (non in stampa).</div>`);
  };
  if ($("#rej")) $("#rej").onclick = async () => { for (const id of sel()) S.decisions[id] = { stato: "rifiutata", data: today() }; await DB.set("decisions", S.decisions); updateBadge(); viewUpdates(v); };
  $$("[data-undo]", v).forEach((b) => (b.onclick = async () => { delete S.decisions[b.dataset.undo]; await DB.set("decisions", S.decisions); updateBadge(); viewUpdates(v); }));
}
function updCard(p) {
  const c = check(p);
  return `<div class="upd"><input type="checkbox" data-pid="${esc(p.id)}" ${c.ok ? "" : "disabled"}>
    <div><h4>${esc(p.titolo)}</h4>
      <div class="row"><span class="pill">${OP_LABEL[p.op] || p.op}</span>${p.sezione ? `<span class="pill">${esc(p.sezione)}</span>` : ""}${p.evidenza ? `<span class="pill ok">Evidenza: ${esc(p.evidenza)}</span>` : ""}${p.complessita ? `<span class="pill">${esc(p.complessita)}</span>` : ""}</div>
      <div class="diff"><div class="old"><small>Ora c’è scritto</small><div class="t">${showVal(p.attuale)}</div></div><div class="new"><small>Diventerebbe</small>${showVal(p.proposto)}</div></div>
      ${p.motivazione ? `<p class="why"><b>Perché:</b> ${esc(p.motivazione)}</p>` : ""}
      ${p.fonti && p.fonti.length ? `<ol class="fonti">${p.fonti.map((f) => `<li>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(citation(f))}</a>` : esc(citation(f))}</li>`).join("")}</ol>` : ""}
      ${c.ok ? "" : `<p class="conflict">⚠ Non applicabile in automatico: ${esc(c.why)}. Puoi copiare il testo proposto in “Modifica testi”.</p>`}
    </div></div>`;
}

/* ------------------------------------------------------------------ IMPOSTAZIONI */
function viewSettings(v) {
  const s = S.settings;
  const logoSlot = (key, label) => `<div><label class="f">${label}</label><div class="row"><label class="photo-slot has" style="width:200px;height:90px;background-size:contain;background-image:${s[key] ? `url('${esc(s[key])}')` : "none"}">${s[key] ? "" : "Tocca per caricare"}<input type="file" accept="image/*" data-logo="${key}"></label><button class="iconbtn" data-rmlogo="${key}">Rimuovi</button><button class="iconbtn" data-deflogo="${key}">Originale</button></div></div>`;
  v.innerHTML = `<h1>Impostazioni</h1>
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
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Regole generali (opuscolo esercizi)</h2><label class="f">Una per riga<textarea id="regole" rows="4">${esc((s.regoleEsercizi || []).join("\n"))}</textarea></label></div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Aggiornamenti</h2>
    <label class="f">Indirizzo dell’elenco aggiornamenti<input data-s="feedUrl" value="${esc(s.feedUrl)}"></label>
    <p class="muted" style="font-size:13px">L’app controlla questo elenco ogni volta che si apre e mostra 🔔 quando ci sono novità.</p></div>
  <div class="ed-panel" style="padding:14px"><h2 style="margin-top:0">Backup e condivisione</h2>
    <p class="muted" style="font-size:13px">I contenuti sono salvati su questo dispositivo. Esporta un backup per non perderli o per passarli a un collega.</p>
    <div class="row"><button class="btn light" id="bk-exp">⤓ Esporta tutto</button><label class="btn light">⇪ Importa backup<input type="file" id="bk-imp" accept=".json" hidden></label>${S.installEvt ? `<button class="btn light" id="inst">⤓ Installa app</button>` : ""}<button class="btn red" id="reset">Ripristina opuscoli originali</button></div></div>`;
  const drawCts = () => { $("#cts").innerHTML = s.contatti.map((c, i) => `<div class="ed-block"><div class="head"><b>Contatto ${i + 1}</b><button class="iconbtn" data-rmct="${i}" style="color:var(--rosso)">✕</button></div><label class="f">Nome<input data-ct="${i}.nome" value="${esc(c.nome)}"></label><label class="f">Telefono<input data-ct="${i}.tel" value="${esc(c.tel)}"></label><label class="f">Orari<input data-ct="${i}.orari" value="${esc(c.orari || "")}"></label></div>`).join(""); };
  drawCts();
  let t;
  const sv = () => { clearTimeout(t); t = setTimeout(() => { saveSettings(); toast("Impostazioni salvate", 1200); }, 400); };
  v.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.s) { s[el.dataset.s] = el.value; sv(); }
    if (el.dataset.ct) { const [i, k] = el.dataset.ct.split("."); s.contatti[+i][k] = el.value; sv(); }
    if (el.id === "regole") { s.regoleEsercizi = lines(el.value); sv(); }
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
    try { const b = JSON.parse(await readFile(e.target.files[0])); if (b.tipo !== "rehand-backup") throw 0; if (!confirm(`Importare ${b.docs.length} opuscoli? Quelli con lo stesso nome verranno sostituiti.`)) return; for (const d of b.docs) await saveDoc(d); if (b.settings) S.settings = Object.assign(S.settings, b.settings); S.decisions = Object.assign(S.decisions, b.decisions || {}); await saveSettings(); await DB.set("decisions", S.decisions); toast("Backup importato"); viewSettings(v); }
    catch { alert("File di backup non valido."); }
  };
  if ($("#inst")) $("#inst").onclick = () => S.installEvt.prompt();
  $("#reset").onclick = async () => { if (!confirm("Ripristinare i 5 opuscoli originali? Le tue modifiche a quegli opuscoli andranno perse (gli opuscoli nuovi restano).")) return; for (const d of window.SEED_DOCS) await saveDoc(clone(d)); toast("Opuscoli originali ripristinati"); };
}

init().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:20px;color:#c0392b">Errore di avvio: ${esc(e.message)}</p>`); console.error(e); });
window.__rehand = { S, printDoc, buildBooklet, brochureHTML, fitPanels, check, apply };
})();
