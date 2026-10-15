// La bande en tête d'une page des Réglages (1.2.4) : grand titre, une phrase
// courte, les boutons principaux, sur un fond noir où la couleur de la page
// respire dans un coin. De l'eau : des bulles qui montent et s'écartent de la
// souris, une vague qui ondule en bas, et deux ou trois gouttes de la famille
// gomme qui flottent dessus, nagent, regardent autour d'elles et sautent
// quand on clique dessus.
//
// UNE seule boucle d'animation pour toutes les bandes (`loop`) : elle dessine
// la mer de chaque bande et fait avancer ses mascottes (leurs moteurs gomme
// reçoivent cette boucle comme hôte, voir `engineEnv`). Elle s'arrête quand
// la fenêtre est cachée, quand aucune bande n'est à l'écran, et ne tourne
// pas du tout avec « Réduire les animations » ou en mode éco : la bande est
// alors une image fixe (redessinée seulement quand elle change de taille).
// Calculs purs : hero-sea.ts (eau, bulles, nage), hero-theme.ts (couleurs,
// troupes). Technique reprise d'un projet sous licence MIT (voir
// THIRD-PARTY.md), sans son personnage : chez Ondine, ce sont nos gouttes.

import manifest from "../../mascots/goutte-gomme/manifest.json";
import { onPerfChange, perfMode } from "../core/perf";
import { el } from "../island/dom";
import { reducedMotion } from "../island/tab-pill";
import { PODIUM_TINT } from "../mascot/gum-family";
import { animSpec } from "../mascot/gum-standalone";
import { GumEngine, GUM_PREFS_DEFAULT, type GumEnv } from "../mascot/renderers/gum-engine";
import type { MascotManifest } from "../mascot/types";
import {
  ageRipples,
  bubbleAlpha,
  bubbleCount,
  bubblePos,
  castRoom,
  spawnBubble,
  stepBubble,
  stepSwimmer,
  swimZone,
  waveSlope,
  waveY,
  type Bubble,
  type Ripple,
  type Swimmer,
} from "./hero-sea";
import { castForBand, castLayout, cleanCast, rgba, shapeOf } from "./hero-theme";

export interface HeroOptions {
  /** Le titre de la page. */
  title: string;
  /** Une phrase courte sous le titre. */
  subtitle?: string;
  /** La couleur de la page (#rrggbb). */
  color: string;
  /** Les mascottes de la famille gomme qui vivent dans la bande (ids de gum-family). */
  mascots?: string[];
  /** Les boutons principaux de la page. */
  actions?: HTMLElement[];
}

/** Les gestes joués quand on clique sur une mascotte, ou de temps en temps. */
const POKED = ["surprise", "rire", "coucou", "love", "etoiles", "fiere", "wink"];
const IDLE_GESTURES = ["coucou", "happy", "wink", "etoiles", "calm", "pensive", "rire"];

/** Image fixe : « Réduire les animations » de Windows, ou le mode éco. */
function still(): boolean {
  return reducedMotion() || perfMode() === "eco";
}

// ── La boucle commune ─────────────────────────────────────────────────────────

interface Band {
  el: HTMLElement;
  /** Dessine la bande ; dt = 0 en image fixe. */
  draw(dt: number, t: number): void;
  dispose(): void;
  /** Dans la page depuis au moins une image (une bande retirée ensuite est jetée). */
  shown: boolean;
  born: number;
  /** Visible à l'écran (IntersectionObserver). */
  onScreen: boolean;
  /** Images encore à dessiner en image fixe (après un changement de taille, un clic). */
  settle: number;
}

const bands = new Set<Band>();
let raf = 0;
let last = 0;
/** L'heure de la mer : elle n'avance que quand on anime (image fixe : toujours la même). */
let clock = 0;

function needsFrame(b: Band): boolean {
  // Pas (ou plus) dans la page : une image pour l'attendre, ou pour la jeter.
  if (!b.el.isConnected) return true;
  return b.onScreen && (!still() || b.settle > 0);
}

function schedule() {
  if (raf || typeof document === "undefined" || document.hidden) return;
  for (const b of bands) {
    if (needsFrame(b)) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
      return;
    }
  }
}

