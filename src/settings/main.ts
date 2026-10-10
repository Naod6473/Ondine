// La fenêtre de réglages. Tout y est généré : les réglages des modules à partir
// de leurs manifestes, la liste des mascottes à partir du dossier mascots/.
//
// Disposition :
//   - à gauche, une barre latérale en verre : une recherche, puis les pages
//     rangées en trois groupes (L'île, Modules, Sécurité) ; une pastille glisse
//     sous la page affichée. Les modules sont rangés en catégories repliables
//     (MODULE_CATEGORIES), et une page longue déplie ses sous-menus sous elle
//     (`subs`) : la page n'affiche alors que le sous-menu choisi ;
//   - à droite, la page : un en-tête, puis des blocs de lignes (controls.ts).
//
// Chaque changement est appliqué tout de suite et enregistré par le Rust, qui
// prévient l'île (événement "settings-changed").

import { Bridge, IS_TAURI, windowLabel } from "../core/bridge";
import { Bus } from "../core/bus";
import { errorText } from "../core/log";
import type { ModuleManifest } from "../core/module-types";
import { settingsStore } from "../core/settings-store";
import { applyTabOrder, mergeOrder } from "../core/tab-order";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import { icon as iconNode } from "../island/icon";
import { sounds, setSoundPrefs } from "../island/sounds";
import { jellyButtons, setStudio, staggerIn, watchContent } from "../island/motion";
import { reducedMotion } from "../island/tab-pill";
import { THEMES, themeFor } from "../island/themes";
import { mascotCatalog } from "../mascot/catalog";
import { colorWheel } from "./color-wheel";
import { found, TREASURES } from "../eggs/treasures";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { ALL_MODULES } from "../modules";
import { chip, choice, group, inSub, row, segmented, stepper, toggle, wideRow } from "./controls";
import { settingsRows } from "./form";
import { NavPill } from "./nav-pill";
import { startI18n } from "../core/i18n";
import { connectRules, rulesSection } from "./rules-editor";
import { profilesPage, profileSubs } from "./profiles-page";
import { mascotPodium, type Podium } from "./podium";
import { aboutGroup } from "./about";
import { perfGroup } from "./perf-group";
import { startPerf } from "../core/perf";
import { applyMode, hiddenByMode, modeSwitch } from "./mode";
import { isHidden, modeOf, moduleEssentialKeys, pageEssentials, WHOLE_PAGE, type SettingsMode } from "./visibility";

const PERMISSION_LABELS: Record<string, string> = {
  files: "Fichiers",
  clipboard: "Presse-papiers",
  network: "Réseau",
  "claude-api": "Envoie à une API d'IA",
  credentials: "Identifiants",
};

/** Un sous-menu d'une page longue. `noI18n` : un nom choisi par l'utilisateur (un profil). */
interface Sub {
  id: string;
  label: string;
  noI18n?: boolean;
}

/** Une page de la barre latérale. */
interface Page {
  id: string;
  group: "L'île" | "Modules" | "Sécurité";
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
}

/**
 * Les catégories de modules dans la barre (texte seul, repliables). Un module
 * qui n'est dans aucune va dans « Autres modules ». Dans une catégorie, les
 * modules gardent l'ordre des onglets.
 */
const MODULE_CATEGORIES: { id: string; label: string; modules: string[] }[] = [
  { id: "ai", label: "Ondine et IA", modules: ["askclaude", "agents"] },
  { id: "files", label: "Fichiers", modules: ["shelf", "clipboard", "capture", "launcher"] },
  { id: "organize", label: "Organisation", modules: ["timer", "notes", "agenda", "pauses", "weekly"] },
  { id: "it", label: "Outils IT", modules: ["terminal", "system", "remote", "nettools"] },
  { id: "daily", label: "Le PC au quotidien", modules: ["media", "controls", "weather"] },
  { id: "other", label: "Autres modules", modules: [] },
];

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
    { id: "notify", label: "Notifications", keys: ["notifyWaiting", "notifyDone", "remindWaiting", "showChanges", "doneSummary", "resumePreview", "mascot"] },
    { id: "perms", label: "Autorisations et MCP", keys: ["mcp", "permissions", "permissionWait"] },
    { id: "tokens", label: "Jetons et budget", keys: ["usage", "prices", "dailyBudget"] },
    { id: "github", label: "GitHub", keys: ["githubLogin", "githubToken"] },
  ],
  askclaude: [
    { id: "general", label: "Général", keys: [] },
    { id: "models", label: "Fournisseur et modèles", keys: ["provider", "model", "openaiModel", "geminiModel", "maxTokens"] },
    { id: "persona", label: "Personnalité et affichage", keys: ["personality", "autoGrow", "emotions", "showDrop"] },
    { id: "files", label: "Fichiers et PC", keys: ["fileTools", "pcTools", "filesFolder"] },
  ],
};

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

