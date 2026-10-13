// L'éclosion de l'île : le calcul pur (minutage, forme de l'île, trajet des
// paillettes, remplissage des anneaux). Le dessin est dans hatch.ts.
// Testé par tests/front/hatch.test.ts.
//
// Le déroulé (secondes, à vitesse réelle) :
//   0     une goutte sort du haut de l'écran, pend, puis s'étire en île (0,7) ;
//   1,2   l'île éclate en paillettes, qui flottent autour d'elle ;
//   1,9   Ondine sort de l'éclat, fait coucou et écrit bonjour ;
//   3,35  elle ouvre grand la bouche et aspire les paillettes en spirale, gonfle ;
//   5,0   elle les souffle une à une dans trois anneaux, qui se remplissent ;
//   6,3   tout est plein : elle fait la fête ;
//   6,8   repli en goutte : l'île s'affine en s'allongeant, puis se rétracte en
//         mini-île ; Ondine y glisse en tournant sur elle-même ;
//   7,35  elle se pose : la mini-île fait boing et respire deux fois ;
//   7,75  deux lumières partent des coins du haut, longent l'île et se
//         rejoignent en bas, dans une étincelle ;
//   9,2   fin (la vraie île prend le relais en fondu).

export const T = {
  /** La goutte commence à s'étirer en île. */
  open: 0.7,
  burst: 1.2,
  ondine: 1.9,
  hello: 2.3,
  mouth: 3.35,
  /** La dernière paillette est avalée. */
  suckEnd: 4.5,
  /** Le premier anneau commence à se remplir. */
  blow: 5.0,
  joy: 6.3,
  fold: 6.8,
} as const;

/** L'île s'affine en s'allongeant avant de se rétracter (repli en goutte). */
export const FOLD_STRETCH = 0.3;
export const FOLD_START = T.fold + FOLD_STRETCH;
/** Ondine se pose dans la mini-île. */
export const LAND = FOLD_START + 0.25;
/** Les deux lumières partent. */
export const HALO = LAND + 0.4;
export const HALO_LEN = 1.15;
/** Fin de l'animation (la vraie île prend le relais). */
export const END = HALO + HALO_LEN + 0.3;
/** Durée d'une paillette aspirée, puis soufflée. */
export const SUCK = 0.65;
export const BLOW = 0.45;

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const smooth = (u: number) => {
  u = clamp(u);
  return u * u * (3 - 2 * u);
};
/** L'inverse de `smooth` (pour planifier un atterrissage sur la courbe d'un anneau). */
export const invSmooth = (x: number) => 0.5 - Math.sin(Math.asin(clamp(1 - 2 * x, -1, 1)) / 3);
/** Ressort de gelée : dépasse un peu et revient se poser (0 avant t = 0). */
export const spr = (t: number, k = 7, f = 11) => (t <= 0 ? 0 : 1 - Math.exp(-k * t) * Math.cos(f * t));

/** Un tirage au hasard reproductible (le même éclat à chaque fois). */
export function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** La géométrie de la fenêtre de l'île (px CSS) : île collée au haut de l'écran. */
export interface Geometry {
  /** Largeur de la fenêtre. */
  width: number;
  height: number;
  /** Centre de l'île (axe horizontal). */
  cx: number;
  openW: number;
  openH: number;
  /** La mini-île d'arrivée. */
  miniW: number;
  miniH: number;
}

export function geometry(width: number, height: number, miniW = 340, miniH = 42): Geometry {
  return { width, height, cx: width / 2, openW: Math.min(460, width - 24), openH: Math.min(250, height - 40), miniW, miniH };
}

/** La goutte qui sort du haut de l'écran : son rayon, son centre, la largeur de son cou. */
export function dropAt(t: number) {
  const u = smooth(t / 0.35);
  const v = smooth((t - 0.3) / 0.45);
  const r = 5 + 15 * u + 6 * v;
  return { r, cy: lerp(r * 0.2, 40, v), neck: r * (1.25 - 0.5 * v) };
}

export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** L'arrondi des coins du bas (le haut touche le bord de l'écran). */
  r: number;
}

