// Les couleurs et les mascottes des bandes des Réglages (1.2.4). Données et
// calculs purs, sans DOM, testés dans tests/front/settings-hero.test.ts.
//
// Chaque page a une couleur (celle de son groupe, ou de sa catégorie de
// modules ; les pages Voix gardent la leur, VOICE_PAGES) et deux ou trois
// mascottes de la famille gomme qui vivent sur l'eau de sa bande.

import { GUM_FAMILY } from "../mascot/gum-family";

/** La couleur de chaque rubrique (1re colonne ; les pages Voix ont chacune la leur). */
export const GROUP_COLORS: Record<string, string> = {
  Voix: "#5fd4e6",
  Ondine: "#b79cff",
  "L'île": "#7cc4ff",
  Automatiser: "#ffb454",
  Modules: "#9fb4d8",
  Système: "#8fd6b0",
  "À propos": "#f0a8c8",
};

/** La couleur de chaque catégorie de modules (layout.ts, MODULE_CATEGORIES). */
export const CATEGORY_COLORS: Record<string, string> = {
  ai: "#c49bff",
  files: "#ffd166",
  organize: "#ff9db8",
  it: "#6ee7d2",
  daily: "#a8e36b",
  other: "#9fb4d8",
};

/** Quelques pages qui ont leur couleur à elles (sinon celle de leur groupe). */
export const PAGE_COLORS: Record<string, string> = {
  mascot: "#62c8ff",
  "module:askclaude": "#c49bff",
  animations: "#f28bd2",
  privacy: "#4cd98b",
  credentials: "#ffc25a",
  updates: "#7cc4ff",
};

/** La couleur d'une page : la sienne, celle de sa catégorie, sinon celle de son groupe. */
export function pageColor(page: { id: string; group: string; category?: string; color?: string }): string {
  return page.color ?? PAGE_COLORS[page.id] ?? (page.category ? CATEGORY_COLORS[page.category] : undefined) ?? GROUP_COLORS[page.group] ?? GROUP_COLORS.Modules;
}

// ── Les mascottes ────────────────────────────────────────────────────────────

/** Toutes les mascottes possibles dans une bande (la Météo, qui attend la météo, n'y va pas). */
export const HERO_MASCOTS: string[] = ["goutte-gomme", ...GUM_FAMILY.map((c) => c.id).filter((id) => id !== "gomme-meteo")];

/** Des pages qui ont leur troupe choisie (les autres en tirent une de leur id). */
export const PAGE_CASTS: Record<string, string[]> = {
  general: ["goutte-gomme", "gomme-guimauve"],
  mascot: ["gomme-coeur", "goutte-gomme", "gomme-etoile"],
  "module:askclaude": ["goutte-gomme", "gomme-nuage"],
  look: ["gomme-fleur", "gomme-dragee", "gomme-berlingot"],
  behavior: ["gomme-guimauve", "gomme-fantome"],
  animations: ["gomme-etoile", "gomme-soleil", "gomme-flamme"],
  tabs: ["gomme-dragee", "gomme-berlingot"],
  rules: ["gomme-flamme", "gomme-guimauve"],
  profiles: ["gomme-lune", "gomme-soleil"],
  privacy: ["gomme-fantome", "goutte-gomme"],
  credentials: ["gomme-champignon", "gomme-lune"],
  about: ["goutte-gomme", "gomme-etoile", "gomme-coeur"],
  "voice:dictation": ["gomme-dragee", "goutte-gomme", "gomme-berlingot"],
  "voice:callnotes": ["gomme-guimauve", "gomme-nuage"],
  "voice:stats": ["gomme-etoile", "gomme-dragee", "gomme-fleur"],
  "voice:dictionary": ["gomme-champignon", "goutte-gomme"],
  "voice:styles": ["gomme-coeur", "gomme-fleur", "gomme-berlingot"],
};

/**
 * Les pages Voix dessinent leur bande elles-mêmes (VOICE_PAGES) : sans
 * mascottes données, leur couleur (unique, fixée par le contrat) dit de
 * quelle page il s'agit, et donc quelle troupe y vit.
 */
export const COLOR_PAGES: Record<string, string> = {
  "#5fd4e6": "voice:dictation",
  "#ff8a6b": "voice:callnotes",
  "#4cd98b": "voice:stats",
  "#ffc25a": "voice:dictionary",
  "#f28bd2": "voice:styles",
};

/** La troupe d'une bande sans mascottes données : d'après sa couleur (pages Voix), sinon son titre. */
export function castForBand(title: string, color: string): string[] {
  const page = COLOR_PAGES[color.trim().toLowerCase()];
  return castFor(page ?? `${title}|${color}`);
}

/** Un nombre tiré d'un texte, toujours le même (FNV-1a 32 bits). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * La troupe d'une page : celle choisie (PAGE_CASTS), sinon deux ou trois
 * mascottes différentes tirées de l'id de la page (toujours les mêmes pour
 * une page, différentes d'une page à l'autre).
 */
export function castFor(pageId: string): string[] {
  const chosen = PAGE_CASTS[pageId];
  if (chosen) return [...chosen];
  const seed = seedOf(pageId);
  const count = 2 + (seed % 2);
  const out: string[] = [];
  let k = seed;
  while (out.length < count) {
    const id = HERO_MASCOTS[k % HERO_MASCOTS.length];
    if (!out.includes(id)) out.push(id);
    k = Math.imul(k ^ (k >>> 13), 0x5bd1e995) >>> 0;
    k = (k + out.length * 7919) >>> 0;
  }
  return out;
}

/** La forme (gum-shapes.ts) d'une mascotte de la famille gomme ; null : inconnue. */
export function shapeOf(id: string): string | null {
  if (id === "goutte-gomme") return "goutte";
  return GUM_FAMILY.find((c) => c.id === id)?.shape ?? null;
}

/** Les mascottes connues seulement, sans doublon, trois au plus. */
export function cleanCast(ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => shapeOf(id) !== null).slice(0, 3);
}

/**
 * Où chacune commence sur l'eau (0 = à gauche de sa zone, 1 = à droite) et sa
 * taille : la première est la plus grande, les autres un peu plus petites.
 */
export function castLayout(count: number): { start: number; scale: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ start: 0.6, scale: 1 }];
  return Array.from({ length: count }, (_, i) => ({ start: 0.08 + (0.84 * i) / (count - 1), scale: i === Math.floor(count / 2) ? 1 : 0.72 }));
}

// ── Couleurs ─────────────────────────────────────────────────────────────────

/** « #rrggbb » → [r, g, b] (0-255) ; une couleur invalide donne le bleu de l'île. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x7cc4ff;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Une couleur et une opacité, pour le Canvas et le CSS. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/** La luminance relative (WCAG 2.1). */
export function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Le contraste entre deux couleurs (1 à 21). AA : 4,5 pour le texte, 3 pour un gros titre ou une icône. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** L'encre des boutons pleins de la couleur de la page (et de la pilule du sous-menu choisi). */
export const HERO_INK = "#04121a";
/** Le fond des bandes (toujours sombre, même en thème clair). */
export const HERO_BG = "#03050a";
