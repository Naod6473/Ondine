// L'assistant de premier lancement : Ondine se présente et configure l'île.
//
// Il se déroule DANS l'île (pas dans une fenêtre) : une alerte qui reste
// (notification « high », sticky) dont le contenu est le panneau de
// l'assistant (src/island/setup-panel.ts). Cinq petites étapes, chacune peut
// être passée ; × ou Échap passent tout :
//   1. « Bonjour, je suis Ondine. Et vous ? » : le prénom, la langue, Vous / Tu ;
//      ou « Reprendre la configuration de mon autre PC » (import d'un fichier
//      de réglages exporté, comme Réglages → Sauvegarde) ;
//   2. « Vous faites quoi sur ce PC ? » : des cartes (setup-plan.ts) qui
//      allument leurs onglets et les rangent ; le reste s'éteint (on le
//      rallume dans Réglages → Onglets). Pré-cochées d'après les logiciels
//      installés, lus sur le PC sans rien envoyer (apps_detect) ; plusieurs
//      cartes = un profil par carte (Réglages → Profils). Aucune carte : une
//      île minimale de 3 onglets, qui s'enrichit avec les propositions
//      (suggestions.ts) ;
//   3. la mascotte (le carrousel animé de « Quoi de neuf ») ;
//   4. où vit l'île (haut, bas, côtés) et le style des icônes : en direct ;
//   5. la clé de l'API pour Parler à Ondine, maintenant ou plus tard (elle va
//      dans le Gestionnaire d'identifiants de Windows, jamais dans les réglages).
// Puis « C'est prêt, Simon ! » et « Ouvrir l'île ».
//
// Montré une fois au premier démarrage (general.welcomed faux), à la place de
// l'ancien mot de bienvenue ; une installation qui l'a déjà vu ne le revoit
// pas, mais Réglages → Général → « Refaire l'assistant » le relance (sujet
// « app.setup » du bus). Mode démo (scène « Premier lancement ») : le même
// panneau, mais rien n'est enregistré.

import { Bridge, IS_TAURI } from "./bridge";
import type { Bus } from "./bus";
import { currentLang, t } from "./i18n";
import { errorText, logger } from "./log";
import type { NotificationQueue } from "./notifications";
import { settingsStore } from "./settings-store";
import { cardsFromApps, cleanFirstName, dayNumber, planFromCards, profilesFromCards } from "./setup-plan";
import type { Settings } from "./types";
import { ALL_MODULES } from "../modules";
import { mountSetupPanel } from "../island/setup-panel";

const log = logger("setup");

