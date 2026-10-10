// Tests d'Ondine qui se déplace dans l'île (src/island/scenes/) : les sauts de
// gomme, les places à côté d'un élément (sans cacher de texte), et les règles
// qui décident d'une scène (Réduire les animations, Calme, île-bouche…).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boxAt, clampFoot, crossing, CROUCH_END, hopAt, hopMs, inside, intersects, LAND_START, pickSpot, planHops, progressFoot, type Rect } from "../../src/island/scenes/scene-path";
import {
  dayEndMinutes,
  dayKey,
  isEvening,
  isLoud,
  islandStyle,
  isSceneId,
  progressOf,
  SCENE_IDS,
  SCENES,
  SceneGaps,
  sceneMode,
  walkSetting,
  weatherKind,
  type SceneContext,
} from "../../src/island/scenes/scene-rules";
import { ANIMATION_SUBS } from "../../src/settings/layout";

const ISLAND: Rect = { left: 0, top: 0, width: 640, height: 270 };

describe("les sauts de gomme", () => {
  test("un trajet est découpé en pas réguliers, qui finissent au bon endroit", () => {
    const hops = planHops({ x: 0, y: 100 }, { x: 200, y: 100 });
    assert.equal(hops.length, Math.ceil(200 / (46 + 200 * 0.07)));
    // Un long trajet (toute l'île) : une poignée de sauts, pas vingt.
    assert.ok(planHops({ x: 0, y: 0 }, { x: 600, y: 0 }).length <= 8);
    assert.deepEqual(hops[0].from, { x: 0, y: 100 });
    assert.deepEqual(hops[hops.length - 1].to, { x: 200, y: 100 });
    for (const h of hops) assert.ok(Math.abs(h.to.x - h.from.x - 200 / hops.length) < 1e-9);
  });

  test("pas de saut pour un trajet nul ; un saut vers le haut monte plus haut", () => {
    assert.deepEqual(planHops({ x: 5, y: 5 }, { x: 5.4, y: 5 }), []);
    const flat = planHops({ x: 0, y: 100 }, { x: 40, y: 100 })[0];
    const up = planHops({ x: 0, y: 100 }, { x: 40, y: 70 })[0];
    assert.ok(up.height > flat.height);
  });

  test("élan tassé, vol en arc au-dessus de la ligne, atterrissage écrasé, volume à peu près gardé", () => {
    const hop = { from: { x: 0, y: 100 }, to: { x: 40, y: 100 }, height: 20 };
    const crouch = hopAt(hop, CROUCH_END * 0.99);
    assert.ok(crouch.ground && crouch.sy < 0.9 && crouch.sx > 1);
    assert.equal(crouch.x, 0);
    const apex = hopAt(hop, (CROUCH_END + LAND_START) / 2);
    assert.ok(!apex.ground);
    assert.ok(apex.y < 100 - 15, `au sommet : ${apex.y}`);
    const land = hopAt(hop, LAND_START + 0.001);
    assert.ok(land.ground && land.sy < 0.85, `écrasée : ${land.sy}`);
    const end = hopAt(hop, 1);
    assert.equal(end.x, 40);
    assert.equal(end.y, 100);
    assert.ok(Math.abs(end.sy - 1) < 0.08);
    for (let k = 0; k <= 1; k += 0.05) {
      const f = hopAt(hop, k);
      assert.ok(Math.abs(f.sx * f.sy - 1) < 0.12, `volume à ${k} : ${f.sx * f.sy}`);
    }
  });

  test("un saut dure environ un tiers de seconde", () => {
    const ms = hopMs({ from: { x: 0, y: 0 }, to: { x: 46, y: 0 }, height: 10 });
    assert.ok(ms >= 270 && ms <= 410, String(ms));
  });
});

