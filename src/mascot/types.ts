// Les types de la mascotte : états, humeurs, manifeste d'animations.

/** Les états de départ de la mascotte. */
export const MASCOT_STATES = [
  "idle",
  "wake",
  "sleep",
  "happy",
  "annoyed",
  "dizzy",
  "thinking",
  "working",
  "alert",
  "eating",
  "celebrate",
  "love",
  "bored",
  // Émotions de la goutte v2 (une mascotte qui ne les a pas retombe sur `fallback`).
  "success",
  "question",
  "error",
  "warning",
  "info",
  "sad",
  "worried",
  "surprise",
  "shy",
  "calm",
  "wink",
  // Les nouvelles expressions de la famille gomme.
  "wave",
  "laugh",
  "proud",
  "pout",
  "starstruck",
  "mischief",
  "focus",
  "moved",
  "embarrassed",
  "yawn",
  "pensive",
  "cheer",
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

/** L'humeur colore l'animation de repos (sourire, sourcils froncés, paupières lourdes…). */
export type Mood = "neutral" | "happy" | "grumpy" | "tired";

/**
 * D'où vient une animation. Formes possibles :
 *   { "function": "idle" }                          dessinée en code (moteur "canvas-code")
 *   { "file": "idle.png", "frames": 12, "fps": 24 }  planche de sprites jouée dans le temps
 *   { "file": "regard-loin.png", "frames": 7, "mode": "gaze",
 *     "nearFile": "regard-pres.png" }               planche de REGARD : l'image est choisie
 *                                                   selon la position de la souris
 *   { "file": "idle.json" }                          Lottie (à venir)
 *   { "file": "mascot.riv", "animation": "idle" }    Rive (à venir)
 *
 *   { "pose": "joie" }                               une POSE du manifeste (moteur "poses")
 *   { "poses": ["agacee", "colere"], "poseMs": 700 } plusieurs poses à la suite (la dernière reste)
 *
 * Avec les moteurs "spritesheet" et "poses", on peut en plus animer le corps par
 * du code : "effect" (mouvement du corps) et "overlay" (effet dessiné autour :
 * zzz, confettis…).
 */
export interface AnimationSource {
  function?: string;
  file?: string;
  frames?: number;
  fps?: number;
  animation?: string;
  /** "play" (défaut) : images jouées dans le temps ; "gaze" : image choisie par le regard. */
  mode?: "play" | "gaze";
  /** Mode "gaze" : planche utilisée quand la souris est tout près de la mascotte. */
  nearFile?: string;
  /** Mode "gaze" : distance (px) en dessous de laquelle on utilise `nearFile`. Défaut 90. */
  nearDistance?: number;
  effect?: SpriteEffect;
  overlay?: Overlay;

  // ── Moteur "poses" ──
  /** La pose à montrer (clé de `poses` dans le manifeste). */
  pose?: string;
  /**
   * Plusieurs poses à la suite, chacune `poseMs` ms (les images d'une animation,
   * fondues l'une dans l'autre) ; en boucle si l'animation boucle, sinon la
   * dernière reste affichée.
   */
  poses?: string[];
  /** Durée de chaque pose de `poses` (défaut 600 ms). */
  poseMs?: number;
  /** Durée du fondu entre deux poses (défaut 280 ms). */
  fadeMs?: number;
  /** Où regardent les pupilles : la souris (défaut), en l'air, ou elles tournent (étourdie). */
  look?: "mouse" | "up" | "spin";
  /** Pupilles un peu plus grandes (surprise). */
  wide?: boolean;
  /** Animation de repos : de temps en temps, une de ces poses passe quelques secondes. */
  variants?: string[];
}

export type Overlay = "none" | "zzz" | "dots" | "bang" | "confetti" | "hearts" | "steam" | "sweat" | "stars" | "question" | "check" | "sparkles";

/** Un œil blanc d'une pose, en px dans l'image 256 × 256 : on y dessine la pupille. */
export interface PoseEye {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Une pose du moteur "poses" : une image, et ses yeux blancs s'il y en a. */
export interface PoseSpec {
  file: string;
  /** Les yeux blancs où dessiner les pupilles (absent = yeux déjà dessinés ou fermés). */
  eyes?: PoseEye[];
  /** Pose montrée quand la paupière arrive en bas pendant un clignement (ex. "closed"). */
  blink?: string;
}

/** Mouvements de corps qu'on peut appliquer à n'importe quelle planche. */
export type SpriteEffect =
  | "breathe"
  | "wake"
  | "sleep"
  | "bounce"
  | "jump"
  | "shake"
  | "wobble"
  | "bob"
  | "pulse"
  | "chomp"
  | "sway"
  | "sigh"
  | "stretch"
  | "flinch"
  | "dodge";

export interface AnimationSpec {
  name: string;
  source: AnimationSource;
  durationMs: number;
  loop: boolean;
  /** Plus c'est haut, plus l'animation résiste à une interruption (0 = repos). */
  priority: number;
  /** Animations vers lesquelles on peut passer depuis celle-ci ("*" = toutes). */
  transitionsTo: string[];
  /** Pour une animation non bouclée : celle qui suit (défaut : l'état de base). */
  next?: string;
}

export interface MascotManifest {
  id: string;
  name: string;
  version: string;
  /** Quel moteur dessine cette mascotte : "canvas-code", "spritesheet", "poses", "lottie", "rive". */
  renderer: string;
  /** Animation de secours quand un état n'a pas d'animation propre. */
  fallback: string;
  /** État → nom d'animation. Un état absent utilise `fallback`. */
  states: Partial<Record<MascotState, string>>;
  animations: AnimationSpec[];
  /** Moteur "gum" : la forme du bonbon (gum-shapes.ts), ou "ciel" / "meteo" qui changent toutes seules. */
  gum?: { shape?: string };
  /** Moteur "poses" : nom de la pose → image et yeux. */
  poses?: Record<string, PoseSpec>;
}

/**
 * Ce que la mascotte porte en plus de son animation, tant que ça dure
 * (`MascotRenderer.setExtras`, poussé par mascot-state.ts) : les moufles sur
 * les oreilles (concentration), la pancarte « ? » (une question d'agent
 * ouverte), le parapluie (la Météo annonce la pluie).
 */
export interface MascotExtras {
  ears: boolean;
  sign: boolean;
  umbrella: boolean;
}

export const NO_EXTRAS: MascotExtras = { ears: false, sign: false, umbrella: false };
