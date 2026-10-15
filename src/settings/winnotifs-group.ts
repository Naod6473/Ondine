// Réglages → Notifications de Windows : l'accès que Windows donne (ou pas) à
// Ondine, avec le bouton qui ouvre la bonne page des Paramètres de Windows
// (ms-settings:privacy-notifications). Le module, lui, est dans
// src/modules/winnotifs/ et src-tauri/src/modules/winnotifs.rs.
//
// Pas d'abonnement au bus ici (la page est redessinée à chaque visite) :
// l'état est redemandé au Rust à l'affichage et après « Vérifier de nouveau ».

import { Bridge } from "../core/bridge";
import { errorText } from "../core/log";
import { settingsStore } from "../core/settings-store";
import { el } from "../island/dom";
import { needsWindowsSettings, parseStatus, statusText } from "../modules/winnotifs/logic";
import { group, row } from "./controls";

const ID = "winnotifs";

export function winnotifsGroup(): HTMLElement {
  const text = el("span", { class: "muted", "aria-live": "polite" }, "");
  const buttons = el("div", { class: "chips" });
  const removeNote = el("p", { class: "muted" }, "");
  removeNote.hidden = true;

  const openWindows = el(
    "button",
    {
      class: "btn small",
      onclick: () => void Bridge.moduleInvoke(ID, "open_settings", null).catch((e: unknown) => (text.textContent = errorText(e))),
    },
    "Ouvrir les réglages de Windows",
  );
  const again = el(
    "button",
    {
      class: "btn small",
      onclick: () => {
        void Bridge.moduleInvoke(ID, "recheck", null)
          .then(() => window.setTimeout(refresh, 1500))
          .catch((e: unknown) => (text.textContent = errorText(e)));
      },
    },
    "Vérifier de nouveau",
  );

  function refresh() {
    if (!settingsStore.moduleEnabled(ID)) {
      text.textContent = "Activez le module : Ondine demandera alors l'accès à Windows.";
      buttons.replaceChildren();
      removeNote.hidden = true;
      return;
    }
    void Bridge.moduleInvoke(ID, "status", null)
      .then((raw) => {
        const s = parseStatus(raw);
        text.textContent = statusText(s);
        buttons.replaceChildren(...(needsWindowsSettings(s) ? [openWindows, again] : s?.state === "unavailable" || s?.state === "starting" ? [again] : []));
        removeNote.hidden = s?.remove !== "refused";
      })
      .catch((e: unknown) => (text.textContent = errorText(e)));
  }
  removeNote.textContent = "Windows ne laisse pas Ondine retirer les notifications du Centre de notifications : elles y restent.";
  refresh();

  return group("Accès de Windows", [
    row(
      "Autorisation",
      el("div", {}, text, buttons),
      "Windows décide si une appli peut lire vos notifications (Paramètres, Confidentialité, Notifications). Ondine ne lit que les nouvelles, et n'en garde aucune sur le disque.",
    ),
    removeNote,
  ]);
}
