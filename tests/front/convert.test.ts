// Tests d'Ondine convertit (1.2.5) : les pilules proposées, les textes, le
// plan du geste (src/island/convert-plan.ts) et la mini-île gardée pendant
// le travail (keepOpen, src/island/island-state.ts).

import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  baseName,
  commonKind,
  formatBytes,
  kindOf,
  nextDest,
  parseLast,
  pillsFor,
  progressLine,
  remember,
  summarize,
  workTitle,
  type DoneMessage,
} from "../../src/modules/convert/convert-logic";
import { Dwell, expressionAt, liquidLevel, pillDelay, resultWidth, swallowPose, WORK_PAD, workY } from "../../src/island/convert-plan";
import { IslandStateMachine } from "../../src/island/island-state";

(globalThis as unknown as { window: unknown }).window = globalThis;

const ids = (paths: string[], last = {}) => pillsFor(paths, last)?.pills.map((p) => p.id);

describe("les pilules proposées", () => {
  test("le type d'après l'extension, et celui d'un lot", () => {
    assert.equal(kindOf("C:\\Photos\\vacances.HEIC"), "image");
    assert.equal(kindOf("film.mkv"), "video");
    assert.equal(kindOf("note.flac"), "audio");
    assert.equal(kindOf("Dossier"), "other");
    assert.equal(commonKind(["a.jpg", "b.png"]), "image");
    assert.equal(commonKind(["a.jpg", "b.mp3"]), "other");
    assert.equal(baseName("C:\\Users\\x\\photo.jpg"), "photo.jpg");
  });

  test("une photo : pas son propre format, « Alléger » et un PDF", () => {
    const list = ids(["photo.jpg"])!;
    assert.ok(!list.includes("jpg"));
    assert.ok(list.includes("shrink") && list.includes("pdf"));
    // L'ancienne cible « Compresser » de l'Étagère : la pilule ZIP, en dernier.
    assert.equal(list.at(-1), "zip");
    assert.equal(ids(["photo.heic"])![0], "jpg");
  });

  test("plusieurs fichiers : « Un seul PDF », et toujours un seul ZIP", () => {
    const offer = pillsFor(["a.jpg", "b.jpg"])!;
    assert.equal(offer.pills.find((p) => p.id === "pdf")?.label, "Un seul PDF");
    assert.equal(offer.pills.at(-1)?.label, "Un seul ZIP");
    assert.deepEqual(ids(["a.jpg", "b.mp3"]), ["zip"]);
    assert.deepEqual(ids(["archive.zip"]), ["unzip"]);
  });

  test("le dernier choix passe en premier, s'il est proposé", () => {
    assert.equal(ids(["photo.heic"], { image: "webp" })![0], "webp");
    // Le dernier choix est le format du fichier : ignoré.
    assert.notEqual(ids(["photo.webp"], { image: "webp" })![0], "webp");
  });

  test("rien à proposer : aucun fichier, ou trop", () => {
    assert.equal(pillsFor([]), null);
    assert.equal(pillsFor(Array.from({ length: 101 }, (_, i) => `${i}.jpg`)), null);
  });

  test("derniers choix : relus sans se fier au texte", () => {
    const last = remember({}, "video", "mp3");
    assert.deepEqual(parseLast(JSON.stringify(last)), { video: "mp3" });
    assert.deepEqual(parseLast('{"image":"exe","pdf":"png"}'), { pdf: "png" });
    assert.deepEqual(parseLast("pas du json"), {});
    assert.deepEqual(parseLast(null), {});
  });

  test("la pilule d'option tourne : Conserver → Remplacer → Sur le bureau", () => {
    assert.equal(nextDest("keep"), "replace");
    assert.equal(nextDest("replace"), "desk");
    assert.equal(nextDest("desk"), "keep");
  });
});

