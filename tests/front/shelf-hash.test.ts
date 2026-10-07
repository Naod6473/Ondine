// Tests de la cible « Empreinte » de l'Étagère (src/modules/shelf/hash.ts) :
// ce que dit la notification du résultat. (Le calcul lui-même est testé côté
// Rust, sur des vecteurs connus : src-tauri/src/modules/shelf_hash.rs.)

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resultNotice } from "../../src/modules/shelf/hash";

const HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("empreinte : la notification", () => {
  test("un fichier, rien à comparer : l'empreinte seule", () => {
    const n = resultNotice({ job: 1, algo: "SHA-256", compared: false, results: [{ name: "setup.iso", hex: HEX, matches: null }] });
    assert.deepEqual(n, { title: "SHA-256 · setup.iso", body: HEX, icon: "#️⃣" });
  });
  test("comparée à l'empreinte copiée : Identique ✓ en vert, Différente ✗ en rouge", () => {
    const same = resultNotice({ job: 1, algo: "MD5", compared: true, results: [{ name: "a.zip", hex: "abc", matches: true }] });
    assert.equal(same.title, "Identique ✓");
    assert.equal(same.tone, "good");
    assert.equal(same.body, "MD5 · a.zip · abc");
    const other = resultNotice({ job: 1, algo: "MD5", compared: true, results: [{ name: "a.zip", hex: "abc", matches: false }] });
    assert.equal(other.title, "Différente ✗");
    assert.equal(other.tone, "bad");
  });
  test("plusieurs fichiers : une ligne courte chacun", () => {
    const n = resultNotice({
      job: 2,
      algo: "SHA-256",
      compared: false,
      results: [
        { name: "a.iso", hex: HEX },
        { name: "b.iso", hex: HEX },
      ],
    });
    assert.equal(n.title, "Empreintes SHA-256 (2 fichiers)");
    assert.equal(n.body, "a.iso : e3b0c44298fc… · b.iso : e3b0c44298fc…");
  });
  test("plusieurs fichiers comparés : tous identiques, ou combien diffèrent", () => {
    const all = resultNotice({
      job: 3,
      algo: "SHA-256",
      compared: true,
      results: [
        { name: "a.iso", hex: HEX, matches: true },
        { name: "b.iso", hex: HEX, matches: true },
      ],
    });
    assert.deepEqual([all.title, all.tone, all.body], ["Identiques ✓ (2 fichiers)", "good", "a.iso ✓ · b.iso ✓"]);
    const some = resultNotice({
      job: 3,
      algo: "SHA-256",
      compared: true,
      results: [
        { name: "a.iso", hex: HEX, matches: true },
        { name: "b.iso", hex: HEX, matches: false },
        { name: "c.iso", error: "ouverture impossible" },
      ],
    });
    assert.equal(some.title, "Différentes ✗ : 2 sur 3");
    assert.equal(some.body, "a.iso ✓ · b.iso ✗ · c.iso : ouverture impossible");
  });
  test("aucun fichier lisible : une erreur", () => {
    const n = resultNotice({ job: 4, algo: "SHA-256", compared: false, results: [{ name: "x.iso", error: "lecture impossible" }] });
    assert.equal(n.title, "Empreinte impossible");
    assert.equal(n.body, "x.iso : lecture impossible");
  });
});
