// Page « Styles » du groupe Voix des Réglages (1.2.4). Version de départ :
// la branche qui en a la charge la dessine (bande du haut avec hero()).

import { el } from "../../island/dom";
import { hero } from "../hero";
import type { VoicePage } from "./pages";

export const stylesPage: VoicePage = {
  id: "voice:styles",
  label: "Styles",
  color: "#f28bd2",
  module: "dictation",
  render(root) {
    root.append(hero({ title: "Styles", color: "#f28bd2" }), el("p", { class: "muted" }, "Bientôt."));
  },
};
