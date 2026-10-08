// La section « Utilisation des agents » de l'onglet Agents IA : le compteur de
// jetons (commande « usage », src-tauri/src/modules/agents_usage.rs), avec la
// courbe des 30 jours, le coût estimé (grille de prix du réglage `prices`,
// src/modules/agents/cost.ts), le bouton « Exporter en CSV » (commande
// « usage_csv ») et l'alerte de budget (réglage `dailyBudget`).
//
// L'alerte de budget est vérifiée à chaque relecture du compteur (onglet
// ouvert), et par `watchBudget` : une relecture légère (le jour seulement)
// toutes les 15 minutes depuis setup(), tant que le budget est > 0. Une seule
// notification par jour, et la mascotte s'inquiète.

import { errorText } from "../../core/log";
import { t } from "../../core/i18n";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { pacedInterval } from "../../core/perf";
import { chartDays, costOfRows, costText, dayLabel, parsePrices, priceFor, projectCost, usageCsv, type Price } from "./cost";
import { byModel, modelLabel, periodFrom, sumTokens, tokensShort, totalTokens, type UsagePeriod, type UsageReport } from "./texts";

/** Le nom affiché d'un outil (journaux). */
const TOOL_NAMES: Record<string, string> = { "claude-code": "Claude", codex: "Codex", gemini: "Gemini" };
/** La couleur de chaque outil dans la courbe (validées : lisibles sur tous les fonds de l'île, daltonisme compris). */
const TOOL_COLORS: Record<string, string> = { "claude-code": "#4a9ad8", codex: "#c47a30" };
const OTHER_COLOR = "#8a8f9f";
/** Le jour de la dernière alerte de budget (gardé dans le navigateur de l'île : une seule par jour, même après un redémarrage). */
const BUDGET_KEY = "agents.budget-alerted";

