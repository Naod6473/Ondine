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
//
// Les outils de fichiers (réglage « fileTools ») : une réponse peut arriver
// avec ce qu'Ondine a fait (`activity`) et des cartes de fichiers (`cards` :
// Ouvrir, Montrer dans l'Explorateur), ou s'arrêter sur une demande d'accord
// (`pending` : lire ou créer un fichier), qui reprend avec `confirm`.
//
// La voix (askclaude_voice.rs) : un raccourci global, ou le bouton 🎙️, ouvre
// l'écoute. Le Rust publie `askclaude.voice` : `open` (la mascotte sursaute
// puis tend l'oreille, un point rouge et une bulle de sous-titres en direct),
// `partial`, `final` (le texte part comme un message tapé ; « Regarde ça » :
// l'image de la fenêtre est jointe et attend votre clic), `empty`, `cancel`,
// `blocked` (discrétion), `error`. Ondine sur le bureau (src/pet/) l'écoute
// aussi : une seule fenêtre « s'en occupe » (`owner`), la bulle d'Ondine si
// elle est sur le bureau avec cet onglet, sinon l'île.
//
// La réponse s'écrit petit à petit avec des « plop plip » (plops.ts) ; la
// bouche suit (sujet « mascot.talk {open: 0..1, brow?} », la bouche se
// referme seule ; `brow` : "question" sur « ? », "exclaim" sur « ! »).
// L'humeur est jouée à la fin. Mains libres : le micro se rallume ensuite.
//
// Commandes rapides (askclaude_quick.rs) : « volume 30 », « minuteur 10
// minutes », « note : … » sont faites sans IA ni clé (`quick`), avant tout envoi.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { DropTarget, IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { settingsStore } from "../../core/settings-store";
import { reducedMotion } from "../../island/tab-pill";
import { DEFAULT_TIMBRE, speak, TIMBRES } from "./plops";

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
  fileTools: boolean;
  pcTools: boolean;
  filesFolder: string | null;
}

/** Ce qu'Ondine a fait avec ses outils (une ligne par action). */
interface Activity {
  kind: "search" | "read" | "created" | "refused" | "did" | "refused-act";
  query?: string;
  count?: number;
  name?: string;
  /** Une action sur le PC (askclaude_pc.rs) : son genre et sa précision. */
  what?: string;
  value?: string;
}

/** Une carte de fichier trouvé ou créé. */
interface Card {
  numero: number;
  nom: string;
  dossier: string;
  taille: string | null;
  cree: boolean;
}

/** Une demande d'accord : lire un fichier (son texte partira) ou en créer un. */
interface Ask {
  id: number;
  kind: "read" | "create" | "action";
  what?: string;
  value?: string;
  name: string;
  bytes: number;
  preview: string;
  cut?: boolean;
  destination?: string;
  folder?: string | null;
}

interface Answer {
  answer: string;
  emotion: string | null;
  model: string;
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
  activity?: Activity[];
  cards?: Card[];
  pending?: Ask;
}

/** Une commande rapide faite sans IA (`quick`). */
interface Quick {
  handled: boolean;
  answer?: string;
  error?: string;
  activity?: Activity[];
}

/** Un message du Rust sur l'écoute (sujet « askclaude.voice »). */
interface VoiceMsg {
  kind: "open" | "partial" | "transcribing" | "final" | "empty" | "cancel" | "blocked" | "error";
  text?: string;
  look?: boolean;
  hold?: boolean;
  why?: string;
  message?: string;
}

