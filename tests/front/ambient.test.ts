// Tests des sons d'ambiance du Minuteur (1.2.3) : src/modules/timer/ambient-logic.ts
// (liste des sons, place pour les enregistrements, volume, liquide de l'île).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ambientList, ambientLiquidPlan, fileId, GENERATED, nextCrestIn, pickSound, volumeGain, WAVE_PERIOD_MS } from "../../src/modules/timer/ambient-logic";

describe("sons d'ambiance : la liste", () => {
  test("sans fichier : pluie, vagues, bruit doux, fabriqués par Ondine", () => {
    const list = ambientList({});
    assert.deepEqual(
      list.map((s) => s.id),
      ["rain", "waves", "noise"],
    );
    assert.ok(list.every((s) => s.kind !== "file" && !s.url));
    assert.equal(GENERATED.length, 3);
  });

  test("les enregistrements déposés s'ajoutent après, triés, avec un nom propre", () => {
    const list = ambientList({
      "../../assets/ambient/riviere.ogg": "/a/riviere.ogg",
      "../../assets/ambient/Café.mp3": "/a/cafe.mp3",
      "../../assets/ambient/mer-du-nord.wav": "/a/mer.wav",
      "../../assets/ambient/cafe.ogg": "/a/cafe2.ogg",
    });
    const files = list.filter((s) => s.kind === "file");
    assert.deepEqual(
      files.map((s) => s.label),
      ["Café", "Mer du nord", "Rivière"],
      "un seul « Café » (même identifiant), nom connu ou déduit",
    );
    assert.equal(files[0].url, "/a/cafe.mp3");
    assert.equal(files[1].icon, "🎧");
    assert.deepEqual(list.slice(0, 3).map((s) => s.id), ["rain", "waves", "noise"]);
  });

  test("identifiant de fichier sûr", () => {
    assert.equal(fileId("../../assets/ambient/Café du Coin.ogg"), "cafe-du-coin");
    assert.equal(fileId("C:\\x\\Forêt (nuit).mp3"), "foret-nuit");
    assert.equal(fileId("..."), "");
  });

  test("choix retenu, ou la pluie s'il n'existe plus", () => {
    const list = ambientList({});
    assert.equal(pickSound(list, "waves").id, "waves");
    assert.equal(pickSound(list, "file-disparu").id, "rain");
    assert.equal(pickSound(list, null).id, "rain");
  });

  test("volume : courbe au carré, bornée", () => {
    assert.equal(volumeGain(0), 0);
    assert.equal(volumeGain(-10), 0);
    assert.ok(Math.abs(volumeGain(100) - 0.8) < 1e-9);
    assert.ok(Math.abs(volumeGain(500) - 0.8) < 1e-9);
    assert.ok(Math.abs(volumeGain(50) - 0.2) < 1e-9);
    assert.equal(volumeGain(Number.NaN), 0);
  });
});

describe("sons d'ambiance : le liquide de l'île suit le son", () => {
  test("arrêté : rien", () => {
    assert.equal(ambientLiquidPlan({ on: false }), null);
  });

  test("pluie : gouttes sur la vitre, pas de vague", () => {
    const p = ambientLiquidPlan({ on: true, kind: "rain", volume: 40 })!;
    assert.equal(p.rain, true);
    assert.equal(p.waveEveryMs, 0);
  });

  test("vagues : une vague à chaque crête, au rythme du son", () => {
    const p = ambientLiquidPlan({ on: true, kind: "waves", volume: 40, periodMs: 9000 })!;
    assert.equal(p.rain, false);
    assert.equal(p.waveEveryMs, 9000);
    assert.equal(ambientLiquidPlan({ on: true, kind: "waves", periodMs: 10 })!.waveEveryMs, WAVE_PERIOD_MS);
  });

  test("plus fort : plus haut et plus agité, toujours borné", () => {
    const low = ambientLiquidPlan({ on: true, kind: "noise", volume: 10, level: 0.1 })!;
    const high = ambientLiquidPlan({ on: true, kind: "noise", volume: 90, level: 0.9 })!;
    assert.ok(high.level > low.level);
    assert.ok(high.wobble > low.wobble);
    const wild = ambientLiquidPlan({ on: true, kind: "file", volume: 900, level: 50 })!;
    assert.ok(wild.level <= 1 && wild.wobble <= 1);
  });

  test("prochaine crête : au quart du cycle, puis toutes les périodes", () => {
    const P = 9000;
    assert.equal(nextCrestIn(0, 0, P), 2250);
    assert.equal(nextCrestIn(2250, 0, P), 0);
    assert.equal(nextCrestIn(2251, 0, P), P - 1);
    assert.equal(nextCrestIn(2250 + 3 * P - 1000, 0, P), 1000);
    assert.equal(nextCrestIn(-1000, 0, P), 3250, "même avant le début (horloge qui recule)");
  });
});
