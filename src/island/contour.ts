// Le contour de l'île, en points : de quoi la creuser, la bosseler et y faire
// courir une onde (voir jelly.ts pour le dessin à l'écran).
//
// L'idée : la forme de l'île au repos est un rectangle aux coins arrondis
// (certains coins à 0 : ceux qui touchent le bord de l'écran). On le parcourt
// en petits points réguliers ; chaque point peut être poussé le long de sa
// normale (vers l'extérieur ou l'intérieur). On relie ensuite les points en
// un chemin SVG (« M x y L x y … Z ») que le CSS sait utiliser comme découpe :
// `clip-path: path("…")`.
//
// Deux échelles de points :
//   - la CHAÎNE (EdgeChain) : peu de points (96), chacun un petit ressort
//     relié à ses deux voisins. Un appui en enfonce quelques-uns ; en
//     revenant, ils tirent sur leurs voisins, qui tirent sur les leurs… :
//     une onde fait le tour de l'île. C'est l'équation des cordes vibrantes,
//     calculée pas à pas ;
//   - le TRACÉ (sampleContour) : beaucoup de points (un tous les 5 px
//     environ, et toujours les coins exacts) pour que le chemin reste lisse ;
//     chaque point du tracé prend le déplacement de la chaîne à sa place
//     (interpolé entre les deux points de chaîne voisins).
//
// Les positions le long du contour sont des fractions du tour, `u` de 0 à 1
// (0 = début du côté du haut, après le coin haut-gauche, puis dans le sens des
// aiguilles d'une montre). Elles ne dépendent pas de la taille : quand l'île
// grandit pendant une onde, l'onde reste au même endroit relatif.
//
// Ce fichier ne touche pas à la page : testé tel quel par Node.

/** Les quatre arrondis (px) : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export interface Radii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

/** La forme au repos : largeur, hauteur, arrondis. */
export interface Rect {
  w: number;
  h: number;
  r: Radii;
}

/** Un point du contour : position, normale vers l'extérieur, fraction du tour. */
export interface ContourPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  u: number;
}

/** Les arrondis ramenés à ce qui tient dans la forme (comme le fait le CSS). */
export function clampRadii(rect: Rect): Radii {
  const { w, h, r } = rect;
  const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  let { tl, tr, br, bl } = { tl: pos(r.tl), tr: pos(r.tr), br: pos(r.br), bl: pos(r.bl) };
  // Règle du CSS : si deux arrondis d'un même côté dépassent sa longueur, on
  // les réduit tous dans la même proportion.
  const f = Math.min(1, w / (tl + tr || 1), w / (bl + br || 1), h / (tl + bl || 1), h / (tr + br || 1));
  if (f < 1) {
    tl *= f;
    tr *= f;
    br *= f;
    bl *= f;
  }
  return { tl, tr, br, bl };
}

/** Un morceau du contour : un côté droit ou un quart de cercle. */
type Segment =
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number; nx: number; ny: number; len: number }
  | { kind: "arc"; cx: number; cy: number; r: number; a0: number; len: number };

/** Les 8 morceaux du contour, dans l'ordre (sens des aiguilles d'une montre). */
function segments(rect: Rect): Segment[] {
  const { w, h } = rect;
  const { tl, tr, br, bl } = clampRadii(rect);
  const line = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): Segment => ({
    kind: "line",
    x0,
    y0,
    x1,
    y1,
    nx,
    ny,
    len: Math.hypot(x1 - x0, y1 - y0),
  });
  // Quart de cercle de centre (cx, cy), de l'angle a0 à a0 + 90° (y vers le bas).
  const arc = (cx: number, cy: number, r: number, a0: number): Segment => ({ kind: "arc", cx, cy, r, a0, len: (Math.PI / 2) * r });
  return [
    line(tl, 0, w - tr, 0, 0, -1),
    arc(w - tr, tr, tr, -Math.PI / 2),
    line(w, tr, w, h - br, 1, 0),
    arc(w - br, h - br, br, 0),
    line(w - br, h, bl, h, 0, 1),
    arc(bl, h - bl, bl, Math.PI / 2),
    line(0, h - bl, 0, tl, -1, 0),
    arc(tl, tl, tl, Math.PI),
  ];
}

/** Le point à `t` (0 à 1) d'un morceau. Un coin sans arrondi : sa normale est en diagonale. */
function pointOn(s: Segment, t: number): { x: number; y: number; nx: number; ny: number } {
  if (s.kind === "line") return { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t, nx: s.nx, ny: s.ny };
  const a = s.a0 + (Math.PI / 2) * t;
  // Coin vif (r = 0) : la normale du milieu de l'arc, en diagonale.
  const an = s.r > 0 ? a : s.a0 + Math.PI / 4;
  return { x: s.cx + s.r * Math.cos(a), y: s.cy + s.r * Math.sin(a), nx: Math.cos(an), ny: Math.sin(an) };
}

/** La longueur du tour (px). */
export function perimeter(rect: Rect): number {
  return segments(rect).reduce((sum, s) => sum + s.len, 0);
}

