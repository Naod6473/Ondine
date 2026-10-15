// Les limites du forfait (onglet Agents IA, 1.2.4) : la logique sans DOM,
// testée dans tests/front/agents-plan.test.ts. La vue est dans plan-view.ts,
// la lecture des chiffres dans src-tauri/src/modules/agents_plan.rs.

/** Une fenêtre de limite : % utilisé (0 à 100) et remise à zéro (ms). */
export interface PlanWindow {
  pct: number;
  resetsAt: number;
}

/** Les limites d'un outil, telles que le Rust les rend (commande « plan »). */
export interface PlanLimits {
  fiveHour: PlanWindow | null;
  week: PlanWindow | null;
  /** Codex : le nom du forfait (« plus », « pro »). */
  plan?: string | null;
  updatedAt: number;
}

export interface PlanReport {
  claude: PlanLimits | null;
  /** La ligne d'état de Claude Code : installed, stale, other, absent, unreadable. */
  line: "installed" | "stale" | "other" | "absent" | "unreadable";
  file: string;
  codex: PlanLimits | null;
}

/** Le niveau d'une jauge : normal, jaune dès 75 %, rouge dès 90 %. */
export type PlanLevel = "ok" | "warn" | "high";

export const WARN_PCT = 75;
export const HIGH_PCT = 90;

export function planLevel(pct: number): PlanLevel {
  if (pct >= HIGH_PCT) return "high";
  if (pct >= WARN_PCT) return "warn";
  return "ok";
}

/** Le % à montrer : 0 une fois l'heure de la remise à zéro passée. */
export function effectivePct(w: PlanWindow, now = Date.now()): number {
  if (w.resetsAt <= now) return 0;
  return Math.max(0, Math.min(100, w.pct));
}

/** Le plus haut des deux % (pour l'Accueil ou un résumé) ; null sans chiffres. */
export function highestPct(l: PlanLimits | null | undefined, now = Date.now()): number | null {
  const all = [l?.fiveHour, l?.week].filter((w): w is PlanWindow => !!w).map((w) => effectivePct(w, now));
  return all.length ? Math.max(...all) : null;
}

const DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/**
 * La remise à zéro : « dans 1 h 20 » ou « dans 5 min » (fenêtre de 5 h),
 * « lun. 9:00 » (la semaine), « en cours… » une fois l'heure passée.
 */
export function resetText(w: PlanWindow, week: boolean, now = Date.now()): string {
  const secs = (w.resetsAt - now) / 1000;
  if (secs <= 0) return "remise à zéro en cours…";
  if (week && secs > 24 * 3600) {
    const d = new Date(w.resetsAt);
    return `remise à zéro ${DAYS[d.getDay()]} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `remise à zéro dans ${h} h ${String(m).padStart(2, "0")}` : `remise à zéro dans ${Math.max(1, m)} min`;
}

/** « lu à l'instant », « lu il y a 12 min », « lu il y a 3 h ». */
export function ageText(updatedAt: number, now = Date.now()): string {
  const mins = Math.floor((now - updatedAt) / 60000);
  if (mins < 1) return "lu à l'instant";
  return mins < 60 ? `lu il y a ${mins} min` : `lu il y a ${Math.floor(mins / 60)} h`;
}

/** « 42 % ». */
export function pctText(pct: number): string {
  return `${Math.round(pct)} %`;
}
