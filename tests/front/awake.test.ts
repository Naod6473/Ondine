// Tests de « Rester éveillé » (src/modules/awake/logic.ts) : textes du compte
// à rebours, heure « jusqu'à 18:30 », confirmation de l'arrêt programmé, ce
// que montre la mini-île, et leur traduction. Ce qui décide vraiment (durées,
// dernier avertissement, téléchargements) est testé côté Rust (awake_logic.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION_ICONS,
  ACTIONS,
  type AwakeState,
  cleanState,
  clockOf,
  compactLine,
  confirmText,
  countdown,
  IDLE_STATE,
  keepText,
  nextClock,
  planArgs,
  planText,
  warnTitle,
} from "../../src/modules/awake/logic";
import { MODULES_OFF_BY_DEFAULT } from "../../src/core/settings-store";
import { MODULE_CATEGORIES } from "../../src/settings/layout";

const DICT = JSON.parse(readFileSync("src/core/i18n-en.json", "utf8")) as { exact: Record<string, string>; patterns: [string, string][] };

/** Même recherche que t() (src/core/i18n.ts). */
function english(fr: string): string | undefined {
  if (fr in DICT.exact) return DICT.exact[fr];
  for (const [rx, en] of DICT.patterns) {
    const m = new RegExp(rx).exec(fr);
    if (m) return en.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? "");
  }
  return undefined;
}

/** Un instant fixe : le 16 octobre 2026 à 14:20, heure locale. */
const NOW = new Date(2026, 9, 16, 14, 20, 0).getTime();

describe("rester éveillé : le temps", () => {
  test("compte à rebours", () => {
    assert.equal(countdown(42_000), "0:42");
    assert.equal(countdown(4 * 60_000 + 9_000), "4:09");
    assert.equal(countdown(3_909_000), "1:05:09");
    assert.equal(countdown(-5), "0:00");
    // Une seconde entamée compte : jamais « 0:00 » avant l'heure.
    assert.equal(countdown(400), "0:01");
  });

  test("« 18:30 » : aujourd'hui, ou demain si c'est passé", () => {
    const today = nextClock("18:30", NOW)!;
    assert.equal(clockOf(today), "18:30");
    assert.equal(new Date(today).getDate(), 16);
    const tomorrow = nextClock("09:00", NOW)!;
    assert.equal(new Date(tomorrow).getDate(), 17);
    // Dans moins d'une minute : demain (pas d'arrêt immédiat par erreur).
    assert.equal(new Date(nextClock("14:20", NOW)!).getDate(), 17);
    assert.equal(clockOf(nextClock("7h", NOW)!), "07:00");
    assert.equal(nextClock("25:00", NOW), null);
    assert.equal(nextClock("midi", NOW), null);
  });
});

describe("rester éveillé : l'état", () => {
  test("un état reçu est nettoyé", () => {
    assert.deepEqual(cleanState(null), IDLE_STATE);
    assert.equal(cleanState({ keep: { until: "jamais" } }).keep, null);
    assert.equal(cleanState({ plan: { action: "format" } }).plan, null);
    const s = cleanState({ keep: { until: "forever", at: null, display: false, since: 1 }, coffee: false, downloading: true });
    assert.equal(s.keep?.until, "forever");
    assert.equal(s.coffee, false);
    assert.equal(s.downloading, true);
    assert.equal(s.agentBusy, false);
  });

  test("les phrases de l'éveil et de l'arrêt", () => {
    const at = new Date(2026, 9, 16, 18, 30).getTime();
    assert.equal(keepText({ until: "at", at, display: false, since: NOW }), "Jusqu'à 18:30");
    assert.equal(keepText({ until: "forever", at: null, display: false, since: NOW }), "Sans limite");
    assert.equal(keepText({ until: "agent", at: null, display: false, since: NOW }), "Jusqu'à ce que l'agent ait fini");
    assert.equal(planText({ action: "shutdown", when: "at", at, warned: false }), "Arrêt à 18:30");
    assert.equal(planText({ action: "sleep", when: "download", at: null, warned: false }), "Veille quand le téléchargement sera fini");
    assert.equal(warnTitle("restart", 59.6), "Redémarrage du PC dans 60 s");
  });

  test("la mini-île : l'arrêt programmé passe avant l'éveil", () => {
    const keep: AwakeState["keep"] = { until: "at", at: NOW + 3_600_000, display: false, since: NOW };
    assert.equal(compactLine(IDLE_STATE, NOW), null);
    const k = compactLine({ ...IDLE_STATE, keep }, NOW)!;
    assert.deepEqual([k.kind, k.icon, k.text], ["keep", "☕", "Éveillé · 1:00:00"]);
    assert.equal(compactLine({ ...IDLE_STATE, keep: { ...keep, until: "forever", at: null } }, NOW)!.text, "Éveillé · sans limite");
    const p = compactLine({ ...IDLE_STATE, keep, plan: { action: "lock", when: "at", at: NOW + 90_000, warned: false } }, NOW)!;
    assert.deepEqual([p.kind, p.icon, p.text], ["plan", "🔒", "Verrouillage · 1:30"]);
    assert.equal(compactLine({ ...IDLE_STATE, plan: { action: "shutdown", when: "agent", at: null, warned: false } }, NOW)!.text, "Arrêt · après l'agent");
  });
});

