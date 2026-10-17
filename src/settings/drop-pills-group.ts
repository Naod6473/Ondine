// Réglages → Étagère → Pilules du dépôt (1.2.4) : « modulable au besoin ».
//
// Quand on glisse un fichier sur l'île, elle montre ses pilules en trois
// lignes (Convertir, Ranger, Outils : src/island/drop-panel.ts). Ici, une
// liste simple par ligne : chaque pilule avec Monter / Descendre et un
// interrupteur Afficher / Masquer, plus « Réinitialiser ». Peu de texte.
//
// 1.2.5 (menu de fichiers) : une étoile par pilule l'épingle en favori (au
// plus 5, comme l'étoile du menu dans l'île) ; la ligne « Favoris », en tête,
// les range (← / →) et les retire. Les favoris épinglés depuis l'île pour un
// dossier favori précis (« shelf-fav-2 ») y apparaissent aussi, sous le nom
// du dossier. « Réinitialiser » remet ZIP, le favori par défaut.
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
  isFav,
  isShown,
  KNOWN,
  MAX_FAVS,
  moveFav,
  LAYOUT_KEY,
  LAYOUT_MODULE,
  moveKey,
  ROW_LABEL,
  ROWS,
  serialize,
  setShown,
  toggleFav,
  type DropLayout,
} from "../island/drop-pills-logic";
import { lineIcon } from "../island/icon";
import { group, toggle } from "./controls";

const STAR = "M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z";

function starIcon(full: boolean): HTMLElement {
  const s = el("span", { class: "dpp-staricon", "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24"><path d="${STAR}" ${full ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"'}/></svg>`;
  return s;
}

/** Le nom d'un favori : la pilule connue, ou le dossier favori de l'Étagère. */
function favLabel(id: string): { label: string; icon: string; own: boolean } {
  const info = KNOWN[id];
  if (info) return { label: info.label, icon: info.icon, own: false };
  const m = /^shelf-fav-(\d+)$/.exec(id);
  const folders = (settingsStore.current.modules[LAYOUT_MODULE]?.values?.favorites as string[] | undefined) ?? [];
  const folder = m ? folders[Number(m[1])] : undefined;
  if (folder) return { label: folder.split(/[\\/]/).filter(Boolean).pop() ?? folder, icon: "📁", own: true };
  return { label: id, icon: "🎯", own: true };
}

/** Les groupes (tous les dossiers favoris, tous les collègues) ne s'épinglent pas d'un bloc. */
const NO_STAR = new Set(["shelf-fav", "team"]);

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
    body.append(favRow());
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
        const tools: HTMLElement[] = [];
        if (!NO_STAR.has(key)) {
          const fav = isFav(layout, key);
          const full = !fav && layout.favs.length >= MAX_FAVS;
          const star = el(
            "button",
            {
              type: "button",
              class: `icon-btn dpp-star${fav ? " on" : ""}`,
              title: fav ? "Retirer des favoris" : full ? "Cinq favoris au plus : retirez-en un d'abord" : "Épingler en favori",
              "aria-pressed": String(fav),
              "data-move": `${key}:star`,
              onclick: () => store(toggleFav(layout, key).layout, `${key}:star`),
            },
            starIcon(fav),
          ) as HTMLButtonElement;
          star.disabled = full;
          tools.push(star);
        } else tools.push(el("span", { class: "dpp-nostar", "aria-hidden": "true" }));
        tools.push(up, down, toggle(shown, (v) => store(setShown(layout, key, v)), `Afficher ${label}`));
        list.append(
          el(
            "li",
            { class: `dpp-item${shown ? "" : " off"}` },
            ic,
            el("span", { class: `dpp-name${info?.row === "convert" && !info.icon ? " fmt" : ""}` }, label),
            el("span", { class: "dpp-tools" }, ...tools),
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
  /** La ligne des favoris : des puces, rangées comme dans le menu de l'île. */
  const favRow = (): HTMLElement => {
    const list = el("ol", { class: "dpp-favs", "aria-label": "Favoris" });
    layout.favs.forEach((id, i) => {
      const f = favLabel(id);
      const ic = f.icon ? el("span", { class: "dpp-icon", "aria-hidden": "true" }) : null;
      if (ic) ic.append(lineIcon(f.icon));
      const left = el("button", { type: "button", class: "icon-btn dpp-move", title: "Avancer", "data-move": `${id}:fl`, onclick: () => store(moveFav(layout, id, -1), `${id}:fl`) }, "←") as HTMLButtonElement;
      const right = el("button", { type: "button", class: "icon-btn dpp-move", title: "Reculer", "data-move": `${id}:fr`, onclick: () => store(moveFav(layout, id, 1), `${id}:fr`) }, "→") as HTMLButtonElement;
      const drop = el("button", { type: "button", class: "icon-btn dpp-move", title: "Retirer des favoris", "data-move": `${id}:fx`, onclick: () => store(toggleFav(layout, id).layout) }, "×");
      left.disabled = i === 0;
      right.disabled = i === layout.favs.length - 1;
      const fmt = KNOWN[id]?.row === "convert" && !KNOWN[id]?.icon;
      list.append(el("li", { class: "dpp-chip" }, ...(ic ? [ic] : []), el("span", { class: `dpp-name${fmt ? " fmt" : ""}`, ...(f.own ? { "data-no-i18n": "" } : {}) }, f.label), left, right, drop));
    });
    if (!layout.favs.length) list.append(el("li", { class: "dpp-none muted" }, "Aucun favori : cliquez sur l'étoile d'une pilule."));
    return el("div", { class: "dpp-row" }, el("h4", { class: "dpp-title" }, el("span", {}, "Favoris"), el("span", { class: "dpp-count", "data-no-i18n": "" }, ` ${layout.favs.length}/${MAX_FAVS}`)), list);
  };
  draw();

  const reset = el("button", { type: "button", class: "btn small", onclick: () => store(defaultLayout()) }, "Réinitialiser");
  return group("Pilules du dépôt", [body, el("div", { class: "dpp-foot" }, reset)], "L'ordre, les pilules montrées et vos favoris (étoile, cinq au plus) quand vous glissez un fichier sur l'île.");
}
