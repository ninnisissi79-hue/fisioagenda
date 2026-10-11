import { useMemo, useState } from 'react';
import { comparabilityIssues, conditionSignature, difficultyParams, formatParam, getExercise, paramLabel, type ExerciseRun } from '@handlab/shared';
import { GET, POST, errMsg } from '../../../api';
import { useAsync, ErrorBox, Loading, Field, ExperimentalBadge } from '../../../components/ui';
import { LineChart, type ChartPoint } from '../../../components/LineChart';
import { fmtDateTime, fmtDay, fmtMetric, metricChartUnit, metricChartValue } from '../../../format';

export function ProgressTab({ patient, canEdit, onEditProgram }: { patient: any; canEdit: boolean; onEditProgram?: () => void }) {
  const runsQ = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/runs`), [patient.id]);
  const symQ = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/symptoms`), [patient.id]);
  const measQ = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/measures`), [patient.id]);
  const qQ = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/questionnaires`), [patient.id]);
  const calQ = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/calibrations`), [patient.id]);

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div className="notice info small">
        Le sezioni sono separate: <b>A</b> dati riferiti dal paziente, <b>B</b> prestazioni rilevate dal touchscreen (sperimentali, non validate), <b>C</b> misure cliniche inserite dal professionista.
        Un miglioramento nelle prestazioni del gioco non equivale a un cambiamento degli esiti clinici. Non viene calcolato alcun punteggio complessivo di recupero.
      </div>
      <SideNotes patient={patient} canEdit={canEdit} onEditProgram={onEditProgram} />
      <div className="card">
        <h2>B · Prestazioni touchscreen <ExperimentalBadge /></h2>
        <ErrorBox error={runsQ.error} />
        {runsQ.loading && !runsQ.data && <Loading />}
        {runsQ.data && <Performance runs={runsQ.data} calibrations={calQ.data ?? []} />}
      </div>
      <div className="card">
        <h2>A · Riferiti dal paziente</h2>
        {symQ.data && <Symptoms data={symQ.data} />}
      </div>
      <div className="card">
        <h2>C · Misure cliniche e questionari</h2>
        {measQ.data && <Measures data={measQ.data} />}
        {qQ.data && qQ.data.length > 0 && (
          <>
            <h3>Questionari (punteggi inseriti manualmente)</h3>
            <table className="table small"><thead><tr><th>Data</th><th>Strumento</th><th>Versione</th><th>Punteggio</th></tr></thead>
              <tbody>{qQ.data.map((q) => <tr key={q.id}><td>{fmtDay(q.date)}</td><td>{q.instrument}</td><td>{q.version}</td><td>{q.valueStatus === 'ok' ? `${q.score} ${q.scoreDescription}` : q.valueStatus === 'missing' ? 'dato mancante' : 'errore tecnico'}</td></tr>)}</tbody></table>
          </>
        )}
      </div>
    </div>
  );
}

function Performance({ runs, calibrations }: { runs: any[]; calibrations: any[] }) {
  const exercises = useMemo(() => [...new Set(runs.map((r) => r.exerciseId))], [runs]);
  const [ex, setEx] = useState<string>(exercises[0] ?? '');
  const def = getExercise(ex);
  const [metric, setMetric] = useState<string>('successRate');
  const [includeInterrupted, setIncludeInterrupted] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  if (!exercises.length) return <p className="muted">Nessuna esecuzione ricevuta.</p>;
  if (!def) return null;
  const mdef = def.metrics.find((m) => m.key === metric) ?? def.metrics.find((m) => m.key === 'successRate')!;
  const calV = (id: string | null) => (id ? `taratura v${calibrations.find((c) => c.id === id)?.version ?? '?'}` : 'senza taratura');
  const relevant = runs.filter((r) => r.exerciseId === ex && !r.technicalInvalid && (r.status === 'completed' || (includeInterrupted && r.status === 'interrupted')));
  const sigs = [...new Set(relevant.map((r) => conditionSignature(r)))];
  const sigLabel = (r: ExerciseRun) => {
    const d = difficultyParams(r);
    return `${Object.entries(d).map(([k, v]) => `${paramLabel(def, k)} ${formatParam(def, k, v)}`).join(', ')} · ${calV(r.calibrationId)} · tablet ${r.device?.deviceId?.slice(0, 4)}`;
  };
  const labels: Record<string, string> = {};
  for (const r of relevant) labels[conditionSignature(r)] = `C${sigs.indexOf(conditionSignature(r)) + 1}: ${sigLabel(r)}`;
  const toPoints = (mode: string): ChartPoint[] => relevant.filter((r) => r.mode === mode && r.metrics?.[mdef.key] !== null && r.metrics?.[mdef.key] !== undefined).map((r) => ({
    id: r.id, x: Date.parse(r.startedAt), y: metricChartValue(mdef, r.metrics[mdef.key]), group: conditionSignature(r),
    tip: [fmtDateTime(r.startedAt), `Condizione C${sigs.indexOf(conditionSignature(r)) + 1}`, r.progression ? `Progressione: livello ${r.progression.level} (${paramLabel(def, r.progression.param)} ${r.progression.value})` : '', r.status === 'interrupted' ? 'Interrotta' : '', r.isDemo ? 'DATO DIMOSTRATIVO' : ''].filter(Boolean),
  }));
  const toggle = (p: ChartPoint) => setSelected((s) => (s.includes(p.id!) ? s.filter((x) => x !== p.id) : [...s, p.id!].slice(-3)));
  const sel = selected.map((id) => runs.find((r) => r.id === id)).filter(Boolean);
  const training = toPoints('training'), assessment = toPoints('assessment');
  return (
    <>
      <div className="grid-3">
        <Field label="Esercizio"><select value={ex} onChange={(e) => { setEx(e.target.value); setSelected([]); }}>{exercises.map((e) => <option key={e} value={e}>{getExercise(e)?.name}</option>)}</select></Field>
        <Field label="Misura"><select value={mdef.key} onChange={(e) => setMetric(e.target.value)}>{def.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Field>
        <label className="check" style={{ marginTop: 22 }}><input type="checkbox" checked={includeInterrupted} onChange={(e) => setIncludeInterrupted(e.target.checked)} /> Includi esecuzioni interrotte</label>
      </div>
      <p className="small muted">{mdef.description}{mdef.higherIsBetter === null ? ' (nessuna direzione "migliore" predefinita)' : ''}{mdef.unit === 'u' ? ' Unità normalizzate: frazione del lato corto dell\'area di gioco, non centimetri.' : ''}</p>
      {sigs.length > 1 && <div className="notice warn small">I risultati provengono da {sigs.length} condizioni diverse (difficoltà, taratura o tablet): sono mostrati come serie separate e non sono direttamente equivalenti.</div>}
      {new Set(relevant.map((r) => r.exerciseVersion + '/' + r.metricsVersion)).size > 1 && <div className="notice danger small">Attenzione: versioni diverse dell'esercizio o del calcolo delle metriche nel periodo. La confrontabilità può essere compromessa.</div>}
      <h3>Allenamento adattivo</h3>
      <LineChart points={training} unit={metricChartUnit(mdef)} groupLabels={labels} onSelect={toggle} selected={new Set(selected)} />
      <h3 style={{ marginTop: 16 }}>Prove a condizioni fisse</h3>
      {assessment.length ? <LineChart points={assessment} unit={metricChartUnit(mdef)} groupLabels={labels} onSelect={toggle} selected={new Set(selected)} /> : <p className="muted small">Nessuna prova a condizioni fisse per questo esercizio. Puoi programmarle (modalità "Prova a condizioni fisse") o eseguirle in ambulatorio da Valutazioni.</p>}
      <p className="small muted">Tocca i punti per selezionare fino a 3 esecuzioni da confrontare.</p>
      {sel.length >= 2 && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <h3>Confronto tra esecuzioni selezionate</h3>
          {comparabilityIssues(sel[0], sel[1]).length > 0 && <div className="notice warn small">Non direttamente confrontabili: {comparabilityIssues(sel[0], sel[1]).join('; ')}{sel[2] ? `; terza: ${comparabilityIssues(sel[0], sel[2]).join('; ') || 'stesse condizioni'}` : ''}.</div>}
          <div className="table-wrap"><table className="table small">
            <thead><tr><th></th>{sel.map((r) => <th key={r.id}>{fmtDateTime(r.startedAt)}<div>{r.mode === 'assessment' ? 'cond. fisse' : 'allenamento'}</div></th>)}</tr></thead>
            <tbody>
              {def.params.filter((p) => p.group === 'difficulty').map((p) => <tr key={p.key}><td className="muted">{p.label}</td>{sel.map((r) => <td key={r.id}>{formatParam(def, p.key, r.params[p.key])}</td>)}</tr>)}
              <tr><td className="muted">Taratura</td>{sel.map((r) => <td key={r.id}>{calV(r.calibrationId)}</td>)}</tr>
              {def.metrics.map((m) => <tr key={m.key}><td>{m.label}</td>{sel.map((r) => <td key={r.id}><b>{fmtMetric(m, r.metrics?.[m.key])}</b></td>)}</tr>)}
            </tbody>
          </table></div>
          <button className="btn-small" onClick={() => setSelected([])}>Azzera selezione</button>
        </div>
      )}
    </>
  );
}

function Symptoms({ data }: { data: any[] }) {
  if (!data.length) return <p className="muted">Nessuna segnalazione.</p>;
  const pts = (k: 'pain' | 'fatigue' | 'difficulty'): ChartPoint[] => data.filter((s) => s[k] !== null).map((s) => ({ x: Date.parse(s.at), y: s[k], group: 'all', tip: [fmtDateTime(s.at), { pre: 'inizio seduta', post: 'fine seduta', stop: 'interruzione', during: 'durante', free: 'segnalazione libera' }[s.context as string] ?? '', s.note, s.isDemo ? 'DATO DIMOSTRATIVO' : ''].filter(Boolean) }));
  return (
    <div className="grid-2">
      <div><h3>Dolore (0–10)</h3><LineChart points={pts('pain')} unit="/10" height={180} groupLabels={{}} /></div>
      <div><h3>Affaticamento (0–10)</h3><LineChart points={pts('fatigue')} unit="/10" height={180} groupLabels={{}} /></div>
    </div>
  );
}

function Measures({ data }: { data: any[] }) {
  const keys = [...new Set(data.map((m) => `${m.name}|${m.side}|${m.unit}`))];
  if (!keys.length) return <p className="muted">Nessuna misura clinica inserita.</p>;
  return (
    <div className="grid-2">
      {keys.map((k) => {
        const [name, side, unit] = k.split('|');
        const ms = data.filter((m) => `${m.name}|${m.side}|${m.unit}` === k);
        const instruments = [...new Set(ms.map((m) => m.instrument))];
        const pts: ChartPoint[] = ms.filter((m) => m.valueStatus === 'ok').map((m) => ({ x: Date.parse(m.date), y: m.value, group: m.instrument, tip: [fmtDay(m.date), m.instrument, m.notes, m.isDemo ? 'DATO DIMOSTRATIVO' : ''].filter(Boolean) }));
        const missing = ms.filter((m) => m.valueStatus !== 'ok').length;
        return (
          <div key={k}>
            <h3>{name}{side !== 'na' ? ` – ${side === 'left' ? 'sinistra' : 'destra'}` : ''}</h3>
            {instruments.length > 1 && <div className="notice warn small">Strumenti diversi: valori non direttamente confrontabili.</div>}
            <LineChart points={pts} unit={unit} height={180} groupLabels={Object.fromEntries(instruments.map((i) => [i, i]))} />
            {missing > 0 && <p className="small muted">{missing} rilevazioni senza valore (mancanti o con errore tecnico).</p>}
          </div>
        );
      })}
    </div>
  );
}

function SideNotes({ patient, canEdit, onEditProgram }: { patient: any; canEdit: boolean; onEditProgram?: () => void }) {
  const notes = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/notes`), [patient.id]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Note e programma</h2>{canEdit && onEditProgram && <button className="btn-primary btn-small" onClick={onEditProgram}>Modifica programma</button>}</div>
      {canEdit && (
        <div className="row" style={{ marginTop: 10 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Aggiungi una nota clinica…" style={{ flex: 1, minWidth: 220 }} />
          <button disabled={!text.trim()} onClick={async () => { try { await POST(`/api/patients/${patient.id}/notes`, { text, category: 'clinical' }); setText(''); void notes.reload(); } catch (e) { setErr(errMsg(e)); } }}>Salva nota</button>
        </div>
      )}
      <ErrorBox error={err} />
      <ul className="small" style={{ marginBottom: 0 }}>{(notes.data ?? []).slice(0, 3).map((n) => <li key={n.id}>{fmtDateTime(n.createdAt)} – {n.authorName}: {n.text}</li>)}</ul>
    </div>
  );
}
