// La famille « gomme » : des bonbons gélifiés ronds et brillants (goutte,
// Guimauve, Dragée, étoile, soleil, lune…). Tout est dessiné en Canvas 2D, à
// partir d'une description de la scène (GumScene) que prépare gum.ts.
//
// L'effet gomme vient de plusieurs couches posées l'une sur l'autre :
//   1. une ombre douce sous la mascotte ;
//   2. le corps, avec un dégradé clair en haut à gauche, plus foncé en bas ;
//   3. une lueur intérieure en bas (la lumière qui traverse la gomme) ;
//   4. un liseré clair à l'intérieur du bord (l'épaisseur translucide) ;
//   5. un grand reflet blanc en haut à gauche et un petit point brillant.
//
// Le corps n'est plus un dessin fixe : c'est un CONTOUR de points (voir
// gum-shapes.ts) que gum.ts fait onduler comme une gelée. Le visage n'est plus
// une suite de dessins (« yeux ouverts », « yeux fermés »…) mais des RÉGLAGES
// chiffrés (ouverture des yeux, courbe de la bouche…) : gum.ts les fait glisser
// en douceur d'une expression à l'autre, et ce fichier les dessine tels quels.
//
// Par-dessus : les mains (des moufles en gomme qui flottent), les accessoires
// (chapeau, lunettes, collier) et les effets (Zzz, confettis, pluie…).

import { drawHeart, drawOverlay, type Overlay } from "./overlays";
import { halfWidthAt, topAt, type GumShape, type Pt } from "./gum-shapes";

const TAU = Math.PI * 2;
const INK = "#1a1630";

// ── Les couleurs ────────────────────────────────────────────────────────────

/** Les teintes : clair (reflet), milieu, profond (bas du corps), contour. */
export const TINTS = {
  blue: ["#c9f0ff", "#5cc8ff", "#1f86e0", "#145a9e"],
  red: ["#ffd2d6", "#ff6b78", "#e02842", "#9c1530"],
  yellow: ["#fff3c4", "#ffd24a", "#f59e0b", "#a8640a"],
  green: ["#d4ffe2", "#5fe08f", "#1fae5c", "#13703b"],
  violet: ["#ecdcff", "#b98cff", "#7b4dea", "#4f2aa3"],
  pink: ["#ffe0ee", "#ff9cc6", "#f0609e", "#a3305f"],
  // Les nouvelles couleurs.
  orange: ["#ffe2c4", "#ffa04a", "#f0640e", "#a13d06"],
  gold: ["#fff6cf", "#ffd84a", "#f2b20c", "#9a6a00"],
  mint: ["#d6fff2", "#62e6c4", "#16b394", "#0b6e5c"],
  coral: ["#ffe0d8", "#ff8f78", "#f0543e", "#a12f22"],
  lilac: ["#f4e4ff", "#d7a6ff", "#a66cf0", "#6b3cae"],
  night: ["#d4dcff", "#6f84ff", "#3b46c9", "#232a80"],
  licorice: ["#c8c8d8", "#5a5a72", "#2e2e40", "#16161f"],
  cloud: ["#ffffff", "#eef4ff", "#bccbe8", "#7b8db3"],
  sun: ["#fff8c8", "#ffd23c", "#ff9a1a", "#b65f00"],
  moon: ["#fffbe6", "#fbe9a8", "#e3c56a", "#9b8236"],
  ghost: ["#ffffff", "#f1ecff", "#c9bff0", "#8a7cc4"],
} satisfies Record<string, [string, string, string, string]>;

/** Une teinte nommée, l'arc-en-ciel (calculé), ou « custom » : la couleur libre du réglage `mascot.customColor`. */
export type GumTint = keyof typeof TINTS | "rainbow" | "custom";
export type Rgb = [number, number, number];
export type Palette = [Rgb, Rgb, Rgb, Rgb];

export const TINT_NAMES = [...Object.keys(TINTS), "rainbow", "custom"] as GumTint[];

/** La couleur libre par défaut (la même que le Rust : settings.rs). */
export const DEFAULT_CUSTOM = "#4da3ff";

