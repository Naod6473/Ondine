// La section « Limites du forfait » de l'onglet Agents IA (1.2.4) : Claude
// (fenêtre de 5 h et semaine, données par sa ligne d'état) et Codex (lues
// dans ses journaux, ou « Demander à Codex » sur un clic). La logique est dans
// plan.ts, la lecture dans src-tauri/src/modules/agents_plan.rs.
//
// Une jauge par fenêtre : la barre se remplit (transition CSS sur `scale`,
// coupée avec « Réduire les animations »), normale, jaune dès 75 %, rouge dès
// 90 %. Le texte dit aussi le % : la couleur ne porte pas seule l'information.

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { ageText, effectivePct, pctText, planLevel, resetText, type PlanLimits, type PlanReport, type PlanWindow } from "./plan";

export interface PlanSection {
  box: HTMLElement;
  /** Relit les limites (mémoire de l'île et journaux de Codex : rien ne part). */
  load(): Promise<void>;
}

export function planOn(api: ModuleApi): boolean {
  return api.settings().planLimits !== false;
}

/** Une jauge : « 5 h · 42 % · remise à zéro dans 1 h 20 ». */
function gauge(label: string, w: PlanWindow, week: boolean): HTMLElement {
  const pct = effectivePct(w);
  const fill = el("i", { class: "agents-plan-fill" });
  fill.style.setProperty("--pct", String(pct / 100));
  return el(
    "div",
    { class: `agents-plan-gauge ${planLevel(pct)}` },
    el("span", { class: "agents-plan-label" }, label),
    el("span", { class: "agents-plan-bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct)), "aria-label": label }, fill),
    el("b", { class: "agents-plan-pct" }, pctText(pct)),
    el("small", { class: "muted" }, resetText(w, week)),
  );
}

function gauges(l: PlanLimits): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (l.fiveHour) out.push(gauge("5 h", l.fiveHour, false));
  if (l.week) out.push(gauge("Semaine", l.week, true));
  return out;
}

export function planSection(api: ModuleApi): PlanSection {
  const box = el("section", { class: "agents-usage agents-plan" });
  let report: PlanReport | null = null;
  let error = "";
  let busy = "";

  const act = (what: string, command: string, done: (r: unknown) => string) =>
    api.handler(async () => {
      busy = what;
      draw();
      try {
        const r = await api.invoke(command);
        api.notify({ title: done(r), icon: "📊", priority: "low", key: "agents-plan" });
      } catch (err) {
        api.notify({ title: "Limites du forfait", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-plan" });
      }
      busy = "";
      await load();
    });

  const install = act("install", "plan_install", (r) =>
    (r as { kept?: boolean } | null)?.kept ? "Ligne d'état branchée (la vôtre continue de s'afficher)" : "Ligne d'état branchée",
  );
  const remove = act("remove", "plan_remove", () => "Ligne d'état d'Ondine retirée");
  const askCodex = act("codex", "plan_codex", () => "Limites de Codex mises à jour");

  const claudeCard = (): HTMLElement => {
    const head = el("div", { class: "agents-plan-head" }, el("b", {}, "Claude"));
    const r = report!;
    if (r.claude) {
      head.append(el("small", { class: "muted" }, ageText(r.claude.updatedAt)));
      const off = el("button", { class: "btn small", title: "Remettre la ligne d'état d'avant dans Claude Code", disabled: busy !== "", onclick: remove }, "Débrancher");
      return el("div", { class: "agents-plan-card" }, head, ...gauges(r.claude), r.line === "installed" ? el("div", { class: "btn-row" }, off) : null);
    }
    const plug = el(
      "button",
      { class: "btn small", title: "Ajoute « ondine.exe statusline » comme ligne d'état dans le fichier de réglages de Claude Code (copie de sécurité avant)", disabled: busy !== "", onclick: install },
      busy === "install" ? "Branchement…" : "Brancher la ligne d'état",
    );
    const text = {
      installed: "En attente de Claude Code : les chiffres arrivent à son prochain message (forfaits Pro et Max seulement, pas avec une clé API).",
      stale: "La ligne d'état vise un autre ondine.exe : branchez-la de nouveau.",
      other: "Claude Code donne ses limites à sa ligne d'état. Ondine peut s'y brancher : votre ligne d'état actuelle continuera de s'afficher.",
      absent: "Claude Code donne ses limites à sa ligne d'état. Ondine peut s'y brancher, sur ce PC, sans rien envoyer.",
      unreadable: "Le fichier de réglages de Claude Code est illisible : Ondine n'y touche pas.",
    }[r.line];
    const buttons = r.line === "installed" ? [el("button", { class: "btn small", disabled: busy !== "", onclick: remove }, "Débrancher")] : r.line === "unreadable" ? [] : [plug];
    return el("div", { class: "agents-plan-card" }, head, el("p", { class: "muted" }, text), buttons.length ? el("div", { class: "btn-row" }, ...buttons) : null);
  };

  const codexCard = (): HTMLElement => {
    const r = report!;
    const head = el("div", { class: "agents-plan-head" }, el("b", {}, "Codex"));
    if (r.codex?.plan) head.append(el("small", { class: "muted", "data-no-i18n": "" }, r.codex.plan));
    if (r.codex) head.append(el("small", { class: "muted" }, ageText(r.codex.updatedAt)));
    const ask = el(
      "button",
      { class: "btn small", title: "Lance « codex app-server » sur ce PC : Codex interroge OpenAI avec sa propre connexion. Ondine n'envoie rien elle-même.", disabled: busy !== "", onclick: askCodex },
      busy === "codex" ? "Codex répond…" : "Demander à Codex",
    );
    const body = r.codex ? gauges(r.codex) : [el("p", { class: "muted" }, "Rien dans les journaux de Codex sur ce PC pour l'instant.")];
    return el("div", { class: "agents-plan-card" }, head, ...body, el("div", { class: "btn-row" }, ask));
  };

  const draw = () => {
    if (!planOn(api)) return box.replaceChildren();
    const head = el("div", { class: "agents-usage-head" }, el("b", {}, "Limites du forfait"));
    if (!report) return box.replaceChildren(head, el("p", { class: "muted" }, error || "Lecture…"));
    box.replaceChildren(head, el("div", { class: "agents-plan-cards" }, claudeCard(), codexCard()));
  };

  const load = async () => {
    if (!planOn(api)) return draw();
    try {
      report = await api.invoke<PlanReport>("plan");
      error = "";
    } catch (err) {
      report = null;
      error = errorText(err);
    }
    draw();
  };
  draw();
  return { box, load };
}
