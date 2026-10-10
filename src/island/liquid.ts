// Le liquide À L'INTÉRIEUR de l'île : de l'eau (ou de la gelée, de la
// lumière, du sable) dessinée DERRIÈRE le contenu, qui monte avec un minuteur,
// une copie de fichiers, la charge de la batterie… avec une surface qui
// ondule, des bulles et un peu de physique (il penche quand l'île bouge, la
// surface fait des vaguelettes au clic).
//
// ── L'API (pour les modules et les autres zones de l'appli) ─────────────────
//
//   import { showLiquid, updateLiquid, hideLiquid } from "../../island/liquid";
//   const id = showLiquid({ id: "copy", level: 0.3 });     // 30 % de l'île
//   updateLiquid(id, { level: 0.8 });                       // l'eau monte, au ressort
//   hideLiquid(id);                                         // elle s'en va en douceur
//   showLiquid({ id: "t", endsAt, total, direction: "fill" }); // suit le temps (minuteur)
//
// Ou par le bus, depuis n'importe quel module (déclarer "island.liquid" dans
// `events.emits`) ou une autre fenêtre :
//   api.emit("island.liquid", { action: "show", id: "copy", level: 0.3 });
//   api.emit("island.liquid", { action: "update", id: "copy", level: 0.6 });
//   api.emit("island.liquid", { action: "hide", id: "copy" });
//   api.emit("island.liquid", { action: "drop" });          // une goutte tombe (notification)
//   api.emit("island.liquid", { action: "wave" });          // une vague traverse (fin d'un agent)
//   api.emit("island.liquid", { action: "dive" });          // Ondine plonge et ressort
//   api.emit("island.liquid", { action: "ambience", name: "rain", on: true });
//
// Les options (toutes facultatives) :
//   id         même id = la demande remplace l'ancienne (sinon un id est inventé et renvoyé)
//   level      0 à 1 : la hauteur de l'eau (part de la hauteur de l'île)
//   endsAt     l'heure de fin (Date.now()) : la hauteur suit le temps, recalculée à chaque image
//   total      la durée complète (ms), avec endsAt
//   direction  "fill" (monte jusqu'à endsAt, par défaut) ou "drain" (descend)
//   tint       une teinte de moment (MOMENT_TINTS : charge, low, murky…) ou « #rrggbb » ;
//              absent = la couleur réglée (celle de l'île, par défaut)
//   murky      eau trouble (disque presque plein)
//   bubbles    combien de bulles (1 = normal, 0 = aucune, jusqu'à 3)
//   current    un courant traverse l'île de gauche à droite (agent au travail)
//   wobble     0 à 1 : la surface ondule avec un niveau (musique), mis à jour par updateLiquid
//   vibrate    la surface vibre finement (voix) plutôt qu'en grandes vagues
//   bpm        le tempo de la musique : la surface pulse au temps (donné par une autre zone)
//   overflow   déborde doucement quand elle arrive en haut (fin d'un minuteur)
//   priority   "low" | "normal" | "high" | "critical" (comme les halos, halo-stack.ts)
//   durationMs combien de temps (0 ou absent = jusqu'à hideLiquid)
//
// Les ambiances (setLiquidAmbience) se posent sur ce qui est montré :
//   rain   des gouttes ruissellent sur la « vitre » de l'île (pluie dehors)
//   boil   de petites bulles d'ébullition au fond (processeur très chargé)
//   stars  quelques étoiles se reflètent dans l'eau calme (la nuit)
//   still  l'eau devient lisse et immobile, comme un lac (concentration)
//   Sans liquide montré, boil / stars / still posent un fond d'eau.
//
// ── Comment c'est dessiné ────────────────────────────────────────────────────
// Un <canvas> DANS l'île (premier enfant, z-index -1 : au-dessus du fond de
// l'île, sous le texte et la mascotte), rogné avec elle par sa découpe en
// gelée : il suit tous les bords (haut, bas, gauche, droite) et la mini-île.
// La gravité reste celle de l'écran : l'eau monte toujours du bas de l'île.
// La couleur est assombrie (ou rendue plus transparente) juste assez pour que
// le texte secondaire garde 4,5:1 de contraste (readablePaint, liquid-rules.ts).
//
// ── Performance et accessibilité ─────────────────────────────────────────────
//   - aucune boucle sans liquide, île cachée, ou fenêtre cachée par Windows ;
//   - 60 images/s quand ça bouge (bulles, vagues, l'île qui bouge), 24 quand
//     seule la surface ondule doucement ; moitié moins en économie d'énergie ;
//   - « Réduire les animations » de Windows ou le réglage Calme de la
//     mascotte : un liquide figé (surface plate, sans bulles), redessiné
//     toutes les 5 s s'il suit un minuteur ;
//   - module « Animations de l'île » coupé, ou case « Animations à l'intérieur
//     de l'île » décochée : rien.

