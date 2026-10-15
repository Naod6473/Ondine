// La fenêtre des Réglages (1.2.4), côté DOM : le fond choisi (Apparence →
// « Fond des Réglages », une préférence de cette fenêtre, gardée dans
// localStorage comme l'ordre du podium) et la pastille d'état en bas de la
// barre latérale. La logique pure est dans frame-logic.ts.

import { el } from "../island/dom";
import { backdropOf, type Backdrop, type StatusLine } from "./frame-logic";

const BACKDROP_KEY = "settings.backdrop";

/** Le fond retenu (noir profond si rien n'est retenu ou si le stockage manque). */
export function backdrop(): Backdrop {
  try {
    return backdropOf(localStorage.getItem(BACKDROP_KEY));
  } catch {
    return "deep";
  }
}

/** Pose le fond sur la page (html[data-backdrop], voir settings-frame.css). */
export function applyBackdrop(value: Backdrop = backdrop()) {
  document.documentElement.dataset.backdrop = value;
}

/** Les deux vignettes « Noir profond » / « Dégradés » ; le changement se voit tout de suite. */
export function backdropChoice(): HTMLElement {
  const box = el("div", { class: "backdrop-choice", role: "radiogroup", "aria-label": "Fond des Réglages" });
  const draw = () => {
    const now = backdrop();
    box.replaceChildren(
      ...(
        [
          ["deep", "Noir profond"],
          ["blobs", "Dégradés"],
        ] as [Backdrop, string][]
      ).map(([v, label]) => {
        const b = el(
          "button",
          { class: `backdrop-swatch ${now === v ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(now === v), "data-v": v },
          el("i", { "aria-hidden": "true" }),
          el("span", {}, label),
        );
        b.addEventListener("click", () => {
          try {
            localStorage.setItem(BACKDROP_KEY, v);
          } catch {
            // pas de stockage : le fond change quand même jusqu'à la fermeture
          }
          applyBackdrop(v);
          draw();
        });
        return b;
      }),
    );
  };
  draw();
  return box;
}

/** La pastille d'état (en bas de la barre latérale). */
export function navStatus(line: StatusLine): HTMLElement {
  const text = el("span", { class: "nav-status-text" });
  line.parts.forEach((part, i) => {
    if (i > 0) text.append(line.sep ?? " · ");
    text.append(el("span", {}, part));
  });
  const pill = el("div", { class: "nav-status", role: "status" }, el("span", { class: "nav-status-dot", "aria-hidden": "true" }), text);
  pill.style.setProperty("--status-color", line.color);
  return pill;
}
