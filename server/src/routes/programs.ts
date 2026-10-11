import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, calibrationInputSchema, diffVersions, effectiveVersionAt, getExercise, normalizeParams, programVersionInputSchema, validateProgramItems } from '@handlab/shared';
import type { DB } from '../db.ts';
import { all, get, run, tx } from '../db.ts';
import { HttpError, nowIso, parse, requirePatientAccess, requireRole, todayServer } from '../http.ts';
import { latestCalibration, programVersions, rowToCalibration } from '../services.ts';

export function programRoutes(app: FastifyInstance, db: DB) {
  // Storico completo delle versioni del programma
  app.get('/api/patients/:id/programs', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id);
    const versions = programVersions(db, id);
    return versions.map((v, i) => ({ ...v, changes: diffVersions(i > 0 ? versions[i - 1] : null, v) }));
  });

  /**
   * Nuova versione del programma. Le versioni non si modificano: ogni cambiamento crea una versione
   * con la sua data di decorrenza. Le sedute già iniziate restano legate alla versione con cui sono partite.
   */
  app.post('/api/patients/:id/programs', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const body = parse(programVersionInputSchema, req.body);
    if (body.effectiveFrom < addDays(todayServer(), -1)) throw new HttpError(400, 'La data di decorrenza non può essere nel passato: lo storico già prescritto non viene riscritto');
    // normalizza i parametri e fissa la versione dell'esercizio dal catalogo
    const items = body.items.map((it) => {
      const def = getExercise(it.exerciseId);
      return { ...it, exerciseVersion: def?.version ?? it.exerciseVersion, params: def ? normalizeParams(def, it.params).params : it.params };
    });
    const errors = validateProgramItems(items);
    if (errors.length) throw new HttpError(400, errors.join(' · '));
    const result = tx(db, () => {
      const max = (get(db, 'SELECT MAX(version) AS v FROM program_versions WHERE patient_id = ?', id)!.v as number | null) ?? 0;
      if ((body.basedOnVersion ?? 0) !== max) throw new HttpError(409, 'Il programma è stato modificato da un altro professionista. Ricarica la pagina per vedere la versione più recente.');
      const vid = randomUUID();
      run(db, 'INSERT INTO program_versions (id, patient_id, version, effective_from, data, change_note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        vid, id, max + 1, body.effectiveFrom, JSON.stringify({ items, restBetweenExercisesSec: body.restBetweenExercisesSec }), body.changeNote, nowIso(), user.id);
      return { id: vid, version: max + 1 };
    });
    return result;
  });

  // Tarature versionate
  app.get('/api/patients/:id/calibrations', async (req) => {
    const { id } = req.params as { id: string };
    requirePatientAccess(db, req, id);
    return all(db, 'SELECT c.*, u.display_name AS created_by_name FROM calibrations c LEFT JOIN users u ON u.id = c.created_by WHERE c.patient_id = ? ORDER BY c.version DESC', id)
      .map((r) => ({ ...rowToCalibration(r), createdByName: r.created_by_name }));
  });

  app.post('/api/patients/:id/calibrations', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requirePatientAccess(db, req, id, 'editor');
    const c = parse(calibrationInputSchema, req.body);
    if (get(db, 'SELECT 1 FROM calibrations WHERE id = ?', c.id)) {
      // invio ripetuto (es. rete instabile): nessun duplicato
      const r = get(db, 'SELECT * FROM calibrations WHERE id = ? AND patient_id = ?', c.id, id);
      if (!r) throw new HttpError(409, 'Identificativo già usato');
      return { id: r.id, version: r.version, duplicate: true };
    }
    return tx(db, () => {
      const prev = get(db, 'SELECT id, version FROM calibrations WHERE patient_id = ? ORDER BY version DESC LIMIT 1', id);
      const version = (prev?.version ?? 0) + 1;
      const isReference = !prev || c.isReference;
      const { id: cid, isReference: _r, ...rest } = c;
      run(db, 'INSERT INTO calibrations (id, patient_id, version, is_reference, data, created_at, created_by, supersedes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        cid, id, version, isReference ? 1 : 0, JSON.stringify(rest), nowIso(), user.id, prev?.id ?? null);
      return { id: cid, version };
    });
  });

  /**
   * Programma per il paziente: versione in vigore alla data locale del dispositivo, versioni future,
   * taratura più recente e storia per la progressione automatica.
   */
  app.get('/api/me/program', async (req) => {
    const user = requireRole(req, 'patient');
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    const date = q.date ?? todayServer();
    const pid = user.patientId!;
    const versions = programVersions(db, pid);
    const current = effectiveVersionAt(versions, date);
    const upcoming = versions.filter((v) => v.effectiveFrom > date && (!current || v.version > current.version));
    const patient = get(db, 'SELECT code, affected_hand FROM patients WHERE id = ?', pid);
    const history = current ? all(db, `SELECT program_item_id, status, data, started_at FROM exercise_runs WHERE patient_id = ? AND program_version_id = ? AND technical_invalid = 0 ORDER BY started_at`, pid, current.id)
      .map((r) => { const d = JSON.parse(r.data); return { itemId: r.program_item_id, level: d.progression?.level ?? 0, successRate: d.metrics?.successRate ?? null, completed: r.status === 'completed', startedAt: r.started_at }; }) : [];
    const todayRuns = all(db, `SELECT id, program_item_id AS itemId, status FROM exercise_runs WHERE patient_id = ? AND local_date = ?`, pid, date);
    return { patient: { code: patient?.code, affectedHand: patient?.affected_hand }, date, current, upcoming, calibration: latestCalibration(db, pid), progressionHistory: history, todayRuns, serverTime: nowIso() };
  });
}
