// La fenêtre de réglages. Tout y est généré : les réglages des modules à partir
// de leurs manifestes, la liste des mascottes à partir du dossier mascots/.
//
// Disposition (1.2.4, deux colonnes, logique dans nav-logic.ts) :
//   - 1re colonne, en verre : une recherche, les sept rubriques fixes (Ondine,
//     Voix, L'île, Automatiser, Modules, Système, À propos, voir layout.ts),
//     et en bas Simple / Complet et la pastille d'état. Rien ne s'y déplie ;
//   - 2e colonne, en verre : les pages de la rubrique ; les sous-menus de la
//     page affichée (`subs`) se déplient sous elle, et la page n'affiche que
//     le sous-menu choisi. Dans « Modules », les modules sont rangés sous les
//     titres de leur catégorie (MODULE_CATEGORIES). Une pastille en verre
//     glisse sous la ligne choisie, dans chaque colonne (glass-pill.ts) ;
//   - à droite, la page : un fil d'Ariane, la bande vivante (hero.ts), puis
//     des blocs de lignes (controls.ts). Fenêtre étroite : la 2e colonne
//     devient une bande de pages au-dessus de la page (settings-nav.css).
//
// Chaque changement est appliqué tout de suite et enregistré par le Rust, qui
// prévient l'île (événement "settings-changed"). Il peut être annulé (bulle
// « Annuler », Ctrl+Z : undo.ts) ; un réglage différent de sa valeur d'origine
// porte la pastille « Modifié » (modified.ts). Retour arrière : bouton retour
// de la souris, Alt+← et Alt+→ (nav-history.ts).

import { Bridge, IS_TAURI, windowLabel } from "../core/bridge";
import { Bus } from "../core/bus";
import { errorText } from "../core/log";
import type { ModuleManifest, SettingField } from "../core/module-types";
import { settingsStore } from "../core/settings-store";
import { applyTabOrder, mergeOrder } from "../core/tab-order";
import { cleanFirstName } from "../core/setup-plan";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import { icon as iconNode } from "../island/icon";
import { sounds, setSoundPrefs } from "../island/sounds";
import { jellyButtons, setStudio, staggerIn, watchContent } from "../island/motion";
import { reducedMotion } from "../island/tab-pill";
import { THEMES, themeFor } from "../island/themes";
import { haloPreview } from "../island/halo";
import { mascotCatalog } from "../mascot/catalog";
import { colorWheel } from "./color-wheel";
import { found, TREASURES } from "../eggs/treasures";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { ALL_MODULES } from "../modules";
import { chip, choice, group, inSub, row, segmented, stepper, toggle, wideRow } from "./controls";
import { settingsRows } from "./form";
import { GlassPill, still } from "./glass-pill";
import { close as closeGlassSelect, upgradeSelects } from "./glass-select";
import { column2, crumbs, direction, IOS_EASE, pageForRubric, RUBRIC_ICONS, rubricCounts, type NavPage, type NavPlace } from "./nav-logic";
import { NavHistory } from "./nav-history";
import { applyPatchInPlace, typingTarget, UndoStack, type UndoEntry } from "./undo";
import { activePreset, animationPresets, LOOK_PRESETS, type PresetSet, type PresetTarget } from "./presets";
import { getPath, islandDefault, islandRowModified, isModified, ISLAND_PATHS, setPath } from "./modified";
import { edgeArt, iconPackArt, sizeArt, styleArt, themeArt, vignettes } from "./vignettes";
import { startI18n } from "../core/i18n";
import { connectRules, rulesSection } from "./rules-editor";
import { profilesPage, profileSubs } from "./profiles-page";
import { mascotPodium, type Podium } from "./podium";
import { aboutGroup } from "./about";
import { askclaudeGroups } from "./askclaude-page";
import { winnotifsGroup } from "./winnotifs-group";
import { dropPillsGroup } from "./drop-pills-group";
import { customSoundRows } from "./sounds-page";
import { perfGroup } from "./perf-group";
import { phonesPage } from "./phone-certificate";
import { startPerf } from "../core/perf";
import { applyMode, hiddenByMode, modeSwitch } from "./mode";
import { isHidden, modeOf, moduleEssentialKeys, pageEssentials, WHOLE_PAGE, type SettingsMode } from "./visibility";
import { SCENE_IDS, SCENES } from "../island/scenes/scene-rules";
import { allKey, ANIMATION_SUBS, FORMER_NAMES, MODULE_CATEGORIES, MODULES_ELSEWHERE, MOVED_FIELDS, NAV_GROUPS, resolvePlace, type NavGroup } from "./layout";
import { hero } from "./hero";
import { castFor, pageColor } from "./hero-theme";
import { VOICE_ICONS, VOICE_PAGES, type VoicePage } from "./voice/pages";
import { applyBackdrop, backdropChoice, navStatus } from "./frame";
import { statusLine } from "./frame-logic";

const PERMISSION_LABELS: Record<string, string> = {
  files: "Fichiers",
  clipboard: "Presse-papiers",
  network: "Réseau",
  "claude-api": "Envoie à une API d'IA",
  credentials: "Identifiants",
};

/**
 * Un sous-menu d'une page longue. `noI18n` : un nom choisi par l'utilisateur
 * (un profil). `module` : le sous-menu est la section d'un module (point
 * « désactivé » dans la barre quand il est éteint).
 */
interface Sub {
  id: string;
  label: string;
  noI18n?: boolean;
  module?: string;
}

/** Une page de la barre latérale. */
interface Page {
  id: string;
  group: NavGroup;
  icon: string;
  label: string;
  /** Une ligne sous le titre de la page. */
  sub: string;
  /** Mots trouvés par la recherche (les libellés de la page). */
  keywords: string[];
  render: (main: HTMLElement) => void;
  /**
   * Mode Simple : les clés (`data-key`) des lignes essentielles, ou WHOLE_PAGE.
   * Absent : d'après l'id de la page (visibility.ts, ISLAND_ESSENTIALS).
   */
  essentials?: string[] | typeof WHOLE_PAGE;
  /**
   * Les sous-menus (dans la barre, sous la page). Le rendu range chaque bloc
   * dans l'un d'eux (`inSub`, attribut `data-sub`) ; showPage ne garde que
   * celui qui est choisi. Absent : la page est d'un seul tenant.
   */
  subs?: () => Sub[];
  /** Modules : leur catégorie dans la barre (MODULE_CATEGORIES). */
  category?: string;
  /** Le module dont la page suit l'interrupteur (point « désactivé » dans la barre). */
  module?: string;
  /** La couleur de sa bande (sinon : hero-theme.ts, d'après le groupe ou la catégorie). */
  color?: string;
  /** Les boutons principaux, dans la bande du haut. */
  actions?: () => HTMLElement[];
  /** Les mascottes de sa bande (sinon : castFor, hero-theme.ts). */
  cast?: string[];
  /** Une page du groupe Voix (VOICE_PAGES) : elle dessine elle-même sa bande. */
  voice?: VoicePage;
}

function categoryOf(moduleId: string): string {
  return MODULE_CATEGORIES.find((c) => c.modules.includes(moduleId))?.id ?? "other";
}

/**
 * Les sous-menus des pages de modules longues, par clé de champ du manifeste.
 * Le premier reçoit aussi le bloc du haut (Activé, Permissions, À propos) et
 * les champs qui ne sont listés nulle part (un champ ajouté plus tard).
 */
const MODULE_SECTIONS: Record<string, { id: string; label: string; keys: string[] }[]> = {
  agents: [
    { id: "general", label: "Général", keys: ["projects", "claudeIn"] },
    {
      id: "tools",
      label: "Outils proposés",
      keys: ["launchClaude", "launchCodex", "launchGemini", "launchCopilot", "launchCursor", "launchQwen", "launchGoose", "launchOpencode", "launchKiro", "launchHermes", "launchAider", "launchAmp", "otherTool"],
    },
    { id: "notify", label: "Notifications", keys: ["notifyWaiting", "notifyDone", "remindWaiting", "quietWhenWatching", "showChanges", "liveFiles", "taskProgress", "doneSummary", "resumePreview", "mascot"] },
    { id: "perms", label: "Autorisations et MCP", keys: ["mcp", "permissions", "permissionWait"] },
    { id: "tokens", label: "Jetons et budget", keys: ["usage", "planLimits", "prices", "dailyBudget"] },
    { id: "github", label: "GitHub", keys: ["githubLogin", "githubToken"] },
  ],
  askclaude: [
    { id: "general", label: "Général", keys: [] },
    { id: "models", label: "Fournisseur et modèles", keys: ["provider", "model", "openaiModel", "geminiModel", "localUrl", "localModel", "openrouterModel", "maxTokens"] },
    { id: "persona", label: "Personnalité et affichage", keys: ["personality", "autoGrow", "emotions"] },
    { id: "voice", label: "Voix et sons", keys: ["micDevice", "voiceHotkey", "micMode", "voiceEngine", "lookHotkey", "wakeWord", "handsFree", "quickCommands", "plops", "plopVolume", "discreet"] },
    { id: "files", label: "Fichiers et PC", keys: ["fileTools", "pcTools", "filesFolder"] },
  ],
  // Équipe (réseau local).
  team: [
    { id: "general", label: "Général", keys: ["visible", "name", "visits", "autoStatus"] },
    { id: "files", label: "Fichiers et IT", keys: ["maxMb", "shareInventory"] },
    { id: "mine", label: "Entre mes PC", keys: ["clipboardSync", "mascotSync"] },
    { id: "chat", label: "Chat", keys: ["chatReceipts", "chatKeep"] },
  ],
};

/**
 * Des champs de manifeste que la page du module dessine elle-même (pas de
 * ligne générée) : le micro et le mot d'appel de Parler à Ondine
 * (askclaude-page.ts, 1.2.4).
 */
const PAGE_DRAWN: Record<string, string[]> = { askclaude: ["micDevice", "wakeWord"] };

/**
 * Des mots de la recherche qui ne sont pas le libellé d'une ligne : la ligne où
 * ils mènent (sa clé `data-key`).
 */
const SEARCH_ALIASES: Record<string, string> = {
  Language: "Langue",
  Tutoiement: "S'adresser à moi",
  Vouvoiement: "S'adresser à moi",
  "Couleur de l'île": "Thème",
  Icônes: "Style des icônes",
  Animations: "Style des animations",
  Studio: "Style des animations",
  "Couleur personnalisée de la mascotte": "Roue de couleur",
  "Faire venir Ondine": "Essayer",
};

// ── Les pages (rangement : layout.ts) ─────────────────────────────────────────

/** Le manifeste d'un module (undefined s'il n'existe pas). */
function manifestOf(id: string): ModuleManifest | undefined {
  return ALL_MODULES.find((m) => m.manifest.id === id)?.manifest;
}

/** Les libellés des champs d'un module (pour la recherche), sauf ceux affichés sur une autre page. */
function fieldLabels(id: string): string[] {
  const moved = MOVED_FIELDS[id]?.keys ?? [];
  return (manifestOf(id)?.settings?.fields ?? []).filter((f) => !moved.includes(f.key)).map((f) => f.label);
}

/** Les libellés des champs de la page Animations et halos (tous modules confondus). */
function animationLabels(): string[] {
  return ANIMATION_SUBS.flatMap((s) => s.blocks.flatMap((b) => b.keys.map((k) => manifestOf(b.module)?.settings?.fields.find((f) => f.key === k)?.label ?? ""))).filter(Boolean);
}

/** Mode Simple, page Animations et halos : les trois réglages du halo et chaque « Tout ». */
function animationEssentials(): string[] {
  const halos = manifestOf("halos")?.settings?.fields ?? [];
  return [...moduleEssentialKeys("halos", halos).filter((k) => k !== "Activé"), ...ANIMATION_SUBS.map((s) => allKey(s.id))];
}

/** Mode Simple, page Comportement : l'île, puis l'interrupteur et l'essentiel d'« Ondine et les fenêtres ». */
function behaviorEssentials(): string[] {
  const own = pageEssentials("behavior");
  return [...(own === WHOLE_PAGE ? [] : own), ...moduleEssentialKeys("windowlife", manifestOf("windowlife")?.settings?.fields ?? []).filter((k) => k !== "Permissions" && k !== "À propos")];
}

const ONDINE_PAGES: Page[] = [
  {
    id: "general",
    group: "Ondine",
    icon: "⚙️",
    label: "Général",
    sub: "Votre prénom, la langue et le démarrage avec Windows.",
    keywords: ["Langue", "Language", "Lancer avec Windows", "S'adresser à moi", "Tutoiement", "Vouvoiement", "Prénom", "Premiers pas", "Refaire l'assistant"],
    render: general,
  },
  {
    id: "mascot",
    group: "Ondine",
    icon: "💧",
    label: "Mascotte",
    sub: "Qui vit dans l'île, et quand elle s'ennuie ou s'endort.",
    keywords: ["Afficher la mascotte", "Mascotte", "Taille", "Couleur", "Roue de couleur", "Couleur personnalisée de la mascotte", "Mains", "Sur la tête", "Lunettes", "Au cou", "S'ennuie après", "S'endort après", "Calme : moins de gestes spontanés", "Ondine vient pendre au bord", "Au plus une visite toutes les", "Faire venir Ondine", "Surprises cachées", "Le goûter d'Ondine", "Carnet des trésors", "Tester les animations", "Ondine vit sur le bureau", "Au-dessus des fenêtres", "Raccourci pour ouvrir sa bulle", "Elle se promène quand vous ne touchez plus au PC", "Double-clic sur Ondine"],
    render: mascot,
    actions: () => [el("button", { class: "btn primary", onclick: () => bus.emit("mascot.peek-now", null, "settings") }, "Faire venir Ondine")],
    subs: () => [
      { id: "look", label: "Apparence" },
      { id: "mood", label: "Humeur" },
      { id: "desk", label: "Sur le bureau" },
      { id: "bubble", label: "Bulle du bureau" },
      { id: "peek", label: "Visites au bord" },
      { id: "eggs", label: "Surprises" },
      { id: "anim", label: "Tester les animations" },
    ],
  },
  // « Parler à Ondine » (module askclaude) : ajoutée ici par modulePages.
];

const ISLAND_PAGES: Page[] = [
  {
    id: "look",
    group: "L'île",
    icon: "🎨",
    label: "Apparence",
    sub: "La couleur de l'île, ses icônes, son élasticité et ses petits sons.",
    keywords: ["Thème", "Givre", "Verre clair", "Icônes", "Style des icônes", "Animations", "Style des animations", "Studio", "Élasticité de l'île", "Halo autour de l'île", "Couleur de l'île", "Taille de la mini-île", "Nano", "Style de l'île", "Bouche d'Ondine", "Couleur personnalisée", "Sons de clic", "Volume des sons", "Fond des Réglages", "Noir profond", "Dégradés"],
    render: look,
  },
  {
    id: "behavior",
    group: "L'île",
    icon: "🪟",
    label: "Comportement",
    sub: "Où vit l'île, quand elle se replie, et comment Ondine vit avec vos fenêtres.",
    keywords: ["Sur quel écran ?", "Reflet sur les autres écrans", "Toujours en mini", "Replier l'île", "Durée des notifications", "Raccourci pour ouvrir l'île", "Bord de l'écran", "Ondine évite la fenêtre de réglages", "Mode présentation", ...fieldLabels("windowlife")],
    render: behavior,
    essentials: behaviorEssentials(),
    subs: () => [
      { id: "island", label: "Comportement de l'île" },
      { id: "windows", label: "Ondine et les fenêtres", module: "windowlife" },
    ],
  },
  {
    id: "animations",
    group: "L'île",
    icon: "🌈",
    label: "Animations et halos",
    sub: "Le halo autour de l'île, le liquide à l'intérieur, et les moments qui les allument.",
    keywords: [manifestOf("halos")?.description ?? "", ...animationLabels()],
    render: animations,
    essentials: animationEssentials(),
    module: "halos",
    subs: () => ANIMATION_SUBS.map(({ id, label }) => ({ id, label })),
  },
  {
    id: "tabs",
    group: "L'île",
    icon: "🗂️",
    label: "Onglets",
    sub: "Les modules actifs et l'ordre de leurs onglets dans l'île.",
    keywords: ["Ordre des onglets", "Activer un module", "Désactiver un module", "Ordre d'origine", "Astuces à la première ouverture d'un onglet", "Revoir les astuces", "Propositions d'Ondine", "Revoir les propositions"],
    render: tabs,
    subs: () => [
      { id: "order", label: "Ordre des onglets" },
      ...(ALL_MODULES.some((m) => !m.views?.expanded) ? [{ id: "notab", label: "Modules sans onglet" }] : []),
      { id: "tips", label: "Astuces" },
      { id: "suggest", label: "Propositions" },
    ],
  },
];

