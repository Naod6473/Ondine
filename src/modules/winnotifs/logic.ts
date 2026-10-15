// Notifications de Windows : la logique sans DOM (testée dans tests/front/winnotifs.test.ts).
//
// Le Rust (src-tauri/src/modules/winnotifs.rs) a déjà filtré les applis et
// coupé les textes ; ici on vérifie la forme du message, on compose ce que
// montre l'île et on tient le petit historique (en mémoire seulement).

/** Une notification d'une autre appli, telle que publiée par `winnotifs.new`. */
export interface WinNotif {
  /** L'id de Windows (pour la retirer du Centre de notifications). */
  id: number;
  /** Le nom de l'appli (« Outlook »). */
  app: string;
  /** Une clé courte de l'appli (son logo, « Ouvrir ») : jamais son identifiant Windows. */
  key: string;
  /** Le Rust a un logo pour cette appli (commande `icon`). */
  icon: boolean;
  title: string;
  /** Vide si le réglage « Montrer le texte du message » est décoché. */
  body: string;
  /** Arrivée (ms depuis 1970), mise par le front. */
  at: number;
}

export type AccessState = "off" | "starting" | "allowed" | "denied" | "unavailable" | "error";
export type RemoveState = "unknown" | "ok" | "refused";

export interface WinNotifStatus {
  state: AccessState;
  remove: RemoveState;
}

/** Au plus ce nombre dans l'historique de l'onglet. */
export const HISTORY_MAX = 20;

const STATES: readonly AccessState[] = ["off", "starting", "allowed", "denied", "unavailable", "error"];
const REMOVES: readonly RemoveState[] = ["unknown", "ok", "refused"];

/** Le message `winnotifs.new`, vérifié (null s'il est mal formé). */
export function parseNotif(payload: unknown, now = Date.now()): WinNotif | null {
  const p = payload as Partial<WinNotif> | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.id !== "number" || !Number.isInteger(p.id) || p.id < 0) return null;
  if (typeof p.title !== "string" || !p.title.trim()) return null;
  const key = typeof p.key === "string" && /^[0-9a-f]{8}$/.test(p.key) ? p.key : "";
  return {
    id: p.id,
    app: typeof p.app === "string" && p.app.trim() ? p.app.trim() : "Windows",
    key,
    icon: p.icon === true && key !== "",
    title: p.title.trim(),
    body: typeof p.body === "string" ? p.body.trim() : "",
    at: now,
  };
}

/** Le message `winnotifs.status` (ou la réponse de la commande `status`), vérifié. */
export function parseStatus(payload: unknown): WinNotifStatus | null {
  const p = payload as Partial<WinNotifStatus> | null;
  if (!p || typeof p !== "object" || !STATES.includes(p.state as AccessState)) return null;
  return { state: p.state as AccessState, remove: REMOVES.includes(p.remove as RemoveState) ? (p.remove as RemoveState) : "unknown" };
}

/** Le titre dans l'île : « Outlook · Réunion à 14 h » (le nom de l'appli d'abord). */
export function islandTitle(n: Pick<WinNotif, "app" | "title">): string {
  return n.title.toLowerCase() === n.app.toLowerCase() ? n.app : `${n.app} · ${n.title}`;
}

/** Le nom d'icône de l'appli (icon.ts, setAppIcon), ou la cloche. */
export function iconName(n: Pick<WinNotif, "key" | "icon">): string {
  return n.icon && n.key ? `app:${n.key}` : "🔔";
}

/** L'historique avec `n` en tête (sans doublon d'id, `max` au plus). */
export function remember(list: readonly WinNotif[], n: WinNotif, max = HISTORY_MAX): WinNotif[] {
  return [n, ...list.filter((x) => x.id !== n.id)].slice(0, Math.max(0, max));
}

/** Windows refuse ou ne répond pas : proposer d'ouvrir ses Paramètres. */
export function needsWindowsSettings(s: WinNotifStatus | null): boolean {
  return s?.state === "denied" || s?.state === "error";
}

/** Une phrase pour l'état de l'accès (onglet, page des réglages). */
export function statusText(s: WinNotifStatus | null): string {
  switch (s?.state) {
    case "allowed":
      return "Ondine reçoit les nouvelles notifications de Windows.";
    case "denied":
      return "Windows ne laisse pas Ondine lire vos notifications. Autorisez-le dans Paramètres, Confidentialité, Notifications.";
    case "unavailable":
      return "Cette version de Windows ne permet pas de lire les notifications (Windows 10 version 1607 ou plus récent).";
    case "error":
      return "Windows ne répond pas à la demande d'accès aux notifications.";
    case "off":
      return "Le module est désactivé.";
    default:
      return "Demande d'accès à Windows…";
  }
}

/** « à l'instant », « il y a 5 min », « il y a 2 h ». */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return `il y a ${Math.floor(s / 3600)} h`;
}
