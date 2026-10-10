// Module « Écran de veille » (1.2.3) : tout se passe dans le Rust
// (src-tauri/src/modules/screensaver.rs : inactivité, présentation, fenêtre)
// et dans sa page (screensaver.html, src/screensaver/main.ts). Ce module
// n'a ni onglet ni travail de fond dans l'île : il porte l'interrupteur
// « Activé » (désactivé par défaut) et les réglages.

import manifest from "./manifest.json";
import type { IslandModule, ModuleManifest } from "../../core/module-types";

export const screensaver: IslandModule = {
  manifest: manifest as ModuleManifest,
  views: {},
};
