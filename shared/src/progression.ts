import type { ParamDef } from './catalog.ts';
import type { ProgressionApplied, ProgressionRule, ParamValue } from './types.ts';

export interface ProgressionHistoryRun {
  /** livello usato nell'esecuzione */
  level: number;
  successRate: number | null;
  completed: boolean;
}

/**
 * Progressione automatica facoltativa e trasparente.
 * - Agisce solo sul parametro autorizzato, con il passo e il limite scelti dal fisioterapista.
 * - Il valore non supera mai il limite né l'intervallo del catalogo (l'ampiezza resta ≤ 1 = area approvata).
 * - Sale di un livello quando le ultime `windowRuns` esecuzioni completate al livello corrente hanno
 *   in media una quota di ripetizioni valide ≥ upThreshold; scende (se previsto) quando un'esecuzione
 *   completata è sotto downThreshold.
 * - La storia considerata è quella della versione di programma in vigore: con una nuova versione si riparte dal livello 0.
 */
export function computeProgression(rule: ProgressionRule | null, base: ParamValue, def: ParamDef | undefined, history: ProgressionHistoryRun[]): ProgressionApplied | null {
  if (!rule || !rule.enabled || !def || typeof base !== 'number') return null;
  const maxLevel = maxLevelFor(rule, base, def);
  let level = 0;
  let window: number[] = [];
  let reason = 'Livello iniziale';
  for (const h of history) {
    if (!h.completed || h.successRate === null || h.level !== level) continue;
    if (rule.downThreshold !== null && h.successRate < rule.downThreshold && level > 0) {
      level--; window = []; reason = `Ridotto: quota valida ${(h.successRate * 100).toFixed(0)}% < ${(rule.downThreshold * 100).toFixed(0)}%`;
      continue;
    }
    window.push(h.successRate);
    if (window.length >= rule.windowRuns) {
      const avg = window.reduce((a, b) => a + b, 0) / window.length;
      if (avg >= rule.upThreshold && level < maxLevel) {
        level++; reason = `Aumentato: media ${(avg * 100).toFixed(0)}% ≥ ${(rule.upThreshold * 100).toFixed(0)}% nelle ultime ${rule.windowRuns} esecuzioni`;
      }
      window = [];
    }
  }
  const value = valueAt(rule, base, def, level);
  if (level === maxLevel && level > 0) reason += ' (limite autorizzato raggiunto)';
  return { level, param: rule.param, base, value, reason };
}

export function valueAt(rule: ProgressionRule, base: number, def: ParamDef, level: number): number {
  let v = base + rule.step * level;
  if (rule.step > 0) v = Math.min(v, rule.limit); else v = Math.max(v, rule.limit);
  if (def.max !== undefined) v = Math.min(v, def.max);
  if (def.min !== undefined) v = Math.max(v, def.min);
  if (rule.param === 'amplitude') v = Math.min(v, 1);
  return Math.round(v * 1000) / 1000;
}

export function maxLevelFor(rule: ProgressionRule, base: number, def: ParamDef): number {
  if (rule.step === 0) return 0;
  let lvl = 0;
  while (lvl < 100 && valueAt(rule, base, def, lvl + 1) !== valueAt(rule, base, def, lvl)) lvl++;
  return lvl;
}
