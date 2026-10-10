// La danse selon la musique : eggs.ts décide QUAND Ondine danse (de la musique,
// la mini-île ou le bureau) ; ici, COMMENT : le style et le tempo.
//
//   - le tempo vient du module Musique (commande « tempo » {on}, redite toutes
//     les 10 s tant qu'elle danse ; message « media.tempo » {bpm, phase,
//     confidence, energy} une fois par seconde, {bpm: null} quand le rythme
//     est perdu). Réglage « La mascotte danse au tempo de la musique » décoché :
//     rien n'est demandé, elle danse au tempo typique du style ;
//   - le style : réglage « Style de danse », sinon le genre que le lecteur
//     donne à Windows (media.changed, champ `genre`), sinon le tempo et
//     l'énergie du son (danceStyle, src/mascot/beat.ts) ; Calme ou animations
//     réduites : un simple hochement ;
//   - publié à chaque changement et à chaque mesure : « mascot.dance »
//     {on, style, bpm, phase} (phase : où on en est dans le temps à l'envoi).
//     mascot-state.ts (île et bureau) et le halo de la danse s'y calent.

import { Bridge } from "../core/bridge";
import type { Bus } from "../core/bus";
import { demoInvoke, demoOn } from "../core/demo";
import { settingsStore } from "../core/settings-store";
import { reducedMotion } from "../island/tab-pill";
import { cleanBpm, DANCE_STYLES, danceStyle, genreOf, steadyStyle, styleFromGenre, trackOf, type DanceStyle } from "../mascot/beat";

/** Le module Musique oublie la demande de tempo après 30 s : on la redit toutes les 10 s. */
const KEEPALIVE_MS = 10_000;
/** Un tempo plus vieux que ça (le message ne vient plus) ne compte plus. */
const TEMPO_STALE_MS = 6_000;

/** Ce que publie le module Musique (media.tempo). */
export interface TempoMsg {
  bpm?: number | null;
  phase?: number;
  confidence?: number;
  energy?: number;
}

/** Les réglages du module Musique qui comptent ici (valeurs par défaut du manifeste). */
function mediaPrefs(): { tempo: boolean; style: string } {
  const v = (settingsStore.current.modules?.media?.values ?? {}) as Record<string, unknown>;
  return { tempo: v.danceTempo !== false, style: typeof v.danceStyle === "string" ? v.danceStyle : "auto" };
}

export class MusicDance {
  private on = false;
  private genre = "";
  private tempo: { bpm: number; phase: number; energy: number; at: number } | null = null;
  private keepalive = 0;
  private lastStyle: DanceStyle | null = null;
  private pending = 0;
  private track = "";
  private offs: (() => void)[] = [];

  constructor(private readonly bus: Bus) {
    this.offs.push(
      bus.on("media.tempo", (m) => this.tempoChanged((m.payload ?? {}) as TempoMsg), "eggs"),
      bus.on(
        "media.changed",
        (m) => {
          const g = genreOf(m.payload);
          const track = trackOf(m.payload);
          // Un nouveau morceau : le style deviné repart de zéro (le tempo aussi, côté Rust).
          if (track && track !== this.track) {
            this.track = track;
            this.lastStyle = null;
            this.tempo = null;
          }
          if (g === this.genre) return;
          this.genre = g;
          if (this.on) this.publish();
        },
        "eggs",
      ),
      // Calme, style choisi, tempo décoché : la danse suit tout de suite.
      settingsStore.onChange(() => {
        if (!this.on) return;
        this.ask();
        this.publish();
      }),
    );
  }

  /** eggs.ts : elle danse, ou plus. */
  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    window.clearInterval(this.keepalive);
    this.keepalive = 0;
    if (on) {
      this.ask();
      this.keepalive = window.setInterval(() => this.ask(), KEEPALIVE_MS);
    } else {
      this.tempo = null;
      this.lastStyle = null;
      this.ask();
    }
    this.publish();
  }

  /** Le style dansé en ce moment (null : elle ne danse pas). */
  style(): DanceStyle | null {
    return this.on ? this.lastStyle : null;
  }

  destroy() {
    window.clearInterval(this.keepalive);
    for (const off of this.offs) off();
  }

  /** Demande (ou redemande) le tempo au module Musique, si le réglage le permet. */
  private ask() {
    if (!settingsStore.moduleEnabled("media")) return;
    const on = this.on && mediaPrefs().tempo;
    // Mode démo : le tempo inventé de la musique de démo (src/core/demo.ts).
    // Hors de l'appli (navigateur) : pas de module, elle danse au tempo du style.
    const call = demoOn() ? demoInvoke(this.bus, "media", "tempo", { on }) : Bridge.moduleInvoke("media", "tempo", { on });
    void call.catch(() => undefined);
    if (!on) this.tempo = null;
  }

  private tempoChanged(p: TempoMsg) {
    const bpm = cleanBpm(p.bpm);
    this.tempo = bpm === null ? null : { bpm, phase: Number(p.phase) || 0, energy: Number(p.energy) || 0, at: performance.now() };
    if (this.on) this.publish();
  }

  private publish() {
    if (!this.on) {
      this.bus.emit("mascot.dance", { on: false }, "eggs");
      return;
    }
    const prefs = mediaPrefs();
    const fresh = this.tempo && prefs.tempo && performance.now() - this.tempo.at < TEMPO_STALE_MS ? this.tempo : null;
    const still = settingsStore.current.mascot?.calm === true || reducedMotion();
    const want = danceStyle({ setting: prefs.style, genre: this.genre, bpm: fresh?.bpm ?? null, energy: fresh?.energy, still });
    // Deviné d'après le tempo : ni style choisi, ni genre reconnu.
    const guessed = !still && !(DANCE_STYLES as readonly string[]).includes(prefs.style) && styleFromGenre(this.genre) === null;
    const { style, pending } = steadyStyle(this.lastStyle, want, guessed, this.pending);
    this.lastStyle = style;
    this.pending = pending;
    // La phase a vieilli depuis la mesure : on l'avance du temps écoulé.
    const phase = fresh ? fresh.phase + (performance.now() - fresh.at) / (60_000 / fresh.bpm) : 0;
    this.bus.emit("mascot.dance", { on: true, style, bpm: fresh?.bpm ?? null, phase: fresh ? ((phase % 1) + 1) % 1 : 0 }, "eggs");
  }
}
