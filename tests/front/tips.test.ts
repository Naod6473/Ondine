// Tests des astuces à la première ouverture d'un onglet (src/island/tips.ts) :
// quand montrer la bulle, la liste des onglets vus, et la phrase de chaque
// module à onglet (dans son manifeste), traduite et tutoyée.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MAX_TIPS_SEEN, tipWanted, withSeen } from "../../src/island/tip-state";

describe("quand montrer l'astuce", () => {
  const tip = "Glissez un fichier sur l'île pour le poser ici.";
  test("la première fois seulement", () => {
    assert.equal(tipWanted("shelf", tip, { tips: true, tipsSeen: [] }, false), true);
    assert.equal(tipWanted("shelf", tip, { tips: true, tipsSeen: ["notes", "shelf"] }, false), false);
  });
  test("jamais réglage coupé, en mode démo, ou sans phrase", () => {
    assert.equal(tipWanted("shelf", tip, { tips: false, tipsSeen: [] }, false), false);
    assert.equal(tipWanted("shelf", tip, { tips: true, tipsSeen: [] }, true), false);
    assert.equal(tipWanted("shelf", undefined, { tips: true, tipsSeen: [] }, false), false);
    assert.equal(tipWanted("shelf", "  ", {}, false), false);
  });
  test("réglages absents (ancien fichier) : astuces activées", () => {
    assert.equal(tipWanted("shelf", tip, {}, false), true);
  });
});

describe("onglets vus", () => {
  test("ajout sans doublon", () => {
    assert.deepEqual(withSeen([], "shelf"), ["shelf"]);
    assert.deepEqual(withSeen(["shelf"], "shelf"), ["shelf"]);
    assert.deepEqual(withSeen(["shelf"], "notes"), ["shelf", "notes"]);
  });
  test("la liste ne grossit jamais sans fin", () => {
    let seen: string[] = [];
    for (let i = 0; i < MAX_TIPS_SEEN + 10; i++) seen = withSeen(seen, `m${i}`);
    assert.equal(seen.length, MAX_TIPS_SEEN);
    assert.equal(seen[seen.length - 1], `m${MAX_TIPS_SEEN + 9}`);
  });
});

// ── La phrase de chaque module ────────────────────────────────────────────────

interface Manifest {
  id: string;
  tip?: string;
  views: string[];
}

const MANIFESTS: Manifest[] = readdirSync("src/modules", { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => JSON.parse(readFileSync(join("src", "modules", e.name, "manifest.json"), "utf8")) as Manifest);
const EN = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string> };
const TU = JSON.parse(readFileSync("src/core/i18n-fr-tu.json", "utf8")) as { exact: Record<string, string> };
/** Un impératif au « vous » (« Glissez ») ou « vous / votre / vos ». */
const VOUS = /(?<![\p{L}-])(?:vous|votre|vos)(?![\p{L}])|\p{L}{2,}ez(?![\p{L}])/iu;

describe("la phrase des modules à onglet", () => {
  const tabbed = MANIFESTS.filter((m) => m.views.includes("expanded"));

  test("chaque module à onglet a son astuce", () => {
    assert.ok(tabbed.length >= 10, "le test ne trouve presque aucun module");
    assert.deepEqual(
      tabbed.filter((m) => !m.tip?.trim()).map((m) => m.id),
      [],
      "ajoutez un champ \"tip\" (une phrase, au « vous ») dans le manifest.json de ces modules",
    );
  });

  test("une seule phrase courte, au « vous », qui finit par un point", () => {
    const bad: string[] = [];
    for (const m of tabbed) {
      const tip = m.tip ?? "";
      if (tip.length > 140) bad.push(`${m.id} : trop longue (${tip.length} caractères)`);
      if (!tip.endsWith(".")) bad.push(`${m.id} : doit finir par un point`);
      if (/[.!?] \p{Lu}/u.test(tip)) bad.push(`${m.id} : plusieurs phrases`);
      if (!VOUS.test(tip)) bad.push(`${m.id} : pas au « vous »`);
    }
    assert.deepEqual(bad, []);
  });

  test("pas d'astuce pour un module sans onglet", () => {
    assert.deepEqual(
      MANIFESTS.filter((m) => !m.views.includes("expanded") && m.tip).map((m) => m.id),
      [],
    );
  });

  test("chaque astuce a sa traduction anglaise et sa version au « tu »", () => {
    const missing: string[] = [];
    for (const m of tabbed) {
      if (!m.tip) continue;
      if (!EN.exact[m.tip]) missing.push(`${m.id} : anglais (src/core/i18n-en.json)`);
      if (!TU.exact[m.tip]) missing.push(`${m.id} : tutoiement (src/core/i18n-fr-tu.json)`);
    }
    assert.deepEqual(missing, []);
  });
});
