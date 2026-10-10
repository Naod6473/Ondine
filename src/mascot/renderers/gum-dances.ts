// Les danses de la famille « gomme », une par style de musique (src/mascot/beat.ts) :
// rock, metal, rap, RnB, pop, électro, reggae, jazz et chill, et le simple
// hochement (Calme, animations réduites). Les 15 mascottes les partagent,
// adaptées à leur forme comme le reste (les mains se posent au bord du corps,
// les sauts suivent la hauteur de saut de la forme).
//
// Le temps : pour une danse, le moteur (gum-engine.ts) ne donne pas des
// secondes mais le compte des temps de la musique divisé par 2 (t = b / 2) :
// à 120 BPM c'est la même chose, à 90 BPM tout va plus lentement, et les
// temps tombent sur les nombres entiers de b (b = 2t). Les mouvements « sur le
// temps » (la tête qui tombe, le pied qui frappe) sont donc calés sur la
// musique mesurée.
//
// Rien ici ne dessine : la guitare, les cornes, la casquette, les claquements
// sont des accessoires (`prop`, `Hand.horns`) dessinés par gum-draw.ts.
// Testé dans tests/front/dance.test.ts.

import type { Mood } from "../types";
import type { Frame } from "./gum-anims";
import type { Hand } from "./gum-draw";
import { halfWidthAt, type GumShape } from "./gum-shapes";

const TAU = Math.PI * 2;

/** Les poses des mains propres aux danses. */
export type DanceHandPose = "guitar" | "horns" | "snap" | "clap" | "pump" | "skank" | "chill";

/** La part d'un temps écoulée (0 sur le temps, presque 1 juste avant le suivant). */
const frac = (b: number) => b - Math.floor(b);
/** Un coup sur le temps : 1 pile sur le temps, retombe vite. */
const hit = (b: number, sharp = 6) => Math.exp(-frac(b) * sharp);
/** Bas sur le temps, haut entre deux (0 à 1, 1 = en bas). */
const down = (b: number) => 0.5 + 0.5 * Math.cos(TAU * b);

