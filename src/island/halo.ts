// Le halo de l'île : un liseré de lumière qui court sur son contour et déborde
// autour d'elle, en dégradés animés (jamais une couleur plate), avec des
// vagues qui partent de l'île comme des ondes sur l'eau.
//
// ── L'API (pour les modules et les autres zones de l'appli) ─────────────────
//
//   import { showHalo, hideHalo, updateHalo } from "../../island/halo";
//   const id = showHalo({ palette: "charge", shape: "sweep", from: "left", fill: 0.56, durationMs: 2500 });
//   updateHalo(id, { level: 0.7 });   // forme "level" : suit un niveau (voix, musique)
//   hideHalo(id);                      // s'éteint en douceur
//
// Ou par le bus, depuis n'importe quel module (déclarer "island.halo" dans
// `events.emits`) ou une autre fenêtre :
//   api.emit("island.halo", { action: "show", id: "ask-think", palette: "think", shape: "drops" });
//   api.emit("island.halo", { action: "level", id: "voice", level: 0.4 });
//   api.emit("island.halo", { action: "hide", id: "ask-think" });
//
// Les options (toutes facultatives) :
//   id         même id = la demande remplace l'ancienne (sinon un id est inventé et renvoyé)
//   palette    un nom de PALETTES (halo-palettes.ts) ou une liste de couleurs « #rrggbb »
//   shape      la façon de bouger (HaloShape ci-dessous), "aurora" par défaut
//   rhythm     "slow" | "calm" | "medium" | "fast" | "heartbeat" | une période en ms
//   durationMs combien de temps (0 ou absent = jusqu'à hideHalo)
//   fill       0 à 1 : la part du contour allumée (niveau de charge, jauge, disque)
//   from       d'où part un balayage, une vague, une onde : "left", "right", "center" (les deux côtés)
//   priority   "low" | "normal" | "high" | "critical" : une demande plus
//              prioritaire passe devant ; l'état d'avant revient quand elle finit
//   level      0 à 1, pour la forme "level"
//   endsAt     forme "progress" : l'heure de fin (Date.now()), le liseré se vide jusque-là
//   total      forme "progress" : la durée complète (ms)
//
// ── Les formes ───────────────────────────────────────────────────────────────
//   aurora     les couleurs coulent en continu autour de l'île
//   breathe    la lueur gonfle et retombe (respiration ; "heartbeat" : boum-boum)
//   comet      une tête brillante fait le tour en laissant une traînée
//   sweep      une vague de couleur part d'un côté et remplit le contour (jusqu'à `fill`)
//   burst      un éclat qui embrase tout le contour, puis une pluie d'étincelles
//   ripple     la couleur part d'un point et se propage des deux côtés (une goutte qui tombe)
//   waves      des ondes qui partent de l'île comme des ronds dans l'eau
//   drops      trois gouttes qui se courent après (Ondine réfléchit)
//   crackle    le contour grésille par à-coups (signal faible)
//   reservoir  l'eau monte jusqu'à `fill`, et déborde en gouttes au-delà de 95 %
//   rain       des gouttes ruissellent le long de l'île (l'orage ajoute un éclair)
//   rise / set la lumière monte depuis le bas (lever de soleil) ou redescend (coucher)
//   cocoon     une lueur serrée et très douce (concentration)
//   level      la lueur et les vagues suivent un niveau donné par updateHalo
//   progress   un liseré qui fait le tour de l'île et se vide au fil du temps
//              (minuteurs) : donner `endsAt` (Date.now() de la fin) et `total`
//              (ms) ; il est recalculé à chaque image (aucun saut), passe au
//              rouge dans les dernières secondes. Sans `endsAt` (en pause) : figé à `fill`.
//
// ── Comment c'est dessiné ────────────────────────────────────────────────────
// Un <canvas> transparent, sous l'île, de la taille de la fenêtre, qui laisse
// passer la souris. À chaque image on lit la boîte de l'île (sa forme en gelée
// comprise, jelly.ts) et on trace son contour en plusieurs passes de plus en
// plus fines (la lueur, puis le trait), sans flou : en style Classique comme
// en Studio, c'est seulement de la lumière. Les couleurs viennent d'un dégradé
// conique qui tourne ; en mode sombre elles s'additionnent (« lighter »).
//
// ── Performance et accessibilité ─────────────────────────────────────────────
//   - aucune boucle quand aucun halo n'est montré, ni quand l'île est cachée ;
//   - 30 images/s au plus en économie d'énergie, 30 pour les halos lents ;
//   - « Réduire les animations » de Windows ou le réglage Calme de la mascotte :
//     un halo fixe, sans vagues ni étincelles, dessiné une fois ;
//   - aucune pulsation plus rapide que ~2 par seconde (MIN_PERIOD_MS).
//
// Le réglage maître est le module « Animations de l'île » (src/modules/halos/) :
// désactivé, aucun halo ne s'allume. Son intensité (Discret / Normal / Vif) et
// ses couleurs (Selon l'état / Arc-en-ciel / Couleur de ma mascotte) s'appliquent
// à tous les halos.

import type { Bus } from "../core/bus";
import { ECO_FPS, perfMode } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import { calmMode } from "../mascot/mascot-state";
import { palette as gumPalette, TINT_NAMES, type GumTint } from "../mascot/renderers/gum-draw";
import { sampleContour, type ContourPoint, type Rect } from "./contour";
import { HaloStack, priorityOf, type HaloPriority } from "./halo-stack";
import {
  INTENSITY,
  intensityOf,
  isPaletteName,
  mix,
  paletteColors,
  PALETTES,
  progressLeft,
  progressWarn,
  pulse,
  rgba,
  rgbToHex,
  rhythmMs,
  type PaletteName,
  type Rhythm,
} from "./halo-palettes";
import { stepSpring, type Spring, type SpringParams } from "./spring";
import { reducedMotion } from "./tab-pill";

export type HaloShape =
  | "aurora"
  | "breathe"
  | "comet"
  | "sweep"
  | "burst"
  | "ripple"
  | "waves"
  | "drops"
  | "crackle"
  | "reservoir"
  | "rain"
  | "rise"
  | "set"
  | "cocoon"
  | "level"
  | "progress";

