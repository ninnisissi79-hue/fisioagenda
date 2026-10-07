/*
 * FisioAgenda pilota — nucleo dell'interfaccia: accesso, sincronizzazione con
 * l'archivio centrale, aggiornamento in tempo reale, stato della connessione,
 * finestre, avvisi e schermata iniziale.
 */
(function () {
  'use strict';
  const E = window.FAE, S = window.FAStore;
  const FA = window.FA = { E, S, views: {}, actions: {} };
  const A = FA.state = {
    view: 'oggi', params: [], ui: {}, modal: null, data: null, ctx: null, issues: [], today: E.todayRome(),
    online: navigator.onLine, rt: 'connecting', lastSync: null, loadError: null, saving: null, me: null
  };

  /* ---------------- utilità ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FA.esc = esc;
  FA.roleLabel = r => ({ programmatore: 'Programmatore', admin: 'Coordinatore', operatore: 'Segreteria / operatore', fisioterapista: 'Fisioterapista', lettura: 'Sola consultazione' }[r] || '—');
  FA.canEdit = () => !!A.me && ['programmatore', 'admin', 'operatore', 'fisioterapista'].includes(A.me.role);
  FA.isFisio = () => !!A.me && A.me.role === 'fisioterapista';
  /** Può modificare il calendario di questo fisioterapista? (il fisioterapista solo il proprio; segreteria e coordinatore tutti) */
  FA.canEditTh = thId => FA.canEdit() && (!FA.isFisio() || !thId || thId === A.me.therapist_id);
  FA.ownOnly = () => FA.isFisio() ? '<p class="muted small">Puoi modificare solo il tuo calendario: per le agende dei colleghi serve l’autorizzazione del coordinatore (oppure rivolgiti alla segreteria).</p>' : '';
  /** sedute che restano nel ciclo, compresa questa (conto alla rovescia 10 → 1); 'R' per un recupero */
  FA.leftOf = a => {
    const n = E.sessionNumber(A.ctx, a), c = A.ctx.cyc.get(a.cycle_id);
    if (n === 'R') return 'R';
    if (!n || !c) return null;
    return c.planned_sessions + 1 - n;
  };
  /** numero sul tabulato: pieno se la seduta è effettuata, a contorno se è solo prevista */
  FA.countBadge = a => {
    const left = FA.leftOf(a), c = A.ctx.cyc.get(a.cycle_id);
    if (left == null) return '';
    if (left === 'R') return '<span class="cnt rec" title="Recupero">R</span>';
    const done = a.status === 'effettuata';
    return '<span class="cnt' + (done ? ' done' : '') + (left <= 0 ? ' over' : '') + '" title="' + (done ? 'Seduta effettuata' : 'Seduta prevista') + ': ' + (left === 1 ? 'ultima' : 'ne restano ' + left + ' compresa questa') + ' (' + (c.planned_sessions + 1 - left) + 'ª di ' + c.planned_sessions + ')">' + left + '</span>';
  };
  FA.isAdmin = () => !!A.me && (A.me.role === 'admin' || A.me.role === 'programmatore');
  FA.prio = p => '<span class="prio ' + esc(p) + '" title="' + esc(E.PRIORITY[p]) + '">' + esc(p === 'NI' ? '–' : p) + '</span>';
  FA.statusChip = a => {
    const cls = { programmata: 'blue', effettuata: 'ok', assente: 'warn', annullata: 'grey', da_riprogrammare: 'bad', trattenuta: 'info', liberata: 'grey', spostata: 'grey' }[a.status] || 'grey';
    let t = E.STATUS[a.status] || a.status;
    if (a.status === 'annullata' && a.cancel_by) t += ' (' + a.cancel_by + ')';
    if ((a.status === 'assente' || a.status === 'annullata') && a.to_recover) t += a.recovered_by ? ' · recupero programmato' : ' · da recuperare';
    return '<span class="chip ' + cls + '">' + esc(t) + '</span>';
  };
  FA.levelChip = l => l === 'specifica' ? '<span class="chip ok">★ competenza specifica</span>' : '<span class="chip grey">abilitato</span>';
  FA.thName = id => E.therapistName(A.ctx, id);
  FA.patName = id => E.patientName(A.ctx, id);
  FA.catName = id => E.categoryName(A.ctx, id);
  FA.dayLabel = d => E.WD_LONG[E.weekday(d)] + ' ' + E.fmtIt(d);
  FA.activeTherapists = () => [...A.ctx.th.values()].filter(t => t.active).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
  FA.allTherapists = () => [...A.ctx.th.values()].sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
  FA.categories = () => [...A.ctx.cat.values()].filter(c => c.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  FA.get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), A.ui);
  FA.set = (path, v) => {
    const ks = path.split('.'); let o = A.ui;
    ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    o[ks[ks.length - 1]] = v;
  };
  FA.disabledIfReadOnly = () => FA.canEdit() ? '' : ' disabled title="Il tuo profilo è di sola consultazione"';
  FA.saveDisabled = () => (!A.online || A.saving || !FA.canEdit()) ? ' disabled' : '';
  FA.option = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(label) + '</option>';

  /* ---------------- avvisi brevi ---------------- */
  FA.toast = function (msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    const root = document.getElementById('toast-root');
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3500);
  };

  /** avviso con «Annulla»: riporta le sedute com'erano, solo se nessuno le ha cambiate dopo */
  FA.undoToast = function (msg, ids) {
    const versions = ids.map(id => (A.ctx.appt.get(id) || {}).version);
    if (versions.some(v => v == null)) return;
    const el = document.createElement('div');
    el.className = 'toast ok undo';
    el.innerHTML = '<span>' + esc(msg) + '</span> <button class="btn small">Annulla</button>';
    el.querySelector('button').onclick = async () => {
      el.remove();
      try {
        await FA.save('Modifica annullata', () => FA.rpc('undo_appointment_change', { p_ids: ids, p_versions: versions }));
        if (A.modal) FA.closeModal();
      } catch (e) { /* già segnalato */ }
    };
    const root = document.getElementById('toast-root');
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    setTimeout(() => el.remove(), 12000);
  };

  /* ---------------- finestre ---------------- */
  FA.openModal = function (def) { A.modal = def; renderModal(); };
  FA.closeModal = function () {
    const wasDrawer = A.modal && A.modal.drawer;
    A.modal = null; renderModal();
    if (wasDrawer) { A.ui.pd = null; render(); }
  };
  // Se il browser genera eventi (change/blur) mentre la pagina viene ridisegnata, il nuovo disegno è rimandato.
  let painting = false;
  function guarded(fn) {
    return function (...args) {
      if (painting) { setTimeout(() => fn.apply(null, args), 0); return; }
      painting = true;
      try { fn.apply(null, args); } finally { painting = false; }
    };
  }
  /** campo attivo e posizione del cursore: dopo un nuovo disegno si scrive esattamente dove si era */
  function grabFocus(root) {
    const el = document.activeElement;
    if (!el || !root.contains(el) || !el.getAttribute('data-bind')) return null;
    let s = null, e = null; try { s = el.selectionStart; e = el.selectionEnd; } catch (x) { /* non è un campo di testo */ }
    return { bind: el.getAttribute('data-bind'), s, e, value: el.value };
  }
  function restoreFocus(root, f) {
    if (!f) return;
    const el = root.querySelector('[data-bind="' + f.bind + '"]');
    if (!el) return;
    // quanto si sta scrivendo vale più di quanto c'era nel disegno
    if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && f.value != null && el.value !== f.value) el.value = f.value;
    el.focus();
    try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (x) { /* non è un campo di testo */ }
  }
  // Un orario si scrive un carattere alla volta (1, 12, 12:, 12:2, 12:20): se la finestra venisse ridisegnata a metà
  // (per esempio per un aggiornamento arrivato da un collega) il campo verrebbe chiuso e «12» diventerebbe 12:00.
  // Finché si sta scrivendo un orario il nuovo disegno della finestra aspetta l'uscita dal campo.
  let modalPending = false;
  const typingTime = () => { const el = document.activeElement; return !!(el && el.hasAttribute && el.hasAttribute('data-time') && el.dataset.dirty === '1'); };
  document.addEventListener('input', ev => { if (ev.target.hasAttribute && ev.target.hasAttribute('data-time')) ev.target.dataset.dirty = '1'; }, true);
  document.addEventListener('focusout', () => { if (modalPending) setTimeout(() => { if (!typingTime() && modalPending) { modalPending = false; renderModal(); } }, 50); });
  const renderModal = guarded(function () {
    const root = document.getElementById('modal-root');
    if (typingTime() && root.contains(document.activeElement)) { modalPending = true; return; }
    modalPending = false;
    document.body.classList.toggle('has-drawer', !!(A.modal && A.modal.drawer));
    if (!A.modal) { root.innerHTML = ''; return; }
    const m = A.modal;
    const focused = grabFocus(root);
    const inner = '<div class="modal ' + (m.wide ? 'wide' : '') + (m.drawer ? ' drawer' : '') + '" role="dialog" aria-modal="' + (m.drawer ? 'false' : 'true') + '" aria-label="' + esc(m.title) + '">' +
      '<div class="modal-head"><h3>' + esc(m.title) + '</h3><button class="x" data-act="close-modal" aria-label="Chiudi">×</button></div>' +
      '<div class="modal-body">' + m.body() + '</div>' +
      (m.foot ? '<div class="modal-foot">' + m.foot() + '</div>' : '') + '</div>';
    // il pannello laterale lascia visibile e cliccabile il calendario
    root.innerHTML = m.drawer ? '<div class="drawer-wrap">' + inner + '</div>' : '<div class="modal-back" data-act="modal-back">' + inner + '</div>';
    restoreFocus(root, focused);
  });
  FA.renderModal = renderModal;

  /* ---------------- salvataggio sul server ---------------- */
  /**
   * Esegue un'operazione sul server. Nulla è mostrato come salvato finché il
   * server non conferma. In caso di conflitto i dati vengono ricaricati.
   */
  FA.save = async function (label, fn) {
    if (!A.online) {
      const e = new Error('Connessione assente: la modifica NON è stata salvata. Riprova quando torna la connessione.'); e.kind = 'FA_NET'; throw e;
    }
    if (!FA.canEdit()) { const e = new Error('Il tuo profilo è di sola consultazione.'); e.kind = 'FA_PERM'; throw e; }
    A.saving = label; render(); renderModal();
    try {
      const r = await fn();
      FA.toast('✓ ' + label + ': salvato nel sistema condiviso', 'ok');
      await refresh();
      return r;
    } catch (e) {
      const err = e && e.kind ? e : S.toError(e);
      if (err.kind === 'FA_CONFLICT' || err.kind === 'FA_SLOT') refresh();
      if (err.kind === 'FA_AUTH') setTimeout(() => FA.logout(true), 1500);
      FA.toast('✗ Non salvato: ' + err.message, 'bad');
      throw err;
    } finally {
      A.saving = null; render(); renderModal();
    }
  };
  FA.rpc = (name, args) => S.rpc(A.sb, name, args);
  FA.errBox = msg => msg ? '<div class="form-error" role="alert">✗ ' + esc(msg) + '</div>' : '';

  /* ---------------- dati e sincronizzazione ---------------- */
  let refreshTimer = null, inflight = null, queued = null;
  /** Ricarica i dati. Se un caricamento è già in corso, ne accoda uno nuovo: chi chiama riceve sempre dati letti dopo la chiamata. */
  function refresh() {
    if (!inflight) { inflight = load().finally(() => { inflight = null; }); return inflight; }
    if (!queued) queued = inflight.then(() => { queued = null; return refresh(); });
    return queued;
  }
  async function load() {
    if (!A.sb || !A.me) return;
    try {
      const who = await S.rpc(A.sb, 'whoami', {});
      if (!who.role) { A.me = Object.assign({}, A.me, { role: null }); render(); return; }
      A.me = who; A.today = who.today || E.todayRome();
      const data = E.normalize(await S.loadAll(A.sb, E.addDays(A.today, -120)));
      const issues = await S.rpc(A.sb, 'appointment_issues', { p_from: A.today, p_to: E.addDays(A.today, 120) });
      A.data = data; A.ctx = E.makeCtx(data, { today: A.today }); A.issues = issues || [];
      A.lastSync = new Date(); A.loadError = null;
    } catch (e) {
      A.loadError = e.kind ? e : S.toError(e);
    }
    render(true); if (A.modal && A.modal.live) renderModal();
  }
  FA.refresh = refresh;
  function scheduleRefresh(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, ms == null ? 700 : ms); }
  FA.scheduleRefresh = scheduleRefresh;

  let channel = null, pollTimer = null;
  function startSync() {
    if (channel) A.sb.removeChannel(channel);
    channel = A.sb.channel('fisioagenda-sync')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => { A.remoteChange = true; scheduleRefresh(900); })
      .subscribe(status => {
        A.rt = status === 'SUBSCRIBED' ? 'ok' : (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') ? 'bad' : 'connecting';
        if (status === 'SUBSCRIBED') scheduleRefresh(100);
        renderHeaderOnly();
      });
    clearInterval(pollTimer);
    // rete di sicurezza: se il tempo reale non è attivo i dati si aggiornano comunque
    pollTimer = setInterval(() => { if (A.rt !== 'ok' || Date.now() - (A.lastSync ? A.lastSync.getTime() : 0) > 300000) refresh(); }, 60000);
  }
  window.addEventListener('online', () => { A.online = true; render(); refresh(); });
  window.addEventListener('offline', () => { A.online = false; render(); renderModal(); });

  /* ---------------- accesso ---------------- */
  FA.logout = async function (expired) {
    try { if (channel) await A.sb.removeChannel(channel); await A.sb.auth.signOut(); } catch (e) { /* comunque disconnesso */ }
    channel = null; A.me = null; A.data = null; A.ctx = null; A.modal = null; renderModal();
    A.ui.login = { msg: expired ? 'Sessione scaduta: accedi di nuovo.' : 'Sei uscito.' };
    render();
  };

  function loginView() {
    const L = A.ui.login || (A.ui.login = {});
    const cfgOk = window.FA_CONFIG && window.FA_CONFIG.supabaseUrl && window.FA_CONFIG.supabaseKey;
    if (A.recovery) {
      return '<div class="login panel"><div class="brand"><div class="brand-logo">F</div><div><div class="brand-name">FisioAgenda</div><div class="muted small">Pilota condiviso</div></div></div>' +
        '<h3>Imposta la tua password</h3><p class="muted small">Scegli una password personale di almeno 10 caratteri. Non condividerla con i colleghi.</p>' +
        '<form data-submit="set-password"><div class="field"><label for="np1">Nuova password</label><input id="np1" type="password" autocomplete="new-password" data-bind="login.p1" required minlength="10"></div>' +
        '<div class="field"><label for="np2">Ripeti la password</label><input id="np2" type="password" autocomplete="new-password" data-bind="login.p2" required minlength="10"></div>' +
        FA.errBox(L.error) + '<button class="btn primary" type="submit"' + (L.busy ? ' disabled' : '') + '>Salva la password</button></form></div>';
    }
    return '<div class="login panel"><div class="brand"><div class="brand-logo">F</div><div><div class="brand-name">FisioAgenda</div><div class="muted small">Pilota condiviso · solo pazienti fittizi</div></div></div>' +
      (cfgOk ? '' : '<div class="form-error">Configurazione mancante: copia <code>config.example.js</code> in <code>config.js</code> e inserisci l’indirizzo e la chiave pubblica del progetto Supabase.</div>') +
      '<form data-submit="login"><div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" data-bind="login.email" value="' + esc(L.email || '') + '" required></div>' +
      '<div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" data-bind="login.password" required></div>' +
      FA.errBox(L.error) + (L.msg ? '<div class="form-note">' + esc(L.msg) + '</div>' : '') +
      '<div class="row between"><button class="btn primary" type="submit"' + (L.busy || !cfgOk ? ' disabled' : '') + '>' + (L.busy ? 'Accesso…' : 'Accedi') + '</button>' +
      '<button class="btn link" type="button" data-act="forgot">Password dimenticata?</button></div></form>' +
      '<p class="muted small" style="margin-top:14px">Accesso riservato: gli account personali sono creati dal coordinatore. Non esiste una registrazione libera.</p></div>';
  }
  FA.actions['forgot'] = async () => {
    const L = A.ui.login || {};
    if (!L.email) { L.error = 'Scrivi prima la tua email.'; render(); return; }
    const { error } = await A.sb.auth.resetPasswordForEmail(L.email, { redirectTo: location.origin + location.pathname });
    L.error = error ? 'Invio non riuscito: ' + error.message : null;
    L.msg = error ? null : 'Se l’indirizzo è abilitato riceverai un’email con il link. Se non arriva, chiedi al coordinatore di reimpostare la password.';
    render();
  };
  async function doLogin() {
    const L = A.ui.login;
    L.busy = true; L.error = null; L.msg = null; render();
    const { error } = await A.sb.auth.signInWithPassword({ email: (L.email || '').trim(), password: L.password || '' });
    L.busy = false; L.password = '';
    if (error) {
      L.error = /fetch|network/i.test(error.message) ? 'Server non raggiungibile: controlla la connessione.' :
        /invalid/i.test(error.message) ? 'Email o password non corrette.' : error.message;
      render(); return;
    }
    await afterLogin();
  }
  async function setPassword() {
    const L = A.ui.login;
    if ((L.p1 || '').length < 10) { L.error = 'La password deve avere almeno 10 caratteri.'; render(); return; }
    if (L.p1 !== L.p2) { L.error = 'Le due password non coincidono.'; render(); return; }
    L.busy = true; render();
    const { error } = await A.sb.auth.updateUser({ password: L.p1 });
    L.busy = false;
    if (error) { L.error = error.message; render(); return; }
    A.recovery = false; L.p1 = L.p2 = '';
    history.replaceState(null, '', location.pathname + '#/oggi');
    FA.toast('Password salvata', 'ok');
    await afterLogin();
  }
  async function afterLogin() {
    try { A.me = await S.rpc(A.sb, 'whoami', {}); } catch (e) { A.ui.login = { error: S.toError(e).message }; A.me = null; render(); return; }
    if (!A.me.role) { render(); return; }
    A.today = A.me.today || A.today;
    render();
    await refresh();
    startSync();
  }

  FA.actions['change-pw'] = () => {
    A.ui.pw = { p1: '', p2: '' };
    FA.openModal({ title: 'Cambia la tua password',
      body: () => '<p class="muted small">Al primo accesso sostituisci la password temporanea ricevuta dal coordinatore. Almeno 10 caratteri; non condividerla.</p>' +
        '<div class="field"><label>Nuova password</label><input type="password" autocomplete="new-password" data-bind="pw.p1"></div>' +
        '<div class="field"><label>Ripeti la password</label><input type="password" autocomplete="new-password" data-bind="pw.p2"></div>' + FA.errBox(A.ui.pw.error),
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="change-pw-save"' + (A.online ? '' : ' disabled') + '>Salva la password</button>' });
  };
  FA.actions['change-pw-save'] = async () => {
    const f = A.ui.pw;
    if ((f.p1 || '').length < 10) { f.error = 'La password deve avere almeno 10 caratteri.'; renderModal(); return; }
    if (f.p1 !== f.p2) { f.error = 'Le due password non coincidono.'; renderModal(); return; }
    const { error } = await A.sb.auth.updateUser({ password: f.p1 });
    if (error) { f.error = 'Password non salvata: ' + error.message; renderModal(); return; }
    FA.closeModal(); FA.toast('Password aggiornata', 'ok');
  };

  /* ---------------- attività da sistemare ---------------- */
  FA.todos = function () {
    if (!A.ctx) return [];
    const ctx = A.ctx;
    const out = [];
    const byAbs = new Map();
    A.issues.forEach(i => {
      const a = ctx.appt.get(i.appointment_id);
      if (!a) return;
      if (i.kind === 'conflitto' || i.kind === 'da_verificare') {
        const abs = E.absenceAt(ctx, a.therapist_id, a.day, E.toMin(a.start_time), E.toMin(a.end_time));
        if (abs) {
          const k = abs.id + '|' + i.kind;
          if (!byAbs.has(k)) byAbs.set(k, { abs, kind: i.kind, appts: [] });
          byAbs.get(k).appts.push(a);
          return;
        }
      }
      out.push({ kind: i.kind, appt: a, msg: i.message, sort: a.day + a.start_time });
    });
    byAbs.forEach(g => {
      const days = [...new Set(g.appts.map(a => a.day))].sort();
      if (g.kind === 'conflitto') {
        out.push({ kind: 'assenza', absence: g.abs, count: g.appts.length, sort: days[0] + '00',
          msg: FA.thName(g.abs.therapist_id) + ' assente: ' + g.appts.length + ' appuntament' + (g.appts.length === 1 ? 'o' : 'i') + ' da sistemare (' + days.map(E.fmtItDay).slice(0, 4).join(', ') + (days.length > 4 ? '…' : '') + ').' });
      } else {
        out.push({ kind: 'da_verificare', absence: g.abs, count: g.appts.length, sort: days[0] + '99',
          msg: 'Rientro di ' + FA.thName(g.abs.therapist_id) + ' non noto: ' + g.appts.length + ' appuntamenti dopo il ' + E.fmtIt(g.abs.plan_until) + ' da verificare.' });
      }
    });
    E.cycleTodos(ctx).forEach(t => out.push(Object.assign({ sort: (t.day || A.today) + '50' }, t)));
    const rank = { assenza: 0, conflitto: 1, da_riprogrammare: 2, esito_mancante: 3, recupero: 4, rivalutazione: 5, assenza_aperta: 6, esito_ciclo: 7, da_verificare: 8 };
    return out.sort((a, b) => (rank[a.kind] - rank[b.kind]) || (a.sort < b.sort ? -1 : 1));
  };
  FA.todoBadge = function () {
    const t = FA.todos();
    return t.reduce((n, x) => n + (x.count || 1), 0);
  };
  const TODO_LABEL = {
    assenza: ['bad', 'Assenza'], conflitto: ['bad', 'Incompatibile'], da_riprogrammare: ['bad', 'Da riprogrammare'],
    esito_mancante: ['warn', 'Esito mancante'], recupero: ['warn', 'Da recuperare'], rivalutazione: ['info', 'Rivalutazione'],
    assenza_aperta: ['warn', 'Rientro non noto'], esito_ciclo: ['info', 'Esito ciclo'], da_verificare: ['info', 'Da verificare']
  };
  FA.todoItem = function (t) {
    const [cls, lab] = TODO_LABEL[t.kind] || ['grey', t.kind];
    let msg = t.msg, act = '';
    if (t.appt) {
      const a = t.appt;
      msg = E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.patName(a.patient_id) + ' (' + FA.thName(a.therapist_id) + '): ' + t.msg;
      act = '<button class="btn small" data-act="open-appt" data-id="' + a.id + '">Apri</button>';
    } else if (t.kind === 'assenza') act = '<button class="btn small primary" data-act="abs-plan" data-id="' + t.absence.id + '">Organizza sostituti</button>';
    else if (t.kind === 'da_verificare' || t.kind === 'assenza_aperta') act = '<button class="btn small" data-act="abs-edit" data-id="' + (t.absence ? t.absence.id : t.absence_id) + '">Aggiorna assenza</button>';
    else if (t.cycle_id) act = '<button class="btn small" data-act="open-patient-cycle" data-id="' + t.cycle_id + '">Apri ciclo</button>';
    return '<li class="todo-item"><div><span class="chip ' + cls + '">' + esc(lab) + '</span> ' + esc(msg) + '</div><div>' + act + '</div></li>';
  };

  /* ---------------- struttura della pagina ---------------- */
  // il tabulato (calendario del fisioterapista) è il centro: subito dopo «Oggi»
  const NAV = [
    ['oggi', 'Oggi'], ['calendario', 'Tabulato'], ['trova', 'Trova posto'], ['assenze', 'Fisioterapista assente'], ['sostituzioni', 'Sostituzioni'], ['agenda', 'Agende del giorno'],
    ['pazienti', 'Pazienti'], ['attesa', 'Lista d’attesa'], ['dasistemare', 'Da sistemare'], ['importa', 'Importa (facoltativo)'], ['config', 'Configurazione'], ['storico', 'Storico']
  ];
  function connLabel() {
    if (!A.online) return '<span class="conn bad">Non connesso</span>';
    if (A.loadError) return '<span class="conn bad" title="' + esc(A.loadError.message) + '">Errore di aggiornamento</span>';
    const t = A.lastSync ? A.lastSync.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—';
    if (A.rt === 'ok') return '<span class="conn ok" title="Le modifiche dei colleghi compaiono automaticamente">Connesso · aggiornato alle ' + t + '</span>';
    return '<span class="conn warn" title="Aggiornamento automatico in tempo reale non attivo: i dati si aggiornano ogni minuto">Connesso · aggiornato alle ' + t + ' (ogni minuto)</span>';
  }
  function header() {
    const n = FA.todoBadge();
    return '<header class="top"><div class="top-inner">' +
      '<div class="brand"><div class="brand-logo">F</div><div><div class="brand-name">FisioAgenda</div><div class="brand-sub">Pilota condiviso</div></div></div>' +
      '<span id="conn">' + connLabel() + '</span>' +
      '<button class="todo-pill ' + (n ? '' : 'zero') + '" data-act="go" data-view="dasistemare">' + (n ? '⚠ Da sistemare: ' + n : '✓ Nulla da sistemare') + '</button>' +
      '<div class="user"><span class="who">' + esc(A.me.full_name || A.me.email) + '</span><span class="role">' + esc(FA.roleLabel(A.me.role)) + '</span>' +
      '<button data-act="refresh" title="Ricarica i dati dal server">↻</button><button data-act="change-pw">Password</button><button data-act="logout">Esci</button></div>' +
      '</div><nav class="nav">' + NAV.map(([k, l]) => '<a href="#/' + k + '" class="' + (A.view === k ? 'active' : '') + '">' + esc(l) + '</a>').join('') + '</nav></header>' +
      '<div class="pilot-banner">Versione pilota: <strong>solo pazienti fittizi</strong>, non inserire dati reali.' + (FA.canEdit() ? '' : ' Il tuo profilo è di <strong>sola consultazione</strong>.') +
        (A.me.edit_all_until && A.me.role === 'operatore' && A.me.base_role !== 'operatore' ? ' Sei <strong>autorizzato a gestire tutte le agende</strong> fino al ' + esc(E.fmtIt(A.me.edit_all_until)) + '.' : '') +
        (FA.isFisio() ? ' Puoi modificare <strong>il tuo tabulato</strong> e consultare quelli dei colleghi' + (A.me.therapist_id ? (A.ctx ? ' (' + esc(FA.thName(A.me.therapist_id)) + ')' : '') : ' — account non ancora collegato al tuo nome: chiedi al coordinatore') + '.' : '') + '</div>' +
      (A.online ? '' : '<div class="net-banner" role="alert">Connessione assente: puoi consultare i dati già caricati, ma nessuna modifica può essere salvata finché la connessione non torna.</div>') +
      (A.loadError && A.online ? '<div class="net-banner" role="alert">Aggiornamento dei dati non riuscito: ' + esc(A.loadError.message) + ' <button class="btn small" data-act="refresh">Riprova</button></div>' : '');
  }
  function renderHeaderOnly() { const el = document.getElementById('conn'); if (el) el.innerHTML = connLabel(); }

  function isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button';
  }
  let pending = false;
  const render = guarded(function (soft) {
    const root = document.getElementById('app');
    if (!A.sb) { root.innerHTML = '<main><div class="panel form-error">Impossibile avviare: libreria di collegamento non caricata.</div></main>'; return; }
    if (!A.me) { root.innerHTML = '<main>' + loginView() + '</main>'; return; }
    if (!A.me.role) {
      root.innerHTML = '<main><div class="login panel"><h3>Account non abilitato</h3><p>Il tuo account (' + esc(A.me.email || '') + ') non è attivo o non ha ancora un ruolo. Contatta il coordinatore.</p><button class="btn" data-act="logout">Esci</button></div></main>';
      return;
    }
    if (soft && isTyping() && root.contains(document.activeElement)) { pending = true; renderHeaderOnly(); return; }
    // mentre si trascina sul calendario i dati arrivati dagli altri si mostrano al rilascio
    if (soft && FA.gestureActive && FA.gestureActive()) { pending = true; renderHeaderOnly(); return; }
    pending = false;
    const view = FA.views[A.view] || FA.views.oggi;
    let body;
    if (!A.ctx) body = '<div class="panel">Caricamento dei dati dal sistema condiviso…</div>';
    else { try { body = view.render(A.params); } catch (e) { console.error(e); body = '<div class="panel form-error">Errore di visualizzazione: ' + esc(e.message) + '</div>'; } }
    const y = window.scrollY;
    const focused = grabFocus(root);
    root.innerHTML = header() + '<main>' + body + '</main>';
    if (soft) window.scrollTo(0, y);
    restoreFocus(root, focused);
  });
  FA.render = render;
  FA.flushPending = () => { if (pending) render(true); };
  document.addEventListener('focusout', () => { if (pending) setTimeout(() => { if (!isTyping()) render(true); }, 50); });

  /* ---------------- navigazione ---------------- */
  function route() {
    const parts = (location.hash || '#/oggi').replace(/^#\/?/, '').split('/');
    A.view = FA.views[parts[0]] ? parts[0] : 'oggi';
    A.params = parts.slice(1).map(decodeURIComponent);
    if (FA.views[A.view].enter) FA.views[A.view].enter(A.params);
    render();
    window.scrollTo(0, 0);
  }
  FA.go = (view, ...params) => { const h = '#/' + [view, ...params].map(encodeURIComponent).join('/'); if (location.hash === h) route(); else location.hash = h; };
  window.addEventListener('hashchange', route);

  /* ---------------- eventi ---------------- */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'modal-back') { if (ev.target === el && !(A.modal && A.modal.sticky)) FA.closeModal(); return; }
    if (el.disabled) return;
    const fn = FA.actions[act];
    if (!fn) return;
    ev.preventDefault();
    Promise.resolve(fn(el, ev)).catch(e => { console.error(e); });
  });
  // Clic che si perde: se si corregge un campo e si clicca subito un pulsante, l'uscita dal campo
  // ridisegna la pagina tra la pressione e il rilascio e il browser non genera il clic.
  // Lo si recupera cercando lo stesso pulsante nella pagina ridisegnata.
  let pressed = null;
  const sig = el => [...el.attributes].filter(a => /^data-/.test(a.name)).map(a => a.name + '=' + a.value).sort().join('|');
  document.addEventListener('pointerdown', ev => {
    const el = ev.target.closest && ev.target.closest('[data-act]');
    pressed = el && el.tagName === 'BUTTON' ? { el, sig: sig(el), act: el.getAttribute('data-act') } : null;
  }, true);
  document.addEventListener('pointerup', () => {
    const p = pressed; pressed = null;
    if (!p || p.el.isConnected) return;
    setTimeout(() => {
      const twin = [...document.querySelectorAll('button[data-act="' + CSS.escape(p.act) + '"]')].find(b => sig(b) === p.sig);
      if (twin && !twin.disabled) twin.click();
    }, 60);
  }, true);

  /** conflitto vero (sovrapposizione con un altro appuntamento): non si può confermare; gli altri controlli sono avvisi */
  FA.isHardConflict = chk => ['occupato', 'paziente', 'orario', 'inesistente'].includes(chk.code) || (chk.code === 'alternativa' && /^(Stesso posto|Il paziente)/.test(chk.msg));

  /** Orario scritto liberamente: 1220, 12.20, 12,20, 12 20, 12:20, 9 -> hh:mm. null se non valido. */
  FA.normTime = function (v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    let h, m;
    const p = v.match(/^(\d{1,2})\D+(\d{1,2})$/);
    if (p) { h = +p[1]; m = p[2].length === 1 ? +p[2] * 10 : +p[2]; }
    else if (/^\d{1,4}$/.test(v)) { if (v.length <= 2) { h = +v; m = 0; } else { h = +v.slice(0, v.length - 2); m = +v.slice(-2); } }
    else return null;
    if (h > 23 || m > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };
  function bindValue(el, final) {
    const path = el.getAttribute('data-bind');
    let v;
    if (el.hasAttribute('data-time')) {
      // mentre si scrive il campo non viene toccato; all'uscita l'orario viene normalizzato
      if (!final) { FA.set(path, el.value); return path; }
      el.dataset.dirty = '';
      const n = FA.normTime(el.value);
      el.classList.toggle('bad', n === null);
      if (n) el.value = n;
      FA.set(path, n === null ? el.value : n);
      return path;
    }
    if (el.type === 'checkbox') {
      if (el.hasAttribute('data-multi')) {
        const cur = new Set(FA.get(path) || []);
        const val = isNaN(Number(el.value)) ? el.value : Number(el.value);
        if (el.checked) cur.add(val); else cur.delete(val);
        v = [...cur].sort((a, b) => a - b);
      } else v = el.checked;
    } else if (el.hasAttribute('data-num')) v = el.value === '' ? null : Number(el.value);
    else v = el.value;
    FA.set(path, v);
    return path;
  }
  document.addEventListener('input', ev => {
    const el = ev.target.closest('[data-bind]');
    if (!el || el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio') return;
    bindValue(el);
  });
  document.addEventListener('change', ev => {
    const el = ev.target.closest('[data-bind]');
    if (!el) return;
    const path = bindValue(el, true);
    const hook = el.getAttribute('data-on');
    if (hook && FA.actions[hook]) FA.actions[hook](el, ev, path);
    if (el.hasAttribute('data-rerender')) { if (A.modal && document.getElementById('modal-root').contains(el)) renderModal(); else render(); }
  });
  // caselle di controllo con un'azione immediata al cambio (data-act-change="nome-azione")
  document.addEventListener('change', ev => {
    const t = ev.target, k = t.getAttribute && t.getAttribute('data-act-change');
    if (k && FA.actions[k]) Promise.resolve(FA.actions[k](t, ev)).catch(e => console.error(e));
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest('[data-submit]');
    if (!f) return;
    ev.preventDefault();
    const k = f.getAttribute('data-submit');
    if (k === 'login') doLogin();
    else if (k === 'set-password') setPassword();
    else if (FA.actions[k]) FA.actions[k](f, ev);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && A.modal && !A.modal.sticky) FA.closeModal(); });

  FA.actions['cfg-open'] = el => { A.ui.cfgTab = el.getAttribute('data-t'); FA.go('config'); };
  FA.actions['go'] = el => FA.go(el.getAttribute('data-view'), ...(el.getAttribute('data-param') ? el.getAttribute('data-param').split('/') : []));
  FA.actions['close-modal'] = () => FA.closeModal();
  FA.actions['logout'] = () => FA.logout(false);
  FA.actions['refresh'] = () => { FA.toast('Aggiornamento dei dati…'); return refresh(); };
  FA.actions['seg'] = el => { FA.set(el.getAttribute('data-path'), el.getAttribute('data-val')); if (A.modal && document.getElementById('modal-root').contains(el)) renderModal(); else render(); };
  FA.seg = (path, options, cur) => '<div class="seg" role="group">' + options.map(([v, l]) =>
    '<button type="button" data-act="seg" data-path="' + path + '" data-val="' + esc(v) + '" class="' + (String(cur) === String(v) ? 'on' : '') + '" aria-pressed="' + (String(cur) === String(v)) + '">' + esc(l) + '</button>').join('') + '</div>';

  /* ---------------- schermata iniziale ---------------- */
  /** pazienti di oggi di un fisioterapista: orario, durata, conteggio a ritroso, azioni rapide */
  function myDay(thId) {
    const ctx = A.ctx, d = A.today;
    const list = (ctx.data.appointments || []).filter(a => a.therapist_id === thId && a.day === d && a.status !== 'spostata' && a.status !== 'liberata')
      .sort((a, b) => a.start_time < b.start_time ? -1 : 1);
    const can = FA.canEditTh(thId);
    const abs = E.absenceOnDay(ctx, thId, d);
    const done = list.filter(a => a.status === 'effettuata').length;
    return '<div class="panel today-list"><div class="row between"><h3 style="margin:0">I miei pazienti di oggi · ' + esc(FA.thName(thId)) + '</h3>' +
      '<div class="row"><button class="btn primary" data-act="go" data-view="calendario" data-param="' + thId + '/' + d + '/mese">Il mio tabulato</button>' +
      '<button class="btn" data-act="go" data-view="calendario" data-param="' + thId + '/' + d + '/giorno">Agenda di oggi</button></div></div>' +
      abs.map(x => '<div class="form-warn small">Assente oggi (' + esc(E.ABSENCE_KIND[x.kind]) + ')' + (x.start_time ? ' ' + x.start_time + '–' + x.end_time : '') + '</div>').join('') +
      (list.length ? '<p class="small muted" style="margin:6px 0">' + list.length + ' pazienti · ' + done + ' già registrati come effettuati. Il numero è il conto alla rovescia: le sedute che restano, compresa questa.</p><ul class="list">' + list.map(a => {
        const c = ctx.cyc.get(a.cycle_id), left = FA.leftOf(a);
        return '<li class="todo-item td-' + a.status + '"><div><strong>' + a.start_time + '–' + a.end_time + '</strong> <span class="muted small">(' + (E.toMin(a.end_time) - E.toMin(a.start_time)) + '′)</span> ' +
          '<a href="#" data-act="open-appt" data-id="' + a.id + '"><strong>' + esc(FA.patName(a.patient_id)) + '</strong></a> ' + FA.countBadge(a) +
          (c && c.treatment ? ' <span class="chip grey">' + esc(c.treatment) + '</span>' : '') + (a.original_therapist_id ? ' <span class="chip info">sostituisce ' + esc(FA.thName(a.original_therapist_id)) + '</span>' : '') +
          ' ' + FA.statusChip(a) + (left != null && typeof left === 'number' ? '<div class="small muted">' + (left === 1 ? 'ultima seduta del ciclo' : 'restano ' + left + ' sedute, compresa questa') + '</div>' : '') + '</div>' +
          (can && a.status === 'programmata' ? '<div class="row"><button class="btn small ok" data-act="today-out" data-id="' + a.id + '" data-s="effettuata"' + FA.saveDisabled() + '>✓ Effettuata</button>' +
            '<button class="btn small" data-act="today-out" data-id="' + a.id + '" data-s="assente_rec"' + FA.saveDisabled() + '>Assente</button></div>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted">Nessun paziente in agenda oggi.</p>') + '</div>';
  }
  FA.myDay = myDay;
  FA.actions['today-out'] = async el => {
    const a = A.ctx.appt.get(el.getAttribute('data-id')), k = el.getAttribute('data-s');
    if (!a) return;
    try {
      await FA.save(k === 'effettuata' ? 'Seduta effettuata' : 'Assenza registrata (da recuperare)', () => FA.rpc('register_outcome', { p_id: a.id, p_version: a.version,
        p_status: k === 'effettuata' ? 'effettuata' : 'assente', p_cancel_by: null, p_to_recover: k === 'assente_rec', p_note: '' }));
      FA.undoToast(FA.patName(a.patient_id) + ': ' + (k === 'effettuata' ? 'effettuata' : 'assente'), [a.id]);
    } catch (e) { /* già segnalato */ }
  };
  /** agende di oggi di tutti: per la segreteria e il coordinatore */
  function allToday() {
    const ctx = A.ctx, d = A.today;
    const rows = FA.activeTherapists().map(t => {
      const list = (ctx.data.appointments || []).filter(a => a.therapist_id === t.id && a.day === d && E.OCCUPYING.has(a.status));
      const abs = E.absenceOnDay(ctx, t.id, d);
      const next = list.filter(a => a.status === 'programmata' && a.end_time >= (new Date().toTimeString().slice(0, 5))).sort((a, b) => a.start_time < b.start_time ? -1 : 1)[0];
      return '<tr><td><a href="#/calendario/' + t.id + '/' + d + '/giorno"><strong>' + esc(t.name) + '</strong></a></td><td>' + list.length + '</td>' +
        '<td>' + (abs.length ? '<span class="chip warn">' + esc(E.ABSENCE_KIND[abs[0].kind]) + '</span>' : next ? esc(next.start_time + ' ' + FA.patName(next.patient_id)) : '<span class="muted">—</span>') + '</td>' +
        '<td class="row"><button class="btn small" data-act="go" data-view="calendario" data-param="' + t.id + '/' + d + '/giorno">Giorno</button><button class="btn small" data-act="go" data-view="calendario" data-param="' + t.id + '/' + d + '/mese">Tabulato</button></td></tr>';
    }).join('');
    return '<div class="panel"><h3 style="margin:0 0 6px">Agende di oggi</h3><table class="table"><thead><tr><th>Fisioterapista</th><th>Pazienti</th><th>Prossimo</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  FA.views.oggi = {
    render() {
      const ctx = A.ctx, d = A.today;
      // il fisioterapista vede per prima cosa i propri pazienti di oggi
      const own = A.me.therapist_id && ctx.th.get(A.me.therapist_id) ? A.me.therapist_id : null;
      if (own && FA.isFisio()) return '<h2>Oggi, ' + esc(FA.dayLabel(d)) + '</h2>' + myDay(own) +
        '<div class="big-actions"><button class="big-action" data-act="go" data-view="calendario" data-param="' + own + '/' + d + '/mese"><span class="t">Il mio tabulato del mese</span><span class="d">Scrivi, sposta, registra le sedute; mesi precedenti e successivi.</span></button>' +
        '<button class="big-action" data-act="abs-new" data-th="' + own + '"><span class="t">Ferie, permesso o malattia</span><span class="d">I pazienti coinvolti compaiono da ricollocare in «Sostituzioni».</span></button></div>';
      const absent = [];
      FA.activeTherapists().forEach(t => E.absenceOnDay(ctx, t.id, d).forEach(a => absent.push({ t, a })));
      const todos = FA.todos();
      const toFix = A.issues.filter(i => (i.kind === 'conflitto' || i.kind === 'da_riprogrammare') && ctx.appt.get(i.appointment_id) && ctx.appt.get(i.appointment_id).day <= E.addDays(d, 1));
      const seats = E.freeSeats(ctx, d);
      const workday = E.weekday(d) <= 5 && !ctx.closures.has(d);
      const nTh = FA.activeTherapists().length;
      const noShift = FA.activeTherapists().filter(t => !(ctx.shifts.get(t.id) || []).length);
      let guide = '';
      if (!nTh || noShift.length) {
        const step = (n, done, txt, btn) => '<li class="todo-item"><div><span class="chip ' + (done ? 'ok' : 'warn') + '">' + (done ? '✓ fatto' : 'passo ' + n) + '</span> ' + txt + '</div><div>' + (done ? '' : btn) + '</div></li>';
        guide = '<div class="panel" style="border:2px solid var(--primary)"><h3>Primi passi</h3>' + (FA.isAdmin()
          ? '<ul class="list">' +
            step(1, nTh > 0, 'Inserisci i fisioterapisti con le loro competenze (★ specifica o abilitato per ogni percorso).', '<button class="btn small primary" data-act="cfg-open" data-t="fisio">Inserisci fisioterapisti</button>') +
            step(2, nTh > 0 && !noShift.length, 'Definisci il turno settimanale di ognuno (puoi partire da uno schema pronto).' + (noShift.length && nTh ? ' Mancano: ' + esc(noShift.map(t => t.name).join(', ')) + '.' : ''), '<button class="btn small primary" data-act="cfg-open" data-t="turni">Inserisci turni</button>') +
            step(3, false, 'Registra ferie e malattie già note da “Gestisci assenza fisioterapista”; poi inserisci i pazienti fittizi da “Trova posto” o cliccando un posto libero in agenda.', '') + '</ul>'
          : '<p>Il coordinatore deve ancora completare fisioterapisti e turni.</p>') + '</div>';
      }
      return '<h2>Oggi, ' + esc(FA.dayLabel(d)) + '</h2>' + guide + (own ? myDay(own) : '') +
        '<div class="big-actions">' +
        '<button class="big-action urgent" data-act="go" data-view="assenze"><span class="t">Gestisci assenza fisioterapista</span><span class="d">Registra l’assenza e trova subito i sostituti per i pazienti coinvolti.</span></button>' +
        '<button class="big-action" data-act="go" data-view="trova"><span class="t">Trova posto per un paziente</span><span class="d">Chi può prenderlo, in quali giorni, a che ora e da quando.</span></button></div>' +
        '<div class="cards">' +
        '<div class="card ' + (absent.length ? 'bad' : 'ok') + '"><div class="n">' + absent.length + '</div><div class="l">Assent' + (absent.length === 1 ? 'e' : 'i') + ' oggi</div>' +
        (absent.length ? '<ul>' + absent.map(x => '<li>' + esc(x.t.name) + ' — ' + esc(E.ABSENCE_KIND[x.a.kind]) + (x.a.start_time ? ', ' + x.a.start_time + '–' + x.a.end_time : ', giornata intera') + (x.a.end_date ? '' : ' · rientro non noto') + '</li>').join('') + '</ul>' : '<span class="muted small">Nessuna assenza registrata.</span>') + '</div>' +
        '<div class="card ' + (toFix.length ? 'bad' : 'ok') + '"><div class="n">' + toFix.length + '</div><div class="l">Appuntamenti da sistemare (oggi e domani)</div>' +
        '<button class="btn small" data-act="go" data-view="dasistemare">Vedi tutte le attività (' + FA.todoBadge() + ')</button></div>' +
        '<div class="card ' + (seats.total ? 'ok' : 'warn') + '"><div class="n">' + (workday ? seats.total : '—') + '</div><div class="l">Posti certi liberi oggi (da 30 min)</div>' +
        (workday ? (seats.per.length ? '<ul>' + seats.per.sort((a, b) => b.n - a.n).slice(0, 4).map(p => '<li>' + esc(FA.thName(p.therapist_id)) + ': ' + p.n + '</li>').join('') + '</ul>' : '<span class="muted small">Nessun posto libero.</span>') : '<span class="muted small">Giorno non lavorativo.</span>') +
        '<button class="btn small" data-act="go" data-view="agenda" style="margin-top:6px">Apri l’agenda</button></div>' +
        '</div>' +
        allToday() +
        '<div class="panel"><div class="row between"><h3>Attività ancora da sistemare</h3><button class="btn small" data-act="go" data-view="dasistemare">Elenco completo</button></div>' +
        (todos.length ? '<ul class="list">' + todos.slice(0, 8).map(FA.todoItem).join('') + '</ul>' + (todos.length > 8 ? '<p class="muted small">…e altre ' + (todos.length - 8) + '.</p>' : '') : '<p class="muted">Nulla da sistemare.</p>') + '</div>';
    }
  };
  FA.views.dasistemare = {
    render() {
      const todos = FA.todos();
      return '<h2>Da sistemare</h2><p class="muted">Le attività restano qui finché non sono risolte. L’elenco è ricalcolato dal server a ogni modifica.</p>' +
        '<div class="panel">' + (todos.length ? '<ul class="list">' + todos.map(FA.todoItem).join('') + '</ul>' : '<p>✓ Nulla da sistemare.</p>') + '</div>';
    }
  };

  /* ---------------- avvio ---------------- */
  FA.boot = async function () {
    const cfg = window.FA_CONFIG || {};
    if (!window.supabase || !window.supabase.createClient) { render(); return; }
    A.sb = window.supabase.createClient(cfg.supabaseUrl || 'http://configurazione-mancante.invalid', cfg.supabaseKey || 'x', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    if (/type=(invite|recovery)/.test(location.hash) || /type=(invite|recovery)/.test(location.search)) A.recovery = true;
    A.sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { A.recovery = true; render(); }
      if (event === 'SIGNED_OUT' && A.me) { A.me = null; render(); }
    });
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    if (FA.views[parts[0]]) { A.view = parts[0]; A.params = parts.slice(1).map(decodeURIComponent); }
    let session = null;
    try { session = (await A.sb.auth.getSession()).data.session; } catch (e) { session = null; }
    if (session && !A.recovery) await afterLogin();
    else render();
    if (!location.hash || A.recovery) { /* resta */ } else if (FA.views[A.view].enter) { FA.views[A.view].enter(A.params); render(); }
  };
})();
