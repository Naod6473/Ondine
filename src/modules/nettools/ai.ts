// Réseau → surveillance des services IA (réglage aiStatus, désactivé par
// défaut) : Claude, ChatGPT et Gemini marchent-ils ?
//
// Le Rust (src-tauri/src/modules/nettools_ai.rs) lit leurs pages d'état
// publiques toutes les 5 min (en pause pendant une présentation ou une
// concentration) et publie "nettools.ai-status" quand quelque chose change.
// Ici :
//   - la notification quand un service tombe ou revient ;
//   - quand un agent (Claude Code, Codex, Gemini CLI) prévient pendant un
//     incident de son service, une petite note « Claude a un incident en
//     cours » (au plus une fois par demi-heure) : si l'agent a calé, ce n'est
//     peut-être pas votre faute ;
//   - la carte de l'onglet : une pastille verte / orange / rouge par service,
//     et les pannes des 7 derniers jours.
// La pastille rouge de la mini-île est dans island.ts (même sujet).

import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { changeTitle, levelText, outageText, serviceOfAgent, type AiOutage, type AiReading } from "./ai-text";

let services: AiReading[] = [];
const hinted = new Map<string, number>();
const HINT_EVERY_MS = 30 * 60_000;

export function wireAi(api: ModuleApi): () => void {
  const offStatus = api.on("nettools.ai-status", (msg) => {
    const p = (msg.payload ?? {}) as { services?: AiReading[]; change?: AiReading | null };
    services = p.services ?? [];
    const c = p.change;
    if (c) {
      api.notify({
        title: changeTitle(c),
        body: c.level === "ok" ? undefined : c.description || undefined,
        icon: c.level === "ok" ? "✅" : c.level === "down" ? "🔴" : "🟠",
        priority: c.level === "down" ? "high" : "normal",
        key: `ai-${c.id}`,
      });
    }
  });
  const offAgents = api.on("agents.event", (msg) => {
    const p = (msg.payload ?? {}) as { source?: string; kind?: string };
    if (p.kind !== "done" && p.kind !== "waiting" && p.kind !== "info") return;
    const id = serviceOfAgent(p.source ?? "");
    const s = services.find((x) => x.id === id);
    if (!s || (s.level !== "down" && s.level !== "degraded")) return;
    const last = hinted.get(s.id) ?? 0;
    if (Date.now() - last < HINT_EVERY_MS) return;
    hinted.set(s.id, Date.now());
    api.notify({ title: `${s.name} a un incident en cours`, body: s.description || undefined, icon: "🟠", priority: "low", key: `ai-hint-${s.id}` });
  });
  return () => {
    offStatus();
    offAgents();
  };
}

/** La carte « Services IA » de l'onglet (cachée si le réglage est coupé). */
export function aiCard(api: ModuleApi): { node: HTMLElement; stop: () => void } {
  const node = el("div", { class: "net-ai", hidden: true });
  const draw = (list: AiReading[], history: AiOutage[]) => {
    const on = api.settings().aiStatus === true;
    node.hidden = !on;
    if (!on) return;
    const now = Date.now();
    const pills = list.length
      ? list.map((s) =>
          el(
            "span",
            { class: `net-ai-pill ${s.level}`, title: s.description || levelText(s.level) },
            el("i", { class: "net-ai-dot" }),
            `${s.name} : ${levelText(s.level)}`,
          ),
        )
      : [el("span", { class: "muted" }, "Premier coup d'œil dans quelques instants…")];
    const recent = [...history].sort((a, b) => b.from - a.from).slice(0, 4);
    node.replaceChildren(
      el("div", { class: "net-ai-row" }, el("b", { class: "net-ai-title" }, "Services IA"), ...pills),
      recent.length
        ? el("ul", { class: "net-ai-history muted" }, ...recent.map((o) => el("li", {}, outageText(o, now))))
        : el("p", { class: "muted net-ai-history" }, "Aucune panne ces 7 derniers jours."),
    );
  };
  const refresh = () =>
    api
      .invoke<{ services: AiReading[]; history: AiOutage[] }>("ai_status")
      .then((r) => draw(r.services, r.history))
      .catch(() => draw([], []));
  void refresh();
  const off = api.on("nettools.ai-status", () => void refresh());
  return { node, stop: off };
}