const toRgb = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const css = (c: Rgb, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

/** « #rrggbb » exactement (minuscules ou majuscules). */
export function isHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

/**
 * Une teinte en couleurs RVB. L'arc-en-ciel change de couleur avec le temps
 * `t` (s) ; « custom » dérive sa palette de `custom` (#rrggbb, voir paletteFromHex).
 */
export function palette(tint: GumTint, t = 0, custom = DEFAULT_CUSTOM): Palette {
  if (tint === "rainbow") {
    const h = (t * 24) % 360;
    return [hsl(h, 100, 92), hsl(h, 95, 68), hsl(h + 18, 85, 50), hsl(h + 24, 75, 32)];
  }
  if (tint === "custom") return paletteFromHex(custom);
  return (TINTS[tint] ?? TINTS.blue).map(toRgb) as Palette;
}

/**
 * La palette gomme d'une couleur libre : la couleur choisie est le milieu du
 * bonbon ; le reflet est plus clair et moins saturé, le bas plus foncé (la
 * teinte glisse un peu, comme pour les teintes nommées), le contour plus
 * foncé encore. Une couleur invalide donne le bleu.
 */
export function paletteFromHex(hex: string): Palette {
  if (!isHexColor(hex)) return TINTS.blue.map(toRgb) as Palette;
  const [h, s, l] = rgbToHsl(toRgb(hex));
  // Une couleur très sombre ou très claire reste lisible : le milieu est ramené dans une plage de gomme.
  const mid = Math.min(78, Math.max(42, l));
  const sat = Math.max(35, s);
  return [hsl(h, Math.min(100, sat * 0.8 + 20), Math.min(96, mid + 28)), hsl(h, sat, mid), hsl(h + 12, Math.min(100, sat * 0.95), mid - 20), hsl(h + 18, Math.min(100, sat * 0.85), Math.max(10, mid - 36))];
}

function hsl(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** RVB (0-255) → teinte (0-360), saturation et luminosité (0-100). */
export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

/** Teinte (0-360), saturation et luminosité (0-100) → « #rrggbb ». */
export function hslToHex(h: number, s: number, l: number): string {
  return "#" + hsl(h, s, l).map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

// ── Le visage, en réglages chiffrés ─────────────────────────────────────────

/**
 * Tous les réglages du visage. Ce sont des nombres : gum.ts peut donc les faire
 * glisser d'une expression à l'autre (la bouche qui s'ouvre peu à peu, les
 * sourcils qui se froncent…).
 */
export interface Face {
  /** Ouverture des yeux (0 = fermés). */
  eyeOpen: number;
  /** Quand les yeux sont fermés : la courbe du trait (+1 = ^ joyeux, -1 = ‿ endormi). */
  eyeCurve: number;
  /** Taille des yeux (1 = normale, 1,3 = grands ouverts). */
  eyeSize: number;
  /** Paupière lourde (0 à 1) : coupe le haut de l'œil d'un trait. */
  lid: number;
  /** Clin d'œil : l'œil droit se ferme en arc (0 à 1). */
  winkR: number;
  /** Sourcils : visibles (0 à 1), froncés (+) ou inquiets (-), levés, un seul levé. */
  browA: number;
  browTilt: number;
  browRaise: number;
  browAsym: number;
  /** Bouche : visible, largeur, courbe (+ sourire, - moue), ouverture, sourire en coin. */
  mouthA: number;
  mouthW: number;
  mouthC: number;
  mouthO: number;
  skew: number;
  /** Bouche ondulée (étourdie, gênée), en « ω » (malicieuse), langue au coin (concentrée). */
  wavy: number;
  cat: number;
  tongueSide: number;
  /** Joues roses, joues gonflées (boudeuse), petits traits de gêne. */
  blush: number;
  puff: number;
  lines: number;
  /** Larmes qui coulent, yeux brillants mouillés, larmes qui volent (rire). */
  tears: number;
  teary: number;
  flyTears: number;
  /** Bulle de chewing-gum (0 = aucune, 1 = prête à éclater). */
  bubble: number;
}

export const FACE_BASE: Face = {
  eyeOpen: 1,
  eyeCurve: -0.6,
  eyeSize: 1,
  lid: 0,
  winkR: 0,
  browA: 0,
  browTilt: 0,
  browRaise: 0,
  browAsym: 0,
  mouthA: 1,
  mouthW: 1,
  mouthC: 0.6,
  mouthO: 0,
  skew: 0,
  wavy: 0,
  cat: 0,
  tongueSide: 0,
  blush: 0.55,
  puff: 0,
  lines: 0,
  tears: 0,
  teary: 0,
  flyTears: 0,
  bubble: 0,
};

export const FACE_KEYS = Object.keys(FACE_BASE) as (keyof Face)[];

/** Les yeux qui ne sont pas de simples yeux : en spirale, en cœur, en croix, en étoile, plissés (> <). */
export type EyeKind = "normal" | "spiral" | "heart" | "x" | "star" | "squint";

// ── Les mains et les accessoires ────────────────────────────────────────────

export interface Hand {
  x: number;
  y: number;
  r: number;
  s: number;
  /** Pouce levé (le coucou). */
  thumb: number;
}

export type HeadWear = "none" | "cap" | "straw" | "tophat" | "beanie" | "crown" | "bow";
export type EyeWear = "none" | "round" | "sun" | "heart";
export type NeckWear = "none" | "pearls" | "bowtie" | "scarf";

export interface Wear {
  head: HeadWear;
  eyes: EyeWear;
  neck: NeckWear;
}

export type WeatherFx = "none" | "rain" | "snow" | "storm";

// ── La scène complète d'une image ───────────────────────────────────────────

export interface GumScene {
  shape: GumShape;
  /** Le contour de l'instant (gelée comprise), en unités de R. */
  pts: Pt[];
  /** Forme dont on vient, pendant un passage d'une forme à l'autre (décors en fondu). */
  fromShape?: GumShape;
  morph: number;
  colors: Palette;
  face: Face;
  eyes: EyeKind;
  eyesPrev: EyeKind;
  /** Avancement du fondu entre les anciens yeux et les nouveaux (0 à 1). */
  eyesMix: number;
  /** Multiplie l'ouverture des yeux (clignement). */
  blink: number;
  look: { x: number; y: number };
  /** Le visage qui traîne derrière le corps (en R, vers le bas quand le corps monte). */
  faceLag: number;
  squash: number;
  rot: number;
  dx: number;
  dy: number;
  /** La pointe qui se plie (Berlingot qui réfléchit…). */
  tip: number;
  hands: [Hand, Hand] | null;
  handsAlpha: number;
  /** Ce que les mains tiennent : un cœur (pose « heart »), la pancarte « ? » (pose « sign », une question d'agent ouverte). */
  handItem: "heart" | "sign" | null;
  /** La main gauche passe devant le corps (bras croisés). */
  leftFront: boolean;
  wear: Wear;
  /** Un parapluie au-dessus d'elle (la Météo annonce la pluie), 0 à 1 (il apparaît en fondu). */
  umbrella: number;
  extra: Overlay;
  weather: WeatherFx;
  t: number;
}

/** Le rayon de la mascotte (px) dans un canvas de w × h. */
export function gumRadius(w: number, h: number): number {
  return Math.min(w, h) * 0.31;
}

/** Trace un contour fermé lisse (Catmull-Rom) passant par tous les points. */
function smoothPath(ctx: CanvasRenderingContext2D, P: Pt[]) {
  const n = P.length;
  ctx.beginPath();
  ctx.moveTo(P[0].x, P[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  ctx.closePath();
}

/** Une étoile à `n` branches (yeux étoilés, couronne). */
function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, ro: number, ri: number, rot: number, n = 5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Un dégradé de bonbon (clair en haut à gauche) centré en (x, y), de taille r. */
function candy(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: Palette): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.08, x - r * 0.1, y - r * 0.1, r * 1.45);
  g.addColorStop(0, css(c[0]));
  g.addColorStop(0.45, css(c[1]));
  g.addColorStop(1, css(c[2]));
  return g;
}

/** Dessine la mascotte gomme centrée dans un canvas de w × h pixels. */
export function drawGum(ctx: CanvasRenderingContext2D, w: number, h: number, sc: GumScene) {
  const S = sc.shape;
  const c = sc.colors;
  const R = gumRadius(w, h);
  const sx = 1 / Math.sqrt(sc.squash);
  const sy = sc.squash;
  const float = S.float * R * (1 + Math.sin(sc.t * 1.6) * 0.15 * Math.sign(S.float));
  // Les pieds restent posés : on étire à partir du bas.
  const footY = h / 2 + R * 0.98;
  const cx = w / 2 + sc.dx * R;
  const cy = footY - R * 0.94 * sy + sc.dy * R - float;
  const t = sc.t;

  ctx.clearRect(0, 0, w, h);

  // 1. Ombre au sol (elle rétrécit quand la mascotte saute ou flotte).
  const lift = Math.max(0, -sc.dy) + S.float * 0.8;
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.28 * (1 - Math.min(0.75, lift))})`;
  ctx.filter = `blur(${R * 0.06}px)`;
  ctx.beginPath();
  ctx.ellipse(w / 2 + sc.dx * R, footY + R * 0.04, R * 0.78 * sx * (1 - Math.min(0.6, lift * 0.45)), R * 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(sc.rot);

  // Les mains derrière le corps (la droite quand les bras sont croisés).
  if (sc.hands && sc.handsAlpha > 0.02 && sc.leftFront) drawMitt(ctx, sc.hands[1], sx, sy, R, 1, c, sc.handsAlpha);

  ctx.save();
  ctx.scale(sx, sy);
  ctx.globalAlpha = S.alpha;
  const P = sc.pts.map((p) => ({ x: p.x * R, y: p.y * R }));

  // Les rayons du soleil, derrière le corps.
  decorBehind(ctx, sc, R);

  // 2. Le corps.
  smoothPath(ctx, P);
  ctx.fillStyle = candy(ctx, 0, 0, R, c);
  ctx.fill();

  ctx.save();
  smoothPath(ctx, P);
  ctx.clip();
  // 3. Lueur intérieure en bas : la lumière traverse la gomme.
  const glow = ctx.createRadialGradient(R * 0.1, R * 0.75, 0, R * 0.1, R * 0.75, R * 0.85);
  glow.addColorStop(0, css(c[0], 0.75));
  glow.addColorStop(1, css(c[0], 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2);
  decorInside(ctx, sc, R);
  // 4. Liseré clair à l'intérieur du bord.
  smoothPath(ctx, P);
  ctx.lineWidth = R * 0.16;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.stroke();
  ctx.lineWidth = R * 0.05;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.stroke();
  ctx.restore();

  // Contour fin, de la couleur foncée du bonbon (pas noir : plus doux).
  smoothPath(ctx, P);
  ctx.lineWidth = R * 0.045;
  ctx.strokeStyle = css(c[3]);
  ctx.stroke();

  // 5. Les reflets.
  const [shx, shy, shr, shs] = S.shine;
  ctx.save();
  ctx.translate(shx * R, shy * R);
  ctx.rotate(shr);
  const shine = ctx.createLinearGradient(0, -R * 0.12, 0, R * 0.12);
  shine.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  shine.addColorStop(1, "rgba(255, 255, 255, 0.35)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.3 * shs, R * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(S.dot[0] * R, S.dot[1] * R, R * 0.06, 0, TAU);
  ctx.fill();
  // Le reflet du bas, à droite : il suit le contour, un peu à l'intérieur.
  bottomGlint(ctx, sc.pts, R);
  ctx.globalAlpha = 1;

  // Le visage, un peu décalé vers là où elle regarde (effet de volume).
  const fx = (S.faceX + sc.look.x * 0.12) * R;
  const fy = (sc.look.y * 0.08 + sc.faceLag) * R;
  drawFace(ctx, sc, R, fx, fy);
  wearNeck(ctx, sc, R, fx);
  wearEyes(ctx, sc, R, fx, fy);
  wearHead(ctx, sc, R);
  if (sc.umbrella > 0.02) drawUmbrella(ctx, sc, R);
  ctx.restore(); // fin de l'étirement

  // Les mains devant le corps.
  if (sc.hands && sc.handsAlpha > 0.02) {
    drawMitt(ctx, sc.hands[0], sx, sy, R, -1, c, sc.handsAlpha);
    // La pancarte est derrière la moufle droite, qui tient son manche.
    if (sc.handItem === "sign") drawSign(ctx, sc.hands[1], sx, sy, R, sc.handsAlpha, t);
    if (!sc.leftFront) drawMitt(ctx, sc.hands[1], sx, sy, R, 1, c, sc.handsAlpha);
    if (sc.handItem === "heart") {
      const a = sc.hands[0];
      const b = sc.hands[1];
      const hx = ((a.x + b.x) / 2) * R * sx;
      const hy = ((a.y + b.y) / 2 - 0.12) * R * sy;
      const k = 1 + Math.sin(t * 5) * 0.06;
      ctx.globalAlpha = sc.handsAlpha;
      drawHeart(ctx, hx, hy, R * 0.5 * k, "#ff4f8a");
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.beginPath();
      ctx.ellipse(hx - R * 0.08, hy - R * 0.06, R * 0.05, R * 0.03, -0.6, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  drawWeather(ctx, sc.weather, w / 2, cy, R, t);
  drawOverlay(ctx, sc.extra, w / 2, cy, R, t);
}

/** Le petit reflet du bas, à droite, le long du contour. */
function bottomGlint(ctx: CanvasRenderingContext2D, pts: Pt[], R: number) {
  const cyy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineCap = "round";
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    const a = Math.atan2(p.y - cyy, p.x);
    if (a > 0.3 && a < 0.95) {
      const x = p.x * 0.84 * R;
      const y = (cyy + (p.y - cyy) * 0.84) * R;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    } else if (started) break;
  }
  ctx.stroke();
}

// ── Les décors propres à chaque forme ───────────────────────────────────────

/** Un décor visible : 1 pour la forme actuelle, en fondu pendant un passage d'une forme à l'autre. */
function decorAlpha(sc: GumScene, decor: GumShape["decor"]): number {
  let a = sc.shape.decor === decor ? sc.morph : 0;
  if (sc.fromShape?.decor === decor) a += 1 - sc.morph;
  if (!sc.fromShape && sc.shape.decor === decor) a = 1;
  return Math.min(1, a);
}

function decorBehind(ctx: CanvasRenderingContext2D, sc: GumScene, R: number) {
  const a = decorAlpha(sc, "rays");
  if (a < 0.02) return;
  // Les rayons du soleil : des petits triangles en gomme qui tournent doucement
  // et s'allongent chacun à leur tour.
  const c = sc.colors;
  ctx.save();
  ctx.globalAlpha *= a;
  const cy = 0.16 * R;
  const n = 10;
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * TAU + sc.t * 0.25;
    const len = (1.28 + Math.sin(sc.t * 3 + k * 1.7) * 0.06) * R * (0.6 + 0.4 * a);
    const base = 0.72 * R;
    const half = 0.16;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang - half) * base, cy + Math.sin(ang - half) * base);
    ctx.quadraticCurveTo(Math.cos(ang) * len * 1.02, cy + Math.sin(ang) * len * 1.02, Math.cos(ang + half) * base, cy + Math.sin(ang + half) * base);
    ctx.closePath();
    ctx.fillStyle = candy(ctx, Math.cos(ang) * R * 0.9, cy + Math.sin(ang) * R * 0.9, R * 0.3, c);
    ctx.fill();
    ctx.lineWidth = R * 0.035;
    ctx.strokeStyle = css(c[3]);
    ctx.stroke();
  }
  ctx.restore();
}

function decorInside(ctx: CanvasRenderingContext2D, sc: GumScene, R: number) {
  const t = sc.t;
  // La lune : quelques cratères, comme des taches de rousseur.
  let a = decorAlpha(sc, "craters");
  if (a > 0.02) {
    ctx.fillStyle = css(sc.colors[2], 0.35 * a);
    for (const [x, y, r] of [
      [-0.62, -0.42, 0.13],
      [-0.82, 0.18, 0.09],
      [-0.28, 0.62, 0.1],
    ])
      ctx.beginPath(), ctx.ellipse(x * R, y * R, r * R, r * R * 0.8, 0, 0, TAU), ctx.fill();
  }
  // Le champignon : un pied crème et des pois blancs sur le chapeau.
  a = decorAlpha(sc, "spots");
  if (a > 0.02) {
    const g = ctx.createLinearGradient(0, 0.3 * R, 0, 0.95 * R);
    g.addColorStop(0, `rgba(255, 246, 228, ${a})`);
    g.addColorStop(1, `rgba(236, 214, 182, ${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(-R * 0.7, R * 0.33, R * 1.4, R * 0.7);
    ctx.fillStyle = `rgba(120, 60, 30, ${0.25 * a})`;
    ctx.fillRect(-R * 0.7, R * 0.33, R * 1.4, R * 0.04);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.92 * a})`;
    for (const [x, y, r] of [
      [-0.62, -0.42, 0.15],
      [0.1, -0.72, 0.13],
      [0.7, -0.3, 0.16],
      [-0.95, 0.06, 0.08],
      [0.96, 0.08, 0.07],
    ])
      ctx.beginPath(), ctx.ellipse(x * R, y * R, r * R, r * R * 0.85, 0, 0, TAU), ctx.fill();
  }
  // La fleur : un cœur jaune, où se trouve le visage.
  a = decorAlpha(sc, "petals");
  if (a > 0.02) {
    const g = ctx.createRadialGradient(-R * 0.12, -R * 0.1, R * 0.05, 0, R * 0.06, R * 0.62);
    g.addColorStop(0, `rgba(255, 246, 196, ${a})`);
    g.addColorStop(0.7, `rgba(255, 210, 74, ${a})`);
    g.addColorStop(1, `rgba(245, 158, 11, ${a * 0.9})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, R * 0.06, R * 0.58, 0, TAU);
    ctx.fill();
  }
  // La flamme : un cœur plus clair qui danse.
  a = decorAlpha(sc, "inner-flame");
  if (a > 0.02) {
    const sway = Math.sin(t * 6) * 0.06;
    const g = ctx.createLinearGradient(0, -0.4 * R, 0, 0.94 * R);
    g.addColorStop(0, `rgba(255, 244, 170, 0)`);
    g.addColorStop(0.5, `rgba(255, 236, 140, ${0.6 * a})`);
    g.addColorStop(1, `rgba(255, 250, 220, ${0.8 * a})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo((0.05 + sway) * R, -0.35 * R);
    ctx.bezierCurveTo(0.55 * R, 0.2 * R, 0.6 * R, 0.9 * R, 0, 0.92 * R);
    ctx.bezierCurveTo(-0.6 * R, 0.9 * R, -0.55 * R, 0.2 * R, (0.05 + sway) * R, -0.35 * R);
    ctx.fill();
  }
  // Le nuage : des bosses plus claires, comme du coton.
  a = decorAlpha(sc, "cloud-puffs");
  if (a > 0.02) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.45 * a})`;
    for (const [x, y, r] of [
      [-0.3, -0.18, 0.32],
      [0.36, -0.3, 0.34],
      [-0.72, 0.3, 0.22],
    ])
      ctx.beginPath(), ctx.arc(x * R, y * R, r * R, 0, TAU), ctx.fill();
  }
}

