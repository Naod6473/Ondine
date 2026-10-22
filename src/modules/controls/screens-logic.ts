// Contrôles → Écrans (1.2.5) : la logique sans DOM (testée dans
// tests/front/controls-blocks.test.ts).

export type DisplayMode = "internal" | "clone" | "extend" | "external";

export const DISPLAY_MODES: DisplayMode[] = ["internal", "clone", "extend", "external"];

/** La réponse de « display_layout ». */
export interface DisplayLayout {
  mode: DisplayMode | null;
  /** Écrans branchés (actifs ou non). */
  connected: number;
}

/** Un écran actif (« displays »). */
export interface DisplayInfo {
  id: string;
  name: string;
  primary: boolean;
  internal: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Les mots du panneau de Windows+P. */
export function modeName(mode: DisplayMode): string {
  return { internal: "PC seul", clone: "Dupliquer", extend: "Étendre", external: "2e écran seul" }[mode];
}

/** Le dessin d'un écran pour « Écran principal » : à l'échelle, de gauche à droite. */
export interface MonitorBox {
  id: string;
  name: string;
  primary: boolean;
  /** Le numéro affiché (1, 2…), dans l'ordre de gauche à droite. */
  index: number;
  w: number;
  h: number;
}

/** Le plus grand écran fait MAX_W px de large ; les autres à la même échelle (24 px au moins). */
const MAX_W = 88;
const MIN_W = 24;

export function monitorBoxes(list: DisplayInfo[]): MonitorBox[] {
  const widest = Math.max(1, ...list.map((d) => d.width));
  return [...list]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((d, i) => {
      const w = Math.max(MIN_W, Math.round((d.width / widest) * MAX_W));
      const ratio = d.width > 0 ? d.height / d.width : 9 / 16;
      return { id: d.id, name: d.name, primary: d.primary, index: i + 1, w, h: Math.max(16, Math.round(w * ratio)) };
    });
}
