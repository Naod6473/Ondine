// De petits sons de clic, mignons et légers, fabriqués sur place (Web Audio) :
// aucun fichier, rien ne sort du PC. Désactivables (réglage « island.sounds »).
//
// Chaque son est une note très courte dont la hauteur glisse, avec une
// enveloppe douce (ça « ploppe » au lieu de claquer), comme une goutte d'eau.

let ctx: AudioContext | null = null;
let enabled = true;
let volume = 0.5;

export function setSoundPrefs(on: boolean, vol: number) {
  enabled = on;
  volume = Math.max(0, Math.min(1, vol));
}

/** Une note : fréquence de départ → d'arrivée (Hz), durée (s), force (0-1). */
function blip(from: number, to: number, duration: number, strength: number, delay = 0, type: OscillatorType = "sine") {
  if (!enabled || volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    // Le navigateur peut mettre le son en pause tant qu'on n'a pas cliqué.
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const peak = 0.12 * strength * volume;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {
    // pas de son possible : tant pis, ce n'est que de la décoration
  }
}

export const sounds = {
  /** Un clic sur un bouton : un « tic » doux. */
  tap: () => blip(1300, 900, 0.045, 0.6),
  /** L'île s'ouvre : une bulle qui monte. */
  open: () => {
    blip(520, 880, 0.09, 0.8);
    blip(880, 1320, 0.07, 0.5, 0.06);
  },
  /** L'île se referme : la bulle redescend. */
  close: () => blip(760, 420, 0.1, 0.6),
  /** Un interrupteur : plus aigu quand on allume. */
  toggle: (on: boolean) => blip(on ? 900 : 700, on ? 1400 : 500, 0.06, 0.6),
  /** Une goutte qui tombe (Ondine arrive, un fichier est déposé). */
  drop: () => blip(1600, 420, 0.14, 0.7),
  /** L'île relâchée après un étirement : un petit « boïng ». */
  boing: () => {
    blip(300, 520, 0.08, 0.6, 0, "triangle");
    blip(520, 380, 0.12, 0.4, 0.07, "triangle");
  },
};
