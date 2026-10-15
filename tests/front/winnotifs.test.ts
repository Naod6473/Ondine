// Tests du module « Notifications de Windows » côté front
// (src/modules/winnotifs/logic.ts). La détection des nouvelles, les filtres
// d'applis et l'extraction du texte sont testés côté Rust :
// src-tauri/src/modules/winnotifs.rs.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ago, HISTORY_MAX, iconName, islandTitle, needsWindowsSettings, parseNotif, parseStatus, remember, statusText, type WinNotif } from "../../src/modules/winnotifs/logic";

const n = (id: number, extra: Partial<WinNotif> = {}): WinNotif => ({ id, app: "Outlook", key: "1a2b3c4d", icon: false, title: `T${id}`, body: "", at: 0, ...extra });

describe("le message winnotifs.new", () => {
  test("bien formé : gardé, nettoyé, daté", () => {
    const got = parseNotif({ id: 7, app: " Teams ", key: "0f0f0f0f", icon: true, title: " Alex ", body: " Salut " }, 1234);
    assert.deepEqual(got, { id: 7, app: "Teams", key: "0f0f0f0f", icon: true, title: "Alex", body: "Salut", at: 1234 });
  });

  test("mal formé : ignoré", () => {
    for (const bad of [null, 3, "x", {}, { id: "1", title: "a" }, { id: -1, title: "a" }, { id: 1.5, title: "a" }, { id: 1, title: "  " }, { id: 1 }]) {
      assert.equal(parseNotif(bad), null, JSON.stringify(bad));
    }
  });

  test("sans appli ni clé valable : « Windows », la cloche", () => {
    const got = parseNotif({ id: 1, title: "Mise à jour", key: "pas une clé", icon: true }, 0)!;
    assert.equal(got.app, "Windows");
    assert.equal(got.key, "");
    assert.equal(got.icon, false);
    assert.equal(iconName(got), "🔔");
    assert.equal(got.body, "");
  });
});

describe("ce que montre l'île", () => {
  test("le nom de l'appli d'abord", () => {
    assert.equal(islandTitle({ app: "Outlook", title: "Réunion à 14 h" }), "Outlook · Réunion à 14 h");
    // Titre identique au nom de l'appli : pas de répétition.
    assert.equal(islandTitle({ app: "Teams", title: "teams" }), "Teams");
  });

  test("le logo de l'appli, ou la cloche", () => {
    assert.equal(iconName({ key: "1a2b3c4d", icon: true }), "app:1a2b3c4d");
    assert.equal(iconName({ key: "1a2b3c4d", icon: false }), "🔔");
  });
});

describe("l'historique (en mémoire)", () => {
  test("le plus récent en tête, sans doublon, 20 au plus", () => {
    let list: WinNotif[] = [];
    for (let i = 1; i <= 25; i++) list = remember(list, n(i));
    assert.equal(list.length, HISTORY_MAX);
    assert.equal(list[0].id, 25);
    assert.equal(list[19].id, 6);
    list = remember(list, n(10, { title: "nouveau" }));
    assert.equal(list.length, HISTORY_MAX);
    assert.equal(list[0].title, "nouveau");
    assert.equal(list.filter((x) => x.id === 10).length, 1);
    assert.deepEqual(remember([], n(1), 0), []);
  });
});

describe("l'état de l'accès", () => {
  test("lu et vérifié", () => {
    assert.deepEqual(parseStatus({ state: "denied", remove: "refused" }), { state: "denied", remove: "refused" });
    assert.deepEqual(parseStatus({ state: "allowed", remove: "???" }), { state: "allowed", remove: "unknown" });
    assert.equal(parseStatus({ state: "peut-être" }), null);
    assert.equal(parseStatus(null), null);
  });

  test("les Paramètres de Windows proposés seulement quand Windows refuse ou ne répond pas", () => {
    assert.equal(needsWindowsSettings({ state: "denied", remove: "unknown" }), true);
    assert.equal(needsWindowsSettings({ state: "error", remove: "unknown" }), true);
    assert.equal(needsWindowsSettings({ state: "allowed", remove: "unknown" }), false);
    assert.equal(needsWindowsSettings({ state: "unavailable", remove: "unknown" }), false);
    assert.equal(needsWindowsSettings(null), false);
  });

  test("chaque phrase est traduite", () => {
    const en = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string> };
    for (const state of ["off", "starting", "allowed", "denied", "unavailable", "error"] as const) {
      const text = statusText({ state, remove: "unknown" });
      assert.ok(en.exact[text], text);
    }
    assert.ok(en.exact[statusText(null)]);
  });
});

describe("depuis quand", () => {
  test("à l'instant, minutes, heures", () => {
    assert.equal(ago(0, 30_000), "à l'instant");
    assert.equal(ago(0, 5 * 60_000), "il y a 5 min");
    assert.equal(ago(0, 2 * 3_600_000 + 1), "il y a 2 h");
    // Horloge qui recule : jamais négatif.
    assert.equal(ago(10_000, 0), "à l'instant");
  });
});

describe("le manifeste", () => {
  const m = JSON.parse(readFileSync("src/modules/winnotifs/manifest.json", "utf8")) as {
    settings: { fields: { key: string; default: unknown }[] };
    permissions: string[];
  };
  const def = (k: string) => m.settings.fields.find((f) => f.key === k)?.default;

  test("prudent par défaut", () => {
    assert.equal(def("removeFromCenter"), false);
    assert.equal(def("history"), true);
    assert.equal(def("ignoreApps"), "");
    assert.equal(def("onlyApps"), "");
    assert.deepEqual(m.permissions, []);
  });

  test("désactivé par défaut, au front comme au Rust", () => {
    const ts = readFileSync("src/core/settings-store.ts", "utf8");
    const rs = readFileSync("src-tauri/src/services/settings.rs", "utf8");
    assert.match(ts, /MODULES_OFF_BY_DEFAULT[^\n]*"winnotifs"/);
    assert.match(rs, /MODULES_OFF_BY_DEFAULT[^\n]*"winnotifs"/);
  });
});
