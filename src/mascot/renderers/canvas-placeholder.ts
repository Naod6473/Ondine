// La mascotte provisoire : une goutte bleue avec deux yeux, dessinée en Canvas 2D.
// Elle respire, cligne des yeux, suit la souris du regard et sait jouer chaque
// animation du manifeste mascots/placeholder/manifest.json.
//
// Principe : chaque animation est une fonction qui, pour un instant donné,
// renvoie une « pose » (position du corps, forme des yeux, bouche, effets…).
// Une seule fonction `draw` sait dessiner n'importe quelle pose.

import { frameLoop } from "../../core/perf";
import type { MascotRenderer } from "../renderer";
import type { AnimationSpec, MascotState, Mood } from "../types";
import { drawHeart, drawOverlay, type Overlay } from "./overlays";

type Eyes = "open" | "closed" | "happy" | "spiral" | "heart" | "wide" | "half";
type Mouth = "none" | "smile" | "flat" | "o" | "open";

interface Pose {
  /** Décalage vertical du corps, en fraction du rayon (négatif = vers le haut). */
  bodyY: number;
  /** Écrasement vertical (1 = normal, >1 = étiré). */
  squash: number;
  /** Inclinaison en radians. */
  rot: number;
  /** Tremblement horizontal, en fraction du rayon. */
  shakeX: number;
  eyes: Eyes;
  /** Ouverture des yeux (0 à 1). */
  eyeOpen: number;
  brows: "none" | "angry" | "worried";
  mouth: Mouth;
  /** Ouverture de la bouche (0 à 1) pour "open". */
  mouthOpen: number;
  blush: boolean;
  extra: Overlay;
  /** Regard imposé (de -1 à 1) ; null = suit la souris. */
  gaze: { x: number; y: number } | null;
  blink: boolean;
  /** Couleur du corps. */
  tint: "blue" | "orange" | "pink";
}

const BASE: Pose = {
  bodyY: 0,
  squash: 1,
  rot: 0,
  shakeX: 0,
  eyes: "open",
  eyeOpen: 1,
  brows: "none",
  mouth: "none",
  mouthOpen: 0,
  blush: false,
  extra: "none",
  gaze: null,
  blink: true,
  tint: "blue",
};

const TAU = Math.PI * 2;
const breathe = (t: number, period = 3.2, amount = 0.03) => 1 + Math.sin((t / period) * TAU) * amount;

/**
 * Les animations. `t` = secondes depuis le début, `p` = progression de 0 à 1
 * (pour une boucle, progression dans le cycle en cours).
 */
