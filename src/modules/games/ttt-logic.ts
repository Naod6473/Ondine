// Morpion express contre Ondine : la logique pure (sans DOM), testée par
// tests/front/games.test.ts.
//
// 9 cases (0 à 8, de gauche à droite puis de haut en bas), 0 = vide,
// 1 = vous (✕), 2 = Ondine (○). Vous commencez.
//
// Ondine cherche le meilleur coup jusqu'au bout de la partie (minimax : le
// morpion n'a que quelques milliers de parties possibles) :
//   - Malin : toujours le meilleur coup : imbattable (au mieux, match nul) ;
//   - Normal : une erreur de temps en temps (un coup au hasard, une fois sur 5) ;
//   - Facile : souvent distraite (un coup au hasard, presque une fois sur 2).
// Une victoire à prendre est toujours prise, même en Facile.

import type { Level, Player, Rng } from "./connect4-logic";

export type TttCell = 0 | 1 | 2;

export const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** La part de coups au hasard de chaque niveau. */
export const TTT_MISTAKES: Record<Level, number> = { easy: 0.45, normal: 0.2, hard: 0 };

export function newGrid(): TttCell[] {
  return new Array<TttCell>(9).fill(0);
}

export interface TttOutcome {
  /** 0 : la partie continue ; 1 ou 2 : ce joueur a gagné ; 3 : match nul. */
  state: 0 | Player | 3;
  line: number[];
}

export function tttOutcome(g: TttCell[]): TttOutcome {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (g[a] && g[a] === g[b] && g[a] === g[c]) return { state: g[a] as Player, line };
  }
  return { state: g.every((c) => c !== 0) ? 3 : 0, line: [] };
}

export function freeCells(g: TttCell[]): number[] {
  return g.flatMap((c, i) => (c === 0 ? [i] : []));
}

/** Score de la position pour `who` qui va jouer : +10 gagné, −10 perdu, 0 nul (plus tôt = plus fort). */
function minimax(g: TttCell[], who: Player, depth: number): number {
  const o = tttOutcome(g);
  if (o.state === 3) return 0;
  if (o.state) return o.state === who ? 10 - depth : depth - 10;
  const other: Player = who === 1 ? 2 : 1;
  let best = -Infinity;
  for (const i of freeCells(g)) {
    g[i] = who;
    best = Math.max(best, -minimax(g, other, depth + 1));
    g[i] = 0;
    if (best >= 10 - depth - 1) break; // on ne trouvera pas mieux qu'une victoire au coup suivant
  }
  return best;
}

/** Les meilleurs coups de `who` (tous ceux qui valent le meilleur score). */
export function bestCells(grid: TttCell[], who: Player): number[] {
  const g = grid.slice();
  const other: Player = who === 1 ? 2 : 1;
  let best = -Infinity;
  let out: number[] = [];
  for (const i of freeCells(g)) {
    g[i] = who;
    const o = tttOutcome(g);
    const v = o.state === who ? 10 : o.state === 3 ? 0 : -minimax(g, other, 1);
    g[i] = 0;
    if (v > best) {
      best = v;
      out = [i];
    } else if (v === best) out.push(i);
  }
  return out;
}

/** Le coup d'Ondine (`who`) au niveau donné ; -1 si la grille est pleine. */
export function tttMove(grid: TttCell[], who: Player, level: Level, rng: Rng = Math.random): number {
  const free = freeCells(grid);
  if (!free.length) return -1;
  // Une victoire à prendre : toujours.
  for (const i of free) {
    const g = grid.slice();
    g[i] = who;
    if (tttOutcome(g).state === who) return i;
  }
  const mistake = TTT_MISTAKES[level] ?? TTT_MISTAKES.normal;
  if (mistake > 0 && rng() < mistake) return free[Math.floor(rng() * free.length) % free.length];
  const best = bestCells(grid, who);
  return best[Math.floor(rng() * best.length) % best.length];
}
