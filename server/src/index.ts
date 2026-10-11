import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { buildApp } from './app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.HANDLAB_DB ?? resolve(here, '../../data/handlab.sqlite');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const staticDir = process.env.HANDLAB_STATIC ?? resolve(here, '../../web/dist');

const db = openDb(dbPath);
const app = await buildApp({ db, staticDir, secureCookies: process.env.COOKIE_SECURE === '1', logger: true, trustProxy: process.env.TRUST_PROXY === '1' });
await app.listen({ port, host });
console.log(`Hand Lab server su http://localhost:${port} (database: ${dbPath})`);
