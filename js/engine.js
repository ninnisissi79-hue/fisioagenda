/*
 * FisioAgenda — motore di disponibilità.
 *
 * Questo file NON contiene interfaccia: solo regole verificabili.
 * Funziona sia nel browser (window.FisioEngine) sia in Node (require) per i test.
 *
 * Convenzioni su date e orari (fuso Europe/Rome):
 *  - le date sono stringhe di calendario 'YYYY-MM-DD' (nessun fuso, nessuna ora);
 *  - gli orari sono minuti dalla mezzanotte locale (es. 07:15 = 435) o stringhe 'HH:MM';
 *  - l'aritmetica sulle date usa Date.UTC solo per contare i giorni: un appuntamento
 *    alle 07:15 resta alle 07:15 anche nei giorni del cambio d'ora.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FisioEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Date e orari                                                         */
  /* ------------------------------------------------------------------ */
  const DAY_MS = 86400000;
  function pad(n) { return String(n).padStart(2, '0'); }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fmtDate(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function addDays(s, n) { return fmtDate(parseDate(s) + n * DAY_MS); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY_MS); }
  /** 1 = lunedì ... 7 = domenica */
  function weekday(s) { const w = new Date(parseDate(s)).getUTCDay(); return w === 0 ? 7 : w; }
  function mondayOf(s) { return addDays(s, 1 - weekday(s)); }
  function toMin(hhmm) {
    if (typeof hhmm === 'number') return hhmm;
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  }
  function fromMin(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  /** Data odierna nel fuso Europe/Rome, indipendentemente dal fuso del computer. */
  function todayRome(now) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now || new Date());
    const get = t => parts.find(p => p.type === t).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  const WEEKDAY_SHORT = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const WEEKDAY_LONG = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  function fmtIt(s) { if (!s) return '—'; const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; }
  function fmtItShort(s) { if (!s) return '—'; const [, m, d] = s.split('-'); return d + '/' + m; }
  function weekdaysLabel(wds) {
    const k = [...wds].sort().join(',');
    if (k === '1,3,5') return 'Lun-Mer-Ven';
    if (k === '2,4') return 'Mar-Gio';
    return [...wds].sort().map(w => WEEKDAY_SHORT[w]).join('-');
  }
  function overlaps(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

  /** Pasqua (algoritmo gregoriano anonimo) */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + pad(month) + '-' + pad(day);
  }
  function italianHolidays(y) {
    return [
      [y + '-01-01', 'Capodanno'], [y + '-01-06', 'Epifania'],
      [addDays(easter(y), 1), "Lunedì dell'Angelo"], [y + '-04-25', 'Festa della Liberazione'],
      [y + '-05-01', 'Festa del Lavoro'], [y + '-06-02', 'Festa della Repubblica'],
      [y + '-08-15', 'Ferragosto'], [y + '-11-01', 'Ognissanti'],
      [y + '-12-08', 'Immacolata Concezione'], [y + '-12-25', 'Natale'], [y + '-12-26', 'Santo Stefano']
    ].map(([date, label]) => ({ date, label, type: 'festivita' }));
  }

  /* ------------------------------------------------------------------ */
  /* Costanti di dominio                                                  */
  /* ------------------------------------------------------------------ */
  const BLOCK_TYPES = {
    amb: { label: 'Ambulatorio', bookable: true },
    est: { label: 'Estensione da confermare', bookable: true, extension: true },
    reparto: { label: 'Reparto', protected: true },
    pausa: { label: 'Pausa', protected: true },
    cartelle: { label: 'Cartelle / documentazione', protected: true },
    altro: { label: 'Altra attività', protected: true }
  };
  const PROFILES = {
    reparto7: 'Ambulatorio + reparto, ingresso 7:00',
    reparto8: 'Ambulatorio + reparto, ingresso 8:00',
    ambulatorio: 'Solo ambulatorio'
  };
  const SESSION_STATUS = {
    programmata: 'Programmata',
    effettuata: 'Effettuata',
    assente: 'Assenza paziente',
    annullata: 'Annullata dal servizio',
    da_recuperare: 'Da recuperare',
    recuperata: 'Recuperata (sostituita da recupero)'
  };
  /** Stati che occupano realmente il posto in agenda */
  const OCCUPYING = new Set(['programmata', 'effettuata']);
  /** Stati che contano nel numero di sedute del ciclo (una "recuperata" è contata dal suo recupero) */
  const COUNTED = new Set(['programmata', 'effettuata', 'assente', 'da_recuperare']);

  const FORECAST = {
    da_valutare: 'Da valutare',
    prosecuzione: 'Prosecuzione prevista',
    probabile_conclusione: 'Probabile conclusione a fine ciclo',
    conclusione_confermata: 'Conclusione confermata',
    sospensione: 'Sospensione temporanea',
    interruzione: 'Interruzione / conclusione anticipata',
    non_avviato: 'Presa in carico non avviata'
  };
  const CLOSED_FORECASTS = new Set(['conclusione_confermata', 'interruzione', 'non_avviato']);

  const WAITLIST_STATUS = {
    in_attesa: 'In attesa',
    contattato: 'Contattato',
    proposta: 'Proposta in valutazione',
    assegnato: 'Assegnato',
    rinuncia: 'Rinuncia'
  };

  /**
   * Categoria di priorità scelta dall'operatore in base alla richiesta (mai dedotta dalla patologia).
   * Serve solo a evidenziare la priorità organizzativa: non è una verifica dei tempi previsti dalla normativa.
   * L'ordine dell'elenco è l'ordine di priorità.
   */
  const PRIORITY_CLASSES = { U: 'U – Urgente', B: 'B – Breve', D: 'D – Differibile', P: 'P – Programmabile', NI: 'Non indicata' };
  const PRIORITY_ORDER = ['U', 'B', 'D', 'P', 'NI'];
  /** Tipo di richiesta: solo un'etichetta, non modifica né azzera cicli e sedute. */
  const REQUEST_TYPES = { prima: 'Prima seduta', continuazione: 'Continuazione ciclo' };
  /** Percorsi della mano (categorie organizzative modificabili). */
  const HAND_CATEGORIES = [{ id: 'mano', name: 'Mano' }, { id: 'chir_mano', name: 'Chirurgia della mano / postoperatorio' }];

  const DEFAULT_SETTINGS = {
    defaultDuration: 30,
    sessionPresets: [5, 10, 20, 30],
    searchHorizonWeeks: 16,
    futureThresholdDays: 7,
    reserveWeeks: 4,
    updateThreshold: 3,
    gapDays: 14,
    warn45: { enabled: true, threshold: 2, profiles: ['reparto7', 'reparto8'] },
    priorities: PRIORITY_ORDER,
    templates: {
      reparto7: { ambEnd: '13:20', extEnd: '13:50' },
      reparto8: { ambEnd: '14:45', extEnd: '15:00' },
      ambulatorio: { ambEnd: '14:40', extEnd: '14:45' }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Schemi di turno                                                      */
  /* ------------------------------------------------------------------ */
  function b(type, start, end, extra) { return Object.assign({ type, start, end }, extra || {}); }
  /** Settimana tipo generata da uno schema; ogni giorno resta poi modificabile. */
  function buildDay(profile, settings) {
    const t = (settings && settings.templates) || DEFAULT_SETTINGS.templates;
    if (profile === 'reparto7') {
      const p = t.reparto7 || DEFAULT_SETTINGS.templates.reparto7;
      return {
        in: '07:00', out: '14:12', blocks: [
          b('cartelle', '07:00', '07:15', { note: 'Preparazione' }),
          b('amb', '07:15', '09:00'),
          b('reparto', '09:00', '12:00', { note: 'Lettura cartelle e reparto' }),
          b('pausa', '12:00', '12:20'),
          b('amb', '12:20', p.ambEnd),
          ...(toMin(p.extEnd) > toMin(p.ambEnd) ? [b('est', p.ambEnd, p.extEnd)] : []),
          b('cartelle', p.extEnd, '14:12')
        ]
      };
    }
    if (profile === 'reparto8') {
      const p = t.reparto8 || DEFAULT_SETTINGS.templates.reparto8;
      return {
        in: '08:00', out: '15:12', blocks: [
          b('cartelle', '08:00', '08:15', { note: 'Preparazione' }),
          b('amb', '08:15', '09:00', { maxPatients: 1, note: 'Un solo paziente al mattino' }),
          b('reparto', '09:00', '12:20'),
          b('pausa', '12:20', '12:40'),
          b('amb', '12:40', p.ambEnd),
          ...(toMin(p.extEnd) > toMin(p.ambEnd) ? [b('est', p.ambEnd, p.extEnd)] : []),
          b('cartelle', p.extEnd, '15:12')
        ]
      };
    }
    // solo ambulatorio (orari indicati dal servizio): ingresso 8:00, pazienti 8:15–14:40/14:45,
    // pausa 12:20–12:40, uscita 15:12
    const p = t.ambulatorio || DEFAULT_SETTINGS.templates.ambulatorio;
    return {
      in: '08:00', out: '15:12', blocks: [
        b('cartelle', '08:00', '08:15', { note: 'Preparazione' }),
        b('amb', '08:15', '12:20'),
        b('pausa', '12:20', '12:40'),
        b('amb', '12:40', p.ambEnd),
        ...(toMin(p.extEnd) > toMin(p.ambEnd) ? [b('est', p.ambEnd, p.extEnd)] : []),
        b('cartelle', p.extEnd, '15:12')
      ]
    };
  }
  function buildWeek(profile, settings) {
    const w = {};
    for (let d = 1; d <= 5; d++) w[d] = buildDay(profile, settings);
    w[6] = null; w[7] = null;
    return w;
  }

  /** Controllo formale di una giornata tipo: fasce dentro il turno e senza sovrapposizioni. */
  function validateDay(day) {
    const errors = [];
    if (!day) return errors;
    const i = toMin(day.in), o = toMin(day.out);
    if (!(o > i)) errors.push('L\'uscita deve essere successiva all\'ingresso.');
    const bl = (day.blocks || []).map(x => ({ ...x, s: toMin(x.start), e: toMin(x.end) })).sort((a, c) => a.s - c.s);
    bl.forEach(x => {
      if (!(x.e > x.s)) errors.push('Fascia ' + x.start + '–' + x.end + ': fine non successiva all\'inizio.');
      if (x.s < i || x.e > o) errors.push('Fascia ' + x.start + '–' + x.end + ' fuori dall\'orario ' + day.in + '–' + day.out + '.');
    });
    for (let k = 1; k < bl.length; k++) {
      if (bl[k].s < bl[k - 1].e) errors.push('Le fasce ' + bl[k - 1].start + '–' + bl[k - 1].end + ' e ' + bl[k].start + '–' + bl[k].end + ' si sovrappongono.');
    }
    return errors;
  }

  /* ------------------------------------------------------------------ */
  /* Indice e accesso ai dati                                             */
  /* ------------------------------------------------------------------ */
  /**
   * Il contesto indicizza lo stato per rendere veloci i controlli.
   * Va ricreato dopo ogni modifica (è economico).
   */
  function makeContext(state, opts) {
    opts = opts || {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
    const closures = new Map((state.closures || []).map(c => [c.date, c]));
    const therapists = new Map(state.therapists.map(t => [t.id, t]));
    const paths = new Map(state.paths.map(p => [p.id, p]));
    const patients = new Map(state.patients.map(p => [p.id, p]));
    const sessionsByThDate = new Map();
    const sessionsByPath = new Map();
    for (const s of state.sessions) {
      const k = s.therapistId + '|' + s.date;
      if (!sessionsByThDate.has(k)) sessionsByThDate.set(k, []);
      sessionsByThDate.get(k).push(s);
      if (!sessionsByPath.has(s.pathId)) sessionsByPath.set(s.pathId, []);
      sessionsByPath.get(s.pathId).push(s);
    }
    for (const arr of sessionsByPath.values()) arr.sort((a, c) => a.date < c.date ? -1 : a.date > c.date ? 1 : toMin(a.start) - toMin(c.start));
    const pathsByTh = new Map();
    const lastDateByPath = new Map();
    for (const p of state.paths) {
      if (!pathsByTh.has(p.therapistId)) pathsByTh.set(p.therapistId, []);
      pathsByTh.get(p.therapistId).push(p);
      const occ = (sessionsByPath.get(p.id) || []).filter(s => OCCUPYING.has(s.status));
      lastDateByPath.set(p.id, occ.length ? occ[occ.length - 1].date : null);
    }
    const absencesByTh = new Map();
    for (const a of state.absences || []) {
      if (!absencesByTh.has(a.therapistId)) absencesByTh.set(a.therapistId, []);
      absencesByTh.get(a.therapistId).push(a);
    }
    return {
      state, settings, closures, therapists, paths, patients, sessionsByThDate, sessionsByPath,
      pathsByTh, lastDateByPath, absencesByTh, today: opts.today || todayRome(), cache: new Map()
    };
  }

  function patientName(ctx, pathId) {
    const p = ctx.paths.get(pathId); if (!p) return '?';
    const pt = ctx.patients.get(p.patientId); return pt ? pt.name : '?';
  }

  function absenceCovers(a, date) {
    return date >= a.startDate && (a.endDate == null || a.endDate === '' || date <= a.endDate);
  }
  function absenceUnknownReturn(a) { return a.endDate == null || a.endDate === ''; }

  /**
   * Programma effettivo di un collega in una data: settimana tipo + eccezioni + chiusure + assenze.
   */
  function getDay(ctx, th, date) {
    const res = { date, working: false, closure: null, blocks: [], absences: [], inMin: null, outMin: null, exception: null };
    const cl = ctx.closures.get(date);
    if (cl) { res.closure = cl; return res; }
    let day = th.week ? th.week[weekday(date)] : null;
    const ex = (th.exceptions || []).find(e => e.date === date);
    if (ex) {
      res.exception = ex;
      day = ex.off ? null : { in: ex.in || (day && day.in), out: ex.out || (day && day.out), blocks: ex.blocks || (day && day.blocks) || [] };
    }
    if (!day) return res;
    res.working = true;
    res.inMin = toMin(day.in); res.outMin = toMin(day.out);
    res.blocks = (day.blocks || []).map(x => ({
      type: x.type, start: toMin(x.start), end: toMin(x.end), maxPatients: x.maxPatients || 0, note: x.note || ''
    })).sort((a, c) => a.start - c.start);
    res.absences = (ctx.absencesByTh.get(th.id) || []).filter(a => absenceCovers(a, date)).map(a => ({
      absence: a,
      start: a.allDay === false && a.startTime ? toMin(a.startTime) : res.inMin,
      end: a.allDay === false && a.endTime ? toMin(a.endTime) : res.outMin,
      unknownReturn: absenceUnknownReturn(a)
    }));
    return res;
  }

  /**
   * Occupazione "virtuale" oltre l'ultima seduta calendarizzata di un percorso,
   * in base alla previsione. Restituisce null se il posto non è occupato in quella data.
   *  - hard: blocca la prenotazione (riserva provvisoria esplicita)
   *  - soft: il posto è libero solo "probabilmente" (dipende dalla conclusione del percorso)
   */
  function virtualOccupancy(ctx, path, date) {
    const last = ctx.lastDateByPath.get(path.id);
    if (!last || date <= last) return null;
    if (!path.weekdays.includes(weekday(date))) return null;
    if (ctx.closures.has(date)) return null;
    const f = path.forecast || { state: 'da_valutare' };
    if (CLOSED_FORECASTS.has(f.state)) return null;
    const start = toMin(path.startTime), end = start + path.duration;
    const base = { start, end, pathId: path.id, therapistId: path.therapistId };
    if (f.state === 'probabile_conclusione') {
      return Object.assign(base, { kind: 'continuazione', hard: false, why: 'probabile conclusione a fine ciclo' });
    }
    if (f.state === 'sospensione') {
      if (!f.keepSlots) return null;
      const until = f.reviewDate || reserveEnd(ctx, path);
      if (date <= until) return Object.assign(base, { kind: 'riserva', hard: true, until, why: 'sospensione con posto mantenuto fino al riesame del ' + fmtIt(until) });
      return Object.assign(base, { kind: 'continuazione', hard: false, why: 'esito del riesame della sospensione' });
    }
    // da_valutare / prosecuzione: riserva provvisoria esplicita e a termine
    const until = reserveEnd(ctx, path);
    if (date <= until) {
      return Object.assign(base, {
        kind: 'riserva', hard: true, until,
        why: (f.state === 'prosecuzione' ? 'prosecuzione prevista' : 'previsione da valutare') + ': riserva provvisoria fino al ' + fmtIt(until)
      });
    }
    return Object.assign(base, { kind: 'continuazione', hard: false, why: 'fine della riserva provvisoria (' + FORECAST[f.state].toLowerCase() + ', da riesaminare)' });
  }
  function reserveEnd(ctx, path) {
    const f = path.forecast || {};
    if (f.reserveUntil) return f.reserveUntil;
    const last = ctx.lastDateByPath.get(path.id);
    return addDays(last, (ctx.settings.reserveWeeks || 4) * 7);
  }

  /** Tutte le occupazioni (reali e virtuali) di un collega in una data. */
  function occupancy(ctx, thId, date, opts) {
    opts = opts || {};
    const items = [];
    for (const s of ctx.sessionsByThDate.get(thId + '|' + date) || []) {
      if (!OCCUPYING.has(s.status)) continue;
      if (opts.excludeSessionIds && opts.excludeSessionIds.has(s.id)) continue;
      const st = toMin(s.start);
      items.push({ start: st, end: st + s.duration, kind: 'seduta', hard: true, pathId: s.pathId, sessionId: s.id, duration: s.duration });
    }
    for (const p of ctx.pathsByTh.get(thId) || []) {
      if (opts.excludePathId === p.id) continue;
      const v = virtualOccupancy(ctx, p, date);
      if (v) items.push(v);
    }
    return items.sort((a, c) => a.start - c.start);
  }

  /* ------------------------------------------------------------------ */
  /* Verifica di un singolo posto                                         */
  /* ------------------------------------------------------------------ */
  /**
   * Verifica se [start, start+dur) è prenotabile per il collega nella data.
   * Esito: status 'ok' | 'ext' (usa estensione da confermare) | 'prob' (dipende da conclusioni) | 'fail'.
   */
  function checkSlot(ctx, th, date, start, dur, opts) {
    opts = opts || {};
    const key = th.id + '|' + date + '|' + start + '|' + dur + '|' + (opts.excludePathId || '') + '|' + (opts.excludeSessionIds ? [...opts.excludeSessionIds].join(',') : '');
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    const r = checkSlotRaw(ctx, th, date, start, dur, opts);
    ctx.cache.set(key, r);
    return r;
  }
  function fail(code, reason, extra) { return Object.assign({ status: 'fail', code, reason, deps: [], warnings: [] }, extra || {}); }

  function checkSlotRaw(ctx, th, date, start, dur, opts) {
    const end = start + dur;
    const day = getDay(ctx, th, date);
    if (day.closure) return fail('chiusura', 'Chiusura: ' + day.closure.label);
    if (!day.working) return fail('non_in_servizio', 'Non in servizio il ' + WEEKDAY_LONG[weekday(date)] + (day.exception ? ' (eccezione)' : ''));
    if (start < day.inMin || end > day.outMin) return fail('fuori_turno', 'Fuori dall\'orario di turno ' + fromMin(day.inMin) + '–' + fromMin(day.outMin));
    for (const a of day.absences) {
      if (overlaps(a.start, a.end, start, end)) {
        const lbl = (a.absence.type || 'assenza');
        if (a.unknownReturn) return fail('assenza_ignota', 'Assente (' + lbl + ') dal ' + fmtIt(a.absence.startDate) + ', rientro non noto', { unknownReturn: true });
        return fail('assenza', 'Assente (' + lbl + ')' + (a.absence.allDay === false ? ' ' + fromMin(a.start) + '–' + fromMin(a.end) : ''));
      }
    }
    for (const x of day.blocks) {
      if (BLOCK_TYPES[x.type] && BLOCK_TYPES[x.type].protected && overlaps(x.start, x.end, start, end)) {
        return fail('protetto', 'Si sovrappone a ' + BLOCK_TYPES[x.type].label.toLowerCase() + ' ' + fromMin(x.start) + '–' + fromMin(x.end));
      }
    }
    // Copertura completa con fasce ambulatoriali (ordinarie o estensione)
    let cur = start, usesExt = false, ambEnd = null;
    const used = [];
    while (cur < end) {
      const blk = day.blocks.find(x => BLOCK_TYPES[x.type] && BLOCK_TYPES[x.type].bookable && x.start <= cur && cur < x.end);
      if (!blk) return fail('no_fascia', 'Fuori dalle fasce ambulatoriali');
      if (blk.type === 'est') usesExt = true; else ambEnd = blk.end;
      used.push(blk);
      cur = blk.end;
    }
    const occ = occupancy(ctx, th.id, date, opts);
    // Limite di pazienti per fascia (es. gruppo delle 8: un solo paziente al mattino)
    for (const blk of used) {
      if (blk.maxPatients > 0) {
        const inBlock = occ.filter(o => o.hard && overlaps(o.start, o.end, blk.start, blk.end)).length;
        if (inBlock >= blk.maxPatients) {
          return fail('limite_fascia', 'Fascia ' + fromMin(blk.start) + '–' + fromMin(blk.end) + ': massimo ' + blk.maxPatients + ' paziente, già occupata');
        }
      }
    }
    const deps = [];
    for (const o of occ) {
      if (!overlaps(o.start, o.end, start, end)) continue;
      if (o.hard) {
        if (o.kind === 'seduta') return fail('occupato', 'Occupato da ' + patientName(ctx, o.pathId) + ' ' + fromMin(o.start) + '–' + fromMin(o.end), { blockingPathId: o.pathId });
        return fail('riserva', 'Riserva provvisoria per ' + patientName(ctx, o.pathId) + ' (' + o.why + ')', { blockingPathId: o.pathId });
      }
      deps.push({ pathId: o.pathId, why: o.why });
    }
    const warnings = [];
    if (th.maxPatientsDay) {
      const n = occ.filter(o => o.hard).length;
      if (n + 1 > th.maxPatientsDay) return fail('limite_giorno', 'Raggiunto il massimo di ' + th.maxPatientsDay + ' pazienti al giorno');
    }
    const w45 = ctx.settings.warn45;
    if (dur >= 45 && w45 && w45.enabled && (w45.profiles || []).includes(th.profile)) {
      const n45 = occ.filter(o => o.kind === 'seduta' && o.duration >= 45).length + 1;
      if (n45 > w45.threshold) warnings.push(n45 + ' sedute da 45 min nella giornata (avviso oltre ' + w45.threshold + ')');
    }
    let extInfo = null;
    if (usesExt) {
      const residual = day.outMin - end;
      extInfo = {
        end, residual, ambEnd,
        text: 'Termina alle ' + fromMin(end) + (ambEnd != null ? ', oltre il limite abituale delle ' + fromMin(ambEnd) : '') +
          '; restano ' + residual + ' min prima di fine turno (' + fromMin(day.outMin) + ') per le cartelle'
      };
    }
    return { status: deps.length ? 'prob' : usesExt ? 'ext' : 'ok', deps, usesExt, extInfo, warnings };
  }

  /* ------------------------------------------------------------------ */
  /* Cicli                                                                */
  /* ------------------------------------------------------------------ */
  /** Date di un ciclo: giorni dello schema, saltando festività e chiusure (che non contano). */
  function cycleDates(ctx, startDate, weekdays, n) {
    const dates = [], skipped = [];
    let d = startDate, guard = 0;
    while (dates.length < n && guard++ < 1000) {
      if (weekdays.includes(weekday(d))) {
        const cl = ctx.closures.get(d);
        if (cl) skipped.push({ date: d, label: cl.label }); else dates.push(d);
      }
      d = addDays(d, 1);
    }
    return { dates, skipped };
  }
  /** Prima data dello schema settimanale a partire da 'from' (inclusa), escluse chiusure. */
  function nextPatternDate(ctx, from, weekdays) {
    let d = from;
    for (let i = 0; i < 400; i++) {
      if (weekdays.includes(weekday(d)) && !ctx.closures.has(d)) return d;
      d = addDays(d, 1);
    }
    return null;
  }

  /** Verifica tutte le date di un ciclo con lo stesso collega e lo stesso orario. */
  function evaluateCycle(ctx, th, dates, start, dur, opts) {
    opts = opts || {};
    const perDate = [];
    const depMap = new Map();
    const extDates = [];
    const warnings = [];
    let status = 'ok', firstFail = null, okCount = 0;
    for (const date of dates) {
      const r = checkSlot(ctx, th, date, start, dur, opts);
      perDate.push({ date, r });
      if (r.status === 'fail') {
        if (!firstFail) firstFail = { date, r };
        if (!opts.full) break;
        continue;
      }
      okCount++;
      if (r.status === 'prob') r.deps.forEach(dp => { if (!depMap.has(dp.pathId)) depMap.set(dp.pathId, { pathId: dp.pathId, why: dp.why, from: date }); });
      if (r.usesExt) extDates.push({ date, info: r.extInfo });
      r.warnings.forEach(w => warnings.push({ date, text: w }));
    }
    if (firstFail) status = 'fail';
    else if (depMap.size) status = 'prob';
    else if (extDates.length) status = 'ext';
    return { status, perDate, deps: [...depMap.values()], extDates, warnings, firstFail, okCount };
  }

  /* ------------------------------------------------------------------ */
  /* Ricerca: "Trova un posto"                                            */
  /* ------------------------------------------------------------------ */
  function eligibility(th, categoryId) {
    if ((th.competenze || []).includes(categoryId)) return 'specifica';
    if ((th.idoneita || []).includes(categoryId)) return 'idoneo';
    return null;
  }
  function prefCompat(pref, start, dur) {
    if (!pref || !pref.from || !pref.to) return { level: 0, label: 'Nessuna preferenza' };
    const pf = toMin(pref.from), pt = toMin(pref.to), end = start + dur;
    if (start >= pf && end <= pt) return { level: 0, label: 'Compatibile' };
    if (overlaps(start, end, pf, pt)) return { level: 1, label: 'Parzialmente compatibile' };
    return { level: 2, label: 'Fuori preferenza' };
  }

  /** Orari di inizio "naturali": inizio fasce, fine appuntamenti, inizio appuntamenti meno la durata. */
  function candidateTimes(ctx, th, req, fromDate, toDate) {
    const set = new Set();
    const dur = req.duration;
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
      if (!req.weekdays.includes(weekday(d))) continue;
      const day = getDay(ctx, th, d);
      if (!day.working) continue;
      for (const x of day.blocks) {
        if (x.type === 'amb') { set.add(x.start); set.add(x.end - dur); }
        if (x.type === 'est') set.add(x.end - dur);
      }
      for (const o of occupancy(ctx, th.id, d)) { set.add(o.end); set.add(o.start - dur); }
      for (const a of day.absences) { set.add(a.end); set.add(a.start - dur); }
    }
    return [...set].filter(t => t >= 0).sort((a, c) => a - c);
  }

  /**
   * Cerca le disponibilità per un nuovo ciclo.
   * req = { categoryId, duration, weekdays:[1..5], sessions, earliestDate,
   *         pref: {from:'HH:MM', to:'HH:MM', mode:'flessibile'|'obbligatoria'} | null,
   *         sort: 'competenza'|'data' }
   */
  function search(state, req, opts) {
    const ctx = opts && opts.ctx ? opts.ctx : makeContext(state, opts);
    const S = ctx.settings;
    const horizonEnd = addDays(req.earliestDate, (req.horizonWeeks || S.searchHorizonWeeks) * 7);
    const startDates = [];
    for (let d = req.earliestDate; d <= horizonEnd; d = addDays(d, 1)) {
      if (req.weekdays.includes(weekday(d)) && !ctx.closures.has(d)) startDates.push(d);
    }
    const futureLimit = addDays(req.earliestDate, S.futureThresholdDays);
    const cat = (state.categories || []).find(c => c.id === req.categoryId);
    const groups = [], excluded = [];
    const mandatory = req.pref && req.pref.mode === 'obbligatoria' && req.pref.from && req.pref.to;

    for (const th of state.therapists) {
      const kind = eligibility(th, req.categoryId);
      if (!kind) { excluded.push({ therapist: th, reason: 'Non indicato come idoneo per ' + (cat ? cat.name : 'questo percorso') }); continue; }
      // Rientro non noto: le disponibilità successive non possono essere certe
      const openAbs = (ctx.absencesByTh.get(th.id) || []).find(a => absenceUnknownReturn(a) && a.startDate <= horizonEnd);
      const cycleSpanDays = Math.ceil(req.sessions / Math.max(1, req.weekdays.length)) * 7 + 21;
      let times = candidateTimes(ctx, th, req, req.earliestDate, addDays(horizonEnd, cycleSpanDays));
      if (mandatory) times = times.filter(t => t >= toMin(req.pref.from) && t + req.duration <= toMin(req.pref.to));
      const options = [];
      let bestDiag = null;
      for (const T of times) {
        let gotCertain = false, gotExt = false, gotProb = false;
        let i = 0;
        let firstEval = null;
        while (i < startDates.length && !gotCertain) {
          const S0 = startDates[i];
          const { dates, skipped } = cycleDates(ctx, S0, req.weekdays, req.sessions);
          const ev = evaluateCycle(ctx, th, dates, T, req.duration);
          if (!firstEval) firstEval = { ev, dates, S0 };
          if (ev.status === 'fail') {
            // salta direttamente oltre la data bloccante: nessun ciclo che la include può funzionare
            const blockDate = ev.firstFail.date;
            if (ev.firstFail.r.unknownReturn) break;
            while (i < startDates.length && startDates[i] <= blockDate) i++;
            continue;
          }
          const opt = {
            therapistId: th.id, kind, start: T, end: T + req.duration, startDate: S0,
            endDate: dates[dates.length - 1], dates, skipped, status: ev.status,
            deps: ev.deps, extDates: ev.extDates, warnings: ev.warnings,
            pref: prefCompat(req.pref, T, req.duration)
          };
          if (ev.status === 'ok') { options.push(opt); gotCertain = true; }
          else if (ev.status === 'ext' && !gotExt) { options.push(opt); gotExt = true; }
          else if (ev.status === 'prob' && !gotProb && !gotExt) { options.push(opt); gotProb = true; }
          i++;
        }
        // diagnosi per spiegare perché un collega idoneo non ha posti
        if (firstEval) {
          const full = evaluateCycle(ctx, th, firstEval.dates, T, req.duration, { full: true });
          if (!bestDiag || full.okCount > bestDiag.okCount) bestDiag = { T, okCount: full.okCount, total: firstEval.dates.length, fails: full.perDate.filter(p => p.r.status === 'fail') };
        }
      }
      options.forEach(o => {
        o.category = o.status === 'prob' ? 'futuro_probabile' : (o.startDate <= futureLimit ? 'disponibile' : 'futuro_confermato');
        o.bookable = o.status === 'ok' || o.status === 'ext';
        o.explanation = explainOption(ctx, th, kind, cat, o, req);
      });
      options.sort(compareOptions);
      if (!options.length) {
        let reason = 'Nessun orario libero per l\'intero ciclo entro ' + (req.horizonWeeks || S.searchHorizonWeeks) + ' settimane';
        if (openAbs) reason = 'Assente dal ' + fmtIt(openAbs.startDate) + ' con rientro non noto: disponibilità non certa, non proposta';
        else if (bestDiag && bestDiag.fails.length) {
          const f = bestDiag.fails.slice(0, 3).map(p => fmtItShort(p.date) + ' ' + p.r.reason.toLowerCase()).join('; ');
          reason += '. Miglior orario ' + fromMin(bestDiag.T) + ': libero in ' + bestDiag.okCount + '/' + bestDiag.total + ' date (' + f + (bestDiag.fails.length > 3 ? '…' : '') + ')';
        } else if (mandatory) reason += ' nella fascia obbligatoria ' + req.pref.from + '–' + req.pref.to;
        excluded.push({ therapist: th, kind, reason });
        continue;
      }
      const g = { therapist: th, kind, options, openAbsence: openAbs || null };
      g.counts = {}; g.independent = {};
      for (const c of ['disponibile', 'futuro_confermato', 'futuro_probabile']) {
        const list = options.filter(o => o.category === c);
        g.counts[c] = list.length;
        g.independent[c] = independentCount(list);
      }
      groups.push(g);
    }
    const sortMode = req.sort || 'competenza';
    groups.sort((a, c) => compareGroups(a, c, sortMode));
    return { request: req, groups, excluded, horizonEnd, startDates, generatedAt: Date.now() };
  }
  const STATUS_RANK = { ok: 0, ext: 1, prob: 2 };
  function compareOptions(a, c) {
    return (STATUS_RANK[a.status] - STATUS_RANK[c.status]) || (a.pref.level - c.pref.level) ||
      (a.startDate < c.startDate ? -1 : a.startDate > c.startDate ? 1 : 0) || (a.start - c.start);
  }
  function bestOf(g, category) {
    const list = category ? g.options.filter(o => o.category === category) : g.options;
    return list[0] || null;
  }
  function compareGroups(a, c, mode, category) {
    const ba = bestOf(a, category), bc = bestOf(c, category);
    if (!ba || !bc) return (ba ? -1 : 0) + (bc ? 1 : 0);
    const kindCmp = (a.kind === 'specifica' ? 0 : 1) - (c.kind === 'specifica' ? 0 : 1);
    const dateCmp = ba.startDate < bc.startDate ? -1 : ba.startDate > bc.startDate ? 1 : 0;
    const nameCmp = a.therapist.name.localeCompare(c.therapist.name, 'it');
    if (mode === 'data') return dateCmp || (STATUS_RANK[ba.status] - STATUS_RANK[bc.status]) || kindCmp || (ba.pref.level - bc.pref.level) || nameCmp;
    return kindCmp || (ba.pref.level - bc.pref.level) || (STATUS_RANK[ba.status] - STATUS_RANK[bc.status]) || dateCmp || nameCmp;
  }
  /** Numero massimo di posti che non si sovrappongono (le alternative sovrapposte contano una volta sola). */
  function independentCount(options) {
    const iv = options.map(o => [o.start, o.end]).sort((a, c) => a[1] - c[1]);
    let n = 0, lastEnd = -1;
    for (const [s, e] of iv) if (s >= lastEnd) { n++; lastEnd = e; }
    return n;
  }
  function explainOption(ctx, th, kind, cat, o, req) {
    const parts = [];
    parts.push(kind === 'specifica' ? 'Competenza specifica in ' + (cat ? cat.name : '') : 'Idoneo per ' + (cat ? cat.name : ''));
    parts.push('fascia ambulatoriale libera ' + fromMin(o.start) + '–' + fromMin(o.end) + ' in tutte le ' + o.dates.length + ' date (' + fmtItShort(o.startDate) + ' → ' + fmtItShort(o.endDate) + ')');
    parts.push('nessuna sovrapposizione con reparto, pausa, cartelle, assenze o altri pazienti');
    if (o.skipped.length) parts.push('saltate per chiusura: ' + o.skipped.map(s => fmtItShort(s.date) + ' ' + s.label).join(', '));
    if (req.pref && req.pref.from) parts.push(o.pref.label.toLowerCase() + ' con la preferenza ' + req.pref.from + '–' + req.pref.to);
    return parts;
  }

  /** Recupera gli stessi controlli di una proposta prima della conferma (stato aggiornato). */
  function recheckOption(state, option, req, opts) {
    const ctx = makeContext(state, opts);
    const th = ctx.therapists.get(option.therapistId);
    if (!th) return { ok: false, reason: 'Collega non trovato' };
    if (!eligibility(th, req.categoryId)) return { ok: false, reason: 'Il collega non risulta più idoneo per questo percorso' };
    const { dates, skipped } = cycleDates(ctx, option.startDate, req.weekdays, req.sessions);
    const ev = evaluateCycle(ctx, th, dates, option.start, req.duration, { full: true });
    return { ok: ev.status === 'ok' || ev.status === 'ext', ev, dates, skipped };
  }

  /* ------------------------------------------------------------------ */
  /* Buchi singoli (recuperi)                                             */
  /* ------------------------------------------------------------------ */
  /** Intervalli liberi certi in una data (fasce ambulatoriali ordinarie meno occupazioni e assenze). */
  function freeIntervals(ctx, th, date, opts) {
    opts = opts || {};
    const day = getDay(ctx, th, date);
    if (!day.working) return [];
    const occ = occupancy(ctx, th.id, date);
    let iv = [];
    for (const x of day.blocks) {
      if (x.type !== 'amb' && !(opts.includeExt && x.type === 'est')) continue;
      if (x.maxPatients > 0) {
        const n = occ.filter(o => o.kind === 'seduta' && overlaps(o.start, o.end, x.start, x.end)).length;
        if (n >= x.maxPatients) continue;
      }
      const lastIv = iv[iv.length - 1];
      if (lastIv && lastIv[1] === x.start && !x.maxPatients && !lastIv[2]) lastIv[1] = x.end;
      else iv.push([x.start, x.end, x.maxPatients]);
    }
    const subtract = (list, s, e) => {
      const out = [];
      for (const [a, c, m] of list) {
        if (!overlaps(a, c, s, e)) { out.push([a, c, m]); continue; }
        if (a < s) out.push([a, s, m]);
        if (e < c) out.push([e, c, m]);
      }
      return out;
    };
    for (const o of occ) iv = subtract(iv, o.start, o.end);
    for (const a of day.absences) iv = subtract(iv, a.start, a.end);
    return iv.map(([s, e, m]) => ({ start: s, end: e, maxPatients: m || 0 }));
  }

  /** Buchi utilizzabili per recuperi o sedute singole nei prossimi giorni. */
  function findGaps(state, req, opts) {
    const ctx = opts && opts.ctx ? opts.ctx : makeContext(state, opts);
    const days = req.days || ctx.settings.gapDays;
    const out = [];
    for (const th of state.therapists) {
      if (req.therapistIds && !req.therapistIds.includes(th.id)) continue;
      const kind = req.categoryId ? eligibility(th, req.categoryId) : 'idoneo';
      if (!kind) continue;
      const items = [];
      for (let i = 0; i < days; i++) {
        const d = addDays(req.fromDate, i);
        if (weekday(d) > 5 && !(th.week && th.week[weekday(d)])) continue;
        for (const iv of freeIntervals(ctx, th, d)) {
          const len = iv.end - iv.start;
          if (len >= req.duration) {
            const seats = iv.maxPatients ? Math.min(iv.maxPatients, Math.floor(len / req.duration)) : Math.floor(len / req.duration);
            items.push({ date: d, start: iv.start, end: iv.end, minutes: len, seats });
          }
        }
      }
      if (items.length) out.push({ therapist: th, kind, items });
    }
    out.sort((a, c) => ((a.kind === 'specifica' ? 0 : 1) - (c.kind === 'specifica' ? 0 : 1)) || (a.items[0].date < c.items[0].date ? -1 : 1));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Conteggi, previsioni, conflitti                                      */
  /* ------------------------------------------------------------------ */
  function cycleCounts(state, cycle) {
    const ss = state.sessions.filter(s => s.cycleId === cycle.id);
    const c = { planned: cycle.plannedSessions, total: 0, programmata: 0, effettuata: 0, assente: 0, annullata: 0, da_recuperare: 0, recuperata: 0 };
    ss.forEach(s => { c[s.status] = (c[s.status] || 0) + 1; if (COUNTED.has(s.status)) c.total++; });
    c.missing = Math.max(0, c.planned - c.total);
    const occ = ss.filter(s => OCCUPYING.has(s.status)).sort((a, d) => a.date < d.date ? -1 : 1);
    c.firstDate = occ.length ? occ[0].date : null;
    c.lastDate = occ.length ? occ[occ.length - 1].date : null;
    return c;
  }
  function pathCounts(state, pathId) {
    const cycles = state.cycles.filter(c => c.pathId === pathId).sort((a, c) => a.index - c.index);
    const per = cycles.map(c => ({ cycle: c, counts: cycleCounts(state, c) }));
    const ss = state.sessions.filter(s => s.pathId === pathId);
    const occ = ss.filter(s => OCCUPYING.has(s.status)).sort((a, c) => a.date < c.date ? -1 : 1);
    return {
      cycles: per,
      planned: per.reduce((n, x) => n + x.counts.planned, 0),
      done: ss.filter(s => s.status === 'effettuata').length,
      lastDate: occ.length ? occ[occ.length - 1].date : null
    };
  }

  /** Appuntamenti esistenti non più validi (assenza del collega, chiusura, fuori servizio). */
  function sessionIssue(ctx, s) {
    if (!OCCUPYING.has(s.status) || s.status === 'effettuata') return null;
    const th = ctx.therapists.get(s.therapistId);
    if (!th) return { code: 'collega', reason: 'Collega non presente' };
    const day = getDay(ctx, th, s.date);
    const st = toMin(s.start), en = st + s.duration;
    if (day.closure) return { code: 'chiusura', reason: 'Chiusura: ' + day.closure.label };
    if (!day.working) return { code: 'non_in_servizio', reason: 'Collega non in servizio' };
    for (const a of day.absences) {
      if (overlaps(a.start, a.end, st, en)) return { code: 'assenza', reason: 'Collega assente (' + (a.absence.type || 'assenza') + (a.unknownReturn ? ', rientro non noto' : '') + ')', absenceId: a.absence.id };
    }
    // la scheda del collega potrebbe essere cambiata dopo la prenotazione
    let cur = st;
    while (cur < en) {
      const blk = day.blocks.find(x => BLOCK_TYPES[x.type] && BLOCK_TYPES[x.type].bookable && x.start <= cur && cur < x.end);
      if (!blk) return { code: 'fuori_fascia', reason: 'Fuori dalle fasce ambulatoriali della scheda del collega' };
      cur = blk.end;
    }
    return null;
  }
  function conflicts(state, opts) {
    const ctx = makeContext(state, opts);
    const from = (opts && opts.fromDate) || ctx.today;
    return state.sessions.filter(s => s.date >= from).map(s => ({ session: s, issue: sessionIssue(ctx, s) })).filter(x => x.issue)
      .sort((a, c) => a.session.date < c.session.date ? -1 : 1);
  }
  function impactedByAbsence(state, absence, opts) {
    const ctx = makeContext(state, opts);
    return state.sessions.filter(s => s.therapistId === absence.therapistId && OCCUPYING.has(s.status) && s.status !== 'effettuata' && absenceCovers(absence, s.date))
      .filter(s => {
        if (absence.allDay !== false) return true;
        const st = toMin(s.start);
        return overlaps(toMin(absence.startTime), toMin(absence.endTime), st, st + s.duration);
      }).sort((a, c) => a.date < c.date ? -1 : a.date > c.date ? 1 : toMin(a.start) - toMin(c.start));
  }

  /** Quadro previsionale di ogni percorso attivo. */
  function forecastOverview(state, opts) {
    const ctx = makeContext(state, opts);
    const today = ctx.today, S = ctx.settings;
    const rows = [];
    for (const p of state.paths) {
      const f = p.forecast || { state: 'da_valutare' };
      const ss = ctx.sessionsByPath.get(p.id) || [];
      const last = ctx.lastDateByPath.get(p.id);
      const future = ss.filter(s => s.status === 'programmata' && s.date >= today);
      const pastOpen = ss.filter(s => s.status === 'programmata' && s.date < today);
      const pending = ss.filter(s => s.status === 'da_recuperare');
      const closed = CLOSED_FORECASTS.has(f.state) && (!last || last < today);
      const alerts = [];
      if (!closed) {
        if (future.length <= S.updateThreshold && (f.state === 'da_valutare' || (f.state === 'prosecuzione' && future.length > 0))) {
          alerts.push({ code: 'aggiorna', text: future.length ? (future.length === 1 ? 'Manca 1 seduta' : 'Mancano ' + future.length + ' sedute') + ': aggiornare la previsione' : 'Nessuna seduta futura: aggiornare la previsione' });
        }
        if ((f.state === 'da_valutare' || f.state === 'prosecuzione') && last) {
          const re = reserveEnd(ctx, p);
          if (re < today) alerts.push({ code: 'riserva_scaduta', text: 'Riserva provvisoria scaduta il ' + fmtIt(re) + ': riesaminare' });
          else if (diffDays(today, re) <= 7 && future.length === 0) alerts.push({ code: 'riserva', text: 'Riserva provvisoria in scadenza il ' + fmtIt(re) });
        }
        if (f.state === 'sospensione' && f.reviewDate && f.reviewDate <= today) alerts.push({ code: 'riesame', text: 'Data di riesame della sospensione raggiunta (' + fmtIt(f.reviewDate) + ')' });
        if (f.state === 'probabile_conclusione' && last && last < today) alerts.push({ code: 'conferma', text: 'Ciclo terminato: confermare la conclusione o la prosecuzione' });
      }
      if (pastOpen.length) alerts.push({ code: 'esiti', text: (pastOpen.length === 1 ? '1 seduta passata' : pastOpen.length + ' sedute passate') + ' senza esito registrato' });
      if (pending.length) alerts.push({ code: 'recuperi', text: (pending.length === 1 ? '1 seduta' : pending.length + ' sedute') + ' da recuperare' });
      // effetto sul posto
      let slot;
      if (!last) slot = { code: 'nessuno', label: 'Nessun posto occupato' };
      else {
        const next = nextPatternDate(ctx, addDays(last, 1), p.weekdays);
        if (f.state === 'conclusione_confermata' || f.state === 'interruzione' || f.state === 'non_avviato') slot = { code: 'libero', label: 'Libero dal ' + fmtIt(next), freeFrom: next, certainty: 'confermato' };
        else if (f.state === 'probabile_conclusione') slot = { code: 'probabile', label: 'Probabilmente libero dal ' + fmtIt(next), freeFrom: next, certainty: 'probabile' };
        else if (f.state === 'sospensione' && !f.keepSlots) slot = { code: 'libero', label: 'Liberato (sospensione) dal ' + fmtIt(next), freeFrom: next, certainty: 'confermato' };
        else {
          const re = f.state === 'sospensione' ? (f.reviewDate || reserveEnd(ctx, p)) : reserveEnd(ctx, p);
          slot = { code: 'riserva', label: 'Riservato fino al ' + fmtIt(re) + ' (riserva provvisoria)', reserveUntil: re, freeFrom: nextPatternDate(ctx, addDays(re, 1), p.weekdays), certainty: 'probabile' };
        }
      }
      rows.push({ path: p, patient: ctx.patients.get(p.patientId), therapist: ctx.therapists.get(p.therapistId), forecast: f, last, futureCount: future.length, alerts, slot, closed });
    }
    rows.sort((a, c) => (a.last || '9999') < (c.last || '9999') ? -1 : 1);
    return rows;
  }

  /** Pazienti in lista compatibili con un posto che si libera, ordinati per priorità e attesa. */
  function compatibleWaitlist(state, slot, opts) {
    const ctx = makeContext(state, opts);
    const th = ctx.therapists.get(slot.therapistId);
    const prio = ctx.settings.priorities;
    const out = [];
    for (const w of state.waitlist || []) {
      if (!['in_attesa', 'contattato', 'proposta'].includes(w.status)) continue;
      if (!eligibility(th, w.categoryId)) continue;
      if (w.duration > slot.duration) continue;
      if (!w.weekdays.every(d => slot.weekdays.includes(d))) continue;
      if (w.pref && w.pref.mode === 'obbligatoria' && w.pref.from && !(slot.start >= toMin(w.pref.from) && slot.start + w.duration <= toMin(w.pref.to))) continue;
      const from = slot.freeFrom > (w.earliestDate || '') ? slot.freeFrom : w.earliestDate;
      const startDate = nextPatternDate(ctx, from, w.weekdays);
      const { dates } = cycleDates(ctx, startDate, w.weekdays, w.sessions);
      const ev = evaluateCycle(ctx, th, dates, slot.start, w.duration, { excludePathId: slot.excludeVirtualOf || undefined });
      out.push({ entry: w, startDate, ev, pref: prefCompat(w.pref, slot.start, w.duration) });
    }
    out.sort((a, c) => (prio.indexOf(a.entry.priority) - prio.indexOf(c.entry.priority)) || (a.entry.insertedAt < c.entry.insertedAt ? -1 : 1));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Aggiornamento dei dati salvati con la versione precedente            */
  /* ------------------------------------------------------------------ */
  /**
   * Completa uno stato salvato in precedenza senza perdere dati. Idempotente.
   *  - aggiunge i percorsi "Mano" e "Chirurgia della mano / postoperatorio", riusando categorie equivalenti già presenti;
   *  - priorità: i vecchi valori (es. Alta/Media/Bassa) NON vengono convertiti in U/B/D/P (sarebbe una deduzione):
   *    diventano "Non indicata" e il valore precedente resta visibile per la riclassificazione.
   */
  function upgradeState(st) {
    const changes = [];
    st.categories = st.categories || [];
    const norm = x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const findChir = () => st.categories.find(c => /chirurgia della mano|mano.*(post.?operat|chirurg)/.test(norm(c.name)));
    const findMano = () => st.categories.find(c => c !== findChir() && /^(mano|mano e polso|polso e mano|mano \/ polso)$/.test(norm(c.name)));
    for (const hc of HAND_CATEGORIES) {
      const ex = hc.id === 'chir_mano' ? findChir() : findMano();
      if (ex) continue; // categoria equivalente già presente: riusata così com'è
      let id = hc.id, k = 1;
      while (st.categories.some(c => c.id === id)) id = hc.id + (++k);
      st.categories.push({ id, name: hc.name });
      changes.push('Aggiunto il percorso "' + hc.name + '"');
    }
    st.settings = st.settings || {};
    if (JSON.stringify(st.settings.priorities) !== JSON.stringify(PRIORITY_ORDER)) {
      st.settings.priorities = PRIORITY_ORDER.slice();
      changes.push('Priorità della lista d\'attesa: categorie U, B, D, P, Non indicata');
    }
    let n = 0;
    for (const w of st.waitlist || []) {
      if (!PRIORITY_CLASSES[w.priority]) {
        if (w.priority) w.previousPriority = w.priority;
        w.priority = 'NI'; n++;
      }
    }
    if (n) changes.push(n + ' pazienti in lista con priorità "Non indicata" da riclassificare (il valore precedente resta visibile)');
    return changes;
  }

  /* ------------------------------------------------------------------ */
  /* Operazioni che modificano lo stato                                   */
  /* (lavorano su una copia e restituiscono il nuovo stato)               */
  /* ------------------------------------------------------------------ */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  let idCounter = 0;
  function uid(prefix) { idCounter = (idCounter + 1) % 1e6; return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36); }
  function addLog(state, text) {
    state.log = state.log || [];
    state.log.unshift({ ts: new Date().toISOString(), text });
    if (state.log.length > 500) state.log.length = 500;
  }
  class EngineError extends Error { constructor(msg, details) { super(msg); this.details = details; } }

  /**
   * Conferma un nuovo ciclo. Ricontrolla TUTTI i conflitti sullo stato aggiornato.
   * Un posto probabile non è mai prenotabile in modo definitivo.
   */
  function bookCycle(state, a, opts) {
    const st = clone(state);
    const req = { categoryId: a.categoryId, duration: a.duration, weekdays: a.weekdays, sessions: a.sessions };
    const chk = recheckOption(st, { therapistId: a.therapistId, startDate: a.startDate, start: toMin(a.startTime) }, req, opts);
    if (!chk.ok) {
      if (chk.ev && chk.ev.status === 'prob') throw new EngineError('Posto solo probabile: non prenotabile in modo definitivo. Registra eventualmente un preaccordo.', chk);
      const ff = chk.ev && chk.ev.firstFail;
      throw new EngineError('Il posto non è più disponibile' + (ff ? ': ' + fmtIt(ff.date) + ' — ' + ff.r.reason : (chk.reason ? ': ' + chk.reason : '')), chk);
    }
    if (chk.ev.status === 'ext' && !a.acceptExtension) throw new EngineError('La proposta usa una fascia di estensione: serve la conferma esplicita dell\'estensione.', chk);
    let patientId = a.patientId;
    if (!patientId) {
      patientId = uid('pt');
      st.patients.push({ id: patientId, name: a.patientName.trim(), note: a.patientNote || '', createdAt: (opts && opts.today) || todayRome() });
    }
    const pathId = uid('pa');
    st.paths.push({
      id: pathId, patientId, categoryId: a.categoryId, therapistId: a.therapistId, duration: a.duration,
      weekdays: [...a.weekdays].sort(), startTime: fromMin(toMin(a.startTime)),
      forecast: { state: 'da_valutare', updatedAt: (opts && opts.today) || todayRome() },
      waitlistId: a.waitlistId || null, createdAt: (opts && opts.today) || todayRome(),
      priority: PRIORITY_CLASSES[a.priority] ? a.priority : 'NI', requestType: REQUEST_TYPES[a.requestType] ? a.requestType : ''
    });
    const cycleId = uid('cy');
    st.cycles.push({ id: cycleId, pathId, index: 1, plannedSessions: a.sessions, startDate: chk.dates[0], createdAt: (opts && opts.today) || todayRome() });
    chk.dates.forEach(d => st.sessions.push({
      id: uid('se'), pathId, cycleId, therapistId: a.therapistId, date: d, start: fromMin(toMin(a.startTime)), duration: a.duration,
      status: 'programmata', extension: chk.ev.extDates.some(x => x.date === d) || undefined
    }));
    if (a.waitlistId) {
      const w = st.waitlist.find(x => x.id === a.waitlistId);
      if (w) { w.status = 'assegnato'; w.assignedPathId = pathId; w.preaccordo = null; }
    }
    const thName = st.therapists.find(t => t.id === a.therapistId).name;
    const ptName = st.patients.find(p => p.id === patientId).name;
    addLog(st, 'Assegnato ' + ptName + ' a ' + thName + ': ' + weekdaysLabel(a.weekdays) + ' ' + fromMin(toMin(a.startTime)) + ', ' + a.sessions + ' sedute dal ' + fmtIt(chk.dates[0]) + (chk.ev.status === 'ext' ? ' (con estensione confermata)' : ''));
    return { state: st, pathId, dates: chk.dates };
  }

  /** Rinnovo: nuovo ciclo collegato allo stesso percorso, stesso orario, dopo l'ultima seduta. */
  function previewRenewal(state, pathId, n, opts) {
    const ctx = makeContext(state, opts);
    const p = ctx.paths.get(pathId);
    const th = ctx.therapists.get(p.therapistId);
    const last = ctx.lastDateByPath.get(pathId) || ctx.today;
    const from = nextPatternDate(ctx, addDays(last > ctx.today ? last : addDays(ctx.today, -1), 1), p.weekdays);
    const { dates, skipped } = cycleDates(ctx, from, p.weekdays, n);
    // la riserva provvisoria del percorso stesso non è un conflitto
    const ev = evaluateCycle(ctx, th, dates, toMin(p.startTime), p.duration, { excludePathId: pathId, full: true });
    return { path: p, dates, skipped, ev, conflicts: ev.perDate.filter(x => x.r.status === 'fail'), probable: ev.perDate.filter(x => x.r.status === 'prob') };
  }
  function renewCycle(state, pathId, n, opts) {
    opts = opts || {};
    const pv = previewRenewal(state, pathId, n, opts);
    if (pv.conflicts.length) throw new EngineError('Rinnovo non possibile: ' + pv.conflicts.length + ' date in conflitto', pv);
    if (pv.ev.status === 'ext' && !opts.acceptExtension) throw new EngineError('Il rinnovo usa una fascia di estensione: serve conferma esplicita.', pv);
    const st = clone(state);
    const p = st.paths.find(x => x.id === pathId);
    const idx = st.cycles.filter(c => c.pathId === pathId).reduce((m, c) => Math.max(m, c.index), 0) + 1;
    const cycleId = uid('cy');
    st.cycles.push({ id: cycleId, pathId, index: idx, plannedSessions: n, startDate: pv.dates[0], createdAt: opts.today || todayRome() });
    pv.dates.forEach(d => st.sessions.push({ id: uid('se'), pathId, cycleId, therapistId: p.therapistId, date: d, start: p.startTime, duration: p.duration, status: 'programmata' }));
    const prev = p.forecast ? p.forecast.state : 'da_valutare';
    p.forecast = { state: 'da_valutare', updatedAt: opts.today || todayRome(), note: 'Rinnovo ciclo ' + idx + ' (previsione precedente: ' + FORECAST[prev] + ')' };
    addLog(st, 'Rinnovo: ciclo ' + idx + ' di ' + n + ' sedute per ' + st.patients.find(x => x.id === p.patientId).name + ' dal ' + fmtIt(pv.dates[0]) + ' al ' + fmtIt(pv.dates[pv.dates.length - 1]));
    return { state: st, cycleId, preview: pv };
  }

  function setSessionStatus(state, sessionId, status, note) {
    if (!SESSION_STATUS[status]) throw new EngineError('Stato non valido');
    const st = clone(state);
    const s = st.sessions.find(x => x.id === sessionId);
    if (!s) throw new EngineError('Seduta non trovata');
    if (s.status === 'recuperata' && status !== 'recuperata') {
      const rec = st.sessions.find(x => x.recoveryOf === s.id && x.status !== 'annullata');
      if (rec) throw new EngineError('Questa seduta ha già un recupero programmato: modifica o annulla prima il recupero.');
    }
    if (status === 'recuperata') throw new EngineError('Lo stato "recuperata" si imposta programmando il recupero.');
    const old = s.status;
    s.status = status;
    if (note != null) s.note = note;
    // se si annulla un recupero, la seduta originale torna da recuperare
    if (s.recoveryOf && (status === 'annullata' || status === 'da_recuperare')) {
      const orig = st.sessions.find(x => x.id === s.recoveryOf);
      if (orig && orig.status === 'recuperata') orig.status = 'da_recuperare';
      if (status === 'da_recuperare') s.status = 'annullata';
    }
    const pt = st.patients.find(x => x.id === (st.paths.find(p => p.id === s.pathId) || {}).patientId);
    addLog(st, 'Seduta ' + fmtIt(s.date) + ' ' + s.start + ' di ' + (pt ? pt.name : '?') + ': ' + SESSION_STATUS[old] + ' → ' + SESSION_STATUS[s.status]);
    return { state: st };
  }

  /**
   * Recupero: crea una seduta collegata a quella persa. La seduta persa diventa "recuperata"
   * e non è più contata: il conteggio del ciclo resta invariato.
   * where = { mode:'fine' } (stesso orario dopo l'ultima seduta) oppure { date, start, therapistId }.
   */
  function previewRecovery(state, sessionId, where, opts) {
    const ctx = makeContext(state, opts);
    const s = state.sessions.find(x => x.id === sessionId);
    const p = ctx.paths.get(s.pathId);
    let date, start, thId;
    if (!where || where.mode === 'fine') {
      const last = ctx.lastDateByPath.get(p.id) || ctx.today;
      date = nextPatternDate(ctx, addDays(last < ctx.today ? addDays(ctx.today, -1) : last, 1), p.weekdays);
      start = toMin(p.startTime); thId = p.therapistId;
    } else { date = where.date; start = toMin(where.start); thId = where.therapistId || p.therapistId; }
    const th = ctx.therapists.get(thId);
    const r = checkSlot(ctx, th, date, start, s.duration, { excludePathId: p.id });
    return { session: s, path: p, date, start, therapistId: thId, r };
  }
  function scheduleRecovery(state, sessionId, where, opts) {
    opts = opts || {};
    const s0 = state.sessions.find(x => x.id === sessionId);
    if (!s0) throw new EngineError('Seduta non trovata');
    if (!['da_recuperare', 'assente', 'annullata'].includes(s0.status)) throw new EngineError('Si possono recuperare solo sedute da recuperare, con assenza o annullate.');
    const pv = previewRecovery(state, sessionId, where, opts);
    if (pv.r.status === 'fail') throw new EngineError('Recupero non possibile il ' + fmtIt(pv.date) + ' alle ' + fromMin(pv.start) + ': ' + pv.r.reason, pv);
    if (pv.r.status === 'prob') throw new EngineError('Il posto del ' + fmtIt(pv.date) + ' è solo probabile: non prenotabile in modo definitivo.', pv);
    if (pv.r.status === 'ext' && !opts.acceptExtension) throw new EngineError('Il recupero usa una fascia di estensione: serve conferma esplicita.', pv);
    const st = clone(state);
    const s = st.sessions.find(x => x.id === sessionId);
    s.status = 'recuperata';
    const rec = { id: uid('se'), pathId: s.pathId, cycleId: s.cycleId, therapistId: pv.therapistId, date: pv.date, start: fromMin(pv.start), duration: s.duration, status: 'programmata', recoveryOf: s.id };
    st.sessions.push(rec);
    const p = st.paths.find(x => x.id === s.pathId);
    addLog(st, 'Recupero per ' + st.patients.find(x => x.id === p.patientId).name + ': seduta del ' + fmtIt(s.date) + ' recuperata il ' + fmtIt(pv.date) + ' alle ' + fromMin(pv.start));
    return { state: st, recovery: rec };
  }

  /** Sostituzione esplicita di un collega per una seduta (es. assenza). */
  function findSubstitutes(state, sessionId, opts) {
    const ctx = makeContext(state, opts);
    const s = state.sessions.find(x => x.id === sessionId);
    const p = ctx.paths.get(s.pathId);
    const out = [];
    for (const th of state.therapists) {
      if (th.id === s.therapistId) continue;
      const kind = eligibility(th, p.categoryId);
      if (!kind) continue;
      const r = checkSlot(ctx, th, s.date, toMin(s.start), s.duration);
      if (r.status === 'ok' || r.status === 'ext') out.push({ therapist: th, kind, r });
    }
    out.sort((a, c) => ((a.kind === 'specifica' ? 0 : 1) - (c.kind === 'specifica' ? 0 : 1)) || (a.r.status === 'ok' ? 0 : 1) - (c.r.status === 'ok' ? 0 : 1));
    return out;
  }
  function substitute(state, sessionId, therapistId, opts) {
    opts = opts || {};
    const ctx = makeContext(state, opts);
    const s0 = state.sessions.find(x => x.id === sessionId);
    const th = ctx.therapists.get(therapistId);
    const p = ctx.paths.get(s0.pathId);
    if (!eligibility(th, p.categoryId)) throw new EngineError(th.name + ' non è indicato come idoneo per questo percorso.');
    const r = checkSlot(ctx, th, s0.date, toMin(s0.start), s0.duration);
    if (r.status === 'fail' || r.status === 'prob') throw new EngineError('Sostituzione non possibile: ' + (r.reason || 'posto non certo'));
    if (r.status === 'ext' && !opts.acceptExtension) throw new EngineError('La sostituzione usa una fascia di estensione: serve conferma esplicita.');
    const st = clone(state);
    const s = st.sessions.find(x => x.id === sessionId);
    const oldName = ctx.therapists.get(s.therapistId).name;
    s.originalTherapistId = s.originalTherapistId || s.therapistId;
    s.therapistId = therapistId;
    s.note = 'Sostituzione di ' + oldName;
    addLog(st, 'Sostituzione: seduta del ' + fmtIt(s.date) + ' ' + s.start + ' di ' + ctx.patients.get(p.patientId).name + ' da ' + oldName + ' a ' + th.name);
    return { state: st };
  }

  /** Anteprima degli effetti di un cambio di previsione (quali sedute verrebbero liberate). */
  function previewForecast(state, pathId, f, opts) {
    const today = (opts && opts.today) || todayRome();
    const ss = state.sessions.filter(s => s.pathId === pathId && s.status === 'programmata');
    let release = [];
    if (f.state === 'interruzione' || f.state === 'non_avviato') {
      // senza data: si liberano tutte le sedute programmate da oggi; con data: quelle successive
      release = ss.filter(s => s.date >= today && (!f.date || s.date > f.date));
    } else if (f.state === 'sospensione' && !f.keepSlots) {
      const from = f.date || today;
      release = ss.filter(s => s.date >= from && s.date >= today);
    } else if (f.state === 'conclusione_confermata' && f.date) {
      release = ss.filter(s => s.date > f.date);
    }
    return { release };
  }
  function setForecast(state, pathId, f, opts) {
    opts = opts || {};
    if (!FORECAST[f.state]) throw new EngineError('Previsione non valida');
    if (f.state === 'sospensione' && !f.reviewDate) throw new EngineError('Per la sospensione indica una data di riesame.');
    if (f.state === 'sospensione' && typeof f.keepSlots !== 'boolean') throw new EngineError('Per la sospensione indica se mantenere o liberare gli appuntamenti futuri.');
    const pv = previewForecast(state, pathId, f, opts);
    if (pv.release.length && !opts.confirmRelease) throw new EngineError('Conferma necessaria: verranno liberati ' + pv.release.length + ' appuntamenti futuri.', pv);
    const st = clone(state);
    const p = st.paths.find(x => x.id === pathId);
    const ids = new Set(pv.release.map(s => s.id));
    st.sessions.forEach(s => { if (ids.has(s.id)) { s.status = 'annullata'; s.note = 'Posto liberato: ' + FORECAST[f.state].toLowerCase(); } });
    const old = p.forecast ? p.forecast.state : 'da_valutare';
    p.forecast = { state: f.state, date: f.date || null, reviewDate: f.reviewDate || null, keepSlots: f.state === 'sospensione' ? !!f.keepSlots : undefined, note: f.note || '', updatedAt: opts.today || todayRome(), reserveUntil: f.reserveUntil || null };
    addLog(st, 'Previsione ' + st.patients.find(x => x.id === p.patientId).name + ': ' + FORECAST[old] + ' → ' + FORECAST[f.state] +
      (f.state === 'sospensione' ? (f.keepSlots ? ' (posto mantenuto' : ' (posto liberato') + ', riesame ' + fmtIt(f.reviewDate) + ')' : '') +
      (pv.release.length ? '; liberati ' + pv.release.length + ' appuntamenti' : ''));
    return { state: st, released: pv.release };
  }

  return {
    // date
    parseDate, fmtDate, addDays, diffDays, weekday, mondayOf, toMin, fromMin, todayRome, fmtIt, fmtItShort,
    weekdaysLabel, easter, italianHolidays, WEEKDAY_SHORT, WEEKDAY_LONG, overlaps,
    // dominio
    BLOCK_TYPES, PROFILES, SESSION_STATUS, OCCUPYING, COUNTED, FORECAST, CLOSED_FORECASTS, WAITLIST_STATUS, DEFAULT_SETTINGS,
    PRIORITY_CLASSES, PRIORITY_ORDER, REQUEST_TYPES, HAND_CATEGORIES, upgradeState,
    buildDay, buildWeek, validateDay,
    // calcolo
    makeContext, getDay, occupancy, virtualOccupancy, reserveEnd, checkSlot, cycleDates, nextPatternDate, evaluateCycle,
    eligibility, prefCompat, search, recheckOption, independentCount, compareGroups, bestOf, freeIntervals, findGaps,
    cycleCounts, pathCounts, sessionIssue, conflicts, impactedByAbsence, forecastOverview, compatibleWaitlist,
    // modifiche
    clone, uid, addLog, EngineError, bookCycle, previewRenewal, renewCycle, setSessionStatus, previewRecovery,
    scheduleRecovery, findSubstitutes, substitute, previewForecast, setForecast
  };
});
