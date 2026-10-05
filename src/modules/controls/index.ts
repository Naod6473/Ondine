// Module « Contrôles » : Wi-Fi, Bluetooth et mode avion, le volume des
// haut-parleurs et du micro, et la luminosité des écrans.
//
// Le Rust (src-tauri/src/modules/controls.rs) lit et change les réglages de
// Windows. Ici : une ligne par périphérique, avec un grand curseur façon
// centre de contrôle (et un bouton « couper » pour le son). Tant que l'onglet
// est ouvert, on relit le son chaque seconde (le volume a pu changer avec les
// touches du clavier), les radios toutes les 2 s et les écrans toutes les 5 s
// (leur réponse est lente).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

type DeviceId = "speakers" | "microphone";

interface Level {
  volume: number;
  muted: boolean;
}

interface State {
  speakers: Level | null;
  microphone: Level | null;
}

type RadioKind = "wifi" | "bluetooth" | "mobile";

interface Radio {
  kind: RadioKind;
  on: boolean;
  /** Bloquée (interrupteur matériel, carte désactivée) : on ne peut pas l'allumer d'ici. */
  disabled: boolean;
}

interface Screen {
  id: string;
  name: string;
  brightness: number;
}

const SOUND_REFRESH_MS = 1000;
const SCREENS_REFRESH_MS = 5000;
const RADIOS_REFRESH_MS = 2000;
/** Pendant qu'on fait glisser un curseur, au plus un envoi tous les… (le son réagit vite, un écran externe non). */
const SOUND_SEND_MS = 60;
const SCREEN_SEND_MS = 150;

/** Les pictogrammes en SVG (nets à toute taille, comme ceux de la musique). */
const GLYPHS = {
  speakers: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  speakersOff: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
  microphone: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  microphoneOff: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M4 4l16 16",
  wifi: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01",
  bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
  airplane: "M10.5 3.5a1.5 1.5 0 0 1 3 0V9l7 4v2l-7-2v4.5l2.5 2V21L12 20l-4 1v-1.5l2.5-2V13l-7 2v-2l7-4z",
  mobile: "M5 20v-3M10 20v-7M15 20v-11M20 20V4",
  sun: "M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
};

function glyph(kind: keyof typeof GLYPHS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", GLYPHS[kind]);
  svg.append(path);
  return svg;
}

/**
 * Un curseur 0-100 qui appelle `send` pendant qu'on le fait glisser, au plus
 * une fois tous les `everyMs` (le dernier mouvement part toujours).
 * `dragging()` dit si la main est dessus : on n'écrase pas sa valeur.
 */
function slider(label: string, everyMs: number, onMove: (value: number) => void, send: (value: number) => void) {
  const input = el("input", { class: "ctl-slider", type: "range", min: "0", max: "100", step: "1", "aria-label": label }) as HTMLInputElement;
  let held = false;
  let lastSent = 0;
  let pending: number | undefined;
  input.addEventListener("pointerdown", () => (held = true));
  input.addEventListener("pointerup", () => (held = false));
  input.addEventListener("change", () => (held = false));
  input.addEventListener("input", () => {
    const value = Number(input.value);
    onMove(value);
    window.clearTimeout(pending);
    const go = () => {
      lastSent = Date.now();
      send(value);
    };
    const wait = everyMs - (Date.now() - lastSent);
    if (wait <= 0) go();
    else pending = window.setTimeout(go, wait);
  });
  return {
    input,
    dragging: () => held,
    /** Montre une valeur (le remplissage suit : voir .ctl-slider dans island.css). */
    show(value: number) {
      input.value = String(value);
      input.style.setProperty("--v", `${value}%`);
    },
  };
}

