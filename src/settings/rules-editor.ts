// Section « Règles » de la fenêtre de réglages : la liste et l'éditeur.
//
// Une règle se construit en trois blocs, comme une phrase :
//   Quand… (le déclencheur)  ·  Si… (conditions)  ·  Alors… (les actions)
// Le brouillon est gardé ici (`draft`) : la page peut se redessiner (réglages
// modifiés ailleurs) sans perdre ce qu'on est en train de taper.
//
// Tout passe par les commandes du module Rust « rules » (list, save, delete,
// preview) : c'est lui qui valide vraiment (dossiers, raccourcis…).

import { Bridge } from "../core/bridge";
import type { Bus } from "../core/bus";
import { errorText } from "../core/log";
import { el } from "../island/dom";
import { ALL_MODULES } from "../modules";
import {
  ACTION_LABELS,
  allowedActions,
  CLIP_LABELS,
  countText,
  DAY_NAMES,
  EMOTIONS,
  EMPTY_CONDITIONS,
  givesFile,
  NET_LABELS,
  prettyKeys,
  summary,
  TEMPLATES,
  type Action,
  type ClipKind,
  type Gesture,
  type Listing,
  type NetChange,
  type Rule,
  type Trigger,
} from "../modules/rules/shared";

let listing: Listing = { rules: [], paused: false, history: [], errors: {}, topics: [] };
/** La règle en cours de modification (null = on montre la liste). */
let draft: Rule | null = null;
let message: { text: string; error: boolean } | null = null;
let previewLines: string[] = [];
let redraw: () => void = () => {};

const invoke = <T>(command: string, args: unknown = null) => Bridge.moduleInvoke<T>("rules", command, args);

async function reload() {
  try {
    listing = await invoke<Listing>("list");
  } catch (err) {
    message = { text: errorText(err), error: true };
  }
  redraw();
}

/** À appeler une fois au démarrage de la fenêtre de réglages. */
export function connectRules(bus: Bus, goToRules: () => void, rerender: () => void) {
  redraw = rerender;
  bus.on("rules.changed", () => void reload(), "settings");
  // L'onglet Règles de l'île demande à modifier (ou créer) une règle.
  bus.on(
    "rules.edit",
    (msg) => {
      const id = Number((msg.payload as { id?: number } | null)?.id ?? 0);
      void reload().then(() => {
        const found = listing.rules.find((r) => r.id === id);
        startEditing(found ? structuredClone(found) : newRule());
        goToRules();
      });
    },
    "settings",
  );
  void reload();
}

function newRule(): Rule {
  return { id: 0, name: "", enabled: true, trigger: { type: "file", folder: "", subfolders: false }, conditions: { ...EMPTY_CONDITIONS }, actions: [] };
}

function startEditing(rule: Rule) {
  draft = rule;
  message = null;
  previewLines = [];
  redraw();
}

// ── Petits éléments de formulaire ────────────────────────────────────────────

function textInput(value: string, placeholder: string, onInput: (v: string) => void, maxLength = 200) {
  const i = el("input", { type: "text", placeholder, maxlength: maxLength }) as HTMLInputElement;
  i.value = value;
  i.addEventListener("input", () => onInput(i.value));
  return i;
}

function numberInput(value: number | null, min: number, max: number, onInput: (v: number | null) => void) {
  const i = el("input", { type: "number", min, max }) as HTMLInputElement;
  i.value = value === null ? "" : String(value);
  i.addEventListener("input", () => onInput(i.value === "" ? null : Math.min(max, Math.max(min, Number(i.value)))));
  return i;
}

