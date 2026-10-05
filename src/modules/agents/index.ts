// Module « Agents IA » : Claude Code (et d'autres outils) préviennent l'île.
//
// Le Rust (src-tauri/src/modules/agents.rs) écoute le canal local, comprend
// les hooks de Claude Code et publie « agents.event ». Ici : la notification
// dans l'île, l'historique des derniers messages, et la marche à suivre pour
// brancher Claude Code (copier la configuration, essayer).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
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
      root.append(el("div", { class: "agents" }, status, list, guide));

      const copy = el(
        "button",
        {
          class: "btn small primary",
          onclick: api.handler(async () => {
            try {
              await api.invoke("copy_config");
              api.notify({ title: "Configuration copiée", body: "Colle-la dans le settings.json de Claude Code.", icon: "📋", priority: "low", key: "agents-copied" });
            } catch (err) {
              api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
            }
          }),
        },
        "📋 Copier la configuration",
      );
      const test = el("button", { class: "btn small", title: "Fait comme si Claude venait de finir", onclick: api.handler(() => api.invoke("test")) }, "Essayer");
      const exe = el("code", { class: "agents-exe" });
      guide.append(
        el("summary", {}, "Brancher Claude Code"),
        el(
          "ol",
          {},
          el("li", {}, "Copie la configuration (les hooks « Notification », « Stop » et « UserPromptSubmit »)."),
          el("li", {}, "Ouvre ", el("code", {}, "%USERPROFILE%\\.claude\\settings.json"), " et colle le bloc « hooks » (fusionne-le s'il en existe déjà un)."),
          el("li", {}, "Relance Claude Code. Chaque hook lance : ", exe),
        ),
        el("div", { class: "btn-row" }, copy, test),
      );

      const draw = async () => {
        let data: { events: AgentEvent[]; working: number };
        try {
          data = await api.invoke("history");
        } catch {
          return; // hors de l'appli
        }
        status.textContent =
          data.working > 0 ? `🧠 Claude travaille (${data.working} session${data.working > 1 ? "s" : ""})` : "Aucun agent au travail pour l'instant.";
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
        (c) => (exe.textContent = `${c.exe} notify --source claude-code`),
        () => (exe.textContent = "island.exe notify --source claude-code"),
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
