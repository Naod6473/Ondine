// Tests des nouveautés « design » de la 1.2.3 : l'île en verre clair (thème
// Givre, src/island/light-rules.ts et themes.ts), la molette = volume
// (wheel-volume.ts), le double-clic sur Ondine (mascot-double-click.ts) et les
// couleurs du halo d'après la pochette (cover-palette.ts). Le dessin lui-même
// est vérifié sur Windows (docs/tests/TESTS-1-2-3-design.md).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { contrastOf, flipValue, formatColor, INK, lightRule, ownBackground, over, parseColor, readableOnLight, scopeSelector, splitSelectors, WORST_LIGHT_BG } from "../../src/island/light-rules";
import { contrastRatio, effectiveThemeId, FG, MUTED, THEMES, themeFor } from "../../src/island/themes";
import { cssToHex, readablePaint, seenThrough } from "../../src/island/liquid-rules";
import { nextVolume, speakerLevel, STEP_PER_NOTCH, WheelVolume, wheelSetsVolume } from "../../src/island/wheel-volume";
import { CONFIRM_MS, DOUBLE_MS, DoubleClick, doubleClickActionOf } from "../../src/island/mascot-double-click";
import { coverPalette } from "../../src/island/cover-palette";
import { hexToRgb } from "../../src/island/halo-palettes";

const rgb3 = (hex: string) => {
  const c = parseColor(hex)!;
  return [c[0], c[1], c[2]] as [number, number, number];
};

describe("île en verre clair : le thème Givre", () => {
  const givre = THEMES.find((t) => t.id === "givre")!;
  test("existe, est clair, et donne son texte", () => {
    assert.ok(givre, "thème givre absent");
    assert.equal(givre.light, true);
    assert.ok(givre.fg && givre.muted);
  });
  test("texte et texte secondaire lisibles au pire (verre au-dessus d'un bureau noir ou blanc)", () => {
    for (const desk of ["#000000", "#ffffff"]) {
      const bg = formatColor([...over(parseColor(givre.bg)!, rgb3(desk)), 1]);
      assert.ok(contrastRatio(givre.fg!, bg) >= 7, `texte sur ${desk}`);
      assert.ok(contrastRatio(givre.muted!, bg) >= 4.5, `secondaire sur ${desk}`);
      assert.ok(contrastRatio(givre.accent, bg) >= 4.5, `accent sur ${desk}`);
    }
    // Le fond « le pire » des calculs est bien celui-là.
    assert.ok(contrastRatio(WORST_LIGHT_BG, formatColor([...over(parseColor(givre.bg)!, [0, 0, 0]), 1])) < 1.05);
  });
  test("les thèmes sombres gardent leur texte clair", () => {
    for (const t of THEMES.filter((x) => !x.light)) assert.equal(t.fg, undefined, t.id);
    assert.equal(themeFor("nuit", "").fg ?? FG, FG);
    assert.equal(themeFor("nuit", "").muted ?? MUTED, MUTED);
  });
  test("style île-bouche : un thème clair redevient Nuit, les autres restent", () => {
    assert.equal(effectiveThemeId("givre", "mouth"), "nuit");
    assert.equal(effectiveThemeId("givre", "classic"), "givre");
    assert.equal(effectiveThemeId("givre", undefined), "givre");
    assert.equal(effectiveThemeId("prune", "mouth"), "prune");
    assert.equal(effectiveThemeId("custom", "mouth"), "custom");
  });
  test("le liquide garde le texte lisible sur l'île claire (il s'éclaircit au lieu de foncer)", () => {
    const bg = cssToHex(givre.bg, "#000000");
    // Vu au pire au-dessus d'un bureau noir : plus sombre que le blanc pur.
    assert.ok(contrastRatio(bg, "#ffffff") > 1.1);
    for (const c of ["#7cc4ff", "#145a9e", "#1e3a8a", "#ff5a4e", "#000000"]) {
      for (const additive of [false, true]) {
        const p = readablePaint(c, bg, givre.muted!, 0.8, additive);
        const seen = seenThrough(bg, p.color, p.alpha, p.additive);
        assert.equal(p.additive, false, "pas de lumière additionnée sur du blanc");
        assert.ok(contrastRatio(givre.muted!, seen) >= 4.49, `${c}`);
        assert.ok(contrastRatio(givre.fg!, seen) >= 4.5, `${c} texte principal`);
      }
    }
  });
});

