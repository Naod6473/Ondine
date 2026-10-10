// Ce que l'onglet Règles (île) et l'éditeur (fenêtre de réglages) partagent :
// la forme d'une règle (miroir de src-tauri/src/modules/rules/model.rs), la
// phrase qui la résume, et les modèles prêts à l'emploi.

export type Trigger =
  | { type: "file"; folder: string; subfolders?: boolean }
  | { type: "drive"; removed?: boolean }
  | { type: "hotkey"; keys: string }
  | { type: "event"; topic: string }
  | { type: "agent"; waiting?: boolean }
  /** days : 0 = lundi … 6 = dimanche (vide = tous) ; folder : agir sur chaque fichier de ce dossier. */
  | { type: "schedule"; time: string; days?: number[]; folder?: string }
  | { type: "network"; change: NetChange }
  | { type: "battery"; below: number }
  | { type: "power"; plugged?: boolean }
  | { type: "unlock" }
  | { type: "clipboard"; kind: ClipKind; text?: string }
  | { type: "music" };

export type NetChange = "internetDown" | "internetUp" | "vpnUp" | "vpnDown";
export type ClipKind = "link" | "email" | "code" | "text";
export type Gesture = "dance" | "emote" | "sign";

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
  | { type: "pastePlain" }
  | { type: "addNote"; text: string; todo?: boolean }
  | { type: "unzip"; to: string; shelf?: boolean }
  | { type: "copyPath"; nameOnly?: boolean }
  | { type: "mascot"; gesture: Gesture; emotion?: string; text?: string }
  | { type: "quiet"; minutes: number };

export interface Conditions {
  extensions: string[];
  nameContains: string;
  minKb: number | null;
  maxKb: number | null;
  /** Seulement ces jours (0 = lundi … 6 = dimanche ; vide = tous). */
  days?: number[];
  /** Seulement entre ces heures ("09:00" → "18:00") ; vides = toute la journée. */
  from?: string;
  to?: string;
  /** Pas modifié depuis au moins N jours (déclencheur horaire sur un dossier). */
  olderThanDays?: number | null;
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
  /** Déclenchements depuis lundi, par id de règle. */
  counts?: Record<string, number>;
}

export const EMPTY_CONDITIONS: Conditions = { extensions: [], nameContains: "", minKb: null, maxKb: null, days: [], from: "", to: "", olderThanDays: null };

/** Les jours, du lundi (0) au dimanche (6). */
export const DAY_NAMES = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Les expressions qu'une règle peut demander (miroir de EMOTIONS dans model.rs). */
export const EMOTIONS: [string, string][] = [
  ["happy", "Contente"],
  ["love", "Amoureuse"],
  ["laugh", "Rit"],
  ["surprised", "Surprise"],
  ["celebrate", "Fait la fête"],
  ["starstruck", "Des étoiles dans les yeux"],
  ["wink", "Clin d'œil"],
  ["sad", "Triste"],
  ["worried", "Inquiète"],
  ["sleep", "Dort"],
  ["stretch", "S'étire"],
  ["yawn", "Bâille"],
  ["sunglasses", "Lunettes de soleil"],
  ["relieved", "Soulagée"],
  ["listening", "Tend l'oreille"],
  ["panic", "Panique"],
];

export const NET_LABELS: Record<NetChange, string> = {
  internetDown: "Internet est coupé",
  internetUp: "Internet revient",
  vpnUp: "un VPN se branche",
  vpnDown: "un VPN se coupe",
};

export const CLIP_LABELS: Record<ClipKind, string> = {
  link: "un lien",
  email: "une adresse e-mail",
  code: "un code de vérification (4 à 8 chiffres)",
  text: "un texte précis",
};

/** Le déclencheur donne-t-il un fichier ? (miroir de Trigger::gives_file) */
export function givesFile(t: Trigger): boolean {
  return t.type === "file" || (t.type === "schedule" && !!t.folder?.trim());
}

/** « lun., mar., mer. » ; tous les jours ; du lundi au vendredi. */
export function daysText(days: number[] | undefined): string {
  const d = [...new Set(days ?? [])].sort();
  if (!d.length || d.length === 7) return "tous les jours";
  if (d.join() === "0,1,2,3,4") return "en semaine";
  if (d.join() === "5,6") return "le week-end";
  return d.map((x) => DAY_NAMES[x] ?? "?").join(", ");
}

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
  addNote: "Ajouter une note ou une to-do",
  unzip: "Décompresser une archive .zip",
  copyPath: "Copier le chemin ou le nom",
  mascot: "Mascotte : danser, expression, pancarte",
  quiet: "Calme / Ne pas déranger",
};

