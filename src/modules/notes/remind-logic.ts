// Les rappels des tâches (module Notes, 1.2.5) : ce qui se calcule sans
// l'interface, pour être testé (tests/front/notes-remind.test.ts).
//
// Une tâche peut avoir une heure (`remindAt`, ms depuis 1970). Le Rust la
// garde avec `reminded` (l'alerte a été faite) ; le front regarde toutes les
// 15 s ce qui est dû. Ce qui est dû mais pas encore dit (PC en veille, appli
// fermée, concentration, présentation) est rattrapé au tour suivant : une
// seule alerte, « 2 rappels manqués » s'il y en a plusieurs.

/** Ce qu'il faut savoir d'une tâche pour son rappel. */
export interface Remindable {
  id: number;
  text: string;
  done: boolean;
  remindAt?: number;
  reminded?: boolean;
}

const MINUTE = 60_000;
/** Un rappel qui arrive dans moins de… passe en jaune. */
export const SOON_MS = 30 * MINUTE;
/** « 10 min » repousse de… */
export const SNOOZE_MS = 10 * MINUTE;
/** Au-delà de ce retard, l'alerte dit « Prévu à 15:00 » plutôt que « Il est 15:00 ». */
export const LATE_MS = 2 * MINUTE;

/** Le rappel attend encore son alerte (tâche à faire, pas encore dit). */
function pending(t: Remindable): t is Remindable & { remindAt: number } {
  return !t.done && !t.reminded && typeof t.remindAt === "number";
}

/** Les rappels dont l'heure est passée et qui n'ont pas encore été dits, le plus ancien d'abord. */
export function dueReminders<T extends Remindable>(todos: readonly T[], now: number): T[] {
  return todos.filter((t) => pending(t) && t.remindAt <= now).sort((a, b) => (a.remindAt ?? 0) - (b.remindAt ?? 0));
}

/** L'heure du prochain rappel à venir, ou null. */
export function nextReminder(todos: readonly Remindable[], now: number): number | null {
  let next: number | null = null;
  for (const t of todos) {
    if (pending(t) && t.remindAt > now && (next === null || t.remindAt < next)) next = t.remindAt;
  }
  return next;
}

/** Le rappel arrive bientôt (dans moins de 30 min) : l'heure passe en jaune. */
export function isSoon(t: Remindable, now: number): boolean {
  return pending(t) && t.remindAt > now && t.remindAt - now <= SOON_MS;
}

/** « 10 min » : la nouvelle heure du rappel. */
export function snoozeAt(now: number): number {
  return now + SNOOZE_MS;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** « 09:05 ». */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minuit du jour de `ms` (heure locale). */
function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** L'heure affichée à droite de la tâche : « 15:00 » aujourd'hui, « Demain 09:00 », sinon « 20/10 09:00 ». */
export function reminderLabel(at: number, now: number): string {
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
  if (days === 0) return hhmm(at);
  if (days === 1) return `Demain ${hhmm(at)}`;
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hhmm(at)}`;
}

/** La valeur d'un champ date (« 2026-10-18 ») pour le jour de `ms`. */
export function dateValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Un jour (« 2026-10-18 ») et une heure (« 15:00 ») choisis → ms (heure locale), ou null si l'un est faux. */
export function atFrom(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const at = new Date(y, mo - 1, d, h, mi, 0, 0);
  // 31/02 : Date passerait au mois suivant sans rien dire.
  if (at.getDate() !== d || at.getMonth() !== mo - 1) return null;
  return at.getTime();
}

/** Les raccourcis du choix de l'heure. « Ce soir 18:00 » seulement avant 18 h. */
export function quickChoices(now: number): { label: string; at: number }[] {
  const out: { label: string; at: number }[] = [];
  // Dans 30 min, à la minute près (les secondes ne s'affichent pas).
  const soon = new Date(now + 30 * MINUTE);
  soon.setSeconds(0, 0);
  out.push({ label: "Dans 30 min", at: soon.getTime() });
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  if (evening.getTime() > now) out.push({ label: "Ce soir 18:00", at: evening.getTime() });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  out.push({ label: "Demain 9:00", at: tomorrow.getTime() });
  return out;
}

/** L'alerte à lever pour des rappels dus : une tâche, ou « 2 rappels manqués ». */
export type ReminderAlert<T extends Remindable> = { kind: "one"; todo: T; title: string; body: string } | { kind: "many"; todos: T[]; title: string; body: string };

export function reminderAlert<T extends Remindable>(due: readonly T[], now: number): ReminderAlert<T> | null {
  const first = due[0];
  if (!first) return null;
  if (due.length === 1) {
    const at = first.remindAt ?? now;
    // À l'heure : « Il est 15:00 » ; rattrapé plus tard (veille, concentration) : « Prévu à 15:00 ».
    const body = now - at <= LATE_MS ? `Il est ${hhmm(at)}` : `Prévu à ${reminderLabel(at, now)}`;
    return { kind: "one", todo: first, title: first.text, body };
  }
  const names = due.slice(0, 3).map((t) => t.text);
  const body = names.join(" · ") + (due.length > 3 ? " · …" : "");
  // Plusieurs à la même heure : « 2 rappels » ; au moins un rattrapé : « 2 rappels manqués ».
  const late = due.some((t) => now - (t.remindAt ?? now) > LATE_MS);
  return { kind: "many", todos: [...due], title: `${due.length} ${late ? "rappels manqués" : "rappels"}`, body };
}
