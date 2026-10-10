// Les calculs du liquide de l'île (liquid.ts), sans DOM : testés par Node
// (tests/front/liquid.test.ts).
//
//   - les matières (eau, gelée, lumière, sable) et leurs réglages physiques ;
//   - la surface : une chaîne de colonnes reliées à leurs voisines (vagues) ;
//   - la hauteur d'un remplissage qui suit le temps (minuteurs) ;
//   - la couleur peinte, assombrie ou plus transparente juste assez pour que
//     le texte de l'île reste lisible (contraste WCAG AA, 4,5:1) ;
//   - la nuit (étoiles), l'agitation des dernières secondes.

import { hexToRgb, mix, rgbToHex } from "./halo-palettes";
import { contrastRatio } from "./themes";

export type LiquidMatter = "water" | "jelly" | "light" | "sand";

export const MATTERS: readonly LiquidMatter[] = ["water", "jelly", "light", "sand"];

export function matterOf(v: unknown): LiquidMatter {
  return MATTERS.includes(v as LiquidMatter) ? (v as LiquidMatter) : "water";
}

/** Comment bouge chaque matière. */
export interface MatterFeel {
  /** Vitesse des vagues entre colonnes voisines (raideur du couplage). */
  tension: number;
  /** Rappel de chaque colonne vers le niveau (1/s²). */
  restore: number;
  /** Amortissement des vagues (par seconde). */
  damping: number;
  /** Ondulation de repos (px) et sa vitesse (rad/s). */
  idleAmp: number;
  idleSpeed: number;
  /** Bulles : combien par seconde au plus, vitesse de montée (px/s). */
  bubbles: number;
  rise: number;
  /** La pente quand l'île bouge : raideur et amortissement du ressort. */
  tilt: { stiffness: number; damping: number };
  /** Les couleurs s'additionnent (lumière) plutôt que se poser dessus. */
  additive: boolean;
}

export const FEEL: Record<LiquidMatter, MatterFeel> = {
  water: { tension: 900, restore: 30, damping: 2.2, idleAmp: 1.1, idleSpeed: 1.6, bubbles: 5, rise: 34, tilt: { stiffness: 60, damping: 0.25 }, additive: false },
  // La gelée : des vagues lentes et molles, peu de bulles, qui montent doucement.
  jelly: { tension: 260, restore: 18, damping: 3.4, idleAmp: 1.4, idleSpeed: 0.9, bubbles: 2, rise: 14, tilt: { stiffness: 26, damping: 0.4 }, additive: false },
  // La lumière : une surface vive, des étincelles qui montent, additive.
  light: { tension: 1200, restore: 40, damping: 2.6, idleAmp: 0.9, idleSpeed: 2.2, bubbles: 7, rise: 46, tilt: { stiffness: 80, damping: 0.35 }, additive: true },
  // Le sable : presque pas de vagues, des grains qui tombent au lieu de bulles.
  sand: { tension: 120, restore: 60, damping: 9, idleAmp: 0.15, idleSpeed: 0.5, bubbles: 0, rise: 0, tilt: { stiffness: 140, damping: 0.9 }, additive: false },
};

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

// ── La surface ──────────────────────────────────────────────────────────────

/** La surface : une hauteur (px, positive = vers le haut) et une vitesse par colonne. */
export interface Surface {
  h: Float32Array;
  v: Float32Array;
}

export function makeSurface(n: number): Surface {
  return { h: new Float32Array(n), v: new Float32Array(n) };
}

/**
 * Fait avancer les vagues de `dt` secondes : chaque colonne est tirée vers ses
 * voisines (les vagues voyagent) et vers le niveau (elles retombent), puis
 * amortie. Petits pas (1/240 s) : stable même à 30 images par seconde.
 * `calm` (0 à 1) amortit plus (concentration : un lac).
 */
export function stepSurface(s: Surface, feel: MatterFeel, dt: number, calm = 0): void {
  const n = s.h.length;
  if (n < 2) return;
  const total = Math.min(Math.max(dt, 0), 1 / 20);
  const steps = Math.max(1, Math.ceil(total / (1 / 240)));
  const k = total / steps;
  const damp = feel.damping + calm * 10;
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < n; i++) {
      const left = s.h[i > 0 ? i - 1 : i];
      const right = s.h[i < n - 1 ? i + 1 : i];
      const a = feel.tension * (left + right - 2 * s.h[i]) - feel.restore * s.h[i] - damp * s.v[i];
      s.v[i] += a * k;
    }
    for (let i = 0; i < n; i++) s.h[i] += s.v[i] * k;
  }
}

/** Une vaguelette : la surface est poussée vers le bas autour de `u` (0 à 1 le long de l'île). */
export function splash(s: Surface, u: number, strength: number, width = 0.08): void {
  const n = s.h.length;
  for (let i = 0; i < n; i++) {
    const d = (i / Math.max(1, n - 1) - u) / width;
    s.v[i] -= strength * Math.exp(-d * d);
  }
}

/** L'énergie des vagues (pour savoir si l'on peut ralentir la boucle). */
export function surfaceEnergy(s: Surface): number {
  let e = 0;
  for (let i = 0; i < s.h.length; i++) e += s.h[i] * s.h[i] + 0.01 * s.v[i] * s.v[i];
  return e / Math.max(1, s.h.length);
}

// ── Le temps ────────────────────────────────────────────────────────────────

export type FillDirection = "fill" | "drain";

