// Tests du menu de fichiers (1.2.5) : les choix d'un dépôt, le dépôt mixte,
// les favoris (src/island/drop-menu-logic.ts, drop-pills-logic.ts), la place
// du petit rond « Étagère » à côté de l'île (drop-shelf-logic.ts) et la
// géométrie du cercle d'Ondine sur le bureau (src/pet/ring-layout.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pillsFor } from "../../src/modules/convert/convert-logic";
import {
  buildMenu,
  DEAD_REASONS,
  FAV_OFF,
  itemKinds,
  OFF_REASONS,
  offReason,
  parseMenuMessage,
  rowForKeys,
  typeTag,
  type MenuTarget,
} from "../../src/island/drop-menu-logic";
import { defaultLayout, effectiveLayout, MAX_FAVS, moveFav, parseLayout, serialize, setShown, toggleFav } from "../../src/island/drop-pills-logic";
import { mergePlan, shelfPlace } from "../../src/island/drop-shelf-logic";
import { favSpots, hitSpot, motherSpot, MOTHER_ANGLE, RING, ringExtent, shelfSpot, subSpots, SUBS_MAX } from "../../src/pet/ring-layout";

const TARGETS: MenuTarget[] = [
  { id: "shelf-add", label: "Étagère", icon: "🧺" },
  { id: "shelf-copy", label: "Copier vers…", icon: "📄" },
  { id: "shelf-move", label: "Déplacer vers…", icon: "📦" },
  { id: "shelf-fav-0", label: "Projets", icon: "📁" },
  { id: "shelf-trash", label: "Corbeille", icon: "🗑️" },
  { id: "shelf-rename", label: "Renommer…", icon: "✏️" },
  { id: "shelf-path", label: "Copier le chemin", icon: "📋" },
  { id: "shelf-hash", label: "Empreinte", icon: "#️⃣" },
  { id: "shelf-images", label: "Redimensionner…", icon: "📏" },
  { id: "shelf-zip", label: "Compresser", icon: "🗜️" },
  { id: "askclaude-drop", label: "Parler à Ondine", icon: "💬" },
  { id: "terminal-here", label: "Terminal ici", icon: "🖥️" },
];

function menuFor(paths: string[], dirs?: (boolean | null)[], layout = defaultLayout()) {
  const offer = pillsFor(paths);
  return buildMenu({ paths, dirs, formats: offer ? offer.pills.map((p) => p.id) : null, targets: TARGETS, layout });
}
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const live = (items: { id: string; off: string | null }[]) => items.filter((i) => !i.off).map((i) => i.id);

describe("les choix d'un dépôt", () => {
  test("une photo : les formats d'abord, Redimensionner, pas de doublon ZIP", () => {
    const m = menuFor(["C:\\photos\\vacances.png"], [false]);
    assert.equal(m.mixed, false);
    assert.equal(m.open, "convert");
    assert.deepEqual(ids(m.groups.convert).slice(0, 3), ["jpg", "webp", "pdf"], "pas de PNG pour un PNG");
    assert.ok(ids(m.groups.convert).includes("zip"));
    assert.ok(ids(m.groups.convert).includes("shelf-images"));
    assert.ok(!ids(m.groups.convert).includes("shelf-zip"), "Compresser = la bulle ZIP d'Ondine convertit");
    assert.deepEqual(ids(m.groups.ranger), ["shelf-add", "shelf-copy", "shelf-move", "shelf-fav-0", "shelf-trash"]);
    assert.equal(m.groups.convert.find((i) => i.id === "jpg")?.caption, "image");
    assert.equal(m.groups.convert.find((i) => i.id === "shrink")?.icon, "🪶");
    assert.ok([...m.groups.convert, ...m.groups.ranger, ...m.groups.outils].every((i) => i.off === null), "rien de grisé");
  });

  test("un dossier : le ZIP seul, ni Empreinte ni Parler à Ondine", () => {
    const m = menuFor(["C:\\Vacances"], [true]);
    assert.deepEqual(m.kinds, ["folder"]);
    assert.deepEqual(ids(m.groups.convert), ["zip"]);
    assert.ok(!ids(m.groups.outils).includes("shelf-hash"));
    assert.ok(!ids(m.groups.outils).includes("askclaude-drop"));
    assert.ok(ids(m.groups.outils).includes("terminal-here"));
  });

  test("conversion coupée : « Compresser » de l'Étagère devient la bulle ZIP", () => {
    const m = buildMenu({ paths: ["a.png"], formats: null, targets: TARGETS, layout: defaultLayout() });
    const zip = m.groups.convert.find((i) => i.id === "shelf-zip");
    assert.equal(zip?.label, "ZIP");
    assert.equal(zip?.caption, "archive");
  });

  test("les réglages : pilule masquée absente, ordre des lignes suivi", () => {
    const layout = setShown(defaultLayout(), "shelf-copy", false);
    const m = menuFor(["a.png"], [false], layout);
    assert.ok(!ids(m.groups.ranger).includes("shelf-copy"));
  });

  test("le type deviné avant la réponse du Rust : sans extension, un dossier", () => {
    assert.deepEqual(itemKinds(["C:\\a\\photo.jpg", "C:\\a\\Dossier"]), ["image", "folder"]);
    assert.deepEqual(itemKinds(["C:\\a\\x.v2"], [true]), ["folder"]);
    assert.equal(typeTag(["C:\\a\\photo.jpeg"], ["image"]), "JPEG");
    assert.equal(typeTag(["C:\\a\\Vacances"], ["folder"]), "Dossier");
    assert.equal(typeTag(["a.png", "b"], ["image", "folder"]), "2 éléments");
  });

  test("Ctrl ouvre Outils, Alt ouvre Ranger, les deux ou aucune : rien", () => {
    assert.equal(rowForKeys(true, false), "outils");
    assert.equal(rowForKeys(false, true), "ranger");
    assert.equal(rowForKeys(true, true), null);
    assert.equal(rowForKeys(false, false), null);
  });
});