const POSES: Record<string, (t: number, p: number, mood: Mood) => Partial<Pose>> = {
  idle: (t, _p, mood) => ({
    squash: breathe(t),
    mouth: mood === "happy" ? "smile" : "none",
    brows: mood === "grumpy" ? "angry" : "none",
    eyes: mood === "tired" ? "half" : "open",
  }),
  wake: (_t, p) => ({
    eyes: p < 0.35 ? "closed" : "open",
    eyeOpen: p < 0.35 ? 0 : Math.min(1, (p - 0.35) * 3),
    squash: 1 + Math.sin(Math.min(1, p * 1.4) * Math.PI) * 0.14,
    mouth: p > 0.15 && p < 0.6 ? "o" : "none",
    blink: false,
  }),
  sleep: (t) => ({
    eyes: "closed",
    squash: breathe(t, 4, 0.06),
    bodyY: 0.04,
    extra: "zzz",
    gaze: { x: 0, y: 0.3 },
    blink: false,
  }),
  happy: (_t, p) => ({
    bodyY: -Math.abs(Math.sin(p * TAU)) * 0.18,
    squash: 1 + Math.sin(p * TAU * 2) * 0.05,
    eyes: "happy",
    mouth: "smile",
    blush: true,
  }),
  annoyed: (t, p) => ({
    brows: "angry",
    eyes: "half",
    mouth: "flat",
    shakeX: Math.sin(t * 45) * 0.05 * (1 - p),
    extra: "steam",
    tint: "pink",
  }),
  dizzy: (t, p) => ({
    eyes: "spiral",
    rot: Math.sin(t * 7) * 0.18 * (1 - p * 0.5),
    bodyY: Math.sin(t * 5) * 0.04,
    mouth: "o",
    extra: "stars",
    blink: false,
  }),
  thinking: (t) => ({
    squash: breathe(t, 2.4, 0.02),
    gaze: { x: 0.6, y: -0.8 },
    mouth: "flat",
    extra: "dots",
    blink: true,
  }),
  working: (t) => ({
    bodyY: Math.abs(Math.sin(t * 6)) * -0.04,
    brows: "worried",
    gaze: { x: 0, y: 0.6 },
    mouth: "flat",
    extra: "sweat",
  }),
  alert: (t) => ({
    eyes: "wide",
    bodyY: -Math.abs(Math.sin(t * 5)) * 0.08,
    mouth: "o",
    extra: "bang",
    tint: "orange",
    gaze: { x: 0, y: 0 },
    blink: false,
  }),
  eating: (_t, p) => ({
    mouth: "open",
    mouthOpen: p < 0.75 ? Math.abs(Math.sin(p * Math.PI * 4)) : 0,
    eyes: p < 0.75 ? "closed" : "happy",
    squash: p > 0.75 ? 1 - Math.sin((p - 0.75) * 4 * Math.PI) * 0.1 : 1,
    blink: false,
  }),
  celebrate: (_t, p) => ({
    bodyY: -Math.abs(Math.sin(p * TAU)) * 0.3,
    squash: 1 + Math.sin(p * TAU * 2) * 0.08,
    eyes: "happy",
    mouth: "open",
    mouthOpen: 0.7,
    extra: "confetti",
    blush: true,
  }),
  love: (t) => ({
    eyes: "heart",
    blush: true,
    mouth: "smile",
    rot: Math.sin(t * 2.5) * 0.08,
    extra: "hearts",
    tint: "pink",
    blink: false,
  }),
  bored: (t) => ({
    eyes: "half",
    mouth: "flat",
    gaze: { x: Math.sin(t * 0.6), y: 0.2 },
    squash: 1 - Math.max(0, Math.sin(t * 0.9)) * 0.04,
  }),
};

const COLORS = {
  blue: ["#a9d8ff", "#5aa8ee", "#2b5f93"],
  orange: ["#ffd29a", "#f5a142", "#9a5a14"],
  pink: ["#ffc4dc", "#ee7fae", "#8f3560"],
} as const;

