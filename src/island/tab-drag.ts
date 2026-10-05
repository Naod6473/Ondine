// Réorganiser les onglets de l'île en les faisant glisser.
//
// On appuie sur un onglet et on le déplace de quelques pixels : il « se
// détache » (léger grossissement), suit la souris, et les autres onglets
// s'écartent en douceur pour lui faire de la place. On relâche : il se pose
// à sa nouvelle place et l'ordre est enregistré dans les réglages.
//
// Technique « FLIP » pour l'animation des voisins : on note leur position
// (First), on change l'ordre dans le HTML (Last), on les décale d'autant
// (Invert), puis on anime ce décalage vers zéro (Play).

import { reducedMotion } from "./tab-pill";

/** Au-delà de ce déplacement (px), un appui devient un glisser. */
const DRAG_THRESHOLD = 6;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export interface TabDragOptions {
  /** Appelée à chaque image du glisser (pour la pastille). */
  onMove(): void;
  /** Le glisser est fini ; `order` = les ids des onglets, dans le nouvel ordre. */
  onDrop(order: string[]): void;
}

/** Les onglets du bandeau, dans l'ordre affiché. */
function tabsOf(header: HTMLElement): HTMLElement[] {
  return [...header.querySelectorAll<HTMLElement>(":scope > .tab")];
}

/** Anime les onglets `others` depuis leur ancienne position (FLIP). */
export function flip(others: HTMLElement[], before: Map<HTMLElement, number>) {
  if (reducedMotion()) return;
  for (const t of others) {
    const dx = (before.get(t) ?? t.offsetLeft) - t.offsetLeft;
    if (Math.abs(dx) < 0.5) continue;
    t.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 320, easing: EASE });
  }
}

export function enableTabDrag(header: HTMLElement, options: TabDragOptions) {
  let pressed: { tab: HTMLElement; pointerId: number; startX: number; startLeft: number } | null = null;
  let dragging = false;
  /** Après un glisser, le « clic » qui suit le relâchement ne doit pas changer d'onglet. */
  let swallowClick = false;

  header.addEventListener("pointerdown", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!tab || e.button !== 0 || tab.parentElement !== header) return;
    pressed = { tab, pointerId: e.pointerId, startX: e.clientX, startLeft: tab.offsetLeft };
    dragging = false;
  });

  header.addEventListener("pointermove", (e) => {
    if (!pressed || e.pointerId !== pressed.pointerId) return;
    const { tab, startX, startLeft } = pressed;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      dragging = true;
      tab.setPointerCapture(e.pointerId);
      header.classList.add("dragging");
      tab.classList.add("dragged");
    }

    // Où devrait être l'onglet : son centre, tel qu'on le voit sous la souris.
    const visualLeft = startLeft + dx;
    const center = visualLeft + tab.offsetWidth / 2;
    const others = tabsOf(header).filter((t) => t !== tab);
    // Sa place = le nombre de voisins dont le centre est à sa gauche.
    const index = others.filter((t) => t.offsetLeft + t.offsetWidth / 2 < center).length;
    const current = tabsOf(header).indexOf(tab);
    if (index !== current) {
      const before = new Map(others.map((t) => [t, t.offsetLeft]));
      const ref = others[index] ?? others[others.length - 1]?.nextSibling ?? null;
      header.insertBefore(tab, ref);
      flip(others, before);
    }

    // L'onglet suit la souris (offsetLeft = sa place actuelle dans la rangée).
    const shift = visualLeft - tab.offsetLeft;
    tab.dataset.dragX = String(shift);
    tab.style.transform = `translateX(${shift}px) scale(1.06)`;
    options.onMove();
  });

  const finish = (e: PointerEvent) => {
    if (!pressed || e.pointerId !== pressed.pointerId) return;
    const { tab } = pressed;
    pressed = null;
    if (!dragging) return;
    dragging = false;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);

    // L'onglet se pose à sa place, en douceur.
    const shift = Number(tab.dataset.dragX ?? 0);
    delete tab.dataset.dragX;
    tab.style.transform = "";
    tab.classList.remove("dragged");
    header.classList.remove("dragging");
    if (!reducedMotion()) {
      tab.animate([{ transform: `translateX(${shift}px) scale(1.06)` }, { transform: "none" }], { duration: 360, easing: EASE });
    }
    options.onMove();
    options.onDrop(tabsOf(header).map((t) => t.dataset.id ?? "").filter(Boolean));
  };
  header.addEventListener("pointerup", finish);
  header.addEventListener("pointercancel", finish);

  // En phase de capture : avant le onclick de l'onglet.
  header.addEventListener(
    "click",
    (e) => {
      if (swallowClick) {
        e.stopPropagation();
        e.preventDefault();
        swallowClick = false;
      }
    },
    true,
  );
}
