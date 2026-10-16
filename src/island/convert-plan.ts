// Ondine convertit (1.2.4) : le plan du geste, en fonctions pures (testées
// dans tests/front/convert.test.ts), comme hatch-plan.ts pour l'éclosion.
//
// Le geste (maquettes validées : animations-ile/maquette-conversion.html, puis
// maquette-depot-unifie.html, version A : tout dans l'île) :
//   1. un fichier glissé arrive sur l'île : elle s'ouvre (hauteur du contenu,
//      ressort), Ondine ouvre la bouche (« surpris »), les pilules arrivent
//      une à une dans l'île (drop-panel.ts) ;
//   2. une pilule survolée s'allume (Ondine « écoute » et la regarde) ; la
//      pilule d'option survolée une demi-seconde tourne (Conserver →
//      Remplacer → Sur le bureau) ;
//   3. lâché sur une pilule de format : Ondine l'avale (l'icône rétrécit et
//      file dans sa bouche), la pilule choisie glisse dans le bas de la
//      mini-île et se remplit pendant qu'elle mâche, le liquide de l'île
//      monte avec la vraie progression ;
//   4. fini : elle recrache le nouveau fichier (arc + rebond + paillettes),
//      la pilule de résultat prend la place de la progression, dans l'île
//      (nom · avant → après · Ouvrir · Annuler) ;
//   5. échec : grimace, l'original ressort, la pilule dit pourquoi ;
//   lâché ailleurs : rien, l'île se referme.
// « Réduire les animations » ou le mode Calme : les mêmes étapes en fondus.

import { clamp, lerp, smooth } from "./hatch-plan";

/** Les durées du geste (secondes). */
export const T = {
  /** Écart entre deux pilules qui arrivent dans l'île. */
  stagger: 0.028,
  /** L'icône file dans la bouche. */
  swallow: 0.5,
  /** Ondine mâche au moins ça, même si c'est déjà fini (le geste doit se lire). */
  minChew: 0.9,
  /** Elle mâche vite au début, puis se concentre. */
  chewFast: 1.4,
  /** L'arc du nouveau fichier. */
  arc: 0.9,
  /** Le sursaut avant la fierté. */
  startle: 0.6,
  /** La pilule de résultat reste (s) ; la survoler la garde. Comme « Annuler ». */
  result: 10,
  /** …et celle d'un échec. */
  failure: 6,
  /** Survol de la pilule d'option avant qu'elle tourne. */
  dwell: 0.5,
  /** Rangement final. */
  fold: 0.35,
} as const;

/** La place de la pilule de travail dans la mini-île, côté centre de l'écran (px). */
export const WORK_PAD = 50;

/**
 * Le centre vertical de la pilule de progression (puis de résultat) : dans
 * la partie basse de la mini-île agrandie (convert.css, classe convert-work),
 * la partie haute pour une île en bas (`dir` = -1).
 */
export function workY(rect: { top: number; bottom: number }, dir: 1 | -1): number {
  return dir === 1 ? rect.bottom - WORK_PAD / 2 : rect.top + WORK_PAD / 2;
}

/**
 * La largeur de la mini-île pour la pilule de résultat : au moins `min`,
 * assez pour la pilule et un peu d'air, jamais plus que la fenêtre
 * (`win`, moins la place de l'étirement).
 */
export function resultWidth(pill: number, min: number, win: number): number {
  return Math.round(Math.max(min, Math.min(win - 44, pill + 28)));
}

/** Le délai d'arrivée d'une pilule du dépôt (s) : une à une, plafonné pour une longue liste. */
export function pillDelay(index: number): number {
  return Math.min(index, 14) * T.stagger;
}

/**
 * Le survol de la pilule d'option : elle tourne après T.dwell secondes, une
 * seule fois par survol (il faut la quitter pour la refaire tourner).
 */
export class Dwell {
  private since: number | null = null;
  private fired = false;

