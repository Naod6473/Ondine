// « Plop plip » : la réponse d'Ondine s'écrit petit à petit, et chaque syllabe
// fait un petit son de goutte, fabriqué sur place (Web Audio : aucun fichier,
// rien ne sort du PC), façon Animal Crossing.
//
//   - la hauteur suit l'humeur de la réponse (graves si triste, aigus si
//     joyeuse), avec un petit écart au hasard à chaque goutte ;
//   - chaque mascotte a son timbre (TIMBRES, par id ; DEFAULT sinon) :
//     Guimauve fait un plop mou, Dragée un tic clair, la Flamme crépite, le
//     Nuage souffle « pfff »… ;
//   - la bouche : à chaque syllabe, `onMouth(open)` (0..1, elle se referme
//     seule) ; sur « ? » et « ! », les sourcils (`brow`). Le module en fait le
//     sujet « mascot.talk » ; la mascotte joue l'animation.
//
// Animations réduites (Windows) ou mascotte « Calme » : le texte s'affiche
// d'un coup, la bouche ne bouge pas ; seules quelques gouttes sonnent.

/** Un timbre : forme d'onde, fréquence de départ (Hz), glissé (×), durée (s). */
export interface Timbre {
  wave: OscillatorType | "noise";
  base: number;
  /** La fréquence d'arrivée = base × sweep (>1 : « plip » qui monte, <1 : « plop » qui tombe). */
  sweep: number;
  dur: number;
  /** Force relative (certains timbres sonnent plus fort que d'autres). */
  gain?: number;
}

/** Le timbre de chaque mascotte (src/mascot/gum-family.ts). */
export const TIMBRES: Record<string, Timbre> = {
  "goutte-gomme": { wave: "sine", base: 620, sweep: 1.7, dur: 0.07 },
  "gomme-guimauve": { wave: "sine", base: 330, sweep: 1.25, dur: 0.12, gain: 1.2 },
  "gomme-dragee": { wave: "triangle", base: 1500, sweep: 0.75, dur: 0.03, gain: 0.8 },
  "gomme-berlingot": { wave: "triangle", base: 900, sweep: 1.4, dur: 0.05 },
  "gomme-etoile": { wave: "sine", base: 1250, sweep: 1.35, dur: 0.05, gain: 0.8 },
  "gomme-soleil": { wave: "triangle", base: 720, sweep: 1.5, dur: 0.06 },
  "gomme-lune": { wave: "sine", base: 460, sweep: 0.85, dur: 0.1 },
  "gomme-nuage": { wave: "noise", base: 1100, sweep: 0.6, dur: 0.09, gain: 1.3 },
  "gomme-coeur": { wave: "sine", base: 560, sweep: 1.6, dur: 0.08 },
  "gomme-fleur": { wave: "sine", base: 820, sweep: 1.3, dur: 0.06 },
  "gomme-champignon": { wave: "triangle", base: 400, sweep: 1.45, dur: 0.08 },
  "gomme-fantome": { wave: "sine", base: 520, sweep: 0.7, dur: 0.13, gain: 0.9 },
  "gomme-flamme": { wave: "noise", base: 3200, sweep: 1.4, dur: 0.025, gain: 1.4 },
  "gomme-ciel": { wave: "sine", base: 700, sweep: 1.5, dur: 0.07 },
  "gomme-meteo": { wave: "triangle", base: 640, sweep: 1.3, dur: 0.07 },
};
export const DEFAULT_TIMBRE: Timbre = TIMBRES["goutte-gomme"];

