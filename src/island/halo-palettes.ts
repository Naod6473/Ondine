// Les couleurs et les rythmes du halo de l'île (halo.ts), À UN SEUL ENDROIT.
//
// Une palette = deux à six couleurs saturées qui tournent autour de l'île et se
// mélangent (jamais une couleur plate). Elles sont écrites pour un fond sombre
// (bureau sombre, mode sombre de Windows) ; pour un fond clair, `paletteColors`
// les fonce et les sature un peu (sinon un menthe pâle disparaît sur un fond
// blanc), sauf si la palette donne ses propres couleurs `light`.
//
// Ce fichier ne touche pas à la page : il est testé tel quel par Node
// (tests/front/halo.test.ts).

/** Une palette : couleurs pour fond sombre, et éventuellement pour fond clair. */
export interface Palette {
  dark: string[];
  light?: string[];
}

export const PALETTES = {
  // ── Batterie ──
  /** En charge : menthe → émeraude → cyan. */
  charge: { dark: ["#5cffc4", "#10d07a", "#22d3ee", "#7cffb2"] },
  /** Batterie pleine : vert et doré. */
  full: { dark: ["#2ee59d", "#ffd34d", "#b8f65a", "#ffe9a3"] },
  /** Débranchement, capture d'écran : un éclair blanc. */
  white: { dark: ["#ffffff", "#dcebff", "#ffffff", "#f3e8ff"], light: ["#64748b", "#3b82f6", "#94a3b8"] },
  /** Batterie faible : ambre → orange → corail. */
  low: { dark: ["#ffc247", "#ff8a1f", "#ff6b5a"] },
  /** Batterie critique : rouge → rose vif → bordeaux. */
  critical: { dark: ["#ff2d3a", "#ff3d9a", "#b0103a", "#ff5a36"] },
  // ── Agents IA et Ondine ──
  /** Un agent travaille : bleu → violet → cyan. */
  work: { dark: ["#3b82f6", "#8b5cf6", "#22d3ee"] },
  /** Un agent attend votre réponse : orange → rose. */
  waiting: { dark: ["#ff8a1f", "#ff4d9d", "#ffc247"] },
  /** Un agent a fini : vert vif, menthe, citron. */
  done: { dark: ["#22e07a", "#7cffcb", "#c6f432"] },
  /** Ondine réfléchit : trois gouttes violette, bleue, rose. */
  think: { dark: ["#a78bfa", "#60a5fa", "#f472b6"] },
  /** La voix (visio, micro) : vert d'eau. */
  voice: { dark: ["#34d399", "#22d3ee", "#a7f3d0"] },
  // ── Le PC ──
  /** Sortie de veille : rose → corail → doré (lever de soleil). */
  sunrise: { dark: ["#ff7eb3", "#ff9e7a", "#ffd36e"] },
  /** Heure de partir : orange → magenta → violet (coucher de soleil). */
  sunset: { dark: ["#ff8a3d", "#e0457b", "#6a4bc4", "#ffb057"] },
  /** Bonjour du matin : doux et lumineux. */
  morning: { dark: ["#ffe29a", "#ffb3c7", "#a5e7ff"] },
  /** Clé USB : turquoise → ciel → indigo. */
  usb: { dark: ["#2dd4bf", "#38bdf8", "#818cf8"] },
  /** Téléchargement : une goutte d'eau. */
  drop: { dark: ["#38e1ff", "#3b82f6", "#e0f7ff"] },
  /** Disque presque plein : l'eau d'un réservoir. */
  disk: { dark: ["#3ba8ff", "#2563eb", "#67e8f9"] },
  /** Wi-Fi faible : un signal qui grésille. */
  wifi: { dark: ["#94a3b8", "#67e8f9", "#f8fafc"], light: ["#475569", "#0891b2", "#64748b"] },
  /** Pluie : gouttes bleues. */
  rain: { dark: ["#60a5fa", "#93c5fd", "#a5f3fc"] },
  /** Orage : éclair blanc et violet. */
  storm: { dark: ["#e0e7ff", "#a78bfa", "#ffffff"], light: ["#6366f1", "#7c3aed", "#4338ca"] },
  /** Concentration : un cocon bleu nuit. */
  focus: { dark: ["#1e3a8a", "#3b4cca", "#6d5bd0"], light: ["#1e3a8a", "#312e81", "#4338ca"] },
  /** La fleur de fin de séance. */
  bloom: { dark: ["#f9a8d4", "#fde68a", "#c4b5fd", "#a7f3d0"] },
  /** Mise à jour disponible, série du jour : arc-en-ciel. */
  rainbow: { dark: ["#ff4d4d", "#ffa23a", "#ffe14d", "#4ade80", "#38bdf8", "#a78bfa"] },
  /** Processeur à fond : une teinte chaude. */
  cpu: { dark: ["#f97316", "#ef4444", "#facc15"] },
  /** Internet coupé. */
  offline: { dark: ["#ef4444", "#f97316", "#be123c"] },
  /** Internet revenu. */
  online: { dark: ["#22c55e", "#4ade80", "#2dd4bf"] },
  /** Rendez-vous qui approche. */
  meeting: { dark: ["#f472b6", "#a78bfa", "#60a5fa"] },
  /** Minuteur : la jauge qui se remplit. */
  timer: { dark: ["#fb7185", "#f59e0b", "#fde047"] },
  /** Musique (quand la pochette n'a pas donné ses couleurs). */
  music: { dark: ["#f472b6", "#818cf8", "#22d3ee"] },
  // ── Petits événements du clavier et du presse-papiers ──
  caps: { dark: ["#3b82f6", "#60a5fa", "#93c5fd"] },
  num: { dark: ["#6366f1", "#818cf8", "#a5b4fc"] },
  copy: { dark: ["#a855f7", "#c084fc", "#e879f9"] },
  paste: { dark: ["#22c55e", "#86efac", "#4ade80"] },
  cut: { dark: ["#ef4444", "#f87171", "#fb7185"] },
  volume: { dark: ["#38bdf8", "#22d3ee", "#a5f3fc"] },
  /** Un fichier posé sur l'étagère. */
  shelf: { dark: ["#2dd4bf", "#a78bfa", "#38bdf8"] },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

export function isPaletteName(v: unknown): v is PaletteName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PALETTES, v);
}

