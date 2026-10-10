// Tests du liquide à l'intérieur de l'île : les calculs purs
// (src/island/liquid-rules.ts) et ce que le manifeste du module « Animations
// de l'île » doit déclarer pour lui.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, FG, MUTED, contrastRatio } from "../../src/island/themes";
import {
  agitation,
  chooseColor,
  cssToHex,
  FEEL,
  isNight,
  LIQUID_COLORS,
  makeSurface,
  matterOf,
  MATTERS,
  MOMENT_TINTS,
  readablePaint,
  seenThrough,
  splash,
  stepSurface,
  surfaceEnergy,
  timedLevel,
  TEXT_CONTRAST,
} from "../../src/island/liquid-rules";

describe("liquide : la hauteur qui suit le temps", () => {
  test("« fill » monte de 0 à 1, « drain » descend", () => {
    const total = 60_000;
    const end = 100_000;
    assert.equal(timedLevel(end - total, end, total, "fill", 0), 0);
    assert.equal(timedLevel(end - total / 2, end, total, "fill", 0), 0.5);
    assert.equal(timedLevel(end, end, total, "fill", 0), 1);
    assert.equal(timedLevel(end + 5000, end, total, "fill", 0), 1);
    assert.equal(timedLevel(end - total / 4, end, total, "drain", 0), 0.25);
  });
  test("sans fin (en pause) : la hauteur donnée", () => {
    assert.equal(timedLevel(0, null, 60_000, "fill", 0.4), 0.4);
    assert.equal(timedLevel(0, 1000, 0, "fill", 2), 1);
  });
  test("l'eau s'agite seulement dans les 10 dernières secondes", () => {
    assert.equal(agitation(0, 60_000), 0);
    assert.equal(agitation(55_000, 60_000), 0.5);
    assert.equal(agitation(60_000, 60_000), 1);
    assert.equal(agitation(0, null), 0);
  });
});

describe("liquide : la surface", () => {
  test("une vaguelette se propage puis s'amortit, dans chaque matière", () => {
    for (const m of MATTERS) {
      const s = makeSurface(48);
      splash(s, 0.5, 200);
      stepSurface(s, FEEL[m], 1 / 60);
      const early = surfaceEnergy(s);
      assert.ok(early > 0, m);
      // Les bords ont bougé : la vague voyage.
      for (let i = 0; i < 240; i++) stepSurface(s, FEEL[m], 1 / 60);
      assert.ok(surfaceEnergy(s) < early * 0.05, `${m} : amortie`);
      for (const h of s.h) assert.ok(Number.isFinite(h), `${m} : stable`);
    }
  });
  test("stable même à 20 images par seconde (pas qui ne divergent pas)", () => {
    const s = makeSurface(48);
    splash(s, 0.2, 400);
    for (let i = 0; i < 200; i++) stepSurface(s, FEEL.light, 1 / 20);
    assert.ok(surfaceEnergy(s) < 1);
  });
  test("le lac (calm = 1) s'apaise plus vite", () => {
    const a = makeSurface(48);
    const b = makeSurface(48);
    splash(a, 0.5, 200);
    splash(b, 0.5, 200);
    for (let i = 0; i < 30; i++) {
      stepSurface(a, FEEL.water, 1 / 60, 0);
      stepSurface(b, FEEL.water, 1 / 60, 1);
    }
    assert.ok(surfaceEnergy(b) < surfaceEnergy(a));
  });
});

