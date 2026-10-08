// Les ressorts de l'île, et le réglage « Élasticité » (Doux / Normal / Gelée).
//
// Pourquoi des ressorts plutôt que des transitions CSS ?
//   Une transition CSS part de la valeur affichée mais OUBLIE la vitesse : si
//   l'île change d'état au milieu d'une animation (on ouvre, puis on referme
//   tout de suite), elle repart à vitesse nulle, avec une cassure. Un ressort
//   garde une position ET une vitesse : changer de cible en route ne fait que
//   changer la force qui le tire, l'élan est conservé. C'est ce qui donne le
//   mouvement « continu » de la Dynamic Island d'Apple.
//
// Un ressort amorti, c'est deux nombres (x : position, v : vitesse) et une
// règle, appliquée à chaque image pendant un petit temps dt :
//     force = raideur × (cible − x) − amortissement × v
//     v += force × dt ;  x += v × dt
// (Euler « semi-implicite » : on met à jour la vitesse d'abord, c'est stable.)
//
// L'amortissement est donné en « rapport » (ζ, de 0 à 1) plutôt qu'en valeur
// brute : ζ = 1, aucun rebond ; ζ = 0,6, un dépassement d'environ 10 % ;
// ζ = 0,3, ça rebondit franchement. La vraie valeur est 2·ζ·√raideur.
//
// Ce fichier ne touche pas à la page (pas de document, pas de window) : il est
// testé tel quel par Node (tests/front/jelly.test.ts).

/** Un ressort : position et vitesse (px et px/s, ou sans unité). */
export interface Spring {
  x: number;
  v: number;
}

/** Les réglages d'un ressort : raideur (1/s²) et rapport d'amortissement ζ. */
export interface SpringParams {
  stiffness: number;
  damping: number;
}

/**
 * Le plus grand pas de calcul (s). Une image dure 16 ms (33 ms en économie
 * d'énergie) : on la découpe en petits pas, sinon un ressort raide « explose »
 * (le calcul pas à pas diverge quand dt × √raideur devient trop grand).
 */
export const MAX_SUBSTEP = 1 / 240;
/** Une image ne compte jamais pour plus que ça (après une pause, pas d'emballement). */
export const MAX_FRAME_DT = 1 / 20;

/** Fait avancer `s` de `dt` secondes vers `target`. */
export function stepSpring(s: Spring, target: number, p: SpringParams, dt: number): void {
  const total = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP));
  const h = total / steps;
  const c = 2 * p.damping * Math.sqrt(p.stiffness);
  for (let i = 0; i < steps; i++) {
    s.v += (p.stiffness * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}

/** Le ressort est-il posé ? (assez près de sa cible, et presque immobile) */
export function springAtRest(s: Spring, target: number, eps = 0.25, velEps = 4): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < velEps;
}

/**
 * Le dépassement (0 à 1) d'un ressort qui part du repos vers une cible :
 * e^(−πζ/√(1−ζ²)). Sert aux tests et à vérifier qu'une forme tient dans la
 * fenêtre (voir FEELS).
 */
export function overshoot(damping: number): number {
  if (damping >= 1) return 0;
  return Math.exp((-Math.PI * damping) / Math.sqrt(1 - damping * damping));
}

// ── Le réglage « Élasticité » ────────────────────────────────────────────────

export type Elasticity = "soft" | "normal" | "jelly";
export const ELASTICITIES: readonly Elasticity[] = ["soft", "normal", "jelly"];

/** Le réglage lu dans les réglages : une valeur inconnue (fichier abîmé) redevient "normal". */
export function elasticityOf(value: unknown): Elasticity {
  return ELASTICITIES.includes(value as Elasticity) ? (value as Elasticity) : "normal";
}

