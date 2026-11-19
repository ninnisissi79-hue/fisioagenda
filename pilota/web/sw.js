// FisioAgenda come app installabile (cellulare e PC).
// Strategia «prima la rete»: se c'è connessione si usa sempre la versione più recente del sito
// (così ogni aggiornamento caricato su Netlify arriva subito); senza rete si apre l'ultima copia salvata.
// I dati (Supabase) non passano mai di qui: non vengono salvati sul dispositivo.
const CACHE = 'fisioagenda-v1';
const SHELL = ['./', 'index.html', 'config.js', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/vendor/supabase.js', 'js/engine.js', 'js/sheet.js', 'js/store.js', 'js/app-core.js', 'js/app-absence.js', 'js/app-cal.js',
  'js/app-config.js', 'js/app-planner.js', 'js/app-subs.js', 'js/app-tab.js', 'js/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => null).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase e altri servizi: sempre diretti
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
