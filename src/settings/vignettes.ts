// Les choix visuels des Réglages en vignettes (1.2.5) : au lieu de mots, une
// petite image de ce qu'on choisit (le bord de l'écran, le style de l'île, les
// icônes, le thème). Les dessins sont au trait, en SVG, dans la couleur du
// texte ; l'île y prend la couleur de la page. Aucune image de marque.
//
// Comme un segmenté (controls.ts) : un groupe de boutons radio, flèches pour
// changer, et `onChange` avec la nouvelle valeur. La mascotte a son podium
// (podium.ts) : elle n'est pas ici.

import { el } from "../island/dom";

export interface Vignette {
  value: string;
  label: string;
  /** Le dessin : l'intérieur d'un <svg viewBox="0 0 64 40">. */
  art: string;
  /** Des couleurs propres à la vignette (thème : --vg-bg, --vg-accent). */
  vars?: Record<string, string>;
}

/** L'écran autour du dessin. */
const SCREEN = '<rect class="vg-screen" x="2" y="2" width="60" height="36" rx="5"/>';

/** Une île (pilule pleine, couleur de la page) à cette place. */
function island(x: number, y: number, w: number, h: number): string {
  return `<rect class="vg-island" x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}"/>`;
}

/** Bord de l'écran : l'île en haut, en bas, à gauche ou à droite. */
export function edgeArt(edge: string): string {
  const place: Record<string, string> = {
    top: island(22, 5, 20, 6),
    bottom: island(22, 29, 20, 6),
    left: island(5, 12, 6, 16),
    right: island(53, 12, 6, 16),
  };
  return SCREEN + (place[edge] ?? place.top);
}

/** Taille de la mini-île : normale ou nano (une toute petite encoche). */
export function sizeArt(size: string): string {
  return SCREEN + (size === "nano" ? island(28, 5, 8, 6) : island(20, 5, 24, 7));
}

/** Style de l'île : la pilule classique, ou la bouche d'Ondine (la goutte suspendue, tête en bas). */
export function styleArt(style: string): string {
  if (style !== "mouth") return SCREEN + island(20, 5, 24, 7);
  // La goutte pend du bord, la pointe en haut ; l'île est sa bouche.
  return `${SCREEN}<path class="vg-line" d="M32 3c-6 6-9 10-9 15a9 9 0 0 0 18 0c0-5-3-9-9-15z"/>${island(26, 18, 12, 5)}<path class="vg-line" d="M28 13h.01M36 13h.01"/>`;
}

/** Style des icônes : en couleur (pleines), ou épurées (au trait). */
export function iconPackArt(pack: string): string {
  const line = pack === "line";
  const cls = (n: number) => (line ? "vg-line" : `vg-fill vg-c${n}`);
  return `<circle class="${cls(1)}" cx="14" cy="20" r="7"/><rect class="${cls(2)}" x="25" y="13" width="14" height="14" rx="3.5"/><path class="${cls(3)}" d="M50 12l8 15H42z"/>`;
}

/** Un thème de l'île : la pilule à ses couleurs (fond et accent) sur l'écran. */
export function themeArt(): string {
  return `${SCREEN}<rect class="vg-theme" x="12" y="6" width="40" height="13" rx="6.5"/><circle class="vg-theme-dot" cx="20" cy="12.5" r="3"/><path class="vg-theme-line" d="M27 12.5h16"/>`;
}

/**
 * Le groupe de vignettes. `label` : le nom du groupe pour un lecteur d'écran
 * (le libellé de la ligne).
 */
export function vignettes(value: string, options: Vignette[], onChange: (v: string) => void, label: string): HTMLElement {
  const box = el("div", { class: "vignettes", role: "radiogroup", "aria-label": label });
  const buttons = options.map((o) => {
    const b = el("button", { type: "button", class: "vignette", role: "radio", "data-v": o.value, title: o.label }, el("span", { class: "vignette-name" }, o.label));
    b.insertAdjacentHTML("afterbegin", `<svg class="vignette-art" viewBox="0 0 64 40" aria-hidden="true">${o.art}</svg>`);
    for (const [k, v] of Object.entries(o.vars ?? {})) b.style.setProperty(k, v);
    b.addEventListener("click", () => {
      if (o.value === value) return;
      value = o.value;
      paint();
      onChange(o.value);
    });
    box.append(b);
    return b;
  });
  const paint = () => {
    for (const b of buttons) {
      const on = b.dataset.v === value;
      b.setAttribute("aria-checked", String(on));
      b.classList.toggle("on", on);
      b.tabIndex = on ? 0 : -1;
    }
    if (!buttons.some((b) => b.tabIndex === 0) && buttons[0]) buttons[0].tabIndex = 0;
  };
  box.addEventListener("keydown", (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key) || !buttons.length) return;
    e.preventDefault();
    const index = Math.max(0, buttons.findIndex((b) => b.dataset.v === value));
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].click();
    buttons[next].focus();
  });
  paint();
  return box;
}
