// L'île : relie la machine à états, la file de notifications, les modules, la
// mascotte et la fenêtre Tauri, et dessine le tout.
//
// Qui fait quoi :
//   island-state.ts   décide de l'état (hidden, peek, compact, expanded, drop, alert)
//   island.ts (ici)   dessine l'état, écoute la souris, le clavier, le glisser-déposer
//   Rust (island/)    place la fenêtre, gère les clics traversants, lit la souris

import { jellyButtons, motionOn, popIn, setStudio, spotlight, staggerIn, tabOut, watchContent } from "./motion";
import { Bridge, IS_TAURI, onDragDrop, onTauriEvent, type DragDropEvent } from "../core/bridge";
import type { Bus } from "../core/bus";
import { logger } from "../core/log";
import { onPerfChange, pacedInterval, perfMode } from "../core/perf";
import type { ModuleRegistry } from "../core/module-registry";
import { isAlert, type IslandNotification, type NotificationQueue } from "../core/notifications";
import { settingsStore } from "../core/settings-store";
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
import { IslandStateMachine, type IslandState } from "./island-state";
import { contentHeight, FIT_ATTR, FIT_MAX_W, FIT_MAX_W_SIDE, FIT_W_ATTR, fitHeight, fitMode, fitWidth, naturalWidth, settle } from "./fit";
import { enableGestures, grabZone, horizontal, type Edge } from "./gestures";
import { Jelly } from "./jelly";
import { elasticityOf } from "./spring";
import { sounds, setSoundPrefs } from "./sounds";
import { enableTabDrag, flip } from "./tab-drag";
import { applyTheme } from "./themes";
import { reducedMotion, TabPill } from "./tab-pill";
import { Tips } from "./tips";

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
/** Zone au bord de l'écran qui compte comme « survol » même si l'île est minuscule. */
const EDGE_ZONE = { len: 240, depth: 14 };
/** L'île qui s'écarte d'une fenêtre : la peur d'Ondine au plus toutes les… (ms). */
const FRIGHT_EVERY_MS = 4000;
/** Survol prolongé de la mascotte → `love`. */
const LONG_HOVER_MS = 2500;

