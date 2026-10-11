import { describe, expect, it, beforeEach } from 'vitest';
import { addDays, localDay, parseCsv } from '@handlab/shared';
import { Client, setup, makeRun, makeSession, push, randomUUID, device } from './helpers.ts';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.ts';

let app: FastifyInstance, db: DB;
beforeEach(async () => { ({ app, db } = await setup()); });

async function ids(c: Client) {
  const list = (await c.get('/api/patients')).json() as any[];
  return Object.fromEntries(list.map((p) => [p.code, p.id])) as Record<string, string>;
}

describe('autenticazione', () => {
  it('rifiuta credenziali errate e accessi senza sessione', async () => {
    const c = new Client(app);
    expect((await c.post('/api/auth/login', { username: 'ft.demo', password: 'sbagliata' })).statusCode).toBe(401);
    expect((await c.get('/api/patients')).statusCode).toBe(401);
    await c.login('ft.demo');
    expect((await c.get('/api/patients')).statusCode).toBe(200);
    await c.post('/api/auth/logout', {});
    expect((await c.get('/api/patients')).statusCode).toBe(401);
  });

  it('blocca i tentativi ripetuti', async () => {
    const c = new Client(app);
    for (let i = 0; i < 8; i++) await c.post('/api/auth/login', { username: 'demo001', password: 'xxxxxxxx' });
    expect((await c.post('/api/auth/login', { username: 'demo001', password: 'demo-handlab' })).statusCode).toBe(429);
  });

  it('richiede l\'intestazione anti-CSRF per le modifiche', async () => {
    const c = new Client(app);
    await c.login('ft.demo');
    const r = await app.inject({ method: 'POST', url: '/api/patients', payload: {}, headers: { cookie: c.cookie } });
    expect(r.statusCode).toBe(403);
  });

  it('memorizza solo l\'hash della password e del token', async () => {
    const { get } = await import('../src/db.ts');
    const u = get(db, "SELECT password_hash FROM users WHERE username = 'ft.demo'")!;
    expect(u.password_hash).toMatch(/^scrypt\$/);
    const c = new Client(app);
    await c.login('ft.demo');
    const token = c.cookie.split('=')[1];
    expect(get(db, 'SELECT 1 FROM auth_sessions WHERE token_hash = ?', token)).toBeUndefined();
  });
});

describe('autorizzazioni sul server', () => {
  it('il paziente vede solo i propri dati', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = await ids(ft);
    const p = new Client(app); await p.login('demo001');
    expect((await p.get(`/api/patients/${id['DEMO-001']}`)).statusCode).toBe(200);
    expect((await p.get(`/api/patients/${id['DEMO-002']}`)).statusCode).toBe(404);
    expect((await p.get(`/api/patients/${id['DEMO-002']}/activity`)).statusCode).toBe(404);
    expect((await p.get(`/api/patients/${id['DEMO-001']}/notes`)).statusCode).toBe(404); // note riservate al professionista
    expect((await p.get('/api/patients')).statusCode).toBe(403);
    // non può scrivere il programma né le misure
    expect((await p.post(`/api/patients/${id['DEMO-001']}/programs`, {})).statusCode).toBe(404);
    // non può sincronizzare dati a nome di un altro paziente
    expect((await p.post('/api/sync', push({ patientId: id['DEMO-002'] }))).statusCode).toBe(403);
  });

  it('il professionista vede solo i pazienti assegnati, con il livello concesso', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = await ids(ft);
    const col = new Client(app); await col.login('collega.demo');
    const list = (await col.get('/api/patients')).json() as any[];
    expect(list.map((p) => p.code)).toEqual(['DEMO-001']);
    expect(list[0].accessLevel).toBe('viewer');
    expect((await col.get(`/api/patients/${id['DEMO-002']}`)).statusCode).toBe(404);
    // in sola lettura non può modificare
    expect((await col.post(`/api/patients/${id['DEMO-001']}/notes`, { text: 'x', category: 'clinical' })).statusCode).toBe(403);
    // il responsabile concede la modifica
    expect((await ft.post(`/api/patients/${id['DEMO-001']}/access`, { username: 'collega.demo', level: 'editor' })).statusCode).toBe(200);
    expect((await col.post(`/api/patients/${id['DEMO-001']}/notes`, { text: 'Nota del collega', category: 'clinical' })).statusCode).toBe(200);
    // revoca
    const access = (await ft.get(`/api/patients/${id['DEMO-001']}/access`)).json() as any[];
    const colId = access.find((a) => a.username === 'collega.demo' && !a.revokedAt).userId;
    expect((await ft.req('DELETE', `/api/patients/${id['DEMO-001']}/access/${colId}`)).statusCode).toBe(200);
    expect((await col.get(`/api/patients/${id['DEMO-001']}`)).statusCode).toBe(404);
  });

  it('l\'amministratore gestisce gli account ma non vede i dati clinici', async () => {
    const a = new Client(app); await a.login('admin.demo');
    expect((await a.get('/api/patients')).statusCode).toBe(403);
    expect((await a.post('/api/users', { username: 'nuovo.ft', displayName: 'Nuovo FT', role: 'therapist', password: 'password-sicura' })).statusCode).toBe(200);
    const n = new Client(app); await n.login('nuovo.ft', 'password-sicura');
    expect(((await n.get('/api/auth/me')).json() as any).user.mustChangePassword).toBe(true);
    expect((await n.get('/api/patients')).json()).toEqual([]);
  });
});