function selectInput(value: string, options: [string, string][], onChange: (v: string) => void) {
  const s = el("select", {}) as HTMLSelectElement;
  for (const [v, l] of options) s.append(el("option", { value: v }, l));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/** Un chemin de dossier + bouton « Choisir… ». */
function folderInput(value: string, onChange: (v: string) => void) {
  const shown = el("code", { class: "rule-path" }, value || "aucun dossier choisi");
  return el(
    "span",
    { class: "rule-folder" },
    shown,
    el(
      "button",
      {
        class: "btn",
        onclick: async () => {
          const p = await Bridge.pickFolder("Choisir un dossier");
          if (p) {
            onChange(p);
            redraw();
          }
        },
      },
      "Choisir…",
    ),
  );
}

/**
 * Enregistre un raccourci : on clique dans le champ et on appuie sur la
 * combinaison. On garde le nom « physique » de la touche (KeyV), que le Rust
 * sait lire quelle que soit la disposition du clavier.
 */
function hotkeyInput(value: string, onChange: (v: string) => void) {
  const i = el("input", { type: "text", class: "rule-hotkey", readonly: true, placeholder: "Cliquer ici puis appuyer sur le raccourci" }) as HTMLInputElement;
  i.value = value ? prettyKeys(value) : "";
  i.addEventListener("keydown", (e) => {
    e.preventDefault();
    if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) return; // on attend la vraie touche
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    parts.push(e.code);
    const keys = parts.join("+");
    i.value = prettyKeys(keys);
    onChange(keys);
  });
  return i;
}

/** Une heure « 12:30 » (champ heure du navigateur). */
function timeInput(value: string, onChange: (v: string) => void) {
  const i = el("input", { type: "time", step: 60 }) as HTMLInputElement;
  i.value = value;
  i.addEventListener("input", () => onChange(i.value));
  return i;
}

/** Sept cases à cocher, du lundi au dimanche (aucune = tous les jours). */
function daysInput(value: number[] | undefined, onChange: (v: number[]) => void) {
  const chosen = new Set(value ?? []);
  return el(
    "span",
    { class: "rule-days" },
    ...DAY_NAMES.map((name, d) => {
      const c = el("input", { type: "checkbox" }) as HTMLInputElement;
      c.checked = chosen.has(d);
      c.addEventListener("change", () => {
        if (c.checked) chosen.add(d);
        else chosen.delete(d);
        onChange([...chosen].sort());
      });
      return el("label", { class: "rule-day" }, c, ` ${name}`);
    }),
  );
}

function row(label: string, control: HTMLElement | string, help?: string) {
  return el("div", { class: "field rule-field" }, el("label", {}, label), control, help ? el("div", { class: "help" }, help) : null);
}

// ── La section ───────────────────────────────────────────────────────────────

export function rulesSection(main: HTMLElement) {
  // (le titre « Règles » est dessiné par la page, voir settings/main.ts)
  if (message) main.append(el("div", { class: `note${message.error ? " error" : ""}` }, message.text));
  if (draft) editor(main, draft);
  else list(main);
}

function list(main: HTMLElement) {
  main.append(
    el(
      "p",
      { class: "muted" },
      "« Quand… alors… » : l'île agit toute seule quand un fichier arrive, qu'une clé USB est branchée, que vous appuyez sur un raccourci, à une heure donnée, quand un agent IA a fini, qu'Internet coupe… Déplacer ou renommer propose toujours « Annuler », et rien n'est supprimé définitivement.",
    ),
    el("div", { class: "btn-row" }, el("button", { class: "btn primary", onclick: () => startEditing(newRule()) }, "＋ Nouvelle règle")),
  );

  for (const r of listing.rules) {
    const error = listing.errors[String(r.id)];
    main.append(
      el(
        "section",
        { class: `card rule-card${r.enabled ? "" : " off"}` },
        el(
          "div",
          { class: "card-head" },
          el("div", { class: "card-title" }, el("strong", {}, r.name), r.enabled ? null : el("span", { class: "muted" }, " (désactivée)")),
          el("button", { class: "btn", onclick: () => startEditing(structuredClone(r)) }, "Modifier"),
          el(
            "button",
            {
              class: "btn",
              onclick: async () => {
                try {
                  await invoke("delete", { id: r.id });
                  message = { text: `Règle « ${r.name} » supprimée (« Annuler » dans l'île pendant quelques secondes).`, error: false };
                } catch (err) {
                  message = { text: errorText(err), error: true };
                }
                await reload();
              },
            },
            "Supprimer",
          ),
        ),
        el("p", { class: "muted rule-summary" }, summary(r, listing.topics)),
        countText(listing.counts?.[String(r.id)]) ? el("p", { class: "muted rule-count" }, countText(listing.counts?.[String(r.id)])) : null,
        error ? el("div", { class: "note error" }, error) : null,
      ),
    );
  }

  main.append(el("h3", {}, "Modèles"), el("p", { class: "muted" }, "Un point de départ à adapter avant d'enregistrer."));
  main.append(
    el(
      "div",
      { class: "btn-row rule-templates" },
      ...TEMPLATES.map((t) => el("button", { class: "btn", onclick: () => startEditing({ id: 0, ...structuredClone(t.rule) }) }, t.title)),
    ),
  );
}