/** Les actions possibles selon le déclencheur (miroir de la validation Rust). */
export function allowedActions(t: Trigger): Action["type"][] {
  const always: Action["type"][] = ["notify", "addNote", "mascot", "quiet", "openIsland", "timer", "terminal", "pastePlain"];
  if (givesFile(t)) return ["move", "copy", "rename", "trash", "unzip", "shelf", "reveal", "copyPath", ...always];
  if (t.type === "drive" && !t.removed) return ["reveal", "shelf", "copyPath", ...always];
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
    case "agent":
      return t.waiting ? "Quand un agent IA m'attend" : "Quand un agent IA a fini";
    case "schedule":
      return `${daysText(t.days)} à ${t.time || "…"}${t.folder?.trim() ? `, les fichiers de ${folderName(t.folder)}` : ""}`.replace(/^./, (c) => c.toUpperCase());
    case "network":
      return `Quand ${NET_LABELS[t.change]}`;
    case "battery":
      return `Quand la batterie passe sous ${t.below} %`;
    case "power":
      return t.plugged === false ? "Quand le PC est débranché du secteur" : "Quand le PC est branché sur secteur";
    case "unlock":
      return "Quand je reviens devant le PC";
    case "clipboard":
      return t.kind === "text" ? `Quand je copie un texte avec « ${t.text ?? ""} »` : `Quand je copie ${CLIP_LABELS[t.kind]}`;
    case "music":
      return "Quand une musique démarre";
  }
}

export function conditionsText(c: Conditions, t: Trigger): string {
  const parts: string[] = [];
  if (t.type === "file" && c.extensions.length) parts.push(c.extensions.map((e) => `.${e}`).join(", "));
  if (c.nameContains.trim()) parts.push(`nom avec « ${c.nameContains.trim()} »`);
  if (t.type === "file" && c.minKb) parts.push(`≥ ${c.minKb} Ko`);
  if (t.type === "file" && c.maxKb) parts.push(`≤ ${c.maxKb} Ko`);
  if (c.olderThanDays) parts.push(`plus vieux que ${c.olderThanDays} j`);
  if (c.days?.length && c.days.length < 7) parts.push(daysText(c.days));
  if (c.from && c.to) parts.push(`de ${c.from} à ${c.to}`);
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
    case "addNote":
      return `${a.todo ? "to-do" : "note"} « ${a.text} »`;
    case "unzip":
      return `décompresser dans ${folderName(a.to)}`;
    case "copyPath":
      return a.nameOnly ? "copier le nom" : "copier le chemin";
    case "mascot":
      return a.gesture === "dance" ? "la mascotte danse" : a.gesture === "sign" ? `pancarte « ${a.text ?? ""} »` : "expression de la mascotte";
    case "quiet":
      return `Calme ${a.minutes} min`;
    default:
      return ACTION_LABELS[a.type].toLowerCase();
  }
}

/** « déclenchée 3 fois cette semaine » (rien si jamais). */
export function countText(n: number | undefined): string {
  if (!n) return "";
  return n === 1 ? "déclenchée 1 fois cette semaine" : `déclenchée ${n} fois cette semaine`;
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
    title: "🧹 Ranger les vieux téléchargements",
    rule: {
      name: "Vieux téléchargements",
      enabled: true,
      trigger: { type: "schedule", time: "17:00", days: [4], folder: "" },
      conditions: { ...EMPTY_CONDITIONS, olderThanDays: 30 },
      actions: [{ type: "trash" }, { type: "notify", text: "Vieux téléchargements à la Corbeille (récupérables)" }],
    },
  },
  {
    title: "🥪 Pause déjeuner",
    rule: {
      name: "Pause déjeuner",
      enabled: true,
      trigger: { type: "schedule", time: "12:30", days: [0, 1, 2, 3, 4], folder: "" },
      conditions: EMPTY_CONDITIONS,
      actions: [{ type: "notify", text: "C'est l'heure de manger !" }, { type: "mascot", gesture: "emote", emotion: "stretch" }, { type: "quiet", minutes: 45 }],
    },
  },
  {
    title: "💃 Agent fini → la mascotte danse",
    rule: {
      name: "Agent fini",
      enabled: true,
      trigger: { type: "agent", waiting: false },
      conditions: EMPTY_CONDITIONS,
      actions: [{ type: "mascot", gesture: "dance" }, { type: "notify", text: "{nom} : l'agent a fini" }],
    },
  },
  {
    title: "📡 Internet coupé → me prévenir",
    rule: {
      name: "Internet coupé",
      enabled: true,
      trigger: { type: "network", change: "internetDown" },
      conditions: EMPTY_CONDITIONS,
      actions: [{ type: "notify", text: "Internet est coupé" }, { type: "mascot", gesture: "emote", emotion: "worried" }],
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
