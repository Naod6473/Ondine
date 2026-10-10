// Tests de la danse selon la musique : le style (genre, tempo, énergie,
// Calme), le temps qui suit la musique sans à-coup, le halo qui bat sur les
// temps, et les danses des 15 mascottes (src/mascot/beat.ts,
// src/mascot/renderers/gum-dances.ts). L'estimation du tempo elle-même est
// testée côté Rust (src-tauri/src/modules/media_tempo.rs).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  beatFrom,
  beatPhase,
  BeatFollower,
  cleanBpm,
  DANCE_ANIM,
  DANCE_STYLES,
  danceStyle,
  genreOf,
  guessStyle,
  haloBeatMs,
  isDanceAnim,
  sameBeat,
  steadyStyle,
  STYLE_BPM,
  STYLE_SWITCH_AFTER,
  styleFromGenre,
  styleOfAnim,
  trackOf,
} from "../../src/mascot/beat";
import { DANCE_HANDS, DANCES, type DanceHandPose } from "../../src/mascot/renderers/gum-dances";
import { ANIMS, faceOf } from "../../src/mascot/renderers/gum-anims";
import { FACE_BASE, NO_PROPS } from "../../src/mascot/renderers/gum-draw";
import { SHAPES, SHAPE_IDS } from "../../src/mascot/renderers/gum-shapes";
import { beatPulse, MIN_PERIOD_MS } from "../../src/island/halo-palettes";
import { GUM_FAMILY } from "../../src/mascot/gum-family";

describe("le style de la danse", () => {
  test("d'après le genre donné par le lecteur", () => {
    assert.equal(styleFromGenre("Rock"), "rock");
    assert.equal(styleFromGenre("Rock alternatif"), "rock");
    assert.equal(styleFromGenre("Heavy Metal"), "metal");
    assert.equal(styleFromGenre("Hip-Hop/Rap"), "rap");
    assert.equal(styleFromGenre("Trap"), "rap");
    assert.equal(styleFromGenre("R&B"), "rnb");
    assert.equal(styleFromGenre("Soul"), "rnb");
    assert.equal(styleFromGenre("Pop"), "pop");
    assert.equal(styleFromGenre("Variété française"), "pop");
    assert.equal(styleFromGenre("Electronic"), "electro");
    assert.equal(styleFromGenre("Deep House"), "electro");
    assert.equal(styleFromGenre("Électro pop"), "electro");
    assert.equal(styleFromGenre("Pop rock"), "rock");
    assert.equal(styleFromGenre("Reggae"), "reggae");
    assert.equal(styleFromGenre("Jazz"), "jazz");
    assert.equal(styleFromGenre("Lo-fi"), "jazz");
    assert.equal(styleFromGenre("Classique"), "jazz");
    assert.equal(styleFromGenre(""), null);
    assert.equal(styleFromGenre("Podcast"), null);
    assert.equal(styleFromGenre(null), null);
  });

  test("sans genre : d'après le tempo et l'énergie", () => {
    assert.equal(guessStyle(70, 0.1), "jazz");
    assert.equal(guessStyle(76, 0.25), "reggae");
    assert.equal(guessStyle(76, 0.4), "rnb");
    assert.equal(guessStyle(92, 0.35), "rap");
    assert.equal(guessStyle(110, 0.3), "pop");
    assert.equal(guessStyle(128, 0.45), "electro");
    assert.equal(guessStyle(128, 0.2), "pop");
    assert.equal(guessStyle(145, 0.4), "rock");
    assert.equal(guessStyle(170, 0.5), "metal");
    assert.equal(guessStyle(170, 0.3), "rock");
    for (let bpm = 60; bpm <= 200; bpm += 5) assert.ok(DANCE_STYLES.includes(guessStyle(bpm, 0.3)));
  });

  test("Calme ou animations réduites : un simple hochement ; puis le réglage, le genre, le tempo", () => {
    assert.equal(danceStyle({ still: true, setting: "metal", genre: "Rock", bpm: 120 }), "nod");
    assert.equal(danceStyle({ setting: "reggae", genre: "Rock", bpm: 170 }), "reggae");
    assert.equal(danceStyle({ setting: "auto", genre: "Rock", bpm: 92 }), "rock");
    assert.equal(danceStyle({ setting: "auto", genre: "Podcast", bpm: 92, energy: 0.3 }), "rap");
    assert.equal(danceStyle({ setting: "n'importe quoi", bpm: null }), "pop");
    assert.equal(danceStyle({ setting: "auto", bpm: 300 }), "pop");
  });

  test("un style deviné ne change pas à chaque mesure", () => {
    let st = steadyStyle(null, "pop", true, 0);
    assert.equal(st.style, "pop");
    for (let i = 1; i < STYLE_SWITCH_AFTER; i++) {
      st = steadyStyle(st.style, "electro", true, st.pending);
      assert.equal(st.style, "pop", `mesure ${i}`);
    }
    st = steadyStyle(st.style, "electro", true, st.pending);
    assert.equal(st.style, "electro");
    // Un style choisi, un genre, le hochement : tout de suite.
    assert.equal(steadyStyle("pop", "rock", false, 0).style, "rock");
    assert.equal(steadyStyle("pop", "nod", true, 0).style, "nod");
    // Revenir au style en cours efface l'attente.
    assert.equal(steadyStyle("pop", "pop", true, 2).pending, 0);
  });

  test("genre et morceau lus dans media.changed", () => {
    assert.equal(genreOf({ playing: { title: "A", genre: "Rock" } }), "Rock");
    assert.equal(genreOf({ playing: { title: "A" } }), "");
    assert.equal(genreOf({ playing: null }), "");
    assert.equal(genreOf(null), "");
    assert.equal(trackOf({ playing: { title: "A", artist: "B" } }), "A|B");
    assert.equal(trackOf({ playing: null }), "");
  });

  test("chaque style a son animation et un tempo typique", () => {
    for (const s of [...DANCE_STYLES, "nod" as const]) {
      assert.ok(DANCE_ANIM[s].startsWith("danse-"));
      assert.equal(styleOfAnim(DANCE_ANIM[s]), s);
      assert.ok(STYLE_BPM[s] >= 60 && STYLE_BPM[s] <= 200);
    }
    assert.equal(styleOfAnim("danse"), "pop");
    assert.equal(styleOfAnim("idle"), null);
    assert.ok(isDanceAnim("danse") && isDanceAnim("danse-rock") && !isDanceAnim("idle"));
  });
});

