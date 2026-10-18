// Tests des rappels des tâches (src/modules/notes/remind-logic.ts) et du petit
// retour de la langue du clavier (layoutNote, src/modules/halos/halo-rules.ts),
// avec leur traduction anglaise.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  atFrom,
  dateValue,
  dueReminders,
  isSoon,
  nextReminder,
  quickChoices,
  reminderAlert,
  reminderLabel,
  snoozeAt,
  SNOOZE_MS,
  type Remindable,
} from "../../src/modules/notes/remind-logic";
import { layoutNote } from "../../src/modules/halos/halo-rules";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };

/** Même recherche que t() (src/core/i18n.ts). */
function en(fr: string): string {
  const s = fr.trim();
  if (DICT.exact[s] !== undefined) return DICT.exact[s];
  for (const [rx, rep] of DICT.patterns) {
    const re = new RegExp(rx);
    if (re.test(s)) return s.replace(re, rep);
  }
  return fr;
}

const MIN = 60_000;
/** 18 octobre 2026, 15:00 (heure locale). */
const at = (h: number, m = 0, day = 18) => new Date(2026, 9, day, h, m).getTime();
const NOW = at(14, 50);
const task = (id: number, extra: Partial<Remindable> = {}): Remindable => ({ id, text: `Tâche ${id}`, done: false, ...extra });

describe("rappels : ce qui est dû", () => {
  test("seulement les tâches à faire, pas encore dites, dont l'heure est passée", () => {
    const todos = [
      task(1, { remindAt: at(15) }), // à venir
      task(2, { remindAt: at(14, 30) }), // dû
      task(3, { remindAt: at(14), done: true }), // faite : plus de rappel
      task(4, { remindAt: at(14), reminded: true }), // déjà dit
      task(5), // sans heure (les anciennes tâches)
      task(6, { remindAt: at(13) }), // dû, plus ancien
    ];
    assert.deepEqual(
      dueReminders(todos, NOW).map((t) => t.id),
      [6, 2],
    );
    assert.equal(nextReminder(todos, NOW), at(15));
    assert.equal(nextReminder([task(5)], NOW), null);
  });

  test("bientôt : dans les 30 minutes, pas après, pas une tâche faite", () => {
    assert.ok(isSoon(task(1, { remindAt: at(15) }), NOW));
    assert.ok(isSoon(task(1, { remindAt: at(15, 20) }), NOW));
    assert.ok(!isSoon(task(1, { remindAt: at(15, 21) }), NOW));
    assert.ok(!isSoon(task(1, { remindAt: at(15), done: true }), NOW));
    assert.ok(!isSoon(task(1, { remindAt: at(14) }), NOW)); // passé
    assert.ok(!isSoon(task(1), NOW));
  });

  test("« 10 min » repousse de dix minutes", () => {
    assert.equal(snoozeAt(NOW), NOW + 10 * MIN);
    assert.equal(SNOOZE_MS, 10 * MIN);
  });
});

describe("rappels : l'alerte", () => {
  test("à l'heure : « Il est 15:00 » ; rattrapé : « Prévu à 15:00 »", () => {
    const t = task(1, { text: "Appeler le garage", remindAt: at(15) });
    const onTime = reminderAlert([t], at(15, 0) + 20_000);
    assert.equal(onTime?.kind, "one");
    assert.equal(onTime?.title, "Appeler le garage");
    assert.equal(onTime?.body, "Il est 15:00");
    assert.equal(reminderAlert([t], at(16, 30))?.body, "Prévu à 15:00");
    // Manqué la veille (PC en veille toute la nuit) : la date aussi.
    assert.equal(reminderAlert([t], at(9, 0, 19))?.body, "Prévu à 18/10 15:00");
    assert.equal(reminderAlert([], NOW), null);
  });

  test("plusieurs : une seule alerte « 2 rappels manqués »", () => {
    const due = [task(1, { remindAt: at(9) }), task(2, { remindAt: at(10) })];
    const a = reminderAlert(due, at(11));
    assert.equal(a?.kind, "many");
    assert.equal(a?.title, "2 rappels manqués");
    assert.equal(a?.body, "Tâche 1 · Tâche 2");
    // Deux à la même heure, dites à l'heure : pas « manqués ».
    const same = [task(1, { remindAt: at(10) }), task(2, { remindAt: at(10) })];
    assert.equal(reminderAlert(same, at(10, 1))?.title, "2 rappels");
    const many = [1, 2, 3, 4].map((id) => task(id, { remindAt: at(9) }));
    assert.equal(reminderAlert(many, at(11))?.body, "Tâche 1 · Tâche 2 · Tâche 3 · …");
  });
});

