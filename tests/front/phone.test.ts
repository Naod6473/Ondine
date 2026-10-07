// Tests des textes « Vers le téléphone » (Étagère) et du réveil (Accès distants).
//
// 1. Le compte à rebours et la taille du fichier (src/modules/shelf/phone-text.ts).
// 2. Leur traduction anglaise, et celle des messages du réveil, de bout en
//    bout avec la même recherche que t() (src/core/i18n.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clock, sizeText } from "../../src/modules/shelf/phone-text";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };

/** Même recherche que t() : le texte entier, puis le premier motif qui correspond. */
function en(fr: string): string {
  const s = fr.trim();
  if (s in DICT.exact) return DICT.exact[s];
  for (const [rx, rep] of DICT.patterns) {
    const re = new RegExp(rx);
    if (re.test(s)) return s.replace(re, rep);
  }
  return fr;
}

describe("compte à rebours", () => {
  test("minutes:secondes, arrondi à la seconde du dessus", () => {
    assert.equal(clock(300_000), "5:00");
    assert.equal(clock(245_000), "4:05");
    assert.equal(clock(59_001), "1:00");
    assert.equal(clock(400), "0:01");
  });

  test("jamais en dessous de zéro", () => {
    assert.equal(clock(0), "0:00");
    assert.equal(clock(-5_000), "0:00");
  });
});

describe("taille du fichier", () => {
  test("octets, Ko, Mo, Go, avec une virgule sous 10", () => {
    assert.equal(sizeText(0), "0 o");
    assert.equal(sizeText(1023), "1023 o");
    assert.equal(sizeText(1024), "1,0 Ko");
    assert.equal(sizeText(350 * 1024), "350 Ko");
    assert.equal(sizeText(2_516_582), "2,4 Mo");
    assert.equal(sizeText(5 * 1024 ** 3), "5,0 Go");
    assert.equal(sizeText(3000 * 1024 ** 3), "3000 Go");
  });

  test("traduite en anglais (point décimal, B)", () => {
    assert.equal(en(sizeText(512)), "512 B");
    assert.equal(en(sizeText(2_516_582)), "2.4 MB");
    assert.equal(en(sizeText(350 * 1024)), "350 KB");
    assert.equal(en(sizeText(5 * 1024 ** 3)), "5.0 GB");
  });
});

describe("messages du réveil (Wake-on-LAN)", () => {
  test("le nom du serveur reste, le reste est traduit", () => {
    assert.equal(en("NAS est réveillé"), "NAS is awake");
    assert.equal(en("Poste de l'accueil ne répond toujours pas"), "Poste de l'accueil still isn't responding");
    assert.equal(en("Réveil de NAS…"), "Waking NAS…");
    assert.equal(en("Il répond après 35 s."), "Responding after 35 s.");
    assert.equal(en("Réveiller NAS"), "Wake up NAS");
    assert.equal(en("Réveiller"), "Wake up");
  });
});
