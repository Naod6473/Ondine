// Tests des Notes d'appel côté page (src/settings/voice/callnotes-logic.ts) et
// de leur manifeste. L'assemblage des tours de parole, le renommage, l'export
// Markdown et le nettoyage de l'audio sont testés côté Rust
// (src-tauri/src/modules/callnotes_text.rs, callnotes_audio.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanName,
  dayLabel,
  elapsed,
  excerpt,
  itemMeta,
  minutes,
  noteMeta,
  peopleLabel,
  speakerColor,
  summaryLeaves,
  transcriptionLeaves,
  who,
  type CallNote,
} from "../../src/settings/voice/callnotes-logic";

const NOW = new Date(2026, 9, 15, 11, 0).getTime();
const TEN = new Date(2026, 9, 15, 10, 0).getTime();

function note(extra: Partial<CallNote> = {}): CallNote {
  return {
    id: "1",
    title: "Point hebdo",
    start: TEN,
    end: TEN + 32 * 60_000,
    status: "ready",
    engine: "parakeet",
    speakers: [
      { id: "me", name: "Vous", color: 0, me: true },
      { id: "p2", name: "Marc", color: 1, me: false },
      { id: "p3", name: "Sophie", color: 2, me: false },
    ],
    lines: [],
    summary: null,
    keyPoints: [],
    todos: [],
    error: null,
    warning: null,
    working: false,
    ...extra,
  };
}

describe("durées et dates", () => {
  test("le temps écoulé de la pilule", () => {
    assert.equal(elapsed(0), "0:00");
    assert.equal(elapsed(7_400), "0:07");
    assert.equal(elapsed((12 * 60 + 48) * 1000), "12:48");
    assert.equal(elapsed(3_725_000), "1:02:05");
    assert.equal(elapsed(-5), "0:00");
  });

  test("minutes : au moins 1, et l'appel en cours compte jusqu'à maintenant", () => {
    assert.equal(minutes(TEN, TEN + 10_000), 1);
    assert.equal(minutes(TEN, TEN + 32 * 60_000), 32);
    assert.equal(minutes(TEN, null, NOW), 60);
  });

  test("aujourd'hui, hier, ou la date", () => {
    assert.equal(dayLabel(TEN, NOW), "Aujourd'hui");
    assert.equal(dayLabel(TEN - 86_400_000, NOW), "Hier");
    assert.match(dayLabel(new Date(2026, 9, 13, 9).getTime(), NOW), /13/);
  });

  test("la ligne de la liste et celle de la note", () => {
    const item = { id: "1", title: "x", start: TEN, end: TEN + 32 * 60_000, status: "ready" as const, people: 3, working: false };
    assert.equal(itemMeta(item, NOW), "Aujourd'hui · 32 min");
    assert.equal(itemMeta({ ...item, status: "recording" }, NOW), "Enregistrement…");
    assert.equal(itemMeta({ ...item, working: true }, NOW), "La transcription s'écrit…");
    assert.equal(itemMeta({ ...item, status: "failed" }, NOW), "À réessayer");
    assert.match(noteMeta(note(), NOW), /^Aujourd'hui, 10:00 · 32 min · 3 personnes$/);
    assert.equal(peopleLabel(1), "1 personne");
  });
});

describe("personnes et transcription", () => {
  test("chaque personne a sa couleur, vous en bleu", () => {
    const n = note();
    assert.deepEqual(who(n, "me"), { name: "Vous", color: "#7cc4ff" });
    assert.equal(who(n, "p2").name, "Marc");
    assert.notEqual(who(n, "p2").color, who(n, "p3").color);
    // Une voix inconnue garde son id, avec une couleur.
    assert.equal(who(n, "pc").name, "pc");
    assert.equal(speakerColor(6), speakerColor(0));
  });

  test("l'extrait : les trois premières lignes non vides", () => {
    const lines = ["a", " ", "b", "c", "d"].map((text, i) => ({ speaker: "me", start: i, end: i + 1, text }));
    assert.deepEqual(excerpt(lines).map((l) => l.text), ["a", "b", "c"]);
  });

  test("un nom tapé : 1 à 40 caractères", () => {
    assert.equal(cleanName("  Marc "), "Marc");
    assert.equal(cleanName("   "), null);
    assert.equal(cleanName("x".repeat(41)), null);
  });
});

describe("ce qui part", () => {
  test("transcription : Parakeet sur le PC, ou l'audio vers l'API choisie", () => {
    assert.match(transcriptionLeaves({ engine: "parakeet", parakeet: true, sttDestination: null }), /l'audio ne part pas/);
    assert.match(transcriptionLeaves({ engine: "parakeet", parakeet: false, sttDestination: null }), /pas encore téléchargé/);
    assert.match(transcriptionLeaves({ engine: "api", parakeet: false, sttDestination: "api.openai.com" }), /api\.openai\.com/);
    assert.match(transcriptionLeaves({ engine: "api", parakeet: true, sttDestination: null }), /ajoutez une clé/);
  });

  test("résumé : le texte part vers l'IA de Parler à Ondine, jamais l'audio", () => {
    assert.match(summaryLeaves({ destination: "api.anthropic.com", key: true }), /jamais l'audio\) part vers api\.anthropic\.com/);
    assert.match(summaryLeaves({ destination: "api.anthropic.com", key: false }), /ajoutez d'abord votre clé/);
    assert.match(summaryLeaves(null), /activez ce module/);
  });
});

describe("le manifeste", () => {
  const m = JSON.parse(readFileSync("src/modules/callnotes/manifest.json", "utf8")) as {
    id: string;
    settings: { fields: { key: string; default: unknown }[] };
    events: { emits: string[]; listens: string[] };
  };
  const field = (k: string) => m.settings.fields.find((f) => f.key === k);

  test("réglages sûrs par défaut : Parakeet sur le PC, pas de résumé tout seul", () => {
    assert.equal(m.id, "callnotes");
    assert.equal(field("engine")?.default, "parakeet");
    assert.equal(field("autoSummary")?.default, false);
  });

  test("la pilule peut lancer et arrêter, et suivre l'état", () => {
    for (const t of ["callnotes.start", "callnotes.stop"]) assert.ok(m.events.listens.includes(t), t);
    assert.ok(m.events.emits.includes("callnotes.state"));
  });
});
