import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fingerLabel, getExercise, handLabel } from '@handlab/shared';
import { DEL, GET, POST, download, errMsg } from '../../../api';
import { useAsync, ErrorBox, Field, DemoBadge } from '../../../components/ui';
import { fmtAgo, fmtDateTime, fmtDay, fmtPct } from '../../../format';
import { PatientForm } from '../PatientForm';

const HAND: Record<string, string> = { right: 'Destra', left: 'Sinistra', both: 'Entrambe', ambidextrous: 'Ambidestro', unknown: 'Non indicata' };

export function OverviewTab({ patient, canEdit, onChanged }: { patient: any; canEdit: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const s = patient.summary;
  return (
    <div>
      {s && (
        <div className="kpis">
          <div className="kpi"><div className="v">{s.program ? `v${s.program.version}` : '—'}</div><div className="l">Programma in vigore{s.program ? ` dal ${fmtDay(s.program.effectiveFrom)}` : ''}</div></div>
          <div className="kpi"><div className="v">{s.lastActivity ? fmtAgo(s.lastActivity.at) : '—'}</div><div className="l">Ultima attività registrata</div></div>
          <div className="kpi"><div className="v">{s.week.sessionsCompleted}/{s.week.sessionsPlanned}</div><div className="l">Sedute complete / previste (7 gg)</div></div>
          <div className="kpi"><div className="v">{fmtPct(s.week.adherence)}</div><div className="l">Aderenza esercizi (7 gg)</div></div>
          <div className="kpi"><div className="v">{s.week.notDone + s.week.interrupted}</div><div className="l">Esercizi saltati o interrotti (7 gg)</div></div>
          <div className="kpi"><div className="v">{s.symptoms.count}</div><div className="l">Segnalazioni (7 gg){s.symptoms.maxPain !== null ? ` · dolore max ${s.symptoms.maxPain}/10` : ''}</div></div>
          <div className="kpi"><div className="v">{s.lastSync ? fmtAgo(s.lastSync) : 'mai'}</div><div className="l">Ultima sincronizzazione</div></div>
        </div>
      )}
      {s?.symptoms.latest && <div className="notice warn small">Ultima segnalazione ({fmtDateTime(s.symptoms.latest.at)}): dolore {s.symptoms.latest.pain ?? '—'}/10, affaticamento {s.symptoms.latest.fatigue ?? '—'}/10 {s.symptoms.latest.note ? `– ${s.symptoms.latest.note}` : ''}</div>}
      {s?.measureTrends?.length > 0 && <div className="card small"><b>Misure principali:</b> {s.measureTrends.map((m: any) => `${m.name}${m.side !== 'na' ? ` (${m.side === 'left' ? 'sx' : 'dx'})` : ''}: ${m.previous !== null ? `${m.previous} (${fmtDay(m.previousDate)}) → ` : ''}${m.last ?? '—'} ${m.unit} (${fmtDay(m.lastDate)})`).join(' · ')}</div>}
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Scheda paziente</h2>{canEdit && <button onClick={() => setEdit(true)}>Modifica scheda</button>}</div>
        <dl className="dl" style={{ marginTop: 12 }}>
          <dt>Codice</dt><dd>{patient.code} <DemoBadge show={patient.isDemo} /></dd>
          <dt>Fascia d'età</dt><dd>{patient.ageBand || '—'}</dd>
          <dt>Mano interessata</dt><dd>{HAND[patient.affectedHand]}</dd>
          <dt>Mano dominante</dt><dd>{HAND[patient.dominantHand]}</dd>
          <dt>Problema trattato</dt><dd>{patient.condition || '—'}</dd>
          <dt>Intervento</dt><dd>{patient.surgery || '—'}{patient.surgeryDate ? ` (${fmtDay(patient.surgeryDate)})` : ''}</dd>
          <dt>Fase del percorso</dt><dd>{patient.phase || '—'}</dd>
          <dt>Limitazioni</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{patient.limitations || '—'}</dd>
          <dt>Obiettivi funzionali</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{patient.goals || '—'}</dd>
          <dt>Note</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{patient.notes || '—'}</dd>
        </dl>
      </div>
      <AccountCard patient={patient} canEdit={canEdit} onChanged={onChanged} />
      {edit && <PatientForm initial={patient} patientId={patient.id} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); }} />}
    </div>
  );
}