describe("le dépôt mixte", () => {
  test("des photos et un dossier : les actions communes vives, les autres grisées avec la raison", () => {
    const m = menuFor(["C:\\a\\un.png", "C:\\a\\deux.jpg", "C:\\a\\Vacances"], [false, false, true]);
    assert.equal(m.mixed, true);
    assert.deepEqual(live(m.groups.convert), ["zip"]);
    const jpg = m.groups.convert.find((i) => i.id === "jpg");
    assert.equal(jpg?.off, "Pas pour un dossier");
    assert.equal(m.groups.convert.find((i) => i.id === "shelf-images")?.off, "Pas pour un dossier");
    assert.equal(m.groups.outils.find((i) => i.id === "shelf-hash")?.off, "Pas pour un dossier");
    assert.equal(m.groups.outils.find((i) => i.id === "shelf-path")?.off, null);
    assert.deepEqual(live(m.groups.ranger), ids(m.groups.ranger), "ranger va à tout");
  });

  test("une vidéo et une image : chacune ses formats, grisés pour l'autre", () => {
    const m = menuFor(["a.mov", "b.png"], [false, false]);
    assert.equal(m.groups.convert.find((i) => i.id === "mp3")?.off, "Seulement pour les vidéos");
    assert.equal(m.groups.convert.find((i) => i.id === "webp")?.off, "Seulement pour les images");
    assert.equal(m.groups.convert.find((i) => i.id === "zip")?.off, null);
  });

  test("les raisons", () => {
    assert.equal(offReason(["image"], ["image", "folder"]), "Pas pour un dossier");
    assert.equal(offReason(["image"], ["image", "video"]), "Seulement pour les images");
    assert.equal(offReason(["image", "pdf"], ["image", "pdf", "video"]), "Pas pour tous les éléments");
    // Chaque type sait faire un PNG, mais Ondine convertit ne mélange pas les types.
    assert.equal(offReason(["image", "pdf"], ["image", "pdf"]), "Un type de fichier à la fois");
    for (const r of [...OFF_REASONS, ...DEAD_REASONS, FAV_OFF]) assert.ok(r.length > 0);
  });

  test("un groupe sans rien de vif est grisé ; on ouvre le premier qui a un choix", () => {
    const m = buildMenu({ paths: ["a.png"], formats: null, targets: [{ id: "shelf-add", label: "Étagère", icon: "🧺" }], layout: defaultLayout() });
    assert.equal(m.dead.convert, "Rien dans Convertir pour ce dépôt");
    assert.equal(m.dead.ranger, null);
    assert.equal(m.open, "ranger");
  });
});

