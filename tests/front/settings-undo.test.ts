// Tests des aides des Réglages (1.2.5) : annuler un changement
// (src/settings/undo.ts), les préréglages en un clic (src/settings/presets.ts)
// et la pastille « Modifié » (src/settings/modified.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleManifest } from "../../src/core/module-types";
import { defaultSettings } from "../../src/core/types";
import { ANIMATION_SUBS } from "../../src/settings/layout";
import { getPath, ISLAND_PATHS, isModified, islandDefault, islandRowModified, setPath } from "../../src/settings/modified";
import { activePreset, animationPresets, CALM_OFF, LOOK_PRESETS, sameValue, type PresetTarget } from "../../src/settings/presets";
import { applyPatchInPlace, typingTarget, UndoStack } from "../../src/settings/undo";

function manifests(): ModuleManifest[] {
  const dir = "src/modules";
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(join(dir, d.name, "manifest.json"), "utf8")) as ModuleManifest);
}
const HALOS = manifests().find((m) => m.id === "halos")?.settings?.fields ?? [];

const base = () => ({ island: { theme: "aurora", motion: "classic" }, general: { language: "auto" } });

describe("annuler un changement", () => {
  test("annuler remet l'avant, refaire remet l'après", () => {
    const stack = new UndoStack();
    const before = base();
    const after = { ...base(), island: { theme: "sunset", motion: "classic" } };
    const entry = stack.record(before, after, "Thème", 0);
    assert.ok(entry);
    const draft = structuredClone(after) as Record<string, unknown>;
    applyPatchInPlace(draft, stack.undo()!.undo);
    assert.deepEqual(draft, before);
    assert.ok(stack.canRedo);
    applyPatchInPlace(draft, stack.redo()!.redo);
    assert.deepEqual(draft, after);
  });

  test("rien n'a changé : rien à annuler", () => {
    const stack = new UndoStack();
    assert.equal(stack.record(base(), base(), null, 0), null);
    assert.equal(stack.size, 0);
    assert.equal(stack.undo(), null);
  });

  test("le même réglage qui bouge vite ne fait qu'un changement, qui garde le tout premier « avant »", () => {
    const stack = new UndoStack(10, 1000);
    const a = base();
    const b = { ...base(), island: { theme: "b", motion: "classic" } };
    const c = { ...base(), island: { theme: "c", motion: "classic" } };
    stack.record(a, b, "Thème", 0);
    stack.record(b, c, "Thème", 500);
    assert.equal(stack.size, 1);
    const draft = structuredClone(c) as Record<string, unknown>;
    applyPatchInPlace(draft, stack.undo()!.undo);
    assert.deepEqual(draft, a);
  });

  test("après le délai, ou sur un autre réglage : deux changements", () => {
    const stack = new UndoStack(10, 1000);
    const a = base();
    const b = { ...base(), island: { theme: "b", motion: "classic" } };
    const c = { ...base(), island: { theme: "c", motion: "classic" } };
    const d = { ...c, general: { language: "en" } };
    stack.record(a, b, "Thème", 0);
    stack.record(b, c, "Thème", 5000);
    stack.record(c, d, "Langue", 5100);
    assert.equal(stack.size, 3);
    assert.equal(stack.undo()!.label, "Langue");
  });

  test("un nouveau changement efface ce qu'on pouvait refaire ; la pile est bornée", () => {
    const stack = new UndoStack(2, 0);
    let s: Record<string, unknown> = base();
    for (const t of ["a", "b", "c"]) {
      const next = { ...s, island: { theme: t } };
      stack.record(s, next, null, 0);
      s = next;
    }
    assert.equal(stack.size, 2);
    stack.undo();
    stack.record(s, { ...s, general: { language: "fr" } }, null, 0);
    assert.equal(stack.canRedo, false);
  });

  test("applyPatchInPlace : crée les objets du chemin, retire un champ, refuse __proto__", () => {
    const t: Record<string, unknown> = { a: { gone: 1 } };
    applyPatchInPlace(t, [
      { path: ["x", "y"], op: "set", value: [1, 2] },
      { path: ["a", "gone"], op: "remove" },
      { path: ["__proto__", "polluted"], op: "set", value: true },
    ]);
    assert.deepEqual(t, { a: {}, x: { y: [1, 2] } });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("Ctrl+Z dans un champ de texte annule la frappe, pas un réglage", () => {
    assert.ok(typingTarget("INPUT", "text", false));
    assert.ok(typingTarget("input", null, false));
    assert.ok(typingTarget("input", "search", false));
    assert.ok(typingTarget("TEXTAREA", null, false));
    assert.ok(typingTarget("div", null, true));
    assert.ok(!typingTarget("input", "checkbox", false));
    assert.ok(!typingTarget("input", "range", false));
    assert.ok(!typingTarget("button", null, false));
  });
});

describe("préréglages en un clic", () => {
  const set = animationPresets(HALOS);

  test("Animations et halos : Calme, Équilibré, Tout animé", () => {
    assert.equal(set.page, "animations");
    assert.deepEqual(set.presets.map((p) => p.label), ["Calme", "Équilibré", "Tout animé"]);
  });

  test("chaque préréglage touche l'intensité et chaque moment oui/non du module, rien d'autre", () => {
    const booleans = HALOS.filter((f) => f.type === "boolean").map((f) => f.key);
    assert.ok(booleans.length > 5);
    for (const p of set.presets) {
      const keys = p.values.map((v) => ("key" in v.target ? v.target.key : v.target.path));
      assert.deepEqual(keys.sort(), ["intensity", ...booleans].sort(), p.id);
    }
  });

  test("les moments de Calme existent dans le manifeste (ou dans un sous-menu d'Animations)", () => {
    const known = new Set([...HALOS.map((f) => f.key), ...ANIMATION_SUBS.flatMap((s) => s.blocks.flatMap((b) => b.keys))]);
    for (const k of CALM_OFF) assert.ok(known.has(k), k);
  });

  test("Équilibré = les valeurs d'origine ; Calme coupe ses moments ; Tout animé les allume tous", () => {
    const read = (preset: string) => (t: PresetTarget) => set.presets.find((p) => p.id === preset)!.values.find((v) => sameValue(v.target, t))?.value;
    const defaults = (t: PresetTarget) => {
      const f = HALOS.find((x) => "key" in t && x.key === t.key);
      return f && "default" in f ? f.default : undefined;
    };
    assert.equal(activePreset(set, defaults), "balanced");
    const calm = set.presets.find((p) => p.id === "calm")!;
    for (const v of calm.values) if ("key" in v.target && CALM_OFF.includes(v.target.key)) assert.equal(v.value, false);
    assert.equal(activePreset(set, read("lively")), "lively");
    assert.equal(activePreset(set, read("calm")), "calm");
  });

  test("des réglages à soi : « Personnalisé » (aucun préréglage)", () => {
    assert.equal(activePreset(set, () => "autre chose"), null);
  });

  test("Apparence : chaque préréglage vise de vrais réglages de l'île", () => {
    const d = defaultSettings();
    for (const p of LOOK_PRESETS.presets) for (const v of p.values) assert.ok("path" in v.target && getPath(d, v.target.path) !== undefined, p.id);
    assert.equal(activePreset(LOOK_PRESETS, (t) => ("path" in t ? getPath(d, t.path) : undefined)), "classic");
  });
});

describe("la pastille « Modifié »", () => {
  test("une valeur différente de l'origine est modifiée ; une valeur absente ne l'est pas", () => {
    assert.ok(isModified("sunset", "aurora"));
    assert.ok(!isModified("aurora", "aurora"));
    assert.ok(!isModified(undefined, "aurora"));
    assert.ok(!isModified([1, 2], [1, 2]));
  });

  test("chaque ligne des pages de l'île vise un vrai réglage (defaultSettings)", () => {
    for (const [page, rows] of Object.entries(ISLAND_PATHS))
      for (const [row, paths] of Object.entries(rows)) for (const p of paths) assert.notEqual(islandDefault(p), undefined, `${page} › ${row} : ${p}`);
  });

  test("« Bord de l'écran » : modifié si l'un de ses réglages l'est", () => {
    const s = defaultSettings() as unknown as Record<string, unknown>;
    const paths = ISLAND_PATHS.behavior["Bord de l'écran"];
    assert.ok(!islandRowModified(s, paths));
    setPath(s, "island.edge", "bottom");
    assert.ok(islandRowModified(s, paths));
  });

  test("getPath et setPath", () => {
    const o: Record<string, unknown> = {};
    setPath(o, "a.b.c", { x: 1 });
    assert.deepEqual(getPath(o, "a.b.c"), { x: 1 });
    assert.equal(getPath(o, "a.z.c"), undefined);
  });
});
