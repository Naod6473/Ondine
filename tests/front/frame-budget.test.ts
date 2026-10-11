import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameBudget } from "../../src/core/frame-budget";
test("le dessin éco reste plafonné sur les écrans 60, 120 et 144 Hz", () => {
  for (const refresh of [60, 120, 144]) {
    const budget = new FrameBudget();
    let draws = 0;
    let last = -1000;
    for (let frame = 0; frame < refresh * 5; frame++) {
      const now = frame * 1000 / refresh;
      if (!budget.due(now, 30)) continue;
      assert.ok(now - last >= 1000 / 30 - 0.01);
      last = now; draws++;
    }
    assert.ok(draws <= 150 && draws >= 120, `${refresh} Hz : ${draws} dessins`);
  }
});