/** Un message affiché. Les réponses gardent leurs jetons pour la petite ligne du bas. */
interface Bubble {
  user: boolean;
  text: string;
  attachment: string | null;
  tokens?: string;
  truncated?: boolean;
  activity?: Activity[];
  cards?: Card[];
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
  /** L'échange arrêté sur une demande d'accord, et ce qu'Ondine a déjà fait. */
  pending: { ask: Ask; activity: Activity[] } | null;
  /** L'écoute : en cours, « Regarde ça », touche tenue, sous-titres, texte en cours d'écriture, petite note. */
  voice: { on: boolean; look: boolean; hold: boolean; partial: string; transcribing: boolean; note: string };
  /** Le message en cours venait de la voix (mains libres après la réponse). */
  spoken: boolean;
} = {
  draft: "",
  attachment: null,
  bubbles: [],
  status: null,
  busy: false,
  error: "",
  pending: null,
  voice: { on: false, look: false, hold: false, partial: "", transcribing: false, note: "" },
  spoken: false,
};
/** La réponse qui s'écrit petit à petit (son indice, ce qui est visible, de quoi l'arrêter). */
let reveal: { index: number; shown: number; stop: () => void } | null = null;
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
async function attach(api: ModuleApi, args: { text?: string; path?: string; look?: boolean }) {
  state.error = "";
  try {
    state.attachment = await api.invoke<Preview>("prepare", args);
  } catch (err) {
    state.attachment = null;
    state.error = errorText(err);
  }
  redraw();
}

/** Une réponse (ou une demande d'accord) arrive. */
function receive(api: ModuleApi, a: Answer) {
  if (a.pending) {
    state.pending = { ask: a.pending, activity: a.activity ?? [] };
    api.emit("mascot.emote", { emotion: "shy" });
    return;
  }
  state.pending = null;
  state.bubbles.push({
    user: false,
    text: a.answer || "…",
    attachment: null,
    tokens: `${a.inputTokens ?? "?"} + ${a.outputTokens ?? "?"} jetons`,
    truncated: a.truncated,
    activity: a.activity,
    cards: a.cards,
  });
  // L'humeur est jouée quand le texte a fini de s'écrire.
  void startReveal(api, state.bubbles.length - 1, a.answer || "…", a.emotion);
}

/** Les petits sons sont-ils permis maintenant (réglages, discrétion) ? Leur volume, 0 = muets. */
async function plopVolume(api: ModuleApi): Promise<number> {
  const s = api.settings();
  if (s.plops === false) return 0;
  const volume = Math.max(0, Math.min(100, Number(s.plopVolume ?? 50))) / 100;
  if (volume <= 0) return 0;
  const now = await api.invoke<{ discreet: string | null } | null>("voice_state").catch(() => null);
  return now?.discreet ? 0 : volume;
}

/**
 * Écrit la réponse n° `index` petit à petit, avec ses gouttes et la bouche
 * de la mascotte ; puis l'humeur, et le micro si « Mains libres ».
 */
async function startReveal(api: ModuleApi, index: number, text: string, mood: string | null) {
  reveal?.stop();
  const spoken = state.spoken;
  state.spoken = false;
  const r = { index, shown: 0, stop: () => {} };
  reveal = r;
  const volume = await plopVolume(api);
  if (reveal !== r) return;
  const instant = reducedMotion() || settingsStore.current.mascot.calm === true;
  if (!instant) api.emit("mascot.emote", { emotion: "talk" });
  r.stop = speak(text, {
    timbre: TIMBRES[settingsStore.current.mascot.id] ?? DEFAULT_TIMBRE,
    mood,
    volume,
    instant,
    onText: (n) => {
      r.shown = n;
      const node = document.querySelector<HTMLElement>(`[data-reveal="${index}"]`);
      if (!node) return;
      node.textContent = text.slice(0, n);
      const list = node.closest<HTMLElement>(".ask-thread");
      if (list) list.scrollTop = list.scrollHeight;
    },
    onMouth: (open, brow) => {
      if (!instant) api.emit("mascot.talk", brow ? { open, brow } : { open });
    },
    onEnd: () => {
      if (reveal === r) reveal = null;
      if (mood) api.emit("mascot.emote", { emotion: mood });
      redraw();
      // Mains libres : après une question dite à voix haute, le micro se rallume.
      if (spoken && api.settings().handsFree === true) void api.invoke("listen", { handsFree: true }).catch(() => {});
    },
  });
}

