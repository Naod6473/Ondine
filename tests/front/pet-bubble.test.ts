// La bulle d'Ondine sur le bureau suit son contenu (src/pet/bubble-size.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUBBLE_MAX_H, BUBBLE_MAX_W, BUBBLE_MIN_H, BUBBLE_MIN_W, clampBubble, roomFor, sameSize } from "../../src/pet/bubble-size";

test("la bulle reste entre ses bornes et la place de l'écran", () => {
  assert.deepEqual(clampBubble({ w: 100, h: 40 }), { w: BUBBLE_MIN_W, h: BUBBLE_MIN_H });
  assert.deepEqual(clampBubble({ w: 2000, h: 2000 }), { w: BUBBLE_MAX_W, h: BUBBLE_MAX_H });
  assert.deepEqual(clampBubble({ w: 500.2, h: 300.6 }), { w: 501, h: 301 });
  // Petit écran : la place qui reste borne la bulle (jamais sous le minimum).
  assert.deepEqual(clampBubble({ w: 600, h: 500 }, { w: 450, h: 320 }), { w: 450, h: 320 });
  assert.deepEqual(clampBubble({ w: 600, h: 500 }, { w: 10, h: 10 }), { w: BUBBLE_MIN_W, h: BUBBLE_MIN_H });
  assert.deepEqual(clampBubble({ w: NaN, h: Infinity }), { w: BUBBLE_MIN_W, h: BUBBLE_MIN_H });
});

test("la fenêtre garde la place de tout le trajet", () => {
  assert.deepEqual(roomFor({ w: 640, h: 200 }, { w: 400, h: 500 }), { w: 640, h: 500 });
  assert.ok(sameSize({ w: 400, h: 300 }, { w: 400.3, h: 299.8 }));
  assert.ok(!sameSize({ w: 400, h: 300 }, { w: 401, h: 300 }));
  assert.ok(!sameSize(null, { w: 1, h: 1 }));
});

test("mêmes bornes que le Rust (src-tauri/src/pet.rs)", () => {
  const rs = readFileSync("src-tauri/src/pet.rs", "utf8");
  const val = (name: string) => Number(new RegExp(`pub const ${name}: f64 = ([\\d.]+);`).exec(rs)?.[1]);
  assert.equal(val("BUBBLE_MIN_W"), BUBBLE_MIN_W);
  assert.equal(val("BUBBLE_MIN_H"), BUBBLE_MIN_H);
  assert.equal(val("BUBBLE_MAX_W"), BUBBLE_MAX_W);
  assert.equal(val("BUBBLE_MAX_H"), BUBBLE_MAX_H);
});