describe("le temps de la musique", () => {
  test("le temps reçu devient un instant de temps dans la fenêtre", () => {
    const b = beatFrom(120, 0.25, 10_000)!;
    assert.equal(b.bpm, 120);
    assert.equal(b.at, 10_000 - 125);
    assert.ok(Math.abs(beatPhase(b, 10_000) - 0.25) < 1e-9);
    assert.ok(Math.abs(beatPhase(b, 10_375)) < 1e-9);
    assert.equal(beatFrom(30, 0, 0), null);
    assert.equal(beatFrom(null, 0, 0), null);
    assert.equal(beatFrom(120, Number.NaN, 0)!.at, 0);
    assert.equal(cleanBpm(201), null);
    assert.equal(cleanBpm(60), 60);
  });

  test("deux mesures presque pareilles ne bougent pas le halo", () => {
    const a = { bpm: 120, at: 0 };
    assert.ok(sameBeat(a, { bpm: 120.5, at: 20 }, 5000));
    assert.ok(sameBeat(a, { bpm: 120, at: 495 }, 5000)); // un temps plus tard, à 5 ms près
    assert.ok(!sameBeat(a, { bpm: 126, at: 0 }, 5000));
    assert.ok(!sameBeat(a, { bpm: 120, at: 120 }, 5000));
    assert.ok(sameBeat(null, null, 0));
    assert.ok(!sameBeat(a, null, 0));
  });

  test("le halo ne bat jamais plus vite que ~2 fois par seconde", () => {
    assert.equal(haloBeatMs(120), 500);
    assert.equal(haloBeatMs(100), 600);
    assert.equal(haloBeatMs(140), 60_000 / 140 * 2);
    for (let bpm = 60; bpm <= 200; bpm++) assert.ok(haloBeatMs(bpm, MIN_PERIOD_MS) >= MIN_PERIOD_MS);
  });

  test("la lueur s'allume sur le temps et retombe", () => {
    assert.ok(beatPulse(0, 500) > 0.99);
    assert.ok(beatPulse(250, 500) < beatPulse(50, 500));
    assert.ok(beatPulse(499, 500) < 0.2);
    assert.ok(beatPulse(500, 500) > 0.99);
    assert.ok(beatPulse(0, 500, true) > 0.99 && beatPulse(150, 500, true) < beatPulse(150, 500));
    // Jamais plus court que MIN_PERIOD_MS, même si on le demande.
    assert.ok(Math.abs(beatPulse(300, 100) - beatPulse(300, MIN_PERIOD_MS)) < 1e-9);
    for (let t = -1000; t < 2000; t += 37) {
      const p = beatPulse(t, 520);
      assert.ok(p >= 0 && p <= 1);
    }
  });

  test("la danse rattrape le temps de la musique sans sauter ni reculer", () => {
    const f = new BeatFollower(120);
    const dt = 1 / 60;
    let now = 0;
    // Elle danse déjà depuis 2 s au tempo typique…
    for (let i = 0; i < 120; i++) f.step(dt, (now += dt * 1000), { bpm: 116, at: 0 });
    // …puis le vrai tempo arrive : 96 BPM, temps décalés.
    const target = { bpm: 96, at: 230 };
    let prev = f.beats;
    let maxStep = 0;
    for (let i = 0; i < 60 * 6; i++) {
      const b = f.step(dt, (now += dt * 1000), target);
      assert.ok(b >= prev, "le compte des temps recule");
      maxStep = Math.max(maxStep, b - prev);
      prev = b;
    }
    // Pas de saut : jamais plus de 1,35 fois le pas normal.
    assert.ok(maxStep <= ((96 / 60) * dt) * 1.36, `saut de ${maxStep}`);
    // Calée : la partie fractionnaire suit la phase de la musique.
    const want = beatPhase(target, now);
    const frac = f.beats - Math.floor(f.beats);
    const d = Math.abs(frac - want);
    assert.ok(Math.min(d, 1 - d) < 0.02, `décalage de ${Math.min(d, 1 - d)} temps`);
    assert.ok(Math.abs(f.bpm - 96) < 0.5);
  });

  test("le premier temps reçu cale la danse tout de suite", () => {
    const f = new BeatFollower(120);
    const b = f.step(1 / 60, 1000, { bpm: 128, at: 900 });
    const want = beatPhase({ bpm: 128, at: 900 }, 1000);
    assert.ok(Math.abs(b - Math.floor(b) - want) < 1e-9);
    // Sans temps : elle continue à son tempo.
    const before = f.beats;
    f.step(0.1, 1100, null);
    assert.ok(Math.abs(f.beats - before - (0.1 * 128) / 60) < 1e-9);
  });
});

