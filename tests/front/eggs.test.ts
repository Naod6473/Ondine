// Tests des surprises cachées (src/eggs/) : le calendrier, la météo, les mots
// magiques du Lanceur, le code Konami, les tours de souris et le carnet.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, isHot, isRainy, musicPlaying, seasonOf } from "../../src/eggs/calendar";
import { clockAccessory } from "../../src/eggs/context";
import { found, TREASURES } from "../../src/eggs/treasures";
import { KeySequence, KONAMI, magicWord, normalizeWord, SpinCounter } from "../../src/eggs/words";

describe("calendrier", () => {
  const on = (m: number, d: number) => seasonOf(new Date(2026, m - 1, d, 12));
  test("les jours de fête", () => {
    assert.equal(on(1, 1), "new-year");
    assert.equal(on(2, 14), "valentine");
    assert.equal(on(4, 1), "april-fool");
    assert.equal(on(6, 21), "music-day");
    assert.equal(on(7, 14), "bastille");
    assert.equal(on(10, 31), "halloween");
    assert.equal(on(12, 1), "snow");
    assert.equal(on(12, 31), "snow");
  });
  test("un jour ordinaire : rien", () => {
    assert.equal(on(10, 7), null);
    assert.equal(on(1, 2), null);
    assert.equal(on(4, 2), null);
  });
  test("dayKey : date locale à deux chiffres", () => {
    assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });
});

describe("météo", () => {
  test("pluie : par l'icône ou le libellé", () => {
    assert.ok(isRainy({ icon: "🌧️", temp: "12°C", label: "Nuageux" }));
    assert.ok(isRainy({ icon: "☁️", temp: "12°C", label: "Averses légères" }));
    assert.ok(isRainy({ icon: "☁️", temp: "54°F", label: "Light drizzle" }));
    assert.ok(!isRainy({ icon: "☀️", temp: "25°C", label: "Ensoleillé" }));
    assert.ok(!isRainy(null));
  });
  test("canicule : 35 °C ou 95 °F", () => {
    assert.ok(isHot({ icon: "☀️", temp: "36°C", label: "" }));
    assert.ok(isHot({ icon: "☀️", temp: "35°C", label: "" }));
    assert.ok(!isHot({ icon: "☀️", temp: "34°C", label: "" }));
    assert.ok(isHot({ icon: "☀️", temp: "97°F", label: "" }));
    assert.ok(!isHot({ icon: "☀️", temp: "40°F", label: "" }));
    assert.ok(!isHot(null));
  });
});

describe("mots magiques", () => {
  test("accents, majuscules et ponctuation ignorés", () => {
    assert.equal(normalizeWord("  Réveille-toi ! "), "reveille toi");
    assert.equal(magicWord("Réveille-toi !"), "code-rain");
    assert.equal(magicWord("wake up"), "code-rain");
    assert.equal(magicWord("RÉTRO"), "retro");
    assert.equal(magicWord("8-bits"), "retro");
    assert.equal(magicWord("Do a barrel roll"), "barrel-roll");
    assert.equal(magicWord("la réponse ?"), "answer");
  });
  test("le texte entier seulement : une vraie recherche passe", () => {
    assert.equal(magicWord("retroplanning"), null);
    assert.equal(magicWord("42"), null, "« 42 » reste un minuteur de 42 min");
    assert.equal(magicWord(""), null);
  });
});

describe("code Konami", () => {
  test("la suite exacte, majuscules comprises", () => {
    const k = new KeySequence();
    const keys = [...KONAMI.slice(0, 8), "B", "A"];
    assert.deepEqual(keys.map((key) => k.push(key)), [false, false, false, false, false, false, false, false, false, true]);
  });
  test("avec des touches en trop avant, et ↑ répété", () => {
    const k = new KeySequence();
    const results = ["x", "ArrowUp", ...KONAMI].map((key) => k.push(key));
    assert.equal(results[results.length - 1], true);
    assert.equal(results.filter(Boolean).length, 1);
  });
  test("une erreur au milieu : rien", () => {
    const k = new KeySequence();
    const keys = [...KONAMI.slice(0, 5), "ArrowUp", ...KONAMI.slice(6)];
    assert.ok(!keys.map((key) => k.push(key)).some(Boolean));
  });
});

