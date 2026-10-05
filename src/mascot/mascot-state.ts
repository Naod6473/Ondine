// La machine à états de la mascotte, branchée sur le bus d'événements.
//
// Elle traduit ce qui se passe dans l'appli en états (idle, sleep, celebrate…),
// choisit l'animation correspondante dans le manifeste, et respecte ses règles :
//   - priorité : une animation non bouclée en cours n'est interrompue que par
//     une animation de priorité supérieure ou égale ;
//   - transitions autorisées : `transitionsTo` de l'animation en cours ;
//   - fin d'une animation non bouclée : on passe à `next`, sinon à l'état de base
//     (idle, ou working/thinking si une tâche est en cours).
//
// Événements écoutés (voir ARCHITECTURE.md pour la liste complète) :
//   app.ready → wake               task.started → working
//   task.finished → success (sinon celebrate)                  task.failed → error (sinon annoyed)
//   claude.thinking → thinking     claude.done → idle
//   agents.ask → question (sinon alert)                        agents.event « waiting » → question
//   mascot.emote {emotion} → cette émotion (si la mascotte l'a)
//   island.files-dropped → eating  notify.alert → alert       notify.alert-end → idle
//   notify.shown → une petite réaction selon la notification (voir REACTIONS)
//   mascot.clicked ×3 rapides → annoyed, ×6 → dizzy           mascot.hover-long → love
//   inactivité → bored puis sleep  activité pendant sleep → wake
//   mascot.play {animation} → joue cette animation (tests depuis les réglages)
//   Humeur suivant le PC (réglage « ondineMood » du module Système) :
//   system.cpu-busy {on} → worried (elle transpire), humeur grognon tant que ça dure
//   system.battery-low → sad, paupières lourdes ; system.battery-full → happy
//   tard le soir (22 h – 6 h) → paupières lourdes au repos

import type { Bus } from "../core/bus";
import { settingsStore } from "../core/settings-store";
import type { MascotRenderer } from "./renderer";
import { MASCOT_STATES, type AnimationSpec, type MascotManifest, type MascotState, type Mood } from "./types";

/**
 * Comment Ondine réagit à une notification : d'abord selon le module qui
 * l'envoie, sinon selon son icône. Absent : pas de réaction.
 */
const REACTIONS_BY_MODULE: Record<string, MascotState> = {
  agenda: "worried", // un rendez-vous approche
};
const REACTIONS_BY_ICON: Record<string, MascotState> = {
  "⚠️": "warning", // quelque chose n'a pas marché
  "📋": "wink", // copié
  "🎵": "happy", // un nouveau morceau
  "✅": "happy",
  "🧺": "happy",
  "💬": "info",
};
/** L'humeur suit-elle le PC ? (réglage du module Système, activé par défaut) */
function moodFollowsPc(): boolean {
  return settingsStore.current.modules?.system?.values?.ondineMood !== false;
}

/** Tard le soir ou la nuit : Ondine a les paupières lourdes. */
export function isLate(date = new Date()): boolean {
  const h = date.getHours();
  return h >= 22 || h < 6;
}

/** Pas deux réactions à des notifications à moins de ce délai (une rafale ne fait pas danser Ondine sans fin). */
const REACTION_GAP_MS = 4000;

export interface MascotTimings {
  boredAfterMs: number;
  sleepAfterMs: number;
}

export class MascotController {
  state: MascotState = "idle";
  private current: AnimationSpec | null = null;
  private lastActivity = Date.now();
  private clicks: number[] = [];
  /** Tâches en cours (task.started sans task.finished) : la mascotte « travaille ». */
  private tasks = 0;
  private thinking = false;
  private moodUntil = 0;
  private lastReaction = 0;
  /** Le processeur est à fond (message system.cpu-busy). */
  private cpuBusy = false;
  private inactivityTimer: number;
  private offs: (() => void)[] = [];