async function send(api: ModuleApi) {
  const message = state.draft.trim();
  if (state.busy || state.pending || (!message && !state.attachment)) return;
  const attachment = state.attachment;
  state.busy = true;
  state.error = "";
  state.voice.note = "";
  state.bubbles.push({ user: true, text: message, attachment: attachment?.name ?? null });
  state.draft = "";
  redraw();
  // Une commande rapide (« volume 30 », « minuteur 10 minutes »…) : faite ici, sans IA ni clé.
  const quick = !attachment && message ? await api.invoke<Quick | null>("quick", { text: message }).catch(() => null) : null;
  if (quick?.handled) {
    state.busy = false;
    if (quick.error) {
      state.bubbles.pop();
      state.draft = message;
      state.error = quick.error;
      state.spoken = false;
      api.emit("mascot.emote", { emotion: "sad" });
    } else {
      state.bubbles.push({ user: false, text: quick.answer ?? "", attachment: null, activity: quick.activity });
      state.spoken = false; // une commande faite : pas besoin de rallumer le micro
      void startReveal(api, state.bubbles.length - 1, quick.answer ?? "", "happy");
    }
    redraw();
    return;
  }
  api.emit("mascot.emote", { emotion: "thinking" });
  try {
    const a = await api.invoke<Answer>("send", { message, attachment: attachment?.id });
    state.attachment = null;
    receive(api, a);
  } catch (err) {
    // Rien n'est gardé dans la conversation : le message revient dans le champ.
    state.bubbles.pop();
    state.draft = message;
    state.error = errorText(err);
    state.spoken = false;
    api.emit("mascot.emote", { emotion: "sad" });
  } finally {
    state.busy = false;
    redraw();
  }
}

/** Ondine sur le bureau avec cet onglet dans sa bulle : c'est elle qui écoute. */
function petHandles(): boolean {
  const m = settingsStore.current.mascot;
  return !!(m.enabled && m.pet && (m.petTabs ?? []).includes("askclaude"));
}

/** Pourquoi le micro ne s'est pas ouvert (discrétion). */
function blockedText(why: string | undefined): string {
  switch (why) {
    case "call":
      return "Le micro est déjà utilisé par une autre appli : Ondine reste discrète.";
    case "presentation":
      return "Présentation en cours : Ondine reste discrète.";
    default:
      return "Concentration en cours : Ondine reste discrète.";
  }
}

/** Ce que vous avez dit arrive : envoyé comme un message tapé (ou joint à l'image de « Regarde ça »). */
async function heard(api: ModuleApi, text: string, look: boolean) {
  state.draft = text;
  if (look) {
    // L'image de la fenêtre est montrée : rien ne part sans votre clic.
    await attach(api, { look: true });
    return;
  }
  state.spoken = true;
  await send(api);
}

/**
 * Écoute les nouvelles de la voix. `owner` : cette fenêtre s'en occupe
 * (ouvrir l'onglet, la mascotte, envoyer) ; l'autre ne fait que suivre.
 */
function wireVoice(api: ModuleApi, owner: () => boolean) {
  let listenTimer = 0;
  return api.on("askclaude.voice", (msg) => {
    const p = (msg.payload ?? {}) as VoiceMsg;
    const v = state.voice;
    const mine = owner();
    switch (p.kind) {
      case "open":
        reveal?.stop();
        state.voice = { on: true, look: !!p.look, hold: !!p.hold, partial: "", transcribing: false, note: "" };
        state.error = "";
        if (mine) {
          api.openIsland("askclaude");
          // Surprise au début, puis elle tend l'oreille.
          api.emit("mascot.emote", { emotion: "surprised" });
          window.clearTimeout(listenTimer);
          listenTimer = window.setTimeout(() => state.voice.on && api.emit("mascot.emote", { emotion: "listening" }), 700);
        }
        break;
      case "partial":
        v.partial = p.text ?? "";
        break;
      case "transcribing":
        v.transcribing = true;
        break;
      case "final":
        state.voice = { ...v, on: false, transcribing: false, partial: "" };
        if (mine && p.text) void heard(api, p.text, !!p.look);
        break;
      case "empty":
        state.voice = { ...v, on: false, transcribing: false, partial: "", note: "Je n'ai rien entendu." };
        break;
      case "cancel":
        state.voice = { ...v, on: false, transcribing: false, partial: "" };
        break;
      case "blocked":
        v.note = blockedText(p.why);
        if (mine) api.notify({ title: v.note, icon: "🤫", priority: "low", key: "askclaude-voice" });
        break;
      case "error":
        state.voice = { ...v, on: false, transcribing: false, partial: "" };
        state.error = p.message ?? "écoute impossible";
        if (mine) api.notify({ title: state.error, icon: "🎙️", priority: "normal", key: "askclaude-voice" });
        break;
    }
    redraw();
  });
}

