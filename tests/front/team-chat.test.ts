// Tests du chat Équipe, côté front (src/modules/team/chat-logic.ts) : liens
// jamais ouverts tout seuls (découpés à part), réactions, « Lu », « … écrit »,
// notifications discrètes, ordre des conversations, et la traduction anglaise
// des textes à variable (même recherche que t() dans i18n.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discreet, GROUP, lastReadIndex, linkParts, preview, reactionCounts, reactionEmotion, REACTIONS, roomOrder, timeLabel, typingLabel, unreadTotal, type ChatLine, type RoomView } from "../../src/modules/team/chat-logic";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };

function en(fr: string): string {
  const s = fr.trim();
  if (s in DICT.exact) return DICT.exact[s];
  for (const [rx, rep] of DICT.patterns) {
    const re = new RegExp(rx);
    if (re.test(s)) return s.replace(re, rep);
  }
  return fr;
}

function line(id: number, from: string, read = false, kind: ChatLine["kind"] = "text"): ChatLine {
  return { id, from, kind, text: "x", at: 0, read, reactions: [] };
}

describe("chat Équipe : petits calculs", () => {
  test("les liens sont découpés à part, sans la ponctuation du bout", () => {
    assert.deepEqual(linkParts("Regarde https://exemple.fr/doc. C'est bien"), [
      { text: "Regarde " },
      { text: "https://exemple.fr/doc", link: "https://exemple.fr/doc" },
      { text: ". C'est bien" },
    ]);
    assert.deepEqual(linkParts("(http://a.fr)"), [{ text: "(" }, { text: "http://a.fr", link: "http://a.fr" }, { text: ")" }]);
    // Pas de lien : file:, javascript:, « https:// » tout seul.
    for (const t of ["file:///C:/x.exe", "javascript:alert(1)", "https://", "ms-settings:privacy"]) {
      assert.ok(linkParts(t).every((p) => !p.link), t);
    }
    // Le texte entier se retrouve, morceau par morceau.
    const text = "a https://b.fr/c?d=1, puis http://e.fr !";
    assert.equal(linkParts(text).map((p) => p.text).join(""), text);
  });

  test("réactions regroupées, la mienne repérée, et une expression de la mascotte pour chacune", () => {
    const counts = reactionCounts([["", "thumb"], ["bob", "thumb"], ["eve", "heart"]]);
    assert.deepEqual(counts, [
      { kind: "thumb", icon: "👍", count: 2, mine: true },
      { kind: "heart", icon: "❤️", count: 1, mine: false },
    ]);
    assert.deepEqual(reactionCounts([["x", "inconnue"]]), []);
    for (const r of REACTIONS) assert.ok(reactionEmotion(r.kind));
    assert.equal(reactionEmotion("laugh"), "laugh");
  });

  test("« Lu » sous mon dernier message, seulement s'il est lu", () => {
    assert.equal(lastReadIndex([line(1, "", true), line(2, "bob"), line(3, "", true)]), 2);
    assert.equal(lastReadIndex([line(1, "", true), line(2, "", false)]), -1);
    assert.equal(lastReadIndex([line(1, "", true), line(2, "bob")]), 0);
    assert.equal(lastReadIndex([line(1, "", true), line(2, "", false, "file-out")]), 0);
    assert.equal(lastReadIndex([]), -1);
  });

  test("« … écrit », traduit en anglais", () => {
    assert.equal(typingLabel([]), "");
    assert.equal(typingLabel(["Léa"]), "Léa écrit…");
    assert.equal(en(typingLabel(["Léa"])), "Léa is typing…");
    assert.equal(en(typingLabel(["Léa", "Karim"])), "Léa and Karim are typing…");
    assert.equal(en(typingLabel(["a", "b", "c"])), "Several teammates are typing…");
    assert.equal(en("💬 Léa · Toute l'équipe"), "💬 Léa · Whole team");
    assert.equal(en("Répondre à Léa"), "Reply to Léa");
    assert.equal(en("3 en ligne"), "3 online");
  });

  test("concentration et réunion : notifications discrètes", () => {
    assert.ok(discreet("focus"));
    assert.ok(discreet("meeting"));
    assert.ok(!discreet("available"));
    assert.ok(!discreet("away"));
    assert.ok(!discreet(undefined));
  });

  test("non lus, aperçu, heure", () => {
    const rooms: RoomView[] = [
      { room: GROUP, unread: 2, last: null, typing: [] },
      { room: "bob", unread: 3, last: null, typing: [] },
    ];
    assert.equal(unreadTotal(rooms), 5);
    assert.equal(preview("  une\n  ligne  "), "une ligne");
    assert.equal(preview("x".repeat(200), 10).length, 10);
    const noon = new Date(2026, 9, 10, 12, 5).getTime();
    assert.equal(timeLabel(noon, noon + 1000), "12:05");
    assert.equal(timeLabel(noon, noon + 2 * 86_400_000), "10/10 12:05");
  });

  test("les conversations : non lus d'abord, puis en ligne ; hors ligne seulement avec un historique", () => {
    const peers = [
      { id: "a", name: "Alice", online: true },
      { id: "b", name: "Bob", online: true },
      { id: "z", name: "Zoé", online: false },
      { id: "y", name: "Yann", online: false },
    ];
    const rooms: RoomView[] = [
      { room: "b", unread: 1, last: null, typing: [] },
      { room: "z", unread: 0, last: line(1, "z"), typing: [] },
    ];
    assert.deepEqual(roomOrder(peers, rooms).map((p) => p.name), ["Bob", "Alice", "Zoé"]);
  });
});
