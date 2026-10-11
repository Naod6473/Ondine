import { Bridge } from "../core/bridge";

/** Ouvre les réglages directement sur la page Téléphones, où se prépare le
 *  téléphone. La fenêtre de réglages existe souvent déjà (cachée) : elle lit
 *  « settings.goto » quand elle revient au premier plan (voir settings/main.ts). */
export function openPhoneSetup() {
  try {
    localStorage.setItem("settings.page", "phones");
    localStorage.setItem("settings.goto", "phones");
  } catch {
    // Stockage indisponible : les réglages s'ouvrent sur leur dernière page.
  }
  void Bridge.openSettingsWindow();
}
