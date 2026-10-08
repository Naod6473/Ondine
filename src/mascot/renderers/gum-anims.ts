// Les animations de la famille « gomme » : ce que chaque animation demande à
// chaque instant (yeux, bouche, mains, sauts…), et les petits calculs du
// mouvement (la gelée du contour, la forme de la mascotte Météo). Rien ici ne
// dessine ni ne dépend de la fenêtre : tout est testé dans tests/front/gum.test.ts.
// Le moteur qui s'en sert : gum.ts.

import type { Mood, Overlay } from "../types";
import { FACE_BASE, type EyeKind, type Face, type GumTint, type Hand, type WeatherFx } from "./gum-draw";
import { halfWidthAt, N, type GumShape, type ShapeId } from "./gum-shapes";

const TAU = Math.PI * 2;

type LegacyEyes = "open" | "wide" | "happy" | "closed" | "half" | "spiral" | "heart" | "x";
type LegacyMouth = "none" | "smile" | "flat" | "o" | "open" | "frown" | "wavy";
type LegacyBrows = "none" | "angry" | "worried" | "raised";

/** Les poses des mains (voir HANDS). */
export type HandPose =
  | "rest"
  | "wave"
  | "cheer"
  | "think"
  | "type"
  | "cheeks"
  | "fists"
  | "hips"
  | "crossed"
  | "stretch"
  | "clasp"
  | "heart"
  | "belly"
  | "mouth"
  | "flail"
  | "rub"
  | "ears"
  | "sign";

/**
 * Ce qu'une animation décrit pour un instant. Les premiers champs sont ceux de
 * la goutte gomme d'origine (des « dessins » de yeux et de bouche), traduits en
 * réglages chiffrés par faceOf() ; `face` règle directement le visage.
 */
export type Frame = {
  tint?: GumTint;
  squash?: number;
  rot?: number;
  dx?: number;
  dy?: number;
  eyes?: LegacyEyes;
  eyeOpen?: number;
  brows?: LegacyBrows;
  mouth?: LegacyMouth;
  mouthOpen?: number;
  blush?: number;
  extra?: Overlay;
  tintTo?: GumTint;
  tintK?: number;
  bubble?: number;
  tears?: number;
  wink?: boolean;
  /** Regard imposé (-1 à 1) ; absent = suit la souris. */
  gaze?: { x: number; y: number };
  /** Clignement automatique permis (par défaut oui, pour les yeux ouverts). */
  blink?: boolean;
  /** Réglages du visage, par-dessus ceux déduits des champs ci-dessus. */
  face?: Partial<Face>;
  /** Yeux spéciaux (étoiles, plissés…). */
  kind?: EyeKind;
  /** La pose des mains (sinon celle de HAND_FOR). */
  hands?: HandPose;
  /** La pointe qui se plie (0 à 1). */
  tip?: number;
};

// Petits outils de mouvement. t = secondes, p = progression de 0 à 1.
const breathe = (t: number, period = 3.2, amount = 0.025) => 1 + Math.sin((t / period) * TAU) * amount;
/** Sauts : 0 au sol, négatif en l'air (en fraction du rayon). */
const hops = (p: number, n: number, height: number) => -Math.abs(Math.sin(p * Math.PI * n)) * height;
/** Monte de 0 à 1 entre a et b. */
const ramp = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
/** Tremblement rapide qui s'éteint. */
const shake = (t: number, p: number, amount: number) => Math.sin(t * 48) * amount * (1 - p);