/**
 * La hauteur d'un remplissage qui suit le temps : « fill » monte de 0 à 1
 * jusqu'à `endsAt`, « drain » descend de 1 à 0. Sans `endsAt` (en pause) :
 * `level` tel quel.
 */
export function timedLevel(now: number, endsAt: number | null, total: number, dir: FillDirection, level: number): number {
  if (endsAt == null || !(total > 0)) return clamp01(level);
  const left = clamp01((endsAt - now) / total);
  return dir === "drain" ? left : 1 - left;
}

/** L'eau s'agite dans les 10 dernières secondes : 0 avant, jusqu'à 1 à la fin. */
export const AGITATE_MS = 10_000;
export function agitation(now: number, endsAt: number | null): number {
  if (endsAt == null) return 0;
  const left = endsAt - now;
  if (left > AGITATE_MS || left < -1500) return 0;
  return clamp01(1 - left / AGITATE_MS);
}

/** La nuit (22 h – 6 h) : quelques étoiles se reflètent dans l'eau. */
export function isNight(d: Date): boolean {
  const h = d.getHours();
  return h >= 22 || h < 6;
}

// ── Les couleurs ────────────────────────────────────────────────────────────

/** Les couleurs nommées du réglage « Couleur du liquide ». */
export const LIQUID_COLORS: Record<string, string> = {
  blue: "#3ba4ff",
  teal: "#2ad1c0",
  green: "#3fd27a",
  violet: "#9b7bff",
  pink: "#ff6fb1",
  orange: "#ff9a3c",
};

/** Les teintes d'un moment, quand le moment impose la sienne (batterie, disque…). */
export const MOMENT_TINTS: Record<string, string> = {
  charge: "#3fd27a",
  low: "#ff8a3c",
  critical: "#ff4d4d",
  murky: "#8f8a5a",
  rest: "#5fe0b0",
  work: "#ff6a5c",
  agent: "#9b7bff",
  rain: "#6fa8dc",
};

/**
 * La couleur choisie : celle de l'île (son accent), de la mascotte, une couleur
 * nommée, ou une couleur personnelle « #rrggbb » (sinon celle de l'île).
 */
export function chooseColor(choice: unknown, custom: unknown, accent: string, mascot: string): string {
  if (choice === "mascot" && hexToRgb(mascot)) return mascot;
  if (choice === "custom" && typeof custom === "string" && /^#[0-9a-f]{6}$/i.test(custom.trim())) return custom.trim().toLowerCase();
  if (typeof choice === "string" && LIQUID_COLORS[choice]) return LIQUID_COLORS[choice];
  return hexToRgb(accent) ? accent : LIQUID_COLORS.blue;
}

/** Le contraste minimal du texte (WCAG AA). */
export const TEXT_CONTRAST = 4.5;

/** Ce que l'on voit à travers le liquide : le fond mélangé à la couleur (ou additionné, pour la lumière). */
export function seenThrough(bg: string, color: string, alpha: number, additive: boolean): string {
  if (!additive) return mix(bg, color, clamp01(alpha));
  const a = hexToRgb(bg) ?? [0, 0, 0];
  const c = hexToRgb(color) ?? [0, 0, 0];
  return rgbToHex(a[0] + c[0] * alpha, a[1] + c[1] * alpha, a[2] + c[2] * alpha);
}

/**
 * La couleur et l'opacité à peindre : on garde l'opacité voulue et l'on
 * assombrit la couleur juste assez pour que le texte le moins contrasté de
 * l'île (`fg` : le texte secondaire) reste à 4,5:1 au-dessus du liquide ; si
 * même très sombre elle ne suffit pas, on baisse l'opacité. Une lumière
 * (additive) qui devrait presque disparaître pour rester lisible (fond déjà
 * clair, thème Verre sur un bureau blanc) est posée normalement (`additive` false).
 */
export function readablePaint(color: string, bg: string, fg: string, opacity: number, additive: boolean, min = TEXT_CONTRAST): { color: string; alpha: number; additive: boolean } {
  const want = clamp01(opacity);
  const okFor = (c: string, a: number) => contrastRatio(fg, seenThrough(bg, c, a, additive)) >= min;
  // Un fond déjà trop clair pour son texte : on ne peut pas faire mieux que lui.
  if (contrastRatio(fg, bg) < min) return { color, alpha: Math.min(want, 0.15), additive: false };
  for (let k = 1; k >= 0.2; k -= 0.05) {
    const c = mix("#000000", color, k);
    if (okFor(c, want)) return { color: c, alpha: want, additive };
  }
  const dark = mix("#000000", color, 0.2);
  let a = want;
  while (a > 0.02 && !okFor(dark, a)) a -= 0.02;
  if (additive && a < want / 2) return readablePaint(color, bg, fg, opacity, false, min);
  return { color: dark, alpha: Math.max(0, a), additive };
}

/**
 * Lecture tolérante d'une couleur CSS calculée (« rgb(…) », « rgba(…) »,
 * « #rrggbb ») → « #rrggbb ». Une couleur en partie transparente (le fond du
 * thème Verre) est vue au pire au-dessus d'un bureau blanc.
 */
export function cssToHex(css: string, fallback: string): string {
  const s = (css ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (!m) return fallback;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (!(alpha > 0.01)) return fallback;
  const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
  return alpha < 1 ? mix(hex, "#ffffff", 1 - alpha) : hex;
}
