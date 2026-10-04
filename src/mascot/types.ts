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
 * D'où vient une animation. Une seule de ces formes à la fois :
 *   { "function": "idle" }                         dessinée en code (renderer "canvas-code")
 *   { "file": "idle.png", "frames": 12, "fps": 24 } planche de sprites (à venir)
 *   { "file": "idle.json" }                         Lottie (à venir)
 *   { "file": "mascot.riv", "animation": "idle" }   Rive (à venir)
 */
export interface AnimationSource {
  function?: string;
  file?: string;
  frames?: number;
  fps?: number;
  animation?: string;
}

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