describe("île en verre clair : les couleurs d'island.css retournées", () => {
  test("lecture et écriture des couleurs", () => {
    assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
    assert.deepEqual(parseColor("rgba(255, 255, 255, 0.08)"), [255, 255, 255, 0.08]);
    assert.deepEqual(parseColor("rgb(12 13 18 / 50%)"), [12, 13, 18, 0.5]);
    assert.deepEqual(parseColor("white"), [255, 255, 255, 1]);
    assert.equal(parseColor("var(--x)"), null);
    assert.equal(formatColor([255, 0, 0, 1]), "#ff0000");
    assert.equal(formatColor([27, 30, 43, 0.08]), "rgba(27, 30, 43, 0.08)");
  });
  test("le blanc translucide d'une pastille devient de l'encre translucide (même opacité)", () => {
    assert.equal(flipValue("background-color", "rgba(255, 255, 255, 0.08)"), "rgba(27, 30, 43, 0.08)");
    assert.equal(flipValue("border-top-color", "rgba(255, 255, 255, 0.12)"), "rgba(27, 30, 43, 0.12)");
    assert.equal(flipValue("background-image", "linear-gradient(rgba(255, 255, 255, 0.1), transparent)"), "linear-gradient(rgba(27, 30, 43, 0.1), transparent)");
  });
  test("le texte blanc devient de l'encre, le noir devient clair", () => {
    assert.equal(flipValue("color", "#fff"), INK);
    const black = parseColor(flipValue("background-color", "#000")!)!;
    assert.ok(black[0] > 240);
  });
  test("un texte de couleur reste de sa couleur, foncé juste assez pour 4,5:1", () => {
    const bg = rgb3(WORST_LIGHT_BG);
    for (const c of ["#ffc65c", "#5ee08a", "#ff9f0a", "#a3d6ff", "#ff8a8a", "rgba(255, 255, 255, 0.55)"]) {
      const out = parseColor(flipValue("color", c) ?? c)!;
      assert.ok(contrastOf(over(out, bg), bg) >= 4.5, `${c} → ${formatColor(out)}`);
    }
    // Déjà lisible : inchangé.
    assert.equal(flipValue("color", "#145a9e"), null);
    // Un filigrane presque transparent reste un filigrane.
    assert.deepEqual(readableOnLight([255, 0, 0, 0.1]), [255, 0, 0, 0.1]);
  });
  test("ombres, masques, images : une ombre reste une ombre, un masque et une icône SVG ne changent pas", () => {
    const shadow = parseColor(flipValue("box-shadow", "0 4px 12px rgba(0, 0, 0, 0.4)")!.match(/rgba\([^)]*\)/)![0])!;
    assert.deepEqual(shadow.slice(0, 3), [0, 0, 0]);
    assert.ok(shadow[3] < 0.4);
    assert.equal(flipValue("mask-image", "linear-gradient(#000, transparent)"), null);
    assert.equal(flipValue("background-image", "url(\"data:image/svg+xml;utf8,<svg stroke='#fff'/>\")"), null);
    // Une couleur vive moyenne (un bouton rouge) ne change pas.
    assert.equal(flipValue("background-color", "#ff453a"), null);
    // Une variable n'est pas une couleur.
    assert.equal(flipValue("color", "var(--white-ish)"), null);
  });
  test("le fond propre d'une règle", () => {
    const d = (prop: string, value: string) => ({ prop, value, important: false });
    assert.equal(ownBackground([d("background", "var(--glow)")]), "kept");
    assert.equal(ownBackground([d("background-color", "#ff5e6b"), d("color", "#fff")]), "kept");
    assert.equal(ownBackground([d("background", "var(--accent)")]), "dark");
    assert.equal(ownBackground([d("background-color", "#0c0d12")]), "light");
    assert.equal(ownBackground([d("background-color", "rgba(255, 255, 255, 0.08)")]), null);
    assert.equal(ownBackground([d("color", "#fff")]), null);
  });
  test("une règle entière : sélecteur limité au thème clair sans changer sa spécificité", () => {
    const d = (prop: string, value: string) => ({ prop, value, important: false });
    assert.equal(
      lightRule(".a, .b:hover", [d("color", "#fff"), d("padding-top", "4px")]),
      `:where(:root[data-theme-tone="light"]) .a, :where(:root[data-theme-tone="light"]) .b:hover { color: ${INK}; }`,
    );
    // Bouton à la couleur d'accent (foncée en clair) : son texte noir devient clair, sans être refoncé.
    const primary = lightRule(".btn.primary", [d("background-color", "var(--accent)"), d("color", "#0c0d12")])!;
    const txt = parseColor(primary.match(/color: ([^;]+);/)![1])!;
    assert.ok(txt[0] > 220, primary);
    // Élément de couleur vive : laissé tel quel.
    assert.equal(lightRule(".badge", [d("background-color", "#ff5e6b"), d("color", "#fff")]), null);
    // Règle déjà propre à un thème, ou sans couleur : rien.
    assert.equal(lightRule(':root[data-theme="verre"] .island', [d("box-shadow", "inset 0 0 0 1px rgba(255, 255, 255, 0.14)")]), null);
    assert.equal(lightRule(".x", [d("width", "10px")]), null);
    // !important est gardé.
    assert.match(lightRule(".y", [{ prop: "color", value: "#fff", important: true }])!, /!important/);
    assert.equal(scopeSelector(":root"), ':root:where([data-theme-tone="light"])');
    assert.equal(scopeSelector("html, body"), 'html:where([data-theme-tone="light"]), :where(:root[data-theme-tone="light"]) body');
    assert.deepEqual(splitSelectors(".a:is(.b, .c), .d"), [".a:is(.b, .c)", ".d"]);
  });
});

