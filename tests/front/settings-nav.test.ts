// Tests de la navigation des Réglages en deux colonnes (1.2.4) :
// src/settings/nav-logic.ts (les colonnes, le fil d'Ariane, le sens du
// mouvement, la pastille qui glisse) et src/settings/nav-history.ts (le
// bouton « retour » de la souris, Alt+← et Alt+→).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAV_GROUPS } from "../../src/settings/layout";
import { column2, crumbs, direction, glideFrames, IOS_EASE, pageForRubric, pagesOf, rubricCounts, rubricOf, RUBRIC_ICONS, type NavPage } from "../../src/settings/nav-logic";
import { NavHistory, samePlace } from "../../src/settings/nav-history";

const PAGES: NavPage[] = [
  { id: "general", group: "Ondine", label: "Général", subs: [] },
  { id: "voice:dictation", group: "Voix", label: "Dictée", subs: [] },
  { id: "look", group: "L'île", label: "Apparence", subs: [] },
  { id: "animations", group: "L'île", label: "Animations et halos", subs: [{ id: "day", label: "Le jour" }, { id: "night", label: "La nuit" }] },
  { id: "module:agents", group: "Modules", label: "Agents IA", category: "ai", subs: [{ id: "a", label: "Profil A" }, { id: "b", label: "Profil B" }] },
  { id: "module:askclaude", group: "Modules", label: "Demander", category: "ai", subs: [] },
  { id: "module:timer", group: "Modules", label: "Minuteur", category: "time", subs: [] },
  { id: "perf", group: "Système", label: "Performances", subs: [] },
  { id: "about", group: "À propos", label: "À propos", subs: [{ id: "ondine", label: "Version et nouveautés" }, { id: "demo", label: "Captures d'écran" }] },
];

describe("les rubriques (1re colonne)", () => {
  test("chaque rubrique a son icône, et le compte de ses pages", () => {
    for (const g of NAV_GROUPS) assert.ok(RUBRIC_ICONS[g], g);
    const n = rubricCounts(PAGES);
    assert.equal(n["L'île"], 2);
    assert.equal(n.Modules, 3);
    assert.equal(n.Automatiser, 0);
  });

  test("la rubrique d'une page, et les pages d'une rubrique dans l'ordre", () => {
    assert.equal(rubricOf("animations", PAGES), "L'île");
    assert.equal(rubricOf("rien", PAGES), undefined);
    assert.deepEqual(pagesOf("L'île", PAGES).map((p) => p.id), ["look", "animations"]);
  });

  test("choisir une rubrique rouvre la dernière page vue, sinon la première", () => {
    assert.equal(pageForRubric("L'île", PAGES, {}), "look");
    assert.equal(pageForRubric("L'île", PAGES, { "L'île": "animations" }), "animations");
    assert.equal(pageForRubric("L'île", PAGES, { "L'île": "page-disparue" }), "look");
    assert.equal(pageForRubric("Automatiser", PAGES, {}), undefined);
  });

  test("la 1re colonne ne déplie rien : main.ts n'y met que les rubriques", () => {
    const main = readFileSync("src/settings/main.ts", "utf8");
    assert.match(main, /for \(const g of NAV_GROUPS\)/);
  });
});

describe("la 2e colonne", () => {
  test("Modules : les pages sous les titres de leur catégorie", () => {
    const items = column2("Modules", PAGES, "module:timer", null);
    assert.deepEqual(items.map((i) => i.kind), ["cat", "page", "page", "cat", "page"]);
    assert.equal(items.filter((i) => i.kind === "cat").length, 2);
  });

  test("les sous-menus de la page affichée se déplient juste sous elle, et seulement les siens", () => {
    const items = column2("Modules", PAGES, "module:agents", "b");
    const kinds = items.map((i) => (i.kind === "sub" ? `sub:${i.sub}${i.current ? "*" : ""}` : i.kind === "page" ? `page:${i.page}${i.open ? "+" : ""}` : "cat"));
    assert.deepEqual(kinds, ["cat", "page:module:agents+", "sub:a", "sub:b*", "page:module:askclaude", "cat", "page:module:timer"]);
  });

  test("une page sans sous-menu n'est pas « ouverte »", () => {
    const page = column2("L'île", PAGES, "look", null).find((i) => i.kind === "page" && i.page === "look");
    assert.ok(page && page.kind === "page" && page.current && !page.open);
  });
});

describe("le fil d'Ariane", () => {
  test("Rubrique › Page › Sous-menu ; le dernier morceau ne mène nulle part", () => {
    const c = crumbs({ page: "animations", sub: "night" }, PAGES);
    assert.deepEqual(c.map((x) => x.label), ["L'île", "Animations et halos", "La nuit"]);
    assert.deepEqual(c[0].to, { page: "look", sub: null });
    assert.deepEqual(c[1].to, { page: "animations", sub: "day" });
    assert.equal(c[2].to, undefined);
  });

  test("une page qui porte le nom de sa rubrique n'est pas répétée", () => {
    assert.deepEqual(crumbs({ page: "about", sub: "demo" }, PAGES).map((x) => x.label), ["À propos", "Captures d'écran"]);
  });

  test("un lien vers la place où l'on est déjà ne mène nulle part", () => {
    const c = crumbs({ page: "look", sub: null }, PAGES);
    assert.deepEqual(c.map((x) => x.to), [undefined, undefined]);
  });

  test("un nom choisi par l'utilisateur (un profil) n'est pas traduit", () => {
    const c = crumbs({ page: "module:agents", sub: "a" }, PAGES, ["a"]);
    assert.equal(c[c.length - 1].plain, true);
  });

  test("une page inconnue : pas de fil", () => {
    assert.deepEqual(crumbs({ page: "rien" }, PAGES), []);
  });
});

