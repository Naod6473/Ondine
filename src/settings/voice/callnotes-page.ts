// Page « Notes d'appel » du groupe Voix des Réglages (1.2.4). Version de départ :
// la branche qui en a la charge la dessine (bande du haut avec hero()).

import { el } from "../../island/dom";
import { hero } from "../hero";
import type { VoicePage } from "./pages";

export const callnotesPage: VoicePage = {
  id: "voice:callnotes",
  label: "Notes d'appel",
  color: "#ff8a6b",
  module: "callnotes",
  render(root) {
    root.append(hero({ title: "Notes d'appel", color: "#ff8a6b" }), el("p", { class: "muted" }, "Bientôt."));
  },
};
