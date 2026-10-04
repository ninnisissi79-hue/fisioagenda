/*
 * Crea il pacchetto da caricare su Netlify: dist/FisioAgenda-netlify.zip
 * Contenuto (nella cartella principale dello ZIP):
 *   index.html  — la demo completa in un unico file (stile e script incorporati)
 *   _headers    — istruzioni per Netlify: noindex anche come intestazione HTTP
 * Uso: npm run build:netlify
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });

const outDir = path.join(root, 'dist', 'netlify');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(root, 'dist', 'FisioAgenda.html'), path.join(outDir, 'index.html'));
fs.writeFileSync(path.join(outDir, '_headers'), [
  '# Regole lette da Netlify (questo file non è visibile ai visitatori).',
  '# X-Robots-Tag: noindex chiede ai motori di ricerca di non indicizzare il sito.',
  '# Attenzione: NON rende il sito privato. Chiunque abbia il link può aprirlo.',
  '/*',
  '  X-Robots-Tag: noindex, nofollow',
  '  Referrer-Policy: no-referrer',
  '  X-Content-Type-Options: nosniff',
  '  Cache-Control: no-cache',
  ''
].join('\n'));

// ZIP con i file nella cartella principale (zip "stored", senza dipendenze esterne)
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const files = ['index.html', '_headers'].map(name => ({ name, data: fs.readFileSync(path.join(outDir, name)) }));
const d = new Date();
const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
const locals = [], centrals = [];
let offset = 0;
for (const f of files) {
  const nameBuf = Buffer.from(f.name, 'utf8');
  const crc = crc32(f.data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
  lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
  locals.push(lh, nameBuf, f.data);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
  ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(0, 30); ch.writeUInt32LE(0, 34); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
  centrals.push(ch, nameBuf);
  offset += 30 + nameBuf.length + f.data.length;
}
const cdSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
const zipPath = path.join(root, 'dist', 'FisioAgenda-netlify.zip');
fs.writeFileSync(zipPath, Buffer.concat([...locals, ...centrals, end]));
console.log('Creato ' + path.relative(root, zipPath) + ' (' + Math.round(fs.statSync(zipPath).size / 1024) + ' KB): ' + files.map(f => f.name).join(', '));