/** Une ligne « bouton couper + curseur + pourcentage » pour le son ou le micro. */
function deviceRow(api: ModuleApi, device: DeviceId, label: string) {
  const off = device === "speakers" ? "speakersOff" : "microphoneOff";
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  const mute = el("button", { class: "ctl-mute", type: "button" }) as HTMLButtonElement;
  const value = el("span", { class: "ctl-value" });
  const missing = el("span", { class: "ctl-missing muted" }, device === "speakers" ? "Aucune sortie audio" : "Aucun micro branché");

  let current: Level | null = null;

  const paint = (level: Level) => {
    bar.show(level.volume);
    value.textContent = level.muted ? "coupé" : `${level.volume} %`;
    row.classList.toggle("muted-dev", level.muted);
    const title = level.muted ? `Réactiver : ${label}` : `Couper : ${label}`;
    mute.title = title;
    mute.setAttribute("aria-label", title);
    mute.setAttribute("aria-pressed", String(level.muted));
    mute.replaceChildren(glyph(level.muted ? off : device));
  };

  const bar = slider(
    `Volume : ${label}`,
    SOUND_SEND_MS,
    (volume) => {
      // Bouger le curseur réactive le son, comme dans Windows.
      const wasMuted = current?.muted ?? false;
      const muted = wasMuted && volume === 0;
      if (wasMuted && !muted) api.invoke("set_muted", { device, muted: false }).catch(fail);
      current = { volume, muted };
      paint(current);
    },
    (volume) => api.invoke("set_volume", { device, volume }).catch(fail),
  );
  const row = el("div", { class: "ctl-row", "data-device": device }, mute, bar.input, value, missing);

  mute.addEventListener(
    "click",
    api.handler(async () => {
      if (!current) return;
      current = { ...current, muted: !current.muted };
      paint(current);
      try {
        await api.invoke("set_muted", { device, muted: current.muted });
      } catch (err) {
        fail(err);
      }
    }),
  );

  return {
    node: row,
    /** Nouvel état lu dans Windows (null = pas de périphérique). */
    update(level: Level | null) {
      row.classList.toggle("absent", !level);
      mute.disabled = !level;
      bar.input.disabled = !level;
      if (!level) {
        current = null;
        return;
      }
      // Pendant un glissé, c'est la main qui décide : on n'écrase pas le curseur.
      if (bar.dragging()) return;
      if (current && current.volume === level.volume && current.muted === level.muted) return;
      current = level;
      paint(level);
    },
  };
}

/** Une ligne « soleil + curseur + pourcentage » pour un écran. */
function screenRow(api: ModuleApi, screen: Screen) {
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  const value = el("span", { class: "ctl-value" });
  const bar = slider(
    `Luminosité : ${screen.name}`,
    SCREEN_SEND_MS,
    (level) => {
      bar.show(level);
      value.textContent = `${level} %`;
    },
    (level) => api.invoke("set_brightness", { id: screen.id, brightness: level }).catch(fail),
  );
  const icon = el("span", { class: "ctl-icon", title: screen.name }, glyph("sun"));
  const name = el("span", { class: "ctl-name" }, screen.name);
  const node = el("div", { class: "ctl-row" }, icon, name, bar.input, value);
  return {
    node,
    update(s: Screen) {
      icon.title = s.name;
      name.textContent = s.name;
      if (bar.dragging()) return;
      bar.show(s.brightness);
      value.textContent = `${s.brightness} %`;
    },
  };
}

const RADIO_NAMES: Record<RadioKind | "airplane", string> = {
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth",
  mobile: "Données mobiles",
  airplane: "Mode avion",
};

