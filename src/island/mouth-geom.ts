// L'île-bouche d'Ondine (réglage island.style = "mouth", 1.2.3) : les calculs,
// sans page ni canvas (testés par tests/front/mouth.test.ts).
//
// Ondine est suspendue tête en bas au bord de l'écran ; l'île noire est sa
// bouche. On part toujours du rectangle de la BOUCHE (l'île elle-même, avec sa
// gelée) et on pose le corps autour :
//
//          bord de l'écran
//   ┌──────────────────────────┐  ← lèvre arrière (côté bord) : `back`
//   │ ┌──────────────────────┐ │
//   │ │       bouche         │ │  ← lèvres de côté : `side`
//   │ └──────────────────────┘ │
//   │        ●        ●       │  ← zone des yeux : `eyeZone`
//   └───────────╲    ╱─────────┘
//                ╲  ╱             ← la pointe de goutte : `tip`
//
// Trois formes de référence (maquette validée par Simon) ; entre elles, tout
// est interpolé d'après l'ouverture `o` (0 = nano, 1 = mini, 2 = ouverte),
// elle-même tirée de l'épaisseur de la bouche : comme l'île suit des ressorts
// (jelly.ts), le corps suit la même gelée sans calcul de plus.
//   nano    bouche 20 × 7    corps 66 × 58    yeux ronds 10 × 13
//   mini    bouche 318 × 40  corps 334 × 76   yeux aplatis 12 × 10, langue
//   ouverte bouche 466 × 208 corps 474 × 224  liseré de 4 px, yeux étirés 14 × 6
// « Volume conservé » : plus la bouche s'ouvre, plus les lèvres s'affinent
// (side, back et eyeZone ne font que diminuer quand `o` grandit).

/** Du côté de la bouche où sont les yeux (à l'opposé du bord de l'écran). */
export type MouthDir = "down" | "up" | "left" | "right";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Les mesures du corps pour une ouverture (px, dans le repère « suspendue en haut »). */
export interface MouthParams {
  side: number;
  back: number;
  eyeZone: number;
  /** Centre des yeux, depuis le bas de la bouche. */
  eyeAt: number;
  eyeW: number;
  eyeH: number;
  /** Écart entre les deux yeux (bord à bord). */
  eyeGap: number;
  tipW: number;
  tipH: number;
  /** Arrondi des coins côté bord, et côté yeux. */
  rBack: number;
  rFront: number;
  /** La langue rose (0 à 1). */
  tongue: number;
}

/** Les trois formes de la maquette. */
export const MOUTH_KEYS: readonly MouthParams[] = [
  // nano : bouche fermée, Ondine à sa taille normale
  { side: 23, back: 11, eyeZone: 40, eyeAt: 14.5, eyeW: 10, eyeH: 13, eyeGap: 13, tipW: 0, tipH: 0, rBack: 6, rFront: 31, tongue: 0 },
  // mini : bouche entrouverte, corps étiré
  { side: 8, back: 6, eyeZone: 30, eyeAt: 13, eyeW: 12, eyeH: 10, eyeGap: 34, tipW: 0, tipH: 0, rBack: 10, rFront: 36, tongue: 1 },
  // ouverte : liseré très fin, yeux étirés en bas
  { side: 4, back: 4, eyeZone: 12, eyeAt: 4.5, eyeW: 14, eyeH: 6, eyeGap: 26, tipW: 0, tipH: 0, rBack: 10, rFront: 31, tongue: 0 },
];

/** L'épaisseur de la bouche (px) qui correspond à chaque forme de référence. */
const THICK = [7, 41, 200];

/** L'ouverture (0 à 2) d'après l'épaisseur de la bouche. */
export function openness(thickness: number): number {
  const t = Number.isFinite(thickness) ? thickness : 0;
  if (t <= THICK[0]) return 0;
  if (t <= THICK[1]) return (t - THICK[0]) / (THICK[1] - THICK[0]);
  if (t <= THICK[2]) return 1 + (t - THICK[1]) / (THICK[2] - THICK[1]);
  return 2;
}

/** Les mesures du corps pour l'ouverture `o` (interpolées entre les trois formes). */
export function paramsAt(o: number): MouthParams {
  const k = Math.max(0, Math.min(2, Number.isFinite(o) ? o : 0));
  const i = Math.min(1, Math.floor(k));
  const f = k - i;
  const a = MOUTH_KEYS[i];
  const b = MOUTH_KEYS[i + 1];
  const out = {} as MouthParams;
  for (const key of Object.keys(a) as (keyof MouthParams)[]) out[key] = a[key] + (b[key] - a[key]) * f;
  return out;
}

/** Le repère local : u le long de la bouche, v en s'éloignant du bord. */
export interface Frame {
  /** Longueur et épaisseur de la bouche dans ce repère. */
  len: number;
  thick: number;
  /** (u, v) local → (x, y) de la fenêtre. */
  map(u: number, v: number): { x: number; y: number };
  /** La matrice du canvas pour dessiner dans le repère local : [a, b, c, d, e, f]. */
  matrix: [number, number, number, number, number, number];
}

/** Le repère local d'une bouche dont les yeux sont du côté `dir`. */
export function frameOf(m: Box, dir: MouthDir): Frame {
  switch (dir) {
    case "up":
      return { len: m.w, thick: m.h, map: (u, v) => ({ x: m.x + u, y: m.y + m.h - v }), matrix: [1, 0, 0, -1, m.x, m.y + m.h] };
    case "right":
      return { len: m.h, thick: m.w, map: (u, v) => ({ x: m.x + v, y: m.y + u }), matrix: [0, 1, 1, 0, m.x, m.y] };
    case "left":
      return { len: m.h, thick: m.w, map: (u, v) => ({ x: m.x + m.w - v, y: m.y + u }), matrix: [0, 1, -1, 0, m.x + m.w, m.y] };
    default:
      return { len: m.w, thick: m.h, map: (u, v) => ({ x: m.x + u, y: m.y + v }), matrix: [1, 0, 0, 1, m.x, m.y] };
  }
}

