// Les couleurs de l'île : des thèmes tout faits, ou une couleur choisie.
//
// Un thème pose des variables CSS sur la page de l'île : --island-bg (le fond
// de la forme), --accent (la couleur des petits éléments actifs) et --muted
// (le texte secondaire). Le texte reste clair : une couleur personnelle trop
// claire est donc assombrie juste assez pour que le texte reste lisible.
//
// Lisibilité (WCAG AA) : le texte principal (#eef0f6) et le texte secondaire
// (--muted) ont un contraste d'au moins 4,5:1 sur chaque fond (vérifié par
// contrastRatio ; les thèmes tout faits sont tous au-dessus de 6:1).

export interface Theme {
  id: string;
  name: string;
  bg: string;
  accent: string;
  /** Le texte secondaire, s'il doit différer de celui par défaut (MUTED). */
  muted?: string;
}

/** Texte principal et secondaire par défaut (doivent suivre island.css). */
export const FG = "#eef0f6";
export const MUTED = "#9aa0b4";

export const THEMES: Theme[] = [
  { id: "nuit", name: "Nuit", bg: "#0c0d12", accent: "#7cc4ff" },
  { id: "ocean", name: "Océan", bg: "#0a1a2c", accent: "#4fc3f7" },
  { id: "prune", name: "Prune", bg: "#1b0f24", accent: "#c58cff" },
  { id: "foret", name: "Forêt", bg: "#0d1a13", accent: "#5fd39a" },
  { id: "braise", name: "Braise", bg: "#211009", accent: "#ff9a5c" },
  { id: "graphite", name: "Graphite", bg: "#1c1d22", accent: "#c7cbd6" },
  // Le fond laisse un peu voir le bureau à travers (la fenêtre est transparente).
  // Sur un bureau tout blanc, le texte secondaire habituel tombait à 2,8:1 : le
  // fond est un peu plus couvrant (0,78 au lieu de 0,72) et le texte secondaire
  // plus clair, ce qui garde 4,9:1 même au-dessus d'une page blanche.
  { id: "verre", name: "Verre", bg: "rgba(18, 20, 28, 0.78)", accent: "#9fd8ff", muted: "#b8bdcc" },
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

/** Luminance relative (définition WCAG), de 0 (noir) à 1 (blanc). */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contraste entre deux couleurs #rrggbb, de 1 (aucun) à 21 (noir sur blanc). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(rgb(a) ?? [0, 0, 0]);
  const lb = luminance(rgb(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Le contraste minimal pour du texte (WCAG AA). */
const MIN_CONTRAST = 4.5;

/**
 * Une couleur personnelle → un thème : le fond est assombri si besoin, juste
 * assez pour que le texte secondaire (le moins contrasté) reste à 4,5:1 ;
 * l'accent est la même teinte, éclaircie.
 *
 * (Avant, on mesurait une luminosité « perçue » approximative : un magenta ou
 * un rouge vif passaient sans être assombris, avec un texte illisible.)
 */
export function customTheme(hex: string): Theme {
  const c = rgb(hex) ?? [12, 13, 18];
  let k = 1;
  const at = (f: number) => toHex(c.map((v) => v * f));
  // On assombrit par petits pas : la couleur garde sa teinte.
  while (k > 0 && contrastRatio(MUTED, at(k)) < MIN_CONTRAST) k -= 0.01;
  const bg = at(Math.max(0, k));
  const accent = c.map((v) => v + (255 - v) * 0.55);
  return { id: "custom", name: "Personnalisée", bg, accent: toHex(accent) };
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
  root.setProperty("--muted", t.muted ?? MUTED);
  document.documentElement.dataset.theme = t.id;
}
