import { useEffect, useState } from 'react';
import { onSync, syncNow, syncState, type SyncState } from '../local/sync';
import { fmtAgo } from '../format';

export function useSyncState(): SyncState {
  const [s, set] = useState(syncState());
  useEffect(() => onSync(set), []);
  return s;
}

export function SyncStatus({ compact }: { compact?: boolean }) {
  const s = useSyncState();
  return (
    <div className={compact ? 'small' : 'card'} data-testid="sync-status">
      <div className="row">
        {s.pending > 0 ? <span className="badge warn">{s.pending} attività da inviare</span> : <span className="badge ok">Tutto inviato</span>}
        <span className="small muted">Ultimo invio riuscito: {fmtAgo(s.lastSyncAt)}</span>
        {!compact && <button className="btn-small" onClick={() => void syncNow()} disabled={s.syncing}>{s.syncing ? 'Invio…' : 'Invia ora'}</button>}
      </div>
      {s.lastError && <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>{s.lastError}</div>}
    </div>
  );
}
