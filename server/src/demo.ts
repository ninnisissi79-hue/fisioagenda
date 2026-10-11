import { randomUUID } from 'node:crypto';
import { addDays, CATALOG, defaultParams, getExercise, weekday, type DeviceInfo, type ProgramItem } from '@handlab/shared';
import type { DB } from './db.ts';
import { get, run } from './db.ts';
import { createUser } from './auth.ts';
import { nowIso } from './http.ts';

export const DEMO_PASSWORD = 'demo-handlab';

/**
 * Dati DIMOSTRATIVI: pazienti fittizi, attività generate con formule deterministiche
 * (non casuali) e sempre contrassegnate come dimostrative (is_demo = 1).
 */
export async function seedDemo(db: DB, today: string): Promise<void> {
  if (get(db, "SELECT value FROM meta WHERE key = 'demo_seeded'")) return;
  const now = nowIso();
  await createUser(db, { username: 'admin.demo', password: DEMO_PASSWORD, role: 'admin', displayName: 'Amministratore (demo)', isDemo: true });
  const ft = await createUser(db, { username: 'ft.demo', password: DEMO_PASSWORD, role: 'therapist', displayName: 'Fisioterapista Demo', isDemo: true });
  const ft2 = await createUser(db, { username: 'collega.demo', password: DEMO_PASSWORD, role: 'therapist', displayName: 'Collega Demo', isDemo: true });

  const patients = [
    { code: 'DEMO-001', ageBand: '50-59', affected: 'right', dominant: 'right', condition: 'ESEMPIO FITTIZIO – rigidità delle dita dopo immobilizzazione', surgery: '', surgeryDate: null, phase: 'Recupero della mobilità (esempio)', limitations: 'Esempio: non superare l\'area confortevole approvata.', goals: 'Esempio: abbottonare la camicia; usare il telefono con la mano destra.', account: 'demo001' },
    { code: 'DEMO-002', ageBand: '30-39', affected: 'left', dominant: 'right', condition: 'ESEMPIO FITTIZIO – esiti di intervento alla mano', surgery: 'Intervento fittizio (esempio)', surgeryDate: addDays(today, -60), phase: 'Fase intermedia (esempio)', limitations: 'Esempio: evitare sessioni oltre 15 minuti.', goals: 'Esempio: scrivere al computer per 20 minuti.', account: 'demo002' },
    { code: 'DEMO-003', ageBand: '70-79', affected: 'right', dominant: 'right', condition: 'ESEMPIO FITTIZIO – nuovo paziente senza programma', surgery: '', surgeryDate: null, phase: 'Valutazione iniziale', limitations: '', goals: '', account: null },
  ];
  const ids: string[] = [];
  for (const p of patients) {
    const id = randomUUID();
    ids.push(id);
    run(db, `INSERT INTO patients (id, code, age_band, affected_hand, dominant_hand, condition, surgery, surgery_date, phase, limitations, goals, notes, is_demo, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id, p.code, p.ageBand, p.affected, p.dominant, p.condition, p.surgery, p.surgeryDate, p.phase, p.limitations, p.goals, 'Paziente dimostrativo: tutti i dati sono fittizi.', now, ft, now);
    run(db, 'INSERT INTO patient_access (id, patient_id, user_id, level, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), id, ft, 'owner', ft, now);
    if (p.account) await createUser(db, { username: p.account, password: DEMO_PASSWORD, role: 'patient', displayName: p.code, patientId: id, isDemo: true });
  }
  // il collega vede DEMO-001 in sola lettura
  run(db, 'INSERT INTO patient_access (id, patient_id, user_id, level, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), ids[0], ft2, 'viewer', ft, now);

  const device: DeviceInfo = { deviceId: 'demo-tablet', userAgent: 'DEMO (dispositivo dimostrativo)', screenW: 1180, screenH: 820, dpr: 2, maxTouchPointsDeclared: 5, measuredMaxContacts: 5, standalone: true };
  const area = { w: 1100, h: 700 };
  const cal = (pid: string, hand: 'left' | 'right') => {
    const s = 700, mirror = (x: number) => (hand === 'right' ? x : area.w / s - x);
    const anchors: any = { T: { x: mirror(0.55), y: 0.72 }, I: { x: mirror(0.72), y: 0.36 }, M: { x: mirror(0.88), y: 0.30 }, R: { x: mirror(1.03), y: 0.36 }, L: { x: mirror(1.16), y: 0.50 } };
    const id = randomUUID();
    const data = {
      hand, fingers: ['T', 'I', 'M', 'R', 'L'], singleAnchors: anchors, layout: anchors, layoutMethod: 'simultaneous',
      comfort: [
        { exerciseId: 'pinch', kind: 'distance', fingers: ['T', 'I'], minDist: 0.12, maxDist: 0.42, approvedAt: now, note: 'dimostrativo' },
        { exerciseId: 'slide', kind: 'segment', fingers: ['I'], start: anchors.I, end: { x: anchors.I.x + (hand === 'right' ? 0.04 : -0.04), y: 0.08 }, approvedAt: now },
        { exerciseId: 'path', kind: 'region', fingers: ['I'], rect: { x: Math.min(mirror(0.45), mirror(1.15)), y: 0.15, w: 0.7, h: 0.5 }, approvedAt: now },
        { exerciseId: 'chase', kind: 'region', fingers: ['I'], rect: { x: Math.min(mirror(0.45), mirror(1.15)), y: 0.15, w: 0.7, h: 0.5 }, approvedAt: now },
      ],
      area, orientation: 'landscape', device, physicalScale: null, trial: { done: true, ok: true }, notes: 'Taratura DIMOSTRATIVA (dati fittizi).',
    };
    run(db, 'INSERT INTO calibrations (id, patient_id, version, is_reference, data, created_at, created_by, supersedes) VALUES (?, ?, 1, 1, ?, ?, ?, NULL)', id, pid, JSON.stringify(data), addDays(today, -21) + 'T09:00:00.000Z', ft);
    return id;
  };
  const cal1 = cal(ids[0], 'right');
  cal(ids[1], 'left');

  const mk = (exerciseId: string, hand: 'left' | 'right', fingers: any[], over: Record<string, any>, days: number[], itemId: string, mode: 'training' | 'assessment' = 'training'): ProgramItem => ({
    itemId, exerciseId, exerciseVersion: getExercise(exerciseId)!.version, mode, status: 'active', hand, fingers,
    params: { ...defaultParams(getExercise(exerciseId)!), ...over }, frequency: { timesPerDay: 1, days }, progression: null,
  });
  const everyday = [0, 1, 2, 3, 4, 5, 6], weekdays = [1, 2, 3, 4, 5];
  const v1Items = [
    mk('pinch', 'right', ['T', 'I'], { amplitude: 0.5, sets: 2, reps: 6 }, everyday, 'demo-item-pinch'),
    mk('piano', 'right', ['I', 'M', 'R'], { sets: 1, reps: 9 }, weekdays, 'demo-item-piano'),
    mk('path', 'right', ['I'], { pathType: 'straight', sets: 1, reps: 4 }, everyday, 'demo-item-path'),
  ];
  const v2Items = [
    { ...v1Items[0], params: { ...v1Items[0].params, amplitude: 0.6 }, progression: { enabled: true, param: 'amplitude', step: 0.05, limit: 0.8, windowRuns: 3, upThreshold: 0.85, downThreshold: 0.5 } },
    v1Items[1],
    { ...v1Items[2], params: { ...v1Items[2].params, pathType: 'curve' } },
    mk('chase', 'right', ['I'], { durationSec: 30, sets: 1 }, [1, 3, 5], 'demo-item-chase'),
  ];
  const pv1 = randomUUID(), pv2 = randomUUID();
  run(db, 'INSERT INTO program_versions (id, patient_id, version, effective_from, data, change_note, created_at, created_by) VALUES (?, ?, 1, ?, ?, ?, ?, ?)', pv1, ids[0], addDays(today, -21), JSON.stringify({ items: v1Items, restBetweenExercisesSec: 30 }), 'Programma iniziale (dimostrativo)', addDays(today, -21) + 'T09:30:00.000Z', ft);
  run(db, 'INSERT INTO program_versions (id, patient_id, version, effective_from, data, change_note, created_at, created_by) VALUES (?, ?, 2, ?, ?, ?, ?, ?)', pv2, ids[0], addDays(today, -7), JSON.stringify({ items: v2Items, restBetweenExercisesSec: 30 }), 'Aumentata ampiezza pinza, strada curva, aggiunto inseguimento (dimostrativo)', addDays(today, -8) + 'T17:00:00.000Z', ft);
  const pv3 = randomUUID();
  run(db, 'INSERT INTO program_versions (id, patient_id, version, effective_from, data, change_note, created_at, created_by) VALUES (?, ?, 1, ?, ?, ?, ?, ?)', pv3, ids[1], addDays(today, -3), JSON.stringify({ items: [mk('slide', 'left', ['I'], { amplitude: 0.5 }, everyday, 'demo2-item-slide'), mk('chase', 'left', ['I'], { durationSec: 20 }, everyday, 'demo2-item-chase')], restBetweenExercisesSec: 30 }), 'Programma iniziale (dimostrativo)', addDays(today, -3) + 'T10:00:00.000Z', ft);

  // attività dimostrativa deterministica degli ultimi 20 giorni per DEMO-001 (alcuni giorni saltati, un'interruzione)
  const skip = new Set([3, 9, 10, 16]);
  for (let k = 20; k >= 1; k--) {
    if (skip.has(k)) continue;
    const date = addDays(today, -k);
    const isV2 = k <= 7;
    const items = (isV2 ? v2Items : v1Items).filter((i) => i.frequency.days.includes(weekday(date)));
    const sid = randomUUID();
    const start = new Date(`${date}T16:00:00.000Z`);
    let t = start.getTime();
    let active = 0;
    const interruptedDay = k === 5;
    const runIds: string[] = [];
    items.forEach((it, idx) => {
      const rid = randomUUID();
      const prog = 20 - k; // andamento dimostrativo lineare
      const interrupted = interruptedDay && idx === 1;
      const metrics: Record<string, number | null> = demoMetrics(it.exerciseId, prog, interrupted);
      const dur = 120000 + idx * 15000;
      const plannedSets = Number(it.params.sets ?? 1);
      const repsPlanned = it.exerciseId === 'chase' ? plannedSets : plannedSets * Number(it.params.reps ?? 1);
      const data = {
        id: rid, sessionId: sid, patientId: ids[0], programVersionId: isV2 ? pv2 : pv1, programVersion: isV2 ? 2 : 1, programItemId: it.itemId,
        exerciseId: it.exerciseId, exerciseVersion: it.exerciseVersion, metricsVersion: getExercise(it.exerciseId)!.metricsVersion, mode: it.mode, hand: it.hand, fingers: it.fingers,
        params: it.params, progression: it.progression ? { level: 0, param: 'amplitude', base: it.params.amplitude, value: it.params.amplitude, reason: 'Livello iniziale' } : null,
        calibrationId: cal1, status: interrupted ? 'interrupted' : 'completed', startedAt: new Date(t).toISOString(), endedAt: new Date(t + dur).toISOString(), localDate: date, tz: 'Europe/Rome',
        activeMs: dur - 20000, setsPlanned: plannedSets, setsDone: interrupted ? 0 : plannedSets, repsPlanned, repsValid: interrupted ? 2 : repsPlanned, attempts: interrupted ? 3 : (metrics.attempts ?? repsPlanned),
        completionMet: !interrupted, completionCriteria: getExercise(it.exerciseId)!.completion, interruptionReason: interrupted ? 'fatigue' : null, metrics,
        detail: { reps: [], events: [], notes: ['DATO DIMOSTRATIVO'] }, device, area, physicalScale: null, origin: 'automatic',
      };
      run(db, `INSERT INTO exercise_runs (id, patient_id, session_id, program_version_id, program_version, program_item_id, exercise_id, exercise_version, metrics_version, mode, status, started_at, ended_at, local_date, tz, active_ms, completion_met, reps_valid, attempts, calibration_id, device_id, data, received_at, updated_at, uploaded_by, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, rid, ids[0], sid, data.programVersionId, data.programVersion, it.itemId, it.exerciseId, it.exerciseVersion, data.metricsVersion, it.mode, data.status, data.startedAt, data.endedAt, date, 'Europe/Rome', data.activeMs, data.completionMet ? 1 : 0, data.repsValid, data.attempts, cal1, device.deviceId, JSON.stringify(data), data.endedAt, data.endedAt, ft);
      runIds.push(rid);
      t += dur + 30000; active += data.activeMs;
    });
    const sdata = { id: sid, patientId: ids[0], programVersionId: isV2 ? pv2 : pv1, programVersion: isV2 ? 2 : 1, calibrationId: cal1, startedAt: start.toISOString(), endedAt: new Date(t).toISOString(), localDate: date, tz: 'Europe/Rome', status: interruptedDay ? 'interrupted' : 'completed', interruptionReason: interruptedDay ? 'fatigue' : null, activeMs: active, device, repositioning: { method: 'accepted', offset: { x: 0, y: 0 }, at: start.toISOString() }, plannedItemIds: items.map((i) => i.itemId) };
    run(db, `INSERT INTO training_sessions (id, patient_id, program_version_id, program_version, calibration_id, started_at, ended_at, local_date, tz, status, interruption_reason, active_ms, device_id, data, received_at, updated_at, uploaded_by, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      sid, ids[0], sdata.programVersionId, sdata.programVersion, cal1, sdata.startedAt, sdata.endedAt, date, 'Europe/Rome', sdata.status, sdata.interruptionReason, active, device.deviceId, JSON.stringify(sdata), sdata.endedAt, sdata.endedAt, ft);
    const pain = k % 4 === 0 ? 3 : 2, fatigue = interruptedDay ? 6 : 2 + (k % 3);
    run(db, `INSERT INTO symptom_reports (id, patient_id, session_id, run_id, at, local_date, context, pain, fatigue, difficulty, note, received_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      randomUUID(), ids[0], sid, interruptedDay ? runIds[1] : null, new Date(t).toISOString(), date, interruptedDay ? 'stop' : 'post', pain, fatigue, interruptedDay ? 5 : 3, interruptedDay ? 'Esempio: mano stanca (dato dimostrativo)' : '', new Date(t).toISOString());
  }
  run(db, 'INSERT INTO device_syncs (patient_id, device_id, user_agent, last_sync_at, last_client_date, last_empty_sync_at, last_empty_client_date, tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ids[0], device.deviceId, device.userAgent, addDays(today, -1) + 'T19:00:00.000Z', addDays(today, -1), addDays(today, -1) + 'T19:00:00.000Z', addDays(today, -1), 'Europe/Rome');

  // misure cliniche dimostrative
  const measures: [number, string, string, string, number, string, string][] = [
    [-21, 'grip', 'Forza di presa', 'right', 18, 'kg', 'Dinamometro (esempio)'],
    [-21, 'grip', 'Forza di presa', 'left', 32, 'kg', 'Dinamometro (esempio)'],
    [-7, 'grip', 'Forza di presa', 'right', 21, 'kg', 'Dinamometro (esempio)'],
    [-21, 'rom', 'Flessione MCF II attiva', 'right', 55, '°', 'Goniometro (esempio)'],
    [-7, 'rom', 'Flessione MCF II attiva', 'right', 64, '°', 'Goniometro (esempio)'],
  ];
  for (const [d, cat, name, side, value, unit, instr] of measures) {
    run(db, `INSERT INTO clinical_measures (id, patient_id, date, category, name, side, value, value_status, unit, instrument, notes, entered_by, created_at, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, 1)`,
      randomUUID(), ids[0], addDays(today, d), cat, name, side, value, unit, instr, 'Valore dimostrativo', ft, now, now);
  }
  run(db, 'INSERT INTO notes (id, patient_id, text, category, author_id, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)', randomUUID(), ids[0], 'Nota dimostrativa: il paziente riferisce maggiore facilità nella pinza. Mantenere l\'area approvata.', 'clinical', ft, addDays(today, -7) + 'T17:05:00.000Z');

  // studio dimostrativo
  const sid = randomUUID();
  const study = {
    title: 'Studio pilota DIMOSTRATIVO – fattibilità degli esercizi touchscreen', code: 'DEMO-PILOT', protocolVersion: '0.1-demo',
    objective: 'Esempio: descrivere aderenza e fattibilità del programma a domicilio.', hypothesis: 'Esempio: non applicabile (studio descrittivo).',
    inclusion: 'Esempio fittizio.', exclusion: 'Esempio fittizio.', groups: ['A', 'B'], intervention: 'Programma Hand Lab personalizzato (esempio).',
    primaryOutcome: 'Esempio: aderenza (sedute completate / prescritte).', secondaryOutcomes: ['Forza di presa (dinamometro)', 'Quota di ripetizioni valide nelle prove a condizioni fisse'],
    timepoints: [{ code: 'T0', label: 'Inizio', offsetDays: 0, windowBefore: 0, windowAfter: 3 }, { code: 'T1', label: '2 settimane', offsetDays: 14, windowBefore: 3, windowAfter: 3 }, { code: 'T2', label: '6 settimane', offsetDays: 42, windowBefore: 7, windowAfter: 7 }, { code: 'FU', label: 'Follow-up', offsetDays: 90, windowBefore: 14, windowAfter: 14 }],
    ethicsReference: 'Nessuna (dimostrativo)', status: 'draft',
  };
  run(db, 'INSERT INTO studies (id, code, data, created_by, created_at, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)', sid, study.code, JSON.stringify(study), ft, now, now);
  run(db, 'INSERT INTO study_members (study_id, user_id, role, added_at) VALUES (?, ?, ?, ?)', sid, ft, 'owner', now);
  const part = randomUUID();
  run(db, `INSERT INTO study_participants (id, study_id, patient_id, participant_code, group_name, baseline_date, consent_obtained, consent_date, consent_version, consent_notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, '', 'Dimostrativo: nessun consenso reale', ?, ?)`,
    part, sid, ids[0], 'P01', 'A', addDays(today, -21), now, ft);
  run(db, 'INSERT INTO study_assessments (id, participant_id, timepoint_code, status, date, missing_reason, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)', randomUUID(), part, 'T0', 'completed', addDays(today, -21), 'Dimostrativo', ft, now);
  run(db, 'INSERT INTO study_assessments (id, participant_id, timepoint_code, status, date, missing_reason, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)', randomUUID(), part, 'T1', 'completed', addDays(today, -7), 'Dimostrativo', ft, now);

  run(db, "INSERT INTO meta (key, value) VALUES ('demo_seeded', ?)", now);
}

/** metriche dimostrative con andamento lineare deterministico (NON sono dati reali) */
function demoMetrics(exerciseId: string, p: number, interrupted: boolean): Record<string, number | null> {
  const def = CATALOG.find((e) => e.id === exerciseId)!;
  const out: Record<string, number | null> = {};
  for (const m of def.metrics) out[m.key] = null;
  const sr = Math.min(0.98, 0.6 + p * 0.018);
  const r = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
  out.successRate = r(interrupted ? 0.5 : sr);
  out.activeMs = 100000 + p * 500;
  out.contactLosses = Math.max(0, 4 - Math.floor(p / 5));
  out.extraContacts = p % 3 === 0 ? 1 : 0;
  if (exerciseId === 'pinch') Object.assign(out, { validReps: 12, attempts: Math.round(12 / sr), meanRepMs: Math.round(4200 - p * 60), minDistanceU: r(0.2 - p * 0.003, 4), maxDistanceU: r(0.36 + p * 0.002, 4), meanRangeU: r(0.14 + p * 0.004, 4), planeDriftU: r(0.03 - p * 0.0008, 4) });
  if (exerciseId === 'piano') Object.assign(out, { validReps: 9, attempts: Math.round(9 / sr), wrongLifts: Math.max(0, 3 - Math.floor(p / 6)), omissions: p < 8 ? 1 : 0, meanReactionMs: Math.round(1500 - p * 25), meanLiftMs: Math.round(900 - p * 10), meanReplaceErrorU: r(0.05 - p * 0.001, 4) });
  if (exerciseId === 'path') Object.assign(out, { validReps: 4, attempts: Math.round(4 / sr), meanPathMs: Math.round(9000 - p * 150), inCorridorRatio: r(0.7 + p * 0.012), meanDeviationU: r(0.05 - p * 0.0012, 4), corridorExits: Math.max(0, 5 - Math.floor(p / 4)), meanSpeed: r(0.08 + p * 0.002, 4) });
  if (exerciseId === 'chase') Object.assign(out, { validReps: 1, trackingMs: 30000, onTargetRatio: r(sr), meanDistanceU: r(0.07 - p * 0.0015, 4), longestOnTargetMs: Math.round(6000 + p * 400) });
  if (exerciseId === 'chase') out.successRate = out.onTargetRatio;
  if (interrupted) { out.validReps = 2; }
  return out;
}
