// Tests de la rangée de pilules de l'onglet Agents IA (src/modules/agents/pills-logic.ts) :
// quelles pilules, dans quel ordre, avec quel badge, branché ou pas, et quelle
// carte montrer sous la rangée.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addable,
  agentColor,
  askPill,
  buildPills,
  cardFor,
  defaultPill,
  foldList,
  hookKeyOf,
  needsSetup,
  parseIds,
  pillOfSource,
  planPill,
  plugState,
  type HookInfo,
  type PillsInput,
  type SessionLite,
} from "../../src/modules/agents/pills-logic";

const ALL = ["claude", "codex", "gemini", "copilot", "cursor", "qwen", "goose", "opencode", "kiro", "hermes", "aider", "amp"];
const input = (over: Partial<PillsInput> = {}): PillsInput => ({ proposed: ALL, added: [], sessions: [], asks: [], hooks: {}, permOn: false, ...over });
const ids = (i: PillsInput) => buildPills(i).map((p) => p.id);
const s = (id: string, source: string, state: SessionLite["state"]): SessionLite => ({ id, source, state });

describe("sources et hooks", () => {
  test("la pilule d'une source de hooks", () => {
    assert.equal(pillOfSource("claude-code"), "claude");
    assert.equal(pillOfSource("codex"), "codex");
    assert.equal(pillOfSource("copilot"), "copilot");
    assert.equal(pillOfSource("other"), "other");
    assert.equal(pillOfSource("inconnu"), "inconnu");
  });
  test("seuls les outils à hooks ont une clé d'installation", () => {
    assert.equal(hookKeyOf("claude"), "claude-code");
    assert.equal(hookKeyOf("goose"), "goose");
    assert.equal(hookKeyOf("aider"), undefined);
    assert.equal(hookKeyOf("other"), undefined);
  });
  test("une couleur par agent, différente, et une de secours", () => {
    const colors = ALL.map(agentColor);
    assert.equal(new Set(colors).size, colors.length);
    assert.match(agentColor("inconnu"), /^#[0-9a-f]{6}$/);
  });
});

describe("branché ou pas", () => {
  const h = (info: HookInfo) => ({ "claude-code": info, codex: info });
  test("les états", () => {
    assert.equal(plugState("claude", null, false), "unknown");
    assert.equal(plugState("claude", {}, false), "off");
    assert.equal(plugState("claude", h({ state: "absent" }), false), "off");
    assert.equal(plugState("claude", h({ state: "installed", permission: false }), false), "ready");
    assert.equal(plugState("claude", h({ state: "installed", incomplete: true }), false), "update");
    assert.equal(plugState("claude", h({ state: "stale" }), false), "stale");
    assert.equal(plugState("claude", h({ state: "unreadable" }), false), "broken");
    assert.equal(plugState("aider", h({ state: "installed" }), false), "none");
  });
  test("« Autoriser / Refuser » activé : Claude Code et Codex sans le hook d'autorisation sont à mettre à jour", () => {
    assert.equal(plugState("claude", h({ state: "installed", permission: false }), true), "update");
    assert.equal(plugState("codex", h({ state: "installed", permission: true }), true), "ready");
    // Gemini CLI ne sait pas autoriser : le réglage ne le concerne pas.
    assert.equal(plugState("gemini", { gemini: { state: "installed", permission: false } }, true), "ready");
  });
  test("la carte « Brancher » seulement quand il manque quelque chose", () => {
    assert.deepEqual(
      (["ready", "update", "stale", "off", "broken", "none", "unknown"] as const).filter(needsSetup),
      ["update", "stale", "off", "broken"],
    );
  });
});

describe("les pilules", () => {
  test("par défaut : Claude Code, Codex, Gemini CLI", () => {
    assert.deepEqual(ids(input()), ["claude", "codex", "gemini"]);
    // Liste des outils pas encore lue : les trois aussi.
    assert.deepEqual(ids(input({ proposed: null })), ["claude", "codex", "gemini"]);
  });
  test("un agent décoché revient s'il a une session ou des hooks", () => {
    const proposed = ["claude", "codex"];
    assert.deepEqual(ids(input({ proposed })), ["claude", "codex"]);
    assert.deepEqual(ids(input({ proposed, sessions: [s("g", "gemini", "done")] })), ["claude", "codex", "gemini"]);
    assert.deepEqual(ids(input({ proposed, hooks: { gemini: { state: "installed" } } })), ["claude", "codex", "gemini"]);
  });
  test("les outils ajoutés, ceux déjà branchés, ceux qui ont une session", () => {
    assert.deepEqual(ids(input({ added: ["aider", "inconnu", "aider"] })), ["claude", "codex", "gemini", "aider"]);
    assert.deepEqual(ids(input({ hooks: { cursor: { state: "installed" } } })), ["claude", "codex", "gemini", "cursor"]);
    assert.deepEqual(ids(input({ sessions: [s("x", "other", "working")] })), ["other", "claude", "codex", "gemini"]);
  });
  test("ordre : ceux qui attendent, puis qui travaillent, puis les autres", () => {
    const pills = buildPills(
      input({
        sessions: [s("a", "gemini", "working"), s("b", "codex", "waiting"), s("c", "claude-code", "done")],
      }),
    );
    assert.deepEqual(
      pills.map((p) => [p.id, p.badge]),
      [
        ["codex", "waiting"],
        ["gemini", null],
        ["claude", "done"],
      ],
    );
  });
  test("une question en attente met le badge « attend », même sans session", () => {
    const pills = buildPills(input({ asks: [{ session: "", who: "Codex" }] }));
    assert.equal(pills[0].id, "codex");
    assert.equal(pills[0].badge, "waiting");
  });
  test("badge erreur : hooks sur un ancien chemin ou fichier illisible", () => {
    const pills = buildPills(input({ hooks: { codex: { state: "stale" }, gemini: { state: "unreadable" } } }));
    assert.deepEqual(
      pills.map((p) => p.badge),
      [null, "error", "error"],
    );
  });
  test("le nombre de sessions en cours (qui travaillent ou attendent)", () => {
    const [claude] = buildPills(input({ sessions: [s("a", "claude-code", "working"), s("b", "claude-code", "waiting"), s("c", "claude-code", "done")] }));
    assert.equal(claude.active, 2);
    assert.equal(claude.badge, "waiting");
  });
  test("« a fini » seulement si plus rien ne travaille", () => {
    const [claude] = buildPills(input({ sessions: [s("a", "claude-code", "working"), s("c", "claude-code", "done")] }));
    assert.equal(claude.badge, null);
    assert.equal(claude.working, true);
  });
  test("« + » propose les outils pas encore dans la rangée", () => {
    const more = addable(["claude", "codex", "gemini"]);
    assert.ok(!more.includes("claude"));
    assert.ok(more.includes("aider") && more.includes("other"));
  });
});

describe("questions", () => {
  const sessions = [s("s1", "codex", "waiting")];
  test("par la session, sinon par le prénom", () => {
    assert.equal(askPill({ session: "s1", who: "Claude" }, sessions), "codex");
    assert.equal(askPill({ session: "", who: "Claude" }, sessions), "claude");
    assert.equal(askPill({ session: "", who: "Gemini CLI" }, sessions), "gemini");
    assert.equal(askPill({ session: "?", who: "" }, sessions), null);
  });
});

describe("la pilule au premier plan et sa carte", () => {
  const pills = buildPills(input({ hooks: { gemini: { state: "installed" } }, sessions: [s("a", "codex", "working")] }));
  test("le choix retenu, sinon celle qui travaille, sinon un agent branché, sinon aucune", () => {
    assert.equal(defaultPill(pills, "claude"), "claude");
    assert.equal(defaultPill(pills, "parti"), "codex");
    assert.equal(defaultPill(buildPills(input({ hooks: { gemini: { state: "installed" } } })), null), "gemini");
    assert.equal(defaultPill(buildPills(input()), null), null);
  });
  test("la carte à montrer", () => {
    const base = { panel: "agent" as const, selected: "claude", plug: "off" as const, later: false, configOpen: false };
    assert.equal(cardFor({ ...base, selected: null }), "welcome");
    assert.equal(cardFor(base), "setup");
    assert.equal(cardFor({ ...base, later: true }), "agent");
    assert.equal(cardFor({ ...base, plug: "ready" }), "agent");
    assert.equal(cardFor({ ...base, plug: "ready", configOpen: true }), "setup");
    assert.equal(cardFor({ ...base, plug: "none" }), "agent");
    assert.equal(cardFor({ ...base, plug: "unknown" }), "agent");
    assert.equal(cardFor({ ...base, panel: "plan" }), "plan");
    assert.equal(cardFor({ ...base, panel: "add", selected: null }), "add");
  });
});

describe("petites pilules et mémoire locale", () => {
  const now = 1_000_000;
  test("« 5 h · 42 % », la semaine à défaut, rien sans chiffres", () => {
    assert.deepEqual(planPill({ fiveHour: { pct: 42.4, resetsAt: now + 1 }, week: { pct: 90, resetsAt: now + 1 }, updatedAt: now }, now), { label: "5 h · 42 %", level: "ok" });
    assert.deepEqual(planPill({ fiveHour: null, week: { pct: 91, resetsAt: now + 1 }, updatedAt: now }, now), { label: "Sem. · 91 %", level: "high" });
    // Remise à zéro passée : 0 %.
    assert.deepEqual(planPill({ fiveHour: { pct: 80, resetsAt: now - 1 }, week: null, updatedAt: now }, now), { label: "5 h · 0 %", level: "ok" });
    assert.equal(planPill(null, now), null);
    assert.equal(planPill({ fiveHour: null, week: null, updatedAt: now }, now), null);
  });
  test("une liste gardée : seulement des identifiants valides, sans doublon", () => {
    assert.deepEqual(parseIds('["aider","aider","amp"]'), ["aider", "amp"]);
    assert.deepEqual(parseIds('["<script>", 3, "kiro"]'), ["kiro"]);
    assert.deepEqual(parseIds("{"), []);
    assert.deepEqual(parseIds(null), []);
    assert.deepEqual(parseIds('{"a":1}'), []);
  });
  test("les derniers messages : 3, puis repliés", () => {
    assert.deepEqual(foldList([1, 2, 3, 4, 5], false), { shown: [1, 2, 3], hidden: 2 });
    assert.deepEqual(foldList([1, 2, 3, 4, 5], true), { shown: [1, 2, 3, 4, 5], hidden: 0 });
    assert.deepEqual(foldList([1, 2], false), { shown: [1, 2], hidden: 0 });
  });
});
