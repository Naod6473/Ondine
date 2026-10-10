// Équipe : lire le QR code d'appairage d'un autre PC (1.2.3).
//
// Trois boutons dans « Ajouter un collègue » (le décodage est dans le Rust,
// team_qr.rs, hors ligne) :
//   - « Lire mon écran » : le QR visible sur cet écran (partage d'écran ou
//     Bureau à distance de l'autre PC, machine virtuelle, photo ouverte) ;
//   - « Coller l'image » : une capture du QR copiée (Ctrl+C) ;
//   - « Webcam » : on montre l'écran de l'autre PC à la caméra du portable.
//     Quelques images par seconde, réduites à 640 px et en niveaux de gris,
//     partent au Rust ; rien n'est gardé, la caméra s'éteint dès que le QR
//     est lu, qu'on ferme, ou au bout d'une minute.

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { bytesToBase64, frameSize, toGray, type PairQr } from "./logic";

/** Une image toutes les 400 ms ; la caméra s'arrête seule au bout d'une minute. */
const FRAME_EVERY_MS = 400;
const CAMERA_FOR_MS = 60_000;

/**
 * Les boutons et la zone de la webcam. `found` reçoit le QR lu ; `status`
 * affiche où on en est. Renvoie le nœud et de quoi tout arrêter (caméra comprise).
 */
export function qrReader(api: ModuleApi, found: (q: PairQr) => void, status: (text: string) => void): { node: HTMLElement; stop: () => void } {
  const cam = el("div", { class: "team-qr-cam", hidden: true });
  let stream: MediaStream | null = null;
  let timer = 0;
  let until = 0;
  let busy = false;

  const stopCamera = () => {
    window.clearInterval(timer);
    timer = 0;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    cam.hidden = true;
    cam.replaceChildren();
  };

  const scan = async (source: "screen" | "clipboard") => {
    stopCamera();
    status(source === "screen" ? "Recherche d'un QR code sur l'écran…" : "Lecture de l'image copiée…");
    try {
      const q = await api.invoke<PairQr | null>("qr_scan", { source });
      if (q) found(q);
      else status(source === "screen" ? "Aucun QR code d'Ondine à l'écran. Affichez-le en grand (partage d'écran, Bureau à distance…) puis réessayez." : "Aucun QR code d'Ondine dans l'image copiée.");
    } catch (err) {
      status(errorText(err));
    }
  };

  const camera = async () => {
    if (stream) return stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      status("Pas de webcam disponible ici.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch {
      status("Webcam indisponible ou refusée.");
      return;
    }
    const video = el("video", { class: "team-qr-video", muted: true, playsinline: true, "aria-label": "Webcam" }) as HTMLVideoElement;
    video.muted = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    cam.replaceChildren(video, el("small", { class: "muted" }, "Montrez le QR code de l'autre PC à la caméra."));
    cam.hidden = false;
    status("Webcam allumée : rien n'est enregistré.");
    until = Date.now() + CAMERA_FOR_MS;
    timer = window.setInterval(() => {
      if (Date.now() > until) {
        stopCamera();
        status("Webcam éteinte (une minute sans QR code lisible).");
        return;
      }
      if (busy || video.readyState < 2) return;
      const { w, h } = frameSize(video.videoWidth, video.videoHeight);
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const gray = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
      busy = true;
      api
        .invoke<PairQr | null>("qr_frame", { w, h, gray: bytesToBase64(gray) })
        .then((q) => {
          if (q && stream) {
            stopCamera();
            found(q);
          }
        })
        .catch(() => undefined)
        .finally(() => (busy = false));
    }, FRAME_EVERY_MS);
  };

  const node = el(
    "div",
    { class: "team-qr" },
    el("small", { class: "muted" }, "Ou lisez son QR code :"),
    el(
      "div",
      { class: "chips" },
      el("button", { class: "btn small", title: "Le QR code de l'autre PC est visible sur cet écran (partage d'écran, Bureau à distance, photo ouverte)", onclick: api.handler(() => scan("screen")) }, "🖥️ Lire mon écran"),
      el("button", { class: "btn small", title: "Une capture du QR code copiée (Ctrl+C)", onclick: api.handler(() => scan("clipboard")) }, "📋 Coller l'image"),
      el("button", { class: "btn small", title: "Montrer l'écran de l'autre PC à la webcam", onclick: api.handler(camera) }, "📷 Webcam"),
    ),
    cam,
  );
  return { node, stop: stopCamera };
}
