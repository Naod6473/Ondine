// Tests de la famille « gomme » : les contours des formes, la traduction des
// anciennes animations en réglages du visage, la gelée qui se calme, la forme
// de la mascotte Météo, et le manifeste de la goutte gomme.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { N, SHAPES, SHAPE_IDS, signedArea, mixPts, halfWidthAt } from "../../src/mascot/renderers/gum-shapes";
import { FACE_BASE, palette, TINT_NAMES } from "../../src/mascot/renderers/gum-draw";
import { faceOf, JellyRim, skyShape, weatherLook, ANIMS } from "../../src/mascot/renderers/gum-anims";
import { GUM_FAMILY, cousinManifest } from "../../src/mascot/gum-family";
import { validateManifest } from "../../src/mascot/manifest-check";
import { MASCOT_STATES, type MascotManifest } from "../../src/mascot/types";

describe("formes gomme", () => {
  for (const id of SHAPE_IDS) {
    test(`${id} : ${N} points, sens des aiguilles d'une montre, posée à y = 0.94`, () => {
      const s = SHAPES[id];
      assert.equal(s.pts.length, N);
      assert.ok(signedArea(s.pts) > 0.5, "contour à l'envers ou trop petit");
      const maxY = Math.max(...s.pts.map((p) => p.y));
      assert.ok(Math.abs(maxY - 0.94) < 1e-6);
      for (const p of s.pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      // Elle tient dans la place de la mascotte (le canvas fait ±1,6 R).
      for (const p of s.pts) assert.ok(Math.abs(p.x) < 1.5 && p.y > -1.5, `${id} déborde`);
      // Le premier point est en haut (pour que les formes se transforment proprement l'une en l'autre).
      const minY = Math.min(...s.pts.map((p) => p.y));
      assert.ok(s.pts[0].y < minY + 0.45, `${id} : le premier point n'est pas en haut`);
    });
  }

  test("mélanger deux contours garde les bouts", () => {
    const a = SHAPES.soleil.pts;
    const b = SHAPES.lune.pts;
    assert.equal(mixPts(a, b, 0), a);
    assert.equal(mixPts(a, b, 1), b);
    const m = mixPts(a, b, 0.5);
    assert.equal(m.length, N);
    assert.ok(Math.abs(m[3].x - (a[3].x + b[3].x) / 2) < 1e-9);
  });

  test("demi-largeur au repos : raisonnable pour toutes les formes", () => {
    for (const id of SHAPE_IDS) {
      const w = halfWidthAt(SHAPES[id].pts, 0.55);
      assert.ok(w > 0.3 && w < 1.3, `${id} : ${w}`);
    }
  });
});

describe("visage en réglages chiffrés", () => {
  test("les anciens yeux et bouches se traduisent", () => {
    assert.equal(faceOf({ eyes: "happy" }).face.eyeOpen, 0);
    assert.equal(faceOf({ eyes: "happy" }).face.eyeCurve, 1);
    assert.equal(faceOf({ eyes: "wide" }).face.eyeSize, 1.3);
    assert.equal(faceOf({ eyes: "spiral" }).kind, "spiral");
    assert.equal(faceOf({ brows: "angry" }).face.browTilt, 0.9);
    assert.equal(faceOf({ mouth: "frown" }).face.mouthC, -0.6);
    assert.equal(faceOf({ mouth: "none" }).face.mouthA, 0);
    assert.equal(faceOf({ wink: true }).face.winkR, 1);
  });

  test("`face` passe par-dessus", () => {
    const { face } = faceOf({ eyes: "happy", face: { eyeOpen: 0.4, puff: 1 } });
    assert.equal(face.eyeOpen, 0.4);
    assert.equal(face.puff, 1);
  });

  test("toutes les animations donnent des nombres", () => {
    for (const [name, fn] of Object.entries(ANIMS)) {
      for (const p of [0, 0.25, 0.5, 0.99]) {
        const { face } = faceOf(fn(p * 3, p, "neutral"));
        for (const k of Object.keys(FACE_BASE) as (keyof typeof FACE_BASE)[]) assert.ok(Number.isFinite(face[k]), `${name} : ${k}`);
      }
    }
  });
});

describe("gelée", () => {
  test("une pichenette s'éteint toute seule", () => {
    const rim = new JellyRim();
    rim.poke(10, 2.4);
    for (let i = 0; i < 60 * 4; i++) rim.step(1 / 60, () => 0);
    assert.ok(rim.energy() < 0.05, `énergie restante : ${rim.energy()}`);
  });

  test("stable à 30 images/s (mode économie)", () => {
    const rim = new JellyRim();
    rim.poke(0, 4);
    for (let i = 0; i < 30 * 4; i++) rim.step(1 / 30, () => 0);
    assert.ok(rim.energy() < 0.1);
  });
});

describe("ciel et météo", () => {
  test("soleil le jour, lune la nuit", () => {
    assert.equal(skyShape(12), "soleil");
    assert.equal(skyShape(23), "lune");
    assert.equal(skyShape(5), "lune");
  });
  test("la météo choisit la forme", () => {
    assert.deepEqual(weatherLook("🌧️", 12), { shape: "nuage", fx: "rain" });
    assert.deepEqual(weatherLook("❄️", 12), { shape: "nuage", fx: "snow" });
    assert.deepEqual(weatherLook("⛈️", 12), { shape: "nuage", fx: "storm" });
    assert.deepEqual(weatherLook("☁️", 12), { shape: "nuage", fx: "none" });
    assert.deepEqual(weatherLook("☀️", 12), { shape: "soleil", fx: "none" });
    assert.deepEqual(weatherLook("☀️", 22), { shape: "lune", fx: "none" });
    assert.deepEqual(weatherLook(null, 12), { shape: "soleil", fx: "none" });
  });
});

describe("couleurs", () => {
  test("chaque teinte donne 4 couleurs RVB", () => {
    for (const t of TINT_NAMES) {
      const p = palette(t, 3);
      assert.equal(p.length, 4);
      for (const c of p) for (const v of c) assert.ok(v >= 0 && v <= 255.5, `${t} : ${v}`);
    }
  });
});

describe("manifeste de la goutte gomme et cousines", () => {
  const base = JSON.parse(readFileSync("mascots/goutte-gomme/manifest.json", "utf8")) as MascotManifest;

  test("le manifeste est valide et chaque animation a sa fonction", () => {
    assert.deepEqual(validateManifest(base), []);
    for (const a of base.animations) assert.ok(ANIMS[a.source.function ?? a.name], `pas de fonction pour ${a.name}`);
  });

  test("toutes les mascottes fournies savent danser (la musique en mini-île)", () => {
    for (const id of readdirSync("mascots", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      const m = JSON.parse(readFileSync(`mascots/${id}/manifest.json`, "utf8")) as MascotManifest;
      const danse = m.animations.find((a) => a.name === "danse");
      assert.ok(danse?.loop, `${id} : pas d'animation « danse » en boucle`);
    }
  });

  test("il connaît tous les états", () => {
    for (const s of MASCOT_STATES) assert.ok(base.states[s], `état sans animation : ${s}`);
  });

  test("les cousines : ids uniques, formes connues", () => {
    const ids = new Set(GUM_FAMILY.map((c) => c.id));
    assert.equal(ids.size, GUM_FAMILY.length);
    for (const c of GUM_FAMILY) {
      assert.ok((SHAPE_IDS as string[]).includes(c.shape) || c.shape === "ciel" || c.shape === "meteo", c.shape);
      const m = cousinManifest(base, c);
      assert.equal(m.gum?.shape, c.shape);
      assert.deepEqual(validateManifest(m), []);
    }
  });
});