const ISLAND_PAGES: Page[] = [
  {
    id: "general",
    group: "L'île",
    icon: "⚙️",
    label: "Général",
    sub: "L'écran, le repli de l'île, les notifications et le journal.",
    keywords: ["Langue", "Language", "Lancer avec Windows", "Sur quel écran ?", "Toujours en mini", "Replier l'île", "Durée des notifications", "Raccourci pour ouvrir l'île", "Bord de l'écran", "Mode présentation", "Mises à jour automatiques", "Version installée", "Niveau du journal", "Dossier du journal", "Signaler un problème", "Nouveautés", "Version", "Ressources utilisées", "Performances", "Économie d'énergie automatique sur batterie", "Mode utilisé", "S'adresser à moi", "Tutoiement", "Vouvoiement", "Mode démo"],
    render: general,
    subs: () => [
      { id: "start", label: "Langue et démarrage" },
      { id: "island", label: "Comportement de l'île" },
      { id: "updates", label: "Mises à jour" },
      { id: "perf", label: "Performances et journal" },
      { id: "about", label: "À propos" },
    ],
  },
  {
    id: "look",
    group: "L'île",
    icon: "🎨",
    label: "Apparence",
    sub: "La couleur de l'île et ses petits sons.",
    keywords: ["Thème", "Icônes", "Style des icônes", "Animations", "Style des animations", "Studio", "Élasticité de l'île", "Couleur de l'île", "Couleur personnalisée", "Sons de clic", "Volume des sons"],
    render: look,
  },
  {
    id: "tabs",
    group: "L'île",
    icon: "🗂️",
    label: "Onglets",
    sub: "Les modules actifs et l'ordre de leurs onglets dans l'île.",
    keywords: ["Ordre des onglets", "Activer un module", "Désactiver un module", "Ordre d'origine", "Astuces à la première ouverture d'un onglet", "Revoir les astuces"],
    render: tabs,
    subs: () => [
      { id: "order", label: "Ordre des onglets" },
      ...(ALL_MODULES.some((m) => !m.views?.expanded) ? [{ id: "notab", label: "Modules sans onglet" }] : []),
      { id: "tips", label: "Astuces" },
    ],
  },
  {
    id: "mascot",
    group: "L'île",
    icon: "💧",
    label: "Mascotte",
    sub: "Qui vit dans l'île, et quand elle s'ennuie ou s'endort.",
    keywords: ["Afficher la mascotte", "Mascotte", "Taille", "Couleur", "Roue de couleur", "Couleur personnalisée de la mascotte", "Mains", "Sur la tête", "Lunettes", "Au cou", "S'ennuie après", "S'endort après", "Calme : moins de gestes spontanés", "Ondine vient pendre au bord", "Au plus une visite toutes les", "Faire venir Ondine", "Surprises cachées", "Le goûter d'Ondine", "Carnet des trésors", "Tester les animations", "Ondine vit sur le bureau", "Au-dessus des fenêtres", "Raccourci pour ouvrir sa bulle", "Elle se promène quand vous ne touchez plus au PC"],
    render: mascot,
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
  {
    id: "rules",
    group: "L'île",
    icon: "⚡",
    label: "Règles",
    sub: "Quand quelque chose arrive, l'île agit pour vous.",
    keywords: ["Règles automatiques", "Raccourci clavier", "Surveiller un dossier", "Clé USB", "Modèles de règles"],
    // Le module « Règles » n'a pas de page à part : son interrupteur est ici.
    render: (main) => {
      const man = ALL_MODULES.find((m) => m.manifest.id === "rules")?.manifest;
      if (man) modulePage(main, man, true);
      rulesSection(main);
    },
  },
  {
    id: "profiles",
    group: "L'île",
    icon: "🧭",
    label: "Profils",
    sub: "Travail, Maison… : les onglets, la couleur et la mini-île d'un coup.",
    keywords: ["Profil actif", "Changer tout seul", "Nouveau profil", "Plage horaire", "Nom du Wi-Fi", "Travail", "Maison"],
    render: (main) => profilesPage(main, save),
    subs: () => profileSubs(settingsStore.current),
  },
];

const SECURITY_PAGES: Page[] = [
  {
    id: "privacy",
    group: "Sécurité",
    icon: "🛡️",
    label: "Confidentialité",
    sub: "Aucune télémétrie. Ce qui part vers une IA est toujours montré avant.",
    keywords: ["Télémétrie", "Dossiers exclus", "Exclure un dossier"],
    render: privacy,
  },
  {
    id: "credentials",
    group: "Sécurité",
    icon: "🔑",
    label: "Identifiants",
    sub: "Rangés dans le Gestionnaire d'identifiants Windows.",
    keywords: ["Clé API Anthropic", "Clé API OpenAI", "Clé API Gemini", "Gestionnaire d'identifiants"],
    render: credentials,
  },
  {
    id: "backup",
    group: "Sécurité",
    icon: "💾",
    label: "Sauvegarde",
    sub: "Exporter ou importer vos réglages (jamais les clés).",
    keywords: ["Exporter les réglages", "Importer des réglages"],
    render: backup,
  },
];

/** Une page par module : par catégorie, puis dans l'ordre des onglets. */
function modulePages(): Page[] {
  const listed = ALL_MODULES.filter((m) => m.manifest.id !== "rules");
  const rank = (id: string) => MODULE_CATEGORIES.findIndex((c) => c.id === categoryOf(id));
  const ordered = applyTabOrder(listed, (m) => m.manifest.id, settingsStore.current.island.tabOrder ?? []);
  // Tri stable : l'ordre des onglets tient dans chaque catégorie.
  ordered.sort((a, b) => rank(a.manifest.id) - rank(b.manifest.id));
  return ordered.map((m) => ({
    id: `module:${m.manifest.id}`,
    group: "Modules" as const,
    category: categoryOf(m.manifest.id),
    subs: MODULE_SECTIONS[m.manifest.id] ? () => MODULE_SECTIONS[m.manifest.id].map(({ id, label }) => ({ id, label })) : undefined,
    icon: m.manifest.icon,
    label: m.manifest.name,
    sub: firstSentence(m.manifest.description),
    keywords: [m.manifest.description, ...(m.manifest.settings?.fields ?? []).map((f) => f.label)],
    render: (main: HTMLElement) => modulePage(main, m.manifest),
    essentials: moduleEssentialKeys(m.manifest.id, m.manifest.settings?.fields ?? []),
  }));
}

/** « Lance Claude Code… en un clic. Un tableau… » → « Lance Claude Code… en un clic. » */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end > 0 ? text.slice(0, end + 1) : text;
}

