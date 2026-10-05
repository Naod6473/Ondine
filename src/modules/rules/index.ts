// Module « Règles » : l'onglet de l'île.
//
// Ici : la liste des règles (avec un interrupteur chacune), « tout mettre en
// pause », et ce qui s'est passé récemment. Créer ou modifier une règle se
// fait dans la fenêtre de réglages (section « Règles »), qui a la place pour
// un vrai formulaire.
//
// Le Rust (src-tauri/src/modules/rules/) fait tout le travail ; il nous
// demande par le bus d'afficher une notification ou d'ouvrir l'île.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { reducedMotion } from "../../island/tab-pill";
import { summary, type Listing } from "./shared";

let listing: Listing = { rules: [], paused: false, history: [], errors: {}, topics: [] };
const redraws = new Set<() => void>();

async function refresh(api: ModuleApi) {
  try {
    listing = await api.invoke<Listing>("list");
  } catch {
    return; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
}

async function attempt(api: ModuleApi, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    api.notify({ title: errorText(err), icon: "⚠️", priority: "low", key: "rules-error" });
  }
}

/** Ouvre l'éditeur dans la fenêtre de réglages (id 0 = nouvelle règle). */
function edit(api: ModuleApi, id: number) {
  api.emit("rules.edit", { id });
  void Bridge.openSettingsWindow();
}

/** « 14:32 » aujourd'hui, sinon la date. */
function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("fr-FR");
}

export const rules: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("rules.changed", () => void refresh(api));
    // Demandes du Rust : notification, ou ouvrir l'île sur un onglet.
    api.on("rules.notify", (msg) => {
      const p = (msg.payload ?? {}) as { title?: string; body?: string };
      api.notify({ title: p.title || "Règle", body: p.body || undefined, icon: "⚡", priority: "normal", key: `rules-${p.title}` });
    });
    api.on("rules.open-island", (msg) => {
      const p = (msg.payload ?? {}) as { tab?: string };
      api.openIsland(p.tab || undefined);
    });
    void refresh(api);
  },

  views: {
    expanded(root, api) {
      const box = el("div", { class: "rules" });
      root.append(box);
      let first = true;

      const draw = () => {
        const { rules: list, paused, history, errors, topics } = listing;
        const pause = el("input", { type: "checkbox" }) as HTMLInputElement;
        pause.checked = paused;
        pause.addEventListener("change", api.handler(() => attempt(api, () => api.invoke("pause", { paused: pause.checked }))));

        const head = el(
          "div",
          { class: "btn-row rules-head" },
          el("button", { class: "btn small primary", onclick: api.handler(() => edit(api, 0)) }, "＋ Nouvelle règle"),
          el("label", { class: "rules-pause" }, pause, " Tout mettre en pause"),
        );

        const rows = el("div", { class: `rules-list${paused ? " paused" : ""}` });
        if (!list.length) {
          rows.append(
            el(
              "p",
              { class: "muted rules-empty" },
              "Aucune règle. Exemples : ranger les PDF téléchargés, Ctrl+Alt+V pour coller sans mise en forme, ouvrir une clé USB dès qu'elle est branchée.",
            ),
          );
        }
        for (const r of list) {
          const toggle = el("input", { type: "checkbox", title: r.enabled ? "Désactiver" : "Activer" }) as HTMLInputElement;
          toggle.checked = r.enabled;
          toggle.addEventListener("change", api.handler(() => attempt(api, () => api.invoke("toggle", { id: r.id, enabled: toggle.checked }))));
          const error = errors[String(r.id)];
          rows.append(
            el(
              "div",
              { class: `rule-row${r.enabled ? "" : " off"}` },
              el("label", { class: "switch-mini" }, toggle, el("i")),
              el(
                "button",
                { class: "rule-main", title: "Modifier", onclick: api.handler(() => edit(api, r.id)) },
                el("b", {}, r.name),
                el("span", { class: "muted" }, summary(r, topics)),
                error ? el("span", { class: "rule-error" }, `⚠️ ${error}`) : null,
              ),
            ),
          );
        }

        const recent = history.slice(0, 4);
        const log = recent.length
          ? el(
              "div",
              { class: "rules-history" },
              el("div", { class: "muted rules-history-title" }, "Récemment"),
              ...recent.map((h) =>
                el(
                  "div",
                  { class: `rules-history-row${h.ok ? "" : " bad"}` },
                  el("span", { class: "muted" }, when(h.at)),
                  el("span", {}, `${h.ok ? "✓" : "⚠️"} ${h.rule}${h.subject ? ` · ${h.subject}` : ""}`),
                  el("span", { class: "muted rules-history-msg" }, h.message),
                ),
              ),
            )
          : null;

        box.replaceChildren(head, rows, log ?? "");
        if (first && !reducedMotion()) {
          [...box.querySelectorAll<HTMLElement>(".rule-row")].slice(0, 8).forEach((n, i) =>
            n.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
              duration: 300,
              delay: i * 24,
              easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
              fill: "backwards",
            }),
          );
        }
        first = false;
      };

      draw();
      redraws.add(draw);
      return () => redraws.delete(draw);
    },
  },
};
