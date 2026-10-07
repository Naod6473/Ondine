// Les mouvements du corps (respiration, saut, tremblement…), partagés par les
// moteurs à images : planches de sprites et poses.

import type { SpriteEffect } from "../types";

const TAU = Math.PI * 2;

/** Transformation du corps à un instant donné. */
export interface Motion {
  /** Décalage vertical, en fraction de la hauteur (négatif = vers le haut). */
  dy: number;
  dx: number;
  /** Étirement vertical (1 = normal) ; l'horizontal compense. */
  squash: number;
  rot: number;
  /** Opacité (0 à 1). */
  alpha: number;
}

export const STILL: Motion = { dy: 0, dx: 0, squash: 1, rot: 0, alpha: 1 };

/** Les mouvements. `t` = secondes depuis le début, `p` = progression 0..1. */
export const EFFECTS: Record<SpriteEffect, (t: number, p: number) => Partial<Motion>> = {
  breathe: (t) => ({ squash: 1 + Math.sin((t / 3.2) * TAU) * 0.025 }),
  wake: (_t, p) => ({ squash: 1 + Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.12, dy: -Math.sin(p * Math.PI) * 0.04 }),
  sleep: (t) => ({ squash: 0.96 + Math.sin((t / 4) * TAU) * 0.04, dy: 0.03, alpha: 0.85 }),
  bounce: (_t, p) => ({ dy: -Math.abs(Math.sin(p * TAU)) * 0.14, squash: 1 + Math.sin(p * TAU * 2) * 0.05 }),
  jump: (_t, p) => ({ dy: -Math.abs(Math.sin(p * TAU)) * 0.25, squash: 1 + Math.sin(p * TAU * 2) * 0.08 }),
  shake: (t, p) => ({ dx: Math.sin(t * 45) * 0.04 * (1 - p) }),
  wobble: (t, p) => ({ rot: Math.sin(t * 7) * 0.2 * (1 - p * 0.5), dy: Math.sin(t * 5) * 0.03 }),
  bob: (t) => ({ dy: -Math.abs(Math.sin(t * 6)) * 0.03 }),
  pulse: (t) => ({ dy: -Math.abs(Math.sin(t * 5)) * 0.06, squash: 1 + Math.abs(Math.sin(t * 5)) * 0.04 }),
  chomp: (_t, p) => ({ squash: p < 0.75 ? 1 - Math.abs(Math.sin(p * Math.PI * 4)) * 0.1 : 1 + Math.sin((p - 0.75) * 4 * Math.PI) * 0.08 }),
  sway: (t) => ({ rot: Math.sin(t * 2.5) * 0.08 }),
  sigh: (t) => ({ squash: 1 - Math.max(0, Math.sin(t * 0.9)) * 0.05, dy: 0.01 }),
  // Bâillement : la goutte s'étire vers le haut, puis se tasse.
  stretch: (_t, p) => ({ squash: 1 + Math.sin(Math.min(1, p * 1.3) * Math.PI) * 0.12, rot: Math.sin(p * Math.PI) * 0.05 }),
  // Oups : un petit sursaut en arrière, puis elle se tasse un peu.
  // Esquive au ralenti (pluie de code) : elle se penche loin en arrière, très lentement, puis se redresse.
  dodge: (_t, p) => {
    const k = Math.sin(Math.min(1, p * 1.15) * Math.PI);
    const bell = k * k * (3 - 2 * k);
    return { rot: -0.55 * bell, dx: -0.1 * bell, squash: 1 + 0.1 * bell };
  },
  flinch: (_t, p) => ({ dy: -Math.sin(Math.min(1, p * 4) * Math.PI) * 0.04, squash: p < 0.25 ? 1.06 : 1 - Math.sin(((p - 0.25) / 0.75) * Math.PI) * 0.04 }),
};