describe('programmi versionati', () => {
  it('crea nuove versioni senza riscrivere le precedenti e rileva modifiche concorrenti', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-001'];
    const versions = (await ft.get(`/api/patients/${id}/programs`)).json() as any[];
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const v2 = versions[1];
    const items = v2.items.map((i: any) => (i.exerciseId === 'piano' ? { ...i, status: 'suspended' } : i));
    const tomorrow = addDays(localDay(), 1);
    const body = { effectiveFrom: tomorrow, changeNote: 'Sospeso pianoforte', restBetweenExercisesSec: 30, items, basedOnVersion: 2 };
    const r = await ft.post(`/api/patients/${id}/programs`, body);
    expect(r.statusCode).toBe(200);
    expect(r.json().version).toBe(3);
    // stessa base: conflitto
    expect((await ft.post(`/api/patients/${id}/programs`, body)).statusCode).toBe(409);
    // decorrenza nel passato non ammessa
    expect((await ft.post(`/api/patients/${id}/programs`, { ...body, basedOnVersion: 3, effectiveFrom: addDays(localDay(), -10) })).statusCode).toBe(400);
    const after = (await ft.get(`/api/patients/${id}/programs`)).json() as any[];
    expect(after[1]).toEqual({ ...v2 }); // versione 2 invariata
    expect(after[2].changes.find((c: any) => c.exerciseId === 'piano').kind).toBe('suspended');
    // il paziente oggi riceve ancora la v2, la v3 è indicata come futura
    const p = new Client(app); await p.login('demo001');
    const prog = (await p.get(`/api/me/program?date=${localDay()}`)).json();
    expect(prog.current.version).toBe(2);
    expect(prog.upcoming.map((v: any) => v.version)).toEqual([3]);
    const progT = (await p.get(`/api/me/program?date=${tomorrow}`)).json();
    expect(progT.current.version).toBe(3);
  });

  it('valida i parametri lato server', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-003'];
    const item = { itemId: 'abcdefgh-1', exerciseId: 'pinch', exerciseVersion: '1.0.0', mode: 'training', status: 'active', hand: 'right', fingers: ['I', 'M'], params: { amplitude: 3 }, frequency: { timesPerDay: 1, days: [1] }, progression: null };
    const r = await ft.post(`/api/patients/${id}/programs`, { effectiveFrom: localDay(), changeNote: '', restBetweenExercisesSec: 30, items: [item], basedOnVersion: null });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/pollice/);
    expect(r.json().error).toMatch(/massimo/);
  });
});

