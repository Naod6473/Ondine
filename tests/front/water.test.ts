// Tests du module Eau (src/modules/water/water-logic.ts) : réglages bornés,
// carnet nettoyé, total du jour, la semaine en barres, les litres, et l'heure
// du prochain rappel. Plus le manifeste (coupé par défaut, sans permission)
// et les traductions. Le carnet lui-même est testé côté Rust (water.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDays,
  cleanLog,
  dateKey,
  dayTotal,
  glassLabel,
  goalLine,
  lastGlassAt,
  litres,
  nextReminderAt,
  progress,
  reminderBody,
  reminderDue,
  waterSettings,
  weekBars,
  weekdayLetter,
  type WaterLog,
} from "../../src/modules/water/water-logic";
import { MODULES_OFF_BY_DEFAULT } from "../../src/core/settings-store";
import { MODULE_CATEGORIES } from "../../src/settings/layout";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };

/** Même recherche que t() (src/core/i18n.ts). */
function english(fr: string): string {
  const s = fr.trim();
  if (DICT.exact[s] !== undefined) return DICT.exact[s];
  for (const [rx, rep] of DICT.patterns) {
    const re = new RegExp(rx);
    if (re.test(s)) return s.replace(re, rep);
  }
  return fr;
}

/** Le 18 octobre 2026 (un dimanche) à cette heure. */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 9, 18, hour, minute);
}

const DEFAULTS = waterSettings({});
const LOG: WaterLog = {
  today: "2026-10-18",
  days: {
    "2026-10-12": [{ at: "10:00", ml: 2500 }],
    "2026-10-17": [{ at: "09:00", ml: 250 }, { at: "12:00", ml: 500 }],
    "2026-10-18": [
      { at: "08:30", ml: 250 },
      { at: "10:15", ml: 250 },
    ],
  },
};

describe("eau : réglages et carnet", () => {
  test("les valeurs du manifeste par défaut : 25 cl, 2 L, 9 h à 18 h, toutes les 90 min", () => {
    assert.deepEqual(DEFAULTS, { glassMl: 250, goalMl: 2000, startHour: 9, endHour: 18, everyMin: 90 });
    assert.deepEqual(waterSettings({ glassCl: 500, goalL: -1, startHour: 30, everyMin: "x" }), { glassMl: 1000, goalMl: 500, startHour: 23, endHour: 18, everyMin: 90 });
  });

  test("un carnet abîmé est nettoyé", () => {
    assert.equal(cleanLog(null), null);
    assert.equal(cleanLog({ today: "hier" }), null);
    assert.deepEqual(cleanLog({ today: "2026-10-18", days: { "2026-10-18": [{ at: "09:00", ml: 250 }, { at: 3, ml: 1 }, null], nope: [] } }), {
      today: "2026-10-18",
      days: { "2026-10-18": [{ at: "09:00", ml: 250 }] },
    });
  });

  test("les dates", () => {
    assert.equal(dateKey(at(9)), "2026-10-18");
    assert.equal(addDays("2026-10-18", -6), "2026-10-12");
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });
});

describe("eau : le jour et la semaine", () => {
  test("total du jour et progression", () => {
    assert.equal(dayTotal(LOG), 500);
    assert.equal(dayTotal(LOG, "2026-10-17"), 750);
    assert.equal(dayTotal(LOG, "2026-10-01"), 0);
    assert.equal(progress(500, 2000), 0.25);
    assert.equal(progress(2500, 2000), 1);
  });

  test("7 barres, aujourd'hui à droite, hauteur par rapport au plus gros jour s'il dépasse l'objectif", () => {
    const bars = weekBars(LOG, 2000);
    assert.equal(bars.length, 7);
    assert.deepEqual(
      bars.map((b) => b.day),
      ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"],
    );
    assert.deepEqual(
      bars.map((b) => b.today),
      [false, false, false, false, false, false, true],
    );
    assert.equal(bars[0].height, 1); // 2,5 L : le plus gros jour
    assert.equal(bars[6].height, 0.2);
    // Le 12 octobre 2026 est un lundi, le 18 un dimanche.
    assert.equal(bars[0].weekday, 0);
    assert.equal(bars[6].weekday, 6);
    assert.equal(weekdayLetter(6, "fr"), "D");
    assert.equal(weekdayLetter(6, "en"), "S");
    assert.equal(weekdayLetter(2, "fr"), "M");
  });

  test("les litres et les textes", () => {
    assert.equal(litres(2000), "2 L");
    assert.equal(litres(1250), "1,25 L");
    assert.equal(litres(1250, "en"), "1.25 L");
    assert.equal(litres(500), "0,50 L");
    assert.equal(litres(0), "0 L");
    assert.equal(goalLine(2000), "sur 2 L aujourd'hui");
    assert.equal(glassLabel(250), "+ 25 cl");
    assert.equal(reminderBody(1250, 2000), "Aujourd'hui : 1,25 L sur 2 L");
  });

  test("l'heure du dernier verre d'aujourd'hui", () => {
    assert.equal(lastGlassAt(LOG, at(12)), at(10, 15).getTime());
    assert.equal(lastGlassAt({ today: "2026-10-18", days: {} }, at(12)), null);
    // Le carnet est d'hier (minuit passé) : pas de dernier verre aujourd'hui.
    assert.equal(lastGlassAt(LOG, new Date(2026, 9, 19, 9)), null);
  });
});

