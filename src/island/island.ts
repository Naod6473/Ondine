// L'île : relie la machine à états, la file de notifications, les modules, la
// mascotte et la fenêtre Tauri, et dessine le tout.
//
// Qui fait quoi :
//   island-state.ts   décide de l'état (hidden, peek, compact, expanded, drop, alert)
//   island.ts (ici)   dessine l'état, écoute la souris, le clavier, le glisser-déposer
//   Rust (island/)    place la fenêtre, gère les clics traversants, lit la souris

import { Bridge, IS_TAURI, onDragDrop, onTauriEvent, type DragDropEvent } from "../core/bridge";
import type { Bus } from "../core/bus";
import { logger } from "../core/log";
import type { ModuleRegistry } from "../core/module-registry";
import { isAlert, type IslandNotification, type NotificationQueue } from "../core/notifications";
import { settingsStore } from "../core/settings-store";
import type { Settings } from "../core/types";
import { findMascot } from "../mascot/catalog";
import { MascotController } from "../mascot/mascot-state";
import { createRenderer } from "../mascot/renderer";
import { clear, el } from "./dom";
import { IslandStateMachine, type IslandState } from "./island-state";

const log = logger("island");

/** Durée des animations CSS de l'île (doit suivre island.css). */
const TRANSITION_MS = 280;
/** Zone tout en haut au centre qui compte comme « survol » même si l'île est minuscule. */
const TOP_ZONE = { w: 240, h: 14 };
/** Survol prolongé de la mascotte → `love`. */
const LONG_HOVER_MS = 2500;

function timingsFrom(s: Settings) {
  return {
    peekToCompactMs: 350,
    peekToHiddenMs: 300,
    compactHideMs: s.island.compactHideSecs * 1000,
    expandedCollapseMs: s.island.expandedCollapseSecs * 1000,
  };
}

export class Island {
  private fsm: IslandStateMachine;
  private shell = el("div", { class: "island", "data-state": "hidden" });
  private mascotSlot = el("div", { class: "mascot-slot", title: "" });
  private content = el("div", { class: "island-content" });
  private mascot: MascotController | null = null;
  private mascotId = "";

