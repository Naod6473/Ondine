// Parler à Ondine, 1.2.4 : le raccourci personnalisé (src/core/hotkey.ts, champ
// « hotkey » des manifestes), le choix du micro et le mot d'appel
// (src/settings/mic-logic.ts), le point rouge du mot d'appel sur l'île
// (src/island/nano-rules.ts, mouth-geom.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coerceHotkey, hotkeyFromEvent, hotkeyProblem, normalizeHotkey, prettyHotkey, type KeyPress } from "../../src/core/hotkey";
import { coerce } from "../../src/core/settings-store";
import type { ModuleManifest, SettingField } from "../../src/core/module-types";
import { micEngineWarning, micOptions, micTestText, sentence, wakeText, type Mic } from "../../src/settings/mic-logic";
import { dotStatus, NANO_START, nanoStep } from "../../src/island/nano-rules";
import { nanoDots } from "../../src/island/mouth-geom";

const press = (p: Partial<KeyPress>): KeyPress => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: "", keyCode: 0, ...p });

describe("raccourci personnalisé", () => {
  test("écriture canonique, lisible par le greffon de raccourcis", () => {
    assert.equal(normalizeHotkey("alt+ctrl+k"), "Ctrl+Alt+K");
    assert.equal(normalizeHotkey("Control+Shift+KeyK"), "Ctrl+Shift+K");
    assert.equal(normalizeHotkey("Win+Digit5"), "Super+5");
    assert.equal(normalizeHotkey("ctrl+shift+f9"), "Ctrl+Shift+F9");
    assert.equal(normalizeHotkey("Ctrl+Alt+Esc"), "Ctrl+Alt+Escape");
    assert.equal(normalizeHotkey("Ctrl+K+Alt"), null);
    assert.equal(normalizeHotkey("Ctrl+"), null);
    assert.equal(normalizeHotkey("Ctrl+Alt"), null);
    assert.equal(normalizeHotkey("Ctrl+Bidule"), null);
    assert.equal(normalizeHotkey(""), null);
  });

  test("les règles (mêmes que check_hotkey côté Rust)", () => {
    for (const ok of ["Ctrl+Alt+K", "Ctrl+Shift+F9", "F9", "F24", "Shift+F2", "Alt+Shift+M", "Super+Alt+Space", "Ctrl+Alt+Numpad1", "Ctrl+Shift+V", "Ctrl+Alt+V", "Alt+Shift+V", "Ctrl+Alt+Enter", "Ctrl+Alt+G", "Alt+Shift+G"]) {
      assert.equal(hotkeyProblem(ok), null, ok);
    }
    for (const bad of ["K", "Space", "Shift+K", "F12", "Alt+F4", "Ctrl+Alt+Delete", "Super+L", "Super+D", "Alt+Tab", "Ctrl+Shift+Escape", "Ctrl+C", "Ctrl+V", "Super+1", "n'importe quoi"]) {
      assert.ok(hotkeyProblem(bad), bad);
    }
  });

  test("une touche pressée devient un raccourci (lettre par la touche virtuelle de Windows)", () => {
    // AZERTY : la touche A est à la place du Q d'un clavier QWERTY.
    assert.deepEqual(hotkeyFromEvent(press({ ctrlKey: true, altKey: true, code: "KeyQ", keyCode: 65 })), { value: "Ctrl+Alt+A" });
    assert.deepEqual(hotkeyFromEvent(press({ ctrlKey: true, shiftKey: true, code: "F9", keyCode: 120 })), { value: "Ctrl+Shift+F9" });
    assert.deepEqual(hotkeyFromEvent(press({ altKey: true, code: "Digit1", keyCode: 49 })), { value: "Alt+1" });
    assert.deepEqual(hotkeyFromEvent(press({ ctrlKey: true, code: "Numpad1", keyCode: 97 })), { value: "Ctrl+Numpad1" });
    assert.deepEqual(hotkeyFromEvent(press({ ctrlKey: true, altKey: true, code: "AltLeft", keyCode: 18 })), { partial: "Ctrl+Alt" });
    assert.deepEqual(hotkeyFromEvent(press({ code: "Escape", keyCode: 27 })), { cancel: true });
  });

  test("à lire joliment, en français et en anglais", () => {
    assert.equal(prettyHotkey("Ctrl+Alt+K"), "Ctrl + Alt + K");
    assert.equal(prettyHotkey("Ctrl+Shift+Super+Enter"), "Ctrl + Maj + Win + Entrée");
    assert.equal(prettyHotkey("Ctrl+Shift+Super+Enter", "en"), "Ctrl + Shift + Win + Enter");
    assert.equal(prettyHotkey("Alt+ArrowUp"), "Alt + ↑");
    assert.equal(prettyHotkey("Ctrl+Numpad3", "en"), "Ctrl + Num 3");
  });

  test("le champ « hotkey » garde un choix proposé, un raccourci valable ou rien", () => {
    const presets = ["Ctrl+Alt+V", "Alt+Shift+V"];
    assert.equal(coerceHotkey("Alt+Shift+V", presets, "Ctrl+Alt+V"), "Alt+Shift+V");
    assert.equal(coerceHotkey("", presets, "Ctrl+Alt+V"), "");
    assert.equal(coerceHotkey("alt+ctrl+k", presets, "Ctrl+Alt+V"), "Ctrl+Alt+K");
    assert.equal(coerceHotkey("Alt+F4", presets, "Ctrl+Alt+V"), "Ctrl+Alt+V");
    assert.equal(coerceHotkey(42, presets, "Ctrl+Alt+V"), "Ctrl+Alt+V");
    const field: SettingField = { key: "k", type: "hotkey", label: "Raccourci", default: "Ctrl+Alt+V", options: presets.map((value) => ({ value, label: value })) };
    assert.equal(coerce(field, "Ctrl+Shift+F9"), "Ctrl+Shift+F9");
    assert.equal(coerce(field, "Ctrl+C"), "Ctrl+Alt+V");
  });

  test("Parler à Ondine : les deux raccourcis sont des champs « hotkey »", () => {
    const m = JSON.parse(readFileSync("src/modules/askclaude/manifest.json", "utf8")) as ModuleManifest;
    const fields = m.settings?.fields ?? [];
    for (const key of ["voiceHotkey", "lookHotkey"]) {
      const f = fields.find((x) => x.key === key);
      assert.equal(f?.type, "hotkey", key);
      for (const o of f?.type === "hotkey" ? (f.options ?? []) : []) assert.ok(!o.value || !hotkeyProblem(o.value), o.value);
    }
    const def = (key: string) => (fields.find((x) => x.key === key) as { default?: unknown } | undefined)?.default;
    assert.equal(def("wakeWord"), false, "mot d'appel coupé par défaut");
    assert.equal(def("micDevice"), "", "micro par défaut de Windows");
  });
});

