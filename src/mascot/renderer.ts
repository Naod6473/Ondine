// Le contrat MascotRenderer : la SEULE chose que le reste de l'île connaît d'une
// mascotte. Aujourd'hui : un dessin en Canvas 2D. Demain : planches de sprites,
// Lottie ou Rive, en ajoutant un renderer ici, sans toucher au reste.

import type { AnimationSpec, MascotManifest, MascotState, Mood } from "./types";
import { PlaceholderCanvasRenderer } from "./renderers/canvas-placeholder";

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
  /** Appelé à la fin d'une animation non bouclée. */
  onAnimationEnd(cb: (name: string) => void): void;
  destroy(): void;
}

type RendererFactory = (manifest: MascotManifest, assets: Record<string, string>) => MascotRenderer;

/** Les moteurs connus. Ajouter un moteur = ajouter une ligne ici. */
const RENDERERS: Record<string, RendererFactory> = {
  "canvas-code": () => new PlaceholderCanvasRenderer(),
  // "spritesheet": (m, assets) => new SpriteRenderer(m, assets),
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