export const DANCES: Record<string, (t: number, p: number, mood: Mood) => Frame> = {
  // Rock : la tête hoche sur chaque temps, air guitar (une main sur le manche,
  // l'autre gratte en croches), elle se cambre en arrière tous les 4 temps.
  "danse-rock": (t) => {
    const b = t * 2;
    const nod = hit(b, 5);
    const arch = Math.max(0, Math.sin((b / 4) * TAU)) ** 3;
    return {
      face: { eyeOpen: 0, eyeCurve: 0.9, browA: 1, browTilt: 0.45, mouthW: 0.8, mouthO: 0.35 + 0.35 * nod, mouthC: 0.2, blush: 0.8 },
      hands: "guitar",
      prop: { guitar: 1 },
      squash: 1 - nod * 0.07 + arch * 0.04,
      dy: nod * 0.04,
      rot: -0.12 * arch + Math.sin(b * Math.PI) * 0.04,
      gaze: { x: 0.1, y: 0.25 + nod * 0.5 },
      blink: false,
    };
  },
  // Metal : headbang (la tête tombe fort sur chaque temps), les cornes avec les deux mains.
  "danse-metal": (t) => {
    const b = t * 2;
    const bang = hit(b, 4);
    return {
      face: { eyeOpen: 0, eyeCurve: -0.4, browA: 1, browTilt: 0.9, mouthW: 0.85, mouthO: 0.55 + 0.35 * bang, mouthC: -0.1, blush: 0.6 },
      hands: "horns",
      squash: 1 - bang * 0.16,
      dy: bang * 0.08,
      rot: Math.sin(b * Math.PI) * 0.07,
      gaze: { x: 0, y: 0.2 + bang * 0.8 },
      tip: bang * 0.6,
      blink: false,
    };
  },
  // Rap : rebond sur les genoux à chaque temps, bras croisés, casquette, la tête qui balance.
  "danse-rap": (t) => {
    const b = t * 2;
    const knee = down(b);
    return {
      face: { eyeOpen: 0.75, lid: 0.45, browA: 0.6, browTilt: 0.3, mouthW: 0.85, mouthC: 0.45, skew: 0.6, blush: 0.5 },
      hands: "crossed",
      prop: { cap: 1 },
      squash: 1 - knee * 0.09,
      dy: knee * 0.035,
      rot: Math.sin((b / 2) * TAU) * 0.06,
      gaze: { x: Math.sin((b / 2) * TAU) * 0.4, y: 0.15 },
    };
  },
  // RnB : balancement lent sur deux temps, claquements de doigts sur les temps 2 et 4, yeux fermés.
  "danse-rnb": (t) => {
    const b = t * 2;
    const sway = Math.sin((b / 2) * Math.PI);
    const snap = Math.floor(b) % 2 === 1 ? hit(b, 9) : 0;
    return {
      face: { eyeOpen: 0, eyeCurve: 0.8, mouthW: 0.75, mouthC: 0.65, skew: 0.25 * sway, blush: 0.9 },
      hands: "snap",
      prop: { snap },
      squash: 1 - down(b) * 0.03,
      dx: sway * 0.06,
      rot: sway * 0.1,
      gaze: { x: sway * 0.3, y: -0.1 },
      blink: false,
    };
  },
  // Pop : un petit pas de côté par temps (gauche, droite), un clap tous les deux temps, grand sourire.
  "danse-pop": (t) => {
    const b = t * 2;
    const side = Math.sin((b / 2) * TAU + Math.PI / 2) * -1;
    const step = Math.abs(Math.sin(b * Math.PI));
    const clap = Math.floor(b) % 2 === 1 ? hit(b, 8) : 0;
    return {
      face: { mouthO: 0.35 + 0.25 * clap, mouthW: 1.1, mouthC: 0.9, eyeOpen: 0.9, blush: 1, pupil: 1.2 },
      hands: "clap",
      prop: { clap },
      dx: side * 0.12,
      dy: -step * 0.05,
      squash: 1 - (1 - step) * 0.05,
      rot: side * -0.06,
      gaze: { x: side * 0.5, y: -0.1 },
      blink: false,
    };
  },
  // Électro : bras en l'air qui pompent sur le temps, petits sauts (le halo flashe sur le temps, src/modules/halos/).
  "danse-electro": (t) => {
    const b = t * 2;
    const pump = hit(b, 5);
    return {
      face: { eyeOpen: 0, eyeCurve: 1, mouthO: 0.5 + 0.3 * pump, mouthW: 1, mouthC: 0.9, blush: 1.1 },
      hands: "pump",
      dy: -Math.abs(Math.sin(b * Math.PI)) * 0.07,
      squash: 1 - pump * 0.1,
      rot: Math.sin((b / 2) * TAU) * 0.05,
      gaze: { x: 0, y: -0.6 },
      extra: "sparkles",
      blink: false,
    };
  },
  // Reggae : balancement décontracté sur deux temps, petit rebond sur le contretemps, paupières lourdes.
  "danse-reggae": (t) => {
    const b = t * 2;
    const sway = Math.sin((b / 2) * Math.PI);
    const off = hit(b + 0.5, 6);
    return {
      face: { eyeOpen: 0.65, lid: 0.55, mouthW: 0.95, mouthC: 0.75, blush: 0.7 },
      hands: "skank",
      dx: sway * 0.08,
      rot: sway * 0.13,
      dy: -off * 0.03,
      squash: 1 - off * 0.03,
      gaze: { x: sway * 0.2, y: 0.05 },
    };
  },
  // Jazz et chill : ondulation douce sur quatre temps, yeux mi-clos, petit sourire.
  "danse-jazz": (t) => {
    const b = t * 2;
    const wave = Math.sin((b / 4) * TAU);
    return {
      face: { eyeOpen: 0.55, lid: 0.6, eyeCurve: 0.5, mouthW: 0.7, mouthC: 0.55, blush: 0.6 },
      hands: "chill",
      squash: 1 + wave * 0.035,
      rot: Math.sin((b / 4) * TAU + 1) * 0.07,
      dx: Math.sin((b / 4) * TAU + 1) * 0.03,
      gaze: { x: Math.sin((b / 8) * TAU) * 0.3, y: 0.1 },
      tip: 0.3 + 0.2 * wave,
    };
  },
  // Le simple hochement (Calme, animations réduites) : la tête approuve sur chaque temps, rien d'autre.
  "danse-hochement": (t) => {
    const b = t * 2;
    const nod = hit(b, 4);
    return {
      face: { mouthW: 0.8, mouthC: 0.6, blush: 0.6, eyeOpen: 0.9 },
      squash: 1 - nod * 0.03,
      dy: nod * 0.015,
      gaze: { x: 0, y: 0.1 + nod * 0.35 },
    };
  },
};

