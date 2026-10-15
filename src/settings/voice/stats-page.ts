// Page « Statistiques » du groupe Voix des Réglages (1.2.4). Version de départ :
// la branche qui en a la charge la dessine (bande du haut avec hero()).

import { el } from "../../island/dom";
import { hero } from "../hero";
import type { VoicePage } from "./pages";

export const statsPage: VoicePage = {
  id: "voice:stats",
  label: "Statistiques",
  color: "#4cd98b",
  module: "dictation",
  render(root) {
    root.append(hero({ title: "Statistiques", color: "#4cd98b" }), el("p", { class: "muted" }, "Bientôt."));
  },
};
