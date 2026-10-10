// Contrôles → « Télécommande sur le téléphone » (réglage phoneRemote, désactivé
// par défaut) : un QR code ouvre, sur le téléphone, une petite page du réseau
// local pour la musique, le volume, un minuteur et les diapositives.
//
// Le Rust (src-tauri/src/modules/controls_remote.rs) ouvre le serveur ; ici,
// le panneau (QR code, adresse, « Arrêter ») qui remplace l'onglet tant que la
// télécommande tourne, et les notifications de "controls.remote" (téléphone
// connecté, arrêt après 10 minutes sans s'en servir).

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";

export interface RemoteSession {
  url: string;
  qr: string;
  paired: boolean;
  idleMinutes: number;
}

let session: RemoteSession | null = null;
const redraws = new Set<() => void>();
const redraw = () => redraws.forEach((r) => r());

export function remoteSession(): RemoteSession | null {
  return session;
}

/** Une vue qui se redessine quand la télécommande démarre ou s'arrête. */
export function onRemoteChange(fn: () => void): () => void {
  redraws.add(fn);
  return () => redraws.delete(fn);
}

export function wireRemote(api: ModuleApi): () => void {
  const off = api.on("controls.remote", (msg) => {
    const state = (msg.payload as { state?: string } | null)?.state;
    if (state === "paired") {
      if (session) session = { ...session, paired: true };
      api.notify({ title: "Téléphone connecté à la télécommande", icon: "📱", priority: "low", key: "controls-remote" });
    } else if (state === "expired" || state === "stopped") {
      if (state === "expired" && session) api.notify({ title: "Télécommande arrêtée (10 minutes sans s'en servir)", icon: "📱", priority: "low", key: "controls-remote" });
      session = null;
    }
    redraw();
  });
  // L'île se rouvre (ou a été rechargée) : la télécommande tourne peut-être encore.
  api
    .invoke<RemoteSession | null>("remote_status")
    .then((s) => {
      session = s;
      redraw();
    })
    .catch(() => {});
  return off;
}

export async function startRemote(api: ModuleApi) {
  try {
    session = await api.invoke<RemoteSession>("remote_start");
  } catch (err) {
    api.notify({ title: "Télécommande impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "controls-remote" });
  }
  redraw();
}

/** Le panneau de la télécommande en cours. */
export function remotePanel(api: ModuleApi, s: RemoteSession): HTMLElement {
  const stop = api.handler(async () => {
    session = null;
    redraw();
    try {
      await api.invoke("remote_stop");
    } catch {
      // déjà arrêtée
    }
  });
  return el(
    "div",
    // L'île grandit pour montrer le QR code en entier (src/island/fit.ts).
    { class: "phone ctl-remote", "data-island-fit": true },
    el("div", { class: "clip-qr-box phone-qr" }, el("img", { class: "clip-qr-img", src: s.qr, alt: "QR code", draggable: "false" })),
    el(
      "div",
      { class: "phone-side" },
      el("b", { class: "phone-title" }, "📱 Télécommande"),
      el(
        "p",
        { class: "phone-status" },
        s.paired ? el("b", {}, "Téléphone connecté.") : el("span", {}, "Scannez le QR code avec l'appareil photo du téléphone."),
      ),
      el("code", { class: "phone-url", title: "L'adresse, si le téléphone ne lit pas le QR code" }, s.url),
      el(
        "p",
        { class: "muted phone-note" },
        "Musique, volume, minuteur, diapositive suivante ou précédente. Un seul téléphone, sur le même Wi-Fi ; elle s'arrête toute seule après 10 minutes sans s'en servir.",
      ),
      el("div", { class: "btn-row phone-actions" }, el("button", { class: "btn small", title: "Fermer la télécommande tout de suite", onclick: stop }, "⏹ Arrêter")),
    ),
  );
}
