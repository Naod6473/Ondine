// Module « Contrôles » : le volume des haut-parleurs et du micro, et la
// luminosité des écrans.
//
// Le Rust (src-tauri/src/modules/controls.rs) lit et change les réglages de
// Windows. Ici : une ligne par périphérique, avec un grand curseur façon
// centre de contrôle (et un bouton « couper » pour le son). Tant que l'onglet
// est ouvert, on relit le son chaque seconde (le volume a pu changer avec les
// touches du clavier) et les écrans toutes les 5 s (leur réponse est lente).

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

interface Screen {
  id: string;
  name: string;
  brightness: number;
}

const SOUND_REFRESH_MS = 1000;
const SCREENS_REFRESH_MS = 5000;
/** Pendant qu'on fait glisser un curseur, au plus un envoi tous les… (le son réagit vite, un écran externe non). */
const SOUND_SEND_MS = 60;
const SCREEN_SEND_MS = 150;

/** Les pictogrammes en SVG (nets à toute taille, comme ceux de la musique). */
const GLYPHS = {
  speakers: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  speakersOff: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
  microphone: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  microphoneOff: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M4 4l16 16",
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

export const controls: IslandModule = {
  manifest: manifest as ModuleManifest,

  views: {
    expanded(root, api: ModuleApi) {
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

      void refreshSound();
      void refreshScreens();
      const soundTimer = window.setInterval(() => void refreshSound(), SOUND_REFRESH_MS);
      const screensTimer = window.setInterval(() => void refreshScreens(), SCREENS_REFRESH_MS);
      return () => {
        alive = false;
        window.clearInterval(soundTimer);
        window.clearInterval(screensTimer);
      };
    },
  },
};
