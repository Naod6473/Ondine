// Tests des réglages côté front : valeurs par défaut (et leur accord avec le
// Rust), valeurs des modules complétées par le manifeste, ordre des onglets.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultSettings } from "../../src/core/types";
import { coerce, settingsStore } from "../../src/core/settings-store";
import { applyTabOrder, mergeOrder } from "../../src/core/tab-order";
import { THEMES } from "../../src/island/themes";
import type { ModuleManifest, SettingField } from "../../src/core/module-types";

// ── Les valeurs par défaut du Rust, lues dans settings.rs ─────────────────────
//
// Les réglages sont décrits deux fois (settings.rs et types.ts), avec leurs
// valeurs par défaut des deux côtés. Ce petit lecteur retrouve les blocs
// `impl Default for General { … Self { champ: valeur, … } }` du Rust pour
// vérifier que les deux côtés disent la même chose.

const RUST_SECTIONS: Record<string, string> = { General: "general", IslandPrefs: "island", MascotPrefs: "mascot", Privacy: "privacy" };
const UNKNOWN = Symbol("valeur Rust non lue");

/** snake_case → camelCase (comme serde rename_all = "camelCase"). */
function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Le texte entre l'accolade ouvrante à `open` et l'accolade fermante qui lui répond. */
function braced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("accolade non fermée dans settings.rs");
}

