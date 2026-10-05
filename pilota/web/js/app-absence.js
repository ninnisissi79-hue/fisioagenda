/*
 * FisioAgenda pilota — assenza imprevista del fisioterapista:
 * registrazione in pochi passaggi e piano delle sostituzioni (modificabile,
 * confermato solo dopo il riepilogo e il salvataggio sul server).
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc;

  function absForm() {
    if (!A.ui.abs) A.ui.abs = { when: 'oggi', span: 'intera', kind: 'malattia', unknown: false };
    return A.ui.abs;
  }
  function absPeriod(a) {
    let s = a.end_date === a.start_date ? FA.dayLabel(a.start_date) :
      a.end_date ? 'dal ' + E.fmtIt(a.start_date) + ' al ' + E.fmtIt(a.end_date) : 'dal ' + E.fmtIt(a.start_date) + ' · rientro non noto';
    s += a.start_time ? ', ' + a.start_time + '–' + a.end_time : ', giornata intera';
    return s;
  }
  FA.absPeriod = absPeriod;

  /* ---------------- passo 1: registrazione ---------------- */
  function step1() {
    const f = absForm();
    const ro = !FA.canEdit();
    const th = FA.activeTherapists().filter(t => FA.canEditTh(t.id));
    if (FA.isFisio() && th.length === 1 && !f.therapist_id) f.therapist_id = th[0].id;
    const current = (A.data.absences || []).filter(a => !a.cancelled && (!a.end_date || a.end_date >= A.today))
      .sort((a, b) => a.start_date < b.start_date ? -1 : 1);
    return '<h2>Assenza di un fisioterapista</h2>' +
      '<div class="panel"><form data-submit="abs-save">' +
      '<div class="field"><label for="abs-th">1. Chi è assente?</label><select id="abs-th" data-bind="abs.therapist_id" required' + (ro ? ' disabled' : '') + '>' +
      '<option value="">— scegli il fisioterapista —</option>' + th.map(t => FA.option(t.id, t.name, f.therapist_id)).join('') + '</select></div>' +
      '<div class="field"><label>2. Quando?</label>' + FA.seg('abs.when', [['oggi', 'Oggi'], ['giorno', 'Un altro giorno'], ['periodo', 'Più giorni']], f.when) + '</div>' +
      (f.when === 'giorno' ? '<div class="field" style="max-width:260px"><label for="abs-day">Giorno</label><input id="abs-day" type="date" data-bind="abs.day" value="' + esc(f.day || '') + '" min="' + A.today + '" required></div>' : '') +
      (f.when === 'periodo' ? '<div class="grid2"><div class="field"><label for="abs-from">Dal</label><input id="abs-from" type="date" data-bind="abs.from" value="' + esc(f.from || '') + '" required></div>' +
        (f.unknown ? '' : '<div class="field"><label for="abs-to">Al (compreso)</label><input id="abs-to" type="date" data-bind="abs.to" value="' + esc(f.to || '') + '" required></div>') + '</div>' : '') +
      '<div class="field"><label class="inline-check"><input type="checkbox" data-bind="abs.unknown" data-rerender' + (f.unknown ? ' checked' : '') + '> Rientro non noto</label>' +
      (f.unknown ? '<div class="form-note" style="max-width:520px"><label for="abs-plan">Fino a quale data organizzo le sostituzioni?</label>' +
        '<input id="abs-plan" type="date" data-bind="abs.plan_until" value="' + esc(f.plan_until || '') + '" required>' +
        '<div class="help">Il rientro non viene presunto: le giornate successive restano segnalate “da verificare”.</div></div>' : '') + '</div>' +
      '<div class="field"><label>3. Tutta la giornata o una fascia oraria?</label>' + FA.seg('abs.span', [['intera', 'Giornata intera'], ['fascia', 'Fascia oraria']], f.span) + '</div>' +
      (f.span === 'fascia' ? '<div class="grid3" style="max-width:520px"><div class="field"><label for="abs-st">Dalle</label><input id="abs-st" type="time" data-bind="abs.start_time" value="' + esc(f.start_time || '') + '" required></div>' +
        '<div class="field"><label for="abs-et">Alle</label><input id="abs-et" type="time" data-bind="abs.end_time" value="' + esc(f.end_time || '') + '" required></div></div>' : '') +
      '<div class="grid2"><div class="field"><label for="abs-kind">Motivo</label><select id="abs-kind" data-bind="abs.kind">' +
      Object.entries(E.ABSENCE_KIND).map(([k, l]) => FA.option(k, l, f.kind)).join('') + '</select></div>' +
      '<div class="field"><label for="abs-note">Nota (facoltativa)</label><input id="abs-note" type="text" data-bind="abs.note" value="' + esc(f.note || '') + '"></div></div>' +
      FA.errBox(f.error) +
      '<button class="btn primary" type="submit"' + FA.saveDisabled() + '>' + (A.saving ? 'Salvataggio…' : 'Registra l’assenza e cerca i sostituti') + '</button>' +
      (ro ? '<p class="muted small">Il tuo profilo è di sola consultazione.</p>' : '') +
      '</form></div>' +
      '<div class="panel"><h3>Assenze in corso e programmate</h3>' + (current.length ? '<div class="table-wrap"><table><thead><tr><th>Fisioterapista</th><th>Periodo</th><th>Motivo</th><th>Da sistemare</th><th></th></tr></thead><tbody>' +
        current.map(a => {
          const n = E.affectedByAbsence(A.ctx, a).length;
          return '<tr><td>' + esc(FA.thName(a.therapist_id)) + '</td><td>' + esc(absPeriod(a)) + (a.end_date ? '' : '<br><span class="chip warn">organizzato fino al ' + E.fmtIt(a.plan_until) + '</span>') + '</td><td>' + esc(E.ABSENCE_KIND[a.kind]) + (a.note ? '<br><span class="muted small">' + esc(a.note) + '</span>' : '') + '</td>' +
            '<td>' + (n ? '<span class="chip bad">' + n + ' appuntament' + (n === 1 ? 'o' : 'i') + '</span>' : '<span class="chip ok">nessuno</span>') + '</td>' +
            '<td class="nowrap"><button class="btn small primary" data-act="abs-plan" data-id="' + a.id + '">Sostituti</button> <button class="btn small" data-act="abs-edit" data-id="' + a.id + '">Modifica</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">Nessuna assenza in corso.</p>') + '</div>';
  }

  FA.actions['abs-save'] = async () => {
    const f = absForm();
    f.error = null;
    const p = { therapist_id: f.therapist_id, kind: f.kind, note: f.note || '' };
    if (!f.therapist_id) { f.error = 'Scegli il fisioterapista assente.'; FA.render(); return; }
    if (f.when === 'oggi') { p.start_date = A.today; p.end_date = A.today; }
    else if (f.when === 'giorno') { if (!f.day) { f.error = 'Indica il giorno.'; FA.render(); return; } p.start_date = f.day; p.end_date = f.day; }
    else {
      if (!f.from || (!f.unknown && !f.to)) { f.error = 'Indica le date dell’assenza.'; FA.render(); return; }
      if (!f.unknown && f.to < f.from) { f.error = 'La data finale precede quella iniziale.'; FA.render(); return; }
      p.start_date = f.from; p.end_date = f.to;
    }
    if (f.unknown) {
      p.end_date = null;
      if (!f.plan_until) { f.error = 'Rientro non noto: indica fino a quale data organizzare le sostituzioni.'; FA.render(); return; }
      if (f.plan_until < p.start_date) { f.error = 'La data di organizzazione precede l’inizio dell’assenza.'; FA.render(); return; }
      p.plan_until = f.plan_until;
    }
    if (f.span === 'fascia') {
      if (!f.start_time || !f.end_time || f.end_time <= f.start_time) { f.error = 'Indica una fascia oraria valida.'; FA.render(); return; }
      p.start_time = f.start_time; p.end_time = f.end_time;
    }
    try {
      const abs = await FA.save('Assenza registrata', () => FA.rpc('save_absence', { p }));
      A.ui.abs = null;
      FA.go('assenze', 'piano', abs.id);
    } catch (e) { f.error = e.message; FA.render(); }
  };

  /* ---------------- nuova assenza da qualunque pagina (ferie, permessi, malattia) ---------------- */
  FA.openAbsenceNew = function (thId) {
    const own = FA.activeTherapists().filter(t => FA.canEditTh(t.id));
    A.ui.an = { therapist_id: thId || (own.length === 1 ? own[0].id : ''), kind: 'ferie', from: E.addDays(A.today, 1), to: '', unknown: false, plan_until: '',
      span: 'intera', start_time: '', end_time: '', note: '' };
    FA.openModal({ title: 'Registra ferie, permesso o malattia', wide: true, live: true,
      body() {
        const f = A.ui.an;
        return '<div class="grid2"><div class="field"><label>Fisioterapista</label><select data-bind="an.therapist_id"><option value="">— scegli —</option>' +
          own.map(t => FA.option(t.id, t.name, f.therapist_id)).join('') + '</select></div>' +
          '<div class="field"><label>Motivo</label>' + FA.seg('an.kind', Object.entries(E.ABSENCE_KIND), f.kind) + '</div></div>' +
          '<div class="grid3"><div class="field"><label>Dal</label><input type="date" data-bind="an.from" value="' + esc(f.from) + '"></div>' +
          (f.unknown ? '<div class="field"><label>Organizza le sostituzioni fino al</label><input type="date" data-bind="an.plan_until" value="' + esc(f.plan_until) + '"></div>'
            : '<div class="field"><label>Al (compreso; vuoto = un solo giorno)</label><input type="date" data-bind="an.to" value="' + esc(f.to) + '"></div>') +
          '<div class="field"><label>&nbsp;</label><label class="inline-check"><input type="checkbox" data-bind="an.unknown" data-rerender' + (f.unknown ? ' checked' : '') + '> Rientro non noto</label></div></div>' +
          '<div class="field">' + FA.seg('an.span', [['intera', 'Giornata intera'], ['fascia', 'Fascia oraria (es. permesso di qualche ora)']], f.span) + '</div>' +
          (f.span === 'fascia' ? '<div class="grid3" style="max-width:520px"><div class="field"><label>Dalle</label><input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="an.start_time" value="' + esc(f.start_time) + '"></div><div class="field"><label>Alle</label><input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="an.end_time" value="' + esc(f.end_time) + '"></div></div>' : '') +
          '<div class="field"><label>Nota (facoltativa)</label><input type="text" data-bind="an.note" value="' + esc(f.note) + '"></div>' +
          '<p class="small muted">Da quando è salvata, il collega non viene più proposto per pazienti o sostituzioni in quei giorni (o in quella fascia). Se ha già pazienti, li trovi in “Da sistemare” con i sostituti proposti.</p>' + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="an-save"' + FA.saveDisabled() + '>' + (A.saving ? 'Salvataggio…' : 'Salva') + '</button>' });
  };
  FA.actions['abs-new'] = el => FA.openAbsenceNew(el.getAttribute('data-th') || '');
  FA.actions['an-save'] = async () => {
    const f = A.ui.an; f.error = null;
    if (!f.therapist_id) { f.error = 'Scegli il fisioterapista.'; FA.renderModal(); return; }
    if (!f.from) { f.error = 'Indica la data di inizio.'; FA.renderModal(); return; }
    const p = { therapist_id: f.therapist_id, kind: f.kind, start_date: f.from, note: f.note || '' };
    if (f.unknown) {
      if (!f.plan_until) { f.error = 'Rientro non noto: indica fino a quando organizzare le sostituzioni.'; FA.renderModal(); return; }
      p.end_date = null; p.plan_until = f.plan_until;
    } else {
      p.end_date = f.to || f.from;
      if (p.end_date < p.start_date) { f.error = 'La data finale precede quella iniziale.'; FA.renderModal(); return; }
    }
    if (f.span === 'fascia') {
      if (!f.start_time || !f.end_time || f.end_time <= f.start_time) { f.error = 'Indica una fascia oraria valida.'; FA.renderModal(); return; }
      p.start_time = f.start_time; p.end_time = f.end_time;
    }
    try {
      const abs = await FA.save(E.ABSENCE_KIND[f.kind] + ' registrata', () => FA.rpc('save_absence', { p }));
      const saved = (A.data.absences || []).find(x => x.id === abs.id) || abs;
      const n = E.affectedByAbsence(A.ctx, E.normalize({ absences: [saved] }).absences[0]).length;
      FA.closeModal();
      if (n) FA.go('assenze', 'piano', abs.id);
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- modifica / annullamento di un'assenza ---------------- */
  FA.actions['abs-edit'] = el => {
    const a = (A.data.absences || []).find(x => x.id === el.getAttribute('data-id'));
    if (!a) return;
    A.ui.absEdit = { id: a.id, version: a.version, therapist_id: a.therapist_id, kind: a.kind, start_date: a.start_date, end_date: a.end_date || '',
      unknown: !a.end_date, plan_until: a.plan_until || '', span: a.start_time ? 'fascia' : 'intera', start_time: a.start_time || '', end_time: a.end_time || '', note: a.note || '' };
    FA.openModal({
      title: 'Assenza di ' + FA.thName(a.therapist_id),
      body() {
        const f = A.ui.absEdit;
        return '<div class="grid2"><div class="field"><label>Dal</label><input type="date" data-bind="absEdit.start_date" value="' + esc(f.start_date) + '"></div>' +
          (f.unknown ? '<div class="field"><label>Organizza fino al</label><input type="date" data-bind="absEdit.plan_until" value="' + esc(f.plan_until) + '"><div class="help">Rientro non noto: le giornate successive restano da verificare.</div></div>'
            : '<div class="field"><label>Al (rientro il giorno dopo)</label><input type="date" data-bind="absEdit.end_date" value="' + esc(f.end_date) + '"></div>') + '</div>' +
          '<div class="field"><label class="inline-check"><input type="checkbox" data-bind="absEdit.unknown" data-rerender' + (f.unknown ? ' checked' : '') + '> Rientro non noto</label></div>' +
          '<div class="field">' + FA.seg('absEdit.span', [['intera', 'Giornata intera'], ['fascia', 'Fascia oraria']], f.span) + '</div>' +
          (f.span === 'fascia' ? '<div class="grid3"><div class="field"><label>Dalle</label><input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="absEdit.start_time" value="' + esc(f.start_time) + '"></div><div class="field"><label>Alle</label><input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="absEdit.end_time" value="' + esc(f.end_time) + '"></div></div>' : '') +
          '<div class="grid2"><div class="field"><label>Motivo</label><select data-bind="absEdit.kind">' + Object.entries(E.ABSENCE_KIND).map(([k, l]) => FA.option(k, l, f.kind)).join('') + '</select></div>' +
          '<div class="field"><label>Nota</label><input type="text" data-bind="absEdit.note" value="' + esc(f.note) + '"></div></div>' +
          '<p class="muted small">Modificare o annullare l’assenza non sposta gli appuntamenti già sostituiti: restano come confermati.</p>' + FA.errBox(f.error);
      },
      foot() {
        return '<button class="btn danger" data-act="abs-cancel"' + FA.saveDisabled() + '>Annulla l’assenza</button><span class="grow"></span>' +
          '<button class="btn" data-act="close-modal">Chiudi</button><button class="btn primary" data-act="abs-edit-save"' + FA.saveDisabled() + '>' + (A.saving ? 'Salvataggio…' : 'Salva') + '</button>';
      }
    });
  };
  FA.actions['abs-edit-save'] = async () => {
    const f = A.ui.absEdit;
    const p = { id: f.id, version: f.version, therapist_id: f.therapist_id, kind: f.kind, start_date: f.start_date, note: f.note,
      end_date: f.unknown ? null : f.end_date, plan_until: f.unknown ? f.plan_until : null,
      start_time: f.span === 'fascia' ? f.start_time : null, end_time: f.span === 'fascia' ? f.end_time : null };
    if (f.unknown && !f.plan_until) { f.error = 'Indica fino a quale data organizzare le sostituzioni.'; FA.renderModal(); return; }
    if (!f.unknown && !f.end_date) { f.error = 'Indica la data di fine o scegli “Rientro non noto”.'; FA.renderModal(); return; }
    try { await FA.save('Assenza aggiornata', () => FA.rpc('save_absence', { p })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['abs-cancel'] = async () => {
    const f = A.ui.absEdit;
    if (!confirm('Annullare l’assenza? Resterà nello storico. Gli appuntamenti già sostituiti non vengono modificati.')) return;
    try { await FA.save('Assenza annullata', () => FA.rpc('cancel_absence', { p_id: f.id, p_version: f.version, p_note: '(annullata)' })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- passo 2: piano delle sostituzioni ---------------- */
  FA.actions['abs-plan'] = el => { FA.closeModal(); FA.go('assenze', 'piano', el.getAttribute('data-id')); };

  function planState(abs, rows) {
    A.ui.plans = A.ui.plans || {};
    let P = A.ui.plans[abs.id];
    if (!P) {
      P = A.ui.plans[abs.id] = { sel: {}, kind: {}, reason: {}, results: {}, auto: true };
      const prop = E.proposeDistribution(A.ctx, rows, { absentTherapistId: abs.therapist_id });
      prop.forEach((v, k) => { P.sel[k] = v; if (v.action === 'da_riprogrammare') P.reason[k] = v.reason; });
    }
    const multi = !abs.end_date || abs.end_date !== abs.start_date;
    rows.forEach(a => { if (!P.kind[a.id]) P.kind[a.id] = multi ? 'periodo' : 'singola'; });
    return P;
  }
  function selMap(P, rows) {
    const m = new Map();
    rows.forEach(a => { if (P.sel[a.id]) m.set(a.id, P.sel[a.id]); });
    return m;
  }
  const selKey = s => !s ? '' : s.action === 'da_riprogrammare' ? 'R' : 'S|' + s.therapist_id + '|' + s.start;

  function planView(absId) {
    const abs = (A.data.absences || []).find(a => a.id === absId);
    if (!abs) return '<div class="panel">Assenza non trovata (forse annullata da un collega). <a href="#/assenze">Torna alle assenze</a></div>';
    const ctx = A.ctx;
    const rows = E.affectedByAbsence(ctx, abs);
    const held = E.affectedByAbsence(ctx, abs, null, { status: 'trattenuta' });
    const P = planState(abs, rows);
    const sm = selMap(P, rows);
    const val = E.validateSelections(ctx, rows, sm);
    const usedBy = new Map();
    rows.forEach(a => { const s = sm.get(a.id); if (s && s.action === 'sostituisci') usedBy.set(s.therapist_id + '|' + s.day + '|' + s.start, a); });
    const done = (A.data.appointments || []).filter(a => a.original_therapist_id === abs.therapist_id && a.day >= abs.start_date && a.day >= A.today &&
      (!abs.end_date || a.day <= abs.end_date) && (abs.end_date || a.day <= abs.plan_until) && a.status === 'programmata');
    const resched = (A.data.appointments || []).filter(a => a.therapist_id === abs.therapist_id && a.status === 'da_riprogrammare' && a.day >= abs.start_date && (abs.end_date ? a.day <= abs.end_date : a.day <= abs.plan_until));
    const later = E.toVerifyAfter(ctx, abs);
    const nBad = rows.filter(a => !val.get(a.id).ok).length;
    const nAlt = rows.filter(a => val.get(a.id).alternativeOf).length;

    let html = '<div class="row between"><h2>Sostituti per ' + esc(FA.thName(abs.therapist_id)) + '</h2><a class="btn small" href="#/assenze">← Assenze</a></div>' +
      '<div class="panel"><div class="row between"><div><strong>' + esc(E.ABSENCE_KIND[abs.kind]) + '</strong> · ' + esc(absPeriod(abs)) + (abs.note ? ' · ' + esc(abs.note) : '') + '</div>' +
      '<button class="btn small" data-act="abs-edit" data-id="' + abs.id + '">Modifica assenza</button></div>' +
      (!abs.end_date ? '<div class="form-warn">Rientro non noto: sostituzioni organizzate fino al <strong>' + E.fmtIt(abs.plan_until) + '</strong>. ' +
        (later.length ? later.length + ' appuntamenti successivi restano <strong>da verificare</strong> (non vengono spostati, il rientro non viene presunto).' : 'Nessun appuntamento successivo da verificare.') +
        ' Per organizzare altri giorni usa “Modifica assenza” e sposta la data.</div>' : '') +
      (held.length ? '<div class="form-note">' + held.length + ' posti sono mantenuti per cicli sospesi: verranno ricontrollati alla ripresa del ciclo.</div>' : '') + '</div>';

    if (!rows.length) {
      html += '<div class="panel"><p><strong>✓ Nessun appuntamento da sistemare</strong> per questa assenza.</p></div>';
    } else {
      html += '<div class="panel"><div class="row between"><div><h3 style="margin:0">Appuntamenti coinvolti: ' + rows.length + '</h3>' +
        '<p class="muted small" style="margin:4px 0 0">' + (P.auto ? 'Proposta automatica (stesso orario e competenza specifica per primi): puoi modificare ogni scelta. ' : '') +
        'Nulla è applicato finché non confermi.</p></div>' +
        '<button class="btn small" data-act="plan-propose" data-id="' + abs.id + '"' + FA.disabledIfReadOnly() + '>Ricalcola la proposta</button></div>';
      let lastDay = null;
      rows.forEach(a => {
        if (a.day !== lastDay) { html += '<h4 class="day-title">' + esc(FA.dayLabel(a.day)) + '</h4>'; lastDay = a.day; }
        html += planRow(abs, a, P, val.get(a.id), usedBy);
      });
      html += '<div class="sticky-foot"><span>' + rows.length + ' appuntamenti · ' +
        (nBad ? '<span class="chip bad">' + nBad + ' da correggere' + (nAlt ? ' (' + nAlt + ' alternative sullo stesso posto)' : '') + '</span>' : '<span class="chip ok">✓ tutte le scelte sono compatibili</span>') + '</span><span class="grow"></span>' +
        '<button class="btn primary" data-act="plan-review" data-id="' + abs.id + '"' + (nBad || !FA.canEdit() || FA.isFisio() || !A.online ? ' disabled' : '') + '>Rivedi e conferma</button>' +
        (FA.isFisio() ? '<span class="small muted">Le sostituzioni sui calendari dei colleghi le conferma la segreteria o il coordinatore.</span>' : '') + '</div></div>';
    }
    if (P.lastResult) html += '<div class="panel">' + P.lastResult + '</div>';
    if (done.length || resched.length) {
      html += '<div class="panel"><h3>Già sistemati</h3><ul class="list">' +
        done.map(a => '<li>' + esc(E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.patName(a.patient_id)) + ' → <strong>' + esc(FA.thName(a.therapist_id)) + '</strong> ' +
          '<span class="chip ok">' + (a.substitute_kind === 'periodo' ? 'sostituzione per il periodo' : 'sostituzione singola seduta') + '</span></li>').join('') +
        resched.map(a => '<li>' + esc(E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.patName(a.patient_id)) + ' <span class="chip bad">Da riprogrammare</span> <span class="muted small">' + esc(a.reason) + '</span> <button class="btn small" data-act="open-appt" data-id="' + a.id + '">Sposta</button></li>').join('') +
        '</ul></div>';
    }
    if (later.length) {
      html += '<div class="panel"><h3>Da verificare dopo il ' + E.fmtIt(abs.plan_until) + '</h3><p class="muted small">Restano assegnati a ' + esc(FA.thName(abs.therapist_id)) + ' finché non si conosce il rientro.</p><ul class="list">' +
        later.slice(0, 30).map(a => '<li>' + esc(E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.patName(a.patient_id)) + ' <span class="chip info">da verificare</span></li>').join('') + '</ul>' +
        (later.length > 30 ? '<p class="muted small">…e altri ' + (later.length - 30) + '.</p>' : '') + '</div>';
    }
    return html;
  }

  function planRow(abs, a, P, v, usedBy) {
    const ctx = A.ctx;
    const cyc = ctx.cyc.get(a.cycle_id);
    const s = P.sel[a.id];
    const opt = E.substitutionOptions(ctx, a, { absentTherapistId: abs.therapist_id });
    const dur = E.toMin(a.end_time) - E.toMin(a.start_time);
    const tag = (thId, start) => {
      const u = usedBy.get(thId + '|' + a.day + '|' + start);
      return u && u.id !== a.id ? ' — già scelto per ' + FA.patName(u.patient_id) + ' (alternativa)' : '';
    };
    const cur = selKey(s);
    const spec = opt.sameTime.filter(o => o.level === 'specifica'), abil = opt.sameTime.filter(o => o.level !== 'specifica');
    let options = '<option value="">— scegli —</option>';
    if (spec.length) options += '<optgroup label="Stesso orario · competenza specifica">' + spec.map(o => FA.option('S|' + o.therapist_id + '|' + o.start, FA.thName(o.therapist_id) + ' (' + o.load + ' pazienti quel giorno)' + tag(o.therapist_id, o.start), cur)).join('') + '</optgroup>';
    if (abil.length) options += '<optgroup label="Stesso orario · altri abilitati">' + abil.map(o => FA.option('S|' + o.therapist_id + '|' + o.start, FA.thName(o.therapist_id) + ' (' + o.load + ' pazienti quel giorno)' + tag(o.therapist_id, o.start), cur)).join('') + '</optgroup>';
    if (opt.otherTime.length) options += '<optgroup label="⚠ Con cambio di orario">' + opt.otherTime.map(o => FA.option('S|' + o.therapist_id + '|' + o.start,
      '⚠ ' + FA.thName(o.therapist_id) + ' alle ' + o.start + ' (' + (E.toMin(o.start) > E.toMin(a.start_time) ? '+' : '−') + o.delta + ' min)' + (o.level === 'specifica' ? ' ★' : '') + tag(o.therapist_id, o.start), cur)).join('') + '</optgroup>';
    const known = new Set(opt.sameTime.concat(opt.otherTime).map(o => 'S|' + o.therapist_id + '|' + o.start));
    if (s && s.action === 'sostituisci' && !known.has(cur)) options += '<optgroup label="Scelta non più disponibile">' + FA.option(cur, FA.thName(s.therapist_id) + ' alle ' + s.start + ' (non più compatibile)', cur) + '</optgroup>';
    options += '<optgroup label="Nessuna soluzione">' + FA.option('R', 'Lascia “da riprogrammare”', cur) + '</optgroup>';

    let state = 'state-warn', status;
    if (!s) status = '<span class="chip warn">Scegli una soluzione</span>';
    else if (!v.ok) { state = 'state-bad'; status = '<span class="chip bad">✗ ' + (v.alternativeOf ? 'Alternativa' : 'Non compatibile') + '</span> <span class="small">' + esc(v.msg) + '</span>'; }
    else if (s.action === 'da_riprogrammare') { state = 'state-warn'; status = '<span class="chip bad">Da riprogrammare</span>'; }
    else if (s.start !== a.start_time) { state = 'state-warn'; status = '<span class="chip warn">⚠ Cambio orario: ' + s.start + ' invece di ' + a.start_time + '</span>'; }
    else { state = 'state-ok'; status = '<span class="chip ok">✓ Stesso orario con ' + esc(FA.thName(s.therapist_id)) + '</span>'; }
    const res = P.results[a.id];
    return '<div class="subst ' + state + '" data-row="' + a.id + '">' +
      '<div class="subst-head"><span class="time">' + a.start_time + '–' + a.end_time + '</span><span class="muted">' + dur + ' min</span>' +
      '<strong>' + esc(FA.patName(a.patient_id)) + '</strong>' + FA.prio(cyc.priority) + '<span class="chip blue">' + esc(FA.catName(cyc.category_id)) + '</span>' +
      (a.recovery_of ? '<span class="chip info">recupero</span>' : '') + '</div>' +
      '<div class="subst-body"><div><label for="sel-' + a.id + '">Sostituto</label><select id="sel-' + a.id + '" data-bind="plansel.' + a.id + '" data-on="plan-pick" data-abs="' + abs.id + '"' + FA.disabledIfReadOnly() + '>' + options + '</select>' +
      '<div style="margin-top:6px">' + status + '</div>' +
      (res && !res.ok ? '<div class="form-error">✗ Non salvato: ' + esc(res.message) + '</div>' : '') +
      (!opt.sameTime.length && !opt.otherTime.length ? '<div class="small muted" style="margin-top:4px">' + esc(P.reason[a.id] || '') + '</div>' : '') +
      (s && s.action === 'da_riprogrammare' ? '<div class="field" style="margin-top:6px"><label for="rs-' + a.id + '">Motivo</label><input id="rs-' + a.id + '" type="text" data-bind="plans.' + abs.id + '.reason.' + a.id + '" value="' + esc(P.reason[a.id] || '') + '"></div>' : '') +
      '</div><div><label>Tipo di sostituzione</label>' + FA.seg('plans.' + abs.id + '.kind.' + a.id, [['singola', 'Singola seduta'], ['periodo', 'Per il periodo']], P.kind[a.id]) +
      '<div style="margin-top:8px"><button class="btn small" data-act="stable-change" data-appt="' + a.id + '"' + FA.disabledIfReadOnly() + '>Cambio stabile del fisioterapista…</button></div>' +
      '<div class="small muted" style="margin-top:4px">La sostituzione non modifica il resto del ciclo.</div></div></div></div>';
  }

  FA.actions['plan-pick'] = (el) => {
    const absId = el.getAttribute('data-abs');
    const apptId = el.id.replace(/^sel-/, '');
    const P = A.ui.plans[absId];
    const v = el.value;
    const a = A.ctx.appt.get(apptId);
    P.auto = false;
    delete P.results[apptId];
    if (!v) delete P.sel[apptId];
    else if (v === 'R') {
      P.sel[apptId] = { action: 'da_riprogrammare' };
      if (!P.reason[apptId]) P.reason[apptId] = 'Nessun sostituto disponibile';
    } else {
      const [, th, start] = v.split('|');
      const dur = E.toMin(a.end_time) - E.toMin(a.start_time);
      P.sel[apptId] = { action: 'sostituisci', therapist_id: th, day: a.day, start, end: E.fromMin(E.toMin(start) + dur), sameTime: start === a.start_time };
    }
    FA.render();
  };
  FA.actions['plan-propose'] = el => {
    const id = el.getAttribute('data-id');
    if (A.ui.plans && A.ui.plans[id] && !A.ui.plans[id].auto && !confirm('Ricalcolare la proposta? Le scelte fatte a mano saranno sostituite (nulla è ancora stato salvato).')) return;
    if (A.ui.plans) delete A.ui.plans[id];
    FA.render();
  };

  FA.actions['plan-review'] = el => {
    const abs = A.data.absences.find(a => a.id === el.getAttribute('data-id'));
    const rows = E.affectedByAbsence(A.ctx, abs);
    const P = A.ui.plans[abs.id];
    const items = rows.map(a => ({ a, s: P.sel[a.id] })).filter(x => x.s);
    const missing = rows.length - items.length;
    FA.openModal({
      title: 'Riepilogo prima della conferma', wide: true, live: true,
      body() {
        return (missing ? '<div class="form-warn">' + missing + ' appuntamenti senza scelta non verranno modificati e resteranno da sistemare.</div>' : '') +
          '<div class="table-wrap"><table><thead><tr><th>Paziente</th><th>Era</th><th>Diventa</th><th>Tipo</th></tr></thead><tbody>' +
          items.map(({ a, s }) => '<tr><td>' + esc(FA.patName(a.patient_id)) + '</td><td>' + esc(E.fmtItDay(a.day) + ' ' + a.start_time + ' · ' + FA.thName(a.therapist_id)) + '</td><td>' +
            (s.action === 'da_riprogrammare' ? '<span class="chip bad">Da riprogrammare</span> <span class="small">' + esc(P.reason[a.id] || '') + '</span>' :
              esc(FA.thName(s.therapist_id)) + ' alle ' + s.start + (s.start !== a.start_time ? ' <span class="chip warn">⚠ cambio orario</span>' : ' <span class="chip ok">stesso orario</span>')) +
            '</td><td>' + (s.action === 'da_riprogrammare' ? '—' : (P.kind[a.id] === 'periodo' ? 'Per il periodo' : 'Singola seduta')) + '</td></tr>').join('') +
          '</tbody></table></div><p class="muted small">Il server ricontrolla ogni voce: se nel frattempo un collega ha occupato un posto, quella voce non viene salvata e te lo segnalo. Il ciclo dei pazienti non cambia.</p>';
      },
      foot() {
        return '<button class="btn" data-act="close-modal">Torna alle scelte</button><button class="btn primary" data-act="plan-confirm" data-id="' + abs.id + '"' + FA.saveDisabled() + '>' + (A.saving ? 'Salvataggio…' : 'Conferma e salva (' + items.length + ')') + '</button>';
      }
    });
  };
  FA.actions['plan-confirm'] = async el => {
    const abs = A.data.absences.find(a => a.id === el.getAttribute('data-id'));
    const rows = E.affectedByAbsence(A.ctx, abs);
    const P = A.ui.plans[abs.id];
    const items = rows.filter(a => P.sel[a.id]).map(a => {
      const s = P.sel[a.id];
      return s.action === 'da_riprogrammare'
        ? { appointment_id: a.id, version: a.version, action: 'da_riprogrammare', reason: P.reason[a.id] || 'Nessun sostituto disponibile' }
        : { appointment_id: a.id, version: a.version, action: 'sostituisci', therapist_id: s.therapist_id, day: s.day, start_time: s.start, kind: P.kind[a.id] };
    });
    try {
      const res = await FA.save('Sostituzioni', () => FA.rpc('apply_substitutions', { p_items: items }));
      const ok = res.filter(r => r.ok), ko = res.filter(r => !r.ok);
      P.results = {};
      ko.forEach(r => { P.results[r.appointment_id] = r; });
      P.lastResult = '<h3>Esito del salvataggio</h3><p><span class="chip ok">✓ ' + ok.length + ' salvat' + (ok.length === 1 ? 'a' : 'e') + '</span> ' +
        (ko.length ? '<span class="chip bad">✗ ' + ko.length + ' non salvat' + (ko.length === 1 ? 'a' : 'e') + '</span></p><ul>' + ko.map(r => {
          const a = A.ctx.appt.get(r.appointment_id);
          return '<li>' + esc(a ? FA.patName(a.patient_id) : '') + ': ' + esc(r.message) + '</li>';
        }).join('') + '</ul><p class="muted small">Le voci non salvate restano qui sopra con le proposte ricalcolate sui dati aggiornati.</p>' : '</p>');
      ok.forEach(r => { delete P.sel[r.appointment_id]; });
      ko.forEach(r => { delete P.sel[r.appointment_id]; });
      // le voci non salvate ricevono una nuova proposta sui dati aggiornati
      const left = E.affectedByAbsence(A.ctx, abs).filter(a => !P.sel[a.id]);
      if (left.length) E.proposeDistribution(A.ctx, left, { absentTherapistId: abs.therapist_id }).forEach((v, k) => {
        P.sel[k] = v; if (v.action === 'da_riprogrammare') P.reason[k] = v.reason;
      });
      FA.closeModal(); FA.render();
    } catch (e) {
      FA.closeModal();
      P.lastResult = FA.errBox('Nessuna modifica salvata: ' + e.message);
      FA.render();
    }
  };

  FA.views.assenze = {
    render(params) { return params[0] === 'piano' ? planView(params[1]) : step1(); }
  };
})();
