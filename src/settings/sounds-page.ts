// Réglages → Apparence → Sons : vos propres sons (1.2.4). « Ouvrir le dossier
// des sons » (créé s'il manque), « Recharger les sons » (ici pour
// « Essayer », et dans l'île par l'événement « sounds.reload »), et la liste
// des noms possibles. Le Rust : src-tauri/src/services/custom_sounds.rs.

import { Bridge } from "../core/bridge";
import { errorText } from "../core/log";
import { loadCustomSounds } from "../island/custom-sounds";
import { el } from "../island/dom";
import { CUSTOM_NAMES } from "../island/sounds";
import { row, wideRow } from "./controls";

/** La phrase d'état : quels sons sont remplacés. */
export function replacedText(names: string[]): string {
  if (!names.length) return "Aucun son remplacé pour l'instant.";
  return `${names.length} son${names.length > 1 ? "s" : ""} remplacé${names.length > 1 ? "s" : ""} : ${names.join(", ")}`;
}

/** Les lignes du groupe Sons. `reload` prévient l'île. */
export function customSoundRows(reload: () => void): HTMLElement[] {
  const state = el("p", { class: "muted" }, "…");
  const refresh = () =>
    loadCustomSounds().then(
      (names) => (state.textContent = replacedText(names)),
      (err: unknown) => (state.textContent = errorText(err)),
    );
  void refresh();
  const open = el("button", { class: "btn small" }, "Ouvrir le dossier des sons");
  open.addEventListener("click", () => void Bridge.soundsOpenFolder().catch((err: unknown) => (state.textContent = errorText(err))));
  const again = el("button", { class: "btn small" }, "Recharger les sons");
  again.addEventListener("click", () => {
    reload();
    void refresh();
  });
  return [
    row(
      "Vos propres sons",
      el("div", { class: "btn-row" }, open, again),
      "Un fichier .wav, .mp3, .ogg ou .m4a de 2 Mo au plus, nommé comme un son ci-dessous (par exemple tap.wav), remplace ce son. Un fichier invalide est ignoré : le son d'origine reste. Rien ne quitte le PC.",
    ),
    wideRow("Noms possibles", el("div", {}, el("p", { "data-no-i18n": "" }, el("code", {}, CUSTOM_NAMES.join(" · "))), state)),
  ];
}
