// Les formes de la famille « gomme » : goutte, Guimauve (carrée), Dragée
// (ovale), Berlingot (triangle), étoile, soleil, lune, nuage, cœur, fleur,
// champignon, fantôme et flamme.
//
// Une forme n'est qu'un CONTOUR : une liste de N points, dans l'ordre des
// aiguilles d'une montre en partant du haut, en unités de « rayon » (R) autour
// du centre de la mascotte, le bas posé à y = 0.94. Tous les contours ont le
// même nombre de points, rangés pareil : on peut donc passer d'une forme à une
// autre en faisant glisser chaque point vers son jumeau (le soleil qui devient
// lune au coucher, voir gum.ts).
//
// À côté du contour, chaque forme dit où mettre son visage, ses reflets, à
// quelle hauteur elle saute, si elle flotte (fantôme, soleil), et ses petits
// décors dessinés par-dessus (points du champignon, cratères de la lune…).
//
// Ce fichier ne dessine rien : il ne fait que des calculs (testés dans
// tests/front/gum.test.ts).

const TAU = Math.PI * 2;

/** Le nombre de points de chaque contour. */
export const N = 96;

export interface Pt {
  x: number;
  y: number;
}

export type ShapeId =
  | "goutte"
  | "guimauve"
  | "dragee"
  | "berlingot"
  | "etoile"
  | "soleil"
  | "lune"
  | "nuage"
  | "coeur"
  | "fleur"
  | "champignon"
  | "fantome"
  | "flamme";

/** Les petits décors propres à une forme, dessinés par gum-draw.ts. */
export type ShapeDecor = "none" | "rays" | "craters" | "spots" | "petals" | "inner-flame" | "cloud-puffs";

export interface GumShape {
  id: ShapeId;
  /** Le contour (N points). */
  pts: Pt[];
  /** Le visage : hauteur des yeux, écart des yeux, bouche sous les yeux, joues. */
  eyeY: number;
  eyeDX: number;
  mouthDY: number;
  cheekDX: number;
  /** Décalage de tout le visage sur le côté (la lune a son visage dans sa partie épaisse). */
  faceX: number;
  /** Taille des yeux (1 = celle de la goutte). */
  eyeScale: number;
  /** Le grand reflet : x, y, inclinaison, longueur ; et le petit point brillant. */
  shine: [number, number, number, number];
  dot: [number, number];
  /** Hauteur des sauts (1 = goutte ; la Guimauve, lourde, saute moins haut). */
  hop: number;
  /** Elle flotte au-dessus du sol (en R) : fantôme, soleil, lune. */
  float: number;
  /** Opacité du corps (le fantôme est un peu transparent). */
  alpha: number;
  decor: ShapeDecor;
  /** La couleur par défaut de la forme (clé de TINTS, gum-draw.ts). */
  tint: string;
}

// ── Petits outils de géométrie ──────────────────────────────────────────────

/** Points d'une courbe de Bézier cubique (sans le dernier point). */
function cubic(out: Pt[], p0: number[], p1: number[], p2: number[], p3: number[], n: number) {
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      y: u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    });
  }
}

