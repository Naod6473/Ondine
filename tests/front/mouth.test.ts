// Tests de l'île-bouche et du format nano (1.2.3) : la géométrie du corps
// d'Ondine autour de sa bouche (src/island/mouth-geom.ts) et les règles
// d'élargissement de l'encoche (src/island/nano-rules.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  dirForEdge,
  distanceTo,
  dotPlaces,
  eyeOpenness,
  glintOffset,
  layoutMouth,
  MOUTH_KEYS,
  nanoDots,
  openness,
  paramsAt,
  PEEK_EYE_PX,
  toLocal,
} from "../../src/island/mouth-geom";
import { dotStatus, NANO_START, nanoStep, PULSE, type NanoStatus } from "../../src/island/nano-rules";

describe("île-bouche : les trois formes de la maquette", () => {
  test("nano : bouche 20 × 7, corps 66 × 58 (+ la pointe)", () => {
    const L = layoutMouth({ x: 100, y: 11, w: 20, h: 7 }, "down");
    assert.equal(L.o, 0);
    const { u0, v0, u1, v1 } = L.local;
    assert.equal(u1 - u0, 66);
    assert.equal(v1 - v0, 58);
    // Le corps touche le bord de l'écran (la lèvre arrière = le décalage de la bouche).
    assert.equal(L.frame.map(0, v0).y, 0);
    assert.equal(L.p.tipH, 0); // forme ronde, sans pointe (demande de Simon)
  });

  test("mini : bouche 318 × 40, corps 334 × 76, langue visible", () => {
    const L = layoutMouth({ x: 0, y: 6, w: 318, h: 40 }, "down", 1);
    assert.equal(L.local.u1 - L.local.u0, 334);
    assert.equal(L.local.v1 - L.local.v0, 76);
    assert.equal(L.p.tongue, 1);
  });

  test("ouverte : bouche 466 × 208, corps 474 × 224 (liseré de 4 px), plus de langue", () => {
    const L = layoutMouth({ x: 0, y: 4, w: 466, h: 208 }, "down", 2);
    assert.equal(L.local.u1 - L.local.u0, 474);
    assert.equal(L.local.v1 - L.local.v0, 224);
    assert.equal(L.p.side, 4);
    assert.equal(L.p.tongue, 0);
  });

  test("les yeux s'étirent : ronds en nano, aplatis en mini, étirés une fois ouverte", () => {
    const [nano, mini, open] = MOUTH_KEYS;
    assert.ok(nano.eyeH > nano.eyeW);
    assert.ok(mini.eyeH < mini.eyeW);
    assert.ok(open.eyeW / open.eyeH > mini.eyeW / mini.eyeH);
  });
});

describe("île-bouche : volume conservé et gelée", () => {
  test("l'ouverture suit l'épaisseur de la bouche", () => {
    assert.equal(openness(0), 0);
    assert.equal(openness(7), 0);
    assert.equal(openness(41), 1);
    assert.equal(openness(270), 2);
    assert.ok(openness(24) > 0 && openness(24) < 1);
    assert.equal(openness(NaN), 0);
  });

  test("plus la bouche s'ouvre, plus les lèvres s'affinent (jamais l'inverse)", () => {
    let prev = paramsAt(0);
    for (let o = 0.1; o <= 2.0001; o += 0.1) {
      const p = paramsAt(o);
      assert.ok(p.side <= prev.side + 1e-9, `side à ${o.toFixed(1)}`);
      assert.ok(p.back <= prev.back + 1e-9, `back à ${o.toFixed(1)}`);
      assert.ok(p.eyeZone <= prev.eyeZone + 1e-9, `eyeZone à ${o.toFixed(1)}`);
      prev = p;
    }
  });

  test("entre deux formes, tout est interpolé (pas de saut)", () => {
    const a = paramsAt(0.999);
    const b = paramsAt(1.001);
    assert.ok(Math.abs(a.side - b.side) < 0.1);
    assert.ok(Math.abs(a.eyeW - b.eyeW) < 0.1);
    assert.deepEqual(paramsAt(-3), MOUTH_KEYS[0]);
    assert.deepEqual(paramsAt(9), MOUTH_KEYS[2]);
  });
});

describe("île-bouche : les bords de l'écran", () => {
  test("Ondine garde la tête vers le bord", () => {
    assert.equal(dirForEdge("top"), "down");
    assert.equal(dirForEdge("bottom"), "up");
    assert.equal(dirForEdge("left"), "right");
    assert.equal(dirForEdge("right"), "left");
    assert.equal(dirForEdge("???"), "down");
  });

  test("en bas : les yeux au-dessus de la bouche (forme ronde, sans pointe)", () => {
    const m = { x: 100, y: 500, w: 318, h: 40 };
    const L = layoutMouth(m, "up", 1);
    const eye = L.frame.map(L.eyes[0].u, L.eyes[0].v);
    assert.ok(eye.y < m.y);
    assert.equal(L.bounds.y, m.y - L.p.eyeZone);
    assert.equal(L.bounds.y + L.bounds.h, m.y + m.h + L.p.back);
  });

  test("à gauche : le corps s'étend vers la droite, la bouche debout", () => {
    const m = { x: 6, y: 100, w: 40, h: 318 };
    const L = layoutMouth(m, "right", 1);
    assert.equal(L.frame.len, 318);
    assert.equal(L.bounds.x, 0);
    assert.ok(L.frame.map(L.eyes[0].u, L.eyes[0].v).x > m.x + m.w);
  });

  test("à droite : le corps s'étend vers la gauche", () => {
    const m = { x: 900, y: 100, w: 40, h: 318 };
    const L = layoutMouth(m, "left", 1);
    assert.equal(L.bounds.x + L.bounds.w, m.x + m.w + L.p.back);
    assert.ok(L.frame.map(L.eyes[1].u, L.eyes[1].v).x < m.x);
  });

  test("les reflets suivent la souris, bornés, et tournent avec le corps", () => {
    assert.deepEqual(glintOffset(1000, -1000), { x: 0.6, y: -0.4 });
    assert.deepEqual(glintOffset(0, 0), { x: 0, y: 0 });
    assert.deepEqual(toLocal("up", 3, 4), { x: 3, y: -4 });
    assert.deepEqual(toLocal("right", 3, 4), { x: 4, y: 3 });
  });
});

