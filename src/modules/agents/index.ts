// Module « Agents IA » : Claude Code (et d'autres outils) préviennent l'île.
//
// Le Rust (src-tauri/src/modules/agents.rs) écoute le canal local, comprend
// les hooks de Claude Code et publie « agents.event ». Ici : la notification
// dans l'île, les boutons pour lancer Claude Code dans un projet, l'historique
// des derniers messages, et la marche à suivre pour brancher Claude Code
// (copier la configuration, essayer).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { Bridge } from "../../core/bridge";
import { el } from "../../island/dom";

interface AgentEvent {
  at: number;
  source: string;
  kind: "waiting" | "done" | "info";
  title: string;
  body: string;
  project: string;
}

const ICON: Record<AgentEvent["kind"], string> = { waiting: "✋", done: "✅", info: "💬" };
const redraws = new Set<() => void>();

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
        icon: ICON[e.kind] ?? "🤖",
        // Claude attend : l'île s'ouvre pour te le dire ; le reste reste discret.
        priority: e.kind === "waiting" ? "high" : "normal",
        key: `agents-${e.source}-${e.project}`,
      });
      redraws.forEach((r) => r());
    });
  },

  views: {
    expanded(root, api: ModuleApi) {
      const list = el("ul", { class: "agents-list" });
      const status = el("p", { class: "muted agents-status" });
      const guide = el("details", { class: "agents-guide" });
      const launch = el("div", { class: "agents-launch" });
      root.append(el("div", { class: "agents" }, launch, status, list, guide));

      // ── Lancer Claude Code ─────────────────────────────────────────────────
      const start = (args: Record<string, unknown>) =>
        api.handler(async () => {
          try {
            await api.invoke("launch_claude", args);
            api.closeIsland();
          } catch (err) {
            api.notify({ title: "Claude Code", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
          }
        });
      const pick = api.handler(async () => {
        const path = await Bridge.pickFolder("Ouvrir Claude Code dans…");
        if (path) await start({ path })();
      });
      void api.invoke<{ projects: { path: string; name: string }[] }>("projects").then(
        ({ projects }) =>
          launch.replaceChildren(
            el("span", { class: "agents-launch-title" }, "▶ Claude Code"),
            ...(projects.length
              ? projects.map((p, i) => el("button", { class: "btn small", title: `Ouvrir Claude Code dans ${p.path}`, onclick: start({ index: i }) }, `📁 ${p.name}`))
              : [el("button", { class: "btn small primary", title: "Dans ton dossier utilisateur", onclick: start({}) }, "Lancer")]),
            el("button", { class: "btn small", title: "Choisir le dossier du projet", onclick: pick }, "Autre dossier…"),
          ),
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
      const test = el("button", { class: "btn small", title: "Fait comme si Claude venait de finir", onclick: api.handler(() => api.invoke("test")) }, "Essayer");
      const drawGuide = () => {
        toolButtons.forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
        steps.replaceChildren(
          el("li", {}, "Copie la configuration."),
          el("li", {}, "Ouvre ", el("code", {}, TOOLS[tool].file), ". ", TOOLS[tool].steps),
          el("li", {}, "Chaque hook lance : ", exe),
        );
      };
      guide.append(
        el("summary", {}, "Brancher Claude Code, Codex ou Gemini"),
        el("div", { class: "net-chips agents-tools" }, ...toolButtons),
        steps,
        el("div", { class: "btn-row" }, copy, test),
      );
      drawGuide();

      const draw = async () => {
        let data: { events: AgentEvent[]; working: number };
        try {
          data = await api.invoke("history");
        } catch {
          return; // hors de l'appli
        }
        status.textContent =
          data.working > 0 ? `🧠 Au travail : ${data.working} session${data.working > 1 ? "s" : ""}` : "Aucun agent au travail pour l'instant.";
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
