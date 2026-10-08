// Le moteur « gomme » branché sur l'appli : les réglages de la mascotte
// (couleur, mains, accessoires, settingsStore), la boucle de dessin de
// core/perf.ts (arrêtée île cachée, 30 images/s en économie d'énergie) et
// « Réduire les animations » de Windows. Le moteur lui-même est dans
// gum-engine.ts, qui ne dépend de rien de tout ça (le site l'utilise aussi,
// voir gum-standalone.ts).

import { frameLoop } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { reducedMotion } from "../../island/tab-pill";
import type { MascotManifest } from "../types";
import { TINT_NAMES, type EyeWear, type GumTint, type HeadWear, type NeckWear } from "./gum-draw";
import { GumEngine, type GumEnv, type GumPrefs } from "./gum-engine";

export type { GumEnv, GumPrefs } from "./gum-engine";

/** Les réglages de la mascotte qui touchent au dessin, lus dans settingsStore. */
function prefs(): GumPrefs {
  const m = settingsStore.current.mascot as Partial<{ color: string; hands: string; wearHead: string; wearEyes: string; wearNeck: string }>;
  const color = m.color ?? "auto";
  return {
    color: (TINT_NAMES as string[]).includes(color) ? (color as GumTint) : "auto",
    hands: (m.hands ?? "always") as GumPrefs["hands"],
    wear: { head: (m.wearHead ?? "none") as HeadWear, eyes: (m.wearEyes ?? "none") as EyeWear, neck: (m.wearNeck ?? "none") as NeckWear },
  };
}

/** L'hôte « appli » du moteur. */
export const APP_GUM_ENV: GumEnv = {
  prefs,
  onPrefsChange: (fn) => settingsStore.onChange(fn),
  frameLoop,
  reducedMotion,
};

export class GumRenderer extends GumEngine {
  constructor(manifest?: MascotManifest) {
    super(manifest, APP_GUM_ENV);
  }
}
