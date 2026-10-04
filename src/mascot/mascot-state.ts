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
//   app.ready → wake               task.started → working     task.finished → celebrate
//   task.failed → annoyed          claude.thinking → thinking  claude.done → idle
//   island.files-dropped → eating  notify.alert → alert       notify.alert-end → idle
//   mascot.clicked ×3 rapides → annoyed, ×6 → dizzy           mascot.hover-long → love
//   inactivité → bored puis sleep  activité pendant sleep → wake
//   mascot.play {animation} → joue cette animation (tests depuis les réglages)

import type { Bus } from "../core/bus";
import type { MascotRenderer } from "./renderer";
import type { AnimationSpec, MascotManifest, MascotState, Mood } from "./types";

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

  private checkInactivity() {
    const idleMs = Date.now() - this.lastActivity;
    if (this.moodUntil && Date.now() > this.moodUntil) {
      this.moodUntil = 0;
      this.renderer.setMood("neutral");
    }
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
      this.request("celebrate");
    });
    on("task.failed", () => {
      this.tasks = Math.max(0, this.tasks - 1);
      this.request("annoyed");
    });
    on("claude.thinking", () => {
      this.thinking = true;
      this.request("thinking");
    });
    on("claude.done", () => {
      this.thinking = false;
      this.request(this.baseState());
    });
    on("island.files-dropped", () => {
      this.activity();
      this.request("eating");
    });
    on("notify.alert", () => this.request("alert"));
    on("notify.alert-end", () => this.state === "alert" && this.request(this.baseState(), true));
    on("mascot.hover-long", () => this.request("love"));
    on("mascot.clicked", () => this.onClick());
    on("mascot.play", (p: { animation?: string }) => p?.animation && this.playAnimation(p.animation));
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
