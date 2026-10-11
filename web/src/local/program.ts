import { computeProgression, getExercise, itemPrescribedOn, localDay, type Calibration, type ProgramItem, type ProgramVersion, type ProgressionApplied, type Params } from '@handlab/shared';
import { GET, OfflineError } from '../api';
import { kvGet, kvSet, outboxAll } from './idb';

export interface MyProgram {
  patient: { code: string; affectedHand: string };
  date: string;
  current: ProgramVersion | null;
  upcoming: ProgramVersion[];
  calibration: Calibration | null;
  progressionHistory: { itemId: string; level: number; successRate: number | null; completed: boolean; startedAt: string }[];
  todayRuns: { id: string; itemId: string; status: string }[];
  serverTime: string;
  fetchedAt: string;
  fromCache?: boolean;
}

/** Programma del paziente: dal server se raggiungibile, altrimenti dalla copia sul dispositivo. */
export async function loadMyProgram(userId: string): Promise<MyProgram | null> {
  const date = localDay();
  try {
    const p = await GET<Omit<MyProgram, 'fetchedAt'>>(`/api/me/program?date=${date}`);
    const full = { ...p, fetchedAt: new Date().toISOString() };
    await kvSet(`program:${userId}`, full);
    return full;
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    const cached = await kvGet<MyProgram>(`program:${userId}`);
    if (!cached) return null;
    // se nel frattempo è iniziata una versione futura già scaricata, si usa quella
    const all = [cached.current, ...cached.upcoming].filter(Boolean) as ProgramVersion[];
    const eff = all.filter((v) => v.effectiveFrom <= date).sort((a, b) => b.version - a.version)[0] ?? null;
    return { ...cached, current: eff, upcoming: all.filter((v) => v.effectiveFrom > date), todayRuns: cached.date === date ? cached.todayRuns : [], fromCache: true };
  }
}

/** esecuzioni locali non ancora inviate */
export async function localRuns(userId: string) {
  return (await outboxAll()).filter((i) => i.userId === userId && i.kind === 'run').map((i) => i.payload);
}

export interface TodayItem { item: ProgramItem; prescribed: number; completed: number; started: number; remaining: number }

export function todayItems(p: MyProgram, local: any[]): TodayItem[] {
  if (!p.current) return [];
  const date = localDay();
  // le esecuzioni locali possono essere già state ricevute dal server: si conta una volta per identificativo
  const localToday = local.filter((r) => r.localDate === date).map((r) => ({ id: r.id as string, itemId: r.programItemId as string, status: r.status as string }));
  const runs = [...localToday, ...p.todayRuns];
  return p.current.items.filter((i) => i.status === 'active').map((item) => {
    const prescribed = itemPrescribedOn(item, date);
    const mine = dedupe(runs.filter((r) => r.itemId === item.itemId));
    const completed = mine.filter((r) => r.status === 'completed').length;
    const started = mine.filter((r) => r.status !== 'completed').length;
    return { item, prescribed, completed, started, remaining: Math.max(0, prescribed - completed) };
  });
}

function dedupe<T extends { id?: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => { if (!x.id) return true; if (seen.has(x.id)) return false; seen.add(x.id); return true; });
}

/** parametri effettivi con l'eventuale progressione automatica (limitata dal fisioterapista) */
export function effectiveParams(item: ProgramItem, p: MyProgram, local: any[]): { params: Params; progression: ProgressionApplied | null } {
  const def = getExercise(item.exerciseId);
  if (!item.progression?.enabled || !def) return { params: item.params, progression: null };
  const pd = def.params.find((x) => x.key === item.progression!.param);
  const hist = [
    ...p.progressionHistory.filter((h) => h.itemId === item.itemId),
    ...local.filter((r) => r.programItemId === item.itemId && r.programVersionId === p.current?.id && r.status !== 'started')
      .map((r) => ({ itemId: r.programItemId, level: r.progression?.level ?? 0, successRate: r.metrics?.successRate ?? null, completed: r.status === 'completed', startedAt: r.startedAt })),
  ].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const uniq = hist.filter((h, i) => i === 0 || h.startedAt !== hist[i - 1].startedAt);
  const prog = computeProgression(item.progression, item.params[item.progression.param] ?? pd?.default ?? 0, pd, uniq);
  if (!prog) return { params: item.params, progression: null };
  return { params: { ...item.params, [prog.param]: prog.value }, progression: prog };
}
