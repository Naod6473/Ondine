// Tests du décodeur du presse-papiers (src/modules/clipboard/decode.ts) :
// ce qu'il reconnaît (JWT, Base64, adresse %xx, JSON compact, horodatage
// Unix), ce qu'il ne doit PAS reconnaître (un mot ordinaire n'est pas du
// Base64…), et ce qu'il affiche.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  base64Bytes,
  decode,
  DecodeError,
  detect,
  formatDate,
  JWT_WARNING,
  prettyJson,
  queryParams,
  readable,
  relative,
  timestampMs,
  utf8,
} from "../../src/modules/clipboard/decode";

/** Texte → Base64 (alphabet standard, avec « = »). */
function b64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Texte → Base64 « URL » sans « = » (comme dans un JWT). */
function b64url(text: string): string {
  return b64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(header: object, payload: object, signature = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"): string {
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${signature}`;
}

/** Le jeton d'exemple de jwt.io. */
const JWT_IO =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

/** 7 octobre 2026, 12:00:00 UTC : le « maintenant » des tests. */
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

describe("reconnaître : jeton JWT", () => {
  test("le jeton de jwt.io", () => {
    assert.equal(detect(JWT_IO), "jwt");
  });
  test("copié avec « Bearer » devant (en-tête HTTP)", () => {
    assert.equal(detect(`Bearer ${JWT_IO}`), "jwt");
    assert.equal(detect(`  bearer ${JWT_IO}\n`), "jwt");
  });
  test("sans signature (alg none) : reconnu quand même", () => {
    assert.equal(detect(jwt({ alg: "none" }, { sub: "x" }, "")), "jwt");
  });
  test("trois morceaux qui ne sont pas du JSON : pas un JWT", () => {
    assert.notEqual(detect("abc.def.ghi"), "jwt");
    assert.notEqual(detect("www.example.com"), "jwt");
    assert.notEqual(detect("version.1.2"), "jwt");
    // Un en-tête sans « alg » n'est pas celui d'un JWT.
    assert.notEqual(detect(jwt({ typ: "JWT" }, { sub: "x" })), "jwt");
  });
  test("début seulement (longue copie coupée) : l'en-tête suffit", () => {
    const long = jwt({ alg: "RS256", typ: "JWT" }, { data: "x".repeat(400) });
    assert.equal(detect(long.slice(0, 300), true), "jwt");
    // Coupé avant la fin de l'en-tête : on ne peut pas dire que c'est un JWT
    // (le décodage du texte entier tranchera).
    assert.notEqual(detect(long.slice(0, 20), true), "jwt");
  });
});

describe("reconnaître : Base64", () => {
  test("du texte encodé", () => {
    assert.equal(detect("SGVsbG8gd29ybGQ="), "base64"); // Hello world
    assert.equal(detect("Q2Fmw6kgY3LDqG1l"), "base64"); // Café crème
    assert.equal(detect(b64("Mot de passe du Wi-Fi : invité")), "base64");
  });
  test("alphabet « URL » (- et _) et sans « = »", () => {
    assert.equal(detect(b64url("été à l'île ? oui !")), "base64");
  });
  test("en plusieurs lignes (courriel, MIME)", () => {
    const long = b64("Une phrase assez longue pour être coupée en plusieurs lignes de Base64. ".repeat(3));
    const wrapped = long.match(/.{1,76}/g)!.join("\r\n");
    assert.ok(wrapped.includes("\n"));
    assert.equal(detect(wrapped), "base64");
  });
  test("un fichier encodé (image PNG, octets au hasard) : rien n'est proposé", () => {
    assert.equal(detect("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), null);
    assert.equal(detect("/9j/4AAQSkZJRgABAQEASABIAAD/2wBD"), null); // début d'un JPEG
  });
  test("un mot ordinaire n'est PAS du Base64", () => {
    for (const word of ["Bonjour", "Organisation", "Administrateur", "abcdefgh", "password", "Password123", "getElementById", "Tr0ub4dor3", "iPhone12", "SuperAdmin", "MicrosoftTeams", "WindowsUpdate", "Anticonstitutionnellement"]) {
      assert.equal(detect(word), null, word);
    }
  });
  test("ni une phrase, un chemin, un nom de fichier ou une adresse", () => {
    for (const text of ["Bonjour tout le monde", "C:\\Windows\\System32", "rapport-final.pdf", "https://example.com/page", "simon@example.com", "and/or", "TCP/IP"]) {
      assert.equal(detect(text), null, text);
    }
  });
  test("ni une empreinte (hexadécimal), un nombre ou un UUID", () => {
    assert.equal(detect("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), null);
    assert.equal(detect("deadbeefcafebabe"), null);
    assert.equal(detect("12345678901234567890"), null);
    assert.equal(detect("550e8400-e29b-41d4-a716-446655440000"), null);
  });
  test("début seulement : on juge sur le début décodé", () => {
    const long = b64("Un long texte en français, encodé en Base64, dont on ne voit que le début. ".repeat(10));
    assert.equal(detect(long.slice(0, 300), true), "base64");
    const binary = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".repeat(5);
    assert.equal(detect(binary.slice(0, 300), true), null);
  });
});

describe("reconnaître : adresse encodée (%xx)", () => {
  test("une adresse ou un texte avec des %xx", () => {
    assert.equal(detect("https%3A%2F%2Fexample.com%2F%3Fq%3Dcaf%C3%A9"), "url");
    assert.equal(detect("https://example.com/search?q=caf%C3%A9%20cr%C3%A8me"), "url");
    assert.equal(detect("Jean%20Dupont"), "url");
  });
  test("pas de %xx valide, ou des espaces : rien", () => {
    assert.equal(detect("100% sûr"), null);
    assert.equal(detect("50%off"), null);
    assert.equal(detect("remise de 20%"), null);
    assert.equal(detect("caf%E9"), null); // ancien encodage (Latin-1) : invalide en UTF-8
    assert.equal(detect("%00%01"), null); // des caractères de contrôle
  });
  test("début seulement, coupé au milieu d'un caractère encodé", () => {
    const long = `https://example.com/?redirect=${encodeURIComponent("https://intranet.example.com/été/".repeat(20))}`;
    for (const cut of [100, 101, 102, 103]) assert.equal(detect(long.slice(0, cut), true), "url", `coupé à ${cut}`);
  });
});

