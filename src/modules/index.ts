// La liste de tous les modules de l'île. AJOUTER UN MODULE = ajouter une ligne ici
// (et, s'il a du code Rust, une ligne dans src-tauri/src/modules/mod.rs).
// L'ordre ici est l'ordre des onglets dans l'île.

import type { IslandModule } from "../core/module-types";
import { agenda } from "./agenda";
import { capture } from "./capture";
import { clipboard } from "./clipboard";
import { controls } from "./controls";
import { launcher } from "./launcher";
import { media } from "./media";
import { notes } from "./notes";
import { pauses } from "./pauses";
import { rules } from "./rules";
import { shelf } from "./shelf";
import { system } from "./system";
import { remote } from "./remote";
import { nettools } from "./nettools";
import { agents } from "./agents";
import { askclaude } from "./askclaude";
import { terminal } from "./terminal";
import { timerModule } from "./timer";
import { weather } from "./weather";
import { weekly } from "./weekly";

export const ALL_MODULES: IslandModule[] = [shelf, clipboard, capture, timerModule, notes, agenda, terminal, system, remote, nettools, agents, askclaude, launcher, rules, media, controls, pauses, weather, weekly];
