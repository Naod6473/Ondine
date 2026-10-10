// Tests de l'Accueil (src/modules/home/home-rules.ts) et de sa place dans la
// rangée d'onglets (src/core/tab-order.ts) : moment de la journée, ordre et
// taille des cartes, disposition par profil, phrase d'Ondine, actions rapides.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  arrangeCards,
  cleanLayout,
  composePhrase,
  emptyLayout,
  greeting,
  hideCard,
  layoutFor,
  layoutKey,
  lookTarget,
  momentOf,
  orderAfterDrag,
  PHRASE_PARTS,
  pickQuickActions,
  pickResume,
  QUICK_ACTIONS,
  resizeCard,
  weightAt,
  withLayout,
  type CardInfo,
} from "../../src/modules/home/home-rules";
import { applyTabOrder, LEAD_TABS, mergeOrder } from "../../src/core/tab-order";
import { homeCardKey } from "../../src/core/home-cards";

const card = (key: string, weight = 50, urgent = false, size: "small" | "large" = "small"): CardInfo => ({ key, weight, urgent, size });

describe("le moment de la journée", () => {
  test("matin de 5 h à 11 h, journée jusqu'à 18 h, soir ensuite (et la nuit)", () => {
    assert.equal(momentOf(4), "evening");
    assert.equal(momentOf(5), "morning");
    assert.equal(momentOf(10), "morning");
    assert.equal(momentOf(11), "day");
    assert.equal(momentOf(17), "day");
    assert.equal(momentOf(18), "evening");
    assert.equal(momentOf(23), "evening");
    assert.equal(momentOf(0), "evening");
  });

  test("l'importance d'une carte : bornée, 50 par défaut", () => {
    assert.equal(weightAt(undefined, "day"), 50);
    assert.equal(weightAt({ morning: 90 }, "day"), 50);
    assert.equal(weightAt({ day: 140 }, "day"), 100);
    assert.equal(weightAt({ day: -3 }, "day"), 0);
    assert.equal(weightAt({ day: Number.NaN }, "day"), 50);
  });
});

describe("l'ordre des cartes", () => {
  test("ordre automatique : l'urgente d'abord, puis la plus utile à ce moment", () => {
    const placed = arrangeCards([card("media", 40), card("agenda", 90), card("system", 30, true)], emptyLayout());
    assert.deepEqual(
      placed.map((p) => p.key),
      ["system", "agenda", "media"],
    );
  });

  test("sans le rangement par moment : l'ordre des modules (l'urgente reste devant)", () => {
    const placed = arrangeCards([card("media", 40), card("agenda", 90), card("system", 30, true)], emptyLayout(), false);
    assert.deepEqual(
      placed.map((p) => p.key),
      ["system", "media", "agenda"],
    );
  });

  test("rangé à la main : l'ordre choisi, les nouvelles cartes ensuite", () => {
    const layout = { ...emptyLayout(), order: ["timer", "media"] };
    const placed = arrangeCards([card("media"), card("agenda", 90, true), card("timer")], layout);
    assert.deepEqual(
      placed.map((p) => p.key),
      ["timer", "media", "agenda"],
    );
  });

  test("une carte retirée n'apparaît plus ; la taille choisie remplace celle du module", () => {
    let layout = hideCard(emptyLayout(), "system");
    layout = resizeCard(layout, "timer", "large");
    const placed = arrangeCards([card("system"), card("timer"), card("media", 50, false, "large")], layout);
    assert.deepEqual(placed, [
      { key: "timer", size: "large", urgent: false },
      { key: "media", size: "large", urgent: false },
    ]);
  });

  test("après un glisser, une carte silencieuse garde sa place relative", () => {
    // Avant : a b c d ; c n'a rien à dire ; on affiche maintenant d a b.
    assert.deepEqual(orderAfterDrag(["d", "a", "b"], ["a", "b", "c", "d"]), ["d", "a", "c", "b"]);
    // Premier rangement : l'ordre affiché devient l'ordre choisi.
    assert.deepEqual(orderAfterDrag(["b", "a"], []), ["b", "a"]);
  });

  test("Ondine regarde la première carte urgente, sinon aucune", () => {
    assert.equal(lookTarget(arrangeCards([card("a"), card("b", 50, true)], emptyLayout())), "b");
    assert.equal(lookTarget(arrangeCards([card("a")], emptyLayout())), null);
  });
});

describe("la disposition, par profil", () => {
  test("une valeur abîmée devient une disposition valide", () => {
    assert.deepEqual(cleanLayout(null), emptyLayout());
    assert.deepEqual(cleanLayout({ order: ["media", 3, "MEDIA", "media", "../x"], hidden: "x", sizes: { media: "large", timer: "huge" } }), {
      order: ["media"],
      hidden: [],
      sizes: { media: "large" },
    });
  });

  test("chaque profil a la sienne ; sans profil : « base »", () => {
    assert.equal(layoutKey(""), "base");
    assert.equal(layoutKey(undefined), "base");
    assert.equal(layoutKey("p1abc"), "p1abc");
    let all = withLayout({}, "base", { ...emptyLayout(), order: ["media"] });
    all = withLayout(all, "ptravail", { ...emptyLayout(), hidden: ["media"] });
    assert.deepEqual(layoutFor(all, "base").order, ["media"]);
    assert.deepEqual(layoutFor(all, "ptravail").hidden, ["media"]);
    // Un profil qui n'a encore rien rangé part de zéro.
    assert.deepEqual(layoutFor(all, "pmaison"), emptyLayout());
  });

  test("au plus 12 dispositions : les plus anciennes s'en vont, jamais celle qu'on écrit", () => {
    let all: Record<string, unknown> = {};
    for (let i = 0; i < 15; i++) all = withLayout(all, `p${i}`, emptyLayout());
    assert.equal(Object.keys(all).length, 12);
    assert.ok("p14" in all);
    assert.ok(!("p0" in all));
  });
});

