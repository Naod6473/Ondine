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
import { team } from "./team";
import { remote } from "./remote";
import { nettools } from "./nettools";
import { agents } from "./agents";
import { askclaude } from "./askclaude";
import { terminal } from "./terminal";
import { timerModule } from "./timer";
import { weather } from "./weather";
import { weekly } from "./weekly";
import { halos } from "./halos";
import { windowlife } from "./windowlife";

// « Parler à Ondine » (askclaude) en premier : c'est le premier onglet au premier lancement.
export const ALL_MODULES: IslandModule[] = [askclaude, shelf, clipboard, capture, timerModule, notes, agenda, terminal, system, remote, nettools, team, agents, launcher, rules, media, controls, pauses, weather, weekly, halos, windowlife];

