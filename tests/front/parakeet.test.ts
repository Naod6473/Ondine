// Tests du bloc « Parakeet sur le PC » des Réglages (1.2.4) :
// src/settings/voice/parakeet-logic.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { megabytes, parakeetView, percentOf, sizeText } from "../../src/settings/voice/parakeet-logic";
import type { SpeechStatus } from "../../src/core/bridge";

const TOTAL = 700_300_442;
const base: SpeechStatus = { state: "missing", done: 0, total: TOTAL, error: null, supported: true, loaded: false };

describe("Parakeet sur le PC : affichage", () => {
  test("tailles et pourcentages", () => {
    assert.equal(megabytes(TOTAL), 700);
    assert.equal(megabytes(-5), 0);
    assert.equal(megabytes(Number.NaN), 0);
    assert.equal(percentOf(0, TOTAL), 0);
    assert.equal(percentOf(TOTAL / 2, TOTAL), 50);
    // Jamais 100 % avant la fin (la vérification de l'empreinte suit).
    assert.equal(percentOf(TOTAL, TOTAL), 99);
    assert.equal(percentOf(5, 0), 0);
    assert.equal(sizeText(TOTAL), "Environ 700 Mo, une seule fois. Rien n'est téléchargé avant votre clic.");
  });

  test("absent : télécharger, rien avant le clic", () => {
    const v = parakeetView(base);
    assert.deepEqual(v.actions, ["download"]);
    assert.equal(v.percent, null);
    assert.match(v.detail, /700 Mo/);
  });

  test("en cours : annuler, avec le pourcentage", () => {
    const v = parakeetView({ ...base, state: "downloading", done: 350_150_221 });
    assert.deepEqual(v.actions, ["cancel"]);
    assert.equal(v.percent, 50);
    assert.equal(v.title, "Téléchargement : 50 %");
    assert.equal(v.detail.startsWith("350 Mo sur 700 Mo."), true);
  });

  test("prêt : supprimer ; échec : réessayer avec le message tel quel", () => {
    assert.deepEqual(parakeetView({ ...base, state: "ready", done: TOTAL }).actions, ["remove"]);
    assert.match(parakeetView({ ...base, state: "ready", loaded: true }).detail, /en mémoire/);
    const failed = parakeetView({ ...base, state: "failed", error: "encoder.int8.onnx : le serveur a répondu 503" });
    assert.deepEqual(failed.actions, ["retry"]);
    assert.equal(failed.error, "encoder.int8.onnx : le serveur a répondu 503");
  });

  test("hors de Windows ou hors de l'appli : aucun bouton", () => {
    assert.deepEqual(parakeetView({ ...base, supported: false }).actions, []);
    assert.deepEqual(parakeetView(null).actions, []);
  });
});
