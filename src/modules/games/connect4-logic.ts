// Puissance 4 contre Ondine : la logique pure (sans DOM), testée par
// tests/front/games.test.ts.
//
// Le plateau : 7 colonnes × 6 rangées, une case = 0 (vide), 1 (vous) ou
// 2 (Ondine). Les cases sont rangées de bas en haut : index = rangée × 7 +
// colonne, rangée 0 en bas. Un jeton « tombe » donc dans la première rangée
// libre de sa colonne (`heights`).
//
// L'adversaire : une recherche alpha-bêta (negamax) qui regarde quelques
// coups à l'avance, avec une évaluation des fenêtres de 4 cases. Trois niveaux :
//   - Facile : un coup d'avance (elle voit ses victoires immédiates, pas les
//     vôtres), et un coup au hasard une fois sur trois ;
//   - Normal : 4 coups d'avance, rarement un coup au hasard (jamais quand il
//     y a une victoire à prendre ou à empêcher) ;
//   - Malin : de plus en plus profond (approfondissement itératif) tant que
//     le budget de positions n'est pas épuisé.
// Le budget (nombre de positions examinées) borne le temps de calcul : la
// recherche ne bloque jamais l'interface plus de quelques dizaines de ms,
// et elle est déterministe (même plateau, même hasard → même coup).

export const COLS = 7;
export const ROWS = 6;
export type Cell = 0 | 1 | 2;
export type Player = 1 | 2;
export type Level = "easy" | "normal" | "hard";

/** Vous jouez les jetons 1, Ondine les 2. */
export const HUMAN: Player = 1;
export const ONDINE: Player = 2;

export interface Board {
  cells: Cell[];
  /** Le nombre de jetons de chaque colonne (la rangée où tombera le prochain). */
  heights: number[];
}

/** Un hasard de 0 à 1 (Math.random par défaut ; un tirage fixe dans les tests). */
export type Rng = () => number;

export function newBoard(): Board {
  return { cells: new Array<Cell>(COLS * ROWS).fill(0), heights: new Array<number>(COLS).fill(0) };
}

export function cloneBoard(b: Board): Board {
  return { cells: b.cells.slice(), heights: b.heights.slice() };
}

export const at = (row: number, col: number) => row * COLS + col;

export function canPlay(b: Board, col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < COLS && b.heights[col] < ROWS;
}

/** Les colonnes jouables, du centre vers les bords (les meilleurs coups d'abord). */
const ORDER = [3, 2, 4, 1, 5, 0, 6];
export function legalMoves(b: Board): number[] {
  return ORDER.filter((c) => b.heights[c] < ROWS);
}

/** Pose un jeton (sur place) ; renvoie sa rangée, ou -1 si la colonne est pleine. */
export function drop(b: Board, col: number, who: Player): number {
  if (!canPlay(b, col)) return -1;
  const row = b.heights[col]++;
  b.cells[at(row, col)] = who;
  return row;
}

/** Retire le dernier jeton d'une colonne (la recherche joue puis défait). */
function undo(b: Board, col: number) {
  const row = --b.heights[col];
  b.cells[at(row, col)] = 0;
}

const DIRS: [number, number][] = [
  [0, 1], // horizontale
  [1, 0], // verticale
  [1, 1], // diagonale montante
  [1, -1], // diagonale descendante
];

/**
 * Les 4 cases (ou plus) alignées passant par (row, col), si le jeton qui s'y
 * trouve gagne ; sinon null.
 */
export function winLineAt(b: Board, row: number, col: number): number[] | null {
  const who = b.cells[at(row, col)];
  if (!who) return null;
  for (const [dr, dc] of DIRS) {
    const line = [at(row, col)];
    for (const s of [1, -1]) {
      let r = row + dr * s;
      let c = col + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && b.cells[at(r, c)] === who) {
        line.push(at(r, c));
        r += dr * s;
        c += dc * s;
      }
    }
    if (line.length >= 4) return line.sort((x, y) => x - y);
  }
  return null;
}

