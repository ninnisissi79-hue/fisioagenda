import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { addDays, CATALOG, participantInputSchema, studyEventInputSchema, studyInputSchema, toCsv, type StudyInput } from '@handlab/shared';
import type { DB, Row } from '../db.ts';
import { all, get, run, tx } from '../db.ts';
import { HttpError, nowIso, parse, requirePatientAccess, requireRole, sendCsv, todayServer } from '../http.ts';
import { accessLevel } from '../http.ts';
import { audit } from '../services.ts';

type Study = StudyInput & { id: string; createdAt: string; updatedAt: string; isDemo: boolean };

function rowToStudy(r: Row): Study {
  return { ...JSON.parse(r.data), id: r.id, code: r.code, createdAt: r.created_at, updatedAt: r.updated_at, isDemo: !!r.is_demo };
}

function requireStudy(db: DB, req: FastifyRequest, sid: string, owner = false): { study: Study; userId: string } {
  const user = requireRole(req, 'therapist');
  const m = get(db, 'SELECT role FROM study_members WHERE study_id = ? AND user_id = ?', sid, user.id);
  if (!m) throw new HttpError(404, 'Studio non trovato');
  if (owner && m.role !== 'owner') throw new HttpError(403, 'Solo il responsabile dello studio può eseguire questa operazione');
  const r = get(db, 'SELECT * FROM studies WHERE id = ?', sid)!;
  return { study: rowToStudy(r), userId: user.id };
}

export function schedule(study: Study, baseline: string) {
  return study.timepoints.map((tp) => {
    const due = addDays(baseline, tp.offsetDays);
    return { code: tp.code, label: tp.label, due, windowStart: addDays(due, -tp.windowBefore), windowEnd: addDays(due, tp.windowAfter) };
  });
}

function participants(db: DB, sid: string, userId: string) {
  // solo partecipanti i cui pazienti sono accessibili all'utente
  return all(db, 'SELECT * FROM study_participants WHERE study_id = ? ORDER BY participant_code', sid).filter((p) => accessLevel(db, userId, p.patient_id));
}

function participantView(db: DB, study: Study, p: Row) {
  const today = todayServer();
  const statuses = new Map(all(db, 'SELECT * FROM study_assessments WHERE participant_id = ?', p.id).map((a) => [a.timepoint_code, a]));
  return {
    id: p.id, participantCode: p.participant_code, patientId: p.patient_id, groupName: p.group_name, baselineDate: p.baseline_date,
    consentObtained: !!p.consent_obtained, consentDate: p.consent_date, consentVersion: p.consent_version, consentNotes: p.consent_notes,
    status: p.status, statusReason: p.status_reason,
    timepoints: schedule(study, p.baseline_date).map((tp) => {
      const a = statuses.get(tp.code);
      const status = a?.status ?? 'planned';
      return { ...tp, status, date: a?.date ?? null, missingReason: a?.missing_reason ?? null, notes: a?.notes ?? '', windowPassed: status === 'planned' && today > tp.windowEnd, inWindow: today >= tp.windowStart && today <= tp.windowEnd };
    }),
  };
}

const metricKeys = (() => {
  const keys = new Set<string>();
  for (const e of CATALOG) for (const m of e.metrics) keys.add(m.key);
  return [...keys];
})();

function matchTimepoint(sched: ReturnType<typeof schedule>, date: string): string {
  return sched.find((t) => date >= t.windowStart && date <= t.windowEnd)?.code ?? '';
}

