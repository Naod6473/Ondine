// Le bloc « Performances » de la page Général des réglages :
//   - le mode : Performance haute, Équilibrée (par défaut), Économie d'énergie ;
//   - « Économie d'énergie automatique sur batterie » (cochée par défaut) ;
//   - le mode qui s'applique en ce moment (le Rust le décide : choix + batterie,
//     voir src-tauri/src/services/perf.rs et src/core/perf.ts).
// Tout change à chaud : les boucles lisent le mode à chaque tour.

import { onPerfChange, perfMode, perfOnBattery } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import type { PerfMode, Settings } from "../core/types";
import { el } from "../island/dom";
import { choice, group, row, toggle } from "./controls";

const NAMES: Record<PerfMode, string> = {
  high: "Performance haute",
  balanced: "Équilibrée",
  eco: "Économie d'énergie",
};

/** « Mode actuel : Économie d'énergie (sur batterie) ». */
function currentText(): string {
  const mode = perfMode();
  if (mode === "eco" && perfOnBattery()) return "Mode actuel : Économie d'énergie (sur batterie)";
  return `Mode actuel : ${NAMES[mode]}`;
}

export function perfGroup(save: (change: (s: Settings) => void) => void): HTMLElement {
  const g = settingsStore.current.general;
  const now = el("span", { class: "muted", "aria-live": "polite" }, currentText());
  // Le mode peut changer sans nous (PC débranché) : la ligne suit, tant qu'elle est affichée.
  const off = onPerfChange(() => {
    if (!now.isConnected) return off();
    now.textContent = currentText();
  });
  return group(
    "Performances",
    [
      row(
        "Performances",
        choice(
          g.perfMode ?? "balanced",
          (Object.keys(NAMES) as PerfMode[]).map((m) => [m, NAMES[m]]),
          (v) => save((d) => (d.general.perfMode = v as PerfMode)),
        ),
        "Haute : l'île réagit au plus vite. Équilibrée : le bon compromis. Économie d'énergie : Ondine se réveille moins souvent (souris, musique, système…) et garde moins d'effets.",
      ),
      row(
        "Économie d'énergie automatique sur batterie",
        toggle(g.ecoOnBattery !== false, (v) => save((d) => (d.general.ecoOnBattery = v)), "Économie d'énergie automatique sur batterie"),
        "PC débranché : Ondine passe en économie d'énergie, quel que soit le choix au-dessus.",
      ),
      row("Mode utilisé", now),
    ],
    "Pour comparer les modes : la ligne « Ressources utilisées », dans le sous-menu À propos.",
  );
}
