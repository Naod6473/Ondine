// Les couleurs du halo d'après la pochette du morceau en lecture (1.2.3).
// Sans DOM : testé par tests/front/cover-palette.test.ts.
//
// La pochette est déjà réduite à quelques pixels par src/mascot/env-tint.ts
// (rien ne quitte la fenêtre). On range ses pixels par teinte (12 tranches de
// 30°), chacun compté selon sa saturation (le gris, le noir et le blanc d'une
// pochette comptent peu), et l'on garde les trois teintes les plus présentes.
// Elles sont ensuite rendues lumineuses et saturées, comme les autres palettes
// du halo (écrites pour un fond sombre ; halo-palettes.ts les fonce pour un
// fond clair) : un halo n'est jamais terne, même pour une pochette sépia.

import { rgbToHex } from "./halo-palettes";

const BINS = 12;

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Une teinte rendue vive pour le halo : saturée, ni trop sombre ni délavée. */
function vivid(h: number, s: number, l: number): string {
  const [r, g, b] = fromHsl(h, Math.max(0.62, Math.min(1, s * 1.25)), Math.max(0.52, Math.min(0.7, l)));
  return rgbToHex(r, g, b);
}

/**
 * Les couleurs du halo pour ces pixels RVBA (2 à 3 couleurs « #rrggbb »), ou
 * null si la pochette est presque sans couleur (le halo garde alors sa
 * palette « musique »).
 */
export function coverPalette(data: ArrayLike<number>): string[] | null {
  const bins = Array.from({ length: BINS }, () => ({ w: 0, x: 0, y: 0, s: 0, l: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.5) continue;
    const [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
    // Les pixels très sombres ou presque blancs ne donnent pas de couleur.
    const w = a * s * s * (l > 0.12 && l < 0.92 ? 1 : 0.1);
    if (w <= 0) continue;
    const bin = bins[Math.floor(h / (360 / BINS)) % BINS];
    // La teinte moyenne d'une tranche : en cercle (350° et 10° font 0°, pas 180°).
    const rad = (h * Math.PI) / 180;
    bin.w += w;
    bin.x += Math.cos(rad) * w;
    bin.y += Math.sin(rad) * w;
    bin.s += s * w;
    bin.l += l * w;
    total += w;
  }
  if (total < 0.5) return null;
  const ranked = bins.filter((b) => b.w >= total * 0.08).sort((a, b) => b.w - a.w).slice(0, 3);
  const colors = ranked.map((b) => {
    const h = ((Math.atan2(b.y, b.x) * 180) / Math.PI + 360) % 360;
    return { h, c: vivid(h, b.s / b.w, b.l / b.w) };
  });
  // Une seule teinte : deux voisines (± 28°) pour que la lumière bouge quand même.
  if (colors.length === 1) {
    const [{ h }] = colors;
    const b = ranked[0];
    return [colors[0].c, vivid((h + 28) % 360, b.s / b.w, b.l / b.w + 0.08), vivid((h + 332) % 360, b.s / b.w, b.l / b.w - 0.04)];
  }
  return colors.map((x) => x.c);
}
