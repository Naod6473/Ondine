// Ce que l'onglet Règles (île) et l'éditeur (fenêtre de réglages) partagent :
// la forme d'une règle (miroir de src-tauri/src/modules/rules/model.rs), la
// phrase qui la résume, et les modèles prêts à l'emploi.

export type Trigger =
  | { type: "file"; folder: string; subfolders?: boolean }
  | { type: "drive"; removed?: boolean }
  | { type: "hotkey"; keys: string }
  | { type: "event"; topic: string };

export type Action =
  | { type: "move"; to: string }
  | { type: "copy"; to: string }
  | { type: "rename"; pattern: string }
  | { type: "trash" }
  | { type: "shelf" }
  | { type: "reveal" }
  | { type: "terminal" }
  | { type: "notify"; text: string }
  | { type: "openIsland"; tab: string }
  | { type: "timer"; minutes: number }
  | { type: "pastePlain" };

export interface Conditions {
  extensions: string[];
  nameContains: string;
  minKb: number | null;
  maxKb: number | null;
}

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Conditions;
  actions: Action[];
}

export interface HistoryEntry {
  at: number;
  rule: string;
  subject: string;
  ok: boolean;
  message: string;
}

export interface Listing {
  rules: Rule[];
  paused: boolean;
  history: HistoryEntry[];
  /** Problème actuel d'une règle, par id. */
  errors: Record<string, string>;
  topics: { topic: string; label: string }[];
}

export const EMPTY_CONDITIONS: Conditions = { extensions: [], nameContains: "", minKb: null, maxKb: null };

/** Le nom d'un dossier à partir de son chemin (« C:\Users\…\Downloads » → « Downloads »). */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/** « Ctrl+Alt+KeyV » → « Ctrl+Alt+V » ; « Super » → « Win ». */
export function prettyKeys(keys: string): string {
  return keys
    .split("+")
    .map((k) => k.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "").replace(/^Super$/i, "Win"))
    .join("+");
}

export const ACTION_LABELS: Record<Action["type"], string> = {
  move: "Déplacer dans un dossier",
  copy: "Copier dans un dossier",
  rename: "Renommer",
  trash: "Mettre à la Corbeille",
  shelf: "Poser sur l'étagère",
  reveal: "Montrer dans l'Explorateur",
  terminal: "Ouvrir un terminal",
  notify: "Afficher une notification",
  openIsland: "Ouvrir l'île",
  timer: "Lancer un minuteur",
  pastePlain: "Coller sans mise en forme",
};

/** Les actions possibles selon le déclencheur (miroir de la validation Rust). */
export function allowedActions(t: Trigger): Action["type"][] {
  const always: Action["type"][] = ["notify", "openIsland", "timer", "terminal", "pastePlain"];
  if (t.type === "file") return ["move", "copy", "rename", "trash", "shelf", "reveal", ...always];
  if (t.type === "drive" && !t.removed) return ["reveal", "shelf", ...always];
  return always;
}

export function triggerText(t: Trigger, topics: Listing["topics"] = []): string {
  switch (t.type) {
    case "file":
      return `Quand un fichier arrive dans ${t.folder ? folderName(t.folder) : "…"}${t.subfolders ? " (et ses sous-dossiers)" : ""}`;
    case "drive":
      return t.removed ? "Quand un lecteur est débranché" : "Quand une clé USB ou un disque est branché";
    case "hotkey":
      return `Quand j'appuie sur ${prettyKeys(t.keys)}`;
    case "event":
      return `Quand ${topics.find((x) => x.topic === t.topic)?.label ?? t.topic}`;
  }
}

export function conditionsText(c: Conditions, t: Trigger): string {
  const parts: string[] = [];
  if (t.type === "file" && c.extensions.length) parts.push(c.extensions.map((e) => `.${e}`).join(", "));
  if (c.nameContains.trim()) parts.push(`nom avec « ${c.nameContains.trim()} »`);
  if (t.type === "file" && c.minKb) parts.push(`≥ ${c.minKb} Ko`);
  if (t.type === "file" && c.maxKb) parts.push(`≤ ${c.maxKb} Ko`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function actionText(a: Action): string {
  switch (a.type) {
    case "move":
      return `déplacer dans ${folderName(a.to)}`;
    case "copy":
      return `copier dans ${folderName(a.to)}`;
    case "rename":
      return `renommer en « ${a.pattern} »`;
    case "notify":
      return `notifier « ${a.text} »`;
    case "openIsland":
      return a.tab ? `ouvrir l'onglet ${a.tab}` : "ouvrir l'île";
    case "timer":
      return `minuteur ${a.minutes} min`;
    default:
      return ACTION_LABELS[a.type].toLowerCase();
  }
}

/** « Quand un fichier arrive dans Downloads (.pdf) → déplacer dans PDF, notifier… » */
export function summary(r: Rule, topics: Listing["topics"] = []): string {
  return `${triggerText(r.trigger, topics)}${conditionsText(r.conditions, r.trigger)} → ${r.actions.map(actionText).join(", ")}`;
}

/** Des règles prêtes à adapter. Un dossier vide = à choisir avant d'enregistrer. */
export const TEMPLATES: { title: string; rule: Omit<Rule, "id"> }[] = [
  {
    title: "📄 Ranger les PDF téléchargés",
    rule: {
      name: "Ranger les PDF",
      enabled: true,
      trigger: { type: "file", folder: "", subfolders: false },
      conditions: { ...EMPTY_CONDITIONS, extensions: ["pdf"] },
      actions: [{ type: "move", to: "" }, { type: "notify", text: "{nom} rangé" }],
    },
  },
  {
    title: "📋 Ctrl+Alt+V : coller sans mise en forme",
    rule: {
      name: "Coller sans mise en forme",
      enabled: true,
      trigger: { type: "hotkey", keys: "Ctrl+Alt+KeyV" },
      conditions: EMPTY_CONDITIONS,
      actions: [{ type: "pastePlain" }],
    },
  },
  {
    title: "🖥️ Ctrl+Alt+T : ouvrir un terminal",
    rule: {
      name: "Terminal",
      enabled: true,
      trigger: { type: "hotkey", keys: "Ctrl+Alt+KeyT" },
      conditions: EMPTY_CONDITIONS,
      actions: [{ type: "terminal" }],
    },
  },
  {
    title: "💾 Clé USB branchée : l'ouvrir",
    rule: {
      name: "Clé USB branchée",
      enabled: true,
      trigger: { type: "drive", removed: false },
      conditions: EMPTY_CONDITIONS,
      actions: [{ type: "notify", text: "{nom} branché" }, { type: "reveal" }],
    },
  },
  {
    title: "🖼️ Nouvelles captures sur l'étagère",
    rule: {
      name: "Captures sur l'étagère",
      enabled: true,
      trigger: { type: "file", folder: "", subfolders: false },
      conditions: { ...EMPTY_CONDITIONS, extensions: ["png", "jpg"] },
      actions: [{ type: "shelf" }],
    },
  },
];