/** Ondine vit sur le bureau (src/pet/) : elle n'est plus dans l'île. */
function petOn(s: Settings): boolean {
  return s.mascot.enabled && !!s.mascot.pet;
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
  private content = el("div", { class: "island-content" });
  /** Le petit point orange (micro) ou vert (caméra) quand une appli s'en sert. */
  private privacyDot = el("span", { class: "privacy-dot", "aria-hidden": "true" });
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
  /** La vue agrandie affichée : ses onglets, leur pastille et la zone du contenu. */
  private expandedUi: { tabs: Map<string, HTMLElement>; pill: TabPill; stage: HTMLElement; body: HTMLElement } | null = null;
  /** Dernier état dessiné, pour animer l'arrivée du contenu quand il change. */
  private renderedState: IslandState | null = null;
  /** Cible de dépôt sous le curseur pendant un glisser. */
  private dropHover: HTMLElement | null = null;
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
  /** Une présentation ou une appli plein écran est en cours : l'île se fait oublier. */
  private presenting = false;
  /** La place provisoire donnée par le Rust quand l'île s'écarte d'une fenêtre
      (island/dodge.rs) : elle remplace le bord et la place réglés. */
  private dodgePlace: { edge: Edge; align: string } | null = null;
  private lastFright = 0;
  /** Ouverte au clavier (raccourci) : le focus va sur l'onglet actif. */
  private focusTabsOnOpen = false;
  /** Les surprises cachées (src/eggs/). */
  private eggs: EasterEggs;
  /** La bulle d'astuce à la première ouverture d'un onglet (tips.ts). */
  private tips = new Tips();

  constructor(
    private readonly root: HTMLElement,
    private readonly bus: Bus,
    private readonly registry: ModuleRegistry,
    private readonly notifications: NotificationQueue,
  ) {
    this.fsm = new IslandStateMachine(timingsFrom(settingsStore.current));
    this.fsm.onTransition = (from, to) => this.onTransition(from, to);
    this.shell.append(this.mascotSlot, this.content, this.privacyDot);
    this.root.append(this.shell);
    this.jelly = new Jelly(this.shell, {
      edge: () => this.edge(),
      align: () => document.body.dataset.align ?? "center",
      state: () => this.fsm.state,
      // La forme est posée (fin de l'ancienne « transitionend ») : le Rust
      // reçoit le rectangle final, échelle comprise, pour les clics traversants.
      onSettle: () => this.pushRect(),
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
    pacedInterval(() => void this.maybePeek(), "peekCheck");
    pacedInterval(() => void this.checkPresentation(), "presentationCheck");
    // Économie d'énergie : pas d'effets « Studio » (flous coûteux), ils reviennent ensuite.
    onPerfChange(() => setStudio(settingsStore.current.island.motion === "studio" && perfMode() !== "eco"));
    // Dans un navigateur (npm run dev) : window.ondinePeek() la fait venir tout de suite.
    // Et window.ondineBus.emit("controls.media-use", { mic: ["Zoom"], cam: [] }) simule un message.
    // window.ondineNotify({ moduleId: "island", title: "Test", priority: "high" }) : une alerte (le choc de jelly.ts).
    if (!IS_TAURI) {
      Object.assign(window, {
        ondinePeek: () => this.hanger.show(),
        ondineBus: this.bus,
        ondineEggs: this.eggs,
        ondineNotify: (n: Parameters<NotificationQueue["push"]>[0]) => this.notifications.push(n),
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
      // un creux puis une onde (jelly.ts), après render() qui a lu sa nouvelle taille,
      // et fait un petit saut (une notification normale en mini-île, un plus petit).
      if (alert && isNew) {
        this.jelly.shock();
        this.hop(1);
      } else if (n && isNew && this.fsm.state === "compact") this.hop(0.5);
    };

    this.registry.onChange = () => this.render(true);
    // Sans `force` : on ne redessine que si le module affiché en compact change.
    this.registry.onCompactChange = () => this.render();
    this.registry.onCloseRequest = () => this.fsm.close();
    this.registry.onOpenRequest = (tab) => {
      if (tab && this.orderedTabs().some((t) => t.module.manifest.id === tab)) this.activeTab = tab;
      this.fsm.open();
      this.render(true);
    };
    settingsStore.onChange((s) => this.applySettings(s));
    this.applySettings(settingsStore.current);
    this.wireInputs();
    this.wireUndo();
    // Design « Studio » : chiffres qui roulent, listes qui glissent, boutons en
    // gélatine, reflet sous la souris (rien de tout ça en Classique).
    watchContent(this.content);
    jellyButtons(this.content);
    spotlight(this.shell);
    this.wirePrivacy();
    this.wireFocus();
    // On porte Ondine (sur le bureau) au-dessus de l'île : elle se montre pour l'accueillir.
    void onTauriEvent<boolean>("pet-over-island", (over) => (over ? this.fsm.pointerEnter() : this.fsm.pointerLeave()));
    // Des fichiers lâchés sur Ondine (sur le bureau) : l'île connaît les cibles,
    // elle les propose dans la bulle d'Ondine, puis fait le dépôt choisi.
    this.wirePetDrops();
    // La bulle d'Ondine sur le bureau demande un onglet qu'elle n'a pas.
    this.bus.on("island.open", (msg) => this.registry.onOpenRequest((msg.payload as { tab?: string } | null)?.tab));
    // Bouton « Faire venir Ondine » des réglages.
    this.bus.on("mascot.peek-now", () => {
      if (this.fsm.state === "hidden") this.hanger.show();
    });
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
    applyTheme(s.island.theme ?? "nuit", s.island.color ?? "");
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
    // Le bord ou la place ont peut-être changé : la forme voulue aussi.
    this.jelly.retarget();
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
    if (from === "hidden") {
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
    // Petits sons : une bulle qui monte à l'ouverture, qui redescend à la fermeture.
    if (to === "expanded") sounds.open();
    else if (from === "expanded") sounds.close();
    this.render();
    if (to === "hidden") {
      // On laisse l'animation de fermeture se finir avant de réduire la
      // fenêtre : quand les ressorts sont posés (render() vient de leur donner
      // la nouvelle forme), ou au plus tard après SETTLE_FALLBACK_MS.
      const collapse = () => {
        if (token !== this.collapseToken || this.fsm.state !== "hidden") return;
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
    void onTauriEvent("wake-enter", () => this.fsm.state === "hidden" && !this.presenting && this.fsm.pointerEnter());
    void onTauriEvent("wake-leave", () => this.fsm.state === "hidden" && this.fsm.pointerLeave());

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
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
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
    void onTauriEvent<{ edge: Edge; align: string; phase: "flee" | "cornered" | "home" }>("island-placement", (p) => this.onDodge(p));
    // Mode démo (scène « L'île s'écarte », core/demo.ts).
    this.bus.on("island.dodge-demo", (msg) => this.onDodge(msg.payload as { edge: Edge; align: string; phase: "flee" | "cornered" | "home" }));
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
    new MutationObserver(() => this.scheduleFit()).observe(this.content, { childList: true, subtree: true, characterData: true });
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
    slot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.mascot || !["compact", "expanded"].includes(this.fsm.state)) return;
      // La mascotte n'étire pas l'île et ne la déplace pas : on la prend, elle.
      e.stopPropagation();
      this.carried = false;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      slot.setPointerCapture(e.pointerId);
      this.react("poke", { x: 0, y: 0 });
    });
    slot.addEventListener("pointermove", (e) => {
      if (!start || !e.buttons) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moving && Math.hypot(dx, dy) < 12) return;
      if (!moving) {
        moving = true;
        slot.classList.add("carried");
        this.mascot?.request("surprise");
      }
      last = { x: e.clientX, y: e.clientY };
      slot.style.translate = `${dx}px ${dy}px`;
      slot.classList.toggle("leaving", outside(e.clientX, e.clientY));
    });
    const end = (e: PointerEvent) => {
      if (!start) return;
      const wasMoving = moving;
      start = null;
      moving = false;
      slot.classList.remove("carried", "leaving");
      slot.style.translate = "";
      if (!wasMoving) return;
      this.carried = true;
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
    const target = settle(this.fitH, wantH);
    const width = settle(this.fitW, wantW);
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
   * Un petit saut de l'île (une alerte qui arrive, une notification en
   * mini-île) : elle décolle du bord puis se repose, avec un rebond. `amount`
   * module la hauteur (1 = une alerte). Pas avec « Réduire les animations »
   * ni en économie d'énergie ; la propriété `translate` ne gêne pas les
   * transformations de la gelée (jelly.ts).
   */
  private hop(amount: number) {
    if (reducedMotion() || perfMode() === "eco" || !motionOn()) return;
    const edge = this.edge();
    const px = Math.round(7 * amount);
    // Vers le centre de l'écran (« away »), puis un petit dépassement de l'autre côté.
    const dir = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] }[edge];
    const at = (k: number) => `${Math.round(dir[0] * k)}px ${Math.round(dir[1] * k)}px`;
    const away = at(px);
    const back = at(-px * 0.35);
    this.shell.animate(
      [
        { translate: "0 0", offset: 0 },
        { translate: away, offset: 0.3, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        { translate: back, offset: 0.7, easing: "ease-in-out" },
        { translate: "0 0", offset: 1 },
      ],
      { duration: 420, easing: "ease-out" },
    );
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
  private onDodge(p: { edge: Edge; align: string; phase: "flee" | "cornered" | "home" }) {
    const s = settingsStore.current;
    if (p.phase === "home") {
      if (!this.dodgePlace) return;
      this.dodgePlace = null;
      document.body.dataset.edge = s.island.edge ?? "top";
      document.body.dataset.align = s.island.align ?? "center";
      this.bus.emit("mascot.emote", { emotion: "relieved" });
      return;
    }
    const first = !this.dodgePlace;
    this.dodgePlace = { edge: p.edge, align: p.align };
    document.body.dataset.edge = p.edge;
    document.body.dataset.align = p.align;
    const now = Date.now();
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
    if (!s.mascot.enabled || !s.mascot.peek || s.mascot.calm || this.fsm.state !== "hidden" || this.hanger.showing) return;
    if (Date.now() - this.lastPeek < (s.mascot.peekEveryMins ?? 5) * 60_000) return;
    const desk = await Bridge.deskState();
    if (!desk || desk.busy || desk.idleMs < PEEK_IDLE_MS) return;
    if (Math.random() < 0.4) return;
    this.lastPeek = Date.now();
    this.hanger.show();
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

  /** Ondine arrive au bord (la fenêtre doit être assez grande) ou repart. */
  private onHangChange(on: boolean) {
    if (on) sounds.drop();
    if (this.fsm.state === "hidden") void Bridge.islandSetCollapsed(!on);
    requestAnimationFrame(() => this.pushRect());
  }

  private pushRect() {
    // Île cachée et Ondine au bord : seul son petit rectangle prend la souris.
    const hang = this.fsm.state === "hidden" ? this.hanger.rect() : null;
    if (hang) {
      void Bridge.islandSetRect(hang.left, hang.top, hang.width, hang.height);
      return;
    }
    const r = this.shell.getBoundingClientRect();
    void Bridge.islandSetRect(r.left, r.top, r.width, r.height);
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
    // Présentation en cours : la souris au bord ne réveille pas l'île.
    if (this.presenting && this.fsm.state === "hidden") return;
    // Dans l'appli, l'île cachée est gérée par la bande de réveil (ci-dessus).
    if (this.fsm.state === "hidden" && IS_TAURI && !this.hanger.showing) return;
    const r = this.shell.getBoundingClientRect();
    const margin = 8;
    const inIsland = x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
    const inside = inIsland || this.inEdgeZone(x, y);
    if (inside) this.fsm.pointerEnter();
    else this.fsm.pointerLeave();
    // Mini-île survolée : elle gonfle un peu et penche vers la souris.
    this.jelly.pointer(x, y);

    if (!this.mascot) return;
    const m = this.mascotSlot.getBoundingClientRect();
    this.mascot.lookAt(x - (m.left + m.width / 2), y - (m.top + m.height / 2));
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
    switch (e.type) {
      case "enter":
        this.fsm.dragEnter();
        break;
      case "over":
        this.highlightDropTarget(e.position);
        break;
      case "leave":
        this.highlightDropTarget(undefined);
        this.fsm.dragLeave();
        break;
      case "drop": {
        const paths = e.paths ?? [];
        const target = this.dropTargetAt(e.position);
        this.highlightDropTarget(undefined);
        this.fsm.dropped();
        if (paths.length) sounds.drop();
        this.bus.emit("island.files-dropped", { count: paths.length, target: target?.target.id ?? null });
        if (target) void this.registry.drop(target.moduleId, target.target, paths);
        else if (paths.length) {
          this.notifications.push({ moduleId: "island", title: "Lâcher le fichier sur une cible", icon: "🎯", priority: "low" });
        }
        break;
      }
    }
  }

  /**
   * Fichiers lâchés sur Ondine sur le bureau (src/pet/) : les cibles de dépôt
   * des modules vivent ici. On envoie leurs noms à sa bulle (« island.drop-choices »),
   * et le choix revient (« pet.drop-choice ») : le dépôt se fait comme sur l'île.
   */
  private wirePetDrops() {
    let pending: { id: number; paths: string[]; targets: ReturnType<ModuleRegistry["dropTargets"]> } | null = null;
    let nextId = 1;
    this.bus.on("pet.files-dropped", (msg) => {
      const paths = ((msg.payload as { paths?: unknown } | null)?.paths ?? []) as unknown[];
      const clean = paths.filter((p): p is string => typeof p === "string").slice(0, 50);
      if (!clean.length) return;
      const targets = this.registry.dropTargets();
      pending = { id: nextId++, paths: clean, targets };
      this.bus.emit("island.drop-choices", { id: pending.id, count: clean.length, choices: targets.map((t) => ({ label: t.target.label, icon: t.target.icon })) });
    });
    this.bus.on("pet.drop-choice", (msg) => {
      const p = msg.payload as { id?: number; index?: number } | null;
      if (!pending || p?.id !== pending.id || typeof p.index !== "number") return;
      const chosen = pending.targets[p.index];
      const paths = pending.paths;
      pending = null;
      if (!chosen) return;
      sounds.drop();
      this.bus.emit("island.files-dropped", { count: paths.length, target: chosen.target.id });
      void this.registry.drop(chosen.moduleId, chosen.target, paths);
    });
  }

  /** La cible sous ce point. La position de Tauri est en pixels physiques (à vérifier sur ta machine). */
  private dropTargetAt(pos: { x: number; y: number } | undefined) {
    // Même avec une seule cible, il faut lâcher dessus : lâcher ailleurs sur
    // l'île ne doit rien déclencher (la cible pourrait être la Corbeille).
    const targets = this.registry.dropTargets();
    if (!pos) return null;
    const dpr = window.devicePixelRatio || 1;
    const hit = document.elementFromPoint(pos.x / dpr, pos.y / dpr)?.closest<HTMLElement>("[data-drop-index]");
    if (!hit) return null;
    return targets[Number(hit.dataset.dropIndex)] ?? null;
  }

  private highlightDropTarget(pos: { x: number; y: number } | undefined) {
    this.dropHover?.classList.remove("hover");
    this.dropHover = null;
    if (!pos) return;
    const dpr = window.devicePixelRatio || 1;
    const hit = document.elementFromPoint(pos.x / dpr, pos.y / dpr)?.closest<HTMLElement>("[data-drop-index]");
    if (hit) {
      hit.classList.add("hover");
      this.dropHover = hit;
    }
  }

  /** « Annuler » : le service d'annulation (Rust) propose, l'île affiche. */
  private wireUndo() {
    this.bus.on("undo.offered", (msg) => {
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
    const targets = this.registry.dropTargets();
    const row = el("div", { class: "drop-row" });
    targets.forEach(({ target }, i) => {
      row.append(
        el("div", { class: "drop-target", "data-drop-index": i }, el("span", { class: "drop-icon" }, icon(target.icon)), el("span", {}, target.label)),
      );
    });
    if (!targets.length) row.append(el("span", { class: "muted" }, "Aucune cible de dépôt active."));
    this.content.append(row);
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
