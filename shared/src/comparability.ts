import type { ExerciseRun } from './types.ts';
import { getExercise } from './catalog.ts';

export type RunLiteForCompare = Pick<ExerciseRun, 'exerciseId' | 'exerciseVersion' | 'metricsVersion' | 'mode' | 'params' | 'calibrationId' | 'area' | 'device' | 'fingers' | 'hand'>;

/** parametri che cambiano la difficoltà (esclusi volume e pause) */
export function difficultyParams(r: Pick<ExerciseRun, 'exerciseId' | 'params'>): Record<string, unknown> {
  const def = getExercise(r.exerciseId);
  const out: Record<string, unknown> = {};
  for (const p of def?.params ?? []) if (p.group === 'difficulty') out[p.key] = r.params[p.key];
  return out;
}

/** firma delle condizioni: esecuzioni con firme diverse non sono direttamente equivalenti */
export function conditionSignature(r: RunLiteForCompare): string {
  return JSON.stringify({
    ex: r.exerciseId, v: r.exerciseVersion, mv: r.metricsVersion, mode: r.mode, hand: r.hand, fingers: r.fingers,
    diff: difficultyParams(r), cal: r.calibrationId, dev: r.device?.deviceId ?? null,
    area: r.area ? `${Math.round(r.area.w)}x${Math.round(r.area.h)}` : null,
  });
}

/** differenze che compromettono la confrontabilità tra due esecuzioni */
export function comparabilityIssues(a: RunLiteForCompare, b: RunLiteForCompare): string[] {
  const out: string[] = [];
  if (a.exerciseId !== b.exerciseId) return ['Esercizi diversi'];
  if (a.exerciseVersion !== b.exerciseVersion) out.push(`Versione esercizio diversa (${a.exerciseVersion} / ${b.exerciseVersion})`);
  if (a.metricsVersion !== b.metricsVersion) out.push(`Calcolo delle metriche diverso (${a.metricsVersion} / ${b.metricsVersion})`);
  if (a.mode !== b.mode) out.push('Una è allenamento adattivo, l\'altra prova a condizioni fisse');
  if (a.hand !== b.hand) out.push('Mano diversa');
  if (JSON.stringify(a.fingers) !== JSON.stringify(b.fingers)) out.push('Dita diverse');
  const da = difficultyParams(a), db = difficultyParams(b);
  const diffKeys = Object.keys({ ...da, ...db }).filter((k) => da[k] !== db[k]);
  if (diffKeys.length) out.push(`Difficoltà diversa (${diffKeys.join(', ')})`);
  if (a.calibrationId !== b.calibrationId) out.push('Taratura diversa');
  if ((a.device?.deviceId ?? null) !== (b.device?.deviceId ?? null)) out.push('Tablet diverso');
  else if (a.area && b.area && (Math.abs(a.area.w - b.area.w) > 2 || Math.abs(a.area.h - b.area.h) > 2)) out.push('Dimensioni dell\'area di gioco diverse');
  return out;
}