describe("les favoris", () => {
  test("cinq au plus, retirer puis remettre, l'ordre se change", () => {
    let l = defaultLayout();
    for (const id of ["jpg", "zip", "shelf-fav-0", "shelf-trash", "pdf"]) l = toggleFav(l, id).layout;
    assert.equal(l.favs.length, MAX_FAVS);
    const full = toggleFav(l, "png");
    assert.equal(full.full, true);
    assert.deepEqual(full.layout.favs, l.favs);
    l = toggleFav(l, "zip").layout;
    assert.deepEqual(l.favs, ["jpg", "shelf-fav-0", "shelf-trash", "pdf"]);
    l = moveFav(l, "pdf", -3);
    assert.deepEqual(l.favs, ["pdf", "jpg", "shelf-fav-0", "shelf-trash"]);
    assert.equal(toggleFav(l, "<script>").layout, l);
  });

  test("gardés dans la disposition ; une disposition 1.2.4 (sans favoris) n'en a aucun", () => {
    const l = toggleFav(defaultLayout(), "webp").layout;
    assert.deepEqual(parseLayout(serialize(l))?.favs, ["webp"]);
    const old = { v: 1, order: { convert: [], ranger: [], outils: [] }, hidden: ["ico"] };
    assert.deepEqual(parseLayout(old)?.favs, []);
    assert.deepEqual(effectiveLayout(undefined, { showTrash: false }).favs, []);
    assert.deepEqual(parseLayout({ ...old, favs: ["a", "b", "c", "d", "e", "f", "a", 3] })?.favs, ["a", "b", "c", "d", "e"]);
  });

  test("dans le menu : vifs s'ils vont, grisés sinon, oubliés si le module est coupé", () => {
    let layout = defaultLayout();
    for (const id of ["webp", "mp3", "shelf-fav-0", "team-ab12"]) layout = toggleFav(layout, id).layout;
    const m = menuFor(["a.png"], [false], layout);
    assert.deepEqual(ids(m.favs), ["webp", "mp3", "shelf-fav-0"]);
    assert.equal(m.favs[0].off, null);
    assert.equal(m.favs[1].off, FAV_OFF);
    assert.equal(m.favs[1].label, "MP3");
  });
});

describe("le petit rond « Étagère » à côté de l'île", () => {
  const win = { w: 720, h: 320 };
  const pill = { w: 112, h: 36 };

  test("en haut : sous l'île, au bout droit ; en bas : au-dessus", () => {
    const top = shelfPlace({ x: 10, y: 0, w: 700, h: 220 }, pill, win, "top", "center");
    assert.equal(top.side, "below");
    assert.ok(top.y >= 220 && top.y + pill.h <= win.h);
    assert.ok(top.x + pill.w <= 710 && top.x > 500);
    const bottom = shelfPlace({ x: 10, y: 100, w: 700, h: 220 }, pill, win, "bottom", "center");
    assert.equal(bottom.side, "above");
    assert.ok(bottom.y + pill.h <= 100);
  });

  test("à côté quand la fenêtre a la place (île étroite, collée à gauche)", () => {
    const p = shelfPlace({ x: 0, y: 0, w: 560, h: 200 }, pill, win, "top", "start");
    assert.equal(p.side, "beside");
    assert.ok(p.x >= 560 && p.x + pill.w <= win.w);
  });

  test("sur un côté : sous l'île, vers le centre de l'écran ; sans place, au-dessus", () => {
    const side = { w: 720, h: 380 };
    const left = shelfPlace({ x: 0, y: 60, w: 700, h: 260 }, pill, side, "left", "center");
    assert.equal(left.side, "below");
    assert.ok(left.x + pill.w <= 700);
    const right = shelfPlace({ x: 20, y: 0, w: 700, h: 330 }, pill, side, "right", "start");
    assert.ok(right.x >= 20 && right.x < 200, "côté gauche de l'île (vers le centre)");
    const full = shelfPlace({ x: 10, y: 0, w: 700, h: 380 }, pill, side, "left", "start");
    assert.equal(full.side, "inside");
  });

  test("la fusion : vers l'île, le rond rétrécit et s'efface", () => {
    // Île en haut : la pilule remonte vers le milieu du bord haut de l'île.
    const plan = mergePlan({ x: 500, y: 230, side: "below" }, { x: 10, y: 0, w: 700, h: 220 }, pill, "top");
    assert.ok(plan.dy < 0, "remonte vers l'île");
    assert.ok(plan.dx < 0, "vers le milieu de l'île");
    assert.equal(230 + pill.h / 2 + plan.dy, 24);
    // Île en bas : elle descend.
    const above = mergePlan({ x: 500, y: 40, side: "above" }, { x: 10, y: 100, w: 700, h: 220 }, pill, "bottom");
    assert.ok(above.dy > 0);
    // Île à gauche : elle part vers la gauche.
    assert.ok(mergePlan({ x: 300, y: 400, side: "below" }, { x: 0, y: 0, w: 360, h: 380 }, pill, "left").dx < 0);
  });
});