import type { Bus } from "../core/bus";
import type { ModuleManifest } from "../core/module-types";
import { perfMode } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import { calmMode } from "../mascot/mascot-state";
import halosManifest from "../modules/halos/manifest.json";
import { mascotPalette } from "./halo";
import { mix, rgba } from "./halo-palettes";
import { HaloStack, priorityOf, type HaloPriority } from "./halo-stack";
import {
  agitation,
  chooseColor,
  clamp01,
  cssToHex,
  FEEL,
  makeSurface,
  matterOf,
  MOMENT_TINTS,
  readablePaint,
  splash,
  stepSurface,
  surfaceEnergy,
  timedLevel,
  type FillDirection,
  type LiquidMatter,
  type Surface,
} from "./liquid-rules";
import { stepSpring, type Spring } from "./spring";
import { reducedMotion } from "./tab-pill";

export interface LiquidOptions {
  id?: string;
  level?: number;
  endsAt?: number | null;
  total?: number;
  direction?: FillDirection;
  tint?: string;
  murky?: boolean;
  bubbles?: number;
  current?: boolean;
  wobble?: number;
  vibrate?: boolean;
  bpm?: number;
  overflow?: boolean;
  priority?: HaloPriority;
  durationMs?: number;
}

export type LiquidAmbience = "rain" | "boil" | "stars" | "still";
const AMBIENCES: readonly LiquidAmbience[] = ["rain", "boil", "stars", "still"];

/** Une demande en cours. */
interface Liquid {
  id: string;
  priority: HaloPriority;
  level: number;
  endsAt: number | null;
  total: number;
  direction: FillDirection;
  tint: string | null;
  murky: boolean;
  bubbles: number;
  current: boolean;
  wobble: number;
  vibrate: boolean;
  bpm: number;
  overflow: boolean;
  timer: number;
  /** Le débordement a déjà eu lieu (une fois par demande), Ondine a déjà flotté. */
  overflowed: boolean;
  floated: boolean;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  phase: number;
  /** Une goutte de débordement (tombe) plutôt qu'une bulle (monte). */
  spray?: boolean;
  vx?: number;
  life?: number;
}

/** Une goutte de pluie sur la vitre. */
interface RainDrop {
  x: number;
  y: number;
  len: number;
  vy: number;
}

/** Les ronds dans l'eau (notification, bulle qui éclate). */
interface Ring {
  x: number;
  at: number;
}

/** Le nombre de colonnes de la surface. */
const COLUMNS = 48;
/** Le fond d'eau des ambiances sans liquide (ébullition, étoiles, lac). */
const AMBIENCE_LEVEL: Record<LiquidAmbience, number> = { rain: 0, boil: 0.16, stars: 0.22, still: 0.3 };
/** Les cadences (images par seconde) : ça bouge, ça ondule à peine. */
const ACTIVE_FPS = 60;
const IDLE_FPS = 24;
/** Animations réduites ou Calme : un liquide qui suit un minuteur est redessiné toutes les 5 s. */
const STILL_REDRAW_MS = 5000;
/** Une goutte (notification) : sa chute (ms), et ses ronds. */
const DROP_FALL_MS = 520;
const RING_MS = 1400;
/** La vague de fin (agent) : le temps de traverser l'île. */
const WAVE_MS = 1500;
/** Ondine flotte au-delà de ce niveau. */
const FLOAT_LEVEL = 0.9;

// ── L'état partagé ───────────────────────────────────────────────────────────

let layer: LiquidLayer | null = null;
let counter = 0;

/** Le module « Animations de l'île » est actif ET la case « Animations à l'intérieur de l'île » est cochée. */
export function liquidEnabled(): boolean {
  const m = settingsStore.current.modules?.halos;
  return m?.enabled !== false && m?.values?.liquid !== false;
}

/** Le liquide est permis ET le moment `key` (une case du module, ex. "liquidTimer") n'est pas coupé. */
export function liquidAllowed(key: string): boolean {
  return liquidEnabled() && settingsStore.current.modules?.halos?.values?.[key] !== false;
}

/** Remplit l'île de liquide. Renvoie l'id (pour updateLiquid, hideLiquid). */
export function showLiquid(o: LiquidOptions = {}): string {
  const id = o.id && /^[\w.:-]{1,64}$/.test(o.id) ? o.id : `liquid-${++counter}`;
  layer?.show(id, o);
  return id;
}

/** Change une demande montrée (hauteur, fin, niveau de la musique, tempo…). */
export function updateLiquid(id: string, o: Partial<Omit<LiquidOptions, "id">>): void {
  layer?.update(id, o);
}

/** Le liquide s'en va (en douceur). */
export function hideLiquid(id: string): void {
  layer?.hide(id);
}

/** Une demande est-elle montrée avec cet id ? */
export function liquidShown(id: string): boolean {
  return layer?.has(id) ?? false;
}

/** Une goutte tombe dans l'île et fait des ronds (une notification). */
export function liquidDrop(): void {
  layer?.drop();
}

/** Une vague traverse l'île de gauche à droite (un agent a fini). */
export function liquidWave(): void {
  layer?.wave();
}

/** Ondine plonge dans l'eau et en ressort (un téléchargement est arrivé). */
export function liquidDive(): void {
  layer?.dive();
}

/** Allume ou éteint une ambiance (pluie, ébullition, étoiles, lac). */
export function setLiquidAmbience(name: LiquidAmbience, on: boolean): void {
  layer?.ambience(name, on);
}

/**
 * Branche le liquide dans l'île (appelé une fois par island.ts). `state` :
 * l'état de l'île (rien n'est dessiné quand elle est cachée ou en trait).
 */