describe("les textes", () => {
  test("tailles à la française (et en anglais)", () => {
    assert.equal(formatBytes(512), "512 o");
    assert.equal(formatBytes(820 * 1024), "820 Ko");
    assert.equal(formatBytes(3.4 * 1024 * 1024), "3,4 Mo");
    assert.equal(formatBytes(2 * 1024 * 1024), "2 Mo");
    assert.equal(formatBytes(3.4 * 1024 * 1024, true), "3.4 MB");
  });

  test("titre et avancement", () => {
    assert.equal(workTitle(["C:\\a\\vacances.heic"], "JPG"), "vacances.heic → JPG");
    assert.equal(workTitle(["a.jpg", "b.jpg"], "Un seul PDF"), "2 fichiers → Un seul PDF");
    assert.equal(progressLine(0, 1, 0.42), "Je mâche… 42 %");
    assert.equal(progressLine(2, 12, 0.5), "3/12 · 50 %");
  });

  const ok = (over: Partial<DoneMessage> = {}): DoneMessage => ({
    job: 1,
    ok: true,
    total: 1,
    failed: 0,
    dest: "keep",
    undoId: 7,
    results: [{ name: "photo.heic", out: "C:\\p\\photo.jpg", outName: "photo.jpg", before: 3.4 * 1024 * 1024, after: 820 * 1024, error: null }],
    ...over,
  });

  test("réussite : nom · avant → après, Ouvrir et Annuler", () => {
    const s = summarize(ok(), "keep");
    assert.equal(s.ok, true);
    assert.equal(s.name, "photo.jpg");
    assert.equal(s.detail, "3,4 Mo → 820 Ko");
    assert.equal(s.line, "À côté de l'original");
    assert.equal(s.open, "C:\\p\\photo.jpg");
    assert.equal(s.undoId, 7);
  });

  test("un lot avec un échec : le compte et la raison, le reste continue", () => {
    const d = ok({
      total: 2,
      failed: 1,
      results: [
        { name: "a.heic", out: "C:\\a.jpg", outName: "a.jpg", before: 2048, after: 1024, error: null },
        { name: "b.heic", out: null, outName: null, before: 2048, after: 0, error: "cette image semble abîmée" },
      ],
    });
    const s = summarize(d, "keep");
    assert.equal(s.ok, true);
    assert.equal(s.name, "a.jpg");
    assert.equal(s.detail, "2 Ko → 1 Ko · 1 échec : Cette image semble abîmée");
  });

  test("échec : l'original n'a pas bougé, une ligne dit pourquoi", () => {
    const s = summarize(ok({ ok: false, failed: 1, undoId: null, results: [{ name: "x.pdf", out: null, outName: null, before: 10, after: 0, error: "ce PDF est protégé par un mot de passe" }] }), "keep");
    assert.equal(s.ok, false);
    assert.equal(s.name, "x.pdf");
    assert.equal(s.detail, "Ce PDF est protégé par un mot de passe");
    assert.equal(s.line, "L'original n'a pas bougé");
    assert.equal(s.undoId, null);
  });

  test("arrêtée : « Conversion arrêtée »", () => {
    const s = summarize(ok({ ok: false, cancelled: true, results: [] }), "keep");
    assert.equal(s.detail, "Conversion arrêtée");
  });

  test("les textes passent par la traduction donnée", () => {
    const en: Record<string, string> = { "À côté de l'original": "Next to the original", "1 échec": "1 failure", "Cette image semble abîmée": "This image seems damaged" };
    const tr = (fr: string) => en[fr] ?? fr;
    const d = ok({
      results: [
        { name: "a.heic", out: "C:\\a.jpg", outName: "a.jpg", before: 2048, after: 1024, error: null },
        { name: "b.heic", out: null, outName: null, before: 2048, after: 0, error: "cette image semble abîmée" },
      ],
    });
    const s = summarize(d, "keep", tr, true);
    assert.equal(s.detail, "2 KB → 1 KB · 1 failure: This image seems damaged");
    assert.equal(s.line, "Next to the original");
  });
});

