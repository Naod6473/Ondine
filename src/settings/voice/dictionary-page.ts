// Page « Dictionnaire » du groupe Voix des Réglages (1.2.4). Version de départ :
// la branche qui en a la charge la dessine (bande du haut avec hero()).

import { el } from "../../island/dom";
import { hero } from "../hero";
import type { VoicePage } from "./pages";

export const dictionaryPage: VoicePage = {
  id: "voice:dictionary",
  label: "Dictionnaire",
  color: "#ffc25a",
  module: "dictation",
  render(root) {
    root.append(hero({ title: "Dictionnaire", color: "#ffc25a" }), el("p", { class: "muted" }, "Bientôt."));
  },
};
