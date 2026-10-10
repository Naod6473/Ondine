// Ondine se déplace dans l'île : les 22 scènes et les règles qui décident si
// une scène se joue, en simple geste, ou pas du tout. Sans DOM (testé par
// tests/front/scenes.test.ts). Le moteur : walker.ts ; les scènes : scenes.ts.

/** Les ids des scènes (le numéro de ondine-se-deplace.md entre parenthèses). */
export const SCENE_IDS = [
  "shelf-remove", // (1) elle pousse le fichier retiré hors de l'île
  "shelf-add", // (1) elle rattrape le fichier qui arrive
  "note-delete", // (2) elle froisse la note et la lance
  "note-save", // (2) elle tamponne la note
  "timer-sit", // (3) elle s'assoit sur l'anneau qui se vide
  "timer-bell", // (3) la petite cloche à la fin
  "media-next", // (4) elle appuie sur « suivant » et danse sur la pochette
  "clip-new", // (5) elle range la nouvelle ligne en haut de l'historique
  "volume", // (6) elle grimpe sur le volume, se bouche les oreilles si c'est fort
  "agent-done", // (7) elle tape sur la carte de l'agent qui a fini
  "agent-wait", // (7) elle agite le bras à côté de l'agent qui attend
  "launcher-search", // (8) elle fouille à la loupe et apporte le premier résultat
  "capture", // (9) l'appareil photo et le flash
  "team-send", // (10) elle porte le message jusqu'au collègue
  "team-receive", // (10) elle traîne le fichier reçu jusqu'à vous
  "tab-hop", // (11) elle saute d'icône en icône jusqu'au nouvel onglet
  "rules-run", // (12) elle tourne une manivelle à côté de la règle
  "island-open", // (13) elle pousse les bords de l'île qui s'ouvre
  "progress", // (14) sa course est la barre de progression
  "drop-catch", // (15) bras ouverts sous la cible visée
  "sweep", // (16) un coup de balai sur toute la largeur
  "banner", // (17) elle tire la bannière de l'alerte
  "idle-stroll", // (18) elle se promène au repos
  "pomodoro-stretch", // (19) ses étirements pendant la pause
  "liquid-swim", // (20) elle nage d'un bord à l'autre
  "weather", // (21) parapluie ou coup de chaud
  "day-end", // (22) l'interrupteur du soir
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

export type IslandStateName = "hidden" | "peek" | "compact" | "expanded" | "drop" | "alert";

export interface SceneInfo {
  /** Le numéro de la scène dans ondine-se-deplace.md. */
  n: number;
  /** Le nom montré dans le mode démo (Réglages → Captures d'écran). */
  label: string;
  /** Le simple geste à la place (Calme, déplacements coupés, économie d'énergie), ou rien. */
  gesture: string | null;
  /** Les états de l'île où elle peut se déplacer pour cette scène. */
  walk: IslandStateName[];
  /** Une scène qui vient d'elle-même (pas d'une action) : rien du tout en « Calme ». */
  spontaneous?: boolean;
  /** Pas deux fois en moins de… (ms). */
  gapMs: number;
}

const OPEN: IslandStateName[] = ["expanded"];

export const SCENES: Record<SceneId, SceneInfo> = {
  "shelf-remove": { n: 1, label: "Retirer un fichier de l'étagère", gesture: "push", walk: OPEN, gapMs: 0 },
  "shelf-add": { n: 1, label: "Un fichier arrive sur l'étagère", gesture: "proud", walk: OPEN, gapMs: 3000 },
  "note-delete": { n: 2, label: "Supprimer une note", gesture: "push", walk: OPEN, gapMs: 0 },
  "note-save": { n: 2, label: "Enregistrer une note", gesture: "tap-glass", walk: OPEN, gapMs: 20_000 },
  "timer-sit": { n: 3, label: "Minuteur lancé", gesture: null, walk: OPEN, gapMs: 1500 },
  "timer-bell": { n: 3, label: "Fin du minuteur", gesture: null, walk: OPEN, gapMs: 2000 },
  "media-next": { n: 4, label: "Morceau suivant", gesture: "tap-glass", walk: OPEN, gapMs: 4000 },
  "clip-new": { n: 5, label: "Nouvelle copie", gesture: null, walk: OPEN, gapMs: 5000 },
  volume: { n: 6, label: "Changer le volume", gesture: "listening", walk: OPEN, gapMs: 4000 },
  "agent-done": { n: 7, label: "Un agent a fini", gesture: "tap-glass", walk: OPEN, gapMs: 3000 },
  "agent-wait": { n: 7, label: "Un agent attend", gesture: "wave", walk: OPEN, gapMs: 3000 },
  "launcher-search": { n: 8, label: "Recherche du Lanceur", gesture: "pensive", walk: OPEN, gapMs: 8000 },
  capture: { n: 9, label: "Capture d'écran", gesture: "proud", walk: OPEN, gapMs: 2000 },
  "team-send": { n: 10, label: "Envoyer à un collègue", gesture: "wave", walk: OPEN, gapMs: 3000 },
  "team-receive": { n: 10, label: "Fichier reçu d'un collègue", gesture: "happy", walk: OPEN, gapMs: 3000 },
  "tab-hop": { n: 11, label: "Changer d'onglet", gesture: null, walk: OPEN, gapMs: 0 },
  "rules-run": { n: 12, label: "Une règle s'exécute", gesture: "focus", walk: OPEN, gapMs: 3000 },
  "island-open": { n: 13, label: "Ouvrir l'île", gesture: null, walk: OPEN, spontaneous: true, gapMs: 120_000 },
  progress: { n: 14, label: "Progression d'une copie", gesture: null, walk: OPEN, gapMs: 0 },
  "drop-catch": { n: 15, label: "Glisser un fichier sur l'île", gesture: "cheer", walk: ["drop"], gapMs: 0 },
  sweep: { n: 16, label: "Vider l'étagère", gesture: "proud", walk: OPEN, gapMs: 3000 },
  banner: { n: 17, label: "Notification importante", gesture: null, walk: ["alert"], gapMs: 2000 },
  "idle-stroll": { n: 18, label: "Promenade au repos", gesture: null, walk: OPEN, spontaneous: true, gapMs: 60_000 },
  "pomodoro-stretch": { n: 19, label: "Pause du Pomodoro", gesture: "stretch", walk: OPEN, gapMs: 30_000 },
  "liquid-swim": { n: 20, label: "Nager dans le liquide", gesture: null, walk: OPEN, spontaneous: true, gapMs: 5000 },
  weather: { n: 21, label: "La météo", gesture: null, walk: OPEN, spontaneous: true, gapMs: 30 * 60_000 },
  "day-end": { n: 22, label: "Fin de journée", gesture: null, walk: OPEN, spontaneous: true, gapMs: 0 },
};

export function isSceneId(id: unknown): id is SceneId {
  return typeof id === "string" && (SCENE_IDS as readonly string[]).includes(id);
}

/** Ce qui décide d'une scène, lu ailleurs (réglages, Windows, l'île). */
export interface SceneContext {
  /** Une mascotte vit dans l'île (pas sur le bureau, pas éteinte). */
  hasMascot: boolean;
  /** « Réduire les animations » de Windows. */
  reduced: boolean;
  /** Réglage « Calme » de la mascotte. */
  calm: boolean;
  /** Réglage « Ondine se déplace dans l'île ». */
  walkOn: boolean;
  /** `island.style` = "mouth" (Ondine forme le cadre de l'île). */
  mouth: boolean;
  /** Économie d'énergie. */
  eco: boolean;
  /** L'état de l'île. */
  state: IslandStateName;
  /** Un tirage au sort (0 à 1) pour cette fois : sans lui, Ondine marche à chaque fois. */
  roll?: number;
  /** Mode démo (le tour des scènes, la vidéo) : elle marche à chaque fois. */
  demo?: boolean;
}

/**
 * Comment jouer une scène :
 *   off      rien (Réduire les animations, pas de mascotte, île cachée,
 *            scène spontanée en Calme, île-bouche sauf la scène 1)
 *   gesture  le simple geste, dans sa case
 *   walk     elle se déplace
 *   crunch   île-bouche : elle croque le fichier retiré (scène 1 seulement)
 */
export type SceneMode = "off" | "gesture" | "walk" | "crunch";

/** La part des fois où Ondine se déplace vraiment (environ 1 sur 4,5). */
export const WALK_CHANCE = 0.22;

export function sceneMode(id: SceneId, c: SceneContext): SceneMode {
  const info = SCENES[id];
  if (!c.hasMascot || c.reduced) return "off";
  if (c.mouth) return id === "shelf-remove" && (c.state === "expanded" || c.state === "compact") ? "crunch" : "off";
  if (c.state === "hidden" || c.state === "peek") return "off";
  if (c.calm && info.spontaneous) return "off";
  const still = c.calm || !c.walkOn || c.eco || !info.walk.includes(c.state);
  // Simon (1.2.3) : les déplacements à chaque fois alourdissent l'île. Elle ne
  // part qu'environ une fois sur 4 ou 5, au hasard ; les autres fois, le geste.
  const skip = !c.demo && c.roll !== undefined && c.roll >= WALK_CHANCE;
  if (still || skip) return info.gesture ? "gesture" : "off";
  return "walk";
}

/** `island.style`, lu prudemment (le réglage vient d'une autre branche) : tout sauf "mouth" = classique. */
export function islandStyle(island: unknown): "classic" | "mouth" {
  const style = (island as { style?: unknown } | null | undefined)?.style;
  return style === "mouth" ? "mouth" : "classic";
}

/** Le réglage « Ondine se déplace dans l'île » (champ `ondineWalk` du module Animations de l'île), activé par défaut. */
export function walkSetting(modules: unknown): boolean {
  const values = (modules as { halos?: { values?: Record<string, unknown> } } | null | undefined)?.halos?.values;
  return values?.ondineWalk !== false;
}

/** Pas deux fois la même scène trop vite (SCENES[id].gapMs). */
export class SceneGaps {
  private last = new Map<SceneId, number>();
  ready(id: SceneId, now: number): boolean {
    const at = this.last.get(id);
    return at === undefined || now - at >= SCENES[id].gapMs;
  }
  mark(id: SceneId, now: number) {
    this.last.set(id, now);
  }
}

// ── Les petits calculs des scènes ────────────────────────────────────────────

/** Une progression (0 à 1) d'après `{percent}` (0 à 100) ou `{step, total}` ; null si illisible. */
export function progressOf(p: unknown): number | null {
  const o = (p ?? {}) as { percent?: unknown; step?: unknown; total?: unknown };
  if (typeof o.percent === "number" && Number.isFinite(o.percent)) return Math.min(1, Math.max(0, o.percent / 100));
  if (typeof o.step === "number" && typeof o.total === "number" && o.total > 0) return Math.min(1, Math.max(0, o.step / o.total));
  return null;
}

/** Le volume est fort : elle se bouche les oreilles. */
export const LOUD = 80;
export function isLoud(volume: unknown, muted?: unknown): boolean {
  return muted !== true && typeof volume === "number" && volume >= LOUD;
}

/** La météo de la scène 21 d'après l'icône du module Météo. */
export function weatherKind(icon: unknown): "rain" | "sun" | null {
  const s = typeof icon === "string" ? icon : "";
  if (/🌧|🌦|⛈|☔|🌨|❄/u.test(s)) return "rain";
  if (/☀|🌤|🔆/u.test(s)) return "sun";
  return null;
}

/** L'heure de fin de journée : `leaveTime` ("HH:MM", réglage des halos) ou 19 h. En minutes depuis minuit. */
export function dayEndMinutes(leaveTime: unknown): number {
  const m = typeof leaveTime === "string" ? /^(\d{1,2}):(\d{2})$/.exec(leaveTime.trim()) : null;
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 24 && min < 60) return h * 60 + min;
  }
  return 19 * 60;
}

/** C'est le soir (après l'heure de fin de journée, avant 4 h du matin). */
export function isEvening(date: Date, leaveTime: unknown): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  return now >= dayEndMinutes(leaveTime) || now < 4 * 60;
}

/** Le jour (AAAA-MM-JJ local) : la scène du soir une fois par jour. Avant 4 h, c'est encore la veille. */
export function dayKey(date: Date): string {
  const d = new Date(date.getTime() - 4 * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Au repos dans l'île ouverte : la promenade après… (ms sans bouger la souris). */
export const IDLE_STROLL_MS = 25_000;