// ── Le visage ───────────────────────────────────────────────────────────────

function drawFace(ctx: CanvasRenderingContext2D, sc: GumScene, R: number, fx: number, fy: number) {
  const S = sc.shape;
  const f = sc.face;
  const eyeY = S.eyeY * R + fy;
  const eyeDX = S.eyeDX * R;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Joues (plus grandes quand elle les gonfle).
  if (f.blush > 0.01) {
    for (const side of [-1, 1]) {
      const bx = side * S.cheekDX * R + fx;
      const by = eyeY + R * 0.26;
      const rr = R * (0.2 + f.puff * 0.06) * S.eyeScale;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rr);
      g.addColorStop(0, `rgba(255, 120, 170, ${Math.min(0.85, 0.55 * f.blush)})`);
      g.addColorStop(1, "rgba(255, 120, 170, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(bx, by, rr, rr * 0.6, 0, 0, TAU);
      ctx.fill();
    }
  }
  // Les petits traits de gêne sur les joues.
  if (f.lines > 0.02) {
    ctx.strokeStyle = `rgba(26, 22, 48, ${0.55 * f.lines})`;
    ctx.lineWidth = R * 0.03;
    for (const side of [-1, 1])
      for (let k = 0; k < 3; k++) {
        const bx = side * S.cheekDX * R + fx + (k - 1) * R * 0.07;
        const by = eyeY + R * 0.26;
        ctx.beginPath();
        ctx.moveTo(bx + R * 0.025, by - R * 0.04);
        ctx.lineTo(bx - R * 0.025, by + R * 0.04);
        ctx.stroke();
      }
  }

  // Les yeux : les anciens s'effacent pendant que les nouveaux apparaissent.
  if (sc.eyesMix < 1) drawEyes(ctx, sc, sc.eyesPrev, 1 - sc.eyesMix, 1 - sc.eyesMix * 0.4, R, fx, eyeY, eyeDX);
  drawEyes(ctx, sc, sc.eyes, sc.eyesMix, 0.6 + 0.4 * sc.eyesMix, R, fx, eyeY, eyeDX);

  // Larmes qui coulent.
  if (f.tears > 0.01) {
    for (const side of [-1, 1]) {
      const x = side * (eyeDX + R * 0.06) + fx;
      const top = eyeY + R * 0.14;
      const len = R * 0.55 * f.tears;
      const g = ctx.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, "rgba(220, 245, 255, 0.95)");
      g.addColorStop(1, "rgba(220, 245, 255, 0.5)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x - R * 0.045, top, R * 0.09, len, R * 0.045);
      ctx.fill();
    }
  }
  // Larmes qui volent (rire aux larmes).
  if (f.flyTears > 0.05) {
    ctx.fillStyle = "rgb(200, 238, 255)";
    for (const side of [-1, 1])
      for (let k = 0; k < 3; k++) {
        const ph = (sc.t * 1.7 + k / 3) % 1;
        const x = side * (eyeDX + R * 0.18 + ph * R * 0.55) + fx;
        const y = eyeY - Math.sin(ph * Math.PI) * R * 0.3 + ph * ph * R * 0.35;
        ctx.globalAlpha = (1 - ph) * f.flyTears;
        ctx.beginPath();
        ctx.ellipse(x, y, R * 0.05, R * 0.07, side * 0.6, 0, TAU);
        ctx.fill();
      }
    ctx.globalAlpha = 1;
  }

  // Sourcils.
  if (f.browA > 0.02) {
    ctx.strokeStyle = `rgba(26, 22, 48, ${Math.min(1, f.browA)})`;
    ctx.lineWidth = R * 0.065;
    for (const side of [-1, 1]) {
      const ex = side * eyeDX + fx;
      const by = eyeY - R * 0.34 * f.eyeSize * S.eyeScale;
      const raise = (f.browRaise + (side > 0 ? f.browAsym * 0.9 : -f.browAsym * 0.25)) * R * 0.09;
      const xi = ex - side * R * 0.13;
      const xo = ex + side * R * 0.15;
      const yi = by + f.browTilt * R * 0.09 - raise;
      const yo = by - f.browTilt * R * 0.09 - raise;
      ctx.beginPath();
      ctx.moveTo(xi, yi);
      ctx.quadraticCurveTo((xi + xo) / 2, (yi + yo) / 2 - R * 0.04 * (1 - Math.min(1, Math.abs(f.browTilt))), xo, yo);
      ctx.stroke();
    }
  }

  drawMouth(ctx, f, fx, eyeY + S.mouthDY * R * S.eyeScale, R * S.eyeScale, sc.t);
}

