// L'île-bouche d'Ondine (réglage island.style = "mouth", 1.2.3) : le corps en
// gomme dessiné autour de l'île, qui est sa bouche.
//
// Un <canvas> transparent de la taille de la fenêtre, au-dessus de l'île
// (pointer-events: none) : la bouche y est un trou, l'île se voit au travers.
// À chaque image où quelque chose bouge, on relit le rectangle de la bouche
// (l'île, avec sa gelée : jelly.ts) et on pose le corps autour (mouth-geom.ts),
// dessiné dans la matière de la goutte gomme (mouth-draw.ts). Le corps suit
// donc la même gelée que l'île, sans ressort de plus pour sa taille.
//
// Ses ressorts à lui : `retreat` (masquée : elle remonte derrière le bord ;
// aperçu : on ne voit plus que sa pointe), `swell` (un petit rebond : fermeture,
// alerte, gloups d'un fichier avalé, retour d'Ondine), `eyesIn` (les yeux qui
// réapparaissent). Les clignements au repos (pas en Calme), les reflets des
// yeux qui suivent la souris, et Ondine qui somnole dans l'encoche (idée 2).
//
// Une seule boucle requestAnimationFrame, arrêtée dès que tout est posé.
// « Réduire les animations » : ni rebond, ni clignement ; elle se montre et se
// cache en fondu.
//
// Sert aussi à la fenêtre d'Ondine sur le bureau (src/pet/main.ts) : là, il
// n'y a pas d'île dessous, la bouche est remplie (`fill`).

import { ECO_FPS, perfMode } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import { isHexColor, palette, TINT_NAMES, DEFAULT_CUSTOM, type GumTint, type Palette } from "../mascot/renderers/gum-draw";
import { drawMouthBody } from "./mouth-draw";
import { distanceTo, eyeOpenness, layoutMouth, type Box, type MouthDir, type MouthLayout } from "./mouth-geom";
import { springAtRest, stepSpring, type Spring } from "./spring";
import { reducedMotion } from "./tab-pill";

/** Ressort des petits mouvements du corps : vif, un peu de rebond. */
const BOUNCY = { stiffness: 420, damping: 0.42 };
/** Ressort de la remontée derrière le bord : doux. */
const SOFT = { stiffness: 160, damping: 0.85 };

export type Retreat = "shown" | "peek" | "hidden";

export interface MouthHooks {
  /** Le rectangle de la bouche dans la fenêtre (null : rien à dessiner). */
  mouth(): Box | null;
  /** L'arrondi de la bouche (px). */
  mouthR(): number;
  /** Du côté de la bouche où sont les yeux. */
  dir(): MouthDir;
  /** Remplir la bouche de cette couleur (pas d'île dessous). */
  fill?(): string;
  /** Imposer l'ouverture (0 nano, 1 mini, 2 ouverte) au lieu de la lire sur l'épaisseur. */
  openness?(): number | null;
}

/** La palette gomme de la mascotte choisie (réglage mascot.color ; « auto » = le bleu de la goutte). */
export function mascotPalette(t = 0): Palette {
  const m = settingsStore.current.mascot as { color?: string; customColor?: string };
  const c = m.color ?? "auto";
  const tint: GumTint = c !== "auto" && (TINT_NAMES as string[]).includes(c) ? (c as GumTint) : "blue";
  return palette(tint, t, isHexColor(m.customColor) ? m.customColor : DEFAULT_CUSTOM);
}

export class MouthBody {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private timer = 0;
  private last = 0;
  private stable = 0;
  private lastKey = "";
  private layout: MouthLayout | null = null;
  private retreat: Spring = { x: 0, v: 0 };
  private retreatTo: Retreat = "shown";
  private swell: Spring = { x: 0, v: 0 };
  private eyesIn: Spring = { x: 1, v: 0 };
  private eyesWanted = 1;
  private blinkUntil = 0;
  private blinkTimer = 0;
  private look: { x: number; y: number } | null = null;
  private dozing = false;
  private mouseNear = { d: Infinity, left: false };
  private destroyed = false;

  constructor(
    host: HTMLElement,
    private readonly hooks: MouthHooks,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mouth-body";
    this.canvas.setAttribute("aria-hidden", "true");
    host.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    window.addEventListener("resize", this.onResize);
    this.onResize();
    this.scheduleBlink();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    window.clearTimeout(this.blinkTimer);
    window.removeEventListener("resize", this.onResize);
    this.canvas.remove();
  }

