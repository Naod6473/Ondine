// L'éclosion de l'île, au premier lancement (avant l'assistant) et après une
// mise à jour (avant « Quoi de neuf ») : une goutte sort du haut de l'écran
// et s'étire en île, l'île éclate en paillettes, Ondine sort de l'éclat, dit
// bonjour, aspire les paillettes, les souffle dans trois anneaux de ce qui
// est prêt, puis l'île se replie en mini-île et un liseré de lumière en fait
// le tour. Le déroulé et les calculs : hatch-plan.ts.
//
// Le dessin : deux canvas sur toute la fenêtre de l'île (derrière et devant
// Ondine), et entre les deux la vraie mascotte gomme (GumRenderer, le moteur
// de l'île, avec ses réglages : couleur, accessoires) dans une case qu'on
// déplace et étire. La vraie île est cachée pendant ce temps (island.ts,
// classe `hatching` sur <body>) et reprend la main en fondu à la fin.
//
// Un clic passe directement au repli. Les sons sont ceux de l'île
// (sounds.ts) : muets si les sons sont coupés. La « profondeur » (un voile
// sombre autour de l'île) n'existe qu'en style Studio.
//
// Idée tirée de notch-launch-animation de Bora Kurt (licence MIT), redessinée
// pour Ondine ; aucun code n'en est repris.

import { findMascot, type CatalogEntry } from "../mascot/catalog";
import { GumRenderer } from "../mascot/renderers/gum";
import type { AnimationSpec } from "../mascot/types";
import { el } from "./dom";
import {
  DUST_COLORS,
  END,
  FOLD_START,
  HALO,
  HALO_LEN,
  LAND,
  RING_COUNT,
  RING_R,
  T,
  clamp,
  gapeAt,
  geometry,
  grainAt,
  gumAnimAt,
  homeOf,
  inflateAt,
  islandAt,
  lerp,
  planDust,
  ringCenter,
  ringFill,
  ringTip,
  ringWindow,
  smooth,
  soundCues,
  spr,
  dropAt,
  type Geometry,
  type Grain,
  type Ring,
  type Shape,
} from "./hatch-plan";
import { sounds } from "./sounds";

export interface HatchTexts {
  hello: string;
  /** Pendant qu'elle prépare. */
  busy: string;
  /** Quand tout est plein. */
  done: string;
  /** Dans la mini-île, à la fin. */
  mini: string;
}

export interface HatchOptions {
  texts: HatchTexts;
  rings: Ring[];
  /** La mascotte de l'île (une de la famille gomme ; sinon la goutte gomme). */
  mascotId: string;
  /** Couleur du fond et du texte de l'île (son thème). */
  islandColor: string;
  textColor: string;
  /** Style Studio : le voile de profondeur autour de l'île. */
  studio: boolean;
  /** Le rectangle qui prend la souris (pour le clic qui passe). */
  onRect: (x: number, y: number, w: number, h: number) => void;
}

const INK = "#1a1630";
const FADE_MS = 300;

/** La case de la mascotte : sa taille de dessin (elle est ensuite étirée par transform). */
const GUM_BOX = 120;

