/**
 * Crea un database con dati DIMOSTRATIVI (pazienti fittizi).
 * Uso: npm run seed            (solo se il database è vuoto)
 *      npm run seed -- --reset (elimina il database e lo ricrea)
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';
import { localDay } from '@handlab/shared';
import { openDb, get } from '../db.ts';
import { seedDemo, DEMO_PASSWORD } from '../demo.ts';

const here = dirname(fileURLToPath(import.meta.url));
const path = process.env.HANDLAB_DB ?? resolve(here, '../../../data/handlab.sqlite');
if (process.argv.includes('--reset')) for (const suf of ['', '-wal', '-shm']) if (existsSync(path + suf)) rmSync(path + suf);
const db = openDb(path);
if (get(db, 'SELECT 1 FROM users LIMIT 1') && !get(db, "SELECT 1 FROM meta WHERE key = 'demo_seeded'")) {
  console.error('Il database contiene già account non dimostrativi: nessuna modifica. Usa un altro HANDLAB_DB per la demo.');
  process.exit(1);
}
await seedDemo(db, localDay());
console.log(`Database dimostrativo pronto: ${path}`);
console.log(`Account dimostrativi (password per tutti: ${DEMO_PASSWORD}):`);
console.log('  ft.demo        fisioterapista (responsabile dei pazienti DEMO)');
console.log('  collega.demo   fisioterapista con accesso in sola lettura a DEMO-001');
console.log('  admin.demo     amministratore (gestione account)');
console.log('  demo001        paziente DEMO-001 (mano destra)');
console.log('  demo002        paziente DEMO-002 (mano sinistra)');
