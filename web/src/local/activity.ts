import type { ExerciseRun, SymptomReport, TrainingSession } from '@handlab/shared';
import { kvDel, kvGet, kvSet, outboxPut } from './idb';
import { enqueue } from './sync';

/**
 * Stato dell'attività in corso, salvato periodicamente: se l'app viene chiusa durante un
 * esercizio, alla riapertura la seduta e l'esercizio vengono registrati come interrotti.
 */
const ACTIVE = (uid: string) => `active:${uid}`;

interface ActiveState { session: TrainingSession | null; run: ExerciseRun | null; patientId: string | null; savedAt: string }

export async function saveActive(uid: string, s: Omit<ActiveState, 'savedAt'>) {
  await kvSet(ACTIVE(uid), { ...s, savedAt: new Date().toISOString() });
}

export async function clearActive(uid: string) { await kvDel(ACTIVE(uid)); }

export async function recoverInterrupted(uid: string) {
  const st = await kvGet<ActiveState>(ACTIVE(uid));
  if (!st) return;
  const pid = st.patientId;
  if (st.run && st.run.status === 'started') {
    await enqueueAs(uid, 'run', { ...st.run, status: 'interrupted', interruptionReason: 'app_closed', endedAt: st.savedAt, completionMet: false }, pid);
  }
  if (st.session && st.session.status === 'in_progress') {
    await enqueueAs(uid, 'session', { ...st.session, status: 'interrupted', interruptionReason: 'app_closed', endedAt: st.savedAt }, pid);
  }
  await clearActive(uid);
}

async function enqueueAs(_uid: string, kind: 'run' | 'session', payload: any, pid: string | null) {
  await outboxPut({ kind, id: payload.id, userId: _uid, patientId: pid, payload });
}

export async function recordRun(run: ExerciseRun, patientId: string | null) { await enqueue('run', run.id, stripRun(run), patientId); }
export async function recordSession(s: TrainingSession, patientId: string | null) { await enqueue('session', s.id, stripSession(s), patientId); }
export async function recordSymptom(s: SymptomReport, patientId: string | null) { await enqueue('symptom', s.id, stripSymptom(s), patientId); }

function stripRun(r: ExerciseRun) { const { patientId, isDemo, ...rest } = r as any; return rest; }
function stripSession(s: TrainingSession) { const { patientId, isDemo, ...rest } = s as any; return rest; }
function stripSymptom(s: SymptomReport) { const { patientId, isDemo, ...rest } = s as any; return rest; }
