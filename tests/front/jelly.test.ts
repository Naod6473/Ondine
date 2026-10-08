// Tests de l'île en gelée : les ressorts et le réglage « Élasticité »
// (src/island/spring.ts), le contour, sa chaîne de ressorts et le chemin de
// découpe (src/island/contour.ts), et la secousse (src/island/gestures.ts).
// Tout ça est du calcul pur : pas de page, Node suffit.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ELASTICITIES,
  FEELS,
  elasticityOf,
  feelFor,
  overshoot,
  rubber,
  squashScale,
  springAtRest,
  stepSpring,
  type Spring,
} from "../../src/island/spring";
import { EdgeChain, bumpOffset, clampRadii, contourPath, nearestU, perimeter, pointAt, sampleContour, wrapDelta, type Rect } from "../../src/island/contour";
import { ShakeDetector } from "../../src/island/gestures";
import { defaultSettings } from "../../src/core/types";

/** Fait tourner un ressort `secs` secondes à 60 images/s ; renvoie le plus haut atteint. */
function run(s: Spring, target: number, secs: number, p = FEELS.normal.lead, fps = 60): number {
  let peak = s.x;
  for (let i = 0; i < secs * fps; i++) {
    stepSpring(s, target, p, 1 / fps);
    peak = Math.max(peak, s.x);
  }
  return peak;
}

describe("ressorts", () => {
  test("un ressort rejoint sa cible et s'y pose", () => {
    const s = { x: 0, v: 0 };
    run(s, 270, 2);
    assert.ok(Math.abs(s.x - 270) < 0.25, `x = ${s.x}`);
    assert.ok(springAtRest(s, 270));
  });

  test("le dépassement suit l'amortissement (≈ formule du ressort amorti)", () => {
    const s = { x: 0, v: 0 };
    const peak = run(s, 100, 1.5);
    const want = 100 * (1 + overshoot(FEELS.normal.lead.damping));
    assert.ok(Math.abs(peak - want) < 1.5, `pic ${peak}, attendu ≈ ${want}`);
    // Sans rebond (ζ ≥ 1), aucun dépassement.
    assert.equal(overshoot(1), 0);
  });

  test("changer de cible en route garde l'élan (interruptible)", () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 6; i++) stepSpring(s, 270, FEELS.normal.lead, 1 / 60);
    const before = s.x;
    assert.ok(s.v > 100, "il va vite vers 270");
    // Nouvelle cible (on referme) : l'île continue un peu sur sa lancée avant
    // de faire demi-tour (une transition CSS, elle, repartirait à vitesse
    // nulle, déjà en arrière).
    stepSpring(s, 0, FEELS.normal.lead, 1 / 60);
    assert.ok(s.x > before, `${s.x} après ${before}`);
    const css = { x: before, v: 0 };
    stepSpring(css, 0, FEELS.normal.lead, 1 / 60);
    assert.ok(css.x < before);
    run(s, 0, 2);
    assert.ok(Math.abs(s.x) < 0.25);
  });

  test("stable à 30 images/s (économie d'énergie) et après une longue pause", () => {
    const s = { x: 0, v: 0 };
    run(s, 640, 2, FEELS.jelly.lead, 30);
    assert.ok(Number.isFinite(s.x) && Math.abs(s.x - 640) < 0.5);
    // Une image de 3 s (fenêtre gelée) compte comme 1/20 s au plus.
    const t = { x: 0, v: 0 };
    stepSpring(t, 100, FEELS.normal.lead, 3);
    assert.ok(t.x < 100 && t.x > 0, `x = ${t.x}`);
  });

  test("l'écrasement conserve le volume et suit le sens", () => {
    const [a, l] = squashScale(3000, 1);
    assert.ok(a > 1 && l < 1, "en grandissant : plus haute, plus fine");
    assert.ok(Math.abs(a * l - 1) < 1e-9);
    const [a2, l2] = squashScale(-3000, 1);
    assert.ok(a2 < 1 && l2 > 1, "en rétrécissant : aplatie, plus large");
    // Plafonné : jamais plus de 10 %.
    assert.ok(squashScale(1e9, 5)[0] <= 1.1 + 1e-9);
    assert.deepEqual(squashScale(5000, 0), [1, 1]);
  });

  test("l'élastique résiste et ne dépasse jamais son maximum", () => {
    assert.equal(rubber(0, 42), 0);
    assert.ok(rubber(10, 42) > 0 && rubber(10, 42) < 10);
    assert.ok(rubber(10_000, 42) <= 42);
    assert.ok(rubber(-10_000, 14) >= -14);
    assert.equal(rubber(5, 0), 0);
  });
});

