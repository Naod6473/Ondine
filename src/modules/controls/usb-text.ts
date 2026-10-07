// Les textes des clés USB (onglet Contrôles) : quel nom montrer, et que dire
// après une éjection. Sans DOM ni Tauri, pour les tests (tests/front/usb.test.ts).

/** Une clé ou un disque USB, tel que le Rust le décrit (commande `usb_drives`). */
export interface UsbDrive {
  /** « E:\ » */
  root: string;
  /** « E: » */
  letter: string;
  /** Le nom du volume (« KINGSTON »), vide s'il n'en a pas. */
  label: string;
  /** true : clé USB, carte SD ; false : disque USB (Windows le dit « fixe »). */
  removable: boolean;
  /** Une éjection est en cours. */
  ejecting?: boolean;
}

/** Le résultat d'une éjection (sujet `controls.usb-ejected`, voir controls.rs). */
export interface EjectResult extends UsbDrive {
  ok: boolean;
  /** Le type de refus de Windows (PNP_VETO_TYPE). */
  veto?: number;
  /** Le programme (ou le service) qui bloque, quand Windows l'a dit. */
  blocker?: { name: string; service: boolean } | null;
  error?: "gone" | "not-removable" | "failed";
  /** Le code d'erreur de Windows (error = "failed"). */
  code?: number;
}

/** Les types de refus de Windows (PNP_VETO_TYPE) qui ont leur propre message. */
const VETO = {
  legacyDevice: 1,
  device: 6,
  driver: 7,
  illegalRequest: 8,
  nonDisableable: 10,
  legacyDriver: 11,
  rights: 12,
} as const;

/** Le nom à montrer : « KINGSTON », ou « Clé USB » / « Disque USB » sans nom de volume. */
export function driveName(d: Pick<UsbDrive, "label" | "removable">): string {
  return d.label.trim() || (d.removable ? "Clé USB" : "Disque USB");
}

/** Le titre de la notification « branchée » : « Clé USB branchée : KINGSTON (E:) ». */
export function pluggedTitle(d: UsbDrive): string {
  const name = d.label.trim();
  if (d.removable) return name ? `Clé USB branchée : ${name} (${d.letter})` : `Clé USB branchée (${d.letter})`;
  return name ? `Disque USB branché : ${name} (${d.letter})` : `Disque USB branché (${d.letter})`;
}

/** Le message après une éjection : titre, détail, réussie ou non. */
export function ejectMessage(r: EjectResult): { title: string; body?: string; ok: boolean } {
  if (r.ok) {
    return {
      ok: true,
      title: r.removable ? `Vous pouvez retirer la clé ${r.letter} en toute sécurité.` : `Vous pouvez retirer le disque ${r.letter} en toute sécurité.`,
    };
  }
  const title = r.removable ? `La clé ${r.letter} n'est pas éjectée` : `Le disque ${r.letter} n'est pas éjecté`;
  return { ok: false, title, body: refusalReason(r) };
}

/** Pourquoi Windows refuse, le plus précisément possible. */
function refusalReason(r: EjectResult): string {
  if (r.error === "gone") return "Le lecteur n'est plus visible : il a peut-être déjà été retiré.";
  if (r.error === "not-removable") return "Windows ne propose pas de retirer ce lecteur en toute sécurité.";
  if (r.error === "failed") return `Windows refuse l'éjection (code ${r.code ?? 0}). Réessayez dans un moment.`;

  // Un refus (« veto ») : le programme qui bloque, si on le connaît (événement 225).
  const who = r.blocker?.name?.trim();
  if (who && r.blocker?.service) return `Le service « ${who} » utilise encore ce lecteur. Réessayez dans un moment.`;
  if (who && who.toLowerCase() === "explorer.exe") return "L'Explorateur de fichiers utilise encore ce lecteur. Fermez ses fenêtres puis réessayez.";
  if (who) return `« ${who} » utilise encore ce lecteur. Fermez-le puis réessayez.`;

  // Sinon, le genre de refus.
  switch (r.veto) {
    case VETO.device:
    case VETO.driver:
    case VETO.legacyDevice:
    case VETO.legacyDriver:
      return "Un pilote ou un autre périphérique bloque l'éjection. Réessayez dans un moment.";
    case VETO.rights:
      return "Windows demande des droits d'administrateur pour éjecter ce lecteur.";
    case VETO.illegalRequest:
    case VETO.nonDisableable:
      return "Windows ne permet pas d'éjecter ce lecteur.";
    default:
      // Fichier ouvert, programme inconnu… le cas le plus courant.
      return r.removable ? "Un programme utilise encore la clé. Fermez-le puis réessayez." : "Un programme utilise encore le disque. Fermez-le puis réessayez.";
  }
}
