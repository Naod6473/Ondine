// Moteur « planche de sprites » : une image PNG par animation, dont les images
// (frames) sont alignées sur une ligne, toutes de la même largeur.
//
// Deux façons de lire une planche :
//   - "play" : les images défilent dans le temps (fps) ;
//   - "gaze" : l'image est choisie selon la position de la souris, de la plus à
//     gauche (première image) à la plus à droite (dernière). Avec `nearFile`, une
//     seconde planche sert quand la souris est tout près (regard « de près »).
//
// En plus, `effect` anime le corps par du code (respiration, saut, tremblement…)
// et `overlay` dessine un effet autour (zzz, confettis…). Ça permet d'avoir tous
// les états dès maintenant, avant d'avoir une vraie planche pour chacun.

import type { MascotRenderer } from "../renderer";
import type { AnimationSpec, MascotManifest, MascotState, Mood } from "../types";
import { EFFECTS, STILL, type Motion } from "./effects";
import { drawOverlay } from "./overlays";


export class SpriteSheetRenderer implements MascotRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private observer: ResizeObserver | null = null;
  private raf = 0;
  private images = new Map<string, HTMLImageElement>();
  private anim: AnimationSpec | null = null;
  private animStart = 0;
  private ended = false;
  private endCallbacks: ((name: string) => void)[] = [];
  /** Position de la souris par rapport au centre de la mascotte (px), ou null. */
  private target: { x: number; y: number } | null = null;
  /** Regard horizontal lissé, de -1 (gauche) à 1 (droite). */
  private gaze = 0;

  constructor(
    private readonly manifest: MascotManifest,
    assets: Record<string, string>,
  ) {
    // On charge toutes les planches tout de suite, pour qu'aucune ne clignote au premier affichage.
    for (const a of manifest.animations) {
      for (const file of [a.source.file, a.source.nearFile]) {
        if (!file || this.images.has(file)) continue;
        const url = assets[file];
        if (!url) {
          console.warn(`[mascotte] fichier introuvable : ${file}`);
          continue;
        }
        const img = new Image();
        img.src = url;
        this.images.set(file, img);
      }
    }
  }

  mount(container: HTMLElement) {
    this.canvas.className = "mascot-canvas";
    Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block" });
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    const loop = () => {
      this.frame(performance.now());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  play(animation: AnimationSpec) {
    this.anim = animation;
    this.animStart = performance.now();
    this.ended = false;
  }

  setState(_state: MascotState) {}

  setMood(_mood: Mood) {
    // Pas encore de variantes d'humeur dans les planches.
  }

  lookAt(x: number | null, y: number | null) {
    this.target = x == null || y == null ? null : { x, y };
  }

  onAnimationEnd(cb: (name: string) => void) {
    this.endCallbacks.push(cb);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
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
    const anim = this.anim ?? this.manifest.animations.find((a) => a.name === this.manifest.fallback) ?? null;
    if (!anim) return;
    const elapsed = now - this.animStart;
    const dur = anim.durationMs;
    const t = elapsed / 1000;
    let p: number;
    if (anim.loop) {
      p = (elapsed % dur) / dur;
    } else {
      p = Math.min(1, elapsed / dur);
      if (p >= 1 && !this.ended) {
        this.ended = true;
        for (const cb of [...this.endCallbacks]) cb(anim.name);
      }
    }

    const src = anim.source;
    // Le regard glisse doucement vers la souris (ou revient au centre).
    const want = this.target ? this.target.x / (Math.abs(this.target.x) + 60) : 0;
    this.gaze += (want - this.gaze) * 0.2;

    // Quelle planche, quelle image ?
    let file = src.file;
    const frames = Math.max(1, src.frames ?? 1);
    let index: number;
    if (src.mode === "gaze") {
      const near = this.target && Math.hypot(this.target.x, this.target.y) < (src.nearDistance ?? 90);
      if (near && src.nearFile) file = src.nearFile;
      index = Math.round(((this.gaze + 1) / 2) * (frames - 1));
    } else {
      const fps = src.fps ?? (frames * 1000) / dur;
      index = anim.loop ? Math.floor(t * fps) % frames : Math.min(frames - 1, Math.floor(p * frames));
    }
    const img = file ? this.images.get(file) : undefined;

    const motion: Motion = { ...STILL, ...(src.effect ? EFFECTS[src.effect]?.(t, p) : {}) };
    this.draw(img, index, frames, motion, src.overlay ?? "none", t);
  }

  private draw(img: HTMLImageElement | undefined, index: number, frames: number, m: Motion, overlay: Parameters<typeof drawOverlay>[1], t: number) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const fw = img.naturalWidth / frames;
    const fh = img.naturalHeight;
    // On garde de la marge autour pour les effets (sauts, zzz…).
    const size = Math.min(w, h) * 0.84;
    const scale = size / Math.max(fw, fh);
    const dw = fw * scale;
    const dh = fh * scale;
    // Le corps est posé en bas : on étire depuis la base, comme une vraie goutte.
    const baseX = w / 2 + m.dx * dh;
    const baseY = h / 2 + dh / 2 + m.dy * dh;

    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.translate(baseX, baseY);
    ctx.rotate(m.rot);
    ctx.scale(1 / Math.sqrt(m.squash), m.squash);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, index * fw, 0, fw, fh, -dw / 2, -dh, dw, dh);
    ctx.restore();

    if (overlay !== "none") drawOverlay(ctx, overlay, w / 2, baseY - dh * 0.5, dh * 0.42, t);
  }
}
