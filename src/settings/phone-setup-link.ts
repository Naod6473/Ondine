import { Bridge } from "../core/bridge";

/** Ouvre les réglages directement sur Confidentialité, où se prépare le
 *  téléphone (la fenêtre de réglages relit cette page à son ouverture). */
export function openPhoneSetup() {
  try {
    localStorage.setItem("settings.page", "privacy");
  } catch {
    // Stockage indisponible : les réglages s'ouvrent sur leur dernière page.
  }
  void Bridge.openSettingsWindow();
}
