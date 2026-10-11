import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEngine, fingerLabel, handLabel, localDay, plannedReps, requiredContacts, STOP_REASONS, getExercise, stopReasonLabel,
  type BaseEngine, type EngineStatus, type ExerciseDef, type ExerciseRun, type FingerId, type Hand, type Params, type ProgressionApplied, type RunMode, type SymptomReport, type TrainingSession,
} from '@handlab/shared';
import { TouchSurface } from './TouchSurface';
import { drawScene } from './render';
import { anchorsPx, areaMismatch, calibrationFor, comfortFor, type Placement } from './placement';
import { DemoAnimation } from '../components/DemoAnimation';
import { ExperimentalBadge, NumberScale } from '../components/ui';
import { deviceInfo, measuredMaxContacts, physicalScale, timeZone } from '../local/device';
import { recordRun, recordSymptom, saveActive } from '../local/activity';
import { fmtMetric } from '../format';

export interface PlayerConfig {
  hand: Hand;
  fingers: FingerId[];
  params: Params;
  mode: RunMode;
  programItemId: string | null;
  programVersionId: string | null;
  programVersion: number | null;
  progression: ProgressionApplied | null;
}

export interface PlayerRecord {
  userId: string;
  patientId: string;
  /** valorizzato quando registra un professionista (valutazione in ambulatorio) */
  outboxPatientId: string | null;
  session: TrainingSession | null;
}

export interface PlayerOutcome { status: 'completed' | 'interrupted' | 'skipped' | 'cancelled'; run: ExerciseRun | null; reason?: string }

type Stage = 'intro' | 'trial' | 'run' | 'results';
type PauseReason = 'user' | 'background' | 'resize' | null;