/** Le jeton qui vient de tomber dans `col` gagne-t-il ? */
function wonAt(b: Board, col: number): boolean {
  return winLineAt(b, b.heights[col] - 1, col) !== null;
}

export interface Outcome {
  /** 0 : la partie continue ; 1 ou 2 : ce joueur a gagné ; 3 : match nul. */
  state: 0 | Player | 3;
  /** Les cases gagnantes (vide sinon). */
  line: number[];
}

/** Où en est la partie (on regarde tout le plateau). */
export function outcome(b: Board): Outcome {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const line = winLineAt(b, row, col);
      if (line) return { state: b.cells[at(row, col)] as Player, line };
    }
  }
  return { state: b.heights.every((h) => h >= ROWS) ? 3 : 0, line: [] };
}

/** Les colonnes où `who` gagnerait tout de suite (ses « menaces »). */
export function winningMoves(b: Board, who: Player): number[] {
  const out: number[] = [];
  for (const c of legalMoves(b)) {
    drop(b, c, who);
    if (wonAt(b, c)) out.push(c);
    undo(b, c);
  }
  return out;
}

// ── L'évaluation ─────────────────────────────────────────────────────────────

/** Toutes les fenêtres de 4 cases alignées (69 au Puissance 4), calculées une fois. */
const WINDOWS: number[][] = (() => {
  const out: number[][] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      for (const [dr, dc] of DIRS) {
        const endR = row + dr * 3;
        const endC = col + dc * 3;
        if (endR < 0 || endR >= ROWS || endC < 0 || endC >= COLS) continue;
        out.push([0, 1, 2, 3].map((k) => at(row + dr * k, col + dc * k)));
      }
    }
  }
  return out;
})();

/** Les cases du centre valent un peu plus (plus de lignes passent par elles). */
const CENTER_WEIGHT = [0, 1, 2, 3, 2, 1, 0];

/** Le plateau vu par `who` : positif s'il est bien placé. */
export function evaluate(b: Board, who: Player): number {
  const other: Player = who === 1 ? 2 : 1;
  let score = 0;
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      if (b.cells[i] === who) mine++;
      else if (b.cells[i] === other) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 50;
    else if (mine === 2) score += 6;
    else if (mine === 1) score += 1;
    if (theirs === 3) score -= 60;
    else if (theirs === 2) score -= 6;
    else if (theirs === 1) score -= 1;
  }
  for (let i = 0; i < b.cells.length; i++) {
    const v = b.cells[i];
    if (!v) continue;
    score += (v === who ? 3 : -3) * CENTER_WEIGHT[i % COLS];
  }
  return score;
}

// ── La recherche ─────────────────────────────────────────────────────────────

const WIN = 1_000_000;

class OutOfBudget extends Error {}

interface Search {
  nodes: number;
  budget: number;
}

