// Jouer avec l'île à la souris, façon Dynamic Island.
//
// Deux bandes de prise sur l'île :
//   - le bord INTÉRIEUR (le bas quand l'île est en haut de l'écran) : on tire,
//     et une BOSSE sort du bord sous la souris, comme de la guimauve : elle
//     suit la souris le long du bord (et penche quand la souris part sur le
//     côté), de moins en moins à mesure qu'on tire (effet élastique), puis
//     revient en rebondissant quand on lâche. Pousser vers l'écran la creuse.
//     Le dessin de la bosse est dans jelly.ts (découpe clip-path) : ici, on
//     ne fait que lire la souris ;
//   - le bord EXTÉRIEUR (celui collé au bord de l'écran) : on attrape l'île
//     pour la déplacer, comme la barre de titre d'une fenêtre (voir onMoveStart).
//
// (Avant, tout le rectangle s'étirait : scale + skew. Une bosse locale se lit
// mieux comme « je tire sur la matière », et le texte n'est plus déformé.)
//
// Secouer : des allers-retours rapides pendant qu'on tire (ShakeDetector)
// préviennent Ondine (onShake), qui peut avoir le tournis.
//
// L'île peut être en haut, à gauche ou à droite de l'écran (`data-edge` sur
// <body>) : les calculs se font sur un « axe » qui va du bord de l'écran vers
// le centre, et un axe perpendiculaire.

import { rubber } from "./spring";
import { reducedMotion } from "./tab-pill";

/** Épaisseur des bandes de prise (px). */
export const GRAB_BAND = 12;
/** Au-delà de ce déplacement (px), ce n'est plus un clic mais un geste. */
const DRAG_THRESHOLD = 4;
/** Étirement maximal de la bosse (px), et creux maximal quand on pousse (px).
    42 px : l'île ouverte (270 px) + sa bosse tiennent dans la fenêtre de 320 px. */
const MAX_STRETCH = 42;
const MAX_SQUEEZE = 14;
/** Secouer : au moins SHAKE_TURNS demi-tours de plus de SHAKE_MIN px en SHAKE_MS. */
const SHAKE_TURNS = 4;
const SHAKE_MIN = 10;
const SHAKE_MS = 900;

export type Edge = "top" | "left" | "right";

/** L'axe « bord de l'écran → centre » et l'axe perpendiculaire, selon le bord. */
function axes(edge: Edge) {
  switch (edge) {
    case "left":
      return { along: { x: 1, y: 0 }, across: { x: 0, y: 1 } };
    case "right":
      return { along: { x: -1, y: 0 }, across: { x: 0, y: 1 } };
    default:
      return { along: { x: 0, y: 1 }, across: { x: 1, y: 0 } };
  }
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
  /** On tire la bosse : `amount` px vers le centre de l'écran (déjà élastique,
      négatif = on pousse), la souris en (x, y) (coordonnées de la fenêtre). */
  onPull?(amount: number, x: number, y: number): void;
  /** On lâche après un étirement de `amount` px (la bosse revient, petit « boïng »). */
  onRelease?(amount: number): void;
  /** L'île est secouée (allers-retours rapides pendant qu'on tire). */
  onShake?(turns: number): void;
}

/**
 * Reconnaît une secousse : la souris fait des allers-retours rapides. On suit
 * une position (px, sur un axe) ; chaque demi-tour de plus de `min` px depuis
 * le dernier extrême compte ; `turns` demi-tours en moins de `ms` = secousse.
 * Sans page ni horloge : on lui donne l'heure (testé par Node).
 */
export class ShakeDetector {
  private extreme = 0;
  private dir = 0;
  private times: number[] = [];

  constructor(
    private readonly turns = SHAKE_TURNS,
    private readonly min = SHAKE_MIN,
    private readonly ms = SHAKE_MS,
  ) {}

  reset(pos = 0) {
    this.extreme = pos;
    this.dir = 0;
    this.times = [];
  }

  /** Une nouvelle position à l'instant `now` (ms) ; vrai si c'est une secousse. */
  feed(pos: number, now: number): boolean {
    const d = pos - this.extreme;
    if (this.dir === 0) {
      if (Math.abs(d) >= this.min) {
        this.dir = Math.sign(d);
        this.extreme = pos;
      }
      return false;
    }
    if (Math.sign(d) === this.dir || d === 0) {
      // On continue dans le même sens : l'extrême avance.
      this.extreme = pos;
      return false;
    }
    if (Math.abs(d) < this.min) return false;
    // Demi-tour franc.
    this.dir = -this.dir;
    this.extreme = pos;
    this.times = [...this.times.filter((t) => now - t <= this.ms), now];
    if (this.times.length >= this.turns) {
      this.times = [];
      return true;
    }
    return false;
  }
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
  // L'étirement actuel, le long de l'axe (px), pour le « boïng » du lâcher.
  let pulled = 0;
  // Deux détecteurs : secouer de côté, ou tirer-relâcher vite dans l'axe.
  const shakeAcross = new ShakeDetector();
  const shakeAlong = new ShakeDetector();

  shell.addEventListener("pointerdown", (e) => {
    wasGesture = false;
    if (e.button !== 0 || !hooks.enabled()) return;
    // Pas sur un bouton, un champ, un curseur : ceux-là gardent leur clic.
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a, [role='slider']")) return;
    mode = grabZone(shell, hooks.edge(), e.clientX, e.clientY);
    if (!mode) return;
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    pulled = 0;
    shakeAcross.reset();
    shakeAlong.reset();
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
    pulled = a >= 0 ? rubber(a, MAX_STRETCH) : rubber(a, MAX_SQUEEZE);
    hooks.onPull?.(pulled, e.clientX, e.clientY);
    const now = performance.now();
    if (shakeAcross.feed(c, now) || shakeAlong.feed(a, now)) hooks.onShake?.(SHAKE_TURNS);
  });

  const release = () => {
    if (!mode) return;
    mode = null;
    shell.classList.remove("stretching");
    if (moved) hooks.onRelease?.(Math.abs(pulled));
  };
  shell.addEventListener("pointerup", release);
  shell.addEventListener("pointercancel", release);

  return () => wasGesture;
}
