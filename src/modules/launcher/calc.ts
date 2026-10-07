// Les calculs du Lanceur : quand ce qu'on tape dans la recherche (Alt+Espace)
// est un calcul, la réponse s'affiche en premier résultat, et Entrée la copie.
//
//   Arithmétique : « 2 + 3 × 4 », « (1,5 + 2) ^ 2 », « 1 200 / 3 »,
//                  « 18 % de 240 », « 240 + 18 % », « 15 % » (= 0,15)
//   Unités       : « 1 Go en Mio », « 100 Mbit/s en Mo/s », « 90 min en h »,
//                  « 20 °C en °F », « 10 km -> mi », « 5 lb en kg »
//   Transfert    : « 1 Go à 100 Mbit/s » (combien de temps ça prend)
//   Bases        : « 0x1F », « 0b1010 », « 255 en hex », « 0xFF en décimal »,
//                  « 42 en binaire »
//   Sous-réseau  : « 192.168.1.0/26 », « 192.168.1.10 255.255.255.0 »
//   Heures       : « 15 h Montréal », « 15h30 à Tokyo », « heure à Tokyo »
//                  (villes de src/core/world-cities.ts)
//
// Pas d'eval ni de new Function : un petit analyseur écrit à la main, qui
// refuse tout ce qu'il ne comprend pas. Une saisie qui n'est pas un calcul
// (« 2024 », « rapport-2024.pdf », une date, une version « 1.0.1 », une
// adresse IP seule) ne donne AUCUN résultat : le Lanceur reste comme avant.
//
// Les nombres suivent la langue de l'interface : en français « 1 234,5 »
// (virgule décimale, espaces entre les milliers ; le point est aussi compris),
// en anglais « 1,234.5 ». Ce qui est copié n'a pas d'espaces de milliers, pour
// se coller tel quel dans Excel ou un ticket.
//
// Pur (aucun DOM, aucun appel au Rust) : testé dans tests/front/calc.test.ts.

import { type City, cityName, findCity, localCity, localZone } from "../../core/world-cities";
import { cityClock, clockText, dayWord, fromCityTime, offsetText } from "../../core/world-time";

export type CalcLang = "fr" | "en";

/** La famille d'un résultat : choisit l'icône et l'étiquette dans le Lanceur. */
export type CalcKind = "math" | "base" | "convert" | "temp" | "duration" | "subnet" | "time";

/** Une réponse à afficher : un titre (le résultat), une précision dessous, et ce qu'Entrée copie. */
export interface CalcAnswer {
  kind: CalcKind;
  title: string;
  detail: string;
  copy: string;
}

/** Au-delà, ce n'est pas un calcul (et on ne fait pas travailler l'analyseur pour rien). */
const MAX_QUERY = 200;
/** Parenthèses imbriquées au plus (évite de faire déborder la pile). */
const MAX_DEPTH = 40;

const LOCALE: Record<CalcLang, string> = { fr: "fr-FR", en: "en-US" };

// ── Les textes (dans les deux langues : ce qui est copié doit l'être aussi) ──

const TEXT = {
  fr: {
    copyHint: "Entrée pour copier le résultat",
    hosts: (n: string, plural: boolean) => `${n} hôte${plural ? "s" : ""}`,
    mask: "Masque",
    wildcard: "masque inverse",
    network: "Réseau",
    first: "Première adresse",
    last: "Dernière adresse",
    broadcast: "Broadcast",
    hostsLabel: "Hôtes",
    transfer: "sans compter les pertes du réseau",
    rateAt: "à",
    here: "ici",
    nextDay: "le lendemain",
    prevDay: "la veille",
    vsHere: "par rapport à ici",
    dec: "déc",
    days: "j",
    ranges: {
      private: "adresses privées (RFC 1918)",
      shared: "adresses partagées (CGNAT, RFC 6598)",
      loopback: "boucle locale (loopback)",
      linkLocal: "lien local (APIPA : pas de réponse DHCP)",
      multicast: "multicast",
      reserved: "réservé",
      thisNet: "« ce réseau » (0.0.0.0/8)",
      public: "adresses publiques",
    },
  },
  en: {
    copyHint: "Enter to copy the result",
    hosts: (n: string, plural: boolean) => `${n} host${plural ? "s" : ""}`,
    mask: "Mask",
    wildcard: "wildcard mask",
    network: "Network",
    first: "First address",
    last: "Last address",
    broadcast: "Broadcast",
    hostsLabel: "Hosts",
    transfer: "not counting network overhead",
    rateAt: "at",
    here: "here",
    nextDay: "the next day",
    prevDay: "the day before",
    vsHere: "compared to here",
    dec: "dec",
    days: "d",
    ranges: {
      private: "private addresses (RFC 1918)",
      shared: "shared addresses (CGNAT, RFC 6598)",
      loopback: "loopback",
      linkLocal: "link-local (APIPA: no DHCP answer)",
      multicast: "multicast",
      reserved: "reserved",
      thisNet: "\"this network\" (0.0.0.0/8)",
      public: "public addresses",
    },
  },
};

