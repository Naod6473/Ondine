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
  /** Les agents IA de la semaine (commande « weekly » du module Agents IA), s'il y en a eu. */
  agents?: AgentsWeek | null;
}

/** Ce que le module Agents IA dit de la semaine (src-tauri/src/modules/agents_history.rs). */
export interface AgentsWeek {
  /** Tâches finies (« a fini »). */
  done: number;
  /** Le temps où un agent vous a attendu, en minutes. */
  waitMinutes: number;
  /** Les projets touchés (noms de dossiers), les plus actifs d'abord. */
  projects: string[];
  /** Les jetons de la semaine, par jour, outil et modèle (comme « usage »). */
  days: { day: string; tool: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; messages: number }[];
  /** La grille de prix du réglage `prices` du module Agents IA. */
  prices: string;
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

/**
 * La carte « Agents IA » du bilan, en morceaux (chacun traduit à part) :
 * « 23 tâches finies », « 2 h 10 d'attente de votre part », « 3,1 M de jetons
 * (≈ 12 $) », « projets : site-ondine, Island ». Rien si aucun agent dans la
 * semaine. `tokens` et `cost` viennent du compteur (src/modules/agents/cost.ts).
 */
export function agentsParts(a: AgentsWeek | null | undefined, tokens: string, cost: string): string[] {
  if (!a) return [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const done = n(a.done);
  const wait = n(a.waitMinutes);
  const parts: string[] = [];
  if (done) parts.push(done === 1 ? "1 tâche finie" : `${done} tâches finies`);
  if (wait) parts.push(`${focusText(wait)} d'attente de votre part`);
  if (tokens) parts.push(cost ? `${tokens} de jetons (${cost})` : `${tokens} de jetons`);
  const projects = (a.projects ?? []).filter((p) => typeof p === "string" && p).slice(0, 4);
  if (parts.length && projects.length) parts.push(`projets : ${projects.join(", ")}`);
  return parts;
}
