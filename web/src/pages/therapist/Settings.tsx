import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GET, POST, errMsg } from '../../api';
import { useAuth } from '../../auth';
import { useAsync, ErrorBox, Field } from '../../components/ui';
import { SyncStatus } from '../../components/SyncStatus';
import { PhysicalScaleCard } from '../PhysicalScale';
import { lastTouchCheck, isStandalone } from '../../local/device';
import { fmtDateTime } from '../../format';

export function Settings() {
  const { user } = useAuth();
  const tc = lastTouchCheck();
  return (
    <div>
      <h1>Impostazioni</h1>
      <div className="card">
        <h2>Questo tablet</h2>
        <p>Verifica touchscreen: {tc ? <>ultima il {fmtDateTime(tc.at)} – <b>{tc.maxContacts}</b> contatti simultanei rilevati (dichiarati dal browser: {tc.declared || 'n.d.'})</> : 'non ancora eseguita'}</p>
        <Link className="btn btn-primary" to="/verifica">Avvia la verifica guidata del touchscreen</Link>
        <p className="small muted" style={{ marginTop: 10 }}>App installata sulla schermata Home: {isStandalone() ? 'sì' : 'no (in uso dal browser)'}. Per installarla: su iPad Safari → Condividi → "Aggiungi alla schermata Home"; su Android Chrome → menu ⋮ → "Installa app". L'installazione richiede che il server sia raggiungibile in HTTPS.</p>
      </div>
      {user?.role !== 'admin' && <PhysicalScaleCard />}
      {user?.role !== 'admin' && <div><h2>Sincronizzazione</h2><SyncStatus /></div>}
      <PasswordCard />
      {user?.role === 'admin' && <UsersCard />}
      <div className="card">
        <h2>Dati e protezione</h2>
        <ul className="small">
          <li>I dati fanno fede sul server condiviso. Sul tablet restano solo la copia del programma per l'uso offline e le attività in attesa di invio.</li>
          <li>Cancellare i dati del browser prima dell'invio può far perdere le attività non ancora sincronizzate (vedi "attività da inviare").</li>
          <li>Non inserire nomi, codici fiscali o altri identificativi diretti: usa codici paziente.</li>
          <li>Non inserire dati clinici reali in servizi esterni o strumenti di analisi non autorizzati.</li>
          <li>Questa è una prima versione di sviluppo: non è dichiarata pronta per l'uso clinico né conforme alla normativa sui dispositivi medici o sulla protezione dei dati.</li>
        </ul>
      </div>
    </div>
  );
}

function PasswordCard() {
  const { refresh } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card">
      <h2>Cambia password</h2>
      <div className="grid-3">
        <Field label="Password attuale"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="Nuova password (min. 8)"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Ripeti nuova password"><input type="password" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      <button className="btn-primary" disabled={!cur || next.length < 8 || next !== next2} onClick={async () => { setErr(null); try { await POST('/api/auth/password', { current: cur, next }); setMsg('Password aggiornata. Le altre sessioni sono state chiuse.'); setCur(''); setNext(''); setNext2(''); void refresh(); } catch (e) { setErr(errMsg(e)); } }}>Aggiorna</button>
      {msg && <div className="notice ok" style={{ marginTop: 10 }}>{msg}</div>}
      <ErrorBox error={err} />
    </div>
  );
}

function UsersCard() {
  const q = useAsync(() => GET<any[]>('/api/users'), []);
  const [f, setF] = useState({ username: '', displayName: '', role: 'therapist', password: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card">
      <h2>Account dei professionisti</h2>
      <p className="small muted">L'amministratore gestisce gli account ma non ha accesso ai dati clinici dei pazienti.</p>
      <table className="table"><thead><tr><th>Utente</th><th>Ruolo</th><th>Stato</th><th></th></tr></thead>
        <tbody>{(q.data ?? []).map((u) => <tr key={u.id}><td>{u.displayName} <span className="small muted">({u.username})</span></td><td>{u.role === 'admin' ? 'Amministratore' : 'Fisioterapista'}</td><td>{u.active ? 'attivo' : 'disattivato'}</td>
          <td className="row"><button className="btn-small" onClick={async () => { const p = window.prompt('Nuova password temporanea (min. 8 caratteri)'); if (p) { try { await POST(`/api/users/${u.id}/reset-password`, { password: p }); } catch (e) { setErr(errMsg(e)); } } }}>Reimposta password</button>
            <button className="btn-small" onClick={async () => { try { await POST(`/api/users/${u.id}/active`, { active: !u.active }); void q.reload(); } catch (e) { setErr(errMsg(e)); } }}>{u.active ? 'Disattiva' : 'Riattiva'}</button></td></tr>)}</tbody></table>
      <h3 style={{ marginTop: 14 }}>Nuovo account</h3>
      <div className="grid-3">
        <Field label="Nome utente"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Nome visualizzato"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="Ruolo"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="therapist">Fisioterapista</option><option value="admin">Amministratore</option></select></Field>
        <Field label="Password temporanea (min. 8)"><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </div>
      <button className="btn-primary" disabled={f.username.length < 3 || !f.displayName || f.password.length < 8} onClick={async () => { setErr(null); try { await POST('/api/users', f); setF({ username: '', displayName: '', role: 'therapist', password: '' }); void q.reload(); } catch (e) { setErr(errMsg(e)); } }}>Crea account</button>
      <ErrorBox error={err} />
    </div>
  );
}
