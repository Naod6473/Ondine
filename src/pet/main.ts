// Ondine sur le bureau : la fenêtre « pet » (src-tauri/src/pet.rs).
//
// Seulement la mascotte, posée où on veut sur le bureau. On l'attrape pour la
// déplacer (la fenêtre suit la souris côté Rust, la bulle avec elle) ; un clic
// ouvre à côté d'elle une bulle avec quelques onglets de l'île, choisis dans
// Réglages → Mascotte (`mascot.petTabs`, par défaut Parler à Ondine, Lanceur,
// Agents IA).
//
// Les onglets sont les vues des modules de l'île, montées par un second
// registre en mode « satellite » : le travail de fond (notifications,
// surveillance) reste dans l'île, cette fenêtre ne fait qu'afficher. Les
// conversations et listes vivent dans le Rust, donc les deux fenêtres montrent
// la même chose.
//
// La mascotte écoute le même bus que celle de l'île : humeurs, danse quand la
// musique joue, fête quand une tâche finit, tout se joue aussi ici.

import { Bridge, IS_TAURI, onTauriEvent, windowLabel, type PetLayout } from "../core/bridge";
import { Bus } from "../core/bus";
import { hidesRealData } from "../core/demo";
import { startI18n } from "../core/i18n";
import { errorText, logger } from "../core/log";
import { ModuleRegistry } from "../core/module-registry";
import { NotificationQueue, type IslandNotification } from "../core/notifications";
import { startPerf } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import { icon } from "../island/icon";
import { applyTheme } from "../island/themes";
import { findMascot } from "../mascot/catalog";
import { MascotController } from "../mascot/mascot-state";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { ALL_MODULES } from "../modules";

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
  private mascot: MascotController | null = null;
  private renderer: MascotRenderer | null = null;
  private mascotId = "";
  private activeTab = "";
  private unmount: () => void = () => {};
  private shownTabs = "";
  private press: { x: number; y: number; dragging: boolean } | null = null;
  private hoverTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly bus: Bus,
    private readonly registry: ModuleRegistry,
    private readonly notifications: NotificationQueue,
  ) {
    this.box.append(el("div", { class: "pet-mascot" }, this.slot), this.bubble);
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
    void onTauriEvent<{ x: number; y: number }>("pet-cursor", (p) => this.pointer(p.x, p.y));
    if (!IS_TAURI) document.addEventListener("mousemove", (e) => this.pointer(e.clientX, e.clientY));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.layout.open) void this.setOpen(false);
    });
    new ResizeObserver(() => this.pushHit()).observe(this.bubble);

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

  private dragEnded() {
    this.box.classList.remove("dragging");
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
    if (open) this.renderBubble(true);
    const l = (await Bridge.petOpen(open)) ?? { open, right: true, up: true };
    this.applyLayout(l);
    if (open) {
      this.mascot?.activity();
      // Le champ de l'onglet (Parler à Ondine, Lanceur) prend le clavier.
      requestAnimationFrame(() => this.bubble.querySelector<HTMLElement>(".view-expanded input, .view-expanded textarea")?.focus());
    } else {
      this.unmount();
      this.unmount = () => {};
      this.bubble.replaceChildren();
      this.shownTabs = "";
    }
  }

  /** Le côté de la bulle (décidé par le Rust d'après la place sur l'écran). */
  private applyLayout(l: PetLayout) {
    this.layout = l;
    this.box.dataset.open = String(l.open);
    this.box.dataset.side = l.right ? "right" : "left";
    this.box.dataset.toward = l.up ? "up" : "down";
    this.pushHit();
  }

  private renderBubble(force = false) {
    const tabs = this.tabs();
    if (!force && tabs.join(",") === this.shownTabs) return;
    this.shownTabs = tabs.join(",");
    if (!tabs.includes(this.activeTab)) this.activeTab = tabs[0] ?? "";
    this.unmount();
    this.unmount = () => {};

    const header = el("div", { class: "tabs", role: "tablist", "aria-label": "Modules" });
    // La bulle est étroite : au-delà de deux onglets, seul l'actif garde son nom.
    if (tabs.length > 2) header.classList.add("icons-only");
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
            onclick: () => {
              if (this.activeTab === id) return;
              this.activeTab = id;
              this.renderBubble(true);
            },
          },
          el("span", { class: "tab-icon", "aria-hidden": "true" }, icon(m.icon)),
          el("span", { class: "tab-label" }, m.name),
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
    const rects = [this.slot.parentElement!, ...(this.layout.open ? [this.bubble] : [])].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    void Bridge.petSetHit(rects);
  }
}

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);
  await startI18n();
  await startPerf();

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
