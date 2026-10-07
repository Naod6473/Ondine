// Tests des calculs du Lanceur (src/modules/launcher/calc.ts) : arithmétique,
// pourcentages, unités, débits, bases, sous-réseaux IPv4, heures du monde, et
// surtout les FAUX POSITIFS : ce qui n'est pas un calcul ne doit rien donner.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculate, evaluate, formatDuration, formatNumber, inBase, newGuid, type CalcAnswer } from "../../src/modules/launcher/calc";

/** Les espaces insécables de Intl (« 1 234 ») deviennent des espaces simples, pour comparer. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

/** Le premier résultat d'un calcul (titre), ou null s'il n'y en a pas. */
function title(q: string, lang: "fr" | "en" = "fr"): string | null {
  const r = calculate(q, lang, NOW, "Europe/Paris");
  return r.length ? plain(r[0].title) : null;
}

/** Ce qu'Entrée copierait. */
function copy(q: string, lang: "fr" | "en" = "fr"): string | null {
  const r = calculate(q, lang, NOW, "Europe/Paris");
  return r.length ? r[0].copy : null;
}

function all(q: string, lang: "fr" | "en" = "fr"): CalcAnswer[] {
  return calculate(q, lang, NOW, "Europe/Paris");
}

// Le 15 juillet 2026 à 12:00 UTC : 14 h à Paris (heure d'été), 8 h à Montréal, 21 h à Tokyo.
const NOW = new Date(Date.UTC(2026, 6, 15, 12, 0));

describe("arithmétique", () => {
  test("les quatre opérations et les priorités", () => {
    assert.equal(title("2 + 3"), "5");
    assert.equal(title("2 + 3 * 4"), "14");
    assert.equal(title("(2 + 3) * 4"), "20");
    assert.equal(title("10 - 4 - 3"), "3");
    assert.equal(title("100 / 4 / 5"), "5");
    assert.equal(title("7 / 2"), "3,5");
  });

  test("signes × ÷ x fois, − typographique, ** et ^", () => {
    assert.equal(title("6 × 7"), "42");
    assert.equal(title("84 ÷ 2"), "42");
    assert.equal(title("6 x 7"), "42");
    assert.equal(title("6x7"), "42");
    assert.equal(title("6 fois 7"), "42");
    assert.equal(title("50 − 8"), "42");
    assert.equal(title("2 ** 10"), "1 024");
    assert.equal(title("2^10"), "1 024");
  });

  test("puissances : de droite à gauche, et -2^2 = -4", () => {
    assert.equal(title("2 ^ 3 ^ 2"), "512");
    assert.equal(title("-2 ^ 2"), "-4");
    assert.equal(title("(-2) ^ 2"), "4");
    assert.equal(title("2 ^ -1"), "0,5");
  });

  test("moins devant : -3 + 5, 5 * -2, --4", () => {
    assert.equal(title("-3 + 5"), "2");
    assert.equal(title("5 * -2"), "-10");
    assert.equal(title("1 - -4"), "5");
  });

  test("nombres à la française : virgule, espaces de milliers, point aussi", () => {
    assert.equal(title("1,5 + 1,5"), "3");
    assert.equal(title("1.5 + 1.5"), "3");
    assert.equal(title("1 200 + 34"), "1 234");
    assert.equal(title("1 200,5 * 2"), "2 401");
    assert.equal(title("12 345 678 * 2"), "24 691 356");
    // Espaces insécables (copiés depuis Excel ou Word).
    assert.equal(title("1\u00a0200 + 1\u202f000"), "2 200");
  });

  test("en anglais : virgule des milliers, point décimal", () => {
    assert.equal(title("1,234.5 * 2", "en"), "2,469");
    assert.equal(title("1.5 + 1", "en"), "2.5");
    assert.equal(title("1,5 + 1", "en"), null);
  });

  test("arrondi raisonnable", () => {
    assert.equal(title("0,1 + 0,2"), "0,3");
    assert.equal(title("1 / 3"), "0,3333333333");
    assert.equal(title("2 / 3"), "0,6666666667");
    assert.equal(title("10 / 4"), "2,5");
  });

  test("racine, pi, « = » à la fin", () => {
    assert.equal(title("racine de 16"), "4");
    assert.equal(title("racine carrée de 81"), "9");
    assert.equal(title("sqrt(2) * sqrt(2)"), "2");
    assert.equal(title("√9 + 1"), "4");
    assert.equal(title("2 * pi"), "6,2831853072");
    assert.equal(title("2 * π"), "6,2831853072");
    assert.equal(title("2 + 2 ="), "4");
  });

  test("pourcentages", () => {
    assert.equal(title("18 % de 240"), "43,2");
    assert.equal(title("18% of 240"), "43,2");
    assert.equal(title("240 + 18 %"), "283,2");
    assert.equal(title("240 - 18%"), "196,8");
    assert.equal(title("240 * 18 %"), "43,2");
    assert.equal(title("15 %"), "0,15");
    assert.equal(title("50 % de 50 % de 80"), "20");
  });

  test("« de » seulement après un pourcentage", () => {
    assert.equal(title("18 de 240"), null);
  });

  test("ce qui ne se calcule pas ne donne rien (division par zéro, trop grand)", () => {
    assert.equal(title("1 / 0"), null);
    assert.equal(title("0 / 0"), null);
    assert.equal(title("10 ^ 1000"), null);
    assert.equal(title("racine de -1"), null);
  });

  test("très grands et très petits nombres : notation scientifique", () => {
    assert.equal(title("2 ^ 64"), "1,844674E19");
    assert.equal(title("1 / 2 ^ 40"), "9,094947E-13");
  });

  test("ce qui est copié : sans espaces de milliers, virgule décimale", () => {
    assert.equal(copy("1 200 * 3"), "3600");
    assert.equal(copy("1 234,5 + 0"), "1234,5");
    assert.equal(copy("1,234.5 + 0", "en"), "1234.5");
  });
});

