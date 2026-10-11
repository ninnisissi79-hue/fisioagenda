import { z } from 'zod';

/** Schemi di validazione dei dati scambiati con il server. */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida');
const iso = z.string().min(10).max(40);
const id = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const finger = z.enum(['T', 'I', 'M', 'R', 'L']);
const hand = z.enum(['left', 'right']);
const npoint = z.object({ x: z.number().finite(), y: z.number().finite() });
const paramValue = z.union([z.number().finite(), z.string().max(100), z.boolean()]);
const params = z.record(z.string().max(50), paramValue);

export const deviceInfoSchema = z.object({
  deviceId: z.string().max(64),
  userAgent: z.string().max(400),
  screenW: z.number(), screenH: z.number(), dpr: z.number(),
  maxTouchPointsDeclared: z.number(),
  measuredMaxContacts: z.number().nullable(),
  standalone: z.boolean(),
});

const areaSchema = z.object({ w: z.number().positive(), h: z.number().positive() });
const physicalScaleSchema = z.object({ pxPerMm: z.number().positive(), method: z.string().max(200), measuredAt: iso }).nullable();

export const comfortZoneSchema = z.object({
  exerciseId: z.string().max(40),
  kind: z.enum(['distance', 'segment', 'region']),
  fingers: z.array(finger).max(5),
  minDist: z.number().optional(), maxDist: z.number().optional(),
  start: npoint.optional(), end: npoint.optional(),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  approvedAt: iso,
  note: z.string().max(500).optional(),
});

export const calibrationInputSchema = z.object({
  id,
  isReference: z.boolean(),
  hand,
  fingers: z.array(finger).min(1).max(5),
  singleAnchors: z.record(finger, npoint),
  layout: z.record(finger, npoint).nullable(),
  layoutMethod: z.enum(['simultaneous', 'single_only']),
  comfort: z.array(comfortZoneSchema).max(20),
  area: areaSchema,
  orientation: z.enum(['landscape', 'portrait']),
  device: deviceInfoSchema,
  physicalScale: physicalScaleSchema,
  trial: z.object({ done: z.boolean(), ok: z.boolean(), note: z.string().max(500).optional() }),
  notes: z.string().max(2000).optional(),
});

export const progressionRuleSchema = z.object({
  enabled: z.boolean(), param: z.string().max(50), step: z.number().finite(), limit: z.number().finite(),
  windowRuns: z.number().int(), upThreshold: z.number(), downThreshold: z.number().nullable(),
});

export const programItemSchema = z.object({
  itemId: id,
  exerciseId: z.string().max(40),
  exerciseVersion: z.string().max(20),
  mode: z.enum(['training', 'assessment']),
  status: z.enum(['active', 'suspended']),
  hand,
  fingers: z.array(finger).min(1).max(5),
  params,
  frequency: z.object({ timesPerDay: z.number().int(), days: z.array(z.number().int().min(0).max(6)).max(7) }),
  progression: progressionRuleSchema.nullable(),
  notes: z.string().max(1000).optional(),
  replacesItemId: z.string().max(64).nullable().optional(),
});

export const programVersionInputSchema = z.object({
  effectiveFrom: day,
  changeNote: z.string().max(2000),
  restBetweenExercisesSec: z.number().int().min(0).max(600),
  items: z.array(programItemSchema).max(30),
  /** versione su cui si basa la modifica (controllo di concorrenza) */
  basedOnVersion: z.number().int().nullable(),
});

export const sessionSchema = z.object({
  id,
  programVersionId: z.string().max(64).nullable(),
  programVersion: z.number().int().nullable(),
  calibrationId: z.string().max(64).nullable(),
  startedAt: iso, endedAt: iso.nullable(),
  localDate: day, tz: z.string().max(64),
  status: z.enum(['in_progress', 'completed', 'interrupted', 'invalid']),
  interruptionReason: z.string().max(200).nullable(),
  activeMs: z.number().min(0),
  device: deviceInfoSchema,
  repositioning: z.object({ method: z.enum(['accepted', 'offset', 'skipped']), offset: npoint, at: iso }).nullable(),
  plannedItemIds: z.array(z.string().max(64)).max(30),
});

export const runSchema = z.object({
  id,
  sessionId: z.string().max(64).nullable(),
  programVersionId: z.string().max(64).nullable(),
  programVersion: z.number().int().nullable(),
  programItemId: z.string().max(64).nullable(),
  exerciseId: z.string().max(40),
  exerciseVersion: z.string().max(20),
  metricsVersion: z.string().max(20),
  mode: z.enum(['training', 'assessment']),
  hand, fingers: z.array(finger).max(5),
  params,
  progression: z.object({ level: z.number().int(), param: z.string(), base: paramValue, value: paramValue, reason: z.string().max(300) }).nullable(),
  calibrationId: z.string().max(64).nullable(),
  status: z.enum(['started', 'completed', 'interrupted', 'invalid']),
  startedAt: iso, endedAt: iso.nullable(),
  localDate: day, tz: z.string().max(64),
  activeMs: z.number().min(0),
  setsPlanned: z.number().int(), setsDone: z.number().int(),
  repsPlanned: z.number().int(), repsValid: z.number().int(), attempts: z.number().int(),
  completionMet: z.boolean(),
  completionCriteria: z.string().max(2000),
  interruptionReason: z.string().max(200).nullable(),
  metrics: z.record(z.string().max(50), z.number().nullable()),
  detail: z.object({ reps: z.array(z.record(z.string(), z.unknown())).max(500), events: z.array(z.object({ t: z.number(), type: z.string().max(30), finger: finger.nullable().optional(), data: z.record(z.string(), z.unknown()).optional() })).max(3000), notes: z.array(z.string().max(300)).max(50).optional() }),
  device: deviceInfoSchema,
  area: areaSchema,
  physicalScale: physicalScaleSchema,
  origin: z.enum(['automatic', 'manual']),
});

