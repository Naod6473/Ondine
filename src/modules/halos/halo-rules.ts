// Les règles des moments du module « Animations de l'île », sans DOM
// (testées par tests/front/halo.test.ts).

/** « 18:00 » → minutes depuis minuit ; null si vide ou mal écrit. */
export function parseTime(text: unknown): number | null {
  const m = /^\s*(\d{1,2})\s*[:hH.]\s*(\d{2})?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** « 2026-10-10 » : le jour local, pour ne faire une chose qu'une fois par jour. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * L'heure de partir est-elle venue ? Du lundi au vendredi, entre l'heure
 * choisie et une demi-heure après (un PC rallumé à 21 h ne dit plus rien), une
 * fois par jour.
 */
export function leaveDue(now: Date, leave: number | null, lastDay: string): boolean {
  if (leave == null) return false;
  const wd = now.getDay();
  if (wd === 0 || wd === 6) return false;
  if (lastDay === dayKey(now)) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= leave && mins < leave + 30;
}

/**
 * Le bonjour du matin : la première activité de la journée (personne n'a
 * touché au PC depuis moins d'une minute), entre 5 h et midi, une fois par jour.
 */
export function morningDue(now: Date, idleMs: number, lastDay: string): boolean {
  const h = now.getHours();
  return h >= 5 && h < 12 && idleMs < 60_000 && lastDay !== dayKey(now);
}

/** Pluie, orage, ou rien, d'après l'icône de la météo (module Météo). */
export function weatherKind(icon: unknown): "rain" | "storm" | null {
  const i = String(icon ?? "");
  if (i.includes("⛈")) return "storm";
  if (i.includes("🌧") || i.includes("🌦")) return "rain";
  return null;
}

/**
 * Le rendez-vous qui approche : une comète toutes les 30 s, de plus en plus
 * vite (un tour en 2,4 s à 5 min, en 0,9 s à l'heure dite).
 */
export function meetingCometMs(msLeft: number): number {
  const f = Math.max(0, Math.min(1, msLeft / (5 * 60_000)));
  return Math.round(900 + 1500 * f);
}

/** La jauge d'une séance (0 à 1) : ce qui est déjà fait. */
export function sessionProgress(now: number, endsAt: number | null, total: number): number {
  if (!endsAt || !(total > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - (endsAt - now) / total));
}

/** Le niveau sonore lu (0 à 1, un pic) → la force du halo : les voix douces se voient aussi. */
export function levelFromPeak(peak: number | null | undefined): number {
  if (peak == null || !Number.isFinite(peak) || peak <= 0.01) return 0;
  return Math.max(0, Math.min(1, Math.sqrt(peak) * 1.4));
}

/**
 * La musique joue-t-elle, d'après « media.changed » (module Musique) ? Le
 * module publie `{playing: {status: "playing" | "paused" | "changing" | …} | null}`.
 * null : on ne sait pas (le lecteur change de morceau), on garde l'état d'avant.
 */
export function mediaPlaying(p: unknown): boolean | null {
  const playing = (p as { playing?: unknown } | null)?.playing;
  if (!playing || typeof playing !== "object") return false;
  const status = (playing as { status?: unknown }).status;
  if (status === "changing") return null;
  return status === "playing";
}

/** Ce que publie le Minuteur à chaque changement (« timer.progress »). */
export interface TimerProgress {
  id?: unknown;
  phase?: unknown;
  state?: unknown;
  endsAt?: unknown;
  total?: unknown;
  left?: unknown;
}

/** Ce que le liseré d'un minuteur doit faire. */
export type TimerHaloPlan =
  | { action: "show"; id: string; palette: "timer" | "tomato" | "rest"; endsAt: number | null; total: number; fill: number }
  | { action: "done"; id: string; palette: "done" | "bloom" | "rest" }
  | { action: "hide"; id: string };

/**
 * Le liseré d'un minuteur, d'après « timer.progress » : il tourne (il se vide
 * jusqu'à `endsAt`), il est en pause (figé à ce qui reste), il vient de finir
 * (un éclat), ou plus rien. Un id par compte à rebours (Minuteur, Pomodoro).
 * La couleur suit la phase : minuteur, travail (tomate), pause (menthe).
 */
export function timerHaloPlan(p: TimerProgress | null | undefined): TimerHaloPlan | null {
  const which = p?.id === "pomodoro" ? "pomodoro" : p?.id === "timer" ? "timer" : null;
  if (!which) return null;
  const id = `timer-${which}`;
  const phase = which === "timer" ? "timer" : p?.phase === "short" || p?.phase === "long" ? "rest" : "work";
  const total = typeof p?.total === "number" && p.total > 0 ? p.total : 0;
  if (p?.state === "done") return { action: "done", id: `${id}-done`, palette: phase === "work" ? "bloom" : phase === "rest" ? "rest" : "done" };
  if (!total || (p?.state !== "running" && p?.state !== "paused")) return { action: "hide", id };
  const palette = phase === "work" ? "tomato" : phase === "rest" ? "rest" : "timer";
  if (p.state === "running" && typeof p.endsAt === "number") return { action: "show", id, palette, endsAt: p.endsAt, total, fill: 1 };
  const left = typeof p.left === "number" ? p.left : 0;
  return { action: "show", id, palette, endsAt: null, total, fill: Math.max(0, Math.min(1, left / total)) };
}
