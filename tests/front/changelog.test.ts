// Tests de la lecture de CHANGELOG.md (« Quoi de neuf » après une mise à jour,
// src/core/changelog.ts) : sections, puces sur plusieurs lignes, moitié
// française ou anglaise, version absente, et quand montrer la notification.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changelogSection, parseChangelog, shorten, splitBilingual, whatsNewAction, whatsNewLines } from "../../src/core/changelog";

const SAMPLE = [
  "# Changements · Changelog",
  "",
  "## 1.2.0 · 2026-11-02",
  "",
  "- Première puce. · First bullet.",
  "- Une puce sur deux lignes, avec « des guillemets »",
  "  et la suite en retrait. · A bullet over two lines,",
  "  continued.",
  "- Bilan de la semaine (Pomodoros · tâches). · Weekly summary.",
  "",
  "- Après une ligne vide. · After a blank line.",
  "",
  "### Corrections",
  "",
  "- Une correction. · A fix.",
  "",
  "## 1.1.0-beta.2",
  "",
  "- Sans date ni traduction",
  "",
  "## [1.0.0] - 2026-10-07",
  "",
  "* Autre forme de titre. · Other heading style.",
].join("\n");

describe("lecture du CHANGELOG", () => {
  test("les sections : version, date, puces dans l'ordre", () => {
    const s = parseChangelog(SAMPLE);
    assert.deepEqual(
      s.map((x) => [x.version, x.date, x.items.length]),
      [
        ["1.2.0", "2026-11-02", 5],
        ["1.1.0-beta.2", "", 1],
        ["1.0.0", "2026-10-07", 1],
      ],
    );
  });

  test("une puce sur plusieurs lignes est recollée en une seule", () => {
    const items = changelogSection(SAMPLE, "1.2.0")!.items;
    assert.equal(items[1], "Une puce sur deux lignes, avec « des guillemets » et la suite en retrait. · A bullet over two lines, continued.");
    // Les puces sous « ### Corrections » restent dans la version.
    assert.equal(items[4], "Une correction. · A fix.");
  });

  test("version absente : null", () => {
    assert.equal(changelogSection(SAMPLE, "9.9.9"), null);
    assert.equal(whatsNewLines(SAMPLE, "9.9.9", "fr"), null);
    assert.equal(whatsNewLines("", "1.0.0", "en"), null);
  });

  test("« v1.2.0 » trouve « 1.2.0 »", () => {
    assert.equal(changelogSection(SAMPLE, "v1.2.0")?.version, "1.2.0");
  });

  test("chaque puce : la moitié de la langue choisie", () => {
    assert.deepEqual(whatsNewLines(SAMPLE, "1.2.0", "fr"), [
      "Première puce.",
      "Une puce sur deux lignes, avec « des guillemets » et la suite en retrait.",
      "Bilan de la semaine (Pomodoros · tâches).",
    ]);
    assert.deepEqual(whatsNewLines(SAMPLE, "1.2.0", "en"), ["First bullet.", "A bullet over two lines, continued.", "Weekly summary."]);
    // Sans « · » : le même texte dans les deux langues.
    assert.deepEqual(whatsNewLines(SAMPLE, "1.1.0-beta.2", "en"), ["Sans date ni traduction"]);
    assert.deepEqual(whatsNewLines(SAMPLE, "1.0.0", "fr", 3), ["Autre forme de titre."]);
  });

  test("le « · » qui sépare les langues suit une fin de phrase", () => {
    assert.deepEqual(splitBilingual("Menu · Réglages, en un clic. · Menu · Settings, in one click."), {
      fr: "Menu · Réglages, en un clic.",
      en: "Menu · Settings, in one click.",
    });
    assert.deepEqual(splitBilingual("Textes au « vous » (Réglages → Général). · French texts."), {
      fr: "Textes au « vous » (Réglages → Général).",
      en: "French texts.",
    });
    assert.deepEqual(splitBilingual("Sans point · Without dot"), { fr: "Sans point", en: "Without dot" });
  });

  test("une ligne trop longue est raccourcie au mot près", () => {
    assert.equal(shorten("court", 20), "court");
    const s = shorten("un deux trois quatre cinq six sept", 20);
    assert.ok(s.length <= 20, s);
    assert.equal(s, "un deux trois…");
  });

  test("le vrai CHANGELOG.md : chaque version a des puces, en deux langues", () => {
    const text = readFileSync("CHANGELOG.md", "utf8");
    const sections = parseChangelog(text);
    assert.ok(sections.length >= 3, "le lecteur ne trouve presque aucune version");
    const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
    const fr = whatsNewLines(text, version, "fr");
    const en = whatsNewLines(text, version, "en");
    assert.ok(fr && fr.length > 0, `la version ${version} (package.json) n'a pas de section dans CHANGELOG.md`);
    assert.ok(en && en.length === fr.length);
    for (let i = 0; i < fr.length; i++) assert.notEqual(fr[i], en![i], `puce ${i + 1} : pas de moitié anglaise ?`);
  });
});

describe("quand montrer « Quoi de neuf »", () => {
  test("premier lancement : on retient seulement la version", () => {
    assert.equal(whatsNewAction("", "1.0.2", false, false), "remember");
  });
  test("même version : rien", () => {
    assert.equal(whatsNewAction("1.0.2", "1.0.2", true, false), "nothing");
  });
  test("autre version : la notification", () => {
    assert.equal(whatsNewAction("1.0.1", "1.0.2", true, false), "show");
  });
  test("version jamais notée mais Ondine a déjà tourné (mise à jour depuis une version d'avant ce réglage)", () => {
    assert.equal(whatsNewAction("", "1.0.2", true, false), "show");
  });
  test("mode démo, ou version de développement : rien", () => {
    assert.equal(whatsNewAction("1.0.1", "1.0.2", true, true), "nothing");
    assert.equal(whatsNewAction("1.0.1", "dev", true, false), "nothing");
  });
});
