// Module « Agents IA » : Claude Code, Codex et Gemini CLI préviennent l'île.
//
// Le Rust (src-tauri/src/modules/agents.rs) écoute le canal local, comprend
// les hooks et publie « agents.event » (une notification) et « agents.changed »
// (le tableau des sessions a bougé). Ici : la notification avec « Y aller »
// (ramène la fenêtre de l'agent devant) et l'onglet. Depuis la 1.2.4,
// l'onglet est une rangée de pilules, une par agent (pills-logic.ts,
// pills-view.ts), et UNE carte dessous : celle de l'agent choisi (ses
// sessions, ses questions, ses fichiers, « Lancer », ses derniers messages),
// sa carte « Brancher » au premier clic s'il n'est pas branché
// (setup-view.ts), ou celle d'une petite pilule de droite (forfait, jetons,
// GitHub, concentration).
//
// « A fini » peut arriver avec un bilan (dépôt git du dossier de la session) :
// « 3 fichiers modifiés, +120 −14 », avec « Ouvrir dans VS Code »,
// « Terminal ici » et « Fichiers… » (la liste, report-view.ts), et avec la
// dernière phrase de l'agent (« Copier »). Chaque projet a aussi « Reprendre »
// (la dernière session), avec la dernière phrase échangée en petit.
//
// Les outils en plus (Copilot CLI, Cursor, Qwen Code, Goose, OpenCode, Kiro,
// Hermes, Aider, Amp, « Autre outil ») sont décrits dans tools.ts ; les
// coucous de la mascotte pendant une attente dans wait-watch.ts ; la barre
// « 3/7 » de la liste de tâches de l'agent dans todos-logic.ts (1.2.4).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import { t } from "../../core/i18n";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import type { NotificationAction } from "../../core/notifications";
import { Bridge } from "../../core/bridge";
import { el } from "../../island/dom";
import { pacedInterval } from "../../core/perf";
import { diffPanel, liveOn, liveRow } from "./live-view";
import type { LiveFile } from "./live-logic";
import { agentIcon, icon } from "../../island/icon";
import { githubLogin, mountGithub } from "./github-view";
import { changesLine, namesLine, since, type ChangeSummary } from "./texts";
import { usageOn, usageSection, watchBudget } from "./usage-view";
import { planOn, planSection } from "./plan-view";
import { LAUNCH, launchName, sourceName, summaryLine } from "./tools";
import { mountFilesPanel, requestFiles } from "./report-view";
import { startWaitWatch } from "./wait-watch";
import { todoBar, type TodoSummary } from "./todos-logic";
import {
  BASE_PILLS,
  addable,
  agentColor,
  askPill,
  buildPills,
  cardFor,
  defaultPill,
  foldList,
  hookKeyOf,
  needsSetup,
  parseIds,
  pillOfSource,
  planPill,
  plugState,
  type Panel,
  type Plug,
} from "./pills-logic";
import { addPill, agentPill, arrowKeys, statPill } from "./pills-view";
import { setupCard, setupKey, type HookState, type SetupContext } from "./setup-view";

/** Le bilan d'une fin de tâche, avec ce qu'il faut pour ses boutons. */
interface Changes extends ChangeSummary {
  /** Le dossier de la session (chemin complet, validé par le Rust). */
  dir: string;
  /** VS Code est installé ; le module Terminal est actif. */
  vscode: boolean;
  terminal: boolean;
}

interface AgentEvent {
  at: number;
  source: string;
  kind: "waiting" | "done" | "info";
  title: string;
  body: string;
  project: string;
  session: string;
  /** « A fini » dans un dépôt git où des fichiers ont changé. */
  changes?: Changes;
  /** « A fini » : la dernière phrase de l'agent (transcription vérifiée), 200 caractères au plus. */
  summary?: string;
}

/** La dernière session de Claude Code d'un projet (commande "last_sessions"). */
interface LastSession {
  index: number;
  found: boolean;
  /** La dernière phrase (absente si le réglage la cache, ou si rien n'est trouvé). */
  text?: string | null;
  who?: "user" | "assistant" | null;
  at?: number;
}

/** Une question posée par un agent (outil MCP « ondine_ask »), une demande
 *  de permission (« ondine.exe permission » : Autoriser / Refuser / Au terminal),
 *  une capture d'écran ou une ouverture demandées (ondine_capture, ondine_open). */
interface Ask {
  id: number;
  kind: "question" | "permission" | "capture" | "open";
  who: string;
  question: string;
  /** Permission : ce que l'outil va faire (la commande, le fichier). */
  detail: string;
  options: string[];
  session: string;
  /** Jusqu'à quand (ms). */
  until: number;
}

interface Session {
  id: string;
  source: string;
  project: string;
  state: "working" | "waiting" | "done" | "idle";
  since: number;
  /** La liste de tâches de l'agent (réglage « taskProgress ») : « 3/7 » et la tâche en cours. */
  todos?: TodoSummary;
}

/** Ce que rend la commande « history ». */
interface History {
  events: AgentEvent[];
  working: number;
  sessions: Session[];
  asks: Ask[];
  quiet: { until: number | null; held: number } | null;
}

/**
 * La mémoire locale de l'onglet (navigateur de l'île) : la pilule choisie,
 * les outils ajoutés avec « + », les agents pour qui on a dit « Plus tard ».
 * Rien d'important : sans stockage, l'onglet repart de zéro.
 */
const STORE = { pill: "agents.pill", added: "agents.pills-added", later: "agents.pills-later" } as const;
function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage indisponible : le choix vaut jusqu'à la fermeture
  }
}

