// Module « Agents IA » : Claude Code, Codex et Gemini CLI préviennent l'île.
//
// Le Rust (src-tauri/src/modules/agents.rs) écoute le canal local, comprend
// les hooks et publie « agents.event » (une notification) et « agents.changed »
// (le tableau des sessions a bougé). Ici : la notification avec « Y aller »
// (ramène la fenêtre de l'agent devant), les boutons pour lancer un agent
// dans un projet, le tableau « En cours », les derniers messages, et la marche
// à suivre pour brancher chaque outil.
//
// « A fini » peut arriver avec un bilan (dépôt git du dossier de la session) :
// « 3 fichiers modifiés, +120 −14 », avec « Ouvrir dans VS Code »,
// « Terminal ici » et « Fichiers… » (la liste, report-view.ts), et avec la
// dernière phrase de l'agent (« Copier »). Chaque projet a aussi « Reprendre »
// (la dernière session), avec la dernière phrase échangée en petit.
//
// Les outils en plus (Copilot CLI, Cursor, Qwen Code, Goose, OpenCode, Kiro,
// Hermes, Aider, Amp, « Autre outil ») sont décrits dans tools.ts ; les
// coucous de la mascotte pendant une attente dans wait-watch.ts.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import { t } from "../../core/i18n";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import type { NotificationAction } from "../../core/notifications";
import { Bridge } from "../../core/bridge";
import { el } from "../../island/dom";
import { pacedInterval } from "../../core/perf";
import { agentIcon, icon } from "../../island/icon";
import { byModel, changesLine, modelLabel, namesLine, periodFrom, since, sumTokens, tokensShort, totalTokens, type ChangeSummary, type UsagePeriod, type UsageReport } from "./texts";
import { HOOK_TOOLS, LAUNCH, launchName, sourceName, summaryLine } from "./tools";
import { mountFilesPanel, requestFiles } from "./report-view";
import { startWaitWatch } from "./wait-watch";

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
}