describe("eau : le prochain rappel", () => {
  const none = { lastGlassAt: null, lastAskedAt: null, snoozeUntil: null, totalMl: 0 };

  test("le premier au début de la plage, pas avant", () => {
    assert.equal(nextReminderAt(at(7), DEFAULTS, none), at(9).getTime());
    assert.equal(reminderDue(at(8, 59), DEFAULTS, none), false);
    assert.equal(reminderDue(at(9), DEFAULTS, none), true);
    // Un verre bu avant 9 h ne compte pas.
    assert.equal(nextReminderAt(at(8), DEFAULTS, { ...none, lastGlassAt: at(8, 30).getTime() }), at(9).getTime());
  });

  test("ensuite, 90 min après le dernier verre ou le dernier rappel", () => {
    assert.equal(nextReminderAt(at(11), DEFAULTS, { ...none, lastGlassAt: at(10, 15).getTime() }), at(11, 45).getTime());
    assert.equal(nextReminderAt(at(11), DEFAULTS, { ...none, lastGlassAt: at(9, 30).getTime(), lastAskedAt: at(10).getTime() }), at(11, 30).getTime());
    assert.equal(reminderDue(at(11, 44), DEFAULTS, { ...none, lastGlassAt: at(10, 15).getTime() }), false);
    assert.equal(reminderDue(at(11, 45), DEFAULTS, { ...none, lastGlassAt: at(10, 15).getTime() }), true);
  });

  test("rien après la fin de la plage", () => {
    assert.equal(nextReminderAt(at(17), DEFAULTS, { ...none, lastGlassAt: at(16, 45).getTime() }), null);
    assert.equal(reminderDue(at(19), DEFAULTS, { ...none, lastAskedAt: at(16).getTime() }), false);
  });

  test("« Plus tard » avance le suivant ; un verre bu après l'efface", () => {
    const asked = at(10).getTime();
    const snooze = at(10, 30).getTime();
    assert.equal(nextReminderAt(at(10, 5), DEFAULTS, { ...none, lastAskedAt: asked, snoozeUntil: snooze }), snooze);
    // Le rappel du « Plus tard » est montré : on revient au rythme normal.
    assert.equal(nextReminderAt(at(10, 31), DEFAULTS, { ...none, lastAskedAt: snooze, snoozeUntil: snooze }), at(12).getTime());
    // Un verre bu après l'heure demandée : la demande ne sert plus.
    assert.equal(nextReminderAt(at(10, 50), DEFAULTS, { ...none, lastAskedAt: asked, lastGlassAt: at(10, 40).getTime(), snoozeUntil: snooze }), at(12, 10).getTime());
  });

  test("objectif atteint, rappels coupés, plage vide : plus de rappel", () => {
    assert.equal(nextReminderAt(at(12), DEFAULTS, { ...none, totalMl: 2000 }), null);
    assert.equal(nextReminderAt(at(12), { ...DEFAULTS, everyMin: 0 }, none), null);
    assert.equal(nextReminderAt(at(12), { ...DEFAULTS, startHour: 18, endHour: 9 }, none), null);
  });
});

describe("eau : le module", () => {
  const manifest = JSON.parse(readFileSync("src/modules/water/manifest.json", "utf8")) as {
    id: string;
    permissions: string[];
    commands: string[];
    tip: string;
    settings: { fields: { key: string; default: unknown; label: string; help?: string }[] };
    events: { listens: string[] };
  };

  test("coupé par défaut, rangé dans Organisation, sans permission", () => {
    assert.ok(MODULES_OFF_BY_DEFAULT.includes("water"));
    assert.match(readFileSync("src-tauri/src/services/settings.rs", "utf8"), /MODULES_OFF_BY_DEFAULT[^\n]*"water"/);
    assert.ok(MODULE_CATEGORIES.find((c) => c.id === "organize")!.modules.includes("water"));
    assert.deepEqual(manifest.permissions, []);
    assert.deepEqual(manifest.commands, ["read", "add", "undo"]);
    for (const t of ["timer.focus", "controls.media-use"]) assert.ok(manifest.events.listens.includes(t), t);
  });

  test("les réglages du manifeste suivent water-logic", () => {
    const defaults = Object.fromEntries(manifest.settings.fields.map((f) => [f.key, f.default]));
    assert.deepEqual(defaults, { glassCl: 25, goalL: 2, startHour: 9, endHour: 18, everyMin: 90 });
    assert.deepEqual(waterSettings(defaults), DEFAULTS);
  });

  test("les textes ont leur traduction anglaise", () => {
    for (const f of manifest.settings.fields) {
      assert.ok(DICT.exact[f.label], f.label);
      if (f.help) assert.ok(DICT.exact[f.help], f.help);
    }
    for (const fr of [manifest.tip, "Un verre d'eau ?", "Plus tard", "Annuler", "Retirer le dernier verre", "Les 7 derniers jours"]) assert.ok(DICT.exact[fr], fr);
    assert.equal(english(goalLine(2000)), "of 2 L today");
    assert.equal(english(goalLine(1500, "en")), "of 1.50 L today");
    assert.equal(english(reminderBody(1250, 2000, "en")), "Today: 1.25 L of 2 L");
  });
});
