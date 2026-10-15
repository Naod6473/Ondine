// La pilule de la Dictée : la fenêtre « pill » (src-tauri/src/pill.rs).
//
// Les états (modules/dictation.rs envoie « pill-state ») :
//   - repos : une petite barre de verre ; sous la souris, une barre d'outils
//     (Dicter, Enregistrer un appel, Réglages de la dictée) ;
//   - écoute : la goutte gomme concentrée (le vrai moteur des mascottes) et
//     neuf bulles qui suivent les graves (à gauche) et les aigus (à droite)
//     de la voix (« pill-bands », ~30 par seconde) ; un point rouge tant que
//     le micro est ouvert ;
//   - mains libres : Annuler, les bulles, Coller ;
//   - appel en cours (Notes d'appel) : corail, le temps écoulé, Arrêter ;
//   - un message dans une bulle à côté, avec un bouton pour agir.
//
// Au repos, rien ne tourne : la goutte n'est montée que pendant l'écoute, la
// boucle des bulles s'arrête dès qu'elles sont posées, le chronomètre ne
// tourne que pendant un appel. Mouvements réduits : pas de lissage ni de
// rebond, les bulles sautent à leur niveau.
//
// Les clics : la fenêtre laisse passer la souris sauf sur la pilule et le
// message ; la page envoie leurs cases au Rust (`pill_hit`).

import { Bridge, onTauriEvent } from "../core/bridge";
import { startI18n } from "../core/i18n";
import { errorText, logger } from "../core/log";
import { frameLoop, setText, startPerf } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import { el } from "../island/dom";
import { reducedMotion } from "../island/tab-pill";
import { findMascot } from "../mascot/catalog";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import type { AnimationSpec } from "../mascot/types";
import {
  BAND_COUNT,
  IDLE_VIEW,
  bandsAtRest,
  callClock,
  keyLabel,
  messageContent,
  micOpen,
  pillMode,
  smoothBands,
  type PillMode,
  type PillView,
} from "./pill-logic";

const log = logger("pill");

