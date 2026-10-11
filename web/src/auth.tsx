import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { GET, POST, OfflineError } from './api';
import { kvDel, kvGet, kvSet } from './local/idb';
import { startSync, stopSync } from './local/sync';
import { recoverInterrupted } from './local/activity';

export interface User { id: string; username: string; role: 'admin' | 'therapist' | 'patient'; displayName: string; patientId: string | null; mustChangePassword: boolean; isDemo: boolean }

interface AuthCtx { user: User | null; loading: boolean; offline: boolean; login: (u: string, p: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void> }

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const activate = useCallback(async (u: User) => {
    await kvSet('user', u);
    await recoverInterrupted(u.id);
    await startSync(u.id, u.role);
    setUser(u);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await GET<{ user: User | null }>('/api/auth/me');
      setOffline(false);
      if (r.user) await activate(r.user); else { setUser(null); stopSync(); }
    } catch (e) {
      if (e instanceof OfflineError) {
        // senza rete: il paziente può continuare con il programma salvato sul dispositivo
        const cached = await kvGet<User>('user');
        setOffline(true);
        if (cached && cached.role === 'patient') { await recoverInterrupted(cached.id); await startSync(cached.id, cached.role); setUser(cached); }
      }
    } finally { setLoading(false); }
  }, [activate]);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await POST<{ user: User }>('/api/auth/login', { username, password });
    setOffline(false);
    await activate(r.user);
  }, [activate]);

  const logout = useCallback(async () => {
    try { await POST('/api/auth/logout'); } catch { /* offline: la sessione verrà chiusa al prossimo accesso */ }
    await kvDel('user');
    if (user) await kvDel(`program:${user.id}`);
    stopSync();
    setUser(null);
  }, [user]);

  return <Ctx.Provider value={{ user, loading, offline, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