const SHAPES: readonly HaloShape[] = ["aurora", "breathe", "comet", "sweep", "burst", "ripple", "waves", "drops", "crackle", "reservoir", "rain", "rise", "set", "cocoon", "level", "progress"];

export type HaloFrom = "left" | "right" | "center";

export interface HaloOptions {
  id?: string;
  palette?: PaletteName | string[];
  shape?: HaloShape;
  rhythm?: Rhythm;
  durationMs?: number;
  fill?: number;
  from?: HaloFrom;
  priority?: HaloPriority;
  level?: number;
  endsAt?: number | null;
  total?: number;
}

/** Une demande en cours. */
interface Halo {
  id: string;
  priority: HaloPriority;
  colors: string[];
  /** La palette demandée (pour la recalculer quand le fond change de clair à sombre). */
  paletteReq: PaletteName | string[];
  shape: HaloShape;
  rhythm: Rhythm;
  durationMs: number;
  fill: number;
  from: HaloFrom;
  /** Niveau visé (forme "level") et niveau lissé. */
  level: number;
  levelS: Spring;
  /** Forme "progress" : heure de fin (Date.now()) et durée complète ; null = figé à `fill`. */
  endsAt: number | null;
  total: number;
  start: number;
  /** Fondu d'entrée / de sortie (ressort : l'entrée dépasse un peu, ça « embrase »). */
  env: Spring;
  /** Fini : s'éteint, puis disparaît. */
  ending: boolean;
  timer: number;
  /** Étincelles et gouttes en vol. */
  particles: Particle[];
  /** Les ondes (forme waves, level) : instant de départ de chacune. */
  rings: number[];
  lastRing: number;
  ringsSpawned: number;
  /** Les touches sur l'île : une onde de couleur part de là (u : place sur le contour). */
  pokes: { u: number; at: number }[];
  /** Graines du hasard propres à ce halo (grésillement, pluie). */
  seed: number;
  lastFlash: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
  size: number;
  /** Une goutte (allongée, tombe) plutôt qu'une étincelle (ronde). */
  drop?: boolean;
}

const ENTER: SpringParams = { stiffness: 260, damping: 0.55 };
const LEAVE: SpringParams = { stiffness: 110, damping: 1 };
const LEVEL: SpringParams = { stiffness: 180, damping: 0.7 };
/** Les ondes (waves) : jusqu'où elles vont (px) et combien de temps elles vivent. */
const RING_REACH = 26;
/** Les halos lents n'ont pas besoin de plus de 30 images par seconde. */
const SLOW_FPS = 30;
/**
 * Le liseré d'un minuteur avance de quelques pixels par minute : 12 images par
 * seconde suffisent pour qu'il glisse sans saut (30 dans les dernières secondes).
 */
const PROGRESS_FPS = 12;
/** Animations réduites ou Calme : le liseré d'un minuteur est redessiné (sans bouger) toutes les 5 s. */
const STILL_PROGRESS_MS = 5000;


// ── L'état partagé ───────────────────────────────────────────────────────────

let layer: HaloLayer | null = null;
/** Les demandes faites avant que l'île n'existe (ou dans une autre fenêtre : ignorées). */
let counter = 0;

/** Allume un halo autour de l'île. Renvoie son id (pour updateHalo, hideHalo). */
export function showHalo(o: HaloOptions = {}): string {
  const id = o.id && /^[\w.:-]{1,64}$/.test(o.id) ? o.id : `halo-${++counter}`;
  layer?.show(id, o);
  return id;
}

/** Éteint un halo (en douceur). */
export function hideHalo(id: string): void {
  layer?.hide(id);
}

/** Change le niveau (forme "level"), la part allumée (`fill`) ou la palette d'un halo montré. */
export function updateHalo(id: string, o: { level?: number; fill?: number; palette?: PaletteName | string[] }): void {
  layer?.update(id, o);
}

/** Un halo est-il allumé avec cet id ? */
export function haloShown(id: string): boolean {
  return layer?.has(id) ?? false;
}

/** Les halos sont-ils permis (module « Animations de l'île » activé) ? */
export function halosEnabled(): boolean {
  return settingsStore.current.modules?.halos?.enabled !== false;
}

/**
 * Les halos sont permis ET la catégorie `key` (un réglage booléen du module
 * « Animations de l'île », ex. "think", "update") n'est pas coupée.
 */
export function haloAllowed(key: string): boolean {
  return halosEnabled() && settingsStore.current.modules?.halos?.values?.[key] !== false;
}

/** L'id du halo « Ondine réfléchit » (trois gouttes qui se courent après). */
export const THINK_HALO = "ondine-think";

/**
 * « Ondine réfléchit » : trois gouttes de couleur qui se courent après autour
 * de l'île, tant que Parler à Ondine attend sa réponse (écrite ou à voix
 * haute). `ondineThinking(true)` au départ, `ondineThinking(false)` à la
 * réponse ou à l'erreur. Coupé par le réglage « Ondine réfléchit ».
 * Aussi par le bus : `island.halo` {action: "think", on}.
 */
export function ondineThinking(on: boolean): void {
  if (on && haloAllowed("think")) showHalo({ id: THINK_HALO, palette: "think", shape: "drops", rhythm: 2200 });
  else hideHalo(THINK_HALO);
}

/** Les couleurs de la mascotte, pour un halo qui « répond » à la mascotte. */
export function mascotPalette(): string[] {
  return mascotColors();
}

/**
 * Branche le halo sur l'île (appelé une fois par island.ts). `state` : l'état
 * de l'île (rien n'est dessiné quand elle est cachée : la fenêtre n'est plus
 * qu'une bande de 6 px).
 */
