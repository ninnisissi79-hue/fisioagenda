// Crea web/config.js per lo sviluppo LOCALE, leggendo indirizzo e chiave pubblica da `supabase status`.
// Non contiene segreti; il file è escluso da git.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = execFileSync(path.join(root, 'node_modules/.bin/supabase'), ['status', '-o', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const st = JSON.parse(out.slice(out.indexOf('{')));
writeFileSync(path.join(root, 'web/config.js'), `// Configurazione LOCALE di sviluppo (generata da tools/local-config.mjs)\nwindow.FA_CONFIG = { supabaseUrl: ${JSON.stringify(st.API_URL)}, supabaseKey: ${JSON.stringify(st.PUBLISHABLE_KEY || st.ANON_KEY)} };\n`);
console.log('web/config.js creato per ' + st.API_URL);
