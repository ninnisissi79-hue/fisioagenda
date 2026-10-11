import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { DB } from './db.ts';
import { HttpError } from './http.ts';
import { registerAuth } from './auth.ts';
import { patientRoutes } from './routes/patients.ts';
import { programRoutes } from './routes/programs.ts';
import { activityRoutes } from './routes/activity.ts';
import { researchRoutes } from './routes/research.ts';

export interface AppConfig { db: DB; staticDir?: string | null; secureCookies?: boolean; logger?: boolean; trustProxy?: boolean }

export async function buildApp(cfg: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: cfg.logger ?? false, bodyLimit: 8 * 1024 * 1024, trustProxy: cfg.trustProxy ?? false });
  await app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const status = (err as any).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'Richiesta non valida' });
    app.log.error(err);
    return reply.status(500).send({ error: 'Errore interno del server' });
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    else reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'");
  });

  registerAuth(app, cfg.db, { secureCookies: cfg.secureCookies ?? false });
  patientRoutes(app, cfg.db);
  programRoutes(app, cfg.db);
  activityRoutes(app, cfg.db);
  researchRoutes(app, cfg.db);

  app.get('/api/health', async () => ({ ok: true, app: 'Hand Lab' }));

  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    await app.register(fastifyStatic, { root: cfg.staticDir, wildcard: false, setHeaders: (res, path) => { if (path.endsWith('sw.js') || path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } });
    // l'app è a pagina singola: le rotte non API restituiscono index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Non trovato' });
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Non trovato' }));
  }
  return app;
}
