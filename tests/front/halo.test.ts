// Tests du halo de l'île : palettes et rythmes (src/island/halo-palettes.ts),
// qui passe devant qui (halo-stack.ts), les règles des halos de batterie
// (src/modules/system/battery-rules.ts) et des moments de la journée
// (src/modules/halos/halo-rules.ts). Le dessin lui-même (halo.ts) est vérifié sur Windows.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forLightBackground, hexToRgb, intensityOf, isPaletteName, MIN_PERIOD_MS, PALETTES, paletteColors, pulse, rhythmMs, skyPalette } from "../../src/island/halo-palettes";
import { HaloStack, priorityOf, type HaloPriority } from "../../src/island/halo-stack";
import { batteryPrefs, BRIEF_CHARGE_MS, chargeHaloMs, fillFor, PLUG_WAVE_MS } from "../../src/modules/system/battery-rules";
import { dayKey, leaveDue, levelFromPeak, meetingCometMs, morningDue, parseTime, sessionProgress, weatherKind } from "../../src/modules/halos/halo-rules";

describe("palettes du halo", () => {
  test("chaque palette a 2 à 6 couleurs « #rrggbb », jamais une couleur plate", () => {
    for (const [name, p] of Object.entries(PALETTES)) {
      const all = [...p.dark, ...("light" in p ? (p.light as string[]) : [])];
      assert.ok(p.dark.length >= 2 && p.dark.length <= 6, name);
      for (const c of all) assert.ok(hexToRgb(c), `${name} : ${c}`);
      assert.ok(new Set(p.dark).size >= 2, `${name} : couleur plate`);
    }
  });

  test("sur fond clair, les couleurs sont plus foncées (sinon elles disparaissent)", () => {
    const lum = (hex: string) => {
      const [r, g, b] = hexToRgb(hex)!;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const c of PALETTES.charge.dark) assert.ok(lum(forLightBackground(c)) < lum(c), c);
    // Une palette peut donner ses propres couleurs claires (le blanc ne se verrait pas).
    assert.deepEqual(paletteColors(PALETTES.white, false), PALETTES.white.light);
    assert.deepEqual(paletteColors(PALETTES.charge, true), PALETTES.charge.dark);
  });

  test("noms de palettes", () => {
    assert.ok(isPaletteName("charge"));
    assert.ok(!isPaletteName("toString"));
    assert.ok(!isPaletteName(42));
  });

  test("le ciel suit l'heure", () => {
    const same = (a: number, b: number) => JSON.stringify(skyPalette(a)) === JSON.stringify(skyPalette(b));
    assert.ok(!same(6, 13));
    assert.ok(!same(19, 23));
    assert.deepEqual(skyPalette(2), skyPalette(23));
  });

  test("intensité : Vif par défaut", () => {
    assert.equal(intensityOf(undefined), "vivid");
    assert.equal(intensityOf("subtle"), "subtle");
    assert.equal(intensityOf("n'importe quoi"), "vivid");
  });
});

describe("rythmes", () => {
  test("lent > doux > moyen > rapide", () => {
    assert.ok(rhythmMs("slow") > rhythmMs("calm"));
    assert.ok(rhythmMs("calm") > rhythmMs("medium"));
    assert.ok(rhythmMs("medium") > rhythmMs("fast"));
  });

  test("jamais de clignotement trop rapide", () => {
    assert.equal(rhythmMs(50), MIN_PERIOD_MS);
    assert.ok(rhythmMs("fast") >= MIN_PERIOD_MS);
    assert.ok(rhythmMs("heartbeat") >= MIN_PERIOD_MS);
    assert.equal(rhythmMs(Number.NaN), rhythmMs("calm"));
  });

  test("la pulsation reste entre 0 et 1, et le cœur bat deux fois puis se repose", () => {
    for (let t = 0; t < 5000; t += 37) {
      for (const r of ["slow", "calm", "medium", "fast", "heartbeat"] as const) {
        const p = pulse(r, t);
        assert.ok(p >= 0 && p <= 1, `${r} ${t} ${p}`);
      }
    }
    const period = rhythmMs("heartbeat");
    assert.ok(pulse("heartbeat", period * 0.12) > 0.9); // premier battement
    assert.ok(pulse("heartbeat", period * 0.34) > 0.6); // second, plus faible
    assert.ok(pulse("heartbeat", period * 0.7) < 0.05); // repos
  });
});

