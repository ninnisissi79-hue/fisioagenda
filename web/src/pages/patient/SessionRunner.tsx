import { useEffect, useMemo, useRef, useState } from 'react';
import { getExercise, localDay, stopReasonLabel, type FingerId, type NPoint, type SymptomReport, type TrainingSession, type ProgramItem } from '@handlab/shared';
import { useAuth } from '../../auth';
import { effectiveParams, localRuns, todayItems, type MyProgram } from '../../local/program';
import { Player, ReportDialog, type PlayerOutcome } from '../../exercise/Player';
import { Reposition } from '../../exercise/Reposition';
import { clearActive, recordSession, recordSymptom, saveActive } from '../../local/activity';
import { deviceInfo, measuredMaxContacts, timeZone } from '../../local/device';
import { syncNow } from '../../local/sync';
import { SyncStatus } from '../../components/SyncStatus';

type Step = { kind: 'pre' } | { kind: 'reposition' } | { kind: 'item'; index: number } | { kind: 'rest'; next: number; until: number } | { kind: 'post' } | { kind: 'summary' };

/**
 * Seduta del paziente. La versione del programma viene fissata all'avvio: eventuali modifiche
 * ricevute durante la seduta si applicano dalla seduta successiva.
 */
export function SessionRunner({ program, onExit, onlyItemId }: { program: MyProgram; onExit: () => void; onlyItemId: string | null }) {
  const { user } = useAuth();
  const version = useRef(program.current!).current; // copia congelata
  const [plan, setPlan] = useState<ProgramItem[] | null>(null);
  const [local, setLocal] = useState<any[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'pre' });
  const [offset, setOffset] = useState<NPoint>({ x: 0, y: 0 });
  const [outcomes, setOutcomes] = useState<{ item: ProgramItem; o: PlayerOutcome }[]>([]);
  const session = useRef<TrainingSession | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void localRuns(user!.id).then((l) => {
      setLocal(l);
      const items = onlyItemId ? version.items.filter((i) => i.itemId === onlyItemId) : todayItems({ ...program, current: version }, l).filter((t) => t.remaining > 0).map((t) => t.item);
      setPlan(items);
    });
  }, []); // eslint-disable-line

  useEffect(() => { if (step.kind !== 'rest') return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [step.kind]);
  useEffect(() => { if (step.kind === 'rest' && now >= step.until) setStep({ kind: 'item', index: step.next }); }, [now, step]);

  const hand = plan?.[0]?.hand ?? 'right';
  const fingers = useMemo(() => {
    const set = new Set<FingerId>();
    for (const i of plan ?? []) if (i.hand === hand) i.fingers.forEach((f) => set.add(f));
    const order: FingerId[] = ['T', 'I', 'M', 'R', 'L'];
    const all = order.filter((f) => set.has(f));
    const max = measuredMaxContacts() ?? 5;
    return all.slice(0, Math.max(1, Math.min(max, all.length)));
  }, [plan, hand]);

  if (!plan || !user) return null;

  const startSession = async (repositioning: { method: 'accepted' | 'offset' | 'skipped'; offset: NPoint }) => {
    setOffset(repositioning.offset);
    const s: TrainingSession = {
      id: crypto.randomUUID(), patientId: user.patientId!, programVersionId: version.id, programVersion: version.version, calibrationId: program.calibration?.id ?? null,
      startedAt: new Date().toISOString(), endedAt: null, localDate: localDay(), tz: timeZone(), status: 'in_progress', interruptionReason: null, activeMs: 0,
      device: deviceInfo(), repositioning: { ...repositioning, at: new Date().toISOString() }, plannedItemIds: plan.map((i) => i.itemId),
    };
    session.current = s;
    await recordSession(s, null);
    await saveActive(user.id, { session: s, run: null, patientId: null });
    setStep({ kind: 'item', index: 0 });
  };

  const endSession = async (status: 'completed' | 'interrupted', reason: string | null, all = outcomes) => {
    const s = session.current;
    if (s) {
      const itemOutcomes = plan!.map((it, i) => {
        const o = all[i]?.o;
        return { itemId: it.itemId, status: !o || o.status === 'cancelled' ? 'not_reached' as const : o.status, reason: o?.reason ?? null, runId: o?.run?.id ?? null };
      });
      const done = { ...s, status, interruptionReason: reason, endedAt: new Date().toISOString(), activeMs: all.reduce((a, x) => a + (x.o.run?.activeMs ?? 0), 0), itemOutcomes };
      session.current = done;
      await recordSession(done, null);
      await clearActive(user.id);
    }
  };

  const onItemDone = async (index: number, o: PlayerOutcome) => {
    const item = plan[index];
    const all = [...outcomes, { item, o }];
    setOutcomes(all);
    if (o.status === 'cancelled') {
      // ritorno alla schermata precedente senza eseguire: la seduta termina come interrotta
      await endSession('interrupted', 'session_stopped', all);
      setStep({ kind: 'post' });
      return;
    }
    if (o.status === 'interrupted' && o.reason && ['pain', 'fatigue'].includes(o.reason)) {
      // dopo un'interruzione per dolore o affaticamento la seduta non prosegue automaticamente
      await endSession('interrupted', o.reason, all);
      setStep({ kind: 'post' });
      return;
    }
    if (index + 1 < plan.length) {
      const rest = version.restBetweenExercisesSec;
      setStep(rest > 0 ? { kind: 'rest', next: index + 1, until: Date.now() + rest * 1000 } : { kind: 'item', index: index + 1 });
    } else {
      const allCompleted = all.length === plan.length && all.every((x) => x.o.status === 'completed');
      await endSession(allCompleted ? 'completed' : 'interrupted', allCompleted ? null : 'skipped', all);
      setStep({ kind: 'post' });
    }
  };

  const saveReport = async (context: SymptomReport['context'], s: { pain: number | null; fatigue: number | null; difficulty: number | null; note: string }) => {
    await recordSymptom({ id: crypto.randomUUID(), patientId: user.patientId!, sessionId: session.current?.id ?? null, runId: null, at: new Date().toISOString(), localDate: localDay(), context, ...s }, null);
  };

  if (step.kind === 'pre') {
    return (
      <div className="exercise-screen" style={{ overflowY: 'auto' }}>
        <ReportDialog title="Prima di iniziare: come sta la mano? (facoltativo)" cancelLabel="Salta" onCancel={() => setStep({ kind: 'reposition' })} onSave={async (s) => { await saveReport('pre', s); setStep({ kind: 'reposition' }); }} />
      </div>
    );
  }

  if (step.kind === 'reposition') {
    return <Reposition calibration={program.calibration} hand={hand} fingers={fingers} onCancel={onExit} onDone={(r) => void startSession(r)} />;
  }

  if (step.kind === 'item') {
    const item = plan[step.index];
    const def = getExercise(item.exerciseId)!;
    const { params, progression } = effectiveParams(item, { ...program, current: version }, local);
    return (
      <Player
        key={item.itemId + step.index}
        def={def}
        header={`Esercizio ${step.index + 1} di ${plan.length}: ${def.name}`}
        cfg={{ hand: item.hand, fingers: item.fingers, params, mode: item.mode, programItemId: item.itemId, programVersionId: version.id, programVersion: version.version, progression }}
        placement={{ calibration: program.calibration, offset: item.hand === hand ? offset : { x: 0, y: 0 } }}
        record={{ userId: user.id, patientId: user.patientId!, outboxPatientId: null, session: session.current }}
        allowSkip
        onDone={(o) => void onItemDone(step.index, o)}
      />
    );
  }

  if (step.kind === 'rest') {
    const left = Math.max(0, Math.ceil((step.until - now) / 1000));
    return (
      <div className="exercise-screen"><div className="patient-main" style={{ textAlign: 'center' }}>
        <h1>Pausa</h1>
        <p style={{ fontSize: '2.5rem', fontWeight: 700 }}>{left} s</p>
        <p>Prossimo esercizio: <b>{getExercise(plan[step.next].exerciseId)?.name}</b></p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn-huge btn-primary" onClick={() => setStep({ kind: 'item', index: step.next })}>Continua subito</button>
          <button className="btn-huge btn-danger" onClick={async () => { await endSession('interrupted', 'session_stopped'); setStep({ kind: 'post' }); }}>Termina la seduta</button>
        </div>
      </div></div>
    );
  }

  if (step.kind === 'post') {
    return (
      <div className="exercise-screen" style={{ overflowY: 'auto' }}>
        <ReportDialog title="Alla fine: come sta la mano? (facoltativo)" cancelLabel="Salta" onCancel={() => { setStep({ kind: 'summary' }); void syncNow(); }} onSave={async (s) => { await saveReport('post', s); setStep({ kind: 'summary' }); void syncNow(); }} />
      </div>
    );
  }

  return (
    <div className="exercise-screen" style={{ overflowY: 'auto' }}>
      <div className="patient-main">
        <h1>{session.current?.status === 'completed' ? 'Seduta completata' : 'Seduta terminata'}</h1>
        <div className="big-list" style={{ marginBottom: 16 }}>
          {plan.map((it, i) => {
            const o = outcomes[i]?.o;
            return (
              <div className="big-item" key={it.itemId}>
                <div style={{ flex: 1 }}><b>{getExercise(it.exerciseId)?.name}</b></div>
                {!o ? <span className="badge">Non svolto</span> : o.status === 'completed' ? <span className="badge ok">Completato</span> : o.status === 'skipped' ? <span className="badge">Saltato</span> : <span className="badge warn">Interrotto{o.reason ? ` · ${stopReasonLabel(o.reason)}` : ''}</span>}
              </div>
            );
          })}
        </div>
        <SyncStatus />
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn-huge btn-primary" data-testid="back-home" onClick={onExit}>Torna all'inizio</button>
        </div>
      </div>
    </div>
  );
}
