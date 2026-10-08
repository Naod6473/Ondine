// Module « Capture » : capturer une zone de l'écran, en lire le texte (OCR) ou
// l'enregistrer en PNG. Marche aussi sur une image déjà copiée.
//
// Le Rust (src-tauri/src/modules/capture.rs) ouvre l'outil de capture de
// Windows, attend l'image, puis lit le texte ou enregistre le fichier. Il
// prévient par "capture.done" ; le texte lu n'est pas dans le message, on le
// demande avec la commande "last".
//
// La pipette : le Rust fige l'écran sous une croix avec une loupe (fenêtre
// Win32, voir src-tauri/src/platform/picker.rs) ; un clic copie la couleur
// (HEX, RGB ou HSL selon le réglage) et l'ajoute à l'historique (8 couleurs).
// La couleur arrive par "capture.color" ; l'historique se demande avec "colors".
//
// « Enregistrer un GIF » : le Rust ouvre une sélection de zone (fenêtre Win32,
// voir src-tauri/src/platform/record.rs), copie la zone dix fois par seconde,
// puis écrit le GIF. Chaque étape arrive par "capture.gif" { state } :
// "recording" (une notification avec « Arrêter »), "encoding", puis "done"
// (« Montrer dans l'Explorateur »), "cancelled" (Échap : rien à dire) ou "error".

import manifest from "./manifest.json";
import { t } from "../../core/i18n";
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

type Action = "ocr" | "save" | "shelf" | "annotate";

interface Done {
  /** "copy" : l'image annotée a été copiée (fenêtre d'annotation). */
  action: Action | "copy";
  ok: boolean;
  result?: OcrSummary | SavedFile;
  error?: string;
}

/** Une couleur de l'historique : la pastille (hex) et ce qui sera copié (text). */
interface PickedColor {
  hex: string;
  text: string;
}

/** Ce que le Rust publie quand la pipette a choisi (rien si on a annulé). */
interface ColorDone {
  ok: boolean;
  hex?: string;
  text?: string;
  error?: string;
}

/** Les dernières couleurs prises à la pipette, la plus récente en premier. */
let colors: PickedColor[] = [];

/** Ce que le Rust publie sur "capture.gif", à chaque étape. */
interface GifEvent {
  state: "recording" | "encoding" | "done" | "cancelled" | "error";
  /** recording : la durée maximale ; done : la durée enregistrée. */
  seconds?: number;
  name?: string;
  bytes?: number;
  error?: string;
}

/** Où en est le GIF : rien, choix de la zone, enregistrement, écriture. */
let gifState: "idle" | "selecting" | "recording" | "encoding" = "idle";
const GIF_KEY = "capture-gif";