const AUTOMATE_PAGES: Page[] = [
  {
    id: "rules",
    group: "Automatiser",
    icon: "⚡",
    label: "Règles",
    sub: "Quand quelque chose arrive, l'île agit pour vous.",
    keywords: ["Règles automatiques", "Raccourci clavier", "Surveiller un dossier", "Clé USB", "Modèles de règles"],
    // Le module « Règles » n'a pas de page à part : son interrupteur est ici.
    render: (main) => {
      const man = manifestOf("rules");
      if (man) modulePage(main, man, true);
      rulesSection(main);
    },
  },
  {
    id: "profiles",
    group: "Automatiser",
    icon: "🧭",
    label: "Profils",
    sub: "Travail, Maison… : les onglets, la couleur et la mini-île d'un coup.",
    keywords: ["Profil actif", "Changer tout seul", "Nouveau profil", "Plage horaire", "Nom du Wi-Fi", "Travail", "Maison"],
    render: (main) => profilesPage(main, save),
    subs: () => profileSubs(settingsStore.current),
  },
];

const SYSTEM_PAGES: Page[] = [
  {
    id: "privacy",
    group: "Système",
    icon: "🛡️",
    label: "Confidentialité",
    sub: "Aucune télémétrie, et les outils de l'IA demandent votre accord.",
    keywords: ["Télémétrie", "Dossiers exclus", "Exclure un dossier"],
    render: privacy,
  },
  {
    id: "phones",
    group: "Système",
    icon: "📱",
    label: "Téléphones",
    sub: "Les téléphones appairés pour l'Étagère et la télécommande.",
    keywords: ["Téléphone", "Appairer", "Révoquer", "Certificat", "QR code", "Ajouter un téléphone"],
    render: phonesPage,
  },
  {
    id: "credentials",
    group: "Système",
    icon: "🔑",
    label: "Identifiants",
    sub: "Rangés dans le Gestionnaire d'identifiants Windows.",
    keywords: ["Clé API Anthropic", "Clé API OpenAI", "Clé API Gemini", "Gestionnaire d'identifiants"],
    render: credentials,
  },
  {
    id: "backup",
    group: "Système",
    icon: "💾",
    label: "Sauvegarde",
    sub: "Exporter ou importer vos réglages (jamais les clés).",
    keywords: ["Exporter les réglages", "Importer des réglages"],
    render: backup,
  },
  {
    id: "updates",
    group: "Système",
    icon: "🔄",
    label: "Mises à jour",
    sub: "Ondine vous propose les nouvelles versions, et rien ne s'installe sans votre accord.",
    keywords: ["Mises à jour automatiques", "Version installée", "Rechercher maintenant"],
    render: (main) => main.append(updatesGroup()),
  },
  {
    id: "perf",
    group: "Système",
    icon: "🔋",
    label: "Performances et journal",
    sub: "La réactivité d'Ondine, l'économie d'énergie et le journal.",
    keywords: ["Performances", "Économie d'énergie automatique sur batterie", "Mode utilisé", "Niveau du journal", "Dossier du journal"],
    render: perf,
  },
];

/**
 * La rubrique « À propos » (1.2.4 : une page de « Sécurité et système »
 * devenue rubrique). Même id de page qu'avant : les liens profonds restent bons.
 */
const ABOUT_PAGES: Page[] = [
  {
    id: "about",
    group: "À propos",
    icon: "✨",
    label: "À propos",
    sub: "La version, les nouveautés, les ressources utilisées et le mode démo.",
    keywords: ["Version", "Nouveautés", "Signaler un problème", "Ressources utilisées", "Mode démo"],
    render: (main) => main.append(inSub("ondine", aboutGroup(() => bus.emit("app.whats-new", null, "settings"))), inSub("demo", demoGroup())),
    actions: () => [el("button", { class: "btn primary", onclick: () => bus.emit("app.whats-new", null, "settings") }, "Voir les nouveautés")],
    subs: () => [
      { id: "ondine", label: "Version et nouveautés" },
      { id: "demo", label: "Captures d'écran" },
    ],
  },
];

/** La page d'un module (dans « Modules », ou ailleurs : Parler à Ondine). */
function modulePageEntry(man: ModuleManifest, pageGroup: NavGroup): Page {
  return {
    id: `module:${man.id}`,
    group: pageGroup,
    category: pageGroup === "Modules" ? categoryOf(man.id) : undefined,
    module: man.id,
    subs: MODULE_SECTIONS[man.id] ? () => MODULE_SECTIONS[man.id].map(({ id, label }) => ({ id, label })) : undefined,
    icon: man.icon,
    label: man.name,
    sub: firstSentence(man.description),
    keywords: [man.description, ...fieldLabels(man.id)],
    render: (main: HTMLElement) => modulePage(main, man),
    essentials: moduleEssentialKeys(man.id, man.settings?.fields ?? []),
  };
}

/**
 * Une page par module : par catégorie, puis dans l'ordre des onglets. Les
 * modules rangés ailleurs (MODULES_ELSEWHERE) n'y sont pas.
 */
function modulePages(): Page[] {
  const listed = ALL_MODULES.filter((m) => !MODULES_ELSEWHERE.includes(m.manifest.id));
  const rank = (id: string) => MODULE_CATEGORIES.findIndex((c) => c.id === categoryOf(id));
  const ordered = applyTabOrder(listed, (m) => m.manifest.id, settingsStore.current.island.tabOrder ?? []);
  // Tri stable : l'ordre des onglets tient dans chaque catégorie.
  ordered.sort((a, b) => rank(a.manifest.id) - rank(b.manifest.id));
  return ordered.map((m) => modulePageEntry(m.manifest, "Modules"));
}

/** « Lance Claude Code… en un clic. Un tableau… » → « Lance Claude Code… en un clic. » */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end > 0 ? text.slice(0, end + 1) : text;
}

/**
 * Les pages du groupe Voix (1.2.4, src/settings/voice/pages.ts) : chacune est
 * dessinée par son fichier, avec sa bande ; on la range seulement ici. Son
 * `render` reçoit la page affichée (pas un brouillon : elle peut s'y dessiner
 * plus tard), et ce qu'il renvoie est appelé en la quittant.
 */
const VOICE_NAV: Page[] = VOICE_PAGES.map((v) => ({
  id: v.id,
  group: "Voix",
  icon: VOICE_ICONS[v.id] ?? "🎙️",
  label: v.label,
  sub: "",
  keywords: [],
  render: () => {},
  essentials: WHOLE_PAGE,
  module: v.module,
  color: v.color,
  voice: v,
}));

/** Toutes les pages, dans l'ordre des rubriques (NAV_GROUPS, layout.ts). */
function allPages(): Page[] {
  const ask = manifestOf("askclaude");
  return [...ONDINE_PAGES, ...(ask ? [modulePageEntry(ask, "Ondine")] : []), ...VOICE_NAV, ...ISLAND_PAGES, ...AUTOMATE_PAGES, ...modulePages(), ...SYSTEM_PAGES, ...ABOUT_PAGES];
}

let bus: Bus;
let current = "general";
let query = "";
let preview: MascotRenderer | null = null;
/** Le podium des mascottes (Mascotte → Apparence), s'il est affiché. */
let podium: Podium | null = null;
/** Le sous-menu choisi de chaque page qui en a (retenu d'une ouverture à l'autre). */
let chosenSubs: Record<string, string> = {};
/** La dernière page vue dans chaque rubrique : la rubrique y ramène (retenu aussi). */
let rubricPages: Record<string, string> = {};
/** Quand on a enregistré nous-mêmes pour la dernière fois (voir `start`). */
let lastOwnSave = 0;
/** La version d'Ondine (« 1.0.0 »), dans la pastille d'état en bas de la 1re colonne. */
let appVersion = "";
/** Ce qu'a dit « Rechercher maintenant » (Mises à jour), repris par la pastille d'état. */
let updateNote: { tone: "ok" | "new" | "error"; version?: string } | null = null;
/** La bande de la page affichée : gardée quand la page se redessine (ses mascottes continuent). */
let heroKeep: { page: string; el: HTMLElement } | null = null;
/** La « page » des résultats de recherche, pour garder sa bande. */
const SEARCH_PAGE = "\u0000search";
/** De quoi arrêter la page Voix affichée (ce qu'a renvoyé son `render`). */
let voiceStop: (() => void) | null = null;
/** L'historique de navigation : bouton retour de la souris, Alt+← et Alt+→ (nav-history.ts). */
const navHistory = new NavHistory();
/** Les changements qu'on peut annuler : bulle « Annuler », Ctrl+Z (undo.ts). */
const undoStack = new UndoStack();
/** La place affichée en dernier : la suivante arrive de la droite ou de la gauche (nav-logic.ts). */
let shownPlace: NavPlace | null = null;
/** Mode Simple : les sous-menus sans rien à montrer, par page (cachés dans la 2e colonne). */
const dimmed = new Map<string, Set<string>>();

const app = document.getElementById("app")!;
/** 1re colonne : la recherche, les rubriques, Simple / Complet, la pastille d'état. */
const rail = el("nav", { class: "rail", "aria-label": "Rubriques des réglages" });
/** 2e colonne : les pages de la rubrique et les sous-menus de la page affichée. */
const col2 = el("nav", { class: "col2", "aria-label": "Pages de la rubrique" });
const content = el("main", { class: "content" });
const railPill = new GlassPill("rail-pill");
const col2Pill = new GlassPill("col2-pill");
/** La bulle « Annuler », en bas de la fenêtre. */
const undoToast = el("div", { class: "undo-toast", role: "status", "aria-live": "polite", hidden: true });

/** La petite flèche d'une page qui a des sous-menus (au trait). */
const CARET = '<svg class="col2-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

/** La page est construite : on peut changer de page (followGoto). */
let started = false;

async function start() {
  const boot = await Bridge.boot();
  appVersion = boot?.version ?? "";
  // Fond Mica de Windows 11 : la page devient transparente (voir settings.css).
  if (boot?.mica) document.documentElement.classList.add("mica");
  await settingsStore.connect(boot?.settings ?? null);
  applyBackdrop();
  await startI18n();
  await startPerf();
  bus = new Bus(windowLabel("settings"));
  await bus.connect();
  try {
    current = localStorage.getItem("settings.page") ?? current;
    localStorage.removeItem("settings.goto");
  } catch {
    // stockage indisponible : on démarre sur « Général »
  }
  try {
    chosenSubs = JSON.parse(localStorage.getItem("settings.subs") ?? "{}") ?? {};
    const kept: unknown = JSON.parse(localStorage.getItem("settings.rubrics") ?? "null");
    if (kept && typeof kept === "object") rubricPages = Object.fromEntries(Object.entries(kept).filter(([, v]) => typeof v === "string"));
    // Les catégories repliables de la barre d'avant 1.2.4 : plus rien à retenir.
    localStorage.removeItem("settings.cats");
  } catch {
    // rien de retenu : premiers sous-menus, premières pages des rubriques
  }
  // Une page retenue avant le rangement de 1.2.2 (« Animations de l'île »,
  // Général → Mises à jour…) : on ouvre sa nouvelle place (layout.ts).
  const place = resolvePlace(current, chosenSubs[current]);
  if (place.page !== current) {
    current = place.page;
    if (place.sub) chosenSubs[current] = place.sub;
  }
  if (!allPages().some((p) => p.id === current)) current = "general";

  // Section « Règles » : l'onglet de l'île peut demander d'ouvrir l'éditeur.
  connectRules(
    bus,
    () => go("rules"),
    () => {
      if (current === "rules") showPage(false);
    },
  );
  // Les réglages ont changé. Si c'est nous (un interrupteur…), la page est
  // déjà à jour : on ne la redessine pas, pour ne pas couper son animation
  // (seules les pastilles « Modifié » suivent). Si c'est ailleurs (l'île, un
  // import), on redessine, sauf pendant la saisie.
  // Les effets d'animation de l'île servent aussi ici (Classique ou Studio).
  setStudio(settingsStore.current.island.motion === "studio");
  jellyButtons(content);
  // Les chiffres qui roulent, mais pas les listes : la liste des onglets a
  // déjà son propre glisser (plus bas, dans la page « Onglets »).
  watchContent(content, { lists: false });
  settingsStore.onChange((s) => {
    setStudio(s.island.motion === "studio");
    syncNav();
    if (performance.now() - lastOwnSave < 1500) return scheduleModified();
    const t = document.activeElement as HTMLElement | null;
    const typing = !!t && typingTarget(t.tagName, t.getAttribute("type"), t.isContentEditable);
    if (!typing) showPage(false);
  });
  settingsStore.onError((error) => {
    lastOwnSave = 0;
    showPage(false);
    document.getElementById("settings-save-error")?.remove();
    const alert = el("div", { id: "settings-save-error", class: "settings-save-error", role: "alert" },
      el("strong", {}, "Réglages non enregistrés"), el("p", {}, errorText(error)),
      el("button", { type: "button", onclick: () => alert.remove() }, "Fermer"));
    app.append(alert);
  });
  // Les <select> ajoutés plus tard (l'éditeur de règles, une liste qui se
  // complète) passent aussi en menu de choix en verre (glass-select.ts).
  let upgrade = 0;
  new MutationObserver(() => {
    if (!upgrade) upgrade = requestAnimationFrame(() => ((upgrade = 0), upgradeSelects(content)));
  }).observe(content, { childList: true, subtree: true });
  wireShortcuts();
  wireTouchedRow();
  undoToast.addEventListener("pointerenter", () => window.clearTimeout(toastTimer));
  undoToast.addEventListener("pointerleave", () => hideUndoLater(2500));

  app.append(backdrop(), rail, col2, content, undoToast);
  drawRail();
  drawCol2(null);
  showPage(false);
  navHistory.visit(here());
  if (boot) document.title = `Réglages — Ondine ${boot.version}`;
}

/** Les taches de couleur floues derrière le verre (elles bougent lentement). */
function backdrop(): HTMLElement {
  return el("div", { class: "backdrop", "aria-hidden": "true" }, el("i", { class: "blob a" }), el("i", { class: "blob b" }), el("i", { class: "blob c" }));
}

/**
 * Enregistre un changement. `redraw` : la page doit se redessiner (une liste
 * qui change de longueur, par exemple) ; sinon la commande s'est déjà mise à
 * jour toute seule. Le changement peut être annulé (`undo: false` : non,
 * comme le passage Simple / Complet) ; `label` : son nom dans la bulle
 * « Annuler » (sinon, celui de la ligne qu'on vient de toucher).
 */
function save(change: (s: Settings) => void, redraw = false, opts: { undo?: boolean; label?: string } = {}) {
  lastOwnSave = performance.now();
  const before = opts.undo === false ? null : structuredClone(settingsStore.current);
  void settingsStore.update(change).then(() => {
    if (redraw) showPage(false);
  }).catch(() => { /* Le message et le retour au réglage enregistré sont gérés par onError. */ });
  // settingsStore.current a déjà la nouvelle valeur (enregistrement optimiste).
  if (before) {
    const entry = undoStack.record(before, settingsStore.current, opts.label ?? touchedLabel(), performance.now());
    if (entry) showUndo(entry, false);
  }
  scheduleModified();
}

// ── Annuler (undo.ts) ─────────────────────────────────────────────────────────

/** La dernière ligne touchée (clic, clavier) : le nom du changement dans la bulle. */
let touched: { label: string; at: number } | null = null;

function wireTouchedRow() {
  const note = (e: Event) => {
    const r = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".row[data-key], .result-control[data-key]");
    if (!r?.dataset.key) return;
    // « tout:style » (Animations et halos) : le libellé affiché, pas la clé.
    const key = r.dataset.key;
    touched = { label: key.includes(":") ? (r.querySelector(".row-label")?.textContent ?? key) : key, at: performance.now() };
  };
  for (const type of ["pointerdown", "keydown", "change"]) content.addEventListener(type, note, true);
}

/** Le nom du réglage qu'on vient de toucher (il y a moins de 15 s), ou null. */
function touchedLabel(): string | null {
  return touched && performance.now() - touched.at < 15000 ? touched.label : null;
}

let toastTimer = 0;

/** La bulle : « Thème modifié · Annuler » (ou, après Ctrl+Z, « Thème annulé · Rétablir »). */
function showUndo(entry: UndoEntry, undone: boolean) {
  const action = undone
    ? el("button", { type: "button", class: "undo-btn", onclick: () => doRedo() }, "Rétablir")
    : el("button", { type: "button", class: "undo-btn", onclick: () => doUndo() }, "Annuler");
  undoToast.replaceChildren(
    el("span", { class: "undo-text" }, entry.label ? el("b", {}, entry.label) : null, el("span", {}, entry.label ? (undone ? "annulé" : "modifié") : undone ? "Changement annulé" : "Réglage modifié")),
    action,
    el("kbd", { class: "undo-key", "data-no-i18n": "", "aria-hidden": "true" }, undone ? "Ctrl+Y" : "Ctrl+Z"),
  );
  const fresh = undoToast.hidden || undoToast.classList.contains("out");
  undoToast.hidden = false;
  undoToast.classList.remove("out");
  if (fresh && !still()) undoToast.animate([{ opacity: 0, transform: "translate(-50%, 16px) scale(.9)" }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
  hideUndoLater(5000);
}

function hideUndoLater(ms: number) {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (undoToast.contains(document.activeElement)) return hideUndoLater(2500);
    undoToast.classList.add("out");
    window.setTimeout(() => {
      if (undoToast.classList.contains("out")) undoToast.hidden = true;
    }, 220);
  }, ms);
}

