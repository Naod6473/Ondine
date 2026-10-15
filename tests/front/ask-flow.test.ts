// Tests du texte qui bouge dans Parler à Ondine (src/modules/askclaude/flow-logic.ts)
// et de l'île qui ne rétrécit pas pendant un échange (src/island/fit.ts, settle).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CROSSFADE_MAX_CHARS, diffWords, PAUSES, revealSpeed, revealTimes, shownAt, wordEnd, wordsOf } from "../../src/modules/askclaude/flow-logic";
import { settle } from "../../src/island/fit";

describe("vos mots en direct", () => {
  test("les mots déjà là restent, les nouveaux s'ajoutent", () => {
    const d = diffWords(wordsOf("Dis Ondine"), wordsOf("Dis Ondine c'est quoi"));
    assert.deepEqual(d, { keep: 2, replaced: [], added: ["c'est", "quoi"] });
  });

  test("une fin de phrase réécrite par le moteur", () => {
    const d = diffWords(wordsOf("cette petite il"), wordsOf("cette petite île en"));
    assert.deepEqual(d, { keep: 2, replaced: ["il"], added: ["île", "en"] });
    // Une virgule ajoutée change le mot.
    assert.equal(diffWords(wordsOf("Dis Ondine c'est"), wordsOf("Dis Ondine, c'est")).keep, 1);
  });

  test("rien ne change : rien à faire", () => {
    const d = diffWords(wordsOf(" Dis  Ondine "), wordsOf("Dis Ondine"));
    assert.equal(d.replaced.length + d.added.length, 0);
    assert.deepEqual(wordsOf(""), []);
    assert.ok(CROSSFADE_MAX_CHARS >= 20);
  });
});

describe("la réponse qui s'écrit", () => {
  test("un pas régulier, une lettre à la fois", () => {
    const text = "Bonjour tout le monde";
    const t = revealTimes(text, 50);
    assert.equal(t.length, text.length + 1);
    assert.equal(t[0], 0);
    for (let k = 1; k < t.length; k++) assert.equal(Math.round(t[k] - t[k - 1]), 20);
    // Entre deux pas, jamais plus d'une lettre de plus.
    for (let ms = 0; ms < t[text.length]; ms += 7) assert.ok(shownAt(t, ms + 7) - shownAt(t, ms) <= 1);
    assert.equal(shownAt(t, -5), 0);
    assert.equal(shownAt(t, 1e9), text.length);
  });

  test("une pause après la ponctuation, pas avant", () => {
    const t = revealTimes("Oui. Non", 50);
    // « . » apparaît au même rythme ; c'est l'espace qui suit qui attend.
    assert.equal(Math.round(t[4] - t[3]), 20);
    assert.equal(Math.round(t[5] - t[4]), 20 + PAUSES["."]);
  });

  test("plus vite pour un long texte", () => {
    assert.equal(revealSpeed(100), 55);
    assert.equal(revealSpeed(1400), 200);
  });

  test("la fin du mot en cours est réservée", () => {
    const text = "une petite île";
    assert.equal(wordEnd(text, 6), 10); // « p » visible : « etite » réservé
    assert.equal(wordEnd(text, 3), 3); // juste après « une »
    assert.equal(wordEnd(text, 4), 4); // au début d'un mot : rien encore
    assert.equal(wordEnd(text, 12), 14);
    assert.equal(wordEnd(text, 0), 0);
    assert.equal(wordEnd(text, 99), 14);
  });
});

describe("l'île pendant un échange (settle avec hold)", () => {
  test("elle grandit mais ne rétrécit pas", () => {
    assert.equal(settle(320, 360, 8, true), 360);
    assert.equal(settle(360, 300, 8, true), 360);
    assert.equal(settle(360, null, 8, true), 360);
    assert.equal(settle(null, 300, 8, true), 300);
    // Sans échange : comme avant.
    assert.equal(settle(360, 300), 300);
    assert.equal(settle(360, null), null);
  });
});