/** Les réglages du compteur, tels que lus dans `api.settings()`. */
function prices(api: ModuleApi): Price[] {
  return parsePrices(String(api.settings().prices ?? ""));
}
function dailyBudget(api: ModuleApi): number {
  const n = Number(api.settings().dailyBudget ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export function usageOn(api: ModuleApi): boolean {
  return api.settings().usage !== false;
}

/** Le jour local « AAAA-MM-JJ » d'aujourd'hui. */
function today(): string {
  return periodFrom("today");
}

/** Le coût du jour, d'après un rapport (toute période). */
export function todayCost(report: UsageReport, grid: Price[]): number {
  const day = today();
  return costOfRows(
    report.days.filter((d) => d.day === day),
    grid,
  );
}

/**
 * Le budget du jour est-il dépassé ? Si oui, une notification (une par jour)
 * et la mascotte s'inquiète. Rend vrai si l'alerte vient d'être montrée.
 */
export function checkBudget(api: ModuleApi, report: UsageReport): boolean {
  const budget = dailyBudget(api);
  if (!budget) return false;
  const cost = todayCost(report, prices(api));
  if (cost <= budget) return false;
  const day = today();
  let last = "";
  try {
    last = localStorage.getItem(BUDGET_KEY) ?? "";
  } catch {
    // stockage indisponible : on avertira à chaque relecture
  }
  if (last === day) return false;
  try {
    localStorage.setItem(BUDGET_KEY, day);
  } catch {
    // tant pis
  }
  api.notify({
    title: "Budget du jour dépassé",
    body: `Les agents ont consommé ${costText(cost)} aujourd'hui, pour un budget de ${costText(budget)}.`,
    icon: "💸",
    priority: "high",
    key: "agents-budget",
  });
  api.emit("mascot.emote", { emotion: "worried" });
  return true;
}

/**
 * Depuis setup() : tant que le budget est > 0, relit le jour toutes les 15
 * minutes (cadence `agentsBudget`), sans ouvrir l'onglet. Rend l'arrêt.
 */
export function watchBudget(api: ModuleApi): () => void {
  const tick = async () => {
    if (!usageOn(api) || !dailyBudget(api)) return;
    try {
      const report = await api.invoke<UsageReport>("usage", { offsetMinutes: new Date().getTimezoneOffset(), days: 1 });
      checkBudget(api, report);
    } catch (e) {
      api.log.warn(`budget des agents : ${String(e)}`);
    }
  };
  return pacedInterval(() => void tick(), "agentsBudget");
}

/** Ce que la vue de l'onglet reçoit : la section, sa relecture, son arrêt. */
export interface UsageSection {
  box: HTMLElement;
  /** Relit les journaux (au plus toutes les 60 s, sauf `force`). */
  load(force?: boolean): Promise<void>;
  stop(): void;
}

export function usageSection(api: ModuleApi): UsageSection {
  const box = el("section", { class: "agents-usage" });
  let period: UsagePeriod = "week";
  let usage: UsageReport | null = null;
  let usageError = "";
  let usageFetch = 0;

  const exportCsv = async () => {
    if (!usage) return;
    try {
      const r = await api.invoke<{ name: string; shelf: boolean } | null>("usage_csv", { text: usageCsv(usage, prices(api)) });
      api.notify({
        title: "Export CSV enregistré",
        body: r ? `${r.name} · Téléchargements${r.shelf ? " · déposé sur l'étagère" : ""}` : "Dans vos Téléchargements.",
        icon: "📄",
        priority: "low",
        key: "agents-csv",
      });
    } catch (err) {
      api.notify({ title: "Export impossible", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-csv" });
    }
  };

  const draw = () => {
    if (!usageOn(api)) return box.replaceChildren();
    const chip = (p: UsagePeriod, label: string) =>
      el(
        "button",
        {
          class: `net-chip${p === period ? " on" : ""}`,
          onclick: api.handler(() => {
            period = p;
            draw();
          }),
        },
        label,
      );
    const head = el(
      "div",
      { class: "agents-usage-head" },
      el("b", {}, "Utilisation des agents"),
      el(
        "div",
        { class: "net-chips" },
        chip("today", "Aujourd'hui"),
        chip("week", "7 jours"),
        chip("month", "30 jours"),
        el("button", { class: "net-chip", title: "Relire les journaux", onclick: api.handler(() => load(true)) }, "↻"),
      ),
    );
    if (!usage) return box.replaceChildren(head, el("p", { class: "muted" }, usageError ? t(usageError) : "Lecture des journaux…"));
    const from = periodFrom(period);
    const rows = usage.days.filter((d) => d.day >= from);
    if (!rows.length) {
      return box.replaceChildren(head, el("p", { class: "muted" }, usage.files ? "Rien sur cette période." : "Aucun journal de Claude Code ni de Codex sur ce PC."));
    }
    const grid = prices(api);
    const sum = sumTokens(rows);
    const total = costOfRows(rows, grid);
    const figure = (label: string, n: number) => el("span", { class: "agents-usage-figure" }, el("span", {}, label), " ", el("b", {}, tokensShort(n)));
    const figures = el(
      "p",
      { class: "agents-usage-figures" },
      figure("Entrée", sum.input),
      figure("Sortie", sum.output),
      figure("Cache lu", sum.cacheRead),
      figure("Cache écrit", sum.cacheWrite),
      el("span", { class: "muted" }, `${sum.messages.toLocaleString("fr-FR")} réponse${sum.messages > 1 ? "s" : ""}`),
      el("b", { class: "agents-usage-cost", title: "Coût estimé d'après la grille de prix des réglages (indicative)" }, costText(total)),
    );
    const models = el(
      "ul",
      { class: "agents-usage-list" },
      ...byModel(rows).map((m) => {
        const price = priceFor(m.model, grid);
        const cost = costOfRows(
          rows.filter((r) => r.tool === m.tool && r.model === m.model),
          grid,
        );
        return el(
          "li",
          {},
          el("span", {}, `${TOOL_NAMES[m.tool] ?? m.tool} · ${modelLabel(m.model)}`),
          el("b", {}, tokensShort(m.total)),
          price ? el("span", { class: "muted agents-usage-cost" }, costText(cost)) : el("span", { class: "muted", title: "Aucune ligne de la grille de prix ne correspond à ce modèle" }, "prix ?"),
        );
      }),
    );
    const budget = dailyBudget(api);
    const todays = todayCost(usage, grid);
    const budgetLine = budget
      ? el(
          "p",
          { class: `muted agents-usage-budget${todays > budget ? " over" : ""}` },
          `Aujourd'hui : ${costText(todays)} sur un budget de ${costText(budget)}${todays > budget ? " · dépassé" : ""}`,
        )
      : null;
    const projects = usage.projects.length
      ? el(
          "p",
          { class: "muted" },
          el("span", {}, "Projets (30 jours)"),
          " : ",
          usage.projects.map((p) => `${p.name} ${tokensShort(totalTokens(p))} (${costText(projectCost(p, usage!.days, grid))})`).join(" · "),
        )
      : null;
    const note = el("p", { class: "muted" }, usage.partial ? "Journaux trop nombreux : compte partiel (les plus récents d'abord)." : "Lu dans les journaux de Claude Code et Codex sur ce PC. Rien n'est envoyé. Coûts indicatifs.");
    const actions = el("div", { class: "btn-row" }, el("button", { class: "btn small", title: "Un fichier CSV (30 jours, par jour et par projet) dans vos Téléchargements", onclick: api.handler(exportCsv) }, "Exporter en CSV"));
    box.replaceChildren(head, chart(usage, grid), figures, models, ...(budgetLine ? [budgetLine] : []), ...(projects ? [projects] : []), actions, note);
  };

  /** Relit les journaux (au plus toutes les 60 s, sauf « ↻ »). */
  const load = async (force = false) => {
    if (!usageOn(api) || (!force && Date.now() - usageFetch < 60_000)) return;
    usageFetch = Date.now();
    try {
      usage = await api.invoke<UsageReport>("usage", { offsetMinutes: new Date().getTimezoneOffset(), days: 30 });
      usageError = "";
      checkBudget(api, usage);
    } catch (e) {
      usage = null;
      usageError = errorText(e);
    }
    draw();
  };
  draw();
  const stopSettings = api.onSettingsChange(() => {
    draw();
    void load();
  });
  return { box, load, stop: stopSettings };
}

// ── La courbe des 30 jours ───────────────────────────────────────────────────

const SVG = "http://www.w3.org/2000/svg";
const W = 320;
const H = 56;
const GAP = 2;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/**
 * Trente barres (un jour chacune), empilées par outil, 100 % maison. Au
 * survol d'un jour : sa date, son total et son coût dans la légende sous la
 * courbe. Les couleurs ne portent pas seules l'information : la légende nomme
 * chaque outil, et le survol donne les chiffres.
 */
function chart(report: UsageReport, grid: Price[]): HTMLElement {
  const tools = report.tools.length ? report.tools : ["claude-code"];
  const days = chartDays(report.days, tools, 30);
  const max = Math.max(1, ...days.map((d) => d.total));
  const barW = (W - GAP * (days.length - 1)) / days.length;
  const graph = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "agents-chart", role: "img", "aria-label": "Jetons par jour, 30 jours" });
  // La ligne de base.
  graph.append(svg("line", { x1: 0, y1: H - 0.5, x2: W, y2: H - 0.5, class: "agents-chart-base" }));
  const monthTotal = days.reduce((a, d) => a + d.total, 0);
  const caption = el("span", { class: "muted agents-chart-caption" });
  const rest = () => (caption.textContent = `30 jours : ${tokensShort(monthTotal)} jetons`);
  rest();
  days.forEach((d, i) => {
    const x = i * (barW + GAP);
    const g = svg("g", { class: "agents-chart-day" });
    // Une barre invisible sur toute la hauteur : la cible du survol, plus large que la barre.
    g.append(svg("rect", { x, y: 0, width: barW, height: H, fill: "transparent" }));
    let y = H - 1;
    d.byTool.forEach((n, ti) => {
      if (!n) return;
      const h = Math.max(1.5, ((H - 4) * n) / max);
      y -= h;
      g.append(svg("rect", { x, y, width: barW, height: h, rx: 1.5, fill: TOOL_COLORS[tools[ti]] ?? OTHER_COLOR, class: "bar" }));
      y -= GAP;
    });
    const day = dayLabel(d.day);
    const cost = costOfRows(
      report.days.filter((r) => r.day === d.day),
      grid,
    );
    const text = d.total ? `${day} : ${tokensShort(d.total)} jetons · ${costText(cost)}` : `${day} : rien`;
    const title = svg("title", {});
    title.textContent = text;
    g.append(title);
    g.addEventListener("mouseenter", () => (caption.textContent = text));
    g.addEventListener("mouseleave", rest);
    graph.append(g);
  });
  const legend = el(
    "span",
    { class: "agents-chart-legend" },
    ...tools.map((tool) => el("span", {}, el("i", { class: "agents-chart-swatch", style: `background:${TOOL_COLORS[tool] ?? OTHER_COLOR}` }), TOOL_NAMES[tool] ?? tool)),
  );
  return el("div", { class: "agents-chart-box" }, graph, el("div", { class: "agents-chart-foot" }, caption, legend));
}
