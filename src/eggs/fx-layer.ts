// Les grands effets des surprises, dessinés par-dessus l'île : pluie de code,
// feux d'artifice, cœurs, neige, éclaboussures.
//
// Un canvas posé sur toute l'île (il ne prend jamais la souris), créé au début
// d'un effet et retiré à la fin : rien ne tourne entre deux surprises. La neige
// garde sa dernière image (le petit tas au fond de l'île) jusqu'à `clear()`.

import { drawHeart } from "../mascot/renderers/overlays";

export type FxKind = "code-rain" | "fireworks" | "hearts" | "snow" | "splash" | "flash";

export interface FxOptions {
  durationMs?: number;
  /** Feux d'artifice : les couleurs des gerbes. */
  colors?: string[];
  /** Où est Ondine (px CSS dans l'île) : l'esquive de la pluie de code, les éclaboussures. */
  focus?: { x: number; y: number; size: number };
  /** Neige : hauteur du tas avant et après (0 à 1). */
  pile?: { from: number; to: number };
}

const TAU = Math.PI * 2;
const DEFAULT_MS: Record<FxKind, number> = { "code-rain": 6500, fireworks: 5000, hearts: 4000, snow: 7000, splash: 1600, flash: 900 };

/** Les symboles de la pluie de code : chiffres, accolades, et les lettres d'Ondine. */
const GLYPHS = "0123456789{}[]<>/=+*ONDIE~";
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

/** Une goutte (pointe en haut), centrée en (x, y), de rayon r. */
export function dropPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.9);
  ctx.bezierCurveTo(x + r * 0.4, y - r, x + r, y - r * 0.3, x + r, y + r * 0.2);
  ctx.arc(x, y + r * 0.2, r, 0, Math.PI);
  ctx.bezierCurveTo(x - r, y - r * 0.3, x - r * 0.4, y - r, x, y - r * 1.9);
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** Fusée qui monte encore (feux d'artifice). */
  rocket?: boolean;
  sway?: number;
}

export class FxLayer {
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private done: (() => void) | null = null;

  constructor(private readonly host: HTMLElement) {}

  get playing(): boolean {
    return this.raf !== 0;
  }

