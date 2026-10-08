// Moteur « poses » : une image par émotion (joie, colère, validation…), toutes
// cadrées pareil dans une case de 256 × 256, et un FONDU entre deux poses.
//
// Ce que le code ajoute par-dessus les images :
//   - les pupilles : dessinées dans les yeux blancs de la pose (positions dans
//     le manifeste), elles suivent la souris ; en l'air quand la goutte réfléchit,
//     elles tournent quand elle est étourdie ;
//   - le clignement : une paupière de la couleur de la goutte descend, puis on
//     montre la pose « yeux fermés » si la pose en a une (`blink`) ;
//   - le fondu : quand la pose change, l'ancienne image s'efface pendant que la
//     nouvelle apparaît (≈ 0,3 s). Les deux sont mélangées en mode « lighter »,
//     ce qui donne un vrai mélange des couleurs (bleu → vert sans voile sombre) ;
//   - les mouvements du corps (effects.ts) et les effets autour (overlays.ts) ;
//   - l'humeur de fond (mascot-state.ts) : « tired » = paupières à moitié
//     baissées (tard le soir, batterie faible), « grumpy » = une goutte de sueur
//     qui perle sur le front (processeur à fond).
//
// Chaque image est dessinée d'abord dans un petit canvas hors écran (un
// « calque »), puis le calque est posé sur l'île avec les mouvements du corps.

import { frameLoop } from "../../core/perf";
import type { MascotExtras, MascotRenderer } from "../renderer";
import type { AnimationSpec, MascotManifest, MascotState, Mood, PoseEye, PoseSpec } from "../types";
import { EFFECTS, STILL, type Motion } from "./effects";
import { drawOverlay } from "./overlays";

const TAU = Math.PI * 2;
/** Taille des images de poses (une case carrée). */
const CELL = 256;
/** Rayon d'une pupille, en px de la case. */
const PUPIL_R = 13.5;
/** Fondu par défaut entre deux poses. */
const FADE_MS = 280;

/** Couleurs de la paupière d'un œil, prises sur l'image juste au-dessus de l'œil. */
interface Lid {
  top: string;
  bottom: string;
  line: string;
}

/** Un canvas hors écran avec son contexte. */
function layer(): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  return { c, x: c.getContext("2d")! };
}

/** Une copie d'un canvas (avant de le redimensionner, ce qui l'efface). */
function copyOf(c: HTMLCanvasElement): HTMLCanvasElement {
  const k = document.createElement("canvas");
  k.width = c.width;
  k.height = c.height;
  k.getContext("2d")!.drawImage(c, 0, 0);
  return k;
}

/**
 * Garde seulement les yeux bien décrits dans le manifeste : des nombres, dans
 * la case, assez grands pour une pupille. Un œil mal décrit est ignoré (avec un
 * avertissement) au lieu de faire planter le dessin.
 */
function validPoses(poses: Record<string, PoseSpec>): Record<string, PoseSpec> {
  const out: Record<string, PoseSpec> = {};
  for (const [name, pose] of Object.entries(poses)) {
    const eyes = (pose.eyes ?? []).filter((e) => {
      const ok =
        [e?.cx, e?.cy, e?.rx, e?.ry].every((v) => typeof v === "number" && Number.isFinite(v)) &&
        e.cx >= 0 && e.cx <= CELL && e.cy >= 0 && e.cy <= CELL &&
        e.rx > PUPIL_R + 2 && e.ry > PUPIL_R + 2 && e.rx < CELL / 2 && e.ry < CELL / 2;
      if (!ok) console.warn(`[mascotte] œil mal décrit dans la pose « ${name} » : ignoré`);
      return ok;
    });
    const blink = pose.blink && poses[pose.blink] ? pose.blink : undefined;
    out[name] = { ...pose, eyes, blink };
  }
  return out;
}

/** Accélère puis ralentit (fondu plus doux qu'une ligne droite). */
const smooth = (k: number) => k * k * (3 - 2 * k);

