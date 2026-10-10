// Ondine sur le bureau : la fenêtre « pet » (src-tauri/src/pet.rs).
//
// Seulement la mascotte, posée où on veut sur le bureau. On l'attrape pour la
// déplacer (la fenêtre suit la souris côté Rust, la bulle avec elle) ; un clic
// ouvre à côté d'elle une bulle avec quelques onglets de l'île, choisis dans
// Réglages → Mascotte (`mascot.petTabs`, par défaut Parler à Ondine, Lanceur,
// Agents IA).
//
// La bulle montre ses onglets en icônes seules (le nom en infobulle) et prend
// la taille de son contenu, en largeur et en hauteur (bubble-size.ts), avec
// la même glisse amortie que l'île qui suit son contenu (jelly.ts, GLIDE) ;
// la fenêtre (pet.rs) s'agrandit avant que la bulle grandisse et ne se
// resserre qu'une fois la bulle posée.
//
// Les onglets sont les vues des modules de l'île, montées par un second
// registre en mode « satellite » : le travail de fond (notifications,
// surveillance) reste dans l'île, cette fenêtre ne fait qu'afficher. Les
// conversations et listes vivent dans le Rust, donc les deux fenêtres montrent
// la même chose.
//
// La mascotte écoute le même bus que celle de l'île : humeurs, danse quand la
// musique joue, fête quand une tâche finit, tout se joue aussi ici.
//
// Aussi : un fichier lâché sur elle propose les cibles de dépôt de l'île dans
// sa bulle ; une notification de l'île met une pastille sur elle ; le
// raccourci `mascot.petHotkey` ouvre sa bulle ; elle marche quand le Rust la
// promène (« pet-walk »).

import { Bridge, IS_TAURI, onDragDrop, onTauriEvent, windowLabel, type DragDropEvent, type PetLayout } from "../core/bridge";
import { Bus } from "../core/bus";
import { hidesRealData } from "../core/demo";
import { startI18n } from "../core/i18n";
import { errorText, logger } from "../core/log";
import { ModuleRegistry } from "../core/module-registry";
import { NotificationQueue, type IslandNotification } from "../core/notifications";
import { startPerf } from "../core/perf";
import { startScrollbars } from "../island/scrollbars";
import { settingsStore } from "../core/settings-store";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import { settle } from "../island/fit";
import { icon } from "../island/icon";
import { GLIDE } from "../island/jelly";
import { springAtRest, stepSpring, type Spring } from "../island/spring";
import { reducedMotion } from "../island/tab-pill";
import { applyTheme } from "../island/themes";
import { findMascot } from "../mascot/catalog";
import { MascotController } from "../mascot/mascot-state";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { ALL_MODULES } from "../modules";
import { BUBBLE_MAX_H, BUBBLE_MAX_W, clampBubble, roomFor, sameSize, type Size } from "./bubble-size";

const log = logger("pet");

/** La case de la mascotte (px), comme PET_BOX dans pet.rs. */
const PET_BOX = 112;
/** Bouger de plus que ça, bouton enfoncé : on la déplace (sinon c'est un clic). */
const DRAG_PX = 4;
/** Survol prolongé : elle fait les yeux doux (« mascot.hover-long », comme dans l'île). */
const LONG_HOVER_MS = 2500;

