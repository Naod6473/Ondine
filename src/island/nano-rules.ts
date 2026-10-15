// Format nano de l'île (1.2.3) : quand l'encoche s'élargit en mini-île, et les
// points d'état qu'elle montre (idée 3). Règles pures, sans page ni horloge :
// testées par tests/front/mouth.test.ts. island-forms.ts les branche sur le bus.
//
// Deux sortes d'élargissement (voir IslandStateMachine) :
//   - un « coup » (pulse) quand quelque chose COMMENCE ou FINIT : un nouveau
//     morceau, la lecture qui reprend, un minuteur qui démarre ou sonne, un
//     agent IA qui se met au travail, qui finit ou qui attend une réponse ;
//   - une activité qui DURE et où l'on parle à Ondine : la voix (busy).
// Ce qui dure sans demander d'attention (musique en lecture, agent au
// travail, minuteur en cours) devient un petit point coloré à côté de
// l'encoche, une fois le coup passé.

import type { DotKind } from "./mouth-geom";

export interface NanoStatus {
  music: boolean;
  agent: boolean;
  /** Les minuteurs en cours (ids). */
  timers: string[];
  voice: boolean;
  /** Le mot d'appel écoute (micro ouvert en permanence, 1.2.4). */
  wake: boolean;
  /** Le morceau en cours (titre et artiste), pour reconnaître un nouveau morceau. */
  track: string;
}

export const NANO_START: NanoStatus = { music: false, agent: false, timers: [], voice: false, wake: false, track: "" };

/** Durées des coups d'élargissement (ms). */
export const PULSE = { track: 4000, resume: 2500, timerStart: 3000, timerDone: 6000, agentStart: 2500, agentEnd: 4500 } as const;

export interface NanoStep {
  status: NanoStatus;
  /** Élargir pendant… (ms). */
  pulse?: number;
  /** Une activité qui dure : [clé, en cours]. */
  busy?: [string, boolean];
}

type Payload = Record<string, unknown> | null | undefined;

/** Un message du bus → le nouvel état, et peut-être un élargissement. */
export function nanoStep(s: NanoStatus, topic: string, payload: Payload): NanoStep {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (topic) {
    case "media.changed": {
      const np = (p.playing ?? null) as { title?: string; artist?: string; status?: string } | null;
      const playing = np?.status === "playing";
      const track = np ? `${np.title ?? ""}|${np.artist ?? ""}` : "";
      const next = { ...s, music: playing, track: np ? track : "" };
      if (playing && track !== s.track) return { status: next, pulse: PULSE.track };
      if (playing && !s.music) return { status: next, pulse: PULSE.resume };
      return { status: next };
    }
    case "timer.progress": {
      const id = String(p.id ?? "");
      const on = p.state !== "off" && p.state !== "done";
      const had = s.timers.includes(id);
      const timers = on ? (had ? s.timers : [...s.timers, id]) : s.timers.filter((t) => t !== id);
      const next = { ...s, timers };
      return on && !had ? { status: next, pulse: PULSE.timerStart } : { status: next };
    }
    case "timer.done":
      return { status: s, pulse: PULSE.timerDone };
    case "claude.thinking":
      return s.agent ? { status: s } : { status: { ...s, agent: true }, pulse: PULSE.agentStart };
    case "claude.done":
      return { status: { ...s, agent: false } };
    case "agents.event": {
      if (p.kind === "done") return { status: { ...s, agent: false }, pulse: PULSE.agentEnd };
      if (p.kind === "waiting") return { status: s, pulse: PULSE.agentEnd };
      return { status: s };
    }
    case "agents.ask":
      return { status: s, pulse: PULSE.agentEnd };
    case "voice.listening": {
      const on = !!p.on;
      return { status: { ...s, voice: on }, busy: ["voice", on] };
    }
    case "voice.wake":
      return { status: { ...s, wake: !!p.on } };
    default:
      return { status: s };
  }
}

/** Les sujets du bus à écouter. */
export const NANO_TOPICS = ["media.changed", "timer.progress", "timer.done", "claude.thinking", "claude.done", "agents.event", "agents.ask", "voice.listening", "voice.wake"];

/** L'état pour les points de l'encoche. */
export function dotStatus(s: NanoStatus): Partial<Record<DotKind, boolean>> {
  return { music: s.music, agent: s.agent, timer: s.timers.length > 0, voice: s.voice, wake: s.wake };
}