describe("les danses des 15 mascottes", () => {
  test("chaque danse donne des nombres, et des mains posées, pour chaque forme", () => {
    for (const [name, fn] of Object.entries(DANCES)) {
      assert.ok(ANIMS[name], `${name} absente d'ANIMS`);
      for (const t of [0, 0.13, 0.5, 1.26, 3.9]) {
        const f = fn(t, (t / 2) % 1, "neutral");
        const { face } = faceOf(f);
        for (const k of Object.keys(FACE_BASE) as (keyof typeof FACE_BASE)[]) assert.ok(Number.isFinite(face[k]), `${name} : ${k}`);
        for (const k of ["squash", "dx", "dy", "rot", "tip"] as const) if (f[k] !== undefined) assert.ok(Number.isFinite(f[k]), `${name} : ${k}`);
        for (const [k, v] of Object.entries(f.prop ?? {})) {
          assert.ok(k in NO_PROPS, `${name} : accessoire inconnu ${k}`);
          assert.ok(Number.isFinite(v));
        }
        // Rien ne part trop loin (la mascotte reste dans sa place).
        assert.ok(Math.abs(f.dx ?? 0) < 0.2 && Math.abs(f.dy ?? 0) < 0.2 && Math.abs(f.rot ?? 0) < 0.25, `${name} part trop loin`);
      }
    }
    for (const pose of Object.keys(DANCE_HANDS) as DanceHandPose[]) {
      for (const id of SHAPE_IDS) {
        for (const t of [0, 0.37, 1.5]) {
          const [a, b] = DANCE_HANDS[pose](t, 0.3, SHAPES[id]);
          for (const h of [a, b]) for (const v of Object.values(h)) assert.ok(Number.isFinite(v), `${pose} / ${id}`);
          assert.ok(Math.abs(a.x ?? 0) < 1.8 && Math.abs(b.x ?? 0) < 1.8 && (a.y ?? 0) > -1.4 && (b.y ?? 0) > -1.4, `${pose} / ${id} : main hors de la place`);
        }
      }
    }
  });

  test("les temps tombent sur les nombres entiers : la tête tombe sur le temps", () => {
    // t = temps / 2 : au temps 3 (t = 1,5), le metal est en bas ; entre deux, relevé.
    const metal = DANCES["danse-metal"];
    assert.ok((metal(1.5, 0, "neutral").squash ?? 1) < (metal(1.75, 0, "neutral").squash ?? 1));
    const nod = DANCES["danse-hochement"];
    assert.ok((nod(2, 0, "neutral").gaze?.y ?? 0) > (nod(2.2, 0, "neutral").gaze?.y ?? 0));
    // Le rap porte la casquette, le rock la guitare, le metal fait les cornes.
    assert.equal(DANCES["danse-rap"](0, 0, "neutral").prop?.cap, 1);
    assert.equal(DANCES["danse-rock"](0, 0, "neutral").prop?.guitar, 1);
    assert.equal(DANCE_HANDS.horns(0, 0, SHAPES.goutte)[0].horns, 1);
    // Le hochement reste discret : pas de mains, pas de grand mouvement.
    const n = nod(2, 0, "neutral");
    assert.equal(n.hands, undefined);
    assert.ok(Math.abs((n.squash ?? 1) - 1) <= 0.05);
  });

  test("le manifeste des mascottes gomme a toutes les danses, en boucle", () => {
    const m = JSON.parse(readFileSync("mascots/goutte-gomme/manifest.json", "utf8")) as { animations: { name: string; loop: boolean; source: { function?: string } }[] };
    for (const anim of Object.values(DANCE_ANIM)) {
      const a = m.animations.find((x) => x.name === anim);
      assert.ok(a?.loop, `${anim} manquante ou pas en boucle`);
      assert.ok(DANCES[a.source.function ?? anim], `${anim} : pas de fonction`);
    }
    // Les 15 mascottes partagent ce manifeste (gum-family.ts).
    assert.ok(GUM_FAMILY.length >= 14);
  });
});