describe("reconnaître : JSON compact", () => {
  test("un objet ou une liste sur une ligne", () => {
    assert.equal(detect('{"user":"simon","admin":true,"groups":["it","support"]}'), "json");
    assert.equal(detect('[{"id":1},{"id":2}]'), "json");
  });
  test("déjà mis en forme : rien à proposer", () => {
    assert.equal(detect(prettyJson('{"user":"simon","admin":true}')), null);
    assert.equal(detect('{\n  "a": 1\n}'), null);
  });
  test("pas du JSON : rien", () => {
    assert.equal(detect("{pas du json}"), null);
    assert.equal(detect("[lien](https://example.com)"), null);
    assert.equal(detect("['a', 'b', 'c']"), null); // guillemets simples : du Python, pas du JSON
    assert.equal(detect("{}"), null);
  });
  test("début seulement : les accolades doivent se suivre", () => {
    const long = JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `élément ${i}` })) });
    assert.equal(detect(long.slice(0, 300), true), "json");
    assert.equal(detect("{\"a\":1}} et du texte", true), null);
  });
});

describe("reconnaître : horodatage Unix", () => {
  test("10 chiffres (secondes) et 13 chiffres (millisecondes)", () => {
    assert.equal(detect("1700000000"), "timestamp");
    assert.equal(detect("1700000000123"), "timestamp");
    assert.equal(detect(" 1759838400 "), "timestamp");
  });
  test("seulement les dates plausibles (2000 à 2050)", () => {
    assert.equal(timestampMs("1700000000"), 1_700_000_000_000);
    assert.equal(timestampMs("0612345678"), null); // un numéro de téléphone (1989)
    assert.equal(timestampMs("4102444800"), null); // 2100
    assert.equal(timestampMs("9999999999"), null);
    assert.equal(timestampMs("3017620422003"), null); // un code-barres (2065)
    assert.equal(timestampMs("123456789"), null); // 9 chiffres
    assert.equal(timestampMs("12345678901"), null); // 11 chiffres
    assert.equal(detect("0612345678"), null);
  });
  test("pas dans un texte coupé (il serait plus long)", () => {
    assert.equal(detect("1700000000", true), null);
  });
});

