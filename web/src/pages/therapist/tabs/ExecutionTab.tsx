import { useState } from 'react';
import { addDays, CELL_LABELS, fingerLabel, formatParam, getExercise, localDay, stopReasonLabel, fmtDayIt, type CellState } from '@handlab/shared';
import { GET, POST, errMsg } from '../../../api';
import { useAsync, ErrorBox, Loading, Modal, DemoBadge, Confirm } from '../../../components/ui';
import { fmtAgo, fmtDateTime, fmtDay, fmtDuration, fmtMetric, fmtPct, fmtTime } from '../../../format';

const RUN_STATUS: Record<string, [string, string]> = {
  completed: ['Completato', 'ok'], interrupted: ['Interrotto', 'warn'], started: ['Iniziato, non concluso', 'warn'], invalid: ['Non valido', 'danger'],
};
const SESSION_STATUS: Record<string, [string, string]> = {
  completed: ['Completa', 'ok'], interrupted: ['Interrotta', 'warn'], in_progress: ['In corso / non chiusa', 'warn'], invalid: ['Non valida', 'danger'],
};
const CONTEXT: Record<string, string> = { pre: 'Inizio seduta', during: 'Durante l\'esercizio', post: 'Fine seduta', stop: 'Interruzione', free: 'Segnalazione libera' };