export const ANIMS: Record<string, (t: number, p: number, mood: Mood) => Frame> = {
  idle: (t, _p, mood) => ({
    squash: breathe(t),
    mouth: mood === "happy" ? "open" : mood === "grumpy" ? "flat" : mood === "tired" ? "flat" : "smile",
    mouthOpen: 0.5,
    brows: mood === "grumpy" ? "angry" : "none",
    eyes: mood === "tired" ? "half" : mood === "happy" ? "happy" : "open",
  }),
  wake: (_t, p) => ({
    eyes: p < 0.35 ? "closed" : "open",
    eyeOpen: p < 0.35 ? 1 : Math.min(1, (p - 0.35) * 3),
    squash: 1 + Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.12,
    mouth: p > 0.1 && p < 0.6 ? "o" : "smile",
    mouthOpen: 1,
    blink: false,
    hands: p > 0.1 && p < 0.6 ? "stretch" : "rest",
  }),
  sleep: (t) => ({
    eyes: "closed",
    mouth: "o",
    mouthOpen: 0.2 + 0.15 * Math.sin(t * 2),
    squash: breathe(t, 4, 0.05) * 0.96,
    extra: "zzz",
    gaze: { x: 0, y: 0.4 },
    blink: false,
  }),
  // L'ennui : elle fait une bulle de chewing-gum qui grossit… et éclate.
  bored: (_t, p) => {
    const b = p < 0.7 ? ramp(p, 0.1, 0.7) : 0;
    const popped = p >= 0.7 && p < 0.8;
    return {
      eyes: popped ? "closed" : "half",
      mouth: b > 0 ? "o" : popped ? "open" : "flat",
      mouthOpen: popped ? 0.5 : 0.2,
      bubble: b,
      squash: popped ? 0.92 : 1 + b * 0.03,
      gaze: { x: 0.2, y: 0.1 },
    };
  },
  happy: (_t, p) => ({ dy: hops(p, 2, 0.18), squash: 1 + Math.sin(p * TAU * 2) * 0.06, eyes: "happy", mouth: "open", mouthOpen: 0.7, blush: 1 }),
  // La colère monte : elle rougit peu à peu, tremble, fume.
  annoyed: (t, p) => ({
    tintTo: "red",
    tintK: ramp(p, 0, 0.5),
    brows: "angry",
    eyes: "half",
    mouth: p > 0.5 ? "open" : "frown",
    mouthOpen: 0.35,
    dx: shake(t, 0, 0.04) * ramp(p, 0.3, 0.5) * (1 - ramp(p, 0.85, 1)),
    squash: 1 - ramp(p, 0, 0.5) * 0.06,
    extra: p > 0.4 ? "steam" : "none",
  }),
  dizzy: (t, p) => ({ eyes: "spiral", rot: Math.sin(t * 7) * 0.2 * (1 - p * 0.5), squash: 0.88 + Math.sin(t * 9) * 0.05, mouth: "wavy", extra: "stars", blink: false }),
  thinking: (t) => ({ squash: breathe(t, 2.4, 0.02), gaze: { x: 0.6, y: -0.8 }, mouth: "flat", extra: "dots", rot: 0.06, tip: 0.6 }),
  working: (t) => ({ dy: -Math.abs(Math.sin(t * 6)) * 0.04, brows: "worried", gaze: { x: 0, y: 0.6 }, mouth: "flat", extra: "sweat" }),
  alert: (t) => ({ tint: "yellow", eyes: "wide", mouth: "o", mouthOpen: 0.8, extra: "bang", squash: 1 + Math.abs(Math.sin(t * 6)) * 0.06, gaze: { x: 0, y: 0 }, blink: false }),
  eating: (_t, p) => ({
    mouth: "open",
    mouthOpen: p < 0.75 ? 0.15 + Math.abs(Math.sin(p * Math.PI * 5)) * 0.8 : 0.2,
    eyes: p < 0.75 ? "closed" : "happy",
    squash: 1 - Math.abs(Math.sin(p * Math.PI * 5)) * 0.05,
    blush: 0.9,
    blink: false,
  }),
  celebrate: (_t, p) => ({ dy: hops(p, 3, 0.28), rot: Math.sin(p * TAU * 1.5) * 0.18, eyes: "happy", mouth: "open", mouthOpen: 0.8, extra: "confetti", blush: 1 }),
  love: (t) => ({ tint: "pink", eyes: "heart", blush: 1, mouth: "smile", rot: Math.sin(t * 2.5) * 0.08, extra: "hearts", blink: false }),
  // Réussite : elle verdit, se tasse, puis saute.
  success: (_t, p) => ({
    tintTo: "green",
    tintK: ramp(p, 0, 0.25) * (1 - ramp(p, 0.85, 1)),
    squash: p < 0.2 ? 1 - ramp(p, 0, 0.2) * 0.15 : 1,
    dy: p >= 0.2 ? hops(ramp(p, 0.2, 0.8), 1, 0.35) : 0,
    eyes: "happy",
    mouth: "open",
    mouthOpen: 0.8,
    blush: 1,
    extra: p > 0.3 ? "check" : "none",
  }),
  question: (t) => ({ tint: "violet", brows: "raised", mouth: "o", mouthOpen: 0.4, rot: 0.14 + Math.sin(t * 2) * 0.04, gaze: { x: 0.5, y: -0.7 }, extra: "question", tip: 0.4 }),
  // Erreur : rouge, yeux en croix, petits sursauts.
  error: (t, p) => ({
    tint: "red",
    eyes: p < 0.15 ? "wide" : "x",
    mouth: "wavy",
    dx: Math.sin(t * 60) * 0.035 * (1 - ramp(p, 0.6, 1)),
    squash: 1 - Math.abs(Math.sin(t * 20)) * 0.04,
    blink: false,
  }),
  warning: (t) => ({ tint: "yellow", eyes: "wide", brows: "worried", mouth: "flat", extra: "bang", squash: 1 + Math.abs(Math.sin(t * 5)) * 0.05, blink: false }),
  info: (_t, p) => ({ dy: hops(p, 1, 0.1), mouth: "smile", brows: "raised", gaze: { x: 0.3, y: -0.2 } }),
  sad: (_t, p) => ({ brows: "worried", eyes: p > 0.3 ? "closed" : "open", mouth: p > 0.3 ? "open" : "frown", mouthOpen: 0.3, tears: ramp(p, 0.3, 0.9), squash: 0.95 - Math.sin(p * Math.PI * 6) * 0.02 * ramp(p, 0.3, 1), blink: false }),
  worried: (t) => ({ brows: "worried", mouth: "wavy", rot: Math.sin(t * 2.2) * 0.06, extra: "sweat", gaze: { x: -0.3, y: 0.2 } }),
  // Surprise : choc électrique, elle s'étire d'un coup et vire au jaune par flashs.
  surprise: (t, p) => ({
    tint: Math.sin(t * 14) > 0.2 && p < 0.6 ? "yellow" : undefined,
    eyes: "wide",
    brows: "raised",
    mouth: "o",
    mouthOpen: 1,
    squash: p < 0.15 ? 1.18 : 1,
    dx: Math.sin(t * 50) * 0.02 * (1 - p),
    blink: false,
  }),
  shy: (t) => ({ eyes: "happy", blush: 1.4, mouth: "smile", rot: Math.sin(t * 2) * 0.05, gaze: { x: -0.5, y: 0.5 } }),
  calm: (t) => ({ eyes: "closed", mouth: "smile", squash: breathe(t, 4.5, 0.035), blink: false }),
  wink: (_t, p) => ({ wink: p > 0.15 && p < 0.85, dy: hops(p, 1, 0.08), mouth: "smile", blush: 1, extra: "stars" }),
  fatigue: (t, p) => ({ eyes: "half", mouth: "flat", squash: 0.97 - Math.max(0, Math.sin(p * TAU)) * 0.05 + (breathe(t) - 1), gaze: { x: 0, y: 0.4 } }),
  "agacee-colere": (t, p) => ({ tintTo: "red", tintK: ramp(p, 0.3, 0.6), brows: "angry", eyes: "half", mouth: p < 0.4 ? "flat" : "frown", dx: shake(t, p, 0.04), extra: "steam" }),
  etourdie: (t) => ({ eyes: "spiral", rot: Math.sin(t * 5) * 0.22, mouth: "wavy", extra: "stars", blink: false }),
  "mange-vite": (_t, p) => ({ mouth: "open", mouthOpen: p < 0.85 ? Math.abs(Math.sin(p * Math.PI * 9)) : 0.6, eyes: p < 0.85 ? "open" : "happy", blush: 0.9 }),
  victoire: (_t, p) => ({ dy: hops(p, 2, 0.32), eyes: "happy", mouth: "open", mouthOpen: 1, blush: 1, extra: "confetti", rot: Math.sin(p * TAU * 2) * 0.1 }),
  oups: (_t, p) => ({ eyes: p < 0.5 ? "wide" : "x", brows: "worried", mouth: "wavy", dx: -0.08 * Math.sin(Math.min(1, p * 3) * Math.PI), extra: "sweat", blink: false }),
  attention: (t) => ({ tint: "yellow", eyes: "wide", mouth: "o", mouthOpen: 0.6, extra: "bang", squash: 1 + Math.abs(Math.sin(t * 5)) * 0.05, blink: false }),
  surpris: (_t, p) => ({ eyes: "wide", brows: "raised", mouth: "o", mouthOpen: 1, dx: -0.06 * Math.sin(Math.min(1, p * 3) * Math.PI), squash: p < 0.12 ? 1.15 : 1, blink: false }),

  // ── Les nouvelles expressions ──
  // Coucou : un clin d'œil et une main qui salue.
  coucou: (t, p) => ({ face: { mouthO: 0.45, mouthC: 0.8, blush: 0.9, winkR: p > 0.2 && p < 0.7 ? 1 : 0 }, hands: "wave", squash: breathe(t), rot: Math.sin(t * 3) * 0.05 }),
  // Rire aux larmes : yeux plissés, larmes qui volent, elle se tient le ventre.
  rire: (t) => ({ kind: "squint", face: { mouthO: 1, mouthW: 1.3, mouthC: 0.9, blush: 1.2, flyTears: 1 }, hands: "belly", squash: 1 + Math.sin(t * 18) * 0.035, rot: Math.sin(t * 9) * 0.05, dy: -Math.abs(Math.sin(t * 9)) * 0.03, blink: false }),
  // Fière : yeux fermés, menton levé, sourire en coin, mains sur les hanches.
  fiere: (t) => ({ face: { eyeOpen: 0, eyeCurve: 0.9, mouthC: 0.5, skew: 0.7, mouthW: 0.9, blush: 0.8, browA: 1, browRaise: 0.5 }, gaze: { x: 0.2, y: -0.5 }, hands: "hips", extra: "sparkles", squash: 1.04 + Math.sin(t * 2) * 0.012, rot: -0.06, blink: false }),
  // Boudeuse : joues gonflées, regard ailleurs, bras croisés.
  boude: (t) => ({ face: { eyeOpen: 0.6, lid: 0.25, mouthW: 0.5, mouthC: -0.5, browA: 1, browTilt: 0.45, puff: 1, blush: 1 }, gaze: { x: -0.9, y: 0.1 }, hands: "crossed", squash: 0.97 + Math.sin(t * 1.7) * 0.012, rot: -0.07 }),
  // Étoiles plein les yeux : mains jointes, elle flotte un peu.
  etoiles: (t) => ({ kind: "star", face: { mouthO: 0.6, mouthC: 0.7, mouthW: 0.9, blush: 1 }, hands: "clasp", extra: "sparkles", dy: -0.05 - Math.sin(t * 2.4) * 0.04, squash: breathe(t, 1.2, 0.02), blink: false }),
  // Malicieuse : un sourcil levé, bouche en « ω », elle se frotte les mains.
  malice: (t) => ({ face: { eyeOpen: 0.6, lid: 0.35, cat: 1, browA: 1, browAsym: 1, blush: 0.7 }, gaze: { x: 0.7, y: 0 }, hands: "rub", squash: breathe(t, 2, 0.02), rot: 0.06 + Math.sin(t * 1.4) * 0.03 }),
  // Concentrée : la langue au coin des lèvres, au clavier.
  concentree: (t) => ({ face: { eyeOpen: 0.75, mouthW: 0.75, mouthC: 0.1, tongueSide: 1, browA: 1, browTilt: 0.3 }, gaze: { x: 0, y: 0.75 }, hands: "type", dy: -Math.abs(Math.sin(t * 7.5)) * 0.02 }),
  // Émue : grands yeux brillants qui se mouillent, une main devant la bouche.
  emue: (t) => ({ face: { eyeSize: 1.22, teary: 1, mouthW: 0.7, mouthC: 0.3 + Math.sin(t * 9) * 0.12, browA: 1, browTilt: -0.55, blush: 1 }, hands: "mouth", squash: 1 + Math.sin(t * 7) * 0.012 }),
  // Gênée : elle rougit, se cache les joues, une goutte de sueur.
  genee: (t) => ({ face: { eyeOpen: 0, eyeCurve: 1, blush: 1.6, lines: 1, mouthW: 0.7, mouthC: 0.4 }, hands: "cheeks", extra: "sweat", rot: Math.sin(t * 2.4) * 0.09, squash: breathe(t, 2, 0.02) }),
  // Danse (de la musique en mini-île, src/eggs/) : elle rebondit à 120 battements
  // par minute, se balance, et lève les moufles un coup sur deux.
  danse: (t) => {
    const beat = t * Math.PI * 4;
    const hop = Math.abs(Math.sin(beat / 2));
    return {
      face: { mouthO: 0.3, mouthW: 1.1, mouthC: 0.9, eyeOpen: 0.85, blush: 0.8 },
      hands: Math.sin(beat / 4) > 0 ? "cheer" : "flail",
      squash: 1 - hop * 0.08,
      dy: -hop * 0.06,
      rot: Math.sin(beat / 2) * 0.12,
      gaze: { x: Math.sin(beat / 2) * 0.5, y: -0.2 },
      blink: false,
    };
  },
  // Bâille : elle s'étire bras en l'air et ouvre grand la bouche.
  baille: (_t, p) => {
    const y = Math.sin(ramp(p, 0.15, 0.75) * Math.PI);
    return {
      face: { eyeOpen: p < 0.12 || p > 0.85 ? 0.6 : 0, eyeCurve: -0.7, lid: 0.3, mouthO: y, mouthW: 1 - y * 0.3, mouthC: y > 0.1 ? 0 : 0.3, tears: y * 0.25 },
      hands: p > 0.15 && p < 0.8 ? "stretch" : "rest",
      squash: 1 + y * 0.16,
      blink: false,
    };
  },
  // Pensive : main au menton, regard en l'air, la pointe qui se plie.
  pensive: (t) => ({ face: { mouthW: 0.6, mouthC: 0, browA: 1, browRaise: 0.4, browAsym: 0.4 }, tip: 1, gaze: { x: 0.65, y: -0.8 }, hands: "think", extra: "dots", squash: breathe(t, 2.4, 0.02), rot: 0.07 }),
  // Bras levés : la victoire, les deux mains en l'air.
  "bras-leves": (_t, p) => ({ face: { eyeOpen: 0, eyeCurve: 1, mouthO: 1, mouthC: 0.9, blush: 1 }, hands: "cheer", extra: "confetti", dy: hops(p, 3, 0.28), rot: Math.sin(p * TAU * 2) * 0.08 }),
};