/**
 * Le contour en points, à peu près tous les `step` px. Les extrémités de
 * chaque morceau sont toujours dedans : un coin vif (collé au bord de
 * l'écran) reste vif, il n'est jamais « coupé » par un point qui tombe à côté.
 */
export function sampleContour(rect: Rect, step = 5): ContourPoint[] {
  const segs = segments(rect);
  const total = segs.reduce((sum, s) => sum + s.len, 0) || 1;
  const out: ContourPoint[] = [];
  let done = 0;
  for (const s of segs) {
    // Un coin vif (arrondi 0) n'a pas de longueur : son point est déjà le
    // début du côté suivant.
    if (s.len <= 0) continue;
    const n = Math.ceil(s.len / step);
    // On ne met pas le dernier point : c'est le premier du morceau suivant.
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const p = pointOn(s, t);
      out.push({ ...p, u: (done + s.len * t) / total });
    }
    done += s.len;
  }
  return out;
}

/** Le point du contour à la fraction `u` du tour. */
export function pointAt(rect: Rect, u: number): ContourPoint {
  const segs = segments(rect);
  const total = segs.reduce((sum, s) => sum + s.len, 0);
  const uu = ((u % 1) + 1) % 1;
  let left = uu * total;
  for (const s of segs) {
    if (left <= s.len && s.len > 0) return { ...pointOn(s, left / s.len), u: uu };
    left -= s.len;
  }
  return { ...pointOn(segs[0], 0), u: 0 };
}

/** La fraction du tour du point du contour le plus proche de (x, y). */
export function nearestU(rect: Rect, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const p of sampleContour(rect, 4)) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.u;
    }
  }
  return best;
}

/** L'écart le plus court entre deux fractions du tour (le tour boucle : 0,95 et 0,05 sont à 0,1). */
export function wrapDelta(a: number, b: number): number {
  let d = (a - b) % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

// ── La chaîne de ressorts ────────────────────────────────────────────────────

/** Les réglages de la chaîne : rappel (k), frottement (c), tension entre voisins. */
export interface ChainParams {
  k: number;
  c: number;
  tension: number;
}

/** La force qui maintient un creux tant que le bouton est enfoncé. */
const HOLD_STIFFNESS = 12000;
/** Le pas de calcul de la chaîne (s) : petit, car la tension la rend raide. */
const CHAIN_SUBSTEP = 1 / 300;

/**
 * Une boucle de `n` points, chacun déplacé de `d[i]` px le long de la normale
 * du contour (négatif = vers l'intérieur). Chaque point est rappelé vers 0 et
 * tiré par ses voisins : une déformation locale se propage en onde.
 */
export class EdgeChain {
  readonly n: number;
  readonly d: Float64Array;
  readonly v: Float64Array;
  /** 1 : point collé au bord de l'écran, il ne bouge jamais. */
  readonly pinned: Uint8Array;
  /** Un creux maintenu (appui en cours) : la cible de chaque point, et la force (0 à 1). */
  private holdTarget: Float64Array;
  private holdWeight: Float64Array;
  private holding = false;

  constructor(n = 96) {
    this.n = n;
    this.d = new Float64Array(n);
    this.v = new Float64Array(n);
    this.pinned = new Uint8Array(n);
    this.holdTarget = new Float64Array(n);
    this.holdWeight = new Float64Array(n);
  }

  /** La fraction du tour du point i. */
  uOf(i: number): number {
    return i / this.n;
  }

  /** Épingle les points pour lesquels `glued(u)` est vrai (bord de l'écran). */
  pin(glued: (u: number) => boolean) {
    for (let i = 0; i < this.n; i++) {
      this.pinned[i] = glued(this.uOf(i)) ? 1 : 0;
      if (this.pinned[i]) this.d[i] = this.v[i] = 0;
    }
  }

  /** Une cloche autour de `u` : 1 au centre, ~0 à 2,5 × `width` (fraction du tour). */
  private bell(i: number, u: number, width: number): number {
    const du = wrapDelta(this.uOf(i), u);
    return Math.exp(-((du / width) ** 2));
  }

  /** Enfonce le contour de `depth` px autour de `u`, et l'y maintient jusqu'à release(). */
  press(u: number, depth: number, width: number) {
    this.holding = true;
    for (let i = 0; i < this.n; i++) {
      const g = this.bell(i, u, width);
      this.holdTarget[i] = -depth * g;
      this.holdWeight[i] = g > 0.02 ? g : 0;
    }
  }

  /** On lâche : les points reviennent, et l'onde part. */
  release() {
    this.holding = false;
    this.holdWeight.fill(0);
  }

  /** Un choc : une vitesse vers l'intérieur (px/s) autour de `u`. */
  impulse(u: number, velocity: number, width: number) {
    for (let i = 0; i < this.n; i++) if (!this.pinned[i]) this.v[i] -= velocity * this.bell(i, u, width);
  }

  /** Avance la chaîne de `dt` secondes. */
  step(dt: number, p: ChainParams) {
    const total = Math.min(Math.max(dt, 0), 1 / 20);
    const steps = Math.max(1, Math.ceil(total / CHAIN_SUBSTEP));
    const h = total / steps;
    const { n, d, v, pinned } = this;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const left = d[(i + n - 1) % n];
        const right = d[(i + 1) % n];
        let a = -p.k * d[i] - p.c * v[i] + p.tension * (left + right - 2 * d[i]);
        if (this.holding && this.holdWeight[i]) a += HOLD_STIFFNESS * this.holdWeight[i] * (this.holdTarget[i] - d[i]) - 40 * this.holdWeight[i] * v[i];
        v[i] += a * h;
      }
      for (let i = 0; i < n; i++) if (!pinned[i]) d[i] += v[i] * h;
    }
  }

  /** Le déplacement à la fraction `u` (interpolé entre les deux points voisins). */
  at(u: number): number {
    const f = (((u % 1) + 1) % 1) * this.n;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const t = f - Math.floor(f);
    return this.d[i] * (1 - t) + this.d[j] * t;
  }

  /** La chaîne est-elle au repos ? (plus aucun point ne bouge à l'œil) */
  atRest(): boolean {
    if (this.holding) return false;
    for (let i = 0; i < this.n; i++) if (Math.abs(this.d[i]) > 0.15 || Math.abs(this.v[i]) > 3) return false;
    return true;
  }

  /** Le plus grand gonflement vers l'extérieur (px, 0 si aucun). */
  maxOut(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, this.d[i]);
    return m;
  }

  /** Tout remettre à plat. */
  reset() {
    this.d.fill(0);
    this.v.fill(0);
    this.release();
  }
}

