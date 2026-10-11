import { useState } from 'react';
import { useAuth } from '../auth';
import { errMsg } from '../api';

export function Login() {
  const { login, offline } = useAuth();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await login(u.trim(), p); } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); } }}>
        <div className="brand" style={{ color: 'var(--primary)', padding: 0, marginBottom: 12 }}><img src="/icons/icon.svg" alt="" width={40} height={40} /> Hand Lab</div>
        <h1 style={{ fontSize: '1.3rem' }}>Accedi</h1>
        {offline && <div className="notice warn small">Connessione assente: per il primo accesso serve internet.</div>}
        <label className="field"><span>Nome utente</span><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" data-testid="login-user" /></label>
        <label className="field"><span>Password</span><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" data-testid="login-password" /></label>
        {err && <div className="notice danger" role="alert">{err}</div>}
        <button className="btn-primary btn-huge" style={{ width: '100%' }} disabled={busy || !u || !p} data-testid="login-submit">Entra</button>
        <p className="small muted" style={{ marginTop: 12 }}>Ogni fisioterapista e ogni paziente ha un proprio account. Le credenziali dei pazienti sono fornite dal fisioterapista.</p>
      </form>
    </div>
  );
}