function AccountCard({ patient, canEdit, onChanged }: { patient: any; canEdit: boolean; onChanged: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;
  const acc = patient.account;
  return (
    <div className="card">
      <h2>Accesso del paziente</h2>
      {acc ? <p>Nome utente: <b>{acc.username}</b> {acc.active ? <span className="badge ok">attivo</span> : <span className="badge danger">disattivato</span>}</p> : <p className="muted">Il paziente non ha ancora un accesso.</p>}
      <div className="grid-3">
        {!acc && <Field label="Nome utente"><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>}
        <Field label={acc ? 'Nuova password (min. 8 caratteri)' : 'Password iniziale (min. 8 caratteri)'}><input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      <div className="row">
        <button className="btn-primary" disabled={password.length < 8 || (!acc && username.length < 3)} onClick={async () => { setErr(null); try { const r = await POST<any>(`/api/patients/${patient.id}/account`, { username: acc ? undefined : username, password }); setMsg(`Accesso pronto per "${r.username}". Comunica la password al paziente in modo riservato.`); setPassword(''); onChanged(); } catch (e) { setErr(errMsg(e)); } }}>{acc ? 'Reimposta password' : 'Crea accesso'}</button>
        {acc && <button onClick={async () => { await POST(`/api/patients/${patient.id}/account/active`, { active: !acc.active }); onChanged(); }}>{acc.active ? 'Disattiva accesso' : 'Riattiva accesso'}</button>}
      </div>
      {msg && <div className="notice ok" style={{ marginTop: 10 }}>{msg}</div>}
      <ErrorBox error={err} />
    </div>
  );
}

export function NotesTab({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const q = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/notes`), [patient.id]);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('clinical');
  const [err, setErr] = useState<string | null>(null);
  const CAT: Record<string, string> = { clinical: 'Clinica', program: 'Programma', technical: 'Tecnica', other: 'Altro' };
  return (
    <div>
      {canEdit && (
        <div className="card">
          <Field label="Nuova nota"><textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <div className="row"><select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 200 }}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn-primary" disabled={!text.trim()} onClick={async () => { try { await POST(`/api/patients/${patient.id}/notes`, { text, category }); setText(''); void q.reload(); } catch (e) { setErr(errMsg(e)); } }}>Salva nota</button></div>
          <ErrorBox error={err} />
        </div>
      )}
      {(q.data ?? []).map((n) => <div className="card" key={n.id}><div className="small muted">{fmtDateTime(n.createdAt)} · {n.authorName} · {CAT[n.category]} <DemoBadge show={n.isDemo} /></div><div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div></div>)}
      {q.data?.length === 0 && <p className="muted">Nessuna nota.</p>}
    </div>
  );
}

export function CalibrationsTab({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const q = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/calibrations`), [patient.id]);
  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Tarature</h2>
        {canEdit && <Link className="btn btn-primary" to={`/taratura/${patient.id}/nuova`} data-testid="new-calibration">{q.data?.length ? 'Nuova taratura' : 'Taratura iniziale'}</Link>}
      </div>
      <div className="notice info small">Ogni taratura è una nuova versione: le precedenti restano nello storico e ogni esecuzione registra quale taratura ha usato. La prima è la taratura di riferimento. Il riposizionamento a inizio seduta non modifica la taratura. Le coordinate sono normalizzate sul lato corto dell'area di gioco: non sono centimetri.</div>
      <ErrorBox error={q.error} />
      {(q.data ?? []).map((c) => (
        <div className="card" key={c.id}>
          <div className="row between">
            <div><b>Versione {c.version}</b> {c.isReference && <span className="badge info">riferimento</span>} <span className="small muted">{fmtDateTime(c.createdAt)} · {c.createdByName}</span></div>
            <span className="small">{handLabel(c.hand)} · {c.fingers.map(fingerLabel).join(', ')}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Disposizione: {c.layoutMethod === 'simultaneous' ? 'registrata con le dita appoggiate insieme' : 'solo dita una alla volta (contatti simultanei insufficienti o non registrati)'} ·
            Area {Math.round(c.area.w)}×{Math.round(c.area.h)} px ({c.orientation === 'landscape' ? 'orizzontale' : 'verticale'}) ·
            Contatti simultanei rilevati: {c.device.measuredMaxContacts ?? 'non verificati'} ·
            Calibrazione fisica: {c.physicalScale ? `${c.physicalScale.pxPerMm.toFixed(2)} px/mm (${c.physicalScale.method})` : 'no'} ·
            Prova finale: {c.trial.done ? (c.trial.ok ? 'superata' : 'con problemi') : 'non eseguita'}
          </div>
          <div className="small" style={{ marginTop: 4 }}>Aree confortevoli approvate: {c.comfort.length ? c.comfort.map((z: any) => getExercise(z.exerciseId)?.name).join(', ') : 'nessuna'}</div>
          {c.notes && <div className="small muted">{c.notes}</div>}
        </div>
      ))}
      {q.data?.length === 0 && <p className="muted">Nessuna taratura registrata.</p>}
    </div>
  );
}