/** Le corps posé autour d'une bouche, dans le repère local et en coordonnées de la fenêtre. */
export interface MouthLayout {
  dir: MouthDir;
  o: number;
  p: MouthParams;
  frame: Frame;
  /** Le corps dans le repère local (u0, v0, u1, v1), pointe non comprise. */
  local: { u0: number; v0: number; u1: number; v1: number };
  /** Les centres des deux yeux dans le repère local. */
  eyes: [{ u: number; v: number }, { u: number; v: number }];
  /** Le rectangle qui contient tout (corps et pointe), dans la fenêtre. */
  bounds: Box;
}

/** Pose le corps autour de la bouche `m` (yeux du côté `dir`). */
export function layoutMouth(m: Box, dir: MouthDir, oOverride?: number): MouthLayout {
  const frame = frameOf(m, dir);
  const o = oOverride ?? openness(frame.thick);
  const p = paramsAt(o);
  const L = frame.len;
  const T = frame.thick;
  const local = { u0: -p.side, v0: -p.back, u1: L + p.side, v1: T + p.eyeZone };
  const half = p.eyeGap / 2 + p.eyeW / 2;
  const ev = T + p.eyeAt;
  const eyes: MouthLayout["eyes"] = [
    { u: L / 2 - half, v: ev },
    { u: L / 2 + half, v: ev },
  ];
  const corners = [frame.map(local.u0, local.v0), frame.map(local.u1, local.v1 + p.tipH)];
  const bounds = {
    x: Math.min(corners[0].x, corners[1].x),
    y: Math.min(corners[0].y, corners[1].y),
    w: Math.abs(corners[1].x - corners[0].x),
    h: Math.abs(corners[1].y - corners[0].y),
  };
  return { dir, o, p, frame, local, eyes, bounds };
}

/** La direction des yeux pour un bord de l'île : Ondine garde la tête vers le bord. */
export function dirForEdge(edge: string): MouthDir {
  if (edge === "bottom") return "up";
  if (edge === "left") return "right";
  if (edge === "right") return "left";
  return "down";
}

/**
 * Les reflets des yeux suivent la souris : (dx, dy) en px depuis les yeux →
 * décalage du reflet en fraction de l'œil (-0,6 à 0,6 en largeur, -0,4 à 0,4
 * en hauteur), comme la maquette.
 */
export function glintOffset(dx: number, dy: number): { x: number; y: number } {
  const c = (v: number) => Math.max(-1, Math.min(1, (Number.isFinite(v) ? v : 0) / 200));
  return { x: c(dx) * 0.6, y: c(dy) * 0.4 };
}

/** Dans le repère local, la direction (dx, dy) de la fenêtre (pour les reflets d'un corps tourné). */
export function toLocal(dir: MouthDir, dx: number, dy: number): { x: number; y: number } {
  if (dir === "up") return { x: dx, y: -dy };
  if (dir === "right") return { x: dy, y: dx };
  if (dir === "left") return { x: dy, y: -dx };
  return { x: dx, y: dy };
}

// ── Ondine qui somnole dans l'encoche (idée 2) ───────────────────────────────

/** La souris plus près que ça (px) : elle ouvre un œil. */
export const PEEK_EYE_PX = 140;

/**
 * L'ouverture de chaque œil (0 fermé, 1 ouvert) : éveillée, les deux ; elle
 * somnole, aucun, sauf si la souris approche : un seul (le plus proche).
 */
export function eyeOpenness(dozing: boolean, distance: number, mouseOnLeft: boolean): [number, number] {
  if (!dozing) return [1, 1];
  if (!(distance <= PEEK_EYE_PX)) return [0, 0];
  return mouseOnLeft ? [1, 0] : [0, 1];
}

/** La distance (px) d'un point à un rectangle (0 dedans). */
export function distanceTo(b: Box, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

// ── Les points d'état autour de l'encoche (idée 3) ───────────────────────────

export type DotKind = "music" | "agent" | "timer" | "voice";

/** La couleur de chaque point (gommes de gum-draw.ts : vert, violet, or, rose). */
export const DOT_COLORS: Record<DotKind, string> = {
  music: "#5fe08f",
  agent: "#b98cff",
  timer: "#ffd24a",
  voice: "#ff9cc6",
};

/** Les points à montrer, dans un ordre fixe (au plus trois). */
export function nanoDots(status: Partial<Record<DotKind, boolean>>): DotKind[] {
  return (["music", "agent", "timer", "voice"] as DotKind[]).filter((k) => status[k]).slice(0, 3);
}

/**
 * La place de chaque point autour de l'encoche : en colonne à droite de
 * l'encoche (à gauche si l'île est collée au bord droit de l'écran), espacés
 * de 10 px, en px depuis le coin de l'encoche. Sur un côté de l'écran, en ligne
 * sous l'encoche.
 */
export function dotPlaces(n: number, notch: { w: number; h: number }, edge: string, align: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const side = edge === "left" || edge === "right";
  for (let i = 0; i < n; i++) {
    if (side) {
      const x = edge === "left" ? notch.w - 10 - i * 10 : 3 + i * 10;
      out.push({ x, y: notch.h + 6 });
    } else {
      const left = align === "end";
      const y = edge === "bottom" ? notch.h - 10 - i * 10 : 3 + i * 10;
      out.push({ x: left ? -12 : notch.w + 5, y });
    }
  }
  return out;
}