describe('sincronizzazione', () => {
  it('è idempotente: invii ripetuti non creano duplicati e lo stato definitivo non regredisce', async () => {
    const p = new Client(app); await p.login('demo001');
    const s = makeSession();
    const r1 = makeRun({ sessionId: s.id });
    const a = (await p.post('/api/sync', push({ sessions: [s], runs: [r1], outboxEmptyAfter: false }))).json();
    expect(a.inserted).toEqual({ sessions: 1, runs: 1, symptoms: 0 });
    const done = { ...r1, status: 'completed', completionMet: true, endedAt: new Date().toISOString(), repsValid: 16, metrics: { validReps: 16, successRate: 1 } };
    const sd = { ...s, status: 'completed', endedAt: new Date().toISOString() };
    const sym = { id: randomUUID(), sessionId: s.id, runId: null, at: new Date().toISOString(), localDate: localDay(), context: 'post', pain: 2, fatigue: 3, difficulty: null, note: '' };
    const b = (await p.post('/api/sync', push({ sessions: [sd], runs: [done], symptoms: [sym] }))).json();
    expect(b.updated).toEqual({ sessions: 1, runs: 1 });
    // reinvio identico (es. risposta persa per rete instabile)
    const c = (await p.post('/api/sync', push({ sessions: [sd], runs: [done], symptoms: [sym] }))).json();
    expect(c.inserted).toEqual({ sessions: 0, runs: 0, symptoms: 0 });
    expect(c.unchanged).toBe(3);
    // un vecchio invio "in corso" arrivato in ritardo non riporta indietro lo stato
    await p.post('/api/sync', push({ runs: [r1] }));
    const { get } = await import('../src/db.ts');
    expect(get(db, 'SELECT status FROM exercise_runs WHERE id = ?', r1.id)!.status).toBe('completed');
    expect(get(db, 'SELECT COUNT(*) AS n FROM exercise_runs WHERE id = ?', r1.id)!.n).toBe(1);
  });

  it('un\'esecuzione dichiarata completata senza criteri soddisfatti non conta come completata', async () => {
    const p = new Client(app); await p.login('demo001');
    const r = makeRun({ status: 'completed', completionMet: false });
    await p.post('/api/sync', push({ runs: [r] }));
    const { get } = await import('../src/db.ts');
    expect(get(db, 'SELECT status FROM exercise_runs WHERE id = ?', r.id)!.status).toBe('interrupted');
  });

  it('distingue "nessuna attività ricevuta" da "non effettuato" in base alle sincronizzazioni', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-002'];
    const today = localDay();
    let act = (await ft.get(`/api/patients/${id}/activity?from=${addDays(today, -2)}&to=${today}`)).json();
    expect(act.confirmedThrough).toBeNull();
    expect(act.adherence.cells.filter((c: any) => c.date === addDays(today, -1)).every((c: any) => c.state === 'pending_sync')).toBe(true);
    const p = new Client(app); await p.login('demo002');
    await p.post('/api/sync', push({ outboxEmptyAfter: true }));
    act = (await ft.get(`/api/patients/${id}/activity?from=${addDays(today, -2)}&to=${today}`)).json();
    expect(act.confirmedThrough).toBe(addDays(today, -1));
    expect(act.adherence.cells.filter((c: any) => c.date === addDays(today, -1)).every((c: any) => c.state === 'not_done')).toBe(true);
    // un secondo tablet con dati ancora in coda rende di nuovo incerti i giorni passati
    await p.post('/api/sync', push({ deviceId: 'altro-tablet', outboxEmptyAfter: false }));
    act = (await ft.get(`/api/patients/${id}/activity?from=${addDays(today, -2)}&to=${today}`)).json();
    expect(act.confirmedThrough).toBeNull();
  });

  it('il professionista può registrare valutazioni in ambulatorio per un paziente assegnato', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-002'];
    const r = makeRun({ mode: 'assessment', status: 'completed', completionMet: true });
    expect((await ft.post('/api/sync', push({ patientId: id, runs: [r] }))).statusCode).toBe(200);
    const col = new Client(app); await col.login('collega.demo');
    expect((await col.post('/api/sync', push({ patientId: id, runs: [makeRun()] }))).statusCode).toBe(404);
  });
});

