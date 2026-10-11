/**
 * Crea un account di professionista o amministratore.
 * Uso: npm run create-user -- --username mrossi --name "Maria Rossi" --role therapist --password "..."
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openDb, get } from '../db.ts';
import { createUser, passwordProblem } from '../auth.ts';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { username: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'therapist' }, password: { type: 'string' } } });
if (!values.username || !values.name || !values.password) {
  console.error('Uso: npm run create-user -- --username <nome> --name "<Nome visualizzato>" --role therapist|admin --password <password>');
  process.exit(1);
}
if (!['therapist', 'admin'].includes(values.role!)) { console.error('Ruolo non valido'); process.exit(1); }
const prob = passwordProblem(values.password);
if (prob) { console.error(prob); process.exit(1); }
const db = openDb(process.env.HANDLAB_DB ?? resolve(here, '../../../data/handlab.sqlite'));
if (get(db, 'SELECT 1 FROM users WHERE username = ?', values.username.toLowerCase())) { console.error('Nome utente già in uso'); process.exit(1); }
await createUser(db, { username: values.username, password: values.password, role: values.role as 'therapist' | 'admin', displayName: values.name, mustChange: true });
console.log(`Creato account ${values.role} "${values.username}". Al primo accesso verrà chiesto di cambiare la password.`);
