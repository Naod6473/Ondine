// Tests de l'assistant de premier lancement et des propositions d'onglets
// (src/core/setup-plan.ts) : les cartes et leurs vrais modules, la
// pré-sélection d'après les logiciels, le plan des onglets, les profils, le
// prénom, et les règles des propositions (onglet oublié, bon moment).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  APP_CARDS,
  BASE_TABS,
  cardsFromApps,
  cleanFirstName,
  dayNumber,
  HIDE_AFTER_DAYS,
  helloText,
  HINTS,
  hintWanted,
  MINIMAL_TABS,
  NEVER_TOUCHED,
  planFromCards,
  profilesFromCards,
  SETUP_CARDS,
  staleTab,
  tabsForCards,
  withSuggested,
} from "../../src/core/setup-plan";

/** Les modules réels et ceux qui ont un onglet (vue « expanded »), d'après leurs manifestes. */
const MANIFESTS = readdirSync("src/modules", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => JSON.parse(readFileSync(join("src/modules", d.name, "manifest.json"), "utf8")) as { id: string; views: string[] });
const TABS = MANIFESTS.filter((m) => m.views.includes("expanded")).map((m) => m.id);

describe("les cartes", () => {
  test("chaque carte n'allume que de vrais onglets, jamais Équipe", () => {
    for (const card of SETUP_CARDS) {
      assert.ok(card.modules.length >= 3, card.id);
      for (const id of card.modules) {
        assert.ok(TABS.includes(id), `${card.id} : ${id} n'est pas un module à onglet`);
        assert.ok(!NEVER_TOUCHED.includes(id), `${card.id} : ${id}`);
      }
    }
    for (const id of [...BASE_TABS, ...MINIMAL_TABS]) assert.ok(TABS.includes(id), id);
    assert.equal(MINIMAL_TABS.length, 3);
  });

  test("les cartes et leurs textes sont traduits", () => {
    const en = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string> };
    for (const card of SETUP_CARDS) {
      for (const text of [card.label, card.desc, card.profile].filter(Boolean) as string[]) assert.ok(en.exact[text], text);
    }
    for (const h of Object.values(HINTS)) for (const text of [h.title, h.body]) assert.ok(en.exact[text], text);
  });

  test("les logiciels trouvés pré-cochent la bonne carte, dans l'ordre des cartes", () => {
    assert.deepEqual(cardsFromApps(["spotify", "vscode", "claude"]), ["dev", "music"]);
    assert.deepEqual(cardsFromApps(["teams", "putty"]), ["it", "meetings"]);
    assert.deepEqual(cardsFromApps(["inconnu"]), []);
    assert.deepEqual(cardsFromApps([]), []);
    for (const card of Object.values(APP_CARDS)) assert.ok(SETUP_CARDS.some((c) => c.id === card), card);
  });

  test("chaque id de logiciel du Rust a sa carte", () => {
    const rust = readFileSync("src-tauri/src/services/apps.rs", "utf8");
    const block = rust.slice(rust.indexOf("const APPS"), rust.indexOf("const PROGRAMS"));
    const ids = [...block.matchAll(/^\s*\("([a-z]+)", &\[/gm)].map((m) => m[1]);
    assert.ok(ids.length > 10, "la liste du Rust n'a pas été lue");
    for (const id of ids) assert.ok(APP_CARDS[id], `${id} : pas de carte dans APP_CARDS`);
  });
});

describe("le plan des onglets", () => {
  test("aucune carte : l'île minimale", () => {
    assert.deepEqual(tabsForCards([], TABS), [...MINIMAL_TABS]);
  });

  test("Parler à Ondine d'abord, puis les onglets des cartes dans l'ordre coché, sans doublon", () => {
    const ids = tabsForCards(["study", "office"], TABS);
    assert.equal(ids[0], "askclaude");
    assert.deepEqual(ids.slice(1, 4), ["notes", "timer", "agenda"]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("le reste est éteint, Équipe n'est pas touché, l'ordre est complet", () => {
    const plan = planFromCards(["dev"], TABS);
    assert.equal(plan.modules.agents, true);
    assert.equal(plan.modules.media, false);
    assert.equal("team" in plan.modules, false);
    assert.deepEqual([...plan.order].sort(), [...TABS].sort());
    assert.deepEqual(plan.order.slice(0, 2), ["askclaude", "agents"]);
  });

  test("un id inconnu (module retiré) est ignoré", () => {
    assert.deepEqual(tabsForCards(["office"], ["askclaude", "notes"]), ["askclaude", "notes"]);
  });
});

describe("les profils des cartes", () => {
  test("une seule carte : pas de profil", () => {
    assert.deepEqual(profilesFromCards(["office"], TABS, []), []);
  });
  test("plusieurs cartes : un profil par carte, sauf un nom déjà pris", () => {
    const p = profilesFromCards(["office", "music"], TABS, ["maison"]);
    assert.deepEqual(
      p.map((x) => x.name),
      ["Travail"],
    );
    assert.equal(p[0].modules.shelf, true);
    assert.equal(p[0].modules.media, false);
    assert.equal(p[0].tabOrder[0], "askclaude");
  });
});

describe("le prénom", () => {
  test("nettoyé comme le Rust : sans contrôle, 40 caractères, sans espaces autour", () => {
    assert.equal(cleanFirstName("  Si\u0007mon \n"), "Simon");
    assert.equal(cleanFirstName("é".repeat(60)).length, 40);
    assert.equal(cleanFirstName(""), "");
  });
  test("bonjour, avec ou sans prénom", () => {
    assert.equal(helloText("Simon"), "Bonjour Simon !");
    assert.equal(helloText(""), "Bonjour !");
    assert.equal(helloText(undefined), "Bonjour !");
  });
});

describe("les propositions", () => {
  const today = 20_500;
  const shown = ["askclaude", "shelf", "notes", "timer", "media"];

  test("un onglet jamais ouvert depuis 3 semaines", () => {
    const prefs = { usageSince: today - 30, tabSeenAt: { askclaude: today, shelf: today - 2, notes: today - 25 } };
    assert.equal(staleTab(shown, prefs, today), "notes");
    // Déjà proposé : le suivant.
    assert.equal(staleTab(shown, { ...prefs, suggested: ["hide-notes"] }, today), "timer");
  });

  test("le compte part de la fin de l'assistant", () => {
    assert.equal(staleTab(shown, { usageSince: today - HIDE_AFTER_DAYS + 1 }, today), null);
    assert.equal(staleTab(shown, { usageSince: today - HIDE_AFTER_DAYS }, today), "askclaude");
    assert.equal(staleTab(shown, { usageSince: 0 }, today), null);
  });

  test("jamais avec 3 onglets ou moins, ni propositions coupées", () => {
    assert.equal(staleTab(["a", "b", "c"], { usageSince: 1 }, today), null);
    assert.equal(staleTab(shown, { usageSince: 1, suggestions: false }, today), null);
  });

  test("le bon moment : une fois, onglet éteint, après l'assistant", () => {
    assert.equal(hintWanted("drop", {}, false, true), true);
    assert.equal(hintWanted("drop", { suggested: ["drop"] }, false, true), false);
    assert.equal(hintWanted("drop", {}, true, true), false);
    assert.equal(hintWanted("drop", {}, false, false), false);
    assert.equal(hintWanted("drop", { suggestions: false }, false, true), false);
    assert.equal(hintWanted("inconnu", {}, false, true), false);
    for (const h of Object.values(HINTS)) assert.ok(TABS.includes(h.module), h.module);
  });

  test("la liste des propositions faites", () => {
    assert.deepEqual(withSuggested([], "usb"), ["usb"]);
    assert.deepEqual(withSuggested(["usb"], "usb"), ["usb"]);
    assert.equal(withSuggested(Array.from({ length: 64 }, (_, i) => `hide-m${i}`), "drop").length, 64);
  });

  test("le numéro du jour suit l'heure locale", () => {
    const a = new Date(2026, 9, 10, 0, 5).getTime();
    const b = new Date(2026, 9, 10, 23, 55).getTime();
    assert.equal(dayNumber(a), dayNumber(b));
    assert.equal(dayNumber(b) + 1, dayNumber(new Date(2026, 9, 11, 0, 5).getTime()));
  });
});