describe("réglage Élasticité", () => {
  test("lecture du réglage : une valeur inconnue redevient « normal »", () => {
    for (const e of ELASTICITIES) assert.equal(elasticityOf(e), e);
    assert.equal(elasticityOf(undefined), "normal");
    assert.equal(elasticityOf("gelee"), "normal");
    assert.equal(elasticityOf(3), "normal");
  });

  test("valeur par défaut : normal", () => {
    assert.equal(defaultSettings().island.elasticity, "normal");
  });

  test("Doux < Normal < Gelée : de moins en moins amorti, de plus en plus ample", () => {
    const { soft, normal, jelly } = FEELS;
    assert.ok(soft.lead.damping > normal.lead.damping && normal.lead.damping > jelly.lead.damping);
    assert.ok(soft.bump.damping > normal.bump.damping && normal.bump.damping > jelly.bump.damping);
    assert.ok(soft.amp < normal.amp && normal.amp < jelly.amp);
    assert.ok(soft.squash < normal.squash && normal.squash < jelly.squash);
  });

  test("Studio rebondit un peu plus, sauf le grand panneau", () => {
    assert.ok(feelFor("normal", true, false).lead.damping < FEELS.normal.lead.damping);
    assert.equal(feelFor("normal", true, true), FEELS.normal);
    assert.equal(feelFor("normal", false, false), FEELS.normal);
  });

  test("l'île ouverte qui dépasse tient dans la fenêtre (320 px de haut)", () => {
    // 270 px + le dépassement de l'épaisseur (Gelée, le plus fort) + l'écrasement (10 %).
    const worst = 270 * (1 + overshoot(FEELS.jelly.lead.damping));
    assert.ok(worst < 320, `${worst} px`);
  });
});

const COMPACT: Rect = { w: 340, h: 42, r: { tl: 0, tr: 0, br: 21, bl: 21 } };

describe("contour", () => {
  test("longueur du tour : rectangle, puis coins arrondis", () => {
    assert.equal(perimeter({ w: 100, h: 50, r: { tl: 0, tr: 0, br: 0, bl: 0 } }), 300);
    const round = perimeter({ w: 100, h: 50, r: { tl: 10, tr: 10, br: 10, bl: 10 } });
    assert.ok(Math.abs(round - (300 - 80 + 2 * Math.PI * 10)) < 1e-9);
  });

  test("des arrondis trop grands sont réduits, comme en CSS", () => {
    const r = clampRadii({ w: 40, h: 10, r: { tl: 0, tr: 0, br: 30, bl: 30 } });
    assert.ok(Math.abs(r.br - 10) < 1e-9 && Math.abs(r.bl - 10) < 1e-9);
    // Valeurs absurdes : 0.
    assert.equal(clampRadii({ w: 10, h: 10, r: { tl: NaN, tr: -3, br: 0, bl: 0 } }).tl, 0);
  });

  test("le tracé garde les coins vifs exacts et reste sur la forme", () => {
    const pts = sampleContour(COMPACT, 5);
    assert.ok(pts.some((p) => p.x === 0 && p.y === 0), "coin haut-gauche (collé à l'écran)");
    assert.ok(pts.some((p) => p.x === 340 && p.y === 0), "coin haut-droit");
    for (const p of pts) {
      assert.ok(p.x >= -1e-9 && p.x <= 340 + 1e-9 && p.y >= -1e-9 && p.y <= 42 + 1e-9, `${p.x},${p.y}`);
      assert.ok(Math.abs(Math.hypot(p.nx, p.ny) - 1) < 1e-9, "normale unitaire");
    }
    // Les fractions du tour croissent de 0 à 1.
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].u > pts[i - 1].u);
    assert.ok(pts.length > 100 && pts.length < 300);
  });

  test("point à une fraction du tour ↔ fraction du point le plus proche", () => {
    // Le milieu du bord du bas (à 340 + 21 + … du début) :
    const u = nearestU(COMPACT, 170, 42);
    const p = pointAt(COMPACT, u);
    assert.ok(Math.abs(p.x - 170) < 3 && Math.abs(p.y - 42) < 0.5);
    assert.equal(p.ny, 1);
    assert.ok(Math.abs(wrapDelta(0.95, 0.05) - -0.1) < 1e-9);
    assert.ok(Math.abs(wrapDelta(0.05, 0.95) - 0.1) < 1e-9);
  });
});

