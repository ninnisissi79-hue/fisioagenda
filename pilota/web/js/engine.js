/*
 * FisioAgenda pilota — motore delle proposte (solo calcolo, nessuna interfaccia).
 * Rispecchia le regole del server (app.check_slot) per proporre soluzioni;
 * la conferma è sempre ricontrollata dal server, che decide.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FAE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- date e orari (date di calendario, ora locale di Roma) ---------------- */
  const DAY_MS = 86400000;
  const pad = n => String(n).padStart(2, '0');
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function fmtDate(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { return fmtDate(parseDate(s) + n * DAY_MS); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY_MS); }
  function weekday(s) { const w = new Date(parseDate(s)).getUTCDay(); return w === 0 ? 7 : w; }
  function toMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
  function fromMin(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function hhmm(t) { return t ? String(t).slice(0, 5) : t; }
  function todayRome(now) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now || new Date());
    const g = k => p.find(x => x.type === k).value;
    return g('year') + '-' + g('month') + '-' + g('day');
  }
  const WD_SHORT = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const WD_LONG = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  function fmtIt(s) { if (!s) return '—'; const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; }
  function fmtItDay(s) { if (!s) return '—'; const [, m, d] = s.split('-'); return WD_SHORT[weekday(s)] + ' ' + d + '/' + m; }
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

  /* ---------------- costanti di dominio ---------------- */
  const OCCUPYING = new Set(['programmata', 'effettuata', 'trattenuta']);
  const STATUS = {
    programmata: 'Programmata', effettuata: 'Effettuata', assente: 'Assenza paziente', annullata: 'Annullata',
    da_riprogrammare: 'Da riprogrammare', trattenuta: 'Sospesa · posto mantenuto', liberata: 'Posto liberato', spostata: 'Spostata (traccia)'
  };
  // tipi di fascia del calendario: solo "amb" riceve pazienti
  const BLOCK = { amb: 'Ambulatorio', reparto: 'Reparto', pausa: 'Pausa', documentazione: 'Cartelle / adempimenti', segreteria: 'Segreteria',
    corso: 'Corso obbligatorio', permesso_ore: 'Permesso a ore', recupero_ore: 'Recupero ore', briefing: 'Briefing', preparazione: 'Preparazione', altro: 'Altra attività' };
  const PRIORITY = { U: 'U – Urgente', B: 'B – Breve', D: 'D – Differibile', P: 'P – Programmabile', NI: 'Non indicata' };
  const PRIORITY_ORDER = ['U', 'B', 'D', 'P', 'NI'];
  const REQUEST = { prima: 'Prima seduta', continuazione: 'Continuazione ciclo' };
  const FORECAST = { da_valutare: 'Da valutare', prosecuzione: 'Prosecuzione prevista', probabile_conclusione: 'Probabile conclusione', conclusione_confermata: 'Conclusione confermata' };
  const SUSPENSION = { ticket: 'Ticket non regolarizzato', clinico: 'Motivo clinico', paziente: 'Indisponibilità del paziente', altro: 'Altro' };
  const CYCLE_STATUS = { in_attesa: 'In lista d’attesa', attivo: 'Attivo', sospeso: 'Sospeso', chiuso: 'Chiuso' };
  const ABSENCE_KIND = { malattia: 'Malattia', ferie: 'Ferie', permesso: 'Permesso', formazione: 'Formazione', altro: 'Altro' };
  const SESSION_PRESETS = [5, 10, 20, 30];
  const DURATIONS = [30, 45];

  /* ---------------- indice dei dati ---------------- */
  function normalize(data) {
    (data.appointments || []).forEach(a => { a.start_time = hhmm(a.start_time); a.end_time = hhmm(a.end_time); });
    (data.cycles || []).forEach(c => { c.start_time = hhmm(c.start_time); });
    (data.absences || []).forEach(a => { a.start_time = hhmm(a.start_time); a.end_time = hhmm(a.end_time); });
    return data;
  }

  function makeCtx(data, opts) {
    opts = opts || {};
    const ctx = { data, today: opts.today || todayRome() };
    ctx.th = new Map((data.therapists || []).map(t => [t.id, t]));
    ctx.cat = new Map((data.categories || []).map(c => [c.id, c]));
    ctx.pat = new Map((data.patients || []).map(p => [p.id, p]));
    ctx.cyc = new Map((data.cycles || []).map(c => [c.id, c]));
    ctx.appt = new Map((data.appointments || []).map(a => [a.id, a]));
    ctx.closures = new Map((data.closures || []).map(c => [c.day, c.label]));
    ctx.skills = new Map();
    (data.therapist_skills || []).forEach(s => {
      if (!ctx.skills.has(s.therapist_id)) ctx.skills.set(s.therapist_id, new Map());
      ctx.skills.get(s.therapist_id).set(s.category_id, s.level);
    });
    ctx.shifts = new Map();
    (data.shift_versions || []).forEach(v => {
      if (!ctx.shifts.has(v.therapist_id)) ctx.shifts.set(v.therapist_id, []);
      ctx.shifts.get(v.therapist_id).push(v);
    });
    ctx.shifts.forEach(list => list.sort((a, b) => a.valid_from < b.valid_from ? 1 : -1));
    ctx.overrides = new Map((data.day_overrides || []).map(o => [o.therapist_id + '|' + o.day, o]));
    ctx.absences = new Map();
    (data.absences || []).filter(a => !a.cancelled).forEach(a => {
      if (!ctx.absences.has(a.therapist_id)) ctx.absences.set(a.therapist_id, []);
      ctx.absences.get(a.therapist_id).push(a);
    });
    ctx.byThDay = new Map(); ctx.byPatDay = new Map(); ctx.lastByCycle = new Map(); ctx.byCycle = new Map();
    (data.appointments || []).forEach(a => {
      if (!ctx.byCycle.has(a.cycle_id)) ctx.byCycle.set(a.cycle_id, []);
      ctx.byCycle.get(a.cycle_id).push(a);
      if (!OCCUPYING.has(a.status)) return;
      push(ctx.byThDay, a.therapist_id + '|' + a.day, a);
      push(ctx.byPatDay, a.patient_id + '|' + a.day, a);
      const l = ctx.lastByCycle.get(a.cycle_id);
      if (!l || a.day > l) ctx.lastByCycle.set(a.cycle_id, a.day);
    });
    ctx.byCycle.forEach(l => l.sort((a, b) => (a.day + a.start_time) < (b.day + b.start_time) ? -1 : 1));
    ctx.activeCyclesByTh = new Map();
    (data.cycles || []).forEach(c => { if (c.status === 'attivo' && c.therapist_id) push(ctx.activeCyclesByTh, c.therapist_id, c); });
    // visite fisiatriche (eventi del paziente, non sedute)
    ctx.events = new Map((data.patient_events || []).map(e => [e.patient_id + '|' + e.day, e]));
    return ctx;
  }
  function push(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); }

  function skillLevel(ctx, thId, catId) { const m = ctx.skills.get(thId); return (m && m.get(catId)) || null; }
  function therapistName(ctx, id) { const t = ctx.th.get(id); return t ? t.name : '—'; }
  function patientName(ctx, id) { const p = ctx.pat.get(id); return p ? p.name : '—'; }
  function categoryName(ctx, id) { const c = ctx.cat.get(id); return c ? c.name : id; }

  /** Turno valido in quella data (la decorrenza più recente non successiva). */
  function shiftFor(ctx, thId, day) {
    const list = ctx.shifts.get(thId) || [];
    return list.find(v => v.valid_from <= day) || null;
  }
  /** Fasce della giornata: variazione giornaliera se presente, altrimenti turno. */
  function dayBlocks(ctx, thId, day) {
    const ov = ctx.overrides.get(thId + '|' + day);
    let blocks;
    if (ov) blocks = ov.blocks;
    else { const v = shiftFor(ctx, thId, day); blocks = v ? (v.week[String(weekday(day))] || []) : []; }
    return (blocks || []).map(b => ({ kind: b.kind, start: hhmm(b.start), end: hhmm(b.end), max: b.max == null || b.max === '' ? null : Number(b.max) }))
      .sort((a, b) => toMin(a.start) - toMin(b.start));
  }
  function absenceAt(ctx, thId, day, s, e) {
    return (ctx.absences.get(thId) || []).find(a => a.start_date <= day && (!a.end_date || a.end_date >= day) &&
      (!a.start_time || overlaps(toMin(a.start_time), toMin(a.end_time), s, e))) || null;
  }
  function absenceOnDay(ctx, thId, day) {
    return (ctx.absences.get(thId) || []).filter(a => a.start_date <= day && (!a.end_date || a.end_date >= day));
  }

  /**
   * Controllo di un posto (stesse regole del server). extra = prenotazioni ipotetiche
   * della proposta in corso: [{therapist_id, day, start, end, patient_id, ref}].
   * Restituisce null se il posto è utilizzabile, altrimenti {code, msg, ref?}.
   */
  function checkSlot(ctx, thId, day, start, end, o) {
    o = o || {};
    const s = toMin(start), e = toMin(end);
    const th = ctx.th.get(thId);
    if (!(e > s)) return { code: 'orario', msg: 'Orario non valido.' };
    if (!th) return { code: 'inesistente', msg: 'Fisioterapista inesistente.' };
    if (!th.active) return { code: 'inattivo', msg: th.name + ' non è attivo.' };
    if (ctx.closures.has(day)) return { code: 'chiusura', msg: 'Servizio chiuso il ' + fmtIt(day) + ' (' + ctx.closures.get(day) + ').' };
    const ab = absenceAt(ctx, thId, day, s, e);
    if (ab) return { code: 'assenza', msg: th.name + ' è assente' + (ab.start_time ? ' dalle ' + ab.start_time + ' alle ' + ab.end_time : '') + (ab.end_date ? '' : ' (rientro non noto)') + '.' };
    const blocks = dayBlocks(ctx, thId, day);
    const blk = blocks.find(b => b.kind === 'amb' && toMin(b.start) <= s && toMin(b.end) >= e);
    if (!blk) {
      if (!blocks.length) return { code: 'fuori_turno', msg: th.name + ' non è in servizio il ' + fmtIt(day) + '.' };
      const other = blocks.find(b => b.kind !== 'amb' && overlaps(toMin(b.start), toMin(b.end), s, e));
      if (other) return { code: 'blocco', msg: 'Orario non disponibile: ' + BLOCK[other.kind].toLowerCase() + ' ' + other.start + '–' + other.end + ' di ' + th.name + '.' };
      return { code: 'fuori_turno', msg: 'Orario fuori dalle fasce ambulatoriali di ' + th.name + '.' };
    }
    const ign = o.ignoreId;
    const real = (ctx.byThDay.get(thId + '|' + day) || []).filter(a => a.id !== ign && !(o.ignoreIds && o.ignoreIds.has(a.id)));
    const extra = (o.extra || []).filter(x => x.therapist_id === thId && x.day === day);
    const busy = real.find(a => overlaps(toMin(a.start_time), toMin(a.end_time), s, e));
    if (busy) return { code: 'occupato', msg: 'Posto già occupato: ' + th.name + ' ha ' + patientName(ctx, busy.patient_id) + ' ' + busy.start_time + '–' + busy.end_time + '.' };
    const busyX = extra.find(x => overlaps(toMin(x.start), toMin(x.end), s, e));
    if (busyX) return { code: 'alternativa', ref: busyX.ref, msg: 'Stesso posto già scelto per ' + patientName(ctx, busyX.patient_id) + ': sono alternative.' };
    if (o.patientId) {
      const pb = (ctx.byPatDay.get(o.patientId + '|' + day) || []).find(a => a.id !== ign && !(o.ignoreIds && o.ignoreIds.has(a.id)) && overlaps(toMin(a.start_time), toMin(a.end_time), s, e));
      if (pb) return { code: 'paziente', msg: 'Il paziente ha già un appuntamento ' + pb.start_time + '–' + pb.end_time + ' con ' + therapistName(ctx, pb.therapist_id) + '.' };
      const px = (o.extra || []).find(x => x.patient_id === o.patientId && x.day === day && overlaps(toMin(x.start), toMin(x.end), s, e));
      if (px) return { code: 'alternativa', ref: px.ref, msg: 'Il paziente ha già un\'altra proposta allo stesso orario.' };
    }
    if (blk.max != null) {
      const inBlk = x => toMin(x.s) >= toMin(blk.start) && toMin(x.e) <= toMin(blk.end);
      const n = real.filter(a => inBlk({ s: a.start_time, e: a.end_time })).length;
      const nx = extra.filter(x => inBlk({ s: x.start, e: x.end }));
      if (n >= blk.max) return { code: 'max_fascia', msg: 'La fascia ' + blk.start + '–' + blk.end + ' di ' + th.name + ' accoglie al massimo ' + blk.max + ' paziente/i.' };
      if (n + nx.length >= blk.max) return { code: 'alternativa', ref: nx[0].ref, msg: 'La fascia ' + blk.start + '–' + blk.end + ' è già usata da un\'altra proposta: sono alternative.' };
    }
    if (th.max_daily != null) {
      if (real.length >= th.max_daily) return { code: 'max_giorno', msg: th.name + ' ha già ' + real.length + ' pazienti il ' + fmtIt(day) + ' (limite giornaliero ' + th.max_daily + ').' };
      if (real.length + extra.length >= th.max_daily) return { code: 'alternativa', ref: extra[0].ref, msg: 'Limite giornaliero di ' + th.name + ' già raggiunto da un\'altra proposta: sono alternative.' };
    }
    if (o.reserve !== false) {
      const cst = c => hhmm((c.weekday_times || {})[String(weekday(day))]) || c.start_time;
      const c = (ctx.activeCyclesByTh.get(thId) || []).find(c => c.id !== o.cycleId && c.forecast !== 'conclusione_confermata' && c.start_time &&
        (c.weekdays || []).includes(weekday(day)) && overlaps(toMin(cst(c)), toMin(cst(c)) + c.duration, s, e) &&
        ctx.lastByCycle.has(c.id) && day > ctx.lastByCycle.get(c.id));
      if (c) return { code: 'probabile', cycleId: c.id, msg: 'Posto solo probabile: si libera se il ciclo di ' + patientName(ctx, c.patient_id) + ' si conclude (previsione: ' + FORECAST[c.forecast].toLowerCase() + '). Non è una disponibilità certa.' };
    }
    return null;
  }

  /** Orari di inizio "naturali" in una giornata: inizio fascia, a ridosso di altri appuntamenti, ogni 15 minuti. */
  function candidateStarts(ctx, thId, day, dur, grid) {
    const out = new Set();
    const step = grid || 15;
    dayBlocks(ctx, thId, day).filter(b => b.kind === 'amb').forEach(b => {
      const bs = toMin(b.start), be = toMin(b.end);
      for (let m = bs; m + dur <= be; m += step) out.add(m);
      if (be - dur >= bs) out.add(be - dur);
      (ctx.byThDay.get(thId + '|' + day) || []).forEach(a => {
        const ae = toMin(a.end_time), as = toMin(a.start_time);
        if (ae >= bs && ae + dur <= be) out.add(ae);
        if (as - dur >= bs && as <= be) out.add(as - dur);
      });
    });
    return [...out].sort((a, b) => a - b).map(fromMin);
  }

  /* ---------------- sostituzioni ---------------- */
  const LEVEL_RANK = { specifica: 0, abilitato: 1 };

  /** Opzioni di sostituzione per un appuntamento: stesso orario prima, poi cambi di orario nello stesso giorno. */
  function substitutionOptions(ctx, appt, o) {
    o = o || {};
    const cyc = ctx.cyc.get(appt.cycle_id);
    const dur = toMin(appt.end_time) - toMin(appt.start_time);
    const sameTime = [], otherTime = [], blocked = [];
    const absentId = o.absentTherapistId || appt.therapist_id;
    [...ctx.th.values()].filter(t => t.active && t.id !== absentId).forEach(t => {
      const level = skillLevel(ctx, t.id, cyc.category_id);
      if (!level) return;
      const base = { therapist_id: t.id, level, load: (ctx.byThDay.get(t.id + '|' + appt.day) || []).length };
      const chk = checkSlot(ctx, t.id, appt.day, appt.start_time, appt.end_time,
        { patientId: appt.patient_id, ignoreId: appt.id, cycleId: appt.cycle_id, extra: o.extra });
      if (!chk) { sameTime.push(Object.assign({ start: appt.start_time, end: appt.end_time, sameTime: true }, base)); return; }
      blocked.push(Object.assign({ reason: chk.msg, code: chk.code }, base));
      if (o.noTimeChange) return;
      let best = null;
      candidateStarts(ctx, t.id, appt.day, dur).forEach(st => {
        const en = fromMin(toMin(st) + dur);
        if (checkSlot(ctx, t.id, appt.day, st, en, { patientId: appt.patient_id, ignoreId: appt.id, cycleId: appt.cycle_id, extra: o.extra })) return;
        const delta = Math.abs(toMin(st) - toMin(appt.start_time));
        if (!best || delta < best.delta) best = Object.assign({ start: st, end: en, sameTime: false, delta }, base);
      });
      if (best) otherTime.push(best);
    });
    const byPref = (a, b) => (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) || (a.load - b.load) || therapistName(ctx, a.therapist_id).localeCompare(therapistName(ctx, b.therapist_id));
    sameTime.sort(byPref);
    otherTime.sort((a, b) => (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) || (a.delta - b.delta) || (a.load - b.load));
    return { sameTime, otherTime, blocked };
  }

  function noSolutionReason(ctx, appt, opt) {
    const cyc = ctx.cyc.get(appt.cycle_id);
    const enabled = [...ctx.th.values()].filter(t => t.active && t.id !== appt.therapist_id && skillLevel(ctx, t.id, cyc.category_id));
    if (!enabled.length) return 'Nessun altro collega è abilitato al percorso ' + categoryName(ctx, cyc.category_id) + '.';
    return 'Nessun collega abilitato al percorso ' + categoryName(ctx, cyc.category_id) + ' è libero il ' + fmtIt(appt.day) +
      ' (' + enabled.length + ' abilitati: occupati, assenti o fuori turno), nemmeno cambiando orario.';
  }

  /**
   * Proposta complessiva: assegna i pazienti tra uno o più sostituti senza usare due volte lo stesso posto.
   * Preferenze: stesso orario, competenza specifica, stesso sostituto per lo stesso paziente (continuità),
   * distribuzione del carico. Se non c'è soluzione: da riprogrammare con il motivo.
   */
  function proposeDistribution(ctx, appts, o) {
    o = o || {};
    const extra = [];
    const choice = new Map();
    const usedByPatient = new Map();
    const added = new Map();
    const opts0 = new Map(appts.map(a => [a.id, substitutionOptions(ctx, a, o)]));
    const order = appts.slice().sort((a, b) => {
      const oa = opts0.get(a.id), ob = opts0.get(b.id);
      return (oa.sameTime.length + oa.otherTime.length) - (ob.sameTime.length + ob.otherTime.length) ||
        (a.day + a.start_time < b.day + b.start_time ? -1 : 1);
    });
    order.forEach(a => {
      const opt = substitutionOptions(ctx, a, Object.assign({}, o, { extra }));
      const prev = usedByPatient.get(a.patient_id);
      const score = c => (c.sameTime ? 0 : 1000 + c.delta) + LEVEL_RANK[c.level] * 100 +
        (prev && prev === c.therapist_id ? -50 : 0) + (added.get(c.therapist_id + '|' + a.day) || 0) * 10 + c.load;
      const all = opt.sameTime.concat(opt.otherTime).sort((x, y) => score(x) - score(y));
      const pick = all[0];
      if (pick) {
        choice.set(a.id, { action: 'sostituisci', therapist_id: pick.therapist_id, day: a.day, start: pick.start, end: pick.end, sameTime: pick.sameTime, level: pick.level });
        extra.push({ therapist_id: pick.therapist_id, day: a.day, start: pick.start, end: pick.end, patient_id: a.patient_id, ref: a.id });
        usedByPatient.set(a.patient_id, pick.therapist_id);
        added.set(pick.therapist_id + '|' + a.day, (added.get(pick.therapist_id + '|' + a.day) || 0) + 1);
      } else {
        choice.set(a.id, { action: 'da_riprogrammare', reason: noSolutionReason(ctx, a, opt) });
      }
    });
    return choice;
  }

  /**
   * Verifica di un insieme di scelte modificate dall'operatore: ogni scelta è controllata
   * considerando anche tutte le altre. Due scelte sullo stesso posto sono segnalate come alternative.
   */
  function validateSelections(ctx, appts, selections) {
    const res = new Map();
    const list = appts.filter(a => selections.get(a.id) && selections.get(a.id).action === 'sostituisci');
    appts.forEach(a => {
      const s = selections.get(a.id);
      if (!s) { res.set(a.id, { ok: false, msg: 'Scegli una soluzione.' }); return; }
      if (s.action !== 'sostituisci') { res.set(a.id, { ok: true }); return; }
      const extra = list.filter(b => b.id !== a.id).map(b => { const sb = selections.get(b.id); return { therapist_id: sb.therapist_id, day: sb.day, start: sb.start, end: sb.end, patient_id: b.patient_id, ref: b.id }; });
      const ignoreIds = new Set(appts.map(x => x.id));
      const chk = checkSlot(ctx, s.therapist_id, s.day, s.start, s.end, { patientId: a.patient_id, ignoreId: a.id, ignoreIds, cycleId: a.cycle_id, extra });
      res.set(a.id, chk ? { ok: false, msg: chk.msg, alternativeOf: chk.ref || null } : { ok: true });
    });
    return res;
  }

  /** Appuntamenti toccati da un'assenza (tra le date indicate). */
  function affectedByAbsence(ctx, abs, untilDay, o) {
    const last = abs.end_date || abs.plan_until || untilDay;
    return (ctx.data.appointments || []).filter(a => a.therapist_id === abs.therapist_id && a.status === (o && o.status || 'programmata') &&
      a.day >= abs.start_date && a.day <= last && a.day >= ctx.today &&
      (!abs.start_time || overlaps(toMin(abs.start_time), toMin(abs.end_time), toMin(a.start_time), toMin(a.end_time))))
      .sort((a, b) => (a.day + a.start_time) < (b.day + b.start_time) ? -1 : 1);
  }
  /** Assenza senza rientro: appuntamenti successivi alla data organizzata, da verificare. */
  function toVerifyAfter(ctx, abs) {
    if (abs.end_date || !abs.plan_until) return [];
    return (ctx.data.appointments || []).filter(a => a.therapist_id === abs.therapist_id && OCCUPYING.has(a.status) && a.day > abs.plan_until &&
      (!abs.start_time || overlaps(toMin(abs.start_time), toMin(abs.end_time), toMin(a.start_time), toMin(a.end_time))));
  }

  /* ---------------- cicli ---------------- */
  /** Date di un ciclo: giorni indicati, saltando chiusure e festività. */
  function cycleDates(ctx, from, weekdays, n) {
    const out = []; let d = from; let guard = 0;
    while (out.length < n && guard++ < 800) {
      if (weekdays.includes(weekday(d)) && !ctx.closures.has(d)) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  /**
   * Ricerca di un posto per un ciclo intero: stesso fisioterapista e stesso orario per tutte le date.
   * Restituisce opzioni certe (prenotabili) e probabili (non prenotabili).
   */
  function searchCycle(ctx, req) {
    const from = req.from && req.from > ctx.today ? req.from : ctx.today;
    const weeks = req.weeks || 12;
    const dur = Number(req.duration);
    const n = Number(req.sessions);
    const out = [];
    [...ctx.th.values()].filter(t => t.active).forEach(t => {
      const level = skillLevel(ctx, t.id, req.categoryId);
      if (!level) return;
      const found = new Map();
      for (let w = 0; w < weeks; w++) {
        const start = addDays(from, w * 7);
        const dates = cycleDates(ctx, start, req.weekdays, n);
        if (dates.length < n) continue;
        const times = new Set();
        req.weekdays.forEach(wd => {
          const d = dates.find(x => weekday(x) === wd);
          if (d) candidateStarts(ctx, t.id, d, dur, 30).forEach(x => times.add(x));
        });
        [...times].forEach(st => {
          if (found.has(st)) return;
          if (req.prefFrom && req.prefStrict && toMin(st) < toMin(req.prefFrom)) return;
          if (req.prefTo && req.prefStrict && toMin(st) + dur > toMin(req.prefTo)) return;
          const en = fromMin(toMin(st) + dur);
          let status = 'certo'; const deps = new Set(); let fail = null;
          for (const d of dates) {
            const chk = checkSlot(ctx, t.id, d, st, en, { patientId: req.patientId, cycleId: req.cycleId });
            if (!chk) continue;
            if (chk.code === 'probabile') { status = 'probabile'; deps.add(chk.cycleId); continue; }
            fail = chk; break;
          }
          if (fail) return;
          const inPref = (!req.prefFrom || toMin(st) >= toMin(req.prefFrom)) && (!req.prefTo || toMin(st) + dur <= toMin(req.prefTo));
          found.set(st, { therapist_id: t.id, level, start: st, end: en, dates, firstDate: dates[0], lastDate: dates[dates.length - 1], status, dependsOn: [...deps], inPref });
        });
        if ([...found.values()].some(x => x.status === 'certo')) break;
      }
      const list = [...found.values()].sort((a, b) => (a.status === b.status ? 0 : a.status === 'certo' ? -1 : 1) ||
        (a.inPref === b.inPref ? 0 : a.inPref ? -1 : 1) || (a.firstDate < b.firstDate ? -1 : a.firstDate > b.firstDate ? 1 : 0) || toMin(a.start) - toMin(b.start));
      list.filter(x => x.status === 'certo').slice(0, 2).forEach(x => out.push(x));
      list.filter(x => x.status === 'probabile').slice(0, 2).forEach(x => out.push(x));
    });
    out.sort((a, b) => (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) || (a.status === b.status ? 0 : a.status === 'certo' ? -1 : 1) ||
      (a.inPref === b.inPref ? 0 : a.inPref ? -1 : 1) || (a.firstDate < b.firstDate ? -1 : a.firstDate > b.firstDate ? 1 : 0) || toMin(a.start) - toMin(b.start));
    return out;
  }

  /** Posti liberi di una giornata per un fisioterapista (per spostamenti e recuperi). */
  function freeStarts(ctx, thId, day, dur, o) {
    o = o || {};
    return candidateStarts(ctx, thId, day, dur).filter(st => !checkSlot(ctx, thId, day, st, fromMin(toMin(st) + dur),
      { patientId: o.patientId, ignoreId: o.ignoreId, cycleId: o.cycleId }));
  }

  /** Posti certi da 30 minuti ancora liberi in una giornata (riepilogo). */
  function freeSeats(ctx, day) {
    let total = 0; const per = [];
    [...ctx.th.values()].filter(t => t.active).forEach(t => {
      const used = [];
      let n = 0;
      candidateStarts(ctx, t.id, day, 30).forEach(st => {
        const s = toMin(st);
        if (used.some(u => overlaps(u, u + 30, s, s + 30))) return;
        const extra = used.map(u => ({ therapist_id: t.id, day, start: fromMin(u), end: fromMin(u + 30) }));
        if (checkSlot(ctx, t.id, day, st, fromMin(s + 30), { extra })) return;
        used.push(s); n++;
      });
      if (n) per.push({ therapist_id: t.id, n });
      total += n;
    });
    return { total, per };
  }

  /** Conteggi del ciclo: programmate, svolte, assenze, annullate, recuperi, da riprogrammare. */
  function cycleCounts(ctx, cycleId) {
    const list = ctx.byCycle.get(cycleId) || [];
    const c = { effettuate: 0, programmate: 0, trattenute: 0, assenze: 0, annullate: 0, daRecuperare: 0, recuperi: 0, daRiprogrammare: 0, liberate: 0, spostate: 0 };
    list.forEach(a => {
      if (a.status === 'effettuata') c.effettuate++;
      else if (a.status === 'programmata') c.programmate++;
      else if (a.status === 'trattenuta') c.trattenute++;
      else if (a.status === 'assente') c.assenze++;
      else if (a.status === 'annullata') c.annullate++;
      else if (a.status === 'da_riprogrammare') c.daRiprogrammare++;
      else if (a.status === 'liberata') c.liberate++;
      else if (a.status === 'spostata') c.spostate++;
      if ((a.status === 'assente' || a.status === 'annullata') && a.to_recover && !a.recovered_by) c.daRecuperare++;
      if (a.recovery_of) c.recuperi++;
    });
    const cyc = ctx.cyc.get(cycleId);
    const planned = cyc ? cyc.planned_sessions : 0;
    // sedute già svolte prima dell'inserimento nel pilota (ciclo in corso): contano come effettuate
    c.precedenti = cyc ? (cyc.prior_sessions || 0) : 0;
    c.effettuate += c.precedenti;
    c.previste = planned;
    c.mancanoDaProgrammare = Math.max(0, planned - c.effettuate - c.programmate - c.trattenute - c.daRiprogrammare - c.daRecuperare);
    return c;
  }

  /**
   * Numero della seduta nel ciclo (1 = prima): sedute precedenti + posizione tra quelle che
   * consumano un numero (effettuate, programmate, trattenute, da riprogrammare). I recuperi → 'R'.
   */
  function sessionNumber(ctx, a) {
    if (a.recovery_of || a.sheet_mark === 'R') return 'R';
    const c = ctx.cyc.get(a.cycle_id);
    if (!c) return null;
    const counting = x => !x.recovery_of && x.sheet_mark !== 'R' && (OCCUPYING.has(x.status) || x.status === 'da_riprogrammare');
    if (!counting(a)) return null;
    const list = (ctx.byCycle.get(a.cycle_id) || []).filter(counting);
    return (c.prior_sessions || 0) + list.indexOf(a) + 1;
  }

  /** Attività da sistemare calcolate dai dati (le incompatibilità vengono dal server). */
  function cycleTodos(ctx) {
    const out = [];
    (ctx.data.cycles || []).forEach(c => {
      const name = patientName(ctx, c.patient_id);
      if (c.status === 'sospeso' && c.review_date && c.review_date <= addDays(ctx.today, 2))
        out.push({ kind: 'rivalutazione', cycle_id: c.id, day: c.review_date, msg: name + ': rivalutare la sospensione (' + fmtIt(c.review_date) + ').' });
      if (c.status === 'attivo') {
        const last = ctx.lastByCycle.get(c.id);
        const cnt = cycleCounts(ctx, c.id);
        if (c.forecast !== 'conclusione_confermata' && (!last || last < ctx.today) && cnt.programmate === 0)
          out.push({ kind: 'esito_ciclo', cycle_id: c.id, msg: name + ': sedute terminate, indicare se il ciclo si conclude o prosegue (il posto resta solo probabile).' });
      }
    });
    (ctx.data.absences || []).filter(a => !a.cancelled && !a.end_date && a.plan_until && a.plan_until <= addDays(ctx.today, 2))
      .forEach(a => out.push({ kind: 'assenza_aperta', absence_id: a.id, msg: therapistName(ctx, a.therapist_id) + ': rientro non noto, sostituzioni organizzate fino al ' + fmtIt(a.plan_until) + '. Aggiornare.' }));
    return out;
  }

  return {
    DAY_MS, parseDate, fmtDate, addDays, diffDays, weekday, toMin, fromMin, hhmm, todayRome, fmtIt, fmtItDay, overlaps,
    WD_SHORT, WD_LONG, OCCUPYING, STATUS, BLOCK, PRIORITY, PRIORITY_ORDER, REQUEST, FORECAST, SUSPENSION, CYCLE_STATUS, ABSENCE_KIND,
    SESSION_PRESETS, DURATIONS,
    normalize, makeCtx, skillLevel, therapistName, patientName, categoryName, shiftFor, dayBlocks, absenceAt, absenceOnDay,
    checkSlot, candidateStarts, substitutionOptions, proposeDistribution, validateSelections, affectedByAbsence, toVerifyAfter,
    cycleDates, searchCycle, freeStarts, freeSeats, cycleCounts, cycleTodos, sessionNumber
  };
});
