import type { ProgramItem, ProgramVersion } from './types.ts';
import { getExercise, normalizeParams, validateFingers } from './catalog.ts';
import { weekday } from './dates.ts';

/** Versione del programma in vigore in una data: la versione più recente (numero più alto) con decorrenza ≤ data. */
export function effectiveVersionAt<T extends Pick<ProgramVersion, 'version' | 'effectiveFrom'>>(versions: T[], date: string): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!best || v.version > best.version)) best = v;
  }
  return best;
}

export function itemPrescribedOn(item: ProgramItem, date: string): number {
  if (item.status !== 'active') return 0;
  if (!item.frequency.days.includes(weekday(date))) return 0;
  return Math.max(0, Math.round(item.frequency.timesPerDay));
}

export function validateProgramItems(items: ProgramItem[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  items.forEach((it, i) => {
    const label = `Esercizio ${i + 1}`;
    if (ids.has(it.itemId)) errors.push(`${label}: identificativo duplicato`);
    ids.add(it.itemId);
    const def = getExercise(it.exerciseId);
    if (!def) { errors.push(`${label}: esercizio sconosciuto`); return; }
    if (def.status !== 'available') errors.push(`${label}: "${def.name}" non è ancora disponibile`);
    const fe = validateFingers(def, it.fingers);
    if (fe) errors.push(`${label} (${def.name}): ${fe}`);
    const { errors: pe } = normalizeParams(def, it.params);
    pe.forEach((e) => errors.push(`${label} (${def.name}): ${e}`));
    if (!it.frequency.days.length && it.status === 'active') errors.push(`${label} (${def.name}): indicare almeno un giorno`);
    if (it.frequency.timesPerDay < 1 || it.frequency.timesPerDay > 6) errors.push(`${label} (${def.name}): volte al giorno tra 1 e 6`);
    if (it.progression?.enabled) {
      const pr = it.progression;
      const pd = def.params.find((p) => p.key === pr.param);
      if (!pd || !pd.progressable) errors.push(`${label} (${def.name}): parametro non ammesso per la progressione`);
      else {
        const base = Number(it.params[pr.param] ?? pd.default);
        if (pr.step === 0) errors.push(`${label}: il passo di progressione non può essere 0`);
        if (pr.step > 0 && pr.limit < base) errors.push(`${label}: il limite deve essere ≥ valore iniziale`);
        if (pr.step < 0 && pr.limit > base) errors.push(`${label}: il limite deve essere ≤ valore iniziale`);
        if ((pd.min !== undefined && pr.limit < pd.min) || (pd.max !== undefined && pr.limit > pd.max)) errors.push(`${label}: limite fuori dall'intervallo ammesso (${pd.min}–${pd.max})`);
        if (pr.windowRuns < 1 || pr.windowRuns > 20) errors.push(`${label}: esecuzioni valutate tra 1 e 20`);
        if (pr.upThreshold <= 0 || pr.upThreshold > 1) errors.push(`${label}: soglia di avanzamento tra 0 e 1`);
      }
    }
  });
  return errors;
}

export interface ItemChange { itemId: string; exerciseId: string; kind: 'added' | 'removed' | 'suspended' | 'reactivated' | 'modified'; fields: string[] }

/** differenze tra due versioni del programma, per lo storico */
export function diffVersions(prev: ProgramVersion | null, next: ProgramVersion): ItemChange[] {
  const out: ItemChange[] = [];
  const prevMap = new Map((prev?.items ?? []).map((i) => [i.itemId, i]));
  const nextMap = new Map(next.items.map((i) => [i.itemId, i]));
  for (const it of next.items) {
    const p = prevMap.get(it.itemId);
    if (!p) { out.push({ itemId: it.itemId, exerciseId: it.exerciseId, kind: 'added', fields: [] }); continue; }
    if (p.status !== it.status) { out.push({ itemId: it.itemId, exerciseId: it.exerciseId, kind: it.status === 'suspended' ? 'suspended' : 'reactivated', fields: [] }); continue; }
    const fields: string[] = [];
    if (JSON.stringify(p.fingers) !== JSON.stringify(it.fingers)) fields.push('dita');
    if (p.hand !== it.hand) fields.push('mano');
    if (p.mode !== it.mode) fields.push('modalità');
    if (JSON.stringify(p.frequency) !== JSON.stringify(it.frequency)) fields.push('frequenza');
    if (JSON.stringify(p.progression) !== JSON.stringify(it.progression)) fields.push('progressione');
    const keys = new Set([...Object.keys(p.params), ...Object.keys(it.params)]);
    for (const k of keys) if (p.params[k] !== it.params[k]) fields.push(k);
    if (fields.length) out.push({ itemId: it.itemId, exerciseId: it.exerciseId, kind: 'modified', fields });
  }
  for (const p of prev?.items ?? []) if (!nextMap.has(p.itemId)) out.push({ itemId: p.itemId, exerciseId: p.exerciseId, kind: 'removed', fields: [] });
  return out;
}
