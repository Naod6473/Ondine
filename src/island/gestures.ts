// Jouer avec l'île à la souris, façon Dynamic Island.
//
// Deux bandes de prise sur l'île :
//   - le bord INTÉRIEUR (le bas quand l'île est en haut de l'écran) : on tire,
//     l'île s'étire comme de la gelée vers la souris (de moins en moins à
//     mesure qu'on tire : effet élastique), puis revient en rebondissant quand
//     on lâche ;
//   - le bord EXTÉRIEUR (celui collé au bord de l'écran) : on attrape l'île
//     pour la déplacer, comme la barre de titre d'une fenêtre (voir onMoveStart).
//
// L'île peut être en haut, à gauche ou à droite de l'écran (`data-edge` sur
// <body>) : les calculs se font sur un « axe » qui va du bord de l'écran vers
// le centre, et un axe perpendiculaire.

import { reducedMotion } from "./tab-pill";

/** Épaisseur des bandes de prise (px). */
export const GRAB_BAND = 12;
/** Au-delà de ce déplacement (px), ce n'est plus un clic mais un geste. */
const DRAG_THRESHOLD = 4;
/** Étirement maximal le long de l'axe (px), et compression maximale (px). */
const MAX_STRETCH = 42;
const MAX_SQUEEZE = 14;
/** Quand on tire de côté, le bord intérieur suit la souris de ce maximum (px) ;
    le bord collé à l'écran, lui, ne bouge pas (l'île se penche comme de la gelée). */
const MAX_LEAN = 26;
/** Le ressort du retour : raide et un peu mou, pour un rebond « gelée ». */
const STIFFNESS = 420;
const DAMPING_RATIO = 0.32;

export type Edge = "top" | "left" | "right";

/** L'axe « bord de l'écran → centre » et l'axe perpendiculaire, selon le bord. */
function axes(edge: Edge) {
  switch (edge) {
    case "left":
      return { along: { x: 1, y: 0 }, across: { x: 0, y: 1 }, origin: "0 50%" };
    case "right":
      return { along: { x: -1, y: 0 }, across: { x: 0, y: 1 }, origin: "100% 50%" };
    default:
      return { along: { x: 0, y: 1 }, across: { x: 1, y: 0 }, origin: "50% 0" };
  }
}

/** Élastique : suit la souris au début, puis résiste de plus en plus. */
function rubber(d: number, max: number) {
  return max * (1 - Math.exp(-Math.abs(d) / (max * 2.2))) * Math.sign(d);
}

/** Où l'on a attrapé l'île : la bande extérieure, la bande intérieure, ou ailleurs. */
export function grabZone(shell: HTMLElement, edge: Edge, x: number, y: number): "outer" | "inner" | null {
  const r = shell.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  // Distance au bord de l'écran (extérieur) et au bord opposé (intérieur).
  const [toOuter, toInner] =
    edge === "left" ? [x - r.left, r.right - x] : edge === "right" ? [r.right - x, x - r.left] : [y - r.top, r.bottom - y];
  // Île très fine (aperçu) : pas de place pour deux bandes, on étire seulement.
  const thickness = edge === "top" ? r.height : r.width;
  if (thickness < GRAB_BAND * 3) return "inner";
  if (toOuter <= GRAB_BAND) return "outer";
  if (toInner <= GRAB_BAND) return "inner";
  return null;
}

export interface GestureHooks {
  /** Le bord de l'écran où se trouve l'île. */
  edge(): Edge;
  /** Le geste commence-t-il ici ? (états où l'île est visible) */
  enabled(): boolean;
  /** On a attrapé la bande extérieure et commencé à bouger : déplacer l'île. */
  onMoveStart(): void;
  /** Un étirement a eu lieu (pour un petit son, une réaction d'Ondine…). */
  onStretch?(amount: number): void;
  /** On lâche après un étirement de `amount` px (pour un petit « boïng »). */
  onRelease?(amount: number): void;
}

/**
 * Branche les gestes sur la forme de l'île. Renvoie une fonction qui dit si le
 * dernier appui était un geste (pour ne pas le compter comme un clic).
 */
