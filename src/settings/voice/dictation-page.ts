// Page « Dictée » du groupe Voix des Réglages (1.2.4). Version de départ :
// la branche qui en a la charge la dessine (bande du haut avec hero()).

import { el } from "../../island/dom";
import { hero } from "../hero";
import type { VoicePage } from "./pages";

export const dictationPage: VoicePage = {
  id: "voice:dictation",
  label: "Dictée",
  color: "#5fd4e6",
  module: "dictation",
  render(root) {
    root.append(hero({ title: "Dictée", color: "#5fd4e6" }), el("p", { class: "muted" }, "Bientôt."));
  },
};
