import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDayIt, getExercise, fingerLabel, localDay, type SymptomReport } from '@handlab/shared';
import { useAuth } from '../../auth';
import { loadMyProgram, localRuns, todayItems, type MyProgram } from '../../local/program';
import { useAsync, ErrorBox, Loading } from '../../components/ui';
import { SyncStatus, useSyncState } from '../../components/SyncStatus';
import { SessionRunner } from './SessionRunner';
import { ReportDialog } from '../../exercise/Player';
import { recordSymptom } from '../../local/activity';
import { fmtDateTime } from '../../format';

export function PatientHome() {
  const { user, logout, offline } = useAuth();
  const sync = useSyncState();
  const [running, setRunning] = useState(false);
  const [extra, setExtra] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const prog = useAsync(async () => {
    const p = await loadMyProgram(user!.id);
    return { p, local: await localRuns(user!.id) };
  }, [user?.id]);

  // aggiorna lo stato dopo una sincronizzazione
  useEffect(() => { if (!running && sync.lastSyncAt) void prog.reload(); /* eslint-disable-next-line */ }, [sync.lastSyncAt]);

  if (running && prog.data?.p) {
    return <SessionRunner program={prog.data.p} onlyItemId={extra} onExit={() => { setRunning(false); setExtra(null); void prog.reload(); }} />;
  }

  const p: MyProgram | null | undefined = prog.data?.p;
  const items = p ? todayItems(p, prog.data!.local) : [];
  const due = items.filter((i) => i.remaining > 0);
  const prescribedToday = items.filter((i) => i.prescribed > 0);

  const confirmLogout = async () => {
    if (sync.pending > 0 && !window.confirm(`Ci sono ${sync.pending} attività non ancora inviate. Se esci restano sul tablet e verranno inviate al prossimo accesso con il tuo account. Uscire?`)) return;
    await logout();
  };

  return (
    <div className="patient-shell">
      {offline && <div className="offline-banner">Senza connessione: puoi fare gli esercizi, i dati verranno inviati più tardi.</div>}
      {user?.isDemo && <div className="demo-banner">Account dimostrativo – dati fittizi</div>}
      <div className="patient-top">
        <span className="brand"><img src="/icons/icon.svg" alt="" width={34} height={34} /> Hand Lab</span>
        <span className="spacer" />
        <Link to="/verifica" className="btn btn-small">Verifica touchscreen</Link>
        <button className="btn-small" onClick={confirmLogout}>Esci</button>
      </div>
      <main className="patient-main">
        <h1>Il tuo programma di oggi</h1>
        <p className="muted">{fmtDayIt(localDay())}</p>
        {saved && <div className="notice ok">{saved}</div>}
        <ErrorBox error={prog.error} onRetry={prog.reload} />
        {prog.loading && !prog.data && <Loading />}
        {p === null && <div className="notice warn">Non è stato possibile scaricare il programma e non ce n'è una copia su questo tablet. Collegati a internet e riprova.</div>}
        {p && (
          <>
            {p.fromCache && <div className="notice info small">Programma salvato sul tablet il {fmtDateTime(p.fetchedAt)}. Eventuali modifiche del fisioterapista arriveranno quando torna la connessione.</div>}
            {!p.current && <div className="notice info">Il fisioterapista non ha ancora assegnato un programma.</div>}
            {p.current && !p.calibration && <div className="notice warn">Prima di iniziare serve la taratura iniziale con il fisioterapista.</div>}
            {p.upcoming.length > 0 && <div className="notice info small">Dal {fmtDayIt(p.upcoming[0].effectiveFrom)} il programma sarà aggiornato dal fisioterapista.</div>}
            {p.current && (
              <>
                <div className="big-list" style={{ marginBottom: 20 }}>
                  {items.filter((i) => i.prescribed > 0).map((i) => {
                    const def = getExercise(i.item.exerciseId);
                    return (
                      <div className="big-item" key={i.item.itemId} data-testid="today-item">
                        <div className="ico" aria-hidden>✋</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>{def?.name}</div>
                          <div className="small muted">{i.item.fingers.map(fingerLabel).join(' + ')} · {i.prescribed > 1 ? `${i.prescribed} volte oggi` : 'una volta oggi'}</div>
                        </div>
                        {i.remaining === 0 ? <span className="badge ok">Fatto ✓</span> : i.completed > 0 ? <span className="badge info">{i.completed}/{i.prescribed}</span> : i.started > 0 ? <span className="badge warn">Da completare</span> : <span className="badge">Da fare</span>}
                      </div>
                    );
                  })}
                  {prescribedToday.length === 0 && <div className="notice info">Oggi non sono previsti esercizi.</div>}
                </div>
                <div className="row" style={{ justifyContent: 'center', marginBottom: 20 }}>
                  {due.length > 0 && <button className="btn-huge btn-primary" data-testid="start-session" disabled={!p.calibration} onClick={() => setRunning(true)}>Inizia la seduta</button>}
                  {due.length === 0 && prescribedToday.length > 0 && <div className="notice ok" style={{ fontSize: '1.15rem' }}>Hai completato il programma di oggi. Bravo!</div>}
                </div>
                {p.calibration && (
                  <details className="card">
                    <summary style={{ cursor: 'pointer', minHeight: 40 }}>Ripetere un esercizio (facoltativo)</summary>
                    <div className="row" style={{ marginTop: 10 }}>
                      {p.current.items.filter((i) => i.status === 'active').map((i) => <button key={i.itemId} onClick={() => { setExtra(i.itemId); setRunning(true); }}>{getExercise(i.exerciseId)?.name}</button>)}
                    </div>
                  </details>
                )}
              </>
            )}
          </>
        )}
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="btn-huge" onClick={() => setReport(true)}>Segnala dolore o un problema</button>
        </div>
        <SyncStatus />
      </main>
      {report && (
        <ReportDialog title="Segnala al fisioterapista" onCancel={() => setReport(false)} onSave={async (s) => {
          const rep: SymptomReport = { id: crypto.randomUUID(), patientId: user!.patientId!, sessionId: null, runId: null, at: new Date().toISOString(), localDate: localDay(), context: 'free', ...s };
          await recordSymptom(rep, null);
          setReport(false);
          setSaved('Segnalazione salvata. Verrà inviata al fisioterapista. Se il dolore è importante o insolito contatta direttamente il tuo fisioterapista.');
        }} />
      )}
    </div>
  );
}
