// Tests des paroles du module Musique (src/modules/media/lyrics-logic.ts) :
// le format LRC (plusieurs horodatages par ligne, lignes vides, décalage),
// le texte seul, la ligne chantée, le prochain changement, et ce que la vue
// montre selon la réponse de LRCLIB. Plus le réglage (coupé par défaut) et
// ses traductions.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentLine, lyricsKey, lyricsView, msUntilNextLine, parseLrc, plainLines, scrollFor } from "../../src/modules/media/lyrics-logic";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };

describe("paroles : le format LRC", () => {
  test("une ligne, un horodatage", () => {
    assert.deepEqual(parseLrc("[00:12.30] La mer s'en va\n[00:15.00]Sans bruit"), [
      { timeMs: 12_300, text: "La mer s'en va" },
      { timeMs: 15_000, text: "Sans bruit" },
    ]);
  });

  test("plusieurs horodatages : la même ligne à chaque fois, dans l'ordre du temps", () => {
    assert.deepEqual(parseLrc("[00:10.00][01:10.00]Refrain\n[00:20.00]Couplet"), [
      { timeMs: 10_000, text: "Refrain" },
      { timeMs: 20_000, text: "Couplet" },
      { timeMs: 70_000, text: "Refrain" },
    ]);
  });

  test("dixièmes, centièmes, millièmes, ou rien après les secondes", () => {
    const l = parseLrc("[00:01.5]a\n[00:02.25]b\n[00:03.125]c\n[00:04]d\n[01:02:50]e");
    assert.deepEqual(
      l.map((x) => x.timeMs),
      [1_500, 2_250, 3_125, 4_000, 62_500],
    );
  });

  test("balises d'information ignorées, décalage appliqué", () => {
    const l = parseLrc("[ar:Les Ondées]\n[ti:Marée basse]\n[offset:+500]\n[00:10.00]Une\nTexte sans horodatage\n[00:00.20]Tôt");
    assert.deepEqual(l, [
      { timeMs: 0, text: "Tôt" },
      { timeMs: 9_500, text: "Une" },
    ]);
  });

  test("lignes vides : un passage sans paroles, jamais deux de suite, ni au début, ni à la fin", () => {
    const l = parseLrc("[00:01.00]\n[00:05.00]Une\n[00:09.00]\n[00:10.00]\n[00:12.00]Deux\n[00:20.00]\n\n\n");
    assert.deepEqual(l, [
      { timeMs: 5_000, text: "Une" },
      { timeMs: 9_000, text: "" },
      { timeMs: 12_000, text: "Deux" },
    ]);
  });

  test("Windows (\\r\\n), secondes impossibles, texte vide", () => {
    assert.deepEqual(parseLrc("[00:01.00]Une\r\n[00:75.00]Faux\r\n"), [{ timeMs: 1_000, text: "Une" }]);
    assert.deepEqual(parseLrc(""), []);
  });
});

describe("paroles : texte seul", () => {
  test("les lignes, sans vides en double ni au bord", () => {
    assert.deepEqual(plainLines("\n\nUne\n\n\nDeux\r\nTrois\n\n"), ["Une", "", "Deux", "Trois"]);
  });
});

describe("paroles : la ligne chantée", () => {
  const lines = parseLrc("[00:10.00]Une\n[00:20.00]Deux\n[00:30.00]Trois");

  test("avant la première, pile dessus, entre deux, après la dernière", () => {
    assert.equal(currentLine(lines, 0), -1);
    assert.equal(currentLine(lines, 10_000), 0);
    assert.equal(currentLine(lines, 25_000), 1);
    assert.equal(currentLine(lines, 999_000), 2);
    assert.equal(currentLine([], 5_000), -1);
  });

  test("le prochain changement de ligne", () => {
    assert.equal(msUntilNextLine(lines, 0), 10_000);
    assert.equal(msUntilNextLine(lines, 19_500), 500);
    assert.equal(msUntilNextLine(lines, 31_000), null);
  });

  test("la ligne se place vers le haut du cadre", () => {
    // Cadre de 150 px, ligne à 100 px de haut de 28 px : 60 - 100 - 14.
    assert.equal(scrollFor(150, 100, 28), -54);
    assert.equal(scrollFor(150, 0, 28), 46);
  });

  test("un morceau = titre, artiste, album, durée à la seconde", () => {
    const a = lyricsKey({ title: "T", artist: "A", album: "B", durationMs: 200_400 });
    assert.equal(a, lyricsKey({ title: "T", artist: "A", album: "B", durationMs: 199_800 }));
    assert.notEqual(a, lyricsKey({ title: "T", artist: "A", album: "", durationMs: 200_400 }));
  });
});

describe("paroles : ce que la vue montre", () => {
  test("synchronisées d'abord, sinon le texte seul, sinon rien", () => {
    assert.equal(lyricsView({ found: true, synced: "[00:01.00]Une", plain: "Une", instrumental: false }).kind, "synced");
    assert.deepEqual(lyricsView({ found: true, synced: null, plain: "Une\nDeux", instrumental: false }), { kind: "plain", lines: ["Une", "Deux"] });
    // Un LRC sans aucun texte : on montre le texte seul.
    assert.equal(lyricsView({ found: true, synced: "[00:01.00]", plain: "Une", instrumental: false }).kind, "plain");
    assert.equal(lyricsView({ found: true, synced: null, plain: null, instrumental: true }).kind, "instrumental");
    assert.equal(lyricsView({ found: false, synced: null, plain: null, instrumental: false }).kind, "none");
    assert.equal(lyricsView(null).kind, "none");
  });
});

describe("paroles : le réglage", () => {
  const manifest = JSON.parse(readFileSync("src/modules/media/manifest.json", "utf8")) as {
    permissions: string[];
    commands: string[];
    settings: { fields: { key: string; default: unknown; label: string; help?: string }[] };
  };

  test("coupé par défaut, l'aide dit ce qui part et où", () => {
    const f = manifest.settings.fields.find((x) => x.key === "lyrics")!;
    assert.equal(f.default, false);
    assert.equal(f.label, "Paroles (LRCLIB)");
    for (const word of ["titre", "artiste", "album", "durée", "lrclib.net"]) assert.ok(f.help?.includes(word), word);
    assert.ok(manifest.permissions.includes("network"));
    assert.ok(manifest.commands.includes("lyrics"));
  });

  test("le Rust n'envoie que titre, artiste, album et durée, avec le bon User-Agent", () => {
    const rust = readFileSync("src-tauri/src/modules/media.rs", "utf8");
    assert.match(rust, /"Ondine \(https:\/\/github\.com\/Naod6473\/Ondine\)"/);
    assert.match(rust, /https:\/\/lrclib\.net\/api\/get/);
    const query = rust.slice(rust.indexOf("fn lyrics_query"), rust.indexOf("fn parse_lyrics"));
    const keys = [...query.matchAll(/\("([a-z_]+)",/g)].map((m) => m[1]);
    assert.deepEqual(keys, ["track_name", "artist_name", "album_name", "duration"]);
  });

  test("les textes ont leur traduction anglaise", () => {
    for (const fr of ["Paroles", "Pas de paroles pour ce morceau", "Recherche des paroles…", "Paroles non synchronisées", "Morceau instrumental : pas de paroles", "Afficher les paroles", "Fermer les paroles"]) {
      assert.ok(DICT.exact[fr], fr);
    }
  });
});
