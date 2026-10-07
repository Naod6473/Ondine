// Les surprises qui touchent Ondine elle-même, quelle que soit la mascotte :
//   - le mode 8 bits : elle est redessinée en gros pixels, couleurs réduites et
//     contour sombre, comme un sprite de vieille console ;
//   - la division : elle s'élargit, se sépare en deux gouttes reliées par un
//     pont liquide (filtre « goo » : flou + seuil de transparence), elles se
//     regardent, puis se recollent ;
//   - le poisson d'avril : un petit poisson en papier collé dans son dos, qui
//     tombe quand on clique sur elle.
//
// On ne touche pas aux moteurs de dessin : un canvas posé par-dessus la place
// de la mascotte recopie à chaque image le canvas de la mascotte
// (`canvas.mascot-canvas`), transformé. Pendant le 8 bits ou la division, le
// canvas d'origine est masqué (classe `fx-hide`). La boucle ne tourne que
// pendant un effet.

import { sounds } from "../island/sounds";

/** Le calque est plus grand que la mascotte : 3 fois sa largeur, 1,6 fois sa hauteur. */
const SPAN_X = 3;
const SPAN_Y = 1.6;
/** Où se trouve la mascotte dans le calque (en fraction de sa taille). */
const SLOT_X = 1;
const SLOT_Y = 0.3;
/** La grille du 8 bits (pixels de côté). */
const PIXELS = 22;
const SPLIT_MS = 3000;
const FISH_FALL_MS = 900;

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const easeInOut = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

let gooId = 0;

export class MascotFx {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tiny = document.createElement("canvas");
  private tinyCtx = this.tiny.getContext("2d", { willReadFrequently: true })!;
  private goo: SVGFEGaussianBlurElement;
  private gooUrl: string;
  private raf = 0;

  private pixel = false;
  private splitStart = 0;
  private splitDone: (() => void) | null = null;
  private fish = false;
  private fishFall = 0;

  constructor(private readonly slot: HTMLElement) {
    this.canvas.className = "mascot-fx";
    this.canvas.setAttribute("aria-hidden", "true");
    this.tiny.width = PIXELS;
    this.tiny.height = PIXELS;
    // Le filtre « goo » : un flou, puis on durcit la transparence. Deux formes
    // proches se rejoignent alors par un pont arrondi, comme deux gouttes d'eau.
    const id = `ondine-goo-${++gooId}`;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    const filter = document.createElementNS(ns, "filter");
    filter.id = id;
    this.goo = document.createElementNS(ns, "feGaussianBlur");
    this.goo.setAttribute("in", "SourceGraphic");
    this.goo.setAttribute("stdDeviation", "3");
    this.goo.setAttribute("result", "blur");
    const matrix = document.createElementNS(ns, "feColorMatrix");
    matrix.setAttribute("in", "blur");
    matrix.setAttribute("mode", "matrix");
    matrix.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9");
    matrix.setAttribute("result", "goo");
    const comp = document.createElementNS(ns, "feComposite");
    comp.setAttribute("in", "SourceGraphic");
    comp.setAttribute("in2", "goo");
    comp.setAttribute("operator", "atop");
    const merge = document.createElementNS(ns, "feMerge");
    for (const input of ["goo", "atop"]) {
      const node = document.createElementNS(ns, "feMergeNode");
      node.setAttribute("in", input);
      merge.append(node);
    }
    comp.setAttribute("result", "atop");
    filter.append(this.goo, matrix, comp, merge);
    svg.append(filter);
    document.body.append(svg);
    this.gooUrl = `url(#${id})`;
  }

  /** Le mode 8 bits. */
  setPixel(on: boolean) {
    this.pixel = on;
    this.update();
  }

  get isPixel(): boolean {
    return this.pixel;
  }

  /** La division en deux gouttes ; la promesse se résout quand elles se sont recollées. */
  split(): Promise<void> {
    if (this.splitStart) return Promise.resolve();
    this.splitStart = performance.now();
    this.update();
    return new Promise((resolve) => (this.splitDone = resolve));
  }

  get splitting(): boolean {
    return this.splitStart !== 0;
  }

  /** Le poisson d'avril dans le dos. */
  setFish(on: boolean) {
    this.fish = on;
    this.fishFall = 0;
    this.update();
  }

  get hasFish(): boolean {
    return this.fish && !this.fishFall;
  }

  /** Le poisson tombe (un clic sur Ondine). */
  dropFish() {
    if (!this.fish || this.fishFall) return;
    this.fishFall = performance.now();
    this.update();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.remove();
    this.slot.classList.remove("fx-hide");
    document.getElementById(this.gooUrl.slice(5, -1))?.closest("svg")?.remove();
    this.splitDone?.();
  }

