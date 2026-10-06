/*
 * FisioAgenda pilota — importazione dei tabulati cartacei.
 * Flusso: carica foto (e trascrizione) → fisioterapista e periodo → anteprima con la foto accanto
 * → correggi → conferma. Ogni importazione è annullabile. Le foto restano sul computer: non
 * vengono inviate a nessun servizio, si conserva solo la loro impronta (per riconoscere i doppioni).
 * Il server ricontrolla tutto (turni, assenze, competenze, sovrapposizioni, doppioni).
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc, H = window.FASheet;
  const FORCEABLE = new Set(['fuori_turno', 'blocco', 'assenza', 'chiusura', 'max_fascia', 'max_giorno', 'probabile', 'inattivo']);
  let seq = 0;

  function st() { if (!A.ui.imp) A.ui.imp = { sheets: [], cur: 0, paste: '', msg: null }; return A.ui.imp; }
  function cur() { const s = st(); return s.sheets[s.cur] || null; }
  const P = (i, rest) => 'imp.sheets.' + i + '.' + rest;

  /* ---------------- creazione dei fogli ---------------- */
  function matchTherapist(name) {
    const n = H.normName(name);
    if (!n) return '';
    const own = FA.isFisio() ? A.me.therapist_id : null;
    const list = FA.activeTherapists().filter(t => { const w = H.normName(t.name).split(' '); return n.split(' ').every(x => w.includes(x)); });
    if (own && list.some(t => t.id === own)) return own;
    return list.length === 1 ? list[0].id : '';
  }
  function defaultFrom(month) {
    if (!month) return '';
    const first = month + '-01', last = month + '-' + String(H.daysInMonth(month)).padStart(2, '0');
    return A.today >= first && A.today <= last ? A.today : first;
  }
  function newSheet(base) {
    const s = Object.assign({ label: 'Foglio', thName: '', month: '', photoName: '', rotation: 0, duration: null, durationHint: null, durationNote: '',
      planned: 10, grid: null, rows: [], extra: [], notes: [], absences: [] }, base || {});
    s.subsMap = {};
    s.id = ++seq;
    s.th = matchTherapist(s.thName) || (FA.isFisio() ? A.me.therapist_id || '' : '');
    s.from = defaultFrom(s.month);
    s.durSel = s.duration ? ([30, 45, 60].includes(s.duration) ? String(s.duration) : 'altro') : '';
    s.durOther = s.duration && ![30, 45, 60].includes(s.duration) ? String(s.duration) : '';
    s.category = defaultCategory(s.th);
    s.photo = null; s.sel = null; s.result = null; s.error = null; s.zoom = false;
    s.rows.forEach(r => { r.choice = ''; r.force = {}; r.generate = false; if (r.include == null) r.include = true; });
    return s;
  }
  function defaultCategory(th) {
    if (!th) return '';
    const cats = FA.categories().filter(c => E.skillLevel(A.ctx, th, c.id));
    return (cats.find(c => c.id === 'mano') || cats[0] || {}).id || '';
  }
  async function sha256(buf) {
    try {
      const h = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return null; }
  }
  /** immagine raddrizzata (rotazione in senso orario) come URL locale */
  function rotated(photo, deg) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const swap = deg === 90 || deg === 270;
        const c = document.createElement('canvas');
        c.width = swap ? img.naturalHeight : img.naturalWidth; c.height = swap ? img.naturalWidth : img.naturalHeight;
        const g = c.getContext('2d');
        g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180);
        g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        c.toBlob(b => resolve(b ? URL.createObjectURL(b) : photo.url), 'image/jpeg', 0.9);
      };
      img.onerror = () => resolve(photo.url);
      img.src = photo.url;
    });
  }
  async function setRotation(s, deg) {
    s.rotation = ((deg % 360) + 360) % 360;
    if (!s.photo) return;
    if (s.photo.view && s.photo.view !== s.photo.url) URL.revokeObjectURL(s.photo.view);
    s.photo.view = s.rotation ? await rotated(s.photo, s.rotation) : s.photo.url;
  }
  async function attachPhoto(s, file) {
    const buf = await file.arrayBuffer();
    s.photo = { name: file.name, url: URL.createObjectURL(file), hash: await sha256(buf), view: null };
    await setRotation(s, s.rotation || 0);
  }
  function loadTranscript(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return ['Il testo non è una trascrizione valida (JSON): ' + e.message]; }
    const { sheets, errors } = H.fromTranscript(obj);
    if (errors.length && !sheets.length) return errors;
    const S = st();
    sheets.forEach(x => S.sheets.push(newSheet(x)));
    S.cur = S.sheets.length - sheets.length;
    return errors;
  }
  /**
   * Legge un archivio .zip nel browser (nessun invio a servizi esterni): restituisce i file contenuti.
   * Supporta i metodi "stored" e "deflate" (quelli usati da Windows, macOS e dagli strumenti comuni).
   */
  async function readZip(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf), out = [];
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Il file non è un archivio .zip valido.');
    const n = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const raw = u8.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8 && typeof DecompressionStream !== 'undefined') data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error('Archivio .zip non supportato da questo browser: estrai i file e selezionali tutti insieme.');
      out.push({ name: name.split('/').pop(), data });
    }
    return out;
  }
  const IMG_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' };
  FA.actions['imp-files'] = async el => {
    const S = st();
    let files = [...(el.files || [])];
    const errs = [];
    // archivi .zip: si aprono qui nel browser e si usano i file che contengono
    for (const z of files.filter(f => /\.zip$/i.test(f.name))) {
      try {
        let items = await readZip(await z.arrayBuffer());
        const sheets = items.filter(x => /\.json$/i.test(x.name));
        // l'esempio fittizio si carica solo se è l'unico tabulato dell'archivio
        if (sheets.some(x => !/^tabulato-fittizio/i.test(x.name))) items = items.filter(x => !/^tabulato-fittizio/i.test(x.name));
        files = files.concat(items.filter(x => /\.(json|txt)$/i.test(x.name) || IMG_TYPE[(x.name.split('.').pop() || '').toLowerCase()])
          .map(x => new File([x.data], x.name, { type: IMG_TYPE[(x.name.split('.').pop() || '').toLowerCase()] || 'application/json' })));
      } catch (e) { errs.push(z.name + ': ' + e.message); }
    }
    files = files.filter(f => !/\.zip$/i.test(f.name));
    const photos = files.filter(f => /^image\//.test(f.type)), texts = files.filter(f => !/^image\//.test(f.type));
    const before = S.sheets.length;
    for (const f of texts) errs.push(...loadTranscript(await f.text()).map(m => f.name + ': ' + m));
    for (const f of photos) {
      // la foto va al foglio con lo stesso nome, poi al primo foglio senza foto, altrimenti a un nuovo foglio da compilare a mano
      let s = S.sheets.find(x => !x.photo && x.photoName && H.normName(x.photoName) === H.normName(f.name))
        || S.sheets.find(x => !x.photo && (!x.photoName || !photos.some(p => H.normName(p.name) === H.normName(x.photoName))));
      if (!s) { s = newSheet({ label: f.name }); S.sheets.push(s); }
      await attachPhoto(s, f);
    }
    const added = S.sheets.length - before;
    S.msg = (added > 1 ? 'Caricati ' + added + ' tabulati: li trovi nelle schede qui sotto, si importano uno alla volta. ' : '') + (errs.length ? errs.join(' ') : '') || null;
    if (added) S.cur = before;
    el.value = '';
    FA.render();
  };
  FA.actions['imp-paste'] = () => {
    const S = st();
    const errs = loadTranscript(S.paste || '');
    S.msg = errs.length ? errs.join(' ') : null;
    if (!errs.length || S.sheets.length) S.paste = '';
    FA.render();
  };
  FA.actions['imp-manual'] = () => {
    const S = st();
    const m = A.today.slice(0, 7);
    S.sheets.push(newSheet({ label: 'Foglio a mano', month: m }));
    S.cur = S.sheets.length - 1;
    FA.render();
  };
  FA.actions['imp-tab'] = el => { st().cur = Number(el.getAttribute('data-i')); FA.render(); };
  FA.actions['imp-close'] = el => {
    const S = st(), i = Number(el.getAttribute('data-i'));
    const s = S.sheets[i];
    if (!s.result && !confirm('Chiudere il foglio «' + s.label + '»? Le correzioni non importate andranno perse.')) return;
    S.sheets.splice(i, 1); S.cur = Math.max(0, Math.min(S.cur, S.sheets.length - 1));
    FA.render();
  };
  FA.actions['imp-photo'] = async el => {
    const s = cur(), f = el.files && el.files[0];
    if (s && f) { await attachPhoto(s, f); FA.render(); }
  };
  FA.actions['imp-rot'] = async () => { const s = cur(); await setRotation(s, s.rotation + 90); FA.render(); };
  FA.actions['imp-zoom'] = () => { const s = cur(); s.zoom = !s.zoom; FA.render(); };
  FA.actions['imp-th'] = () => { const s = cur(); s.category = defaultCategory(s.th); FA.render(); };
  FA.actions['imp-month'] = () => { const s = cur(); s.from = defaultFrom(s.month); FA.render(); };
  FA.actions['imp-add-row'] = () => {
    const s = cur();
    s.rows.push({ ref: 'M' + (s.rows.length + 1), include: true, name: '', time: '', freq: '', weekdays: [], tipo: '', closed: false, y: null,
      cells: {}, subs: {}, times: {}, doubts: {}, rowDoubts: [], note: '', choice: '', force: {}, generate: false, dur: '' });
    FA.render();
  };
  FA.actions['imp-del-row'] = el => { const s = cur(); s.rows.splice(Number(el.getAttribute('data-r')), 1); FA.render(); };
  FA.actions['imp-wd'] = el => {
    const s = cur(), r = s.rows[Number(el.getAttribute('data-r'))], wd = Number(el.getAttribute('data-wd'));
    const base = r.weekdays.length ? r.weekdays : analyze(s, r).an.weekdays;
    r.weekdays = base.includes(wd) ? base.filter(x => x !== wd) : base.concat([wd]).sort();
    FA.render();
  };
  // casella modificata: la si considera verificata; la pagina si aggiorna quando si esce dalle caselle,
  // così si può passare da una casella all'altra con Tab senza interruzioni
  let cellsDirty = false;
  FA.actions['imp-cell'] = (el) => {
    const s = cur(), r = s.rows[Number(el.getAttribute('data-r'))], d = el.getAttribute('data-d');
    delete r.doubts[d];
    r.cells[d] = String(r.cells[d] || '').toUpperCase().trim();
    cellsDirty = true;
    setTimeout(flushCells, 0);
  };
  function flushCells() {
    const el = document.activeElement;
    if (!cellsDirty || (el && el.hasAttribute && el.hasAttribute('data-imp-cell'))) return;
    cellsDirty = false; FA.render();
  }
  document.addEventListener('focusout', () => setTimeout(flushCells, 0));
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.hasAttribute && ev.target.hasAttribute('data-imp-cell')) { ev.target.blur(); }
  });
  FA.actions['imp-cell-ok'] = el => {
    const s = cur(), r = s.rows[Number(el.getAttribute('data-r'))];
    const d = el.getAttribute('data-d');
    delete r.doubts[d];
    r.cells[d] = String(r.cells[d] || '').replace(/\?/g, '');
    FA.render();
  };
  FA.actions['imp-rd'] = el => { const s = cur(), r = s.rows[Number(el.getAttribute('data-r'))]; r.rowDoubts[Number(el.getAttribute('data-k'))].ok = el.checked; FA.render(); };
  FA.actions['imp-force'] = el => { const s = cur(), r = s.rows[Number(el.getAttribute('data-r'))]; r.force[el.getAttribute('data-day')] = el.checked; FA.render(); };
  FA.actions['imp-rerender'] = () => FA.render();

  // selezione di una casella: evidenzia il punto corrispondente sulla foto (senza ridisegnare la pagina)
  document.addEventListener('focusin', ev => {
    const el = ev.target.closest && ev.target.closest('[data-imp-cell]');
    if (!el || !cur()) return;
    const s = cur();
    s.sel = { r: Number(el.getAttribute('data-r')), d: Number(el.getAttribute('data-d')) };
    placeMark(s);
  });
  function markStyle(s) {
    if (!s.sel) return null;
    const r = s.rows[s.sel.r];
    if (!r || r.y == null) return null;
    const p = H.cellPos(s.grid, s.sel.d, r.y);
    if (!p) return { band: true, y: r.y, h: (s.grid && s.grid.h_riga) || 3 };
    return p;
  }
  function placeMark(s) {
    const m = document.querySelector('.imp-mark'), b = document.querySelector('.imp-band');
    const p = markStyle(s);
    if (!m || !b) return;
    if (!p) { m.style.display = b.style.display = 'none'; return; }
    b.style.display = 'block'; b.style.top = (p.y - p.h / 2) + '%'; b.style.height = p.h + '%';
    if (p.band) { m.style.display = 'none'; return; }
    m.style.display = 'block';
    m.style.left = (p.x - p.w / 2) + '%'; m.style.top = (p.y - p.h / 2) + '%'; m.style.width = p.w + '%'; m.style.height = p.h + '%';
    if (s.zoom) m.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /* ---------------- analisi di una riga ---------------- */
  function sheetDur(s) {
    if (s.durSel === 'altro') { const n = Number(s.durOther); return n >= 15 && n <= 120 && n % 5 === 0 ? n : 0; }
    return Number(s.durSel) || 0;
  }
  /** durata del paziente: quella della riga se indicata, altrimenti quella del foglio */
  function rowDur(s, r) { const n = Number(r.dur); return n >= 15 && n <= 120 && n % 5 === 0 ? n : sheetDur(s); }
  function candidates(s, r) {
    const n = H.normName(r.name);
    if (!n) return [];
    return (A.data.patients || []).filter(p => { const m = H.normName(p.name); return m === n || m.startsWith(n + ' '); });
  }
  /** scelta del paziente: '' (automatica) | 'nuovo' | 'omonimo' | 'p:<id>' | 'c:<id>' */
  function resolve(s, r) {
    const cands = candidates(s, r);
    let ch = r.choice;
    if (!ch) {
      const cyc = (A.data.cycles || []).filter(c => c.status === 'attivo' && c.therapist_id === s.th && cands.some(p => p.id === c.patient_id));
      if (cyc.length === 1) ch = 'c:' + cyc[0].id;
      else if (!cands.length) ch = 'nuovo';
    }
    if (!ch) return { need: true, cands };
    if (ch === 'nuovo' || ch === 'omonimo') return { target: 'nuovo', homonym: ch === 'omonimo' || cands.length > 0, cands, auto: !r.choice };
    if (ch.startsWith('p:')) return { target: 'paziente', patientId: ch.slice(2), cands };
    const c = A.ctx.cyc.get(ch.slice(2));
    return c ? { target: 'ciclo', cycleId: c.id, patientId: c.patient_id, cycle: c, cands, auto: !r.choice } : { need: true, cands };
  }
  function existingOnDay(patientId, day) {
    return (A.data.appointments || []).find(a => a.patient_id === patientId && a.day === day && a.status !== 'spostata' && a.status !== 'liberata');
  }
  /** analisi completa di una riga nel contesto del foglio: celle da importare, doppioni, conflitti, motivi di blocco */
  function analyze(s, r, extraAcc) {
    const closures = new Set(A.ctx.closures.keys());
    const an = H.analyzeRow({ cells: r.cells, doubts: r.doubts, weekdays: r.weekdays, freq: r.freq }, { month: s.month, from: s.from, planned: s.planned, today: A.today, closures, generate: r.generate });
    const res = resolve(s, r);
    const dur = res.cycle ? res.cycle.duration : rowDur(s, r);
    const time = FA.normTime(r.time);
    const block = an.blocking.slice();
    const out = { an, res, time, cells: [], dups: [], conflicts: [], block, issues: an.issues.slice(), visits: an.visits.slice() };
    if (!r.include) return out;
    if (res.need) block.push('Paziente già presente con questo nome: scegli se è lo stesso o un omonimo.');
    if (res.target !== 'ciclo' && !r.name.trim()) block.push('Manca il nome del paziente.');
    if (!time) block.push(r.time ? 'Orario non valido: ' + r.time + '.' : 'Manca l’orario della fascia.');
    r.rowDoubts.forEach(d => { if (!d.ok) block.push('Da controllare: ' + d.text); });
    // un nuovo ciclo iniziato sulla stessa riga riceve anche le eventuali sedute aggiunte
    const nextSet = new Set(an.next ? an.next.cells.concat(an.generated) : []);
    const cells = an.imported.concat(an.next ? an.next.cells : []).concat(an.generated);
    if (res.target !== 'ciclo' && an.imported.length && an.prior == null) block.push('Serve almeno un numero di seduta per sapere a che punto è il ciclo.');
    if (res.target !== 'ciclo' && !an.weekdays.length && cells.length) block.push('Indica i giorni della settimana.');
    if (res.target !== 'ciclo' && an.prior != null && an.prior >= Number(s.planned)) block.push('Ciclo già completato (' + an.prior + ' su ' + s.planned + '): per un solo recupero collega il ciclo esistente oppure escludi la riga.');
    if (res.target === 'ciclo' && res.cycle) {
      const cnt = E.cycleCounts(A.ctx, res.cycle.id);
      out.issues.unshift('Continua il ciclo in corso (' + cnt.effettuate + ' effettuate, ' + cnt.programmate + ' programmate su ' + res.cycle.planned_sessions + ').');
    }
    cells.forEach(c => {
      // orario diverso per una sola casella (seduta scritta in un'altra fascia del foglio)
      const t0 = c.d != null && (r.times || {})[c.d] ? FA.normTime(r.times[c.d]) || time : time;
      const end = t0 && dur ? E.fromMin(E.toMin(t0) + dur) : null;
      const sub = c.d != null && (r.subs || {})[c.d] ? H.normName(r.subs[c.d]) : null;
      const subTh = sub && s.subsMap[sub] ? s.subsMap[sub] : null;
      const item = { c, day: c.day, start: t0, end, next: nextSet.has(c), th: subTh || s.th, thMain: s.th, sub: sub ? r.subs[c.d] : null };
      if (res.patientId && existingOnDay(res.patientId, c.day)) { out.dups.push(item); return; }
      if (!end) { out.cells.push(item); return; } // orario o durata ancora da indicare: i controlli si fanno dopo
      const chk = E.checkSlot(A.ctx, item.th, c.day, t0, end, { patientId: res.patientId || null, cycleId: res.cycleId || null, reserve: false, extra: extraAcc });
      if (chk) {
        item.chk = chk; item.forceable = FORCEABLE.has(chk.code);
        out.conflicts.push(item);
        if (!(item.forceable && r.force[c.day])) out.unresolved = (out.unresolved || 0) + 1;
      }
      out.cells.push(item);
      if (extraAcc) extraAcc.push({ therapist_id: item.th, day: c.day, start: t0, end, patient_id: res.patientId || 'riga-' + r.ref, ref: r.ref });
    });
    if (out.unresolved) block.push(out.unresolved + (out.unresolved === 1 ? ' seduta in conflitto' : ' sedute in conflitto') + ' (vedi l’elenco): correggi la casella o l’orario, oppure importa comunque quelle fuori turno.');
    if (res.patientId) out.visits = out.visits.filter(v => !(A.ctx.events.get(res.patientId + '|' + v)));
    if (!out.cells.length && !out.visits.length) out.nothing = true;
    if (res.target === 'nuovo' && !out.cells.length && out.visits.length) { out.nothing = true; out.issues.push('Solo visite, nessuna seduta da importare: riga saltata.'); }
    return out;
  }
  function analyzeSheet(s) {
    const acc = [];
    return s.rows.map(r => analyze(s, r, acc));
  }
  function sheetBlock(s) {
    const b = [];
    if (!s.th) b.push('Scegli il fisioterapista del tabulato.');
    else if (!FA.canEditTh(s.th)) b.push('Puoi importare solo il tuo tabulato.');
    if (!s.month) b.push('Indica mese e anno del tabulato.');
    if (!s.from) b.push('Indica la data da cui importare.');
    else if (s.month && s.from.slice(0, 7) !== s.month) b.push('La data di inizio deve cadere nel mese del tabulato.');
    if (!sheetDur(s)) b.push('Scegli la durata delle sedute (predefinita: poi puoi cambiarla per ogni paziente).');
    if (!s.category) b.push('Scegli il percorso.');
    return b;
  }

  /* ---------------- vista ---------------- */
  function view() {
    const S = st();
    const missing = (A.data.missing || []).includes('import_batches');
    let h = '<div class="row between"><h2>Importa tabulato</h2></div>';
    if (missing) return h + '<div class="panel form-error">Il database non è ancora aggiornato per l’importazione: esegui <code>supabase/aggiornamento-database.sql</code> (SQL Editor → incolla → Run) e ricarica la pagina.</div>';
    if (!FA.canEdit()) return h + '<div class="panel">Profilo di sola consultazione: non puoi importare.</div>' + historyPanel();
    h += '<div class="panel imp-steps"><strong>1. Carica</strong> le foto e la trascrizione → <strong>2.</strong> scegli fisioterapista e periodo → <strong>3.</strong> controlla l’anteprima accanto alla foto e correggi → <strong>4.</strong> conferma. Ogni importazione si può annullare.</div>';
    h += '<div class="panel"><h3>1. Foto e trascrizione</h3>' +
      '<p class="small muted">Le foto restano su questo computer: <strong>non vengono inviate</strong> a nessun servizio. La trascrizione (file <code>.json</code>, anche più file insieme o un intero <code>.zip</code>) la prepara Claude dalle foto che gli mandi, oppure compili il foglio a mano guardando la foto.</p>' +
      '<div class="row"><label class="btn primary">Scegli foto e trascrizione…<input type="file" multiple accept="image/*,.json,.txt,.zip,application/json,application/zip" data-imp-files hidden></label>' +
      '<button class="btn" data-act="imp-manual">+ Foglio da compilare a mano</button></div>' +
      '<details style="margin-top:8px"' + (S.paste ? ' open' : '') + '><summary class="small">Oppure incolla il testo della trascrizione</summary>' +
      '<textarea rows="4" data-bind="imp.paste" placeholder="{ &quot;formato&quot;: &quot;fisioagenda-tabulato-1&quot;, … }" style="width:100%;margin-top:6px">' + esc(S.paste) + '</textarea>' +
      '<button class="btn small" data-act="imp-paste">Leggi la trascrizione</button></details>' +
      (S.msg ? '<div class="form-warn">' + esc(S.msg) + '</div>' : '') + '</div>';
    if (S.sheets.length) {
      h += '<div class="imp-tabs">' + S.sheets.map((s, i) => '<span class="imp-tab' + (i === S.cur ? ' on' : '') + '"><button class="btn small ' + (i === S.cur ? 'primary' : '') + '" data-act="imp-tab" data-i="' + i + '">' +
        esc(s.label) + (s.photo ? ' 📷' : '') + (s.result ? ' ✓' : '') + '</button><button class="btn link small" data-act="imp-close" data-i="' + i + '" aria-label="Chiudi il foglio">×</button></span>').join('') + '</div>';
      h += sheetView(S.cur);
    }
    return h + historyPanel();
  }
  function sheetView(i) {
    const S = st(), s = S.sheets[i];
    if (s.result) return resultPanel(s);
    const ths = FA.activeTherapists().filter(t => FA.canEditTh(t.id));
    const cats = s.th ? FA.categories().filter(c => E.skillLevel(A.ctx, s.th, c.id)) : [];
    const warn = [];
    const same = S.sheets.filter(x => x !== s && x.th && x.th === s.th && x.month === s.month && !x.result);
    if (same.length) warn.push('Hai caricato due fogli di ' + FA.thName(s.th) + ' per lo stesso mese (foto sovrapposte?): le sedute uguali vengono importate una volta sola.');
    const batches = (A.data.import_batches || []).filter(b => !b.undone_at);
    if (s.photo && s.photo.hash) {
      const b = batches.find(x => x.photo_hash === s.photo.hash);
      if (b) warn.push('Questa foto è già stata importata (importazione n. ' + b.number + ' del ' + new Date(b.created_at).toLocaleDateString('it-IT') + '): le sedute già presenti vengono saltate, nessun doppione.');
    }
    if (s.th && s.month) batches.filter(x => x.therapist_id === s.th && String(x.month).slice(0, 7) === s.month && (!s.photo || x.photo_hash !== s.photo.hash))
      .forEach(b => warn.push('Esiste già l’importazione n. ' + b.number + ' di questo tabulato: le sedute già presenti vengono saltate.'));
    const dur = s.durSel;
    let h = '<div class="panel"><h3>2. Fisioterapista e periodo</h3><div class="grid3">' +
      '<div class="field"><label>Fisioterapista del tabulato' + (s.thName ? ' <span class="muted small">(sul foglio: «' + esc(s.thName) + '»)</span>' : '') + '</label><select data-bind="' + P(i, 'th') + '" data-on="imp-th"' + (s.th ? '' : ' class="need"') + '><option value="">— scegli —</option>' +
        ths.map(t => FA.option(t.id, t.name, s.th)).join('') + '</select></div>' +
      '<div class="field"><label>Mese e anno</label><input type="month" data-bind="' + P(i, 'month') + '" data-on="imp-month" value="' + esc(s.month) + '"' + (s.month ? '' : ' class="need"') + '></div>' +
      '<div class="field"><label>Importa dal</label><input type="date" data-bind="' + P(i, 'from') + '" data-rerender value="' + esc(s.from) + '"' + (s.month ? ' min="' + s.month + '-01" max="' + s.month + '-' + H.daysInMonth(s.month) + '"' : '') + '>' +
        '<div class="help">Le caselle precedenti non diventano appuntamenti: servono solo a sapere a che seduta è il paziente.</div></div>' +
      '<div class="field"><label>Durata delle sedute (predefinita)</label>' + FA.seg(P(i, 'durSel'), [['30', '30′'], ['45', '45′'], ['60', '1 ora'], ['altro', 'Altro']], dur) +
        (dur === 'altro' ? ' <input type="number" min="15" max="120" step="5" style="max-width:100px;display:inline-block" data-bind="' + P(i, 'durOther') + '" data-rerender value="' + esc(s.durOther) + '" placeholder="min">' : '') +
        (!dur ? '<div class="help need-txt">Da confermare' + (s.durationHint ? ': suggerita ' + s.durationHint + '′' + (s.durationNote ? ' (' + esc(s.durationNote) + ')' : '') : '') + '.</div>' : '') + '</div>' +
      '<div class="field"><label>Percorso</label><select data-bind="' + P(i, 'category') + '" data-rerender>' + (cats.length ? '' : '<option value="">— scegli prima il fisioterapista —</option>') + cats.map(c => FA.option(c.id, c.name, s.category)).join('') + '</select></div>' +
      '<div class="field"><label>Sedute per ciclo</label><select data-bind="' + P(i, 'planned') + '" data-num data-rerender>' + E.SESSION_PRESETS.map(n => FA.option(n, n, s.planned)).join('') + '</select>' +
        '<div class="help">Il numero sul tabulato è a ritroso: seduta n. = ' + (Number(s.planned) + 1) + ' − numero.</div></div>' +
      '</div>' + warn.map(w => '<div class="form-warn">' + esc(w) + '</div>').join('') + '</div>';
    const ans = analyzeSheet(s);
    h += '<div class="imp-split">' + photoPane(s, i) + '<div class="imp-data"><div class="panel"><div class="row between"><h3 style="margin:0">3. Anteprima e correzioni</h3><button class="btn small" data-act="imp-add-row">+ Riga</button></div>' +
      '<p class="small muted" style="margin:6px 0 0">Scrivi nelle caselle come sul tabulato: numero (a ritroso), <strong>R</strong> recupero, <strong>V</strong> visita fisiatrica (es. <code>1V</code>). In giallo le letture incerte: correggile o confermale. Le sedute già passate restano <em>programmate</em>: il tabulato non dimostra la presenza.</p></div>' +
      s.rows.map((r, k) => rowCard(s, i, r, k, ans[k])).join('') +
      subsPanel(s, i) + extraPanel(s, i) + notesPanel(s) + absencePanel(s, i) + confirmPanel(s, i, ans) + '</div></div>';
    return h;
  }
  function photoPane(s, i) {
    if (!s.photo) return '<div class="imp-photo panel"><p class="muted small">Nessuna foto per questo foglio.</p><label class="btn small">Aggiungi la foto…<input type="file" accept="image/*" data-imp-photo hidden></label></div>';
    const m = markStyle(s);
    const band = m ? 'display:block;top:' + (m.y - m.h / 2) + '%;height:' + m.h + '%' : 'display:none';
    const mk = m && !m.band ? 'display:block;left:' + (m.x - m.w / 2) + '%;top:' + (m.y - m.h / 2) + '%;width:' + m.w + '%;height:' + m.h + '%' : 'display:none';
    return '<div class="imp-photo panel"><div class="row between"><span class="small muted">' + esc(s.photo.name) + '</span><span class="row">' +
      '<button class="btn small" data-act="imp-rot" title="Ruota di 90°">↻ Ruota</button><button class="btn small" data-act="imp-zoom">' + (s.zoom ? 'Adatta' : 'Ingrandisci') + '</button></span></div>' +
      '<div class="imp-ph-scroll' + (s.zoom ? ' zoom' : '') + '"><div class="imp-ph-wrap"><img src="' + esc(s.photo.view || s.photo.url) + '" alt="Foto del tabulato">' +
      '<div class="imp-band" style="' + band + '"></div><div class="imp-mark" style="' + mk + '"></div></div></div>' +
      '<p class="small muted" style="margin:6px 0 0">Clicca una casella a destra: il punto corrispondente si evidenzia sulla foto.</p></div>';
  }
  function durSelect(s, i, r, k, res) {
    if (res.cycle) return '<span class="small muted" title="Durata del ciclo in corso">' + res.cycle.duration + '′</span>';
    const cur = r.dur ? String(r.dur) : '';
    const opts = [['', 'durata del foglio' + (sheetDur(s) ? ' (' + sheetDur(s) + '′)' : '')], ['30', '30′'], ['45', '45′'], ['60', '1 ora']];
    if (cur && !opts.some(o => o[0] === cur)) opts.push([cur, cur + '′']);
    return '<select class="imp-dur" data-bind="' + P(i, 'rows.' + k + '.dur') + '" data-rerender aria-label="Durata della seduta">' + opts.map(o => FA.option(o[0], o[1], cur)).join('') + '</select>';
  }
  function choiceSelect(s, i, r, k, res) {
    if (!res.cands.length) return '<span class="chip ok">nuovo paziente</span>';
    const opts = ['<option value="">— è lo stesso paziente? —</option>'];
    res.cands.forEach(p => {
      const cyc = (A.data.cycles || []).filter(c => c.patient_id === p.id && c.status === 'attivo' && c.therapist_id === s.th);
      cyc.forEach(c => opts.push(FA.option('c:' + c.id, p.name + ': continua il ciclo in corso (' + FA.catName(c.category_id) + ')', r.choice || (res.target === 'ciclo' ? 'c:' + c.id : ''))));
      opts.push(FA.option('p:' + p.id, p.name + ': stesso paziente, nuovo ciclo', r.choice));
    });
    opts.push(FA.option('omonimo', 'Omonimo: nuovo paziente', r.choice));
    return '<select class="' + (res.need ? 'need' : '') + '" data-bind="' + P(i, 'rows.' + k + '.choice') + '" data-rerender>' + opts.join('') + '</select>';
  }
  function rowCard(s, i, r, k, a) {
    const nd = s.month ? H.daysInMonth(s.month) : 31;
    const imp = new Map(a.cells.map(x => [x.day, x]));
    const dup = new Set(a.dups.map(x => x.day));
    const parsed = new Map(a.an.cells.map(c => [c.d, c]));
    const wds = r.weekdays.length ? r.weekdays : a.an.weekdays;
    const blocked = r.include && a.block.length;
    let head = '', cells = '';
    for (let d = 1; d <= nd; d++) {
      const day = s.month ? H.dayOf(s.month, d) : null;
      const wd = day ? E.weekday(day) : 0;
      head += '<th class="' + (wd >= 6 ? 'we' : '') + '">' + d + '<br><span>' + (day ? E.WD_SHORT[wd].slice(0, 2) : '') + '</span></th>';
      const c = parsed.get(d), x = day && imp.get(day);
      let cls = wd >= 6 ? 'we' : '';
      let tip = '';
      if (c) {
        if (c.bad) { cls += ' bad'; tip = c.bad; }
        else if (c.doubtMsg) { cls += ' doubt'; tip = 'Lettura incerta: ' + c.doubtMsg; }
        else if (day < s.from) { cls += ' before'; tip = 'Prima della data di inizio: non importata'; }
        else if (dup.has(day)) { cls += ' dup'; tip = 'Già presente nel calendario: saltata'; }
        else if (x && x.chk) { cls += r.force[day] && x.forceable ? ' forced' : ' conf'; tip = x.chk.msg; }
        else if (c.num != null || c.R) { cls += ' ok'; tip = c.R ? 'Recupero' : 'Seduta n. ' + c.p + ' di ' + s.planned; }
        else if (c.V) { cls += ' vis'; tip = 'Visita fisiatrica (non è una seduta)'; }
      }
      if (c && (r.times || {})[d]) tip = (tip ? tip + ' · ' : '') + 'Alle ' + r.times[d];
      if (c && (r.subs || {})[d]) { const m = s.subsMap[H.normName(r.subs[d])]; cls += ' sub'; tip = (tip ? tip + ' · ' : '') + 'Sigla «' + r.subs[d] + '»: ' + (m ? 'seduta fatta da ' + FA.thName(m) : 'collega non indicato, resta al titolare'); }
      if (day && s.month && A.ctx.closures.has(day)) tip = (tip ? tip + ' · ' : '') + 'Chiuso: ' + A.ctx.closures.get(day);
      const val = r.cells[d] == null ? '' : r.cells[d];
      cells += '<td class="' + cls.trim() + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><input data-imp-cell data-r="' + k + '" data-d="' + d + '" data-bind="' + P(i, 'rows.' + k + '.cells.' + d) + '" data-on="imp-cell" value="' + esc(val) + '" maxlength="4" aria-label="Giorno ' + d + '">' +
        (c && c.doubtMsg && !c.bad ? '<button class="imp-okc" data-act="imp-cell-ok" data-r="' + k + '" data-d="' + d + '" title="Confermo la lettura">✓</button>' : '') + '</td>';
    }
    const gen = a.an.generated;
    const doubts = r.rowDoubts.map((d, j) => '<label class="inline-check small' + (d.ok ? '' : ' need-txt') + '"><input type="checkbox" data-act-change="imp-rd" data-r="' + k + '" data-k="' + j + '"' + (d.ok ? ' checked' : '') + '> Controllato: ' + esc(d.text) + '</label>').join('');
    const conflicts = a.conflicts.map(x => '<li>' + (x.forceable ? '<label class="inline-check"><input type="checkbox" data-act-change="imp-force" data-r="' + k + '" data-day="' + x.day + '"' + (r.force[x.day] ? ' checked' : '') + '> ' : '') +
      '✗ ' + esc(E.fmtItDay(x.day) + ' ' + x.start + ': ' + x.chk.msg) + (x.forceable ? ' — <strong>importa comunque</strong> (finirà in “Da sistemare”)</label>' : ' — <strong>non importabile</strong>: correggi orario o casella') + '</li>').join('');
    const nImp = a.cells.length, nNum = a.cells.filter(x => x.c.num != null && !x.next).length;
    const nNext = a.cells.filter(x => x.next).length;
    const pr = a.res.target === 'ciclo' ? null : a.an.prior;
    const summary = !r.include ? 'Riga esclusa.' : a.nothing && a.dups.length ? 'Tutte le ' + a.dups.length + ' sedute sono già presenti nel calendario: niente da importare.' :
      a.nothing ? 'Niente da importare dal ' + E.fmtIt(s.from) + '.' :
      nImp + ' sedut' + (nImp === 1 ? 'a' : 'e') + ' da importare' + (nNum && pr != null ? ' (dalla ' + (pr + 1) + 'ª' + (gen.length ? ', comprese ' + gen.length + ' aggiunte' : '') + ')' : '') +
      (nNext ? ', di cui ' + nNext + ' del nuovo ciclo dal ' + E.fmtItDay(a.an.next.from) : '') + (a.dups.length ? ', ' + a.dups.length + ' già presenti' : '') + (a.an.before.length ? ', ' + a.an.before.length + ' prima del ' + E.fmtIt(s.from) + (pr != null && a.res.target !== 'ciclo' ? ' (contate come precedenti: ' + pr + ')' : '') : '') +
      (a.visits.length ? ', visite fisiatriche: ' + a.visits.map(E.fmtItDay).join(', ') : '') + '.';
    return '<div class="panel imp-row' + (!r.include ? ' off' : blocked ? ' blocked' : ' ready') + '" data-ref="' + esc(r.ref) + '">' +
      '<div class="row imp-row-head"><label class="inline-check"><input type="checkbox" data-bind="' + P(i, 'rows.' + k + '.include') + '" data-rerender' + (r.include ? ' checked' : '') + '> Importa</label>' +
      '<span class="chip grey">' + esc(r.ref) + '</span>' +
      '<input type="text" class="imp-name" data-bind="' + P(i, 'rows.' + k + '.name') + '" data-rerender value="' + esc(r.name) + '" placeholder="Paziente o codice" aria-label="Paziente">' +
      FA.timeField(P(i, 'rows.' + k + '.time'), r.time, ' data-rerender aria-label="Orario"') +
      durSelect(s, i, r, k, a.res) +
      '<input type="text" class="imp-tipo" data-bind="' + P(i, 'rows.' + k + '.tipo') + '" data-rerender value="' + esc(r.tipo) + '" placeholder="Tipo (GC, RM…)" aria-label="Tipo di trattamento">' +
      '<span class="imp-wds">' + [1, 2, 3, 4, 5, 6].map(w => '<button class="btn small ' + (wds.includes(w) ? 'primary' : '') + '" data-act="imp-wd" data-r="' + k + '" data-wd="' + w + '">' + E.WD_SHORT[w] + '</button>').join('') + '</span>' +
      (r.freq ? '<span class="small muted">sul foglio: «' + esc(r.freq) + '»</span>' : '') + '<label class="inline-check small" title="Segno // dopo il nome: fine ciclo"><input type="checkbox" data-bind="' + P(i, 'rows.' + k + '.closed') + '" data-rerender' + (r.closed ? ' checked' : '') + '> // fine ciclo</label>' +
      '<button class="btn link small" data-act="imp-del-row" data-r="' + k + '" title="Togli la riga">togli</button></div>' +
      (r.include ? '<div class="row" style="margin-top:6px">' + choiceSelect(s, i, r, k, a.res) + (r.note ? '<span class="small muted">Nota: ' + esc(r.note) + '</span>' : '') + '</div>' : '') +
      '<div class="imp-grid-wrap"><table class="imp-grid"><thead><tr>' + head + '</tr></thead><tbody><tr>' + cells + '</tr></tbody></table></div>' +
      (r.include ? '<p class="small" style="margin:6px 0 0"><strong>' + esc(summary) + '</strong></p>' +
        (a.an.missingAfter > 0 && a.res.target !== 'ciclo' ? '<label class="inline-check small"><input type="checkbox" data-bind="' + P(i, 'rows.' + k + '.generate') + '" data-rerender' + (r.generate ? ' checked' : '') + '> Programma anche le ' + a.an.missingAfter + ' sedute successive fino all’ultima, negli stessi giorni e orario (non sono sul tabulato)</label>' : '') +
        doubts + (a.issues.length ? '<ul class="small imp-issues">' + a.issues.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') +
        (conflicts ? '<ul class="small imp-conf">' + conflicts + '</ul>' : '') +
        (a.block.length ? '<div class="form-error small">Da sistemare prima di importare: ' + esc(a.block.join(' ')) + '</div>' : '') : '') +
      '</div>';
  }
  /** sigle dei colleghi scritte sotto i numeri: chi ha fatto la seduta al posto del titolare */
  function subsPanel(s, i) {
    const sig = new Map();
    s.rows.forEach(r => Object.keys(r.subs || {}).forEach(d => { const k = H.normName(r.subs[d]); if (!k) return; if (!sig.has(k)) sig.set(k, { label: r.subs[d], n: 0 }); sig.get(k).n++; }));
    if (!sig.size) return '';
    const ths = FA.activeTherapists().filter(t => t.id !== s.th);
    return '<div class="panel"><h3>Sigle dei colleghi sotto i numeri</h3><p class="small muted">Chi ha fatto la seduta al posto di ' + esc(s.th ? FA.thName(s.th) : 'chi ha il tabulato') +
      '. Scegli il collega: la seduta va nel suo calendario come sostituzione (il ciclo resta del titolare). Se non lo indichi, la seduta resta al titolare.</p><ul class="list">' +
      [...sig.entries()].map(([k, v]) => '<li class="todo-item"><div><strong>' + esc(v.label) + '</strong> <span class="small muted">(' + v.n + ' sedute)</span></div><div>' +
        '<select data-bind="' + P(i, 'subsMap.' + k) + '" data-rerender><option value="">Resta al titolare</option>' + ths.map(t => FA.option(t.id, t.name, s.subsMap[k] || '')).join('') + '</select></div></li>').join('') + '</ul></div>';
  }
  function extraPanel(s, i) {
    if (!s.extra.length) return '';
    const active = (A.data.cycles || []).filter(c => c.status === 'attivo');
    return '<div class="panel"><h3>Pazienti di colleghi trattati su questo foglio</h3><p class="small muted">Nomi scritti in un giorno solo (sostituzioni): la seduta appartiene al ciclo del paziente con il suo fisioterapista. Importala solo se il paziente è già in archivio; altrimenti importa prima il tabulato del collega.</p>' +
      '<ul class="list">' + s.extra.map((x, j) => {
        const n = H.normName(x.name);
        const m = active.filter(c => { const pn = H.normName(FA.patName(c.patient_id)); return n && (pn === n || pn.startsWith(n + ' ') || n.split(' ').some(w => w.length > 2 && pn.split(' ').includes(w))); });
        return '<li class="todo-item"><div>' + esc((x.d ? x.d + '/' + (s.month || '').slice(5) + ' ' : '') + (x.time || '') + ' · «' + x.name + '»' + (x.value ? ' · casella «' + x.value + '»' : '') + (x.note ? ' · ' + x.note : '')) + '</div><div>' +
          '<select data-bind="' + P(i, 'extra.' + j + '.cycleId') + '" data-rerender><option value="">Non importare</option>' + m.map(c => FA.option(c.id, FA.patName(c.patient_id) + ' (' + FA.thName(c.therapist_id) + ')', x.cycleId)).join('') + '</select></div></li>';
      }).join('') + '</ul></div>';
  }
  /** giorni consecutivi (ignorando sabati, domeniche e chiusure) → intervalli da registrare */
  function absRanges(s, a) {
    const dates = a.days.filter(d => d >= 1 && d <= H.daysInMonth(s.month)).map(d => H.dayOf(s.month, d)).sort();
    const todo = dates.filter(d => !E.absenceOnDay(A.ctx, s.th, d).some(x => !x.start_time));
    const out = [];
    todo.forEach(d => {
      const l = out[out.length - 1];
      let k = l ? E.addDays(l.end, 1) : null;
      while (k && k < d && (E.weekday(k) >= 6 || A.ctx.closures.has(k))) k = E.addDays(k, 1);
      if (l && k === d) l.end = d; else out.push({ start: d, end: d });
    });
    return { dates, ranges: out };
  }
  function absencePanel(s, i) {
    if (!s.absences.length) return '';
    const KIND = E.ABSENCE_KIND;
    return '<div class="panel"><h3>Assenze di ' + esc(s.th ? FA.thName(s.th) : 'chi ha il tabulato') + ' segnate sul foglio</h3>' +
      '<p class="small muted">Lettere sopra i giorni (F = ferie…). Non vengono registrate da sole: registrale con il pulsante, meglio <strong>dopo</strong> aver importato le sedute. Le sedute già prenotate in quei giorni finiscono in “Da sistemare”, dove organizzi i sostituti.</p><ul class="list">' +
      s.absences.map((a, k) => {
        const r = s.th && s.month ? absRanges(s, a) : { dates: [], ranges: [] };
        const busy = r.dates.filter(d => (A.ctx.byThDay.get(s.th + '|' + d) || []).length).length;
        return '<li class="todo-item"><div><strong>' + esc(KIND[a.kind] || a.kind) + '</strong>: ' + (r.dates.length ? r.dates.map(E.fmtItDay).join(', ') : 'giorni ' + a.days.join(', ')) +
          (a.note ? ' <span class="small muted">· ' + esc(a.note) + '</span>' : '') + (busy ? ' <span class="chip warn">' + busy + ' giorni con sedute già in calendario</span>' : '') + '</div><div>' +
          (a.saved || (r.dates.length && !r.ranges.length) ? '<span class="chip ok">registrata</span>' :
            '<button class="btn small" data-act="imp-abs" data-i="' + i + '" data-k="' + k + '"' + (s.th && s.month && FA.canEditTh(s.th) ? FA.saveDisabled() : ' disabled') + '>Registra</button>') + '</div></li>';
      }).join('') + '</ul></div>';
  }
  FA.actions['imp-abs'] = async el => {
    const s = st().sheets[Number(el.getAttribute('data-i'))], a = s.absences[Number(el.getAttribute('data-k'))];
    const { ranges } = absRanges(s, a);
    if (!ranges.length) { a.saved = true; FA.render(); return; }
    if (!confirm('Registrare ' + (E.ABSENCE_KIND[a.kind] || a.kind).toLowerCase() + ' di ' + FA.thName(s.th) + ': ' + ranges.map(r => r.start === r.end ? E.fmtIt(r.start) : 'dal ' + E.fmtIt(r.start) + ' al ' + E.fmtIt(r.end)).join(', ') + '?')) return;
    try {
      await FA.save('Assenza registrata', async () => {
        for (const r of ranges) await FA.rpc('save_absence', { p: { therapist_id: s.th, kind: a.kind, start_date: r.start, end_date: r.end, note: 'Dal tabulato' + (a.note ? ': ' + a.note : '') } });
      });
      a.saved = true; FA.render();
    } catch (e) { s.error = e.message; FA.render(); }
  };
  function notesPanel(s) {
    if (!s.notes.length) return '';
    return '<div class="panel"><h3>Altre annotazioni sul foglio</h3><ul class="small">' + s.notes.map(n => '<li>' + esc((n.days.length ? 'giorno ' + n.days.join(', ') + ': ' : '') + n.text) + '</li>').join('') + '</ul>' +
      '<p class="small muted">Non vengono importate. Un corso o un’assenza del collega si inseriscono dal suo calendario (✎ Orario o Ferie / permesso).</p></div>';
  }
  function extraPayload(s) {
    return s.extra.filter(x => x.cycleId && x.d && s.month && FA.normTime(x.time)).map(x => ({ cycle_id: x.cycleId, day: H.dayOf(s.month, x.d), start: FA.normTime(x.time), number: (String(x.value).match(/\d+/) || [null])[0] }));
  }
  const cellOut = r => x => ({ day: x.day, number: x.c.num, mark: x.c.R ? 'R' : null, force: !!(x.chk && r.force[x.day]), start: x.start, therapist_id: x.th && x.th !== x.thMain ? x.th : null });
  function payload(s, ans) {
    const rows = [];
    s.rows.forEach((r, k) => {
      const a = ans[k];
      if (!r.include || a.nothing || a.block.length) return;
      const res = a.res;
      rows.push({
        ref: r.ref, target: res.target, patient_name: r.name.trim(), patient_id: res.patientId || null, cycle_id: res.cycleId || null, homonym: !!res.homonym,
        category_id: s.category, treatment: r.tipo.trim().toUpperCase(), planned: Number(s.planned), prior: a.an.prior == null ? 0 : a.an.prior, duration: rowDur(s, r),
        weekdays: r.weekdays.length ? r.weekdays : a.an.weekdays, start: a.time,
        cells: a.cells.filter(x => !x.next).map(cellOut(r)),
        next: a.an.next ? { planned: Number(s.planned), prior: a.an.next.prior, cells: a.cells.filter(x => x.next).map(cellOut(r)) } : null,
        visits: a.visits, concluded: !!r.closed
      });
    });
    return rows;
  }
  function confirmPanel(s, i, ans) {
    const sb = sheetBlock(s);
    const inc = s.rows.map((r, k) => ({ r, a: ans[k] })).filter(x => x.r.include);
    const blocked = inc.filter(x => x.a.block.length);
    const rows = sb.length ? [] : payload(s, ans);
    const extra = sb.length ? [] : extraPayload(s);
    const nApp = rows.reduce((n, r) => n + r.cells.length + (r.next ? r.next.cells.length : 0), 0) + extra.length;
    const nNew = rows.filter(r => r.target === 'nuovo').length;
    const nVis = rows.reduce((n, r) => n + r.visits.length, 0);
    const forced = rows.reduce((n, r) => n + r.cells.concat(r.next ? r.next.cells : []).filter(c => c.force).length, 0);
    const ok = !sb.length && !blocked.length && (nApp > 0 || nVis > 0);
    return '<div class="panel imp-confirm"><h3>4. Conferma</h3>' +
      (sb.length ? '<div class="form-error">' + sb.map(esc).join(' ') + '</div>' : '') +
      (blocked.length ? '<div class="form-warn">Righe da sistemare (o da escludere): ' + blocked.map(x => '<a href="#" data-act="imp-goto" data-ref="' + esc(x.r.ref) + '">' + esc(x.r.ref + ' ' + (x.r.name || '')) + '</a>').join(', ') + '.</div>' : '') +
      (!sb.length ? '<p>Verranno importati: <strong>' + rows.length + ' pazienti</strong> (' + nNew + ' nuovi), <strong>' + nApp + ' sedute</strong>' + (nVis ? ', ' + nVis + ' visite fisiatriche' : '') +
        (forced ? ', di cui <strong>' + forced + ' fuori turno</strong> da sistemare' : '') + ' nel calendario di <strong>' + esc(FA.thName(s.th)) + '</strong> dal ' + E.fmtIt(s.from) + '.</p>' : '') +
      FA.errBox(s.error) +
      '<button class="btn primary" data-act="imp-go" data-i="' + i + '"' + (ok ? FA.saveDisabled() : ' disabled') + '>' + (A.saving ? 'Importazione…' : 'Importa nel calendario') + '</button></div>';
  }
  FA.actions['imp-goto'] = el => { const e = document.querySelector('.imp-row[data-ref="' + CSS.escape(el.getAttribute('data-ref')) + '"]'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  FA.actions['imp-go'] = async el => {
    const s = st().sheets[Number(el.getAttribute('data-i'))];
    const ans = analyzeSheet(s);
    const rows = payload(s, ans), extra = extraPayload(s);
    const p = { therapist_id: s.th, month: s.month + '-01', from_date: s.from, photo_hash: s.photo ? s.photo.hash : null, label: s.label, rows, extra };
    p.source_hash = await sha256(new TextEncoder().encode(JSON.stringify({ rows, extra, th: s.th, month: s.month }))) || '';
    s.error = null;
    try {
      s.result = await FA.save('Tabulato importato', () => FA.rpc('import_sheet', { p }));
      FA.render(); window.scrollTo(0, 0);
    } catch (e) { s.error = e.message; FA.render(); }
  };
  function resultPanel(s) {
    const r = s.result;
    const b = (A.data.import_batches || []).find(x => x.id === r.batch_id);
    return '<div class="panel form-note"><h3>✓ Importazione n. ' + r.number + ' completata</h3><p>' + r.rows + ' pazienti (' + r.patients + ' nuovi), ' + r.appointments + ' sedute' +
      (r.duplicates ? ', ' + r.duplicates + ' già presenti saltate' : '') + (r.visits ? ', ' + r.visits + ' visite fisiatriche' : '') + (r.forced ? ', ' + r.forced + ' fuori turno: le trovi in “Da sistemare”' : '') + '.</p>' +
      '<p class="small">Le sedute già passate restano <strong>programmate</strong>: registra l’esito (effettuata, assenza) dal calendario o da “Da sistemare”.</p>' +
      '<div class="row"><button class="btn primary" data-act="go" data-view="calendario" data-param="' + s.th + '/' + (s.from >= A.today ? s.from : A.today) + '/settimana">Apri il calendario di ' + esc(FA.thName(s.th)) + '</button>' +
      (b && !b.undone_at ? '<button class="btn" data-act="imp-undo" data-id="' + r.batch_id + '">Annulla questa importazione</button>' : (b && b.undone_at ? '<span class="chip grey">annullata</span>' : '')) + '</div></div>' +
      absencePanel(s, st().sheets.indexOf(s));
  }
  function historyPanel() {
    const list = (A.data.import_batches || []).slice().sort((a, b) => b.number - a.number).slice(0, 20);
    if (!list.length) return '';
    return '<div class="panel"><h3>Importazioni recenti</h3><ul class="list">' + list.map(b => {
      const sm = b.summary || {};
      return '<li class="todo-item"><div><strong>n. ' + b.number + '</strong> · ' + esc(FA.thName(b.therapist_id)) + ' · ' + esc(String(b.month).slice(5, 7) + '/' + String(b.month).slice(0, 4)) + ' dal ' + E.fmtIt(b.from_date) +
        ' · ' + (sm.appointments || 0) + ' sedute, ' + (sm.rows || 0) + ' pazienti' + (sm.duplicates ? ', ' + sm.duplicates + ' doppioni saltati' : '') +
        ' <span class="muted small">(' + new Date(b.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) + ')</span>' +
        (b.undone_at ? ' <span class="chip grey">annullata</span>' : '') + '</div><div>' +
        (!b.undone_at && FA.canEditTh(b.therapist_id) ? '<button class="btn small" data-act="imp-undo" data-id="' + b.id + '">Annulla</button>' : '') + '</div></li>';
    }).join('') + '</ul></div>';
  }
  FA.actions['imp-undo'] = async el => {
    const id = el.getAttribute('data-id');
    const b = (A.data.import_batches || []).find(x => x.id === id);
    if (!b || !confirm('Annullare l’importazione n. ' + b.number + ' (' + FA.thName(b.therapist_id) + ')?\nLe sedute ancora programmate, i cicli e i pazienti creati da questa importazione vengono eliminati. Le sedute con un esito già registrato restano.')) return;
    try {
      const r = await FA.save('Importazione annullata', () => FA.rpc('undo_import', { p_batch: id }));
      FA.toast(r.appointments + ' sedute eliminate' + (r.kept ? '; ' + r.kept + ' con esito già registrato mantenute' : '') + '.', r.kept ? 'warn' : 'ok');
    } catch (e) { /* già segnalato */ }
  };

  // input file e caselle di controllo con azione al cambio
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.hasAttribute && t.hasAttribute('data-imp-files')) FA.actions['imp-files'](t);
    else if (t.hasAttribute && t.hasAttribute('data-imp-photo')) FA.actions['imp-photo'](t);
  });

  FA.views.importa = { render: view };
  FA.importSheetLogic = { analyze, analyzeSheet, payload };
})();