describe("molette = volume", () => {
  test("un cran = 2 points, vers le haut = plus fort", () => {
    const w = new WheelVolume();
    assert.equal(w.push(-100, 0, 0), STEP_PER_NOTCH);
    assert.equal(w.push(100, 0, 50), -STEP_PER_NOTCH);
    // En lignes (deltaMode 1 : 3 lignes par cran).
    assert.equal(new WheelVolume().push(-3, 1, 0), STEP_PER_NOTCH);
  });
  test("un pavé tactile : les petits pas s'additionnent ; un changement de sens repart de zéro", () => {
    const w = new WheelVolume();
    let total = 0;
    for (let i = 0; i < 10; i++) total += w.push(-10, 0, i * 10);
    assert.equal(total, 2);
    assert.equal(w.push(10, 0, 120), 0); // le reste vers le haut est oublié
    // Un vieux reste est oublié.
    const v = new WheelVolume();
    assert.equal(v.push(-40, 0, 0), 0);
    assert.equal(v.push(-40, 0, 2000), 0);
    // Une molette lancée : au plus 5 crans par événement.
    assert.equal(new WheelVolume().push(-5000, 0, 0), 5 * STEP_PER_NOTCH);
    assert.equal(new WheelVolume().push(0, 0, 0), 0);
  });
  test("le volume reste entre 0 et 100 ; monter rétablit le son coupé", () => {
    assert.deepEqual(nextVolume(99, false, 4), { volume: 100, muted: false });
    assert.deepEqual(nextVolume(1, false, -4), { volume: 0, muted: false });
    assert.deepEqual(nextVolume(30, true, 2), { volume: 32, muted: false });
    assert.deepEqual(nextVolume(30, true, -2), { volume: 28, muted: true });
    assert.equal(speakerLevel(0, false), 0);
    assert.equal(speakerLevel(70, true), 0);
    assert.equal(speakerLevel(30, false), 1);
    assert.equal(speakerLevel(80, false), 2);
  });
  test("où la molette règle le son : mini-île, trait, alerte ; île ouverte seulement sur la mascotte", () => {
    for (const s of ["compact", "peek", "alert"]) assert.ok(wheelSetsVolume(s, false), s);
    assert.ok(!wheelSetsVolume("expanded", false));
    assert.ok(wheelSetsVolume("expanded", true));
    assert.ok(!wheelSetsVolume("hidden", true));
    assert.ok(!wheelSetsVolume("drop", true));
  });
});