  private onResize = () => {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    this.lastKey = "";
    this.wake();
  };

  // ── Les entrées ────────────────────────────────────────────────────────────

  /** Quelque chose a peut-être bougé : la boucle repart. */
  wake() {
    this.stable = 0;
    if (this.raf || this.timer || this.destroyed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Visible, aperçu (seule la pointe dépasse) ou cachée derrière le bord. */
  setRetreat(r: Retreat) {
    if (r === this.retreatTo) return;
    this.retreatTo = r;
    if (reducedMotion()) {
      this.retreat.x = this.retreatTarget();
      this.retreat.v = 0;
    }
    this.wake();
  }

  /** Un petit rebond du corps (fermeture, alerte, gloups, retour). */
  kick(amount = 1) {
    if (reducedMotion()) return;
    this.swell.v += 140 * amount;
    this.wake();
  }

  /** Un clignement (« gloups » à la fermeture). */
  blink() {
    if (reducedMotion()) return;
    this.blinkUntil = performance.now() + 130;
    this.wake();
  }

  /** Les yeux (Ondine dans sa bouche) ou une bouche vide (Ondine sortie). */
  setEyes(on: boolean) {
    const v = on ? 1 : 0;
    if (v === this.eyesWanted) return;
    this.eyesWanted = v;
    if (reducedMotion()) this.eyesIn.x = v;
    else if (on) this.kick(0.8);
    this.wake();
  }

  /** Elle somnole dans l'encoche (idée 2). */
  setDozing(on: boolean) {
    if (on === this.dozing) return;
    this.dozing = on;
    this.wake();
  }

  get isDozing(): boolean {
    return this.dozing;
  }

  /** La souris (px de la fenêtre) : les reflets la suivent, un œil s'ouvre si elle approche. */
  pointer(x: number, y: number) {
    const L = this.layout;
    if (!L) return;
    const e0 = L.frame.map(L.eyes[0].u, L.eyes[0].v);
    const e1 = L.frame.map(L.eyes[1].u, L.eyes[1].v);
    const cx = (e0.x + e1.x) / 2;
    const cy = (e0.y + e1.y) / 2;
    const next = { x: x - cx, y: y - cy };
    const d = distanceTo(L.bounds, x, y);
    const left = x < cx;
    const moved = !this.look || Math.abs(next.x - this.look.x) + Math.abs(next.y - this.look.y) > 2;
    const nearChanged = (d <= 140) !== (this.mouseNear.d <= 140) || left !== this.mouseNear.left;
    this.look = next;
    this.mouseNear = { d, left };
    if (moved || nearChanged) this.wake();
  }

  /** Le rectangle du corps (sans la pointe) et ses arrondis, pour le halo et la zone cliquable. */
  shape(): { x: number; y: number; w: number; h: number; r: { tl: number; tr: number; br: number; bl: number } } | null {
    const L = this.layout;
    if (!L || this.retreat.x > 1) return null;
    const a = L.frame.map(L.local.u0, L.local.v0);
    const b = L.frame.map(L.local.u1, L.local.v1);
    const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    const rb = L.p.rBack;
    const rf = L.p.rFront;
    const r =
      L.dir === "up" ? { tl: rf, tr: rf, br: rb, bl: rb } : L.dir === "right" ? { tl: rb, tr: rf, br: rf, bl: rb } : L.dir === "left" ? { tl: rf, tr: rb, br: rb, bl: rf } : { tl: rb, tr: rb, br: rf, bl: rf };
    return { ...box, r };
  }

  /** Le rectangle de tout le corps (pointe comprise), dans la fenêtre. */
  bounds(): Box | null {
    return this.layout && this.retreat.x < 1 ? this.layout.bounds : null;
  }

  // ── La boucle ──────────────────────────────────────────────────────────────

  private retreatTarget(): number {
    const L = this.layout;
    const thick = L ? L.local.v1 - L.local.v0 + L.p.tipH : 60;
    if (this.retreatTo === "hidden") return thick + 8;
    if (this.retreatTo === "peek") return Math.max(0, thick - Math.max(6, L?.p.tipH ?? 8) - 2);
    return 0;
  }

  private scheduleBlink() {
    window.clearTimeout(this.blinkTimer);
    this.blinkTimer = window.setTimeout(() => {
      // Calme : pas de clignements. Endormie : les yeux sont déjà fermés.
      const calm = !!settingsStore.current.mascot.calm;
      if (!calm && !this.dozing && !document.hidden) this.blink();
      this.scheduleBlink();
    }, 2600 + Math.random() * 3200);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  private frame(now: number) {
    this.raf = 0;
    this.timer = 0;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const reduce = reducedMotion();
    stepSpring(this.retreat, this.retreatTarget(), SOFT, reduce ? 1 : dt);
    if (reduce) {
      this.retreat.x = this.retreatTarget();
      this.swell.x = this.swell.v = 0;
      this.eyesIn.x = this.eyesWanted;
    } else {
      stepSpring(this.swell, 0, BOUNCY, dt);
      stepSpring(this.eyesIn, this.eyesWanted, BOUNCY, dt);
    }
    const drew = this.draw(now);
    const moving =
      !springAtRest(this.retreat, this.retreatTarget()) ||
      !springAtRest(this.swell, 0, 0.05, 0.5) ||
      !springAtRest(this.eyesIn, this.eyesWanted, 0.01, 0.05) ||
      now < this.blinkUntil + 20 ||
      (settingsStore.current.mascot as { color?: string }).color === "rainbow";
    if (drew || moving) this.stable = 0;
    else this.stable++;
    // L'île peut encore bouger sans nous prévenir (sa gelée) : quelques images de marge.
    if (this.stable > 24 || this.destroyed) return;
    if (perfMode() === "eco") this.timer = window.setTimeout(() => (this.raf = requestAnimationFrame((t) => this.frame(t))), 1000 / ECO_FPS - 4);
    else this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Dessine si quelque chose a changé ; renvoie vrai dans ce cas. */
  private draw(now: number): boolean {
    const ctx = this.ctx;
    const m = this.hooks.mouth();
    if (!ctx) return false;
    const dir = this.hooks.dir();
    const blink = now < this.blinkUntil ? 1 : 0;
    const [l, r] = eyeOpenness(this.dozing, this.mouseNear.d, this.mouseNear.left);
    const key = m
      ? [m.x, m.y, m.w, m.h, dir, this.retreat.x, this.swell.x, this.eyesIn.x, blink, l, r, this.look?.x ?? 0, this.look?.y ?? 0, this.hooks.mouthR(), this.hooks.openness?.() ?? -1]
          .map((v) => (typeof v === "number" ? v.toFixed(1) : v))
          .join(",")
      : "none";
    const rainbow = (settingsStore.current.mascot as { color?: string }).color === "rainbow";
    if (key === this.lastKey && !rainbow) return false;
    this.lastKey = key;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!m) {
      this.layout = null;
      return true;
    }
    // Masquée : tout le corps glisse vers le bord (il passe derrière).
    const L0 = layoutMouth(m, dir, this.hooks.openness?.() ?? undefined);
    const back = L0.frame.map(0, -this.retreat.x);
    const zero = L0.frame.map(0, 0);
    const shift = { x: back.x - zero.x, y: back.y - zero.y };
    const mouth = { x: m.x + shift.x, y: m.y + shift.y, w: m.w, h: m.h };
    const L = layoutMouth(mouth, dir, this.hooks.openness?.() ?? undefined);
    // Le rebond : la zone des yeux et la pointe s'allongent un instant.
    if (Math.abs(this.swell.x) > 0.01) {
      L.p.eyeZone = Math.max(4, L.p.eyeZone + this.swell.x * 0.25);
      if (L.p.tipH > 0) L.p.tipH = Math.max(2, L.p.tipH + this.swell.x * 0.15);
      L.local.v1 = L.frame.thick + L.p.eyeZone;
      L.eyes.forEach((e) => (e.v += this.swell.x * 0.12));
    }
    this.layout = L;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const alpha = reducedMotion() && this.retreatTo === "hidden" ? 0 : 1;
    drawMouthBody(ctx, L, mouth, mascotPalette(now / 1000), {
      eyes: [l, r],
      look: this.look,
      blink,
      showEyes: this.eyesIn.x > 0.05,
      fill: this.hooks.fill?.(),
      mouthR: this.hooks.mouthR(),
      alpha,
    });
    return true;
  }
}