describe('tarature versionate', () => {
  it('una nuova taratura non cancella la precedente', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-001'];
    const before = (await ft.get(`/api/patients/${id}/calibrations`)).json() as any[];
    const c = { ...before[0], id: randomUUID(), isReference: false };
    delete c.patientId; delete c.version; delete c.createdAt; delete c.createdBy; delete c.supersedes; delete c.createdByName;
    const r = await ft.post(`/api/patients/${id}/calibrations`, c);
    expect(r.statusCode).toBe(200);
    expect(r.json().version).toBe(2);
    expect((await ft.post(`/api/patients/${id}/calibrations`, c)).json().duplicate).toBe(true);
    const after = (await ft.get(`/api/patients/${id}/calibrations`)).json() as any[];
    expect(after.map((x) => x.version)).toEqual([2, 1]);
    expect(after[0].supersedes).toBe(before[0].id);
    expect(after[1].isReference).toBe(true);
    expect(after[0].isReference).toBe(false);
  });
});

describe('misure e correzioni', () => {
  it('distingue zero, mancante ed errore tecnico e conserva la cronologia', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-002'];
    const base = { date: localDay(), category: 'grip', name: 'Forza di presa', side: 'left', unit: 'kg', instrument: 'Dinamometro X', notes: '' };
    expect((await ft.post(`/api/patients/${id}/measures`, { ...base, value: 0, valueStatus: 'ok' })).statusCode).toBe(200);
    expect((await ft.post(`/api/patients/${id}/measures`, { ...base, value: null, valueStatus: 'ok' })).statusCode).toBe(400);
    expect((await ft.post(`/api/patients/${id}/measures`, { ...base, value: 5, valueStatus: 'missing' })).statusCode).toBe(400);
    const m = (await ft.post(`/api/patients/${id}/measures`, { ...base, value: 20, valueStatus: 'ok' })).json();
    expect((await ft.put(`/api/measures/${m.id}`, { measure: { ...base, value: 22, valueStatus: 'ok' }, reason: '' })).statusCode).toBe(400);
    expect((await ft.put(`/api/measures/${m.id}`, { measure: { ...base, value: 22, valueStatus: 'ok' }, reason: 'Errore di trascrizione' })).statusCode).toBe(200);
    const corr = (await ft.get(`/api/patients/${id}/corrections`)).json() as any[];
    expect(corr[0]).toMatchObject({ entity: 'clinical_measure', field: 'value', oldValue: '20', newValue: '22', reason: 'Errore di trascrizione', authorName: 'Fisioterapista Demo' });
  });
});

describe('ricerca ed esportazioni', () => {
  it('esporta senza identificativi diretti per impostazione predefinita, con stati separati per i valori', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const studies = (await ft.get('/api/studies')).json() as any[];
    const sid = studies[0].id;
    const sess = await ft.get(`/api/studies/${sid}/export/sessions.csv`);
    expect(sess.statusCode).toBe(200);
    const rows = parseCsv(sess.body);
    const header = rows[0];
    expect(header).toContain('participant_code');
    expect(header).not.toContain('patient_code');
    expect(sess.body).not.toContain('DEMO-001');
    expect(header).toContain('m_successRate_status');
    const iStatus = header.indexOf('m_wrongLifts_status');
    const iEx = header.indexOf('exercise_id');
    const pinchRow = rows.slice(1).find((r) => r[iEx] === 'pinch')!;
    expect(pinchRow[iStatus]).toBe('not_applicable');
    const withCode = await ft.get(`/api/studies/${sid}/export/sessions.csv?includePatientCode=1`);
    expect(withCode.body).toContain('DEMO-001');
    const assess = parseCsv((await ft.get(`/api/studies/${sid}/export/assessments.csv`)).body);
    expect(assess[0]).toContain('value_status');
    const dict = parseCsv((await ft.get(`/api/studies/${sid}/export/dictionary.csv`)).body);
    expect(dict.some((r) => r[1] === 'm_meanRangeU')).toBe(true);
    const tech = (await ft.get(`/api/studies/${sid}/export/technical.json`)).json();
    expect(JSON.stringify(tech)).not.toContain('DEMO-001');
    expect(tech.notice).toMatch(/pseudonimizzati/);
    const summary = (await ft.get(`/api/studies/${sid}/summary`)).json();
    expect(summary.notice).toMatch(/non indica efficacia/);
  });

  it('richiede il motivo per una valutazione mancata e traccia le correzioni', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const sid = ((await ft.get('/api/studies')).json() as any[])[0].id;
    const st = (await ft.get(`/api/studies/${sid}`)).json();
    const pid = st.participants[0].id;
    expect((await ft.put(`/api/studies/${sid}/participants/${pid}/assessments/T2`, { status: 'missed', date: null, missingReason: null, notes: '' })).statusCode).toBe(400);
    expect((await ft.put(`/api/studies/${sid}/participants/${pid}/assessments/T2`, { status: 'missed', date: null, missingReason: 'Paziente non disponibile', notes: '' })).statusCode).toBe(200);
    expect((await ft.put(`/api/studies/${sid}/participants/${pid}/assessments/T2`, { status: 'completed', date: localDay(), missingReason: null, notes: '' })).statusCode).toBe(400);
    expect((await ft.put(`/api/studies/${sid}/participants/${pid}/assessments/T2`, { status: 'completed', date: localDay(), missingReason: null, notes: '', reason: 'Valutazione recuperata' })).statusCode).toBe(200);
  });

  it('un collega non membro non vede lo studio', async () => {
    const col = new Client(app); await col.login('collega.demo');
    expect((await col.get('/api/studies')).json()).toEqual([]);
  });
});

