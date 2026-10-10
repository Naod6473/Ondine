// Le mode Simple / Complet de la fenêtre de réglages : quels champs on montre.
//
// En mode Simple, chaque page ne montre que l'essentiel ; les autres champs
// sont cachés mais gardent leur place (rien ne bouge en passant en Complet).
// Ce fichier est la logique pure, sans DOM, pour être testée dans tests/front :
//   - les champs essentiels d'un module viennent de son manifeste
//     (`"essential": true` dans settings.fields) ;
//   - ceux des pages de l'île (Général, Apparence…), codées dans main.ts, sont
//     listés ici par la clé de leur ligne (`data-key` : le libellé).
// L'application au DOM est dans src/settings/mode.ts.

import type { SettingField } from "../core/module-types";

/** Le réglage `general.settingsMode`. */
export type SettingsMode = "simple" | "full";

/** Une page entière reste visible en mode Simple. */
export const WHOLE_PAGE = "*";

/**
 * Les lignes essentielles des pages de l'île, par id de page (clé = le
 * `data-key` de la ligne, c'est-à-dire son libellé). `WHOLE_PAGE` : la page
 * est courte ou n'est pas une liste de réglages (un éditeur, des boutons) et
 * reste entière. Une page absente d'ici est entière aussi.
 *
 * « Bord de l'écran » vit dans Général (bloc « L'île ») : on ne déplace rien,
 * il est donc essentiel là où il est.
 */
export const ISLAND_ESSENTIALS: Record<string, string[] | typeof WHOLE_PAGE> = {
  general: ["Langue", "S'adresser à moi", "Prénom", "Premiers pas", "Lancer avec Windows", "Bord de l'écran", "Mises à jour automatiques"],
  look: ["Thème", "Style des icônes"],
  // La liste des modules (ordre des onglets, sans onglet) est marquée dans le
  // DOM (data-essential) : ses clés sont les noms des modules.
  tabs: [],
  mascot: ["Afficher la mascotte", "Mascotte", "Couleur", "Roue de couleur", "Ondine vit sur le bureau"],
  rules: WHOLE_PAGE,
  profiles: ["Profil actif"],
  privacy: WHOLE_PAGE,
  credentials: WHOLE_PAGE,
  backup: WHOLE_PAGE,
};

/**
 * Les champs essentiels des modules dont on ne peut pas toucher le manifeste
 * (chantiers parallèles), par id de module et clé de champ. Le manifeste
 * (`essential: true`) reste la règle ; ceci n'est qu'un complément.
 */
export const MODULE_ESSENTIALS: Record<string, string[]> = {
  weekly: ["day", "time"],
};

/** Les lignes de la page d'un module toujours visibles (hors champs du manifeste). */
export const MODULE_PAGE_ESSENTIALS = ["Activé", "Permissions", "À propos"];

/** Un champ du manifeste est-il essentiel (montré en mode Simple) ? */
export function fieldIsEssential(moduleId: string, field: SettingField): boolean {
  return field.essential === true || (MODULE_ESSENTIALS[moduleId] ?? []).includes(field.key);
}

/** Les clés (`data-key` = libellé) des lignes essentielles de la page d'un module. */
export function moduleEssentialKeys(moduleId: string, fields: SettingField[]): string[] {
  return [...MODULE_PAGE_ESSENTIALS, ...fields.filter((f) => fieldIsEssential(moduleId, f)).map((f) => f.label)];
}

/** Les clés essentielles d'une page de l'île ; `WHOLE_PAGE` si elle reste entière. */
export function pageEssentials(pageId: string): string[] | typeof WHOLE_PAGE {
  return ISLAND_ESSENTIALS[pageId] ?? WHOLE_PAGE;
}

/**
 * Une ligne de clé `key` est-elle cachée ? `essentials` : les clés essentielles
 * de la page, ou `WHOLE_PAGE`. Une ligne sans clé (un message, un bouton
 * d'ajout) n'est jamais cachée seule : elle suit son bloc.
 */
export function isHidden(mode: SettingsMode, key: string, essentials: string[] | typeof WHOLE_PAGE): boolean {
  if (mode === "full" || essentials === WHOLE_PAGE || !key) return false;
  return !essentials.includes(key);
}

/** Les champs d'un module visibles dans ce mode (dans l'ordre du manifeste). */
export function visibleFields(mode: SettingsMode, moduleId: string, fields: SettingField[]): SettingField[] {
  return mode === "full" ? fields : fields.filter((f) => fieldIsEssential(moduleId, f));
}

/** Combien de lignes sont cachées dans ce mode. */
export function hiddenCount(mode: SettingsMode, keys: string[], essentials: string[] | typeof WHOLE_PAGE): number {
  return keys.filter((k) => isHidden(mode, k, essentials)).length;
}

/** « 3 réglages de plus en mode Complet » (ou « 1 réglage de plus… »). */
export function moreText(n: number): string {
  return `${n} réglage${n > 1 ? "s" : ""} de plus en mode Complet`;
}

/** Le mode, ramené à une valeur connue (défaut : Simple, aussi pour un réglage absent). */
export function modeOf(value: unknown): SettingsMode {
  return value === "full" ? "full" : "simple";
}
