// Le « Bilan du jour » en image, sans DOM ni canvas : ce que la carte dit.
// Testé dans tests/front/day-card.test.ts ; le dessin est dans day-card.ts.
//
// Les chiffres viennent de la commande « day_card » (src-tauri/src/modules/
// agents.rs) : l'historique des agents sur le disque (tâches finies, attente,
// projets, heure par heure, depuis minuit) et les journaux de jetons de Claude
// Code et Codex (60 jours, pour la série de jours).

import { costOfRows, parsePrices } from "./cost";
import { dayKey, sumTokens, totalTokens, type UsageDay } from "./texts";

/** Ce que renvoie « day_card ». */
export interface DayCardData {
  /** Le jour local « AAAA-MM-JJ ». */
  today: string;
  done: number;
  waitMinutes: number;
  /** Les projets du jour (noms de dossiers), les plus actifs d'abord. */
  projects: string[];
  /** Les tâches finies de 0 h à 23 h. */
  hours: number[];
  longestMinutes: number;
  /** Les jours où un agent a fini ou attendu (historique, 7 jours). */
  activeDays: string[];
  /** Les jetons par jour, outil et modèle (60 jours). */
  days: UsageDay[];
  /** Le compteur de jetons est actif. */
  usage: boolean;
  prices: string;
}

/** Ce que la carte montre. */
export interface DayFigures {
  done: number;
  waitMinutes: number;
  tokens: number;
  /** En dollars (grille de prix des réglages) ; 0 si inconnu. */
  cost: number;
  /** Jours d'affilée avec des agents au travail (aujourd'hui compris s'il compte). */
  streak: number;
  longestMinutes: number;
  /** L'heure (0-23) où le plus de tâches ont fini, ou -1. */
  busiestHour: number;
  hours: number[];
  projects: string[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Le jour d'avant « AAAA-MM-JJ » (calendrier local, changements d'heure compris). */
export function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/**
 * Les jours d'affilée : depuis aujourd'hui s'il compte, sinon depuis hier
 * (la série n'est pas perdue tant que la journée n'est pas finie).
 */
export function streakDays(active: Iterable<string>, today: string): number {
  const set = new Set(active);
  let day = set.has(today) ? today : previousDay(today);
  let n = 0;
  // 400 : garde-fou (les journaux ne remontent pas si loin).
  while (set.has(day) && n < 400) {
    n++;
    day = previousDay(day);
  }
  return n;
}

/** Les chiffres de la carte, à partir de la réponse du Rust. */
export function dayFigures(d: DayCardData): DayFigures {
  const days = Array.isArray(d.days) ? d.days : [];
  const todayRows = days.filter((r) => r.day === d.today);
  const tokens = todayRows.length ? totalTokens(sumTokens(todayRows)) : 0;
  const cost = todayRows.length ? costOfRows(todayRows, parsePrices(d.prices ?? "")) : 0;
  const active = new Set((d.activeDays ?? []).filter((x) => typeof x === "string"));
  for (const r of days) if (totalTokens(r) > 0) active.add(r.day);
  const hours = Array.from({ length: 24 }, (_, i) => num(d.hours?.[i]));
  const max = Math.max(...hours);
  return {
    done: num(d.done),
    waitMinutes: num(d.waitMinutes),
    tokens,
    cost: cost > 0 && Number.isFinite(cost) ? cost : 0,
    streak: streakDays(active, d.today),
    longestMinutes: num(d.longestMinutes),
    busiestHour: max > 0 ? hours.indexOf(max) : -1,
    hours,
    projects: (d.projects ?? []).filter((p) => typeof p === "string" && p && p !== "—").slice(0, 3),
  };
}

/** Rien à montrer : ni tâche, ni attente, ni jetons aujourd'hui. */
export function emptyDay(f: DayFigures): boolean {
  return !f.done && !f.waitMinutes && !f.tokens;
}

/** Une tuile de la carte : le chiffre en grand, ce qu'il compte en dessous. */
export interface Tile {
  value: string;
  /** En français ; traduit au moment du dessin. */
  label: string;
  /** Une précision en petit (le coût), facultative. */
  note?: string;
}

/**
 * Les tuiles, dans l'ordre : tâches finies, attente, jetons, série. Une
 * attente nulle, un compteur de jetons éteint ou une série d'un jour ne
 * font pas de tuile ; les tâches finies sont toujours là.
 */
export function tiles(f: DayFigures, show: { cost: boolean }, fmt: { duration: (m: number) => string; tokens: (n: number) => string; cost: (usd: number) => string }): Tile[] {
  const out: Tile[] = [{ value: String(f.done), label: f.done > 1 ? "tâches finies" : "tâche finie" }];
  if (f.waitMinutes) out.push({ value: fmt.duration(f.waitMinutes), label: "à m'attendre" });
  if (f.tokens) out.push({ value: fmt.tokens(f.tokens), label: "jetons", note: show.cost && f.cost ? fmt.cost(f.cost) : undefined });
  if (f.streak >= 2) out.push({ value: String(f.streak), label: "jours d'affilée" });
  return out;
}
