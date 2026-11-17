/* RE-HAND · Illustrazioni della mano generate da angoli articolari (SVG).
   Ogni disegno è descritto da una "posa": così le posizioni sono anatomicamente coerenti
   e lo stile è uniforme in tutti gli opuscoli. */
(function () {
"use strict";
const SKIN = "#f6d3b7", SKIN2 = "#eec3a2", SKIN3 = "#d9a587", LINE = "#8a5638", RED = "#e53935", SPLINT = "#4f8fd8", ARROW = "#1d4f9c";
const rad = (d) => (d * Math.PI) / 180;
const pt = (p, ang, len) => [p[0] + Math.cos(rad(ang)) * len, p[1] + Math.sin(rad(ang)) * len];
const f = (n) => Math.round(n * 10) / 10;
let BB = null; // riquadro del disegno: il viewBox si adatta al contenuto
const bb = (p, r = 0) => { if (!BB) return; BB[0] = Math.min(BB[0], p[0] - r); BB[1] = Math.min(BB[1], p[1] - r); BB[2] = Math.max(BB[2], p[0] + r); BB[3] = Math.max(BB[3], p[1] + r); };

function seg(a, b, w, col, out = true) {
  bb(a, w / 2 + 2); bb(b, w / 2 + 2);
  let s = "";
  if (out) s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${LINE}" stroke-width="${w + 2.6}" stroke-linecap="round"/>`;
  s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  return s;
}
/* forma morbida di un dito/pollice: contorno affusolato con articolazioni arrotondate e punta tonda.
   Il contorno è tracciato senza la base, così il dito “nasce” dalla mano senza una riga di taglio. */
function limb(pts, ws, col, o = {}) {
  const n = pts.length, lens = [], dirs = [];
  for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy); lens.push(l); dirs.push(l > 0.01 ? [dx / l, dy / l] : (dirs[i - 1] || [0, -1])); }
  const r = (i) => (i <= 0 || i >= n - 1 ? 0 : Math.min(ws[i] * 0.6, lens[i - 1] * 0.45, lens[i] * 0.45));
  const S = [];
  const add = (p, w) => { const q = S[S.length - 1]; if (!q || Math.hypot(p[0] - q.p[0], p[1] - q.p[1]) > 0.4) S.push({ p, w }); };
  for (let i = 0; i < n - 1; i++) {
    const L = lens[i], d = dirs[i], r0 = r(i), r1 = r(i + 1);
    const steps = Math.max(1, Math.ceil((L - r0 - r1) / 2));
    for (let k = 0; k <= steps; k++) { const t = (r0 + (L - r0 - r1) * (k / steps)) / (L || 1); add([pts[i][0] + d[0] * L * t, pts[i][1] + d[1] * L * t], ws[i] + (ws[i + 1] - ws[i]) * t); }
    if (r1 > 0) {
      const J = pts[i + 1], a = [J[0] - d[0] * r1, J[1] - d[1] * r1], d2 = dirs[i + 1], b = [J[0] + d2[0] * r1, J[1] + d2[1] * r1];
      for (let k = 1; k < 8; k++) { const t = k / 8, u = 1 - t; add([u * u * a[0] + 2 * u * t * J[0] + t * t * b[0], u * u * a[1] + 2 * u * t * J[1] + t * t * b[1]], ws[i + 1]); }
    }
  }
  const N = S.map((s, k) => { const a = S[Math.max(0, k - 1)].p, b = S[Math.min(S.length - 1, k + 1)].p; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; });
  const Lf = S.map((s, k) => [s.p[0] + N[k][0] * s.w / 2, s.p[1] + N[k][1] * s.w / 2]);
  const Rt = S.map((s, k) => [s.p[0] - N[k][0] * s.w / 2, s.p[1] - N[k][1] * s.w / 2]);
  const e = S[S.length - 1], en = N[N.length - 1], a0 = Math.atan2(en[1], en[0]) * 180 / Math.PI, tip = [];
  for (let k = 1; k < 12; k++) tip.push(pt(e.p, a0 - (180 * k) / 12, e.w / 2));
  const outline = Lf.concat(tip, Rt.slice().reverse());
  outline.forEach((q) => bb(q, 2));
  const P2 = (q) => f(q[0]) + "," + f(q[1]);
  const open = "M" + outline.map(P2).join(" L");
  return `<path d="${open}" fill="none" stroke="${LINE}" stroke-width="${o.lw || 2.8}" stroke-linejoin="round" stroke-linecap="round"/><path d="${open} Z" fill="${col}"/>`;
}
/* forma chiusa morbida (palmo) per punti: curva di Catmull-Rom */
function blob(pts, col, stroke = true) {
  const n = pts.length; let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  pts.forEach((q) => bb(q, 2));
  return stroke ? `<path d="${d}Z" fill="${col}" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>` : `<path d="${d}Z" fill="${col}"/>`;
}
/* avambraccio: solo i due bordi, nessuna “fine” disegnata */
function forearm(a, b, wa, wb, col, ends) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  const a1 = pt(a, ang + 90, wa / 2), a2 = pt(a, ang - 90, wa / 2);
  let b1 = pt(b, ang + 90, wb / 2), b2 = pt(b, ang - 90, wb / 2);
  if (ends) { // estremi esatti sul bordo del palmo: niente gradini al polso
    const d1 = Math.hypot(ends[0][0] - b1[0], ends[0][1] - b1[1]), d2 = Math.hypot(ends[1][0] - b1[0], ends[1][1] - b1[1]);
    [b1, b2] = d1 < d2 ? ends : [ends[1], ends[0]];
  }
  [a1, a2, b1, b2].forEach((q) => bb(q, 2));
  const P2 = (q) => f(q[0]) + "," + f(q[1]);
  return `<polygon points="${[a1, b1, b2, a2].map(P2).join(" ")}" fill="${col}"/><path d="M${P2(a1)} L${P2(b1)} M${P2(a2)} L${P2(b2)}" stroke="${LINE}" stroke-width="1.4"/>`;
}
const crease = (p, ang, len, col) => { const a = pt(p, ang + 90, len / 2), b = pt(p, ang - 90, len / 2); return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${col}" stroke-width="1.1" stroke-linecap="round"/>`; };
function chain(start, ang0, lens, angs) { const pts = [start]; let a = ang0, p = start; lens.forEach((L, i) => { a -= angs[i] || 0; p = pt(p, a, L); pts.push(p); }); return { pts, endAng: a }; }
function arrowArc(c, r, a1, a2, col = ARROW) {
  const p1 = pt(c, a1, r), p2 = pt(c, a2, r); [a1, (a1 + a2) / 2, a2].forEach((a) => bb(pt(c, a, r), 8)); const large = Math.abs(a2 - a1) > 180 ? 1 : 0; const sweep = a2 > a1 ? 1 : 0;
  const tang = a2 + (sweep ? 90 : -90); const h1 = pt(p2, tang + 150, 7), h2 = pt(p2, tang - 150, 7);
  return `<path d="M${f(p1[0])},${f(p1[1])} A${r},${r} 0 ${large} ${sweep} ${f(p2[0])},${f(p2[1])}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/><path d="M${f(h1[0])},${f(h1[1])} L${f(p2[0])},${f(p2[1])} L${f(h2[0])},${f(h2[1])}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function arrowLine(a, b, col = ARROW) { bb(a, 4); bb(b, 8); const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; const h1 = pt(b, ang + 150, 7), h2 = pt(b, ang - 150, 7); return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/><path d="M${f(h1[0])},${f(h1[1])} L${f(b[0])},${f(b[1])} L${f(h2[0])},${f(h2[1])}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`; }
function glow(p, r = 14) { bb(p, r * 0.6); return `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r}" fill="url(#rh-glow)"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r * 0.32}" fill="${RED}" opacity=".9"/>`; }
const DEFS = `<defs><radialGradient id="rh-glow"><stop offset="0" stop-color="${RED}" stop-opacity=".75"/><stop offset=".55" stop-color="${RED}" stop-opacity=".3"/><stop offset="1" stop-color="${RED}" stop-opacity="0"/></radialGradient></defs>`;

/* ---------------- VISTA LATERALE (lato radiale, dita in alto, palmo a sinistra) ---------------- */
function lato(o) {
  const vertical = o.orient !== "orizzontale";
  const W = vertical ? [118, 150] : [70, (o.polso || 0) < 0 ? 70 : 150];
  const base = vertical ? -90 : 0;                // direzione della mano a riposo
  const forearmEnd = pt(W, base + 180, vertical ? 55 : 70);
  let s = "";
  if (o.tavolo) { if (vertical) { s += `<rect x="40" y="208" width="160" height="10" rx="2" fill="#c8a27a"/>`; bb([40, 208]); bb([200, 218]); } else { s += `<rect x="${f(W[0] - 70)}" y="${W[1] + 16}" width="76" height="10" rx="2" fill="#c8a27a"/>`; bb([W[0] - 70, W[1] + 26]); } }
  const handAng = base - (o.polso || 0);
  const palm = chain(W, handAng, [62], [0]);
  const M = palm.pts[1];
  const def = { mcp: o.mcp || 0, pip: o.pip || 0, dip: o.dip || 0 };
  const fingers = [ // dal più lontano al più vicino: sfalsati verso il dorso per renderli distinguibili
    { k: "mignolo", d: 10.5, ax: -9, sc: 0.8, col: "#e0ae8c" }, { k: "anulare", d: 7, ax: -3, sc: 0.94, col: "#e8bb9a" },
    { k: "medio", d: 3.5, ax: 0, sc: 1, col: SKIN2 }, { k: "indice", d: 0, ax: -2, sc: 0.95, col: SKIN }];
  const per = o.dita || {};
  const fingerChains = {};
  const stack = [];
  fingers.forEach((fi) => {
    const a = Object.assign({}, def, per[fi.k] || {});
    const start = pt(pt(M, handAng + 90, fi.d), handAng, fi.ax);
    const c = chain(start, handAng, [40 * fi.sc, 25 * fi.sc, 19 * fi.sc], [a.mcp, a.pip, a.dip]);
    fingerChains[fi.k] = c;
    stack.push({ fi, c });
  });
  const U = (u, v) => pt(pt(W, handAng, u), handAng + 90, v); // v > 0 = dorso
  const ws = (sc) => [15.5, 14, 12.8, 11.6].map((x) => x * (0.86 + sc * 0.14));
  // dita più lontane (mignolo, anulare, medio): un po' più scure, sfalsate verso il dorso
  stack.filter(({ fi }) => fi.k !== "indice").forEach(({ fi, c }) => (s += limb([pt(c.pts[0], handAng + 180, 8)].concat(c.pts.slice(1)), ws(fi.sc), fi.col)));
  // pollice sul lato palmare: la base resta sotto l'eminenza thenar
  const th = o.pollice || {};
  const tc = chain(U(8, -8), handAng - (th.abd != null ? th.abd : 16), [32, 22, 17], [0, th.mf || 10, th.ip || 10]);
  s += limb(tc.pts, [19, 15.5, 13.5, 12], SKIN2);
  { const e = tc.pts[3], a = tc.endAng, n0 = pt(pt(e, a + 180, 7), a + 90, 3), n1 = pt(pt(e, a + 180, 1.2), a + 90, 2.6);
    s += `<line x1="${f(n0[0])}" y1="${f(n0[1])}" x2="${f(n1[0])}" y2="${f(n1[1])}" stroke="#fbe9dd" stroke-width="3.4" stroke-linecap="round"/>`; }
  // palmo con eminenza thenar sul lato palmare e nocca sul dorso
  s += blob([U(10, 14.8), U(32, 15.3), U(54, 15.6), U(65, 12), U(68, 4), U(65, -5), U(57, -10), U(42, -14), U(26, -18.5), U(10, -17), U(-6, -14.6), U(-24, -13), U(-24, 13), U(-6, 14.6)], SKIN);
  s += forearm(forearmEnd, W, 33, 29.2, SKIN, [U(-6, 14.6), U(-6, -14.6)]);
  // indice (il più vicino): la base è coperta dal palmo
  const ix = fingerChains.indice;
  s += limb([pt(ix.pts[0], handAng + 180, 8)].concat(ix.pts.slice(1)), ws(0.95), SKIN);
  s += `<polygon points="${[U(46, 13.6), U(60.5, 13.6), U(60.5, -11.5), U(46, -11.5)].map((q) => f(q[0]) + "," + f(q[1])).join(" ")}" fill="${SKIN}"/>`;
  // pieghe dorsali sulle articolazioni dell'indice e unghia
  const ang = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  [1, 2].forEach((j) => { const dA = (ang(ix.pts[j - 1], ix.pts[j]) + ang(ix.pts[j], ix.pts[j + 1])) / 2; const q = pt(ix.pts[j], dA + 90, 4.2); s += crease(q, dA + 90, 3.4, SKIN3); });
  { const e = ix.pts[3], a = ix.endAng, n0 = pt(pt(e, a + 180, 7.5), a + 90, 3.2), n1 = pt(pt(e, a + 180, 1.2), a + 90, 2.8);
    s += `<line x1="${f(n0[0])}" y1="${f(n0[1])}" x2="${f(n1[0])}" y2="${f(n1[1])}" stroke="#fbe9dd" stroke-width="3.6" stroke-linecap="round"/>`; }
  // oggetti
  if (o.oggetto === "bottiglia") { const c = pt(M, handAng - 90, 20); bb([c[0] - 13, c[1] - 40]); bb([c[0] + 13, c[1] + 34]); s = `<rect x="${f(c[0] - 12)}" y="${f(c[1] - 38)}" width="24" height="70" rx="7" fill="#9fd3ee" stroke="#4a8db3" stroke-width="2"/><rect x="${f(c[0] - 6)}" y="${f(c[1] - 48)}" width="12" height="12" rx="2" fill="#4a8db3"/>` + s; }
  if (o.oggetto === "pallina") { const c = pt(M, handAng - 90, 24); bb([c[0], c[1] - 4], 18); s += `<circle cx="${f(c[0])}" cy="${f(c[1] - 4)}" r="17" fill="#ff9f43" stroke="#b86b1d" stroke-width="2"/>`; }
  // tutore
  if (o.tutore) s += splintSide(o.tutore, { forearmEnd, W, M, ix, handAng, fingerChains });
  // evidenza
  const J = { mf: ix.pts[0], ifp: ix.pts[1], ifd: ix.pts[2], polso: W };
  if (o.evid && J[o.evid]) s += glow(J[o.evid]);
  // frecce
  (o.frecce || []).forEach((fr) => {
    if (fr.tipo === "giunto") { const c = J[fr.giunto] || W; const a0 = (fr.giunto === "polso" ? handAng : ix.endAng); s += fr.verso === "flex" ? arrowArc(c, fr.r || 30, a0 + 40, a0 - 40) : arrowArc(c, fr.r || 30, a0 - 40, a0 + 40); }
    if (fr.tipo === "linea") s += arrowLine(fr.da, fr.a);
  });
  return s;
}
function splintSide(t, g) {
  let pts = [g.forearmEnd, g.W, g.M];
  if (t.fino === "dita" || t.fino === "ifd") pts.push(...g.ix.pts.slice(1));
  if (t.solo === "dito") pts = g.ix.pts.slice(0);
  if (t.solo === "ifd") pts = g.ix.pts.slice(1);
  if (t.solo === "mano") pts = [g.W, g.M, g.ix.pts[1]];
  let s = ""; const off = t.lato === "volare" ? -1 : 1; // dorsale = verso destra
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; const d = (i < 1 ? 18 : i < 2 ? 15 : 8) * off;
    const a2 = pt(a, ang + 90 * (off > 0 ? 1 : -1), Math.abs(d)), b2 = pt(b, ang + 90 * (off > 0 ? 1 : -1), Math.abs(d));
    s += `<line x1="${f(a2[0])}" y1="${f(a2[1])}" x2="${f(b2[0])}" y2="${f(b2[1])}" stroke="${SPLINT}" stroke-width="7" stroke-linecap="round" opacity=".85"/>`;
  }
  if (t.trazione) { const tip = g.ix.pts[3]; s += `<path d="M${f(tip[0])},${f(tip[1])} Q${f(g.M[0] - 30)},${f(g.M[1] + 20)} ${f(g.W[0] - 10)},${f(g.W[1] + 40)}" fill="none" stroke="#2e9d4a" stroke-width="2" stroke-dasharray="4 3"/>`; }
  return s;
}