describe("les places", () => {
  test("le pied reste dans l'île", () => {
    assert.deepEqual(clampFoot({ x: -50, y: 900 }, 40, 40, ISLAND), { x: 20, y: 270 });
    assert.ok(inside(boxAt(clampFoot({ x: 700, y: 10 }, 40, 40, ISLAND), 40, 40), ISLAND));
  });

  test("à côté de l'élément, du côté où elle est", () => {
    const row: Rect = { left: 200, top: 100, width: 200, height: 24 };
    const left = pickSpot(row, 40, 40, ISLAND, [], "beside", { x: 50, y: 200 });
    assert.ok(left.front);
    assert.ok(left.foot.x < row.left);
    const right = pickSpot(row, 40, 40, ISLAND, [], "beside", { x: 600, y: 200 });
    assert.ok(right.foot.x > row.left + row.width);
  });

  test("jamais devant le texte : une autre place, ou derrière le contenu", () => {
    const row: Rect = { left: 200, top: 100, width: 200, height: 24 };
    const textLeft: Rect = { left: 140, top: 80, width: 58, height: 40 };
    const spot = pickSpot(row, 40, 40, ISLAND, [textLeft], "left");
    assert.ok(spot.front);
    assert.ok(!intersects(boxAt(spot.foot, 40, 40), textLeft, 1));
    // Du texte partout : elle reste derrière.
    const wall: Rect = { left: 0, top: 0, width: 640, height: 270 };
    assert.equal(pickSpot(row, 40, 40, ISLAND, [wall], "left").front, false);
  });

  test("sur l'élément : son propre texte ne compte pas (elle agit dessus), celui d'à côté oui", () => {
    const ring: Rect = { left: 100, top: 60, width: 120, height: 120 };
    const own: Rect = { left: 130, top: 100, width: 60, height: 20 };
    const on = pickSpot(ring, 32, 32, ISLAND, [own], "on");
    assert.ok(on.front);
    assert.equal(on.foot.x, 160);
  });

  test("traversée et progression le long du bas de l'île", () => {
    const path = crossing(ISLAND, 40, true);
    assert.equal(path[0].x, 20);
    assert.equal(path[path.length - 1].x, 620);
    assert.ok(path.every((p) => p.y === 270));
    assert.equal(crossing(ISLAND, 40, false)[0].x, 620);
    assert.equal(progressFoot(ISLAND, 40, 0).x, 20);
    assert.equal(progressFoot(ISLAND, 40, 0.5).x, 320);
    assert.equal(progressFoot(ISLAND, 40, 2).x, 620);
    assert.equal(progressFoot(ISLAND, 40, Number.NaN).x, 20);
  });
});

const BASE: SceneContext = { hasMascot: true, reduced: false, calm: false, walkOn: true, mouth: false, eco: false, state: "expanded" };