describe("décoder : jeton JWT", () => {
  test("en-tête et contenu en JSON lisible, mention de la signature non vérifiée", () => {
    const d = decode(JWT_IO, "jwt", NOW);
    assert.equal(d.title, "Jeton JWT");
    assert.equal(d.warning, JWT_WARNING);
    assert.match(d.warning!, /non vérifiée/);
    assert.equal(d.blocks[0].label, "En-tête");
    assert.equal(d.blocks[0].text, '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    assert.equal(d.blocks[1].label, "Contenu");
    assert.equal(d.blocks[1].text, '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}');
    assert.deepEqual(d.facts[0], { label: "Algorithme", value: "HS256" });
  });
  test("dates exp / iat / nbf en clair, avec expiré ou encore valide", () => {
    const s = (iso: string) => Date.parse(iso) / 1000;
    const token = jwt({ alg: "RS256" }, { iat: s("2026-10-07T11:00:00Z"), nbf: s("2026-10-07T11:00:00Z"), exp: s("2026-10-07T14:00:00Z") });
    const d = decode(token, "jwt", NOW);
    const labels = d.facts.map((f) => f.label);
    assert.deepEqual(labels, ["Algorithme", "Émis le (iat)", "Valable à partir du (nbf)", "Expire le (exp)"]);
    const exp = d.facts[3];
    assert.equal(exp.value, formatDate(Date.parse("2026-10-07T14:00:00Z")).local);
    assert.equal(exp.note, "dans 2 h");
    assert.deepEqual(exp.status, { text: "encore valide", tone: "good" });
    assert.equal(d.facts[1].note, "il y a 1 h");
    assert.equal(d.facts[2].status, undefined); // déjà valable

    const old = decode(jwt({ alg: "HS256" }, { exp: s("2026-10-05T12:00:00Z") }), "jwt", NOW);
    assert.deepEqual(old.facts[1].status, { text: "expiré", tone: "bad" });
    assert.equal(old.facts[1].note, "il y a 2 j");

    const later = decode(jwt({ alg: "HS256" }, { nbf: s("2026-10-08T12:00:00Z") }), "jwt", NOW);
    assert.deepEqual(later.facts[1].status, { text: "pas encore valide", tone: "bad" });
  });
  test("alg none : signalé", () => {
    const d = decode(jwt({ alg: "none" }, { sub: "x" }, ""), "jwt", NOW);
    assert.deepEqual(d.facts[0].status, { text: "aucune signature", tone: "bad" });
  });
  test("avec « Bearer » devant", () => {
    assert.equal(decode(`Bearer ${JWT_IO}`, "jwt", NOW).blocks.length, 2);
  });
  test("un grand nombre du contenu garde tous ses chiffres", () => {
    const token = `${b64url('{"alg":"HS256"}')}.${b64url('{"id":12345678901234567890}')}.x`;
    assert.equal(decode(token, "jwt", NOW).blocks[1].text, '{\n  "id": 12345678901234567890\n}');
  });
  test("un jeton abîmé : une erreur claire, sans le texte copié", () => {
    assert.throws(() => decode("abc.def", "jwt", NOW), DecodeError);
    assert.throws(() => decode(`${b64url('{"alg":"HS256"}')}.@@@.x`, "jwt", NOW), /contenu du jeton/);
    try {
      decode("secret-token.zzz.yyy", "jwt", NOW);
      assert.fail("aurait dû échouer");
    } catch (err) {
      assert.ok(!(err as Error).message.includes("secret"), "le message ne cite pas le texte");
    }
  });
});

describe("décoder : Base64", () => {
  test("du texte", () => {
    const d = decode("SGVsbG8gd29ybGQ=", "base64", NOW);
    assert.equal(d.title, "Base64 décodé");
    assert.deepEqual(d.blocks, [{ label: "Texte", text: "Hello world" }]);
    assert.equal(decode("Q2Fmw6kgY3LDqG1l", "base64").blocks[0].text, "Café crème");
  });
  test("du JSON encodé : mis en forme aussi", () => {
    const d = decode(b64('{"user":"simon","admin":true}'), "base64");
    assert.deepEqual(d.blocks, [{ label: "Texte (JSON mis en forme)", text: '{\n  "user": "simon",\n  "admin": true\n}' }]);
  });
  test("des octets qui ne sont pas du texte : erreur", () => {
    assert.throws(() => decode("iVBORw0KGgoAAAANSUhEUgAA", "base64"), /pas de texte lisible/);
    assert.throws(() => decode("pas du base64 !", "base64"), DecodeError);
  });
});

describe("décoder : adresse encodée", () => {
  test("le texte décodé", () => {
    const d = decode("https%3A%2F%2Fexample.com%2F%3Fq%3Dcaf%C3%A9", "url");
    assert.equal(d.title, "Adresse décodée");
    assert.equal(d.blocks[0].text, "https://example.com/?q=café");
  });
  test("les paramètres un par un (« + » = espace)", () => {
    const d = decode("https://example.com/search?q=caf%C3%A9+cr%C3%A8me&page=2&redirect=https%3A%2F%2Fa.b%2F%3Fx%3D1#haut", "url");
    assert.equal(d.blocks[1].label, "Paramètres");
    assert.equal(d.blocks[1].text, "q = café crème\npage = 2\nredirect = https://a.b/?x=1");
    assert.deepEqual(queryParams("a=1&b=%C3%A9t%C3%A9&vide"), [
      ["a", "1"],
      ["b", "été"],
      ["vide", ""],
    ]);
    assert.deepEqual(queryParams("Jean%20Dupont"), []);
  });
  test("des %xx invalides : erreur", () => {
    assert.throws(() => decode("caf%E9", "url"), /%xx invalides/);
  });
});

describe("décoder : JSON", () => {
  test("mis en forme, valeurs recopiées telles quelles", () => {
    const d = decode('{"id":12345678901234567890,"name":"\\u00e9t\\u00e9","list":[1,2.50,{"x":null}],"empty":{},"none":[]}', "json");
    assert.equal(d.title, "JSON mis en forme");
    assert.equal(
      d.blocks[0].text,
      [
        "{",
        '  "id": 12345678901234567890,',
        '  "name": "\\u00e9t\\u00e9",',
        '  "list": [',
        "    1,",
        "    2.50,",
        "    {",
        '      "x": null',
        "    }",
        "  ],",
        '  "empty": {},',
        '  "none": []',
        "}",
      ].join("\n"),
    );
  });
  test("les signes dans les textes ne sont pas touchés", () => {
    assert.equal(prettyJson('{"a":"x, y: {z} [w] \\"q\\""}'), '{\n  "a": "x, y: {z} [w] \\"q\\""\n}');
  });
  test("pas du JSON : erreur sans citer le texte", () => {
    try {
      decode('{"motdepasse": "hunter2"', "json");
      assert.fail("aurait dû échouer");
    } catch (err) {
      assert.ok(err instanceof DecodeError);
      assert.ok(!err.message.includes("hunter2"));
    }
  });
});

describe("décoder : horodatage Unix", () => {
  test("secondes : heure locale, UTC, ISO, et il y a combien de temps", () => {
    const d = decode("1700000000", "timestamp", NOW);
    assert.equal(d.title, "Horodatage Unix (secondes)");
    assert.deepEqual(
      d.facts.map((f) => f.label),
      ["Heure locale", "UTC", "ISO 8601"],
    );
    assert.equal(d.facts[1].value, "2023-11-14 22:13:20 UTC");
    assert.equal(d.facts[2].value, "2023-11-14T22:13:20.000Z");
    assert.equal(d.facts[0].note, "il y a 3 ans");
    assert.match(d.facts[0].value, /^2023-11-1[45] \d\d:13:20 \(UTC[+−]\d\d:\d\d\)$/);
  });
  test("millisecondes : les millièmes sont gardés", () => {
    const d = decode("1700000000123", "timestamp", NOW);
    assert.equal(d.title, "Horodatage Unix (millisecondes)");
    assert.equal(d.facts[1].value, "2023-11-14 22:13:20.123 UTC");
  });
  test("une date pas plausible : erreur", () => {
    assert.throws(() => decode("9999999999", "timestamp", NOW), DecodeError);
  });
});

describe("petits outils", () => {
  test("base64Bytes : strict", () => {
    assert.deepEqual([...base64Bytes("TWFu")!], [77, 97, 110]);
    assert.deepEqual([...base64Bytes("TWE=")!], [77, 97]);
    assert.deepEqual([...base64Bytes("TWE")!], [77, 97]); // sans « = »
    assert.deepEqual([...base64Bytes("-_8")!], [251, 255]); // alphabet URL
    assert.equal(base64Bytes("TWE==="), null); // trop de « = »
    assert.equal(base64Bytes("TWF=u"), null);
    assert.equal(base64Bytes("T"), null); // un caractère tout seul
    assert.equal(base64Bytes("TWF+u-8"), null); // deux alphabets mélangés
    assert.equal(base64Bytes("TWF"), null); // les bits qui restent ne valent pas zéro
  });
  test("utf8 : refuse ce qui n'est pas de l'UTF-8, accepte une fin coupée si demandé", () => {
    assert.equal(utf8(new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9])), "café");
    assert.equal(utf8(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), null);
    assert.equal(utf8(new Uint8Array([0x63, 0x61, 0x66, 0xc3])), null);
    assert.equal(utf8(new Uint8Array([0x63, 0x61, 0x66, 0xc3]), true), "caf");
  });
  test("readable", () => {
    assert.ok(readable("Bonjour\ttout le monde\r\n"));
    assert.ok(readable('{"a":1}'));
    assert.ok(!readable("\u0000\u0001abc"));
    assert.ok(!readable("!!! ???"));
    assert.ok(!readable("abc\uFFFD"));
  });
  test("relative", () => {
    assert.equal(relative(NOW - 2000, NOW), "à l'instant");
    assert.equal(relative(NOW - 30_000, NOW), "il y a 30 s");
    assert.equal(relative(NOW + 5 * 60_000, NOW), "dans 5 min");
    assert.equal(relative(NOW - 47 * 3_600_000, NOW), "il y a 47 h");
    assert.equal(relative(NOW + 3 * 86_400_000, NOW), "dans 3 j");
    assert.equal(relative(NOW - 730 * 86_400_000, NOW), "il y a 2 ans");
  });
  test("formatDate : UTC et ISO", () => {
    const f = formatDate(Date.UTC(2026, 0, 2, 3, 4, 5));
    assert.equal(f.utc, "2026-01-02 03:04:05 UTC");
    assert.equal(f.iso, "2026-01-02T03:04:05.000Z");
  });
});
