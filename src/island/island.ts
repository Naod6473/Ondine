// L'île : relie la machine à états, la file de notifications, les modules, la
// mascotte et la fenêtre Tauri, et dessine le tout.
//
// Qui fait quoi :
//   island-state.ts   décide de l'état (hidden, peek, compact, expanded, drop, alert)
//   island.ts (ici)   dessine l'état, écoute la souris, le clavier, le glisser-déposer
//   Rust (island/)    place la fenêtre, gère les clics traversants, lit la souris

import { jellyButtons, motionOn, popIn, setStudio, spotlight, staggerIn, studioOn, tabOut, watchContent } from "./motion";
import { Bridge, IS_TAURI, onDragDrop, onTauriEvent, type DragDropEvent } from "../core/bridge";
import type { Bus } from "../core/bus";
import { logger } from "../core/log";
import { onPerfChange, pacedInterval, perfMode } from "../core/perf";
import type { ModuleRegistry } from "../core/module-registry";
import { isAlert, type IslandNotification, type NotificationQueue } from "../core/notifications";
import { settingsStore } from "../core/settings-store";
import { noteTabOpen } from "../core/suggestions";
import { homeOnOpen } from "../core/home-cards";
import { applyTabOrder, mergeOrder } from "../core/tab-order";
import type { Settings } from "../core/types";
import { EasterEggs } from "../eggs/eggs";
import { findMascot } from "../mascot/catalog";
import { Hanger } from "../mascot/hang";
import { MascotController } from "../mascot/mascot-state";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import type { MascotManifest } from "../mascot/types";
import { clear, el } from "./dom";
import { icon } from "./icon";
import { IslandStateMachine, redrawOnModulesChange, type IslandState } from "./island-state";
import { IslandForms, islandStyle } from "./island-forms";
import { contentHeight, FIT_ATTR, FIT_HOLD_ATTR, FIT_MAX_H, FIT_MAX_W, FIT_MAX_W_SIDE, FIT_W_ATTR, fitHeight, fitMode, fitWidth, naturalWidth, settle } from "./fit";
import { attachHalo } from "./halo";
import { attachLiquid } from "./liquid";
import { enableGestures, grabZone, horizontal, type Edge } from "./gestures";
import { Jelly } from "./jelly";
import { elasticityOf } from "./spring";
import { sounds, setSoundPrefs } from "./sounds";
import { enableTabDrag, flip } from "./tab-drag";
import { applyIslandTheme } from "./light-island";
import { attachWheelVolume } from "./volume-wheel";
import { ACTION_MODULE, CONFIRM_MS, DoubleClick, doubleClickActionOf } from "./mascot-double-click";
import { attachScenes, type Scenes } from "./scenes/scenes";
import { reducedMotion, TabPill } from "./tab-pill";
import { Tips } from "./tips";
import { playHatch, type HatchTexts } from "./hatch";
import { ConvertGesture } from "./convert-gesture";
import { DropPanel, type Choice } from "./drop-panel";
import { effectiveLayout, LAYOUT_KEY, LAYOUT_MODULE, serialize, toggleFav, type DropLayout, type Probe } from "./drop-pills-logic";
import { parseDest, type DropMenuMessage } from "./drop-menu-logic";
import { shelfCount } from "../modules/shelf";
import type { Ring } from "./hatch-plan";

const log = logger("island");

/** Les gestes sur l'île auxquels la mascotte peut réagir (MascotRenderer.react). */
type MascotReaction = Parameters<NonNullable<MascotRenderer["react"]>>[0];

/**
 * La forme de l'île suit des ressorts (jelly.ts) : on attend qu'ils soient
 * posés pour réduire la fenêtre (île cachée) ou lui rendre sa taille (fit.ts).
 * Au cas où la boucle ne tournerait pas (fenêtre que Windows ne redessine
 * plus), on n'attend jamais plus que ça (ms).
 */
const SETTLE_FALLBACK_MS = 1500;
/** La hauteur du panneau de la fenêtre (src-tauri/src/island/mod.rs : PANEL_H, SIDE_PANEL_H). */
const PANEL_H = 320;
const SIDE_PANEL_H = 380;
/** Les marges haute et basse de l'île en mode dépôt (island.css : 12 + 10 px). */
const DROP_PAD_Y = 22;
/** La place du petit rond Étagère sous l'île en mode dépôt (drop-shelf.ts : 36 px + l'air). */
const SHELF_ROOM = 46;
/** La place gardée dans la fenêtre pour l'étirement à la souris (gestures.ts). */
const STRETCH_ROOM = 40;
/** Zone au bord de l'écran qui compte comme « survol » même si l'île est minuscule. */
const EDGE_ZONE = { len: 240, depth: 14 };
/** L'île qui s'écarte d'une fenêtre : la peur d'Ondine au plus toutes les… (ms). */
const FRIGHT_EVERY_MS = 4000;
/** Un appui de cette durée sur Ondine, sans bouger, est un appui long (ms). */
const LONG_PRESS_MS = 550;
/** Survol prolongé de la mascotte → `love`. */
const LONG_HOVER_MS = 2500;

/** Ondine vit sur le bureau (src/pet/) : elle n'est plus dans l'île. */
function petOn(s: Settings): boolean {
  return s.mascot.enabled && !!s.mascot.pet;
}
/** La couleur de l'île pour l'éclosion : un thème trop transparent (Verre) est rendu presque opaque. */
function solidColor(css: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return css || "#0c0d12";
  const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
  return Number(a) < 0.6 ? `rgba(${r}, ${g}, ${b}, 0.92)` : css;
}
/** Ondine vient pendre au bord seulement si personne n'a touché le PC depuis… */
const PEEK_IDLE_MS = 20_000;
// On se demande toutes les 15 s si c'est le moment de pendre au bord, et toutes
// les 4 s si une appli est en plein écran (mode présentation) : rythmes
// "peekCheck" et "presentationCheck" de src/core/perf.ts (selon le mode de performance).

function timingsFrom(s: Settings) {
  return {
    peekToCompactMs: 350,
    peekToHiddenMs: 300,
    collapseMs: s.island.collapseSecs * 1000,
  };
}

/** La zone du contenu de l'onglet ouvert (role tabpanel). */
const PANEL_ID = "island-tabpanel";

/**
 * Fait de `body` le panneau de l'onglet `tabId` (ou le retire : l'ancien
 * contenu qui s'efface). Tabulable : on peut y arriver au clavier même si le
 * module n'y a mis aucun bouton.
 */
function asPanel(body: HTMLElement, tabId: string | null) {
  if (!tabId) {
    for (const a of ["id", "role", "aria-labelledby", "tabindex"]) body.removeAttribute(a);
    body.setAttribute("aria-hidden", "true");
    return;
  }
  body.id = PANEL_ID;
  body.setAttribute("role", "tabpanel");
  body.setAttribute("aria-labelledby", `tab-${tabId}`);
  body.tabIndex = 0;
}

export class Island {
  private fsm: IslandStateMachine;
  private shell = el("div", { class: "island", "data-state": "hidden" });
  private mascotSlot = el("div", { class: "mascot-slot", title: "" });
  /** Les clics sur la mascotte, pour reconnaître un double-clic (réglage mascot.doubleClick). */
  private doubleClick = new DoubleClick();
  private content = el("div", { class: "island-content" });
  /** Le petit point orange (micro) ou vert (caméra) quand une appli s'en sert. */
  private privacyDot = el("span", { class: "privacy-dot", "aria-hidden": "true" });
  /** Un service IA en panne (Réseau → services IA) : pastille rouge dans le coin. */
  private aiDot = el("span", { class: "ai-dot" });
  /** Mises à jour des logiciels : un point bleu discret tant que des mises à jour attendent (updates.css). */
  private updatesDot = el("span", { class: "upd-dot" });
  /** Qui utilise le micro et la caméra (message "controls.media-use" du module Contrôles). */
  private mediaUse: { mic: string[]; cam: string[] } = { mic: [], cam: [] };
  private mascot: MascotController | null = null;
  /** Le moteur de dessin de la mascotte (pour ses réactions aux gestes sur l'île). */
  private renderer: MascotRenderer | null = null;
  /** La forme de l'île en gelée : ressorts, creux, bosse (jelly.ts). */
  private jelly: Jelly;
  /** Change à chaque transition : une fermeture de fenêtre prévue pour une
      ancienne transition ne se fait plus. */
  private collapseToken = 0;
  private mascotId = "";
  /** Le manifeste de la mascotte affichée (pour les surprises). */
  private mascotManifest: MascotManifest | null = null;

  /** Ce qui est affiché dans `content`, pour ne pas tout redessiner sans raison. */
  private renderedKey = "";
  /** L'ordre des onglets affiché (ids séparés par des virgules). */
  private tabOrderShown = "";
  private unmountView: () => void = () => {};
  /** Onglet (id de module) ouvert dans la vue agrandie. */
  private activeTab: string | null = null;
  /** Un onglet précis vient d'être demandé (openIsland) : l'ouverture ne repasse pas par l'Accueil. */
  private tabAsked = false;
  /** La vue agrandie affichée : ses onglets, leur pastille et la zone du contenu. */
  private expandedUi: { tabs: Map<string, HTMLElement>; pill: TabPill; stage: HTMLElement; body: HTMLElement } | null = null;
  /** Dernier état dessiné, pour animer l'arrivée du contenu quand il change. */
  private renderedState: IslandState | null = null;
  /** L'île en mode dépôt a demandé le panneau haut (fitDrop) : il faudra le rendre. */
  private dropTall = false;
  /** Suit la hauteur des pilules du dépôt (fitDrop). */
  private dropObserver: ResizeObserver | null = null;
  private collapseTimer: number | null = null;
  /** L'île ouverte agrandie pour un contenu à montrer en entier (fit.ts) : sa hauteur, sinon null. */
  private fitH: number | null = null;
  /** Sa largeur quand le contenu marqué la demande aussi (`data-island-fit="both"`), sinon null. */
  private fitW: number | null = null;
  /** Le contenu marqué observé en continu (ResizeObserver), pour suivre un texte qui s'écrit. */
  private fitWatched: [Element | null, Element | null] = [null, null];
  private fitObserver: ResizeObserver | null = null;
  /** La fenêtre a le panneau haut (le Rust le sait aussi). */
  private tall = false;
  private tallTimer: number | undefined;
  private fitQueued = false;
  private hoverMascotSince = 0;
  private hoverMascotFired = false;
  /** Le dernier appui sur l'île était un geste (étirer, déplacer), pas un clic. */
  private wasGesture: () => boolean = () => false;
  /** On vient de sortir Ondine de l'île en la tirant (le clic qui suit ne compte pas). */
  private carried = false;
  /** Ondine qui pend au bord de l'écran (mascot/hang.ts), et sa dernière visite. */
  private hanger: Hanger;
  private lastPeek = Date.now();
  /** La mini-île est remontée le temps d'une visite d'Ondine au bord. */
  private peekHid = false;
  /** Une présentation ou une appli plein écran est en cours : l'île se fait oublier. */
  private presenting = false;
  /** La place provisoire donnée par le Rust quand l'île s'écarte d'une fenêtre
      (island/dodge.rs) : elle remplace le bord et la place réglés. */
  private dodgePlace: { edge: Edge; align: string } | null = null;
  private lastFright = 0;
  /** Ouverte au clavier (raccourci) : le focus va sur l'onglet actif. */
  private focusTabsOnOpen = false;
  /** Format nano et île-bouche (1.2.3, island-forms.ts). */
  private forms: IslandForms;
  /** Les surprises cachées (src/eggs/). */
  private eggs: EasterEggs;
  /** La bulle d'astuce à la première ouverture d'un onglet (tips.ts). */
  private tips = new Tips();
  /** Ondine se déplace dans l'île (scenes/scenes.ts). */
  private scenes: Scenes;
  /** L'éclosion joue (hatch.ts) : la vraie île est cachée, la fenêtre reste grande. */
  private hatching = false;
  /** Ondine convertit (1.2.4) : le geste après un lâcher sur une pilule de format. */
  private convert: ConvertGesture;
  /** Le dépôt unifié (1.2.4) : toutes les pilules dans l'île pendant un glisser. */
  private dropPanel: DropPanel;

