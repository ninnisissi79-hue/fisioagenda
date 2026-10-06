/*
 * FisioAgenda pilota — accesso all'archivio centrale (Supabase).
 * Lettura dei dati e chiamata delle operazioni del server. Nessun dato
 * viene considerato salvato finché il server non ha risposto con successo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FAStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABLES = ['categories', 'therapists', 'therapist_skills', 'shift_versions', 'shift_templates', 'day_overrides', 'closures',
    'absences', 'patients', 'cycles', 'appointments', 'profiles', 'import_batches', 'patient_events'];
  const PAGE = 1000;
  // tabelle aggiunte con l'aggiornamento del database: se mancano l'app funziona lo stesso (senza importazione)
  const OPTIONAL = new Set(['import_batches', 'patient_events']);

  async function fetchAll(sb, table, build) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select('*');
      if (build) q = build(q);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw toError(error);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  /** Carica tutti i dati necessari. Gli appuntamenti da `sinceDay` in avanti. */
  async function loadAll(sb, sinceDay) {
    const out = {};
    out.missing = [];
    await Promise.all(TABLES.map(async t => {
      out[t] = await fetchAll(sb, t, q => {
        if (t === 'appointments') return q.gte('day', sinceDay).order('id');
        if (t === 'therapist_skills') return q.order('therapist_id').order('category_id');
        if (t === 'day_overrides') return q.order('therapist_id').order('day');
        if (t === 'closures') return q.order('day');
        if (t === 'shift_templates') return q.order('name');
        if (t === 'profiles') return q.order('user_id');
        if (t === 'patient_events') return q.gte('day', sinceDay).order('id');
        return q.order('id');
      }).catch(e => {
        if (!OPTIONAL.has(t)) throw e;
        out.missing.push(t);
        return [];
      });
    }));
    return out;
  }

  async function loadAudit(sb, limit) {
    const { data, error } = await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit || 200);
    if (error) throw toError(error);
    return data;
  }

  /** Errore leggibile in italiano, con il tipo (permessi, conflitto, posto, rete…). */
  function toError(e) {
    if (!e) return null;
    const err = new Error(e.message || String(e));
    const hint = e.hint || '';
    if (/^FA_/.test(hint)) err.kind = hint;
    else if (e.code === '42501') err.kind = 'FA_PERM';
    else if (e.code === '23P01') { err.kind = 'FA_SLOT'; err.message = 'Il posto è stato appena occupato da un altro utente.'; }
    else if (/Failed to fetch|NetworkError|network|fetch failed|Load failed/i.test(err.message)) {
      err.kind = 'FA_NET';
      err.message = 'Connessione assente o server non raggiungibile: la modifica NON è stata salvata.';
    } else if (e.code === 'PGRST301' || /JWT/i.test(err.message)) {
      err.kind = 'FA_AUTH'; err.message = 'Sessione scaduta: accedi di nuovo. La modifica non è stata salvata.';
    } else err.kind = 'FA_ERR';
    if (err.kind === 'FA_PERM' && /permission denied/i.test(err.message)) err.message = 'Permesso negato: il tuo profilo non consente questa modifica.';
    return err;
  }

  /** Chiama un'operazione del server. Restituisce i dati oppure lancia un errore leggibile. */
  async function rpc(sb, name, args) {
    let res;
    try { res = await sb.rpc(name, args || {}); }
    catch (e) { throw toError(e); }
    if (res.error) throw toError(res.error);
    return res.data;
  }

  return { TABLES, loadAll, loadAudit, rpc, toError, fetchAll };
});