/** Répartit `n` points à égale distance le long d'un contour fermé. */
export function resample(pts: Pt[], n = N): Pt[] {
  const m = pts.length;
  const L = [0];
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    L.push(L[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = L[m];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (L[j + 1] < s) j++;
    const t = (s - L[j]) / (L[j + 1] - L[j] || 1);
    const a = pts[j];
    const b = pts[(j + 1) % m];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Adoucit les angles trop vifs (chaque point se rapproche de ses voisins). */
function smooth(pts: Pt[], passes: number, k = 0.5): Pt[] {
  let p = pts;
  for (let s = 0; s < passes; s++) {
    p = p.map((q, i) => {
      const a = p[(i + p.length - 1) % p.length];
      const b = p[(i + 1) % p.length];
      return { x: q.x + ((a.x + b.x) / 2 - q.x) * k, y: q.y + ((a.y + b.y) / 2 - q.y) * k };
    });
  }
  return p;
}

/** Aire signée : positive quand le contour tourne dans le sens des aiguilles d'une montre (y vers le bas). */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Met un contour « en règle » : N points réguliers, sens des aiguilles d'une
 * montre, premier point en haut au milieu, bas posé à y = 0.94.
 */
export function normalize(raw: Pt[]): Pt[] {
  let pts = resample(raw, N * 4);
  if (signedArea(pts) < 0) pts = pts.reverse();
  // Le point le plus haut près du milieu (la pointe de la goutte, le haut de l'étoile).
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const b = pts[best];
    if (p.y - Math.abs(p.x) * 0.25 < b.y - Math.abs(b.x) * 0.25) best = i;
  }
  pts = [...pts.slice(best), ...pts.slice(0, best)];
  pts = resample(pts, N);
  const maxY = Math.max(...pts.map((p) => p.y));
  return pts.map((p) => ({ x: p.x, y: p.y + (0.94 - maxY) }));
}

/** Un polygone aux coins arrondis (rayon par coin), coins rentrants compris. */
function roundedPoly(V: number[][], radii: number[], segs = 14): Pt[] {
  const out: Pt[] = [];
  const n = V.length;
  for (let i = 0; i < n; i++) {
    const v = V[i];
    const p = V[(i + n - 1) % n];
    const q = V[(i + 1) % n];
    const n1 = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const n2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const u1 = [(p[0] - v[0]) / n1, (p[1] - v[1]) / n1];
    const u2 = [(q[0] - v[0]) / n2, (q[1] - v[1]) / n2];
    const half = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2;
    const r = radii[i % radii.length];
    const bl = Math.hypot(u1[0] + u2[0], u1[1] + u2[1]) || 1;
    const bis = [(u1[0] + u2[0]) / bl, (u1[1] + u2[1]) / bl];
    const C = [v[0] + (bis[0] * r) / Math.sin(half), v[1] + (bis[1] * r) / Math.sin(half)];
    const d = r / Math.tan(half);
    const T1 = [v[0] + u1[0] * d, v[1] + u1[1] * d];
    const T2 = [v[0] + u2[0] * d, v[1] + u2[1] * d];
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let da = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    for (let k = 0; k <= segs; k++) {
      const a = a1 + (da * k) / segs;
      out.push({ x: C[0] + Math.cos(a) * r, y: C[1] + Math.sin(a) * r });
    }
  }
  return out;
}

/** Bombe un peu les côtés d'un contour (un bonbon, pas un panneau). */
function inflate(pts: Pt[], c: Pt, k: number): Pt[] {
  const rm = pts.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0) / pts.length;
  return pts.map((p) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
    const f = 1 + (rm / d - 1) * k;
    return { x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f };
  });
}

/** Un contour décrit par son rayon selon l'angle, autour de `c`. */
function polar(c: Pt, r: (a: number) => number, n = 360): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const d = r(a);
    out.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d });
  }
  return out;
}

/** Une « superellipse » : de l'ovale (n = 2) au carré aux coins ronds (n ≈ 4,5). */
function superPts(a: number, top: number, bottom: number, n: number, flare: number): Pt[] {
  const out: Pt[] = [];
  const cy = (top + bottom) / 2;
  const b = (bottom - top) / 2;
  for (let i = 0; i < 360; i++) {
    const th = -Math.PI / 2 + (i / 360) * TAU;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * a;
    const y = cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * b;
    out.push({ x: x * (1 + flare * (y - cy)), y });
  }
  return out;
}

// ── Les contours ────────────────────────────────────────────────────────────

/** La goutte gomme d'origine (mêmes courbes que l'ancien dessin). */
function dropRaw(): Pt[] {
  const o: Pt[] = [];
  cubic(o, [0.05, -0.98], [0.6, -0.82], [1.1, -0.34], [1.1, 0.2], 24);
  cubic(o, [1.1, 0.2], [1.1, 0.76], [0.64, 0.94], [0, 0.94], 24);
  cubic(o, [0, 0.94], [-0.64, 0.94], [-1.1, 0.76], [-1.1, 0.2], 24);
  cubic(o, [-1.1, 0.2], [-1.1, -0.34], [-0.56, -0.8], [-0.05, -0.98], 24);
  o.push({ x: 0, y: -1.02 });
  return o;
}

function triangleRaw(): Pt[] {
  const pts = resample(roundedPoly([[0, -1.12], [1.14, 0.94], [-1.14, 0.94]], [0.34, 0.32, 0.32], 16), N * 2);
  return inflate(pts, { x: 0, y: 0.25 }, 0.17);
}

function starRaw(): Pt[] {
  const V: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.54 : 1.2;
    V.push([Math.cos(a) * r, 0.08 + Math.sin(a) * r]);
  }
  // Des pointes arrondies mais bien lisibles, des creux à peine adoucis.
  const pts = resample(roundedPoly(V, [0.16, 0.08], 10), N * 2);
  return inflate(pts, { x: 0, y: 0.08 }, 0.05);
}

