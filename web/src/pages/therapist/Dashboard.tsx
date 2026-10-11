import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExercise, handLabel } from '@handlab/shared';
import { GET } from '../../api';
import { useAsync, ErrorBox, Loading, DemoBadge } from '../../components/ui';
import { fmtAgo, fmtDateTime, fmtDay, fmtPct } from '../../format';
import { PatientForm } from './PatientForm';

export function Dashboard() {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useAsync(() => GET<any[]>('/api/patients'), []);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pazienti</h1>
          <p className="muted small" style={{ margin: 0 }}>Pazienti assegnati a te. Riepilogo degli ultimi 7 giorni.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ Nuovo paziente</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <div className="card">Nessun paziente assegnato. Crea un nuovo paziente o chiedi a un collega di autorizzarti.</div>}
      {data && data.length > 0 && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table" data-testid="patients-table">
            <thead>
              <tr>
                <th>Paziente</th><th>Programma attuale</th><th>Ultima attività</th><th>Sedute (7 gg)</th><th>Esercizi</th><th>Segnalazioni</th><th>Misure</th><th>Ultima sincronizzazione</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const s = p.summary;
                return (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/pazienti/${p.id}`)}>
                    <td>
                      <b>{p.code}</b> <DemoBadge show={p.isDemo} />
                      <div className="small muted">Mano {p.affectedHand === 'both' ? 'entrambe' : handLabel(p.affectedHand).toLowerCase()}{p.accessLevel !== 'owner' ? ` · accesso: ${p.accessLevel === 'editor' ? 'modifica' : 'lettura'}` : ''}</div>
                    </td>
                    <td>
                      {s.program ? <>v{s.program.version} dal {fmtDay(s.program.effectiveFrom)}<div className="small muted">{s.program.exercises.map((e: string) => getExercise(e)?.name).join(', ')}{s.program.suspendedItems ? ` · ${s.program.suspendedItems} sospesi` : ''}</div></> : <span className="badge">Nessun programma</span>}
                      {s.upcomingProgram && <div className="small"><span className="badge info">v{s.upcomingProgram.version} dal {fmtDay(s.upcomingProgram.effectiveFrom)}</span></div>}
                      {!s.calibration && <div className="small"><span className="badge warn">Taratura mancante</span></div>}
                    </td>
                    <td>{s.lastActivity ? <>{fmtDateTime(s.lastActivity.at)}<div className="small muted">{getExercise(s.lastActivity.exerciseId)?.name}</div></> : <span className="muted">—</span>}</td>
                    <td>
                      <b>{s.week.sessionsCompleted}</b> / {s.week.sessionsPlanned} <span className="small muted">complete / previste</span>
                      {s.week.sessionsInterrupted > 0 && <div className="small"><span className="badge warn">{s.week.sessionsInterrupted} interrotte</span></div>}
                    </td>
                    <td>
                      Aderenza {fmtPct(s.week.adherence)}
                      <div className="small">
                        {s.week.notDone > 0 && <span className="badge danger">{s.week.notDone} non effettuati</span>}{' '}
                        {s.week.interrupted > 0 && <span className="badge warn">{s.week.interrupted} interrotti</span>}{' '}
                        {s.week.pending > 0 && <span className="badge" title="Nessuna attività ricevuta: potrebbero esserci dati non ancora sincronizzati">{s.week.pending} senza dati ricevuti</span>}
                      </div>
                    </td>
                    <td>
                      {s.symptoms.count === 0 ? <span className="muted">—</span> : <>
                        {s.symptoms.count} <span className="small muted">segnalazioni</span>
                        <div className="small">{s.symptoms.maxPain !== null && <span className={`badge ${s.symptoms.maxPain >= 5 ? 'danger' : ''}`}>dolore max {s.symptoms.maxPain}/10</span>} {s.symptoms.stops > 0 && <span className="badge warn">{s.symptoms.stops} interruzioni</span>}</div>
                      </>}
                    </td>
                    <td className="small">
                      {s.measureTrends.length === 0 ? <span className="muted">—</span> : s.measureTrends.slice(0, 2).map((m: any) => (
                        <div key={m.name + m.side}>{m.name}{m.side !== 'na' ? ` (${m.side === 'left' ? 'sx' : 'dx'})` : ''}: {m.previous !== null ? `${m.previous} → ` : ''}<b>{m.last ?? '—'}</b> {m.unit}</div>
                      ))}
                    </td>
                    <td className="small">{s.lastSync ? fmtAgo(s.lastSync) : <span className="badge">mai</span>}<div className="muted">{s.confirmedThrough ? `dati completi fino al ${fmtDay(s.confirmedThrough)}` : 'completezza non confermata'}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">"Senza dati ricevuti": giorni passati per cui il tablet non ha ancora confermato l'invio completo dei dati. Non equivale a "non effettuato".</p>
      {creating && <PatientForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); nav(`/pazienti/${id}`); }} />}
    </div>
  );
}