describe("rappels : le choix de l'heure", () => {
  test("jour et heure → ms ; refusé si mal écrit", () => {
    assert.equal(atFrom("2026-10-18", "15:00"), at(15));
    assert.equal(atFrom("2026-10-18", "9:05"), at(9, 5));
    assert.equal(atFrom("2026-10-18", ""), null);
    assert.equal(atFrom("2026-10-18", "25:00"), null);
    assert.equal(atFrom("2026-02-31", "10:00"), null);
    assert.equal(atFrom("", "10:00"), null);
    assert.equal(dateValue(at(15)), "2026-10-18");
  });

  test("raccourcis : dans 30 min, ce soir 18:00 (avant 18 h seulement), demain 9:00", () => {
    const q = quickChoices(at(14, 50) + 25_000);
    assert.deepEqual(
      q.map((c) => c.label),
      ["Dans 30 min", "Ce soir 18:00", "Demain 9:00"],
    );
    assert.equal(q[0].at, at(15, 20));
    assert.equal(q[1].at, at(18));
    assert.equal(q[2].at, at(9, 0, 19));
    assert.deepEqual(
      quickChoices(at(19)).map((c) => c.label),
      ["Dans 30 min", "Demain 9:00"],
    );
  });

  test("l'heure de la ligne : aujourd'hui, demain, sinon la date", () => {
    assert.equal(reminderLabel(at(15), NOW), "15:00");
    assert.equal(reminderLabel(at(9, 0, 19), NOW), "Demain 09:00");
    assert.equal(reminderLabel(at(9, 0, 21), NOW), "21/10 09:00");
  });

  test("traduits en anglais", () => {
    for (const fr of ["Dans 30 min", "Ce soir 18:00", "Demain 9:00", "Ajouter un rappel", "Changer le rappel", "Retirer le rappel", "Valider", "Fait", "10 min", "Voir les tâches"]) {
      assert.ok(fr in DICT.exact, fr);
    }
    assert.equal(en("Il est 15:00"), "It's 15:00");
    assert.equal(en("Prévu à 18/10 15:00"), "Due at 18/10 15:00");
    assert.equal(en("2 rappels manqués"), "2 missed reminders");
    assert.equal(en("Demain 09:00"), "Tomorrow 09:00");
  });
});

describe("langue du clavier", () => {
  test("« Clavier en anglais », pastilles FR → EN", () => {
    assert.deepEqual(layoutNote({ from: "FR", to: "EN", name: "Anglais (États-Unis)" }), {
      title: "Clavier en anglais",
      body: "Anglais (États-Unis)",
      chips: ["FR", "EN"],
    });
    assert.deepEqual(layoutNote({ from: "EN", to: "FR", name: "Français" }), {
      title: "Clavier en français",
      body: "Win + Espace pour changer",
      chips: ["EN", "FR"],
    });
    // Deux dispositions de la même langue (France, Canada) : une seule pastille.
    assert.deepEqual(layoutNote({ from: "FR", to: "FR", name: "Français (Canada)" }).chips, ["FR"]);
    // Une langue inconnue du Rust.
    assert.equal(layoutNote({ from: "FR", to: "", name: "" }).title, "Langue du clavier changée");
    assert.deepEqual(layoutNote({}).chips, []);
  });

  test("chaque langue du Rust a sa traduction (titre et variante)", () => {
    const rust = readFileSync("src-tauri/src/modules/halos.rs", "utf8");
    const body = rust.slice(rust.indexOf("fn lang_label"), rust.indexOf("// ── Le fil de fond"));
    const names = [...body.matchAll(/"([A-ZÉ][^"]*)"/g)].map((m) => m[1]).filter((n) => !/^[A-Z]{2}$/.test(n));
    assert.ok(names.length > 40, "la table du Rust n'a pas été trouvée");
    const missing: string[] = [];
    for (const name of new Set(names)) {
      const note = layoutNote({ from: "FR", to: "XX", name });
      for (const text of [note.title, note.body]) if (en(text) === text) missing.push(text);
    }
    assert.deepEqual(missing, []);
  });
});