// ── Mise en forme des nombres ─────────────────────────────────────────────────

/**
 * « 1 234,5 » (ou « 1,234.5 » en anglais). Arrondi raisonnable : 12 chiffres
 * significatifs (0,1 + 0,2 = 0,3), `decimals` après la virgule au plus, mais
 * un petit nombre garde au moins 3 chiffres significatifs (0,000123 et pas 0).
 * `significant` : au plus ce nombre de chiffres en tout, sans jamais arrondir
 * la partie entière (953,674 Mio ; 1 234 567 o).
 * Très grand ou très petit : notation scientifique (« 1,2E18 »).
 * `group: false` : sans espaces de milliers (pour copier).
 */
export function formatNumber(n: number, lang: CalcLang, opts: { group?: boolean; decimals?: number; significant?: number } = {}): string {
  if (!Number.isFinite(n)) return "";
  let v = Number(n.toPrecision(12));
  if (v === 0) v = 0; // pas de « -0 »
  const abs = Math.abs(v);
  if (abs >= 1e15 || (abs > 0 && abs < 1e-6)) {
    return new Intl.NumberFormat(LOCALE[lang], { notation: "scientific", maximumFractionDigits: 6 }).format(v);
  }
  let decimals = opts.decimals ?? 10;
  if (opts.significant) decimals = Math.max(0, opts.significant - (abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 0));
  if (abs > 0 && abs < 1) decimals = Math.max(decimals, Math.min(Math.ceil(-Math.log10(abs)) + 2, 10));
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: decimals, useGrouping: opts.group !== false }).format(v);
}

/** Un entier dans une base : « 0xFF », « 0b1010 », « 0o17 » (avec « - » s'il est négatif). */
export function inBase(n: number, base: 2 | 8 | 16): string {
  const prefix = base === 16 ? "0x" : base === 2 ? "0b" : "0o";
  return (n < 0 ? "-" : "") + prefix + Math.abs(n).toString(base).toUpperCase();
}

/** « 0b101010 » → « 0b10 1010 » : le binaire se lit mieux par paquets de 4. */
function groupBinary(text: string): string {
  return text.replace(/(0b)([01]+)/, (_, p: string, d: string) => p + d.replace(/\B(?=(?:[01]{4})+$)/g, " "));
}

/** « 1 h 20 min », « 2 j 3 h », « 12,5 s ». */
export function formatDuration(seconds: number, lang: CalcLang): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${formatNumber(seconds, lang, { decimals: seconds < 10 ? 2 : 1 })} s`;
  const total = Math.round(seconds);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${formatNumber(d, lang)} ${TEXT[lang].days}`);
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (s && !d) parts.push(`${s} s`);
  return parts.join(" ");
}

// ── L'analyseur d'expressions ─────────────────────────────────────────────────

type Tok =
  | { k: "num"; v: number; exotic: boolean }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { k: "(" | ")" | "%" | "of" | "sqrt" | "pi" };

/** Un blanc, y compris les espaces insécables (copiés depuis Excel ou Word). */
const BLANK = /[\s\u00a0\u202f\u2009]/;
/** 0x1F, 0b1010, 0o17 (le reste du mot doit être des chiffres de la base). */
const PREFIXED = /0([xbo])([0-9a-z]+)/iy;
/** Français : « 1 200,5 », « 1200.5 », « 1,5 ». Les milliers sont des paquets de 3 chiffres. */
const NUM_FR = /(\d{1,3}(?:[\s\u00a0\u202f\u2009]\d{3}(?!\d))+|\d+)(?:[.,](\d+))?/y;
/** Anglais : « 1,200.5 », « 1 200.5 ». */
const NUM_EN = /(\d{1,3}(?:[,\s\u00a0\u202f\u2009]\d{3}(?!\d))+|\d+)(?:\.(\d+))?/y;
const WORD = /[a-zà-öø-ÿ]+/iy;

/** Les mots compris dans un calcul (sans accents ni majuscules). */
const TIMES: Tok = { k: "op", v: "*" };
const WORDS = new Map<string, Tok | "skip">([
  ["x", TIMES],
  ["fois", TIMES],
  ["times", TIMES],
  ["de", { k: "of" }],
  ["of", { k: "of" }],
  ["pi", { k: "pi" }],
  ["sqrt", { k: "sqrt" }],
  ["racine", { k: "sqrt" }],
  // « racine carrée de 16 »
  ["carree", "skip"],
  ["carre", "skip"],
]);