function loop(now: number) {
  raf = 0;
  const fixed = still();
  const dt = fixed ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;
  for (const b of [...bands]) {
    if (!b.el.isConnected) {
      // Construite mais pas encore posée : on l'attend (5 s au plus).
      if (b.shown || now - b.born > 5000) {
        b.dispose();
        bands.delete(b);
      }
      continue;
    }
    b.shown = true;
    if (!b.onScreen || (fixed && b.settle <= 0)) continue;
    b.draw(dt, clock);
    if (b.settle > 0) b.settle--;
  }
  schedule();
}

/** Tout redessiner une fois (le mode a changé : image fixe ↔ animée). */
function refreshAll() {
  for (const b of bands) b.settle = Math.max(b.settle, 3);
  schedule();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAll();
  });
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", refreshAll);
  onPerfChange(refreshAll);
}

/** La toile à la taille de son élément (pixels nets sur un écran à 150 %). */
function fit(canvas: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D | null } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

// ── Les mascottes ─────────────────────────────────────────────────────────────

interface Floater {
  id: string;
  wrap: HTMLElement;
  engine: GumEngine | null;
  swim: Swimmer;
  scale: number;
  start: number;
  /** Les dessins que le moteur a demandés à son hôte (notre boucle). */
  draws: Set<(now: number) => void>;
  nextEvent: number;
  /** Regarder quelque chose un moment (une voisine, un coin de la bande). */
  gaze: { x: number; y: number; until: number } | null;
  /** La taille et la position dessinées (pour viser avec la souris). */
  size: number;
  cx: number;
  cy: number;
  tilt: number;
}

const BASE = manifest as unknown as MascotManifest;

/** L'hôte des moteurs gomme de la bande : nos réglages fixes et NOTRE boucle (une seule pour tout). */
function engineEnv(draws: Set<(now: number) => void>): GumEnv {
  return {
    prefs: () => ({ ...GUM_PREFS_DEFAULT, hands: "gestures" }),
    onPrefsChange: () => () => {},
    frameLoop: (_target, draw) => {
      draws.add(draw);
      return () => draws.delete(draw);
    },
    reducedMotion: still,
  };
}

function makeFloater(id: string, start: number, scale: number): Floater {
  const wrap = el("div", { class: "page-hero-mascot", "aria-hidden": "true" });
  return {
    id,
    wrap,
    engine: null,
    swim: { x: 0, target: 0, hop: 0, hopV: 0, pause: 0.5 + Math.random() * 2, dir: Math.random() < 0.5 ? -1 : 1 },
    scale,
    start,
    draws: new Set(),
    nextEvent: 3 + Math.random() * 5,
    gaze: null,
    size: 0,
    cx: 0,
    cy: 0,
    tilt: 0,
  };
}

