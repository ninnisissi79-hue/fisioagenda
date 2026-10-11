import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.ts';
import { all, get, run } from './db.ts';
import { HttpError, nowIso, parse, requireRole, requireUser, type AuthUser } from './http.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'La password deve avere almeno 8 caratteri';
  if (pw.length > 200) return 'Password troppo lunga';
  return null;
}

const COOKIE = 'hl_sid';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86400000;

function sessionDays(role: string): number { return role === 'patient' ? 60 : 7; }

export function rowToUser(r: Record<string, any>): AuthUser {
  return { id: r.id, username: r.username, role: r.role, displayName: r.display_name, patientId: r.patient_id ?? null, mustChangePassword: !!r.must_change_password, isDemo: !!r.is_demo };
}

export interface AuthConfig { secureCookies: boolean }

export function registerAuth(app: FastifyInstance, db: DB, cfg: AuthConfig) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    req.user = null;
    const token = req.cookies?.[COOKIE];
    if (!token) return;
    const s = get(db, `SELECT s.token_hash, s.expires_at, s.last_seen_at, u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
    if (!s || !s.active || s.expires_at < nowIso()) return;
    req.user = rowToUser(s);
    // scadenza scorrevole, aggiornata al massimo una volta l'ora
    if (Date.now() - Date.parse(s.last_seen_at) > 3600000) {
      run(db, 'UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?', nowIso(), new Date(Date.now() + sessionDays(s.role) * DAY).toISOString(), s.token_hash);
    }
  });

  // protezione CSRF: le richieste che modificano dati devono avere un'intestazione personalizzata
  app.addHook('preHandler', async (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.url.startsWith('/api/') && req.headers['x-handlab'] !== '1') {
      throw new HttpError(403, 'Richiesta non consentita');
    }
  });

  function setCookie(reply: FastifyReply, token: string, role: string) {
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: cfg.secureCookies, path: '/', maxAge: sessionDays(role) * 86400 });
  }

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }), req.body);
    const username = body.username.trim().toLowerCase();
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const fails = get(db, 'SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND at > ? AND ok = 0', username, since)!.n as number;
    const ipFails = get(db, 'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ? AND ok = 0', req.ip, since)!.n as number;
    if (fails >= 8 || ipFails >= 30) throw new HttpError(429, 'Troppi tentativi non riusciti. Riprova tra 15 minuti.');
    const u = get(db, 'SELECT * FROM users WHERE username = ?', username);
    const ok = !!u && !!u.active && (await verifyPassword(body.password, u.password_hash));
    run(db, 'INSERT INTO login_attempts (username, ip, at, ok) VALUES (?, ?, ?, ?)', username, req.ip, nowIso(), ok ? 1 : 0);
    if (!ok) throw new HttpError(401, 'Nome utente o password non corretti');
    const token = randomBytes(32).toString('base64url');
    const now = nowIso();
    run(db, 'INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      sha(token), u!.id, now, now, new Date(Date.now() + sessionDays(u!.role) * DAY).toISOString(), String(req.headers['user-agent'] ?? '').slice(0, 300));
    setCookie(reply, token, u!.role);
    return { user: rowToUser(u!) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) run(db, 'DELETE FROM auth_sessions WHERE token_hash = ?', sha(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    return { user: req.user };
  });

  app.post('/api/auth/password', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
    const u = get(db, 'SELECT * FROM users WHERE id = ?', user.id)!;
    if (!(await verifyPassword(body.current, u.password_hash))) throw new HttpError(400, 'La password attuale non è corretta');
    const prob = passwordProblem(body.next);
    if (prob) throw new HttpError(400, prob);
    run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashPassword(body.next), user.id);
    // chiude le altre sessioni
    const token = req.cookies?.[COOKIE];
    run(db, 'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', user.id, token ? sha(token) : '');
    return { ok: true };
  });

  // --- gestione account (amministratore)
  app.get('/api/users', async (req) => {
    requireRole(req, 'admin');
    return all(db, `SELECT id, username, role, display_name AS displayName, active, is_demo AS isDemo, created_at AS createdAt FROM users WHERE role != 'patient' ORDER BY role, username`);
  });

  app.post('/api/users', async (req) => {
    requireRole(req, 'admin');
    const body = parse(z.object({ username: z.string().min(3).max(60).regex(/^[a-z0-9._-]+$/i), displayName: z.string().min(1).max(100), role: z.enum(['therapist', 'admin']), password: z.string() }), req.body);
    const prob = passwordProblem(body.password);
    if (prob) throw new HttpError(400, prob);
    if (get(db, 'SELECT 1 FROM users WHERE username = ?', body.username.toLowerCase())) throw new HttpError(409, 'Nome utente già in uso');
    const id = randomUUID();
    run(db, 'INSERT INTO users (id, username, password_hash, role, display_name, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      id, body.username.toLowerCase(), await hashPassword(body.password), body.role, body.displayName, nowIso());
    return { id };
  });

  app.post('/api/users/:id/reset-password', async (req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const body = parse(z.object({ password: z.string() }), req.body);
    const prob = passwordProblem(body.password);
    if (prob) throw new HttpError(400, prob);
    const u = get(db, "SELECT * FROM users WHERE id = ? AND role != 'patient'", id);
    if (!u) throw new HttpError(404, 'Utente non trovato');
    run(db, 'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', await hashPassword(body.password), id);
    run(db, 'DELETE FROM auth_sessions WHERE user_id = ?', id);
    return { ok: true };
  });

  app.post('/api/users/:id/active', async (req) => {
    const admin = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const body = parse(z.object({ active: z.boolean() }), req.body);
    if (id === admin.id) throw new HttpError(400, 'Non puoi disattivare il tuo account');
    run(db, "UPDATE users SET active = ? WHERE id = ? AND role != 'patient'", body.active ? 1 : 0, id);
    if (!body.active) run(db, 'DELETE FROM auth_sessions WHERE user_id = ?', id);
    return { ok: true };
  });

  // elenco minimo dei professionisti, per autorizzare colleghi del team
  app.get('/api/therapists', async (req) => {
    requireRole(req, 'therapist');
    return all(db, "SELECT id, username, display_name AS displayName FROM users WHERE role = 'therapist' AND active = 1 ORDER BY display_name");
  });
}

export async function createUser(db: DB, u: { username: string; password: string; role: 'admin' | 'therapist' | 'patient'; displayName: string; patientId?: string | null; isDemo?: boolean; mustChange?: boolean }): Promise<string> {
  const id = randomUUID();
  run(db, 'INSERT INTO users (id, username, password_hash, role, display_name, patient_id, must_change_password, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, u.username.toLowerCase(), await hashPassword(u.password), u.role, u.displayName, u.patientId ?? null, u.mustChange ? 1 : 0, u.isDemo ? 1 : 0, nowIso());
  return id;
}

export type { FastifyRequest };
