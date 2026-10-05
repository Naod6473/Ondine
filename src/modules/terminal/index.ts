// Module « Terminal » : ouvre cmd, PowerShell, PowerShell 7 ou Windows
// Terminal en un clic. Le Rust (src-tauri/src/modules/terminal.rs) lance le
// programme ; ici, on ne fait que proposer les boutons.
//
// Dans l'onglet : le terminal choisi dans les réglages en grand, les autres en
// petit, « en administrateur », et « ailleurs… » pour choisir un dossier.
// Quand on dépose un dossier (ou un fichier) sur l'île : « Terminal ici ».

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { DropTarget, IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";

type ShellId = "powershell" | "cmd" | "pwsh" | "wt";

const SHELLS: Record<ShellId, { label: string; short: string }> = {
  powershell: { label: "Windows PowerShell", short: "PowerShell" },
  cmd: { label: "Invite de commandes", short: "cmd" },
  pwsh: { label: "PowerShell 7", short: "pwsh" },
  wt: { label: "Windows Terminal", short: "Terminal" },
};

interface OpenOptions {
  shell?: ShellId;
  path?: string;
  admin?: boolean;
}

/** Ouvre un terminal, puis replie l'île (on va taper ailleurs). */
async function open(api: ModuleApi, options: OpenOptions = {}) {
  try {
    await api.invoke("open", options);
    api.closeIsland();
  } catch (err) {
    api.notify({ title: errorText(err), icon: "⚠️", priority: "normal", key: "terminal-error" });
  }
}

function dropTargets(api: ModuleApi): DropTarget[] {
  if (!api.settings().showDrop) return [];
  return [{ id: "terminal-here", label: "Terminal ici", icon: "🖥️", onDrop: (paths) => open(api, { path: paths[0] }) }];
}

export const terminal: IslandModule = {
  manifest: manifest as ModuleManifest,

  views: {
    expanded(root, api) {
      const box = el("div", { class: "term" });
      root.append(box);
      const folder = el("span", { class: "term-dir" }, "…");

      const draw = () => {
        const main = (api.settings().shell as ShellId) ?? "powershell";
        const others = (Object.keys(SHELLS) as ShellId[]).filter((id) => id !== main);
        box.replaceChildren(
          el(
            "div",
            { class: "term-main" },
            el(
              "button",
              { class: "term-big", title: `Ouvrir ${SHELLS[main].label}`, onclick: api.handler(() => open(api)) },
              el("span", { class: "term-prompt" }, main === "cmd" ? "C:\\>" : "PS>"),
              el("span", { class: "term-big-text" }, el("b", {}, SHELLS[main].label), el("small", { class: "muted" }, "Ouvrir")),
            ),
            el(
              "button",
              { class: "term-admin", title: "Ouvrir en administrateur (Windows demande de confirmer)", onclick: api.handler(() => open(api, { admin: true })) },
              "🛡️",
              el("small", {}, "Admin"),
            ),
          ),
          el(
            "div",
            { class: "btn-row term-others" },
            ...others.map((id) => el("button", { class: "btn small", title: `Ouvrir ${SHELLS[id].label}`, onclick: api.handler(() => open(api, { shell: id })) }, SHELLS[id].short)),
            el(
              "button",
              {
                class: "btn small",
                title: "Choisir un dossier, puis y ouvrir le terminal",
                onclick: api.handler(async () => {
                  const path = await Bridge.pickFolder("Ouvrir le terminal dans…");
                  if (path) await open(api, { path });
                }),
              },
              "📂 Ailleurs…",
            ),
          ),
          el("div", { class: "term-foot muted" }, "Dans : ", folder),
        );
      };

      // Le dossier de départ (réglage, sinon le dossier utilisateur).
      const loadDir = async () => {
        try {
          const r = await api.invoke<{ dir: string }>("start_dir");
          folder.textContent = r.dir;
          folder.title = r.dir;
        } catch (err) {
          folder.textContent = errorText(err);
        }
      };

      draw();
      void loadDir();
      if (!reducedMotion()) {
        box.animate([{ opacity: 0, transform: "translateY(6px) scale(0.99)" }, { opacity: 1, transform: "none" }], {
          duration: 320,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
      return api.onSettingsChange(() => {
        draw();
        void loadDir();
      });
    },

    drop: dropTargets,
  },
};
