// La fenêtre de réglages. Tout y est généré : les réglages des modules à partir
// de leurs manifestes, la liste des mascottes à partir du dossier mascots/.
//
// Disposition :
//   - à gauche, une barre latérale en verre : une recherche, puis les pages
//     rangées en trois groupes (L'île, Modules, Sécurité) ; une pastille glisse
//     sous la page affichée ;
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
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { ALL_MODULES } from "../modules";
import { chip, choice, group, row, segmented, stepper, toggle, wideRow } from "./controls";
import { settingsRows } from "./form";
import { NavPill } from "./nav-pill";
import { startI18n } from "../core/i18n";
import { connectRules, rulesSection } from "./rules-editor";
import { profilesPage } from "./profiles-page";
import { aboutGroup } from "./about";
import { perfGroup } from "./perf-group";
import { startPerf } from "../core/perf";

const PERMISSION_LABELS: Record<string, string> = {
  files: "Fichiers",
  clipboard: "Presse-papiers",
  network: "Réseau",
  "claude-api": "Envoie à l'API Claude",
  credentials: "Identifiants",
};

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
}

const ISLAND_PAGES: Page[] = [
  {
    id: "general",
    group: "L'île",
    icon: "⚙️",
    label: "Général",
    sub: "L'écran, le repli de l'île, les notifications et le journal.",
    keywords: ["Langue", "Language", "Lancer avec Windows", "Sur quel écran ?", "Toujours en mini", "Replier l'île", "Durée des notifications", "Raccourci pour ouvrir l'île", "Bord de l'écran", "Mode présentation", "Niveau du journal", "Dossier du journal", "Signaler un problème", "Ressources utilisées", "Performances", "Économie d'énergie automatique sur batterie"],
    render: general,
  },
  {
    id: "look",
    group: "L'île",
    icon: "🎨",
    label: "Apparence",
    sub: "La couleur de l'île et ses petits sons.",
    keywords: ["Thème", "Icônes", "Style des icônes", "Animations", "Style des animations", "Studio", "Couleur de l'île", "Couleur personnalisée", "Sons de clic", "Volume des sons"],
    render: look,
  },
  {
    id: "tabs",
    group: "L'île",
    icon: "🗂️",
    label: "Onglets",
    sub: "Les modules actifs et l'ordre de leurs onglets dans l'île.",
    keywords: ["Ordre des onglets", "Activer un module", "Désactiver un module", "Ordre d'origine"],
    render: tabs,
  },
  {
    id: "mascot",
    group: "L'île",
    icon: "💧",
    label: "Mascotte",
    sub: "Qui vit dans l'île, et quand elle s'ennuie ou s'endort.",
    keywords: ["Afficher la mascotte", "Mascotte", "S'ennuie après", "S'endort après", "Ondine vient pendre au bord", "Visites", "Tester les animations"],
    render: mascot,
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
  },
];