describe("format nano : Ondine somnole et les points d'état", () => {
  test("éveillée : deux yeux ouverts ; endormie : fermés ; la souris approche : un œil", () => {
    assert.deepEqual(eyeOpenness(false, 999, true), [1, 1]);
    assert.deepEqual(eyeOpenness(true, PEEK_EYE_PX + 1, true), [0, 0]);
    assert.deepEqual(eyeOpenness(true, 30, true), [1, 0]);
    assert.deepEqual(eyeOpenness(true, 30, false), [0, 1]);
  });

  test("distance à un rectangle", () => {
    const b = { x: 10, y: 10, w: 20, h: 10 };
    assert.equal(distanceTo(b, 15, 15), 0);
    assert.equal(distanceTo(b, 40, 10), 10);
    assert.equal(distanceTo(b, 33, 24), 5);
  });

  test("les points : ordre fixe, trois au plus", () => {
    assert.deepEqual(nanoDots({ timer: true, music: true }), ["music", "timer"]);
    assert.deepEqual(nanoDots({ timer: true, music: true, agent: true, voice: true }), ["music", "agent", "timer"]);
    assert.deepEqual(nanoDots({}), []);
  });

  test("les points se posent à côté de l'encoche, de l'autre côté dans le coin droit", () => {
    const right = dotPlaces(2, { w: 76, h: 34 }, "top", "center");
    assert.ok(right.every((p) => p.x > 76));
    assert.ok(right[1].y > right[0].y);
    const left = dotPlaces(1, { w: 76, h: 34 }, "top", "end");
    assert.ok(left[0].x < 0);
    const side = dotPlaces(2, { w: 34, h: 76 }, "left", "center");
    assert.ok(side.every((p) => p.y > 76));
  });
});

describe("format nano : quand l'encoche s'élargit (nano-rules.ts)", () => {
  const playing = (title: string, status = "playing") => ({ playing: { title, artist: "Amarià", status }, artwork: 1 });

  test("un nouveau morceau élargit, le même qui continue non", () => {
    let s: NanoStatus = NANO_START;
    let step = nanoStep(s, "media.changed", playing("Lovely Swindler"));
    assert.equal(step.pulse, PULSE.track);
    s = step.status;
    assert.equal(s.music, true);
    step = nanoStep(s, "media.changed", playing("Lovely Swindler"));
    assert.equal(step.pulse, undefined);
    step = nanoStep(step.status, "media.changed", playing("Lovely Swindler", "paused"));
    assert.equal(step.status.music, false);
    step = nanoStep(step.status, "media.changed", playing("Lovely Swindler"));
    assert.equal(step.pulse, PULSE.resume);
  });

  test("un minuteur qui démarre élargit ; son point reste tant qu'il tourne", () => {
    let step = nanoStep(NANO_START, "timer.progress", { id: "t1", state: "running" });
    assert.equal(step.pulse, PULSE.timerStart);
    step = nanoStep(step.status, "timer.progress", { id: "t1", state: "running" });
    assert.equal(step.pulse, undefined);
    assert.equal(dotStatus(step.status).timer, true);
    step = nanoStep(step.status, "timer.progress", { id: "t1", state: "off" });
    assert.equal(dotStatus(step.status).timer, false);
    assert.equal(nanoStep(NANO_START, "timer.done", { title: "Thé" }).pulse, PULSE.timerDone);
  });

  test("agent IA : au travail (point), fini (élargit)", () => {
    let step = nanoStep(NANO_START, "claude.thinking", {});
    assert.equal(step.pulse, PULSE.agentStart);
    assert.equal(step.status.agent, true);
    step = nanoStep(step.status, "agents.event", { kind: "done" });
    assert.equal(step.status.agent, false);
    assert.equal(step.pulse, PULSE.agentEnd);
  });

  test("la voix garde la mini-île tant qu'Ondine écoute", () => {
    const on = nanoStep(NANO_START, "voice.listening", { on: true });
    assert.deepEqual(on.busy, ["voice", true]);
    const off = nanoStep(on.status, "voice.listening", { on: false });
    assert.deepEqual(off.busy, ["voice", false]);
  });

  test("un message inconnu ne change rien", () => {
    const step = nanoStep(NANO_START, "weather.updated", {});
    assert.equal(step.status, NANO_START);
    assert.equal(step.pulse, undefined);
  });
});
