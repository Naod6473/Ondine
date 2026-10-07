// « Vers le téléphone » (Étagère) : envoyer un fichier de l'étagère à un
// téléphone du même Wi-Fi.
//
// Le Rust (src-tauri/src/modules/shelf_phone.rs) ouvre un petit serveur web
// sur le réseau local, qui sert CE fichier à une adresse secrète, une seule
// fois, 5 minutes au plus. Ici : le panneau du partage en cours, avec le QR
// code de l'adresse (même dessin que le QR code du Presse-papiers), l'adresse
// en texte, le compte à rebours et « Arrêter ». La fin (« le téléphone l'a
// reçu », « lien expiré ») arrive par le sujet « shelf.phone ».

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { clock, sizeText } from "./phone-text";

/** Ce que le Rust renvoie en ouvrant le partage. */
interface PhoneShare {
  /** Numéro du partage : la fin d'un ANCIEN partage est ignorée. */
  id: number;
  url: string;
  /** Le QR code de l'adresse (SVG, data URL). */
  qr: string;
  name: string;
  size: number;
  /** Secondes avant que le lien expire. */
  seconds: number;
}

/** Le partage affiché, avec l'heure de fin (horloge du front). */
let shown: (PhoneShare & { until: number; sending: boolean }) | null = null;
/** Redessine la vue de l'Étagère (donnée par index.ts). */
let redraw: () => void = () => {};

/** Un partage est-il en cours (le panneau remplace alors la liste) ? */
export function phoneShown(): boolean {
  return shown !== null;
}

function show(s: PhoneShare) {
  shown = { ...s, until: Date.now() + s.seconds * 1000, sending: false };
  redraw();
}

/** À appeler une fois, dans setup() de l'Étagère. */
export function setupPhone(api: ModuleApi, redrawShelf: () => void) {
  redraw = redrawShelf;
  api.on("shelf.phone", (msg) => {
    const p = msg.payload as { id?: number; state?: string } | null;
    if (!shown || p?.id !== shown.id) return;
    if (p.state === "sending") {
      shown.sending = true;
      redraw();
      return;
    }
    const name = shown.name;
    shown = null;
    redraw();
    if (p.state === "done") {
      api.notify({ title: "Le téléphone a reçu le fichier", body: name, icon: "📱", priority: "normal", key: "shelf-phone" });
    } else if (p.state === "expired") {
      api.notify({ title: "Lien vers le téléphone expiré", body: name, icon: "📱", priority: "low", key: "shelf-phone" });
    }
  });
  // L'île a redémarré pendant un partage : on le retrouve.
  api
    .invoke<PhoneShare | null>("phone_status")
    .then((s) => s && show(s))
    .catch(() => {}); // hors de l'appli (navigateur)
}

/** « Vers le téléphone » sur un fichier de l'étagère. */
export async function startPhone(api: ModuleApi, path: string) {
  try {
    const s = await api.invoke<PhoneShare | null>("phone_share", { path });
    if (s) show(s);
  } catch (err) {
    api.log.warn(`vers le téléphone : ${errorText(err)}`);
    api.notify({ title: "Envoi vers le téléphone impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "shelf-phone" });
  }
}

/** Le panneau du partage en cours (null s'il n'y en a pas). */
export function phonePanel(api: ModuleApi): HTMLElement | null {
  const s = shown;
  if (!s) return null;
  const stop = api.handler(async () => {
    shown = null;
    redraw();
    try {
      await api.invoke("phone_stop");
    } catch {
      // déjà arrêté
    }
  });
  const count = el("span", { class: "phone-count" });
  const status = el("p", { class: "phone-status" });
  let said = "";
  const tick = () => {
    const left = s.until - Date.now();
    // Seulement des chiffres, réécrits chaque seconde.
    count.textContent = clock(left);
    // La phrase ne change que rarement : on ne la réécrit que si besoin.
    const now = s.sending ? "sending" : left > 0 ? "wait" : "late";
    if (now === said) return;
    said = now;
    status.replaceChildren(
      now === "sending"
        ? el("b", {}, "Le téléphone télécharge…")
        : now === "wait"
          ? el("span", {}, "Scannez le QR code avec l'appareil photo du téléphone.")
          : el("span", {}, "Le lien a expiré."),
    );
  };
  tick();
  const timer = window.setInterval(() => {
    // Le panneau a été retiré (partage fini, autre onglet) : on arrête.
    if (!panel.isConnected) return window.clearInterval(timer);
    tick();
  }, 1000);

  const url = el("code", { class: "phone-url", title: "L'adresse, si le téléphone ne lit pas le QR code" }, s.url);
  const panel = el(
    "div",
    { class: "phone" },
    el("div", { class: "clip-qr-box phone-qr" }, el("img", { class: "clip-qr-img", src: s.qr, alt: "QR code", draggable: "false" })),
    el(
      "div",
      { class: "phone-side" },
      el("b", { class: "phone-title" }, "📱 Vers le téléphone"),
      el(
        "p",
        { class: "phone-file" },
        el("span", { class: "phone-name", "data-no-i18n": true }, s.name),
        el("span", { class: "muted" }, " · "),
        el("span", { class: "muted phone-size" }, sizeText(s.size)),
      ),
      status,
      url,
      el(
        "p",
        { class: "muted phone-note" },
        "Le téléphone doit être sur le même Wi-Fi que le PC. La première fois, Windows peut demander d'autoriser Ondine sur les réseaux privés : acceptez, sinon le téléphone ne trouvera pas le PC.",
      ),
      el(
        "div",
        { class: "btn-row phone-actions" },
        el("button", { class: "btn small", title: "Fermer le partage tout de suite", onclick: stop }, "⏹ Arrêter"),
        el("span", { class: "muted" }, "Expire dans "),
        count,
      ),
    ),
  );
  return panel;
}
