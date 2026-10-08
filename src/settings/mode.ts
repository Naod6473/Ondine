// Le mode Simple / Complet, côté DOM : l'interrupteur de la barre latérale, et
// l'application du mode à une page déjà dessinée (on cache les lignes non
// essentielles sans rien déplacer, un bloc vidé disparaît, et une ligne en bas
// propose de passer en Complet). La logique pure est dans visibility.ts.

import { el } from "../island/dom";
import { segmented } from "./controls";
import { isHidden, moreText, WHOLE_PAGE, type SettingsMode } from "./visibility";

/** L'interrupteur « Simple / Complet » (sous la recherche). */
export function modeSwitch(mode: SettingsMode, onChange: (mode: SettingsMode) => void): HTMLElement {
  const box = el("div", { class: "mode-switch", title: "Simple : l'essentiel de chaque page. Complet : tous les réglages." });
  const seg = segmented(mode, [["simple", "Simple"], ["full", "Complet"]], (v) => onChange(v === "full" ? "full" : "simple"));
  seg.setAttribute("aria-label", "Mode des réglages");
  box.append(seg);
  return box;
}

/**
 * Applique le mode à la page : cache les lignes (`.row[data-key]`) et les blocs
 * à clé (`section.group[data-key]`) non essentiels, puis les blocs dont toutes
 * les lignes sont cachées. Un conteneur marqué `data-essential` garde tout ce
 * qu'il contient ; un élément `data-follows="<clé>"` suit la ligne de cette clé.
 * Renvoie le nombre de lignes cachées (et ajoute la ligne « N réglages de
 * plus… » si besoin, `showAll` passant en Complet).
 */
export function applyMode(page: HTMLElement, essentials: string[] | typeof WHOLE_PAGE, mode: SettingsMode, showAll: () => void): number {
  if (mode === "full" || essentials === WHOLE_PAGE) return 0;
  const hidden = new Set<string>();
  let count = 0;
  for (const item of page.querySelectorAll<HTMLElement>(".row[data-key], section.group[data-key]")) {
    const key = item.dataset.key ?? "";
    if (item.classList.contains("result") || item.closest("[data-essential]")) continue;
    if (!isHidden(mode, key, essentials)) continue;
    item.hidden = true;
    item.classList.add("advanced");
    hidden.add(key);
    // Ce qui est déjà replié par la page (les surprises) n'entre pas dans le compte.
    if (!item.closest("[data-follows]")) count++;
  }
  for (const follower of page.querySelectorAll<HTMLElement>("[data-follows]")) {
    if (hidden.has(follower.dataset.follows ?? "")) follower.hidden = true;
  }
  for (const group of page.querySelectorAll<HTMLElement>(".group")) {
    if (group.hidden) continue;
    const rows = [...group.querySelectorAll<HTMLElement>(":scope > .group-body > .row[data-key]")].filter((r) => r.dataset.key);
    if (!rows.length) continue;
    const shown = rows.filter((r) => !r.hidden);
    if (!shown.length) group.hidden = true;
    // La dernière ligne visible perd son trait du bas (comme la vraie dernière).
    else shown[shown.length - 1].classList.add("last-shown");
  }
  if (count) {
    page.append(
      el(
        "p",
        { class: "mode-more" },
        el("span", {}, moreText(count)),
        el("span", { class: "mode-dot", "aria-hidden": "true" }, "·"),
        el("button", { class: "link-btn", onclick: showAll }, "Tout afficher"),
      ),
    );
  }
  return count;
}

/** La ligne est-elle cachée par le mode Simple (elle-même, ou son bloc) ? */
export function hiddenByMode(target: HTMLElement): boolean {
  return target.classList.contains("advanced") || !!target.closest(".group[hidden], [data-follows][hidden]");
}
