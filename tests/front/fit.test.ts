// Tests de l'île qui grandit pour montrer un contenu en entier
// (src/island/fit.ts) : la hauteur voulue, et ses bornes.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BASE_H, FIT_MAX_H, fitHeight } from "../../src/island/fit";

describe("hauteur de l'île ouverte", () => {
  test("le contenu tient : la taille habituelle", () => {
    // Île de 270 px, vue de 200 px (70 px d'onglets et de marges), contenu de 150 px.
    assert.equal(fitHeight(270, 200, 150), null);
    assert.equal(fitHeight(270, 200, 200), null);
  });

  test("le contenu dépasse : l'île grandit de ce qui manque", () => {
    // Un QR code : 300 px de contenu dans une vue de 200 px → 70 + 300.
    assert.equal(fitHeight(270, 200, 300), 370);
    // Mesures au demi-pixel : arrondi au-dessus (rien de coupé).
    assert.equal(fitHeight(270, 200, 300.4), 371);
  });

  test("pendant l'animation, la même réponse (onglets et marges ne changent pas)", () => {
    // L'île est à mi-chemin (320 px, vue de 250 px) : toujours 70 + 300.
    assert.equal(fitHeight(320, 250, 300), 370);
    // Déjà agrandie : la réponse ne bouge plus (pas d'oscillation).
    assert.equal(fitHeight(370, 300, 300), 370);
  });

  test("jamais plus haut que le panneau haut", () => {
    assert.equal(fitHeight(270, 200, 2000), FIT_MAX_H);
    assert.ok(FIT_MAX_H > BASE_H);
  });
});
