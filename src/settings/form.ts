// Génère les réglages d'un module à partir de son schéma (manifest.json).
// Aucun module n'écrit son propre écran de réglages : il décrit ses champs, l'île
// dessine les lignes, vérifie les valeurs et les enregistre.
//
// Chaque champ devient une ligne (voir controls.ts) : interrupteur pour un
// oui/non, − + pour un nombre, segmenté ou liste pour un choix, champ texte,
// ou liste de dossiers / fichiers / calendriers sur toute la largeur.

import type { CalendarEntry, FieldCheck, SettingField } from "../core/module-types";
import { coerce } from "../core/settings-store";
import { calendarsInput } from "./calendars-input";
import { fieldWarnings } from "./field-checks";
import { Bridge, IS_TAURI } from "../core/bridge";
import { el } from "../island/dom";
import { choice, row, stepper, toggle, wideRow } from "./controls";

/** Les lignes d'un module (à mettre dans un `group`). */
export function settingsRows(fields: SettingField[], values: Record<string, unknown>, onChange: (key: string, value: unknown) => void): HTMLElement[] {
  return fields.map((field) => {
    const current = values[field.key];
    switch (field.type) {
      case "boolean":
        return row(field.label, toggle(Boolean(current), (v) => onChange(field.key, v), field.label), field.help);
      case "number": {
        const min = field.min ?? 0;
        const max = field.max ?? 1_000_000;
        return row(
          field.label,
          stepper(Number(current), min, max, (v) => onChange(field.key, coerce(field, v)), field.step ?? 1),
          field.help,
        );
      }
      case "select":
        return row(
          field.label,
          choice(String(current), field.options.map((o) => [o.value, o.label]), (v) => onChange(field.key, v)),
          field.help,
        );
      case "string": {
        // Plusieurs lignes (une grille, une liste) : une zone de texte, en pleine largeur.
        const txt = (
          field.multiline
            ? el("textarea", { class: "text text-multi", maxlength: field.maxLength ?? 500, rows: 6, spellcheck: false, "aria-label": field.label })
            : el("input", { type: "text", class: "text", maxlength: field.maxLength ?? 500, "aria-label": field.label })
        ) as HTMLInputElement | HTMLTextAreaElement;
        txt.value = String(current ?? "");
        txt.addEventListener("change", () => onChange(field.key, coerce(field, txt.value)));
        // Un texte long prend toute la largeur ; un court reste à droite.
        const line = field.multiline || (field.maxLength ?? 500) > 80 ? wideRow(field.label, txt, field.help) : row(field.label, txt, field.help);
        if (field.check) checkedText(line, txt as HTMLInputElement, field.check);
        return line;
      }
      case "folders":
      case "files": {
        const list = Array.isArray(current) ? (current as string[]) : [];
        const exts = field.type === "files" ? field.extensions : [];
        return wideRow(field.label, pathsInput(field.type, exts, field.max ?? 20, list, (v) => onChange(field.key, v)), field.help);
      }
      case "calendars":
        return wideRow(field.label, calendarsInput(field.max ?? 10, coerce(field, current) as CalendarEntry[], (v) => onChange(field.key, v)), field.help);
    }
  });
}

/**
 * Un champ texte vérifié (`check` du manifeste, voir field-checks.ts) : les
 * avertissements s'écrivent sous le champ, à chaque frappe (la valeur est
 * enregistrée quand même).
 */
function checkedText(line: HTMLElement, txt: HTMLInputElement, check: FieldCheck) {
  const box = el("div", { class: "row-help error-text", "aria-live": "polite" });
  const update = () => {
    const lines = fieldWarnings(check, txt.value);
    box.replaceChildren(...lines.map((w) => el("div", {}, w)));
    box.hidden = !lines.length;
  };
  txt.addEventListener("input", update);
  // Sous le champ (ligne pleine largeur), sinon sous le libellé.
  (line.querySelector(".row-wide") ?? line.querySelector(".row-text") ?? line).append(box);
  update();
}

/**
 * Une liste de dossiers (ou de fichiers) : chacun avec « × », plus un bouton
 * « Ajouter… » qui ouvre la boîte de choix de Windows.
 */
function pathsInput(kind: "folders" | "files", extensions: string[], max: number, initial: string[], onChange: (paths: string[]) => void): HTMLElement {
  let folders = [...initial];
  const box = el("div", { class: "paths" });
  const draw = () => {
    box.replaceChildren();
    const list = el("ul", { class: "paths-list" });
    for (const folder of folders) {
      list.append(
        el(
          "li",
          {},
          el("span", { class: "paths-icon" }, kind === "files" ? "📄" : "📁"),
          el("code", { title: folder }, folder),
          el("button", { class: "icon-btn", title: "Retirer", "aria-label": "Retirer", onclick: () => update(folders.filter((f) => f !== folder)) }, "×"),
        ),
      );
    }
    if (!folders.length) list.append(el("li", { class: "paths-empty" }, kind === "files" ? "Aucun fichier." : "Aucun dossier."));
    const add = el(
      "button",
      {
        class: "btn small",
        disabled: !IS_TAURI || folders.length >= max,
        onclick: async () => {
          const picked = kind === "files" ? await Bridge.pickFile("Ajouter un fichier", extensions) : await Bridge.pickFolder("Ajouter un dossier");
          if (picked && !folders.includes(picked)) update([...folders, picked]);
        },
      },
      kind === "files" ? "＋ Ajouter un fichier…" : "＋ Ajouter un dossier…",
    );
    box.append(list, add);
  };
  const update = (next: string[]) => {
    folders = next;
    onChange(folders);
    draw();
  };
  draw();
  return box;
}
