// Tests du module Home Assistant côté front (src/modules/homeassistant/logic.ts).
// Le réseau, les services autorisés, les appareils sensibles et Assist sont
// testés côté Rust (homeassistant_logic.rs, homeassistant.rs : un faux serveur local).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  byArea,
  confirmVerb,
  domainIcon,
  homeSummary,
  isOn,
  mainService,
  pickerGroups,
  readFavorites,
  SERVICES,
  serviceValue,
  servicesFor,
  stateText,
  toggleFavorite,
  toggleSensitive,
  type HaEntity,
} from "../../src/modules/homeassistant/logic";
import { MODULE_CATEGORIES } from "../../src/settings/layout";
import { MODULES_OFF_BY_DEFAULT } from "../../src/core/settings-store";

const e = (id: string, state: string, extra: Partial<HaEntity> = {}): HaEntity => ({ id, domain: id.split(".")[0], name: id, state, ...extra });

describe("Home Assistant : favoris", () => {
  test("les favoris enregistrés sont vérifiés", () => {
    assert.deepEqual(readFavorites(null), []);
    assert.deepEqual(readFavorites([{ id: "light.salon", name: "Salon", area: "" }, { id: "../x" }, "x", { id: "switch.prise" }]), [{ id: "light.salon", name: "Salon" }, { id: "switch.prise" }]);
  });

  test("ajouter, retirer, marquer sensible", () => {
    const lamp = e("light.salon", "on", { name: "Lampe", area: "Salon" });
    const list = toggleFavorite([], lamp, true);
    assert.deepEqual(list, [{ id: "light.salon", name: "Lampe", area: "Salon" }]);
    assert.deepEqual(toggleFavorite(list, lamp, false), []);
    assert.deepEqual(toggleSensitive(["a.b"], "switch.x", true), ["a.b", "switch.x"]);
    assert.deepEqual(toggleSensitive(["switch.x"], "switch.x", false), []);
    assert.deepEqual(toggleSensitive("abîmé", "switch.x", true), ["switch.x"]);
  });

  test("rangés par pièce, sans pièce à la fin", () => {
    const groups = byArea([{ area: null }, { area: "Salon" }, { area: "Cuisine" }, { area: "Salon" }]);
    assert.deepEqual(
      groups.map((g) => [g.area, g.items.length]),
      [
        ["Salon", 2],
        ["Cuisine", 1],
        [null, 1],
      ],
    );
  });

  test("le choix des favoris : par pièce ou par type, et la recherche", () => {
    const all = [e("light.salon", "on", { name: "Lampe", area: "Salon" }), e("switch.cafe", "off", { name: "Cafetière" }), e("cover.garage", "closed", { name: "Garage", area: "Entrée" })];
    assert.deepEqual(
      pickerGroups(all, "", true).map((g) => g.title),
      ["Entrée", "Salon", "Sans pièce"],
    );
    assert.deepEqual(
      pickerGroups(all, "", false).map((g) => g.title),
      ["Lumières", "Prises et interrupteurs", "Volets et portes"],
    );
    assert.deepEqual(
      pickerGroups(all, "cafetiere", true).flatMap((g) => g.items.map((x) => x.id)),
      ["switch.cafe"],
    );
  });
});

describe("Home Assistant : pastilles", () => {
  test("le clic fait l'action évidente (comme le Rust)", () => {
    assert.equal(mainService(e("light.x", "on")), "toggle");
    assert.equal(mainService(e("cover.x", "open")), "close_cover");
    assert.equal(mainService(e("cover.x", "closed")), "open_cover");
    assert.equal(mainService(e("lock.x", "locked")), "unlock");
    assert.equal(mainService(e("alarm_control_panel.x", "disarmed")), "alarm_arm_away");
    assert.equal(mainService(e("climate.x", "heat")), null);
    assert.equal(confirmVerb("open_cover"), "Ouvrir");
    assert.equal(confirmVerb("unlock"), "Déverrouiller");
  });

  test("allumé, et la ligne d'état", () => {
    assert.ok(isOn(e("light.x", "on")));
    assert.ok(!isOn(e("scene.x", "2026-10-16T10:00:00")));
    assert.ok(isOn(e("cover.x", "open")));
    assert.equal(stateText(e("light.x", "on", { brightness: 40 })), "40 %");
    assert.equal(stateText(e("light.x", "off")), "Éteinte");
    assert.equal(stateText(e("cover.x", "open", { position: 70 })), "Ouvert 70 %");
    assert.equal(stateText(e("climate.x", "heat", { target: 20.5 })), "20,5 °C");
    assert.equal(stateText(e("light.x", "on", { available: false })), "Indisponible");
    assert.equal(homeSummary([e("light.a", "on"), e("light.b", "on"), e("switch.c", "on")]), "2 lumières allumées");
    assert.equal(homeSummary([e("light.a", "off")]), "Lumières éteintes");
    assert.equal(homeSummary([e("switch.c", "on")]), "1 appareil");
  });

  test("chaque type d'appareil a un pictogramme au trait", () => {
    const src = readFileSync("src/island/icon.ts", "utf8");
    for (const domain of Object.keys(SERVICES)) {
      const icon = domainIcon({ domain, deviceClass: null }).replace(/️/g, "");
      assert.ok(src.includes(`"${icon}`), `${domain} : ${icon}`);
    }
    assert.equal(domainIcon({ domain: "cover", deviceClass: "garage" }), "🚪");
  });

  test("Règles : les services et leur valeur", () => {
    assert.deepEqual(servicesFor("light.salon"), ["turn_on", "turn_off", "toggle"]);
    assert.deepEqual(servicesFor("sensor.x"), []);
    assert.deepEqual(serviceValue("light", "turn_on"), { min: 1, max: 100, required: false });
    assert.equal(serviceValue("switch", "turn_on"), null);
    assert.equal(serviceValue("climate", "set_temperature")?.required, true);
  });

  test("les services du front sont ceux du Rust", () => {
    const rust = readFileSync("src-tauri/src/modules/homeassistant_logic.rs", "utf8");
    for (const list of Object.values(SERVICES)) for (const s of list) assert.ok(rust.includes(`"${s}"`), s);
  });
});

describe("Home Assistant : rangement", () => {
  test("dans « Le PC au quotidien », coupé par défaut", () => {
    assert.ok(MODULE_CATEGORIES.find((c) => c.id === "daily")?.modules.includes("homeassistant"));
    assert.ok(MODULES_OFF_BY_DEFAULT.includes("homeassistant"));
    const rust = readFileSync("src-tauri/src/services/settings.rs", "utf8");
    assert.match(rust, /MODULES_OFF_BY_DEFAULT[^;]*"homeassistant"/);
  });

  test("le manifeste : coupé, jeton au coffre, pas de logo", () => {
    const m = JSON.parse(readFileSync("src/modules/homeassistant/manifest.json", "utf8")) as { name: string; icon: string; settings: { fields: { key: string; type: string; default?: unknown; credential?: string }[] } };
    assert.equal(m.name, "Home Assistant");
    const f = (k: string) => m.settings.fields.find((x) => x.key === k);
    assert.equal(f("token")?.type, "secret");
    assert.equal(f("token")?.credential, "homeassistant-token");
    assert.equal(f("insecure")?.default, false);
    assert.equal(f("aiTool")?.default, false);
    assert.equal(f("assistFirst")?.default, true);
  });
});
