// « Rester éveillé » : la logique sans DOM (testée dans tests/front/awake.test.ts).
// Les textes du compte à rebours, l'heure « jusqu'à 18:30 » calculée dans
// l'heure locale, la phrase de confirmation d'un arrêt programmé, et ce que
// montre la mini-île. Le Rust (src-tauri/src/modules/awake_logic.rs) vérifie
// tout ce qu'on lui envoie.

export type KeepUntil = "at" | "forever" | "download" | "agent";
export type PowerAction = "shutdown" | "sleep" | "restart" | "lock";
export type PlanWhen = "at" | "download" | "agent";

export interface AwakeState {
  keep: { until: KeepUntil; at: number | null; display: boolean; since: number } | null;
  plan: { action: PowerAction; when: PlanWhen; at: number | null; warned: boolean } | null;
  downloading: boolean;
  agentBusy: boolean;
  coffee: boolean;
}

export const IDLE_STATE: AwakeState = { keep: null, plan: null, downloading: false, agentBusy: false, coffee: true };

/** Le dernier avertissement : 60 s avant (comme WARN_MS du Rust). */
export const WARN_MS = 60_000;

/** Un état reçu du Rust (bus ou commande), ramené à quelque chose de sûr. */
export function cleanState(raw: unknown): AwakeState {
  const r = (raw ?? {}) as Partial<AwakeState>;
  const keep = r.keep && typeof r.keep === "object" && ["at", "forever", "download", "agent"].includes(r.keep.until) ? r.keep : null;
  const plan = r.plan && typeof r.plan === "object" && ACTIONS.includes(r.plan.action) ? r.plan : null;
  return { keep, plan, downloading: r.downloading === true, agentBusy: r.agentBusy === true, coffee: r.coffee !== false };
}

export const ACTIONS: PowerAction[] = ["shutdown", "sleep", "restart", "lock"];

/** Le bouton de chaque action (à l'infinitif). */
export const ACTION_LABELS: Record<PowerAction, string> = {
  shutdown: "Éteindre",
  sleep: "Mettre en veille",
  restart: "Redémarrer",
  lock: "Verrouiller",
};

/** Son pictogramme (chacun a son trait dans src/island/icon.ts). */
export const ACTION_ICONS: Record<PowerAction, string> = { shutdown: "📴", sleep: "🌙", restart: "🔄", lock: "🔒" };

/** Le nom de chaque action (« Arrêt à 18:30 », « Veille · 4:09 »). */
const ACTION_NOUN: Record<PowerAction, string> = {
  shutdown: "Arrêt",
  sleep: "Veille",
  restart: "Redémarrage",
  lock: "Verrouillage",
};

/** Les durées proposées d'un clic, en minutes (0 = sans limite). */
export const KEEP_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 120, label: "2 h" },
  { minutes: 0, label: "Sans limite" },
];

/** « 18:30 » d'un instant, dans l'heure locale. */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * L'instant de la prochaine « 18:30 » (aujourd'hui, ou demain si c'est passé
 * ou dans moins d'une minute). null si l'heure n'est pas lisible.
 */
export function nextClock(text: string, now: number): number | null {
  const m = /^\s*(\d{1,2})\s*[:hH.]\s*(\d{2})?\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= now + 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Le temps qui reste : « 1:05:09 », « 4:09 », « 0:42 ». */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Jusqu'à quand le PC reste éveillé, en une phrase courte. */
export function keepText(keep: NonNullable<AwakeState["keep"]>): string {
  switch (keep.until) {
    case "forever":
      return "Sans limite";
    case "download":
      return "Jusqu'à la fin du téléchargement";
    case "agent":
      return "Jusqu'à ce que l'agent ait fini";
    default:
      return `Jusqu'à ${clockOf(keep.at ?? 0)}`;
  }
}

/** Quand l'arrêt programmé a lieu, en une phrase : « Arrêt à 18:30 », « Veille quand le téléchargement sera fini ». */
export function planText(plan: NonNullable<AwakeState["plan"]>): string {
  const noun = ACTION_NOUN[plan.action];
  if (plan.when === "download") return `${noun} quand le téléchargement sera fini`;
  if (plan.when === "agent") return `${noun} quand l'agent aura fini`;
  return `${noun} à ${clockOf(plan.at ?? 0)}`;
}

/** Ce qu'on programme, avant de le confirmer. */
export interface PlanChoice {
  action: PowerAction;
  when: "minutes" | "at" | "download" | "agent";
  minutes?: number;
  /** L'heure tapée (« 18:30 »), pour when = "at". */
  clock?: string;
}

/** La question de la confirmation : « Éteindre le PC dans 60 min ? » */
export function confirmText(c: PlanChoice): string {
  const verb = ACTION_LABELS[c.action];
  if (c.when === "download") return `${verb} le PC quand le téléchargement sera fini ?`;
  if (c.when === "agent") return `${verb} le PC quand l'agent aura fini ?`;
  if (c.when === "at") return `${verb} le PC à ${c.clock ?? ""} ?`;
  return `${verb} le PC dans ${c.minutes ?? 0} min ?`;
}

/**
 * Les arguments de la commande Rust `plan` (`confirmed: true` : seulement
 * après le bouton de confirmation), ou le problème à afficher.
 */
export function planArgs(c: PlanChoice, now: number): { args: Record<string, unknown> } | { error: string } {
  if (c.when === "minutes") {
    const m = Math.round(Number(c.minutes));
    if (!Number.isFinite(m) || m < 1 || m > 1440) return { error: "Choisissez de 1 à 1440 minutes." };
    return { args: { action: c.action, when: "minutes", minutes: m, confirmed: true } };
  }
  if (c.when === "at") {
    const at = nextClock(c.clock ?? "", now);
    if (at === null) return { error: "Tapez une heure comme 18:30." };
    return { args: { action: c.action, when: "at", at, confirmed: true } };
  }
  return { args: { action: c.action, when: c.when, confirmed: true } };
}

/** Ce que montre la mini-île : l'arrêt programmé d'abord, puis l'éveil. */
export function compactLine(s: AwakeState, now: number): { kind: "plan" | "keep"; icon: string; text: string } | null {
  if (s.plan) {
    const p = s.plan;
    const left = p.when === "at" && p.at ? countdown(p.at - now) : p.when === "download" ? "après le téléchargement" : "après l'agent";
    return { kind: "plan", icon: ACTION_ICONS[p.action], text: `${ACTION_NOUN[p.action]} · ${left}` };
  }
  if (s.keep) {
    const k = s.keep;
    const left = k.until === "at" && k.at ? countdown(k.at - now) : k.until === "forever" ? "sans limite" : k.until === "download" ? "téléchargement" : "agent";
    return { kind: "keep", icon: "☕", text: `Éveillé · ${left}` };
  }
  return null;
}

/** Le dernier avertissement : « Arrêt du PC dans 60 s ». */
export function warnTitle(action: PowerAction, secs: number): string {
  return `${ACTION_NOUN[action]} du PC dans ${Math.max(0, Math.round(secs))} s`;
}