/** La barre de la liste de tâches sous une session (rien sans liste). */
function todosRow(t: TodoSummary | undefined): HTMLElement | null {
  const bar = todoBar(t);
  if (!bar) return null;
  return el(
    "div",
    { class: `agents-todos${bar.finished ? " finished" : ""}`, title: "Liste de tâches de l'agent" },
    el(
      "span",
      { class: "agents-todos-track", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(t!.total), "aria-valuenow": String(Math.min(t!.done, t!.total)), "aria-label": "Tâches faites" },
      el("span", { class: "agents-todos-fill", style: `width: ${bar.pct}%` }),
    ),
    el("b", { "data-no-i18n": true }, bar.label),
    // Le texte de l'agent : jamais traduit.
    bar.text ? el("span", { class: "agents-todos-text", "data-no-i18n": true }, bar.text) : null,
  );
}

/** Les agents qu'on sait lancer (réglages « Proposer … », liste dans tools.ts ; le Rust décide). */
type LaunchTool = string;
/** Le nom affiché d'une source de hooks. */
const SOURCE_NAMES: Record<string, string> = { "claude-code": "Claude", codex: "Codex", gemini: "Gemini" };

const ICON: Record<AgentEvent["kind"], string> = { waiting: "✋", done: "✅", info: "💬" };
const redraws = new Set<() => void>();

/** Le logo d'une source connue (« claude-code », « gemini »…), sinon rien. */
function sourceIcon(source: string): string | undefined {
  const name = agentIcon(source);
  return name === "🤖" ? undefined : name;
}