describe("liquide : couleurs et lisibilité", () => {
  test("matière inconnue → eau", () => {
    assert.equal(matterOf("lave"), "water");
    assert.equal(matterOf("sand"), "sand");
  });
  test("couleur : celle de l'île par défaut, nommée, personnelle, mascotte", () => {
    assert.equal(chooseColor("island", "", "#7cc4ff", "#ff0000"), "#7cc4ff");
    assert.equal(chooseColor(undefined, "", "#7cc4ff", ""), "#7cc4ff");
    assert.equal(chooseColor("pink", "", "#7cc4ff", ""), LIQUID_COLORS.pink);
    assert.equal(chooseColor("custom", "#FF00AA", "#7cc4ff", ""), "#ff00aa");
    assert.equal(chooseColor("custom", "rouge", "#7cc4ff", ""), "#7cc4ff");
    assert.equal(chooseColor("mascot", "", "#7cc4ff", "#62e6c4"), "#62e6c4");
    assert.equal(chooseColor("island", "", "pas une couleur", ""), LIQUID_COLORS.blue);
  });
  test("le texte garde 4,5:1 sur chaque thème, chaque couleur, à l'opacité la plus forte", () => {
    const colors = [...Object.values(LIQUID_COLORS), ...Object.values(MOMENT_TINTS), "#ffffff", "#ffff00"];
    for (const theme of THEMES) {
      const bg = cssToHex(theme.bg, "#000000");
      const muted = theme.muted ?? MUTED;
      for (const c of colors) {
        for (const additive of [false, true]) {
          const p = readablePaint(c, bg, muted, 0.8, additive);
          const seen = seenThrough(bg, p.color, p.alpha, p.additive);
          assert.ok(contrastRatio(muted, seen) >= TEXT_CONTRAST - 0.01, `${theme.id} ${c} ${additive}`);
          assert.ok(contrastRatio(FG, seen) >= TEXT_CONTRAST, `${theme.id} ${c} texte principal`);
          assert.ok(p.alpha > 0.1, `${theme.id} ${c} : le liquide se voit encore`);
        }
      }
    }
  });
  test("une couleur déjà sombre n'est pas changée", () => {
    const p = readablePaint("#1a3a6a", "#0c0d12", MUTED, 0.4, false);
    assert.equal(p.color, "#1a3a6a");
    assert.equal(p.alpha, 0.4);
  });
  test("lecture des couleurs CSS calculées", () => {
    assert.equal(cssToHex("rgb(12, 13, 18)", "#000000"), "#0c0d12");
    assert.equal(cssToHex(" #7CC4FF", "#000000"), "#7cc4ff");
    assert.equal(cssToHex("rgba(0, 0, 0, 0)", "#123456"), "#123456");
    // En partie transparent (thème Verre) : vu au pire sur un bureau blanc, donc plus clair.
    assert.ok(cssToHex("rgba(18, 20, 28, 0.78)", "#000000") > "#121418");
    assert.equal(cssToHex("n'importe quoi", "#abcdef"), "#abcdef");
  });
  test("la nuit : de 22 h à 6 h", () => {
    assert.equal(isNight(new Date(2026, 9, 10, 23, 0)), true);
    assert.equal(isNight(new Date(2026, 9, 10, 5, 59)), true);
    assert.equal(isNight(new Date(2026, 9, 10, 6, 0)), false);
    assert.equal(isNight(new Date(2026, 9, 10, 14, 0)), false);
  });
});

describe("liquide : le manifeste du module « Animations de l'île »", () => {
  const m = JSON.parse(readFileSync("src/modules/halos/manifest.json", "utf8")) as {
    settings: { fields: { key: string; type: string; default: unknown; essential?: boolean; options?: { value: string }[] }[] };
    events: { emits: string[]; listens: string[] };
  };
  const field = (k: string) => m.settings.fields.find((f) => f.key === k);
  test("la case maîtresse est activée, et une case par moment", () => {
    assert.equal(field("liquid")?.default, true);
    for (const k of ["liquidTimer", "liquidFiles", "liquidBattery", "liquidDisk", "liquidAgents", "liquidMusic", "liquidVoice", "liquidRain", "liquidCpu", "liquidNight", "liquidNotify", "liquidFocus", "liquidOndine"]) {
      assert.equal(field(k)?.type, "boolean", k);
    }
  });
  test("matière, couleur, opacité", () => {
    assert.deepEqual(field("liquidMatter")?.options?.map((o) => o.value), [...MATTERS]);
    assert.equal(field("liquidColor")?.default, "island");
    assert.equal(field("liquidOpacity")?.type, "number");
    assert.deepEqual(field("liquidTimerStyle")?.options?.map((o) => o.value), ["both", "replace"]);
  });
  test("aucun réglage du liquide n'est « essentiel » (3 au plus par module)", () => {
    assert.ok(m.settings.fields.filter((f) => f.key.startsWith("liquid")).every((f) => !f.essential));
    assert.ok(m.settings.fields.filter((f) => f.essential).length <= 3);
  });
  test("le sujet island.liquid est déclaré, et les sources écoutées", () => {
    assert.ok(m.events.emits.includes("island.liquid"));
    for (const t of ["timer.progress", "timer.focus", "shelf.hash-progress", "shelf.downloaded", "team.progress", "system.battery-plug", "system.battery-low", "system.disk-low", "system.cpu-busy", "claude.thinking", "agents.event", "media.changed", "voice.level", "weather.updated", "notify.shown"]) {
      assert.ok(m.events.listens.includes(t), t);
    }
  });
});