export const symptomSchema = z.object({
  id,
  sessionId: z.string().max(64).nullable(),
  runId: z.string().max(64).nullable(),
  at: iso, localDate: day,
  context: z.enum(['pre', 'during', 'post', 'stop', 'free']),
  pain: z.number().int().min(0).max(10).nullable(),
  fatigue: z.number().int().min(0).max(10).nullable(),
  difficulty: z.number().int().min(0).max(10).nullable(),
  note: z.string().max(1000),
});

export const syncPushSchema = z.object({
  deviceId: z.string().max(64),
  clientLocalDate: day,
  tz: z.string().max(64),
  /** true quando, con questo invio, sul dispositivo non resta nulla da sincronizzare */
  outboxEmptyAfter: z.boolean(),
  sessions: z.array(sessionSchema).max(200),
  runs: z.array(runSchema).max(500),
  symptoms: z.array(symptomSchema).max(500),
  deviceChecks: z.array(z.object({ id, at: iso, device: deviceInfoSchema, maxContacts: z.number().int(), declared: z.number().int(), notes: z.string().max(500) })).max(50).optional(),
});

export const patientInputSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, 'usare solo lettere, numeri, punto, trattino'),
  ageBand: z.string().max(20),
  affectedHand: z.enum(['left', 'right', 'both']),
  dominantHand: z.enum(['left', 'right', 'ambidextrous', 'unknown']),
  condition: z.string().max(300),
  surgery: z.string().max(300),
  surgeryDate: day.nullable(),
  phase: z.string().max(100),
  limitations: z.string().max(2000),
  goals: z.string().max(2000),
  notes: z.string().max(4000),
});

export const measureSchema = z.object({
  date: day,
  category: z.enum(['rom', 'grip', 'pinch', 'test', 'other']),
  name: z.string().min(1).max(120),
  side: z.enum(['left', 'right', 'na']),
  value: z.number().finite().nullable(),
  valueStatus: z.enum(['ok', 'missing', 'technical_error', 'not_applicable']),
  unit: z.string().max(30),
  instrument: z.string().max(200),
  notes: z.string().max(1000),
});

export const questionnaireSchema = z.object({
  date: day,
  instrument: z.string().min(1).max(120),
  version: z.string().min(1).max(120),
  score: z.number().finite().nullable(),
  valueStatus: z.enum(['ok', 'missing', 'technical_error', 'not_applicable']),
  scoreDescription: z.string().max(300),
  notes: z.string().max(1000),
});

export const noteSchema = z.object({ text: z.string().min(1).max(5000), category: z.enum(['clinical', 'program', 'technical', 'other']) });

export const timepointSchema = z.object({
  code: z.string().min(1).max(20), label: z.string().max(100),
  offsetDays: z.number().int().min(0).max(3650), windowBefore: z.number().int().min(0).max(365), windowAfter: z.number().int().min(0).max(365),
});

export const studyInputSchema = z.object({
  title: z.string().min(2).max(300),
  code: z.string().min(1).max(40),
  protocolVersion: z.string().min(1).max(40),
  objective: z.string().max(4000), hypothesis: z.string().max(4000),
  inclusion: z.string().max(4000), exclusion: z.string().max(4000),
  groups: z.array(z.string().min(1).max(60)).max(10),
  intervention: z.string().max(4000),
  primaryOutcome: z.string().max(1000),
  secondaryOutcomes: z.array(z.string().max(300)).max(30),
  timepoints: z.array(timepointSchema).max(20),
  ethicsReference: z.string().max(500),
  status: z.enum(['draft', 'active', 'closed']),
});

export const participantInputSchema = z.object({
  patientId: z.string().max(64),
  participantCode: z.string().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/),
  groupName: z.string().max(60).nullable(),
  baselineDate: day,
  consentObtained: z.boolean(),
  consentDate: day.nullable(),
  consentVersion: z.string().max(100),
  consentNotes: z.string().max(1000),
});

export const studyEventInputSchema = z.object({
  participantId: z.string().max(64),
  date: day,
  kind: z.enum(['adverse_event', 'problem', 'deviation', 'withdrawal', 'missing_data', 'other']),
  description: z.string().min(1).max(4000),
  relatedSessionId: z.string().max(64).nullable(),
});

export type CalibrationInput = z.infer<typeof calibrationInputSchema>;
export type ProgramVersionInput = z.infer<typeof programVersionInputSchema>;
export type SyncPush = z.infer<typeof syncPushSchema>;
export type PatientInput = z.infer<typeof patientInputSchema>;
export type MeasureInput = z.infer<typeof measureSchema>;
export type QuestionnaireInput = z.infer<typeof questionnaireSchema>;
export type StudyInput = z.infer<typeof studyInputSchema>;
export type ParticipantInput = z.infer<typeof participantInputSchema>;
export type StudyEventInput = z.infer<typeof studyEventInputSchema>;