/** La pose des mains de chaque animation (absente : au repos). */
export const HAND_FOR: Record<string, HandPose> = {
  happy: "cheer",
  celebrate: "cheer",
  victoire: "cheer",
  success: "cheer",
  working: "type",
  thinking: "think",
  question: "think",
  love: "heart",
  shy: "cheeks",
  surprise: "cheeks",
  surpris: "cheeks",
  alert: "cheeks",
  warning: "cheeks",
  error: "cheeks",
  oups: "cheeks",
  attention: "cheeks",
  annoyed: "fists",
  "agacee-colere": "fists",
  dizzy: "flail",
  etourdie: "flail",
  eating: "mouth",
  "mange-vite": "mouth",
  worried: "clasp",
  calm: "clasp",
  wink: "wave",
};

/**
 * Les poses des mains, en unités de rayon autour du centre du corps. S = la
 * forme (pour poser les mains au bord du corps, sous les joues…).
 */
export const HANDS: Record<HandPose, (t: number, p: number, S: GumShape) => [Partial<Hand>, Partial<Hand>]> = {
  rest: (t, _p, S) => {
    const b = Math.sin(t * 2.1) * 0.025;
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55 + b, r: -0.35 }, { x: w + 0.04, y: 0.55 - b, r: 0.35 }];
  },
  wave: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: w + 0.24, y: -0.32 + Math.sin(t * 9) * 0.03, r: -0.2 + Math.sin(t * 9) * 0.55, thumb: 1 }];
  },
  cheer: (t) => {
    const b = Math.abs(Math.sin(t * 6)) * 0.1;
    return [{ x: -1.18, y: -0.72 - b, r: 0.5 }, { x: 1.18, y: -0.72 - b, r: -0.5 }];
  },
  think: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: S.faceX + 0.3, y: S.eyeY + 0.6, r: -0.9 + Math.sin(t * 1.5) * 0.06 }];
  },
  type: (t) => [
    { x: -0.44, y: 0.98 - Math.max(0, Math.sin(t * 15)) * 0.07, r: 0.1 },
    { x: 0.44, y: 0.98 - Math.max(0, Math.sin(t * 15 + 2.2)) * 0.07, r: -0.1 },
  ],
  cheeks: (t, _p, S) => [
    { x: S.faceX - S.cheekDX + 0.06, y: S.eyeY + 0.36, r: 0.7 + Math.sin(t * 3) * 0.05 },
    { x: S.faceX + S.cheekDX - 0.06, y: S.eyeY + 0.36, r: -0.7 - Math.sin(t * 3) * 0.05 },
  ],
  fists: (t, _p, S) => {
    const s = Math.sin(t * 22) * 0.02;
    const w = halfWidthAt(S.pts, S.eyeY + 0.25);
    return [{ x: -w - 0.1, y: S.eyeY + 0.25 + s, r: 0.2, s: 0.9 }, { x: w + 0.1, y: S.eyeY + 0.25 - s, r: -0.2, s: 0.9 }];
  },
  hips: (_t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.42);
    return [{ x: -w + 0.02, y: 0.42, r: 1.4 }, { x: w - 0.02, y: 0.42, r: -1.4 }];
  },
  crossed: () => [{ x: 0.24, y: 0.82, r: -0.2 }, { x: -0.24, y: 0.88, r: 0.2 }],
  stretch: (t) => {
    const w = Math.sin(t * 2) * 0.05;
    return [{ x: -0.5 + w, y: -1.12, r: 2.6 }, { x: 0.5 - w, y: -1.12, r: -2.6 }];
  },
  clasp: (t, _p, S) => {
    const b = Math.sin(t * 3) * 0.02;
    return [{ x: S.faceX - 0.14, y: S.eyeY + 0.74 + b, r: 0.8 }, { x: S.faceX + 0.14, y: S.eyeY + 0.74 + b, r: -0.8 }];
  },
  heart: (t) => {
    const b = Math.sin(t * 2.5) * 0.03;
    return [{ x: -0.34, y: 0.8 + b, r: 0.5 }, { x: 0.34, y: 0.8 + b, r: -0.5 }];
  },
  belly: (t) => {
    const b = Math.sin(t * 18) * 0.035;
    return [{ x: -0.58, y: 0.84 + b, r: 0.3 }, { x: 0.58, y: 0.84 - b, r: -0.3 }];
  },
  mouth: (_t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: S.faceX + 0.16, y: S.eyeY + S.mouthDY + 0.12, r: -0.4 }];
  },
  flail: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.2);
    return [
      { x: -w - 0.18 - Math.sin(t * 7) * 0.1, y: 0.1 + Math.sin(t * 6) * 0.35, r: Math.sin(t * 6) },
      { x: w + 0.18 + Math.sin(t * 7 + 1) * 0.1, y: 0.1 + Math.sin(t * 6 + 2) * 0.35, r: -Math.sin(t * 6 + 2) },
    ];
  },
  rub: (t, _p, S) => {
    const w = Math.sin(t * 9) * 0.07;
    return [{ x: S.faceX - 0.16 + w, y: S.eyeY + 0.74, r: 0.9 }, { x: S.faceX + 0.16 + w, y: S.eyeY + 0.74, r: -0.9 }];
  },
  // Les moufles sur les oreilles (la concentration des agents : « chut »).
  ears: (t, _p, S) => {
    // Un peu en dedans du contour : elles couvrent le bord de la tête.
    const w = halfWidthAt(S.pts, S.eyeY) - 0.1;
    const b = Math.sin(t * 2.4) * 0.015;
    return [{ x: -w, y: S.eyeY + b, r: 0.7, s: 0.95 }, { x: w, y: S.eyeY - b, r: -0.7, s: 0.95 }];
  },
  // La pancarte « ? » : la main droite la tient levée à côté d'elle (gum-draw.ts la dessine).
  sign: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: w + 0.3, y: 0.18 + Math.sin(t * 1.8) * 0.02, r: -0.15 + Math.sin(t * 1.8) * 0.04 }];
  },
};

