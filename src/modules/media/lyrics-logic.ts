// Module « Musique » → les paroles (1.2.5) : lire le format LRC, trouver la
// ligne chantée, sans DOM (testé dans tests/front/lyrics.test.ts). La vue est
// dans index.ts ; la demande à LRCLIB est faite par le Rust (media.rs).
//
// Le format LRC : une ligne par phrase, précédée d'un ou plusieurs
// horodatages « [mm:ss.xx] » (la même phrase chantée deux fois), plus des
// balises d'information (« [ar:Artiste] », « [offset:+250] ») qu'on ignore,
// sauf le décalage. Une ligne horodatée sans texte : un passage sans paroles.

/** Une ligne synchronisée : à partir de `timeMs`, on chante `text` ("" = instrumental). */
export interface LyricLine {
  timeMs: number;
  text: string;
}

/** Ce que la vue affiche. */
export type LyricsView =
  | { kind: "synced"; lines: LyricLine[] }
  | { kind: "plain"; lines: string[] }
  | { kind: "instrumental" }
  | { kind: "none" };

/** La réponse de la commande `lyrics` (src-tauri/src/modules/media.rs). */
export interface LyricsReply {
  title: string;
  artist: string;
  lyrics: { found: boolean; synced: string | null; plain: string | null; instrumental: boolean };
}

/** Au plus ce nombre de lignes (un texte plus long n'est pas des paroles). */
const MAX_LINES = 2_000;
/** Une ligne plus longue est coupée. */
const MAX_LINE_CHARS = 300;

const STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

/** « 12 », « 1 », « 123 » après le point : centièmes, dixièmes ou millièmes → ms. */
function fraction(digits: string | undefined): number {
  if (!digits) return 0;
  return Math.round(Number(digits) * 10 ** (3 - digits.length));
}

/**
 * Le texte LRC → les lignes, dans l'ordre du temps. Les lignes sans
 * horodatage (balises, texte libre) sont ignorées ; plusieurs passages vides
 * de suite n'en font qu'un, et un passage vide en tête est retiré.
 */
export function parseLrc(text: string): LyricLine[] {
  let offset = 0;
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    const off = OFFSET.exec(line);
    if (off) {
      // Un décalage positif : les paroles arrivent plus tôt.
      offset = Number(off[1]);
      continue;
    }
    const stamps: number[] = [];
    for (let m = STAMP.exec(line); m; m = STAMP.exec(line)) {
      const sec = Number(m[2]);
      if (sec < 60) stamps.push(Number(m[1]) * 60_000 + sec * 1000 + fraction(m[3]));
      line = line.slice(m[0].length).trimStart();
    }
    if (!stamps.length) continue;
    const words = line.trim().slice(0, MAX_LINE_CHARS);
    for (const ms of stamps) out.push({ timeMs: ms, text: words });
    if (out.length > MAX_LINES) break;
  }
  const sorted = out
    .slice(0, MAX_LINES)
    .map((l) => ({ ...l, timeMs: Math.max(0, l.timeMs - offset) }))
    // Tri stable : à temps égal, l'ordre du fichier.
    .sort((a, b) => a.timeMs - b.timeMs);
  const lines: LyricLine[] = [];
  for (const l of sorted) {
    const prev = lines[lines.length - 1];
    if (!l.text && (!prev || !prev.text)) continue;
    lines.push(l);
  }
  // Un passage vide à la fin ne sert à rien.
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return lines;
}

/** Le texte seul → ses lignes, sans les lignes vides en double ni au bord. */
export function plainLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().slice(0, MAX_LINE_CHARS);
    if (!line && (!out.length || !out[out.length - 1])) continue;
    out.push(line);
    if (out.length >= MAX_LINES) break;
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** La réponse du Rust → ce qu'on affiche : synchronisé d'abord, sinon le texte seul. */
export function lyricsView(reply: LyricsReply["lyrics"] | null | undefined): LyricsView {
  if (!reply || !reply.found) return { kind: "none" };
  const synced = reply.synced ? parseLrc(reply.synced) : [];
  if (synced.some((l) => l.text)) return { kind: "synced", lines: synced };
  const plain = reply.plain ? plainLines(reply.plain) : [];
  if (plain.length) return { kind: "plain", lines: plain };
  return reply.instrumental ? { kind: "instrumental" } : { kind: "none" };
}

/** La ligne chantée à `positionMs` (-1 : avant la première). */
export function currentLine(lines: readonly LyricLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Dans combien de ms la ligne change (null : plus aucune ligne après). */
export function msUntilNextLine(lines: readonly LyricLine[], positionMs: number): number | null {
  const next = lines[currentLine(lines, positionMs) + 1];
  return next ? Math.max(0, next.timeMs - positionMs) : null;
}

/** Le décalage vertical qui place la ligne `top`…`top + height` vers le haut du cadre (à 40 %). */
export function scrollFor(boxHeight: number, top: number, height: number): number {
  return Math.round(boxHeight * 0.4 - top - height / 2);
}

/** Ce qui identifie un morceau pour ses paroles. */
export function lyricsKey(p: { title: string; artist: string; album: string; durationMs: number | null }): string {
  return [p.title, p.artist, p.album, p.durationMs === null ? "" : Math.round(p.durationMs / 1000)].join("\n");
}
