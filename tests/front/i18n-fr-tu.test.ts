// Tests du tutoiement (src/core/i18n-fr-tu.json, réglage « S'adresser à moi »).
//
// Le dictionnaire passe des phrases au « vous » à leur version au « tu ». On
// vérifie :
// 1. qu'il est bien formé (même forme que i18n-en.json) ;
// 2. qu'aucune clé n'est orpheline : chaque texte (ou, pour un motif, chaque
//    morceau fixe) existe vraiment dans le code et vouvoie ;
// 3. que les versions tutoyées ne vouvoient plus ;
// 4. quelques textes à variables, de bout en bout (même recherche que t()).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAW = readFileSync("src/core/i18n-fr-tu.json", "utf8");
const DICT = JSON.parse(RAW) as { exact: Record<string, string>; patterns: [string, string][] };
const EXACT = new Map(Object.entries(DICT.exact));

/** Un texte au « vous » : vous, votre, vos, ou un impératif en -ez (« Collez »). */
const VOUS = /(?<![\p{L}-])(?:vous|votre|vos|vôtres?)(?![\p{L}])|\p{L}{2,}ez(?![\p{L}])/iu;
/** Un texte qui vouvoie encore (pour les versions tutoyées). */
const STILL_VOUS = /(?<![\p{L}-])(?:vous|votre|vos|vôtres?)(?![\p{L}])/iu;

/** Même recherche que t() dans src/core/i18n.ts. */
function tu(fr: string): string {
  const s = fr.trim();
  const hit = EXACT.get(s);
  if (hit !== undefined) return hit;
  for (const [rx, rep] of DICT.patterns) {
    const re = new RegExp(rx);
    if (re.test(s)) return s.replace(re, rep);
  }
  return fr;
}

// ── Le texte du code, là où les phrases au « vous » peuvent se trouver ────────

function files(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p, exts);
    return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
}

/**
 * Tout le code de l'interface (.ts, manifestes .json) et du Rust, sans les
 * dictionnaires eux-mêmes, avec les échappements de chaîne les plus courants
 * défaits (\" → ", \\ → \) pour retrouver le texte affiché.
 */
const CODE = [...files("src", [".ts", ".json"]), ...files(join("src-tauri", "src"), [".rs"])]
  .filter((f) => !/i18n-[\w-]+\.json$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")
  .replace(/\\(["'\\])/g, "$1");

/**
 * Le texte est-il dans le code ? Une longue phrase peut y être écrite en
 * plusieurs morceaux (`"…" +` à la ligne) : on cherche alors chaque morceau
 * coupé aux fins de phrase.
 */
function inCode(text: string): boolean {
  if (CODE.includes(text)) return true;
  const pieces = text.split(/(?<=[.:;]) /).filter((p) => p.length > 0);
  return pieces.length > 1 && pieces.every((p) => CODE.includes(p.trim()));
}

/** Les morceaux fixes d'un motif : ce qui n'est ni un groupe (…) ni une ancre. */
function fixedParts(rx: string): string[] {
  const body = rx.replace(/^\^/, "").replace(/\$$/, "");
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      if (depth === 0) cur += body[i + 1];
      i++;
    } else if (c === "(") {
      depth++;
      parts.push(cur);
      cur = "";
    } else if (c === ")") depth--;
    else if (depth === 0 && c !== "?") cur += c;
  }
  parts.push(cur);
  // Sans la ponctuation collée à une partie variable (« $1 : … » écrit ailleurs).
  return parts.map((p) => p.replace(/^[\s:·]+|[\s:·]+$/g, "")).filter((p) => p.length >= 3);
}

describe("i18n-fr-tu.json bien formé", () => {
  test("deux sections : exact (objet) et patterns (liste)", () => {
    assert.equal(typeof DICT.exact, "object");
    assert.ok(!Array.isArray(DICT.exact));
    assert.ok(Array.isArray(DICT.patterns));
    assert.ok(EXACT.size > 50, "dictionnaire presque vide");
  });

  test("exact : textes non vides, sans espace autour, différents de l'original", () => {
    const bad: string[] = [];
    for (const [vous, tuText] of EXACT) {
      if (typeof tuText !== "string" || !tuText.trim()) bad.push(`${JSON.stringify(vous)} : version tutoyée vide`);
      else if (vous !== vous.trim()) bad.push(`${JSON.stringify(vous)} : espaces autour de la clé`);
      else if (vous === tuText) bad.push(`${JSON.stringify(vous)} : rien ne change`);
    }
    assert.deepEqual(bad, []);
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
      const groups = new RegExp(`${re.source}|`).exec("")!.length - 1;
      for (const m of rep.matchAll(/\$(\d+)/g)) {
        if (Number(m[1]) > groups) bad.push(`${rx} : « $${m[1]} » mais seulement ${groups} groupe(s)`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe("tutoiement : pas de clé orpheline", () => {
  test("chaque texte de \"exact\" vouvoie et existe dans le code", () => {
    const bad: string[] = [];
    for (const vous of EXACT.keys()) {
      if (!VOUS.test(vous)) bad.push(`${JSON.stringify(vous)} : ne vouvoie pas`);
      else if (!inCode(vous)) bad.push(`${JSON.stringify(vous)} : introuvable dans le code`);
    }
    assert.deepEqual(bad, [], "à retirer de src/core/i18n-fr-tu.json, ou à remettre d'accord avec le texte du code");
  });

  test("chaque motif de \"patterns\" vouvoie, et ses morceaux fixes existent dans le code", () => {
    const bad: string[] = [];
    for (const [rx] of DICT.patterns) {
      const parts = fixedParts(rx);
      if (!parts.some((p) => VOUS.test(p))) bad.push(`${rx} : ne vouvoie pas`);
      for (const p of parts) if (!CODE.includes(p)) bad.push(`${rx} : « ${p} » introuvable dans le code`);
    }
    assert.deepEqual(bad, []);
  });

  test("les versions tutoyées ne vouvoient plus", () => {
    const bad = [...EXACT.values(), ...DICT.patterns.map(([, rep]) => rep)].filter((s) => STILL_VOUS.test(s));
    assert.deepEqual(bad, []);
  });
});

describe("tutoiement : textes à variables", () => {
  test("bulles, notifications et erreurs avec une partie variable", () => {
    assert.equal(tu("Claude attend votre permission"), "Claude attend ta permission");
    assert.equal(tu("❓ Codex vous demande"), "❓ Codex te demande");
    assert.equal(tu("vous attend depuis 3 min"), "t'attend depuis 3 min");
    assert.equal(tu("✋ 2 vous attendent"), "✋ 2 t'attendent");
    assert.equal(tu("Plus que 10 % : pensez à brancher le chargeur."), "Plus que 10 % : pense à brancher le chargeur.");
    // Le résumé des agents (agents.rs) après une séance de concentration.
    assert.equal(tu("Claude a fini 2 tâches · Codex vous attend · 1 question en attente"), "Claude a fini 2 tâches · Codex t'attend · 1 question en attente");
    assert.equal(tu("Claude et Gemini vous attendent (2 sessions)"), "Claude et Gemini t'attendent (2 sessions)");
  });

  test("les boutons et champs à l'infinitif ne changent pas", () => {
    for (const s of ["Coller ici une erreur, un message, un bout de code…", "Écrire une note… (enregistrée automatiquement)", "Lâcher le fichier sur une cible"]) {
      assert.equal(tu(s), s);
    }
  });
});
