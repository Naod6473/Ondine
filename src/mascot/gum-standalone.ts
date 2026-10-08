// La famille gomme hors de l'appli : un petit script autonome pour le site
// (site/index.html), construit par `npm run build:site` (vite.site.config.ts)
// en un seul fichier, site/media/ondine-gomme.js, qui est committé (le site est
// statique, rien n'est construit sur GitHub Pages).
//
//   OndineGomme.mount(canvas, { shape: "etoile", anim: "idle", color: "auto" })
//     → { play(name), pause(on), destroy() }
//   OndineGomme.MASCOTS : les quinze (id, nom, forme) ; OndineGomme.GESTURES.
//
// Rien d'ici ne touche aux réglages, à Tauri ni à core/perf.ts : le moteur
// (renderers/gum-engine.ts) reçoit un hôte fait de paramètres et de
// requestAnimationFrame. Le test tests/front/whats-new.test.ts vérifie que ce
// fichier n'entraîne aucun module de l'appli.

import manifest from "../../mascots/goutte-gomme/manifest.json";
import { GUM_FAMILY } from "./gum-family";
import { TINT_NAMES, type GumTint } from "./renderers/gum-draw";
import { GumEngine, GUM_PREFS_DEFAULT, type GumEnv, type GumPrefs } from "./renderers/gum-engine";
import type { AnimationSpec, MascotManifest } from "./types";

export interface MountOptions {
  /** La forme (gum-shapes.ts : goutte, guimauve, etoile…), ou "ciel" / "meteo". Défaut : goutte. */
  shape?: string;
  /** L'animation de départ (gum-anims.ts). Défaut : idle. */
  anim?: string;
  /** La couleur (gum-draw.ts : blue, pink, rainbow…), ou "auto" = celle de la forme. */
  color?: string;
  /** Les moufles : toujours, pour les gestes seulement, jamais. Défaut : toujours. */
  hands?: GumPrefs["hands"];
  /** Tout droit à sa cible, sans ressorts (défaut : le réglage du navigateur, prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Images par seconde au plus (défaut : le rythme de l'écran). */
  maxFps?: number;
}

export interface Mounted {
  /** Joue une animation ; une animation non bouclée revient ensuite à idle. */
  play(name: string): void;
  /** En pause : plus rien n'est dessiné (mascotte hors de l'écran). */
  pause(on: boolean): void;
  destroy(): void;
}

/** Les animations connues de la goutte gomme (durée et boucle), par nom. */
const SPECS = new Map<string, AnimationSpec>((manifest as MascotManifest).animations.map((a) => [a.name, a]));

/** La fiche d'une animation : celle du manifeste, sinon 2,5 s sans boucle. */
export function animSpec(name: string): AnimationSpec {
  return SPECS.get(name) ?? { name, source: { function: name }, durationMs: 2500, loop: false, priority: 0, transitionsTo: ["*"] };
}

/** Une boucle requestAnimationFrame, avec pause et plafond d'images par seconde. */
function makeLoop(maxFps: number | undefined, paused: () => boolean): GumEnv["frameLoop"] {
  return (target, draw) => {
    let raf = 0;
    let stopped = false;
    let last = 0;
    // La première image est toujours dessinée, même en pause (une mascotte
    // hors de l'écran au chargement ne doit pas rester vide quand on y arrive),
    // et de nouveau après un changement de taille (qui efface le canvas).
    let drawn = false;
    const sizes = new ResizeObserver(() => (drawn = false));
    sizes.observe(target);
    const minGap = maxFps ? 1000 / maxFps : 0;
    const tick = (now: number) => {
      raf = 0;
      if (stopped) return;
      if ((!paused() || !drawn) && now - last >= minGap - 1) {
        last = now;
        drawn = true;
        draw(performance.now());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      sizes.disconnect();
      cancelAnimationFrame(raf);
    };
  };
}

/** Dessine une mascotte en gomme dans `canvas` (ou dans un élément qui en recevra un). */
export function mount(canvas: HTMLElement, opts: MountOptions = {}): Mounted {
  const color = opts.color ?? "auto";
  const prefs: GumPrefs = {
    ...GUM_PREFS_DEFAULT,
    color: (TINT_NAMES as string[]).includes(color) ? (color as GumTint) : "auto",
    hands: opts.hands ?? "always",
  };
  let paused = false;
  const calm = opts.reducedMotion ?? (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const env: GumEnv = {
    prefs: () => prefs,
    onPrefsChange: () => () => {},
    frameLoop: makeLoop(opts.maxFps, () => paused),
    reducedMotion: () => calm,
  };
  const engine = new GumEngine({ ...(manifest as MascotManifest), gum: { shape: opts.shape ?? "goutte" } }, env);
  engine.mount(canvas);
  engine.onAnimationEnd(() => engine.play(animSpec("idle")));
  engine.play(animSpec(opts.anim ?? "idle"));
  return {
    play: (name) => engine.play(animSpec(name)),
    pause: (on) => (paused = on),
    destroy: () => engine.destroy(),
  };
}

/** Les quinze mascottes : id, nom, forme (la goutte gomme, puis ses cousines). */
export const MASCOTS = [{ id: "goutte-gomme", name: "Goutte gomme", shape: "goutte" }, ...GUM_FAMILY];

/** Les gestes que le site joue au survol. */
export const GESTURES = ["coucou", "rire", "danse"];