describe("le sens du mouvement", () => {
  test("plus loin dans l'ordre : la page arrive de la droite ; en arrière : de la gauche", () => {
    assert.equal(direction({ page: "general" }, { page: "look" }, PAGES), 1);
    assert.equal(direction({ page: "animations" }, { page: "look" }, PAGES), -1);
    assert.equal(direction({ page: "animations", sub: "day" }, { page: "animations", sub: "night" }, PAGES), 1);
    assert.equal(direction({ page: "animations", sub: "night" }, { page: "animations", sub: "day" }, PAGES), -1);
  });

  test("même place, ou première ouverture : elle se pose sur place", () => {
    assert.equal(direction({ page: "look" }, { page: "look" }, PAGES), 0);
    assert.equal(direction(null, { page: "look" }, PAGES), 0);
  });
});

describe("la pastille qui glisse comme une goutte", () => {
  test("quatre étapes, de la ligne de départ à celle d'arrivée", () => {
    const g = glideFrames({ y: 0, h: 36 }, { y: 120, h: 36 });
    assert.ok(g);
    assert.deepEqual(g.frames.map((f) => f.offset), [0, 0.38, 0.72, 1]);
    assert.deepEqual(g.frames[0], { y: 0, h: 36, scaleX: 1, offset: 0 });
    assert.deepEqual(g.frames[3], { y: 120, h: 36, scaleX: 1, offset: 1 });
    // Elle s'étire en filant, et s'écrase un peu en arrivant.
    assert.ok(g.frames[1].h > 36 && g.frames[1].scaleX < 1);
    assert.ok(g.frames[2].h < 36 && g.frames[2].scaleX > 1);
  });

  test("plus le trajet est long, plus elle prend son temps (sans traîner)", () => {
    const short = glideFrames({ y: 0, h: 36 }, { y: 40, h: 36 })!;
    const long = glideFrames({ y: 0, h: 36 }, { y: 400, h: 36 })!;
    assert.ok(long.duration > short.duration);
    assert.ok(glideFrames({ y: 0, h: 36 }, { y: 4000, h: 36 })!.duration <= 620);
  });

  test("vers le haut aussi, et rien à animer sur place", () => {
    const up = glideFrames({ y: 200, h: 36 }, { y: 40, h: 36 })!;
    assert.equal(up.frames[3].y, 40);
    assert.equal(glideFrames({ y: 40, h: 36 }, { y: 40, h: 36 }), null);
  });

  test("la courbe d'iOS", () => {
    assert.equal(IOS_EASE, "cubic-bezier(0.32, 0.72, 0, 1)");
  });
});

describe("l'historique (retour, suivant)", () => {
  test("retour puis suivant ramènent aux mêmes places", () => {
    const h = new NavHistory();
    h.visit({ page: "general" });
    h.visit({ page: "look" });
    h.visit({ page: "animations", sub: "night" });
    assert.ok(h.canBack && !h.canForward);
    assert.deepEqual(h.goBack(), { page: "look", sub: null });
    assert.deepEqual(h.goBack(), { page: "general", sub: null });
    assert.equal(h.goBack(), null);
    assert.deepEqual(h.goForward(), { page: "look", sub: null });
    assert.deepEqual(h.current, { page: "look", sub: null });
  });

  test("aller ailleurs après un retour oublie ce qu'on pouvait « avancer »", () => {
    const h = new NavHistory();
    h.visit({ page: "general" });
    h.visit({ page: "look" });
    h.goBack();
    h.visit({ page: "perf" });
    assert.equal(h.canForward, false);
    assert.equal(h.goForward(), null);
  });

  test("la même place deux fois ne compte qu'une fois", () => {
    const h = new NavHistory();
    h.visit({ page: "look" });
    h.visit({ page: "look", sub: null });
    assert.equal(h.canBack, false);
  });

  test("une place disparue est oubliée, et l'historique reste borné", () => {
    const h = new NavHistory(3);
    for (const p of ["a", "b", "c", "d", "e"]) h.visit({ page: p });
    h.forget((p) => p.page !== "c");
    const back: string[] = [];
    for (let p = h.goBack(); p; p = h.goBack()) back.push(p.page);
    assert.deepEqual(back, ["d", "b"]);
  });

  test("samePlace", () => {
    assert.ok(samePlace({ page: "a" }, { page: "a", sub: null }));
    assert.ok(!samePlace({ page: "a", sub: "x" }, { page: "a" }));
    assert.ok(!samePlace(null, { page: "a" }));
  });
});