/** Annule le dernier changement (Ctrl+Z, bouton « Annuler »). */
function doUndo() {
  const entry = undoStack.undo();
  if (!entry) return;
  applyPatches(entry.undo);
  showUndo(entry, true);
}

/** Refait le dernier changement annulé (Ctrl+Y, Ctrl+Maj+Z, bouton « Rétablir »). */
function doRedo() {
  const entry = undoStack.redo();
  if (!entry) return;
  applyPatches(entry.redo);
  showUndo(entry, false);
}

/** Remet des champs (sans passer par save : un « Annuler » ne s'annule pas lui-même). */
function applyPatches(patches: UndoEntry["undo"]) {
  lastOwnSave = performance.now();
  void settingsStore.update((d) => applyPatchInPlace(d as unknown as Record<string, unknown>, patches)).catch(() => { /* onError s'en charge */ });
  showPage(false);
}

// ── Raccourcis : recherche, annuler, retour arrière ─────────────────────────

function wireShortcuts() {
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && typingTarget(t.tagName, t.getAttribute("type"), t.isContentEditable);
    const k = e.key.toLowerCase();
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    // Ctrl+K partout, « / » hors d'un champ de texte : la recherche.
    if ((ctrl && k === "k") || (e.key === "/" && !typing && !e.ctrlKey && !e.altKey && !e.metaKey)) {
      e.preventDefault();
      focusSearch();
      return;
    }
    // Ctrl+Z dans un champ de texte annule la frappe : on n'y touche pas.
    if (ctrl && !typing && k === "z" && !e.shiftKey) {
      e.preventDefault();
      doUndo();
      return;
    }
    if (ctrl && !typing && (k === "y" || (k === "z" && e.shiftKey))) {
      e.preventDefault();
      doRedo();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (e.key === "ArrowLeft") goBack();
      else goForward();
      return;
    }
    if (e.key === "BrowserBack" || e.key === "BrowserForward") {
      e.preventDefault();
      if (e.key === "BrowserBack") goBack();
      else goForward();
    }
  });
  // Le bouton « retour » de la souris (bouton 3) et « suivant » (bouton 4).
  const mouse = (e: MouseEvent) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.type !== "mouseup") return;
    if (e.button === 3) goBack();
    else goForward();
  };
  window.addEventListener("mousedown", mouse);
  window.addEventListener("mouseup", mouse);
}

/** Ctrl+K ou « / » : le champ de recherche, son texte sélectionné. */
function focusSearch() {
  const search = rail.querySelector<HTMLInputElement>(".search");
  if (!search) return;
  search.focus();
  search.select();
}

/** Les flèches haut et bas passent d'une ligne à l'autre d'une colonne. */
function arrowKeys(list: HTMLElement, selector: string) {
  list.addEventListener("keydown", (e) => {
    if (e.altKey || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...list.querySelectorAll<HTMLElement>(selector)].filter((b) => b.offsetParent !== null);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    items[next].focus();
  });
}

// ── Mode Simple / Complet (visibility.ts, mode.ts) ────────────────────────────

/** Le mode courant (Simple par défaut, même pour un réglage absent). */
function settingsMode(): SettingsMode {
  return modeOf(settingsStore.current.general.settingsMode);
}

/** Change de mode : enregistré, la page se redessine, l'interrupteur suit. */
function setMode(mode: SettingsMode) {
  if (mode === settingsMode()) return;
  // Redessinée tout de suite (sans attendre l'enregistrement) : un lien profond
  // vers une ligne cachée peut ainsi la trouver juste après. Pas d'« Annuler » :
  // c'est une façon de regarder, pas un réglage d'Ondine.
  save((d) => (d.general.settingsMode = mode), false, { undo: false });
  showPage(false);
  rail.querySelector(".mode-switch")?.replaceWith(modeSwitch(mode, setMode));
}

/** Les clés essentielles d'une page (module : d'après son manifeste ; île : visibility.ts). */
function essentialsOf(p: Page): string[] | typeof WHOLE_PAGE {
  return p.essentials ?? pageEssentials(p.id);
}

/** Un résultat de recherche est-il caché par le mode Simple sur sa page ? */
function advancedHit(p: Page, key: string | undefined): boolean {
  return !!key && isHidden(settingsMode(), key, essentialsOf(p));
}

// ── Navigation (nav-logic.ts) ─────────────────────────────────────────────────

function pageById(id: string): Page | undefined {
  return allPages().find((p) => p.id === id);
}

/** Les pages telles que la navigation les voit (rubrique, catégorie, sous-menus). */
function navPages(): NavPage[] {
  return allPages().map((p) => ({ id: p.id, group: p.group, label: p.label, category: p.category, subs: (p.subs?.() ?? []).map(({ id, label }) => ({ id, label })) }));
}

/** La rubrique de la page affichée. */
function rubricNow(): NavGroup {
  return pageById(current)?.group ?? NAV_GROUPS[0];
}

/** La place affichée (page et sous-menu). */
function here(): NavPlace {
  const p = pageById(current);
  return { page: current, sub: p ? subOf(p) : null };
}

/** Le sous-menu affiché d'une page (le premier par défaut) ; null sans sous-menus. */
function subOf(p: Page): string | null {
  const list = p.subs?.() ?? [];
  if (!list.length) return null;
  const chosen = chosenSubs[p.id];
  return list.some((s) => s.id === chosen) ? chosen : list[0].id;
}

function setSub(pageId: string, subId: string) {
  chosenSubs[pageId] = subId;
  try {
    localStorage.setItem("settings.subs", JSON.stringify(chosenSubs));
  } catch {
    // pas grave : on reviendra au premier sous-menu
  }
}

/** Retient la page affichée (d'une ouverture à l'autre), et sa rubrique y ramènera. */
function rememberPage(id: string) {
  const g = pageById(id)?.group;
  if (g) rubricPages[g] = id;
  try {
    localStorage.setItem("settings.page", id);
    localStorage.setItem("settings.rubrics", JSON.stringify(rubricPages));
  } catch {
    // pas grave : on ne se souviendra juste pas de la page
  }
}

/**
 * La pastille d'état en bas de la 1re colonne : « Prête · maintenir … » quand
 * la dictée est activée (module dictation), sinon la version et les mises à jour.
 */
function statusPill(): HTMLElement {
  const s = settingsStore.current;
  const man = manifestOf("dictation");
  const dictation = man || s.modules.dictation ? { enabled: settingsStore.moduleEnabled("dictation"), values: man ? settingsStore.moduleValues(man) : (s.modules.dictation?.values ?? {}) } : null;
  return navStatus(statusLine({ version: appVersion, dictation, autoUpdate: s.general.autoUpdate !== false, note: updateNote }));
}

/**
 * Ouvre une page (et peut-être un de ses sous-menus, ou la ligne `focusKey`).
 * Un ancien nom de page ou de sous-menu (avant 1.2.2) mène à sa nouvelle
 * place (resolvePlace, layout.ts) : les liens profonds restent bons.
 * `fromHistory` : on revient (ou on avance) dans l'historique, sans l'allonger.
 */
function go(target: string, focusKey?: string, subId?: string, fromHistory = false) {
  const place = resolvePlace(target, subId);
  const id = place.page;
  if (!pageById(id)) return;
  const subChanged = !!place.sub && place.sub !== chosenSubs[id];
  if (place.sub) setSub(id, place.sub);
  if (id === current && !query) {
    if (subChanged) {
      syncNav();
      showPage(true, focusKey);
    }
    // Même page : la ligne est peut-être dans un autre sous-menu.
    else if (focusKey && !findKey(content, focusKey)) showPage(true, focusKey);
    if (focusKey) highlight(focusKey);
    if (!fromHistory) navHistory.visit(here());
    return;
  }
  current = id;
  if (query) clearSearch();
  rememberPage(id);
  syncNav();
  showPage(true, focusKey);
  if (focusKey) highlight(focusKey);
  if (!fromHistory) navHistory.visit(here());
}

/** Un clic sur un sous-menu (2e colonne, pilules, fil d'Ariane). */
function goSub(pageId: string, subId: string, fromHistory = false) {
  const p = pageById(pageId);
  if (!p) return;
  const same = subOf(p) === subId;
  setSub(pageId, subId);
  if (pageId !== current || query) return go(pageId, undefined, undefined, fromHistory);
  if (same) return;
  syncNav();
  showPage(true);
  if (!fromHistory) navHistory.visit(here());
}

/** Une rubrique de la 1re colonne : la dernière page vue dedans, sinon sa première. */
function goRubric(g: NavGroup) {
  const id = pageForRubric(g, navPages(), rubricPages);
  if (id) go(id);
}

/** Une place (historique, fil d'Ariane). */
function goPlace(place: NavPlace, fromHistory = false) {
  if (place.sub) goSub(place.page, place.sub, fromHistory);
  else go(place.page, undefined, undefined, fromHistory);
}

/** Retour arrière (bouton de la souris, Alt+←). */
function goBack() {
  navHistory.forget((pl) => !!pageById(pl.page));
  const place = navHistory.goBack();
  if (place) goPlace(place, true);
}

/** Avancer (après un retour : bouton « suivant » de la souris, Alt+→). */
function goForward() {
  navHistory.forget((pl) => !!pageById(pl.page));
  const place = navHistory.goForward();
  if (place) goPlace(place, true);
}

function clearSearch() {
  query = "";
  const search = rail.querySelector<HTMLInputElement>(".search");
  if (search) search.value = "";
  app.classList.remove("searching");
}

/** Ce qui change la 1re colonne : les rubriques et leur nombre de pages. */
let railShape = "";
function railShapeOf(): string {
  const counts = rubricCounts(navPages());
  return NAV_GROUPS.map((g) => `${g}=${counts[g]}`).join(",");
}

/** La 1re colonne : la recherche, les sept rubriques, puis Simple / Complet et l'état. */
function drawRail() {
  const focused = document.activeElement;
  const hadFocus = focused instanceof HTMLInputElement && focused.classList.contains("search");
  const search = el("input", { class: "search", type: "search", placeholder: "Rechercher un réglage", "aria-label": "Rechercher un réglage", "aria-keyshortcuts": "Control+K /" }) as HTMLInputElement;
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    app.classList.toggle("searching", !!query.trim());
    showPage(false);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) {
      e.preventDefault();
      clearSearch();
      showPage(false);
    } else if (e.key === "ArrowDown" && query.trim()) {
      // ↓ : le premier résultat ; Entrée : l'ouvrir.
      e.preventDefault();
      content.querySelector<HTMLElement>(".result-go")?.focus();
    } else if (e.key === "Enter" && query.trim()) content.querySelector<HTMLElement>(".result-go")?.click();
  });

  railShape = railShapeOf();
  const counts = rubricCounts(navPages());
  const rubric = rubricNow();
  const list = el("div", { class: "rail-list" });
  railPill.attach(list);
  railPill.reset();
  for (const g of NAV_GROUPS) {
    if (!counts[g]) continue;
    const on = g === rubric;
    const b = el(
      "button",
      { type: "button", class: `rail-item ${on ? "active" : ""}`, "data-rubric": g, "aria-current": on ? "true" : false, title: g },
      el("span", { class: "nav-icon" }, iconNode(RUBRIC_ICONS[g])),
      el("span", { class: "nav-label" }, g),
      el("span", { class: "rail-count", "aria-hidden": "true" }, String(counts[g])),
    );
    b.addEventListener("click", () => goRubric(g));
    list.append(b);
  }
  arrowKeys(list, ".rail-item");
  rail.replaceChildren(
    el("div", { class: "brand" }, el("span", { class: "brand-drop" }, iconNode("💧")), el("span", {}, "Réglages")),
    search,
    list,
    el("div", { class: "rail-foot" }, modeSwitch(settingsMode(), setMode), statusPill()),
  );
  // La pastille se place une fois la liste affichée (il faut ses positions).
  requestAnimationFrame(() => railPill.place(list.querySelector<HTMLElement>(".rail-item.active"), false));
  if (hadFocus) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

/** Met la 1re colonne à jour : la rubrique active (la pastille glisse) et l'état. */
function syncRail() {
  if (railShapeOf() !== railShape) return drawRail();
  rail.querySelector(".nav-status")?.replaceWith(statusPill());
  const rubric = rubricNow();
  let active: HTMLElement | null = null;
  for (const b of rail.querySelectorAll<HTMLElement>(".rail-item")) {
    const on = b.dataset.rubric === rubric;
    b.classList.toggle("active", on);
    if (on) {
      b.setAttribute("aria-current", "true");
      active = b;
    } else b.removeAttribute("aria-current");
  }
  railPill.place(active);
}

/** Ce que montre la 2e colonne : ses lignes et leurs points « désactivé ». */
let col2Shape = "";
let col2Drawn = { rubric: "", page: "" };
function col2ShapeOf(): string {
  const p = pageById(current);
  const items = column2(rubricNow(), navPages(), current, p ? subOf(p) : null);
  const off = (id: string) => {
    const m = pageById(id)?.module;
    return m && !settingsStore.moduleEnabled(m) ? "-off" : "";
  };
  const subOff = (page: string, sub: string) => {
    const m = pageById(page)?.subs?.().find((s) => s.id === sub)?.module;
    return m && !settingsStore.moduleEnabled(m) ? "-off" : "";
  };
  return items
    .map((it) => (it.kind === "cat" ? `#${it.id}` : it.kind === "page" ? `${it.page}${off(it.page)}${it.current ? "*" : ""}` : `${it.sub}=${it.label}${subOff(it.page, it.sub)}${it.current ? "*" : ""}${dimmed.get(it.page)?.has(it.sub) ? "~" : ""}`))
    .join(",");
}

/** Le sélecteur d'une ligne de la 2e colonne (pour lui rendre le focus après un nouveau dessin). */
function col2Selector(b: HTMLElement): string {
  const page = `[data-page="${CSS.escape(b.dataset.page ?? "")}"]`;
  return b.dataset.sub ? `${page}[data-sub="${CSS.escape(b.dataset.sub)}"]` : `.col2-item${page}`;
}

/**
 * La 2e colonne : les pages de la rubrique, et les sous-menus de la page
 * affichée dépliés sous elle. `motion` : « rubric » (nouvelle rubrique : la
 * colonne arrive en cascade), « subs » (autre page : ses sous-menus se
 * déplient en cascade), null (la pastille glisse seulement).
 */