describe("la phrase d'Ondine", () => {
  test("le salut suit le moment et le prénom", () => {
    assert.equal(greeting("morning", "Simon"), "Bonjour, Simon.");
    assert.equal(greeting("day", ""), "Bon après-midi.");
    assert.equal(greeting("evening", "  "), "Bonsoir.");
  });

  test("au plus 3 morceaux, sans vide ni doublon, dans l'ordre des cartes", () => {
    const p = composePhrase("morning", "", ["3 rendez-vous aujourd'hui", null, "", "Claude a fini", "3 rendez-vous aujourd'hui", "12° dehors", "1 tâche à faire"]);
    assert.equal(p.parts.length, PHRASE_PARTS);
    assert.deepEqual(p.parts, ["3 rendez-vous aujourd'hui", "Claude a fini", "12° dehors"]);
  });

  test("chaque morceau que les modules fabriquent a sa traduction anglaise", () => {
    const en = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };
    const ok = (s: string) => s in en.exact || en.patterns.some(([rx]) => new RegExp(rx).test(s));
    for (const s of [
      "Bonjour, Simon.",
      "Bon après-midi.",
      "Bonsoir, Léa.",
      "3 rendez-vous aujourd'hui",
      "2 rendez-vous demain",
      "réunion dans 8 min",
      "Claude vous attend",
      "Codex travaille",
      "Gemini a fini",
      "21° dehors",
      "-3° dehors",
      "batterie à 12 %",
      "encore 18 min de minuteur",
      "4 tâches à faire",
      "1 tâche à faire",
    ]) {
      assert.ok(ok(s), s);
    }
  });
});

describe("la carte « Reprendre »", () => {
  test("les 3 plus récentes, rien de plus vieux qu'une semaine", () => {
    const now = 1_000_000_000_000;
    const day = 86_400_000;
    const items = [{ at: now - day }, null, { at: now - 8 * day }, { at: now - 60_000 }, { at: now - 2 * day }, { at: now - 3 * day }];
    assert.deepEqual(
      pickResume(items, now).map((x) => x.at),
      [now - 60_000, now - day, now - 2 * day],
    );
  });
});

describe("les actions rapides", () => {
  test("celles choisies, sans doublon ni « aucune », module allumé, 4 au plus", () => {
    const on = (id: string) => id !== "terminal";
    assert.deepEqual(
      pickQuickActions(["capture", "none", "capture", "terminal", "note", "timer25", "askclaude"], on).map((a) => a.id),
      ["capture", "note", "timer25", "askclaude"],
    );
  });

  test("le catalogue correspond aux choix du manifeste, et chaque bouton est traduit", () => {
    const manifest = JSON.parse(readFileSync("src/modules/home/manifest.json", "utf8")) as { settings: { fields: { key: string; options?: { value: string }[] }[] } };
    const en = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string> };
    for (const key of ["action1", "action2", "action3", "action4"]) {
      const field = manifest.settings.fields.find((f) => f.key === key)!;
      const values = field.options!.map((o) => o.value).filter((v) => v !== "none");
      assert.deepEqual(values.sort(), QUICK_ACTIONS.map((a) => a.id).sort(), key);
    }
    for (const a of QUICK_ACTIONS) assert.ok(a.label === "Notes" || en.exact[a.label], a.label);
  });
});

describe("l'Accueil dans la rangée d'onglets", () => {
  const id = (x: string) => x;
  test("nouvelle installation : l'ordre des modules, l'Accueil en premier", () => {
    const modules = readFileSync("src/modules/index.ts", "utf8");
    assert.match(modules, /ALL_MODULES: IslandModule\[\] = \[home, askclaude,/);
  });

  test("île déjà rangée : l'Accueil se met en tête sans bousculer le reste", () => {
    assert.deepEqual(LEAD_TABS, ["home"]);
    assert.deepEqual(applyTabOrder(["home", "askclaude", "shelf", "notes"], id, ["notes", "shelf", "askclaude"]), ["home", "notes", "shelf", "askclaude"]);
  });

  test("une fois glissé ailleurs, il garde la place choisie", () => {
    const all = applyTabOrder(["home", "askclaude", "shelf"], id, ["shelf", "askclaude"]);
    const saved = mergeOrder(["shelf", "home", "askclaude"], all);
    assert.deepEqual(saved, ["shelf", "home", "askclaude"]);
    assert.deepEqual(applyTabOrder(["home", "askclaude", "shelf"], id, saved), ["shelf", "home", "askclaude"]);
  });

  test("les clés des cartes : l'id du module, ou module.carte", () => {
    assert.equal(homeCardKey("media"), "media");
    assert.equal(homeCardKey("media", "media"), "media");
    assert.equal(homeCardKey("agents", "reprise"), "agents.reprise");
  });
});
