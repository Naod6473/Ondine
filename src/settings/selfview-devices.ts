// Réglages → Agenda → Avant une réunion : la caméra et le micro préférés de
// l'aperçu « Se voir » (src/modules/agenda/selfview.ts), dans deux menus en
// verre. On garde le NOM de l'appareil (l'identifiant de la page peut
// changer). La liste vient de la page (navigator.mediaDevices) : les noms
// n'y sont qu'une fois l'autorisation donnée à Ondine, au premier aperçu ;
// avant, seul « par défaut » (et le choix déjà fait) est proposé, avec un mot.
// Logique sans page : src/modules/agenda/selfview-logic.ts.

import { el } from "../island/dom";
import { deviceOptions, type Device } from "../modules/agenda/selfview-logic";
import { row, select } from "./controls";

type Pick = (key: string, value: unknown) => void;

/** Les deux lignes (et la note), ajoutées au sous-menu « Avant une réunion » de la page Agenda. */
export function selfViewDeviceRows(values: Record<string, unknown>, pick: Pick): HTMLElement[] {
  const camBox = el("div", { class: "selfview-choice" });
  const micBox = el("div", { class: "selfview-choice" });
  const note = el("div", { class: "row-help", hidden: true });
  const draw = (list: Device[]) => {
    const cam = String(values.mirrorCamera ?? "");
    const mic = String(values.mirrorMic ?? "");
    const c = select(cam, deviceOptions(list, "videoinput", cam), (v) => pick("mirrorCamera", v));
    const m = select(mic, deviceOptions(list, "audioinput", mic), (v) => pick("mirrorMic", v));
    c.setAttribute("aria-label", "Caméra préférée");
    m.setAttribute("aria-label", "Micro préféré");
    camBox.replaceChildren(c);
    micBox.replaceChildren(m);
    const named = list.some((d) => d.label && (d.kind === "videoinput" || d.kind === "audioinput"));
    note.textContent = named ? "" : "La liste des caméras et des micros apparaît après un premier « Se voir » (Windows demande alors l'autorisation).";
    note.hidden = named;
  };
  draw([]);
  void navigator.mediaDevices
    ?.enumerateDevices?.()
    .then((list) => draw(list.map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }))))
    .catch(() => undefined);
  const camRow = row("Caméra préférée", camBox, "Celle de l'aperçu « Se voir ». Débranchée : celle par défaut.");
  const micRow = row("Micro préféré", micBox, "Celui de la jauge de l'aperçu. Débranché : celui par défaut.");
  // Pastille « Modifié » et « Réinitialiser » comme les lignes générées (modified.ts).
  camRow.dataset.field = "agenda.mirrorCamera";
  micRow.dataset.field = "agenda.mirrorMic";
  // Le mot sur la liste vide va avec la ligne de la caméra (caché avec elle en mode Simple).
  camRow.querySelector(".row-text")?.append(note);
  return [camRow, micRow];
}
