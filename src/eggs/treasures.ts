// Le carnet des trésors : les surprises cachées qu'on peut découvrir.
//
// Chaque trésor a un id (gardé dans le réglage mascot.treasures quand il est
// trouvé), un nom (montré une fois trouvé) et un indice (montré avant, pour
// donner envie de chercher). La page Mascotte des réglages affiche le carnet.

export interface Treasure {
  id: string;
  name: string;
  hint: string;
  /** Une surprise du calendrier (réglage « Surprises : le calendrier seulement »). */
  seasonal?: boolean;
}

export const TREASURES: Treasure[] = [
  { id: "code-rain", name: "Pluie de code", hint: "Demandez-lui de se réveiller, dans le Lanceur." },
  { id: "retro", name: "Ondine 8 bits", hint: "Un vieux code de console, île ouverte." },
  { id: "split", name: "Deux gouttes", hint: "Cliquez sur Ondine. Encore. Et encore." },
  { id: "spin", name: "Le tournis", hint: "Tournez autour d'elle avec la souris." },
  { id: "snack", name: "Le goûter", hint: "Laissez la mini-île tranquille un bon moment." },
  { id: "barrel-roll", name: "Le tonneau", hint: "Une figure d'avion, dans le Lanceur." },
  { id: "answer", name: "La réponse", hint: "Demandez la réponse au Lanceur." },
  { id: "new-year", name: "Bonne année", hint: "Le premier jour de l'année.", seasonal: true },
  { id: "valentine", name: "Saint-Valentin", hint: "Un jour de cœur, en février.", seasonal: true },
  { id: "april-fool", name: "Poisson d'avril", hint: "Regardez bien son dos, au printemps.", seasonal: true },
  { id: "music-day", name: "Fête de la musique", hint: "Un jour de juin, avec de la musique.", seasonal: true },
  { id: "bastille", name: "14 Juillet", hint: "Un jour de fête, en été.", seasonal: true },
  { id: "halloween", name: "Halloween", hint: "Fin octobre, quelqu'un se déguise.", seasonal: true },
  { id: "snow", name: "Neige", hint: "En décembre, ouvrez l'île.", seasonal: true },
  { id: "rain", name: "Jour de pluie", hint: "Quand il pleut dehors (Météo allumée).", seasonal: true },
  { id: "heat", name: "Canicule", hint: "Quand il fait très chaud (Météo allumée).", seasonal: true },
];

export function treasure(id: string): Treasure | undefined {
  return TREASURES.find((t) => t.id === id);
}

/** Les trésors trouvés, dans l'ordre du carnet (les ids inconnus sont ignorés). */
export function found(ids: readonly string[]): Treasure[] {
  return TREASURES.filter((t) => ids.includes(t.id));
}
