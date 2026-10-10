// Tests du halo de l'île : palettes et rythmes (src/island/halo-palettes.ts),
// qui passe devant qui (halo-stack.ts), les règles des halos de batterie
// (src/modules/system/battery-rules.ts) et des moments de la journée
// (src/modules/halos/halo-rules.ts). Le dessin lui-même (halo.ts) est vérifié sur Windows.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forLightBackground, haloReach, hexToRgb, intensityOf, isPaletteName, lastingDim, MIN_PERIOD_MS, PALETTES, paletteColors, placeOf, progressLeft, progressWarn, pulse, rhythmMs, skyPalette, swell } from "../../src/island/halo-palettes";
import { HaloStack, priorityOf, type HaloPriority } from "../../src/island/halo-stack";
import { batteryPrefs, BRIEF_CHARGE_MS, chargeHaloMs, fillFor, PLUG_WAVE_MS } from "../../src/modules/system/battery-rules";
import { dayKey, leaveDue, levelFromPeak, mediaPlaying, meetingCometMs, morningDue, parseTime, sessionProgress, timerHaloPlan, weatherKind } from "../../src/modules/halos/halo-rules";

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

  test("où dessiner le halo : sur le contour par défaut", () => {
    assert.equal(placeOf(undefined), "edge");
    assert.equal(placeOf("inside"), "inside");
    assert.equal(placeOf("outside"), "outside");
    assert.equal(placeOf("partout"), "edge");
  });

  test("un halo reste un accent près de l'île, jamais un voile", () => {
    // Avant 1.2.2 : jusqu'à ~26 px de lueur et 26 px d'ondes autour de l'île.
    for (const i of ["subtle", "normal", "vivid"] as const) {
      assert.equal(haloReach("inside", i), 0);
      assert.ok(haloReach("edge", i) <= 6, `contour ${i} : ${haloReach("edge", i)}`);
      assert.ok(haloReach("outside", i) <= 12, `extérieur ${i} : ${haloReach("outside", i)}`);
    }
    assert.ok(haloReach("edge", "vivid") < haloReach("outside", "vivid"));
  });

  test("une forme qui gonfle reste tassée", () => {
    assert.equal(swell(0.5), 0.5);
    assert.equal(swell(1), 1);
    assert.ok(swell(1.5) < 1.5);
    assert.equal(swell(10), 1.3);
  });

  test("un halo qui reste (musique, visio, processeur) est plus pâle", () => {
    assert.equal(lastingDim(0, "low", "level"), 0.7);
    assert.equal(lastingDim(0, "normal", "breathe"), 0.7);
    assert.equal(lastingDim(180_000, "high", "comet"), 1); // un agent qui attend : une alerte
    assert.equal(lastingDim(2500, "normal", "sweep"), 1); // un moment bref
    assert.equal(lastingDim(0, "normal", "progress"), 1); // le liseré d'un minuteur, déjà fin
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

  test("défauts : Vif, selon l'état, sur le contour, heure de partir et ciel désactivés", () => {
    assert.equal(def("intensity"), "vivid");
    assert.equal(def("colors"), "state");
    assert.equal(def("place"), "edge");
    assert.equal(def("leaveTime"), "");
    assert.equal(def("sky"), false);
    assert.equal(def("music"), false);
    assert.equal(def("think"), true);
    assert.equal(def("timerRing"), true);
  });

  test("chaque catégorie a son réglage pour la couper", () => {
    for (const k of ["wake", "usb", "download", "disk", "wifi", "weather", "network", "capture", "shelfDrop", "cpu", "update", "think", "agents", "voice", "focus", "meeting", "streak", "dance", "timerRing", "capsLock", "numLock", "clipboard", "clipText", "volumeKeys", "morning"]) {
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

describe("le halo suit la musique", () => {
  test("lit l'état publié par le module Musique (un objet, pas un booléen)", () => {
    // Le bug de la 1.2.2 : on testait `playing === true`, jamais vrai : le halo
    // de la musique ne s'allumait jamais, et ce qu'on voyait était la danse.
    assert.equal(mediaPlaying({ playing: { status: "playing", title: "Nuit bleue" }, artwork: 2 }), true);
    assert.equal(mediaPlaying({ playing: { status: "paused" }, artwork: 2 }), false);
    assert.equal(mediaPlaying({ playing: null, artwork: -1 }), false);
    assert.equal(mediaPlaying({ playing: true }), false);
    assert.equal(mediaPlaying(null), false);
    // Le lecteur change de morceau : on ne sait pas, on garde l'état.
    assert.equal(mediaPlaying({ playing: { status: "changing" } }), null);
  });

  test("le module relit ses réglages pendant la lecture, et la danse obéit à la case Musique", () => {
    const src = readFileSync("src/modules/halos/index.ts", "utf8");
    assert.match(src, /onSettingsChange\(\(\) => \{\s*syncLevels\(\);/);
    assert.match(src, /on\("dance"\) && on\("music"\)/);
    assert.ok(!src.includes("p.playing === true"));
  });
});

describe("liseré des minuteurs", () => {
  test("ce qui reste : calculé depuis l'heure de fin, figé en pause", () => {
    assert.equal(progressLeft(0, 60_000, 60_000, 1), 1);
    assert.equal(progressLeft(30_000, 60_000, 60_000, 1), 0.5);
    assert.equal(progressLeft(90_000, 60_000, 60_000, 1), 0);
    // Interpolé : pas de marche d'escalier.
    assert.ok(Math.abs(progressLeft(10, 60_000, 60_000, 1) - (1 - 10 / 60_000)) < 1e-9);
    assert.equal(progressLeft(5, null, 60_000, 0.3), 0.3);
  });

  test("rougit seulement dans les dernières secondes", () => {
    const total = 5 * 60_000;
    assert.equal(progressWarn(0, total, total), 0);
    assert.equal(progressWarn(total - 10_000, total, total), 0);
    assert.equal(progressWarn(total - 5_000, total, total), 0.5);
    assert.equal(progressWarn(total, total, total), 1);
    assert.equal(progressWarn(0, null, total), 0);
    // Un minuteur très court : le dernier quart.
    assert.equal(progressWarn(0, 20_000, 20_000), 0);
    assert.equal(progressWarn(17_500, 20_000, 20_000), 0.5);
  });

  test("ce que fait le liseré à chaque nouvelle du Minuteur", () => {
    assert.deepEqual(timerHaloPlan({ id: "timer", phase: "timer", state: "running", endsAt: 1000, total: 600_000, left: 600_000 }), {
      action: "show",
      id: "timer-timer",
      palette: "timer",
      endsAt: 1000,
      total: 600_000,
      fill: 1,
    });
    // En pause : figé à ce qui reste.
    const paused = timerHaloPlan({ id: "pomodoro", phase: "work", state: "paused", endsAt: null, total: 100, left: 25 });
    assert.deepEqual(paused, { action: "show", id: "timer-pomodoro", palette: "tomato", endsAt: null, total: 100, fill: 0.25 });
    assert.equal((timerHaloPlan({ id: "pomodoro", phase: "short", state: "running", endsAt: 5, total: 5 }) as { palette: string }).palette, "rest");
    assert.deepEqual(timerHaloPlan({ id: "timer", state: "off", total: 0 }), { action: "hide", id: "timer-timer" });
    assert.deepEqual(timerHaloPlan({ id: "pomodoro", phase: "work", state: "done", total: 100 }), { action: "done", id: "timer-pomodoro-done", palette: "bloom" });
    assert.equal(timerHaloPlan({ id: "autre", state: "running" }), null);
  });

  test("le Minuteur publie timer.progress et les Animations de l'île l'écoutent", () => {
    const t = JSON.parse(readFileSync("src/modules/timer/manifest.json", "utf8")) as { events: { emits: string[] } };
    const h = JSON.parse(readFileSync("src/modules/halos/manifest.json", "utf8")) as { events: { listens: string[] } };
    assert.ok(t.events.emits.includes("timer.progress"));
    assert.ok(h.events.listens.includes("timer.progress"));
  });
});