/** La forme de l'île à l'instant t. */
export function islandAt(G: Geometry, t: number): Shape {
  const d = dropAt(Math.min(t, 0.75));
  let w = lerp(d.r * 2, G.openW, spr(t - T.open, 6.5, 10));
  let h = lerp(d.cy + d.r, G.openH, spr(t - T.open - 0.06, 6.5, 10));
  if (t >= T.fold) {
    // Repli en goutte : elle s'affine en s'allongeant, comme une goutte qui va remonter.
    const u = smooth((t - T.fold) / FOLD_STRETCH);
    w = lerp(G.openW, G.openW * 0.5, u);
    h = lerp(G.openH, G.openH * 1.1, u);
  }
  if (t >= FOLD_START) {
    w = lerp(G.openW * 0.5, G.miniW, spr(t - FOLD_START, 8, 10));
    h = lerp(G.openH * 1.1, G.miniH, spr(t - FOLD_START - 0.06, 9, 10));
  }
  // Ondine se pose : boing, puis deux respirations.
  if (t > LAND) {
    const u = t - LAND;
    const k = Math.exp(-6 * u) * Math.sin(16 * u);
    const fade = 1 - smooth((u - 1.1) / 0.6);
    const breath = u > 0.5 && u < 1.7 ? Math.sin(((u - 0.5) / 0.6) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5 : 0;
    w *= 1 + 0.07 * k + 0.03 * breath * fade;
    h *= 1 + 0.14 * k + 0.05 * breath * fade;
  }
  w = Math.max(w, 2);
  h = Math.max(h, 2);
  const r = Math.min(h / 2, w / 2, 30 + Math.max(0, h - G.miniH) * 0.04);
  return { x: G.cx - w / 2, y: 0, w, h, r };
}

// ── Les anneaux ─────────────────────────────────────────────────────────────

export interface Ring {
  label: string;
  /** Jusqu'où il se remplit (0 à 1). */
  value: number;
  /** Le texte au centre pour un remplissage f (0 à value). */
  show: (f: number) => string;
  color: string;
}

export const RING_COUNT = 3;

/** Quand l'anneau i se remplit : [début, fin]. */
export function ringWindow(i: number): [number, number] {
  const s = T.blow + i * 0.15;
  return [s, s + 1.0];
}

export function ringFill(i: number, value: number, t: number): number {
  const [a, b] = ringWindow(i);
  return value * smooth((t - a) / (b - a));
}

export function ringCenter(G: Geometry, i: number) {
  return { x: G.cx + (i - 1) * Math.min(120, G.openW * 0.3), y: G.openH - 62 };
}

export const RING_R = 19;

export function ringTip(G: Geometry, i: number, f: number) {
  const c = ringCenter(G, i);
  const a = -Math.PI / 2 + f * Math.PI * 2;
  return { x: c.x + Math.cos(a) * RING_R, y: c.y + Math.sin(a) * RING_R };
}

// ── Ondine et les paillettes ────────────────────────────────────────────────

/** Ondine dans l'île ouverte : son centre et sa taille (rayon de sa goutte). */
export const homeOf = (G: Geometry) => ({ x: G.cx, y: 72, s: 30 });
/** Sa bouche, où entrent les paillettes. */
export const mouthOf = (G: Geometry) => ({ x: G.cx, y: 72 + 0.17 * 30 });

export interface Grain {
  /** Où il part (centre de l'éclat) et où il va flotter (décalage). */
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  phase: number;
  speed: number;
  color: string;
  size: number;
  ring: number;
  /** Quand il est avalé. */
  swallowAt: number;
  /** Quand il atterrit dans son anneau, et à quel remplissage. */
  landAt: number;
  fill: number;
  spin: number;
}

export const DUST_COLORS = ["#5cc8ff", "#62e6c4", "#ff9cc6", "#ffd84a", "#b98cff", "#ff8f78"];

/** Les paillettes de l'éclat, avec leur trajet planifié (avalées, puis soufflées). */
export function planDust(G: Geometry, values: number[], count = 150, seed = 7): Grain[] {
  const R = seeded(seed);
  const ox = G.cx;
  const oy = G.openH / 2;
  const grains: Grain[] = [];
  // Assez près pour rester dans la fenêtre de l'île (720 px de large).
  const reachX = Math.max(60, Math.min(330, G.width / 2 - 12));
  for (let k = 0; k < count; k++) {
    const a = R() * Math.PI * 2;
    const D = 0.4 + R() * 0.6;
    let dy = Math.sin(a) * D * 130;
    if (dy < 0) dy *= 0.35;
    grains.push({
      ox,
      oy,
      dx: Math.cos(a) * D * reachX,
      dy,
      phase: R() * Math.PI * 2,
      speed: 0.4 + R() * 0.8,
      color: DUST_COLORS[k % DUST_COLORS.length],
      size: 1.2 + R() * 1.6,
      ring: k % RING_COUNT,
      swallowAt: 0,
      landAt: 0,
      fill: 0,
      spin: (R() < 0.5 ? -1 : 1) * (1.2 + R() * 0.8),
    });
  }
  // Avalées de la plus proche à la plus lointaine.
  const m = mouthOf(G);
  const dist = (g: Grain) => Math.hypot(g.ox + g.dx - m.x, g.oy + g.dy - m.y);
  [...grains].sort((p, q) => dist(p) - dist(q)).forEach((g, j) => {
    g.swallowAt = T.mouth + 0.6 + (T.suckEnd - T.mouth - 0.6) * (j / Math.max(1, count - 1));
  });
  // Puis soufflées dans leur anneau : chacune arrive pile quand la courbe de
  // l'anneau atteint sa part.
  for (let i = 0; i < RING_COUNT; i++) {
    const group = grains.filter((g) => g.ring === i);
    const v = values[i] ?? 1;
    const [a, b] = ringWindow(i);
    group.forEach((g, j) => {
      g.fill = (v * (j + 1)) / group.length;
      g.landAt = a + (b - a) * invSmooth(v > 0 ? g.fill / v : 1);
    });
  }
  return grains;
}

/** Où flotte une paillette après l'éclat. */
function floatAt(g: Grain, t: number) {
  const e = 1 - Math.exp(-4 * Math.max(0, t - T.burst));
  return { x: g.ox + g.dx * e + Math.sin(t * g.speed + g.phase) * 6, y: g.oy + g.dy * e + Math.cos(t * g.speed * 0.8 + g.phase) * 4 };
}

export interface GrainPos {
  x: number;
  y: number;
  /** 0 : flotte ; 1 : aspirée ; 2 : soufflée. */
  phase: 0 | 1 | 2;
  /** Mélange vers la couleur de l'anneau (0 à 1). */
  tint: number;
  /** Taille relative. */
  scale: number;
}

/** La position d'une paillette ; null quand elle est dans la bouche d'Ondine ou déjà dans son anneau. */
export function grainAt(G: Geometry, g: Grain, t: number): GrainPos | null {
  if (t < T.burst) return null;
  const s0 = g.swallowAt - SUCK;
  if (t < s0) return { ...floatAt(g, t), phase: 0, tint: 0, scale: 1 };
  const m = mouthOf(G);
  if (t < g.swallowAt) {
    // Aspirée en spirale vers la bouche.
    // Une spirale aplatie (l'île est plus large que haute), qui ne sort pas de la fenêtre.
    const e = clamp((t - s0) / SUCK) ** 2;
    const h0 = floatAt(g, s0);
    const k = 0.5;
    const r0 = Math.hypot(h0.x - m.x, (h0.y - m.y) / k);
    const a = Math.atan2((h0.y - m.y) / k, h0.x - m.x) + g.spin * e;
    const r = r0 * (1 - e);
    const y = clamp(m.y + Math.sin(a) * r * k, 4, G.height - 4);
    return { x: m.x + Math.cos(a) * r, y, phase: 1, tint: e * 0.4, scale: 1 - 0.6 * e };
  }
  const b0 = g.landAt - BLOW;
  if (t < b0 || t > g.landAt) return null;
  // Soufflée de la bouche jusqu'à la pointe de son anneau, sur une courbe.
  const u = clamp((t - b0) / BLOW);
  const e = 1 - (1 - u) * (1 - u);
  const tip = ringTip(G, g.ring, g.fill);
  const cx = (m.x + tip.x) / 2 + (tip.y - m.y) * 0.25;
  const cy = (m.y + tip.y) / 2 - (tip.x - m.x) * 0.25;
  return {
    x: (1 - e) * (1 - e) * m.x + 2 * (1 - e) * e * cx + e * e * tip.x,
    y: (1 - e) * (1 - e) * m.y + 2 * (1 - e) * e * cy + e * e * tip.y,
    phase: 2,
    tint: 0.4 + 0.6 * u,
    scale: 0.7,
  };
}

// ── Ce que fait Ondine ──────────────────────────────────────────────────────

/** L'animation du moteur gomme à jouer à l'instant t. */
export function gumAnimAt(t: number): string {
  if (t < T.hello) return "wake";
  if (t < T.hello + 1.2) return "coucou";
  if (t < T.mouth) return "idle";
  if (t < T.suckEnd) return "surpris";
  if (t < T.blow - 0.45) return "eating";
  if (t < T.joy) return "parle";
  if (t < T.fold) return "celebrate";
  if (t < LAND) return "idle";
  if (t < LAND + 0.9) return "happy";
  return "idle";
}

/** L'ouverture de la bouche qui aspire (0 à ~1,1) : petite anticipation, rebond, « gloups » à la fin. */
export function gapeAt(t: number): number {
  const u = clamp((t - T.mouth - 0.08) / 0.32);
  const open = u <= 0 ? 0 : 1 - Math.exp(-6 * u) * Math.cos(9 * u);
  return open * (1 - smooth((t - T.suckEnd) / 0.1));
}

/** Combien elle a gonflé (0 à 0,32) : en aspirant, puis elle dégonfle en soufflant. */
export function inflateAt(t: number): number {
  return 0.32 * smooth((t - T.mouth - 0.2) / (T.suckEnd - T.mouth)) * (1 - smooth((t - T.blow + 0.45) / 1.6));
}

/** Les sons de l'animation, dans l'ordre : [moment, nom]. */
export function soundCues(): [number, string][] {
  return [
    [0.05, "drop"],
    [T.open, "stretch"],
    [T.burst, "burst"],
    [T.ondine + 0.02, "pop"],
    [T.mouth + 0.15, "suck"],
    [T.suckEnd, "gulp"],
    [T.blow - 0.45, "blow"],
    ...Array.from({ length: RING_COUNT }, (_, i): [number, string] => [ringWindow(i)[1], `ring${i}`]),
    [T.fold, "fold"],
    [LAND, "boing"],
    [HALO, "chime"],
    [HALO + HALO_LEN * 0.66, "spark"],
  ];
}

// ── Quand l'éclosion joue ───────────────────────────────────────────────────

export interface HatchContext {
  /** Premier démarrage (l'assistant va s'ouvrir). */
  firstRun: boolean;
  /** Ce que « Quoi de neuf » va faire (changelog.ts, whatsNewAction). */
  whatsNew: "show" | "remember" | "nothing";
  /** Réglage island.hatch (oui par défaut). */
  enabled: boolean;
  /** Réduire les animations de Windows, ou le mode Calme de la mascotte. */
  quiet: boolean;
  edge: string;
  style: string;
  /** Ondine est sur le bureau (elle n'est pas dans l'île). */
  petOut: boolean;
}

/**
 * "first" au premier lancement, "update" après une mise à jour, sinon null.
 * Seulement avec l'île en haut de l'écran, au style classique et Ondine dans
 * l'île : l'animation sort du haut de l'écran.
 */
export function hatchKind(c: HatchContext): "first" | "update" | null {
  if (!c.enabled || c.quiet || c.edge !== "top" || c.style === "mouth" || c.petOut) return null;
  if (c.firstRun) return "first";
  if (c.whatsNew === "show") return "update";
  return null;
}