export function TeamTab({ patient }: { patient: any }) {
  const q = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/access`), [patient.id]);
  const th = useAsync(() => GET<any[]>('/api/therapists'), []);
  const [username, setUsername] = useState('');
  const [level, setLevel] = useState('viewer');
  const [err, setErr] = useState<string | null>(null);
  const owner = patient.accessLevel === 'owner';
  const LV: Record<string, string> = { owner: 'Responsabile (gestisce il team)', editor: 'Modifica', viewer: 'Sola lettura' };
  return (
    <div>
      <div className="card">
        <h2>Professionisti autorizzati</h2>
        <table className="table"><thead><tr><th>Professionista</th><th>Livello</th><th>Autorizzato</th><th></th></tr></thead>
          <tbody>{(q.data ?? []).map((a) => <tr key={a.id} style={a.revokedAt ? { opacity: .5 } : undefined}><td>{a.displayName} <span className="small muted">({a.username})</span></td><td>{LV[a.level]}</td><td className="small">{fmtDateTime(a.grantedAt)} da {a.grantedByName}{a.revokedAt ? ` · revocato ${fmtDateTime(a.revokedAt)}` : ''}</td>
            <td>{owner && !a.revokedAt && <button className="btn-small" onClick={async () => { try { await DEL(`/api/patients/${patient.id}/access/${a.userId}`); void q.reload(); } catch (e) { setErr(errMsg(e)); } }}>Revoca</button>}</td></tr>)}</tbody></table>
      </div>
      {owner ? (
        <div className="card">
          <h3>Autorizza un collega</h3>
          <div className="grid-3">
            <Field label="Professionista"><select value={username} onChange={(e) => setUsername(e.target.value)}><option value="">Scegli…</option>{(th.data ?? []).map((t) => <option key={t.id} value={t.username}>{t.displayName} ({t.username})</option>)}</select></Field>
            <Field label="Livello"><select value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(LV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <button className="btn-primary" disabled={!username} onClick={async () => { setErr(null); try { await POST(`/api/patients/${patient.id}/access`, { username, level }); setUsername(''); void q.reload(); } catch (e) { setErr(errMsg(e)); } }}>Autorizza</button>
        </div>
      ) : <p className="muted small">Solo il responsabile del paziente può gestire le autorizzazioni.</p>}
      <ErrorBox error={err} />
    </div>
  );
}

export function HistoryTab({ patient, canEdit }: { patient: any; canEdit: boolean }) {
  const q = useAsync(() => GET<any[]>(`/api/patients/${patient.id}/corrections`), [patient.id]);
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="card">
        <h2>Cronologia delle modifiche</h2>
        <p className="small muted">Valore precedente, nuovo valore, autore e motivo. Questa cronologia è registrata dal server ma non costituisce un registro di audit certificato per la ricerca clinica.</p>
        <div className="table-wrap"><table className="table small"><thead><tr><th>Quando</th><th>Elemento</th><th>Campo</th><th>Prima</th><th>Dopo</th><th>Autore</th><th>Motivo</th></tr></thead>
          <tbody>{(q.data ?? []).map((c) => <tr key={c.id}><td>{fmtDateTime(c.at)}</td><td>{c.entity}</td><td>{c.field}</td><td>{c.oldValue ?? '—'}</td><td>{c.newValue ?? '—'}</td><td>{c.authorName}</td><td>{c.reason}</td></tr>)}</tbody></table></div>
        {q.data?.length === 0 && <p className="muted">Nessuna modifica registrata.</p>}
      </div>
      {canEdit && (
        <div className="card">
          <h2>Copia di sicurezza dei dati del paziente</h2>
          <p className="small muted">Esporta in JSON programmi, tarature, sedute, esecuzioni e segnalazioni. La reimportazione aggiunge solo gli elementi mancanti (nessun duplicato). Il file contiene dati pseudonimizzati: conservalo in modo sicuro e non caricarlo su servizi esterni.</p>
          <div className="row">
            <button onClick={() => download(`/api/patients/${patient.id}/backup`, `handlab-${patient.code}-backup.json`).catch((e) => setErr(errMsg(e)))}>Esporta JSON</button>
            <button onClick={() => file.current?.click()}>Importa JSON…</button>
            <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return; setErr(null); setMsg(null);
              try { const r = await POST<any>(`/api/patients/${patient.id}/backup/import`, JSON.parse(await f.text())); setMsg(`Importazione completata: ${r.inserted.sessions} sedute, ${r.inserted.runs} esecuzioni, ${r.inserted.symptoms} segnalazioni, ${r.calibrationsInserted} tarature, ${r.programVersionsInserted} versioni di programma aggiunte; ${r.unchanged} elementi già presenti ignorati.`); }
              catch (ex) { setErr(errMsg(ex)); } finally { e.target.value = ''; }
            }} />
          </div>
          {msg && <div className="notice ok" style={{ marginTop: 10 }}>{msg}</div>}
          <ErrorBox error={err} />
        </div>
      )}
    </div>
  );
}