describe('copia di sicurezza', () => {
  it('esportazione e reimportazione senza duplicati', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const id = (await ids(ft))['DEMO-001'];
    const backup = (await ft.get(`/api/patients/${id}/backup`)).json();
    const { get } = await import('../src/db.ts');
    const count = () => ({ runs: get(db, 'SELECT COUNT(*) AS n FROM exercise_runs')!.n, sessions: get(db, 'SELECT COUNT(*) AS n FROM training_sessions')!.n, sym: get(db, 'SELECT COUNT(*) AS n FROM symptom_reports')!.n, cal: get(db, 'SELECT COUNT(*) AS n FROM calibrations')!.n, pv: get(db, 'SELECT COUNT(*) AS n FROM program_versions')!.n });
    const before = count();
    const r1 = (await ft.post(`/api/patients/${id}/backup/import`, backup)).json();
    expect(r1.inserted).toEqual({ sessions: 0, runs: 0, symptoms: 0 });
    expect(count()).toEqual(before);
    // in un database nuovo l'importazione ripristina i dati e una seconda importazione non duplica
    const fresh = await setup();
    const ft2 = new Client(fresh.app); await ft2.login('ft.demo');
    const id2 = (await ids(ft2))['DEMO-001'];
    const b2 = { ...backup, patientId: id2, runs: backup.runs.map((r: any) => ({ ...r, id: 'x' + r.id.slice(1) })) };
    const a = (await ft2.post(`/api/patients/${id2}/backup/import`, b2)).json();
    expect(a.inserted.runs).toBe(backup.runs.length);
    const b = (await ft2.post(`/api/patients/${id2}/backup/import`, b2)).json();
    expect(b.inserted.runs).toBe(0);
    // un file di un altro paziente viene rifiutato
    expect((await ft.post(`/api/patients/${(await ids(ft))['DEMO-002']}/backup/import`, backup)).statusCode).toBe(400);
  });
});

describe('cruscotto', () => {
  it('riporta programma, ultima attività, sessioni, segnalazioni e sincronizzazione', async () => {
    const ft = new Client(app); await ft.login('ft.demo');
    const list = (await ft.get('/api/patients')).json() as any[];
    const d1 = list.find((p) => p.code === 'DEMO-001').summary;
    expect(d1.program.version).toBe(2);
    expect(d1.lastActivity).not.toBeNull();
    expect(d1.lastSync).not.toBeNull();
    expect(d1.week.sessionsPlanned).toBeGreaterThan(0);
    expect(d1.week.adherence).not.toBeNull();
    expect(d1.symptoms.count).toBeGreaterThan(0);
    expect(d1.measureTrends.length).toBeGreaterThan(0);
    const d3 = list.find((p) => p.code === 'DEMO-003').summary;
    expect(d3.program).toBeNull();
    expect(d3.lastSync).toBeNull();
  });
});

void device;
