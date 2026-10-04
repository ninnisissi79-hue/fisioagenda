/*
 * FisioAgenda — generatore dei dati DEMO (tutti fittizi).
 * Le date sono calcolate rispetto al giorno di generazione, così la demo è sempre "attuale".
 * Le categorie cliniche sono esempi modificabili, non l'elenco reale del servizio.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.FisioDemo = factory(root.FisioEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CATEGORIES = [
    { id: 'orto', name: 'Ortopedia post-chirurgica' },
    { id: 'protesi', name: 'Protesi anca / ginocchio' },
    { id: 'spalla', name: 'Spalla' },
    { id: 'rachide', name: 'Rachide / lombalgia' },
    { id: 'neuro', name: 'Neurologico' },
    { id: 'vest', name: 'Vestibolare' },
    { id: 'linf', name: 'Linfedema' },
    { id: 'pelv', name: 'Pavimento pelvico' },
    { id: 'resp', name: 'Riabilitazione respiratoria' },
    { id: 'mano', name: 'Mano / Chirurgia della mano', hand: true }
  ];

  // [nome, profilo, competenze specifiche, altre idoneità, competenze specifiche del percorso Mano]
  const STAFF = [
    ['Giulia Ferri', 'reparto7', ['neuro'], ['orto', 'rachide', 'protesi']],
    ['Marco Conti', 'reparto7', ['spalla', 'mano'], ['orto', 'protesi', 'rachide'], ['ortesi', 'postop', 'tendini']],
    ['Sara Galli', 'reparto7', ['linf'], ['orto', 'rachide', 'mano']],
    ['Luca Moretti', 'reparto7', ['rachide'], ['orto', 'protesi', 'spalla']],
    ['Elena Rinaldi', 'reparto7', ['pelv'], ['rachide', 'orto']],
    ['Davide Marini', 'reparto7', ['protesi'], ['orto', 'spalla', 'rachide']],
    ['Chiara Lombardi', 'reparto7', ['resp'], ['neuro', 'orto']],
    ['Paolo Greco', 'reparto7', ['orto'], ['protesi', 'spalla', 'rachide', 'mano']],
    ['Francesca Costa', 'reparto8', ['neuro', 'vest'], ['rachide']],
    ['Andrea Fontana', 'reparto8', ['spalla'], ['orto', 'protesi']],
    ['Valentina Barbieri', 'reparto8', ['rachide'], ['orto', 'pelv']],
    ['Simone Caruso', 'reparto8', ['protesi'], ['orto', 'rachide']],
    ['Martina Gentile', 'reparto8', ['linf'], ['orto', 'resp']],
    ['Matteo Ricci', 'reparto8', ['vest'], ['neuro', 'rachide']],
    ['Laura De Luca', 'reparto8', ['orto', 'mano'], ['protesi', 'spalla', 'rachide'], ['postop', 'tendini']],
    ['Roberto Mancini', 'reparto8', ['resp'], ['neuro']],
    ['Alessia Villa', 'ambulatorio', ['rachide', 'spalla'], ['orto', 'protesi']],
    ['Federico Serra', 'ambulatorio', ['orto', 'protesi'], ['rachide', 'spalla', 'mano'], ['ortesi']]
  ];

  const SURNAMES = ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Bruno', 'Ricci', 'Marino',
    'Greco', 'Gallo', 'Conti', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana',
    'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli',
    'Vitale', 'Lombardo', 'Serra', 'Coppola', 'De Santis', "D'Angelo", 'Marchetti', 'Parisi', 'Villa', 'Conte', 'Ferraro',
    'Ferri', 'Fabbri', 'Bianco', 'Marini', 'Grasso', 'Valentini', 'Messina', 'Sala', 'De Angelis', 'Gatti', 'Pellegrini'];
  const INITIALS = 'ABCDEFGILMNOPRSTV'.split('');

  function generateDemo(opts) {
    opts = opts || {};
    const today = opts.today || E.todayRome();
    const rnd = rngFrom(opts.seed || 20261004);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // lunedì di riferimento: questa settimana (o la prossima se oggi è sabato/domenica)
    const base = E.weekday(today) <= 5 ? E.mondayOf(today) : E.addDays(E.mondayOf(today), 7);
    const y = Number(today.slice(0, 4));
    const settings = E.clone(E.DEFAULT_SETTINGS);
    const closures = [...E.italianHolidays(y), ...E.italianHolidays(y + 1)];
    closures.push({ date: E.addDays(base, 25), label: 'Chiusura straordinaria (esempio modificabile)', type: 'chiusura' });
    closures.sort((a, b) => a.date < b.date ? -1 : 1);

    const therapists = STAFF.map((s, i) => {
      const t = {
        id: 'th' + String(i + 1).padStart(2, '0'), name: s[0], profile: s[1], competenze: s[2], idoneita: s[3], handSkills: s[4] || [],
        week: E.buildWeek(s[1], settings), exceptions: [],
        maxPatientsDay: s[1] === 'ambulatorio' ? 8 : null,
        note: s[1] === 'ambulatorio' ? 'Solo ambulatorio: pazienti 8:15–14:40 (fino alle 14:45 con estensione), 6–8 pazienti al giorno.' : ''
      };
      return t;
    });
    // variazioni realistiche della settimana tipo
    therapists[7].week[5] = E.buildDay('reparto8', settings); // il venerdì entra alle 8
    therapists[7].note = 'Il venerdì segue l\'orario del gruppo delle 8 (esempio di settimana non uniforme).';
    therapists[14].exceptions.push({
      date: E.addDays(base, 3), note: 'Formazione aziendale nel pomeriggio (esempio di eccezione)',
      in: '08:00', out: '15:12', blocks: [
        { type: 'cartelle', start: '08:00', end: '08:15' }, { type: 'amb', start: '08:15', end: '09:00', maxPatients: 1 },
        { type: 'reparto', start: '09:00', end: '12:20' }, { type: 'pausa', start: '12:20', end: '12:40' },
        { type: 'altro', start: '12:40', end: '15:12', note: 'Formazione' }
      ]
    });

    let state = {
      version: 2, meta: { createdAt: new Date().toISOString(), generatedFor: today, demo: true },
      settings, categories: E.clone(CATEGORIES).map(c => c.hand ? Object.assign(c, { subcategories: E.clone(E.HAND_SUBCATEGORIES) }) : c), therapists, closures,
      absences: [
        { id: 'ab1', therapistId: 'th03', type: 'Ferie', startDate: E.addDays(base, 14), endDate: E.addDays(base, 18), allDay: true, note: 'Ferie programmate' }
      ],
      patients: [], paths: [], cycles: [], sessions: [], waitlist: [], log: []
    };

    // ---- pazienti in carico: generati con il motore stesso, così sono sempre coerenti ----
    const usedNames = new Set();
    const newName = () => {
      for (let k = 0; k < 500; k++) {
        const n = pick(SURNAMES) + ' ' + pick(INITIALS) + '.';
        if (!usedNames.has(n)) { usedNames.add(n); return n; }
      }
      return 'Paziente ' + usedNames.size;
    };
    const tryBook = (th, spec) => {
      const ctx = E.makeContext(state, { today });
      const start = E.nextPatternDate(ctx, spec.from, spec.weekdays);
      const { dates } = E.cycleDates(ctx, start, spec.weekdays, spec.sessions);
      const day = E.getDay(ctx, th, start);
      const times = [];
      day.blocks.filter(b => b.type === 'amb').forEach(b => { for (let t = b.start; t + spec.duration <= b.end; t += spec.duration) times.push(t); });
      for (const t of shuffle(times)) {
        const ev = E.evaluateCycle(ctx, th, dates, t, spec.duration);
        if (ev.status === 'ok') {
          const r = E.bookCycle(state, {
            patientName: newName(), categoryId: spec.categoryId, therapistId: th.id, duration: spec.duration,
            weekdays: spec.weekdays, startTime: E.fromMin(t), startDate: start, sessions: spec.sessions
          }, { today });
          state = r.state;
          return r.pathId;
        }
      }
      return null;
    };
    const randomSpec = (th, weeksAgo) => ({
      categoryId: rnd() < 0.6 ? pick(th.competenze) : pick(th.idoneita),
      duration: rnd() < 0.8 ? 30 : 45,
      weekdays: rnd() < 0.55 ? [1, 3, 5] : [2, 4],
      sessions: rnd() < 0.15 ? 5 : 10,
      from: E.addDays(base, -7 * weeksAgo + Math.floor(rnd() * 3))
    });

    const historic = [];
    for (const th of therapists) {
      // un percorso "storico" per collega (servirà per mostrare i rinnovi)
      if (rnd() < 0.35) {
        const id = tryBook(th, Object.assign(randomSpec(th, 7 + Math.floor(rnd() * 3)), { sessions: 10 }));
        if (id) historic.push(id);
      }
      const target = th.profile === 'ambulatorio' ? 24 : 13;
      let made = 0;
      for (let k = 0; k < 60 && made < target; k++) {
        if (tryBook(th, randomSpec(th, Math.floor(rnd() * 6) - 1))) made++;
      }
    }

    // rinnovi: cicli collegati (10 → 20, uno arriva a 30)
    historic.forEach((pid, i) => {
      try {
        state = E.renewCycle(state, pid, 10, { today }).state;
        if (i === 0) state = E.renewCycle(state, pid, 10, { today }).state;
      } catch (e) { /* conflitto: il percorso resta di un solo ciclo */ }
    });

    // esiti delle sedute passate (registrati dall'operatore nella demo; mai automatici nel programma)
    const ctx0 = E.makeContext(state, { today });
    let pendingLeft = 3, openLeft = 8;
    const recentLimit = E.addDays(today, -3);
    for (const p of state.paths) {
      const ss = (ctx0.sessionsByPath.get(p.id) || []).filter(s => s.date < today);
      const leaveOpen = openLeft > 0 && rnd() < 0.15;
      for (const s of ss) {
        if (leaveOpen && s.date >= recentLimit) { continue; }
        const r = rnd();
        s.status = r < 0.04 ? 'assente' : 'effettuata';
        if (s.status === 'assente' && pendingLeft > 0 && s.date >= E.addDays(today, -14)) { s.status = 'da_recuperare'; pendingLeft--; }
      }
      if (leaveOpen && ss.some(s => s.date >= recentLimit)) openLeft--;
    }
    // riallinea gli oggetti (le sedute sono state modificate per riferimento nello stato)

    // previsioni
    const ctx1 = E.makeContext(state, { today });
    const assigned = { sosp_keep: false, sosp_free: false, interr: false };
    for (const p of state.paths) {
      const last = ctx1.lastDateByPath.get(p.id);
      const daysLeft = E.diffDays(today, last);
      const r = rnd();
      let f;
      if (daysLeft < 0) f = r < 0.95 ? 'conclusione_confermata' : 'probabile_conclusione';
      else if (daysLeft <= 14) f = r < 0.4 ? 'probabile_conclusione' : r < 0.65 ? 'conclusione_confermata' : r < 0.85 ? 'prosecuzione' : 'da_valutare';
      else f = r < 0.6 ? 'da_valutare' : r < 0.8 ? 'prosecuzione' : 'probabile_conclusione';
      p.forecast = { state: f, updatedAt: today, date: f === 'conclusione_confermata' ? last : null };
    }
    // sospensioni e interruzione (con effetti diversi sugli appuntamenti)
    const futureHeavy = state.paths.filter(p => (ctx1.sessionsByPath.get(p.id) || []).filter(s => s.date > E.addDays(today, 7)).length >= 4);
    const pickPath = () => { const p = futureHeavy.splice(Math.floor(rnd() * futureHeavy.length), 1)[0]; return p; };
    let p1 = pickPath();
    if (p1) state = E.setForecast(state, p1.id, { state: 'sospensione', keepSlots: true, reviewDate: E.addDays(today, 14), date: E.addDays(today, 1), note: 'Intervento programmato: posto mantenuto (esempio)' }, { today, confirmRelease: true }).state;
    let p2 = pickPath();
    if (p2) state = E.setForecast(state, p2.id, { state: 'sospensione', keepSlots: false, reviewDate: E.addDays(today, 21), date: E.addDays(today, 1), note: 'Ricovero: appuntamenti liberati (esempio)' }, { today, confirmRelease: true }).state;
    let p3 = pickPath();
    if (p3) state = E.setForecast(state, p3.id, { state: 'interruzione', note: 'Interrotto per scelta del paziente (esempio)' }, { today, confirmRelease: true }).state;

    // valutati ma non avviati
    for (let k = 0; k < 2; k++) {
      const th = therapists[3 + k * 7];
      const ptId = 'ptna' + k;
      state.patients.push({ id: ptId, name: newName(), note: 'Valutato, trattamento non avviato', createdAt: E.addDays(today, -10 - k) });
      state.paths.push({ id: 'pana' + k, patientId: ptId, categoryId: th.competenze[0], therapistId: th.id, duration: 30, weekdays: [1, 3, 5], startTime: '12:40',
        forecast: { state: 'non_avviato', updatedAt: E.addDays(today, -9), note: 'Dopo la valutazione non è stata indicata presa in carico' }, createdAt: E.addDays(today, -10 - k) });
    }

    // assenze inserite "oggi" (dopo gli appuntamenti): generano conflitti da gestire
    state.absences.push(
      { id: 'ab2', therapistId: 'th10', type: 'Malattia', startDate: base, endDate: null, allDay: true, note: 'Rientro non ancora comunicato' },
      { id: 'ab3', therapistId: 'th06', type: 'Permesso', startDate: E.addDays(base, 2), endDate: E.addDays(base, 2), allDay: false, startTime: '12:20', endTime: '14:12', note: 'Permesso orario' },
      { id: 'ab4', therapistId: 'th13', type: 'Ferie', startDate: E.addDays(base, 35), endDate: E.addDays(base, 39), allDay: true, note: 'Ferie richieste di recente' }
    );

    // dati della richiesta dei percorsi già in carico (fittizi, coerenti con la prima seduta)
    const ctx2 = E.makeContext(state, { today });
    const classes = ['B', 'D', 'D', 'P', 'P', 'NI'];
    const origins = ['mmg', 'specialista', 'reparto', 'specialista', 'mmg'];
    for (const p of state.paths) {
      const ss = ctx2.sessionsByPath.get(p.id) || [];
      const first = ss.length ? ss[0].date : (p.createdAt || today);
      const listDate = E.addDays(first, -(8 + Math.floor(rnd() * 30)));
      const req = E.emptyRequest({
        priorityClass: pick(classes), prescriptionDate: E.addDays(listDate, -(1 + Math.floor(rnd() * 6))), requestDate: listDate, listDate,
        accessType: state.cycles.filter(c => c.pathId === p.id).length > 1 ? 'prosecuzione' : 'primo', service: 'ciclo',
        origin: p.categoryId === 'mano' ? 'chir_mano' : pick(origins)
      });
      p.request = req;
      if (p.categoryId === 'mano') {
        p.hand = E.emptyHand({ subcategory: pick(['postop', 'tendini', 'fratture', 'rigidita', 'artrosi']), side: pick(['destro', 'sinistro']), sendingFacility: 'Chirurgia della mano (struttura fittizia)' });
      }
    }

    // lista d'attesa: ogni richiesta ha classe, date, accesso, prestazione e provenienza (dati fittizi)
    const R = o => E.emptyRequest(Object.assign({}, o, { startTerm: Object.assign(E.emptyRequest().startTerm, o.startTerm || {}) }));
    const ago = n => E.addDays(today, -n);
    const W = (k, o) => Object.assign({
      id: 'wl' + k, insertedAt: E.addDays(today, -o.daysAgo), status: 'in_attesa', duration: 30, sessions: 10,
      earliestDate: E.addDays(base, 7), pref: null, note: '', preaccordo: null
    }, o);
    state.waitlist = [
      W(1, { name: newName(), daysAgo: 41, priority: 'Alta', categoryId: 'protesi', weekdays: [1, 3, 5], pref: { from: '12:00', to: '15:00', mode: 'flessibile' }, availabilityNote: 'Preferisce fine mattinata',
        request: R({ priorityClass: 'P', prescriptionDate: ago(44), requestDate: ago(41), listDate: ago(41), accessType: 'primo', service: 'ciclo', origin: 'reparto',
          startTerm: { date: E.addDays(ago(44), 60), source: 'prescrittore', note: 'Il prescrittore indica di iniziare entro 60 giorni dalla dimissione' } }) }),
      W(2, { name: newName(), daysAgo: 37, priority: 'Media', categoryId: 'rachide', weekdays: [2, 4], status: 'contattato',
        request: R({ priorityClass: 'D', prescriptionDate: ago(40), requestDate: ago(37), listDate: ago(37), accessType: 'primo', service: 'ciclo', origin: 'mmg', diagnosis: 'Lombalgia cronica' }) }),
      W(3, { name: newName(), daysAgo: 33, priority: 'Alta', categoryId: 'neuro', duration: 45, weekdays: [1, 3, 5], availabilityNote: 'Accompagnato dal figlio, solo mattina presto', pref: { from: '07:00', to: '09:00', mode: 'obbligatoria' },
        request: R({ priorityClass: 'NI', prescriptionDate: ago(35), requestDate: ago(33), listDate: ago(33), accessType: 'primo', service: 'valutazione_fisio', origin: 'specialista' }) }),
      W(4, { name: newName(), daysAgo: 30, priority: 'Bassa', categoryId: 'spalla', weekdays: [2, 4],
        request: R({ priorityClass: 'P', prescriptionDate: ago(31), requestDate: ago(30), listDate: ago(30), accessType: 'prosecuzione', service: 'ciclo', origin: 'specialista' }) }),
      W(5, { name: newName(), daysAgo: 27, priority: 'Media', categoryId: 'linf', weekdays: [1, 3, 5], duration: 45,
        request: R({ priorityClass: 'B', prescriptionDate: ago(29), requestDate: ago(28), listDate: ago(27), accessType: 'primo', service: 'ciclo', origin: 'specialista' }) }),
      W(6, { name: newName(), daysAgo: 25, priority: 'Alta', categoryId: 'orto', weekdays: [1, 3, 5], sessions: 10, pref: { from: '12:20', to: '14:45', mode: 'flessibile' },
        request: R({ priorityClass: 'NI', prescriptionDate: ago(26), requestDate: ago(25), listDate: ago(25), accessType: 'primo', service: 'ciclo', origin: 'mmg' }) }),
      W(7, { name: newName(), daysAgo: 22, priority: 'Media', categoryId: 'vest', weekdays: [2, 4], sessions: 5,
        request: R({ priorityClass: 'D', prescriptionDate: ago(23), requestDate: ago(22), listDate: ago(22), accessType: 'controllo', service: 'valutazione_fisio', origin: 'specialista' }) }),
      W(8, { name: newName(), daysAgo: 20, priority: 'Bassa', categoryId: 'rachide', weekdays: [1, 3, 5], status: 'rinuncia', note: 'Ha scelto un altro centro',
        request: R({ priorityClass: 'P', prescriptionDate: ago(22), requestDate: ago(20), listDate: ago(20), accessType: 'primo', service: 'ciclo', origin: 'mmg' }) }),
      W(9, { name: newName(), daysAgo: 8, priority: 'Media', categoryId: 'pelv', weekdays: [2, 4], pref: { from: '12:00', to: '14:30', mode: 'flessibile' },
        request: R({ priorityClass: 'B', prescriptionDate: ago(10), requestDate: ago(9), listDate: ago(8), accessType: 'primo', service: 'ciclo', origin: 'specialista' }) }),
      W(10, { name: newName(), daysAgo: 1, priority: 'Alta', categoryId: 'resp', weekdays: [2, 4], sessions: 10,
        request: R({ priorityClass: 'U', prescriptionDate: ago(1), prescriptionTime: '09:10', requestDate: ago(1), requestTime: '11:30', listDate: ago(1), listTime: '11:45', accessType: 'primo', service: 'ciclo', origin: 'reparto', diagnosis: 'Esiti di polmonite, dimissione ospedaliera' }) }),
      W(11, { name: newName(), daysAgo: 9, priority: 'Media', categoryId: 'protesi', weekdays: [2, 4], duration: 45,
        request: R({ priorityClass: 'D', prescriptionDate: ago(12), requestDate: ago(9), listDate: ago(9), accessType: 'primo', service: 'visita_fisiatrica', origin: 'mmg' }) }),
      W(12, { name: newName(), daysAgo: 6, priority: 'Bassa', categoryId: 'orto', weekdays: [1, 3, 5],
        request: R({ priorityClass: 'D', prescriptionDate: ago(8), requestDate: ago(6), listDate: ago(6), accessType: 'primo', service: 'accertamento', origin: 'specialista' }) }),
      W(13, { name: newName(), daysAgo: 4, priority: 'Media', categoryId: 'spalla', weekdays: [1, 3, 5], pref: { from: '07:00', to: '09:00', mode: 'flessibile' },
        request: R({ priorityClass: 'U', prescriptionDate: ago(1), requestDate: ago(1), listDate: ago(1), accessType: 'primo', service: 'visita_fisiatrica', origin: 'mmg' }) }),
      W(14, { name: newName(), daysAgo: 2, priority: 'Alta', categoryId: 'neuro', weekdays: [2, 4],
        request: R({ priorityClass: 'U', prescriptionDate: ago(2), prescriptionTime: '10:00', requestDate: ago(2), requestTime: '10:20', listDate: ago(2), accessType: 'controllo', service: 'visita_fisiatrica', origin: 'specialista' }) }),
      // percorso Mano: la provenienza dalla Chirurgia della mano NON rende la richiesta urgente
      W(15, { name: newName(), daysAgo: 3, priority: 'Media', categoryId: 'mano', weekdays: [1, 3, 5],
        request: R({ priorityClass: 'B', prescriptionDate: ago(4), requestDate: ago(3), listDate: ago(3), accessType: 'primo', service: 'ciclo', origin: 'chir_mano', diagnosis: 'Sutura tendine flessore 3° dito',
          startTerm: { date: E.addDays(today, 7), notBefore: E.addDays(today, 2), source: 'prescrittore', note: 'Il chirurgo indica l\'inizio tra il 2° e il 7° giorno da oggi' } }),
        hand: E.emptyHand({ subcategory: 'tendini', side: 'destro', eventType: 'intervento', eventDate: ago(5), sendingFacility: 'Chirurgia della mano (struttura fittizia)', prescriberNotes: 'Protocollo indicato dal chirurgo in lettera', requiredSkill: 'postop' }) }),
      W(16, { name: newName(), daysAgo: 1, priority: 'Media', categoryId: 'mano', weekdays: [2, 4], sessions: 5,
        request: R({ priorityClass: 'NI', prescriptionDate: ago(2), requestDate: ago(1), listDate: ago(1), accessType: 'primo', service: 'valutazione_fisio', origin: 'chir_mano' }),
        hand: E.emptyHand({ subcategory: 'ortesi', side: 'sinistro', eventType: 'trauma', eventDate: ago(9), sendingFacility: 'Pronto soccorso (struttura fittizia)', requiredSkill: 'ortesi' }) }),
      W(17, { name: newName(), daysAgo: 5, priority: 'Bassa', categoryId: 'mano', weekdays: [1, 3, 5],
        request: R({ priorityClass: 'P', prescriptionDate: ago(6), requestDate: ago(5), listDate: ago(5), accessType: 'primo', service: 'ciclo', origin: 'chir_mano',
          startTerm: { date: E.addDays(today, 5), notBefore: E.addDays(today, 12), source: 'prescrittore', note: 'Esempio di indicazioni incompatibili: da chiarire con il prescrittore' } }),
        hand: E.emptyHand({ subcategory: 'rigidita', side: 'bilaterale', sendingFacility: 'Chirurgia della mano (struttura fittizia)' }) })
    ];
    // la prima data utile rispetta l'eventuale data "non prima del"
    state.waitlist.forEach(w => { const nb = w.request && w.request.startTerm.notBefore; if (nb && nb > w.earliestDate) w.earliestDate = nb; });
    state.log = [];
    E.addLog(state, 'Dati demo generati (tutti fittizi) per il ' + E.fmtIt(today));
    return state;
  }

  return { generateDemo, CATEGORIES, STAFF };
});