function crescentRaw(): Pt[] {
  // Un grand disque moins un petit disque décalé : la lune ☾, ouverte à droite.
  const R1 = 1.05;
  const c2 = { x: 0.62, y: -0.3 };
  const R2 = 0.8;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * TAU;
    const p = { x: Math.cos(a) * R1, y: Math.sin(a) * R1 };
    if (Math.hypot(p.x - c2.x, p.y - c2.y) > R2) outer.push(p);
    const q = { x: c2.x + Math.cos(a) * R2, y: c2.y + Math.sin(a) * R2 };
    if (Math.hypot(q.x, q.y) < R1) inner.push(q);
  }
  // On remet les arcs bout à bout : on coupe chaque arc là où il saute.
  const chain = (arc: Pt[]) => {
    let cut = 0;
    let gap = 0;
    for (let i = 0; i < arc.length; i++) {
      const a = arc[i];
      const b = arc[(i + 1) % arc.length];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > gap) {
        gap = d;
        cut = i + 1;
      }
    }
    return [...arc.slice(cut), ...arc.slice(0, cut)];
  };
  const o = chain(outer);
  const inn = chain(inner).reverse();
  // Le grand arc va d'une pointe à l'autre ; l'arc intérieur revient en sens inverse.
  const first = o[0];
  const startInner = Math.hypot(inn[0].x - o[o.length - 1].x, inn[0].y - o[o.length - 1].y) < Math.hypot(inn[inn.length - 1].x - o[o.length - 1].x, inn[inn.length - 1].y - o[o.length - 1].y);
  const back = startInner ? inn : inn.reverse();
  void first;
  // Pointes adoucies (une lune en gomme ne pique pas).
  return smooth(resample([...o, ...back], N * 2), 6, 0.5);
}

function cloudRaw(): Pt[] {
  const blobs = [
    { x: -0.7, y: 0.42, r: 0.46 },
    { x: -0.26, y: 0.02, r: 0.58 },
    { x: 0.34, y: -0.08, r: 0.64 },
    { x: 0.8, y: 0.4, r: 0.44 },
    { x: 0, y: 0.5, r: 0.6 },
  ];
  const c = { x: 0, y: 0.4 };
  const pts = polar(c, (a) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 0.3;
    for (const b of blobs) {
      // Où le rayon parti de c sort du cercle b (la racine la plus loin).
      const ox = c.x - b.x;
      const oy = c.y - b.y;
      const bb = ox * dx + oy * dy;
      const disc = bb * bb - (ox * ox + oy * oy - b.r * b.r);
      if (disc >= 0) best = Math.max(best, -bb + Math.sqrt(disc));
    }
    return best;
  });
  // Un dessous presque plat, pour qu'il se pose.
  return smooth(
    pts.map((p) => ({ x: p.x, y: Math.min(p.y, 0.86) })),
    4,
    0.5,
  );
}

function heartRaw(): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push({ x: (x / 16) * 1.08, y: (-y / 16) * 1.08 });
  }
  return smooth(resample(out, N * 2), 3, 0.5);
}

function flowerRaw(): Pt[] {
  // Cinq pétales bien ronds : le rayon suit |cos| (des bosses rondes séparées
  // par de petits creux), un pétale pile en haut.
  return smooth(polar({ x: 0, y: 0.06 }, (a) => 0.66 + 0.36 * Math.pow(Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), 0.6)), 2, 0.4);
}

function mushroomRaw(): Pt[] {
  const o: Pt[] = [];
  // Le chapeau, du haut vers la droite.
  for (let i = 0; i <= 40; i++) {
    const f = Math.PI / 2 - (i / 40) * (Math.PI / 2);
    o.push({ x: Math.cos(f) * 1.14, y: 0.2 - Math.sin(f) * 1.12 });
  }
  // Le bord du chapeau qui se replie sous lui, puis le pied.
  cubic(o, [1.14, 0.2], [1.14, 0.36], [0.7, 0.36], [0.5, 0.34], 10);
  cubic(o, [0.5, 0.34], [0.52, 0.6], [0.58, 0.94], [0.3, 0.94], 12);
  cubic(o, [0.3, 0.94], [0.1, 0.95], [-0.1, 0.95], [-0.3, 0.94], 8);
  cubic(o, [-0.3, 0.94], [-0.58, 0.94], [-0.52, 0.6], [-0.5, 0.34], 12);
  cubic(o, [-0.5, 0.34], [-0.7, 0.36], [-1.14, 0.36], [-1.14, 0.2], 10);
  for (let i = 0; i <= 40; i++) {
    const f = Math.PI - (i / 40) * (Math.PI / 2);
    o.push({ x: Math.cos(f) * 1.14, y: 0.2 - Math.sin(f) * 1.12 });
  }
  return smooth(resample(o, N * 2), 2, 0.4);
}

