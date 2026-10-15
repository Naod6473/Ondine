// Tests des extras de la 1.2.4 (logique sans DOM) :
//   - les limites du forfait (src/modules/agents/plan.ts) : seuils de couleur,
//     % effectif, textes de remise à zéro et leur traduction ;

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ageText, effectivePct, highestPct, planLevel, resetText } from "../../src/modules/agents/plan";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as {
  exact: Record<string, string>;
  patterns: [string, string][];
};

/** Même recherche que t() (src/core/i18n.ts) : le texte exact, sinon le premier motif. */
function english(fr: string): string | undefined {
  if (fr in DICT.exact) return DICT.exact[fr];
  for (const [rx, en] of DICT.patterns) {
    const m = new RegExp(rx).exec(fr);
    if (m) return en.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? "");
  }
  return undefined;
}

describe("limites du forfait", () => {
  const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);

  test("normal, jaune dès 75 %, rouge dès 90 %", () => {
    assert.equal(planLevel(0), "ok");
    assert.equal(planLevel(74.9), "ok");
    assert.equal(planLevel(75), "warn");
    assert.equal(planLevel(89.9), "warn");
    assert.equal(planLevel(90), "high");
    assert.equal(planLevel(100), "high");
  });

  test("une fenêtre remise à zéro compte pour 0 %", () => {
    assert.equal(effectivePct({ pct: 80, resetsAt: NOW + 1000 }, NOW), 80);
    assert.equal(effectivePct({ pct: 80, resetsAt: NOW - 1 }, NOW), 0);
    assert.equal(effectivePct({ pct: 140, resetsAt: NOW + 1000 }, NOW), 100);
    assert.equal(highestPct({ fiveHour: { pct: 20, resetsAt: NOW + 1 }, week: { pct: 60, resetsAt: NOW + 1 }, updatedAt: NOW }, NOW), 60);
    assert.equal(highestPct(null, NOW), null);
  });

  test("remise à zéro : dans 1 h 20, dans 5 min, jour et heure pour la semaine", () => {
    assert.equal(resetText({ pct: 1, resetsAt: NOW + (80 * 60 + 30) * 1000 }, false, NOW), "remise à zéro dans 1 h 20");
    assert.equal(resetText({ pct: 1, resetsAt: NOW + 5 * 60_000 }, false, NOW), "remise à zéro dans 5 min");
    assert.equal(resetText({ pct: 1, resetsAt: NOW + 20_000 }, false, NOW), "remise à zéro dans 1 min");
    assert.equal(resetText({ pct: 1, resetsAt: NOW - 1 }, true, NOW), "remise à zéro en cours…");
    const week = resetText({ pct: 1, resetsAt: NOW + 3 * 86_400_000 }, true, NOW);
    assert.match(week, /^remise à zéro (lun|mar|mer|jeu|ven|sam|dim)\. \d+:\d\d$/);
    // Moins d'un jour : même la semaine dit « dans … ».
    assert.match(resetText({ pct: 1, resetsAt: NOW + 3_600_000 }, true, NOW), /^remise à zéro dans 1 h 00$/);
  });

  test("les textes ont leur traduction anglaise", () => {
    assert.equal(english("remise à zéro dans 1 h 20"), "resets in 1 h 20");
    assert.equal(english("remise à zéro dans 5 min"), "resets in 5 min");
    assert.equal(english("remise à zéro jeu. 9:05"), "resets Thu 9:05");
    assert.equal(english(ageText(NOW - 12 * 60_000, NOW)), "read 12 min ago");
    assert.equal(english(ageText(NOW - 3 * 3_600_000, NOW)), "read 3 h ago");
    assert.equal(english(ageText(NOW, NOW)), "read just now");
  });
});