function drawCol2(motion: "rubric" | "subs" | null) {
  const rubric = rubricNow();
  const p = pageById(current);
  const sub = p ? subOf(p) : null;
  const focused = document.activeElement instanceof HTMLElement && col2.contains(document.activeElement) ? col2Selector(document.activeElement) : null;
  const list = el("div", { class: "col2-list" });
  col2Pill.attach(list);
  if (motion === "rubric") col2Pill.reset();
  let active: HTMLElement | null = null;
  for (const it of column2(rubric, navPages(), current, sub)) {
    if (it.kind === "cat") {
      list.append(el("div", { class: "col2-cat" }, it.label));
      continue;
    }
    const page = pageById(it.page);
    if (!page) continue;
    if (it.kind === "page") {
      const off = !!page.module && !settingsStore.moduleEnabled(page.module);
      const hasSubs = (page.subs?.() ?? []).length > 0;
      const b = el(
        "button",
        {
          type: "button",
          class: `col2-item ${it.current ? "active" : ""} ${it.open ? "open" : ""} ${off ? "off" : ""}`,
          "data-page": it.page,
          "aria-current": it.current ? (it.open ? "true" : "page") : false,
          "aria-expanded": hasSubs ? String(it.open) : undefined,
          title: page.label,
        },
        el("span", { class: "nav-icon" }, iconNode(page.icon)),
        el("span", { class: "nav-label" }, page.label),
        off ? el("span", { class: "nav-off", title: "Module désactivé" }) : null,
      );
      if (hasSubs) b.insertAdjacentHTML("beforeend", CARET);
      b.addEventListener("click", () => go(it.page));
      if (it.current && !it.open) active = b;
      list.append(b);
    } else {
      const s = page.subs?.().find((x) => x.id === it.sub);
      const off = !!s?.module && !settingsStore.moduleEnabled(s.module);
      const dim = !!dimmed.get(it.page)?.has(it.sub);
      const attrs: Record<string, string | boolean | undefined> = {
        type: "button",
        class: `col2-sub ${it.current ? "active" : ""} ${off ? "off" : ""} ${dim ? "dim" : ""}`,
        "data-page": it.page,
        "data-sub": it.sub,
        "aria-current": it.current ? "page" : false,
      };
      if (s?.noI18n) attrs["data-no-i18n"] = "";
      const b = el("button", attrs, el("span", { class: "nav-label" }, it.label), off ? el("span", { class: "nav-off", title: "Module désactivé" }) : null);
      b.addEventListener("click", () => goSub(it.page, it.sub));
      if (it.current) active = b;
      list.append(b);
    }
  }
  arrowKeys(list, ".col2-item, .col2-sub:not(.dim)");
  col2.replaceChildren(el("div", { class: "col2-head" }, rubric), list);
  col2Shape = col2ShapeOf();
  col2Drawn = { rubric, page: current };
  if (focused) list.querySelector<HTMLElement>(focused)?.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    col2Pill.place(active, motion !== "rubric");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  if (still() || !motion) return;
  // Façon iOS : une nouvelle rubrique arrive de la droite, ligne après ligne ;
  // les sous-menus d'une autre page se déplient en cascade.
  const parts = motion === "rubric" ? [col2.firstElementChild as HTMLElement, ...([...list.children] as HTMLElement[]).filter((c) => !c.classList.contains("glass-pill"))] : [...list.querySelectorAll<HTMLElement>(".col2-sub")];
  parts.forEach((part, i) =>
    part.animate(
      motion === "rubric" ? [{ opacity: 0, transform: "translateX(28px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0, transform: "translateY(10px) scale(.985)" }, { opacity: 1, transform: "none" }],
      { duration: motion === "rubric" ? 450 : 320, delay: Math.min(i, 12) * (motion === "rubric" ? 22 : 28), easing: IOS_EASE, fill: "backwards" },
    ),
  );
}

/**
 * Met les deux colonnes à jour. La 2e est redessinée quand ses lignes
 * changent (autre rubrique, autre page, module éteint…), sinon seule sa
 * pastille glisse vers le sous-menu choisi.
 */
function syncNav() {
  syncRail();
  const rubric = rubricNow();
  const motion = rubric !== col2Drawn.rubric ? "rubric" : current !== col2Drawn.page ? "subs" : null;
  if (motion || col2ShapeOf() !== col2Shape) drawCol2(motion);
}

/** Le fil d'Ariane en haut de la page : Rubrique › Page › Sous-menu, chaque morceau cliquable. */
function crumbsNav(place: NavPlace): HTMLElement {
  const p = pageById(place.page);
  const plain = (p?.subs?.() ?? []).filter((s) => s.noI18n).map((s) => s.id);
  const parts = crumbs(place, navPages(), plain);
  const box = el("nav", { class: "crumbs", "aria-label": "Fil d'Ariane" });
  parts.forEach((c, i) => {
    if (i) box.append(el("span", { class: "crumb-sep", "aria-hidden": "true" }, "›"));
    const attrs: Record<string, string | ((e: Event) => void)> = { class: c.to ? "crumb" : "crumb here" };
    if (c.plain) attrs["data-no-i18n"] = "";
    if (c.to) {
      const to = c.to;
      box.append(el("button", { ...attrs, type: "button", onclick: () => goPlace(to) }, c.label));
    } else box.append(el("span", { ...attrs, "aria-current": i === parts.length - 1 ? "page" : "false" }, c.label));
  });
  return box;
}

/** Affiche la page courante (ou les résultats de recherche). `focusKey` : ouvre le sous-menu de cette ligne. */
function showPage(animate: boolean, focusKey?: string) {
  closeGlassSelect();
  const p = query.trim() ? null : (pageById(current) ?? ONDINE_PAGES[0]);
  // Une page Voix déjà affichée ne se redessine pas pour un réglage changé
  // ailleurs (elle se tient à jour elle-même : un enregistrement continue).
  if (!animate && p?.voice && content.querySelector(`.page[data-page="${p.id}"]`)) return;
  voiceStop?.();
  voiceStop = null;
  preview?.destroy();
  preview = null;
  podium?.destroy();
  podium = null;
  const page = el("div", { class: "page", "data-page": p?.id ?? "search" });
  let place: NavPlace | null = null;
  // La bande est gardée quand la même page se redessine (sous-menu, réglage changé).
  const kept = !!p && heroKeep?.page === p.id;
  if (!p) {
    if (!IS_TAURI) page.append(el("p", { class: "banner" }, "Aperçu dans un navigateur : rien n'est enregistré."));
    app.style.setProperty("--page-color", "#9fb4d8");
    results(page, query);
  } else if (p.voice) {
    heroKeep = null;
    place = { page: p.id, sub: null };
    page.append(crumbsNav(place));
    if (!IS_TAURI) page.append(el("p", { class: "banner" }, "Aperçu dans un navigateur : rien n'est enregistré."));
    app.style.setProperty("--page-color", p.color ?? "#5fd4e6");
    // La page Voix dessine tout, bande comprise, directement dans la page affichée.
    const stop = p.voice.render(page);
    if (typeof stop === "function") voiceStop = stop;
  } else {
    const color = pageColor(p);
    app.style.setProperty("--page-color", color);
    // La page entière est dessinée, puis on ne garde que son sous-menu.
    const body = el("div", {});
    p.render(body);
    const subs = p.subs?.() ?? [];
    let sub = subOf(p);
    if (sub && focusKey) {
      const into = findKey(body, focusKey)?.closest<HTMLElement>("[data-sub]")?.dataset.sub;
      if (into && into !== sub) {
        setSub(p.id, into);
        sub = into;
        syncNav();
      }
    }
    // Mode Simple : un sous-menu sans rien à montrer n'est pas affiché (il
    // reste dans Complet) ; on ouvre le premier qui a quelque chose.
    const empty = sub ? dimSubs(body, p, subs) : new Set<string>();
    if (sub && empty.has(sub) && !focusKey) {
      const alt = subs.find((s) => !empty.has(s.id));
      if (alt) {
        setSub(p.id, alt.id);
        sub = alt.id;
        syncNav();
      }
    }
    place = { page: p.id, sub };
    page.append(crumbsNav(place));
    if (!IS_TAURI) page.append(el("p", { class: "banner" }, "Aperçu dans un navigateur : rien n'est enregistré."));
    const band = kept && heroKeep ? heroKeep.el : hero({ title: p.label, subtitle: p.sub, color, mascots: p.cast ?? castFor(p.id), actions: p.actions?.() });
    heroKeep = { page: p.id, el: band };
    page.append(band);
    // Les sous-menus en pilules : seulement quand la 2e colonne est repliée (fenêtre étroite).
    if (subs.length) page.append(subPills(p, subs, sub, empty));
    page.append(pageTools(p));
    if (sub) {
      for (const child of [...body.children] as HTMLElement[]) if (child.dataset.sub && child.dataset.sub !== sub) child.remove();
    }
    page.append(...body.childNodes);
    applyMode(page, essentialsOf(p), settingsMode(), () => setMode("full"));
  }
  const old = content.firstElementChild as HTMLElement | null;
  const y = content.scrollTop;
  content.replaceChildren(page);
  upgradeSelects(page);
  if (p && !p.voice) markModified(page, p);
  const dir = place ? direction(shownPlace, place, navPages()) : 0;
  shownPlace = place;
  if (!animate) {
    content.scrollTop = y;
    return;
  }
  content.scrollTop = 0;
  if (still() || !old) return;
  // Façon iOS : on avance, la page arrive de la droite ; on revient, de la
  // gauche ; même place (un réglage changé ailleurs), elle se pose sur place.
  // Même page (un autre sous-menu) : la bande reste où elle est.
  const moving = kept ? ([...page.children] as HTMLElement[]).filter((c) => !c.matches(".page-hero, .page-subs, .crumbs")) : [page];
  const from = dir ? { opacity: 0, transform: `translateX(${dir * 28}px)` } : { opacity: 0, transform: "translateY(10px) scale(.985)" };
  for (const part of moving) part.animate([from, { opacity: 1, transform: "none" }], { duration: dir ? 500 : 420, easing: IOS_EASE });
  if (!kept) staggerIn(page, 0);
}

/**
 * Les sous-menus de la page en pilules sous la bande : les mêmes que dans la
 * 2e colonne (même choix retenu, mêmes points « désactivé », mêmes sous-menus
 * cachés en mode Simple). Visibles seulement quand la 2e colonne est repliée.
 */
function subPills(p: Page, subs: Sub[], chosen: string | null, empty: Set<string>): HTMLElement {
  const box = el("div", { class: "page-subs", role: "tablist", "aria-label": "Parties de la page" });
  for (const s of subs) {
    const on = s.id === chosen;
    const off = !!s.module && !settingsStore.moduleEnabled(s.module);
    const b = el(
      "button",
      {
        class: `page-sub ${on ? "on" : ""} ${off ? "off" : ""} ${empty.has(s.id) ? "dim" : ""}`,
        type: "button",
        role: "tab",
        "aria-selected": String(on),
        "data-sub": s.id,
        "data-no-i18n": s.noI18n ? "" : undefined,
      },
      s.label,
    );
    b.addEventListener("click", () => {
      if (!on) goSub(p.id, s.id);
    });
    box.append(b);
  }
  return box;
}

/**
 * Mode Simple : cache dans la 2e colonne les sous-menus de la page dont rien
 * ne resterait affiché (ils reviennent en Complet). Renvoie leurs ids.
 */
function dimSubs(body: HTMLElement, p: Page, subs: Sub[]): Set<string> {
  const mode = settingsMode();
  const essentials = essentialsOf(p);
  const empty = new Set<string>();
  if (mode === "simple" && essentials !== WHOLE_PAGE) {
    for (const s of subs) {
      const parts = ([...body.children] as HTMLElement[]).filter((c) => c.dataset.sub === s.id);
      if (!parts.length) continue;
      if (parts.some((c) => c.matches("[data-essential]") || c.querySelector("[data-essential]"))) continue;
      const keyed = parts.flatMap((c) => [...(c.matches("section.group[data-key]") ? [c] : []), ...c.querySelectorAll<HTMLElement>(".row[data-key], section.group[data-key]")]).filter((r) => r.dataset.key);
      if (keyed.length && keyed.every((r) => isHidden(mode, r.dataset.key ?? "", essentials))) empty.add(s.id);
    }
  }
  dimmed.set(p.id, empty);
  for (const b of col2.querySelectorAll<HTMLElement>(".col2-sub")) {
    const dim = b.dataset.page === p.id && empty.has(b.dataset.sub ?? "");
    b.classList.toggle("dim", dim);
    if (dim) b.title = "Réglages en mode Complet";
    else b.removeAttribute("title");
  }
  return empty;
}

/** La ligne (ou le bloc) de clé `key` dans `root`. */
function findKey(root: HTMLElement, key: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>("[data-key]")].find((r) => r.dataset.key === key);
}

/** Fait défiler jusqu'à la ligne `key` et la fait briller un instant. */
function highlight(key: string) {
  requestAnimationFrame(() => {
    const target = findKey(content, key);
    if (!target) return;
    // Caché par le mode Simple (recherche, lien profond) : on passe en Complet, puis on y va.
    if (settingsMode() === "simple" && hiddenByMode(target)) {
      setMode("full");
      return highlight(key);
    }
    target.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    target.classList.remove("flash");
    void target.offsetWidth; // relance l'animation si on recherche deux fois la même chose
    target.classList.add("flash");
  });
}

// ── En haut de page : préréglages et « Réinitialiser la page » ──────────────

/** Les préréglages d'une page (presets.ts), s'il y en a. */
function presetSetFor(p: Page): PresetSet | null {
  if (p.id === "animations") {
    const fields = manifestOf("halos")?.settings?.fields;
    return fields ? animationPresets(fields) : null;
  }
  if (p.id === "look") return LOOK_PRESETS;
  return null;
}

/** La valeur actuelle d'un réglage visé par un préréglage. */
function readTarget(t: PresetTarget): unknown {
  if ("module" in t) {
    const man = manifestOf(t.module);
    return man ? settingsStore.moduleValues(man)[t.key] : undefined;
  }
  return getPath(settingsStore.current, t.path) ?? islandDefault(t.path);
}

/** Pose toutes les valeurs d'un préréglage d'un coup (un seul « Annuler », au nom de la page). */
function applyPreset(values: PresetSet["presets"][number]["values"], label: string) {
  save(
    (d) => {
      for (const { target, value } of values) {
        if ("module" in target) {
          const entry = (d.modules[target.module] ??= { enabled: settingsStore.moduleEnabled(target.module), values: {} });
          entry.values[target.key] = structuredClone(value);
        } else setPath(d as unknown as Record<string, unknown>, target.path, value);
      }
    },
    true,
    { label },
  );
}

/** Les boutons des préréglages, le choix actuel allumé (« Personnalisé » si aucun ne correspond). */
function presetsBar(set: PresetSet, pageLabel: string): HTMLElement {
  const on = activePreset(set, readTarget);
  const chosen = set.presets.find((x) => x.id === on);
  return el(
    "div",
    { class: "presets", role: "group", "aria-label": set.title },
    el("span", { class: "presets-title" }, set.title),
    el(
      "div",
      { class: "presets-list" },
      ...set.presets.map((pr) => el("button", { type: "button", class: `preset ${pr.id === on ? "on" : ""}`, "aria-pressed": String(pr.id === on), onclick: () => pr.id !== on && applyPreset(pr.values, pageLabel) }, pr.label)),
    ),
    el("p", { class: "presets-help" }, chosen ? chosen.help : "Personnalisé : vos propres réglages."),
  );
}

/** En haut de la page : ses préréglages, et la place de « Réinitialiser la page » (markModified). */
function pageTools(p: Page): HTMLElement {
  const set = presetSetFor(p);
  const box = el("div", { class: "page-tools" }, set ? presetsBar(set, p.label) : null, el("div", { class: "page-reset" }));
  box.hidden = !set;
  return box;
}

// ── La pastille « Modifié » (modified.ts) ─────────────────────────────────────

interface RowState {
  modified: boolean;
  /** Remet la valeur d'origine dans le brouillon des réglages. */
  reset: (d: Settings) => void;
}

/**
 * Ce qu'on sait d'une ligne : un champ de module (`data-field`, posé par
 * fieldRows) ou une ligne d'une page de l'île (ISLAND_PATHS). null : la ligne
 * n'a pas de valeur d'origine connue (un bouton, une liste, un texte libre).
 */
function rowState(row: HTMLElement, p: Page): RowState | null {
  const field = row.dataset.field;
  if (field) {
    const dot = field.indexOf(".");
    const man = manifestOf(field.slice(0, dot));
    const key = field.slice(dot + 1);
    const f = man?.settings?.fields.find((x) => x.key === key);
    if (!man || !f || f.type === "secret") return null;
    const origin = f.default;
    return {
      modified: isModified(settingsStore.moduleValues(man)[key], origin),
      reset: (d) => {
        const entry = (d.modules[man.id] ??= { enabled: settingsStore.moduleEnabled(man.id), values: {} });
        entry.values[key] = structuredClone(origin);
      },
    };
  }
  const paths = ISLAND_PATHS[p.id]?.[row.dataset.key ?? ""];
  if (!paths) return null;
  return {
    modified: islandRowModified(settingsStore.current, paths),
    reset: (d) => {
      for (const path of paths) setPath(d as unknown as Record<string, unknown>, path, islandDefault(path));
    },
  };
}

/** Les lignes modifiées et visibles de la page affichée. */
function modifiedRows(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(".row.modified")].filter((r) => !r.hidden && !r.closest("[hidden]"));
}

/**
 * Pose (ou retire) la pastille « Modifié » et son « Réinitialiser » sur chaque
 * ligne de la page, et « Réinitialiser la page » en haut s'il y a de quoi.
 */
function markModified(page: HTMLElement, p: Page) {
  for (const r of page.querySelectorAll<HTMLElement>(".row[data-key]")) {
    if (r.classList.contains("result")) continue;
    const st = rowState(r, p);
    const was = r.querySelector(":scope > .row-mod, :scope > .row-text > .row-mod");
    r.classList.toggle("modified", !!st?.modified);
    if (!st?.modified) {
      was?.remove();
      continue;
    }
    if (was) continue;
    const mark = el(
      "span",
      { class: "row-mod" },
      el("span", { class: "mod-dot", "aria-hidden": "true" }),
      el("span", { class: "mod-text" }, "Modifié"),
      el("button", { type: "button", class: "link-btn mod-reset", onclick: () => resetRows([r], p) }, "Réinitialiser"),
    );
    const label = r.querySelector(":scope > .row-text > .row-label");
    if (label) label.after(mark);
    else r.prepend(mark);
  }
  const slot = page.querySelector<HTMLElement>(".page-reset");
  if (!slot || slot.classList.contains("asking")) return;
  const any = modifiedRows(page).length > 0;
  slot.replaceChildren(...(any ? [el("button", { type: "button", class: "btn small page-reset-btn", onclick: () => askResetPage(page, slot, p) }, "Réinitialiser la page")] : []));
  const tools = slot.closest<HTMLElement>(".page-tools");
  if (tools) tools.hidden = !any && !tools.querySelector(".presets");
}

