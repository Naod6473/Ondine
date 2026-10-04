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
 * Avec le moteur "spritesheet", on peut en plus animer une planche par du code
 * en attendant les vraies animations : "effect" (mouvement du corps) et
 * "overlay" (effet dessiné autour : zzz, confettis…).
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
  overlay?: "none" | "zzz" | "dots" | "bang" | "confetti" | "hearts" | "steam" | "sweat" | "stars";
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
  | "sigh";

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
  /** Quel moteur dessine cette mascotte : "canvas-code", "spritesheet", "lottie", "rive". */
  renderer: string;
  /** Animation de secours quand un état n'a pas d'animation propre. */
  fallback: string;
  /** État → nom d'animation. Un état absent utilise `fallback`. */
  states: Partial<Record<MascotState, string>>;
  animations: AnimationSpec[];
}