function editor(main: HTMLElement, r: Rule) {
  const t = r.trigger;

  // ── Quand ──
  const kind =
    t.type === "drive"
      ? t.removed
        ? "drive-out"
        : "drive-in"
      : t.type === "agent"
        ? t.waiting
          ? "agent-waiting"
          : "agent-done"
        : t.type === "power"
          ? t.plugged === false
            ? "power-out"
            : "power-in"
          : t.type;
  const setTrigger = (k: string) => {
    const next: Record<string, Trigger> = {
      file: { type: "file", folder: "", subfolders: false },
      "drive-in": { type: "drive", removed: false },
      "drive-out": { type: "drive", removed: true },
      hotkey: { type: "hotkey", keys: "" },
      event: { type: "event", topic: listing.topics[0]?.topic ?? "timer.done" },
      "agent-done": { type: "agent", waiting: false },
      "agent-waiting": { type: "agent", waiting: true },
      schedule: { type: "schedule", time: "12:00", days: [], folder: "" },
      network: { type: "network", change: "internetDown" },
      battery: { type: "battery", below: 20 },
      "power-in": { type: "power", plugged: true },
      "power-out": { type: "power", plugged: false },
      unlock: { type: "unlock" },
      clipboard: { type: "clipboard", kind: "link", text: "" },
      music: { type: "music" },
    };
    r.trigger = next[k];
    // Les conditions dépendent du déclencheur : on repart de zéro.
    r.conditions = { ...EMPTY_CONDITIONS };
    // Les actions qui n'ont plus de sens avec ce déclencheur disparaissent.
    const allowed = allowedActions(r.trigger);
    r.actions = r.actions.filter((a) => allowed.includes(a.type));
    redraw();
  };
  const when = el("section", { class: "card rule-block" }, el("h3", {}, "Quand…"));
  when.append(
    row(
      "Déclencheur",
      selectInput(
        kind,
        [
          ["file", "Un fichier arrive dans un dossier"],
          ["drive-in", "Une clé USB ou un disque est branché"],
          ["drive-out", "Un lecteur est débranché"],
          ["hotkey", "J'appuie sur un raccourci clavier"],
          ["schedule", "À une heure donnée"],
          ["agent-done", "Un agent IA a fini"],
          ["agent-waiting", "Un agent IA m'attend"],
          ["network", "Le réseau change (Internet, VPN)"],
          ["battery", "La batterie passe sous un seuil"],
          ["power-in", "Le PC est branché sur secteur"],
          ["power-out", "Le PC est débranché du secteur"],
          ["unlock", "Je reviens devant le PC (session déverrouillée)"],
          ["clipboard", "Je copie un lien, une adresse e-mail, un code…"],
          ["music", "Une musique démarre"],
          ["event", "Un événement de l'île"],
        ],
        setTrigger,
      ),
    ),
  );
  if (t.type === "file") {
    when.append(
      row("Dossier surveillé", folderInput(t.folder, (v) => (t.folder = v))),
      row("Inclure les sous-dossiers", checkboxInput(Boolean(t.subfolders), (v) => (t.subfolders = v))),
    );
  } else if (t.type === "hotkey") {
    when.append(row("Raccourci", hotkeyInput(t.keys, (v) => (t.keys = v)), "Avec Ctrl, Alt ou Windows. Exemple : Ctrl+Alt+V."));
  } else if (t.type === "event") {
    when.append(row("Événement", selectInput(t.topic, listing.topics.map((x) => [x.topic, x.label]), (v) => (t.topic = v))));
  } else if (t.type === "schedule") {
    when.append(
      row("Heure", timeInput(t.time, (v) => (t.time = v))),
      row("Jours", daysInput(t.days, (v) => (t.days = v)), "Aucun jour coché = tous les jours."),
      row(
        "Agir sur les fichiers d'un dossier (facultatif)",
        el(
          "span",
          { class: "rule-folder" },
          folderInput(t.folder ?? "", (v) => {
            t.folder = v;
          }),
          t.folder
            ? el(
                "button",
                {
                  class: "btn",
                  onclick: () => {
                    t.folder = "";
                    r.conditions.olderThanDays = null;
                    const allowed = allowedActions(r.trigger);
                    r.actions = r.actions.filter((a) => allowed.includes(a.type));
                    redraw();
                  },
                },
                "Retirer",
              )
            : null,
        ),
        "Avec un dossier, la règle agit sur chaque fichier qui remplit les conditions (par exemple « plus vieux que 30 jours »).",
      ),
    );
  } else if (t.type === "network") {
    when.append(
      row(
        "Changement",
        selectInput(t.change, Object.entries(NET_LABELS) as [string, string][], (v) => (t.change = v as NetChange)),
        "Ondine demande à Windows, rien n'est envoyé sur Internet.",
      ),
    );
  } else if (t.type === "battery") {
    when.append(row("Seuil (%)", numberInput(t.below, 5, 95, (v) => (t.below = v ?? 20)), "Seulement quand le PC est sur batterie."));
  } else if (t.type === "clipboard") {
    when.append(
      row(
        "Le presse-papiers contient",
        selectInput(t.kind, Object.entries(CLIP_LABELS) as [string, string][], (v) => {
          t.kind = v as ClipKind;
          redraw();
        }),
        "{nom} = ce qui a été trouvé (le lien, l'adresse, le code). Rien n'est gardé ni envoyé, et les copies d'un gestionnaire de mots de passe sont ignorées.",
      ),
    );
    if (t.kind === "text") when.append(row("Texte cherché", textInput(t.text ?? "", "facture", (v) => (t.text = v), 60)));
  }

  // ── Si ──
  const cond = el("section", { class: "card rule-block" }, el("h3", {}, "Si… (facultatif)"));
  const c = r.conditions;
  if (t.type === "file") {
    cond.append(
      row(
        "Extensions",
        textInput(c.extensions.join(", "), "pdf, docx (vide = toutes)", (v) => {
          c.extensions = v.split(/[\s,;]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);
        }, 120),
      ),
      row("Le nom contient", textInput(c.nameContains, "facture (vide = peu importe)", (v) => (c.nameContains = v), 60)),
      row("Taille minimale (Ko)", numberInput(c.minKb, 0, 100_000_000, (v) => (c.minKb = v))),
      row("Taille maximale (Ko)", numberInput(c.maxKb, 0, 100_000_000, (v) => (c.maxKb = v))),
    );
  } else if (t.type === "schedule" && givesFile(t)) {
    cond.append(
      row("Plus vieux que (jours)", numberInput(c.olderThanDays ?? null, 1, 3650, (v) => (c.olderThanDays = v)), "Pas modifié depuis ce nombre de jours."),
      row(
        "Extensions",
        textInput(c.extensions.join(", "), "zip, exe (vide = toutes)", (v) => {
          c.extensions = v.split(/[\s,;]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);
        }, 120),
      ),
      row("Le nom contient", textInput(c.nameContains, "facture (vide = peu importe)", (v) => (c.nameContains = v), 60)),
    );
  } else if (t.type === "drive") {
    cond.append(row("Le nom du lecteur contient", textInput(c.nameContains, "KINGSTON (vide = n'importe lequel)", (v) => (c.nameContains = v), 60)));
  }
  // Pour toutes les règles : seulement certains jours, certaines heures.
  if (t.type !== "schedule") cond.append(row("Seulement ces jours", daysInput(c.days, (v) => (c.days = v)), "Aucun jour coché = tous les jours."));
  const clearHours = el(
    "button",
    {
      class: "btn",
      onclick: () => {
        c.from = "";
        c.to = "";
        redraw();
      },
    },
    "Toute la journée",
  );
  if (t.type !== "schedule") {
    cond.append(
      row(
        "Seulement entre",
        el("span", { class: "rule-hours" }, timeInput(c.from ?? "", (v) => (c.from = v)), " et ", timeInput(c.to ?? "", (v) => (c.to = v)), c.from || c.to ? clearHours : null),
        "Exemple : de 09:00 à 18:00. De 22:00 à 06:00 passe minuit.",
      ),
    );
  }

  // ── Alors ──
  const then = el("section", { class: "card rule-block" }, el("h3", {}, "Alors…"));
  const allowed = allowedActions(t);
  r.actions.forEach((a, i) => then.append(actionRow(r, a, i)));
  const add = selectInput("", [["", "＋ Ajouter une action…"], ...allowed.map((x): [string, string] => [x, ACTION_LABELS[x]])], (v) => {
    if (!v) return;
    r.actions.push(defaultAction(v as Action["type"]));
    redraw();
  });
  then.append(el("div", { class: "rule-add" }, add));

  // ── Tester / enregistrer ──
  const name = textInput(r.name, "Nom de la règle", (v) => (r.name = v), 60);
  const test = el(
    "button",
    {
      class: "btn",
      title: "Montre ce que ferait la règle, sans rien faire",
      onclick: async () => {
        try {
          let path: string | null = null;
          if (givesFile(r.trigger)) {
            path = await Bridge.pickFile("Choisir un fichier pour tester la règle", []);
            if (!path) return;
          }
          const res = await invoke<{ steps: string[] }>("preview", { rule: r, path });
          previewLines = res.steps;
          message = null;
        } catch (err) {
          previewLines = [];
          message = { text: errorText(err), error: true };
        }
        redraw();
      },
    },
    "🧪 Tester (sans rien faire)",
  );
  const saveButton = el(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        try {
          await invoke("save", { rule: r });
          message = { text: `Règle « ${r.name} » enregistrée.`, error: false };
          draft = null;
          previewLines = [];
        } catch (err) {
          message = { text: errorText(err), error: true };
        }
        await reload();
      },
    },
    "Enregistrer",
  );
  const cancel = el("button", { class: "btn", onclick: () => ((draft = null), (message = null), redraw()) }, "Annuler");

  main.append(
    row("Nom", name),
    when,
    cond,
    then,
    previewLines.length ? el("div", { class: "note rule-preview" }, el("b", {}, "Ce que ferait la règle :"), el("ol", {}, ...previewLines.map((l) => el("li", {}, l)))) : "",
    el("div", { class: "btn-row" }, saveButton, test, cancel),
  );
}