describe("rester éveillé : programmer un arrêt", () => {
  test("la question de la confirmation", () => {
    assert.equal(confirmText({ action: "shutdown", when: "minutes", minutes: 60 }), "Éteindre le PC dans 60 min ?");
    assert.equal(confirmText({ action: "sleep", when: "at", clock: "23:00" }), "Mettre en veille le PC à 23:00 ?");
    assert.equal(confirmText({ action: "restart", when: "download" }), "Redémarrer le PC quand le téléchargement sera fini ?");
    assert.equal(confirmText({ action: "lock", when: "agent" }), "Verrouiller le PC quand l'agent aura fini ?");
  });

  test("les arguments envoyés au Rust portent toujours la confirmation", () => {
    const ok = planArgs({ action: "shutdown", when: "minutes", minutes: 45 }, NOW);
    assert.ok("args" in ok);
    assert.deepEqual(ok.args, { action: "shutdown", when: "minutes", minutes: 45, confirmed: true });
    const at = planArgs({ action: "sleep", when: "at", clock: "18:30" }, NOW);
    assert.ok("args" in at && at.args.at === nextClock("18:30", NOW));
    assert.ok("error" in planArgs({ action: "shutdown", when: "minutes", minutes: 0 }, NOW));
    assert.ok("error" in planArgs({ action: "shutdown", when: "minutes", minutes: 5000 }, NOW));
    assert.ok("error" in planArgs({ action: "shutdown", when: "at", clock: "plus tard" }, NOW));
    const dl = planArgs({ action: "lock", when: "download" }, NOW);
    assert.ok("args" in dl && dl.args.confirmed === true);
  });
});

describe("rester éveillé : le module", () => {
  const manifest = JSON.parse(readFileSync("src/modules/awake/manifest.json", "utf8")) as {
    id: string;
    permissions: string[];
    settings: { fields: { key: string; essential?: boolean }[] };
    commands: string[];
  };

  test("coupé par défaut, rangé dans « Le PC au quotidien », sans permission", () => {
    assert.ok(MODULES_OFF_BY_DEFAULT.includes("awake"));
    assert.match(readFileSync("src-tauri/src/services/settings.rs", "utf8"), /MODULES_OFF_BY_DEFAULT[^\n]*"awake"/);
    assert.ok(MODULE_CATEGORIES.find((c) => c.id === "daily")!.modules.includes("awake"));
    assert.deepEqual(manifest.permissions, []);
    for (const c of ["status", "keep", "stop", "toggle", "plan", "cancel_plan", "snooze_plan"]) assert.ok(manifest.commands.includes(c), c);
  });

  test("chaque action a son pictogramme au trait", () => {
    const icons = readFileSync("src/island/icon.ts", "utf8");
    for (const a of ACTIONS) assert.ok(icons.includes(`"${ACTION_ICONS[a].replace(/️/g, "")}`), a);
  });

  test("les textes variables ont leur traduction anglaise", () => {
    const at = new Date(2026, 9, 16, 18, 30).getTime();
    const cases: [string, string][] = [
      [keepText({ until: "at", at, display: false, since: NOW }), "Until 18:30"],
      [planText({ action: "restart", when: "at", at, warned: false }), "Restart at 18:30"],
      [planText({ action: "lock", when: "agent", at: null, warned: false }), "Lock when the agent is done"],
      [confirmText({ action: "sleep", when: "minutes", minutes: 30 }), "Put the PC to sleep in 30 min?"],
      [confirmText({ action: "shutdown", when: "at", clock: "23:00" }), "Shut down the PC at 23:00?"],
      [compactLine({ ...IDLE_STATE, keep: { until: "at", at: NOW + 65_000, display: false, since: NOW } }, NOW)!.text, "Awake · 1:05"],
      [compactLine({ ...IDLE_STATE, plan: { action: "sleep", when: "at", at: NOW + 3_700_000, warned: false } }, NOW)!.text, "Sleep · 1:01:40"],
      [warnTitle("shutdown", 60), "PC shutdown in 60 s"],
      ["Encore 4:09", "4:09 left"],
      ["Encore 15 min", "15 more min"],
    ];
    for (const [fr, en] of cases) assert.equal(english(fr), en, fr);
  });
});
