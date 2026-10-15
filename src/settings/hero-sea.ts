// L'eau des bandes des Réglages (1.2.4) : les bulles qui montent et
// s'écartent de la souris, la vague qui ondule en bas, les ronds dans l'eau
// quand une mascotte retombe, et la promenade des mascottes sur la vague.
// Calculs purs, sans DOM ni Canvas (hero.ts dessine), testés dans
// tests/front/settings-hero.test.ts.

/** Un nombre au hasard entre 0 et 1 (Math.random, ou un tirage fixe dans les tests). */
export type Rand = () => number;

// ── Les bulles ───────────────────────────────────────────────────────────────

export interface Bubble {
  x: number;
  y: number;
  /** Rayon (px). */
  r: number;
  /** Vitesse de montée (px/s, positive). */
  rise: number;
  /** Phase et ampleur du petit zigzag. */
  phase: number;
  sway: number;
  /** Décalage dû à la souris (px), qui revient doucement à zéro. */
  ox: number;
  oy: number;
}

/** Combien de bulles pour une bande de w × h : 10 à 34. */
export function bubbleCount(w: number, h: number): number {
  return Math.round(Math.min(34, Math.max(10, (w * h) / 6000)));
}

/**
 * Une bulle neuve. `fromBottom` : elle naît sous la vague (sinon n'importe où,
 * au premier dessin, pour que la bande ne soit pas vide). Plutôt du côté droit,
 * là où vivent les mascottes, sans laisser la gauche vide.
 */
export function spawnBubble(w: number, h: number, rand: Rand, fromBottom = true): Bubble {
  const side = rand();
  const x = w * (side < 0.65 ? 0.4 + 0.6 * rand() : rand());
  const r = 1.5 + rand() * rand() * 6;
  return {
    x,
    y: fromBottom ? h + r + rand() * 12 : h * (0.15 + 0.85 * rand()),
    r,
    rise: 10 + rand() * 18 + r * 1.6,
    phase: rand() * Math.PI * 2,
    sway: 2 + rand() * 6,
    ox: 0,
    oy: 0,
  };
}

/** Jusqu'où la souris écarte les bulles (px) et avec quelle force (px/s au contact). */
export const PUSH_RADIUS = 110;
export const PUSH_FORCE = 220;
/** Le retour de la bulle à sa route (par seconde). */
export const PUSH_RETURN = 1.6;

/**
 * Ce que la souris fait à une bulle pendant `dt` secondes : elle la pousse
 * dans la direction opposée, d'autant plus fort qu'elle est près (0 au bord
 * du rayon). `strength` (0 à 1) : la souris vient d'arriver ou de partir.
 * Renvoie le décalage à ajouter (px).
 */
export function pushFrom(bx: number, by: number, px: number, py: number, strength: number, dt: number): { dx: number; dy: number } {
  const dx = bx - px;
  const dy = by - py;
  const d = Math.hypot(dx, dy);
  if (d >= PUSH_RADIUS || strength <= 0) return { dx: 0, dy: 0 };
  // Pile sur la souris : vers le haut (la bulle « s'échappe »).
  const ux = d < 0.01 ? 0 : dx / d;
  const uy = d < 0.01 ? -1 : dy / d;
  const k = 1 - d / PUSH_RADIUS;
  const push = k * k * PUSH_FORCE * strength * dt;
  return { dx: ux * push, dy: uy * push };
}

/**
 * Avance une bulle de `dt` secondes : elle monte en zigzag, la souris
 * l'écarte, puis elle revient doucement. Renvoie false quand elle est
 * sortie par le haut (à remplacer).
 */
export function stepBubble(b: Bubble, dt: number, t: number, pointer: { x: number; y: number } | null, strength: number): boolean {
  b.y -= b.rise * dt;
  if (pointer) {
    const p = pushFrom(b.x + b.ox, b.y + b.oy, pointer.x, pointer.y, strength, dt);
    b.ox += p.dx;
    b.oy += p.dy;
  }
  const back = Math.min(1, PUSH_RETURN * dt);
  b.ox -= b.ox * back;
  b.oy -= b.oy * back;
  void t;
  return b.y + b.oy > -b.r * 2;
}

/** Où la bulle est dessinée : sa route, son zigzag et le décalage de la souris. */
export function bubblePos(b: Bubble, t: number): { x: number; y: number } {
  return { x: b.x + Math.sin(t * 1.3 + b.phase) * b.sway + b.ox, y: b.y + b.oy };
}

/** L'opacité d'une bulle : elle apparaît sous l'eau et s'efface en haut de la bande. */
export function bubbleAlpha(y: number, h: number): number {
  if (h <= 0) return 0;
  const top = Math.min(1, Math.max(0, y / (h * 0.35)));
  const bottom = Math.min(1, Math.max(0, (h - y) / 24));
  return top * bottom;
}

