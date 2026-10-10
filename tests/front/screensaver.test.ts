// Tests de l'écran de veille (1.2.3) : la promenade d'Ondine, les vagues et
// l'horloge (src/screensaver/walk.ts). L'affichage lui-même (quand, sur quel
// écran, fermeture) est décidé par le Rust : screensaver.rs, avec ses tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clockDrift, clockText, MARGIN, newWalker, stepWalker, waveHeight, type Walker } from "../../src/screensaver/walk";

/** Un hasard prévisible. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("écran de veille : la promenade", () => {
  test("au départ : au milieu, posée", () => {
    const w = newWalker(1000);
    assert.equal(w.x, 0.5);
    assert.equal(w.walking, false);
    assert.ok(w.until > 1000);
  });

  test("elle repart après sa pause, puis se pose à nouveau", () => {
    let w = newWalker(0);
    w = stepWalker(w, 0.033, w.until, seq(0.5, 0.9));
    assert.equal(w.walking, true);
    const x0 = w.x;
    w = stepWalker(w, 0.05, w.until - 1, seq(0.5));
    assert.notEqual(w.x, x0, "elle avance");
    w = stepWalker(w, 0.05, w.until, seq(0.5));
    assert.equal(w.walking, false);
  });

  test("elle ne sort jamais de l'écran et fait demi-tour aux bords", () => {
    let w: Walker = { x: 1 - MARGIN - 0.0001, dir: 1, walking: true, until: Number.MAX_SAFE_INTEGER };
    const next = stepWalker(w, 0.1, 0, Math.random);
    assert.ok(next.x <= 1 - MARGIN);
    assert.equal(next.dir, -1);
    let v: Walker = { ...w, x: MARGIN + 0.0001, dir: -1 };
    const back = stepWalker(v, 0.1, 0, Math.random);
    assert.ok(back.x >= MARGIN);
    assert.equal(back.dir, 1);
    // Un long trou (PC qui sort de veille) ne la téléporte pas.
    w = { ...w, x: 0.5 };
    assert.ok(Math.abs(stepWalker(w, 3600, 0, Math.random).x - 0.5) < 0.01);
    v = { ...v, x: 0.5 };
    for (let i = 0, now = 0; i < 5000; i++, now += 50) {
      v = stepWalker(v, 0.05, now, Math.random);
      assert.ok(v.x >= MARGIN && v.x <= 1 - MARGIN);
    }
  });

  test("au réglage Calme, elle marche moins vite et se pose plus longtemps", () => {
    const w = { x: 0.5, dir: 1 as const, walking: true, until: Number.MAX_SAFE_INTEGER };
    const fast = stepWalker(w, 0.1, 0, Math.random).x - 0.5;
    const calm = stepWalker(w, 0.1, 0, Math.random, true).x - 0.5;
    assert.ok(calm < fast && calm > 0);
    const rest = stepWalker({ ...w, until: 0 }, 0, 0, seq(0.5));
    const restCalm = stepWalker({ ...w, until: 0 }, 0, 0, seq(0.5), true);
    assert.ok(restCalm.until > rest.until);
  });
});

describe("écran de veille : eau et horloge", () => {
  test("les vagues restent entre -1 et 1", () => {
    for (let x = 0; x <= 1; x += 0.05) for (let t = 0; t < 60; t += 1.7) for (const layer of [0, 1, 2]) assert.ok(Math.abs(waveHeight(x, t, layer)) <= 1.0001);
  });

  test("l'horloge bouge un peu, lentement (écrans OLED), dans sa zone", () => {
    for (let m = 0; m < 600; m += 7) {
      const d = clockDrift(m * 60_000);
      assert.ok(Math.abs(d.x) <= 24 && Math.abs(d.y) <= 24);
    }
    const a = clockDrift(0);
    const b = clockDrift(1000);
    assert.deepEqual(a, b, "rien ne bouge d'une seconde à l'autre");
  });

  test("heure : 24 h en français, AM/PM en anglais", () => {
    const d = new Date(2026, 0, 5, 9, 5);
    assert.equal(clockText(d, false), "09:05");
    assert.equal(clockText(d, true), "9:05 AM");
    const e = new Date(2026, 0, 5, 0, 30);
    assert.equal(clockText(e, true), "12:30 AM");
    const f = new Date(2026, 0, 5, 23, 59);
    assert.equal(clockText(f, false), "23:59");
    assert.equal(clockText(f, true), "11:59 PM");
  });
});
