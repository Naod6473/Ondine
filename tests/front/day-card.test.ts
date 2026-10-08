// Tests du Bilan du jour en image (src/modules/agents/day-card-logic.ts) :
// ce que la carte dit. Le dessin (day-card.ts) se vérifie à l'œil, sous Windows.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dayFigures, emptyDay, previousDay, streakDays, tiles, type DayCardData } from "../../src/modules/agents/day-card-logic";
import { SITE_QR, SITE_URL } from "../../src/modules/agents/site-qr";

const row = (day: string, output: number) => ({ day, tool: "claude-code", model: "claude-opus-5-5", input: 0, output, cacheRead: 0, cacheWrite: 0, messages: 1 });

function data(over: Partial<DayCardData> = {}): DayCardData {
  return {
    today: "2026-10-08",
    done: 0,
    waitMinutes: 0,
    projects: [],
    hours: [],
    longestMinutes: 0,
    activeDays: [],
    days: [],
    usage: true,
    prices: "",
    ...over,
  };
}

const fmt = { duration: (m: number) => `${m} min`, tokens: (n: number) => `${n} j`, cost: (c: number) => `${c} $` };

describe("la série de jours", () => {
  test("le jour d'avant, changement de mois et d'année compris", () => {
    assert.equal(previousDay("2026-10-01"), "2026-09-30");
    assert.equal(previousDay("2026-01-01"), "2025-12-31");
    assert.equal(previousDay("2028-03-01"), "2028-02-29");
  });
  test("compte depuis aujourd'hui, sinon depuis hier", () => {
    assert.equal(streakDays(["2026-10-08", "2026-10-07", "2026-10-06", "2026-10-04"], "2026-10-08"), 3);
    assert.equal(streakDays(["2026-10-07", "2026-10-06"], "2026-10-08"), 2);
    assert.equal(streakDays(["2026-10-05"], "2026-10-08"), 0);
    assert.equal(streakDays([], "2026-10-08"), 0);
  });
});

describe("les chiffres du jour", () => {
  test("jetons du jour seulement, série avec l'historique et les journaux", () => {
    const f = dayFigures(
      data({
        done: 5,
        waitMinutes: 12,
        hours: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3],
        longestMinutes: 40,
        activeDays: ["2026-10-08", "2026-10-07"],
        days: [row("2026-10-08", 1000), row("2026-10-06", 500), row("2026-10-05", 0)],
        projects: ["Island", "—", "site", "a", "b"],
      }),
    );
    assert.equal(f.tokens, 1000);
    assert.equal(f.streak, 3);
    assert.equal(f.busiestHour, 14);
    assert.equal(f.hours.length, 24);
    assert.deepEqual(f.projects, ["Island", "site", "a"]);
    assert.ok(!emptyDay(f));
  });
  test("une journée vide", () => {
    const f = dayFigures(data({ hours: [-3, Number.NaN] as number[] }));
    assert.ok(emptyDay(f));
    assert.equal(f.busiestHour, -1);
    assert.equal(f.cost, 0);
  });
  test("le coût d'après la grille de prix", () => {
    const f = dayFigures(data({ days: [row("2026-10-08", 1_000_000)], prices: "claude-opus ; 15 ; 75 ; 1,5 ; 18,75" }));
    assert.equal(Math.round(f.cost), 75);
  });
});

describe("les tuiles", () => {
  test("toutes, dans l'ordre, coût seulement s'il est demandé", () => {
    const f = dayFigures(data({ done: 4, waitMinutes: 20, days: [row("2026-10-08", 900)], activeDays: ["2026-10-08", "2026-10-07"], prices: "claude-opus ; 15 ; 75 ; 1,5 ; 18,75" }));
    const all = tiles(f, { cost: false }, fmt);
    assert.deepEqual(all.map((x) => x.label), ["tâches finies", "à m'attendre", "jetons", "jours d'affilée"]);
    assert.equal(all[2].note, undefined);
    assert.ok(tiles(f, { cost: true }, fmt)[2].note?.endsWith("$"));
  });
  test("au singulier, sans les tuiles vides ni une série d'un jour", () => {
    const f = dayFigures(data({ done: 1, activeDays: ["2026-10-08"] }));
    assert.deepEqual(tiles(f, { cost: true }, fmt), [{ value: "1", label: "tâche finie" }]);
  });
});

describe("le QR code du site", () => {
  test("25 × 25 carrés, avec les trois repères aux coins", () => {
    assert.equal(SITE_URL, "https://ondine.pissits.com");
    assert.equal(SITE_QR.length, 25);
    assert.ok(SITE_QR.every((r) => /^[01]{25}$/.test(r)));
    const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
    for (const [x0, y0] of [[0, 0], [18, 0], [0, 18]]) {
      assert.deepEqual(finder.map((_, i) => SITE_QR[y0 + i].slice(x0, x0 + 7)), finder);
    }
  });
});
