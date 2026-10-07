// L'heure ailleurs : heure d'une ville, écart avec ici, « demain » / « hier ».
//
// Tout passe par Intl.DateTimeFormat({ timeZone }) : c'est Windows (ses
// fuseaux et leurs heures d'été) qui fait le calcul, rien ne part sur
// Internet. Utilisé par les horloges du monde (onglet Système) et par le
// Lanceur (« 15 h Montréal », « heure à Tokyo »).
//
// Pur (aucun DOM) : testé dans tests/front/world-time.test.ts. On peut donner
// le fuseau d'« ici » (`here`) pour tester ; sinon c'est celui du PC.

import { type City, cityName, localZone } from "./world-cities";

export type TimeLang = "fr" | "en";

/** Date et heure telles qu'on les lit sur une horloge du fuseau. */
interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Ce qu'une horloge réglée sur `tz` affiche à l'instant `at`. */
export function wallTime(tz: string, at: Date): WallTime {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  // Certains moteurs écrivent minuit « 24 » : c'est 0 h.
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

/** Le décalage du fuseau avec UTC à cet instant, en minutes (Paris l'été : +120). */
export function offsetMinutes(tz: string, at: Date): number {
  const w = wallTime(tz, at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Le fuseau d'« ici » : celui du PC, sinon UTC. */
function hereZone(here?: string): string {
  return here || localZone() || "UTC";
}

/** Nombre de jours entre deux dates de calendrier (b − a) : −1, 0, 1… */
function dayDiff(a: WallTime, b: WallTime): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/**
 * L'instant où une horloge réglée sur `tz` affiche cette date et cette heure.
 * (Deux passes : le décalage peut changer autour d'un passage à l'heure d'été.)
 */
export function zonedInstant(tz: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let t = naive - offsetMinutes(tz, new Date(naive)) * 60_000;
  t = naive - offsetMinutes(tz, new Date(t)) * 60_000;
  return new Date(t);
}

/** « 9 h 05 » en français, « 09:05 » en anglais. */
export function clockText(hour: number, minute: number, lang: TimeLang): string {
  const mm = String(minute).padStart(2, "0");
  return lang === "en" ? `${String(hour).padStart(2, "0")}:${mm}` : `${hour} h ${mm}`;
}

/** « 09:05 » : l'heure d'une horloge (onglet Système), dans les deux langues. */
export function digitalText(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** L'écart avec ici : « +6 h », « −3 h 30 », « +5 h 45 », ou « même heure ». */
export function offsetText(minutes: number, lang: TimeLang): string {
  if (minutes === 0) return lang === "en" ? "same time" : "même heure";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `${sign}${h} h ${String(m).padStart(2, "0")}` : `${sign}${h} h`;
}

/** « demain », « hier », ou "" le même jour. */
export function dayWord(diff: number, lang: TimeLang): string {
  if (diff > 0) return lang === "en" ? "tomorrow" : "demain";
  if (diff < 0) return lang === "en" ? "yesterday" : "hier";
  return "";
}

/** Une horloge du monde, prête à afficher. */
export interface CityClock {
  /** Le nom de la ville dans la langue de l'interface. */
  name: string;
  /** « 09:05 » */
  time: string;
  hour: number;
  minute: number;
  /** −1 : la ville est encore hier ; +1 : déjà demain ; 0 : même jour qu'ici. */
  dayDiff: number;
  /** Écart avec ici, en minutes (Tokyo vu de Paris l'été : +420). */
  offset: number;
  /** « jeudi 8 octobre » (la date là-bas). */
  date: string;
}

/** L'heure d'une ville à l'instant `now`, comparée à ici. */
export function cityClock(city: City, now: Date, lang: TimeLang, here?: string): CityClock {
  const tzHere = hereZone(here);
  const there = wallTime(city.tz, now);
  const local = wallTime(tzHere, now);
  const date = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { timeZone: city.tz, weekday: "long", day: "numeric", month: "long" }).format(now);
  return {
    name: cityName(city, lang),
    time: digitalText(there.hour, there.minute),
    hour: there.hour,
    minute: there.minute,
    dayDiff: dayDiff(local, there),
    offset: offsetMinutes(city.tz, now) - offsetMinutes(tzHere, now),
    date,
  };
}

/** Une heure de la ville `city` (aujourd'hui là-bas) vue d'ici. */
export interface TimeThere {
  /** L'heure ici. */
  hour: number;
  minute: number;
  /** +1 : ici, c'est déjà le lendemain ; −1 : encore la veille. */
  dayDiff: number;
  /** Écart de la ville avec ici, en minutes. */
  offset: number;
}

/**
 * « 15 h à Montréal, c'est quelle heure ici ? » Le jour pris est
 * aujourd'hui à Montréal ; `dayDiff` dit si, ici, c'est la veille ou le
 * lendemain de ce jour-là.
 */
export function fromCityTime(city: City, hour: number, minute: number, now: Date, here?: string): TimeThere {
  const tzHere = hereZone(here);
  const today = wallTime(city.tz, now);
  const at = zonedInstant(city.tz, today.year, today.month, today.day, hour, minute);
  const local = wallTime(tzHere, at);
  const there = wallTime(city.tz, at);
  return {
    hour: local.hour,
    minute: local.minute,
    dayDiff: dayDiff(there, local),
    offset: offsetMinutes(city.tz, at) - offsetMinutes(tzHere, at),
  };
}