function drawEyes(ctx: CanvasRenderingContext2D, sc: GumScene, kind: EyeKind, alpha: number, scale: number, R: number, fx: number, eyeY: number, eyeDX: number) {
  if (alpha < 0.02) return;
  const f = sc.face;
  const t = sc.t;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const side of [-1, 1]) {
    const x = side * eyeDX + fx;
    const y = eyeY;
    const ew = R * 0.15 * f.eyeSize * scale * sc.shape.eyeScale;
    const eh = R * 0.19 * f.eyeSize * scale * sc.shape.eyeScale;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = R * 0.07 * sc.shape.eyeScale;
    switch (kind) {
      case "normal": {
        const wink = side > 0 ? f.winkR : 0;
        const open = Math.max(0, f.eyeOpen * sc.blink * (1 - wink));
        const curve = f.eyeCurve + (1 - f.eyeCurve) * wink;
        if (open > 0.06) {
          const hh = eh * open;
          const ey = y + (1 - open) * eh * 0.25;
          const lx = sc.look.x * ew * 0.25;
          const ly = sc.look.y * eh * 0.2;
          ctx.save();
          // La paupière lourde : on coupe le haut de l'œil.
          if (f.lid > 0.02) {
            ctx.beginPath();
            ctx.rect(x - ew * 2, ey - hh + hh * 1.1 * f.lid, ew * 4, hh * 3);
            ctx.clip();
          }
          ctx.beginPath();
          ctx.ellipse(x, ey, ew, hh, 0, 0, TAU);
          ctx.fill();
          if (f.teary > 0.02) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(x, ey, ew, hh, 0, 0, TAU);
            ctx.clip();
            ctx.fillStyle = `rgba(120, 200, 255, ${0.85 * f.teary})`;
            ctx.beginPath();
            ctx.ellipse(x, ey + hh * 0.85, ew * 1.1, hh * 0.45, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
          if (open > 0.4) {
            // deux reflets, comme une bille de verre (trois quand elle est émue)
            ctx.globalAlpha = alpha * Math.min(1, (open - 0.4) / 0.3);
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x - ew * 0.32 + lx, ey - hh * 0.38 + ly, ew * (0.38 + f.teary * 0.08), 0, TAU);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + ew * 0.38 + lx, ey + hh * 0.42 + ly, ew * 0.16, 0, TAU);
            ctx.fill();
            if (f.teary > 0.3) {
              ctx.beginPath();
              ctx.arc(x + ew * 0.1 + lx, ey - hh * 0.62 + ly, ew * 0.1, 0, TAU);
              ctx.fill();
            }
            ctx.globalAlpha = alpha;
          }
          ctx.restore();
          if (f.lid > 0.02) {
            ctx.globalAlpha = alpha * Math.min(1, f.lid * 2);
            ctx.beginPath();
            const ly2 = ey - hh + hh * 1.1 * f.lid;
            ctx.moveTo(x - ew * 1.25, ly2);
            ctx.lineTo(x + ew * 1.25, ly2);
            ctx.stroke();
            ctx.globalAlpha = alpha;
          }
        }
        // Les yeux fermés : un trait courbe, qui apparaît pendant qu'ils se ferment.
        const a = Math.min(1, Math.max(0, (0.3 - open) / 0.24));
        if (a > 0) {
          ctx.globalAlpha = alpha * a;
          const by = curve > 0 ? y + eh * 0.35 : y;
          ctx.beginPath();
          ctx.moveTo(x - ew * 1.2, by);
          ctx.quadraticCurveTo(x, by - curve * eh * 1.25, x + ew * 1.2, by);
          ctx.stroke();
          ctx.globalAlpha = alpha;
        }
        break;
      }
      case "squint": {
        const k = -side; // > à gauche, < à droite
        ctx.beginPath();
        ctx.moveTo(x - k * ew * 0.9, y - eh * 0.6);
        ctx.lineTo(x + k * ew * 0.9, y);
        ctx.lineTo(x - k * ew * 0.9, y + eh * 0.6);
        ctx.stroke();
        break;
      }
      case "star": {
        const k = 1 + Math.sin(t * 6 + side) * 0.08;
        starPath(ctx, x, y, ew * 1.75 * k, ew * 0.8 * k, Math.sin(t * 2) * 0.15);
        ctx.fillStyle = "#ffd84a";
        ctx.fill();
        ctx.lineWidth = R * 0.035;
        ctx.strokeStyle = "#b8760a";
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x - ew * 0.35, y - ew * 0.35, ew * 0.28, 0, TAU);
        ctx.fill();
        break;
      }
      case "heart": {
        const k = 1 + Math.sin(t * 5) * 0.08;
        drawHeart(ctx, x, y, ew * 2.5 * k, "#ff3d7f");
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.arc(x - ew * 0.45, y - ew * 0.3, ew * 0.22, 0, TAU);
        ctx.fill();
        break;
      }
      case "x":
        ctx.beginPath();
        ctx.moveTo(x - ew, y - ew);
        ctx.lineTo(x + ew, y + ew);
        ctx.moveTo(x - ew, y + ew);
        ctx.lineTo(x + ew, y - ew);
        ctx.stroke();
        break;
      case "spiral": {
        ctx.lineWidth = R * 0.045;
        ctx.beginPath();
        for (let i = 0; i <= 36; i++) {
          const a = (i / 36) * 2.3 * TAU + t * 8 * side;
          const r = (i / 36) * ew * 1.5;
          if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.stroke();
        break;
      }
    }
  }
  ctx.restore();
}

