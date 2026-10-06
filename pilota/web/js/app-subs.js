/*
 * FisioAgenda pilota — Sostituzioni: chi sostituisce chi, quando e con quale paziente.
 * - "da assegnare": sedute di un fisioterapista assente (o lasciate da riprogrammare) senza sostituto
 * - "confermata": seduta affidata a un collega; il ciclo resta del titolare
 * Da qui si assegna, si cambia o si annulla una sostituzione; tutto compare subito nei calendari.
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc;

  function st() {
    if (!A.ui.sb) A.ui.sb = { from: A.today, to: E.addDays(A.today, 20), th: '', show: 'tutte', sel: {}, force: {} };
    return A.ui.sb;
  }
  const minutes = a => E.toMin(a.end_time) - E.toMin(a.start_time);
  /** elenco delle sostituzioni nel periodo: confermate e da assegnare */
  function collect(f) {
    const out = [];
    (A.data.appointments || []).forEach(a => {
      if (a.day < f.from || a.day > f.to) return;
      const cyc = A.ctx.cyc.get(a.cycle_id);
      if (!cyc) return;
      if (a.original_therapist_id && ['programmata', 'effettuata', 'trattenuta'].includes(a.status)) {
        out.push({ a, cyc, orig: a.original_therapist_id, sub: a.therapist_id, state: 'confermata' });
      } else if (a.status === 'da_riprogrammare') {
        out.push({ a, cyc, orig: a.therapist_id, sub: null, state: 'da_assegnare', why: a.reason || 'Da riprogrammare' });
      } else if (a.status === 'programmata') {
        const abs = E.absenceAt(A.ctx, a.therapist_id, a.day, E.toMin(a.start_time), E.toMin(a.end_time));
        if (abs) out.push({ a, cyc, orig: a.therapist_id, sub: null, state: 'da_assegnare', why: FA.thName(a.therapist_id) + ' assente (' + (E.ABSENCE_KIND[abs.kind] || abs.kind).toLowerCase() + ')', abs });
      }
    });
    return out.filter(x => !f.th || x.orig === f.th || x.sub === f.th)
      .filter(x => f.show === 'tutte' || x.state === f.show)
      .sort((x, y) => (x.a.day + x.a.start_time) < (y.a.day + y.a.start_time) ? -1 : 1);
  }
  function view() {
    const f = st();
    const all = collect(Object.assign({}, f, { show: 'tutte' }));
    const list = all.filter(x => f.show === 'tutte' || x.state === f.show);
    const nTodo = all.filter(x => x.state === 'da_assegnare').length, nOk = all.length - nTodo;
    const ths = FA.allTherapists();
    let h = '<div class="row between"><h2>Sostituzioni</h2>' + (FA.canEdit() ? '<button class="btn" data-act="abs-new">+ Registra un’assenza</button>' : '') + '</div>' +
      '<div class="panel"><div class="grid3">' +
      '<div class="field"><label>Dal</label><input type="date" data-bind="sb.from" data-rerender value="' + esc(f.from) + '"></div>' +
      '<div class="field"><label>Al</label><input type="date" data-bind="sb.to" data-rerender value="' + esc(f.to) + '" min="' + esc(f.from) + '"></div>' +
      '<div class="field"><label>Fisioterapista (assente o sostituto)</label><select data-bind="sb.th" data-rerender><option value="">Tutti</option>' + ths.map(t => FA.option(t.id, t.name, f.th)).join('') + '</select></div></div>' +
      FA.seg('sb.show', [['tutte', 'Tutte (' + all.length + ')'], ['da_assegnare', 'Da assegnare (' + nTodo + ')'], ['confermata', 'Confermate (' + nOk + ')']], f.show) +
      '<p class="small muted" style="margin:8px 0 0"><strong>Da assegnare</strong>: sedute di un collega assente senza sostituto. <strong>Confermata</strong>: la seduta è nel calendario del sostituto; il ciclo resta del titolare. ' +
      'Le sostituzioni compaiono anche nei calendari (bordo azzurro, «sostituisce …»).</p></div>';
    h += distribution(all);
    if (!list.length) return h + '<div class="panel muted">Nessuna sostituzione in questo periodo' + (f.th ? ' per ' + esc(FA.thName(f.th)) : '') + '.</div>';
    // raggruppate per titolare e giorno: si vede subito come sono distribuiti i suoi pazienti
    const groups = new Map();
    list.forEach(x => { const k = x.orig + '|' + x.a.day; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
    h += [...groups.entries()].map(([k, xs]) => {
      const [orig, day] = k.split('|');
      const abs = E.absenceOnDay(A.ctx, orig, day)[0];
      return '<div class="panel sb-group"><h3 style="margin:0 0 6px">' + esc(FA.dayLabel(day)) + ' · pazienti di ' + esc(FA.thName(orig)) +
        (abs ? ' <span class="chip warn">' + esc((E.ABSENCE_KIND[abs.kind] || abs.kind) + (abs.start_time ? ' ' + abs.start_time + '–' + abs.end_time : '')) + '</span>' : '') +
        (abs && FA.canEdit() ? ' <button class="btn small" data-act="sb-plan" data-id="' + abs.id + '">Proponi i sostituti in automatico</button>' : '') + '</h3>' +
        '<table class="table sb-table"><thead><tr><th>Orario</th><th>Paziente</th><th>Durata</th><th>Titolare</th><th>Sostituto</th><th>Stato</th><th></th></tr></thead><tbody>' +
        xs.map(row).join('') + '</tbody></table></div>';
    }).join('');
    return h;
  }
  /** riepilogo: per ogni titolare, quante sedute prende ciascun collega */
  function distribution(all) {
    const by = new Map();
    all.forEach(x => {
      if (!by.has(x.orig)) by.set(x.orig, new Map());
      const m = by.get(x.orig), k = x.sub || '';
      m.set(k, (m.get(k) || 0) + 1);
    });
    if (!by.size) return '';
    return '<div class="panel"><h3 style="margin:0 0 6px">Chi prende i pazienti</h3><ul class="list">' + [...by.entries()].map(([orig, m]) =>
      '<li class="todo-item"><div><strong>' + esc(FA.thName(orig)) + '</strong> → ' + [...m.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1] - a[1])
        .map(([sub, n]) => sub ? esc(FA.thName(sub)) + ': <strong>' + n + '</strong>' : '<span class="need-txt">da assegnare: ' + n + '</span>').join(' · ') + '</div></li>').join('') + '</ul></div>';
  }
  function row(x) {
    const f = st(), a = x.a;
    const canEdit = FA.canEdit() && (FA.canEditTh(a.therapist_id) || FA.canEditTh(x.orig));
    const sel = f.sel[a.id] != null ? f.sel[a.id] : (x.sub || '');
    const m = minutes(a);
    // colleghi abilitati al percorso, con l'esito del controllo sul posto
    const opts = FA.activeTherapists().filter(t => t.id !== x.orig && E.skillLevel(A.ctx, t.id, x.cyc.category_id)).map(t => {
      const chk = t.id === a.therapist_id ? null : E.checkSlot(A.ctx, t.id, a.day, a.start_time, a.end_time, { patientId: a.patient_id, ignoreId: a.id, cycleId: a.cycle_id });
      return { t, chk };
    }).sort((p, q) => (p.chk ? FA.isHardConflict(p.chk) ? 2 : 1 : 0) - (q.chk ? FA.isHardConflict(q.chk) ? 2 : 1 : 0));
    const cur = opts.find(o => o.t.id === sel);
    const changed = sel && sel !== (x.sub || '');
    const chk = changed && cur ? cur.chk : null;
    const hard = chk && FA.isHardConflict(chk);
    const select = canEdit && a.status !== 'effettuata' ? '<select data-bind="sb.sel.' + a.id + '" data-rerender aria-label="Sostituto">' +
      '<option value=""' + (sel ? '' : ' selected') + '>— ' + (x.sub ? 'scegli' : 'da assegnare') + ' —</option>' +
      opts.map(o => FA.option(o.t.id, o.t.name + (o.t.id === a.therapist_id ? ' (attuale)' : o.chk ? (FA.isHardConflict(o.chk) ? ' ✗ occupato' : ' ⚠ ' + shortWarn(o.chk)) : ' ✓ libero'), sel)).join('') + '</select>' :
      (x.sub ? '<strong>' + esc(FA.thName(x.sub)) + '</strong>' : '<span class="need-txt">—</span>');
    const actions = !canEdit ? '' :
      (changed ? '<button class="btn small primary" data-act="sb-assign" data-id="' + a.id + '"' + (hard || (chk && !f.force[a.id]) ? ' disabled' : FA.saveDisabled()) + '>' + (x.sub ? 'Cambia sostituto' : 'Assegna') + '</button>' : '') +
      (x.state === 'confermata' && a.status === 'programmata' ? '<button class="btn small" data-act="sb-cancel" data-id="' + a.id + '"' + FA.saveDisabled() + '>Annulla sostituzione</button>' : '') +
      '<button class="btn small link" data-act="open-appt" data-id="' + a.id + '" data-mode="sposta">Modifica orario / durata</button>';
    return '<tr class="' + (x.state === 'da_assegnare' ? 'sb-todo' : '') + '"><td>' + esc(a.start_time + '–' + a.end_time) + '</td>' +
      '<td><a href="#" data-act="open-appt" data-id="' + a.id + '">' + esc(FA.patName(a.patient_id)) + '</a>' + (x.cyc.treatment ? ' <span class="chip grey">' + esc(x.cyc.treatment) + '</span>' : '') + '</td>' +
      '<td>' + m + '′</td><td>' + esc(FA.thName(x.orig)) + '</td><td>' + select +
      (hard ? '<div class="small bad-txt">✗ ' + esc(chk.msg) + '</div>' : chk ? '<label class="inline-check small"><input type="checkbox" data-bind="sb.force.' + a.id + '" data-rerender' + (f.force[a.id] ? ' checked' : '') + '> ⚠ ' + esc(chk.msg) + ' Confermo</label>' : '') + '</td>' +
      '<td>' + (x.state === 'confermata' ? '<span class="chip ok">confermata</span>' : '<span class="chip warn" title="' + esc(x.why || '') + '">da assegnare</span>') + '</td>' +
      '<td class="row">' + actions + '</td></tr>';
  }
  const shortWarn = chk => ({ fuori_turno: 'fuori orario', blocco: 'fascia non ambulatoriale', assenza: 'assente', chiusura: 'chiuso', max_fascia: 'fascia piena', max_giorno: 'limite giornaliero', probabile: 'posto probabile', inattivo: 'non attivo' })[chk.code] || 'avviso';

  FA.actions['sb-assign'] = async el => {
    const f = st(), a = A.ctx.appt.get(el.getAttribute('data-id'));
    if (!a) return;
    const th = f.sel[a.id];
    try {
      await FA.save('Sostituzione: ' + FA.patName(a.patient_id) + ' con ' + FA.thName(th), () => FA.rpc('edit_appointment', { p_id: a.id, p_version: a.version, p: { therapist_id: th, force: !!f.force[a.id] } }));
      delete f.sel[a.id]; delete f.force[a.id]; FA.render();
    } catch (e) { FA.render(); }
  };
  FA.actions['sb-cancel'] = async el => {
    const a = A.ctx.appt.get(el.getAttribute('data-id'));
    if (!a || !confirm('Annullare la sostituzione? La seduta di ' + FA.patName(a.patient_id) + ' del ' + E.fmtItDay(a.day) + ' torna a ' + FA.thName(a.original_therapist_id) +
      ' (se è assente, resta «da assegnare»).')) return;
    try { await FA.save('Sostituzione annullata', () => FA.rpc('cancel_substitution', { p_id: a.id, p_version: a.version })); FA.render(); } catch (e) { FA.render(); }
  };
  FA.actions['sb-plan'] = el => FA.go('assenze', 'piano', el.getAttribute('data-id'));

  FA.views.sostituzioni = { render: view };
})();