describe("chaîne de ressorts du contour", () => {
  test("un appui creuse, le relâcher fait partir une onde, puis tout se pose", () => {
    const chain = new EdgeChain(96);
    const params = FEELS.normal.edge;
    const pressAt = 0.5;
    chain.press(pressAt, 6, 0.03);
    for (let i = 0; i < 30; i++) chain.step(1 / 60, params);
    assert.ok(chain.at(pressAt) < -4, `creux de ${chain.at(pressAt)} px`);
    assert.ok(!chain.atRest(), "pas au repos tant qu'on appuie");
    chain.release();
    // L'onde arrive loin du creux (un quart de tour plus loin).
    let far = 0;
    for (let i = 0; i < 40; i++) {
      chain.step(1 / 60, params);
      far = Math.max(far, Math.abs(chain.at(pressAt + 0.25)));
    }
    assert.ok(far > 0.3, `l'onde est arrivée (${far} px)`);
    for (let i = 0; i < 400 && !chain.atRest(); i++) chain.step(1 / 60, params);
    assert.ok(chain.atRest(), "posée au bout de quelques secondes");
  });

  test("les points collés au bord de l'écran ne bougent jamais", () => {
    const chain = new EdgeChain(96);
    // Le haut de la pilule (début du tour) est collé à l'écran.
    chain.pin((u) => pointAt(COMPACT, u).y <= 0.5);
    chain.impulse(0.6, 400, 0.08);
    for (let i = 0; i < 120; i++) {
      chain.step(1 / 60, FEELS.jelly.edge);
      for (let j = 0; j < chain.n; j++) if (chain.pinned[j]) assert.equal(chain.d[j], 0);
    }
    assert.ok(chain.pinned.some((p) => p === 1) && chain.pinned.some((p) => p === 0));
  });

  test("le choc d'une alerte creuse d'abord (vers l'intérieur)", () => {
    const chain = new EdgeChain(96);
    chain.impulse(0.5, 300, 0.07);
    chain.step(1 / 60, FEELS.normal.edge);
    assert.ok(chain.at(0.5) < 0);
  });
});

describe("chemin de découpe", () => {
  const box = (path: string) => {
    const nums = [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    return {
      n: nums.length,
      minX: Math.min(...nums.map((p) => p[0])),
      maxX: Math.max(...nums.map((p) => p[0])),
      minY: Math.min(...nums.map((p) => p[1])),
      maxY: Math.max(...nums.map((p) => p[1])),
    };
  };

  test("au repos : la forme exacte, un chemin fermé, sans NaN", () => {
    const pts = sampleContour(COMPACT, 5);
    const path = contourPath(pts, { x: 0, y: 0 }, () => 0, null);
    assert.match(path, /^M0 0L/);
    assert.ok(path.endsWith("Z"));
    assert.ok(!path.includes("NaN"));
    const b = box(path);
    assert.equal(b.n, pts.length);
    assert.deepEqual([b.minX, b.maxX, b.minY, b.maxY], [0, 340, 0, 42]);
  });

  test("un creux rentre, un gonflement est ignoré (la découpe ne fait que retirer)", () => {
    const pts = sampleContour(COMPACT, 5);
    const inward = box(contourPath(pts, { x: 0, y: 0 }, () => -3, null));
    assert.ok(inward.maxY <= 39 + 1e-9);
    const outward = box(contourPath(pts, { x: 0, y: 0 }, () => 5, null));
    assert.deepEqual([outward.minX, outward.maxX, outward.maxY], [0, 340, 42]);
  });

  test("la bosse sort sous la souris, penche de côté, et laisse le bord collé en place", () => {
    const pts = sampleContour(COMPACT, 5);
    const bump = { along: { x: 0, y: 1 }, center: 250, depth: 30, shift: 12, width: 40 };
    const path = contourPath(pts, { x: 0, y: 0 }, () => 0, bump);
    const b = box(path);
    assert.ok(Math.abs(b.maxY - 72) < 1, `sommet à ${b.maxY}`);
    assert.equal(b.minY, 0);
    // Le sommet est près de la souris (250 + le penchant).
    const tip = [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]).sort((p, q) => q[1] - p[1])[0];
    assert.ok(Math.abs(tip[0] - 262) < 6, `sommet en x = ${tip[0]}`);
    // Le bord du haut (normale vers l'écran) ne bouge pas.
    assert.deepEqual(bumpOffset({ x: 250, y: 0, nx: 0, ny: -1 }, bump), { dx: 0, dy: 0 });
  });

  test("sur un côté de l'écran, la bosse sort vers la droite (île à gauche)", () => {
    const side: Rect = { w: 42, h: 340, r: { tl: 0, tr: 21, br: 21, bl: 0 } };
    const bump = { along: { x: 1, y: 0 }, center: 170, depth: 20, shift: 0, width: 40 };
    const b = box(contourPath(sampleContour(side, 5), { x: 0, y: 0 }, () => 0, bump));
    assert.ok(Math.abs(b.maxX - 62) < 1 && b.minX === 0);
  });
});

describe("secousse", () => {
  test("des allers-retours rapides : secousse ; lents ou petits : non", () => {
    const fast = new ShakeDetector();
    const seq = [0, 20, 0, 20, 0, 20, 0];
    const hits = seq.map((x, i) => fast.feed(x, i * 80));
    assert.ok(hits.includes(true));

    const slow = new ShakeDetector();
    assert.ok(!seq.map((x, i) => slow.feed(x, i * 1000)).includes(true));

    const small = new ShakeDetector();
    assert.ok(![0, 5, 0, 5, 0, 5, 0, 5].map((x, i) => small.feed(x, i * 50)).includes(true));
  });
});
