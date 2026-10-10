// L'écran de veille d'Ondine (1.2.3) : la fenêtre « screensaver »
// (src-tauri/src/modules/screensaver.rs la montre et la cache).
//
// Un fond sombre, l'heure au centre (avec la date), une eau qui ondule en bas
// de l'écran aux couleurs de la goutte gomme, et Ondine qui se promène au bord
// de l'eau, se pose, repart, en suivant la houle (walk.ts). Elle regarde où
// elle va et se dandine en marchant.
//
// Rien n'anime tant que la fenêtre est cachée : le Rust envoie « screensaver »
// {on: true, clock, walk} en la montrant, {on: false} juste avant de la cacher
// (la page s'efface en 250 ms). 30 images par seconde au plus (un écran de
// veille tourne longtemps ; 20 en économie d'énergie). « Réduire les
// animations » : Ondine reste assise, l'eau est figée, seule l'heure change ;
// réglage Calme : elle se pose plus souvent. La fermeture (souris, clavier)
// est décidée par le Rust, qui lit l'inactivité de Windows.

import { Bridge, IS_TAURI, onTauriEvent } from "../core/bridge";
import { Bus } from "../core/bus";
import { currentLang, startI18n } from "../core/i18n";
import { logger } from "../core/log";
import { perfMode, startPerf } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import { el } from "../island/dom";
import { reducedMotion } from "../island/tab-pill";
import { findMascot } from "../mascot/catalog";
import { calmMode, MascotController } from "../mascot/mascot-state";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { clockDrift, clockText, newWalker, stepWalker, waveHeight, type Walker } from "./walk";

const log = logger("veille");
/** La taille d'Ondine (px CSS). */
const MASCOT = 132;
/** La houle occupe le bas de l'écran ; le niveau de l'eau est à 78 % de la hauteur. */
const WATER = 0.78;
/** Les couleurs de la goutte gomme (gum-draw.ts), du clair au profond. */
const GUM = ["#c9f0ff", "#5cc8ff", "#1f86e0", "#145a9e"];

/** Un bus qui ne sort pas de cette page (la mascotte d'ici ne parle pas à l'île). */
class LocalBus extends Bus {
  override emit(topic: string, payload: unknown = null, source = "screensaver") {
    this.inject(topic, payload, source);
  }
}

interface SaverNews {
  on: boolean;
  clock?: boolean;
  walk?: boolean;
}

class Saver {
  private readonly canvas = el("canvas", { class: "saver-water", "aria-hidden": "true" }) as HTMLCanvasElement;
  private readonly time = el("div", { class: "saver-time", "data-no-i18n": true });
  private readonly date = el("div", { class: "saver-date", "data-no-i18n": true });
  private readonly clock = el("div", { class: "saver-clock" }, this.time, this.date);
  private readonly slot = el("div", { class: "saver-mascot" });
  private renderer: MascotRenderer | null = null;
  private mascot: MascotController | null = null;
  private mascotId = "";
  private walker: Walker = newWalker(0);
  private raf = 0;
  private timer = 0;
  private last = 0;
  private on = false;
  private walkOn = true;
  private shownMinute = "";

  constructor(root: HTMLElement) {
    root.append(this.canvas, this.clock, this.slot);
    window.addEventListener("resize", () => this.fit());
    settingsStore.onChange(() => this.loadMascot());
  }

  set(n: SaverNews) {
    this.on = n.on;
    document.body.classList.toggle("on", n.on);
    this.clock.hidden = n.clock === false;
    this.walkOn = n.walk !== false;
    window.cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    if (!n.on) {
      this.mascot?.destroy();
      this.mascot = null;
      this.renderer = null;
      this.mascotId = "";
      // Le fondu de sortie (250 ms) avant d'ôter la mascotte.
      window.setTimeout(() => this.on || this.slot.replaceChildren(), 300);
      return;
    }
    this.loadMascot();
    this.walker = newWalker(performance.now());
    this.last = 0;
    this.fit();
    this.frame();
  }