export function attachHalo(root: HTMLElement, shell: HTMLElement, bus: Bus, state: () => string): void {
  if (layer) return;
  layer = new HaloLayer(root, shell, state);
  const l = layer;
  bus.on("island.halo", (msg) => {
    const p = (msg.payload ?? {}) as HaloOptions & { action?: string };
    const id = typeof p.id === "string" ? p.id : "";
    if (p.action === "hide") {
      if (id) l.hide(id);
    } else if (p.action === "think") {
      ondineThinking((p as { on?: boolean }).on !== false);
    } else if (p.action === "level") {
      if (id) l.update(id, { level: p.level, fill: p.fill });
    } else showHalo({ ...p, id: id || undefined });
  });
  bus.on("island.state", () => l.wake());
  settingsStore.onChange(() => l.settingsChanged());
}

// ── Petits calculs ───────────────────────────────────────────────────────────

/** La couleur à `f` (0 à 1) le long de la palette, en mélangeant les voisines. */
function colorAt(colors: string[], f: number): string {
  if (colors.length < 2) return colors[0] ?? "#ffffff";
  const x = clamp01(f) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  return mix(colors[i], colors[i + 1], x - i);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** Un nombre pseudo-aléatoire stable (0 à 1) pour (graine, n). */
function hash(seed: number, n: number): number {
  const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Le fond est-il sombre ? (mode sombre de Windows, vu par WebView2) */
function darkBackground(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches !== true;
}

/** Les couleurs de la mascotte (réglage « Couleur de ma mascotte »). */
function mascotColors(): string[] {
  const m = settingsStore.current.mascot;
  const tint = (TINT_NAMES as string[]).includes(m.color) ? (m.color as GumTint) : "blue";
  if (tint === "rainbow") return PALETTES.rainbow.dark;
  const p = gumPalette(tint, 0, m.customColor);
  return [p[1], p[2], p[0]].map((c) => rgbToHex(c[0], c[1], c[2]));
}

/** Les couleurs à dessiner pour une demande, selon le réglage « Couleurs » et le fond. */
function resolveColors(req: PaletteName | string[]): string[] {
  const choice = settingsStore.current.modules?.halos?.values?.colors;
  const dark = darkBackground();
  if (choice === "rainbow") return paletteColors(PALETTES.rainbow, dark);
  if (choice === "mascot") return paletteColors({ dark: mascotColors() }, dark);
  if (Array.isArray(req)) {
    const ok = req.filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
    if (ok.length) return paletteColors({ dark: ok }, dark);
  }
  return paletteColors(PALETTES[isPaletteName(req) ? req : "work"], dark);
}

// ── Le calque ────────────────────────────────────────────────────────────────

class HaloLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private stack = new HaloStack<Halo>();
  /** Les demandes qui s'éteignent (sorties de la pile, encore visibles). */
  private fading: Halo[] = [];
  private raf = 0;
  private timer = 0;
  /** Animations réduites : le prochain petit pas d'un liseré de minuteur. */
  private stillTimer = 0;
  private last = 0;
  private dpr = 1;
  /** La durée de l'image en cours (s), pour les étincelles. */
  private dt = 1 / 60;
  /** Le contour échantillonné, et la clé de la géométrie qui l'a donné. */
  private geo: { key: string; x: number; y: number; w: number; h: number; pts: ContourPoint[]; path: Path2D | null } | null = null;

  constructor(
    root: HTMLElement,
    private readonly shell: HTMLElement,
    private readonly state: () => string,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "island-halo";
    this.canvas.setAttribute("aria-hidden", "true");
    // Sous l'île (avant elle dans la page), sur toute la fenêtre, sans prendre la souris.
    Object.assign(this.canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    root.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    window.addEventListener("resize", () => this.wake());
    // Toucher l'île pendant un halo : la couleur part de là (forme « onde »).
    shell.addEventListener("pointerdown", (e) => this.poke(e.clientX, e.clientY));
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => this.settingsChanged());
  }

  has(id: string): boolean {
    return !!this.stack.get(id);
  }

  show(id: string, o: HaloOptions) {
    if (!halosEnabled()) return;
    // La même demande encore là (ou en train de s'éteindre) : on repart de sa lumière.
    let old = this.stack.get(id);
    if (!old) {
      old = this.fading.find((f) => f.id === id) ?? null;
      if (old) this.fading = this.fading.filter((f) => f !== old);
    }
    if (old) window.clearTimeout(old.timer);
    const shape = SHAPES.includes(o.shape as HaloShape) ? (o.shape as HaloShape) : "aurora";
    const req = o.palette ?? "work";
    const now = performance.now();
    const h: Halo = {
      id,
      priority: priorityOf(o.priority),
      colors: resolveColors(req),
      paletteReq: req,
      shape,
      rhythm: o.rhythm ?? "calm",
      durationMs: Math.max(0, Math.min(3_600_000, Number(o.durationMs) || 0)),
      fill: o.fill == null ? 1 : clamp01(Number(o.fill)),
      from: o.from === "right" || o.from === "center" ? o.from : "left",
      level: clamp01(Number(o.level) || 0),
      levelS: { x: 0, v: 0 },
      endsAt: typeof o.endsAt === "number" && Number.isFinite(o.endsAt) ? o.endsAt : null,
      total: Math.max(0, Number(o.total) || 0),
      // Même forme qu'avant (le volume qu'on monte, touche après touche) : elle continue.
      start: old && old.shape === shape ? old.start : now,
      // Une demande qui remplace la même garde sa lumière (pas de trou noir entre les deux).
      env: old ? old.env : { x: 0, v: 0 },
      ending: false,
      timer: 0,
      particles: old && old.shape === shape ? old.particles : [],
      rings: old && old.shape === shape ? old.rings : [],
      lastRing: old && old.shape === shape ? old.lastRing : -Infinity,
      ringsSpawned: old && old.shape === shape ? old.ringsSpawned : 0,
      pokes: [],
      seed: Math.random() * 1000,
      lastFlash: now,
    };
    if (h.durationMs > 0) h.timer = window.setTimeout(() => this.hide(id), h.durationMs);
    if (shape === "burst" && !(old && old.shape === shape)) this.spark(h, 34);
    this.stack.add(h);
    this.wake();
  }

  hide(id: string) {
    const h = this.stack.remove(id);
    if (!h) return;
    window.clearTimeout(h.timer);
    h.ending = true;
    this.fading.push(h);
    this.wake();
  }

  update(id: string, o: { level?: number; fill?: number; palette?: PaletteName | string[] }) {
    const h = this.stack.get(id);
    if (!h) return;
    if (o.level != null) h.level = clamp01(Number(o.level) || 0);
    if (o.fill != null) h.fill = clamp01(Number(o.fill) || 0);
    if (o.palette) {
      h.paletteReq = o.palette;
      h.colors = resolveColors(o.palette);
    }
    this.wake();
  }

  /** Réglages changés (couleurs, module coupé), ou fond clair / sombre. */
  settingsChanged() {
    if (!halosEnabled()) {
      for (const h of this.stack.all()) this.hide(h.id);
      return;
    }
    for (const h of [...this.stack.all(), ...this.fading]) h.colors = resolveColors(h.paletteReq);
    this.wake();
  }

  private still(): boolean {
    return reducedMotion() || calmMode();
  }

  private poke(x: number, y: number) {
    const top = this.stack.top();
    if (!top || this.still() || !this.geo?.pts.length) return;
    let best = 0;
    let bestD = Infinity;
    const pts = this.geo.pts;
    pts.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i / pts.length;
      }
    });
    top.pokes.push({ u: best, at: performance.now() });
    if (top.pokes.length > 4) top.pokes.shift();
    this.wake();
  }

  /** Demande une image (relance la boucle si elle dormait). */
  wake() {
    window.clearTimeout(this.stillTimer);
    this.stillTimer = 0;
    if (this.raf || this.timer) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(_t: number) {
    this.raf = 0;
    const now = performance.now();
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.dt = dt;
    const visible = this.state() !== "hidden" && !document.hidden;
    const top = this.stack.top();
    const still = this.still();

    // Les fondus : la demande du dessus monte, les autres descendent.
    for (const h of this.stack.all()) {
      const target = h === top ? 1 : 0;
      if (still) h.env = { x: target, v: 0 };
      else stepSpring(h.env, target, target ? ENTER : LEAVE, dt);
      if (h.shape === "level") stepSpring(h.levelS, h.level, LEVEL, dt);
    }
    for (const h of this.fading) {
      if (still) h.env = { x: 0, v: 0 };
      else stepSpring(h.env, 0, LEAVE, dt);
    }
    this.fading = this.fading.filter((h) => h.env.x > 0.01 || Math.abs(h.env.v) > 0.05);

    const drawn = [...this.fading, ...this.stack.all()].filter((h) => h.env.x > 0.005);
    this.draw(visible ? drawn : [], now, still);

    // On continue tant que quelque chose bouge et se voit.
    // Un liseré de minuteur en pause (figé) n'a pas besoin d'être redessiné.
    const settled = drawn.every((h) => Math.abs(h.env.v) < 0.05);
    const frozen = settled && drawn.every((h) => h.shape === "progress" && h.endsAt == null);
    const moving = visible && !still && drawn.length > 0 && !frozen;
    if (!moving) {
      this.last = 0;
      // Animations réduites ou Calme : le liseré d'un minuteur qui tourne avance quand même, par petits pas.
      if (visible && still && drawn.some((h) => h.shape === "progress" && h.endsAt != null)) {
        this.stillTimer = window.setTimeout(() => {
          this.stillTimer = 0;
          this.wake();
        }, STILL_PROGRESS_MS);
      }
      return; // repartira à la prochaine demande, au retour de l'île, au redimensionnement
    }
    // Les halos lents, et ceux qui suivent un niveau (une visio d'une heure), à 30 images/s.
    // (Un balayage déjà arrivé, comme le halo vert qui reste pendant la charge, aussi.)
    const slow = drawn.every(
      (h) => h.shape === "aurora" || h.shape === "cocoon" || h.shape === "level" || (h.shape === "breathe" && rhythmMs(h.rhythm) >= 3000) || (h.shape === "sweep" && now - h.start > 2000),
    );
    // Seulement des liserés de minuteur, loin de la fin : ils avancent lentement.
    const nowMs = Date.now();
    const crawl = settled && drawn.every((h) => h.shape === "progress" && progressWarn(nowMs, h.endsAt, h.total) === 0);
    const base = perfMode() === "eco" ? ECO_FPS : (slow || drawn.every((h) => h.shape === "progress")) && settled ? SLOW_FPS : 60;
    const fps = crawl ? Math.min(base, PROGRESS_FPS) : base;
    if (fps >= 60) this.raf = requestAnimationFrame((t) => this.frame(t));
    else
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.raf = requestAnimationFrame((t) => this.frame(t));
      }, 1000 / fps - 4);
  }

  // ── La géométrie ───────────────────────────────────────────────────────────

  private measure(): NonNullable<HaloLayer["geo"]> | null {
    const b = this.shell.getBoundingClientRect();
    if (b.width < 2 || b.height < 1) return null;
    const cs = getComputedStyle(this.shell);
    const px = (v: string) => parseFloat(v) || 0;
    // La boîte peut être mise à l'échelle (gelée) : les arrondis aussi.
    const sx = this.shell.offsetWidth ? b.width / this.shell.offsetWidth : 1;
    const r = {
      tl: px(cs.borderTopLeftRadius) * sx,
      tr: px(cs.borderTopRightRadius) * sx,
      br: px(cs.borderBottomRightRadius) * sx,
      bl: px(cs.borderBottomLeftRadius) * sx,
    };
    const key = [b.x, b.y, b.width, b.height, r.tl, r.tr, r.br, r.bl].map((v) => v.toFixed(1)).join(",");
    if (this.geo?.key === key) return this.geo;
    const rect: Rect = { w: b.width, h: b.height, r };
    const all = sampleContour(rect, 4).map((p) => ({ ...p, x: p.x + b.x, y: p.y + b.y }));
    let path: Path2D | null = null;
    if (typeof Path2D !== "undefined" && all.length > 1) {
      path = new Path2D();
      path.moveTo(all[0].x, all[0].y);
      for (const p of all) path.lineTo(p.x, p.y);
      path.closePath();
    }
    this.geo = { key, x: b.x, y: b.y, w: b.width, h: b.height, pts: visibleRun(all, document.body.dataset.edge ?? "top"), path };
    return this.geo;
  }

  private fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  // ── Le dessin ──────────────────────────────────────────────────────────────

  private draw(halos: Halo[], now: number, still: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.fitCanvas();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!halos.length) return;
    const g = this.measure();
    if (!g || !g.path) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const dark = darkBackground();
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    const base = INTENSITY[intensityOf(settingsStore.current.modules?.halos?.values?.intensity)];
    // Une mini-île a une lueur plus fine que l'île ouverte.
    const size = Math.max(0.55, Math.min(1, Math.min(g.w, g.h) / 44));
    for (const h of halos) {
      const k = Math.max(0, h.env.x);
      ctx.save();
      if (still) this.drawStill(ctx, g, h, base.glow * size, base.alpha * Math.min(1, k));
      else this.drawShape(ctx, g, h, now, base.glow * size, base.alpha * k);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** Le dégradé conique qui tourne autour du centre de l'île. */
  private gradient(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, colors: string[], angle: number): CanvasGradient | string {
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    if (typeof ctx.createConicGradient !== "function") {
      const lin = ctx.createLinearGradient(g.x, cy, g.x + g.w, cy);
      colors.forEach((c, i) => lin.addColorStop(i / Math.max(1, colors.length - 1), c));
      return lin;
    }
    const grad = ctx.createConicGradient(angle, cx, cy);
    const n = colors.length;
    for (let i = 0; i < n; i++) grad.addColorStop(i / n, colors[i]);
    grad.addColorStop(1, colors[0]);
    return grad;
  }

  /** Le contour en lumière : lueur large et douce, puis plus serrée, puis le trait. */
  private glowStroke(ctx: CanvasRenderingContext2D, path: Path2D, style: CanvasGradient | string, glow: number, alpha: number) {
    if (alpha <= 0.002) return;
    ctx.strokeStyle = style;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const passes: [number, number][] = [
      [glow * 2.4, 0.1],
      [glow * 1.4, 0.2],
      [glow * 0.7, 0.38],
      [Math.max(1.6, glow * 0.18), 0.95],
    ];
    for (const [w, a] of passes) {
      ctx.globalAlpha = Math.min(1, a * alpha);
      ctx.lineWidth = w;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
  }

  /** Un halo fixe (animations réduites, Calme) : tout le contour, couleurs immobiles. */
  private drawStill(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, h: Halo, glow: number, alpha: number) {
    if (h.shape === "progress") return this.drawProgress(ctx, g, h, 0, glow, alpha, true);
    if (h.fill < 1) this.clipFill(ctx, g, h, h.fill);
    this.glowStroke(ctx, g.path!, this.gradient(ctx, g, h.colors, -Math.PI / 2), glow, alpha * 0.85);
  }

  /** Ne garde que la part `fill` du contour : de gauche à droite, des deux côtés, ou depuis le bas. */
  private clipFill(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, h: Halo, fill: number) {
    const pad = 40;
    ctx.beginPath();
    if (h.shape === "reservoir" || h.shape === "rise" || h.shape === "set") {
      const top = g.y + g.h * (1 - fill);
      ctx.rect(g.x - pad, top, g.w + pad * 2, g.h * fill + pad);
    } else if (h.from === "center") {
      const half = (g.w / 2 + pad) * fill;
      ctx.rect(g.x + g.w / 2 - half, g.y - pad, half * 2, g.h + pad * 2);
    } else if (h.from === "right") {
      const w = (g.w + pad) * fill;
      ctx.rect(g.x + g.w + pad - w, g.y - pad, w + pad, g.h + pad * 2);
    } else ctx.rect(g.x - pad, g.y - pad, (g.w + pad) * fill + (fill > 0 ? pad * fill : 0), g.h + pad * 2);
    ctx.clip();
  }

  private drawShape(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, h: Halo, now: number, glow: number, alpha: number) {
    const t = now - h.start;
    const period = rhythmMs(h.rhythm);
    // Les couleurs tournent : un tour toutes les deux périodes (au moins 2,4 s).
    const spin = (t / Math.max(2400, period * 2)) * Math.PI * 2;
    const grad = this.gradient(ctx, g, h.colors, spin - Math.PI / 2);
    const path = g.path!;
    // Une part seulement du contour (une petite braise, une jauge) : pour toutes les formes.
    if (h.fill < 1 && h.shape !== "sweep" && h.shape !== "reservoir" && h.shape !== "rise" && h.shape !== "set" && h.shape !== "progress") this.clipFill(ctx, g, h, h.fill);
    switch (h.shape) {
      case "aurora": {
        // Les couleurs coulent, la lueur ondule à peine.
        const a = 0.82 + 0.18 * Math.sin(t / 900);
        this.glowStroke(ctx, path, grad, glow * (0.9 + 0.12 * Math.sin(t / 1300)), alpha * a);
        break;
      }
      case "breathe": {
        const p = pulse(h.rhythm, t);
        this.glowStroke(ctx, path, grad, glow * (0.45 + 0.75 * p), alpha * (0.45 + 0.55 * p));
        break;
      }
      case "cocoon": {
        const p = pulse("slow", t);
        this.glowStroke(ctx, path, grad, glow * (0.38 + 0.12 * p), alpha * (0.55 + 0.2 * p));
        break;
      }
      case "comet":
        this.glowStroke(ctx, path, grad, glow * 0.5, alpha * 0.18);
        this.drawComet(ctx, g, h.colors, (t / period) % 1, 0.32, glow, alpha);
        break;
      case "drops": {
        this.glowStroke(ctx, path, grad, glow * 0.4, alpha * 0.12);
        const turn = t / Math.max(1800, period);
        for (let i = 0; i < 3; i++) {
          // Elles se rattrapent et se distancent : l'écart respire.
          const gap = 0.06 + 0.035 * Math.sin(t / 420 + i * 1.7);
          this.drawComet(ctx, g, [h.colors[i % h.colors.length]], (turn - i * gap) % 1, 0.06, glow * 0.85, alpha);
        }
        break;
      }
      case "sweep": {
        // La vague remplit le contour (jusqu'à `fill`), avec un front brillant.
        const travel = Math.min(1100, Math.max(600, period * 0.7));
        const p = easeOut(t / travel) * h.fill;
        ctx.save();
        this.clipFill(ctx, g, h, p);
        const flash = 1 + 0.5 * Math.max(0, 1 - t / travel);
        this.glowStroke(ctx, path, grad, glow * flash, alpha);
        ctx.restore();
        if (t < travel * 1.3) this.drawFront(ctx, g, h, p, glow, alpha * (1 - clamp01((t - travel) / (travel * 0.3))));
        break;
      }
      case "burst": {
        // Un flash qui embrase tout, qui retombe en aurore, et les étincelles.
        const flash = 1 + 1.4 * Math.exp(-t / 260);
        this.glowStroke(ctx, path, grad, glow * flash, alpha * Math.min(1, 0.7 + 0.6 * Math.exp(-t / 400)));
        // Une deuxième gerbe pour un éclat qui dure.
        if (t > 700 && t < 760 && h.particles.length < 50) this.spark(h, 18);
        this.drawParticles(ctx, h, now, alpha);
        break;
      }
      case "ripple": {
        // Une goutte tombe : le contour s'allume là où elle tombe, puis la
        // lumière file des deux côtés ; et des ronds dans l'eau partent de l'île.
        const u0 = h.from === "left" ? 0.85 : h.from === "right" ? 0.15 : 0.5;
        this.glowStroke(ctx, path, grad, glow * 0.6, alpha * Math.min(1, t / 500) * 0.45);
        this.drawFronts(ctx, g, h.colors, u0, t / 1400, glow, alpha);
        this.spawnRings(h, now, Math.max(450, period / 2), 3);
        this.drawRings(ctx, g, h, now, grad, alpha);
        break;
      }
      case "waves": {
        const p = pulse(h.rhythm, t);
        this.glowStroke(ctx, path, grad, glow * (0.6 + 0.4 * p), alpha * (0.55 + 0.45 * p));
        this.spawnRings(h, now, period, 0);
        this.drawRings(ctx, g, h, now, grad, alpha);
        break;
      }
      case "level": {
        const l = clamp01(h.levelS.x);
        this.glowStroke(ctx, path, grad, glow * (0.45 + 0.9 * l), alpha * (0.45 + 0.55 * l));
        if (l > 0.45 && now - h.lastRing > 260) {
          h.rings.push(now);
          h.lastRing = now;
        }
        this.drawRings(ctx, g, h, now, grad, alpha * l);
        break;
      }
      case "progress":
        this.drawProgress(ctx, g, h, t, glow, alpha, false);
        break;
      case "crackle": {
        // Le contour coupé en morceaux qui s'éteignent par à-coups (8 fois par seconde).
        const step = Math.floor(t / 125);
        const n = 14;
        const pts = g.pts;
        const per = Math.ceil(pts.length / n);
        this.glowStroke(ctx, path, grad, glow * 0.35, alpha * 0.2);
        for (let s = 0; s < n; s++) {
          if (hash(h.seed + step, s) < 0.45) continue;
          const seg = new Path2D();
          const a = s * per;
          const b = Math.min(pts.length - 1, a + per);
          seg.moveTo(pts[a].x, pts[a].y);
          for (let i = a + 1; i <= b; i++) seg.lineTo(pts[i].x, pts[i].y);
          this.glowStroke(ctx, seg, grad, glow * (0.5 + hash(h.seed, s + step * 3) * 0.6), alpha * 0.85);
        }
        break;
      }
      case "reservoir":
      case "rise":
      case "set": {
        const rising = Math.min(1, t / (h.shape === "reservoir" ? 1600 : 2600));
        const level = h.shape === "set" ? 1 - easeOut(rising) * (1 - Math.min(h.fill, 0.99)) : easeOut(rising) * h.fill;
        ctx.save();
        this.clipWater(ctx, g, level, h.shape === "reservoir" ? t : 0);
        this.glowStroke(ctx, path, grad, glow, alpha);
        ctx.restore();
        // Au-delà de 95 % : l'eau déborde en gouttes.
        if (h.shape === "reservoir" && h.fill > 0.95 && rising >= 1 && h.particles.length < 14 && Math.random() < 0.08) this.dripFrom(h, g);
        this.drawParticles(ctx, h, now, alpha);
        break;
      }
      case "rain": {
        this.glowStroke(ctx, path, grad, glow * 0.5, alpha * 0.35);
        // Des gouttes qui glissent le long des côtés puis tombent.
        if (h.particles.length < 18 && Math.random() < 0.18) this.rainDrop(h, g);
        // L'orage : un éclair blanc rapide, toutes les 4 à 7 s.
        if (isStorm(h) && now - h.lastFlash > 4000 + hash(h.seed, Math.floor(now / 1000)) * 3000) h.lastFlash = now;
        const flash = isStorm(h) ? Math.exp(-(now - h.lastFlash) / 120) : 0;
        if (flash > 0.02) this.glowStroke(ctx, path, "#ffffff", glow * (1 + flash), alpha * flash);
        this.drawParticles(ctx, h, now, alpha);
        break;
      }
    }
    // Une touche sur l'île : une onde de couleur part de là, des deux côtés.
    h.pokes = h.pokes.filter((p) => now - p.at < 1200);
    for (const p of h.pokes) this.drawFronts(ctx, g, h.colors, p.u, (now - p.at) / 1200, glow * 0.9, alpha);
  }

  /**
   * Le liseré d'un minuteur : un rail très pâle sur tout le contour, la part
   * qui reste allumée (de l'autre bout vers le début du tour : elle se vide
   * comme un sablier), et une tête de lumière qui scintille à peine. Dans les
   * dernières secondes, les couleurs glissent vers le rouge et battent une fois
   * par seconde. `still` : figé (pas de scintillement ni de battement).
   */
  private drawProgress(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, h: Halo, t: number, glow: number, alpha: number, still: boolean) {
    const pts = g.pts;
    const n = pts.length;
    if (n < 3) return;
    const now = Date.now();
    const left = progressLeft(now, h.endsAt, h.total, h.fill);
    const warn = progressWarn(now, h.endsAt, h.total);
    const red = paletteColors(PALETTES.critical, darkBackground());
    const colors = warn > 0 ? h.colors.map((c, i) => mix(c, red[i % red.length], warn)) : h.colors;
    // En pause : plus pâle (le temps est arrêté).
    const paused = h.endsAt == null;
    const beat = warn > 0 && !still ? 0.75 + 0.25 * Math.cos(((h.endsAt! - now) / 1000) * Math.PI * 2) : 1;
    const a = alpha * (paused ? 0.6 : 1) * beat;
    // Le rail : tout le tour, à peine visible, pour qu'on voie ce qui est déjà passé.
    const rail = this.gradient(ctx, g, colors, -Math.PI / 2);
    this.glowStroke(ctx, g.path!, rail, glow * 0.3, a * 0.12);
    if (left <= 0.001) return;
    // La part allumée, jusqu'à un point placé entre deux échantillons (le liseré glisse, sans à-coups).
    const pos = left * (n - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    const q = i + 1 < n ? { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f } : pts[i];
    const seg = new Path2D();
    seg.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k <= i; k++) seg.lineTo(pts[k].x, pts[k].y);
    seg.lineTo(q.x, q.y);
    // Les couleurs coulent lentement le long du liseré (figées en Calme).
    const spin = still ? 0 : (t / 6000) * Math.PI * 2;
    this.glowStroke(ctx, seg, this.gradient(ctx, g, colors, spin - Math.PI / 2), glow * 0.75, a);
    // La tête : un point de lumière qui scintille à peine, là où le liseré s'arrête.
    const shimmer = still || paused ? 1 : 0.85 + 0.15 * Math.sin(t / 240);
    const r = glow * (0.9 + 0.5 * warn) * shimmer;
    const rad = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
    rad.addColorStop(0, rgba("#ffffff", a * 0.9));
    rad.addColorStop(0.4, rgba(colors[colors.length - 1], a * 0.7));
    rad.addColorStop(1, rgba(colors[0], 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Une tête brillante à `u` (0 à 1 du tour) et sa traînée de longueur `trail`. */
  private drawComet(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, colors: string[], u: number, trail: number, glow: number, alpha: number) {
    const pts = g.pts;
    const n = pts.length;
    if (n < 3) return;
    const head = Math.round((((u % 1) + 1) % 1) * n) % n;
    const len = Math.max(2, Math.round(trail * n));
    ctx.lineCap = "round";
    for (let i = len; i > 0; i--) {
      const ia = (head - i + n) % n;
      // Le passage d'un bout à l'autre (derrière le bord de l'écran) : rien à tracer.
      if (ia === n - 1) continue;
      const a = pts[ia];
      const b = pts[ia + 1];
      const f = 1 - i / len; // 0 au bout de la traînée, 1 à la tête
      ctx.strokeStyle = colorAt(colors, f);
      ctx.globalAlpha = alpha * f * f * 0.35;
      ctx.lineWidth = glow * (0.6 + f * 1.2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = alpha * f * 0.95;
      ctx.lineWidth = Math.max(1.4, glow * 0.22 * (0.5 + f));
      ctx.stroke();
    }
    // La tête : un point de lumière.
    const p = pts[head];
    const r = glow * 1.1;
    const rad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    rad.addColorStop(0, rgba("#ffffff", alpha));
    rad.addColorStop(0.35, rgba(colors[colors.length - 1], alpha * 0.8));
    rad.addColorStop(1, rgba(colors[0], 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Deux fronts de lumière qui partent de `u0` en sens contraires (progress 0 → 1). */
  private drawFronts(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, colors: string[], u0: number, progress: number, glow: number, alpha: number) {
    if (progress >= 1) return;
    const fade = (1 - progress) ** 1.5;
    const d = easeOut(progress) * 0.5;
    this.drawComet(ctx, g, colors, u0 + d, 0.12, glow, alpha * fade);
    this.drawCometBack(ctx, g, colors, u0 - d, 0.12, glow, alpha * fade);
  }

  /** Comme drawComet, mais la tête avance dans l'autre sens (sens inverse des aiguilles). */
  private drawCometBack(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, colors: string[], u: number, trail: number, glow: number, alpha: number) {
    const pts = g.pts;
    const n = pts.length;
    if (n < 3 || alpha <= 0.002) return;
    const head = Math.round((((u % 1) + 1) % 1) * n) % n;
    const len = Math.max(2, Math.round(trail * n));
    ctx.lineCap = "round";
    for (let i = len; i > 0; i--) {
      const ib = (head + i - 1) % n;
      if (ib === n - 1) continue; // derrière le bord de l'écran
      const a = pts[(ib + 1) % n];
      const b = pts[ib];
      const f = 1 - i / len;
      ctx.strokeStyle = colorAt(colors, f);
      ctx.globalAlpha = alpha * f * f * 0.35;
      ctx.lineWidth = glow * (0.6 + f * 1.2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = alpha * f * 0.95;
      ctx.lineWidth = Math.max(1.4, glow * 0.22 * (0.5 + f));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Le front brillant d'un balayage, à la limite de ce qui est allumé. */
  private drawFront(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, h: Halo, p: number, glow: number, alpha: number) {
    if (alpha <= 0.01 || p <= 0) return;
    const xs =
      h.from === "center"
        ? [g.x + g.w / 2 - (g.w / 2) * p, g.x + g.w / 2 + (g.w / 2) * p]
        : h.from === "right"
          ? [g.x + g.w * (1 - p)]
          : [g.x + g.w * p];
    for (const x of xs) {
      const y = g.y + g.h; // le bord intérieur (en haut de l'écran : le bas de l'île)
      const r = glow * 2.2;
      const rad = ctx.createRadialGradient(x, y, 0, x, y, r);
      rad.addColorStop(0, rgba("#ffffff", alpha * 0.9));
      rad.addColorStop(0.4, rgba(h.colors[0], alpha * 0.6));
      rad.addColorStop(1, rgba(h.colors[0], 0));
      ctx.fillStyle = rad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** La part sous la surface de l'eau (niveau 0 à 1 depuis le bas), avec une surface qui ondule. */
  private clipWater(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, level: number, t: number) {
    const pad = 40;
    const surface = g.y + g.h * (1 - level);
    ctx.beginPath();
    ctx.moveTo(g.x - pad, g.y + g.h + pad);
    for (let x = g.x - pad; x <= g.x + g.w + pad; x += 8) {
      const wave = t ? Math.sin(x * 0.06 + t / 260) * 2.2 + Math.sin(x * 0.023 - t / 410) * 1.4 : 0;
      ctx.lineTo(x, surface + wave);
    }
    ctx.lineTo(g.x + g.w + pad, g.y + g.h + pad);
    ctx.closePath();
    ctx.clip();
  }

  // ── Ondes ──────────────────────────────────────────────────────────────────

  /** Lance une onde toutes les `every` ms (`max` > 0 : pas plus que ça en tout). */
  private spawnRings(h: Halo, now: number, every: number, max: number) {
    if (max > 0 && h.ringsSpawned >= max) return;
    if (now - h.lastRing >= every) {
      h.rings.push(now);
      h.lastRing = now;
      h.ringsSpawned++;
    }
  }

  /** Les ondes : le contour gonflé de plus en plus, de plus en plus pâle. */
  private drawRings(ctx: CanvasRenderingContext2D, g: NonNullable<HaloLayer["geo"]>, h: Halo, now: number, style: CanvasGradient | string, alpha: number) {
    const life = Math.max(900, rhythmMs(h.rhythm) * 1.6);
    h.rings = h.rings.filter((at) => now - at < life);
    if (alpha <= 0.01) return;
    ctx.strokeStyle = style;
    for (const at of h.rings) {
      const p = (now - at) / life;
      const d = easeOut(p) * RING_REACH;
      const pts = g.pts;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        const x = q.x + q.nx * d;
        const y = q.y + q.ny * d;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Pas refermée : le côté collé au bord de l'écran ne se voit pas.
      ctx.globalAlpha = alpha * (1 - p) ** 1.6 * 0.9;
      ctx.lineWidth = Math.max(1, 2.6 * (1 - p));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Étincelles et gouttes ──────────────────────────────────────────────────

  /** Une gerbe d'étincelles qui jaillissent du bord (appelée au départ d'un éclat). */
  private spark(h: Halo, count: number) {
    if (this.still()) return;
    const g = this.measure();
    if (!g || !g.pts.length) return;
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const q = g.pts[Math.floor(Math.random() * g.pts.length)];
      // Vers l'extérieur ; en haut de l'écran, le bord du haut ne lance rien vers le haut.
      const speed = 60 + Math.random() * 130;
      const spread = (Math.random() - 0.5) * 0.9;
      const nx = q.nx * Math.cos(spread) - q.ny * Math.sin(spread);
      const ny = q.nx * Math.sin(spread) + q.ny * Math.cos(spread);
      h.particles.push({
        x: q.x,
        y: q.y,
        vx: nx * speed,
        vy: ny * speed - 30,
        born: now,
        life: 800 + Math.random() * 900,
        color: h.colors[i % h.colors.length],
        size: 1.2 + Math.random() * 1.8,
      });
    }
  }

  /** Une goutte qui déborde du réservoir. */
  private dripFrom(h: Halo, g: NonNullable<HaloLayer["geo"]>) {
    const left = Math.random() < 0.5;
    h.particles.push({
      x: left ? g.x + 4 + Math.random() * 10 : g.x + g.w - 4 - Math.random() * 10,
      y: g.y + g.h - 2,
      vx: (left ? -1 : 1) * (6 + Math.random() * 10),
      vy: 10,
      born: performance.now(),
      life: 900,
      color: h.colors[2 % h.colors.length],
      size: 2,
      drop: true,
    });
  }

  /** Une goutte de pluie qui ruisselle le long d'un côté de l'île. */
  private rainDrop(h: Halo, g: NonNullable<HaloLayer["geo"]>) {
    const x = g.x + Math.random() * g.w;
    h.particles.push({
      x,
      y: g.y + g.h - 1,
      vx: (Math.random() - 0.5) * 6,
      vy: 20 + Math.random() * 25,
      born: performance.now(),
      life: 700 + Math.random() * 400,
      color: h.colors[Math.floor(Math.random() * h.colors.length)],
      size: 1.6,
      drop: true,
    });
  }

  private drawParticles(ctx: CanvasRenderingContext2D, h: Halo, now: number, alpha: number) {
    const dt = this.dt;
    h.particles = h.particles.filter((p) => now - p.born < p.life);
    for (const p of h.particles) {
      p.vy += (p.drop ? 160 : 220) * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const f = 1 - (now - p.born) / p.life;
      ctx.globalAlpha = alpha * Math.min(1, f * 1.6);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.drop) ctx.ellipse(p.x, p.y, p.size * 0.8, p.size * 1.8, 0, 0, Math.PI * 2);
      else ctx.arc(p.x, p.y, p.size * (0.6 + f * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Les points du contour qu'on voit : sans le côté collé au bord de l'écran
 * (il est hors de la fenêtre, ou caché par l'île). Une comète qui fait « le
 * tour » passe donc derrière le bord de l'écran au lieu d'y disparaître
 * longtemps. Le résultat est un seul morceau continu, d'un bout à l'autre.
 */
function visibleRun(pts: ContourPoint[], edge: string): ContourPoint[] {
  const hidden = (p: ContourPoint) => (edge === "left" ? p.nx < -0.7 : edge === "right" ? p.nx > 0.7 : p.ny < -0.7);
  const keep = pts.map((p) => !hidden(p));
  if (keep.every(Boolean) || !keep.some(Boolean)) return pts;
  // On commence au premier point visible qui suit un point caché.
  const n = pts.length;
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i] && !keep[(i - 1 + n) % n]) {
      start = i;
      break;
    }
  }
  const out: ContourPoint[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (keep[i]) out.push(pts[i]);
  }
  return out;
}

/** La palette d'orage ajoute des éclairs à la pluie. */
function isStorm(h: Halo): boolean {
  return h.paletteReq === "storm";
}
