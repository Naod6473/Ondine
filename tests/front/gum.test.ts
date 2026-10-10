// Tests de la famille « gomme » : les contours des formes, la traduction des
// anciennes animations en réglages du visage, la gelée qui se calme, la forme
// de la mascotte Météo, et le manifeste de la goutte gomme.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { N, SHAPES, SHAPE_IDS, signedArea, mixPts, halfWidthAt } from "../../src/mascot/renderers/gum-shapes";
import { FACE_BASE, hslToHex, isHexColor, palette, paletteFromHex, rgbToHsl, TINT_NAMES } from "../../src/mascot/renderers/gum-draw";
import { faceOf, HANDS, JellyRim, skyShape, weatherLook, ANIMS, BLINK, blinkCurve, idleAct, landingSquash, type HandPose } from "../../src/mascot/renderers/gum-anims";
import { GUM_FAMILY, cousinManifest } from "../../src/mascot/gum-family";
import { validateManifest } from "../../src/mascot/manifest-check";
import { EMOTE_NEAR, MASCOT_STATES, type MascotManifest } from "../../src/mascot/types";
import { averageColor } from "../../src/mascot/env-tint";

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

  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

  test("la palette d'une couleur libre : clair, milieu, profond, contour, du plus clair au plus foncé", () => {
    for (const hex of ["#4da3ff", "#ff6b78", "#1fae5c", "#202020", "#fafafa", "#808080"]) {
      const p = paletteFromHex(hex);
      assert.equal(p.length, 4);
      for (const c of p) for (const v of c) assert.ok(v >= 0 && v <= 255.5, `${hex} : ${v}`);
      assert.ok(lum(p[0]) > lum(p[1]), `${hex} : le reflet n'est pas plus clair que le milieu`);
      assert.ok(lum(p[1]) > lum(p[2]), `${hex} : le bas n'est pas plus foncé que le milieu`);
      assert.ok(lum(p[2]) > lum(p[3]), `${hex} : le contour n'est pas le plus foncé`);
    }
  });

  test("la couleur libre garde sa teinte, et « custom » passe par palette()", () => {
    const [h] = rgbToHsl(paletteFromHex("#4da3ff")[1]);
    assert.ok(Math.abs(h - 211) < 3, `teinte ${h}`);
    assert.deepEqual(palette("custom", 0, "#4da3ff"), paletteFromHex("#4da3ff"));
    assert.ok(JSON.stringify(palette("custom", 0, "#4da3ff")) !== JSON.stringify(palette("custom", 0, "#ff6b78")));
  });

  test("une couleur invalide donne le bleu", () => {
    assert.deepEqual(paletteFromHex("rouge"), palette("blue"));
    assert.deepEqual(paletteFromHex("#12"), palette("blue"));
    assert.ok(isHexColor("#4DA3FF"));
    assert.ok(!isHexColor("#4da3f"));
    assert.ok(!isHexColor(42));
  });

  test("hex → TSL → hex : aller-retour", () => {
    for (const hex of ["#4da3ff", "#ff6b78", "#1fae5c", "#7b4dea"]) {
      const [h, s, l] = rgbToHsl([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
      assert.equal(hslToHex(h, s, l), hex);
    }
    assert.equal(hslToHex(0, 0, 100), "#ffffff");
    assert.equal(hslToHex(0, 0, 0), "#000000");
  });
});

