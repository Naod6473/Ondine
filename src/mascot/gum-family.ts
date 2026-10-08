// La famille « gomme » : la goutte gomme (mascots/goutte-gomme) et ses cousines,
// des bonbons de toutes les formes. Elles partagent tout (les animations du
// manifeste de la goutte gomme, le moteur « gum ») sauf leur forme : au lieu
// de recopier quinze fois le même manifeste, le catalogue (catalog.ts) les
// fabrique à partir de cette liste.

import type { MascotManifest } from "./types";

export interface GumCousin {
  id: string;
  name: string;
  /** La forme (gum-shapes.ts), ou "ciel" / "meteo" qui changent toutes seules. */
  shape: string;
}

export const GUM_FAMILY: GumCousin[] = [
  { id: "gomme-guimauve", name: "Guimauve (gomme carrée)", shape: "guimauve" },
  { id: "gomme-dragee", name: "Dragée (gomme ovale)", shape: "dragee" },
  { id: "gomme-berlingot", name: "Berlingot (gomme triangulaire)", shape: "berlingot" },
  { id: "gomme-etoile", name: "Étoile", shape: "etoile" },
  { id: "gomme-soleil", name: "Soleil", shape: "soleil" },
  { id: "gomme-lune", name: "Lune", shape: "lune" },
  { id: "gomme-nuage", name: "Nuage", shape: "nuage" },
  { id: "gomme-coeur", name: "Cœur", shape: "coeur" },
  { id: "gomme-fleur", name: "Fleur", shape: "fleur" },
  { id: "gomme-champignon", name: "Champignon", shape: "champignon" },
  { id: "gomme-fantome", name: "Fantôme", shape: "fantome" },
  { id: "gomme-flamme", name: "Flamme", shape: "flamme" },
  { id: "gomme-ciel", name: "Ciel (soleil le jour, lune la nuit)", shape: "ciel" },
  { id: "gomme-meteo", name: "Météo (suit le temps qu'il fait)", shape: "meteo" },
];

/** Le manifeste d'une cousine : celui de la goutte gomme, avec son id, son nom et sa forme. */
export function cousinManifest(base: MascotManifest, c: GumCousin): MascotManifest {
  return { ...base, id: c.id, name: c.name, gum: { shape: c.shape } };
}