/** Coupe aux virgules qui ne sont pas dans des parenthèses ou des guillemets. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const c of body) {
    if (c === '"') inStr = !inStr;
    if (!inStr && "([{".includes(c)) depth++;
    if (!inStr && ")]}".includes(c)) depth--;
    if (c === "," && depth === 0 && !inStr) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function rustValue(src: string, raw: string): unknown {
  const v = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = /^"((?:[^"\\]|\\.)*)"\s*\.\s*(?:into|to_string|to_owned)\(\)$/.exec(v))) return JSON.parse(`"${m[1]}"`);
  if ((m = /^String::from\("((?:[^"\\]|\\.)*)"\)$/.exec(v))) return JSON.parse(`"${m[1]}"`);
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  // Une liste de textes : vec!["a".into(), "b".into()].
  if ((m = /^vec!\[(.+)\]$/s.exec(v))) return splitTopLevel(m[1]).map((x) => rustValue(src, x));
  if (/^(Vec::new\(\)|vec!\[\]|Map::new\(\)|BTreeMap::new\(\))$/.test(v)) return v.startsWith("Vec") || v.startsWith("vec") ? [] : {};
  // Une petite fonction `fn default_x() -> T { valeur }`.
  if ((m = /^([a-z_][a-z0-9_]*)\(\)$/.exec(v))) {
    const at = src.search(new RegExp(`fn\\s+${m[1]}\\s*\\(\\)[^{]*\\{`));
    if (at >= 0) return rustValue(src, braced(src, src.indexOf("{", at)));
  }
  return UNKNOWN;
}

/** { general: { screen: "primary", … }, island: { … }, … } d'après settings.rs. */
function rustDefaults(): Record<string, Record<string, unknown>> {
  const src = readFileSync("src-tauri/src/services/settings.rs", "utf8");
  const out: Record<string, Record<string, unknown>> = {};
  for (const [struct, section] of Object.entries(RUST_SECTIONS)) {
    const at = src.search(new RegExp(`impl\\s+Default\\s+for\\s+${struct}\\s*\\{`));
    assert.ok(at >= 0, `impl Default for ${struct} introuvable dans settings.rs`);
    const impl = braced(src, src.indexOf("{", at));
    // Le corps de `fn default() -> Self { … }`, puis le `Self { … }` qu'il renvoie.
    const fnBody = braced(impl, impl.indexOf("{", impl.search(/fn\s+default\s*\(/)));
    const body = braced(fnBody, fnBody.indexOf("{", fnBody.search(/Self\s*\{/)));
    out[section] = {};
    for (const field of splitTopLevel(body)) {
      const colon = field.indexOf(":");
      if (colon < 0) continue;
      out[section][camel(field.slice(0, colon).trim())] = rustValue(src, field.slice(colon + 1));
    }
  }
  return out;
}

describe("valeurs par défaut", () => {
  test("le lecteur de settings.rs trouve bien les réglages", () => {
    const rust = rustDefaults();
    assert.equal(rust.island.alwaysMini, true);
    assert.equal(rust.island.motion, "classic");
    assert.ok(Object.keys(rust.general).length >= 4);
  });

  test("mêmes réglages et mêmes valeurs par défaut côté Rust et côté front", () => {
    const rust = rustDefaults();
    const front = defaultSettings() as unknown as Record<string, Record<string, unknown>>;
    for (const section of Object.values(RUST_SECTIONS)) {
      const r = rust[section];
      const f = front[section];
      assert.deepEqual(
        Object.keys(f).sort(),
        Object.keys(r).sort(),
        `section « ${section} » : les champs diffèrent entre types.ts (defaultSettings) et settings.rs (impl Default)`,
      );
      for (const [key, value] of Object.entries(r)) {
        if (value === UNKNOWN) continue; // valeur Rust trop compliquée pour ce petit lecteur
        assert.deepEqual(f[key], value, `${section}.${key} : défaut ${JSON.stringify(f[key])} côté front, ${JSON.stringify(value)} côté Rust`);
      }
    }
  });

  test("la version du schéma est la même", () => {
    const src = readFileSync("src-tauri/src/services/settings.rs", "utf8");
    const m = /CURRENT_VERSION:\s*u32\s*=\s*(\d+)/.exec(src);
    assert.ok(m, "CURRENT_VERSION introuvable");
    assert.equal(defaultSettings().version, Number(m[1]));
  });

  test("chaque appel renvoie une copie neuve (rien de partagé)", () => {
    const a = defaultSettings();
    const b = defaultSettings();
    a.island.tabOrder.push("notes");
    a.privacy.excludedFolders.push("C:\\x");
    a.modules.notes = { enabled: false, values: {} };
    assert.deepEqual(b.island.tabOrder, []);
    assert.deepEqual(b.privacy.excludedFolders, []);
    assert.deepEqual(b.modules, {});
  });

  test("valeurs sensées", () => {
    const d = defaultSettings();
    assert.equal(d.island.alwaysMini, true);
    assert.ok(d.island.collapseSecs > 0);
    assert.ok(d.island.offset >= 0 && d.island.offset <= 1);
    assert.ok(d.island.soundVolume >= 0 && d.island.soundVolume <= 1);
    assert.ok(THEMES.some((th) => th.id === d.island.theme), `thème par défaut « ${d.island.theme} » inconnu de themes.ts`);
    assert.match(d.island.color, /^#[0-9a-f]{6}$/i);
  });
});

// ── Valeurs des modules : ce qui est enregistré, complété par le manifeste ────

const FIELDS: Record<string, SettingField> = {
  on: { type: "boolean", key: "on", label: "Actif", default: true } as SettingField,
  n: { type: "number", key: "n", label: "Nombre", default: 5, min: 1, max: 10 } as SettingField,
  pick: { type: "select", key: "pick", label: "Choix", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } as SettingField,
  s: { type: "string", key: "s", label: "Texte", default: "x", maxLength: 4 } as SettingField,
  dirs: { type: "folders", key: "dirs", label: "Dossiers", default: [], max: 2 } as unknown as SettingField,
};

describe("coerce : une valeur enregistrée ramenée à une valeur valide", () => {
  test("booléen", () => {
    assert.equal(coerce(FIELDS.on, false), false);
    assert.equal(coerce(FIELDS.on, "oui"), true);
    assert.equal(coerce(FIELDS.on, undefined), true);
  });

  test("nombre : bornes min / max, NaN et texte refusés", () => {
    assert.equal(coerce(FIELDS.n, 7), 7);
    assert.equal(coerce(FIELDS.n, 0), 1);
    assert.equal(coerce(FIELDS.n, 99), 10);
    assert.equal(coerce(FIELDS.n, Number.NaN), 5);
    assert.equal(coerce(FIELDS.n, "7"), 5);
  });

  test("liste de choix : une valeur inconnue redevient le défaut", () => {
    assert.equal(coerce(FIELDS.pick, "b"), "b");
    assert.equal(coerce(FIELDS.pick, "z"), "a");
  });

  test("texte : coupé à maxLength", () => {
    assert.equal(coerce(FIELDS.s, "abcdefgh"), "abcd");
    assert.equal(coerce(FIELDS.s, 3), "x");
  });

  test("dossiers : sans doublon, sans vide, au plus `max`", () => {
    assert.deepEqual(coerce(FIELDS.dirs, ["C:\\a", "", "C:\\a", 4, "C:\\b", "C:\\c"]), ["C:\\a", "C:\\b"]);
    assert.deepEqual(coerce(FIELDS.dirs, "C:\\a"), []);
  });
});

describe("moduleValues : fusion des réglages enregistrés et du manifeste", () => {
  const manifest = { id: "essai", settings: { fields: Object.values(FIELDS) } } as unknown as ModuleManifest;

  test("module jamais réglé : toutes les valeurs par défaut, et le module est actif", () => {
    settingsStore.current = defaultSettings();
    assert.deepEqual(settingsStore.moduleValues(manifest), { on: true, n: 5, pick: "a", s: "x", dirs: [] });
    assert.equal(settingsStore.moduleEnabled("essai"), true);
  });

  test("valeurs enregistrées gardées, invalides corrigées, inconnues ignorées", () => {
    const s = defaultSettings();
    s.modules.essai = { enabled: false, values: { n: 42, pick: "b", ancien: "à jeter" } };
    settingsStore.current = s;
    assert.deepEqual(settingsStore.moduleValues(manifest), { on: true, n: 10, pick: "b", s: "x", dirs: [] });
    assert.equal(settingsStore.moduleEnabled("essai"), false);
  });
});

// ── Ordre des onglets ─────────────────────────────────────────────────────────

describe("ordre des onglets", () => {
  const id = (x: string) => x;

  test("ordre vide : l'ordre d'origine", () => {
    assert.deepEqual(applyTabOrder(["a", "b", "c"], id, []), ["a", "b", "c"]);
  });

  test("les modules rangés d'abord, les nouveaux après, à leur place d'origine", () => {
    assert.deepEqual(applyTabOrder(["a", "b", "c", "d"], id, ["c", "a"]), ["c", "a", "b", "d"]);
  });

  test("mergeOrder : un module désactivé garde son rang", () => {
    // Tous : a b c d ; c est désactivé ; on affiche maintenant d a b.
    assert.deepEqual(mergeOrder(["d", "a", "b"], ["a", "b", "c", "d"]), ["d", "a", "c", "b"]);
  });

  test("mergeOrder : un id visible inconnu est ajouté à la fin", () => {
    assert.deepEqual(mergeOrder(["b", "z", "a"], ["a", "b"]), ["b", "z", "a"]);
  });
});
