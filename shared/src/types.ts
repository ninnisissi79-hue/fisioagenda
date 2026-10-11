/**
 * Tipi di dominio condivisi tra server e web app.
 *
 * Convenzioni:
 * - Le date di calendario sono stringhe "YYYY-MM-DD" riferite al giorno locale del paziente.
 * - I timestamp sono stringhe ISO 8601 in UTC; il fuso (IANA) è registrato a parte.
 * - Le coordinate "normalizzate" (unità u) sono espresse in frazioni del LATO CORTO
 *   dell'area di gioco: 1 u = lato corto dell'area. Non sono centimetri.
 */

export type Hand = 'left' | 'right';
export type FingerId = 'T' | 'I' | 'M' | 'R' | 'L';
export type Role = 'admin' | 'therapist' | 'patient';
export type AccessLevel = 'owner' | 'editor' | 'viewer';
export type RunMode = 'training' | 'assessment';
export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface NPoint { x: number; y: number }
export interface AreaSize { w: number; h: number }

export interface PhysicalScale {
  /** pixel CSS per millimetro, misurati con un riferimento di dimensione nota */
  pxPerMm: number;
  method: string;
  measuredAt: string;
}

export interface DeviceInfo {
  deviceId: string;
  userAgent: string;
  screenW: number;
  screenH: number;
  dpr: number;
  maxTouchPointsDeclared: number;
  measuredMaxContacts: number | null;
  standalone: boolean;
}

export interface ComfortZone {
  exerciseId: string;
  kind: 'distance' | 'segment' | 'region';
  fingers: FingerId[];
  /** distance: distanze minima e massima tra due contatti (u) */
  minDist?: number;
  maxDist?: number;
  /** segment: punto vicino (start) e lontano (end) del dito in movimento (u) */
  start?: NPoint;
  end?: NPoint;
  /** region: rettangolo (u) */
  rect?: { x: number; y: number; w: number; h: number };
  approvedAt: string;
  note?: string;
}

export interface Calibration {
  id: string;
  patientId: string;
  version: number;
  isReference: boolean;
  hand: Hand;
  fingers: FingerId[];
  /** posizioni registrate un dito alla volta (u) */
  singleAnchors: Partial<Record<FingerId, NPoint>>;
  /** disposizione con tutte le dita appoggiate insieme (u), se il dispositivo lo consente */
  layout: Partial<Record<FingerId, NPoint>> | null;
  layoutMethod: 'simultaneous' | 'single_only';
  comfort: ComfortZone[];
  area: AreaSize;
  orientation: 'landscape' | 'portrait';
  device: DeviceInfo;
  physicalScale: PhysicalScale | null;
  trial: { done: boolean; ok: boolean; note?: string };
  notes?: string;
  createdAt: string;
  createdBy: string;
  supersedes: string | null;
}

export interface ProgressionRule {
  enabled: boolean;
  /** parametro autorizzato alla progressione */
  param: string;
  /** variazione per livello (segno = direzione) */
  step: number;
  /** limite autorizzato dal fisioterapista: il valore non lo supera mai */
  limit: number;
  /** numero di esecuzioni completate consecutive valutate */
  windowRuns: number;
  /** soglia (0–1) della quota di ripetizioni valide per salire di livello, scelta dal fisioterapista */
  upThreshold: number;
  /** soglia facoltativa per scendere di livello */
  downThreshold: number | null;
}

export interface Frequency {
  timesPerDay: number;
  /** giorni della settimana: 0=domenica … 6=sabato */
  days: number[];
}

export interface ProgramItem {
  itemId: string;
  exerciseId: string;
  exerciseVersion: string;
  mode: RunMode;
  status: 'active' | 'suspended';
  hand: Hand;
  fingers: FingerId[];
  params: Params;
  frequency: Frequency;
  progression: ProgressionRule | null;
  notes?: string;
  replacesItemId?: string | null;
}

