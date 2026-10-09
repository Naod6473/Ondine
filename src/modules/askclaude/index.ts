// Module « Parler à Ondine » (identifiant `askclaude`, son ancien nom) : une
// conversation avec Ondine, qui répond grâce à Claude, GPT ou Gemini.
//
// Votre message part quand vous cliquez « Envoyer » (ou Entrée). Un fichier
// joint (déposé sur l'île, ou « Joindre un fichier ») est d'abord montré en
// entier : il ne part qu'avec le message suivant. Le Rust
// (src-tauri/src/modules/askclaude.rs) garde la conversation, le fichier
// préparé et les clés API ; le front ne voit jamais une clé. Les réponses sont
// du texte affiché tel quel (jamais interprété comme du HTML, jamais exécuté).
// L'humeur qui termine chaque réponse est jouée par la mascotte.

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
  destination: string;
}

interface Status {
  provider: string;
  hasKey: boolean;
  model: string;
  destination: string;
  keyLabel: string;
  system: string;
  history: { user: boolean; text: string; attachment: string | null }[];
  maxTurns: number;
}

interface Answer {
  answer: string;
  emotion: string | null;
  model: string;
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** Un message affiché. Les réponses gardent leurs jetons pour la petite ligne du bas. */
interface Bubble {
  user: boolean;
  text: string;
  attachment: string | null;
  tokens?: string;
  truncated?: boolean;
}

const PROVIDER_NAMES: Record<string, string> = { claude: "Claude", openai: "GPT", gemini: "Gemini" };

/** L'état de l'onglet, gardé tant que l'île tourne (l'onglet peut se redessiner). */
const state: {
  draft: string;
  attachment: Preview | null;
  bubbles: Bubble[];
  status: Status | null;
  busy: boolean;
  error: string;
  showSystem: boolean;
} = { draft: "", attachment: null, bubbles: [], status: null, busy: false, error: "", showSystem: false };
/** Les bulles déjà apparues : seules les nouvelles s'animent à l'arrivée. */
let shown = 0;
const redraws = new Set<() => void>();
const redraw = () => redraws.forEach((r) => r());

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"];
const TEXT_EXT = ["txt", "log", "md", "json", "xml", "csv", "yml", "yaml", "toml", "ini", "cfg", "conf", "ps1", "bat", "cmd", "py", "rs", "ts", "js", "html", "css", "cs", "java", "go", "sql"];

async function refresh(api: ModuleApi) {
  try {
    const s = await api.invoke<Status>("status");
    state.status = s;
    // La conversation vit dans le Rust : on la reprend (les jetons des
    // réponses déjà affichées sont gardés).
    if (!state.busy && s.history.length !== state.bubbles.length) {
      state.bubbles = s.history.map((h) => ({ user: h.user, text: h.text, attachment: h.attachment }));
    }
  } catch {
    // Le module est désactivé ou l'île s'arrête : on garde ce qu'on a.
  }
  redraw();
}

/** Prépare un fichier (ou un texte) à joindre : l'aperçu s'affiche, rien n'est envoyé. */
async function attach(api: ModuleApi, args: { text?: string; path?: string }) {
  state.error = "";
  try {
    state.attachment = await api.invoke<Preview>("prepare", args);
  } catch (err) {
    state.attachment = null;
    state.error = errorText(err);
  }
  redraw();
}

async function send(api: ModuleApi) {
  const message = state.draft.trim();
  if (state.busy || (!message && !state.attachment)) return;
  const attachment = state.attachment;
  state.busy = true;
  state.error = "";
  state.bubbles.push({ user: true, text: message, attachment: attachment?.name ?? null });
  state.draft = "";
  redraw();
  api.emit("mascot.emote", { emotion: "thinking" });
  try {
    const a = await api.invoke<Answer>("send", { message, attachment: attachment?.id });
    state.attachment = null;
    state.bubbles.push({ user: false, text: a.answer || "…", attachment: null, tokens: `${a.inputTokens ?? "?"} + ${a.outputTokens ?? "?"} jetons`, truncated: a.truncated });
    if (a.emotion) api.emit("mascot.emote", { emotion: a.emotion });
  } catch (err) {
    // Rien n'est gardé dans la conversation : le message revient dans le champ.
    state.bubbles.pop();
    state.draft = message;
    state.error = errorText(err);
    api.emit("mascot.emote", { emotion: "sad" });
  } finally {
    state.busy = false;
    redraw();
  }
}

/** Ce qui part à chaque message, en une phrase (trois phrases entières pour la traduction). */
function footnote(destination: string, previous: number): string {
  if (previous === 0) return `À chaque message partent vers ${destination} : la personnalité d'Ondine et le vôtre. Rien n'est gardé sur le disque.`;
  if (previous === 1) return `À chaque message partent vers ${destination} : la personnalité d'Ondine, le message précédent et le vôtre. Rien n'est gardé sur le disque.`;
  return `À chaque message partent vers ${destination} : la personnalité d'Ondine, les ${previous} messages précédents et le vôtre. Rien n'est gardé sur le disque.`;
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} Ko`;
}

function dropTargets(api: ModuleApi): DropTarget[] {
  if (api.settings().showDrop === false) return [];
  return [
    {
      id: "askclaude-drop",
      label: "Parler à Ondine",
      icon: "💬",
      onDrop: async (paths) => {
        await attach(api, { path: paths[0] });
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
      // data-island-fit : l'île grandit pour montrer la conversation et le champ (fit.ts).
      const box = el("div", { class: "ask", "data-island-fit": "" });
      root.append(box);
      let list: HTMLElement | null = null;

      const bubble = (b: Bubble, i: number): HTMLElement => {
        const fresh = i >= shown ? " fresh" : "";
        if (b.user) {
          return el(
            "div",
            { class: `ask-bubble me${fresh}` },
            // data-no-i18n : vos mots et ceux d'Ondine ne passent pas par la traduction de l'interface.
            b.text ? el("div", { class: "ask-bubble-text", "data-no-i18n": "" }, b.text) : null,
            b.attachment ? el("small", { class: "ask-bubble-meta" }, `📎 ${b.attachment}`) : null,
          );
        }
        return el(
          "div",
          { class: `ask-bubble ondine${fresh}` },
          el("div", { class: "ask-bubble-text", "data-no-i18n": "" }, b.text),
          el(
            "div",
            { class: "ask-bubble-meta" },
            b.tokens ? el("small", { class: "muted" }, b.tokens) : null,
            b.truncated ? el("small", { class: "muted" }, "Réponse coupée : augmentez la longueur maximale dans les réglages.") : null,
            el(
              "button",
              {
                class: "btn small",
                title: "Copier la réponse",
                "aria-label": "Copier la réponse",
                onclick: api.handler(async () => {
                  await api.invoke("copy", { text: b.text });
                  api.notify({ title: "Réponse copiée", icon: "📋", priority: "low", key: "askclaude-copied" });
                }),
              },
              "📋",
            ),
          ),
        );
      };

      const draw = () => {
        const s = state.status;
        const who = PROVIDER_NAMES[s?.provider ?? "claude"] ?? "Claude";
        const parts: (HTMLElement | null)[] = [];

        parts.push(
          el(
            "div",
            { class: "ask-head" },
            el("b", {}, "💬 Ondine"),
            el("small", { class: "muted" }, s ? `${who} · ${s.model}` : ""),
            el(
              "button",
              {
                class: "btn small",
                disabled: state.busy || (state.bubbles.length === 0 && !state.attachment),
                onclick: api.handler(async () => {
                  await api.invoke("reset");
                  state.bubbles = [];
                  state.attachment = null;
                  state.error = "";
                  redraw();
                }),
              },
              "Recommencer",
            ),
          ),
        );

        if (s && !s.hasKey) {
          parts.push(
            el(
              "div",
              { class: "ask-warn" },
              `🔑 Pas encore de ${s.keyLabel.charAt(0).toLowerCase()}${s.keyLabel.slice(1)}. `,
              el("button", { class: "btn small", onclick: api.handler(() => Bridge.openSettingsWindow()) }, "Ouvrir les réglages"),
              el("small", { class: "muted" }, ` (Identifiants → ${s.keyLabel})`),
            ),
          );
        }

        // La conversation. Le premier mot d'Ondine est écrit ici : il ne coûte rien.
        list = el(
          "div",
          { class: "ask-thread", role: "log", "aria-live": "polite" },
          state.bubbles.length === 0
            ? el(
                "div",
                { class: "ask-bubble ondine hello" },
                el("div", { class: "ask-bubble-text" }, "Bonjour ! Je suis Ondine. Posez-moi une question sur votre PC, collez une erreur, ou montrez-moi un fichier : je vous aide."),
              )
            : null,
          ...state.bubbles.map(bubble),
          state.busy ? el("div", { class: "ask-bubble ondine typing fresh", "aria-label": `${who} réfléchit…` }, el("span", {}), el("span", {}), el("span", {})) : null,
        );
        parts.push(list);

        if (state.error) parts.push(el("p", { class: "ask-error" }, `⚠️ ${state.error}`));

        // Le fichier joint : montré en entier, il partira avec le prochain message.
        const p = state.attachment;
        if (p) {
          parts.push(
            el(
              "div",
              { class: "ask-outgoing" },
              el(
                "div",
                { class: "ask-outgoing-head" },
                el("b", {}, `📎 ${p.name}`),
                el("small", { class: "muted" }, `${size(p.bytes)} · partira vers ${p.destination} avec votre message`),
                el(
                  "button",
                  {
                    class: "btn small",
                    disabled: state.busy,
                    onclick: api.handler(async () => {
                      await api.invoke("unprepare");
                      state.attachment = null;
                      redraw();
                    }),
                  },
                  "Retirer",
                ),
              ),
              p.image ? el("img", { class: "ask-image", src: p.image, alt: p.name }) : null,
              // textContent : le texte est montré tel quel, jamais interprété.
              p.text !== null ? el("pre", { class: "ask-doc", "data-no-i18n": "" }, p.text) : null,
            ),
          );
        }

        // Votre message : Entrée envoie, Maj+Entrée va à la ligne.
        const area = el("textarea", { class: "ask-input", placeholder: "Écrire à Ondine…", rows: "2", maxlength: "2000" }) as HTMLTextAreaElement;
        area.value = state.draft;
        area.addEventListener("input", () => (state.draft = area.value));
        area.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void send(api);
          }
        });
        const pick = api.handler(async () => {
          const path = await Bridge.pickFile("Montrer un fichier à Ondine", [...TEXT_EXT, ...IMAGE_EXT]);
          if (path) await attach(api, { path });
        });
        parts.push(
          area,
          el(
            "div",
            { class: "btn-row" },
            el(
              "button",
              // « thinking » : le design Studio fait respirer le bouton pendant l'attente.
              { class: `btn small primary ${state.busy ? "thinking" : ""}`, disabled: state.busy || !s?.hasKey, onclick: api.handler(() => send(api)) },
              state.busy ? "Ondine réfléchit…" : "Envoyer",
            ),
            el("button", { class: "btn small", disabled: state.busy, onclick: pick }, "📎 Joindre un fichier…"),
          ),
        );

        // Ce qui part, dit simplement, et la personnalité à relire.
        if (s) {
          const n = Math.min(state.bubbles.length, s.maxTurns - 1);
          parts.push(
            el(
              "div",
              { class: "ask-footnote" },
              el("small", { class: "muted" }, footnote(s.destination, n)),
              el(
                "button",
                { class: "btn small", onclick: () => ((state.showSystem = !state.showSystem), redraw()) },
                state.showSystem ? "Masquer la personnalité" : "Voir la personnalité",
              ),
              state.showSystem ? el("pre", { class: "ask-doc", "data-no-i18n": "" }, s.system) : null,
            ),
          );
        }

        const hadFocus = document.activeElement?.classList.contains("ask-input") ?? false;
        box.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
        shown = state.bubbles.length;
        list.scrollTop = list.scrollHeight;
        if (hadFocus) area.focus({ preventScroll: true });
      };

      shown = state.bubbles.length; // en rouvrant l'onglet, rien ne rejoue
      void refresh(api);
      // Les réglages changent (fournisseur, modèle, personnalité) : on relit.
      const offSettings = api.onSettingsChange(() => void refresh(api));
      redraws.add(draw);
      draw();
      return () => {
        redraws.delete(draw);
        offSettings();
      };
    },
  },
};
