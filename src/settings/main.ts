// La fenêtre de réglages. Tout y est généré : les réglages des modules à partir
// de leurs manifestes, la liste des mascottes à partir du dossier mascots/.
//
// Chaque changement est appliqué tout de suite et enregistré par le Rust, qui
// prévient l'île (événement "settings-changed").

import { Bridge, IS_TAURI, windowLabel } from "../core/bridge";
import { Bus } from "../core/bus";
import { errorText } from "../core/log";
import { settingsStore } from "../core/settings-store";
import { applyTabOrder, mergeOrder } from "../core/tab-order";
import type { Settings } from "../core/types";
import { clear, el } from "../island/dom";
import { mascotCatalog } from "../mascot/catalog";
import { createRenderer, type MascotRenderer } from "../mascot/renderer";
import { ALL_MODULES } from "../modules";
import { settingsForm } from "./form";

const PERMISSION_LABELS: Record<string, string> = {
  files: "Accès aux fichiers",
  clipboard: "Presse-papiers",
  network: "Réseau",
  "claude-api": "Envoie du contenu à l'API Claude",
  credentials: "Lit des identifiants",
};

const SECTIONS = [
  { id: "general", label: "Général" },
  { id: "modules", label: "Modules" },
  { id: "mascot", label: "Mascotte" },
  { id: "privacy", label: "Confidentialité" },
  { id: "credentials", label: "Identifiants" },
  { id: "backup", label: "Sauvegarde" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

let bus: Bus;
let section: SectionId = "general";
let preview: MascotRenderer | null = null;
const app = document.getElementById("app")!;

async function start() {
  const boot = await Bridge.boot();
  await settingsStore.connect(boot?.settings ?? null);
  bus = new Bus(windowLabel("settings"));
  await bus.connect();
  // Si les réglages changent ailleurs (import…), on redessine.
  settingsStore.onChange(() => {
    // Ne pas redessiner pendant qu'on tape dans un champ.
    if (!(document.activeElement instanceof HTMLInputElement)) render();
  });
  render();
  if (boot) document.title = `Réglages — Island ${boot.version}`;
}

function save(change: (s: Settings) => void) {
  void settingsStore.update(change);
}

function render() {
  preview?.destroy();
  preview = null;
  clear(app);
  const nav = el("nav", { class: "nav" });
  for (const s of SECTIONS) {
    nav.append(
      el(
        "button",
        {
          class: s.id === section ? "active" : "",
          onclick: () => {
            section = s.id;
            render();
          },
        },
        s.label,
      ),
    );
  }
  const main = el("main", {});
  if (!IS_TAURI) main.append(el("p", { class: "note" }, "Aperçu dans un navigateur : rien n'est enregistré."));
  ({ general, modules, mascot, privacy, credentials, backup })[section](main);
  app.append(nav, main);
}

function row(label: string, control: HTMLElement, help?: string) {
  return el("div", { class: "field" }, el("label", {}, label), control, help ? el("div", { class: "help" }, help) : null);
}

function select(value: string, options: [string, string][], onChange: (v: string) => void) {
  const s = el("select", {}) as HTMLSelectElement;
  for (const [v, l] of options) s.append(el("option", { value: v }, l));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function number(value: number, min: number, max: number, onChange: (v: number) => void, step = 1) {
  const i = el("input", { type: "number", min, max, step }) as HTMLInputElement;
  i.value = String(value);
  i.addEventListener("change", () => {
    const v = Math.min(max, Math.max(min, Number(i.value) || min));
    i.value = String(v);
    onChange(v);
  });
  return i;
}

function checkbox(value: boolean, onChange: (v: boolean) => void) {
  const c = el("input", { type: "checkbox" }) as HTMLInputElement;
  c.checked = value;
  c.addEventListener("change", () => onChange(c.checked));
  return c;
}

// ── Sections ──────────────────────────────────────────────────────────────────

function general(main: HTMLElement) {
  const s = settingsStore.current;
  main.append(
    el("h2", {}, "Général"),
    row(
      "Écran de l'île",
      select(s.general.screen, [["primary", "Écran principal"], ["cursor", "Écran de la souris"]], (v) =>
        save((d) => (d.general.screen = v as Settings["general"]["screen"])),
      ),
    ),
    row(
      "Replier l'île quand la souris n'est plus dessus, après (s)",
      number(s.island.collapseSecs, 0.5, 30, (v) => save((d) => (d.island.collapseSecs = v)), 0.5),
    ),
    row("Durée des notifications (s)", number(s.island.notificationSecs, 2, 60, (v) => save((d) => (d.island.notificationSecs = v)))),
    row(
      "Niveau du journal",
      select(s.general.logLevel, [["error", "Erreurs"], ["warn", "Avertissements"], ["info", "Informations"], ["debug", "Débogage"]], (v) =>
        save((d) => (d.general.logLevel = v as Settings["general"]["logLevel"])),
      ),
      "Le journal reste sur ton PC, dans %LOCALAPPDATA%\\Island\\logs. Il ne contient jamais de clé ni de contenu de fichier.",
    ),
    el("div", { class: "btn-row" }, el("button", { class: "btn", onclick: () => void Bridge.openLogsFolder() }, "Ouvrir le dossier du journal")),
  );
}

/**
 * L'ordre des onglets : glisser une ligne (ou ses flèches ↑ ↓). On peut aussi
 * glisser les onglets directement dans l'île.
 */
function tabOrder(main: HTMLElement) {
  const withTab = ALL_MODULES.filter((m) => m.views?.expanded).map((m) => m.manifest);
  const ordered = applyTabOrder(withTab, (m) => m.id, settingsStore.current.island.tabOrder ?? []);
  const list = el("ol", { class: "order-list" });
  const saveOrder = (ids: string[]) => {
    const all = applyTabOrder(ALL_MODULES.map((m) => m.manifest.id), (id) => id, settingsStore.current.island.tabOrder ?? []);
    save((d) => (d.island.tabOrder = mergeOrder(ids, all)));
  };
  const idsShown = () => [...list.children].map((li) => (li as HTMLElement).dataset.id!);
  let dragged: HTMLElement | null = null;

  ordered.forEach((man, i) => {
    const move = (delta: number) => {
      const ids = ordered.map((m) => m.id);
      const [id] = ids.splice(i, 1);
      ids.splice(i + delta, 0, id);
      saveOrder(ids);
    };
    const li = el(
      "li",
      { class: `order-item${settingsStore.moduleEnabled(man.id) ? "" : " off"}`, draggable: "true", "data-id": man.id },
      el("span", { class: "order-grip", title: "Glisser pour déplacer" }, "⠿"),
      el("span", { class: "card-icon" }, man.icon),
      el("span", { class: "order-name" }, man.name, settingsStore.moduleEnabled(man.id) ? null : el("span", { class: "muted" }, " (désactivé)")),
      el("button", { class: "btn small", title: "Monter", disabled: i === 0, onclick: () => move(-1) }, "↑"),
      el("button", { class: "btn small", title: "Descendre", disabled: i === ordered.length - 1, onclick: () => move(1) }, "↓"),
    );
    li.addEventListener("dragstart", (e) => {
      dragged = li;
      li.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", man.id);
    });
    li.addEventListener("dragover", (e) => {
      if (!dragged || dragged === li) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      list.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? li : li.nextSibling);
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      dragged = null;
      const ids = idsShown();
      if (ids.join(",") !== ordered.map((m) => m.id).join(",")) saveOrder(ids);
    });
    list.append(li);
  });

  main.append(
    el("h3", {}, "Ordre des onglets"),
    el("p", { class: "muted" }, "Glisse une ligne, ou utilise ↑ ↓. Tu peux aussi faire glisser les onglets directement dans l'île."),
    list,
    el("div", { class: "btn-row" }, el("button", { class: "btn", onclick: () => save((d) => (d.island.tabOrder = [])) }, "Ordre d'origine")),
  );
}

function modules(main: HTMLElement) {
  main.append(el("h2", {}, "Modules"));
  tabOrder(main);
  main.append(el("h3", {}, "Réglages des modules"));
  for (const m of applyTabOrder(ALL_MODULES, (x) => x.manifest.id, settingsStore.current.island.tabOrder ?? [])) {
    const man = m.manifest;
    const enabled = settingsStore.moduleEnabled(man.id);
    const card = el("section", { class: "card" });
    card.append(
      el(
        "div",
        { class: "card-head" },
        el("span", { class: "card-icon" }, man.icon),
        el("div", { class: "card-title" }, el("strong", {}, man.name), el("span", { class: "muted" }, ` v${man.version}`)),
        el(
          "label",
          { class: "switch" },
          checkbox(enabled, (v) =>
            save((d) => {
              d.modules[man.id] = { enabled: v, values: d.modules[man.id]?.values ?? {} };
            }),
          ),
          enabled ? " Activé" : " Désactivé",
        ),
      ),
      el("p", { class: "muted" }, man.description),
      el(
        "p",
        { class: "perms" },
        "Permissions : ",
        man.permissions.length ? man.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(", ") : "aucune",
      ),
    );
    if (man.settings?.fields.length) {
      card.append(
        settingsForm(man.settings.fields, settingsStore.moduleValues(man), (key, value) =>
          save((d) => {
            const entry = (d.modules[man.id] ??= { enabled: true, values: {} });
            entry.values[key] = value;
          }),
        ),
      );
    }
    main.append(card);
  }
}

function mascot(main: HTMLElement) {
  const s = settingsStore.current;
  const catalog = mascotCatalog();
  const current = catalog.find((e) => e.manifest.id === s.mascot.id) ?? catalog[0];
  main.append(
    el("h2", {}, "Mascotte"),
    row("Afficher la mascotte", checkbox(s.mascot.enabled, (v) => save((d) => (d.mascot.enabled = v)))),
    row(
      "Mascotte",
      select(
        current?.manifest.id ?? "",
        catalog.map((e) => [e.manifest.id, e.problems.length ? `${e.manifest.name} (manifeste invalide)` : e.manifest.name]),
        (v) => save((d) => (d.mascot.id = v)),
      ),
      "Dépose tes mascottes dans le dossier mascots/ du projet (un dossier + manifest.json), puis relance l'appli.",
    ),
    row("S'ennuie après (s)", number(s.mascot.boredAfterSecs, 10, 3600, (v) => save((d) => (d.mascot.boredAfterSecs = v)))),
    row("S'endort après (s)", number(s.mascot.sleepAfterSecs, 20, 7200, (v) => save((d) => (d.mascot.sleepAfterSecs = v)))),
  );
  if (!current) return;
  if (current.problems.length) {
    main.append(el("div", { class: "note error" }, "Problèmes dans le manifeste : ", current.problems.join(" ; ")));
  }

  // Aperçu : un renderer à part, et chaque bouton joue aussi l'animation sur l'île.
  const stage = el("div", { class: "mascot-stage" });
  const buttons = el("div", { class: "btn-row" });
  main.append(el("h3", {}, "Tester les animations"), stage, buttons);
  preview = createRenderer(current.manifest, current.assets);
  preview.mount(stage);
  const idle = current.manifest.animations.find((a) => a.name === current.manifest.fallback);
  if (idle) preview.play(idle);
  preview.onAnimationEnd(() => idle && preview?.play(idle));
  stage.addEventListener("mousemove", (e) => {
    const r = stage.getBoundingClientRect();
    preview?.lookAt(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  });
  stage.addEventListener("mouseleave", () => preview?.lookAt(null, null));
  for (const a of current.manifest.animations) {
    buttons.append(
      el(
        "button",
        {
          class: "btn",
          title: `${a.durationMs} ms, ${a.loop ? "en boucle" : "une fois"}, priorité ${a.priority}`,
          onclick: () => {
            preview?.play(a);
            bus.emit("mascot.play", { animation: a.name }, "settings");
          },
        },
        a.name,
      ),
    );
  }
}

function privacy(main: HTMLElement) {
  const s = settingsStore.current;
  const list = el("ul", { class: "folders" });
  for (const folder of s.privacy.excludedFolders) {
    list.append(
      el(
        "li",
        {},
        el("code", {}, folder),
        el(
          "button",
          { class: "icon-btn", title: "Retirer", onclick: () => save((d) => (d.privacy.excludedFolders = d.privacy.excludedFolders.filter((f) => f !== folder))) },
          "×",
        ),
      ),
    );
  }
  if (!s.privacy.excludedFolders.length) list.append(el("li", { class: "muted" }, "Aucun dossier exclu."));
  const input = el("input", { type: "text", placeholder: "C:\\Users\\moi\\Documents\\Privé" }) as HTMLInputElement;
  const msg = el("div", { class: "help" });
  const add = el("button", {
    class: "btn",
    onclick: async () => {
      try {
        const folder = await Bridge.privacyCheckFolder(input.value);
        save((d) => {
          if (!d.privacy.excludedFolders.includes(folder)) d.privacy.excludedFolders.push(folder);
        });
      } catch (err) {
        msg.textContent = errorText(err);
      }
    },
  }, "Exclure ce dossier");
  main.append(
    el("h2", {}, "Confidentialité"),
    el(
      "p",
      {},
      "Island n'envoie aucune télémétrie. Un module qui envoie du contenu à l'API Claude le déclare (voir ses permissions) et te montre ce qui part avant l'envoi.",
    ),
    el("h3", {}, "Dossiers exclus"),
    el("p", { class: "muted" }, "Aucun module ne lira ni n'enverra un fichier situé dans ces dossiers."),
    list,
    el("div", { class: "inline" }, input, add),
    msg,
  );
}

function credentials(main: HTMLElement) {
  main.append(
    el("h2", {}, "Identifiants"),
    el(
      "p",
      { class: "muted" },
      "Les clés sont rangées dans le Gestionnaire d'identifiants Windows. L'île peut seulement savoir si une clé existe : elle ne peut jamais la réafficher.",
    ),
  );
  const keys = [{ key: "anthropic-api-key", label: "Clé API Anthropic" }];
  for (const k of keys) {
    const status = el("span", { class: "status" }, "…");
    const input = el("input", { type: "password", placeholder: "Coller la clé ici", autocomplete: "off" }) as HTMLInputElement;
    const msg = el("div", { class: "help" });
    const refresh = async () => {
      const present = await Bridge.credentialExists(k.key);
      status.textContent = present ? "✓ enregistrée" : "aucune";
      status.className = `status ${present ? "ok" : ""}`;
    };
    main.append(
      el(
        "section",
        { class: "card" },
        el("div", { class: "card-head" }, el("strong", {}, k.label), status),
        el(
          "div",
          { class: "inline" },
          input,
          el(
            "button",
            {
              class: "btn",
              onclick: async () => {
                try {
                  await Bridge.credentialSet(k.key, input.value);
                  input.value = "";
                  msg.textContent = "Enregistrée.";
                } catch (err) {
                  msg.textContent = errorText(err);
                }
                void refresh();
              },
            },
            "Enregistrer",
          ),
          el(
            "button",
            {
              class: "btn",
              onclick: async () => {
                try {
                  await Bridge.credentialDelete(k.key);
                  msg.textContent = "Supprimée.";
                } catch (err) {
                  msg.textContent = errorText(err);
                }
                void refresh();
              },
            },
            "Supprimer",
          ),
        ),
        msg,
      ),
    );
    void refresh();
  }
}

function backup(main: HTMLElement) {
  const msg = el("div", { class: "help" });
  const file = el("input", { type: "file", accept: ".json,application/json" }) as HTMLInputElement;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await Bridge.settingsImport(await f.text());
      msg.textContent = "Réglages importés.";
    } catch (err) {
      msg.textContent = `Import refusé : ${errorText(err)}`;
    }
    file.value = "";
  });
  main.append(
    el("h2", {}, "Sauvegarde"),
    el("p", { class: "muted" }, "Les clés ne font jamais partie de l'export : elles restent dans le Gestionnaire d'identifiants."),
    el(
      "div",
      { class: "btn-row" },
      el(
        "button",
        {
          class: "btn",
          onclick: async () => {
            try {
              msg.textContent = `Exporté dans ${await Bridge.settingsExport()}`;
            } catch (err) {
              msg.textContent = errorText(err);
            }
          },
        },
        "Exporter les réglages",
      ),
    ),
    row("Importer un fichier de réglages", file),
    msg,
  );
}

void start();