/** « Réinitialiser la page » : on le demande d'abord, dans la page (pas de fenêtre). */
function askResetPage(page: HTMLElement, slot: HTMLElement, p: Page) {
  slot.classList.add("asking");
  const done = () => {
    slot.classList.remove("asking");
    markModified(page, p);
  };
  const yes = el("button", { type: "button", class: "btn small danger", onclick: () => {
    const rows = modifiedRows(page);
    slot.classList.remove("asking");
    resetRows(rows, p, p.label);
  } }, "Réinitialiser");
  const no = el("button", { type: "button", class: "btn small", onclick: done }, "Annuler");
  const ask = el("div", { class: "reset-ask", role: "group", "aria-label": "Réinitialiser la page" }, el("span", {}, "Remettre les réglages modifiés de cette page à leur valeur d'origine ?"), yes, no);
  ask.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      done();
      slot.querySelector<HTMLElement>(".page-reset-btn")?.focus();
    }
  });
  slot.replaceChildren(ask);
  if (!still()) ask.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: IOS_EASE });
  yes.focus();
}

/** Remet des lignes à leur valeur d'origine, en un seul changement (un seul « Annuler »). */
function resetRows(rows: HTMLElement[], p: Page, label?: string) {
  const states = rows.map((r) => rowState(r, p)).filter((s): s is RowState => !!s?.modified);
  if (!states.length) return;
  save((d) => states.forEach((s) => s.reset(d)), true, { label: label ?? rows[0].dataset.key });
}

/** Après un changement : les pastilles « Modifié » et les préréglages suivent (une fois par image). */
let modFrame = 0;
function scheduleModified() {
  if (modFrame) return;
  modFrame = requestAnimationFrame(() => {
    modFrame = 0;
    const page = content.querySelector<HTMLElement>(":scope > .page");
    const p = query.trim() ? null : pageById(current);
    if (!page || !p || p.voice || page.dataset.page !== p.id) return;
    markModified(page, p);
    const set = presetSetFor(p);
    const bar = page.querySelector(".presets");
    if (set && bar) bar.replaceWith(presetsBar(set, p.label));
  });
}

// ── Recherche ─────────────────────────────────────────────────────────────────

