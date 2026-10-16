// Petits morceaux d'interface communs aux jeux : le choix du niveau, le
// score, le gain de gouttes.

import { el } from "../../island/dom";
import { TabPill } from "../../island/tab-pill";
import type { Level } from "./connect4-logic";
import type { Tally } from "./aquarium-logic";

export const LEVEL_NAMES: Record<Level, string> = { easy: "Facile", normal: "Normal", hard: "Malin" };

/** Trois boutons Facile / Normal / Malin, avec la pastille qui glisse (TabPill). */
export function levelPicker(current: Level, onPick: (lv: Level) => void): HTMLElement {
  const box = el("div", { class: "segmented games-levels", role: "radiogroup", "aria-label": "Niveau d'Ondine" });
  const buttons = new Map<Level, HTMLElement>();
  const pill = new TabPill(box);
  const show = (lv: Level, animate: boolean) => {
    for (const [l, b] of buttons) {
      b.classList.toggle("active", l === lv);
      b.setAttribute("aria-checked", String(l === lv));
    }
    const b = buttons.get(lv)!;
    if (animate) pill.moveTo(b);
    else requestAnimationFrame(() => pill.jumpTo(b));
  };
  for (const lv of ["easy", "normal", "hard"] as Level[]) {
    const b = el("button", { class: "seg", role: "radio", onclick: () => (show(lv, true), onPick(lv)) }, LEVEL_NAMES[lv]);
    buttons.set(lv, b);
    box.append(b);
  }
  show(current, false);
  return box;
}

/** « Vous 2 · Ondine 3 · Nuls 1 » (depuis le début). */
export function scoreLine(t: Tally): string {
  const parts = [`Vous ${t.win}`, `Ondine ${t.lose}`];
  if (t.draw) parts.push(`Nuls ${t.draw}`);
  return parts.join(" · ");
}

/** « +4 💧 » après une partie qui rapporte (rien sinon). */
export function resultLine(gained: number): Node[] {
  if (!gained) return [];
  return [el("span", { class: "games-gain-pill" }, `+${gained} 💧`)];
}
