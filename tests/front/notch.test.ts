// Le style d'île « Encoche » (island.style = "notch", 1.2.5) : proposé dans les
// Réglages avec sa vignette, et la feuille de style couvre les quatre bords.
// (Les fichiers sont lus en texte : vignettes.ts et island-forms.ts tirent le
// DOM et les icônes, que ces tests ne compilent pas.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

test("encoche : proposée dans les Réglages, avec sa vignette et sa traduction", () => {
  assert.match(read("src/settings/main.ts"), /\["notch", "Encoche"\]/);
  assert.match(read("src/settings/vignettes.ts"), /style === "notch"[^\n]*vg-notch/);
  assert.match(read("src/core/i18n-en.json"), /"Encoche": "Notch"/);
  assert.match(read("src/island/island-forms.ts"), /style === "mouth" \|\| style === "notch"/);
});

test("encoche : coins creux et lueur pour chaque bord", () => {
  const css = read("src/styles/island-notch.css");
  for (const edge of ["bottom", "left", "right"]) assert.match(css, new RegExp(`data-edge="${edge}"\\] \\.notch-ears`), edge);
  assert.match(css, /:not\(\.retro\) \.island::before/);
  assert.match(read("index.html"), /island-notch\.css/);
});
