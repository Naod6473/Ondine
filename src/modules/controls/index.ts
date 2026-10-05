// Module « Contrôles » : le volume des haut-parleurs et du micro.
//
// Le Rust (src-tauri/src/modules/controls.rs) lit et change les réglages de
// Windows. Ici : une ligne par périphérique, avec un bouton « couper » et un
// grand curseur façon centre de contrôle. Tant que l'onglet est ouvert, on
// relit l'état chaque seconde (le volume a pu changer avec les touches du
// clavier ou une autre appli).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type {
  IslandModule,
  ModuleApi,
  ModuleManifest,
} from "../../core/module-types";
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

const REFRESH_MS = 1000;
/** Pendant qu'on fait glisser le curseur, au plus un envoi tous les… */
const SEND_EVERY_MS = 60;

/** Les pictogrammes en SVG (nets à toute taille, comme ceux de la musique). */
const GLYPHS = {
  speakers:
    "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  speakersOff: "M4 9h4l5-4v14l-5-4H4zM16.5 9.5l5 5M21.5 9.5l-5 5",
  microphone:
    "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  microphoneOff:
    "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M4 4l16 16",
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

/** Une ligne « bouton couper + curseur + pourcentage » pour un périphérique. */
function deviceRow(api: ModuleApi, device: DeviceId, label: string) {
  const off = device === "speakers" ? "speakersOff" : "microphoneOff";
  const mute = el("button", {
    class: "ctl-mute",
    type: "button",
  }) as HTMLButtonElement;
  const slider = el("input", {
    class: "ctl-slider",
    type: "range",
    min: "0",
    max: "100",
    step: "1",
    "aria-label": `Volume : ${label}`,
  }) as HTMLInputElement;
  const value = el("span", { class: "ctl-value" });
  const missing = el(
    "span",
    { class: "ctl-missing muted" },
    device === "speakers" ? "Aucune sortie audio" : "Aucun micro branché",
  );
  const row = el(
    "div",
    { class: "ctl-row", "data-device": device },
    mute,
    slider,
    value,
    missing,
  );

  let current: Level | null = null;
  let dragging = false;
  let lastSent = 0;
  let pending: number | undefined;

  const fail = (err: unknown) =>
    api.notify({
      title: errorText(err),
      icon: "⚠️",
      priority: "low",
      key: "controls-error",
    });

  // Le remplissage du curseur suit la valeur (voir .ctl-slider dans island.css).
  const paint = (volume: number, muted: boolean) => {
    slider.style.setProperty("--v", `${volume}%`);
    value.textContent = muted ? "coupé" : `${volume} %`;
    row.classList.toggle("muted-dev", muted);
    const title = muted ? `Réactiver : ${label}` : `Couper : ${label}`;
    mute.title = title;
    mute.setAttribute("aria-label", title);
    mute.setAttribute("aria-pressed", String(muted));
    mute.replaceChildren(glyph(muted ? off : device));
  };

  const send = (volume: number) => {
    lastSent = Date.now();
    api.invoke("set_volume", { device, volume }).catch(fail);
  };

  slider.addEventListener("pointerdown", () => (dragging = true));
  slider.addEventListener(
    "input",
    api.handler(() => {
      const volume = Number(slider.value);
      // Bouger le curseur réactive le son, comme dans Windows.
      const wasMuted = current?.muted ?? false;
      const muted = wasMuted && volume === 0;
      if (wasMuted && !muted)
        api.invoke("set_muted", { device, muted: false }).catch(fail);
      current = { volume, muted };
      paint(volume, muted);
      // Pas plus d'un envoi tous les SEND_EVERY_MS : le dernier part toujours.
      window.clearTimeout(pending);
      const wait = SEND_EVERY_MS - (Date.now() - lastSent);
      if (wait <= 0) send(volume);
      else pending = window.setTimeout(() => send(volume), wait);
    }),
  );
  slider.addEventListener("change", () => (dragging = false));
  slider.addEventListener("pointerup", () => (dragging = false));

  mute.addEventListener(
    "click",
    api.handler(async () => {
      if (!current) return;
      const muted = !current.muted;
      current = { ...current, muted };
      paint(current.volume, muted);
      try {
        await api.invoke("set_muted", { device, muted });
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
      slider.disabled = !level;
      if (!level) {
        current = null;
        return;
      }
      // Pendant un glissé, c'est la main qui décide : on n'écrase pas le curseur.
      if (dragging) return;
      if (
        current &&
        current.volume === level.volume &&
        current.muted === level.muted
      )
        return;
      current = level;
      slider.value = String(level.volume);
      paint(level.volume, level.muted);
    },
  };
}

export const controls: IslandModule = {
  manifest: manifest as ModuleManifest,

  views: {
    expanded(root, api: ModuleApi) {
      const speakers = deviceRow(api, "speakers", "haut-parleurs");
      const microphone = deviceRow(api, "microphone", "micro");
      root.append(
        el(
          "div",
          { class: "ctl" },
          el("div", { class: "ctl-title muted" }, "Son"),
          speakers.node,
          el("div", { class: "ctl-title muted" }, "Micro"),
          microphone.node,
        ),
      );

      let alive = true;
      const refresh = async () => {
        try {
          const s = await api.invoke<State>("state");
          if (!alive) return;
          speakers.update(s.speakers);
          microphone.update(s.microphone);
        } catch {
          // hors de l'appli (navigateur) : on garde l'affichage
        }
      };
      void refresh();
      const timer = window.setInterval(() => void refresh(), REFRESH_MS);
      return () => {
        alive = false;
        window.clearInterval(timer);
      };
    },
  },
};
