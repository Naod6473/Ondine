// Tests de la carte Musique (1.2.4) : src/modules/media/logic.ts.
// Temps restant, niveau de l'icône du volume, état des boutons, répétition,
// couleur de la carte et envois limités pendant un glissé.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appName, buttons, cardTint, clock, nextRepeat, remaining, throttle, volumeLevel, type NowPlaying } from "../../src/modules/media/logic";

const song = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  app: "Spotify.exe",
  title: "Marée haute",
  artist: "Lumen",
  album: "Rivages",
  status: "playing",
  positionMs: 102_000,
  durationMs: 235_000,
  canToggle: true,
  canNext: true,
  canPrevious: true,
  canSeek: true,
  shuffle: true,
  repeat: "none",
  canShuffle: true,
  canRepeat: true,
  ...over,
});

describe("musique : temps", () => {
  test("temps écoulé en minutes:secondes, et en heures au-delà", () => {
    assert.equal(clock(0), "0:00");
    assert.equal(clock(83_000), "1:23");
    assert.equal(clock(83_999), "1:23");
    assert.equal(clock(3_723_000), "1:02:03");
    assert.equal(clock(-5), "0:00");
  });

  test("temps restant avec un signe moins, comme la maquette", () => {
    assert.equal(remaining(102_000, 235_000), "-2:13");
    assert.equal(remaining(0, 235_000), "-3:55");
    // Arrondi vers le haut : jamais « -0:00 » tant qu'il reste un peu.
    assert.equal(remaining(234_500, 235_000), "-0:01");
    assert.equal(remaining(235_000, 235_000), "-0:00");
    // Position au-delà de la fin, ou négative : bornée.
    assert.equal(remaining(240_000, 235_000), "-0:00");
    assert.equal(remaining(-1000, 60_000), "-1:00");
  });
});

describe("musique : volume du lecteur", () => {
  test("l'icône change selon le niveau", () => {
    assert.equal(volumeLevel(0), 0);
    assert.equal(volumeLevel(1), 1);
    assert.equal(volumeLevel(33), 1);
    assert.equal(volumeLevel(34), 2);
    assert.equal(volumeLevel(66), 2);
    assert.equal(volumeLevel(67), 3);
    assert.equal(volumeLevel(100), 3);
  });

  test("coupé : l'icône barrée, quel que soit le niveau ; inconnu : l'icône moyenne", () => {
    assert.equal(volumeLevel(80, true), 0);
    assert.equal(volumeLevel(null), 2);
    assert.equal(volumeLevel(Number.NaN), 2);
  });
});

describe("musique : état des boutons", () => {
  test("aléatoire et répétition en couleur quand ils sont actifs", () => {
    const b = buttons(song({ shuffle: true, repeat: "list" }), { volume: 68, muted: false });
    assert.deepEqual(b.shuffle, { enabled: true, on: true, label: "Aléatoire activé" });
    assert.deepEqual(b.repeat, { enabled: true, on: true, label: "Répéter la liste" });
    assert.equal(buttons(song({ repeat: "track" }), null).repeat.label, "Répéter ce morceau");
    const off = buttons(song({ shuffle: false, repeat: "none" }), null);
    assert.equal(off.shuffle.on, false);
    assert.equal(off.shuffle.label, "Aléatoire désactivé");
    assert.equal(off.repeat.on, false);
    assert.equal(off.repeat.label, "Répétition désactivée");
  });

  test("grisés si le lecteur ne les expose pas (ou un ancien message sans ces champs)", () => {
    const b = buttons(song({ canShuffle: false, canRepeat: false, shuffle: true, repeat: "list" }), null);
    assert.equal(b.shuffle.enabled, false);
    assert.equal(b.shuffle.on, false, "jamais en couleur s'il est grisé");
    assert.equal(b.repeat.enabled, false);
    assert.equal(b.repeat.on, false);
    assert.match(b.shuffle.label, /indisponible/);
    const old = song();
    delete old.canShuffle;
    delete old.canRepeat;
    delete old.shuffle;
    delete old.repeat;
    assert.equal(buttons(old, null).shuffle.enabled, false);
    assert.equal(buttons(old, null).repeat.enabled, false);
  });

  test("lecture / pause, précédent, suivant suivent le lecteur", () => {
    assert.deepEqual(buttons(song(), null).toggle, { enabled: true, on: true, label: "Pause" });
    assert.deepEqual(buttons(song({ status: "paused" }), null).toggle, { enabled: true, on: false, label: "Lecture" });
    const b = buttons(song({ canPrevious: false, canNext: false, canToggle: false }), null);
    assert.equal(b.previous.enabled, false);
    assert.equal(b.next.enabled, false);
    assert.equal(b.toggle.enabled, false);
  });

  test("volume : grisé sans session audio du lecteur, éteint quand il est coupé", () => {
    assert.equal(buttons(song(), null).volume.enabled, false);
    assert.equal(buttons(song(), { volume: null, muted: false }).volume.enabled, false);
    assert.deepEqual(buttons(song(), { volume: 40, muted: false }).volume, { enabled: true, on: true, label: "Volume du lecteur, pas celui du PC" });
    assert.equal(buttons(song(), { volume: 40, muted: true }).volume.on, false);
  });

  test("répétition au clic : rien → liste → morceau → rien", () => {
    assert.equal(nextRepeat("none"), "list");
    assert.equal(nextRepeat(undefined), "list");
    assert.equal(nextRepeat("list"), "track");
    assert.equal(nextRepeat("track"), "none");
  });
});

