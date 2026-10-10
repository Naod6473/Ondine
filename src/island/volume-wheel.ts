// La molette de la souris sur l'île = le volume (1.2.3), au simple survol :
// aucun clic avant. La fenêtre de l'île ne prend pas le focus, mais Windows
// envoie la molette à la fenêtre sous la souris (réglage « Faire défiler les
// fenêtres inactives quand je pointe dessus », actif par défaut), et la forme
// de l'île prend la souris dès qu'elle la survole (island/mod.rs).
//
// L'île compte les crans (wheel-volume.ts) et publie `island.wheel {delta}` ;
// le module Contrôles (le seul à régler le son) change le volume et répond
// `controls.volume {volume, muted, source: "wheel"}` ; la capsule ci-dessous
// montre alors le niveau, puis s'efface. Module Contrôles coupé, ou case
// « Molette sur l'île = volume » décochée : la molette ne fait rien de plus
// qu'avant (elle fait défiler ce qui défile).

import "../styles/island-design.css";
import type { Bus } from "../core/bus";
import { settingsStore } from "../core/settings-store";
import { el } from "./dom";
import { speakerLevel, WheelVolume, wheelSetsVolume } from "./wheel-volume";

/** La capsule reste ce temps après le dernier cran. */
const HUD_MS = 1300;

/** La molette règle-t-elle le volume (module Contrôles activé, case cochée) ? */
function wheelOn(): boolean {
  return settingsStore.moduleEnabled("controls") && settingsStore.current.modules.controls?.values?.wheelVolume !== false;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Un haut-parleur au trait, ses deux ondes et la croix du son coupé. */
function speaker(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = (d: string, cls = "") => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    if (cls) p.setAttribute("class", cls);
    svg.append(p);
  };
  path("M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z");
  path("M10.4 6.1a2.6 2.6 0 0 1 0 3.8", "vh-w1");
  path("M12.2 4.3a5.2 5.2 0 0 1 0 7.4", "vh-w2");
  path("M10.5 6l3.5 4M14 6l-3.5 4", "vh-x");
  return svg;
}

/** Branche la molette et la capsule du volume sur l'île. */
export function attachWheelVolume(shell: HTMLElement, mascot: HTMLElement, bus: Bus, state: () => string): void {
  const fill = el("i", { class: "vh-fill" });
  const hud = el("div", { class: "volume-hud", "aria-hidden": "true" }, el("span", { class: "vh-bar" }, fill));
  hud.prepend(speaker());
  shell.append(hud);
  const wheel = new WheelVolume();
  let hideTimer = 0;

  shell.addEventListener(
    "wheel",
    (e) => {
      if (!wheelOn() || e.ctrlKey) return;
      if (!wheelSetsVolume(state(), mascot.contains(e.target as Node))) return;
      // Le défilement horizontal d'un pavé tactile n'est pas le volume.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const delta = wheel.push(e.deltaY, e.deltaMode, performance.now());
      if (delta) bus.emit("island.wheel", { delta });
    },
    { passive: false },
  );

  bus.on("controls.volume", (msg) => {
    const p = (msg.payload ?? {}) as { volume?: number; muted?: boolean; source?: string };
    if (p.source !== "wheel" || typeof p.volume !== "number") return;
    const muted = p.muted === true;
    hud.style.setProperty("--vh", String(muted ? 0 : Math.max(0, Math.min(100, p.volume)) / 100));
    hud.dataset.level = String(speakerLevel(p.volume, muted));
    hud.classList.toggle("muted", muted);
    hud.classList.add("in");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => hud.classList.remove("in"), HUD_MS);
  });
  // L'île se cache : la capsule part avec elle (pas de reste au prochain réveil).
  bus.on("island.state", (msg) => {
    if ((msg.payload as { to?: string } | null)?.to === "hidden") hud.classList.remove("in");
  });
}
