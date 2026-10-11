import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { seedDemo, DEMO_PASSWORD } from '../src/demo.ts';
import { localDay, defaultParams, getExercise } from '@handlab/shared';

export async function setup() {
  const db = openDb(':memory:');
  await seedDemo(db, localDay());
  const app = await buildApp({ db });
  return { db, app };
}

export class Client {
  cookie = '';
  constructor(public app: FastifyInstance) {}
  async login(username: string, password = DEMO_PASSWORD) {
    const r = await this.req('POST', '/api/auth/login', { username, password });
    if (r.statusCode !== 200) throw new Error(`login ${username}: ${r.body}`);
    const sc = r.headers['set-cookie'];
    this.cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0];
    return r.json();
  }
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.app.inject({ method: method as any, url, payload: body as any, headers: { 'x-handlab': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers } });
  }
  async get(url: string) { return this.req('GET', url); }
  async post(url: string, body: unknown) { return this.req('POST', url, body); }
  async put(url: string, body: unknown) { return this.req('PUT', url, body); }
}

export const device = { deviceId: 'test-device-1', userAgent: 'vitest', screenW: 1180, screenH: 820, dpr: 2, maxTouchPointsDeclared: 5, measuredMaxContacts: 5, standalone: false };

export function makeRun(over: Record<string, unknown> = {}) {
  const def = getExercise('pinch')!;
  return {
    id: randomUUID(), sessionId: null, programVersionId: null, programVersion: null, programItemId: 'demo-item-pinch',
    exerciseId: 'pinch', exerciseVersion: def.version, metricsVersion: def.metricsVersion, mode: 'training', hand: 'right', fingers: ['T', 'I'],
    params: defaultParams(def), progression: null, calibrationId: null, status: 'started', startedAt: new Date().toISOString(), endedAt: null,
    localDate: localDay(), tz: 'Europe/Rome', activeMs: 0, setsPlanned: 2, setsDone: 0, repsPlanned: 16, repsValid: 0, attempts: 0,
    completionMet: false, completionCriteria: def.completion, interruptionReason: null, metrics: {}, detail: { reps: [], events: [] },
    device, area: { w: 1000, h: 700 }, physicalScale: null, origin: 'automatic', ...over,
  };
}

export function makeSession(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), programVersionId: null, programVersion: null, calibrationId: null, startedAt: new Date().toISOString(), endedAt: null,
    localDate: localDay(), tz: 'Europe/Rome', status: 'in_progress', interruptionReason: null, activeMs: 0, device, repositioning: null, plannedItemIds: [], ...over,
  };
}

export function push(over: Record<string, unknown> = {}) {
  return { deviceId: device.deviceId, clientLocalDate: localDay(), tz: 'Europe/Rome', outboxEmptyAfter: true, sessions: [], runs: [], symptoms: [], ...over };
}

export { randomUUID };