export class PlaceholderCanvasRenderer implements MascotRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private observer: ResizeObserver | null = null;
  private stopFrames: () => void = () => {};
  private anim: AnimationSpec | null = null;
  private animStart = 0;
  private ended = false;
  private mood: Mood = "neutral";
  private endCallbacks: ((name: string) => void)[] = [];
  /** Regard voulu et regard actuel (lissé), de -1 à 1. */
  private lookTarget = { x: 0, y: 0 };
  private look = { x: 0, y: 0 };
  private nextBlink = performance.now() + 2000;

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
  }

  setState(_state: MascotState) {
    // Ce moteur n'a pas sa propre machine à états : tout passe par play().
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  lookAt(x: number | null, y: number | null) {
    if (x == null || y == null) {
      this.lookTarget = { x: 0, y: 0 };
      return;
    }
    // Plus le point est loin, plus le regard va au bord, sans jamais le dépasser.
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

  // ── Dessin ─────────────────────────────────────────────────────────────────

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  private frame(now: number) {
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
        // Copie : un rappel peut lancer une autre animation.
        for (const cb of [...this.endCallbacks]) cb(anim.name);
      }
    }

    const fn = POSES[anim?.source.function ?? anim?.name ?? "idle"] ?? POSES.idle;
    const pose: Pose = { ...BASE, ...fn(t, p, this.mood) };

    // Clignement : toutes les 2,5 à 5,5 s, pendant 140 ms.
    if (pose.blink && (pose.eyes === "open" || pose.eyes === "half")) {
      if (now > this.nextBlink + 140) this.nextBlink = now + 2500 + Math.random() * 3000;
      if (now > this.nextBlink) pose.eyeOpen *= 0.1;
    }

    // Le regard glisse doucement vers sa cible.
    const target = pose.gaze ?? this.lookTarget;
    this.look.x += (target.x - this.look.x) * 0.15;
    this.look.y += (target.y - this.look.y) * 0.15;

    this.draw(pose, t);
  }

  private draw(pose: Pose, t: number) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const S = Math.min(w, h);
    const R = S * 0.34;
    const cx = w / 2 + pose.shakeX * R;
    const cy = h / 2 + R * 0.12 + pose.bodyY * R;
    const sx = 1 / Math.sqrt(pose.squash);
    const sy = pose.squash;
    const [light, mid, dark] = COLORS[pose.tint];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pose.rot);

    // Corps : une ellipse avec un dégradé et un contour.
    const grad = ctx.createLinearGradient(0, -R, 0, R);
    grad.addColorStop(0, light);
    grad.addColorStop(1, mid);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.08 * sx, R * 0.92 * sy, 0, 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.strokeStyle = dark;
    ctx.stroke();

    // Visage : il suit un peu le regard (effet de volume).
    const fx = this.look.x * R * 0.16;
    const fy = this.look.y * R * 0.12;
    const ink = "#151820";
    const eyeDX = R * 0.36;
    const eyeY = -R * 0.1 * sy + fy;
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, R * 0.08);

    for (const side of [-1, 1]) {
      const ex = side * eyeDX + fx;
      this.drawEye(pose, ex, eyeY, R, side, t);
    }

    if (pose.brows !== "none") {
      for (const side of [-1, 1]) {
        const ex = side * eyeDX + fx;
        const by = eyeY - R * 0.32;
        // Sourcils en colère : le bout intérieur descend ; inquiets : il remonte.
        const tilt = pose.brows === "angry" ? -0.12 : 0.1;
        ctx.beginPath();
        ctx.moveTo(ex - side * R * 0.16, by - tilt * R);
        ctx.lineTo(ex + side * R * 0.12, by + tilt * R);
        ctx.stroke();
      }
    }

    if (pose.blush) {
      ctx.fillStyle = "rgba(255, 110, 150, 0.45)";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * R * 0.62 + fx, eyeY + R * 0.3, R * 0.14, R * 0.08, 0, 0, TAU);
        ctx.fill();
      }
    }

    this.drawMouth(pose, fx, eyeY + R * 0.42, R);
    ctx.restore();

    drawOverlay(this.ctx, pose.extra, w / 2, cy, R, t);
  }

  private drawEye(pose: Pose, x: number, y: number, R: number, side: number, t: number) {
    const ctx = this.ctx;
    const ew = R * 0.13;
    const eh = R * 0.22;
    ctx.beginPath();
    switch (pose.eyes) {
      case "open":
      case "wide": {
        const k = pose.eyes === "wide" ? 1.35 : 1;
        ctx.ellipse(x, y, ew * k, Math.max(R * 0.025, eh * k * pose.eyeOpen), 0, 0, TAU);
        ctx.fill();
        if (pose.eyes === "wide" || pose.eyeOpen > 0.6) {
          // Petit reflet blanc.
          ctx.beginPath();
          ctx.fillStyle = "#ffffff";
          ctx.arc(x - ew * 0.3, y - eh * 0.35 * pose.eyeOpen, ew * 0.32, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "#151820";
        }
        break;
      }
      case "half":
        ctx.ellipse(x, y + eh * 0.3, ew, Math.max(R * 0.025, eh * 0.55 * pose.eyeOpen), 0, 0, Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - ew * 1.3, y + eh * 0.3);
        ctx.lineTo(x + ew * 1.3, y + eh * 0.3);
        ctx.stroke();
        break;
      case "closed":
        ctx.arc(x, y, ew * 1.1, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        break;
      case "happy":
        ctx.arc(x, y + eh * 0.3, ew * 1.2, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
        break;
      case "spiral": {
        const turns = 2.2;
        const steps = 30;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * turns * TAU + t * 8 * side;
          const r = (i / steps) * ew * 1.5;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = Math.max(1, R * 0.05);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, R * 0.08);
        break;
      }
      case "heart":
        drawHeart(ctx, x, y, ew * 2.2, "#e8336d");
        break;
    }
  }

  private drawMouth(pose: Pose, x: number, y: number, R: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    switch (pose.mouth) {
      case "smile":
        ctx.arc(x, y - R * 0.08, R * 0.16, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
        break;
      case "flat":
        ctx.moveTo(x - R * 0.12, y);
        ctx.lineTo(x + R * 0.12, y);
        ctx.stroke();
        break;
      case "o":
        ctx.ellipse(x, y, R * 0.07, R * 0.09, 0, 0, TAU);
        ctx.fill();
        break;
      case "open":
        ctx.ellipse(x, y, R * 0.18, Math.max(R * 0.02, R * 0.16 * pose.mouthOpen), 0, 0, TAU);
        ctx.fill();
        break;
      case "none":
        break;
    }
  }


}
