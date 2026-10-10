// Tests de la pancarte d'Ondine (src/mascot/sign-text.ts) : le mot écrit,
// combien de temps elle la tient, la taille de la planche, le statut d'Équipe.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cleanSignText, SIGN_MAX_CHARS, signLayout, signSeconds, statusSign } from "../../src/mascot/sign-text";

describe("pancarte : le mot", () => {
  test("les mots courts passent tels quels", () => {
    for (const w of ["Occupé", "En réunion", "Pause", "?"]) assert.equal(cleanSignText(w), w);
  });
  test("espaces resserrés, contrôles et inversions de texte retirés", () => {
    assert.equal(cleanSignText("  En \n réunion  "), "En réunion");
    assert.equal(cleanSignText("Pa\u202euse"), "Pa use");
    assert.equal(cleanSignText("\u0007"), "");
  });
  test("trop long : coupé avec « … »", () => {
    const t = cleanSignText("Réunion très importante");
    assert.equal(t, "Réunion très…");
    assert.ok(Array.from(t).length <= SIGN_MAX_CHARS);
    assert.equal(Array.from(cleanSignText("abcdefghijklmnopq")).length, SIGN_MAX_CHARS);
    assert.ok(t.endsWith("…"));
    // Un emoji compte pour un.
    assert.equal(cleanSignText("☕☕☕☕☕☕☕☕☕☕☕☕☕☕"), "☕☕☕☕☕☕☕☕☕☕☕☕☕☕");
  });
  test("pas un texte : rien", () => {
    assert.equal(cleanSignText(undefined), "");
    assert.equal(cleanSignText(42), "");
  });
});

describe("pancarte : la durée", () => {
  test("8 s par défaut, bornée de 2 s à 10 min", () => {
    assert.equal(signSeconds(undefined), 8);
    assert.equal(signSeconds("10"), 8);
    assert.equal(signSeconds(Number.NaN), 8);
    assert.equal(signSeconds(0), 2);
    assert.equal(signSeconds(6), 6);
    assert.equal(signSeconds(1e9), 600);
  });
});

describe("pancarte : la planche", () => {
  const R = 100;
  const measure = (len: number) => (px: number) => px * 0.6 * len;
  test("le « ? » garde la petite planche d'origine", () => {
    assert.deepEqual(signLayout("?", measure(1), R), { w: 62, h: 50, font: 42 });
    assert.deepEqual(signLayout("", measure(1), R), { w: 62, h: 50, font: 42 });
  });
  test("un mot élargit la planche, puis le texte rapetisse", () => {
    const short = signLayout("Pause", measure(5), R);
    const long = signLayout("En réunion", measure(10), R);
    assert.ok(long.w > short.w);
    assert.equal(short.font, 30);
    const huge = signLayout("x".repeat(14), measure(30), R);
    assert.ok(huge.w <= 240 + 1e-9, "jamais plus large que le dessin");
    assert.ok(huge.font < 30 && huge.font >= 16);
  });
});

describe("pancarte : le statut d'Équipe", () => {
  test("un mot par statut occupé", () => {
    assert.equal(statusSign("meeting"), "En réunion");
    assert.equal(statusSign("focus"), "Occupé");
    assert.equal(statusSign("away"), "Pause");
    assert.equal(statusSign("available"), "");
    assert.equal(statusSign(""), "");
  });
});
