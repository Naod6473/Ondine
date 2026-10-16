// Puissance 4 contre Ondine : la partie (Connect4Game, qui survit quand
// l'onglet se ferme) et sa vue dans l'onglet Jeux.
//
// Les jetons sont des gouttes qui tombent et rebondissent en gelée
// (jelly-drop.ts). Ondine, la vraie goutte de l'île (kit.ts → mascot.emote) :
//   - elle réfléchit (pensive) avant de jouer, ses yeux passent d'une colonne
//     à l'autre, puis se posent sur celle qu'elle va jouer, un instant avant
//     d'y lâcher sa goutte : la « triche du regard » (mascot.look-at) ;
//   - un sursaut quand vous menacez de gagner, un air malicieux quand elle
//     prépare un coup gagnant ;
//   - elle boude si elle perd, fait la fête si elle gagne.
// Le calcul du coup (connect4-logic.ts) est borné en positions : quelques
// dizaines de ms au plus, pendant qu'elle « réfléchit » de toute façon.
// Un appel ou une présentation : elle attend la fin pour jouer (kit.quiet).

import { el } from "../../island/dom";
import { setText } from "../../core/perf";
import { calmMode } from "../../mascot/mascot-state";
import { chooseMove, COLS, HUMAN, isWinningScore, newBoard, ONDINE, outcome, ROWS, drop, winningMoves, type Board, type Level, type Outcome, type Player } from "./connect4-logic";
import { fallInto, wobble } from "./jelly-drop";
import { levelPicker, resultLine, scoreLine } from "./parts";
import { quietText, type Kit } from "./kit";

type Change = { kind: "move"; row: number; col: number; who: Player } | { kind: "reset" } | { kind: "state" };

export class Connect4Game {
  board: Board = newBoard();
  turn: Player = HUMAN;
  result: Outcome = { state: 0, line: [] };
  level: Level;
  /** Qui commence la prochaine partie (chacun son tour). */
  private starter: Player = HUMAN;
  thinking = false;
  /** Les gouttes gagnées à la dernière partie (affichées à la fin). */
  gained = 0;
  /** Ce que la vue sait faire pour Ondine : trouver l'élément d'une colonne. */
  view: { colEl(col: number): Element | null } | null = null;
  private listeners = new Set<(c: Change) => void>();
  private timers: number[] = [];
  private offQuiet: () => void;

  constructor(private kit: Kit) {
    this.level = kit.level();
    // Pendant un appel, Ondine attend ; à la fin, elle reprend son tour.
    this.offQuiet = kit.quiet.onChange((r) => {
      this.changed({ kind: "state" });
      if (!r && this.turn === ONDINE && !this.result.state && !this.thinking) this.ondineTurn();
    });
  }