describe("mains", () => {
  test("toutes les poses, dont les oreilles bouchées et la pancarte, donnent des nombres", () => {
    for (const pose of Object.keys(HANDS) as HandPose[]) {
      for (const id of SHAPE_IDS) {
        const [a, b] = HANDS[pose](1.3, 0.4, SHAPES[id]);
        for (const H of [a, b]) for (const v of Object.values(H)) assert.ok(Number.isFinite(v), `${pose} / ${id}`);
      }
    }
    const [l, r] = HANDS.ears(0, 0, SHAPES.goutte);
    assert.ok(l.x! < 0 && r.x! > 0, "les moufles sur les oreilles, de chaque côté de la tête");
    assert.ok(Math.abs(l.y! - SHAPES.goutte.eyeY) < 0.1, "à hauteur des yeux");
    const [, sign] = HANDS.sign(0, 0, SHAPES.goutte);
    assert.ok(sign.x! > 0 && sign.y! < 0.55, "la pancarte est tenue à droite, levée");
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

// ── 1.2.2 : expressions du contrat, fluidité, réalisme ──────────────────────

/** Les ids que les autres parties de l'appli émettent avec mascot.emote (contrat 1.2.2). */
const CONTRACT = ["panic", "scared", "relieved", "stretch", "yawn", "surprised", "listening", "sunglasses", "scarf", "goodbye", "push", "sit-edge", "laugh", "hide", "tap-glass", "climb", "talk"];

describe("expressions du contrat (mascot.emote)", () => {
  const base = JSON.parse(readFileSync("mascots/goutte-gomme/manifest.json", "utf8")) as MascotManifest;

  test("chaque id est un état connu, et la goutte gomme (donc les 15) a son animation", () => {
    for (const id of CONTRACT) {
      assert.ok((MASCOT_STATES as readonly string[]).includes(id), `${id} : état inconnu`);
      const anim = base.states[id as keyof typeof base.states];
      assert.ok(anim && ANIMS[anim], `${id} : pas d'animation`);
    }
  });

  test("une mascotte qui ne les a pas retombe sur une expression d'avant la 1.2.2", () => {
    const old = MASCOT_STATES.slice(0, MASCOT_STATES.indexOf("panic")) as readonly string[];
    for (const id of CONTRACT) {
      let s: string | undefined = id;
      for (let i = 0; i < 3 && s && !old.includes(s); i++) s = EMOTE_NEAR[s];
      assert.ok(s && old.includes(s), `${id} : pas d'expression proche`);
    }
  });

  test("ce qu'elles sortent (lunettes, écharpe, pile, jambes…) reste entre 0 et 1", () => {
    for (const [name, fn] of Object.entries(ANIMS)) {
      for (const p of [0, 0.3, 0.6, 0.95]) {
        for (const v of Object.values(fn(p * 3, p, "neutral").prop ?? {})) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${name} : ${v}`);
      }
    }
    assert.equal(ANIMS.lunettes(1.8, 0.5, "neutral").prop?.glasses, 1);
    assert.equal(ANIMS.panique(1, 0.4, "neutral").hands, "panic");
    assert.equal(ANIMS["assise-bord"](1, 0.3, "neutral").prop?.legs, 1);
  });

  test("les pupilles : serrées de surprise, ouvertes de contentement", () => {
    assert.ok(faceOf(ANIMS.sursaut(0.2, 0.2, "neutral")).face.pupil < 0.7);
    assert.ok(faceOf(ANIMS.surprise(0.2, 0.2, "neutral")).face.pupil < 0.7);
    assert.ok(faceOf(ANIMS.coucou(0.5, 0.3, "neutral")).face.pupil > 1);
    assert.equal(faceOf(ANIMS.idle(1, 0.2, "neutral")).face.pupil, 1);
  });
});

describe("fluidité", () => {
  test("clignement : se ferme en 70 ms, se rouvre en 130 ms", () => {
    assert.equal(blinkCurve(0), 1);
    assert.ok(Math.abs(blinkCurve(BLINK.closeMs)!) < 1e-9);
    assert.ok(blinkCurve(35)! > blinkCurve(60)!, "la paupière descend");
    assert.ok(blinkCurve(120)! < blinkCurve(180)!, "puis remonte");
    assert.equal(blinkCurve(BLINK.closeMs + BLINK.openMs + 1), null);
    assert.ok(BLINK.minGapMs === 2200 && BLINK.maxGapMs === 5400 && BLINK.double > 0.2 && BLINK.double < 0.25);
  });

  test("atterrissage : écrasée, étirée, posée", () => {
    assert.equal(landingSquash(0), 0);
    assert.ok(landingSquash(0.045) < -0.15);
    assert.ok(landingSquash(0.15) > 0.05);
    assert.equal(landingSquash(1), 0);
    for (let s = 0; s < 0.4; s += 0.01) assert.ok(Math.abs(landingSquash(s)) <= 0.17 + 1e-9);
  });

  test("les petits gestes du repos commencent et finissent en douceur", () => {
    for (const act of ["shift", "sigh", "pout", "look", "hum"] as const) {
      assert.equal(idleAct(act, 0, 1).w, 0);
      assert.equal(idleAct(act, 1, 1).w, 0);
      assert.ok(idleAct(act, 0.5, -1).w > 0.99);
      for (const v of Object.values(idleAct(act, 0.4, 1).face)) assert.ok(Number.isFinite(v));
    }
  });
});

describe("la teinte de la pochette", () => {
  test("une pochette rouge donne du rouge ; une grise ne donne rien", () => {
    const px = (r: number, g: number, b: number, n = 16) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
    const red = averageColor(px(220, 30, 40))!;
    assert.ok(red[0] > 200 && red[1] < 50);
    assert.equal(averageColor(px(128, 128, 128)), null);
    // Le gris autour compte peu : la couleur vive l'emporte.
    const mixed = averageColor([...px(120, 120, 120, 40), ...px(40, 90, 230, 8)])!;
    assert.ok(mixed[2] > 200 && mixed[0] < 60);
  });
});
