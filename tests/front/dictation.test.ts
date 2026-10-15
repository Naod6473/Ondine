// La dictée partout (1.2.4) : la pilule (src/pill/pill-logic.ts), les pages
// Voix (src/settings/voice/dictation-format.ts) et le manifeste du module.
// La machine à états de la touche, le dictionnaire, les chiffres et les styles
// par appli sont testés côté Rust (modules/dictation_logic.rs, dictation_text.rs,
// dictation_store.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAND_COUNT, IDLE_VIEW, bandsAtRest, callClock, keyLabel, messageContent, micOpen, pillMode, smoothBands } from "../../src/pill/pill-logic";
import {
  addReplacement,
  addWord,
  appShares,
  dailyBars,
  dayLabel,
  formatMinutes,
  formatNumber,
  greetingName,
  groupByDay,
  setAppStyle,
  shortDay,
  statTiles,
  streakText,
  type DictationEntry,
} from "../../src/settings/voice/dictation-format";
import { MODULES_OFF_BY_DEFAULT } from "../../src/core/settings-store";

describe("pilule", () => {
  test("l'écoute passe avant l'appel, l'appel avant le survol", () => {
    assert.equal(pillMode(IDLE_VIEW, false), "rest");
    assert.equal(pillMode(IDLE_VIEW, true), "hover");
    assert.equal(pillMode({ ...IDLE_VIEW, call: true }, true), "call");
    assert.equal(pillMode({ ...IDLE_VIEW, call: true, phase: "listening" }, false), "listening");
    assert.equal(pillMode({ ...IDLE_VIEW, phase: "handsFree" }, true), "handsFree");
    assert.equal(pillMode({ ...IDLE_VIEW, phase: "thinking" }, false), "thinking");
  });

  test("le point rouge se voit tant que le micro est ouvert, et seulement là", () => {
    assert.ok(micOpen({ ...IDLE_VIEW, phase: "listening" }));
    assert.ok(micOpen({ ...IDLE_VIEW, phase: "handsFree" }));
    assert.ok(!micOpen({ ...IDLE_VIEW, phase: "thinking" }));
    assert.ok(!micOpen({ ...IDLE_VIEW, call: true }));
  });

  test("les touches ont leur nom", () => {
    assert.equal(keyLabel("rightCtrl"), "Ctrl droit");
    assert.equal(keyLabel("rightAlt"), "Alt droit");
    assert.equal(keyLabel("ctrlWin"), "Ctrl + Windows");
    assert.equal(keyLabel("???"), "Ctrl droit");
  });

  test("les messages : texte, bouton, fermeture", () => {
    const copied = messageContent({ id: 1, kind: "copied" });
    assert.match(copied.text, /presse-papiers/);
    assert.equal(copied.action, null);
    assert.ok(copied.autoCloseMs > 0);
    const parakeet = messageContent({ id: 2, kind: "parakeet" });
    assert.equal(parakeet.action, "settings");
    assert.equal(parakeet.autoCloseMs, 0);
    // Une erreur du Rust : majuscule et point ; avec un réglage Windows, un bouton.
    const err = messageContent({ id: 3, kind: "error", text: "windows refuse le micro", fix: "mic" });
    assert.equal(err.text, "Windows refuse le micro.");
    assert.equal(err.action, "fix");
    assert.equal(messageContent({ id: 4, kind: "error", text: "" }).text, "La dictée n'a pas marché.");
  });

  test("le chronomètre d'un appel", () => {
    assert.equal(callClock(null, 1000), "0:00");
    assert.equal(callClock(0, 768_000), "12:48");
    assert.equal(callClock(0, 3_723_000), "1:02:03");
    assert.equal(callClock(10_000, 0), "0:00");
  });

  test("les bulles montent vite, retombent doucement, puis se posent", () => {
    const zero = new Array(BAND_COUNT).fill(0);
    const loud = new Array(BAND_COUNT).fill(1);
    const up = smoothBands(zero, loud, 1 / 30);
    const down = smoothBands(loud, zero, 1 / 30);
    assert.equal(up.length, BAND_COUNT);
    assert.ok(up[0] > 1 - down[0], "la montée est plus rapide que la descente");
    let v = zero;
    for (let i = 0; i < 120; i++) v = smoothBands(v, loud, 1 / 30);
    assert.ok(bandsAtRest(v, loud));
    // Des niveaux hors bornes sont ramenés entre 0 et 1.
    assert.ok(smoothBands(zero, [5, -3], 1).every((x) => x >= 0 && x <= 1));
  });
});