function plainWord(w: string): string {
  return w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Découpe le texte en morceaux (nombres, opérateurs…). null : un caractère inconnu. */
function tokenize(src: string, lang: CalcLang): Tok[] | null {
  const s = src
    .replace(/[×✕∙⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\*\*/g, "^");
  const toks: Tok[] = [];
  const num = lang === "en" ? NUM_EN : NUM_FR;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (BLANK.test(c)) {
      i++;
      continue;
    }
    PREFIXED.lastIndex = i;
    let m = PREFIXED.exec(s);
    if (m) {
      const base = { x: 16, b: 2, o: 8 }[m[1].toLowerCase() as "x" | "b" | "o"];
      const digits = m[2].toLowerCase();
      const ok = base === 16 ? /^[0-9a-f]+$/ : base === 2 ? /^[01]+$/ : /^[0-7]+$/;
      if (!ok.test(digits)) return null;
      const v = parseInt(digits, base);
      if (!Number.isSafeInteger(v)) return null;
      toks.push({ k: "num", v, exotic: true });
      i += m[0].length;
      continue;
    }
    num.lastIndex = i;
    m = num.exec(s);
    if (m) {
      const int = m[1].replace(/[,\s\u00a0\u202f\u2009]/g, "");
      // « 007 », « 06 12 34 56 78 », « 01-02-03 » : un numéro, pas un calcul.
      if (int.length > 1 && int[0] === "0") return null;
      toks.push({ k: "num", v: Number(`${int}.${m[2] ?? "0"}`), exotic: false });
      i += m[0].length;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      toks.push({ k: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === "%") {
      toks.push({ k: c });
      i++;
      continue;
    }
    if (c === "√") {
      toks.push({ k: "sqrt" });
      i++;
      continue;
    }
    if (c === "π") {
      toks.push({ k: "pi" });
      i++;
      continue;
    }
    WORD.lastIndex = i;
    m = WORD.exec(s);
    if (m) {
      const tok = WORDS.get(plainWord(m[0]));
      if (!tok) return null;
      if (tok === "skip") {
        if (toks[toks.length - 1]?.k !== "sqrt") return null;
      } else toks.push(tok);
      i += m[0].length;
      continue;
    }
    return null;
  }
  return toks;
}

/** Une valeur en cours de calcul ; `pct` : écrite avec % (« 18 % »). */
interface Val {
  v: number;
  pct: boolean;
}

/** Ce que l'analyseur a compris. */
export interface Evaluation {
  value: number;
  /** Le tout est un pourcentage (« 15 % »). */
  pct: boolean;
  /** Nombre d'opérations : 0 = un nombre seul, pas un calcul. */
  ops: number;
  /** Un nombre écrit en hexadécimal, binaire ou octal. */
  exotic: boolean;
}

class ParseError extends Error {}

/**
 * Descente récursive, du moins prioritaire au plus prioritaire :
 *   expr  = term (('+' | '-') term)*        240 + 18 % = 240 × 1,18
 *   term  = unary (('*' | '/') unary | 'de' term)*  18 % de 240
 *   unary = '-' unary | power               -2 ^ 2 = -(2 ^ 2)
 *   power = post ('^' unary)?               2 ^ 3 ^ 2 = 2 ^ 9
 *   post  = prim '%'*
 *   prim  = nombre | pi | '(' expr ')' | racine post
 */
class Parser {
  private i = 0;
  private depth = 0;
  ops = 0;
  exotic = false;

  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.k === "op" && t.v === v;
  }

  parse(): Val {
    const v = this.expr();
    if (this.i !== this.toks.length) throw new ParseError();
    return v;
  }

  private expr(): Val {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const plus = this.isOp("+");
      this.i++;
      this.ops++;
      const right = this.term();
      // « 240 + 18 % » : 18 % de 240 en plus.
      const r = right.pct ? left.v * right.v : right.v;
      left = { v: plus ? left.v + r : left.v - r, pct: false };
    }
    return left;
  }

  private term(): Val {
    let left = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const times = this.isOp("*");
        this.i++;
        this.ops++;
        const right = this.unary();
        left = { v: times ? left.v * right.v : left.v / right.v, pct: false };
      } else if (this.peek()?.k === "of") {
        // « de » seulement après un pourcentage : « 18 % de 240 ». La suite
        // est lue en entier : « 50 % de 50 % de 80 » = 50 % de (50 % de 80).
        if (!left.pct) throw new ParseError();
        this.i++;
        this.ops++;
        const right = this.term();
        left = { v: left.v * right.v, pct: false };
      } else return left;
    }
  }

  private unary(): Val {
    if (this.isOp("-")) {
      this.i++;
      const x = this.unary();
      return { v: -x.v, pct: x.pct };
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Val {
    const base = this.post();
    if (!this.isOp("^")) return base;
    this.i++;
    this.ops++;
    const exp = this.unary();
    return { v: base.v ** exp.v, pct: false };
  }

  private post(): Val {
    let x = this.prim();
    while (this.peek()?.k === "%") {
      this.i++;
      this.ops++;
      x = { v: x.v / 100, pct: true };
    }
    return x;
  }

  private prim(): Val {
    const t = this.peek();
    if (!t) throw new ParseError();
    this.i++;
    switch (t.k) {
      case "num":
        if (t.exotic) this.exotic = true;
        return { v: t.v, pct: false };
      case "pi":
        return { v: Math.PI, pct: false };
      case "sqrt": {
        this.ops++;
        if (this.peek()?.k === "of") this.i++; // « racine de 16 »
        const x = this.post();
        return { v: Math.sqrt(x.v), pct: false };
      }
      case "(": {
        if (++this.depth > MAX_DEPTH) throw new ParseError();
        const v = this.expr();
        if (this.peek()?.k !== ")") throw new ParseError();
        this.i++;
        this.depth--;
        return v;
      }
      default:
        throw new ParseError();
    }
  }
}

/** Calcule une expression. null : ce n'est pas une expression comprise. */
export function evaluate(text: string, lang: CalcLang = "fr"): Evaluation | null {
  const toks = tokenize(text, lang);
  if (!toks?.length) return null;
  try {
    const p = new Parser(toks);
    const v = p.parse();
    if (!Number.isFinite(v.v)) return null; // division par zéro, 10 ^ 1000…
    return { value: v.v, pct: v.pct, ops: p.ops, exotic: p.exotic };
  } catch (err) {
    if (err instanceof ParseError) return null;
    throw err;
  }
}

// ── Unités ────────────────────────────────────────────────────────────────────

type Dim = "data" | "rate" | "time" | "length" | "mass" | "speed" | "temp";

interface Unit {
  dim: Dim;
  /** Combien d'unités de base (octet, octet/s, seconde, mètre, kilo, m/s) dans une unité. */
  f: number;
  /** Températures : pas un simple facteur. */
  temp?: "c" | "f" | "k";
  /** Le symbole à afficher quand on a tapé une abréviation (« c » → « °C »). */
  sym?: string;
}

// [noms acceptés (sans accents, en minuscules), unité]
const UNIT_TABLE: [string[], Unit][] = [
  // Durées (base : seconde)
  [["ms", "milliseconde", "millisecondes", "millisecond", "milliseconds"], { dim: "time", f: 0.001 }],
  [["s", "sec", "secs", "seconde", "secondes", "second", "seconds"], { dim: "time", f: 1 }],
  [["min", "mins", "mn", "minute", "minutes"], { dim: "time", f: 60 }],
  [["h", "hr", "hrs", "heure", "heures", "hour", "hours"], { dim: "time", f: 3600 }],
  [["j", "jour", "jours", "d", "day", "days"], { dim: "time", f: 86400 }],
  [["sem", "semaine", "semaines", "week", "weeks", "wk"], { dim: "time", f: 604800 }],
  // Longueurs (base : mètre)
  [["mm", "millimetre", "millimetres", "millimeter", "millimeters"], { dim: "length", f: 0.001 }],
  [["cm", "centimetre", "centimetres", "centimeter", "centimeters"], { dim: "length", f: 0.01 }],
  [["m", "metre", "metres", "meter", "meters"], { dim: "length", f: 1 }],
  [["km", "kilometre", "kilometres", "kilometer", "kilometers"], { dim: "length", f: 1000 }],
  [["in", "inch", "inches", "pouce", "pouces"], { dim: "length", f: 0.0254 }],
  [["ft", "foot", "feet", "pied", "pieds"], { dim: "length", f: 0.3048 }],
  [["yd", "yard", "yards"], { dim: "length", f: 0.9144 }],
  [["mi", "mile", "miles"], { dim: "length", f: 1609.344 }],
  // Masses (base : kilogramme)
  [["mg", "milligramme", "milligrammes", "milligram", "milligrams"], { dim: "mass", f: 1e-6 }],
  [["g", "gramme", "grammes", "gram", "grams"], { dim: "mass", f: 0.001 }],
  [["kg", "kilo", "kilos", "kilogramme", "kilogrammes", "kilogram", "kilograms"], { dim: "mass", f: 1 }],
  [["t", "tonne", "tonnes"], { dim: "mass", f: 1000 }],
  [["lb", "lbs", "livre", "livres", "pound", "pounds"], { dim: "mass", f: 0.45359237 }],
  [["oz", "once", "onces", "ounce", "ounces"], { dim: "mass", f: 0.028349523125 }],
  // Vitesses (base : mètre par seconde)
  [["m/s"], { dim: "speed", f: 1 }],
  [["km/h", "kmh", "kph"], { dim: "speed", f: 1 / 3.6 }],
  [["mph"], { dim: "speed", f: 0.44704 }],
  [["noeud", "noeuds", "kn", "kt", "knot", "knots"], { dim: "speed", f: 1852 / 3600 }],
  // Températures
  [["°c", "c", "℃", "celsius", "degre celsius", "degres celsius"], { dim: "temp", f: 1, temp: "c", sym: "°C" }],
  [["°f", "f", "℉", "fahrenheit", "degre fahrenheit", "degres fahrenheit"], { dim: "temp", f: 1, temp: "f", sym: "°F" }],
  [["k", "kelvin", "kelvins"], { dim: "temp", f: 1, temp: "k", sym: "K" }],
];

const UNITS = new Map<string, Unit>();
for (const [names, unit] of UNIT_TABLE) for (const n of names) UNITS.set(n, unit);

/** « Kilomètres » → « kilometres », « nœuds » → « noeuds », « Mbit / s » → « mbit/s ». */
function unitKey(text: string): string {
  return plainWord(text).replace(/œ/g, "oe").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

const PREFIX_POWER: Record<string, number> = { "": 0, k: 1, m: 2, g: 3, t: 4, p: 5 };
const WORD_PREFIX: Record<string, number> = { kilo: 1e3, mega: 1e6, giga: 1e9, tera: 1e12, peta: 1e15, kibi: 2 ** 10, mebi: 2 ** 20, gibi: 2 ** 30, tebi: 2 ** 40, pebi: 2 ** 50 };

/**
 * Une quantité de données, en octets par unité (null : pas une unité de données).
 *   o, Ko, Mo, Go, To, Po = puissances de 1000 ; Kio, Mio, Gio, Tio = 1024.
 *   B = octet, b = bit (B / b : la casse compte) : KB, MB, MiB… / Kb, Mb, Mbit…
 *   En toutes lettres : « octets », « mégaoctets », « gigabits », « kibibytes ».
 */
function dataFactor(text: string): number | null {
  const s = text.trim();
  const word = /^(kilo|mega|giga|tera|peta|kibi|mebi|gibi|tebi|pebi)?(octets?|bytes?|bits?)$/.exec(plainWord(s).replace(/[\s-]/g, ""));
  if (word) return (word[1] ? WORD_PREFIX[word[1]] : 1) * (word[2].startsWith("bit") ? 1 / 8 : 1);
  const m = /^([kmgtp]?)(i?)(o|b|bits?)$/i.exec(s);
  if (!m) return null;
  const [, prefix, binary, suffix] = m;
  if (binary && !prefix) return null;
  const power = PREFIX_POWER[prefix.toLowerCase()];
  const mult = (binary ? 1024 : 1000) ** power;
  // « b » minuscule ou « bit » : des bits ; « B » majuscule ou « o » : des octets.
  const bits = suffix === "b" || /^bits?$/i.test(suffix);
  return mult * (bits ? 1 / 8 : 1);
}

/** L'unité tapée, ou null. */
function findUnit(text: string): Unit | null {
  const raw = text.trim().replace(/\s*\/\s*/g, "/").replace(/[º˚]/g, "°").replace(/°\s+/g, "°");
  if (!raw) return null;
  const known = UNITS.get(unitKey(raw));
  if (known) return known;
  // Débits : « Mo/s », « Mbit/s », « Mbps », « MB/sec ».
  const rate = /^(.+?)(?:\/s|\/sec|ps)$/.exec(raw);
  if (rate) {
    const f = dataFactor(rate[1]);
    if (f !== null) return { dim: "rate", f };
  }
  const f = dataFactor(raw);
  return f === null ? null : { dim: "data", f };
}

/** Comment écrire l'unité dans la réponse : telle qu'on l'a tapée, sauf « c » → « °C ». */
function unitLabel(text: string, unit: Unit): string {
  const t = text.trim().replace(/\s*\/\s*/g, "/");
  return unit.sym && t.replace(/[°º˚\s]/g, "").length <= 1 ? unit.sym : t;
}

/** Une quantité tapée : « 100 Mbit/s », « 1,5 Go », « -40 °C ». */
interface Quantity {
  value: number;
  unit: Unit;
  label: string;
}

function parseQuantity(text: string, lang: CalcLang): Quantity | null {
  // Le nombre (ou le calcul) va jusqu'au dernier chiffre, l'unité est le reste.
  const m = /^(.*[\d)])\s*([^\d()]+)$/.exec(text.trim());
  if (!m) return null;
  const unit = findUnit(m[2]);
  if (!unit) return null;
  const ev = evaluate(m[1], lang);
  if (!ev || ev.pct) return null;
  return { value: ev.value, unit, label: unitLabel(m[2], unit) };
}

function toKelvin(v: number, t: "c" | "f" | "k"): number {
  return t === "k" ? v : t === "c" ? v + 273.15 : ((v - 32) * 5) / 9 + 273.15;
}

function fromKelvin(k: number, t: "c" | "f" | "k"): number {
  return t === "k" ? k : t === "c" ? k - 273.15 : ((k - 273.15) * 9) / 5 + 32;
}

/** Convertit d'une unité à l'autre (même famille). null : familles différentes. */
function convert(v: number, from: Unit, to: Unit): number | null {
  if (from.dim !== to.dim) return null;
  if (from.dim === "temp") return fromKelvin(toKelvin(v, from.temp!), to.temp!);
  return (v * from.f) / to.f;
}

// ── Les différentes sortes de calcul ──────────────────────────────────────────

/** « en », « in », « to », « vers », « -> », « → » : le DERNIER (« 1 in in cm »). */
const SEPARATOR = /\s+(?:en|in|to|vers)(?=\s)|\s*(?:->|=>|→)/gi;

function splitLast(q: string, sep: RegExp): [string, string] | null {
  let last: RegExpExecArray | null = null;
  for (const m of q.matchAll(sep)) last = m;
  if (!last) return null;
  const left = q.slice(0, last.index).trim();
  const right = q.slice(last.index! + last[0].length).trim();
  return left && right ? [left, right] : null;
}

const BASES: Record<string, 2 | 8 | 10 | 16> = {
  hex: 16,
  hexa: 16,
  hexadecimal: 16,
  "base 16": 16,
  bin: 2,
  binaire: 2,
  binary: 2,
  "base 2": 2,
  oct: 8,
  octal: 8,
  "base 8": 8,
  dec: 10,
  decimal: 10,
  decimale: 10,
  "base 10": 10,
};

/** Les autres écritures d'un entier : « déc 255 · hex 0xFF · bin 0b1111 1111 ». */
function baseDetail(n: number, lang: CalcLang, except: number): string {
  const parts: string[] = [];
  if (except !== 10) parts.push(`${TEXT[lang].dec} ${formatNumber(n, lang)}`);
  if (except !== 16) parts.push(`hex ${inBase(n, 16)}`);
  if (except !== 2) parts.push(`bin ${groupBinary(inBase(n, 2))}`);
  return parts.join(" · ");
}

/** « 255 en hex », « 0xFF en décimal », « 42 en binaire ». */
function baseConversion(left: string, right: string, lang: CalcLang): CalcAnswer[] | null {
  const key = plainWord(right).replace(/\s+/g, " ");
  const base = Object.hasOwn(BASES, key) ? BASES[key] : null;
  if (!base) return null;
  const ev = evaluate(left, lang);
  if (!ev || ev.pct || !Number.isSafeInteger(ev.value)) return null;
  const n = ev.value;
  if (base === 10) {
    return [{ kind: "base", title: formatNumber(n, lang), detail: baseDetail(n, lang, 10), copy: String(n) }];
  }
  const text = inBase(n, base);
  return [{ kind: "base", title: base === 2 ? groupBinary(text) : text, detail: baseDetail(n, lang, base), copy: text }];
}

/** « 1 Go en Mio », « 100 Mbit/s en Mo/s », « 20 °C en °F ». */
function unitConversion(left: string, right: string, lang: CalcLang): CalcAnswer[] | null {
  const from = parseQuantity(left, lang);
  const to = findUnit(right);
  if (!from || !to) return null;
  const v = convert(from.value, from.unit, to);
  if (v === null || !Number.isFinite(v)) return null;
  // Arrondi : 2 décimales pour une température, 6 chiffres pour le reste (953,674 Mio).
  const round = to.dim === "temp" ? { decimals: 2 } : { significant: 6 };
  const label = unitLabel(right, to);
  const shown = `${formatNumber(v, lang, round)} ${label}`;
  return [
    {
      kind: to.dim === "temp" ? "temp" : "convert",
      title: shown,
      detail: `${formatNumber(from.value, lang)} ${from.label} = ${shown}`,
      copy: `${formatNumber(v, lang, { ...round, group: false })} ${label}`,
    },
  ];
}

/** « 1 Go à 100 Mbit/s » : la durée du transfert. */
function transferTime(q: string, lang: CalcLang): CalcAnswer[] | null {
  const parts = splitLast(q, /\s*@|\s+(?:à|a|at)(?=\s)/gi);
  if (!parts) return null;
  const size = parseQuantity(parts[0], lang);
  const rate = parseQuantity(parts[1], lang);
  if (!size || !rate || size.unit.dim !== "data" || rate.unit.dim !== "rate") return null;
  if (rate.value <= 0 || size.value < 0) return null;
  const text = formatDuration((size.value * size.unit.f) / (rate.value * rate.unit.f), lang);
  if (!text) return null;
  const t = TEXT[lang];
  const what = `${formatNumber(size.value, lang)} ${size.label} ${t.rateAt} ${formatNumber(rate.value, lang)} ${rate.label}`;
  return [{ kind: "duration", title: text, detail: `${what} · ${t.transfer}`, copy: text }];
}

/** Une adresse IPv4 → un nombre de 32 bits, ou null. */
function parseIp(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

function ipText(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Le masque d'un préfixe : /26 → 255.255.255.192. */
function prefixMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Le préfixe d'un masque (255.255.255.0 → 24), null s'il n'est pas d'un seul tenant. */
function maskPrefix(mask: number): number | null {
  const inv = ~mask >>> 0;
  if ((inv & (inv + 1)) !== 0) return null; // des 1 après des 0 : pas un masque
  let bits = 0;
  for (let x = inv; x; x >>>= 1) bits++;
  return 32 - bits;
}

/** À quoi sert cette plage d'adresses (privée, APIPA…). */
function rangeOf(ip: number, lang: CalcLang): string {
  const r = TEXT[lang].ranges;
  const inside = (net: string, prefix: number) => (ip & prefixMask(prefix)) >>> 0 === parseIp(net);
  if (inside("10.0.0.0", 8) || inside("172.16.0.0", 12) || inside("192.168.0.0", 16)) return r.private;
  if (inside("100.64.0.0", 10)) return r.shared;
  if (inside("127.0.0.0", 8)) return r.loopback;
  if (inside("169.254.0.0", 16)) return r.linkLocal;
  if (inside("224.0.0.0", 4)) return r.multicast;
  if (inside("240.0.0.0", 4)) return r.reserved;
  if (inside("0.0.0.0", 8)) return r.thisNet;
  return r.public;
}

const IP = String.raw`(\d{1,3}(?:\.\d{1,3}){3})`;
const SUBNET = new RegExp(String.raw`^${IP}\s*(?:\/\s*(\d{1,2})|\/\s*${IP}|\s+(?:(?:masque|mask|netmask)\s+)?${IP})$`, "i");

/** « 192.168.1.0/26 », « 192.168.1.10 255.255.255.0 » : tout sur le sous-réseau. */
function subnet(q: string, lang: CalcLang): CalcAnswer[] | null {
  const m = SUBNET.exec(q);
  if (!m) return null;
  const ip = parseIp(m[1]);
  if (ip === null) return null;
  let prefix: number | null;
  if (m[2] !== undefined) {
    prefix = Number(m[2]);
    if (prefix > 32) return null;
  } else {
    const mask = parseIp(m[3] ?? m[4]);
    prefix = mask === null ? null : maskPrefix(mask);
  }
  if (prefix === null) return null;
  const mask = prefixMask(prefix);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  // /31 : deux adresses, toutes deux utilisables (liaison point à point) ; /32 : une seule.
  const hosts = prefix === 32 ? 1 : prefix === 31 ? 2 : 2 ** (32 - prefix) - 2;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const t = TEXT[lang];
  const cidr = `${ipText(network)}/${prefix}`;
  const hostsText = t.hosts(formatNumber(hosts, lang), hosts > 1);
  const summary = [
    `${t.network} : ${cidr}`,
    `${t.mask} : ${ipText(mask)}`,
    `${t.first} : ${ipText(first)}`,
    `${t.last} : ${ipText(last)}`,
    `${t.broadcast} : ${ipText(broadcast)}`,
    `${t.hostsLabel} : ${formatNumber(hosts, lang, { group: false })}`,
  ]
    .map((line) => (lang === "en" ? line.replace(" : ", ": ") : line))
    .join("\n");
  const colon = lang === "en" ? ":" : " :";
  const line = (label: string, value: string, detail = t.copyHint): CalcAnswer => ({ kind: "subnet", title: `${label}${colon} ${value}`, detail, copy: value });
  return [
    { kind: "subnet", title: `${cidr} · ${hostsText}`, detail: `${ipText(mask)} · ${ipText(first)} → ${ipText(last)} · ${rangeOf(network, lang)}`, copy: summary },
    line(t.mask, ipText(mask), `/${prefix} · ${t.wildcard} ${ipText(~mask >>> 0)}`),
    line(t.network, ipText(network)),
    line(t.first, ipText(first)),
    line(t.last, ipText(last)),
    line(t.broadcast, ipText(broadcast)),
  ];
}

/** « à Montréal », mais « au Caire », « au Cap » ; en anglais « in Tokyo ». */
function atCity(name: string, lang: CalcLang): string {
  if (lang === "en") return `in ${name}`;
  if (name.startsWith("Le ")) return `au ${name.slice(3)}`;
  if (name.startsWith("Les ")) return `aux ${name.slice(4)}`;
  return `à ${name}`;
}

/** Une ville après « à », « in »… (sans le mot lui-même). */
function cityAfter(text: string): City | null {
  const t = text.trim().replace(/\s*\?$/, "");
  return findCity(t) ?? findCity(t.replace(/^(?:à|a|au|aux|en|de|du|in|at)\s+/i, ""));
}

/** « heure à Tokyo », « 15 h Montréal », « 15h30 à Tokyo », « 3 pm Tokyo ». */
function timeQuery(q: string, lang: CalcLang, now: Date, here?: string): CalcAnswer[] | null {
  const t = TEXT[lang];
  const zone = here || localZone();
  // L'heure qu'il est là-bas.
  const asked = /^(?:quelle\s+)?heure\s+(?:est[\s-]il\s+)?(.+)$/i.exec(q) ?? /^(?:what\s+)?time\s+(?:is\s+it\s+)?(.+)$/i.exec(q);
  if (asked) {
    const city = cityAfter(asked[1]);
    if (!city) return null;
    const k = cityClock(city, now, lang, zone);
    const day = dayWord(k.dayDiff, lang);
    const title = `${clockText(k.hour, k.minute, lang)} ${atCity(k.name, lang)}${day ? ` (${day})` : ""}`;
    const offset = offsetText(k.offset, lang);
    return [{ kind: "time", title, detail: `${k.date} · ${k.offset ? `${offset} ${t.vsHere}` : offset}`, copy: title }];
  }
  // Une heure là-bas → l'heure ici.
  const m = /^(\d{1,2})\s*(?:(?:h|:)\s*(\d{2})?\s*(am|pm)?|(am|pm))\s+(.+)$/i.exec(q);
  if (!m) return null;
  const city = cityAfter(m[5]);
  if (!city) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = (m[3] ?? m[4])?.toLowerCase();
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const r = fromCityTime(city, hour, minute, now, zone);
  const name = cityName(city, lang);
  const there = `${clockText(hour, minute, lang)} ${atCity(name, lang)}`;
  const local = clockText(r.hour, r.minute, lang);
  const day = r.dayDiff > 0 ? `, ${t.nextDay}` : r.dayDiff < 0 ? `, ${t.prevDay}` : "";
  // Ce qu'on colle dans un message : « ici » devient le nom de la ville du PC.
  const home = localCity(zone);
  const copy = `${there} = ${local} ${home ? atCity(cityName(home, lang), lang) : t.here}${day}`;
  const offset = offsetText(r.offset, lang);
  const colon = lang === "en" ? ":" : " :";
  return [{ kind: "time", title: `${there} = ${local} ${t.here}${day}`, detail: `${name}${colon} ${r.offset ? `${offset} ${t.vsHere}` : offset}`, copy }];
}

/** « 1/1/2026 », « 2026-10-07 », « 10/2026 » : des dates, pas des divisions. */
const DATE_LIKE = [/^\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/, /^\d{1,2}\/\d{4}$/, /^\d+(?:-\d+){2,}$/];

/** Un calcul : « 2 + 3 », « 18 % de 240 », « 0x1F ». */
function arithmetic(q: string, lang: CalcLang): CalcAnswer[] | null {
  if (DATE_LIKE.some((rx) => rx.test(q))) return null;
  const ev = evaluate(q, lang);
  // Un nombre seul (« 2024 », « -5 ») n'est pas un calcul ; « 0x1F » si.
  if (!ev || (ev.ops === 0 && !ev.exotic)) return null;
  const n = ev.value;
  const detail = ev.exotic && Number.isSafeInteger(n) ? baseDetail(n, lang, 10) : TEXT[lang].copyHint;
  return [{ kind: ev.exotic ? "base" : "math", title: formatNumber(n, lang), detail, copy: formatNumber(n, lang, { group: false }) }];
}

/**
 * Ce que le Lanceur montre pour la recherche `query` : [] si ce n'est pas un
 * calcul. `now` et `here` (fuseau d'ici) servent aux tests.
 */
export function calculate(query: string, lang: CalcLang = "fr", now: Date = new Date(), here?: string): CalcAnswer[] {
  const q = query.trim().replace(/\s*=\s*$/, ""); // « 2 + 2 = »
  if (!q || q.length > MAX_QUERY) return [];
  // Presque tout calcul a un chiffre ; sinon, seulement « heure à Tokyo ».
  if (!/\d/.test(q) && !/^(?:quelle\s+)?heure\s|^(?:what\s+)?time\s/i.test(q)) return [];
  try {
    const conv = splitLast(q, SEPARATOR);
    return (
      subnet(q, lang) ??
      timeQuery(q, lang, now, here) ??
      (conv && (baseConversion(conv[0], conv[1], lang) ?? unitConversion(conv[0], conv[1], lang))) ??
      transferTime(q, lang) ??
      arithmetic(q, lang) ??
      []
    );
  } catch {
    // Une erreur inattendue ne doit pas casser la recherche : pas de calcul, c'est tout.
    return [];
  }
}

/** Un GUID neuf (« 3f2b8c1e-… », version 4, tiré au hasard par le système). */
export function newGuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  // Repli (page sans « contexte sûr ») : les mêmes 16 octets au hasard, version 4.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
