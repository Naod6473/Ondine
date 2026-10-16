// « Se voir » avant une réunion (module Agenda) : la logique sans page
// (src/modules/agenda/selfview-logic.ts) et le câblage des manifestes
// (Agenda, Lanceur) et des réglages (sous-menu « Avant une réunion »).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DARK_OFF,
  DARK_ON,
  deviceOptions,
  devicesOf,
  meanLuma,
  meterLevel,
  mirrorMode,
  openError,
  pickDevice,
  smoothLevel,
  tooDark,
  type Device,
} from "../../src/modules/agenda/selfview-logic";

const DEVICES: Device[] = [
  { deviceId: "default", label: "Par défaut - Micro (Realtek)", kind: "audioinput" },
  { deviceId: "communications", label: "Communications - Micro (Realtek)", kind: "audioinput" },
  { deviceId: "a1", label: "Micro (Realtek)", kind: "audioinput" },
  { deviceId: "a2", label: "Casque Jabra", kind: "audioinput" },
  { deviceId: "v1", label: "Integrated Camera", kind: "videoinput" },
  { deviceId: "v2", label: "Logitech C920", kind: "videoinput" },
  { deviceId: "o1", label: "Haut-parleurs", kind: "audiooutput" },
];

describe("réglage « Aperçu caméra et micro »", () => {
  test("au clic par défaut, et rien d'autre que les trois choix", () => {
    assert.equal(mirrorMode(undefined), "click");
    assert.equal(mirrorMode("auto"), "auto");
    assert.equal(mirrorMode("off"), "off");
    assert.equal(mirrorMode("toujours"), "click");
  });
});

describe("jauge du micro", () => {
  test("silence = 0, plein volume = 1, entre les deux en décibels", () => {
    assert.equal(meterLevel([]), 0);
    assert.equal(meterLevel(new Float32Array(512)), 0);
    assert.equal(meterLevel(new Float32Array(512).fill(1)), 1);
    // −20 dB (0,1) : aux deux tiers de la jauge.
    assert.ok(Math.abs(meterLevel(new Float32Array(512).fill(0.1)) - 2 / 3) < 1e-6);
    // Un souffle à −80 dB reste à 0.
    assert.equal(meterLevel(new Float32Array(512).fill(0.0001)), 0);
  });

  test("monte tout de suite, redescend doucement", () => {
    assert.equal(smoothLevel(0.2, 0.8), 0.8);
    const down = smoothLevel(0.8, 0);
    assert.ok(down > 0.6 && down < 0.8);
    assert.equal(smoothLevel(0.5, 0.45), 0.45);
  });
});

describe("image trop sombre", () => {
  const image = (v: number, px = 32 * 18) => {
    const a = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) a.set([v, v, v, 255], i * 4);
    return a;
  };

  test("luminance moyenne d'une image grise ou colorée", () => {
    assert.equal(Math.round(meanLuma(image(0))), 0);
    assert.equal(Math.round(meanLuma(image(200))), 200);
    assert.equal(Math.round(meanLuma(new Uint8ClampedArray([255, 0, 0, 255]))), 76);
    assert.equal(meanLuma(new Uint8ClampedArray(0)), 0);
    assert.equal(Math.round(meanLuma(image(120), 4)), 120);
  });

  test("un écart évite le clignotement", () => {
    assert.ok(DARK_ON < DARK_OFF);
    assert.equal(tooDark(40, false), true);
    assert.equal(tooDark(60, false), false);
    assert.equal(tooDark(60, true), true); // pas encore assez clair pour l'enlever
    assert.equal(tooDark(80, true), false);
  });
});

