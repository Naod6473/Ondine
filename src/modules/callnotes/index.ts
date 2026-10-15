// Module « Notes d'appel » (1.2.4), côté île. Tout le travail est dans le Rust
// (src-tauri/src/modules/callnotes.rs) et la page des Réglages
// (src/settings/voice/callnotes-page.ts). Ici, seulement :
//   - pendant l'enregistrement, la vue compacte de l'île : un point rouge, le
//     temps écoulé et « Arrêter » (le micro écoute : on le voit toujours) ;
//   - à chaque début, le rappel « Prévenez les participants que vous enregistrez » ;
//   - une erreur venue d'un démarrage par la pilule (`callnotes.error`).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { pacedInterval } from "../../core/perf";
import { el } from "../../island/dom";
import { elapsed } from "../../settings/voice/callnotes-logic";
import "../../styles/callnotes.css";

interface CallState {
  recording: boolean;
  startedAt: number | null;
}

let state: CallState = { recording: false, startedAt: null };
const KEY = "callnotes";

function stop(api: ModuleApi) {
  void api.invoke("stop").catch((err) => api.notify({ title: "Notes d'appel", body: errorText(err), icon: "⚠️", key: KEY }));
}

export const callnotes: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const apply = (next: CallState) => {
      const began = next.recording && !state.recording;
      state = { recording: Boolean(next.recording), startedAt: next.startedAt ?? null };
      if (began) {
        api.notify({
          title: "Enregistrement de l'appel",
          body: "Prévenez les participants que vous enregistrez.",
          icon: "⏺️",
          priority: "high",
          key: KEY,
          actions: [{ label: "Arrêter", run: () => stop(api) }],
        });
      }
      api.refreshCompact();
    };
    const offState = api.on("callnotes.state", (msg) => apply(msg.payload as CallState));
    const offError = api.on("callnotes.error", (msg) => {
      const message = (msg.payload as { message?: string })?.message ?? "";
      api.notify({ title: "Notes d'appel", body: message, icon: "⚠️", priority: "normal", key: KEY });
    });
    // Un appel déjà en cours (fenêtre rechargée) : le point rouge revient tout de suite.
    void api.invoke<CallState>("status").then(apply).catch(() => {});
    return () => {
      offState();
      offError();
      state = { recording: false, startedAt: null };
    };
  },

  views: {
    compactWhen: () => state.recording,

    compact(root, api) {
      const time = el("span", { class: "callnotes-time" }, "0:00");
      const tick = () => {
        time.textContent = elapsed(Date.now() - (state.startedAt ?? Date.now()));
      };
      tick();
      // Le temps avance tant que la pilule est là (rythme du mode de performance).
      const stopTick = pacedInterval(tick, "mediaProgress", true);
      root.append(
        el(
          "div",
          { class: "callnotes-compact", role: "status", "aria-label": "Enregistrement de l'appel en cours" },
          el("span", { class: "callnotes-dot", "aria-hidden": "true" }),
          time,
          el("button", { class: "callnotes-stop", onclick: api.handler(() => stop(api)) }, "Arrêter"),
        ),
      );
      return stopTick;
    },
  },
};