export function Player({ def, cfg, placement, record, onDone, allowSkip, header }: {
  def: ExerciseDef; cfg: PlayerConfig; placement: Placement; record: PlayerRecord | null;
  onDone: (o: PlayerOutcome) => void; allowSkip?: boolean; header?: string;
}) {
  const [stage, setStage] = useState<Stage>('intro');
  const [trialDone, setTrialDone] = useState(false);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [pause, setPause] = useState<PauseReason>(null);
  const [areaOk, setAreaOk] = useState(true);
  const [smallArea, setSmallArea] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [finalRun, setFinalRun] = useState<ExerciseRun | null>(null);
  const engine = useRef<BaseEngine | null>(null);
  const runRef = useRef<ExerciseRun | null>(null);
  const area0 = useRef<{ w: number; h: number } | null>(null);
  const lastStatus = useRef(0);
  const lastSave = useRef(0);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const maxC = measuredMaxContacts();
  const needC = requiredContacts(def, cfg.fingers);
  const unsupported = maxC !== null && maxC < needC;
  const cal = calibrationFor(placement.calibration, cfg.hand);
  const recording = !!record && stage === 'run';

  // pausa automatica quando l'app passa in secondo piano
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === 'hidden' && engine.current && (stageRef.current === 'run' || stageRef.current === 'trial') && engine.current.phase !== 'done') {
        engine.current.pause(performance.now(), 'background');
        setPause('background');
      }
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', vis);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', vis); };
  }, []);

  const buildRun = useCallback((): ExerciseRun => {
    const { sets, reps } = plannedReps(def, cfg.params);
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(), sessionId: record?.session?.id ?? null, patientId: record!.patientId,
      programVersionId: cfg.programVersionId, programVersion: cfg.programVersion, programItemId: cfg.programItemId,
      exerciseId: def.id, exerciseVersion: def.version, metricsVersion: def.metricsVersion, mode: cfg.mode, hand: cfg.hand, fingers: cfg.fingers,
      params: cfg.params, progression: cfg.progression, calibrationId: cal?.id ?? null, status: 'started', startedAt: now, endedAt: null,
      localDate: localDay(), tz: timeZone(), activeMs: 0, setsPlanned: sets, setsDone: 0, repsPlanned: reps, repsValid: 0, attempts: 0,
      completionMet: false, completionCriteria: def.completion, interruptionReason: null, metrics: {}, detail: { reps: [], events: [] },
      device: deviceInfo(), area: { w: 0, h: 0 }, physicalScale: physicalScale(), origin: 'automatic',
    };
  }, [def, cfg, record, cal]);

  const startEngine = useCallback((w: number, h: number) => {
    const isTrial = stageRef.current === 'trial';
    const params = isTrial ? { ...cfg.params, sets: 1, reps: def.id === 'piano' ? 3 : 2, durationSec: 10, restSec: 0 } : cfg.params;
    const area = { w, h };
    area0.current = area;
    engine.current = createEngine({
      exerciseId: def.id, hand: cfg.hand, fingers: cfg.fingers, params, area,
      anchors: anchorsPx(placement, cfg.hand, area), comfort: comfortFor(placement, cfg.hand, def.id),
      pxPerMm: physicalScale()?.pxPerMm ?? null, seed: Math.floor(Math.random() * 2 ** 31),
    });
    engine.current.start(performance.now());
    if (!isTrial && record) {
      const r = { ...buildRun(), area };
      r.detail.notes = [`seed:${(engine.current.setup.seed)}`];
      runRef.current = r;
      void recordRun(r, record.outboxPatientId);
      void saveActive(record.userId, { session: record.session, run: r, patientId: record.outboxPatientId });
    }
  }, [cfg, def, placement, record, buildRun]);

  const snapshot = useCallback((final: boolean, status?: ExerciseRun['status'], reason?: string | null): ExerciseRun | null => {
    const e = engine.current, r = runRef.current;
    if (!e || !r) return null;
    const res = e.result();
    return {
      ...r, status: status ?? r.status, endedAt: final ? new Date().toISOString() : null, activeMs: res.activeMs,
      setsDone: res.setsDone, repsValid: res.repsValid, attempts: res.attempts, completionMet: res.completionMet,
      interruptionReason: reason ?? (res.endReason === 'attempt_limit' ? 'attempt_limit' : null), metrics: res.metrics,
      detail: { reps: res.reps.slice(0, 500), events: res.events, notes: [...(r.detail.notes ?? []), `paused_ms:${res.pausedMs}`, `rest_ms:${res.restMs}`, `pointer_types:touch`] },
    };
  }, []);

  const finishRun = useCallback(async (status: 'completed' | 'interrupted', reason?: string) => {
    const snap = snapshot(true, status, reason ?? null);
    if (snap && record) {
      await recordRun(snap, record.outboxPatientId);
      await saveActive(record.userId, { session: record.session, run: null, patientId: record.outboxPatientId });
    }
    setFinalRun(snap);
    return snap;
  }, [snapshot, record]);

  const onFrame = useCallback((t: number) => {
    const e = engine.current;
    if (!e) return;
    e.tick(t);
    if (t - lastStatus.current > 100) { lastStatus.current = t; setStatus(e.status(t)); }
    if (stageRef.current === 'run' && record && runRef.current && t - lastSave.current > 5000) {
      lastSave.current = t;
      const snap = snapshot(false);
      if (snap) void saveActive(record.userId, { session: record.session, run: snap, patientId: record.outboxPatientId });
    }
    if (e.phase === 'done' && !(e as any).__handled) {
      (e as any).__handled = true;
      if (stageRef.current === 'trial') { setTrialDone(true); engine.current = null; setStage('intro'); }
      else if (stageRef.current === 'run') {
        if (record) void finishRun(e.result().completionMet ? 'completed' : 'interrupted').then(() => setStage('results'));
        else { setFinalRun(null); setStage('results'); }
      }
    }
  }, [record, snapshot, finishRun]);

  const onResize = useCallback((w: number, h: number) => {
    setSmallArea(Math.min(w, h) < 300);
    if (!engine.current && (stageRef.current === 'run' || stageRef.current === 'trial') && w > 0 && h > 0) { startEngine(w, h); return; }
    const a = area0.current;
    if (engine.current && a) {
      const ok = Math.abs(a.w - w) / a.w < 0.03 && Math.abs(a.h - h) / a.h < 0.03;
      setAreaOk(ok);
      if (!ok && engine.current.phase !== 'done') { engine.current.pause(performance.now(), 'resize'); setPause('resize'); }
    }
  }, [startEngine]);

  const doPause = () => { engine.current?.pause(performance.now(), 'user'); setPause('user'); };
  const doResume = () => { engine.current?.resume(performance.now()); setPause(null); };

  const stopWith = async (reason: string, symptoms: { pain: number | null; fatigue: number | null; difficulty: number | null; note: string } | null) => {
    setStopOpen(false);
    if (stage === 'trial') { engine.current = null; setPause(null); setStage('intro'); return; }
    const snap = record ? await finishRun('interrupted', reason) : null;
    if (record && symptoms) await saveSymptom('stop', symptoms, snap?.id ?? null, reason);
    engine.current = null;
    onDone({ status: 'interrupted', run: snap, reason });
  };

  const saveSymptom = async (context: SymptomReport['context'], s: { pain: number | null; fatigue: number | null; difficulty: number | null; note: string }, runId: string | null, reason?: string) => {
    if (!record) return;
    const rep: SymptomReport = {
      id: crypto.randomUUID(), patientId: record.patientId, sessionId: record.session?.id ?? null, runId, at: new Date().toISOString(), localDate: localDay(), context,
      pain: s.pain, fatigue: s.fatigue, difficulty: s.difficulty, note: [reason ? `Motivo: ${stopReasonLabel(reason)}` : '', s.note].filter(Boolean).join(' – '),
    };
    await recordSymptom(rep, record.outboxPatientId);
  };

  // --- Schermata introduttiva
  if (stage === 'intro') {
    return (
      <div className="exercise-screen" style={{ overflowY: 'auto' }}>
        <div className="exercise-bar">
          <span className="title">{header ?? def.name}</span>
          <span className="spacer" />
          {allowSkip && <button onClick={() => onDone({ status: 'skipped', run: null, reason: 'skipped' })}>Salta</button>}
          <button onClick={() => onDone({ status: 'cancelled', run: null })}>Indietro</button>
        </div>
        <div className="patient-main">
          <div className="grid-2">
            <div>
              <h1>{def.name}</h1>
              <p className="row"><span className="badge info">Mano {handLabel(cfg.hand).toLowerCase()}</span> <span className="badge">{cfg.fingers.map(fingerLabel).join(' + ')}</span> {cfg.mode === 'assessment' && <span className="badge warn">Prova a condizioni fisse</span>} <ExperimentalBadge /></p>
              <h3>Posizione</h3>
              <ul>{def.positioning.map((p, i) => <li key={i}>{p}</li>)}</ul>
              <h3>Gesto</h3>
              <ul>{def.gesture.map((p, i) => <li key={i}>{p}</li>)}</ul>
              <p className="small muted">{def.limits}</p>
              {cfg.progression && <p className="small notice info">Progressione automatica: {cfg.progression.reason}. Valore usato oggi: {String(cfg.progression.value)}.</p>}
            </div>
            <div>
              <DemoAnimation exerciseId={def.id} hand={cfg.hand} />
              {!cal && <div className="notice warn small" style={{ marginTop: 10 }}>Nessuna taratura per questa mano: vengono usate posizioni e aree predefinite prudenti.</div>}
              {unsupported && (
                <div className="notice danger" style={{ marginTop: 10 }}>
                  Su questo tablet la verifica ha rilevato al massimo <b>{maxC}</b> contatti simultanei; questo esercizio ne richiede <b>{needC}</b>.
                  {def.alternatives.length > 0 && <> Alternativa da concordare con il fisioterapista: {def.alternatives.map((a) => getExercise(a)?.name).filter(Boolean).join(', ')}{def.id === 'piano' || def.id === 'slide' ? ', oppure lo stesso esercizio con meno dita' : ''}.</>}
                </div>
              )}
              {maxC === null && needC > 1 && <div className="notice info small" style={{ marginTop: 10 }}>Il numero di contatti simultanei di questo tablet non è ancora stato verificato (Impostazioni → Verifica touchscreen).</div>}
              {trialDone && <div className="notice ok" style={{ marginTop: 10 }}>Prova completata.</div>}
            </div>
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
            <button className="btn-huge" onClick={() => { setStage('trial'); setPause(null); }} disabled={unsupported && !!record}>{trialDone ? 'Ripeti la prova' : 'Prova (non registrata)'}</button>
            <button className="btn-huge btn-primary" data-testid="start-exercise" onClick={() => { setStage('run'); setPause(null); }} disabled={unsupported && !!record}>Inizia</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Risultati
  if (stage === 'results') {
    const r = finalRun;
    const res = r ? r.metrics : engine.current?.result().metrics ?? {};
    const completed = r ? r.completionMet : engine.current?.result().completionMet;
    const shown = def.metrics.filter((m) => m.primary || ['activeMs', 'contactLosses', 'meanRepMs', 'meanReactionMs', 'inCorridorRatio', 'onTargetRatio', 'meanRangeU', 'meanRangeMm'].includes(m.key)).filter((m) => res[m.key] !== null && res[m.key] !== undefined);
    return (
      <div className="exercise-screen" style={{ overflowY: 'auto' }}>
        <div className="exercise-bar"><span className="title">{def.name}</span><span className="spacer" /></div>
        <div className="patient-main">
          <h1>{completed ? 'Esercizio completato' : 'Esercizio terminato'}</h1>
          {!completed && r?.interruptionReason && <p className="notice warn">{stopReasonLabel(r.interruptionReason)}</p>}
          {!record && <p className="notice info">Prova senza registrazione: questi risultati non vengono salvati.</p>}
          <div className="kpis">
            {shown.map((m) => <div className="kpi" key={m.key}><div className="v">{fmtMetric(m, res[m.key])}</div><div className="l">{m.label}</div></div>)}
          </div>
          <p className="small muted">I valori descrivono l'attività rilevata dallo schermo; non misurano da soli la correttezza clinica del gesto.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn-huge btn-primary" data-testid="continue" onClick={() => onDone({ status: completed ? 'completed' : 'interrupted', run: r, reason: r?.interruptionReason ?? undefined })}>Continua</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Esercizio in corso (o prova)
  const st = status;
  return (
    <div className="exercise-screen">
      <div className="exercise-bar">
        <span className="title">{stage === 'trial' ? 'Prova' : def.name}</span>
        <div className="progress" style={{ width: 140 }} aria-label="Avanzamento"><div style={{ width: `${Math.round((st?.progress ?? 0) * 100)}%` }} /></div>
        <span className="msg" aria-live="polite" data-testid="exercise-message">{st?.phase === 'rest' ? `${st.message} · ${Math.ceil(st.restRemainingMs / 1000)} s` : st?.message ?? ''}</span>
        <span className="small muted" data-testid="rep-counter">{def.id === 'chase' ? `Serie ${st?.set ?? 1}/${st?.sets ?? 1}` : `${st?.validReps ?? 0}/${st?.targetReps ?? 0}`}</span>
        <button className="pause-btn btn-warn" onClick={doPause} data-testid="pause">Pausa</button>
        <button className="btn-danger" onClick={() => { doPause(); setStopOpen(true); }} data-testid="stop">Stop</button>
      </div>
      {/* riga a altezza fissa: la sua comparsa non deve cambiare le dimensioni dell'area di gioco */}
      <div className="small" style={{ textAlign: 'center', padding: '2px 4px', background: 'var(--surface)', height: 26, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{st?.detail ?? ''}</div>
      <TouchSurface
        label={`Area dell'esercizio ${def.name}`}
        handlers={{
          onResize,
          onFrame,
          onDown: (id, x, y, t) => engine.current?.pointerDown(id, x, y, t),
          onMove: (id, x, y, t) => engine.current?.pointerMove(id, x, y, t),
          onUp: (id, t, c) => engine.current?.pointerUp(id, t, c),
          draw: (ctx, _w, _h, t) => { if (engine.current) drawScene(ctx, engine.current.scene(t)); },
        }}
      />
      {smallArea && <div className="exercise-overlay"><div className="box"><h2>Spazio insufficiente</h2><p>Ruota il tablet in orizzontale o usa uno schermo più grande.</p></div></div>}
      {pause && !stopOpen && !reportOpen && (
        <div className="exercise-overlay" data-testid="pause-overlay">
          <div className="box">
            <h2>{pause === 'background' ? 'Esercizio in pausa: l\'app era in secondo piano' : pause === 'resize' ? 'Le dimensioni dello schermo sono cambiate' : 'Pausa'}</h2>
            {pause === 'resize' && <p>{areaOk ? 'Dimensioni ripristinate. Alla ripresa riappoggia le dita sulle posizioni indicate.' : 'Riporta il tablet nell\'orientamento iniziale per continuare, oppure termina l\'esercizio.'}</p>}
            {pause !== 'resize' && <p>Il tempo di pausa non viene conteggiato. Alla ripresa riappoggia le dita sulle posizioni indicate.</p>}
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn-huge btn-primary" onClick={doResume} disabled={!areaOk} data-testid="resume">Riprendi</button>
              {record && <button className="btn-huge" onClick={() => setReportOpen(true)}>Segnala dolore o fatica</button>}
              <button className="btn-huge btn-danger" onClick={() => setStopOpen(true)}>Termina</button>
            </div>
          </div>
        </div>
      )}
      {stopOpen && <StopDialog trial={stage === 'trial'} onCancel={() => setStopOpen(false)} onStop={stopWith} />}
      {reportOpen && <ReportDialog onCancel={() => setReportOpen(false)} onSave={async (s) => { await saveSymptom('during', s, runRef.current?.id ?? null); setReportOpen(false); }} />}
    </div>
  );
}

function StopDialog({ onStop, onCancel, trial }: { onStop: (reason: string, s: { pain: number | null; fatigue: number | null; difficulty: number | null; note: string } | null) => void; onCancel: () => void; trial: boolean }) {
  const [reason, setReason] = useState<string | null>(null);
  const [pain, setPain] = useState<number | null>(null);
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  if (trial) return (
    <div className="exercise-overlay"><div className="box"><h2>Interrompere la prova?</h2>
      <div className="row" style={{ justifyContent: 'center' }}><button className="btn-huge" onClick={onCancel}>Continua la prova</button><button className="btn-huge btn-danger" onClick={() => onStop('trial', null)}>Interrompi</button></div></div></div>
  );
  return (
    <div className="exercise-overlay" style={{ overflowY: 'auto', alignItems: 'flex-start' }}>
      <div className="box" style={{ textAlign: 'left' }}>
        <h2>Perché vuoi interrompere?</h2>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          {STOP_REASONS.map((r) => <button key={r.value} className={reason === r.value ? 'btn-primary' : ''} style={{ minHeight: 60 }} onClick={() => setReason(r.value)} data-testid={`reason-${r.value}`}>{r.label}</button>)}
        </div>
        {(reason === 'pain' || reason === 'fatigue' || reason === 'difficulty' || reason === 'other') && (
          <>
            <p><b>Dolore</b> adesso (facoltativo)</p>
            <NumberScale value={pain} onChange={setPain} labels={['nessun dolore', 'il peggiore immaginabile']} />
            <p style={{ marginTop: 12 }}><b>Affaticamento</b> (facoltativo)</p>
            <NumberScale value={fatigue} onChange={setFatigue} labels={['nessuno', 'massimo']} />
            <label className="field" style={{ marginTop: 12 }}><span>Vuoi aggiungere qualcosa? (facoltativo)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn-huge" onClick={onCancel}>Torna all'esercizio</button>
          <button className="btn-huge btn-danger" disabled={!reason} data-testid="confirm-stop" onClick={() => onStop(reason!, { pain, fatigue, difficulty: null, note })}>Interrompi</button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>In caso di dolore importante o insolito interrompi e contatta il tuo fisioterapista.</p>
      </div>
    </div>
  );
}

export function ReportDialog({ onSave, onCancel, title = 'Come va?', cancelLabel = 'Annulla' }: { onSave: (s: { pain: number | null; fatigue: number | null; difficulty: number | null; note: string }) => void; onCancel: () => void; title?: string; cancelLabel?: string }) {
  const [pain, setPain] = useState<number | null>(null);
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [note, setNote] = useState('');
  return (
    <div className="exercise-overlay" style={{ overflowY: 'auto', alignItems: 'flex-start' }}>
      <div className="box" style={{ textAlign: 'left' }}>
        <h2>{title}</h2>
        <p><b>Dolore</b></p>
        <NumberScale value={pain} onChange={setPain} labels={['nessun dolore', 'il peggiore immaginabile']} />
        <p style={{ marginTop: 12 }}><b>Affaticamento</b></p>
        <NumberScale value={fatigue} onChange={setFatigue} labels={['nessuno', 'massimo']} />
        <p style={{ marginTop: 12 }}><b>Difficoltà</b></p>
        <NumberScale value={difficulty} onChange={setDifficulty} labels={['molto facile', 'impossibile']} />
        <label className="field" style={{ marginTop: 12 }}><span>Note (facoltativo)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn-huge" onClick={onCancel} data-testid="report-cancel">{cancelLabel}</button>
          <button className="btn-huge btn-primary" data-testid="report-save" onClick={() => onSave({ pain, fatigue, difficulty, note })} disabled={pain === null && fatigue === null && difficulty === null && !note.trim()}>Salva</button>
        </div>
      </div>
    </div>
  );
}
