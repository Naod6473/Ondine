// Les pages Voix de la Dictée, sans DOM (testé dans tests/front/dictation.test.ts) :
// les types renvoyés par le Rust (modules/dictation.rs), les dates et les
// nombres à afficher, les tuiles des Statistiques, et les petites
// vérifications du dictionnaire et des styles.

/** Une dictée de l'historique. */
export interface DictationEntry {
  id: number;
  /** Millisecondes depuis 1970. */
  at: number;
  text: string;
  app: string | null;
  words: number;
  seconds: number;
  handsFree: boolean;
}

/** Les chiffres d'une période. */
export interface Totals {
  words: number;
  seconds: number;
  dictations: number;
  handsFree: number;
  wordsPerMinute: number;
  minutesSaved: number;
  /** [nom de l'appli, mots], les plus dictées d'abord. */
  apps: [string, number][];
}

export interface Stats {
  week: Totals;
  month: Totals;
  all: Totals;
  /** Les 30 derniers jours : [« 2026-10-15 », mots]. */
  daily: [string, number][];
  streak: number;
  typingWpm: number;
}

export interface Replacement {
  id?: string;
  from: string;
  to: string;
}

export interface Words {
  words: string[];
  replacements: Replacement[];
}

export type StyleId = "verbatim" | "natural" | "polished";

export interface AppStyle {
  id: string;
  name: string;
  style: StyleId;
}

export const STYLE_OPTIONS: [StyleId, string][] = [
  ["verbatim", "Tel quel"],
  ["natural", "Naturel"],
  ["polished", "Soigné"],
];

export const EMPTY_TOTALS: Totals = { words: 0, seconds: 0, dictations: 0, handsFree: 0, wordsPerMinute: 0, minutesSaved: 0, apps: [] };

/** Un nombre à la française : « 1 284 » (espace fine insécable). */
export function formatNumber(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(/^/, v < 0 ? "-" : "");
}

/** Un temps en minutes : « 12 min », « 1 h 12 », « 3 h ». */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, "0")}` : `${h} h`;
}

/** Le même jour (heure locale) ? */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « Aujourd'hui », « Hier », sinon « 12 oct. » (et l'année si ce n'est pas celle-ci). */
export function dayLabel(at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  if (sameDay(d, today)) return "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return "Hier";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** « 09:41 ». */
export function timeLabel(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** L'historique rangé par jour, dans l'ordre reçu (le plus récent d'abord). */
export function groupByDay(entries: DictationEntry[], now: number): { label: string; items: DictationEntry[] }[] {
  const out: { label: string; items: DictationEntry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(e);
    else out.push({ label, items: [e] });
  }
  return out;
}

export type Period = "week" | "month" | "all";

/** Une tuile des Statistiques. */
export interface Tile {
  label: string;
  value: string;
  sub: string;
}

const PERIOD_SUB: Record<Period, string> = { week: "cette semaine", month: "ce mois-ci", all: "depuis le début" };

/** Les quatre tuiles d'une période. */
export function statTiles(t: Totals, period: Period): Tile[] {
  return [
    { label: "Mots dictés", value: formatNumber(t.words), sub: PERIOD_SUB[period] },
    { label: "Temps gagné", value: formatMinutes(t.minutesSaved), sub: "par rapport à 40 mots/min au clavier" },
    { label: "Vitesse", value: formatNumber(t.wordsPerMinute), sub: "mots par minute" },
    { label: "Dictées", value: formatNumber(t.dictations), sub: t.handsFree ? `dont ${formatNumber(t.handsFree)} mains libres` : "en tenant la touche" },
  ];
}

/** Les applis en parts (%), arrondies, les plus dictées d'abord. */
export function appShares(apps: [string, number][], max = 6): { name: string; pct: number }[] {
  const total = apps.reduce((s, [, n]) => s + Math.max(0, n), 0);
  if (total <= 0) return [];
  return apps.slice(0, max).map(([name, n]) => ({ name, pct: Math.round((Math.max(0, n) * 100) / total) }));
}

/** La hauteur relative (0..1) de chaque barre des mots par jour. */
export function dailyBars(daily: [string, number][]): { day: string; words: number; h: number }[] {
  const top = Math.max(1, ...daily.map(([, n]) => n));
  return daily.map(([day, words]) => ({ day, words, h: words / top }));
}

/** « 2026-10-15 » → « 15 oct. ». */
export function shortDay(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trim();
}

/** « 1 jour d'affilée », « 4 jours d'affilée ». */
export function streakText(n: number): string {
  return n <= 1 ? `${Math.max(0, n)} jour d'affilée` : `${formatNumber(n)} jours d'affilée`;
}

/** Un nom à ajouter au dictionnaire : nettoyé, et pas déjà dedans (sans tenir compte des majuscules). */
export function addWord(list: string[], raw: string): string[] | null {
  const w = raw.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!w || list.some((x) => x.toLowerCase() === w.toLowerCase())) return null;
  return [...list, w];
}

/** Un remplacement à ajouter : les deux côtés remplis, et pas déjà là. */
export function addReplacement(list: Replacement[], from: string, to: string): Replacement[] | null {
  const f = from.trim().replace(/\s+/g, " ").slice(0, 120);
  const t = to.trim().slice(0, 400);
  if (!/[\p{L}\p{N}]/u.test(f) || !t) return null;
  const key = f.toLowerCase();
  if (list.some((r) => r.from.trim().toLowerCase() === key)) return null;
  return [...list, { from: f, to: t }];
}

/** Ajoute ou change le style d'une appli (id du programme, « outlook »). */
export function setAppStyle(list: AppStyle[], id: string, name: string, style: StyleId): AppStyle[] {
  const clean = id.trim().toLowerCase().replace(/\.exe$/, "");
  if (!clean) return list;
  const i = list.findIndex((s) => s.id === clean);
  if (i >= 0) return list.map((s, j) => (j === i ? { ...s, style } : s));
  return [...list, { id: clean, name: name.trim() || clean, style }];
}

/** Le prénom pour « Bonjour … » (le premier mot, sans rien d'étrange). */
export function greetingName(firstName: string | undefined | null): string {
  return (firstName ?? "").trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
}
