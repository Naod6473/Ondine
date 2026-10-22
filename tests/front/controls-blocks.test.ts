// Tests de l'onglet Contrôles en blocs (1.2.5), logique sans DOM :
//   - Écrans (src/modules/controls/screens-logic.ts) : les mots de Windows+P,
//     le dessin des écrans à l'échelle pour « Écran principal » ;
//   - l'aide-mémoire (src/modules/controls/cheat-data.ts) : la liste de
//     l'appli devant, le découpage des touches, le filtre ;
//   - le manifest : les nouvelles commandes et les nouveaux réglages.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DISPLAY_MODES, modeName, monitorBoxes, type DisplayInfo } from "../../src/modules/controls/screens-logic";
import { APP_SHEETS, filterGroups, keyName, ONDINE_SHEET, sheetFor, splitKeys, TEXT_SHEET, WINDOWS_SHEET } from "../../src/modules/controls/cheat-data";

const screen = (id: string, x: number, width: number, height: number, primary = false): DisplayInfo => ({ id, name: id, primary, internal: false, x, y: 0, width, height });

describe("Contrôles → Écrans", () => {
  test("les quatre modes de Windows+P ont leur nom", () => {
    assert.deepEqual(DISPLAY_MODES.map(modeName), ["PC seul", "Dupliquer", "Étendre", "2e écran seul"]);
  });

  test("les écrans se rangent de gauche à droite, numérotés", () => {
    const boxes = monitorBoxes([screen("droite", 1920, 1920, 1080), screen("gauche", 0, 1920, 1080, true)]);
    assert.deepEqual(
      boxes.map((b) => [b.name, b.index, b.primary]),
      [
        ["gauche", 1, true],
        ["droite", 2, false],
      ],
    );
  });

  test("à l'échelle : le plus large fait 88 px, les autres en proportion", () => {
    const [big, small] = monitorBoxes([screen("4k", 0, 3840, 2160), screen("hd", 3840, 1920, 1080)]);
    assert.equal(big.w, 88);
    assert.equal(big.h, 50);
    assert.equal(small.w, 44);
    assert.equal(small.h, 25);
  });

  test("un écran minuscule ou sans taille reste visible", () => {
    const [, tiny] = monitorBoxes([screen("a", 0, 7680, 4320), screen("b", 7680, 800, 600)]);
    assert.equal(tiny.w, 24);
    assert.ok(tiny.h >= 16);
    const [zero] = monitorBoxes([screen("z", 0, 0, 0)]);
    assert.ok(zero.w >= 24 && zero.h >= 16);
    assert.deepEqual(monitorBoxes([]), []);
  });
});

