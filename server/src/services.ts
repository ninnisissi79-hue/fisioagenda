import { randomUUID } from 'node:crypto';
import { addDays, computeAdherence, effectiveVersionAt, type ProgramVersion, type Calibration } from '@handlab/shared';
import type { DB, Row } from './db.ts';
import { all, get, run } from './db.ts';
import { nowIso, todayServer } from './http.ts';

export function audit(db: DB, a: { entity: string; entityId: string; patientId?: string | null; studyId?: string | null; field: string; oldValue: unknown; newValue: unknown; authorId: string; reason: string }) {
  const s = (v: unknown) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  run(db, 'INSERT INTO corrections (id, entity, entity_id, patient_id, study_id, field, old_value, new_value, author_id, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    randomUUID(), a.entity, a.entityId, a.patientId ?? null, a.studyId ?? null, a.field, s(a.oldValue), s(a.newValue), a.authorId, a.reason, nowIso());
}

export function rowToPatient(r: Row) {
  return {
    id: r.id, code: r.code, ageBand: r.age_band, affectedHand: r.affected_hand, dominantHand: r.dominant_hand,
    condition: r.condition, surgery: r.surgery, surgeryDate: r.surgery_date, phase: r.phase, limitations: r.limitations,
    goals: r.goals, notes: r.notes, isDemo: !!r.is_demo, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function rowToProgram(r: Row): ProgramVersion {
  const d = JSON.parse(r.data);
  return {
    id: r.id, patientId: r.patient_id, version: r.version, effectiveFrom: r.effective_from, createdAt: r.created_at,
    createdBy: r.created_by, createdByName: r.created_by_name ?? undefined, changeNote: r.change_note,
    restBetweenExercisesSec: d.restBetweenExercisesSec ?? 30, items: d.items ?? [],
  };
}

export function rowToCalibration(r: Row): Calibration {
  const d = JSON.parse(r.data);
  return { ...d, id: r.id, patientId: r.patient_id, version: r.version, isReference: !!r.is_reference, createdAt: r.created_at, createdBy: r.created_by, supersedes: r.supersedes };
}

export function programVersions(db: DB, patientId: string): ProgramVersion[] {
  return all(db, `SELECT p.*, u.display_name AS created_by_name FROM program_versions p LEFT JOIN users u ON u.id = p.created_by WHERE p.patient_id = ? ORDER BY p.version`, patientId).map(rowToProgram);
}

export function latestCalibration(db: DB, patientId: string): Calibration | null {
  const r = get(db, 'SELECT * FROM calibrations WHERE patient_id = ? ORDER BY version DESC LIMIT 1', patientId);
  return r ? rowToCalibration(r) : null;
}

/** riepilogo di un'esecuzione senza gli eventi tecnici */
export function rowToRunSummary(r: Row) {
  const d = JSON.parse(r.data);
  delete d.detail;
  return { ...d, id: r.id, status: r.status, technicalInvalid: !!r.technical_invalid, technicalInvalidReason: r.technical_invalid_reason, receivedAt: r.received_at, isDemo: !!r.is_demo };
}

export function rowToRunFull(r: Row) {
  const d = JSON.parse(r.data);
  return { ...d, id: r.id, status: r.status, technicalInvalid: !!r.technical_invalid, technicalInvalidReason: r.technical_invalid_reason, receivedAt: r.received_at, isDemo: !!r.is_demo };
}

export function rowToSession(r: Row) {
  const d = JSON.parse(r.data);
  return { ...d, id: r.id, status: r.status, receivedAt: r.received_at, isDemo: !!r.is_demo };
}

export function rowToSymptom(r: Row) {
  return { id: r.id, patientId: r.patient_id, sessionId: r.session_id, runId: r.run_id, at: r.at, localDate: r.local_date, context: r.context, pain: r.pain, fatigue: r.fatigue, difficulty: r.difficulty, note: r.note, receivedAt: r.received_at, isDemo: !!r.is_demo };
}

/**
 * Ultimo giorno per cui i dati risultano completamente ricevuti: per ogni dispositivo usato negli
 * ultimi 30 giorni, il giorno precedente all'ultima sincronizzazione con coda vuota. Si prende il minimo.
 */
export function confirmedThrough(db: DB, patientId: string): string | null {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const devs = all(db, 'SELECT * FROM device_syncs WHERE patient_id = ? AND last_sync_at > ?', patientId, since);
  if (!devs.length) return null;
  let min: string | null = null;
  for (const d of devs) {
    if (!d.last_empty_client_date) return null;
    const c = addDays(d.last_empty_client_date, -1);
    if (min === null || c < min) min = c;
  }
  return min;
}

export function lastSync(db: DB, patientId: string): string | null {
  return (get(db, 'SELECT MAX(last_sync_at) AS m FROM device_syncs WHERE patient_id = ?', patientId)?.m as string) ?? null;
}

export function runsLite(db: DB, patientId: string, from: string, to: string) {
  return all(db, `SELECT id, program_item_id AS programItemId, exercise_id AS exerciseId, local_date AS localDate,
    CASE WHEN technical_invalid = 1 THEN 'invalid' ELSE status END AS status
    FROM exercise_runs WHERE patient_id = ? AND local_date BETWEEN ? AND ?`, patientId, from, to) as any[];
}

export function adherenceFor(db: DB, patientId: string, from: string, to: string, today = todayServer()) {
  return computeAdherence({ versions: programVersions(db, patientId), runs: runsLite(db, patientId, from, to), from, to, today, confirmedThrough: confirmedThrough(db, patientId) });
}

/** riepilogo per il cruscotto del fisioterapista */
export function patientSummary(db: DB, patientId: string) {
  const today = todayServer();
  const from = addDays(today, -6);
  const versions = programVersions(db, patientId);
  const current = effectiveVersionAt(versions, today);
  const upcoming = versions.filter((v) => v.effectiveFrom > today && (!current || v.version > current.version));
  const adh = computeAdherence({ versions, runs: runsLite(db, patientId, from, today), from, to: today, today, confirmedThrough: confirmedThrough(db, patientId) });
  const sessionsCompleted = get(db, "SELECT COUNT(*) AS n FROM training_sessions WHERE patient_id = ? AND local_date BETWEEN ? AND ? AND status = 'completed'", patientId, from, today)!.n;
  const sessionsInterrupted = get(db, "SELECT COUNT(*) AS n FROM training_sessions WHERE patient_id = ? AND local_date BETWEEN ? AND ? AND status IN ('interrupted','invalid')", patientId, from, today)!.n;
  const lastRun = get(db, 'SELECT started_at, exercise_id, status FROM exercise_runs WHERE patient_id = ? ORDER BY started_at DESC LIMIT 1', patientId);
  const symptoms = all(db, 'SELECT * FROM symptom_reports WHERE patient_id = ? AND local_date BETWEEN ? AND ? ORDER BY at DESC', patientId, from, today).map(rowToSymptom);
  const measures = all(db, 'SELECT name, side, unit, value, value_status, date FROM clinical_measures WHERE patient_id = ? AND deleted_at IS NULL ORDER BY date DESC, created_at DESC', patientId);
  const byName = new Map<string, Row[]>();
  for (const m of measures) { const k = `${m.name}|${m.side}`; if (!byName.has(k)) byName.set(k, []); if (byName.get(k)!.length < 2) byName.get(k)!.push(m); }
  const measureTrends = [...byName.values()].slice(0, 4).map((ms) => ({ name: ms[0].name, side: ms[0].side, unit: ms[0].unit, last: ms[0].value_status === 'ok' ? ms[0].value : null, lastDate: ms[0].date, previous: ms[1] && ms[1].value_status === 'ok' ? ms[1].value : null, previousDate: ms[1]?.date ?? null }));
  const cal = latestCalibration(db, patientId);
  return {
    program: current ? { version: current.version, effectiveFrom: current.effectiveFrom, activeItems: current.items.filter((i) => i.status === 'active').length, suspendedItems: current.items.filter((i) => i.status === 'suspended').length, exercises: current.items.filter((i) => i.status === 'active').map((i) => i.exerciseId) } : null,
    upcomingProgram: upcoming.length ? { version: upcoming[upcoming.length - 1].version, effectiveFrom: upcoming[upcoming.length - 1].effectiveFrom } : null,
    lastActivity: lastRun ? { at: lastRun.started_at, exerciseId: lastRun.exercise_id, status: lastRun.status } : null,
    lastSync: lastSync(db, patientId),
    confirmedThrough: adh.confirmedThrough,
    week: {
      from, to: today,
      sessionsPlanned: adh.sessionsPlanned, sessionsCompleted, sessionsInterrupted,
      prescribed: adh.totals.prescribed, completedWithinPrescription: adh.totals.completedWithinPrescription, adherence: adh.totals.adherence,
      notDone: adh.totals.notDone, pending: adh.totals.pending, interrupted: adh.totals.interrupted,
    },
    symptoms: { count: symptoms.length, maxPain: max(symptoms.map((s) => s.pain)), maxFatigue: max(symptoms.map((s) => s.fatigue)), stops: symptoms.filter((s) => s.context === 'stop').length, latest: symptoms[0] ?? null },
    measureTrends,
    calibration: cal ? { version: cal.version, createdAt: cal.createdAt, isReference: cal.isReference } : null,
  };
}

function max(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
}
