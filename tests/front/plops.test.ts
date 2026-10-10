// Tests des « plop plip » de Parler à Ondine (src/modules/askclaude/plops.ts) :
// un timbre pour chaque mascotte, la hauteur selon l'humeur, le rythme des
// syllabes et la bouche.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GUM_FAMILY } from "../../src/mascot/gum-family";
import { DEFAULT_TIMBRE, moodShift, mouthFor, syllableStarts, TIMBRES } from "../../src/modules/askclaude/plops";

describe("plop plip", () => {
  test("chaque mascotte a son timbre, et la goutte sert de défaut", () => {
    const ids = ["goutte-gomme", ...GUM_FAMILY.map((m) => m.id)];
    assert.equal(ids.length, 15);
    for (const id of ids) assert.ok(TIMBRES[id], `pas de timbre pour ${id}`);
    assert.equal(DEFAULT_TIMBRE, TIMBRES["goutte-gomme"]);
    // Guimauve : un plop mou (grave, long) ; Dragée : un tic clair (aigu, court).
    assert.ok(TIMBRES["gomme-guimauve"].base < TIMBRES["gomme-dragee"].base);
    assert.ok(TIMBRES["gomme-guimauve"].dur > TIMBRES["gomme-dragee"].dur);
    assert.equal(TIMBRES["gomme-flamme"].wave, "noise");
    assert.equal(TIMBRES["gomme-nuage"].wave, "noise");
  });

  test("graves si triste, aigus si joyeuse", () => {
    assert.ok(moodShift("happy") > 0 && moodShift("laugh") > 0);
    assert.ok(moodShift("sad") < 0 && moodShift("worried") < 0);
    assert.equal(moodShift(null), 0);
    assert.equal(moodShift("inconnu"), 0);
  });

  test("une goutte par syllabe (début de chaque groupe de voyelles)", () => {
    assert.deepEqual(syllableStarts("Bonjour !"), [1, 4]);
    assert.deepEqual(syllableStarts("eau"), [0]);
    assert.equal(syllableStarts("Ondine est là").length, 5);
    assert.deepEqual(syllableStarts("123 ?!"), []);
  });

  test("la bouche s'ouvre grand sur a / o, peu sur i / u", () => {
    assert.equal(mouthFor("a"), 1);
    assert.equal(mouthFor("O"), 1);
    assert.ok(mouthFor("é") < 1 && mouthFor("é") > mouthFor("i"));
  });
});
