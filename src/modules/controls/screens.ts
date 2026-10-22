// Contrôles → bloc « Écrans » (1.2.5) : le mode d'affichage de Windows+P,
// l'écran principal, la luminosité de chaque écran, le mode sombre, la
// veilleuse, et « Éteindre seulement l'écran ». Le Rust : modules/controls.rs
// (display_layout, set_display_mode, displays, set_primary, screen_off) et
// platform/displays.rs.

import type { ModuleApi } from "../../core/module-types";
import { pacedInterval } from "../../core/perf";
import { el } from "../../island/dom";
import { blockIcon, type Page } from "./blocks";
import { fail, pageHead } from "./extras";
import { DISPLAY_MODES, modeName, monitorBoxes, type DisplayInfo, type DisplayLayout, type DisplayMode } from "./screens-logic";

interface Screen {
  id: string;
  name: string;
  brightness: number;
}

/** Après un changement, Windows met un moment à réorganiser les écrans. */
const SETTLE_MS = 2500;
const SCREEN_SEND_MS = 150;

/** Le petit dessin d'un mode : un ou deux écrans, pleins ou éteints. */
function modePicture(mode: DisplayMode) {
  const box = (cls: string) => el("span", { class: `ctl-mini-screen ${cls}` });
  const parts: Record<DisplayMode, HTMLElement[]> = {
    internal: [box("fill"), box("off")],
    clone: [box("fill"), box("fill")],
    extend: [box("fill join-l"), box("join-r")],
    external: [box("off"), box("fill")],
  };
  return el("span", { class: "ctl-mini", "aria-hidden": "true" }, ...parts[mode]);
}

/** La luminosité d'un écran, en ligne (comme les applis). */
function brightnessRow(api: ModuleApi, s: Screen) {
  const range = el("input", { type: "range", min: 0, max: 100, step: 1, class: "ctl-app-range", "aria-label": `Luminosité : ${s.name}` }) as HTMLInputElement;
  const pct = el("span", { class: "ctl-app-pct" });
  const node = el(
    "div",
    { class: "ctl-app ctl-level" },
    el("div", { class: "ctl-app-top" }, el("span", { class: "ctl-app-name", title: s.name }, s.name), pct),
    el("div", { class: "ctl-app-bottom" }, el("span", { class: "ctl-level-icon" }, blockIcon("screens")), el("span", { class: "ctl-app-track" }, range)),
  );
  let held = false;
  let lastSent = 0;
  let pending: number | undefined;
  const show = (v: number) => {
    if (!held) range.value = String(v);
    pct.textContent = `${v} %`;
  };
  range.addEventListener("pointerdown", () => (held = true));
  range.addEventListener("pointerup", () => (held = false));
  range.addEventListener("pointercancel", () => (held = false));
  range.addEventListener("input", () => {
    const v = Number(range.value);
    pct.textContent = `${v} %`;
    window.clearTimeout(pending);
    const go = () => {
      lastSent = Date.now();
      api.invoke("set_brightness", { id: s.id, brightness: v }).catch((err) => fail(api, err));
    };
    const wait = SCREEN_SEND_MS - (Date.now() - lastSent);
    if (wait <= 0) go();
    else pending = window.setTimeout(go, wait);
  });
  show(s.brightness);
  return { node, update: (next: Screen) => show(next.brightness) };
}