/** Traduit la description d'une animation en réglages du visage et en type d'yeux. */
export function faceOf(f: Frame): { face: Face; kind: EyeKind } {
  const face: Face = { ...FACE_BASE };
  let kind: EyeKind = f.kind ?? "normal";
  const open = f.eyeOpen ?? 1;
  switch (f.eyes ?? "open") {
    case "open":
      face.eyeOpen = open;
      break;
    case "wide":
      face.eyeOpen = open;
      face.eyeSize = 1.3;
      break;
    case "happy":
      face.eyeOpen = 0;
      face.eyeCurve = 1;
      break;
    case "closed":
      face.eyeOpen = 0;
      face.eyeCurve = -0.6;
      break;
    case "half":
      face.eyeOpen = 0.8;
      face.lid = 0.5;
      break;
    case "spiral":
    case "heart":
    case "x":
      kind = f.eyes as EyeKind;
      break;
  }
  switch (f.brows ?? "none") {
    case "angry":
      face.browA = 1;
      face.browTilt = 0.9;
      break;
    case "worried":
      face.browA = 1;
      face.browTilt = -0.6;
      break;
    case "raised":
      face.browA = 1;
      face.browRaise = 1;
      break;
  }
  const mo = f.mouthOpen;
  switch (f.mouth ?? "smile") {
    case "flat":
      face.mouthW = 0.75;
      face.mouthC = 0;
      break;
    case "o":
      face.mouthW = 0.42;
      face.mouthC = 0;
      face.mouthO = 0.4 + (mo ?? 0.5) * 0.6;
      break;
    case "open":
      face.mouthW = 1.1;
      face.mouthC = 0.85;
      face.mouthO = Math.max(0.15, mo ?? 0.7);
      break;
    case "frown":
      face.mouthW = 0.8;
      face.mouthC = -0.6;
      break;
    case "wavy":
      face.wavy = 1;
      face.mouthC = 0;
      break;
    case "none":
      face.mouthA = 0;
      break;
  }
  if (f.blush !== undefined) face.blush = f.blush;
  if (f.tears !== undefined) face.tears = f.tears;
  if (f.bubble !== undefined) face.bubble = f.bubble;
  if (f.wink) face.winkR = 1;
  if (f.face) Object.assign(face, f.face);
  return { face, kind };
}

