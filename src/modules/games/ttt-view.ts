// Morpion contre Ondine : la partie (TttGame) et sa grille, en deux tailles :
//   - dans l'onglet Jeux (pastille « Morpion ») ;
//   - « express », dans la mini-île : une alerte de l'île avec un contenu
//     dessiné ici (NotificationRequest.content), ouverte par un appui long sur
//     Ondine, le Lanceur (« morpion ») ou le bouton de l'onglet. La partie
//     s'arrête toute seule après 30 s sans jouer : une pause de 30 secondes,
//     pas un jeu qui reste ouvert.
// Vous jouez ✕ et commencez ; Ondine joue ○ (ttt-logic.ts). En Malin elle ne
// perd jamais ; en Facile elle se laisse distraire.

import { el } from "../../island/dom";
import { setText } from "../../core/perf";
import { calmMode } from "../../mascot/mascot-state";
import { newGrid, tttMove, tttOutcome, type TttCell, type TttOutcome } from "./ttt-logic";
import type { Level } from "./connect4-logic";
import { wobble } from "./jelly-drop";
import { levelPicker, resultLine, scoreLine } from "./parts";
import { quietText, type Kit } from "./kit";

/** Sans jouer pendant ce temps, le morpion express se range. */
export const EXPRESS_IDLE_MS = 30_000;

export class TttGame {
  grid: TttCell[] = newGrid();
  result: TttOutcome = { state: 0, line: [] };
  level: Level;
  thinking = false;
  gained = 0;
  /** Le dernier coup (pour le faire apparaître en « boing »). */
  last = -1;
  /** Le dernier moment où quelqu'un a joué (le morpion express se range après 30 s). */
  touched = Date.now();
  view: { cellEl(i: number): Element | null } | null = null;
  private listeners = new Set<() => void>();
  private timers: number[] = [];

