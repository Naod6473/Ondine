// La liste de tous les modules de l'île. AJOUTER UN MODULE = ajouter une ligne ici
// (et, s'il a du code Rust, une ligne dans src-tauri/src/modules/mod.rs).
// L'ordre ici est l'ordre des onglets dans l'île.

import type { IslandModule } from "../core/module-types";
import { agenda } from "./agenda";
import { callnotes } from "./callnotes";
import { convert } from "./convert";
import { capture } from "./capture";
import { clipboard } from "./clipboard";
import { controls } from "./controls";
import { launcher } from "./launcher";
import { media } from "./media";
import { notes } from "./notes";
import { pauses } from "./pauses";
import { games } from "./games";
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
import { home } from "./home";
import { windowlife } from "./windowlife";
import { winnotifs } from "./winnotifs";
import { screensaver } from "./screensaver";
import { dictation } from "./dictation";
import { homeassistant } from "./homeassistant";

// L'Accueil (home) en premier, puis « Parler à Ondine » (askclaude) : les deux
// premiers onglets au premier lancement. Pour une île déjà rangée, l'Accueil
// se met en tête sans bousculer le reste (LEAD_TABS, src/core/tab-order.ts).
// Notes d'appel juste après (ni l'un ni l'autre n'a de vue compacte) : la
// sienne, le point rouge de l'enregistrement, passe avant celle des autres.
// Il n'a pas d'onglet.
export const ALL_MODULES: IslandModule[] = [home, askclaude, callnotes, convert, shelf, clipboard, capture, timerModule, notes, agenda, terminal, system, remote, nettools, team, agents, launcher, rules, media, controls, homeassistant, winnotifs, pauses, games, weather, weekly, halos, windowlife, screensaver, dictation];