describe("qui passe devant", () => {
  const h = (id: string, priority: HaloPriority) => ({ id, priority });

  test("la plus prioritaire, puis la plus récente ; l'ancienne revient ensuite", () => {
    const s = new HaloStack<{ id: string; priority: HaloPriority }>();
    s.add(h("charge", "low"));
    assert.equal(s.top()?.id, "charge");
    s.add(h("download", "normal"));
    assert.equal(s.top()?.id, "download");
    s.add(h("critical", "high"));
    s.add(h("copy", "normal"));
    assert.equal(s.top()?.id, "critical"); // la plus prioritaire reste devant
    s.remove("critical");
    assert.equal(s.top()?.id, "copy"); // la plus récente à priorité égale
    s.remove("copy");
    s.remove("download");
    assert.equal(s.top()?.id, "charge"); // l'état d'avant revient
    s.remove("charge");
    assert.equal(s.top(), null);
  });

  test("même id : remplace et redevient la plus récente", () => {
    const s = new HaloStack<{ id: string; priority: HaloPriority }>();
    s.add(h("a", "normal"));
    s.add(h("b", "normal"));
    s.add(h("a", "normal"));
    assert.equal(s.size, 2);
    assert.equal(s.top()?.id, "a");
  });

  test("priorité inconnue → normale", () => {
    assert.equal(priorityOf("urgent"), "normal");
    assert.equal(priorityOf("critical"), "critical");
  });
});

describe("halos de batterie", () => {
  test("réglages par défaut : tout allumé, quelques secondes en charge", () => {
    const p = batteryPrefs({});
    assert.equal(p.chargeHalo, "brief");
    assert.ok(p.plug && p.unplug && p.full && p.low && p.critical && p.fullAlert);
    assert.equal(batteryPrefs({ chargeHalo: "toujours ?" }).chargeHalo, "brief");
    assert.equal(batteryPrefs({ haloLow: false }).low, false);
  });

  test("combien de temps le halo vert reste au branchement", () => {
    assert.equal(chargeHaloMs(batteryPrefs({ chargeHalo: "always" })), 0);
    assert.equal(chargeHaloMs(batteryPrefs({ chargeHalo: "brief" })), BRIEF_CHARGE_MS);
    assert.equal(chargeHaloMs(batteryPrefs({ chargeHalo: "never" })), PLUG_WAVE_MS);
    assert.equal(chargeHaloMs(batteryPrefs({ chargeHalo: "never", haloPlug: false })), null);
  });

  test("le contour se remplit jusqu'au niveau de charge", () => {
    assert.equal(fillFor(56), 0.56);
    assert.equal(fillFor(100), 1);
    assert.equal(fillFor(0), 0.06); // un petit bout visible
    assert.equal(fillFor(null), 1);
  });

  test("les seuils et réglages sont déclarés dans le manifeste du module Système", () => {
    const m = JSON.parse(readFileSync("src/modules/system/manifest.json", "utf8")) as {
      settings: { fields: { key: string; default: unknown }[] };
      events: { emits: string[] };
      commands: string[];
    };
    const def = (k: string) => m.settings.fields.find((f) => f.key === k)?.default;
    assert.equal(def("batteryLowPct"), 20);
    assert.equal(def("batteryCriticalPct"), 10);
    assert.equal(def("chargeHalo"), "brief");
    for (const t of ["system.battery-plug", "system.battery-critical", "mascot.emote"]) assert.ok(m.events.emits.includes(t), t);
    assert.ok(m.commands.includes("battery"));
  });
});