/** Les pastilles rondes « Wi-Fi / Bluetooth / Mode avion », comme le centre de contrôle. */
function radioTiles(api: ModuleApi) {
  const fail = (err: unknown) => api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "controls-error" });
  const box = el("div", { class: "ctl-radios" });
  const tiles = new Map<string, HTMLButtonElement>();
  let busy = false;

  const tile = (id: RadioKind | "airplane", onClick: (wanted: boolean) => Promise<unknown>) => {
    const button = el("button", { class: "ctl-radio", type: "button", "data-kind": id }, el("span", { class: "ctl-radio-dot" }, glyph(id)), el("span", {}, RADIO_NAMES[id])) as HTMLButtonElement;
    button.addEventListener(
      "click",
      api.handler(async () => {
        if (busy) return;
        busy = true;
        // L'interrupteur bascule tout de suite ; la prochaine lecture corrige si Windows a refusé.
        const wanted = button.classList.toggle("on");
        try {
          await onClick(wanted);
        } catch (err) {
          button.classList.toggle("on");
          fail(err);
        } finally {
          busy = false;
        }
      }),
    );
    tiles.set(id, button);
    return button;
  };

  let shown = "";
  return {
    node: box,
    update(list: Radio[]) {
      if (busy) return;
      // Les pastilles à montrer : celles des radios présentes, plus le mode avion.
      const key = list.map((r) => r.kind).join(",");
      if (key !== shown) {
        shown = key;
        tiles.clear();
        box.replaceChildren(
          ...list.map((r) => tile(r.kind, (on) => api.invoke("set_radio", { kind: r.kind, on }))),
          ...(list.length ? [tile("airplane", (on) => api.invoke("set_airplane", { on }))] : []),
        );
      }
      for (const r of list) {
        const button = tiles.get(r.kind);
        if (!button) continue;
        button.classList.toggle("on", r.on);
        button.disabled = r.disabled;
        const state = r.disabled ? "bloqué sur ce PC" : r.on ? "activé" : "désactivé";
        button.title = `${RADIO_NAMES[r.kind]} : ${state}`;
        button.setAttribute("aria-pressed", String(r.on));
      }
      // « Mode avion » : toutes les radios utilisables sont éteintes.
      const airplane = tiles.get("airplane");
      if (airplane) {
        const on = list.length > 0 && list.every((r) => !r.on);
        airplane.classList.toggle("on", on);
        airplane.title = on ? "Mode avion : tout est coupé" : "Mode avion : couper Wi-Fi, Bluetooth…";
        airplane.setAttribute("aria-pressed", String(on));
      }
    },
  };
}

export const controls: IslandModule = {
  manifest: manifest as ModuleManifest,

  views: {
    expanded(root, api: ModuleApi) {
      const radios = radioTiles(api);
      const speakers = deviceRow(api, "speakers", "haut-parleurs");
      const microphone = deviceRow(api, "microphone", "micro");
      // Les écrans arrivent après la première lecture (et peuvent changer : un écran branché).
      const screensTitle = el("div", { class: "ctl-title muted" }, "Luminosité");
      const screensBox = el("div", { class: "ctl-screens" });
      screensTitle.hidden = true;
      root.append(
        el(
          "div",
          { class: "ctl" },
          radios.node,
          el("div", { class: "ctl-title muted" }, "Son"),
          speakers.node,
          el("div", { class: "ctl-title muted" }, "Micro"),
          microphone.node,
          screensTitle,
          screensBox,
        ),
      );

      let alive = true;
      const refreshSound = async () => {
        try {
          const s = await api.invoke<State>("state");
          if (!alive) return;
          speakers.update(s.speakers);
          microphone.update(s.microphone);
        } catch {
          // hors de l'appli (navigateur) : on garde l'affichage
        }
      };

      const rows = new Map<string, ReturnType<typeof screenRow>>();
      let screensKey = "";
      const refreshScreens = async () => {
        try {
          const list = await api.invoke<Screen[]>("screens");
          if (!alive) return;
          // La liste des écrans a changé (branché, débranché) : on refait les lignes.
          const key = list.map((s) => s.id).join(",");
          if (key !== screensKey) {
            screensKey = key;
            rows.clear();
            screensBox.replaceChildren(
              ...list.map((s) => {
                const row = screenRow(api, s);
                rows.set(s.id, row);
                return row.node;
              }),
            );
            // Un seul écran : pas besoin de son nom ; plusieurs : on les nomme.
            screensBox.classList.toggle("named", list.length > 1);
            screensTitle.hidden = list.length === 0;
          }
          for (const s of list) rows.get(s.id)?.update(s);
        } catch {
          // hors de l'appli : rien à montrer
        }
      };

      const refreshRadios = async () => {
        try {
          const list = await api.invoke<Radio[]>("radios");
          if (alive) radios.update(list);
        } catch {
          // hors de l'appli, ou Windows ne liste pas les radios : pas de pastilles
        }
      };

      void refreshRadios();
      void refreshSound();
      void refreshScreens();
      const soundTimer = window.setInterval(() => void refreshSound(), SOUND_REFRESH_MS);
      const screensTimer = window.setInterval(() => void refreshScreens(), SCREENS_REFRESH_MS);
      const radiosTimer = window.setInterval(() => void refreshRadios(), RADIOS_REFRESH_MS);
      return () => {
        alive = false;
        window.clearInterval(soundTimer);
        window.clearInterval(screensTimer);
        window.clearInterval(radiosTimer);
      };
    },
  },
};