/**
 * Tout ce que règle l'élasticité.
 *
 *   lead / trail   la forme de l'île. « lead » : l'épaisseur (la hauteur quand
 *                  l'île est en haut de l'écran), qui MÈNE : elle part vite et
 *                  dépasse un peu. « trail » : la longueur (la largeur), plus
 *                  molle, qui SUIT. À l'ouverture, l'île est donc d'abord haute
 *                  et fine, puis s'élargit ; à la fermeture, elle s'aplatit
 *                  d'abord, encore large, puis se rétracte.
 *   squash         l'écrasement selon la vitesse (conservation du volume) :
 *                  part de la vitesse de l'épaisseur (px/s) transformée en
 *                  étirement. 0 = aucun.
 *   amp            l'amplitude des déformations (creux d'un clic, gonflement
 *                  au survol, choc d'une alerte), 1 = normal.
 *   edge           la chaîne de points du contour (contour.ts) : rappel vers
 *                  la forme (k), frottement (c), tension entre voisins (T :
 *                  plus elle est forte, plus l'onde voyage vite).
 *   bump           le retour de la bosse quand on lâche l'étirement.
 */
export interface Feel {
  lead: SpringParams;
  trail: SpringParams;
  squash: number;
  amp: number;
  edge: { k: number; c: number; tension: number };
  bump: SpringParams;
}

export const FEELS: Record<Elasticity, Feel> = {
  // Doux : presque sans rebond, déformations discrètes (bureau, présentations).
  soft: {
    lead: { stiffness: 340, damping: 0.86 },
    trail: { stiffness: 260, damping: 0.98 },
    squash: 0.5,
    amp: 0.6,
    edge: { k: 170, c: 16, tension: 7000 },
    bump: { stiffness: 360, damping: 0.62 },
  },
  // Normal : un petit dépassement (≈ 8 % sur l'épaisseur), comme avant.
  normal: {
    lead: { stiffness: 420, damping: 0.62 },
    trail: { stiffness: 300, damping: 0.8 },
    squash: 1,
    amp: 1,
    edge: { k: 150, c: 9, tension: 9000 },
    // Les valeurs de l'ancien étirement (gestures.ts) : raide et un peu mou.
    bump: { stiffness: 420, damping: 0.32 },
  },
  // Gelée : ça tremblote franchement.
  jelly: {
    // (0,5 : ≈ 16 % de dépassement ; l'île ouverte, 270 px, tient encore dans
    // la fenêtre de 320 px.)
    lead: { stiffness: 400, damping: 0.5 },
    trail: { stiffness: 250, damping: 0.62 },
    squash: 1.6,
    amp: 1.4,
    edge: { k: 130, c: 5, tension: 9000 },
    bump: { stiffness: 380, damping: 0.22 },
  },
};

/**
 * Les réglages effectifs : l'élasticité choisie, un peu plus rebondie en
 * « Studio » (comme l'ancienne courbe CSS : 8 % de dépassement au lieu de 4 %),
 * sauf pour le grand panneau, qui toucherait les bords de la fenêtre.
 */
export function feelFor(e: Elasticity, studio: boolean, big: boolean): Feel {
  const f = FEELS[e];
  if (!studio || big) return f;
  const livelier = (p: SpringParams): SpringParams => ({ stiffness: p.stiffness, damping: p.damping * 0.85 });
  return { ...f, lead: livelier(f.lead), trail: livelier(f.trail) };
}

/**
 * L'écrasement selon la vitesse : l'île qui grandit vite dans son épaisseur
 * s'étire dans ce sens et s'affine dans l'autre (et l'inverse en rétrécissant),
 * à volume constant : [échelle de l'épaisseur, échelle de la longueur].
 * `velocity` en px/s ; plafonné à ±10 % (au-delà, le texte se lirait mal).
 */
export function squashScale(velocity: number, amount: number): [number, number] {
  const k = Math.max(-0.1, Math.min(0.1, (velocity / 20000) * amount));
  const along = 1 + k;
  return [along, 1 / along];
}

/** Élastique : suit au début, puis résiste de plus en plus (jamais plus que `max`). */
export function rubber(d: number, max: number): number {
  if (max <= 0) return 0;
  return max * (1 - Math.exp(-Math.abs(d) / (max * 2.2))) * Math.sign(d);
}
