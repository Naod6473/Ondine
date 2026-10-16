// Tests de « Qu'est-ce qui remplit mon disque ? » (src/modules/system/disk-logic.ts) :
// tailles, carte proportionnelle, morceaux de la vue, lignes du nettoyage.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { blocksOf, bytesText, checkedBytes, cleanLines, cleanResult, elapsedText, rootLabel, shareText, statusParts, treemap, type DiskEstimate, type DiskView } from "../../src/modules/system/disk-logic";

const GB = 1024 ** 3;

function view(over: Partial<DiskView> = {}): DiskView {
  return {
    job: 1,
    done: false,
    cancelled: false,
    files: 1200,
    dirs: 30,
    skipped: 0,
    excluded: 0,
    folded: false,
    elapsedMs: 0,
    total: 100 * GB,
    node: { id: 0, name: "C:\\", path: "C:\\", bytes: 100 * GB, done: false },
    crumbs: [{ id: 0, name: "C:\\" }],
    children: [],
    here: 0,
    big: [],
    rest: 0,
    ...over,
  };
}

describe("tailles et textes", () => {
  test("bytesText : une décimale sous 10, unités françaises", () => {
    assert.equal(bytesText(0), "0 octets");
    assert.equal(bytesText(512), "512 octets");
    assert.equal(bytesText(1536), "1,5 Ko");
    assert.equal(bytesText(12 * GB), "12 Go");
    assert.equal(bytesText(3.25 * GB), "3,3 Go");
    assert.equal(bytesText(2048 * GB), "2 To");
    assert.equal(bytesText(Number.NaN), "0 octets");
  });

  test("durée, part, nom du disque", () => {
    assert.equal(elapsedText(12_400), "12 s");
    assert.equal(elapsedText(125_000), "2 min 5 s");
    assert.equal(elapsedText(120_000), "2 min");
    assert.equal(shareText(1, 1000), "< 1 %");
    assert.equal(shareText(250, 1000), "25 %");
    assert.equal(shareText(5, 0), "0 %");
    assert.equal(rootLabel("C:\\"), "Disque C:");
    assert.equal(rootLabel("d:"), "Disque D:");
    assert.equal(rootLabel("C:\\Users\\simon"), "simon");
  });

  test("ligne d'état : en cours, fini, arrêté, dossiers ignorés et exclus", () => {
    assert.deepEqual(statusParts(view()), ["Analyse en cours…", `${(1200).toLocaleString("fr-FR")} fichiers`]);
    const done = statusParts(view({ done: true, elapsedMs: 9000, skipped: 3, excluded: 1 }));
    assert.equal(done[0], "Analysé en 9 s");
    assert.ok(done.includes("3 dossiers fermés ignorés"));
    assert.ok(done.includes("1 dossiers exclus non comptés"));
    assert.equal(statusParts(view({ done: true, cancelled: true }))[0], "Analyse arrêtée");
  });
});

describe("morceaux de la vue", () => {
  test("du plus gros au plus petit, fichiers du dossier et reste", () => {
    const v = view({
      children: [
        { id: 1, name: "Windows", bytes: 30 * GB, done: true, more: true },
        { id: 2, name: "Users", bytes: 50 * GB, done: false, more: true },
        { id: 3, name: "Vide", bytes: 0, done: true, more: false },
      ],
      here: 12 * GB,
      rest: 8 * GB,
    });
    const b = blocksOf(v);
    assert.deepEqual(
      b.map((x) => x.key),
      ["d2", "d1", "files", "rest"],
    );
    assert.equal(b[0].id, 2);
    assert.equal(b[2].label, "Fichiers de ce dossier");
  });

  test("au-delà de max, les petits rejoignent « Autres »", () => {
    const children = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `d${i}`, bytes: (20 - i) * GB, done: true, more: false }));
    const b = blocksOf(view({ children, rest: GB }), 5);
    assert.equal(b.length, 6);
    const rest = b[b.length - 1];
    assert.equal(rest.kind, "rest");
    // 1 Go de reste + les dossiers 6 à 20 (15 + 14 + … + 1 Go).
    assert.equal(rest.bytes, GB + (15 * 16 * GB) / 2);
  });

  test("un dossier encore en lecture, vide pour l'instant, reste montré", () => {
    const b = blocksOf(view({ children: [{ id: 4, name: "Lecture", bytes: 0, done: false, more: false }] }));
    assert.equal(b.length, 1);
  });
});

