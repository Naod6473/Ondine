// Tests des petits textes du module Agents IA (src/modules/agents/texts.ts) :
// le bilan de fin de tâche (« 3 fichiers modifiés, +120 −14 »), « il y a 2 h »,
// et leur traduction anglaise (les motifs de src/core/i18n-en.json).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { byModel, changesLine, modelLabel, namesLine, periodFrom, since, sumTokens, tokensShort } from "../../src/modules/agents/texts";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as {
  exact: Record<string, string>;
  patterns: [string, string][];
};

/** Même recherche que t() (src/core/i18n.ts) : le texte exact, sinon le premier motif. */
function english(fr: string): string | undefined {
  if (fr in DICT.exact) return DICT.exact[fr];
  for (const [rx, en] of DICT.patterns) {
    const m = new RegExp(rx).exec(fr);
    if (m) return en.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? "");
  }
  return undefined;
}

describe("bilan de fin de tâche", () => {
  test("le nombre de fichiers et de lignes", () => {
    assert.equal(changesLine({ files: 3, added: 120, removed: 14, names: [] }), "3 fichiers modifiés, +120 −14");
    assert.equal(changesLine({ files: 1, added: 5, removed: 0, names: [] }), "1 fichier modifié, +5 −0");
  });

  test("les noms : « … » quand il y en a d'autres", () => {
    const names = ["main.rs", "index.ts", "README.md"];
    assert.equal(namesLine({ files: 3, added: 1, removed: 1, names }), "main.rs, index.ts, README.md");
    assert.equal(namesLine({ files: 7, added: 1, removed: 1, names }), "main.rs, index.ts, README.md…");
  });

  test("le titre de la notification est traduit", () => {
    const many = `Claude Code a fini · ${changesLine({ files: 3, added: 120, removed: 14, names: [] })}`;
    assert.equal(english(many), "Claude Code is done · 3 files changed, +120 −14");
    const one = `Codex a fini · ${changesLine({ files: 1, added: 5, removed: 0, names: [] })}`;
    assert.equal(english(one), "Codex is done · 1 file changed, +5 −0");
    assert.equal(english("main.rs, lib.rs · Projet Ondine"), "main.rs, lib.rs · Project Ondine");
  });
});

describe("il y a combien de temps", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  test("minutes, heures, jours", () => {
    assert.equal(since(now - 20_000, now), "à l'instant");
    assert.equal(since(now + 60_000, now), "à l'instant"); // horloge en avance : pas de négatif
    assert.equal(since(now - 5 * 60_000, now), "il y a 5 min");
    assert.equal(since(now - 2 * 3_600_000 - 59_000, now), "il y a 2 h");
    assert.equal(since(now - 3 * 86_400_000, now), "il y a 3 j");
  });

  test("au-delà d'un mois : la date", () => {
    assert.match(since(now - 40 * 86_400_000, now), /^\d{2}\/\d{2}\/\d{4}$/);
  });

  test("tout est traduit", () => {
    for (const ms of [20_000, 5 * 60_000, 2 * 3_600_000, 3 * 86_400_000]) {
      assert.ok(english(since(now - ms, now)), since(now - ms, now));
    }
    assert.equal(english("il y a 3 j"), "3 d ago");
  });
});

describe("rejoindre une réunion", () => {
  test("les titres de l'alerte sont traduits", () => {
    assert.equal(english("Réunion dans 2 min : Point hebdo"), "Meeting in 2 min: Point hebdo");
    assert.equal(english("La réunion commence : Point hebdo"), "The meeting is starting: Point hebdo");
    assert.equal(english("Votre micro est coupé"), "Your mic is muted");
  });
});

