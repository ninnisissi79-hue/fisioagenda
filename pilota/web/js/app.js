/* FisioAgenda pilota — avvio. */
window.addEventListener('DOMContentLoaded', () => { window.FA.boot(); });

/* App installabile su cellulare e PC (web app): icona, finestra propria, aggiornamenti automatici. */
(function () {
  const FA = window.FA;
  let deferred = null;
  FA.isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  FA.isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  /** pulsante «Installa app»: dove il browser lo permette subito, oppure su iPhone/iPad con le istruzioni */
  FA.canInstall = () => !FA.isStandalone() && (!!deferred || FA.isIOS());
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (FA.render) FA.render(true); });
  window.addEventListener('appinstalled', () => { deferred = null; FA.toast('FisioAgenda è installata: la trovi tra le tue app.', 'ok'); FA.render(true); });
  const HOW = '<p>FisioAgenda si installa come un’app: icona sulla schermata Home o sul desktop, si apre a schermo intero e si aggiorna da sola. Serve comunque la connessione a internet.</p>' +
    '<h4>📱 iPhone o iPad (Safari)</h4><ol><li>Apri FisioAgenda con <strong>Safari</strong>.</li><li>Tocca <strong>Condividi</strong> (il quadrato con la freccia in su).</li><li>Scegli <strong>Aggiungi alla schermata Home</strong> → <strong>Aggiungi</strong>.</li></ol>' +
    '<h4>📱 Android (Chrome)</h4><ol><li>Apri FisioAgenda con <strong>Chrome</strong>.</li><li>Tocca il menu <strong>⋮</strong> in alto a destra.</li><li>Scegli <strong>Installa app</strong> (o <strong>Aggiungi a schermata Home</strong>).</li></ol>' +
    '<h4>💻 PC (Chrome o Edge)</h4><ol><li>Apri FisioAgenda.</li><li>Nella barra dell’indirizzo clicca l’icona <strong>Installa</strong> (un monitor con la freccia), oppure menu <strong>⋮</strong> / <strong>…</strong> → <strong>Installa FisioAgenda</strong> (in Edge: <strong>App → Installa questo sito come app</strong>).</li><li>La trovi nel menu Start e puoi fissarla sulla barra delle applicazioni.</li></ol>' +
    '<p class="small muted">Su un computer condiviso ricordati di premere «Esci» alla fine.</p>';
  FA.actions['install-app'] = async () => {
    if (deferred) {
      const d = deferred; deferred = null;
      d.prompt();
      try { await d.userChoice; } catch (e) { /* annullato */ }
      FA.render(true); return;
    }
    FA.openModal({ title: 'Installa FisioAgenda come app', body: () => HOW, foot: () => '<button class="btn primary" data-act="close-modal">Ho capito</button>' });
  };
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* il sito funziona anche senza */ }); });
  }
})();
