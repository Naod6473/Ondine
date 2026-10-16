// Tests du dépôt unifié (1.2.4) : la liste par défaut des pilules, la fusion
// avec les cibles des modules, la migration des anciens interrupteurs, l'ordre,
// et les phrases (src/island/drop-pills-logic.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  arrange,
  arrangeFormats,
  bareLabel,
  defaultLayout,
  effectiveLayout,
  formatSay,
  headerFor,
  isShown,
  keyOf,
  KNOWN,
  legacyHidden,
  moveKey,
  normalize,
  parseLayout,
  rowIsDefault,
  rowOf,
  serialize,
  setShown,
  targetSay,
  withExtras,
} from "../../src/island/drop-pills-logic";

describe("la liste par défaut", () => {
  test("trois lignes, dans l'ordre de la maquette", () => {
    const d = defaultLayout();
    assert.deepEqual(d.order.ranger, ["shelf-add", "shelf-copy", "shelf-move", "shelf-fav", "shelf-trash"]);
    assert.deepEqual(d.order.outils, ["askclaude-drop", "shelf-rename", "shelf-path", "shelf-hash", "terminal-here", "team"]);
    assert.equal(d.order.convert[0], "jpg");
    assert.ok(d.order.convert.includes("zip") && d.order.convert.includes("shelf-images"));
    assert.deepEqual(d.hidden, []);
  });

  test("sans doublon : « Images… » et « Compresser » ne sont plus des cibles à part", () => {
    assert.equal(keyOf("shelf-zip"), "zip", "Compresser = la pilule ZIP");
    assert.equal(rowOf("zip"), "convert");
    assert.equal(KNOWN["shelf-images"].label, "Redimensionner…");
    assert.equal(rowOf("shelf-images"), "convert");
    const all = Object.values(defaultLayout().order).flat();
    assert.equal(new Set(all).size, all.length);
    assert.ok(!all.includes("shelf-zip"));
  });

  test("les favoris et les collègues comptent pour leur groupe ; une cible inconnue va dans Outils", () => {
    assert.equal(keyOf("shelf-fav-3"), "shelf-fav");
    assert.equal(keyOf("team-ab12"), "team");
    assert.equal(keyOf("team-chat-ab12"), "team");
    assert.equal(rowOf("autre-module-cible"), "outils");
  });

  test("chaque pilule a une icône au trait (style épuré)", () => {
    // Le nom du .svg de chaque pictogramme, lu dans icon.ts (import.meta.glob : pas importable ici).
    const src = readFileSync("src/island/icon.ts", "utf8");
    const map: Record<string, string> = {};
    for (const m of src.matchAll(/"([^"]+)":\s*"([a-z-]+)"/g)) map[m[1].replace(/️/g, "")] = m[2];
    for (const [key, info] of Object.entries(KNOWN)) {
      if (!info.icon) continue; // un format : le nom seul, comme la maquette
      const name = map[info.icon.replace(/️/g, "")];
      assert.ok(name, `${key} : ${info.icon} sans icône au trait`);
      assert.ok(existsSync(`src/assets/icons-line/${name}.svg`), `${key} : icons-line/${name}.svg manquant`);
    }
  });
});

describe("migration et relecture", () => {
  test("une cible masquée avant reste masquée", () => {
    assert.deepEqual(legacyHidden({}), []);
    assert.deepEqual(legacyHidden({ showTrash: true, showHash: undefined }), []);
    assert.deepEqual(legacyHidden({ showTrash: false, showCompress: false, showTools: false, showHash: false, terminalDrop: false, askDrop: false }).sort(), [
      "askclaude-drop", "shelf-hash", "shelf-images", "shelf-rename", "shelf-trash", "terminal-here", "zip",
    ]);
    const l = effectiveLayout(undefined, { showTrash: false });
    assert.ok(!isShown(l, "shelf-trash"));
    assert.ok(isShown(l, "shelf-add"));
  });

  test("une disposition enregistrée l'emporte sur les anciens réglages", () => {
    const saved = serialize(setShown(defaultLayout(), "ico", false));
    const l = effectiveLayout(saved, { showTrash: false });
    assert.ok(isShown(l, "shelf-trash"));
    assert.ok(!isShown(l, "ico"));
  });

  test("relue sans se fier au texte", () => {
    assert.equal(parseLayout(null), null);
    assert.equal(parseLayout({ v: 2, order: {} }), null);
    assert.equal(parseLayout("texte"), null);
    const l = parseLayout({ v: 1, order: { ranger: ["shelf-trash", 3, "<script>", "shelf-add", "shelf-trash"] }, hidden: ["ico", 42] })!;
    assert.equal(l.order.ranger[0], "shelf-trash");
    assert.equal(l.order.ranger.filter((k) => k === "shelf-trash").length, 1);
    assert.ok(!l.order.ranger.includes("<script>"));
    assert.deepEqual(l.hidden, ["ico"]);
    // Les clés absentes reviennent à leur place par défaut.
    assert.deepEqual(new Set(l.order.ranger), new Set(defaultLayout().order.ranger));
  });

  test("une clé dans la mauvaise ligne retourne dans la sienne ; une pilule nouvelle se range après sa voisine", () => {
    const l = normalize({ order: { convert: ["shelf-add"], ranger: ["shelf-trash", "shelf-copy"], outils: [] }, hidden: [] });
    assert.ok(!l.order.convert.includes("shelf-add"));
    assert.equal(l.order.ranger.indexOf("shelf-move"), l.order.ranger.indexOf("shelf-copy") + 1);
    assert.deepEqual(l.order.outils, defaultLayout().order.outils);
  });

  test("les cibles inconnues des modules présents s'ajoutent à Outils (une fois)", () => {
    const l = withExtras(defaultLayout(), ["nouvelle-cible", "nouvelle-cible", "shelf-add"]);
    assert.equal(l.order.outils.at(-1), "nouvelle-cible");
    assert.equal(l.order.outils.filter((k) => k === "nouvelle-cible").length, 1);
    assert.equal(l.order.ranger.length, defaultLayout().order.ranger.length);
  });
});