/** Les étapes, dans l'ordre ; « done » = « C'est prêt ». */
export const SETUP_STEPS = ["hello", "cards", "mascot", "place", "key", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Le nom du coffre de la clé de Claude (comme askclaude_providers.rs). */
const CLAUDE_KEY = "anthropic-api-key";
/** Au plus 10 profils (comme profiles.rs). */
const MAX_PROFILES = 10;

/** Ce que l'assistant retient pendant qu'il tourne (il survit à un redessin de l'île). */
export interface SetupState {
  step: number;
  name: string;
  lang: string;
  address: "vous" | "tu";
  /** Les cartes cochées, dans l'ordre où on les a cochées. */
  cards: string[];
  /** Les cartes pré-cochées d'après les logiciels du PC (null = pas encore lu). */
  detected: string[] | null;
  /** Une carte a été touchée à la main : la détection n'y change plus rien. */
  touched: boolean;
  /** Mode démo : rien n'est enregistré. */
  preview: boolean;
  /** « Reprendre la configuration de mon autre PC » a marché. */
  imported: boolean;
  /** Une clé est déjà dans le coffre (ou vient d'y être mise). */
  keySaved: boolean;
  finished: boolean;
}

/** Ce que le panneau peut demander (il ne touche jamais les réglages lui-même). */
export interface SetupController {
  state: SetupState;
  /** Les onglets connus (modules avec une vue « expanded »), dans l'ordre d'origine. */
  tabs: { id: string; name: string; icon: string }[];
  /** Les onglets allumés en ce moment (pour le bilan de la fin). */
  shownTabs(): string[];
  /** Le panneau se redessine quand l'état change de l'extérieur (détection finie). */
  onChange(fn: () => void): () => void;
  setLang(lang: string): void;
  setAddress(a: "vous" | "tu"): void;
  toggleCard(id: string): void;
  setEdge(edge: Settings["island"]["edge"]): void;
  setIcons(pack: Settings["island"]["iconPack"]): void;
  /** Étape suivante ; `apply` = enregistrer ce qu'elle a choisi (false : « Passer »). */
  next(apply: boolean): void;
  back(): void;
  importOther(): Promise<string | null>;
  saveKey(key: string): Promise<string | null>;
  finish(openIsland: boolean): void;
  emote(emotion: string): void;
}

let current: { state: SetupState; id: number; listeners: Set<() => void> } | null = null;

/** Les modules qui ont un onglet. */
function tabModules() {
  return ALL_MODULES.filter((m) => !!m.views?.expanded).map((m) => ({ id: m.manifest.id, name: m.manifest.name, icon: m.manifest.icon }));
}

/**
 * À appeler au démarrage de l'île. `firstRun` : vraie appli, réglages lus et
 * jamais accueilli (general.welcomed faux), hors mode démo.
 */
export function startSetup(bus: Bus, notifications: NotificationQueue, firstRun: boolean) {
  bus.on("app.setup", () => openSetup(bus, notifications, settingsStore.current.general.demo === true || !IS_TAURI));
  if (firstRun) openSetup(bus, notifications, false);
}

function openSetup(bus: Bus, notifications: NotificationQueue, preview: boolean) {
  const g = settingsStore.current.general;
  if (current && !current.state.finished) {
    // Déjà ouvert : on le remontre où il en était.
    notifications.dismiss(current.id);
  }
  const state: SetupState = {
    step: 0,
    name: g.firstName ?? "",
    lang: currentLang(),
    address: g.address === "tu" ? "tu" : "vous",
    cards: [],
    detected: null,
    touched: false,
    preview,
    imported: false,
    keySaved: false,
    finished: false,
  };
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((fn) => fn());
  const write = (change: (d: Settings) => void) => {
    if (!state.preview) void settingsStore.update(change);
  };
  const tabs = tabModules();

  const ctrl: SetupController = {
    state,
    tabs,
    shownTabs: () => tabs.map((t) => t.id).filter((id) => settingsStore.moduleEnabled(id)),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setLang(lang) {
      state.lang = lang;
      write((d) => (d.general.language = lang === "en" ? "en" : "fr"));
    },
    setAddress(a) {
      state.address = a;
      write((d) => (d.general.address = a));
    },
    toggleCard(id) {
      state.touched = true;
      state.cards = state.cards.includes(id) ? state.cards.filter((c) => c !== id) : [...state.cards, id];
    },
    setEdge(edge) {
      write((d) => {
        d.island.edge = edge;
        d.island.align = "center";
        d.island.offset = 0.5;
      });
    },
    setIcons(pack) {
      write((d) => (d.island.iconPack = pack));
    },
    next(apply) {
      const step = SETUP_STEPS[state.step];
      if (apply && step === "hello") {
        const name = cleanFirstName(state.name);
        state.name = name;
        write((d) => (d.general.firstName = name));
      }
      if (apply && step === "cards") applyCards(state, write);
      state.step = Math.min(state.step + 1, SETUP_STEPS.length - 1);
      if (SETUP_STEPS[state.step] === "done") markWelcomed(state);
    },
    back() {
      state.step = Math.max(0, state.step - 1);
    },
    async importOther() {
      if (state.preview) return "Pas en mode démo.";
      try {
        const done = await Bridge.settingsImportPick(t("Choisir un fichier de réglages exporté"));
        if (!done) return null;
        state.imported = true;
        state.name = settingsStore.current.general.firstName ?? "";
        state.step = SETUP_STEPS.indexOf("done");
        markWelcomed(state);
        log.info("assistant : configuration reprise d'un autre PC");
        return null;
      } catch (err) {
        return `Import refusé : ${errorText(err)}`;
      }
    },
    async saveKey(key) {
      const k = key.trim();
      if (!k) return "Collez d'abord la clé.";
      if (k.length > 300 || /\s/.test(k)) return "Ce n'est pas une clé : elle tient sur une ligne, sans espace.";
      if (state.preview) return "Pas en mode démo.";
      try {
        await Bridge.credentialSet(CLAUDE_KEY, k);
        state.keySaved = true;
        return null;
      } catch (err) {
        return errorText(err);
      }
    },
    finish(openIsland) {
      finish(state, notifications);
      if (openIsland) window.setTimeout(() => bus.emit("island.open", { tab: ctrl.shownTabs()[0] }, "island"), 250);
    },
    emote(emotion) {
      bus.emit("mascot.emote", { emotion }, "setup");
    },
  };

  // Les logiciels installés : lus sur le PC (rien n'est envoyé), pour pré-cocher les cartes.
  const apps = state.preview ? Promise.resolve(["vscode", "claude", "spotify"]) : Bridge.appsDetect();
  void apps
    .then((found) => {
      state.detected = cardsFromApps(found ?? []);
      if (!state.touched) state.cards = [...state.detected];
      changed();
    })
    .catch((err) => log.warn(`logiciels non lus : ${errorText(err)}`));
  if (!state.preview) void Bridge.credentialExists(CLAUDE_KEY).then((yes) => (state.keySaved = !!yes));

  const id = notifications.push({
    moduleId: "island",
    title: "Bonjour, je suis Ondine 👋",
    icon: "💧",
    priority: "high",
    sticky: true,
    key: "setup",
    content: (host) => mountSetupPanel(host, ctrl),
    // × ou Échap : on passe tout ce qui reste.
    onDismiss: () => finish(state, notifications),
  });
  current = { state, id, listeners };
  bus.emit("mascot.emote", { emotion: "wave" }, "setup");
}

/** Les cartes choisies : onglets allumés et rangés, le reste éteint ; un profil par carte s'il y en a plusieurs. */
function applyCards(state: SetupState, write: (change: (d: Settings) => void) => void) {
  const tabIds = tabModules().map((t) => t.id);
  const plan = planFromCards(state.cards, tabIds);
  write((d) => {
    for (const [id, on] of Object.entries(plan.modules)) {
      d.modules[id] = { enabled: on, values: d.modules[id]?.values ?? {} };
    }
    d.island.tabOrder = plan.order;
    const profiles = (d.profiles ??= { list: [], active: "", auto: false, base: {} });
    const extra = profilesFromCards(state.cards, tabIds, profiles.list.map((p) => p.name));
    const stamp = Date.now();
    extra.slice(0, Math.max(0, MAX_PROFILES - profiles.list.length)).forEach((p, i) => {
      profiles.list.push({
        id: `p${(stamp + i).toString(36)}`,
        // Le nom dans la langue de l'interface (« Travail », « Work »).
        name: t(p.name),
        values: { modules: p.modules, tabOrder: p.tabOrder },
        rule: { kind: "none", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", ssid: "" },
      });
    });
  });
}

/** L'accueil est fait : plus d'assistant au démarrage, et le compte des onglets commence. */
function markWelcomed(state: SetupState) {
  if (state.preview) return;
  const today = dayNumber(Date.now());
  void settingsStore.update((d) => {
    d.general.welcomed = true;
    if (!d.island.usageSince) d.island.usageSince = today;
  });
}

function finish(state: SetupState, notifications: NotificationQueue) {
  if (state.finished) return;
  state.finished = true;
  markWelcomed(state);
  if (current?.state === state) {
    const id = current.id;
    current = null;
    notifications.dismiss(id);
  }
}
