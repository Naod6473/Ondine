// Décodeur du presse-papiers : reconnaître et lire les textes que les
// informaticiens copient tous les jours.
//
//   - un jeton JWT (« eyJhbGci… ») : en-tête et contenu en JSON lisible, dates
//     exp / iat / nbf en clair. La signature n'est PAS vérifiée (il faudrait la
//     clé secrète) : on le dit toujours ;
//   - du Base64 : proposé seulement si le résultat est du texte UTF-8 lisible
//     (une image ou un fichier encodé ne propose rien) ;
//   - une adresse encodée (%20, %C3%A9…), avec ses paramètres un par un ;
//   - du JSON compact (sur une ligne) : remis en forme, avec des retraits.
//     Les nombres et les textes sont recopiés tels quels (un grand identifiant
//     comme 12345678901234567890 ne perd pas ses derniers chiffres) ;
//   - un horodatage Unix (10 chiffres = secondes, 13 = millisecondes), si la
//     date tombe entre 2000 et 2050.
//
// TypeScript pur : ni page, ni Tauri. Testé dans tests/front/clipboard-decode.test.ts.
// Tout se fait dans l'île : rien n'est envoyé, rien n'est écrit dans le
// journal (les messages d'erreur ne contiennent jamais le texte copié).

export type DecodeKind = "jwt" | "base64" | "url" | "json" | "timestamp";

/** Le bouton proposé sur la ligne de la copie, selon ce qu'on a reconnu. */
export const DECODE_ACTIONS: Record<DecodeKind, { label: string; title: string }> = {
  jwt: { label: "Décoder", title: "Décoder ce jeton JWT : en-tête, contenu et dates (la signature n'est pas vérifiée)" },
  base64: { label: "Décoder", title: "Décoder ce texte en Base64" },
  url: { label: "Décoder", title: "Décoder les caractères %xx de ce texte" },
  json: { label: "Mettre en forme", title: "Mettre en forme ce JSON (une valeur par ligne, avec des retraits)" },
  timestamp: { label: "Lire la date", title: "Lire la date de cet horodatage Unix" },
};

/** Un bloc de texte du résultat (affiché en police à chasse fixe, avec « Copier »). */
export interface DecodedBlock {
  label: string;
  text: string;
}

/** Une ligne « étiquette : valeur » (une date, l'algorithme d'un jeton…). */
export interface DecodedFact {
  label: string;
  value: string;
  /** « il y a 3 h », « dans 2 j »… */
  note?: string;
  /** « expiré » (rouge), « encore valide » (vert)… */
  status?: { text: string; tone: "good" | "bad" };
}

export interface Decoded {
  kind: DecodeKind;
  title: string;
  /** Une phrase à montrer en tête (la signature d'un JWT n'est pas vérifiée). */
  warning?: string;
  facts: DecodedFact[];
  blocks: DecodedBlock[];
}

/** Le texte ne se décode pas. Le message ne contient jamais le texte lui-même. */
export class DecodeError extends Error {}

export const JWT_WARNING = "Signature non vérifiée : ce décodage ne prouve pas que le jeton est authentique ni qu'il n'a pas été modifié.";

// ── Reconnaître ──────────────────────────────────────────────────────────────

/**
 * Ce que le texte a l'air d'être, ou null (le cas le plus fréquent : on ne
 * propose rien). `truncated` : on n'a que le début du texte (l'aperçu de 300
 * caractères d'une longue copie) ; la reconnaissance est alors plus prudente,
 * et le vrai décodage se fait sur le texte entier.
 */
export function detect(text: string, truncated = false): DecodeKind | null {
  const s = text.trim();
  if (s.length < 4) return null;
  if (!truncated && timestampMs(s) !== null) return "timestamp";
  if (looksLikeJwt(s, truncated)) return "jwt";
  if (looksLikeJson(s, truncated)) return "json";
  if (looksLikeUrlEncoded(s, truncated)) return "url";
  if (looksLikeBase64(s, truncated)) return "base64";
  return null;
}

// Les dates « plausibles » d'un horodatage seul : de 2000 à 2050.
const MIN_DATE = Date.UTC(2000, 0, 1);
const MAX_DATE = Date.UTC(2050, 0, 1);

/** 10 chiffres (secondes) ou 13 (millisecondes) d'une date plausible → millisecondes. */
export function timestampMs(s: string): number | null {
  let ms: number;
  if (/^\d{10}$/.test(s)) ms = Number(s) * 1000;
  else if (/^\d{13}$/.test(s)) ms = Number(s);
  else return null;
  return ms >= MIN_DATE && ms < MAX_DATE ? ms : null;
}

/** « Bearer eyJ… » (copié d'un en-tête HTTP) → « eyJ… ». */
function withoutBearer(s: string): string {
  return s.replace(/^bearer\s+/i, "");
}