  /** La mascotte des réglages (chargée à l'affichage, oubliée en partant). */
  private loadMascot() {
    if (!this.on) return;
    const s = settingsStore.current;
    const id = s.mascot.enabled ? s.mascot.id : "";
    if (id === this.mascotId) return;
    this.mascot?.destroy();
    this.mascot = null;
    this.renderer = null;
    this.slot.replaceChildren();
    this.mascotId = id;
    const entry = id ? findMascot(id) : null;
    if (!entry) return;
    const renderer = createRenderer(entry.manifest, entry.assets);
    renderer.mount(this.slot);
    this.renderer = renderer;
    // Un bus à elle, jamais relié au Rust : elle vit sa vie (clignements, petits gestes) sans rien écouter.
    this.mascot = new MascotController(entry.manifest, renderer, new LocalBus("screensaver"), { boredAfterMs: 60_000, sleepAfterMs: 3_600_000 });
  }

  private fit() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  private frame() {
    if (!this.on) return;
    const now = performance.now();
    const dt = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    const still = reducedMotion();
    const t = still ? 0 : now / 1000;
    if (!still && this.walkOn) this.walker = stepWalker(this.walker, dt, now, Math.random, calmMode());
    this.drawWater(t);
    this.placeMascot(t, still || !this.walkOn);
    this.drawClock();
    if (still) {
      // Figé : seule l'heure change, une fois par seconde.
      this.timer = window.setTimeout(() => this.frame(), 1000);
      return;
    }
    const fps = perfMode() === "eco" ? 20 : 30;
    this.timer = window.setTimeout(() => (this.raf = requestAnimationFrame(() => this.frame())), 1000 / fps - 4);
  }

  private drawWater(t: number) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    const amp = h * 0.018;
    // Trois couches, de la plus lointaine (claire, transparente) à la plus proche (profonde).
    for (let layer = 0; layer < 3; layer++) {
      const base = h * (WATER + layer * 0.035);
      const grad = ctx.createLinearGradient(0, base - amp * 2, 0, h);
      grad.addColorStop(0, hexA(GUM[layer], 0.32 + layer * 0.12));
      grad.addColorStop(1, hexA(GUM[3], 0.5 + layer * 0.15));
      ctx.beginPath();
      ctx.moveTo(0, h);
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const x = i / steps;
        ctx.lineTo(x * w, base + waveHeight(x, t, layer) * amp * (1 - layer * 0.2));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    // Un reflet clair sur la crête la plus proche.
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      const y = h * WATER + waveHeight(x, t, 0) * amp;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(x * w, y);
    }
    ctx.strokeStyle = hexA(GUM[0], 0.35);
    ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.2);
    ctx.stroke();
  }

  /** Ondine au bord de l'eau, portée par la houle, tournée vers où elle va. */
  private placeMascot(t: number, sitting: boolean) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = (sitting ? 0.5 : this.walker.x) * w;
    const y = h * WATER + waveHeight(x / w, t, 0) * h * 0.018 - MASCOT * 0.82;
    this.slot.style.transform = `translate(${(x - MASCOT / 2).toFixed(1)}px, ${y.toFixed(1)}px)`;
    const walking = !sitting && this.walker.walking;
    this.slot.classList.toggle("walking", walking);
    this.slot.dataset.walk = this.walker.dir > 0 ? "right" : "left";
    this.renderer?.lookAt(walking ? this.walker.dir * 60 : null, walking ? 10 : null);
  }

  private drawClock() {
    const d = new Date();
    const english = currentLang() === "en";
    const minute = `${d.getHours()}:${d.getMinutes()}`;
    if (minute === this.shownMinute) return;
    this.shownMinute = minute;
    this.time.textContent = clockText(d, english);
    this.date.textContent = d.toLocaleDateString(english ? "en-US" : "fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const drift = clockDrift(Date.now());
    this.clock.style.translate = `${drift.x}px ${drift.y}px`;
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);
  await startI18n();
  await startPerf();
  const saver = new Saver(document.getElementById("root")!);
  void onTauriEvent<SaverNews>("screensaver", (n) => saver.set(n));
  // Dans un navigateur (npm run dev, /screensaver.html) : un aperçu, pour travailler l'apparence.
  if (!IS_TAURI) saver.set({ on: true, clock: true, walk: true });
  log.info("écran de veille prêt");
}

void start();