describe("le compteur de jetons", () => {
  test("des jetons en bref", () => {
    assert.equal(tokensShort(0), "0");
    assert.equal(tokensShort(985), "985");
    assert.equal(tokensShort(1000), "1 k");
    assert.equal(tokensShort(12_345), "12,3 k");
    assert.equal(tokensShort(123_456), "123 k");
    assert.equal(tokensShort(1_234_567), "1,2 M");
    assert.equal(tokensShort(2_000_000_000), "2 G");
    assert.equal(tokensShort(Number.NaN), "0");
  });

  test("le nom court d'un modèle", () => {
    assert.equal(modelLabel("claude-opus-5-5"), "Opus 5.5");
    assert.equal(modelLabel("claude-opus-5-5[1m]"), "Opus 5.5");
    assert.equal(modelLabel("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
    assert.equal(modelLabel("claude-3-5-haiku-20241022"), "Haiku 3.5");
    assert.equal(modelLabel("gpt-5-codex"), "GPT-5 Codex");
    assert.equal(modelLabel("gpt-5.1"), "GPT-5.1");
    assert.equal(modelLabel("o3-mini"), "o3-mini");
    assert.equal(modelLabel("<synthetic>"), "—");
    assert.equal(modelLabel("?"), "—");
  });

  test("les périodes commencent au bon jour local", () => {
    const now = new Date(2026, 9, 8, 13, 30); // 8 octobre 2026
    assert.equal(periodFrom("today", now), "2026-10-08");
    assert.equal(periodFrom("week", now), "2026-10-02");
    assert.equal(periodFrom("month", now), "2026-09-09");
    assert.equal(periodFrom("week", new Date(2026, 0, 3)), "2025-12-28");
  });

  test("les totaux, par modèle, les plus gros d'abord", () => {
    const rows = [
      { day: "2026-10-08", tool: "claude-code", model: "claude-opus-5-5", input: 10, output: 20, cacheRead: 1000, cacheWrite: 50, messages: 2 },
      { day: "2026-10-07", tool: "claude-code", model: "claude-opus-5-5", input: 5, output: 5, cacheRead: 0, cacheWrite: 0, messages: 1 },
      { day: "2026-10-08", tool: "codex", model: "gpt-5-codex", input: 600, output: 50, cacheRead: 400, cacheWrite: 0, messages: 1 },
    ];
    assert.deepEqual(sumTokens(rows), { input: 615, output: 75, cacheRead: 1400, cacheWrite: 50, messages: 4 });
    assert.deepEqual(byModel(rows), [
      { tool: "claude-code", model: "claude-opus-5-5", total: 1090, messages: 3 },
      { tool: "codex", model: "gpt-5-codex", total: 1050, messages: 1 },
    ]);
    assert.deepEqual(sumTokens([]), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 });
  });
});

// ── Les outils en plus (tools.ts), le bilan cliquable, les coucous ──────────

import { HOOK_TOOLS, LAUNCH, fileCounts, launchName, sourceName, summaryLine } from "../../src/modules/agents/tools";
import { waveDue, WAVE_EVERY_MS } from "../../src/modules/agents/wait-watch";

describe("les outils en plus", () => {
  test("noms de lancement et de source", () => {
    assert.equal(launchName("copilot"), "GitHub Copilot CLI");
    assert.equal(launchName("other"), "Autre outil");
    assert.equal(launchName("other", " kiro-cli "), "kiro-cli");
    assert.equal(launchName("inconnu"), "inconnu");
    assert.equal(sourceName("copilot"), "Copilot");
    assert.equal(sourceName("claude-code"), "Claude");
    assert.equal(sourceName("masauvegarde"), "masauvegarde");
  });

  test("qui se reprend, qui se branche", () => {
    assert.equal(LAUNCH.gemini.resume, false);
    assert.equal(LAUNCH.aider.resume, false);
    assert.equal(LAUNCH.goose.resume, true);
    for (const id of ["claude-code", "codex", "gemini", "copilot", "cursor", "qwen", "goose"]) assert.ok(HOOK_TOOLS[id], id);
    assert.equal(HOOK_TOOLS.copilot.mcp, false);
    assert.equal(HOOK_TOOLS["claude-code"].mcp, true);
    assert.ok(!("aider" in HOOK_TOOLS));
    // Chaque libellé est traduit.
    for (const info of Object.values(LAUNCH)) if (info.resumeTitle) assert.ok(english(info.resumeTitle), info.resumeTitle);
    for (const g of Object.values(HOOK_TOOLS)) {
      assert.ok(english(g.steps), g.steps);
      assert.ok(english(g.restart), g.restart);
    }
  });

  test("les notifications des nouveaux outils sont traduites", () => {
    assert.equal(english("Copilot a fini"), "Copilot is done");
    assert.equal(english("Claude attend toujours votre réponse"), "Claude is still waiting for your answer");
    assert.equal(english("depuis 10 min · site-ondine"), "for 10 min · site-ondine");
    assert.equal(english("Goose a ajouté une note"), "Goose added a note");
    assert.equal(english("Claude demande une capture d'écran"), "Claude asks for a screenshot");
    assert.equal(english("Claude demande d'ouvrir rapport.pdf"), "Claude asks to open rapport.pdf");
  });
});

describe("le bilan cliquable", () => {
  test("les comptes par fichier", () => {
    assert.equal(fileCounts({ path: "a.rs", added: 12, removed: 3, untracked: false, exists: true }), "+12 −3");
    assert.equal(fileCounts({ path: "b.rs", added: 40, removed: 0, untracked: true, exists: true }), "nouveau, +40");
    assert.equal(fileCounts({ path: "c.rs", added: 0, removed: 7, untracked: false, exists: false }), "supprimé");
    assert.equal(english("nouveau, +40"), "new, +40");
    assert.equal(english("supprimé"), "deleted");
  });

  test("la dernière phrase, sur une ligne et coupée", () => {
    assert.equal(summaryLine("  Les tests\n  passent.  "), "Les tests passent.");
    const long = summaryLine("a".repeat(300));
    assert.equal([...long].length, 200);
    assert.ok(long.endsWith("…"));
    assert.equal(summaryLine("é".repeat(200)), "é".repeat(200));
  });
});

describe("les coucous de la mascotte", () => {
  const base = { waiting: 1, islandState: "compact", quiet: false, enabled: true, lastWave: 0, now: WAVE_EVERY_MS };
  test("toutes les deux minutes, en mini-île, tant qu'un agent attend", () => {
    assert.equal(waveDue(base), true);
    assert.equal(waveDue({ ...base, now: WAVE_EVERY_MS - 1 }), false);
    assert.equal(waveDue({ ...base, waiting: 0 }), false);
    assert.equal(waveDue({ ...base, islandState: "expanded" }), false);
    assert.equal(waveDue({ ...base, islandState: "hidden" }), false);
    assert.equal(waveDue({ ...base, quiet: true }), false);
    assert.equal(waveDue({ ...base, enabled: false }), false);
  });
});