  onChange(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(c: Change) {
    for (const fn of this.listeners) fn(c);
  }

  /** Une nouvelle partie (au niveau choisi). */
  restart(level = this.level) {
    this.clearTimers();
    this.board = newBoard();
    this.result = { state: 0, line: [] };
    this.level = level;
    this.thinking = false;
    this.gained = 0;
    this.turn = this.starter;
    this.starter = this.starter === HUMAN ? ONDINE : HUMAN;
    this.changed({ kind: "reset" });
    if (this.turn === ONDINE) this.ondineTurn();
  }

  /** Personne n'a encore joué : on peut changer de niveau sans recommencer. */
  fresh(): boolean {
    return this.board.heights.every((h) => h === 0);
  }

  /** Vous jouez dans `col`. */
  play(col: number): boolean {
    if (this.turn !== HUMAN || this.result.state || this.thinking || this.kit.quiet.quiet()) return false;
    const row = drop(this.board, col, HUMAN);
    if (row < 0) return false;
    this.kit.sound("drop");
    this.changed({ kind: "move", row, col, who: HUMAN });
    if (this.finished()) return true;
    this.turn = ONDINE;
    // Vous menacez de gagner : elle sursaute.
    if (winningMoves(this.board, HUMAN).length) this.kit.emote("surprised");
    this.ondineTurn();
    return true;
  }

  private ondineTurn() {
    if (this.kit.quiet.quiet()) return; // elle jouera à la fin de l'appel
    this.thinking = true;
    this.changed({ kind: "state" });
    this.kit.emote("pensive");
    // Le coup est calculé tout de suite (borné : quelques dizaines de ms),
    // la réflexion d'Ondine est du théâtre autour.
    const choice = chooseMove(this.board, ONDINE, this.level);
    const calm = calmMode();
    const think = calm ? 500 : { easy: 650, normal: 950, hard: 1300 }[this.level] + Math.random() * 400;
    // Ses yeux passent sur deux colonnes, puis se posent sur la bonne.
    if (!calm) {
      for (const [at, k] of [[60, 0], [360, 1]] as const) {
        this.later(at, () => this.kit.lookAt(this.view?.colEl((choice.col + 2 + k * 3 + Math.floor(Math.random() * 2)) % COLS) ?? null));
      }
    }
    this.later(Math.max(120, think - 480), () => this.kit.lookAt(this.view?.colEl(choice.col) ?? null, true));
    this.later(think, () => {
      if (this.kit.quiet.quiet()) {
        this.thinking = false;
        this.changed({ kind: "state" });
        return; // reprise par offQuiet
      }
      this.thinking = false;
      const row = drop(this.board, choice.col, ONDINE);
      if (row < 0) return;
      this.kit.sound("drop");
      this.changed({ kind: "move", row, col: choice.col, who: ONDINE });
      if (this.finished()) return;
      this.turn = HUMAN;
      // Elle tient un coup gagnant (une menace, ou une victoire certaine) : sourire en coin.
      if (winningMoves(this.board, ONDINE).length || isWinningScore(choice.score)) this.kit.emote("mischief");
      else this.kit.emote("idle");
      this.changed({ kind: "state" });
    });
  }

  /** La partie est-elle finie ? Si oui : réactions, gouttes. */
  private finished(): boolean {
    this.result = outcome(this.board);
    if (!this.result.state) return false;
    const r = this.result.state;
    const mine = r === HUMAN ? "win" : r === ONDINE ? "lose" : "draw";
    this.kit.emote(mine === "win" ? "pout" : mine === "lose" ? "celebrate" : "shy", true);
    this.kit.sound(mine === "win" ? "win" : mine === "lose" ? "lose" : "draw");
    this.changed({ kind: "state" });
    void this.kit.store.result("connect4", mine, this.level).then((g) => {
      this.gained = g;
      if (g) this.kit.sound("coin");
      this.changed({ kind: "state" });
    });
    return true;
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  stop() {
    this.clearTimers();
    this.offQuiet();
    this.listeners.clear();
  }
}

/** Le texte de l'état de la partie. */
function statusOf(g: Connect4Game, kit: Kit): string {
  const r = g.result.state;
  if (r === HUMAN) return "Vous avez gagné !";
  if (r === ONDINE) return "Ondine a gagné";
  if (r === 3) return "Match nul";
  if (kit.quiet.quiet()) return quietText(kit.quiet.reason());
  if (g.thinking) return "Ondine réfléchit…";
  return g.turn === HUMAN ? "À vous de jouer" : "Au tour d'Ondine";
}

/** Monte la vue du Puissance 4 dans `root`. */
export function mountConnect4(root: HTMLElement, kit: Kit, game: Connect4Game): () => void {
  const board = el("div", { class: "c4-board", role: "grid", "aria-label": "Plateau du Puissance 4", tabindex: "0" });
  const cols: HTMLElement[] = [];
  const holes: HTMLElement[][] = [];
  let focusCol = 3;
  for (let c = 0; c < COLS; c++) {
    const col = el("button", { class: "c4-col", "aria-label": `Colonne ${c + 1}`, tabindex: "-1", onclick: kit.api.handler(() => game.play(c)) }, el("span", { class: "c4-ghost" }));
    const column: HTMLElement[] = [];
    // Les trous du bas vers le haut (rangée 0 = en bas), affichés de haut en bas.
    for (let r = 0; r < ROWS; r++) column.push(el("span", { class: "c4-hole" }));
    col.append(...[...column].reverse());
    cols.push(col);
    holes.push(column);
    board.append(col);
  }
  const status = el("div", { class: "games-status", "aria-live": "polite" });
  const score = el("div", { class: "games-score" });
  const gain = el("div", { class: "games-gain" });
  const again = el("button", { class: "btn small primary", onclick: kit.api.handler(() => game.restart()) }, "Nouvelle partie");
  const levels = levelPicker(game.level, (lv) => {
    // Personne n'a joué : le niveau change tout de suite ; sinon à la prochaine partie.
    if (game.fresh()) game.restart(lv);
    else game.level = lv;
  });
  root.append(
    el("div", { class: "c4", "data-island-fit": "" }, board, el("div", { class: "games-side" }, status, levels, el("div", { class: "btn-row" }, again), score, gain)),
  );

  const token = (who: Player) => el("span", { class: `c4-token ${who === HUMAN ? "me" : "ondine"}` });
  const stops: (() => void)[] = [];

  /** Tout le plateau, sans animation (ouverture de l'onglet, nouvelle partie). */
  const paint = () => {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const v = game.board.cells[r * COLS + c];
        holes[c][r].replaceChildren(...(v ? [token(v as Player)] : []));
      }
    }
    mark();
  };

  /** Les gouttes gagnantes brillent ; le texte, le score, les colonnes jouables. */
  const mark = () => {
    const line = new Set(game.result.line);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) holes[c][r].firstElementChild?.classList.toggle("win", line.has(r * COLS + c));
      const playable = !game.result.state && game.turn === HUMAN && !game.thinking && game.board.heights[c] < ROWS && !kit.quiet.quiet();
      cols[c].classList.toggle("off", !playable);
    }
    board.classList.toggle("waiting", game.thinking);
    root.classList.toggle("paused", kit.quiet.quiet());
    setText(status, statusOf(game, kit));
    setText(score, scoreLine(kit.store.state.stats.connect4));
    gain.replaceChildren(...resultLine(game.result.state ? game.gained : 0));
  };

  stops.push(
    game.onChange((ch) => {
      if (ch.kind === "reset") return paint();
      if (ch.kind === "move") {
        const hole = holes[ch.col][ch.row];
        const t = token(ch.who);
        hole.replaceChildren(t);
        // Elle tombe du haut du plateau jusqu'à son trou.
        const fall = (ROWS - ch.row) * (hole.offsetHeight + 4);
        stops.push(fallInto(t, fall, (impact) => impact > 200 && kit.sound("land")));
      }
      mark();
    }),
    kit.store.onChange(() => mark()),
  );
  game.view = { colEl: (c) => (cols[c]?.isConnected ? cols[c] : null) };

  // Clavier : ← → choisissent la colonne, Entrée (ou ↓, Espace) lâche la goutte, 1 à 7 directement.
  board.addEventListener(
    "keydown",
    kit.api.handler((e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= COLS) return void game.play(n - 1);
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") focusCol = (focusCol + (e.key === "ArrowLeft" ? COLS - 1 : 1)) % COLS;
      else if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") game.play(focusCol);
      else return;
      e.preventDefault();
      cols.forEach((c, i) => c.classList.toggle("kbd", i === focusCol));
    }),
  );
  paint();
  wobble(board, 0.4);
  return () => {
    for (const s of stops) s();
    game.view = null;
  };
}