/** Votre réponse à une demande d'accord : l'échange reprend. */
async function confirm(api: ModuleApi, ok: boolean) {
  const p = state.pending;
  if (!p || state.busy) return;
  state.busy = true;
  state.error = "";
  redraw();
  api.emit("mascot.emote", { emotion: "thinking" });
  try {
    receive(api, await api.invoke<Answer>("confirm", { id: p.ask.id, ok }));
  } catch (err) {
    // L'échange est perdu : votre message reste affiché, renvoyez-le si besoin.
    state.pending = null;
    state.error = errorText(err);
    api.emit("mascot.emote", { emotion: "sad" });
  } finally {
    state.busy = false;
    redraw();
  }
}

/** Une ligne de ce qu'Ondine a fait (phrases entières pour la traduction). */
function activityText(a: Activity): string {
  switch (a.kind) {
    case "search":
      if (a.count === 0) return `Recherche « ${a.query} » : aucun fichier`;
      if (a.count === 1) return `Recherche « ${a.query} » : 1 fichier`;
      return `Recherche « ${a.query} » : ${a.count} fichiers`;
    case "read":
      return `A lu « ${a.name} »`;
    case "created":
      return `A créé « ${a.name} »`;
    case "did":
      return doneText(a.what ?? "", a.value ?? "");
    case "refused-act":
      return `Refusé : ${askText(a.what ?? "", a.value ?? "")}`;
    default:
      return `Refusé : « ${a.name} »`;
  }
}

/** Une action faite sur le PC (phrases entières pour la traduction). */
function doneText(what: string, value: string): string {
  switch (what) {
    case "volume":
      return `Volume réglé à ${value} %`;
    case "mute":
      return "Son coupé";
    case "unmute":
      return "Son rétabli";
    case "brightness":
      return `Luminosité réglée à ${value} %`;
    case "dark":
      return "Mode sombre activé";
    case "light":
      return "Mode clair activé";
    case "playpause":
      return "Musique : lecture ou pause";
    case "next":
      return "Morceau suivant";
    case "previous":
      return "Morceau précédent";
    case "timer":
      return `Minuteur de ${value} min lancé`;
    case "note":
      return `Note ajoutée : « ${value} »`;
    case "app":
      return `A ouvert « ${value} »`;
    case "site":
      return `A ouvert ${value}`;
    case "search":
      return `A cherché « ${value} » sur le web`;
    case "shelf":
      return `A posé « ${value} » sur l'Étagère`;
    case "wifi-on":
      return "Wi-Fi allumé";
    case "wifi-off":
      return "Wi-Fi coupé";
    case "bluetooth-on":
      return "Bluetooth allumé";
    case "bluetooth-off":
      return "Bluetooth coupé";
    default:
      return what;
  }
}

/** Une action qui attend votre accord, à l'infinitif. */
function askText(what: string, value: string): string {
  switch (what) {
    case "app":
      return `ouvrir l'application « ${value} »`;
    case "site":
      return `ouvrir ${value}`;
    case "search":
      return `chercher « ${value} » sur le web`;
    case "shelf":
      return `poser « ${value} » sur l'Étagère`;
    case "wifi-on":
      return "allumer le Wi-Fi";
    case "wifi-off":
      return "couper le Wi-Fi";
    case "bluetooth-on":
      return "allumer le Bluetooth";
    case "bluetooth-off":
      return "couper le Bluetooth";
    default:
      return what;
  }
}

