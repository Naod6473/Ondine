// Réglages → Étagère → Pilules du dépôt (1.2.4) : « modulable au besoin ».
//
// Quand on glisse un fichier sur l'île, elle montre ses pilules en trois
// lignes (Convertir, Ranger, Outils : src/island/drop-panel.ts). Ici, une
// liste simple par ligne : chaque pilule avec Monter / Descendre et un
// interrupteur Afficher / Masquer, plus « Réinitialiser ». Peu de texte.
//
// Le choix est rangé dans les réglages de l'Étagère (« dropPills ») ; la
// logique (liste par défaut, migration des anciens interrupteurs, ordre)
// est dans src/island/drop-pills-logic.ts, testée.

import { settingsStore } from "../core/settings-store";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import {
  defaultLayout,
  effectiveLayout,
  isShown,
  KNOWN,
  LAYOUT_KEY,
  LAYOUT_MODULE,
  moveKey,
  ROW_LABEL,
  ROWS,
  serialize,
  setShown,
  type DropLayout,
} from "../island/drop-pills-logic";
import { lineIcon } from "../island/icon";
import { group, toggle } from "./controls";

/** La disposition enregistrée, ou celle reprise des anciens réglages. */
function current(): DropLayout {
  const mods = settingsStore.current.modules;
  const shelf = mods[LAYOUT_MODULE]?.values ?? {};
  return effectiveLayout(shelf[LAYOUT_KEY], {
    showTrash: shelf.showTrash,
    showCompress: shelf.showCompress,
    showTools: shelf.showTools,
    showHash: shelf.showHash,
    terminalDrop: mods.terminal?.values?.showDrop,
    askDrop: mods.askclaude?.values?.showDrop,
  });
}

export function dropPillsGroup(save: (change: (s: Settings) => void) => void): HTMLElement {
  let layout = current();
  const body = el("div", { class: "dpp" });

  const store = (next: DropLayout, focus?: string) => {
    layout = next;
    save((d) => {
      const entry = (d.modules[LAYOUT_MODULE] ??= { enabled: settingsStore.moduleEnabled(LAYOUT_MODULE), values: {} });
      entry.values[LAYOUT_KEY] = serialize(layout);
    });
    draw(focus);
  };

  const draw = (focus?: string) => {
    body.replaceChildren();
    for (const row of ROWS) {
      const keys = layout.order[row];
      const list = el("ol", { class: "dpp-list", "aria-label": ROW_LABEL[row] });
      keys.forEach((key, i) => {
        const info = KNOWN[key];
        const label = info?.label ?? key;
        const shown = isShown(layout, key);
        const ic = el("span", { class: "dpp-icon", "aria-hidden": "true" });
        if (info?.icon) ic.append(lineIcon(info.icon));
        const up = el("button", { type: "button", class: "icon-btn dpp-move", title: "Monter", "data-move": `${key}:up`, onclick: () => store(moveKey(layout, key, -1), `${key}:up`) }, "↑");
        const down = el("button", { type: "button", class: "icon-btn dpp-move", title: "Descendre", "data-move": `${key}:down`, onclick: () => store(moveKey(layout, key, 1), `${key}:down`) }, "↓");
        (up as HTMLButtonElement).disabled = i === 0;
        (down as HTMLButtonElement).disabled = i === keys.length - 1;
        list.append(
          el(
            "li",
            { class: `dpp-item${shown ? "" : " off"}` },
            ic,
            el("span", { class: `dpp-name${info?.row === "convert" && !info.icon ? " fmt" : ""}` }, label),
            el("span", { class: "dpp-tools" }, up, down, toggle(shown, (v) => store(setShown(layout, key, v)), `Afficher ${label}`)),
          ),
        );
      });
      body.append(el("div", { class: "dpp-row" }, el("h4", { class: "dpp-title" }, ROW_LABEL[row]), list));
    }
    // Le bouton cliqué garde le focus (au clavier, on peut monter plusieurs fois de suite).
    if (focus) {
      const again = body.querySelector<HTMLButtonElement>(`[data-move="${focus}"]`);
      (again && !again.disabled ? again : body.querySelector<HTMLButtonElement>(`[data-move^="${focus.split(":")[0]}:"]:not(:disabled)`))?.focus();
    }
  };
  draw();

  const reset = el("button", { type: "button", class: "btn small", onclick: () => store(defaultLayout()) }, "Réinitialiser");
  return group("Pilules du dépôt", [body, el("div", { class: "dpp-foot" }, reset)], "L'ordre et les pilules montrées quand vous glissez un fichier sur l'île.");
}