/** Negamax avec élagage alpha-bêta. Le score est vu par `who` (qui va jouer). */
function negamax(b: Board, who: Player, depth: number, alpha: number, beta: number, s: Search, ply: number): number {
  if (++s.nodes > s.budget) throw new OutOfBudget();
  const moves = legalMoves(b);
  if (!moves.length) return 0;
  // Une victoire immédiate : on la prend (plus tôt = mieux).
  for (const c of moves) {
    drop(b, c, who);
    const won = wonAt(b, c);
    undo(b, c);
    if (won) return WIN - ply;
  }
  if (depth <= 0) return evaluate(b, who);
  const other: Player = who === 1 ? 2 : 1;
  let best = -Infinity;
  for (const c of moves) {
    drop(b, c, who);
    const v = -negamax(b, other, depth - 1, -beta, -alpha, s, ply + 1);
    undo(b, c);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Le meilleur coup à une profondeur donnée (et son score). */
function bestAt(b: Board, who: Player, depth: number, s: Search, first: number | null): { col: number; score: number } {
  const other: Player = who === 1 ? 2 : 1;
  // Le meilleur coup de la profondeur précédente d'abord : il fait couper plus tôt.
  const moves = legalMoves(b);
  if (first !== null && moves.includes(first)) {
    moves.splice(moves.indexOf(first), 1);
    moves.unshift(first);
  }
  let best = { col: moves[0], score: -Infinity };
  let alpha = -Infinity;
  for (const c of moves) {
    drop(b, c, who);
    const v = wonAt(b, c) ? WIN : -negamax(b, other, depth - 1, -Infinity, -alpha, s, 1);
    undo(b, c);
    if (v > best.score) best = { col: c, score: v };
    if (v > alpha) alpha = v;
  }
  return best;
}

/** La profondeur et le budget de positions de chaque niveau. */
export const LEVELS: Record<Level, { depth: number; budget: number; random: number }> = {
  easy: { depth: 1, budget: 2_000, random: 0.34 },
  normal: { depth: 4, budget: 20_000, random: 0.08 },
  // ~150 000 positions : quelques dizaines de ms dans WebView2.
  hard: { depth: 12, budget: 150_000, random: 0 },
};

export interface Choice {
  col: number;
  /** Le score de la recherche (vu par Ondine) ; NaN pour un coup au hasard. */
  score: number;
  /** La profondeur atteinte. */
  depth: number;
  nodes: number;
}

/**
 * Le coup de `who` au niveau `level`. Le plateau n'est pas modifié.
 * Renvoie -1 seulement si plus rien n'est jouable.
 */
export function chooseMove(board: Board, who: Player, level: Level, rng: Rng = Math.random): Choice {
  const b = cloneBoard(board);
  const moves = legalMoves(b);
  if (!moves.length) return { col: -1, score: 0, depth: 0, nodes: 0 };
  const cfg = LEVELS[level] ?? LEVELS.normal;
  const other: Player = who === 1 ? 2 : 1;
  // Un coup au hasard (Facile, parfois Normal) : jamais quand il y a une
  // victoire à prendre ; en Normal, jamais non plus quand il faut bloquer.
  const mustAct = winningMoves(b, who).length > 0 || (level !== "easy" && winningMoves(b, other).length > 0);
  if (cfg.random > 0 && !mustAct && rng() < cfg.random) {
    return { col: moves[Math.floor(rng() * moves.length) % moves.length], score: Number.NaN, depth: 0, nodes: 0 };
  }
  const s: Search = { nodes: 0, budget: cfg.budget };
  let best: { col: number; score: number } | null = null;
  let depth = 0;
  for (let d = 1; d <= cfg.depth; d++) {
    try {
      best = bestAt(b, who, d, s, best?.col ?? null);
      depth = d;
    } catch (e) {
      if (!(e instanceof OutOfBudget)) throw e;
      break; // budget épuisé : on garde la profondeur précédente
    }
    // Une victoire (ou une défaite) certaine : inutile de chercher plus loin.
    if (Math.abs(best.score) >= WIN - 100) break;
  }
  // Toujours un coup (même un budget minuscule laisse au moins la profondeur 1).
  if (!best) best = { col: moves[0], score: 0 };
  // À égalité, un peu de variété : parmi les coups qui valent autant à la
  // profondeur 1, le hasard départage (sinon Ondine ouvrirait toujours pareil).
  if (b.cells.every((c) => c === 0) && level !== "hard") best = { col: [2, 3, 3, 4][Math.floor(rng() * 4) % 4], score: best.score };
  return { col: best.col, score: best.score, depth, nodes: s.nodes };
}

/** Le score indique-t-il une victoire certaine d'Ondine (elle sourit en coin) ? */
export function isWinningScore(score: number): boolean {
  return score >= WIN - 100;
}
