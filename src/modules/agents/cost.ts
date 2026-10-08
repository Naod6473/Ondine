// Le coût estimé des jetons, la grille de prix, la courbe des 30 jours et le
// CSV : la logique pure du compteur de jetons (sans DOM ni Tauri), testée dans
// tests/front/agents.test.ts.
//
// La grille de prix est un texte (réglage `prices` du module), une ligne par
// modèle : « début du nom ; entrée ; sortie ; cache lu ; cache écrit », en $
// par million de jetons. La première ligne dont le début correspond au nom
// du modèle (sans tenir compte de la casse) donne son prix ; un modèle sans
// ligne ne coûte rien et n'est pas compté dans l'estimation.

import { dayKey, modelLabel, totalTokens, type UsageDay, type UsageProject, type UsageReport, type UsageTokens } from "./texts";

/** Le prix d'un modèle, en $ par million de jetons. */
export interface Price {
  /** Le début du nom du modèle (« claude-opus », « gpt-5 »), en minuscules. */
  prefix: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * La grille par défaut : des ordres de grandeur publics, INDICATIFS, à
 * vérifier sur les sites des éditeurs. Cache lu = 10 % de l'entrée, cache
 * écrit = 125 % de l'entrée (la règle habituelle d'Anthropic) ; Codex n'écrit
 * pas de cache. « gpt-5-codex » avant « gpt-5 » : la ligne la plus précise d'abord.
 */
export const DEFAULT_PRICES = [
  "claude-opus ; 15 ; 75 ; 1,5 ; 18,75",
  "claude-sonnet ; 3 ; 15 ; 0,3 ; 3,75",
  "claude-haiku ; 1 ; 5 ; 0,1 ; 1,25",
  "claude-3-5-haiku ; 0,8 ; 4 ; 0,08 ; 1",
  "gpt-5-codex ; 1,25 ; 10 ; 0,125 ; 0",
  "gpt-5 ; 1,25 ; 10 ; 0,125 ; 0",
].join("\n");

/** « 1,5 » ou « 1.5 » → 1.5 ; sinon null. */
function money(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Lit la grille. Une ligne mal formée (moins de deux nombres, nombre
 * négatif…) est ignorée ; cache lu et cache écrit manquants valent 10 % et
 * 125 % de l'entrée. Les commentaires (« # … ») et les lignes vides sont passés.
 */
export function parsePrices(text: string): Price[] {
  const out: Price[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(";").map((p) => p.trim());
    const prefix = (parts[0] ?? "").toLowerCase();
    const input = money(parts[1] ?? "");
    const output = money(parts[2] ?? "");
    if (!prefix || input === null || output === null) continue;
    const cacheRead = parts[3] ? money(parts[3]) : null;
    const cacheWrite = parts[4] ? money(parts[4]) : null;
    out.push({ prefix, input, output, cacheRead: cacheRead ?? input * 0.1, cacheWrite: cacheWrite ?? input * 1.25 });
  }
  return out;
}

/** Le prix d'un modèle : la première ligne dont le début correspond. */
export function priceFor(model: string, prices: Price[]): Price | null {
  const m = model.trim().toLowerCase();
  return prices.find((p) => m.startsWith(p.prefix)) ?? null;
}

/** Le coût en $ d'un compte de jetons (0 sans prix). */
export function costOf(t: UsageTokens, price: Price | null): number {
  if (!price) return 0;
  return (t.input * price.input + t.output * price.output + t.cacheRead * price.cacheRead + t.cacheWrite * price.cacheWrite) / 1e6;
}

/** Le coût d'un ensemble de lignes (chacune avec son modèle). */
export function costOfRows(rows: (UsageTokens & { model: string })[], prices: Price[]): number {
  return rows.reduce((sum, r) => sum + costOf(r, priceFor(r.model, prices)), 0);
}

/**
 * « ≈ 12,40 $ », « ≈ 0,03 $ », « ≈ 1 250 $ » : le symbole après le nombre, à
 * la française. Moins d'un centime : « < 0,01 $ ».
 */
export function costText(usd: number): string {
  if (!(usd > 0)) return "≈ 0 $";
  if (usd < 0.01) return "< 0,01 $";
  const digits = usd < 100 ? 2 : 0;
  return `≈ ${usd.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
}

/** « 12,40 » pour le CSV (virgule décimale, 4 décimales au plus, sans séparateur de milliers). */
export function csvNumber(n: number): string {
  return (Math.round(n * 10000) / 10000).toString().replace(".", ",");
}

/** Le coût d'un projet : ses jetons au prix du modèle le plus utilisé par cet outil (les projets n'ont pas de modèle). */
export function projectCost(p: UsageProject, days: UsageDay[], prices: Price[]): number {
  const byModel = new Map<string, number>();
  for (const d of days) {
    if (d.tool === p.tool) byModel.set(d.model, (byModel.get(d.model) ?? 0) + totalTokens(d));
  }
  const top = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? costOf(p, priceFor(top[0], prices)) : 0;
}

// ── La courbe des 30 jours ───────────────────────────────────────────────────

export interface ChartDay {
  day: string;
  /** Le total par outil (« claude-code », « codex »), dans l'ordre de `tools`. */
  byTool: number[];
  total: number;
}

/** Un point par jour, les `count` derniers jours jusqu'à `now`, même sans jetons. */
export function chartDays(rows: UsageDay[], tools: string[], count = 30, now = new Date()): ChartDay[] {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const i = tools.indexOf(r.tool);
    if (i < 0) continue;
    const arr = map.get(r.day) ?? tools.map(() => 0);
    arr[i] += totalTokens(r);
    map.set(r.day, arr);
  }
  const out: ChartDay[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const day = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
    const byTool = map.get(day) ?? tools.map(() => 0);
    out.push({ day, byTool, total: byTool.reduce((a, b) => a + b, 0) });
  }
  return out;
}

/** « 8 oct. » pour l'étiquette d'un jour « 2026-10-08 ». */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// ── Le CSV ───────────────────────────────────────────────────────────────────

/** Une cellule : entre guillemets si elle contient « ; », un guillemet ou un retour à la ligne. */
function cell(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Le CSV du compteur : un bloc par jour, outil et modèle, une ligne vide, puis
 * un bloc par projet. Séparateur « ; », virgule décimale (Excel en français),
 * lignes CRLF. Le BOM est ajouté par le Rust à l'écriture.
 */
export function usageCsv(report: UsageReport, prices: Price[]): string {
  const lines: string[] = [];
  lines.push(["Jour", "Outil", "Modèle", "Entrée", "Sortie", "Cache lu", "Cache écrit", "Réponses", "Coût estimé ($)"].join(";"));
  for (const d of report.days) {
    const cost = costOf(d, priceFor(d.model, prices));
    lines.push([d.day, d.tool, cell(modelLabel(d.model)), d.input, d.output, d.cacheRead, d.cacheWrite, d.messages, csvNumber(cost)].join(";"));
  }
  lines.push("");
  lines.push(["Projet", "Outil", "Entrée", "Sortie", "Cache lu", "Cache écrit", "Réponses", "Coût estimé ($)"].join(";"));
  for (const p of report.projects) {
    lines.push([cell(p.name), p.tool, p.input, p.output, p.cacheRead, p.cacheWrite, p.messages, csvNumber(projectCost(p, report.days, prices))].join(";"));
  }
  return lines.join("\r\n") + "\r\n";
}
