// Module « Mises à jour des logiciels » (winget). Le travail est fait par le
// Rust (src-tauri/src/modules/updates.rs) ; ici, les notifications et la
// pastille de l'île, et l'onglet (view.ts, chargé à la première ouverture).

import manifest from "./manifest.json";
import type { IslandModule, ModuleManifest } from "../../core/module-types";
import { lazyView } from "../../core/lazy-view";
// Avec le module (pas avec la vue) : la pastille de l'île en a besoin dès le démarrage.
import "../../styles/updates.css";
import { finishedNote, type Status } from "./logic";

export const updates: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // Le dernier compte connu, renvoyé à l'île quand un réglage change (« Pastille
    // sur l'île », lu par island.ts) ou au démarrage. `echo` : pas une vérification.
    let count = 0;
    const dot = () => api.emit("updates.available", { count, fresh: 0, scheduled: false, echo: true });
    const offs = [
      api.on("updates.available", (msg) => {
        const p = (msg.payload ?? {}) as { count?: number; fresh?: number; scheduled?: boolean; echo?: boolean };
        if (p.echo) return;
        count = Math.max(0, Number(p.count) || 0);
        // Une vérification automatique qui trouve du nouveau : une notification discrète.
        if (p.scheduled && (p.fresh ?? 0) > 0 && api.settings().notify !== false) {
          api.notify({
            title: count === 1 ? "1 mise à jour de logiciel disponible" : `${count} mises à jour de logiciels disponibles`,
            icon: "🔃",
            priority: "low",
            key: "updates-available",
            actions: [{ label: "Voir", run: () => api.openIsland("updates") }],
          });
        }
      }),
      api.on("updates.finished", (msg) => {
        const note = finishedNote((msg.payload ?? { ok: 0, failed: 0, reboot: 0 }) as { ok: number; failed: number; reboot: number });
        if (note) api.notify({ ...note, icon: "🔃", priority: "normal", key: "updates-finished", actions: [{ label: "Voir", run: () => api.openIsland("updates") }] });
      }),
      api.onSettingsChange(() => dot()),
    ];
    // Au démarrage : la liste gardée de la dernière vérification rallume la pastille.
    api
      .invoke<Status>("status")
      .then((st) => {
        count = st.packages.filter((p) => !p.ignored).length;
        dot();
      })
      .catch(() => {});
    return () => {
      offs.forEach((off) => off());
      // Module coupé : plus de pastille.
      api.emit("updates.available", { count: 0, fresh: 0, scheduled: false, echo: true });
    };
  },

  views: {
    expanded: lazyView(() => import("./view").then((m) => m.mount)),
  },
};