function ghostRaw(): Pt[] {
  const o: Pt[] = [];
  // Le haut en dôme…
  for (let i = 0; i <= 60; i++) {
    const a = Math.PI + (i / 60) * Math.PI;
    o.push({ x: Math.cos(a) * 0.92, y: -0.06 + Math.sin(a) * 0.96 });
  }
  // …les côtés qui descendent, et le bas en trois vaguelettes.
  o.push({ x: 0.94, y: 0.4 });
  for (let i = 0; i <= 60; i++) {
    const x = 0.94 - (i / 60) * 1.88;
    o.push({ x, y: 0.82 + Math.cos((i / 60) * Math.PI * 3) * 0.1 });
  }
  o.push({ x: -0.94, y: 0.4 });
  return smooth(resample(o, N * 2), 3, 0.45);
}

function flameRaw(): Pt[] {
  // Une goutte à l'envers, plus fine, avec une pointe qui part un peu de côté.
  const o: Pt[] = [];
  cubic(o, [0.12, -1.22], [0.5, -0.7], [1.0, -0.3], [0.96, 0.3], 24);
  cubic(o, [0.96, 0.3], [0.94, 0.78], [0.56, 0.94], [0, 0.94], 24);
  cubic(o, [0, 0.94], [-0.56, 0.94], [-0.96, 0.78], [-0.96, 0.3], 24);
  cubic(o, [-0.96, 0.3], [-0.96, -0.2], [-0.4, -0.52], [0.12, -1.22], 24);
  return smooth(o, 2, 0.4);
}

function circleRaw(r: number, cy: number): Pt[] {
  return polar({ x: 0, y: cy }, () => r);
}

// ── Le catalogue des formes ─────────────────────────────────────────────────

type ShapeSpec = Omit<GumShape, "pts" | "faceX" | "eyeScale" | "float" | "alpha" | "decor"> &
  Partial<Pick<GumShape, "faceX" | "eyeScale" | "float" | "alpha" | "decor">> & { raw: () => Pt[] };

