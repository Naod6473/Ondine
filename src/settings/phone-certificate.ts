import { Bridge } from "../core/bridge";
import { errorText } from "../core/log";
import { el } from "../island/dom";
import { group, wideRow } from "./controls";

/** Tout l'appairage est préparé ici ; aucune application compagnon. */
export function phoneCertificate(): HTMLElement {
  const result = el("div", { class: "phone-certificate-result", "aria-live": "polite" });
  const button = el("button", { type: "button", class: "btn", onclick: async () => {
    button.disabled = true;
    result.textContent = "Chargement…";
    try {
      const setup = await Bridge.phoneCertificateSetup();
      if (!result.isConnected) return;
      result.replaceChildren(
        el("img", { src: setup.qr, alt: "QR code", class: "certificate-qr" }),
        el("p", {}, "1. Scannez ce QR code pour télécharger le certificat public. Le lien dure trois minutes."),
        el("p", {}, "2. Comparez le nom et l'empreinte ci-dessous avec les détails du certificat sur le téléphone. S'ils diffèrent, n'installez pas le certificat."),
        el("strong", { "data-no-i18n": "" }, setup.name),
        el("code", { "data-no-i18n": "", class: "certificate-fingerprint" }, setup.fingerprint.match(/.{1,2}/g)?.join(":") ?? setup.fingerprint),
        el("p", {}, "Android : Réglages → Sécurité → Chiffrement et identifiants → Installer un certificat → Certificat CA. Les noms peuvent varier selon le téléphone."),
        el("p", {}, "iPhone : Réglages → Général → VPN et gestion de l'appareil, installez le profil téléchargé. Puis Général → Informations → Réglages des certificats : activez la confiance pour ce certificat Ondine."),
        el("p", {}, "Le profil iPhone doit contenir uniquement un certificat, aucun autre réglage."),
        el("p", {}, "3. Revenez dans l'Étagère ou les Contrôles et scannez le QR code HTTPS. N'ignorez jamais une alerte de certificat dans le navigateur."),
        el("p", { class: "muted" }, "Ce certificat ne vaut que pour les adresses du réseau local : il ne peut servir pour aucun site d'Internet."),
        el("p", { class: "muted" }, "Ce certificat donne confiance à ce PC sur le téléphone. Retirez-le des réglages du téléphone si vous n'utilisez plus Ondine ou si le PC est compromis."),
      );
    } catch (error) { result.textContent = errorText(error); }
    finally { button.disabled = false; }
  } }, "Préparer mon téléphone");
  return group("Téléphone · HTTPS", [wideRow(null, el("div", {},
    el("p", {}, "Le partage et la télécommande sont chiffrés. Installez une fois le certificat de ce PC sur le téléphone pour utiliser son navigateur."), button, result))]);
}
