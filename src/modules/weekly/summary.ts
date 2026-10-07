// Le texte du bilan de la semaine, sans DOM : testé dans
// tests/front/weekly.test.ts.

/** Ce que renvoie le Rust (commandes « due » et « peek » de src-tauri/src/modules/weekly.rs). */
export interface WeekTally {
  /** Séances de travail Pomodoro menées jusqu'au bout. */
  pomodoros: number;
  /** Temps passé en séance de travail, en minutes. */
  focusMinutes: number;
  /** Tâches cochées dans Notes. */
  todos: number;
  /** La fin de la semaine (« 2026-10-09T17:00 », heure du PC). */
  until?: string;
}

/** 45 → « 45 min » ; 120 → « 2 h » ; 125 → « 2 h 05 ». */
export function focusText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, "0")}` : `${h} h`;
}

/**
 * Les morceaux du bilan, dans l'ordre : « 3 Pomodoros terminés »,
 * « 2 h 05 de concentration », « 7 tâches cochées ». Un compteur à zéro
 * n'apparaît pas ; une semaine sans rien donne une liste vide.
 */
export function summaryParts(w: WeekTally): string[] {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const pomodoros = n(w.pomodoros);
  const minutes = n(w.focusMinutes);
  const todos = n(w.todos);
  const parts: string[] = [];
  if (pomodoros) parts.push(pomodoros === 1 ? "1 Pomodoro terminé" : `${pomodoros} Pomodoros terminés`);
  if (minutes) parts.push(`${focusText(minutes)} de concentration`);
  if (todos) parts.push(todos === 1 ? "1 tâche cochée" : `${todos} tâches cochées`);
  return parts;
}
