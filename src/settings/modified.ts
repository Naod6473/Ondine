// La pastille « Modifié » des Réglages (1.2.4) : un réglage différent de sa
// valeur d'origine le dit, avec « Réinitialiser » à côté. Logique pure, sans
// DOM, testée dans tests/front/settings-undo.test.ts ; main.ts pose les
// pastilles sur les lignes.
//
// La valeur d'origine :
//   - d'un champ de module : son `default` dans le manifeste (la ligne porte
//     `data-field="<module>.<clé>"`, posé par main.ts) ;
//   - d'une ligne des pages de l'île (codées dans main.ts) : defaultSettings()
//     (src/core/types.ts), au chemin donné ci-dessous pour sa clé (`data-key`).

import { defaultSettings } from "../core/types";
import { sameValue } from "./presets";

/**
 * Les lignes des pages de l'île : page → clé de la ligne (son libellé) → les
 * chemins des réglages qu'elle change. Plusieurs chemins : la ligne les
 * change ensemble (« Bord de l'écran » recentre aussi l'île). Les textes
 * libres (le prénom) et les listes gérées ailleurs n'y sont pas.
 */
export const ISLAND_PATHS: Record<string, Record<string, string[]>> = {
  general: {
    Langue: ["general.language"],
    "S'adresser à moi": ["general.address"],
    "Lancer avec Windows": ["general.autostart"],
  },
  behavior: {
    "Sur quel écran ?": ["general.screen"],
    "Reflet sur les autres écrans": ["island.otherScreens"],
    "Toujours en mini": ["island.alwaysMini"],
    "Replier l'île": ["island.collapseSecs"],
    "Durée des notifications": ["island.notificationSecs"],
    "Raccourci pour ouvrir l'île": ["island.hotkey"],
    "Bord de l'écran": ["island.edge", "island.align", "island.offset"],
    "Ondine évite la fenêtre de réglages": ["island.avoidSettings"],
    "Mode présentation": ["island.presentationQuiet"],
  },
  look: {
    Thème: ["island.theme"],
    "Taille de la mini-île": ["island.size"],
    "Style de l'île": ["island.style"],
    "Quand Ondine est sortie": ["island.mouthFollow"],
    "Style des icônes": ["island.iconPack"],
    "Style des animations": ["island.motion"],
    "Élasticité de l'île": ["island.elasticity"],
    "Éclosion au démarrage": ["island.hatch"],
    "Sons de clic": ["island.sounds"],
    "Volume des sons": ["island.soundVolume"],
  },
  tabs: {
    "Astuces à la première ouverture d'un onglet": ["island.tips"],
    "Propositions d'Ondine": ["island.suggestions"],
  },
  mascot: {
    "Afficher la mascotte": ["mascot.enabled"],
    Taille: ["mascot.size"],
    "S'ennuie après": ["mascot.boredAfterSecs"],
    "S'endort après": ["mascot.sleepAfterSecs"],
    "Calme : moins de gestes spontanés": ["mascot.calm"],
    "Double-clic sur Ondine": ["mascot.doubleClick"],
    "Ondine vit sur le bureau": ["mascot.pet"],
    "Au-dessus des fenêtres": ["mascot.petOnTop"],
    "Raccourci pour ouvrir sa bulle": ["mascot.petHotkey"],
    "Elle se promène quand vous ne touchez plus au PC": ["mascot.petWander"],
    "Ondine vient pendre au bord": ["mascot.peek"],
    "Au plus une visite toutes les": ["mascot.peekEveryMins"],
    "Surprises cachées": ["mascot.surprises"],
    Couleur: ["mascot.color"],
    Mains: ["mascot.hands"],
    "Sur la tête": ["mascot.wearHead"],
    Lunettes: ["mascot.wearEyes"],
    "Au cou": ["mascot.wearNeck"],
  },
  perf: {
    Performances: ["general.perfMode"],
    "Économie d'énergie automatique sur batterie": ["general.ecoOnBattery"],
    "Niveau du journal": ["general.logLevel"],
  },
  updates: {
    "Mises à jour automatiques": ["general.autoUpdate"],
  },
  about: {
    "Mode démo": ["general.demo"],
  },
};

/** La valeur à un chemin (« island.motion ») ; undefined si un morceau manque. */
export function getPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const key of path.split(".")) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** Pose une valeur à un chemin (les objets du chemin sont créés au besoin). */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let at = obj;
  for (const key of keys.slice(0, -1)) {
    if (!at[key] || typeof at[key] !== "object") at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = structuredClone(value);
}

/** La valeur d'origine d'un réglage de l'île (defaultSettings). */
export function islandDefault(path: string): unknown {
  return getPath(defaultSettings(), path);
}

/**
 * Un réglage est-il modifié ? Une valeur absente (jamais enregistrée) vaut sa
 * valeur d'origine : la page l'affiche avec ce défaut.
 */
export function isModified(current: unknown, origin: unknown): boolean {
  return current !== undefined && !sameValue(current, origin);
}

/** Les réglages de l'île d'une ligne sont-ils modifiés (au moins un de ses chemins) ? */
export function islandRowModified(settings: unknown, paths: string[]): boolean {
  return paths.some((p) => isModified(getPath(settings, p), islandDefault(p)));
}