describe("double-clic sur Ondine", () => {
  test("action : Parler à Ondine par défaut, les autres reconnues", () => {
    assert.equal(doubleClickActionOf(undefined), "ask");
    assert.equal(doubleClickActionOf("n'importe quoi"), "ask");
    for (const a of ["ask", "launcher", "capture", "note", "none"]) assert.equal(doubleClickActionOf(a), a);
  });
  test("deux clics rapprochés, puis rien : l'action part", () => {
    const d = new DoubleClick();
    assert.equal(d.click(0), false);
    assert.equal(d.click(200), true);
    assert.equal(d.confirm(200 + CONFIRM_MS), true);
    // Une seule fois.
    assert.equal(d.confirm(200 + CONFIRM_MS + 10), false);
  });
  test("trois clics ou plus (agacée, étourdie, surprise) : aucune action", () => {
    const d = new DoubleClick();
    d.click(0);
    assert.equal(d.click(150), true);
    assert.equal(d.click(300), false); // 3e clic avant la confirmation
    assert.equal(d.confirm(150 + CONFIRM_MS), false);
    assert.equal(d.click(450), false);
    assert.equal(d.click(600), false);
  });
  test("deux clics trop espacés : pas un double-clic ; après une pause, ça recommence", () => {
    const d = new DoubleClick();
    d.click(0);
    assert.equal(d.click(DOUBLE_MS + 50), false);
    d.click(5000);
    assert.equal(d.click(5100), true);
    // Un geste (on tire Ondine) remet à zéro.
    d.reset();
    assert.equal(d.confirm(9999), false);
  });
});

describe("halo aux couleurs de la pochette", () => {
  /** Une image de `n` pixels d'une couleur, puis `m` d'une autre. */
  const pixels = (...parts: [number, [number, number, number]][]) => {
    const out: number[] = [];
    for (const [n, [r, g, b]] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
    return out;
  };
  test("pochette grise, noire ou blanche : pas de couleurs (palette musique)", () => {
    assert.equal(coverPalette(pixels([144, [128, 128, 128]])), null);
    assert.equal(coverPalette(pixels([100, [0, 0, 0]], [44, [255, 255, 255]])), null);
    assert.equal(coverPalette([]), null);
  });
  test("les teintes les plus présentes d'abord, rendues vives", () => {
    const p = coverPalette(pixels([90, [200, 40, 40]], [54, [40, 60, 200]]))!;
    assert.ok(p && p.length === 2, JSON.stringify(p));
    const [r1, g1, b1] = hexToRgb(p[0])!;
    assert.ok(r1 > g1 && r1 > b1, "rouge d'abord");
    const [r2, , b2] = hexToRgb(p[1])!;
    assert.ok(b2 > r2, "puis bleu");
    for (const c of p) assert.match(c, /^#[0-9a-f]{6}$/);
  });
  test("une seule teinte : trois voisines (la lumière bouge quand même)", () => {
    const p = coverPalette(pixels([144, [120, 90, 40]]))!; // sépia
    assert.equal(p.length, 3);
    assert.equal(new Set(p).size, 3);
  });
});
