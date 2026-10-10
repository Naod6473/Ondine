// Tests du mode Simple / Complet des réglages (src/settings/visibility.ts) :
// quels champs sont visibles selon le mode, et le compte « N de plus ».

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleManifest, SettingField } from "../../src/core/module-types";
import {
  fieldIsEssential,
  hiddenCount,
  ISLAND_ESSENTIALS,
  isHidden,
  modeOf,
  MODULE_ESSENTIALS,
  moduleEssentialKeys,
  moreText,
  pageEssentials,
  visibleFields,
  WHOLE_PAGE,
} from "../../src/settings/visibility";

const FIELDS: SettingField[] = [
  { key: "city", type: "string", label: "Votre ville", default: "", essential: true },
  { key: "unit", type: "select", label: "Unité", default: "c", options: [{ value: "c", label: "°C" }] },
  { key: "showCompact", type: "boolean", label: "Dans la mini-île", default: false },
];

/** Tous les manifestes des modules, lus sur le disque. */
function manifests(): ModuleManifest[] {
  const dir = "src/modules";
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(join(dir, d.name, "manifest.json"), "utf8")) as ModuleManifest);
}

describe("modeOf", () => {
  test("Simple par défaut, même pour un réglage absent ou inconnu", () => {
    assert.equal(modeOf(undefined), "simple");
    assert.equal(modeOf("expert"), "simple");
    assert.equal(modeOf("simple"), "simple");
    assert.equal(modeOf("full"), "full");
  });
});

describe("champs d'un module", () => {
  test("en Complet, tous les champs ; en Simple, les essentiels seulement, dans l'ordre", () => {
    assert.deepEqual(visibleFields("full", "weather", FIELDS), FIELDS);
    assert.deepEqual(
      visibleFields("simple", "weather", FIELDS).map((f) => f.key),
      ["city"],
    );
  });

  test("le complément MODULE_ESSENTIALS vaut pour les manifestes qu'on ne touche pas", () => {
    const fields: SettingField[] = [
      { key: "day", type: "select", label: "Jour du bilan", default: "5", options: [] },
      { key: "other", type: "boolean", label: "Autre", default: false },
    ];
    assert.ok(fieldIsEssential("weekly", fields[0]));
    assert.ok(!fieldIsEssential("weekly", fields[1]));
    assert.ok(!fieldIsEssential("weather", fields[0]));
    for (const [id, keys] of Object.entries(MODULE_ESSENTIALS)) {
      const man = manifests().find((m) => m.id === id);
      assert.ok(man, `module ${id} introuvable`);
      for (const k of keys) assert.ok(man.settings?.fields.some((f) => f.key === k), `${id}.${k} n'existe pas dans le manifeste`);
    }
  });

  test("les clés essentielles d'une page de module : l'en-tête, puis les libellés des champs", () => {
    assert.deepEqual(moduleEssentialKeys("weather", FIELDS), ["Activé", "Permissions", "À propos", "Votre ville"]);
  });

  test("chaque module avec des réglages a 1 à 3 champs essentiels", () => {
    for (const man of manifests()) {
      const fields = man.settings?.fields ?? [];
      if (!fields.length) continue;
      const n = fields.filter((f) => fieldIsEssential(man.id, f)).length;
      assert.ok(n >= 1 && n <= 3, `${man.id} : ${n} champ(s) essentiel(s), il en faut de 1 à 3`);
    }
  });
});

describe("pages de l'île", () => {
  test("une ligne est cachée en Simple si elle n'est pas essentielle ; jamais en Complet", () => {
    const ess = ["Langue", "Lancer avec Windows"];
    assert.ok(!isHidden("simple", "Langue", ess));
    assert.ok(isHidden("simple", "Niveau du journal", ess));
    assert.ok(!isHidden("full", "Niveau du journal", ess));
  });

  test("une page entière, ou une ligne sans clé, n'est jamais cachée", () => {
    assert.ok(!isHidden("simple", "Clé API Anthropic", WHOLE_PAGE));
    assert.ok(!isHidden("simple", "", ["Langue"]));
  });

  test("les pages de l'île attendues sont là, Sécurité et Règles restent entières", () => {
    for (const id of ["general", "behavior", "look", "tabs", "mascot", "profiles", "perf"]) assert.ok(Array.isArray(ISLAND_ESSENTIALS[id]), id);
    for (const id of ["privacy", "credentials", "backup", "rules", "updates", "about"]) assert.equal(pageEssentials(id), WHOLE_PAGE, id);
    // Une page inconnue reste entière plutôt que vide.
    assert.equal(pageEssentials("nouvelle-page"), WHOLE_PAGE);
    const general = ISLAND_ESSENTIALS.general as string[];
    for (const k of ["Langue", "Lancer avec Windows", "S'adresser à moi"]) assert.ok(general.includes(k), k);
    // « Bord de l'écran » a suivi le comportement de l'île (page Comportement).
    assert.ok((ISLAND_ESSENTIALS.behavior as string[]).includes("Bord de l'écran"));
    for (const k of ["Afficher la mascotte", "Mascotte", "Couleur"]) assert.ok((ISLAND_ESSENTIALS.mascot as string[]).includes(k), k);
    assert.ok((ISLAND_ESSENTIALS.profiles as string[]).includes("Profil actif"));
  });
});

describe("compte « N de plus »", () => {
  test("compte les lignes cachées, 0 en Complet ou sur une page entière", () => {
    const keys = ["Langue", "Niveau du journal", "Dossier du journal", ""];
    assert.equal(hiddenCount("simple", keys, ["Langue"]), 2);
    assert.equal(hiddenCount("full", keys, ["Langue"]), 0);
    assert.equal(hiddenCount("simple", keys, WHOLE_PAGE), 0);
  });

  test("le texte s'accorde", () => {
    assert.equal(moreText(1), "1 réglage de plus en mode Complet");
    assert.equal(moreText(4), "4 réglages de plus en mode Complet");
  });
});
