// Tests du pont de fichier à travers l'île (src/modules/team/bridge-path.ts) :
// la feuille plonge, traverse et sort à droite (envoi), ou entre par la gauche
// et se pose au milieu (réception), toujours en un temps borné.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bridgeLook, MAX_S, startBridge, stepBridge, type BridgeState } from "../../src/modules/team/bridge-path";

/** Fait tourner le pont à 60 images/s ; renvoie les états vus. */
function run(s: BridgeState, maxS = MAX_S + 1): BridgeState[] {
  const seen: BridgeState[] = [];
  for (let t = 0; t < maxS && s.phase !== "done"; t += 1 / 60) {
    stepBridge(s, 1 / 60);
    seen.push(structuredClone(s));
  }
  return seen;
}

describe("pont de fichier", () => {
  test("envoi : plonge dans l'île, puis sort par le bord droit", () => {
    const s = startBridge(1);
    assert.equal(s.phase, "dive");
    assert.ok(s.y.x < 0, "elle part d'au-dessus de l'île");
    const seen = run(s);
    assert.equal(s.phase, "done");
    assert.ok(s.t < 2.5, `fini en ${s.t.toFixed(2)} s`);
    assert.ok(seen.some((x) => x.phase === "cross"), "elle traverse");
    assert.ok(s.x.x > 1.1, "elle est sortie à droite");
    // Elle ne repart pas en arrière pendant la traversée.
    const xs = seen.filter((x) => x.phase === "cross").map((x) => x.x.x);
    assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-9));
  });

  test("réception : entre par la gauche et se pose au milieu", () => {
    const s = startBridge(-1);
    assert.ok(s.x.x < 0);
    const seen = run(s);
    assert.equal(s.phase, "done");
    assert.ok(seen.some((x) => x.phase === "land"));
    assert.ok(Math.abs(s.x.x - 0.5) < 0.05);
  });

  test("écrasée en gelée, volume gardé, fondu à la fin", () => {
    const s = startBridge(1);
    for (const st of run(s)) {
      const l = bridgeLook(st);
      assert.ok(Math.abs(l.sx * l.sy - 1) < 1e-9);
      assert.ok(l.alpha >= 0 && l.alpha <= 1);
      assert.ok(Math.abs(l.rot) <= 0.35);
    }
    assert.equal(bridgeLook(s).alpha, 0);
  });

  test("jamais plus long que le garde-fou", () => {
    const s = startBridge(1);
    // Une image énorme (onglet en arrière-plan) ne bloque rien.
    for (let i = 0; i < 200; i++) stepBridge(s, 0.05);
    assert.equal(s.phase, "done");
  });
});
