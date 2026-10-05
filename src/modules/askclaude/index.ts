// Module « Demander à Claude » : une erreur collée, un fichier texte ou une
// capture, une question, et Claude répond (API d'Anthropic).
//
// Rien ne part sans ton clic : « Préparer » (ou un dépôt sur l'île) montre
// d'abord TOUT ce qui partira (le texte entier, l'image, la consigne, le
// modèle), puis « Envoyer à Claude » envoie exactement ça. Le Rust
// (src-tauri/src/modules/askclaude.rs) garde le contenu préparé et la clé API ;
// le front ne voit jamais la clé. La réponse est du texte affiché tel quel
// (jamais interprété comme du HTML, jamais exécuté).

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { DropTarget, IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

interface Preview {
  id: number;
  name: string;
  text: string | null;
  image: string | null;
  bytes: number;
  model: string;
  instruction: string;
  destination: string;
}

interface Answer {
  answer: string;
  model: string;
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** L'état de l'onglet, gardé tant que l'île tourne (l'onglet peut se redessiner). */
const state: {
  draft: string;
  question: string;
  preview: Preview | null;
  answer: Answer | null;
  busy: boolean;
  error: string;
} = { draft: "", question: "", preview: null, answer: null, busy: false, error: "" };
const redraws = new Set<() => void>();
const redraw = () => redraws.forEach((r) => r());

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"];
const TEXT_EXT = ["txt", "log", "md", "json", "xml", "csv", "yml", "yaml", "toml", "ini", "cfg", "conf", "ps1", "bat", "cmd", "py", "rs", "ts", "js", "html", "css", "cs", "java", "go", "sql"];

/** Prépare un texte ou un fichier : l'aperçu s'affiche, rien n'est envoyé. */
async function prepare(api: ModuleApi, args: { text?: string; path?: string }) {
  state.error = "";
  state.answer = null;
  try {
    state.preview = await api.invoke<Preview>("prepare", args);
  } catch (err) {
    state.preview = null;
    state.error = errorText(err);
  }
  redraw();
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} Ko`;
}

function dropTargets(api: ModuleApi): DropTarget[] {
  if (api.settings().showDrop === false) return [];
  return [
    {
      id: "askclaude-drop",
      label: "Demander à Claude",
      icon: "💬",
      onDrop: async (paths) => {
        await prepare(api, { path: paths[0] });
        api.openIsland("askclaude"); // pour voir ce qui partira
      },
    },
  ];
}

export const askclaude: IslandModule = {
  manifest: manifest as ModuleManifest,

  views: {
    drop: dropTargets,

    expanded(root, api) {
      const box = el("div", { class: "ask" });
      root.append(box);
      let hasKey = true;

      const draw = () => {
        const parts: HTMLElement[] = [];
        if (!hasKey) {
          parts.push(
            el(
              "div",
              { class: "ask-warn" },
              "🔑 Pas encore de clé API Anthropic. ",
              el("button", { class: "btn small", onclick: api.handler(() => Bridge.openSettingsWindow()) }, "Ouvrir les réglages"),
              el("small", { class: "muted" }, " (Identifiants → Clé API Anthropic)"),
            ),
          );
        }

        if (!state.preview) {
          // 1. Ce que tu veux montrer à Claude.
          const area = el("textarea", { class: "ask-input", placeholder: "Colle ici une erreur, un message, un bout de code…", rows: "4" }) as HTMLTextAreaElement;
          area.value = state.draft;
          area.addEventListener("input", () => (state.draft = area.value));
          const pick = api.handler(async () => {
            const path = await Bridge.pickFile("Montrer un fichier à Claude", [...TEXT_EXT, ...IMAGE_EXT]);
            if (path) await prepare(api, { path });
          });
          parts.push(
            area,
            el(
              "div",
              { class: "btn-row" },
              el("button", { class: "btn small primary", onclick: api.handler(() => prepare(api, { text: state.draft })) }, "Préparer l'envoi"),
              el("button", { class: "btn small", onclick: pick }, "Un fichier ou une capture…"),
              el("small", { class: "muted" }, "Rien ne part avant ta confirmation."),
            ),
          );
        } else {
          // 2. Ce qui part, en entier, puis ta question et « Envoyer ».
          const p = state.preview;
          const question = el("input", { class: "ask-question", placeholder: "Ta question (vide = « Explique-moi ceci. »)", maxlength: "2000" }) as HTMLInputElement;
          question.value = state.question;
          question.addEventListener("input", () => (state.question = question.value));
          const send = api.handler(async () => {
            state.busy = true;
            state.error = "";
            redraw();
            try {
              state.answer = await api.invoke<Answer>("send", { id: p.id, question: state.question });
            } catch (err) {
              state.error = errorText(err);
            } finally {
              state.busy = false;
              redraw();
            }
          });
          parts.push(
            el(
              "div",
              { class: "ask-outgoing" },
              el("div", { class: "ask-outgoing-head" }, el("b", {}, `⬆ Ce qui part vers ${p.destination}`), el("small", { class: "muted" }, `${p.model} · ${size(p.bytes)}`)),
              el("div", { class: "ask-field" }, el("small", { class: "muted" }, "Consigne : "), p.instruction),
              el("div", { class: "ask-field" }, el("small", { class: "muted" }, `Contenu : ${p.name}`)),
              p.image ? el("img", { class: "ask-image", src: p.image, alt: p.name }) : null,
              // textContent : le texte est montré tel quel, jamais interprété.
              p.text !== null ? el("pre", { class: "ask-doc" }, p.text) : null,
            ),
            question,
            el(
              "div",
              { class: "btn-row" },
              el("button", { class: "btn small primary", disabled: state.busy || !hasKey, onclick: send }, state.busy ? "Claude réfléchit…" : "Envoyer à Claude"),
              el(
                "button",
                {
                  class: "btn small",
                  onclick: api.handler(() => {
                    state.preview = null;
                    state.answer = null;
                    state.error = "";
                    redraw();
                  }),
                },
                "Recommencer",
              ),
            ),
          );
        }

        if (state.error) parts.push(el("p", { class: "ask-error" }, `⚠️ ${state.error}`));
        if (state.answer) {
          const a = state.answer;
          parts.push(
            el(
              "div",
              { class: "ask-answer" },
              el("div", { class: "ask-outgoing-head" }, el("b", {}, "💬 Claude"), el("small", { class: "muted" }, `${a.inputTokens ?? "?"} + ${a.outputTokens ?? "?"} jetons`)),
              el("div", { class: "ask-answer-text" }, a.answer || "(réponse vide)"),
              a.truncated ? el("small", { class: "muted" }, "Réponse coupée : augmente la longueur maximale dans les réglages.") : null,
              el(
                "div",
                { class: "btn-row" },
                el(
                  "button",
                  {
                    class: "btn small",
                    onclick: api.handler(async () => {
                      await api.invoke("copy", { text: a.answer });
                      api.notify({ title: "Réponse copiée", icon: "📋", priority: "low", key: "askclaude-copied" });
                    }),
                  },
                  "📋 Copier",
                ),
              ),
            ),
          );
        }
        box.replaceChildren(...parts);
      };

      void api.invoke<{ hasKey: boolean }>("status").then(
        (s) => ((hasKey = s.hasKey), draw()),
        () => {},
      );
      redraws.add(draw);
      draw();
      return () => {
        redraws.delete(draw);
      };
    },
  },
};