  constructor(
    private readonly manifest: MascotManifest,
    private readonly renderer: MascotRenderer,
    private readonly bus: Bus,
    public timings: MascotTimings,
  ) {
    renderer.onAnimationEnd((name) => this.onEnd(name));
    this.wire();
    this.inactivityTimer = window.setInterval(() => this.checkInactivity(), 2000);
    this.request("idle", true);
  }

  destroy() {
    clearInterval(this.inactivityTimer);
    for (const off of this.offs) off();
    this.renderer.destroy();
  }

  /** Toute action de l'utilisateur (souris qui bouge sur l'île, clic…). */
  activity() {
    this.lastActivity = Date.now();
    if (this.state === "sleep") this.request("wake");
    else if (this.state === "bored") this.request("idle");
  }

  lookAt(x: number | null, y: number | null) {
    this.renderer.lookAt(x, y);
  }

  /** Demande un état. Renvoie faux si les règles du manifeste l'empêchent. */
  request(state: MascotState, force = false): boolean {
    const anim = this.animationFor(state);
    if (!anim) return false;
    if (!force && !this.allowed(anim)) return false;
    this.state = state;
    this.current = anim;
    this.renderer.setState(state);
    this.renderer.play(anim);
    this.bus.emit("mascot.state", { state, animation: anim.name }, "mascot");
    return true;
  }

  /** Joue une animation par son nom (écran de test des réglages). */
  playAnimation(name: string) {
    const anim = this.manifest.animations.find((a) => a.name === name);
    if (!anim) return;
    const state = (Object.entries(this.manifest.states).find(([, a]) => a === name)?.[0] ?? "idle") as MascotState;
    this.state = state;
    this.current = anim;
    this.renderer.play(anim);
  }

  /** Cette mascotte a-t-elle une animation propre pour cet état ? */
  private has(state: MascotState): boolean {
    return !!this.manifest.states[state];
  }

  /** Demande `state` si la mascotte sait le jouer, sinon `instead` (les anciennes mascottes). */
  private requestOr(state: MascotState, instead: MascotState): boolean {
    return this.request(this.has(state) ? state : instead);
  }

  private animationFor(state: MascotState): AnimationSpec | undefined {
    const name = this.manifest.states[state] ?? this.manifest.fallback;
    return this.manifest.animations.find((a) => a.name === name);
  }

  private allowed(next: AnimationSpec): boolean {
    const cur = this.current;
    if (!cur) return true;
    if (cur.name === next.name) return cur.loop ? false : true;
    const transitionOk = cur.transitionsTo.includes("*") || cur.transitionsTo.includes(next.name);
    if (!transitionOk) return false;
    // Une animation ponctuelle en cours n'est coupée que par plus important qu'elle.
    if (!cur.loop && next.priority < cur.priority) return false;
    return true;
  }

  private onEnd(name: string) {
    const anim = this.manifest.animations.find((a) => a.name === name);
    if (anim?.next) {
      const target = this.manifest.animations.find((a) => a.name === anim.next);
      if (target) {
        this.current = target;
        this.renderer.play(target);
        return;
      }
    }
    this.request(this.baseState(), true);
  }

  /** L'état « de fond » quand rien de ponctuel ne se passe. */
  private baseState(): MascotState {
    if (this.tasks > 0) return "working";
    if (this.thinking) return "thinking";
    return "idle";
  }

  private setMood(mood: Mood, forMs: number) {
    this.renderer.setMood(mood);
    this.moodUntil = Date.now() + forMs;
  }

  /** L'humeur « de fond », quand aucune humeur passagère n'est en cours. */
  private baseMood(): Mood {
    if (!moodFollowsPc()) return "neutral";
    if (this.cpuBusy) return "grumpy";
    if (isLate()) return "tired";
    return "neutral";
  }

  private checkInactivity() {
    const idleMs = Date.now() - this.lastActivity;
    if (this.moodUntil && Date.now() > this.moodUntil) this.moodUntil = 0;
    if (!this.moodUntil) this.renderer.setMood(this.baseMood());
    if (this.tasks > 0 || this.thinking) return;
    if (idleMs > this.timings.sleepAfterMs && this.state !== "sleep") this.request("sleep");
    else if (idleMs > this.timings.boredAfterMs && this.state === "idle") this.request("bored");
  }

