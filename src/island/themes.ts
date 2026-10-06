// Les couleurs de l'île : des thèmes tout faits, ou une couleur choisie.
//
// Un thème pose deux variables CSS sur la page de l'île : --island-bg (le fond
// de la forme) et --accent (la couleur des petits éléments actifs). Le texte
// reste clair : une couleur personnelle trop claire est donc assombrie juste
// assez pour que le texte reste lisible.

export interface Theme {
  id: string;
  name: string;
  bg: string;
  accent: string;
}

export const THEMES: Theme[] = [
  { id: "nuit", name: "Nuit", bg: "#0c0d12", accent: "#7cc4ff" },
  { id: "ocean", name: "Océan", bg: "#0a1a2c", accent: "#4fc3f7" },
  { id: "prune", name: "Prune", bg: "#1b0f24", accent: "#c58cff" },
  { id: "foret", name: "Forêt", bg: "#0d1a13", accent: "#5fd39a" },
  { id: "braise", name: "Braise", bg: "#211009", accent: "#ff9a5c" },
  { id: "graphite", name: "Graphite", bg: "#1c1d22", accent: "#c7cbd6" },
  // Le fond laisse un peu voir le bureau à travers (la fenêtre est transparente).
  { id: "verre", name: "Verre", bg: "rgba(18, 20, 28, 0.72)", accent: "#9fd8ff" },
  // Façon vidéo de présentation : noir profond, texte blanc, un seul accent blanc cassé.
  { id: "studio", name: "Studio", bg: "#000000", accent: "#f2f2f5" },
];

/** #rrggbb → [r, g, b] (0-255), ou null. */
function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** Luminosité perçue, de 0 (noir) à 1 (blanc). */
function luminance([r, g, b]: [number, number, number]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Une couleur personnelle → un thème : le fond est assombri si besoin (texte
 * clair lisible), l'accent est la même teinte, éclaircie.
 */
export function customTheme(hex: string): Theme {
  const c = rgb(hex) ?? [12, 13, 18];
  const lum = luminance(c);
  // Au-delà de 0,28 de luminosité, le texte clair devient difficile à lire.
  const k = lum > 0.28 ? 0.28 / lum : 1;
  const bg = c.map((v) => v * k) as [number, number, number];
  const accent = c.map((v) => v + (255 - v) * 0.55);
  return { id: "custom", name: "Personnalisée", bg: toHex(bg), accent: toHex(accent) };
}

/** Le thème des réglages (un id inconnu redevient « Nuit »). */
export function themeFor(id: string, color: string): Theme {
  if (id === "custom") return customTheme(color);
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Applique un thème à la page de l'île. */
export function applyTheme(id: string, color: string) {
  const t = themeFor(id, color);
  const root = document.documentElement.style;
  root.setProperty("--island-bg", t.bg);
  root.setProperty("--accent", t.accent);
  document.documentElement.dataset.theme = t.id;
}