const MICS: Mic[] = [
  { id: "a", name: "Réseau de microphones", default: true, communications: false },
  { id: "b", name: "Micro du casque", default: false, communications: true },
];

describe("choix du micro", () => {
  test("la liste : celui de Windows d'abord, puis chaque micro ; un micro débranché reste choisi", () => {
    assert.deepEqual(micOptions(MICS, ""), [
      ["", "Micro par défaut de Windows (Réseau de microphones)"],
      ["a", "Réseau de microphones"],
      ["b", "Micro du casque · communication"],
    ]);
    assert.equal(micOptions([], "")[0][1], "Micro par défaut de Windows");
    assert.deepEqual(micOptions(MICS, "z").at(-1), ["z", "Micro choisi (débranché : celui par défaut en attendant)"]);
  });

  test("la reconnaissance de Windows n'écoute que le micro par défaut : c'est dit", () => {
    assert.ok(micEngineWarning("windows", "b", MICS));
    assert.equal(micEngineWarning("windows", "a", MICS), null, "c'est déjà celui par défaut");
    assert.equal(micEngineWarning("windows", "", MICS), null);
    for (const engine of ["offline", "parakeet", "api"]) assert.equal(micEngineWarning(engine, "b", MICS), null, engine);
  });

  test("le bilan de « Tester le micro »", () => {
    const ok = micTestText({ done: true, info: { name: "Micro du casque", format: "48000 Hz", peak: 0.42, muted: false, volume: 0.8, fellBack: false } });
    assert.deepEqual(ok, { ok: true, text: "Ondine vous entend avec « Micro du casque » (niveau max 42 %).", note: null });
    const bad = micTestText({ done: true, problem: "le micro « X » est coupé", fix: "sound" });
    assert.equal(bad.ok, false);
    assert.equal(bad.text, "Le micro « X » est coupé");
    assert.ok(micTestText({ done: true, info: { name: "Y", format: "", peak: 0.3, muted: null, volume: null, fellBack: true } }).note);
    assert.equal(sentence("  "), "");
  });

  test("l'état du mot d'appel", () => {
    assert.equal(wakeText(null, true), "Windows seulement.");
    assert.equal(wakeText({ supported: false, on: false, paused: "windows", parakeet: false }, false), "Windows seulement.");
    assert.match(wakeText({ supported: true, on: false, paused: "parakeet", parakeet: false }, true), /Parakeet/);
    assert.match(wakeText({ supported: true, on: false, paused: "off", parakeet: true }, false), /^Coupé/);
    assert.match(wakeText({ supported: true, on: true, paused: "", parakeet: true }, true), /point rouge/);
    assert.match(wakeText({ supported: true, on: false, paused: "locked", parakeet: true }, true), /verrouillé/);
    assert.match(wakeText({ supported: true, on: false, paused: "discreet", parakeet: true }, true), /discrétion/);
  });
});

describe("le point rouge du mot d'appel sur l'île", () => {
  test("voice.wake allume et éteint le point, toujours montré en premier", () => {
    const on = nanoStep(NANO_START, "voice.wake", { on: true });
    assert.equal(on.status.wake, true);
    assert.equal(on.pulse, undefined, "pas d'élargissement : un simple point");
    assert.deepEqual(nanoDots({ ...dotStatus(on.status), music: true, agent: true, timer: true }), ["wake", "music", "agent"]);
    assert.equal(nanoStep(on.status, "voice.wake", { on: false }).status.wake, false);
  });
});
