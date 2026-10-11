import { useState } from 'react';
import { availableExercises, defaultParams, fingerLabel, getExercise, localDay, validateFingers, ALL_FINGERS, type FingerId, type Hand } from '@handlab/shared';
import { DEL, GET, POST, PUT, errMsg } from '../../../api';
import { useAsync, ErrorBox, Field, Modal, DemoBadge, Confirm } from '../../../components/ui';
import { fmtDateTime, fmtDay } from '../../../format';
import { Player } from '../../../exercise/Player';
import { useAuth } from '../../../auth';

const CATS: Record<string, string> = { rom: 'Mobilità articolare', grip: 'Forza di presa', pinch: 'Forza di pinza', test: 'Test clinico', other: 'Altro' };
const STATUS: Record<string, string> = { ok: 'Valore presente', missing: 'Dato mancante', technical_error: 'Errore tecnico', not_applicable: 'Non applicabile' };

export function AssessmentsTab({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  return (
    <div>
      <Measures patient={patient} canEdit={canEdit} />
      <Questionnaires patient={patient} canEdit={canEdit} />
      <ClinicTouchTest patient={patient} canEdit={canEdit} />
    </div>
  );
}

const EMPTY_M = { date: localDay(), category: 'grip', name: '', side: 'right', value: '' as any, valueStatus: 'ok', unit: '', instrument: '', notes: '' };

function Measures({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const q = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/measures`), [patient.id]);
  const [form, setForm] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const names = [...new Set((q.data ?? []).map((m) => m.name))];
  const save = async () => {
    setErr(null);
    const body = { ...form, value: form.valueStatus === 'ok' ? (form.value === '' ? null : Number(form.value)) : null };
    delete body.id; delete body.reason;
    try {
      if (form.id) await PUT(`/api/measures/${form.id}`, { measure: body, reason: form.reason ?? '' });
      else await POST(`/api/patients/${patient.id}/measures`, body);
      setForm(null); void q.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Misure cliniche</h2>{canEdit && <button className="btn-primary" onClick={() => setForm({ ...EMPTY_M, side: patient.affectedHand === 'left' ? 'left' : 'right' })}>+ Nuova misura</button>}</div>
      <p className="small muted">Inserite dal professionista con unità e strumento. Zero, dato mancante ed errore tecnico sono registrati separatamente.</p>
      <ErrorBox error={q.error} />
      {q.data && q.data.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Data</th><th>Misura</th><th>Lato</th><th>Valore</th><th>Strumento</th><th>Inserita da</th><th></th></tr></thead>
          <tbody>{q.data.map((m) => (
            <tr key={m.id}>
              <td>{fmtDay(m.date)} <DemoBadge show={m.isDemo} /></td>
              <td>{m.name}<div className="small muted">{CATS[m.category]}</div></td>
              <td>{m.side === 'na' ? '—' : m.side === 'left' ? 'Sinistra' : 'Destra'}</td>
              <td>{m.valueStatus === 'ok' ? <b>{m.value} {m.unit}</b> : <span className="badge warn">{STATUS[m.valueStatus]}</span>}</td>
              <td className="small">{m.instrument}{m.notes && <div className="muted">{m.notes}</div>}</td>
              <td className="small">{m.enteredByName}<div className="muted">{m.updatedAt !== m.createdAt ? `corretta il ${fmtDateTime(m.updatedAt)}` : ''}</div></td>
              <td>{canEdit && <div className="row"><button className="btn-small" onClick={() => setForm({ ...m, value: m.value ?? '', reason: '' })}>Correggi</button><button className="btn-small" onClick={() => setDel(m)}>Elimina</button></div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {form && (
        <Modal title={form.id ? 'Correggi misura' : 'Nuova misura clinica'} onClose={() => setForm(null)}>
          <div className="grid-2">
            <Field label="Data"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Categoria"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Nome della misura"><input list="measure-names" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="es. Flessione MCF II attiva" /><datalist id="measure-names">{names.map((n) => <option key={n} value={n} />)}</datalist></Field>
            <Field label="Lato"><select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option value="right">Destra</option><option value="left">Sinistra</option><option value="na">Non applicabile</option></select></Field>
            <Field label="Stato del valore"><select value={form.valueStatus} onChange={(e) => setForm({ ...form, valueStatus: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Valore"><input type="number" step="any" disabled={form.valueStatus !== 'ok'} value={form.valueStatus === 'ok' ? form.value : ''} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
            <Field label="Unità"><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="es. kg, °, s" /></Field>
            <Field label="Strumento utilizzato"><input value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} placeholder="es. modello del dinamometro, goniometro" /></Field>
          </div>
          <Field label="Note"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {form.id && <Field label="Motivo della correzione (obbligatorio)"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>}
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => setForm(null)}>Annulla</button><button className="btn-primary" onClick={save} disabled={!form.name || (form.valueStatus === 'ok' && form.value === '') || (form.id && (form.reason ?? '').length < 3)}>Salva</button></div>
        </Modal>
      )}
      {del && <Confirm title="Eliminare la misura?" text="La misura non comparirà più nei grafici; l'eliminazione resta nella cronologia con il motivo." needReason danger confirmLabel="Elimina"
        onCancel={() => setDel(null)} onConfirm={async (reason) => { try { await DEL(`/api/measures/${del.id}`, { reason }); setDel(null); void q.reload(); } catch (e) { setErr(errMsg(e)); } }} />}
    </div>
  );
}

const EMPTY_Q = { date: localDay(), instrument: '', version: '', score: '' as any, valueStatus: 'ok', scoreDescription: '', notes: '' };

function Questionnaires({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const q = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/questionnaires`), [patient.id]);
  const [form, setForm] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const body = { ...form, score: form.valueStatus === 'ok' ? Number(form.score) : null };
    delete body.id; delete body.reason;
    try {
      if (form.id) await PUT(`/api/questionnaires/${form.id}`, { result: body, reason: form.reason ?? '' });
      else await POST(`/api/patients/${patient.id}/questionnaires`, body);
      setForm(null); void q.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Questionari</h2>{canEdit && <button className="btn-primary" onClick={() => setForm({ ...EMPTY_Q })}>+ Inserisci risultato</button>}</div>
      <div className="notice info small" style={{ marginTop: 10 }}>
        La compilazione dei questionari (es. QuickDASH) all'interno dell'app non è ancora disponibile: prima di riprodurli occorre verificare versione italiana ufficiale, condizioni d'uso e regole di calcolo.
        Per ora puoi inserire manualmente il punteggio ottenuto con lo strumento originale, indicando strumento, versione e data. L'app non calcola né modifica i punteggi.
      </div>
      {q.data && q.data.length > 0 && (
        <table className="table"><thead><tr><th>Data</th><th>Strumento</th><th>Versione</th><th>Punteggio</th><th>Note</th><th></th></tr></thead>
          <tbody>{q.data.map((r) => <tr key={r.id}><td>{fmtDay(r.date)}</td><td>{r.instrument}</td><td>{r.version}</td><td>{r.valueStatus === 'ok' ? <b>{r.score}</b> : <span className="badge warn">{STATUS[r.valueStatus]}</span>} <span className="small muted">{r.scoreDescription}</span></td><td className="small">{r.notes}</td><td>{canEdit && <button className="btn-small" onClick={() => setForm({ ...r, score: r.score ?? '', reason: '' })}>Correggi</button>}</td></tr>)}</tbody></table>
      )}
      {form && (
        <Modal title={form.id ? 'Correggi risultato' : 'Inserisci risultato di un questionario'} onClose={() => setForm(null)}>
          <div className="grid-2">
            <Field label="Data"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Strumento"><input value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} placeholder="es. QuickDASH" /></Field>
            <Field label="Versione dello strumento" hint="es. versione italiana e fonte utilizzata"><input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
            <Field label="Stato"><select value={form.valueStatus} onChange={(e) => setForm({ ...form, valueStatus: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Punteggio"><input type="number" step="any" disabled={form.valueStatus !== 'ok'} value={form.valueStatus === 'ok' ? form.score : ''} onChange={(e) => setForm({ ...form, score: e.target.value })} /></Field>
            <Field label="Descrizione del punteggio" hint="es. scala 0–100 secondo le istruzioni dello strumento"><input value={form.scoreDescription} onChange={(e) => setForm({ ...form, scoreDescription: e.target.value })} /></Field>
          </div>
          <Field label="Note"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {form.id && <Field label="Motivo della correzione (obbligatorio)"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>}
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => setForm(null)}>Annulla</button><button className="btn-primary" onClick={save} disabled={!form.instrument || !form.version || (form.valueStatus === 'ok' && form.score === '') || (form.id && (form.reason ?? '').length < 3)}>Salva</button></div>
        </Modal>
      )}
    </div>
  );
}

function ClinicTouchTest({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const { user } = useAuth();
  const cal = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/calibrations`), [patient.id]);
  const [ex, setEx] = useState('pinch');
  const def = getExercise(ex)!;
  const [hand, setHand] = useState<Hand>(patient.affectedHand === 'left' ? 'left' : 'right');
  const [fingers, setFingers] = useState<FingerId[]>(def.defaultFingers);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!canEdit) return null;
  const latest = cal.data?.[0] ?? null;
  if (running) {
    return <Player def={def} cfg={{ hand, fingers, params: defaultParams(def), mode: 'assessment', programItemId: null, programVersionId: null, programVersion: null, progression: null }}
      placement={{ calibration: latest, offset: { x: 0, y: 0 } }}
      record={{ userId: user!.id, patientId: patient.id, outboxPatientId: patient.id, session: null }}
      onDone={(o) => { setRunning(false); setDone(o.run ? `Prova registrata (${o.status === 'completed' ? 'completata' : 'interrotta'}). Verrà inviata al server con la prossima sincronizzazione.` : null); }} />;
  }
  const fe = validateFingers(def, fingers);
  return (
    <div className="card">
      <h2>Prova touchscreen a condizioni fisse (in ambulatorio)</h2>
      <p className="small muted">Esegue l'esercizio su questo tablet con i parametri predefiniti del catalogo, senza progressione, e registra il risultato come prova a condizioni fisse per {patient.code}. Usa la taratura più recente del paziente{latest ? ` (v${latest.version})` : ' (assente: posizioni predefinite)'}.</p>
      {done && <div className="notice ok">{done}</div>}
      <div className="grid-3">
        <Field label="Esercizio"><select value={ex} onChange={(e) => { setEx(e.target.value); setFingers(getExercise(e.target.value)!.defaultFingers); }}>{availableExercises().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Mano"><select value={hand} onChange={(e) => setHand(e.target.value as Hand)}><option value="right">Destra</option><option value="left">Sinistra</option></select></Field>
      </div>
      <Field label={`Dita (${def.fingerRule.roles.join(' → ')})`}>
        <div className="finger-pick">{ALL_FINGERS.map((f) => <button key={f} className={fingers.includes(f) ? 'sel' : ''} onClick={() => setFingers(fingers.includes(f) ? fingers.filter((x) => x !== f) : [...fingers, f])}>{fingers.includes(f) ? `${fingers.indexOf(f) + 1}. ` : ''}{fingerLabel(f)}</button>)}</div>
        {fe && <div className="hint" style={{ color: 'var(--danger)' }}>{fe}</div>}
      </Field>
      <button className="btn-primary" disabled={!!fe} onClick={() => { setDone(null); setRunning(true); }}>Avvia la prova su questo tablet</button>
    </div>
  );
}
