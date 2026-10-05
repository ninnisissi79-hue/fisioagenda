/*
 * FisioAgenda pilota — trova posto, agenda, appuntamento, pazienti e cicli, lista d'attesa.
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc;

  const eligibleTherapists = catId => FA.activeTherapists().map(t => ({ t, level: E.skillLevel(A.ctx, t.id, catId) }))
    .filter(x => x.level).sort((a, b) => (a.level === b.level ? 0 : a.level === 'specifica' ? -1 : 1) || a.t.name.localeCompare(b.t.name));
  const thOptions = (catId, cur) => {
    const l = eligibleTherapists(catId);
    const spec = l.filter(x => x.level === 'specifica'), ab = l.filter(x => x.level !== 'specifica');
    return (spec.length ? '<optgroup label="★ Competenza specifica">' + spec.map(x => FA.option(x.t.id, x.t.name, cur)).join('') + '</optgroup>' : '') +
      (ab.length ? '<optgroup label="Altri abilitati">' + ab.map(x => FA.option(x.t.id, x.t.name, cur)).join('') + '</optgroup>' : '');
  };
  const wdChecks = (path, cur) => '<div class="checks">' + [1, 2, 3, 4, 5, 6].map(d =>
    '<label><input type="checkbox" data-bind="' + path + '" data-multi value="' + d + '"' + ((cur || []).includes(d) ? ' checked' : '') + ' data-rerender> ' + E.WD_SHORT[d] + '</label>').join('') + '</div>';

  /* ======================= TROVA POSTO ======================= */
  function findState() {
    if (!A.ui.find) A.ui.find = { mode: 'nuovo', category_id: 'mano', priority: 'NI', request_type: 'prima', duration: 30, weekdays: [1, 3, 5], sessions: 10, from: A.today, pref: false };
    return A.ui.find;
  }
  function loadRequest(f, cycleId) {
    const c = A.ctx.cyc.get(cycleId);
    if (!c) return;
    Object.assign(f, { mode: 'attesa', cycle_id: c.id, category_id: c.category_id, priority: c.priority, request_type: c.request_type,
      duration: c.duration, sessions: c.planned_sessions, weekdays: c.weekdays && c.weekdays.length ? c.weekdays.slice() : [1, 3, 5], results: null, error: null, info: null });
  }
  FA.actions['find-pick-request'] = (el) => { const f = findState(); if (f.cycle_id) loadRequest(f, f.cycle_id); FA.render(); };

  function findView() {
    const f = findState();
    const waiting = (A.data.cycles || []).filter(c => c.status === 'in_attesa')
      .sort((a, b) => E.PRIORITY_ORDER.indexOf(a.priority) - E.PRIORITY_ORDER.indexOf(b.priority) || (a.created_at < b.created_at ? -1 : 1));
    let html = '<h2>Trova posto per un paziente</h2><div class="panel"><form data-submit="find-search">' +
      '<div class="field"><label>Paziente</label>' + FA.seg('find.mode', [['nuovo', 'Nuovo paziente'], ['attesa', 'Dalla lista d’attesa']], f.mode) + '</div>' +
      (f.mode === 'nuovo'
        ? '<div class="field" style="max-width:420px"><label for="f-name">Nome (fittizio)</label><input id="f-name" type="text" data-bind="find.patient_name" value="' + esc(f.patient_name || '') + '" placeholder="es. Rossi M."><div class="help">Solo pazienti fittizi in questa versione pilota.</div></div>'
        : '<div class="field"><label for="f-req">Richiesta in lista d’attesa</label><select id="f-req" data-bind="find.cycle_id" data-on="find-pick-request"><option value="">— scegli —</option>' +
          waiting.map(c => FA.option(c.id, '[' + c.priority + '] ' + FA.patName(c.patient_id) + ' · ' + FA.catName(c.category_id) + ' · ' + c.duration + ' min × ' + c.planned_sessions, f.cycle_id)).join('') + '</select></div>') +
      '<div class="grid3">' +
      '<div class="field"><label for="f-cat">Percorso</label><select id="f-cat" data-bind="find.category_id">' + FA.categories().map(c => FA.option(c.id, c.name, f.category_id)).join('') + '</select></div>' +
      '<div class="field"><label for="f-pr">Priorità</label><select id="f-pr" data-bind="find.priority">' + E.PRIORITY_ORDER.map(p => FA.option(p, E.PRIORITY[p], f.priority)).join('') + '</select></div>' +
      '<div class="field"><label for="f-rt">Tipo di richiesta</label><select id="f-rt" data-bind="find.request_type">' + Object.entries(E.REQUEST).map(([k, l]) => FA.option(k, l, f.request_type)).join('') + '</select></div>' +
      '</div>' +
      '<div class="grid3"><div class="field"><label>Durata della seduta</label>' + FA.seg('find.duration', E.DURATIONS.map(d => [d, d + ' min']), f.duration) + '</div>' +
      '<div class="field"><label>Sedute del ciclo</label>' + FA.seg('find.sessions', E.SESSION_PRESETS.map(n => [n, String(n)]), f.sessions) + '</div>' +
      '<div class="field"><label for="f-from">A partire dal</label><input id="f-from" type="date" data-bind="find.from" value="' + esc(f.from || A.today) + '" min="' + A.today + '"></div></div>' +
      '<div class="field"><label>Giorni della settimana</label>' + wdChecks('find.weekdays', f.weekdays) + '</div>' +
      '<div class="field"><label class="inline-check"><input type="checkbox" data-bind="find.pref" data-rerender' + (f.pref ? ' checked' : '') + '> Indica una fascia oraria preferita</label>' +
      (f.pref ? '<div class="grid3" style="max-width:640px"><div class="field"><label>Dalle</label><input type="time" data-bind="find.prefFrom" value="' + esc(f.prefFrom || '') + '"></div>' +
        '<div class="field"><label>Alle</label><input type="time" data-bind="find.prefTo" value="' + esc(f.prefTo || '') + '"></div>' +
        '<div class="field"><label>&nbsp;</label><label class="inline-check"><input type="checkbox" data-bind="find.prefStrict"' + (f.prefStrict ? ' checked' : '') + '> Obbligatoria</label></div></div>' : '') + '</div>' +
      FA.errBox(f.error) + (f.info ? '<div class="form-note">' + f.info + '</div>' : '') +
      '<div class="row"><button class="btn primary" type="submit">Cerca disponibilità</button>' +
      (f.mode === 'nuovo' ? '<button class="btn" type="button" data-act="find-waitlist"' + FA.saveDisabled() + '>Salva solo in lista d’attesa</button>' : '') + '</div></form></div>';
    if (f.results) html += resultsView(f);
    return html;
  }

  FA.actions['find-search'] = () => {
    const f = findState();
    f.error = null; f.info = null;
    if (!f.weekdays || !f.weekdays.length) { f.error = 'Scegli almeno un giorno della settimana.'; FA.render(); return; }
    if (f.mode === 'attesa' && !f.cycle_id) { f.error = 'Scegli la richiesta dalla lista d’attesa.'; FA.render(); return; }
    const c = f.cycle_id ? A.ctx.cyc.get(f.cycle_id) : null;
    f.results = E.searchCycle(A.ctx, { categoryId: f.category_id, duration: Number(f.duration), weekdays: f.weekdays, sessions: Number(f.sessions), from: f.from,
      prefFrom: f.pref ? f.prefFrom : null, prefTo: f.pref ? f.prefTo : null, prefStrict: f.pref && f.prefStrict, patientId: c ? c.patient_id : null, cycleId: c ? c.id : null, weeks: 16 });
    f.searchedAt = Date.now(); f.showAll = {};
    FA.render();
  };

  function resultsView(f) {
    const r = f.results;
    if (!r.length) return '<div class="panel"><h3>Nessun posto trovato</h3><p>Nessun fisioterapista abilitato ha lo stesso orario libero in tutte le date del ciclo nelle prossime 16 settimane. Prova altri giorni, un’altra durata o salva la richiesta in lista d’attesa.</p></div>';
    const soon = E.addDays(f.from || A.today, 7);
    const row = (o, i) => {
      const certain = o.status === 'certo';
      const deps = o.dependsOn.map(id => { const c = A.ctx.cyc.get(id); return c ? FA.patName(c.patient_id) : '?'; });
      return '<tr><td><strong>' + esc(FA.thName(o.therapist_id)) + '</strong><br>' + FA.levelChip(o.level) + '</td>' +
        '<td class="nowrap">' + o.start + '–' + o.end + (o.inPref ? '' : ' <span class="chip grey">fuori preferenza</span>') + '</td>' +
        '<td>' + esc(f.weekdays.map(d => E.WD_SHORT[d]).join('-')) + '<br><span class="small muted">dal ' + E.fmtIt(o.firstDate) + ' al ' + E.fmtIt(o.lastDate) + '</span></td>' +
        '<td>' + (certain ? '<span class="chip ok">✓ Certo' + (o.firstDate <= soon ? ' · disponibile subito' : ' · dal ' + E.fmtItDay(o.firstDate)) + '</span>'
          : '<span class="chip warn">? Probabile · non prenotabile</span><div class="small">Dipende dalla conclusione di: ' + esc(deps.join(', ')) + '</div>') + '</td>' +
        '<td class="nowrap">' + (certain ? '<button class="btn small primary" data-act="find-book" data-i="' + i + '"' + FA.saveDisabled() + '>Prenota…</button>' : '') + '</td></tr>';
    };
    const spec = r.map((o, i) => [o, i]).filter(([o]) => o.level === 'specifica');
    const ab = r.map((o, i) => [o, i]).filter(([o]) => o.level !== 'specifica');
    const LIM = 8;
    const tbl = (list, key) => {
      const all = f.showAll && f.showAll[key];
      const shown = all ? list : list.slice(0, LIM);
      return '<div class="table-wrap"><table><thead><tr><th>Fisioterapista</th><th>Orario</th><th>Giorni e date</th><th>Stato</th><th></th></tr></thead><tbody>' + shown.map(([o, i]) => row(o, i)).join('') + '</tbody></table></div>' +
        (list.length > LIM && !all ? '<button class="btn small" data-act="find-all" data-k="' + key + '">Mostra tutte (' + list.length + ')</button>' : '');
    };
    return '<div class="panel"><h3>★ Con competenza specifica</h3>' + (spec.length ? tbl(spec, 'spec') : '<p class="muted">Nessuna disponibilità.</p>') + '</div>' +
      '<div class="panel"><h3>Altri abilitati al percorso</h3>' + (ab.length ? tbl(ab, 'ab') : '<p class="muted">Nessuna disponibilità.</p>') + '</div>';
  }

  FA.actions['find-all'] = el => { const f = findState(); f.showAll = Object.assign({}, f.showAll, { [el.getAttribute('data-k')]: true }); FA.render(); };
  FA.actions['find-waitlist'] = async () => {
    const f = findState();
    if (!(f.patient_name || '').trim()) { f.error = 'Scrivi il nome (fittizio) del paziente.'; FA.render(); return; }
    try {
      const r = await FA.save('Richiesta in lista d’attesa', () => FA.rpc('create_request', { p: reqPayload(f) }));
      A.ui.find = null; FA.go('attesa'); void r;
    } catch (e) { f.error = e.message; FA.render(); }
  };
  function reqPayload(f) {
    return { patient_name: (f.patient_name || '').trim(), category_id: f.category_id, priority: f.priority, request_type: f.request_type,
      duration: Number(f.duration), planned_sessions: Number(f.sessions), weekdays: f.weekdays,
      preference: f.pref && f.prefFrom ? 'Preferenza ' + f.prefFrom + '–' + (f.prefTo || '') : '' };
  }
  FA.actions['find-book'] = el => {
    const f = findState();
    const o = f.results[Number(el.getAttribute('data-i'))];
    if (f.mode === 'nuovo' && !(f.patient_name || '').trim()) { f.error = 'Scrivi il nome (fittizio) del paziente prima di prenotare.'; FA.render(); window.scrollTo(0, 0); return; }
    A.ui.bookErr = null;
    FA.openModal({
      title: 'Conferma prenotazione', live: true,
      body() {
        const name = f.mode === 'nuovo' ? f.patient_name : FA.patName(A.ctx.cyc.get(f.cycle_id).patient_id);
        return '<p><strong>' + esc(name) + '</strong> · ' + esc(FA.catName(f.category_id)) + ' · ' + FA.prio(f.priority) + ' ' + esc(E.REQUEST[f.request_type]) + '</p>' +
          '<p>Con <strong>' + esc(FA.thName(o.therapist_id)) + '</strong> ' + FA.levelChip(o.level) + ', ore <strong>' + o.start + '–' + o.end + '</strong>, ' + o.dates.length + ' sedute:</p>' +
          '<div class="checks">' + o.dates.map(d => '<span class="chip blue">' + esc(E.fmtItDay(d)) + '</span>').join('') + '</div>' +
          '<p class="muted small" style="margin-top:10px">Le festività e le chiusure sono già saltate. La prenotazione risulta confermata solo dopo il salvataggio nel sistema condiviso.</p>' + FA.errBox(A.ui.bookErr);
      },
      foot() { return '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="find-book-confirm"' + FA.saveDisabled() + '>' + (A.saving ? 'Salvataggio…' : 'Conferma e salva') + '</button>'; },
      option: o
    });
  };
  FA.actions['find-book-confirm'] = async () => {
    const f = findState();
    const o = A.modal.option;
    try {
      let cycleId = f.cycle_id, version;
      if (f.mode === 'nuovo') {
        const r = await FA.save('Richiesta registrata', () => FA.rpc('create_request', { p: reqPayload(f) }));
        cycleId = r.cycle_id; version = 1;
        // da qui la richiesta esiste: in caso di errore resta in lista d'attesa
        f.mode = 'attesa'; f.cycle_id = cycleId;
      } else {
        const c = A.ctx.cyc.get(cycleId);
        version = c.version;
        if (c.priority !== f.priority || c.request_type !== f.request_type) {
          await FA.save('Dati della richiesta', () => FA.rpc('update_cycle_info', { p_cycle: cycleId, p_version: version, p: { priority: f.priority, request_type: f.request_type } }));
          version = A.ctx.cyc.get(cycleId).version;
        }
      }
      const c = A.ctx.cyc.get(cycleId);
      await FA.save('Prenotazione', () => FA.rpc('book_cycle', { p_cycle: cycleId, p_version: version, p_therapist: o.therapist_id, p_start: o.start, p_weekdays: f.weekdays, p_dates: o.dates }));
      FA.closeModal();
      A.ui.find = null;
      FA.go('paziente', c.patient_id);
    } catch (e) {
      A.ui.bookErr = e.message + (f.mode === 'attesa' && f.cycle_id ? ' La richiesta è comunque salvata in lista d’attesa: puoi riprovare.' : '');
      f.info = null;
      FA.actions['find-search']();
      FA.renderModal();
    }
  };

  FA.views.trova = {
    enter(params) { if (params[0] === 'richiesta' && params[1] && A.ctx) { const f = findState(); loadRequest(f, params[1]); } },
    render(params) { if (params[0] === 'richiesta' && params[1] && findState().cycle_id !== params[1]) loadRequest(findState(), params[1]); return findView(); }
  };

  /* ======================= AGENDA ======================= */
  function agState() { if (!A.ui.ag) A.ui.ag = { day: A.today, th: '' }; return A.ui.ag; }
  FA.actions['ag-shift'] = el => {
    const g = agState(); const n = Number(el.getAttribute('data-n'));
    if (n === 0) g.day = A.today; else { let d = E.addDays(g.day, n); while (E.weekday(d) >= 6) d = E.addDays(d, n > 0 ? 1 : -1); g.day = d; }
    FA.render();
  };
  function freeSlot(th, day, from, to, extra) {
    const can = FA.canEdit() && day >= A.today;
    return '<div class="slot free' + (can ? ' appt' : '') + '"' + (can ? ' data-act="ag-book" data-th="' + th + '" data-day="' + day + '" data-start="' + from + '" data-end="' + to + '" role="button" tabindex="0" title="Prenota un paziente in questo posto"' : '') +
      '><span class="t">' + from + '–' + to + '</span><span>libero' + extra + (can ? ' · <strong>+ prenota</strong>' : '') + '</span></div>';
  }
  function agendaView() {
    const g = agState(), ctx = A.ctx, d = g.day;
    const issues = new Map(A.issues.map(i => [i.appointment_id, i]));
    const list = FA.activeTherapists().filter(t => !g.th || t.id === g.th);
    let html = '<h2>Agenda</h2><div class="panel"><div class="row">' +
      '<button class="btn small" data-act="ag-shift" data-n="-1">◀</button><input type="date" style="max-width:180px" data-bind="ag.day" data-rerender value="' + d + '">' +
      '<button class="btn small" data-act="ag-shift" data-n="1">▶</button><button class="btn small" data-act="ag-shift" data-n="0">Oggi</button>' +
      '<strong>' + esc(FA.dayLabel(d)) + '</strong>' + (ctx.closures.has(d) ? ' <span class="chip grey">Chiuso: ' + esc(ctx.closures.get(d)) + '</span>' : '') +
      '<span class="grow"></span><select style="max-width:260px" data-bind="ag.th" data-rerender><option value="">Tutti i fisioterapisti</option>' +
      FA.activeTherapists().map(t => FA.option(t.id, t.name, g.th)).join('') + '</select></div></div><div class="agenda-grid">';
    list.forEach(t => {
      const blocks = E.dayBlocks(ctx, t.id, d);
      const appts = (ctx.data.appointments || []).filter(a => a.therapist_id === t.id && a.day === d && a.status !== 'spostata' && a.status !== 'liberata')
        .sort((a, b) => a.start_time < b.start_time ? -1 : 1);
      const abs = E.absenceOnDay(ctx, t.id, d);
      const items = [];
      blocks.forEach(b => {
        if (b.kind !== 'amb') { items.push({ s: b.start, html: '<div class="slot block"><span class="t">' + b.start + '–' + b.end + '</span><span>' + esc(E.BLOCK[b.kind]) + '</span></div>' }); return; }
        let cur = E.toMin(b.start);
        const inside = appts.filter(a => E.OCCUPYING.has(a.status) && E.toMin(a.start_time) >= E.toMin(b.start) && E.toMin(a.end_time) <= E.toMin(b.end));
        inside.forEach(a => {
          if (E.toMin(a.start_time) - cur >= 30) items.push({ s: E.fromMin(cur), html: freeSlot(t.id, d, E.fromMin(cur), a.start_time, '') });
          cur = Math.max(cur, E.toMin(a.end_time));
        });
        if (E.toMin(b.end) - cur >= 30) items.push({ s: E.fromMin(cur), html: freeSlot(t.id, d, E.fromMin(cur), b.end, b.max ? ' (max ' + b.max + ' paz.)' : '') });
      });
      appts.forEach(a => {
        const cyc = ctx.cyc.get(a.cycle_id);
        const iss = issues.get(a.id);
        items.push({ s: a.start_time, z: 1, html: '<div class="slot appt' + (iss && iss.kind !== 'esito_mancante' ? ' issue' : '') + '" data-act="open-appt" data-id="' + a.id + '" role="button" tabindex="0">' +
          '<span class="t">' + a.start_time + '–' + a.end_time + '</span><span><strong>' + esc(FA.patName(a.patient_id)) + '</strong> ' + FA.prio(cyc ? cyc.priority : 'NI') +
          ' <span class="small muted">' + esc(cyc ? FA.catName(cyc.category_id) : '') + '</span><br>' + FA.statusChip(a) +
          (a.original_therapist_id ? ' <span class="chip info">sostituisce ' + esc(FA.thName(a.original_therapist_id)) + '</span>' : '') +
          (a.recovery_of ? ' <span class="chip info">recupero</span>' : '') +
          (iss ? '<br><span class="small" style="color:var(--bad)">⚠ ' + esc(iss.message) + '</span>' : '') + '</span></div>' });
      });
      items.sort((a, b) => a.s < b.s ? -1 : a.s > b.s ? 1 : (a.z || 0) - (b.z || 0));
      html += '<div class="th-card"><h4><span>' + esc(t.name) + '</span><span class="small muted">' + (t.activity === 'ambulatorio' ? 'solo ambulatorio' : 'ambulatorio e reparto') + '</span></h4>' +
        abs.map(a => '<div class="absent">Assente (' + esc(E.ABSENCE_KIND[a.kind]) + ')' + (a.start_time ? ' ' + a.start_time + '–' + a.end_time : ' tutto il giorno') + (a.end_date ? '' : ' · rientro non noto') + '</div>').join('') +
        (items.length ? items.map(x => x.html).join('') : '<div class="slot muted">Non in servizio</div>') + '</div>';
    });
    return html + '</div>';
  }
  FA.views.agenda = { render: agendaView, enter(params) { if (params[0]) agState().day = params[0]; } };

  /* ---- prenotazione diretta in un posto scelto dall'agenda ---- */
  FA.actions['ag-book'] = el => {
    const th = el.getAttribute('data-th');
    const cats = FA.categories().filter(c => E.skillLevel(A.ctx, th, c.id));
    const day = el.getAttribute('data-day');
    A.ui.qb = { th, day, start: el.getAttribute('data-start'), mode: 'nuovo', name: '', cycle_id: '', category_id: (cats.find(c => c.id === 'mano') || cats[0] || {}).id,
      duration: 30, sessions: 10, weekdays: [E.weekday(day)], priority: 'NI', request_type: 'prima' };
    FA.openModal({ title: 'Prenota con ' + FA.thName(th), wide: true, live: true, body: qbBody,
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="qb-save"' + (A.ui.qb.okAll ? FA.saveDisabled() : ' disabled') + '>' + (A.saving ? 'Salvataggio…' : 'Conferma e salva') + '</button>' });
  };
  function qbBody() {
    const f = A.ui.qb, ctx = A.ctx;
    const cats = FA.categories().filter(c => E.skillLevel(ctx, f.th, c.id));
    const waiting = (A.data.cycles || []).filter(c => c.status === 'in_attesa' && E.skillLevel(ctx, f.th, c.category_id));
    if (f.mode === 'attesa' && f.cycle_id) {
      const c = ctx.cyc.get(f.cycle_id);
      if (c && f.loaded !== c.id) Object.assign(f, { loaded: c.id, category_id: c.category_id, duration: c.duration, sessions: c.planned_sessions, priority: c.priority, request_type: c.request_type });
    }
    const dur = Number(f.duration), n = Number(f.sessions);
    const cyc = f.mode === 'attesa' && f.cycle_id ? ctx.cyc.get(f.cycle_id) : null;
    const dates = f.weekdays.length ? E.cycleDates(ctx, f.day, f.weekdays, n) : [];
    const end = f.start ? E.fromMin(E.toMin(f.start) + dur) : '';
    const checks = f.start ? dates.map(d => ({ d, chk: E.checkSlot(ctx, f.th, d, f.start, end, { patientId: cyc ? cyc.patient_id : null, cycleId: cyc ? cyc.id : null }) })) : [];
    f.dates = dates;
    f.okAll = !!f.start && checks.length === n && checks.every(x => !x.chk) && (f.mode === 'nuovo' ? !!(f.name || '').trim() : !!f.cycle_id) && !!f.category_id;
    const bad = checks.filter(x => x.chk);
    return '<p>Primo appuntamento: <strong>' + esc(FA.dayLabel(f.day)) + '</strong> con <strong>' + esc(FA.thName(f.th)) + '</strong>. Stesso orario e stesso collega per tutte le sedute.</p>' +
      '<div class="field"><label>Paziente</label>' + FA.seg('qb.mode', [['nuovo', 'Nuovo paziente (fittizio)'], ['attesa', 'Dalla lista d’attesa']], f.mode) + '</div>' +
      (f.mode === 'nuovo' ? '<div class="field" style="max-width:420px"><label>Nome (fittizio)</label><input type="text" data-bind="qb.name" data-rerender value="' + esc(f.name) + '" placeholder="es. Bianchi L."></div>'
        : '<div class="field"><label>Richiesta</label><select data-bind="qb.cycle_id" data-rerender><option value="">— scegli —</option>' + waiting.map(c => FA.option(c.id, '[' + c.priority + '] ' + FA.patName(c.patient_id) + ' · ' + FA.catName(c.category_id) + ' · ' + c.duration + ' min × ' + c.planned_sessions, f.cycle_id)).join('') + '</select></div>') +
      '<div class="grid3"><div class="field"><label>Percorso (tra quelli di ' + esc(FA.thName(f.th)) + ')</label><select data-bind="qb.category_id" data-rerender' + (cyc ? ' disabled' : '') + '>' + cats.map(c => FA.option(c.id, c.name, f.category_id)).join('') + '</select></div>' +
      '<div class="field"><label>Priorità</label><select data-bind="qb.priority">' + E.PRIORITY_ORDER.map(p => FA.option(p, E.PRIORITY[p], f.priority)).join('') + '</select></div>' +
      '<div class="field"><label>Tipo di richiesta</label><select data-bind="qb.request_type">' + Object.entries(E.REQUEST).map(([k, l]) => FA.option(k, l, f.request_type)).join('') + '</select></div></div>' +
      '<div class="grid3"><div class="field"><label>Ora di inizio</label><input type="time" step="300" data-bind="qb.start" data-rerender value="' + esc(f.start) + '"></div>' +
      '<div class="field"><label>Durata</label>' + (cyc ? '<div>' + dur + ' min</div>' : FA.seg('qb.duration', E.DURATIONS.map(d => [d, d + ' min']), f.duration)) + '</div>' +
      '<div class="field"><label>Sedute</label>' + (cyc ? '<div>' + n + '</div>' : FA.seg('qb.sessions', E.SESSION_PRESETS.map(x => [x, String(x)]), f.sessions)) + '</div></div>' +
      '<div class="field"><label>Giorni della settimana</label>' + wdChecks('qb.weekdays', f.weekdays) + '</div>' +
      (checks.length ? (bad.length ? '<div class="form-error">✗ ' + bad.length + ' date non disponibili: cambia ora, giorni o durata.</div>' : '<div class="form-note">✓ Tutte le ' + n + ' sedute sono disponibili (festività saltate).</div>') +
        '<div class="checks">' + checks.map(x => '<span class="chip ' + (x.chk ? 'bad' : 'blue') + '" title="' + esc(x.chk ? x.chk.msg : '') + '">' + (x.chk ? '✗ ' : '') + esc(E.fmtItDay(x.d)) + '</span>').join('') + '</div>' +
        (bad.length ? '<ul class="small">' + bad.slice(0, 4).map(x => '<li>' + esc(E.fmtItDay(x.d) + ': ' + x.chk.msg) + '</li>').join('') + '</ul>' : '') : '') +
      FA.errBox(f.error);
  }
  FA.actions['qb-save'] = async () => {
    const f = A.ui.qb;
    try {
      let cycleId = f.cycle_id, version;
      if (f.mode === 'nuovo') {
        const r = await FA.save('Paziente e richiesta', () => FA.rpc('create_request', { p: { patient_name: f.name.trim(), category_id: f.category_id, priority: f.priority,
          request_type: f.request_type, duration: Number(f.duration), planned_sessions: Number(f.sessions), weekdays: f.weekdays } }));
        cycleId = r.cycle_id; version = 1; f.mode = 'attesa'; f.cycle_id = cycleId;
      } else version = A.ctx.cyc.get(cycleId).version;
      const c = A.ctx.cyc.get(cycleId);
      await FA.save('Prenotazione', () => FA.rpc('book_cycle', { p_cycle: cycleId, p_version: version, p_therapist: f.th, p_start: f.start, p_weekdays: f.weekdays, p_dates: f.dates }));
      FA.closeModal();
      FA.go('paziente', c.patient_id);
    } catch (e) {
      f.error = e.message + (f.cycle_id ? ' La richiesta è comunque salvata in lista d’attesa: puoi riprovare.' : '');
      FA.renderModal();
    }
  };

  /* ======================= APPUNTAMENTO ======================= */
  function pickBlock(am, a, cyc, title) {
    const p = am.pick;
    const dur = E.toMin(a.end_time) - E.toMin(a.start_time);
    const starts = p.day && p.th ? E.freeStarts(A.ctx, p.th, p.day, dur, { patientId: a.patient_id, ignoreId: am.mode === 'recupero' ? null : a.id, cycleId: a.cycle_id }) : [];
    if (p.start && !starts.includes(p.start)) p.start = '';
    return '<h4>' + esc(title) + '</h4><div class="grid3">' +
      '<div class="field"><label>Giorno</label><input type="date" min="' + A.today + '" data-bind="am.pick.day" data-rerender value="' + esc(p.day || '') + '"></div>' +
      '<div class="field"><label>Fisioterapista</label><select data-bind="am.pick.th" data-rerender>' + thOptions(cyc.category_id, p.th) + '</select></div>' +
      '<div class="field"><label>Ora (' + dur + ' min)</label><select data-bind="am.pick.start" data-rerender><option value="">' + (starts.length ? '— scegli —' : 'nessun posto libero') + '</option>' +
      starts.map(s => FA.option(s, s + (s === a.start_time ? ' (stesso orario)' : ''), p.start)).join('') + '</select></div></div>' +
      (p.day && E.weekday(p.day) >= 6 ? '<div class="form-warn">Giorno festivo o sabato: verifica il turno.</div>' : '') +
      '<div class="field"><label>Nota (facoltativa)</label><input type="text" data-bind="am.pick.note" value="' + esc(p.note || '') + '"></div>';
  }
  FA.actions['open-appt'] = el => {
    const id = el.getAttribute('data-id');
    if (!A.ctx.appt.get(id)) return;
    const a = A.ctx.appt.get(id);
    A.ui.am = { id, mode: a.status === 'da_riprogrammare' ? 'sposta' : null, out: {}, pick: { day: a.day < A.today ? A.today : a.day, th: a.therapist_id, start: a.start_time } };
    FA.openModal({ title: 'Appuntamento', live: true, body: apptBody, foot: apptFoot, wide: true });
  };
  function apptBody() {
    const am = A.ui.am, a = A.ctx.appt.get(am.id);
    if (!a) return '<p>L’appuntamento non esiste più (modificato da un collega).</p>';
    const cyc = A.ctx.cyc.get(a.cycle_id), cnt = E.cycleCounts(A.ctx, a.cycle_id);
    const iss = A.issues.filter(i => i.appointment_id === a.id);
    let h = '<div class="row between"><div><h3 style="margin:0">' + esc(FA.patName(a.patient_id)) + ' ' + FA.prio(cyc.priority) + '</h3>' +
      '<div class="muted">' + esc(FA.catName(cyc.category_id)) + ' · ciclo di ' + cyc.planned_sessions + ' sedute (' + cnt.effettuate + ' effettuate)</div></div>' +
      '<button class="btn small" data-act="open-patient" data-id="' + a.patient_id + '">Scheda paziente</button></div>' +
      '<p style="margin-top:10px"><strong>' + esc(FA.dayLabel(a.day)) + ', ' + a.start_time + '–' + a.end_time + '</strong> con <strong>' + esc(FA.thName(a.therapist_id)) + '</strong> ' + FA.statusChip(a) +
      (a.original_therapist_id ? ' <span class="chip info">sostituzione (' + (a.substitute_kind === 'periodo' ? 'periodo' : 'singola seduta') + ') di ' + esc(FA.thName(a.original_therapist_id)) + '</span>' : '') + '</p>' +
      (a.reason ? '<p class="small">Motivo: ' + esc(a.reason) + '</p>' : '') + (a.note ? '<p class="small">Nota: ' + esc(a.note) + '</p>' : '') +
      iss.map(i => '<div class="form-error">⚠ ' + esc(i.message) + '</div>').join('');
    if (!FA.canEdit()) return h + '<p class="muted">Profilo di sola consultazione.</p>';
    const canOutcome = ['programmata', 'effettuata', 'assente', 'annullata'].includes(a.status) && !a.recovered_by;
    const canMove = a.status === 'programmata' || a.status === 'da_riprogrammare';
    const canRecover = (a.status === 'assente' || a.status === 'annullata') && a.to_recover && !a.recovered_by && cyc.status === 'attivo';
    h += '<div class="row" style="margin:10px 0">' +
      (canOutcome ? '<button class="btn ' + (am.mode === 'esito' ? 'primary' : '') + '" data-act="am-mode" data-m="esito">' + (a.status === 'programmata' ? 'Registra esito / assenza' : 'Correggi esito') + '</button>' : '') +
      (canMove ? '<button class="btn ' + (am.mode === 'sposta' ? 'primary' : '') + '" data-act="am-mode" data-m="sposta">Sposta solo questa seduta</button>' : '') +
      (canRecover ? '<button class="btn ' + (am.mode === 'recupero' ? 'primary' : '') + '" data-act="am-mode" data-m="recupero">Programma il recupero</button>' : '') + '</div>';
    if (am.mode === 'esito') {
      const o = am.out;
      if (!o.status) { o.status = a.status === 'programmata' ? (a.day <= A.today ? 'effettuata' : 'assente') : a.status; o.cancel_by = a.cancel_by || 'paziente'; o.to_recover = a.to_recover; }
      const opts = [['effettuata', 'Effettuata'], ['assente', 'Assenza del paziente'], ['annullata', 'Annullata']];
      if (a.status !== 'programmata') opts.push(['programmata', 'Riporta a programmata']);
      h += '<div class="panel"><div class="field"><label>Esito</label>' + FA.seg('am.out.status', opts, o.status) + '</div>' +
        (o.status === 'effettuata' && a.day > A.today ? '<div class="form-warn">Una seduta futura non può essere registrata come effettuata.</div>' : '') +
        (o.status === 'annullata' ? '<div class="field"><label>Annullata da</label>' + FA.seg('am.out.cancel_by', [['paziente', 'Paziente'], ['servizio', 'Servizio']], o.cancel_by) + '</div>' : '') +
        (o.status === 'assente' || o.status === 'annullata' ? '<div class="field"><label class="inline-check"><input type="checkbox" data-bind="am.out.to_recover"' + (o.to_recover ? ' checked' : '') + '> La seduta deve essere recuperata</label>' +
          '<div class="help">Una seduta non effettuata non è conteggiata come trattamento svolto. Il recupero si programma subito dopo.</div></div>' : '') +
        '<div class="field"><label>Nota</label><input type="text" data-bind="am.out.note" value="' + esc(o.note || '') + '"></div></div>';
    }
    if (am.mode === 'sposta') h += '<div class="panel">' + pickBlock(am, a, cyc, 'Nuovo giorno, ora o fisioterapista') +
      '<p class="small muted">Cambia solo questa seduta: le altre sedute del ciclo restano invariate. Per modificare le sedute future usa la scheda del paziente.</p></div>';
    if (am.mode === 'recupero') h += '<div class="panel">' + pickBlock(am, a, cyc, 'Data e ora del recupero') + '</div>';
    return h + FA.errBox(am.error);
  }
  function apptFoot() {
    const am = A.ui.am;
    const btn = !am.mode ? '' : am.mode === 'esito' ? 'am-outcome' : am.mode === 'sposta' ? 'am-move' : 'am-recover';
    const label = { 'am-outcome': 'Salva esito', 'am-move': 'Sposta la seduta', 'am-recover': 'Prenota il recupero' }[btn];
    return '<button class="btn" data-act="close-modal">Chiudi</button>' + (btn ? '<button class="btn primary" data-act="' + btn + '"' + FA.saveDisabled() + '>' + (A.saving ? 'Salvataggio…' : label) + '</button>' : '');
  }
  FA.actions['am-mode'] = el => { A.ui.am.mode = el.getAttribute('data-m'); A.ui.am.error = null; FA.renderModal(); };
  FA.actions['open-patient'] = el => { FA.closeModal(); FA.go('paziente', el.getAttribute('data-id')); };
  FA.actions['am-outcome'] = async () => {
    const am = A.ui.am, a = A.ctx.appt.get(am.id), o = am.out;
    try {
      await FA.save('Esito della seduta', () => FA.rpc('register_outcome', { p_id: a.id, p_version: a.version, p_status: o.status, p_cancel_by: o.status === 'annullata' ? o.cancel_by : null,
        p_to_recover: !!o.to_recover, p_note: o.note || '' }));
      const b = A.ctx.appt.get(am.id);
      if (b && (b.status === 'assente' || b.status === 'annullata') && b.to_recover) { am.mode = 'recupero'; am.pick = { day: A.today, th: b.therapist_id, start: '' }; am.error = null; FA.renderModal(); }
      else FA.closeModal();
    } catch (e) { am.error = e.message; FA.renderModal(); }
  };
  FA.actions['am-move'] = async () => {
    const am = A.ui.am, a = A.ctx.appt.get(am.id), p = am.pick;
    if (!p.day || !p.th || !p.start) { am.error = 'Scegli giorno, fisioterapista e ora.'; FA.renderModal(); return; }
    try { await FA.save('Seduta spostata', () => FA.rpc('move_appointment', { p_id: a.id, p_version: a.version, p_therapist: p.th, p_day: p.day, p_start: p.start, p_note: p.note || '' })); FA.closeModal(); }
    catch (e) { am.error = e.message; FA.renderModal(); }
  };
  FA.actions['am-recover'] = async () => {
    const am = A.ui.am, a = A.ctx.appt.get(am.id), p = am.pick;
    if (!p.day || !p.th || !p.start) { am.error = 'Scegli giorno, fisioterapista e ora del recupero.'; FA.renderModal(); return; }
    try { await FA.save('Recupero programmato', () => FA.rpc('book_recovery', { p_orig: a.id, p_version: a.version, p_therapist: p.th, p_day: p.day, p_start: p.start })); FA.closeModal(); }
    catch (e) { am.error = e.message; FA.renderModal(); }
  };

  /* ======================= PAZIENTI ======================= */
  function patientsView() {
    const q = (A.ui.pq || '').toLowerCase().trim();
    const pats = (A.data.patients || []).filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    const cyclesBy = new Map();
    (A.data.cycles || []).forEach(c => { if (!cyclesBy.has(c.patient_id)) cyclesBy.set(c.patient_id, []); cyclesBy.get(c.patient_id).push(c); });
    return '<div class="row between"><h2>Pazienti e cicli</h2><div class="row"><a class="btn primary small" href="#/trova">+ Nuovo paziente (trova posto)</a><a class="btn small" href="#/agenda">Prenota da un posto libero in agenda</a></div></div><div class="panel"><div class="field" style="max-width:420px"><label for="pq">Cerca per nome</label><input id="pq" type="text" data-bind="pq" data-rerender value="' + esc(A.ui.pq || '') + '" placeholder="es. Rossi"></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Paziente</th><th>Cicli</th><th>Prossima seduta</th></tr></thead><tbody>' +
      pats.slice(0, 300).map(p => {
        const cs = cyclesBy.get(p.id) || [];
        const next = (A.data.appointments || []).filter(a => a.patient_id === p.id && a.status === 'programmata' && a.day >= A.today).sort((a, b) => (a.day + a.start_time) < (b.day + b.start_time) ? -1 : 1)[0];
        return '<tr class="clickable" data-act="go" data-view="paziente" data-param="' + p.id + '"><td><strong>' + esc(p.name) + '</strong></td><td>' +
          cs.map(c => '<span class="chip ' + ({ attivo: 'ok', sospeso: 'warn', chiuso: 'grey', in_attesa: 'blue' }[c.status]) + '">' + esc(FA.catName(c.category_id)) + ' · ' + esc(E.CYCLE_STATUS[c.status]) + '</span>').join(' ') + '</td>' +
          '<td>' + (next ? esc(E.fmtItDay(next.day) + ' ' + next.start_time + ' · ' + FA.thName(next.therapist_id)) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (pats.length > 300 ? '<p class="muted small">Mostrati i primi 300: affina la ricerca.</p>' : '') + '</div>';
  }
  FA.views.pazienti = { render: patientsView };

  function patientView(params) {
    const p = A.ctx.pat.get(params[0]);
    if (!p) return '<div class="panel">Paziente non trovato. <a href="#/pazienti">Torna all’elenco</a></div>';
    const cycles = (A.data.cycles || []).filter(c => c.patient_id === p.id).sort((a, b) => a.created_at < b.created_at ? 1 : -1);
    let h = '<div class="row between"><h2>' + esc(p.name) + '</h2><div class="row"><button class="btn small" data-act="pat-edit" data-id="' + p.id + '"' + FA.disabledIfReadOnly() + '>Modifica dati</button><a class="btn small" href="#/pazienti">← Pazienti</a></div></div>' +
      (p.note ? '<p class="muted">' + esc(p.note) + '</p>' : '');
    cycles.forEach(c => { h += cycleCard(c); });
    return h;
  }
  function cycleCard(c) {
    const ctx = A.ctx, cnt = E.cycleCounts(ctx, c.id);
    const appts = (ctx.byCycle.get(c.id) || []);
    const stChip = '<span class="chip ' + ({ attivo: 'ok', sospeso: 'warn', chiuso: 'grey', in_attesa: 'blue' }[c.status]) + '">' + esc(E.CYCLE_STATUS[c.status]) + '</span>';
    const ro = FA.disabledIfReadOnly();
    let h = '<div class="panel" id="cy-' + c.id + '"><div class="row between"><div><h3 style="margin:0">' + esc(FA.catName(c.category_id)) + ' ' + stChip + ' ' + FA.prio(c.priority) + '</h3>' +
      '<div class="muted small">' + esc(E.REQUEST[c.request_type]) + ' · ' + c.duration + ' min · ' + c.planned_sessions + ' sedute previste' +
      (c.therapist_id ? ' · titolare <strong>' + esc(FA.thName(c.therapist_id)) + '</strong>' : '') + (c.start_time ? ' · ' + esc((c.weekdays || []).map(d => E.WD_SHORT[d]).join('-')) + ' alle ' + c.start_time : '') + '</div>' +
      (c.status === 'sospeso' ? '<div class="form-warn" style="margin-top:6px">Sospeso dal ' + E.fmtIt(c.suspended_from) + ' · ' + esc(E.SUSPENSION[c.suspension_reason] || '') + (c.suspension_note ? ' (' + esc(c.suspension_note) + ')' : '') +
        ' · posti ' + (c.suspension_keep ? 'mantenuti, rivalutazione il ' + E.fmtIt(c.review_date) : 'liberati') + '</div>' : '') +
      (c.status === 'chiuso' ? '<div class="small" style="margin-top:6px">Chiuso dal ' + E.fmtIt(c.closed_at) + (c.closed_reason ? ' · ' + esc(c.closed_reason) : '') + '</div>' : '') +
      '</div><div class="row">' +
      (c.status === 'in_attesa' ? '<a class="btn small primary" href="#/trova/richiesta/' + c.id + '">Trova posto</a>' : '') +
      (c.status === 'attivo' ? '<button class="btn small" data-act="cy-resched" data-id="' + c.id + '"' + ro + '>Modifica sedute future…</button><button class="btn small" data-act="cy-suspend" data-id="' + c.id + '"' + ro + '>Sospendi…</button>' : '') +
      (c.status === 'sospeso' ? '<button class="btn small primary" data-act="cy-resume" data-id="' + c.id + '"' + ro + '>Riprendi…</button>' : '') +
      (c.status === 'attivo' || c.status === 'sospeso' ? '<button class="btn small danger" data-act="cy-close" data-id="' + c.id + '"' + ro + '>Chiudi anticipatamente…</button>' : '') +
      (c.status !== 'chiuso' ? '<button class="btn small" data-act="cy-info" data-id="' + c.id + '"' + ro + '>Priorità e dati…</button>' : '') +
      '</div></div>';
    if (c.status !== 'in_attesa') {
      h += '<div class="row" style="margin:10px 0">' +
        '<span class="chip ok">Effettuate: ' + cnt.effettuate + '</span><span class="chip blue">Programmate: ' + cnt.programmate + '</span>' +
        (cnt.trattenute ? '<span class="chip info">Posti mantenuti: ' + cnt.trattenute + '</span>' : '') +
        '<span class="chip warn">Assenze: ' + cnt.assenze + '</span><span class="chip grey">Annullate: ' + cnt.annullate + '</span>' +
        (cnt.recuperi ? '<span class="chip info">Recuperi: ' + cnt.recuperi + '</span>' : '') + (cnt.daRecuperare ? '<span class="chip warn">Da recuperare: ' + cnt.daRecuperare + '</span>' : '') +
        (cnt.daRiprogrammare ? '<span class="chip bad">Da riprogrammare: ' + cnt.daRiprogrammare + '</span>' : '') +
        (c.status === 'attivo' && cnt.mancanoDaProgrammare ? '<span class="chip bad">Mancano da programmare: ' + cnt.mancanoDaProgrammare + '</span>' : '') + '</div>';
      if (c.status === 'attivo') h += '<div class="row small"><label for="fc-' + c.id + '" style="margin:0">Previsione a fine ciclo:</label><select id="fc-' + c.id + '" style="max-width:280px;min-height:34px" data-bind="fc.' + c.id + '" data-on="cy-forecast" data-cycle="' + c.id + '"' + ro + '>' +
        Object.entries(E.FORECAST).map(([k, l]) => FA.option(k, l, c.forecast)).join('') + '</select><span class="muted">Finché la conclusione non è confermata, il posto dopo l’ultima seduta è solo probabile.</span></div>';
      h += '<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Data</th><th>Ora</th><th>Fisioterapista</th><th>Stato</th><th>Note</th></tr></thead><tbody>' +
        appts.map(a => '<tr class="clickable" data-act="open-appt" data-id="' + a.id + '"><td>' + esc(E.fmtItDay(a.day)) + '</td><td>' + a.start_time + '–' + a.end_time + '</td><td>' + esc(FA.thName(a.therapist_id)) +
          (a.original_therapist_id ? '<br><span class="small muted">sostituisce ' + esc(FA.thName(a.original_therapist_id)) + '</span>' : '') + '</td><td>' + FA.statusChip(a) + (a.recovery_of ? ' <span class="chip info">recupero</span>' : '') + '</td>' +
          '<td class="small">' + esc([a.reason, a.note].filter(Boolean).join(' · ')) + '</td></tr>').join('') + '</tbody></table></div>';
    } else h += '<p class="muted small">In lista d’attesa dal ' + E.fmtIt(String(c.created_at).slice(0, 10)) + (c.preference ? ' · ' + esc(c.preference) : '') + '</p>';
    return h + '</div>';
  }
  FA.views.paziente = { render: patientView };
  FA.actions['open-patient-cycle'] = el => { const c = A.ctx.cyc.get(el.getAttribute('data-id')); if (c) FA.go('paziente', c.patient_id); };

  FA.actions['pat-edit'] = el => {
    const p = A.ctx.pat.get(el.getAttribute('data-id'));
    A.ui.pe = { id: p.id, version: p.version, name: p.name, note: p.note };
    FA.openModal({ title: 'Dati del paziente (fittizio)',
      body: () => '<div class="field"><label>Nome</label><input type="text" data-bind="pe.name" value="' + esc(A.ui.pe.name) + '"></div><div class="field"><label>Nota</label><input type="text" data-bind="pe.note" value="' + esc(A.ui.pe.note) + '"></div>' + FA.errBox(A.ui.pe.error),
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="pat-save"' + FA.saveDisabled() + '>Salva</button>' });
  };
  FA.actions['pat-save'] = async () => {
    const f = A.ui.pe;
    try { await FA.save('Dati del paziente', () => FA.rpc('update_patient', { p_id: f.id, p_version: f.version, p_name: f.name, p_note: f.note })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['cy-forecast'] = async el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-cycle'));
    try { await FA.save('Previsione del ciclo', () => FA.rpc('update_cycle_info', { p_cycle: c.id, p_version: c.version, p: { forecast: el.value } })); }
    catch (e) { FA.render(); }
  };
  FA.actions['cy-info'] = el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-id'));
    A.ui.ci = { id: c.id, version: c.version, priority: c.priority, request_type: c.request_type, planned_sessions: c.planned_sessions, note: c.note, preference: c.preference,
      duration: c.duration, category_id: c.category_id, weekdays: (c.weekdays || []).slice(), waiting: c.status === 'in_attesa' };
    FA.openModal({ title: 'Dati del ciclo',
      body() {
        const f = A.ui.ci;
        return '<div class="grid2"><div class="field"><label>Priorità</label><select data-bind="ci.priority">' + E.PRIORITY_ORDER.map(p => FA.option(p, E.PRIORITY[p], f.priority)).join('') + '</select></div>' +
          '<div class="field"><label>Tipo di richiesta</label><select data-bind="ci.request_type">' + Object.entries(E.REQUEST).map(([k, l]) => FA.option(k, l, f.request_type)).join('') + '</select></div></div>' +
          '<div class="field"><label>Sedute previste</label>' + FA.seg('ci.planned_sessions', E.SESSION_PRESETS.map(n => [n, String(n)]), f.planned_sessions) + '</div>' +
          (f.waiting ? '<div class="grid2"><div class="field"><label>Percorso</label><select data-bind="ci.category_id">' + FA.categories().map(c => FA.option(c.id, c.name, f.category_id)).join('') + '</select></div>' +
            '<div class="field"><label>Durata</label>' + FA.seg('ci.duration', E.DURATIONS.map(d => [d, d + ' min']), f.duration) + '</div></div>' +
            '<div class="field"><label>Giorni preferiti</label>' + wdChecks('ci.weekdays', f.weekdays) + '</div>' : '') +
          '<div class="field"><label>Preferenze</label><input type="text" data-bind="ci.preference" value="' + esc(f.preference || '') + '"></div>' +
          '<div class="field"><label>Nota</label><input type="text" data-bind="ci.note" value="' + esc(f.note || '') + '"></div>' +
          '<p class="muted small">Priorità e tipo di richiesta non modificano gli appuntamenti già prenotati.</p>' + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="cy-info-save"' + FA.saveDisabled() + '>Salva</button>' });
  };
  FA.actions['cy-info-save'] = async () => {
    const f = A.ui.ci;
    const p = { priority: f.priority, request_type: f.request_type, planned_sessions: Number(f.planned_sessions), note: f.note || '', preference: f.preference || '' };
    if (f.waiting) Object.assign(p, { category_id: f.category_id, duration: Number(f.duration), weekdays: f.weekdays });
    try { await FA.save('Dati del ciclo', () => FA.rpc('update_cycle_info', { p_cycle: f.id, p_version: f.version, p })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---- sospensione ---- */
  FA.actions['cy-suspend'] = el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-id'));
    A.ui.cs = { id: c.id, reason: '', note: '', keep: '', review: '', from: A.today };
    FA.openModal({ title: 'Sospensione del ciclo di ' + FA.patName(c.patient_id), wide: true, live: true,
      body() {
        const f = A.ui.cs;
        const fut = (A.ctx.byCycle.get(c.id) || []).filter(a => a.status === 'programmata' && a.day >= (f.from || A.today));
        return '<div class="field"><label>Motivo della sospensione</label>' + FA.seg('cs.reason', Object.entries(E.SUSPENSION), f.reason) +
          '<div class="help">Il motivo è registrato dall’operatore: nessuna verifica automatica del ticket o dei pagamenti.</div></div>' +
          '<div class="grid2"><div class="field"><label>Nota' + (f.reason === 'altro' ? ' (obbligatoria)' : '') + '</label><input type="text" data-bind="cs.note" value="' + esc(f.note) + '"></div>' +
          '<div class="field"><label>Sospensione a partire dal</label><input type="date" min="' + A.today + '" data-bind="cs.from" data-rerender value="' + esc(f.from) + '"></div></div>' +
          '<div class="field"><label>Cosa fare dei ' + fut.length + ' appuntamenti futuri?</label>' + FA.seg('cs.keep', [['si', 'Mantieni i posti riservati'], ['no', 'Libera i posti']], f.keep) + '</div>' +
          (f.keep === 'si' ? '<div class="field" style="max-width:280px"><label>Data di rivalutazione (obbligatoria)</label><input type="date" min="' + A.today + '" data-bind="cs.review" data-rerender value="' + esc(f.review) + '"></div>' : '') +
          (f.keep ? '<div class="form-note"><strong>Effetto:</strong> ' + (f.keep === 'si'
            ? fut.length + ' appuntamenti restano riservati al paziente fino alla rivalutazione' + (f.review ? ' del ' + E.fmtIt(f.review) : '') + ' e non sono disponibili per altri.'
            : fut.length + ' appuntamenti vengono liberati e diventano disponibili per altri pazienti; restano nello storico.') +
            '<ul class="small">' + fut.map(a => '<li>' + esc(E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.thName(a.therapist_id)) + '</li>').join('') + '</ul></div>' : '') + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="cy-suspend-save"' + FA.saveDisabled() + '>Conferma la sospensione</button>' });
  };
  FA.actions['cy-suspend-save'] = async () => {
    const f = A.ui.cs, c = A.ctx.cyc.get(f.id);
    if (!f.reason) { f.error = 'Scegli il motivo.'; FA.renderModal(); return; }
    if (f.reason === 'altro' && !f.note.trim()) { f.error = 'Descrivi il motivo nella nota.'; FA.renderModal(); return; }
    if (!f.keep) { f.error = 'Scegli se mantenere o liberare i posti futuri.'; FA.renderModal(); return; }
    if (f.keep === 'si' && !f.review) { f.error = 'Indica la data di rivalutazione.'; FA.renderModal(); return; }
    try {
      await FA.save('Sospensione', () => FA.rpc('suspend_cycle', { p_cycle: c.id, p_version: c.version, p_reason: f.reason, p_note: f.note, p_keep: f.keep === 'si', p_review: f.keep === 'si' ? f.review : null, p_from: f.from }));
      FA.closeModal();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---- ripresa ---- */
  FA.actions['cy-resume'] = el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-id'));
    A.ui.cr = { id: c.id, from: A.today, plan: null };
    FA.openModal({ title: 'Ripresa del ciclo di ' + FA.patName(c.patient_id), wide: true,
      body() {
        const f = A.ui.cr;
        let h = '<div class="row"><div class="field" style="max-width:240px"><label>Riprendi dal</label><input type="date" min="' + A.today + '" data-bind="cr.from" value="' + esc(f.from) + '"></div>' +
          '<button class="btn" data-act="cy-resume-check"' + FA.saveDisabled() + '>Verifica le disponibilità</button></div>' +
          '<p class="muted small">Le disponibilità vengono ricontrollate sul server: gli appuntamenti che entrerebbero in conflitto non vengono ripristinati e restano “da riprogrammare”.</p>';
        if (f.plan) {
          h += '<div class="form-note"><strong>Effetto:</strong> ' + f.plan.restored + ' appuntamenti ripristinati, ' + f.plan.to_reschedule + ' da riprogrammare.</div><ul class="list">' +
            f.plan.plan.map(x => '<li>' + esc(E.fmtItDay(x.day) + ' ' + E.hhmm(x.start_time) + ' · ' + FA.thName(x.therapist_id)) + ' ' +
              (x.ok ? '<span class="chip ok">✓ ripristinato</span>' : '<span class="chip bad">✗ da riprogrammare</span> <span class="small">' + esc(x.message) + '</span>') + '</li>').join('') + '</ul>';
          if (!f.plan.plan.length) h += '<p>Nessun appuntamento da ripristinare: dopo la ripresa programma le sedute mancanti da “Trova posto” o dalle singole sedute.</p>';
        }
        return h + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="cy-resume-save"' + (A.ui.cr.plan ? FA.saveDisabled() : ' disabled') + '>Conferma la ripresa</button>' });
  };
  FA.actions['cy-resume-check'] = async () => {
    const f = A.ui.cr, c = A.ctx.cyc.get(f.id);
    f.error = null;
    try { f.plan = await FA.rpc('resume_cycle', { p_cycle: c.id, p_version: c.version, p_from: f.from, p_dry_run: true }); }
    catch (e) { f.error = e.message; f.plan = null; }
    FA.renderModal();
  };
  FA.actions['cy-resume-save'] = async () => {
    const f = A.ui.cr, c = A.ctx.cyc.get(f.id);
    try { await FA.save('Ripresa del ciclo', () => FA.rpc('resume_cycle', { p_cycle: c.id, p_version: c.version, p_from: f.from, p_dry_run: false })); FA.closeModal(); }
    catch (e) { f.error = e.message; f.plan = null; FA.renderModal(); }
  };

  /* ---- chiusura anticipata ---- */
  FA.actions['cy-close'] = el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-id'));
    A.ui.cc = { id: c.id, reason: '', other: '', from: A.today };
    FA.openModal({ title: 'Chiusura anticipata del ciclo di ' + FA.patName(c.patient_id), wide: true, live: true,
      body() {
        const f = A.ui.cc, cnt = E.cycleCounts(A.ctx, c.id);
        const fut = (A.ctx.byCycle.get(c.id) || []).filter(a => ['programmata', 'trattenuta', 'da_riprogrammare'].includes(a.status) && a.day >= (f.from || A.today));
        return '<div class="field"><label>Motivo</label>' + FA.seg('cc.reason', [['Obiettivi raggiunti', 'Obiettivi raggiunti'], ['Rinuncia del paziente', 'Rinuncia del paziente'], ['Motivo clinico', 'Motivo clinico'], ['altro', 'Altro']], f.reason) + '</div>' +
          (f.reason === 'altro' ? '<div class="field"><label>Descrivi il motivo</label><input type="text" data-bind="cc.other" value="' + esc(f.other) + '"></div>' : '') +
          '<div class="field" style="max-width:260px"><label>Chiudi dal</label><input type="date" min="' + A.today + '" data-bind="cc.from" data-rerender value="' + esc(f.from) + '"></div>' +
          '<div class="form-note"><strong>Sedute effettuate: ' + cnt.effettuate + ' su ' + cnt.previste + ' previste</strong> (numero reale, conservato). ' +
          fut.length + ' appuntamenti futuri saranno liberati e resteranno nello storico:<ul class="small">' +
          fut.map(a => '<li>' + esc(E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.thName(a.therapist_id)) + ' · ' + esc(E.STATUS[a.status]) + '</li>').join('') + '</ul></div>' + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn danger" data-act="cy-close-save"' + FA.saveDisabled() + '>Conferma la chiusura</button>' });
  };
  FA.actions['cy-close-save'] = async () => {
    const f = A.ui.cc, c = A.ctx.cyc.get(f.id);
    const reason = f.reason === 'altro' ? f.other.trim() : f.reason;
    if (!reason) { f.error = 'Indica il motivo della chiusura.'; FA.renderModal(); return; }
    try { await FA.save('Chiusura del ciclo', () => FA.rpc('close_cycle', { p_cycle: c.id, p_version: c.version, p_reason: reason, p_from: f.from })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---- modifica delle sedute future da una data (anche cambio stabile del fisioterapista) ---- */
  function openResched(c, opts) {
    opts = opts || {};
    A.ui.rs = { id: c.id, from: opts.from || A.today, th: opts.th || c.therapist_id, weekdays: (c.weekdays || []).slice(), start: c.start_time, stable: !!opts.stable };
    FA.openModal({ title: (opts.stable ? 'Cambio stabile del fisioterapista · ' : 'Modifica delle sedute future · ') + FA.patName(c.patient_id), wide: true, live: true, body: reschedBody,
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="rs-save"' + (A.ui.rs.okAll ? FA.saveDisabled() : ' disabled') + '>Conferma la modifica</button>' });
  }
  function reschedBody() {
    const f = A.ui.rs, c = A.ctx.cyc.get(f.id), ctx = A.ctx;
    const old = (ctx.byCycle.get(c.id) || []).filter(a => a.status === 'programmata' && a.day >= f.from && !a.recovery_of);
    const ign = new Set(old.map(a => a.id));
    let dates = [], times = [];
    if (old.length && f.weekdays.length) {
      dates = E.cycleDates(ctx, f.from, f.weekdays, old.length);
      const cand = new Set();
      f.weekdays.forEach(wd => { const d = dates.find(x => E.weekday(x) === wd); if (d) E.candidateStarts(ctx, f.th, d, c.duration).forEach(s => cand.add(s)); });
      times = [...cand].sort().filter(s => dates.every(d => !E.checkSlot(ctx, f.th, d, s, E.fromMin(E.toMin(s) + c.duration), { patientId: c.patient_id, ignoreIds: ign, cycleId: c.id })));
    }
    if (f.start && !times.includes(f.start)) f.start = times.includes(c.start_time) ? c.start_time : '';
    const checks = f.start ? dates.map(d => ({ d, chk: E.checkSlot(ctx, f.th, d, f.start, E.fromMin(E.toMin(f.start) + c.duration), { patientId: c.patient_id, ignoreIds: ign, cycleId: c.id }) })) : [];
    f.okAll = !!f.start && checks.length === old.length && checks.every(x => !x.chk) && old.length > 0;
    f.dates = dates;
    const changeTh = f.th !== c.therapist_id;
    return '<div class="grid3"><div class="field"><label>Dalla data</label><input type="date" min="' + A.today + '" data-bind="rs.from" data-rerender value="' + esc(f.from) + '"></div>' +
      '<div class="field"><label>Fisioterapista</label><select data-bind="rs.th" data-rerender>' + thOptions(c.category_id, f.th) + '</select></div>' +
      '<div class="field"><label>Ora (' + c.duration + ' min)</label><select data-bind="rs.start" data-rerender><option value="">' + (times.length ? '— scegli —' : 'nessun orario libero in tutte le date') + '</option>' +
      times.map(s => FA.option(s, s + (s === c.start_time ? ' (orario attuale)' : ''), f.start)).join('') + '</select></div></div>' +
      '<div class="field"><label>Giorni</label>' + wdChecks('rs.weekdays', f.weekdays) + '</div>' +
      (changeTh ? '<div class="form-warn"><strong>Cambio stabile del fisioterapista:</strong> da ' + esc(FA.thName(c.therapist_id)) + ' a ' + esc(FA.thName(f.th)) + ' per tutte le sedute dal ' + E.fmtIt(f.from) + '. Diverso da una sostituzione per un giorno.</div>' : '') +
      '<div class="form-note"><strong>Riepilogo:</strong> ' + old.length + ' sedute programmate dal ' + E.fmtIt(f.from) + ' saranno sostituite (le precedenti restano nello storico come “spostata”). Sedute effettuate e recuperi non cambiano. Nessun altro paziente viene spostato.</div>' +
      (checks.length ? '<div class="table-wrap"><table><thead><tr><th>Prima</th><th>Dopo</th><th>Verifica</th></tr></thead><tbody>' +
        checks.map((x, i) => '<tr><td>' + (old[i] ? esc(E.fmtItDay(old[i].day) + ' ' + old[i].start_time + ' · ' + FA.thName(old[i].therapist_id)) : '') + '</td><td>' + esc(E.fmtItDay(x.d) + ' ' + f.start + ' · ' + FA.thName(f.th)) + '</td><td>' +
          (x.chk ? '<span class="chip bad">✗ ' + esc(x.chk.msg) + '</span>' : '<span class="chip ok">✓</span>') + '</td></tr>').join('') + '</tbody></table></div>' : '') + FA.errBox(f.error);
  }
  FA.actions['cy-resched'] = el => openResched(A.ctx.cyc.get(el.getAttribute('data-id')));
  FA.actions['stable-change'] = el => {
    const a = A.ctx.appt.get(el.getAttribute('data-appt'));
    const c = A.ctx.cyc.get(a.cycle_id);
    const absId = A.params[1];
    const s = A.ui.plans && A.ui.plans[absId] && A.ui.plans[absId].sel[a.id];
    openResched(c, { from: a.day, th: s && s.action === 'sostituisci' ? s.therapist_id : c.therapist_id, stable: true });
  };
  FA.actions['rs-save'] = async () => {
    const f = A.ui.rs, c = A.ctx.cyc.get(f.id);
    try {
      await FA.save(f.th !== c.therapist_id ? 'Cambio stabile del fisioterapista' : 'Modifica delle sedute future',
        () => FA.rpc('reschedule_cycle', { p_cycle: c.id, p_version: c.version, p_from: f.from, p_therapist: f.th, p_start: f.start, p_weekdays: f.weekdays, p_dates: f.dates }));
      FA.closeModal();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ======================= LISTA D'ATTESA ======================= */
  function waitView() {
    const flt = A.ui.wf || (A.ui.wf = { cat: '', prio: '', sort: 'prio' });
    let list = (A.data.cycles || []).filter(c => c.status === 'in_attesa' && (!flt.cat || c.category_id === flt.cat) && (!flt.prio || c.priority === flt.prio));
    list.sort(flt.sort === 'prio' ? (a, b) => E.PRIORITY_ORDER.indexOf(a.priority) - E.PRIORITY_ORDER.indexOf(b.priority) || (a.created_at < b.created_at ? -1 : 1)
      : (a, b) => a.created_at < b.created_at ? -1 : 1);
    return '<h2>Lista d’attesa</h2><div class="panel"><div class="grid3">' +
      '<div class="field"><label>Percorso</label><select data-bind="wf.cat" data-rerender><option value="">Tutti</option>' + FA.categories().map(c => FA.option(c.id, c.name, flt.cat)).join('') + '</select></div>' +
      '<div class="field"><label>Priorità</label><select data-bind="wf.prio" data-rerender><option value="">Tutte</option>' + E.PRIORITY_ORDER.map(p => FA.option(p, E.PRIORITY[p], flt.prio)).join('') + '</select></div>' +
      '<div class="field"><label>Ordina per</label><select data-bind="wf.sort" data-rerender>' + FA.option('prio', 'Priorità, poi attesa', flt.sort) + FA.option('date', 'Data di inserimento', flt.sort) + '</select></div></div>' +
      '<p class="muted small">La priorità è scelta dall’operatore: evidenzia la priorità organizzativa, non verifica scadenze.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Pr.</th><th>Paziente</th><th>Percorso</th><th>Richiesta</th><th>Inserita</th><th></th></tr></thead><tbody>' +
      list.map(c => '<tr><td>' + FA.prio(c.priority) + '</td><td><a href="#/paziente/' + c.patient_id + '">' + esc(FA.patName(c.patient_id)) + '</a></td><td>' + esc(FA.catName(c.category_id)) + '</td>' +
        '<td class="small">' + esc(E.REQUEST[c.request_type]) + ' · ' + c.duration + ' min × ' + c.planned_sessions + (c.weekdays && c.weekdays.length ? ' · ' + c.weekdays.map(d => E.WD_SHORT[d]).join('-') : '') + (c.preference ? '<br>' + esc(c.preference) : '') + '</td>' +
        '<td class="small">' + E.fmtIt(String(c.created_at).slice(0, 10)) + '</td><td class="nowrap"><a class="btn small primary" href="#/trova/richiesta/' + c.id + '">Trova posto</a></td></tr>').join('') +
      '</tbody></table></div>' + (list.length ? '' : '<p class="muted">Nessuna richiesta.</p>') + '</div>';
  }
  FA.views.attesa = { render: waitView };
})();
