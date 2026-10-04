/*
 * Crea dist/FisioAgenda.html: un unico file con stile e script incorporati,
 * da aprire con doppio clic o da condividere come singolo allegato.
 * Uso: npm run build
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'FisioAgenda.html');
fs.writeFileSync(out, html);
console.log('Creato ' + path.relative(root, out) + ' (' + Math.round(html.length / 1024) + ' KB)');