function checkboxInput(value: boolean, onChange: (v: boolean) => void) {
  const c = el("input", { type: "checkbox" }) as HTMLInputElement;
  c.checked = value;
  c.addEventListener("change", () => onChange(c.checked));
  return c;
}

function defaultAction(type: Action["type"]): Action {
  switch (type) {
    case "move":
    case "copy":
      return { type, to: "" };
    case "rename":
      return { type, pattern: "{date} {nom}" };
    case "notify":
      return { type, text: "{nom}" };
    case "openIsland":
      return { type, tab: "" };
    case "timer":
      return { type, minutes: 5 };
    case "addNote":
      return { type, text: "{nom}", todo: false };
    case "unzip":
      return { type, to: "", shelf: true };
    case "copyPath":
      return { type, nameOnly: false };
    case "mascot":
      return { type, gesture: "dance", emotion: "happy", text: "" };
    case "quiet":
      return { type, minutes: 30 };
    default:
      return { type } as Action;
  }
}

/** Une action : son nom, son réglage éventuel, et ↑ ↓ ✕. */
function actionRow(r: Rule, a: Action, i: number) {
  const move = (delta: number) => {
    const [x] = r.actions.splice(i, 1);
    r.actions.splice(i + delta, 0, x);
    redraw();
  };
  let param: HTMLElement | null = null;
  if (a.type === "move" || a.type === "copy") param = folderInput(a.to, (v) => (a.to = v));
  else if (a.type === "rename") param = textInput(a.pattern, "{date} {nom}", (v) => (a.pattern = v), 120);
  else if (a.type === "notify") param = textInput(a.text, "{nom} est arrivé", (v) => (a.text = v), 200);
  else if (a.type === "timer") param = numberInput(a.minutes, 1, 180, (v) => (a.minutes = v ?? 5));
  else if (a.type === "quiet") param = numberInput(a.minutes, 1, 240, (v) => (a.minutes = v ?? 30));
  else if (a.type === "addNote") {
    param = el(
      "span",
      { class: "rule-param" },
      textInput(a.text, "{nom} a fini", (v) => (a.text = v), 200),
      el("label", {}, checkboxInput(Boolean(a.todo), (v) => (a.todo = v)), " Comme to-do"),
    );
  } else if (a.type === "unzip") {
    param = el(
      "span",
      { class: "rule-param" },
      folderInput(a.to, (v) => (a.to = v)),
      el("label", {}, checkboxInput(Boolean(a.shelf), (v) => (a.shelf = v)), " Puis le poser sur l'étagère"),
    );
  } else if (a.type === "copyPath") {
    param = selectInput(
      a.nameOnly ? "name" : "path",
      [
        ["path", "Le chemin complet"],
        ["name", "Seulement le nom"],
      ],
      (v) => (a.nameOnly = v === "name"),
    );
  } else if (a.type === "mascot") {
    const gesture = selectInput(
      a.gesture,
      [
        ["dance", "Danser"],
        ["emote", "Une expression"],
        ["sign", "Une pancarte avec un texte"],
      ],
      (v) => {
        a.gesture = v as Gesture;
        redraw();
      },
    );
    const extra =
      a.gesture === "emote"
        ? selectInput(a.emotion || "happy", EMOTIONS, (v) => (a.emotion = v))
        : a.gesture === "sign"
          ? textInput(a.text ?? "", "Pause !", (v) => (a.text = v), 40)
          : null;
    if (a.gesture === "emote" && !a.emotion) a.emotion = "happy";
    param = el("span", { class: "rule-param" }, gesture, extra);
  }
  else if (a.type === "openIsland") {
    const tabs = ALL_MODULES.filter((m) => m.views?.expanded).map((m): [string, string] => [m.manifest.id, `${m.manifest.icon} ${m.manifest.name}`]);
    param = selectInput(a.tab, [["", "Le dernier onglet ouvert"], ...tabs], (v) => (a.tab = v));
  }
  const help =
    a.type === "rename"
      ? "{nom} = nom d'origine, {date} = 2026-10-05, {heure} = 14h30. L'extension est gardée."
      : a.type === "notify" || a.type === "addNote"
        ? "{nom} = le nom du fichier, du lecteur ou de l'agent ; {date} et {heure} aussi."
        : a.type === "unzip"
          ? "Dans un nouveau dossier au nom de l'archive : rien n'est écrasé, « Annuler » le met à la Corbeille."
          : a.type === "quiet"
            ? "L'île garde ses notifications pour plus tard et la mascotte se calme. Les alertes importantes passent quand même."
            : null;
  return el(
    "div",
    { class: "rule-action" },
    el("span", { class: "rule-action-n" }, String(i + 1)),
    el("div", { class: "rule-action-body" }, el("b", {}, ACTION_LABELS[a.type]), param, help ? el("div", { class: "help" }, help) : null),
    el("button", { class: "btn", title: "Monter", disabled: i === 0, onclick: () => move(-1) }, "↑"),
    el("button", { class: "btn", title: "Descendre", disabled: i === r.actions.length - 1, onclick: () => move(1) }, "↓"),
    el("button", { class: "btn", title: "Retirer", onclick: () => (r.actions.splice(i, 1), redraw()) }, "✕"),
  );
}
