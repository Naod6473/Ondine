// Les animations de la famille « gomme » : ce que chaque animation demande à
// chaque instant (yeux, bouche, mains, sauts…), et les petits calculs du
// mouvement (la gelée du contour, la forme de la mascotte Météo). Rien ici ne
// dessine ni ne dépend de la fenêtre : tout est testé dans tests/front/gum.test.ts.
// Le moteur qui s'en sert : gum.ts.

import type { Mood, Overlay } from "../types";
import { FACE_BASE, type EyeKind, type Face, type GumTint, type Hand, type Props, type WeatherFx } from "./gum-draw";
import { halfWidthAt, N, type GumShape, type ShapeId } from "./gum-shapes";
import { DANCES, type DanceHandPose } from "./gum-dances";

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
  | "sign"
  | "panic"
  | "wipe"
  | "ear"
  | "push"
  | "peek"
  | "tap"
  | "climb"
  | "sit"
  | "talk"
  | "adjust";

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
  /** La pose des mains (sinon celle de HAND_FOR) ; les danses ont les leurs (gum-dances.ts). */
  hands?: HandPose | DanceHandPose;
  /** La pointe qui se plie (0 à 1). */
  tip?: number;
  /** Ce qu'elle sort le temps du geste (lunettes, écharpe, pile vide, jambes…), en fondu. */
  prop?: Partial<Props>;
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
  info: (_t, p) => ({ dy: hops(p, 1, 0.1), mouth: "smile", brows: "raised", gaze: { x: 0.3, y: -0.2 }, face: { pupil: 1.1 } }),
  sad: (_t, p) => ({ brows: "worried", eyes: p > 0.3 ? "closed" : "open", mouth: p > 0.3 ? "open" : "frown", mouthOpen: 0.3, tears: ramp(p, 0.3, 0.9), squash: 0.95 - Math.sin(p * Math.PI * 6) * 0.02 * ramp(p, 0.3, 1), blink: false }),
  worried: (t) => ({ brows: "worried", mouth: "wavy", rot: Math.sin(t * 2.2) * 0.06, extra: "sweat", gaze: { x: -0.3, y: 0.2 }, face: { pupil: 0.8 } }),
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
  wink: (_t, p) => ({ wink: p > 0.15 && p < 0.85, dy: hops(p, 1, 0.08), mouth: "smile", blush: 1, extra: "stars", face: { pupil: 1.15 } }),
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
  coucou: (t, p) => ({ face: { mouthO: 0.45, mouthC: 0.8, blush: 0.9, pupil: 1.2, winkR: p > 0.2 && p < 0.7 ? 1 : 0 }, hands: "wave", squash: breathe(t), rot: Math.sin(t * 3) * 0.05 }),
  // Rire aux larmes : yeux plissés, larmes qui volent, elle se tient le ventre.
  rire: (t) => ({ kind: "squint", face: { mouthO: 1, mouthW: 1.3, mouthC: 0.9, blush: 1.2, flyTears: 1 }, hands: "belly", squash: 1 + Math.sin(t * 18) * 0.035, rot: Math.sin(t * 9) * 0.05, dy: -Math.abs(Math.sin(t * 9)) * 0.03, blink: false }),
  // Fière : yeux fermés, menton levé, sourire en coin, mains sur les hanches.
  fiere: (t) => ({ face: { eyeOpen: 0, eyeCurve: 0.9, mouthC: 0.5, skew: 0.7, mouthW: 0.9, blush: 0.8, browA: 1, browRaise: 0.5 }, gaze: { x: 0.2, y: -0.5 }, hands: "hips", extra: "sparkles", squash: 1.04 + Math.sin(t * 2) * 0.012, rot: -0.06, blink: false }),
  // Boudeuse : joues gonflées, regard ailleurs, bras croisés.
  boude: (t) => ({ face: { eyeOpen: 0.6, lid: 0.25, mouthW: 0.5, mouthC: -0.5, browA: 1, browTilt: 0.45, puff: 1, blush: 1 }, gaze: { x: -0.9, y: 0.1 }, hands: "crossed", squash: 0.97 + Math.sin(t * 1.7) * 0.012, rot: -0.07 }),
  // Étoiles plein les yeux : mains jointes, elle flotte un peu.
  etoiles: (t) => ({ kind: "star", face: { mouthO: 0.6, mouthC: 0.7, mouthW: 0.9, blush: 1 }, hands: "clasp", extra: "sparkles", dy: -0.05 - Math.sin(t * 2.4) * 0.04, squash: breathe(t, 1.2, 0.02), blink: false }),
  // Malicieuse : un sourcil levé, bouche en « ω », elle se frotte les mains.
  malice: (t) => ({ face: { eyeOpen: 0.6, lid: 0.35, pupil: 0.85, cat: 1, browA: 1, browAsym: 1, blush: 0.7 }, gaze: { x: 0.7, y: 0 }, hands: "rub", squash: breathe(t, 2, 0.02), rot: 0.06 + Math.sin(t * 1.4) * 0.03 }),
  // Concentrée : la langue au coin des lèvres, au clavier.
  concentree: (t) => ({ face: { eyeOpen: 0.75, mouthW: 0.75, mouthC: 0.1, tongueSide: 1, browA: 1, browTilt: 0.3 }, gaze: { x: 0, y: 0.75 }, hands: "type", dy: -Math.abs(Math.sin(t * 7.5)) * 0.02 }),
  // Émue : grands yeux brillants qui se mouillent, une main devant la bouche.
  emue: (t) => ({ face: { eyeSize: 1.22, pupil: 1.3, teary: 1, mouthW: 0.7, mouthC: 0.3 + Math.sin(t * 9) * 0.12, browA: 1, browTilt: -0.55, blush: 1 }, hands: "mouth", squash: 1 + Math.sin(t * 7) * 0.012 }),
  // Gênée : elle rougit, se cache les joues, une goutte de sueur.
  genee: (t) => ({ face: { eyeOpen: 0, eyeCurve: 1, blush: 1.6, lines: 1, mouthW: 0.7, mouthC: 0.4 }, hands: "cheeks", extra: "sweat", rot: Math.sin(t * 2.4) * 0.09, squash: breathe(t, 2, 0.02) }),
  // Danse (sans style : une règle « la mascotte danse », une mascotte sans les
  // danses par style) : elle rebondit sur les temps (t = temps de la musique / 2,
  // voir gum-dances.ts), se balance, et lève les moufles un coup sur deux.
  danse: (t) => {
    const beat = t * Math.PI * 4;
    const hop = Math.abs(Math.sin(beat / 2));
    return {
      face: { mouthO: 0.3, mouthW: 1.1, mouthC: 0.9, eyeOpen: 0.85, blush: 0.8, pupil: 1.15 },
      hands: Math.sin(beat / 4) > 0 ? "cheer" : "flail",
      squash: 1 - hop * 0.08,
      dy: -hop * 0.06,
      rot: Math.sin(beat / 2) * 0.12,
      gaze: { x: Math.sin(beat / 2) * 0.5, y: -0.2 },
      blink: false,
    };
  },
  // Les danses par style (rock, metal, rap…), calées sur le tempo de la musique.
  ...DANCES,
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
  // ── Les expressions de la 1.2.2 (mascot.emote des halos, des fenêtres, de la voix) ──
  // Panique (batterie vide) : yeux ronds, pupilles minuscules, sueur ; elle
  // court d'un côté à l'autre en brandissant une pile vide qui clignote.
  panique: (t, p) => {
    const stop = 1 - ramp(p, 0.88, 1);
    return {
      face: { eyeSize: 1.35, pupil: 0.55, browA: 1, browTilt: -0.8, browRaise: 0.6, mouthW: 0.7, mouthO: 0.55, mouthC: -0.3, blush: 0.2 },
      extra: "sweat",
      hands: "panic",
      prop: { battery: stop },
      dx: Math.sin(t * 5.5) * 0.2 * stop,
      // Des petits pas rapides, penchée vers où elle court.
      dy: -Math.abs(Math.sin(t * 16)) * 0.05 * stop,
      rot: Math.cos(t * 5.5) * 0.14 * stop,
      squash: 1 + Math.sin(t * 32) * 0.025,
      gaze: { x: Math.cos(t * 5.5) > 0 ? 0.8 : -0.8, y: 0 },
      blink: false,
    };
  },
  // Peur : elle se fige, se penche en arrière, puis file sur le côté et revient.
  peur: (t, p) => {
    const flee = Math.sin((ramp(p, 0.15, 0.5) * Math.PI) / 2) * (1 - ramp(p, 0.78, 1));
    const lean = ramp(p, 0, 0.12) * (1 - ramp(p, 0.78, 1));
    return {
      face: { eyeSize: 1.25, pupil: 0.6, browA: 1, browTilt: -0.9, browRaise: 0.4, mouthW: 0.8, wavy: 1, mouthC: 0, blush: 0 },
      hands: "cheeks",
      dx: -0.36 * flee + Math.sin(t * 40) * 0.012 * lean,
      rot: -0.2 * lean,
      squash: 0.93 + Math.sin(t * 40) * 0.008,
      gaze: { x: 0.85, y: 0 },
      extra: "sweat",
      blink: false,
    };
  },
  // Soulagée : une grande inspiration, un long soupir, et elle s'écroule assise.
  soulagee: (t, p) => {
    const inhale = Math.sin((ramp(p, 0, 0.3) * Math.PI) / 2);
    const out = ramp(p, 0.3, 0.6);
    const sit = out * out * (3 - 2 * out);
    return {
      face: {
        eyeOpen: p < 0.28 ? 0.75 : 0,
        eyeCurve: -0.5,
        lid: 0.3,
        mouthW: 0.45 + sit * 0.45,
        mouthO: p < 0.62 ? (0.2 + inhale * 0.35) * (1 - sit * 0.8) : 0,
        mouthC: p < 0.62 ? 0 : 0.7,
        browA: 1 - sit * 0.6,
        browTilt: -0.5 * (1 - sit),
        blush: 0.6,
      },
      squash: 1 + inhale * 0.1 * (1 - sit) - sit * 0.15 + (p > 0.6 ? (breathe(t, 3.6, 0.012) - 1) : 0),
      hands: p > 0.06 && p < 0.5 ? "wipe" : "rest",
      prop: { legs: ramp(p, 0.42, 0.6) * (1 - ramp(p, 0.92, 1)) },
      blink: false,
    };
  },
  // S'étire : bras en l'air, elle s'allonge en penchant de chaque côté, puis s'ébroue.
  etirement: (t, p) => {
    const up = Math.sin(ramp(p, 0.08, 0.72) * Math.PI);
    return {
      face: { eyeOpen: 0, eyeCurve: -0.8, mouthW: 0.6, mouthO: up * 0.5, mouthC: 0.2, blush: 0.7 },
      hands: p > 0.06 && p < 0.74 ? "stretch" : "rest",
      squash: 1 + up * 0.2,
      rot: Math.sin(ramp(p, 0.25, 0.72) * TAU) * 0.09 * up,
      dx: Math.sin(t * 34) * 0.02 * ramp(p, 0.74, 0.8) * (1 - ramp(p, 0.9, 1)),
      blink: false,
    };
  },
  // Sursaut : un petit bond, yeux ronds, pupilles serrées, sourcils tout en haut.
  sursaut: (_t, p) => ({
    face: { eyeSize: 1.35, pupil: 0.5, browA: 1, browRaise: 1.2, mouthW: 0.45, mouthO: 0.8, mouthC: 0 },
    dy: -Math.sin(ramp(p, 0.04, 0.38) * Math.PI) * 0.22,
    squash: p < 0.3 ? 1.16 : 1,
    hands: p < 0.4 ? "cheer" : "cheeks",
    gaze: { x: 0, y: -0.1 },
    blink: false,
  }),
  // Attentive : elle penche la tête et tend l'oreille (une moufle en cornet).
  ecoute: (t) => ({
    face: { eyeSize: 1.1, pupil: 1.15, browA: 0.8, browRaise: 0.45, browAsym: 0.3, mouthW: 0.55, mouthC: 0.25 },
    hands: "ear",
    rot: 0.12 + Math.sin(t * 1.3) * 0.02,
    tip: 0.3,
    squash: breathe(t, 2.8, 0.015),
  }),
  // Lunettes de soleil : elles descendent du front, sourire en coin, elle frime un peu.
  lunettes: (t, p) => {
    const g = ramp(p, 0.06, 0.24) * (1 - ramp(p, 0.88, 1));
    return {
      face: { mouthW: 0.95, mouthC: 0.55, skew: 0.65, browA: 0, blush: 0.5 },
      prop: { glasses: g },
      hands: p > 0.02 && p < 0.28 ? "adjust" : "hips",
      rot: -0.06 * g + Math.sin(t * 2) * 0.02,
      squash: 1.03,
      extra: p > 0.26 && p < 0.7 ? "sparkles" : "none",
      gaze: { x: 0.2, y: -0.2 },
    };
  },
  // L'écharpe : elle l'enroule, puis fait au revoir avec un clin d'œil.
  echarpe: (t, p) => ({
    face: { mouthO: 0.3, mouthC: 0.75, blush: 1, pupil: 1.15, winkR: p > 0.55 && p < 0.75 ? 1 : 0 },
    prop: { scarf: ramp(p, 0.02, 0.2) * (1 - ramp(p, 0.92, 1)) },
    hands: p > 0.22 && p < 0.9 ? "wave" : "rest",
    rot: Math.sin(t * 3) * 0.05,
    squash: breathe(t),
  }),
  // Au revoir : elle salue, puis une petite révérence.
  "au-revoir": (t, p) => {
    const bow = Math.sin(ramp(p, 0.68, 0.95) * Math.PI);
    return {
      face: { mouthO: 0.35, mouthC: 0.8, blush: 0.9, pupil: 1.15, eyeOpen: bow > 0.3 ? 0 : 1, eyeCurve: 1 },
      hands: p < 0.7 ? "wave" : "clasp",
      rot: Math.sin(t * 3) * 0.05 * (1 - bow) + bow * 0.12,
      squash: 1 - bow * 0.09,
    };
  },
  // Pousse : les deux moufles en avant, joues gonflées par l'effort, par à-coups.
  pousse: (t, p) => {
    const heave = Math.max(0, Math.sin(t * 7));
    return {
      face: { eyeOpen: 0.55, lid: 0.3, browA: 1, browTilt: 0.6, mouthW: 0.6, mouthC: -0.2, puff: 0.6, blush: 1 },
      hands: "push",
      rot: 0.18 + heave * 0.03,
      dx: 0.08 + heave * 0.03,
      squash: 0.95 - heave * 0.03,
      gaze: { x: 0.9, y: 0 },
      extra: p > 0.3 ? "sweat" : "none",
      blink: false,
    };
  },
  // Assise au bord : les petites jambes dans le vide se balancent (en boucle).
  "assise-bord": (t) => ({
    face: { mouthC: 0.6, mouthW: 0.85, blush: 0.7, pupil: 1.1 },
    prop: { legs: 1, swing: 1 },
    hands: "sit",
    squash: breathe(t, 3.4, 0.015) * 0.93,
    rot: Math.sin(t * 1.1) * 0.03,
  }),
  // Se cache : elle se tasse, les moufles sur les yeux… et jette un œil entre ses doigts.
  cachee: (t, p) => {
    const down = Math.sin((ramp(p, 0, 0.15) * Math.PI) / 2) * (1 - ramp(p, 0.85, 1));
    const peek = p > 0.45 && p < 0.7;
    return {
      face: { eyeOpen: peek ? 1 : 0, eyeCurve: -0.9, pupil: 0.8, browA: 1, browTilt: -0.5, mouthW: 0.5, mouthC: -0.1, blush: 1.2 },
      hands: "peek",
      squash: 1 - down * 0.18 + Math.sin(t * 30) * 0.008 * down,
      dy: down * 0.16,
      gaze: peek ? { x: 0.3, y: -0.2 } : undefined,
      blink: false,
    };
  },
  // Tapote la vitre : elle vous regarde et toque de la moufle (des ronds sur le verre).
  "tapote-vitre": (_t, p) => ({
    face: { eyeSize: 1.1, pupil: 1.1, browA: 1, browRaise: 0.6, browAsym: 0.5, mouthW: 0.5, mouthO: 0.25, mouthC: 0.1 },
    hands: "tap",
    prop: { taps: 1 - ramp(p, 0.85, 1) },
    rot: -0.05,
    squash: 1.02,
    gaze: { x: 0, y: 0 },
  }),
  // Grimpe : les moufles l'une après l'autre, elle monte un peu, la langue au coin des lèvres.
  grimpe: (t, p) => {
    const step = Math.sin(t * 6);
    return {
      face: { eyeOpen: 0.85, browA: 1, browTilt: 0.35, mouthW: 0.55, mouthC: 0.1, tongueSide: 0.8, blush: 0.8 },
      hands: "climb",
      dy: -Math.abs(step) * 0.06 - Math.sin(ramp(p, 0, 1) * Math.PI) * 0.14,
      rot: step * 0.07,
      squash: 1.06 + Math.abs(step) * 0.04,
      gaze: { x: 0, y: -0.8 },
      extra: p > 0.5 ? "sweat" : "none",
    };
  },
  // Parle : la bouche suit mascot.talk (ou babille toute seule), la moufle accompagne.
  parle: (t) => ({
    face: { mouthW: 0.8, mouthC: 0.45, blush: 0.65, pupil: 1.1, browA: 0.6, browRaise: 0.15 + Math.max(0, Math.sin(t * 2.3)) * 0.25 },
    hands: "talk",
    squash: breathe(t, 2.2, 0.015),
    rot: Math.sin(t * 1.7) * 0.04,
  }),
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
  // La panique : la gauche s'agite, la droite brandit la pile vide.
  panic: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.2);
    return [
      { x: -w - 0.2 - Math.sin(t * 11) * 0.08, y: 0.05 + Math.sin(t * 11) * 0.3, r: Math.sin(t * 11) },
      { x: w + 0.08, y: -0.3 + Math.sin(t * 11 + 1.5) * 0.06, r: -0.2 + Math.sin(t * 11) * 0.2 },
    ];
  },
  // S'essuie le front (le soupir de soulagement).
  wipe: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    const s = Math.sin(t * 5);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: S.faceX + s * 0.25, y: S.eyeY - 0.4, r: -1.4 + s * 0.2 }];
  },
  // Tend l'oreille : la moufle droite en cornet à côté de la tête.
  ear: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    const e = halfWidthAt(S.pts, S.eyeY);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: e + 0.12, y: S.eyeY - 0.02 + Math.sin(t * 2) * 0.01, r: -0.9, s: 1.05 }];
  },
  // Pousse : les deux moufles en avant, sur le côté, par à-coups.
  push: (t) => {
    const k = Math.max(0, Math.sin(t * 7)) * 0.05;
    return [{ x: 0.95 + k, y: 0.08, r: 1.45 }, { x: 1.0 + k, y: 0.48, r: 1.45 }];
  },
  // Les moufles sur les yeux ; elles s'écartent un instant (entre 45 et 70 % du geste).
  peek: (_t, p, S) => {
    const open = p > 0.45 && p < 0.7 ? 1 : 0;
    const dx = S.eyeDX + open * 0.24;
    return [
      { x: S.faceX - dx, y: S.eyeY + 0.02, r: 0.4 + open * 0.5, s: 1.1 },
      { x: S.faceX + dx, y: S.eyeY + 0.02, r: -0.4 - open * 0.5, s: 1.1 },
    ];
  },
  // Toque sur la vitre : la moufle droite tout près de vous, qui grossit à chaque coup.
  tap: (t, _p, S) => {
    const knock = Math.max(0, Math.sin(t * 12)) ** 3;
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: S.faceX + 0.42, y: S.eyeY + 0.3 - knock * 0.04, r: -0.2, s: 1.3 + knock * 0.2 }];
  },
  // Grimpe : une moufle après l'autre, tout en haut.
  climb: (t) => {
    const a = Math.sin(t * 6);
    return [{ x: -0.62, y: -0.95 - a * 0.18, r: 2.4 }, { x: 0.62, y: -0.95 + a * 0.18, r: -2.4 }];
  },
  // Assise : les moufles posées de chaque côté, sur le bord.
  sit: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.8);
    const b = Math.sin(t * 1.1) * 0.01;
    return [{ x: -w - 0.06, y: 0.86 + b, r: -1.2 }, { x: w + 0.06, y: 0.86 - b, r: 1.2 }];
  },
  // Parle : la moufle droite accompagne ce qu'elle dit.
  talk: (t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    const g = Math.sin(t * 2.6);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: w + 0.18, y: 0.3 - Math.max(0, g) * 0.15, r: -0.5 + g * 0.3, thumb: 0.4 }];
  },
  // Ajuste ses lunettes : la moufle droite à la branche.
  adjust: (_t, _p, S) => {
    const w = halfWidthAt(S.pts, 0.55);
    return [{ x: -w - 0.04, y: 0.55, r: -0.35 }, { x: S.faceX + S.eyeDX + 0.26, y: S.eyeY - 0.06, r: -1.1 }];
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
      face.pupil = 0.62;
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

// ── Les petits calculs de la fluidité (utilisés par gum-engine.ts) ──

/** Le clignement : fermeture 70 ms, ouverture 130 ms, toutes les 2,2 à 5,4 s, deux fois de suite une fois sur cinq environ. */
export const BLINK = { closeMs: 70, openMs: 130, minGapMs: 2200, maxGapMs: 5400, double: 0.22 };

/**
 * L'ouverture de la paupière pendant un clignement (1 = ouverte, 0 = fermée),
 * `ms` depuis son début : une courbe qui accélère en fermant, ralentit en
 * rouvrant ; null quand le clignement est fini.
 */
export function blinkCurve(ms: number): number | null {
  const { closeMs, openMs } = BLINK;
  if (ms < 0) return 1;
  if (ms < closeMs) {
    const k = ms / closeMs;
    return 1 - k * k;
  }
  if (ms < closeMs + openMs) {
    const k = (ms - closeMs) / openMs;
    return 1 - (1 - k) ** 3;
  }
  return null;
}

/**
 * L'écrasement à l'atterrissage, en images clés (secondes depuis le contact →
 * écart d'étirement) : écrasée, rebond étiré, un peu écrasée, posée. Entre
 * deux clés, une courbe douce.
 */
export const LANDING: [number, number][] = [
  [0, 0],
  [0.045, -0.17],
  [0.15, 0.07],
  [0.26, -0.025],
  [0.38, 0],
];

export function landingSquash(s: number): number {
  if (s <= 0 || s >= LANDING[LANDING.length - 1][0]) return 0;
  for (let i = 1; i < LANDING.length; i++) {
    const [t1, v1] = LANDING[i];
    if (s <= t1) {
      const [t0, v0] = LANDING[i - 1];
      const k = (s - t0) / (t1 - t0);
      return v0 + (v1 - v0) * k * k * (3 - 2 * k);
    }
  }
  return 0;
}

/** Les petits gestes du repos (voir idleAct). */
export type IdleAct = "shift" | "sigh" | "pout" | "look" | "hum";
export const IDLE_ACTS: IdleAct[] = ["shift", "sigh", "pout", "look", "hum"];
export const IDLE_ACT_SECS: Record<IdleAct, number> = { shift: 2.6, sigh: 2.4, pout: 1.8, look: 1.6, hum: 2.2 };

/**
 * Un petit geste du repos à l'instant `k` (0 à 1 de sa durée) : ce qu'il
 * change au visage et au corps, et sa force (entrée et sortie en douceur).
 */
export function idleAct(act: IdleAct, k: number, side: number): { w: number; face: Partial<Face>; squash: number; rot: number; dx: number; gaze: { x: number; y: number } | null } {
  const e = Math.min(1, k / 0.25, (1 - k) / 0.25);
  const w = Math.max(0, e * e * (3 - 2 * e));
  switch (act) {
    case "shift":
      // Elle déplace son poids sur un côté.
      return { w, face: {}, squash: -0.015, rot: 0.06 * side, dx: 0.05 * side, gaze: null };
    case "sigh": {
      // Un soupir : elle gonfle, puis se dégonfle, paupières lourdes.
      const b = Math.sin(k * Math.PI);
      return { w, face: { lid: 0.4, mouthO: 0.25 * b, mouthW: 0.5, mouthC: 0.1 }, squash: k < 0.45 ? 0.05 * b : -0.035 * b, rot: 0, dx: 0, gaze: { x: 0, y: 0.35 } };
    }
    case "pout":
      // Une petite moue, le regard de côté.
      return { w, face: { mouthC: -0.25, mouthW: 0.55, skew: 0.4 * side, puff: 0.35 }, squash: 0, rot: -0.03 * side, dx: 0, gaze: { x: -0.6 * side, y: 0.1 } };
    case "look":
      // Elle regarde ailleurs, la tête suit.
      return { w, face: { browA: 0.4, browRaise: 0.3 }, squash: 0.01, rot: 0.04 * side, dx: 0, gaze: { x: 0.75 * side, y: -0.35 } };
    case "hum":
      // Elle fredonne, yeux fermés, en se balançant.
      return { w, face: { eyeOpen: 0, eyeCurve: 0.9, mouthC: 0.75, blush: 0.8 }, squash: 0, rot: Math.sin(k * TAU * 2) * 0.05, dx: 0, gaze: null };
  }
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