  /** Appelé à chaque image ; renvoie true au moment où la pilule doit tourner. */
  update(over: boolean, now: number): boolean {
    if (!over) {
      this.since = null;
      this.fired = false;
      return false;
    }
    if (this.since === null) this.since = now;
    if (!this.fired && now - this.since >= T.dwell * 1000) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** 0 → 1 pendant l'attente (le petit trait sous la pilule), 0 une fois tournée. */
  progress(now: number): number {
    if (this.since === null || this.fired) return 0;
    return clamp((now - this.since) / (T.dwell * 1000));
  }
}

export interface Pose {
  x: number;
  y: number;
  s: number;
  r: number;
  o: number;
}

/** L'icône avalée : du point de lâcher à la bouche (u = 0 → 1). */
export function swallowPose(u: number, from: { x: number; y: number }, mouth: { x: number; y: number }, calm: boolean): Pose {
  u = clamp(u);
  if (calm) return { x: from.x, y: from.y, s: 1, r: 0, o: 1 - smooth(u / 0.6) };
  const e = u * u * u;
  return { x: lerp(from.x, mouth.x, e), y: lerp(from.y, mouth.y, e), s: lerp(1, 0.12, e), r: e * 1.6, o: 1 - clamp((u - 0.75) * 4) };
}

/** Un point d'une courbe de Bézier quadratique. */
function qbez(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, u: number) {
  return { x: lerp(lerp(a.x, c.x, u), lerp(c.x, b.x, u), u), y: lerp(lerp(a.y, c.y, u), lerp(c.y, b.y, u), u) };
}

/**
 * Le nouveau fichier recraché : un arc de la bouche vers sa place, puis un
 * rebond à l'arrivée (u = 0 → 1 pour l'arc, `land` = secondes depuis l'arrivée).
 * `lift` : la hauteur de l'arc (vers le haut de l'écran : -1 pour une île en bas).
 */
export function arcPose(u: number, land: number, from: { x: number; y: number }, to: { x: number; y: number }, calm: boolean, lift: 1 | -1 = 1): Pose & { sx: number; sy: number } {
  if (calm) return { ...to, s: 1, r: 0, o: smooth(clamp(u * 1.5)), sx: 1, sy: 1 };
  const e = smooth(u);
  const peak = lift === 1 ? Math.min(from.y, to.y) - 60 : Math.max(from.y, to.y) + 60;
  const p = qbez(from, { x: lerp(from.x, to.x, 0.5), y: peak }, to, e);
  const s = lerp(0.15, 1, 1 - Math.pow(1 - clamp(u), 3));
  let sx = 1;
  let sy = 1;
  if (land > 0 && land < 0.45) {
    // Écrasé à l'arrivée, il se relève (comme la gelée de l'île).
    const b = Math.sin((land / 0.45) * Math.PI) * (1 - land / 0.45);
    sx = 1 + 0.25 * b;
    sy = 1 - 0.22 * b;
  }
  return { x: p.x, y: p.y, s, r: 0, o: clamp(u * 6), sx, sy };
}

/** Les étapes après le lâcher. */
export type WorkPhase = "swallow" | "chew" | "spit" | "fail";

/**
 * L'expression d'Ondine (animation de la goutte gomme, et l'émotion proche
 * pour une autre mascotte) selon l'étape et le temps passé dedans (s).
 * null : rien à changer.
 */
export function expressionAt(phase: WorkPhase | "open" | "hover", t: number, batch: boolean): { anim: string; emotion: string } | null {
  switch (phase) {
    case "open":
      return { anim: "surpris", emotion: "surprised" };
    case "hover":
      return { anim: "ecoute", emotion: "listening" };
    case "swallow":
      return { anim: "eating", emotion: "eating" };
    case "chew":
      return t < T.chewFast ? { anim: "mange-vite", emotion: "eating" } : { anim: "concentree", emotion: "focus" };
    case "spit":
      return t < T.startle ? { anim: "sursaut", emotion: "surprised" } : batch ? { anim: "celebrate", emotion: "celebrate" } : { anim: "fiere", emotion: "proud" };
    case "fail":
      return t < 1 ? { anim: "oups", emotion: "worried" } : { anim: "genee", emotion: "embarrassed" };
  }
}

/** Le niveau du liquide de l'île pour une progression (0 → 1). */
export function liquidLevel(fraction: number): number {
  return 0.08 + 0.78 * clamp(fraction);
}
