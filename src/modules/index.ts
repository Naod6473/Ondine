// La liste de tous les modules de l'île. AJOUTER UN MODULE = ajouter une ligne ici
// (et, s'il a du code Rust, une ligne dans src-tauri/src/modules/mod.rs).
// L'ordre ici est l'ordre des onglets dans l'île.

import type { IslandModule } from "../core/module-types";
import { agenda } from "./agenda";
import { capture } from "./capture";
import { clipboard } from "./clipboard";
import { hello } from "./hello";
import { launcher } from "./launcher";
import { media } from "./media";
import { notes } from "./notes";
import { rules } from "./rules";
import { shelf } from "./shelf";
import { terminal } from "./terminal";
import { timerModule } from "./timer";

export const ALL_MODULES: IslandModule[] = [shelf, clipboard, capture, timerModule, notes, agenda, terminal, launcher, rules, media, hello];
