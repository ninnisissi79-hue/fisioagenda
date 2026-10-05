// Supporto ai test sul server locale (Supabase avviato con `npm run db:start`).
// Usa solo le chiavi dell'ambiente LOCALE di sviluppo, lette da `supabase status`:
// nessuna chiave reale è scritta nel codice.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const E = require(path.join(ROOT, 'web/js/engine.js'));
export const S = require(path.join(ROOT, 'web/js/store.js'));

let status;
export function local() {
  if (status) return status;
  const out = execFileSync(path.join(ROOT, 'node_modules/.bin/supabase'), ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  status = JSON.parse(out.slice(out.indexOf('{')));
  return status;
}

export function psql(sql) {
  return execFileSync('psql', [local().DB_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { encoding: 'utf8' }).trim();
}

export const PASSWORD = 'prova-locale-' + Math.random().toString(36).slice(2);

export async function ensureUser(email, role, name) {
  const st = local();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ex = list.users.find(u => u.email === email);
  if (ex) await admin.auth.admin.updateUserById(ex.id, { password: PASSWORD });
  else {
    const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name || email } });
    if (error) throw error;
  }
  psql(`update public.profiles set role='${role}', active=true, full_name='${(name || email).replace(/'/g, "''")}' where email='${email}'`);
}

export async function login(email) {
  const st = local();
  const sb = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return sb;
}

export function anon() {
  const st = local();
  return createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ctxFor(sb, today) {
  const t = today || psql('select app.today()');
  const data = E.normalize(await S.loadAll(sb, E.addDays(t, -30)));
  return E.makeCtx(data, { today: t });
}

export function today() { return psql('select app.today()'); }

/** Primi giorni lavorativi (lun–ven, senza chiusure) a partire da una data. */
export function workdays(from, n) {
  const closures = new Set(psql('select coalesce(string_agg(day::text, \',\'), \'\') from public.closures').split(',').filter(Boolean));
  const out = []; let d = from;
  while (out.length < n) { if (E.weekday(d) <= 5 && !closures.has(d)) out.push(d); d = E.addDays(d, 1); }
  return out;
}

export async function expectError(promise, kind, re) {
  try { await promise; } catch (e) {
    if (kind && e.kind !== kind) throw new Error('Errore di tipo ' + e.kind + ' invece di ' + kind + ': ' + e.message);
    if (re && !re.test(e.message)) throw new Error('Messaggio inatteso: ' + e.message);
    return e;
  }
  throw new Error('Era atteso un errore ' + (kind || ''));
}
