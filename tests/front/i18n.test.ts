// Tests de la traduction anglaise (src/core/i18n-en.json).
//
// 1. Le fichier est bien formé : chaque entrée est utilisable par t() (i18n.ts).
// 2. Les textes d'interface écrits en dur dans le code ont une traduction.
//    C'est une recherche simple (expressions régulières), pas une analyse
//    complète : elle regarde les textes donnés directement à el(…) et les
//    attributs title, placeholder et aria-label.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAW = readFileSync("src/core/i18n-en.json", "utf8");
const DICT = JSON.parse(RAW) as { exact: Record<string, string>; patterns: [string, string][] };
const EXACT = new Map(Object.entries(DICT.exact));
const PATTERNS = DICT.patterns.map(([rx]) => new RegExp(rx));

/** Le texte a-t-il une traduction ? (même recherche que t() dans i18n.ts) */
function translated(fr: string): boolean {
  const s = fr.trim();
  return EXACT.has(s) || PATTERNS.some((rx) => rx.test(s));
}

describe("i18n-en.json bien formé", () => {
  test("deux sections : exact (objet) et patterns (liste)", () => {
    assert.equal(typeof DICT.exact, "object");
    assert.ok(!Array.isArray(DICT.exact));
    assert.ok(Array.isArray(DICT.patterns));
  });

  test("exact : chaque entrée est un texte non vide, sans espace autour", () => {
    // t() cherche le texte SANS ses espaces autour : une clé avec des espaces
    // ne serait jamais trouvée.
    const bad: string[] = [];
    for (const [fr, en] of EXACT) {
      if (typeof en !== "string" || !en.trim()) bad.push(`${JSON.stringify(fr)} : traduction vide`);
      else if (!fr.trim()) bad.push(`clé vide`);
      else if (fr !== fr.trim()) bad.push(`${JSON.stringify(fr)} : espaces autour de la clé`);
    }
    assert.deepEqual(bad, []);
  });

  test("exact : pas de morceau de code à la place d'un texte", () => {
    // Un texte avec ${…} vient d'un gabarit `…${x}…` : à l'écran, on ne voit
    // jamais « ${ », il faut une entrée dans "patterns".
    const bad = [...EXACT.keys()].filter((fr) => fr.includes("${"));
    assert.deepEqual(bad, [], "entrées à remplacer par un motif dans \"patterns\"");
  });

  test("exact : pas de clé en double (la seconde écraserait la première)", () => {
    const head = RAW.slice(0, RAW.indexOf('"patterns"'));
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const m of head.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"/gm)) {
      const key = JSON.parse(`"${m[1]}"`) as string;
      if (seen.has(key)) dup.push(key);
      seen.add(key);
    }
    assert.ok(seen.size > 100, "le lecteur n'a pas trouvé les entrées");
    assert.deepEqual(dup, []);
  });

  test("patterns : [motif, remplacement], motif valide et ancré ^…$", () => {
    const bad: string[] = [];
    for (const entry of DICT.patterns) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
        bad.push(`entrée mal formée : ${JSON.stringify(entry)}`);
        continue;
      }
      const [rx, rep] = entry;
      let re: RegExp;
      try {
        re = new RegExp(rx);
      } catch (err) {
        bad.push(`${rx} : ${(err as Error).message}`);
        continue;
      }
      if (!rx.startsWith("^") || !rx.endsWith("$")) bad.push(`${rx} : doit commencer par ^ et finir par $`);
      if (!rep.trim()) bad.push(`${rx} : remplacement vide`);
      // $1, $2… doivent exister dans le motif.
      const groups = new RegExp(`${re.source}|`).exec("")!.length - 1;
      for (const m of rep.matchAll(/\$(\d+)/g)) {
        if (Number(m[1]) > groups) bad.push(`${rx} : « $${m[1]} » mais seulement ${groups} groupe(s)`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("patterns : pas de motif en double", () => {
    const seen = new Set<string>();
    const dup = DICT.patterns.map(([rx]) => rx).filter((rx) => (seen.has(rx) ? true : (seen.add(rx), false)));
    assert.deepEqual(dup, []);
  });
});

// ── Textes d'interface sans traduction ────────────────────────────────────────

/** Textes identiques en anglais, ou noms propres : pas besoin d'entrée. */
const SAME_IN_ENGLISH = new Set([
  "Modules",
  "Ondine",
  "Notes",
  "📝 Notes",
  "← Notes",
  "Format",
  "Port",
  "Admin",
  "SSH",
  "⌨️ SSH",
  "🖥️ RDP",
  "📶 Ping",
  "🔌 Port",
  "🔎 DNS",
  "💬 Claude",
]);

/** Fichiers dont les textes ne sont pas à traduire (fausses données du mode démo). */
const SKIPPED_FILES = new Set([join("src", "core", "demo.ts")]);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [p] : [];
  });
}

// el("tag", { … }, "Texte") ou el("tag", {}, "Texte"), et title: "…", placeholder: "…", "aria-label": "…".
const UI_TEXT = /(?:\b(?:title|placeholder)\s*:\s*|"aria-label"\s*:\s*|\bel\(\s*"[\w-]+"\s*,\s*(?:\{[^{}]*\}|null|undefined)\s*,\s*)"((?:[^"\\]|\\.)*)"/g;

describe("textes d'interface", () => {
  test("chaque texte écrit en dur dans l'interface a sa traduction anglaise", () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of tsFiles("src")) {
      if (SKIPPED_FILES.has(file)) continue;
      // Sans les lignes de commentaire (exemples comme `el("button", {…}, "Texte")`).
      const src = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      for (const m of src.matchAll(UI_TEXT)) {
        const text = (JSON.parse(`"${m[1]}"`) as string).trim();
        // Au moins un mot : pas les « × », « ⋯ », raccourcis, nombres…
        if (!/\p{L}{3}/u.test(text)) continue;
        found++;
        if (SAME_IN_ENGLISH.has(text) || translated(text)) continue;
        missing.push(`${file} : ${JSON.stringify(text)}`);
      }
    }
    assert.ok(found > 50, `la recherche ne trouve presque rien (${found}) : expression à revoir`);
    assert.deepEqual(
      [...new Set(missing)],
      [],
      "textes sans traduction : ajoute-les à la fin de \"exact\" dans src/core/i18n-en.json (ou à SAME_IN_ENGLISH dans ce test s'ils sont identiques en anglais)",
    );
  });
});
