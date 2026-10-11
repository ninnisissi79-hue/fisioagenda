import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  age_band TEXT NOT NULL DEFAULT '',
  affected_hand TEXT NOT NULL,
  dominant_hand TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT '',
  surgery TEXT NOT NULL DEFAULT '',
  surgery_date TEXT,
  phase TEXT NOT NULL DEFAULT '',
  limitations TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','therapist','patient')),
  display_name TEXT NOT NULL,
  patient_id TEXT REFERENCES patients(id),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS login_attempts (username TEXT NOT NULL, ip TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(username, at);

CREATE TABLE IF NOT EXISTS patient_access (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  level TEXT NOT NULL CHECK (level IN ('owner','editor','viewer')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_access ON patient_access(patient_id, user_id);

CREATE TABLE IF NOT EXISTS calibrations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  version INTEGER NOT NULL,
  is_reference INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  supersedes TEXT,
  UNIQUE (patient_id, version)
);

CREATE TABLE IF NOT EXISTS program_versions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  data TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (patient_id, version)
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  program_version_id TEXT,
  program_version INTEGER,
  calibration_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  local_date TEXT NOT NULL,
  tz TEXT NOT NULL,
  status TEXT NOT NULL,
  interruption_reason TEXT,
  active_ms INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_patient ON training_sessions(patient_id, local_date);

CREATE TABLE IF NOT EXISTS exercise_runs (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  session_id TEXT,
  program_version_id TEXT,
  program_version INTEGER,
  program_item_id TEXT,
  exercise_id TEXT NOT NULL,
  exercise_version TEXT NOT NULL,
  metrics_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  local_date TEXT NOT NULL,
  tz TEXT NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0,
  completion_met INTEGER NOT NULL DEFAULT 0,
  reps_valid INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  calibration_id TEXT,
  device_id TEXT NOT NULL DEFAULT '',
  technical_invalid INTEGER NOT NULL DEFAULT 0,
  technical_invalid_reason TEXT,
  data TEXT NOT NULL,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_runs_patient ON exercise_runs(patient_id, local_date);
CREATE INDEX IF NOT EXISTS idx_runs_session ON exercise_runs(session_id);

CREATE TABLE IF NOT EXISTS symptom_reports (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  session_id TEXT,
  run_id TEXT,
  at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  context TEXT NOT NULL,
  pain INTEGER,
  fatigue INTEGER,
  difficulty INTEGER,
  note TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_symptoms_patient ON symptom_reports(patient_id, local_date);

CREATE TABLE IF NOT EXISTS device_syncs (
  patient_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  last_sync_at TEXT NOT NULL,
  last_client_date TEXT NOT NULL,
  last_empty_sync_at TEXT,
  last_empty_client_date TEXT,
  tz TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (patient_id, device_id)
);

CREATE TABLE IF NOT EXISTS device_checks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  patient_id TEXT,
  at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_measures (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL,
  value REAL,
  value_status TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  instrument TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questionnaire_results (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  date TEXT NOT NULL,
  instrument TEXT NOT NULL,
  version TEXT NOT NULL,
  score REAL,
  value_status TEXT NOT NULL,
  score_description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  entered_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  patient_id TEXT,
  study_id TEXT,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  author_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections ON corrections(entity, entity_id);

CREATE TABLE IF NOT EXISTS studies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS study_members (
  study_id TEXT NOT NULL REFERENCES studies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (study_id, user_id)
);

CREATE TABLE IF NOT EXISTS study_participants (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  participant_code TEXT NOT NULL,
  group_name TEXT,
  baseline_date TEXT NOT NULL,
  consent_obtained INTEGER NOT NULL DEFAULT 0,
  consent_date TEXT,
  consent_version TEXT NOT NULL DEFAULT '',
  consent_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  status_reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (study_id, participant_code),
  UNIQUE (study_id, patient_id)
);

CREATE TABLE IF NOT EXISTS study_assessments (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES study_participants(id),
  timepoint_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','completed','missed')),
  date TEXT,
  missing_reason TEXT,
  notes TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (participant_id, timepoint_code)
);

CREATE TABLE IF NOT EXISTS study_events (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  participant_id TEXT NOT NULL REFERENCES study_participants(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  related_session_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  options TEXT NOT NULL,
  at TEXT NOT NULL
);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}

/** esegue fn in una transazione */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export type Row = Record<string, any>;

export function all(db: DB, sql: string, ...params: any[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
export function get(db: DB, sql: string, ...params: any[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}
export function run(db: DB, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
