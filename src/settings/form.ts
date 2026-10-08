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
import { errorText } from "../core/log";
import { chip, choice, row, stepper, toggle, wideRow } from "./controls";

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
        const txt = el("input", { type: "text", class: "text", maxlength: field.maxLength ?? 500, "aria-label": field.label }) as HTMLInputElement;
        txt.value = String(current ?? "");
        txt.addEventListener("change", () => onChange(field.key, coerce(field, txt.value)));
        // Un texte long prend toute la largeur ; un court reste à droite.
        const line = (field.maxLength ?? 500) > 80 ? wideRow(field.label, txt, field.help) : row(field.label, txt, field.help);
        if (field.check) checkedText(line, txt, field.check);
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
      case "secret":
        return wideRow(field.label, secretInput(field.credential, field.label, field.placeholder ?? "", onChange.bind(null, field.key)), field.help);
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

/**
 * Un secret (jeton…) rangé dans le Gestionnaire d'identifiants sous `key`,
 * comme la page Identifiants : un état (« Enregistré » / « Aucun »), un champ
 * masqué, « Enregistrer » et « Supprimer ». La valeur ne passe jamais par les
 * réglages ; `onChange` est seulement prévenu (avec null) pour que l'onglet se
 * redessine.
 */
function secretInput(key: string, label: string, placeholder: string, onChange: (value: unknown) => void): HTMLElement {
  const status = chip("…");
  const input = el("input", { type: "password", class: "text grow", placeholder, autocomplete: "off", "aria-label": label }) as HTMLInputElement;
  const msg = el("div", { class: "row-help" });
  const refresh = async () => {
    const present = IS_TAURI && (await Bridge.credentialExists(key));
    status.textContent = present ? "✓ Enregistré" : "Aucun";
    status.className = `chip ${present ? "ok" : ""}`;
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      input.value = "";
      msg.textContent = done;
      onChange(null);
    } catch (err) {
      msg.textContent = errorText(err);
    }
    void refresh();
  };
  void refresh();
  return el(
    "div",
    { class: "secret" },
    el(
      "div",
      { class: "inline" },
      status,
      input,
      el("button", { class: "btn primary", disabled: !IS_TAURI, onclick: () => void act(() => Bridge.credentialSet(key, input.value), "Enregistré.") }, "Enregistrer"),
      el("button", { class: "btn", disabled: !IS_TAURI, onclick: () => void act(() => Bridge.credentialDelete(key), "Supprimé.") }, "Supprimer"),
    ),
    msg,
  );
}