describe("faux positifs : pas un calcul, aucun résultat", () => {
  const NOT_CALC = [
    "",
    "   ",
    "2024",
    "42",
    "-5",
    "(5)",
    "1,5",
    "1 200",
    "rapport-2024.pdf",
    "IMG_2024.jpg",
    "2026-10-07",
    "2024-10",
    "07/10/2026",
    "7/10/26",
    "10/2026",
    "07.10.2026",
    "1.0.1",
    "10.0.19045",
    "v2.3",
    "2.0",
    "192.168.1.1",
    "10:30",
    "1h30",
    "win10",
    "Windows 11",
    "4K",
    "1e5",
    "x",
    "pi",
    "Notes en vrac",
    "Tokyo",
    "heure",
    "heure Xyzville",
    "15 h",
    "15 h Xyzville",
    "06 12 34 56 78",
    "01 23 45 67 89",
    "+33 6 12 34 56 78",
    "06-12-34-56-78",
    "1-2-3",
    "007",
    "ABC-123",
    "Mo",
    "1 Go",
    "10 min",
    "1 Go en kg",
    "1.5 en hex",
    "0x",
    "0xZZ",
    "0b102",
    "2pi",
    "2 3",
    "1 2345",
    "constructor",
    "5 constructor en hex",
    "toString(1)",
    "__proto__ + 1",
    "alert(1)",
    "1; 2",
    "1 + 2 + ",
    "((1)",
    "192.168.1.0/33",
    "192.168.1.300/24",
    "192.168.1.0 255.0.255.0",
  ];
  for (const q of NOT_CALC) {
    test(JSON.stringify(q), () => assert.deepEqual(all(q), []));
  }

  test("un texte très long n'est pas analysé", () => {
    assert.deepEqual(all("1+".repeat(150) + "1"), []);
  });

  test("des parenthèses imbriquées sans fin ne font pas tomber le lanceur", () => {
    assert.deepEqual(all("(".repeat(90) + "1" + ")".repeat(90)), []);
    assert.equal(title("((((1)))) + 1"), "2");
  });
});

