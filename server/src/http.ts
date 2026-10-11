import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { AccessLevel, Role } from '@handlab/shared';
import type { DB } from './db.ts';
import { get } from './db.ts';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) { super(message); }
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
  patientId: string | null;
  mustChangePassword: boolean;
  isDemo: boolean;
}

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Accesso richiesto');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw new HttpError(403, 'Operazione non consentita per questo profilo');
  return u;
}

const LEVEL_RANK: Record<AccessLevel, number> = { viewer: 1, editor: 2, owner: 3 };

/** livello di accesso attivo di un professionista a un paziente, oppure null */
export function accessLevel(db: DB, userId: string, patientId: string): AccessLevel | null {
  const r = get(db, `SELECT level FROM patient_access WHERE patient_id = ? AND user_id = ? AND revoked_at IS NULL
    ORDER BY CASE level WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END DESC LIMIT 1`, patientId, userId);
  return (r?.level as AccessLevel) ?? null;
}

/**
 * Autorizzazione sul server: il paziente accede solo ai propri dati (in lettura, salvo gli endpoint
 * dedicati), il professionista solo ai pazienti assegnati con il livello richiesto.
 */
export function requirePatientAccess(db: DB, req: FastifyRequest, patientId: string, min: AccessLevel = 'viewer'): { user: AuthUser; level: AccessLevel | 'self' } {
  const user = requireUser(req);
  if (user.role === 'patient') {
    if (user.patientId === patientId && min === 'viewer') return { user, level: 'self' };
    throw new HttpError(404, 'Paziente non trovato');
  }
  if (user.role !== 'therapist') throw new HttpError(404, 'Paziente non trovato');
  const lvl = accessLevel(db, user.id, patientId);
  // 404 anziché 403: non rivela l'esistenza di pazienti non assegnati
  if (!lvl) throw new HttpError(404, 'Paziente non trovato');
  if (LEVEL_RANK[lvl] < LEVEL_RANK[min]) throw new HttpError(403, 'Il tuo livello di accesso a questo paziente non consente l\'operazione');
  return { user, level: lvl };
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'dati'}: ${i.message}`).join('; ');
    throw new HttpError(400, `Dati non validi – ${msg}`);
  }
  return r.data;
}

export function nowIso(): string { return new Date().toISOString(); }

export function todayServer(): string { return new Date().toISOString().slice(0, 10); }

export function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  return reply.send('﻿' + csv);
}
