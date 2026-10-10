// Petits calculs du chat Équipe (1.2.2), sans DOM : testés par
// tests/front/team-chat.test.ts.

import type { Status } from "./logic";

/** Le salon « Toute l'équipe » (les conversations à deux ont l'empreinte du collègue). */
export const GROUP = "all";

/** Une ligne du fil, telle que le Rust le range (team_chat.rs, `Line`). */
export interface ChatLine {
  id: number;
  /** "" = moi ; sinon l'empreinte du collègue. */
  from: string;
  /** text : un message ; file-out / file-in : un fichier proposé (le texte est son nom). */
  kind: "text" | "file-out" | "file-in";
  text: string;
  at: number;
  /** Mes messages : l'autre les a lus (à deux seulement). */
  read: boolean;
  /** [qui, réaction] ; qui = "" pour moi. */
  reactions: [string, string][];
}

/** Une conversation dans la liste (commande `chat_state`). */
export interface RoomView {
  room: string;
  unread: number;
  last: ChatLine | null;
  typing: string[];
}

/** Les réactions : sorte (protocole), pictogramme, libellé. */
export const REACTIONS: { kind: string; icon: string; label: string }[] = [
  { kind: "thumb", icon: "👍", label: "Pouce" },
  { kind: "laugh", icon: "😂", label: "Rire" },
  { kind: "heart", icon: "❤️", label: "J'adore" },
];

/** L'expression que prend la mascotte de l'île pour une réaction reçue. */
export function reactionEmotion(kind: string): string {
  return kind === "thumb" ? "proud" : kind === "laugh" ? "laugh" : "love";
}

/** Un message au plus de 4 000 caractères (comme le Rust, MAX_CHAT). */
export const MAX_CHAT = 4000;

/**
 * Le texte coupé en morceaux : le texte tel quel, et les liens http(s) à part
 * (sans la ponctuation collée au bout, comme `trim_link` dans le Rust). Un
 * lien n'est jamais ouvert tout seul : c'est la vue qui en fait un bouton.
 */
export function linkParts(text: string): { text: string; link?: string }[] {
  const out: { text: string; link?: string }[] = [];
  const rx = /https?:\/\/[^\s<>"]+/gi;
  let at = 0;
  for (const m of text.matchAll(rx)) {
    const raw = m[0];
    const link = raw.replace(/[.,;:!?)\]»"']+$/u, "");
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    // Seulement http(s):// suivi d'un nom (pas « https:// » tout seul).
    if (/^https?:\/\/[^/\s]/i.test(link)) out.push({ text: link, link });
    else out.push({ text: link });
    at = start + link.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Les réactions d'un message, regroupées : 👍 2 (dont la mienne ?). */
export function reactionCounts(reactions: [string, string][]): { kind: string; icon: string; count: number; mine: boolean }[] {
  return REACTIONS.map((r) => {
    const who = reactions.filter(([, k]) => k === r.kind).map(([w]) => w);
    return { kind: r.kind, icon: r.icon, count: who.length, mine: who.includes("") };
  }).filter((r) => r.count > 0);
}

/** En concentration ou en réunion : les notifications du chat se font discrètes. */
export function discreet(status: Status | string | undefined): boolean {
  return status === "focus" || status === "meeting";
}

/** Combien de messages non lus en tout (la pastille de l'icône 💬). */
export function unreadTotal(rooms: RoomView[]): number {
  return rooms.reduce((n, r) => n + Math.max(0, r.unread), 0);
}

/** Où mettre « Lu » : sous mon dernier message lu (-1 : nulle part). */
export function lastReadIndex(lines: ChatLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.from === "" && l.kind === "text") return l.read ? i : -1;
  }
  return -1;
}

/** « Léa écrit… », « Léa et Karim écrivent… », « Plusieurs collègues écrivent… ». */
export function typingLabel(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} écrit…`;
  if (names.length === 2) return `${names[0]} et ${names[1]} écrivent…`;
  return "Plusieurs collègues écrivent…";
}

/** L'heure d'un message (« 14:05 »), avec le jour s'il n'est pas d'aujourd'hui (« 12/10 14:05 »). */
export function timeLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return hm;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hm}`;
}

/** Un aperçu d'une ligne (liste des conversations, notification) : une ligne, 120 caractères. */
export function preview(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * Les conversations à montrer : le salon d'abord, puis les collègues en ligne,
 * puis ceux qui ont une conversation (même hors ligne) ; les non lus d'abord.
 */
export function roomOrder<P extends { id: string; name: string; online: boolean }>(peers: P[], rooms: RoomView[]): P[] {
  const info = new Map(rooms.map((r) => [r.room, r]));
  return peers
    .filter((p) => p.online || info.has(p.id))
    .sort(
      (a, b) =>
        (info.get(b.id)?.unread ?? 0) - (info.get(a.id)?.unread ?? 0) ||
        Number(b.online) - Number(a.online) ||
        (info.get(b.id)?.last?.at ?? 0) - (info.get(a.id)?.last?.at ?? 0) ||
        a.name.localeCompare(b.name, "fr"),
    );
}
