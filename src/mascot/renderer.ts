// Le contrat MascotRenderer : la SEULE chose que le reste de l'île connaît d'une
// mascotte. Aujourd'hui : un dessin en Canvas 2D. Demain : planches de sprites,
// Lottie ou Rive, en ajoutant un renderer ici, sans toucher au reste.

import type { Beat } from "./beat";
import type { AnimationSpec, MascotExtras, MascotManifest, MascotState, Mood } from "./types";
import { PlaceholderCanvasRenderer } from "./renderers/canvas-placeholder";
import { GumRenderer } from "./renderers/gum";
import { PosesRenderer } from "./renderers/poses";
import { SpriteSheetRenderer } from "./renderers/spritesheet";

export interface MascotRenderer {
  /** Se dessine dans `container` (il remplit sa taille, et suit ses changements). */
  mount(container: HTMLElement): void;
  /** Joue une animation du manifeste. */
  play(animation: AnimationSpec): void;
  /** Informe de l'état courant (certains moteurs ont leur propre machine à états). */
  setState(state: MascotState): void;
  /** Humeur de fond. */
  setMood(mood: Mood): void;
  /** Regarde vers ce point, en px relatifs au centre du conteneur ; null = droit devant. */
  lookAt(x: number | null, y: number | null): void;
  /**
   * Facultatif : ce qui arrive à l'île (un clic qui l'enfonce, un étirement, le
   * lâcher, une secousse), pour que la mascotte réagisse. x, y en px par rapport
   * au centre de la mascotte.
   */
  react?(kind: MascotReaction, data: { x?: number; y?: number; amount?: number }): void;
  /** Facultatif : la météo du moment (icône du module Météo), pour la mascotte « Météo ». */
  setWeather?(icon: string | null): void;
  /**
   * Facultatif : ce qu'elle porte en plus, tant que ça dure (mascot-state.ts) :
   * les moufles sur les oreilles (concentration), la pancarte « ? » (une
   * question d'agent ouverte), le parapluie (la Météo annonce la pluie).
   */
  setExtras?(extras: MascotExtras): void;
  /**
   * Facultatif : le temps de la musique pour les danses (bpm et l'instant
   * d'un temps, performance.now()) ; null : le tempo typique du style (src/mascot/beat.ts).
   */
  setBeat?(beat: Beat | null): void;
  /**
   * Facultatif : dose l'émotion qui vient de commencer (`intensity` 0 à 1),
   * la mélange à une autre animation (`mix`, part `mixK`), ou la joue de
   * l'autre côté (`mirror`). Appelé juste après play() (mascot.emote).
   */
  express?(e: MascotExpression): void;
  /**
   * Facultatif : la bouche suit la voix (mascot.talk) : `open` de 0 à 1 au
   * rythme des syllabes ; `mark` = « ? » ou « ! » lu dans le texte.
   */
  talk?(open: number, mark?: TalkMark | null): void;
  /** Appelé à la fin d'une animation non bouclée. */
  onAnimationEnd(cb: (name: string) => void): void;
  destroy(): void;
}

export type MascotReaction = "poke" | "stretch" | "release" | "shake";

/** Le dosage et le mélange d'une émotion (voir MascotRenderer.express). */
export interface MascotExpression {
  intensity?: number;
  mix?: AnimationSpec;
  mixK?: number;
  mirror?: boolean;
}

/** Une ponctuation lue dans le texte qui s'affiche : les sourcils réagissent. */
export type TalkMark = "?" | "!";

export { NO_EXTRAS, type MascotExtras } from "./types";

type RendererFactory = (manifest: MascotManifest, assets: Record<string, string>) => MascotRenderer;

/** Les moteurs connus. Ajouter un moteur = ajouter une ligne ici. */
const RENDERERS: Record<string, RendererFactory> = {
  "canvas-code": () => new PlaceholderCanvasRenderer(),
  spritesheet: (m, assets) => new SpriteSheetRenderer(m, assets),
  poses: (m, assets) => new PosesRenderer(m, assets),
  gum: (m) => new GumRenderer(m),
  // "lottie":      (m, assets) => new LottieRenderer(m, assets),
  // "rive":        (m, assets) => new RiveRenderer(m, assets),
};

/** Crée le moteur d'une mascotte ; si son moteur n'existe pas encore, retombe sur la mascotte provisoire. */
export function createRenderer(manifest: MascotManifest, assets: Record<string, string>): MascotRenderer {
  const factory = RENDERERS[manifest.renderer];
  if (!factory) {
    console.warn(`[mascotte] moteur « ${manifest.renderer} » pas encore branché : mascotte provisoire utilisée`);
    return new PlaceholderCanvasRenderer();
  }
  return factory(manifest, assets);
}