export function screensPage(api: ModuleApi, back: () => void, parts: { dark: HTMLElement; night: HTMLElement; onMode: (name: string) => void }): Page {
  const modes = el("div", { class: "ctl-seg", role: "radiogroup", "aria-label": "Mode d'affichage" });
  const modeNote = el("p", { class: "muted ctl-page-note" });
  const monitors = el("div", { class: "ctl-monitors", role: "radiogroup", "aria-label": "Écran principal" });
  const primarySection = el("div", { class: "ctl-section-box" }, el("p", { class: "ctl-section" }, "Écran principal"), monitors);
  const lights = el("div", { class: "ctl-page-rows" });
  const off = el(
    "button",
    {
      class: "btn small ctl-screen-off",
      type: "button",
      title: "Le PC continue de tourner ; bougez la souris ou appuyez sur une touche pour rallumer",
      onclick: api.handler(async () => {
        try {
          await api.invoke("screen_off");
        } catch (err) {
          fail(api, err);
        }
      }),
    },
    blockIcon("screens"),
    el("span", {}, "Éteindre seulement l'écran"),
  );
  const node = el(
    "div",
    { class: "ctl-page ctl-block-page", "data-island-fit": true },
    pageHead("Écrans", back),
    el(
      "div",
      { class: "ctl-page-list" },
      el("p", { class: "ctl-section" }, "Affichage (comme Windows+P)"),
      modes,
      modeNote,
      primarySection,
      el("p", { class: "ctl-section" }, "Luminosité des écrans"),
      lights,
      el("div", { class: "ctl-screen-toggles" }, parts.dark, parts.night, off),
    ),
  );

  let alive = true;
  let busy = false;
  let layout: DisplayLayout = { mode: null, connected: 0 };
  let displays: DisplayInfo[] = [];

  const drawModes = () => {
    const single = layout.connected < 2;
    modes.replaceChildren(
      ...DISPLAY_MODES.map((m) => {
        const on = layout.mode === m;
        return el(
          "button",
          {
            class: `ctl-seg-btn${on ? " on" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": String(on),
            disabled: busy || (single && m !== "internal"),
            onclick: api.handler(() => setMode(m)),
          },
          modePicture(m),
          el("span", {}, modeName(m)),
        );
      }),
    );
    modeNote.textContent = single ? "Un seul écran est branché : branchez-en un second pour dupliquer ou étendre." : "";
    modeNote.hidden = !single;
    parts.onMode(layout.mode ? modeName(layout.mode) : single ? "1 écran" : "");
  };

  const drawMonitors = () => {
    primarySection.hidden = displays.length < 2;
    monitors.replaceChildren(
      ...monitorBoxes(displays).map((m) =>
        el(
          "button",
          {
            class: `ctl-monitor${m.primary ? " on" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": String(m.primary),
            title: m.primary ? `${m.name} : écran principal` : `Faire de ${m.name} l'écran principal`,
            disabled: busy,
            onclick: api.handler(() => setPrimary(m.id, m.name, m.primary)),
          },
          el("span", { class: "ctl-monitor-box", style: `width:${m.w}px;height:${m.h}px` }, String(m.index)),
          el("span", { class: "ctl-monitor-name" }, m.name),
        ),
      ),
    );
  };

  const refresh = async () => {
    try {
      const [l, d] = await Promise.all([api.invoke<DisplayLayout>("display_layout"), api.invoke<DisplayInfo[]>("displays")]);
      if (!alive) return;
      layout = l;
      displays = d;
    } catch {
      // hors de l'appli : rien à montrer
    }
    drawModes();
    drawMonitors();
  };

  const rows = new Map<string, ReturnType<typeof brightnessRow>>();
  let rowsKey = "";
  const refreshLights = async () => {
    let list: Screen[] = [];
    try {
      list = await api.invoke<Screen[]>("screens");
    } catch {
      // hors de l'appli
    }
    if (!alive) return;
    const key = list.map((s) => s.id).join(",");
    if (key !== rowsKey) {
      rowsKey = key;
      rows.clear();
      lights.replaceChildren(
        ...list.map((s) => {
          const r = brightnessRow(api, s);
          rows.set(s.id, r);
          return r.node;
        }),
      );
      if (!list.length) lights.append(el("p", { class: "muted ctl-page-empty" }, "Aucun écran réglable : un écran externe doit accepter le réglage DDC/CI (souvent dans son menu)."));
    }
    for (const s of list) rows.get(s.id)?.update(s);
  };

  const later = () =>
    window.setTimeout(() => {
      busy = false;
      void refresh();
      void refreshLights();
    }, SETTLE_MS);

  async function setMode(m: DisplayMode) {
    if (busy || layout.mode === m) return;
    busy = true;
    layout = { ...layout, mode: m };
    drawModes();
    try {
      await api.invoke("set_display_mode", { mode: m });
    } catch (err) {
      fail(api, err);
    }
    later();
  }

  async function setPrimary(id: string, name: string, already: boolean) {
    if (busy || already) return;
    busy = true;
    drawMonitors();
    try {
      await api.invoke("set_primary", { id });
      api.notify({ title: `${name} est l'écran principal`, icon: "🖥️", priority: "low", key: "controls-primary" });
    } catch (err) {
      fail(api, err);
    }
    later();
  }

  void refresh();
  void refreshLights();
  const stopLights = pacedInterval(() => void refreshLights(), "controlsScreens", true);
  return {
    node,
    stop() {
      alive = false;
      stopLights();
    },
  };
}