describe("bases", () => {
  test("hexadécimal, binaire, octal seuls → décimal", () => {
    assert.equal(title("0x1F"), "31");
    assert.equal(title("0X1f"), "31");
    assert.equal(title("0b1010"), "10");
    assert.equal(title("0o17"), "15");
    assert.equal(all("0x1F")[0].detail, "hex 0x1F · bin 0b1 1111");
  });

  test("calculs avec des nombres en hexadécimal", () => {
    assert.equal(title("0xFF + 1"), "256");
    assert.equal(all("0xFF + 1")[0].detail, "hex 0x100 · bin 0b1 0000 0000");
  });

  test("« en hex », « en binaire », « en décimal », « en octal »", () => {
    assert.equal(title("255 en hex"), "0xFF");
    assert.equal(copy("255 en hex"), "0xFF");
    assert.equal(title("255 en hexadécimal"), "0xFF");
    assert.equal(title("255 in hex", "en"), "0xFF");
    assert.equal(title("255 to hex"), "0xFF");
    assert.equal(title("255 -> hex"), "0xFF");
    assert.equal(title("0xFF en décimal"), "255");
    assert.equal(title("0xFF en dec"), "255");
    assert.equal(title("42 en binaire"), "0b10 1010");
    assert.equal(copy("42 en binaire"), "0b101010");
    assert.equal(title("8 en octal"), "0o10");
    assert.equal(title("-1 en hex"), "-0x1");
    assert.equal(title("2^16 en hex"), "0x10000");
    assert.equal(title("70000 en décimal"), "70 000");
    assert.equal(copy("70000 en décimal"), "70000");
  });

  test("inBase", () => {
    assert.equal(inBase(255, 16), "0xFF");
    assert.equal(inBase(5, 2), "0b101");
    assert.equal(inBase(-8, 8), "-0o10");
  });
});

