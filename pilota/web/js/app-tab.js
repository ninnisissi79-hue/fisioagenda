/*
 * FisioAgenda pilota — il tabulato mensile, come il foglio di carta:
 * una riga per paziente (nome, ora, giorni), una colonna per ogni giorno del mese,
 * nella casella il numero della seduta a ritroso (10, 9 … 1). Righe vuote per i pazienti nuovi.
 * Tutto si fa toccando: casella → seduta (sposta, durata, collega, assente, cancella);
 * nome → paziente (sedute, orario, collega, sospendi). Niente trascinamento: comodo dal telefono.
 * La presenza non si segna: una seduta passata conta come fatta, si segna solo l'assenza.
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc;
  const NEW_ROWS = 3;
  const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 3);
  const minutes = a => E.toMin(a.end_time) - E.toMin(a.start_time);
  const daysIn = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const dayOf = (m, d) => m + '-' + String(d).padStart(2, '0');
  const LIVE = new Set(['programmata', 'effettuata', 'trattenuta', 'assente', 'annullata', 'da_riprogrammare']);

  /* ---------------- righe del tabulato ---------------- */
  function rowsOf(thId, month) {
    const ctx = A.ctx, first = month + '-01', last = dayOf(month, daysIn(month));
    const rows = new Map();
    const add = (cycId, a, given) => {
      const c = ctx.cyc.get(cycId);
      if (!c) return;
      if (!rows.has(cycId)) rows.set(cycId, { c, byDay: new Map(), times: [], guest: c.therapist_id !== thId });
      const r = rows.get(cycId);
      if (a) {
        if (!r.byDay.has(a.day)) r.byDay.set(a.day, []);
        r.byDay.get(a.day).push({ a, given });
        if (!given && a.status !== 'assente' && a.status !== 'annullata') r.times.push(a.start_time);
      }
    };
    (ctx.data.appointments || []).forEach(a => {
      if (a.day < first || a.day > last || !LIVE.has(a.status)) return;
      if (a.therapist_id === thId) add(a.cycle_id, a, false);
      else if (a.original_therapist_id === thId) add(a.cycle_id, a, true); // seduta affidata a un collega: resta sulla riga del titolare
    });
    // pazienti in trattamento senza sedute nel mese (es. sospesi o da riprogrammare): restano visibili
    (ctx.activeCyclesByTh.get(thId) || []).forEach(c => { if (!rows.has(c.id)) add(c.id, null, false); });
    const mode = l => { const f = new Map(); l.forEach(t => f.set(t, (f.get(t) || 0) + 1)); return [...f.entries()].sort((x, y) => y[1] - x[1])[0]; };
    return [...rows.values()].map(r => {
      const m = mode(r.times);
      r.time = m ? m[0] : (r.c.start_time ? E.hhmm(r.c.start_time) : '');
      return r;
    }).sort((x, y) => (x.guest ? 1 : 0) - (y.guest ? 1 : 0) || (x.time || '99').localeCompare(y.time || '99') || FA.patName(x.c.patient_id).localeCompare(FA.patName(y.c.patient_id)));
  }

  /* ---------------- vista ---------------- */
  function tabGrid(st, thId, can) {
    const ctx = A.ctx, month = st.date.slice(0, 7), nd = daysIn(month);
    const rows = rowsOf(thId, month);
    const days = []; for (let d = 1; d <= nd; d++) days.push(dayOf(month, d));
    const head = days.map(d => {
      const wd = E.weekday(d), abs = E.absenceOnDay(ctx, thId, d), cl = ctx.closures.get(d);
      const mark = abs.length ? '<span class="tg-abs" title="' + esc(E.ABSENCE_KIND[abs[0].kind]) + '">' + esc(E.ABSENCE_KIND[abs[0].kind][0]) + '</span>' : cl ? '<span class="tg-abs cl" title="' + esc(cl) + '">×</span>' : '';
      return '<th class="tg-d' + (wd >= 6 ? ' we' : '') + (d === A.today ? ' today' : '') + (abs.length || cl ? ' off' : '') + '" data-act="tg-day" data-th="' + thId + '" data-day="' + d + '" title="' + esc(FA.dayLabel(d)) + ' — apri il giorno">' +
        Number(d.slice(8)) + '<br><span>' + E.WD_SHORT[wd].slice(0, 2) + '</span>' + mark + '</th>';
    }).join('');
    const body = rows.map(r => {
      const c = r.c, k = E.cycleCounts(ctx, c.id), left = c.planned_sessions - k.effettuate;
      const wds = (c.weekdays || []).map(w => E.WD_SHORT[w][0]).join(' ');
      const dur = c.duration;
      const name = '<th class="tg-name"><button data-act="tg-row" data-cyc="' + c.id + '" data-th="' + thId + '"><strong>' + esc(FA.patName(c.patient_id)) + '</strong>' +
        '<span class="small">' + esc([r.time, wds, dur + '′'].filter(Boolean).join(' · ')) + (r.guest ? ' · di ' + esc(FA.thName(c.therapist_id)) : '') +
        (c.status !== 'attivo' ? ' · <em>' + esc(c.status === 'sospeso' ? 'sospeso' : c.status) + '</em>' : ' · restano ' + Math.max(0, left)) + '</span></button></th>';
      const cells = days.map(d => {
        const list = r.byDay.get(d) || [];
        const wd = E.weekday(d);
        let inner = '', cls = (wd >= 6 ? 'we' : '') + (d === A.today ? ' today' : '');
        const x = list.find(z => !z.given && LIVE.has(z.a.status)) || list[0];
        if (x) {
          const a = x.a, n = FA.leftOf(a);
          const past = a.day < A.today;
          if (a.status === 'assente' || a.status === 'annullata') { inner = 'A'; cls += ' tg-ass'; }
          else if (a.status === 'da_riprogrammare') { inner = '!'; cls += ' tg-bad'; }
          else inner = n == null ? '•' : String(n);
          if (x.given) { cls += ' tg-given'; inner += '<sub>' + esc(initials(FA.thName(a.therapist_id))) + '</sub>'; }
          else if (a.original_therapist_id && r.guest) cls += ' tg-guest';
          if ((a.status === 'effettuata' || (a.status === 'programmata' && past))) cls += ' tg-done';
          if (r.time && a.start_time !== r.time && !x.given && a.status !== 'assente') inner += '<sup>' + esc(a.start_time) + '</sup>';
          if (minutes(a) !== dur && !x.given) cls += ' tg-dur';
          return '<td class="' + cls + '"><button data-act="tg-cell" data-id="' + a.id + '" title="' + esc(FA.dayLabel(d) + ' ' + a.start_time + '–' + a.end_time + (x.given ? ' con ' + FA.thName(a.therapist_id) : '')) + '">' + inner + '</button></td>';
        }
        return '<td class="' + cls + '">' + (can && !r.guest && d >= A.today ? '<button class="tg-empty" data-act="tg-add" data-cyc="' + c.id + '" data-day="' + d + '" aria-label="Aggiungi una seduta il ' + esc(E.fmtIt(d)) + '"></button>' : '') + '</td>';
      }).join('');
      return '<tr class="' + (r.guest ? 'tg-guestrow' : '') + (A.ui.booked && A.ui.booked.patient_id === c.patient_id ? ' tg-booked' : '') + '">' + name + cells + '</tr>';
    }).join('');
    // righe vuote: si scrive il nome direttamente nel tabulato
    const tgn = A.ui.tgn || (A.ui.tgn = {});
    const empty = can ? Array.from({ length: NEW_ROWS }, (_, i) => '<tr class="tg-new"><th class="tg-name"><input type="text" data-bind="tgn.n' + i + '" data-tg-new="' + i + '" value="' + esc(tgn['n' + i] || '') + '" placeholder="+ nuovo paziente" autocomplete="off" aria-label="Nome del nuovo paziente"></th>' +
      days.map(d => '<td class="' + (E.weekday(d) >= 6 ? 'we' : '') + (d === A.today ? ' today' : '') + '">' + (d >= A.today ? '<button class="tg-empty" data-act="tg-newcell" data-i="' + i + '" data-th="' + thId + '" data-day="' + d + '" aria-label="Nuovo paziente dal ' + esc(E.fmtIt(d)) + '"></button>' : '') + '</td>').join('') + '</tr>').join('') : '';
    return '<div class="tg-wrap" data-tg-month="' + month + '"><table class="tg"><thead><tr><th class="tg-name tg-corner">' + rows.length + ' pazienti</th>' + head + '</tr></thead><tbody>' + body + empty + '</tbody></table></div>' +
      '<p class="small muted tg-legend"><span class="tg-chip done">3</span> fatta · <span class="tg-chip">3</span> in programma · <span class="tg-chip ass">A</span> assente · <span class="tg-chip given">3<sub>BR</sub></span> con un collega · ⁰⁷:⁴⁵ ora diversa dal solito. ' +
      (can ? 'Tocca una casella per spostare, cambiare durata o collega, segnare l’assenza o cancellare; una casella vuota per aggiungere una seduta; il nome per il paziente; una riga vuota per un paziente nuovo.' : 'Consultazione.') + '</p>';
  }
  FA.tabGrid = tabGrid;
  // il giorno di oggi in vista anche sul telefono
  FA.afterRender = FA.afterRender || [];
  FA.afterRender.push(() => {
    const w = document.querySelector('.tg-wrap'), t = w && w.querySelector('th.today');
    if (w && t && !w.dataset.scrolled) { w.dataset.scrolled = '1'; w.scrollLeft = Math.max(0, t.offsetLeft - w.clientWidth / 2); }
  });
  FA.actions['tg-day'] = el => FA.go('calendario', el.getAttribute('data-th'), el.getAttribute('data-day'), 'giorno');

  /* ---------------- paziente nuovo da una riga vuota ---------------- */
  function startNew(th, day, i) {
    const name = String((A.ui.tgn || {})['n' + i] || '').trim();
    const d = day && day >= A.today ? day : A.today;
    const start = E.freeStarts(A.ctx, th, d, 30, {})[0] || '';
    FA.openPanel({ th, day: d, start, kind: 'paziente', name });
    if (A.ui.tgn) A.ui.tgn['n' + i] = '';
  }
  FA.actions['tg-newcell'] = el => startNew(el.getAttribute('data-th'), el.getAttribute('data-day'), el.getAttribute('data-i'));
  document.addEventListener('keydown', ev => {
    const t = ev.target;
    if (ev.key !== 'Enter' || !t.hasAttribute || !t.hasAttribute('data-tg-new')) return;
    ev.preventDefault();
    const st = FA.calState(A.params);
    FA.set('tgn.n' + t.getAttribute('data-tg-new'), t.value);
    startNew(st.th, st.date.slice(0, 7) === A.today.slice(0, 7) ? A.today : st.date.slice(0, 7) + '-01', t.getAttribute('data-tg-new'));
  });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (!t.hasAttribute || !t.hasAttribute('data-tg-new') || !t.value.trim()) return;
    const st = FA.calState(A.params);
    setTimeout(() => { if (!A.modal) startNew(st.th, st.date.slice(0, 7) === A.today.slice(0, 7) ? A.today : st.date.slice(0, 7) + '-01', t.getAttribute('data-tg-new')); }, 0);
  });

  /* ---------------- una seduta: tutto con un tocco ---------------- */
  FA.actions['tg-cell'] = el => openSession(el.getAttribute('data-id'));
  function openSession(id) {
    const a = A.ctx.appt.get(id);
    if (!a) return;
    const dur = minutes(a);
    A.ui.ts = { id, view: 'menu', day: a.day, start: a.start_time, th: a.therapist_id, scope: 'solo', to: E.addDays(a.day, 28), force: false, error: null,
      dur: [30, 45, 60].includes(dur) ? String(dur) : 'altro', durOther: String(dur) };
    FA.openModal({ title: FA.patName(a.patient_id), live: true, body: sessionBody, foot: sessionFoot });
  }
  FA.openSession = openSession;
  const can = a => FA.canEditTh(a.therapist_id) || (a.original_therapist_id && FA.canEditTh(a.original_therapist_id));
  function sessionBody() {
    const f = A.ui.ts, a = A.ctx.appt.get(f.id);
    if (!a) return '<p>La seduta non esiste più (modificata da un collega).</p>';
    const c = A.ctx.cyc.get(a.cycle_id), left = FA.leftOf(a), k = E.cycleCounts(A.ctx, c.id);
    let h = '<p class="ts-head">' + FA.countBadge(a) + ' <strong>' + esc(FA.dayLabel(a.day)) + ', ' + a.start_time + '–' + a.end_time + '</strong> · ' + esc(FA.thName(a.therapist_id)) +
      (a.original_therapist_id ? ' <span class="chip info">sostituisce ' + esc(FA.thName(a.original_therapist_id)) + '</span>' : '') + ' ' + FA.statusChip(a) + '<br><span class="small">' +
      (typeof left === 'number' ? (left === 1 ? 'Ultima seduta del ciclo' : 'Restano ' + left + ' sedute, compresa questa') + ' · ' : left === 'R' ? 'Recupero · ' : '') + 'fatte ' + k.effettuate + ' su ' + c.planned_sessions + '</span></p>';
    if (!can(a)) return h + '<p class="muted">Consultazione: per modificare questa agenda serve l’autorizzazione del coordinatore.</p>';
    const live = a.status === 'programmata' || a.status === 'da_riprogrammare';
    if (f.view === 'menu') {
      h += '<div class="act-grid">' +
        (live ? '<button class="btn" data-act="ts-view" data-v="sposta">Sposta (giorno o ora)</button>' +
          '<button class="btn" data-act="ts-view" data-v="durata">Durata</button>' +
          '<button class="btn" data-act="ts-view" data-v="collega">Altro fisioterapista</button>' : '') +
        (a.status === 'programmata' ? '<button class="btn" data-act="ts-absent" data-rec="0"' + FA.saveDisabled() + '>Assente</button>' +
          '<button class="btn" data-act="ts-absent" data-rec="1"' + FA.saveDisabled() + '>Assente · aggiungi una seduta in fondo</button>' : '') +
        (a.status === 'assente' || a.status === 'annullata' ? '<button class="btn" data-act="ts-unabsent"' + FA.saveDisabled() + '>Togli l’assenza</button>' : '') +
        (live ? '<button class="btn danger-soft" data-act="ts-view" data-v="cancella">Cancella</button>' : '') +
        (live ? '<button class="btn" data-act="sw-from-ts" data-id="' + a.id + '">⇄ Scambia con un altro paziente</button>' : '') +
        '</div><div class="row small cyc-acts"><span class="muted">Paziente:</span><button class="btn link small" data-act="tg-row" data-cyc="' + c.id + '" data-th="' + a.therapist_id + '">Tutte le sedute, orario, sospendi…</button>' +
        '<button class="btn link small" data-act="am-undo" data-id="' + a.id + '">Annulla l’ultima modifica</button></div>';
    } else if (f.view === 'sposta') {
      const t = FA.normTime(f.start), m = minutes(a);
      const chk = t && f.day ? E.checkSlot(A.ctx, a.therapist_id, f.day, t, E.fromMin(E.toMin(t) + m), { patientId: a.patient_id, ignoreId: a.id, cycleId: a.cycle_id }) : null;
      const free = f.day ? E.freeStarts(A.ctx, a.therapist_id, f.day, m, { patientId: a.patient_id, ignoreId: a.id, cycleId: a.cycle_id }).slice(0, 8) : [];
      f.chk = chk;
      h += '<div class="grid2"><div class="field"><label>Giorno</label><input type="date" data-bind="ts.day" data-rerender value="' + esc(f.day) + '"></div>' +
        '<div class="field"><label>Ora</label>' + FA.timeField('ts.start', f.start, ' data-rerender style="max-width:100px"') + '</div></div>' +
        (free.length ? '<div class="small">Liberi: ' + free.map(x => '<button class="btn link small" data-act="ts-time" data-t="' + x + '">' + x + '</button>').join(' ') + '</div>' : '') + checkLine(f, chk);
    } else if (f.view === 'durata') {
      h += '<div class="field"><label>Durata di questa seduta</label>' + FA.seg('ts.dur', [['30', '30 min'], ['45', '45 min'], ['60', '1 ora'], ['altro', 'Altro']], f.dur) +
        (f.dur === 'altro' ? ' <input type="number" min="10" max="240" step="5" style="max-width:100px;display:inline-block" data-bind="ts.durOther" data-rerender value="' + esc(f.durOther) + '" placeholder="minuti">' : '') + '</div>';
      const m = f.dur === 'altro' ? Number(f.durOther) : Number(f.dur);
      f.chk = m ? E.checkSlot(A.ctx, a.therapist_id, a.day, a.start_time, E.fromMin(E.toMin(a.start_time) + m), { patientId: a.patient_id, ignoreId: a.id, cycleId: a.cycle_id }) : null;
      h += checkLine(f, f.chk) + '<p class="small muted">Per tutte le sedute del paziente: tocca il suo nome nel tabulato.</p>';
    } else if (f.view === 'collega') {
      const ths = FA.activeTherapists().filter(t => E.skillLevel(A.ctx, t.id, c.category_id));
      h += '<div class="field"><label>Fisioterapista</label><select data-bind="ts.th" data-rerender>' + ths.map(t => FA.option(t.id, t.name + (t.id === c.therapist_id ? ' (titolare)' : ''), f.th)).join('') + '</select></div>' +
        '<div class="field"><label>Quali sedute</label>' + FA.seg('ts.scope', [['solo', 'Solo questa'], ['periodo', 'Dal … al …'], ['tutte', 'Questa e le successive']], f.scope) + '</div>' +
        (f.scope === 'periodo' ? '<div class="field"><label>Fino al (compreso)</label><input type="date" data-bind="ts.to" data-rerender value="' + esc(f.to) + '" min="' + a.day + '"></div>' : '');
      f.chk = f.scope === 'solo' && f.th !== a.therapist_id ? E.checkSlot(A.ctx, f.th, a.day, a.start_time, a.end_time, { patientId: a.patient_id, ignoreId: a.id, cycleId: a.cycle_id }) : null;
      h += checkLine(f, f.chk) + '<p class="small muted">' + (f.scope === 'tutte' ? 'Il paziente passa al collega da questa seduta in poi.' : 'Il ciclo resta di ' + esc(FA.thName(c.therapist_id)) + ' e il conteggio delle sedute non cambia.') + '</p>';
    } else if (f.view === 'cancella') {
      const after = (A.ctx.byCycle.get(c.id) || []).filter(x => x.day >= a.day && (x.status === 'programmata' || x.status === 'da_riprogrammare'));
      h += '<div class="act-grid"><button class="btn danger" data-act="ts-del" data-all="0"' + FA.saveDisabled() + '>Cancella solo questa</button>' +
        (after.length > 1 ? '<button class="btn danger" data-act="ts-del" data-all="1"' + FA.saveDisabled() + '>Cancella questa e le ' + (after.length - 1) + ' successive</button>' : '') + '</div>' +
        '<p class="small muted">Le sedute già fatte e lo storico restano.</p>';
    }
    return h + FA.errBox(f.error);
  }
  function checkLine(f, chk) {
    if (!chk) return '<div class="form-note small">✓ Va bene.</div>';
    if (FA.isHardConflict(chk)) return '<div class="form-error small">✗ ' + esc(chk.msg) + '</div>';
    return '<div class="form-warn small">⚠ ' + esc(chk.msg) + '<label class="inline-check"><input type="checkbox" data-bind="ts.force" data-rerender' + (f.force ? ' checked' : '') + '> Va bene così</label></div>';
  }
  function sessionFoot() {
    const f = A.ui.ts;
    if (f.view === 'menu' || f.view === 'cancella') return '<button class="btn" data-act="' + (f.view === 'menu' ? 'close-modal' : 'ts-back') + '">' + (f.view === 'menu' ? 'Chiudi' : '← Indietro') + '</button>';
    const blocked = f.chk && (FA.isHardConflict(f.chk) || !f.force);
    return '<button class="btn" data-act="ts-back">← Indietro</button><button class="btn primary" data-act="ts-save"' + (blocked ? ' disabled' : FA.saveDisabled()) + '>Salva</button>';
  }
  FA.actions['ts-view'] = el => { const f = A.ui.ts; f.view = el.getAttribute('data-v'); f.error = null; f.force = false; FA.renderModal(); };
  FA.actions['ts-back'] = () => { A.ui.ts.view = 'menu'; A.ui.ts.error = null; FA.renderModal(); };
  FA.actions['ts-time'] = el => { A.ui.ts.start = el.getAttribute('data-t'); FA.renderModal(); };
  FA.actions['sw-from-ts'] = el => { const id = el.getAttribute('data-id'); A.ui.am = { id, mode: 'scambia', out: {}, pick: {} }; FA.actions['open-appt']({ getAttribute: k => k === 'data-id' ? id : k === 'data-mode' ? 'scambia' : null }); };
  async function done(label, a, fn) {
    const f = A.ui.ts;
    try { await FA.save(label, fn); FA.closeModal(); FA.undoToast(FA.patName(a.patient_id) + ': ' + label.toLowerCase(), [a.id]); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  }
  FA.actions['ts-save'] = async () => {
    const f = A.ui.ts, a = A.ctx.appt.get(f.id), c = A.ctx.cyc.get(a.cycle_id);
    if (f.view === 'sposta') return done('Spostata', a, () => FA.rpc('edit_appointment', { p_id: a.id, p_version: a.version, p: { day: f.day, start: FA.normTime(f.start), force: !!f.force } }));
    if (f.view === 'durata') { const m = f.dur === 'altro' ? Number(f.durOther) : Number(f.dur); return done('Durata ' + m + ' minuti', a, () => FA.rpc('edit_appointment', { p_id: a.id, p_version: a.version, p: { minutes: m, force: !!f.force } })); }
    if (f.view === 'collega') {
      if (f.scope === 'solo') return done('Con ' + FA.thName(f.th), a, () => FA.rpc('edit_appointment', { p_id: a.id, p_version: a.version, p: { therapist_id: f.th, force: !!f.force } }));
      try {
        await FA.save('Sedute passate a ' + FA.thName(f.th), () => FA.rpc('reschedule_range', { p_cycle: c.id, p_version: c.version, p_from: a.day, p_to: f.scope === 'periodo' ? f.to : null, p_therapist: f.th, p_times: {}, p_note: '' }));
        FA.closeModal();
      } catch (e) { f.error = e.message; FA.renderModal(); }
    }
  };
  /** prossimo posto libero dopo l'ultima seduta del ciclo, negli stessi giorni e alla stessa ora */
  function nextSlotAfter(c, a) {
    const list = (A.ctx.byCycle.get(c.id) || []).filter(x => x.status === 'programmata' || x.status === 'effettuata');
    let d = list.reduce((m, x) => x.day > m ? x.day : m, a.day);
    const wds = (c.weekdays || []).length ? c.weekdays : [E.weekday(a.day)];
    for (let i = 0; i < 120; i++) {
      d = E.addDays(d, 1);
      if (!wds.includes(E.weekday(d)) || A.ctx.closures.has(d)) continue;
      const end = E.fromMin(E.toMin(a.start_time) + minutes(a));
      if (!E.checkSlot(A.ctx, a.therapist_id, d, a.start_time, end, { patientId: a.patient_id, cycleId: c.id })) return { day: d, start: a.start_time, minutes: minutes(a) };
    }
    return null;
  }
  FA.actions['ts-absent'] = async el => {
    const f = A.ui.ts, a = A.ctx.appt.get(f.id), c = A.ctx.cyc.get(a.cycle_id), rec = el.getAttribute('data-rec') === '1';
    const slot = rec ? nextSlotAfter(c, a) : null;
    if (rec && !slot) { f.error = 'Non trovo un posto libero dopo l’ultima seduta: aggiungila toccando una casella vuota.'; FA.renderModal(); return; }
    try {
      await FA.save(rec ? 'Assente: seduta aggiunta il ' + E.fmtItDay(slot.day) : 'Assente', async () => {
        await FA.rpc('register_outcome', { p_id: a.id, p_version: a.version, p_status: 'assente', p_cancel_by: null, p_to_recover: false, p_note: '' });
        if (rec) { const cc = A.ctx.cyc.get(c.id); await FA.rpc('add_cycle_slots', { p_cycle: cc.id, p_version: (await FA.freshCycle(cc.id)).version, p_therapist: a.therapist_id, p_slots: [slot], p_force: false }); }
      });
      FA.closeModal();
      if (!rec) FA.undoToast(FA.patName(a.patient_id) + ': assente', [a.id]);
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.freshCycle = async id => { const { data } = await A.sb.from('cycles').select('id,version').eq('id', id).single(); return data; };
  FA.actions['ts-unabsent'] = async () => {
    const f = A.ui.ts, a = A.ctx.appt.get(f.id);
    return done('Assenza tolta', a, () => FA.rpc('register_outcome', { p_id: a.id, p_version: a.version, p_status: 'programmata', p_cancel_by: null, p_to_recover: false, p_note: '' }));
  };
  FA.actions['ts-del'] = async el => {
    const f = A.ui.ts, a = A.ctx.appt.get(f.id), c = A.ctx.cyc.get(a.cycle_id);
    const list = el.getAttribute('data-all') === '1' ? (A.ctx.byCycle.get(c.id) || []).filter(x => x.day >= a.day && (x.status === 'programmata' || x.status === 'da_riprogrammare')) : [a];
    if (!confirm('Cancellare ' + (list.length === 1 ? 'la seduta del ' + E.fmtItDay(a.day) : list.length + ' sedute dal ' + E.fmtItDay(a.day)) + ' di ' + FA.patName(a.patient_id) + '?')) return;
    try {
      await FA.save(list.length === 1 ? 'Seduta cancellata' : list.length + ' sedute cancellate', async () => {
        for (const x of list) await FA.rpc('delete_appointment', { p_id: x.id, p_version: x.version, p_note: 'cancellata dal tabulato' });
      });
      FA.closeModal();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- casella vuota nella riga del paziente: una seduta in più ---------------- */
  FA.actions['tg-add'] = el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-cyc')), day = el.getAttribute('data-day');
    const st = FA.calState(A.params), month = st.date.slice(0, 7);
    const row = rowsOf(st.th, month).find(r => r.c.id === c.id);
    A.ui.ta = { cyc: c.id, th: st.th, day, start: (row && row.time) || (c.start_time ? E.hhmm(c.start_time) : ''), dur: [30, 45, 60].includes(c.duration) ? String(c.duration) : 'altro', durOther: String(c.duration), force: false, error: null };
    FA.openModal({ title: FA.patName(c.patient_id) + ' · ' + FA.dayLabel(day), live: true, body: addBody, foot: addFoot });
  };
  function addBody() {
    const f = A.ui.ta, c = A.ctx.cyc.get(f.cyc);
    const t = FA.normTime(f.start), m = f.dur === 'altro' ? Number(f.durOther) : Number(f.dur);
    f.chk = t && m ? E.checkSlot(A.ctx, f.th, f.day, t, E.fromMin(E.toMin(t) + m), { patientId: c.patient_id, cycleId: c.id }) : { code: 'orario', msg: 'Indica ora e durata.' };
    const k = E.cycleCounts(A.ctx, c.id);
    return (c.status !== 'attivo' ? '<div class="form-warn">Il ciclo è ' + esc(c.status) + ': per aggiungere sedute riprendilo dal nome del paziente.</div>' : '') +
      '<div class="grid2"><div class="field"><label>Ora</label>' + FA.timeField('ta.start', f.start, ' data-rerender style="max-width:100px"') + '</div>' +
      '<div class="field"><label>Durata</label>' + FA.seg('ta.dur', [['30', '30'], ['45', '45'], ['60', '60'], ['altro', 'Altro']], f.dur) +
      (f.dur === 'altro' ? ' <input type="number" min="10" max="240" step="5" style="max-width:90px;display:inline-block" data-bind="ta.durOther" data-rerender value="' + esc(f.durOther) + '">' : '') + '</div></div>' +
      (k.mancanoDaProgrammare ? '' : '<p class="small muted">Tutte le sedute del ciclo sono già in agenda: questa sarà una seduta in più.</p>') +
      checkLine({ force: f.force }, f.chk).replace('data-bind="ts.force"', 'data-bind="ta.force"') + FA.errBox(f.error);
  }
  function addFoot() {
    const f = A.ui.ta, c = A.ctx.cyc.get(f.cyc);
    const blocked = c.status !== 'attivo' || (f.chk && (FA.isHardConflict(f.chk) || !f.force));
    return '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="ta-save"' + (blocked ? ' disabled' : FA.saveDisabled()) + '>Aggiungi la seduta</button>';
  }
  FA.actions['ta-save'] = async () => {
    const f = A.ui.ta, c = A.ctx.cyc.get(f.cyc), m = f.dur === 'altro' ? Number(f.durOther) : Number(f.dur);
    try {
      await FA.save('Seduta aggiunta', () => FA.rpc('add_cycle_slots', { p_cycle: c.id, p_version: c.version, p_therapist: f.th, p_slots: [{ day: f.day, start: FA.normTime(f.start), minutes: m }], p_force: !!f.force }));
      FA.closeModal();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- il paziente (tocco sul nome) ---------------- */
  FA.actions['tg-row'] = el => {
    const c = A.ctx.cyc.get(el.getAttribute('data-cyc'));
    if (!c) return;
    const p = A.ctx.pat.get(c.patient_id);
    A.ui.tp = { cyc: c.id, th: el.getAttribute('data-th') || c.therapist_id, view: 'menu', name: p ? p.name : '', planned: c.planned_sessions, done: E.cycleCounts(A.ctx, c.id).effettuate,
      time: c.start_time ? E.hhmm(c.start_time) : '', from: A.today, wds: (c.weekdays || []).slice(), toTh: c.therapist_id, dur: [30, 45, 60].includes(c.duration) ? String(c.duration) : 'altro', durOther: String(c.duration), error: null };
    FA.openModal({ title: 'Paziente', live: true, body: patBody, foot: () => '<button class="btn" data-act="' + (A.ui.tp.view === 'menu' ? 'close-modal' : 'tp-back') + '">' + (A.ui.tp.view === 'menu' ? 'Chiudi' : '← Indietro') + '</button>' +
      (A.ui.tp.view !== 'menu' ? '<button class="btn primary" data-act="tp-save"' + FA.saveDisabled() + '>Salva</button>' : '') });
  };
  function patBody() {
    const f = A.ui.tp, c = A.ctx.cyc.get(f.cyc);
    if (!c) return '<p>Il paziente non c’è più.</p>';
    const k = E.cycleCounts(A.ctx, c.id), canE = FA.canEditTh(c.therapist_id);
    const next = (A.ctx.byCycle.get(c.id) || []).filter(x => x.status === 'programmata' && x.day >= A.today);
    let h = '<h3 style="margin:0">' + esc(FA.patName(c.patient_id)) + '</h3><p class="count-line">Fatte <strong>' + k.effettuate + '</strong> su ' + c.planned_sessions + ' · restano <strong>' + Math.max(0, c.planned_sessions - k.effettuate) + '</strong>' +
      ' · in agenda ' + next.length + (k.mancanoDaProgrammare ? ' · <strong>' + k.mancanoDaProgrammare + ' da programmare</strong>' : '') + '</p>' +
      '<p class="small muted">' + esc(FA.thName(c.therapist_id)) + ' · ' + c.duration + ' minuti · ' + (c.weekdays || []).map(w => E.WD_SHORT[w]).join(', ') + (c.status !== 'attivo' ? ' · <strong>' + esc(c.status) + '</strong>' : '') + '</p>';
    if (!canE) return h + '<p class="muted">Consultazione.</p>';
    if (f.view === 'menu') {
      h += '<div class="act-grid">' +
        '<button class="btn" data-act="tp-view" data-v="nome">Nome</button>' +
        '<button class="btn" data-act="tp-view" data-v="sedute">Numero di sedute</button>' +
        (next.length ? '<button class="btn" data-act="tp-view" data-v="ora">Cambia ora dal…</button>' +
          '<button class="btn" data-act="tp-view" data-v="durata">Durata delle sedute</button>' +
          '<button class="btn" data-act="tp-view" data-v="collega">Passa a un collega dal…</button>' : '') +
        (c.status === 'attivo' && k.mancanoDaProgrammare ? '<button class="btn primary" data-act="tp-more">Programma le ' + k.mancanoDaProgrammare + ' sedute che mancano</button>' : '') +
        (next.length ? '<button class="btn danger-soft" data-act="tp-clear">Cancella le ' + next.length + ' sedute future</button>' : '') +
        '</div><div class="row small cyc-acts"><span class="muted">Ciclo:</span>' +
        (c.status === 'attivo' ? '<button class="btn link small" data-act="cy-suspend" data-id="' + c.id + '">Sospendi (anche per ticket)</button><button class="btn link small" data-act="cy-close" data-id="' + c.id + '">Concludi</button>' : '') +
        (c.status === 'sospeso' ? '<button class="btn link small" data-act="cy-resume" data-id="' + c.id + '">Riprendi</button>' : '') + '</div>';
    } else if (f.view === 'nome') h += '<div class="field"><label>Nome</label><input type="text" data-bind="tp.name" value="' + esc(f.name) + '"></div>';
    else if (f.view === 'sedute') h += '<div class="grid2"><div class="field"><label>Sedute totali del ciclo</label><input type="number" min="1" max="60" data-bind="tp.planned" data-num data-rerender value="' + esc(f.planned) + '"></div>' +
      '<div class="field"><label>Già fatte</label><input type="number" min="0" max="59" data-bind="tp.done" data-num data-rerender value="' + esc(f.done) + '"></div></div>' +
      '<p class="small">Restano: <strong>' + Math.max(0, Number(f.planned) - Number(f.done)) + '</strong>. I numeri nel tabulato si aggiornano; la correzione resta nello storico.</p>';
    else if (f.view === 'ora') h += '<div class="grid2"><div class="field"><label>Nuova ora</label>' + FA.timeField('tp.time', f.time, ' style="max-width:100px"') + '</div>' +
      '<div class="field"><label>Dal giorno</label><input type="date" min="' + A.today + '" data-bind="tp.from" value="' + esc(f.from) + '"></div></div>' +
      ((c.weekdays || []).length > 1 ? '<div class="field"><label>Per quali giorni</label><div class="row">' + c.weekdays.map(w => '<label class="inline-check"><input type="checkbox" data-bind="tp.wds" data-multi value="' + w + '"' + (f.wds.includes(w) ? ' checked' : '') + '> ' + E.WD_LONG[w] + '</label>').join('') + '</div></div>' : '') +
      '<p class="small muted">Vale per le sedute in programma da quel giorno, negli altri giorni non cambia nulla.</p>';
    else if (f.view === 'durata') h += '<div class="field"><label>Durata (questa e le prossime sedute)</label>' + FA.seg('tp.dur', [['30', '30 min'], ['45', '45 min'], ['60', '1 ora'], ['altro', 'Altro']], f.dur) +
      (f.dur === 'altro' ? ' <input type="number" min="10" max="240" step="5" style="max-width:100px;display:inline-block" data-bind="tp.durOther" value="' + esc(f.durOther) + '">' : '') + '</div>';
    else if (f.view === 'collega') h += '<div class="grid2"><div class="field"><label>Collega</label><select data-bind="tp.toTh">' + FA.activeTherapists().filter(t => E.skillLevel(A.ctx, t.id, c.category_id)).map(t => FA.option(t.id, t.name, f.toTh)).join('') + '</select></div>' +
      '<div class="field"><label>Dal giorno</label><input type="date" min="' + A.today + '" data-bind="tp.from" value="' + esc(f.from) + '"></div></div><p class="small muted">Tutte le sedute da quel giorno passano al collega; il conteggio non cambia. Per una sola seduta tocca la sua casella.</p>';
    return h + FA.errBox(f.error);
  }
  FA.actions['tp-view'] = el => { A.ui.tp.view = el.getAttribute('data-v'); A.ui.tp.error = null; FA.renderModal(); };
  FA.actions['tp-back'] = () => { A.ui.tp.view = 'menu'; A.ui.tp.error = null; FA.renderModal(); };
  FA.actions['tp-more'] = () => {
    const f = A.ui.tp, c = A.ctx.cyc.get(f.cyc);
    FA.closeModal();
    FA.openPanel({ th: c.therapist_id, day: A.today, start: c.start_time ? E.hhmm(c.start_time) : '', patient_id: c.patient_id, addAll: true });
  };
  FA.actions['tp-clear'] = async () => {
    const f = A.ui.tp, c = A.ctx.cyc.get(f.cyc);
    const list = (A.ctx.byCycle.get(c.id) || []).filter(x => x.day >= A.today && (x.status === 'programmata' || x.status === 'da_riprogrammare'));
    if (!confirm('Cancellare le ' + list.length + ' sedute future di ' + FA.patName(c.patient_id) + '? Le sedute già fatte restano.')) return;
    try { await FA.save(list.length + ' sedute cancellate', async () => { for (const x of list) await FA.rpc('delete_appointment', { p_id: x.id, p_version: x.version, p_note: 'cancellata dal tabulato' }); }); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['tp-save'] = async () => {
    const f = A.ui.tp, c = A.ctx.cyc.get(f.cyc), p = A.ctx.pat.get(c.patient_id);
    try {
      if (f.view === 'nome') await FA.save('Nome', () => FA.rpc('update_patient', { p_id: p.id, p_version: p.version, p_name: f.name.trim(), p_note: p.note || '' }));
      else if (f.view === 'sedute') {
        const planned = Number(f.planned), done = Number(f.done);
        const extra = E.cycleCounts(A.ctx, c.id).effettuate - (c.prior_sessions || 0);
        const prior = done - extra;
        if (!(planned >= 1 && prior >= 0 && prior < planned)) { f.error = 'Numeri non coerenti: le sedute già fatte devono essere meno del totale e non meno di quelle già registrate in agenda (' + extra + ').'; FA.renderModal(); return; }
        await FA.save('Numero di sedute', () => FA.rpc('quick_edit_cycle', { p_cycle: c.id, p_version: c.version, p: { planned_sessions: planned, prior_sessions: prior } }));
      } else if (f.view === 'ora') {
        const t = FA.normTime(f.time);
        if (!t) { f.error = 'Scrivi l’ora (es. 8:15).'; FA.renderModal(); return; }
        const days = (c.weekdays || []).length ? (f.wds || []).map(Number) : [1, 2, 3, 4, 5, 6];
        if (!days.length) { f.error = 'Scegli almeno un giorno.'; FA.renderModal(); return; }
        const times = {}; days.forEach(w => { times[w] = t; });
        await FA.save('Nuova ora dal ' + E.fmtIt(f.from), () => FA.rpc('reschedule_range', { p_cycle: c.id, p_version: c.version, p_from: f.from, p_to: null, p_therapist: c.therapist_id, p_times: times, p_note: '' }));
      } else if (f.view === 'durata') {
        const m = f.dur === 'altro' ? Number(f.durOther) : Number(f.dur);
        await FA.save('Durata ' + m + ' minuti', () => FA.rpc('quick_edit_cycle', { p_cycle: c.id, p_version: c.version, p: { duration: m } }));
      } else if (f.view === 'collega') {
        await FA.save('Passato a ' + FA.thName(f.toTh), () => FA.rpc('reschedule_range', { p_cycle: c.id, p_version: c.version, p_from: f.from, p_to: null, p_therapist: f.toTh, p_times: {}, p_note: '' }));
      }
      FA.closeModal();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- orario della settimana: compilato una volta, cambiato da una data ---------------- */
  const KINDS = [['amb', 'Ambulatorio (pazienti)'], ['pausa', 'Pausa'], ['reparto', 'Reparto'], ['ortesi', 'Ambulatorio ortesi'], ['gruppo', 'Gruppo'], ['progetto', 'Progetto'],
    ['segreteria', 'Segreteria'], ['documentazione', 'Cartelle / adempimenti'], ['corso', 'Corso'], ['briefing', 'Briefing'], ['recupero_ore', 'Recupero ore'], ['altro', 'Altro']];
  FA.ACT_KINDS = KINDS;
  FA.actions['or-open'] = el => {
    const th = el.getAttribute('data-th');
    const base = E.shiftFor(A.ctx, th, A.today);
    const week = {};
    [1, 2, 3, 4, 5, 6].forEach(k => { week[k] = (base ? (base.week[String(k)] || []) : []).map(b => ({ kind: b.kind, start: E.hhmm(b.start), end: E.hhmm(b.end), label: b.label || '' })); });
    A.ui.or = { th, week, from: A.today, conf: null, error: null };
    FA.openModal({ title: 'Orario di ' + FA.thName(th), wide: true, sticky: true, body: orBody,
      foot: () => '<button class="btn" data-act="close-modal">Chiudi</button><button class="btn" data-act="or-check"' + FA.saveDisabled() + '>Controlla</button><button class="btn primary" data-act="or-save"' + FA.saveDisabled() + '>Salva</button>' });
  };
  function orBody() {
    const f = A.ui.or;
    return '<p class="small muted">L’orario si ripete ogni settimana. Scrivi le fasce di ogni giorno; quelle diverse dall’ambulatorio (pausa, ortesi, gruppi, progetti…) non prendono pazienti. Per un solo giorno non serve venire qui: tocca lo spazio nel tabulato, vista Giorno.</p>' +
      [1, 2, 3, 4, 5, 6].map(k => '<div class="or-day"><div class="row between"><strong>' + E.WD_LONG[k] + '</strong><span class="row">' +
        '<button class="btn link small" data-act="or-add" data-k="' + k + '">+ fascia</button>' + (f.week[k].length ? '<button class="btn link small" data-act="or-copy" data-k="' + k + '">copia su tutti i giorni feriali</button>' : '') + '</span></div>' +
        (f.week[k].length ? f.week[k].map((b, i) => '<div class="or-row"><select data-bind="or.week.' + k + '.' + i + '.kind" data-rerender>' + KINDS.map(([v, l]) => FA.option(v, l, b.kind)).join('') + '</select>' +
          FA.timeField('or.week.' + k + '.' + i + '.start', b.start, ' style="max-width:80px" aria-label="Dalle"') + '–' + FA.timeField('or.week.' + k + '.' + i + '.end', b.end, ' style="max-width:80px" aria-label="Alle"') +
          (b.kind !== 'amb' ? '<input type="text" data-bind="or.week.' + k + '.' + i + '.label" value="' + esc(b.label || '') + '" placeholder="nome (facoltativo)" style="max-width:170px">' : '') +
          '<button class="btn link small" data-act="or-del" data-k="' + k + '" data-i="' + i + '" aria-label="Togli">✕</button></div>').join('') : '<div class="small muted">non lavora</div>') + '</div>').join('') +
      '<div class="field" style="margin-top:8px"><label>Vale dal</label><input type="date" min="' + A.today + '" data-bind="or.from" value="' + esc(f.from) + '" style="max-width:180px"><div class="help">Il passato non cambia; i pazienti già in agenda non vengono spostati: se non stanno più nell’orario te li elenco.</div></div>' +
      (f.conf ? (f.conf.length ? '<div class="form-warn"><strong>' + f.conf.length + ' pazienti in agenda non starebbero più nell’orario</strong> (restano dove sono, da ricollocare):<ul class="small">' + f.conf.slice(0, 12).map(x => '<li>' + esc(E.fmtItDay(x.day) + ' ' + E.hhmm(x.start_time) + ' ' + x.patient + ' — ' + x.message) + '</li>').join('') + '</ul></div>' : '<div class="form-note">✓ Nessun paziente in conflitto.</div>') : '') +
      FA.errBox(f.error);
  }
  function orWeek() {
    const f = A.ui.or, week = {};
    for (const k of [1, 2, 3, 4, 5, 6]) {
      const l = f.week[k].map(b => ({ kind: b.kind, start: FA.normTime(b.start), end: FA.normTime(b.end), max: null, label: b.kind === 'amb' ? '' : (b.label || '').trim() }));
      if (l.some(b => !b.start || !b.end || E.toMin(b.end) <= E.toMin(b.start))) throw new Error(E.WD_LONG[k] + ': ogni fascia ha bisogno di un inizio e di una fine (la fine dopo l’inizio).');
      l.sort((x, y) => E.toMin(x.start) - E.toMin(y.start));
      for (let i = 1; i < l.length; i++) if (E.toMin(l[i].start) < E.toMin(l[i - 1].end)) throw new Error(E.WD_LONG[k] + ': le fasce delle ' + l[i - 1].start + ' e delle ' + l[i].start + ' si sovrappongono.');
      week[k] = l;
    }
    week[7] = [];
    return week;
  }
  FA.actions['or-add'] = el => {
    const l = A.ui.or.week[el.getAttribute('data-k')], last = l[l.length - 1];
    const s = last ? last.end : '08:00';
    l.push({ kind: last ? 'pausa' : 'amb', start: s, end: E.fromMin(Math.min(E.toMin(s) + 60, 23 * 60 + 55)), label: '' });
    A.ui.or.conf = null; FA.renderModal();
  };
  FA.actions['or-del'] = el => { A.ui.or.week[el.getAttribute('data-k')].splice(Number(el.getAttribute('data-i')), 1); A.ui.or.conf = null; FA.renderModal(); };
  FA.actions['or-copy'] = el => { const f = A.ui.or, src = f.week[el.getAttribute('data-k')]; [1, 2, 3, 4, 5].forEach(k => { f.week[k] = src.map(b => Object.assign({}, b)); }); f.conf = null; FA.renderModal(); };
  async function orCall(dry) {
    const f = A.ui.or;
    return FA.rpc('admin_save_shift', { p_th: f.th, p_valid_from: f.from, p_week: orWeek(), p_note: 'Orario dal tabulato', p_dry_run: dry });
  }
  FA.actions['or-check'] = async () => { const f = A.ui.or; f.error = null; try { f.conf = (await orCall(true)).conflicts; } catch (e) { f.error = e.message; } FA.renderModal(); };
  FA.actions['or-save'] = async () => {
    const f = A.ui.or; f.error = null;
    try { let conf = []; await FA.save('Orario salvato dal ' + E.fmtIt(f.from), async () => { conf = (await orCall(false)).conflicts; }); FA.closeModal(); if (conf.length) FA.toast(conf.length + ' pazienti da ricollocare: li trovi nella spia rossa.', 'warn'); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
})();
