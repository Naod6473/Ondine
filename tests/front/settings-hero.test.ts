// Tests de la fenêtre des Réglages 1.2.4 : couleurs et mascottes des bandes
// (hero-theme.ts), l'eau des bandes (hero-sea.ts) et la pastille d'état
// (frame-logic.ts). Logique pure, sans DOM.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  castFor,
  castForBand,
  castLayout,
  CATEGORY_COLORS,
  cleanCast,
  COLOR_PAGES,
  contrast,
  GROUP_COLORS,
  HERO_BG,
  HERO_INK,
  HERO_MASCOTS,
  PAGE_CASTS,
  PAGE_COLORS,
  pageColor,
  rgba,
  seedOf,
  shapeOf,
} from "../../src/settings/hero-theme";
import {
  ageRipples,
  bubbleAlpha,
  bubbleCount,
  castRoom,
  pushFrom,
  PUSH_RADIUS,
  RIPPLE_LIFE,
  spawnBubble,
  stepBubble,
  stepSwimmer,
  swimZone,
  waveY,
  type Bubble,
  type Swimmer,
} from "../../src/settings/hero-sea";
import { backdropOf, dictationKey, keyName, statusLine } from "../../src/settings/frame-logic";
import { MODULE_CATEGORIES, NAV_GROUPS } from "../../src/settings/layout";

