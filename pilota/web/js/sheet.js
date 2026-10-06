/*
 * FisioAgenda pilota — lettura dei tabulati cartacei (logica pura, senza interfaccia).
 * Una riga del tabulato = un paziente in una fascia oraria; ogni casella del giorno contiene
 * il numero della seduta A RITROSO (in un ciclo da 10: 10 = prima seduta, 1 = ultima),
 * "R" (recupero) e/o "V" (visita fisiatrica, non è una seduta).
 * Nessun valore viene inventato: caselle dubbie o incoerenti sono segnalate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.FASheet = factory(root.FAE);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const FORMAT = 'fisioagenda-tabulato-1';
  const pad = n => String(n).padStart(2, '0');

  /** nome confrontabile (come app.norm_name sul server) */
  function normName(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function daysInMonth(month) { // month = 'YYYY-MM'
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  const dayOf = (month, d) => month + '-' + pad(d);

  /**
   * Contenuto di una casella: "3", "1V", "V1", "R", "RV", "V", "?" …
   * → { num, R, V, doubt, bad, raw }
   */
  function parseCell(raw) {
    const s = String(raw == null ? '' : raw).toUpperCase().replace(/\s+/g, '');
    const out = { raw: s, num: null, R: false, V: false, doubt: false, bad: null };
    if (!s) return out;
    let rest = s;
    if (rest.includes('?')) { out.doubt = true; rest = rest.replace(/\?/g, ''); }
    const m = rest.match(/\d+/g);
    if (m && m.length > 1) out.bad = 'più numeri nella stessa casella';
    if (m) out.num = Number(m[0]);
    rest = rest.replace(/\d+/g, '');
    if (rest.includes('R')) { out.R = true; rest = rest.replace(/R/g, ''); }
    if (rest.includes('V')) { out.V = true; rest = rest.replace(/V/g, ''); }
    if (rest.length) out.bad = 'caratteri non riconosciuti: ' + rest;
    if (out.num != null && out.R) out.bad = 'numero e R nella stessa casella';
    return out;
  }

  /** "3v", "2 v", "3V" → {perWeek}; "Lu", "Lun", "Ven" → {days:[…]} */
  const WD_ALIAS = { lu: 1, lun: 1, ma: 2, mar: 2, me: 3, mer: 3, gi: 4, gio: 4, ve: 5, ven: 5, sa: 6, sab: 6 };
  function parseFrequency(txt) {
    const s = normName(txt);
    if (!s) return {};
    const m = s.match(/^(\d)\s*v/);
    if (m) return { perWeek: Number(m[1]) };
    const days = s.split(' ').map(w => WD_ALIAS[w]).filter(Boolean);
    if (days.length) return { days: [...new Set(days)].sort(), perWeek: new Set(days).size };
    return {};
  }

  /**
   * Analisi di una riga.
   * row: { cells: {giorno: testo}, doubts: {giorno: motivo}, weekdays?, freq?, time? }
   * o:   { month: 'YYYY-MM', from: 'YYYY-MM-DD', planned: 10, today, closures: Set, generate: bool }
   */
  function analyzeRow(row, o) {
    const planned = Number(o.planned) || 10;
    const res = { cells: [], issues: [], blocking: [], visits: [], numbered: [], prior: null, imported: [], before: [], weekdays: [], generated: [] };
    if (!o.month) { res.blocking.push('Manca mese/anno del tabulato.'); return res; }
    const nd = daysInMonth(o.month);
    Object.keys(row.cells || {}).map(Number).filter(d => d >= 1 && d <= 31).sort((a, b) => a - b).forEach(d => {
      const c = parseCell(row.cells[d]);
      if (!c.raw) return;
      const day = dayOf(o.month, d);
      const cell = Object.assign(c, { d, day, doubtMsg: (row.doubts || {})[d] || (c.doubt ? 'casella con “?”' : null) });
      if (d > nd) cell.bad = 'il ' + d + ' non esiste in questo mese';
      if (cell.num != null && (cell.num < 1 || cell.num > planned)) cell.bad = 'numero fuori dal ciclo (1–' + planned + ')';
      if (cell.num != null && !cell.bad) cell.p = planned + 1 - cell.num; // seduta progressiva
      if (!cell.bad && E.weekday(day) >= 6) cell.warn = 'sabato o domenica';
      res.cells.push(cell);
    });
    res.cells.forEach(c => {
      if (c.bad) res.blocking.push(c.d + '/' + o.month.slice(5) + ': ' + c.bad + '.');
      if (c.doubtMsg) res.blocking.push(c.d + '/' + o.month.slice(5) + ': lettura incerta (' + c.doubtMsg + '): correggi o conferma la casella.');
    });
    // numeri in successione a ritroso: 10, 9, 8 … (un salto = seduta su un altro foglio)
    const num = res.cells.filter(c => c.num != null && !c.bad);
    res.numbered = num;
    for (let i = 1; i < num.length; i++) {
      const a = num[i - 1], b = num[i];
      if (b.num >= a.num) res.blocking.push('Numeri non in successione: ' + a.num + ' il ' + a.d + ', poi ' + b.num + ' il ' + b.d + '. Controlla le caselle.');
      else if (a.num - b.num > 1) {
        const miss = []; for (let k = a.num - 1; k > b.num; k--) miss.push(k);
        res.issues.push('Manca il n. ' + miss.join(', ') + ' tra il ' + a.d + ' e il ' + b.d + ': forse seduta fatta con un collega (compare sul suo tabulato).');
      }
    }
    const rs = res.cells.filter(c => c.R && !c.bad);
    if (rs.length > 1) res.issues.push(rs.length + ' recuperi (R) nella stessa riga: di norma se ne recupera al massimo uno.');
    // giorni della settimana
    const derived = [...new Set(num.map(c => E.weekday(c.day)))].sort();
    const freq = parseFrequency(row.freq);
    res.weekdays = (row.weekdays && row.weekdays.length ? row.weekdays.slice() : (freq.days || derived)).map(Number).sort();
    if (freq.perWeek && derived.length && derived.length !== freq.perWeek && !(row.weekdays && row.weekdays.length))
      res.issues.push('Frequenza «' + row.freq + '» ma le caselle cadono in ' + derived.length + ' giorni diversi (' + derived.map(w => E.WD_SHORT[w]).join(', ') + '): indica i giorni.');
    const odd = num.filter(c => res.weekdays.length && !res.weekdays.includes(E.weekday(c.day)));
    if (odd.length) res.issues.push('Sedute fuori dai giorni indicati: ' + odd.map(c => E.fmtItDay(c.day)).join(', ') + '.');
    // dalla data di inizio
    const from = o.from || dayOf(o.month, 1);
    res.before = res.cells.filter(c => c.day < from && (c.num != null || c.R));
    res.imported = res.cells.filter(c => c.day >= from && !c.bad && (c.num != null || c.R));
    res.visits = res.cells.filter(c => c.V && !c.bad && c.day >= from).map(c => c.day);
    const firstNum = res.imported.find(c => c.num != null);
    if (firstNum) res.prior = firstNum.p - 1;
    else {
      const lastBefore = res.before.filter(c => c.num != null).pop();
      if (lastBefore) res.prior = lastBefore.p;
    }
    // visite in giorni senza trattamento
    const treat = new Set(res.cells.filter(c => c.num != null || c.R).map(c => c.day));
    res.visits.filter(v => !treat.has(v)).forEach(v => {
      const near = [...treat].sort((a, b) => Math.abs(E.diffDays(v, a)) - Math.abs(E.diffDays(v, b))).slice(0, 2);
      res.issues.push('Visita fisiatrica ' + E.fmtItDay(v) + ' in un giorno senza trattamento' + (near.length ? ' (giorni di trattamento vicini: ' + near.map(E.fmtItDay).join(', ') + ')' : '') + '.');
    });
    // sedute aggiuntive solo su scelta esplicita
    const last = num[num.length - 1];
    res.missingAfter = last ? last.num - 1 : 0;
    if (o.generate && last && last.num > 1 && res.weekdays.length) {
      let d = E.addDays(last.day, 1), k = last.num - 1, guard = 0;
      const start = o.today && o.today > d ? o.today : d;
      d = start;
      while (k >= 1 && guard++ < 400) {
        if (res.weekdays.includes(E.weekday(d)) && !(o.closures && o.closures.has(d))) {
          res.generated.push({ d: null, day: d, num: k, p: planned + 1 - k, generated: true, raw: String(k) });
          k--;
        }
        d = E.addDays(d, 1);
      }
    }
    return res;
  }

  /** Converte la trascrizione (JSON) in fogli modificabili. Restituisce { sheets, errors }. */
  function fromTranscript(obj) {
    const errors = [];
    if (!obj || typeof obj !== 'object') return { sheets: [], errors: ['File non valido.'] };
    if (obj.formato !== FORMAT) errors.push('Formato non riconosciuto (atteso «' + FORMAT + '»).');
    const list = Array.isArray(obj.fogli) ? obj.fogli : [];
    if (!list.length) errors.push('Nessun foglio nella trascrizione.');
    const sheets = list.map((f, i) => ({
      label: f.etichetta || ((f.fisioterapista || 'Foglio ' + (i + 1)) + (f.mese ? ' ' + f.mese : '')),
      thName: f.fisioterapista || '',
      month: /^\d{4}-\d{2}$/.test(f.mese || '') ? f.mese : '',
      photoName: f.foto || '',
      rotation: Number(f.rotazione) || 0,
      duration: f.durata ? Number(f.durata) : null,
      durationHint: f.durata_suggerita ? Number(f.durata_suggerita) : null,
      durationNote: f.durata_nota || '',
      planned: Number(f.sedute_ciclo) || 10,
      grid: f.griglia || null,
      rows: (f.righe || []).map((r, j) => ({
        ref: r.rif || ('R' + (j + 1)), include: r.importa !== false, name: r.paziente || '', time: r.ora || '', freq: r.frequenza || '',
        weekdays: Array.isArray(r.giorni) ? r.giorni.map(Number) : [], tipo: r.tipo || '', closed: !!r.chiuso, y: r.y == null ? null : Number(r.y),
        cells: Object.assign({}, r.caselle || {}), doubts: Object.assign({}, r.dubbi || {}), rowDoubts: (r.dubbi_riga || []).map(t => ({ text: t, ok: false })),
        note: r.nota || ''
      })),
      extra: (f.estemporanei || []).map((x, j) => ({ ref: 'E' + (j + 1), name: x.paziente || '', d: Number(x.giorno) || null, time: x.ora || '', value: x.valore || '', note: x.nota || '', y: x.y == null ? null : Number(x.y), cycleId: '' })),
      notes: (f.note || []).map(n => ({ days: n.giorni || [], text: n.testo || '' }))
    }));
    return { sheets, errors };
  }

  /** posizione della casella sulla foto (in % dell'immagine raddrizzata), se la trascrizione la fornisce */
  function cellPos(grid, d, y) {
    if (!grid || y == null || grid.x_giorno1 == null || grid.x_giorno31 == null) return null;
    const x = grid.x_giorno1 + (grid.x_giorno31 - grid.x_giorno1) * (d - 1) / 30;
    return { x, y, w: Math.abs(grid.x_giorno31 - grid.x_giorno1) / 30, h: grid.h_riga || 3 };
  }

  return { FORMAT, normName, daysInMonth, dayOf, parseCell, parseFrequency, analyzeRow, fromTranscript, cellPos };
});
