// Notes d'appel (1.2.4) : les petits calculs de la page, sans DOM (testés
// dans tests/front/callnotes.test.ts). La forme des notes suit le Rust
// (src-tauri/src/modules/callnotes_text.rs).

export type CallStatus = "recording" | "processing" | "ready" | "failed";

export interface Speaker {
  id: string;
  name: string;
  /** Le rang de sa couleur (0 : vous). */
  color: number;
  me: boolean;
}

export interface Line {
  speaker: string;
  /** Secondes depuis le début de l'appel. */
  start: number;
  end: number;
  text: string;
}

export interface Todo {
  id: number;
  text: string;
  owner: string | null;
  due: string | null;
  done: boolean;
}

/** Une note entière (commande `get`). */
export interface CallNote {
  id: string;
  title: string;
  start: number;
  end: number | null;
  status: CallStatus;
  engine: string;
  speakers: Speaker[];
  lines: Line[];
  summary: string | null;
  keyPoints: string[];
  todos: Todo[];
  error: string | null;
  warning: string | null;
  working: boolean;
}

/** Une ligne de la liste (commande `list`). */
export interface NoteItem {
  id: string;
  title: string;
  start: number;
  end: number | null;
  status: CallStatus;
  people: number;
  working: boolean;
}

/** Ce que dit la commande `status` : l'enregistrement, et ce qui part. */
export interface CallStatusInfo {
  recording: boolean;
  startedAt: number | null;
  engine: "parakeet" | "api";
  parakeet: boolean;
  sttDestination: string | null;
  ai: { destination: string; key: boolean } | null;
  autoSummary: boolean;
}

/** Les couleurs des personnes : vous en bleu, puis corail, lilas, vert, or, rose. */
export const SPEAKER_COLORS = ["#7cc4ff", "#ff9a7e", "#c7a6ff", "#4cd98b", "#ffc25a", "#f28bd2"];

export function speakerColor(rank: number): string {
  return SPEAKER_COLORS[((rank % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length];
}

/** La durée d'un appel en minutes (au moins 1). */
export function minutes(start: number, end: number | null, now = Date.now()): number {
  return Math.max(1, Math.round(((end ?? now) - start) / 60_000));
}

/** Le temps écoulé : « 0:07 », « 12:48 », « 1:02:05 ». */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** « Aujourd'hui », « Hier » ou « 13 oct. » (dans la langue donnée). */
export function dayLabel(start: number, now: number, lang = "fr"): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(start) === day(now)) return "Aujourd'hui";
  if (day(start) === day(now - 86_400_000)) return "Hier";
  return new Date(start).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

/** La petite ligne sous le titre dans la liste. */
export function itemMeta(n: NoteItem, now: number, lang = "fr"): string {
  if (n.status === "recording") return "Enregistrement…";
  if (n.working || n.status === "processing") return "La transcription s'écrit…";
  if (n.status === "failed") return "À réessayer";
  return `${dayLabel(n.start, now, lang)} · ${minutes(n.start, n.end, now)} min`;
}

/** « 1 personne », « 3 personnes ». */
export function peopleLabel(n: number): string {
  return n <= 1 ? "1 personne" : `${n} personnes`;
}

/** La ligne sous le titre de la note : « Aujourd'hui, 10:00 · 32 min · 3 personnes ». */
export function noteMeta(n: CallNote, now: number, lang = "fr"): string {
  const time = new Date(n.start).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  const parts = [`${dayLabel(n.start, now, lang)}, ${time}`, `${minutes(n.start, n.end, now)} min`];
  if (n.speakers.length && n.status !== "recording") parts.push(peopleLabel(n.speakers.length));
  return parts.join(" · ");
}

/** Le nom et la couleur de qui parle, pour une ligne. */
export function who(n: CallNote, speaker: string): { name: string; color: string } {
  const s = n.speakers.find((x) => x.id === speaker);
  return { name: s?.name ?? speaker, color: speakerColor(s?.color ?? 1) };
}

/** Les premières lignes de la transcription (l'extrait du résumé). */
export function excerpt(lines: Line[], count = 3): Line[] {
  return lines.filter((l) => l.text.trim()).slice(0, count);
}

/** Ce qui part quand on écrit le résumé (une phrase entière, pour la traduction). */
export function summaryLeaves(ai: CallStatusInfo["ai"]): string {
  if (!ai) return "Le résumé est écrit par l'IA de Parler à Ondine : activez ce module et ajoutez votre clé.";
  if (!ai.key) return `Le résumé est écrit par l'IA de Parler à Ondine (${ai.destination}) : ajoutez d'abord votre clé dans Réglages → Identifiants.`;
  return `Pour le résumé, la transcription (le texte, jamais l'audio) part vers ${ai.destination}, avec votre clé.`;
}

/** Ce qui part pendant la transcription (une phrase entière). */
export function transcriptionLeaves(s: Pick<CallStatusInfo, "engine" | "parakeet" | "sttDestination">): string {
  if (s.engine === "api") {
    return s.sttDestination
      ? `Transcription par l'API : à la fin de l'appel, l'audio part vers ${s.sttDestination}, avec la clé de Parler à Ondine, puis il est effacé.`
      : "Transcription par l'API : ajoutez une clé OpenAI ou Gemini dans Réglages → Identifiants, et activez Parler à Ondine.";
  }
  return s.parakeet
    ? "Parakeet écrit l'appel sur le PC : l'audio ne part pas, et il est effacé dès que la transcription est écrite."
    : "Parakeet n'est pas encore téléchargé : téléchargez-le dans les Réglages (groupe Voix) pour écrire les appels sur le PC.";
}

/** Un nom de personne tapé : 1 à 40 caractères (comme le Rust). */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\p{Cc}/gu, "").trim();
  return name && [...name].length <= 40 ? name : null;
}