function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function mix(c1: string, c2: string, u: number) {
  const a = rgb(c1);
  const b = rgb(c2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], u))).join(",")})`;
}

/** Un rectangle collé en haut, coins du bas arrondis. */
function islandPath(ctx: CanvasRenderingContext2D, s: Shape, grow = 0) {
  const x = s.x - grow;
  const w = s.w + grow * 2;
  const h = s.h + grow;
  const r = Math.max(0, Math.min(s.r + grow, h, w / 2));
  ctx.beginPath();
  ctx.moveTo(x, -2);
  ctx.lineTo(x + w, -2);
  ctx.lineTo(x + w, h - r);
  ctx.arcTo(x + w, h, x + w - r, h, r);
  ctx.lineTo(x + r, h);
  ctx.arcTo(x, h, x, h - r, r);
  ctx.closePath();
}

/** Le contour visible (côtés et bas), du coin haut gauche au coin haut droit. */
function outlinePath(ctx: CanvasRenderingContext2D, s: Shape, grow: number) {
  const x = s.x - grow;
  const w = s.w + grow * 2;
  const h = s.h + grow;
  const r = Math.max(0, Math.min(s.r + grow, h, w / 2));
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h - r);
  ctx.arcTo(x, h, x + r, h, r);
  ctx.lineTo(x + w - r, h);
  ctx.arcTo(x + w, h, x + w, h - r, r);
  ctx.lineTo(x + w, 0);
  return 2 * (h - r) + 2 * (w - 2 * r) / 2 + Math.PI * r;
}

function spec(entry: CatalogEntry, name: string): AnimationSpec {
  return entry.manifest.animations.find((a) => a.name === name) ?? entry.manifest.animations.find((a) => a.name === "idle")!;
}

/**
 * Joue l'éclosion dans `host` (la racine de la fenêtre de l'île). La promesse
 * se résout quand tout est fini et retiré.
 */
export function playHatch(host: HTMLElement, opts: HatchOptions): Promise<void> {
  return new Promise((resolve) => {
    const width = host.clientWidth || 720;
    const height = host.clientHeight || 320;
    const G: Geometry = geometry(width, height);
    const values = opts.rings.map((r) => clamp(r.value));
    const dust: Grain[] = planDust(G, values);

    const layer = el("div", { class: "hatch", "aria-hidden": "true" });
    const back = el("canvas", { class: "hatch-canvas" }) as HTMLCanvasElement;
    const front = el("canvas", { class: "hatch-canvas" }) as HTMLCanvasElement;
    const slot = el("div", { class: "hatch-gum" });
    slot.style.width = slot.style.height = `${GUM_BOX}px`;
    layer.append(back, slot, front);
    host.append(layer);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [back, front]) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const bctx = back.getContext("2d")!;
    const fctx = front.getContext("2d")!;
    const font = getComputedStyle(document.body).fontFamily || "Segoe UI, system-ui, sans-serif";

    // La vraie mascotte, avec ses réglages (couleur, accessoires).
    const found = findMascot(opts.mascotId);
    const entry = found && found.manifest.renderer === "gum" ? found : findMascot("goutte-gomme");
    let renderer: GumRenderer | null = null;
    let anim = "";
    if (entry) {
      renderer = new GumRenderer(entry.manifest);
      renderer.mount(slot);
      renderer.onAnimationEnd(() => {
        anim = "";
      });
    }
    const playAnim = (name: string) => {
      if (!renderer || !entry || name === anim) return;
      anim = name;
      renderer.play(spec(entry, name));
    };

    // Le clic passe au repli ; la souris n'est prise que sur l'île.
    let t = 0;
    let last: number | null = null;
    let raf = 0;
    let rectSent = "";
    const sendRect = (s: Shape) => {
      const key = `${Math.round(s.x)},${Math.round(s.w)},${Math.round(s.h)}`;
      if (key === rectSent) return;
      rectSent = key;
      opts.onRect(s.x, 0, s.w, s.h);
    };
    layer.addEventListener("pointerdown", () => {
      if (t < T.fold) {
        t = T.fold;
        last = null;
      }
    });

    const cues = soundCues();

    function drawIsland(ctx: CanvasRenderingContext2D, I: Shape) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      islandPath(ctx, I);
      ctx.fillStyle = opts.islandColor;
      ctx.fill();
      ctx.restore();
    }

    function drawDrop(ctx: CanvasRenderingContext2D) {
      // La goutte sort du haut de l'écran et pend ; à t = T.open, l'île naît d'elle.
      if (t >= T.open + 0.15) return;
      const d = dropAt(Math.min(t, 0.75));
      ctx.fillStyle = opts.islandColor;
      ctx.beginPath();
      ctx.moveTo(G.cx - d.neck * 1.6, 0);
      ctx.quadraticCurveTo(G.cx - d.neck * 0.5, d.cy * 0.45, G.cx - d.r, d.cy);
      ctx.arc(G.cx, d.cy, d.r, Math.PI, 0, true);
      ctx.quadraticCurveTo(G.cx + d.neck * 0.5, d.cy * 0.45, G.cx + d.neck * 1.6, 0);
      ctx.closePath();
      ctx.fill();
    }

    function drawContent(ctx: CanvasRenderingContext2D, I: Shape) {
      const alpha = clamp((t - T.ondine + 0.15) / 0.3) * (1 - clamp((t - T.fold) / 0.25));
      if (alpha <= 0) return;
      ctx.save();
      islandPath(ctx, I);
      ctx.clip();
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = opts.textColor;
      ctx.font = `600 21px ${font}`;
      const n = Math.floor(opts.texts.hello.length * clamp((t - T.hello) / 0.7));
      ctx.fillText(opts.texts.hello.slice(0, n), G.cx, 128);
      ctx.font = `400 13px ${font}`;
      const busy = clamp((t - 3.1) / 0.4) * (1 - clamp((t - T.joy + 0.2) / 0.3));
      const done = clamp((t - T.joy + 0.1) / 0.3);
      ctx.globalAlpha = alpha * 0.62 * busy;
      ctx.fillText(opts.texts.busy, G.cx, 152);
      ctx.globalAlpha = alpha * 0.75 * done;
      ctx.fillText(opts.texts.done, G.cx, 152);
      // Les anneaux
      const ra = clamp((t - T.blow + 0.6) / 0.35);
      for (let i = 0; i < RING_COUNT; i++) {
        const ring = opts.rings[i];
        if (!ring) continue;
        const c = ringCenter(G, i);
        const f = ringFill(i, values[i], t);
        ctx.globalAlpha = alpha * ra;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, RING_R, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,.13)";
        ctx.stroke();
        if (f > 0.002) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, RING_R, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
          ctx.strokeStyle = ring.color;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.lineCap = "butt";
        }
        const [a, b] = ringWindow(i);
        if (t > a && t < b) {
          // La pointe qui brille pendant qu'il se remplit.
          const tip = ringTip(G, i, f);
          const k = Math.sin((Math.PI * (t - a)) / (b - a));
          ctx.save();
          ctx.shadowColor = ring.color;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 3.2 * (0.6 + k * 0.6), 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.restore();
        }
        if (t > b && t < b + 0.6) {
          // Le battement quand il est plein.
          const u = (t - b) / 0.6;
          ctx.globalAlpha = alpha * (1 - u) * 0.8;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, RING_R + 10 * smooth(u), 0, Math.PI * 2);
          ctx.strokeStyle = ring.color;
          ctx.stroke();
          ctx.globalAlpha = alpha * ra;
        }
        ctx.fillStyle = opts.textColor;
        ctx.font = `600 12px ${font}`;
        ctx.fillText(ring.show(f), c.x, c.y + 0.5);
        ctx.globalAlpha = alpha * ra * 0.6;
        ctx.font = `400 11px ${font}`;
        ctx.fillText(ring.label, c.x, c.y + RING_R + 15);
      }
      ctx.restore();
    }

    function drawDust(ctx: CanvasRenderingContext2D, blown: boolean) {
      if (t < T.burst) return;
      const appear = clamp((t - T.burst) / 0.15);
      ctx.lineCap = "round";
      for (const g of dust) {
        const a = grainAt(G, g, t);
        if (!a || (a.phase === 2) !== blown) continue;
        const b = grainAt(G, g, t - 0.035) ?? a;
        const ring = opts.rings[g.ring];
        const col = a.tint > 0 && ring ? mix(g.color, ring.color, a.tint) : g.color;
        const size = g.size * a.scale;
        ctx.globalAlpha = appear * (0.55 + 0.45 * Math.sin(t * 3 + g.phase * 3) ** 2);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(a.x, a.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
    }

    /** Ondine : sa place, sa taille, son écrasement ; et la bouche qui aspire. */
    function placeOndine(ctx: CanvasRenderingContext2D, I: Shape) {
      if (t < T.ondine - 0.05) {
        slot.style.opacity = "0";
        return;
      }
      playAnim(gumAnimAt(t));
      const home = homeOf(G);
      const a = spr(t - T.ondine, 6, 12);
      const bob = Math.sin(t * 2.4) * 2 * clamp(t - T.ondine - 0.4) * (t > T.mouth && t < T.joy ? 0.3 : 1);
      const q = spr(t - FOLD_START, 8, 10);
      const mini = { x: I.x + 21, y: G.miniH / 2 + 1, s: 11 };
      const x = lerp(home.x, mini.x, q);
      let y = lerp(lerp(G.openH / 2, home.y + bob, clamp(a, 0, 1.2)), mini.y, q);
      const s = lerp(home.s * clamp(a, 0, 1.15) * (1 + inflateAt(t)), mini.s, q);
      // En s'affinant, l'île l'étire un peu vers le haut.
      const stretch = t > T.fold && t < FOLD_START + 0.1 ? Math.sin(clamp((t - T.fold) / 0.4) * Math.PI) * 0.18 : 0;
      const u1 = t - T.ondine;
      const u2 = t - LAND;
      const wob = 0.14 * Math.exp(-5 * Math.max(0, u1)) * Math.sin(14 * u1) + (u2 > 0 ? 0.22 * Math.exp(-6 * u2) * Math.sin(16 * u2) : 0);
      const blowWob = t > T.blow - 0.45 && t < T.joy ? 0.03 * Math.sin(t * 40) : 0;
      const joy = t > T.joy && t < T.fold ? Math.sin(((t - T.joy) / (T.fold - T.joy)) * Math.PI) : 0;
      y -= joy * 8;
      const rot = t > FOLD_START ? Math.PI * 2 * smooth((t - FOLD_START) / 0.45) : 0;
      const sx = 1 + wob + blowWob - stretch * 0.5;
      const sy = 1 - wob - blowWob + stretch;
      const box = 3.4 * s;
      const k = box / GUM_BOX;
      slot.style.opacity = "1";
      slot.style.transform = `translate(${x - GUM_BOX / 2}px, ${y - GUM_BOX / 2 - 0.1 * box}px) rotate(${rot}rad) scale(${k * sx}, ${k * sy})`;

      // La bouche qui aspire, dessinée comme celle du moteur (gum-draw.ts,
      // drawMouth) : lèvres, encre, langue rose, fond de la gorge.
      const gape = gapeAt(t);
      if (gape <= 0.02) return;
      const R = 0.3 * box;
      const pulse = 1 + 0.12 * Math.sin((t - T.mouth) * 17) * smooth((t - T.mouth - 0.25) / 0.3);
      const o = gape * pulse;
      const mx = x;
      const my = y - 0.1 * box + 0.15 * box * sy;
      const w = R * 0.13 * (0.9 + 0.55 * gape) * sx;
      const cy1 = my - 0.2 * R * 0.11 - o * R * 0.06;
      const cy2 = cy1 + o * R * 0.62 * sy;
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(mx - w, my);
      ctx.quadraticCurveTo(mx, cy1, mx + w, my);
      ctx.bezierCurveTo(mx + w * 1.15, my + (cy2 - my) * 0.9, mx - w * 1.15, my + (cy2 - my) * 0.9, mx - w, my);
      ctx.closePath();
      ctx.lineWidth = R * 0.05;
      ctx.stroke();
      ctx.fill();
      if (o > 0.25) {
        ctx.clip();
        ctx.fillStyle = "#ff7a9c";
        ctx.beginPath();
        ctx.ellipse(mx, (cy1 + cy2) / 2 + o * R * 0.17, w * 0.75, R * 0.1 * o, 0, 0, Math.PI * 2);
        ctx.fill();
        const gg = ctx.createRadialGradient(mx, (cy1 + cy2) / 2 - o * R * 0.04, 0, mx, (cy1 + cy2) / 2, w);
        gg.addColorStop(0, "rgba(0,0,0,.55)");
        gg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gg;
        ctx.fillRect(mx - w * 1.3, cy1 - 2, w * 2.6, cy2 - cy1 + 4);
      }
      ctx.restore();
    }

    function drawMini(ctx: CanvasRenderingContext2D, I: Shape) {
      const a = clamp((t - LAND - 0.3) / 0.35);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = opts.textColor;
      ctx.font = `500 13px ${font}`;
      ctx.fillText(opts.texts.mini, I.x + 42, I.h / 2 + 1);
      ctx.beginPath();
      ctx.arc(I.x + I.w - 18, I.h / 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = opts.rings[0]?.color ?? DUST_COLORS[0];
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /** Deux lumières partent des coins du haut, longent l'île et se rejoignent en bas. */
    function drawHalo(ctx: CanvasRenderingContext2D, I: Shape) {
      if (t <= HALO || t >= HALO + HALO_LEN) return;
      const u = (t - HALO) / HALO_LEN;
      ctx.save();
      const len = outlinePath(ctx, I, 1);
      const half = len / 2;
      const seg = len * 0.16;
      const d = half * smooth(clamp(u / 0.66));
      const g = ctx.createLinearGradient(I.x, 0, I.x + I.w, 0);
      DUST_COLORS.forEach((c, k) => g.addColorStop(k / (DUST_COLORS.length - 1), c));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(140,210,255,.9)";
      ctx.shadowBlur = 10;
      ctx.globalAlpha = clamp(u / 0.08) * (1 - smooth((u - 0.72) / 0.28));
      // De gauche : la tête à d ; de droite : la tête à len - d.
      for (const start of [Math.max(0, d - seg), len - d]) {
        ctx.setLineDash([Math.min(seg, d), len * 2]);
        ctx.lineDashOffset = -start;
        ctx.stroke();
      }
      // L'étincelle de la rencontre.
      if (u > 0.64 && u < 0.95) {
        const k = (u - 0.64) / 0.31;
        const sx = I.x + I.w / 2;
        const sy = I.h + 1;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.6;
        for (let j = 0; j < 8; j++) {
          const ang = (j * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(ang) * (3 + 10 * k), sy + Math.sin(ang) * (3 + 10 * k));
          ctx.lineTo(sx + Math.cos(ang) * (6 + 18 * k), sy + Math.sin(ang) * (6 + 18 * k));
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(sx, sy, 3 * (1 - k), 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
      ctx.restore();
    }

    function draw() {
      bctx.clearRect(0, 0, width, height);
      fctx.clearRect(0, 0, width, height);
      const I = islandAt(G, t);
      // Studio : un voile sombre autour de l'île, qui la met en avant.
      if (opts.studio) {
        const depth = smooth((t - 0.6) / 0.6) * (1 - smooth((t - FOLD_START) / 0.5));
        if (depth > 0.01) {
          const v = bctx.createRadialGradient(G.cx, G.openH * 0.45, 40, G.cx, G.openH * 0.45, Math.max(width, height) * 0.6);
          v.addColorStop(0, `rgba(0,0,0,${0.35 * depth})`);
          v.addColorStop(1, "rgba(0,0,0,0)");
          bctx.fillStyle = v;
          bctx.fillRect(0, 0, width, height);
        }
      }
      // La lueur de l'éclat.
      const glow = clamp((t - T.burst + 0.15) / 0.2) * (1 - clamp((t - T.burst - 0.25) / 1.6)) + 0.25 * clamp((t - T.burst) / 0.4) * (1 - clamp((t - T.fold) / 0.6));
      if (glow > 0.01) {
        const gr = bctx.createRadialGradient(G.cx, G.openH / 2, 10, G.cx, G.openH / 2, G.openW * 0.9);
        gr.addColorStop(0, `rgba(140,210,255,${0.45 * glow})`);
        gr.addColorStop(1, "rgba(140,210,255,0)");
        bctx.fillStyle = gr;
        bctx.fillRect(0, 0, width, height);
      }
      drawDrop(bctx);
      if (t >= T.open) {
        drawIsland(bctx, I);
        sendRect(I);
      }
      // L'onde de l'éclat.
      if (t > T.burst - 0.03 && t < T.burst + 0.85) {
        const u = (t - T.burst + 0.03) / 0.88;
        bctx.beginPath();
        bctx.arc(G.cx, G.openH / 2, lerp(30, 330, smooth(u)), 0, Math.PI * 2);
        bctx.strokeStyle = `rgba(190,230,255,${0.55 * (1 - u)})`;
        bctx.lineWidth = 6 - 5 * u;
        bctx.stroke();
      }
      drawContent(bctx, I);
      drawDust(bctx, false);
      placeOndine(fctx, I);
      drawDust(fctx, true);
      drawMini(fctx, I);
      drawHalo(fctx, I);
    }

    function frame(now: number) {
      const before = t;
      if (last !== null) t = Math.min(END, t + Math.min(0.1, (now - last) / 1000));
      last = now;
      for (const [at, cue] of cues) if (at > before && at <= t) sounds.hatch(cue);
      draw();
      if (t >= END) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function finish() {
      layer.style.transition = `opacity ${FADE_MS}ms ease`;
      layer.style.opacity = "0";
      window.setTimeout(() => {
        cancelAnimationFrame(raf);
        renderer?.destroy();
        layer.remove();
        resolve();
      }, FADE_MS);
    }

    raf = requestAnimationFrame(frame);
  });
}
