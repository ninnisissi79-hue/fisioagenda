/*
 * FisioAgenda pilota — calendario del fisioterapista come unico posto di lavoro.
 * - navigazione libera tra le date (giorno / settimana)
 * - "✎ Orario": pennelli, trascinamento, ridimensionamento, duplicazione, schemi, bozza + Salva
 *   (solo date modificate / da una data in poi / dal … al …), con verifica dei conflitti
 * - pannello paziente con anteprima delle sedute sul calendario (anche ciclo già iniziato,
 *   orari diversi per giorno della settimana)
 * Il server ricontrolla sempre tutto (sovrapposizioni, fasce, assenze, chiusure, competenze).
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc;
  const PX = 1.25; // pixel per minuto
  const BRUSHES = [['amb', 'Ambulatorio'], ['reparto', 'Reparto'], ['pausa', 'Pausa'], ['documentazione', 'Cartelle / adempimenti'], ['segreteria', 'Segreteria'],
    ['corso', 'Corso obbligatorio'], ['permesso_ore', 'Permesso a ore'], ['recupero_ore', 'Recupero ore'], ['briefing', 'Briefing'], ['altro', 'Altra attività']];
  const DEFAULT_PRESET = { amb: 60, reparto: 180, pausa: 20, documentazione: 30, segreteria: 30, corso: 120, permesso_ore: 60, recupero_ore: 60, briefing: 15, altro: 30 };
  function presets() {
    try { return Object.assign({}, DEFAULT_PRESET, JSON.parse(localStorage.getItem('fa-preset') || '{}')); } catch (e) { return Object.assign({}, DEFAULT_PRESET); }
  }
  const timeField = (path, v, extra) => '<input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="' + path + '" value="' + esc(v || '') + '"' + (extra || '') + '>';
  FA.timeField = timeField;

  /* ---------------- fasce: operazioni sui blocchi della giornata ---------------- */
  const toM = b => ({ kind: b.kind, s: E.toMin(b.start), e: E.toMin(b.end), max: b.max == null || b.max === '' ? null : Number(b.max), label: b.label || '' });
  const fromM = x => ({ kind: x.kind, start: E.fromMin(x.s), end: E.fromMin(x.e), max: x.max, label: x.label || '' });
  /** dipinge [s,e) con un tipo (null = cancella): le fasce sovrapposte vengono accorciate o divise */
  function paintRange(blocks, kind, s, e) { // (5° argomento facoltativo: nome dell'attività)
    const out = [];
    blocks.map(toM).forEach(b => {
      if (b.e <= s || b.s >= e) { out.push(b); return; }
      if (b.s < s) out.push(Object.assign({}, b, { e: s }));
      if (b.e > e) out.push(Object.assign({}, b, { s: e }));
    });
    if (kind) out.push({ kind, s, e, max: null, label: arguments[4] || '' });
    out.sort((a, b) => a.s - b.s);
    const m = [];
    out.forEach(x => { const l = m[m.length - 1]; if (l && l.kind === x.kind && l.e === x.s && l.max == x.max && (l.label || '') === (x.label || '')) l.e = x.e; else m.push(Object.assign({}, x)); });
    return m.filter(x => x.e > x.s).map(fromM);
  }
  FA.paintRange = paintRange;

  /* ---------------- stato del calendario ---------------- */
  function calState(params) {
    const ctx = A.ctx;
    const th = params[0] && ctx.th.get(params[0]) ? params[0] : (FA.isFisio() && A.me.therapist_id) || (FA.activeTherapists()[0] || {}).id;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params[1] || '') ? params[1] : A.today;
    const mode = ['giorno', 'mese', 'tutti'].includes(params[2]) && (params[2] !== 'tutti' || FA.isOffice()) ? params[2] : 'mese';
    return { th, date, mode };
  }
  FA.calState = calState;
  function pt(th) {
    if (!A.ui.pt || A.ui.pt.th !== th) A.ui.pt = { th, drafts: {}, brush: 'amb', effects: null };
    return A.ui.pt;
  }
  // settimana tipo e orari: chi può modificare quel calendario (il fisioterapista il proprio, segreteria e coordinatore tutti)
  const painting = () => !!A.ui.painting && !!A.ui.pt && FA.canEditTh(A.ui.pt.th);
  function viewBlocks(th, d) {
    const p = A.ui.pt && A.ui.pt.th === th ? A.ui.pt.drafts[d] : null;
    return p ? p.map(b => Object.assign({}, b)) : E.dayBlocks(A.ctx, th, d).map(b => Object.assign({}, b));
  }

  /* ---------------- vista ---------------- */
  function calendarView(params) {
    const ctx = A.ctx;
    const st = calState(params);
    if (!st.th) return '<div class="panel">Nessun fisioterapista: inseriscili da Configurazione.</div>';
    const th = ctx.th.get(st.th), thId = st.th;
    const P = pt(thId);
    const edit = painting();
    const can = FA.canEditTh(thId);
    if (st.mode === 'mese' && !edit) return calBar(st, th, can, edit, P) + FA.tabGrid(st, thId, can);
    // colonne: il giorno del fisioterapista, oppure (segreteria) tutti i fisioterapisti affiancati
    const all = st.mode === 'tutti';
    const pairs = all ? FA.activeTherapists().map(t => [t.id, st.date]) : [[thId, st.date]];
    const days = pairs.map(x => x[1]);
    let minS = 24 * 60, maxE = 0;
    pairs.forEach(([t, d]) => viewBlocks(t, d).forEach(b => { minS = Math.min(minS, E.toMin(b.start)); maxE = Math.max(maxE, E.toMin(b.end)); }));
    (ctx.data.appointments || []).filter(a => pairs.some(([t, d]) => a.therapist_id === t && a.day === d)).forEach(a => { minS = Math.min(minS, E.toMin(a.start_time)); maxE = Math.max(maxE, E.toMin(a.end_time)); });
    if (edit || maxE <= minS) { minS = Math.min(minS, 7 * 60); maxE = Math.max(maxE, 16 * 60); }
    minS = Math.floor(minS / 60) * 60; maxE = Math.ceil(maxE / 60) * 60;
    const H = (maxE - minS) * PX;
    const y = t => (E.toMin(t) - minS) * PX;
    const box = (s, e, cls, inner, attrs) => '<div class="' + cls + '" style="top:' + y(s) + 'px;height:' + Math.max(12, y(e) - y(s) - 1) + 'px"' + (attrs || '') + '>' + inner + '</div>';
    let ruler = '<div class="wk-ruler" style="height:' + H + 'px">';
    for (let m = minS; m <= maxE; m += 30) ruler += '<div class="wk-tick' + (m % 60 ? ' half' : '') + '" style="top:' + (m - minS) * PX + 'px">' + (m % 60 ? '' : E.fromMin(m)) + '</div>';
    ruler += '</div>';
    const cols = pairs.map(([thId, d]) => {
      const can = FA.canEditTh(thId);
      const blocks = viewBlocks(thId, d);
      const draft = !!P.drafts[d];
      const abs = E.absenceOnDay(ctx, thId, d);
      const appts = (ctx.data.appointments || []).filter(a => a.therapist_id === thId && a.day === d);
      const occ = appts.filter(a => E.OCCUPYING.has(a.status));
      const other = appts.filter(a => !E.OCCUPYING.has(a.status) && a.status !== 'spostata' && a.status !== 'liberata');
      const closed = ctx.closures.get(d);
      let inner = '';
      blocks.forEach((b, i) => {
        const lab = esc(b.label || E.BLOCK[b.kind] || b.kind) + (edit ? ' ' + b.start + '–' + b.end : '');
        const cls = (b.kind === 'amb' ? 'wk-amb' : 'wk-blk k-' + b.kind) + (edit ? ' paintable' : '');
        inner += box(b.start, b.end, cls, (b.kind === 'amb' && !edit ? '' : '<span>' + lab + '</span>') + (edit ? '<i class="h-top"></i><i class="h-bot"></i>' : ''), edit ? ' data-blk="' + i + '"' : '');
      });
      if (!closed && !edit) blocks.filter(b => b.kind === 'amb').forEach(b => {
        const busy = occ.map(a => [E.toMin(a.start_time), E.toMin(a.end_time)])
          .concat(abs.map(x => x.start_time ? [E.toMin(x.start_time), E.toMin(x.end_time)] : [0, 24 * 60])).sort((p, q) => p[0] - q[0]);
        let cur = E.toMin(b.start); const end = E.toMin(b.end); const gaps = [];
        busy.forEach(([s0, e0]) => { if (e0 <= cur || s0 >= end) return; if (s0 > cur) gaps.push([cur, s0]); cur = Math.max(cur, e0); });
        if (cur < end) gaps.push([cur, end]);
        gaps.filter(([g0, g1]) => g1 - g0 >= 15).forEach(([g0, g1]) => {
          const ok = can && d >= A.today;
          inner += box(E.fromMin(g0), E.fromMin(g1), 'wk-free' + (ok ? ' act' : ''), (ok ? '+ ' : '') + 'libero ' + E.fromMin(g0) + '–' + E.fromMin(g1),
            ok ? ' data-act="pd-open" data-th="' + thId + '" data-day="' + d + '" data-start="' + E.fromMin(g0) + '" data-end="' + E.fromMin(g1) + '" role="button" tabindex="0" title="Tocca per inserire un paziente o un’attività"' : '');
        });
      });
      occ.forEach(a => {
        const c = ctx.cyc.get(a.cycle_id);
        const iss = A.issues.find(i => i.appointment_id === a.id && i.kind !== 'esito_mancante');
        const ev = ctx.events.get(a.patient_id + '|' + a.day);
        inner += box(a.start_time, a.end_time, 'wk-appt st-' + a.status + (a.original_therapist_id ? ' sub' : '') + (iss ? ' issue' : '') + '' + (A.ui.swap && A.ui.swap.id === a.id ? ' swapping' : '') + (A.ui.booked && A.ui.booked.patient_id === a.patient_id ? ' booked' : ''),
          FA.countBadge(a) + ' <strong>' + a.start_time + ' ' + esc(FA.patName(a.patient_id)) + '</strong> ' +
          (ev ? '<span class="wk-v" title="Visita fisiatrica">V</span> ' : '') + FA.prio(c ? c.priority : 'NI') +
          '<br><span class="small">' + (c && c.treatment ? esc(c.treatment) + ' · ' : '') + esc(c ? FA.catName(c.category_id) : '') + (a.status !== 'programmata' ? ' · ' + esc(E.STATUS[a.status]) : '') +
          (a.original_therapist_id ? ' · sostituisce ' + esc(FA.thName(a.original_therapist_id)) : '') + (a.recovery_of ? ' · recupero' : '') + (iss ? ' · ⚠ ' + esc(iss.message) : '') + '</span>',
          ' data-act="tg-cell" data-id="' + a.id + '" role="button" tabindex="0"');
      });
      // pazienti del titolare affidati a un collega: promemoria leggero (non occupa il posto)
      (ctx.data.appointments || []).filter(a => a.original_therapist_id === thId && a.therapist_id !== thId && a.day === d && E.OCCUPYING.has(a.status)).forEach(a => {
        inner += box(a.start_time, a.end_time, 'wk-given', '→ ' + a.start_time + ' ' + esc(FA.patName(a.patient_id)) + '<br><span class="small">con ' + esc(FA.thName(a.therapist_id)) + ' (sostituzione)</span>',
          ' data-act="open-appt" data-id="' + a.id + '" role="button" tabindex="0" title="Seduta affidata a ' + esc(FA.thName(a.therapist_id)) + '"');
      });
      ((A.ui.pd && A.ui.pd.th === thId && A.ui.pd.slots) || []).filter(g => g.day === d).forEach(g => {
        inner += box(g.start, g.end, 'wk-ghost' + (g.chk ? ' bad' : ''), (g.chk ? '✗ ' : '◌ ') + g.start + ' seduta ' + g.n + (g.chk ? '<br><span class="small">' + esc(g.chk.msg) + '</span>' : ''));
      });
      abs.forEach(x => {
        inner += x.start_time ? box(x.start_time, x.end_time, 'wk-abs', 'Assente (' + esc(E.ABSENCE_KIND[x.kind]) + ')') :
          '<div class="wk-abs" style="top:0;height:' + H + 'px">Assente (' + esc(E.ABSENCE_KIND[x.kind]) + ')' + (x.end_date ? '' : ' · rientro non noto') + '</div>';
      });
      if (closed) inner += '<div class="wk-closed" style="top:0;height:' + H + 'px">Chiuso: ' + esc(closed) + '</div>';
      if (edit && !blocks.length) inner += '<div class="wk-empty">Trascina con un pennello per disegnare la giornata</div>';
      const head = '<div class="wk-head' + (d === A.today ? ' today' : '') + (draft ? ' draft' : '') + '"' + (edit ? ' data-act="pt-day" data-day="' + d + '" role="button" title="Copia, svuota o ripristina questa giornata"' : ' data-act="go" data-view="calendario" data-param="' + thId + '/' + d + '/' + (all ? 'mese' : 'giorno') + '" role="button" title="' + (all ? 'Tabulato del mese' : 'Vista del giorno') + '"') + '>' +
        esc(all ? FA.thName(thId) : E.fmtItDay(d)) + (draft ? ' <span class="chip warn">bozza</span>' : '') + (ctx.overrides.get(thId + '|' + d) && !draft ? ' <span class="chip info">variato</span>' : '') + '</div>';
      return '<div class="wk-day">' + head +
        '<div class="wk-col' + (edit ? ' paint' : can && d >= A.today ? ' writable' : '') + '" style="height:' + H + 'px" data-day="' + d + '" data-min="' + minS + '"' + (!edit ? ' data-act="cal-click" data-th="' + thId + '"' : '') + '>' + inner + '</div>' +
        (other.length ? '<div class="wk-other">' + other.map(a => '<button class="chip ' + (a.status === 'da_riprogrammare' ? 'bad' : 'grey') + '" data-act="open-appt" data-id="' + a.id + '">' +
          a.start_time + ' ' + esc(FA.patName(a.patient_id)) + ' · ' + esc(E.STATUS[a.status]) + ((a.status === 'assente' || a.status === 'annullata') && a.to_recover && !a.recovered_by ? ' · da recuperare' : '') + '</button>').join('') + '</div>' : '') + '</div>';
    }).join('');

    let html = calBar(st, th, can, edit, P);
    if (P.effects && P.effects.length) {
      html += '<div class="panel form-warn"><strong>Effetti della modifica:</strong> ' + P.effects.length + ' appuntamenti già prenotati non sono più compatibili. Non sono stati spostati: sistemali ora o da “Da sistemare”.<ul class="list">' +
        P.effects.map(c => '<li class="todo-item"><div>' + esc(E.fmtItDay(c.day) + ' ' + E.hhmm(c.start_time) + ' · ' + c.patient) + ' — ' + esc(c.message) + '</div><div><button class="btn small" data-act="open-appt" data-id="' + c.appointment_id + '">Sposta</button></div></li>').join('') +
        '</ul><button class="btn small" data-act="pt-effects-ok">Chiudi</button></div>';
    }
    html += '<div class="wk-scroll"><div class="wk-grid" style="grid-template-columns:52px repeat(' + pairs.length + ', minmax(' + (pairs.length === 1 ? 260 : 150) + 'px, 1fr))"><div><div class="wk-head">&nbsp;</div>' + ruler + '</div>' + cols + '</div></div>';
    return html;
  }
  /* ---------------- barra: fisioterapista, data, giorno / settimana / mese, Oggi ---------------- */
  const monthStart = d => d.slice(0, 8) + '01';
  function addMonths(d, n) {
    let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0') + '-01';
  }
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  function calBar(st, th, can, edit, P) {
    const thId = th.id;
    const step = st.mode === 'mese' ? 0 : 1;
    const prev = st.mode === 'mese' ? addMonths(st.date, -1) : E.addDays(st.date, -step);
    const next = st.mode === 'mese' ? addMonths(st.date, 1) : E.addDays(st.date, step);
    const title = st.mode === 'mese' ? MONTHS[Number(st.date.slice(5, 7)) - 1] + ' ' + st.date.slice(0, 4) : FA.dayLabel(st.date);
    const nDraft = Object.keys(P.drafts).length;
    const office = FA.isOffice();
    let html = '<div class="row between cal-top"><h2>' + (st.mode === 'tutti' ? 'Tutti i colleghi' : 'Tabulato di ' + esc(th.name)) + ' <span class="muted cal-when">· ' + esc(title) + '</span></h2><div class="row">' +
      (can && !edit && st.mode !== 'tutti' ? '<button class="btn small primary" data-act="pd-add" data-th="' + thId + '" data-day="' + st.date + '">+ Paziente</button>' : '') +
      (can && !edit && st.mode !== 'tutti' ? '<button class="btn small" data-act="or-open" data-th="' + thId + '">Orario</button>' : '') +
      (can && !edit && st.mode !== 'tutti' ? '<button class="btn small" data-act="abs-new" data-th="' + thId + '">Ferie / permesso</button>' : '') +
      (office && !edit ? '<button class="btn small" data-act="go" data-view="trova">Trova posto</button>' : '') +
      (edit ? '<button class="btn small primary" data-act="pt-toggle">✓ Fine</button>' : '') +
      '</div></div>' +
      '<div class="panel cal-bar"><div class="row">' +
      '<select style="max-width:240px" data-bind="calTh" data-on="cal-th" aria-label="Fisioterapista">' + FA.activeTherapists().map(t => FA.option(t.id, t.name + (FA.canEditTh(t.id) ? '' : ' (consultazione)'), thId)).join('') + '</select>' +
      '<button class="btn small" data-act="go" data-view="calendario" data-param="' + thId + '/' + prev + '/' + st.mode + '" aria-label="Indietro">◀</button>' +
      '<button class="btn small" data-act="go" data-view="calendario" data-param="' + thId + '/' + A.today + '/' + st.mode + '">Oggi</button>' +
      '<button class="btn small" data-act="go" data-view="calendario" data-param="' + thId + '/' + next + '/' + st.mode + '" aria-label="Avanti">▶</button>' +
      '<input type="date" style="max-width:170px" data-bind="calDate" data-on="cal-date" value="' + st.date + '" aria-label="Vai alla data">' +
      FA.seg('calMode', [['mese', 'Mese'], ['giorno', 'Giorno']].concat(office ? [['tutti', 'Tutti i colleghi']] : []), st.mode).replace(/data-act="seg"/g, 'data-act="cal-mode" data-th="' + thId + '" data-date="' + st.date + '"') +
      '</div>';
    if (A.ui.booked && A.ui.booked.th === thId) {
      const b = A.ui.booked;
      html += '<div class="draft-bar booked-bar"><span>✓ <strong>' + esc(FA.patName(b.patient_id)) + '</strong>: ' + b.n + ' sedute prenotate dal ' + esc(E.fmtItDay(b.from)) + ' (evidenziate nel tabulato).</span><span class="grow"></span>' +
        '<button class="btn small" data-act="go" data-view="paziente" data-param="' + b.patient_id + '">Scheda paziente</button><button class="btn small" data-act="booked-ok">OK</button></div>';
    }
    if (A.ui.swap) {
      const s0 = A.ctx.appt.get(A.ui.swap.id);
      html += '<div class="draft-bar swap-bar"><span><strong>Scambio:</strong> tocca il paziente da mettere al posto di ' + esc(s0 ? FA.patName(s0.patient_id) + ' (' + E.fmtItDay(s0.day) + ' ' + s0.start_time + ')' : '…') + '. Puoi cambiare giorno, settimana o fisioterapista.</span><span class="grow"></span><button class="btn small" data-act="swap-cancel">Annulla scambio</button></div>';
    }
    if (edit) {
      const pr = presets();
      html += '<div class="row brushes" style="margin-top:8px"><strong class="small">Pennello:</strong>' +
        BRUSHES.map(([k, l]) => '<button class="brush k-' + k + (P.brush === k ? ' on' : '') + '" data-act="pt-brush" data-k="' + k + '" title="Clic: ' + pr[k] + ' min · trascina: durata libera">' + esc(l) + '</button>').join('') +
        '<button class="brush gomma' + (P.brush === 'gomma' ? ' on' : '') + '" data-act="pt-brush" data-k="gomma">⌫ Gomma</button>' +
        '<button class="btn small" data-act="pt-presets">Durate rapide…</button>' +
        '<button class="btn small" data-act="pt-tpl-apply">Applica schema ai giorni visibili…</button><button class="btn small" data-act="pt-tpl-save">Salva come schema…</button></div>' +
        '<p class="small muted" style="margin:6px 0 0"><strong>Settimana tipo:</strong> disegna le fasce (ambulatorio, reparto, pausa…) e poi <strong>Salva</strong>: scegli se vale solo per quelle date, da una data in poi (si ripete ogni settimana) o per un periodo. Il passato e gli appuntamenti già presenti non vengono toccati; i conflitti sono elencati prima di salvare. Clic sull’intestazione di un giorno: copialo su altri giorni. Per una sola attività in un giorno non serve entrare qui: tocca lo spazio nel tabulato.</p>' +
        (nDraft ? '<div class="draft-bar"><span><strong>Bozza:</strong> ' + nDraft + ' giornat' + (nDraft === 1 ? 'a modificata' : 'e modificate') + ' (non ancora salvat' + (nDraft === 1 ? 'a' : 'e') + ')</span><span class="grow"></span>' +
          '<button class="btn small" data-act="pt-discard">Annulla bozza</button><button class="btn small primary" data-act="pt-save"' + FA.saveDisabled() + '>Salva…</button></div>' : '');
    } else {
      html += st.mode === 'mese' ? '' : '<p class="small muted" style="margin:6px 0 0">' + (can || st.mode === 'tutti' ? '<strong>Tocca uno spazio</strong> per scrivere un paziente, un’attività (pausa, ortesi, gruppo, progetto…) o ferie e permessi: giorno, ora e fisioterapista sono già compilati. <strong>Tocca un paziente</strong> per spostarlo, cambiarne la durata o il collega, segnare l’assenza o cancellarlo.' : 'Consultazione: per modificare questa agenda serve l’autorizzazione del coordinatore.') + '</p>';
    }
    return html + '</div>';
  }
  /** tocco su un punto qualsiasi della giornata: giorno, ora (a 5 minuti) e fisioterapista già compilati */
  FA.actions['cal-click'] = (el, ev) => {
    const th = el.getAttribute('data-th'), day = el.getAttribute('data-day');
    if (A.ui.swap) return;
    if (!FA.canEditTh(th)) { FA.toast('Consultazione: per scrivere in questa agenda serve l’autorizzazione del coordinatore.', 'warn'); return; }
    if (day < A.today) { FA.toast('Giorno passato: il tabulato resta com’era. Per correggere una seduta toccala.', 'warn'); return; }
    const r = el.getBoundingClientRect();
    const m = Math.floor((Number(el.getAttribute("data-min")) + (ev.clientY - r.top) / PX) / 5) * 5;
    const start = E.fromMin(Math.max(0, Math.min(m, 23 * 60 + 55)));
    if (A.ui.pd && A.modal && A.modal.drawer && A.ui.pd.th === th) { placeInPanel(day, start); return; }
    openPanel({ th, day, start });
  };
  FA.actions['swap-cancel'] = () => { A.ui.swap = null; FA.render(); };
  FA.actions['booked-ok'] = () => { A.ui.booked = null; FA.render(); };
  FA.views.calendario = { render: calendarView };

  FA.actions['cal-th'] = el => { const st = calState(A.params); if (A.ui.pt && Object.keys(A.ui.pt.drafts).length && !confirm('Ci sono modifiche in bozza non salvate per questo collega. Abbandonarle?')) { FA.render(); return; } FA.go('calendario', el.value, st.date, st.mode); };
  FA.actions['cal-date'] = el => { const st = calState(A.params); if (el.value) FA.go('calendario', st.th, el.value, st.mode); };
  FA.actions['cal-mode'] = el => FA.go('calendario', el.getAttribute('data-th'), el.getAttribute('data-date'), el.getAttribute('data-val'));
  FA.actions['pt-toggle'] = () => {
    if (A.ui.painting && A.ui.pt && Object.keys(A.ui.pt.drafts).length && !confirm('Ci sono modifiche in bozza non salvate. Uscire comunque? (la bozza resta finché non chiudi la pagina)')) return;
    A.ui.painting = !A.ui.painting; FA.render();
  };
  FA.actions['pt-brush'] = el => { A.ui.pt.brush = el.getAttribute('data-k'); FA.render(); };
  FA.actions['pt-discard'] = () => { if (confirm('Annullare tutte le modifiche in bozza?')) { A.ui.pt.drafts = {}; FA.render(); } };
  FA.actions['pt-effects-ok'] = () => { A.ui.pt.effects = null; FA.render(); };

  /* ---------------- disegno con il puntatore ---------------- */
  let drag = null;
  FA.gestureActive = () => !!drag || !!(mv && mv.moved);
  const snapM = (m, step) => Math.round(m / step) * step;
  /** minuto sotto il puntatore: si aggancia ai bordi delle fasce vicine (entro 6′), altrimenti alla griglia (15′, Alt = 5′) */
  function pointerMin(col, clientY, step, edges) {
    const r = col.getBoundingClientRect();
    const raw = Number(col.getAttribute('data-min')) + (clientY - r.top) / PX;
    let best = null;
    (edges || []).forEach(m => { if (Math.abs(m - raw) <= 6 && (best == null || Math.abs(m - raw) < Math.abs(best - raw))) best = m; });
    return Math.max(0, Math.min(24 * 60 - 1, best != null ? best : snapM(raw, step)));
  }
  function edgesOf(th, d, skipIdx) {
    const out = [];
    viewBlocks(th, d).forEach((b, i) => { if (i !== skipIdx) out.push(E.toMin(b.start), E.toMin(b.end)); });
    return out;
  }
  document.addEventListener('pointerdown', ev => {
    const col = ev.target.closest('.wk-col.paint');
    if (!col || ev.button !== 0 || ev.target.closest('.wk-appt')) return;
    const st = calState(A.params), d = col.getAttribute('data-day');
    const step = ev.altKey ? 5 : 15;
    const blkEl = ev.target.closest('[data-blk]');
    const idx = blkEl ? Number(blkEl.getAttribute('data-blk')) : null;
    const edges = edgesOf(st.th, d, idx);
    const m0 = pointerMin(col, ev.clientY, step, blkEl ? [] : edges);
    drag = { col, d, th: st.th, step, edges, m0, cur: m0, y0: ev.clientY, moved: false, mode: 'paint', idx, orig: null };
    if (blkEl) {
      const b = viewBlocks(st.th, d)[idx];
      drag.orig = toM(b);
      const handle = ev.target.classList.contains('h-top') ? 'top' : ev.target.classList.contains('h-bot') ? 'bot' : null;
      // pennello dello stesso tipo: sposta (o ridimensiona dai bordi); pennello di altro tipo: dipinge sopra
      const same = A.ui.pt.brush === b.kind;
      drag.mode = same ? (handle || 'move') : 'paint';
      if (drag.mode === 'paint') { drag.m0 = drag.cur = pointerMin(col, ev.clientY, step, edges); }
    }
    const g = document.createElement('div');
    g.className = 'wk-sel'; col.appendChild(g); drag.el = g;
    try { col.setPointerCapture(ev.pointerId); } catch (e) { /* facoltativo */ }
    ev.preventDefault();
    updateSel();
  });
  function dragRange(d) {
    if (d.mode === 'paint') return [Math.min(d.m0, d.cur), Math.max(d.m0, d.cur)];
    const o = d.orig, delta = d.cur - d.m0;
    if (d.mode === 'move') return [o.s + delta, o.e + delta];
    if (d.mode === 'top') return [Math.min(d.cur, o.e - d.step), o.e];
    return [o.s, Math.max(d.cur, o.s + d.step)];
  }
  function updateSel() {
    if (!drag || !drag.el) return;
    const [s, e] = dragRange(drag), min = Number(drag.col.getAttribute('data-min'));
    const kind = drag.mode === 'paint' ? A.ui.pt.brush : drag.orig.kind;
    drag.el.style.top = ((s - min) * PX) + 'px';
    drag.el.style.height = Math.max(4, (e - s) * PX) + 'px';
    drag.el.className = 'wk-sel k-' + kind;
    drag.el.textContent = (kind === 'gomma' ? 'Cancella ' : (E.BLOCK[kind] || '') + ' ') + E.fromMin(s) + '–' + E.fromMin(e);
  }
  document.addEventListener('pointermove', ev => {
    if (!drag) return;
    drag.cur = pointerMin(drag.col, ev.clientY, drag.step, drag.mode === 'move' ? [] : drag.edges);
    if (Math.abs(ev.clientY - drag.y0) > 4) drag.moved = true;
    updateSel();
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.el) d.el.remove();
    setTimeout(FA.flushPending, 0);
    const P = A.ui.pt;
    let blocks = viewBlocks(d.th, d.d);
    if (!d.moved) {
      if (d.idx != null) { openBlock(d.th, d.d, d.idx); return; }
      if (P.brush === 'gomma') return;
      const len = presets()[P.brush] || 30;
      const next = blocks.map(toM).filter(b => b.s > d.m0).map(b => b.s).sort((a, b) => a - b)[0];
      const e = Math.min(d.m0 + len, next || 24 * 60);
      if (e <= d.m0) return;
      P.drafts[d.d] = paintRange(blocks, P.brush, d.m0, e);
      FA.render(); return;
    }
    const [s, e] = dragRange(d);
    if (e - s < 5 || s < 0 || e > 24 * 60) return;
    if (d.mode === 'paint') P.drafts[d.d] = paintRange(blocks, P.brush === 'gomma' ? null : P.brush, s, e);
    else {
      blocks = paintRange(blocks, null, d.orig.s, d.orig.e);
      blocks = paintRange(blocks, d.orig.kind, s, e);
      if (d.orig.max != null) blocks.forEach(b => { if (b.kind === d.orig.kind && E.toMin(b.start) === s) b.max = d.orig.max; });
      P.drafts[d.d] = blocks;
    }
    FA.render();
  });

  /* ---------------- trascinamento di una seduta (cambio di giorno o di ora) ---------------- */
  let mv = null, swallowClick = false;
  document.addEventListener('pointerdown', ev => {
    if (painting() || ev.button !== 0) return;
    const el = ev.target.closest('.wk-appt.movable');
    if (!el || A.view !== 'calendario') return;
    const a = A.ctx.appt.get(el.getAttribute('data-id'));
    if (!a) return;
    const col = el.closest('.wk-col');
    const grab = Number(col.getAttribute('data-min')) + (ev.clientY - col.getBoundingClientRect().top) / PX - E.toMin(a.start_time);
    mv = { a, el, x0: ev.clientX, y0: ev.clientY, grab, moved: false, target: null };
  });
  document.addEventListener('pointermove', ev => {
    if (!mv) return;
    if (!mv.moved && Math.hypot(ev.clientX - mv.x0, ev.clientY - mv.y0) < 6) return;
    mv.moved = true;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const col = under && under.closest('.wk-col');
    if (!col) return;
    const a = mv.a, dur = E.toMin(a.end_time) - E.toMin(a.start_time);
    const m = Math.max(0, snapM(Number(col.getAttribute('data-min')) + (ev.clientY - col.getBoundingClientRect().top) / PX - mv.grab, 5));
    const day = col.getAttribute('data-day'), start = E.fromMin(m), end = E.fromMin(m + dur);
    const past = day < A.today && a.day >= A.today;
    const chk = past ? { msg: 'Una seduta futura non si sposta nel passato.' } : E.checkSlot(A.ctx, a.therapist_id, day, start, end, { patientId: a.patient_id, ignoreId: a.id, cycleId: a.cycle_id });
    mv.target = { day, start, chk };
    if (!mv.ghost || mv.ghost.parentNode !== col) { if (mv.ghost) mv.ghost.remove(); mv.ghost = document.createElement('div'); col.appendChild(mv.ghost); }
    mv.ghost.className = 'wk-ghost' + (chk ? (chk.code && !FA.isHardConflict(chk) ? ' warn' : ' bad') : '');
    mv.ghost.style.top = ((m - Number(col.getAttribute('data-min'))) * PX) + 'px';
    mv.ghost.style.height = Math.max(12, dur * PX - 1) + 'px';
    mv.ghost.innerHTML = (chk ? (chk.code && !FA.isHardConflict(chk) ? '⚠ ' : '✗ ') : '→ ') + esc(E.fmtItDay(day) + ' ' + start) + (chk ? '<br><span class="small">' + esc(chk.msg) + '</span>' : '');
    mv.el.classList.add('dragging');
    ev.preventDefault();
  });
  document.addEventListener('pointerup', async () => {
    if (!mv) return;
    const d = mv; mv = null;
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove('dragging');
    if (!d.moved) return; // semplice clic: si apre la seduta
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    const t = d.target, a = d.a;
    if (!t || (t.day === a.day && t.start === a.start_time)) return;
    let force = false;
    if (t.chk) {
      if (!t.chk.code || FA.isHardConflict(t.chk)) { FA.toast('✗ Non spostata: ' + t.chk.msg, 'bad'); return; }
      if (!confirm('Attenzione: ' + t.chk.msg + '\nSpostare comunque la seduta a ' + E.fmtItDay(t.day) + ' ' + t.start + '?')) return;
      force = true;
    }
    try {
      await FA.save('Seduta di ' + FA.patName(a.patient_id) + ' spostata a ' + E.fmtItDay(t.day) + ' ' + t.start,
        () => FA.rpc('edit_appointment', { p_id: a.id, p_version: a.version, p: { day: t.day, start: t.start, force } }));
    } catch (e) { /* già segnalato */ }
  });
  // dopo un trascinamento il clic non apre la finestra della seduta
  document.addEventListener('click', ev => { if (swallowClick && ev.target.closest('.wk-appt')) { ev.stopPropagation(); ev.preventDefault(); swallowClick = false; } }, true);

  /* ---------------- fascia: orari precisi, duplica, elimina ---------------- */
  function viewDays() {
    const st = calState(A.params);
    if (st.mode === 'giorno') return [st.date];
    const mon = E.addDays(st.date, 1 - E.weekday(st.date));
    return [0, 1, 2, 3, 4, 5].map(i => E.addDays(mon, i));
  }
  function openBlock(th, d, idx) {
    const b = viewBlocks(th, d)[idx];
    A.ui.bk1 = { th, d, idx, kind: b.kind, start: b.start, end: b.end, max: b.max == null ? '' : b.max, dup: [], orig: toM(b), error: null };
    FA.openModal({ title: (E.BLOCK[b.kind] || '') + ' · ' + FA.dayLabel(d),
      body() {
        const f = A.ui.bk1;
        return '<div class="grid3"><div class="field"><label>Tipo</label><select data-bind="bk1.kind">' + BRUSHES.map(([k, l]) => FA.option(k, l, f.kind)).join('') + '</select></div>' +
          '<div class="field"><label>Inizio</label>' + timeField('bk1.start', f.start) + '</div><div class="field"><label>Fine</label>' + timeField('bk1.end', f.end) + '</div></div>' +
          (f.kind === 'amb' ? '<div class="field" style="max-width:260px"><label>Massimo pazienti nella fascia (facoltativo)</label><input type="number" min="1" data-bind="bk1.max" value="' + esc(f.max) + '"></div>' : '') +
          '<div class="field"><label>Duplica anche su</label><div class="checks">' + viewDays().filter(x => x !== f.d).map(x => '<label><input type="checkbox" data-bind="bk1.dup" data-multi value="' + x + '"' + (f.dup.includes(x) ? ' checked' : '') + '> ' + esc(E.fmtItDay(x)) + '</label>').join('') + '</div></div>' +
          '<p class="small muted">Puoi scrivere 1220, 12.20 o 12:20. Le modifiche vanno in bozza: si salvano con “Salva…”.</p>' + FA.errBox(f.error);
      },
      foot: () => '<button class="btn danger" data-act="bk1-del">Elimina fascia</button><span class="grow"></span><button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="bk1-ok">Applica</button>' });
  }
  FA.actions['bk1-ok'] = () => {
    const f = A.ui.bk1, P = A.ui.pt;
    const s = FA.normTime(f.start), e = FA.normTime(f.end);
    if (!s || !e || e <= s) { f.error = 'Indica un orario di inizio e di fine validi (es. 12:20).'; FA.renderModal(); return; }
    let blocks = paintRange(viewBlocks(f.th, f.d), null, f.orig.s, f.orig.e);
    blocks = paintRange(blocks, f.kind, E.toMin(s), E.toMin(e));
    const mx = f.kind === 'amb' && f.max !== '' && f.max != null ? Number(f.max) : null;
    blocks.forEach(b => { if (b.kind === f.kind && b.start === s) b.max = mx; });
    P.drafts[f.d] = blocks;
    (f.dup || []).forEach(x => {
      const bl = paintRange(viewBlocks(f.th, x), f.kind, E.toMin(s), E.toMin(e));
      bl.forEach(b => { if (b.kind === f.kind && b.start === s) b.max = mx; });
      P.drafts[x] = bl;
    });
    FA.closeModal(); FA.render();
  };
  FA.actions['bk1-del'] = () => { const f = A.ui.bk1; A.ui.pt.drafts[f.d] = paintRange(viewBlocks(f.th, f.d), null, f.orig.s, f.orig.e); FA.closeModal(); FA.render(); };

  /* ---------------- giornata: copia, svuota, ripristina ---------------- */
  FA.actions['pt-day'] = el => {
    const d = el.getAttribute('data-day'), st = calState(A.params);
    A.ui.dy = { d, th: st.th, to: [] };
    FA.openModal({ title: 'Giornata di ' + FA.thName(st.th) + ' · ' + FA.dayLabel(d),
      body() {
        const f = A.ui.dy;
        const days = viewDays().filter(x => x !== f.d);
        return '<div class="field"><label>Copia questa giornata su</label><div class="checks">' + days.map(x => '<label><input type="checkbox" data-bind="dy.to" data-multi value="' + x + '"' + (f.to.includes(x) ? ' checked' : '') + '> ' + esc(E.fmtItDay(x)) + '</label>').join('') + '</div></div>' +
          '<p class="small muted">Per ripetere la giornata nelle settimane successive salva come “orario abituale da questa data in poi”.</p>';
      },
      foot: () => '<button class="btn danger" data-act="dy-clear">Svuota la giornata</button>' + (A.ui.pt.drafts[A.ui.dy.d] ? '<button class="btn" data-act="dy-reset">Ripristina come salvata</button>' : '') +
        '<span class="grow"></span><button class="btn" data-act="close-modal">Chiudi</button><button class="btn primary" data-act="dy-copy">Copia</button>' });
  };
  FA.actions['dy-copy'] = () => { const f = A.ui.dy, src = viewBlocks(f.th, f.d); f.to.forEach(x => { A.ui.pt.drafts[x] = src.map(b => Object.assign({}, b)); }); FA.closeModal(); FA.render(); };
  FA.actions['dy-clear'] = () => { A.ui.pt.drafts[A.ui.dy.d] = []; FA.closeModal(); FA.render(); };
  FA.actions['dy-reset'] = () => { delete A.ui.pt.drafts[A.ui.dy.d]; FA.closeModal(); FA.render(); };

  /* ---------------- durate rapide ---------------- */
  FA.actions['pt-presets'] = () => {
    A.ui.pp = presets();
    FA.openModal({ title: 'Durate rapide (clic con il pennello)',
      body: () => '<div class="grid3">' + BRUSHES.map(([k, l]) => '<div class="field"><label>' + esc(l) + ' (minuti)</label><input type="number" min="5" step="5" data-num data-bind="pp.' + k + '" value="' + A.ui.pp[k] + '"></div>').join('') + '</div>' +
        '<p class="small muted">Valgono su questo computer. Trascinando si sceglie sempre una durata libera.</p>',
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="pp-save">Salva</button>' });
  };
  FA.actions['pp-save'] = () => { try { localStorage.setItem('fa-preset', JSON.stringify(A.ui.pp)); } catch (e) { /* non disponibile */ } FA.closeModal(); FA.render(); };

  /* ---------------- schemi riutilizzabili ---------------- */
  FA.actions['pt-tpl-save'] = () => {
    const days = viewDays();
    A.ui.ts = { name: '', error: null };
    FA.openModal({ title: 'Salva la settimana visualizzata come schema',
      body: () => '<div class="field"><label>Nome dello schema</label><input type="text" data-bind="ts.name" value="' + esc(A.ui.ts.name) + '" placeholder="es. Ingresso 7 – solo ambulatorio"></div>' +
        '<p class="small muted">Lo schema contiene le fasce dei giorni ' + days.map(E.fmtItDay).join(', ') + ' così come le vedi (bozza compresa). Potrai applicarlo a qualunque collega da qualunque data.</p>' + FA.errBox(A.ui.ts.error),
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="ts-ok"' + FA.saveDisabled() + '>Salva schema</button>' });
  };
  FA.actions['ts-ok'] = async () => {
    const st = calState(A.params), f = A.ui.ts;
    if (!f.name.trim()) { f.error = 'Indica un nome.'; FA.renderModal(); return; }
    const week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    viewDays().forEach(d => { week[E.weekday(d)] = viewBlocks(st.th, d); });
    try { await FA.save('Schema salvato', () => FA.rpc('admin_save_template', { p_id: null, p_name: f.name, p_week: week, p_delete: false })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['pt-tpl-apply'] = () => {
    const list = A.data.shift_templates || [];
    A.ui.ta = { id: (list[0] || {}).id || '' };
    FA.openModal({ title: 'Applica uno schema alla settimana visualizzata',
      body: () => list.length ? '<div class="field"><label>Schema</label><select data-bind="ta.id">' + list.map(t => FA.option(t.id, t.name, A.ui.ta.id)).join('') + '</select></div>' +
        '<p class="small muted">Le fasce dello schema vanno in bozza sui giorni visualizzati: puoi ritoccarle e poi salvare (solo questi giorni, da questa data in poi o per un intervallo).</p>' +
        '<ul class="small">' + list.map(t => '<li>' + esc(t.name) + ' <button class="btn link" data-act="ta-del" data-id="' + t.id + '">elimina</button></li>').join('') + '</ul>'
        : '<p>Nessuno schema salvato. Disegna una settimana e usa “Salva come schema…”.</p>',
      foot: () => '<button class="btn" data-act="close-modal">Chiudi</button>' + (list.length ? '<button class="btn primary" data-act="ta-ok">Applica in bozza</button>' : '') });
  };
  FA.actions['ta-ok'] = () => {
    const t = (A.data.shift_templates || []).find(x => x.id === A.ui.ta.id);
    if (!t) return;
    viewDays().forEach(d => { A.ui.pt.drafts[d] = (t.week[String(E.weekday(d))] || []).map(b => ({ kind: b.kind, start: E.hhmm(b.start), end: E.hhmm(b.end), max: b.max == null ? null : b.max })); });
    FA.closeModal(); FA.render();
  };
  FA.actions['ta-del'] = async el => {
    if (!confirm('Eliminare lo schema?')) return;
    try { await FA.save('Schema eliminato', () => FA.rpc('admin_save_template', { p_id: el.getAttribute('data-id'), p_name: '', p_week: {}, p_delete: true })); FA.closeModal(); } catch (e) { /* segnalato */ }
  };

  /* ---------------- salvataggio della bozza ---------------- */
  FA.actions['pt-save'] = () => {
    const st = calState(A.params), P = A.ui.pt;
    const dates = Object.keys(P.drafts).sort();
    A.ui.sv = { scope: 'date', to: E.addDays(dates[dates.length - 1], 28), conf: null, error: null };
    FA.openModal({ title: 'Salva l’orario di ' + FA.thName(st.th), wide: true, sticky: true,
      body() {
        const f = A.ui.sv;
        const multi = new Set(dates.map(E.weekday)).size !== dates.length;
        return '<p>Giornate modificate: <strong>' + dates.map(E.fmtItDay).join(', ') + '</strong></p>' +
          '<div class="field"><label>Come applicare le modifiche</label>' + FA.seg('sv.scope', [['date', 'Solo queste date'], ['from', 'Orario abituale da ' + E.fmtIt(dates[0]) + ' in poi'], ['range', 'Per un periodo (dal … al …)']], f.scope) + '</div>' +
          (f.scope === 'range' ? '<div class="grid2" style="max-width:520px"><div class="field"><label>Dal</label><input type="date" value="' + dates[0] + '" disabled></div><div class="field"><label>Al (compreso)</label><input type="date" data-bind="sv.to" value="' + esc(f.to) + '" min="' + dates[dates.length - 1] + '"></div></div>' +
            '<p class="small muted">Dal giorno dopo torna automaticamente l’orario precedente.</p>' : '') +
          (f.scope !== 'date' ? '<p class="small muted">Ogni giorno modificato diventa il modello per lo stesso giorno della settimana; gli altri giorni restano come sono.' + (multi ? ' <strong>Attenzione:</strong> hai modificato più volte lo stesso giorno della settimana: vale l’ultima data.' : '') + ' Lo storico dei turni resta.</p>'
            : '<p class="small muted">Variazioni solo per queste date: l’orario abituale non cambia.</p>') +
          (f.conf ? conflictsList(f.conf) : '') + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Torna al calendario</button><button class="btn" data-act="sv-check"' + FA.saveDisabled() + '>Verifica</button>' +
        '<button class="btn primary" data-act="sv-ok"' + (A.ui.sv.conf ? FA.saveDisabled() : ' disabled title="Prima verifica"') + '>Salva</button>' });
  };
  function conflictsList(conf) {
    if (!conf.length) return '<div class="form-note">✓ Nessun appuntamento già prenotato diventa incompatibile.</div>';
    return '<div class="form-warn"><strong>' + conf.length + ' appuntamenti già prenotati non sarebbero più compatibili.</strong> Non vengono spostati: dopo il salvataggio li trovi elencati con il pulsante “Sposta”.<ul class="small">' +
      conf.map(c => '<li>' + esc(E.fmtItDay(c.day) + ' ' + E.hhmm(c.start_time) + ' · ' + c.patient) + ' — ' + esc(c.message) + '</li>').join('') + '</ul></div>';
  }
  document.addEventListener('change', ev => { if (ev.target.closest('[data-bind^="sv."]') && A.ui.sv) { A.ui.sv.conf = null; FA.renderModal(); } });
  async function saveCalls(dry) {
    const st = calState(A.params), P = A.ui.pt, f = A.ui.sv;
    const dates = Object.keys(P.drafts).sort();
    const clean = l => l.map(b => ({ kind: b.kind, start: E.hhmm(b.start), end: E.hhmm(b.end), max: b.max == null || b.max === '' ? null : Number(b.max) }));
    let conf = [];
    if (f.scope === 'date') {
      for (const d of dates) {
        const r = await FA.rpc('admin_set_day_override', { p_th: st.th, p_day: d, p_blocks: clean(P.drafts[d]), p_note: 'Dal calendario', p_dry_run: dry });
        conf = conf.concat(r.conflicts);
      }
      return conf;
    }
    const base = E.shiftFor(A.ctx, st.th, dates[0]);
    const week = {};
    [1, 2, 3, 4, 5, 6, 7].forEach(k => { week[k] = base ? clean((base.week[String(k)] || []).map(b => Object.assign({}, b))) : []; });
    dates.forEach(d => { week[E.weekday(d)] = clean(P.drafts[d]); });
    const r = f.scope === 'from'
      ? await FA.rpc('admin_save_shift', { p_th: st.th, p_valid_from: dates[0], p_week: week, p_note: 'Dal calendario', p_dry_run: dry })
      : await FA.rpc('admin_save_shift_range', { p_th: st.th, p_from: dates[0], p_to: f.to, p_week: week, p_note: 'Dal calendario (periodo)', p_dry_run: dry });
    return r.conflicts;
  }
  FA.actions['sv-check'] = async () => {
    const f = A.ui.sv; f.error = null;
    try { f.conf = await saveCalls(true); } catch (e) { f.error = e.message; f.conf = null; }
    FA.renderModal();
  };
  FA.actions['sv-ok'] = async () => {
    const f = A.ui.sv;
    try {
      let conf = [];
      await FA.save('Orario salvato', async () => { conf = await saveCalls(false); });
      A.ui.pt.drafts = {}; A.ui.pt.effects = conf;
      FA.closeModal(); FA.render();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- «Nuovo» dal tabulato: paziente, attività, ferie / permesso ---------------- */
  const ACTS = [['amb', 'Ambulatorio (posti per pazienti)'], ['pausa', 'Pausa'], ['reparto', 'Reparto'], ['ortesi', 'Ambulatorio ortesi'], ['gruppo', 'Gruppo'], ['progetto', 'Progetto'],
    ['segreteria', 'Segreteria'], ['documentazione', 'Cartelle / adempimenti'], ['corso', 'Corso'], ['briefing', 'Briefing'], ['recupero_ore', 'Recupero ore'], ['altro', 'Altro']];
  /** orario sotto il puntatore dentro uno spazio libero (a passi di 5 minuti), senza uscire dallo spazio */
  function clickedStart(el, ev) {
    const g0 = E.toMin(el.getAttribute('data-start')), g1 = E.toMin(el.getAttribute('data-end') || el.getAttribute('data-start'));
    if (!ev || ev.clientY == null) return E.fromMin(g0);
    const r = el.getBoundingClientRect();
    let m = g0 + Math.floor(((ev.clientY - r.top) / PX) / 5) * 5;
    m = Math.max(g0, Math.min(m, Math.max(g0, g1 - 10)));
    return E.fromMin(m);
  }
  FA.actions['pd-open'] = (el, ev) => {
    const th = el.getAttribute('data-th'), day = el.getAttribute('data-day'), start = clickedStart(el, ev);
    if (A.ui.swap) return;
    if (A.ui.pd && A.modal && A.modal.drawer && A.ui.pd.th === th) { placeInPanel(day, start); return; }
    openPanel({ th, day, start });
  };
  /** pannello già aperto: il tocco sul tabulato sceglie giorno e ora */
  function placeInPanel(day, start) {
    const f = A.ui.pd;
    if (f.kind === 'attivita') { f.day = day; f.act.start = start; f.act.end = E.fromMin(E.toMin(start) + (presets()[f.act.kind] || 30)); }
    else if (f.kind === 'assenza') { f.day = day; f.ab.start = start; f.ab.to = day < f.ab.to ? f.ab.to : day; }
    else if (pdSingle(f)) { f.day = day; f.start = start; }
    else {
      const wd = E.weekday(day);
      if (!f.days.includes(wd)) f.days = f.days.concat([wd]).sort();
      if (start !== f.start) { if (f.days.length === 1) f.start = start; else { f.perDay = true; f.times[wd] = start; } }
      if (day < f.day) f.day = day;
    }
    pdCompute(); FA.render(); FA.renderModal();
  }
  /** "+ Paziente": fisioterapista e giorno del tabulato aperto, primo orario libero */
  FA.actions['pd-add'] = el => {
    const th = el.getAttribute('data-th');
    let day = el.getAttribute('data-day'); if (day < A.today) day = A.today;
    openPanel({ th, day, start: E.freeStarts(A.ctx, th, day, 30, {})[0] || '' });
  };
  function openPanel(o) {
    const th = o.th, day = o.day, start = o.start || '';
    const cats = FA.categories().filter(c => E.skillLevel(A.ctx, th, c.id));
    const inAmb = E.dayBlocks(A.ctx, th, day).some(b => b.kind === 'amb' && E.toMin(b.start) <= E.toMin(start || '00:00') && E.toMin(b.end) > E.toMin(start || '00:00'));
    A.ui.pd = { th, day, start, kind: o.kind || (start && !inAmb && E.dayBlocks(A.ctx, th, day).length ? 'attivita' : 'paziente'), mode: o.mode || 'nuovo', q: '', name: '', cycle_id: '', patient_id: '',
      category_id: (cats.find(c => c.id === 'mano') || cats[0] || {}).id || '', dur: '30', durOther: '', left: 10, planned: '', more: false, perDay: false,
      treatment: '', addN: '1', days: [E.weekday(day)], times: {}, priority: 'NI', slots: [], error: null, force: false,
      act: { kind: 'pausa', start, end: start ? E.fromMin(E.toMin(start) + 30) : '', scope: 'giorno', label: '' },
      ab: { kind: 'permesso', allDay: false, start, end: start ? E.fromMin(E.toMin(start) + 60) : '', to: day, note: '' } };
    if (o.patient_id) pickPatient(A.ui.pd, o.patient_id);
    if (o.name) A.ui.pd.q = o.name;
    if (o.addAll) A.ui.pd.addN = 'tutte';
    pdCompute();
    FA.openModal({ title: 'Nuovo', drawer: true, live: true, body: pdBody, foot: pdFoot });
    FA.render();
  }
  FA.openPanel = openPanel;
  function pdFoot() {
    const f = A.ui.pd;
    const label = f.kind === 'attivita' ? 'Inserisci l’attività' : f.kind === 'assenza' ? 'Registra' : f.slots.length > 1 ? 'Inserisci le ' + f.slots.length + ' sedute' : 'Inserisci';
    return '<button class="btn" data-act="pd-close">Chiudi</button><button class="btn primary" data-act="pd-save"' + (f.okAll ? FA.saveDisabled() : ' disabled') + '>' + (A.saving ? 'Salvataggio…' : label) + '</button>';
  }
  /** ciclo già esistente da completare: dalla lista d'attesa oppure il ciclo in corso del paziente scelto */
  function pdCycle(f) {
    if (f.mode === 'attesa' && f.cycle_id) return A.ctx.cyc.get(f.cycle_id) || null;
    if (f.patient_id) return activeCycleOf(f.patient_id);
    return null;
  }
  function activeCycleOf(pid) { return (A.data.cycles || []).find(c => c.patient_id === pid && c.status === 'attivo') || null; }
  function pdDur(f) { return f.dur === 'altro' ? Number(f.durOther) || 0 : Number(f.dur); }
  const timeOf = (f, wd) => FA.normTime(f.perDay && f.times[wd] ? f.times[wd] : f.start);
  function pdCompute() {
    const f = A.ui.pd, ctx = A.ctx;
    if (f.kind === 'attivita') return actCompute(f);
    if (f.kind === 'assenza') return absCompute(f);
    const c = pdCycle(f);
    const active = c && c.status === 'attivo';
    let planned, prior;
    if (active) { planned = c.planned_sessions; prior = planned - E.cycleCounts(ctx, c.id).mancanoDaProgrammare; }
    else if (c) { planned = c.planned_sessions; prior = c.prior_sessions || 0; }
    else {
      // paziente nuovo o senza ciclo in corso: si scrivono le sedute che restano (anche a metà ciclo)
      const left = Math.max(1, Math.min(60, Number(f.left) || 0));
      planned = Math.max(left, Number(f.planned) || left);
      prior = planned - left;
    }
    const dur = pdDur(f);
    const missing = planned - prior;
    const n = active ? (f.addN === 'tutte' ? missing : 1) : missing;
    const slots = [];
    const chkOf = (d, st, en) => E.checkSlot(ctx, f.th, d, st, en, { patientId: c ? c.patient_id : (f.patient_id || null), cycleId: c ? c.id : null }) ||
      (d < A.today ? { code: 'passato', msg: 'Data già passata.' } : null);
    if (pdSingle(f)) {
      // una seduta nel giorno e all'ora scelti (anche diversi dai giorni abituali del ciclo)
      const st = FA.normTime(f.start);
      if (st && dur >= 10 && n === 1) { const en = E.fromMin(E.toMin(st) + dur); slots.push({ day: f.day, start: st, end: en, n: prior + 1, chk: chkOf(f.day, st, en) }); }
    } else if (dur >= 10 && f.days.length) {
      let d = f.day, guard = 0;
      while (slots.length < n && guard++ < 500) {
        const wd = E.weekday(d);
        if (f.days.includes(wd) && !ctx.closures.has(d)) {
          const st = timeOf(f, wd);
          if (st) { const en = E.fromMin(E.toMin(st) + dur); slots.push({ day: d, start: st, end: en, n: prior + slots.length + 1, chk: chkOf(d, st, en) }); }
        }
        d = E.addDays(d, 1);
      }
    }
    f.slots = slots; f.prior = prior; f.planned2 = planned;
    // le sovrapposizioni bloccano; gli avvisi organizzativi (fuori orario, assenza…) si confermano
    f.hard = slots.filter(s => s.chk && FA.isHardConflict(s.chk)).length;
    f.warn = slots.filter(s => s.chk && !FA.isHardConflict(s.chk)).length;
    const who = f.mode === 'attesa' ? !!f.cycle_id : f.patient_id ? true : !!f.q.trim();
    f.okAll = slots.length === n && n > 0 && !f.hard && (!f.warn || !!f.force) && who && (!!c || !!f.category_id) && dur >= 10 && dur <= 240 && dur % 5 === 0;
  }
  /** paziente già in trattamento a cui si aggiunge una sola seduta */
  function pdSingle(f) { const c = pdCycle(f); return !!(c && c.status === 'attivo' && f.addN !== 'tutte'); }
  function actCompute(f) {
    const s = FA.normTime(f.act.start), e = FA.normTime(f.act.end);
    f.slots = [];
    f.actOk = !!(s && e && E.toMin(e) > E.toMin(s));
    // sedute già in agenda che la nuova attività coprirebbe (restano dove sono, da ricollocare)
    const days = f.act.scope === 'giorno' ? [f.day] : [...new Set((A.data.appointments || []).filter(a => a.therapist_id === f.th && a.day >= f.day && E.weekday(a.day) === E.weekday(f.day)).map(a => a.day))];
    f.actHits = !f.actOk || f.act.kind === 'amb' ? [] : (A.data.appointments || []).filter(a => a.therapist_id === f.th && days.includes(a.day) && E.OCCUPYING.has(a.status) &&
      E.toMin(a.start_time) < E.toMin(e) && E.toMin(a.end_time) > E.toMin(s));
    f.okAll = f.actOk && (!f.actHits.length || !!f.force);
  }
  function absCompute(f) {
    const ab = f.ab;
    const s = FA.normTime(ab.start), e = FA.normTime(ab.end);
    f.slots = [];
    const timesOk = ab.allDay || (s && e && E.toMin(e) > E.toMin(s));
    const fake = { therapist_id: f.th, start_date: f.day, end_date: ab.to || f.day, start_time: ab.allDay ? null : s, end_time: ab.allDay ? null : e };
    f.absHits = timesOk && (ab.to || f.day) >= f.day ? E.affectedByAbsence(A.ctx, fake) : [];
    f.okAll = !!timesOk && (ab.to || f.day) >= f.day;
  }
  function pdBody() {
    const f = A.ui.pd;
    pdCompute();
    const ths = FA.activeTherapists().filter(t => FA.canEditTh(t.id));
    const head = '<div class="grid2"><div class="field"><label>Fisioterapista</label><select data-bind="pd.th" data-on="pd-th">' + ths.map(t => FA.option(t.id, t.name, f.th)).join('') + '</select></div>' +
      '<div class="field"><label>' + (f.kind === 'paziente' && !pdSingle(f) ? 'Dal giorno' : 'Giorno') + '</label><input type="date" min="' + A.today + '" data-bind="pd.day" data-on="pd-chg" value="' + esc(f.day) + '"></div></div>';
    const tabs = FA.seg('pd.kind', [['paziente', 'Paziente'], ['attivita', 'Attività'], ['assenza', 'Ferie / permesso']], f.kind);
    return tabs + head + (f.kind === 'attivita' ? actBody(f) : f.kind === 'assenza' ? absBody(f) : patBody(f)) + FA.errBox(f.error);
  }
  const durSeg = (path, cur, other, otherPath) => FA.seg(path, [['30', '30 min'], ['45', '45 min'], ['60', '1 ora'], ['altro', 'Altro']], cur) +
    (cur === 'altro' ? ' <input type="number" min="10" max="240" step="5" style="max-width:100px;display:inline-block" data-bind="' + otherPath + '" data-on="pd-chg" value="' + esc(other) + '" placeholder="minuti">' : '');
  function patBody(f) {
    const ctx = A.ctx;
    const c = pdCycle(f);
    const sel = f.patient_id ? A.ctx.pat.get(f.patient_id) : null;
    let who;
    if (f.mode === 'attesa') {
      const waiting = (A.data.cycles || []).filter(x => x.status === 'in_attesa' && E.skillLevel(ctx, f.th, x.category_id));
      who = '<div class="field"><label>Dalla lista d’attesa</label><select data-bind="pd.cycle_id" data-on="pd-chg"><option value="">— scegli —</option>' + waiting.map(w => FA.option(w.id, '[' + w.priority + '] ' + FA.patName(w.patient_id) + ' · ' + FA.catName(w.category_id) + ' · ' + w.duration + '′ × ' + w.planned_sessions, f.cycle_id)).join('') + '</select>' +
        '<button class="btn link small" data-act="pd-mode" data-m="nuovo">← scrivi un nome</button></div>';
    } else if (sel) {
      who = '<div class="field"><label>Paziente</label><div class="row"><strong>' + esc(sel.name) + '</strong><button class="btn link small" data-act="pd-pick" data-id="">cambia</button></div>';
      if (c) {
        const k = E.cycleCounts(ctx, c.id), left = c.planned_sessions - k.effettuate;
        who += '<div class="form-note small">In trattamento' + (c.therapist_id !== f.th ? ' con <strong>' + esc(FA.thName(c.therapist_id)) + '</strong> (qui come sostituzione)' : '') + ': effettuate <strong>' + k.effettuate + '</strong> su ' + c.planned_sessions +
          ', ne <strong>restano ' + left + '</strong>' + (k.programmate ? ' (' + k.programmate + ' già in agenda)' : '') + '. Stesso ciclo, stessa numerazione: nessun doppione.' +
          (!k.mancanoDaProgrammare ? ' Tutte le sedute sono già in agenda: questa sarà <strong>una seduta in più</strong> (il ciclo passa a ' + (c.planned_sessions + 1) + ').' : '') + '</div>';
      } else who += '<div class="help">In archivio, nessun ciclo in corso: si apre un nuovo ciclo.</div>';
      who += '</div>';
    } else {
      const qn = window.FASheet.normName(f.q);
      const found = qn.length >= 2 ? (A.data.patients || []).filter(p => window.FASheet.normName(p.name).includes(qn)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6) : [];
      who = '<div class="field"><label>Paziente</label><input type="text" data-bind="pd.q" data-pd-search value="' + esc(f.q) + '" placeholder="Cognome e nome (fittizio) — cerca anche in archivio" autocomplete="off">' +
        (found.length ? '<div class="pd-found">' + found.map(p => { const ac = activeCycleOf(p.id); const k = ac ? E.cycleCounts(ctx, ac.id) : null;
          return '<button class="btn small" data-act="pd-pick" data-id="' + p.id + '">' + esc(p.name) + (ac ? ' · in trattamento con ' + esc(FA.thName(ac.therapist_id)) + ' · restano ' + (ac.planned_sessions - k.effettuate) : ' · in archivio') + '</button>'; }).join('') + '</div>' : '') +
        (f.q.trim() ? '<div class="help">' + (found.length ? 'Se non è nessuno di questi: ' : '') + 'paziente <strong>nuovo</strong> «' + esc(f.q.trim()) + '».</div>' : '') +
        '</div>';
    }
    const active = c && c.status === 'attivo';
    const miss = active ? E.cycleCounts(ctx, c.id).mancanoDaProgrammare : 0;
    const single = pdSingle(f);
    let h = who;
    if (active && miss > 1) h += '<div class="field"><label>Cosa aggiungere</label>' + FA.seg('pd.addN', [['1', 'Una seduta'], ['tutte', 'Tutte le ' + miss + ' da programmare']], f.addN) + '</div>';
    h += '<div class="grid2"><div class="field"><label>Ora</label>' + timeField('pd.start', f.start, ' data-on="pd-chg" style="max-width:100px"') + '<div class="help">Scrivila come vuoi: 12:20, 12.20, 1220.</div></div>' +
      '<div class="field"><label>Durata</label>' + durSeg('pd.dur', f.dur, f.durOther, 'pd.durOther') + '</div></div>';
    if (!single) {
      h += '<div class="field"><label>Giorni</label><div class="days-times">' + [1, 2, 3, 4, 5, 6].map(wd => {
        const on = f.days.includes(wd);
        return '<div class="dt' + (on ? ' on' : '') + '"><button class="btn small ' + (on ? 'primary' : '') + '" data-act="pd-day" data-wd="' + wd + '">' + E.WD_SHORT[wd] + '</button>' +
          (on && f.perDay ? timeField('pd.times.' + wd, f.times[wd] || f.start, ' data-on="pd-chg" style="max-width:80px"') : '') + '</div>';
      }).join('') + '</div><label class="inline-check small"><input type="checkbox" data-bind="pd.perDay" data-on="pd-chg"' + (f.perDay ? ' checked' : '') + '> Orari diversi nei vari giorni</label></div>';
      if (!c) h += '<div class="field"><label>Sedute rimanenti</label><input type="number" min="1" max="60" style="max-width:90px" data-bind="pd.left" data-num data-on="pd-chg" value="' + esc(f.left) + '">' +
        '<div class="help">Conto alla rovescia: la prima seduta porta il numero ' + Math.max(1, Number(f.left) || 1) + ', l’ultima 1. Per un paziente a metà ciclo scrivi quante ne restano.</div></div>';
    }
    if (!c) {
      const cats = FA.categories().filter(x => E.skillLevel(ctx, f.th, x.id));
      h += '<button class="btn link small" data-act="pd-more">' + (f.more ? '▾ Meno dettagli' : '▸ Altri dettagli (percorso, totale del ciclo, priorità, tipo)') + '</button>' +
        (f.more ? '<div class="pd-more"><div class="grid2"><div class="field"><label>Percorso</label><select data-bind="pd.category_id" data-on="pd-chg">' + cats.map(x => FA.option(x.id, x.name, f.category_id)).join('') + '</select></div>' +
          '<div class="field"><label>Sedute totali del ciclo</label><input type="number" min="1" max="60" style="max-width:90px" data-bind="pd.planned" data-on="pd-chg" value="' + esc(f.planned) + '" placeholder="' + esc(f.left) + '">' +
            '<div class="help">Solo se il ciclo è già iniziato: es. 10 totali con 4 rimanenti = 6 già fatte.</div></div>' +
          '<div class="field"><label>Priorità</label><select data-bind="pd.priority">' + E.PRIORITY_ORDER.map(p => FA.option(p, E.PRIORITY[p], f.priority)).join('') + '</select></div>' +
          '<div class="field"><label>Tipo di trattamento</label><input type="text" data-bind="pd.treatment" value="' + esc(f.treatment) + '" placeholder="es. GC, RM"></div></div></div>' : '');
    }
    const bad = f.slots.filter(s => s.chk);
    const total = f.planned2;
    return h + '<h4>Anteprima (' + f.slots.length + (f.slots.length === 1 ? ' seduta' : ' sedute dal ' + E.fmtIt(f.day)) + ')</h4>' +
      (f.hard ? '<div class="form-error">✗ ' + (f.hard === 1 ? 'Una seduta si sovrappone a un altro appuntamento' : f.hard + ' sedute si sovrappongono ad altri appuntamenti') + ' (vedi sotto): cambia orario, giorno o fisioterapista. Quello che hai scritto resta qui.</div>'
        : f.warn ? '<div class="form-warn">⚠ ' + (f.warn === 1 && f.slots.length === 1 ? esc(bad[0].chk.msg) : f.warn + ' sedute con avvisi (vedi sotto).') +
          '<label class="inline-check" style="margin-top:4px"><input type="checkbox" data-bind="pd.force" data-on="pd-chg"' + (f.force ? ' checked' : '') + '> Confermo: inserisci comunque (comparirà in «Da sistemare»)</label></div>'
        : f.slots.length ? '<div class="form-note">✓ ' + (f.slots.length === 1 ? 'Posto libero' : 'Tutti i posti liberi') + '. Le vedi tratteggiate sul tabulato; restano <strong>programmate</strong> finché non registri «effettuata».</div>' : '') +
      '<ul class="small pd-list">' + f.slots.map(s => '<li class="' + (s.chk ? (FA.isHardConflict(s.chk) ? 'bad' : 'warn') : '') + '">' + (s.chk ? (FA.isHardConflict(s.chk) ? '✗ ' : '⚠ ') : '✓ ') +
        '<span class="cnt">' + (total + 1 - s.n) + '</span> ' + esc(E.fmtItDay(s.day)) + ' ' + s.start + '–' + s.end + (s.chk ? ' — ' + esc(s.chk.msg) : '') + '</li>').join('') + '</ul>';
  }
  function actBody(f) {
    const a = f.act;
    const wd = E.WD_LONG[E.weekday(f.day)];
    return '<div class="field"><label>Attività</label><select data-bind="pd.act.kind" data-on="pd-actkind">' + ACTS.map(([k, l]) => FA.option(k, l, a.kind)).join('') + '</select>' +
      (a.kind !== 'amb' ? '<input type="text" data-bind="pd.act.label" value="' + esc(a.label || '') + '" placeholder="nome (facoltativo): es. Gruppo schiena" style="margin-top:4px">' : '') + '</div>' +
      '<div class="grid2"><div class="field"><label>Dalle</label>' + timeField('pd.act.start', a.start, ' data-on="pd-chg" style="max-width:100px"') + '</div>' +
      '<div class="field"><label>Alle</label>' + timeField('pd.act.end', a.end, ' data-on="pd-chg" style="max-width:100px"') + '</div></div>' +
      '<div class="field"><label>Vale</label>' + FA.seg('pd.act.scope', [['giorno', 'Solo ' + E.fmtItDay(f.day)], ['sempre', 'Ogni ' + wd + ' da questa data']], a.scope) +
      '<div class="help">' + (a.scope === 'giorno' ? 'Eccezione di un giorno: la settimana tipo non cambia.' : 'Diventa parte della settimana tipo dal ' + E.fmtIt(f.day) + ': il passato non cambia.') + '</div></div>' +
      (!f.actOk ? '<div class="form-warn small">Indica un orario valido (la fine dopo l’inizio).</div>' :
        f.actHits.length ? '<div class="form-warn">⚠ ' + f.actHits.length + (f.actHits.length === 1 ? ' paziente è' : ' pazienti sono') + ' già in agenda in quell’orario: ' + esc(f.actHits.slice(0, 6).map(x => E.fmtItDay(x.day) + ' ' + x.start_time + ' ' + FA.patName(x.patient_id)).join(', ')) + (f.actHits.length > 6 ? '…' : '') +
          '. Non vengono cancellati: restano da ricollocare in «Da sistemare».<label class="inline-check" style="margin-top:4px"><input type="checkbox" data-bind="pd.force" data-on="pd-chg"' + (f.force ? ' checked' : '') + '> Confermo</label></div>'
        : '<div class="form-note small">✓ Nessun paziente coinvolto.</div>');
  }
  function absBody(f) {
    const a = f.ab;
    return '<div class="field"><label>Tipo</label>' + FA.seg('pd.ab.kind', Object.entries(E.ABSENCE_KIND), a.kind) + '</div>' +
      '<label class="inline-check"><input type="checkbox" data-bind="pd.ab.allDay" data-on="pd-chg"' + (a.allDay ? ' checked' : '') + '> Tutta la giornata</label>' +
      (a.allDay ? '' : '<div class="grid2"><div class="field"><label>Dalle</label>' + timeField('pd.ab.start', a.start, ' data-on="pd-chg" style="max-width:100px"') + '</div>' +
        '<div class="field"><label>Alle</label>' + timeField('pd.ab.end', a.end, ' data-on="pd-chg" style="max-width:100px"') + '</div></div>') +
      '<div class="field"><label>Fino al (compreso)</label><input type="date" data-bind="pd.ab.to" data-on="pd-chg" value="' + esc(a.to) + '" min="' + esc(f.day) + '" style="max-width:180px"></div>' +
      '<div class="field"><label>Nota (facoltativa)</label><input type="text" data-bind="pd.ab.note" value="' + esc(a.note) + '"></div>' +
      (f.absHits.length ? '<div class="form-warn">' + f.absHits.length + (f.absHits.length === 1 ? ' paziente da ricollocare' : ' pazienti da ricollocare') + ': ' + esc(f.absHits.slice(0, 6).map(x => E.fmtItDay(x.day) + ' ' + x.start_time + ' ' + FA.patName(x.patient_id)).join(', ')) + (f.absHits.length > 6 ? '…' : '') +
        '. Dopo la registrazione ti propongo i colleghi disponibili.</div>' : '<div class="form-note small">Nessun paziente in agenda in quel periodo.</div>');
  }
  FA.actions['pd-chg'] = () => { pdCompute(); FA.render(); FA.renderModal(); };
  FA.actions['pd-actkind'] = () => { const f = A.ui.pd, s = FA.normTime(f.act.start); if (s) f.act.end = E.fromMin(E.toMin(s) + (presets()[f.act.kind] || 30)); pdCompute(); FA.render(); FA.renderModal(); };
  FA.actions['pd-more'] = () => { A.ui.pd.more = !A.ui.pd.more; FA.renderModal(); };
  FA.actions['pd-mode'] = el => { const f = A.ui.pd; f.mode = el.getAttribute('data-m'); f.cycle_id = ''; f.patient_id = ''; pdCompute(); FA.render(); FA.renderModal(); };
  // ricerca nell'archivio mentre si scrive il nome
  let searchT = null;
  document.addEventListener('input', ev => {
    if (!ev.target.hasAttribute || !ev.target.hasAttribute('data-pd-search')) return;
    clearTimeout(searchT); searchT = setTimeout(() => { if (A.ui.pd) { pdCompute(); FA.renderModal(); } }, 120);
  });
  function pickPatient(f, id) {
    f.patient_id = id; f.mode = 'nuovo';
    if (!id) { f.q = ''; return; }
    const c = activeCycleOf(id);
    if (c) {
      f.dur = [30, 45, 60].includes(c.duration) ? String(c.duration) : 'altro'; f.durOther = String(c.duration);
      const w = Object.keys(c.weekday_times || {}).map(Number).filter(x => x <= 6);
      if (w.length) { f.days = w.sort(); const t = c.weekday_times[String(E.weekday(f.day))]; if (t && !f.start) f.start = E.hhmm(t); }
    }
  }
  FA.actions['pd-pick'] = el => { pickPatient(A.ui.pd, el.getAttribute('data-id')); pdCompute(); FA.render(); FA.renderModal(); };
  FA.actions['pd-th'] = () => {
    const f = A.ui.pd;
    const cats = FA.categories().filter(c => E.skillLevel(A.ctx, f.th, c.id));
    if (!cats.some(c => c.id === f.category_id)) f.category_id = (cats[0] || {}).id || '';
    // il tabulato segue il fisioterapista scelto, così l'anteprima resta visibile
    const st = calState(A.params);
    if (A.view === 'calendario' && st.th !== f.th) { FA.go('calendario', f.th, f.day, st.mode === 'mese' ? 'settimana' : st.mode); }
    pdCompute(); FA.render(); FA.renderModal();
  };
  FA.actions['pd-day'] = el => {
    const f = A.ui.pd, wd = Number(el.getAttribute('data-wd'));
    if (f.days.includes(wd)) { if (f.days.length > 1) f.days = f.days.filter(x => x !== wd); }
    else f.days = f.days.concat([wd]).sort();
    pdCompute(); FA.render(); FA.renderModal();
  };
  FA.actions['pd-close'] = () => { A.ui.pd = null; FA.closeModal(); FA.render(); };
  FA.actions['pd-save'] = async () => {
    const f = A.ui.pd;
    pdCompute();
    if (!f.okAll) return;
    try {
      if (f.kind === 'attivita') return await saveActivity(f);
      if (f.kind === 'assenza') return await saveAbsence(f);
      const act = pdCycle(f);
      const dur = pdDur(f);
      if (act && act.status === 'attivo') {
        // paziente già in trattamento: si aggiungono le sedute al suo ciclo (stessa numerazione)
        await FA.save('Sedute aggiunte', () => FA.rpc('add_cycle_slots', { p_cycle: act.id, p_version: act.version, p_therapist: f.th,
          p_slots: f.slots.map(s => ({ day: s.day, start: s.start, minutes: dur })), p_force: !!f.force }));
        A.ui.pd = null; FA.closeModal(); FA.render(); return;
      }
      let cycleId = f.cycle_id, version;
      if (f.mode !== 'attesa') {
        const r = await FA.save('Paziente e ciclo', () => FA.rpc('create_request', { p: { patient_name: f.q.trim(), patient_id: f.patient_id || null, category_id: f.category_id, priority: f.priority,
          request_type: f.prior > 0 ? 'continuazione' : 'prima', duration: dur, planned_sessions: f.planned2, prior_sessions: f.prior, weekdays: f.days } }));
        cycleId = r.cycle_id; version = 1; f.mode = 'attesa'; f.cycle_id = cycleId;
        if (f.treatment.trim()) { await FA.rpc('quick_edit_cycle', { p_cycle: cycleId, p_version: 1, p: { treatment: f.treatment.trim().toUpperCase() } }); version = 2; }
      } else version = A.ctx.cyc.get(cycleId).version;
      await FA.save('Sedute programmate', () => FA.rpc('book_cycle_slots', { p_cycle: cycleId, p_version: version, p_therapist: f.th,
        p_slots: f.slots.map(s => ({ day: s.day, start: s.start })), p_weekdays: f.days, p_force: !!f.force }));
      A.ui.pd = null; FA.closeModal(); FA.render();
    } catch (e) {
      f.error = e.message + (f.kind === 'paziente' && f.cycle_id ? ' Il paziente è comunque in lista d’attesa: puoi riprovare.' : '');
      pdCompute(); FA.render(); FA.renderModal();
    }
  };
  const cleanBlocks = l => l.map(b => ({ kind: b.kind, start: E.hhmm(b.start), end: E.hhmm(b.end), max: b.max == null || b.max === '' ? null : Number(b.max), label: b.label || '' }));
  async function saveActivity(f) {
    const a = f.act, s = FA.normTime(a.start), e = FA.normTime(a.end);
    let conf = [];
    if (a.scope === 'giorno') {
      const blocks = cleanBlocks(paintRange(E.dayBlocks(A.ctx, f.th, f.day), a.kind, E.toMin(s), E.toMin(e), (a.label || '').trim()));
      await FA.save(E.BLOCK[a.kind] + ' inserito', async () => { conf = (await FA.rpc('admin_set_day_override', { p_th: f.th, p_day: f.day, p_blocks: blocks, p_note: 'Dal tabulato', p_dry_run: false })).conflicts; });
    } else {
      const base = E.shiftFor(A.ctx, f.th, f.day), wd = E.weekday(f.day), week = {};
      [1, 2, 3, 4, 5, 6, 7].forEach(k => { week[k] = cleanBlocks(base ? (base.week[String(k)] || []) : []); });
      week[wd] = cleanBlocks(paintRange(week[wd], a.kind, E.toMin(s), E.toMin(e), (a.label || '').trim()));
      await FA.save(E.BLOCK[a.kind] + ' nella settimana tipo', async () => { conf = (await FA.rpc('admin_save_shift', { p_th: f.th, p_valid_from: f.day, p_week: week, p_note: 'Dal tabulato', p_dry_run: false })).conflicts; });
    }
    pt(f.th).effects = conf;
    A.ui.pd = null; FA.closeModal(); FA.render();
  }
  async function saveAbsence(f) {
    const a = f.ab;
    const p = { therapist_id: f.th, kind: a.kind, start_date: f.day, end_date: a.to || f.day, note: a.note || '' };
    if (!a.allDay) { p.start_time = FA.normTime(a.start); p.end_time = FA.normTime(a.end); }
    const n = f.absHits.length;
    const abs = await FA.save(E.ABSENCE_KIND[a.kind] + ' registrata', () => FA.rpc('save_absence', { p }));
    A.ui.pd = null; FA.closeModal(); FA.render();
    if (n && abs && abs.id) FA.go('assenze', 'piano', abs.id);
  }
  /* ---------------- pazienti in trattamento (dal calendario) ---------------- */
  FA.actions['pl-open'] = el => {
    A.ui.pl = { th: el.getAttribute('data-th'), day: el.getAttribute('data-day'), all: false, q: '' };
    FA.openModal({ title: 'Pazienti in trattamento', drawer: true, live: true, body: plBody, foot: () => '<button class="btn" data-act="close-modal">Chiudi</button>' });
  };
  function plBody() {
    const f = A.ui.pl, ctx = A.ctx;
    const q = window.FASheet.normName(f.q);
    const list = (A.data.cycles || []).filter(c => c.status === 'attivo' && (f.all || c.therapist_id === f.th) && (!q || window.FASheet.normName(FA.patName(c.patient_id)).includes(q)))
      .sort((a, b) => FA.patName(a.patient_id).localeCompare(FA.patName(b.patient_id)));
    const next = c => (ctx.byCycle.get(c.id) || []).find(a => a.status === 'programmata' && a.day >= A.today);
    return '<div class="row"><label class="inline-check small"><input type="checkbox" data-bind="pl.all" data-rerender' + (f.all ? ' checked' : '') + '> Tutti i fisioterapisti</label></div>' +
      '<div class="field" style="margin-top:6px"><input type="text" data-bind="pl.q" data-rerender value="' + esc(f.q) + '" placeholder="Cerca per nome…"></div>' +
      '<p class="small muted">' + list.length + ' pazienti' + (f.all ? '' : ' di ' + esc(FA.thName(f.th))) + '. “+ Seduta” aggiunge una seduta al <strong>suo</strong> ciclo (stessa anagrafica, stessa numerazione) nel calendario di ' + esc(FA.thName(f.th)) + '.</p>' +
      '<ul class="list pl-list">' + list.map(c => {
        const k = E.cycleCounts(ctx, c.id), n = next(c);
        return '<li class="todo-item"><div><strong>' + esc(FA.patName(c.patient_id)) + '</strong>' + (c.treatment ? ' <span class="chip grey">' + esc(c.treatment) + '</span>' : '') +
          (f.all ? ' <span class="small muted">· ' + esc(FA.thName(c.therapist_id)) + '</span>' : '') +
          '<div class="small">restano <strong>' + (c.planned_sessions - k.effettuate) + '</strong> su ' + c.planned_sessions + ' · ' + k.programmate + ' in agenda' + (k.mancanoDaProgrammare ? ' · <strong>' + k.mancanoDaProgrammare + ' da programmare</strong>' : '') +
          (n ? ' · prossima: ' + esc(E.fmtItDay(n.day) + ' ' + n.start_time) + (n.therapist_id !== c.therapist_id ? ' (' + esc(FA.thName(n.therapist_id)) + ')' : '') : ' · nessuna seduta futura') + '</div></div><div class="row">' +
          (n ? '<button class="btn small" data-act="pl-show" data-th="' + n.therapist_id + '" data-day="' + n.day + '">Vedi</button>' : '') +
          (FA.canEditTh(f.th) ? '<button class="btn small primary" data-act="pl-add" data-id="' + c.patient_id + '"' + (k.mancanoDaProgrammare ? '' : ' title="Il ciclo ha già tutte le sedute: sarà una seduta in più"') + '>+ Seduta</button>' : '') + '</div></li>';
      }).join('') + '</ul>';
  }
  FA.actions['pl-show'] = el => { FA.closeModal(); FA.go('calendario', el.getAttribute('data-th'), el.getAttribute('data-day'), 'settimana'); };
  FA.actions['pl-add'] = el => {
    const f = A.ui.pl;
    const pid = el.getAttribute('data-id');
    const c = (A.data.cycles || []).find(x => x.patient_id === pid && x.status === 'attivo');
    const day = f.day < A.today ? A.today : f.day;
    FA.closeModal();
    openPanel({ th: f.th, day, start: E.freeStarts(A.ctx, f.th, day, c ? c.duration : 30, { patientId: pid, cycleId: c && c.id })[0] || '', patient_id: pid });
    FA.render();
  };
  // segmenti del pannello: aggiornano anche l'anteprima sul calendario
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act="seg"][data-path^="pd."]');
    if (b && A.ui.pd) setTimeout(() => { pdCompute(); FA.render(); FA.renderModal(); }, 0);
  });
})();
