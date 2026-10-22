// Tests des idées d'Orbix (1.2.5), la logique sans DOM :
//   - Contrôles : barres de signal Wi-Fi, texte d'un réseau, niveau d'une
//     appli qui retombe en douceur, liste d'applis inchangée (extras-logic.ts) ;
//   - Système : le débit en texte et la règle de la mini-île (net-rate.ts) ;
//   - Musique : les hauteurs de l'égaliseur qui suit le vrai son (logic.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HOLD_MS, meterLevel, POWER_ACTIONS, POWER_NAMES, sameApps, wifiBars, wifiDetail, type AppVolume, type WifiNetwork } from "../../src/modules/controls/extras-logic";
import { COMPACT_FROM, COMPACT_KEEP_MS, CompactRate, rateLine, rateParts, rateText } from "../../src/modules/system/net-rate";
import { EQ_MAX, EQ_MIN, eqHeights } from "../../src/modules/media/logic";

const net = (over: Partial<WifiNetwork> = {}): WifiNetwork => ({ ssid: "Maison", signal: 80, secure: true, known: false, connected: false, ...over });
const app = (key: string, name = key): AppVolume => ({ key, name, volume: 50, muted: false, active: true, peak: 0 });

describe("Contrôles : réseaux et applis", () => {
  test("barres de signal", () => {
    assert.equal(wifiBars(100), 4);
    assert.equal(wifiBars(75), 4);
    assert.equal(wifiBars(60), 3);
    assert.equal(wifiBars(30), 2);
    assert.equal(wifiBars(0), 1, "un réseau listé a toujours au moins une barre");
  });

  test("ce qu'on dit d'un réseau", () => {
    assert.equal(wifiDetail(net({ connected: true, known: true })), "Connecté");
    assert.match(wifiDetail(net({ known: true })), /^Connu/);
    assert.equal(wifiDetail(net()), "Nouveau réseau protégé");
    assert.equal(wifiDetail(net({ secure: false })), "Nouveau réseau ouvert");
  });

  test("le niveau monte tout de suite et retombe en douceur", () => {
    assert.equal(meterLevel(0.1, 0.9), 0.9);
    const after = meterLevel(0.9, 0);
    assert.ok(after > 0.5 && after < 0.9, `retombe à ${after}`);
    assert.equal(meterLevel(0, 2), 1, "borné à 1");
  });

  test("la liste se refait seulement quand des applis arrivent ou partent", () => {
    assert.ok(sameApps([app("pid:1", "Chrome")], [{ ...app("pid:1", "Chrome"), volume: 10 }]));
    assert.ok(!sameApps([app("pid:1")], [app("pid:1"), app("pid:2")]));
    assert.ok(!sameApps([app("pid:1")], [app("pid:3")]));
  });

  test("boutons d'alimentation : les quatre, maintenus une seconde", () => {
    assert.deepEqual([...POWER_ACTIONS], ["lock", "sleep", "restart", "shutdown"]);
    assert.ok(POWER_ACTIONS.every((a) => POWER_NAMES[a].length > 0));
    assert.ok(HOLD_MS >= 600, "assez long pour éviter un arrêt par erreur");
  });
});

describe("Système : débit réseau", () => {
  test("des unités lisibles", () => {
    assert.equal(rateText(0), "0 o/s");
    assert.equal(rateText(-5), "0 o/s");
    assert.equal(rateText(Number.NaN), "0 o/s");
    assert.equal(rateText(820), "820 o/s");
    assert.equal(rateText(85 * 1024), "85 ko/s");
    assert.equal(rateText(4.25 * 1024 * 1024), "4,3 Mo/s");
    assert.equal(rateText(42 * 1024 * 1024), "42 Mo/s");
    assert.equal(rateText(1.1 * 1024 ** 3), "1,1 Go/s");
    assert.deepEqual(rateParts(2048), { num: "2", unit: "ko/s" });
    assert.equal(rateLine(4.25 * 1024 * 1024, 85 * 1024), "↓ 4,3 Mo/s · ↑ 85 ko/s");
  });

  test("la mini-île montre le débit pendant un gros transfert, puis le lâche", () => {
    const c = new CompactRate();
    assert.equal(c.push(100_000, 5_000, 0), false);
    assert.equal(c.push(COMPACT_FROM, 0, 1_000), true, "téléchargement");
    assert.equal(c.push(0, COMPACT_FROM * 2, 2_000), true, "envoi");
    assert.equal(c.push(10, 10, 2_000 + COMPACT_KEEP_MS - 1), true, "encore un instant");
    assert.equal(c.push(10, 10, 2_000 + COMPACT_KEEP_MS), false);
    c.push(COMPACT_FROM, 0, 50_000);
    c.reset();
    assert.equal(c.shown(50_001), false);
  });
});

describe("Musique : l'égaliseur sur le vrai son", () => {
  test("silence : les barres au repos", () => {
    assert.deepEqual(eqHeights([EQ_MIN, EQ_MIN, EQ_MIN], { level: 0, left: 0, right: 0 }), [EQ_MIN, EQ_MIN, EQ_MIN]);
  });

  test("à fond : les barres en haut, gauche / ensemble / droite dans l'ordre", () => {
    assert.deepEqual(eqHeights([EQ_MIN, EQ_MIN, EQ_MIN], { level: 1, left: 1, right: 1 }), [EQ_MAX, EQ_MAX, EQ_MAX]);
    const [l, c, r] = eqHeights([EQ_MIN, EQ_MIN, EQ_MIN], { level: 0.5, left: 0.9, right: 0.1 });
    assert.ok(l > c && c > r);
  });

  test("monte d'un coup, redescend en douceur, jamais hors des bornes", () => {
    const up = eqHeights([EQ_MIN, EQ_MIN, EQ_MIN], { level: 1, left: 1, right: 1 });
    const down = eqHeights(up, { level: 0, left: 0, right: 0 });
    assert.ok(down.every((h) => h < EQ_MAX && h > EQ_MIN));
    const weird = eqHeights([], { level: 5, left: -1, right: Number.NaN });
    assert.ok(weird.every((h) => h >= EQ_MIN && h <= EQ_MAX));
  });
});