function looksLikeJwt(s: string, truncated: boolean): boolean {
  const token = withoutBearer(s);
  if (truncated) {
    // Il faut au moins l'en-tête entier (« xxx. ») pour juger.
    const m = /^([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)?$/.exec(token);
    return !!m && jwtHeader(m[1]) !== null;
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]*$/.test(p))) return false;
  return jwtHeader(parts[0]) !== null && jsonSegment(parts[1]) !== null;
}

/** L'en-tête d'un JWT : un objet JSON avec « alg ». */
function jwtHeader(segment: string): { text: string; value: Record<string, unknown> } | null {
  const h = jsonSegment(segment);
  return h && typeof h.value.alg === "string" ? h : null;
}

/** Un morceau de jeton (Base64 « URL ») qui contient un objet JSON. */
function jsonSegment(segment: string): { text: string; value: Record<string, unknown> } | null {
  const bytes = base64Bytes(segment);
  const text = bytes && utf8(bytes);
  if (!text) return null;
  const value = parseJson(text);
  return value && typeof value === "object" && !Array.isArray(value) ? { text, value: value as Record<string, unknown> } : null;
}

function looksLikeJson(s: string, truncated: boolean): boolean {
  if (!/^[[{]/.test(s)) return false;
  if (truncated) {
    // Le début d'un JSON compact : « {" » ou « [{ », sur une seule ligne, et
    // des crochets qui se suivent bien jusqu'ici.
    return /^(?:\{\s*"|\[\s*[[{"\d-])/.test(s) && !s.includes("\n") && jsonPrefixOk(s);
  }
  if (s.length < 8 || !/[}\]]$/.test(s)) return false;
  const value = parseJson(s);
  if (value === undefined || value === null || typeof value !== "object") return false;
  // Déjà en forme : rien à proposer.
  return prettyJson(s) !== s;
}

/** Les crochets et accolades du début d'un JSON se répondent-ils (hors textes) ? */
function jsonPrefixOk(s: string): boolean {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const c of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return false;
      if (!stack.length) return false; // fini avant la coupure : ce n'était pas le début d'un long JSON
    }
  }
  return stack.length > 0;
}

const PERCENT = /%[0-9A-Fa-f]{2}/;

function looksLikeUrlEncoded(s: string, truncated: boolean): boolean {
  if (/\s/.test(s) || !PERCENT.test(s)) return false;
  // Un texte coupé peut finir au milieu d'un « %C3%A9 » : on retire la fin abîmée.
  const candidates = truncated ? [s, s.replace(/%[0-9A-Fa-f]?$/, ""), s.replace(/(?:%[0-9A-Fa-f]{2}){1,3}%?[0-9A-Fa-f]?$/, "")] : [s];
  for (const c of candidates) {
    const decoded = tryDecodeUri(c);
    if (decoded !== null && decoded !== c && readable(decoded)) return true;
  }
  return false;
}

function tryDecodeUri(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function looksLikeBase64(s: string, truncated: boolean): boolean {
  // Du Base64 n'a pas d'espace ; seuls les retours à la ligne (tous les 76
  // caractères dans un courriel) sont tolérés.
  if (/[^\S\r\n]/.test(s)) return false;
  const compact = s.replace(/[\r\n]+/g, "");
  if (compact.length < 8) return false;
  const standard = /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  const urlSafe = /^[A-Za-z0-9_-]+={0,2}$/.test(compact);
  if (!standard && !urlSafe) return false;
  // Pas une empreinte (hexadécimal), un nombre ni un identifiant (UUID).
  if (/^[0-9a-fA-F]+$/.test(compact)) return false;
  // Un mot ordinaire (« Bonjour », « Organisation ») n'est pas du Base64 :
  // il faut un chiffre, un signe propre au Base64, ou des majuscules et des
  // minuscules mélangées.
  const body = compact.replace(/=+$/, "");
  const hasDigitOrSign = /[0-9+/_=-]/.test(compact);
  const mixedCase = /[a-z]/.test(body) && /[A-Z]/.test(body.slice(1));
  if (!hasDigitOrSign && !mixedCase) return false;
  if (truncated) {
    const head = body.slice(0, body.length - (body.length % 4));
    const bytes = base64Bytes(head);
    const text = bytes && utf8(bytes, true);
    return !!text && text.length >= 4 && readable(text);
  }
  const bytes = base64Bytes(compact);
  const text = bytes && utf8(bytes);
  return !!text && text.trim().length >= 2 && readable(text);
}

// ── Petits outils (exportés pour les tests) ──────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 → octets, sans rien deviner : alphabet standard (+ /) ou « URL »
 * (- _), avec ou sans « = » à la fin, retours à la ligne ignorés. null si ce
 * n'est pas du Base64 valide.
 */
export function base64Bytes(input: string): Uint8Array | null {
  let s = input.replace(/[\r\n]+/g, "");
  const pad = /=*$/.exec(s)![0].length;
  if (pad > 2) return null;
  if (pad && s.length % 4 !== 0) return null;
  s = s.slice(0, s.length - pad);
  if (/[+/]/.test(s) && /[-_]/.test(s)) return null; // deux alphabets mélangés
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const c of s) {
    // (On ne garde que les derniers bits : le reste a déjà été rendu.)
    value = ((value << 6) | B64.indexOf(c)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  // Les bits qui restent (moins d'un octet) doivent valoir zéro.
  if (value & ((1 << bits) - 1)) return null;
  return out.subarray(0, o);
}

/**
 * Octets → texte UTF-8, ou null s'ils ne forment pas de l'UTF-8 valide.
 * `partial` : les octets peuvent s'arrêter au milieu d'un caractère (début
 * d'un texte coupé) ; cette fin-là est ignorée.
 */
export function utf8(bytes: Uint8Array, partial = false): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: partial });
  } catch {
    return null;
  }
}

