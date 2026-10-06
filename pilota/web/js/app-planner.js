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
  const toM = b => ({ kind: b.kind, s: E.toMin(b.start), e: E.toMin(b.end), max: b.max == null || b.max === '' ? null : Number(b.max) });
  const fromM = x => ({ kind: x.kind, start: E.fromMin(x.s), end: E.fromMin(x.e), max: x.max });
  /** dipinge [s,e) con un tipo (null = cancella): le fasce sovrapposte vengono accorciate o divise */
  function paintRange(blocks, kind, s, e) {
    const out = [];
    blocks.map(toM).forEach(b => {
      if (b.e <= s || b.s >= e) { out.push(b); return; }
      if (b.s < s) out.push(Object.assign({}, b, { e: s }));
      if (b.e > e) out.push(Object.assign({}, b, { s: e }));
    });
    if (kind) out.push({ kind, s, e, max: null });
    out.sort((a, b) => a.s - b.s);
    const m = [];
    out.forEach(x => { const l = m[m.length - 1]; if (l && l.kind === x.kind && l.e === x.s && l.max == x.max) l.e = x.e; else m.push(Object.assign({}, x)); });
    return m.filter(x => x.e > x.s).map(fromM);
  }
  FA.paintRange = paintRange;

  /* ---------------- stato del calendario ---------------- */
  function calState(params) {
    const ctx = A.ctx;
    const th = params[0] && ctx.th.get(params[0]) ? params[0] : (FA.isFisio() && A.me.therapist_id) || (FA.activeTherapists()[0] || {}).id;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params[1] || '') ? params[1] : A.today;
    const mode = params[2] === 'giorno' ? 'giorno' : 'settimana';
    return { th, date, mode };
  }
  function pt(th) {
    if (!A.ui.pt || A.ui.pt.th !== th) A.ui.pt = { th, drafts: {}, brush: 'amb', effects: null };
    return A.ui.pt;
  }
  const painting = () => FA.isAdmin() && !!A.ui.painting;
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
    const edit = painting();
    const P = pt(thId);
    const can = FA.canEditTh(thId);
    let days;
    if (st.mode === 'giorno') days = [st.date];
    else {
      const mon = E.addDays(st.date, 1 - E.weekday(st.date));
      days = [0, 1, 2, 3, 4, 5].map(i => E.addDays(mon, i));
      if (!edit && !viewBlocks(thId, days[5]).length) days = days.slice(0, 5);
    }
    let minS = 24 * 60, maxE = 0;
    days.forEach(d => viewBlocks(thId, d).forEach(b => { minS = Math.min(minS, E.toMin(b.start)); maxE = Math.max(maxE, E.toMin(b.end)); }));
    (ctx.data.appointments || []).filter(a => a.therapist_id === thId && days.includes(a.day)).forEach(a => { minS = Math.min(minS, E.toMin(a.start_time)); maxE = Math.max(maxE, E.toMin(a.end_time)); });
    if (edit || maxE <= minS) { minS = Math.min(minS, 7 * 60); maxE = Math.max(maxE, 16 * 60); }
    minS = Math.floor(minS / 60) * 60; maxE = Math.ceil(maxE / 60) * 60;
    const H = (maxE - minS) * PX;
    const y = t => (E.toMin(t) - minS) * PX;
    const box = (s, e, cls, inner, attrs) => '<div class="' + cls + '" style="top:' + y(s) + 'px;height:' + Math.max(12, y(e) - y(s) - 1) + 'px"' + (attrs || '') + '>' + inner + '</div>';
    let ruler = '<div class="wk-ruler" style="height:' + H + 'px">';
    for (let m = minS; m <= maxE; m += 30) ruler += '<div class="wk-tick' + (m % 60 ? ' half' : '') + '" style="top:' + (m - minS) * PX + 'px">' + (m % 60 ? '' : E.fromMin(m)) + '</div>';
    ruler += '</div>';
    const ghosts = (A.ui.pd && A.ui.pd.th === thId && A.ui.pd.slots) || [];
    const cols = days.map(d => {
      const blocks = viewBlocks(thId, d);
      const draft = !!P.drafts[d];
      const abs = E.absenceOnDay(ctx, thId, d);
      const appts = (ctx.data.appointments || []).filter(a => a.therapist_id === thId && a.day === d);
      const occ = appts.filter(a => E.OCCUPYING.has(a.status));
      const other = appts.filter(a => !E.OCCUPYING.has(a.status) && a.status !== 'spostata' && a.status !== 'liberata');
      const closed = ctx.closures.get(d);
      let inner = '';
      blocks.forEach((b, i) => {
        const lab = esc(E.BLOCK[b.kind] || b.kind) + (edit ? ' ' + b.start + '–' + b.end : '');
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
            ok ? ' data-act="pd-open" data-th="' + thId + '" data-day="' + d + '" data-start="' + E.fromMin(g0) + '" data-end="' + E.fromMin(g1) + '" role="button" tabindex="0"' : '');
        });
      });
      occ.forEach(a => {
        const c = ctx.cyc.get(a.cycle_id);
        const iss = A.issues.find(i => i.appointment_id === a.id && i.kind !== 'esito_mancante');
        const n = E.sessionNumber(ctx, a), ev = ctx.events.get(a.patient_id + '|' + a.day);
        inner += box(a.start_time, a.end_time, 'wk-appt st-' + a.status + (iss ? ' issue' : '') + (can && a.status === 'programmata' ? ' movable' : ''),
          '<strong>' + a.start_time + ' ' + esc(FA.patName(a.patient_id)) + '</strong> ' + (n ? '<span class="wk-n" title="' + (n === 'R' ? 'Recupero' : 'Seduta ' + n + ' di ' + (c ? c.planned_sessions : '?')) + '">' + (n === 'R' ? 'R' : n + '/' + (c ? c.planned_sessions : '?')) + '</span> ' : '') +
          (ev ? '<span class="wk-v" title="Visita fisiatrica">V</span> ' : '') + FA.prio(c ? c.priority : 'NI') +
          '<br><span class="small">' + (c && c.treatment ? esc(c.treatment) + ' · ' : '') + esc(c ? FA.catName(c.category_id) : '') + (a.status !== 'programmata' ? ' · ' + esc(E.STATUS[a.status]) : '') +
          (a.original_therapist_id ? ' · sostituisce ' + esc(FA.thName(a.original_therapist_id)) : '') + (a.recovery_of ? ' · recupero' : '') + (iss ? ' · ⚠ ' + esc(iss.message) : '') + '</span>',
          ' data-act="open-appt" data-id="' + a.id + '" role="button" tabindex="0"');
      });
      ghosts.filter(g => g.day === d).forEach(g => {
        inner += box(g.start, g.end, 'wk-ghost' + (g.chk ? ' bad' : ''), (g.chk ? '✗ ' : '◌ ') + g.start + ' seduta ' + g.n + (g.chk ? '<br><span class="small">' + esc(g.chk.msg) + '</span>' : ''));
      });
      abs.forEach(x => {
        inner += x.start_time ? box(x.start_time, x.end_time, 'wk-abs', 'Assente (' + esc(E.ABSENCE_KIND[x.kind]) + ')') :
          '<div class="wk-abs" style="top:0;height:' + H + 'px">Assente (' + esc(E.ABSENCE_KIND[x.kind]) + ')' + (x.end_date ? '' : ' · rientro non noto') + '</div>';
      });
      if (closed) inner += '<div class="wk-closed" style="top:0;height:' + H + 'px">Chiuso: ' + esc(closed) + '</div>';
      if (edit && !blocks.length) inner += '<div class="wk-empty">Trascina con un pennello per disegnare la giornata</div>';
      const head = '<div class="wk-head' + (d === A.today ? ' today' : '') + (draft ? ' draft' : '') + '"' + (edit ? ' data-act="pt-day" data-day="' + d + '" role="button" title="Copia, svuota o ripristina questa giornata"' : ' data-act="go" data-view="calendario" data-param="' + thId + '/' + d + '/giorno" role="button" title="Vista del giorno"') + '>' +
        esc(E.fmtItDay(d)) + (draft ? ' <span class="chip warn">bozza</span>' : '') + (ctx.overrides.get(thId + '|' + d) && !draft ? ' <span class="chip info">variato</span>' : '') + '</div>';
      return '<div class="wk-day">' + head +
        '<div class="wk-col' + (edit ? ' paint' : '') + '" style="height:' + H + 'px" data-day="' + d + '" data-min="' + minS + '">' + inner + '</div>' +
        (other.length ? '<div class="wk-other">' + other.map(a => '<button class="chip ' + (a.status === 'da_riprogrammare' ? 'bad' : 'grey') + '" data-act="open-appt" data-id="' + a.id + '">' +
          a.start_time + ' ' + esc(FA.patName(a.patient_id)) + ' · ' + esc(E.STATUS[a.status]) + ((a.status === 'assente' || a.status === 'annullata') && a.to_recover && !a.recovered_by ? ' · da recuperare' : '') + '</button>').join('') + '</div>' : '') + '</div>';
    }).join('');

    const step = st.mode === 'giorno' ? 1 : 7;
    const nDraft = Object.keys(P.drafts).length;
    let html = '<div class="row between"><h2>Calendario di ' + esc(th.name) + '</h2><div class="row">' +
      (can && !edit ? '<button class="btn small" data-act="abs-new" data-th="' + thId + '">Ferie / permesso / malattia</button>' : '') +
      (FA.isAdmin() ? '<button class="btn small ' + (edit ? 'primary' : '') + '" data-act="pt-toggle">' + (edit ? '✓ Fine orario' : '✎ Orario') + '</button>' : '') +
      '</div></div>' +
      '<div class="panel cal-bar"><div class="row">' +
      '<select style="max-width:240px" data-bind="calTh" data-on="cal-th">' + FA.activeTherapists().map(t => FA.option(t.id, t.name + (FA.canEditTh(t.id) ? '' : ' (consultazione)'), thId)).join('') + '</select>' +
      '<button class="btn small" data-act="go" data-view="calendario" data-param="' + thId + '/' + E.addDays(st.date, -step) + '/' + st.mode + '" aria-label="Indietro">◀</button>' +
      '<input type="date" style="max-width:170px" data-bind="calDate" data-on="cal-date" value="' + st.date + '" aria-label="Vai alla data">' +
      '<button class="btn small" data-act="go" data-view="calendario" data-param="' + thId + '/' + E.addDays(st.date, step) + '/' + st.mode + '" aria-label="Avanti">▶</button>' +
      '<button class="btn small" data-act="go" data-view="calendario" data-param="' + thId + '/' + A.today + '/' + st.mode + '">Oggi</button>' +
      FA.seg('calMode', [['giorno', 'Giorno'], ['settimana', 'Settimana']], st.mode).replace(/data-act="seg"/g, 'data-act="cal-mode" data-th="' + thId + '" data-date="' + st.date + '"') +
      '</div>';
    if (edit) {
      const pr = presets();
      html += '<div class="row brushes" style="margin-top:8px"><strong class="small">Pennello:</strong>' +
        BRUSHES.map(([k, l]) => '<button class="brush k-' + k + (P.brush === k ? ' on' : '') + '" data-act="pt-brush" data-k="' + k + '" title="Clic: ' + pr[k] + ' min · trascina: durata libera">' + esc(l) + '</button>').join('') +
        '<button class="brush gomma' + (P.brush === 'gomma' ? ' on' : '') + '" data-act="pt-brush" data-k="gomma">⌫ Gomma</button>' +
        '<button class="btn small" data-act="pt-presets">Durate rapide…</button>' +
        '<button class="btn small" data-act="pt-tpl-apply">Applica schema…</button><button class="btn small" data-act="pt-tpl-save">Salva come schema…</button></div>' +
        '<p class="small muted" style="margin:6px 0 0"><strong>Trascina</strong> nella giornata per dipingere una fascia (aggancio a 15 minuti, tieni premuto Alt per 5). <strong>Clic</strong> con il pennello: fascia con la durata rapida. Sulle fasce: con un pennello di altro tipo trascini per dipingere sopra; con lo stesso tipo trascini per spostarle o, dal bordo, per allungarle; clic per orari precisi, duplicare o eliminare. Clic sull’intestazione del giorno: copia su altri giorni.</p>' +
        (nDraft ? '<div class="draft-bar"><span><strong>Bozza:</strong> ' + nDraft + ' giornat' + (nDraft === 1 ? 'a modificata' : 'e modificate') + ' (non ancora salvat' + (nDraft === 1 ? 'a' : 'e') + ')</span><span class="grow"></span>' +
          '<button class="btn small" data-act="pt-discard">Annulla bozza</button><button class="btn small primary" data-act="pt-save"' + FA.saveDisabled() + '>Salva…</button></div>' : '');
    } else {
      html += '<p class="small muted" style="margin:6px 0 0">' + (can ? 'Clicca uno spazio <strong>libero</strong> per inserire un paziente (anche già in trattamento); clicca un paziente per effettuata, assenza, recupero o ✎ correzioni; <strong>trascinalo</strong> per cambiare giorno od ora.' : 'Consultazione: puoi modificare solo il tuo calendario.') + '</p>';
    }
    html += '</div>';
    if (P.effects && P.effects.length) {
      html += '<div class="panel form-warn"><strong>Effetti della modifica:</strong> ' + P.effects.length + ' appuntamenti già prenotati non sono più compatibili. Non sono stati spostati: sistemali ora o da “Da sistemare”.<ul class="list">' +
        P.effects.map(c => '<li class="todo-item"><div>' + esc(E.fmtItDay(c.day) + ' ' + E.hhmm(c.start_time) + ' · ' + c.patient) + ' — ' + esc(c.message) + '</div><div><button class="btn small" data-act="open-appt" data-id="' + c.appointment_id + '">Sposta</button></div></li>').join('') +
        '</ul><button class="btn small" data-act="pt-effects-ok">Chiudi</button></div>';
    }
    html += '<div class="wk-grid" style="grid-template-columns:52px repeat(' + days.length + ', minmax(' + (days.length === 1 ? 300 : 130) + 'px, 1fr))"><div><div class="wk-head">&nbsp;</div>' + ruler + '</div>' + cols + '</div>';
    return html;
  }
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
    mv.ghost.className = 'wk-ghost' + (chk ? ' bad' : '');
    mv.ghost.style.top = ((m - Number(col.getAttribute('data-min'))) * PX) + 'px';
    mv.ghost.style.height = Math.max(12, dur * PX - 1) + 'px';
    mv.ghost.innerHTML = (chk ? '✗ ' : '→ ') + esc(E.fmtItDay(day) + ' ' + start) + (chk ? '<br><span class="small">' + esc(chk.msg) + '</span>' : '');
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
    if (t.chk) { FA.toast('✗ Non spostata: ' + t.chk.msg, 'bad'); return; }
    try {
      await FA.save('Seduta di ' + FA.patName(a.patient_id) + ' spostata a ' + E.fmtItDay(t.day) + ' ' + t.start,
        () => FA.rpc('move_appointment', { p_id: a.id, p_version: a.version, p_therapist: a.therapist_id, p_day: t.day, p_start: t.start, p_note: '' }));
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

  /* ---------------- pannello paziente con anteprima sul calendario ---------------- */
  FA.actions['pd-open'] = el => {
    const th = el.getAttribute('data-th'), day = el.getAttribute('data-day'), start = el.getAttribute('data-start');
    if (A.ui.pd && A.modal && A.modal.drawer && A.ui.pd.th === th) {
      // pannello già aperto: il clic sceglie l'orario del giorno della settimana cliccato
      const wd = E.weekday(day);
      if (!A.ui.pd.days.includes(wd)) A.ui.pd.days = A.ui.pd.days.concat([wd]).sort();
      A.ui.pd.times[wd] = start;
      if (day < A.ui.pd.day) A.ui.pd.day = day;
      pdCompute(); FA.render(); FA.renderModal(); return;
    }
    const cats = FA.categories().filter(c => E.skillLevel(A.ctx, th, c.id));
    A.ui.pd = { th, day, mode: 'nuovo', name: '', cycle_id: '', patient_id: '', q: '', category_id: (cats.find(c => c.id === 'mano') || cats[0] || {}).id || '', duration: 30, durOther: '',
      planned: 10, done: 0, treatment: '', days: [E.weekday(day)], times: { [E.weekday(day)]: start }, priority: 'NI', slots: [], error: null };
    pdCompute();
    FA.openModal({ title: 'Paziente · ' + FA.thName(th), drawer: true, live: true, body: pdBody,
      foot: () => '<button class="btn" data-act="pd-close">Chiudi</button><button class="btn primary" data-act="pd-save"' + (A.ui.pd.okAll ? FA.saveDisabled() : ' disabled') + '>' + (A.saving ? 'Salvataggio…' : 'Conferma') + '</button>' });
    FA.render();
  };
  /** ciclo già esistente da completare: dalla lista d'attesa oppure il ciclo in corso del paziente scelto */
  function pdCycle(f) {
    if (f.mode === 'attesa' && f.cycle_id) return A.ctx.cyc.get(f.cycle_id) || null;
    if (f.mode === 'esistente' && f.patient_id) return activeCycleOf(f.patient_id);
    return null;
  }
  function activeCycleOf(pid) { return (A.data.cycles || []).find(c => c.patient_id === pid && c.status === 'attivo') || null; }
  function pdDur(f) {
    const c = pdCycle(f);
    if (c) return c.duration;
    return f.duration === 'altro' ? Number(f.durOther) || 0 : Number(f.duration);
  }
  function pdCompute() {
    const f = A.ui.pd, ctx = A.ctx;
    const c = pdCycle(f);
    const active = c && c.status === 'attivo';
    const planned = c ? c.planned_sessions : Number(f.planned);
    // ciclo in corso: si programmano solo le sedute che mancano
    const prior = active ? planned - E.cycleCounts(ctx, c.id).mancanoDaProgrammare : c ? (c.prior_sessions || 0) : Math.max(0, Math.min(planned - 1, Number(f.done) || 0));
    const dur = pdDur(f);
    const n = planned - prior;
    const slots = [];
    if (dur >= 15 && f.days.length) {
      let d = f.day, guard = 0;
      while (slots.length < n && guard++ < 500) {
        const wd = E.weekday(d);
        if (f.days.includes(wd) && !ctx.closures.has(d)) {
          const st = FA.normTime(f.times[wd] || f.times[f.days[0]] || '');
          if (st) {
            const en = E.fromMin(E.toMin(st) + dur);
            slots.push({ day: d, start: st, end: en, n: prior + slots.length + 1, chk: E.checkSlot(ctx, f.th, d, st, en, { patientId: c ? c.patient_id : (f.patient_id || null), cycleId: c ? c.id : null }) });
          }
        }
        d = E.addDays(d, 1);
      }
    }
    f.slots = slots; f.prior = prior; f.planned2 = planned;
    f.okAll = slots.length === n && n > 0 && slots.every(s => !s.chk) && (f.mode === 'nuovo' ? !!f.name.trim() : f.mode === 'esistente' ? !!f.patient_id : !!f.cycle_id) && (!!c || !!f.category_id) &&
      dur >= 15 && dur <= 120 && dur % 5 === 0;
  }
  function pdBody() {
    const f = A.ui.pd, ctx = A.ctx;
    pdCompute();
    const cats = FA.categories().filter(c => E.skillLevel(ctx, f.th, c.id));
    const waiting = (A.data.cycles || []).filter(c => c.status === 'in_attesa' && E.skillLevel(ctx, f.th, c.category_id));
    const c = pdCycle(f);
    const bad = f.slots.filter(s => s.chk);
    let who;
    if (f.mode === 'nuovo') who = '<div class="field" style="margin-top:8px"><label>Nome (fittizio)</label><input type="text" data-bind="pd.name" data-on="pd-chg" value="' + esc(f.name) + '" placeholder="es. Bianchi L."></div>';
    else if (f.mode === 'attesa') who = '<div class="field" style="margin-top:8px"><label>Richiesta</label><select data-bind="pd.cycle_id" data-on="pd-chg"><option value="">— scegli —</option>' + waiting.map(w => FA.option(w.id, '[' + w.priority + '] ' + FA.patName(w.patient_id) + ' · ' + FA.catName(w.category_id) + ' · ' + w.duration + '′ × ' + w.planned_sessions, f.cycle_id)).join('') + '</select></div>';
    else {
      const qn = FA.E && window.FASheet ? window.FASheet.normName(f.q) : String(f.q || '').toLowerCase();
      const found = qn ? (A.data.patients || []).filter(p => window.FASheet.normName(p.name).includes(qn)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8) : [];
      const sel = f.patient_id ? A.ctx.pat.get(f.patient_id) : null;
      who = '<div class="field" style="margin-top:8px"><label>Paziente in archivio</label>' + (sel ? '<div class="row"><strong>' + esc(sel.name) + '</strong><button class="btn link small" data-act="pd-pick" data-id="">cambia</button></div>'
        : '<input type="text" data-bind="pd.q" data-on="pd-chg" value="' + esc(f.q) + '" placeholder="Cerca per nome…">' +
          (found.length ? '<div class="pd-found">' + found.map(p => { const ac = activeCycleOf(p.id); return '<button class="btn small" data-act="pd-pick" data-id="' + p.id + '">' + esc(p.name) + (ac ? ' · in trattamento con ' + esc(FA.thName(ac.therapist_id)) : '') + '</button>'; }).join('') + '</div>' : (qn ? '<div class="help">Nessun paziente con questo nome: usa “Nuovo paziente”.</div>' : ''))) + '</div>';
      if (c) {
        const cnt = E.cycleCounts(ctx, c.id);
        who += '<div class="form-note small">Ciclo in corso' + (c.therapist_id !== f.th ? ' con <strong>' + esc(FA.thName(c.therapist_id)) + '</strong> (qui come sostituzione)' : '') + ': ' + cnt.effettuate + ' sedute fatte, ' + cnt.programmate + ' programmate su ' + c.planned_sessions +
          '. ' + (cnt.mancanoDaProgrammare ? 'Si aggiungono le <strong>' + cnt.mancanoDaProgrammare + '</strong> che mancano.' : '<strong>Nessuna seduta da aggiungere</strong>: correggi la numerazione dalla seduta (✎ Correggi).') + '</div>';
      }
    }
    return FA.seg('pd.mode', [['nuovo', 'Nuovo paziente'], ['esistente', 'Paziente in archivio'], ['attesa', 'Dalla lista d’attesa']], f.mode) + who +
      (c ? '' : '<div class="field"><label>Percorso</label><select data-bind="pd.category_id" data-on="pd-chg">' + cats.map(x => FA.option(x.id, x.name, f.category_id)).join('') + '</select></div>' +
        '<div class="field"><label>Durata della seduta</label>' + FA.seg('pd.duration', [['30', '30′'], ['45', '45′'], ['60', '1 ora'], ['altro', 'Altro']], String(f.duration)) +
        (f.duration === 'altro' ? ' <input type="number" min="15" max="120" step="5" style="max-width:110px;display:inline-block" data-bind="pd.durOther" data-on="pd-chg" value="' + esc(f.durOther) + '" placeholder="minuti">' : '') + '</div>' +
        '<div class="field"><label>Ciclo</label><div class="row">Sedute già fatte <input type="number" min="0" max="' + (f.planned - 1) + '" style="max-width:80px" data-bind="pd.done" data-on="pd-chg" value="' + esc(f.done) + '"> su ' +
        FA.seg('pd.planned', [['5', '5'], ['10', '10'], ['20', '20'], ['30', '30']], String(f.planned)) + '</div>' +
        '<div class="help">La prossima è la <strong>' + (f.prior + 1) + 'ª</strong>' + (f.prior ? ' (le ' + f.prior + ' già fatte contano come effettuate)' : '') + '; si programmano le ' + (f.planned2 - f.prior) + ' rimanenti.</div></div>' +
        '<div class="field"><label>Tipo di trattamento (facoltativo)</label><input type="text" data-bind="pd.treatment" value="' + esc(f.treatment) + '" placeholder="es. GC, RM"></div>') +
      '<div class="field"><label>Giorni e orari</label><div class="days-times">' + [1, 2, 3, 4, 5, 6].map(wd => {
        const on = f.days.includes(wd);
        return '<div class="dt' + (on ? ' on' : '') + '"><button class="btn small ' + (on ? 'primary' : '') + '" data-act="pd-day" data-wd="' + wd + '">' + E.WD_SHORT[wd] + '</button>' +
          (on ? timeField('pd.times.' + wd, f.times[wd] || f.times[f.days[0]] || '', ' data-on="pd-chg" style="max-width:80px"') : '') + '</div>';
      }).join('') + '</div><div class="help">Con il pannello aperto puoi cliccare un altro spazio libero nel calendario per scegliere giorno e ora.</div></div>' +
      '<div class="field"><label>Priorità</label><select data-bind="pd.priority">' + E.PRIORITY_ORDER.map(p => FA.option(p, E.PRIORITY[p], f.priority)).join('') + '</select></div>' +
      '<h4>Anteprima (' + f.slots.length + ' sedute dal ' + E.fmtIt(f.day) + ')</h4>' +
      (bad.length ? '<div class="form-error">✗ ' + bad.length + ' sedute non disponibili: cambia orario o giorni.</div>' : f.slots.length ? '<div class="form-note">✓ Tutte disponibili. Le vedi tratteggiate sul calendario.</div>' : '') +
      '<ul class="small pd-list">' + f.slots.map(s => '<li class="' + (s.chk ? 'bad' : '') + '">' + (s.chk ? '✗ ' : '✓ ') + 'n. ' + s.n + ' · ' + esc(E.fmtItDay(s.day)) + ' ' + s.start + (s.chk ? ' — ' + esc(s.chk.msg) : '') + '</li>').join('') + '</ul>' +
      FA.errBox(f.error);
  }
  FA.actions['pd-chg'] = () => { pdCompute(); FA.render(); FA.renderModal(); };
  FA.actions['pd-pick'] = el => {
    const f = A.ui.pd, id = el.getAttribute('data-id');
    f.patient_id = id; if (!id) f.q = '';
    const c = id ? activeCycleOf(id) : null;
    if (c) { const w = Object.keys(c.weekday_times || {}).map(Number); if (w.length) { f.days = w.filter(x => x <= 6).sort(); f.days.forEach(x => { if (!f.times[x]) f.times[x] = f.times[E.weekday(f.day)] || E.hhmm(c.weekday_times[x]); }); } }
    pdCompute(); FA.render(); FA.renderModal();
  };
  FA.actions['pd-day'] = el => {
    const f = A.ui.pd, wd = Number(el.getAttribute('data-wd'));
    if (f.days.includes(wd)) { if (f.days.length > 1) f.days = f.days.filter(x => x !== wd); }
    else { f.days = f.days.concat([wd]).sort(); if (!f.times[wd]) f.times[wd] = f.times[f.days[0]]; }
    pdCompute(); FA.render(); FA.renderModal();
  };
  FA.actions['pd-close'] = () => { A.ui.pd = null; FA.closeModal(); FA.render(); };
  FA.actions['pd-save'] = async () => {
    const f = A.ui.pd;
    pdCompute();
    if (!f.okAll) return;
    try {
      const act = pdCycle(f);
      if (act && act.status === 'attivo') {
        // paziente già in trattamento: si aggiungono le sedute mancanti al suo ciclo
        await FA.save('Sedute aggiunte', () => FA.rpc('add_cycle_slots', { p_cycle: act.id, p_version: act.version, p_therapist: f.th, p_slots: f.slots.map(s => ({ day: s.day, start: s.start })) }));
        A.ui.pd = null; FA.closeModal(); FA.render(); return;
      }
      let cycleId = f.cycle_id, version;
      if (f.mode === 'nuovo' || f.mode === 'esistente') {
        const r = await FA.save('Paziente e richiesta', () => FA.rpc('create_request', { p: { patient_name: f.name.trim(), patient_id: f.mode === 'esistente' ? f.patient_id : null, category_id: f.category_id, priority: f.priority,
          request_type: f.prior > 0 ? 'continuazione' : 'prima', duration: pdDur(f), planned_sessions: Number(f.planned), prior_sessions: f.prior, weekdays: f.days } }));
        cycleId = r.cycle_id; version = 1; f.mode = 'attesa'; f.cycle_id = cycleId;
        if (f.treatment.trim()) { await FA.rpc('quick_edit_cycle', { p_cycle: cycleId, p_version: 1, p: { treatment: f.treatment.trim().toUpperCase() } }); version = 2; }
      } else version = A.ctx.cyc.get(cycleId).version;
      await FA.save('Sedute programmate', () => FA.rpc('book_cycle_slots', { p_cycle: cycleId, p_version: version, p_therapist: f.th,
        p_slots: f.slots.map(s => ({ day: s.day, start: s.start })), p_weekdays: f.days }));
      A.ui.pd = null; FA.closeModal(); FA.render();
    } catch (e) {
      f.error = e.message + (f.cycle_id ? ' Il paziente è comunque in lista d’attesa: puoi riprovare.' : '');
      pdCompute(); FA.render(); FA.renderModal();
    }
  };
  // segmenti del pannello: aggiornano anche l'anteprima sul calendario
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act="seg"][data-path^="pd."]');
    if (b && A.ui.pd) setTimeout(() => { pdCompute(); FA.render(); FA.renderModal(); }, 0);
  });
})();
