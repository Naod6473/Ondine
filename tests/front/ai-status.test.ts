// Tests des textes de la surveillance des services IA (src/modules/nettools/ai-text.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { changeTitle, durationText, levelText, outageText, serviceOfAgent } from "../../src/modules/nettools/ai-text";

describe("services IA : textes", () => {
  test("durées", () => {
    assert.equal(durationText(10_000), "1 min");
    assert.equal(durationText(45 * 60_000), "45 min");
    assert.equal(durationText(130 * 60_000), "2 h 10");
    assert.equal(durationText(120 * 60_000), "2 h");
    assert.equal(durationText(3 * 86_400_000), "3 j");
  });

  test("historique et notifications", () => {
    assert.equal(outageText({ id: "claude", from: 0, to: 45 * 60_000, level: "down" }, 0), "Claude · en panne · 45 min");
    assert.equal(outageText({ id: "gemini", from: 0, to: null, level: "degraded" }, 5 * 60_000), "Gemini · perturbé · en cours depuis 5 min");
    const r = { id: "claude", name: "Claude", description: "", checkedAt: 0 };
    assert.equal(changeTitle({ ...r, level: "down" }), "Claude est en panne");
    assert.equal(changeTitle({ ...r, level: "degraded" }), "Claude a un incident en cours");
    assert.equal(changeTitle({ ...r, level: "ok" }), "Claude fonctionne à nouveau");
    assert.equal(levelText("unknown"), "état inconnu");
  });

  test("le service d'un agent", () => {
    assert.equal(serviceOfAgent("claude-code"), "claude");
    assert.equal(serviceOfAgent("codex"), "chatgpt");
    assert.equal(serviceOfAgent("gemini"), "gemini");
    assert.equal(serviceOfAgent("aider"), null);
  });
});
