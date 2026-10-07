// Tests des textes des clés USB (src/modules/controls/usb-text.ts) : le nom
// montré, la notification « branchée », et le message après une éjection.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { driveName, ejectMessage, pluggedTitle, type EjectResult } from "../../src/modules/controls/usb-text";

const key = { root: "E:\\", letter: "E:", label: "KINGSTON", removable: true };
const disk = { root: "G:\\", letter: "G:", label: "", removable: false };
const refused = (extra: Partial<EjectResult>): EjectResult => ({ ...key, ok: false, ...extra });

describe("nom et notification « branchée »", () => {
  test("le nom du volume, sinon « Clé USB » ou « Disque USB »", () => {
    assert.equal(driveName(key), "KINGSTON");
    assert.equal(driveName({ label: "  ", removable: true }), "Clé USB");
    assert.equal(driveName(disk), "Disque USB");
  });

  test("le titre dit clé ou disque, avec la lettre", () => {
    assert.equal(pluggedTitle(key), "Clé USB branchée : KINGSTON (E:)");
    assert.equal(pluggedTitle({ ...key, label: "" }), "Clé USB branchée (E:)");
    assert.equal(pluggedTitle({ ...disk, label: "Sauvegarde" }), "Disque USB branché : Sauvegarde (G:)");
    assert.equal(pluggedTitle(disk), "Disque USB branché (G:)");
  });
});

describe("après une éjection", () => {
  test("réussie : on peut retirer la clé (ou le disque)", () => {
    assert.deepEqual(ejectMessage({ ...key, ok: true }), { ok: true, title: "Vous pouvez retirer la clé E: en toute sécurité." });
    assert.equal(ejectMessage({ ...disk, ok: true }).title, "Vous pouvez retirer le disque G: en toute sécurité.");
  });

  test("refusée : le titre le dit, la notification n'est pas « ok »", () => {
    const m = ejectMessage(refused({ veto: 5 }));
    assert.equal(m.ok, false);
    assert.equal(m.title, "La clé E: n'est pas éjectée");
    assert.equal(ejectMessage({ ...disk, ok: false, veto: 5 }).title, "Le disque G: n'est pas éjecté");
  });

  test("le programme qui bloque, quand Windows l'a dit", () => {
    assert.equal(ejectMessage(refused({ veto: 5, blocker: { name: "WINWORD.EXE", service: false } })).body, "« WINWORD.EXE » utilise encore ce lecteur. Fermez-le puis réessayez.");
    assert.equal(ejectMessage(refused({ veto: 4, blocker: { name: "WSearch", service: true } })).body, "Le service « WSearch » utilise encore ce lecteur. Réessayez dans un moment.");
    // L'Explorateur : on dit de fermer ses fenêtres (pas « Fermez explorer.exe »).
    assert.equal(ejectMessage(refused({ veto: 5, blocker: { name: "Explorer.EXE", service: false } })).body, "L'Explorateur de fichiers utilise encore ce lecteur. Fermez ses fenêtres puis réessayez.");
  });

  test("sans nom : le genre de refus, sinon le message général", () => {
    assert.equal(ejectMessage(refused({ veto: 6 })).body, "Un pilote ou un autre périphérique bloque l'éjection. Réessayez dans un moment.");
    assert.equal(ejectMessage(refused({ veto: 12 })).body, "Windows demande des droits d'administrateur pour éjecter ce lecteur.");
    assert.equal(ejectMessage(refused({ veto: 10 })).body, "Windows ne permet pas d'éjecter ce lecteur.");
    assert.equal(ejectMessage(refused({ veto: 5, blocker: null })).body, "Un programme utilise encore la clé. Fermez-le puis réessayez.");
    assert.equal(ejectMessage(refused({ veto: 5, blocker: { name: " ", service: false } })).body, "Un programme utilise encore la clé. Fermez-le puis réessayez.");
    assert.equal(ejectMessage({ ...disk, ok: false, veto: 3 }).body, "Un programme utilise encore le disque. Fermez-le puis réessayez.");
  });

  test("les autres erreurs", () => {
    assert.equal(ejectMessage(refused({ error: "gone" })).body, "Le lecteur n'est plus visible : il a peut-être déjà été retiré.");
    assert.equal(ejectMessage(refused({ error: "not-removable" })).body, "Windows ne propose pas de retirer ce lecteur en toute sécurité.");
    assert.equal(ejectMessage(refused({ error: "failed", code: 23 })).body, "Windows refuse l'éjection (code 23). Réessayez dans un moment.");
  });
});