/** « 820 Ko », « 2,4 Mo ». */
function fileSize(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1024));
  return kb < 1024 ? `${kb} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Ouvre la sélection de zone ; la suite arrive par "capture.gif". */
async function startGif(api: ModuleApi) {
  api.closeIsland(); // l'île ne doit pas être sur la photo du bureau
  gifState = "selecting";
  for (const r of redraws) r();
  try {
    // L'aide affichée en haut de l'écran pendant le choix (dessinée par Windows : on la traduit ici).
    await api.invoke("gif_start", { hint: t("Glissez pour choisir la zone du GIF · Clic : tout l'écran · Échap : annuler") });
  } catch (err) {
    gifState = "idle";
    for (const r of redraws) r();
    api.notify({ title: "GIF impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: GIF_KEY });
  }
}

async function stopGif(api: ModuleApi) {
  try {
    await api.invoke("gif_stop");
  } catch {
    // (Déjà fini : rien à arrêter.)
  }
}

/** Montre chaque étape du GIF dans une notification. */
function onGif(api: ModuleApi, e: GifEvent) {
  switch (e.state) {
    case "recording":
      gifState = "recording";
      api.notify({
        title: `Enregistrement du GIF (${e.seconds ?? 10} s au plus)`,
        icon: "🔴",
        priority: "low",
        key: GIF_KEY,
        sticky: true,
        actions: [{ label: "Arrêter", run: () => stopGif(api) }],
      });
      break;
    case "encoding":
      gifState = "encoding";
      api.notify({ title: "Création du GIF…", icon: "⏳", priority: "low", key: GIF_KEY, sticky: true });
      break;
    case "done":
      gifState = "idle";
      api.notify({
        title: `GIF enregistré (${Math.max(1, Math.round(e.seconds ?? 0))} s, ${fileSize(e.bytes ?? 0)})`,
        body: e.name,
        icon: "🎞️",
        priority: "normal",
        key: GIF_KEY,
        durationMs: 12_000,
        actions: [
          {
            label: "Montrer dans l'Explorateur",
            run: async () => {
              try {
                await api.invoke("reveal");
              } catch (err) {
                api.notify({ title: "Explorateur", body: errorText(err), icon: "⚠️", priority: "low", key: GIF_KEY });
              }
            },
          },
        ],
      });
      break;
    case "cancelled":
      gifState = "idle"; // Échap pendant le choix de la zone : rien à dire
      break;
    case "error":
      gifState = "idle";
      api.notify({ title: "GIF impossible", body: e.error, icon: "⚠️", priority: "normal", key: GIF_KEY });
      break;
  }
  for (const r of redraws) r();
}

async function loadColors(api: ModuleApi) {
  try {
    const r = await api.invoke<{ colors: PickedColor[] }>("colors");
    colors = r.colors;
  } catch {
    colors = []; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
}

/** Lance la pipette ; la couleur arrivera par "capture.color". */
async function pick(api: ModuleApi) {
  api.closeIsland(); // l'île ne doit pas être sur la photo de l'écran
  try {
    await api.invoke("pick_color");
  } catch (err) {
    api.notify({ title: "Pipette impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "capture-color" });
  }
}

/** Recopie une couleur de l'historique (dans le format choisi). */
async function copyColor(api: ModuleApi, hex: string) {
  try {
    const r = await api.invoke<{ text: string }>("copy_color", { hex });
    api.notify({ title: `${r.text} copié`, icon: "💧", priority: "low", key: "capture-color" });
    void loadColors(api);
  } catch (err) {
    api.notify({ title: "Copie impossible", body: errorText(err), icon: "⚠️", priority: "low", key: "capture-color" });
  }
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
  // Annoter : la fenêtre d'annotation s'ouvre, rien à dire de plus.
  if (done.action === "annotate") return;
  if (done.action === "copy") {
    api.notify({ title: "Image annotée copiée", icon: "📋", priority: "low", key: "capture" });
    return;
  }
  if (done.action === "ocr") {
    const r = done.result as OcrSummary;
    api.notify({
      title: r.copied ? `Texte copié (${r.chars} caractères)` : `Texte lu (${r.chars} caractères)`,
      body: "Ouvrez l'onglet Capture pour le voir.",
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
async function onClipboard(api: ModuleApi, action: Action) {
  try {
    const command = { ocr: "ocr_clipboard", save: "save_clipboard", shelf: "shelf_clipboard", annotate: "annotate_clipboard" }[action];
    const result = await api.invoke<OcrSummary | SavedFile>(command);
    report(api, { action, ok: true, result });
  } catch (err) {
    report(api, { action, ok: false, error: errorText(err) });
  }
}

/** Ouvre l'outil de capture de Windows ; le résultat arrivera par "capture.done". */
async function snip(api: ModuleApi, then: Action) {
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
    // Un autre module (Agents IA : un agent a demandé une capture, et vous
    // avez cliqué « Capturer ») demande l'outil de capture.
    api.on("capture.request", (msg) => {
      const then = (msg.payload as { then?: Action } | null)?.then;
      void snip(api, then === "save" || then === "shelf" ? then : "save");
    });
    api.on("capture.done", (msg) => report(api, msg.payload as Done));
    api.on("capture.gif", (msg) => onGif(api, msg.payload as GifEvent));
    api.on("capture.color", (msg) => {
      const done = msg.payload as ColorDone;
      if (done.ok) {
        api.notify({ title: `${done.text ?? done.hex} copié`, icon: "💧", priority: "low", key: "capture-color" });
      } else {
        api.notify({ title: "Pipette impossible", body: done.error, icon: "⚠️", priority: "normal", key: "capture-color" });
      }
      void loadColors(api);
    });
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
          button("🔤 Texte", "Ouvre l'outil de capture de Windows, puis lit le texte de la zone choisie", () => snip(api, "ocr")),
          button("✏️ Annoter", "Ouvre l'outil de capture de Windows, puis la zone choisie dans la fenêtre d'annotation", () => snip(api, "annotate")),
          button("💾 PNG", "Ouvre l'outil de capture de Windows, puis enregistre la zone choisie en PNG", () => snip(api, "save")),
          button("🧺 Étagère", "Ouvre l'outil de capture de Windows, puis enregistre la zone et la pose sur l'étagère", () => snip(api, "shelf")),
        ),
        el(
          "div",
          { class: "btn-row" },
          el("span", { class: "muted capture-label" }, "Image déjà copiée :"),
          button("🔤 Texte", "Lit le texte de l'image du presse-papiers", () => onClipboard(api, "ocr")),
          button("✏️ Annoter", "Ouvre l'image du presse-papiers dans la fenêtre d'annotation", () => onClipboard(api, "annotate")),
          button("💾 PNG", "Enregistre l'image du presse-papiers en PNG", () => onClipboard(api, "save")),
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

      // La pipette et ses dernières couleurs (pastilles cliquables).
      const swatches = el("div", { class: "capture-swatches" });
      const drawColors = () => {
        swatches.replaceChildren(
          ...colors.map((c) =>
            el("button", {
              class: "capture-swatch",
              style: `background:${c.hex}`,
              title: `${c.text} : cliquer pour copier`,
              "aria-label": c.text,
              onclick: api.handler(() => copyColor(api, c.hex)),
            }),
          ),
        );
        if (!colors.length) swatches.append(el("span", { class: "muted capture-swatch-empty" }, "Aucune couleur pour l'instant"));
      };
      actions.append(
        el(
          "div",
          { class: "btn-row" },
          el("span", { class: "muted capture-label" }, "Couleur à l'écran :"),
          button("💧 Pipette", "Fige l'écran : cliquez sur un point pour copier sa couleur (Échap pour annuler, flèches pour bouger d'un pixel)", () => pick(api)),
          swatches,
        ),
      );

      // Le GIF animé : un bouton qui devient « Arrêter » pendant l'enregistrement.
      const gifSlot = el("span", { class: "capture-gif" });
      const drawGif = () => {
        const busy = gifState === "selecting" || gifState === "encoding";
        gifSlot.replaceChildren(
          gifState === "recording"
            ? button("⏹️ Arrêter le GIF", "Arrêter l'enregistrement et créer le GIF", () => stopGif(api))
            : el(
                "button",
                {
                  class: "btn small",
                  title: "Choisissez une zone de l'écran, puis enregistrez-la en GIF animé (durée maximale dans les réglages du module)",
                  disabled: busy,
                  onclick: api.handler(() => startGif(api)),
                },
                busy ? "⏳ GIF en cours…" : "🎞️ Enregistrer un GIF",
              ),
        );
      };
      actions.append(el("div", { class: "btn-row" }, el("span", { class: "muted capture-label" }, "GIF animé :"), gifSlot));

      const result = el("div", { class: "capture-result" });
      const draw = () => {
        result.replaceChildren();
        if (!lastText) {
          result.append(el("p", { class: "muted" }, "Le texte lu s'affichera ici. Tout se passe sur votre ordinateur : l'image n'est envoyée nulle part."));
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
      drawColors();
      drawGif();
      redraws.add(draw);
      redraws.add(drawColors);
      redraws.add(drawGif);
      void loadLast(api);
      void loadColors(api);
      return () => {
        redraws.delete(draw);
        redraws.delete(drawColors);
        redraws.delete(drawGif);
      };
    },
  },
};