describe("le cercle d'Ondine sur le bureau", () => {
  test("Convertir en haut, Outils à gauche, Ranger à droite", () => {
    assert.deepEqual(MOTHER_ANGLE, { convert: -90, outils: 180, ranger: 0 });
    assert.ok(motherSpot("convert").y < 0 && Math.abs(motherSpot("convert").x) < 1);
    assert.ok(motherSpot("outils").x < 0);
    assert.ok(motherSpot("ranger").x > 0);
  });

  test("les choix dans l'arc de leur bulle mère, une deuxième rangée au-delà de six", () => {
    const six = subSpots("convert", 6);
    assert.ok(six.every((s) => s.ring === 1 && s.y < 0));
    const eleven = subSpots("convert", 11);
    assert.equal(eleven.filter((s) => s.ring === 2).length, 5);
    for (const s of eleven) {
      const r = Math.hypot(s.x, s.y);
      assert.ok(Math.abs(r - (s.ring === 1 ? RING.r2 : RING.r3)) < 1);
    }
    // Centrés sur l'angle de la mère.
    const mid = (subSpots("ranger", 3)[1]);
    assert.ok(Math.abs(mid.y) < 1 && mid.x > 0);
    assert.equal(subSpots("outils", 40).length, SUBS_MAX);
  });

  test("aucune bulle ne se chevauche, quel que soit le groupe ouvert", () => {
    for (const row of ["convert", "outils", "ranger"] as const) {
      const shapes = [
        { ...{ x: 0, y: 0 }, d: RING.core },
        ...(["convert", "outils", "ranger"] as const).map((r) => ({ ...motherSpot(r), d: RING.mother })),
        ...favSpots(5).map((s) => ({ ...s, d: RING.fav })),
        { ...shelfSpot(), d: RING.shelf },
        ...subSpots(row, SUBS_MAX).map((s) => ({ ...s, d: RING.sub })),
      ];
      for (let i = 0; i < shapes.length; i++)
        for (let j = i + 1; j < shapes.length; j++) {
          const a = shapes[i];
          const b = shapes[j];
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= (a.d + b.d) / 2 - 0.5, `${row} : ${i} et ${j} se touchent`);
        }
    }
  });

  test("la pilule d'option sous le centre ne touche pas les favoris", () => {
    for (const f of favSpots(5)) {
      // La pilule fait au plus 170 × 28.
      const nx = Math.max(-85, Math.min(85, f.x));
      const ny = Math.max(RING.optY - 14, Math.min(RING.optY + 14, f.y));
      assert.ok(Math.hypot(f.x - nx, f.y - ny) >= RING.fav / 2, "favori sur la pilule");
    }
  });

  test("tout tient dans la fenêtre du cercle (RING_SIZE de pet.rs)", () => {
    assert.ok(ringExtent() * 2 <= RING.size);
    const rust = readFileSync("src-tauri/src/pet.rs", "utf8");
    assert.match(rust, new RegExp(`RING_SIZE: f64 = ${RING.size}\\.0`));
  });

  test("les favoris se lisent de gauche à droite", () => {
    const f = favSpots(3);
    assert.ok(f[0].x < f[1].x && f[1].x < f[2].x);
    assert.ok(f.every((s) => s.y > 0), "en bas");
  });

  test("la bulle sous le pointeur", () => {
    const spots = subSpots("convert", 3);
    assert.equal(hitSpot(spots, RING.sub, spots[2].x + 10, spots[2].y - 5), 2);
    assert.equal(hitSpot(spots, RING.sub, 0, 0), -1);
  });
});

describe("le message vers Ondine sur le bureau", () => {
  test("relu sans se fier à l'autre fenêtre", () => {
    assert.equal(parseMenuMessage(null), null);
    assert.equal(parseMenuMessage({ id: "1" }), null);
    assert.equal(parseMenuMessage({ id: 1, menu: { groups: { convert: [] } } }), null);
    const m = menuFor(["a.png"], [false]);
    assert.ok(parseMenuMessage({ id: 1, title: "a.png", meta: "", tag: "PNG", option: true, dest: "keep", menu: m, shelf: 2, says: {} }));
  });
});

describe("les traductions", () => {
  test("chaque phrase du menu a sa traduction anglaise et tutoyée", () => {
    const en = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };
    const tu = JSON.parse(readFileSync("src/core/i18n-fr-tu.json", "utf8")) as Record<string, unknown>;
    const has = (fr: string) => fr in en.exact || en.patterns.some(([rx]) => new RegExp(rx).test(fr));
    const missing = [...OFF_REASONS, ...DEAD_REASONS, FAV_OFF, "image", "document", "archive", "plus léger", "le contenu", "vidéo", "son", "un seul fichier"].filter((s) => !has(s));
    assert.deepEqual(missing, []);
    assert.ok(tu, "fichier tutoyé lisible");
  });
});