/* ---------------- VISTA FRONTALE (palmare: palmo verso chi guarda, dita in alto) ---------------- */
function fronte(o) {
  let s = "";
  const dev = o.deviazione || 0; // + = ulnare (verso destra: mano destra palmare, mignolo a destra)
  const W = [110, 160];
  const up = -90 + dev;
  if (o.tavolo) { const y = pt(W, up + 180 - dev, 42)[1] + 2; s += `<rect x="40" y="${f(y)}" width="140" height="8" rx="2" fill="#c8a27a"/>`; bb([40, y]); bb([180, y + 8]); }
  const fore = pt(W, up + 180 - dev, 42);
  // palmo come poligono
  const ax = up, px = up + 90; // px verso il mignolo
  const P = (u, v) => pt(pt(W, ax, u), px, v);
  const palmPts = [P(0, -24), P(0, 24), P(70, 30), P(78, 16), P(80, 0), P(78, -16), P(68, -30), P(30, -32)];
  const poly = (pts, fill) => (pts.forEach((q) => bb(q, 1)), `<polygon points="${pts.map((p) => f(p[0]) + "," + f(p[1])).join(" ")}" fill="${fill}" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>`);
  const fingersDef = [{ k: "indice", v: -21, L: [38, 24, 18], w: 15, spread: -6 }, { k: "medio", v: -6, L: [42, 27, 19], w: 15.5, spread: -1 }, { k: "anulare", v: 9, L: [39, 25, 18], w: 14.5, spread: 4 }, { k: "mignolo", v: 23, L: [30, 19, 16], w: 13, spread: 10 }];
  const per = o.dita || {}; const spreadK = o.ventaglio ? 2.2 : 1;
  const tips = {}; const bases = {};
  const drawFinger = (fd) => {
    const a = Object.assign({ mcp: o.mcp || 0, pip: o.pip || 0, dip: o.dip || 0 }, per[fd.k] || {});
    const base = P(fd.k === "medio" ? 78 : fd.k === "mignolo" ? 66 : 74, fd.v);
    bases[fd.k] = base;
    const dir = ax + fd.spread * spreadK;
    // flessione vista di fronte: segmento accorciato (proiezione)
    const pr = (deg) => Math.max(0.12, Math.cos(rad(Math.min(deg, 100))));
    let p = base; const pts = [p];
    const cum = [a.mcp, a.mcp + a.pip, a.mcp + a.pip + a.dip];
    fd.L.forEach((L, i) => { p = pt(p, dir, L * pr(cum[i])); pts.push(p); });
    const w0 = fd.w + 0.5;
    let out = limb([pt(base, dir + 180, 8)].concat(pts.slice(1)), [w0, w0 * 0.93, w0 * 0.86, w0 * 0.8], SKIN);
    // pieghe palmari delle articolazioni (solo se il segmento si vede abbastanza)
    [1, 2].forEach((j) => { if (Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]) > fd.L[j] * 0.55) out += crease(pts[j], dir, w0 * 0.5, SKIN3); });
    tips[fd.k] = pts[3];
    return out;
  };
  // dita dietro al palmo se flesse molto? disegniamo prima le dita, poi il palmo sopra la base
  fingersDef.forEach((fd) => (s += drawFinger(fd)));
  s += blob([P(6, -24), P(18, -31), P(34, -34), P(52, -31), P(68, -28), P(78, -16), P(81, 0), P(78, 14), P(68, 28), P(50, 31.5), P(28, 31), P(10, 24.5), P(-6, 22.4), P(-20, 20), P(-20, -20), P(-6, -22.4)], SKIN);
  s += forearm(fore, W, 48, 44.8, SKIN, [P(-6, 22.4), P(-6, -22.4)]);
  // pieghe palmari
  s += `<path d="M${f(P(52, -30)[0])},${f(P(52, -30)[1])} Q${f(P(58, 0)[0])},${f(P(58, 0)[1])} ${f(P(64, 28)[0])},${f(P(64, 28)[1])}" stroke="${SKIN3}" stroke-width="1.4" fill="none"/>`;
  // pollice (lato radiale = sinistra), 2 segmenti + metacarpo, con IK per l'opposizione
  const th = o.pollice || {}; const cmc = P(14, -24);
  let tp;
  if (th.verso && tips[th.verso]) {
    const target = tips[th.verso]; const L1 = 34, L2 = 26 + 18;
    const dx = target[0] - cmc[0], dy = target[1] - cmc[1]; let d = Math.hypot(dx, dy); d = Math.min(d, L1 + L2 - 1);
    const a0 = (Math.atan2(dy, dx) * 180) / Math.PI; const k = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) * 180 / Math.PI;
    const m = pt(cmc, a0 - k, L1); const t = pt(cmc, a0, d); const mid = pt(m, (Math.atan2(t[1] - m[1], t[0] - m[0]) * 180) / Math.PI, 26);
    tp = [cmc, m, mid, t];
  } else {
    const ab = th.abd != null ? th.abd : 35; const dir = ax - ab; tp = chain(cmc, dir, [34, 26, 18], [0, -(th.mf || 0) * 0.3, -(th.ip || 0) * 0.3]).pts;
  }
  s += limb(tp, [24, 18.5, 16.5, 14.5], SKIN);
  { const dA = (Math.atan2(tp[3][1] - tp[2][1], tp[3][0] - tp[2][0]) * 180) / Math.PI; s += crease(tp[2], dA, 9, SKIN3); }
  s += `<ellipse cx="${f(P(20, -18)[0])}" cy="${f(P(20, -18)[1])}" rx="13" ry="11" fill="${SKIN}"/>`;
  { const a = P(26, -4), b = P(18, -16), c = P(14, -24); s += `<path d="M${f(a[0])},${f(a[1])} Q${f(b[0])},${f(b[1])} ${f(c[0])},${f(c[1])}" stroke="${SKIN3}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`; }
  if (o.oggetto === "tessuto") { const c = P(40, 4); bb(c, 26); s += `<rect x="${f(c[0] - 26)}" y="${f(c[1] - 16)}" width="52" height="32" rx="6" fill="#b9d7f0" opacity=".85" stroke="#5d8fbd" stroke-width="1.4"/><path d="M${f(c[0] - 20)},${f(c[1] - 6)} q10,-8 20,0 t20,0 M${f(c[0] - 20)},${f(c[1] + 6)} q10,-8 20,0 t20,0" stroke="#5d8fbd" stroke-width="1.4" fill="none"/>`; }
  // oggetti
  if (o.oggetto === "moneta" && th.verso) s += `<ellipse cx="${f(tp[3][0])}" cy="${f(tp[3][1] - 2)}" rx="7" ry="3.5" fill="#f5c542" stroke="#a07c12" stroke-width="1.4"/>`;
  if (o.oggetto === "elastico") { const a = tips.indice, b = tips.mignolo; s += `<path d="M${f(a[0] - 4)},${f(a[1] + 14)} Q${f((a[0] + b[0]) / 2)},${f(Math.min(a[1], b[1]) + 4)} ${f(b[0] + 4)},${f(b[1] + 14)}" stroke="#2e9d4a" stroke-width="4" fill="none" stroke-linecap="round"/>`; }
  if (o.oggetto === "pallina-rot") { const c = P(44, 2); s += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="12" fill="#ff9f43" stroke="#b86b1d" stroke-width="2"/>`; s += arrowArc(c, 22, -150, 120, "#1d4f9c"); }
  if (o.oggetto === "pallina") { const c = P(48, 2); s += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="20" fill="#ff9f43" stroke="#b86b1d" stroke-width="2" opacity=".95"/>`; }
  if (o.oggetto === "cicatrice") { const a = P(22, -2), b = P(50, 2); s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#b5544a" stroke-width="2.4" stroke-dasharray="1 3" stroke-linecap="round"/>`; s += arrowArc(pt(a, ax, 14), 9, 0, 300, "#2e9d4a"); }
  // tutore
  if (o.tutore) {
    const t = o.tutore; let pts = [];
    if (t.tipo === "spica") pts = [pt(W, ax + 180, 60), W, cmc, tp[1], tp[2]];
    else if (t.tipo === "polso") pts = [pt(W, ax + 180, 60), W, P(55, 0)];
    else if (t.tipo === "polso-pollice-libero") pts = [pt(W, ax + 180, 60), W, P(50, 4)];
    const d = pts.map((p, i) => (i ? "L" : "M") + f(p[0]) + "," + f(p[1])).join(" ");
    s += `<path d="${d}" fill="none" stroke="${SPLINT}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity=".35"/><path d="${d}" fill="none" stroke="${SPLINT}" stroke-width="2" stroke-dasharray="5 3" opacity=".9"/>`;
  }
  // evidenze anatomiche
  const Z = {
    a1: P(66, o.dito === "pollice" ? -40 : o.dito === "medio" ? -6 : o.dito === "indice" ? -21 : 9), tunnel: P(16, 0), dq: P(-4, -26), tfcc: P(-4, 26), rizo: cmc,
    scafoide: P(4, -18), radio: P(-12, -12), dupuytren: P(50, 10), ifp: (() => { const fd = fingersDef.find((x) => x.k === (o.dito || "medio")); const b = bases[fd.k]; return pt(b, ax + fd.spread * spreadK, fd.L[0] * Math.max(0.12, Math.cos(rad(Math.min((per[fd.k] || {}).mcp || o.mcp || 0, 100))))); })(),
    flessori: P(56, -6), cubitale: P(-30, 30), lcu: tp[1] };
  (Array.isArray(o.evid) ? o.evid : o.evid ? [o.evid] : []).forEach((z) => { if (Z[z]) s += glow(Z[z], z === "dupuytren" ? 18 : 14); });
  if (o.evid === "dupuytren") { const a = P(30, 9), b = P(74, 10); s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#c0392b" stroke-width="5" stroke-linecap="round" opacity=".7"/>`; }
  (o.frecce || []).forEach((fr) => {
    if (fr.tipo === "deviazione") s += fr.verso === "ulnare" ? arrowArc(W, 95, -125, -60) : arrowArc(W, 95, -55, -120);
    if (fr.tipo === "apertura") { s += arrowLine(P(96, -30), P(110, -46)); s += arrowLine(P(96, 30), P(110, 46)); }
    if (fr.tipo === "rotazione") s += arrowArc(pt(W, ax + 180, 40), 34, 200, 340);
    if (fr.tipo === "pollice") s += arrowArc(cmc, 40, -150, -80);
  });
  return s;
}

/* ---------------- API ---------------- */
function one(o) {
  BB = [1e9, 1e9, -1e9, -1e9];
  let body = o.v === "fronte" ? fronte(o) : lato(o);
  if (o.specchio) { // specchio a sinistra della mano: la mano malata resta nascosta dietro
    const x = BB[0] - 14, y0 = BB[1] - 4, y1 = BB[3] + 4;
    body = `<rect x="${f(x - 10)}" y="${f(y0)}" width="10" height="${f(y1 - y0)}" rx="2" fill="#cfe3f5" stroke="#6e9cc6" stroke-width="1.6"/><line x1="${f(x - 7)}" y1="${f(y0 + 8)}" x2="${f(x - 3)}" y2="${f(y0 + 30)}" stroke="#fff" stroke-width="2"/>` + body;
    bb([x - 10, y0]); bb([x, y1]);
  }
  let [x0, y0, x1, y1] = BB; BB = null;
  const pad = 6; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let w = x1 - x0, h = y1 - y0; const side = Math.max(w, h, 205); // scala fissa: la mano ha sempre la stessa grandezza
  x0 -= (side - w) / 2; y0 -= (side - h) / 2; w = h = side;
  if (o.specchiata) body = `<g transform="translate(${f(2 * x0 + w)},0) scale(-1,1)">${body}</g>`;
  return `<svg viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${(o.label || "").replace(/"/g, "")}">${DEFS}${body}</svg>`;
}
/* disegno = una posa o un elenco di pose (sequenza numerata) */
function disegno(d) {
  if (!d) return "";
  const arr = Array.isArray(d) ? d : [d];
  if (arr.length === 1) return `<div class="ill one">${one(arr[0])}${arr[0].label ? `<span>${arr[0].label}</span>` : ""}</div>`;
  return `<div class="ill seq">${arr.map((o, i) => `<figure>${one(o)}<figcaption><b>${i + 1}</b> ${o.label || ""}</figcaption></figure>`).join("")}</div>`;
}
/* pose pronte, riutilizzabili negli esercizi */
const P = {
  dritta: { v: "lato", label: "Dita dritte" },
  tavola: { v: "lato", mcp: 85, label: "Tavola" },
  gancio: { v: "lato", pip: 95, dip: 75, label: "Gancio" },
  pugnoDritto: { v: "lato", mcp: 85, pip: 95, label: "Pugno dritto" },
  pugno: { v: "lato", mcp: 85, pip: 100, dip: 70, pollice: { abd: 10, mf: 30, ip: 20 }, label: "Pugno" },
  polsoFlex: { v: "lato", orient: "orizzontale", tavolo: true, polso: -55, label: "Polso giù" },
  polsoExt: { v: "lato", orient: "orizzontale", tavolo: true, polso: 50, label: "Polso su" },
  ventaglio: { v: "fronte", ventaglio: true, pollice: { abd: 55 }, frecce: [{ tipo: "apertura" }], label: "Apri a ventaglio" },
  opposizione: (dito) => ({ v: "fronte", pollice: { verso: dito }, dita: { [dito]: { mcp: 45, pip: 40, dip: 20 } }, label: "Pollice–" + dito }),
};
/* Libreria con nomi: si sceglie dal menu “Disegno” nell’editor degli esercizi */
const L = (o, label) => Object.assign({}, o, { label });
const LIB = {
  "gliding": { nome: "Scorrimento tendineo – 5 posizioni", pose: [P.dritta, P.tavola, P.gancio, P.pugnoDritto, P.pugno] },
  "gliding-3": { nome: "Scorrimento tendineo – dritte, gancio, pugno", pose: [P.dritta, P.gancio, P.pugno] },
  "gliding-4": { nome: "Scorrimento tendineo – dritte, tavola, gancio, pugno", pose: [P.dritta, P.tavola, P.gancio, P.pugno] },
  "pugno-apri": { nome: "Apri e chiudi la mano", pose: [L(P.dritta, "Apri"), L(P.pugno, "Chiudi")] },
  "polso-flex-ext": { nome: "Polso su e giù (avambraccio appoggiato)", pose: [P.polsoFlex, P.polsoExt] },
  "polso-flex-ext-micro": { nome: "Polso: piccoli movimenti in scarico", pose: [L({ v: "lato", orient: "orizzontale", tavolo: true, polso: -20 }, "Poco giù"), L({ v: "lato", orient: "orizzontale", tavolo: true, polso: 20 }, "Poco su")] },
  "deviazioni": { nome: "Polso: inclinazioni laterali", pose: [L({ v: "fronte", deviazione: -18, frecce: [{ tipo: "deviazione", verso: "radiale" }] }, "Verso il pollice"), L({ v: "fronte", deviazione: 22, frecce: [{ tipo: "deviazione", verso: "ulnare" }] }, "Verso il mignolo")] },
  "pronosupinazione": { nome: "Ruotare l’avambraccio (palmo su / giù)", pose: [L({ v: "fronte", frecce: [{ tipo: "rotazione" }] }, "Palmo su ↔ palmo giù")] },
  "ventaglio": { nome: "Apertura a ventaglio", pose: [P.ventaglio] },
  "opposizione": { nome: "Pollice tocca ogni dito", pose: [P.opposizione("indice"), P.opposizione("medio"), P.opposizione("anulare"), P.opposizione("mignolo")] },
  "pinch-moneta": { nome: "Pinza pollice-indice su piccoli oggetti", pose: [Object.assign(P.opposizione("indice"), { oggetto: "moneta", label: "Prendi la moneta" })] },
  "pollice-abd": { nome: "Pollice: allontana e avvicina", pose: [L({ v: "fronte", pollice: { abd: 15 } }, "Vicino"), L({ v: "fronte", pollice: { abd: 65 }, frecce: [{ tipo: "pollice" }] }, "Lontano")] },
  "pollice-flex": { nome: "Pollice: piegare e stendere", pose: [L({ v: "fronte", pollice: { abd: 35 } }, "Steso"), L(P.opposizione("mignolo"), "Verso il mignolo")] },
  "rotazione-pallina": { nome: "Rotazione di una pallina nel palmo (senza stringere)", pose: [L({ v: "fronte", oggetto: "pallina-rot", mcp: 15, pip: 20 }, "Fai ruotare, non stringere")] },
  "pallina": { nome: "Rotazione di una pallina nel palmo (senza stringere)", pose: [L({ v: "fronte", oggetto: "pallina-rot", mcp: 15, pip: 20 }, "Fai ruotare, non stringere")] },
  "elastico": { nome: "Elastico intorno alle dita: apri", pose: [L({ v: "fronte", oggetto: "elastico" }, "Chiuse"), L({ v: "fronte", oggetto: "elastico", ventaglio: true, frecce: [{ tipo: "apertura" }] }, "Apri")] },
  "cicatrice": { nome: "Massaggio della cicatrice", pose: [L({ v: "fronte", oggetto: "cicatrice" }, "Massaggio circolare")] },
  "elevazione": { nome: "Mano sollevata", pose: [L({ v: "lato", frecce: [{ tipo: "linea", da: [60, 200], a: [60, 120] }] }, "Sopra il cuore")] },
  "blocking-ifp": { nome: "Blocking IFP (piega la seconda falange)", pose: [L({ v: "lato", dita: { indice: { pip: 80 } }, evid: "ifp", frecce: [{ tipo: "giunto", giunto: "ifp", verso: "flex", r: 26 }] }, "Blocca sotto, piega")] },
  "blocking-ifd": { nome: "Blocking IFD (piega la punta)", pose: [L({ v: "lato", dita: { indice: { dip: 70 } }, evid: "ifd", frecce: [{ tipo: "giunto", giunto: "ifd", verso: "flex", r: 22 }] }, "Blocca, piega la punta")] },
  "estensione-ifp": { nome: "Estensione IFP", pose: [L({ v: "lato", pip: 50, dip: 20 }, "Parti piegato"), L({ v: "lato", evid: "ifp", frecce: [{ tipo: "giunto", giunto: "ifp", verso: "ext", r: 26 }] }, "Stendi")] },
  "flessione-ifp": { nome: "Flessione IFP", pose: [L({ v: "lato", evid: "ifp" }, "Dritto"), L({ v: "lato", pip: 90, dip: 40, evid: "ifp", frecce: [{ tipo: "giunto", giunto: "ifp", verso: "flex", r: 26 }] }, "Piega")] },
  "kleinert": { nome: "Flessori – Kleinert: flessione passiva / estensione attiva", pose: [L({ v: "lato", polso: 25, mcp: 60, pip: 80, dip: 50, tutore: { fino: "dita", lato: "dorsale", trazione: true } }, "L’elastico piega"), L({ v: "lato", polso: 25, mcp: 60, tutore: { fino: "dita", lato: "dorsale", trazione: true } }, "Tu stendi")] },
  "place-hold": { nome: "Flessori – Place & hold nel tutore", pose: [L({ v: "lato", polso: 25, mcp: 60, tutore: { fino: "dita", lato: "dorsale" } }, "Partenza"), L({ v: "lato", polso: 25, mcp: 70, pip: 80, dip: 50, tutore: { fino: "dita", lato: "dorsale" } }, "Posiziona e tieni")] },
  "tenodesi": { nome: "Effetto tenodesi del polso", pose: [L({ v: "lato", polso: 30, mcp: 10 }, "Polso giù: dita aperte"), L({ v: "lato", polso: -30, mcp: 60, pip: 70, dip: 40 }, "Polso su: dita chiuse")] },
  "tutore-dorsale": { nome: "Tutore dorsale di protezione (flessori)", pose: [L({ v: "lato", polso: 20, mcp: 60, tutore: { fino: "dita", lato: "dorsale" } }, "Tutore dorsale")] },
  "tutore-ifd": { nome: "Tutore per IFD in estensione (mallet)", pose: [L({ v: "lato", tutore: { solo: "ifd", lato: "dorsale" }, evid: "ifd" }, "IFD in estensione")] },
  "tutore-ifp": { nome: "Tutore/digitale per IFP", pose: [L({ v: "lato", tutore: { solo: "dito", lato: "dorsale" }, evid: "ifp" }, "Dito in estensione")] },
  "tutore-mf": { nome: "Tutore che blocca la MF (dito a scatto)", pose: [L({ v: "lato", tutore: { solo: "mano", lato: "volare" }, evid: "mf" }, "MF bloccata")] },
  "spica": { nome: "Ortesi polso-pollice (spica)", pose: [L({ v: "fronte", tutore: { tipo: "spica" } }, "Spica")] },
  "tutore-polso": { nome: "Tutore di polso", pose: [L({ v: "fronte", tutore: { tipo: "polso" } }, "Polso in posizione neutra")] },
  "mano-tavolo": { nome: "Mano appoggiata sul tavolo", pose: [L({ v: "fronte", tavolo: true }, "Mano appoggiata")] },
  "carico-tfcc": { nome: "Carico progressivo sul palmo", pose: [L({ v: "lato", orient: "orizzontale", tavolo: true, polso: 60, frecce: [{ tipo: "linea", da: [60, 40], a: [60, 90] }] }, "Spingi piano")] },
  "presa-bottiglia": { nome: "Presa cilindrica (bicchiere/bottiglia)", pose: [L({ v: "lato", mcp: 45, pip: 60, dip: 35, pollice: { abd: 35, mf: 10, ip: 10 }, oggetto: "bottiglia" }, "Presa delicata")] },
  "lateralita": { nome: "Destra o sinistra? (riconoscimento)", pose: [L({ v: "fronte", dita: { indice: { mcp: 40, pip: 40 } } }, "Destra?"), L({ v: "fronte", specchiata: true, pollice: { abd: 60 } }, "Sinistra?"), L({ v: "lato", mcp: 85, specchiata: true }, "Destra?")] },
  "immaginazione": { nome: "Immaginare il movimento", pose: [L({ v: "fronte" }, "Guarda"), L({ v: "fronte", ventaglio: true, pollice: { abd: 55 } }, "Immagina di aprire")] },
  "specchio": { nome: "Terapia allo specchio", pose: [L({ v: "fronte", specchio: true, tavolo: true }, "La mano sana davanti allo specchio"), L({ v: "fronte", specchio: true, tavolo: true, ventaglio: true, pollice: { abd: 55 } }, "Muovila e guarda il riflesso")] },
  "desensibilizzazione": { nome: "Desensibilizzazione con tessuti", pose: [L({ v: "fronte", oggetto: "tessuto" }, "Dal più morbido al più ruvido")] },
  "zona-crps": { nome: "Zona: mano intera (CRPS)", pose: [{ v: "fronte", evid: ["tunnel", "a1", "radio"], dita: { medio: { mcp: 20, pip: 25 } } }] },
  "flessione-mf": { nome: "Piegare le nocche (MF)", pose: [L(P.dritta, "Dita dritte"), L({ v: "lato", mcp: 85, evid: "mf", frecce: [{ tipo: "giunto", giunto: "mf", verso: "flex", r: 30 }] }, "Piega le nocche")] },
  "blocking-mf": { nome: "Pugno con nocche piegate (MF + IF)", pose: [L({ v: "lato", mcp: 85, evid: "mf" }, "Nocche piegate"), L({ v: "lato", mcp: 90, pip: 95, dip: 60, evid: "mf" }, "Chiudi il pugno")] },
  "tutore-flessione-mf": { nome: "Ortesi di flessione MF", pose: [L({ v: "lato", mcp: 65, tutore: { solo: "mano", lato: "volare" }, evid: "mf" }, "Nocche tenute piegate")] },
  "zona-mf": { nome: "Zona: nocche (MF)", pose: [{ v: "lato", evid: "mf", mcp: 20 }] },
  "neurodinamica-mediano": { nome: "Scorrimento del nervo mediano (braccio teso di lato)", pose: [L({ v: "lato", orient: "orizzontale", polso: 45 }, "Braccio teso, polso su"), L({ v: "lato", orient: "orizzontale", polso: -35 }, "Polso giù, poi torna")] },
  "zona-a1": { nome: "Zona: puleggia A1", pose: [{ v: "fronte", evid: "a1", dito: "anulare" }] },
  "zona-dq": { nome: "Zona: primo compartimento (De Quervain)", pose: [{ v: "fronte", evid: "dq" }] },
  "zona-tfcc": { nome: "Zona: TFCC (lato ulnare del polso)", pose: [{ v: "fronte", evid: "tfcc" }] },
  "zona-rizo": { nome: "Zona: base del pollice (rizoartrosi)", pose: [{ v: "fronte", evid: "rizo" }] },
  "zona-tunnel": { nome: "Zona: tunnel carpale", pose: [{ v: "fronte", evid: "tunnel" }] },
  "zona-dupuytren": { nome: "Zona: corda di Dupuytren", pose: [{ v: "fronte", evid: "dupuytren", dita: { anulare: { mcp: 40, pip: 50 } } }] },
  "zona-scafoide": { nome: "Zona: scafoide (tabacchiera anatomica)", pose: [{ v: "fronte", evid: "scafoide" }] },
  "zona-radio": { nome: "Zona: radio distale", pose: [{ v: "fronte", evid: "radio" }] },
  "zona-ifp": { nome: "Zona: interfalangea prossimale", pose: [{ v: "lato", evid: "ifp", pip: 30 }] },
  "zona-flessori": { nome: "Zona: tendini flessori", pose: [{ v: "fronte", evid: "flessori" }] },
  "zona-estensori": { nome: "Zona: tendini estensori", pose: [{ v: "lato", evid: "ifd", dita: { indice: { dip: 40 } } }] },
  "zona-gonfiore": { nome: "Mano sollevata (edema)", pose: [{ v: "lato", frecce: [{ tipo: "linea", da: [60, 200], a: [60, 120] }] }] },
};
/* accetta: chiave della libreria, elenco di chiavi/pose, o una posa */
function risolvi(d) {
  if (!d) return null;
  if (typeof d === "string") return LIB[d] ? LIB[d].pose : null;
  if (Array.isArray(d)) return d.flatMap((x) => (typeof x === "string" ? (LIB[x] ? LIB[x].pose : []) : [x]));
  return [d];
}
window.RH_ILL = { disegno, one, P, LIB, risolvi };
})();