  /** Joue un effet ; la promesse se résout à sa fin (ou s'il est coupé). */
  play(kind: FxKind, opts: FxOptions = {}): Promise<void> {
    this.stop();
    const canvas = document.createElement("canvas");
    canvas.className = "egg-fx";
    canvas.setAttribute("aria-hidden", "true");
    this.host.append(canvas);
    this.canvas = canvas;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const fit = () => {
      const r = this.host.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    fit();
    const duration = opts.durationMs ?? DEFAULT_MS[kind];
    const scene = SCENES[kind](canvas.width, canvas.height, dpr, opts);
    const start = performance.now();
    return new Promise<void>((resolve) => {
      this.done = resolve;
      const tick = (now: number) => {
        this.raf = 0;
        if (this.canvas !== canvas) return;
        fit();
        const t = now - start;
        const k = Math.min(1, t / duration);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        scene(ctx, canvas.width, canvas.height, t, k);
        if (k < 1) {
          this.raf = requestAnimationFrame(tick);
          return;
        }
        // La neige reste posée (dernière image) ; le reste s'en va.
        if (kind !== "snow") this.remove();
        this.finish();
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** Coupe l'effet en cours et efface tout (la neige aussi). */
  clear() {
    this.stop();
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.remove();
    this.finish();
  }

  private remove() {
    this.canvas?.remove();
    this.canvas = null;
  }

  private finish() {
    const done = this.done;
    this.done = null;
    done?.();
  }
}

/** Une scène : préparée une fois, puis dessinée à chaque image (t en ms, k de 0 à 1). */
type Scene = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, k: number) => void;
type SceneFactory = (w: number, h: number, dpr: number, opts: FxOptions) => Scene;

const SCENES: Record<FxKind, SceneFactory> = {
  "code-rain": codeRain,
  fireworks,
  hearts,
  snow,
  splash,
  flash,
};

// ── Flash de photographe ──────────────────────────────────────────────────────

function flash(): Scene {
  return (ctx, W, H, _t, k) => {
    // Un éclair blanc très court, puis il s'estompe.
    const a = k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * a})`;
    ctx.fillRect(0, 0, W, H);
  };
}

// ── Pluie de code ──────────────────────────────────────────────────────────────

function codeRain(w: number, _h: number, dpr: number, opts: FxOptions): Scene {
  const font = 13 * dpr;
  const cols = Math.ceil(w / (font * 0.9));
  const drops = Array.from({ length: cols }, (_, i) => ({
    x: i * font * 0.9 + font * 0.45,
    y: -Math.random() * 400 * dpr,
    speed: (0.09 + Math.random() * 0.12) * dpr,
    len: 6 + Math.floor(Math.random() * 14),
    chars: Array.from({ length: 24 }, glyph),
  }));
  const duration = opts.durationMs ?? DEFAULT_MS["code-rain"];
  const freezeAt = duration - 1300;
  let last = 0;
  return (ctx, W, H, t) => {
    const dt = Math.min(50, t - last);
    last = t;
    // Le voile : l'île s'assombrit, puis s'éclaircit à la fin.
    const veil = t < 400 ? t / 400 : t > freezeAt ? Math.max(0, 1 - (t - freezeAt) / 1300) : 1;
    ctx.fillStyle = `rgba(2, 12, 20, ${0.78 * veil})`;
    ctx.fillRect(0, 0, W, H);

    ctx.font = `600 ${font}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const frozen = t > freezeAt;
    // À la fin, la pluie se fige puis s'évapore en remontant.
    const rise = frozen ? ease((t - freezeAt) / 1300) * H * 0.35 : 0;
    for (const d of drops) {
      if (!frozen) {
        d.y += d.speed * dt;
        if (d.y - d.len * font > H) {
          d.y = -Math.random() * 120 * dpr;
          d.len = 6 + Math.floor(Math.random() * 14);
        }
        if (Math.random() < 0.06) d.chars[Math.floor(Math.random() * d.chars.length)] = glyph();
      }
      for (let i = 0; i < d.len; i++) {
        const y = d.y - i * font - rise;
        if (y < -font || y > H + font) continue;
        const fade = (1 - i / d.len) * veil;
        ctx.fillStyle = i === 0 ? `rgba(230, 251, 255, ${fade})` : `rgba(90, 216, 255, ${fade * 0.85})`;
        ctx.fillText(d.chars[i % d.chars.length], d.x, y);
      }
    }

    // L'esquive : une goutte passe au ralenti devant Ondine, avec sa traînée.
    const f = opts.focus;
    if (f) {
      const a = 2200;
      const b = 4300;
      if (t > a && t < b) {
        const p = (t - a) / (b - a);
        const s = f.size * dpr;
        const x0 = W + s;
        const x1 = -s;
        const y = f.y * dpr - s * 0.15;
        for (let i = 5; i >= 0; i--) {
          const pp = Math.max(0, p - i * 0.035);
          const x = x0 + (x1 - x0) * pp;
          ctx.globalAlpha = i === 0 ? 1 : 0.5 - i * 0.08;
          ctx.shadowColor = "rgba(160, 235, 255, 0.9)";
          ctx.shadowBlur = i === 0 ? s * 0.12 : 0;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-Math.PI / 2); // couchée : la pointe en arrière
          dropPath(ctx, 0, 0, s * 0.12);
          ctx.fillStyle = "#9fe9ff";
          ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
    }
  };
}

// ── Feux d'artifice ───────────────────────────────────────────────────────────

function fireworks(_w: number, _h: number, dpr: number, opts: FxOptions): Scene {
  const colors = opts.colors?.length ? opts.colors : ["#ffcf4a", "#ff6f9c", "#7be0a8", "#8ab8ff", "#ffffff"];
  const duration = opts.durationMs ?? DEFAULT_MS.fireworks;
  const parts: Particle[] = [];
  let nextLaunch = 0;
  let last = 0;
  let n = 0;
  return (ctx, W, H, t) => {
    const dt = Math.min(50, t - last) / 1000;
    last = t;
    if (t >= nextLaunch && t < duration - 1500) {
      parts.push({
        x: W * (0.15 + Math.random() * 0.7),
        y: H + 4 * dpr,
        vx: (Math.random() - 0.5) * 30 * dpr,
        vy: -(H * (1.1 + Math.random() * 0.5)),
        life: 0,
        max: 0.55 + Math.random() * 0.2,
        color: colors[n++ % colors.length],
        size: 2 * dpr,
        rocket: true,
      });
      nextLaunch = t + 380 + Math.random() * 380;
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rocket) {
        p.vy += H * 1.6 * dt;
        if (p.life >= p.max) {
          parts.splice(i, 1);
          const count = 26;
          const speed = Math.min(W, H) * (0.55 + Math.random() * 0.3);
          for (let j = 0; j < count; j++) {
            const a = (j / count) * TAU + Math.random() * 0.2;
            parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0, max: 1 + Math.random() * 0.4, color: p.color, size: 1.8 * dpr });
          }
          continue;
        }
      } else {
        p.vx *= 1 - 2.2 * dt;
        p.vy = p.vy * (1 - 2.2 * dt) + H * 0.35 * dt;
        if (p.life >= p.max) {
          parts.splice(i, 1);
          continue;
        }
      }
      const fade = p.rocket ? 1 : 1 - p.life / p.max;
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.rocket ? 1 : 0.6 + fade * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
}

// ── Cœurs ──────────────────────────────────────────────────────────────────────

function hearts(w: number, h: number, dpr: number): Scene {
  const list = Array.from({ length: 12 }, (_, i) => ({
    x: w * (0.08 + Math.random() * 0.84),
    delay: i * 220 + Math.random() * 200,
    size: (10 + Math.random() * 10) * dpr,
    speed: h * (0.00045 + Math.random() * 0.0003),
    sway: Math.random() * TAU,
    color: ["#ff6f9c", "#ff8fb3", "#ff4f7f"][i % 3],
  }));
  return (ctx, _W, H, t) => {
    for (const p of list) {
      const life = t - p.delay;
      if (life < 0) continue;
      const y = H + p.size - life * p.speed;
      if (y < -p.size) continue;
      ctx.globalAlpha = Math.min(1, life / 300) * Math.min(1, (y + p.size) / (H * 0.4));
      drawHeart(ctx, p.x + Math.sin(life / 400 + p.sway) * 8 * dpr, y, p.size, p.color);
    }
    ctx.globalAlpha = 1;
  };
}

// ── Neige (et le petit tas au fond de l'île) ──────────────────────────────────

function snow(w: number, h: number, dpr: number, opts: FxOptions): Scene {
  const flakes = Array.from({ length: 70 }, () => ({
    x: Math.random() * w,
    y: -Math.random() * h,
    r: (1 + Math.random() * 2) * dpr,
    speed: h * (0.00012 + Math.random() * 0.0002),
    sway: Math.random() * TAU,
  }));
  const pile = opts.pile ?? { from: 0, to: 0.3 };
  const duration = opts.durationMs ?? DEFAULT_MS.snow;
  let last = 0;
  return (ctx, W, H, t, k) => {
    const dt = Math.min(50, t - last);
    last = t;
    // Les flocons s'arrêtent de tomber un peu avant la fin.
    const falling = t < duration - 1500;
    ctx.fillStyle = "#ffffff";
    for (const f of flakes) {
      f.y += f.speed * dt;
      if (f.y > H) {
        if (!falling) continue;
        f.y = -f.r;
        f.x = Math.random() * W;
      }
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(f.x + Math.sin(t / 700 + f.sway) * 6 * dpr, f.y, f.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Le tas : une bosse douce au fond, qui monte pendant la chute.
    const level = pile.from + (pile.to - pile.from) * ease(k * 1.2);
    if (level <= 0) return;
    const top = H - level * H * 0.07 - 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 12 * dpr) {
      ctx.lineTo(x, top + Math.sin(x / (38 * dpr)) * 2.2 * dpr + Math.sin(x / (17 * dpr)) * 1.1 * dpr);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    g.addColorStop(1, "rgba(214, 232, 255, 0.85)");
    ctx.fillStyle = g;
    ctx.fill();
  };
}

// ── Éclaboussures (jour de pluie) ─────────────────────────────────────────────

function splash(w: number, h: number, dpr: number, opts: FxOptions): Scene {
  const f = opts.focus ?? { x: w / dpr / 2, y: h / dpr / 2, size: 40 };
  const cx = f.x * dpr;
  const cy = f.y * dpr;
  const s = f.size * dpr;
  const drops = Array.from({ length: 12 }, (_, i) => {
    const a = -Math.PI / 2 + ((i / 11) - 0.5) * Math.PI * 1.3;
    const v = s * (2.4 + Math.random() * 1.6);
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: s * (0.05 + Math.random() * 0.04) };
  });
  return (ctx, _W, _H, t, k) => {
    const sec = t / 1000;
    ctx.fillStyle = "#9fd7ff";
    for (const d of drops) {
      const x = cx + d.vx * sec;
      const y = cy - s * 0.2 + d.vy * sec + s * 6 * sec * sec;
      ctx.globalAlpha = 1 - k;
      dropPath(ctx, x, y, d.r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
}
