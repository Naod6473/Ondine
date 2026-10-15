// Module « Dictée » (1.2.4) : la dictée partout. Tout le travail se fait dans
// le Rust (src-tauri/src/modules/dictation.rs : la touche, l'écoute, le
// collage) et dans la pilule (pill.html, src/pill/main.ts). Ce module n'a pas
// d'onglet dans l'île : il porte l'interrupteur « Activé » (coupé par défaut)
// et les réglages, montrés dans Réglages → Voix → Dictée.

import manifest from "./manifest.json";
import type { IslandModule, ModuleManifest } from "../../core/module-types";

export const dictation: IslandModule = {
  manifest: manifest as ModuleManifest,
  views: {},
};
