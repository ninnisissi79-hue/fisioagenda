// Prepara i file da consegnare:
//  1) supabase/setup-completo.sql: schema + regole, da incollare una volta nell'editor SQL di Supabase;
//  2) (facoltativo) dist/sito/ e dist/fisioagenda-pilota-sito.zip: il sito statico con config.js,
//     solo se si indicano l'indirizzo e la chiave PUBBLICA del progetto:
//       FA_URL=https://xxxx.supabase.co FA_KEY=sb_publishable_... node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mig = path.join(root, 'supabase/migrations');
const parts = fs.readdirSync(mig).filter(f => f.endsWith('.sql')).sort()
  .map(f => `-- >>> ${f}\n` + fs.readFileSync(path.join(mig, f), 'utf8'));
fs.writeFileSync(path.join(root, 'supabase/setup-completo.sql'),
  '-- FisioAgenda pilota: installazione completa del database (generato da tools/build.mjs).\n' +
  '-- Da eseguire UNA SOLA VOLTA su un progetto Supabase nuovo: SQL Editor → incolla → Run.\n\n' + parts.join('\n\n'));
console.log('Creato supabase/setup-completo.sql');

const url = process.env.FA_URL, key = process.env.FA_KEY;
if (!url || !key) { console.log('Sito non generato: indica FA_URL e FA_KEY (chiave pubblica) per creare il pacchetto.'); process.exit(0); }
if (/service_role|sb_secret_/.test(key)) { console.error('ERRORE: questa è una chiave SEGRETA. Usa la chiave pubblica (publishable/anon).'); process.exit(1); }
const out = path.join(root, 'dist/sito');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), out, { recursive: true, filter: s => !s.endsWith('config.js') || s.endsWith('config.example.js') });
fs.writeFileSync(path.join(out, 'config.js'), `window.FA_CONFIG = { supabaseUrl: ${JSON.stringify(url)}, supabaseKey: ${JSON.stringify(key)} };\n`);
fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n');
const zip = path.join(root, 'dist/fisioagenda-pilota-sito.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
console.log('Creati dist/sito/ e dist/fisioagenda-pilota-sito.zip');
