// Tests du texte du bilan de la semaine (src/modules/weekly/summary.ts).
// Les comptes eux-mêmes (semaines, date du prochain bilan, compteurs) sont
// testés côté Rust : src-tauri/src/modules/weekly.rs.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusText, summaryParts } from "../../src/modules/weekly/summary";

describe("temps de concentration", () => {
  test("minutes, puis heures", () => {
    assert.equal(focusText(0), "0 min");
    assert.equal(focusText(45), "45 min");
    assert.equal(focusText(60), "1 h");
    assert.equal(focusText(125), "2 h 05");
    assert.equal(focusText(215), "3 h 35");
  });
});

describe("les morceaux du bilan", () => {
  test("tout, dans l'ordre, au pluriel", () => {
    assert.deepEqual(summaryParts({ pomodoros: 3, focusMinutes: 80, todos: 7 }), [
      "3 Pomodoros terminés",
      "1 h 20 de concentration",
      "7 tâches cochées",
    ]);
  });
  test("au singulier", () => {
    assert.deepEqual(summaryParts({ pomodoros: 1, focusMinutes: 25, todos: 1 }), ["1 Pomodoro terminé", "25 min de concentration", "1 tâche cochée"]);
  });
  test("un compteur à zéro n'apparaît pas", () => {
    assert.deepEqual(summaryParts({ pomodoros: 0, focusMinutes: 12, todos: 0 }), ["12 min de concentration"]);
    assert.deepEqual(summaryParts({ pomodoros: 0, focusMinutes: 0, todos: 2 }), ["2 tâches cochées"]);
  });
  test("une semaine vide, ou une réponse inattendue : rien", () => {
    assert.deepEqual(summaryParts({ pomodoros: 0, focusMinutes: 0, todos: 0 }), []);
    assert.deepEqual(summaryParts({ pomodoros: -2, focusMinutes: Number.NaN, todos: "3" as unknown as number }), []);
  });
});

describe("traductions", () => {
  const dict = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };
  const en = (fr: string) => {
    if (dict.exact[fr] !== undefined) return dict.exact[fr];
    for (const [rx, rep] of dict.patterns) {
      const re = new RegExp(rx);
      if (re.test(fr)) return fr.replace(re, rep);
    }
    return fr;
  };
  test("chaque morceau a son anglais", () => {
    const parts = [
      ...summaryParts({ pomodoros: 3, focusMinutes: 125, todos: 7 }),
      ...summaryParts({ pomodoros: 1, focusMinutes: 45, todos: 1 }),
      ...summaryParts({ pomodoros: 0, focusMinutes: 60, todos: 0 }),
    ];
    assert.deepEqual(parts.map(en), [
      "3 Pomodoros completed",
      "2 h 05 of focus",
      "7 tasks checked off",
      "1 Pomodoro completed",
      "45 min of focus",
      "1 task checked off",
      "1 h of focus",
    ]);
  });
});

// ── La carte « Agents IA » (src/modules/weekly/summary.ts, agentsParts) ──

import { agentsParts } from "../../src/modules/weekly/summary";

describe("la carte Agents IA", () => {
  const week = { done: 23, waitMinutes: 130, projects: ["site-ondine", "Island"], days: [], prices: "" };
  test("tâches, attente, jetons avec le coût, projets", () => {
    assert.deepEqual(agentsParts(week, "3,1 M", "≈ 12 $"), ["23 tâches finies", "2 h 10 d'attente de votre part", "3,1 M de jetons (≈ 12 $)", "projets : site-ondine, Island"]);
  });
  test("au singulier, sans coût, sans projet", () => {
    assert.deepEqual(agentsParts({ ...week, done: 1, waitMinutes: 0, projects: [] }, "900", ""), ["1 tâche finie", "900 de jetons"]);
  });
  test("rien sans agent", () => {
    assert.deepEqual(agentsParts(null, "", ""), []);
    assert.deepEqual(agentsParts({ ...week, done: 0, waitMinutes: 0, projects: ["x"] }, "", ""), []);
  });
  test("tout est traduit", () => {
    const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };
    const english = (fr: string) => DICT.exact[fr] ?? DICT.patterns.find(([rx]) => new RegExp(rx).test(fr))?.[1];
    for (const p of agentsParts(week, "3,1 M", "≈ 12 $")) assert.ok(english(p), p);
    assert.ok(english("1 tâche finie"));
  });
});