window.addEventListener("error", (e) => log.error(`erreur non rattrapée : ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log.error(`promesse rejetée : ${errorText(e.reason)}`));

/** Mouvements réduits de Windows, ou réglage Calme de la mascotte : rien ne rebondit. */
function still(): boolean {
  return reducedMotion() || settingsStore.current.mascot?.calm === true;
}

const SVG = "http://www.w3.org/2000/svg";

/** Une icône au trait (24 × 24). */
function glyph(d: string, extra?: (svg: SVGSVGElement) => void): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("pill-ico");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  svg.append(path);
  extra?.(svg);
  return svg;
}

const MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3";
const RECORD = "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z";
const GEAR = "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1";
const CROSS = "M6 6l12 12M18 6L6 18";
const CHECK = "M5 12l5 5L20 7";

/** Ouvre les réglages sur une page (la fenêtre lit « settings.goto »). */
function openSettings(page: string) {
  try {
    localStorage.setItem("settings.page", page);
    localStorage.setItem("settings.goto", page);
  } catch {
    // Stockage indisponible : les réglages s'ouvrent sur leur dernière page.
  }
  void Bridge.openSettingsWindow();
}

function action(name: string, extra: Record<string, unknown> = {}) {
  Bridge.moduleInvoke("dictation", "pill_action", { action: name, ...extra }).catch((e) => log.warn(`pilule : ${errorText(e)}`));
}

class Pill {
  private view: PillView = IDLE_VIEW;
  private hover = false;
  private hoverTimer = 0;
  private mode: PillMode | null = null;

  private readonly stage = el("div", { class: "pill-stage" });
  private readonly bar = el("div", { class: "pill", role: "toolbar", "aria-label": "Dictée" });
  private readonly msg = el("div", { class: "pill-msg", role: "status", hidden: true });
  private readonly msgText = el("span", { class: "pill-msg-text" });
  private readonly msgAction = el("button", { class: "pill-msg-btn primary", type: "button" });
  private msgTimer = 0;
  private shownMessage = 0;

  // L'écoute.
  private readonly gumSlot = el("div", { class: "pill-gum", "aria-hidden": "true" });
  private renderer: MascotRenderer | null = null;
  private readonly dots: HTMLElement[] = [];
  private readonly wave = el("div", { class: "pill-wave", "aria-hidden": "true" });
  private readonly redDot = el("span", { class: "pill-red", title: "Micro ouvert" });
  private target: number[] = new Array(BAND_COUNT).fill(0);
  private shown: number[] = new Array(BAND_COUNT).fill(0);
  private stopLoop: (() => void) | null = null;
  private lastFrame = 0;

  // L'appel.
  private readonly clock = el("span", { class: "pill-clock" });
  private clockTimer = 0;

  constructor(root: HTMLElement) {
    for (let i = 0; i < BAND_COUNT; i++) {
      const d = el("span", { class: "pill-dot" });
      this.dots.push(d);
      this.wave.append(d);
    }
    this.msg.append(
      this.msgText,
      el("div", { class: "pill-msg-row" }, el("button", { class: "pill-msg-btn", type: "button", onclick: () => this.closeMessage() }, "Fermer"), this.msgAction),
    );
    this.msgAction.addEventListener("click", () => this.messageAction());
    this.bar.addEventListener("pointerenter", () => this.setHover(true));
    this.bar.addEventListener("pointerleave", () => this.setHover(false));
    this.stage.append(this.msg, this.bar);
    root.append(this.stage);
    window.addEventListener("resize", () => this.sendHit());
  }

  apply(view: PillView) {
    this.view = view;
    this.stage.dataset.edge = view.edge;
    this.stage.classList.toggle("still", still());
    this.render();
    this.showMessage();
  }

  bands(levels: number[]) {
    this.target = levels.slice(0, BAND_COUNT);
    if (!micOpen(this.view)) return;
    if (still()) {
      this.shown = this.target.map((v) => Math.min(1, Math.max(0, v)));
      this.drawBands();
      return;
    }
    this.startLoop();
  }

  private setHover(on: boolean) {
    clearTimeout(this.hoverTimer);
    if (on) {
      this.hover = true;
      this.render();
    } else {
      // Un petit délai : passer d'un bouton à l'autre ne referme pas la barre.
      this.hoverTimer = window.setTimeout(() => {
        this.hover = false;
        this.render();
      }, 350);
    }
  }

  private render() {
    const mode = pillMode(this.view, this.hover);
    this.bar.classList.toggle("mic-open", micOpen(this.view));
    if (mode === this.mode) {
      this.sendHit();
      return;
    }
    this.mode = mode;
    this.bar.dataset.mode = mode;
    this.bar.replaceChildren(...this.content(mode));
    const listening = mode === "listening" || mode === "handsFree" || mode === "thinking";
    if (listening) this.mountGum(mode === "thinking");
    else this.unmountGum();
    if (mode !== "listening" && mode !== "handsFree") {
      this.stopBands();
    }
    clearInterval(this.clockTimer);
    this.clockTimer = 0;
    if (mode === "call") {
      const tick = () => setText(this.clock, callClock(this.view.callStartedAt, Date.now()));
      tick();
      this.clockTimer = window.setInterval(tick, 1000);
    }
    // La taille change après la mise en page.
    requestAnimationFrame(() => this.sendHit());
  }

  private content(mode: PillMode): Node[] {
    const key = keyLabel(this.view.key);
    switch (mode) {
      case "rest":
        return [el("span", { class: "pill-rest" })];
      case "hover": {
        const buttons: Node[] = [
          el("button", { class: "pill-btn", type: "button", title: `Dicter · ${key}`, "aria-label": "Dicter", onclick: () => action("dictate") }, glyph(MIC)),
        ];
        if (settingsStore.moduleEnabled("callnotes")) {
          buttons.push(
            el(
              "button",
              { class: "pill-btn", type: "button", title: "Enregistrer un appel", "aria-label": "Enregistrer un appel", onclick: () => void Bridge.busPublish("callnotes.start", {}, "dictation") },
              glyph(RECORD, (svg) => {
                const c = document.createElementNS(SVG, "circle");
                c.setAttribute("cx", "12");
                c.setAttribute("cy", "12");
                c.setAttribute("r", "3.2");
                c.classList.add("pill-rec-core");
                svg.append(c);
              }),
            ),
          );
        }
        buttons.push(el("button", { class: "pill-btn", type: "button", title: "Réglages de la dictée", "aria-label": "Réglages de la dictée", onclick: () => openSettings("voice:dictation") }, glyph(GEAR)));
        return buttons;
      }
      case "listening":
        return [this.gumSlot, this.redDot, this.wave];
      case "thinking":
        return [this.gumSlot, el("span", { class: "pill-thinking", role: "status" }, "J'écris…")];
      case "handsFree":
        return [
          el("button", { class: "pill-btn small", type: "button", title: "Annuler · Échap", "aria-label": "Annuler", onclick: () => action("cancel") }, glyph(CROSS)),
          this.redDot,
          this.wave,
          el("button", { class: "pill-btn small go", type: "button", title: `Coller, ou appuyer sur ${key}`, "aria-label": "Coller", onclick: () => action("finish") }, glyph(CHECK)),
        ];
      case "call":
        return [
          el("span", { class: "pill-rec", "aria-hidden": "true" }),
          this.clock,
          el("button", { class: "pill-stop", type: "button", onclick: () => void Bridge.busPublish("callnotes.stop", {}, "dictation") }, "Arrêter"),
        ];
    }
  }

  // ── La goutte ───────────────────────────────────────────────────────────

  private mountGum(thinking: boolean) {
    if (!this.renderer) {
      // La mascotte choisie si elle est de la famille gomme, sinon la goutte gomme.
      const wanted = settingsStore.current.mascot?.id ?? "goutte-gomme";
      let entry = findMascot(wanted);
      if (!entry || entry.manifest.renderer !== "gum") entry = findMascot("goutte-gomme");
      if (!entry) return;
      try {
        this.renderer = createRenderer(entry.manifest, entry.assets);
        this.renderer.mount(this.gumSlot);
        this.gumAnims = entry.manifest.animations;
      } catch (e) {
        log.warn(`pilule : la goutte ne se dessine pas : ${errorText(e)}`);
        this.renderer = null;
        return;
      }
    }
    const name = thinking ? "pensive" : "concentree";
    const spec = this.gumAnims.find((a) => a.name === name) ?? this.gumAnims.find((a) => a.name === "concentree");
    if (spec) this.renderer?.play(spec);
  }

  private gumAnims: AnimationSpec[] = [];

  private unmountGum() {
    this.renderer?.destroy();
    this.renderer = null;
    this.gumSlot.replaceChildren();
  }

  // ── Les bulles ──────────────────────────────────────────────────────────

  private startLoop() {
    if (this.stopLoop) return;
    this.lastFrame = performance.now();
    this.stopLoop = frameLoop(this.wave, (now) => {
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      const next = smoothBands(this.shown, this.target, dt);
      const settled = bandsAtRest(next, this.target);
      this.shown = settled ? this.target.slice() : next;
      this.drawBands();
      // Posées : la boucle s'arrête jusqu'aux prochains niveaux.
      if (settled) this.stopBands(false);
    });
  }

  private stopBands(reset = true) {
    this.stopLoop?.();
    this.stopLoop = null;
    if (reset) {
      this.target.fill(0);
      this.shown.fill(0);
      this.drawBands();
    }
  }

  private drawBands() {
    for (let i = 0; i < BAND_COUNT; i++) {
      const v = 0.22 + 0.78 * (this.shown[i] ?? 0);
      this.dots[i].style.transform = `scaleY(${v.toFixed(3)})`;
    }
  }

  // ── Les messages ────────────────────────────────────────────────────────

  private showMessage() {
    const m = this.view.message;
    if (!m) {
      this.msg.hidden = true;
      this.shownMessage = 0;
      clearTimeout(this.msgTimer);
      this.sendHit();
      return;
    }
    if (m.id === this.shownMessage) return;
    this.shownMessage = m.id;
    const c = messageContent(m);
    setText(this.msgText, c.text);
    this.msgAction.hidden = !c.action;
    if (c.actionLabel) setText(this.msgAction, c.actionLabel);
    this.msg.hidden = false;
    clearTimeout(this.msgTimer);
    if (c.autoCloseMs > 0) this.msgTimer = window.setTimeout(() => this.closeMessage(), c.autoCloseMs);
    requestAnimationFrame(() => this.sendHit());
  }

  private closeMessage() {
    clearTimeout(this.msgTimer);
    this.msg.hidden = true;
    this.sendHit();
    action("dismiss");
  }

  private messageAction() {
    const m = this.view.message;
    if (!m) return;
    const c = messageContent(m);
    if (c.action === "settings") {
      openSettings("voice:dictation");
      this.closeMessage();
    } else if (c.action === "fix" && m.fix) {
      action("fix", { fix: m.fix });
    }
  }

  // ── Les clics ───────────────────────────────────────────────────────────

  private lastHit = "";

  private sendHit() {
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    const add = (node: HTMLElement, pad: number) => {
      if (node.hidden) return;
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
    };
    // Au repos, la barre est mince : un peu d'air autour pour l'attraper.
    add(this.bar, this.mode === "rest" ? 10 : 2);
    add(this.msg, 2);
    const key = JSON.stringify(rects);
    if (key === this.lastHit) return;
    this.lastHit = key;
    Bridge.moduleInvoke("dictation", "pill_hit", { rects }).catch(() => {});
  }
}

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);
  await startI18n();
  await startPerf();
  const pill = new Pill(document.getElementById("root")!);
  await onTauriEvent<PillView>("pill-state", (v) => pill.apply({ ...IDLE_VIEW, ...v }));
  await onTauriEvent<number[]>("pill-bands", (b) => pill.bands(b));
  try {
    const v = await Bridge.moduleInvoke<PillView>("dictation", "pill_state", {});
    if (v) pill.apply({ ...IDLE_VIEW, ...v });
  } catch {
    // Module coupé : la fenêtre reste cachée.
  }
  log.info("pilule de la dictée prête");
}

void start();