/**
 * Du texte qu'une personne peut lire : aucun caractère de contrôle (sauf
 * tabulation et retours à la ligne), aucun caractère inconnu, et au moins une
 * lettre ou un chiffre.
 */
export function readable(text: string): boolean {
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  return !/[\p{Cc}\p{Cn}\p{Co}\p{Cs}�]/u.test(text.replace(/[\t\r\n]/g, ""));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Remet en forme un JSON valide : une valeur par ligne, deux espaces de
 * retrait. On ne passe PAS par JSON.parse puis JSON.stringify : les nombres
 * et les textes sont recopiés caractère pour caractère (un identifiant de 20
 * chiffres ou « é » restent tels quels).
 */
export function prettyJson(json: string): string {
  const s = json.trim();
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => "\n" + "  ".repeat(depth);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      // Un objet ou une liste vide reste sur une ligne : {} ou [].
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === (c === "{" ? "}" : "]")) {
        out += c + s[j];
        i = j;
      } else {
        depth++;
        out += c + newline();
      }
    } else if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
      out += newline() + c;
    } else if (c === ",") {
      out += "," + newline();
    } else if (c === ":") {
      out += ": ";
    } else if (!/\s/.test(c)) {
      out += c;
    }
  }
  return out;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Une date en clair : heure locale (avec son décalage), UTC, et ISO 8601. */