/** Minuscules et sans accents : « écran » trouve « Ecran ». */
function simple(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Les pages de l'île qu'on peut dessiner en coulisse pour en sortir un
 * interrupteur ou un menu de choix (résultats de recherche) : leurs lignes
 * n'ont pas d'effet de bord. Les autres (Règles, Téléphones, Identifiants…)
 * mènent seulement à leur page.
 */
const INLINE_PAGES = new Set(["general", "behavior", "look", "tabs", "mascot", "perf", "updates"]);

/** Les modules dont une page montre les champs (un champ trouvé : sa ligne générée seule). */
function fieldModules(p: Page): string[] {
  if (p.id === "animations") return [...new Set(ANIMATION_SUBS.flatMap((s) => s.blocks.map((b) => b.module)))];
  if (p.id === "behavior") return ["windowlife"];
  return p.module && p.id.startsWith("module:") ? [p.module] : [];
}

/** La commande d'une ligne, si c'est un réglage simple : interrupteur ou menu de choix. */
function takeControl(line: HTMLElement | undefined, label: string): HTMLElement | null {
  const c = line?.querySelector<HTMLElement>(":scope > .row-control")?.firstElementChild as HTMLElement | null;
  if (!c || !c.matches(".toggle, .gsel, .segmented")) return null;
  // Sortie de sa ligne : elle ne peut plus s'appuyer sur le libellé de la ligne pour son nom.
  for (const x of [c, ...c.querySelectorAll<HTMLElement>("*")]) {
    x.removeAttribute("aria-labelledby");
    x.removeAttribute("aria-describedby");
  }
  if (!c.matches(".toggle")) c.setAttribute("aria-label", label);
  return c;
}

/**
 * Un résultat qui est un réglage simple se change sans quitter la recherche :
 * on prend la vraie commande de sa ligne (elle enregistre comme sur sa page).
 * `rendered` : les pages déjà dessinées en coulisse pour cette recherche.
 */
function inlineControl(p: Page, key: string, rendered: Map<string, HTMLElement>): HTMLElement | null {
  for (const id of fieldModules(p)) {
    const man = manifestOf(id);
    const f = man?.settings?.fields.find((x) => x.label === key && (x.type === "boolean" || x.type === "select"));
    // Un champ déplacé (MOVED_FIELDS) n'est plus sur la page de son module, mais il l'est sur l'autre.
    if (man && f && !(p.id.startsWith("module:") && MOVED_FIELDS[id]?.keys.includes(f.key))) return takeControl(fieldRows(man, [f])[0], key);
  }
  if (!INLINE_PAGES.has(p.id)) return null;
  let body = rendered.get(p.id);
  if (!body) {
    body = el("div", {});
    try {
      p.render(body);
    } catch {
      return null;
    }
    rendered.set(p.id, body);
  }
  return takeControl(findKey(body, key), key);
}

function results(page: HTMLElement, q: string) {
  const words = simple(q).split(/\s+/).filter(Boolean);
  const hits: { page: Page; key?: string; sub?: string; label: string; former?: boolean }[] = [];
  for (const p of allPages()) {
    const matches = (text: string) => words.every((w) => simple(text).includes(w));
    if (matches(`${p.label} ${p.sub}`)) hits.push({ page: p, label: p.label });
    // Les anciens noms de la page et de ses sous-menus (avant 1.2.2).
    for (const f of FORMER_NAMES[p.id] ?? []) if (matches(f.name)) hits.push({ page: p, sub: f.sub, label: f.name, former: true });
    for (const k of p.keywords) {
      if (!k || !matches(k)) continue;
      // Une description trouvée : on montre la page, pas tout le texte.
      if (k.length > 80) {
        if (!hits.some((h) => h.page === p && !h.key)) hits.push({ page: p, label: p.label });
      } else hits.push({ page: p, key: SEARCH_ALIASES[k] ?? k, label: k });
    }
  }
  const line = hits.length ? `${hits.length} résultat${hits.length > 1 ? "s" : ""} pour « ${q.trim()} »` : `Rien trouvé pour « ${q.trim()} ».`;
  // La bande de la recherche reste la même d'une lettre à l'autre : seule sa phrase change.
  let band = heroKeep?.page === SEARCH_PAGE ? heroKeep.el : null;
  const said = band?.querySelector<HTMLElement>(".page-hero-copy p");
  if (band && said) said.textContent = line;
  else band = hero({ title: "Recherche", subtitle: line, color: "#9fb4d8", mascots: ["gomme-champignon", "goutte-gomme"] });
  heroKeep = { page: SEARCH_PAGE, el: band };
  page.append(band);
  if (!hits.length) return;
  const rendered = new Map<string, HTMLElement>();
  page.append(
    group(
      null,
      hits.slice(0, 40).map((h) => {
        const control = h.key && !h.former ? inlineControl(h.page, h.key, rendered) : null;
        return el(
          "div",
          { class: `row result ${control ? "has-control" : ""}` },
          el(
            "button",
            { type: "button", class: "result-go", onclick: () => go(h.page.id, h.key, h.sub) },
            el("span", { class: "result-icon" }, iconNode(h.page.icon)),
            el("div", { class: "row-text" }, el("div", { class: "row-label" }, h.label), el("div", { class: "row-help" }, ...(h.key || h.former ? [el("span", {}, h.page.group), " › ", el("span", {}, h.page.label)] : [h.page.group]))),
            advancedHit(h.page, h.key) ? chip("réglage avancé") : null,
            control ? null : el("span", { class: "chevron", "aria-hidden": "true" }, "›"),
          ),
          control ? el("div", { class: "row-control result-control", "data-key": h.label }, control) : null,
        );
      }),
    ),
  );
  // ↑ ↓ d'un résultat à l'autre (et ↑ depuis le premier : la recherche).
  page.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("result-go") || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const all = [...page.querySelectorAll<HTMLElement>(".result-go")];
    const i = all.indexOf(t);
    e.preventDefault();
    if (e.key === "ArrowUp" && i === 0) rail.querySelector<HTMLInputElement>(".search")?.focus();
    else all[Math.max(0, Math.min(all.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  });
}

// ── Pages ─────────────────────────────────────────────────────────────────────

/**
 * « S'adresser à moi » : vouvoiement (par défaut) ou tutoiement. Ne concerne
 * que le français : la ligne est masquée quand l'interface est en anglais
 * (classe fr-only, voir settings.css ; i18n.ts met à jour <html lang>).
 */
function addressRow(s: Settings): HTMLElement {
  const r = row(
    "S'adresser à moi",
    choice(s.general.address === "tu" ? "tu" : "vous", [["vous", "Vouvoiement"], ["tu", "Tutoiement"]], (v) => save((d) => (d.general.address = v === "tu" ? "tu" : "vous"))),
    "Les aides et les messages disent « vous » ou « tu ». Les boutons ne changent pas.",
  );
  r.classList.add("fr-only");
  return r;
}

/** Ondine → Général : le prénom, la langue, le tutoiement, le démarrage. */
function general(main: HTMLElement) {
  const s = settingsStore.current;
  main.append(
    group("Langue et démarrage", [
      row(
        "Langue",
        choice(s.general.language ?? "auto", [["auto", "Automatique"], ["fr", "Français"], ["en", "English"]], (v) => save((d) => (d.general.language = v as Settings["general"]["language"]))),
        "Automatique : la langue choisie à l'installation, sinon celle de Windows. Le changement s'applique sans recharger les fenêtres.",
      ),
      addressRow(s),
      ...firstRunRows(s),
      row(
        "Lancer avec Windows",
        toggle(s.general.autostart !== false, (v) => save((d) => (d.general.autostart = v)), "Lancer avec Windows"),
        "Ondine s'ouvre toute seule quand vous ouvrez votre session.",
      ),
    ]),
  );
}

/**
 * L'île → Comportement : où vit l'île et quand elle se replie, puis « Ondine
 * et les fenêtres » (module windowlife), en section de la page : ses réglages
 * restent dans le module, son interrupteur « Activé » aussi.
 */
function behavior(main: HTMLElement) {
  const s = settingsStore.current;
  main.append(
    inSub("island", group("Comportement de l'île", [
      row(
        "Sur quel écran ?",
        choice(s.general.screen, [["primary", "Écran principal"], ["cursor", "Suit la souris"]], (v) => save((d) => (d.general.screen = v as Settings["general"]["screen"]))),
        "Seulement si vous avez plusieurs écrans : l'île reste sur l'écran principal, ou suit l'écran où se trouve votre souris.",
      ),
      // Plusieurs écrans : un reflet de l'île sur les autres (src-tauri/src/island/mirrors.rs, 1.2.3).
      row(
        "Reflet sur les autres écrans",
        toggle(s.island.otherScreens ?? false, (v) => save((d) => (d.island.otherScreens = v)), "Reflet sur les autres écrans"),
        "Une petite encoche avec Ondine sur chacun de vos autres écrans. Approchez la souris du reflet : l'île vient s'ouvrir sur cet écran.",
      ),
      row(
        "Toujours en mini",
        toggle(s.island.alwaysMini ?? true, (v) => save((d) => (d.island.alwaysMini = v)), "Toujours en mini"),
        "L'île reste en petite pilule au lieu de disparaître. Elle se cache seulement en mode présentation.",
      ),
      row(
        "Replier l'île",
        stepper(s.island.collapseSecs, 0.5, 30, (v) => save((d) => (d.island.collapseSecs = v)), 0.5, "s"),
        "Quand la souris n'est plus dessus, après ce délai.",
      ),
      row("Durée des notifications", stepper(s.island.notificationSecs, 2, 60, (v) => save((d) => (d.island.notificationSecs = v)), 1, "s")),
      row(
        "Raccourci pour ouvrir l'île",
        choice(
          s.island.hotkey || "off",
          [["Ctrl+Alt+O", "Ctrl+Alt+O"], ["Ctrl+Shift+O", "Ctrl+Maj+O"], ["Alt+Shift+O", "Alt+Maj+O"], ["Ctrl+Alt+I", "Ctrl+Alt+I"], ["off", "Aucun"]],
          (v) => save((d) => (d.island.hotkey = v === "off" ? "" : v)),
        ),
        "Partout dans Windows : un appui ouvre l'île, un second la referme.",
      ),
      wideRow(
        "Bord de l'écran",
        vignettes(
          s.island.edge,
          [["top", "En haut"], ["bottom", "En bas"], ["left", "À gauche"], ["right", "À droite"]].map(([v, l]) => ({ value: v, label: l, art: edgeArt(v) })),
          (v) =>
            save((d) => {
              d.island.edge = v as Settings["island"]["edge"];
              d.island.align = "center";
              d.island.offset = 0.5;
            }, true),
          "Bord de l'écran",
        ),
        "Vous pouvez aussi attraper l'île par son bord collé à l'écran et la poser ailleurs : elle s'aimante aux bords, aux coins et au centre.",
      ),
      row(
        "Ondine évite la fenêtre de réglages",
        toggle(s.island.avoidSettings ?? true, (v) => save((d) => (d.island.avoidSettings = v)), "Ondine évite la fenêtre de réglages"),
        "Si cette fenêtre la cache, l'île glisse le long du bord pour lui laisser la place, puis revient à sa place quand vous la fermez.",
      ),
      row(
        "Mode présentation",
        toggle(s.island.presentationQuiet ?? true, (v) => save((d) => (d.island.presentationQuiet = v)), "Mode présentation"),
        "Pendant un diaporama, une vidéo ou un jeu en plein écran, l'île se cache et garde les notifications pour la fin.",
      ),
    ])),
  );
  const man = manifestOf("windowlife");
  if (!man) return;
  main.append(
    inSub("windows", group(null, [row("Activé", enableToggle(man), "Désactivé, Ondine ne réagit plus à vos fenêtres.")])),
    inSub("windows", group(man.name, fieldRows(man, man.settings?.fields ?? []))),
  );
}

/** Système → Performances et journal. */
function perf(main: HTMLElement) {
  const s = settingsStore.current;
  main.append(
    perfGroup(save),
    group(
      "Journal",
      [
        row(
          "Niveau du journal",
          choice(
            s.general.logLevel,
            [["error", "Erreurs"], ["warn", "Avertissements"], ["info", "Informations"], ["debug", "Débogage"]],
            (v) => save((d) => (d.general.logLevel = v as Settings["general"]["logLevel"])),
          ),
        ),
        row("Dossier du journal", el("button", { class: "btn small", onclick: () => void Bridge.openLogsFolder() }, "Ouvrir")),
      ],
      "Le journal reste sur votre PC (%LOCALAPPDATA%\\Ondine\\logs). Il ne contient jamais de clé ni de contenu de fichier.",
    ),
  );
}

/**
 * Les mises à jour : le réglage automatique, et un bouton pour chercher tout
 * de suite (src-tauri/src/update.rs). L'île propose aussi les nouvelles
 * versions d'elle-même (src/core/updates.ts).
 */
function updatesGroup(): HTMLElement {
  const s = settingsStore.current;
  const version = el("span", { class: "muted" }, "");
  void Bridge.boot().then((b) => {
    if (b) version.textContent = b.version;
  });
  const status = el("span", { class: "muted", "aria-live": "polite" }, "");
  const install = el(
    "button",
    {
      class: "btn small",
      onclick: async () => {
        install.disabled = true;
        status.textContent = "Téléchargement… Ondine va se fermer puis revenir.";
        try {
          await Bridge.updateInstall();
        } catch (err) {
          status.textContent = `La mise à jour a échoué : ${errorText(err)}`;
          install.disabled = false;
        }
      },
    },
    "Installer",
  );
  install.hidden = true;
  const search = el(
    "button",
    {
      class: "btn small",
      onclick: async () => {
        search.disabled = true;
        install.hidden = true;
        status.textContent = "Recherche…";
        try {
          const info = await Bridge.updateCheck();
          status.textContent = info ? `La version ${info.version} est disponible.` : "Ondine est à jour.";
          install.hidden = !info;
          updateNote = info ? { tone: "new", version: info.version } : { tone: "ok" };
        } catch {
          status.textContent = "Impossible de joindre GitHub. Vérifiez votre connexion à Internet.";
          updateNote = { tone: "error" };
        }
        rail.querySelector(".nav-status")?.replaceWith(statusPill());
        search.disabled = false;
      },
    },
    "Rechercher maintenant",
  );
  return group("Mises à jour", [
    row(
      "Mises à jour automatiques",
      toggle(s.general.autoUpdate !== false, (v) => save((d) => (d.general.autoUpdate = v)), "Mises à jour automatiques"),
      "Au démarrage puis une fois par jour, Ondine regarde sur GitHub si une nouvelle version existe et vous la propose. Rien ne s'installe sans votre accord.",
    ),
    row("Version installée", el("div", { class: "chips" }, version, search, install, status)),
  ]);
}

/**
 * Le mode démo : l'île montre de fausses données (src/core/demo.ts), pour les
 * captures d'écran et la vidéo. Les scènes font apparaître une notification
 * à filmer.
 */
function demoGroup(): HTMLElement {
  const on = settingsStore.current.general.demo === true;
  const scene = (id: string, label: string) =>
    el("button", { class: "btn small", onclick: () => bus.emit("demo.scene", { scene: id }, "settings") }, label);
  return group(
    "Captures d'écran",
    [
      row(
        "Mode démo",
        toggle(on, (v) => save((d) => (d.general.demo = v), true), "Mode démo"),
        "L'île montre de fausses données (musique, agenda, notes, presse-papiers…) au lieu des vôtres. Aucune action n'est faite pour de vrai.",
      ),
      ...(on
        ? [
            // Ligne large : les quatre boutons passent sous le titre au lieu de l'écraser.
            wideRow(
              "Jouer une scène",
              el(
                "div",
                { class: "chips" },
                scene("claude-done", "Claude a fini"),
                scene("claude-permission", "Demande d'autorisation"),
                scene("download", "Fichier téléchargé"),
                scene("next-track", "Morceau suivant"),
                scene("whats-new", "Quoi de neuf"),
                scene("halos-battery", "Halos de batterie"),
                scene("halos-tour", "Autres halos"),
                scene("timer-ring", "Liseré d'un minuteur"),
                scene("liquid-timer", "Minuteur qui se remplit"),
                scene("liquid-moods", "Ambiances dans l'île"),
                scene("liquid-float", "Ondine qui flotte"),
                scene("voice", "Parler à Ondine"),
                scene("voice-error", "La dictée échoue"),
                scene("mascot-talk", "Ondine parle"),
                scene("team-visit", "Visite d'une collègue"),
                scene("team-chat", "Message d'une collègue"),
                scene("ai-outage", "Panne d'un service IA"),
                scene("island-dodge", "L'île s'écarte"),
                scene("setup", "Premier lancement"),
                scene("dances", "Danses selon la musique"),
                scene("ondine-walk", "Ondine se déplace (toutes les scènes)"),
              ),
              "La notification arrive dans l'île : lancez l'enregistrement avant de cliquer.",
            ),
            // Ondine se déplace dans l'île (src/island/scenes/) : une scène à la fois.
            row(
              "Une scène d'Ondine",
              choice(
                "",
                [["", "Choisir…"], ...SCENE_IDS.map((id): [string, string] => [id, `${SCENES[id].n}. ${SCENES[id].label}`])],
                (v) => v && bus.emit("demo.scene", { scene: `ondine:${v}` }, "settings"),
              ),
              "Ondine quitte sa case, va jusqu'à l'élément de l'île et agit. Le dépôt de fichier demande un vrai glisser.",
            ),
          ]
        : []),
    ],
    "Pensez à éteindre le mode démo après vos captures.",
  );
}

/** La couleur de l'île (thèmes tout faits ou couleur choisie) et les petits sons. */
function look(main: HTMLElement) {
  const s = settingsStore.current;
  // Les thèmes en vignettes (vignettes.ts) : une petite île à leurs couleurs.
  const themes = [...THEMES.map((t) => ({ id: t.id, name: t.name })), { id: "custom", name: "Personnalisée" }].map(({ id, name }) => {
    const t = themeFor(id, s.island.color);
    return { value: id, label: name, art: themeArt(), vars: { "--vg-bg": t.bg, "--vg-accent": t.accent } };
  });
  const picker = el("input", { type: "color", class: "color-input", "aria-label": "Couleur personnalisée" }) as HTMLInputElement;
  picker.value = s.island.color || "#0c0d12";
  picker.addEventListener("change", () =>
    save((d) => {
      d.island.color = picker.value;
      d.island.theme = "custom";
    }, true),
  );
  setSoundPrefs(s.island.sounds, s.island.soundVolume);
  main.append(
    group("Thème", [wideRow(null, vignettes(s.island.theme, themes, (v) => save((d) => (d.island.theme = v), true), "Thème"), undefined, "Thème")]),
    group(
      null,
      [row("Couleur personnalisée", picker, "Choisissez n'importe quelle couleur : si elle est trop claire, l'île l'assombrit juste assez pour que le texte reste lisible.")],
    ),
    // Format nano et île-bouche (1.2.3, src/island/island-forms.ts).
    group("Forme de l'île", [
      wideRow(
        "Taille de la mini-île",
        vignettes(s.island.size ?? "normal", [["normal", "Normale"], ["nano", "Nano"]].map(([v, l]) => ({ value: v, label: l, art: sizeArt(v) })), (v) => save((d) => (d.island.size = v as "normal" | "nano")), "Taille de la mini-île"),
        "Nano : une toute petite encoche qui ne montre qu'Ondine. Elle s'élargit au survol, pour une notification, un morceau qui commence ou un minuteur, puis revient à l'encoche.",
      ),
      wideRow(
        "Style de l'île",
        vignettes(s.island.style ?? "classic", [["classic", "Classique"], ["mouth", "Bouche d'Ondine"]].map(([v, l]) => ({ value: v, label: l, art: styleArt(v) })), (v) => save((d) => (d.island.style = v as "classic" | "mouth"), true), "Style de l'île"),
        "Bouche d'Ondine : Ondine est suspendue tête en bas au bord de l'écran, et l'île est sa bouche. Elle l'ouvre pour vous montrer ce qui se passe.",
      ),
      ...(s.island.style === "mouth"
        ? [
            row(
              "Quand Ondine est sortie",
              toggle(s.island.mouthFollow !== false, (v) => save((d) => (d.island.mouthFollow = v)), "L'île part avec elle"),
              "L'île part avec elle : sur le bureau, c'est Ondine qui ouvre la bouche, là où elle se trouve. Sinon, une bouche vide reste au bord de l'écran.",
            ),
          ]
        : []),
    ]),
    group("Icônes", [
      wideRow(
        "Style des icônes",
        vignettes(s.island.iconPack ?? "color", [["color", "Couleur"], ["line", "Épurées"]].map(([v, l]) => ({ value: v, label: l, art: iconPackArt(v) })), (v) => save((d) => (d.island.iconPack = v as "color" | "line")), "Style des icônes"),
        "Couleur : les icônes dessinées pour Ondine. Épurées : au trait, sobres, qui prennent la couleur du texte (Phosphor, licence MIT).",
      ),
    ]),
    group("Animations", [
      row(
        "Style des animations",
        segmented(s.island.motion ?? "classic", [["classic", "Classique"], ["studio", "Studio"]], (v) => save((d) => (d.island.motion = v as "classic" | "studio"))),
        "Classique : sobre. Studio : façon vidéo de présentation, les éléments arrivent flous puis nets l'un après l'autre, les chiffres roulent, les boutons rebondissent comme de la gélatine.",
      ),
      // L'île en gelée (src/island/jelly.ts, réglages dans spring.ts).
      row(
        "Élasticité de l'île",
        segmented(s.island.elasticity ?? "normal", [["soft", "Doux"], ["normal", "Normal"], ["jelly", "Gelée"]], (v) => save((d) => (d.island.elasticity = v as Settings["island"]["elasticity"]))),
        "Doux : l'île se pose sans rebondir. Normal : un petit rebond. Gelée : elle tremblote, se creuse sous vos clics et s'étire comme de la guimauve. Si Windows réduit les animations, rien ne bouge.",
      ),
      // L'éclosion de l'île au premier lancement et après une mise à jour (src/island/hatch.ts).
      row(
        "Éclosion au démarrage",
        el(
          "div",
          { class: "inline" },
          toggle(s.island.hatch !== false, (v) => save((d) => (d.island.hatch = v)), "Éclosion au démarrage"),
          el("button", { class: "btn small", onclick: () => bus.emit("app.hatch", { kind: "first" }, "settings") }, "Voir"),
        ),
        "Au premier lancement et après une mise à jour, une goutte sort du haut de l'écran et devient l'île, Ondine vous dit bonjour, puis l'île se replie. Avec l'île en haut de l'écran seulement.",
      ),
      // Le halo de lumière autour de l'île : ses réglages sont ceux du module « Animations de l'île ».
      row(
        "Halo autour de l'île",
        el("button", { class: "btn small", onclick: () => go("animations") }, "Régler les animations et halos"),
        "Un liseré de lumière en couleurs qui bougent : batterie, agents, sortie de veille, téléchargements… Chaque moment se coupe à part.",
      ),
    ]),
    // La fenêtre des Réglages elle-même (1.2.4, frame.ts) : une préférence de cette fenêtre.
    group("Fenêtre des Réglages", [
      row("Fond des Réglages", backdropChoice(), "Noir profond : un fond sombre et calme derrière les pages. Dégradés : les taches de couleur d'avant, derrière du verre."),
    ]),
    group("Sons", [
      row("Sons de clic", toggle(s.island.sounds, (v) => save((d) => (d.island.sounds = v)), "Sons de clic"), "De petits « plop » à l'ouverture, à la fermeture et sur les boutons. Fabriqués sur place, ou vos propres fichiers (ci-dessous)."),
      row(
        "Volume des sons",
        stepper(Math.round(s.island.soundVolume * 100), 5, 100, (v) => save((d) => (d.island.soundVolume = v / 100)), 5, "%"),
      ),
      row(
        "Écouter",
        el(
          "button",
          {
            class: "btn small",
            onclick: () => {
              const cur = settingsStore.current.island;
              setSoundPrefs(true, cur.soundVolume);
              sounds.open();
              window.setTimeout(() => sounds.tap(), 300);
              window.setTimeout(() => sounds.drop(), 600);
              window.setTimeout(() => sounds.close(), 950);
              window.setTimeout(() => setSoundPrefs(cur.sounds, cur.soundVolume), 1300);
            },
          },
          "▶ Essayer",
        ),
      ),
      // Vos propres sons (sounds-page.ts, 1.2.4).
      ...customSoundRows(() => bus.emit("sounds.reload", null, "settings")),
    ]),
  );
}

/**
 * Les modules : un interrupteur chacun, et l'ordre des onglets (glisser une
 * ligne, ou ses flèches). On peut aussi glisser les onglets dans l'île.
 */
function tabs(main: HTMLElement) {
  const withTab = ALL_MODULES.filter((m) => m.views?.expanded).map((m) => m.manifest);
  const without = ALL_MODULES.filter((m) => !m.views?.expanded).map((m) => m.manifest);
  const ordered = applyTabOrder(withTab, (m) => m.id, settingsStore.current.island.tabOrder ?? []);
  const list = el("div", { class: "group-body order-list" });
  const saveOrder = (ids: string[], redraw: boolean) => {
    const all = applyTabOrder(ALL_MODULES.map((m) => m.manifest.id), (id) => id, settingsStore.current.island.tabOrder ?? []);
    save((d) => (d.island.tabOrder = mergeOrder(ids, all)), redraw);
  };
  const idsShown = () => [...list.children].map((li) => (li as HTMLElement).dataset.id!);
  let dragged: HTMLElement | null = null;

  ordered.forEach((man, i) => {
    const move = (delta: number) => {
      const ids = ordered.map((m) => m.id);
      const [id] = ids.splice(i, 1);
      ids.splice(i + delta, 0, id);
      saveOrder(ids, true);
    };
    const item = el(
      "div",
      { class: "row order-item", draggable: "true", "data-id": man.id, "data-key": man.name },
      el("span", { class: "order-grip", title: "Glisser pour déplacer", "aria-hidden": "true" }, "⠿"),
      el("span", { class: "result-icon" }, iconNode(man.icon)),
      el("div", { class: "row-text" }, el("div", { class: "row-label" }, man.name)),
      el(
        "div",
        { class: "order-arrows" },
        el("button", { class: "icon-btn", title: "Monter", "aria-label": `Monter ${man.name}`, disabled: i === 0, onclick: () => move(-1) }, "↑"),
        el("button", { class: "icon-btn", title: "Descendre", "aria-label": `Descendre ${man.name}`, disabled: i === ordered.length - 1, onclick: () => move(1) }, "↓"),
      ),
      enableToggle(man),
    );
    item.addEventListener("dragstart", (e) => {
      dragged = item;
      item.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", man.id);
    });
    item.addEventListener("dragover", (e) => {
      if (!dragged || dragged === item) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      // Les autres lignes s'écartent en glissant (FLIP) au lieu de sauter.
      const rows = [...list.children] as HTMLElement[];
      const before = new Map(rows.map((x) => [x, x.offsetTop]));
      list.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? item : item.nextSibling);
      if (!reducedMotion()) {
        for (const x of rows) {
          const dy = (before.get(x) ?? 0) - x.offsetTop;
          if (dy && x !== dragged) x.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        }
      }
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      dragged = null;
      const ids = idsShown();
      if (ids.join(",") !== ordered.map((m) => m.id).join(",")) saveOrder(ids, true);
    });
    list.append(item);
  });

  main.append(
    el(
      "section",
      { class: "group", "data-essential": "", "data-sub": "order" },
      el("h3", { class: "group-title" }, "Ordre des onglets"),
      list,
      el("p", { class: "group-note" }, "Glissez une ligne, ou utilisez ↑ ↓. Vous pouvez aussi faire glisser les onglets directement dans l'île."),
    ),
    el("div", { class: "actions", "data-sub": "order" }, el("button", { class: "btn", onclick: () => save((d) => (d.island.tabOrder = []), true) }, "Ordre d'origine")),
  );
  if (without.length) {
    // L'icône du module en vraie icône (image en couleur, trait en épuré), pas en emoji.
    const sans = group("Sans onglet", without.map((man) => {
      const line = row(man.name, enableToggle(man), undefined, man.name);
      line.querySelector(".row-label")?.prepend(el("span", { class: "row-icon", "aria-hidden": "true" }, iconNode(man.icon)));
      return line;
    }));
    sans.dataset.essential = ""; // mode Simple : la liste des modules reste entière
    main.append(inSub("notab", sans));
  }
  main.append(inSub("tips", tipsGroup()));
  main.append(inSub("suggest", suggestionsGroup()));
}

/**
 * Les astuces (src/island/tips.ts) : la bulle d'Ondine à la première ouverture
 * d'un onglet, et « Revoir les astuces », qui oublie les onglets déjà vus.
 */
function tipsGroup(): HTMLElement {
  const s = settingsStore.current;
  const status = el("span", { class: "muted", "aria-live": "polite" }, "");
  const again = el(
    "button",
    {
      class: "btn small",
      onclick: () => {
        save((d) => (d.island.tipsSeen = []));
        status.textContent = "Les astuces reviendront à la prochaine ouverture de chaque onglet.";
      },
    },
    "Revoir les astuces",
  );
  return group("Astuces", [
    row(
      "Astuces à la première ouverture d'un onglet",
      toggle(s.island.tips !== false, (v) => save((d) => (d.island.tips = v)), "Astuces à la première ouverture d'un onglet"),
      "La première fois que vous ouvrez un onglet, une petite bulle d'Ondine explique son geste principal.",
    ),
    row("Revoir les astuces", el("div", { class: "chips" }, again, status)),
  ]);
}

// ── Premier lancement (src/core/setup.ts, src/core/suggestions.ts) ───────────

/**
 * Général : le prénom donné à l'assistant de premier lancement (« Bonjour
 * Simon ! », le bilan, la bulle du bureau), et « Refaire l'assistant », qui
 * le rouvre dans l'île (sujet « app.setup »).
 */
function firstRunRows(s: Settings): HTMLElement[] {
  const name = el("input", { type: "text", class: "text", maxlength: 40, placeholder: "Votre prénom", "aria-label": "Prénom", autocomplete: "given-name" }) as HTMLInputElement;
  name.value = s.general.firstName ?? "";
  name.addEventListener("change", () => save((d) => (d.general.firstName = cleanFirstName(name.value))));
  const status = el("span", { class: "muted", "aria-live": "polite" }, "");
  const again = el(
    "button",
    {
      class: "btn small",
      onclick: () => {
        bus.emit("app.setup", null, "settings");
        status.textContent = "L'assistant s'ouvre dans l'île.";
      },
    },
    "Refaire l'assistant",
  );
  return [
    row("Prénom", name, "Ondine dit bonjour avec, dans l'île, le bilan de la semaine et la bulle du bureau. Il reste sur ce PC."),
    row("Premiers pas", el("div", { class: "chips" }, again, status), "Votre prénom, ce que vous faites sur ce PC (les onglets), la mascotte, la place de l'île et la clé de Parler à Ondine."),
  ];
}

/**
 * Onglets : les propositions d'Ondine (le bon onglet au bon moment, masquer
 * un onglet oublié), jamais faites toutes seules, une fois chacune.
 */
function suggestionsGroup(): HTMLElement {
  const s = settingsStore.current;
  const status = el("span", { class: "muted", "aria-live": "polite" }, "");
  const again = el(
    "button",
    {
      class: "btn small",
      onclick: () => {
        save((d) => (d.island.suggested = []));
        status.textContent = "Ondine pourra refaire ses propositions.";
      },
    },
    "Revoir les propositions",
  );
  return group("Propositions", [
    row(
      "Propositions d'Ondine",
      toggle(s.island.suggestions !== false, (v) => save((d) => (d.island.suggestions = v)), "Propositions d'Ondine"),
      "À la première clé USB, la première visio ou le premier fichier glissé sur l'île, Ondine propose l'onglet qui va avec. Un onglet jamais ouvert depuis 3 semaines : elle propose de le masquer. Toujours à accepter, une seule fois chacune, compté sur ce PC.",
    ),
    row("Revoir les propositions", el("div", { class: "chips" }, again, status)),
  ]);
}

/** L'interrupteur « module activé ». */
function enableToggle(man: ModuleManifest): HTMLElement {
  return toggle(
    settingsStore.moduleEnabled(man.id),
    (v) =>
      save((d) => {
        d.modules[man.id] = { enabled: v, values: d.modules[man.id]?.values ?? {} };
      }),
    `Activer ${man.name}`,
  );
}

/** La page d'un module. `compact` : seulement l'interrupteur et les réglages (page Règles). */
function modulePage(main: HTMLElement, man: ModuleManifest, compact = false) {
  const perms = man.permissions.length
    ? man.permissions.map((p) => chip(PERMISSION_LABELS[p] ?? p, p === "claude-api" ? "warn" : ""))
    : [chip("Aucune permission", "ok")];
  // La description complète, repliée sur trois lignes si elle est longue.
  const about = el("p", { class: "about clamp" }, man.description);
  const more = el("button", { class: "link-btn" }, "Lire la suite");
  more.addEventListener("click", () => {
    const open = about.classList.toggle("clamp");
    more.textContent = open ? "Lire la suite" : "Réduire";
  });
  // Une page longue (MODULE_SECTIONS) : un bloc par sous-menu.
  const sections = compact ? undefined : MODULE_SECTIONS[man.id];
  // La ligne « Activé » reste collée en haut de la page en défilant (1.2.4),
  // dans tous les sous-menus, avec les autorisations du module en pastilles.
  const enabled = row("Activé", enableToggle(man), "Désactivé, le module s'arrête et son onglet disparaît.", "Activé");
  if (!compact) enabled.querySelector(".row-text")?.append(el("div", { class: "chips module-perms", "data-key": "Permissions", role: "list", "aria-label": "Permissions" }, ...perms.map((c) => (c.setAttribute("role", "listitem"), c))));
  main.append(el("section", { class: "group module-bar", "data-essential": "" }, el("div", { class: "group-body" }, enabled)));
  if (!compact) {
    const top = group(null, [wideRow("À propos", el("div", {}, about, man.description.length > 220 ? more : null))]);
    main.append(sections ? inSub(sections[0].id, top) : top);
  }
  // Des champs montrés sur une autre page (layout.ts, MOVED_FIELDS) : un lien à leur place.
  const moved = MOVED_FIELDS[man.id];
  const fields = (man.settings?.fields ?? []).filter((f) => !moved?.keys.includes(f.key) && (compact || !PAGE_DRAWN[man.id]?.includes(f.key)));
  if (!fields.length) {
    if (!compact) main.append(el("p", { class: "empty" }, "Ce module n'a pas de réglage."));
    return;
  }
  const rowsOf = (list: typeof fields) => fieldRows(man, list);
  const elsewhere = moved
    ? row(moved.label, el("button", { class: "btn small", onclick: () => go(moved.page, undefined, moved.sub) }, `Ouvrir ${pageById(moved.page)?.label ?? ""}`), "Ils se règlent maintenant avec les autres animations de l'île.")
    : null;
  if (!sections) main.append(group("Réglages", [...rowsOf(fields), elsewhere]));
  else {
    const listed = new Set(sections.slice(1).flatMap((s) => s.keys));
    sections.forEach((s, i) => {
      const mine = i === 0 ? fields.filter((f) => !listed.has(f.key)) : fields.filter((f) => s.keys.includes(f.key));
      if (mine.length) main.append(inSub(s.id, group(i === 0 ? "Réglages" : null, rowsOf(mine))));
    });
  }
  if (!compact && man.id === "weekly") main.append(weeklyGroup(man));
  // Notifications de Windows : ce que Windows autorise, et le bouton vers ses Paramètres.
  if (!compact && man.id === "winnotifs") main.append(winnotifsGroup());
  // Étagère : les pilules montrées quand on glisse un fichier sur l'île, et leur ordre.
  if (!compact && man.id === "shelf") main.append(dropPillsGroup((change) => save(change)));
  // Animations de l'île : l'aperçu du halo, en direct, avec les réglages choisis.
  // Parler à Ondine : ce qui part et la consigne exacte (askclaude-page.ts).
  if (!compact && man.id === "askclaude") main.append(...askclaudeGroups((key, value) => save((d) => ((d.modules.askclaude ??= { enabled: settingsStore.moduleEnabled("askclaude"), values: {} }).values[key] = value), true)));
  if (!compact) main.append(el("p", { class: "version" }, `${man.name} · version ${man.version}`));
}

/** Les lignes des champs `list` d'un module ; chaque changement est enregistré dans ce module. */
function fieldRows(man: ModuleManifest, list: SettingField[]): HTMLElement[] {
  const rows = settingsRows(list, settingsStore.moduleValues(man), (key, value) =>
    save((d) => {
      const entry = (d.modules[man.id] ??= { enabled: settingsStore.moduleEnabled(man.id), values: {} });
      entry.values[key] = value;
    }),
  );
  // Le champ de chaque ligne : sa valeur d'origine est dans le manifeste (pastille « Modifié »).
  rows.forEach((r, i) => (r.dataset.field = `${man.id}.${list[i].key}`));
  return rows;
}

// ── Animations et halos (layout.ts, ANIMATION_SUBS) ──────────────────────────

/**
 * L'île → Animations et halos : le module Animations de l'île (halos, liquide,
 * liseré des minuteurs) et les halos de batterie du module Système, rangés en
 * sous-menus. Chacun commence par « Tout » ; dans Style, c'est l'interrupteur
 * du module lui-même. Les réglages restent dans leur module.
 */
function animations(main: HTMLElement) {
  const halos = manifestOf("halos");
  if (!halos) return;
  const listed = new Set(ANIMATION_SUBS.flatMap((s) => s.blocks.filter((b) => b.module === "halos").flatMap((b) => b.keys)));
  for (const sub of ANIMATION_SUBS) {
    const blocks: HTMLElement[] = [];
    for (const b of sub.blocks) {
      const man = manifestOf(b.module);
      if (!man) continue;
      const all = man.settings?.fields ?? [];
      const mine = b.keys.map((k) => all.find((f) => f.key === k)).filter((f): f is SettingField => !!f);
      // Un champ de « halos » rangé nulle part (ajouté plus tard) : dans Style.
      if (sub.id === ANIMATION_SUBS[0].id && b === sub.blocks[0]) mine.push(...all.filter((f) => b.module === "halos" && !listed.has(f.key)));
      if (!mine.length) continue;
      // Un autre module (Système) éteint : ses halos attendent, la ligne le dit.
      const off = b.module !== "halos" && !settingsStore.moduleEnabled(b.module);
      const block = group(b.title, fieldRows(man, mine), off ? `Le module ${man.name} est désactivé : ces halos reviendront quand vous le rallumerez (Modules → ${man.name}).` : undefined);
      if (off) block.classList.add("module-off");
      blocks.push(block);
    }
    const top =
      sub.id === "style"
        ? row("Tout", enableToggle(halos), "Éteint d'un coup tous les halos et le liquide de l'île. Désactivé, le module Animations de l'île s'arrête.", allKey(sub.id))
        : allRow(sub.id, sub.blocks, blocks);
    main.append(inSub(sub.id, group(null, [top])), ...blocks.map((b) => inSub(sub.id, b)));
  }
  // L'aperçu du halo, en direct, avec les réglages choisis.
  main.append(inSub("style", haloPreviewGroup()));
}

/** La valeur « éteint » d'un champ pour « Tout » (oui/non : false ; un choix avec « Jamais » : never), ou undefined. */
function offValue(f: SettingField): unknown {
  if (f.type === "boolean") return false;
  if (f.type === "select") return f.options.find((o) => o.value === "never" || o.value === "off")?.value;
  return undefined;
}

/**
 * « Tout » d'un sous-menu : allumé si au moins un moment l'est. Le couper
 * éteint tous les moments du sous-menu (oui/non et choix avec « Jamais ») ;
 * le rallumer les remet tous (un choix éteint reprend sa valeur par défaut).
 */
function allRow(sub: string, specs: { module: string; keys: string[] }[], blocks: HTMLElement[]): HTMLElement {
  const targets = specs.flatMap((b) => {
    const man = manifestOf(b.module);
    return (man?.settings?.fields ?? []).filter((f) => b.keys.includes(f.key) && offValue(f) !== undefined).map((f) => ({ man: man!, f }));
  });
  const isOn = () =>
    targets.some(({ man, f }) => {
      const v = settingsStore.moduleValues(man)[f.key];
      return v !== offValue(f);
    });
  const sw = toggle(isOn(), (on) => {
    save((d) => {
      for (const { man, f } of targets) {
        const entry = (d.modules[man.id] ??= { enabled: settingsStore.moduleEnabled(man.id), values: {} });
        const now = settingsStore.moduleValues(man)[f.key];
        const def = "default" in f ? f.default : undefined;
        const fallback = def !== offValue(f) ? def : f.type === "select" ? f.options.find((o) => o.value !== offValue(f))?.value : true;
        entry.values[f.key] = on ? (now === offValue(f) ? fallback : now) : offValue(f);
      }
    }, true);
  }, "Tout");
  // Un moment changé à la main : « Tout » suit (allumé si au moins un l'est).
  const input = sw.querySelector("input");
  for (const b of blocks) b.addEventListener("change", () => input && (input.checked = isOn()));
  return row("Tout", sw, "Coupe ou rallume d'un coup tous les moments de ce sous-menu.", allKey(sub));
}

/**
 * Bilan de la semaine : « Voir le bilan maintenant » montre dans l'île la
 * semaine en cours (sujet « weekly.show », voir src/modules/weekly), sans
 * rien changer au vrai bilan.
 */
function weeklyGroup(man: ModuleManifest): HTMLElement {
  const status = el("span", { class: "muted", "aria-live": "polite" }, "");
  const now = el(
    "button",
    {
      class: "btn small",
      onclick: () => {
        if (!settingsStore.moduleEnabled(man.id)) {
          status.textContent = "Activez d'abord le module.";
          return;
        }
        status.textContent = "";
        bus.emit("weekly.show", null, "settings");
      },
    },
    "Voir le bilan maintenant",
  );
  return group("Aperçu", [
    row(
      "Voir le bilan maintenant",
      el("div", { class: "chips" }, now, status),
      "Ce qui est compté depuis le dernier bilan : la notification s'affiche dans l'île. Le vrai bilan arrivera quand même à l'heure dite.",
    ),
  ]);
}

/**
 * Animations de l'île : une petite île factice et son halo (haloPreview dans
 * island/halo.ts), qui change de forme toutes les 4 s. Changer « Où dessiner
 * le halo », l'intensité ou les couleurs se voit tout de suite.
 */
function haloPreviewGroup(): HTMLElement {
  const island = el("div", { class: "halo-preview-island" }, el("span", { class: "halo-preview-dot" }), el("span", { class: "halo-preview-line" }));
  const box = el("div", { class: "halo-preview", "aria-hidden": "true" }, island);
  // Une fois dans la page (sa taille est connue).
  requestAnimationFrame(() => {
    if (box.isConnected) haloPreview(box, island);
  });
  const g = group("Aperçu", [
    wideRow("Aperçu du halo", box, "Comète, musique, liseré d'un minuteur, éclat : le halo dessiné comme sur l'île, avec les réglages choisis ici."),
  ]);
  // Visible aussi en mode Simple, sous « Où dessiner le halo ».
  g.dataset.essential = "";
  return g;
}

/** Mode Simple : le bloc reste entier (une liste courte, sans réglage « avancé »). */
function essential<T extends HTMLElement>(node: T): T {
  node.dataset.essential = "";
  return node;
}

/** Ondine sur le bureau (src/pet/) : la mascotte sort de l'île. */
function petGroup(): HTMLElement {
  const s = settingsStore.current;
  return group(
    "Ondine sur le bureau",
    [
      row(
        "Ondine vit sur le bureau",
        toggle(!!s.mascot.pet, (v) =>
          save((d) => {
            d.mascot.pet = v;
            if (v) d.mascot.enabled = true;
          }),
        "Ondine vit sur le bureau"),
        "Seulement la mascotte, posée où vous voulez : attrapez-la pour la déplacer, cliquez sur elle pour ouvrir sa bulle. Vous pouvez aussi la tirer hors de l'île, et l'y glisser pour la faire rentrer.",
      ),
      row(
        "Au-dessus des fenêtres",
        toggle(s.mascot.petOnTop ?? true, (v) => save((d) => (d.mascot.petOnTop = v)), "Au-dessus des fenêtres"),
        "Sinon, elle reste derrière les fenêtres, sur le fond d'écran.",
      ),
      row(
        "Raccourci pour ouvrir sa bulle",
        choice(
          s.mascot.petHotkey || "off",
          [["Ctrl+Alt+B", "Ctrl+Alt+B"], ["Ctrl+Shift+B", "Ctrl+Maj+B"], ["Alt+Shift+B", "Alt+Maj+B"], ["off", "Aucun"]],
          (v) => save((d) => (d.mascot.petHotkey = v === "off" ? "" : v)),
        ),
      ),
      row(
        "Elle se promène quand vous ne touchez plus au PC",
        toggle(s.mascot.petWander ?? true, (v) => save((d) => (d.mascot.petWander = v)), "Elle se promène quand vous ne touchez plus au PC"),
        "Quelques pas le long de son bord, de temps en temps. Jamais bulle ouverte, en présentation, ni en « Calme ».",
      ),
    ],
  );
}

/** La bulle d'Ondine sur le bureau : les onglets choisis ici (`mascot.petTabs`, dans cet ordre). */
function petTabsGroup(): HTMLElement {
  const tabs = settingsStore.current.mascot.petTabs ?? [];
  const withView = ALL_MODULES.filter((m) => m.views?.expanded);
  // Les onglets choisis d'abord (leur ordre est celui de la bulle), puis les autres.
  const ordered = [...tabs.map((id) => withView.find((m) => m.manifest.id === id)).filter((m) => !!m), ...withView.filter((m) => !tabs.includes(m.manifest.id))];
  return group(
    "Les onglets de sa bulle",
    [
      ...ordered.map((m) =>
        row(
          m.manifest.name,
          toggle(tabs.includes(m.manifest.id), (v) =>
            save((d) => {
              const now = (d.mascot.petTabs ?? []).filter((id) => id !== m.manifest.id);
              d.mascot.petTabs = v ? [...now, m.manifest.id] : now;
            }),
          m.manifest.name),
        ),
      ),
    ],
    "Les onglets cochés apparaissent dans sa bulle, dans l'ordre où vous les cochez. Les notifications restent dans l'île.",
  );
}

function mascot(main: HTMLElement) {
  const s = settingsStore.current;
  const catalog = mascotCatalog();
  const cur = catalog.find((e) => e.manifest.id === s.mascot.id) ?? catalog[0];
  const animStage = el("div", { class: "mascot-stage", "data-size": s.mascot.size ?? "normal" });
  // Le podium (podium.ts) : la mascotte de la première marche vit dans l'île.
  const stand = mascotPodium(catalog, cur?.manifest.id ?? "", (id) => {
    const gum = (e?: (typeof catalog)[number]) => e?.manifest.renderer === "gum";
    const changes = gum(catalog.find((e) => e.manifest.id === id)) !== gum(cur);
    save((d) => (d.mascot.id = id));
    // Le bloc Style n'existe que pour la famille gomme : la page se redessine
    // après la petite fête si on en sort (ou y revient).
    if (changes) window.setTimeout(() => showPage(false), 1600);
  });
  main.append(
    inSub("look", group("Apparence", [
      row("Afficher la mascotte", toggle(s.mascot.enabled, (v) => save((d) => (d.mascot.enabled = v)), "Afficher la mascotte")),
      wideRow(
        "Mascotte",
        stand.el,
        "Glissez une mascotte sur la première marche : c'est elle qui vit dans l'île. Double-clic ou Entrée marchent aussi. Vos mascottes à vous vont dans le dossier mascots/ du projet (relancez l'appli).",
      ),
      row(
        "Taille",
        choice(
          s.mascot.size ?? "normal",
          [
            ["small", "Petite"],
            ["normal", "Normale"],
            ["large", "Grande"],
          ],
          (v) => save((d) => (d.mascot.size = v as Settings["mascot"]["size"]), true),
        ),
        "Dans l'île ouverte et dans l'aperçu de « Tester les animations » ; la mini-île garde sa taille.",
      ),
    ])),
    ...(cur?.manifest.renderer === "gum" ? [inSub("look", gumStyleGroup())] : []),
    inSub("mood", group("Humeur", [
      row("S'ennuie après", stepper(s.mascot.boredAfterSecs, 10, 3600, (v) => save((d) => (d.mascot.boredAfterSecs = v)), 10, "s")),
      row("S'endort après", stepper(s.mascot.sleepAfterSecs, 20, 7200, (v) => save((d) => (d.mascot.sleepAfterSecs = v)), 10, "s")),
      row(
        "Calme : moins de gestes spontanés",
        toggle(s.mascot.calm ?? false, (v) => save((d) => (d.mascot.calm = v)), "Calme : moins de gestes spontanés"),
        "Plus d'ennui, de goûter, de visites au bord de l'écran ni de réactions aux modules ; en musique, un simple hochement de tête au lieu de la danse. Elle réagit toujours aux agents IA (attente, question), aux erreurs, aux réussites, aux alertes, et elle dort.",
      ),
      // Double-clic sur Ondine dans l'île (src/island/mascot-double-click.ts, 1.2.3).
      row(
        "Double-clic sur Ondine",
        choice(
          s.mascot.doubleClick ?? "ask",
          [
            ["ask", "Parler à Ondine"],
            ["launcher", "Lanceur"],
            ["capture", "Capture"],
            ["note", "Note rapide"],
            ["none", "Rien"],
          ],
          (v) => save((d) => (d.mascot.doubleClick = v as NonNullable<Settings["mascot"]["doubleClick"]>)),
        ),
        "Dans l'île. Un clic simple garde ses réactions (elle sourit, rit, s'agace si on insiste).",
      ),
    ])),
    inSub("desk", petGroup()),
    inSub("bubble", essential(petTabsGroup())),
    inSub("peek", group(
      "Visites au bord de l'écran",
      [
        row("Ondine vient pendre au bord", toggle(s.mascot.peek, (v) => save((d) => (d.mascot.peek = v)), "Ondine vient pendre au bord")),
        row("Au plus une visite toutes les", stepper(s.mascot.peekEveryMins, 1, 120, (v) => save((d) => (d.mascot.peekEveryMins = v)), 1, "min")),
        row("Essayer", el("button", { class: "btn small", onclick: () => bus.emit("mascot.peek-now", null, "settings") }, "Faire venir Ondine")),
      ],
      "Quand vous ne touchez plus au PC depuis un moment, la mini-île remonte et Ondine descend du bord de l'écran tête en bas, cligne des yeux, puis remonte. Un clic sur elle ouvre l'île. Jamais pendant une présentation ou un plein écran.",
    )),
    inSub("eggs", group(
      "Surprises",
      [
        row(
          "Surprises cachées",
          choice(
            s.mascot.surprises ?? "all",
            [
              ["all", "Toutes"],
              ["seasonal", "Sans les codes secrets"],
              ["none", "Aucune"],
            ],
            (v) => save((d) => (d.mascot.surprises = v as Settings["mascot"]["surprises"]), true),
          ),
        ),
        row(
          "Le goûter d'Ondine",
          el("button", { class: "btn small", onclick: () => bus.emit("easter.snack", null, "settings") }, "Essayer"),
          "De temps en temps, quand la mini-île est tranquille, Ondine la traverse en mangeant son contenu, puis tout revient. « Essayer » le lance à la prochaine mini-île.",
        ),
      ],
      "Ondine cache quelques surprises : des codes secrets et des gestes, des jours de fête, et des réactions à ce qui se passe sur le PC (agents IA, nuit, volume…). Jamais pendant une présentation ou un plein écran ; avec « réduire les animations » ou en économie d'énergie, les surprises automatiques restent discrètes.",
    )),
    inSub("eggs", treasureBook(s.mascot.treasures ?? [])),
  );
  if (!cur) return;
  if (cur.problems.length) main.append(inSub("anim", el("p", { class: "banner error" }, "Problèmes dans le manifeste : ", cur.problems.join(" ; "))));

  // Aperçu : un renderer à part ; chaque bouton joue aussi l'animation sur l'île.
  const buttons = el("div", { class: "anim-grid" });
  main.append(inSub("anim", el("section", { class: "group", "data-key": "Tester les animations" }, el("h3", { class: "group-title" }, "Tester les animations"), el("div", { class: "group-body stage-body" }, animStage, buttons))));
  for (const a of cur.manifest.animations) {
    buttons.append(
      el(
        "button",
        {
          class: "anim-btn",
          title: `${a.durationMs} ms, ${a.loop ? "en boucle" : "une fois"}, priorité ${a.priority}`,
          onclick: () => {
            preview?.play(a);
            bus.emit("mascot.play", { animation: a.name }, "settings");
          },
        },
        a.name,
      ),
    );
  }
  // Les mascottes ne se dessinent que si leur sous-menu est affiché, une fois
  // la page posée (showPage ne garde qu'un sous-menu).
  queueMicrotask(() => {
    if (stand.el.isConnected) {
      podium?.destroy();
      podium = stand;
      stand.start();
    }
    const stage = animStage;
    if (!stage.isConnected) return;
    preview?.destroy();
    preview = createRenderer(cur.manifest, cur.assets);
    preview.mount(stage);
    const idle = cur.manifest.animations.find((a) => a.name === cur.manifest.fallback);
    if (idle) preview.play(idle);
    preview.onAnimationEnd(() => idle && preview?.play(idle));
    stage.addEventListener("mousemove", (e) => {
      const r = stage.getBoundingClientRect();
      preview?.lookAt(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    });
    stage.addEventListener("mouseleave", () => preview?.lookAt(null, null));
  });
}

/** Les couleurs de la famille gomme (clés de TINTS dans gum-draw.ts), avec leur nom. */
const GUM_COLORS: [string, string][] = [
  ["auto", "Celle de la forme"],
  ["blue", "Bleu"],
  ["mint", "Menthe"],
  ["green", "Vert"],
  ["yellow", "Jaune"],
  ["gold", "Or"],
  ["orange", "Orange"],
  ["coral", "Corail"],
  ["red", "Rouge"],
  ["pink", "Rose"],
  ["lilac", "Lilas"],
  ["violet", "Violet"],
  ["night", "Nuit"],
  ["cloud", "Nuage"],
  ["licorice", "Réglisse"],
  ["rainbow", "Arc-en-ciel"],
  ["custom", "Personnalisée"],
];

/** Couleur, mains et accessoires des mascottes de la famille gomme. */
function gumStyleGroup(): HTMLElement {
  const m = settingsStore.current.mascot;
  return group(
    "Style",
    [
      row("Couleur", choice(m.color ?? "auto", GUM_COLORS, (v) => save((d) => (d.mascot.color = v), true))),
      // « Personnalisée » : la roue teinte / saturation (color-wheel.ts) ; l'aperçu et l'île suivent le glisser.
      m.color === "custom"
        ? row(
            "Roue de couleur",
            colorWheel(
              m.customColor ?? "#4da3ff",
              (hex) => save((d) => (d.mascot.customColor = hex)),
              (hex) => save((d) => (d.mascot.customColor = hex)),
            ),
            "La teinte tourne autour du disque, la saturation va du centre au bord. Au clavier : flèches gauche et droite pour la teinte, haut et bas pour la saturation.",
          )
        : null,
      row(
        "Mains",
        choice(
          m.hands ?? "always",
          [
            ["always", "Toujours"],
            ["gestures", "Seulement pour les gestes"],
            ["never", "Jamais"],
          ],
          (v) => save((d) => (d.mascot.hands = v as Settings["mascot"]["hands"])),
        ),
        "Des petites moufles en gomme qui flottent à côté d'elle : coucou, bravo, au clavier, mains sur les joues…",
      ),
      row(
        "Sur la tête",
        choice(
          m.wearHead ?? "none",
          [
            ["none", "Rien"],
            ["cap", "Casquette"],
            ["straw", "Chapeau de paille"],
            ["tophat", "Haut-de-forme"],
            ["beanie", "Bonnet"],
            ["crown", "Couronne"],
            ["bow", "Nœud"],
          ],
          (v) => save((d) => (d.mascot.wearHead = v)),
        ),
      ),
      row(
        "Lunettes",
        choice(
          m.wearEyes ?? "none",
          [
            ["none", "Aucune"],
            ["round", "Lunettes rondes"],
            ["sun", "Lunettes de soleil"],
            ["heart", "Lunettes cœur"],
          ],
          (v) => save((d) => (d.mascot.wearEyes = v)),
        ),
      ),
      row(
        "Au cou",
        choice(
          m.wearNeck ?? "none",
          [
            ["none", "Rien"],
            ["pearls", "Collier de perles"],
            ["bowtie", "Nœud papillon"],
            ["scarf", "Écharpe"],
          ],
          (v) => save((d) => (d.mascot.wearNeck = v)),
        ),
      ),
    ],
    "Pour toutes les mascottes en gomme. Le podium change tout de suite.",
  );
}

/** Le carnet des trésors : les surprises trouvées, et un indice pour les autres. */
function treasureBook(ids: string[]): HTMLElement {
  const got = new Set(found(ids).map((t) => t.id));
  const cards = TREASURES.map((t) =>
    got.has(t.id)
      ? el("div", { class: "treasure found" }, el("b", {}, t.name), el("small", {}, t.hint))
      : el("div", { class: "treasure" }, el("b", { "aria-label": "Pas encore trouvé" }, "???"), el("small", {}, t.hint)),
  );
  return el(
    "section",
    { class: "group", "data-key": "Carnet des trésors" },
    el("h3", { class: "group-title" }, "Carnet des trésors"),
    el("div", { class: "group-body treasure-body" }, el("p", { class: "muted treasure-count" }, `${got.size} / ${TREASURES.length} trésors trouvés`), el("div", { class: "treasure-grid" }, ...cards)),
  );
}

function privacy(main: HTMLElement) {
  main.append(
    group("Téléphones", [wideRow(null, el("div", {},
      el("p", {}, "Les téléphones qui ouvrent l'Étagère ou la télécommande ont chacun leur certificat. Vous pouvez les voir et les révoquer dans la page Téléphones."),
      el("button", { type: "button", class: "btn", onclick: () => go("phones") }, "Voir les téléphones"),
    ))]),
  );
  const s = settingsStore.current;
  const rows: HTMLElement[] = s.privacy.excludedFolders.map((folder) =>
    row(
      folder,
      el(
        "button",
        {
          class: "icon-btn",
          title: "Retirer",
          "aria-label": `Retirer ${folder}`,
          onclick: () => save((d) => (d.privacy.excludedFolders = d.privacy.excludedFolders.filter((f) => f !== folder)), true),
        },
        "×",
      ),
    ),
  );
  if (!rows.length) rows.push(el("div", { class: "row muted-row" }, "Aucun dossier exclu."));
  const input = el("input", { type: "text", class: "text grow", placeholder: "C:\\Users\\moi\\Documents\\Privé", "aria-label": "Dossier à exclure" }) as HTMLInputElement;
  const msg = el("div", { class: "row-help error-text" });
  const add = async () => {
    msg.textContent = "";
    try {
      const folder = await Bridge.privacyCheckFolder(input.value);
      save((d) => {
        if (!d.privacy.excludedFolders.includes(folder)) d.privacy.excludedFolders.push(folder);
      }, true);
    } catch (err) {
      msg.textContent = errorText(err);
    }
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && void add());
  main.append(
    group(
      "Ce que l'île promet",
      [
        row("Télémétrie", chip("Aucune", "ok"), "Rien n'est envoyé sur Internet sans que vous le demandiez."),
        row("Envoi à une IA", chip("Accord pour les outils", "ok"), "Dans Parler à Ondine, les fichiers joints sont présentés avant l'envoi. Les outils de fichiers et du PC demandent votre autorisation à la première utilisation ; ensuite, lire un fichier, partager une information du PC ou ouvrir quelque chose demande encore votre accord."),
      ],
    ),
    group("Dossiers exclus", [...rows, wideRow(null, el("div", { class: "inline" }, input, el("button", { class: "btn", onclick: () => void add() }, "Exclure")))], "Aucun module ne lira ni n'enverra un fichier situé dans ces dossiers."),
    msg,
  );
}

function credentials(main: HTMLElement) {
  // Les liens iCal de l'Agenda (un par calendrier) se gèrent dans les réglages du module Agenda.
  // Les clés des fournisseurs d'IA de « Parler à Ondine » (une seule suffit).
  const keys = [
    { key: "anthropic-api-key", label: "Clé API Anthropic", placeholder: "Coller la clé ici", help: "Pour parler à Ondine avec Claude (fournisseur par défaut)." },
    { key: "openai-api-key", label: "Clé API OpenAI", placeholder: "Coller la clé ici", help: "Pour parler à Ondine avec GPT. Facultative." },
    { key: "gemini-api-key", label: "Clé API Gemini", placeholder: "Coller la clé ici", help: "Pour parler à Ondine avec Gemini (Google AI Studio). Facultative." },
    { key: "openrouter-api-key", label: "Clé API OpenRouter", placeholder: "Coller la clé ici", help: "Pour parler à Ondine avec un modèle d'OpenRouter. Facultative." },
    { key: "local-llm-api-key", label: "Clé du serveur local", placeholder: "Coller la clé ici", help: "Seulement si votre serveur compatible OpenAI en demande une (Ollama et LM Studio : non). Facultative." },
  ];
  for (const k of keys) {
    const status = chip("…");
    const input = el("input", { type: "password", class: "text grow", placeholder: k.placeholder, autocomplete: "off", "aria-label": k.label }) as HTMLInputElement;
    const msg = el("div", { class: "row-help" });
    const refresh = async () => {
      const present = await Bridge.credentialExists(k.key);
      status.textContent = present ? "✓ Enregistrée" : "Aucune";
      status.className = `chip ${present ? "ok" : ""}`;
    };
    const act = async (fn: () => Promise<unknown>, done: string) => {
      try {
        await fn();
        input.value = "";
        msg.textContent = done;
      } catch (err) {
        msg.textContent = errorText(err);
      }
      void refresh();
    };
    main.append(
      group(
        k.label,
        [
          row("État", status, k.help || undefined, k.label),
          wideRow(
            null,
            el(
              "div",
              { class: "inline" },
              input,
              el("button", { class: "btn primary", onclick: () => void act(() => Bridge.credentialSet(k.key, input.value), "Enregistrée.") }, "Enregistrer"),
              el("button", { class: "btn", onclick: () => void act(() => Bridge.credentialDelete(k.key), "Supprimée.") }, "Supprimer"),
            ),
          ),
          msg,
        ],
        "L'île peut seulement savoir si une clé existe : elle ne peut jamais la réafficher.",
      ),
    );
    void refresh();
  }
}

function backup(main: HTMLElement) {
  const msg = el("div", { class: "row-help" });
  const file = el("input", { type: "file", accept: ".json,application/json", class: "file-hidden" }) as HTMLInputElement;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await Bridge.settingsImport(await f.text());
      msg.textContent = "Réglages importés.";
    } catch (err) {
      msg.textContent = `Import refusé : ${errorText(err)}`;
    }
    file.value = "";
  });
  main.append(
    group(
      null,
      [
        row(
          "Exporter les réglages",
          el(
            "button",
            {
              class: "btn small",
              onclick: async () => {
                try {
                  msg.textContent = `Exporté dans ${await Bridge.settingsExport()}`;
                } catch (err) {
                  msg.textContent = errorText(err);
                }
              },
            },
            "Exporter",
          ),
          "Un fichier .json, dans %APPDATA%\\Ondine\\exports (le dossier s'ouvre).",
        ),
        row("Importer des réglages", el("label", { class: "btn small" }, "Choisir…", file), "Remplace vos réglages actuels."),
        msg,
      ],
      "Les clés ne font jamais partie de l'export : elles restent dans le Gestionnaire d'identifiants.",
    ),
  );
}

/**
 * Une autre fenêtre (l'île) demande une page : « settings.goto ». La fenêtre de
 * réglages est souvent déjà ouverte et seulement cachée, elle ne relirait pas
 * « settings.page » : on regarde quand elle revient et quand le stockage change.
 */
function followGoto() {
  if (!started) return;
  let target: string | null = null;
  try {
    target = localStorage.getItem("settings.goto");
    if (target) localStorage.removeItem("settings.goto");
  } catch {
    // Stockage indisponible : on reste sur la page actuelle.
  }
  // « page#sous-menu » (1.2.4) : un sous-menu précis de la page.
  const [page, sub] = (target ?? "").split("#");
  // Un ancien nom (« module:halos ») mène à sa nouvelle place (resolvePlace dans go).
  if (page && allPages().some((p) => p.id === resolvePlace(page, sub || undefined).page)) go(page, undefined, sub || undefined);
}
window.addEventListener("storage", (e) => {
  if (e.key === "settings.goto" && e.newValue) followGoto();
});
window.addEventListener("focus", followGoto);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) followGoto();
});

void start().then(() => {
  started = true;
  followGoto();
});
