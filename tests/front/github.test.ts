// Tests du calendrier de contributions GitHub (src/modules/agents/github-logic.ts) :
// la série et ses paliers, les niveaux de couleur, les colonnes de la grille,
// les libellés (« 336 contributions cette année · série de 12 jours », la bulle
// d'une case) et leur traduction anglaise (src/core/i18n-en.json).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  celebrationKey,
  columns,
  dayTitle,
  headline,
  headlineParts,
  levelClass,
  levelFor,
  loginProblem,
  monthLabels,
  stageReached,
  stageToCelebrate,
  updatedLabel,
  waveDelay,
  WAVE_MS,
  WEEKS,
  type GithubDay,
} from "../../src/modules/agents/github-logic";

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

/** Des jours sans trou, du `start` (AAAA-MM-JJ) sur `n` jours, avec un nombre par jour. */
function days(start: string, counts: number[]): GithubDay[] {
  const d = new Date(`${start}T00:00:00Z`);
  return counts.map((count) => {
    const date = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date, count, level: levelFor(count, 10) };
  });
}

describe("identifiant GitHub", () => {
  test("accepté : lettres, chiffres, tirets, 39 au plus", () => {
    for (const ok of ["simon", "simon-victor", "x1", "a".repeat(39), " simon "]) assert.equal(loginProblem(ok), "", ok);
    assert.equal(loginProblem(""), "", "vide : rien à dire (le calendrier est simplement éteint)");
  });
  test("refusé, avec un mot d'explication traduit", () => {
    for (const bad of ["-simon", "simon victor", "https://github.com/simon", "a".repeat(40), "sí"]) {
      const problem = loginProblem(bad);
      assert.ok(problem, bad);
      assert.ok(english(problem), `traduction manquante : ${problem}`);
    }
  });
});

describe("la série", () => {
  test("paliers 7, 30, 100", () => {
    assert.equal(stageReached(0), null);
    assert.equal(stageReached(6), null);
    assert.equal(stageReached(7), 7);
    assert.equal(stageReached(29), 7);
    assert.equal(stageReached(30), 30);
    assert.equal(stageReached(250), 100);
  });
  test("la clé d'une fête : le premier jour de la série et le palier", () => {
    const cal = { days: days("2025-10-01", [0, 1, 2, 3, 1, 1, 1, 1]), streak: 7 };
    assert.equal(celebrationKey(cal, 7), "2025-10-02:7");
    // Rien encore aujourd'hui : la série finit hier, elle part du même jour.
    const tonight = { days: days("2025-10-01", [0, 1, 2, 3, 1, 1, 1, 1, 0]), streak: 7 };
    assert.equal(celebrationKey(tonight, 7), "2025-10-02:7");
    assert.equal(celebrationKey({ days: [], streak: 0 }, 7), null);
  });
  test("une fois par palier et par série", () => {
    const cal = { days: days("2025-10-01", [0, 1, 2, 3, 1, 1, 1, 1]), streak: 7 };
    assert.equal(stageToCelebrate(cal, null), 7);
    assert.equal(stageToCelebrate(cal, "2025-10-02:7"), null, "déjà fêté");
    // La même série atteint 30 : nouvelle fête.
    const month = { days: days("2025-09-01", [0, ...Array<number>(30).fill(2)]), streak: 30 };
    assert.equal(stageToCelebrate(month, "2025-09-02:7"), 30);
    assert.equal(stageToCelebrate(month, "2025-09-02:30"), null);
    // Une autre série de 7 (autre premier jour) : on refête.
    assert.equal(stageToCelebrate(cal, "2025-01-05:7"), 7);
    assert.equal(stageToCelebrate({ days: days("2025-10-01", [1, 1, 1]), streak: 3 }, null), null);
  });
});

describe("niveaux de couleur", () => {
  test("le niveau de GitHub est gardé dans 0…4", () => {
    assert.equal(levelClass(0), 0);
    assert.equal(levelClass(4), 4);
    assert.equal(levelClass(9), 4);
    assert.equal(levelClass(-1), 0);
    assert.equal(levelClass(Number.NaN), 0);
  });
  test("le mode démo invente des niveaux par quarts", () => {
    assert.equal(levelFor(0, 12), 0);
    assert.equal(levelFor(1, 12), 1);
    assert.equal(levelFor(3, 12), 1);
    assert.equal(levelFor(4, 12), 2);
    assert.equal(levelFor(12, 12), 4);
    assert.equal(levelFor(30, 12), 4);
    assert.equal(levelFor(5, 0), 0);
  });
});