/** Un tirage fixe (suite pseudo-aléatoire) pour des tests qui ne bougent pas. */
function fixedRand(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const ALL_COLORS = [...Object.values(GROUP_COLORS), ...Object.values(CATEGORY_COLORS), ...Object.values(PAGE_COLORS), ...Object.keys(COLOR_PAGES)];

describe("couleurs des pages", () => {
  test("chaque groupe de la barre et chaque catégorie de modules a sa couleur", () => {
    for (const g of NAV_GROUPS) assert.ok(GROUP_COLORS[g], g);
    for (const c of MODULE_CATEGORIES) assert.ok(CATEGORY_COLORS[c.id], c.id);
  });

  test("la page, puis la catégorie, puis le groupe", () => {
    assert.equal(pageColor({ id: "x", group: "L'île" }), "#7cc4ff");
    assert.equal(pageColor({ id: "module:timer", group: "Modules", category: "organize" }), CATEGORY_COLORS.organize);
    assert.equal(pageColor({ id: "animations", group: "L'île" }), PAGE_COLORS.animations);
    assert.equal(pageColor({ id: "voice:stats", group: "Voix", color: "#4cd98b" }), "#4cd98b");
    assert.equal(pageColor({ id: "x", group: "inconnu" }), GROUP_COLORS.Modules);
  });

  test("contrastes AA : l'encre sur la couleur (boutons, pilules) et la couleur sur le fond des bandes", () => {
    for (const c of ALL_COLORS) {
      assert.ok(contrast(c, HERO_INK) >= 4.5, `${c} / encre : ${contrast(c, HERO_INK).toFixed(2)}`);
      assert.ok(contrast(c, HERO_BG) >= 4.5, `${c} / fond : ${contrast(c, HERO_BG).toFixed(2)}`);
    }
  });

  test("contraste : bornes connues", () => {
    assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
    assert.equal(contrast("#777777", "#777777"), 1);
  });

  test("les couleurs des pages Voix suivent le contrat (VOICE_PAGES)", () => {
    const src = readFileSync("src/settings/voice/pages.ts", "utf8") + ["dictation", "callnotes", "stats", "dictionary", "styles"].map((f) => readFileSync(`src/settings/voice/${f}-page.ts`, "utf8")).join("\n");
    for (const [color, page] of Object.entries(COLOR_PAGES)) {
      const file = readFileSync(`src/settings/voice/${page.slice(6)}-page.ts`, "utf8");
      assert.ok(file.includes(`"${page}"`) && file.toLowerCase().includes(color), `${page} ${color}`);
    }
    assert.ok(src.length > 0);
  });

  test("rgba : couleur et opacité bornée", () => {
    assert.equal(rgba("#7cc4ff", 0.5), "rgba(124,196,255,0.5)");
    assert.equal(rgba("#7cc4ff", 3), "rgba(124,196,255,1)");
    assert.equal(rgba("pas une couleur", 1), "rgba(124,196,255,1)");
  });
});

describe("mascottes des bandes", () => {
  const pages = ["general", "mascot", "look", "behavior", "animations", "tabs", "rules", "profiles", "privacy", "phones", "credentials", "backup", "updates", "perf", "about", "module:timer", "module:media", "module:agents", "module:notes", "module:weather", "voice:dictation", "voice:stats"];

  test("deux ou trois mascottes connues, différentes, toujours les mêmes pour une page", () => {
    for (const p of pages) {
      const cast = castFor(p);
      assert.ok(cast.length >= 2 && cast.length <= 3, p);
      assert.equal(new Set(cast).size, cast.length, p);
      for (const id of cast) assert.ok(shapeOf(id), `${p} : ${id}`);
      assert.deepEqual(castFor(p), cast);
    }
  });

  test("variées d'une page à l'autre", () => {
    const casts = new Set(pages.map((p) => castFor(p).join(",")));
    assert.ok(casts.size >= pages.length * 0.7, `${casts.size} troupes pour ${pages.length} pages`);
    const used = new Set(pages.flatMap((p) => castFor(p)));
    assert.ok(used.size >= 10, `${used.size} mascottes différentes`);
  });

  test("les troupes choisies n'utilisent que de vraies mascottes (pas la Météo, qui attend la météo)", () => {
    for (const [p, cast] of Object.entries(PAGE_CASTS)) for (const id of cast) assert.ok(HERO_MASCOTS.includes(id), `${p} : ${id}`);
    assert.ok(!HERO_MASCOTS.includes("gomme-meteo"));
    assert.ok(HERO_MASCOTS.includes("goutte-gomme"));
  });

  test("une page Voix sans mascottes données retrouve sa troupe par sa couleur", () => {
    assert.deepEqual(castForBand("Dictée", "#5FD4E6"), castFor("voice:dictation"));
    assert.deepEqual(castForBand("Autre", "#123456"), castFor("Autre|#123456"));
  });

  test("cleanCast : inconnues retirées, doublons retirés, trois au plus", () => {
    assert.deepEqual(cleanCast(["goutte-gomme", "inconnue", "goutte-gomme", "gomme-lune", "gomme-coeur", "gomme-fleur"]), ["goutte-gomme", "gomme-lune", "gomme-coeur"]);
  });

  test("placement : réparties sur l'eau, celle du milieu plus grande", () => {
    assert.deepEqual(castLayout(0), []);
    const three = castLayout(3);
    assert.equal(three[1].scale, 1);
    assert.ok(three[0].scale < 1 && three[2].scale < 1);
    assert.ok(three[0].start < three[1].start && three[1].start < three[2].start);
    for (const l of three) assert.ok(l.start >= 0 && l.start <= 1);
  });

  test("seedOf : stable et différent", () => {
    assert.equal(seedOf("general"), seedOf("general"));
    assert.notEqual(seedOf("general"), seedOf("look"));
  });
});

describe("l'eau des bandes", () => {
  test("la souris écarte une bulle : à l'opposé, plus fort de près, rien hors de portée", () => {
    const near = pushFrom(110, 100, 100, 100, 1, 0.1);
    assert.ok(near.dx > 0 && Math.abs(near.dy) < 1e-9, "poussée vers la droite");
    const far = pushFrom(100 + PUSH_RADIUS + 1, 100, 100, 100, 1, 0.1);
    assert.deepEqual(far, { dx: 0, dy: 0 });
    const mid = pushFrom(160, 100, 100, 100, 1, 0.1);
    assert.ok(mid.dx > 0 && mid.dx < near.dx, "moins fort plus loin");
    const above = pushFrom(100, 80, 100, 100, 1, 0.1);
    assert.ok(above.dy < 0, "poussée vers le haut");
    assert.deepEqual(pushFrom(110, 100, 100, 100, 0, 0.1), { dx: 0, dy: 0 }, "souris partie : rien");
    const on = pushFrom(100, 100, 100, 100, 1, 0.1);
    assert.ok(on.dy < 0 && on.dx === 0, "pile dessus : elle s'échappe vers le haut");
  });

  test("une bulle monte, s'écarte puis revient sur sa route, et sort par le haut", () => {
    const b: Bubble = { x: 100, y: 150, r: 3, rise: 20, phase: 0, sway: 0, ox: 0, oy: 0 };
    stepBubble(b, 0.1, 0, { x: 90, y: 150 }, 1);
    assert.ok(b.y < 150, "elle monte");
    assert.ok(b.ox > 0, "écartée de la souris");
    const pushed = b.ox;
    for (let i = 0; i < 30; i++) stepBubble(b, 0.1, 0, null, 0);
    assert.ok(Math.abs(b.ox) < pushed * 0.2, "revenue sur sa route");
    let alive = true;
    for (let i = 0; i < 200 && alive; i++) alive = stepBubble(b, 0.1, 0, null, 0);
    assert.equal(alive, false);
  });

  test("bulles : nombre borné, naissent sous l'eau, s'effacent en haut", () => {
    assert.equal(bubbleCount(10, 10), 10);
    assert.equal(bubbleCount(5000, 5000), 34);
    const rand = fixedRand(7);
    for (let i = 0; i < 50; i++) {
      const b = spawnBubble(800, 200, rand, true);
      assert.ok(b.y > 200 && b.x >= 0 && b.x <= 800 && b.r > 0 && b.rise > 0);
    }
    assert.equal(bubbleAlpha(0, 200), 0);
    assert.equal(bubbleAlpha(200, 200), 0);
    assert.ok(bubbleAlpha(120, 200) > 0.9);
  });

  test("la vague : autour de son niveau, plate sans ampleur, un rond la soulève puis s'éteint", () => {
    for (let x = 0; x < 800; x += 37) {
      const y = waveY(x, 3.2, 150, 4);
      assert.ok(Math.abs(y - 150) <= 4.001, `${x} : ${y}`);
      assert.equal(waveY(x, 3.2, 150, 0), 150);
    }
    const ripples = [{ x: 300, age: 0.2, amp: 4 }];
    const diff = Math.max(...Array.from({ length: 100 }, (_, i) => Math.abs(waveY(200 + i * 2, 0, 150, 0, ripples) - 150)));
    assert.ok(diff > 1, "le rond se voit");
    assert.equal(waveY(900, 0, 150, 0, ripples), 150, "loin du rond : rien");
    assert.deepEqual(ageRipples([{ x: 0, age: RIPPLE_LIFE - 0.1, amp: 1 }], 0.2), []);
  });

  test("une mascotte nage vers sa cible, reste dans sa zone, saute et retombe (un rond)", () => {
    const s: Swimmer = { x: 100, target: 200, hop: 0, hopV: 0, pause: 1, dir: 1 };
    stepSwimmer(s, 0.5, 50, 300, fixedRand(3));
    assert.ok(s.x > 100 && s.x < 200);
    assert.equal(s.dir, 1);
    s.target = 1000;
    for (let i = 0; i < 400; i++) stepSwimmer(s, 0.05, 50, 300, fixedRand(3));
    assert.ok(s.x <= 300 && s.x >= 50);
    const j: Swimmer = { x: 100, target: 100, hop: 0, hopV: 300, pause: 99, dir: 1 };
    let landed = false;
    let top = 0;
    for (let i = 0; i < 200 && !landed; i++) {
      landed = stepSwimmer(j, 0.01, 0, 400, fixedRand(1), false);
      top = Math.max(top, j.hop);
    }
    assert.ok(landed && top > 30 && j.hop === 0 && j.hopV === 0);
  });

  test("zone de nage à droite, et moins de mascottes quand la bande est étroite", () => {
    const z = swimZone(900, 80);
    assert.ok(z.hi <= 900 - 40 && z.lo >= 900 * 0.4 && z.lo < z.hi);
    assert.ok(z.lo >= 900 * 0.6, "pas sous le texte");
    assert.equal(castRoom(500, 3), 1);
    assert.equal(castRoom(700, 3), 2);
    assert.equal(castRoom(1000, 3), 3);
  });
});

describe("pastille d'état et fond", () => {
  test("dictée activée : « Prête · maintenir » et sa touche", () => {
    assert.deepEqual(statusLine({ version: "1.2.4", autoUpdate: true, dictation: { enabled: true, values: { holdKey: "ControlRight" } } }).parts, ["Prête · maintenir", "Ctrl droit"]);
    assert.deepEqual(statusLine({ version: "1.2.4", autoUpdate: true, dictation: { enabled: true, values: {} } }).parts, ["Dictée prête"]);
  });

  test("sinon : la version et les mises à jour, sans rien demander à Internet", () => {
    assert.deepEqual(statusLine({ version: "1.2.4", autoUpdate: true, dictation: { enabled: false, values: {} } }).parts, ["Ondine 1.2.4", "mises à jour automatiques"]);
    assert.deepEqual(statusLine({ version: "1.2.4", autoUpdate: false }).parts, ["Ondine 1.2.4", "mises à jour manuelles"]);
    assert.deepEqual(statusLine({ version: "", autoUpdate: true, note: { tone: "ok" } }).parts, ["Ondine", "à jour"]);
    assert.deepEqual(statusLine({ version: "1.2.4", autoUpdate: true, note: { tone: "new", version: "1.2.5" } }).parts, ["Ondine 1.2.4", "version 1.2.5 disponible"]);
    assert.deepEqual(statusLine({ version: "1.2.4", autoUpdate: true, note: { tone: "error" } }).parts, ["Ondine 1.2.4", "recherche impossible"]);
  });

  test("touches : noms connus traduits, autres tels quels, « off » ignoré", () => {
    assert.equal(keyName("RightAlt"), "Alt droit");
    assert.equal(keyName(" right_ctrl "), "Ctrl droit");
    assert.equal(keyName("F9"), "F9");
    assert.equal(dictationKey({ hotkey: "off", key: "CapsLock" }), "Verr. Maj");
    assert.equal(dictationKey({ hotkey: "" }), null);
  });

  test("fond : noir profond par défaut, dégradés seulement s'ils sont choisis", () => {
    assert.equal(backdropOf(null), "deep");
    assert.equal(backdropOf("autre"), "deep");
    assert.equal(backdropOf("blobs"), "blobs");
  });
});