export class PosesRenderer implements MascotRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private observer: ResizeObserver | null = null;
  private stopFrames: () => void = () => {};
  // « Réduire les animations » : suivi en direct (le réglage Windows peut changer).
  private motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  private reduced = this.motionQuery?.matches ?? false;
  private onMotionChange = () => (this.reduced = this.motionQuery?.matches ?? false);

  private poses: Record<string, PoseSpec>;
  private images = new Map<string, HTMLImageElement>();
  private lids = new Map<string, Lid[]>();

  private anim: AnimationSpec | null = null;
  private animStart = 0;
  private ended = false;
  private endCallbacks: ((name: string) => void)[] = [];

  // Regard : souris par rapport au centre (px), regard lissé (-1..1), « de près » (0..1).
  private target: { x: number; y: number } | null = null;
  private gx = 0;
  private gy = 0;
  private near = 0;

  // Clignement : 0 = ouvert, 1 = fermé.
  private blink = 0;
  private blinkStart = 0;
  private nextBlink = performance.now() + 2500;
  private doubleBlink = false;
  /** L'humeur de fond (voir setMood). */
  private mood: Mood = "neutral";
  /** Une question d'agent ouverte : le « ? » reste au-dessus d'elle (setExtras). */
  private sign = false;

  // Petites variantes au repos (un clin d'œil, un air calme…).
  private variant: { pose: string; until: number } | null = null;
  private nextVariant = 0;

  // Le fondu : `shown` = pose affichée, `from` = image figée de l'ancienne pose.
  private shown = "";
  private fadeStart = 0;
  private fadeMs = FADE_MS;
  private live = layer(); // la pose actuelle, redessinée à chaque image (pupilles)
  private from = layer(); // l'image d'avant le changement de pose
  private mix = layer(); // le mélange des deux, posé ensuite sur l'île
  private res = 0; // taille des calques, en px réels

  constructor(
    private readonly manifest: MascotManifest,
    assets: Record<string, string>,
  ) {
    this.poses = validPoses(manifest.poses ?? {});
    // On charge toutes les poses tout de suite : aucun trou au premier changement.
    for (const [name, pose] of Object.entries(this.poses)) {
      const url = assets[pose.file];
      if (!url) {
        console.warn(`[mascotte] fichier introuvable : ${pose.file}`);
        continue;
      }
      const img = new Image();
      img.onload = () => this.lids.set(name, this.sampleLids(img, pose.eyes ?? []));
      img.src = url;
      this.images.set(name, img);
    }
  }

  mount(container: HTMLElement) {
    this.canvas.className = "mascot-canvas";
    Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block" });
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.motionQuery?.addEventListener("change", this.onMotionChange);
    let warned = false;
    // Arrêtée quand la place de la mascotte n'a pas de taille (île cachée),
    // 30 images/s au plus en économie d'énergie (src/core/perf.ts).
    this.stopFrames = frameLoop(this.canvas, (now) => {
      // Une erreur dans une image ne doit pas arrêter la goutte : on la note
      // une fois et on continue à l'image suivante.
      try {
        this.frame(now);
      } catch (err) {
        if (!warned) console.warn("[mascotte] erreur de dessin", err);
        warned = true;
      }
    });
  }

  play(animation: AnimationSpec) {
    this.anim = animation;
    this.animStart = performance.now();
    this.ended = false;
    this.variant = null;
    this.nextVariant = this.animStart + 20_000 + Math.random() * 20_000;
  }

  setState(_state: MascotState) {}

  /** Ce moteur ne dessine pas de moufles : la pancarte est le « ? » des effets (overlays.ts). */
  setExtras(extras: MascotExtras) {
    this.sign = extras.sign;
  }

  setMood(mood: Mood) {
    // Les émotions sont des poses à part entière ; l'humeur ajoute seulement
    // des paupières lourdes (tired) ou une goutte de sueur (grumpy).
    this.mood = mood;
  }

  lookAt(x: number | null, y: number | null) {
    this.target = x == null || y == null ? null : { x, y };
  }

  onAnimationEnd(cb: (name: string) => void) {
    this.endCallbacks.push(cb);
  }

  destroy() {
    this.stopFrames();
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.observer?.disconnect();
    this.canvas.remove();
    this.endCallbacks = [];
  }

  // ── Taille ─────────────────────────────────────────────────────────────────

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  /** La taille de la goutte à l'écran (px réels), avec de la marge pour les effets. */
  private size() {
    return Math.min(this.canvas.width, this.canvas.height) * 0.84;
  }

  /**
   * Les calques sont à la taille d'affichage : net, et pas plus de travail que
   * nécessaire. Changer la taille d'un canvas l'efface : si l'île change de
   * taille pendant un fondu, on recopie l'ancienne image (mise à l'échelle) pour
   * que la goutte continue à se fondre au lieu d'apparaître depuis le vide.
   */
  private fitLayers(size: number) {
    const res = Math.max(16, Math.min(512, Math.ceil(size)));
    if (res === this.res) return;
    const old = this.res;
    this.res = res;
    for (const l of [this.live, this.from, this.mix]) {
      const keep = old > 0 && l !== this.live ? copyOf(l.c) : null;
      l.c.width = res;
      l.c.height = res;
      if (keep) {
        l.x.imageSmoothingQuality = "high";
        l.x.drawImage(keep, 0, 0, res, res);
      }
    }
  }

  // ── Une image ──────────────────────────────────────────────────────────────

  private frame(now: number) {
    const anim = this.anim ?? this.manifest.animations.find((a) => a.name === this.manifest.fallback) ?? null;
    if (!anim) return;
    const elapsed = now - this.animStart;
    const t = elapsed / 1000;
    let p: number;
    if (anim.loop) {
      p = (elapsed % anim.durationMs) / anim.durationMs;
    } else {
      p = Math.min(1, elapsed / anim.durationMs);
      if (p >= 1 && !this.ended) {
        this.ended = true;
        for (const cb of [...this.endCallbacks]) cb(anim.name);
      }
    }

    this.updateGaze();
    this.updateBlink(now);

    const size = this.size();
    this.fitLayers(size);

    // 1. Quelle pose ? Si elle change, on fige l'image actuelle et on lance le fondu.
    const pose = this.poseAt(anim, elapsed, now);
    if (pose !== this.shown) {
      if (this.shown) {
        this.from.x.clearRect(0, 0, this.res, this.res);
        this.from.x.drawImage(this.mix.c, 0, 0);
        this.fadeStart = now;
        this.fadeMs = anim.source.fadeMs ?? FADE_MS;
      }
      this.shown = pose;
    }

    // 2. La pose actuelle, avec ses pupilles et sa paupière.
    this.drawPose(this.live.x, pose, anim, t);

    // 3. Le mélange : ancienne × (1 − f) + nouvelle × f.
    const f = this.fadeStart ? Math.min(1, (now - this.fadeStart) / Math.max(1, this.fadeMs)) : 1;
    const m = this.mix.x;
    m.clearRect(0, 0, this.res, this.res);
    if (f < 1) {
      const k = smooth(f);
      m.globalCompositeOperation = "lighter";
      m.globalAlpha = 1 - k;
      m.drawImage(this.from.c, 0, 0);
      m.globalAlpha = k;
      m.drawImage(this.live.c, 0, 0);
      m.globalCompositeOperation = "source-over";
      m.globalAlpha = 1;
    } else {
      this.fadeStart = 0;
      m.drawImage(this.live.c, 0, 0);
    }

    // 4. Sur l'île, avec les mouvements du corps (sauf si l'utilisateur réduit les animations).
    const src = anim.source;
    const motion: Motion = { ...STILL, ...(src.effect && !this.reduced ? EFFECTS[src.effect]?.(t, p) : {}) };
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Le corps est posé en bas : on l'étire depuis la base, comme une vraie goutte.
    const baseX = w / 2 + motion.dx * size;
    const baseY = h / 2 + size / 2 + motion.dy * size;
    ctx.save();
    ctx.globalAlpha = motion.alpha;
    ctx.translate(baseX, baseY);
    ctx.rotate(motion.rot);
    ctx.scale(1 / Math.sqrt(motion.squash), motion.squash);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.mix.c, -size / 2, -size, size, size);
    ctx.restore();

    if (this.mood === "grumpy") this.drawSweat(ctx, baseX, baseY, size, t);

    let overlay = src.overlay ?? "none";
    if (this.sign && overlay === "none") overlay = "question";
    if (overlay !== "none") drawOverlay(ctx, overlay, w / 2, baseY - size * 0.5, size * 0.42, this.reduced ? 0.5 : t);
  }

  /** La pose à montrer à cet instant : suite de poses, variante de repos, ou pose fixe. */
  private poseAt(anim: AnimationSpec, elapsed: number, now: number): string {
    const src = anim.source;
    let pose = src.pose ?? "open";
    if (src.poses?.length) {
      // Une animation en boucle reprend au début ; sinon la dernière image reste.
      const step = Math.floor(elapsed / (src.poseMs ?? 600));
      pose = src.poses[anim.loop ? step % src.poses.length : Math.min(src.poses.length - 1, step)];
    }
    // Au repos, de temps en temps, une variante passe deux secondes et demie.
    if (src.variants?.length && anim.loop && !this.reduced) {
      if (this.variant && now > this.variant.until) {
        this.variant = null;
        this.nextVariant = now + 25_000 + Math.random() * 20_000;
      } else if (!this.variant && now > this.nextVariant) {
        const pick = src.variants[Math.floor(Math.random() * src.variants.length)];
        this.variant = { pose: pick, until: now + 2500 };
      }
      if (this.variant) pose = this.variant.pose;
    }
    return this.poses[pose] ? pose : Object.keys(this.poses)[0] ?? pose;
  }

  // ── Regard et clignement ───────────────────────────────────────────────────

  private updateGaze() {
    const tg = this.target;
    // Plus la souris est loin, plus on regarde sur le côté (sans jamais sortir de l'œil).
    const wx = tg ? tg.x / (Math.abs(tg.x) + 60) : 0;
    const wy = tg ? tg.y / (Math.abs(tg.y) + 80) : 0;
    const soft = this.reduced ? 1 : 0.18;
    this.gx += (wx - this.gx) * soft;
    this.gy += (wy - this.gy) * soft;
    const nearWanted = tg && Math.hypot(tg.x, tg.y) < 90 ? 1 : 0;
    this.near += (nearWanted - this.near) * 0.15;
  }

  private updateBlink(now: number) {
    if (this.reduced) {
      this.blink = 0;
      return;
    }
    if (now >= this.nextBlink && !this.blinkStart) this.blinkStart = now;
    if (!this.blinkStart) return;
    // Vite fermé, un peu plus lent à rouvrir ; parfois deux de suite.
    const k = (now - this.blinkStart) / 190;
    this.blink = k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.6);
    if (k >= 1) {
      this.blinkStart = 0;
      this.blink = 0;
      const again = !this.doubleBlink && Math.random() < 0.2;
      this.doubleBlink = again;
      this.nextBlink = now + (again ? 140 : 2200 + Math.random() * 3800);
    }
  }

  // ── Dessin d'une pose dans un calque ───────────────────────────────────────

  private drawPose(x: CanvasRenderingContext2D, name: string, anim: AnimationSpec, t: number) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, this.res, this.res);
    let spec = this.poses[name];
    let img = this.images.get(name);
    if (!spec || !img?.complete || img.naturalWidth === 0) return;

    // Clignement : quand la paupière dessinée arrive en bas, on montre la vraie pose yeux fermés.
    const closed = spec.blink ? this.images.get(spec.blink) : undefined;
    if (this.blink >= 0.8 && closed?.complete && closed.naturalWidth > 0) {
      name = spec.blink!;
      img = closed;
      spec = this.poses[name] ?? { file: "" };
    }

    x.imageSmoothingQuality = "high";
    x.drawImage(img, 0, 0, this.res, this.res);
    if (!spec.eyes?.length) return;

    // Les pupilles se dessinent dans les coordonnées de la case 256 × 256.
    x.setTransform(this.res / CELL, 0, 0, this.res / CELL, 0, 0);
    const src = anim.source;
    let gx = this.gx;
    let gy = this.gy;
    if (src.look === "up") {
      gx = 0.55;
      gy = -0.75;
    } else if (src.look === "spin" && !this.reduced) {
      gx = Math.cos(t * 9) * 0.8;
      gy = Math.sin(t * 9) * 0.8;
    }
    const lids = this.lids.get(name) ?? [];
    spec.eyes.forEach((e, i) => this.drawEye(x, e, i, gx, gy, !!src.wide, lids[i]));
    x.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawEye(x: CanvasRenderingContext2D, e: PoseEye, i: number, gx: number, gy: number, wide: boolean, lid?: Lid) {
    const pr = PUPIL_R * (wide ? 1.12 : 1) * (1 + this.near * 0.1);
    // Jusqu'où la pupille peut aller sans sortir du blanc.
    const mx = e.rx - pr - 1.5;
    const my = e.ry - pr - 1.5;
    const conv = this.near * 2.2; // de près, les yeux louchent un peu
    const px = e.cx + gx * mx + (i === 0 ? conv : -conv);
    const py = e.cy + gy * my;

    x.save();
    x.beginPath();
    x.ellipse(e.cx, e.cy, e.rx - 0.6, e.ry - 0.6, 0, 0, TAU);
    x.clip();
    // La pupille : un dégradé bleu nuit et deux reflets.
    const g = x.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
    g.addColorStop(0, "#1d2a44");
    g.addColorStop(1, "#0a1020");
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, pr, 0, TAU);
    x.fill();
    x.fillStyle = "#ffffff";
    x.beginPath();
    x.arc(px - pr * 0.32, py - pr * 0.38, pr * 0.34, 0, TAU);
    x.fill();
    x.globalAlpha = 0.85;
    x.beginPath();
    x.arc(px + pr * 0.38, py + pr * 0.36, pr * 0.13, 0, TAU);
    x.fill();
    x.globalAlpha = 1;

    // La paupière descend, de la couleur de la goutte, avec un trait au bord.
    // Fatiguée : elle reste à moitié baissée.
    const lidLevel = Math.max(this.blink, this.mood === "tired" ? 0.4 : 0);
    if (lidLevel > 0.01 && lid) {
      const top = e.cy - e.ry - 2;
      const edge = top + (e.ry * 2 + 4) * Math.min(1, lidLevel);
      const lg = x.createLinearGradient(0, top, 0, edge);
      lg.addColorStop(0, lid.top);
      lg.addColorStop(1, lid.bottom);
      x.fillStyle = lg;
      x.fillRect(e.cx - e.rx - 2, top, e.rx * 2 + 4, edge - top);
      x.strokeStyle = lid.line;
      x.lineWidth = 2;
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(e.cx - e.rx, edge);
      x.quadraticCurveTo(e.cx, edge + (this.blink > 0.9 ? 5 : 2), e.cx + e.rx, edge);
      x.stroke();
    }
    x.restore();
  }

  /**
   * Une goutte de sueur qui perle sur le côté du front, glisse un peu, puis
   * recommence (fixe si l'utilisateur réduit les animations).
   */
  private drawSweat(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, size: number, t: number) {
    const k = this.reduced ? 0.3 : (t % 2.4) / 2.4; // 0 → 1 en 2,4 s
    const r = size * 0.055;
    const x = baseX + size * 0.3;
    const y = baseY - size * 0.72 + k * size * 0.12;
    ctx.save();
    ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
    ctx.beginPath();
    // Une goutte : pointe en haut, ronde en bas.
    ctx.moveTo(x, y - r * 1.9);
    ctx.bezierCurveTo(x + r * 0.4, y - r, x + r, y - r * 0.3, x + r, y + r * 0.2);
    ctx.arc(x, y + r * 0.2, r, 0, Math.PI);
    ctx.bezierCurveTo(x - r, y - r * 0.3, x - r * 0.4, y - r, x, y - r * 1.9);
    const g = ctx.createLinearGradient(x, y - r * 2, x, y + r * 1.2);
    g.addColorStop(0, "#e8f8ff");
    g.addColorStop(1, "#8fd3ff");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(30, 80, 130, 0.55)";
    ctx.lineWidth = Math.max(1, size * 0.008);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y + r * 0.05, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Prend la couleur de la goutte juste au-dessus de chaque œil (une fois, au chargement). */
  private sampleLids(img: HTMLImageElement, eyes: PoseEye[]): Lid[] {
    const fallback: Lid = { top: "#93dcf8", bottom: "#7fc6ef", line: "#2d5f8e" };
    if (!eyes.length) return [];
    try {
      const c = document.createElement("canvas");
      c.width = CELL;
      c.height = CELL;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(img, 0, 0, CELL, CELL);
      return eyes.map((e) => {
        // Une petite bande juste au-dessus du contour de l'œil ; on garde la
        // valeur du milieu (médiane) pour ignorer un bout de sourcil ou de contour.
        const band = x.getImageData(Math.round(e.cx - 8), Math.round(e.cy - e.ry - 5), 17, 1).data;
        const median = (ch: number) => {
          const v: number[] = [];
          for (let i = ch; i < band.length; i += 4) v.push(band[i]);
          return v.sort((a, b) => a - b)[v.length >> 1];
        };
        const [r, g, b] = [median(0), median(1), median(2)];
        const shade = (k: number) => `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
        return { top: shade(1), bottom: shade(0.92), line: shade(0.45) };
      });
    } catch {
      // Lecture des pixels refusée (ne devrait pas arriver : les images sont locales).
      return eyes.map(() => fallback);
    }
  }
}
