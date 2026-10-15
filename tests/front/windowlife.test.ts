// Tests du trou noir côté page (src/modules/windowlife/hole-logic.ts) et du
// manifeste d'Ondine et les fenêtres. Le tri des fenêtres permises, la liste
// et le fichier de secours sont testés côté Rust
// (src-tauri/src/modules/windowlife_hole.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { holeCountText, holePhrase, holeShown } from "../../src/modules/windowlife/hole-logic";

const MANIFEST = JSON.parse(readFileSync("src/modules/windowlife/manifest.json", "utf8")) as {
  views: string[];
  commands: string[];
  settings: { fields: { key: string; default: unknown }[] };
  events: { emits: string[]; listens: string[] };
};

describe("trou noir : textes", () => {
  test("rien à montrer quand il est vide", () => {
    assert.equal(holeShown(0), false);
    assert.equal(holeShown(1), true);
    assert.equal(holePhrase(0), null);
  });

  test("le nombre s'accorde", () => {
    assert.equal(holeCountText(1), "fenêtre avalée");
    assert.equal(holeCountText(3), "fenêtres avalées");
    assert.equal(holePhrase(1), "une fenêtre dans le trou noir");
    assert.equal(holePhrase(4), "4 fenêtres dans le trou noir");
  });
});

describe("trou noir : manifeste", () => {
  test("coupé par défaut (il cache des fenêtres)", () => {
    const field = MANIFEST.settings.fields.find((f) => f.key === "swallow");
    assert.ok(field, "réglage swallow");
    assert.equal(field.default, false);
  });

  test("la mini-île, les commandes et les sujets du bus sont déclarés", () => {
    assert.deepEqual(MANIFEST.views, ["compact"], "une vue compacte, pas d'onglet");
    for (const c of ["hole_list", "spit", "spit_all"]) assert.ok(MANIFEST.commands.includes(c), c);
    for (const topic of ["windowlife.hole", "windowlife.hole-hover", "windowlife.swallowed", "windowlife.spat"]) {
      assert.ok(MANIFEST.events.emits.includes(topic), `émet ${topic}`);
      assert.ok(MANIFEST.events.listens.includes(topic), `écoute ${topic}`);
    }
  });
});
