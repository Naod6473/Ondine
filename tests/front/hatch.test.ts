// Tests de l'éclosion de l'île (src/island/hatch-plan.ts) : quand elle joue,
// le minutage, la forme de l'île et le trajet des paillettes.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  END,
  FOLD_START,
  HALO,
  LAND,
  RING_COUNT,
  T,
  gapeAt,
  geometry,
  grainAt,
  gumAnimAt,
  hatchKind,
  inflateAt,
  islandAt,
  planDust,
  ringFill,
  ringWindow,
  soundCues,
  type HatchContext,
} from "../../src/island/hatch-plan";

const base: HatchContext = { firstRun: false, whatsNew: "nothing", enabled: true, quiet: false, edge: "top", style: "classic", petOut: false };

describe("quand l'éclosion joue", () => {
  test("premier lancement, puis après une mise à jour", () => {
    assert.equal(hatchKind({ ...base, firstRun: true }), "first");
    assert.equal(hatchKind({ ...base, whatsNew: "show" }), "update");
    assert.equal(hatchKind(base), null);
    assert.equal(hatchKind({ ...base, whatsNew: "remember" }), null);
  });
  test("jamais quand on ne la veut pas ou qu'elle ne peut pas sortir du haut", () => {
    for (const c of [{ enabled: false }, { quiet: true }, { edge: "left" }, { edge: "bottom" }, { style: "mouth" }, { petOut: true }]) {
      assert.equal(hatchKind({ ...base, firstRun: true, ...c }), null, JSON.stringify(c));
    }
  });
});

describe("le déroulé", () => {
  test("les étapes se suivent", () => {
    const steps = [0, T.open, T.burst, T.ondine, T.hello, T.mouth, T.suckEnd, T.blow, T.joy, T.fold, FOLD_START, LAND, HALO, END];
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], `étape ${i}`);
    assert.ok(END < 10, "moins de 10 secondes");
  });
  test("les anneaux sont pleins avant la fête", () => {
    for (let i = 0; i < RING_COUNT; i++) {
      assert.ok(ringWindow(i)[1] <= T.joy, `anneau ${i}`);
      assert.equal(ringFill(i, 0.86, T.joy), 0.86);
      assert.equal(ringFill(i, 1, T.blow - 0.01), 0);
    }
  });
  test("les sons sont dans l'ordre et pendant l'animation", () => {
    const cues = soundCues();
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i][0] >= cues[i - 1][0]);
    assert.ok(cues.every(([at]) => at > 0 && at < END));
  });
  test("Ondine : bouche, gonflement, animations du moteur", () => {
    assert.equal(gapeAt(T.mouth - 0.1), 0);
    assert.ok(gapeAt(T.mouth + 0.6) > 0.8);
    assert.equal(gapeAt(T.suckEnd + 0.2), 0);
    assert.equal(inflateAt(T.mouth), 0);
    assert.ok(inflateAt(T.suckEnd) > 0.25);
    assert.ok(inflateAt(T.joy + 0.3) < 0.02);
    assert.equal(gumAnimAt(T.hello + 0.5), "coucou");
    assert.equal(gumAnimAt(T.mouth + 0.5), "surpris");
    assert.equal(gumAnimAt(T.joy + 0.1), "celebrate");
  });
});

describe("la forme de l'île", () => {
  const G = geometry(720, 320);
  test("ouverte, puis repliée en mini-île", () => {
    const open = islandAt(G, T.joy);
    assert.ok(Math.abs(open.w - G.openW) < 1 && Math.abs(open.h - G.openH) < 1);
    const mini = islandAt(G, END);
    assert.ok(Math.abs(mini.w - G.miniW) < 1 && Math.abs(mini.h - G.miniH) < 1);
    assert.equal(mini.x, G.cx - mini.w / 2);
  });
  test("toujours collée en haut, dans la fenêtre", () => {
    for (let t = 0; t <= END; t += 0.02) {
      const s = islandAt(G, t);
      assert.equal(s.y, 0);
      assert.ok(s.w > 0 && s.h > 0 && s.r >= 0 && s.r <= s.h);
      assert.ok(s.w <= G.width && s.h <= G.height, `t = ${t.toFixed(2)}`);
    }
  });
});

describe("les paillettes", () => {
  const G = geometry(720, 320);
  const values = [1, 1, 0.86];
  const dust = planDust(G, values);
  test("le même éclat à chaque fois", () => {
    assert.deepEqual(planDust(G, values), dust);
  });
  test("avalées avant d'être soufflées, chacune pile sur son anneau", () => {
    for (const g of dust) {
      assert.ok(g.swallowAt <= T.suckEnd + 1e-9);
      assert.ok(g.landAt - 0.45 > g.swallowAt, "soufflée après avoir été avalée");
      assert.ok(Math.abs(ringFill(g.ring, values[g.ring], g.landAt) - g.fill) < 1e-6);
    }
  });
  test("elles restent dans la fenêtre de l'île", () => {
    for (let t = T.burst; t <= END; t += 0.05) {
      for (const g of dust) {
        const p = grainAt(G, g, t);
        if (!p) continue;
        assert.ok(p.x > -10 && p.x < G.width + 10 && p.y > -10 && p.y < G.height + 10, `t = ${t.toFixed(2)}`);
      }
    }
  });
  test("plus aucune à la fin", () => {
    assert.ok(dust.every((g) => grainAt(G, g, T.joy + 0.01) === null));
  });
});
