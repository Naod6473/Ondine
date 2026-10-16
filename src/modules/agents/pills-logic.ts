// La rangée de pilules de l'onglet Agents IA (1.2.5), sans DOM ni Tauri
// (testée dans tests/front/agents-pills.test.ts) : quelles pilules montrer,
// dans quel ordre, avec quel badge, si l'agent est « branché », et quelle
// carte afficher sous la rangée. La vue est dans pills-view.ts et index.ts.
//
// Idée reprise de coucou (pills.ts et la vue « overview », MIT) : une pilule
// par agent, sa couleur, un badge rond (attend / a fini / erreur), un clic la
// met au premier plan. Réécrite pour Ondine (voir THIRD-PARTY.md).
//
// Une pilule = un outil de tools.ts, par son identifiant de lancement
// (« claude », « codex »…) ; les hooks parlent en « source » (« claude-code »).

import { HOOK_TOOLS, LAUNCH } from "./tools";
import { effectivePct, planLevel, type PlanLevel, type PlanLimits } from "./plan";

/** Les trois agents toujours proposés (sauf si on les a décochés dans les réglages). */
export const BASE_PILLS = ["claude", "codex", "gemini"] as const;

/**
 * Une couleur par agent : lisibles sur le verre sombre de l'île, assez
 * différentes les unes des autres. La couleur ne porte jamais seule
 * l'information : le nom est toujours écrit.
 */
export const AGENT_COLORS: Record<string, string> = {
  claude: "#e8875b",
  codex: "#3cc8b4",
  gemini: "#7fa8f5",
  copilot: "#9a8cf0",
  cursor: "#b8bcc6",
  qwen: "#b07cf2",
  goose: "#e9c349",
  opencode: "#5fd38a",
  kiro: "#d07ce0",
  hermes: "#f08aa8",
  aider: "#4fc3d9",
  amp: "#f2a33a",
  other: "#9aa3b2",
};
const UNKNOWN_COLOR = "#9aa3b2";

export function agentColor(id: string): string {
  return AGENT_COLORS[id] ?? UNKNOWN_COLOR;
}

/** La pilule d'une source de hooks (« claude-code » → « claude ») ; une source inconnue garde son nom. */
export function pillOfSource(source: string): string {
  for (const [id, info] of Object.entries(LAUNCH)) if (info.source === source) return id;
  return source;
}

/** La clé de HOOK_TOOLS d'une pilule (« claude » → « claude-code »), si ses hooks s'installent d'ici. */
export function hookKeyOf(id: string): string | undefined {
  const source = LAUNCH[id]?.source;
  return source && source in HOOK_TOOLS ? source : undefined;
}

/** L'état des hooks d'un outil (commande « hook_status »). */
export interface HookInfo {
  state: "installed" | "stale" | "absent" | "unreadable";
  permission?: boolean;
  /** Installé avant une nouveauté (liste de tâches) : à réinstaller. */
  incomplete?: boolean;
}

/**
 * Branché ou pas :
 * - ready : hooks installés et complets ;
 * - update : installés, mais il manque une nouveauté (liste de tâches, ou
 *   « Autoriser / Refuser » alors que le réglage est activé) ;
 * - stale : ils lancent un ancien ondine.exe (refusé par le canal) ;
 * - off : pas installés ; broken : fichier illisible (Ondine n'y touche pas) ;
 * - none : l'outil n'a pas de hooks (lancement seulement) ;
 * - unknown : l'état n'est pas encore lu (ou hors de l'appli).
 */
export type Plug = "ready" | "update" | "stale" | "off" | "broken" | "none" | "unknown";

/** Seuls Claude Code et Codex savent passer « Autoriser / Refuser » à l'île. */
const PERMISSION_TOOLS = new Set(["claude-code", "codex"]);

export function plugState(id: string, hooks: Record<string, HookInfo | undefined> | null, permOn: boolean): Plug {
  const key = hookKeyOf(id);
  if (!key) return "none";
  if (!hooks) return "unknown";
  const h = hooks[key];
  if (!h || h.state === "absent") return "off";
  if (h.state === "unreadable") return "broken";
  if (h.state === "stale") return "stale";
  if (h.incomplete || (permOn && PERMISSION_TOOLS.has(key) && !h.permission)) return "update";
  return "ready";
}

/** Faut-il proposer la carte « Brancher » ? */
export function needsSetup(p: Plug): boolean {
  return p === "off" || p === "update" || p === "stale" || p === "broken";
}

/** Des hooks sont écrits dans le fichier de l'outil (même anciens) : l'utilisateur l'a ajouté. */
function plugged(p: Plug): boolean {
  return p === "ready" || p === "update" || p === "stale";
}

export type Badge = "waiting" | "done" | "error";

export interface SessionLite {
  id: string;
  source: string;
  state: "working" | "waiting" | "done" | "idle";
}

export interface AskLite {
  session: string;
  who: string;
}

/** La pilule d'une question : par sa session, sinon par le prénom de l'agent (« Claude »), sinon aucune. */
export function askPill(ask: AskLite, sessions: SessionLite[]): string | null {
  const s = sessions.find((x) => x.id === ask.session);
  if (s) return pillOfSource(s.source);
  const who = ask.who.trim().toLowerCase();
  if (!who) return null;
  for (const [id, info] of Object.entries(LAUNCH)) if (info.who.toLowerCase() === who || info.name.toLowerCase() === who) return id;
  return null;
}

