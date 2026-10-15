// Les pilules de l'onglet Agents IA (1.2.5) : une par agent (son icône, son
// nom, sa couleur, un badge rond « ! » / « ✓ » / « ✕ », le nombre de
// sessions en cours s'il y en a plusieurs), « + » pour en ajouter, et les
// petites pilules discrètes à droite (forfait, jetons, GitHub, concentration).
// Ce sont des boutons (aria-pressed pour celle au premier plan) ; les flèches
// gauche / droite passent d'une pilule à l'autre. La logique est dans
// pills-logic.ts.
//
// Le survol colore la pilule de la couleur de l'agent (CSS, --agent) ; les
// transitions sont courtes et coupées avec « Réduire les animations ».

import { el } from "../../island/dom";
import { agentIcon, icon } from "../../island/icon";
import type { Badge, Plug } from "./pills-logic";

const BADGE_MARK: Record<Badge, string> = { waiting: "!", done: "✓", error: "✕" };
const BADGE_TEXT: Record<Badge, string> = { waiting: "vous attend", done: "a fini", error: "à rebrancher" };

export interface AgentPillOptions {
  id: string;
  name: string;
  color: string;
  badge: Badge | null;
  active: number;
  working: boolean;
  plug: Plug;
  pressed: boolean;
  onClick(): void;
}

export function agentPill(o: AgentPillOptions): HTMLButtonElement {
  const unplugged = o.plug === "off" || o.plug === "broken";
  const state = o.badge ? BADGE_TEXT[o.badge] : o.working ? "au travail" : unplugged ? "pas branché" : "";
  // Le nom n'est jamais traduit ; l'état l'est par les motifs « … · vous attend » (i18n-en.json).
  const title = state ? `${o.name} · ${state}` : o.name;
  return el(
    "button",
    {
      class: `agents-pill${o.working ? " working" : ""}${unplugged ? " unplugged" : ""}`,
      style: `--agent: ${o.color}`,
      "data-pill": o.id,
      "aria-pressed": String(o.pressed),
      title,
      onclick: o.onClick,
    },
    el("span", { class: "agents-pill-logo", "aria-hidden": "true" }, icon(agentIcon(o.id))),
    el("span", { class: "agents-pill-name", "data-no-i18n": true }, o.name),
    o.active > 1 ? el("span", { class: "agents-pill-count", "aria-hidden": "true" }, String(o.active)) : null,
    o.badge ? el("span", { class: `agents-pill-badge ${o.badge}`, "aria-hidden": "true" }, el("i", { "data-no-i18n": true }, BADGE_MARK[o.badge])) : null,
  );
}

/** La pilule « + » : ajouter un autre outil à la rangée. */
export function addPill(pressed: boolean, onClick: () => void): HTMLButtonElement {
  return el("button", { class: "agents-pill agents-pill-add", "aria-pressed": String(pressed), title: "Ajouter un outil", onclick: onClick }, "＋");
}

export interface StatPillOptions {
  key: string;
  label: string;
  /** Un pictogramme (« 🎧 ») ou un logo d'agent (« logo:claude »). */
  iconName?: string;
  title: string;
  pressed: boolean;
  /** Le niveau du forfait (jaune, rouge) ou « on » (concentration en cours). */
  tone?: string;
  onClick(): void;
}

/** Une petite pilule discrète à droite de la rangée. */
export function statPill(o: StatPillOptions): HTMLButtonElement {
  return el(
    "button",
    { class: `agents-stat${o.tone ? ` ${o.tone}` : ""}`, "data-stat": o.key, "aria-pressed": String(o.pressed), title: o.title, onclick: o.onClick },
    o.iconName ? el("span", { class: "agents-stat-icon", "aria-hidden": "true" }, icon(o.iconName)) : null,
    o.label ? el("span", {}, o.label) : null,
  );
}

/** Les flèches gauche / droite (et Début / Fin) passent d'un bouton de la rangée à l'autre. */
export function arrowKeys(row: HTMLElement) {
  row.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
}