describe("tours de souris", () => {
  /** n tours de cercle de rayon r, en `steps` pas par tour, toutes les 16 ms. */
  function circle(c: SpinCounter, turns: number, r = 60, steps = 24, dir = 1, t0 = 0): boolean {
    let hit = false;
    for (let i = 0; i <= turns * steps; i++) {
      const a = (dir * i * 2 * Math.PI) / steps;
      hit = c.push(Math.cos(a) * r, Math.sin(a) * r, t0 + i * 16) || hit;
    }
    return hit;
  }
  test("deux tours dans un sens", () => {
    assert.ok(circle(new SpinCounter(), 2.1));
    assert.ok(circle(new SpinCounter(), 2.1, 60, 24, -1));
  });
  test("un tour et demi : pas encore", () => {
    assert.ok(!circle(new SpinCounter(), 1.5));
  });
  test("trop près ou trop loin : ne compte pas", () => {
    assert.ok(!circle(new SpinCounter(), 3, 10));
    assert.ok(!circle(new SpinCounter(), 3, 400));
  });
  test("trop lent : on recommence", () => {
    const c = new SpinCounter();
    let hit = false;
    for (let i = 0; i <= 3 * 24; i++) {
      const a = (i * 2 * Math.PI) / 24;
      hit = c.push(Math.cos(a) * 60, Math.sin(a) * 60, i * 700) || hit;
    }
    assert.ok(!hit);
  });
});

describe("carnet des trésors", () => {
  test("ids uniques, au format du Rust ([a-z0-9-], 32 caractères au plus)", () => {
    const ids = TREASURES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9-]{1,32}$/);
  });
  test("les trésors trouvés, dans l'ordre du carnet, ids inconnus ignorés", () => {
    assert.deepEqual(
      found(["split", "inconnu", "code-rain"]).map((t) => t.id),
      ["code-rain", "split"],
    );
  });
});

describe("accessoires de l'heure", () => {
  // 2026-10-09 est un vendredi, 2026-10-05 un lundi.
  test("vendredi soir : lunettes de soleil", () => {
    assert.equal(clockAccessory(new Date(2026, 9, 9, 17, 0)), "glasses");
    assert.equal(clockAccessory(new Date(2026, 9, 9, 16, 59)), null);
  });
  test("la nuit : bonnet", () => {
    assert.equal(clockAccessory(new Date(2026, 9, 7, 2, 0)), "nightcap");
    assert.equal(clockAccessory(new Date(2026, 9, 7, 5, 59)), "nightcap");
    assert.equal(clockAccessory(new Date(2026, 9, 7, 6, 0)), null);
  });
  test("lundi matin : café", () => {
    assert.equal(clockAccessory(new Date(2026, 9, 5, 9, 0)), "coffee");
    assert.equal(clockAccessory(new Date(2026, 9, 5, 10, 30)), null);
    assert.equal(clockAccessory(new Date(2026, 9, 6, 9, 0)), null);
  });
});

describe("danse : la musique joue-t-elle ?", () => {
  test("le morceau en lecture fait danser, en pause ou arrêté non", () => {
    assert.equal(musicPlaying({ playing: { status: "playing" } }), true);
    assert.equal(musicPlaying({ playing: { status: "paused" } }), false);
    assert.equal(musicPlaying({ playing: { status: "stopped" } }), false);
    assert.equal(musicPlaying({ playing: null }), false);
    assert.equal(musicPlaying(null), false);
  });
  test("entre deux morceaux, on ne sait pas (la danse continue)", () => {
    assert.equal(musicPlaying({ playing: { status: "changing" } }), null);
  });
});