export function ExecutionTab({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const today = localDay();
  const [range, setRange] = useState({ from: addDays(today, -13), to: today });
  const { data, error, loading, reload } = useAsync(() => GET<any>(`/api/patients/${patient.id}/activity?from=${range.from}&to=${range.to}`), [patient.id, range.from, range.to]);
  const [detail, setDetail] = useState<string | null>(null);

  const preset = (days: number) => setRange({ from: addDays(today, -(days - 1)), to: today });

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <b>Periodo</b>
        <button className="btn-small" onClick={() => preset(7)}>7 giorni</button>
        <button className="btn-small" onClick={() => preset(14)}>14 giorni</button>
        <button className="btn-small" onClick={() => preset(28)}>28 giorni</button>
        <input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ width: 170 }} />
        <span>→</span>
        <input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ width: 170 }} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && <ActivityView data={data} onDetail={setDetail} />}
      {detail && <RunDetail runId={detail} canEdit={canEdit} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

function ActivityView({ data, onDetail }: { data: any; onDetail: (id: string) => void }) {
  const adh = data.adherence;
  const runs: any[] = data.runs;
  const sessions: any[] = data.sessions;
  const byItem = (itemId: string) => runs.filter((r) => r.programItemId === itemId && r.status !== 'invalid' && !r.technicalInvalid);
  return (
    <>
      <div className="notice info small">
        Ultima sincronizzazione: <b>{data.devices[0] ? fmtAgo(data.devices[0].lastSyncAt) : 'mai'}</b>.{' '}
        {data.confirmedThrough ? <>Dati confermati come completi fino al <b>{fmtDay(data.confirmedThrough)}</b>.</> : <>Completezza dei dati non ancora confermata dal tablet.</>}{' '}
        I giorni successivi senza attività sono indicati come "nessuna attività ricevuta", non come "non effettuato".
      </div>
      <div className="kpis">
        <div className="kpi"><div className="v">{adh.totals.completedWithinPrescription} / {adh.totals.prescribed}</div><div className="l">Esecuzioni completate / prescritte (fino a oggi)</div></div>
        <div className="kpi"><div className="v">{fmtPct(adh.totals.adherence)}</div><div className="l">Aderenza (completati entro il prescritto)</div></div>
        <div className="kpi"><div className="v">{sessions.filter((s) => s.status === 'completed').length} / {adh.sessionsPlanned}</div><div className="l">Sedute complete / previste</div></div>
        <div className="kpi"><div className="v">{adh.totals.interrupted}</div><div className="l">Esecuzioni interrotte</div></div>
        <div className="kpi"><div className="v">{adh.totals.notDone}</div><div className="l">Giorni-esercizio non effettuati</div></div>
        <div className="kpi"><div className="v">{adh.totals.pending}</div><div className="l">Giorni senza attività ricevuta</div></div>
        <div className="kpi"><div className="v">{fmtDuration(runs.reduce((a, r) => a + (r.activeMs ?? 0), 0))}</div><div className="l">Tempo attivo (escluse pause)</div></div>
      </div>

      <div className="card">
        <h3>Prescritto ed eseguito per giorno</h3>
        <div className="table-wrap">
          <table className="adh" data-testid="adherence-grid">
            <thead><tr><th></th>{adh.days.map((d: string) => <th key={d}>{d.slice(8)}/{d.slice(5, 7)}</th>)}</tr></thead>
            <tbody>
              {adh.items.map((it: any) => (
                <tr key={it.itemId}>
                  <th style={{ textAlign: 'left' }}>{getExercise(it.exerciseId)?.name}</th>
                  {adh.days.map((d: string) => {
                    const c = adh.cells.find((x: any) => x.date === d && x.itemId === it.itemId);
                    const st: CellState = c?.state ?? 'not_prescribed';
                    return <td key={d} className={`cell st-${st}`} title={`${fmtDayIt(d)} – ${CELL_LABELS[st]}${c ? ` (prescritti ${c.prescribed}, completati ${c.completed}, interrotti ${c.interrupted}, iniziati ${c.started})` : ''}`}>{c && c.prescribed > 1 ? `${c.completed}/${c.prescribed}` : c && c.completed > 1 ? c.completed : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          {(['completed', 'partial', 'interrupted', 'not_done', 'pending_sync', 'due', 'future', 'extra'] as CellState[]).map((s) => <span key={s}><span className={`sw st-${s}`} />{CELL_LABELS[s]}</span>)}
        </div>
      </div>

      <div className="card table-wrap">
        <h3>Confronto per esercizio nel periodo</h3>
        <table className="table">
          <thead><tr><th>Esercizio</th><th>Prescritte</th><th>Completate</th><th>Interrotte</th><th>Iniziate non concluse</th><th>Non effettuate (giorni)</th><th>Senza dati (giorni)</th><th>Serie rilevate</th><th>Ripetizioni valide / tentativi</th><th>Tempo attivo</th></tr></thead>
          <tbody>
            {adh.items.map((it: any) => {
              const rs = byItem(it.itemId);
              return (
                <tr key={it.itemId}>
                  <td>{getExercise(it.exerciseId)?.name}</td>
                  <td>{it.prescribed}</td>
                  <td>{it.completedTotal}{it.completedTotal > it.completedWithinPrescription ? <span className="small muted"> ({it.completedTotal - it.completedWithinPrescription} oltre il prescritto)</span> : ''}</td>
                  <td>{it.interrupted}</td><td>{it.started}</td><td>{it.notDone}</td><td>{it.pending}</td>
                  <td>{rs.reduce((a, r) => a + (r.setsDone ?? 0), 0)}</td>
                  <td>{rs.reduce((a, r) => a + (r.repsValid ?? 0), 0)} / {rs.reduce((a, r) => a + (r.attempts ?? 0), 0)}</td>
                  <td>{fmtDuration(rs.reduce((a, r) => a + (r.activeMs ?? 0), 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted">Un esercizio conta come completato solo quando soddisfa i criteri espliciti dell'esercizio: aprirlo non è un'esecuzione. Le ripetizioni sono quelle rilevate dal touchscreen.</p>
      </div>

      <div className="card table-wrap">
        <h3>Sedute</h3>
        {sessions.length === 0 ? <p className="muted">Nessuna seduta ricevuta nel periodo.</p> : (
          <table className="table" data-testid="sessions-table">
            <thead><tr><th>Giorno</th><th>Orario</th><th>Stato</th><th>Tempo attivo</th><th>Programma</th><th>Esercizi</th></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}>
                <td>{fmtDay(s.localDate)} <DemoBadge show={s.isDemo} /></td>
                <td>{fmtTime(s.startedAt)}–{s.endedAt ? fmtTime(s.endedAt) : '…'}<div className="small muted">{s.tz}</div></td>
                <td><span className={`badge ${SESSION_STATUS[s.status]?.[1]}`}>{SESSION_STATUS[s.status]?.[0] ?? s.status}</span>{s.interruptionReason && <div className="small">{stopReasonLabel(s.interruptionReason)}</div>}</td>
                <td>{fmtDuration(s.activeMs)}</td>
                <td>v{s.programVersion ?? '—'}{s.repositioning && <div className="small muted">riposizionamento: {s.repositioning.method === 'skipped' ? 'saltato' : s.repositioning.method === 'offset' ? 'con spostamento' : 'confermato'}</div>}</td>
                <td className="small">{(s.itemOutcomes ?? []).map((o: any) => { const it = runs.find((r) => r.id === o.runId); return <div key={o.itemId}>{getExercise(it?.exerciseId)?.name ?? (o.runId ? '' : 'esercizio')} {{ completed: '✓ completato', interrupted: '⚠ interrotto', skipped: '– saltato', not_reached: '– non raggiunto' }[o.status as string]}{o.reason ? ` (${stopReasonLabel(o.reason)})` : ''}</div>; })}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card table-wrap">
        <h3>Esecuzioni</h3>
        {runs.length === 0 ? <p className="muted">Nessuna esecuzione ricevuta nel periodo.</p> : (
          <table className="table" data-testid="runs-table">
            <thead><tr><th>Data e ora</th><th>Esercizio</th><th>Stato</th><th>Serie</th><th>Ripetizioni valide</th><th>Tempo attivo</th><th>Indicatore principale</th><th></th></tr></thead>
            <tbody>{runs.map((r) => {
              const def = getExercise(r.exerciseId);
              const sr = def?.metrics.find((m) => m.key === 'successRate');
              const st = r.technicalInvalid ? ['Tecnicamente non valida', 'danger'] : RUN_STATUS[r.status];
              return (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.startedAt)} <DemoBadge show={r.isDemo} /></td>
                  <td>{def?.name}<div className="small muted">{r.mode === 'assessment' ? 'condizioni fisse' : 'allenamento'} · {r.fingers.map(fingerLabel).join('+')}</div></td>
                  <td><span className={`badge ${st?.[1]}`}>{st?.[0]}</span>{r.interruptionReason && <div className="small">{stopReasonLabel(r.interruptionReason)}</div>}</td>
                  <td>{r.setsDone}/{r.setsPlanned}</td>
                  <td>{r.repsValid}/{r.repsPlanned}<div className="small muted">{r.attempts} tentativi</div></td>
                  <td>{fmtDuration(r.activeMs)}</td>
                  <td>{sr ? `${sr.label}: ${fmtMetric(sr, r.metrics?.successRate)}` : '—'}</td>
                  <td><button className="btn-small" onClick={() => onDetail(r.id)}>Dettagli</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      <div className="card table-wrap">
        <h3>Segnalazioni e sintomi riferiti dal paziente</h3>
        {data.symptoms.length === 0 ? <p className="muted">Nessuna segnalazione nel periodo.</p> : (
          <table className="table">
            <thead><tr><th>Quando</th><th>Contesto</th><th>Dolore</th><th>Affaticamento</th><th>Difficoltà</th><th>Note</th></tr></thead>
            <tbody>{data.symptoms.map((s: any) => (
              <tr key={s.id}><td>{fmtDateTime(s.at)} <DemoBadge show={s.isDemo} /></td><td>{CONTEXT[s.context]}</td><td>{s.pain ?? '—'}</td><td>{s.fatigue ?? '—'}</td><td>{s.difficulty ?? '—'}</td><td>{s.note || '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
        <p className="small muted">Valori 0–10 riferiti dal paziente. L'app non applica soglie cliniche automatiche.</p>
      </div>

      <div className="card table-wrap">
        <h3>Dispositivi</h3>
        {data.devices.length === 0 ? <p className="muted">Nessun tablet ha ancora sincronizzato.</p> : (
          <table className="table small"><thead><tr><th>Dispositivo</th><th>Ultima sincronizzazione</th><th>Ultimo invio completo</th><th>Fuso</th></tr></thead>
            <tbody>{data.devices.map((d: any) => <tr key={d.deviceId}><td>{d.deviceId.slice(0, 8)}…<div className="muted">{d.userAgent.slice(0, 80)}</div></td><td>{fmtDateTime(d.lastSyncAt)}</td><td>{fmtDateTime(d.lastEmptySyncAt)}</td><td>{d.tz}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}

export function RunDetail({ runId, canEdit, onClose, onChanged }: { runId: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { data: r, error } = useAsync(() => GET<any>(`/api/runs/${runId}`), [runId]);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const def = r ? getExercise(r.exerciseId) : undefined;
  return (
    <Modal title="Dettaglio esecuzione" onClose={onClose} wide>
      <ErrorBox error={error ?? err} />
      {r && def && (
        <>
          <dl className="dl">
            <dt>Esercizio</dt><dd>{def.name} (versione {r.exerciseVersion}, metriche {r.metricsVersion}) {r.mode === 'assessment' ? '· prova a condizioni fisse' : '· allenamento'}</dd>
            <dt>Inizio / fine</dt><dd>{fmtDateTime(r.startedAt)} – {fmtDateTime(r.endedAt)} ({r.tz})</dd>
            <dt>Stato</dt><dd>{RUN_STATUS[r.status]?.[0]}{r.interruptionReason ? ` – ${stopReasonLabel(r.interruptionReason)}` : ''}{r.technicalInvalid ? ` · tecnicamente non valida: ${r.technicalInvalidReason}` : ''}</dd>
            <dt>Criteri di completamento</dt><dd className="small">{r.completionCriteria} <b>{r.completionMet ? '→ soddisfatti' : '→ non soddisfatti'}</b></dd>
            <dt>Mano e dita</dt><dd>{r.hand === 'left' ? 'Sinistra' : 'Destra'} · {r.fingers.map(fingerLabel).join(' + ')}</dd>
            <dt>Parametri usati</dt><dd className="small">{def.params.map((p) => `${p.label}: ${formatParam(def, p.key, r.params[p.key])}`).join(' · ')}</dd>
            {r.progression && <><dt>Progressione</dt><dd className="small">livello {r.progression.level}: {r.progression.reason}</dd></>}
            <dt>Programma</dt><dd>versione {r.programVersion ?? '—'}</dd>
            <dt>Taratura</dt><dd>{r.calibrationId ? r.calibrationId.slice(0, 8) : 'nessuna (posizioni predefinite)'}</dd>
            <dt>Dispositivo</dt><dd className="small">{r.device?.userAgent} · area {Math.round(r.area?.w)}×{Math.round(r.area?.h)} px · rilevati max {r.device?.measuredMaxContacts ?? '?'} contatti{r.physicalScale ? ` · calibrazione fisica ${r.physicalScale.pxPerMm.toFixed(2)} px/mm (${r.physicalScale.method})` : ''}</dd>
          </dl>
          <h3 style={{ marginTop: 14 }}>Metriche</h3>
          <div className="table-wrap"><table className="table small"><tbody>
            {def.metrics.map((m) => <tr key={m.key}><td>{m.label}</td><td><b>{fmtMetric(m, r.metrics?.[m.key])}</b></td><td className="muted">{m.description}</td></tr>)}
          </tbody></table></div>
          <p className="small muted">{r.detail?.reps?.length ?? 0} ripetizioni dettagliate · {r.detail?.events?.length ?? 0} eventi tecnici registrati. Prova sperimentale non validata.</p>
          {canEdit && <button className={r.technicalInvalid ? '' : 'btn-warn'} onClick={() => setConfirm(true)}>{r.technicalInvalid ? 'Ripristina come valida' : 'Segna come tecnicamente non valida'}</button>}
          {confirm && <Confirm title="Validità tecnica" text="La modifica viene registrata nella cronologia con autore e motivo. Il dato originale resta conservato." needReason
            onCancel={() => setConfirm(false)}
            onConfirm={async (reason) => { try { await POST(`/api/runs/${runId}/validity`, { technicalInvalid: !r.technicalInvalid, reason }); setConfirm(false); onChanged(); onClose(); } catch (e) { setErr(errMsg(e)); } }} />}
        </>
      )}
    </Modal>
  );
}
