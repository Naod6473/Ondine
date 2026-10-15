// Les pages du groupe « Voix » des Réglages (1.2.4). Chaque page vit dans son
// fichier, dessinée par la branche qui en a la charge ; la branche « fenêtre »
// les range dans la barre latérale (groupe Voix, en premier).

import { callnotesPage } from "./callnotes-page";
import { dictationPage } from "./dictation-page";
import { dictionaryPage } from "./dictionary-page";
import { statsPage } from "./stats-page";
import { stylesPage } from "./styles-page";

export interface VoicePage {
  /** Id de la page dans les Réglages (« voice:… »). */
  id: string;
  /** Le nom dans la barre latérale. */
  label: string;
  /** La couleur de la page (bande du haut, point de la barre). */
  color: string;
  /** Le module que la page suit (son point « désactivé »), s'il y en a un. */
  module?: string;
  /** Dessine la page dans `root` ; renvoie de quoi tout arrêter en la quittant. */
  render(root: HTMLElement): void | (() => void);
}

export const VOICE_PAGES: VoicePage[] = [dictationPage, callnotesPage, statsPage, dictionaryPage, stylesPage];
