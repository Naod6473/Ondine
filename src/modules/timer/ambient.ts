// Les sons d'ambiance du Minuteur (1.2.3) : le moteur WebAudio.
//
// Pluie, vagues et bruit doux sont FABRIQUÉS ici, sans aucun fichier :
//   - bruit doux : un bruit « brun » (le bruit blanc intégré : grave, feutré,
//     comme une soufflerie lointaine), adouci par un filtre passe-bas ;
//   - pluie : un bruit rose filtré (le ruissellement) + des gouttes (petits
//     « tics » aigus qui s'éteignent vite, semés au hasard dans une boucle de
//     12 s, à gauche et à droite) + un grondement grave très bas ;
//   - vagues : un bruit brun dont le volume et la clarté suivent une lente
//     oscillation de 9 s (WAVE_PERIOD_MS) : la vague monte, déferle, se retire.
//     L'oscillation part de zéro au lancement : le liquide de l'île sait donc
//     quand arrive chaque crête (startedAt + période / 4).
// Les enregistrements (src/assets/ambient/, voir ambient-logic.ts) sont lus en
// boucle par le même chemin.
//
// Chemin du son : source(s) → fondu (entrée 1,5 s, sortie 1,2 s, interruptible)
// → volume → analyseur (le niveau, 4 fois par seconde, pour le liquide) →
// haut-parleurs. Rien n'est enregistré ni envoyé.

import { volumeGain, WAVE_PERIOD_MS, type AmbientSound } from "./ambient-logic";

const FADE_IN_S = 1.5;
const FADE_OUT_MS = 1200;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
/** Les bruits déjà fabriqués (une fois chacun, 10 à 12 s en stéréo). */
const buffers = new Map<string, AudioBuffer>();
/** Les enregistrements déjà décodés. */
const decoded = new Map<string, AudioBuffer>();

interface Playing {
  sound: AmbientSound;
  fade: GainNode;
  stop: () => void;
  /** Les vagues : Date.now() au début du premier cycle. */
  startedAt: number;
}
let playing: Playing | null = null;
/** Chaque lancement a son numéro : un vieux chargement de fichier qui arrive trop tard ne joue pas. */
let generation = 0;

/** À appeler pendant un clic : le navigateur ne permet le son qu'après une action de la personne. */
export function unlockAmbient(): void {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

function graph(): { ctx: AudioContext; out: GainNode } | null {
  unlockAmbient();
  if (!ctx) return null;
  if (!master || !analyser) {
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(analyser).connect(ctx.destination);
  }
  return { ctx, out: master };
}

// ── Fabriquer les bruits ─────────────────────────────────────────────────────

/** Bruit blanc, rose ou brun, en stéréo (un bruit différent par oreille). */
function noiseBuffer(c: AudioContext, color: "white" | "pink" | "brown", seconds: number): AudioBuffer {
  const key = `${color}-${seconds}`;
  const cached = buffers.get(key);
  if (cached) return cached;
  const length = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "white") d[i] = w * 0.5;
      else if (color === "pink") {
        // Filtre de Paul Kellet : -3 dB par octave.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        // Brun : on intègre le bruit blanc (avec une petite fuite pour ne pas dériver).
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // La boucle se referme sans clic : un court fondu enchaîné entre la fin et le début.
    const x = Math.min(2048, Math.floor(length / 8));
    for (let i = 0; i < x; i++) {
      const k = i / x;
      d[i] = d[i] * k + d[length - x + i] * (1 - k);
    }
  }
  buffers.set(key, buf);
  return buf;
}

/** Les gouttes de pluie : de petits tics aigus semés au hasard (boucle de 12 s). */
function dropsBuffer(c: AudioContext): AudioBuffer {
  const cached = buffers.get("drops");
  if (cached) return cached;
  const seconds = 12;
  const length = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, length, c.sampleRate);
  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);
  const count = seconds * 38;
  for (let n = 0; n < count; n++) {
    const at = Math.floor(Math.random() * (length - c.sampleRate * 0.05));
    const freq = 1800 + Math.random() * 4200;
    const dur = Math.floor(c.sampleRate * (0.006 + Math.random() * 0.02));
    const amp = 0.04 + Math.random() * 0.12;
    const pan = Math.random();
    for (let i = 0; i < dur; i++) {
      const t = i / c.sampleRate;
      const v = Math.sin(2 * Math.PI * freq * t) * Math.exp(-i / (dur / 5)) * amp;
      left[at + i] += v * (1 - pan);
      right[at + i] += v * pan;
    }
  }
  buffers.set("drops", buf);
  return buf;
}

function loop(c: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  return s;
}