describe("les règles des scènes", () => {
  test("les 22 scènes de ondine-se-deplace.md ont toutes au moins une scène", () => {
    const numbers = new Set(SCENE_IDS.map((id) => SCENES[id].n));
    for (let n = 1; n <= 22; n++) assert.ok(numbers.has(n), `scène ${n}`);
    assert.ok(isSceneId("tab-hop"));
    assert.ok(!isSceneId("dance"));
  });

  test("île ouverte, tout permis : elle se déplace", () => {
    assert.equal(sceneMode("shelf-remove", BASE), "walk");
    assert.equal(sceneMode("drop-catch", { ...BASE, state: "drop" }), "walk");
    assert.equal(sceneMode("banner", { ...BASE, state: "alert" }), "walk");
  });

  test("Réduire les animations, pas de mascotte, île cachée : rien", () => {
    for (const id of SCENE_IDS) {
      assert.equal(sceneMode(id, { ...BASE, reduced: true }), "off", id);
      assert.equal(sceneMode(id, { ...BASE, hasMascot: false }), "off", id);
      assert.equal(sceneMode(id, { ...BASE, state: "hidden" }), "off", id);
    }
  });

  test("Calme, déplacements coupés ou économie d'énergie : un simple geste (ou rien)", () => {
    for (const ctx of [{ ...BASE, calm: true }, { ...BASE, walkOn: false }, { ...BASE, eco: true }]) {
      assert.equal(sceneMode("shelf-remove", ctx), "gesture");
      assert.equal(sceneMode("tab-hop", ctx), "off"); // pas de geste pour celle-là
    }
    // Les scènes spontanées disparaissent en Calme.
    assert.equal(sceneMode("idle-stroll", { ...BASE, calm: true }), "off");
    assert.equal(sceneMode("day-end", { ...BASE, calm: true }), "off");
  });

  test("mini-île : pas la place de marcher, le geste", () => {
    assert.equal(sceneMode("agent-done", { ...BASE, state: "compact" }), "gesture");
  });

  test("île-bouche : rien, sauf la scène 1 où elle croque le fichier", () => {
    for (const id of SCENE_IDS) {
      const want = id === "shelf-remove" ? "crunch" : "off";
      assert.equal(sceneMode(id, { ...BASE, mouth: true }), want, id);
    }
  });

  test("island.style et le réglage ondineWalk se lisent prudemment", () => {
    assert.equal(islandStyle(undefined), "classic");
    assert.equal(islandStyle({}), "classic");
    assert.equal(islandStyle({ style: "mouth" }), "mouth");
    assert.equal(islandStyle({ style: 3 }), "classic");
    assert.equal(walkSetting(undefined), true);
    assert.equal(walkSetting({ halos: { values: {} } }), true);
    assert.equal(walkSetting({ halos: { values: { ondineWalk: false } } }), false);
  });

  test("pas deux fois la même scène trop vite", () => {
    const gaps = new SceneGaps();
    assert.ok(gaps.ready("clip-new", 0));
    gaps.mark("clip-new", 0);
    assert.ok(!gaps.ready("clip-new", SCENES["clip-new"].gapMs - 1));
    assert.ok(gaps.ready("clip-new", SCENES["clip-new"].gapMs));
    // Les scènes déclenchées par un clic se rejouent tout de suite.
    gaps.mark("shelf-remove", 0);
    assert.ok(gaps.ready("shelf-remove", 0));
  });

  test("progression, volume fort, météo", () => {
    assert.equal(progressOf({ percent: 45 }), 0.45);
    assert.equal(progressOf({ step: 3, total: 4 }), 0.75);
    assert.equal(progressOf({ step: 3, total: 0 }), null);
    assert.equal(progressOf(null), null);
    assert.ok(isLoud(85));
    assert.ok(!isLoud(85, true));
    assert.ok(!isLoud(40));
    assert.equal(weatherKind("🌧️"), "rain");
    assert.equal(weatherKind("⛈️"), "rain");
    assert.equal(weatherKind("☀️"), "sun");
    assert.equal(weatherKind("☁️"), null);
  });

  test("fin de journée : l'heure de départ des halos, sinon 19 h ; une fois par jour", () => {
    assert.equal(dayEndMinutes("18:30"), 18 * 60 + 30);
    assert.equal(dayEndMinutes(""), 19 * 60);
    assert.equal(dayEndMinutes("25:00"), 19 * 60);
    assert.ok(isEvening(new Date(2026, 9, 10, 19, 5), ""));
    assert.ok(!isEvening(new Date(2026, 9, 10, 15, 0), ""));
    assert.ok(isEvening(new Date(2026, 9, 11, 1, 0), ""));
    // Après minuit, c'est encore la soirée de la veille.
    assert.equal(dayKey(new Date(2026, 9, 11, 1, 0)), "2026-10-10");
    assert.equal(dayKey(new Date(2026, 9, 10, 20, 0)), "2026-10-10");
  });
});

describe("branchements", () => {
  test("le réglage est dans le module Animations de l'île, activé par défaut, et placé dans Style", () => {
    const m = JSON.parse(readFileSync("src/modules/halos/manifest.json", "utf8")) as { settings: { fields: { key: string; default: unknown }[] } };
    const f = m.settings.fields.find((x) => x.key === "ondineWalk");
    assert.equal(f?.default, true);
    const style = ANIMATION_SUBS.find((s) => s.id === "style");
    assert.ok(style?.blocks.some((b) => b.module === "halos" && b.keys.includes("ondineWalk")));
  });

  test("les modules qui publient mascot.scene le déclarent", () => {
    for (const id of ["notes", "rules"]) {
      const m = JSON.parse(readFileSync(`src/modules/${id}/manifest.json`, "utf8")) as { events: { emits: string[] } };
      assert.ok(m.events.emits.includes("mascot.scene"), id);
    }
  });

  test("les gestes demandés existent (états de la mascotte ou expressions proches)", async () => {
    const { MASCOT_STATES, EMOTE_NEAR } = await import("../../src/mascot/types");
    const known = new Set<string>([...MASCOT_STATES, ...Object.keys(EMOTE_NEAR)]);
    for (const id of SCENE_IDS) {
      const g = SCENES[id].gesture;
      if (g) assert.ok(known.has(g), `${id} : ${g}`);
    }
  });
});
