import { Bridge, type PhoneInfo, type PhoneSetup } from "../core/bridge";
import { errorText } from "../core/log";
import { el } from "../island/dom";
import { chip, group, wideRow } from "./controls";

// Réglages → Téléphones. Chaque téléphone a sa propre autorité HTTPS
// (src-tauri/src/services/phone_tls.rs) : le révoquer efface sa clé, et Ondine
// ne peut plus jamais produire un certificat que ce téléphone accepte. Les
// autres téléphones ne sont pas touchés. Aucune application compagnon.

/** 1760000000 (secondes) → « 09/10/2026 ». */
function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("fr-FR");
}

function fingerprintText(fingerprint: string): string {
  return fingerprint.match(/.{1,2}/g)?.join(":") ?? fingerprint;
}

/** Le QR code et le mode d'emploi pour installer le certificat d'un téléphone. */
function guide(setup: PhoneSetup): HTMLElement[] {
  return [
    el("img", { src: setup.qr, alt: "QR code", class: "certificate-qr" }),
    el("p", {}, "1. Scannez ce QR code avec le téléphone pour télécharger le certificat public. Le lien dure trois minutes."),
    el("p", {}, "2. Comparez le nom et l'empreinte ci-dessous avec les détails du certificat sur le téléphone. S'ils diffèrent, n'installez pas le certificat."),
    el("strong", { "data-no-i18n": "" }, setup.name),
    el("code", { "data-no-i18n": "", class: "certificate-fingerprint" }, fingerprintText(setup.fingerprint)),
    el("p", {}, "Android : Réglages → Sécurité → Chiffrement et identifiants → Installer un certificat → Certificat CA. Les noms peuvent varier selon le téléphone."),
    el("p", {}, "iPhone : Réglages → Général → VPN et gestion de l'appareil, installez le profil téléchargé. Puis Général → Informations → Réglages des certificats : activez la confiance pour ce certificat Ondine."),
    el("p", {}, "Le profil iPhone doit contenir uniquement un certificat, aucun autre réglage."),
    el("p", {}, "3. Revenez dans l'Étagère ou les Contrôles et scannez le QR code HTTPS. N'ignorez jamais une alerte de certificat dans le navigateur."),
  ];
}

/** La page Réglages → Téléphones. */
export function phonesPage(main: HTMLElement) {
  const list = el("div", { class: "phone-list", "aria-live": "polite" });
  const notice = el("div", { class: "phone-notice", "aria-live": "polite" });
  const listGroup = group("Téléphones appairés", [wideRow(null, el("div", {}, notice, list))]);

  async function refresh() {
    try {
      const { phones } = await Bridge.phoneList();
      list.replaceChildren(...(phones.length ? phones.map(phoneCard) : [el("p", { class: "muted" }, "Aucun téléphone appairé pour l'instant. Ajoutez-en un ci-dessous.")]));
    } catch (error) {
      list.replaceChildren(el("p", { class: "muted" }, errorText(error)));
    }
  }

  function phoneCard(phone: PhoneInfo): HTMLElement {
    const result = el("div", { class: "phone-certificate-result", "aria-live": "polite" });
    const actions = el("div", { class: "phone-actions" });
    const show = el("button", { type: "button", class: "btn", onclick: async () => {
      show.disabled = true;
      result.textContent = "Chargement…";
      try {
        const setup = await Bridge.phoneCertificateSetup(phone.id);
        if (result.isConnected) result.replaceChildren(...guide(setup));
      } catch (error) { result.textContent = errorText(error); }
      finally { show.disabled = false; }
    } }, "Remontrer le QR code");
    const revoke = el("button", { type: "button", class: "btn danger", onclick: () => {
      // Deux temps : la révocation ne se défait pas.
      actions.replaceChildren(
        el("span", {}, "Révoquer ce téléphone ? Il ne pourra plus ouvrir les liens d'Ondine."),
        el("button", { type: "button", class: "btn danger", onclick: async () => {
          try {
            await Bridge.phoneRevoke(phone.id);
            notice.replaceChildren(
              el("p", {}, "Téléphone révoqué. Ondine ne peut plus rien lui montrer en HTTPS."),
              el("p", { class: "muted" }, "Retirez aussi le certificat de ce téléphone (Android : Chiffrement et identifiants → Identifiants de l'utilisateur ; iPhone : Général → VPN et gestion de l'appareil) :"),
              el("strong", { "data-no-i18n": "" }, phone.authority),
            );
          } catch (error) { notice.textContent = errorText(error); }
          void refresh();
        } }, "Révoquer"),
        el("button", { type: "button", class: "btn", onclick: () => void refresh() }, "Annuler"),
      );
    } }, "Révoquer");
    const use = el("button", { type: "button", class: "btn", onclick: async () => {
      try { await Bridge.phoneActivate(phone.id); } catch (error) { notice.textContent = errorText(error); }
      void refresh();
    } }, "Utiliser ce téléphone");
    actions.append(...(phone.active ? [] : [use]), show, revoke);
    const expired = Date.now() / 1000 >= phone.expires;
    return el("div", { class: "phone-card" },
      el("div", { class: "phone-head" },
        el("strong", { "data-no-i18n": "" }, phone.name),
        ...(phone.active ? [chip("Utilisé par l'Étagère et la télécommande", "ok")] : []),
        ...(expired ? [chip("Expiré", "warn")] : []),
      ),
      el("p", { class: "muted" }, `Préparé le ${day(phone.created)}`),
      el("p", { class: "muted" }, phone.installed ? `Certificat téléchargé le ${day(phone.installed)}` : "Certificat pas encore téléchargé"),
      el("p", { class: "muted" }, `Valable jusqu'au ${day(phone.expires)}`),
      el("code", { "data-no-i18n": "", class: "certificate-fingerprint" }, fingerprintText(phone.fingerprint)),
      actions,
      result,
    );
  }

  // ── Ajouter un téléphone ──
  const name = el("input", { type: "text", maxlength: "40", placeholder: "Nom du téléphone (par exemple : iPhone perso)", class: "phone-name" }) as HTMLInputElement;
  const added = el("div", { class: "phone-certificate-result", "aria-live": "polite" });
  const add = el("button", { type: "button", class: "btn", onclick: async () => {
    add.disabled = true;
    added.textContent = "Chargement…";
    try {
      const setup = await Bridge.phoneCertificateSetup(undefined, name.value);
      name.value = "";
      if (added.isConnected) added.replaceChildren(...guide(setup));
      void refresh();
    } catch (error) { added.textContent = errorText(error); }
    finally { add.disabled = false; }
  } }, "Ajouter un téléphone");

  main.append(
    group("Téléphone · HTTPS", [wideRow(null, el("div", {},
      el("p", {}, "Le partage de l'Étagère et la télécommande sont chiffrés. Chaque téléphone reçoit son propre certificat, à installer une fois pour utiliser son navigateur."),
      el("p", { class: "muted" }, "Ce certificat ne vaut que pour les adresses du réseau local : il ne peut servir pour aucun site d'Internet."),
    ))]),
    listGroup,
    group("Ajouter un téléphone", [wideRow(null, el("div", {}, name, add, added))]),
  );
  void refresh();
}