describe("moments de la journée", () => {
  test("heure de partir : « 18:00 », « 18h », « 7.30 »", () => {
    assert.equal(parseTime("18:00"), 18 * 60);
    assert.equal(parseTime("18h"), 18 * 60);
    assert.equal(parseTime("7.30"), 7 * 60 + 30);
    assert.equal(parseTime(""), null);
    assert.equal(parseTime("25:00"), null);
    assert.equal(parseTime("18:75"), null);
  });

  test("heure de partir : en semaine, une fois, pendant une demi-heure", () => {
    const fri = (h: number, m = 0) => new Date(2026, 9, 9, h, m); // vendredi 9 octobre 2026
    assert.ok(!leaveDue(fri(17, 59), 18 * 60, ""));
    assert.ok(leaveDue(fri(18, 0), 18 * 60, ""));
    assert.ok(leaveDue(fri(18, 29), 18 * 60, ""));
    assert.ok(!leaveDue(fri(18, 30), 18 * 60, ""));
    assert.ok(!leaveDue(fri(18, 5), 18 * 60, dayKey(fri(9)))); // déjà fait aujourd'hui
    assert.ok(!leaveDue(new Date(2026, 9, 10, 18, 5), 18 * 60, "")); // samedi
    assert.ok(!leaveDue(fri(18, 5), null, "")); // désactivé
  });

  test("bonjour du matin : la première activité avant midi, une fois par jour", () => {
    const at = (h: number) => new Date(2026, 9, 9, h, 10);
    assert.ok(morningDue(at(8), 2000, "2026-10-08"));
    assert.ok(!morningDue(at(8), 10 * 60_000, "2026-10-08")); // personne au PC
    assert.ok(!morningDue(at(8), 2000, "2026-10-09")); // déjà dit
    assert.ok(!morningDue(at(14), 2000, "")); // l'après-midi
    assert.ok(!morningDue(at(3), 2000, "")); // la nuit
  });

  test("météo : pluie, orage, ou rien", () => {
    assert.equal(weatherKind("🌧️"), "rain");
    assert.equal(weatherKind("🌦️"), "rain");
    assert.equal(weatherKind("⛈️"), "storm");
    assert.equal(weatherKind("☀️"), null);
    assert.equal(weatherKind(undefined), null);
  });

  test("rendez-vous : la comète accélère à l'approche", () => {
    assert.equal(meetingCometMs(5 * 60_000), 2400);
    assert.equal(meetingCometMs(0), 900);
    assert.ok(meetingCometMs(60_000) < meetingCometMs(4 * 60_000));
    assert.equal(meetingCometMs(60 * 60_000), 2400);
  });

  test("jauge d'une séance, niveau sonore", () => {
    assert.equal(sessionProgress(0, null, 1000), 0);
    assert.equal(sessionProgress(500, 1000, 1000), 0.5);
    assert.equal(sessionProgress(5000, 1000, 1000), 1);
    assert.equal(levelFromPeak(0), 0);
    assert.equal(levelFromPeak(null), 0);
    assert.equal(levelFromPeak(1), 1);
    assert.ok(levelFromPeak(0.04) > 0.2); // une voix douce se voit
  });
});

describe("module « Animations de l'île »", () => {
  const m = JSON.parse(readFileSync("src/modules/halos/manifest.json", "utf8")) as {
    settings: { fields: { key: string; type: string; default: unknown; essential?: boolean }[] };
    events: { emits: string[]; listens: string[] };
  };
  const def = (k: string) => m.settings.fields.find((f) => f.key === k)?.default;

  test("défauts : Vif, selon l'état, heure de partir et ciel désactivés", () => {
    assert.equal(def("intensity"), "vivid");
    assert.equal(def("colors"), "state");
    assert.equal(def("leaveTime"), "");
    assert.equal(def("sky"), false);
    assert.equal(def("music"), false);
    assert.equal(def("think"), true);
  });

  test("chaque catégorie a son réglage pour la couper", () => {
    for (const k of ["wake", "usb", "download", "disk", "wifi", "weather", "network", "capture", "shelfDrop", "cpu", "update", "think", "agents", "voice", "focus", "meeting", "streak", "dance", "capsLock", "numLock", "clipboard", "clipText", "volumeKeys", "morning"]) {
      assert.equal(m.settings.fields.find((f) => f.key === k)?.type, "boolean", k);
    }
  });

  test("le halo est déclaré sur le bus (island.halo) pour les autres modules", () => {
    assert.ok(m.events.emits.includes("island.halo"));
    for (const t of ["halos.wake", "halos.lock-key", "halos.clip", "halos.volume", "halos.wifi"]) {
      assert.ok(m.events.emits.includes(t) && m.events.listens.includes(t), t);
    }
  });
});
