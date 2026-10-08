// Le carnet des trésors : les surprises cachées qu'on peut découvrir.
//
// Chaque trésor a un id (gardé dans le réglage mascot.treasures quand il est
// trouvé), un nom (montré une fois trouvé) et un indice (montré avant, pour
// donner envie de chercher). La page Mascotte des réglages affiche le carnet.

export interface Treasure {
  id: string;
  name: string;
  hint: string;
  /** Une surprise du calendrier ou une réaction au PC (gardées avec « Surprises : sans les codes secrets »). */
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
  { id: "conductor", name: "Cheffe d'orchestre", hint: "Lancez trois agents IA en même temps.", seasonal: true },
  { id: "marathon", name: "Le marathon", hint: "Un agent IA qui travaille plus d'une heure.", seasonal: true },
  { id: "pyjama", name: "Pyjama", hint: "Ouvrez l'île au milieu de la nuit.", seasonal: true },
  { id: "cobweb", name: "Toile d'araignée", hint: "Oubliez de redémarrer le PC pendant une semaine.", seasonal: true },
  { id: "photographer", name: "Photographe", hint: "Prenez beaucoup, beaucoup de captures.", seasonal: true },
  { id: "friday", name: "Vendredi soir", hint: "En fin de semaine, en fin de journée.", seasonal: true },
  { id: "coffee", name: "Café du lundi", hint: "Un début de semaine, le matin.", seasonal: true },
  { id: "loud", name: "Trop fort !", hint: "Montez le son à fond.", seasonal: true },
  { id: "battery", name: "Ouf, branché", hint: "Une batterie presque vide, puis le chargeur.", seasonal: true },
  { id: "copycat", name: "Copié, copié", hint: "Copiez cinq fois la même chose.", seasonal: true },
  // Les séries de contributions GitHub (onglet Agents IA, identifiant GitHub renseigné).
  { id: "github-7", name: "Série GitHub : une semaine", hint: "Sept jours de contributions GitHub d'affilée.", seasonal: true },
  { id: "github-30", name: "Série GitHub : un mois", hint: "Trente jours de contributions GitHub d'affilée.", seasonal: true },
  { id: "github-100", name: "Série GitHub : cent jours", hint: "Cent jours de contributions GitHub d'affilée.", seasonal: true },
];

export function treasure(id: string): Treasure | undefined {
  return TREASURES.find((t) => t.id === id);
}

/** Les trésors trouvés, dans l'ordre du carnet (les ids inconnus sont ignorés). */
export function found(ids: readonly string[]): Treasure[] {
  return TREASURES.filter((t) => ids.includes(t.id));
}