export function formatDate(ms: number): { local: string; utc: string; iso: string } {
  const d = new Date(ms);
  const frac = ms % 1000 ? `.${pad(d.getUTCMilliseconds(), 3)}` : "";
  const off = -d.getTimezoneOffset();
  const offset = `UTC${off < 0 ? "−" : "+"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${frac} (${offset})`;
  const utc = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${frac} UTC`;
  return { local, utc, iso: d.toISOString() };
}

/** « il y a 3 h », « dans 2 j », « à l'instant »… */
export function relative(ms: number, now: number): string {
  const s = Math.round(Math.abs(ms - now) / 1000);
  if (s < 5) return "à l'instant";
  let n: number;
  let unit: string;
  if (s < 60) [n, unit] = [s, "s"];
  else if (s < 3600) [n, unit] = [Math.floor(s / 60), "min"];
  else if (s < 48 * 3600) [n, unit] = [Math.floor(s / 3600), "h"];
  else if (s < 730 * 86400) [n, unit] = [Math.floor(s / 86400), "j"];
  else [n, unit] = [Math.round(s / (365.25 * 86400)), "ans"];
  return ms < now ? `il y a ${n} ${unit}` : `dans ${n} ${unit}`;
}

// ── Décoder ──────────────────────────────────────────────────────────────────

/**
 * Décode le texte ENTIER comme `kind` (choisi par detect). Lance une
 * DecodeError si ça ne marche pas (un long texte dont le début semblait bon).
 */
export function decode(text: string, kind: DecodeKind, now = Date.now()): Decoded {
  const s = text.trim();
  switch (kind) {
    case "jwt":
      return decodeJwt(s, now);
    case "base64":
      return decodeBase64(s);
    case "url":
      return decodeUrl(s);
    case "json":
      return decodeJson(s);
    case "timestamp":
      return decodeTimestamp(s, now);
  }
}

/** Les dates d'un jeton, dans l'ordre où on les montre. */
const JWT_DATES: [claim: string, label: string][] = [
  ["iat", "Émis le (iat)"],
  ["nbf", "Valable à partir du (nbf)"],
  ["exp", "Expire le (exp)"],
];

function decodeJwt(s: string, now: number): Decoded {
  const parts = withoutBearer(s).split(".");
  if (parts.length !== 3) throw new DecodeError("Ce texte n'est pas un jeton JWT (trois parties séparées par des points).");
  const header = jwtHeader(parts[0]);
  if (!header) throw new DecodeError("L'en-tête du jeton ne se décode pas.");
  const payload = jsonSegment(parts[1]);
  if (!payload) throw new DecodeError("Le contenu du jeton ne se décode pas.");

  const facts: DecodedFact[] = [{ label: "Algorithme", value: String(header.value.alg) }];
  if (String(header.value.alg).toLowerCase() === "none") {
    facts[0].status = { text: "aucune signature", tone: "bad" };
  }
  for (const [claim, label] of JWT_DATES) {
    const v = payload.value[claim];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const ms = v * 1000; // les dates d'un JWT sont en secondes
    const fact: DecodedFact = { label, value: formatDate(ms).local, note: relative(ms, now) };
    if (claim === "exp") fact.status = ms <= now ? { text: "expiré", tone: "bad" } : { text: "encore valide", tone: "good" };
    if (claim === "nbf" && ms > now) fact.status = { text: "pas encore valide", tone: "bad" };
    facts.push(fact);
  }
  return {
    kind: "jwt",
    title: "Jeton JWT",
    warning: JWT_WARNING,
    facts,
    blocks: [
      { label: "En-tête", text: prettyJson(header.text) },
      { label: "Contenu", text: prettyJson(payload.text) },
    ],
  };
}

function decodeBase64(s: string): Decoded {
  if (/[^\S\r\n]/.test(s)) throw new DecodeError("Ce texte n'est pas du Base64 (il contient des espaces).");
  const bytes = base64Bytes(s);
  if (!bytes) throw new DecodeError("Ce texte n'est pas du Base64 valide.");
  const text = utf8(bytes);
  if (text === null || !readable(text)) throw new DecodeError("Ce Base64 ne contient pas de texte lisible (peut-être une image ou un fichier).");
  // Du JSON encodé (secret Kubernetes, morceau de jeton…) : mis en forme aussi.
  const trimmed = text.trim();
  const json = /^[[{]/.test(trimmed) ? parseJson(trimmed) : undefined;
  const block =
    json !== undefined && json !== null && typeof json === "object"
      ? { label: "Texte (JSON mis en forme)", text: prettyJson(trimmed) }
      : { label: "Texte", text };
  return { kind: "base64", title: "Base64 décodé", facts: [], blocks: [block] };
}

function decodeUrl(s: string): Decoded {
  const decoded = tryDecodeUri(s);
  if (decoded === null) throw new DecodeError("Ce texte contient des %xx invalides.");
  const blocks: DecodedBlock[] = [{ label: "Texte décodé", text: decoded }];
  const params = queryParams(s);
  if (params.length) blocks.push({ label: "Paramètres", text: params.map(([k, v]) => `${k} = ${v}`).join("\n") });
  return { kind: "url", title: "Adresse décodée", facts: [], blocks };
}

/**
 * Les paramètres d'une adresse (« ?q=caf%C3%A9&page=2 » → [q, café], [page, 2]),
 * décodés un par un ; dans les paramètres, « + » veut dire une espace.
 */
export function queryParams(s: string): [string, string][] {
  const q = s.includes("?") ? s.slice(s.indexOf("?") + 1) : /^[^/:]*=/.test(s) ? s : "";
  if (!q) return [];
  const part = (x: string) => tryDecodeUri(x.replace(/\+/g, " ")) ?? x;
  return q
    .split("#")[0]
    .split("&")
    .filter((p) => p.length > 0)
    .map((p) => {
      const eq = p.indexOf("=");
      return eq < 0 ? [part(p), ""] : [part(p.slice(0, eq)), part(p.slice(eq + 1))];
    });
}

function decodeJson(s: string): Decoded {
  const value = parseJson(s);
  // Le message de JSON.parse peut citer le texte : on ne le reprend pas.
  if (value === undefined) throw new DecodeError("Ce texte n'est pas du JSON valide.");
  return { kind: "json", title: "JSON mis en forme", facts: [], blocks: [{ label: "JSON", text: prettyJson(s) }] };
}

function decodeTimestamp(s: string, now: number): Decoded {
  const ms = timestampMs(s);
  if (ms === null) throw new DecodeError("Ce nombre n'est pas une date plausible (entre 2000 et 2050).");
  const d = formatDate(ms);
  return {
    kind: "timestamp",
    title: s.length === 13 ? "Horodatage Unix (millisecondes)" : "Horodatage Unix (secondes)",
    facts: [
      { label: "Heure locale", value: d.local, note: relative(ms, now) },
      { label: "UTC", value: d.utc },
      { label: "ISO 8601", value: d.iso },
    ],
    blocks: [],
  };
}