/** L'humeur → décalage en demi-tons (graves si triste, aigus si joyeuse). */
export function moodShift(mood: string | null | undefined): number {
  switch (mood) {
    case "happy":
    case "laugh":
    case "love":
    case "proud":
    case "starstruck":
      return 4;
    case "surprise":
    case "surprised":
      return 7;
    case "sad":
    case "worried":
    case "scared":
      return -5;
    case "shy":
    case "thinking":
      return -2;
    default:
      return 0;
  }
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Une goutte : timbre, décalage en demi-tons, volume 0..1. */
export function plop(timbre: Timbre, semitones: number, volume: number) {
  if (volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    const ratio = 2 ** (semitones / 12);
    const from = timbre.base * ratio;
    const to = Math.max(40, from * timbre.sweep);
    const out = ctx.createGain();
    const peak = 0.11 * volume * (timbre.gain ?? 1);
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + timbre.dur);
    out.connect(ctx.destination);
    if (timbre.wave === "noise") {
      // Un souffle (nuage) ou un crépitement (flamme) : du bruit filtré.
      if (!noise) {
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(from, t0);
      filter.frequency.exponentialRampToValueAtTime(to, t0 + timbre.dur);
      src.connect(filter).connect(out);
      src.start(t0, Math.random() * 0.1);
      src.stop(t0 + timbre.dur + 0.02);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = timbre.wave;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + timbre.dur);
    osc.connect(out);
    osc.start(t0);
    osc.stop(t0 + timbre.dur + 0.02);
  } catch {
    // pas de son possible : ce n'est que de la décoration
  }
}

const VOWELS = /[aeiouyàâäéèêëîïôöùûüœæ]/i;

/**
 * Les débuts de syllabe d'un texte (indices) : le début de chaque groupe de
 * voyelles. Approximatif, mais assez pour donner un rythme de parole.
 */
export function syllableStarts(text: string): number[] {
  const out: number[] = [];
  let inVowel = false;
  for (let i = 0; i < text.length; i++) {
    const v = VOWELS.test(text[i]);
    if (v && !inVowel) out.push(i);
    inVowel = v;
  }
  return out;
}

/** L'ouverture de la bouche pour une voyelle : grande sur a / o, petite sur i / u. */
export function mouthFor(ch: string): number {
  const c = ch.toLowerCase();
  if ("aàâäoôö".includes(c)) return 1;
  if ("eéèêëœæ".includes(c)) return 0.7;
  return 0.45;
}

export interface SpeakOptions {
  timbre: Timbre;
  mood: string | null;
  /** 0 : muet (discrétion, sons coupés). */
  volume: number;
  /** Tout d'un coup (animations réduites, mascotte Calme). */
  instant: boolean;
  /** Le texte visible a maintenant `n` caractères. */
  onText: (n: number) => void;
  /** Une syllabe : la bouche s'ouvre (0..1) ; `brow` sur « ? » et « ! ». */
  onMouth: (open: number, brow?: "question" | "exclaim") => void;
  onEnd: () => void;
}

/** Une pause un peu plus longue après la ponctuation (ms). */
const PAUSES: Record<string, number> = { ".": 220, "!": 220, "?": 220, ",": 110, ";": 140, ":": 140, "\n": 160 };
/** Les gouttes ne se suivent pas à moins de ça (ms). */
const MIN_GAP = 70;

/**
 * Écrit `text` petit à petit avec ses gouttes. Renvoie une fonction qui
 * arrête tout (le texte entier s'affiche).
 */
export function speak(text: string, o: SpeakOptions): () => void {
  const shift = moodShift(o.mood);
  if (o.instant || !text) {
    o.onText(text.length);
    // Quelques gouttes quand même (le son n'est pas une animation).
    const n = Math.min(4, syllableStarts(text).length);
    const timers = Array.from({ length: n }, (_, i) => window.setTimeout(() => plop(o.timbre, shift + (Math.random() * 4 - 2), o.volume), i * 95));
    const done = window.setTimeout(o.onEnd, n * 95);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(done);
    };
  }
  // ~55 caractères par seconde, plus vite pour un long texte (7 s au plus).
  const cps = Math.max(55, text.length / 7);
  const starts = new Set(syllableStarts(text));
  let shown = 0;
  let lastPlop = 0;
  let timer = 0;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const chunk = Math.max(1, Math.round(cps / 30));
    const end = Math.min(text.length, shown + chunk);
    let pause = 0;
    for (let i = shown; i < end; i++) {
      const ch = text[i];
      const now = performance.now();
      if (starts.has(i) && now - lastPlop >= MIN_GAP) {
        lastPlop = now;
        plop(o.timbre, shift + (Math.random() * 4 - 2), o.volume);
        o.onMouth(mouthFor(ch));
      }
      if (ch === "?") o.onMouth(0.3, "question");
      else if (ch === "!") o.onMouth(0.5, "exclaim");
      pause = Math.max(pause, PAUSES[ch] ?? 0);
    }
    shown = end;
    o.onText(shown);
    if (shown >= text.length) {
      stopped = true;
      o.onMouth(0);
      o.onEnd();
      return;
    }
    timer = window.setTimeout(step, 33 + pause);
  };
  timer = window.setTimeout(step, 60);
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    o.onText(text.length);
    o.onMouth(0);
    o.onEnd();
  };
}