/**
 * La bouche : deux courbes (lèvre du haut, lèvre du bas) entre deux coins.
 * Courbe, largeur et ouverture sont des nombres, donc un sourire peut devenir
 * peu à peu une bouche grande ouverte, puis un petit « o ».
 */
function drawMouth(ctx: CanvasRenderingContext2D, f: Face, x: number, y: number, R: number, t: number) {
  if (f.mouthA < 0.02) return drawBubble(ctx, f, x, y, R);
  const w = R * 0.13 * f.mouthW;
  const c = f.mouthC;
  const o = Math.max(0, f.mouthO);
  const s = f.skew;
  const Lx = x - w;
  const Ly = y + s * w * 0.35;
  const Rx = x + w;
  const Ry = y - s * w * 0.35;
  const plain = (1 - f.cat) * (1 - f.wavy) * f.mouthA;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = R * 0.055;
  if (plain > 0.02) {
    ctx.globalAlpha = plain;
    const cy1 = y + c * R * 0.11 - o * R * 0.05;
    const cx1 = x + s * w * 0.3;
    if (o < 0.06) {
      ctx.beginPath();
      ctx.moveTo(Lx, Ly);
      ctx.quadraticCurveTo(cx1, cy1, Rx, Ry);
      ctx.stroke();
    } else {
      const cy2 = cy1 + o * R * (0.32 + 0.1 * (1 - Math.min(1, f.mouthW)));
      ctx.beginPath();
      ctx.moveTo(Lx, Ly);
      ctx.quadraticCurveTo(cx1, cy1, Rx, Ry);
      ctx.quadraticCurveTo(cx1, cy2, Lx, Ly);
      ctx.closePath();
      ctx.lineWidth = R * 0.05;
      ctx.stroke();
      ctx.fill();
      // une langue rose, quand la bouche est assez grande
      if (o > 0.25 && f.mouthW > 0.55) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = "#ff7a9c";
        ctx.beginPath();
        ctx.ellipse(x + s * w * 0.2, (cy1 + cy2) / 2 + o * R * 0.12, w * 0.7, R * 0.09 * o, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  if (f.wavy > 0.02) {
    ctx.globalAlpha = f.wavy * f.mouthA;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const px = x - R * 0.13 + (i / 16) * R * 0.26;
      const py = y + Math.sin((i / 16) * 2 * TAU) * R * 0.025;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  if (f.cat > 0.02) {
    ctx.globalAlpha = f.cat * f.mouthA;
    ctx.beginPath();
    ctx.arc(x - R * 0.065, y - R * 0.02, R * 0.065, 0.1 * Math.PI, 0.95 * Math.PI);
    ctx.moveTo(x + R * 0.13, y - R * 0.02 + Math.sin(0.1 * Math.PI) * R * 0.065);
    ctx.arc(x + R * 0.065, y - R * 0.02, R * 0.065, 0.05 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  }
  if (f.tongueSide > 0.02) {
    ctx.globalAlpha = f.tongueSide;
    ctx.save();
    ctx.translate(Rx - w * 0.1, Ry + R * 0.04);
    ctx.rotate(-0.5 + Math.sin(t * 3) * 0.08);
    ctx.fillStyle = "#ff7a9c";
    ctx.beginPath();
    ctx.ellipse(0, R * 0.03, R * 0.05, R * 0.065, 0, 0, TAU);
    ctx.fill();
    ctx.lineWidth = R * 0.03;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  drawBubble(ctx, f, x, y, R);
}

/** Bulle de chewing-gum, rose et brillante, devant la bouche. */
function drawBubble(ctx: CanvasRenderingContext2D, f: Face, x: number, y: number, R: number) {
  const bubble = f.bubble;
  if (bubble < 0.02) return;
  const r = R * 0.38 * bubble;
  const by = y + r * 0.55;
  const g = ctx.createRadialGradient(x - r * 0.35, by - r * 0.35, r * 0.1, x, by, r);
  g.addColorStop(0, "#ffe3f0");
  g.addColorStop(0.6, "#ff9cc8");
  g.addColorStop(1, "#ff6fae");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, by, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = R * 0.025;
  ctx.strokeStyle = "#d94c8c";
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, by - r * 0.4, r * 0.18, r * 0.11, -0.6, 0, TAU);
  ctx.fill();
}

// ── Les moufles ─────────────────────────────────────────────────────────────

/** Une petite moufle en gomme, de la couleur de la mascotte. side = -1 : main gauche (dessin retourné). */
function drawMitt(ctx: CanvasRenderingContext2D, H: Hand, sx: number, sy: number, R: number, side: number, c: Palette, alpha: number) {
  ctx.save();
  ctx.translate(H.x * R * sx, H.y * R * sy);
  ctx.rotate(H.r);
  ctx.scale(side, 1);
  ctx.globalAlpha = Math.min(1, alpha * 1.2);
  const s = H.s * (0.6 + 0.4 * alpha);
  const W = R * 0.21 * s;
  const Hh = R * 0.18 * s;
  const g = ctx.createRadialGradient(-W * 0.3, -Hh * 0.4, W * 0.1, 0, 0, W * 1.3);
  g.addColorStop(0, css(c[0]));
  g.addColorStop(0.5, css(c[1]));
  g.addColorStop(1, css(c[2]));
  // le pouce
  ctx.save();
  const up = H.thumb;
  ctx.translate(W * (0.55 - 0.4 * up), -Hh * (0.72 + 0.33 * up));
  ctx.rotate(0.6 - 0.8 * up);
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.32, Hh * 0.5, 0, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = R * 0.035;
  ctx.strokeStyle = css(c[3]);
  ctx.stroke();
  ctx.restore();
  // la paume
  ctx.beginPath();
  ctx.ellipse(0, 0, W, Hh, 0, 0, TAU);
  ctx.lineWidth = R * 0.035;
  ctx.strokeStyle = css(c[3]);
  ctx.stroke();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = R * 0.03;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.82, Hh * 0.78, 0, 0.9 * Math.PI, 1.6 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.ellipse(-W * 0.38, -Hh * 0.38, W * 0.2, Hh * 0.12, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * La pancarte « ? » : un petit manche et une planche en bois clair, tenus par
 * la moufle droite (un agent IA attend une réponse ; un clic sur la mascotte
 * ouvre l'onglet Agents IA). Le point d'interrogation se balance un peu.
 */
function drawSign(ctx: CanvasRenderingContext2D, H: Hand, sx: number, sy: number, R: number, alpha: number, t: number) {
  ctx.save();
  ctx.translate(H.x * R * sx, H.y * R * sy);
  ctx.rotate(H.r * 0.5 + Math.sin(t * 1.8) * 0.04);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // le manche, depuis la moufle vers le haut
  ctx.strokeStyle = "#8a5a2b";
  ctx.lineWidth = R * 0.07;
  ctx.beginPath();
  ctx.moveTo(0, R * 0.05);
  ctx.lineTo(0, -R * 0.5);
  ctx.stroke();
  // la planche
  const w = R * 0.62;
  const h = R * 0.5;
  const y = -R * 0.5 - h / 2;
  ctx.fillStyle = "#fff6dc";
  ctx.strokeStyle = "#8a5a2b";
  ctx.lineWidth = R * 0.045;
  ctx.beginPath();
  ctx.roundRect(-w / 2, y - h / 2, w, h, R * 0.08);
  ctx.fill();
  ctx.stroke();
  // le « ? »
  ctx.fillStyle = INK;
  ctx.font = `900 ${R * 0.42}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", 0, y + R * 0.02);
  gloss(ctx, -w * 0.28, y - h * 0.28, R * 0.09, R * 0.035);
  ctx.restore();
}

/** Un parapluie au-dessus de la tête (la Météo annonce la pluie), avec trois gouttes qui rebondissent dessus. */
function drawUmbrella(ctx: CanvasRenderingContext2D, sc: GumScene, R: number) {
  const top = topAt(sc.pts, sc.shape.faceX * 0.6);
  const k = sc.umbrella;
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(top.x * R + R * 0.18, top.y * R - R * (0.22 + 0.25 * k) + Math.sin(sc.t * 1.6) * R * 0.02);
  ctx.rotate(-0.18 + sc.tip * 0.4);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // le manche, qui descend vers son épaule
  ctx.strokeStyle = "#4a3a6a";
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, R * 0.55);
  ctx.quadraticCurveTo(0, R * 0.72, R * 0.12, R * 0.7);
  ctx.stroke();
  // la toile : un dôme festonné, rouge à pois
  const w = R * 0.95;
  const h = R * 0.42;
  ctx.fillStyle = "#ff6b78";
  ctx.strokeStyle = "#9c1530";
  ctx.lineWidth = R * 0.04;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w, -h * 1.3, w, -h * 1.3, w, 0);
  for (let i = 3; i >= -3; i--) {
    const x0 = (i / 3) * w;
    const x1 = ((i - 1) / 3) * w;
    ctx.quadraticCurveTo((x0 + x1) / 2, R * 0.1, x1, 0);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  for (const [px, py, r] of [[-0.5, -0.25, 0.05], [0.1, -0.4, 0.06], [0.55, -0.2, 0.045], [-0.15, -0.12, 0.035]] as const) {
    ctx.beginPath();
    ctx.arc(px * w, py * R, r * R, 0, TAU);
    ctx.fill();
  }
  // la pointe
  ctx.strokeStyle = "#4a3a6a";
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.95);
  ctx.lineTo(0, -h * 1.15);
  ctx.stroke();
  // trois gouttes qui tombent dessus et glissent sur les côtés
  ctx.strokeStyle = "rgba(140, 200, 255, 0.9)";
  ctx.lineWidth = R * 0.045;
  for (let i = 0; i < 3; i++) {
    const ph = (sc.t * 1.3 + i / 3) % 1;
    const x = (-0.6 + i * 0.6) * w;
    const y = -h * 1.5 - R * 0.6 + ph * R * 0.6;
    ctx.globalAlpha = k * (1 - ph * ph);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - R * 0.02, y + R * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Les accessoires ─────────────────────────────────────────────────────────

/** Un petit reflet blanc en biais, pour que les accessoires aient l'air brillants comme la gomme. */
function gloss(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = -0.5) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

/** Chapeau, casquette, bonnet, couronne ou nœud, posés sur le haut de la tête. */
function wearHead(ctx: CanvasRenderingContext2D, sc: GumScene, R: number) {
  const kind = sc.wear.head;
  if (kind === "none") return;
  const top = topAt(sc.pts, sc.shape.faceX * 0.6);
  const x = top.x * R;
  const y = top.y * R + R * 0.06;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sc.tip * 0.6 - 0.12);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const line = R * 0.035;
  switch (kind) {
    case "cap": {
      // Casquette : un dôme et une visière vers la droite.
      ctx.fillStyle = "#ff5a5f";
      ctx.strokeStyle = "#9c1d2a";
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.ellipse(R * 0.32, R * 0.02, R * 0.38, R * 0.08, 0.08, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.42, R * 0.04);
      ctx.bezierCurveTo(-R * 0.42, -R * 0.42, R * 0.4, -R * 0.42, R * 0.4, R * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, -R * 0.3, R * 0.045, 0, TAU);
      ctx.fill();
      gloss(ctx, -R * 0.18, -R * 0.2, R * 0.12, R * 0.05);
      break;
    }
    case "straw": {
      // Chapeau de paille : un grand bord, un ruban rouge.
      ctx.fillStyle = "#f3cf7a";
      ctx.strokeStyle = "#a8781e";
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.7, R * 0.13, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.36, 0);
      ctx.bezierCurveTo(-R * 0.36, -R * 0.42, R * 0.36, -R * 0.42, R * 0.36, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e0484f";
      ctx.fillRect(-R * 0.36, -R * 0.1, R * 0.72, R * 0.08);
      gloss(ctx, -R * 0.14, -R * 0.24, R * 0.1, R * 0.04);
      break;
    }
    case "tophat": {
      // Haut-de-forme, avec un ruban.
      ctx.fillStyle = "#2a2840";
      ctx.strokeStyle = "#0f0e1a";
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.46, R * 0.09, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-R * 0.28, -R * 0.62, R * 0.56, R * 0.62, R * 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#b98cff";
      ctx.fillRect(-R * 0.28, -R * 0.16, R * 0.56, R * 0.08);
      gloss(ctx, -R * 0.14, -R * 0.42, R * 0.05, R * 0.14, 0);
      break;
    }
    case "beanie": {
      // Bonnet à pompon, à rayures.
      ctx.fillStyle = "#4fa3ff";
      ctx.strokeStyle = "#1d5aa8";
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.moveTo(-R * 0.46, R * 0.06);
      ctx.bezierCurveTo(-R * 0.46, -R * 0.5, R * 0.46, -R * 0.5, R * 0.46, R * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(-R * 0.5, -R * 0.04, R * 1.0, R * 0.14, R * 0.07);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -R * 0.42, R * 0.1, 0, TAU);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "crown": {
      ctx.fillStyle = "#ffd84a";
      ctx.strokeStyle = "#a8780a";
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.moveTo(-R * 0.34, R * 0.04);
      ctx.lineTo(-R * 0.38, -R * 0.3);
      ctx.lineTo(-R * 0.17, -R * 0.12);
      ctx.lineTo(0, -R * 0.38);
      ctx.lineTo(R * 0.17, -R * 0.12);
      ctx.lineTo(R * 0.38, -R * 0.3);
      ctx.lineTo(R * 0.34, R * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const [px, col] of [
        [-0.17, "#ff5a8a"],
        [0, "#5cc8ff"],
        [0.17, "#5fe08f"],
      ] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px * R, -R * 0.04, R * 0.045, 0, TAU);
        ctx.fill();
      }
      gloss(ctx, -R * 0.22, -R * 0.14, R * 0.04, R * 0.1, 0.3);
      break;
    }
    case "bow": {
      // Un gros nœud sur le côté de la tête.
      ctx.translate(R * 0.3, R * 0.02);
      ctx.fillStyle = "#ff6fae";
      ctx.strokeStyle = "#b02f6a";
      ctx.lineWidth = line;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(s * R * 0.3, -R * 0.24, s * R * 0.36, R * 0.16, 0, 0);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.07, 0, TAU);
      ctx.fill();
      ctx.stroke();
      gloss(ctx, -R * 0.14, -R * 0.06, R * 0.06, R * 0.03);
      break;
    }
  }
  ctx.restore();
}

/** Lunettes rondes, de soleil ou en cœur, posées sur les yeux. */
function wearEyes(ctx: CanvasRenderingContext2D, sc: GumScene, R: number, fx: number, fy: number) {
  const kind = sc.wear.eyes;
  if (kind === "none") return;
  const S = sc.shape;
  const y = S.eyeY * R + fy;
  const dx = S.eyeDX * R;
  const r = R * 0.22 * S.eyeScale;
  ctx.save();
  ctx.lineWidth = R * 0.045;
  ctx.lineJoin = "round";
  const lens = (x: number) => {
    ctx.beginPath();
    if (kind === "heart") {
      const s = r * 1.1;
      ctx.moveTo(x, y + s * 0.7);
      ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.35);
      ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 1.2, y - s * 0.1, x, y + s * 0.7);
    } else ctx.ellipse(x, y, r, r * (kind === "sun" ? 0.8 : 1), 0, 0, TAU);
  };
  const frame = kind === "round" ? "#2a2840" : kind === "sun" ? "#141320" : "#d6336c";
  for (const side of [-1, 1]) {
    const x = side * dx + fx;
    lens(x);
    ctx.fillStyle = kind === "round" ? "rgba(220, 240, 255, 0.25)" : kind === "sun" ? "rgba(20, 18, 34, 0.92)" : "rgba(255, 80, 140, 0.75)";
    ctx.fill();
    ctx.strokeStyle = frame;
    ctx.stroke();
    if (kind !== "round") gloss(ctx, x - r * 0.35, y - r * 0.3, r * 0.3, r * 0.12);
  }
  // le pont et les branches
  ctx.strokeStyle = frame;
  ctx.beginPath();
  ctx.moveTo(-dx + r + fx, y - r * 0.15);
  ctx.quadraticCurveTo(fx, y - r * 0.5, dx - r + fx, y - r * 0.15);
  ctx.stroke();
  ctx.restore();
}

/** Collier de perles, nœud papillon ou écharpe, sous la bouche. */
function wearNeck(ctx: CanvasRenderingContext2D, sc: GumScene, R: number, fx: number) {
  const kind = sc.wear.neck;
  if (kind === "none") return;
  const S = sc.shape;
  const ny = Math.min(0.74, S.eyeY + S.mouthDY + 0.2);
  const y = ny * R;
  const hw = Math.max(0.3, halfWidthAt(sc.pts, ny) - 0.06) * R;
  ctx.save();
  ctx.lineJoin = "round";
  switch (kind) {
    case "pearls": {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const x = -hw * 0.85 + k * hw * 1.7 + fx * 0.3;
        const py = y + Math.sin(k * Math.PI) * R * 0.1;
        const pr = R * (i === Math.floor(n / 2) ? 0.075 : 0.06);
        const g = ctx.createRadialGradient(x - pr * 0.3, py - pr * 0.3, pr * 0.1, x, py, pr);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#d9cfe6");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, py, pr, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(120, 100, 150, 0.5)";
        ctx.lineWidth = R * 0.015;
        ctx.stroke();
      }
      break;
    }
    case "bowtie": {
      const x = fx * 0.4;
      ctx.translate(x, y);
      ctx.fillStyle = "#e0484f";
      ctx.strokeStyle = "#8f1c25";
      ctx.lineWidth = R * 0.03;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s * R * 0.24, -R * 0.13);
        ctx.quadraticCurveTo(s * R * 0.3, 0, s * R * 0.24, R * 0.13);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.roundRect(-R * 0.06, -R * 0.06, R * 0.12, R * 0.12, R * 0.03);
      ctx.fill();
      ctx.stroke();
      gloss(ctx, -R * 0.12, -R * 0.05, R * 0.05, R * 0.025);
      break;
    }
    case "scarf": {
      ctx.fillStyle = "#ff8f3a";
      ctx.strokeStyle = "#a8500e";
      ctx.lineWidth = R * 0.03;
      ctx.beginPath();
      ctx.moveTo(-hw, y - R * 0.06);
      ctx.quadraticCurveTo(0, y + R * 0.06, hw, y - R * 0.06);
      ctx.lineTo(hw, y + R * 0.08);
      ctx.quadraticCurveTo(0, y + R * 0.22, -hw, y + R * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // le pan qui pend
      ctx.beginPath();
      ctx.roundRect(hw * 0.35, y + R * 0.06, R * 0.14, R * 0.3, R * 0.05);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.beginPath();
      ctx.moveTo(-hw * 0.6, y + R * 0.02);
      ctx.quadraticCurveTo(0, y + R * 0.12, hw * 0.6, y + R * 0.02);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ── La météo autour de la mascotte « Météo » ────────────────────────────────

function drawWeather(ctx: CanvasRenderingContext2D, fx: WeatherFx, cx: number, cy: number, R: number, t: number) {
  if (fx === "none") return;
  ctx.save();
  if (fx === "rain" || fx === "storm") {
    ctx.strokeStyle = "rgba(140, 200, 255, 0.85)";
    ctx.lineWidth = R * 0.05;
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const ph = (t * 1.4 + i / 6) % 1;
      const x = cx + (-0.7 + (i % 3) * 0.7 + (i > 2 ? 0.35 : 0)) * R;
      const y = cy + R * (0.95 + ph * 0.7);
      ctx.globalAlpha = 1 - ph;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - R * 0.04, y + R * 0.14);
      ctx.stroke();
    }
  }
  if (fx === "snow") {
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.5 + i / 7) % 1;
      const x = cx + (-0.9 + (i / 6) * 1.8) * R + Math.sin(t * 2 + i) * R * 0.08;
      const y = cy + R * (0.9 + ph * 0.8);
      ctx.globalAlpha = 1 - ph;
      ctx.beginPath();
      ctx.arc(x, y, R * 0.05, 0, TAU);
      ctx.fill();
    }
  }
  if (fx === "storm" && Math.sin(t * 9) > 0.93) {
    // un petit éclair, de temps en temps
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.moveTo(cx + R * 0.1, cy + R * 0.9);
    ctx.lineTo(cx - R * 0.12, cy + R * 1.25);
    ctx.lineTo(cx + R * 0.02, cy + R * 1.25);
    ctx.lineTo(cx - R * 0.08, cy + R * 1.55);
    ctx.lineTo(cx + R * 0.2, cy + R * 1.15);
    ctx.lineTo(cx + R * 0.06, cy + R * 1.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