export function researchRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/studies', async (req) => {
    const user = requireRole(req, 'therapist');
    return all(db, 'SELECT s.*, m.role AS member_role FROM studies s JOIN study_members m ON m.study_id = s.id AND m.user_id = ? ORDER BY s.created_at DESC', user.id)
      .map((r) => ({ ...rowToStudy(r), memberRole: r.member_role, participants: get(db, 'SELECT COUNT(*) AS n FROM study_participants WHERE study_id = ?', r.id)!.n }));
  });

  app.post('/api/studies', async (req) => {
    const user = requireRole(req, 'therapist');
    const s = parse(studyInputSchema, req.body);
    if (get(db, 'SELECT 1 FROM studies WHERE code = ?', s.code)) throw new HttpError(409, 'Codice studio già in uso');
    const codes = s.timepoints.map((t) => t.code);
    if (new Set(codes).size !== codes.length) throw new HttpError(400, 'Codici delle valutazioni duplicati');
    const id = randomUUID(), now = nowIso();
    tx(db, () => {
      run(db, 'INSERT INTO studies (id, code, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, s.code, JSON.stringify(s), user.id, now, now);
      run(db, 'INSERT INTO study_members (study_id, user_id, role, added_at) VALUES (?, ?, ?, ?)', id, user.id, 'owner', now);
    });
    return { id };
  });

  app.get('/api/studies/:sid', async (req) => {
    const { sid } = req.params as { sid: string };
    const { study, userId } = requireStudy(db, req, sid);
    const ps = participants(db, sid, userId).map((p) => participantView(db, study, p));
    const hidden = (get(db, 'SELECT COUNT(*) AS n FROM study_participants WHERE study_id = ?', sid)!.n as number) - ps.length;
    const members = all(db, 'SELECT u.id, u.username, u.display_name AS displayName, m.role FROM study_members m JOIN users u ON u.id = m.user_id WHERE m.study_id = ?', sid);
    const patientCodes = Object.fromEntries(ps.map((p) => [p.patientId, get(db, 'SELECT code FROM patients WHERE id = ?', p.patientId)?.code]));
    return { study, participants: ps, hiddenParticipants: hidden, members, patientCodes };
  });

  app.put('/api/studies/:sid', async (req) => {
    const { sid } = req.params as { sid: string };
    const { study, userId } = requireStudy(db, req, sid, true);
    const body = parse(z.object({ study: studyInputSchema, reason: z.string().min(3).max(500) }), req.body);
    const s = body.study;
    if (s.code !== study.code && get(db, 'SELECT 1 FROM studies WHERE code = ? AND id != ?', s.code, sid)) throw new HttpError(409, 'Codice studio già in uso');
    const { id, createdAt, updatedAt, isDemo, ...old } = study;
    tx(db, () => {
      for (const k of Object.keys(s) as (keyof StudyInput)[]) {
        if (JSON.stringify(old[k]) !== JSON.stringify(s[k])) audit(db, { entity: 'study', entityId: sid, studyId: sid, field: k, oldValue: old[k], newValue: s[k], authorId: userId, reason: body.reason });
      }
      run(db, 'UPDATE studies SET code = ?, data = ?, updated_at = ? WHERE id = ?', s.code, JSON.stringify(s), nowIso(), sid);
    });
    const changedTp = JSON.stringify(old.timepoints) !== JSON.stringify(s.timepoints);
    const changedProto = old.protocolVersion !== s.protocolVersion;
    return { ok: true, warnings: [changedTp ? 'Le valutazioni programmate sono cambiate: verificare le finestre dei partecipanti già inclusi.' : null, changedProto ? 'Versione del protocollo modificata: documentare la modifica.' : null].filter(Boolean) };
  });

  app.post('/api/studies/:sid/members', async (req) => {
    const { sid } = req.params as { sid: string };
    requireStudy(db, req, sid, true);
    const body = parse(z.object({ username: z.string().min(1).max(60), role: z.enum(['owner', 'member']) }), req.body);
    const u = get(db, "SELECT id FROM users WHERE username = ? AND role = 'therapist' AND active = 1", body.username.toLowerCase());
    if (!u) throw new HttpError(404, 'Professionista non trovato');
    run(db, 'INSERT OR REPLACE INTO study_members (study_id, user_id, role, added_at) VALUES (?, ?, ?, ?)', sid, u.id, body.role, nowIso());
    return { ok: true };
  });

  app.post('/api/studies/:sid/participants', async (req) => {
    const { sid } = req.params as { sid: string };
    const { userId } = requireStudy(db, req, sid);
    const p = parse(participantInputSchema, req.body);
    requirePatientAccess(db, req, p.patientId, 'editor');
    const study = rowToStudy(get(db, 'SELECT * FROM studies WHERE id = ?', sid)!);
    if (p.groupName && !study.groups.includes(p.groupName)) throw new HttpError(400, 'Gruppo non previsto dal protocollo');
    if (get(db, 'SELECT 1 FROM study_participants WHERE study_id = ? AND patient_id = ?', sid, p.patientId)) throw new HttpError(409, 'Paziente già incluso nello studio');
    if (get(db, 'SELECT 1 FROM study_participants WHERE study_id = ? AND participant_code = ?', sid, p.participantCode)) throw new HttpError(409, 'Codice partecipante già in uso');
    const id = randomUUID();
    run(db, `INSERT INTO study_participants (id, study_id, patient_id, participant_code, group_name, baseline_date, consent_obtained, consent_date, consent_version, consent_notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sid, p.patientId, p.participantCode, p.groupName, p.baselineDate, p.consentObtained ? 1 : 0, p.consentDate, p.consentVersion, p.consentNotes, nowIso(), userId);
    return { id };
  });

  app.put('/api/studies/:sid/participants/:pid', async (req) => {
    const { sid, pid } = req.params as { sid: string; pid: string };
    const { userId } = requireStudy(db, req, sid);
    const cur = get(db, 'SELECT * FROM study_participants WHERE id = ? AND study_id = ?', pid, sid);
    if (!cur) throw new HttpError(404, 'Partecipante non trovato');
    requirePatientAccess(db, req, cur.patient_id, 'editor');
    const body = parse(z.object({
      groupName: z.string().max(60).nullable(), status: z.enum(['active', 'completed', 'withdrawn']), statusReason: z.string().max(1000).nullable(),
      consentObtained: z.boolean(), consentDate: z.string().nullable(), consentVersion: z.string().max(100), consentNotes: z.string().max(1000), baselineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().min(3).max(500),
    }), req.body);
    if (body.status === 'withdrawn' && !body.statusReason) throw new HttpError(400, 'Indicare il motivo dell\'abbandono');
    const map: Record<string, string> = { groupName: 'group_name', status: 'status', statusReason: 'status_reason', consentObtained: 'consent_obtained', consentDate: 'consent_date', consentVersion: 'consent_version', consentNotes: 'consent_notes', baselineDate: 'baseline_date' };
    tx(db, () => {
      for (const [k, col] of Object.entries(map)) {
        let nv: any = (body as any)[k];
        if (k === 'consentObtained') nv = nv ? 1 : 0;
        if ((cur[col] ?? null) !== (nv ?? null)) {
          audit(db, { entity: 'study_participant', entityId: pid, studyId: sid, patientId: cur.patient_id, field: k, oldValue: cur[col], newValue: nv, authorId: userId, reason: body.reason });
          run(db, `UPDATE study_participants SET ${col} = ? WHERE id = ?`, nv, pid);
        }
      }
    });
    return { ok: true };
  });

  app.put('/api/studies/:sid/participants/:pid/assessments/:code', async (req) => {
    const { sid, pid, code } = req.params as { sid: string; pid: string; code: string };
    const { study, userId } = requireStudy(db, req, sid);
    const p = get(db, 'SELECT * FROM study_participants WHERE id = ? AND study_id = ?', pid, sid);
    if (!p) throw new HttpError(404, 'Partecipante non trovato');
    requirePatientAccess(db, req, p.patient_id, 'editor');
    if (!study.timepoints.some((t) => t.code === code)) throw new HttpError(404, 'Valutazione non prevista');
    const body = parse(z.object({ status: z.enum(['planned', 'completed', 'missed']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), missingReason: z.string().max(500).nullable(), notes: z.string().max(1000), reason: z.string().max(500).optional() }), req.body);
    if (body.status === 'missed' && !body.missingReason) throw new HttpError(400, 'Indicare il motivo del dato mancante');
    if (body.status === 'completed' && !body.date) throw new HttpError(400, 'Indicare la data della valutazione');
    const cur = get(db, 'SELECT * FROM study_assessments WHERE participant_id = ? AND timepoint_code = ?', pid, code);
    tx(db, () => {
      if (cur) {
        if (cur.status !== 'planned' && !body.reason) throw new HttpError(400, 'Indicare il motivo della correzione');
        for (const [k, col] of [['status', 'status'], ['date', 'date'], ['missingReason', 'missing_reason'], ['notes', 'notes']] as const) {
          if ((cur[col] ?? null) !== ((body as any)[k] ?? null)) audit(db, { entity: 'study_assessment', entityId: cur.id, studyId: sid, patientId: p.patient_id, field: k, oldValue: cur[col], newValue: (body as any)[k], authorId: userId, reason: body.reason || 'Aggiornamento stato' });
        }
        run(db, 'UPDATE study_assessments SET status = ?, date = ?, missing_reason = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?', body.status, body.date, body.missingReason, body.notes, userId, nowIso(), cur.id);
      } else {
        run(db, 'INSERT INTO study_assessments (id, participant_id, timepoint_code, status, date, missing_reason, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), pid, code, body.status, body.date, body.missingReason, body.notes, userId, nowIso());
      }
    });
    return { ok: true };
  });

  app.get('/api/studies/:sid/events', async (req) => {
    const { sid } = req.params as { sid: string };
    const { userId } = requireStudy(db, req, sid);
    const ps = participants(db, sid, userId);
    const byId = new Map(ps.map((p) => [p.id, p]));
    const manual = all(db, 'SELECT e.*, u.display_name AS author FROM study_events e JOIN users u ON u.id = e.created_by WHERE e.study_id = ? ORDER BY e.date DESC', sid)
      .filter((e) => byId.has(e.participant_id))
      .map((e) => ({ id: e.id, source: 'manual', participantCode: byId.get(e.participant_id)!.participant_code, date: e.date, kind: e.kind, description: e.description, relatedSessionId: e.related_session_id, author: e.author }));
    // segnalazioni riferite dai partecipanti durante le sessioni (dalla data di inclusione)
    const reported = ps.flatMap((p) => all(db, `SELECT * FROM symptom_reports WHERE patient_id = ? AND local_date >= ? AND (context = 'stop' OR note != '' OR pain IS NOT NULL OR fatigue IS NOT NULL) ORDER BY at DESC`, p.patient_id, p.baseline_date)
      .map((s) => ({ id: s.id, source: 'patient_report', participantCode: p.participant_code, date: s.local_date, kind: s.context === 'stop' ? 'session_stopped' : 'reported', description: [s.pain !== null ? `dolore ${s.pain}/10` : null, s.fatigue !== null ? `affaticamento ${s.fatigue}/10` : null, s.difficulty !== null ? `difficoltà ${s.difficulty}/10` : null, s.note || null].filter(Boolean).join(' · '), relatedSessionId: s.session_id, author: 'paziente' })));
    return [...manual, ...reported].sort((a, b) => (a.date < b.date ? 1 : -1));
  });

  app.post('/api/studies/:sid/events', async (req) => {
    const { sid } = req.params as { sid: string };
    const { userId } = requireStudy(db, req, sid);
    const e = parse(studyEventInputSchema, req.body);
    const p = get(db, 'SELECT * FROM study_participants WHERE id = ? AND study_id = ?', e.participantId, sid);
    if (!p) throw new HttpError(404, 'Partecipante non trovato');
    requirePatientAccess(db, req, p.patient_id, 'editor');
    const id = randomUUID();
    run(db, 'INSERT INTO study_events (id, study_id, participant_id, date, kind, description, related_session_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, sid, e.participantId, e.date, e.kind, e.description, e.relatedSessionId, userId, nowIso());
    return { id };
  });

  // --- Esportazioni di ricerca: nessun identificativo diretto per impostazione predefinita
  function exportData(sid: string, req: FastifyRequest) {
    const { study, userId } = requireStudy(db, req, sid);
    const q = parse(z.object({ includePatientCode: z.enum(['0', '1']).optional() }), req.query);
    const includeCode = q.includePatientCode === '1';
    const ps = participants(db, sid, userId);
    run(db, 'INSERT INTO export_log (id, user_id, scope, options, at) VALUES (?, ?, ?, ?, ?)', randomUUID(), userId, `study:${sid}:${req.url.split('?')[0].split('/').pop()}`, JSON.stringify({ includePatientCode: includeCode }), nowIso());
    return { study, ps, includeCode };
  }

  const baseCols = (includeCode: boolean) => ['study_code', 'protocol_version', 'participant_code', ...(includeCode ? ['patient_code'] : []), 'group'];
  const baseVals = (study: Study, p: Row, includeCode: boolean) => ({
    study_code: study.code, protocol_version: study.protocolVersion, participant_code: p.participant_code, group: p.group_name ?? '',
    ...(includeCode ? { patient_code: get(db, 'SELECT code FROM patients WHERE id = ?', p.patient_id)?.code } : {}),
  });

  app.get('/api/studies/:sid/export/schedule.csv', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const { study, ps, includeCode } = exportData(sid, req);
    const rows = ps.flatMap((p) => participantView(db, study, p).timepoints.map((t) => ({
      ...baseVals(study, p, includeCode), participant_status: p.status, participant_status_reason: p.status_reason ?? '', baseline_date: p.baseline_date,
      timepoint: t.code, planned_date: t.due, window_start: t.windowStart, window_end: t.windowEnd, assessment_status: t.status, assessment_date: t.date ?? '', missing_reason: t.missingReason ?? '',
    })));
    return sendCsv(reply, `${study.code}_schedule.csv`, toCsv(rows, [...baseCols(includeCode), 'participant_status', 'participant_status_reason', 'baseline_date', 'timepoint', 'planned_date', 'window_start', 'window_end', 'assessment_status', 'assessment_date', 'missing_reason']));
  });

  app.get('/api/studies/:sid/export/assessments.csv', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const { study, ps, includeCode } = exportData(sid, req);
    const rows: Record<string, unknown>[] = [];
    for (const p of ps) {
      const sched = schedule(study, p.baseline_date);
      for (const m of all(db, 'SELECT * FROM clinical_measures WHERE patient_id = ? AND deleted_at IS NULL ORDER BY date', p.patient_id)) {
        rows.push({ ...baseVals(study, p, includeCode), record_id: m.id, timepoint: matchTimepoint(sched, m.date), date: m.date, source: 'clinical_measure', origin: 'manual', variable: m.name, category: m.category, side: m.side, value: m.value_status === 'ok' ? m.value : '', value_status: m.value_status, unit: m.unit, instrument: m.instrument, instrument_version: '', exercise_version: '', metrics_version: '', mode: '', validated: 'n/a' });
      }
      for (const qr of all(db, 'SELECT * FROM questionnaire_results WHERE patient_id = ? AND deleted_at IS NULL ORDER BY date', p.patient_id)) {
        rows.push({ ...baseVals(study, p, includeCode), record_id: qr.id, timepoint: matchTimepoint(sched, qr.date), date: qr.date, source: 'questionnaire', origin: 'manual', variable: qr.instrument, category: 'questionnaire', side: 'na', value: qr.value_status === 'ok' ? qr.score : '', value_status: qr.value_status, unit: qr.score_description, instrument: qr.instrument, instrument_version: qr.version, exercise_version: '', metrics_version: '', mode: '', validated: 'inserimento manuale del punteggio' });
      }
      for (const r of all(db, "SELECT * FROM exercise_runs WHERE patient_id = ? AND mode = 'assessment' ORDER BY started_at", p.patient_id)) {
        const d = JSON.parse(r.data);
        for (const [k, v] of Object.entries(d.metrics ?? {})) {
          const status = r.technical_invalid ? 'technical_error' : v === null ? 'missing' : 'ok';
          rows.push({ ...baseVals(study, p, includeCode), record_id: `${r.id}:${k}`, timepoint: matchTimepoint(sched, r.local_date), date: r.local_date, source: 'touchscreen_assessment', origin: 'automatic', variable: `${r.exercise_id}.${k}`, category: 'touchscreen', side: d.hand, value: status === 'ok' ? v : '', value_status: status, unit: unitOf(r.exercise_id, k), instrument: 'Hand Lab (prova sperimentale non validata)', instrument_version: '', exercise_version: r.exercise_version, metrics_version: r.metrics_version, mode: 'assessment', validated: 'no' });
        }
      }
    }
    const cols = [...baseCols(includeCode), 'record_id', 'timepoint', 'date', 'source', 'origin', 'variable', 'category', 'side', 'value', 'value_status', 'unit', 'instrument', 'instrument_version', 'exercise_version', 'metrics_version', 'mode', 'validated'];
    return sendCsv(reply, `${study.code}_assessments.csv`, toCsv(rows, cols));
  });

  app.get('/api/studies/:sid/export/sessions.csv', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const { study, ps, includeCode } = exportData(sid, req);
    const rows: Record<string, unknown>[] = [];
    for (const p of ps) {
      const sched = schedule(study, p.baseline_date);
      const calVersions = new Map(all(db, 'SELECT id, version FROM calibrations WHERE patient_id = ?', p.patient_id).map((c) => [c.id, c.version]));
      for (const r of all(db, 'SELECT r.*, s.status AS session_status FROM exercise_runs r LEFT JOIN training_sessions s ON s.id = r.session_id WHERE r.patient_id = ? AND r.local_date >= ? ORDER BY r.started_at', p.patient_id, p.baseline_date)) {
        const d = JSON.parse(r.data);
        const validity = r.technical_invalid ? 'technically_invalid' : r.status === 'completed' ? 'complete' : r.status === 'started' ? 'incomplete' : 'interrupted';
        const row: Record<string, unknown> = {
          ...baseVals(study, p, includeCode), record_id: r.id, session_id: r.session_id ?? '', session_status: r.session_status ?? '',
          timepoint: matchTimepoint(sched, r.local_date), started_at_utc: r.started_at, ended_at_utc: r.ended_at ?? '', tz: r.tz, local_date: r.local_date,
          exercise_id: r.exercise_id, exercise_version: r.exercise_version, metrics_version: r.metrics_version, mode: r.mode, hand: d.hand, fingers: (d.fingers ?? []).join(''),
          params_json: JSON.stringify(d.params ?? {}), progression_level: d.progression?.level ?? '', program_version: r.program_version ?? '',
          calibration_id: r.calibration_id ?? '', calibration_version: r.calibration_id ? calVersions.get(r.calibration_id) ?? '' : '',
          device_id: r.device_id, browser: d.device?.userAgent ?? '', area_w_px: Math.round(d.area?.w ?? 0), area_h_px: Math.round(d.area?.h ?? 0), dpr: d.device?.dpr ?? '',
          physical_scale_px_per_mm: d.physicalScale?.pxPerMm ?? '', physical_scale_method: d.physicalScale?.method ?? '',
          origin: d.origin ?? 'automatic', run_status: r.status, validity, technical_invalid_reason: r.technical_invalid_reason ?? '', interruption_reason: d.interruptionReason ?? '',
          completion_met: r.completion_met, active_ms: r.active_ms, sets_planned: d.setsPlanned, sets_done: d.setsDone, reps_planned: d.repsPlanned, reps_valid: d.repsValid, attempts: d.attempts,
        };
        const def = CATALOG.find((e) => e.id === r.exercise_id);
        for (const k of metricKeys) {
          const applicable = !!def?.metrics.some((m) => m.key === k);
          const v = d.metrics?.[k];
          if (!applicable) { row[`m_${k}`] = ''; row[`m_${k}_status`] = 'not_applicable'; }
          else if (r.technical_invalid) { row[`m_${k}`] = ''; row[`m_${k}_status`] = 'technical_error'; }
          else if (v === null || v === undefined) { row[`m_${k}`] = ''; row[`m_${k}_status`] = 'missing'; }
          else { row[`m_${k}`] = v; row[`m_${k}_status`] = 'ok'; }
        }
        rows.push(row);
      }
    }
    const cols = [...baseCols(includeCode), 'record_id', 'session_id', 'session_status', 'timepoint', 'started_at_utc', 'ended_at_utc', 'tz', 'local_date', 'exercise_id', 'exercise_version', 'metrics_version', 'mode', 'hand', 'fingers', 'params_json', 'progression_level', 'program_version', 'calibration_id', 'calibration_version', 'device_id', 'browser', 'area_w_px', 'area_h_px', 'dpr', 'physical_scale_px_per_mm', 'physical_scale_method', 'origin', 'run_status', 'validity', 'technical_invalid_reason', 'interruption_reason', 'completion_met', 'active_ms', 'sets_planned', 'sets_done', 'reps_planned', 'reps_valid', 'attempts', ...metricKeys.flatMap((k) => [`m_${k}`, `m_${k}_status`])];
    return sendCsv(reply, `${study.code}_sessions.csv`, toCsv(rows, cols));
  });

  app.get('/api/studies/:sid/export/technical.json', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const { study, ps, includeCode } = exportData(sid, req);
    reply.header('Content-Disposition', `attachment; filename="${study.code}_technical.json"`);
    return {
      format: 'handlab-research-technical', formatVersion: 1, exportedAt: nowIso(),
      notice: 'Dati pseudonimizzati (non anonimi). Prove touchscreen sperimentali e non validate.',
      study: { code: study.code, title: study.title, protocolVersion: study.protocolVersion, timepoints: study.timepoints },
      participants: ps.map((p) => {
        const strip = (o: any) => { const { patientId, ...rest } = o; return rest; };
        return {
          participantCode: p.participant_code, group: p.group_name, baselineDate: p.baseline_date, status: p.status,
          ...(includeCode ? { patientCode: get(db, 'SELECT code FROM patients WHERE id = ?', p.patient_id)?.code } : {}),
          calibrations: all(db, 'SELECT * FROM calibrations WHERE patient_id = ? ORDER BY version', p.patient_id).map((c) => ({ id: c.id, version: c.version, isReference: !!c.is_reference, createdAt: c.created_at, ...JSON.parse(c.data) })),
          sessions: all(db, 'SELECT data FROM training_sessions WHERE patient_id = ? AND local_date >= ?', p.patient_id, p.baseline_date).map((r) => strip(JSON.parse(r.data))),
          runs: all(db, 'SELECT data, technical_invalid, technical_invalid_reason FROM exercise_runs WHERE patient_id = ? AND local_date >= ?', p.patient_id, p.baseline_date).map((r) => ({ ...strip(JSON.parse(r.data)), technicalInvalid: !!r.technical_invalid, technicalInvalidReason: r.technical_invalid_reason })),
        };
      }),
    };
  });

  app.get('/api/studies/:sid/export/dictionary.csv', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const { study } = exportData(sid, req);
    return sendCsv(reply, `${study.code}_dictionary.csv`, toCsv(dataDictionary(), ['file', 'variable', 'description', 'type', 'unit', 'codes']));
  });

  // Sintesi descrittiva (nessuna inferenza)
  app.get('/api/studies/:sid/summary', async (req) => {
    const { sid } = req.params as { sid: string };
    const { study, userId } = requireStudy(db, req, sid);
    const ps = participants(db, sid, userId).map((p) => ({ row: p, view: participantView(db, study, p) }));
    const byGroup: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const p of ps) { byGroup[p.row.group_name ?? '(nessun gruppo)'] = (byGroup[p.row.group_name ?? '(nessun gruppo)'] ?? 0) + 1; byStatus[p.row.status] = (byStatus[p.row.status] ?? 0) + 1; }
    const tps = study.timepoints.map((t) => {
      const sts = ps.map((p) => p.view.timepoints.find((x) => x.code === t.code)!);
      return { code: t.code, planned: sts.filter((s) => s.status === 'planned').length, completed: sts.filter((s) => s.status === 'completed').length, missed: sts.filter((s) => s.status === 'missed').length, windowPassed: sts.filter((s) => s.windowPassed).length };
    });
    // statistiche descrittive delle misure cliniche per valutazione
    const measures: Record<string, number[]> = {};
    for (const p of ps) {
      const sched = schedule(study, p.row.baseline_date);
      for (const m of all(db, "SELECT * FROM clinical_measures WHERE patient_id = ? AND deleted_at IS NULL AND value_status = 'ok'", p.row.patient_id)) {
        const tp = matchTimepoint(sched, m.date);
        if (!tp) continue;
        const k = `${tp}|${m.name}|${m.unit}`;
        (measures[k] ??= []).push(m.value);
      }
    }
    const measureStats = Object.entries(measures).map(([k, vs]) => { const [timepoint, name, unit] = k.split('|'); return { timepoint, name, unit, ...describe(vs) }; });
    return { participants: ps.length, byGroup, byStatus, timepoints: tps, measureStats, notice: 'Sintesi descrittiva: non indica efficacia, significatività clinica o relazioni causali.' };
  });
}

function unitOf(exerciseId: string, key: string): string {
  return CATALOG.find((e) => e.id === exerciseId)?.metrics.find((m) => m.key === key)?.unit ?? '';
}

export function describe(vs: number[]) {
  const n = vs.length;
  const s = [...vs].sort((a, b) => a - b);
  const mean = vs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { n, mean: round(mean), sd: sd === null ? null : round(sd), median: round(median), min: s[0], max: s[n - 1] };
}
const round = (x: number) => Math.round(x * 1000) / 1000;

export function dataDictionary() {
  const rows: Record<string, string>[] = [];
  const add = (file: string, variable: string, description: string, type: string, unit = '', codes = '') => rows.push({ file, variable, description, type, unit, codes });
  const common = (file: string) => {
    add(file, 'study_code', 'Codice dello studio', 'testo');
    add(file, 'protocol_version', 'Versione del protocollo al momento dell\'esportazione', 'testo');
    add(file, 'participant_code', 'Codice partecipante specifico per lo studio (dato pseudonimizzato, non anonimo)', 'testo');
    add(file, 'patient_code', 'Codice paziente interno: presente solo se esplicitamente richiesto in esportazione', 'testo');
    add(file, 'group', 'Gruppo assegnato manualmente (nessuna randomizzazione automatica)', 'testo');
  };
  common('schedule.csv');
  add('schedule.csv', 'participant_status', 'Stato del partecipante', 'codice', '', 'active=attivo; completed=concluso; withdrawn=abbandono');
  add('schedule.csv', 'participant_status_reason', 'Motivo di abbandono o deviazione', 'testo');
  add('schedule.csv', 'baseline_date', 'Data di riferimento (inclusione) da cui si calcolano le finestre', 'data AAAA-MM-GG');
  add('schedule.csv', 'timepoint', 'Codice della valutazione programmata (es. T0, T1)', 'testo');
  add('schedule.csv', 'planned_date', 'Data prevista = baseline + giorni di offset', 'data AAAA-MM-GG');
  add('schedule.csv', 'window_start', 'Inizio finestra temporale', 'data AAAA-MM-GG');
  add('schedule.csv', 'window_end', 'Fine finestra temporale', 'data AAAA-MM-GG');
  add('schedule.csv', 'assessment_status', 'Stato della valutazione', 'codice', '', 'planned=prevista; completed=completata; missed=mancata');
  add('schedule.csv', 'assessment_date', 'Data di esecuzione', 'data AAAA-MM-GG');
  add('schedule.csv', 'missing_reason', 'Motivo del dato mancante', 'testo');
  common('assessments.csv');
  add('assessments.csv', 'record_id', 'Identificativo univoco della rilevazione', 'testo');
  add('assessments.csv', 'timepoint', 'Valutazione programmata la cui finestra contiene la data (vuoto se fuori finestra)', 'testo');
  add('assessments.csv', 'date', 'Data della rilevazione', 'data AAAA-MM-GG');
  add('assessments.csv', 'source', 'Origine', 'codice', '', 'clinical_measure=misura clinica; questionnaire=questionario (punteggio inserito manualmente); touchscreen_assessment=prova touchscreen a condizioni fisse');
  add('assessments.csv', 'origin', 'Modalità di acquisizione', 'codice', '', 'manual=inserito dal professionista; automatic=registrato dall\'app');
  add('assessments.csv', 'variable', 'Nome della misura / strumento / metrica (esercizio.metrica)', 'testo');
  add('assessments.csv', 'side', 'Lato', 'codice', '', 'left=sinistra; right=destra; na=non applicabile');
  add('assessments.csv', 'value', 'Valore numerico; vuoto se mancante o in errore (lo zero è un valore)', 'numero');
  add('assessments.csv', 'value_status', 'Stato del valore', 'codice', '', 'ok=valore presente; missing=dato mancante; technical_error=errore tecnico; not_applicable=non applicabile');
  add('assessments.csv', 'unit', 'Unità di misura (per i questionari: descrizione del punteggio)', 'testo');
  add('assessments.csv', 'instrument', 'Strumento utilizzato', 'testo');
  add('assessments.csv', 'instrument_version', 'Versione dello strumento/questionario', 'testo');
  add('assessments.csv', 'exercise_version', 'Versione dell\'esercizio touchscreen', 'testo');
  add('assessments.csv', 'metrics_version', 'Versione del calcolo delle metriche', 'testo');
  add('assessments.csv', 'validated', 'Le prove touchscreen sono sperimentali e non validate', 'testo');
  common('sessions.csv');
  const s = (v: string, d: string, t: string, u = '', c = '') => add('sessions.csv', v, d, t, u, c);
  s('record_id', 'Identificativo univoco dell\'esecuzione (generato sul dispositivo)', 'testo');
  s('session_id', 'Identificativo della seduta', 'testo');
  s('session_status', 'Stato della seduta', 'codice', '', 'completed; interrupted; in_progress; invalid');
  s('timepoint', 'Valutazione programmata la cui finestra contiene la data', 'testo');
  s('started_at_utc', 'Inizio (UTC, ISO 8601)', 'data-ora'); s('ended_at_utc', 'Fine (UTC, ISO 8601)', 'data-ora');
  s('tz', 'Fuso orario del dispositivo (IANA)', 'testo'); s('local_date', 'Data locale del dispositivo', 'data AAAA-MM-GG');
  s('exercise_id', 'Esercizio', 'codice', '', CATALOG.filter((e) => e.status === 'available').map((e) => `${e.id}=${e.name}`).join('; '));
  s('exercise_version', 'Versione dell\'esercizio', 'testo'); s('metrics_version', 'Versione del calcolo delle metriche', 'testo');
  s('mode', 'Modalità', 'codice', '', 'training=allenamento adattivo; assessment=prova a condizioni fisse');
  s('hand', 'Mano', 'codice', '', 'left; right'); s('fingers', 'Dita assegnate in ordine di ruolo', 'codice', '', 'T=pollice; I=indice; M=medio; R=anulare; L=mignolo');
  s('params_json', 'Parametri effettivamente usati (JSON)', 'testo'); s('progression_level', 'Livello di progressione automatica applicato (vuoto = nessuna)', 'intero');
  s('program_version', 'Versione del programma eseguita', 'intero'); s('calibration_id', 'Taratura utilizzata', 'testo'); s('calibration_version', 'Versione della taratura', 'intero');
  s('device_id', 'Identificativo casuale del dispositivo', 'testo'); s('browser', 'User agent del browser', 'testo');
  s('area_w_px', 'Larghezza area di gioco (pixel CSS)', 'intero', 'px'); s('area_h_px', 'Altezza area di gioco (pixel CSS)', 'intero', 'px'); s('dpr', 'Rapporto pixel del dispositivo', 'numero');
  s('physical_scale_px_per_mm', 'Pixel CSS per mm, solo con calibrazione fisica esplicita', 'numero', 'px/mm'); s('physical_scale_method', 'Metodo della calibrazione fisica', 'testo');
  s('origin', 'Origine del dato', 'codice', '', 'automatic; manual');
  s('run_status', 'Stato registrato', 'codice', '', 'completed=criteri di completamento soddisfatti; interrupted=interrotto; started=iniziato e mai concluso; invalid');
  s('validity', 'Validità', 'codice', '', 'complete; interrupted; incomplete; technically_invalid');
  s('technical_invalid_reason', 'Motivo dell\'invalidazione tecnica', 'testo'); s('interruption_reason', 'Motivo dell\'interruzione', 'testo');
  s('completion_met', 'Criteri espliciti di completamento soddisfatti', 'codice', '', '1=sì; 0=no');
  s('active_ms', 'Tempo attivo escluse pause, riposo e app in secondo piano', 'intero', 'ms');
  s('sets_planned', 'Serie previste', 'intero'); s('sets_done', 'Serie concluse', 'intero'); s('reps_planned', 'Ripetizioni previste', 'intero'); s('reps_valid', 'Ripetizioni valide', 'intero'); s('attempts', 'Tentativi', 'intero');
  for (const k of metricKeys) {
    const defs = CATALOG.flatMap((e) => e.metrics.filter((m) => m.key === k).map((m) => ({ e, m })));
    const m = defs[0].m;
    s(`m_${k}`, `${m.label}: ${m.description} (esercizi: ${defs.map((d) => d.e.id).join(', ')})`, 'numero', m.unit === 'u' ? 'u = frazione del lato corto dell\'area di gioco (non è una misura fisica)' : m.unit === 'ratio' ? 'quota 0–1' : m.unit);
    s(`m_${k}_status`, `Stato di m_${k}`, 'codice', '', 'ok; missing; technical_error; not_applicable');
  }
  return rows;
}
