// Les mascottes NOUVELLES d'une version : celles que le panneau « Quoi de
// neuf » (src/island/whats-new-panel.ts) montre en carrousel, animées, avec
// « Adopter ». Une version sans entrée ici (ou avec une liste vide) a un
// « Quoi de neuf » en texte seul, comme avant.
//
// Rien que des données ici (pas de fenêtre) : tests/front/whats-new.test.ts.

import { GUM_FAMILY } from "../mascot/gum-family";

/** Version → ids des mascottes à présenter (toutes connues du catalogue). */
export const NEW_MASCOTS: Record<string, string[]> = {
  // 1.2.0 : toute la famille gomme, sauf la goutte gomme qui existait déjà.
  "1.2.0": GUM_FAMILY.map((c) => c.id),
};

/** « v1.2.0 », « 1.2.0-beta.2 » et « 1.2.0+3 » comptent comme 1.2.0. */
export function baseVersion(version: string): string {
  const m = /^v?(\d+\.\d+(?:\.\d+)?)/.exec(version.trim());
  return m ? m[1] : "";
}

/** Les mascottes nouvelles de `version` (vide si rien à montrer). */
export function newMascotsFor(version: string): string[] {
  return NEW_MASCOTS[baseVersion(version)] ?? [];
}

/** Le nom court d'une mascotte : « Guimauve (gomme carrée) » → « Guimauve ». */
export function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim();
}