describe("musique : nom de l'appli et couleur", () => {
  test("nom lisible du lecteur", () => {
    assert.equal(appName("Spotify.exe"), "Spotify");
    assert.equal(appName("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "ZuneMusic");
    assert.equal(appName("MSEdge"), "Edge");
    assert.equal(appName("308046B0AF4A39CB"), "Firefox");
  });

  test("la couleur de la pochette, éclaircie si elle est trop sombre", () => {
    assert.equal(cardTint(null), null);
    assert.deepEqual(cardTint([255, 122, 168]), { tint: "rgb(255, 122, 168)", soft: "rgba(255, 122, 168, 0.35)" });
    const dark = cardTint([20, 10, 60])!;
    const [r, g, b] = dark.tint.match(/\d+/g)!.map(Number);
    assert.ok(0.2126 * r + 0.7152 * g + 0.0722 * b > 60, "assez clair pour se voir sur l'île noire");
    assert.ok(b > r && b > g, "garde sa teinte");
  });
});

describe("musique : envois limités pendant un glissé", () => {
  /** Des minuteries à la main : on avance le temps soi-même. */
  function fakeTimers() {
    let t = 0;
    let queue: { at: number; fn: () => void; id: number }[] = [];
    let ids = 0;
    return {
      now: () => t,
      later: (fn: () => void, ms: number) => {
        const id = ++ids;
        queue.push({ at: t + ms, fn, id });
        return id;
      },
      cancel: (id: unknown) => {
        queue = queue.filter((q) => q.id !== id);
      },
      advance(ms: number) {
        t += ms;
        const due = queue.filter((q) => q.at <= t);
        queue = queue.filter((q) => q.at > t);
        due.forEach((q) => q.fn());
      },
    };
  }

  test("au plus un envoi toutes les 120 ms, et la dernière valeur part toujours", () => {
    const timers = fakeTimers();
    const sent: number[] = [];
    const th = throttle((v: number) => sent.push(v), 120, timers);
    th.push(10); // tout de suite
    assert.deepEqual(sent, [10]);
    timers.advance(30);
    th.push(20);
    timers.advance(30);
    th.push(30);
    assert.deepEqual(sent, [10], "rien avant 120 ms");
    timers.advance(60); // t = 120
    assert.deepEqual(sent, [10, 30], "seulement la plus récente");
    timers.advance(500);
    assert.deepEqual(sent, [10, 30], "rien en double");
    th.push(40); // longtemps après : tout de suite
    assert.deepEqual(sent, [10, 30, 40]);
  });

  test("lâcher envoie tout de suite la valeur en attente", () => {
    const timers = fakeTimers();
    const sent: number[] = [];
    const th = throttle((v: number) => sent.push(v), 120, timers);
    th.push(1);
    timers.advance(10);
    th.push(55);
    th.flush();
    assert.deepEqual(sent, [1, 55]);
    timers.advance(500);
    assert.deepEqual(sent, [1, 55], "la minuterie annulée n'envoie rien");
    th.flush();
    assert.deepEqual(sent, [1, 55], "rien en attente : rien");
  });
});
