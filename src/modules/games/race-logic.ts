// Course de gouttes : la logique pure (sans DOM), testée par
// tests/front/games.test.ts.
//
// Pendant qu'un agent IA travaille sur une liste de tâches (la barre « 3/7 »
// du module Agents IA, sujet « agents.todos »), quatre gouttes font la course.
// Vous pariez sur une couleur ; chaque tâche finie par l'agent fait avancer
// TOUTES les gouttes, chacune d'un pas tiré au hasard (en moyenne, le peloton
// suit la vraie progression de l'agent). Quand la liste est finie, la goutte
// la plus avancée gagne. Le pari ne coûte rien : une victoire rapporte des
// gouttes à l'aquarium (et une 2e place, un peu).

import type { Rng } from "./connect4-logic";

export const RACERS = [
  { id: "blue", name: "bleue", color: "#4da3ff" },
  { id: "pink", name: "rose", color: "#ff7eb6" },
  { id: "green", name: "verte", color: "#48d597" },
  { id: "amber", name: "dorée", color: "#ffc24b" },
] as const;

export type RacerId = (typeof RACERS)[number]["id"];

/** Une liste de tâches doit en avoir au moins autant pour lancer une course. */
export const MIN_TASKS = 3;
/** Avant l'arrivée, aucune goutte ne dépasse ce point (la ligne est pour la fin). */
const BEFORE_LINE = 0.96;

export interface Race {
  session: string;
  total: number;
  done: number;
  /** Position de chaque goutte (0 = départ, 1 = arrivée), dans l'ordre de RACERS. */
  pos: number[];
  bet: RacerId | null;
  finished: boolean;
  /** Le classement à l'arrivée (ids, du premier au dernier) ; vide avant. */
  ranking: RacerId[];
}

/** Une liste qui vaut une course : assez de tâches, et au moins deux qui restent. */
export function raceWorthy(done: number, total: number): boolean {
  return Number.isFinite(total) && total >= MIN_TASKS && total - done >= 2;
}

export function newRace(session: string, done: number, total: number): Race {
  // Les gouttes partent ensemble, à la hauteur déjà faite par l'agent.
  const start = total > 0 ? Math.min(BEFORE_LINE, Math.max(0, done) / total) : 0;
  return { session, total, done: Math.max(0, done), pos: RACERS.map(() => start), bet: null, finished: false, ranking: [] };
}

/**
 * L'agent en est à `done` / `total` : chaque tâche finie depuis la dernière
 * fois fait avancer chaque goutte d'un pas au hasard (0,3 à 1,7 fois la part
 * d'une tâche). Une liste qui grandit en route allonge la course. Toutes les
 * tâches faites : l'arrivée (classement). Renvoie la course mise à jour
 * (nouvel objet ; celle donnée n'est pas modifiée).
 */
export function advance(race: Race, done: number, total: number, rng: Rng = Math.random): Race {
  if (race.finished) return race;
  const r: Race = { ...race, pos: race.pos.slice(), ranking: [] };
  if (Number.isFinite(total) && total > r.total) r.total = Math.round(total);
  const target = Math.max(0, Math.min(r.total, Math.round(done)));
  while (r.done < target) {
    r.done++;
    const share = 1 / r.total;
    r.pos = r.pos.map((p) => Math.min(BEFORE_LINE, p + share * (0.3 + rng() * 1.4)));
  }
  if (r.done >= r.total) return finish(r);
  return r;
}

/** L'arrivée : la plus avancée gagne (à égalité, le hasard du dernier pas décide déjà). */
export function finish(race: Race): Race {
  const order = RACERS.map((x, i) => ({ id: x.id as RacerId, p: race.pos[i], i })).sort((a, b) => b.p - a.p || a.i - b.i);
  const pos = race.pos.slice();
  // La gagnante franchit la ligne, les autres restent où elles sont.
  pos[order[0].i] = 1;
  return { ...race, pos, finished: true, ranking: order.map((o) => o.id) };
}

/** Le résultat de votre pari : « win » (1re), « second », « lose » ; null sans pari ou avant l'arrivée. */
export function betResult(race: Race): "win" | "second" | "lose" | null {
  if (!race.finished || !race.bet) return null;
  const rank = race.ranking.indexOf(race.bet);
  return rank === 0 ? "win" : rank === 1 ? "second" : "lose";
}

/** Le classement en cours (ids, de la plus avancée à la dernière). */
export function standings(race: Race): RacerId[] {
  if (race.finished) return race.ranking;
  return RACERS.map((x, i) => ({ id: x.id as RacerId, p: race.pos[i], i }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((o) => o.id);
}

export function racerOf(id: RacerId) {
  return RACERS.find((r) => r.id === id) ?? RACERS[0];
}
