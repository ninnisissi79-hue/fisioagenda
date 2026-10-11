import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { measureSchema, noteSchema, patientInputSchema, questionnaireSchema } from '@handlab/shared';
import type { DB } from '../db.ts';
import { all, get, run, tx } from '../db.ts';
import { HttpError, nowIso, parse, requirePatientAccess, requireRole, requireUser } from '../http.ts';
import { createUser, hashPassword, passwordProblem } from '../auth.ts';
import { audit, patientSummary, rowToPatient } from '../services.ts';

const FIELD_MAP: Record<string, string> = {
  code: 'code', ageBand: 'age_band', affectedHand: 'affected_hand', dominantHand: 'dominant_hand', condition: 'condition',
  surgery: 'surgery', surgeryDate: 'surgery_date', phase: 'phase', limitations: 'limitations', goals: 'goals', notes: 'notes',
};

export function patientRoutes(app: FastifyInstance, db: DB) {
  // Cruscotto: pazienti assegnati con riepilogo
  app.get('/api/patients', async (req) => {
    const user = requireRole(req, 'therapist');
    const rows = all(db, `SELECT p.*, MAX(CASE a.level WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END) AS lvl
      FROM patients p JOIN patient_access a ON a.patient_id = p.id AND a.user_id = ? AND a.revoked_at IS NULL
      WHERE p.archived = 0 GROUP BY p.id ORDER BY p.code`, user.id);
    return rows.map((r) => ({ ...rowToPatient(r), accessLevel: ['', 'viewer', 'editor', 'owner'][r.lvl], summary: patientSummary(db, r.id) }));
  });

  app.post('/api/patients', async (req) => {
    const user = requireRole(req, 'therapist');
    const body = z.object({ patient: patientInputSchema, account: z.object({ username: z.string().min(3).max(60).regex(/^[a-z0-9._-]+$/i), password: z.string() }).nullable().optional() }).safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Dati non validi: ' + body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const p = body.data.patient;
    if (get(db, 'SELECT 1 FROM patients WHERE code = ?', p.code)) throw new HttpError(409, 'Codice paziente già in uso');
    const acc = body.data.account;
    if (acc) {
      const prob = passwordProblem(acc.password);
      if (prob) throw new HttpError(400, prob);
      if (get(db, 'SELECT 1 FROM users WHERE username = ?', acc.username.toLowerCase())) throw new HttpError(409, 'Nome utente già in uso');
    }
    const id = randomUUID();
    const now = nowIso();
    const hash = acc ? await hashPassword(acc.password) : null;
    tx(db, () => {
      run(db, `INSERT INTO patients (id, code, age_band, affected_hand, dominant_hand, condition, surgery, surgery_date, phase, limitations, goals, notes, created_at, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, p.code, p.ageBand, p.affectedHand, p.dominantHand, p.condition, p.surgery, p.surgeryDate, p.phase, p.limitations, p.goals, p.notes, now, user.id, now);
      run(db, 'INSERT INTO patient_access (id, patient_id, user_id, level, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), id, user.id, 'owner', user.id, now);
      if (acc && hash) {
        run(db, `INSERT INTO users (id, username, password_hash, role, display_name, patient_id, must_change_password, created_at) VALUES (?, ?, ?, 'patient', ?, ?, 0, ?)`,
          randomUUID(), acc.username.toLowerCase(), hash, p.code, id, now);
      }
    });
    return { id };
  });

  app.get('/api/patients/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { level } = requirePatientAccess(db, req, id);
    const r = get(db, 'SELECT * FROM patients WHERE id = ?', id);
    if (!r) throw new HttpError(404, 'Paziente non trovato');
    const account = get(db, "SELECT username, active FROM users WHERE patient_id = ? AND role = 'patient'", id);
    return { ...rowToPatient(r), accessLevel: level, account: account ? { username: account.username, active: !!account.active } : null, summary: level === 'self' ? undefined : patientSummary(db, id) };
  });

  app.put('/api/patients/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const body = parse(z.object({ patient: patientInputSchema, reason: z.string().max(500).optional() }), req.body);
    const cur = get(db, 'SELECT * FROM patients WHERE id = ?', id)!;
    const p = body.patient;
    if (p.code.toLowerCase() !== String(cur.code).toLowerCase() && get(db, 'SELECT 1 FROM patients WHERE code = ? AND id != ?', p.code, id)) throw new HttpError(409, 'Codice paziente già in uso');
    tx(db, () => {
      for (const [k, col] of Object.entries(FIELD_MAP)) {
        const nv = (p as any)[k];
        if ((cur[col] ?? null) !== (nv ?? null)) {
          audit(db, { entity: 'patient', entityId: id, patientId: id, field: k, oldValue: cur[col], newValue: nv, authorId: user.id, reason: body.reason || 'Aggiornamento scheda' });
          run(db, `UPDATE patients SET ${col} = ? WHERE id = ?`, nv, id);
        }
      }
      run(db, 'UPDATE patients SET updated_at = ? WHERE id = ?', nowIso(), id);
    });
    return { ok: true };
  });

  app.post('/api/patients/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'owner');
    const body = parse(z.object({ archived: z.boolean(), reason: z.string().min(1).max(500) }), req.body);
    audit(db, { entity: 'patient', entityId: id, patientId: id, field: 'archived', oldValue: null, newValue: body.archived, authorId: user.id, reason: body.reason });
    run(db, 'UPDATE patients SET archived = ? WHERE id = ?', body.archived ? 1 : 0, id);
    return { ok: true };
  });

  // Account di accesso del paziente
  app.post('/api/patients/:id/account', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const body = parse(z.object({ username: z.string().min(3).max(60).regex(/^[a-z0-9._-]+$/i).optional(), password: z.string() }), req.body);
    const prob = passwordProblem(body.password);
    if (prob) throw new HttpError(400, prob);
    const existing = get(db, "SELECT * FROM users WHERE patient_id = ? AND role = 'patient'", id);
    if (existing) {
      run(db, 'UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', await hashPassword(body.password), existing.id);
      run(db, 'DELETE FROM auth_sessions WHERE user_id = ?', existing.id);
      audit(db, { entity: 'patient_account', entityId: existing.id, patientId: id, field: 'password', oldValue: null, newValue: '(reimpostata)', authorId: user.id, reason: 'Reimpostazione password paziente' });
      return { username: existing.username };
    }
    if (!body.username) throw new HttpError(400, 'Indicare il nome utente');
    if (get(db, 'SELECT 1 FROM users WHERE username = ?', body.username.toLowerCase())) throw new HttpError(409, 'Nome utente già in uso');
    const code = get(db, 'SELECT code FROM patients WHERE id = ?', id)!.code;
    await createUser(db, { username: body.username, password: body.password, role: 'patient', displayName: code, patientId: id });
    return { username: body.username.toLowerCase() };
  });

  app.post('/api/patients/:id/account/active', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id, 'editor');
    const body = parse(z.object({ active: z.boolean() }), req.body);
    const u = get(db, "SELECT id FROM users WHERE patient_id = ? AND role = 'patient'", id);
    if (!u) throw new HttpError(404, 'Account non presente');
    run(db, 'UPDATE users SET active = ? WHERE id = ?', body.active ? 1 : 0, u.id);
    if (!body.active) run(db, 'DELETE FROM auth_sessions WHERE user_id = ?', u.id);
    return { ok: true };
  });

  // Team: autorizzazioni di altri professionisti
  app.get('/api/patients/:id/access', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id, 'viewer');
    if (requireUser(req).role === 'patient') throw new HttpError(404, 'Non trovato');
    return all(db, `SELECT a.id, a.user_id AS userId, u.username, u.display_name AS displayName, a.level, a.granted_at AS grantedAt, a.revoked_at AS revokedAt, g.display_name AS grantedByName
      FROM patient_access a JOIN users u ON u.id = a.user_id LEFT JOIN users g ON g.id = a.granted_by WHERE a.patient_id = ? ORDER BY a.revoked_at IS NOT NULL, a.granted_at`, id);
  });

  app.post('/api/patients/:id/access', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'owner');
    const body = parse(z.object({ username: z.string().min(1).max(60), level: z.enum(['owner', 'editor', 'viewer']) }), req.body);
    const target = get(db, "SELECT id FROM users WHERE username = ? AND role = 'therapist' AND active = 1", body.username.toLowerCase());
    if (!target) throw new HttpError(404, 'Professionista non trovato');
    tx(db, () => {
      run(db, 'UPDATE patient_access SET revoked_at = ?, revoked_by = ? WHERE patient_id = ? AND user_id = ? AND revoked_at IS NULL', nowIso(), user.id, id, target.id);
      run(db, 'INSERT INTO patient_access (id, patient_id, user_id, level, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), id, target.id, body.level, user.id, nowIso());
      audit(db, { entity: 'patient_access', entityId: target.id, patientId: id, field: 'level', oldValue: null, newValue: body.level, authorId: user.id, reason: 'Autorizzazione professionista' });
    });
    return { ok: true };
  });

  app.delete('/api/patients/:id/access/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = requirePatientAccess(db, req, id, 'owner');
    const owners = all(db, "SELECT user_id FROM patient_access WHERE patient_id = ? AND level = 'owner' AND revoked_at IS NULL", id);
    if (owners.length === 1 && owners[0].user_id === userId) throw new HttpError(400, 'Deve restare almeno un responsabile del paziente');
    run(db, 'UPDATE patient_access SET revoked_at = ?, revoked_by = ? WHERE patient_id = ? AND user_id = ? AND revoked_at IS NULL', nowIso(), user.id, id, userId);
    audit(db, { entity: 'patient_access', entityId: userId, patientId: id, field: 'level', oldValue: 'attivo', newValue: 'revocato', authorId: user.id, reason: 'Revoca autorizzazione' });
    return { ok: true };
  });

  // Note del fisioterapista
  app.get('/api/patients/:id/notes', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id);
    if (user.role === 'patient') throw new HttpError(404, 'Non trovato');
    return all(db, `SELECT n.id, n.text, n.category, n.created_at AS createdAt, u.display_name AS authorName, n.is_demo AS isDemo FROM notes n JOIN users u ON u.id = n.author_id WHERE n.patient_id = ? ORDER BY n.created_at DESC`, id);
  });

  app.post('/api/patients/:id/notes', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const body = parse(noteSchema, req.body);
    const nid = randomUUID();
    run(db, 'INSERT INTO notes (id, patient_id, text, category, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', nid, id, body.text, body.category, user.id, nowIso());
    return { id: nid };
  });

  // Misure cliniche inserite dal professionista
  app.get('/api/patients/:id/measures', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id);
    if (user.role === 'patient') throw new HttpError(404, 'Non trovato');
    return all(db, `SELECT m.id, m.date, m.category, m.name, m.side, m.value, m.value_status AS valueStatus, m.unit, m.instrument, m.notes, m.created_at AS createdAt, m.updated_at AS updatedAt, u.display_name AS enteredByName, m.is_demo AS isDemo
      FROM clinical_measures m JOIN users u ON u.id = m.entered_by WHERE m.patient_id = ? AND m.deleted_at IS NULL ORDER BY m.date, m.created_at`, id);
  });

  app.post('/api/patients/:id/measures', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const m = parse(measureSchema, req.body);
    checkValueStatus(m.value, m.valueStatus);
    const mid = randomUUID(), now = nowIso();
    run(db, `INSERT INTO clinical_measures (id, patient_id, date, category, name, side, value, value_status, unit, instrument, notes, entered_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      mid, id, m.date, m.category, m.name, m.side, m.value, m.valueStatus, m.unit, m.instrument, m.notes, user.id, now, now);
    return { id: mid };
  });

  app.put('/api/measures/:mid', async (req) => {
    const { mid } = req.params as { mid: string };
    const cur = get(db, 'SELECT * FROM clinical_measures WHERE id = ? AND deleted_at IS NULL', mid);
    if (!cur) throw new HttpError(404, 'Misura non trovata');
    const { user } = requirePatientAccess(db, req, cur.patient_id, 'editor');
    const body = parse(z.object({ measure: measureSchema, reason: z.string().min(3).max(500) }), req.body);
    checkValueStatus(body.measure.value, body.measure.valueStatus);
    const map: Record<string, string> = { date: 'date', category: 'category', name: 'name', side: 'side', value: 'value', valueStatus: 'value_status', unit: 'unit', instrument: 'instrument', notes: 'notes' };
    tx(db, () => {
      for (const [k, col] of Object.entries(map)) {
        const nv = (body.measure as any)[k];
        if ((cur[col] ?? null) !== (nv ?? null)) {
          audit(db, { entity: 'clinical_measure', entityId: mid, patientId: cur.patient_id, field: k, oldValue: cur[col], newValue: nv, authorId: user.id, reason: body.reason });
          run(db, `UPDATE clinical_measures SET ${col} = ?, updated_at = ? WHERE id = ?`, nv, nowIso(), mid);
        }
      }
    });
    return { ok: true };
  });

  app.delete('/api/measures/:mid', async (req) => {
    const { mid } = req.params as { mid: string };
    const cur = get(db, 'SELECT * FROM clinical_measures WHERE id = ? AND deleted_at IS NULL', mid);
    if (!cur) throw new HttpError(404, 'Misura non trovata');
    const { user } = requirePatientAccess(db, req, cur.patient_id, 'editor');
    const body = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
    audit(db, { entity: 'clinical_measure', entityId: mid, patientId: cur.patient_id, field: 'deleted', oldValue: JSON.stringify({ name: cur.name, value: cur.value, date: cur.date }), newValue: 'eliminata', authorId: user.id, reason: body.reason });
    run(db, 'UPDATE clinical_measures SET deleted_at = ? WHERE id = ?', nowIso(), mid);
    return { ok: true };
  });

  // Questionari: solo inserimento manuale del risultato, con strumento e versione
  app.get('/api/patients/:id/questionnaires', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id);
    if (user.role === 'patient') throw new HttpError(404, 'Non trovato');
    return all(db, `SELECT q.id, q.date, q.instrument, q.version, q.score, q.value_status AS valueStatus, q.score_description AS scoreDescription, q.notes, q.created_at AS createdAt, u.display_name AS enteredByName, q.is_demo AS isDemo
      FROM questionnaire_results q JOIN users u ON u.id = q.entered_by WHERE q.patient_id = ? AND q.deleted_at IS NULL ORDER BY q.date`, id);
  });

  app.post('/api/patients/:id/questionnaires', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const q = parse(questionnaireSchema, req.body);
    checkValueStatus(q.score, q.valueStatus);
    const qid = randomUUID(), now = nowIso();
    run(db, `INSERT INTO questionnaire_results (id, patient_id, date, instrument, version, score, value_status, score_description, notes, entered_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      qid, id, q.date, q.instrument, q.version, q.score, q.valueStatus, q.scoreDescription, q.notes, user.id, now, now);
    return { id: qid };
  });

  app.put('/api/questionnaires/:qid', async (req) => {
    const { qid } = req.params as { qid: string };
    const cur = get(db, 'SELECT * FROM questionnaire_results WHERE id = ? AND deleted_at IS NULL', qid);
    if (!cur) throw new HttpError(404, 'Risultato non trovato');
    const { user } = requirePatientAccess(db, req, cur.patient_id, 'editor');
    const body = parse(z.object({ result: questionnaireSchema, reason: z.string().min(3).max(500) }), req.body);
    checkValueStatus(body.result.score, body.result.valueStatus);
    const map: Record<string, string> = { date: 'date', instrument: 'instrument', version: 'version', score: 'score', valueStatus: 'value_status', scoreDescription: 'score_description', notes: 'notes' };
    tx(db, () => {
      for (const [k, col] of Object.entries(map)) {
        const nv = (body.result as any)[k];
        if ((cur[col] ?? null) !== (nv ?? null)) {
          audit(db, { entity: 'questionnaire', entityId: qid, patientId: cur.patient_id, field: k, oldValue: cur[col], newValue: nv, authorId: user.id, reason: body.reason });
          run(db, `UPDATE questionnaire_results SET ${col} = ?, updated_at = ? WHERE id = ?`, nv, nowIso(), qid);
        }
      }
    });
    return { ok: true };
  });

  // Cronologia delle correzioni
  app.get('/api/patients/:id/corrections', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id);
    if (user.role === 'patient') throw new HttpError(404, 'Non trovato');
    return all(db, `SELECT c.id, c.entity, c.entity_id AS entityId, c.field, c.old_value AS oldValue, c.new_value AS newValue, c.reason, c.at, u.display_name AS authorName
      FROM corrections c JOIN users u ON u.id = c.author_id WHERE c.patient_id = ? ORDER BY c.at DESC LIMIT 500`, id);
  });
}

function checkValueStatus(value: number | null, status: string) {
  if (status === 'ok' && value === null) throw new HttpError(400, 'Valore mancante: indicare lo stato "dato mancante" o "errore tecnico"');
  if (status !== 'ok' && value !== null) throw new HttpError(400, 'Se il dato è mancante o in errore il valore deve essere vuoto (lo zero è un valore)');
}
