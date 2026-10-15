// Le bloc « Parakeet sur le PC » des Réglages (1.2.4), réutilisable : la page
// Parler à Ondine (sous-menu Voix et sons) l'affiche ; les pages Dictée et
// Notes d'appel l'ajoutent avec `parakeetBlock()`.
//
// L'état vient du Rust (services/speech.rs : commande `speech_status`, puis
// l'événement « speech-models » à chaque progrès). Un seul écouteur pour
// toutes les copies du bloc ; une copie retirée de la page n'est plus mise à
// jour. Rien n'est téléchargé avant le clic sur « Télécharger ».

import { Bridge, onTauriEvent, type SpeechStatus } from "../../core/bridge";
import { errorText } from "../../core/log";
import { el } from "../../island/dom";
import { chip, group, row } from "../controls";
import { parakeetView, type ParakeetAction } from "./parakeet-logic";

/** Les copies affichées du bloc (une fonction qui les redessine). */
const mounted = new Set<{ node: HTMLElement; draw: (s: SpeechStatus | null) => void }>();
let listening = false;
let last: SpeechStatus | null = null;

function broadcast(s: SpeechStatus | null) {
  last = s;
  for (const m of [...mounted]) {
    // Une copie qui a été dans la page et n'y est plus : oubliée.
    if (m.node.isConnected) m.node.dataset.seen = "1";
    else if (m.node.dataset.seen) {
      mounted.delete(m);
      continue;
    }
    m.draw(s);
  }
}

function listen() {
  if (listening) return;
  listening = true;
  void onTauriEvent<SpeechStatus>("speech-models", broadcast);
}

const LABELS: Record<ParakeetAction, string> = {
  download: "Télécharger",
  retry: "Réessayer",
  cancel: "Annuler",
  remove: "Supprimer",
};

/** Le bloc, prêt à être posé dans une page (`inSub` au besoin). */
export function parakeetBlock(): HTMLElement {
  const state = chip("…");
  const detail = el("div", { class: "row-help" });
  const error = el("div", { class: "row-help", "data-no-i18n": "", hidden: true });
  const bar = el("progress", { max: "100", value: "0", hidden: true, "aria-label": "Téléchargement du modèle" }) as HTMLProgressElement;
  const buttons = el("div", { class: "btn-row" });
  const message = el("div", { class: "row-help", hidden: true });
  /** « Supprimer » demande une confirmation (un 2e clic dans les 4 s). */
  let confirmUntil = 0;

  const act = async (a: ParakeetAction) => {
    message.hidden = true;
    try {
      if (a === "remove" && Date.now() > confirmUntil) {
        confirmUntil = Date.now() + 4000;
        draw(last);
        window.setTimeout(() => draw(last), 4100);
        return;
      }
      confirmUntil = 0;
      const next = a === "cancel" ? await Bridge.speechCancel() : a === "remove" ? await Bridge.speechRemove() : await Bridge.speechDownload();
      broadcast(next);
    } catch (err) {
      message.textContent = errorText(err);
      message.hidden = false;
    }
  };

  const draw = (s: SpeechStatus | null) => {
    const v = parakeetView(s);
    state.textContent = v.title;
    state.className = `chip ${s?.state === "ready" ? "ok" : s?.state === "failed" ? "warn" : ""}`;
    detail.textContent = v.detail;
    error.textContent = v.error ?? "";
    error.hidden = !v.error;
    bar.hidden = v.percent === null;
    bar.value = v.percent ?? 0;
    const confirming = Date.now() <= confirmUntil;
    buttons.replaceChildren(
      ...v.actions.map((a) =>
        el(
          "button",
          { type: "button", class: `btn small ${a === "remove" ? "danger" : a === "download" || a === "retry" ? "primary" : ""}`, onclick: () => void act(a) },
          a === "remove" && confirming ? "Confirmer la suppression" : LABELS[a],
        ),
      ),
    );
  };

  const node = group(
    "Parakeet sur le PC",
    [
      row("Modèle de reconnaissance", el("div", { class: "parakeet-state" }, state), "Parakeet de NVIDIA écrit ce que vous dites, en 25 langues, directement sur le PC.", "Parakeet sur le PC"),
      el("div", { class: "row wide", "data-key": "Télécharger le modèle Parakeet" }, el("div", { class: "row-wide" }, detail, bar, error, buttons, message)),
    ],
    "Tout se fait sur le PC : rien de ce que vous dites n'est envoyé. Le modèle (environ 700 Mo) est téléchargé une seule fois, à votre clic, puis vérifié. Modèle Parakeet de NVIDIA (licence CC-BY-4.0), moteur sherpa-onnx (Apache-2.0).",
  );
  node.classList.add("parakeet-block");

  mounted.add({ node, draw });
  listen();
  draw(last);
  void Bridge.speechStatus().then(broadcast);
  return node;
}
