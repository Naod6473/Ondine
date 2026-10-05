// Dessine l'icône de l'appli (la mascotte provisoire : une goutte avec deux yeux)
// et produit les PNG + le .ico dont Tauri a besoin. Aucune dépendance :
// pixels calculés ici, PNG encodé avec node:zlib.
//
//   npm run icons

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

const BODY = [124, 196, 255]; // bleu clair, même couleur que la mascotte
const EDGE = [24, 28, 38];
const EYE = [20, 22, 30];

/** Couleur RGBA d'un point (u, v) entre -1 et 1. */
function shade(u, v) {
  // Corps : une ellipse un peu plus large que haute, posée légèrement bas.
  const bx = u / 0.86;
  const by = (v - 0.06) / 0.76;
  const d = bx * bx + by * by;
  if (d > 1) return null;
  // Yeux : deux ellipses verticales.
  for (const ex of [-0.3, 0.3]) {
    const dx = (u - ex) / 0.11;
    const dy = (v + 0.02) / 0.18;
    if (dx * dx + dy * dy <= 1) return [...EYE, 255];
  }
  if (d > 0.86) return [...EDGE, 255];
  // Un léger dégradé de haut en bas.
  const k = 1 - Math.max(0, v) * 0.18;
  return [BODY[0] * k, BODY[1] * k, BODY[2] * k, 255].map(Math.round);
}

function render(size) {
  const SS = 4; // suréchantillonnage pour des bords lisses
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          const c = shade(u, v);
          if (!c) continue;
          for (let i = 0; i < 3; i++) acc[i] += c[i] * c[3];
          acc[3] += c[3];
        }
      }
      const o = (y * size + x) * 4;
      const n = SS * SS;
      if (acc[3] > 0) {
        px[o] = Math.round(acc[0] / acc[3]);
        px[o + 1] = Math.round(acc[1] / acc[3]);
        px[o + 2] = Math.round(acc[2] / acc[3]);
      }
      px[o + 3] = Math.round(acc[3] / n);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const px = render(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre "aucun"
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** Un .ico qui contient simplement des PNG (accepté depuis Windows Vista). */
function ico(sizes) {
  const images = sizes.map(png);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s;
    e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...images]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "32x32.png"), png(32));
writeFileSync(join(OUT, "128x128.png"), png(128));
writeFileSync(join(OUT, "128x128@2x.png"), png(256));
writeFileSync(join(OUT, "icon.png"), png(512));
writeFileSync(join(OUT, "icon.ico"), ico([16, 24, 32, 48, 64, 256]));
console.log(`icônes écrites dans ${OUT}`);