function filter(c: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Branche le son voulu sur `fade` ; renvoie les nœuds à arrêter. */
function build(c: AudioContext, sound: AmbientSound, fade: GainNode, buffer: AudioBuffer | null): AudioScheduledSourceNode[] {
  switch (sound.kind) {
    case "rain": {
      const hiss = loop(c, noiseBuffer(c, "pink", 10));
      hiss.connect(filter(c, "highpass", 450)).connect(filter(c, "lowpass", 7500)).connect(fade);
      const drops = loop(c, dropsBuffer(c));
      const dropGain = c.createGain();
      dropGain.gain.value = 0.9;
      drops.connect(dropGain).connect(fade);
      const rumble = loop(c, noiseBuffer(c, "brown", 11));
      const rumbleGain = c.createGain();
      rumbleGain.gain.value = 0.35;
      rumble.connect(filter(c, "lowpass", 220)).connect(rumbleGain).connect(fade);
      return [hiss, drops, rumble];
    }
    case "waves": {
      const surf = loop(c, noiseBuffer(c, "brown", 11));
      const lp = filter(c, "lowpass", 650);
      const swell = c.createGain();
      swell.gain.value = 0.55;
      // Une oscillation lente (sinus qui part de zéro) : volume et clarté montent ensemble.
      const lfo = c.createOscillator();
      lfo.frequency.value = 1000 / WAVE_PERIOD_MS;
      const toGain = c.createGain();
      toGain.gain.value = 0.45;
      const toFreq = c.createGain();
      toFreq.gain.value = 480;
      lfo.connect(toGain).connect(swell.gain);
      lfo.connect(toFreq).connect(lp.frequency);
      surf.connect(lp).connect(swell).connect(fade);
      // L'écume : un peu de bruit rose aigu, discret.
      const foam = loop(c, noiseBuffer(c, "pink", 10));
      const foamGain = c.createGain();
      foamGain.gain.value = 0.12;
      foam.connect(filter(c, "highpass", 2500)).connect(foamGain).connect(swell);
      return [surf, lfo, foam];
    }
    case "noise": {
      const n = loop(c, noiseBuffer(c, "brown", 11));
      n.connect(filter(c, "lowpass", 1000)).connect(fade);
      return [n];
    }
    default: {
      if (!buffer) return [];
      const s = loop(c, buffer);
      s.connect(fade);
      return [s];
    }
  }
}

// ── Ce que le Minuteur appelle ───────────────────────────────────────────────

/** Le son qui joue (null : rien). */
export function ambientPlaying(): { sound: AmbientSound; startedAt: number } | null {
  return playing ? { sound: playing.sound, startedAt: playing.startedAt } : null;
}

/**
 * Joue `sound` au volume `percent` (fondu enchaîné avec le son d'avant).
 * Rejette si le fichier d'un enregistrement ne se lit pas.
 */
export async function playAmbient(sound: AmbientSound, percent: number): Promise<void> {
  const g = graph();
  if (!g) throw new Error("son indisponible");
  const my = ++generation;
  let buffer: AudioBuffer | null = null;
  if (sound.kind === "file" && sound.url) {
    buffer = decoded.get(sound.url) ?? null;
    if (!buffer) {
      const data = await fetch(sound.url).then((r) => r.arrayBuffer());
      buffer = await g.ctx.decodeAudioData(data);
      decoded.set(sound.url, buffer);
    }
    if (my !== generation) return; // un autre son a été choisi entre-temps
  }
  stopAmbient();
  setAmbientVolume(percent);
  const fade = g.ctx.createGain();
  const now = g.ctx.currentTime;
  fade.gain.setValueAtTime(0, now);
  fade.gain.linearRampToValueAtTime(1, now + FADE_IN_S);
  fade.connect(g.out);
  const nodes = build(g.ctx, sound, fade, buffer);
  for (const n of nodes) n.start(now);
  playing = {
    sound,
    fade,
    startedAt: Date.now(),
    stop: () => {
      const t = g.ctx.currentTime;
      fade.gain.cancelScheduledValues(t);
      fade.gain.setValueAtTime(fade.gain.value, t);
      fade.gain.linearRampToValueAtTime(0, t + FADE_OUT_MS / 1000);
      for (const n of nodes) {
        try {
          n.stop(t + FADE_OUT_MS / 1000 + 0.05);
        } catch {
          // déjà arrêté
        }
      }
      window.setTimeout(() => fade.disconnect(), FADE_OUT_MS + 200);
    },
  };
}

/** Arrête le son en douceur (un nouveau son peut partir tout de suite). */
export function stopAmbient(): void {
  playing?.stop();
  playing = null;
}

/** Change le volume (0 à 100), sans à-coup. */
export function setAmbientVolume(percent: number): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(volumeGain(percent), t, 0.08);
}

const samples = new Float32Array(1024);
/** Le niveau du son en ce moment (0 à 1), pour le liquide de l'île. */
export function ambientLevel(): number {
  if (!analyser || !playing) return 0;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.min(1, Math.sqrt(sum / samples.length) * 5);
}