// ── La bosse de l'étirement ──────────────────────────────────────────────────

/**
 * La bosse tirée à la souris sur le bord intérieur (gestures.ts), en
 * coordonnées de la forme au repos :
 *   - `along` : l'axe vers le centre de l'écran (le bord intérieur est de ce côté),
 *     { x: 0, y: 1 } pour une île en haut ;
 *   - `center` : où est la base de la bosse, le long du bord (px, sur l'axe
 *     perpendiculaire) ;
 *   - `depth` : sa hauteur (px, négatif = un creux quand on pousse) ;
 *   - `shift` : de combien son sommet penche sur le côté (px) ;
 *   - `width` : la demi-largeur de sa base (px).
 */
export interface Bump {
  along: { x: number; y: number };
  center: number;
  depth: number;
  shift: number;
  width: number;
}

/**
 * Le déplacement (dx, dy) d'un point du contour par la bosse. Seuls les
 * points tournés vers le bord intérieur bougent (le côté collé à l'écran
 * reste en place), avec une cloche autour de `center` : la base est large,
 * le sommet arrondi, comme de la guimauve qu'on étire.
 */
export function bumpOffset(p: { x: number; y: number; nx: number; ny: number }, b: Bump): { dx: number; dy: number } {
  const facing = p.nx * b.along.x + p.ny * b.along.y; // 1 : tourné vers l'intérieur
  if (facing <= 0.05 || (b.depth === 0 && b.shift === 0)) return { dx: 0, dy: 0 };
  // Lissé : les coins arrondis suivent à moitié, les côtés pas du tout.
  const w = Math.min(1, (facing - 0.05) / 0.75);
  const smooth = w * w * (3 - 2 * w);
  // Position du point le long du bord (l'axe perpendiculaire à `along`).
  const across = b.along.y !== 0 ? p.x : p.y;
  const g = Math.exp(-(((across - b.center) / Math.max(4, b.width)) ** 2)) * smooth;
  const ax = b.along.x;
  const ay = b.along.y;
  // L'axe perpendiculaire, toujours vers les x ou les y croissants.
  const cx = ay !== 0 ? 1 : 0;
  const cy = ay !== 0 ? 0 : 1;
  return { dx: (ax * b.depth + cx * b.shift) * g, dy: (ay * b.depth + cy * b.shift) * g };
}

// ── Le chemin ────────────────────────────────────────────────────────────────

/** Un nombre court pour le chemin (1 décimale, sans « -0 »). */
function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return String(r === 0 ? 0 : r);
}

/**
 * Le chemin SVG de la forme déformée, pour `clip-path: path("…")`.
 *   - `offset` : où se trouve la forme au repos dans la boîte de l'élément
 *     (la boîte peut être agrandie d'une marge pour laisser sortir la bosse) ;
 *   - `normal(u)` : le déplacement le long de la normale (la chaîne) ;
 *   - `bump` : la bosse, s'il y en a une.
 * Un déplacement vers l'extérieur de la chaîne est ignoré ici : la découpe ne
 * peut que retirer de la forme (jelly.ts rend les gonflements autrement).
 */
export function contourPath(
  points: readonly ContourPoint[],
  offset: { x: number; y: number },
  normal: (u: number) => number,
  bump: Bump | null,
): string {
  let out = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const d = Math.min(0, normal(p.u));
    let x = p.x + p.nx * d + offset.x;
    let y = p.y + p.ny * d + offset.y;
    if (bump) {
      const b = bumpOffset(p, bump);
      x += b.dx;
      y += b.dy;
    }
    out += `${i ? "L" : "M"}${num(x)} ${num(y)}`;
  }
  return out + "Z";
}
