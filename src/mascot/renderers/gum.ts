// Le moteur de la goutte « gomme » (mascots/goutte-gomme) : tout est dessiné
// en code (voir gum-draw.ts), et le corps bouge comme une gelée.
//
// Principe (comme la goutte provisoire) : chaque animation est une fonction
// qui, pour un instant donné, décrit la pose voulue (yeux, bouche, couleur,
// étirement, inclinaison…). L'effet gelée vient d'un RESSORT : l'étirement et
// l'inclinaison réels ne sautent jamais à la valeur voulue, ils y vont en
// rebondissant un peu (ils dépassent, reviennent, se calment). Au début de
// chaque animation, on donne une petite pichenette au ressort.

import { frameLoop } from "../../core/perf";
import type { MascotRenderer } from "../renderer";
import type { AnimationSpec, MascotState, Mood } from "../types";
import { reducedMotion } from "../../island/tab-pill";
import { drawGum, type GumPose } from "./gum-draw";

const TAU = Math.PI * 2;

/** Ce qu'une animation décrit : une pose, plus le regard et le clignement. */
type Frame = GumPose & {
  /** Regard imposé (-1 à 1) ; absent = suit la souris. */
  gaze?: { x: number; y: number };
  /** Clignement automatique permis (par défaut oui, pour les yeux ouverts). */
  blink?: boolean;
};

// Petits outils de mouvement. t = secondes, p = progression de 0 à 1.
const breathe = (t: number, period = 3.2, amount = 0.025) => 1 + Math.sin((t / period) * TAU) * amount;
/** Sauts : 0 au sol, négatif en l'air (en fraction du rayon). */
const hops = (p: number, n: number, height: number) => -Math.abs(Math.sin(p * Math.PI * n)) * height;
/** Monte de 0 à 1 entre a et b. */
const ramp = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
/** Tremblement rapide qui s'éteint. */
const shake = (t: number, p: number, amount: number) => Math.sin(t * 48) * amount * (1 - p);

const ANIMS: Record<string, (t: number, p: number, mood: Mood) => Frame> = {
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
  thinking: (t) => ({ squash: breathe(t, 2.4, 0.02), gaze: { x: 0.6, y: -0.8 }, mouth: "flat", extra: "dots", rot: 0.06 }),
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
  question: (t) => ({ tint: "violet", brows: "raised", mouth: "o", mouthOpen: 0.4, rot: 0.14 + Math.sin(t * 2) * 0.04, gaze: { x: 0.5, y: -0.7 }, extra: "question" }),
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
    tint: Math.sin(t * 30) > 0 && p < 0.6 ? "yellow" : "blue",
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
};

/** Raideur et amortissement du ressort (par seconde). */
const STIFF = 170;
const DAMP = 9;

export class GumRenderer implements MascotRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private observer: ResizeObserver | null = null;
  private stopFrames: () => void = () => {};
  private anim: AnimationSpec | null = null;
  private animStart = 0;
  private ended = false;
  private mood: Mood = "neutral";
  private endCallbacks: ((name: string) => void)[] = [];
  private lookTarget = { x: 0, y: 0 };
  private look = { x: 0, y: 0 };
  private nextBlink = performance.now() + 2000;
  private last = performance.now();
  /** Le ressort de la gelée : étirement et inclinaison réels, et leurs vitesses. */
  private jelly = { sq: 1, sqV: 0, rot: 0, rotV: 0 };

  mount(container: HTMLElement) {
    this.canvas.className = "mascot-canvas";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    // Arrêtée quand la place de la mascotte n'a pas de taille (île cachée),
    // 30 images/s au plus en économie d'énergie (src/core/perf.ts).
    this.stopFrames = frameLoop(this.canvas, (now) => this.frame(now));
  }

  play(animation: AnimationSpec) {
    this.anim = animation;
    this.animStart = performance.now();
    this.ended = false;
    // Une pichenette : la gelée tremble un peu à chaque changement.
    this.jelly.sqV += 1.6;
  }

  setState(_state: MascotState) {
    // Tout passe par play().
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  lookAt(x: number | null, y: number | null) {
    if (x == null || y == null) {
      this.lookTarget = { x: 0, y: 0 };
      return;
    }
    this.lookTarget = { x: x / (Math.abs(x) + 60), y: y / (Math.abs(y) + 60) };
  }

  onAnimationEnd(cb: (name: string) => void) {
    this.endCallbacks.push(cb);
  }

  destroy() {
    this.stopFrames();
    this.observer?.disconnect();
    this.canvas.remove();
    this.endCallbacks = [];
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  private frame(now: number) {
    // Pas de temps (limité : un onglet en veille ne doit pas faire exploser le ressort).
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const anim = this.anim;
    const elapsed = anim ? now - this.animStart : now;
    const dur = anim?.durationMs ?? 4000;
    const t = elapsed / 1000;
    let p: number;
    if (!anim || anim.loop) {
      p = (elapsed % dur) / dur;
    } else {
      p = Math.min(1, elapsed / dur);
      if (p >= 1 && !this.ended) {
        this.ended = true;
        for (const cb of [...this.endCallbacks]) cb(anim.name);
      }
    }

    const fn = ANIMS[anim?.source.function ?? anim?.name ?? "idle"] ?? ANIMS.idle;
    const f = fn(t, p, this.mood);

    // Clignement : toutes les 2,5 à 5,5 s, pendant 140 ms.
    const eyes = f.eyes ?? "open";
    let eyeOpen = f.eyeOpen ?? 1;
    if (f.blink !== false && (eyes === "open" || eyes === "half" || eyes === "wide")) {
      if (now > this.nextBlink + 140) this.nextBlink = now + 2500 + Math.random() * 3000;
      if (now > this.nextBlink) eyeOpen *= 0.1;
    }

    // Le regard glisse doucement vers sa cible.
    const target = f.gaze ?? this.lookTarget;
    this.look.x += (target.x - this.look.x) * 0.15;
    this.look.y += (target.y - this.look.y) * 0.15;

    // La gelée : ressort vers l'étirement et l'inclinaison voulus.
    const wantSq = f.squash ?? 1;
    const wantRot = f.rot ?? 0;
    const j = this.jelly;
    if (reducedMotion()) {
      j.sq = wantSq;
      j.rot = wantRot;
      j.sqV = j.rotV = 0;
    } else {
      j.sqV += (STIFF * (wantSq - j.sq) - DAMP * j.sqV) * dt;
      j.sq += j.sqV * dt;
      j.rotV += (STIFF * (wantRot - j.rot) - DAMP * j.rotV) * dt;
      j.rot += j.rotV * dt;
      // garde-fou : jamais d'étirement absurde
      j.sq = Math.min(1.4, Math.max(0.7, j.sq));
    }

    drawGum(this.ctx, this.canvas.width, this.canvas.height, {
      ...f,
      eyes,
      eyeOpen,
      squash: j.sq,
      rot: j.rot,
      look: this.look,
      t,
    });
  }
}