  // ── La boucle ──────────────────────────────────────────────────────────────

  private active(): boolean {
    return this.pixel || this.splitStart !== 0 || this.fish;
  }

  private update() {
    const on = this.active();
    if (on && !this.canvas.isConnected) this.slot.append(this.canvas);
    this.slot.classList.toggle("fx-hide", this.pixel || this.splitStart !== 0);
    this.canvas.style.filter = this.splitStart ? this.gooUrl : "";
    if (on && !this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
    if (!on) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.canvas.remove();
    }
  }

  private source(): HTMLCanvasElement | null {
    return this.slot.querySelector<HTMLCanvasElement>("canvas.mascot-canvas");
  }

  private frame(now: number) {
    this.raf = 0;
    if (!this.active()) return;
    try {
      this.draw(now);
    } catch {
      // Un dessin raté ne doit rien casser : on réessaie à l'image suivante.
    }
    if (this.active()) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private draw(now: number) {
    const src = this.source();
    const r = this.slot.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const u = Math.max(1, Math.round(r.width * dpr));
    const W = Math.round(u * SPAN_X);
    const H = Math.round(u * SPAN_Y);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (!src || u < 4) return;

    // Le corps à dessiner : la mascotte telle quelle, ou en gros pixels.
    let body: CanvasImageSource = src;
    if (this.pixel) {
      this.pixelate(src);
      body = this.tiny;
    }
    ctx.imageSmoothingEnabled = !this.pixel;

    const x0 = SLOT_X * u;
    const y0 = SLOT_Y * u;
    if (this.splitStart) {
      this.goo.setAttribute("stdDeviation", String(Math.max(1.5, (u / dpr) * 0.07)));
      this.drawSplit(ctx, body, x0, y0, u, now);
    } else if (this.pixel) {
      ctx.drawImage(body, x0, y0, u, u);
    }
    if (this.fish) this.drawFish(ctx, x0, y0, u, now);
  }

  /**
   * La division, en quatre temps : elle s'élargit (0 → 12 %), les deux gouttes
   * s'écartent (→ 35 %), restent un instant en se dandinant (→ 65 %), puis se
   * recollent avec un rebond (→ 100 %).
   */
  private drawSplit(ctx: CanvasRenderingContext2D, body: CanvasImageSource, x0: number, y0: number, u: number, now: number) {
    const k = (now - this.splitStart) / SPLIT_MS;
    if (k >= 1) {
      this.splitStart = 0;
      const done = this.splitDone;
      this.splitDone = null;
      this.update();
      done?.();
      if (!this.pixel) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      else ctx.drawImage(body, x0, y0, u, u);
      return;
    }
    // Le point d'appui : le bas de la goutte, au milieu.
    const baseX = x0 + u / 2;
    const baseY = y0 + u * 0.92;
    const piece = (dx: number, scale: number, sx: number, sy: number, bob: number) => {
      ctx.save();
      ctx.translate(baseX + dx, baseY + bob);
      ctx.scale(scale * sx, scale * sy);
      ctx.drawImage(body, -u / 2, -u * 0.92, u, u);
      ctx.restore();
    };
    if (k < 0.12) {
      // Elle s'élargit et se tasse.
      const p = easeInOut(k / 0.12);
      piece(0, 1, 1 + 0.35 * p, 1 - 0.18 * p, 0);
      return;
    }
    if (k < 0.35) {
      const p = ease((k - 0.12) / 0.23);
      if (k - 0.12 < 0.02 && !this.splitPlop) {
        this.splitPlop = true;
        sounds.plop();
      }
      const d = p * u * 0.42;
      const s = 1 - 0.28 * p;
      const squash = 1 - 0.18 * (1 - p);
      piece(-d, s, 1 + 0.35 * (1 - p), squash, 0);
      piece(d, s, 1 + 0.35 * (1 - p), squash, 0);
      return;
    }
    if (k < 0.65) {
      const t = (k - 0.35) * SPLIT_MS;
      const bob = (i: number) => -Math.abs(Math.sin(t / 160 + i * 1.6)) * u * 0.05;
      piece(-u * 0.42, 0.72, 1, 1, bob(0));
      piece(u * 0.42, 0.72, 1, 1, bob(1));
      return;
    }
    if (k < 0.85) {
      const p = easeInOut((k - 0.65) / 0.2);
      const d = (1 - p) * u * 0.42;
      const s = 0.72 + 0.28 * p;
      piece(-d, s, 1 + 0.25 * p, 1 - 0.1 * p, 0);
      piece(d, s, 1 + 0.25 * p, 1 - 0.1 * p, 0);
      if (p > 0.9 && this.splitPlop) {
        this.splitPlop = false;
        sounds.plop();
      }
      return;
    }
    // Le rebond : elle s'étire en hauteur, puis revient.
    const p = (k - 0.85) / 0.15;
    const wob = Math.sin(p * Math.PI * 2) * (1 - p) * 0.12;
    piece(0, 1, 1.25 * (1 - p) + p - wob, 0.9 * (1 - p) + p + wob, 0);
  }
  private splitPlop = false;

  /**
   * Le 8 bits : la mascotte réduite à PIXELS × PIXELS, transparence tranchée,
   * cinq niveaux par couleur, et un contour sombre autour du corps.
   */
  private pixelate(src: HTMLCanvasElement) {
    const t = this.tinyCtx;
    t.clearRect(0, 0, PIXELS, PIXELS);
    t.imageSmoothingEnabled = true;
    t.imageSmoothingQuality = "high";
    t.drawImage(src, 0, 0, PIXELS, PIXELS);
    const img = t.getImageData(0, 0, PIXELS, PIXELS);
    const d = img.data;
    const step = 255 / 4;
    const solid = new Uint8Array(PIXELS * PIXELS);
    for (let i = 0; i < PIXELS * PIXELS; i++) {
      const a = d[i * 4 + 3];
      if (a > 110) {
        solid[i] = 1;
        // Les couleurs « prémultipliées » à moitié transparentes : on les remonte.
        const k = 255 / a;
        for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(Math.min(255, d[i * 4 + c] * (a < 250 ? k : 1)) / step) * step;
        d[i * 4 + 3] = 255;
      } else d[i * 4 + 3] = 0;
    }
    // Le contour : chaque pixel vide qui touche le corps devient bleu nuit.
    for (let y = 0; y < PIXELS; y++) {
      for (let x = 0; x < PIXELS; x++) {
        const i = y * PIXELS + x;
        if (solid[i]) continue;
        const near = (x > 0 && solid[i - 1]) || (x < PIXELS - 1 && solid[i + 1]) || (y > 0 && solid[i - PIXELS]) || (y < PIXELS - 1 && solid[i + PIXELS]);
        if (!near) continue;
        d[i * 4] = 16;
        d[i * 4 + 1] = 32;
        d[i * 4 + 2] = 46;
        d[i * 4 + 3] = 255;
      }
    }
    t.putImageData(img, 0, 0);
  }

  /** Le petit poisson en papier collé dans son dos (et sa chute). */
  private drawFish(ctx: CanvasRenderingContext2D, x0: number, y0: number, u: number, now: number) {
    let fall = 0;
    if (this.fishFall) {
      fall = (now - this.fishFall) / FISH_FALL_MS;
      if (fall >= 1) {
        this.fish = false;
        this.fishFall = 0;
        this.update();
        return;
      }
    }
    const s = u * 0.3;
    const x = x0 + u * 0.8 + fall * u * 0.15;
    const y = y0 + u * 0.66 + fall * fall * u * 0.9;
    const sway = Math.sin(now / 500) * 0.12;
    ctx.save();
    ctx.globalAlpha = 1 - fall;
    ctx.translate(x, y);
    ctx.rotate(-0.35 + sway + fall * 1.8);
    ctx.imageSmoothingEnabled = true;
    // Le corps (une amande), la queue, un œil, et un bout de ruban adhésif.
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, 0);
    ctx.quadraticCurveTo(-s * 0.05, -s * 0.36, s * 0.32, 0);
    ctx.quadraticCurveTo(-s * 0.05, s * 0.36, -s * 0.5, 0);
    ctx.moveTo(s * 0.28, 0);
    ctx.lineTo(s * 0.55, -s * 0.2);
    ctx.lineTo(s * 0.55, s * 0.2);
    ctx.closePath();
    ctx.fillStyle = "#ffb469";
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.strokeStyle = "#9a4f1c";
    ctx.stroke();
    ctx.fillStyle = "#3a2410";
    ctx.beginPath();
    ctx.arc(-s * 0.3, -s * 0.04, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
    if (!this.fishFall) {
      ctx.fillStyle = "rgba(255, 255, 240, 0.7)";
      ctx.fillRect(-s * 0.08, -s * 0.24, s * 0.16, s * 0.12);
    }
    ctx.restore();
  }
}