export function enableGestures(shell: HTMLElement, hooks: GestureHooks): () => boolean {
  let mode: "inner" | "outer" | null = null;
  let start = { x: 0, y: 0 };
  let moved = false;
  let wasGesture = false;
  // L'étirement actuel : le long de l'axe (px) et le décalage de côté (px).
  const pos = { s: 0, t: 0 };
  const vel = { s: 0, t: 0 };
  let frame = 0;

  const apply = () => {
    const { along, origin } = axes(hooks.edge());
    shell.style.transformOrigin = origin;
    if (Math.abs(pos.s) < 0.05 && Math.abs(pos.t) < 0.05) {
      shell.style.scale = "";
      shell.style.transform = "";
      return;
    }
    // Étirer le long de l'axe, et un peu affiner l'autre sens (le volume se conserve).
    const r = shell.getBoundingClientRect();
    const len = Math.max(20, along.y ? r.height : r.width);
    const k = 1 + pos.s / len;
    const thin = 1 - (k - 1) * 0.35;
    shell.style.scale = along.y ? `${thin} ${k}` : `${k} ${thin}`;
    // Un cisaillement (skew) autour du bord de l'écran : ce bord reste collé,
    // le bord intérieur glisse de `pos.t` px sur le côté.
    const angle = (Math.atan(pos.t / len) * 180) / Math.PI;
    // (le signe dépend du côté où se trouve le bord intérieur par rapport au bord collé)
    shell.style.transform = along.y ? `skewX(${angle}deg)` : `skewY(${angle * along.x}deg)`;
  };

  /** Le retour en ressort, image par image, jusqu'au repos. */
  const settle = () => {
    cancelAnimationFrame(frame);
    if (reducedMotion()) {
      pos.s = pos.t = vel.s = vel.t = 0;
      apply();
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      for (const key of ["s", "t"] as const) {
        const damping = 2 * Math.sqrt(STIFFNESS) * DAMPING_RATIO;
        vel[key] += (-STIFFNESS * pos[key] - damping * vel[key]) * dt;
        pos[key] += vel[key] * dt;
      }
      apply();
      const resting = Math.abs(pos.s) < 0.05 && Math.abs(vel.s) < 0.5 && Math.abs(pos.t) < 0.05 && Math.abs(vel.t) < 0.5;
      if (resting) {
        pos.s = pos.t = vel.s = vel.t = 0;
        apply();
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };

  shell.addEventListener("pointerdown", (e) => {
    wasGesture = false;
    if (e.button !== 0 || !hooks.enabled()) return;
    // Pas sur un bouton, un champ, un curseur : ceux-là gardent leur clic.
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a, [role='slider']")) return;
    mode = grabZone(shell, hooks.edge(), e.clientX, e.clientY);
    if (!mode) return;
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    cancelAnimationFrame(frame);
    shell.setPointerCapture(e.pointerId);
  });

  shell.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!moved) {
      moved = true;
      wasGesture = true;
      if (mode === "outer") {
        // Le déplacement est fait par le Rust (il bouge la fenêtre sous la souris).
        mode = null;
        hooks.onMoveStart();
        return;
      }
      shell.classList.add("stretching");
    }
    if (reducedMotion()) return;
    const { along, across } = axes(hooks.edge());
    const a = dx * along.x + dy * along.y; // vers le centre de l'écran
    const c = dx * across.x + dy * across.y; // de côté
    pos.s = a >= 0 ? rubber(a, MAX_STRETCH) : rubber(a, MAX_SQUEEZE);
    pos.t = rubber(c, MAX_LEAN);
    vel.s = vel.t = 0;
    apply();
    hooks.onStretch?.(Math.abs(pos.s));
  });

  const release = () => {
    if (!mode) return;
    mode = null;
    shell.classList.remove("stretching");
    if (moved) {
      hooks.onRelease?.(Math.abs(pos.s) + Math.abs(pos.t));
      settle();
    }
  };
  shell.addEventListener("pointerup", release);
  shell.addEventListener("pointercancel", release);

  return () => wasGesture;
}
