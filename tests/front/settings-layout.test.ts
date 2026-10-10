// Tests du rangement des Réglages (src/settings/layout.ts, 1.2.2) : aucun
// réglage perdu en route, les anciennes pages mènent à leur nouvelle place.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleManifest } from "../../src/core/module-types";
import { allKey, ANIMATION_SUBS, FORMER_NAMES, MODULE_CATEGORIES, MODULES_ELSEWHERE, MOVED_FIELDS, NAV_GROUPS, resolvePlace } from "../../src/settings/layout";
import { ISLAND_ESSENTIALS } from "../../src/settings/visibility";

function manifests(): ModuleManifest[] {
  const dir = "src/modules";
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(join(dir, d.name, "manifest.json"), "utf8")) as ModuleManifest);
}
const MODS = manifests();
const fieldsOf = (id: string) => MODS.find((m) => m.id === id)?.settings?.fields ?? [];

describe("Animations et halos", () => {
  test("chaque champ du module Animations de l'île est dans un sous-menu, une seule fois", () => {
    const placed = ANIMATION_SUBS.flatMap((s) => s.blocks.filter((b) => b.module === "halos").flatMap((b) => b.keys));
    assert.equal(new Set(placed).size, placed.length, "un champ rangé deux fois");
    assert.deepEqual(fieldsOf("halos").map((f) => f.key).filter((k) => !placed.includes(k)), []);
  });

  test("chaque clé rangée existe dans le manifeste de son module", () => {
    for (const s of ANIMATION_SUBS) for (const b of s.blocks) for (const k of b.keys) assert.ok(fieldsOf(b.module).some((f) => f.key === k), `${b.module}.${k}`);
  });

  test("les halos de batterie (Système) sont sur la page, et ne sont plus sur celle de Système", () => {
    const moved = MOVED_FIELDS.system;
    const onPage = ANIMATION_SUBS.find((s) => s.id === moved.sub)?.blocks.filter((b) => b.module === "system").flatMap((b) => b.keys) ?? [];
    assert.deepEqual([...onPage].sort(), [...moved.keys].sort());
    assert.equal(moved.page, "animations");
  });

  test("les cinq sous-menus du plan, plus le liquide ; chaque « Tout » a des moments à couper", () => {
    assert.deepEqual(ANIMATION_SUBS.map((s) => s.label), ["Style", "Le PC", "Ondine et les agents", "Son et clavier", "Ma journée", "Le liquide"]);
    for (const s of ANIMATION_SUBS.slice(1)) {
      const switches = s.blocks.flatMap((b) => fieldsOf(b.module).filter((f) => b.keys.includes(f.key) && f.type === "boolean"));
      assert.ok(switches.length >= 2, s.id);
    }
    assert.equal(new Set(ANIMATION_SUBS.map((s) => allKey(s.id))).size, ANIMATION_SUBS.length);
  });

  test("le liseré des minuteurs est dans Ma journée, « Où dessiner le halo » dans Style", () => {
    const subOf = (k: string) => ANIMATION_SUBS.find((s) => s.blocks.some((b) => b.module === "halos" && b.keys.includes(k)))?.id;
    assert.equal(subOf("timerRing"), "day");
    assert.equal(subOf("place"), "style");
  });
});

describe("barre latérale", () => {
  test("cinq groupes, dans l'ordre", () => {
    assert.deepEqual([...NAV_GROUPS], ["Ondine", "L'île", "Automatiser", "Modules", "Sécurité et système"]);
  });

  test("chaque module a une place : une catégorie, ou une page ailleurs", () => {
    const inCats = MODULE_CATEGORIES.flatMap((c) => c.modules);
    for (const m of MODS) assert.ok(inCats.includes(m.id) !== MODULES_ELSEWHERE.includes(m.id), `${m.id} : rangé zéro ou deux fois`);
  });
});

describe("anciennes places → nouvelles", () => {
  test("pages et sous-menus déplacés", () => {
    assert.deepEqual(resolvePlace("module:halos"), { page: "animations" });
    assert.deepEqual(resolvePlace("module:halos", "ondine"), { page: "animations", sub: "agents" });
    assert.deepEqual(resolvePlace("module:windowlife"), { page: "behavior", sub: "windows" });
    assert.deepEqual(resolvePlace("general", "updates"), { page: "updates" });
    assert.deepEqual(resolvePlace("general", "perf"), { page: "perf" });
    assert.deepEqual(resolvePlace("general", "about"), { page: "about" });
    assert.deepEqual(resolvePlace("general", "island"), { page: "behavior", sub: "island" });
  });

  test("une place qui n'a pas bougé reste la même", () => {
    assert.deepEqual(resolvePlace("mascot", "mood"), { page: "mascot", sub: "mood" });
    assert.deepEqual(resolvePlace("module:agents"), { page: "module:agents" });
    assert.deepEqual(resolvePlace("animations", "pc"), { page: "animations", sub: "pc" });
  });

  test("les anciens noms des pages sont gardés pour la recherche", () => {
    const names = Object.values(FORMER_NAMES).flat().map((f) => f.name);
    for (const n of ["Animations de l'île", "Ondine et les fenêtres", "Halos de batterie"]) assert.ok(names.includes(n), n);
    for (const [page, list] of Object.entries(FORMER_NAMES)) for (const f of list) if (f.sub) assert.ok(page === "animations" ? ANIMATION_SUBS.some((s) => s.id === f.sub) : true, `${page}/${f.sub}`);
  });
});

describe("mode Simple", () => {
  test("les pages rangées en 1.2.2 montrent au plus 3 réglages essentiels", () => {
    for (const id of ["general", "behavior", "look", "perf"]) {
      const ess = ISLAND_ESSENTIALS[id];
      assert.ok(Array.isArray(ess) && ess.length >= 1 && ess.length <= 3, id);
    }
  });
});
