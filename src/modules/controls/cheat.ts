// Contrôles → « Aide-mémoire des raccourcis » (1.2.5) : la page.
//
// Trois onglets : les raccourcis de l'appli où vous travailliez (Explorateur,
// Excel, Word, navigateur…, ou ceux de toutes les applis si on ne la connaît
// pas), ceux de Windows, ceux d'Ondine. Un champ filtre la liste.
//
// Ouverte en maintenant Ctrl gauche (Rust : platform/cheat_key.rs), elle se
// referme au relâchement, sauf si on a cliqué « Garder ouvert ». Ouverte
// depuis le bloc Outils, elle reste jusqu'à « Retour ».
// Les listes : cheat-data.ts.

import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import type { Page } from "./blocks";
import { currentLang } from "../../core/i18n";
import { filterGroups, keyName, ONDINE_SHEET, sheetFor, splitKeys, WINDOWS_SHEET, type AppSheet } from "./cheat-data";
import { pageHead } from "./extras";

export function cheatPage(api: ModuleApi, back: () => void, program: string | null, opts: { held: boolean; onKeep: () => void }): Page & { kept: () => boolean } {
  const app = sheetFor(program);
  const sheets: AppSheet[] = [app, WINDOWS_SHEET, ONDINE_SHEET];
  let current = 0;
  let kept = !opts.held;

  const keep = el("button", { class: "btn small", type: "button", title: "Ne pas refermer en relâchant Ctrl" }, "Garder ouvert") as HTMLButtonElement;
  keep.hidden = !opts.held;
  keep.addEventListener(
    "click",
    api.handler(() => {
      kept = true;
      keep.hidden = true;
      opts.onKeep();
    }),
  );
  const tabs = el("div", { class: "ctl-cheat-tabs", role: "tablist", "aria-label": "Raccourcis" });
  const filter = el("input", { class: "ctl-cheat-filter", type: "search", placeholder: "Filtrer", "aria-label": "Filtrer les raccourcis" }) as HTMLInputElement;
  const grid = el("div", { class: "ctl-cheat-grid" });
  const sub = el("p", { class: "muted ctl-page-note" });
  const node = el(
    "div",
    { class: "ctl-page ctl-block-page ctl-cheat", "data-island-fit": true },
    pageHead("Aide-mémoire", back, keep),
    sub,
    el("div", { class: "ctl-cheat-bar" }, tabs, filter),
    grid,
  );

  // Les touches ne passent pas par la traduction de la page (« Entrée » n'y est pas une touche).
  const keysOf = (keys: string) => {
    const french = currentLang().startsWith("fr");
    const names = splitKeys(keys).map((k) => keyName(k, french));
    return el("span", { class: "ctl-keys", "data-no-i18n": true, "aria-label": names.join("+") }, ...names.map((k) => el("kbd", {}, k)));
  };

  const draw = () => {
    const sheet = sheets[current];
    tabs.replaceChildren(
      ...sheets.map((s, i) =>
        el(
          "button",
          {
            class: `ctl-chip${i === current ? " on" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": String(i === current),
            onclick: () => {
              current = i;
              draw();
            },
          },
          i === 0 ? (app.programs.length ? app.name : "Cette appli") : s.name,
        ),
      ),
    );
    sub.textContent =
      current === 0
        ? app.programs.length
          ? `Les raccourcis de ${app.name}.`
          : "Ondine n'a pas de liste pour cette appli : voici les raccourcis qui marchent presque partout."
        : current === 1
          ? "Les raccourcis de Windows, partout."
          : "Les raccourcis d'Ondine (ceux d'origine : ils se changent dans les Réglages).";
    const groups = filterGroups(sheet.groups, filter.value);
    grid.replaceChildren(
      ...groups.map((g) =>
        el(
          "div",
          { class: "ctl-cheat-group" },
          el("p", { class: "ctl-section" }, g.title),
          ...g.items.map((it) =>
            el(
              "div",
              { class: "ctl-cheat-row" },
              keysOf(it.keys),
              el("span", { class: "ctl-cheat-what" }, it.what),
            ),
          ),
        ),
      ),
    );
    if (!groups.length) grid.append(el("p", { class: "muted ctl-page-empty" }, "Aucun raccourci ne correspond."));
  };
  filter.addEventListener("input", draw);
  draw();
  return { node, stop() {}, kept: () => kept };
}
