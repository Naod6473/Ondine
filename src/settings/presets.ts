// Les préréglages en un clic, en haut de certaines pages des Réglages (1.2.5).
// Un préréglage est un ensemble de valeurs posées d'un coup (un seul
// enregistrement, donc un seul « Annuler »). Logique pure, sans DOM, testée
// dans tests/front/settings-undo.test.ts ; main.ts dessine les boutons.
//
// Règle d'or (layout.ts) : un préréglage n'invente aucun réglage. Il ne touche
// que des champs qui existent déjà (manifeste du module, ou réglage de l'île),
// sous leur clé actuelle.

import type { SettingField } from "../core/module-types";

/** Un réglage visé : un champ de module, ou un chemin des réglages de l'île (« island.motion »). */
export type PresetTarget = { module: string; key: string } | { path: string };

export interface Preset {
  id: string;
  label: string;
  /** Une phrase sous les boutons, quand celui-ci est choisi. */
  help: string;
  values: { target: PresetTarget; value: unknown }[];
}

export interface PresetSet {
  /** La page qui montre ces préréglages (id de main.ts). */
  page: string;
  title: string;
  presets: Preset[];
}

/**
 * Animations et halos, « Calme » : ces moments-là se taisent (ceux qui
 * bougent souvent ou ne disent rien d'important) ; les autres gardent leur
 * valeur par défaut. Les agents, les minuteurs, les fichiers et les rendez-
 * vous restent : ce sont eux qui servent.
 */
export const CALM_OFF = [
  "sky",
  "music",
  "musicCover",
  "dance",
  "capsLock",
  "numLock",
  "clipboard",
  "clipText",
  "volumeKeys",
  "cpu",
  "wifi",
  "streak",
  "capture",
  "weather",
  "ondineWalk",
  "liquidMusic",
  "liquidNight",
  "liquidCpu",
  "liquidRain",
  "liquidNotify",
  "liquidAmbient",
  "liquidOndine",
];

/**
 * Les trois préréglages de la page Animations et halos, calculés depuis les
 * champs du module « halos » (son manifeste) : l'intensité du halo et chaque
 * moment oui/non.
 *   - Calme : halo discret, les moments de CALM_OFF coupés ;
 *   - Équilibré : les valeurs d'origine (celles du manifeste) ;
 *   - Tout animé : halo vif, tous les moments allumés.
 */
export function animationPresets(fields: SettingField[]): PresetSet {
  const intensity = fields.find((f) => f.key === "intensity");
  const moments = fields.filter((f) => f.type === "boolean");
  const target = (key: string): PresetTarget => ({ module: "halos", key });
  const build = (level: string | undefined, on: (f: SettingField) => unknown) => [
    ...(intensity && level !== undefined ? [{ target: target("intensity"), value: level }] : []),
    ...moments.map((f) => ({ target: target(f.key), value: on(f) })),
  ];
  const def = (f: SettingField) => ("default" in f ? f.default : undefined);
  return {
    page: "animations",
    title: "Préréglages",
    presets: [
      { id: "calm", label: "Calme", help: "Un halo discret, et seulement les moments qui vous servent : agents, minuteurs, fichiers, rendez-vous.", values: build("subtle", (f) => (CALM_OFF.includes(f.key) ? false : def(f))) },
      { id: "balanced", label: "Équilibré", help: "Les réglages d'origine d'Ondine.", values: build(intensity ? String(def(intensity)) : undefined, def) },
      { id: "lively", label: "Tout animé", help: "Un halo vif, et tous les moments allumés, même la musique et le ciel.", values: build("vivid", () => true) },
    ],
  };
}

/** Apparence : le mouvement de l'île (style des animations et élasticité). */
export const LOOK_PRESETS: PresetSet = {
  page: "look",
  title: "Préréglages",
  presets: [
    {
      id: "sober",
      label: "Sobre",
      help: "L'île se pose sans rebondir, les éléments arrivent simplement.",
      values: [
        { target: { path: "island.motion" }, value: "classic" },
        { target: { path: "island.elasticity" }, value: "soft" },
      ],
    },
    {
      id: "classic",
      label: "Classique",
      help: "Les réglages d'origine : un petit rebond, des animations sobres.",
      values: [
        { target: { path: "island.motion" }, value: "classic" },
        { target: { path: "island.elasticity" }, value: "normal" },
      ],
    },
    {
      id: "lively",
      label: "Expressif",
      help: "Façon vidéo de présentation, et une île en gelée.",
      values: [
        { target: { path: "island.motion" }, value: "studio" },
        { target: { path: "island.elasticity" }, value: "jelly" },
      ],
    },
  ],
};

/** Même valeur (les listes et objets comparés par leur contenu). */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Le préréglage qui correspond aux réglages actuels (`read` donne la valeur
 * d'un réglage visé), ou null : « Personnalisé ».
 */
export function activePreset(set: PresetSet, read: (target: PresetTarget) => unknown): string | null {
  return set.presets.find((p) => p.values.every((v) => sameValue(read(v.target), v.value)))?.id ?? null;
}
