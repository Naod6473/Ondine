// Module « Capture » : capturer une zone de l'écran, en lire le texte (OCR) ou
// l'enregistrer en PNG. Marche aussi sur une image déjà copiée.
//
// Le Rust (src-tauri/src/modules/capture.rs) ouvre l'outil de capture de
// Windows, attend l'image, puis lit le texte ou enregistre le fichier. Il
// prévient par "capture.done" ; le texte lu n'est pas dans le message, on le
// demande avec la commande "last".

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

interface OcrSummary {
  chars: number;
  language: string;
  copied: boolean;
}

interface SavedFile {
  name: string;
  path: string;
}

interface Done {
  action: "ocr" | "save" | "shelf";
  ok: boolean;
  result?: OcrSummary | SavedFile;
  error?: string;
}

/** Le dernier texte lu, pour l'onglet. */
let lastText: { text: string; language: string } | null = null;
const redraws = new Set<() => void>();

async function loadLast(api: ModuleApi) {
  try {
    const r = await api.invoke<{ result: { text: string; language: string } | null }>("last");
    lastText = r.result;
  } catch {
    lastText = null; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
}

/** Montre le résultat d'une lecture ou d'un enregistrement. */
function report(api: ModuleApi, done: Done) {
  if (!done.ok) {
    api.notify({ title: done.action === "ocr" ? "Lecture du texte impossible" : "Enregistrement impossible", body: done.error, icon: "⚠️", priority: "normal", key: "capture" });
    return;
  }
  if (done.action === "ocr") {
    const r = done.result as OcrSummary;
    api.notify({
      title: r.copied ? `Texte copié (${r.chars} caractères)` : `Texte lu (${r.chars} caractères)`,
      body: "Ouvre l'onglet Capture pour le voir.",
      icon: "🔤",
      priority: "normal",
      key: "capture",
    });
    void loadLast(api);
  } else {
    const r = done.result as SavedFile;
    const onShelf = done.action === "shelf";
    api.notify({ title: onShelf ? "Capture posée sur l'étagère" : "Capture enregistrée", body: r.name, icon: onShelf ? "🧺" : "💾", priority: "normal", key: "capture" });
  }
}

/** Une action sur l'image déjà copiée (le résultat arrive tout de suite). */
async function onClipboard(api: ModuleApi, action: "ocr" | "save" | "shelf") {
  try {
    const command = { ocr: "ocr_clipboard", save: "save_clipboard", shelf: "shelf_clipboard" }[action];
    const result = await api.invoke<OcrSummary | SavedFile>(command);
    report(api, { action, ok: true, result });
  } catch (err) {
    report(api, { action, ok: false, error: errorText(err) });
  }
}

/** Ouvre l'outil de capture de Windows ; le résultat arrivera par "capture.done". */
async function snip(api: ModuleApi, then: "ocr" | "save" | "shelf") {
  api.closeIsland(); // l'île ne doit pas être sur la capture
  try {
    await api.invoke("snip", { then });
  } catch (err) {
    report(api, { action: then, ok: false, error: errorText(err) });
  }
}

export const capture: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("capture.done", (msg) => report(api, msg.payload as Done));
  },

  views: {
    expanded(root, api) {
      const button = (label: string, title: string, run: () => unknown) =>
        el("button", { class: "btn small", title, onclick: api.handler(run) }, label);

      const actions = el(
        "div",
        { class: "capture-actions" },
        el(
          "div",
          { class: "btn-row" },
          el("span", { class: "muted capture-label" }, "Capturer une zone :"),
          button("🔤 Lire le texte", "Ouvre l'outil de capture de Windows, puis lit le texte de la zone choisie", () => snip(api, "ocr")),
          button("💾 Enregistrer", "Ouvre l'outil de capture de Windows, puis enregistre la zone choisie en PNG", () => snip(api, "save")),
          button("🧺 Étagère", "Ouvre l'outil de capture de Windows, puis enregistre la zone et la pose sur l'étagère", () => snip(api, "shelf")),
        ),
        el(
          "div",
          { class: "btn-row" },
          el("span", { class: "muted capture-label" }, "Image déjà copiée :"),
          button("🔤 Lire le texte", "Lit le texte de l'image du presse-papiers", () => onClipboard(api, "ocr")),
          button("💾 Enregistrer", "Enregistre l'image du presse-papiers en PNG", () => onClipboard(api, "save")),
          button("🧺 Étagère", "Enregistre l'image du presse-papiers et la pose sur l'étagère", () => onClipboard(api, "shelf")),
          button("📂", "Montre la dernière capture enregistrée dans l'Explorateur", async () => {
            try {
              await api.invoke("reveal");
            } catch (err) {
              api.notify({ title: "Explorateur", body: errorText(err), icon: "⚠️", priority: "low", key: "capture" });
            }
          }),
        ),
      );

      const result = el("div", { class: "capture-result" });
      const draw = () => {
        result.replaceChildren();
        if (!lastText) {
          result.append(el("p", { class: "muted" }, "Le texte lu s'affichera ici. Tout se passe sur ton ordinateur : l'image n'est envoyée nulle part."));
          return;
        }
        const text = el("textarea", { class: "clip-input capture-text", readonly: true, spellcheck: "false" }, lastText.text);
        result.append(
          el(
            "div",
            { class: "capture-result-head" },
            el("span", { class: "muted" }, `Dernier texte lu${lastText.language ? ` (${lastText.language})` : ""}`),
            button("📋 Copier", "Copier tout le texte", async () => {
              await api.invoke("copy_last");
              api.notify({ title: "Copié", icon: "📋", priority: "low", key: "capture" });
            }),
          ),
          text,
        );
      };

      root.append(actions, result);
      draw();
      redraws.add(draw);
      void loadLast(api);
      return () => redraws.delete(draw);
    },
  },
};
