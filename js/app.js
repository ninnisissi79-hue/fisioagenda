/*
 * FisioAgenda — interfaccia.
 * Tutte le regole di disponibilità sono in engine.js: qui c'è solo presentazione e interazione.
 */
(function () {
  'use strict';
  const E = window.FisioEngine, D = window.FisioDemo;
  const KEY = 'fisioagenda.v1';
  const DAY_START = 7 * 60, DAY_END = 15 * 60 + 20, PX = 1.25; // agenda: 07:00–15:20

  /* ================================================================== */
  /* Utilità                                                              */
  /* ================================================================== */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => E.todayRome();
  const dLabel = d => d ? E.WEEKDAY_SHORT[E.weekday(d)] + ' ' + E.fmtIt(d) : '—';
  const dShort = d => d ? E.WEEKDAY_SHORT[E.weekday(d)] + ' ' + E.fmtItShort(d) : '—';
  const hm = m => E.fromMin(m);
  const catName = id => { const c = state.categories.find(x => x.id === id); return c ? c.name : '(categoria rimossa)'; };
  const thById = id => state.therapists.find(t => t.id === id);
  const thName = id => { const t = thById(id); return t ? t.name : '?'; };
  const pathById = id => state.paths.find(p => p.id === id);
  const patientOfPath = p => p ? state.patients.find(x => x.id === p.patientId) : null;
  const ptName = pathId => { const pt = patientOfPath(pathById(pathId)); return pt ? pt.name : '?'; };
  const profileShort = p => ({ reparto7: 'Turno 7:00 · reparto', reparto8: 'Turno 8:00 · reparto', ambulatorio: 'Solo ambulatorio' }[p] || p);
  function nextWorkingDay(from) {
    let d = E.addDays(from, 1);
    const cl = new Set(state.closures.map(c => c.date));
    while (E.weekday(d) > 5 || cl.has(d)) d = E.addDays(d, 1);
    return d;
  }
  function tag(kind, text, title) { return '<span class="tag ' + kind + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</span>'; }
  const TAG = {
    ok: t => tag('ok', '✓ ' + (t || 'Confermato')),
    prob: t => tag('prob', '? ' + (t || 'Probabile')),
    ext: t => tag('ext', '◐ ' + (t || 'Da confermare')),
    bad: t => tag('bad', '⚠ ' + (t || 'Conflitto')),
    prot: t => tag('prot', '▨ ' + t)
  };
  const SESSION_TAG = {
    programmata: () => tag('info', 'Programmata'),
    effettuata: () => tag('ok', '✓ Effettuata'),
    assente: () => tag('prob', 'Assenza paziente'),
    annullata: () => tag('plain', 'Annullata dal servizio'),
    da_recuperare: () => tag('bad', '↺ Da recuperare'),
    recuperata: () => tag('plain', '↺ Recuperata')
  };
  const FORECAST_TAG = {
    da_valutare: () => tag('prob', '? Da valutare'),
    prosecuzione: () => tag('info', '→ Prosecuzione prevista'),
    probabile_conclusione: () => tag('prob', '◔ Probabile conclusione'),
    conclusione_confermata: () => tag('ok', '✓ Conclusione confermata'),
    sospensione: () => tag('plain', '⏸ Sospensione'),
    interruzione: () => tag('plain', '■ Interruzione'),
    non_avviato: () => tag('plain', '○ Non avviato')
  };
  const WL_TAG = {
    in_attesa: () => tag('prob', 'In attesa'), contattato: () => tag('info', 'Contattato'),
    proposta: () => tag('ext', 'Proposta in valutazione'), assegnato: () => tag('ok', '✓ Assegnato'), rinuncia: () => tag('plain', 'Rinuncia')
  };
  /* Categoria di priorità (scelta dall'operatore, solo organizzativa) e tipo di richiesta */
  const PRIO_TAG_KIND = { U: 'bad', B: 'prob', D: 'info', P: 'plain', NI: 'plain' };
  function prioTag(code) {
    const c = E.PRIORITY_CLASSES[code] ? code : 'NI';
    return tag(PRIO_TAG_KIND[c], (c === 'NI' ? '○ ' : '') + esc(E.PRIORITY_CLASSES[c]), 'Priorità organizzativa scelta dall\'operatore');
  }
  const prioOptions = () => E.PRIORITY_ORDER.map(k => [k, E.PRIORITY_CLASSES[k]]);
  const reqTypeName = k => E.REQUEST_TYPES[k] || '—';
  const PRIO_NOTE = 'Categoria scelta dall\'operatore in base alla richiesta: evidenzia la priorità organizzativa e non è una verifica dei tempi previsti dalla normativa.';
  function optionsHtml(list, selected) {
    return list.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  }
  function timeOptions(selected, from, to, step) {
    const out = [];
    for (let m = E.toMin(from || '07:00'); m <= E.toMin(to || '15:15'); m += (step || 5)) out.push([hm(m), hm(m)]);
    if (selected && !out.some(o => o[0] === selected)) out.push([selected, selected]);
    return optionsHtml(out, selected);
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ================================================================== */
  /* Salvataggio (locale nel browser)                                    */
  /* ================================================================== */
  const Store = {
    ok: true,
    load() {
      try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); }
      catch (e) { this.ok = false; }
      return null;
    },
    save(st) {
      try { localStorage.setItem(KEY, JSON.stringify(st)); this.ok = true; return true; }
      catch (e) { this.ok = false; toast('Attenzione: salvataggio nel browser non riuscito. Esporta i dati per non perderli.', 'bad'); return false; }
    }
  };
  let upgradeNotes = []; // aggiornamenti fatti ai dati salvati con la versione precedente
  let state = Store.load();
  let firstRun = false;
  let migratedAmb = 0;
  if (!state || !state.therapists) { state = D.generateDemo(); Store.save(state); firstRun = true; }
  normalizeState(state);
  function normalizeState(st) {
    st.settings = Object.assign(E.clone(E.DEFAULT_SETTINGS), st.settings || {});
    ['closures', 'absences', 'patients', 'paths', 'cycles', 'sessions', 'waitlist', 'log', 'categories'].forEach(k => { st[k] = st[k] || []; });
    st.meta = st.meta || {};
    const up = E.upgradeState(st);
    if (up.length) { up.forEach(c => E.addLog(st, 'Aggiornamento dati: ' + c)); upgradeNotes = upgradeNotes.concat(up); }
    // aggiornamento: orari reali dei colleghi solo ambulatoriali (prima erano esempi)
    if (!st.settings.templates.ambulatorio) {
      st.settings.templates.ambulatorio = E.clone(E.DEFAULT_SETTINGS.templates.ambulatorio);
      let n = 0;
      st.therapists.forEach(t => {
        if (t.profile === 'ambulatorio' && /Orari di esempio/.test(t.note || '')) {
          t.week = E.buildWeek('ambulatorio', st.settings);
          t.note = 'Solo ambulatorio: pazienti 8:15–14:40 (fino alle 14:45 con estensione), 6–8 pazienti al giorno.';
          if (!t.maxPatientsDay) t.maxPatientsDay = 8;
          n++;
        }
      });
      if (n) { E.addLog(st, 'Aggiornati gli orari reali di ' + n + ' colleghi solo ambulatoriali (8:00–15:12, pausa 12:20–12:40)'); migratedAmb = n; }
    }
  }
  function commit(newState, msg) {
    state = newState;
    Store.save(state);
    if (msg) toast(msg, 'ok');
    render();
  }
  /** Rilegge lo stato salvato (un'altra scheda potrebbe averlo modificato) prima di confermare. */
  function fresh() { const s = Store.load(); if (s) { state = s; normalizeState(state); } return state; }
  window.addEventListener('storage', e => {
    if (e.key === KEY) { const s = Store.load(); if (s) { state = s; normalizeState(state); ui.results = null; toast('Dati aggiornati da un\'altra scheda del browser: ripeti la ricerca.'); render(); } }
  });

  /* ================================================================== */
  /* Stato dell'interfaccia                                               */
  /* ================================================================== */
  function defaultSearch() {
    return {
      name: '', categoryId: (state.categories[0] || {}).id || '', duration: state.settings.defaultDuration || 30,
      freq: 'lmv', weekdays: [1, 3, 5], sessionsMode: '10', sessionsCustom: 20, earliestDate: nextWorkingDay(today()),
      prefOn: false, prefFrom: '12:00', prefTo: '14:45', prefMode: 'flessibile', waitlistId: null,
      priority: 'NI', requestType: 'prima'
    };
  }
  const ui = {
    search: defaultSearch(), results: null, gaps: null, tab: 'disponibile', expanded: {}, sort: 'competenza',
    agenda: { mode: 'giorno', date: null, group: 'tutti', therapistId: null, highlightPath: null },
    wlPrio: 'tutte', wlSort: 'priorita',
    modal: null, wlFilter: 'attivi', pathFilter: '', pathState: 'attivi', thDraft: null, absForm: null, settingsTab: 'parametri'
  };
  let modalCallbacks = {};

  /* ================================================================== */
  /* Toast e modali                                                       */
  /* ================================================================== */
  function toast(text, kind) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4000);
  }
  function openModal(m) { ui.modal = m; renderModal(); }
  function closeModal() { ui.modal = null; modalCallbacks = {}; renderModal(); }
  function confirmBox(title, html, okLabel, onOk, opts) {
    modalCallbacks.ok = onOk;
    openModal({ type: 'confirm', title, html, okLabel: okLabel || 'Conferma', danger: opts && opts.danger });
  }
  function renderModal() {
    let root = document.getElementById('modal-root');
    if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
    if (!ui.modal) { root.innerHTML = ''; return; }
    const m = ui.modal;
    const view = MODALS[m.type];
    const r = view(m);
    root.innerHTML = '<div class="modal-bg" data-act="modal-bg"><div class="modal ' + (r.wide ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(r.title) + '">' +
      '<div class="modal-head"><h3>' + r.title + '</h3><button class="close-x" data-act="close-modal" aria-label="Chiudi">×</button></div>' +
      '<div class="modal-body">' + r.body + '</div>' +
      (r.foot ? '<div class="modal-foot">' + r.foot + '</div>' : '') + '</div></div>';
    const f = root.querySelector('[autofocus]'); if (f) f.focus();
  }

  /* ================================================================== */
  /* Navigazione                                                          */
  /* ================================================================== */
  const ROUTES = [
    ['trova', 'Trova un posto', '🔎'], ['agenda', 'Agenda', '📅'], ['lista', 'Lista d\'attesa', '⏳'],
    ['pazienti', 'Pazienti e cicli', '👥'], ['previsioni', 'Previsioni', '🔮'], ['assenze', 'Ferie e malattie', '🏖'],
    ['fisioterapisti', 'Fisioterapisti', '🩺'], ['impostazioni', 'Impostazioni', '⚙']
  ];
  function parseHash() {
    const h = (location.hash || '#/trova').replace(/^#\/?/, '').split('/');
    return [h[0] || 'trova', h[1] ? decodeURIComponent(h[1]) : null];
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  window.addEventListener('hashchange', () => {
    const app = document.querySelector('.app'); if (app) app.classList.remove('menu-open');
    ui.modal = null; modalCallbacks = {}; // cambiando sezione si chiude l'eventuale finestra aperta
    render(true);
  });

  let lastRoute = null;
  function render(routeChanged) {
    const [route, param] = parseHash();
    const sameRoute = lastRoute === route + '/' + param;
    const scrollY = window.scrollY;
    const cal = document.querySelector('.cal');
    const calScroll = cal ? [cal.scrollLeft, cal.scrollTop] : null;
    const view = VIEWS[route] || VIEWS.trova;
    let body;
    try { body = view(param); }
    catch (e) { console.error(e); body = '<div class="notice bad">Errore nella visualizzazione: ' + esc(e.message) + '</div>'; }
    const conf = E.conflicts(state).length;
    const alerts = E.forecastOverview(state).filter(r => r.alerts.some(a => a.code !== 'esiti')).length;
    const wl = state.waitlist.filter(w => ['in_attesa', 'contattato', 'proposta'].includes(w.status)).length;
    const counts = { assenze: conf ? '<span class="count red" title="Appuntamenti in conflitto">' + conf + '</span>' : '', previsioni: alerts ? '<span class="count" title="Previsioni da aggiornare">' + alerts + '</span>' : '', lista: wl ? '<span class="count" title="Pazienti in attesa">' + wl + '</span>' : '' };
    const title = (ROUTES.find(r => r[0] === route) || ROUTES[0])[1];
    document.getElementById('app').innerHTML =
      '<div class="app">' +
      '<aside class="sidebar"><div class="brand"><div class="brand-logo">F</div><div><div class="brand-name">FisioAgenda</div><div class="brand-sub">Ambulatorio di fisioterapia</div></div></div>' +
      '<nav class="nav">' + ROUTES.map(r => '<a href="#/' + r[0] + '" class="' + (route === r[0] ? 'active ' : '') + (r[0] === 'trova' ? 'primary-link' : '') + '"><span>' + r[2] + ' ' + r[1] + '</span>' + (counts[r[0]] || '') + '</a>').join('') + '</nav>' +
      '<div class="side-note"><b>Demo con dati fittizi.</b><br>Ogni visitatore lavora sulla propria copia, salvata solo in questo browser e non condivisa.' + (Store.ok ? '' : '<br><b style="color:#f97066">Salvataggio non disponibile!</b>') + '</div></aside>' +
      '<div class="main"><header class="topbar"><div class="btn-row"><button class="btn sm menu-btn" data-act="menu" aria-label="Menu">☰</button><span class="title">' + esc(title) + '</span></div>' +
      '<div class="btn-row"><span class="demo-pill" title="Nomi e pazienti inventati">DEMO · dati fittizi</span><span class="muted small nowrap">Oggi: ' + dLabel(today()) + '</span></div></header>' +
      '<div class="public-banner" role="note"><span><b>⚠ Demo con dati fittizi: non inserire dati reali.</b> ' +
      'Ogni visitatore modifica soltanto la propria copia, salvata in questo browser: le modifiche non sono visibili ad altri e nessun dato viene inviato.</span>' +
      '<button class="btn sm" data-act="reset-demo">↺ Ripristina esempi</button></div>' +
      '<main class="content">' + body + '</main></div></div>';
    if (sameRoute && !routeChanged) {
      window.scrollTo(0, scrollY);
      const c2 = document.querySelector('.cal');
      if (c2 && calScroll) { c2.scrollLeft = calScroll[0]; c2.scrollTop = calScroll[1]; }
    } else {
      window.scrollTo(0, 0);
      const hl = document.querySelector('.appt.hl');
      if (hl) hl.scrollIntoView({ block: 'center', inline: 'center' });
    }
    lastRoute = route + '/' + param;
    renderModal();
  }

  /* ================================================================== */
  /* VISTA: Trova un posto                                                */
  /* ================================================================== */
  function buildRequest() {
    const s = ui.search;
    const sessions = s.sessionsMode === 'altro' ? Number(s.sessionsCustom) : Number(s.sessionsMode);
    return {
      categoryId: s.categoryId, duration: Number(s.duration), weekdays: s.weekdays.slice().sort(), sessions,
      earliestDate: s.earliestDate, sort: ui.sort,
      pref: s.prefOn ? { from: s.prefFrom, to: s.prefTo, mode: s.prefMode } : null
    };
  }
  function validateRequest(req) {
    const errs = [];
    if (!req.categoryId) errs.push('Scegli la patologia / il percorso.');
    if (!req.weekdays.length) errs.push('Scegli almeno un giorno della settimana.');
    if (!(req.sessions >= 1 && req.sessions <= 60)) errs.push('Il numero di sedute deve essere tra 1 e 60.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.earliestDate || '')) errs.push('Indica la prima data utile.');
    if (req.pref && E.toMin(req.pref.to) - E.toMin(req.pref.from) < req.duration) errs.push('La fascia oraria preferita è più corta della durata della seduta.');
    return errs;
  }
  function runSearch() {
    const req = buildRequest();
    const errs = validateRequest(req);
    if (errs.length) { toast(errs.join(' '), 'bad'); return; }
    const t0 = performance.now();
    ui.results = E.search(state, req);
    ui.gaps = E.findGaps(state, { categoryId: req.categoryId, duration: req.duration, fromDate: req.earliestDate });
    ui.results.ms = Math.round(performance.now() - t0);
    ui.expanded = {};
    const c = summarize(ui.results);
    ui.tab = c.disponibile.th ? 'disponibile' : c.futuro_confermato.th ? 'futuro_confermato' : c.futuro_probabile.th ? 'futuro_probabile' : 'buchi';
    render();
    const r = document.getElementById('results'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function summarize(res) {
    const out = {};
    for (const c of ['disponibile', 'futuro_confermato', 'futuro_probabile']) {
      const gs = res.groups.filter(g => g.counts[c] > 0);
      out[c] = { th: gs.length, seats: gs.reduce((n, g) => n + g.independent[c], 0), alts: gs.reduce((n, g) => n + g.counts[c], 0) };
    }
    return out;
  }

  const VIEWS = {};
  VIEWS.trova = function () {
    const s = ui.search;
    const wl = s.waitlistId ? state.waitlist.find(w => w.id === s.waitlistId) : null;
    const cats = state.categories.map(c => [c.id, c.name]);
    const presets = state.settings.sessionPresets || [5, 10, 20, 30];
    let h = '';
    if (firstRun || !state.meta.hideGuide) {
      h += '<div class="notice info"><b>Prima prova in 4 passaggi:</b> 1) scrivi un nome di fantasia e scegli il percorso; 2) premi <b>Cerca disponibilità</b>; ' +
        '3) nei risultati, i colleghi con <b>competenza specifica</b> sono in alto, e accanto a ciascuno trovi se il posto è ' + TAG.ok('confermato') + ' o ' + TAG.prob('probabile') + '; ' +
        '4) premi <b>Conferma</b> su una proposta certa e la ritrovi in <b>Agenda</b>. ' +
        '<button class="btn link" data-act="hide-guide">Nascondi</button></div>';
    }
    if (wl) {
      h += '<div class="notice warn">Dati caricati dalla <b>lista d\'attesa</b>: <b>' + esc(wl.name) + '</b> · inserito il ' + E.fmtIt(wl.insertedAt) +
        ' (' + E.diffDays(wl.insertedAt, today()) + ' giorni di attesa) · priorità ' + prioTag(wl.priority) + ' · ' + esc(reqTypeName(wl.requestType)) + (wl.availabilityNote ? ' · ' + esc(wl.availabilityNote) : '') +
        ' <button class="btn link" data-act="search-reset">Scollega e svuota</button></div>';
    }
    h += '<section class="panel"><div class="panel-head"><h2>Trova un posto</h2><span class="muted small">Stesso fisioterapista e stesso orario per tutto il ciclo</span></div>' +
      '<form class="search-form" data-form="search" autocomplete="off">' +
      '<div class="field sf-name"><label class="lbl" for="sf-name">Paziente (nome o identificativo)</label><input id="sf-name" class="input" data-bind="search.name" value="' + esc(s.name) + '" placeholder="es. Rossi M. oppure ID 1234"></div>' +
      '<div class="field sf-cat"><label class="lbl" for="sf-cat">Patologia / percorso</label><select id="sf-cat" class="input" data-bind="search.categoryId">' + optionsHtml(cats, s.categoryId) + '</select></div>' +
      '<div class="field sf-dur"><span class="lbl">Durata</span><div class="seg">' +
      [30, 45].map(d => '<label><input type="radio" name="dur" value="' + d + '" data-bind="search.duration" data-type="num"' + (Number(s.duration) === d ? ' checked' : '') + '><span>' + d + ' min</span></label>').join('') + '</div></div>' +
      '<div class="field sf-freq"><span class="lbl">Frequenza settimanale</span><div class="seg">' +
      [['lmv', 'Lun-Mer-Ven'], ['mg', 'Mar-Gio'], ['custom', 'Personalizzata']].map(([v, l]) => '<label><input type="radio" name="freq" value="' + v + '" data-act="freq"' + (s.freq === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div>' +
      (s.freq === 'custom' ? '<div class="wd-pick">' + [1, 2, 3, 4, 5].map(d => '<label><input type="checkbox" value="' + d + '" data-act="wd"' + (s.weekdays.includes(d) ? ' checked' : '') + '><span>' + E.WEEKDAY_SHORT[d] + '</span></label>').join('') + '</div>' : '') + '</div>' +
      '<div class="field sf-ses"><span class="lbl">Sedute previste</span><div class="seg">' +
      presets.map(n => '<label><input type="radio" name="ses" value="' + n + '" data-act="ses"' + (s.sessionsMode === String(n) ? ' checked' : '') + '><span>' + n + '</span></label>').join('') +
      '<label><input type="radio" name="ses" value="altro" data-act="ses"' + (s.sessionsMode === 'altro' ? ' checked' : '') + '><span>Altro</span></label></div>' +
      (s.sessionsMode === 'altro' ? '<input type="number" min="1" max="60" class="input" style="margin-top:6px;width:110px" data-bind="search.sessionsCustom" data-type="num" value="' + esc(s.sessionsCustom) + '" aria-label="Numero di sedute">' : '') + '</div>' +
      '<div class="field sf-date"><label class="lbl" for="sf-date">Prima data utile</label><input id="sf-date" type="date" class="input" data-bind="search.earliestDate" data-rerender="1" value="' + esc(s.earliestDate) + '"><div class="field-help">' + dLabel(s.earliestDate) + '</div></div>' +
      '<div class="field sf-pref"><span class="lbl">Fascia oraria preferita (facoltativa)</span><div class="pref-box">' +
      '<label class="chk"><input type="checkbox" data-act="pref-on"' + (s.prefOn ? ' checked' : '') + '> indica</label>' +
      (s.prefOn ? '<span>dalle</span><select class="input" data-bind="search.prefFrom" aria-label="dalle">' + timeOptions(s.prefFrom, '07:00', '15:00', 15) + '</select><span>alle</span><select class="input" data-bind="search.prefTo" aria-label="alle">' + timeOptions(s.prefTo, '07:15', '15:15', 15) + '</select>' +
        '<div class="seg">' + [['flessibile', 'Preferenza flessibile'], ['obbligatoria', 'Vincolo obbligatorio']].map(([v, l]) => '<label><input type="radio" name="pm" value="' + v + '" data-bind="search.prefMode"' + (s.prefMode === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div>'
        : '<span class="muted small">Nessuna preferenza: tutti gli orari ambulatoriali</span>') + '</div></div>' +
      '<div class="field sf-prio"><label class="lbl" for="sf-prio">Priorità</label><select id="sf-prio" class="input" data-bind="search.priority">' + optionsHtml(prioOptions(), s.priority) + '</select></div>' +
      '<div class="field sf-rt"><span class="lbl">Tipo di richiesta</span><div class="seg">' + Object.entries(E.REQUEST_TYPES).map(([v, l]) => '<label><input type="radio" name="rt" value="' + v + '" data-bind="search.requestType"' + (s.requestType === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div></div>' +
      '<div class="field sf-prio-note field-help">' + PRIO_NOTE + '</div>' +
      '<div class="field sf-go btn-row"><button type="submit" class="btn primary big">🔎 Cerca disponibilità</button>' +
      '<button type="button" class="btn" data-act="search-to-waitlist">＋ Salva in lista d\'attesa</button><button type="button" class="btn" data-act="search-reset">Nuova ricerca</button>' +
      '<span class="muted small">Le disponibilità sono calcolate in minuti da fasce, appuntamenti, assenze, chiusure e previsioni.</span></div>' +
      '</form></section>';
    h += renderResults();
    return h;
  };

  function renderResults() {
    const res = ui.results;
    if (!res) return '';
    rctx = E.makeContext(state);
    const req = res.request;
    const c = summarize(res);
    const gapCount = (ui.gaps || []).reduce((n, g) => n + g.items.length, 0);
    const card = (key, cls, label, desc, n, sub) => '<button class="scard ' + cls + (ui.tab === key ? ' active' : '') + '" data-act="tab" data-tab="' + key + '"><div class="n">' + n + '</div><div class="l">' + label + '</div><div class="d">' + sub + '</div><div class="d">' + desc + '</div></button>';
    let h = '<section class="panel" id="results"><div class="panel-head"><h2>Risultati</h2><span class="muted small">' +
      esc(catName(req.categoryId)) + ' · ' + req.duration + ' min · ' + E.weekdaysLabel(req.weekdays) + ' · ' + req.sessions + ' sedute · dal ' + E.fmtIt(req.earliestDate) +
      (req.pref ? ' · preferenza ' + req.pref.from + '–' + req.pref.to + ' (' + req.pref.mode + ')' : '') + ' · calcolato in ' + res.ms + ' ms</span></div>';
    h += '<div class="summary-cards">' +
      card('disponibile', 'ok', '✓ Disponibili per nuovi cicli', 'inizio entro ' + state.settings.futureThresholdDays + ' giorni, prenotabili', c.disponibile.th + ' colleghi', c.disponibile.seats + ' posti indipendenti (' + c.disponibile.alts + ' orari)') +
      card('futuro_confermato', 'fut', '✓ Posti futuri confermati', 'liberi con certezza da una data successiva', c.futuro_confermato.th + ' colleghi', c.futuro_confermato.seats + ' posti indipendenti') +
      card('futuro_probabile', 'prob', '? Posti futuri probabili', 'dipendono da conclusioni non confermate: non prenotabili', c.futuro_probabile.th + ' colleghi', c.futuro_probabile.seats + ' posti indipendenti') +
      card('buchi', 'gap', '◻ Buchi singoli per recuperi', 'prossimi ' + state.settings.gapDays + ' giorni, non bastano per un ciclo', gapCount + ' spazi', 'sedute isolate o recuperi') + '</div>';
    if (ui.tab === 'buchi') h += renderGaps();
    else h += renderGroupTable(res, ui.tab);
    // esclusi
    h += '<details class="why" style="margin-top:12px"><summary>Colleghi non proposti per questa ricerca (' + res.excluded.length + ') e motivo</summary><div class="table-wrap"><table class="t"><thead><tr><th>Fisioterapista</th><th>Motivo</th></tr></thead><tbody>' +
      res.excluded.map(x => '<tr><td class="who">' + esc(x.therapist.name) + (x.kind ? ' ' + (x.kind === 'specifica' ? tag('info', '★ Competenza') : tag('plain', 'Idoneo')) : '') + '</td><td>' + esc(x.reason) + '</td></tr>').join('') + '</tbody></table></div></details>';
    h += '</section>';
    return h;
  }

  function availabilityTag(o) {
    if (o.status === 'ok') return TAG.ok(o.category === 'futuro_confermato' ? 'Futuro confermato' : 'Confermata');
    if (o.status === 'ext') return TAG.ext('Da confermare') + '<div class="small" style="color:var(--ext)">usa l\'estensione della fascia</div>';
    return TAG.prob('Probabile');
  }
  function prefTag(o, req) {
    if (!req.pref) return '<span class="muted small">—</span>';
    return o.pref.level === 0 ? tag('ok', '✓ Compatibile') : o.pref.level === 1 ? tag('prob', '◐ Parziale') : tag('plain', 'Fuori fascia');
  }
  let rctx = null; // contesto del motore riusato durante il disegno dei risultati
  function conditionsHtml(o) {
    const li = [];
    o.deps.forEach(d => {
      const p = pathById(d.pathId);
      const last = p ? rctx.lastDateByPath.get(p.id) : null;
      li.push('<li class="warn">Dipende da <b>' + esc(ptName(d.pathId)) + '</b> (' + esc(p ? thName(p.therapistId) : '') + (p ? ', ' + E.weekdaysLabel(p.weekdays) + ' ' + p.startTime : '') + ', ultima seduta ' + E.fmtItShort(last) + '): ' + esc(d.why) + '</li>');
    });
    if (o.extDates.length) li.push('<li class="ext">Usa la fascia di estensione in ' + o.extDates.length + ' date. ' + esc(o.extDates[0].info.text) + '</li>');
    o.warnings.slice(0, 2).forEach(w => li.push('<li class="warn">' + E.fmtItShort(w.date) + ': ' + esc(w.text) + '</li>'));
    if (o.warnings.length > 2) li.push('<li class="warn">… altri ' + (o.warnings.length - 2) + ' avvisi</li>');
    if (o.skipped.length) li.push('<li>Salta ' + o.skipped.map(s => E.fmtItShort(s.date) + ' (' + esc(s.label.replace(/ \(esempio modificabile\)/, '')) + ')').join(', ') + '</li>');
    if (!li.length) li.push('<li>Nessuna condizione</li>');
    return '<ul class="cond">' + li.join('') + '</ul>';
  }
  function optionRow(g, o, idx, req, isSub, moreBtn) {
    const th = g.therapist;
    const actions = '<div class="act-col">' +
      (o.bookable
        ? '<button class="btn sm ' + (o.status === 'ext' ? 'extb' : 'ok') + '" data-act="confirm-option" data-th="' + th.id + '" data-idx="' + idx + '">' + (o.status === 'ext' ? 'Conferma…' : '✓ Conferma') + '</button>'
        : '<button class="btn sm" disabled title="Posto probabile: non prenotabile in modo definitivo">Conferma</button><button class="btn sm warn" data-act="preaccordo" data-th="' + th.id + '" data-idx="' + idx + '">Preaccordo</button>') +
      '<button class="btn sm" data-act="show-cycle" data-th="' + th.id + '" data-idx="' + idx + '">📅 Calendario</button></div>';
    return '<tr class="' + (isSub ? 'sub' : 'group-row') + '">' +
      '<td style="min-width:160px">' + (isSub ? '<span class="muted small">↳ altro orario con ' + esc(th.name) + '</span>' : '<div class="who">' + esc(th.name) + '</div>' + (g.kind === 'specifica' ? tag('info', '★ Competenza specifica') : tag('plain', 'Altra idoneità')) + '<div class="muted small">' + profileShort(th.profile) + '</div>' + (moreBtn || '')) + '</td>' +
      '<td class="nowrap">' + E.weekdaysLabel(req.weekdays) + ' <b style="font-size:1.05rem">' + hm(o.start) + '–' + hm(o.end) + '</b><div class="small">dal <b>' + dLabel(o.startDate) + '</b></div><div class="small muted">ultima ' + dLabel(o.endDate) + '</div></td>' +
      '<td>' + availabilityTag(o) + (req.pref ? '<div style="margin-top:4px">' + prefTag(o, req) + '</div>' : '') + '</td>' +
      '<td style="min-width:200px">' + conditionsHtml(o) +
      '<details class="why"><summary>Perché è compatibile</summary><ul class="cond">' + o.explanation.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></details></td>' +
      '<td>' + actions + '</td></tr>';
  }
  function renderGroupTable(res, cat) {
    const req = res.request;
    const groups = res.groups.filter(g => g.counts[cat] > 0).sort((a, b) => E.compareGroups(a, b, ui.sort, cat));
    let h = '<div class="result-tools"><div class="legend">' +
      (cat === 'futuro_probabile' ? '<span class="notice warn" style="margin:0">Posti <b>probabili</b>: si liberano solo se si confermano le conclusioni indicate. Non si possono prenotare in modo definitivo; puoi registrare un <b>preaccordo</b>.</span>'
        : cat === 'futuro_confermato' ? '<span class="muted small">Posti certi, disponibili da una data successiva (es. dopo una conclusione confermata o un rientro noto).</span>'
          : '<span class="muted small">Prima i colleghi con competenza specifica, poi gli altri idonei. Le alternative sovrapposte contano come un solo posto.</span>') + '</div>' +
      '<label class="small">Ordina: <select class="input" style="width:auto;display:inline-block" data-act="sort">' + optionsHtml([['competenza', 'Competenza, poi preferenza e data'], ['data', 'Prima disponibilità assoluta']], ui.sort) + '</select></label></div>';
    if (!groups.length) return h + '<div class="empty">Nessun collega in questa categoria. Prova le altre schede qui sopra, una data diversa o una fascia oraria più ampia.</div>';
    h += '<div class="table-wrap"><table class="t"><thead><tr><th>Fisioterapista e idoneità</th><th>Giorni, orario, prima e ultima seduta</th><th>Disponibilità' + (req.pref ? ' e preferenza' : '') + '</th><th>Condizioni / problemi</th><th>Azioni</th></tr></thead><tbody>';
    for (const g of groups) {
      const list = g.options.map((o, i) => ({ o, i })).filter(x => x.o.category === cat);
      const key = g.therapist.id + '|' + cat;
      const open = ui.expanded[key];
      const more = list.length > 1 ? '<div style="margin-top:6px"><button class="expander" data-act="expand" data-key="' + key + '">' + (open ? '▾ nascondi altri orari' : '▸ altri ' + (list.length - 1) + ' orari') + '</button><div class="muted small" title="Le alternative sovrapposte contano una volta sola">' + g.independent[cat] + (g.independent[cat] === 1 ? ' posto indipendente' : ' posti indipendenti') + '</div></div>' : '<div class="muted small" style="margin-top:6px">1 posto</div>';
      h += optionRow(g, list[0].o, list[0].i, req, false, more);
      if (open) list.slice(1).forEach(x => { h += optionRow(g, x.o, x.i, req, true); });
    }
    return h + '</tbody></table></div>';
  }
  function renderGaps() {
    const gaps = ui.gaps || [];
    let h = '<div class="notice info" style="margin-bottom:8px">Spazi liberi <b>certi</b> nelle singole giornate (fasce ambulatoriali ordinarie). Sono utili per <b>recuperi o sedute isolate</b>: non garantiscono un ciclo intero. Per programmare un recupero apri la seduta da recuperare in Agenda o in Pazienti e cicli.</div>';
    if (!gaps.length) return h + '<div class="empty">Nessun buco della durata richiesta nei prossimi giorni.</div>';
    h += '<div class="table-wrap"><table class="t"><thead><tr><th>Fisioterapista</th><th>Idoneità</th><th>Spazi liberi (data, orario, quanti posti)</th></tr></thead><tbody>';
    for (const g of gaps) {
      h += '<tr><td class="who">' + esc(g.therapist.name) + '<div class="muted small">' + profileShort(g.therapist.profile) + '</div></td><td>' + (g.kind === 'specifica' ? tag('info', '★ Competenza specifica') : tag('plain', 'Altra idoneità')) + '</td><td><div class="chips">' +
        g.items.slice(0, 14).map(it => tag('ok', dShort(it.date) + ' ' + hm(it.start) + '–' + hm(it.end) + ' · ' + it.seats + (it.seats === 1 ? ' posto' : ' posti'))).join('') + (g.items.length > 14 ? ' <span class="muted small">+' + (g.items.length - 14) + '</span>' : '') + '</div></td></tr>';
    }
    return h + '</tbody></table></div>';
  }
  function getOption(el) {
    const g = ui.results.groups.find(x => x.therapist.id === el.dataset.th);
    return { g, o: g.options[Number(el.dataset.idx)] };
  }

  /* ================================================================== */
  /* VISTA: Agenda                                                        */
  /* ================================================================== */
  VIEWS.agenda = function () {
    const a = ui.agenda;
    if (!a.date) a.date = E.weekday(today()) <= 5 ? today() : nextWorkingDay(today());
    if (!a.therapistId) a.therapistId = state.therapists[0].id;
    const ctx = E.makeContext(state);
    let h = '<section class="panel"><div class="agenda-tools">' +
      '<div class="seg">' + [['giorno', 'Giorno'], ['settimana', 'Settimana']].map(([v, l]) => '<label><input type="radio" name="am" value="' + v + '" data-act="ag-mode"' + (a.mode === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div>' +
      '<button class="btn sm" data-act="ag-prev" aria-label="Precedente">◀</button><button class="btn sm" data-act="ag-today">Oggi</button><button class="btn sm" data-act="ag-next" aria-label="Successivo">▶</button>' +
      '<input type="date" class="input" data-act="ag-date" value="' + a.date + '" aria-label="Data">';
    if (a.mode === 'giorno') {
      h += '<select class="input" data-act="ag-group" aria-label="Filtro colleghi">' + optionsHtml([['tutti', 'Tutti i colleghi'], ['reparto7', 'Gruppo ingresso 7:00'], ['reparto8', 'Gruppo ingresso 8:00'], ['ambulatorio', 'Solo ambulatorio']].concat(state.therapists.map(t => ['th:' + t.id, t.name])), a.group) + '</select>';
    } else {
      h += '<select class="input" data-act="ag-th" aria-label="Collega">' + optionsHtml(state.therapists.map(t => [t.id, t.name]), a.therapistId) + '</select>';
    }
    h += '</div><div class="legend" style="margin-bottom:8px">' + tag('info', 'Seduta programmata') + tag('ok', '✓ Effettuata') + tag('prob', '▤ Riserva provvisoria') + tag('ext', '◐ Estensione da confermare') + tag('bad', '⚠ Conflitto / assenza') + TAG.prot('Reparto, pausa, cartelle') + '<span class="muted small">Fondo bianco = fascia ambulatoriale libera</span></div>';
    let cols = [];
    if (a.mode === 'giorno') {
      let ths = state.therapists;
      if (a.group.startsWith('th:')) ths = ths.filter(t => t.id === a.group.slice(3));
      else if (a.group !== 'tutti') ths = ths.filter(t => t.profile === a.group);
      cols = ths.map(t => ({ th: t, date: a.date, head: '<b>' + esc(t.name) + '</b>' + profileShort(t.profile) }));
      const cl = ctx.closures.get(a.date);
      h += '<h3>' + E.WEEKDAY_LONG[E.weekday(a.date)].replace(/^./, c => c.toUpperCase()) + ' ' + E.fmtIt(a.date) + (cl ? ' — ' + tag('bad', 'Chiusura: ' + esc(cl.label)) : '') + '</h3>';
    } else {
      const mon = E.mondayOf(a.date);
      const t = thById(a.therapistId);
      cols = [0, 1, 2, 3, 4].map(i => { const d = E.addDays(mon, i); return { th: t, date: d, head: '<b>' + dLabel(d) + '</b>' + (ctx.closures.get(d) ? 'Chiusura' : ''), wide: true }; });
      h += '<h3>' + esc(t.name) + ' · settimana dal ' + E.fmtIt(mon) + ' <span class="muted small">' + profileShort(t.profile) + '</span></h3>';
    }
    h += renderCalendar(ctx, cols) + '</section>';
    return h;
  };
  function renderCalendar(ctx, cols) {
    const height = (DAY_END - DAY_START) * PX;
    let times = '<div class="cal-times"><div class="cal-head"></div><div class="cal-body" style="height:' + height + 'px">';
    for (let m = DAY_START; m <= DAY_END; m += 30) times += '<div class="cal-hour" style="top:' + (m - DAY_START) * PX + 'px">' + (m % 60 === 0 ? hm(m) : '') + '</div>';
    times += '</div></div>';
    const y = m => (m - DAY_START) * PX;
    const t0 = today();
    const colsHtml = cols.map(c => {
      const day = E.getDay(ctx, c.th, c.date);
      let inner = '';
      for (let m = DAY_START; m <= DAY_END; m += 30) inner += '<div class="cal-hour" style="top:' + y(m) + 'px"></div>';
      let count = 0;
      if (day.closure) inner += '<div class="blk closure" style="top:0;height:' + height + 'px">Chiusura<br>' + esc(day.closure.label) + '</div>';
      else if (!day.working) inner += '<div class="blk off" style="top:0;height:' + height + 'px">Non in servizio</div>';
      else {
        if (day.inMin > DAY_START) inner += '<div class="blk off" style="top:0;height:' + y(day.inMin) + 'px"></div>';
        inner += '<div class="blk off" style="top:' + y(day.outMin) + 'px;height:' + (height - y(day.outMin)) + 'px">Fine turno ' + hm(day.outMin) + '</div>';
        day.blocks.forEach(b => {
          const lbl = b.type === 'amb' ? (b.maxPatients ? 'max ' + b.maxPatients + ' paz.' : '') : (b.note || E.BLOCK_TYPES[b.type].label);
          inner += '<div class="blk ' + b.type + '" style="top:' + y(b.start) + 'px;height:' + (b.end - b.start) * PX + 'px" title="' + esc(E.BLOCK_TYPES[b.type].label + ' ' + hm(b.start) + '–' + hm(b.end)) + '">' + (b.end - b.start >= 14 ? esc(lbl) : '') + '</div>';
        });
        day.absences.forEach(ab => {
          inner += '<div class="blk absence" style="top:' + y(ab.start) + 'px;height:' + (ab.end - ab.start) * PX + 'px">⚠ ' + esc(ab.absence.type) + (ab.unknownReturn ? ' · rientro non noto' : '') + '</div>';
        });
        E.occupancy(ctx, c.th.id, c.date).forEach(o => {
          if (o.kind === 'seduta') {
            const s = state.sessions.find(x => x.id === o.sessionId);
            const p = ctx.paths.get(s.pathId);
            const issue = E.sessionIssue(ctx, s);
            count++;
            const cls = ['appt', s.status === 'effettuata' ? 'effettuata' : '', issue ? 'conflict' : '', s.extension ? 'ext' : '', ui.agenda.highlightPath === s.pathId ? 'hl' : '', s.status === 'programmata' && s.date < t0 ? 'past-open' : ''].join(' ');
            inner += '<button class="' + cls + '" style="top:' + (y(o.start) + 1) + 'px;height:' + Math.max(16, (o.end - o.start) * PX - 2) + 'px" data-act="open-session" data-id="' + s.id + '" title="' + esc(ptName(s.pathId) + ' ' + s.start + ' · ' + catName(p.categoryId) + ' · ' + E.SESSION_STATUS[s.status] + (issue ? ' · ' + issue.reason : '')) + '">' +
              '<b>' + esc(ptName(s.pathId)) + '</b> ' + hm(o.start) + '–' + hm(o.end) + '<br><span class="st">' + (issue ? '⚠ ' + esc(issue.reason) : s.status === 'effettuata' ? '✓ effettuata' : s.status === 'programmata' && s.date < t0 ? 'esito da registrare' : esc(catName(p.categoryId))) + (s.recoveryOf ? ' · recupero' : '') + (s.originalTherapistId ? ' · sostituzione' : '') + '</span></button>';
          } else if (o.hard) {
            inner += '<div class="appt reserve" style="top:' + (y(o.start) + 1) + 'px;height:' + Math.max(16, (o.end - o.start) * PX - 2) + 'px" title="' + esc(o.why) + '"><b>Riserva</b> ' + esc(ptName(o.pathId)) + '<br><span class="st">' + (o.kind === 'riserva' ? 'fino al ' + E.fmtItShort(o.until) : '') + '</span></div>';
          }
        });
      }
      return '<div class="cal-col' + (c.wide ? ' wide' : '') + '"><div class="cal-head">' + c.head + '<div class="muted">' + (day.working ? count + ' pazienti' + (day.exception ? ' · eccezione' : '') : '') + '</div></div><div class="cal-body" style="height:' + height + 'px">' + inner + '</div></div>';
    }).join('');
    return '<div class="cal"><div class="cal-inner">' + times + colsHtml + '</div></div>';
  }

  /* ================================================================== */
  /* VISTA: Lista d'attesa                                                */
  /* ================================================================== */
  VIEWS.lista = function () {
    const prio = E.PRIORITY_ORDER;
    let list = state.waitlist.slice();
    const f = ui.wlFilter;
    if (f === 'attivi') list = list.filter(w => ['in_attesa', 'contattato', 'proposta'].includes(w.status));
    else if (f !== 'tutti') list = list.filter(w => w.status === f);
    const base = list;
    if (ui.wlPrio !== 'tutte') list = list.filter(w => w.priority === ui.wlPrio);
    const byDate = (a, b) => (a.insertedAt < b.insertedAt ? -1 : a.insertedAt > b.insertedAt ? 1 : 0);
    if (ui.wlSort === 'priorita') list.sort((a, b) => (prio.indexOf(a.priority) - prio.indexOf(b.priority)) || byDate(a, b));
    else list.sort(byDate);
    let h = '<section class="panel"><div class="panel-head"><h2>Lista d\'attesa</h2><button class="btn primary" data-act="wl-new">＋ Nuovo paziente in lista</button></div>' +
      '<div class="btn-row" style="margin-bottom:10px"><div class="seg">' + [['attivi', 'Da sistemare'], ['tutti', 'Tutti'], ['assegnato', 'Assegnati'], ['rinuncia', 'Rinunce']].map(([v, l]) => '<label><input type="radio" name="wlf" value="' + v + '" data-act="wl-filter"' + (f === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div>' +
      '<label class="small">Ordina: <select class="input" style="width:auto;display:inline-block" data-act="wl-sort">' + optionsHtml([['priorita', 'Priorità (U → Non indicata), poi inserimento'], ['inserimento', 'Data di inserimento']], ui.wlSort) + '</select></label></div>' +
      '<div class="btn-row" style="margin-bottom:6px"><span class="lbl" style="margin:0">Priorità</span><div class="seg">' + [['tutte', 'Tutte']].concat(prio.map(k => [k, k === 'NI' ? 'Non indicata' : k])).map(([v, l]) => '<label><input type="radio" name="wlPrio" value="' + v + '" data-act="wl-prio"' + (ui.wlPrio === v ? ' checked' : '') + '><span>' + l + (v === 'tutte' ? '' : ' <small>(' + base.filter(w => w.priority === v).length + ')</small>') + '</span></label>').join('') + '</div></div>' +
      '<p class="muted small" style="margin-top:0">' + PRIO_NOTE + '</p>';
    if (!list.length) return h + '<div class="empty">Nessun paziente in questo elenco.</div></section>';
    h += '<div class="table-wrap"><table class="t"><thead><tr><th>Paziente</th><th>Inserito</th><th>Priorità</th><th>Richiesta</th><th>Percorso</th><th>Durata</th><th>Frequenza</th><th>Sedute</th><th>Disponibilità oraria</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>';
    list.forEach(w => {
      const days = E.diffDays(w.insertedAt, today());
      h += '<tr><td class="who">' + esc(w.name) + (w.note ? '<div class="muted small">' + esc(w.note) + '</div>' : '') + '</td>' +
        '<td class="nowrap">' + E.fmtIt(w.insertedAt) + '<div class="muted small">' + days + ' giorni</div></td>' +
        '<td>' + prioTag(w.priority) + (w.previousPriority ? '<div class="muted small">prima: ' + esc(w.previousPriority) + ' (da riclassificare)</div>' : '') + '</td>' +
        '<td class="small">' + esc(reqTypeName(w.requestType)) + '</td>' +
        '<td>' + esc(catName(w.categoryId)) + '</td><td>' + w.duration + ' min</td><td class="nowrap">' + E.weekdaysLabel(w.weekdays) + '</td><td>' + w.sessions + '</td>' +
        '<td>' + (w.pref && w.pref.from ? w.pref.from + '–' + w.pref.to + ' <span class="muted small">(' + w.pref.mode + ')</span>' : '<span class="muted">qualsiasi</span>') + (w.availabilityNote ? '<div class="muted small">' + esc(w.availabilityNote) + '</div>' : '') +
        '<div class="muted small">dal ' + E.fmtIt(w.earliestDate) + '</div></td>' +
        '<td><select class="input" style="min-width:150px" data-act="wl-status" data-id="' + w.id + '" aria-label="Stato">' + optionsHtml(Object.entries(E.WAITLIST_STATUS), w.status) + '</select>' +
        (w.preaccordo ? '<div class="small" style="margin-top:4px">' + tag('prob', '? Preaccordo') + ' ' + esc(thName(w.preaccordo.therapistId)) + ' ' + E.weekdaysLabel(w.preaccordo.weekdays) + ' ' + w.preaccordo.startTime + ' dal ' + E.fmtItShort(w.preaccordo.fromDate) + '<br><span class="muted">non è una prenotazione</span></div>' : '') +
        (w.assignedPathId && pathById(w.assignedPathId) ? '<div class="small"><a href="#/pazienti/' + w.assignedPathId + '">Apri percorso</a></div>' : '') + '</td>' +
        '<td><div class="btn-row">' + (w.status !== 'assegnato' && w.status !== 'rinuncia' ? '<button class="btn sm primary" data-act="wl-find" data-id="' + w.id + '">🔎 Trova posto</button>' : '') +
        '<button class="btn sm" data-act="wl-edit" data-id="' + w.id + '">Modifica</button></div></td></tr>';
    });
    return h + '</tbody></table></div></section>';
  };
  function waitlistToSearch(w) {
    const s = defaultSearch();
    const k = w.weekdays.slice().sort().join(',');
    Object.assign(s, {
      name: w.name, categoryId: w.categoryId, duration: w.duration, weekdays: w.weekdays.slice(),
      freq: k === '1,3,5' ? 'lmv' : k === '2,4' ? 'mg' : 'custom',
      sessionsMode: (state.settings.sessionPresets || []).map(String).includes(String(w.sessions)) ? String(w.sessions) : 'altro', sessionsCustom: w.sessions,
      earliestDate: w.earliestDate && w.earliestDate > today() ? w.earliestDate : nextWorkingDay(today()),
      prefOn: !!(w.pref && w.pref.from), prefFrom: w.pref ? w.pref.from : '12:00', prefTo: w.pref ? w.pref.to : '14:45', prefMode: w.pref ? w.pref.mode : 'flessibile',
      waitlistId: w.id, priority: E.PRIORITY_CLASSES[w.priority] ? w.priority : 'NI', requestType: w.requestType || 'prima'
    });
    return s;
  }

  /* ================================================================== */
  /* VISTA: Pazienti e cicli                                              */
  /* ================================================================== */
  VIEWS.pazienti = function (param) {
    if (param) return pathDetail(param);
    const q = ui.pathFilter.trim().toLowerCase();
    const ctx = E.makeContext(state);
    let rows = state.paths.map(p => {
      const pt = patientOfPath(p);
      const pc = E.pathCounts(state, p.id);
      const closed = E.CLOSED_FORECASTS.has(p.forecast.state) && (!pc.lastDate || pc.lastDate < today());
      return { p, pt, pc, closed };
    });
    if (ui.pathState === 'attivi') rows = rows.filter(r => !r.closed);
    if (ui.pathState === 'chiusi') rows = rows.filter(r => r.closed);
    if (q) rows = rows.filter(r => (r.pt.name + ' ' + thName(r.p.therapistId) + ' ' + catName(r.p.categoryId)).toLowerCase().includes(q));
    rows.sort((a, b) => a.pt.name.localeCompare(b.pt.name, 'it'));
    let h = '<section class="panel"><div class="panel-head"><h2>Pazienti e cicli</h2><span class="muted small">' + rows.length + ' percorsi</span></div>' +
      '<div class="btn-row" style="margin-bottom:10px"><input class="input" style="max-width:320px" placeholder="Cerca paziente, collega o percorso…" data-act="path-filter" value="' + esc(ui.pathFilter) + '" aria-label="Cerca">' +
      '<div class="seg">' + [['attivi', 'In corso'], ['chiusi', 'Conclusi / chiusi'], ['tutti', 'Tutti']].map(([v, l]) => '<label><input type="radio" name="ps" value="' + v + '" data-act="path-state"' + (ui.pathState === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div></div>';
    h += '<div class="table-wrap"><table class="t"><thead><tr><th>Paziente</th><th>Percorso</th><th>Fisioterapista</th><th>Giorni e orario</th><th>Cicli</th><th>Sedute effettuate</th><th>Ultima seduta</th><th>Previsione</th><th></th></tr></thead><tbody>';
    rows.forEach(r => {
      const pct = r.pc.planned ? Math.round(100 * r.pc.done / r.pc.planned) : 0;
      h += '<tr><td class="who">' + esc(r.pt.name) + '<div style="margin-top:2px">' + prioTag(r.p.priority) + '</div></td><td>' + esc(catName(r.p.categoryId)) + '<div class="muted small">' + r.p.duration + ' min</div></td><td>' + esc(thName(r.p.therapistId)) + '</td>' +
        '<td class="nowrap">' + E.weekdaysLabel(r.p.weekdays) + ' ' + r.p.startTime + '</td><td>' + r.pc.cycles.length + '</td>' +
        '<td><div class="small">' + r.pc.done + ' / ' + r.pc.planned + '</div><div class="progress"><div style="width:' + pct + '%"></div></div></td>' +
        '<td class="nowrap">' + (r.pc.lastDate ? dShort(r.pc.lastDate) : '—') + '</td><td>' + FORECAST_TAG[r.p.forecast.state]() + '</td>' +
        '<td><a class="btn sm" href="#/pazienti/' + r.p.id + '">Apri</a></td></tr>';
    });
    void ctx;
    return h + '</tbody></table></div></section>';
  };
  function pathDetail(pathId) {
    const p = pathById(pathId);
    if (!p) return '<div class="notice bad">Percorso non trovato. <a href="#/pazienti">Torna all\'elenco</a></div>';
    const pt = patientOfPath(p);
    const pc = E.pathCounts(state, p.id);
    const f = p.forecast;
    const ctx = E.makeContext(state);
    const ov = E.forecastOverview(state).find(r => r.path.id === p.id);
    let h = '<p><a href="#/pazienti">← Pazienti e cicli</a></p>';
    h += '<section class="panel"><div class="panel-head"><h2>' + esc(pt.name) + '</h2>' + FORECAST_TAG[f.state]() + '</div>' +
      '<dl class="kv"><dt>Percorso</dt><dd>' + esc(catName(p.categoryId)) + '</dd><dt>Fisioterapista</dt><dd>' + esc(thName(p.therapistId)) + '</dd>' +
      '<dt>Giorni e orario</dt><dd>' + E.weekdaysLabel(p.weekdays) + ' · ' + p.startTime + '–' + hm(E.toMin(p.startTime) + p.duration) + ' (' + p.duration + ' min)</dd>' +
      '<dt>Cicli</dt><dd>' + pc.cycles.length + ' (' + pc.planned + ' sedute previste in totale, ' + pc.done + ' effettuate)</dd>' +
      '<dt>Ultima seduta in calendario</dt><dd>' + dLabel(pc.lastDate) + '</dd>' +
      '<dt>Effetto sul posto</dt><dd>' + (ov ? slotTag(ov.slot) : '—') + '</dd>' +
      '<dt>Priorità</dt><dd><select class="input" style="width:auto" data-act="path-prio" data-id="' + p.id + '" aria-label="Priorità">' + optionsHtml(prioOptions(), E.PRIORITY_CLASSES[p.priority] ? p.priority : 'NI') + '</select></dd>' +
      '<dt>Tipo di richiesta</dt><dd><select class="input" style="width:auto" data-act="path-rt" data-id="' + p.id + '" aria-label="Tipo di richiesta">' + optionsHtml([['', '—']].concat(Object.entries(E.REQUEST_TYPES)), p.requestType || '') + '</select><div class="field-help">Solo un\'indicazione: non modifica cicli e sedute.</div></dd></dl>' +
      (ov && ov.alerts.length ? '<div class="notice warn">' + ov.alerts.map(a => '• ' + esc(a.text)).join('<br>') + '</div>' : '') + '</section>';
    // previsione
    const fs = ui.fcDraft && ui.fcDraft.pathId === p.id ? ui.fcDraft : { pathId: p.id, state: f.state, date: f.date || '', reviewDate: f.reviewDate || '', keepSlots: f.keepSlots === false ? 'no' : f.keepSlots === true ? 'si' : '', note: f.note || '', reserveUntil: f.reserveUntil || '' };
    ui.fcDraft = fs;
    h += '<section class="panel"><div class="panel-head"><h3>Previsione di conclusione</h3><span class="muted small">Aggiornata il ' + E.fmtIt(f.updatedAt) + '</span></div>' +
      '<div class="grid g4"><div class="field"><label class="lbl">Previsione</label><select class="input" data-bind="fcDraft.state" data-rerender="1">' + optionsHtml(Object.entries(E.FORECAST), fs.state) + '</select></div>';
    if (['conclusione_confermata', 'interruzione', 'non_avviato', 'sospensione'].includes(fs.state)) h += '<div class="field"><label class="lbl">' + (fs.state === 'sospensione' ? 'Sospensione dal' : fs.state === 'conclusione_confermata' ? 'Conclusione il (facoltativa)' : 'Ultima seduta svolta (facoltativa)') + '</label><input type="date" class="input" data-bind="fcDraft.date" value="' + esc(fs.date) + '"></div>';
    if (fs.state === 'sospensione') {
      h += '<div class="field"><label class="lbl">Data di riesame *</label><input type="date" class="input" data-bind="fcDraft.reviewDate" value="' + esc(fs.reviewDate) + '"></div>' +
        '<div class="field"><span class="lbl">Appuntamenti futuri *</span><div class="seg">' + [['si', 'Mantieni il posto'], ['no', 'Libera il posto']].map(([v, l]) => '<label><input type="radio" name="ks" value="' + v + '" data-bind="fcDraft.keepSlots"' + (fs.keepSlots === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div></div>';
    }
    if (fs.state === 'prosecuzione' || fs.state === 'da_valutare') h += '<div class="field"><label class="lbl">Riserva provvisoria fino al</label><input type="date" class="input" data-bind="fcDraft.reserveUntil" value="' + esc(fs.reserveUntil) + '"><div class="field-help">Vuoto = ' + state.settings.reserveWeeks + ' settimane dopo l\'ultima seduta' + (pc.lastDate ? ' (' + E.fmtIt(E.reserveEnd(ctx, p)) + ')' : '') + '</div></div>';
    h += '<div class="field" style="grid-column:span 2"><label class="lbl">Nota</label><input class="input" data-bind="fcDraft.note" value="' + esc(fs.note) + '"></div></div>' +
      '<div class="field-help" style="margin:8px 0">' + forecastHelp(fs.state) + '</div>' +
      '<button class="btn primary" data-act="save-forecast" data-id="' + p.id + '">Salva previsione</button></section>';
    // rinnovo
    h += '<section class="panel"><div class="panel-head"><h3>Rinnovo (nuovo ciclo collegato)</h3><span class="muted small">Stesso collega e stesso orario, dopo l\'ultima seduta. Lo storico resta.</span></div><div class="btn-row">' +
      [5, 10].map(n => '<button class="btn" data-act="renew" data-id="' + p.id + '" data-n="' + n + '">＋ Rinnova ' + n + ' sedute</button>').join('') +
      '<input type="number" min="1" max="60" class="input" style="width:90px" id="renew-n" value="15" aria-label="Numero di sedute"><button class="btn" data-act="renew" data-id="' + p.id + '" data-n="custom">＋ Rinnova (numero indicato)</button></div></section>';
    // cicli
    pc.cycles.slice().reverse().forEach(({ cycle, counts }) => {
      const ss = state.sessions.filter(s => s.cycleId === cycle.id).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : E.toMin(a.start) - E.toMin(b.start));
      let n = 0;
      h += '<section class="panel"><div class="panel-head"><h3>Ciclo ' + cycle.index + ' · ' + cycle.plannedSessions + ' sedute</h3><div class="chips">' +
        tag('ok', counts.effettuata + ' effettuate') + tag('info', counts.programmata + ' programmate') + (counts.assente ? tag('prob', counts.assente + ' assenze') : '') +
        (counts.da_recuperare ? tag('bad', counts.da_recuperare + ' da recuperare') : '') + (counts.recuperata ? tag('plain', counts.recuperata + ' recuperate') : '') + (counts.annullata ? tag('plain', counts.annullata + ' annullate') : '') +
        tag(counts.missing ? 'bad' : 'plain', 'Conteggio: ' + counts.total + ' / ' + counts.planned + (counts.missing ? ' (mancano ' + counts.missing + ')' : '')) + '</div></div>' +
        '<div class="table-wrap"><table class="t"><thead><tr><th>N.</th><th>Data</th><th>Orario</th><th>Fisioterapista</th><th>Stato</th><th>Note</th><th></th></tr></thead><tbody>';
      ss.forEach(s => {
        const counted = E.COUNTED.has(s.status);
        if (counted) n++;
        const issue = E.sessionIssue(ctx, s);
        h += '<tr><td>' + (counted ? n : '<span class="muted">—</span>') + '</td><td class="nowrap">' + dLabel(s.date) + '</td><td class="nowrap">' + s.start + '–' + hm(E.toMin(s.start) + s.duration) + '</td><td>' + esc(thName(s.therapistId)) + '</td>' +
          '<td><select class="input" style="min-width:170px" data-act="session-status" data-id="' + s.id + '" aria-label="Stato seduta">' + optionsHtml(Object.entries(E.SESSION_STATUS).filter(([k]) => k !== 'recuperata' || s.status === 'recuperata'), s.status) + '</select>' +
          (s.status === 'programmata' && s.date < today() ? '<div class="small" style="color:var(--prob)">Data passata: registrare l\'esito</div>' : '') + '</td>' +
          '<td class="small">' + (issue ? TAG.bad(esc(issue.reason)) + ' ' : '') + (s.recoveryOf ? 'Recupero della seduta del ' + E.fmtItShort((state.sessions.find(x => x.id === s.recoveryOf) || {}).date) + '. ' : '') + (s.status === 'recuperata' ? 'Recuperata il ' + E.fmtItShort((state.sessions.find(x => x.recoveryOf === s.id) || {}).date) + '. ' : '') + esc(s.note || '') + (s.extension ? ' (estensione)' : '') + '</td>' +
          '<td>' + (['da_recuperare', 'assente', 'annullata'].includes(s.status) ? '<button class="btn sm" data-act="recovery" data-id="' + s.id + '">↺ Programma recupero</button>' : '') + (issue ? '<button class="btn sm" data-act="substitutes" data-id="' + s.id + '">Sostituto</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div></section>';
    });
    if (!pc.cycles.length) h += '<div class="notice info">Nessun ciclo calendarizzato per questo percorso.</div>';
    return h;
  }
  function forecastHelp(st) {
    return ({
      da_valutare: 'Il posto NON viene liberato: oltre l\'ultima seduta resta una riserva provvisoria visibile, con avviso di riesame.',
      prosecuzione: 'Il posto NON viene proposto come libero alla fine delle sedute inserite: resta una riserva provvisoria esplicita fino alla data indicata.',
      probabile_conclusione: 'Dopo l\'ultima seduta il posto appare come PROBABILE (condizionato): non prenotabile in modo definitivo.',
      conclusione_confermata: 'Il posto è libero dopo l\'ultima seduta occupata (che resta occupata). Se indichi una data, le sedute successive vengono liberate dopo conferma.',
      sospensione: 'Scegli se mantenere il posto fino al riesame oppure liberare gli appuntamenti futuri.',
      interruzione: 'Gli appuntamenti futuri vengono liberati dopo la tua conferma (non cancellati dallo storico: risultano annullati).',
      non_avviato: 'Gli eventuali appuntamenti futuri vengono liberati dopo la tua conferma.'
    })[st] || '';
  }
  function slotTag(slot) {
    if (!slot) return '—';
    if (slot.code === 'libero') return TAG.ok(esc(slot.label));
    if (slot.code === 'probabile') return TAG.prob(esc(slot.label));
    if (slot.code === 'riserva') return tag('prob', '▤ ' + esc(slot.label));
    return '<span class="muted">' + esc(slot.label) + '</span>';
  }

  /* ================================================================== */
  /* VISTA: Previsioni                                                    */
  /* ================================================================== */
  VIEWS.previsioni = function () {
    const rows = E.forecastOverview(state);
    const t = today();
    const alertRows = rows.filter(r => r.alerts.length);
    let h = '<section class="panel"><div class="panel-head"><h2>Previsioni da aggiornare</h2><span class="muted small">Soglia di avviso: ' + state.settings.updateThreshold + ' sedute rimanenti (modificabile in Impostazioni)</span></div>';
    if (!alertRows.length) h += '<div class="empty">Nessuna previsione da aggiornare.</div>';
    else h += '<ul class="alert-list">' + alertRows.map(r => '<li><div><b>' + esc(r.patient.name) + '</b> · ' + esc(r.therapist ? r.therapist.name : '') + ' · ' + FORECAST_TAG[r.forecast.state]() + '<div class="small">' + r.alerts.map(a => '• ' + esc(a.text)).join('<br>') + '</div></div><a class="btn sm" href="#/pazienti/' + r.path.id + '">Apri percorso</a></li>').join('') + '</ul>';
    h += '</section>';
    const freeing = rows.filter(r => r.slot.freeFrom && r.last && r.slot.freeFrom >= E.addDays(t, -7) && !(r.closed && r.slot.freeFrom < t)).sort((a, b) => a.slot.freeFrom < b.slot.freeFrom ? -1 : 1);
    h += '<section class="panel"><div class="panel-head"><h2>Posti che si liberano</h2><span class="muted small">' + TAG.ok('certo') + ' ' + TAG.prob('probabile') + ' ' + tag('prob', '▤ riserva provvisoria') + '</span></div>' +
      '<div class="notice info">Un posto <b>probabile</b> dipende dalla conclusione indicata e non può essere prenotato in modo definitivo. Per ogni posto puoi vedere i pazienti in lista compatibili (priorità e tempo d\'attesa).</div>' +
      '<div class="table-wrap"><table class="t"><thead><tr><th>Posto attuale di</th><th>Fisioterapista</th><th>Giorni e orario</th><th>Ultima seduta</th><th>Previsione</th><th>Effetto sul posto</th><th>Preaccordi</th><th>Lista d\'attesa</th></tr></thead><tbody>';
    freeing.forEach(r => {
      const slot = { therapistId: r.path.therapistId, weekdays: r.path.weekdays, start: E.toMin(r.path.startTime), duration: r.path.duration, freeFrom: r.slot.freeFrom };
      const comp = E.compatibleWaitlist(state, slot);
      const pre = state.waitlist.filter(w => w.preaccordo && (w.preaccordo.deps || []).some(d => d.pathId === r.path.id));
      h += '<tr><td class="who">' + esc(r.patient.name) + '</td><td>' + esc(r.therapist.name) + '</td><td class="nowrap">' + E.weekdaysLabel(r.path.weekdays) + ' ' + r.path.startTime + ' (' + r.path.duration + ' min)</td>' +
        '<td class="nowrap">' + dShort(r.last) + '</td><td>' + FORECAST_TAG[r.forecast.state]() + '</td><td>' + slotTag(r.slot) + '</td>' +
        '<td class="small">' + (pre.length ? pre.map(w => tag('prob', '? ' + esc(w.name))).join(' ') : '—') + '</td>' +
        '<td>' + (comp.length ? '<button class="btn sm" data-act="show-compatible" data-path="' + r.path.id + '">' + comp.length + ' compatibili</button>' : '<span class="muted small">nessuno</span>') + '</td></tr>';
    });
    if (!freeing.length) h += '<tr><td colspan="8" class="empty">Nessun posto in liberazione.</td></tr>';
    h += '</tbody></table></div></section>';
    return h;
  };

  /* ================================================================== */
  /* VISTA: Ferie e malattie                                              */
  /* ================================================================== */
  VIEWS.assenze = function () {
    const f = ui.absForm || (ui.absForm = { therapistId: state.therapists[0].id, type: 'Ferie', mode: 'giorno', date: nextWorkingDay(today()), startDate: nextWorkingDay(today()), endDate: '', returnKnown: 'si', startTime: '12:40', endTime: '14:45', note: '' });
    const confAll = E.conflicts(state);
    const limit = E.addDays(today(), 14);
    const conf = confAll.filter(c => c.session.date <= limit);
    const later = confAll.length - conf.length;
    let h = '';
    if (confAll.length) {
      h += '<section class="panel"><div class="panel-head"><h2>⚠ Appuntamenti in conflitto: ' + confAll.length + '</h2><span class="muted small">Non vengono cancellati: scegli tu sostituzione o recupero.</span></div>' +
        '<p class="small">Qui sotto quelli dei prossimi 14 giorni' + (later ? '; altri <b>' + later + '</b> più avanti (aprili da "Appuntamenti coinvolti" nell\'elenco delle assenze).' : '.') + '</p>' +
        '<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Orario</th><th>Paziente</th><th>Fisioterapista</th><th>Problema</th><th>Azioni</th></tr></thead><tbody>' +
        conf.slice(0, 60).map(c => '<tr><td class="nowrap">' + dLabel(c.session.date) + '</td><td>' + c.session.start + '</td><td class="who">' + esc(ptName(c.session.pathId)) + '</td><td>' + esc(thName(c.session.therapistId)) + '</td><td>' + TAG.bad(esc(c.issue.reason)) + '</td>' +
          '<td><div class="btn-row"><button class="btn sm" data-act="substitutes" data-id="' + c.session.id + '">Cerca sostituto</button><button class="btn sm" data-act="mark-recover" data-id="' + c.session.id + '">Segna da recuperare</button></div></td></tr>').join('') +
        '</tbody></table></div>' + (conf.length > 60 ? '<p class="muted small">Mostrati i primi 60.</p>' : '') + (!conf.length ? '<p class="muted">Nessun conflitto nei prossimi 14 giorni.</p>' : '') + '</section>';
    }
    h += '<section class="panel"><div class="panel-head"><h2>Registra ferie, malattia o assenza</h2></div><form data-form="absence"><div class="grid g4">' +
      '<div class="field"><label class="lbl">Fisioterapista</label><select class="input" data-bind="absForm.therapistId">' + optionsHtml(state.therapists.map(t => [t.id, t.name]), f.therapistId) + '</select></div>' +
      '<div class="field"><label class="lbl">Tipo</label><select class="input" data-bind="absForm.type">' + optionsHtml(['Ferie', 'Malattia', 'Permesso', 'Formazione', 'Altro'].map(x => [x, x]), f.type) + '</select></div>' +
      '<div class="field" style="grid-column:span 2"><span class="lbl">Durata</span><div class="seg">' + [['giorno', 'Una giornata'], ['intervallo', 'Più giorni'], ['ore', 'Alcune ore']].map(([v, l]) => '<label><input type="radio" name="abm" value="' + v + '" data-bind="absForm.mode" data-rerender="1"' + (f.mode === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div></div>';
    if (f.mode === 'giorno' || f.mode === 'ore') h += '<div class="field"><label class="lbl">Data</label><input type="date" class="input" data-bind="absForm.date" value="' + esc(f.date) + '"></div>';
    if (f.mode === 'ore') h += '<div class="field"><label class="lbl">Dalle</label><select class="input" data-bind="absForm.startTime">' + timeOptions(f.startTime, '07:00', '15:15', 5) + '</select></div><div class="field"><label class="lbl">Alle</label><select class="input" data-bind="absForm.endTime">' + timeOptions(f.endTime, '07:00', '15:15', 5) + '</select></div>';
    if (f.mode === 'intervallo') {
      h += '<div class="field"><label class="lbl">Dal</label><input type="date" class="input" data-bind="absForm.startDate" value="' + esc(f.startDate) + '"></div>' +
        '<div class="field"><span class="lbl">Rientro</span><div class="seg">' + [['si', 'Conosciuto'], ['no', 'Non conosciuto']].map(([v, l]) => '<label><input type="radio" name="rk" value="' + v + '" data-bind="absForm.returnKnown" data-rerender="1"' + (f.returnKnown === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div></div>' +
        (f.returnKnown === 'si' ? '<div class="field"><label class="lbl">Fino al (incluso)</label><input type="date" class="input" data-bind="absForm.endDate" value="' + esc(f.endDate) + '"></div>' : '<div class="field"><div class="notice warn small" style="margin:0">Nessuna data di rientro inventata: le disponibilità successive non saranno mostrate come certe.</div></div>');
    }
    h += '<div class="field" style="grid-column:span 2"><label class="lbl">Nota</label><input class="input" data-bind="absForm.note" value="' + esc(f.note) + '"></div></div>' +
      '<div class="btn-row" style="margin-top:10px"><button type="submit" class="btn primary">Registra assenza</button><span class="muted small">Dopo il salvataggio vedrai tutti gli appuntamenti coinvolti.</span></div></form></section>';
    const list = state.absences.slice().sort((a, b) => a.startDate < b.startDate ? 1 : -1);
    h += '<section class="panel"><div class="panel-head"><h2>Assenze registrate</h2></div><div class="table-wrap"><table class="t"><thead><tr><th>Fisioterapista</th><th>Tipo</th><th>Periodo</th><th>Rientro</th><th>Appuntamenti coinvolti</th><th>Nota</th><th>Azioni</th></tr></thead><tbody>';
    list.forEach(a => {
      const imp = E.impactedByAbsence(state, a).filter(s => s.date >= today());
      const unknown = a.endDate == null || a.endDate === '';
      const past = !unknown && a.endDate < today();
      h += '<tr' + (past ? ' style="opacity:.6"' : '') + '><td class="who">' + esc(thName(a.therapistId)) + '</td><td>' + esc(a.type) + '</td><td class="nowrap">' + E.fmtIt(a.startDate) + (a.allDay === false ? ' ' + a.startTime + '–' + a.endTime : (unknown ? ' → ?' : a.endDate !== a.startDate ? ' → ' + E.fmtIt(a.endDate) : '')) + '</td>' +
        '<td>' + (unknown ? TAG.bad('Rientro non noto') : TAG.ok('Noto')) + '</td><td>' + (imp.length ? '<button class="btn sm" data-act="abs-impact" data-id="' + a.id + '">' + TAG.bad(imp.length + ' da gestire') + '</button>' : '<span class="muted small">nessuno</span>') + '</td><td class="small">' + esc(a.note || '') + '</td>' +
        '<td><div class="btn-row">' + (unknown ? '<button class="btn sm" data-act="abs-return" data-id="' + a.id + '">Imposta rientro</button>' : '') + '<button class="btn sm danger" data-act="abs-delete" data-id="' + a.id + '">Elimina</button></div></td></tr>';
    });
    h += '</tbody></table></div></section>';
    return h;
  };

  /* ================================================================== */
  /* VISTA: Fisioterapisti                                                */
  /* ================================================================== */
  VIEWS.fisioterapisti = function (param) {
    if (param) return therapistEditor(param);
    const ctx = E.makeContext(state);
    let h = '<section class="panel"><div class="panel-head"><h2>Schede dei fisioterapisti</h2><button class="btn primary" data-act="th-new">＋ Nuovo collega</button></div>' +
      '<div class="legend" style="margin-bottom:10px">' + tag('info', '★ Competenza specifica') + tag('plain', 'Altra idoneità') + '<span class="muted small">L\'idoneità è esplicita: se un percorso non è indicato, il collega non viene proposto.</span></div><div class="cards">';
    for (const t of state.therapists) {
      const d1 = t.week[1];
      const ambMin = d1 ? d1.blocks.filter(b => b.type === 'amb').reduce((n, b) => n + E.toMin(b.end) - E.toMin(b.start), 0) : 0;
      const abs = (ctx.absencesByTh.get(t.id) || []).filter(a => a.endDate == null || a.endDate === '' || a.endDate >= today());
      const fut = state.sessions.filter(s => s.therapistId === t.id && s.status === 'programmata' && s.date >= today());
      const nowPaths = new Set(fut.map(s => s.pathId)).size;
      h += '<div class="card"><h4>' + esc(t.name) + '</h4><div class="muted small">' + esc(E.PROFILES[t.profile] || t.profile) + '</div>' +
        '<div class="small" style="margin:6px 0">' + (d1 ? 'Lun: ' + d1.in + '–' + d1.out + ' · ambulatorio ' + ambMin + ' min' : 'Lun: non in servizio') + (t.maxPatientsDay ? ' · max ' + t.maxPatientsDay + ' paz./giorno' : '') + '<br>' + nowPaths + ' pazienti con sedute future</div>' +
        '<div class="chips">' + t.competenze.map(c => tag('info', '★ ' + esc(catName(c)))).join('') + t.idoneita.map(c => tag('plain', esc(catName(c)))).join('') + '</div>' +
        (abs.length ? '<div style="margin-top:6px">' + abs.map(a => TAG.bad(esc(a.type) + ' dal ' + E.fmtItShort(a.startDate) + (a.endDate ? ' al ' + E.fmtItShort(a.endDate) : ', rientro non noto'))).join(' ') + '</div>' : '') +
        '<div class="btn-row" style="margin-top:8px"><a class="btn sm" href="#/fisioterapisti/' + t.id + '">Apri scheda</a><button class="btn sm" data-act="th-agenda" data-id="' + t.id + '">Agenda settimana</button></div></div>';
    }
    return h + '</div></section>';
  };
  function therapistEditor(id) {
    const orig = thById(id);
    if (!orig) return '<div class="notice bad">Collega non trovato. <a href="#/fisioterapisti">Torna all\'elenco</a></div>';
    if (!ui.thDraft || ui.thDraft.id !== id) ui.thDraft = E.clone(orig);
    const t = ui.thDraft;
    let h = '<p><a href="#/fisioterapisti">← Schede dei fisioterapisti</a></p><section class="panel"><div class="panel-head"><h2>' + esc(t.name || 'Nuovo collega') + '</h2><div class="btn-row"><button class="btn" data-act="th-cancel">Annulla modifiche</button><button class="btn primary" data-act="th-save">Salva scheda</button></div></div>' +
      '<div class="grid g4"><div class="field"><label class="lbl">Nome</label><input class="input" data-bind="thDraft.name" value="' + esc(t.name) + '"></div>' +
      '<div class="field"><label class="lbl">Profilo</label><select class="input" data-bind="thDraft.profile">' + optionsHtml(Object.entries(E.PROFILES), t.profile) + '</select></div>' +
      '<div class="field"><label class="lbl">Max pazienti al giorno</label><input type="number" min="0" class="input" data-bind="thDraft.maxPatientsDay" data-type="num" value="' + esc(t.maxPatientsDay || '') + '"><div class="field-help">Vuoto = nessun limite oltre alle fasce</div></div>' +
      '<div class="field"><label class="lbl">Nota</label><input class="input" data-bind="thDraft.note" value="' + esc(t.note || '') + '"></div></div></section>';
    h += '<section class="panel"><h3>Competenze e idoneità</h3><div class="table-wrap"><table class="t"><thead><tr><th>Percorso</th><th>Competenza specifica</th><th>Altra idoneità</th><th>Non idoneo</th></tr></thead><tbody>' +
      state.categories.map(c => {
        const v = t.competenze.includes(c.id) ? 'c' : t.idoneita.includes(c.id) ? 'i' : 'n';
        return '<tr><td>' + esc(c.name) + '</td>' + ['c', 'i', 'n'].map(k => '<td><input type="radio" name="cat-' + c.id + '" data-act="th-cat" data-cat="' + c.id + '" value="' + k + '"' + (v === k ? ' checked' : '') + ' aria-label="' + esc(c.name) + '"></td>').join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
    h += '<section class="panel"><div class="panel-head"><h3>Settimana tipo</h3><div class="btn-row"><button class="btn sm" data-act="th-template">Applica lo schema del profilo a tutti i giorni</button><button class="btn sm" data-act="th-copy-mon">Copia il lunedì sugli altri giorni</button></div></div>' +
      '<p class="muted small">Ingresso e uscita sono l\'orario di presenza. Solo le fasce <b>Ambulatorio</b> sono prenotabili; l\'<b>Estensione</b> è prenotabile solo con conferma esplicita; reparto, pausa, cartelle e altre attività sono protette.</p>';
    for (let d = 1; d <= 6; d++) h += dayEditor('week.' + d, t.week[d], E.WEEKDAY_LONG[d].replace(/^./, c => c.toUpperCase()));
    h += '</section>';
    h += '<section class="panel"><div class="panel-head"><h3>Eccezioni per data</h3><div class="btn-row"><input type="date" class="input" id="ex-date" style="width:auto" aria-label="Data eccezione"><button class="btn sm" data-act="ex-add" data-mode="off">＋ Non in servizio</button><button class="btn sm" data-act="ex-add" data-mode="custom">＋ Orario diverso</button></div></div>';
    if (!(t.exceptions || []).length) h += '<p class="muted small">Nessuna eccezione.</p>';
    (t.exceptions || []).forEach((ex, i) => {
      h += '<div style="margin-bottom:6px"><b>' + dLabel(ex.date) + '</b> <input class="input" style="max-width:340px;display:inline-block;min-height:32px" data-bind="thDraft.exceptions.' + i + '.note" value="' + esc(ex.note || '') + '" placeholder="Motivo" aria-label="Motivo"> <button class="btn sm danger" data-act="ex-del" data-i="' + i + '">Elimina</button></div>';
      h += ex.off ? '<p class="small">Non in servizio in questa data.</p>' : dayEditor('exceptions.' + i, ex, 'Orario del ' + E.fmtIt(ex.date), true);
    });
    h += '</section>';
    const abs = state.absences.filter(a => a.therapistId === id);
    h += '<section class="panel"><h3>Indisponibilità registrate</h3>' + (abs.length ? abs.map(a => '<div class="small">' + esc(a.type) + ' ' + E.fmtIt(a.startDate) + (a.allDay === false ? ' ' + a.startTime + '–' + a.endTime : a.endDate ? ' → ' + E.fmtIt(a.endDate) : ' → rientro non noto') + '</div>').join('') : '<p class="muted small">Nessuna.</p>') + '<p><a href="#/assenze">Gestisci in Ferie e malattie</a></p></section>';
    return h;
  }
  function dayEditor(pathKey, day, title, isException) {
    const errs = day ? E.validateDay(day) : [];
    let h = '<div class="day-editor"><div class="btn-row" style="justify-content:space-between;margin-bottom:6px"><b>' + title + '</b>' +
      (isException ? '' : '<label class="chk"><input type="checkbox" data-act="day-toggle" data-key="' + pathKey + '"' + (day ? ' checked' : '') + '> in servizio</label>') + '</div>';
    if (!day) return h + '<span class="muted small">Non in servizio</span></div>';
    h += '<div class="btn-row" style="margin-bottom:6px"><span class="small">Ingresso</span><select class="input" style="width:100px;min-height:34px" data-bind="thDraft.' + pathKey + '.in" data-rerender="1">' + timeOptions(day.in, '06:00', '16:00', 1) + '</select>' +
      '<span class="small">Uscita</span><select class="input" style="width:100px;min-height:34px" data-bind="thDraft.' + pathKey + '.out" data-rerender="1">' + timeOptions(day.out, '06:00', '18:00', 1) + '</select></div>';
    day.blocks.forEach((b, i) => {
      h += '<div class="row"><select class="input" data-bind="thDraft.' + pathKey + '.blocks.' + i + '.type" data-rerender="1" aria-label="Tipo fascia">' + optionsHtml(Object.entries(E.BLOCK_TYPES).map(([k, v]) => [k, v.label]), b.type) + '</select>' +
        '<select class="input" data-bind="thDraft.' + pathKey + '.blocks.' + i + '.start" data-rerender="1" aria-label="Inizio">' + timeOptions(b.start, '06:00', '18:00', 1) + '</select>' +
        '<select class="input" data-bind="thDraft.' + pathKey + '.blocks.' + i + '.end" data-rerender="1" aria-label="Fine">' + timeOptions(b.end, '06:00', '18:00', 1) + '</select>' +
        (b.type === 'amb' ? '<select class="input" data-bind="thDraft.' + pathKey + '.blocks.' + i + '.maxPatients" data-type="num" aria-label="Limite pazienti">' + optionsHtml([[0, 'nessun limite'], [1, 'max 1 paziente'], [2, 'max 2 pazienti']], b.maxPatients || 0) + '</select>' : '<span></span>') +
        '<input class="input" data-bind="thDraft.' + pathKey + '.blocks.' + i + '.note" value="' + esc(b.note || '') + '" placeholder="nota" aria-label="Nota">' +
        '<button class="btn sm danger" data-act="blk-del" data-key="' + pathKey + '" data-i="' + i + '" aria-label="Elimina fascia">×</button></div>';
    });
    h += '<button class="btn sm" data-act="blk-add" data-key="' + pathKey + '">＋ Fascia</button>';
    if (errs.length) h += '<div class="err">' + errs.map(esc).join('<br>') + '</div>';
    return h + '</div>';
  }

  /* ================================================================== */
  /* VISTA: Impostazioni                                                  */
  /* ================================================================== */
  VIEWS.impostazioni = function () {
    const S = state.settings;
    const tab = ui.settingsTab;
    let h = '<div class="tabs">' + [['parametri', 'Parametri'], ['turni', 'Schemi di turno'], ['categorie', 'Categorie cliniche'], ['chiusure', 'Festività e chiusure'], ['dati', 'Dati e salvataggio'], ['storico', 'Storico modifiche']].map(([k, l]) => '<button class="' + (tab === k ? 'active' : '') + '" data-act="set-tab" data-tab="' + k + '">' + l + '</button>').join('') + '</div>';
    if (tab === 'parametri') {
      const num = (key, label, help, min, max) => '<div class="field"><label class="lbl">' + label + '</label><input type="number" class="input" min="' + min + '" max="' + max + '" data-setting="' + key + '" value="' + esc(key.split('.').reduce((o, k) => o[k], S)) + '"><div class="field-help">' + help + '</div></div>';
      h += '<section class="panel"><h3>Parametri della ricerca e delle previsioni</h3><div class="grid g3">' +
        num('futureThresholdDays', 'Giorni per "disponibile subito"', 'Oltre questa soglia dalla prima data utile un posto certo è indicato come "futuro confermato".', 0, 60) +
        num('searchHorizonWeeks', 'Orizzonte di ricerca (settimane)', 'Fino a quando cercare la data di inizio del ciclo.', 1, 52) +
        num('reserveWeeks', 'Riserva provvisoria (settimane)', 'Per "da valutare" e "prosecuzione prevista" senza rinnovo calendarizzato.', 0, 26) +
        num('updateThreshold', 'Avviso aggiornamento previsione', 'Sedute rimanenti sotto cui chiedere di aggiornare la previsione.', 0, 20) +
        num('gapDays', 'Giorni per i buchi di recupero', 'Quanti giorni mostrare nella scheda "buchi singoli".', 1, 60) +
        '<div class="field"><label class="lbl">Durata predefinita</label><select class="input" data-setting="defaultDuration">' + optionsHtml([[30, '30 minuti'], [45, '45 minuti']], S.defaultDuration) + '</select></div></div></section>' +
        '<section class="panel"><h3>Avviso sedute da 45 minuti</h3><p class="muted small">È solo un avviso, mai un divieto. Da verificare con il servizio.</p><div class="grid g3">' +
        '<div class="field"><label class="chk"><input type="checkbox" data-setting="warn45.enabled"' + (S.warn45.enabled ? ' checked' : '') + '> Avviso attivo</label></div>' +
        num('warn45.threshold', 'Avvisa oltre N sedute da 45 al giorno', '', 0, 10) +
        '<div class="field"><span class="lbl">Applica ai profili</span>' + Object.entries(E.PROFILES).map(([k, l]) => '<label class="chk"><input type="checkbox" data-act="warn45-profile" value="' + k + '"' + (S.warn45.profiles.includes(k) ? ' checked' : '') + '> ' + esc(l) + '</label>').join('<br>') + '</div></div></section>' +
        '<section class="panel"><h3>Priorità della lista d\'attesa</h3><div class="chips">' + E.PRIORITY_ORDER.map(prioTag).join('') + '</div><p class="muted small">' + PRIO_NOTE + ' Non prevede date, conteggi o scadenze.</p></section>';
    }
    if (tab === 'turni') {
      const t7 = S.templates.reparto7, t8 = S.templates.reparto8, ta = S.templates.ambulatorio;
      h += '<section class="panel"><h3>Limiti dell\'ambulatorio pomeridiano</h3><p class="muted small">Questi limiti non sono ancora definiti in modo rigido: modificali qui. L\'<b>estensione</b> è tempo ricavabile solo dopo conferma; il resto fino a fine turno è riservato alle cartelle.</p>' +
        '<div class="grid g2"><div class="card"><h4>Gruppo ingresso 7:00 (fine turno 14:12)</h4><div class="grid g2"><div class="field"><label class="lbl">Fine ambulatorio ordinario</label><select class="input" data-setting="templates.reparto7.ambEnd">' + timeOptions(t7.ambEnd, '12:40', '14:12', 5) + '</select></div>' +
        '<div class="field"><label class="lbl">Fine estensione possibile</label><select class="input" data-setting="templates.reparto7.extEnd">' + timeOptions(t7.extEnd, '12:40', '14:12', 5) + '</select></div></div>' +
        '<button class="btn sm" data-act="apply-template" data-profile="reparto7">Applica ai colleghi del gruppo 7</button></div>' +
        '<div class="card"><h4>Gruppo ingresso 8:00 (fine turno 15:12)</h4><div class="grid g2"><div class="field"><label class="lbl">Fine ambulatorio ordinario</label><select class="input" data-setting="templates.reparto8.ambEnd">' + timeOptions(t8.ambEnd, '13:00', '15:12', 5) + '</select></div>' +
        '<div class="field"><label class="lbl">Fine estensione possibile</label><select class="input" data-setting="templates.reparto8.extEnd">' + timeOptions(t8.extEnd, '13:00', '15:12', 5) + '</select></div></div>' +
        '<button class="btn sm" data-act="apply-template" data-profile="reparto8">Applica ai colleghi del gruppo 8</button></div>' +
        '<div class="card"><h4>Solo ambulatorio (8:00–15:12, pazienti dalle 8:15, pausa 12:20–12:40)</h4><div class="grid g2"><div class="field"><label class="lbl">Fine ambulatorio ordinario</label><select class="input" data-setting="templates.ambulatorio.ambEnd">' + timeOptions(ta.ambEnd, '13:00', '15:12', 5) + '</select></div>' +
        '<div class="field"><label class="lbl">Fine estensione possibile</label><select class="input" data-setting="templates.ambulatorio.extEnd">' + timeOptions(ta.extEnd, '13:00', '15:12', 5) + '</select></div></div>' +
        '<button class="btn sm" data-act="apply-template" data-profile="ambulatorio">Applica ai colleghi solo ambulatoriali</button></div></div>' +
        '<p class="small muted" style="margin-top:10px">"Applica" sostituisce la settimana tipo dei colleghi del gruppo (le eccezioni per data restano). Le singole schede restano modificabili.</p></section>';
    }
    if (tab === 'categorie') {
      h += '<section class="panel"><h3>Categorie cliniche (esempi modificabili)</h3><p class="muted small">Non rappresentano l\'elenco reale del servizio. Una categoria in uso non può essere eliminata.</p><div class="table-wrap"><table class="t"><thead><tr><th>Nome</th><th>In uso</th><th></th></tr></thead><tbody>' +
        state.categories.map(c => {
          const used = state.paths.some(p => p.categoryId === c.id) || state.waitlist.some(w => w.categoryId === c.id);
          return '<tr><td><input class="input" data-act="cat-rename" data-id="' + c.id + '" value="' + esc(c.name) + '" aria-label="Nome categoria"></td><td>' + (used ? 'sì' : 'no') + '</td><td>' + (used ? '' : '<button class="btn sm danger" data-act="cat-del" data-id="' + c.id + '">Elimina</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="btn-row" style="margin-top:10px"><input class="input" id="cat-new" style="max-width:300px" placeholder="Nuova categoria" aria-label="Nuova categoria"><button class="btn" data-act="cat-add">＋ Aggiungi</button></div></section>';
    }
    if (tab === 'chiusure') {
      const cl = state.closures.slice().sort((a, b) => a.date < b.date ? -1 : 1);
      h += '<section class="panel"><h3>Festività e chiusure applicate</h3><p class="muted small">Nelle date di chiusura non si propongono sedute: il ciclo salta la data e si allunga (la seduta non viene contata).</p>' +
        '<div class="btn-row" style="margin-bottom:10px"><input type="date" class="input" id="cl-date" style="width:auto" aria-label="Data"><input class="input" id="cl-label" style="max-width:280px" placeholder="Descrizione (es. Santo Patrono)" aria-label="Descrizione"><button class="btn" data-act="cl-add">＋ Aggiungi chiusura</button></div>' +
        '<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Descrizione</th><th>Tipo</th><th>Appuntamenti in quella data</th><th></th></tr></thead><tbody>' +
        cl.map(c => { const n = state.sessions.filter(s => s.date === c.date && E.OCCUPYING.has(s.status)).length; return '<tr' + (c.date < today() ? ' style="opacity:.55"' : '') + '><td class="nowrap">' + dLabel(c.date) + '</td><td>' + esc(c.label) + '</td><td>' + (c.type === 'festivita' ? 'Festività' : 'Chiusura') + '</td><td>' + (n ? TAG.bad(n + ' in conflitto') : '—') + '</td><td><button class="btn sm danger" data-act="cl-del" data-date="' + c.date + '">Elimina</button></td></tr>'; }).join('') +
        '</tbody></table></div></section>';
    }
    if (tab === 'dati') {
      let size = 0; try { size = (localStorage.getItem(KEY) || '').length; } catch (e) { /* */ }
      h += '<section class="panel"><h3>Come vengono salvati i dati</h3><div class="notice info">I dati sono salvati <b>solo in questo browser, su questo computer</b> (archivio locale del browser). Restano dopo l\'aggiornamento della pagina e dopo la chiusura del browser.<br>' +
        '<b>Limiti:</b> non sono condivisi con altri colleghi o computer; non c\'è accesso multiutente; cancellando i dati di navigazione del browser si perdono; la navigazione in incognito non li conserva. Usa l\'esportazione per farne una copia.</div>' +
        '<p class="small">Spazio usato: circa ' + Math.round(size / 1024) + ' KB · Stato del salvataggio: ' + (Store.ok ? TAG.ok('funzionante') : TAG.bad('non disponibile')) + '</p>' +
        '<div class="btn-row"><button class="btn primary" data-act="export">⬇ Esporta dati (file JSON)</button><label class="btn">⬆ Importa dati<input type="file" accept="application/json,.json" data-act="import" hidden></label><button class="btn danger" data-act="reset-demo">Ripristina i dati di esempio</button></div></section>';
    }
    if (tab === 'storico') {
      h += '<section class="panel"><h3>Storico delle modifiche importanti</h3><p class="muted small">Ultime ' + state.log.length + ' operazioni (massimo 500), salvate con i dati.</p><div class="log-list">' +
        state.log.map(l => '<div><span class="muted small nowrap">' + new Date(l.ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) + '</span> — ' + esc(l.text) + '</div>').join('') + '</div></section>';
    }
    return h;
  };

  /* ================================================================== */
  /* MODALI                                                               */
  /* ================================================================== */
  const MODALS = {};
  MODALS.confirm = m => ({
    title: m.title, body: m.html,
    foot: '<button class="btn" data-act="close-modal">Annulla</button><button class="btn ' + (m.danger ? 'danger' : 'primary') + '" data-act="modal-ok">' + esc(m.okLabel) + '</button>'
  });
  MODALS.info = m => ({ title: m.title, body: m.html, wide: m.wide, foot: '<button class="btn primary" data-act="close-modal">Chiudi</button>' });

  function cycleDatesHtml(ev, skipped, start, dur) {
    const items = ev.perDate.map(({ date, r }) => {
      const cls = r.status === 'ok' ? 'ok' : r.status === 'prob' ? 'prob' : r.status === 'ext' ? 'ext' : 'bad';
      const txt = r.status === 'ok' ? '✓ libero' : r.status === 'ext' ? '◐ estensione: ' + esc(r.extInfo.text) : r.status === 'prob' ? '? dipende da ' + r.deps.map(d => esc(ptName(d.pathId))).join(', ') : '⚠ ' + esc(r.reason);
      return { date, html: '<div class="date-item ' + cls + '"><b>' + dLabel(date) + '</b> ' + hm(start) + '–' + hm(start + dur) + '<br><span class="small">' + txt + '</span></div>' };
    });
    skipped.forEach(s => items.push({ date: s.date, html: '<div class="date-item skip"><b>' + dLabel(s.date) + '</b><br><span class="small">saltata: ' + esc(s.label) + '</span></div>' }));
    items.sort((a, b) => a.date < b.date ? -1 : 1);
    return '<div class="date-list">' + items.map(i => i.html).join('') + '</div>';
  }
  MODALS.cycle = m => {
    const { g, o, req } = m;
    const ctx = E.makeContext(state);
    const ev = E.evaluateCycle(ctx, g.therapist, o.dates, o.start, req.duration, { full: true });
    return {
      title: 'Calendario del ciclo — ' + esc(g.therapist.name), wide: true,
      body: '<dl class="kv"><dt>Giorni e orario</dt><dd>' + E.weekdaysLabel(req.weekdays) + ' ' + hm(o.start) + '–' + hm(o.end) + '</dd><dt>Sedute</dt><dd>' + o.dates.length + ' · dal ' + dLabel(o.startDate) + ' al ' + dLabel(o.endDate) + '</dd><dt>Disponibilità</dt><dd>' + availabilityTag(o) + '</dd></dl>' +
        cycleDatesHtml(ev, o.skipped, o.start, req.duration),
      foot: '<button class="btn" data-act="close-modal">Chiudi</button>'
    };
  };
  MODALS.book = m => {
    const { g, o, req } = m;
    return {
      title: 'Conferma assegnazione', wide: true,
      body: '<div class="grid g2"><div class="field"><label class="lbl" for="bk-name">Paziente (nome o identificativo) *</label><input id="bk-name" class="input" value="' + esc(ui.search.name) + '" autofocus></div><div></div></div>' +
        '<dl class="kv" style="margin-top:10px"><dt>Fisioterapista</dt><dd>' + esc(g.therapist.name) + ' · ' + (g.kind === 'specifica' ? 'competenza specifica' : 'altra idoneità') + '</dd>' +
        '<dt>Percorso</dt><dd>' + esc(catName(req.categoryId)) + ' · ' + req.duration + ' min</dd><dt>Giorni e orario</dt><dd><b>' + E.weekdaysLabel(req.weekdays) + ' ' + hm(o.start) + '–' + hm(o.end) + '</b></dd>' +
        '<dt>Ciclo</dt><dd>' + req.sessions + ' sedute, dal <b>' + dLabel(o.startDate) + '</b> al <b>' + dLabel(o.endDate) + '</b></dd>' +
        '<dt>Priorità · richiesta</dt><dd>' + prioTag(ui.search.priority) + ' · ' + esc(reqTypeName(ui.search.requestType)) + '</dd></dl>' +
        (o.status === 'ext' ? '<div class="notice warn"><b>Attenzione: la proposta usa la fascia di estensione</b> in ' + o.extDates.length + ' date. ' + esc(o.extDates[0].info.text) + '.<br><label class="chk" style="margin-top:6px"><input type="checkbox" id="bk-ext"> Ho verificato con il collega l\'estensione della fascia e il tempo per le cartelle</label></div>' : '') +
        (o.warnings.length ? '<div class="notice warn">' + o.warnings.map(w => E.fmtItShort(w.date) + ': ' + esc(w.text)).join('<br>') + '</div>' : '') +
        '<p class="small muted">Prima di salvare il programma ricontrolla tutte le date con i dati aggiornati.</p>' + cycleDatesHtml({ perDate: o.dates.map(d => ({ date: d, r: { status: o.extDates.some(x => x.date === d) ? 'ext' : 'ok', extInfo: (o.extDates.find(x => x.date === d) || {}).info } })) }, o.skipped, o.start, req.duration),
      foot: '<button class="btn" data-act="close-modal">Annulla</button><button class="btn ok big" data-act="book-confirm">✓ Conferma assegnazione</button>'
    };
  };
  MODALS.preaccordo = m => {
    const { o, g } = m;
    const wl = ui.search.waitlistId ? state.waitlist.find(w => w.id === ui.search.waitlistId) : null;
    return {
      title: 'Registra un preaccordo (non è una prenotazione)',
      body: '<div class="notice warn">Il posto <b>' + E.weekdaysLabel(m.req.weekdays) + ' ' + hm(o.start) + ' con ' + esc(g.therapist.name) + ' dal ' + E.fmtIt(o.startDate) + '</b> è solo <b>probabile</b>. Dipende da:<ul class="cond">' +
        o.deps.map(d => '<li>' + esc(ptName(d.pathId)) + ' — ' + esc(d.why) + '</li>').join('') + '</ul>Il preaccordo resta separato dalle prenotazioni confermate e non occupa l\'agenda.</div>' +
        (wl ? '<p>Verrà annotato sul paziente in lista <b>' + esc(wl.name) + '</b>, che passerà a "Proposta in valutazione".</p>' : '<div class="field"><label class="lbl">Paziente *</label><input id="pa-name" class="input" value="' + esc(ui.search.name) + '" autofocus></div><p class="small muted">Il paziente verrà aggiunto alla lista d\'attesa con i dati della ricerca.</p>'),
      foot: '<button class="btn" data-act="close-modal">Annulla</button><button class="btn warn" data-act="preaccordo-save">Registra preaccordo</button>'
    };
  };
  MODALS.session = m => {
    const s = state.sessions.find(x => x.id === m.id);
    if (!s) return { title: 'Seduta', body: 'Seduta non trovata.' };
    const p = pathById(s.pathId);
    const ctx = E.makeContext(state);
    const issue = E.sessionIssue(ctx, s);
    const cyc = state.cycles.find(c => c.id === s.cycleId);
    const counted = state.sessions.filter(x => x.cycleId === s.cycleId && E.COUNTED.has(x.status)).sort((a, b) => a.date < b.date ? -1 : 1);
    const k = counted.findIndex(x => x.id === s.id) + 1;
    const btn = (st, label, cls) => '<button class="btn sm ' + (cls || '') + '" data-act="set-session" data-id="' + s.id + '" data-status="' + st + '"' + (s.status === st ? ' disabled' : '') + '>' + label + '</button>';
    return {
      title: esc(ptName(s.pathId)) + ' — ' + dLabel(s.date) + ' ' + s.start,
      body: (issue ? '<div class="notice bad">⚠ ' + esc(issue.reason) + '. L\'appuntamento non è stato cancellato: scegli sostituzione o recupero.</div>' : '') +
        '<dl class="kv"><dt>Percorso</dt><dd>' + esc(catName(p.categoryId)) + '</dd><dt>Fisioterapista</dt><dd>' + esc(thName(s.therapistId)) + (s.originalTherapistId ? ' (sostituisce ' + esc(thName(s.originalTherapistId)) + ')' : '') + '</dd>' +
        '<dt>Orario</dt><dd>' + s.start + '–' + hm(E.toMin(s.start) + s.duration) + ' (' + s.duration + ' min)' + (s.extension ? ' · in estensione' : '') + '</dd>' +
        '<dt>Ciclo</dt><dd>Ciclo ' + (cyc ? cyc.index : '?') + (k ? ' · seduta ' + k + ' di ' + (cyc ? cyc.plannedSessions : '?') : '') + (s.recoveryOf ? ' · recupero' : '') + '</dd>' +
        '<dt>Stato</dt><dd>' + SESSION_TAG[s.status]() + (s.status === 'programmata' && s.date < today() ? ' <span class="small" style="color:var(--prob)">data passata: registrare l\'esito</span>' : '') + '</dd>' + (s.note ? '<dt>Nota</dt><dd>' + esc(s.note) + '</dd>' : '') + '</dl>' +
        '<span class="lbl">Registra l\'esito</span><div class="btn-row">' + btn('effettuata', '✓ Effettuata', 'ok') + btn('assente', 'Assenza paziente') + btn('annullata', 'Annullata dal servizio') + btn('da_recuperare', '↺ Da recuperare') + btn('programmata', 'Riporta a programmata') + '</div>' +
        '<p class="small muted">Una seduta non diventa mai "effettuata" in automatico. Dopo un\'assenza decidi tu se serve un recupero.</p>',
      foot: '<a class="btn" href="#/pazienti/' + p.id + '" data-act="close-modal-nav">Apri percorso</a>' + (issue ? '<button class="btn" data-act="substitutes" data-id="' + s.id + '">Cerca sostituto</button>' : '') +
        (['da_recuperare', 'assente', 'annullata'].includes(s.status) ? '<button class="btn primary" data-act="recovery" data-id="' + s.id + '">↺ Programma recupero</button>' : '') + '<button class="btn" data-act="close-modal">Chiudi</button>'
    };
  };
  MODALS.recovery = m => {
    const s = state.sessions.find(x => x.id === m.id);
    const p = pathById(s.pathId);
    const pvEnd = E.previewRecovery(state, s.id, { mode: 'fine' });
    const ctx = E.makeContext(state);
    const gapsSame = E.findGaps(state, { duration: s.duration, fromDate: nextWorkingDay(E.addDays(today(), -1)), days: 14, therapistIds: [p.therapistId] }, { ctx });
    const gapsOther = E.findGaps(state, { categoryId: p.categoryId, duration: s.duration, fromDate: nextWorkingDay(E.addDays(today(), -1)), days: 7 }, { ctx }).filter(g => g.therapist.id !== p.therapistId);
    const chip = (g, it) => '<button class="btn sm" data-act="recovery-at" data-id="' + s.id + '" data-th="' + g.therapist.id + '" data-date="' + it.date + '" data-start="' + hm(it.start) + '">' + dShort(it.date) + ' ' + hm(it.start) + '</button>';
    const r = pvEnd.r;
    return {
      title: 'Programma recupero — ' + esc(ptName(s.pathId)), wide: true,
      body: '<p>Seduta persa: <b>' + dLabel(s.date) + ' ' + s.start + '</b>. Il recupero sostituisce questa seduta nel conteggio: il totale del ciclo non cambia.</p>' +
        '<h4>1. In coda al ciclo, stesso orario</h4><p>' + dLabel(pvEnd.date) + ' ' + hm(pvEnd.start) + ' con ' + esc(thName(pvEnd.therapistId)) + ' — ' +
        (r.status === 'ok' ? TAG.ok('libero') : r.status === 'ext' ? TAG.ext('estensione') : r.status === 'prob' ? TAG.prob('solo probabile') : TAG.bad(esc(r.reason))) + '</p>' +
        (r.status === 'ok' ? '<button class="btn primary" data-act="recovery-end" data-id="' + s.id + '">Programma in coda al ciclo</button>' : '') +
        '<h4 style="margin-top:14px">2. In un buco libero con ' + esc(thName(p.therapistId)) + ' (prossimi 14 giorni)</h4>' +
        (gapsSame.length ? '<div class="btn-row">' + gapsSame[0].items.slice(0, 16).map(it => chip(gapsSame[0], it)).join('') + '</div>' : '<p class="muted">Nessun buco disponibile.</p>') +
        '<h4 style="margin-top:14px">3. Con un altro collega idoneo (sostituzione esplicita, prossimi 7 giorni)</h4>' +
        (gapsOther.length ? gapsOther.slice(0, 6).map(g => '<div style="margin-bottom:6px"><b>' + esc(g.therapist.name) + '</b> ' + (g.kind === 'specifica' ? tag('info', '★') : '') + '<div class="btn-row">' + g.items.slice(0, 8).map(it => chip(g, it)).join('') + '</div></div>').join('') : '<p class="muted">Nessuno.</p>'),
      foot: '<button class="btn" data-act="close-modal">Annulla</button>'
    };
  };
  MODALS.substitutes = m => {
    const s = state.sessions.find(x => x.id === m.id);
    const list = E.findSubstitutes(state, s.id);
    return {
      title: 'Sostituzione — ' + esc(ptName(s.pathId)) + ' ' + dLabel(s.date) + ' ' + s.start,
      body: '<p class="small">Colleghi idonei e liberi alla stessa ora. Nessuno spostamento viene fatto in automatico.</p>' +
        (list.length ? '<table class="t"><tbody>' + list.map(x => '<tr><td class="who">' + esc(x.therapist.name) + '</td><td>' + (x.kind === 'specifica' ? tag('info', '★ Competenza specifica') : tag('plain', 'Altra idoneità')) + '</td><td>' + (x.r.status === 'ok' ? TAG.ok('libero') : TAG.ext('estensione')) + '</td><td>' +
          (x.r.status === 'ok' ? '<button class="btn sm primary" data-act="substitute" data-id="' + s.id + '" data-th="' + x.therapist.id + '">Assegna</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="notice warn">Nessun collega idoneo libero a quell\'ora. Puoi segnare la seduta "da recuperare".</div>'),
      foot: '<button class="btn" data-act="mark-recover" data-id="' + s.id + '">Segna da recuperare</button><button class="btn" data-act="close-modal">Chiudi</button>'
    };
  };
  MODALS.renew = m => {
    const pv = E.previewRenewal(state, m.pathId, m.n);
    const p = pathById(m.pathId);
    const ok = !pv.conflicts.length;
    return {
      title: 'Rinnovo di ' + m.n + ' sedute — ' + esc(ptName(m.pathId)), wide: true,
      body: (ok ? '<div class="notice ok">Tutte le date sono libere' + (pv.ev.status === 'ext' ? ' (alcune in estensione)' : '') + '. Il nuovo ciclo resterà collegato ai precedenti.' + (pv.probable.length ? ' Nota: ' + pv.probable.length + ' date si sovrappongono a posti oggi solo probabili di altri pazienti.' : '') + '</div>'
        : '<div class="notice bad"><b>' + pv.conflicts.length + ' date in conflitto.</b> Il rinnovo con lo stesso orario non è possibile. Puoi cercare un altro orario o gestire prima i conflitti.</div>') +
        '<p>' + E.weekdaysLabel(p.weekdays) + ' ' + p.startTime + ' con ' + esc(thName(p.therapistId)) + ', dal ' + dLabel(pv.dates[0]) + ' al ' + dLabel(pv.dates[pv.dates.length - 1]) + '</p>' +
        (pv.ev.status === 'ext' && ok ? '<label class="chk"><input type="checkbox" id="rn-ext"> Confermo l\'uso dell\'estensione</label>' : '') +
        cycleDatesHtml(pv.ev, pv.skipped, E.toMin(p.startTime), p.duration),
      foot: '<button class="btn" data-act="close-modal">Annulla</button>' + (ok ? '<button class="btn primary" data-act="renew-confirm" data-id="' + m.pathId + '" data-n="' + m.n + '">Conferma rinnovo</button>' : '<button class="btn" data-act="renew-search" data-id="' + m.pathId + '" data-n="' + m.n + '">Cerca un altro orario</button>')
    };
  };
  MODALS.waitlist = m => {
    const w = m.draft;
    const k = w.weekdays.slice().sort().join(',');
    const freq = w.freqMode || (k === '1,3,5' ? 'lmv' : k === '2,4' ? 'mg' : 'custom');
    return {
      title: m.isNew ? 'Nuovo paziente in lista d\'attesa' : 'Modifica — ' + esc(w.name), wide: true,
      body: '<div class="grid g3">' +
        '<div class="field"><label class="lbl">Nome / identificativo *</label><input class="input" data-bind="modal.draft.name" value="' + esc(w.name) + '" autofocus></div>' +
        '<div class="field"><label class="lbl">Data di inserimento</label><input type="date" class="input" data-bind="modal.draft.insertedAt" value="' + esc(w.insertedAt) + '"></div>' +
        '<div class="field"><label class="lbl">Priorità</label><select class="input" data-bind="modal.draft.priority">' + optionsHtml(prioOptions(), E.PRIORITY_CLASSES[w.priority] ? w.priority : 'NI') + '</select><div class="field-help">Scelta dall\'operatore, mai dedotta dalla patologia.</div></div>' +
        '<div class="field"><label class="lbl">Tipo di richiesta</label><select class="input" data-bind="modal.draft.requestType">' + optionsHtml([['', '—']].concat(Object.entries(E.REQUEST_TYPES)), w.requestType || '') + '</select></div>' +
        '<div class="field"><label class="lbl">Patologia / percorso</label><select class="input" data-bind="modal.draft.categoryId">' + optionsHtml(state.categories.map(c => [c.id, c.name]), w.categoryId) + '</select></div>' +
        '<div class="field"><label class="lbl">Durata</label><select class="input" data-bind="modal.draft.duration" data-type="num">' + optionsHtml([[30, '30 min'], [45, '45 min']], w.duration) + '</select></div>' +
        '<div class="field"><label class="lbl">Sedute</label><input type="number" min="1" max="60" class="input" data-bind="modal.draft.sessions" data-type="num" value="' + esc(w.sessions) + '"></div>' +
        '<div class="field"><span class="lbl">Frequenza</span><div class="seg">' + [['lmv', 'Lun-Mer-Ven'], ['mg', 'Mar-Gio'], ['custom', 'Personalizzata']].map(([v, l]) => '<label><input type="radio" name="wfq" value="' + v + '" data-act="wl-freq"' + (freq === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</div>' +
        (freq === 'custom' ? '<div class="wd-pick">' + [1, 2, 3, 4, 5].map(d => '<label><input type="checkbox" value="' + d + '" data-act="wl-wd"' + (w.weekdays.includes(d) ? ' checked' : '') + '><span>' + E.WEEKDAY_SHORT[d] + '</span></label>').join('') + '</div>' : '') + '</div>' +
        '<div class="field"><label class="lbl">Disponibile dal</label><input type="date" class="input" data-bind="modal.draft.earliestDate" value="' + esc(w.earliestDate) + '"></div>' +
        '<div class="field"><label class="lbl">Stato</label><select class="input" data-bind="modal.draft.status">' + optionsHtml(Object.entries(E.WAITLIST_STATUS), w.status) + '</select></div>' +
        '<div class="field"><label class="lbl">Fascia oraria (facoltativa)</label><div class="btn-row"><select class="input" style="width:100px" data-bind="modal.draft.prefFrom">' + optionsHtml([['', '—']], w.pref ? w.pref.from : '') + timeOptions(w.pref ? w.pref.from : '', '07:00', '15:00', 15) + '</select><select class="input" style="width:100px" data-bind="modal.draft.prefTo">' + optionsHtml([['', '—']], w.pref ? w.pref.to : '') + timeOptions(w.pref ? w.pref.to : '', '07:15', '15:15', 15) + '</select></div></div>' +
        '<div class="field"><label class="lbl">Tipo di vincolo</label><select class="input" data-bind="modal.draft.prefMode">' + optionsHtml([['flessibile', 'Preferenza flessibile'], ['obbligatoria', 'Vincolo obbligatorio']], w.pref ? w.pref.mode : 'flessibile') + '</select></div>' +
        '<div class="field"><label class="lbl">Note sulla disponibilità</label><input class="input" data-bind="modal.draft.availabilityNote" value="' + esc(w.availabilityNote || '') + '"></div>' +
        '<div class="field" style="grid-column:1/-1"><label class="lbl">Nota</label><input class="input" data-bind="modal.draft.note" value="' + esc(w.note || '') + '"></div></div>',
      foot: (m.isNew ? '' : '<button class="btn danger" data-act="wl-delete">Elimina</button>') + '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="wl-save">Salva</button>'
    };
  };
  MODALS.compatible = m => {
    const p = pathById(m.pathId);
    const ov = E.forecastOverview(state).find(r => r.path.id === p.id);
    const slot = { therapistId: p.therapistId, weekdays: p.weekdays, start: E.toMin(p.startTime), duration: p.duration, freeFrom: ov.slot.freeFrom };
    const list = E.compatibleWaitlist(state, slot);
    return {
      title: 'Pazienti in lista compatibili con il posto di ' + esc(ptName(p.id)), wide: true,
      body: '<p>' + esc(thName(p.therapistId)) + ' · ' + E.weekdaysLabel(p.weekdays) + ' ' + p.startTime + ' · ' + slotTag(ov.slot) + '</p><p class="small muted">Ordinati per priorità e poi per tempo di attesa. La verifica controlla tutte le date del ciclo del paziente in lista.</p>' +
        '<table class="t"><thead><tr><th>Paziente</th><th>Priorità</th><th>Attesa</th><th>Percorso</th><th>Ciclo</th><th>Verifica</th><th></th></tr></thead><tbody>' +
        list.map(x => '<tr><td class="who">' + esc(x.entry.name) + '</td><td>' + prioTag(x.entry.priority) + '</td><td>' + E.diffDays(x.entry.insertedAt, today()) + ' gg</td><td>' + esc(catName(x.entry.categoryId)) + ' · ' + x.entry.duration + ' min</td><td>' + E.weekdaysLabel(x.entry.weekdays) + ' · ' + x.entry.sessions + ' dal ' + E.fmtItShort(x.startDate) + '</td><td>' +
          (x.ev.status === 'ok' ? TAG.ok('certo') : x.ev.status === 'ext' ? TAG.ext('estensione') : x.ev.status === 'prob' ? TAG.prob('probabile') : TAG.bad(esc(x.ev.firstFail.r.reason) + ' (' + E.fmtItShort(x.ev.firstFail.date) + ')')) + '</td><td><button class="btn sm primary" data-act="wl-find" data-id="' + x.entry.id + '">Trova posto</button></td></tr>').join('') + '</tbody></table>',
      foot: '<button class="btn" data-act="close-modal">Chiudi</button>'
    };
  };
  MODALS.absImpact = m => {
    const a = state.absences.find(x => x.id === m.id);
    const imp = a ? E.impactedByAbsence(state, a).filter(s => s.date >= today()) : [];
    return {
      title: 'Appuntamenti coinvolti — ' + esc(a ? thName(a.therapistId) : ''), wide: true,
      body: (m.justAdded ? '<div class="notice ok">Assenza registrata. Le disponibilità sono aggiornate.</div>' : '') +
        '<div class="notice warn">Gli appuntamenti <b>non sono stati cancellati</b>. Per ciascuno scegli una sostituzione o segnalo da recuperare. Gli altri pazienti non vengono spostati automaticamente.</div>' +
        (imp.length ? '<table class="t"><thead><tr><th>Data</th><th>Orario</th><th>Paziente</th><th>Azioni</th></tr></thead><tbody>' + imp.map(s => '<tr><td class="nowrap">' + dLabel(s.date) + '</td><td>' + s.start + '</td><td class="who">' + esc(ptName(s.pathId)) + '</td><td><div class="btn-row"><button class="btn sm" data-act="substitutes" data-id="' + s.id + '">Cerca sostituto</button><button class="btn sm" data-act="mark-recover" data-id="' + s.id + '" data-back="' + m.id + '">Segna da recuperare</button></div></td></tr>').join('') + '</tbody></table>' : '<p>Nessun appuntamento coinvolto.</p>'),
      foot: '<button class="btn primary" data-act="close-modal">Chiudi</button>'
    };
  };

  /* ================================================================== */
  /* AZIONI                                                               */
  /* ================================================================== */
  function safe(fn) {
    try { return fn(); }
    catch (e) {
      if (e instanceof E.EngineError) { toast(e.message, 'bad'); return null; }
      console.error(e); toast('Errore: ' + e.message, 'bad'); return null;
    }
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = value;
  }
  function getPath(obj, path) { return path.split('.').reduce((o, k) => o == null ? o : o[k], obj); }

  const ACT = {};
  ACT.menu = () => document.querySelector('.app').classList.toggle('menu-open');
  ACT['hide-guide'] = () => { state.meta.hideGuide = true; firstRun = false; Store.save(state); render(); };
  ACT['close-modal'] = () => closeModal();
  ACT['close-modal-nav'] = () => { ui.modal = null; renderModal(); };
  ACT['modal-bg'] = (el, ev) => { if (ev.target === el) closeModal(); };
  ACT['modal-ok'] = () => { const cb = modalCallbacks.ok; closeModal(); if (cb) cb(); };
  // --- ricerca
  ACT.freq = el => {
    const s = ui.search; s.freq = el.value;
    if (el.value === 'lmv') s.weekdays = [1, 3, 5];
    if (el.value === 'mg') s.weekdays = [2, 4];
    render();
  };
  ACT.wd = el => {
    const d = Number(el.value), s = ui.search;
    s.weekdays = el.checked ? [...new Set([...s.weekdays, d])].sort() : s.weekdays.filter(x => x !== d);
  };
  ACT.ses = el => { ui.search.sessionsMode = el.value; render(); };
  ACT['pref-on'] = el => { ui.search.prefOn = el.checked; render(); };
  ACT['search-reset'] = () => { ui.search = defaultSearch(); ui.results = null; render(); };
  ACT.tab = el => { ui.tab = el.dataset.tab; render(); };
  ACT.sort = el => { ui.sort = el.value; if (ui.results) ui.results.request.sort = el.value; render(); };
  ACT.expand = el => { ui.expanded[el.dataset.key] = !ui.expanded[el.dataset.key]; render(); };
  ACT['show-cycle'] = el => { const { g, o } = getOption(el); openModal({ type: 'cycle', g, o, req: ui.results.request }); };
  ACT['confirm-option'] = el => { const { g, o } = getOption(el); openModal({ type: 'book', g, o, req: ui.results.request }); };
  ACT['book-confirm'] = () => {
    const m = ui.modal;
    const name = (document.getElementById('bk-name').value || '').trim();
    if (!name) { toast('Inserisci il nome o l\'identificativo del paziente.', 'bad'); document.getElementById('bk-name').classList.add('invalid'); return; }
    const extBox = document.getElementById('bk-ext');
    if (m.o.status === 'ext' && !(extBox && extBox.checked)) { toast('Spunta la conferma dell\'estensione della fascia.', 'bad'); return; }
    fresh();
    const r = safe(() => E.bookCycle(state, {
      patientName: name, categoryId: m.req.categoryId, therapistId: m.g.therapist.id, duration: m.req.duration,
      weekdays: m.req.weekdays, startTime: hm(m.o.start), startDate: m.o.startDate, sessions: m.req.sessions,
      acceptExtension: m.o.status === 'ext', waitlistId: ui.search.waitlistId || null,
      priority: ui.search.priority, requestType: ui.search.requestType
    }));
    if (!r) { closeModal(); runSearch(); return; }
    closeModal();
    ui.results = null; ui.search = defaultSearch();
    ui.agenda = Object.assign(ui.agenda, { mode: 'settimana', therapistId: m.g.therapist.id, date: r.dates[0], highlightPath: r.pathId });
    state = r.state; Store.save(state);
    toast('Assegnazione confermata: ' + name + ' con ' + m.g.therapist.name + ', ' + E.weekdaysLabel(m.req.weekdays) + ' ' + hm(m.o.start) + ' dal ' + E.fmtIt(r.dates[0]) + '.', 'ok');
    go('#/agenda');
  };
  ACT.preaccordo = el => { const { g, o } = getOption(el); openModal({ type: 'preaccordo', g, o, req: ui.results.request }); };
  ACT['preaccordo-save'] = () => {
    const m = ui.modal;
    const st = E.clone(fresh());
    let w = ui.search.waitlistId ? st.waitlist.find(x => x.id === ui.search.waitlistId) : null;
    if (!w) {
      const name = ((document.getElementById('pa-name') || {}).value || '').trim();
      if (!name) { toast('Inserisci il nome del paziente.', 'bad'); return; }
      w = newWaitlistFromSearch(name);
      st.waitlist.push(w);
    }
    w.preaccordo = { therapistId: m.g.therapist.id, startTime: hm(m.o.start), weekdays: m.req.weekdays, fromDate: m.o.startDate, deps: m.o.deps.map(d => ({ pathId: d.pathId, patient: ptName(d.pathId) })), createdAt: today() };
    w.status = 'proposta';
    E.addLog(st, 'Preaccordo (non prenotazione) per ' + w.name + ': ' + m.g.therapist.name + ' ' + E.weekdaysLabel(m.req.weekdays) + ' ' + hm(m.o.start) + ' dal ' + E.fmtIt(m.o.startDate) + ', dipende da ' + w.preaccordo.deps.map(d => d.patient).join(', '));
    ui.search.waitlistId = w.id;
    closeModal();
    commit(st, 'Preaccordo registrato in lista d\'attesa. Non è una prenotazione.');
  };
  function newWaitlistFromSearch(name) {
    const req = buildRequest();
    return {
      id: E.uid('wl'), name, insertedAt: today(), priority: ui.search.priority || 'NI', requestType: ui.search.requestType || 'prima', categoryId: req.categoryId,
      duration: req.duration, weekdays: req.weekdays, sessions: req.sessions, earliestDate: req.earliestDate, pref: req.pref, status: 'in_attesa', note: '', availabilityNote: '', preaccordo: null
    };
  }
  ACT['search-to-waitlist'] = () => {
    if (!ui.search.name.trim()) { toast('Scrivi prima il nome o l\'identificativo del paziente.', 'bad'); return; }
    if (ui.search.waitlistId) { toast('Questo paziente è già in lista d\'attesa.'); return; }
    const req = buildRequest(); const errs = validateRequest(req);
    if (errs.length) { toast(errs.join(' '), 'bad'); return; }
    const draft = newWaitlistFromSearch(ui.search.name.trim());
    openModal({ type: 'waitlist', draft, isNew: true });
  };
  // --- agenda
  ACT['ag-mode'] = el => { ui.agenda.mode = el.value; render(); };
  ACT['ag-prev'] = () => { const a = ui.agenda; a.date = a.mode === 'giorno' ? prevWorkday(a.date) : E.addDays(a.date, -7); render(); };
  ACT['ag-next'] = () => { const a = ui.agenda; a.date = a.mode === 'giorno' ? nextWorkingDayAny(a.date) : E.addDays(a.date, 7); render(); };
  ACT['ag-today'] = () => { ui.agenda.date = today(); render(); };
  function prevWorkday(d) { d = E.addDays(d, -1); while (E.weekday(d) > 5) d = E.addDays(d, -1); return d; }
  function nextWorkingDayAny(d) { d = E.addDays(d, 1); while (E.weekday(d) > 5) d = E.addDays(d, 1); return d; }
  ACT['open-session'] = el => openModal({ type: 'session', id: el.dataset.id });
  ACT['set-session'] = el => {
    const r = safe(() => E.setSessionStatus(fresh(), el.dataset.id, el.dataset.status));
    if (r) { commit(r.state, 'Stato della seduta aggiornato.'); }
  };
  ACT.recovery = el => openModal({ type: 'recovery', id: el.dataset.id });
  ACT['recovery-end'] = el => {
    const r = safe(() => E.scheduleRecovery(fresh(), el.dataset.id, { mode: 'fine' }));
    if (r) { closeModal(); commit(r.state, 'Recupero programmato il ' + E.fmtIt(r.recovery.date) + ' alle ' + r.recovery.start + '.'); }
  };
  ACT['recovery-at'] = el => {
    const s = state.sessions.find(x => x.id === el.dataset.id);
    const p = pathById(s.pathId);
    const other = el.dataset.th !== p.therapistId;
    const doIt = () => {
      const r = safe(() => E.scheduleRecovery(fresh(), el.dataset.id, { date: el.dataset.date, start: el.dataset.start, therapistId: el.dataset.th }));
      if (r) { closeModal(); commit(r.state, 'Recupero programmato il ' + E.fmtIt(r.recovery.date) + ' alle ' + r.recovery.start + (other ? ' con ' + thName(el.dataset.th) : '') + '.'); }
    };
    if (other) confirmBox('Recupero con un altro collega', '<p>Il recupero sarà svolto da <b>' + esc(thName(el.dataset.th)) + '</b> il ' + dLabel(el.dataset.date) + ' alle ' + el.dataset.start + ' (sostituzione esplicita).</p>', 'Conferma recupero', doIt);
    else doIt();
  };
  ACT.substitutes = el => openModal({ type: 'substitutes', id: el.dataset.id });
  ACT.substitute = el => {
    const r = safe(() => E.substitute(fresh(), el.dataset.id, el.dataset.th));
    if (r) { closeModal(); commit(r.state, 'Sostituzione registrata.'); }
  };
  ACT['mark-recover'] = el => {
    const r = safe(() => E.setSessionStatus(fresh(), el.dataset.id, 'da_recuperare', 'Da recuperare per assenza del collega'));
    if (r) {
      state = r.state; Store.save(state);
      toast('Seduta segnata da recuperare. Il posto in agenda è stato liberato; programma il recupero dalla seduta.', 'ok');
      if (el.dataset.back) openModal({ type: 'absImpact', id: el.dataset.back }); else closeModal();
      render();
    }
  };
  // --- lista d'attesa
  ACT['wl-filter'] = el => { ui.wlFilter = el.value; render(); };
  ACT['wl-prio'] = el => { ui.wlPrio = el.value; render(); };
  ACT['wl-sort'] = el => { ui.wlSort = el.value; render(); };
  ACT['wl-find'] = el => {
    const w = state.waitlist.find(x => x.id === el.dataset.id);
    ui.search = waitlistToSearch(w);
    closeModal();
    location.hash = '#/trova';
    setTimeout(runSearch, 0);
  };
  ACT['wl-status'] = el => {
    const st = E.clone(fresh());
    const w = st.waitlist.find(x => x.id === el.dataset.id);
    const old = w.status; w.status = el.value;
    E.addLog(st, 'Lista d\'attesa: ' + w.name + ' ' + E.WAITLIST_STATUS[old] + ' → ' + E.WAITLIST_STATUS[w.status]);
    commit(st, 'Stato aggiornato.');
  };
  ACT['wl-new'] = () => {
    openModal({ type: 'waitlist', isNew: true, draft: { id: E.uid('wl'), name: '', insertedAt: today(), priority: 'NI', requestType: 'prima', categoryId: state.categories[0].id, duration: 30, weekdays: [1, 3, 5], sessions: 10, earliestDate: nextWorkingDay(today()), pref: null, status: 'in_attesa', note: '', availabilityNote: '', preaccordo: null } });
  };
  ACT['wl-edit'] = el => { openModal({ type: 'waitlist', draft: E.clone(state.waitlist.find(x => x.id === el.dataset.id)) }); };
  ACT['wl-freq'] = el => {
    const d = ui.modal.draft; d.freqMode = el.value;
    if (el.value === 'lmv') d.weekdays = [1, 3, 5];
    if (el.value === 'mg') d.weekdays = [2, 4];
    renderModal();
  };
  ACT['wl-wd'] = el => { const d = ui.modal.draft, n = Number(el.value); d.weekdays = el.checked ? [...new Set([...d.weekdays, n])].sort() : d.weekdays.filter(x => x !== n); };
  ACT['wl-save'] = () => {
    const m = ui.modal, d = m.draft;
    if (!d.name || !d.name.trim()) { toast('Inserisci il nome o l\'identificativo.', 'bad'); return; }
    if (!d.weekdays.length) { toast('Scegli almeno un giorno.', 'bad'); return; }
    if (d.prefFrom !== undefined || d.prefTo !== undefined || d.prefMode !== undefined) {
      const from = d.prefFrom !== undefined ? d.prefFrom : (d.pref && d.pref.from), to = d.prefTo !== undefined ? d.prefTo : (d.pref && d.pref.to);
      const mode = d.prefMode || (d.pref && d.pref.mode) || 'flessibile';
      d.pref = from && to ? { from, to, mode } : null;
    }
    delete d.prefFrom; delete d.prefTo; delete d.prefMode; delete d.freqMode;
    if (!E.PRIORITY_CLASSES[d.priority]) d.priority = 'NI';
    if (d.previousPriority && d.priority !== 'NI') delete d.previousPriority; // riclassificata dall'operatore
    d.name = d.name.trim();
    const st = E.clone(fresh());
    const i = st.waitlist.findIndex(x => x.id === d.id);
    if (i >= 0) st.waitlist[i] = d; else st.waitlist.push(d);
    E.addLog(st, (i >= 0 ? 'Modificato in lista d\'attesa: ' : 'Inserito in lista d\'attesa: ') + d.name + ' (' + catName(d.categoryId) + ', priorità ' + E.PRIORITY_CLASSES[d.priority] + (d.requestType ? ', ' + reqTypeName(d.requestType) : '') + ')');
    if (m.isNew && parseHash()[0] === 'trova') ui.search.waitlistId = d.id;
    closeModal();
    commit(st, 'Lista d\'attesa aggiornata.');
  };
  ACT['wl-delete'] = () => {
    const d = ui.modal.draft;
    confirmBox('Eliminare dalla lista?', '<p>Eliminare <b>' + esc(d.name) + '</b> dalla lista d\'attesa? (In alternativa puoi impostare lo stato "Rinuncia".)</p>', 'Elimina', () => {
      const st = E.clone(fresh()); st.waitlist = st.waitlist.filter(x => x.id !== d.id); E.addLog(st, 'Eliminato dalla lista d\'attesa: ' + d.name); commit(st, 'Eliminato.');
    }, { danger: true });
  };
  // --- percorsi
  ACT['path-filter'] = () => { };
  ACT['path-prio'] = el => { const st = E.clone(fresh()); const p = st.paths.find(x => x.id === el.dataset.id); p.priority = el.value; E.addLog(st, 'Priorità di ' + ptName(p.id) + ': ' + E.PRIORITY_CLASSES[el.value]); commit(st, 'Priorità salvata.'); };
  ACT['path-rt'] = el => { const st = E.clone(fresh()); const p = st.paths.find(x => x.id === el.dataset.id); p.requestType = el.value; E.addLog(st, 'Tipo di richiesta di ' + ptName(p.id) + ': ' + reqTypeName(el.value)); commit(st, 'Tipo di richiesta salvato (cicli e sedute invariati).'); };
  ACT['path-state'] = el => { ui.pathState = el.value; render(); };
  ACT['session-status'] = el => {
    const r = safe(() => E.setSessionStatus(fresh(), el.dataset.id, el.value));
    if (r) commit(r.state, 'Stato della seduta aggiornato.'); else render();
  };
  ACT['save-forecast'] = el => {
    const fs = ui.fcDraft;
    const f = { state: fs.state, date: fs.date || null, reviewDate: fs.reviewDate || null, note: fs.note, reserveUntil: fs.reserveUntil || null };
    if (fs.state === 'sospensione') {
      if (!fs.keepSlots) { toast('Indica se mantenere o liberare gli appuntamenti futuri.', 'bad'); return; }
      f.keepSlots = fs.keepSlots === 'si';
    }
    const st = fresh();
    const pv = E.previewForecast(st, el.dataset.id, f);
    const apply = () => {
      const r = safe(() => E.setForecast(fresh(), el.dataset.id, f, { confirmRelease: true }));
      if (r) { ui.fcDraft = null; commit(r.state, 'Previsione salvata' + (r.released.length ? ': liberati ' + r.released.length + ' appuntamenti.' : '.')); offerCompatible(el.dataset.id); }
    };
    if (pv.release.length) {
      confirmBox('Liberare gli appuntamenti futuri?', '<p>Con la previsione <b>' + E.FORECAST[f.state] + '</b> verranno liberati questi appuntamenti (resteranno nello storico come annullati):</p><div class="chips">' + pv.release.map(s => tag('plain', dShort(s.date) + ' ' + s.start)).join('') + '</div>', 'Libera ' + pv.release.length + ' appuntamenti', apply, { danger: true });
    } else {
      const r = safe(() => E.setForecast(st, el.dataset.id, f));
      if (r) { ui.fcDraft = null; commit(r.state, 'Previsione salvata.'); offerCompatible(el.dataset.id); }
    }
  };
  /** Quando un posto si libera (o diventa probabile) propone i pazienti compatibili in lista. */
  function offerCompatible(pathId) {
    const ov = E.forecastOverview(state).find(r => r.path.id === pathId);
    if (!ov || !ov.slot.freeFrom || !['libero', 'probabile'].includes(ov.slot.code)) return;
    const p = ov.path;
    const n = E.compatibleWaitlist(state, { therapistId: p.therapistId, weekdays: p.weekdays, start: E.toMin(p.startTime), duration: p.duration, freeFrom: ov.slot.freeFrom }).length;
    if (n) openModal({ type: 'compatible', pathId });
  }
  ACT.renew = el => {
    let n = el.dataset.n === 'custom' ? Number(document.getElementById('renew-n').value) : Number(el.dataset.n);
    if (!(n >= 1 && n <= 60)) { toast('Numero di sedute non valido.', 'bad'); return; }
    openModal({ type: 'renew', pathId: el.dataset.id, n });
  };
  ACT['renew-confirm'] = el => {
    const extBox = document.getElementById('rn-ext');
    const r = safe(() => E.renewCycle(fresh(), el.dataset.id, Number(el.dataset.n), { acceptExtension: !!(extBox && extBox.checked) }));
    if (r) { closeModal(); ui.fcDraft = null; commit(r.state, 'Rinnovo confermato: nuovo ciclo collegato. La previsione è tornata "da valutare".'); }
  };
  ACT['renew-search'] = el => {
    const p = pathById(el.dataset.id);
    const pv = E.previewRenewal(state, p.id, Number(el.dataset.n));
    const s = defaultSearch();
    const k = p.weekdays.join(',');
    Object.assign(s, { name: ptName(p.id) + ' (rinnovo)', categoryId: p.categoryId, duration: p.duration, weekdays: p.weekdays.slice(), freq: k === '1,3,5' ? 'lmv' : k === '2,4' ? 'mg' : 'custom', sessionsMode: 'altro', sessionsCustom: Number(el.dataset.n), earliestDate: pv.dates[0] });
    ui.search = s; closeModal(); location.hash = '#/trova'; setTimeout(runSearch, 0);
  };
  ACT['show-compatible'] = el => openModal({ type: 'compatible', pathId: el.dataset.path });
  // --- assenze
  ACT['abs-impact'] = el => openModal({ type: 'absImpact', id: el.dataset.id });
  ACT['abs-return'] = el => {
    const a = state.absences.find(x => x.id === el.dataset.id);
    modalCallbacks.ok = () => {
      const v = document.getElementById('ret-date') ? document.getElementById('ret-date').value : '';
      if (!v || v < a.startDate) { toast('Data di rientro non valida.', 'bad'); return; }
      const st = E.clone(fresh()); const x = st.absences.find(y => y.id === a.id);
      x.endDate = E.addDays(v, -1) < x.startDate ? x.startDate : E.addDays(v, -1);
      E.addLog(st, 'Rientro comunicato: ' + thName(a.therapistId) + ' rientra il ' + E.fmtIt(v));
      commit(st, 'Rientro impostato.');
    };
    openModal({ type: 'confirm', title: 'Data di rientro di ' + esc(thName(a.therapistId)), html: '<div class="field"><label class="lbl">Rientra in servizio il</label><input type="date" id="ret-date" class="input" value="' + nextWorkingDay(today()) + '"></div><p class="small muted">L\'assenza sarà chiusa il giorno precedente.</p>', okLabel: 'Salva rientro' });
  };
  ACT['abs-delete'] = el => {
    const a = state.absences.find(x => x.id === el.dataset.id);
    confirmBox('Eliminare l\'assenza?', '<p>Eliminare ' + esc(a.type) + ' di <b>' + esc(thName(a.therapistId)) + '</b> dal ' + E.fmtIt(a.startDate) + '?</p>', 'Elimina', () => {
      const st = E.clone(fresh()); st.absences = st.absences.filter(x => x.id !== a.id); E.addLog(st, 'Eliminata assenza: ' + a.type + ' di ' + thName(a.therapistId) + ' dal ' + E.fmtIt(a.startDate)); commit(st, 'Assenza eliminata.');
    }, { danger: true });
  };
  // --- fisioterapisti
  ACT['th-agenda'] = el => { ui.agenda.mode = 'settimana'; ui.agenda.therapistId = el.dataset.id; go('#/agenda'); };
  ACT['th-new'] = () => {
    const st = E.clone(fresh());
    const id = E.uid('th');
    st.therapists.push({ id, name: 'Nuovo collega', profile: 'reparto7', competenze: [], idoneita: [], week: E.buildWeek('reparto7', st.settings), exceptions: [], maxPatientsDay: null, note: '' });
    E.addLog(st, 'Aggiunto un nuovo collega');
    state = st; Store.save(state); ui.thDraft = null; go('#/fisioterapisti/' + id);
  };
  ACT['th-cancel'] = () => { ui.thDraft = null; render(); };
  ACT['th-cat'] = el => {
    const t = ui.thDraft, c = el.dataset.cat;
    t.competenze = t.competenze.filter(x => x !== c); t.idoneita = t.idoneita.filter(x => x !== c);
    if (el.value === 'c') t.competenze.push(c);
    if (el.value === 'i') t.idoneita.push(c);
  };
  ACT['th-template'] = () => {
    const t = ui.thDraft;
    confirmBox('Applicare lo schema?', '<p>La settimana tipo di <b>' + esc(t.name) + '</b> sarà sostituita con lo schema "' + esc(E.PROFILES[t.profile]) + '". Le modifiche diventano definitive solo con "Salva scheda".</p>', 'Applica', () => { t.week = E.buildWeek(t.profile, state.settings); render(); });
  };
  ACT['th-copy-mon'] = () => { const t = ui.thDraft; for (let d = 2; d <= 5; d++) t.week[d] = t.week[1] ? E.clone(t.week[1]) : null; render(); };
  ACT['day-toggle'] = el => {
    const key = el.dataset.key;
    setPath(ui.thDraft, key, el.checked ? E.buildDay(ui.thDraft.profile, state.settings) : null);
    render();
  };
  ACT['blk-add'] = el => {
    const day = getPath(ui.thDraft, el.dataset.key);
    const last = day.blocks[day.blocks.length - 1];
    const s = last ? last.end : day.in;
    day.blocks.push({ type: 'amb', start: s, end: hm(Math.min(E.toMin(day.out), E.toMin(s) + 30)) });
    render();
  };
  ACT['blk-del'] = el => { const day = getPath(ui.thDraft, el.dataset.key); day.blocks.splice(Number(el.dataset.i), 1); render(); };
  ACT['ex-add'] = el => {
    const date = document.getElementById('ex-date').value;
    if (!date) { toast('Scegli la data dell\'eccezione.', 'bad'); return; }
    const t = ui.thDraft;
    t.exceptions = (t.exceptions || []).filter(x => x.date !== date);
    if (el.dataset.mode === 'off') t.exceptions.push({ date, off: true, note: '' });
    else { const base = t.week[E.weekday(date)] || E.buildDay(t.profile, state.settings); t.exceptions.push(Object.assign({ date, note: '' }, E.clone(base))); }
    t.exceptions.sort((a, b) => a.date < b.date ? -1 : 1);
    render();
  };
  ACT['ex-del'] = el => { ui.thDraft.exceptions.splice(Number(el.dataset.i), 1); render(); };
  ACT['th-save'] = () => {
    const t = ui.thDraft;
    if (!t.name.trim()) { toast('Il nome è obbligatorio.', 'bad'); return; }
    const errs = [];
    for (let d = 1; d <= 7; d++) E.validateDay(t.week[d]).forEach(e => errs.push(E.WEEKDAY_LONG[d] + ': ' + e));
    (t.exceptions || []).forEach(ex => { if (!ex.off) E.validateDay(ex).forEach(e => errs.push(E.fmtIt(ex.date) + ': ' + e)); });
    if (errs.length) { toast('Correggi prima: ' + errs.slice(0, 3).join(' '), 'bad'); return; }
    const st = E.clone(fresh());
    const i = st.therapists.findIndex(x => x.id === t.id);
    t.maxPatientsDay = t.maxPatientsDay ? Number(t.maxPatientsDay) : null;
    st.therapists[i] = E.clone(t);
    E.addLog(st, 'Scheda aggiornata: ' + t.name);
    const conf = E.conflicts(st).filter(c => c.session.therapistId === t.id).length;
    ui.thDraft = null;
    commit(st, 'Scheda salvata.' + (conf ? ' Attenzione: ' + conf + ' appuntamenti futuri ora in conflitto (vedi Ferie e malattie).' : ''));
  };
  // --- impostazioni
  ACT['set-tab'] = el => { ui.settingsTab = el.dataset.tab; render(); };
  ACT['warn45-profile'] = el => {
    const st = E.clone(fresh()); const p = st.settings.warn45.profiles;
    st.settings.warn45.profiles = el.checked ? [...new Set([...p, el.value])] : p.filter(x => x !== el.value);
    commit(st, 'Impostazione salvata.');
  };
  ACT['apply-template'] = el => {
    const prof = el.dataset.profile;
    const n = state.therapists.filter(t => t.profile === prof).length;
    confirmBox('Applicare lo schema al gruppo?', '<p>La settimana tipo di <b>' + n + ' colleghi</b> del gruppo sarà sostituita con lo schema aggiornato. Le eccezioni per data restano. Gli appuntamenti esistenti non vengono spostati: eventuali conflitti verranno segnalati.</p>', 'Applica', () => {
      const st = E.clone(fresh());
      st.therapists.forEach(t => { if (t.profile === prof) t.week = E.buildWeek(prof, st.settings); });
      E.addLog(st, 'Schema ' + E.PROFILES[prof] + ' applicato a ' + n + ' colleghi');
      const conf = E.conflicts(st).length;
      commit(st, 'Schema applicato.' + (conf ? ' Appuntamenti in conflitto: ' + conf + '.' : ''));
    });
  };
  ACT['cat-add'] = () => {
    const v = document.getElementById('cat-new').value.trim(); if (!v) return;
    const st = E.clone(fresh()); st.categories.push({ id: E.uid('cat'), name: v }); E.addLog(st, 'Aggiunta categoria: ' + v); commit(st, 'Categoria aggiunta.');
  };
  ACT['cat-del'] = el => { const st = E.clone(fresh()); const c = st.categories.find(x => x.id === el.dataset.id); st.categories = st.categories.filter(x => x.id !== el.dataset.id); st.therapists.forEach(t => { t.competenze = t.competenze.filter(x => x !== c.id); t.idoneita = t.idoneita.filter(x => x !== c.id); }); E.addLog(st, 'Eliminata categoria: ' + c.name); commit(st, 'Categoria eliminata.'); };
  ACT['cl-add'] = () => {
    const d = document.getElementById('cl-date').value, l = document.getElementById('cl-label').value.trim();
    if (!d || !l) { toast('Indica data e descrizione.', 'bad'); return; }
    const st = E.clone(fresh());
    if (st.closures.some(c => c.date === d)) { toast('Esiste già una chiusura in quella data.', 'bad'); return; }
    st.closures.push({ date: d, label: l, type: 'chiusura' });
    E.addLog(st, 'Aggiunta chiusura ' + E.fmtIt(d) + ': ' + l);
    const n = st.sessions.filter(s => s.date === d && E.OCCUPYING.has(s.status) && s.status !== 'effettuata').length;
    commit(st, 'Chiusura aggiunta.' + (n ? ' ' + n + ' appuntamenti in quella data sono ora in conflitto: gestiscili in Ferie e malattie.' : ''));
  };
  ACT['cl-del'] = el => { const st = E.clone(fresh()); const c = st.closures.find(x => x.date === el.dataset.date); st.closures = st.closures.filter(x => x.date !== el.dataset.date); E.addLog(st, 'Rimossa chiusura ' + E.fmtIt(c.date) + ': ' + c.label); commit(st, 'Chiusura rimossa.'); };
  ACT.export = () => { download('fisioagenda-dati-' + today() + '.json', JSON.stringify(state, null, 2)); toast('File esportato.', 'ok'); };
  ACT['reset-demo'] = () => {
    confirmBox('Ripristinare i dati di esempio?', '<p>Tutte le modifiche fatte <b>in questo browser</b> verranno <b>sostituite</b> con i dati di esempio iniziali. Le copie degli altri visitatori non cambiano.</p><p>Se vuoi conservare le tue prove, prima usa Impostazioni → Dati e salvataggio → Esporta.</p>', 'Sì, ripristina', () => {
      state = D.generateDemo(); Store.save(state); ui.results = null; ui.search = defaultSearch(); ui.thDraft = null; firstRun = true;
      toast('Dati di esempio ripristinati.', 'ok'); go('#/trova');
    }, { danger: true });
  };

  /* ================================================================== */
  /* Collegamento degli eventi                                            */
  /* ================================================================== */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (['freq', 'wd', 'ses', 'pref-on', 'ag-mode', 'wl-filter', 'path-state', 'wl-freq', 'wl-wd', 'th-cat', 'day-toggle', 'warn45-profile', 'import', 'sort', 'ag-group', 'ag-th', 'ag-date', 'wl-status', 'session-status', 'cat-rename', 'path-filter', 'wl-prio', 'wl-sort', 'path-prio', 'path-rt'].includes(act)) return; // gestiti su "change"
    if (act === 'close-modal-nav') { ACT[act](el, ev); return; }
    if (ACT[act]) { if (el.tagName === 'A' && el.getAttribute('href') === '#') ev.preventDefault(); if (el.tagName === 'BUTTON') ev.preventDefault(); ACT[act](el, ev); }
  });
  document.addEventListener('change', ev => {
    const el = ev.target;
    const act = el.dataset.act;
    if (act === 'ag-group') { ui.agenda.group = el.value; render(); return; }
    if (act === 'ag-th') { ui.agenda.therapistId = el.value; render(); return; }
    if (act === 'ag-date') { if (el.value) { ui.agenda.date = el.value; render(); } return; }
    if (act === 'cat-rename') { const v = el.value.trim(); if (!v) return; const st = E.clone(fresh()); const c = st.categories.find(x => x.id === el.dataset.id); E.addLog(st, 'Categoria rinominata: ' + c.name + ' → ' + v); c.name = v; commit(st, 'Categoria rinominata.'); return; }
    if (act === 'import') {
      const file = el.files && el.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let data;
        try { data = JSON.parse(reader.result); } catch (e) { toast('File non valido: non è un JSON leggibile.', 'bad'); return; }
        if (!data || !Array.isArray(data.therapists) || !Array.isArray(data.sessions) || !Array.isArray(data.paths)) { toast('File non riconosciuto come dati di FisioAgenda.', 'bad'); return; }
        confirmBox('Importare i dati?', '<p>Il file contiene ' + data.therapists.length + ' colleghi, ' + data.paths.length + ' percorsi e ' + data.sessions.length + ' sedute. I dati attuali di questo browser verranno sostituiti.</p>', 'Importa', () => {
          normalizeState(data); E.addLog(data, 'Dati importati da file (' + file.name + ')'); ui.results = null; ui.thDraft = null; commit(data, 'Dati importati.');
        }, { danger: true });
      };
      reader.readAsText(file);
      el.value = '';
      return;
    }
    if (el.dataset.setting) {
      const st = E.clone(fresh());
      let v = el.type === 'checkbox' ? el.checked : el.value;
      const key = el.dataset.setting;
      if (key === 'priorities') v = String(v).split(',').map(x => x.trim()).filter(Boolean);
      else if (el.type === 'number' || key === 'defaultDuration') { v = Number(v); if (!isFinite(v) || v < 0) { toast('Valore non valido.', 'bad'); return; } }
      if (key.startsWith('templates.') && key.endsWith('extEnd')) {
        const prof = key.split('.')[1];
        if (E.toMin(v) < E.toMin(st.settings.templates[prof].ambEnd)) { toast('La fine dell\'estensione non può precedere la fine dell\'ambulatorio.', 'bad'); render(); return; }
      }
      if (key.startsWith('templates.') && key.endsWith('ambEnd')) {
        const prof = key.split('.')[1];
        if (E.toMin(v) > E.toMin(st.settings.templates[prof].extEnd)) st.settings.templates[prof].extEnd = v;
      }
      setPath(st.settings, key, v);
      E.addLog(st, 'Impostazione modificata: ' + key + ' = ' + (Array.isArray(v) ? v.join(', ') : v));
      commit(st, key.startsWith('templates.') ? 'Salvato. Premi "Applica ai colleghi del gruppo" per aggiornare le schede.' : 'Impostazione salvata.');
      return;
    }
    if (act && ACT[act] && ['freq', 'wd', 'ses', 'pref-on', 'ag-mode', 'wl-filter', 'path-state', 'wl-freq', 'wl-wd', 'th-cat', 'day-toggle', 'warn45-profile', 'sort', 'wl-status', 'session-status', 'wl-prio', 'wl-sort', 'path-prio', 'path-rt'].includes(act)) { ACT[act](el, ev); return; }
    if (el.dataset.bind) { bindValue(el); if (el.dataset.rerender) { if (el.dataset.bind.startsWith('modal.')) renderModal(); else render(); } }
  });
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.dataset.act === 'path-filter') {
      ui.pathFilter = el.value;
      clearTimeout(ACT._pf); ACT._pf = setTimeout(() => { render(); const i = document.querySelector('[data-act="path-filter"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
      return;
    }
    if (el.dataset.bind && (el.tagName === 'INPUT' && el.type !== 'radio' && el.type !== 'checkbox' || el.tagName === 'TEXTAREA')) bindValue(el);
  });
  function bindValue(el) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'num') v = v === '' ? '' : Number(v);
    const path = el.dataset.bind;
    if (path.startsWith('modal.')) setPath(ui.modal, path.slice(6), v);
    else setPath(ui, path, v);
  }
  document.addEventListener('submit', ev => {
    const f = ev.target;
    ev.preventDefault();
    if (f.dataset.form === 'search') { ui.search.waitlistId = ui.search.waitlistId || null; runSearch(); }
    if (f.dataset.form === 'absence') saveAbsence();
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ui.modal) closeModal(); });

  function saveAbsence() {
    const f = ui.absForm;
    const a = { id: E.uid('ab'), therapistId: f.therapistId, type: f.type, note: f.note, allDay: f.mode !== 'ore' };
    if (f.mode === 'giorno' || f.mode === 'ore') { if (!f.date) { toast('Indica la data.', 'bad'); return; } a.startDate = f.date; a.endDate = f.date; }
    if (f.mode === 'ore') {
      if (E.toMin(f.endTime) <= E.toMin(f.startTime)) { toast('L\'orario di fine deve seguire quello di inizio.', 'bad'); return; }
      a.startTime = f.startTime; a.endTime = f.endTime;
    }
    if (f.mode === 'intervallo') {
      if (!f.startDate) { toast('Indica la data di inizio.', 'bad'); return; }
      a.startDate = f.startDate;
      if (f.returnKnown === 'si') {
        if (!f.endDate || f.endDate < f.startDate) { toast('Indica una data di fine valida (o scegli "rientro non conosciuto").', 'bad'); return; }
        a.endDate = f.endDate;
      } else a.endDate = null;
    }
    const st = E.clone(fresh());
    st.absences.push(a);
    const imp = E.impactedByAbsence(st, a).filter(s => s.date >= today());
    E.addLog(st, 'Registrata assenza: ' + a.type + ' di ' + thName(a.therapistId) + ' dal ' + E.fmtIt(a.startDate) + (a.endDate ? (a.endDate !== a.startDate ? ' al ' + E.fmtIt(a.endDate) : '') : ', rientro non noto') + (a.allDay ? '' : ' ' + a.startTime + '–' + a.endTime) + ' — appuntamenti coinvolti: ' + imp.length);
    state = st; Store.save(state);
    ui.absForm = null;
    render();
    openModal({ type: 'absImpact', id: a.id, justAdded: true });
  }

  render();
  if (upgradeNotes.length && !firstRun) {
    Store.save(state);
    toast('Dati salvati aggiornati alla nuova versione, senza perdite: ' + upgradeNotes.join('; ') + '.');
    upgradeNotes = [];
  }
  if (migratedAmb) {
    Store.save(state);
    toast('Aggiornati gli orari reali dei colleghi solo ambulatoriali. Gli appuntamenti demo creati con i vecchi orari possono risultare in conflitto: per dati coerenti usa Impostazioni → Dati e salvataggio → Ripristina i dati di esempio.');
  }
  window.FisioApp = { get state() { return state; }, ui, render, Store };
})();