  private wire() {
    const on = (topic: string, fn: (payload: any) => void) =>
      this.offs.push(this.bus.on(topic, (m) => fn(m.payload), "mascot"));

    on("app.ready", () => this.request("wake", true));
    on("task.started", () => {
      this.tasks++;
      this.activity();
      this.request("working");
    });
    on("task.finished", () => {
      this.tasks = Math.max(0, this.tasks - 1);
      this.setMood("happy", 30_000);
      this.requestOr("success", "celebrate");
    });
    on("task.failed", () => {
      this.tasks = Math.max(0, this.tasks - 1);
      this.requestOr("error", "annoyed");
    });
    on("claude.thinking", () => {
      this.thinking = true;
      this.request("thinking");
    });
    on("claude.done", () => {
      this.thinking = false;
      this.request(this.baseState());
    });
    // Un agent pose une question ou attend ta permission : la goutte s'interroge.
    on("agents.ask", () => this.requestOr("question", "alert"));
    on("agents.event", (e: { kind?: string } | null) => e?.kind === "waiting" && this.has("question") && this.request("question"));
    // N'importe quel module peut montrer une émotion : bus.emit("mascot.emote", { emotion: "sad" }).
    on("mascot.emote", (p: { emotion?: string } | null) => {
      const want = p?.emotion as MascotState | undefined;
      if (want && (MASCOT_STATES as readonly string[]).includes(want) && this.has(want)) this.request(want);
    });
    on("island.files-dropped", () => {
      this.activity();
      this.request("eating");
    });
    on("notify.alert", () => this.request("alert"));
    on("notify.shown", (n: { moduleId?: string; icon?: string } | null) => this.react(n?.moduleId ?? "", n?.icon ?? ""));
    // Le mode concentration commence : Ondine se calme.
    on("agents.quiet", (q: { on?: boolean } | null) => q?.on && this.has("calm") && this.request("calm"));
    on("notify.alert-end", () => this.state === "alert" && this.request(this.baseState(), true));
    on("mascot.hover-long", () => this.request("love"));
    on("mascot.clicked", () => this.onClick());
    // L'humeur suit le PC.
    on("system.cpu-busy", (p: { on?: boolean } | null) => {
      this.cpuBusy = !!p?.on;
      if (this.cpuBusy && moodFollowsPc() && this.state !== "sleep") this.requestOr("worried", "annoyed");
    });
    on("system.battery-low", () => {
      if (!moodFollowsPc()) return;
      this.setMood("tired", 10 * 60_000);
      this.requestOr("sad", "bored");
    });
    on("system.battery-full", () => moodFollowsPc() && this.request("happy"));
    on("mascot.play", (p: { animation?: string }) => p?.animation && this.playAnimation(p.animation));
  }

  /** Une petite réaction à une notification (si la mascotte a l'émotion, et pas trop souvent). */
  private react(moduleId: string, icon: string) {
    const want = REACTIONS_BY_MODULE[moduleId] ?? REACTIONS_BY_ICON[icon];
    if (!want || !this.has(want)) return;
    // Pendant une tâche ou une réflexion de Claude, on ne coupe pas pour si peu.
    if (this.tasks > 0 || this.thinking || this.state === "sleep") return;
    const now = Date.now();
    if (now - this.lastReaction < REACTION_GAP_MS) return;
    if (this.request(want)) this.lastReaction = now;
  }

  /** Clics répétés : 3 en moins de 2 s → annoyed, 6 → dizzy. Un seul → happy. */
  private onClick() {
    this.activity();
    const now = Date.now();
    this.clicks = [...this.clicks.filter((t) => now - t < 2000), now];
    if (this.clicks.length >= 6) {
      this.clicks = [];
      this.setMood("grumpy", 20_000);
      this.request("dizzy");
    } else if (this.clicks.length >= 3) {
      this.request("annoyed");
    } else if (this.clicks.length === 1) {
      this.request("happy");
    }
  }
}