describe("Contrôles → aide-mémoire des raccourcis", () => {
  test("l'appli devant choisit sa liste, sans tenir compte de la casse", () => {
    assert.equal(sheetFor("EXCEL").name, "Excel");
    assert.equal(sheetFor("explorer").name, "Explorateur de fichiers");
    assert.equal(sheetFor("msedge").name, sheetFor("chrome").name);
  });

  test("appli inconnue ou aucune : la liste de secours", () => {
    assert.equal(sheetFor("jeu-inconnu"), TEXT_SHEET);
    assert.equal(sheetFor(null), TEXT_SHEET);
    assert.equal(sheetFor(undefined), TEXT_SHEET);
  });

  test("chaque liste a des groupes remplis, et un programme n'appartient qu'à une appli", () => {
    const seen = new Map<string, string>();
    for (const sheet of [TEXT_SHEET, ...APP_SHEETS, WINDOWS_SHEET, ONDINE_SHEET]) {
      assert.ok(sheet.groups.length > 0, sheet.name);
      for (const g of sheet.groups) {
        assert.ok(g.items.length > 0, `${sheet.name} → ${g.title}`);
        for (const it of g.items) assert.ok(it.keys.trim() && it.what.trim(), `${sheet.name} → ${g.title}`);
      }
      for (const p of sheet.programs) {
        assert.equal(p, p.toLowerCase(), `${p} : en minuscules, sans .exe`);
        assert.ok(!p.endsWith(".exe"), p);
        assert.ok(!seen.has(p), `${p} est à la fois dans ${seen.get(p)} et ${sheet.name}`);
        seen.set(p, sheet.name);
      }
    }
  });

  test("les touches se découpent en pastilles, « + » compris", () => {
    assert.deepEqual(splitKeys("Ctrl+Maj+N"), ["Ctrl", "Maj", "N"]);
    assert.deepEqual(splitKeys("Ctrl++"), ["Ctrl", "+"]);
    assert.deepEqual(splitKeys("Échap"), ["Échap"]);
    assert.deepEqual(splitKeys("Win+."), ["Win", "."]);
  });

  test("les touches en anglais : Maj → Shift, Entrée → Enter ; en français rien ne change", () => {
    assert.deepEqual(splitKeys("Ctrl+Maj+Entrée").map((k) => keyName(k, false)), ["Ctrl", "Shift", "Enter"]);
    assert.deepEqual(splitKeys("Ctrl+Maj+Entrée").map((k) => keyName(k, true)), ["Ctrl", "Maj", "Entrée"]);
    assert.equal(keyName("F2", false), "F2");
  });

  test("le filtre cherche dans la touche et l'action, sans accents ni casse", () => {
    const groups = WINDOWS_SHEET.groups;
    assert.equal(filterGroups(groups, ""), groups);
    assert.equal(filterGroups(groups, "   "), groups);
    const hits = filterGroups(groups, "presse-papiers").flatMap((g) => g.items);
    assert.deepEqual(
      hits.map((i) => i.keys),
      ["Win+V"],
    );
    assert.ok(filterGroups(groups, "ecran").flatMap((g) => g.items).some((i) => i.what === "Capture d'écran"));
    assert.ok(filterGroups(groups, "WIN+L").flatMap((g) => g.items).some((i) => i.keys === "Win+L"));
    assert.deepEqual(filterGroups(groups, "zzz-rien"), []);
  });

  test("les raccourcis d'Ondine suivent les réglages d'origine", () => {
    const keys = ONDINE_SHEET.groups.flatMap((g) => g.items.map((i) => i.keys));
    const manifests = ["askclaude", "controls"].map((id) => {
      try {
        return readFileSync(`src/modules/${id}/manifest.json`, "utf8");
      } catch {
        return "";
      }
    });
    const all = manifests.join("\n");
    for (const k of ["Ctrl+Alt+V", "Ctrl+Alt+M"]) {
      assert.ok(keys.includes(k), k);
      assert.ok(all.includes(`"${k}"`), `${k} n'est plus un raccourci d'origine`);
    }
  });
});

describe("Contrôles → manifest", () => {
  const manifest = JSON.parse(readFileSync("src/modules/controls/manifest.json", "utf8")) as {
    commands: string[];
    events: { emits: string[]; listens: string[] };
    settings: { fields: { key: string; default: unknown; min?: number; max?: number }[] };
  };

  test("les commandes Écrans, nettoyage et aide-mémoire sont déclarées", () => {
    for (const c of ["display_layout", "set_display_mode", "displays", "set_primary", "screen_off", "clean_start", "cheat_app"]) {
      assert.ok(manifest.commands.includes(c), c);
    }
    for (const e of ["controls.clean", "controls.cheat"]) {
      assert.ok(manifest.events.emits.includes(e), e);
      assert.ok(manifest.events.listens.includes(e), e);
    }
  });

  test("le mode nettoyage dure 30 s par défaut, 120 s au plus (comme le Rust)", () => {
    const clean = manifest.settings.fields.find((s) => s.key === "cleanSeconds");
    assert.ok(clean);
    assert.equal(clean.default, 30);
    assert.equal(clean.max, 120);
    assert.match(readFileSync("src-tauri/src/platform/clean_lock.rs", "utf8"), /MAX_SECONDS: u32 = 120;/);
    const cheat = manifest.settings.fields.find((s) => s.key === "cheatHold");
    assert.equal(cheat?.default, "leftCtrl");
  });
});
