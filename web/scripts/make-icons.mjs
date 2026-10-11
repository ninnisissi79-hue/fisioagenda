// Genera le icone PNG dell'app (nessuna dipendenza esterna): fondo verde acqua con cinque "polpastrelli".
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const dots = [[0.30, 0.66, 0.085], [0.42, 0.34, 0.075], [0.555, 0.28, 0.075], [0.69, 0.33, 0.07], [0.80, 0.45, 0.06]];
function png(size, rounded) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      let r = 15, g = 110, b = 110, a = 255;
      if (rounded) { const rr = 0.2, dx = Math.max(0, Math.abs(u - 0.5) - (0.5 - rr)), dy = Math.max(0, Math.abs(v - 0.5) - (0.5 - rr)); if (Math.hypot(dx, dy) > rr) a = 0; }
      // palmo
      if (Math.hypot((u - 0.55) / 0.3, (v - 0.78) / 0.2) < 1) { r = 230; g = 245; b = 243; }
      for (const [cx, cy, cr] of dots) if (Math.hypot(u - cx, v - cy) < cr) { r = 255; g = 255; b = 255; }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(`${out}/icon-192.png`, png(192, false));
writeFileSync(`${out}/icon-512.png`, png(512, false));
writeFileSync(`${out}/apple-touch-icon.png`, png(180, false));
const svgDots = dots.map(([x, y, r]) => `<circle cx="${x * 64}" cy="${y * 64}" r="${r * 64}" fill="#fff"/>`).join('');
writeFileSync(`${out}/icon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#0f6e6e"/><ellipse cx="35.2" cy="49.9" rx="19.2" ry="12.8" fill="#e6f5f3"/>${svgDots}</svg>`);
console.log('Icone generate in', out);