/** « 4 min », « 1 h 05 » : depuis combien de temps. */
function duration(ms: number): string {
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Ramène devant la fenêtre de cette session (erreur affichée sans bruit). */
async function goTo(api: ModuleApi, session: string) {
  try {
    await api.invoke("focus", { session });
    api.closeIsland();
  } catch (err) {
    api.notify({ title: "Fenêtre introuvable", body: errorText(err), icon: "🔎", priority: "low", key: "agents-focus" });
  }
}

/** Ouvre VS Code dans le dossier de la session (bouton du bilan). */
async function openVsCode(api: ModuleApi, dir: string) {
  try {
    await api.invoke("open_vscode", { path: dir });
  } catch (err) {
    api.notify({ title: "VS Code", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
  }
}

/** Copie la dernière phrase de l'agent (bouton « Copier » de « a fini »). */
async function copySummary(api: ModuleApi, text: string) {
  try {
    await api.invoke("copy_text", { text });
    api.notify({ title: "Phrase copiée", icon: "📋", priority: "low", durationMs: 2000, key: "agents-copied" });
  } catch (err) {
    api.notify({ title: "Copie impossible", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
  }
}

/** « A fini », avec son bilan : l'île s'ouvre pour montrer les fichiers et les boutons. */
function showReport(api: ModuleApi, e: AgentEvent, c: Changes) {
  const actions: NotificationAction[] = [];
  if (e.session) actions.push({ label: "↗ Y aller", run: () => goTo(api, e.session) });
  // Le bilan cliquable : la liste des fichiers dans l'onglet, avec « Ouvrir » et « Diff ».
  actions.push({ label: "Fichiers…", run: () => requestFiles(api, { dir: c.dir, title: `${e.title} · ${changesLine(c)}`, vscode: c.vscode }) });
  if (c.vscode) actions.push({ label: "Ouvrir dans VS Code", run: () => openVsCode(api, c.dir) });
  // Le module Terminal ouvre son terminal habituel dans ce dossier (qu'il valide lui-même).
  if (c.terminal) actions.push({ label: "Terminal ici", run: () => api.emit("terminal.open", { path: c.dir }) });
  if (e.summary) actions.push({ label: "Copier", run: () => copySummary(api, e.summary!) });
  api.notify({
    title: `${e.title} · ${changesLine(c)}`,
    // La dernière phrase de l'agent si on l'a, sinon les fichiers ; puis le projet.
    body: [e.summary ? summaryLine(e.summary) : namesLine(c), e.project ? `Projet ${e.project}` : ""].filter(Boolean).join(" · "),
    icon: sourceIcon(e.source) ?? ICON.done,
    priority: "high",
    durationMs: 15_000,
    key: `agents-${e.session}`,
    actions,
  });
}

/** Envoie ton choix à l'agent qui attend (`confirmed` : pour « Autoriser »). */
async function answer(api: ModuleApi, id: number, choice: number, confirmed = false) {
  try {
    await api.invoke("answer", { id, choice, confirmed });
  } catch (err) {
    api.notify({ title: "Réponse non envoyée", body: errorText(err), icon: "⚠️", priority: "low", key: `agents-ask-${id}` });
  }
}

/** Montre une demande de permission. « Autoriser » demande une confirmation. */
function showPermission(api: ModuleApi, q: Ask) {
  api.notify({
    title: q.question,
    body: q.detail || undefined,
    icon: "🔐",
    priority: "high",
    sticky: true,
    key: `agents-ask-${q.id}`,
    actions: [
      { label: "Autoriser…", run: () => confirmPermission(api, q) },
      { label: "Refuser", run: () => answer(api, q.id, 1) },
      { label: "Au terminal", run: () => answer(api, q.id, 2).then(() => (q.session ? goTo(api, q.session) : undefined)) },
    ],
  });
}

/** Prévient l'île que l'écran de confirmation s'affiche : « Oui, autoriser »
 *  n'est accepté qu'après (vérifié côté Rust). */
function arm(api: ModuleApi, id: number) {
  api.invoke("arm", { id }).catch(() => undefined); // question expirée : « answer » le dira
}

/** La confirmation : on relit ce qu'on autorise avant de dire oui. */
function confirmPermission(api: ModuleApi, q: Ask) {
  arm(api, q.id);
  api.notify({
    title: `Confirmer : ${q.who} peut le faire ?`,
    body: q.detail || q.question,
    icon: "⚠️",
    priority: "high",
    sticky: true,
    key: `agents-ask-${q.id}`,
    actions: [
      { label: "Oui, autoriser", run: () => answer(api, q.id, 0, true) },
      { label: "Retour", run: () => showPermission(api, q) },
    ],
  });
}

/** « ▰▰▰▱▱▱ » : une petite barre en texte. */
function bar(step: number, total: number): string {
  const full = Math.round((step / total) * 10);
  return "▰".repeat(full) + "▱".repeat(10 - full);
}

/** « à l'instant », « il y a 5 min », sinon l'heure. */
function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export const agents: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // Le Rust publie la liste des projets pour le lanceur (« agents.projects »).
    void api.invoke("projects").catch(() => {});
    api.on("agents.event", (msg) => {
      const e = msg.payload as AgentEvent | null;
      if (!e?.title) return;
      if (e.kind === "done" && e.changes?.files) return showReport(api, e, e.changes);
      const where = e.project ? `Projet ${e.project}` : "";
      const actions: NotificationAction[] = [];
      if (e.session) actions.push({ label: "↗ Y aller", run: () => goTo(api, e.session) });
      // « A fini » avec la dernière phrase de l'agent : « Copier ».
      if (e.kind === "done" && e.summary) actions.push({ label: "Copier", run: () => copySummary(api, e.summary!) });
      api.notify({
        title: e.title,
        // Attente : le message de Claude (« … to use Bash ») ; a fini : sa dernière phrase ; sinon, le projet.
        body: e.kind === "waiting" ? [e.body, where].filter(Boolean).join(" · ") : e.kind === "done" && e.summary ? [summaryLine(e.summary), where].filter(Boolean).join(" · ") : e.body || where,
        // Le logo de l'agent (Claude, Gemini…) ; sinon l'état (✋ ✅ 💬).
        icon: sourceIcon(e.source) ?? ICON[e.kind] ?? "🤖",
        // Claude attend : l'île s'ouvre pour te le dire ; le reste reste discret.
        priority: e.kind === "waiting" ? "high" : "normal",
        key: `agents-${e.session}`,
        actions: actions.length ? actions : undefined,
      });
    });
    // L'Accueil : les sessions en cours (relues toutes les 5 s pendant qu'il est affiché), et la dernière pour « Reprendre ».
    let home: { events: AgentEvent[]; sessions: Session[]; asks: Ask[] } = { events: [], sessions: [], asks: [] };
    api.homeCard({
      title: "Agents IA",
      icon: "🤖",
      moments: { morning: 45, day: 85, evening: 50 },
      refreshMs: 5_000,
      load: async () => {
        home = await api.invoke<typeof home>("history").catch(() => home);
      },
      view: () => {
        const who = (x: { source: string }) => SOURCE_NAMES[x.source] ?? sourceName(x.source);
        const waiting = home.sessions.filter((x) => x.state === "waiting");
        const working = home.sessions.filter((x) => x.state === "working");
        const done = home.events.find((e) => e.kind === "done" && Date.now() - e.at < 30 * 60_000);
        const lead = waiting[0] ?? working[0];
        if (!lead && !done && !home.asks.length) return null;
        const state = { working: "au travail", waiting: "vous attend", done: "a fini", idle: "" };
        return {
          value: lead ? who(lead) : done ? who(done) : "Question",
          sub: lead ? `${state[lead.state]} · ${duration(lead.since)}` : done ? (done.project || "a fini") : "",
          rows: home.sessions.slice(0, 4).map((x) => ({ label: `${who(x)} · ${x.project || "—"}`, value: state[x.state] })),
          urgent: waiting.length > 0 || home.asks.length > 0,
          phrase: waiting[0] ? `${who(waiting[0])} vous attend` : working[0] ? `${who(working[0])} travaille` : done ? `${who(done)} a fini` : null,
        };
      },
      resume: () => {
        const e = home.events.find((x) => x.session);
        if (!e) return null;
        return { icon: "🤖", label: e.project || e.title, detail: SOURCE_NAMES[e.source] ?? sourceName(e.source), at: e.at, open: () => goTo(api, e.session) };
      },
    });
    // Un agent te pose une question (MCP) : elle reste affichée jusqu'à ton clic.
    api.on("agents.ask", (msg) => {
      const q = msg.payload as Ask | null;
      if (!q?.question) return;
      if (q.kind === "permission") return showPermission(api, q);
      // Capture d'écran ou ouverture demandées : la question est le titre.
      const request = q.kind === "capture" || q.kind === "open";
      api.notify({
        title: request ? q.question : `${q.who} vous demande`,
        body: request ? q.detail || undefined : q.question,
        icon: q.kind === "capture" ? "✂️" : q.kind === "open" ? "🔗" : "❓",
        priority: "high",
        sticky: true,
        key: `agents-ask-${q.id}`,
        actions: q.options.map((label, i) => ({ label, run: () => answer(api, q.id, i) })),
      });
    });
    api.on("agents.ask.closed", (msg) => {
      const c = msg.payload as { id: number; expired: boolean; gone?: boolean } | null;
      if (!c) return;
      // gone : l'agent n'attend plus (réponse donnée dans le terminal, ou arrêté).
      api.notify({
        title: c.gone ? "Réglé ailleurs" : c.expired ? "Pas de réponse dans l'île" : "Réponse envoyée",
        body: c.gone ? "L'agent n'attend plus cette réponse." : c.expired ? "L'agent continue sans, ou vous demande dans le terminal." : undefined,
        icon: c.gone ? "↩️" : c.expired ? "⌛" : "✔️",
        priority: "low",
        durationMs: 2500,
        key: `agents-ask-${c.id}`,
      });
    });
    // Un agent annonce où il en est (MCP) : une notification discrète, remplacée à chaque étape.
    api.on("agents.progress", (msg) => {
      const p = msg.payload as { source: string; who: string; title: string; step: number; total: number } | null;
      if (!p?.total) return;
      const finished = p.step >= p.total;
      api.notify({
        // Dans le bandeau, seul le titre se voit : on y met « 3/7 ».
        title: `${p.who} · ${p.title || (finished ? "terminé" : "en cours")} · ${p.step}/${p.total}`,
        body: `${bar(p.step, p.total)}  ${p.step} / ${p.total}`,
        icon: finished ? "✅" : "⏳",
        priority: finished ? "normal" : "low",
        key: `agents-progress-${p.source}`,
      });
    });
    // Fin de la concentration : un seul résumé de ce qui s'est passé.
    api.on("agents.quiet", (msg) => {
      const q = msg.payload as { on: boolean; summary?: string | null } | null;
      if (!q || q.on) return;
      // Le résumé en titre : c'est la ligne qui se voit partout (bandeau compris).
      api.notify({
        title: q.summary || "Rien de nouveau du côté des agents",
        body: "Fin de la concentration",
        icon: "🎧",
        priority: q.summary ? "normal" : "low",
        key: "agents-quiet",
      });
    });
    api.on("agents.changed", () => redraws.forEach((r) => r()));
    // En mini-île, la mascotte fait coucou toutes les deux minutes tant qu'un agent attend.
    startWaitWatch(api);
    // L'alerte de budget (réglage `dailyBudget`) : une relecture légère toutes les 15 min (usage-view.ts).
    return watchBudget(api);
  },

  // Ondine sur le bureau : la liste se redessine ; les notifications restent à l'île.
  satellite(api) {
    void api.invoke("projects").catch(() => {});
    api.on("agents.changed", () => redraws.forEach((r) => r()));
  },

  // L'onglet (1.2.4) : une rangée de pilules (une par agent, « + », et à
  // droite les petites pilules du forfait, des jetons, de GitHub et de la
  // concentration), puis UNE carte : celle de l'agent au premier plan (ses
  // sessions, ses questions, ses fichiers, « Lancer », ses derniers messages),
  // sa carte « Brancher » au premier clic s'il n'est pas branché
  // (setup-view.ts), ou la carte d'une petite pilule de droite. La logique
  // (ordre, badge, branché, carte à montrer) est dans pills-logic.ts.
  views: {
    expanded(root, api: ModuleApi) {
      // ── La mémoire locale : la pilule choisie, celles ajoutées avec « + », les « Plus tard ».
      const remembered = (): string | null => readStore(STORE.pill);
      const added = () => parseIds(readStore(STORE.added));
      const later = () => parseIds(readStore(STORE.later));
      const otherWord = () => String(api.settings().otherTool ?? "");
      const nameOf = (id: string) => (LAUNCH[id] ? launchName(id, otherWord()) : sourceName(id));

      // ── Les données (relues à chaque dessin) ─────────────────────────────
      let data: History = { events: [], working: 0, sessions: [], asks: [], quiet: null };
      let live: LiveFile[] = [];
      let tools: LaunchTool[] | null = null;
      let projects: { path: string; name: string }[] = [];
      let lastSessions: LastSession[] = [];
      let lastFetch = 0;
      let hookStates: Record<string, HookState | undefined> | null = null;
      let exeLine = "ondine.exe notify";
      let otherLine = "ondine.exe notify --source other --event done";

      // ── Ce qu'on regarde ────────────────────────────────────────────────
      let panel: Panel = "agent";
      let configOpen = false;
      let messagesOpen = false;
      /** La pilule au premier plan (après le dernier calcul). */
      let selected: string | null = null;
      /** Le projet choisi dans « Lancer » (index dans `projects`, « home » ou « pick »). */
      let launchChoice = "0";

      const row = el("div", { class: "agents-row", role: "toolbar", "aria-label": "Agents IA" });
      const pillsBox = el("div", { class: "agents-pills" });
      const statsBox = el("div", { class: "agents-stats" });
      row.append(pillsBox, statsBox);
      arrowKeys(row);
      // La liste des fichiers d'un bilan (report-view.ts) et le changement d'un
      // fichier modifié en direct (live-view.ts) : au-dessus de la carte, vides le reste du temps.
      const filesBox = el("section", { class: "agents-files-box" });
      const diffBox = el("section", { class: "agents-diff-box" });
      const diff = diffPanel(api, diffBox);
      const stage = el("div", { class: "agents-stage" });
      root.append(el("div", { class: "agents" }, row, filesBox, diffBox, stage));
      const stopFiles = mountFilesPanel(api, filesBox);

      // Les sections déplacées hors de la colonne principale : chacune a sa carte.
      const usage = usageSection(api);
      const plan = planSection(api);
      const githubBox = el("section", { class: "agents-usage agents-github" });
      const stopGithub = mountGithub(githubBox, api);
      const quiet = el("div", { class: "agents-quiet" });

      // ── Choisir ─────────────────────────────────────────────────────────
      const choose = (id: string) => {
        // Un nouveau clic sur l'agent déjà au premier plan referme une petite carte de droite.
        writeStore(STORE.pill, id);
        if (id !== selected) {
          configOpen = false;
          messagesOpen = false;
        }
        panel = "agent";
        render();
      };
      const openPanel = (p: Panel) => {
        panel = panel === p ? "agent" : p;
        if (panel === "usage") void usage.load();
        render();
      };
      const back = () => {
        panel = "agent";
        render();
      };

      // ── Lancer un agent (le lanceur d'avant, réduit à une ligne) ─────────
      const start = (tool: string, args: Record<string, unknown>) =>
        api.handler(async () => {
          try {
            await api.invoke("launch", { tool, ...args });
            api.closeIsland();
          } catch (err) {
            api.notify({ title: nameOf(tool), body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
          }
        });
      const launchSelected = (tool: string, resume: boolean) =>
        api.handler(async () => {
          if (launchChoice === "pick") {
            const path = await Bridge.pickFolder(`Ouvrir ${nameOf(tool)} dans…`);
            if (path) await start(tool, { path })();
            return;
          }
          const index = Number(launchChoice);
          await start(tool, launchChoice === "home" || !projects[index] ? {} : { index, ...(resume ? { resume: true } : {}) })();
        });
      /** La dernière session de Claude Code d'un projet (pour « Reprendre » et sa dernière phrase). */
      const lastOf = (tool: string, index: number) => (tool === "claude" ? lastSessions.find((l) => l.index === index && l.found) : undefined);
      const resumable = (tool: string, index: number) => (tool === "claude" ? !!lastOf(tool, index) : !!LAUNCH[tool]?.resume);
      /** La dernière phrase échangée, en petit : « Vous : … · il y a 2 h ». */
      const lastLine = (last: LastSession) =>
        el(
          "small",
          { class: "muted agents-last" },
          last.text ? el("span", {}, last.who === "user" ? "Vous :" : "Claude :") : null,
          last.text ? " " : null,
          // Ce texte vient de la session : jamais traduit, jamais retouché.
          last.text ? el("span", { "data-no-i18n": true }, last.text) : null,
          last.text && last.at ? " · " : null,
          last.at ? el("span", {}, since(last.at)) : null,
        );
      const launchRow = (tool: string): HTMLElement => {
        if (!tools) return el("div", { class: "agents-launch" });
        if (!tools.includes(tool))
          return el("div", { class: "agents-launch muted", title: "Réglage « Proposer … » de l'onglet Agents IA" }, "Lancement désactivé dans les réglages.");
        if (!["home", "pick"].includes(launchChoice) && !projects[Number(launchChoice)]) launchChoice = projects.length ? "0" : "home";
        const select = el(
          "select",
          { class: "agents-launch-where", "aria-label": "Projet", title: "Dans quel dossier lancer l'agent" },
          ...projects.map((p, i) => el("option", { value: String(i), "data-no-i18n": true }, p.name)),
          ...(projects.length ? [] : [el("option", { value: "home" }, "Dossier utilisateur")]),
          el("option", { value: "pick" }, "Autre dossier…"),
        );
        select.value = launchChoice;
        const index = Number(launchChoice);
        const canResume = launchChoice !== "pick" && launchChoice !== "home" && resumable(tool, index);
        const last = canResume ? lastOf(tool, index) : undefined;
        const line = el(
          "div",
          { class: "agents-launch" },
          el("span", { class: "agents-launch-icon", "aria-hidden": "true" }, "▶"),
          select,
          el("button", { class: "btn small primary", title: `Ouvrir ${nameOf(tool)} dans ce dossier`, onclick: launchSelected(tool, false) }, "Lancer"),
          canResume ? el("button", { class: "btn small", title: LAUNCH[tool]?.resumeTitle ?? "Reprendre la dernière session", onclick: launchSelected(tool, true) }, "↻ Reprendre") : null,
          last ? lastLine(last) : null,
        );
        select.addEventListener("change", () => {
          launchChoice = select.value;
          line.replaceWith(launchRow(tool));
        });
        return line;
      };
      /** Relit la dernière session de chaque projet (au plus toutes les 30 s). */
      const loadLast = async () => {
        if (!projects.length || Date.now() - lastFetch < 30_000) return;
        lastFetch = Date.now();
        try {
          lastSessions = await api.invoke<LastSession[]>("last_sessions");
        } catch {
          lastSessions = [];
        }
        render();
      };
      void api.invoke<{ tools: LaunchTool[]; projects: { path: string; name: string }[] }>("projects").then(
        (r) => {
          tools = r?.tools ?? [];
          projects = r?.projects ?? [];
          render();
          void loadLast();
        },
        () => {},
      );

      // ── Les hooks : branché ou pas (setup-view.ts) ──────────────────────
      const loadHookStates = async () => {
        try {
          const r = await api.invoke<{ tools: Record<string, HookState | undefined> }>("hook_status");
          hookStates = r?.tools ?? {};
        } catch {
          hookStates = null;
        }
        render();
      };
      void loadHookStates();
      void api.invoke<{ exe: string; other?: string }>("hook_config").then(
        (c) => {
          exeLine = `${c.exe} notify`;
          otherLine = c.other ?? `"${c.exe}" notify --source other --event done`;
        },
        () => {},
      );
      const setupCtx: SetupContext = { api, hooks: () => hookStates, reload: loadHookStates, exe: () => exeLine, otherLine: () => otherLine };
      const plugOf = (id: string) => plugState(id, hookStates, api.settings().permissions === true);

      // ── Une question en attente (aussi après avoir fermé sa notification) ─
      // Gardée d'un dessin à l'autre : la confirmation « Vraiment autoriser ? » reste ouverte.
      const askRows = new Map<number, HTMLElement>();
      const askRow = (q: Ask): HTMLElement => {
        const left = `encore ${Math.max(1, Math.ceil((q.until - Date.now()) / 60000))} min`;
        const cached = askRows.get(q.id);
        if (cached) {
          const small = cached.querySelector(".agents-ask-left");
          if (small) small.textContent = ` · ${left}`;
          return cached;
        }
        const isPerm = q.kind === "permission";
        const buttons = el("div", { class: "btn-row" });
        const plain = () =>
          buttons.replaceChildren(
            ...q.options.map((o, i) =>
              // Autoriser : d'abord la confirmation, sur place.
              isPerm && i === 0
                ? el("button", { class: "btn small primary", onclick: api.handler(() => confirm()) }, `${o}…`)
                : el("button", { class: "btn small", onclick: api.handler(() => answer(api, q.id, i)) }, o),
            ),
          );
        const confirm = () => {
          arm(api, q.id);
          buttons.replaceChildren(
            el("span", { class: "agents-confirm" }, "Vraiment autoriser ?"),
            el("button", { class: "btn small primary", onclick: api.handler(() => answer(api, q.id, 0, true)) }, "Oui, autoriser"),
            el("button", { class: "btn small", onclick: api.handler(plain) }, "Retour"),
          );
        };
        plain();
        const row = el(
          "li",
          { class: `agents-ask ${q.kind}` },
          el("div", {}, el("b", {}, isPerm ? `🔐 ${q.question}` : q.kind === "capture" ? `✂️ ${q.question}` : q.kind === "open" ? `🔗 ${q.question}` : `❓ ${q.who} vous demande`), el("small", { class: "muted agents-ask-left" }, ` · ${left}`)),
          q.kind !== "question" ? (q.detail ? el("code", { class: "agents-ask-detail" }, q.detail) : null) : el("div", { class: "agents-ask-q" }, q.question),
          buttons,
        );
        askRows.set(q.id, row);
        return row;
      };

      // ── Les cartes ──────────────────────────────────────────────────────
      const backButton = () => el("button", { class: "agents-back", title: "Retour à l'agent", onclick: api.handler(back) }, "‹");
      /** Une carte avec « ‹ » pour revenir à l'agent. */
      const backCard = (cls: string, title: string, ...body: HTMLElement[]) =>
        el("div", { class: `agents-card ${cls}` }, el("div", { class: "agents-card-head" }, backButton(), el("b", {}, title)), ...body);
      /** Une section qui a déjà son titre (forfait, jetons, GitHub) : « ‹ » se place à sa gauche. */
      const panelCard = (box: HTMLElement) => el("div", { class: "agents-card agents-panel" }, backButton(), box);

      const QUIET_CHOICES: [number, string][] = [[25, "25 min"], [60, "1 h"], [120, "2 h"], [0, "Jusqu'à l'arrêt"]];
      const drawQuiet = () => {
        const q = data.quiet;
        if (q) {
          const until = q.until ? ` jusqu'à ${new Date(q.until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "";
          const held = q.held ? ` · ${q.held} en attente` : "";
          quiet.className = "agents-quiet on";
          quiet.replaceChildren(el("span", {}, `🎧 Concentration${until}${held}`), el("button", { class: "btn small", onclick: api.handler(() => api.invoke("quiet_stop")) }, "Arrêter"));
        } else {
          quiet.className = "agents-quiet";
          quiet.replaceChildren(
            el("span", { class: "muted" }, "Les notifications des agents attendent ; un résumé à la fin"),
            ...QUIET_CHOICES.map(([minutes, label]) => el("button", { class: "net-chip", onclick: api.handler(() => api.invoke("quiet_start", { minutes })) }, label)),
          );
        }
      };

      const addCard = (shown: string[]) =>
        backCard(
          "agents-add",
          "Ajouter un outil",
          el(
            "div",
            { class: "agents-add-grid" },
            ...addable(shown).map((id) =>
              el(
                "button",
                {
                  class: "agents-pill",
                  style: `--agent: ${agentColor(id)}`,
                  title: LAUNCH[id]?.source ? "Prévient l'île une fois branché" : "Lancement seulement",
                  onclick: api.handler(() => {
                    writeStore(STORE.added, JSON.stringify([...added(), id]));
                    choose(id);
                  }),
                },
                el("span", { class: "agents-pill-logo", "aria-hidden": "true" }, icon(agentIcon(id))),
                el("span", { class: "agents-pill-name", "data-no-i18n": true }, nameOf(id)),
              ),
            ),
          ),
        );

      const welcomeCard = () =>
        el(
          "div",
          { class: "agents-card agents-welcome" },
          el("p", { class: "muted" }, "Choisissez un agent pour le brancher ou le lancer."),
          // Une question sans agent au premier plan : jamais cachée.
          data.asks.length ? el("ul", { class: "agents-asks" }, ...data.asks.map(askRow)) : null,
        );

      /** Ce que fait une session, en bref. */
      const what = (x: Session) =>
        ({
          working: `travaille depuis ${duration(x.since)}`,
          waiting: `vous attend depuis ${duration(x.since)}`,
          done: `a fini ${ago(x.since)}`,
          idle: "sans nouvelles",
        })[x.state];

      const sessionRow = (x: Session, tool: string): HTMLElement => {
        const index = projects.findIndex((p) => p.name === x.project);
        const proj = index >= 0 ? projects[index] : undefined;
        const last = index >= 0 && (x.state === "done" || x.state === "idle") ? lastOf(tool, index) : undefined;
        const canResume = !!proj && (x.state === "done" || x.state === "idle") && resumable(tool, index) && !!tools?.includes(tool);
        return el(
          "li",
          { class: `agents-session-item ${x.state}` },
          el(
            "div",
            { class: `agents-session ${x.state}` },
            el("i", { class: "agents-dot" }),
            el("b", { "data-no-i18n": true }, x.project || "—"),
            el("small", { class: "muted" }, what(x)),
            el("span", { class: "agents-session-sep" }),
            el("button", { class: "net-chip", title: "Revenir à sa fenêtre", onclick: api.handler(() => goTo(api, x.id)) }, "↗ Y aller"),
            canResume ? el("button", { class: "net-chip", title: LAUNCH[tool]?.resumeTitle ?? "Reprendre la dernière session", onclick: start(tool, { index, resume: true }) }, "↻ Reprendre") : null,
            proj ? el("button", { class: "net-chip", title: "Ouvrir le projet dans VS Code", onclick: api.handler(() => openVsCode(api, proj.path)) }, "VS Code") : null,
          ),
          todosRow(x.todos),
          last?.text ? lastLine(last) : null,
          live.some((f) => f.session === x.id) ? liveRow(live, x.id, (f) => void diff.show(f)) : null,
        );
      };

      const agentCard = (id: string, plug: Plug): HTMLElement => {
        const color = agentColor(id);
        const mine = data.sessions.filter((x) => pillOfSource(x.source) === id);
        // Ses questions, et celles qu'on ne sait rattacher à aucun agent (jamais cachées).
        const asks = (data.asks ?? []).filter((q) => {
          const p = askPill(q, data.sessions);
          return p === id || p === null;
        });
        const events = data.events.filter((e) => pillOfSource(e.source) === id);
        const { shown, hidden } = foldList(events, messagesOpen);
        const hookTool = !!hookKeyOf(id);
        const link = needsSetup(plug)
          ? el("button", { class: "agents-link", title: "Brancher cet agent à l'île", onclick: api.handler(() => ((configOpen = true), render())) }, "Brancher")
          : el("button", { class: "agents-link", title: hookTool ? "Hooks, serveur MCP, Autoriser / Refuser" : "Prévenir l'île depuis un autre outil", onclick: api.handler(() => ((configOpen = true), render())) }, "Configurer");
        const summary = mine.length ? `${mine.length} session${mine.length > 1 ? "s" : ""}` : "Aucune session";
        return el(
          "div",
          { class: "agents-card agents-agent", style: `--agent: ${color}` },
          el(
            "div",
            { class: "agents-card-head" },
            el("span", { class: "agents-setup-logo", "aria-hidden": "true" }, icon(agentIcon(id))),
            el("b", { "data-no-i18n": true }, nameOf(id)),
            el("small", { class: "muted" }, summary),
            el("span", { class: "agents-session-sep" }),
            link,
          ),
          asks.length ? el("ul", { class: "agents-asks" }, ...asks.map(askRow)) : null,
          mine.length ? el("ul", { class: "agents-board" }, ...mine.map((x) => sessionRow(x, id))) : null,
          launchRow(id),
          shown.length
            ? el(
                "ul",
                { class: "agents-list", "aria-label": "Derniers messages" },
                ...shown.map((e) =>
                  el(
                    "li",
                    { class: `agents-item ${e.kind}` },
                    el("span", { class: "launch-icon" }, icon(ICON[e.kind] ?? "🤖")),
                    el(
                      "span",
                      { class: "launch-text" },
                      el("b", {}, e.changes?.files ? `${e.title} · ${changesLine(e.changes)}` : e.title),
                      // « il y a 6 min » traduit à part : la ligne entière (projet, message) ne l'est pas.
                      el("small", { class: "muted" }, [e.project, e.body, t(Date.now() - e.at > 86_400_000 ? since(e.at) : ago(e.at))].filter(Boolean).join(" · ")),
                    ),
                  ),
                ),
                hidden || messagesOpen
                  ? el(
                      "li",
                      {},
                      el(
                        "button",
                        { class: "agents-link", onclick: api.handler(() => ((messagesOpen = !messagesOpen), render())) },
                        messagesOpen ? "Replier" : `Afficher ${hidden} de plus`,
                      ),
                    )
                  : null,
              )
            : null,
        );
      };

      // ── Le dessin ───────────────────────────────────────────────────────
      let rowKey = "";
      let stageKey = "";
      const render = () => {
        const permOn = api.settings().permissions === true;
        const pills = buildPills({ proposed: tools, added: added(), sessions: data.sessions, asks: data.asks ?? [], hooks: hookStates, permOn });
        selected = defaultPill(pills, remembered());
        const plug = selected ? plugOf(selected) : "none";
        const kind = cardFor({ panel, selected, plug, later: !!selected && later().includes(selected), configOpen });

        // La rangée : redessinée seulement si elle change (le focus clavier reste en place).
        const report = plan.report();
        const claudePlan = planOn(api) ? planPill(report?.claude) : null;
        const codexPlan = planOn(api) ? planPill(report?.codex) : null;
        const q = data.quiet;
        const key = JSON.stringify([pills, selected, panel, claudePlan, codexPlan, planOn(api), usageOn(api), githubLogin(api), q, otherWord()]);
        if (key !== rowKey) {
          rowKey = key;
          const focused = (document.activeElement as HTMLElement | null)?.closest?.("[data-pill], [data-stat]") as HTMLElement | null;
          const refocus = focused && row.contains(focused) ? (focused.dataset.pill ? `[data-pill="${focused.dataset.pill}"]` : `[data-stat="${focused.dataset.stat}"]`) : null;
          pillsBox.replaceChildren(
            ...pills.map((p) => agentPill({ ...p, name: nameOf(p.id), color: agentColor(p.id), pressed: panel === "agent" && p.id === selected, onClick: () => choose(p.id) })),
            addPill(panel === "add", () => openPanel("add")),
          );
          const stats: HTMLElement[] = [];
          if (planOn(api))
            stats.push(
              statPill({ key: "plan-claude", label: claudePlan?.label ?? "Forfait", iconName: "logo:claude", title: "Limites du forfait de Claude", pressed: panel === "plan", tone: claudePlan?.level, onClick: () => openPanel("plan") }),
            );
          if (codexPlan) stats.push(statPill({ key: "plan-codex", label: codexPlan.label, iconName: "logo:codex", title: "Limites du forfait de Codex", pressed: panel === "plan", tone: codexPlan.level, onClick: () => openPanel("plan") }));
          if (usageOn(api)) stats.push(statPill({ key: "usage", label: "Jetons", title: "Compteur de jetons des agents", pressed: panel === "usage", onClick: () => openPanel("usage") }));
          if (githubLogin(api)) stats.push(statPill({ key: "github", label: "GitHub", title: "Calendrier de contributions", pressed: panel === "github", onClick: () => openPanel("github") }));
          const quietUntil = q?.until ? new Date(q.until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
          stats.push(
            statPill({
              key: "quiet",
              label: q ? quietUntil || (q.held ? String(q.held) : "") : "",
              iconName: "🎧",
              title: q ? "Concentration en cours" : "Concentration : les notifications des agents attendent, résumé à la fin",
              pressed: panel === "quiet",
              tone: q ? "on" : undefined,
              onClick: () => openPanel("quiet"),
            }),
          );
          statsBox.replaceChildren(...stats);
          if (refocus) row.querySelector<HTMLElement>(refocus)?.focus();
        }

        // La carte : redessinée seulement si ce qu'elle montre change (le
        // focus, une liste déroulante ouverte, une confirmation restent en
        // place), avec un petit fondu quand on passe à une autre carte.
        const id = selected ?? "";
        const minute = Math.floor(Date.now() / 60_000); // « depuis 4 min »
        const content =
          kind === "setup"
            ? setupKey(setupCtx, setupOptions(id, plug))
            : kind === "agent"
              ? JSON.stringify([plug, data.sessions, data.asks.map((q) => q.id), data.events.filter((e) => pillOfSource(e.source) === id), live, tools, projects, lastSessions, messagesOpen, launchChoice, minute, otherWord()])
              : kind === "welcome"
                ? JSON.stringify(data.asks.map((q) => q.id))
                : kind === "quiet"
                  ? JSON.stringify([data.quiet, minute])
                  : kind === "add"
                    ? JSON.stringify([pills.map((p) => p.id), otherWord()])
                    : "";
        const head = `${kind}:${id}`;
        const sKey = `${head}|${content}`;
        if (sKey === stageKey) return;
        const swap = !stageKey.startsWith(`${head}|`);
        // Une liste déroulante ouverte dans la carte : on attend qu'elle se ferme.
        if (!swap && (document.activeElement as HTMLElement | null)?.tagName === "SELECT" && stage.contains(document.activeElement)) return;
        stageKey = sKey;
        let card: HTMLElement;
        if (kind === "welcome") card = welcomeCard();
        else if (kind === "setup") card = setupCard(setupCtx, setupOptions(id, plug));
        else if (kind === "agent") card = agentCard(id, plug);
        else if (kind === "plan") card = panelCard(plan.box);
        else if (kind === "usage") card = panelCard(usage.box);
        else if (kind === "github") card = panelCard(githubBox);
        else if (kind === "quiet") {
          drawQuiet();
          card = backCard("agents-quiet-box", "Concentration", quiet);
        } else card = addCard(pills.map((p) => p.id));
        if (swap) card.classList.add("agents-card-in");
        stage.replaceChildren(card);
      };
      const setupOptions = (id: string, plug: Plug) => ({
        id,
        name: nameOf(id),
        color: agentColor(id),
        plug,
        configOpen,
        removable: added().includes(id) && !(BASE_PILLS as readonly string[]).includes(id),
        later: () => {
          writeStore(STORE.later, JSON.stringify([...new Set([...later(), id])]));
          render();
        },
        close: () => {
          configOpen = false;
          render();
        },
        remove: () => {
          writeStore(STORE.added, JSON.stringify(added().filter((x) => x !== id)));
          writeStore(STORE.pill, "");
          configOpen = false;
          render();
        },
      });

      const draw = async () => {
        // Une session vient peut-être de finir : sa dernière phrase a changé.
        void loadLast();
        if (panel === "usage") void usage.load();
        try {
          data = await api.invoke<History>("history");
        } catch {
          return render(); // hors de l'appli
        }
        data.asks ??= [];
        // Les fichiers modifiés en direct (réglage « liveFiles »).
        live = liveOn(api) ? await api.invoke<{ files: LiveFile[] } | null>("live").then((r) => r?.files ?? [], () => []) : [];
        // Les questions fermées : on oublie leur ligne gardée.
        for (const id of askRows.keys()) if (!data.asks.some((q) => q.id === id)) askRows.delete(id);
        render();
        void plan.load().then(() => render());
      };

      redraws.add(draw);
      render();
      void draw();
      const stopTimer = pacedInterval(() => void draw(), "agentsList", true); // pour « il y a 5 min »
      // Un fichier vient d'être modifié : un seul redessin pour une rafale.
      let liveTimer = 0;
      const soon = () => {
        if (!liveTimer) liveTimer = window.setTimeout(() => ((liveTimer = 0), void draw()), 300);
      };
      const stopLive = api.on("agents.live", soon);
      // La liste de tâches d'un agent a bougé : pareil.
      const stopTodos = api.on("agents.todos", soon);
      const stopSettings = api.onSettingsChange(() => void loadHookStates());
      return () => {
        stopLive();
        stopTodos();
        stopSettings();
        window.clearTimeout(liveTimer);
        redraws.delete(draw);
        stopTimer();
        usage.stop();
        stopGithub();
        stopFiles();
      };
    },
  },
};