/** Le contour qui ondule : les points, leurs écarts au contour de repos et leurs vitesses. */
export class JellyRim {
  readonly disp = new Float32Array(N);
  readonly vel = new Float32Array(N);

  /** Une image de la gelée. `target` : où chaque point voudrait être (joues gonflées…). */
  step(dt: number, target: (i: number) => number, stiffness = 260, coupling = 1500, damping = 9) {
    const sub = 4;
    const h = dt / sub;
    const d = this.disp;
    const v = this.vel;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < N; i++) {
        const lap = d[(i + N - 1) % N] + d[(i + 1) % N] - 2 * d[i];
        v[i] += (stiffness * (target(i) - d[i]) + coupling * lap - damping * v[i]) * h;
      }
      for (let i = 0; i < N; i++) d[i] += v[i] * h;
    }
  }

  /** Une pichenette au point `at` : la gelée s'enfonce là et l'onde part de chaque côté. */
  poke(at: number, strength: number, width = 6) {
    for (let k = -width; k <= width; k++) this.vel[(at + k + N) % N] -= strength * Math.exp(-(k * k) / (width * 1.4));
  }

  /** La gelée encore en mouvement ? (pour savoir si on peut s'arrêter de calculer) */
  energy(): number {
    let e = 0;
    for (let i = 0; i < N; i++) e += Math.abs(this.disp[i]) + Math.abs(this.vel[i]) * 0.05;
    return e;
  }

  reset() {
    this.disp.fill(0);
    this.vel.fill(0);
  }
}

/** Les formes « vivantes », qui changent toutes seules. */
export type DynamicShape = "ciel" | "meteo";

/** La météo reçue (icône de weather.updated) → la forme et l'effet de la mascotte Météo. */
export function weatherLook(icon: string | null, hour: number): { shape: ShapeId; fx: WeatherFx } {
  const night = hour < 7 || hour >= 20;
  const clear: ShapeId = night ? "lune" : "soleil";
  if (!icon) return { shape: clear, fx: "none" };
  if (/⛈|🌩/u.test(icon)) return { shape: "nuage", fx: "storm" };
  if (/🌧|🌦|☔/u.test(icon)) return { shape: "nuage", fx: "rain" };
  if (/❄|🌨|☃/u.test(icon)) return { shape: "nuage", fx: "snow" };
  if (/☁|🌥|🌫|⛅/u.test(icon)) return { shape: "nuage", fx: "none" };
  return { shape: clear, fx: "none" };
}

/** Le ciel : soleil le jour (7 h – 20 h), lune la nuit. */
export function skyShape(hour: number): ShapeId {
  return hour >= 7 && hour < 20 ? "soleil" : "lune";
}