// ── La vague ─────────────────────────────────────────────────────────────────

/** Un rond dans l'eau : là où une mascotte est retombée, il s'élargit et s'éteint. */
export interface Ripple {
  x: number;
  /** Depuis quand (s). */
  age: number;
  /** Sa force (px). */
  amp: number;
}

/** Durée de vie d'un rond (s). */
export const RIPPLE_LIFE = 2.4;

/**
 * La hauteur de l'eau en x (px depuis le haut de la bande) à l'instant t :
 * deux houles qui se croisent, plus les ronds des mascottes. `base` : le
 * niveau moyen ; `amp` : la hauteur des vagues (0 : eau plate, image fixe).
 */
export function waveY(x: number, t: number, base: number, amp: number, ripples: readonly Ripple[] = []): number {
  let y = base + amp * (Math.sin(x * 0.018 + t * 1.1) * 0.6 + Math.sin(x * 0.041 - t * 1.7 + 1.3) * 0.4);
  for (const r of ripples) {
    if (r.age >= RIPPLE_LIFE) continue;
    const front = 18 + r.age * 70;
    const d = Math.abs(x - r.x);
    if (d > front + 30) continue;
    const fade = 1 - r.age / RIPPLE_LIFE;
    y += r.amp * fade * Math.exp(-(((d - front) / 22) ** 2)) * Math.cos((d - front) * 0.25);
  }
  return y;
}

/** La pente de l'eau en x (pour pencher une mascotte qui flotte). */
export function waveSlope(x: number, t: number, base: number, amp: number, ripples: readonly Ripple[] = []): number {
  return (waveY(x + 2, t, base, amp, ripples) - waveY(x - 2, t, base, amp, ripples)) / 4;
}

/** Fait vieillir les ronds ; renvoie ceux qui vivent encore. */
export function ageRipples(list: Ripple[], dt: number): Ripple[] {
  for (const r of list) r.age += dt;
  return list.filter((r) => r.age < RIPPLE_LIFE);
}

// ── La promenade sur l'eau ───────────────────────────────────────────────────

export interface Swimmer {
  /** Position sur l'eau (px) et cible. */
  x: number;
  target: number;
  /** Le saut : hauteur au-dessus de l'eau (px) et vitesse (px/s, + vers le haut). */
  hop: number;
  hopV: number;
  /** Avant de repartir (s). */
  pause: number;
  /** Le sens de la marche (-1 ou 1). */
  dir: number;
}

/** La vitesse de nage (px/s) et la pesanteur des sauts (px/s²). */
export const SWIM_SPEED = 22;
export const GRAVITY = 900;

/**
 * Avance une mascotte de `dt` secondes entre `lo` et `hi` : elle nage vers
 * sa cible, se repose, en choisit une autre. Le saut retombe ; renvoie true
 * à l'instant où elle touche l'eau (pour faire un rond).
 */
export function stepSwimmer(s: Swimmer, dt: number, lo: number, hi: number, rand: Rand, roams = true): boolean {
  if (hi < lo) hi = lo;
  s.x = Math.min(hi, Math.max(lo, s.x));
  s.target = Math.min(hi, Math.max(lo, s.target));
  if (roams) {
    const gap = s.target - s.x;
    if (Math.abs(gap) < 0.5) {
      s.pause -= dt;
      if (s.pause <= 0) {
        s.target = lo + rand() * (hi - lo);
        s.pause = 1.8 + rand() * 3.8;
      }
    } else {
      const step = Math.sign(gap) * Math.min(Math.abs(gap), SWIM_SPEED * dt);
      s.x += step;
      s.dir = Math.sign(step) || s.dir;
    }
  }
  if (s.hopV !== 0 || s.hop > 0) {
    s.hopV -= GRAVITY * dt;
    s.hop += s.hopV * dt;
    if (s.hop <= 0 && s.hopV < 0) {
      s.hop = 0;
      s.hopV = 0;
      return true;
    }
  }
  return false;
}

/** La zone d'eau des mascottes : la partie droite de la bande, sous le texte quand c'est étroit. */
export function swimZone(w: number, size: number): { lo: number; hi: number } {
  const hi = w - 18 - size / 2;
  const span = Math.min(w * 0.42, 340);
  // Jamais sous le texte (qui prend au plus 60 % de la bande, voir settings-frame.css).
  return { lo: Math.min(hi, Math.max(size / 2 + 8, hi - span, w * 0.6 + size * 0.3)), hi };
}

/** Combien de mascottes tiennent dans une bande de largeur w (une seule sur une fenêtre étroite). */
export function castRoom(w: number, wanted: number): number {
  if (w < 640) return Math.min(wanted, 1);
  if (w < 860) return Math.min(wanted, 2);
  return wanted;
}
