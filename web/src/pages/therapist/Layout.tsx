import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useSyncState } from '../../components/SyncStatus';

const NAV = [
  { to: '/pazienti', label: 'Pazienti' },
  { to: '/taratura', label: 'Taratura' },
  { to: '/esercizi', label: 'Esercizi' },
  { to: '/programmi', label: 'Programmi' },
  { to: '/valutazioni', label: 'Valutazioni' },
  { to: '/progressi', label: 'Progressi' },
  { to: '/ricerca', label: 'Ricerca' },
  { to: '/impostazioni', label: 'Impostazioni' },
];

export function TherapistLayout() {
  const { user, logout } = useAuth();
  const sync = useSyncState();
  const nav = useNavigate();
  const items = user?.role === 'admin' ? NAV.filter((n) => n.to === '/impostazioni') : NAV;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><img src="/icons/icon.svg" alt="" /> Hand Lab</div>
        <nav className="nav" aria-label="Sezioni">
          {items.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>)}
        </nav>
        <div className="who">
          <div><b>{user?.displayName}</b>{user?.isDemo && <span className="badge demo" style={{ marginLeft: 6 }}>DEMO</span>}</div>
          <div className="small" style={{ opacity: .8 }}>{user?.role === 'admin' ? 'Amministratore' : 'Fisioterapista'}{sync.pending > 0 ? ` · ${sync.pending} da inviare` : ''}</div>
          <button className="btn-small" onClick={async () => { await logout(); nav('/'); }}>Esci</button>
        </div>
      </aside>
      <main className="main">
        {user?.mustChangePassword && <div className="notice warn">Al primo accesso è necessario cambiare la password: vai in <NavLink to="/impostazioni">Impostazioni</NavLink>.</div>}
        <Outlet />
      </main>
    </div>
  );
}
