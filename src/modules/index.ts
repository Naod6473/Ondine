// La liste de tous les modules de l'île. AJOUTER UN MODULE = ajouter une ligne ici
// (et, s'il a du code Rust, une ligne dans src-tauri/src/modules/mod.rs).
// L'ordre ici est l'ordre des onglets dans l'île.

import type { IslandModule } from "../core/module-types";
import { hello } from "./hello";
import { media } from "./media";
import { shelf } from "./shelf";

export const ALL_MODULES: IslandModule[] = [shelf, media, hello];