/** Les poses des mains des danses (t = temps de la danse, voir plus haut ; S = la forme). */
export const DANCE_HANDS: Record<DanceHandPose, (t: number, p: number, S: GumShape) => [Partial<Hand>, Partial<Hand>]> = {
  // Air guitar : la gauche tient le manche (loin, un peu haut), la droite gratte en croches.
  guitar: (t, _p, S) => {
    const b = t * 2;
    const w = halfWidthAt(S.pts, 0.45);
    const strum = Math.sin(TAU * b * 2) * 0.07;
    const slide = Math.sin((b / 4) * TAU) * 0.05;
    return [
      { x: -w - 0.1 + slide, y: 0.02 - slide, r: 0.6, s: 0.95 },
      { x: w * 0.45, y: 0.58 + strum, r: -0.5 + strum * 2 },
    ];
  },
  // Les cornes : les deux mains levées près de la tête, qui pompent sur le temps.
  horns: (t, _p, S) => {
    const b = t * 2;
    const w = halfWidthAt(S.pts, S.eyeY);
    const pump = Math.exp(-frac(b) * 5) * 0.09;
    return [
      { x: -w - 0.2, y: S.eyeY - 0.5 + pump, r: 0.25, horns: 1 },
      { x: w + 0.2, y: S.eyeY - 0.5 + pump, r: -0.25, horns: 1 },
    ];
  },
  // Claquements de doigts : les mains de chaque côté, la droite claque sur les temps 2 et 4, la gauche sur 1 et 3 (plus doux).
  snap: (t, _p, S) => {
    const b = t * 2;
    const w = halfWidthAt(S.pts, 0.15);
    const k = Math.floor(b) % 2;
    const flick = Math.exp(-frac(b) * 9);
    const sway = Math.sin((b / 2) * Math.PI) * 0.05;
    return [
      { x: -w - 0.2 + sway, y: 0.12 - (k === 0 ? flick * 0.05 : 0), r: 0.6, thumb: k === 0 ? flick * 0.6 : 0 },
      { x: w + 0.2 + sway, y: 0.12 - (k === 1 ? flick * 0.08 : 0), r: -0.6, thumb: k === 1 ? flick : 0 },
    ];
  },
  // Clap : les mains se rejoignent devant elle tous les deux temps.
  clap: (t, _p, S) => {
    const b = t * 2;
    // Fermées sur les temps impairs (2 et 4), ouvertes entre deux.
    const ph = (b + 1) / 2;
    const open = Math.min(1, Math.abs(Math.sin(ph * Math.PI)) * 1.3);
    const sep = 0.1 + 0.5 * open;
    const y = S.eyeY + 0.78 - open * 0.05;
    return [
      { x: S.faceX - sep, y, r: 1.2 - open * 0.5 },
      { x: S.faceX + sep, y, r: -1.2 + open * 0.5 },
    ];
  },
  // Bras en l'air : ils pompent sur le temps, l'un un peu après l'autre.
  pump: (t) => {
    const b = t * 2;
    const a = Math.exp(-frac(b) * 5) * 0.14;
    const c = Math.exp(-frac(b + 0.12) * 5) * 0.14;
    return [
      { x: -0.72 - Math.sin(b * Math.PI) * 0.06, y: -1.0 - a, r: 2.4 },
      { x: 0.72 + Math.sin(b * Math.PI) * 0.06, y: -1.0 - c, r: -2.4 },
    ];
  },
  // Reggae : les mains souples à hauteur de taille, qui balancent à l'opposé du corps.
  skank: (t, _p, S) => {
    const b = t * 2;
    const w = halfWidthAt(S.pts, 0.4);
    const sw = Math.sin((b / 2) * Math.PI);
    const off = Math.exp(-frac(b + 0.5) * 6) * 0.06;
    return [
      { x: -w - 0.14 - sw * 0.06, y: 0.38 - off, r: -0.5 + sw * 0.3 },
      { x: w + 0.14 - sw * 0.06, y: 0.38 - off, r: 0.5 + sw * 0.3 },
    ];
  },
  // Chill : les mains basses, qui ondulent lentement.
  chill: (t, _p, S) => {
    const b = t * 2;
    const w = halfWidthAt(S.pts, 0.55);
    const s = Math.sin((b / 4) * TAU) * 0.05;
    return [
      { x: -w - 0.06, y: 0.5 + s, r: -0.4 + s },
      { x: w + 0.06, y: 0.5 - s, r: 0.4 + s },
    ];
  },
};
