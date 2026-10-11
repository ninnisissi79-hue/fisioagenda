import type { ExerciseRun, ProgramItem, ProgramVersion } from './types.ts';
import { effectiveVersionAt, itemPrescribedOn } from './program.ts';
import { dayRange } from './dates.ts';

export type CellState =
  | 'not_prescribed'  // non previsto e non eseguito
  | 'future'          // giorno futuro
  | 'due'             // oggi, ancora da fare
  | 'completed'       // eseguito quanto prescritto
  | 'partial'         // completato in parte
  | 'interrupted'     // solo esecuzioni iniziate/interrotte
  | 'not_done'        // nessuna esecuzione, dati confermati come ricevuti
  | 'pending_sync'    // nessuna attività ricevuta: potrebbero esserci dati da sincronizzare
  | 'extra';          // eseguito senza prescrizione

export interface Cell { date: string; itemId: string; prescribed: number; completed: number; started: number; interrupted: number; state: CellState }

export interface ItemSummary {
  itemId: string; exerciseId: string;
  prescribed: number;
  /** completamenti conteggiati entro il prescritto di ogni giorno */
  completedWithinPrescription: number;
  completedTotal: number;
  started: number; interrupted: number;
  notDone: number; pending: number;
  /** completedWithinPrescription / prescribed (null se nulla di prescritto) */
  adherence: number | null;
}

export interface AdherenceReport {
  from: string; to: string; today: string; confirmedThrough: string | null;
  days: string[];
  items: ItemSummary[];
  cells: Cell[];
  sessionsPlanned: number;
  totals: { prescribed: number; completedWithinPrescription: number; adherence: number | null; notDone: number; pending: number; interrupted: number };
}

type RunLite = Pick<ExerciseRun, 'programItemId' | 'exerciseId' | 'localDate' | 'status'>;

/**
 * Confronto tra prescritto ed eseguito.
 * - Un'esecuzione conta come completata solo se lo stato è "completed" (criteri soddisfatti).
 * - L'apertura di un esercizio non genera alcuna esecuzione.
 * - Un giorno passato senza esecuzioni è "non effettuato" solo se i dati di quel giorno risultano
 *   sincronizzati (confirmedThrough ≥ giorno); altrimenti è "nessuna attività ricevuta".
 */
export function computeAdherence(input: { versions: ProgramVersion[]; runs: RunLite[]; from: string; to: string; today: string; confirmedThrough: string | null }): AdherenceReport {
  const { versions, runs, from, to, today, confirmedThrough } = input;
  const days = dayRange(from, to);
  const runIndex = new Map<string, RunLite[]>();
  for (const r of runs) {
    if (!r.programItemId) continue;
    const k = `${r.localDate}|${r.programItemId}`;
    if (!runIndex.has(k)) runIndex.set(k, []);
    runIndex.get(k)!.push(r);
  }
  const itemMeta = new Map<string, ProgramItem>();
  const order: string[] = [];
  const cells: Cell[] = [];
  let sessionsPlanned = 0;
  for (const date of days) {
    const v = effectiveVersionAt(versions, date);
    const items = v?.items ?? [];
    let maxTimes = 0;
    const seen = new Set<string>();
    for (const it of items) {
      if (!itemMeta.has(it.itemId)) order.push(it.itemId);
      itemMeta.set(it.itemId, it);
      seen.add(it.itemId);
      const prescribed = itemPrescribedOn(it, date);
      maxTimes = Math.max(maxTimes, prescribed);
      cells.push(makeCell(date, it.itemId, prescribed, runIndex.get(`${date}|${it.itemId}`) ?? [], today, confirmedThrough));
    }
    // esecuzioni di elementi non presenti nella versione in vigore (es. sessione iniziata con una versione precedente)
    for (const [k, rs] of runIndex) {
      const [d, itemId] = k.split('|');
      if (d !== date || seen.has(itemId)) continue;
      if (!itemMeta.has(itemId)) { order.push(itemId); itemMeta.set(itemId, { itemId, exerciseId: rs[0].exerciseId } as ProgramItem); }
      cells.push(makeCell(date, itemId, 0, rs, today, confirmedThrough));
    }
    if (date <= today) sessionsPlanned += maxTimes;
  }
  const items: ItemSummary[] = order.map((itemId) => {
    const cs = cells.filter((c) => c.itemId === itemId && c.date <= today);
    const prescribed = sum(cs.map((c) => c.prescribed));
    const within = sum(cs.map((c) => Math.min(c.completed, c.prescribed)));
    return {
      itemId, exerciseId: itemMeta.get(itemId)!.exerciseId,
      prescribed, completedWithinPrescription: within,
      completedTotal: sum(cs.map((c) => c.completed)),
      started: sum(cs.map((c) => c.started)), interrupted: sum(cs.map((c) => c.interrupted)),
      notDone: cs.filter((c) => c.state === 'not_done').length,
      pending: cs.filter((c) => c.state === 'pending_sync').length,
      adherence: prescribed ? within / prescribed : null,
    };
  });
  const prescribed = sum(items.map((i) => i.prescribed));
  const within = sum(items.map((i) => i.completedWithinPrescription));
  return {
    from, to, today, confirmedThrough, days, items, cells, sessionsPlanned,
    totals: {
      prescribed, completedWithinPrescription: within, adherence: prescribed ? within / prescribed : null,
      notDone: sum(items.map((i) => i.notDone)), pending: sum(items.map((i) => i.pending)), interrupted: sum(items.map((i) => i.interrupted)),
    },
  };
}

function makeCell(date: string, itemId: string, prescribed: number, rs: RunLite[], today: string, confirmedThrough: string | null): Cell {
  const completed = rs.filter((r) => r.status === 'completed').length;
  const started = rs.filter((r) => r.status === 'started').length;
  const interrupted = rs.filter((r) => r.status === 'interrupted' || r.status === 'invalid').length;
  let state: CellState;
  if (date > today) state = rs.length ? 'extra' : prescribed ? 'future' : 'not_prescribed';
  else if (prescribed === 0) state = completed + started + interrupted > 0 ? 'extra' : 'not_prescribed';
  else if (completed >= prescribed) state = 'completed';
  else if (completed > 0) state = 'partial';
  else if (started + interrupted > 0) state = 'interrupted';
  else if (date === today) state = 'due';
  else if (confirmedThrough && date <= confirmedThrough) state = 'not_done';
  else state = 'pending_sync';
  return { date, itemId, prescribed, completed, started, interrupted, state };
}

function sum(xs: number[]): number { return xs.reduce((a, b) => a + b, 0); }

export const CELL_LABELS: Record<CellState, string> = {
  not_prescribed: 'Non previsto',
  future: 'Previsto',
  due: 'Da fare oggi',
  completed: 'Completato',
  partial: 'Completato in parte',
  interrupted: 'Iniziato/interrotto',
  not_done: 'Non effettuato',
  pending_sync: 'Nessuna attività ricevuta',
  extra: 'Eseguito (non previsto)',
};