describe("carte proportionnelle", () => {
  test("les aires suivent les tailles et la carte est couverte", () => {
    const items = [
      { key: "a", bytes: 60 },
      { key: "b", bytes: 25 },
      { key: "c", bytes: 10 },
      { key: "d", bytes: 5 },
      { key: "zero", bytes: 0 },
    ];
    const tiles = treemap(items, 2);
    assert.equal(tiles.length, 4);
    const area = (k: string) => {
      const t = tiles.find((x) => x.key === k)!;
      return t.w * t.h;
    };
    assert.ok(Math.abs(area("a") - 0.6) < 1e-9);
    assert.ok(Math.abs(area("d") - 0.05) < 1e-9);
    const sum = tiles.reduce((s, t) => s + t.w * t.h, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    for (const t of tiles) {
      assert.ok(t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= 1 + 1e-9 && t.y + t.h <= 1 + 1e-9, `${t.key} déborde`);
    }
  });

  test("rien à dessiner : aucune tuile", () => {
    assert.deepEqual(treemap([], 2), []);
    assert.deepEqual(treemap([{ key: "x", bytes: 0 }]), []);
  });
});

describe("nettoyage", () => {
  const est: DiskEstimate = {
    trash: { bytes: 3 * GB, items: 40 },
    temp: { bytes: GB, files: 900, partial: false },
    thumbs: { bytes: 0, files: 0 },
    downloads: {
      days: 90,
      bytes: 5 * GB,
      items: [
        { path: "C:\\Users\\s\\Downloads\\a.iso", name: "a.iso", bytes: 4 * GB, days: 200, dir: false },
        { path: "C:\\Users\\s\\Downloads\\b.zip", name: "b.zip", bytes: GB, days: 120, dir: false },
      ],
    },
  };

  test("les lignes : téléchargements d'abord, Corbeille en dernier, vides grisées", () => {
    const lines = cleanLines(est);
    assert.deepEqual(
      lines.map((l) => l.kind),
      ["downloads", "temp", "thumbs", "trash"],
    );
    assert.equal(lines[0].label, "Vieux téléchargements (plus de 90 jours)");
    assert.equal(lines.find((l) => l.kind === "thumbs")!.empty, true);
    assert.equal(lines.find((l) => l.kind === "trash")!.confirm, "Vider la Corbeille ? C'est définitif.");
    // Chaque ligne qui supprime demande une confirmation (les téléchargements ont la leur, avec la liste).
    for (const l of lines) if (l.kind !== "downloads") assert.ok(l.confirm.endsWith(".") && l.confirm.includes("?"));
  });

  test("hors de Windows : pas de Corbeille ni de miniatures", () => {
    const lines = cleanLines({ ...est, trash: null, thumbs: null });
    assert.deepEqual(
      lines.map((l) => l.kind),
      ["downloads", "temp"],
    );
  });

  test("le total des téléchargements cochés", () => {
    const items = est.downloads.items;
    assert.equal(checkedBytes(items, new Set([items[1].path])), GB);
    assert.equal(checkedBytes(items, new Set()), 0);
  });

  test("le résultat en une phrase", () => {
    assert.deepEqual(cleanResult("temp", { freed: 2 * GB, files: 10, skipped: 3 }), { title: "2 Go libérés", body: "3 fichiers en cours d'utilisation laissés." });
    assert.equal(cleanResult("trash", { freed: GB, files: 0, skipped: 0 }).body, "");
    assert.equal(cleanResult("downloads", { freed: 0, files: 2, skipped: 0, trashed: 5 * GB }).title, "2 éléments envoyés à la Corbeille");
  });
});
