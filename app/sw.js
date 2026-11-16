/* Service worker: l'app funziona anche senza internet. L'elenco aggiornamenti si scarica sempre fresco. */
const CACHE = "rehand-v1";
const SHELL = ["./", "index.html", "app.css", "sheets.css", "app.js", "data/seed.js", "vendor/qrcode.js", "aggiornamenti.js", "manifest.webmanifest",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/logo/ats-liguria.png", "assets/logo/asl2-ats.png",
  "assets/logo/rehand-more-mind.png", "assets/img/dito-a-scatto.png", "assets/img/de-quervain.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.endsWith("aggiornamenti.json")) return; // sempre dalla rete (l'app tiene una copia propria)
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
