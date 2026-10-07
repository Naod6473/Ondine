// Tests des horloges du monde : la table des villes (src/core/world-cities.ts),
// les calculs d'heure (src/core/world-time.ts) et l'avertissement des réglages
// (src/settings/field-checks.ts).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, MAX_CLOCKS, cityKey, cityName, findCity, localCity, parseCityList } from "../../src/core/world-cities";
import { cityClock, clockText, dayWord, digitalText, fromCityTime, offsetMinutes, offsetText, wallTime, zonedInstant } from "../../src/core/world-time";
import { fieldWarnings } from "../../src/settings/field-checks";

// Le 15 juillet 2026 à 12:00 UTC : 14 h à Paris (heure d'été), 8 h à Montréal, 21 h à Tokyo.
const NOW = new Date(Date.UTC(2026, 6, 15, 12, 0));

describe("la table des villes", () => {
  test("environ 150 villes ou plus, chacune avec ses deux noms", () => {
    assert.ok(CITIES.length >= 150, `${CITIES.length} villes`);
    for (const c of CITIES) {
      assert.ok(c.fr.trim() && c.en.trim(), JSON.stringify(c));
      // Une virgule couperait le nom en deux dans le réglage.
      assert.ok(!c.fr.includes(",") && !c.en.includes(","), JSON.stringify(c));
    }
  });

  test("chaque fuseau est connu d'Intl (donc de Windows)", () => {
    const bad = CITIES.filter((c) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: c.tz });
        return false;
      } catch {
        return true;
      }
    }).map((c) => c.tz);
    assert.deepEqual(bad, []);
  });

  test("chaque nom retrouve une ville du même fuseau (pas deux villes sous le même nom)", () => {
    const bad: string[] = [];
    for (const c of CITIES) {
      for (const name of [c.fr, c.en]) {
        if (findCity(name)?.tz !== c.tz) bad.push(`${name} → ${findCity(name)?.tz} au lieu de ${c.tz}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe("chercher une ville", () => {
  test("sans accents, majuscules, tirets ni apostrophes", () => {
    for (const q of ["Montréal", "montreal", "MONTREAL", "  Montréal  "]) assert.equal(findCity(q)?.fr, "Montréal", q);
    assert.equal(findCity("saint petersbourg")?.tz, "Europe/Moscow");
    assert.equal(findCity("Saint-Pétersbourg")?.tz, "Europe/Moscow");
    assert.equal(findCity("sao paulo")?.tz, "America/Sao_Paulo");
    assert.equal(findCity("new-york")?.tz, "America/New_York");
    assert.equal(findCity("st john's")?.tz, "America/St_Johns");
    assert.equal(cityKey("Saint-Pétersbourg"), "saint petersbourg");
  });

  test("noms français, anglais et autres", () => {
    assert.equal(findCity("Pékin")?.tz, "Asia/Shanghai");
    assert.equal(findCity("Beijing")?.tz, "Asia/Shanghai");
    assert.equal(findCity("Bombay")?.tz, "Asia/Kolkata");
    assert.equal(findCity("Mumbai")?.tz, "Asia/Kolkata");
    assert.equal(findCity("Londres")?.en, "London");
    assert.equal(findCity("London")?.fr, "Londres");
    assert.equal(findCity("Kyiv")?.tz, "Europe/Kiev");
    assert.equal(findCity("la réunion")?.tz, "Indian/Reunion");
    assert.equal(findCity("UTC")?.tz, "UTC");
    assert.equal(findCity("gmt")?.tz, "UTC");
  });

  test("un nom IANA tapé tel quel", () => {
    assert.deepEqual(findCity("Asia/Kathmandu"), { fr: "Kathmandu", en: "Kathmandu", tz: "Asia/Kathmandu" });
    assert.equal(findCity("America/Argentina/Cordoba")?.fr, "Cordoba");
    assert.equal(findCity("Europe/Nulle_Part"), null);
  });

  test("inconnu → null", () => {
    assert.equal(findCity("Xyzville"), null);
    assert.equal(findCity(""), null);
    assert.equal(findCity("constructor"), null);
    assert.equal(findCity("toString"), null);
  });

  test("le nom dans la langue de l'interface", () => {
    const c = findCity("Vienne")!;
    assert.equal(cityName(c, "fr"), "Vienne");
    assert.equal(cityName(c, "en"), "Vienna");
  });

  test("la ville du PC d'après son fuseau", () => {
    assert.equal(localCity("Europe/Paris")?.fr, "Paris");
    assert.equal(localCity("America/Toronto")?.fr, "Montréal");
    assert.equal(localCity("Etc/GMT+3"), null);
  });
});

describe("le réglage « Horloges du monde »", () => {
  test("villes séparées par des virgules, sans doublon", () => {
    const r = parseCityList("Montréal, Tokyo, montreal");
    assert.deepEqual(r.cities.map((c) => c.fr), ["Montréal", "Tokyo"]);
    assert.deepEqual(r.unknown, []);
    assert.deepEqual(r.extra, []);
  });

  test("vide, espaces, points-virgules", () => {
    assert.deepEqual(parseCityList("").cities, []);
    assert.deepEqual(parseCityList(" , ,").cities, []);
    assert.deepEqual(parseCityList("Tokyo; Sydney").cities.map((c) => c.en), ["Tokyo", "Sydney"]);
  });

  test("ville inconnue : signalée, les autres gardées", () => {
    const r = parseCityList("Montréal, Xyzville, Tokyo");
    assert.deepEqual(r.cities.map((c) => c.fr), ["Montréal", "Tokyo"]);
    assert.deepEqual(r.unknown, ["Xyzville"]);
  });

  test(`${MAX_CLOCKS} villes au plus`, () => {
    const r = parseCityList("Paris, Londres, Tokyo, Sydney, New York, Montréal");
    assert.equal(r.cities.length, MAX_CLOCKS);
    assert.deepEqual(r.extra, ["New York", "Montréal"]);
  });

  test("avertissement sous le champ dans les réglages", () => {
    assert.deepEqual(fieldWarnings("cities", "Montréal, Tokyo"), []);
    assert.deepEqual(fieldWarnings("cities", ""), []);
    assert.deepEqual(fieldWarnings("cities", "Montral, Tokyo"), ["Ville inconnue, ignorée : Montral"]);
    assert.deepEqual(fieldWarnings("cities", "Abc, Tokyo, Def"), ["Villes inconnues, ignorées : Abc, Def"]);
    assert.deepEqual(fieldWarnings("cities", "Paris, Londres, Tokyo, Sydney, Lima, Xyz"), [
      "Ville inconnue, ignorée : Xyz",
      "4 villes au plus. En trop : Lima",
    ]);
  });
});

describe("calcul des heures", () => {
  test("décalage avec UTC, heure d'été comprise", () => {
    assert.equal(offsetMinutes("Europe/Paris", new Date(Date.UTC(2026, 0, 15))), 60);
    assert.equal(offsetMinutes("Europe/Paris", NOW), 120);
    assert.equal(offsetMinutes("America/Toronto", NOW), -240);
    assert.equal(offsetMinutes("Asia/Kolkata", NOW), 330);
    assert.equal(offsetMinutes("Asia/Kathmandu", NOW), 345);
    assert.equal(offsetMinutes("America/St_Johns", NOW), -150);
    assert.equal(offsetMinutes("UTC", NOW), 0);
  });

  test("wallTime : ce qu'affiche une horloge là-bas", () => {
    assert.deepEqual(wallTime("Asia/Tokyo", NOW), { year: 2026, month: 7, day: 15, hour: 21, minute: 0, second: 0 });
    // Minuit : 0 h, jamais 24 h.
    assert.equal(wallTime("UTC", new Date(Date.UTC(2026, 0, 1, 0, 0))).hour, 0);
  });

  test("zonedInstant, y compris autour du passage à l'heure d'été", () => {
    assert.equal(zonedInstant("Europe/Paris", 2026, 7, 15, 14, 0).toISOString(), "2026-07-15T12:00:00.000Z");
    assert.equal(zonedInstant("Europe/Paris", 2026, 1, 15, 14, 0).toISOString(), "2026-01-15T13:00:00.000Z");
    // Le 29 mars 2026, Paris passe de 2 h à 3 h : 3 h 30 = 1 h 30 UTC.
    assert.equal(zonedInstant("Europe/Paris", 2026, 3, 29, 3, 30).toISOString(), "2026-03-29T01:30:00.000Z");
    assert.equal(zonedInstant("Asia/Kathmandu", 2026, 7, 15, 12, 0).toISOString(), "2026-07-15T06:15:00.000Z");
  });

  test("textes : heure, écart, jour", () => {
    assert.equal(clockText(9, 5, "fr"), "9 h 05");
    assert.equal(clockText(9, 5, "en"), "09:05");
    assert.equal(digitalText(9, 5), "09:05");
    assert.equal(offsetText(0, "fr"), "même heure");
    assert.equal(offsetText(0, "en"), "same time");
    assert.equal(offsetText(360, "fr"), "+6 h");
    assert.equal(offsetText(-210, "fr"), "−3 h 30");
    assert.equal(offsetText(345, "fr"), "+5 h 45");
    assert.equal(dayWord(1, "fr"), "demain");
    assert.equal(dayWord(-1, "fr"), "hier");
    assert.equal(dayWord(0, "fr"), "");
    assert.equal(dayWord(1, "en"), "tomorrow");
  });

  test("cityClock : l'horloge d'une ville vue de Paris", () => {
    const tokyo = cityClock(findCity("Tokyo")!, NOW, "fr", "Europe/Paris");
    assert.equal(tokyo.time, "21:00");
    assert.equal(tokyo.offset, 7 * 60);
    assert.equal(tokyo.dayDiff, 0);
    assert.equal(tokyo.date, "mercredi 15 juillet");
    const mtl = cityClock(findCity("Montréal")!, NOW, "en", "Europe/Paris");
    assert.equal(mtl.name, "Montreal");
    assert.equal(mtl.time, "08:00");
    assert.equal(mtl.offset, -6 * 60);
  });

  test("cityClock : « demain » et « hier »", () => {
    // 20:00 UTC : 22 h à Paris le 15, 5 h à Tokyo le 16.
    const late = new Date(Date.UTC(2026, 6, 15, 20, 0));
    assert.equal(cityClock(findCity("Tokyo")!, late, "fr", "Europe/Paris").dayDiff, 1);
    // 23:30 UTC : 1 h 30 à Paris le 16, 19 h 30 à Montréal le 15.
    const night = new Date(Date.UTC(2026, 6, 15, 23, 30));
    assert.equal(cityClock(findCity("Montréal")!, night, "fr", "Europe/Paris").dayDiff, -1);
    assert.equal(cityClock(findCity("Tokyo")!, night, "fr", "Europe/Paris").dayDiff, 0);
  });

  test("fromCityTime : une heure là-bas, vue d'ici", () => {
    const mtl = findCity("Montréal")!;
    assert.deepEqual(fromCityTime(mtl, 15, 0, NOW, "Europe/Paris"), { hour: 21, minute: 0, dayDiff: 0, offset: -360 });
    assert.deepEqual(fromCityTime(mtl, 23, 0, NOW, "Europe/Paris"), { hour: 5, minute: 0, dayDiff: 1, offset: -360 });
    const tokyo = findCity("Tokyo")!;
    assert.deepEqual(fromCityTime(tokyo, 1, 0, NOW, "Europe/Paris"), { hour: 18, minute: 0, dayDiff: -1, offset: 420 });
    const delhi = findCity("New Delhi")!;
    assert.deepEqual(fromCityTime(delhi, 18, 0, NOW, "Europe/Paris"), { hour: 14, minute: 30, dayDiff: 0, offset: 210 });
  });
});