  constructor(
    private readonly root: HTMLElement,
    private readonly bus: Bus,
    private readonly registry: ModuleRegistry,
    private readonly notifications: NotificationQueue,
  ) {
    this.fsm = new IslandStateMachine(timingsFrom(settingsStore.current));
    this.fsm.onTransition = (from, to) => this.onTransition(from, to);
    this.shell.append(this.mascotSlot, this.content, this.privacyDot, this.aiDot, this.updatesDot);
    this.root.append(this.shell);
    // Le halo de lumière autour de l'île (halo.ts) : sous elle, sur toute la fenêtre.
    attachHalo(this.root, this.shell, this.bus, () => this.fsm.state);
    // Le liquide À L'INTÉRIEUR de l'île (liquid.ts) : derrière le contenu.
    attachLiquid(this.shell, this.bus, () => this.fsm.state);
    // La molette sur l'île règle le volume, avec une petite jauge (volume-wheel.ts, 1.2.3).
    attachWheelVolume(this.shell, this.mascotSlot, this.bus, () => this.fsm.state);
    this.jelly = new Jelly(this.shell, {
      edge: () => this.edge(),
      align: () => document.body.dataset.align ?? "center",
      state: () => this.fsm.state,
      // La forme est posée (fin de l'ancienne « transitionend ») : le Rust
      // reçoit le rectangle final, échelle comprise, pour les clics traversants.
      onSettle: () => this.pushRect(),
    });
    this.forms = new IslandForms({
      shell: this.shell,
      root: this.root,
      fsm: this.fsm,
      bus: this.bus,
      mascot: () => this.mascot,
      retarget: () => this.scheduleRetarget(),
      petOut: () => petOn(settingsStore.current),
      awayChanged: (away) => void Bridge.islandSetCollapsed(away || this.fsm.state === "hidden"),
    });
    this.hanger = new Hanger(this.root, {
      edge: () => this.edge(),
      align: () => document.body.dataset.align ?? "center",
      entry: () => (this.mascotId ? findMascot(this.mascotId) : null),
      onClick: () => this.fsm.open(),
      onShowChange: (on) => this.onHangChange(on),
    });
    this.eggs = new EasterEggs(
      {
        shell: this.shell,
        slot: this.mascotSlot,
        state: () => this.fsm.state,
        manifest: () => (this.mascot ? this.mascotManifest : null),
      },
      this.bus,
      this.notifications,
    );
    // Ondine convertit : le geste après le lâcher (convert-gesture.ts).
    this.convert = new ConvertGesture({
      root: this.root,
      shell: this.shell,
      slot: this.mascotSlot,
      bus: this.bus,
      keepOpen: (on) => this.fsm.keepOpen("convert", on),
      rectChanged: () => this.pushRect(),
      reshape: () => this.scheduleRetarget(),
    });
    // Le menu de fichiers : icônes dans l'île, fichier tenu jusqu'au clic (drop-panel.ts).
    this.dropPanel = new DropPanel({
      convert: this.convert,
      host: this.root,
      shell: this.shell,
      targets: () => this.registry.dropTargets(),
      layout: () => this.dropLayout(),
      saveLayout: (layout) => this.saveDropLayout(layout),
      favoriteMove: () => settingsStore.current.modules.shelf?.values?.favoriteAction === "move",
      lookAt: (point) => this.lookAtPoint(point),
      // La taille des fichiers, pour l'en-tête : le module Ondine convertit répond (convert.probed).
      probe: (paths, id) => this.bus.emit("convert.probe", { id, paths }),
      shelfCount: () => (settingsStore.moduleEnabled("shelf") ? shelfCount() : null),
      chosen: (choice, paths) => this.runDropChoice(choice, paths),
      cancel: () => this.cancelHeld(),
      rectChanged: () => this.pushRect(),
      merged: () => this.hop(0.6),
    });
    // Un fichier posé sur l'étagère (ou parti) : le petit rond le compte.
    this.bus.on("shelf.changed", () => this.dropPanel.shelfBump(shelfCount()));
    this.bus.on("convert.probed", (msg) => {
      const p = msg.payload as { id?: unknown; items?: unknown } | null;
      if (typeof p?.id !== "number" || !Array.isArray(p.items)) return;
      this.dropPanel.probed(p.id, p.items.map((x) => (x && typeof x === "object" ? (x as Probe) : null)));
    });
    // Ondine quitte sa case pour agir dans l'île (les 22 scènes, scenes/).
    this.scenes = attachScenes({
      shell: this.shell,
      slot: this.mascotSlot,
      content: this.content,
      bus: this.bus,
      state: () => this.fsm.state,
      mascot: () => this.mascot,
      react: (kind, data) => this.react(kind, data),
      open: (tab) => this.registry.onOpenRequest(tab),
    });
    pacedInterval(() => void this.maybePeek(), "peekCheck");
    pacedInterval(() => void this.checkPresentation(), "presentationCheck");
    // Économie d'énergie : pas d'effets « Studio » (flous coûteux), ils reviennent ensuite.
    onPerfChange(() => setStudio(settingsStore.current.island.motion === "studio" && perfMode() !== "eco"));
    // Dans un navigateur (npm run dev) : window.ondinePeek() la fait venir tout de suite.
    // Et window.ondineBus.emit("controls.media-use", { mic: ["Zoom"], cam: [] }) simule un message.
    // window.ondineNotify({ moduleId: "island", title: "Test", priority: "high" }) : une alerte (le choc de jelly.ts).
    // window.ondineSettings.update((d) => { d.island.edge = "left"; }) : l'île sur un côté, le style Studio…
    if (!IS_TAURI) {
      Object.assign(window, {
        ondinePeek: () => this.hanger.show(),
        ondineBus: this.bus,
        ondineEggs: this.eggs,
        ondineScenes: this.scenes,
        ondineNotify: (n: Parameters<NotificationQueue["push"]>[0]) => this.notifications.push(n),
        ondineSettings: settingsStore,
      });
    }

    this.notifications.defaultDurationMs = settingsStore.current.island.notificationSecs * 1000;
    let wasAlert = false;
    let lastShown = "";
    this.notifications.onShow = (n) => {
      const alert = isAlert(n);
      const isNew = !!n && String(n.id) !== lastShown;
      // Une nouvelle notification : Ondine peut y réagir (voir mascot-state.ts).
      if (n && !alert && String(n.id) !== lastShown) {
        this.bus.emit("notify.shown", { moduleId: n.moduleId, icon: n.icon ?? "", priority: n.priority });
      }
      lastShown = n ? String(n.id) : "";
      if (alert) {
        this.fsm.alertStart();
        this.bus.emit("notify.alert", { title: n?.title });
      } else {
        if (wasAlert) {
          this.fsm.alertEnd();
          this.bus.emit("notify.alert-end");
        }
        if (n) this.fsm.showCompact();
      }
      wasAlert = alert;
      // Notification normale affichée : l'île ne se replie pas avant sa fin.
      this.fsm.hold(!!n && !alert);
      this.render();
      // Une alerte arrive (ou en remplace une autre) : l'île encaisse le choc,
      // un creux puis une onde (jelly.ts), après render() qui a lu sa nouvelle taille ;
      // une notification normale en mini-île : un petit saut, sans quitter sa place.
      if (alert && isNew) {
        this.jelly.shock();
      } else if (n && isNew && this.fsm.state === "compact") this.hop(0.5);
    };

    // Une alerte affichée (l'assistant) reste telle quelle : voir redrawOnModulesChange.
    this.registry.onChange = () => this.render(redrawOnModulesChange(this.fsm.state));
    // Sans `force` : on ne redessine que si le module affiché en compact change.
    this.registry.onCompactChange = () => this.render();
    this.registry.onCloseRequest = () => this.fsm.close();
    this.registry.onOpenRequest = (tab) => {
      if (tab && this.orderedTabs().some((t) => t.module.manifest.id === tab)) {
        this.activeTab = tab;
        this.tabAsked = true;
      }
      this.fsm.open();
      this.tabAsked = false;
      this.render(true);
    };
    settingsStore.onChange((s) => this.applySettings(s));
    this.applySettings(settingsStore.current);
    this.wireInputs();
    this.wireHeld();
    this.wireUndo();
    // Design « Studio » : chiffres qui roulent, listes qui glissent, boutons en
    // gélatine, reflet sous la souris (rien de tout ça en Classique).
    watchContent(this.content);
    jellyButtons(this.content);
    spotlight(this.shell);
    this.wirePrivacy();
    this.wireFocus();
    this.wireRulesQuiet();
    this.wireAiDot();
    this.wireUpdatesDot();
    // On porte Ondine (sur le bureau) au-dessus de l'île : elle se montre pour l'accueillir.
    void onTauriEvent<boolean>("pet-over-island", (over) => {
      // Île-bouche partie avec elle : la bouche revient le temps de l'accueillir.
      this.forms.setHoming(over);
      if (over) this.fsm.pointerEnter();
      else this.fsm.pointerLeave();
    });
    // Des fichiers lâchés sur Ondine (sur le bureau) : l'île connaît les cibles,
    // elle les propose dans la bulle d'Ondine, puis fait le dépôt choisi.
    this.wirePetDrops();
    // La bulle d'Ondine sur le bureau demande un onglet qu'elle n'a pas.
    this.bus.on("island.open", (msg) => this.registry.onOpenRequest((msg.payload as { tab?: string } | null)?.tab));
    // Bouton « Faire venir Ondine » des réglages.
    this.bus.on("mascot.peek-now", () => this.startPeek());
    // Le trou noir (Ondine et les fenêtres) : une fenêtre gardée au-dessus de l'île.
    this.wireBlackHole();
    this.render(true);
  }

  // ── Réglages et mascotte ───────────────────────────────────────────────────

