// Module Mail (prototype) : les petits textes de l'onglet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileName, shortDate, sizeText } from "../../src/modules/mail/format";

test("date courte : l'heure aujourd'hui, le jour sinon", () => {
  const now = new Date(2026, 9, 13, 18, 0);
  assert.equal(shortDate(new Date(2026, 9, 13, 8, 5).getTime(), now), "08:05");
  assert.equal(shortDate(new Date(2026, 9, 2, 8, 5).getTime(), now), "02/10");
  assert.equal(shortDate(0, now), "");
});

test("taille d'une pièce jointe", () => {
  assert.equal(sizeText(500), "500 o");
  assert.equal(sizeText(1536), "1,5 Ko");
  assert.equal(sizeText(200 * 1024), "200 Ko");
  assert.equal(sizeText(3 * 1024 * 1024), "3,0 Mo");
});

test("nom d'un fichier dans un chemin Windows", () => {
  assert.equal(fileName("C:\\Users\\Simon\\Documents\\devis.pdf"), "devis.pdf");
  assert.equal(fileName("devis.pdf"), "devis.pdf");
});
