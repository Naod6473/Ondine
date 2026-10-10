// Petits calculs du module Équipe, sans DOM : testés par tests/front/team.test.ts.

import { TINTS } from "../../mascot/renderers/gum-draw";

export type Status = "available" | "meeting" | "focus" | "away" | "offline";

/** Ce que le Rust renvoie pour un collègue (commande `state`). */
export interface PeerView {
  id: string;
  name: string;
  color: string;
  mascot: string;
  mine: boolean;
  it: boolean;
  addr: string;
  online: boolean;
  status: Status;
  statusText: string;
  version: string;
  visits: boolean;
  battery: { percent: number; charging: boolean } | null;
  fingerprint: string;
  report?: { at: number; data: Report };
}

export interface Report {
  host: string;
  os: string;
  ondine: string;
  cpuPct: number;
  memPct: number;
  disks: { mount: string; freeGb: number; totalGb: number }[];
  rebootPending: boolean;
  uptimeSecs: number;
}

/** Les libellés des statuts (et leur couleur, classe CSS `team-st-…`). */
export const STATUS_LABEL: Record<Status, string> = {
  available: "Disponible",
  meeting: "En réunion",
  focus: "Concentration",
  away: "Absent",
  offline: "Hors ligne",
};

/** Les gestes : sorte (protocole), pictogramme, libellé. */
export const PINGS: { kind: string; icon: string; label: string }[] = [
  { kind: "wave", icon: "👋", label: "Coucou" },
  { kind: "thumb", icon: "👍", label: "Pouce" },
  { kind: "coffee", icon: "☕", label: "Café" },
  { kind: "heart", icon: "❤️", label: "Merci" },
  { kind: "clap", icon: "👏", label: "Bravo" },
  { kind: "party", icon: "🎉", label: "Fête" },
];

/** Le texte de la notification d'un geste reçu. */
export function pingText(kind: string): string {
  const p = PINGS.find((x) => x.kind === kind) ?? PINGS[0];
  return `${p.icon} ${p.label} !`;
}

/** Réponses à « Tu es dispo ? » et aux invitations. */
export const ANSWER_LABEL: Record<string, string> = { yes: "Oui", later: "Dans 5 min", no: "Non" };

/**
 * La couleur à montrer aux collègues pour la mascotte de l'île : la couleur
 * personnalisée, sinon le ton moyen de la teinte choisie (bleu par défaut).
 */
export function lookColor(color: string | undefined, custom: string | undefined): string {
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (color === "custom" && custom && hex.test(custom)) return custom.toLowerCase();
  const tints = TINTS as Record<string, readonly string[]>;
  const tint = color && tints[color] ? tints[color] : tints.blue;
  return tint[1].toLowerCase();
}

/** En ligne d'abord, puis mes PC, puis par nom. */
export function sortPeers(list: PeerView[]): PeerView[] {
  return [...list].sort((a, b) => Number(b.online) - Number(a.online) || Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name, "fr"));
}

/** Les choix d'un sondage : sans vide ni doublon ; null s'il n'y en a pas 2 à 4. */
export function pollChoices(raw: string[]): string[] | null {
  const seen = new Set<string>();
  const out = raw.map((c) => c.trim().slice(0, 60)).filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()));
  return out.length >= 2 && out.length <= 4 ? out : null;
}

/** Un lien seul (http ou https), à montrer comme tel avant l'envoi. */
export function isLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** Le code d'appairage, en deux groupes : « 482 913 ». */
export function codeText(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Un disque presque plein : moins de 10 % libres. */
export function diskLow(d: { freeGb: number; totalGb: number }): boolean {
  return d.totalGb > 0 && d.freeGb / d.totalGb < 0.1;
}

/** Une adresse IPv4 privée (ajout à la main). */
export function isPrivateIp(text: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text.trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