/** Les agents qu'on sait lancer (réglages « Proposer … », liste dans tools.ts ; le Rust décide). */
type LaunchTool = string;
/** Le nom affiché d'une source de hooks. */
const SOURCE_NAMES: Record<string, string> = { "claude-code": "Claude", codex: "Codex", gemini: "Gemini" };
/** L'agent choisi pour « Lancer » (gardé tant que l'île est ouverte). */
let chosenTool: LaunchTool = "claude";

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
  },

  views: {
    expanded(root, api: ModuleApi) {
      const asks = el("ul", { class: "agents-asks" });
      const quiet = el("div", { class: "agents-quiet" });
      const board = el("ul", { class: "agents-board" });
      // Le compteur de jetons (journaux locaux de Claude Code et Codex).
      const usageBox = el("section", { class: "agents-usage" });
      const list = el("ul", { class: "agents-list" });
      const status = el("p", { class: "muted agents-status" });
      const guide = el("details", { class: "agents-guide" });
      const launch = el("div", { class: "agents-launch" });
      const projectRows = el("ul", { class: "agents-projects" });
      // La liste des fichiers d'un bilan (report-view.ts), vide le reste du temps.
      const filesBox = el("section", { class: "agents-files-box" });
      root.append(
        el("div", { class: "agents" }, launch, projectRows, asks, filesBox, status, quiet, board, usageBox, el("div", { class: "muted agents-subtitle" }, "Derniers messages"), list, guide),
      );
      const stopFiles = mountFilesPanel(api, filesBox);
      /** Le nom de l'agent choisi (« Autre outil » : le mot du réglage). */
      const chosenName = () => launchName(chosenTool, String(api.settings().otherTool ?? ""));

      // ── Lancer un agent ────────────────────────────────────────────────────
      const start = (args: Record<string, unknown>) =>
        api.handler(async () => {
          try {
            await api.invoke("launch", { tool: chosenTool, ...args });
            api.closeIsland();
          } catch (err) {
            api.notify({ title: chosenName(), body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
          }
        });
      const pick = api.handler(async () => {
        const path = await Bridge.pickFolder(`Ouvrir ${chosenName()} dans…`);
        if (path) await start({ path })();
      });
      // Les agents proposés, les projets du réglage, et la dernière session de
      // Claude Code de chacun (pour « Reprendre »).
      let tools: LaunchTool[] = [];
      let projects: { path: string; name: string }[] = [];
      let lastSessions: LastSession[] = [];
      let lastFetch = 0;
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
      const drawLaunch = () => {
        if (!tools.includes(chosenTool)) chosenTool = tools[0] ?? "claude";
        if (!tools.length) {
          projectRows.replaceChildren();
          return launch.replaceChildren();
        }
        // Un agent proposé seulement : pas besoin de choisir.
        const chips =
          tools.length > 1
            ? tools.map((t) =>
                el("button", { class: `net-chip${t === chosenTool ? " active" : ""}`, onclick: api.handler(() => ((chosenTool = t), drawLaunch())) }, launchName(t, String(api.settings().otherTool ?? ""))),
              )
            : [el("span", { class: "agents-launch-title" }, chosenName())];
        launch.replaceChildren(
          el("span", { class: "agents-launch-title" }, "▶"),
          ...chips,
          el("span", { class: "agents-launch-sep" }),
          ...(projects.length ? [] : [el("button", { class: "btn small primary", title: "Dans votre dossier utilisateur", onclick: start({}) }, "Lancer")]),
          el("button", { class: "btn small", title: "Choisir le dossier du projet", onclick: pick }, "Autre dossier…"),
        );
        // Une ligne par projet : une nouvelle session, ou « Reprendre » la
        // dernière (Claude Code : s'il y en a une ; les autres : si l'outil le
        // propose, voir tools.ts ; Gemini CLI, Aider, Amp : non).
        projectRows.replaceChildren(
          ...projects.map((p, i) => {
            const last = chosenTool === "claude" ? lastSessions.find((l) => l.index === i && l.found) : undefined;
            const info = LAUNCH[chosenTool];
            const resumable = chosenTool === "claude" ? !!last : !!info?.resume;
            return el(
              "li",
              { class: "agents-project" },
              el("button", { class: "btn small", title: `Ouvrir ${chosenName()} dans ${p.path}`, onclick: start({ index: i }) }, `📁 ${p.name}`),
              resumable
                ? el(
                    "button",
                    {
                      class: "btn small",
                      title: info?.resumeTitle ?? "Reprendre la dernière session",
                      onclick: start({ index: i, resume: true }),
                    },
                    "↻ Reprendre",
                  )
                : null,
              last ? lastLine(last) : null,
            );
          }),
        );
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
        drawLaunch();
      };
      void api.invoke<{ tools: LaunchTool[]; projects: { path: string; name: string }[] }>("projects").then(
        (r) => {
          tools = r.tools;
          projects = r.projects;
          drawLaunch();
          void loadLast();
        },
        () => {},
      );

      // ── Brancher un outil : Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor, Qwen Code, Goose (tools.ts)
      type Tool = string;
      const TOOLS = HOOK_TOOLS;
      let tool: Tool = "claude-code";
      const exe = el("code", { class: "agents-exe" });
      const steps = el("ol", {});

      // ── Installer automatiquement : Ondine écrit lui-même ses hooks dans le
      // fichier de l'outil (fusion : le reste du fichier est gardé, copie .bak).
      interface HookState {
        file: string;
        state: "installed" | "stale" | "absent" | "unreadable";
        permission: boolean;
        otherPermission: boolean;
      }
      let hookStates: Partial<Record<Tool, HookState>> = {};
      /** La copie de sécurité faite au dernier enregistrement, par outil. */
      const backups: Partial<Record<Tool, string>> = {};
      const hookState = el("div", { class: "agents-hook-state" });
      /** Le chemin complet du fichier (sinon la forme %USERPROFILE%). */
      const fileOf = (t: Tool) => hookStates[t]?.file || TOOLS[t].file;
      const loadHookStates = async () => {
        try {
          const r = await api.invoke<{ tools: Partial<Record<Tool, HookState>> }>("hook_status");
          hookStates = r?.tools ?? {};
        } catch {
          hookStates = {};
        }
        // Des hooks vers un ancien ondine.exe : on ouvre la marche à suivre.
        if (Object.values(hookStates).some((s) => s?.state === "stale")) guide.open = true;
        drawGuide();
      };
      const RESTART = (t: Tool) => TOOLS[t].restart;
      const install = el(
        "button",
        {
          class: "btn small primary",
          title: "Ajoute les hooks d'Ondine au fichier de configuration, sans toucher au reste",
          onclick: api.handler(async () => {
            const t = tool;
            try {
              const r = await api.invoke<{ backup: string | null; changed: boolean; otherPermission: boolean } | null>("hook_install", { tool: t });
              if (r?.backup) backups[t] = r.backup;
              api.notify(
                r && !r.changed
                  ? { title: "Hooks déjà installés", body: "Rien à changer.", icon: "✔️", priority: "low", key: "agents-hooks" }
                  : { title: "Hooks installés", body: RESTART(t), icon: "✅", priority: "normal", key: "agents-hooks" },
              );
              // Claude Code : un autre programme répond aussi aux demandes de permission.
              if (r?.otherPermission)
                api.notify({
                  title: "Deux réponses aux permissions",
                  body: "Un autre programme a aussi un hook PermissionRequest dans Claude Code : il peut répondre avant l'île, ou l'inverse. Ondine ne l'a pas retiré.",
                  icon: "⚠️",
                  priority: "normal",
                  key: "agents-hooks-perm",
                });
            } catch (err) {
              api.notify({ title: "Installation impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "agents-hooks" });
            }
            await loadHookStates();
          }),
        },
        "⚡ Installer automatiquement",
      );
      const uninstall = el(
        "button",
        {
          class: "btn small",
          title: "Retire seulement les hooks d'Ondine de ce fichier",
          onclick: api.handler(async () => {
            const t = tool;
            try {
              const r = await api.invoke<{ backup: string | null; removed: number } | null>("hook_remove", { tool: t });
              if (r?.backup) backups[t] = r.backup;
              api.notify(
                r && !r.removed
                  ? { title: "Aucun hook d'Ondine dans ce fichier", icon: "ℹ️", priority: "low", key: "agents-hooks" }
                  : { title: "Hooks d'Ondine retirés", body: "Les autres réglages et hooks du fichier sont gardés.", icon: "🧹", priority: "low", key: "agents-hooks" },
              );
            } catch (err) {
              api.notify({ title: "Retrait impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: "agents-hooks" });
            }
            await loadHookStates();
          }),
        },
        "Retirer",
      );
      const drawHookState = () => {
        const s = hookStates[tool];
        if (!s) return hookState.replaceChildren();
        const permOn = api.settings().permissions === true && (tool === "claude-code" || tool === "codex");
        const label = {
          installed: permOn && !s.permission ? "✅ Installé, sans « Autoriser depuis l'île » : réinstallez pour l'ajouter" : "✅ Installé",
          stale: "⚠️ Ancien chemin : ces hooks lancent un autre ondine.exe, que l'île refuse. Réinstallez-les.",
          absent: "Non installé",
          unreadable: "⚠️ Fichier illisible (JSON ou TOML invalide) : Ondine n'y touche pas. Corrigez-le ou utilisez la copie.",
        }[s.state];
        const backup = backups[tool];
        hookState.replaceChildren(
          el("div", { class: `agents-hook-badge ${s.state}` }, label),
          el("div", { class: "muted" }, "Fichier : ", el("code", {}, s.file)),
          ...(s.otherPermission && s.permission
            ? [el("div", { class: "muted" }, "⚠️ Un autre programme répond aussi aux demandes de permission (PermissionRequest) : deux réponses concurrentes.")]
            : []),
          ...(backup ? [el("div", { class: "muted" }, `Copie de l'ancien fichier : ${backup}`)] : []),
        );
        uninstall.hidden = s.state !== "installed" && s.state !== "stale";
        install.disabled = s.state === "unreadable";
      };
      const toolButtons = (Object.keys(TOOLS) as Tool[]).map((t) =>
        el("button", { class: "net-chip", "data-tool": t, onclick: api.handler(() => ((tool = t), drawGuide())) }, TOOLS[t].name),
      );
      const copy = el(
        "button",
        {
          class: "btn small",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_config", { tool });
              api.notify({ title: "Configuration copiée", body: `Collez-la dans ${fileOf(tool)}.`, icon: "📋", priority: "low", key: "agents-copied" });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
            }
          }),
        },
        "📋 Copier la configuration",
      );
      // Brancher l'île comme serveur MCP : l'agent peut alors l'appeler de lui-même.
      const MCP_STEPS: Record<string, string> = {
        "claude-code": "Collez la commande dans un terminal (une seule fois), puis relancez Claude Code.",
        codex: "Collez les lignes à la fin de %USERPROFILE%\\.codex\\config.toml, puis relancez Codex.",
        gemini: "Fusionnez le bloc « mcpServers » dans %USERPROFILE%\\.gemini\\settings.json, puis relancez Gemini CLI.",
      };
      const mcpSteps = el("p", { class: "muted agents-mcp-steps" });
      const copyMcp = el(
        "button",
        {
          class: "btn small",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_mcp", { tool });
              api.notify({ title: "Configuration MCP copiée", body: MCP_STEPS[tool] ?? "", icon: "📋", priority: "low", key: "agents-copied" });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
            }
          }),
        },
        "🔌 Copier la config MCP",
      );
      // Autoriser / Refuser depuis l'île : un hook à part, seulement si on le veut.
      const permText = el("p", { class: "muted agents-mcp-steps" });
      const copyPerm = el(
        "button",
        {
          class: "btn small",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_config", { tool, permission: true });
              api.notify({ title: "Hook d'autorisation copié", body: `Collez-le dans ${fileOf(tool)}, puis activez le réglage « Autoriser / Refuser depuis l'île ».`, icon: "📋", priority: "low", key: "agents-copied" });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
            }
          }),
        },
        "🔐 Copier le hook d'autorisation",
      );
      const test = el("button", { class: "btn small", title: "Fait comme si Claude venait de finir", onclick: api.handler(() => api.invoke("test")) }, "Essayer");
      const drawGuide = () => {
        toolButtons.forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
        drawHookState();
        steps.replaceChildren(
          el("li", {}, "Copiez la configuration."),
          el("li", {}, "Ouvrez ", el("code", {}, fileOf(tool)), ". ", TOOLS[tool].steps),
          el("li", {}, "Chaque hook lance : ", exe),
        );
        const withMcp = TOOLS[tool].mcp;
        mcpSteps.textContent = withMcp
          ? "En plus (facultatif) : branchez l'île comme serveur MCP. L'agent pourra alors vous envoyer un message, sa progression, lancer le minuteur, vous poser une question à choix, ajouter une note, déposer un fichier sur l'étagère, vous demander une capture d'écran ou l'ouverture d'un lien (toujours après votre clic). " +
            (MCP_STEPS[tool] ?? "")
          : `Serveur MCP : la configuration n'est pas proposée pour ${TOOLS[tool].name} (elle n'a pas été vérifiée). Seuls les hooks sont installés.`;
        copyMcp.hidden = !withMcp;
        const permOn = api.settings().permissions === true;
        permText.textContent =
          tool === "gemini"
            ? "Autoriser / Refuser depuis l'île : Gemini CLI ne le permet pas (un hook peut refuser, pas autoriser). Répondez dans son terminal."
            : !withMcp
              ? "Autoriser / Refuser depuis l'île : seulement pour Claude Code et Codex. Répondez dans le terminal de cet outil."
              : `Autoriser / Refuser depuis l'île (${permOn ? "activé" : "désactivé dans les réglages"}) : quand ${TOOLS[tool].name} demande une permission, l'île montre la commande avec « Autoriser » (à confirmer) et « Refuser ». Sans réponse à temps, la question passe au terminal. Collez ce hook en plus, de la même façon.`;
        copyPerm.hidden = !withMcp || tool === "gemini";
      };
      // « Brancher un autre outil » : la commande à mettre en fin de tâche (le
      // chemin vient du Rust : « hook_config » donne aussi cette ligne).
      const otherLine = el("code", { class: "agents-exe", "data-no-i18n": true });
      const otherGuide = el(
        "div",
        { class: "agents-other" },
        el("div", { class: "muted agents-subtitle" }, "Brancher un autre outil"),
        el(
          "p",
          { class: "muted" },
          "Un outil qui sait lancer une commande en fin de tâche prévient l'île avec « --event done » (ou « waiting » quand il attend votre réponse, « working » quand il repart). Donnez-lui cette ligne, telle quelle : ",
        ),
        otherLine,
        el("p", { class: "muted" }, "Pour le lancer d'ici, écrivez son mot de commande dans le réglage « Autre outil ». Rien n'est exécuté à sa demande : l'île affiche seulement « L'outil a fini »."),
      );
      guide.append(
        el("summary", {}, "Brancher un outil (Claude Code, Codex, Gemini, Copilot, Cursor…)"),
        el(
          "ol",
          { class: "muted agents-quick" },
          el("li", {}, "Choisissez l'outil, puis cliquez sur « Installer automatiquement »."),
          el("li", {}, "Relancez l'agent, puis cliquez sur « Essayer » : une notification doit apparaître."),
          el("li", {}, "Pour répondre aux permissions depuis l'île : activez « Autoriser / Refuser depuis l'île » dans les réglages, puis réinstallez. L'agent ne demande rien en mode automatique."),
        ),
        el("div", { class: "net-chips agents-tools" }, ...toolButtons),
        hookState,
        el("div", { class: "btn-row" }, install, uninstall, test),
        el("div", { class: "muted agents-subtitle" }, "Ou à la main"),
        steps,
        el("div", { class: "btn-row" }, copy),
        mcpSteps,
        el("div", { class: "btn-row" }, copyMcp),
        permText,
        el("div", { class: "btn-row" }, copyPerm),
        otherGuide,
      );
      drawGuide();
      void loadHookStates();

      // Le mode concentration : les notifications des agents attendent, résumé à la fin.
      const QUIET_CHOICES: [number, string][] = [[25, "25 min"], [60, "1 h"], [120, "2 h"], [0, "Jusqu'à l'arrêt"]];
      const drawQuiet = (q: { until: number | null; held: number } | null) => {
        if (q) {
          const until = q.until ? ` jusqu'à ${new Date(q.until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "";
          const held = q.held ? ` · ${q.held} en attente` : "";
          quiet.className = "agents-quiet on";
          quiet.replaceChildren(
            el("span", {}, `🎧 Concentration${until}${held}`),
            el("button", { class: "btn small", onclick: api.handler(() => api.invoke("quiet_stop")) }, "Arrêter"),
          );
        } else {
          quiet.className = "agents-quiet";
          quiet.replaceChildren(
            el("span", { class: "muted", title: "Les notifications des agents attendent ; un résumé à la fin" }, "🎧 Concentration"),
            ...QUIET_CHOICES.map(([minutes, label]) => el("button", { class: "net-chip", onclick: api.handler(() => api.invoke("quiet_start", { minutes })) }, label)),
          );
        }
      };

      // Une question en attente, dans l'onglet (aussi après avoir fermé sa notification).
      const askRow = (q: Ask): HTMLElement => {
        const left = `encore ${Math.max(1, Math.ceil((q.until - Date.now()) / 60000))} min`;
        const isPerm = q.kind === "permission";
        const buttons = el("div", { class: "btn-row" });
        const plain = () =>
          buttons.replaceChildren(
            ...q.options.map((o, i) =>
              // Autoriser : d'abord la confirmation, sur place.
              isPerm && i === 0
                ? el("button", { class: "btn small", onclick: api.handler(() => confirm()) }, `${o}…`)
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
        return el(
          "li",
          { class: `agents-ask ${q.kind}` },
          el("div", {}, el("b", {}, isPerm ? `🔐 ${q.question}` : q.kind === "capture" ? `✂️ ${q.question}` : q.kind === "open" ? `🔗 ${q.question}` : `❓ ${q.who} vous demande`), el("small", { class: "muted" }, ` · ${left}`)),
          q.kind !== "question" ? (q.detail ? el("code", { class: "agents-ask-detail" }, q.detail) : null) : el("div", { class: "agents-ask-q" }, q.question),
          buttons,
        );
      };

      // ── Utilisation : les jetons des agents, lus dans leurs journaux sur ce PC ──
      let period: UsagePeriod = "week";
      let usage: UsageReport | null = null;
      let usageError = "";
      let usageFetch = 0;
      const usageOn = () => api.settings().usage !== false;
      const drawUsage = () => {
        if (!usageOn()) return usageBox.replaceChildren();
        const chip = (p: UsagePeriod, label: string) =>
          el(
            "button",
            {
              class: `net-chip${p === period ? " on" : ""}`,
              onclick: api.handler(() => {
                period = p;
                drawUsage();
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
            el("button", { class: "net-chip", title: "Relire les journaux", onclick: api.handler(() => loadUsage(true)) }, "↻"),
          ),
        );
        if (!usage) return usageBox.replaceChildren(head, el("p", { class: "muted" }, usageError ? t(usageError) : "Lecture des journaux…"));
        const from = periodFrom(period);
        const rows = usage.days.filter((d) => d.day >= from);
        if (!rows.length) {
          return usageBox.replaceChildren(head, el("p", { class: "muted" }, usage.files ? "Rien sur cette période." : "Aucun journal de Claude Code ni de Codex sur ce PC."));
        }
        const sum = sumTokens(rows);
        const figure = (label: string, n: number) => el("span", { class: "agents-usage-figure" }, el("span", {}, label), " ", el("b", {}, tokensShort(n)));
        const figures = el(
          "p",
          { class: "agents-usage-figures" },
          figure("Entrée", sum.input),
          figure("Sortie", sum.output),
          figure("Cache lu", sum.cacheRead),
          figure("Cache écrit", sum.cacheWrite),
          el("span", { class: "muted" }, `${sum.messages.toLocaleString("fr-FR")} réponse${sum.messages > 1 ? "s" : ""}`),
        );
        const models = el(
          "ul",
          { class: "agents-usage-list" },
          ...byModel(rows).map((m) => el("li", {}, el("span", {}, `${SOURCE_NAMES[m.tool] ?? m.tool} · ${modelLabel(m.model)}`), el("b", {}, tokensShort(m.total)))),
        );
        const projects = usage.projects.length
          ? el("p", { class: "muted" }, el("span", {}, "Projets (30 jours)"), " : ", usage.projects.map((p) => `${p.name} ${tokensShort(totalTokens(p))}`).join(" · "))
          : null;
        const note = el("p", { class: "muted" }, usage.partial ? "Journaux trop nombreux : compte partiel (les plus récents d'abord)." : "Lu dans les journaux de Claude Code et Codex sur ce PC. Rien n'est envoyé.");
        usageBox.replaceChildren(head, figures, models, ...(projects ? [projects] : []), note);
      };
      /** Relit les journaux (au plus toutes les 60 s, sauf « ↻ »). */
      const loadUsage = async (force = false) => {
        if (!usageOn() || (!force && Date.now() - usageFetch < 60_000)) return;
        usageFetch = Date.now();
        try {
          usage = await api.invoke<UsageReport>("usage", { offsetMinutes: new Date().getTimezoneOffset(), days: 30 });
          usageError = "";
        } catch (e) {
          usage = null;
          usageError = errorText(e);
        }
        drawUsage();
      };
      drawUsage();
      const stopUsageSettings = api.onSettingsChange(() => {
        drawUsage();
        void loadUsage();
      });

      const draw = async () => {
        // Une session vient peut-être de finir : sa dernière phrase a changé.
        void loadLast();
        void loadUsage();
        let data: { events: AgentEvent[]; working: number; sessions: Session[]; asks: Ask[]; quiet: { until: number | null; held: number } | null };
        try {
          data = await api.invoke("history");
        } catch {
          return; // hors de l'appli
        }
        const waiting = data.sessions.filter((x) => x.state === "waiting").length;
        // Un morceau par élément : chacun garde son pictogramme et sa traduction.
        const parts = [data.working ? `🧠 ${data.working} au travail` : "", waiting ? `✋ ${waiting} vous attend${waiting > 1 ? "ent" : ""}` : ""].filter(Boolean);
        if (!data.sessions.length) status.textContent = "Aucune session pour l'instant.";
        else if (!parts.length) status.textContent = "Personne ne travaille en ce moment.";
        else status.replaceChildren(...parts.flatMap((x, i) => [i ? " · " : "", el("span", {}, x)]));
        // Les questions en attente (aussi après avoir fermé leur notification).
        asks.replaceChildren(...(data.asks ?? []).map((q) => askRow(q)));
        drawQuiet(data.quiet);
        // Le tableau « En cours » : un clic ramène la fenêtre de la session.
        board.replaceChildren(
          ...data.sessions.map((x) => {
            const what = {
              working: `travaille depuis ${duration(x.since)}`,
              waiting: `vous attend depuis ${duration(x.since)}`,
              done: `a fini ${ago(x.since)}`,
              idle: "sans nouvelles",
            }[x.state];
            return el(
              "li",
              {},
              el(
                "button",
                { class: `agents-session ${x.state}`, title: "Revenir à sa fenêtre", onclick: api.handler(() => goTo(api, x.id)) },
                el("i", { class: "agents-dot" }),
                el("span", { class: "agents-logo" }, icon(sourceIcon(x.source) ?? "🤖")),
                el("b", {}, SOURCE_NAMES[x.source] ?? sourceName(x.source)),
                el("span", {}, x.project || "—"),
                el("small", { class: "muted" }, what),
                el("span", { class: "agents-go" }, "↗"),
              ),
            );
          }),
        );
        list.replaceChildren(
          ...(data.events.length
            ? data.events.map((e) =>
                el(
                  "li",
                  { class: `agents-item ${e.kind}` },
                  el("span", { class: "launch-icon" }, ICON[e.kind] ?? "🤖"),
                  el(
                    "span",
                    { class: "launch-text" },
                    el("b", {}, e.changes?.files ? `${e.title} · ${changesLine(e.changes)}` : e.title),
                    // « il y a 6 min » traduit à part : la ligne entière (projet, message) ne l'est pas.
                    el("small", { class: "muted" }, [e.project, e.body, t(ago(e.at))].filter(Boolean).join(" · ")),
                  ),
                ),
              )
            : [el("li", { class: "muted agents-empty" }, "Rien reçu pour l'instant. Branchez Claude Code ci-dessous, puis cliquez sur « Essayer ».")]),
        );
        if (!data.events.length) guide.open = true;
      };

      void api.invoke<{ exe: string; other?: string }>("hook_config").then(
        (c) => {
          exe.textContent = `${c.exe} notify`;
          otherLine.textContent = c.other ?? `"${c.exe}" notify --source other --event done`;
        },
        () => {
          exe.textContent = "ondine.exe notify";
          otherLine.textContent = "ondine.exe notify --source other --event done";
        },
      );
      redraws.add(draw);
      void draw();
      const stopTimer = pacedInterval(() => void draw(), "agentsList", true); // pour « il y a 5 min »
      return () => {
        redraws.delete(draw);
        stopTimer();
        stopUsageSettings();
        stopFiles();
      };
    },
  },
};