export interface ProgramVersion {
  id: string;
  patientId: string;
  version: number;
  effectiveFrom: string;
  createdAt: string;
  createdBy: string;
  createdByName?: string;
  changeNote: string;
  restBetweenExercisesSec: number;
  items: ProgramItem[];
}

export type SessionStatus = 'in_progress' | 'completed' | 'interrupted' | 'invalid';
export type RunStatus = 'started' | 'completed' | 'interrupted' | 'invalid';

export interface Repositioning {
  method: 'accepted' | 'offset' | 'skipped';
  offset: NPoint;
  at: string;
}

export interface TrainingSession {
  id: string;
  patientId: string;
  programVersionId: string | null;
  programVersion: number | null;
  calibrationId: string | null;
  startedAt: string;
  endedAt: string | null;
  localDate: string;
  tz: string;
  status: SessionStatus;
  interruptionReason: string | null;
  activeMs: number;
  device: DeviceInfo;
  repositioning: Repositioning | null;
  plannedItemIds: string[];
  /** esito di ciascun esercizio previsto nella seduta */
  itemOutcomes?: { itemId: string; status: 'completed' | 'interrupted' | 'skipped' | 'not_reached'; reason: string | null; runId: string | null }[];
  isDemo?: boolean;
}

export interface ProgressionApplied {
  level: number;
  param: string;
  base: ParamValue;
  value: ParamValue;
  reason: string;
}

export interface RunEvent { t: number; type: string; finger?: FingerId | null; data?: Record<string, unknown> }

export interface ExerciseRun {
  id: string;
  sessionId: string | null;
  patientId: string;
  programVersionId: string | null;
  programVersion: number | null;
  programItemId: string | null;
  exerciseId: string;
  exerciseVersion: string;
  metricsVersion: string;
  mode: RunMode;
  hand: Hand;
  fingers: FingerId[];
  params: Params;
  progression: ProgressionApplied | null;
  calibrationId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  localDate: string;
  tz: string;
  activeMs: number;
  setsPlanned: number;
  setsDone: number;
  repsPlanned: number;
  repsValid: number;
  attempts: number;
  completionMet: boolean;
  completionCriteria: string;
  interruptionReason: string | null;
  metrics: Record<string, number | null>;
  detail: { reps: Record<string, unknown>[]; events: RunEvent[]; notes?: string[] };
  device: DeviceInfo;
  area: AreaSize;
  physicalScale: PhysicalScale | null;
  origin: 'automatic' | 'manual';
  isDemo?: boolean;
}

export type SymptomContext = 'pre' | 'during' | 'post' | 'stop' | 'free';

export interface SymptomReport {
  id: string;
  patientId: string;
  sessionId: string | null;
  runId: string | null;
  at: string;
  localDate: string;
  context: SymptomContext;
  /** scala numerica 0–10 riferita dal paziente; null = non indicato */
  pain: number | null;
  fatigue: number | null;
  difficulty: number | null;
  note: string;
  isDemo?: boolean;
}

export const STOP_REASONS: { value: string; label: string }[] = [
  { value: 'pain', label: 'Dolore' },
  { value: 'fatigue', label: 'Affaticamento' },
  { value: 'difficulty', label: 'Troppo difficile' },
  { value: 'technical', label: 'Problema tecnico' },
  { value: 'interrupted', label: 'Sono stato interrotto' },
  { value: 'other', label: 'Altro' },
];

export function stopReasonLabel(v: string | null | undefined): string {
  if (!v) return '—';
  const known = STOP_REASONS.find((r) => r.value === v);
  if (known) return known.label;
  const sys: Record<string, string> = {
    app_closed: 'App chiusa durante l\'esercizio',
    background_timeout: 'App rimasta in secondo piano',
    orientation_change: 'Cambio di orientamento',
    session_stopped: 'Seduta interrotta',
    skipped: 'Esercizio saltato',
    attempt_limit: 'Raggiunto il limite di tentativi (il doppio di quelli previsti)',
    time_limit: 'Raggiunto il tempo massimo dell\'esercizio',
  };
  return sys[v] ?? v;
}