export interface PillData {
  id: string;
  /** Sessions qui travaillent ou attendent. */
  active: number;
  working: boolean;
  badge: Badge | null;
  plug: Plug;
}

export interface PillsInput {
  /** Les outils proposés au lancement (réglages « Proposer … », commande « projects ») ; null : pas encore lu. */
  proposed: string[] | null;
  /** Les outils ajoutés avec « + » (mémoire locale). */
  added: string[];
  sessions: SessionLite[];
  asks: AskLite[];
  hooks: Record<string, HookInfo | undefined> | null;
  permOn: boolean;
}

/**
 * Les pilules à montrer, dans l'ordre : celles qui attendent, puis celles
 * qui travaillent, puis les autres (dans l'ordre naturel : Claude Code, Codex,
 * Gemini CLI, puis les ajoutées, puis celles qui n'existent que par une session).
 */
export function buildPills(input: PillsInput): PillData[] {
  const ids: string[] = [];
  const push = (id: string) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  const sessionIds = new Set(input.sessions.map((s) => pillOfSource(s.source)));
  for (const id of BASE_PILLS) {
    const p = plugState(id, input.hooks, input.permOn);
    // Décoché dans les réglages : la pilule revient seulement s'il a une session ou des hooks.
    const off = input.proposed !== null && !input.proposed.includes(id);
    if (!off || sessionIds.has(id) || plugged(p)) push(id);
  }
  for (const id of input.added) if (id in LAUNCH) push(id);
  // Un outil dont les hooks sont déjà écrits (installé avant la refonte) : déjà ajouté.
  for (const id of Object.keys(LAUNCH)) if (plugged(plugState(id, input.hooks, input.permOn))) push(id);
  for (const s of input.sessions) push(pillOfSource(s.source));

  const waitingAsk = new Set(input.asks.map((a) => askPill(a, input.sessions)).filter((x): x is string => !!x));
  const pills = ids.map((id): PillData => {
    const mine = input.sessions.filter((s) => pillOfSource(s.source) === id);
    const waiting = waitingAsk.has(id) || mine.some((s) => s.state === "waiting");
    const working = mine.some((s) => s.state === "working");
    const plug = plugState(id, input.hooks, input.permOn);
    const badge: Badge | null = waiting
      ? "waiting"
      : plug === "stale" || plug === "broken"
        ? "error"
        : !working && mine.some((s) => s.state === "done")
          ? "done"
          : null;
    return { id, active: mine.filter((s) => s.state === "working" || s.state === "waiting").length, working, badge, plug };
  });
  const rank = (p: PillData) => (p.badge === "waiting" ? 0 : p.working ? 1 : 2);
  // Tri stable : à rang égal, l'ordre naturel.
  return pills.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

/** Les outils qu'on peut encore ajouter avec « + » (dans l'ordre de tools.ts). */
export function addable(shown: string[]): string[] {
  return Object.keys(LAUNCH).filter((id) => !shown.includes(id));
}

/**
 * La pilule au premier plan : celle qu'on a choisie (si elle est encore là),
 * sinon une qui attend ou travaille, sinon un agent branché, sinon aucune
 * (la carte d'accueil invite à cliquer).
 */
export function defaultPill(pills: PillData[], remembered: string | null): string | null {
  if (remembered && pills.some((p) => p.id === remembered)) return remembered;
  const busy = pills.find((p) => p.badge === "waiting" || p.working);
  if (busy) return busy.id;
  return pills.find((p) => p.plug === "ready")?.id ?? null;
}

/** Ce qu'on regarde sous la rangée (une petite pilule à droite, ou la carte de l'agent). */
export type Panel = "agent" | "plan" | "usage" | "github" | "quiet" | "add";
export type CardKind = "welcome" | "setup" | "agent" | Exclude<Panel, "agent">;

export interface CardInput {
  panel: Panel;
  selected: string | null;
  plug: Plug;
  /** « Plus tard » a été cliqué pour cet agent. */
  later: boolean;
  /** « Configurer » : les options rouvertes à la demande. */
  configOpen: boolean;
}

export function cardFor(c: CardInput): CardKind {
  if (c.panel !== "agent") return c.panel;
  if (!c.selected) return "welcome";
  if (c.configOpen) return "setup";
  if (needsSetup(c.plug) && !c.later) return "setup";
  return "agent";
}

/** La petite pilule du forfait : « 5 h · 42 % » (la fenêtre de 5 h, sinon la semaine), null sans chiffres. */
export function planPill(l: PlanLimits | null | undefined, now = Date.now()): { label: string; level: PlanLevel } | null {
  const w = l?.fiveHour ?? l?.week;
  if (!l || !w) return null;
  const pct = effectivePct(w, now);
  return { label: `${l.fiveHour ? "5 h" : "Sem."} · ${Math.round(pct)} %`, level: planLevel(pct) };
}

/** Une liste d'identifiants gardée en mémoire locale (JSON) ; tout ce qui n'est pas une liste de textes est ignoré. */
export function parseIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[\w.-]{1,32}$/.test(x)))].slice(0, 32) : [];
  } catch {
    return [];
  }
}

/** Les derniers messages : les `max` premiers, et combien restent repliés. */
export function foldList<T>(items: T[], open: boolean, max = 3): { shown: T[]; hidden: number } {
  if (open || items.length <= max) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, max), hidden: items.length - max };
}
