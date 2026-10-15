// Ouvre les réglages là où se télécharge le modèle Parakeet (1.2.4) : la page
// Parler à Ondine, sous-menu « Voix et sons ». La fenêtre de réglages existe
// souvent déjà (cachée) : elle lit « settings.goto » quand elle revient au
// premier plan (voir followGoto dans settings/main.ts, qui comprend
// « page#sous-menu »). Les pages Dictée et Notes d'appel peuvent passer la leur.

import { Bridge } from "../../core/bridge";

export const PARAKEET_PAGE = "module:askclaude#voice";

export function openParakeetSettings(target: string = PARAKEET_PAGE) {
  try {
    localStorage.setItem("settings.page", target.split("#")[0]);
    localStorage.setItem("settings.goto", target);
  } catch {
    // Stockage indisponible : les réglages s'ouvrent sur leur dernière page.
  }
  void Bridge.openSettingsWindow();
}