function allPages(): Page[] {
  return [...ISLAND_PAGES, ...modulePages(), ...SECURITY_PAGES];
}

let bus: Bus;
let current = "general";
let query = "";
let preview: MascotRenderer | null = null;
/** Le podium des mascottes (Mascotte → Apparence), s'il est affiché. */
let podium: Podium | null = null;
/** Le sous-menu choisi de chaque page qui en a (retenu d'une ouverture à l'autre). */
let chosenSubs: Record<string, string> = {};
/** Les catégories de modules dépliées dans la barre. */
let openCats = new Set<string>();
let pill: NavPill | null = null;
/** Quand on a enregistré nous-mêmes pour la dernière fois (voir `start`). */
let lastOwnSave = 0;
/** La version d'Ondine (« 1.0.0 »), affichée à côté de « Réglages ». */
let appVersion = "";

const app = document.getElementById("app")!;
const nav = el("nav", { class: "sidebar", "aria-label": "Pages des réglages" });
const content = el("main", { class: "content" });

async function start() {
  const boot = await Bridge.boot();
  appVersion = boot?.version ?? "";
  // Fond Mica de Windows 11 : la page devient transparente (voir settings.css).
  if (boot?.mica) document.documentElement.classList.add("mica");
  await settingsStore.connect(boot?.settings ?? null);
  await startI18n();
  await startPerf();
  bus = new Bus(windowLabel("settings"));
  await bus.connect();
  try {
    current = localStorage.getItem("settings.page") ?? current;
  } catch {
    // stockage indisponible : on démarre sur « Général »
  }
  if (!allPages().some((p) => p.id === current)) current = "general";
  try {
    chosenSubs = JSON.parse(localStorage.getItem("settings.subs") ?? "{}") ?? {};
    const cats: unknown = JSON.parse(localStorage.getItem("settings.cats") ?? "null");
    if (Array.isArray(cats)) openCats = new Set(cats.filter((c): c is string => typeof c === "string"));
  } catch {
    // rien de retenu : premiers sous-menus, catégories repliées
  }
  // Première fois : seule la catégorie de la page affichée est dépliée.
  const cat = pageById(current)?.category;
  if (cat) openCats.add(cat);

  // Section « Règles » : l'onglet de l'île peut demander d'ouvrir l'éditeur.
  connectRules(
    bus,
    () => go("rules"),
    () => {
      if (current === "rules") showPage(false);
    },
  );
  // Les réglages ont changé. Si c'est nous (un interrupteur…), la page est
  // déjà à jour : on ne la redessine pas, pour ne pas couper son animation.
  // Si c'est ailleurs (l'île, un import), on redessine, sauf pendant la saisie.
  // Les effets d'animation de l'île servent aussi ici (Classique ou Studio).
  setStudio(settingsStore.current.island.motion === "studio");
  jellyButtons(content);
  // Les chiffres qui roulent, mais pas les listes : la liste des onglets a
  // déjà son propre glisser (plus bas, dans la page « Onglets »).
  watchContent(content, { lists: false });
  settingsStore.onChange((s) => {
    setStudio(s.island.motion === "studio");
    syncNav();
    if (performance.now() - lastOwnSave < 1500) return;
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.type !== "checkbox";
    if (!typing) showPage(false);
  });

  app.append(backdrop(), nav, content);
  drawNav();
  showPage(false);
  if (boot) document.title = `Réglages — Ondine ${boot.version}`;
}