const SPECS: ShapeSpec[] = [
  { id: "goutte", raw: dropRaw, eyeY: 0.12, eyeDX: 0.38, mouthDY: 0.3, cheekDX: 0.62, shine: [-0.48, -0.36, -0.75, 1], dot: [-0.12, -0.66], hop: 1, tint: "blue" },
  { id: "guimauve", raw: () => superPts(1.0, -0.86, 0.94, 4.6, 0.05), eyeY: 0.04, eyeDX: 0.42, mouthDY: 0.3, cheekDX: 0.66, shine: [-0.55, -0.5, -0.45, 1.05], dot: [-0.16, -0.66], hop: 0.6, tint: "mint" },
  { id: "dragee", raw: () => superPts(0.84, -1.08, 0.94, 2, 0.1), eyeY: 0, eyeDX: 0.33, mouthDY: 0.3, cheekDX: 0.56, shine: [-0.4, -0.58, -0.95, 0.95], dot: [-0.06, -0.86], hop: 1.35, tint: "pink" },
  { id: "berlingot", raw: triangleRaw, eyeY: 0.36, eyeDX: 0.33, mouthDY: 0.27, cheekDX: 0.56, shine: [-0.4, 0.02, -1.08, 0.9], dot: [-0.06, -0.6], hop: 1, tint: "violet" },
  { id: "etoile", raw: starRaw, eyeY: 0.12, eyeDX: 0.3, mouthDY: 0.26, cheekDX: 0.48, eyeScale: 0.9, shine: [-0.3, -0.42, -0.9, 0.7], dot: [0.02, -0.7], hop: 1.15, tint: "gold" },
  { id: "soleil", raw: () => circleRaw(0.78, 0.16), eyeY: 0.1, eyeDX: 0.32, mouthDY: 0.28, cheekDX: 0.52, shine: [-0.36, -0.3, -0.8, 0.85], dot: [-0.08, -0.46], hop: 0.9, float: 0.32, decor: "rays", tint: "sun" },
  { id: "lune", raw: crescentRaw, eyeY: 0.08, eyeDX: 0.2, mouthDY: 0.25, cheekDX: 0.34, faceX: -0.52, eyeScale: 0.8, shine: [-0.6, -0.42, -1.1, 0.75], dot: [-0.34, -0.82], hop: 0.8, float: 0.12, decor: "craters", tint: "moon" },
  { id: "nuage", raw: cloudRaw, eyeY: 0.3, eyeDX: 0.36, mouthDY: 0.27, cheekDX: 0.6, shine: [-0.3, -0.24, -0.5, 0.9], dot: [0.3, -0.42], hop: 0.8, float: 0.06, decor: "cloud-puffs", tint: "cloud" },
  { id: "coeur", raw: heartRaw, eyeY: -0.05, eyeDX: 0.36, mouthDY: 0.28, cheekDX: 0.58, shine: [-0.55, -0.48, -0.7, 0.8], dot: [-0.3, -0.66], hop: 1, tint: "red" },
  { id: "fleur", raw: flowerRaw, eyeY: 0.0, eyeDX: 0.28, mouthDY: 0.26, cheekDX: 0.46, eyeScale: 0.92, shine: [-0.5, -0.56, -0.8, 0.7], dot: [-0.2, -0.8], hop: 1, decor: "petals", tint: "lilac" },
  { id: "champignon", raw: mushroomRaw, eyeY: -0.22, eyeDX: 0.38, mouthDY: 0.27, cheekDX: 0.64, shine: [-0.58, -0.56, -0.6, 0.9], dot: [-0.2, -0.78], hop: 0.9, decor: "spots", tint: "red" },
  { id: "fantome", raw: ghostRaw, eyeY: 0.0, eyeDX: 0.34, mouthDY: 0.3, cheekDX: 0.58, shine: [-0.46, -0.56, -0.8, 0.85], dot: [-0.12, -0.84], hop: 0.6, float: 0.22, alpha: 0.88, tint: "ghost" },
  { id: "flamme", raw: flameRaw, eyeY: 0.3, eyeDX: 0.32, mouthDY: 0.26, cheekDX: 0.54, shine: [-0.42, -0.1, -1.1, 0.85], dot: [-0.04, -0.4], hop: 1.1, decor: "inner-flame", tint: "orange" },
];

export const SHAPES: Record<ShapeId, GumShape> = Object.fromEntries(
  SPECS.map(({ raw, ...s }) => [
    s.id,
    { faceX: 0, eyeScale: 1, float: 0, alpha: 1, decor: "none", ...s, pts: normalize(raw()) } as GumShape,
  ]),
) as Record<ShapeId, GumShape>;

export const SHAPE_IDS = SPECS.map((s) => s.id);

export function isShape(id: unknown): id is ShapeId {
  return typeof id === "string" && id in SHAPES;
}

// ── Ce qu'on recalcule à chaque image ───────────────────────────────────────

/** Les normales extérieures d'un contour (perpendiculaires à la tangente). */
export function normals(pts: Pt[]): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return { x: ty / l, y: -tx / l };
  });
}

/** Le haut du contour au-dessus de x (pour poser un chapeau) : y le plus petit près de x. */
export function topAt(pts: Pt[], x: number, band = 0.18): Pt {
  let best: Pt | null = null;
  for (const p of pts) if (Math.abs(p.x - x) < band && (!best || p.y < best.y)) best = p;
  return best ?? pts[0];
}

/** La demi-largeur du contour à la hauteur y (pour un collier, des mains au repos). */
export function halfWidthAt(pts: Pt[], y: number, band = 0.1): number {
  let w = 0;
  for (const p of pts) if (Math.abs(p.y - y) < band) w = Math.max(w, Math.abs(p.x));
  return w || 0.6;
}

/** Les points d'une forme qui gonflent quand elle boude (les joues). */
export function puffWeights(pts: Pt[], s: GumShape): number[] {
  const F = s.eyeY + 0.28;
  return pts.map((p) => Math.exp(-((p.y - F) ** 2) / 0.05) * Math.min(1, Math.max(0, (Math.abs(p.x - s.faceX) - 0.35) / 0.4)));
}

/** Mélange deux contours (même nombre de points, même ordre) : 0 = a, 1 = b. */
export function mixPts(a: Pt[], b: Pt[], k: number): Pt[] {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
}