describe("unités", () => {
  test("octets : puissances de 1000 (Ko, Mo…) et de 1024 (Kio, Mio…)", () => {
    assert.equal(title("1 Go en Mo"), "1 000 Mo");
    assert.equal(title("1 Go en Mio"), "953,674 Mio");
    assert.equal(title("1 Gio en Mio"), "1 024 Mio");
    assert.equal(title("1 To en Go"), "1 000 Go");
    assert.equal(title("1 Tio en Gio"), "1 024 Gio");
    assert.equal(title("2048 Kio en Mio"), "2 Mio");
    assert.equal(title("1,5 Go en Mo"), "1 500 Mo");
    assert.equal(title("1 Mo en o"), "1 000 000 o");
  });

  test("octets : symboles anglais (B, KB, MB, KiB…) et majuscules", () => {
    assert.equal(title("1 GB in MB"), "1 000 MB");
    assert.equal(title("1 GiB to MB"), "1 073,74 MB");
    assert.equal(title("1 KiB en B"), "1 024 B");
    assert.equal(title("1 GO en MO"), "1 000 MO");
    assert.equal(title("1 go en mo"), "1 000 mo");
  });

  test("octets en toutes lettres", () => {
    assert.equal(title("1 gigaoctet en mégaoctets"), "1 000 mégaoctets");
    assert.equal(title("2 kilo-octets en octets"), "2 000 octets");
    assert.equal(title("1 gibibyte en megabytes"), "1 073,74 megabytes");
  });

  test("bits : b minuscule = bit, B majuscule = octet", () => {
    assert.equal(title("1 Gb en Mo"), "125 Mo");
    assert.equal(title("1 GB en Mb"), "8 000 Mb");
    assert.equal(title("8 bits en o"), "1 o");
    assert.equal(title("1 Mbit en Ko"), "125 Ko");
  });

  test("débits", () => {
    assert.equal(title("100 Mbit/s en Mo/s"), "12,5 Mo/s");
    assert.equal(title("100 Mbps en MB/s"), "12,5 MB/s");
    assert.equal(title("1 Gbit/s en Mo/s"), "125 Mo/s");
    assert.equal(title("5 Mbps en Ko/s"), "625 Ko/s");
    assert.equal(title("12,5 Mo/s en Mbit/s"), "100 Mbit/s");
    assert.equal(title("100Mbit/s en Mo/s"), "12,5 Mo/s");
    assert.equal(title("100 Mbit / s en Mo / s"), "12,5 Mo/s");
  });

  test("on ne mélange pas les familles (taille ≠ débit ≠ durée)", () => {
    assert.equal(title("1 Go en Mo/s"), null);
    assert.equal(title("1 h en Mo"), null);
    assert.equal(title("1 km en kg"), null);
  });

  test("durée de transfert : taille à débit", () => {
    assert.equal(title("1 Go à 100 Mbit/s"), "1 min 20 s");
    assert.equal(title("1 Go a 100 Mbps"), "1 min 20 s");
    assert.equal(title("1Go@100Mbps"), "1 min 20 s");
    assert.equal(title("1 To à 1 Gbit/s"), "2 h 13 min 20 s");
    assert.equal(title("100 Mo à 100 Mbit/s"), "8 s");
    assert.equal(title("10 Mo à 1 Go/s"), "0,01 s");
    assert.equal(title("1 GB at 100 Mbps", "en"), "1 min 20 s");
    assert.match(all("1 Go à 100 Mbit/s")[0].detail, /pertes du réseau/);
    assert.equal(title("1 Go à 0 Mbit/s"), null);
    assert.equal(title("1 Go à 100 Mo"), null);
  });

  test("durées", () => {
    assert.equal(title("90 min en h"), "1,5 h");
    assert.equal(title("3600 s en h"), "1 h");
    assert.equal(title("15 h en min"), "900 min");
    assert.equal(title("2 j en h"), "48 h");
    assert.equal(title("1 semaine en jours"), "7 jours");
    assert.equal(title("1500 ms en s"), "1,5 s");
  });

  test("températures", () => {
    assert.equal(title("20 °C en °F"), "68 °F");
    assert.equal(title("37 °C en F"), "98,6 °F");
    assert.equal(title("-40 c en f"), "-40 °F");
    assert.equal(title("100 °F en °C"), "37,78 °C");
    assert.equal(title("300 K en °C"), "26,85 °C");
    assert.equal(title("0 °C en K"), "273,15 K");
    assert.equal(title("20 ° C en ° F"), "68 °F");
    assert.equal(title("20 celsius en fahrenheit"), "68 fahrenheit");
  });

  test("longueurs, masses, vitesses", () => {
    assert.equal(title("10 km en mi"), "6,21371 mi");
    assert.equal(title("10 km -> mi"), "6,21371 mi");
    assert.equal(title("10 km → mi"), "6,21371 mi");
    assert.equal(title("1 mi en km"), "1,60934 km");
    assert.equal(title("6 ft en m"), "1,8288 m");
    assert.equal(title("100 m en ft"), "328,084 ft");
    assert.equal(title("1 in in cm"), "2,54 cm");
    assert.equal(title("3 pieds en cm"), "91,44 cm");
    assert.equal(title("27 pouces en cm"), "68,58 cm");
    assert.equal(title("5 lb en kg"), "2,26796 kg");
    assert.equal(title("100 kg en lb"), "220,462 lb");
    assert.equal(title("1 kg en g"), "1 000 g");
    assert.equal(title("16 oz en g"), "453,592 g");
    assert.equal(title("100 km/h en mph"), "62,1371 mph");
    assert.equal(title("10 noeuds en km/h"), "18,52 km/h");
  });

  test("le côté gauche peut être un calcul", () => {
    assert.equal(title("2 * 512 Mio en Gio"), "1 Gio");
    assert.equal(title("(1 + 1) Go en Mo"), "2 000 Mo");
  });

  test("le détail rappelle la conversion ; la copie garde l'unité, sans espaces de milliers", () => {
    const a = all("100 Mbit/s en Mo/s")[0];
    assert.equal(plain(a.detail), "100 Mbit/s = 12,5 Mo/s");
    assert.equal(a.copy, "12,5 Mo/s");
    assert.equal(copy("1 Mo en o"), "1000000 o");
    assert.equal(copy("1 GB in MB", "en"), "1000 MB");
  });
});