export function attachLiquid(shell: HTMLElement, bus: Bus, state: () => string): void {
  if (layer) return;
  const l = (layer = new LiquidLayer(shell, bus, state));
  bus.on("island.liquid", (msg) => {
    const p = (msg.payload ?? {}) as LiquidOptions & { action?: string; name?: string; on?: boolean };
    const id = typeof p.id === "string" ? p.id : "";
    if (p.action === "hide") {
      if (id) l.hide(id);
    } else if (p.action === "update") {
      if (id) l.update(id, p);
    } else if (p.action === "drop") l.drop();
    else if (p.action === "wave") l.wave();
    else if (p.action === "dive") l.dive();
    else if (p.action === "ambience") {
      if (AMBIENCES.includes(p.name as LiquidAmbience)) l.ambience(p.name as LiquidAmbience, p.on !== false);
    } else showLiquid({ ...p, id: id || undefined });
  });
  bus.on("island.state", () => l.themeChanged());
  settingsStore.onChange(() => {
    valuesCache = null;
    l.settingsChanged();
  });
}

// ── Petits calculs ───────────────────────────────────────────────────────────

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

let valuesCache: Record<string, unknown> | null = null;

/** Les réglages du liquide (module « Animations de l'île »), complétés par le manifeste (lus une fois par changement). */
function values(): Record<string, unknown> {
  return (valuesCache ??= settingsStore.moduleValues(halosManifest as ModuleManifest));
}

/** Le liquide doit-il rester figé ? */
function frozen(): boolean {
  return reducedMotion() || calmMode();
}

// ── Le calque ────────────────────────────────────────────────────────────────

class LiquidLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private stack = new HaloStack<Liquid>();
  private ambiences = new Set<LiquidAmbience>();
  private surf: Surface = makeSurface(COLUMNS);
  /** La hauteur montrée (0 à 1), son fondu d'entrée / de sortie, la pente, le calme du lac. */
  private levelS: Spring = { x: 0, v: 0 };
  private env: Spring = { x: 0, v: 0 };
  private tilt: Spring = { x: 0, v: 0 };
  private calm: Spring = { x: 0, v: 0 };
  private wobbleS: Spring = { x: 0, v: 0 };
  /** La dernière demande dessinée (elle reste visible pendant le fondu de sortie). */
  private shown: Liquid | null = null;
  private color = "#3ba4ff";
  private bubbles: Bubble[] = [];
  private rain: RainDrop[] = [];
  private rings: Ring[] = [];
  private drops: { x: number; at: number }[] = [];
  private waveAt = -Infinity;
  private spawnAcc = 0;
  private boilAcc = 0;
  private rainAcc = 0;
  private lastBeat = 0;
  /** La place de l'île à l'écran (pour la pente quand on la déplace). */
  private pos: { x: number; y: number; vx: number; vy: number } | null = null;
  private raf = 0;
  private timer = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Les couleurs lisibles calculées pour (couleur, fond, opacité, matière). */
  private paintKey = "";
  private paint = { body: { color: "#000000", alpha: 0, additive: false }, light: { color: "#000000", alpha: 0, additive: false } };
  private floating = false;
  /** Les couleurs du thème lues dans le style calculé de l'île (relues quand le thème ou l'état change). */
  private theme: { bg: string; fg: string; accent: string } | null = null;

  constructor(
    private readonly shell: HTMLElement,
    private readonly bus: Bus,
    private readonly state: () => string,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "island-liquid";
    this.canvas.setAttribute("aria-hidden", "true");
    shell.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    new ResizeObserver(() => this.resize()).observe(shell);
    // Un clic sur l'île : une vaguelette part de là.
    shell.addEventListener("pointerdown", (e) => this.poke(e.clientX));
    document.addEventListener("visibilitychange", () => this.wake());
    window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => this.wake());
  }

  has(id: string): boolean {
    return !!this.stack.get(id);
  }

  show(id: string, o: LiquidOptions) {
    if (!liquidEnabled()) return;
    const old = this.stack.get(id);
    if (old) window.clearTimeout(old.timer);
    const q: Liquid = {
      id,
      priority: priorityOf(o.priority),
      level: clamp01(num(o.level, old?.level ?? 0.5)),
      endsAt: typeof o.endsAt === "number" && Number.isFinite(o.endsAt) ? o.endsAt : null,
      total: Math.max(0, num(o.total, 0)),
      direction: o.direction === "drain" ? "drain" : "fill",
      tint: typeof o.tint === "string" ? o.tint : null,
      murky: o.murky === true,
      bubbles: Math.max(0, Math.min(3, num(o.bubbles, 1))),
      current: o.current === true,
      wobble: clamp01(num(o.wobble, 0)),
      vibrate: o.vibrate === true,
      bpm: Math.max(0, Math.min(240, num(o.bpm, 0))),
      overflow: o.overflow === true,
      timer: 0,
      overflowed: old?.overflowed ?? false,
      floated: old?.floated ?? false,
      // Un nouveau compte à rebours (fin plus loin) : il pourra de nouveau déborder.
      ...(old && typeof o.endsAt === "number" && old.endsAt !== o.endsAt ? { overflowed: false, floated: false } : {}),
    };
    const ms = Math.max(0, Math.min(3_600_000, num(o.durationMs, 0)));
    if (ms > 0) q.timer = window.setTimeout(() => this.hide(id), ms);
    this.stack.add(q);
    this.wake();
  }

  update(id: string, o: Partial<LiquidOptions>) {
    const q = this.stack.get(id);
    if (!q) return;
    if (o.level != null) q.level = clamp01(num(o.level, q.level));
    if (o.endsAt !== undefined) q.endsAt = typeof o.endsAt === "number" && Number.isFinite(o.endsAt) ? o.endsAt : null;
    if (o.total != null) q.total = Math.max(0, num(o.total, q.total));
    if (o.wobble != null) q.wobble = clamp01(num(o.wobble, 0));
    if (o.bpm != null) q.bpm = Math.max(0, Math.min(240, num(o.bpm, 0)));
    if (o.tint !== undefined) q.tint = typeof o.tint === "string" ? o.tint : null;
    if (o.current != null) q.current = o.current === true;
    if (o.bubbles != null) q.bubbles = Math.max(0, Math.min(3, num(o.bubbles, 1)));
    this.wake();
  }

  hide(id: string) {
    const q = this.stack.remove(id);
    if (!q) return;
    window.clearTimeout(q.timer);
    this.wake();
  }

  ambience(name: LiquidAmbience, on: boolean) {
    if (on && liquidEnabled()) this.ambiences.add(name);
    else this.ambiences.delete(name);
    this.wake();
  }

  drop() {
    if (!liquidEnabled()) return;
    // Rien dans l'île : une petite flaque le temps des ronds.
    if (!this.stack.size && !this.baseAmbience()) this.show("liquid-drop", { level: 0.14, priority: "low", durationMs: 2600, bubbles: 0 });
    if (frozen()) return;
    this.drops.push({ x: 0.3 + Math.random() * 0.4, at: performance.now() });
    this.wake();
  }

  wave() {
    if (!liquidEnabled() || frozen()) return;
    this.waveAt = performance.now();
    this.wake();
  }

  dive() {
    if (!liquidEnabled() || !this.ondineAllowed() || frozen()) return;
    this.shell.classList.remove("liquid-dive");
    void this.shell.offsetWidth; // relance l'animation CSS
    this.shell.classList.add("liquid-dive");
    window.setTimeout(() => this.shell.classList.remove("liquid-dive"), 1500);
    this.emote("hide");
    window.setTimeout(() => this.emote("proud"), 900);
  }

  settingsChanged() {
    if (!liquidEnabled()) {
      for (const q of this.stack.all()) this.hide(q.id);
      this.ambiences.clear();
    }
    this.themeChanged();
  }

  /** Le thème (ou l'état de l'île) a peut-être changé : les couleurs seront relues. */
  themeChanged() {
    this.theme = null;
    this.wake();
  }

  /** Demande une image (relance la boucle si elle dormait). */
  wake() {
    if (this.raf) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private ondineAllowed(): boolean {
    return values().liquidOndine !== false;
  }

  private emote(emotion: string) {
    if (!calmMode()) this.bus.emit("mascot.emote", { emotion });
  }

  /** L'ambiance qui pose un fond d'eau quand rien d'autre n'est montré (la plus haute). */
  private baseAmbience(): number {
    let lv = 0;
    for (const a of this.ambiences) lv = Math.max(lv, AMBIENCE_LEVEL[a]);
    return lv;
  }

  private resize() {
    const w = this.shell.clientWidth;
    const h = this.shell.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.wake();
  }

  private poke(clientX: number) {
    if (!this.env.x || frozen() || this.w <= 0) return;
    const r = this.shell.getBoundingClientRect();
    splash(this.surf, clamp01((clientX - r.left) / Math.max(1, r.width)), 70 + this.h * 0.6);
    this.rings.push({ x: (clientX - r.left) / Math.max(1, r.width), at: performance.now() });
    this.wake();
  }

  /** Les couleurs lisibles, recalculées seulement quand la couleur, le thème ou l'opacité changent. */
  private paints(color: string, matter: LiquidMatter, opacity: number) {
    const { bg, fg } = this.themeColors();
    const key = `${color}|${bg}|${fg}|${matter}|${opacity}`;
    if (key === this.paintKey) return this.paint;
    this.paintKey = key;
    const body = readablePaint(color, bg, fg, opacity, FEEL[matter].additive);
    this.paint = {
      body,
      // La crête et les bulles : plus claires, mais fines (3:1 suffit pour un trait qui passe).
      light: readablePaint(mix(color, "#ffffff", 0.45), bg, fg, Math.min(1, opacity * 1.3), body.additive, 3),
    };
    return this.paint;
  }

  /** La couleur voulue pour la demande montrée. */
  private wantedColor(q: Liquid | null): string {
    if (q?.tint) {
      if (MOMENT_TINTS[q.tint]) return MOMENT_TINTS[q.tint];
      if (/^#[0-9a-f]{6}$/i.test(q.tint)) return q.tint;
    }
    const v = values();
    return chooseColor(v.liquidColor, v.liquidCustom, this.themeColors().accent, v.liquidColor === "mascot" ? (mascotPalette()[0] ?? "") : "");
  }

  private themeColors() {
    if (!this.theme) {
      const cs = getComputedStyle(this.shell);
      this.theme = {
        bg: cssToHex(cs.backgroundColor, "#0c0d12"),
        fg: cssToHex(cs.getPropertyValue("--muted"), "#9aa0b4"),
        accent: cssToHex(cs.getPropertyValue("--accent"), "#7cc4ff"),
      };
    }
    return this.theme;
  }

  /** Suit la place de l'île à l'écran : une accélération fait pencher (et monter) le liquide. */
  private track(dt: number, feelTilt: number) {
    const r = this.shell.getBoundingClientRect();
    const x = window.screenX + r.left + r.width / 2;
    const y = window.screenY + r.top + r.height / 2;
    if (!this.pos || dt <= 0) {
      this.pos = { x, y, vx: 0, vy: 0 };
      return;
    }
    const vx = (x - this.pos.x) / dt;
    const vy = (y - this.pos.y) / dt;
    const ax = (vx - this.pos.vx) / dt;
    const ay = (vy - this.pos.vy) / dt;
    this.pos = { x, y, vx, vy };
    // Un saut énorme (changement d'écran, première image) ne compte pas.
    if (Math.abs(ax) < 60000) this.tilt.v -= ax * 0.000045 * feelTilt;
    if (Math.abs(ay) < 60000 && Math.abs(ay) > 400) {
      for (let i = 0; i < this.surf.v.length; i++) this.surf.v[i] += ay * 0.004;
    }
  }

  private frame(t: number) {
    this.raf = 0;
    const ctx = this.ctx;
    const st = this.state();
    const visible = st !== "hidden" && st !== "peek" && !document.hidden && this.w > 4 && this.h > 4;
    const top = this.stack.top();
    if (top) this.shown = top;
    const want = liquidEnabled() && (!!top || this.ambiences.size > 0);
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 1 / 60;
    this.last = t;
    if (!visible || !ctx) {
      // Rien à voir : on pose tout d'un coup, la boucle s'arrête (l'état de l'île la relancera).
      this.env.x = want ? 1 : 0;
      this.env.v = 0;
      this.last = 0;
      this.pos = null;
      this.setFloating(false);
      ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const still = frozen();
    const v = values();
    const matter = matterOf(v.liquidMatter);
    const feel = FEEL[matter];
    const opacity = clamp01(num(v.liquidOpacity, 40) / 100);
    const nowMs = Date.now();
    const q = top ?? this.shown;

    // ── La hauteur voulue ──
    let target = 0;
    let agit = 0;
    if (top) {
      target = timedLevel(nowMs, top.endsAt, top.total, top.direction, top.level);
      agit = top.direction === "fill" ? agitation(nowMs, top.endsAt) : 0;
    } else target = this.baseAmbience();
    if (!top && this.ambiences.size === 1 && this.ambiences.has("rain")) target = 0;

    // ── Les ressorts ──
    if (still) {
      this.env.x = want ? 1 : 0;
      this.levelS.x = target;
      this.tilt.x = 0;
      this.calm.x = 1;
      this.surf.h.fill(0);
      this.surf.v.fill(0);
      this.bubbles = [];
      this.drops = [];
      this.rings = [];
    } else {
      stepSpring(this.env, want ? 1 : 0, { stiffness: 90, damping: want ? 0.8 : 1 }, dt);
      stepSpring(this.levelS, target, { stiffness: 14, damping: 0.85 }, dt);
      stepSpring(this.tilt, 0, feel.tilt, dt);
      stepSpring(this.calm, this.ambiences.has("still") ? 1 : 0, { stiffness: 20, damping: 1 }, dt);
      stepSpring(this.wobbleS, q?.wobble ?? 0, { stiffness: 120, damping: 0.7 }, dt);
      this.tilt.x = Math.max(-0.35, Math.min(0.35, this.tilt.x));
      this.track(dt, matter === "sand" ? 0.3 : 1);
      stepSurface(this.surf, feel, dt, this.calm.x);
    }
    if (this.env.x < 0.004 && !want) {
      this.env.x = 0;
      this.shown = null;
      this.levelS.x = 0;
      this.bubbles = [];
      this.rain = [];
      this.setFloating(false);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    // ── La couleur : glisse vers celle voulue ──
    const goal = this.wantedColor(q);
    this.color = still || this.color === goal ? goal : mix(this.color, goal, Math.min(1, dt * 4));
    const paint = this.paints(this.color, matter, opacity);

    const W = this.w;
    const H = this.h;
    const level = clamp01(this.levelS.x);
    const baseY = H * (1 - level);
    const tS = t / 1000;
    const calmK = 1 - this.calm.x;
    const wob = this.wobbleS.x;
    // Le tempo (musique) : une impulsion à chaque temps.
    let beat = 0;
    if (q?.bpm && !still) {
      const phase = (tS * q.bpm) / 60;
      beat = Math.exp(-(phase % 1) * 5);
      if (Math.floor(phase) !== this.lastBeat) {
        this.lastBeat = Math.floor(phase);
        splash(this.surf, Math.random(), 30 + 50 * wob, 0.15);
      }
    }
    const waveK = clamp01((t - this.waveAt) / WAVE_MS);
    const waving = t - this.waveAt < WAVE_MS;
    const amp = still ? 0 : feel.idleAmp * calmK * (1 + agit * 2.5) * Math.min(1, H / 30);
    const surfaceAt = (x: number) => {
      const u = x / Math.max(1, W);
      const fi = u * (COLUMNS - 1);
      const i = Math.min(COLUMNS - 2, Math.floor(fi));
      let y = baseY - (this.surf.h[i] + (this.surf.h[i + 1] - this.surf.h[i]) * (fi - i));
      y -= this.tilt.x * (x - W / 2) * (H / Math.max(H, W)) * 1.6;
      if (amp) y += amp * (Math.sin(x * 0.045 + tS * feel.idleSpeed) * 0.6 + Math.sin(x * 0.11 - tS * feel.idleSpeed * 1.3) * 0.4);
      if (!still && wob > 0.01) {
        y += q?.vibrate
          ? wob * 1.8 * Math.sin(x * 0.28 + tS * 26) * Math.sin(x * 0.05 - tS * 3)
          : wob * (2 + 3 * beat) * calmK * Math.sin(x * 0.06 + tS * 3.2);
      }
      if (!still && q?.current) y += 1.4 * calmK * Math.sin(x * 0.08 - tS * 4.5);
      if (waving) {
        const d = (u - (-0.15 + 1.3 * waveK)) / 0.12;
        y -= Math.min(10, H * 0.18) * Math.exp(-d * d) * Math.sin(Math.PI * waveK);
      }
      return y;
    };

    // ── Les bulles, les gouttes ──
    let moving = false;
    if (!still && level > 0.02) moving = this.particles(dt, t, W, H, q, feel.bubbles, feel.rise, agit, matter, surfaceAt) || moving;
    if (!still && this.ambiences.has("rain")) moving = this.rainStep(dt, W, H) || moving;
    else this.rain = [];

    // Le débordement (fin d'un minuteur) et Ondine qui flotte.
    if (top && level >= 0.985 && top.overflow && !top.overflowed) {
      top.overflowed = true;
      if (!still) this.spray(W, H);
      if (this.ondineAllowed()) this.emote("surprised");
    }
    const full = !!top && level >= FLOAT_LEVEL && this.env.x > 0.6;
    if (full && top && !top.floated && this.ondineAllowed()) {
      top.floated = true;
      this.emote("calm");
    }
    this.setFloating(full && this.ondineAllowed() && !still);

    // ── Le dessin ──
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const env = clamp01(this.env.x);
    ctx.globalCompositeOperation = paint.body.additive ? "lighter" : "source-over";
    if (level > 0.003) {
      const body = q?.murky ? { color: mix(paint.body.color, "#5c5a48", 0.5), alpha: paint.body.alpha } : paint.body;
      // Le corps : un dégradé, un peu plus dense au fond.
      ctx.beginPath();
      ctx.moveTo(0, H + 2);
      const step = Math.max(4, W / 64);
      for (let x = 0; x <= W + step; x += step) ctx.lineTo(Math.min(x, W), surfaceAt(Math.min(x, W)));
      ctx.lineTo(W, H + 2);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, baseY - 6, 0, H);
      g.addColorStop(0, rgba(body.color, body.alpha * env * 0.75));
      g.addColorStop(1, rgba(body.color, body.alpha * env));
      ctx.fillStyle = g;
      ctx.fill();
      if (matter === "sand" || q?.murky) this.grains(ctx, W, H, baseY, body.color, body.alpha * env, q?.murky ? 0.5 : 1);
      // La crête : un trait clair qui suit la surface.
      if (matter !== "sand") {
        ctx.beginPath();
        for (let x = 0; x <= W + step; x += step) {
          const xx = Math.min(x, W);
          if (x === 0) ctx.moveTo(xx, surfaceAt(xx));
          else ctx.lineTo(xx, surfaceAt(xx));
        }
        ctx.strokeStyle = rgba(paint.light.color, paint.light.alpha * env * (matter === "light" ? 0.9 : 0.6));
        ctx.lineWidth = matter === "jelly" ? 2 : 1.2;
        ctx.stroke();
      }
      // Le courant d'un agent : des traits qui filent de gauche à droite.
      if (q?.current) this.streaks(ctx, tS, W, H, baseY, paint.light, env, still);
      if (this.ambiences.has("stars")) this.stars(ctx, tS, W, H, baseY, env, still);
      this.drawParticles(ctx, paint.light, env, matter);
      this.drawRings(ctx, t, W, surfaceAt, paint.light, env);
      if (this.floating && top?.overflowed) this.buoy(ctx, surfaceAt, env);
    }
    ctx.globalCompositeOperation = "source-over";
    this.drawDrops(ctx, t, W, surfaceAt, paint.light, env);
    if (this.rain.length || (still && this.ambiences.has("rain"))) this.drawRain(ctx, W, H, env, still);

    // ── La prochaine image ──
    if (still) {
      // Figé : redessiné seulement pour suivre un minuteur.
      if (top?.endsAt != null) this.timer = window.setTimeout(() => this.wake(), STILL_REDRAW_MS);
      return;
    }
    const busy =
      moving ||
      Math.abs(this.env.v) > 0.01 ||
      Math.abs(this.levelS.v) > 0.002 ||
      Math.abs(this.levelS.x - target) > 0.004 ||
      Math.abs(this.tilt.x) > 0.004 ||
      Math.abs(this.tilt.v) > 0.01 ||
      surfaceEnergy(this.surf) > 0.02 ||
      agit > 0 ||
      waving ||
      wob > 0.02 ||
      !!q?.current ||
      this.shell.classList.contains("moving");
    // Le lac (concentration) sans rien qui bouge : on peut s'arrêter tout à fait.
    if (!busy && this.calm.x > 0.98) {
      if (top?.endsAt != null) this.timer = window.setTimeout(() => this.wake(), 1000);
      return;
    }
    const fps = (busy ? ACTIVE_FPS : IDLE_FPS) / (perfMode() === "eco" ? 2 : 1);
    if (fps >= 60) this.raf = requestAnimationFrame((n) => this.frame(n));
    else
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.raf = requestAnimationFrame((n) => this.frame(n));
      }, 1000 / fps - 4);
  }

  private setFloating(on: boolean) {
    if (on === this.floating) return;
    this.floating = on;
    this.shell.classList.toggle("liquid-float", on);
  }

  /** Les bulles qui montent (ou les étincelles de la lumière), l'ébullition, les gouttes du débordement. */
  private particles(dt: number, t: number, W: number, H: number, q: Liquid | null, rate: number, rise: number, agit: number, matter: LiquidMatter, surfaceAt: (x: number) => number): boolean {
    const scale = Math.min(1, H / 60) * 0.6 + 0.4;
    if (rate > 0 && (q?.bubbles ?? 1) > 0 && this.calm.x < 0.6) {
      this.spawnAcc += dt * rate * (q?.bubbles ?? 1) * (1 + agit * 3) * Math.min(1.5, W / 300);
      while (this.spawnAcc >= 1 && this.bubbles.length < 40) {
        this.spawnAcc -= 1;
        this.bubbles.push({ x: Math.random() * W, y: H + 3, r: (1 + Math.random() * 2.2) * scale, vy: rise * (0.7 + Math.random() * 0.6), phase: Math.random() * 6.28 });
      }
    }
    if (this.ambiences.has("boil") && matter !== "sand") {
      this.boilAcc += dt * 22 * Math.min(1.5, W / 300);
      while (this.boilAcc >= 1 && this.bubbles.length < 60) {
        this.boilAcc -= 1;
        this.bubbles.push({ x: Math.random() * W, y: H + 1, r: (0.6 + Math.random()) * scale, vy: 22 + Math.random() * 18, phase: Math.random() * 6.28 });
      }
    }
    const tS = t / 1000;
    this.bubbles = this.bubbles.filter((b) => {
      if (b.spray) {
        b.life = (b.life ?? 1) - dt;
        b.vy += 260 * dt;
        b.y += b.vy * dt;
        b.x += (b.vx ?? 0) * dt;
        return (b.life ?? 0) > 0 && b.y < H + 4;
      }
      b.y -= b.vy * dt;
      b.x += Math.sin(tS * 3 + b.phase) * 8 * dt;
      // Arrivée à la surface : elle éclate (une toute petite vaguelette).
      if (b.y - b.r <= surfaceAt(b.x)) {
        if (b.r > 1.4) splash(this.surf, b.x / Math.max(1, W), 6 * b.r, 0.03);
        return false;
      }
      return true;
    });
    return this.bubbles.length > 0;
  }

  /** Le débordement : des gouttes sautent par-dessus le bord intérieur. */
  private spray(W: number, H: number) {
    for (let i = 0; i < 22; i++) {
      this.bubbles.push({ spray: true, x: Math.random() * W, y: 2 + Math.random() * 4, r: 1 + Math.random() * 1.6, vy: -60 - Math.random() * 90, vx: (Math.random() - 0.5) * 80, phase: 0, life: 1.4 });
    }
    for (let i = 0; i < 6; i++) splash(this.surf, Math.random(), 120 + H, 0.1);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, light: { color: string; alpha: number }, env: number, matter: LiquidMatter) {
    if (!this.bubbles.length) return;
    for (const b of this.bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      if (matter === "light" || b.spray) {
        ctx.fillStyle = rgba(light.color, light.alpha * env * (b.spray ? Math.min(1, b.life ?? 1) : 0.8));
        ctx.fill();
      } else {
        // Une bulle : un cercle fin et un petit reflet.
        ctx.strokeStyle = rgba(light.color, light.alpha * env * 0.85);
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, Math.max(0.4, b.r * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = rgba(light.color, light.alpha * env * 0.7);
        ctx.fill();
      }
    }
  }

  /** Le grain du sable (ou de l'eau trouble) : des points fixes, qui ne scintillent pas. */
  private grains(ctx: CanvasRenderingContext2D, W: number, H: number, baseY: number, color: string, alpha: number, k: number) {
    const n = Math.min(160, Math.round((W * (H - baseY)) / 90 * k));
    ctx.fillStyle = rgba(mix(color, "#ffffff", 0.25), alpha * 0.5);
    for (let i = 0; i < n; i++) {
      const x = ((i * 73.13) % 1) * W + ((i * 17) % W);
      const y = baseY + 3 + (((i * 0.6180339) % 1) * (H - baseY - 3));
      ctx.fillRect(x % W, y, 1, 1);
    }
  }

  private streaks(ctx: CanvasRenderingContext2D, tS: number, W: number, H: number, baseY: number, light: { color: string; alpha: number }, env: number, still: boolean) {
    const depth = H - baseY;
    if (depth < 6) return;
    ctx.strokeStyle = rgba(light.color, light.alpha * env * 0.45);
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = baseY + depth * (0.25 + 0.6 * ((i * 0.37) % 1));
      const len = 18 + (i % 3) * 10;
      const x = still ? (i / 5) * W : ((tS * (60 + i * 14) + i * 97) % (W + len)) - len;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
  }

  /** La nuit : quelques étoiles reflétées, qui scintillent à peine. */
  private stars(ctx: CanvasRenderingContext2D, tS: number, W: number, H: number, baseY: number, env: number, still: boolean) {
    const depth = H - baseY;
    if (depth < 4) return;
    for (let i = 0; i < 7; i++) {
      const x = ((i * 0.618 + 0.1) % 1) * W;
      const y = baseY + 2 + depth * ((i * 0.37) % 0.8);
      const tw = still ? 0.7 : 0.5 + 0.5 * Math.sin(tS * 1.3 + i * 2);
      ctx.fillStyle = `rgba(255,248,220,${(0.25 + 0.3 * tw) * env})`;
      const s = 0.8 + (i % 3) * 0.4;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }

  /** Les ronds dans l'eau (clic, goutte d'une notification). */
  private drawRings(ctx: CanvasRenderingContext2D, t: number, W: number, surfaceAt: (x: number) => number, light: { color: string; alpha: number }, env: number) {
    this.rings = this.rings.filter((r) => t - r.at < RING_MS);
    for (const r of this.rings) {
      const k = (t - r.at) / RING_MS;
      const x = r.x * W;
      ctx.beginPath();
      ctx.ellipse(x, surfaceAt(x) + 1.5, 4 + k * 34, 1 + k * 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(light.color, light.alpha * env * (1 - k) * 0.8);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Une goutte tombe du haut de l'île jusqu'à la surface, puis fait des ronds. */
  private drawDrops(ctx: CanvasRenderingContext2D, t: number, W: number, surfaceAt: (x: number) => number, light: { color: string; alpha: number }, env: number) {
    this.drops = this.drops.filter((d) => {
      const k = (t - d.at) / DROP_FALL_MS;
      const x = d.x * W;
      const yEnd = surfaceAt(x);
      if (k >= 1) {
        splash(this.surf, d.x, 160, 0.05);
        this.rings.push({ x: d.x, at: t }, { x: d.x, at: t + 220 });
        return false;
      }
      const y = -4 + (yEnd + 4) * k * k;
      ctx.beginPath();
      ctx.ellipse(x, y, 1.8, 2.8, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgba(light.color, Math.max(0.5, light.alpha) * env);
      ctx.fill();
      return true;
    });
  }

  /** La pluie sur la vitre : des gouttes qui glissent en laissant une traînée. */
  private rainStep(dt: number, W: number, H: number): boolean {
    this.rainAcc += dt * 3.5 * Math.min(2, W / 250);
    while (this.rainAcc >= 1 && this.rain.length < 18) {
      this.rainAcc -= 1;
      this.rain.push({ x: Math.random() * W, y: -6, len: 4 + Math.random() * 8, vy: 18 + Math.random() * 40 });
    }
    this.rain = this.rain.filter((d) => {
      // Elles hésitent, puis glissent (comme sur une vraie vitre).
      d.y += d.vy * dt * (0.6 + 0.4 * Math.sin(d.x + d.y * 0.2));
      return d.y - d.len < H;
    });
    return true;
  }

  private drawRain(ctx: CanvasRenderingContext2D, W: number, H: number, env: number, still: boolean) {
    if (still && !this.rain.length) {
      // Figé : quelques gouttes posées sur la vitre.
      for (let i = 0; i < 8; i++) this.rain.push({ x: ((i * 0.618 + 0.07) % 1) * W, y: ((i * 0.41) % 1) * H, len: 5 + (i % 3) * 3, vy: 0 });
    }
    for (const d of this.rain) {
      const g = ctx.createLinearGradient(0, d.y - d.len * 2, 0, d.y);
      g.addColorStop(0, "rgba(200,225,255,0)");
      g.addColorStop(1, `rgba(200,225,255,${0.32 * env})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - d.len * 2);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,235,255,${0.4 * env})`;
      ctx.fill();
    }
  }

  /** La bouée d'Ondine quand le minuteur déborde : un anneau rouge et blanc derrière elle, sur l'eau. */
  private buoy(ctx: CanvasRenderingContext2D, surfaceAt: (x: number) => number, env: number) {
    const slot = this.shell.querySelector(".mascot-slot");
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const s = this.shell.getBoundingClientRect();
    if (r.width < 8) return;
    const x = r.left - s.left + r.width / 2;
    const y = Math.max(r.top - s.top + r.height * 0.62, surfaceAt(x));
    const R = r.width * 0.46;
    ctx.save();
    ctx.lineWidth = Math.max(3, R * 0.32);
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y, R, R * 0.38, 0, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2);
      ctx.strokeStyle = i % 2 ? `rgba(240,240,245,${0.85 * env})` : `rgba(230,70,70,${0.85 * env})`;
      ctx.stroke();
    }
    ctx.restore();
  }
}
