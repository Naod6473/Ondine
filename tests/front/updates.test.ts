// Tests du module Mises à jour des logiciels (src/modules/updates/logic.ts) :
// les phrases de l'onglet, l'état de chaque ligne, la file, la notification
// de fin, la pastille. La lecture de la sortie de winget est testée côté Rust
// (src-tauri/src/modules/updates_parse.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agoText,
  batchText,
  busy,
  countText,
  EMPTY_STATUS,
  finished,
  finishedNote,
  OUTCOME_TEXT,
  outcomeLine,
  rowState,
  succeeded,
  versionText,
  visible,
  type Outcome,
  type Pkg,
  type Status,
} from "../../src/modules/updates/logic";
import { MODULE_CATEGORIES } from "../../src/settings/layout";

const pkg = (id: string, extra: Partial<Pkg> = {}): Pkg => ({ name: id.split(".")[1] ?? id, id, version: "1.0", available: "2.0", source: "winget", truncated: false, explicit: false, ignored: false, ...extra });
const status = (extra: Partial<Status> = {}): Status => ({ ...EMPTY_STATUS, ...extra });

describe("mises à jour des logiciels : textes", () => {
  test("il y a combien de temps", () => {
    const now = 1_000_000;
    assert.equal(agoText(null, now), "Jamais vérifié");
    assert.equal(agoText(now - 10, now), "Vérifié à l'instant");
    assert.equal(agoText(now - 5 * 60, now), "Vérifié il y a 5 min");
    assert.equal(agoText(now - 3 * 3600, now), "Vérifié il y a 3 h");
    assert.equal(agoText(now - 86400, now), "Vérifié hier");
    assert.equal(agoText(now - 4 * 86400, now), "Vérifié il y a 4 jours");
    // Une horloge qui recule : jamais « il y a -2 min ».
    assert.equal(agoText(now + 120, now), "Vérifié à l'instant");
  });

  test("le nombre de mises à jour", () => {
    assert.equal(countText(0), "Tout est à jour");
    assert.equal(countText(1), "1 mise à jour");
    assert.equal(countText(7), "7 mises à jour");
    assert.equal(versionText(pkg("Git.Git", { version: "< 2.40", available: "2.46.0" })), "< 2.40 → 2.46.0");
  });

  test("chaque résultat a sa phrase, courte, et sa traduction", () => {
    const en = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };
    for (const [kind, text] of Object.entries(OUTCOME_TEXT)) {
      assert.ok(text.length <= 60, `${kind} : trop long`);
      assert.ok(en.exact[text], `${kind} : « ${text} » sans traduction anglaise`);
    }
    assert.equal(outcomeLine({ outcome: "failed", code: "0x8A150001" }), "Échec (0x8A150001)");
    assert.equal(outcomeLine({ outcome: "inUse", code: "0x8A150101" }), OUTCOME_TEXT.inUse);
    assert.equal(outcomeLine({ outcome: "nouveau" as Outcome, code: "" }), OUTCOME_TEXT.failed);
    assert.ok(en.patterns.some(([rx]) => new RegExp(rx).test("Échec (0x8A150001)")));
  });

  test("réussite : faite, redémarrage, déjà à jour ; le reste non", () => {
    assert.ok(succeeded("ok") && succeeded("reboot") && succeeded("upToDate"));
    for (const o of ["admin", "cancelled", "inUse", "failed", "timeout"] as Outcome[]) assert.ok(!succeeded(o), o);
  });
});

