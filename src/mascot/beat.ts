// La danse selon la musique : le style (rock, metal, rap…) et le tempo.
//
// Qui fait quoi :
//   - le Rust du module Musique mesure le tempo (src-tauri/src/modules/media_tempo.rs,
//     message « media.tempo » {bpm, phase, confidence, energy}) et lit le
//     genre que le lecteur donne à Windows (champ `genre` de media.changed) ;
//   - src/eggs/dance.ts choisit le style (danceStyle) et publie
//     « mascot.dance » {on, style, bpm, phase} ;
//   - mascot-state.ts joue l'animation du style (DANCE_ANIM) et donne le temps
//     au moteur (setBeat) ; le moteur gomme suit ce temps sans à-coup
//     (BeatFollower) : les pas tombent sur les temps ;
//   - le halo de la danse (src/modules/halos/) bat sur les mêmes temps.
//
// Rien ici ne dépend de la fenêtre : tout est testé dans tests/front/dance.test.ts.

/** Les styles de danse ; « nod » : un simple hochement (Calme, animations réduites). */
export type DanceStyle = "rock" | "metal" | "rap" | "rnb" | "pop" | "electro" | "reggae" | "jazz" | "nod";

/** Les styles qu'on peut choisir (réglage « Style de danse » du module Musique). */
export const DANCE_STYLES: readonly DanceStyle[] = ["rock", "metal", "rap", "rnb", "pop", "electro", "reggae", "jazz"];

/** L'animation de chaque style (manifeste de la mascotte, gum-dances.ts). */
export const DANCE_ANIM: Record<DanceStyle, string> = {
  rock: "danse-rock",
  metal: "danse-metal",
  rap: "danse-rap",
  rnb: "danse-rnb",
  pop: "danse-pop",
  electro: "danse-electro",
  reggae: "danse-reggae",
  jazz: "danse-jazz",
  nod: "danse-hochement",
};

/**
 * Le tempo typique de chaque style : la danse sans mesure (aperçu des
 * réglages, mode démo, avant que le tempo soit trouvé, hors de Windows).
 */
export const STYLE_BPM: Record<DanceStyle, number> = { rock: 124, metal: 150, rap: 92, rnb: 76, pop: 116, electro: 128, reggae: 78, jazz: 96, nod: 100 };

/** Les bornes du tempo mesuré (comme le Rust). */
export const MIN_BPM = 60;
export const MAX_BPM = 200;

/** Le style d'une animation de danse (« danse-rock » → rock), « danse » seule → pop ; null : pas une danse. */
export function styleOfAnim(name: string): DanceStyle | null {
  if (name === "danse") return "pop";
  for (const [style, anim] of Object.entries(DANCE_ANIM)) if (anim === name) return style as DanceStyle;
  return null;
}

/** Une animation de danse ? (son temps suit la musique) */
export function isDanceAnim(name: string): boolean {
  return name === "danse" || name.startsWith("danse-");
}

// L'ordre compte : « metal » avant « rock », « electro pop » est de l'électro, « pop rock » du rock.
const GENRES: [DanceStyle, RegExp][] = [
  ["metal", /metal|hardcore|thrash|grindcore|djent|screamo/i],
  ["rap", /hip[\s-]?hop|\brap\b|trap|drill|grime/i],
  ["rnb", /r\s?&\s?b|\brnb\b|soul|funk|motown/i],
  ["reggae", /reggae|\bdub\b|\bska\b|dancehall|rocksteady/i],
  ["jazz", /jazz|blues|chill|lo-?fi|ambient|bossa|class(ic|ique)|acoustic|acoustique|folk|soundtrack|bande originale|lounge|piano/i],
  ["electro", /electro|électro|electronic|électronique|\bedm\b|house|techno|trance|dubstep|drum\s?(&|and|'n')\s?bass|\bdnb\b|\bdance\b|disco|synthwave/i],
  ["rock", /rock|punk|grunge|indie|alternative|alternatif/i],
  ["pop", /pop|variét|chanson|latin|k-?pop|j-?pop|schlager/i],
];

/** Le style d'après le genre donné par le lecteur (« Hip-Hop/Rap », « Rock alternatif »…), ou null. */
export function styleFromGenre(genre: string | null | undefined): DanceStyle | null {
  const g = (genre ?? "").trim();
  if (!g) return null;
  for (const [style, rx] of GENRES) if (rx.test(g)) return style;
  return null;
}

/**
 * Sans genre : une estimation d'après le tempo et l'énergie du son (0 à 1,
 * le niveau moyen). Grossière exprès : lent et doux → jazz, lent → RnB ou
 * reggae, 85-100 → rap, 100-118 → pop, autour de 128 et fort → électro,
 * rapide → rock, très rapide et fort → metal.
 */
export function guessStyle(bpm: number, energy: number): DanceStyle {
  const e = Number.isFinite(energy) ? energy : 0.3;
  if (bpm < 80) return e < 0.18 ? "jazz" : e < 0.3 ? "reggae" : "rnb";
  if (bpm < 100) return e < 0.18 ? "jazz" : "rap";
  if (bpm < 118) return "pop";
  if (bpm <= 135) return e >= 0.32 ? "electro" : "pop";
  if (bpm < 155) return "rock";
  return e >= 0.42 ? "metal" : "rock";
}

/** Le style à danser : Calme ou animations réduites → hochement ; le réglage ; le genre ; le tempo ; sinon pop. */
export function danceStyle(o: { setting?: unknown; genre?: string | null; bpm?: number | null; energy?: number; still?: boolean }): DanceStyle {
  if (o.still) return "nod";
  if (typeof o.setting === "string" && (DANCE_STYLES as readonly string[]).includes(o.setting)) return o.setting as DanceStyle;
  const byGenre = styleFromGenre(o.genre);
  if (byGenre) return byGenre;
  if (typeof o.bpm === "number" && o.bpm >= MIN_BPM && o.bpm <= MAX_BPM) return guessStyle(o.bpm, o.energy ?? 0.3);
  return "pop";
}

