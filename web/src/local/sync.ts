import { localDay } from '@handlab/shared';
import { POST, OfflineError, ApiError } from '../api';
import { outboxAck, outboxAll, outboxPut, kvGet, kvSet, type OutboxItem } from './idb';
import { deviceId, timeZone } from './device';

/**
 * Sincronizzazione: le attività vengono salvate prima sul dispositivo (coda) e inviate al server
 * appena possibile. Ogni elemento ha un identificativo univoco: il server ignora i duplicati.
 */

export interface SyncState { pending: number; lastSyncAt: string | null; lastError: string | null; syncing: boolean; online: boolean }

let state: SyncState = { pending: 0, lastSyncAt: null, lastError: null, syncing: false, online: navigator.onLine };
const listeners = new Set<(s: SyncState) => void>();
let currentUserId: string | null = null;
let inflight: Promise<void> | null = null;
let timer: number | null = null;

function emit(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); }
export function syncState() { return state; }
export function onSync(l: (s: SyncState) => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export async function refreshPending() {
  const items = await outboxAll();
  emit({ pending: currentUserId ? items.filter((i) => i.userId === currentUserId).length : items.length });
}

export async function enqueue(kind: OutboxItem['kind'], id: string, payload: any, patientId: string | null = null) {
  if (!currentUserId) throw new Error('Utente non impostato');
  await outboxPut({ kind, id, userId: currentUserId, patientId, payload });
  await refreshPending();
  scheduleSync(800);
}

export function scheduleSync(ms = 0) {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = null; void syncNow(); }, ms);
}

export async function syncNow(): Promise<void> {
  if (!currentUserId) return;
  if (inflight) return inflight;
  inflight = (async () => {
    emit({ syncing: true });
    try {
      const all = (await outboxAll()).filter((i) => i.userId === currentUserId);
      // un invio per paziente (il professionista può registrare valutazioni per più pazienti)
      const groups = new Map<string, OutboxItem[]>();
      for (const i of all) { const k = i.patientId ?? ''; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(i); }
      if (!groups.has('') && (await kvGet<string>('role')) === 'patient') groups.set('', []);
      for (const [pid, items] of groups) {
        // batch limitati; le sedute prima delle esecuzioni
        for (let off = 0; off < Math.max(1, items.length); off += 150) {
          const batch = items.slice(off, off + 150);
          const isLast = off + 150 >= items.length;
          const body: any = {
            deviceId: deviceId(), clientLocalDate: localDay(), tz: timeZone(), outboxEmptyAfter: isLast,
            sessions: batch.filter((i) => i.kind === 'session').map((i) => i.payload),
            runs: batch.filter((i) => i.kind === 'run').map((i) => i.payload),
            symptoms: batch.filter((i) => i.kind === 'symptom').map((i) => i.payload),
            deviceChecks: batch.filter((i) => i.kind === 'deviceCheck').map((i) => i.payload),
          };
          if (pid) body.patientId = pid;
          if (pid && !batch.length) continue;
          await POST('/api/sync', body);
          await outboxAck(batch.map((i) => ({ key: i.key, rev: i.rev })));
        }
      }
      const now = new Date().toISOString();
      await kvSet(`lastSync:${currentUserId}`, now);
      emit({ lastSyncAt: now, lastError: null, online: true });
    } catch (e) {
      emit({ lastError: e instanceof OfflineError ? 'Offline: i dati restano sul dispositivo e verranno inviati appena possibile.' : e instanceof ApiError && e.status === 401 ? 'Sessione scaduta: accedi di nuovo per inviare i dati.' : (e as Error).message, online: !(e instanceof OfflineError) });
    } finally {
      await refreshPending();
      emit({ syncing: false });
      inflight = null;
    }
  })();
  return inflight;
}

let started = false;
export async function startSync(userId: string, role: string) {
  currentUserId = userId;
  await kvSet('role', role);
  emit({ lastSyncAt: (await kvGet<string>(`lastSync:${userId}`)) ?? null });
  await refreshPending();
  if (!started) {
    started = true;
    window.addEventListener('online', () => { emit({ online: true }); scheduleSync(500); });
    window.addEventListener('offline', () => emit({ online: false }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(1000); });
    window.setInterval(() => { if (navigator.onLine) void syncNow(); }, 120000);
  }
  scheduleSync(300);
}

export function stopSync() { currentUserId = null; }
export function syncUserId() { return currentUserId; }