  private applySettings(s: Settings) {
    this.fsm.timings = timingsFrom(s);
    this.fsm.setAlwaysMini(s.island.alwaysMini ?? false);
    setStudio(s.island.motion === "studio" && perfMode() !== "eco");
    // Réglages → Apparence → Élasticité : raideur, rebond, amplitude des déformations.
    this.jelly.setElasticity(elasticityOf(s.island.elasticity));
    // Le bord et la place de l'île : la forme s'adapte en CSS (island.css).
    // (Sauf si elle s'écarte en ce moment d'une fenêtre : sa place provisoire.)
    document.body.dataset.edge = this.dodgePlace?.edge ?? s.island.edge ?? "top";
    document.body.dataset.align = this.dodgePlace?.align ?? s.island.align ?? "center";
    // Le thème (un thème clair retourne les couleurs d'island.css, light-island.ts).
    applyIslandTheme(s);
    setSoundPrefs(s.island.sounds ?? true, s.island.soundVolume ?? 0.5);
    this.reorderTabs();
    this.drawPrivacy();
    this.notifications.defaultDurationMs = s.island.notificationSecs * 1000;
    // Réglages → Mascotte → Taille : la place de la mascotte dans l'île ouverte (island.css).
    this.shell.dataset.mascotSize = s.mascot.size ?? "normal";
    // Ondine sur le bureau (src/pet/) : elle n'est plus dans l'île (ni au bord de l'écran).
    const wanted = s.mascot.enabled && !petOn(s) ? s.mascot.id : "";
    if (wanted !== this.mascotId) {
      this.mascot?.destroy();
      this.mascot = null;
      this.renderer = null;
      this.mascotId = wanted;
      const entry = wanted ? findMascot(wanted) : null;
      this.mascotManifest = entry?.manifest ?? null;
      if (entry) {
        const renderer = createRenderer(entry.manifest, entry.assets);
        renderer.mount(this.mascotSlot);
        this.renderer = renderer;
        this.mascot = new MascotController(entry.manifest, renderer, this.bus, {
          boredAfterMs: s.mascot.boredAfterSecs * 1000,
          sleepAfterMs: s.mascot.sleepAfterSecs * 1000,
        });
      }
      this.shell.classList.toggle("no-mascot", !this.mascot);
      // Ondine part sur le bureau ou en revient : le bouton « Faire rentrer » suit.
      if (this.expandedUi) this.render(true);
    }
    if (this.mascot) {
      this.mascot.timings = { boredAfterMs: s.mascot.boredAfterSecs * 1000, sleepAfterMs: s.mascot.sleepAfterSecs * 1000 };
    }
    // Format nano, île-bouche ; Ondine partie sur le bureau avec l'île : la fenêtre se fait bande.
    this.forms.apply(s);
    // Le bord ou la place ont peut-être changé : la forme voulue aussi.
    this.jelly.retarget();
  }

  // ── Le trou noir ───────────────────────────────────────────────────────────

  /**
   * Une fenêtre qu'on fait glisser reste un instant au-dessus de l'île (le Rust
   * de windowlife le dit, `windowlife.hole-hover`) : l'île se montre si elle
   * était cachée et s'assombrit (classe `hole-over`, windowlife.css) ; avalée,
   * elle fait « gloups » (`hole-gulp`) ; une fenêtre qui ressort, un éclat
   * (`hole-spit`). Seulement des filtres et une ombre : la forme reste à la gelée.
   */
  private wireBlackHole() {
    let over = false;
    const flash = (cls: string) => {
      this.shell.classList.remove(cls);
      void this.shell.offsetWidth; // l'animation repart du début
      this.shell.classList.add(cls);
      window.setTimeout(() => this.shell.classList.remove(cls), 700);
    };
    this.bus.on("windowlife.hole-hover", (msg) => {
      const now = !!(msg.payload as { over?: boolean } | null)?.over;
      if (now === over) return;
      over = now;
      this.shell.classList.toggle("hole-over", now);
      if (now) this.fsm.pointerEnter();
      else this.fsm.pointerLeave();
    });
    this.bus.on("windowlife.swallowed", (msg) => {
      over = false;
      this.shell.classList.remove("hole-over");
      if ((msg.payload as { ok?: boolean } | null)?.ok) flash("hole-gulp");
    });
    this.bus.on("windowlife.spat", () => flash("hole-spit"));
  }

  // ── Micro et caméra ────────────────────────────────────────────────────────

  /**
   * Le module Contrôles dit qui utilise le micro ou la caméra, et si le micro
   * est coupé. On montre un point (orange = micro, vert = caméra, comme sur
   * iPhone), même île cachée (une petite barre au bord), et un badge sur Ondine
   * tant que le micro est coupé.
   */
  private wirePrivacy() {
    this.bus.on("controls.media-use", (msg) => {
      const p = (msg.payload ?? {}) as { mic?: string[]; cam?: string[] };
      this.mediaUse = { mic: p.mic ?? [], cam: p.cam ?? [] };
      this.drawPrivacy();
    });
    this.bus.on("controls.mic-muted", (msg) => {
      const muted = !!(msg.payload as { muted?: boolean } | null)?.muted;
      this.mascotSlot.classList.toggle("mic-muted", muted);
    });
  }

