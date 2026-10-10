// Tests des petites fonctions partagées des Règles (src/modules/rules/shared.ts) :
// le résumé des nouveaux déclencheurs, les jours, les actions permises, le compteur.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { allowedActions, countText, daysText, givesFile, summary, TEMPLATES, EMPTY_CONDITIONS, type Rule } from "../../src/modules/rules/shared";

describe("Règles : textes et actions permises", () => {
  test("les jours en clair", () => {
    assert.equal(daysText([]), "tous les jours");
    assert.equal(daysText([0, 1, 2, 3, 4]), "en semaine");
    assert.equal(daysText([6, 5]), "le week-end");
    assert.equal(daysText([4]), "ven.");
  });

  test("le déclencheur horaire donne un fichier seulement avec un dossier", () => {
    assert.equal(givesFile({ type: "schedule", time: "17:00", days: [4], folder: "" }), false);
    assert.equal(givesFile({ type: "schedule", time: "17:00", days: [4], folder: "C:\\D" }), true);
    assert.ok(allowedActions({ type: "schedule", time: "17:00", folder: "C:\\D" }).includes("trash"));
    assert.ok(!allowedActions({ type: "agent" }).includes("trash"));
    assert.ok(allowedActions({ type: "agent" }).includes("mascot"));
    assert.ok(allowedActions({ type: "file", folder: "C:\\D" }).includes("unzip"));
  });

  test("résumé d'une règle", () => {
    const r: Rule = {
      id: 1,
      name: "x",
      enabled: true,
      trigger: { type: "network", change: "internetDown" },
      conditions: { ...EMPTY_CONDITIONS, days: [0, 1, 2, 3, 4], from: "09:00", to: "18:00" },
      actions: [{ type: "quiet", minutes: 30 }],
    };
    assert.equal(summary(r), "Quand Internet est coupé (en semaine, de 09:00 à 18:00) → Calme 30 min");
    r.trigger = { type: "schedule", time: "17:00", days: [4], folder: "C:\\Users\\S\\Downloads" };
    r.conditions = { ...EMPTY_CONDITIONS, olderThanDays: 30 };
    r.actions = [{ type: "trash" }];
    assert.equal(summary(r), "Ven. à 17:00, les fichiers de Downloads (plus vieux que 30 j) → mettre à la corbeille");
  });

  test("compteur de la semaine", () => {
    assert.equal(countText(0), "");
    assert.equal(countText(undefined), "");
    assert.equal(countText(1), "déclenchée 1 fois cette semaine");
    assert.equal(countText(12), "déclenchée 12 fois cette semaine");
  });

  test("les nouveaux modèles sont là", () => {
    const titles = TEMPLATES.map((t) => t.title).join(" | ");
    for (const want of ["vieux téléchargements", "Pause déjeuner", "la mascotte danse", "Internet coupé"]) assert.ok(titles.includes(want), want);
  });
});