/** Les taches de couleur floues derrière le verre. */
function backdrop(): HTMLElement {
  return el("div", { class: "backdrop", "aria-hidden": "true" }, el("i", { class: "blob a" }), el("i", { class: "blob b" }), el("i", { class: "blob c" }));
}

/**
 * Enregistre un changement. `redraw` : la page doit se redessiner (une liste
 * qui change de longueur, par exemple) ; sinon la commande s'est déjà mise à
 * jour toute seule.
 */
function save(change: (s: Settings) => void, redraw = false) {
  lastOwnSave = performance.now();
  void settingsStore.update(change).then(() => {
    if (redraw) showPage(false);
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
  // vers une ligne cachée peut ainsi la trouver juste après.
  save((d) => (d.general.settingsMode = mode));
  showPage(false);
  nav.querySelector(".mode-switch")?.replaceWith(modeSwitch(mode, setMode));
}

/** Les clés essentielles d'une page (module : d'après son manifeste ; île : visibility.ts). */
function essentialsOf(p: Page): string[] | typeof WHOLE_PAGE {
  return p.essentials ?? pageEssentials(p.id);
}

/** Un résultat de recherche est-il caché par le mode Simple sur sa page ? */
function advancedHit(p: Page, key: string | undefined): boolean {
  return !!key && isHidden(settingsMode(), key, essentialsOf(p));
}

// ── Navigation ────────────────────────────────────────────────────────────────

function pageById(id: string): Page | undefined {
  return allPages().find((p) => p.id === id);
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

function saveCats() {
  try {
    localStorage.setItem("settings.cats", JSON.stringify([...openCats]));
  } catch {
    // pas grave : les catégories se replieront
  }
}

function go(id: string, focusKey?: string) {
  if (id === current && !query) {
    // Même page : la ligne est peut-être dans un autre sous-menu.
    if (focusKey && !findKey(content, focusKey)) showPage(true, 1, focusKey);
    if (focusKey) highlight(focusKey);
    return;
  }
  const before = allPages().findIndex((p) => p.id === current);
  current = id;
  if (query) {
    query = "";
    const search = nav.querySelector<HTMLInputElement>(".search");
    if (search) search.value = "";
    nav.querySelector(".nav-list")?.classList.remove("searching");
  }
  try {
    localStorage.setItem("settings.page", id);
  } catch {
    // pas grave : on ne se souviendra juste pas de la page
  }
  syncNav();
  const after = allPages().findIndex((p) => p.id === id);
  showPage(true, after >= before ? 1 : -1, focusKey);
  if (focusKey) highlight(focusKey);
}

/** Un clic sur un sous-menu de la barre. */
function goSub(pageId: string, subId: string) {
  const p = pageById(pageId);
  if (!p) return;
  const list = p.subs?.() ?? [];
  const before = list.findIndex((s) => s.id === subOf(p));
  setSub(pageId, subId);
  if (pageId !== current || query) return go(pageId);
  syncNav();
  showPage(true, list.findIndex((s) => s.id === subId) >= before ? 1 : -1);
}

function drawNav() {
  const focused = document.activeElement;
  const hadFocus = focused instanceof HTMLInputElement && focused.classList.contains("search");
  const search = el("input", { class: "search", type: "search", placeholder: "Rechercher un réglage", "aria-label": "Rechercher un réglage" }) as HTMLInputElement;
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    showPage(false);
    const list = nav.querySelector(".nav-list");
    list?.classList.toggle("searching", !!query.trim());
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) {
      search.value = "";
      query = "";
      showPage(false);
    }
  });

  navShape = shapeOf();
  const list = el("div", { class: `nav-list ${query.trim() ? "searching" : ""}` });
  pill = new NavPill(list);
  let active: HTMLElement | null = null;
  let lastGroup = "";
  let lastCat = "";
  // Où vont les pages : la liste, ou le corps de la catégorie en cours.
  let into: HTMLElement = list;
  for (const p of allPages()) {
    if (p.group !== lastGroup) {
      list.append(el("div", { class: "nav-group" }, p.group));
      lastGroup = p.group;
      lastCat = "";
      into = list;
    }
    if (p.category && p.category !== lastCat) {
      lastCat = p.category;
      const fold = categoryFold(p.category);
      list.append(fold.head, fold.body);
      into = fold.inner;
    }
    const moduleOff = p.id.startsWith("module:") && !settingsStore.moduleEnabled(p.id.slice(7));
    const subs = p.subs?.() ?? [];
    const here = p.id === current;
    const item = el(
      "button",
      {
        class: `nav-item ${here ? "active" : ""} ${moduleOff ? "off" : ""} ${subs.length ? "has-subs" : ""} ${subs.length && here ? "open" : ""}`,
        title: p.label,
        "data-page": p.id,
        "aria-current": here ? "page" : false,
        "aria-expanded": subs.length ? String(here) : undefined,
      },
      el("span", { class: "nav-icon" }, iconNode(p.icon)),
      el("span", { class: "nav-label" }, p.label),
      moduleOff ? el("span", { class: "nav-off", title: "Module désactivé" }) : null,
      subs.length ? el("span", { class: "nav-caret", "aria-hidden": "true" }, "›") : null,
    );
    item.addEventListener("click", () => go(p.id));
    if (here) active = item;
    into.append(item);
    if (subs.length) into.append(subsFold(p, subs));
  }
  nav.replaceChildren(
    el(
      "div",
      { class: "brand" },
      el("span", { class: "brand-drop" }, iconNode("💧")),
      el("span", {}, "Réglages", appVersion ? el("small", { class: "brand-version" }, appVersion) : null),
    ),
    search,
    modeSwitch(settingsMode(), setMode),
    list,
  );
  // La pastille se place une fois la liste affichée (il faut ses positions).
  requestAnimationFrame(() => {
    if (active) pill?.jumpTo(active);
    else pill?.refresh();
    hidePillIfFolded();
  });
  if (hadFocus) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

/** Une catégorie de modules : son titre (un bouton qui la replie) et son corps. */
function categoryFold(id: string): { head: HTMLElement; body: HTMLElement; inner: HTMLElement } {
  const label = MODULE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
  const open = openCats.has(id);
  const head = el(
    "button",
    { class: "nav-cat", "data-cat": id, "aria-expanded": String(open) },
    el("span", { class: "nav-cat-label" }, label),
    el("span", { class: "nav-chevron", "aria-hidden": "true" }, "›"),
  );
  const inner = el("div", { class: "nav-fold-inner" });
  const body = el("div", { class: `nav-fold nav-cat-body ${open ? "open" : ""}`, "data-cat": id }, inner);
  body.inert = !open;
  head.addEventListener("click", () => {
    if (openCats.has(id)) openCats.delete(id);
    else openCats.add(id);
    saveCats();
    foldCat(id, openCats.has(id));
  });
  return { head, body, inner };
}

/** Déplie ou replie une catégorie dans la barre déjà dessinée. */
function foldCat(id: string, open: boolean) {
  const head = nav.querySelector<HTMLElement>(`.nav-cat[data-cat="${id}"]`);
  const body = nav.querySelector<HTMLElement>(`.nav-cat-body[data-cat="${id}"]`);
  if (!head || !body) return;
  head.setAttribute("aria-expanded", String(open));
  body.classList.toggle("open", open);
  body.inert = !open;
  followPill();
}

/** Les sous-menus d'une page, dépliés sous elle quand elle est affichée. */
function subsFold(p: Page, subs: Sub[]): HTMLElement {
  const open = p.id === current;
  const chosen = subOf(p);
  const inner = el("div", { class: "nav-fold-inner" });
  for (const s of subs) {
    const b = el(
      "button",
      { class: `nav-sub ${open && s.id === chosen ? "active" : ""}`, "data-page": p.id, "data-sub": s.id, "data-no-i18n": s.noI18n ? "" : undefined },
      el("span", { class: "nav-label" }, s.label),
    );
    b.addEventListener("click", () => goSub(p.id, s.id));
    inner.append(b);
  }
  const fold = el("div", { class: `nav-fold nav-subs ${open ? "open" : ""}`, "data-for": p.id }, inner);
  fold.inert = !open;
  return fold;
}

/** La page active est dans une catégorie repliée : pas de pastille (son titre est en gras). */
function hidePillIfFolded() {
  const active = nav.querySelector<HTMLElement>(".nav-item.active");
  const folded = !!active?.closest(".nav-cat-body:not(.open)");
  for (const head of nav.querySelectorAll<HTMLElement>(".nav-cat")) {
    head.classList.toggle("has-active", !!active && active.closest(".nav-cat-body")?.getAttribute("data-cat") === head.dataset.cat);
  }
  if (folded && pill) pill.el.style.opacity = "0";
}

/** Pendant qu'un pli s'ouvre ou se ferme, la pastille suit sa page qui glisse. */
function followPill() {
  const until = performance.now() + 360;
  const tick = () => {
    const active = nav.querySelector<HTMLElement>(".nav-item.active");
    if (active && !query.trim()) pill?.moveTo(active);
    hidePillIfFolded();
    if (performance.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Ce qui change la liste de la barre : l'ordre des pages, les modules éteints, les sous-menus. */
let navShape = "";
function shapeOf(): string {
  return allPages()
    .map((p) => {
      const off = p.id.startsWith("module:") && !settingsStore.moduleEnabled(p.id.slice(7)) ? "-off" : "";
      const subs = (p.subs?.() ?? []).map((s) => `${s.id}=${s.label}`).join("|");
      return `${p.id}${off}${subs ? `[${subs}]` : ""}`;
    })
    .join(",");
}

/**
 * Met la barre à jour : reconstruite seulement si sa liste a changé ; sinon on
 * change juste la page active (ses sous-menus se déplient, ceux de l'ancienne
 * se replient), et la pastille glisse jusqu'à elle.
 */
function syncNav() {
  const shape = shapeOf();
  if (shape !== navShape) return drawNav();
  let active: HTMLElement | null = null;
  const here = pageById(current);
  const chosen = here ? subOf(here) : null;
  for (const item of nav.querySelectorAll<HTMLElement>(".nav-item")) {
    const page = item.dataset.page === current;
    const on = page && !query.trim();
    item.classList.toggle("active", on);
    if (on) {
      item.setAttribute("aria-current", "page");
      active = item;
    } else item.removeAttribute("aria-current");
    if (item.classList.contains("has-subs")) {
      item.classList.toggle("open", page);
      item.setAttribute("aria-expanded", String(page));
    }
  }
  for (const fold of nav.querySelectorAll<HTMLElement>(".nav-subs")) {
    const open = fold.dataset.for === current;
    fold.classList.toggle("open", open);
    fold.inert = !open;
  }
  for (const b of nav.querySelectorAll<HTMLElement>(".nav-sub")) b.classList.toggle("active", b.dataset.page === current && b.dataset.sub === chosen);
  // La page affichée est dans une catégorie repliée : on la déplie.
  if (here?.category && !openCats.has(here.category)) {
    openCats.add(here.category);
    saveCats();
    foldCat(here.category, true);
  }
  if (active) pill?.moveTo(active);
  followPill();
}

/** Affiche la page courante (ou les résultats de recherche). `focusKey` : ouvre le sous-menu de cette ligne. */
function showPage(animate: boolean, direction = 1, focusKey?: string) {
  preview?.destroy();
  preview = null;
  podium?.destroy();
  podium = null;
  const page = el("div", { class: "page" });
  if (!IS_TAURI) page.append(el("p", { class: "banner" }, "Aperçu dans un navigateur : rien n'est enregistré."));
  if (query.trim()) {
    results(page, query);
  } else {
    const p = pageById(current) ?? ISLAND_PAGES[0];
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
    const shown = subs.find((s) => s.id === sub);
    page.append(header(p.icon, p.label, p.sub, undefined, shown));
    if (sub) {
      dimSubs(body, p, subs);
      for (const child of [...body.children] as HTMLElement[]) if (child.dataset.sub && child.dataset.sub !== sub) child.remove();
    }
    page.append(...body.childNodes);
    applyMode(page, essentialsOf(p), settingsMode(), () => setMode("full"));
  }
  const old = content.firstElementChild as HTMLElement | null;
  const y = content.scrollTop;
  content.replaceChildren(page);
  if (!animate) {
    content.scrollTop = y;
    return;
  }
  content.scrollTop = 0;
  if (reducedMotion() || !old) return;
  // La nouvelle page glisse un peu dans le sens du déplacement, et ses
  // morceaux (titre, groupes) arrivent l'un après l'autre, flous puis nets.
  page.animate([{ transform: `translateY(${direction * 10}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  staggerIn(page, 0);
}

/**
 * Mode Simple : grise dans la barre les sous-menus de la page dont rien ne
 * resterait affiché (on peut quand même les ouvrir : « Tout afficher »).
 */
function dimSubs(body: HTMLElement, p: Page, subs: Sub[]) {
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
  for (const b of nav.querySelectorAll<HTMLElement>(".nav-sub")) {
    const dim = b.dataset.page === p.id && empty.has(b.dataset.sub ?? "");
    b.classList.toggle("dim", dim);
    if (dim) b.title = "Réglages en mode Complet";
    else b.removeAttribute("title");
  }
}

function header(pageIcon: string, title: string, sub: string, extra?: HTMLElement, crumb?: Sub): HTMLElement {
  return el(
    "header",
    { class: "page-head" },
    el("span", { class: "page-icon" }, iconNode(pageIcon)),
    el(
      "div",
      { class: "page-titles" },
      el("h1", {}, title, crumb ? el("span", { class: "page-crumb", "data-no-i18n": crumb.noI18n ? "" : undefined }, crumb.label) : null),
      el("p", {}, sub),
    ),
    extra ?? null,
  );
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

// ── Recherche ─────────────────────────────────────────────────────────────────

/** Minuscules et sans accents : « écran » trouve « Ecran ». */
function simple(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function results(page: HTMLElement, q: string) {
  const words = simple(q).split(/\s+/).filter(Boolean);
  const hits: { page: Page; key?: string; label: string }[] = [];
  for (const p of allPages()) {
    const matches = (text: string) => words.every((w) => simple(text).includes(w));
    if (matches(`${p.label} ${p.sub}`)) hits.push({ page: p, label: p.label });
    for (const k of p.keywords) {
      if (!matches(k)) continue;
      // Une description trouvée : on montre la page, pas tout le texte.
      if (k.length > 80) {
        if (!hits.some((h) => h.page === p && !h.key)) hits.push({ page: p, label: p.label });
      } else hits.push({ page: p, key: SEARCH_ALIASES[k] ?? k, label: k });
    }
  }
  page.append(header("🔎", "Recherche", hits.length ? `${hits.length} résultat${hits.length > 1 ? "s" : ""} pour « ${q.trim()} »` : `Rien trouvé pour « ${q.trim()} ».`));
  if (!hits.length) return;
  page.append(
    group(
      null,
      hits.slice(0, 40).map((h) =>
        el(
          "button",
          { class: "row result", onclick: () => go(h.page.id, h.key) },
          el("span", { class: "result-icon" }, iconNode(h.page.icon)),
          el("div", { class: "row-text" }, el("div", { class: "row-label" }, h.label), el("div", { class: "row-help" }, h.key ? h.page.label : h.page.group)),
          advancedHit(h.page, h.key) ? chip("réglage avancé") : null,
          el("span", { class: "chevron" }, "›"),
        ),
      ),
    ),
  );
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

function general(main: HTMLElement) {
  const s = settingsStore.current;
  main.append(
    inSub("start", group("Langue et démarrage", [
      row(
        "Langue",
        choice(s.general.language ?? "auto", [["auto", "Automatique"], ["fr", "Français"], ["en", "English"]], (v) => save((d) => (d.general.language = v as Settings["general"]["language"]))),
        "Automatique : la langue choisie à l'installation, sinon celle de Windows. Les fenêtres se rechargent.",
      ),
      addressRow(s),
      row(
        "Lancer avec Windows",
        toggle(s.general.autostart !== false, (v) => save((d) => (d.general.autostart = v)), "Lancer avec Windows"),
        "Ondine s'ouvre toute seule quand vous ouvrez votre session.",
      ),
      row(
        "Sur quel écran ?",
        choice(s.general.screen, [["primary", "Écran principal"], ["cursor", "Suit la souris"]], (v) => save((d) => (d.general.screen = v as Settings["general"]["screen"]))),
        "Seulement si vous avez plusieurs écrans : l'île reste sur l'écran principal, ou suit l'écran où se trouve votre souris.",
      ),
    ])),
    inSub("island", group("Comportement de l'île", [
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
      row(
        "Bord de l'écran",
        choice(s.island.edge, [["top", "En haut"], ["bottom", "En bas"], ["left", "À gauche"], ["right", "À droite"]], (v) =>
          save((d) => {
            d.island.edge = v as Settings["island"]["edge"];
            d.island.align = "center";
            d.island.offset = 0.5;
          }, true),
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
    inSub("updates", updatesGroup()),
    inSub("perf", perfGroup(save)),
    inSub("perf", group(
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
    )),
    inSub("about", aboutGroup(() => bus.emit("app.whats-new", null, "settings"))),
    inSub("about", demoGroup()),
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
        } catch {
          status.textContent = "Impossible de joindre GitHub. Vérifiez votre connexion à Internet.";
        }
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
                scene("island-dodge", "L'île s'écarte"),
              ),
              "La notification arrive dans l'île : lancez l'enregistrement avant de cliquer.",
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
  const swatch = (id: string, name: string) => {
    const t = themeFor(id, s.island.color);
    const b = el(
      "button",
      { class: `swatch ${s.island.theme === id ? "active" : ""}`, title: name, "aria-pressed": String(s.island.theme === id), onclick: () => save((d) => (d.island.theme = id), true) },
      el("span", { class: "swatch-dot" }, el("i", {})),
      el("span", { class: "swatch-name" }, name),
    );
    const dot = b.querySelector<HTMLElement>(".swatch-dot")!;
    dot.style.background = t.bg;
    dot.querySelector<HTMLElement>("i")!.style.background = t.accent;
    return b;
  };
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
    group("Thème", [wideRow(null, el("div", { class: "swatches" }, ...THEMES.map((t) => swatch(t.id, t.name)), swatch("custom", "Personnalisée")), undefined, "Thème")]),
    group(
      null,
      [row("Couleur personnalisée", picker, "Choisissez n'importe quelle couleur : si elle est trop claire, l'île l'assombrit juste assez pour que le texte reste lisible.")],
    ),
    group("Icônes", [
      row(
        "Style des icônes",
        segmented(s.island.iconPack ?? "color", [["color", "Couleur"], ["line", "Épurées"]], (v) => save((d) => (d.island.iconPack = v as "color" | "line"))),
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
    ]),
    group("Sons", [
      row("Sons de clic", toggle(s.island.sounds, (v) => save((d) => (d.island.sounds = v)), "Sons de clic"), "De petits « plop » à l'ouverture, à la fermeture et sur les boutons. Fabriqués sur place, sans fichier."),
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
    const sans = group("Sans onglet", without.map((man) => row(`${man.icon}  ${man.name}`, enableToggle(man), undefined, man.name)));
    sans.dataset.essential = ""; // mode Simple : la liste des modules reste entière
    main.append(inSub("notab", sans));
  }
  main.append(inSub("tips", tipsGroup()));
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
  const top = group(null, [
    row("Activé", enableToggle(man), "Désactivé, le module s'arrête et son onglet disparaît.", "Activé"),
    compact ? null : wideRow("Permissions", el("div", { class: "chips" }, ...perms)),
    compact ? null : wideRow("À propos", el("div", {}, about, man.description.length > 220 ? more : null)),
  ]);
  main.append(sections ? inSub(sections[0].id, top) : top);
  const fields = man.settings?.fields ?? [];
  if (!fields.length) {
    if (!compact) main.append(el("p", { class: "empty" }, "Ce module n'a pas de réglage."));
    return;
  }
  const rowsOf = (list: typeof fields) =>
    settingsRows(list, settingsStore.moduleValues(man), (key, value) =>
      save((d) => {
        const entry = (d.modules[man.id] ??= { enabled: true, values: {} });
        entry.values[key] = value;
      }),
    );
  if (!sections) main.append(group("Réglages", rowsOf(fields)));
  else {
    const listed = new Set(sections.slice(1).flatMap((s) => s.keys));
    sections.forEach((s, i) => {
      const mine = i === 0 ? fields.filter((f) => !listed.has(f.key)) : fields.filter((f) => s.keys.includes(f.key));
      if (mine.length) main.append(inSub(s.id, group(i === 0 ? "Réglages" : null, rowsOf(mine))));
    });
  }
  if (!compact && man.id === "weekly") main.append(weeklyGroup(man));
  if (!compact) main.append(el("p", { class: "version" }, `${man.name} · version ${man.version}`));
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
        "Plus d'ennui, de goûter, de visites au bord de l'écran, de danse ni de réactions aux modules. Elle réagit toujours aux agents IA (attente, question), aux erreurs, aux réussites, aux alertes, et elle dort.",
      ),
    ])),
    inSub("desk", petGroup()),
    inSub("bubble", petTabsGroup()),
    inSub("peek", group(
      "Visites au bord de l'écran",
      [
        row("Ondine vient pendre au bord", toggle(s.mascot.peek, (v) => save((d) => (d.mascot.peek = v)), "Ondine vient pendre au bord")),
        row("Au plus une visite toutes les", stepper(s.mascot.peekEveryMins, 1, 120, (v) => save((d) => (d.mascot.peekEveryMins = v)), 1, "min")),
        row("Essayer", el("button", { class: "btn small", onclick: () => bus.emit("mascot.peek-now", null, "settings") }, "Faire venir Ondine")),
      ],
      "Quand l'île est cachée et que vous ne touchez plus au PC depuis un moment, Ondine descend du bord de l'écran tête en bas, cligne des yeux, puis remonte. Un clic sur elle ouvre l'île. Jamais pendant une présentation ou un plein écran.",
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
        row("Envoi à une IA", chip("Toujours montré avant", "ok"), "Un module qui envoie du contenu à une API d'IA (Claude, GPT, Gemini) le déclare et vous montre ce qui part."),
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

void start();
