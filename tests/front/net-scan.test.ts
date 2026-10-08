// Tests de la liste du scanner réseau (src/modules/nettools/scan-logic.ts).
// Le scan lui-même (plages, fabricants, types devinés) est testé côté Rust :
// src-tauri/src/modules/nettools_scan.rs.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deviceDetails, deviceTitle, KINDS, sortDevices, webPort, type ScanDevice } from "../../src/modules/nettools/scan-logic";

function dev(over: Partial<ScanDevice>): ScanDevice {
  return { ip: "192.168.1.10", mac: "00:11:32:00:00:01", vendor: null, randomMac: false, name: null, ms: null, gateway: false, kind: "unknown", new: false, ...over };
}

describe("scanner réseau", () => {
  test("le nom : DNS sans le domaine local, puis fabricant, puis type", () => {
    assert.equal(deviceTitle(dev({ name: "nas-maison.home", vendor: "Synology" })), "nas-maison");
    assert.equal(deviceTitle(dev({ name: "box.fritz.box" })), "box");
    assert.equal(deviceTitle(dev({ vendor: "Brother" })), "Brother");
    assert.equal(deviceTitle(dev({ kind: "phone" })), "Téléphone ou tablette");
    assert.equal(deviceTitle(dev({ kind: "inconnu-du-front" })), "Appareil");
  });
  test("les détails", () => {
    assert.deepEqual(deviceDetails(dev({ name: "nas", vendor: "Synology", ms: 3 })), ["192.168.1.10", "Synology", "00:11:32:00:00:01", "3 ms"]);
    assert.deepEqual(deviceDetails(dev({ randomMac: true, mac: "DA:00:00:00:00:01" })), ["192.168.1.10", "adresse MAC privée"]);
    assert.deepEqual(deviceDetails(dev({ mac: null })), ["192.168.1.10"]);
  });
  test("la page web préférée, et l'ordre de la liste", () => {
    assert.equal(webPort([22, 80, 443]), 443);
    assert.equal(webPort([5001, 5000]), 5001);
    assert.equal(webPort([22, 445]), null);
    const sorted = sortDevices([dev({ ip: "192.168.1.100" }), dev({ ip: "192.168.1.9" }), dev({ ip: "192.168.1.254", gateway: true })]);
    assert.deepEqual(sorted.map((d) => d.ip), ["192.168.1.254", "192.168.1.9", "192.168.1.100"]);
  });
  test("chaque type deviné par le Rust a un nom", () => {
    const rust = ["box", "pc", "phone", "printer", "nas", "camera", "speaker", "iot", "console", "server", "web", "unknown"];
    assert.deepEqual(rust.filter((k) => !KINDS[k]), []);
  });
});