  /** Ce qui est affiché dans `content`, pour ne pas tout redessiner sans raison. */
  private renderedKey = "";
  private unmountView: () => void = () => {};
  /** Onglet (id de module) ouvert dans la vue agrandie. */
  private activeTab: string | null = null;
  /** Cible de dépôt sous le curseur pendant un glisser. */
  private dropHover: HTMLElement | null = null;
  private collapseTimer: number | null = null;
  private hoverMascotSince = 0;
  private hoverMascotFired = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly bus: Bus,
    private readonly registry: ModuleRegistry,
    private readonly notifications: NotificationQueue,
  ) {
    this.fsm = new IslandStateMachine(timingsFrom(settingsStore.current));
    this.fsm.onTransition = (from, to) => this.onTransition(from, to);
    this.shell.append(this.mascotSlot, this.content);
    this.root.append(this.shell);

    this.notifications.defaultDurationMs = settingsStore.current.island.notificationSecs * 1000;
    let wasAlert = false;
    this.notifications.onShow = (n) => {
      const alert = isAlert(n);
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
      this.render();
    };

    this.registry.onChange = () => this.render(true);
    settingsStore.onChange((s) => this.applySettings(s));
    this.applySettings(settingsStore.current);
    this.wireInputs();
    this.wireUndo();
    this.render(true);
  }

  // ── Réglages et mascotte ───────────────────────────────────────────────────

  private applySettings(s: Settings) {
    this.fsm.timings = timingsFrom(s);
    this.notifications.defaultDurationMs = s.island.notificationSecs * 1000;
    const wanted = s.mascot.enabled ? s.mascot.id : "";
    if (wanted !== this.mascotId) {
      this.mascot?.destroy();
      this.mascot = null;
      this.mascotId = wanted;
      const entry = wanted ? findMascot(wanted) : null;
      if (entry) {
        const renderer = createRenderer(entry.manifest, entry.assets);
        renderer.mount(this.mascotSlot);
        this.mascot = new MascotController(entry.manifest, renderer, this.bus, {
          boredAfterMs: s.mascot.boredAfterSecs * 1000,
          sleepAfterMs: s.mascot.sleepAfterSecs * 1000,
        });
      }
      this.shell.classList.toggle("no-mascot", !this.mascot);
    }
    if (this.mascot) {
      this.mascot.timings = { boredAfterMs: s.mascot.boredAfterSecs * 1000, sleepAfterMs: s.mascot.sleepAfterSecs * 1000 };
    }
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  private onTransition(from: IslandState, to: IslandState) {
    log.debug(`${from} → ${to}`);
    this.bus.emit("island.state", { from, to });

    if (this.collapseTimer != null) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (from === "hidden") {
      // On agrandit d'abord la fenêtre, puis l'île s'anime dedans.
      void Bridge.islandSetCollapsed(false);
    }
    if (to === "hidden") {
      // On laisse l'animation de fermeture se finir avant de réduire la fenêtre.
      this.collapseTimer = window.setTimeout(() => void Bridge.islandSetCollapsed(true), TRANSITION_MS);
    }
    // Focus clavier uniquement dans la vue agrandie (ouverte par un clic) : Échap
    // fonctionne, et on rend le focus à l'appli d'avant en sortant.
    if (to === "expanded") void Bridge.islandSetFocus(true);
    if (from === "expanded") void Bridge.islandSetFocus(false);
    if (to !== "hidden") this.mascot?.activity();
    this.render();
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
    // Île cachée : la fenêtre n'est qu'une bande de 6 px, la souris qui y entre la réveille.
    if (IS_TAURI) {
      document.addEventListener("mouseenter", () => this.fsm.state === "hidden" && this.fsm.pointerEnter());
      document.addEventListener("mousemove", () => this.fsm.state === "hidden" && this.fsm.pointerEnter());
      document.addEventListener("mouseleave", () => this.fsm.state === "hidden" && this.fsm.pointerLeave());
    }

    this.shell.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      this.fsm.click();
    });
    this.mascotSlot.addEventListener("click", (e) => {
      e.stopPropagation();
      this.bus.emit("mascot.clicked");
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.fsm.escape() === "dismiss-alert") this.notifications.dismissCurrent();
    });

    void onDragDrop((e) => this.onDrag(e));
    void onTauriEvent<string>("tray", (id) => id === "open" && this.fsm.open());
    void onTauriEvent("screen-changed", () => void Bridge.islandReposition());

    // La forme de l'île change (animation, contenu) : le Rust doit la connaître
    // pour décider où les clics passent au travers.
    new ResizeObserver(() => this.pushRect()).observe(this.shell);
    this.shell.addEventListener("transitionend", () => this.pushRect());
  }

  private pushRect() {
    const r = this.shell.getBoundingClientRect();
    void Bridge.islandSetRect(r.left, r.top, r.width, r.height);
  }

  /** Position de la souris (px logiques de la fenêtre). */
  private pointer(x: number, y: number) {
    // Dans l'appli, l'île cachée est gérée par la bande de réveil (ci-dessus).
    if (this.fsm.state === "hidden" && IS_TAURI) return;
    const r = this.shell.getBoundingClientRect();
    const margin = 8;
    const inIsland = x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
    const zoneLeft = (window.innerWidth - TOP_ZONE.w) / 2;
    const inTopZone = x >= zoneLeft && x <= zoneLeft + TOP_ZONE.w && y >= 0 && y <= TOP_ZONE.h;
    const inside = inIsland || inTopZone;
    if (inside) this.fsm.pointerEnter();
    else this.fsm.pointerLeave();

    if (!this.mascot) return;
    const m = this.mascotSlot.getBoundingClientRect();
    this.mascot.lookAt(x - (m.left + m.width / 2), y - (m.top + m.height / 2));
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
        this.bus.emit("island.files-dropped", { count: paths.length, target: target?.target.id ?? null });
        if (target) void this.registry.drop(target.moduleId, target.target, paths);
        else if (paths.length) {
          this.notifications.push({ moduleId: "island", title: "Lâche le fichier sur une cible", icon: "🎯", priority: "low" });
        }
        break;
      }
    }
  }

  /** La cible sous ce point. La position de Tauri est en pixels physiques (à vérifier sur ta machine). */
  private dropTargetAt(pos: { x: number; y: number } | undefined) {
    const targets = this.registry.dropTargets();
    if (targets.length === 1) return targets[0];
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
    const tabs = this.registry.withView("expanded");
    if (!tabs.some((t) => t.module.manifest.id === this.activeTab)) this.activeTab = tabs[0]?.module.manifest.id ?? null;

    const key = [state, state === "expanded" ? this.activeTab : "", state === "compact" || state === "alert" ? n?.id : ""].join("|");
    if (key === this.renderedKey && !force) {
      this.renderBanner(n);
      return;
    }
    this.renderedKey = key;
    this.unmountView();
    this.unmountView = () => {};
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
  }

  private renderCompact(n: IslandNotification | null) {
    if (n && !isAlert(n)) {
      this.content.append(this.notificationCard(n, false));
      return;
    }
    const first = this.registry.withView("compact")[0];
    if (!first) {
      this.content.append(el("span", { class: "muted" }, "Island"));
      return;
    }
    const slot = el("div", { class: "view view-compact" });
    this.content.append(slot);
    this.unmountView = this.registry.mountView(first.module.manifest.id, "compact", slot);
  }

  private renderExpanded() {
    const tabs = this.registry.withView("expanded");
    const header = el("div", { class: "tabs" });
    for (const t of tabs) {
      const m = t.module.manifest;
      header.append(
        el(
          "button",
          {
            class: `tab ${m.id === this.activeTab ? "active" : ""}`,
            onclick: () => {
              this.activeTab = m.id;
              this.render(true);
            },
          },
          `${m.icon} ${m.name}`,
        ),
      );
    }
    header.append(
      el("span", { class: "spacer" }),
      el("button", { class: "icon-btn", title: "Réglages", onclick: () => void Bridge.openSettingsWindow() }, "⚙"),
      el("button", { class: "icon-btn", title: "Réduire (Échap pour fermer)", onclick: () => this.fsm.shrink() }, "▴"),
    );
    const banner = el("div", { class: "banner-slot" });
    const body = el("div", { class: "view view-expanded" });
    this.content.append(header, banner, body);
    if (this.activeTab) this.unmountView = this.registry.mountView(this.activeTab, "expanded", body);
    else body.append(el("p", { class: "muted" }, "Aucun module actif. Active-en un dans les réglages."));
  }

  private renderDrop() {
    const targets = this.registry.dropTargets();
    const row = el("div", { class: "drop-row" });
    targets.forEach(({ target }, i) => {
      row.append(
        el("div", { class: "drop-target", "data-drop-index": i }, el("span", { class: "drop-icon" }, target.icon), el("span", {}, target.label)),
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
    return el(
      "div",
      { class: `notif ${big ? "big" : ""} prio-${n.priority}` },
      el("span", { class: "notif-icon" }, n.icon ?? "•"),
      el("div", { class: "notif-text" }, el("div", { class: "notif-title" }, n.title), n.body ? el("div", { class: "notif-body" }, n.body) : null),
      actions,
    );
  }
}
