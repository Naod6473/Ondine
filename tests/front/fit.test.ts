// Tests de l'île qui grandit pour montrer un contenu en entier
// (src/island/fit.ts) : la hauteur voulue, et ses bornes.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BASE_H, BASE_W, FIT_MAX_H, FIT_MAX_W, FIT_MIN_W, fitHeight, fitMode, fitWidth, settle } from "../../src/island/fit";

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

describe("largeur de l'île ouverte (data-island-fit=\"both\")", () => {
  test("la valeur de l'attribut : la hauteur seule par défaut", () => {
    assert.equal(fitMode(""), "height");
    assert.equal(fitMode(null), "height");
    assert.equal(fitMode("both"), "both");
  });

  test("une réponse courte : l'île se resserre, avec un peu d'air", () => {
    // Île de 640 px, vue de 580 px (60 px de mascotte et de marges), bulles de 340 px.
    const w = fitWidth(640, 580, 340) ?? 0;
    assert.ok(w >= 460 && w <= 461, String(w));
  });

  test("jamais plus étroite que les onglets ni que le minimum", () => {
    assert.equal(fitWidth(640, 580, 50), FIT_MIN_W);
    assert.equal(fitWidth(640, 580, 340, 520), 520);
    // Des onglets plus larges que l'île : la largeur habituelle suffit (ils défilent).
    assert.equal(fitWidth(640, 580, 340, 900), null);
  });

  test("un contenu large : un peu plus large, jamais plus que la fenêtre", () => {
    assert.equal(fitWidth(640, 580, 2000), FIT_MAX_W);
    assert.equal(fitWidth(640, 580, 2000, 0, 676), 676);
  });

  test("près de la largeur habituelle : on ne bouge pas", () => {
    assert.equal(fitWidth(640, 580, 494), null);
    assert.equal(BASE_W, 640);
  });

  test("pendant l'animation, la même réponse", () => {
    assert.equal(fitWidth(500, 440, 340), fitWidth(640, 580, 340));
  });
});

describe("suivre un texte qui s'écrit (settle)", () => {
  test("elle grandit tout de suite", () => {
    assert.equal(settle(300, 312), 312);
    assert.equal(settle(null, 312), 312);
  });

  test("elle ne rétrécit que nettement (pas de va-et-vient d'un mot)", () => {
    assert.equal(settle(312, 305), 312);
    assert.equal(settle(312, 290), 290);
  });

  test("plus rien à montrer en entier : sa taille habituelle", () => {
    assert.equal(settle(312, null), null);
  });
});