describe("sous-réseau IPv4", () => {
  test("192.168.1.0/26 : résumé puis une ligne par valeur", () => {
    const r = all("192.168.1.0/26");
    assert.equal(r.length, 6);
    assert.equal(plain(r[0].title), "192.168.1.0/26 · 62 hôtes");
    assert.match(r[0].detail, /^255\.255\.255\.192 · 192\.168\.1\.1 → 192\.168\.1\.62 · adresses privées/);
    assert.equal(
      r[0].copy,
      ["Réseau : 192.168.1.0/26", "Masque : 255.255.255.192", "Première adresse : 192.168.1.1", "Dernière adresse : 192.168.1.62", "Broadcast : 192.168.1.63", "Hôtes : 62"].join("\n"),
    );
    assert.deepEqual(
      r.slice(1).map((a) => [a.title, a.copy]),
      [
        ["Masque : 255.255.255.192", "255.255.255.192"],
        ["Réseau : 192.168.1.0", "192.168.1.0"],
        ["Première adresse : 192.168.1.1", "192.168.1.1"],
        ["Dernière adresse : 192.168.1.62", "192.168.1.62"],
        ["Broadcast : 192.168.1.63", "192.168.1.63"],
      ],
    );
    assert.equal(r[1].detail, "/26 · masque inverse 0.0.0.63");
  });

  test("adresse + masque (espace, « masque », « / »)", () => {
    assert.equal(title("192.168.1.10 255.255.255.0"), "192.168.1.0/24 · 254 hôtes");
    assert.equal(title("192.168.1.10 masque 255.255.255.0"), "192.168.1.0/24 · 254 hôtes");
    assert.equal(title("172.16.5.4/255.255.240.0"), "172.16.0.0/20 · 4 094 hôtes");
    assert.equal(title("10.20.30.40 / 8"), "10.0.0.0/8 · 16 777 214 hôtes");
  });

  test("/31, /32, /0", () => {
    const r31 = all("10.1.1.1/31");
    assert.equal(r31[0].title, "10.1.1.0/31 · 2 hôtes");
    assert.equal(r31[3].copy, "10.1.1.0"); // première = le réseau (liaison point à point)
    assert.equal(r31[4].copy, "10.1.1.1");
    assert.equal(title("8.8.8.8/32"), "8.8.8.8/32 · 1 hôte");
    assert.match(plain(title("0.0.0.0/0") ?? ""), /^0\.0\.0\.0\/0 · 4 294 967 294 hôtes$/);
  });

  test("la plage est nommée (privée, APIPA, publique…)", () => {
    assert.match(all("169.254.3.4/16")[0].detail, /APIPA/);
    assert.match(all("100.64.0.1/10")[0].detail, /CGNAT/);
    assert.match(all("127.0.0.1/8")[0].detail, /loopback/);
    assert.match(all("8.8.8.0/24")[0].detail, /publiques/);
    assert.match(all("224.0.0.1/4")[0].detail, /multicast/);
  });

  test("en anglais", () => {
    const r = all("192.168.1.0/24", "en");
    assert.equal(r[0].title, "192.168.1.0/24 · 254 hosts");
    assert.equal(r[1].title, "Mask: 255.255.255.0");
    assert.match(r[0].copy, /^Network: 192\.168\.1\.0\/24\nMask: 255\.255\.255\.0\n/);
  });

  test("un masque qui n'est pas d'un seul tenant n'est pas un sous-réseau", () => {
    assert.deepEqual(all("192.168.1.0 255.255.0.255"), []);
  });
});