describe("pages Voix de la dictée", () => {
  test("nombres et durées à la française", () => {
    assert.equal(formatNumber(1284), "1 284");
    assert.equal(formatNumber(12), "12");
    assert.equal(formatNumber(1_234_567), "1 234 567");
    assert.equal(formatMinutes(12.4), "12 min");
    assert.equal(formatMinutes(72), "1 h 12");
    assert.equal(formatMinutes(180), "3 h");
    assert.equal(streakText(1), "1 jour d'affilée");
    assert.equal(streakText(4), "4 jours d'affilée");
  });

  test("l'historique se range par jour", () => {
    const now = new Date(2026, 9, 15, 18, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 5).getTime();
    const e = (id: number, t: number): DictationEntry => ({ id, at: t, text: "x", app: null, words: 1, seconds: 1, handsFree: false });
    const groups = groupByDay([e(3, at(15, 9)), e(2, at(15, 8)), e(1, at(14, 20)), e(0, at(2, 10))], now);
    assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Aujourd'hui", 2], ["Hier", 1], ["2 oct.", 1]]);
    assert.equal(dayLabel(new Date(2025, 0, 3).getTime(), now), "3 janv. 2025");
    assert.equal(shortDay("2026-10-15"), "15 oct.");
  });

  test("les tuiles et les parts des applis", () => {
    const tiles = statTiles({ words: 4812, seconds: 1700, dictations: 96, handsFree: 7, wordsPerMinute: 168, minutesSaved: 72, apps: [] }, "month");
    assert.deepEqual(tiles.map((t) => t.value), ["4 812", "1 h 12", "168", "96"]);
    assert.equal(tiles[3].sub, "dont 7 mains libres");
    assert.deepEqual(appShares([["Outlook", 300], ["Slack", 100]]), [{ name: "Outlook", pct: 75 }, { name: "Slack", pct: 25 }]);
    assert.deepEqual(appShares([]), []);
    const bars = dailyBars([["a", 0], ["b", 50], ["c", 100]]);
    assert.deepEqual(bars.map((b) => b.h), [0, 0.5, 1]);
  });

  test("le dictionnaire refuse les doublons et les vides", () => {
    assert.deepEqual(addWord(["Supabase"], "  Léonie "), ["Supabase", "Léonie"]);
    assert.equal(addWord(["Supabase"], "supabase"), null);
    assert.equal(addWord([], "   "), null);
    assert.deepEqual(addReplacement([], "cloud code", "Claude Code"), [{ from: "cloud code", to: "Claude Code" }]);
    assert.equal(addReplacement([{ from: "Cloud Code", to: "x" }], "cloud code", "Claude Code"), null);
    assert.equal(addReplacement([], "...", "x"), null);
    assert.equal(addReplacement([], "abc", " "), null);
  });

  test("un style par appli", () => {
    const one = setAppStyle([], "OUTLOOK.exe", "Outlook", "polished");
    assert.deepEqual(one, [{ id: "outlook", name: "Outlook", style: "polished" }]);
    assert.deepEqual(setAppStyle(one, "outlook", "Outlook", "natural"), [{ id: "outlook", name: "Outlook", style: "natural" }]);
    assert.equal(setAppStyle(one, " ", "", "natural"), one);
  });

  test("le prénom de la bande", () => {
    assert.equal(greetingName(" Simon  Victor "), "Simon");
    assert.equal(greetingName(undefined), "");
  });
});

describe("module dictation", () => {
  const manifest = JSON.parse(readFileSync("src/modules/dictation/manifest.json", "utf8"));
  test("coupé par défaut, des deux côtés", () => {
    assert.ok(MODULES_OFF_BY_DEFAULT.includes("dictation"));
    assert.match(readFileSync("src-tauri/src/services/settings.rs", "utf8"), /MODULES_OFF_BY_DEFAULT[^;]*"dictation"/);
  });

  test("des réglages sûrs par défaut", () => {
    const field = (k: string) => manifest.settings.fields.find((f: { key: string }) => f.key === k);
    assert.equal(field("holdKey").default, "rightCtrl");
    assert.equal(field("cleanup").default, false, "rien ne part vers l'IA sans qu'on l'ait choisi");
    assert.equal(field("engine").default, "auto");
    assert.deepEqual(manifest.events.emits, ["dictation.state", "dictation.history"]);
  });

  test("la pilule n'appelle que ses propres commandes", () => {
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    assert.match(lib, /pill::WINDOW_LABEL && !\(module == "dictation"/);
    const caps = JSON.parse(readFileSync("src-tauri/capabilities/pill.json", "utf8"));
    assert.deepEqual(caps.windows, ["pill"]);
    assert.ok(!caps.permissions.includes("allow-settings-patch"));
  });
});