/** Le moteur est créé une fois la bande dans la page (sa taille est connue). */
function wake(f: Floater) {
  if (f.engine) return;
  const shape = shapeOf(f.id) ?? "goutte";
  const engine = new GumEngine({ ...BASE, id: f.id, gum: { shape } }, engineEnv(f.draws));
  const tint = PODIUM_TINT[f.id];
  if (tint) engine.setTintOverride(tint);
  engine.mount(f.wrap);
  engine.onAnimationEnd(() => engine.play(animSpec("idle")));
  engine.play(animSpec("idle"));
  f.engine = engine;
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

// ── La bande ──────────────────────────────────────────────────────────────────

/** La bande, à poser en haut de la page. */
export function hero(opts: HeroOptions): HTMLElement {
  const color = opts.color;
  const band = el(
    "section",
    { class: "page-hero" },
    el("canvas", { class: "page-hero-sea", "aria-hidden": "true" }),
    el("div", { class: "page-hero-cast" }),
    el("canvas", { class: "page-hero-front", "aria-hidden": "true" }),
    el(
      "div",
      { class: "page-hero-copy" },
      el("h1", {}, opts.title),
      opts.subtitle ? el("p", {}, opts.subtitle) : null,
      opts.actions?.length ? el("div", { class: "page-hero-actions" }, ...opts.actions) : null,
    ),
  );
  band.style.setProperty("--page-color", color);
  band.style.setProperty("--page-glow", rgba(color, 0.5));
  band.style.setProperty("--page-soft", rgba(color, 0.14));
  if (opts.actions?.length) band.classList.add("has-actions");
  // Pas de canvas (tests, très vieux navigateur) : la bande reste une bande.
  if (typeof HTMLCanvasElement === "undefined") return band;

  const sea = band.querySelector<HTMLCanvasElement>(".page-hero-sea")!;
  const front = band.querySelector<HTMLCanvasElement>(".page-hero-front")!;
  const castBox = band.querySelector<HTMLElement>(".page-hero-cast")!;
  const ids = cleanCast(opts.mascots?.length ? opts.mascots : castForBand(opts.title, color));
  const layout = castLayout(ids.length);
  const cast = ids.map((id, i) => makeFloater(id, layout[i].start, layout[i].scale));
  for (const f of cast) castBox.append(f.wrap);

  let bubbles: Bubble[] = [];
  let ripples: Ripple[] = [];
  let pointer: { x: number; y: number } | null = null;
  let strength = 0;
  let placed = false;
  let room = cast.length;

  const record: Band = {
    el: band,
    shown: false,
    born: performance.now(),
    onScreen: true,
    settle: 2,
    draw,
    dispose() {
      seen?.disconnect();
      sizes?.disconnect();
      for (const f of cast) f.engine?.destroy();
    },
  };

  band.addEventListener("pointermove", (e) => {
    const r = band.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  // Image fixe : rien ne suit la souris (seul un clic change l'expression).
  band.addEventListener("pointerleave", () => (pointer = null));
  for (const f of cast) {
    f.wrap.addEventListener("click", (e) => {
      const engine = f.engine;
      if (!engine) return;
      const r = f.wrap.getBoundingClientRect();
      engine.react("poke", { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) });
      const gesture = animSpec(pick(POKED));
      engine.play(gesture);
      if (still()) {
        // Pas de saut : l'expression change, une image ; puis elle revient au repos.
        record.settle = Math.max(record.settle, 4);
        window.setTimeout(() => {
          engine.play(animSpec("idle"));
          record.settle = Math.max(record.settle, 4);
          schedule();
        }, gesture.durationMs);
      } else if (f.swim.hop <= 0) f.swim.hopV = 300;
      schedule();
    });
  }

  const seen =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          record.onScreen = entries[entries.length - 1].isIntersecting;
          if (record.onScreen) {
            record.settle = Math.max(record.settle, 2);
            schedule();
          }
        })
      : null;
  seen?.observe(band);
  const sizes =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          placed = false;
          record.settle = Math.max(record.settle, 3);
          schedule();
        })
      : null;
  sizes?.observe(band);

  function draw(dt: number, t: number) {
    const { w, h, ctx } = fit(sea);
    if (!ctx || w === 0 || h === 0) return;
    const fixed = dt === 0 && still();
    // La mer : plate et sans ronds en image fixe.
    const amp = fixed ? 2 : 4;
    const base = h - 24;
    ripples = ageRipples(ripples, dt);
    strength += ((pointer ? 1 : 0) - strength) * Math.min(1, dt * 4 || 1);

    ctx.clearRect(0, 0, w, h);
    // La couleur de la page qui respire dans le coin en haut à droite.
    const breath = fixed ? 1 : 0.9 + 0.1 * Math.sin((t * Math.PI * 2) / 7);
    const gx = w * 0.84;
    const gy = -h * 0.2;
    const gr = Math.max(w * 0.42, h * 2) * breath;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    glow.addColorStop(0, rgba(color, 0.55 * breath));
    glow.addColorStop(0.35, rgba(color, 0.22 * breath));
    glow.addColorStop(0.7, rgba(color, 0.05));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Les bulles : elles montent, la souris les écarte.
    const want = bubbleCount(w, h);
    if (bubbles.length === 0) bubbles = Array.from({ length: want }, () => spawnBubble(w, h, Math.random, false));
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      if (dt > 0 && !stepBubble(b, dt, t, pointer, strength)) bubbles[i] = spawnBubble(w, h, Math.random, true);
      const p = bubblePos(bubbles[i], t);
      const a = bubbleAlpha(p.y, h);
      if (a <= 0.01) continue;
      const r = bubbles[i].r;
      const fill = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, 0, p.x, p.y, r);
      fill.addColorStop(0, `rgba(255,255,255,${0.55 * a})`);
      fill.addColorStop(0.4, rgba(color, 0.1 * a));
      fill.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(190,230,255,${0.35 * a})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (bubbles.length > want) bubbles.length = want;

    // La vague de derrière (plus pâle, décalée).
    wave(ctx, w, h, (x) => waveY(x + 140, t * 0.7 + 2, base - 7, amp * 0.8), rgba(color, 0.08), null);

    // Les mascottes, entre les deux vagues.
    floaters(dt, t, w, h, base, amp, fixed);

    // La vague de devant, sur une toile à part (au-dessus des mascottes).
    const f = fit(front);
    if (f.ctx && f.w > 0) {
      const top = h - f.h;
      f.ctx.clearRect(0, 0, f.w, f.h);
      wave(f.ctx, f.w, f.h, (x) => waveY(x, t, base, amp, ripples) - top, rgba(color, 0.13), "rgba(200,232,255,0.45)");
    }
  }

  function floaters(dt: number, t: number, w: number, h: number, base: number, amp: number, fixed: boolean) {
    const size = Math.max(56, Math.min(120, h * 0.6));
    room = castRoom(w, cast.length);
    const zone = swimZone(w, size);
    cast.forEach((f, i) => {
      const visible = i < room;
      f.wrap.hidden = !visible;
      if (!visible) return;
      wake(f);
      const s = Math.round(size * f.scale);
      if (f.size !== s) {
        f.wrap.style.width = `${s}px`;
        f.wrap.style.height = `${s}px`;
        f.size = s;
      }
      const lo = zone.lo;
      const hi = zone.hi;
      if (!placed) {
        f.swim.x = lo + (hi - lo) * f.start;
        f.swim.target = f.swim.x;
      }
      if (dt > 0) {
        const landed = stepSwimmer(f.swim, dt, lo, hi, Math.random);
        if (landed) ripples.push({ x: f.swim.x, age: 0, amp: 2.5 + s * 0.03 });
        events(f, dt, t);
      }
      const surface = waveY(f.swim.x, t, base, amp, ripples);
      // Les pieds de la goutte sont à 80 % du carré (gum-draw.ts) : elle trempe un peu dans l'eau.
      const top = surface - s * 0.8 + s * 0.1 - f.swim.hop;
      const tilt = fixed ? 0 : Math.max(-0.25, Math.min(0.25, waveSlope(f.swim.x, t, base, amp, ripples) * 0.9));
      f.tilt += (tilt - f.tilt) * Math.min(1, dt * 6 || 1);
      f.wrap.style.transform = `translate(${(f.swim.x - s / 2).toFixed(1)}px, ${top.toFixed(1)}px) rotate(${f.tilt.toFixed(3)}rad)`;
      f.cx = f.swim.x;
      f.cy = top + s * 0.55;
      look(f, t);
      for (const d of f.draws) d(performance.now());
    });
    placed = true;
  }

  /** Les petites envies : sauter, faire un geste, regarder une voisine. */
  function events(f: Floater, dt: number, t: number) {
    f.nextEvent -= dt;
    if (f.nextEvent > 0) return;
    f.nextEvent = 5 + Math.random() * 7;
    const roll = Math.random();
    if (roll < 0.25 && f.swim.hop <= 0) f.swim.hopV = 220;
    else if (roll < 0.55) f.engine?.play(animSpec(pick(IDLE_GESTURES)));
    else if (roll < 0.85) {
      const others = cast.filter((o, i) => o !== f && i < room);
      const other = others.length ? pick(others) : null;
      f.gaze = other ? { x: other.cx, y: other.cy, until: t + 2.2 } : { x: f.cx + (Math.random() < 0.5 ? -200 : 200), y: f.cy - 60, until: t + 1.8 };
    }
  }

  /** Les yeux : la souris quand elle est sur la bande, sinon une voisine, sinon droit devant en nageant. */
  function look(f: Floater, t: number) {
    const e = f.engine;
    if (!e) return;
    if (pointer) e.lookAt(pointer.x - f.cx, pointer.y - f.cy);
    else if (f.gaze && f.gaze.until > t) e.lookAt(f.gaze.x - f.cx, f.gaze.y - f.cy);
    else if (Math.abs(f.swim.target - f.swim.x) > 1) e.lookAt(f.swim.dir * 90, 12);
    else e.lookAt(null, null);
  }

  bands.add(record);
  schedule();
  return band;
}

/** Une vague : remplie jusqu'en bas, avec un liseré clair sur le dessus. */
function wave(ctx: CanvasRenderingContext2D, w: number, h: number, y: (x: number) => number, fill: string, stroke: string | null) {
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  for (let x = 6; x < w + 6; x += 6) ctx.lineTo(x, y(x));
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