  constructor(private kit: Kit) {
    this.level = kit.level();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  restart(level = this.level) {
    this.clearTimers();
    this.grid = newGrid();
    this.result = { state: 0, line: [] };
    this.level = level;
    this.thinking = false;
    this.gained = 0;
    this.last = -1;
    this.touched = Date.now();
    this.changed();
  }

  fresh(): boolean {
    return this.grid.every((c) => c === 0);
  }

  play(i: number): boolean {
    if (this.result.state || this.thinking || this.grid[i] !== 0 || this.kit.quiet.quiet()) return false;
    this.grid[i] = 1;
    this.last = i;
    this.touched = Date.now();
    this.kit.sound("tap");
    if (this.finished()) return true;
    this.thinking = true;
    this.changed();
    const move = tttMove(this.grid, 2, this.level);
    // Elle regarde la case qu'elle va prendre, puis la prend (vite : c'est express).
    const think = calmMode() ? 300 : 450 + Math.random() * 300;
    this.later(Math.max(60, think - 260), () => this.kit.lookAt(this.view?.cellEl(move) ?? null, true));
    this.later(think, () => {
      this.thinking = false;
      if (move < 0 || this.kit.quiet.quiet()) return this.changed();
      this.grid[move] = 2;
      this.last = move;
      this.touched = Date.now();
      this.kit.sound("land");
      if (!this.finished()) this.changed();
    });
    return true;
  }

  private finished(): boolean {
    this.result = tttOutcome(this.grid);
    if (!this.result.state) return false;
    const r = this.result.state;
    const mine = r === 1 ? "win" : r === 2 ? "lose" : "draw";
    this.kit.emote(mine === "win" ? "pout" : mine === "lose" ? "celebrate" : "wink", true);
    this.kit.sound(mine === "win" ? "win" : mine === "lose" ? "lose" : "draw");
    this.changed();
    void this.kit.store.result("ttt", mine, this.level).then((g) => {
      this.gained = g;
      if (g) this.kit.sound("coin");
      this.changed();
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
    this.listeners.clear();
  }
}

function statusOf(g: TttGame, kit: Kit): string {
  const r = g.result.state;
  if (r === 1) return "Vous avez gagné !";
  if (r === 2) return "Ondine a gagné";
  if (r === 3) return "Match nul";
  if (kit.quiet.quiet()) return quietText(kit.quiet.reason());
  return g.thinking ? "Ondine réfléchit…" : "À vous de jouer";
}

/**
 * Monte une grille de morpion. `mini` : la version de la mini-île (petite,
 * sans le choix du niveau, avec la barre des 30 secondes).
 */
export function mountTtt(root: HTMLElement, kit: Kit, game: TttGame, opts: { mini?: boolean; onExpress?: () => void } = {}): () => void {
  const grid = el("div", { class: `ttt-grid${opts.mini ? " mini" : ""}`, role: "grid", "aria-label": "Grille du morpion" });
  const cells: HTMLButtonElement[] = [];
  for (let i = 0; i < 9; i++) {
    const cell = el("button", { class: "ttt-cell", "aria-label": `Case ${i + 1}`, onclick: kit.api.handler(() => game.play(i)) });
    cells.push(cell);
    grid.append(cell);
  }
  const status = el("div", { class: "games-status", "aria-live": "polite" });
  const gain = el("div", { class: "games-gain" });
  const again = el("button", { class: "btn small primary", onclick: kit.api.handler(() => game.restart()) }, "Rejouer");
  const side = el("div", { class: "games-side" }, status);
  const timer = el("div", { class: "ttt-timer" }, el("i"));
  const score = el("div", { class: "games-score" });
  if (opts.mini) {
    side.append(el("div", { class: "btn-row" }, again), timer, gain);
  } else {
    const levels = levelPicker(game.level, (lv) => (game.fresh() ? game.restart(lv) : void (game.level = lv)));
    const express = opts.onExpress ? el("button", { class: "btn small", title: "Une partie rapide dans la mini-île", onclick: kit.api.handler(opts.onExpress) }, "Dans la mini-île") : null;
    side.append(levels, el("div", { class: "btn-row" }, again, express), score, gain);
  }
  root.append(el("div", { class: `ttt${opts.mini ? " ttt-mini" : ""}`, "data-island-fit": opts.mini ? undefined : "" }, grid, side));

  let shownLast = -2;
  const paint = () => {
    const line = new Set(game.result.line);
    cells.forEach((cell, i) => {
      const v = game.grid[i];
      const sign = v === 1 ? "✕" : v === 2 ? "○" : "";
      if (cell.textContent !== sign) {
        cell.textContent = sign;
        if (sign && i === game.last && shownLast !== i) wobble(cell, 0.9);
      }
      cell.classList.toggle("me", v === 1);
      cell.classList.toggle("ondine", v === 2);
      cell.classList.toggle("win", line.has(i));
      cell.disabled = v !== 0 || !!game.result.state || game.thinking;
    });
    shownLast = game.last;
    root.classList.toggle("paused", kit.quiet.quiet());
    setText(status, statusOf(game, kit));
    setText(score, scoreLine(kit.store.state.stats.ttt));
    gain.replaceChildren(...resultLine(game.result.state ? game.gained : 0));
  };
  // La barre des 30 secondes (mini-île) : elle se vide doucement (animation CSS),
  // et repart à chaque coup.
  let shownTouch = 0;
  const restartBar = () => {
    if (!opts.mini || shownTouch === game.touched) return;
    shownTouch = game.touched;
    const bar = timer.firstElementChild as HTMLElement;
    bar.getAnimations().forEach((a) => a.cancel());
    const left = Math.max(0, EXPRESS_IDLE_MS - (Date.now() - game.touched));
    bar.animate([{ transform: `scaleX(${left / EXPRESS_IDLE_MS})` }, { transform: "scaleX(0)" }], { duration: left, fill: "forwards" });
  };
  const stops = [game.onChange(() => (paint(), restartBar())), kit.store.onChange(() => paint()), kit.quiet.onChange(() => paint())];
  game.view = { cellEl: (i) => (cells[i]?.isConnected ? cells[i] : null) };
  paint();
  restartBar();
  return () => {
    for (const s of stops) s();
    game.view = null;
  };
}
