// Ondine se déplace dans l'île : les calculs du chemin, sans DOM (testés par
// tests/front/scenes.test.ts).
//
// On raisonne sur le « pied » d'Ondine : le milieu du bas de sa case. Sa case
// (mascot-slot) ne quitte jamais sa place dans la grille de l'île ; on la
// décale avec `translate` (pied voulu − pied à la maison) et on la grandit ou
// l'écrase avec `scale`, attaché en bas (transform-origin: 50 % 100 %).
//
//   planHops   découpe un trajet en petits sauts de gomme
//   hopAt      où elle est, et comment elle est écrasée, à un instant d'un saut
//              (élan tassé, étirée en l'air, écrasée à l'atterrissage)
//   pickSpot   la place à côté d'un élément, hors de l'île jamais, et si
//              possible sans cacher de texte (sinon elle reste derrière)

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Un saut : d'un pied à l'autre, avec sa hauteur (px). */
export interface Hop {
  from: Pt;
  to: Pt;
  height: number;
}

/** Ce qu'il faut dessiner à un instant : le pied et l'écrasement (sx, sy, 1 = rien). */
export interface HopFrame {
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Les pieds touchent le sol (élan ou atterrissage). */
  ground: boolean;
}

/** Longueur d'un pas (px, à la taille normale) : au-delà, un saut de plus. */
export const STRIDE = 46;
/** Durée d'un saut (ms) : élan + vol + atterrissage. */
export const HOP_MS = 340;
/** Les trois temps d'un saut, en fraction de sa durée. */
export const CROUCH_END = 0.18;
export const LAND_START = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Douce au départ et à l'arrivée (le vol). */
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * Les sauts d'un trajet : autant de pas qu'il faut pour que chacun fasse au
 * plus `stride` px (un peu plus pour un long trajet : elle prend de l'élan),
 * tous de même longueur. Un trajet de moins d'1 px : aucun saut.
 * `size` (1 = normale) agrandit les pas et la hauteur.
 */
export function planHops(from: Pt, to: Pt, size = 1, stride = STRIDE): Hop[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return [];
  const step = Math.max(8, (stride + dist * 0.07) * size);
  const n = Math.max(1, Math.ceil(dist / step));
  const hops: Hop[] = [];
  for (let i = 0; i < n; i++) {
    const a = { x: from.x + (dx * i) / n, y: from.y + (dy * i) / n };
    const b = { x: from.x + (dx * (i + 1)) / n, y: from.y + (dy * (i + 1)) / n };
    const len = dist / n;
    // Un saut vers le haut monte un peu plus (il faut passer par-dessus).
    const up = Math.max(0, a.y - b.y);
    hops.push({ from: a, to: b, height: clamp(8 + len * 0.22 + up * 0.5, 8, 26) * size });
  }
  return hops;
}

/**
 * Un saut à l'instant `k` (0 à 1) :
 *   - élan (0 → CROUCH_END) : elle se tasse sur place (plus large, plus basse) ;
 *   - vol : elle file en arc, étirée au décollage, ronde au sommet ;
 *   - atterrissage (LAND_START → 1) : écrasée puis un petit rebond (gomme).
 * Le volume reste à peu près le même (sx × sy ≈ 1).
 */
export function hopAt(hop: Hop, k: number): HopFrame {
  const t = clamp(k, 0, 1);
  if (t < CROUCH_END) {
    const c = Math.sin((t / CROUCH_END) * (Math.PI / 2));
    const sy = 1 - 0.16 * c;
    return { x: hop.from.x, y: hop.from.y, sx: 1 / Math.sqrt(sy), sy, ground: true };
  }
  if (t < LAND_START) {
    const u = (t - CROUCH_END) / (LAND_START - CROUCH_END);
    const e = easeInOut(u);
    const x = lerp(hop.from.x, hop.to.x, e);
    const y = lerp(hop.from.y, hop.to.y, e) - 4 * hop.height * u * (1 - u);
    // Étirée en partant, ronde au sommet, un peu étirée en retombant.
    const stretch = u < 0.5 ? 0.14 * (1 - u * 2) : 0.06 * (u * 2 - 1);
    const sy = 1 + stretch;
    return { x, y, sx: 1 / Math.sqrt(sy), sy, ground: false };
  }
  const v = (t - LAND_START) / (1 - LAND_START);
  // Écrasée d'un coup, puis elle remonte en dépassant un peu (amorti).
  const sy = 1 - 0.22 * Math.exp(-4 * v) * Math.cos(v * Math.PI * 1.6);
  return { x: hop.to.x, y: hop.to.y, sx: 1 / Math.sqrt(sy), sy, ground: true };
}

/** La durée d'un saut selon sa longueur (ms) : les grands sauts durent un peu plus. */
export function hopMs(hop: Hop, size = 1): number {
  const len = Math.hypot(hop.to.x - hop.from.x, hop.to.y - hop.from.y);
  return Math.round(HOP_MS * clamp(0.8 + len / (STRIDE * size * 3), 0.8, 1.2));
}

// ── Les rectangles ──────────────────────────────────────────────────────────

export function intersects(a: Rect, b: Rect, margin = 0): boolean {
  return a.left < b.left + b.width + margin && b.left < a.left + a.width + margin && a.top < b.top + b.height + margin && b.top < a.top + a.height + margin;
}

/** `inner` est-il entièrement dans `outer` ? */
export function inside(inner: Rect, outer: Rect): boolean {
  return inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5 && inner.left + inner.width <= outer.left + outer.width + 0.5 && inner.top + inner.height <= outer.top + outer.height + 0.5;
}

/** Sa boîte (w × h) quand son pied est en `foot`. */
export function boxAt(foot: Pt, w: number, h: number): Rect {
  return { left: foot.x - w / 2, top: foot.y - h, width: w, height: h };
}

/** Le pied le plus proche de `foot` qui garde sa boîte dans `bounds`. */
export function clampFoot(foot: Pt, w: number, h: number, bounds: Rect): Pt {
  const minX = bounds.left + w / 2;
  const maxX = bounds.left + bounds.width - w / 2;
  const minY = bounds.top + h;
  const maxY = bounds.top + bounds.height;
  return {
    x: minX > maxX ? bounds.left + bounds.width / 2 : clamp(foot.x, minX, maxX),
    y: minY > maxY ? maxY : clamp(foot.y, minY, maxY),
  };
}

/** Où se mettre par rapport à l'élément. */
export type SpotMode = "beside" | "left" | "right" | "on" | "under";

export interface Spot {
  foot: Pt;
  /** Rien à lire sous elle : elle peut passer devant le contenu. */
  front: boolean;
}

/**
 * La place d'Ondine (boîte w × h) près de `target`, dans `bounds` (l'île,
 * marges comprises). On essaie les places dans l'ordre du `mode` et on garde
 * la première qui ne cache aucun texte de `texts` (les textes de la cible
 * elle-même comptent aussi, sauf en mode « on » où elle agit dessus). Si
 * aucune ne convient, la première place, mais derrière le contenu (front: false).
 * `near` : son pied actuel, pour choisir le côté le plus proche en « beside ».
 */
export function pickSpot(target: Rect, w: number, h: number, bounds: Rect, texts: Rect[], mode: SpotMode = "beside", near?: Pt): Spot {
  const gap = 4;
  const cy = target.top + target.height / 2;
  const left = { x: target.left - gap - w / 2, y: Math.min(target.top + target.height, cy + h / 2) };
  const right = { x: target.left + target.width + gap + w / 2, y: Math.min(target.top + target.height, cy + h / 2) };
  const on = { x: target.left + target.width / 2, y: target.top + Math.min(6, target.height / 3) };
  const under = { x: target.left + target.width / 2, y: target.top + target.height + gap + h };
  // Assise sur le bord droit (ou gauche) de l'élément, à mi-hauteur : sur l'anneau d'un minuteur.
  const edgeRight = { x: target.left + target.width - w * 0.25, y: cy + h * 0.35 };
  const edgeLeft = { x: target.left + w * 0.25, y: cy + h * 0.35 };
  const nearLeft = near ? Math.abs(near.x - left.x) <= Math.abs(near.x - right.x) : true;
  const orders: Record<SpotMode, Pt[]> = {
    beside: nearLeft ? [left, right, on, under] : [right, left, on, under],
    left: [left, right, on, under],
    right: [right, left, on, under],
    on: [on, edgeRight, edgeLeft, left, right, under],
    under: [under, left, right, on],
  };
  const candidates = orders[mode].map((p) => clampFoot(p, w, h, bounds));
  for (const [i, foot] of candidates.entries()) {
    const box = boxAt(foot, w, h);
    const actingOn = mode === "on" && i < 3;
    const blocked = texts.some((t) => intersects(box, t, 1) && !(actingOn && inside(t, target)));
    if (!blocked) return { foot, front: true };
  }
  return { foot: candidates[0], front: false };
}

/**
 * Le chemin d'une traversée (bord à bord) le long du bas de l'île : un pied
 * tous les `step` px, de gauche à droite (ou l'inverse).
 */
export function crossing(bounds: Rect, w: number, ltr = true, step = STRIDE): Pt[] {
  const y = bounds.top + bounds.height;
  const a = bounds.left + w / 2;
  const b = bounds.left + bounds.width - w / 2;
  if (b <= a) return [{ x: (a + b) / 2, y }];
  const n = Math.max(1, Math.round((b - a) / step));
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: a + ((b - a) * i) / n, y }));
  return ltr ? pts : pts.reverse();
}

/** Le pied le long du bas de l'île pour une progression (0 à 1). */
export function progressFoot(bounds: Rect, w: number, fraction: number): Pt {
  const f = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  return { x: bounds.left + w / 2 + (bounds.width - w) * f, y: bounds.top + bounds.height };
}
