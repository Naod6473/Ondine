// Le petit rond « Étagère » du menu de fichiers (1.2.5) : où il se pose à
// côté de l'île, et comment il revient s'y fondre. Sans DOM (testé dans
// tests/front/drop-menu.test.ts).
//
// Pendant un dépôt, une pilule « Étagère (n) » se détache de l'île et se colle
// à côté (animation de la maquette maquette-menu-cercle.html) : toujours
// visible, c'est la seule cible où lâcher le fichier agit tout de suite.
// Une fois l'action faite (ou annulée), elle revient se fondre dans l'île.
//
// La place : la fenêtre de l'île fait 720 px de large (island/mod.rs,
// PANEL_W) et l'île du dépôt 700 : il n'y a de la place à côté d'elle que si
// elle est plus étroite ou collée à un bout. Sinon, la pilule se pose juste
// sous l'île (île en haut, ou sur un côté), ou juste au-dessus (île en bas),
// à son bout tourné vers le centre de l'écran. Sans aucune place (panneau
// plein), elle se pose dans le coin de l'île.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export type ShelfSide = "beside" | "below" | "above" | "inside";

export interface ShelfPlace {
  x: number;
  y: number;
  side: ShelfSide;
}

/** L'air entre l'île et la pilule, et son retrait depuis le coin arrondi de l'île (px). */
const GAP = 8;
const INSET = 18;

/**
 * La place de la pilule (px CSS de la fenêtre) pour l'île `rect`, dans une
 * fenêtre `win`, l'île étant au bord `edge` et à la place `align`.
 */
export function shelfPlace(rect: Rect, pill: Size, win: Size, edge: string, align: string): ShelfPlace {
  const clampX = (x: number) => Math.round(Math.max(4, Math.min(win.w - pill.w - 4, x)));
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const side = edge === "left" || edge === "right";

  // À côté, comme la maquette, quand la fenêtre a la place (vers le centre de l'écran).
  if (!side) {
    const toLeft = align === "end";
    const room = toLeft ? rect.x : win.w - right;
    if (room >= pill.w + GAP + 4) {
      const y = edge === "bottom" ? bottom - pill.h - 10 : rect.y + 10;
      return { x: toLeft ? rect.x - GAP - pill.w : right + GAP, y: Math.round(y), side: "beside" };
    }
  }

  // Le bout de l'île tourné vers le centre de l'écran.
  const atStart = side ? edge === "right" : align === "end";
  const x = clampX(atStart ? rect.x + INSET : right - pill.w - INSET);
  const below = bottom + GAP;
  const above = rect.y - GAP - pill.h;
  if (edge !== "bottom" && below + pill.h <= win.h) return { x, y: Math.round(below), side: "below" };
  if (edge !== "top" && above >= 0) return { x, y: Math.round(above), side: "above" };
  return { x, y: Math.round(edge === "bottom" ? rect.y + 10 : bottom - pill.h - 10), side: "inside" };
}

/**
 * La fusion dans l'île : le trajet (px) de la pilule jusqu'au point où l'île
 * se resserre (le milieu de son bord collé à l'écran, `edge`), pendant
 * qu'elle rétrécit et s'efface ; l'île fait ensuite un petit saut (jelly.ts).
 * Le même trajet, à l'envers, sert quand elle se détache. Ce point ne bouge
 * pas quand l'île se replie : la pilule va bien là où l'île sera.
 */
export function mergePlan(place: ShelfPlace, rect: Rect, pill: Size, edge = "top"): { dx: number; dy: number; scale: number } {
  const IN = 24;
  let ax = rect.x + rect.w / 2;
  let ay = rect.y + rect.h / 2;
  if (edge === "top") ay = rect.y + IN;
  else if (edge === "bottom") ay = rect.y + rect.h - IN;
  else if (edge === "left") ax = rect.x + IN;
  else if (edge === "right") ax = rect.x + rect.w - IN;
  return { dx: Math.round(ax - (place.x + pill.w / 2)), dy: Math.round(ay - (place.y + pill.h / 2)), scale: 0.3 };
}
