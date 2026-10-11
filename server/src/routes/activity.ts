import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, syncPushSchema, type SyncPush } from '@handlab/shared';
import type { DB } from '../db.ts';
import { all, get, run, tx } from '../db.ts';
import { HttpError, nowIso, parse, requirePatientAccess, requireUser, todayServer } from '../http.ts';
import { adherenceFor, audit, confirmedThrough, programVersions, rowToRunFull, rowToRunSummary, rowToSession, rowToSymptom } from '../services.ts';

const FINAL = (s: string) => s !== 'in_progress' && s !== 'started';

export interface SyncResult { inserted: { sessions: number; runs: number; symptoms: number }; updated: { sessions: number; runs: number }; unchanged: number; serverTime: string }

/**
 * Applica un pacchetto di sincronizzazione in modo idempotente:
 * - ogni elemento ha un identificativo univoco generato sul dispositivo;
 * - un elemento già ricevuto non viene duplicato;
 * - uno stato provvisorio (in corso/iniziato) può essere sostituito da uno definitivo, mai il contrario.
 */
export function applySync(db: DB, patientId: string, userId: string, body: SyncPush): SyncResult {
  const now = nowIso();
  const res: SyncResult = { inserted: { sessions: 0, runs: 0, symptoms: 0 }, updated: { sessions: 0, runs: 0 }, unchanged: 0, serverTime: now };
  tx(db, () => {
    for (const s of body.sessions) {
      const cur = get(db, 'SELECT patient_id, status FROM training_sessions WHERE id = ?', s.id);
      const data = JSON.stringify({ ...s, patientId });
      if (!cur) {
        run(db, `INSERT INTO training_sessions (id, patient_id, program_version_id, program_version, calibration_id, started_at, ended_at, local_date, tz, status, interruption_reason, active_ms, device_id, data, received_at, updated_at, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, s.id, patientId, s.programVersionId, s.programVersion, s.calibrationId, s.startedAt, s.endedAt, s.localDate, s.tz, s.status, s.interruptionReason, Math.round(s.activeMs), s.device.deviceId, data, now, now, userId);
        res.inserted.sessions++;
      } else if (cur.patient_id !== patientId) {
        throw new HttpError(409, 'Identificativo di seduta già usato');
      } else if (!FINAL(cur.status) && (FINAL(s.status) || s.status === cur.status)) {
        run(db, 'UPDATE training_sessions SET ended_at = ?, status = ?, interruption_reason = ?, active_ms = ?, data = ?, updated_at = ? WHERE id = ?', s.endedAt, s.status, s.interruptionReason, Math.round(s.activeMs), data, now, s.id);
        res.updated.sessions++;
      } else res.unchanged++;
    }
    for (const r of body.runs) {
      const cur = get(db, 'SELECT patient_id, status FROM exercise_runs WHERE id = ?', r.id);
      const data = JSON.stringify({ ...r, patientId });
      if (!cur) {
        run(db, `INSERT INTO exercise_runs (id, patient_id, session_id, program_version_id, program_version, program_item_id, exercise_id, exercise_version, metrics_version, mode, status, started_at, ended_at, local_date, tz, active_ms, completion_met, reps_valid, attempts, calibration_id, device_id, data, received_at, updated_at, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, patientId, r.sessionId, r.programVersionId, r.programVersion, r.programItemId, r.exerciseId, r.exerciseVersion, r.metricsVersion, r.mode,
          // "completed" solo se i criteri espliciti risultano soddisfatti
          r.status === 'completed' && !r.completionMet ? 'interrupted' : r.status,
          r.startedAt, r.endedAt, r.localDate, r.tz, Math.round(r.activeMs), r.completionMet ? 1 : 0, r.repsValid, r.attempts, r.calibrationId, r.device.deviceId, data, now, now, userId);
        res.inserted.runs++;
      } else if (cur.patient_id !== patientId) {
        throw new HttpError(409, 'Identificativo di esecuzione già usato');
      } else if (!FINAL(cur.status) && FINAL(r.status)) {
        run(db, 'UPDATE exercise_runs SET status = ?, ended_at = ?, active_ms = ?, completion_met = ?, reps_valid = ?, attempts = ?, data = ?, updated_at = ? WHERE id = ?',
          r.status === 'completed' && !r.completionMet ? 'interrupted' : r.status, r.endedAt, Math.round(r.activeMs), r.completionMet ? 1 : 0, r.repsValid, r.attempts, data, now, r.id);
        res.updated.runs++;
      } else res.unchanged++;
    }
    for (const s of body.symptoms) {
      const cur = get(db, 'SELECT patient_id FROM symptom_reports WHERE id = ?', s.id);
      if (cur) { if (cur.patient_id !== patientId) throw new HttpError(409, 'Identificativo già usato'); res.unchanged++; continue; }
      run(db, `INSERT INTO symptom_reports (id, patient_id, session_id, run_id, at, local_date, context, pain, fatigue, difficulty, note, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, patientId, s.sessionId, s.runId, s.at, s.localDate, s.context, s.pain, s.fatigue, s.difficulty, s.note, now);
      res.inserted.symptoms++;
    }
    for (const c of body.deviceChecks ?? []) {
      run(db, 'INSERT OR IGNORE INTO device_checks (id, user_id, patient_id, at, data) VALUES (?, ?, ?, ?, ?)', c.id, userId, patientId, c.at, JSON.stringify(c));
    }
    const ua = body.sessions[0]?.device.userAgent ?? body.runs[0]?.device.userAgent ?? '';
    const ex = get(db, 'SELECT 1 FROM device_syncs WHERE patient_id = ? AND device_id = ?', patientId, body.deviceId);
    if (!ex) {
      run(db, 'INSERT INTO device_syncs (patient_id, device_id, user_agent, last_sync_at, last_client_date, last_empty_sync_at, last_empty_client_date, tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        patientId, body.deviceId, ua, now, body.clientLocalDate, body.outboxEmptyAfter ? now : null, body.outboxEmptyAfter ? body.clientLocalDate : null, body.tz);
    } else {
      run(db, `UPDATE device_syncs SET last_sync_at = ?, last_client_date = ?, tz = ?, user_agent = CASE WHEN ? != '' THEN ? ELSE user_agent END,
        last_empty_sync_at = CASE WHEN ? THEN ? ELSE last_empty_sync_at END, last_empty_client_date = CASE WHEN ? THEN ? ELSE last_empty_client_date END
        WHERE patient_id = ? AND device_id = ?`, now, body.clientLocalDate, body.tz, ua, ua, body.outboxEmptyAfter ? 1 : 0, now, body.outboxEmptyAfter ? 1 : 0, body.clientLocalDate, patientId, body.deviceId);
    }
  });
  return res;
}

export function activityRoutes(app: FastifyInstance, db: DB) {
  app.post('/api/sync', async (req) => {
    const user = requireUser(req);
    const raw = req.body as Record<string, unknown>;
    const body = parse(syncPushSchema.extend({ patientId: z.string().max(64).optional() }), raw);
    let patientId: string;
    if (user.role === 'patient') {
      if (body.patientId && body.patientId !== user.patientId) throw new HttpError(403, 'Operazione non consentita');
      patientId = user.patientId!;
    } else if (user.role === 'therapist') {
      // valutazioni svolte in ambulatorio con l'account del professionista
      if (!body.patientId) throw new HttpError(400, 'Paziente non indicato');
      requirePatientAccess(db, req, body.patientId, 'editor');
      patientId = body.patientId;
    } else throw new HttpError(403, 'Operazione non consentita');
    return applySync(db, patientId, user.id, body);
  });

  // Attività di un paziente nel periodo (per il fisioterapista; il paziente vede le proprie)
  app.get('/api/patients/:id/activity', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id);
    const q = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    const to = q.to ?? todayServer();
    const from = q.from ?? addDays(to, -13);
    const sessions = all(db, 'SELECT * FROM training_sessions WHERE patient_id = ? AND local_date BETWEEN ? AND ? ORDER BY started_at DESC', id, from, to).map(rowToSession);
    const runs = all(db, 'SELECT * FROM exercise_runs WHERE patient_id = ? AND local_date BETWEEN ? AND ? ORDER BY started_at DESC', id, from, to).map(rowToRunSummary);
    const symptoms = all(db, 'SELECT * FROM symptom_reports WHERE patient_id = ? AND local_date BETWEEN ? AND ? ORDER BY at DESC', id, from, to).map(rowToSymptom);
    const devices = all(db, 'SELECT device_id AS deviceId, user_agent AS userAgent, last_sync_at AS lastSyncAt, last_client_date AS lastClientDate, last_empty_sync_at AS lastEmptySyncAt, tz FROM device_syncs WHERE patient_id = ? ORDER BY last_sync_at DESC', id);
    return { from, to, sessions, runs, symptoms, devices, confirmedThrough: confirmedThrough(db, id), adherence: adherenceFor(db, id, from, to) };
  });

  // Esecuzioni per i grafici dei progressi (senza eventi tecnici)
  app.get('/api/patients/:id/runs', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id);
    const q = parse(z.object({ exerciseId: z.string().max(40).optional() }), req.query);
    const rows = q.exerciseId
      ? all(db, 'SELECT * FROM exercise_runs WHERE patient_id = ? AND exercise_id = ? ORDER BY started_at', id, q.exerciseId)
      : all(db, 'SELECT * FROM exercise_runs WHERE patient_id = ? ORDER BY started_at', id);
    return rows.map(rowToRunSummary);
  });

  app.get('/api/patients/:id/symptoms', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id);
    return all(db, 'SELECT * FROM symptom_reports WHERE patient_id = ? ORDER BY at', id).map(rowToSymptom);
  });

  app.get('/api/runs/:rid', async (req) => {
    const { rid } = req.params as { rid: string };
    const r = get(db, 'SELECT * FROM exercise_runs WHERE id = ?', rid);
    if (!r) throw new HttpError(404, 'Esecuzione non trovata');
    requirePatientAccess(db, req, r.patient_id);
    return rowToRunFull(r);
  });

  // Il professionista può segnare un'esecuzione come tecnicamente non valida (con motivo, tracciato)
  app.post('/api/runs/:rid/validity', async (req) => {
    const { rid } = req.params as { rid: string };
    const r = get(db, 'SELECT * FROM exercise_runs WHERE id = ?', rid);
    if (!r) throw new HttpError(404, 'Esecuzione non trovata');
    const { user } = requirePatientAccess(db, req, r.patient_id, 'editor');
    const body = parse(z.object({ technicalInvalid: z.boolean(), reason: z.string().min(3).max(500) }), req.body);
    tx(db, () => {
      audit(db, { entity: 'exercise_run', entityId: rid, patientId: r.patient_id, field: 'technical_invalid', oldValue: !!r.technical_invalid, newValue: body.technicalInvalid, authorId: user.id, reason: body.reason });
      run(db, 'UPDATE exercise_runs SET technical_invalid = ?, technical_invalid_reason = ? WHERE id = ?', body.technicalInvalid ? 1 : 0, body.technicalInvalid ? body.reason : null, rid);
    });
    return { ok: true };
  });

  // Verifica guidata del touchscreen (anche senza paziente associato)
  app.post('/api/device-checks', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ id: z.string().min(8).max(64), at: z.string(), data: z.record(z.string(), z.unknown()) }), req.body);
    run(db, 'INSERT OR IGNORE INTO device_checks (id, user_id, patient_id, at, data) VALUES (?, ?, ?, ?, ?)', body.id, user.id, user.patientId, body.at, JSON.stringify(body.data));
    return { ok: true };
  });

  // Copia completa dei dati di un paziente (backup/trasferimento) e reimportazione senza duplicati
  app.get('/api/patients/:id/backup', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    run(db, 'INSERT INTO export_log (id, user_id, scope, options, at) VALUES (?, ?, ?, ?, ?)', randomUUID(), user.id, `patient-backup:${id}`, '{}', nowIso());
    const sessions = all(db, 'SELECT data FROM training_sessions WHERE patient_id = ?', id).map((r) => JSON.parse(r.data));
    const runs = all(db, 'SELECT data FROM exercise_runs WHERE patient_id = ?', id).map((r) => JSON.parse(r.data));
    const symptoms = all(db, 'SELECT * FROM symptom_reports WHERE patient_id = ?', id).map(rowToSymptom);
    reply.header('Content-Disposition', `attachment; filename="handlab-backup-${id.slice(0, 8)}.json"`);
    return {
      format: 'handlab-patient-backup', formatVersion: 1, exportedAt: nowIso(), patientId: id,
      warning: 'Contiene dati del paziente in forma pseudonimizzata (codice). Conservare in modo sicuro.',
      programVersions: programVersions(db, id),
      calibrations: all(db, 'SELECT * FROM calibrations WHERE patient_id = ?', id).map((r) => ({ id: r.id, version: r.version, isReference: !!r.is_reference, data: JSON.parse(r.data), createdAt: r.created_at, createdBy: r.created_by, supersedes: r.supersedes })),
      sessions, runs, symptoms,
    };
  });

  app.post('/api/patients/:id/backup/import', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const body = req.body as any;
    if (body?.format !== 'handlab-patient-backup' || body.formatVersion !== 1) throw new HttpError(400, 'File non riconosciuto');
    if (body.patientId !== id) throw new HttpError(400, 'Il file appartiene a un altro paziente');
    const strip = (x: any) => { const { receivedAt, isDemo, technicalInvalid, technicalInvalidReason, patientId, ...rest } = x; return rest; };
    const push = parse(syncPushSchema, {
      deviceId: 'import', clientLocalDate: todayServer(), tz: 'UTC', outboxEmptyAfter: false,
      sessions: (body.sessions ?? []).map(strip), runs: (body.runs ?? []).map(strip),
      symptoms: (body.symptoms ?? []).map((s: any) => ({ id: s.id, sessionId: s.sessionId, runId: s.runId, at: s.at, localDate: s.localDate, context: s.context, pain: s.pain, fatigue: s.fatigue, difficulty: s.difficulty, note: s.note })),
    });
    const res = applySync(db, id, user.id, push);
    run(db, "DELETE FROM device_syncs WHERE patient_id = ? AND device_id = 'import'", id);
    let calInserted = 0, progInserted = 0;
    tx(db, () => {
      for (const c of body.calibrations ?? []) {
        if (get(db, 'SELECT 1 FROM calibrations WHERE id = ?', c.id)) continue;
        if (get(db, 'SELECT 1 FROM calibrations WHERE patient_id = ? AND version = ?', id, c.version)) continue;
        run(db, 'INSERT INTO calibrations (id, patient_id, version, is_reference, data, created_at, created_by, supersedes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', c.id, id, c.version, c.isReference ? 1 : 0, JSON.stringify(c.data), c.createdAt, c.createdBy, c.supersedes);
        calInserted++;
      }
      for (const v of body.programVersions ?? []) {
        if (get(db, 'SELECT 1 FROM program_versions WHERE id = ?', v.id)) continue;
        if (get(db, 'SELECT 1 FROM program_versions WHERE patient_id = ? AND version = ?', id, v.version)) continue;
        run(db, 'INSERT INTO program_versions (id, patient_id, version, effective_from, data, change_note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', v.id, id, v.version, v.effectiveFrom, JSON.stringify({ items: v.items, restBetweenExercisesSec: v.restBetweenExercisesSec }), v.changeNote, v.createdAt, v.createdBy);
        progInserted++;
      }
    });
    return { ...res, calibrationsInserted: calInserted, programVersionsInserted: progInserted };
  });
}
