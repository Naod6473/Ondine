// Génère un formulaire à partir du schéma de réglages d'un module (manifest.json).
// Aucun module n'écrit son propre écran de réglages : il décrit ses champs, l'île
// dessine le formulaire, vérifie les valeurs et les enregistre.

import type { SettingField } from "../core/module-types";
import { coerce } from "../core/settings-store";
import { Bridge, IS_TAURI } from "../core/bridge";
import { el } from "../island/dom";

export function settingsForm(
  fields: SettingField[],
  values: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
): HTMLElement {
  const form = el("div", { class: "form" });
  for (const field of fields) {
    const id = `f-${field.key}-${Math.random().toString(36).slice(2, 7)}`;
    const current = values[field.key];
    let input: HTMLElement;
    switch (field.type) {
      case "boolean": {
        const box = el("input", { type: "checkbox", id }) as HTMLInputElement;
        box.checked = Boolean(current);
        box.addEventListener("change", () => onChange(field.key, box.checked));
        input = box;
        break;
      }
      case "number": {
        const num = el("input", { type: "number", id, min: field.min, max: field.max, step: field.step ?? 1 }) as HTMLInputElement;
        num.value = String(current);
        num.addEventListener("change", () => {
          const v = coerce(field, Number(num.value));
          num.value = String(v);
          onChange(field.key, v);
        });
        input = num;
        break;
      }
      case "select": {
        const sel = el("select", { id }) as HTMLSelectElement;
        for (const o of field.options) sel.append(el("option", { value: o.value }, o.label));
        sel.value = String(current);
        sel.addEventListener("change", () => onChange(field.key, sel.value));
        input = sel;
        break;
      }
      case "string": {
        const txt = el("input", { type: "text", id, maxlength: field.maxLength ?? 500 }) as HTMLInputElement;
        txt.value = String(current ?? "");
        txt.addEventListener("change", () => onChange(field.key, coerce(field, txt.value)));
        input = txt;
        break;
      }
      case "folders":
        input = pathsInput("folders", [], field.max ?? 20, Array.isArray(current) ? (current as string[]) : [], (v) => onChange(field.key, v));
        break;
      case "files":
        input = pathsInput("files", field.extensions, field.max ?? 20, Array.isArray(current) ? (current as string[]) : [], (v) => onChange(field.key, v));
        break;
    }
    form.append(
      el(
        "div",
        { class: `field field-${field.type}` },
        el("label", { for: id }, field.label),
        input,
        field.help ? el("div", { class: "help" }, field.help) : null,
      ),
    );
  }
  return form;
}

/**
 * Une liste de dossiers (ou de fichiers) : chacun avec « × », plus un bouton
 * « Ajouter… » qui ouvre la boîte de choix de Windows.
 */
function pathsInput(kind: "folders" | "files", extensions: string[], max: number, initial: string[], onChange: (paths: string[]) => void): HTMLElement {
  let folders = [...initial];
  const box = el("div", { class: "folders-input" });
  const draw = () => {
    box.replaceChildren();
    const list = el("ul", { class: "folders" });
    for (const folder of folders) {
      list.append(
        el(
          "li",
          {},
          el("code", {}, folder),
          el("button", { class: "icon-btn", title: "Retirer", onclick: () => update(folders.filter((f) => f !== folder)) }, "×"),
        ),
      );
    }
    if (!folders.length) list.append(el("li", { class: "muted" }, kind === "files" ? "Aucun fichier." : "Aucun dossier."));
    const add = el(
      "button",
      {
        class: "btn",
        disabled: !IS_TAURI || folders.length >= max,
        onclick: async () => {
          const picked = kind === "files" ? await Bridge.pickFile("Ajouter un fichier", extensions) : await Bridge.pickFolder("Ajouter un dossier");
          if (picked && !folders.includes(picked)) update([...folders, picked]);
        },
      },
      kind === "files" ? "Ajouter un fichier…" : "Ajouter un dossier…",
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