describe("la grille", () => {
  test("53 colonnes de 7, dimanche en haut, les jours à venir vides", () => {
    // Du dimanche 6 octobre 2024 au mercredi 8 octobre 2025 : 368 jours.
    const list = days("2024-10-06", Array<number>(368).fill(1));
    const cols = columns(list);
    assert.equal(cols.length, WEEKS);
    assert.equal(cols[0][0]?.date, "2024-10-06");
    const last = cols[WEEKS - 1];
    assert.equal(last[3]?.date, "2025-10-08");
    assert.deepEqual(last.slice(4), [null, null, null], "jeudi, vendredi, samedi à venir");
  });
  test("une liste courte est complétée par des colonnes vides devant", () => {
    const cols = columns(days("2025-10-08", [1]));
    assert.equal(cols.length, WEEKS);
    assert.ok(cols[0].every((c) => c === null));
    // Un mercredi : trois cases vides avant lui.
    assert.deepEqual(cols[WEEKS - 1].slice(0, 4).map((c) => c?.date ?? null), [null, null, null, "2025-10-08"]);
  });
  test("les mois en haut, là où ils commencent, traduits", () => {
    const list = days("2024-10-06", Array<number>(368).fill(1));
    const labels = monthLabels(columns(list));
    assert.equal(labels[0].label, "oct.");
    assert.equal(labels[0].col, 0);
    assert.equal(labels[1].label, "nov.");
    assert.ok(labels.length >= 12 && labels.length <= 13, `${labels.length} mois`);
    for (const l of labels) assert.ok(english(l.label), `traduction manquante : ${l.label}`);
    // Des colonnes qui se suivent : les étiquettes montent.
    for (let i = 1; i < labels.length; i++) assert.ok(labels[i].col > labels[i - 1].col);
  });
  test("la vague dure 1,2 s de la première à la dernière colonne", () => {
    assert.equal(waveDelay(0), 0);
    assert.equal(waveDelay(WEEKS - 1), WAVE_MS);
    assert.ok(waveDelay(26) > 0 && waveDelay(26) < WAVE_MS);
  });
});

describe("libellés", () => {
  test("l'en-tête : total et série", () => {
    assert.equal(headline(336, 12), "336 contributions cette année · série de 12 jours");
    assert.equal(headline(1, 1), "1 contribution cette année · série de 1 jour");
    assert.equal(headline(0, 0), "0 contributions cette année · pas de série en cours");
    // Les deux moitiés sont affichées (et traduites) séparément.
    const [left, right] = headlineParts(1234, 12);
    // Le séparateur de milliers français est une espace fine insécable.
    assert.equal(left, "1\u202f234 contributions cette année");
    assert.equal(english(left), "1\u202f234 contributions this year");
    assert.equal(english(headlineParts(1, 0)[0]), "1 contribution this year");
    assert.equal(english(right), "12-day streak");
    assert.equal(english("série de 1 jour"), "1-day streak");
    assert.equal(english("pas de série en cours"), "no current streak");
  });
  test("la bulle d'une case", () => {
    assert.equal(dayTitle(3, "2025-10-08"), "3 contributions le 8 octobre");
    assert.equal(dayTitle(1, "2025-10-01"), "1 contribution le 1er octobre");
    assert.equal(dayTitle(0, "2025-02-14"), "Aucune contribution le 14 février");
    // En anglais, la vue demande la date en anglais, puis le motif traduit le reste.
    assert.equal(dayTitle(3, "2025-10-08", true), "3 contributions le October 8");
    assert.equal(english(dayTitle(3, "2025-10-08", true)), "3 contributions on October 8");
    assert.equal(english(dayTitle(1, "2025-10-01", true)), "1 contribution on October 1");
    assert.equal(english(dayTitle(0, "2025-02-14", true)), "No contributions on February 14");
    assert.equal(english(dayTitle(1234, "2025-02-14", true)), "1\u202f234 contributions on February 14");
  });
  test("« Mis à jour à 14:32 »", () => {
    const d = new Date(2025, 9, 8, 14, 32);
    assert.equal(updatedLabel(d.getTime()), "Mis à jour à 14:32");
    assert.equal(english(updatedLabel(d.getTime())), "Updated at 14:32");
    assert.equal(updatedLabel(0), "");
  });
});
