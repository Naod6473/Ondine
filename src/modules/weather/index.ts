// Module « Météo » : la température et une icône dans la mini-île.
//
// Le Rust (src-tauri/src/modules/weather.rs) demande la météo à Open-Meteo,
// seulement si l'utilisateur l'a allumée et a donné sa ville, au plus toutes
// les 30 minutes. Quand il a du nouveau, il publie `weather.changed` ; on lui
// redemande alors la dernière météo (`current`).
//
// On republie ensuite `weather.updated` (la météo prête à afficher) pour
// l'onglet Système, qui montre une ligne « Météo ».
//
// Pas d'onglet : la vue compacte s'affiche quand aucun autre module (musique,
// minuteur, rendez-vous) n'a quelque chose à montrer dans la pilule.

import manifest from "./manifest.json";
import { demoOn } from "../../core/demo";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

/** Ce que renvoie la commande `current` (voir `Weather` dans weather.rs). */
export interface WeatherNow {
  place: string;
  temp: number;
  min: number | null;
  max: number | null;
  wind: number | null;
  code: number;
  isDay: boolean;
  icon: string;
  label: string;
  unit: "c" | "f";
  at: string;
}

/** Ce que reçoit l'onglet Système (`weather.updated`). */
export interface WeatherLine {
  icon: string;
  temp: string;
  label: string;
  place: string;
  detail: string;
}

let now: WeatherNow | null = null;

/** 17.3 → « 17° » (on arrondit : le dixième ne sert à rien d'un coup d'œil). */
const deg = (v: number) => `${Math.round(v)}°`;

/** « min 10° · max 19° · vent 12 km/h · à 14:00 » */
export function weatherDetail(w: WeatherNow): string {
  const parts: string[] = [];
  if (w.min !== null && w.max !== null) parts.push(`${deg(w.min)} / ${deg(w.max)}`);
  if (w.wind !== null) parts.push(`vent ${Math.round(w.wind)} ${w.unit === "f" ? "mph" : "km/h"}`);
  if (w.at) parts.push(`à ${w.at}`);
  return parts.join(" · ");
}

/** La météo est-elle allumée (ou le mode démo, qui en montre une fausse) ? */
function wanted(api: ModuleApi): boolean {
  return demoOn() || api.settings().on === true;
}

async function refresh(api: ModuleApi) {
  try {
    now = wanted(api) ? await api.invoke<WeatherNow | null>("current") : null;
  } catch {
    now = null; // hors de l'appli (navigateur), ou module en panne : rien à montrer
  }
  const line: WeatherLine | null = now
    ? { icon: now.icon, temp: `${deg(now.temp)}${now.unit === "f" ? "F" : "C"}`, label: now.label, place: now.place, detail: weatherDetail(now) }
    : null;
  api.emit("weather.updated", line);
  api.refreshCompact();
}

export const weather: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const off = api.on("weather.changed", () => void refresh(api));
    // Les réglages changent souvent (n'importe quel réglage de l'île) : on ne
    // redemande que si ceux de la météo, ou le mode démo, ont changé.
    let seen = JSON.stringify([api.settings(), demoOn()]);
    const offSettings = api.onSettingsChange((values) => {
      const key = JSON.stringify([values, demoOn()]);
      if (key !== seen) void refresh(api);
      seen = key;
    });
    void refresh(api);
    return () => {
      off();
      offSettings();
    };
  },

  views: {
    compactWhen: (api) => now !== null && wanted(api) && api.settings().showCompact !== false,

    compact(root) {
      if (!now) return;
      const w = now;
      root.append(
        el(
          "div",
          { class: "timer-compact", title: [w.place, weatherDetail(w)].filter(Boolean).join(" · ") },
          el("span", { class: "timer-compact-text" }, `${w.icon} ${deg(w.temp)}`),
          el("span", { class: "muted", "data-no-i18n": true }, w.place),
        ),
      );
    },
  },
};