// ── Couleurs ─────────────────────────────────────────────────────────────────

/** « #rrggbb » → [r, g, b] (0 à 255) ; null si ce n'est pas une couleur. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** [r, g, b] → [teinte 0-360, saturation 0-1, luminosité 0-1]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** La même couleur, assez foncée et saturée pour se voir sur un fond clair. */
export function forLightBackground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(...rgb);
  return rgbToHex(...hslToRgb(h, Math.min(1, s * 1.1 + 0.05), Math.min(l, 0.5) * 0.92));
}

/** Les couleurs d'une palette pour ce fond (sombre ou clair). */
export function paletteColors(p: Palette, dark: boolean): string[] {
  if (dark) return p.dark;
  return p.light ?? p.dark.map(forLightBackground);
}

/** Mélange deux couleurs (t = 0 : a, t = 1 : b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

/** « #rrggbb » + opacité → « rgba(…) » pour le canvas. */
export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex) ?? [255, 255, 255];
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/**
 * Le ciel selon l'heure (aube rose, journée bleue, coucher orange, nuit
 * violette), pour l'aurore très lente « heure de la journée ».
 */
export function skyPalette(hour: number): Palette {
  if (hour >= 5 && hour < 8) return { dark: ["#ff9ec7", "#ffc79e", "#c3a6ff"] };
  if (hour >= 8 && hour < 17) return { dark: ["#5ab8ff", "#7dd3fc", "#a5b4fc"] };
  if (hour >= 17 && hour < 21) return { dark: ["#ff9f45", "#ff6f91", "#b26bff"] };
  return { dark: ["#6d4bd8", "#3b2f8f", "#a78bfa"] };
}

// ── Rythmes ──────────────────────────────────────────────────────────────────

/**
 * Le rythme dit l'urgence : lent et doux (respiration ≈ 3 s), moyen
 * (≈ 1,5 s), rapide (≈ 0,6 s), ou saccadé comme un cœur. Ou une période en ms.
 */
export type Rhythm = "slow" | "calm" | "medium" | "fast" | "heartbeat" | number;

const PERIODS: Record<Exclude<Rhythm, number>, number> = {
  slow: 6000,
  calm: 3000,
  medium: 1500,
  fast: 600,
  heartbeat: 900,
};

/** La période d'un rythme (ms), bornée pour ne jamais clignoter trop vite. */
export function rhythmMs(r: Rhythm | undefined): number {
  if (typeof r === "number" && Number.isFinite(r)) return Math.max(MIN_PERIOD_MS, Math.min(60_000, r));
  return PERIODS[(r as Exclude<Rhythm, number>) ?? "calm"] ?? PERIODS.calm;
}

/**
 * Jamais plus de ~2 pulsations par seconde : au-delà, un éclairage qui
 * clignote fatigue l'œil (et peut gêner les personnes sensibles).
 */
export const MIN_PERIOD_MS = 450;

/**
 * La pulsation (0 à 1) à l'instant `t` (ms) pour ce rythme : une respiration
 * douce (sinus), ou pour « heartbeat » deux battements rapprochés puis un
 * repos (boum-boum… boum-boum).
 */
export function pulse(r: Rhythm | undefined, t: number): number {
  const period = rhythmMs(r);
  const ph = (((t / period) % 1) + 1) % 1;
  if (r === "heartbeat") {
    const beat = (c: number) => Math.exp(-(((ph - c) / 0.06) ** 2));
    return Math.min(1, beat(0.12) + 0.75 * beat(0.34));
  }
  return 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
}

// ── Intensité ────────────────────────────────────────────────────────────────

/** Réglage « Intensité » : Discret, Normal, Vif. */
export type Intensity = "subtle" | "normal" | "vivid";

/** Épaisseur de la lueur (px) et opacité, selon l'intensité. */
export const INTENSITY: Record<Intensity, { glow: number; alpha: number }> = {
  subtle: { glow: 7, alpha: 0.55 },
  normal: { glow: 11, alpha: 0.8 },
  vivid: { glow: 16, alpha: 1 },
};

export function intensityOf(v: unknown): Intensity {
  return v === "subtle" || v === "normal" || v === "vivid" ? v : "vivid";
}
