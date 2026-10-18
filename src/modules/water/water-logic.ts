// Module « Eau » : les calculs sans DOM (testés dans tests/front/water.test.ts) :
// total du jour, la semaine en barres, les textes en litres, et l'heure du
// prochain rappel. La vue et le rappel sont dans index.ts ; le carnet est
// tenu par le Rust (src-tauri/src/modules/water.rs).

/** Un verre bu : l'heure (« 09:42 », heure du PC) et sa taille. */
export interface Glass {
  at: string;
  ml: number;
}

/** Le carnet, tel que le Rust le renvoie : « 2026-10-18 » → les verres du jour. */
export interface WaterLog {
  today: string;
  days: Record<string, Glass[]>;
}

/** Les réglages du module, lus et bornés. */
export interface WaterSettings {
  glassMl: number;
  goalMl: number;
  startHour: number;
  endHour: number;
  everyMin: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Les réglages (valeurs du manifeste) → des nombres sûrs, en ml et en heures. */
export function waterSettings(values: Record<string, unknown>): WaterSettings {
  return {
    glassMl: Math.round(clamp(num(values.glassCl, 25), 5, 100)) * 10,
    goalMl: Math.round(clamp(num(values.goalL, 2), 0.5, 5) * 1000),
    startHour: Math.round(clamp(num(values.startHour, 9), 0, 23)),
    endHour: Math.round(clamp(num(values.endHour, 18), 1, 24)),
    everyMin: Math.round(clamp(num(values.everyMin, 90), 0, 240)),
  };
}

/** Un carnet reçu du Rust (ou du bus), nettoyé : rien d'autre que des verres valables. */
export function cleanLog(raw: unknown): WaterLog | null {
  const r = raw as { today?: unknown; days?: unknown } | null;
  if (!r || typeof r.today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.today)) return null;
  const days: Record<string, Glass[]> = {};
  if (r.days && typeof r.days === "object") {
    for (const [day, list] of Object.entries(r.days as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(list)) continue;
      days[day] = list.filter((g): g is Glass => !!g && typeof g.at === "string" && typeof g.ml === "number" && g.ml > 0);
    }
  }
  return { today: r.today, days };
}

/** « 2026-10-18 » pour une date (heure locale). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** « 2026-10-18 » + n jours (n négatif : avant). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}

/** Le total d'un jour, en ml. */
export function dayTotal(log: WaterLog, day = log.today): number {
  return (log.days[day] ?? []).reduce((sum, g) => sum + g.ml, 0);
}

/** Une barre de la semaine. */
export interface DayBar {
  day: string;
  ml: number;
  today: boolean;
  /** 0 = lundi … 6 = dimanche. */
  weekday: number;
  /** Hauteur de 0 à 1 (par rapport à l'objectif, ou au plus gros jour s'il le dépasse). */
  height: number;
}

/** Les 7 derniers jours, aujourd'hui à droite. */
export function weekBars(log: WaterLog, goalMl: number): DayBar[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(log.today, i - 6));
  const totals = days.map((d) => dayTotal(log, d));
  const top = Math.max(goalMl, ...totals, 1);
  return days.map((day, i) => {
    const [y, m, d] = day.split("-").map(Number);
    return { day, ml: totals[i], today: i === 6, weekday: (new Date(y, m - 1, d).getDay() + 6) % 7, height: totals[i] / top };
  });
}

/** L'initiale du jour sous sa barre. */
export function weekdayLetter(weekday: number, lang: string): string {
  return (lang === "en" ? "MTWTFSS" : "LMMJVSD")[weekday] ?? "";
}

/**
 * Des ml en litres : 2000 → « 2 L », 1250 → « 1,25 L » (« 1.25 L » en
 * anglais), 500 → « 0,50 L ».
 */
export function litres(ml: number, lang = "fr"): string {
  const l = Math.max(0, ml) / 1000;
  if (Number.isInteger(l)) return `${l} L`;
  const text = l.toFixed(2);
  return `${lang === "en" ? text : text.replace(".", ",")} L`;
}

/** « sur 2 L aujourd'hui » */
export function goalLine(goalMl: number, lang = "fr"): string {
  return `sur ${litres(goalMl, lang)} aujourd'hui`;
}

/** Le corps du rappel : « Aujourd'hui : 1,25 L sur 2 L ». */
export function reminderBody(totalMl: number, goalMl: number, lang = "fr"): string {
  return `Aujourd'hui : ${litres(totalMl, lang)} sur ${litres(goalMl, lang)}`;
}

/** Le bouton du verre : « + 25 cl ». */
export function glassLabel(glassMl: number): string {
  return `+ ${Math.round(glassMl / 10)} cl`;
}

/** La part de l'objectif (0 à 1). */
export function progress(totalMl: number, goalMl: number): number {
  return goalMl > 0 ? Math.min(1, totalMl / goalMl) : 0;
}

/** L'heure (ms) du dernier verre d'aujourd'hui, d'après le carnet ; null s'il n'y en a pas. */
export function lastGlassAt(log: WaterLog, now: Date): number | null {
  const last = (log.days[log.today] ?? []).at(-1);
  const m = last && /^(\d{1,2}):(\d{2})$/.exec(last.at);
  if (!m || log.today !== dateKey(now)) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/** Ce qui décide du prochain rappel. */
export interface ReminderInput {
  /** Le dernier verre (ms), null s'il n'y en a pas aujourd'hui. */
  lastGlassAt: number | null;
  /** Le dernier rappel montré (ms). */
  lastAskedAt: number | null;
  /** « Plus tard » : redemander à cette heure-là (ms), même avant l'intervalle. */
  snoozeUntil: number | null;
  totalMl: number;
}

/**
 * L'heure du prochain rappel (ms), ou null : pas d'autre rappel aujourd'hui
 * (rappels coupés, objectif atteint, plage du jour finie, ou ce serait après).
 *   - le premier de la journée : au début de la plage (9 h) ;
 *   - ensuite : `everyMin` après le dernier verre ou le dernier rappel ;
 *   - « Plus tard » avance le suivant à l'heure demandée.
 * Un verre bu ou un rappel d'avant la plage du jour ne compte pas.
 */
export function nextReminderAt(now: Date, s: WaterSettings, input: ReminderInput): number | null {
  if (s.everyMin <= 0 || s.endHour <= s.startHour || input.totalMl >= s.goalMl) return null;
  const at = (hour: number) => {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const start = at(s.startHour);
  const end = at(s.endHour);
  if (now.getTime() >= end) return null; // la plage du jour est finie
  const marks = [input.lastGlassAt, input.lastAskedAt].filter((t): t is number => t !== null && t >= start);
  const last = marks.length ? Math.max(...marks) : null;
  let next = last === null ? start : last + s.everyMin * 60_000;
  if (input.snoozeUntil !== null && (last === null || input.snoozeUntil > last)) next = Math.min(next, Math.max(start, input.snoozeUntil));
  return next < end ? next : null;
}

/** Faut-il rappeler maintenant ? */
export function reminderDue(now: Date, s: WaterSettings, input: ReminderInput): boolean {
  const next = nextReminderAt(now, s, input);
  return next !== null && now.getTime() >= next;
}
