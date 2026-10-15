// Ondine convertit (1.2.5) : le plan du geste, en fonctions pures (testées
// dans tests/front/convert.test.ts), comme hatch-plan.ts pour l'éclosion.
//
// Le geste (maquette validée, animations-ile/maquette-conversion.html) :
//   1. un fichier glissé arrive sur l'île : elle s'ouvre, Ondine ouvre la
//      bouche (« surpris »), les pilules de formats sortent en éventail sous
//      l'île, une à une (ressorts), puis la pilule d'option ;
//   2. une pilule survolée s'allume (Ondine « écoute ») ; la pilule d'option
//      survolée une demi-seconde tourne (Conserver → Remplacer → Sur le bureau) ;
//   3. lâché sur une pilule : Ondine l'avale (l'icône rétrécit et file dans
//      sa bouche), la pilule choisie glisse au centre et se remplit pendant
//      qu'elle mâche, le liquide de l'île monte avec la vraie progression ;
//   4. fini : elle recrache le nouveau fichier (arc + rebond + paillettes),
//      la pilule de résultat sort (nom · avant → après · Ouvrir · Annuler) ;
//   5. échec : grimace, l'original ressort, la pilule dit pourquoi ;
//   lâché ailleurs : rien, l'île se referme.
// « Réduire les animations » ou le mode Calme : les mêmes étapes en fondus.

import { clamp, lerp, smooth, spr } from "./hatch-plan";

/** Les durées du geste (secondes). */
export const T = {
  /** Écart entre deux pilules qui sortent. */
  stagger: 0.055,
  /** Les pilules rentrent (glisser parti, ou fichier lâché ailleurs). */
  retract: 0.25,
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

/** La hauteur d'une pilule, l'écart entre deux, entre deux rangées, et sous l'île (px). */
export const PILL_H = 36;
export const PILL_GAP = 10;
export const ROW_GAP = 8;
export const BELOW = 12;

/** Le ressort d'une pilule qui sort (0 → 1, dépasse un peu), ou un fondu en mode Calme. */
export function fanK(t: number, index: number, calm: boolean): number {
  const s = t - index * T.stagger;
  if (s <= 0) return 0;
  return calm ? smooth(s / 0.3) : spr(s, 7.5, 12.5);
}

/** Les pilules qui rentrent (1 → 0). */
export function retractK(t: number): number {
  return 1 - smooth(t / T.retract);
}

/** La place d'une pilule : son centre (x, y), sa largeur, sa rangée. */
export interface Slot {
  x: number;
  y: number;
  w: number;
  row: number;
}

/**
 * Range les pilules en rangées centrées sous (ou au-dessus de) l'île.
 * `anchor` = le bord de l'île côté pilules ; `dir` = 1 vers le bas, -1 vers
 * le haut (île en bas de l'écran). Une rangée ne dépasse pas `maxW`.
 */
export function layoutPills(widths: number[], cx: number, anchor: number, dir: 1 | -1, maxW: number): Slot[] {
  const rows: number[][] = [[]];
  let used = 0;
  widths.forEach((w, i) => {
    const row = rows[rows.length - 1];
    const need = row.length ? used + PILL_GAP + w : w;
    if (row.length && need > maxW) {
      rows.push([i]);
      used = w;
    } else {
      row.push(i);
      used = need;
    }
  });
  const slots: Slot[] = [];
  rows.forEach((row, r) => {
    const total = row.reduce((s, i) => s + widths[i], 0) + PILL_GAP * Math.max(0, row.length - 1);
    let x = cx - total / 2;
    const y = anchor + dir * (BELOW + PILL_H / 2 + r * (PILL_H + ROW_GAP));
    for (const i of row) {
      slots[i] = { x: x + widths[i] / 2, y, w: widths[i], row: r };
      x += widths[i] + PILL_GAP;
    }
  });
  return slots;
}

/** Le centre de la pilule d'option : une rangée sous les pilules de formats. */
export function optionY(slots: Slot[], anchor: number, dir: 1 | -1): number {
  const rows = slots.length ? Math.max(...slots.map((s) => s.row)) + 1 : 0;
  return anchor + dir * (BELOW + PILL_H / 2 + rows * (PILL_H + ROW_GAP));
}

/** La pilule sous le point (x, y), avec une petite marge ; -1 sinon. */
export function hitPill(slots: Slot[], x: number, y: number, margin = 6): number {
  return slots.findIndex((s) => Math.abs(x - s.x) <= s.w / 2 + margin && Math.abs(y - s.y) <= PILL_H / 2 + margin);
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
