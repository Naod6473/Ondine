// Tests du module Équipe, côté front (src/modules/team/logic.ts) : tri des
// collègues, sondage, adresses, couleur montrée aux collègues, et la
// traduction anglaise des libellés (même recherche que t() dans i18n.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANSWER_LABEL, bytesToBase64, codeText, frameSize, openTarget, toGray, trackText, diskLow, isLink, isPrivateIp, lookColor, PINGS, pingText, pollChoices, sortPeers, STATUS_LABEL, type PeerView } from "../../src/modules/team/logic";

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

function peer(name: string, online: boolean, mine = false): PeerView {
  return { id: name, name, color: "#5cc8ff", mascot: "", mine, it: false, addr: "", online, status: online ? "available" : "offline", statusText: "", version: "", visits: true, battery: null, fingerprint: "" };
}

describe("équipe : petits calculs", () => {
  test("en ligne d'abord, puis mes PC, puis par nom", () => {
    const sorted = sortPeers([peer("Zoé", false), peer("Bob", true), peer("Portable", true, true), peer("Alice", true)]);
    assert.deepEqual(sorted.map((p) => p.name), ["Portable", "Alice", "Bob", "Zoé"]);
  });

  test("sondage : 2 à 4 choix, sans vide ni doublon", () => {
    assert.deepEqual(pollChoices(["Pizza", " Sushi ", "", "pizza"]), ["Pizza", "Sushi"]);
    assert.equal(pollChoices(["Pizza", ""]), null);
    assert.equal(pollChoices(["a", "b", "c", "d", "e"]), null);
  });

  test("liens, code, disques, adresses", () => {
    assert.ok(isLink("https://exemple.fr/page"));
    assert.ok(!isLink("voici https://exemple.fr"));
    assert.ok(!isLink("javascript:alert(1)"));
    assert.equal(codeText("482913"), "482 913");
    assert.ok(diskLow({ freeGb: 5, totalGb: 100 }));
    assert.ok(!diskLow({ freeGb: 50, totalGb: 100 }));
    for (const ok of ["192.168.1.20", "10.0.0.5", "172.16.3.4", "172.31.0.1", "169.254.1.1"]) assert.ok(isPrivateIp(ok), ok);
    for (const bad of ["8.8.8.8", "172.32.0.1", "192.168.1", "192.168.1.300", "exemple.fr", "127.0.0.1"]) assert.ok(!isPrivateIp(bad), bad);
  });

  test("la couleur montrée aux collègues", () => {
    assert.equal(lookColor("custom", "#AABBCC"), "#aabbcc");
    assert.equal(lookColor("mint", undefined), "#62e6c4");
    assert.equal(lookColor("auto", undefined), "#5cc8ff");
    assert.equal(lookColor("custom", "rouge"), "#5cc8ff");
  });
});

describe("équipe : traduction anglaise", () => {
  test("statuts, gestes et réponses", () => {
    for (const s of Object.values(STATUS_LABEL)) assert.notEqual(en(s), s, s);
    for (const p of PINGS) assert.notEqual(en(pingText(p.kind)), pingText(p.kind), p.kind);
    for (const a of Object.values(ANSWER_LABEL)) assert.notEqual(en(a), a, a);
  });

  test("textes à variables", () => {
    assert.equal(en("☕ Café · 5 min"), "☕ Coffee · 5 min");
    assert.equal(en("Bob ne répond pas (PC éteint, autre réseau, ou pare-feu de Windows qui bloque Ondine)"), "Bob isn't answering (PC off, other network, or Windows Firewall blocking Ondine)");
    assert.equal(en("fichier trop gros (2048 Mo au plus)"), "file too big (2048 MB at most)");
  });
});

describe("« Alex écoute… » et QR code (1.2.3)", () => {
  test("le morceau en une ligne", () => {
    assert.equal(trackText({ title: "Clair de lune", artist: "Debussy", app: "" }), "« Clair de lune » · Debussy");
    assert.equal(trackText({ title: "Sans nom", artist: "", app: "" }), "« Sans nom »");
  });

  test("le clic ouvre le service choisi, sinon celui du collègue, sinon YouTube Music", () => {
    const t = { title: "x", artist: "", app: "spotify" };
    assert.equal(openTarget(t, "same"), "Spotify");
    assert.equal(openTarget(t, "deezer"), "Deezer");
    assert.equal(openTarget({ ...t, app: "" }, "same"), "YouTube Music");
    assert.equal(openTarget({ ...t, app: "vlc" }, "inconnu"), "YouTube Music");
    assert.equal(en("Ouvrir ce morceau sur Apple Music"), "Open this track on Apple Music");
  });

  test("image de la webcam : niveaux de gris, taille réduite, Base64", () => {
    const rgba = [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255];
    assert.deepEqual([...toGray(rgba, 3, 1)], [255, 0, 76]);
    assert.equal(toGray(rgba, 10, 10).length, 3, "jamais plus loin que l'image");
    assert.deepEqual(frameSize(1280, 720), { w: 640, h: 360 });
    assert.deepEqual(frameSize(320, 240), { w: 320, h: 240 });
    assert.deepEqual(frameSize(0, 240), { w: 0, h: 0 });
    assert.equal(bytesToBase64(new Uint8Array([79, 110, 100])), "T25k");
    const big = new Uint8Array(100_000).fill(7);
    assert.equal(atob(bytesToBase64(big)).length, 100_000);
  });

  test("traduction des messages du QR code", () => {
    assert.equal(en("QR code lu : 192.168.1.20. Cliquez sur « Ajouter »."), "QR code read: 192.168.1.20. Click “Add”.");
  });
});