/** Le genre du morceau dans media.changed ({playing: {genre}}, module Musique), ou "". */
export function genreOf(p: unknown): string {
  const playing = (p as { playing?: { genre?: unknown } | null } | null)?.playing;
  return typeof playing?.genre === "string" ? playing.genre : "";
}

/** Le morceau dans media.changed (pour savoir qu'il a changé), ou "". */
export function trackOf(p: unknown): string {
  const playing = (p as { playing?: { title?: unknown; artist?: unknown } | null } | null)?.playing;
  return playing ? `${String(playing.title ?? "")}|${String(playing.artist ?? "")}` : "";
}

/** Mesures de suite qui devinent un autre style avant d'en changer (pas de va-et-vient autour d'une limite). */
export const STYLE_SWITCH_AFTER = 3;

/**
 * Le style à garder : un style deviné d'après le tempo ne remplace le
 * précédent qu'après STYLE_SWITCH_AFTER mesures de suite ; un style choisi,
 * donné par le genre, ou le hochement, tout de suite.
 */
export function steadyStyle(prev: DanceStyle | null, next: DanceStyle, guessed: boolean, pending: number): { style: DanceStyle; pending: number } {
  if (!prev || next === prev || !guessed || prev === "nod" || next === "nod") return { style: next, pending: 0 };
  return pending + 1 >= STYLE_SWITCH_AFTER ? { style: next, pending: 0 } : { style: prev, pending: pending + 1 };
}

/** Un tempo valable (60 à 200), sinon null. */
export function cleanBpm(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM ? v : null;
}

/** Le temps de la musique : le tempo, et l'instant (performance.now()) d'un temps. */
export interface Beat {
  bpm: number;
  at: number;
}

/** Le temps reçu dans « mascot.dance » ({bpm, phase} au moment de l'envoi) → un Beat dans cette fenêtre. */
export function beatFrom(bpm: unknown, phase: unknown, now: number): Beat | null {
  const b = cleanBpm(bpm);
  if (b === null) return null;
  const ph = typeof phase === "number" && Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  return { bpm: b, at: now - ph * (60_000 / b) };
}

/** Où on en est dans le temps (0 = pile sur le temps, 0,5 = entre deux) à l'instant `now`. */
export function beatPhase(beat: Beat, now: number): number {
  const ph = (now - beat.at) / (60_000 / beat.bpm);
  return ((ph % 1) + 1) % 1;
}

/** Deux temps presque pareils ? (même tempo à 1 % près, temps décalés de moins de 40 ms) */
export function sameBeat(a: Beat | null, b: Beat | null, now: number): boolean {
  if (!a || !b) return a === b;
  if (Math.abs(a.bpm - b.bpm) / b.bpm > 0.01) return false;
  const d = Math.abs(beatPhase(a, now) - beatPhase(b, now));
  return Math.min(d, 1 - d) * (60_000 / b.bpm) < 40;
}

/**
 * La période d'un halo qui bat sur la musique : un temps, ou deux, ou quatre,
 * jamais plus vite que `minMs` (le halo ne clignote jamais plus de ~2 fois par seconde).
 */
export function haloBeatMs(bpm: number, minMs = 450): number {
  let ms = 60_000 / bpm;
  while (ms < minMs) ms *= 2;
  return ms;
}

/**
 * Le compte des temps de la danse (continu : 3,25 = un quart après le 4e
 * temps), qui rattrape en douceur le temps de la musique : il accélère ou
 * ralentit un peu (jamais de saut, jamais en arrière) jusqu'à tomber sur les
 * temps. Seul un tout premier tempo, très loin, est pris d'un coup.
 */
export class BeatFollower {
  beats = 0;
  bpm: number;
  private locked = false;

  constructor(bpm = 120) {
    this.bpm = bpm;
  }

  /** Avance de `dt` secondes vers le temps voulu ; renvoie le compte des temps. */
  step(dt: number, now: number, target: Beat | null): number {
    const d = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    if (!target) {
      this.locked = false;
      this.beats += (d * this.bpm) / 60;
      return this.beats;
    }
    // Le tempo glisse vers le bon (un changement franc est pris tout de suite).
    if (!this.locked || Math.abs(target.bpm - this.bpm) / target.bpm > 0.15) this.bpm = target.bpm;
    else this.bpm += (target.bpm - this.bpm) * (1 - Math.exp(-d * 2));
    const want = beatPhase(target, now);
    if (!this.locked) {
      // Le premier temps reçu : on se cale d'un coup (la danse commence à peine).
      this.locked = true;
      const frac0 = this.beats - Math.floor(this.beats);
      this.beats = Math.floor(this.beats) + want + (want < frac0 ? 1 : 0);
      return this.beats;
    }
    // Ensuite : un peu plus vite ou un peu moins vite (au plus ±35 %) jusqu'à rattraper.
    const advance = (d * this.bpm) / 60;
    const ahead = this.beats + advance;
    let err = want - (ahead - Math.floor(ahead));
    if (err > 0.5) err -= 1;
    if (err < -0.5) err += 1;
    const nudge = Math.max(-0.35, Math.min(0.35, err * 1.5));
    this.beats += advance * (1 + nudge);
    return this.beats;
  }

  /** Oublie le calage (nouvelle danse). */
  reset(bpm?: number) {
    this.locked = false;
    if (bpm) this.bpm = bpm;
  }
}
