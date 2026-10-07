/*
 * FisioAgenda pilota — configurazione del servizio (solo coordinatore per le modifiche),
 * utenti, backup/ripristino e storico delle modifiche.
 */
(function () {
  'use strict';
  const FA = window.FA, E = FA.E, A = FA.state, esc = FA.esc;
  const KINDS = [['amb', 'Ambulatorio (pazienti)'], ['reparto', 'Reparto'], ['pausa', 'Pausa'], ['documentazione', 'Cartelle / adempimenti burocratici'],
    ['segreteria', 'Segreteria'], ['corso', 'Corso obbligatorio'], ['permesso_ore', 'Permesso a ore'], ['recupero_ore', 'Recupero ore'], ['briefing', 'Briefing'],
    ['preparazione', 'Preparazione'], ['altro', 'Altra attività']];
  const adminOnly = () => FA.isAdmin() ? '' : ' disabled title="Solo il coordinatore può modificare questa parte"';
  const adminSave = () => FA.isAdmin() ? FA.saveDisabled() : ' disabled';
  // fisioterapisti, orari e assenze: coordinatore, programmatore, segreteria e chi ne fa le veci
  const officeOnly = () => FA.isOffice() ? '' : ' disabled title="Riservato a segreteria e coordinatore"';
  const officeSave = () => FA.isOffice() ? FA.saveDisabled() : ' disabled';

  function blocksSummary(blocks) {
    if (!blocks || !blocks.length) return '<div class="muted small">Non in servizio</div>';
    return blocks.slice().sort((a, b) => a.start < b.start ? -1 : 1).map(b => '<div class="blk ' + (b.kind === 'amb' ? 'amb' : 'other') + '">' + esc(E.hhmm(b.start)) + '–' + esc(E.hhmm(b.end)) + ' ' + esc(E.BLOCK[b.kind]) + (b.max ? ' · max ' + b.max + ' paz.' : '') + '</div>').join('');
  }
  function weekGrid(week) {
    return '<div class="week-grid">' + [1, 2, 3, 4, 5, 6, 7].map(d => '<div class="week-day"><h4>' + E.WD_LONG[d] + '</h4>' + blocksSummary(week[String(d)] || []) + '</div>').join('') + '</div>';
  }
  function blocksEditor(path, blocks) {
    return (blocks || []).map((b, i) => '<div class="blk-edit">' +
      '<select data-bind="' + path + '.' + i + '.kind" aria-label="Tipo">' + KINDS.map(([k, l]) => FA.option(k, l, b.kind)).join('') + '</select>' +
      '<input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="' + path + '.' + i + '.start" value="' + esc(E.hhmm(b.start)) + '" aria-label="Inizio">' +
      '<input type="text" inputmode="numeric" autocomplete="off" placeholder="hh:mm" data-time class="t-in" data-bind="' + path + '.' + i + '.end" value="' + esc(E.hhmm(b.end)) + '" aria-label="Fine">' +
      '<input type="number" min="1" placeholder="max" data-bind="' + path + '.' + i + '.max" value="' + esc(b.max == null ? '' : b.max) + '" aria-label="Massimo pazienti" title="Massimo pazienti nella fascia (facoltativo)">' +
      '<button class="btn small" data-act="blk-del" data-path="' + path + '" data-i="' + i + '" aria-label="Rimuovi fascia">✕</button></div>').join('') +
      '<button class="btn small" data-act="blk-add" data-path="' + path + '">+ fascia</button>';
  }
  const listAt = path => { let v = FA.get(path); if (!Array.isArray(v)) { v = v && typeof v === 'object' ? Object.values(v) : []; FA.set(path, v); } return v; };
  document.addEventListener('change', ev => { if (ev.target.closest('[data-bind^="de."]') && A.ui.de) { A.ui.de.conf = null; FA.renderModal(); } });
  FA.actions['blk-add'] = el => { const p = el.getAttribute('data-path'); const l = listAt(p); const last = l[l.length - 1]; l.push({ kind: 'amb', start: last ? last.end : '08:00', end: '', max: null }); if (A.ui.de) A.ui.de.conf = null; FA.renderModal(); };
  FA.actions['blk-del'] = el => { const p = el.getAttribute('data-path'); listAt(p).splice(Number(el.getAttribute('data-i')), 1); if (A.ui.de) A.ui.de.conf = null; FA.renderModal(); };
  const cleanBlocks = l => (Array.isArray(l) ? l : Object.values(l || {})).filter(b => b && b.start && b.end)
    .map(b => ({ kind: b.kind, start: E.hhmm(b.start), end: E.hhmm(b.end), max: b.max === '' || b.max == null ? null : Number(b.max) }))
    .sort((a, b) => a.start < b.start ? -1 : 1);
  function conflictsBox(conf) {
    if (!conf) return '';
    if (!conf.length) return '<div class="form-note">✓ Nessun appuntamento già prenotato diventa incompatibile.</div>';
    return '<div class="form-warn"><strong>' + conf.length + ' appuntamenti già prenotati diventano incompatibili.</strong> Non vengono spostati: dopo il salvataggio restano segnalati “da sistemare”.<ul class="small">' +
      conf.map(c => '<li>' + esc(E.fmtItDay(c.day) + ' ' + E.hhmm(c.start_time) + ' · ' + c.patient) + ' — ' + esc(c.message) + '</li>').join('') + '</ul></div>';
  }

  /* ---------------- fisioterapisti ---------------- */
  function therapistsTab() {
    const cats = FA.categories();
    return '<div class="row between"><p class="muted">' + FA.allTherapists().length + ' fisioterapisti. Competenze: ★ specifica (proposto per primo) oppure abilitato.</p>' +
      '<div class="row"><button class="btn primary small" data-act="th-bulk"' + officeOnly() + '>Inserimento rapido (più colleghi)</button>' +
      '<button class="btn small" data-act="sk-matrix"' + officeOnly() + '>Tabella competenze</button>' +
      '<button class="btn small" data-act="act-matrix"' + officeOnly() + '>Attività e turni</button>' +
      '<button class="btn small" data-act="th-edit" data-id=""' + officeOnly() + '>+ Nuovo fisioterapista</button></div></div>' +
      ambFixBox() +
      '<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Attività</th><th>Competenza specifica</th><th>Abilitato</th><th>Limite/giorno</th><th></th></tr></thead><tbody>' +
      FA.allTherapists().map(t => {
        const sk = A.ctx.skills.get(t.id) || new Map();
        const spec = cats.filter(c => sk.get(c.id) === 'specifica').map(c => c.name), ab = cats.filter(c => sk.get(c.id) === 'abilitato').map(c => c.name);
        return '<tr><td><strong>' + esc(t.name) + '</strong>' + (t.active ? '' : ' <span class="chip grey">non attivo</span>') + (t.note ? '<br><span class="small muted">' + esc(t.note) + '</span>' : '') + '</td>' +
          '<td>' + (t.activity === 'ambulatorio' ? 'Solo ambulatorio' : 'Ambulatorio e reparto') + '</td><td class="small">' + esc(spec.join(', ') || '—') + '</td><td class="small">' + esc(ab.join(', ') || '—') + '</td>' +
          '<td>' + (t.max_daily || '—') + '</td><td class="nowrap"><button class="btn small" data-act="th-edit" data-id="' + t.id + '">' + (FA.isAdmin() ? 'Modifica' : 'Dettagli') + '</button> ' +
          '<button class="btn small" data-act="cfg-shift-of" data-id="' + t.id + '">Turno</button> ' +
          '<button class="btn small" data-act="abs-new" data-th="' + t.id + '"' + FA.disabledIfReadOnly() + '>Ferie/permessi</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  FA.actions['th-edit'] = el => {
    const id = el.getAttribute('data-id');
    const t = id ? A.ctx.th.get(id) : null;
    const sk = {};
    FA.categories().forEach(c => { sk[c.id] = (t && E.skillLevel(A.ctx, t.id, c.id)) || ''; });
    A.ui.te = { id: t ? t.id : '', version: t ? t.version : null, name: t ? t.name : '', activity: t ? t.activity : 'ambulatorio_reparto', max_daily: t && t.max_daily ? t.max_daily : '', active: t ? t.active : true, note: t ? t.note : '', sort: t ? t.sort : 100, skills: sk };
    FA.openModal({ title: t ? 'Fisioterapista: ' + t.name : 'Nuovo fisioterapista', wide: true,
      body() {
        const f = A.ui.te;
        return '<div class="grid2"><div class="field"><label>Nome</label><input type="text" data-bind="te.name" value="' + esc(f.name) + '"' + officeOnly() + '></div>' +
          '<div class="field"><label>Attività</label>' + FA.seg('te.activity', [['ambulatorio', 'Solo ambulatorio'], ['ambulatorio_reparto', 'Ambulatorio e reparto']], f.activity) + '</div></div>' +
          '<div class="grid3"><div class="field"><label>Limite pazienti al giorno (facoltativo)</label><input type="number" min="1" max="30" data-bind="te.max_daily" value="' + esc(f.max_daily) + '"' + officeOnly() + '></div>' +
          '<div class="field"><label>Nota</label><input type="text" data-bind="te.note" value="' + esc(f.note) + '"' + officeOnly() + '></div>' +
          '<div class="field"><label>&nbsp;</label><label class="inline-check"><input type="checkbox" data-bind="te.active"' + (f.active ? ' checked' : '') + officeOnly() + '> Attivo</label></div></div>' +
          '<h4>Competenze e percorsi trattabili</h4><div class="table-wrap"><table><tbody>' + FA.categories().map(c => '<tr><td>' + esc(c.name) + '</td><td style="width:240px"><select data-bind="te.skills.' + c.id + '"' + officeOnly() + '>' +
            FA.option('', 'Non abilitato', f.skills[c.id]) + FA.option('abilitato', 'Abilitato', f.skills[c.id]) + FA.option('specifica', '★ Competenza specifica', f.skills[c.id]) + '</select></td></tr>').join('') + '</tbody></table></div>' +
          (f.id ? '' : '<p class="muted small">Dopo il salvataggio definisci il turno settimanale nella scheda “Orari”.</p>') + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Chiudi</button>' + (FA.isAdmin() ? '<button class="btn primary" data-act="th-save"' + officeSave() + '>Salva</button>' : '') });
  };
  FA.actions['th-save'] = async () => {
    const f = A.ui.te;
    if (!f.name.trim()) { f.error = 'Il nome è obbligatorio.'; FA.renderModal(); return; }
    const p = { name: f.name, activity: f.activity, max_daily: f.max_daily === '' || f.max_daily == null ? '' : String(f.max_daily), active: !!f.active, note: f.note, sort: f.sort,
      skills: Object.entries(f.skills).filter(([, l]) => l).map(([category_id, level]) => ({ category_id, level })) };
    if (f.id) { p.id = f.id; p.version = f.version; }
    try {
      const id = await FA.save('Scheda del fisioterapista', () => FA.rpc('admin_save_therapist', { p }));
      FA.closeModal();
      if (!f.id) { A.ui.cfgTab = 'turni'; A.ui.shTh = id; FA.render(); FA.toast('Ora definisci il turno del nuovo collega (puoi partire da quello di un altro)'); }
    }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /** Colleghi "solo ambulatorio" il cui turno in vigore (o futuro) contiene una fascia di reparto. */
  function ambWithReparto() {
    return FA.allTherapists().filter(t => t.active && t.activity === 'ambulatorio').filter(t => {
      const vs = (A.ctx.shifts.get(t.id) || []).filter(v => v.valid_from >= (E.shiftFor(A.ctx, t.id, A.today) || {}).valid_from || v.valid_from > A.today);
      return vs.some(v => Object.values(v.week || {}).some(day => (day || []).some(b => b.kind === 'reparto')));
    });
  }
  FA.ambWithReparto = ambWithReparto;
  function ambFixBox() {
    const bad = ambWithReparto();
    if (!bad.length) return '';
    return '<div class="form-warn"><strong>' + bad.length + ' colleghi “solo ambulatorio” hanno una fascia di reparto nel turno:</strong> ' + esc(bad.map(t => t.name).join(', ')) +
      '.<br><button class="btn small primary" data-act="amb-fix"' + officeSave() + '>Correggi i turni (scegli 7:00 o 8:00 per ognuno)</button> <button class="btn small" data-act="act-matrix"' + officeSave() + '>Attività e turni di tutti</button> <span class="small">I turni precedenti restano nello storico; prima del salvataggio vedi gli appuntamenti coinvolti.</span></div>';
  }
  const ambWeek = k => { const w = {}; [1, 2, 3, 4, 5, 6, 7].forEach(d => { w[d] = d <= 5 ? TEMPLATES[k].day.map(x => Object.assign({}, x)) : []; }); return w; };
  /** schema ambulatoriale più vicino all'ora di ingresso già inserita */
  const guessAmb = thId => {
    const v = E.shiftFor(A.ctx, thId, A.today) || (A.ctx.shifts.get(thId) || [])[0];
    const starts = v ? Object.values(v.week || {}).flat().map(x => E.hhmm(x.start)).filter(Boolean).sort() : [];
    return starts.length && starts[0] < '07:45' ? 'ambulatorio7' : 'ambulatorio';
  };
  FA.actions['amb-fix'] = () => {
    const sel = {};
    ambWithReparto().forEach(t => { sel[t.id] = guessAmb(t.id); });
    A.ui.af = { sel, conf: null, error: null };
    FA.openModal({ title: 'Turni dei colleghi “solo ambulatorio”', wide: true, sticky: true,
      body() {
        const f = A.ui.af;
        return '<p>Per ogni collega scegli lo schema ambulatoriale (in vigore da oggi). Gli orari personali si rifiniscono poi da “Nuovo turno con decorrenza”, per esempio fino alle 13:45.</p>' +
          '<div class="table-wrap"><table><tbody>' + Object.keys(f.sel).map(id => '<tr><td><strong>' + esc(FA.thName(id)) + '</strong></td><td><select data-bind="af.sel.' + id + '">' +
            FA.option('ambulatorio7', TEMPLATES.ambulatorio7.label, f.sel[id]) + FA.option('ambulatorio', TEMPLATES.ambulatorio.label, f.sel[id]) + FA.option('', 'Non cambiare (lo sistemo a mano)', f.sel[id]) + '</select></td></tr>').join('') +
          '</tbody></table></div>' + (f.conf ? conflictsBox(f.conf) : '') + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn" data-act="amb-fix-check"' + officeSave() + '>Verifica appuntamenti coinvolti</button>' +
        '<button class="btn primary" data-act="amb-fix-save"' + (A.ui.af.conf ? officeSave() : ' disabled title="Prima verifica"') + '>Applica</button>' });
  };
  FA.actions['amb-fix-check'] = async () => {
    const f = A.ui.af; f.error = null; let conf = [];
    try {
      for (const [id, k] of Object.entries(f.sel)) if (k) {
        const r = await FA.rpc('admin_save_shift', { p_th: id, p_valid_from: A.today, p_week: ambWeek(k), p_note: 'Correzione: solo ambulatorio', p_dry_run: true });
        conf = conf.concat(r.conflicts.map(c => Object.assign({}, c, { patient: FA.thName(id) + ' · ' + c.patient })));
      }
      f.conf = conf;
    } catch (e) { f.error = e.message; }
    FA.renderModal();
  };
  FA.actions['amb-fix-save'] = async () => {
    const f = A.ui.af;
    try {
      await FA.save('Turni corretti', async () => {
        for (const [id, k] of Object.entries(f.sel)) if (k) await FA.rpc('admin_save_shift', { p_th: id, p_valid_from: A.today, p_week: ambWeek(k), p_note: 'Correzione: ' + TEMPLATES[k].label, p_dry_run: false });
      });
      FA.closeModal();
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- inserimento rapido di più colleghi ---------------- */
  FA.actions['th-bulk'] = () => {
    A.ui.tb = { names: '', activity: 'ambulatorio_reparto', tpl: '', from: A.today, done: null };
    FA.openModal({ title: 'Inserimento rapido dei fisioterapisti', wide: true, sticky: true,
      body() {
        const f = A.ui.tb;
        const names = f.names.split('\n').map(x => x.trim()).filter(Boolean);
        return '<div class="field"><label>Nomi dei colleghi, uno per riga</label><textarea rows="10" data-bind="tb.names" placeholder="Rossi Anna\nVerdi Marco\n…">' + esc(f.names) + '</textarea>' +
          '<div class="help">' + names.length + ' nomi. Chi ha un’attività o un turno diverso lo correggi dopo dalla sua scheda.</div></div>' +
          '<div class="grid3"><div class="field"><label>Attività</label>' + FA.seg('tb.activity', [['ambulatorio', 'Solo ambulatorio'], ['ambulatorio_reparto', 'Ambulatorio e reparto']], f.activity) + '</div>' +
          '<div class="field"><label>Turno di partenza</label><select data-bind="tb.tpl">' + FA.option('', 'Nessuno: disegno io l’orario nel calendario', f.tpl) + Object.entries(TEMPLATES).filter(([k]) => f.activity !== 'ambulatorio' || k.startsWith('ambulatorio')).map(([k, t]) => FA.option(k, t.label, f.tpl)).join('') + '</select>' +
          (f.activity === 'ambulatorio' ? '<div class="help">Solo ambulatorio: nessuna fascia di reparto.</div>' : '') + '</div>' +
          '<div class="field"><label>Turno in vigore dal</label><input type="date" data-bind="tb.from" value="' + esc(f.from) + '"></div></div>' +
          '<p class="muted small">Le competenze si assegnano subito dopo nella “Tabella competenze”.</p>' +
          (f.done ? '<div class="form-note">' + f.done + '</div>' : '') + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Chiudi</button><button class="btn primary" data-act="th-bulk-save"' + officeSave() + '>' + (A.saving ? 'Inserimento…' : 'Inserisci tutti') + '</button>' });
  };
  FA.actions['th-bulk-save'] = async () => {
    const f = A.ui.tb;
    const existing = new Set(FA.allTherapists().map(t => t.name.trim().toLowerCase()));
    const names = [...new Set(f.names.split('\n').map(x => x.trim()).filter(Boolean))];
    const todo = names.filter(n => !existing.has(n.toLowerCase()));
    if (!todo.length) { f.error = names.length ? 'Questi nomi sono già presenti.' : 'Scrivi almeno un nome.'; FA.renderModal(); return; }
    f.error = null;
    // chi fa solo ambulatorio non va in reparto: schema ambulatoriale in ogni caso
    const tpl = f.activity === 'ambulatorio' && f.tpl && !f.tpl.startsWith('ambulatorio') ? (f.tpl === 'reparto7' ? 'ambulatorio7' : 'ambulatorio') : f.tpl;
    const week = {};
    [1, 2, 3, 4, 5, 6, 7].forEach(d => { week[d] = tpl && d <= 5 ? TEMPLATES[tpl].day.map(x => Object.assign({}, x)) : []; });
    const okNames = [], fail = [];
    try {
      await FA.save(todo.length + ' fisioterapisti', async () => {
        for (let i = 0; i < todo.length; i++) {
          try {
            const id = await FA.rpc('admin_save_therapist', { p: { name: todo[i], activity: f.activity, active: true, note: '', sort: FA.allTherapists().length + i + 1, skills: [] } });
            if (tpl) await FA.rpc('admin_save_shift', { p_th: id, p_valid_from: f.from, p_week: week, p_note: 'Turno iniziale: ' + TEMPLATES[tpl].label, p_dry_run: false });
            okNames.push(todo[i]);
          } catch (e) { fail.push(todo[i] + ': ' + e.message); }
        }
      });
    } catch (e) { /* già segnalato */ }
    f.done = '✓ Inseriti ' + okNames.length + ' fisioterapisti.' + (names.length > todo.length ? ' Saltati ' + (names.length - todo.length) + ' nomi già presenti.' : '') +
      (fail.length ? '<br>✗ Non inseriti: ' + esc(fail.join('; ')) : '') + '<br>Ora assegna le competenze con “Tabella competenze”.';
    f.names = '';
    FA.renderModal();
  };

  /* ---------------- tabella attività e turni ---------------- */
  const hasReparto = thId => { const v = E.shiftFor(A.ctx, thId, A.today); return !!v && Object.values(v.week || {}).some(d => (d || []).some(b => b.kind === 'reparto')); };
  FA.actions['act-matrix'] = () => {
    const rows = {};
    FA.allTherapists().filter(t => t.active).forEach(t => {
      const schema = t.activity === 'ambulatorio' && hasReparto(t.id) ? guessAmb(t.id) : '';
      rows[t.id] = { activity: t.activity, schema };
    });
    A.ui.am2 = { rows, from: A.today, conf: null, error: null };
    FA.openModal({ title: 'Attività e turni dei colleghi', wide: true, sticky: true,
      body() {
        const f = A.ui.am2;
        const opts = [['', 'Non cambiare il turno'], ['ambulatorio7', TEMPLATES.ambulatorio7.label], ['ambulatorio', TEMPLATES.ambulatorio.label],
          ['reparto7', TEMPLATES.reparto7.label], ['reparto8', TEMPLATES.reparto8.label]];
        return '<p class="small muted">Per ogni collega: attività e, se serve, uno schema di turno da applicare dalla data indicata (poi rifinibile collega per collega). Chi fa <strong>solo ambulatorio</strong> riceve pazienti per tutta la sua fascia, senza reparto.</p>' +
          '<div class="field" style="max-width:240px"><label>Nuovi turni in vigore dal</label><input type="date" min="' + A.today + '" data-bind="am2.from" value="' + esc(f.from) + '"></div>' +
          '<div class="table-wrap"><table class="small"><thead><tr><th>Fisioterapista</th><th>Turno attuale</th><th>Attività</th><th>Schema da applicare</th></tr></thead><tbody>' +
          FA.allTherapists().filter(t => t.active).map(t => {
            const r = f.rows[t.id], v = E.shiftFor(A.ctx, t.id, A.today);
            const first = v ? Object.values(v.week || {}).flat().map(x => E.hhmm(x.start)).sort()[0] : null;
            const now = !v ? '<span class="chip bad">nessun turno</span>' : (hasReparto(t.id) ? '<span class="chip warn">con reparto</span>' : '<span class="chip ok">solo ambulatorio</span>') + (first ? ' ingresso ' + first : '');
            return '<tr><td><strong>' + esc(t.name) + '</strong></td><td>' + now + '</td><td><select data-bind="am2.rows.' + t.id + '.activity" data-rerender>' +
              FA.option('ambulatorio', 'Solo ambulatorio', r.activity) + FA.option('ambulatorio_reparto', 'Ambulatorio e reparto', r.activity) + '</select>' +
              (r.activity === 'ambulatorio' && hasReparto(t.id) && !r.schema ? '<div class="small" style="color:var(--bad)">⚠ ha il reparto nel turno: scegli uno schema</div>' : '') + '</td>' +
              '<td><select data-bind="am2.rows.' + t.id + '.schema" data-rerender>' + opts.filter(([k]) => !k || r.activity !== 'ambulatorio' || k.startsWith('ambulatorio')).map(([k, l]) => FA.option(k, l, r.schema)).join('') + '</select></td></tr>';
          }).join('') + '</tbody></table></div>' + (f.conf ? conflictsBox(f.conf) : '') + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn" data-act="act-check"' + officeSave() + '>Verifica appuntamenti coinvolti</button>' +
        '<button class="btn primary" data-act="act-save"' + (A.ui.am2.conf ? officeSave() : ' disabled title="Prima verifica"') + '>Salva</button>' });
  };
  FA.actions['act-check'] = async () => {
    const f = A.ui.am2; f.error = null; let conf = [];
    try {
      for (const [id, r] of Object.entries(f.rows)) if (r.schema) {
        const x = await FA.rpc('admin_save_shift', { p_th: id, p_valid_from: f.from, p_week: ambWeek(r.schema), p_note: 'Schema: ' + TEMPLATES[r.schema].label, p_dry_run: true });
        conf = conf.concat(x.conflicts.map(c => Object.assign({}, c, { patient: FA.thName(id) + ' · ' + c.patient })));
      }
      f.conf = conf;
    } catch (e) { f.error = e.message; }
    FA.renderModal();
  };
  FA.actions['act-save'] = async () => {
    const f = A.ui.am2; const fail = [];
    try {
      await FA.save('Attività e turni', async () => {
        for (const [id, r] of Object.entries(f.rows)) {
          const t = A.ctx.th.get(id);
          try {
            if (r.activity !== t.activity) {
              const skills = (A.data.therapist_skills || []).filter(x => x.therapist_id === id).map(x => ({ category_id: x.category_id, level: x.level }));
              await FA.rpc('admin_save_therapist', { p: { id, version: t.version, name: t.name, activity: r.activity, max_daily: t.max_daily == null ? '' : String(t.max_daily), active: t.active, note: t.note, sort: t.sort, skills } });
            }
            if (r.schema) await FA.rpc('admin_save_shift', { p_th: id, p_valid_from: f.from, p_week: ambWeek(r.schema), p_note: 'Schema: ' + TEMPLATES[r.schema].label, p_dry_run: false });
          } catch (e) { fail.push(t.name + ': ' + e.message); }
        }
      });
    } catch (e) { /* già segnalato */ }
    if (fail.length) { f.error = 'Non salvati: ' + fail.join('; '); FA.renderModal(); } else FA.closeModal();
  };

  /* ---------------- tabella delle competenze ---------------- */
  FA.actions['sk-matrix'] = () => {
    const m = {};
    FA.allTherapists().forEach(t => { m[t.id] = {}; FA.categories().forEach(c => { m[t.id][c.id] = E.skillLevel(A.ctx, t.id, c.id) || ''; }); });
    A.ui.sk = { m, error: null };
    FA.openModal({ title: 'Tabella competenze', wide: true, sticky: true,
      body() {
        const cats = FA.categories();
        return '<p class="small muted">★ = competenza specifica (proposto per primo) · A = abilitato · – = non abilitato (mai proposto per quel percorso).</p>' +
          '<div class="table-wrap"><table class="small"><thead><tr><th>Fisioterapista</th>' + cats.map(c => '<th title="' + esc(c.name) + '">' + esc(c.name) + '</th>').join('') + '</tr></thead><tbody>' +
          FA.allTherapists().map(t => '<tr><td class="nowrap"><strong>' + esc(t.name) + '</strong></td>' + cats.map(c => '<td><select style="min-height:34px;padding:4px;min-width:62px" aria-label="' + esc(t.name + ' – ' + c.name) + '" data-bind="sk.m.' + t.id + '.' + c.id + '">' +
            FA.option('', '–', A.ui.sk.m[t.id][c.id]) + FA.option('abilitato', 'A', A.ui.sk.m[t.id][c.id]) + FA.option('specifica', '★', A.ui.sk.m[t.id][c.id]) + '</select></td>').join('') + '</tr>').join('') +
          '</tbody></table></div>' + FA.errBox(A.ui.sk.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Chiudi senza salvare</button><button class="btn primary" data-act="sk-save"' + officeSave() + '>' + (A.saving ? 'Salvataggio…' : 'Salva le competenze') + '</button>' });
  };
  FA.actions['sk-save'] = async () => {
    const f = A.ui.sk;
    const changed = FA.allTherapists().filter(t => FA.categories().some(c => (E.skillLevel(A.ctx, t.id, c.id) || '') !== f.m[t.id][c.id]));
    if (!changed.length) { FA.closeModal(); return; }
    const fail = [];
    try {
      await FA.save('Competenze di ' + changed.length + ' colleghi', async () => {
        for (const t of changed) {
          // le competenze di percorsi non attivi restano invariate
          const keep = (A.data.therapist_skills || []).filter(s => s.therapist_id === t.id && !f.m[t.id].hasOwnProperty(s.category_id)).map(s => ({ category_id: s.category_id, level: s.level }));
          const skills = keep.concat(Object.entries(f.m[t.id]).filter(([, l]) => l).map(([category_id, level]) => ({ category_id, level })));
          try {
            await FA.rpc('admin_save_therapist', { p: { id: t.id, version: t.version, name: t.name, activity: t.activity, max_daily: t.max_daily == null ? '' : String(t.max_daily),
              active: t.active, note: t.note, sort: t.sort, skills } });
          } catch (e) { fail.push(t.name + ': ' + e.message); }
        }
      });
    } catch (e) { /* già segnalato */ }
    if (fail.length) { f.error = 'Non salvate: ' + fail.join('; '); FA.renderModal(); } else FA.closeModal();
  };

  /* ---------------- turni ---------------- */
  FA.actions['wk-shift'] = el => { A.ui.cfgTab = 'turni'; A.ui.shTh = el.getAttribute('data-th'); FA.go('config'); setTimeout(() => FA.actions['sh-new'](), 50); };
  FA.actions['cfg-shift-of'] = el => { A.ui.cfgTab = 'turni'; A.ui.shTh = el.getAttribute('data-id'); FA.go('config'); FA.render(); };
  function shiftsTab() {
    const th = A.ui.shTh || (FA.allTherapists()[0] || {}).id;
    A.ui.shTh = th;
    const versions = (A.ctx.shifts.get(th) || []);
    const cur = E.shiftFor(A.ctx, th, A.today);
    const future = versions.filter(v => v.valid_from > A.today);
    return '<div class="row"><div class="field" style="min-width:280px"><label>Fisioterapista</label><select data-bind="shTh" data-rerender>' + FA.allTherapists().map(t => FA.option(t.id, t.name, th)).join('') + '</select></div>' +
      '<span class="grow"></span><button class="btn primary small" data-act="sh-new"' + officeOnly() + '>Nuovo turno con decorrenza…</button>' +
      '<button class="btn small" data-act="ov-new"' + officeOnly() + '>Variazione di un giorno…</button></div>' +
      ambFixBox() +
      '<p class="muted small">Ogni collega ha il proprio turno, modificabile singolarmente (gli schemi pronti sono solo un punto di partenza). Un nuovo turno vale dalla data di decorrenza; i turni precedenti restano nello storico.</p>' +
      (cur ? '<h4>In vigore oggi (dal ' + E.fmtIt(cur.valid_from) + ')' + (cur.note ? ' · ' + esc(cur.note) : '') + '</h4>' + weekGrid(cur.week) : '<div class="form-warn">Nessun turno in vigore oggi.</div>') +
      future.map(v => '<h4 style="margin-top:14px">Dal ' + E.fmtIt(v.valid_from) + ' (programmato)' + (v.note ? ' · ' + esc(v.note) : '') + '</h4>' + weekGrid(v.week)).join('') +
      '<h4 style="margin-top:14px">Storico dei turni</h4><ul class="list">' + versions.map(v => '<li>Dal ' + E.fmtIt(v.valid_from) + ' · ' + esc(v.note || '') + ' <span class="muted small">(registrato il ' + new Date(v.created_at).toLocaleDateString('it-IT') + ')</span></li>').join('') + '</ul>' +
      overridesList(th);
  }
  function overridesList(th) {
    const ov = (A.data.day_overrides || []).filter(o => o.therapist_id === th && o.day >= A.today).sort((a, b) => a.day < b.day ? -1 : 1);
    return '<h4 style="margin-top:14px">Variazioni giornaliere</h4>' + (ov.length ? '<ul class="list">' + ov.map(o => '<li class="todo-item"><div><strong>' + esc(FA.dayLabel(o.day)) + '</strong> ' + (o.note ? '· ' + esc(o.note) : '') + blocksSummary(o.blocks) + '</div>' +
      '<div><button class="btn small" data-act="ov-edit" data-day="' + o.day + '"' + officeOnly() + '>Modifica</button></div></li>').join('') + '</ul>' : '<p class="muted small">Nessuna variazione.</p>');
  }
  FA.actions['sh-new'] = () => {
    const th = A.ui.shTh;
    const cur = (A.ctx.shifts.get(th) || [])[0];
    const week = {};
    [1, 2, 3, 4, 5, 6, 7].forEach(d => { week[d] = cur ? (cur.week[String(d)] || []).map(b => Object.assign({}, b)) : []; });
    const thr = A.ctx.th.get(th);
    if (thr && thr.activity === 'ambulatorio' && Object.values(week).some(day => day.some(b => b.kind === 'reparto')))
      [1, 2, 3, 4, 5].forEach(d => { week[d] = TEMPLATES[guessAmb(th)].day.map(x => Object.assign({}, x)); });
    A.ui.sh = { th, valid_from: E.addDays(A.today, 1), note: '', week, conflicts: null, checked: false };
    FA.openModal({ title: 'Nuovo turno di ' + FA.thName(th), wide: true, sticky: true,
      body() {
        const f = A.ui.sh;
        return '<div class="grid2"><div class="field"><label>In vigore dal</label><input type="date" min="' + A.today + '" data-bind="sh.valid_from" value="' + esc(f.valid_from) + '"></div>' +
          '<div class="field"><label>Nota</label><input type="text" data-bind="sh.note" value="' + esc(f.note) + '"></div></div>' +
          '<p class="small muted">Fasce: solo “Ambulatorio” è prenotabile. Reparto, pausa, documentazione e preparazione sono protette. “max” limita i pazienti in quella fascia.</p>' +
          '<div class="row"><button class="btn small" data-act="sh-copy">Copia il lunedì su martedì–venerdì</button>' +
          '<select style="max-width:300px;min-height:34px" data-bind="sh.tpl" data-on="sh-tpl"><option value="">Parti da uno schema pronto…</option>' +
          Object.entries(TEMPLATES).map(([k, t]) => FA.option(k, t.label, f.tpl)).join('') + '</select>' +
          '<select style="max-width:300px;min-height:34px" data-bind="sh.from_th" data-on="sh-copy-th"><option value="">Parti dal turno di un collega…</option>' +
          FA.allTherapists().filter(t => t.id !== f.th && (A.ctx.shifts.get(t.id) || []).length).map(t => FA.option(t.id, t.name, f.from_th)).join('') + '</select></div>' +
          [1, 2, 3, 4, 5, 6, 7].map(d => '<div class="week-day" style="margin-top:8px"><h4>' + E.WD_LONG[d] + '</h4>' + blocksEditor('sh.week.' + d, listAt('sh.week.' + d)) + '</div>').join('') +
          conflictsBox(f.conflicts) + FA.errBox(f.error);
      },
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn" data-act="sh-check"' + officeSave() + '>Verifica appuntamenti coinvolti</button>' +
        '<button class="btn primary" data-act="sh-save"' + (A.ui.sh.checked ? officeSave() : ' disabled title="Prima verifica gli appuntamenti coinvolti"') + '>Salva il nuovo turno</button>' });
  };
  // schemi di partenza (dalla versione 3): modificabili fascia per fascia, per ogni collega
  const b = (kind, start, end, max) => ({ kind, start, end, max: max || null });
  const TEMPLATES = {
    reparto7: { label: 'Ambulatorio e reparto, ingresso 7:00', day: [b('preparazione', '07:00', '07:15'), b('amb', '07:15', '09:00'), b('reparto', '09:00', '12:00'), b('pausa', '12:00', '12:20'), b('amb', '12:20', '13:20'), b('documentazione', '13:20', '14:12')] },
    reparto8: { label: 'Ambulatorio e reparto, ingresso 8:00', day: [b('preparazione', '08:00', '08:15'), b('amb', '08:15', '09:00', 1), b('reparto', '09:00', '12:20'), b('pausa', '12:20', '12:40'), b('amb', '12:40', '14:45'), b('documentazione', '14:45', '15:12')] },
    ambulatorio7: { label: 'Solo ambulatorio, ingresso 7:00 (pazienti 7:15–13:40)', day: [b('preparazione', '07:00', '07:15'), b('amb', '07:15', '12:00'), b('pausa', '12:00', '12:20'), b('amb', '12:20', '13:40'), b('documentazione', '13:40', '14:12')] },
    ambulatorio: { label: 'Solo ambulatorio, ingresso 8:00 (pazienti 8:15–14:40)', day: [b('preparazione', '08:00', '08:15'), b('amb', '08:15', '12:20'), b('pausa', '12:20', '12:40'), b('amb', '12:40', '14:40'), b('documentazione', '14:40', '15:12')] }
  };
  FA.SHIFT_TEMPLATES = TEMPLATES;
  FA.actions['sh-tpl'] = () => {
    const f = A.ui.sh, t = TEMPLATES[f.tpl];
    if (t) [1, 2, 3, 4, 5].forEach(d => { f.week[d] = t.day.map(x => Object.assign({}, x)); });
    f.checked = false; FA.renderModal();
  };
  FA.actions['sh-copy-th'] = () => {
    const f = A.ui.sh; const v = E.shiftFor(A.ctx, f.from_th, A.today) || (A.ctx.shifts.get(f.from_th) || [])[0];
    if (v) [1, 2, 3, 4, 5, 6, 7].forEach(d => { f.week[d] = (v.week[String(d)] || []).map(b => Object.assign({}, b)); });
    f.checked = false; FA.renderModal();
  };
  FA.actions['sh-copy'] = () => { const f = A.ui.sh; const mon = listAt('sh.week.1'); [2, 3, 4, 5].forEach(d => { f.week[d] = mon.map(b => Object.assign({}, b)); }); f.checked = false; FA.renderModal(); };
  function weekPayload(f) { const w = {}; [1, 2, 3, 4, 5, 6, 7].forEach(d => { w[d] = cleanBlocks(f.week[d]); }); return w; }
  FA.actions['sh-check'] = async () => {
    const f = A.ui.sh; f.error = null;
    try { const r = await FA.rpc('admin_save_shift', { p_th: f.th, p_valid_from: f.valid_from, p_week: weekPayload(f), p_note: f.note, p_dry_run: true }); f.conflicts = r.conflicts; f.checked = true; }
    catch (e) { f.error = e.message; f.checked = false; }
    FA.renderModal();
  };
  FA.actions['sh-save'] = async () => {
    const f = A.ui.sh;
    try {
      const r = await FA.save('Nuovo turno', () => FA.rpc('admin_save_shift', { p_th: f.th, p_valid_from: f.valid_from, p_week: weekPayload(f), p_note: f.note, p_dry_run: false }));
      FA.closeModal();
      if (r.conflicts.length) FA.toast(r.conflicts.length + ' appuntamenti incompatibili segnalati in “Da sistemare”');
    } catch (e) { f.error = e.message; FA.renderModal(); }
  };
  function openOverride(day) {
    const th = A.ui.shTh;
    const existing = (A.data.day_overrides || []).find(o => o.therapist_id === th && o.day === day);
    A.ui.ov = { th, day, note: existing ? existing.note : '', blocks: E.dayBlocks(A.ctx, th, day).map(b => Object.assign({}, b)), exists: !!existing, conflicts: null, checked: false };
    FA.openModal({ title: 'Variazione giornaliera di ' + FA.thName(th), wide: true, sticky: true,
      body() {
        const f = A.ui.ov;
        return '<div class="grid2"><div class="field"><label>Giorno</label><input type="date" min="' + A.today + '" data-bind="ov.day" data-on="ov-day" value="' + esc(f.day) + '"></div>' +
          '<div class="field"><label>Nota</label><input type="text" data-bind="ov.note" value="' + esc(f.note) + '"></div></div>' +
          '<p class="small muted">Le fasce sostituiscono il turno solo per questo giorno. Per un’assenza usa “Assenze”.</p>' + blocksEditor('ov.blocks', listAt('ov.blocks')) + conflictsBox(f.conflicts) + FA.errBox(f.error);
      },
      foot: () => (A.ui.ov.exists ? '<button class="btn danger" data-act="ov-remove"' + officeSave() + '>Rimuovi variazione</button>' : '') + '<span class="grow"></span><button class="btn" data-act="close-modal">Annulla</button>' +
        '<button class="btn" data-act="ov-check"' + officeSave() + '>Verifica</button><button class="btn primary" data-act="ov-save"' + (A.ui.ov.checked ? officeSave() : ' disabled') + '>Salva</button>' });
  }
  FA.actions['ov-new'] = () => openOverride(E.addDays(A.today, 1));
  FA.actions['ov-edit'] = el => openOverride(el.getAttribute('data-day'));
  FA.actions['ov-day'] = () => { const f = A.ui.ov; f.blocks = E.dayBlocks(A.ctx, f.th, f.day).map(b => Object.assign({}, b)); f.checked = false; f.conflicts = null; FA.renderModal(); };
  FA.actions['ov-check'] = async () => {
    const f = A.ui.ov; f.error = null;
    try { const r = await FA.rpc('admin_set_day_override', { p_th: f.th, p_day: f.day, p_blocks: cleanBlocks(f.blocks), p_note: f.note, p_dry_run: true }); f.conflicts = r.conflicts; f.checked = true; }
    catch (e) { f.error = e.message; }
    FA.renderModal();
  };
  FA.actions['ov-save'] = async () => {
    const f = A.ui.ov;
    try { await FA.save('Variazione giornaliera', () => FA.rpc('admin_set_day_override', { p_th: f.th, p_day: f.day, p_blocks: cleanBlocks(f.blocks), p_note: f.note, p_dry_run: false })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['ov-remove'] = async () => {
    const f = A.ui.ov;
    try { await FA.save('Variazione rimossa', () => FA.rpc('admin_set_day_override', { p_th: f.th, p_day: f.day, p_blocks: null, p_note: '', p_dry_run: false })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };

  /* ---------------- modifica diretta dell'orario dal calendario ---------------- */
  FA.openDayEditor = function (thId, day, addAt) {
    const v = E.shiftFor(A.ctx, thId, day);
    const blocks = E.dayBlocks(A.ctx, thId, day).map(b => Object.assign({}, b));
    A.ui.de = { th: thId, day, blocks, scope: 'giorno', note: '', conf: null, error: null, at: addAt || null,
      hasOverride: !!A.ctx.overrides.get(thId + '|' + day), base: v };
    if (addAt) deAdd('amb');
    const wd = E.WD_LONG[E.weekday(day)];
    FA.openModal({ title: 'Orario di ' + FA.thName(thId) + ' · ' + FA.dayLabel(day), wide: true, sticky: true,
      body() {
        const f = A.ui.de;
        return '<p class="small muted">Disegna la giornata: solo le fasce <strong>Ambulatorio</strong> ricevono pazienti, tutte le altre sono bloccate. “max” limita i pazienti in una fascia (facoltativo).</p>' +
          '<div class="row" style="margin-bottom:8px"><span class="small"><strong>Aggiungi:</strong></span>' + KINDS.filter(([k]) => k !== 'preparazione').map(([k, l]) =>
            '<button class="btn small" data-act="de-add" data-k="' + k + '">+ ' + esc(l.replace(' (pazienti)', '')) + '</button>').join('') +
          '<button class="btn small danger" data-act="de-clear">Svuota il giorno</button></div>' +
          blocksEditor('de.blocks', listAt('de.blocks')) +
          '<div class="field" style="margin-top:12px"><label>Vale per</label>' + FA.seg('de.scope', [['giorno', 'Solo questo giorno'], ['settimanale', 'Tutti i ' + wd + ' da questa data'], ['tutti', 'Tutti i giorni lavorativi da questa data']], f.scope) + '</div>' +
          '<div class="field"><label>Nota (facoltativa)</label><input type="text" data-bind="de.note" value="' + esc(f.note) + '"></div>' +
          (f.scope === 'giorno' ? '<p class="small muted">Variazione di un solo giorno: il turno abituale non cambia.</p>' : '<p class="small muted">Nuovo turno in vigore dal ' + E.fmtIt(f.day) + ': i turni precedenti restano nello storico.</p>') +
          (f.conf ? conflictsBox(f.conf) : '') + FA.errBox(f.error);
      },
      foot: () => (A.ui.de.hasOverride ? '<button class="btn danger" data-act="de-reset"' + officeSave() + '>Ripristina il turno abituale per questo giorno</button>' : '') +
        '<span class="grow"></span><button class="btn" data-act="close-modal">Annulla</button><button class="btn" data-act="de-check"' + officeSave() + '>Verifica</button>' +
        '<button class="btn primary" data-act="de-save"' + (A.ui.de.conf ? officeSave() : ' disabled title="Prima verifica"') + '>Salva</button>' });
  };
  /** aggiunge una fascia: al punto cliccato nel calendario oppure dopo l'ultima fascia */
  function deAdd(kind) {
    const f = A.ui.de, l = listAt('de.blocks');
    const sorted = l.filter(b => b.start && b.end).sort((a, b) => a.start < b.start ? -1 : 1);
    let s0 = f.at || (sorted.length ? E.hhmm(sorted[sorted.length - 1].end) : '08:00');
    const nextStart = sorted.map(b => E.hhmm(b.start)).find(x => x > s0);
    let e0 = E.fromMin(Math.min(E.toMin(s0) + (kind === 'pausa' || kind === 'briefing' ? 20 : 60), nextStart ? E.toMin(nextStart) : 24 * 60 - 1));
    if (e0 <= s0) e0 = E.fromMin(E.toMin(s0) + 15);
    l.push({ kind, start: s0, end: e0, max: null });
    l.sort((a, b) => (a.start || '99') < (b.start || '99') ? -1 : 1);
    f.at = null; f.conf = null;
  }
  FA.actions['de-add'] = el => { deAdd(el.getAttribute('data-k')); FA.renderModal(); };
  FA.actions['de-clear'] = () => { A.ui.de.blocks = []; A.ui.de.conf = null; FA.renderModal(); };
  // clic su un punto vuoto della giornata nel calendario (modalità modifica orari)
  FA.actions['de-at'] = (el, ev) => {
    const min = Number(el.getAttribute('data-min')), px = Number(el.getAttribute('data-px'));
    const t = Math.max(0, Math.round((min + ev.offsetY / px) / 15) * 15);
    FA.openDayEditor(el.getAttribute('data-th'), el.getAttribute('data-day'), E.fromMin(Math.min(t, 23 * 60)));
  };
  // ripartire da zero: orario settimanale vuoto da oggi
  FA.actions['wk-clear'] = async el => {
    const th = el.getAttribute('data-th');
    const week = {}; [1, 2, 3, 4, 5, 6, 7].forEach(d => { week[d] = []; });
    let n = 0;
    try { n = (await FA.rpc('admin_save_shift', { p_th: th, p_valid_from: A.today, p_week: week, p_note: 'Orario da ridisegnare', p_dry_run: true })).conflicts.length; }
    catch (e) { FA.toast(e.message, 'bad'); return; }
    if (!confirm('Svuoto l’orario settimanale di ' + FA.thName(th) + ' da oggi, per ridisegnarlo nel calendario.' + (n ? '\n' + n + ' pazienti già prenotati resteranno segnalati “da sistemare” finché non disegni le fasce Ambulatorio.' : '') + '\nI turni precedenti restano nello storico. Confermi?')) return;
    try { await FA.save('Orario svuotato', () => FA.rpc('admin_save_shift', { p_th: th, p_valid_from: A.today, p_week: week, p_note: 'Orario da ridisegnare', p_dry_run: false })); } catch (e) { /* segnalato */ }
  };
  function deCall(dry) {
    const f = A.ui.de, blocks = cleanBlocks(f.blocks);
    if (f.scope === 'giorno') return FA.rpc('admin_set_day_override', { p_th: f.th, p_day: f.day, p_blocks: blocks, p_note: f.note || 'Modifica dal calendario', p_dry_run: dry });
    const week = {};
    [1, 2, 3, 4, 5, 6, 7].forEach(d => { week[d] = f.base ? (f.base.week[String(d)] || []).map(x => Object.assign({}, x)) : []; });
    if (f.scope === 'settimanale') week[E.weekday(f.day)] = blocks;
    else [1, 2, 3, 4, 5].forEach(d => { week[d] = blocks.map(x => Object.assign({}, x)); });
    return FA.rpc('admin_save_shift', { p_th: f.th, p_valid_from: f.day, p_week: week, p_note: f.note || 'Modifica dal calendario', p_dry_run: dry });
  }
  FA.actions['de-check'] = async () => {
    const f = A.ui.de; f.error = null;
    try { f.conf = (await deCall(true)).conflicts; } catch (e) { f.error = e.message; f.conf = null; }
    FA.renderModal();
  };
  FA.actions['de-save'] = async () => {
    const f = A.ui.de;
    try { await FA.save('Orario aggiornato', () => deCall(false)); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['de-reset'] = async () => {
    const f = A.ui.de;
    try { await FA.save('Turno abituale ripristinato', () => FA.rpc('admin_set_day_override', { p_th: f.th, p_day: f.day, p_blocks: null, p_note: '', p_dry_run: false })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  FA.actions['de-open'] = el => FA.openDayEditor(el.getAttribute('data-th'), el.getAttribute('data-day'));

  /* ---------------- assenze (elenco completo) ---------------- */
  function absencesTab() {
    const list = (A.data.absences || []).slice().sort((a, b) => a.start_date < b.start_date ? 1 : -1);
    return '<div class="row between"><p class="muted">Ferie, malattie, permessi e formazione dei colleghi.</p><button class="btn primary small" data-act="abs-new"' + FA.disabledIfReadOnly() + '>+ Registra ferie, permesso o malattia</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Fisioterapista</th><th>Periodo</th><th>Motivo</th><th>Stato</th><th></th></tr></thead><tbody>' +
      list.map(a => '<tr><td>' + esc(FA.thName(a.therapist_id)) + '</td><td>' + esc(FA.absPeriod(a)) + '</td><td>' + esc(E.ABSENCE_KIND[a.kind]) + (a.note ? '<br><span class="small muted">' + esc(a.note) + '</span>' : '') + '</td>' +
        '<td>' + (a.cancelled ? '<span class="chip grey">annullata</span>' : a.end_date && a.end_date < A.today ? '<span class="chip grey">conclusa</span>' : '<span class="chip warn">in corso / prevista</span>') + '</td>' +
        '<td class="nowrap">' + (a.cancelled ? '' : '<button class="btn small" data-act="abs-edit" data-id="' + a.id + '"' + FA.disabledIfReadOnly() + '>Modifica</button> <button class="btn small" data-act="abs-plan" data-id="' + a.id + '">Sostituti</button>') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  /* ---------------- percorsi e chiusure ---------------- */
  function categoriesTab() {
    const cats = [...A.ctx.cat.values()].sort((a, b) => a.sort - b.sort);
    return '<div class="row between"><p class="muted">Percorsi (categorie organizzative modificabili).</p><button class="btn small primary" data-act="cat-edit" data-id=""' + adminOnly() + '>+ Nuovo percorso</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Codice</th><th>Nome</th><th>Ordine</th><th>Stato</th><th></th></tr></thead><tbody>' +
      cats.map(c => '<tr><td><code>' + esc(c.id) + '</code></td><td>' + esc(c.name) + '</td><td>' + c.sort + '</td><td>' + (c.active ? '<span class="chip ok">attivo</span>' : '<span class="chip grey">non attivo</span>') + '</td>' +
        '<td><button class="btn small" data-act="cat-edit" data-id="' + esc(c.id) + '"' + adminOnly() + '>Modifica</button></td></tr>').join('') + '</tbody></table></div>';
  }
  FA.actions['cat-edit'] = el => {
    const c = A.ctx.cat.get(el.getAttribute('data-id'));
    A.ui.ce = { isNew: !c, id: c ? c.id : '', name: c ? c.name : '', active: c ? c.active : true, sort: c ? c.sort : 50 };
    FA.openModal({ title: c ? 'Percorso' : 'Nuovo percorso',
      body: () => '<div class="field"><label>Codice (breve, senza spazi)</label><input type="text" data-bind="ce.id" value="' + esc(A.ui.ce.id) + '"' + (A.ui.ce.isNew ? '' : ' disabled') + '></div>' +
        '<div class="field"><label>Nome</label><input type="text" data-bind="ce.name" value="' + esc(A.ui.ce.name) + '"></div>' +
        '<div class="grid2"><div class="field"><label>Ordine</label><input type="number" data-num data-bind="ce.sort" value="' + esc(A.ui.ce.sort) + '"></div>' +
        '<div class="field"><label>&nbsp;</label><label class="inline-check"><input type="checkbox" data-bind="ce.active"' + (A.ui.ce.active ? ' checked' : '') + '> Attivo</label></div></div>' + FA.errBox(A.ui.ce.error),
      foot: () => '<button class="btn" data-act="close-modal">Annulla</button><button class="btn primary" data-act="cat-save"' + adminSave() + '>Salva</button>' });
  };
  FA.actions['cat-save'] = async () => {
    const f = A.ui.ce;
    try { await FA.save('Percorso', () => FA.rpc('admin_save_category', { p_id: f.id.trim(), p_name: f.name, p_active: !!f.active, p_sort: Number(f.sort) || 0 })); FA.closeModal(); }
    catch (e) { f.error = e.message; FA.renderModal(); }
  };
  function closuresTab() {
    const list = (A.data.closures || []).filter(c => c.day >= E.addDays(A.today, -30)).sort((a, b) => a.day < b.day ? -1 : 1);
    const f = A.ui.cl || (A.ui.cl = { day: '', label: '' });
    return '<p class="muted">Festività e chiusure: le date vengono saltate nei cicli. Il Santo Patrono non è inserito: aggiungilo se serve.</p>' +
      '<form class="row" data-submit="cl-add"><input type="date" style="max-width:180px" data-bind="cl.day" value="' + esc(f.day) + '"' + adminOnly() + '><input type="text" style="max-width:320px" placeholder="Descrizione" data-bind="cl.label" value="' + esc(f.label) + '"' + adminOnly() + '>' +
      '<button class="btn small primary" type="submit"' + adminSave() + '>Aggiungi chiusura</button></form>' + FA.errBox(f.error) +
      '<ul class="list">' + list.map(c => '<li class="todo-item"><div>' + esc(FA.dayLabel(c.day)) + ' — ' + esc(c.label) + '</div><div><button class="btn small" data-act="cl-del" data-day="' + c.day + '"' + adminOnly() + '>Elimina</button></div></li>').join('') + '</ul>';
  }
  FA.actions['cl-add'] = async () => {
    const f = A.ui.cl;
    if (!f.day || !f.label) { f.error = 'Indica data e descrizione.'; FA.render(); return; }
    try { await FA.save('Chiusura', () => FA.rpc('admin_save_closure', { p_day: f.day, p_label: f.label, p_delete: false })); A.ui.cl = null; FA.render(); }
    catch (e) { f.error = e.message; FA.render(); }
  };
  FA.actions['cl-del'] = async el => {
    if (!confirm('Eliminare la chiusura?')) return;
    try { await FA.save('Chiusura eliminata', () => FA.rpc('admin_save_closure', { p_day: el.getAttribute('data-day'), p_label: '', p_delete: true })); } catch (e) { /* già segnalato */ }
  };

  /* ---------------- utenti ---------------- */
  function usersTab() {
    const list = (A.data.profiles || []).slice().sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
    return '<div class="form-note"><strong>Come aggiungere un collega:</strong> nel pannello di Supabase apri <em>Authentication → Users → Add user → Create new user</em> con password temporanea e “Auto Confirm User”. ' +
      'Il nuovo account compare qui in <em>sola consultazione</em>: assegna il ruolo. La registrazione libera è disattivata.</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Agende dei colleghi</th><th>Attivo</th><th></th></tr></thead><tbody>' +
      list.map(p => {
        const k = 'us.' + p.user_id;
        if (!FA.get(k)) FA.set(k, { role: p.role, active: p.active, full_name: p.full_name, therapist_id: p.therapist_id || '', edit_until: p.edit_all_until || '' });
        const f = FA.get(k);
        return '<tr><td><input type="text" data-bind="' + k + '.full_name" value="' + esc(f.full_name) + '"' + adminOnly() + '></td><td>' + esc(p.email) + '</td>' +
          '<td><select data-bind="' + k + '.role" data-rerender' + adminOnly() + '>' + ['programmatore', 'admin', 'operatore', 'fisioterapista', 'lettura'].map(r => FA.option(r, FA.roleLabel(r), f.role)).join('') + '</select>' +
          (f.role === 'fisioterapista' ? '<select style="margin-top:4px" data-bind="' + k + '.therapist_id"' + adminOnly() + '><option value="">— quale collega? —</option>' + FA.allTherapists().map(t => FA.option(t.id, t.name, f.therapist_id)).join('') + '</select>' : '') + '</td>' +
          '<td>' + (f.role === 'fisioterapista' || f.role === 'lettura'
            ? '<label class="small">Può modificarle (o fare da sostituto della segreteria) fino al</label><input type="date" data-bind="' + k + '.edit_until" value="' + esc(f.edit_until) + '"' + adminOnly() + '>' +
              (f.edit_until && f.edit_until >= A.today ? '<div class="small ok-txt">autorizzato</div>' : '<div class="small muted">solo consultazione' + (f.role === 'fisioterapista' ? ' (modifica il proprio)' : '') + '</div>')
            : '<span class="small muted">' + (f.role === 'lettura' ? 'consultazione' : 'tutte') + '</span>') + '</td>' +
          '<td><input type="checkbox" data-bind="' + k + '.active"' + (f.active ? ' checked' : '') + adminOnly() + ' aria-label="Attivo"></td>' +
          '<td><button class="btn small" data-act="us-save" data-id="' + p.user_id + '"' + adminSave() + '>Salva</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted small">Ruoli: <strong>Programmatore</strong> e <strong>Coordinatore</strong> (entrambi accesso a tutto: configurazione, utenti, backup e tutti i calendari), <strong>Segreteria / operatore</strong> (tutti i calendari, assenze, sostituzioni, pazienti), <strong>Fisioterapista</strong> (modifica il proprio tabulato e consulta quelli dei colleghi: va collegato al suo nome), <strong>Sola consultazione</strong>. Con una data in «Agende dei colleghi» un fisioterapista o un account di consultazione può modificare tutte le agende e usare gli strumenti della segreteria fino a quel giorno (per esempio come sostituto della segreteria). I permessi sono verificati sul server.</p>';
  }
  FA.actions['us-save'] = async el => {
    const id = el.getAttribute('data-id'), f = FA.get('us.' + id);
    try { await FA.save('Utente', () => FA.rpc('admin_set_user', { p_user: id, p_role: f.role, p_active: !!f.active, p_full_name: f.full_name || '', p_therapist: f.role === 'fisioterapista' && f.therapist_id ? f.therapist_id : null,
      p_edit_until: (f.role === 'fisioterapista' || f.role === 'lettura') && f.edit_until ? f.edit_until : null })); A.ui.us = null; FA.render(); }
    catch (e) { A.ui.us = null; FA.render(); }
  };

  /* ---------------- backup ---------------- */
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  function backupTab() {
    const f = A.ui.bk || (A.ui.bk = {});
    return '<div class="panel"><h3>Scarica un backup</h3><p>Salva sul computer una copia completa dei dati del servizio (fisioterapisti, turni, assenze, pazienti fittizi, cicli, appuntamenti, storico). Consigliato almeno una volta alla settimana e prima di modifiche importanti.</p>' +
      '<button class="btn primary" data-act="bk-export"' + adminSave() + '>Scarica backup (.json)</button></div>' +
      '<div class="panel"><h3>Ripristina da un backup</h3><p class="form-warn">Il ripristino <strong>sostituisce tutti i dati attuali</strong> per tutti i colleghi. Prima del ripristino viene scaricato automaticamente un backup dello stato attuale. Gli account e lo storico restano.</p>' +
      '<div class="field"><label for="bk-file">File di backup</label><input id="bk-file" type="file" accept=".json,application/json" data-act-change="bk-file"' + adminOnly() + '></div>' +
      (f.file ? '<div class="form-note">Backup del ' + esc(new Date(f.file.exported_at).toLocaleString('it-IT')) + ' (' + esc(f.file.exported_by || '') + '): ' + f.file.therapists.length + ' fisioterapisti, ' +
        f.file.patients.length + ' pazienti, ' + f.file.cycles.length + ' cicli, ' + f.file.appointments.length + ' appuntamenti.</div>' +
        '<div class="field" style="max-width:320px"><label>Per confermare scrivi RIPRISTINA</label><input type="text" data-bind="bk.confirm" value="' + esc(f.confirm || '') + '"></div>' +
        '<button class="btn danger" data-act="bk-restore"' + adminSave() + '>Ripristina</button>' : '') + FA.errBox(f.error) + '</div>' +
      '<div class="panel"><h3>Svuota pazienti e sedute</h3><p>Cancella <strong>tutti i pazienti e tutte le sedute</strong> per ripartire da zero. Restano fisioterapisti, account, orari, ferie e storico. Prima viene scaricato automaticamente un backup.</p>' +
        '<div class="field" style="max-width:320px"><label>Per confermare scrivi SVUOTA</label><input type="text" data-bind="bk.clear" value="' + esc(f.clear || '') + '"></div>' +
        '<button class="btn danger" data-act="bk-clear"' + adminSave() + '>Svuota pazienti e sedute</button></div>' +
      '<p class="muted small">Procedura completa (anche da riga di comando) nel file ISTRUZIONI-PILOTA.md.</p>';
  }
  FA.actions['bk-clear'] = async () => {
    const f = A.ui.bk || (A.ui.bk = {});
    if ((f.clear || '').trim() !== 'SVUOTA') { FA.toast('Per confermare scrivi SVUOTA.', 'warn'); return; }
    try {
      const data = await FA.rpc('admin_export', {});
      download('fisioagenda-backup-prima-di-svuotare-' + stamp() + '.json', data);
      const r = await FA.save('Archivio dei pazienti svuotato', () => FA.rpc('admin_clear_patients', { p_confirm: 'SVUOTA' }));
      f.clear = ''; FA.toast(r.patients + ' pazienti e ' + r.appointments + ' sedute cancellati. Il backup è stato scaricato.', 'ok'); FA.render();
    } catch (e) { FA.toast(e.message, 'bad'); }
  };
  FA.actions['bk-export'] = async () => {
    try { const data = await FA.rpc('admin_export', {}); download('fisioagenda-backup-' + stamp() + '.json', data); FA.toast('Backup scaricato', 'ok'); }
    catch (e) { FA.toast('Backup non riuscito: ' + e.message, 'bad'); }
  };
  document.addEventListener('change', async ev => {
    if (!ev.target.matches('[data-act-change="bk-file"]')) return;
    const f = A.ui.bk || (A.ui.bk = {});
    f.error = null; f.file = null;
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (obj.format !== 'fisioagenda-pilota') throw new Error('Il file non è un backup di FisioAgenda pilota.');
      f.file = obj;
    } catch (e) { f.error = e.message; }
    FA.render();
  });
  FA.actions['bk-restore'] = async () => {
    const f = A.ui.bk;
    if (f.confirm !== 'RIPRISTINA') { f.error = 'Scrivi RIPRISTINA per confermare.'; FA.render(); return; }
    try {
      const current = await FA.rpc('admin_export', {});
      download('fisioagenda-prima-del-ripristino-' + stamp() + '.json', current);
      const counts = await FA.save('Ripristino', () => FA.rpc('admin_restore', { p: f.file, p_confirm: 'RIPRISTINA' }));
      A.ui.bk = { info: counts };
      FA.render();
    } catch (e) { f.error = e.message; FA.render(); }
  };

  /* ---------------- vista ---------------- */
  const TABS = [['fisio', 'Fisioterapisti'], ['turni', 'Orari'], ['assenze', 'Ferie e assenze'], ['percorsi', 'Percorsi'], ['chiusure', 'Festività e chiusure'], ['utenti', 'Utenti e permessi'], ['backup', 'Backup']];
  FA.actions['cfg-tab'] = el => { A.ui.cfgTab = el.getAttribute('data-t'); FA.render(); };
  FA.views.config = {
    render() {
      const t = A.ui.cfgTab || 'fisio';
      const body = { fisio: therapistsTab, turni: shiftsTab, assenze: absencesTab, percorsi: categoriesTab, chiusure: closuresTab, utenti: usersTab, backup: backupTab }[t]();
      const own = A.me.therapist_id && A.ctx.th.get(A.me.therapist_id);
      return '<h2>Impostazioni</h2>' + (FA.isAdmin() ? '' : FA.isOffice() ? '<div class="form-note">Puoi aggiungere, modificare o togliere fisioterapisti, orari e assenze. Percorsi, festività, utenti e backup: coordinatore e programmatore.</div>'
          : '<div class="form-note">Consultazione. Il tuo orario lo cambi dal tuo tabulato: ' + (own ? '<button class="btn small" data-act="or-open" data-th="' + A.me.therapist_id + '">Il mio orario</button>' : '') + '</div>') +
        '<div class="tabs">' + TABS.filter(([k]) => FA.isAdmin() || (k !== 'utenti' && k !== 'backup')).map(([k, l]) => '<button class="' + (t === k ? 'on' : '') + '" data-act="cfg-tab" data-t="' + k + '">' + esc(l) + '</button>').join('') + '</div>' +
        '<div class="panel">' + body + '</div>';
    }
  };

  /* ---------------- storico ---------------- */
  FA.views.storico = {
    enter() { load(); },
    render() {
      const s = A.ui.log || {};
      const q = (s.q || '').toLowerCase();
      const rows = (s.rows || []).filter(r => !q || (r.summary + ' ' + r.user_name).toLowerCase().includes(q));
      return '<h2>Storico delle modifiche</h2><div class="panel"><div class="row"><input type="text" style="max-width:360px" placeholder="Cerca (nome, paziente, azione…)" data-bind="log.q" data-rerender value="' + esc(s.q || '') + '">' +
        '<button class="btn small" data-act="log-reload">Aggiorna</button><span class="muted small">Ultime ' + (s.rows ? s.rows.length : 0) + ' operazioni. Chi, cosa e quando.</span></div>' +
        (s.error ? FA.errBox(s.error) : '') + '<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Chi</th><th>Cosa</th></tr></thead><tbody>' +
        rows.map(r => '<tr><td class="nowrap small">' + esc(new Date(r.at).toLocaleString('it-IT')) + '</td><td>' + esc(r.user_name) + '</td><td>' + esc(r.summary) + '</td></tr>').join('') +
        '</tbody></table></div></div>';
    }
  };
  async function load() {
    A.ui.log = A.ui.log || {};
    try { A.ui.log.rows = await FA.S.loadAudit(A.sb, 500); A.ui.log.error = null; } catch (e) { A.ui.log.error = e.message; }
    if (A.view === 'storico') FA.render();
  }
  FA.actions['log-reload'] = () => load();
})();