window.addEventListener("error", (e) => log.error(`erreur non rattrapée : ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log.error(`promesse rejetée : ${errorText(e.reason)}`));

/** Ondine est sur le bureau d'après ces réglages. */
function petOn(s: Settings): boolean {
  return s.mascot.enabled && !!s.mascot.pet;
}

class Pet {
  private layout: PetLayout = { open: false, right: true, up: true };
  private readonly box = el("div", { class: "pet" });
  private readonly slot = el("div", { class: "pet-slot", title: "Ondine" });
  private readonly bubble = el("section", { class: "pet-bubble", "aria-label": "Ondine" });
  private readonly toast = el("div", { class: "pet-toast", role: "status" });
  /** La pastille d'une notification de l'île (un clic ouvre l'île). */
  private readonly badge = el("button", { class: "pet-badge", hidden: true, title: "Voir dans l'île", "aria-label": "Voir dans l'île" });
  private badgeTimer = 0;
  private mascot: MascotController | null = null;
  private renderer: MascotRenderer | null = null;
  private mascotId = "";
  private activeTab = "";
  private unmount: () => void = () => {};
  private shownTabs = "";
  private press: { x: number; y: number; dragging: boolean } | null = null;
  private hoverTimer = 0;
  /** La taille de la bulle : montrée (ressorts), voulue, et la place que la fenêtre lui garde. */
  private readonly sw: Spring = { x: 0, v: 0 };
  private readonly sh: Spring = { x: 0, v: 0 };
  private want: Size | null = null;
  private room: Size | null = null;
  private fitRaf = 0;
  private glideRaf = 0;
  private lastFrame = 0;
  private lastHit = "";

  constructor(
    root: HTMLElement,
    private readonly bus: Bus,
    private readonly registry: ModuleRegistry,
    private readonly notifications: NotificationQueue,
  ) {
    this.box.append(el("div", { class: "pet-mascot" }, this.slot, this.badge), this.bubble);
    root.append(this.box);
    this.wireMascot();

    registry.onChange = () => this.layout.open && this.renderBubble(true);
    registry.onCloseRequest = () => void this.setOpen(false);
    registry.onOpenRequest = (tab) => {
      // Un onglet qui n'est pas dans la bulle : c'est l'île qui l'ouvre.
      if (tab && !this.tabs().includes(tab)) {
        this.bus.emit("island.open", { tab }, "pet");
        return;
      }
      if (tab) this.activeTab = tab;
      if (this.layout.open) this.renderBubble(true);
      else void this.setOpen(true);
    };
    notifications.onShow = (n) => this.showToast(n);

    void onTauriEvent<PetLayout>("pet-layout", (l) => this.applyLayout(l));
    void onTauriEvent("pet-drag-end", () => this.dragEnded());
    // Portée au-dessus de l'île : elle se fait petite, prête à rentrer.
    void onTauriEvent<boolean>("pet-over-island", (over) => this.box.classList.toggle("homing", over));
    void onTauriEvent<{ x: number; y: number }>("pet-cursor", (p) => this.pointer(p.x, p.y));
    void onTauriEvent("pet-hotkey", () => void this.setOpen(!this.layout.open));
    // Elle se promène (pet.rs) : dir = 1 vers la droite, -1 vers la gauche, 0 arrêt.
    void onTauriEvent<number>("pet-walk", (dir) => {
      this.box.classList.toggle("walking", dir !== 0);
      if (dir) this.box.dataset.walk = dir > 0 ? "right" : "left";
    });
    void onDragDrop((e) => this.onDrag(e));
    this.wireBadge();
    this.wireDropChoices();
    if (!IS_TAURI) document.addEventListener("mousemove", (e) => this.pointer(e.clientX, e.clientY));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.layout.open) void this.setOpen(false);
    });
    new ResizeObserver(() => this.pushHit()).observe(this.bubble);
    // Le contenu change (autre onglet, réponse qui s'écrit, liste qui
    // s'allonge, image chargée) : la bulle suit.
    new MutationObserver(() => this.scheduleFit()).observe(this.bubble, { childList: true, subtree: true, characterData: true });
    this.bubble.addEventListener("load", () => this.scheduleFit(), true);
    this.bubble.addEventListener("transitionend", () => this.scheduleFit());

    settingsStore.onChange((s) => this.applySettings(s));
    this.applySettings(settingsStore.current);
  }

  // ── Réglages et mascotte ───────────────────────────────────────────────────

  private applySettings(s: Settings) {
    applyTheme(s.island.theme ?? "nuit", s.island.color ?? "");
    this.box.dataset.mascotSize = s.mascot.size ?? "normal";
    // Hors du bureau, pas de mascotte qui tourne pour rien (la fenêtre est cachée).
    const wanted = petOn(s) ? s.mascot.id : "";
    if (wanted !== this.mascotId) {
      this.mascot?.destroy();
      this.mascot = null;
      this.renderer = null;
      this.mascotId = wanted;
      const entry = wanted ? findMascot(wanted) : null;
      if (entry) {
        const renderer = createRenderer(entry.manifest, entry.assets);
        renderer.mount(this.slot);
        this.renderer = renderer;
        this.mascot = new MascotController(entry.manifest, renderer, this.bus, {
          boredAfterMs: s.mascot.boredAfterSecs * 1000,
          sleepAfterMs: s.mascot.sleepAfterSecs * 1000,
        });
      }
    }
    if (this.mascot) this.mascot.timings = { boredAfterMs: s.mascot.boredAfterSecs * 1000, sleepAfterMs: s.mascot.sleepAfterSecs * 1000 };
    if (!petOn(s)) {
      // Rentrée dans l'île : la bulle se referme (la fenêtre est déjà cachée par le Rust).
      this.unmount();
      this.unmount = () => {};
      this.applyLayout({ open: false, right: true, up: true });
      return;
    }
    // Les onglets choisis ont changé : la bulle ouverte suit.
    if (this.layout.open && this.tabs().join(",") !== this.shownTabs) this.renderBubble(true);
  }

  private wireMascot() {
    this.slot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.press = { x: e.screenX, y: e.screenY, dragging: false };
      this.slot.setPointerCapture(e.pointerId);
      this.react("poke", { x: 0, y: 0 });
    });
    this.slot.addEventListener("pointermove", (e) => {
      const p = this.press;
      if (!p || p.dragging || !e.buttons) return;
      if (Math.hypot(e.screenX - p.x, e.screenY - p.y) < DRAG_PX) return;
      p.dragging = true;
      this.box.classList.add("dragging");
      // On l'attrape : elle s'étonne, et le Rust fait suivre la fenêtre (bulle comprise).
      this.mascot?.request("surprise");
      void Bridge.petDragStart();
    });
    const up = () => {
      const p = this.press;
      this.press = null;
      if (!p) return;
      this.react("release", { amount: p.dragging ? 24 : 6 });
      // Hors de l'appli, pas de Rust pour annoncer la fin du déplacement.
      if (p.dragging) {
        if (!IS_TAURI) this.dragEnded();
        return;
      }
      this.bus.emit("mascot.clicked", null, "pet");
      void this.setOpen(!this.layout.open);
    };
    this.slot.addEventListener("pointerup", up);
    this.slot.addEventListener("pointercancel", () => (this.press = null));
    this.slot.addEventListener("pointerenter", () => {
      this.mascot?.activity();
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => this.bus.emit("mascot.hover-long", null, "pet"), LONG_HOVER_MS);
    });
    this.slot.addEventListener("pointerleave", () => window.clearTimeout(this.hoverTimer));
  }

  // ── Fichiers lâchés sur elle ───────────────────────────────────────────────

  private onDrag(e: DragDropEvent) {
    if (e.type === "enter" || e.type === "over") {
      if (!this.box.classList.contains("drop-over")) this.mascot?.request("surprise");
      this.box.classList.add("drop-over");
    } else if (e.type === "leave") {
      this.box.classList.remove("drop-over");
      this.mascot?.request("idle");
    } else if (e.type === "drop") {
      this.box.classList.remove("drop-over");
      const paths = e.paths ?? [];
      // L'île connaît les cibles : elle répond par « island.drop-choices ».
      if (paths.length) this.bus.emit("pet.files-dropped", { paths }, "pet");
    }
  }

  private wireDropChoices() {
    this.bus.on("island.drop-choices", (msg) => {
      const p = msg.payload as { id: number; count: number; choices: { label: string; icon: string }[] } | null;
      if (!p) return;
      void this.setOpen(true);
      const what = p.count > 1 ? `${p.count} fichiers` : "Un fichier";
      this.notifications.push({
        moduleId: "pet",
        title: p.choices.length ? `${what} pour Ondine : qu'en faire ?` : "Aucune cible de dépôt active",
        icon: "📥",
        priority: "normal",
        sticky: true,
        key: "pet-drop",
        actions: p.choices.map((c, index) => ({ label: `${c.icon} ${c.label}`, run: () => this.bus.emit("pet.drop-choice", { id: p.id, index }, "pet") })),
      });
    }, "pet");
  }

  // ── La pastille des notifications de l'île ─────────────────────────────────

  private wireBadge() {
    const show = (icon: string, alert: boolean) => {
      // Bulle ouverte : on la voit déjà dans l'île ou dans la bulle.
      this.badge.textContent = icon || "•";
      this.badge.classList.toggle("alert", alert);
      this.badge.hidden = false;
      window.clearTimeout(this.badgeTimer);
      if (!alert) this.badgeTimer = window.setTimeout(() => (this.badge.hidden = true), 10_000);
      this.pushHit();
    };
    this.bus.on("notify.shown", (msg) => {
      const n = msg.payload as { icon?: string } | null;
      show(n?.icon ?? "", false);
    }, "pet");
    this.bus.on("notify.alert", () => show("!", true), "pet");
    this.bus.on("notify.alert-end", () => {
      this.badge.hidden = true;
      this.pushHit();
    }, "pet");
    this.badge.addEventListener("click", (e) => {
      e.stopPropagation();
      this.badge.hidden = true;
      this.pushHit();
      this.bus.emit("island.open", {}, "pet");
    });
  }

  private dragEnded() {
    this.box.classList.remove("dragging", "homing");
    this.mascot?.request("idle");
    this.pushHit();
  }

  /** La souris (px de la fenêtre, envoyée par le Rust) : elle la suit des yeux. */
  private pointer(x: number, y: number) {
    if (!this.mascot) return;
    const m = this.slot.getBoundingClientRect();
    this.mascot.lookAt(x - (m.left + m.width / 2), y - (m.top + m.height / 2));
    if (x >= m.left && x <= m.right && y >= m.top && y <= m.bottom) this.mascot.activity();
  }

  private react(kind: "poke" | "release", data: { x?: number; y?: number; amount?: number }) {
    try {
      this.renderer?.react?.(kind, data);
    } catch (err) {
      log.warn(`réaction de la mascotte en erreur : ${String(err)}`);
    }
  }

  // ── La bulle ───────────────────────────────────────────────────────────────

  /** Les onglets de la bulle : ceux choisis, actifs, qui ont une vue, dans l'ordre choisi. */
  private tabs(): string[] {
    const withView = new Set(this.registry.withView("expanded").map((r) => r.module.manifest.id));
    return (settingsStore.current.mascot.petTabs ?? []).filter((id) => withView.has(id));
  }

  private async setOpen(open: boolean) {
    if (open === this.layout.open) return;
    let size: Size | undefined;
    if (open) {
      this.renderBubble(true);
      // Mesurée avant de s'ouvrir : la fenêtre prend tout de suite la bonne taille.
      size = this.measure();
      this.snapSize(size);
    }
    const l = (await Bridge.petOpen(open, size)) ?? { open, right: true, up: true };
    this.applyLayout(l);
    if (open) {
      // Bornée à la place que l'écran laisse de ce côté.
      const fitted = this.measure();
      this.snapSize(fitted);
      if (!sameSize(fitted, this.room)) {
        this.room = fitted;
        void Bridge.petBubble(fitted.w, fitted.h);
      }
      this.mascot?.activity();
      // Le champ de l'onglet (Parler à Ondine, Lanceur) prend le clavier.
      requestAnimationFrame(() => this.bubble.querySelector<HTMLElement>(".view-expanded input, .view-expanded textarea")?.focus());
    } else {
      this.unmount();
      this.unmount = () => {};
      this.bubble.replaceChildren();
      this.shownTabs = "";
      this.resetSize();
    }
  }

  /** Le côté de la bulle (décidé par le Rust d'après la place sur l'écran). */
  private applyLayout(l: PetLayout) {
    this.layout = l;
    this.box.dataset.open = String(l.open);
    this.box.dataset.side = l.right ? "right" : "left";
    this.box.dataset.toward = l.up ? "up" : "down";
    this.pushHit();
    // Déplacée (autre côté, autre place) : la bulle se borne à la nouvelle place.
    if (l.open) this.scheduleFit();
    else this.resetSize();
  }

  // ── La taille de la bulle ──────────────────────────────────────────────────

  /** La place que l'écran laisse à la bulle (px logiques). */
  private maxSize(): Size {
    if (this.layout.maxW && this.layout.maxH) return { w: this.layout.maxW, h: this.layout.maxH };
    // Hors de l'appli (navigateur, mode démo) : la page fait office d'écran.
    if (!IS_TAURI) return { w: window.innerWidth - PET_BOX - 8, h: window.innerHeight - 8 };
    return { w: BUBBLE_MAX_W, h: BUBBLE_MAX_H };
  }

  /**
   * La taille que demande le contenu, bornée. Mesurée en enlevant un instant
   * nos styles en ligne (largeur « max-content », puis hauteur pour cette
   * largeur) : rien n'est dessiné entre les deux, et la mesure ne dépend pas
   * de la taille montrée (pas d'aller-retour pendant la glisse).
   */
  private measure(): Size {
    const b = this.bubble;
    const st = b.style;
    const saved = [st.width, st.height, st.display, st.visibility];
    if (getComputedStyle(b).display === "none") {
      st.display = "flex";
      st.visibility = "hidden";
    }
    const max = this.maxSize();
    st.height = "auto";
    st.width = "max-content";
    const w = clampBubble({ w: b.offsetWidth, h: 0 }, max).w;
    st.width = `${w}px`;
    const h = b.offsetHeight;
    [st.width, st.height, st.display, st.visibility] = saved;
    return clampBubble({ w, h }, max);
  }

  private scheduleFit() {
    if (this.fitRaf || !this.layout.open) return;
    this.fitRaf = requestAnimationFrame(() => {
      this.fitRaf = 0;
      void this.fit();
    });
  }

  /** Le contenu a peut-être changé : nouvelle cible, la fenêtre d'abord, puis la glisse. */
  private async fit() {
    if (!this.layout.open || !this.want) return;
    const m = this.measure();
    // Sans va-et-vient : elle grandit tout de suite, ne rétrécit que nettement.
    const next = clampBubble({ w: settle(this.want.w, m.w) ?? m.w, h: settle(this.want.h, m.h) ?? m.h }, this.maxSize());
    if (sameSize(next, this.want)) return;
    this.want = next;
    // La fenêtre doit déjà tenir la bulle pendant tout le trajet.
    const need = roomFor(this.room ?? next, roomFor({ w: this.sw.x, h: this.sh.x }, next));
    if (!sameSize(need, this.room)) {
      this.room = need;
      await Bridge.petBubble(need.w, need.h);
    }
    this.glide();
  }

  /** La bulle va vers sa taille voulue, en ressort amorti (sans rebond). */
  private glide() {
    if (this.glideRaf) return;
    if (reducedMotion() || settingsStore.current.mascot.calm) {
      if (this.want) this.snapSize(this.want);
      this.settled();
      return;
    }
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      const want = this.want;
      if (!want) {
        this.glideRaf = 0;
        return;
      }
      const dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      stepSpring(this.sw, want.w, GLIDE, dt);
      stepSpring(this.sh, want.h, GLIDE, dt);
      if (springAtRest(this.sw, want.w) && springAtRest(this.sh, want.h)) {
        this.glideRaf = 0;
        this.snapSize(want);
        this.settled();
        return;
      }
      this.paintSize();
      this.glideRaf = requestAnimationFrame(frame);
    };
    this.glideRaf = requestAnimationFrame(frame);
  }

  /** Posée : la fenêtre se resserre autour d'elle. */
  private settled() {
    const want = this.want;
    if (!want || !this.layout.open || sameSize(want, this.room)) return;
    this.room = want;
    void Bridge.petBubble(want.w, want.h);
  }

  /** Cette taille tout de suite, sans animation. */
  private snapSize(size: Size) {
    cancelAnimationFrame(this.glideRaf);
    this.glideRaf = 0;
    this.want = size;
    this.sw.x = size.w;
    this.sh.x = size.h;
    this.sw.v = this.sh.v = 0;
    this.room ??= size;
    this.paintSize();
  }

  private paintSize() {
    this.bubble.style.width = `${Math.round(this.sw.x)}px`;
    this.bubble.style.height = `${Math.round(this.sh.x)}px`;
  }

  private resetSize() {
    cancelAnimationFrame(this.glideRaf);
    cancelAnimationFrame(this.fitRaf);
    this.glideRaf = this.fitRaf = 0;
    this.want = this.room = null;
    this.bubble.style.removeProperty("width");
    this.bubble.style.removeProperty("height");
  }

  private renderBubble(force = false) {
    const tabs = this.tabs();
    if (!force && tabs.join(",") === this.shownTabs) return;
    this.shownTabs = tabs.join(",");
    if (!tabs.includes(this.activeTab)) this.activeTab = tabs[0] ?? "";
    this.unmount();
    this.unmount = () => {};

    // Des icônes seules : le nom de chaque onglet est dans son infobulle (et lu
    // par les lecteurs d'écran).
    const header = el("div", { class: "tabs icons-only", role: "tablist", "aria-label": "Modules" });
    for (const id of tabs) {
      const m = this.registry.withView("expanded").find((r) => r.module.manifest.id === id)?.module.manifest;
      if (!m) continue;
      header.append(
        el(
          "button",
          {
            class: `tab ${id === this.activeTab ? "active" : ""}`,
            role: "tab",
            "aria-selected": String(id === this.activeTab),
            title: m.name,
            "aria-label": m.name,
            onclick: () => {
              if (this.activeTab === id) return;
              this.activeTab = id;
              this.renderBubble(true);
            },
          },
          el("span", { class: "tab-icon", "aria-hidden": "true" }, icon(m.icon)),
        ),
      );
    }
    header.append(
      el("span", { class: "spacer" }),
      el("button", { class: "icon-btn", title: "Ramener Ondine dans l'île", "aria-label": "Ramener Ondine dans l'île", onclick: () => void Bridge.petBack() }, "⤒"),
      el("button", { class: "icon-btn", title: "Réglages", "aria-label": "Réglages", onclick: () => void Bridge.openSettingsWindow() }, "⚙"),
      el("button", { class: "icon-btn", title: "Fermer (Échap)", "aria-label": "Fermer", onclick: () => void this.setOpen(false) }, "✕"),
    );
    const body = el("div", { class: "view view-expanded" });
    if (!tabs.length) {
      body.append(el("p", { class: "muted pet-empty" }, "Aucun onglet choisi : Réglages → Mascotte → Ondine sur le bureau."));
    } else {
      this.unmount = this.registry.mountView(this.activeTab, "expanded", body);
    }
    this.bubble.replaceChildren(header, this.toast, body);
    this.showToast(this.notifications.current());
  }

  /** Une notification d'un onglet (« Copié »…) : une ligne en haut de la bulle. */
  private showToast(n: IslandNotification | null) {
    this.toast.replaceChildren();
    this.toast.hidden = !n;
    if (!n) return;
    this.toast.append(el("span", { class: "pet-toast-text" }, [n.icon, n.title, n.body].filter(Boolean).join(" ")));
    for (const a of n.actions ?? []) {
      this.toast.append(
        el("button", {
          class: "btn",
          onclick: () => {
            this.notifications.dismiss(n.id);
            void Promise.resolve(a.run()).catch((err) => log.warn(errorText(err)));
          },
        }, a.label),
      );
    }
  }

  /** Dit au Rust où sont la mascotte et la bulle : ailleurs, les clics passent au travers. */
  private pushHit() {
    const rects = [this.slot.parentElement!, ...(this.layout.open ? [this.bubble] : []), ...(this.badge.hidden ? [] : [this.badge])].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
    // Pendant la glisse, la bulle change à chaque image : on n'envoie que le nouveau.
    const key = JSON.stringify(rects);
    if (key === this.lastHit) return;
    this.lastHit = key;
    void Bridge.petSetHit(rects);
  }
}

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);
  await startI18n();
  await startPerf();
  // Barres de défilement discrètes (island.css, scrollbars.ts).
  startScrollbars();

  const bus = new Bus(windowLabel("pet"));
  bus.accept = (msg) => !hidesRealData(msg);
  await bus.connect();

  const notifications = new NotificationQueue();
  notifications.defaultDurationMs = 3000;
  const registry = new ModuleRegistry(ALL_MODULES, bus, notifications, {
    satellite: true,
    // Seulement les onglets de la bulle, et seulement quand Ondine est sur le bureau.
    only: () => (petOn(settingsStore.current) ? (settingsStore.current.mascot.petTabs ?? []) : []),
  });
  new Pet(document.getElementById("root")!, bus, registry, notifications);
  registry.sync();
  log.info(`Ondine sur le bureau prête (case ${PET_BOX} px)`);
}

void start();