describe("l'ordre", () => {
  test("monter, descendre, sans sortir de la ligne", () => {
    let l = moveKey(defaultLayout(), "shelf-trash", -1);
    assert.deepEqual(l.order.ranger.slice(-2), ["shelf-trash", "shelf-fav"]);
    l = moveKey(l, "shelf-add", -1);
    assert.equal(l.order.ranger[0], "shelf-add", "déjà en tête");
    l = moveKey(l, "team", 5);
    assert.equal(l.order.outils.at(-1), "team");
    assert.equal(moveKey(l, "inconnue", 1), l);
  });

  test("ranger des cibles : masquées parties, ordre choisi, favoris ensemble", () => {
    let l = moveKey(defaultLayout(), "shelf-trash", -2);
    l = setShown(l, "shelf-copy", false);
    const items = ["shelf-add", "shelf-copy", "shelf-move", "shelf-fav-0", "shelf-fav-1", "shelf-trash", "inconnue"];
    assert.deepEqual(arrange(l, "ranger", items, keyOf), ["shelf-add", "shelf-trash", "shelf-move", "shelf-fav-0", "shelf-fav-1", "inconnue"]);
  });

  test("les formats : l'ordre du type tant que la ligne n'est pas réordonnée, le dernier choix en premier", () => {
    const d = defaultLayout();
    assert.ok(rowIsDefault(d, "convert"));
    // Un PDF propose PNG puis JPG (convert-logic.ts) : l'ordre du type est gardé.
    assert.deepEqual(arrangeFormats(d, ["png", "jpg", "zip"]), ["png", "jpg", "zip"]);
    assert.deepEqual(arrangeFormats(d, ["png", "jpg", "zip"], "zip"), ["zip", "png", "jpg"]);
    const moved = setShown(moveKey(d, "png", -1), "zip", false);
    assert.ok(!rowIsDefault(moved, "convert"));
    assert.deepEqual(arrangeFormats(moved, ["jpg", "png", "zip"]), ["png", "jpg"]);
  });
});

describe("les phrases", () => {
  test("ce qui va se passer sur la pilule survolée", () => {
    assert.equal(formatSay("jpg", "keep", false), "Convertir en JPG, à côté de l'original");
    assert.equal(formatSay("pdf", "keep", true), "Faire un seul PDF, à côté des originaux");
    assert.equal(formatSay("png", "replace", false), "Convertir en PNG, à la place de l'original (Corbeille, avec Annuler)");
    assert.equal(formatSay("shrink", "desk", false), "Alléger, sur le bureau");
    assert.equal(targetSay("shelf-trash", "Corbeille", false), "Envoyer à la Corbeille, avec Annuler");
    assert.equal(targetSay("shelf-fav-0", "Documents", false), "Copier dans Documents");
    assert.equal(targetSay("shelf-fav-0", "Documents", false, true), "Déplacer dans Documents");
    assert.equal(targetSay("team-ab", "Alex", false), "Proposer à Alex");
    assert.equal(targetSay("module-x", "Faire autre chose", false), "Faire autre chose");
  });

  test("le libellé d'une cible, sans son pictogramme", () => {
    assert.equal(bareLabel("💬 Alex"), "Alex");
    assert.equal(bareLabel("Copier vers…"), "Copier vers…");
    assert.equal(bareLabel("💬"), "💬");
  });

  test("l'en-tête : un fichier, un dossier, plusieurs fichiers", () => {
    const size = (n: number) => `${Math.round(n / 1e6)} Mo`;
    assert.deepEqual(headerFor(["vacances.heic"], "image", null, size), { title: "vacances.heic", meta: "Image", folder: false });
    assert.deepEqual(headerFor(["vacances.heic"], "image", [{ dir: false, size: 3_000_000, count: null }], size), { title: "vacances.heic", meta: "Image · 3 Mo", folder: false });
    assert.deepEqual(headerFor(["Projet"], "other", null, size).folder, true, "sans extension : sans doute un dossier");
    assert.equal(headerFor(["Projet"], "other", [{ dir: true, size: 0, count: 214 }], size).meta, "Dossier · 214 éléments");
    assert.equal(headerFor(["v1.2"], "other", [{ dir: false, size: 2_000_000, count: null }], size).folder, false, "le Rust a le dernier mot");
    assert.deepEqual(headerFor(["a.jpg", "b.jpg"], "image", [{ dir: false, size: 1_000_000, count: null }, { dir: false, size: 2_000_000, count: null }], size), { title: "2 fichiers", meta: "Images · 3 Mo", folder: false });
    assert.equal(headerFor(["a.jpg", "Dossier"], "other", [{ dir: false, size: 1, count: null }, { dir: true, size: 0, count: 3 }], size).title, "2 éléments");
  });
});
