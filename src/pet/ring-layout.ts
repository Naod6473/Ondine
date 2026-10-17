// Le menu en cercle d'Ondine sur le bureau (1.2.5) : la géométrie, sans DOM
// (testée dans tests/front/drop-menu.test.ts).
//
// Maquette validée : animations-ile/maquette-menu-cercle.html. Autour du
// centre (la goutte, avec l'étiquette du type) :
//   - trois bulles mères à angle fixe : Convertir en haut, Outils à gauche,
//     Ranger à droite. Le sens ne change jamais, même près d'un bord de
//     l'écran (on décale le menu, pas le sens : pet.rs, ring_frame) ;
//   - les choix du groupe ouvert dans l'arc de sa bulle mère : six sur la
//     première rangée, les suivants sur une deuxième rangée plus loin, dans
//     le même arc ;
//   - les favoris en bas (la place laissée libre), la bulle Étagère sous eux,
//     la pilule d'option (Conserver / Remplacer / Sur le bureau) sous le centre.
// Les angles sont en degrés, 0 à droite, 90 en bas (comme l'écran).

import type { DropRow } from "../island/drop-pills-logic";

/** Les tailles (px) : diamètres des bulles et rayons des rangées. */
export const RING = {
  /** Le côté de la fenêtre du cercle (px logiques, RING_SIZE dans pet.rs). */
  size: 600,
  core: 120,
  mother: 76,
  sub: 58,
  fav: 50,
  shelf: 58,
  r1: 104,
  r2: 196,
  r3: 258,
  favR: 140,
  shelfR: 210,
  /** L'écart entre deux choix (degrés) : première et deuxième rangée. */
  step1: 19,
  step2: 15,
  /** L'écart entre deux favoris (degrés). */
  favStep: 27,
  /** La pilule d'option : son centre, sous la goutte. */
  optY: 80,
} as const;

/** Six choix sur la première rangée, neuf au plus sur la deuxième. */
export const ROW1_MAX = 6;
export const ROW2_MAX = 9;
export const SUBS_MAX = ROW1_MAX + ROW2_MAX;

/** L'angle de chaque bulle mère (fixe). */
export const MOTHER_ANGLE: Record<DropRow, number> = { convert: -90, outils: 180, ranger: 0 };
/** L'ordre de sortie des bulles mères (50 ms d'écart). */
export const MOTHER_ORDER: readonly DropRow[] = ["convert", "outils", "ranger"];

export interface Spot {
  x: number;
  y: number;
}

/** Un point à `deg` degrés, à `r` px du centre. */
export function polar(deg: number, r: number): Spot {
  const t = (deg * Math.PI) / 180;
  return { x: Math.round(Math.cos(t) * r * 10) / 10, y: Math.round(Math.sin(t) * r * 10) / 10 };
}

export function motherSpot(row: DropRow): Spot {
  return polar(MOTHER_ANGLE[row], RING.r1);
}

/**
 * La place des `n` choix d'un groupe, dans l'arc de sa bulle mère : la
 * première rangée (au plus six, écart de 19°), puis la deuxième plus loin
 * (écart de 15°). Au-delà de SUBS_MAX, les derniers ne sont pas montrés.
 */
export function subSpots(row: DropRow, n: number): (Spot & { ring: 1 | 2 })[] {
  const count = Math.max(0, Math.min(n, SUBS_MAX));
  const n1 = Math.min(count, ROW1_MAX);
  const n2 = count - n1;
  const base = MOTHER_ANGLE[row];
  const out: (Spot & { ring: 1 | 2 })[] = [];
  for (let i = 0; i < count; i++) {
    const second = i >= n1;
    const j = second ? i - n1 : i;
    const k = second ? n2 : n1;
    const step = second ? RING.step2 : RING.step1;
    out.push({ ...polar(base + (j - (k - 1) / 2) * step, second ? RING.r3 : RING.r2), ring: second ? 2 : 1 });
  }
  return out;
}

/** La place des favoris : en bas du cercle, centrés, de gauche à droite dans leur ordre (Réglages → Étagère). */
export function favSpots(n: number): Spot[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => polar(90 - (i - (n - 1) / 2) * RING.favStep, RING.favR));
}

/** La bulle Étagère, toujours là, sous les favoris. */
export function shelfSpot(): Spot {
  return polar(90, RING.shelfR);
}

/** Le rayon le plus loin occupé par une bulle (bord compris) : la fenêtre doit le contenir. */
export function ringExtent(): number {
  return Math.max(RING.r3 + RING.sub / 2, RING.shelfR + RING.shelf / 2, RING.favR + RING.fav / 2);
}

/**
 * La bulle sous le pointeur (px depuis le centre) : un indice dans `spots`
 * (le plus proche, à moins du rayon + une marge), sinon -1.
 */
export function hitSpot(spots: Spot[], diameter: number, x: number, y: number, margin = 4): number {
  let best = -1;
  let bestD = Infinity;
  spots.forEach((s, i) => {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d <= diameter / 2 + margin && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Le délai de sortie de la i-ième bulle (s) : 50 ms d'écart pour les mères, 32 pour les choix. */
export function bubbleDelay(i: number, step = 0.05, base = 0): number {
  return base + i * step;
}
