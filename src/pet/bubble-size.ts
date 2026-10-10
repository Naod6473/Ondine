// La taille de la bulle d'Ondine sur le bureau (src/pet/main.ts).
//
// Comme l'île principale (src/island/fit.ts), la bulle prend la taille de son
// contenu, en largeur ET en hauteur : un onglet presque vide donne une petite
// bulle, une longue réponse ou une liste l'agrandissent. Jamais plus petite que
// BUBBLE_MIN (ni que la rangée d'onglets), jamais plus grande que BUBBLE_MAX ni
// que la place que l'écran laisse de son côté (maxW, maxH de la disposition,
// calculés par src-tauri/src/pet.rs avec les mêmes bornes).
//
// Sans page ni horloge : testé par Node (tests/front/pet-bubble.test.ts).

export const BUBBLE_MIN_W = 360;
export const BUBBLE_MIN_H = 120;
export const BUBBLE_MAX_W = 640;
export const BUBBLE_MAX_H = 560;

export interface Size {
  w: number;
  h: number;
}

/** La taille voulue, bornée : au moins le minimum, au plus `max` (l'écran) et BUBBLE_MAX. */
export function clampBubble(want: Size, max: Partial<Size> = {}): Size {
  const hiW = Math.max(BUBBLE_MIN_W, Math.min(BUBBLE_MAX_W, max.w ?? BUBBLE_MAX_W));
  const hiH = Math.max(BUBBLE_MIN_H, Math.min(BUBBLE_MAX_H, max.h ?? BUBBLE_MAX_H));
  const w = Number.isFinite(want.w) ? want.w : BUBBLE_MIN_W;
  const h = Number.isFinite(want.h) ? want.h : BUBBLE_MIN_H;
  return { w: Math.ceil(Math.max(BUBBLE_MIN_W, Math.min(hiW, w))), h: Math.ceil(Math.max(BUBBLE_MIN_H, Math.min(hiH, h))) };
}

/**
 * La place que la fenêtre doit garder pendant que la bulle va de `shown` à
 * `target` : la plus grande des deux dans chaque sens (rien n'est coupé en
 * route). La fenêtre grandit avant l'animation, et ne se resserre qu'après.
 */
export function roomFor(shown: Size, target: Size): Size {
  return { w: Math.ceil(Math.max(shown.w, target.w)), h: Math.ceil(Math.max(shown.h, target.h)) };
}

/** La fenêtre doit-elle changer (plus d'un demi-pixel d'écart) ? */
export function sameSize(a: Size | null, b: Size | null): boolean {
  return !!a && !!b && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}
