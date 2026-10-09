// Tests du podium des mascottes (src/settings/podium-layout.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { podiumOrder, podiumRows } from "../../src/settings/podium-layout";

describe("podium des mascottes", () => {
  test("les marches : 1, 3, 5, 6, puis des rangées de 6", () => {
    assert.deepEqual(podiumRows(15), [1, 3, 5, 6]);
    assert.deepEqual(podiumRows(4), [1, 3]);
    assert.deepEqual(podiumRows(1), [1]);
    assert.deepEqual(podiumRows(20), [1, 3, 5, 6, 5]);
    assert.deepEqual(podiumRows(0), []);
  });

  test("la mascotte choisie en haut, puis l'ordre retenu, puis les nouvelles", () => {
    assert.deepEqual(podiumOrder(["a", "b", "c", "d"], "c", ["d", "a"]), ["c", "d", "a", "b"]);
    // Un id retenu qui n'existe plus est oublié ; la choisie n'est pas en double.
    assert.deepEqual(podiumOrder(["a", "b"], "b", ["x", "b", "a"]), ["b", "a"]);
    // Une mascotte choisie absente du catalogue : on garde les autres.
    assert.deepEqual(podiumOrder(["a", "b"], "z", []), ["a", "b"]);
  });
});
