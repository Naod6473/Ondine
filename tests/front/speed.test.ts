// Tests du test de débit (module Réseau, 1.2.3) : src/modules/nettools/speed-logic.ts
// et la vitesse du liseré de l'île (speedLapMs, speedBeatMs dans halo-palettes.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mbpsText, PHASE_LABEL, speedLevel, speedRunning, speedVerdict } from "../../src/modules/nettools/speed-logic";
import { MIN_PERIOD_MS, speedBeatMs, speedLapMs } from "../../src/island/halo-palettes";

describe("test de débit : calculs", () => {
  test("le test tourne pendant ping, réception et envoi seulement", () => {
    assert.equal(speedRunning(null), false);
    for (const phase of ["ping", "down", "up"] as const) assert.equal(speedRunning({ phase }), true);
    for (const phase of ["done", "error", "stopped"] as const) assert.equal(speedRunning({ phase }), false);
    assert.ok(PHASE_LABEL.down && PHASE_LABEL.up && PHASE_LABEL.ping);
  });

  test("niveau du liseré : échelle logarithmique, bornée", () => {
    assert.equal(speedLevel(undefined), 0);
    assert.equal(speedLevel(Number.NaN), 0);
    assert.equal(speedLevel(0.5), 0);
    assert.equal(speedLevel(1), 0);
    assert.ok(Math.abs(speedLevel(10) - 1 / 3) < 1e-9);
    assert.ok(Math.abs(speedLevel(100) - 2 / 3) < 1e-9);
    assert.equal(speedLevel(1000), 1);
    assert.equal(speedLevel(10_000), 1);
    assert.ok(speedLevel(300) > speedLevel(50), "plus rapide → plus haut");
  });

  test("débit écrit à la française", () => {
    assert.equal(mbpsText(undefined), "0,0 Mbit/s");
    assert.equal(mbpsText(-3), "0,0 Mbit/s");
    assert.equal(mbpsText(12.46), "12,5 Mbit/s");
    assert.equal(mbpsText(245.4), "245 Mbit/s");
    assert.equal(mbpsText(1234), "1,2 Gbit/s");
  });

  test("verdict selon la réception", () => {
    assert.match(speedVerdict(undefined), /^Très lent/);
    assert.match(speedVerdict(3), /^Lent/);
    assert.match(speedVerdict(10), /^Correct/);
    assert.match(speedVerdict(50), /^Rapide/);
    assert.match(speedVerdict(500), /^Très rapide/);
  });
});

describe("test de débit : le liseré tourne et pulse plus vite avec le débit", () => {
  test("tour de la comète : 3,2 s → 0,7 s, borné", () => {
    assert.equal(speedLapMs(0), 3200);
    assert.equal(speedLapMs(1), 700);
    assert.equal(speedLapMs(-5), 3200);
    assert.equal(speedLapMs(9), 700);
    assert.equal(speedLapMs(Number.NaN), 3200);
    assert.ok(speedLapMs(0.7) < speedLapMs(0.3));
  });

  test("pulsation : jamais plus rapide que MIN_PERIOD_MS (pas de clignotement)", () => {
    assert.equal(speedBeatMs(0), 1600);
    assert.equal(speedBeatMs(1), MIN_PERIOD_MS);
    for (let l = 0; l <= 1; l += 0.1) assert.ok(speedBeatMs(l) >= MIN_PERIOD_MS);
    assert.ok(speedBeatMs(0.6) < speedBeatMs(0.2));
  });
});
