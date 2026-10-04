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
    { id: 'mano', name: 'Mano' },
    { id: 'chir_mano', name: 'Chirurgia della mano / postoperatorio' }
  ];

  // [nome, profilo, competenze specifiche, altre idoneità]
  const STAFF = [
    ['Giulia Ferri', 'reparto7', ['neuro'], ['orto', 'rachide', 'protesi']],
    ['Marco Conti', 'reparto7', ['spalla', 'mano', 'chir_mano'], ['orto', 'protesi', 'rachide']],
    ['Sara Galli', 'reparto7', ['linf'], ['orto', 'rachide', 'mano']],
    ['Luca Moretti', 'reparto7', ['rachide'], ['orto', 'protesi', 'spalla']],
    ['Elena Rinaldi', 'reparto7', ['pelv'], ['rachide', 'orto']],
    ['Davide Marini', 'reparto7', ['protesi'], ['orto', 'spalla', 'rachide']],
    ['Chiara Lombardi', 'reparto7', ['resp'], ['neuro', 'orto']],
    ['Paolo Greco', 'reparto7', ['orto'], ['protesi', 'spalla', 'rachide', 'mano', 'chir_mano']],
    ['Francesca Costa', 'reparto8', ['neuro', 'vest'], ['rachide']],
    ['Andrea Fontana', 'reparto8', ['spalla'], ['orto', 'protesi']],
    ['Valentina Barbieri', 'reparto8', ['rachide'], ['orto', 'pelv']],
    ['Simone Caruso', 'reparto8', ['protesi'], ['orto', 'rachide']],
    ['Martina Gentile', 'reparto8', ['linf'], ['orto', 'resp']],
    ['Matteo Ricci', 'reparto8', ['vest'], ['neuro', 'rachide']],
    ['Laura De Luca', 'reparto8', ['orto', 'chir_mano'], ['protesi', 'spalla', 'rachide', 'mano']],
    ['Roberto Mancini', 'reparto8', ['resp'], ['neuro']],
    ['Alessia Villa', 'ambulatorio', ['rachide', 'spalla'], ['orto', 'protesi']],
    ['Federico Serra', 'ambulatorio', ['orto', 'protesi'], ['rachide', 'spalla', 'mano']]
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
        id: 'th' + String(i + 1).padStart(2, '0'), name: s[0], profile: s[1], competenze: s[2], idoneita: s[3],
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
      version: 1, meta: { createdAt: new Date().toISOString(), generatedFor: today, demo: true },
      settings, categories: E.clone(CATEGORIES), therapists, closures,
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
      state.paths.push({ id: 'pana' + k, patientId: ptId, categoryId: th.competenze[0], therapistId: th.id, duration: 30, weekdays: [1, 3, 5], startTime: '12:40', priority: 'NI', requestType: 'prima',
        forecast: { state: 'non_avviato', updatedAt: E.addDays(today, -9), note: 'Dopo la valutazione non è stata indicata presa in carico' }, createdAt: E.addDays(today, -10 - k) });
    }

    // assenze inserite "oggi" (dopo gli appuntamenti): generano conflitti da gestire
    state.absences.push(
      { id: 'ab2', therapistId: 'th10', type: 'Malattia', startDate: base, endDate: null, allDay: true, note: 'Rientro non ancora comunicato' },
      { id: 'ab3', therapistId: 'th06', type: 'Permesso', startDate: E.addDays(base, 2), endDate: E.addDays(base, 2), allDay: false, startTime: '12:20', endTime: '14:12', note: 'Permesso orario' },
      { id: 'ab4', therapistId: 'th13', type: 'Ferie', startDate: E.addDays(base, 35), endDate: E.addDays(base, 39), allDay: true, note: 'Ferie richieste di recente' }
    );

    // lista d'attesa
    const W = (k, o) => Object.assign({
      id: 'wl' + k, insertedAt: E.addDays(today, -o.daysAgo), status: 'in_attesa', duration: 30, sessions: 10,
      earliestDate: E.addDays(base, 7), pref: null, note: '', preaccordo: null
    }, o);
    state.waitlist = [
      W(1, { name: newName(), daysAgo: 41, priority: 'B', requestType: 'prima', categoryId: 'protesi', weekdays: [1, 3, 5], pref: { from: '12:00', to: '15:00', mode: 'flessibile' }, availabilityNote: 'Preferisce fine mattinata' }),
      W(2, { name: newName(), daysAgo: 37, priority: 'D', requestType: 'prima', categoryId: 'rachide', weekdays: [2, 4], status: 'contattato' }),
      W(3, { name: newName(), daysAgo: 33, priority: 'B', requestType: 'prima', categoryId: 'neuro', duration: 45, weekdays: [1, 3, 5], availabilityNote: 'Accompagnato dal figlio, solo mattina presto', pref: { from: '07:00', to: '09:00', mode: 'obbligatoria' } }),
      W(4, { name: newName(), daysAgo: 30, priority: 'P', requestType: 'continuazione', categoryId: 'spalla', weekdays: [2, 4] }),
      W(5, { name: newName(), daysAgo: 27, priority: 'D', requestType: 'prima', categoryId: 'linf', weekdays: [1, 3, 5], duration: 45 }),
      W(6, { name: newName(), daysAgo: 25, priority: 'U', requestType: 'prima', categoryId: 'orto', weekdays: [1, 3, 5], sessions: 10, pref: { from: '12:20', to: '14:45', mode: 'flessibile' } }),
      W(7, { name: newName(), daysAgo: 22, priority: 'NI', requestType: 'prima', categoryId: 'vest', weekdays: [2, 4], sessions: 5 }),
      W(8, { name: newName(), daysAgo: 20, priority: 'P', requestType: 'prima', categoryId: 'rachide', weekdays: [1, 3, 5], status: 'rinuncia', note: 'Ha scelto un altro centro' }),
      W(9, { name: newName(), daysAgo: 16, priority: 'D', requestType: 'continuazione', categoryId: 'pelv', weekdays: [2, 4], pref: { from: '12:00', to: '14:30', mode: 'flessibile' } }),
      W(10, { name: newName(), daysAgo: 12, priority: 'U', requestType: 'prima', categoryId: 'resp', weekdays: [2, 4], sessions: 10 }),
      W(11, { name: newName(), daysAgo: 9, priority: 'P', requestType: 'prima', categoryId: 'protesi', weekdays: [2, 4], duration: 45 }),
      W(12, { name: newName(), daysAgo: 6, priority: 'NI', requestType: 'continuazione', categoryId: 'orto', weekdays: [1, 3, 5] }),
      W(13, { name: newName(), daysAgo: 4, priority: 'D', requestType: 'prima', categoryId: 'spalla', weekdays: [1, 3, 5], pref: { from: '07:00', to: '09:00', mode: 'flessibile' } }),
      W(14, { name: newName(), daysAgo: 2, priority: 'B', requestType: 'prima', categoryId: 'neuro', weekdays: [2, 4] }),
      W(15, { name: newName(), daysAgo: 3, priority: 'B', requestType: 'prima', categoryId: 'chir_mano', weekdays: [1, 3, 5], note: 'Esempio fittizio: postoperatorio della mano' }),
      W(16, { name: newName(), daysAgo: 1, priority: 'NI', requestType: 'continuazione', categoryId: 'mano', weekdays: [2, 4], sessions: 5 })
    ];
    state.log = [];
    E.addLog(state, 'Dati demo generati (tutti fittizi) per il ' + E.fmtIt(today));
    return state;
  }

  return { generateDemo, CATEGORIES, STAFF };
});
