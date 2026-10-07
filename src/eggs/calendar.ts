// Le calendrier d'Ondine : quelle surprise de saison aujourd'hui ?
// (Pur : testé dans tests/front/eggs.test.ts.)

export type SeasonId = "new-year" | "valentine" | "april-fool" | "music-day" | "bastille" | "halloween" | "snow";

/** La surprise de saison du jour, ou null. */
export function seasonOf(date: Date): SeasonId | null {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 1 && d === 1) return "new-year";
  if (m === 2 && d === 14) return "valentine";
  if (m === 4 && d === 1) return "april-fool";
  if (m === 6 && d === 21) return "music-day";
  if (m === 7 && d === 14) return "bastille";
  if (m === 10 && d === 31) return "halloween";
  if (m === 12) return "snow";
  return null;
}

/** « 2026-10-07 » (heure locale) : la clé « déjà joué aujourd'hui ». */
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Ce que dit la météo (ligne `weather.updated` du module Météo). */
export interface WeatherLike {
  icon: string;
  temp: string;
  label: string;
}

/** Il pleut ? (d'après l'icône ou le libellé de la météo, en français ou en anglais) */
export function isRainy(w: WeatherLike | null): boolean {
  if (!w) return false;
  return /🌧|🌦|☔|⛈/u.test(w.icon) || /pluie|averse|bruine|orage|rain|shower|drizzle|thunder/i.test(w.label);
}

/** Il fait très chaud ? 35 °C ou plus (95 °F). « 36°C » → vrai. */
export function isHot(w: WeatherLike | null): boolean {
  const m = w ? /^(-?\d+)°\s*([CF])?$/.exec(w.temp.trim()) : null;
  if (!m) return false;
  const v = Number(m[1]);
  return m[2] === "F" ? v >= 95 : v >= 35;
}
