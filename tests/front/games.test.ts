// Tests du module Jeux (src/modules/games/) : la logique pure des quatre jeux.
// La progression de l'aquarium est aussi testée côté Rust
// (src-tauri/src/modules/games.rs) ; ici, son double en TypeScript (démo,
// navigateur) et le barème partagé (aquarium.json).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPlay, chooseMove, drop, HUMAN, legalMoves, newBoard, ONDINE, outcome, ROWS, winningMoves, type Board, type Level, type Player } from "../../src/modules/games/connect4-logic";
import { bestCells, freeCells, newGrid, tttMove, tttOutcome, type TttCell } from "../../src/modules/games/ttt-logic";
import { advance, betResult, finish, newRace, raceWorthy, RACERS, standings } from "../../src/modules/games/race-logic";
import { addResult, addReward, buy, buyProblem, cleanState, DAILY_CAP, emptyState, ITEMS, PAUSE_GAP_SECS, REWARDS, rewardKey, stageOf, toNextStage, wear } from "../../src/modules/games/aquarium-logic";

/** Un hasard reproductible (suite de Park-Miller). */
function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Joue une suite de colonnes, en alternant (vous d'abord). */
function playCols(cols: number[], first: Player = HUMAN): Board {
  const b = newBoard();
  let who = first;
  for (const c of cols) {
    assert.ok(drop(b, c, who) >= 0, `colonne ${c} pleine`);
    who = who === HUMAN ? ONDINE : HUMAN;
  }
  return b;
}

describe("Puissance 4 : le plateau", () => {
  test("les jetons tombent au fond, une colonne pleine refuse", () => {
    const b = newBoard();
    assert.equal(drop(b, 3, HUMAN), 0);
    assert.equal(drop(b, 3, ONDINE), 1);
    for (let i = 2; i < ROWS; i++) drop(b, 3, HUMAN);
    assert.equal(canPlay(b, 3), false);
    assert.equal(drop(b, 3, HUMAN), -1);
    assert.ok(!legalMoves(b).includes(3));
    assert.equal(canPlay(b, 7), false);
  });

  test("les quatre directions gagnent", () => {
    // Horizontale en bas.
    let b = playCols([0, 0, 1, 1, 2, 2, 3]);
    assert.equal(outcome(b).state, HUMAN);
    assert.equal(outcome(b).line.length, 4);
    // Verticale.
    b = playCols([4, 5, 4, 5, 4, 5, 4]);
    assert.equal(outcome(b).state, HUMAN);
    // Diagonale montante (vous : 0, 1, 2, 3 en escalier).
    b = playCols([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    assert.equal(outcome(b).state, HUMAN);
    // Diagonale descendante (le miroir).
    b = playCols([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    assert.equal(outcome(b).state, HUMAN);
    assert.equal(outcome(newBoard()).state, 0);
  });
});

describe("Puissance 4 : Ondine", () => {
  test("elle prend une victoire immédiate, à tous les niveaux", () => {
    // Ondine a trois jetons en bas (1, 2, 3) : elle gagne en 0 ou en 4.
    const b = playCols([6, 1, 6, 2, 5, 3]);
    assert.deepEqual(winningMoves(b, ONDINE).sort(), [0, 4]);
    for (const lv of ["easy", "normal", "hard"] as Level[]) {
      for (let seed = 1; seed < 20; seed++) {
        const c = chooseMove(b, ONDINE, lv, seeded(seed)).col;
        assert.ok(c === 0 || c === 4, `${lv} : ${c}`);
      }
    }
  });

  test("en Normal et Malin, elle bloque votre victoire", () => {
    // Vous avez 0, 1, 2 en bas ; Ondine doit jouer 3.
    const b = playCols([0, 6, 1, 6, 2]);
    assert.deepEqual(winningMoves(b, HUMAN), [3]);
    for (const lv of ["normal", "hard"] as Level[]) {
      for (let seed = 1; seed < 15; seed++) assert.equal(chooseMove(b, ONDINE, lv, seeded(seed)).col, 3, lv);
    }
  });

  test("Malin voit une double menace venir", () => {
    // Vous : 2 et 3 en bas, 1 et 4 libres : en jouant 1 ou 4 vous auriez deux menaces.
    const b = playCols([3, 3, 2, 2]);
    const c = chooseMove(b, ONDINE, "hard").col;
    assert.ok(c === 1 || c === 4, `coup ${c}`);
  });

  test("Malin reste rapide (budget de positions) et ne joue jamais un coup interdit", () => {
    const rng = seeded(7);
    let b = newBoard();
    let who: Player = HUMAN;
    let worst = 0;
    for (let turn = 0; turn < 42 && !outcome(b).state; turn++) {
      const t = Date.now();
      const choice = chooseMove(b, who, who === ONDINE ? "hard" : "easy", rng);
      worst = Math.max(worst, Date.now() - t);
      assert.ok(canPlay(b, choice.col), `coup interdit ${choice.col}`);
      assert.ok(choice.nodes <= 150_001);
      drop(b, choice.col, who);
      who = who === HUMAN ? ONDINE : HUMAN;
    }
    // Large marge pour une machine lente ; en vrai, quelques dizaines de ms.
    assert.ok(worst < 1500, `${worst} ms`);
  });

  test("Malin bat presque toujours un joueur au hasard", () => {
    let wins = 0;
    for (let game = 0; game < 6; game++) {
      const rng = seeded(100 + game);
      const b = newBoard();
      let who: Player = game % 2 ? ONDINE : HUMAN;
      while (!outcome(b).state) {
        const moves = legalMoves(b);
        const col = who === ONDINE ? chooseMove(b, ONDINE, "hard", rng).col : moves[Math.floor(rng() * moves.length)];
        drop(b, col, who);
        who = who === HUMAN ? ONDINE : HUMAN;
      }
      if (outcome(b).state === ONDINE) wins++;
    }
    assert.ok(wins >= 5, `${wins}/6`);
  });

  test("le plateau donné n'est pas modifié", () => {
    const b = playCols([3, 3, 4]);
    const before = JSON.stringify(b);
    chooseMove(b, ONDINE, "hard");
    assert.equal(JSON.stringify(b), before);
  });
});

describe("Morpion", () => {
  test("lignes, nul, cases libres", () => {
    assert.equal(tttOutcome([1, 1, 1, 0, 2, 2, 0, 0, 0]).state, 1);
    assert.deepEqual(tttOutcome([2, 1, 0, 0, 2, 1, 0, 0, 2]).line, [0, 4, 8]);
    assert.equal(tttOutcome([1, 2, 1, 1, 2, 2, 2, 1, 1]).state, 3);
    assert.deepEqual(freeCells([1, 0, 2, 0, 0, 0, 0, 0, 0]), [1, 3, 4, 5, 6, 7, 8]);
  });

  test("Malin est imbattable : toutes vos parties possibles finissent au mieux nulles", () => {
    // On essaie TOUS vos coups possibles contre Ondine en Malin.
    let games = 0;
    const explore = (g: TttCell[]) => {
      const o = tttOutcome(g);
      if (o.state) {
        games++;
        assert.notEqual(o.state, 1, `vous gagnez : ${g.join("")}`);
        return;
      }
      for (const i of freeCells(g)) {
        const mine = g.slice();
        mine[i] = 1;
        if (tttOutcome(mine).state) {
          explore(mine);
          continue;
        }
        // Ondine répond (tous ses meilleurs coups, pour couvrir chaque variante).
        for (const j of bestCells(mine, 2)) {
          const next = mine.slice();
          next[j] = 2;
          explore(next);
        }
      }
    };
    explore(newGrid());
    assert.ok(games > 100);
  });

  test("Facile fait des erreurs, mais prend toujours une victoire", () => {
    // Ondine (2) gagne en 2 ; elle le voit même en Facile.
    const g: TttCell[] = [2, 2, 0, 1, 1, 0, 1, 0, 0];
    for (let seed = 1; seed < 30; seed++) assert.equal(tttMove(g, 2, "easy", seeded(seed)), 2);
    // Vous menacez en 2 : en Malin elle bloque toujours, en Facile pas toujours.
    const threat: TttCell[] = [1, 1, 0, 0, 2, 0, 0, 0, 0];
    const blocks = (lv: Level) => Array.from({ length: 60 }, (_, s) => tttMove(threat, 2, lv, seeded(s + 1))).filter((m) => m === 2).length;
    assert.equal(blocks("hard"), 60);
    assert.ok(blocks("easy") < 60);
    assert.equal(tttMove([1, 2, 1, 1, 2, 2, 2, 1, 1], 2, "hard"), -1);
  });
});

describe("Course de gouttes", () => {
  test("une liste vaut une course à partir de 3 tâches, 2 à faire", () => {
    assert.equal(raceWorthy(0, 2), false);
    assert.equal(raceWorthy(0, 3), true);
    assert.equal(raceWorthy(2, 3), false);
    assert.equal(raceWorthy(1, 7), true);
  });

  test("le peloton suit la progression, puis une gagnante à l'arrivée", () => {
    const rng = seeded(3);
    let r = newRace("claude-code:s1", 0, 6);
    r = { ...r, bet: "pink" };
    r = advance(r, 3, 6, rng);
    assert.equal(r.done, 3);
    assert.equal(r.finished, false);
    const mean = r.pos.reduce((a, b) => a + b, 0) / r.pos.length;
    assert.ok(mean > 0.25 && mean < 0.75, `moyenne ${mean}`);
    assert.ok(r.pos.every((p) => p < 1));
    r = advance(r, 6, 6, rng);
    assert.equal(r.finished, true);
    assert.equal(r.ranking.length, RACERS.length);
    assert.equal(r.pos[RACERS.findIndex((x) => x.id === r.ranking[0])], 1);
    assert.deepEqual(standings(r), r.ranking);
    const res = betResult(r);
    assert.ok(res === "win" || res === "second" || res === "lose");
    assert.equal(res, r.ranking[0] === "pink" ? "win" : r.ranking[1] === "pink" ? "second" : "lose");
  });

  test("une liste qui s'allonge allonge la course ; sans pari, pas de résultat", () => {
    let r = newRace("s", 1, 4);
    r = advance(r, 2, 6);
    assert.equal(r.total, 6);
    assert.equal(r.finished, false);
    assert.equal(betResult(finish(r)), null);
    // Une course finie ne bouge plus.
    const f = finish(r);
    assert.equal(advance(f, 6, 6), f);
  });

  test("le hasard change l'ordre d'une course à l'autre", () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) winners.add(advance(newRace("s", 0, 5), 5, 5, seeded(seed)).ranking[0]);
    assert.ok(winners.size >= 3, [...winners].join());
  });
});

describe("Aquarium", () => {
  const NOW = new Date(2026, 9, 15, 10, 0);

  test("barème : chaque récompense d'une partie existe dans aquarium.json", () => {
    for (const [game, outcome, level] of [["connect4", "win", "hard"], ["connect4", "draw", "normal"], ["ttt", "win", "normal"], ["ttt", "draw", "hard"], ["race", "win", ""], ["race", "second", ""]]) {
      const key = rewardKey(game, outcome, level);
      assert.ok(key && REWARDS[key] !== undefined, `${game} ${outcome} ${level}`);
    }
    assert.equal(rewardKey("connect4", "lose", "hard"), null);
    assert.equal(rewardKey("ttt", "draw", "easy"), null);
    assert.equal(rewardKey("echecs", "win", "hard"), null);
    // Le Rust lit le même fichier (include_str!) et en teste les mêmes clés.
    assert.match(readFileSync("src-tauri/src/modules/games.rs", "utf8"), /include_str!\("\.\.\/\.\.\/\.\.\/src\/modules\/games\/aquarium\.json"\)/);
  });

  test("plafond du jour, puis un nouveau jour", () => {
    let s = emptyState();
    for (let i = 0; i < 100; i++) s = addReward(s, "agent-done", NOW).state;
    assert.equal(s.today, DAILY_CAP);
    assert.equal(s.drops, DAILY_CAP);
    assert.equal(addReward(s, "agent-done", NOW).gained, 0);
    const tomorrow = new Date(2026, 9, 16, 9, 0);
    const r = addReward(s, "agent-done", tomorrow);
    assert.equal(r.gained, REWARDS["agent-done"]);
    assert.equal(r.state.day, "2026-10-16");
  });

  test("une pause compte une fois par écart", () => {
    let s = emptyState();
    let r = addReward(s, "pause", NOW);
    assert.ok(r.gained > 0);
    s = r.state;
    assert.equal(addReward(s, "pause", new Date(NOW.getTime() + 60_000)).gained, 0);
    r = addReward(s, "pause", new Date(NOW.getTime() + PAUSE_GAP_SECS * 1000));
    assert.ok(r.gained > 0);
  });

  test("parties : statistiques et gouttes", () => {
    let s = emptyState();
    s = addResult(s, "connect4", "win", "hard", NOW).state;
    s = addResult(s, "connect4", "lose", "hard", NOW).state;
    s = addResult(s, "race", "second", "", NOW).state;
    assert.deepEqual(s.stats.connect4, { win: 1, lose: 1, draw: 0 });
    assert.equal(s.stats.race.draw, 1);
    assert.equal(s.drops, REWARDS["connect4-win-hard"] + REWARDS["race-second"]);
  });

  test("acheter, porter, retirer", () => {
    let s = { ...emptyState(), drops: 25 };
    assert.equal(buyProblem(s, "crown"), "Pas assez de gouttes");
    assert.equal(buyProblem(s, "licorne"), "Objet inconnu");
    s = buy(s, "bow");
    assert.equal(s.wear.head, "bow");
    assert.equal(buyProblem(s, "bow"), "Déjà à vous");
    s = buy(s, "algues");
    assert.equal(s.drops, 25 - 10 - 5);
    assert.equal(wear(s, "head", "crown"), s); // pas achetée
    assert.equal(wear(s, "eyes", "bow"), s); // pas le bon emplacement
    assert.equal(wear(s, "head", "none").wear.head, "none");
  });

  test("un état étrange est nettoyé", () => {
    const s = cleanState({ drops: -4, earned: 12.7, owned: ["cap", "cap", "licorne", 3], wear: { head: "cap", eyes: "sun", neck: 1 }, stats: { ttt: { win: "x" } } });
    assert.equal(s.drops, 0);
    assert.equal(s.earned, 12);
    assert.deepEqual(s.owned, ["cap"]);
    assert.deepEqual(s.wear, { head: "cap", eyes: "none", neck: "none" });
    assert.equal(s.stats.ttt.win, 0);
  });

  test("l'aquarium grandit par niveaux", () => {
    assert.equal(stageOf(0), 1);
    assert.equal(stageOf(30), 2);
    assert.equal(stageOf(10_000), 6);
    assert.equal(toNextStage(0), 30);
    assert.equal(toNextStage(10_000), null);
  });

  test("les accessoires sont ceux que la goutte gomme sait porter", () => {
    const draw = readFileSync("src/mascot/renderers/gum-draw.ts", "utf8");
    const union = (name: string) => [...(new RegExp(`export type ${name} = ([^;]+);`).exec(draw)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    const slots: Record<string, string[]> = { head: union("HeadWear"), eyes: union("EyeWear"), neck: union("NeckWear") };
    for (const item of ITEMS) {
      if (item.kind === "decor") continue;
      assert.ok(slots[item.kind].includes(item.id), `${item.id} (${item.kind})`);
    }
    assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  });
});