describe("caméras et micros", () => {
  test("sans les entrées « default » et « communications » de Chromium", () => {
    assert.deepEqual(devicesOf(DEVICES, "audioinput").map((d) => d.deviceId), ["a1", "a2"]);
    assert.deepEqual(devicesOf(DEVICES, "videoinput").map((d) => d.deviceId), ["v1", "v2"]);
  });

  test("retrouve l'appareil choisi par son nom ; sinon celui de Windows", () => {
    assert.equal(pickDevice(DEVICES, "videoinput", "Logitech C920"), "v2");
    assert.equal(pickDevice(DEVICES, "audioinput", "Casque Jabra"), "a2");
    assert.equal(pickDevice(DEVICES, "videoinput", ""), undefined);
    assert.equal(pickDevice(DEVICES, "videoinput", "Casque Jabra"), undefined);
    assert.equal(pickDevice(DEVICES, "videoinput", "Débranchée"), undefined);
  });

  test("les choix du menu : par défaut d'abord, un appareil débranché reste", () => {
    assert.deepEqual(deviceOptions(DEVICES, "videoinput", ""), [
      ["", "Caméra par défaut"],
      ["Integrated Camera", "Integrated Camera"],
      ["Logitech C920", "Logitech C920"],
    ]);
    assert.deepEqual(deviceOptions(DEVICES, "audioinput", "Yeti")[0], ["", "Micro par défaut"]);
    assert.deepEqual(deviceOptions(DEVICES, "audioinput", "Yeti").at(-1), ["Yeti", "Yeti (débranché)"]);
    // Avant l'autorisation, les noms sont vides : seulement « par défaut » (et le choix).
    const blind = DEVICES.map((d) => ({ ...d, label: "", deviceId: "" }));
    assert.deepEqual(deviceOptions(blind, "videoinput", ""), [["", "Caméra par défaut"]]);
  });

  test("un message clair pour chaque refus", () => {
    assert.match(openError("NotAllowedError", "camera"), /Confidentialité → Caméra/);
    assert.match(openError("NotAllowedError", "mic"), /Confidentialité → Microphone/);
    assert.equal(openError("NotFoundError", "camera"), "Aucune caméra trouvée.");
    assert.equal(openError("NotReadableError", "camera"), "La caméra est déjà prise par une autre appli.");
    assert.equal(openError("???", "mic"), "Impossible d'ouvrir le micro.");
  });
});

describe("câblage", () => {
  const agenda = JSON.parse(readFileSync("src/modules/agenda/manifest.json", "utf8"));
  const launcher = JSON.parse(readFileSync("src/modules/launcher/manifest.json", "utf8"));

  test("Agenda : les réglages, la commande du micro et les événements", () => {
    const keys = agenda.settings.fields.map((f: { key: string }) => f.key);
    for (const k of ["mirrorMode", "mirrorCamera", "mirrorMic"]) assert.ok(keys.includes(k), k);
    const mode = agenda.settings.fields.find((f: { key: string }) => f.key === "mirrorMode");
    assert.equal(mode.default, "click"); // la caméra ne s'allume pas toute seule par défaut
    assert.ok(agenda.commands.includes("mic"));
    for (const t of ["agenda.mirror", "controls.mic-muted"]) assert.ok(agenda.events.listens.includes(t), t);
    for (const t of ["controls.mic-set", "mascot.emote"]) assert.ok(agenda.events.emits.includes(t), t);
  });

  test("Lanceur : « miroir » ouvre l'aperçu", () => {
    assert.ok(launcher.events.emits.includes("agenda.mirror"));
    assert.match(readFileSync("src/modules/launcher/index.ts", "utf8"), /"miroir"/);
  });

  test("Réglages : un sous-menu « Avant une réunion » sur la page Agenda", () => {
    const main = readFileSync("src/settings/main.ts", "utf8");
    assert.match(main, /agenda: \[\s*\{ id: "general"[^\n]*\n\s*\{ id: "meeting", label: "Avant une réunion", keys: \["joinMin", "mirrorMode", "mirrorCamera", "mirrorMic"\] \}/);
  });

  test("la caméra et le micro se ferment avec l'aperçu et avant « Rejoindre »", () => {
    const view = readFileSync("src/modules/agenda/selfview.ts", "utf8");
    assert.match(view, /cam\.destroy\(\);\s*mic\.destroy\(\);/);
    const index = readFileSync("src/modules/agenda/index.ts", "utf8");
    assert.match(index, /async function join\(api: ModuleApi, m: Meeting\) \{[\s\S]{0,200}closeSelfView\(\);/);
    assert.match(index, /content: \(host\) => mountSelfView\(host, api\)/);
  });
});