describe("mises à jour des logiciels : la liste et la file", () => {
  test("les applis ignorées ne sont pas proposées", () => {
    const st = status({ packages: [pkg("Git.Git"), pkg("Mozilla.Firefox", { ignored: true })] });
    assert.deepEqual(visible(st).map((p) => p.id), ["Git.Git"]);
  });

  test("l'état d'une ligne : en cours, en attente, terminée, rien (sans tenir compte des majuscules)", () => {
    const st = status({
      packages: [pkg("Git.Git"), pkg("A.B"), pkg("C.D"), pkg("E.F")],
      current: { id: "git.git", name: "Git", version: "1", available: "2", source: "winget", phase: "download", pct: 40, startedAt: 0 },
      queue: [{ id: "A.B", name: "B", version: "1", available: "2", source: "winget" }, { id: "C.D", name: "D", version: "1", available: "2", source: "winget" }],
      done: [{ id: "E.F", name: "F", available: "2", outcome: "admin", code: "0x8A150019", at: 1 }],
    });
    assert.deepEqual(rowState(st, "Git.Git"), { kind: "running", phase: "download", pct: 40 });
    assert.deepEqual(rowState(st, "C.D"), { kind: "queued", position: 2 });
    assert.deepEqual(rowState(st, "E.F"), { kind: "done", outcome: "admin", code: "0x8A150019" });
    assert.deepEqual(rowState(st, "X.Y"), { kind: "idle" });
    assert.ok(busy(st));
    assert.ok(!busy(status()));
  });

  test("« 2 sur 5 » seulement pendant une série de plusieurs", () => {
    const run = { id: "A.B", name: "B", version: "1", available: "2", source: "", phase: "install" as const, pct: null, startedAt: 0 };
    assert.equal(batchText(status({ current: run, batch: { total: 5, done: 1 } })), "2 sur 5");
    assert.equal(batchText(status({ current: run, batch: { total: 1, done: 0 } })), "");
    assert.equal(batchText(status({ batch: { total: 5, done: 5 } })), "");
    // Jamais « 6 sur 5 » (une appli ajoutée entre-temps recompte le total).
    assert.equal(batchText(status({ current: run, batch: { total: 5, done: 5 } })), "5 sur 5");
  });

  test("les terminées : celles sorties de la liste, les plus récentes d'abord", () => {
    const st = status({
      packages: [pkg("Git.Git")],
      done: [
        { id: "Git.Git", name: "Git", available: "2", outcome: "inUse", code: "x", at: 3 },
        { id: "A.B", name: "B", available: "2", outcome: "ok", code: "", at: 1 },
        { id: "C.D", name: "D", available: "2", outcome: "reboot", code: "", at: 2 },
      ],
    });
    assert.deepEqual(finished(st).map((d) => d.id), ["C.D", "A.B"]);
  });
});

describe("mises à jour des logiciels : notification et rangement", () => {
  test("la notification de fin de série", () => {
    assert.equal(finishedNote({ ok: 0, failed: 0, reboot: 0 }), null);
    assert.deepEqual(finishedNote({ ok: 1, failed: 0, reboot: 0 }), { title: "1 appli mise à jour", body: undefined, tone: "good" });
    assert.equal(finishedNote({ ok: 3, failed: 0, reboot: 0 })?.title, "3 applis mises à jour");
    assert.equal(finishedNote({ ok: 0, failed: 1, reboot: 0 })?.title, "La mise à jour a échoué");
    assert.equal(finishedNote({ ok: 0, failed: 2, reboot: 0 })?.tone, "bad");
    const mixed = finishedNote({ ok: 2, failed: 1, reboot: 1 });
    assert.equal(mixed?.title, "2 à jour, 1 en échec");
    assert.equal(mixed?.body, "Une appli demande de redémarrer le PC.");
    assert.equal(mixed?.tone, undefined);
    assert.equal(finishedNote({ ok: 2, failed: 0, reboot: 2 })?.body, "2 applis demandent de redémarrer le PC.");
  });

  test("rangé dans Outils IT, coupé par défaut pour la vérification automatique", () => {
    assert.ok(MODULE_CATEGORIES.find((c) => c.id === "it")?.modules.includes("updates"));
    const man = JSON.parse(readFileSync("src/modules/updates/manifest.json", "utf8")) as { settings: { fields: { key: string; default: unknown }[] } };
    assert.equal(man.settings.fields.find((f) => f.key === "checkEvery")?.default, "off");
  });
});