describe("heures du monde dans le lanceur", () => {
  test("« 15 h Montréal » : l'heure ici (Paris)", () => {
    const r = all("15 h Montréal");
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, "time");
    assert.equal(r[0].title, "15 h 00 à Montréal = 21 h 00 ici");
    assert.equal(r[0].detail, "Montréal : −6 h par rapport à ici");
    // Dans le presse-papiers, « ici » devient la ville du PC.
    assert.equal(r[0].copy, "15 h 00 à Montréal = 21 h 00 à Paris");
  });

  test("écritures acceptées", () => {
    for (const q of ["15h Montréal", "15 h montreal", "15h00 à Montréal", "15:00 Montréal", "15 h à MONTRÉAL", "3 pm Montréal", "3pm montreal"]) {
      assert.equal(title(q), "15 h 00 à Montréal = 21 h 00 ici", q);
    }
    assert.equal(title("15h30 à Tokyo"), "15 h 30 à Tokyo = 8 h 30 ici");
    assert.equal(title("12 am Tokyo"), "0 h 00 à Tokyo = 17 h 00 ici, la veille");
  });

  test("le lendemain, la veille", () => {
    assert.equal(title("23 h Montréal"), "23 h 00 à Montréal = 5 h 00 ici, le lendemain");
    assert.equal(title("1 h Tokyo"), "1 h 00 à Tokyo = 18 h 00 ici, la veille");
  });

  test("« heure à Tokyo » : l'heure qu'il est là-bas", () => {
    for (const q of ["heure Tokyo", "heure à Tokyo", "Heure a tokyo", "quelle heure à Tokyo ?", "quelle heure est-il à Tokyo ?"]) {
      assert.equal(title(q), "21 h 00 à Tokyo", q);
    }
    assert.equal(all("heure à Tokyo")[0].detail, "mercredi 15 juillet · +7 h par rapport à ici");
    assert.equal(copy("heure à Tokyo"), "21 h 00 à Tokyo");
    assert.equal(title("heure à Paris"), "14 h 00 à Paris");
    assert.equal(all("heure à Paris")[0].detail, "mercredi 15 juillet · même heure");
    // « au Caire », pas « à Le Caire ».
    assert.equal(title("heure au Caire"), "15 h 00 au Caire");
    assert.equal(title("9 h Le Cap"), "9 h 00 au Cap = 9 h 00 ici");
  });

  test("en anglais", () => {
    assert.equal(title("3 pm in Tokyo", "en"), "15:00 in Tokyo = 08:00 here");
    assert.equal(copy("3 pm in Tokyo", "en"), "15:00 in Tokyo = 08:00 in Paris");
    assert.equal(title("time in Tokyo", "en"), "21:00 in Tokyo");
    assert.equal(title("what time is it in New York?", "en"), "08:00 in New York");
  });

  test("une heure impossible n'est pas une heure", () => {
    assert.deepEqual(all("25 h Tokyo"), []);
    assert.deepEqual(all("15h75 Tokyo"), []);
    assert.deepEqual(all("13 pm Tokyo"), []);
  });

  test("« 15 h en min » reste une conversion de durée", () => {
    assert.equal(title("15 h en min"), "900 min");
  });
});

describe("mise en forme", () => {
  test("formatNumber", () => {
    assert.equal(plain(formatNumber(1234.5, "fr")), "1 234,5");
    assert.equal(formatNumber(1234.5, "en"), "1,234.5");
    assert.equal(formatNumber(1234.5, "fr", { group: false }), "1234,5");
    assert.equal(formatNumber(-0, "fr"), "0");
    assert.equal(formatNumber(0.000123, "fr", { decimals: 2 }), "0,000123");
    assert.equal(formatNumber(953.6743164, "fr", { significant: 6 }), "953,674");
    assert.equal(plain(formatNumber(1234567, "fr", { significant: 6 })), "1 234 567");
    assert.equal(formatNumber(Number.NaN, "fr"), "");
    assert.equal(formatNumber(Infinity, "fr"), "");
  });

  test("formatDuration", () => {
    assert.equal(formatDuration(0.5, "fr"), "0,5 s");
    assert.equal(formatDuration(12.25, "fr"), "12,3 s");
    assert.equal(formatDuration(80, "fr"), "1 min 20 s");
    assert.equal(formatDuration(3600, "fr"), "1 h");
    assert.equal(formatDuration(3 * 86400 + 2 * 3600 + 5, "fr"), "3 j 2 h");
    assert.equal(formatDuration(3 * 86400, "en"), "3 d");
  });

  test("evaluate : nombre d'opérations et bases", () => {
    assert.deepEqual(evaluate("2024"), { value: 2024, pct: false, ops: 0, exotic: false });
    assert.deepEqual(evaluate("0x10"), { value: 16, pct: false, ops: 0, exotic: true });
    assert.deepEqual(evaluate("15 %"), { value: 0.15, pct: true, ops: 1, exotic: false });
    assert.equal(evaluate("2 +"), null);
  });
});

describe("GUID", () => {
  test("format version 4, et jamais deux fois le même", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const g = newGuid();
      assert.match(g, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(g);
    }
    assert.equal(seen.size, 200);
  });
});