  private drawPrivacy() {
    const values = settingsStore.current.modules?.controls?.values ?? {};
    const wanted = values.privacyDot !== false;
    const { mic, cam } = this.mediaUse;
    const kind = !wanted ? "" : cam.length ? "cam" : mic.length ? "mic" : "";
    this.shell.dataset.privacy = kind;
    const parts = [];
    if (cam.length) parts.push(`Caméra : ${cam.join(", ")}`);
    if (mic.length) parts.push(`Micro : ${mic.join(", ")}`);
    this.privacyDot.title = parts.join(" · ");
    this.privacyDot.setAttribute("aria-label", this.privacyDot.title);
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  private onTransition(from: IslandState, to: IslandState) {
    log.debug(`${from} → ${to}`);
    this.bus.emit("island.state", { from, to });

    if (this.collapseTimer != null) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    const token = ++this.collapseToken;
    // Le mode dépôt se termine (alerte qui attendait, Échap…) : le fichier tenu est lâché.
    if (from === "drop" && to !== "drop") {
      this.endHeld();
      this.dropPanel.leave();
    }
    this.forms.onTransition(from, to);
    // (Île-bouche partie avec Ondine sur le bureau : la fenêtre reste une bande.)
    if (from === "hidden" && !this.forms.away) {
      // On agrandit d'abord la fenêtre, puis l'île s'anime dedans.
      void Bridge.islandSetCollapsed(false);
      // Ondine pendait au bord : elle remonte, l'île arrive.
      this.hanger.hide();
    }
    // Focus clavier uniquement dans la vue agrandie (ouverte par un clic) : Échap
    // fonctionne, et on rend le focus à l'appli d'avant en sortant.
    if (to === "expanded") void Bridge.islandSetFocus(true);
    if (from === "expanded") void Bridge.islandSetFocus(false);
    // L'astuce d'un onglet ne vit que dans l'île ouverte (jamais par-dessus une alerte).
    if (from === "expanded") this.tips.hide();
    if (to !== "hidden") this.mascot?.activity();
    // L'île se rouvre sur l'Accueil (réglage du module home), sauf onglet demandé.
    if (to === "expanded" && (from === "hidden" || from === "peek" || from === "compact") && !this.tabAsked && homeOnOpen(settingsStore.current, settingsStore.moduleEnabled("home"))) {
      this.activeTab = "home";
    }
    // Petits sons : une bulle qui monte à l'ouverture, qui redescend à la fermeture.
    if (to === "expanded") sounds.open();
    else if (from === "expanded") sounds.close();
    this.render();
    if (to === "hidden") {
      // On laisse l'animation de fermeture se finir avant de réduire la
      // fenêtre : quand les ressorts sont posés (render() vient de leur donner
      // la nouvelle forme), ou au plus tard après SETTLE_FALLBACK_MS.
      const collapse = () => {
        if (token !== this.collapseToken || this.fsm.state !== "hidden" || this.hatching) return;
        this.collapseToken++;
        if (this.collapseTimer != null) clearTimeout(this.collapseTimer);
        this.collapseTimer = null;
        void Bridge.islandSetCollapsed(true);
      };
      this.collapseTimer = window.setTimeout(collapse, SETTLE_FALLBACK_MS);
      this.jelly.whenSettled(collapse);
    }
  }

  // ── Entrées : souris, clavier, glisser-déposer, menu ───────────────────────

  private wireInputs() {
    // La souris, en coordonnées de la fenêtre. Dans l'appli, le Rust l'envoie ~60×/s
    // (une fenêtre qui laisse passer les clics ne reçoit plus d'événements souris).
    // Dans un navigateur (npm run dev), on lit simplement les événements de la page.
    if (IS_TAURI) {
      void onTauriEvent<{ x: number; y: number }>("cursor", (p) => this.pointer(p.x, p.y));
    } else {
      document.addEventListener("mousemove", (e) => this.pointer(e.clientX, e.clientY));
    }
    // Île cachée : la fenêtre n'est qu'une bande de 6 px. Le Rust surveille la
    // souris et prévient quand elle touche cette bande.
    void onTauriEvent("wake-enter", () => this.fsm.state === "hidden" && !this.presenting && !this.forms.away && this.fsm.pointerEnter());
    void onTauriEvent("wake-leave", () => this.fsm.state === "hidden" && this.fsm.pointerLeave());
    // La souris a touché le reflet de l'île sur un autre écran (src-tauri/src/island/mirrors.rs) : l'île y est venue, en mini-île.
    void onTauriEvent("mirror-arrive", () => !this.presenting && this.fsm.showCompact());

    // Étirer l'île par son bord intérieur, la déplacer par son bord extérieur (gestures.ts).
    this.wasGesture = enableGestures(this.shell, {
      edge: () => this.edge(),
      enabled: () => ["peek", "compact", "expanded", "alert"].includes(this.fsm.state),
      onMoveStart: () => this.startMove(),
      // La bosse qui suit la souris (jelly.ts), et Ondine qui le sent.
      onPull: (amount, x, y) => {
        this.jelly.pull(amount, x, y);
        this.react("stretch", { ...this.fromMascot(x, y), amount });
      },
      onRelease: (amount) => {
        this.jelly.letGo();
        if (amount > 8) sounds.boing();
        this.react("release", { amount });
      },
      onShake: (turns) => this.react("shake", { amount: turns }),
    });
    // Un appui (hors boutons et champs) enfonce le bord le plus proche ; au
    // relâcher, une onde fait le tour de l'île (jelly.ts).
    this.shell.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, select, textarea, a, [role='slider'], [contenteditable]")) return;
      if (!["compact", "expanded", "alert", "drop"].includes(this.fsm.state)) return;
      this.jelly.press(e.clientX, e.clientY);
      this.react("poke", this.fromMascot(e.clientX, e.clientY));
    });
    const unpress = () => this.jelly.release();
    window.addEventListener("pointerup", unpress);
    window.addEventListener("pointercancel", unpress);
    // Un « tic » doux sur chaque bouton de l'île.
    this.shell.addEventListener("click", (e) => (e.target as HTMLElement).closest("button") && sounds.tap(), true);
    // Au survol, le pointeur montre ce qu'on peut faire sur les bords.
    this.shell.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      const zone = ["compact", "expanded", "alert"].includes(this.fsm.state) ? grabZone(this.shell, this.edge(), e.clientX, e.clientY) : null;
      const along = horizontal(this.edge()) ? "ns-resize" : "ew-resize";
      this.shell.style.cursor = zone === "outer" ? "grab" : zone === "inner" ? along : "";
      this.shell.classList.toggle("grab-inner", zone === "inner");
    });
    this.shell.addEventListener("pointerleave", () => {
      this.shell.classList.remove("grab-inner");
      this.jelly.pointerOut();
    });

    this.shell.addEventListener("click", (e) => {
      if (this.wasGesture()) return;
      if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      this.fsm.click();
    });
    this.wireCarry();
    this.mascotSlot.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.wasGesture() || this.carried) return;
      // Elle tient la pancarte « ? » (un agent attend une réponse) : le clic
      // ouvre l'onglet Agents IA (une alerte affichée est fermée d'abord).
      if (this.mascot?.askOpen && this.fsm.state !== "expanded") {
        if (this.fsm.state === "alert") this.notifications.dismissCurrent();
        this.registry.onOpenRequest("agents");
        return;
      }
      this.bus.emit("mascot.clicked");
      // Double-clic : l'action choisie, un instant après, si aucun 3e clic ne vient (mascot-double-click.ts).
      if (this.doubleClick.click(performance.now())) {
        window.setTimeout(() => this.doubleClick.confirm(performance.now()) && this.mascotDoubleClick(), CONFIRM_MS);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || this.dropPanel.held) return;
      if (this.fsm.escape() === "dismiss-alert") this.notifications.dismissCurrent();
    });

    void onDragDrop((e) => this.onDrag(e));
    void onTauriEvent<string>("tray", (id) => id === "open" && this.fsm.open());
    // Le raccourci clavier de l'île (Ctrl+Alt+O par défaut) : ouvre, ou referme.
    void onTauriEvent("hotkey", () => {
      if (this.fsm.state === "expanded") return this.fsm.close();
      // Ouverte au clavier : on continue au clavier (Tab, flèches, Entrée).
      this.focusTabsOnOpen = true;
      this.fsm.open();
    });
    void onTauriEvent<string>("hotkey-error", (text) => this.notifications.push({ moduleId: "island", title: text, icon: "⌨️", priority: "normal" }));
    void onTauriEvent("screen-changed", () => void Bridge.islandReposition());
    // L'île s'écarte d'une fenêtre (les réglages…), acculée, ou rentre chez elle.
    void onTauriEvent<{ edge: Edge; align: string; phase: "flee" | "cornered" | "home"; soft?: boolean }>("island-placement", (p) => this.onDodge(p));
    // Mode démo (scène « L'île s'écarte », core/demo.ts).
    this.bus.on("island.dodge-demo", (msg) => this.onDodge(msg.payload as { edge: Edge; align: string; phase: "flee" | "cornered" | "home"; soft?: boolean }));
    // Fin d'un déplacement : l'île s'est posée sur un bord.
    void onTauriEvent("island-drag-end", () => {
      this.shell.classList.remove("moving");
      this.pushRect();
    });

    // La forme de l'île change (animation, contenu) : le Rust doit la connaître
    // pour décider où les clics passent au travers.
    // (Pendant un ressort, la taille change à chaque image : un rectangle par
    // image, comme avant avec les transitions CSS. La fin : onSettle de jelly.)
    new ResizeObserver(() => this.pushRect()).observe(this.shell);
    this.shell.addEventListener("transitionend", () => this.pushRect());
    // Ce qui change la forme voulue par le CSS sans passer par render() :
    // le point micro/caméra (île cachée), une classe, le bord ou la place.
    const reshape = new MutationObserver(() => this.scheduleRetarget());
    reshape.observe(this.shell, { attributes: true, attributeFilter: ["class", "data-privacy"] });
    reshape.observe(document.body, { attributes: true, attributeFilter: ["class", "data-edge", "data-align"] });
    // Le contenu change (un QR code s'ouvre, un autre onglet) : l'île ouverte
    // grandit pour le montrer en entier, ou reprend sa taille (fit.ts).
    // characterData : le texte d'une réponse qui s'écrit mot à mot.
    // attributes : un échange qui commence ou finit (FIT_HOLD_ATTR).
    new MutationObserver(() => this.scheduleFit()).observe(this.content, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [FIT_ATTR, FIT_HOLD_ATTR] });
  }

  private scheduleFit() {
    if (this.fitQueued) return;
    this.fitQueued = true;
    requestAnimationFrame(() => {
      this.fitQueued = false;
      void this.applyFit();
      // En alerte, la taille dépend du contenu (island.css : :has(.notif.many)…).
      if (this.fsm.state === "alert") this.jelly.retarget();
    });
  }

  private retargetQueued = false;
  /** Relit la forme voulue à la prochaine image (plusieurs changements → une seule lecture). */
  private scheduleRetarget() {
    if (this.retargetQueued) return;
    this.retargetQueued = true;
    requestAnimationFrame(() => {
      this.retargetQueued = false;
      this.jelly.retarget();
    });
  }

  /**
   * Ondine sur le bureau : on attrape la mascotte et on la tire hors de l'île ;
   * lâchée dehors, elle s'installe sur le bureau à cet endroit (src/pet/).
   * Lâchée dans l'île, elle revient à sa place.
   */
  private wireCarry() {
    const slot = this.mascotSlot;
    let start: { x: number; y: number; id: number } | null = null;
    let moving = false;
    // La dernière place vue : hors de la fenêtre, le lâcher peut arriver sans coordonnées.
    let last = { x: 0, y: 0 };
    const outside = (x: number, y: number) => {
      const r = this.shell.getBoundingClientRect();
      return x < r.left - 24 || x > r.right + 24 || y < r.top - 24 || y > r.bottom + 24;
    };
    // L'appui long (1.2.4) : le doigt reste sur elle sans bouger. Publié sur
    // le bus (« mascot.long-press ») : le module Jeux y lance le morpion
    // express. Le clic qui suit le lâcher est ignoré (comme après un transport).
    let hold = 0;
    let longPressed = false;
    const cancelHold = () => {
      window.clearTimeout(hold);
      hold = 0;
    };
    slot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.mascot || !["compact", "expanded"].includes(this.fsm.state)) return;
      // La mascotte n'étire pas l'île et ne la déplace pas : on la prend, elle.
      e.stopPropagation();
      this.carried = false;
      longPressed = false;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      slot.setPointerCapture(e.pointerId);
      this.react("poke", { x: 0, y: 0 });
      cancelHold();
      hold = window.setTimeout(() => {
        hold = 0;
        if (!start || moving) return;
        longPressed = true;
        this.carried = true;
        this.doubleClick.reset();
        log.info("appui long sur Ondine");
        this.bus.emit("mascot.long-press");
      }, LONG_PRESS_MS);
    });
    slot.addEventListener("pointermove", (e) => {
      if (!start || !e.buttons) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moving && Math.hypot(dx, dy) < 12) return;
      if (!moving) {
        moving = true;
        cancelHold();
        slot.classList.add("carried");
        this.mascot?.request("surprise");
      }
      last = { x: e.clientX, y: e.clientY };
      slot.style.translate = `${dx}px ${dy}px`;
      slot.classList.toggle("leaving", outside(e.clientX, e.clientY));
    });
    const end = (e: PointerEvent) => {
      cancelHold();
      if (!start) return;
      if (longPressed) {
        // Le clic du lâcher ne compte pas : la surprise est déjà partie.
        longPressed = false;
        start = null;
        window.setTimeout(() => (this.carried = false), 300);
        return;
      }
      const wasMoving = moving;
      start = null;
      moving = false;
      slot.classList.remove("carried", "leaving");
      slot.style.translate = "";
      if (!wasMoving) return;
      this.carried = true;
      this.doubleClick.reset();
      window.setTimeout(() => (this.carried = false), 300);
      if (e.type !== "pointercancel" && outside(last.x, last.y)) {
        log.info("Ondine sortie de l'île vers le bureau");
        void Bridge.petPlace(true);
      } else {
        this.mascot?.request("idle");
      }
    };
    slot.addEventListener("pointerup", end);
    slot.addEventListener("pointercancel", end);
    // Windows a repris la souris (fenêtre devenue transparente aux clics) : c'est un lâcher.
    slot.addEventListener("lostpointercapture", end);
  }

  /**
   * Double-clic sur Ondine (1.2.3) : l'action des réglages (Parler à Ondine
   * par défaut, Lanceur, Capture, Note rapide, Rien). Chaque action passe par
   * le module qui la fait ; un module désactivé le dit en une ligne.
   */
  private mascotDoubleClick() {
    const action = doubleClickActionOf(settingsStore.current.mascot.doubleClick);
    if (action === "none") return;
    if (!settingsStore.moduleEnabled(ACTION_MODULE[action])) {
      const names = { ask: "Parler à Ondine", launcher: "Lanceur", capture: "Capture", note: "Notes", awake: "Rester éveillé" };
      this.notifications.push({ moduleId: "island", title: `Module « ${names[action]} » désactivé`, body: "Activez-le dans les Réglages, ou choisissez une autre action du double-clic.", icon: "💧", priority: "low", key: "mascot-dblclick" });
      return;
    }
    log.info(`double-clic sur Ondine : ${action}`);
    if (action === "ask") this.registry.onOpenRequest("askclaude");
    else if (action === "launcher") this.bus.emit("launcher.open");
    else if (action === "capture") this.bus.emit("capture.request", { then: "save" });
    else if (action === "awake") this.bus.emit("awake.toggle", {});
    else this.bus.emit("notes.quick");
  }

  /** Un point de la fenêtre, en px depuis le centre de la mascotte (pour ses réactions). */
  private fromMascot(x: number, y: number): { x: number; y: number } {
    const m = this.mascotSlot.getBoundingClientRect();
    return { x: x - (m.left + m.width / 2), y: y - (m.top + m.height / 2) };
  }

  /**
   * Prévient la mascotte d'un geste sur l'île : « poke » (un appui), « stretch »
   * (on tire la bosse), « release » (on lâche), « shake » (on secoue). La
   * méthode `react` est facultative : un moteur qui ne la connaît pas ne fait rien.
   */
  private react(kind: MascotReaction, data: { x?: number; y?: number; amount?: number }) {
    if (!this.renderer?.react) return;
    try {
      this.renderer.react(kind, data);
    } catch (err) {
      log.warn(`réaction de la mascotte en erreur : ${String(err)}`);
    }
  }

  /**
   * L'île ouverte prend la hauteur (et, avec `data-island-fit="both"`, la
   * largeur) de son contenu marqué `data-island-fit`, ou sa taille habituelle.
   * Appelée à chaque changement du contenu, en continu (fit.ts).
   */
  private async applyFit() {
    const view = this.fsm.state === "expanded" ? this.expandedUi?.body : undefined;
    const marked = view?.querySelector<HTMLElement>(`[${FIT_ATTR}]`) ?? null;
    const wantH = view && marked ? fitHeight(this.shell.offsetHeight, view.clientHeight, contentHeight(view)) : null;
    const wide = marked && fitMode(marked.getAttribute(FIT_ATTR)) === "both" ? (marked.querySelector<HTMLElement>(`[${FIT_W_ATTR}]`) ?? marked) : null;
    this.watchFit(marked, wide);
    const wantW = view && wide ? fitWidth(this.shell.offsetWidth, view.clientWidth, naturalWidth(wide), this.tabsWidth(), horizontal(this.edge()) ? FIT_MAX_W : FIT_MAX_W_SIDE) : null;
    // Sans va-et-vient : elle grandit tout de suite, ne rétrécit que nettement.
    const hold = marked?.hasAttribute(FIT_HOLD_ATTR) ?? false;
    const target = settle(this.fitH, wantH, undefined, hold);
    const width = settle(this.fitW, wantW, undefined, hold);
    if (target === this.fitH && width === this.fitW) return;
    // Un contenu qui change pendant qu'il est montré : la gelée glisse (sans rebond).
    this.jelly.setGlide(target !== null || width !== null);
    if (width !== this.fitW) {
      this.fitW = width;
      if (width === null) this.shell.style.removeProperty("--fit-w");
      else this.shell.style.setProperty("--fit-w", `${width}px`);
      if (target === this.fitH) {
        this.jelly.retarget();
        return;
      }
    }
    this.fitH = target;
    window.clearTimeout(this.tallTimer);
    if (target === null) {
      this.shell.style.removeProperty("--fit-h");
      this.jelly.retarget();
      // La fenêtre rend le panneau haut une fois l'île revenue à sa taille
      // (ressorts posés, ou au plus tard après SETTLE_FALLBACK_MS).
      const shrink = () => {
        if (this.fitH !== null || !this.tall) return;
        window.clearTimeout(this.tallTimer);
        this.tall = false;
        void Bridge.islandSetTall(false);
      };
      this.tallTimer = window.setTimeout(shrink, SETTLE_FALLBACK_MS);
      this.jelly.whenSettled(shrink);
      return;
    }
    // La fenêtre d'abord (sinon l'île grandirait coupée), puis l'île, avec son ressort.
    if (!this.tall) {
      this.tall = true;
      await Bridge.islandSetTall(true);
    }
    if (this.fitH === target) {
      this.shell.style.setProperty("--fit-h", `${target}px`);
      this.jelly.retarget();
    }
  }

  /** Observe en continu le contenu marqué (sa taille change sans changer de nœuds : une image qui charge, un texte qui s'allonge). */
  private watchFit(marked: Element | null, wide: Element | null) {
    if (marked === this.fitWatched[0] && wide === this.fitWatched[1]) return;
    this.fitObserver?.disconnect();
    this.fitWatched = [marked, wide];
    if (!marked) return;
    this.fitObserver ??= new ResizeObserver(() => this.scheduleFit());
    this.fitObserver.observe(marked);
    if (wide && wide !== marked) this.fitObserver.observe(wide);
  }

  /** La largeur qu'il faut aux onglets de l'île ouverte (l'île ne se resserre jamais en dessous). */
  private tabsWidth(): number {
    const header = this.expandedUi?.tabs.values().next().value?.parentElement;
    if (!header) return 0;
    const gap = parseFloat(getComputedStyle(header).columnGap) || 0;
    let need = 0;
    let n = 0;
    for (const child of header.children) {
      if (!(child instanceof HTMLElement) || child.classList.contains("spacer")) continue;
      need += child.offsetWidth;
      n++;
    }
    // Les marges de l'île autour de la vue.
    return need + gap * Math.max(0, n - 1) + (this.shell.offsetWidth - header.clientWidth);
  }

  /** Le bord de l'écran où se trouve l'île (posé sur <body> par applySettings). */
  /**
   * Un petit saut de l'île (une notification en mini-île) : elle gonfle vers
   * le centre de l'écran puis revient, avec un rebond, SANS se décoller du
   * bord ni bouger de sa place (jelly.ts, bump). `amount` module la hauteur.
   * Pas avec « Réduire les animations » ni en économie d'énergie.
   */
  private hop(amount: number) {
    if (reducedMotion() || perfMode() === "eco" || !motionOn()) return;
    this.jelly.bump(amount);
  }

  private edge(): Edge {
    const e = document.body.dataset.edge;
    return e === "left" || e === "right" || e === "bottom" ? e : "top";
  }

  /** La bande au bord de l'écran, là où l'île se cache (pour le survol). */
  private inEdgeZone(x: number, y: number): boolean {
    const edge = this.edge();
    const align = document.body.dataset.align ?? "center";
    const W = window.innerWidth;
    const H = window.innerHeight;
    const span = (len: number, p: number) => {
      const start = align === "start" ? 0 : align === "end" ? len - EDGE_ZONE.len : (len - EDGE_ZONE.len) / 2;
      return p >= start && p <= start + EDGE_ZONE.len;
    };
    if (edge === "left") return x <= EDGE_ZONE.depth && span(H, y);
    if (edge === "right") return x >= W - EDGE_ZONE.depth && span(H, y);
    if (edge === "bottom") return y >= H - EDGE_ZONE.depth && span(W, x);
    return y <= EDGE_ZONE.depth && span(W, x);
  }

  /**
   * Le Rust déplace l'île pour qu'elle ne cache pas une fenêtre (island/dodge.rs) :
   * sa forme prend le nouveau bord, et Ondine a peur (acculée : panique) ; de
   * retour chez elle, elle soupire de soulagement. La peur n'est pas rejouée à
   * chaque pas quand on pousse la fenêtre vers elle.
   */
  private onDodge(p: { edge: Edge; align: string; phase: "flee" | "cornered" | "home"; soft?: boolean }) {
    const s = settingsStore.current;
    if (p.phase === "home") {
      if (!this.dodgePlace) return;
      this.dodgePlace = null;
      document.body.dataset.edge = s.island.edge ?? "top";
      document.body.dataset.align = s.island.align ?? "center";
      if (!p.soft) this.bus.emit("mascot.emote", { emotion: "relieved" });
      return;
    }
    const first = !this.dodgePlace;
    this.dodgePlace = { edge: p.edge, align: p.align };
    document.body.dataset.edge = p.edge;
    document.body.dataset.align = p.align;
    const now = Date.now();
    // Une fenêtre au premier plan, une bulle de Windows : elle s'écarte sans avoir peur.
    if (p.soft) return;
    if (first || p.phase === "cornered" || now - this.lastFright > FRIGHT_EVERY_MS) {
      this.lastFright = now;
      this.bus.emit("mascot.emote", { emotion: p.phase === "cornered" ? "panic" : "scared" });
    }
  }

  /** On a attrapé l'île par son bord extérieur : le Rust déplace la fenêtre. */
  private startMove() {
    // Le Rust oublie la place provisoire : c'est la main qui décide.
    this.dodgePlace = null;
    this.jelly.release();
    this.shell.classList.add("moving");
    void Bridge.islandDragStart();
  }

  /**
   * C'est peut-être le moment pour Ondine de venir pendre au bord : île cachée,
   * réglage activé, personne au clavier depuis un moment, pas de présentation,
   * et pas de visite depuis `peekEveryMins`. Un peu de hasard en plus.
   */
  private async maybePeek() {
    const s = settingsStore.current;
    // Pas de visite en « Calme » (mascot.calm).
    if (!s.mascot.enabled || !s.mascot.peek || s.mascot.calm || !this.fsm.resting() || this.hanger.showing) return;
    if (Date.now() - this.lastPeek < (s.mascot.peekEveryMins ?? 5) * 60_000) return;
    const desk = await Bridge.deskState();
    if (!desk || desk.busy || desk.idleMs < PEEK_IDLE_MS) return;
    if (Math.random() < 0.4) return;
    this.lastPeek = Date.now();
    this.startPeek();
  }

  /**
   * Ondine vient pendre au bord. En « Toujours en mini » (réglage par défaut),
   * la mini-île remonte le temps de la visite pour lui laisser la place, puis
   * revient quand elle repart (onHangChange).
   */
  private startPeek() {
    if (this.hanger.showing || this.presenting) return;
    // Île-bouche : Ondine est déjà au bord (c'est elle, l'île) ; elle s'étire et cligne.
    if (islandStyle(settingsStore.current) === "mouth") return this.forms.visit();
    if (this.fsm.state === "hidden") {
      this.hanger.show();
      return;
    }
    if (!this.fsm.resting()) return;
    this.peekHid = true;
    this.fsm.hide();
    // La mini-île finit de remonter avant que la goutte descende.
    window.setTimeout(() => {
      if (this.peekHid && this.fsm.state === "hidden") this.hanger.show();
      else this.endPeekHide();
    }, reducedMotion() ? 0 : 450);
  }

  /** Fin d'une visite qui avait fait remonter la mini-île : elle revient. */
  private endPeekHide() {
    if (!this.peekHid) return;
    this.peekHid = false;
    if (!this.presenting) this.fsm.restore();
  }

  /**
   * Mode présentation (réglage « presentationQuiet ») : pendant un diaporama
   * PowerPoint, une vidéo ou un jeu en plein écran (Windows le signale), l'île
   * se cache, la souris au bord ne la réveille plus, et les notifications
   * attendent. À la fin, elles arrivent, avec un petit résumé.
   */
  private async checkPresentation() {
    const wanted = settingsStore.current.island.presentationQuiet ?? true;
    const desk = wanted ? await Bridge.deskState() : null;
    const busy = !!desk?.busy;
    if (busy === this.presenting) return;
    this.presenting = busy;
    document.body.classList.toggle("presenting", busy);
    if (busy) {
      this.hanger.hide(true);
      this.fsm.hide();
      this.notifications.pause(true);
    } else {
      const n = this.notifications.waiting();
      this.notifications.pause(false);
      this.fsm.restore();
      // (Une concentration encore en cours fera le résumé à sa fin.)
      if (n > 1 && !this.notifications.isPaused()) this.notifications.push({ moduleId: "island", title: `${n} notifications pendant votre présentation`, icon: "🎬", priority: "low", key: "presentation-summary" });
    }
  }

  /**
   * Mode concentration : pendant une séance de travail Pomodoro (si le réglage
   * du Minuteur est activé), le Minuteur publie "timer.focus" {on: true} et les
   * notifications attendent, sauf les « critical » et celles du Minuteur
   * lui-même (la fin de séance doit s'afficher). À la pause, à l'arrêt ou à la
   * fin de la séance ({on: false}), elles arrivent, avec un petit résumé.
   */
  private wireFocus() {
    this.bus.on("timer.focus", (msg) => {
      const on = !!(msg.payload as { on?: boolean } | null)?.on;
      if (on) {
        this.notifications.pause(true, "focus", ["timer"]);
        return;
      }
      if (!this.notifications.isPaused("focus")) return;
      const n = this.notifications.waiting();
      this.notifications.pause(false, "focus");
      // (Une présentation encore en cours fera le résumé à sa fin.)
      if (n > 1 && !this.notifications.isPaused()) {
        this.notifications.push({ moduleId: "island", title: `${n} notifications pendant votre concentration`, icon: "🍅", priority: "low", key: "focus-summary" });
      }
    });
  }

  /**
   * Règles → « Calme / Ne pas déranger pendant X min » : "rules.quiet" {on}.
   * Comme la concentration du Minuteur : les notifications attendent (sauf
   * « critical »), puis un résumé à la fin.
   */
  private wireRulesQuiet() {
    this.bus.on("rules.quiet", (msg) => {
      const on = !!(msg.payload as { on?: boolean } | null)?.on;
      if (on) {
        this.notifications.pause(true, "rules-quiet");
        return;
      }
      if (!this.notifications.isPaused("rules-quiet")) return;
      const n = this.notifications.waiting();
      this.notifications.pause(false, "rules-quiet");
      if (n > 1 && !this.notifications.isPaused()) {
        this.notifications.push({ moduleId: "island", title: `${n} notifications pendant le mode Calme`, icon: "🌙", priority: "low", key: "rules-quiet-summary" });
      }
    });
  }

  /** "nettools.ai-status" : une pastille rouge tant qu'un service IA est en panne. */
  private wireAiDot() {
    this.bus.on("nettools.ai-status", (msg) => {
      const list = ((msg.payload as { services?: { name: string; level: string }[] } | null)?.services ?? []).filter((s) => s.level === "down");
      this.shell.dataset.aiOutage = list.length ? "1" : "";
      this.aiDot.title = list.length ? `En panne : ${list.map((s) => s.name).join(", ")}` : "";
      this.aiDot.setAttribute("aria-label", this.aiDot.title);
    });
  }

  /** "updates.available" {count} : la pastille des mises à jour de logiciels (réglage « Pastille sur l'île »). */
  private wireUpdatesDot() {
    this.bus.on("updates.available", (msg) => {
      const n = Math.max(0, Number((msg.payload as { count?: number } | null)?.count) || 0);
      const on = n > 0 && settingsStore.moduleEnabled("updates") && settingsStore.current.modules?.updates?.values?.dot !== false;
      this.shell.dataset.updates = on ? "1" : "";
      this.updatesDot.title = on ? (n === 1 ? "1 mise à jour de logiciel" : `${n} mises à jour de logiciels`) : "";
    });
  }

  /**
   * L'éclosion peut-elle jouer ? L'île en haut de l'écran (elle sort du haut),
   * au style classique (pas l'île-bouche) et Ondine dans l'île.
   */
  canHatch(): boolean {
    const s = settingsStore.current;
    return this.edge() === "top" && islandStyle(s) !== "mouth" && !petOn(s) && !this.forms.away;
  }

  /** Joue l'éclosion de l'île (hatch.ts), puis rend la main à la vraie île. */
  async hatch(texts: HatchTexts, rings: Ring[]): Promise<void> {
    if (this.hatching || !this.canHatch()) return;
    this.hatching = true;
    document.body.classList.add("hatching");
    this.hanger.hide();
    const cs = getComputedStyle(this.shell);
    try {
      await Bridge.islandSetCollapsed(false);
      await playHatch(this.root, {
        texts,
        rings,
        mascotId: settingsStore.current.mascot.id,
        islandColor: solidColor(cs.backgroundColor),
        textColor: cs.color || "#fff",
        studio: studioOn(),
        onRect: (x, y, w, h) => void Bridge.islandSetRect(x, y, w, h),
      });
    } catch (err) {
      log.warn(`éclosion interrompue : ${String(err)}`);
    } finally {
      this.hatching = false;
      document.body.classList.remove("hatching");
      // La vraie île arrive en fondu, là où la mini-île dessinée vient de se poser.
      document.body.classList.add("hatched");
      window.setTimeout(() => document.body.classList.remove("hatched"), 450);
      if (this.fsm.state === "hidden" && !this.hanger.showing) void Bridge.islandSetCollapsed(true);
      this.jelly.retarget();
      this.pushRect();
    }
  }

  /** Ondine arrive au bord (la fenêtre doit être assez grande) ou repart. */
  private onHangChange(on: boolean) {
    if (on) sounds.drop();
    if (this.fsm.state === "hidden" && !this.hatching) void Bridge.islandSetCollapsed(!on);
    if (!on) this.endPeekHide();
    requestAnimationFrame(() => this.pushRect());
  }

  private pushRect() {
    // Pendant l'éclosion, c'est elle qui donne le rectangle (hatch.ts).
    if (this.hatching) return;
    this.forms.reshaped();
    // Île-bouche : l'île et le corps d'Ondine autour (rien quand elle est partie avec Ondine).
    const body = this.forms.hitRect();
    if (body) {
      this.setRect(body.x, body.y, body.w, body.h);
      return;
    }
    // Île cachée et Ondine au bord : seul son petit rectangle prend la souris.
    const hang = this.fsm.state === "hidden" ? this.hanger.rect() : null;
    if (hang) {
      this.setRect(hang.left, hang.top, hang.width, hang.height);
      return;
    }
    const r = this.shell.getBoundingClientRect();
    this.setRect(r.left, r.top, r.width, r.height);
  }

  /**
   * Le rectangle qui prend la souris, agrandi aux pilules cliquables d'Ondine
   * convertit et au petit rond Étagère du menu de fichiers (à côté de l'île).
   */
  private setRect(x: number, y: number, w: number, h: number) {
    // (Le Rust ne garde qu'un rectangle : celui qui les contient tous.)
    const extra = [this.convert?.hitRect(), this.fsm.state === "drop" ? this.dropPanel?.shelfRect() : null];
    let [left, top, right, bottom] = [x, y, x + w, y + h];
    for (const c of extra) {
      if (!c) continue;
      left = Math.min(left, c.x);
      top = Math.min(top, c.y);
      right = Math.max(right, c.x + c.w);
      bottom = Math.max(bottom, c.y + c.h);
    }
    void Bridge.islandSetRect(left, top, right - left, bottom - top);
  }

  /** Position de la souris (px logiques de la fenêtre). */
  private pointer(x: number, y: number) {
    // Ondine pend au bord : elle suit la souris des yeux. Sur elle, la souris
    // ne réveille pas l'île (on veut pouvoir cliquer dessus).
    if (this.hanger.showing) {
      this.hanger.lookAt(x, y);
      const h = this.hanger.rect();
      if (h && x >= h.left && x <= h.right && y >= h.top && y <= h.bottom) return;
    }
    // Île-bouche partie avec Ondine sur le bureau : rien à suivre ici.
    if (this.forms.away) return;
    this.forms.pointer(x, y);
    // Présentation en cours : la souris au bord ne réveille pas l'île.
    if (this.presenting && this.fsm.state === "hidden") return;
    // Dans l'appli, l'île cachée est gérée par la bande de réveil (ci-dessus).
    if (this.fsm.state === "hidden" && IS_TAURI && !this.hanger.showing) return;
    const hb = this.forms.hitRect();
    const r = hb ? { left: hb.x, top: hb.y, right: hb.x + hb.w, bottom: hb.y + hb.h } : this.shell.getBoundingClientRect();
    const margin = 8;
    const inIsland = x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
    // L'encoche nano ne s'ouvre qu'au survol d'elle-même, pas de toute la bande du bord.
    const inside = inIsland || ((this.fsm.state === "hidden" || this.fsm.shownForm !== "nano") && this.inEdgeZone(x, y));
    if (inside) this.fsm.pointerEnter();
    else this.fsm.pointerLeave();
    // Mini-île survolée : elle gonfle un peu et penche vers la souris.
    this.jelly.pointer(x, y);

    if (!this.mascot) return;
    const m = this.mascotSlot.getBoundingClientRect();
    // Une scène (ou mascot.look-at) lui fait regarder ailleurs un instant.
    if (inside) this.scenes.pointer(x, y);
    if (!this.scenes.gazeHeld()) this.mascot.lookAt(x - (m.left + m.width / 2), y - (m.top + m.height / 2));
    this.eggs.pointer(x, y);
    if (inside) this.mascot.activity();

    // Survol prolongé de la mascotte.
    const onMascot = m.width > 0 && x >= m.left && x <= m.right && y >= m.top && y <= m.bottom;
    if (!onMascot) {
      this.hoverMascotSince = 0;
      this.hoverMascotFired = false;
    } else if (!this.hoverMascotSince) {
      this.hoverMascotSince = Date.now();
    } else if (!this.hoverMascotFired && Date.now() - this.hoverMascotSince > LONG_HOVER_MS) {
      this.hoverMascotFired = true;
      this.bus.emit("mascot.hover-long");
    }
  }

  private onDrag(e: DragDropEvent) {
    // Diagnostic : le type d'événement seulement, jamais les chemins.
    if (e.type !== "over") log.info(`glisser-déposer : ${e.type} (état ${this.fsm.state})`);
    const keys = { shift: !!e.shift, ctrl: !!e.ctrl, alt: !!e.alt };
    switch (e.type) {
      case "enter": {
        // Un autre fichier arrive pendant qu'un premier est tenu : on repart de zéro.
        const wasHeld = this.dropPanel.held;
        if (wasHeld) this.endHeld();
        // Le menu de fichiers prépare ses choix (formats de CE fichier) avant
        // que l'île passe en mode dépôt et les dessine (renderDrop).
        this.dropPanel.prepare(e.paths ?? []);
        if (this.fsm.state === "drop") this.render(true);
        else this.fsm.dragEnter();
        break;
      }
      case "over":
        if (!this.dropPanel.held) this.dropPanel.over(this.cssPos(e.position), keys);
        break;
      case "leave":
        // Le fichier tenu reste dans la main d'Ondine (Windows envoie « leave » après certains lâchers).
        if (this.dropPanel.held) break;
        this.dropPanel.leave();
        this.fsm.dragLeave();
        break;
      case "drop": {
        // LÂCHER = TENIR : sur l'île, rien ne se lance (un clic choisira) ;
        // sur le petit rond Étagère, le fichier y est posé tout de suite ;
        // ailleurs, rien (l'île se referme).
        const paths = e.paths ?? [];
        const r = this.dropPanel.drop(paths, this.cssPos(e.position));
        if (r.type === "hold") this.holdDrop();
        else if (r.type === "choice") this.runDropChoice(r.choice, paths.length ? paths : this.dropPanel.currentPaths());
        else {
          this.dropPanel.leave();
          this.fsm.dragLeave();
        }
        break;
      }
    }
  }

  // ── Le fichier tenu (menu de fichiers, 1.2.5) ──────────────────────────────

  /** Depuis quand l'île a le clavier pour le fichier tenu (un « blur » trop tôt ne compte pas). */
  private heldSince = 0;

  /**
   * Le fichier lâché sur l'île y reste, dans la main d'Ondine : l'île garde
   * le mode dépôt, prend les clics (son rectangle, et celui du petit rond
   * Étagère) et le clavier (Échap, Ctrl, Alt, Maj). Un clic hors de l'île
   * (la fenêtre perd le clavier) ou Échap referment.
   */
  private holdDrop() {
    this.heldSince = performance.now();
    this.shell.classList.add("drop-held");
    sounds.drop();
    void Bridge.islandSetFocus(true);
    this.pushRect();
  }

  /** Fin du fichier tenu (choix fait ou annulé) : le clavier retourne à l'appli d'avant. */
  private endHeld() {
    if (!this.shell.classList.contains("drop-held")) return;
    this.shell.classList.remove("drop-held");
    void Bridge.islandSetFocus(false);
  }

  /** Annuler : Échap, clic dehors, bouton Annuler. Le petit rond revient dans l'île. */
  private cancelHeld() {
    if (!this.dropPanel.held) return;
    this.endHeld();
    this.dropPanel.leave();
    this.fsm.dragLeave();
  }

  /** Un choix du menu de fichiers : convertir, ou la cible d'un module. */
  private runDropChoice(choice: Choice, paths: string[]) {
    if (!paths.length) return this.cancelHeld();
    this.endHeld();
    this.dropPanel.leave();
    if (choice.type === "convert") this.convert.start(choice.start);
    this.fsm.dropped();
    sounds.drop();
    const id = choice.type === "convert" ? "convert" : choice.target.target.id;
    this.bus.emit("island.files-dropped", { count: paths.length, target: id });
    if (choice.type === "target") void this.registry.drop(choice.target.moduleId, choice.target.target, paths);
  }

  /** Les touches et les clics qui referment le fichier tenu. */
  private wireHeld() {
    window.addEventListener("keydown", (e) => {
      if (!this.dropPanel.held) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.cancelHeld();
        return;
      }
      if (e.repeat) return;
      // Ctrl ouvre Outils, Alt ouvre Ranger, Maj passe à « Remplacer l'original ».
      if (e.key === "Control" || e.key === "Alt" || e.key === "Shift") {
        if (e.key === "Alt") e.preventDefault();
        this.dropPanel.keys({ ctrl: e.key === "Control", alt: e.key === "Alt", shift: e.key === "Shift" });
      }
    }, true);
    // Un clic dans la fenêtre, hors de l'île et du petit rond : on referme.
    window.addEventListener("pointerdown", (e) => {
      if (!this.dropPanel.held) return;
      const t = e.target as HTMLElement | null;
      if (t && (this.shell.contains(t) || t.closest(".drop-shelf"))) return;
      this.cancelHeld();
    }, true);
    // Un clic ailleurs sur l'écran (la fenêtre perd le clavier) : on referme.
    window.addEventListener("blur", () => {
      if (this.dropPanel.held && performance.now() - this.heldSince > 400) this.cancelHeld();
    });
  }

  /** Ondine regarde un point de la fenêtre (une pilule visée), ou rien de précis (null). */
  private lookAtPoint(point: { x: number; y: number } | null) {
    if (!this.mascot || !point || this.scenes.gazeHeld()) return;
    const m = this.mascotSlot.getBoundingClientRect();
    this.mascot.lookAt(point.x - (m.left + m.width / 2), point.y - (m.top + m.height / 2));
  }

  /**
   * La disposition des pilules du dépôt (Réglages → Étagère → Pilules du
   * dépôt). La première fois, les anciens interrupteurs sont repris
   * (drop-pills-logic.ts, legacyHidden).
   */
  private dropLayout(): DropLayout {
    const mods = settingsStore.current.modules;
    const shelf = mods[LAYOUT_MODULE]?.values ?? {};
    return effectiveLayout(shelf[LAYOUT_KEY], {
      showTrash: shelf.showTrash,
      showCompress: shelf.showCompress,
      showTools: shelf.showTools,
      showHash: shelf.showHash,
      terminalDrop: mods.terminal?.values?.showDrop,
      askDrop: mods.askclaude?.values?.showDrop,
    });
  }

  /** Enregistre la disposition des pilules (un favori épinglé dans le menu de fichiers). */
  private saveDropLayout(layout: DropLayout) {
    void settingsStore.update((d) => {
      const entry = (d.modules[LAYOUT_MODULE] ??= { enabled: settingsStore.moduleEnabled(LAYOUT_MODULE), values: {} });
      entry.values[LAYOUT_KEY] = serialize(layout);
    });
  }

  /**
   * Fichiers lâchés sur Ondine sur le bureau (src/pet/) : l'île connaît les
   * cibles des modules et les formats d'Ondine convertit. Elle calcule le
   * menu (le même que dans l'île) et l'envoie à Ondine (« island.drop-menu ») ;
   * le cercle autour d'elle revient avec le choix (« pet.drop-choice ») ou
   * l'annulation, et l'île fait le reste comme pour un clic chez elle.
   */
  private wirePetDrops() {
    let pending: { id: number; paths: string[]; send: () => void } | null = null;
    let nextId = 1;
    this.bus.on("pet.files-dropped", (msg) => {
      const paths = ((msg.payload as { paths?: unknown } | null)?.paths ?? []) as unknown[];
      const clean = paths.filter((p): p is string => typeof p === "string").slice(0, 50);
      if (!clean.length) return;
      // Pas pendant un glisser sur l'île elle-même.
      if (this.fsm.state === "drop") return;
      const id = nextId++;
      this.dropPanel.prepare(clean);
      const send = () => {
        if (pending?.id !== id) return;
        const head = this.dropPanel.header();
        const shelf = settingsStore.moduleEnabled("shelf") && this.dropPanel.hasShelf() ? shelfCount() : null;
        const out: DropMenuMessage = {
          id,
          ...head,
          option: this.dropPanel.optShown(),
          dest: this.dropPanel.effectiveDest(),
          menu: this.dropPanel.currentMenu(),
          shelf,
          says: this.dropPanel.says(),
        };
        this.bus.emit("island.drop-menu", out);
      };
      pending = { id, paths: clean, send };
      send();
      // La réponse du Rust (dossier ou non, taille) arrive un peu après : le menu se complète.
      window.setTimeout(send, 260);
    });
    // L'étoile d'un choix du cercle : l'île enregistre le favori et renvoie le menu.
    this.bus.on("pet.drop-pin", (msg) => {
      const p = msg.payload as { id?: number; choice?: unknown } | null;
      if (!pending || p?.id !== pending.id || typeof p.choice !== "string") return;
      const r = toggleFav(this.dropLayout(), p.choice);
      if (r.full) return;
      this.saveDropLayout(r.layout);
      pending.send();
    });
    this.bus.on("pet.drop-choice", (msg) => {
      const p = msg.payload as { id?: number; choice?: unknown; dest?: unknown; cancel?: boolean } | null;
      if (!pending || p?.id !== pending.id) return;
      const paths = pending.paths;
      pending = null;
      if (p.cancel || typeof p.choice !== "string") return;
      // Un glisser sur l'île a pu passer entre-temps : le menu repart de ces fichiers-là.
      if (this.dropPanel.currentPaths().join("\n") !== paths.join("\n")) this.dropPanel.prepare(paths);
      const choice = this.dropPanel.choiceById(p.choice, parseDest(p.dest));
      this.dropPanel.leave(false);
      if (!choice) return;
      sounds.drop();
      if (choice.type === "convert") {
        // La progression et le résultat se montrent dans la mini-île.
        this.fsm.showCompact();
        this.convert.start(choice.start);
      }
      this.bus.emit("island.files-dropped", { count: paths.length, target: choice.type === "convert" ? "convert" : choice.target.target.id });
      if (choice.type === "target") void this.registry.drop(choice.target.moduleId, choice.target.target, paths);
    });
  }

  /** Une position du glisser (px physiques) en px CSS de la fenêtre. */
  private cssPos(pos: { x: number; y: number } | undefined) {
    if (!pos) return undefined;
    const dpr = window.devicePixelRatio || 1;
    return { x: pos.x / dpr, y: pos.y / dpr };
  }

  /** « Annuler » : le service d'annulation (Rust) propose, l'île affiche. */
  private wireUndo() {
    this.bus.on("undo.offered", (msg) => {
      // Ondine convertit a son propre « Annuler » dans la pilule de résultat.
      if (msg.source === "convert") return;
      const p = msg.payload as { id: number; label: string; expiresInMs: number };
      this.notifications.push({
        moduleId: msg.source,
        title: p.label,
        icon: "↩️",
        priority: "normal",
        durationMs: p.expiresInMs,
        key: `undo-${p.id}`,
        actions: [
          {
            label: "Annuler",
            run: async () => {
              try {
                await Bridge.undoRun(p.id);
                this.notifications.push({ moduleId: "island", title: "Annulé", icon: "↩️", priority: "low", key: `undo-${p.id}` });
              } catch (err) {
                this.notifications.push({ moduleId: "island", title: String(err), icon: "⏱️", priority: "low", key: `undo-${p.id}` });
              }
            },
          },
        ],
      });
    });
  }

  // ── Dessin ─────────────────────────────────────────────────────────────────

  /** Redessine le contenu si ce qui doit être affiché a changé (ou si `force`). */
  private render(force = false) {
    const state = this.fsm.state;
    const n = this.notifications.current();
    this.shell.dataset.state = state;

    // Choix de l'onglet de la vue agrandie : le dernier ouvert s'il est encore là.
    const tabs = this.orderedTabs();
    if (!tabs.some((t) => t.module.manifest.id === this.activeTab)) this.activeTab = tabs[0]?.module.manifest.id ?? null;

    const compactOwner = state === "compact" ? (this.registry.withView("compact")[0]?.module.manifest.id ?? "") : "";
    const key = [state, state === "expanded" ? this.activeTab : "", state === "compact" || state === "alert" ? n?.id : "", compactOwner].join("|");
    if (key === this.renderedKey && !force) {
      this.renderBanner(n);
      return;
    }
    this.renderedKey = key;
    this.unmountView();
    this.unmountView = () => {};
    this.expandedUi?.pill.stop();
    this.expandedUi = null;
    clear(this.content);

    if (state !== "drop") this.releaseDropTall();
    switch (state) {
      case "hidden":
      case "peek":
        break;
      case "compact":
        this.renderCompact(n);
        break;
      case "expanded":
        this.renderExpanded();
        break;
      case "drop":
        this.renderDrop();
        break;
      case "alert":
        if (n) this.content.append(this.notificationCard(n, true));
        break;
    }
    this.renderBanner(n);
    // La nouvelle forme (état, contenu) : l'île y va en ressort, avec son élan.
    this.jelly.retarget();

    // Le contenu arrive en douceur quand l'île change de forme (motion.ts :
    // en douceur en Classique, plus franc en Studio).
    if (state !== this.renderedState && state !== "hidden" && state !== "peek" && motionOn()) {
      this.entrance(state);
    } else if (state === this.renderedState && (state === "compact" || state === "alert") && motionOn()) {
      // Même forme, nouvelle notification : elle sort quand même de la pilule.
      const card = this.content.querySelector(".notif");
      if (card) popIn(card);
    }
    this.renderedState = state;
    // Ondine sortie avec l'île-bouche : elle montre la même chose dans sa bouche.
    this.forms.publishMini();
  }

  /**
   * Arrivée du contenu : les onglets puis les morceaux de la vue passent de
   * flous à nets l'un après l'autre ; une notification sort de la pilule.
   */
  private entrance(state: IslandState) {
    const card = this.content.querySelector(".notif");
    if (card && state !== "expanded") {
      popIn(card);
      return;
    }
    const tabs = this.content.querySelector(".tabs");
    if (tabs) staggerIn(tabs, 20);
    // Le module peut dessiner sa vue juste après : on attend une image.
    requestAnimationFrame(() => {
      const view = this.content.querySelector(".view");
      if (view) staggerIn(view, tabs ? 120 : 40);
    });
  }

  private renderCompact(n: IslandNotification | null) {
    if (n && !isAlert(n)) {
      this.content.append(this.notificationCard(n, false));
      return;
    }
    const first = this.registry.withView("compact")[0];
    if (!first) {
      this.content.append(el("span", { class: "muted" }, "Ondine"));
      return;
    }
    const slot = el("div", { class: "view view-compact" });
    this.content.append(slot);
    this.unmountView = this.registry.mountView(first.module.manifest.id, "compact", slot);
  }

  /** La phrase d'astuce d'un onglet (champ `tip` de son manifeste). */
  private tipOf(id: string): string | undefined {
    return this.registry.withView("expanded").find((t) => t.module.manifest.id === id)?.module.manifest.tip;
  }

  /** Les modules qui ont un onglet, dans l'ordre choisi par l'utilisateur. */
  private orderedTabs() {
    return applyTabOrder(this.registry.withView("expanded"), (t) => t.module.manifest.id, settingsStore.current.island.tabOrder ?? []);
  }

  private renderExpanded() {
    const tabs = this.orderedTabs();
    // Accessibilité : une liste d'onglets (role tablist/tab/tabpanel). Au
    // clavier, Tab entre dans la rangée sur l'onglet actif, les flèches
    // passent d'un onglet à l'autre, Entrée ou Espace l'ouvre (voir tabKeys).
    const header = el("div", { class: "tabs", role: "tablist", "aria-label": "Modules" });
    // Au-delà de 4 onglets, la place manque : les onglets inactifs ne montrent
    // que leur icône (le nom apparaît au survol), l'onglet actif garde son nom.
    if (tabs.length > 4) header.classList.add("icons-only");
    // Encore plus d'onglets : on les resserre, pour que ⚙ reste toujours visible
    // (en attendant le défilement à la souris prévu plus tard).
    if (tabs.length > 8) header.classList.add("dense");
    // Et au-delà de 12 : encore plus serrés, nom de l'onglet actif raccourci.
    if (tabs.length > 12) header.classList.add("tight");
    const buttons = new Map<string, HTMLElement>();
    for (const t of tabs) {
      const m = t.module.manifest;
      const button = el(
        "button",
        {
          class: `tab ${m.id === this.activeTab ? "active" : ""}`,
          "data-id": m.id,
          id: `tab-${m.id}`,
          role: "tab",
          "aria-selected": String(m.id === this.activeTab),
          "aria-controls": PANEL_ID,
          tabindex: m.id === this.activeTab ? 0 : -1,
          title: `${m.name} (glisser pour déplacer)`,
          onclick: () => this.switchTab(m.id),
        },
        el("span", { class: "tab-icon", "aria-hidden": "true" }, icon(m.icon)),
        el("span", { class: "tab-label" }, m.name),
      );
      buttons.set(m.id, button);
      header.append(button);
    }
    header.append(
      el("span", { class: "spacer" }),
      // Ondine est sur le bureau : un bouton la fait rentrer dans l'île.
      ...(petOn(settingsStore.current) ? [el("button", { class: "icon-btn", title: "Faire rentrer Ondine dans l'île", "aria-label": "Faire rentrer Ondine dans l'île", onclick: () => void Bridge.petBack() }, "💧")] : []),
      el("button", { class: "icon-btn", title: "Réglages", "aria-label": "Réglages", onclick: () => void Bridge.openSettingsWindow() }, "⚙"),
      el("button", { class: "icon-btn", title: "Réduire (Échap pour fermer)", "aria-label": "Réduire", onclick: () => this.fsm.shrink() }, "▴"),
    );
    header.addEventListener("keydown", (e) => this.tabKeys(e, header));
    const pill = new TabPill(header);
    // Glisser un onglet le déplace ; le nouvel ordre est enregistré.
    enableTabDrag(header, {
      onMove: () => {
        const active = this.activeTab ? buttons.get(this.activeTab) : undefined;
        if (active) pill.moveTo(active);
      },
      onDrop: (order) => {
        this.tabOrderShown = order.join(",");
        const all = applyTabOrder(this.registry.allIds(), (id) => id, settingsStore.current.island.tabOrder ?? []);
        void settingsStore.update((d) => (d.island.tabOrder = mergeOrder(order, all)));
      },
    });
    this.tabOrderShown = tabs.map((t) => t.module.manifest.id).join(",");
    const banner = el("div", { class: "banner-slot" });
    // La « scène » garde la place du contenu : pendant un changement d'onglet,
    // l'ancien contenu s'efface par-dessus le nouveau.
    const stage = el("div", { class: "view-stage" });
    const body = el("div", { class: "view view-expanded" });
    asPanel(body, this.activeTab);
    stage.append(body);
    this.content.append(header, banner, stage);
    this.expandedUi = { tabs: buttons, pill, stage, body };

    const active = this.activeTab ? buttons.get(this.activeTab) : undefined;
    // La pastille se place une fois la mise en page faite.
    if (active) requestAnimationFrame(() => pill.jumpTo(active));
    if (active && this.focusTabsOnOpen) active.focus();
    this.focusTabsOnOpen = false;

    if (this.activeTab) {
      this.unmountView = this.registry.mountView(this.activeTab, "expanded", body);
      this.tips.show(this.activeTab, this.tipOf(this.activeTab), this.content);
      // Le jour où cet onglet a été ouvert (proposition de masquer un onglet oublié).
      noteTabOpen(this.activeTab);
    } else {
      const benched = this.registry.benchedNames();
      body.append(
        el(
          "p",
          { class: "muted" },
          benched.length
            ? `${benched.join(", ")} a été mis à l'écart après trois plantages. Il revient au prochain démarrage de l'appli.`
            : "Aucun module actif. Activez-en un dans les réglages.",
        ),
      );
    }
  }

  /**
   * Le clavier dans la rangée d'onglets (modèle « onglets » de l'ARIA, avec
   * activation manuelle) : ← → passent à l'onglet voisin (en boucle), Début
   * et Fin au premier et au dernier. Le focus bouge, l'onglet ouvert ne
   * change qu'avec Entrée ou Espace (le clic natif du bouton).
   */
  private tabKeys(e: KeyboardEvent, header: HTMLElement) {
    const tabs = [...header.querySelectorAll<HTMLElement>(":scope > .tab")];
    const from = tabs.indexOf(e.target as HTMLElement);
    if (from < 0 || !tabs.length) return;
    // Sur un côté de l'écran, la rangée reste horizontale : mêmes flèches.
    const moves: Record<string, number> = { ArrowRight: from + 1, ArrowLeft: from - 1, Home: 0, End: tabs.length - 1 };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    for (const t of tabs) t.tabIndex = t === target ? 0 : -1;
    target.focus();
  }

  /**
   * L'ordre des onglets a changé dans les réglages (autre fenêtre) : on les
   * déplace sur place, en les faisant glisser jusqu'à leur nouvelle place.
   */
  private reorderTabs() {
    const ui = this.expandedUi;
    if (!ui) return;
    const ids = this.orderedTabs().map((t) => t.module.manifest.id);
    if (ids.join(",") === this.tabOrderShown) return;
    if (ids.length !== ui.tabs.size || ids.some((id) => !ui.tabs.has(id))) return this.render(true);
    this.tabOrderShown = ids.join(",");
    const header = ui.pill.el.parentElement!;
    const buttons = ids.map((id) => ui.tabs.get(id)!);
    const before = new Map(buttons.map((b) => [b, b.offsetLeft]));
    const spacer = header.querySelector(".spacer");
    for (const b of buttons) header.insertBefore(b, spacer);
    flip(buttons, before);
    const active = this.activeTab ? ui.tabs.get(this.activeTab) : undefined;
    if (active) ui.pill.moveTo(active);
  }

  /**
   * Change d'onglet sans tout redessiner : la pastille glisse jusqu'au nouvel
   * onglet, l'ancien contenu s'efface d'un côté pendant que le nouveau arrive
   * de l'autre (dans le sens du déplacement).
   */
  private switchTab(id: string) {
    const ui = this.expandedUi;
    if (!ui || id === this.activeTab || this.fsm.state !== "expanded") {
      if (id !== this.activeTab) {
        this.activeTab = id;
        this.render(true);
      }
      return;
    }
    const ids = [...ui.tabs.keys()];
    const direction = Math.sign(ids.indexOf(id) - ids.indexOf(this.activeTab ?? "")) || 1;

    // Les onglets : seul l'actif garde son nom (la largeur s'anime en CSS).
    for (const [tabId, button] of ui.tabs) {
      button.classList.toggle("active", tabId === id);
      button.setAttribute("aria-selected", String(tabId === id));
      button.tabIndex = tabId === id ? 0 : -1;
    }
    ui.pill.moveTo(ui.tabs.get(id)!);

    // Le contenu : on démonte l'ancien module, mais on garde son dessin le
    // temps qu'il s'efface.
    this.unmountView();
    const old = ui.body;
    asPanel(old, null);
    const body = el("div", { class: "view view-expanded" });
    asPanel(body, id);
    ui.stage.append(body);
    ui.body = body;
    this.activeTab = id;
    this.renderedKey = ["expanded", id, "", ""].join("|");
    this.unmountView = this.registry.mountView(id, "expanded", body);
    this.tips.show(id, this.tipOf(id), this.content);
    noteTabOpen(id);

    if (reducedMotion()) {
      old.remove();
      return;
    }
    old.classList.add("leaving");
    old.style.pointerEvents = "none";
    tabOut(old, direction).finished.then(
      () => old.remove(),
      () => old.remove(), // animation interrompue (île refermée) : on nettoie quand même
    );
    // Le nouveau contenu arrive en cascade une fois dessiné par le module.
    requestAnimationFrame(() => staggerIn(body, 60));
  }

  private renderDrop() {
    const panel = this.dropPanel.build();
    this.content.append(panel);
    // La hauteur suit le contenu (l'en-tête complété par le Rust, une police chargée…).
    this.dropObserver?.disconnect();
    this.dropObserver = new ResizeObserver(() => void this.fitDrop());
    this.dropObserver.observe(panel);
  }

  /**
   * L'île en mode dépôt prend la hauteur de ses pilules (--drop-h, island.css),
   * avec le ressort de la gelée. Plus haute que le panneau habituel : la
   * fenêtre passe d'abord au panneau haut (comme fit.ts), rendu à la fin.
   */
  private async fitDrop() {
    if (this.fsm.state !== "drop") return;
    const panel = this.content.querySelector<HTMLElement>("[data-drop-panel]");
    if (!panel) return;
    // Les marges de l'île en mode dépôt (island.css) : pas lues sur l'île, que
    // la gelée est peut-être en train d'animer (ses marges aussi).
    const h = Math.min(FIT_MAX_H, Math.ceil(panel.offsetHeight + DROP_PAD_Y));
    if (this.shell.style.getPropertyValue("--drop-h") === `${h}px`) return;
    // Le petit rond Étagère se pose sous l'île (ou au-dessus) : sa place aussi.
    const room = (horizontal(this.edge()) ? PANEL_H : SIDE_PANEL_H) - STRETCH_ROOM - (this.dropPanel.hasShelf() ? SHELF_ROOM : 0);
    if (h > room && !this.tall && !this.dropTall) {
      this.dropTall = true;
      await Bridge.islandSetTall(true);
      if (this.fsm.state !== "drop") return this.releaseDropTall();
    }
    this.shell.style.setProperty("--drop-h", `${h}px`);
    this.jelly.retarget();
  }

  /** Fin du mode dépôt : la fenêtre rend le panneau haut, une fois l'île revenue à sa taille. */
  private releaseDropTall() {
    this.dropObserver?.disconnect();
    this.dropObserver = null;
    this.shell.style.removeProperty("--drop-h");
    if (!this.dropTall) return;
    const shrink = () => {
      if (!this.dropTall || this.fsm.state === "drop") return;
      this.dropTall = false;
      if (!this.tall) void Bridge.islandSetTall(false);
    };
    window.setTimeout(shrink, SETTLE_FALLBACK_MS);
    this.jelly.whenSettled(shrink);
  }

  /** Dans la vue agrandie, une notification normale s'affiche en bandeau sans tout redessiner. */
  private renderBanner(n: IslandNotification | null) {
    const slot = this.content.querySelector<HTMLElement>(".banner-slot");
    if (!slot) return;
    clear(slot);
    if (n && !isAlert(n) && this.fsm.state === "expanded") slot.append(this.notificationCard(n, false));
  }

  private notificationCard(n: IslandNotification, big: boolean): HTMLElement {
    const actions = el("div", { class: "notif-actions" });
    for (const a of n.actions ?? []) {
      actions.append(
        el(
          "button",
          {
            class: "btn small",
            onclick: async () => {
              this.notifications.dismiss(n.id);
              try {
                await a.run();
              } catch (err) {
                log.warn(`action de notification en erreur : ${String(err)}`);
              }
            },
          },
          a.label,
        ),
      );
    }
    actions.append(el("button", { class: "icon-btn", title: "Fermer", onclick: () => this.notifications.dismiss(n.id) }, "×"));
    // Un contenu dessiné par le demandeur (« Quoi de neuf » et ses mascottes
    // animées) : dans l'alerte seulement, défait avec la carte (unmountView).
    const custom = big && n.content;
    let body: HTMLElement | null = n.body ? el("div", { class: "notif-body" }, n.body) : null;
    if (custom) {
      body = el("div", { class: "notif-custom" });
      try {
        this.unmountView = n.content!(body);
      } catch (err) {
        log.warn(`contenu de notification en erreur : ${String(err)}`);
      }
    }
    return el(
      "div",
      // Plusieurs boutons (une question à choix) : ils passent sur leur propre ligne.
      {
        // « lines » : un texte sur plusieurs lignes (« Quoi de neuf ») : l'alerte grandit (island.css).
        class: `notif ${big ? "big" : ""} ${(n.actions?.length ?? 0) > 1 ? "many" : ""} ${!custom && n.body?.includes("\n") ? "lines" : ""} ${custom ? "custom" : ""} prio-${n.priority} ${n.tone ? `tone-${n.tone}` : ""} ${n.wide ? "wide" : ""}`,
        // Combien attendent derrière (design Studio : l'icône s'empile, voir island.css).
        "data-more": String(Math.min(this.notifications.waiting(), 3)),
      },
      el("span", { class: "notif-icon" }, icon(n.icon ?? "•")),
      el("div", { class: "notif-text" }, el("div", { class: "notif-title" }, n.title), body),
      actions,
    );
  }
}
