// Module « Agents IA » : Claude Code, Codex et Gemini CLI préviennent l'île.
//
// Le Rust (src-tauri/src/modules/agents.rs) écoute le canal local, comprend
// les hooks et publie « agents.event » (une notification) et « agents.changed »
// (le tableau des sessions a bougé). Ici : la notification avec « Y aller »
// (ramène la fenêtre de l'agent devant), les boutons pour lancer un agent
// dans un projet, le tableau « En cours », les derniers messages, et la marche
// à suivre pour brancher chaque outil.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { Bridge } from "../../core/bridge";
import { el } from "../../island/dom";
import { agentIcon, icon } from "../../island/icon";

interface AgentEvent {
  at: number;
  source: string;
  kind: "waiting" | "done" | "info";
  title: string;
  body: string;
  project: string;
  session: string;
}

/** Une question posée par un agent (outil MCP « island_ask »), ou une demande
 *  de permission (« island.exe permission » : Autoriser / Refuser / Au terminal). */
interface Ask {
  id: number;
  kind: "question" | "permission";
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

/** Les agents qu'on sait lancer (réglages « Proposer … »). */
type LaunchTool = "claude" | "codex" | "gemini";
const LAUNCH_NAMES: Record<LaunchTool, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" };
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
      const where = e.project ? `Projet ${e.project}` : "";
      api.notify({
        title: e.title,
        // Attente : le message de Claude (« … to use Bash ») ; sinon, le projet.
        body: e.kind === "waiting" ? [e.body, where].filter(Boolean).join(" · ") : e.body || where,
        // Le logo de l'agent (Claude, Gemini…) ; sinon l'état (✋ ✅ 💬).
        icon: sourceIcon(e.source) ?? ICON[e.kind] ?? "🤖",
        // Claude attend : l'île s'ouvre pour te le dire ; le reste reste discret.
        priority: e.kind === "waiting" ? "high" : "normal",
        key: `agents-${e.session}`,
        actions: e.session ? [{ label: "↗ Y aller", run: () => goTo(api, e.session) }] : undefined,
      });
    });
    // Un agent te pose une question (MCP) : elle reste affichée jusqu'à ton clic.
    api.on("agents.ask", (msg) => {
      const q = msg.payload as Ask | null;
      if (!q?.question) return;
      if (q.kind === "permission") return showPermission(api, q);
      api.notify({
        title: `${q.who} te demande`,
        body: q.question,
        icon: "❓",
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
        body: c.gone ? "L'agent n'attend plus cette réponse." : c.expired ? "L'agent continue sans, ou te demande dans le terminal." : undefined,
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
  },

  views: {
    expanded(root, api: ModuleApi) {
      const asks = el("ul", { class: "agents-asks" });
      const quiet = el("div", { class: "agents-quiet" });
      const board = el("ul", { class: "agents-board" });
      const list = el("ul", { class: "agents-list" });
      const status = el("p", { class: "muted agents-status" });
      const guide = el("details", { class: "agents-guide" });
      const launch = el("div", { class: "agents-launch" });
      root.append(
        el("div", { class: "agents" }, launch, asks, status, quiet, board, el("div", { class: "muted agents-subtitle" }, "Derniers messages"), list, guide),
      );

      // ── Lancer un agent ────────────────────────────────────────────────────
      const start = (args: Record<string, unknown>) =>
        api.handler(async () => {
          try {
            await api.invoke("launch", { tool: chosenTool, ...args });
            api.closeIsland();
          } catch (err) {
            api.notify({ title: LAUNCH_NAMES[chosenTool], body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
          }
        });
      const pick = api.handler(async () => {
        const path = await Bridge.pickFolder(`Ouvrir ${LAUNCH_NAMES[chosenTool]} dans…`);
        if (path) await start({ path })();
      });
      const drawLaunch = (tools: LaunchTool[], projects: { path: string; name: string }[]) => {
        if (!tools.includes(chosenTool)) chosenTool = tools[0] ?? "claude";
        if (!tools.length) return launch.replaceChildren();
        // Un agent proposé seulement : pas besoin de choisir.
        const chips =
          tools.length > 1
            ? tools.map((t) =>
                el(
                  "button",
                  { class: `net-chip${t === chosenTool ? " active" : ""}`, onclick: api.handler(() => ((chosenTool = t), drawLaunch(tools, projects))) },
                  LAUNCH_NAMES[t],
                ),
              )
            : [el("span", { class: "agents-launch-title" }, LAUNCH_NAMES[chosenTool])];
        launch.replaceChildren(
          el("span", { class: "agents-launch-title" }, "▶"),
          ...chips,
          el("span", { class: "agents-launch-sep" }),
          ...(projects.length
            ? projects.map((p, i) => el("button", { class: "btn small", title: `Ouvrir ${LAUNCH_NAMES[chosenTool]} dans ${p.path}`, onclick: start({ index: i }) }, `📁 ${p.name}`))
            : [el("button", { class: "btn small primary", title: "Dans ton dossier utilisateur", onclick: start({}) }, "Lancer")]),
          el("button", { class: "btn small", title: "Choisir le dossier du projet", onclick: pick }, "Autre dossier…"),
        );
      };
      void api.invoke<{ tools: LaunchTool[]; projects: { path: string; name: string }[] }>("projects").then(
        ({ tools, projects }) => drawLaunch(tools, projects),
        () => {},
      );

      // ── Brancher un outil : Claude Code, Codex ou Gemini CLI ───────────────
      type Tool = "claude-code" | "codex" | "gemini";
      const TOOLS: Record<Tool, { name: string; file: string; steps: string }> = {
        "claude-code": {
          name: "Claude Code",
          file: "%USERPROFILE%\\.claude\\settings.json",
          steps: "Colle le bloc « hooks » (fusionne-le s'il en existe déjà un), puis relance Claude Code.",
        },
        codex: {
          name: "Codex",
          file: "%USERPROFILE%\\.codex\\config.toml",
          steps: "Colle les lignes à la fin du fichier, relance Codex, puis tape /hooks pour les approuver (Codex le demande une fois).",
        },
        gemini: {
          name: "Gemini CLI",
          file: "%USERPROFILE%\\.gemini\\settings.json",
          steps: "Colle le bloc « hooks » (version 0.26 ou plus récente), puis relance Gemini CLI.",
        },
      };
      let tool: Tool = "claude-code";
      const exe = el("code", { class: "agents-exe" });
      const steps = el("ol", {});
      const toolButtons = (Object.keys(TOOLS) as Tool[]).map((t) =>
        el("button", { class: "net-chip", "data-tool": t, onclick: api.handler(() => ((tool = t), drawGuide())) }, TOOLS[t].name),
      );
      const copy = el(
        "button",
        {
          class: "btn small primary",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_config", { tool });
              api.notify({ title: "Configuration copiée", body: `Colle-la dans ${TOOLS[tool].file}.`, icon: "📋", priority: "low", key: "agents-copied" });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
            }
          }),
        },
        "📋 Copier la configuration",
      );
      // Brancher l'île comme serveur MCP : l'agent peut alors l'appeler de lui-même.
      const MCP_STEPS: Record<Tool, string> = {
        "claude-code": "Colle la commande dans un terminal (une seule fois), puis relance Claude Code.",
        codex: "Colle les lignes à la fin de %USERPROFILE%\\.codex\\config.toml, puis relance Codex.",
        gemini: "Fusionne le bloc « mcpServers » dans %USERPROFILE%\\.gemini\\settings.json, puis relance Gemini CLI.",
      };
      const mcpSteps = el("p", { class: "muted agents-mcp-steps" });
      const copyMcp = el(
        "button",
        {
          class: "btn small",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_mcp", { tool });
              api.notify({ title: "Configuration MCP copiée", body: MCP_STEPS[tool], icon: "📋", priority: "low", key: "agents-copied" });
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
              api.notify({ title: "Hook d'autorisation copié", body: `Colle-le dans ${TOOLS[tool].file}, puis active le réglage « Autoriser / Refuser depuis l'île ».`, icon: "📋", priority: "low", key: "agents-copied" });
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
        steps.replaceChildren(
          el("li", {}, "Copie la configuration."),
          el("li", {}, "Ouvre ", el("code", {}, TOOLS[tool].file), ". ", TOOLS[tool].steps),
          el("li", {}, "Chaque hook lance : ", exe),
        );
        mcpSteps.textContent =
          "En plus (facultatif) : branche l'île comme serveur MCP. L'agent pourra alors t'envoyer un message, sa progression, lancer le minuteur, ou te poser une question à choix que tu réponds d'un clic. " +
          MCP_STEPS[tool];
        const permOn = api.settings().permissions === true;
        permText.textContent =
          tool === "gemini"
            ? "Autoriser / Refuser depuis l'île : Gemini CLI ne le permet pas (un hook peut refuser, pas autoriser). Réponds dans son terminal."
            : `Autoriser / Refuser depuis l'île (${permOn ? "activé" : "désactivé dans les réglages"}) : quand ${TOOLS[tool].name} demande une permission, l'île montre la commande avec « Autoriser » (à confirmer) et « Refuser ». Sans réponse à temps, la question passe au terminal. Colle ce hook en plus, de la même façon.`;
        copyPerm.hidden = tool === "gemini";
      };
      guide.append(
        el("summary", {}, "Brancher Claude Code, Codex ou Gemini"),
        el("div", { class: "net-chips agents-tools" }, ...toolButtons),
        steps,
        el("div", { class: "btn-row" }, copy, test),
        mcpSteps,
        el("div", { class: "btn-row" }, copyMcp),
        permText,
        el("div", { class: "btn-row" }, copyPerm),
      );
      drawGuide();

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
          el("div", {}, el("b", {}, isPerm ? `🔐 ${q.question}` : `❓ ${q.who} te demande`), el("small", { class: "muted" }, ` · ${left}`)),
          isPerm ? (q.detail ? el("code", { class: "agents-ask-detail" }, q.detail) : null) : el("div", { class: "agents-ask-q" }, q.question),
          buttons,
        );
      };

      const draw = async () => {
        let data: { events: AgentEvent[]; working: number; sessions: Session[]; asks: Ask[]; quiet: { until: number | null; held: number } | null };
        try {
          data = await api.invoke("history");
        } catch {
          return; // hors de l'appli
        }
        const waiting = data.sessions.filter((x) => x.state === "waiting").length;
        status.textContent = data.sessions.length
          ? [data.working ? `🧠 ${data.working} au travail` : "", waiting ? `✋ ${waiting} t'attend${waiting > 1 ? "ent" : ""}` : ""].filter(Boolean).join(" · ") ||
            "Personne ne travaille en ce moment."
          : "Aucune session pour l'instant.";
        // Les questions en attente (aussi après avoir fermé leur notification).
        asks.replaceChildren(...(data.asks ?? []).map((q) => askRow(q)));
        drawQuiet(data.quiet);
        // Le tableau « En cours » : un clic ramène la fenêtre de la session.
        board.replaceChildren(
          ...data.sessions.map((x) => {
            const what = {
              working: `travaille depuis ${duration(x.since)}`,
              waiting: `t'attend depuis ${duration(x.since)}`,
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
                el("b", {}, SOURCE_NAMES[x.source] ?? x.source),
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
                    el("b", {}, e.title),
                    el("small", { class: "muted" }, [e.project, e.body, ago(e.at)].filter(Boolean).join(" · ")),
                  ),
                ),
              )
            : [el("li", { class: "muted agents-empty" }, "Rien reçu pour l'instant. Branche Claude Code ci-dessous, puis clique « Essayer ».")]),
        );
        if (!data.events.length) guide.open = true;
      };

      void api.invoke<{ exe: string }>("hook_config").then(
        (c) => (exe.textContent = `${c.exe} notify`),
        () => (exe.textContent = "island.exe notify"),
      );
      redraws.add(draw);
      void draw();
      const timer = window.setInterval(() => void draw(), 15_000); // pour « il y a 5 min »
      return () => {
        redraws.delete(draw);
        window.clearInterval(timer);
      };
    },
  },
};