const SECURITY_PAGES: Page[] = [
  {
    id: "privacy",
    group: "Sécurité",
    icon: "🛡️",
    label: "Confidentialité",
    sub: "Aucune télémétrie. Ce qui part vers Claude est toujours montré avant.",
    keywords: ["Télémétrie", "Dossiers exclus", "Exclure un dossier"],
    render: privacy,
  },
  {
    id: "credentials",
    group: "Sécurité",
    icon: "🔑",
    label: "Identifiants",
    sub: "Rangés dans le Gestionnaire d'identifiants Windows.",
    keywords: ["Clé API Anthropic", "Gestionnaire d'identifiants"],
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

/** Une page par module, dans l'ordre des onglets. */
function modulePages(): Page[] {
  const listed = ALL_MODULES.filter((m) => m.manifest.id !== "rules");
  return applyTabOrder(listed, (m) => m.manifest.id, settingsStore.current.island.tabOrder ?? []).map((m) => ({
    id: `module:${m.manifest.id}`,
    group: "Modules" as const,
    icon: m.manifest.icon,
    label: m.manifest.name,
    sub: firstSentence(m.manifest.description),
    keywords: [m.manifest.description, ...(m.manifest.settings?.fields ?? []).map((f) => f.label)],
    render: (main: HTMLElement) => modulePage(main, m.manifest),
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
let pill: NavPill | null = null;
/** Quand on a enregistré nous-mêmes pour la dernière fois (voir `start`). */
let lastOwnSave = 0;

const app = document.getElementById("app")!;
const nav = el("nav", { class: "sidebar", "aria-label": "Pages des réglages" });
const content = el("main", { class: "content" });

async function start() {
  const boot = await Bridge.boot();
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

// ── Navigation ────────────────────────────────────────────────────────────────

function go(id: string, focusKey?: string) {
  if (id === current && !query) return focusKey ? highlight(focusKey) : undefined;
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
  showPage(true, after >= before ? 1 : -1);
  if (focusKey) highlight(focusKey);
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
  for (const p of allPages()) {
    if (p.group !== lastGroup) {
      list.append(el("div", { class: "nav-group" }, p.group));
      lastGroup = p.group;
    }
    const moduleOff = p.id.startsWith("module:") && !settingsStore.moduleEnabled(p.id.slice(7));
    const item = el(
      "button",
      { class: `nav-item ${p.id === current ? "active" : ""} ${moduleOff ? "off" : ""}`, title: p.label, "data-page": p.id, "aria-current": p.id === current ? "page" : false },
      el("span", { class: "nav-icon" }, iconNode(p.icon)),
      el("span", { class: "nav-label" }, p.label),
      moduleOff ? el("span", { class: "nav-off", title: "Module désactivé" }) : null,
    );
    item.addEventListener("click", () => go(p.id));
    if (p.id === current) active = item;
    list.append(item);
  }
  nav.replaceChildren(
    el("div", { class: "brand" }, el("span", { class: "brand-drop" }, iconNode("💧")), el("span", {}, "Réglages")),
    search,
    list,
  );
  // La pastille se place une fois la liste affichée (il faut ses positions).
  requestAnimationFrame(() => {
    if (active) pill?.jumpTo(active);
    else pill?.refresh();
  });
  if (hadFocus) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

/** Ce qui change la liste de la barre : l'ordre des pages et les modules éteints. */
let navShape = "";
function shapeOf(): string {
  return allPages()
    .map((p) => `${p.id}${p.id.startsWith("module:") && !settingsStore.moduleEnabled(p.id.slice(7)) ? "-off" : ""}`)
    .join(",");
}

/**
 * Met la barre à jour : reconstruite seulement si sa liste a changé ; sinon on
 * change juste la page active, et la pastille glisse jusqu'à elle.
 */
function syncNav() {
  const shape = shapeOf();
  if (shape !== navShape) return drawNav();
  let active: HTMLElement | null = null;
  for (const item of nav.querySelectorAll<HTMLElement>(".nav-item")) {
    const on = item.dataset.page === current && !query.trim();
    item.classList.toggle("active", on);
    if (on) {
      item.setAttribute("aria-current", "page");
      active = item;
    } else item.removeAttribute("aria-current");
  }
  if (active) pill?.moveTo(active);
}

/** Affiche la page courante (ou les résultats de recherche). */
function showPage(animate: boolean, direction = 1) {
  preview?.destroy();
  preview = null;
  const page = el("div", { class: "page" });
  if (!IS_TAURI) page.append(el("p", { class: "banner" }, "Aperçu dans un navigateur : rien n'est enregistré."));
  if (query.trim()) {
    results(page, query);
  } else {
    const p = allPages().find((x) => x.id === current) ?? ISLAND_PAGES[0];
    page.append(header(p.icon, p.label, p.sub));
    p.render(page);
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

function header(pageIcon: string, title: string, sub: string, extra?: HTMLElement): HTMLElement {
  return el(
    "header",
    { class: "page-head" },
    el("span", { class: "page-icon" }, iconNode(pageIcon)),
    el("div", { class: "page-titles" }, el("h1", {}, title), el("p", {}, sub)),
    extra ?? null,
  );
}

/** Fait défiler jusqu'à la ligne `key` et la fait briller un instant. */
function highlight(key: string) {
  requestAnimationFrame(() => {
    const target = [...content.querySelectorAll<HTMLElement>("[data-key]")].find((r) => r.dataset.key === key);
    if (!target) return;
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
      } else hits.push({ page: p, key: k, label: k });
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
          el("span", { class: "chevron" }, "›"),
        ),
      ),
    ),
  );
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function general(main: HTMLElement) {
  const s = settingsStore.current;
  main.append(
    group("L'île", [
      row(
        "Langue",
        choice(s.general.language ?? "auto", [["auto", "Automatique"], ["fr", "Français"], ["en", "English"]], (v) => save((d) => (d.general.language = v as Settings["general"]["language"]))),
        "Automatique : la langue choisie à l'installation, sinon celle de Windows. Les fenêtres se rechargent.",
      ),
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
      row(
        "Toujours en mini",
        toggle(s.island.alwaysMini ?? false, (v) => save((d) => (d.island.alwaysMini = v)), "Toujours en mini"),
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
        choice(s.island.edge, [["top", "En haut"], ["left", "À gauche"], ["right", "À droite"]], (v) =>
          save((d) => {
            d.island.edge = v as Settings["island"]["edge"];
            d.island.align = "center";
            d.island.offset = 0.5;
          }, true),
        ),
        "Vous pouvez aussi attraper l'île par son bord collé à l'écran et la poser ailleurs : elle s'aimante aux bords, aux coins et au centre.",
      ),
      row(
        "Mode présentation",
        toggle(s.island.presentationQuiet ?? true, (v) => save((d) => (d.island.presentationQuiet = v)), "Mode présentation"),
        "Pendant un diaporama, une vidéo ou un jeu en plein écran, l'île se cache et garde les notifications pour la fin.",
      ),
    ]),
    updatesGroup(),
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
    aboutGroup(),
    demoGroup(),
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
        "L'île montre de fausses données (musique, agenda, notes, presse-papiers…) au lieu des tiennes. Aucune action n'est faite pour de vrai.",
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
      { class: "group" },
      el("h3", { class: "group-title" }, "Ordre des onglets"),
      list,
      el("p", { class: "group-note" }, "Glissez une ligne, ou utilisez ↑ ↓. Vous pouvez aussi faire glisser les onglets directement dans l'île."),
    ),
    el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => save((d) => (d.island.tabOrder = []), true) }, "Ordre d'origine")),
  );
  if (without.length) {
    main.append(group("Sans onglet", without.map((man) => row(`${man.icon}  ${man.name}`, enableToggle(man), undefined, man.name))));
  }
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
  main.append(
    group(null, [
      row("Activé", enableToggle(man), "Désactivé, le module s'arrête et son onglet disparaît.", "Activé"),
      compact ? null : wideRow("Permissions", el("div", { class: "chips" }, ...perms)),
      compact ? null : wideRow("À propos", el("div", {}, about, man.description.length > 220 ? more : null)),
    ]),
  );
  const fields = man.settings?.fields ?? [];
  if (!fields.length) {
    if (!compact) main.append(el("p", { class: "empty" }, "Ce module n'a pas de réglage."));
    return;
  }
  main.append(
    group(
      "Réglages",
      settingsRows(fields, settingsStore.moduleValues(man), (key, value) =>
        save((d) => {
          const entry = (d.modules[man.id] ??= { enabled: true, values: {} });
          entry.values[key] = value;
        }),
      ),
    ),
  );
  if (!compact) main.append(el("p", { class: "version" }, `${man.name} · version ${man.version}`));
}

function mascot(main: HTMLElement) {
  const s = settingsStore.current;
  const catalog = mascotCatalog();
  const cur = catalog.find((e) => e.manifest.id === s.mascot.id) ?? catalog[0];
  main.append(
    group("Apparence", [
      row("Afficher la mascotte", toggle(s.mascot.enabled, (v) => save((d) => (d.mascot.enabled = v)), "Afficher la mascotte")),
      row(
        "Mascotte",
        choice(
          cur?.manifest.id ?? "",
          catalog.map((e) => [e.manifest.id, e.problems.length ? `${e.manifest.name} (invalide)` : e.manifest.name]),
          (v) => save((d) => (d.mascot.id = v), true),
        ),
        "Déposez vos mascottes dans le dossier mascots/ du projet, puis relancez l'appli.",
      ),
    ]),
    group("Humeur", [
      row("S'ennuie après", stepper(s.mascot.boredAfterSecs, 10, 3600, (v) => save((d) => (d.mascot.boredAfterSecs = v)), 10, "s")),
      row("S'endort après", stepper(s.mascot.sleepAfterSecs, 20, 7200, (v) => save((d) => (d.mascot.sleepAfterSecs = v)), 10, "s")),
    ]),
    group(
      "Visites au bord de l'écran",
      [
        row("Ondine vient pendre au bord", toggle(s.mascot.peek, (v) => save((d) => (d.mascot.peek = v)), "Ondine vient pendre au bord")),
        row("Au plus une visite toutes les", stepper(s.mascot.peekEveryMins, 1, 120, (v) => save((d) => (d.mascot.peekEveryMins = v)), 1, "min")),
        row("Essayer", el("button", { class: "btn small", onclick: () => bus.emit("mascot.peek-now", null, "settings") }, "Faire venir Ondine")),
      ],
      "Quand l'île est cachée et que vous ne touchez plus au PC depuis un moment, Ondine descend du bord de l'écran tête en bas, cligne des yeux, puis remonte. Un clic sur elle ouvre l'île. Jamais pendant une présentation ou un plein écran.",
    ),
  );
  if (!cur) return;
  if (cur.problems.length) main.append(el("p", { class: "banner error" }, "Problèmes dans le manifeste : ", cur.problems.join(" ; ")));

  // Aperçu : un renderer à part ; chaque bouton joue aussi l'animation sur l'île.
  const stage = el("div", { class: "mascot-stage" });
  const buttons = el("div", { class: "anim-grid" });
  main.append(el("section", { class: "group", "data-key": "Tester les animations" }, el("h3", { class: "group-title" }, "Tester les animations"), el("div", { class: "group-body stage-body" }, stage, buttons)));
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
        row("Envoi à Claude", chip("Toujours montré avant", "ok"), "Un module qui envoie du contenu à l'API Claude le déclare et vous montre ce qui part."),
      ],
    ),
    group("Dossiers exclus", [...rows, wideRow(null, el("div", { class: "inline" }, input, el("button", { class: "btn", onclick: () => void add() }, "Exclure")))], "Aucun module ne lira ni n'enverra un fichier situé dans ces dossiers."),
    msg,
  );
}

function credentials(main: HTMLElement) {
  // Les liens iCal de l'Agenda (un par calendrier) se gèrent dans les réglages du module Agenda.
  const keys = [{ key: "anthropic-api-key", label: "Clé API Anthropic", placeholder: "Coller la clé ici", help: "" }];
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