describe("le plan du geste", () => {
  test("les pilules du dépôt arrivent une à une, sans attendre trop longtemps", () => {
    assert.equal(pillDelay(0), 0);
    assert.ok(pillDelay(1) > 0);
    assert.equal(pillDelay(40), pillDelay(14), "plafonné pour une longue liste");
    assert.ok(pillDelay(14) < 0.5);
  });

  test("la pilule de travail est dans la mini-île, côté centre de l'écran", () => {
    const rect = { top: 0, bottom: 92 };
    assert.equal(workY(rect, 1), 92 - WORK_PAD / 2);
    assert.equal(workY({ top: 500, bottom: 592 }, -1), 500 + WORK_PAD / 2, "île en bas : la partie haute");
  });

  test("la mini-île s'élargit pour un long résultat, sans dépasser la fenêtre", () => {
    assert.equal(resultWidth(200, 400, 720), 400);
    assert.equal(resultWidth(420, 400, 720), 448);
    assert.equal(resultWidth(900, 400, 720), 676);
  });

  test("la pilule d'option tourne après une demi-seconde, une fois par survol", () => {
    const d = new Dwell();
    assert.equal(d.update(true, 0), false);
    assert.ok(Math.abs(d.progress(250) - 0.5) < 1e-9);
    assert.equal(d.update(true, 499), false);
    assert.equal(d.update(true, 500), true);
    assert.equal(d.update(true, 2000), false, "une seule fois");
    assert.equal(d.update(false, 2100), false);
    d.update(true, 3000);
    assert.equal(d.update(true, 3500), true, "à nouveau après l'avoir quittée");
  });

  test("l'icône avalée rétrécit vers la bouche ; en mode Calme, un fondu sur place", () => {
    const end = swallowPose(1, { x: 0, y: 200 }, { x: 100, y: 20 }, false);
    assert.equal(end.x, 100);
    assert.ok(end.s < 0.2 && end.o === 0);
    const calm = swallowPose(0.5, { x: 0, y: 200 }, { x: 100, y: 20 }, true);
    assert.equal(calm.x, 0);
    assert.equal(calm.s, 1);
  });

  test("les expressions d'Ondine selon l'étape", () => {
    assert.equal(expressionAt("open", 0, false)?.anim, "surpris");
    assert.equal(expressionAt("chew", 0.2, false)?.anim, "mange-vite");
    assert.equal(expressionAt("chew", 3, false)?.anim, "concentree");
    assert.equal(expressionAt("spit", 0.1, false)?.anim, "sursaut");
    assert.equal(expressionAt("spit", 1, false)?.anim, "fiere");
    assert.equal(expressionAt("spit", 1, true)?.anim, "celebrate");
    assert.equal(expressionAt("fail", 0.2, false)?.anim, "oups");
  });

  test("le liquide monte avec la progression, sans déborder", () => {
    assert.ok(liquidLevel(0) > 0);
    assert.ok(liquidLevel(1) < 1);
    assert.ok(liquidLevel(0.5) < liquidLevel(0.9));
    assert.equal(liquidLevel(5), liquidLevel(1));
  });
});

describe("la mini-île gardée pendant la conversion", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  test("lâché sur une pilule : la mini-île reste tant qu'Ondine travaille", () => {
    const fsm = new IslandStateMachine({ peekToCompactMs: 350, peekToHiddenMs: 300, collapseMs: 1500 });
    fsm.dragEnter();
    assert.equal(fsm.state, "drop");
    fsm.keepOpen("convert", true);
    fsm.dropped();
    mock.timers.tick(10_000);
    assert.equal(fsm.state, "compact");
    assert.ok(fsm.wideReasons().includes("convert"));
    fsm.keepOpen("convert", false);
    mock.timers.tick(10_000);
    assert.notEqual(fsm.state, "compact");
  });
});
