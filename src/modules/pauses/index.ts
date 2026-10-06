// Module « Pauses » : un petit rappel de s'arrêter après un long moment d'écran.
//
// Rien à afficher dans l'île : seulement un réglage et des notifications.
// Toutes les 30 s, on demande à Windows depuis quand la souris et le clavier
// n'ont pas été touchés (Bridge.deskState) :
//   - 5 minutes sans rien toucher = tu as fait une pause : le compteur repart ;
//   - après `everyMin` minutes d'écran, on propose une pause, sauf pendant une
//     présentation / un plein écran, ou un appel (micro utilisé, d'après le
//     module Contrôles) : on attend que ce soit fini.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import type { IslandModule, ModuleManifest } from "../../core/module-types";

const CHECK_MS = 30_000;
/** Une absence de cette durée compte comme une pause. */
const BREAK_IDLE_MS = 5 * 60_000;
/** « Plus tard » repousse de… */
const SNOOZE_MS = 10 * 60_000;

export const pauses: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    let activeSince = Date.now();
    let micInUse = false;
    const offMic = api.on("controls.media-use", (msg) => {
      micInUse = ((msg.payload as { mic?: string[] } | null)?.mic ?? []).length > 0;
    });

    const tick = async () => {
      const every = Number(api.settings().everyMin ?? 50);
      if (!every) return;
      const desk = await Bridge.deskState();
      if (!desk) return; // hors de l'appli
      // Une vraie absence : la pause est faite.
      if (desk.idleMs >= BREAK_IDLE_MS) {
        activeSince = Date.now();
        return;
      }
      if (Date.now() - activeSince < every * 60_000) return;
      if (desk.busy) return;
      if (micInUse && api.settings().quietInCalls !== false) return;
      // On ne redemande pas tout de suite si la notification est ignorée.
      activeSince = Date.now() - every * 60_000 + SNOOZE_MS;
      api.emit("mascot.emote", { emotion: "calm" });
      api.notify({
        title: "Et si tu faisais une petite pause ?",
        body: `${every} minutes d'écran : lève-toi, regarde au loin, bois un verre d'eau.`,
        icon: "☕",
        priority: "normal",
        key: "pauses",
        durationMs: 20_000,
        actions: [
          { label: "C'est parti", run: () => void (activeSince = Date.now()) },
          { label: "Dans 10 min", run: () => void (activeSince = Date.now() - every * 60_000 + SNOOZE_MS) },
        ],
      });
    };
    const timer = window.setInterval(() => void tick(), CHECK_MS);
    return () => {
      window.clearInterval(timer);
      offMic();
    };
  },
};