const ACTIVITY_ICONS: Record<Activity["kind"], string> = { search: "🔎", read: "📖", created: "✏️", refused: "🚫", did: "⚡", "refused-act": "🚫" };

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

  // La voix : l'île s'en occupe, sauf si Ondine est sur le bureau avec cet onglet.
  setup(api) {
    return wireVoice(api, () => !petHandles());
  },

  satellite(api) {
    return wireVoice(api, petHandles);
  },

  views: {
    drop: dropTargets,

    expanded(root, api) {
      // data-island-fit : l'île grandit avec la conversation, jusqu'à sa taille
      // maximale (fit.ts), sauf si le réglage « autoGrow » est coupé.
      const box = el("div", { class: "ask" });
      root.append(box);
      let list: HTMLElement | null = null;

      const activityList = (items: Activity[]): HTMLElement =>
        el(
          "ul",
          { class: "ask-activity" },
          ...items.map((a) => el("li", {}, el("span", { "aria-hidden": "true" }, ACTIVITY_ICONS[a.kind]), el("span", {}, activityText(a)))),
        );

      // Une carte de fichier : rien ne s'ouvre sans votre clic (un programme n'est jamais lancé).
      const fileCard = (c: Card): HTMLElement =>
        el(
          "div",
          { class: "ask-file" },
          el("span", { class: "ask-file-icon", "aria-hidden": "true" }, c.cree ? "✨" : "📄"),
          el(
            "div",
            { class: "ask-file-text" },
            el("b", { "data-no-i18n": "" }, c.nom),
            el("small", { class: "muted", "data-no-i18n": "" }, [c.dossier, c.taille].filter(Boolean).join(" · ")),
          ),
          el("button", { class: "btn small", onclick: api.handler(() => api.invoke("open_card", { numero: c.numero, how: "open" })) }, "Ouvrir"),
          el(
            "button",
            { class: "btn small", title: "Montrer dans l'Explorateur", "aria-label": "Montrer dans l'Explorateur", onclick: api.handler(() => api.invoke("open_card", { numero: c.numero, how: "reveal" })) },
            "📂",
          ),
        );

      // La demande d'accord : tout ce qui partira (lire) ou sera écrit (créer).
      const askCard = (p: { ask: Ask; activity: Activity[] }): HTMLElement => {
        const a = p.ask;
        if (a.kind === "action") {
          return el(
            "div",
            { class: "ask-bubble ondine ask-confirm fresh" },
            p.activity.length ? activityList(p.activity) : null,
            el("p", { class: "ask-confirm-title" }, `Ondine voudrait ${askText(a.what ?? "", a.value ?? "")}.`),
            a.what === "wifi-off" ? el("small", { class: "muted" }, "Sans Wi-Fi, Ondine ne pourra plus vous répondre.") : null,
            el(
              "div",
              { class: "btn-row" },
              el("button", { class: "btn small primary", disabled: state.busy, onclick: api.handler(() => confirm(api, true)) }, "Faire"),
              el("button", { class: "btn small", disabled: state.busy, onclick: api.handler(() => confirm(api, false)) }, "Annuler"),
            ),
          );
        }
        const read = a.kind === "read";
        const title = read
          ? `Ondine voudrait lire « ${a.name} » (${size(a.bytes)}). Son texte partira vers ${a.destination}.`
          : `Ondine voudrait créer « ${a.name} » (${size(a.bytes)}) dans ${a.folder}.`;
        return el(
          "div",
          { class: "ask-bubble ondine ask-confirm fresh" },
          p.activity.length ? activityList(p.activity) : null,
          el("p", { class: "ask-confirm-title" }, title),
          read ? el("small", { class: "muted" }, a.cut ? "Le début du fichier :" : "Le fichier entier :") : el("small", { class: "muted" }, "Son contenu :"),
          el("pre", { class: "ask-doc", "data-no-i18n": "" }, a.cut ? `${a.preview}…` : a.preview),
          el(
            "div",
            { class: "btn-row" },
            el("button", { class: "btn small primary", disabled: state.busy, onclick: api.handler(() => confirm(api, true)) }, read ? "Autoriser" : "Créer"),
            el("button", { class: "btn small", disabled: state.busy, onclick: api.handler(() => confirm(api, false)) }, read ? "Refuser" : "Annuler"),
          ),
        );
      };

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
        // La réponse en train de s'écrire (plops.ts) : seulement ce qui est déjà visible.
        const writing = reveal?.index === i;
        return el(
          "div",
          { class: `ask-bubble ondine${fresh}` },
          b.activity?.length ? activityList(b.activity) : null,
          b.text ? el("div", { class: "ask-bubble-text", "data-no-i18n": "", "data-reveal": writing ? String(i) : undefined }, writing ? b.text.slice(0, reveal?.shown ?? 0) : b.text) : null,
          ...(b.cards ?? []).map(fileCard),
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
        const grow = api.settings().autoGrow !== false;
        box.classList.toggle("grow", grow);
        box.toggleAttribute("data-island-fit", grow);
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
                disabled: state.busy || (state.bubbles.length === 0 && !state.attachment && !state.pending),
                onclick: api.handler(async () => {
                  await api.invoke("reset");
                  state.bubbles = [];
                  state.attachment = null;
                  state.pending = null;
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
          state.pending ? askCard(state.pending) : null,
          // Pendant l'écoute : vos mots s'écrivent en direct, avec le point rouge du micro.
          state.voice.on || state.voice.transcribing
            ? el(
                "div",
                { class: "ask-bubble me live" },
                el(
                  "div",
                  { class: "ask-live-head" },
                  el("span", { class: `ask-mic-dot${state.voice.on ? " on" : ""}`, "aria-hidden": "true" }),
                  el("small", {}, state.voice.transcribing ? "J'écris ce que vous avez dit…" : state.voice.look ? "Je regarde et j'écoute…" : "J'écoute…"),
                ),
                state.voice.partial ? el("div", { class: "ask-bubble-text", "data-no-i18n": "" }, state.voice.partial) : null,
                state.voice.on ? el("small", { class: "muted" }, state.voice.hold ? "Relâchez les touches quand vous avez fini · Échap pour annuler" : "Parlez, je m'arrête quand vous vous taisez · Échap pour annuler") : null,
              )
            : null,
          state.busy ? el("div", { class: "ask-bubble ondine typing fresh", "aria-label": `${who} réfléchit…` }, el("span", {}), el("span", {}), el("span", {})) : null,
        );
        parts.push(list);

        if (state.error) parts.push(el("p", { class: "ask-error" }, `⚠️ ${state.error}`));
        if (state.voice.note && !state.voice.on) parts.push(el("p", { class: "ask-voice-note muted" }, state.voice.note));

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
              // Sans clé, les commandes rapides marchent quand même (sinon le Rust dit qu'il manque la clé).
              { class: `btn small primary ${state.busy ? "thinking" : ""}`, disabled: state.busy || !!state.pending, onclick: api.handler(() => send(api)) },
              state.busy ? "Ondine réfléchit…" : state.pending ? "Répondez d'abord à Ondine" : "Envoyer",
            ),
            // Le micro : un clic écoute (arrêt au silence), un 2e termine.
            el(
              "button",
              {
                class: `btn small ask-mic-btn${state.voice.on ? " on" : ""}`,
                title: "Parler à Ondine à voix haute",
                "aria-label": "Parler à Ondine à voix haute",
                "aria-pressed": state.voice.on ? "true" : "false",
                disabled: (state.busy || !!state.pending) && !state.voice.on,
                onclick: api.handler(async () => {
                  try {
                    if (state.voice.on) await api.invoke("voice_stop", { cancel: false });
                    else await api.invoke("listen", {});
                  } catch (err) {
                    state.error = errorText(err);
                    redraw();
                  }
                }),
              },
              state.voice.on ? "⏹ Terminer" : "🎙️ Parler",
            ),
            el("button", { class: "btn small", disabled: state.busy, onclick: pick }, "📎 Joindre un fichier…"),
          ),
        );

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
