// Tests de « Quoi de neuf » côté mascottes (src/core/whats-new-mascots.ts) et
// du script autonome du site (src/mascot/gum-standalone.ts) : la liste des
// nouveautés d'une version, les noms courts, et le fait que le script du site
// n'entraîne aucun module de l'appli (réglages, Tauri, perf, île).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { GUM_FAMILY } from "../../src/mascot/gum-family";
import { baseVersion, NEW_MASCOTS, newMascotsFor, shortName } from "../../src/core/whats-new-mascots";

describe("mascottes nouvelles d'une version", () => {
  test("1.2.0 : toute la famille gomme sauf la goutte gomme", () => {
    const ids = newMascotsFor("1.2.0");
    assert.equal(ids.length, GUM_FAMILY.length);
    assert.ok(!ids.includes("goutte-gomme"));
    assert.ok(ids.includes("gomme-guimauve"));
  });

  test("les variantes d'une version comptent comme elle", () => {
    assert.equal(baseVersion("v1.2.0"), "1.2.0");
    assert.equal(baseVersion("1.2.0-beta.2"), "1.2.0");
    assert.equal(baseVersion("1.2.0+3"), "1.2.0");
    assert.equal(baseVersion("dev"), "");
    assert.deepEqual(newMascotsFor("v1.2.0-beta.1"), newMascotsFor("1.2.0"));
  });

  test("une version sans nouveauté : liste vide (texte seul)", () => {
    assert.deepEqual(newMascotsFor("1.1.0"), []);
    assert.deepEqual(newMascotsFor("dev"), []);
    assert.deepEqual(newMascotsFor(""), []);
  });

  test("chaque id déclaré existe dans la famille gomme", () => {
    const known = new Set(["goutte-gomme", ...GUM_FAMILY.map((c) => c.id)]);
    for (const [version, ids] of Object.entries(NEW_MASCOTS)) {
      for (const id of ids) assert.ok(known.has(id), `${version} : ${id} inconnue`);
      assert.equal(new Set(ids).size, ids.length, `${version} : doublon`);
    }
  });

  test("noms courts", () => {
    assert.equal(shortName("Guimauve (gomme carrée)"), "Guimauve");
    assert.equal(shortName("Ciel (soleil le jour, lune la nuit)"), "Ciel");
    assert.equal(shortName("Étoile"), "Étoile");
  });
});

// ── Le script du site ne dépend de rien de l'appli ──────────────────────────

/** Les modules que le script autonome n'a pas le droit d'entraîner. */
const FORBIDDEN = [/core\/settings-store/, /core\/perf/, /core\/bridge/, /core\/demo/, /core\/i18n/, /island\//, /@tauri-apps/, /renderers\/gum\.ts$/];

/** Les imports (chemins) d'un fichier TypeScript, sans les `import type`. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^'"]*from\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  return out;
}

/** Le fichier .ts (ou .json) d'un import relatif. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(join(dirname(from), spec));
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate) && !candidate.endsWith("/")) return candidate;
  return null;
}

describe("script autonome du site (gum-standalone.ts)", () => {
  test("n'entraîne ni réglages, ni Tauri, ni perf, ni île", () => {
    const seen = new Set<string>();
    const queue = ["src/mascot/gum-standalone.ts"];
    const bad: string[] = [];
    while (queue.length) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (file.endsWith(".json")) continue;
      for (const spec of importsOf(file)) {
        if (FORBIDDEN.some((rx) => rx.test(spec))) bad.push(`${file} → ${spec}`);
        const target = resolveImport(file, spec);
        if (target) {
          if (FORBIDDEN.some((rx) => rx.test(target))) bad.push(`${file} → ${target}`);
          queue.push(target);
        } else if (spec.startsWith(".")) bad.push(`${file} → ${spec} (introuvable)`);
      }
    }
    assert.deepEqual(bad, []);
    assert.ok(seen.has(normalize("src/mascot/renderers/gum-engine.ts")), "le moteur gomme doit être entraîné");
    assert.ok(seen.size >= 5, `trop peu de fichiers suivis (${seen.size})`);
  });

  test("le moteur gomme (gum-engine.ts) ne connaît pas l'appli", () => {
    const specs = importsOf("src/mascot/renderers/gum-engine.ts");
    assert.deepEqual(specs.filter((s) => /core\/|island\//.test(s)), []);
  });
});
