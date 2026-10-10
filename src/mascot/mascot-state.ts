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
// Événements écoutés (voir docs/ARCHITECTURE.md pour la liste complète) :
//   app.ready → wake               task.started → working
//   task.finished → success (sinon celebrate)                  task.failed → error (sinon annoyed)
//   claude.thinking → thinking     claude.done → idle
//   agents.ask → question (sinon alert)                        agents.event « waiting » → question
//   mascot.emote {emotion, intensity?, mix?, mixK?, side?} → cette émotion ; si
//     la mascotte ne l'a pas, une expression proche (EMOTE_NEAR). intensity
//     (0 à 1) la dose, mix (un autre id) + mixK (0 à 1) la mélange, side
//     "left" la joue de l'autre côté (pousser, fuir, grimper vers la gauche)
//   mascot.talk {open, mark?} → la bouche suit la voix (open 0 à 1 au rythme
//     des syllabes, mark « ? » ou « ! » : les sourcils) ; l'état « talk »
//     revient au repos 1,5 s après le dernier message
//   island.files-dropped → eating  notify.alert → alert       notify.alert-end → idle
//   notify.shown → une petite réaction selon la notification (voir REACTIONS)
//   mascot.clicked ×3 rapides → annoyed, ×6 → dizzy           mascot.hover-long → love
//   inactivité → bored puis sleep  activité pendant sleep → wake
//   mascot.play {animation} → joue cette animation (tests depuis les réglages)
//   mascot.dance {on, style?, bpm?, phase?} → elle danse en boucle (musique +
//     mini-île, src/eggs/dance.ts) : la danse du style (« danse-rock »… si la
//     mascotte l'a, sinon « danse »), calée sur le temps (renderer.setBeat) ;
//     redit à chaque nouvelle mesure du tempo. Les autres réactions passent,
//     puis elle reprend la danse
//   Humeur suivant le PC (réglage « ondineMood » du module Système) :
//   system.cpu-busy {on} → worried (elle transpire), humeur grognon tant que ça dure
//   system.battery-low → sad, paupières lourdes ; system.battery-full → happy
//   tard le soir (22 h – 6 h) → paupières lourdes au repos
//   Les nouvelles têtes de la famille gomme (si la mascotte les a) :
//   avant de s'endormir → yawn (elle bâille, puis dort)
//   réveillée deux fois en moins de 5 min → pout (elle boude)
//   deux clics rapides → laugh            une tâche de plus de 10 min finie → moved
//   weather.updated → la mascotte « Météo » change de forme (renderer.setWeather)
//   Les réactions aux modules (courtes, pas pendant une tâche ni le sommeil,
//   au plus une toutes les 4 s, et jamais avec le réglage « Calme ») :
//   shelf.downloaded → starstruck (un fichier arrive sur l'étagère)
//   timer.done → cheer (la fin du minuteur, bras levés ; le task.finished qui suit ne la coupe pas)
//   clipboard.link-cleaned → wink        capture.done {ok} → proud
//   controls.usb-ejected → wave (au revoir la clé)   system.disk-low → worried
//   Ce qu'elle porte tant que ça dure (renderer.setExtras, famille gomme ; les
//   « poses » montrent le « ? ») :
//   agents.quiet {on} → les moufles sur les oreilles (concentration)
//   weather.updated (pluie) → un parapluie au-dessus d'elle
//   agents.ask → la pancarte « ? » jusqu'à agents.ask.closed (même en « Calme » :
//     un clic sur elle ouvre alors l'onglet Agents IA, voir island.ts)
//   Réglage « Calme » (mascot.calm) : voir calmMode() et docs/ARCHITECTURE.md.

import { beatFrom, DANCE_ANIM, type DanceStyle } from "./beat";
import type { Bus } from "../core/bus";
import { settingsStore } from "../core/settings-store";
import { pacedInterval } from "../core/perf";
import { isRainy, type WeatherLike } from "../eggs/calendar";
import type { MascotRenderer } from "./renderer";
import { EMOTE_NEAR, MASCOT_STATES, NO_EXTRAS, type AnimationSpec, type MascotExtras, type MascotManifest, type MascotState, type Mood } from "./types";

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

/**
 * Réglage « Calme : moins de gestes spontanés » (mascot.calm). Coupé : l'ennui
 * (elle passe du repos au sommeil, sans bâiller), la bouderie au réveil, les
 * réactions aux notifications et aux modules, les moufles sur les oreilles et
 * le parapluie, les émotions qui suivent le PC (processeur, batterie ; l'humeur
 * de fond reste), et ailleurs la danse, le goûter (src/eggs/eggs.ts) et les
 * visites au bord de l'écran (island.ts). Gardé : réveil, sommeil, travail,
 * réflexion, succès, erreur, question et pancarte « ? », alerte, repas (dépôt
 * de fichiers), les réponses aux clics et au survol.
 */
export function calmMode(): boolean {
  return settingsStore.current.mascot.calm === true;
}

/** Tard le soir ou la nuit : Ondine a les paupières lourdes. */
export function isLate(date = new Date()): boolean {
  const h = date.getHours();
  return h >= 22 || h < 6;
}

/** Pas deux réactions à des notifications à moins de ce délai (une rafale ne fait pas danser Ondine sans fin). */
const REACTION_GAP_MS = 4000;

/** Ce que reçoit mascot.emote (seul `emotion` est obligatoire). */
export interface EmotePayload {
  emotion?: string;
  intensity?: number;
  mix?: string;
  mixK?: number;
  side?: "left" | "right";
}

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
  /** Elle danse (message mascot.dance) : la danse remplace le repos. */
  private dance = false;
  /** L'animation de la danse en cours (« danse-rock »…, ou « danse »). */
  private danceAnim = "danse";
  /** Le processeur est à fond (message system.cpu-busy). */
  private cpuBusy = false;
  /** Quand la première tâche en cours a commencé (pour une longue tâche → émue). */
  private tasksSince = 0;
  /** Les derniers réveils (pour bouder quand on la réveille trop souvent). */
  private wakes: number[] = [];
  /** Les questions d'agents ouvertes (ids de agents.ask), pour la pancarte « ? ». */
  private asks = new Set<number>();
  /** La concentration des agents est en cours (agents.quiet). */
  private quiet = false;
  /** La Météo annonce la pluie. */
  private rainy = false;
  /** Ce qu'elle porte en ce moment (renderer.setExtras), pour ne pousser que les changements. */
  private extras: MascotExtras = NO_EXTRAS;
  /** Le dernier message de mascot.talk (l'état « talk » revient au repos après un silence). */
  private lastTalk = 0;
  /** Quand le minuteur a sonné (son task.finished arrive juste après : la fête est déjà là). */
  private timerDone = 0;
  private stopInactivity: () => void;
  private offs: (() => void)[] = [];

  constructor(
    private readonly manifest: MascotManifest,
    private readonly renderer: MascotRenderer,
    private readonly bus: Bus,
    public timings: MascotTimings,
  ) {
    renderer.onAnimationEnd((name) => this.onEnd(name));
    this.wire();
    // Toutes les 2 s (4 s en économie d'énergie : src/core/perf.ts).
    this.stopInactivity = pacedInterval(() => this.checkInactivity(), "mascotIdle");
    // Le réglage « Calme » change : les moufles et le parapluie suivent.
    this.offs.push(settingsStore.onChange(() => this.pushExtras()));
    this.request("idle", true);
  }

  /** Une question d'agent attend une réponse (la pancarte « ? » est levée). */
  get askOpen(): boolean {
    return this.asks.size > 0;
  }

  destroy() {
    this.stopInactivity();
    for (const off of this.offs) off();
    this.renderer.destroy();
  }

  /** Toute action de l'utilisateur (souris qui bouge sur l'île, clic…). */
  activity() {
    this.lastActivity = Date.now();
    if (this.state === "sleep" || this.state === "yawn") {
      const now = Date.now();
      this.wakes = [...this.wakes.filter((w) => now - w < 5 * 60_000), now];
      // Réveillée deux fois en peu de temps : elle boude un peu en se réveillant (pas en « Calme »).
      if (this.wakes.length >= 2 && this.has("pout") && !calmMode()) {
        this.wakes = [];
        this.request("pout", true);
      } else this.request("wake");
    } else if (this.state === "bored") this.request("idle");
  }

  lookAt(x: number | null, y: number | null) {
    this.renderer.lookAt(x, y);
  }

  /** Demande un état. Renvoie faux si les règles du manifeste l'empêchent. */
  request(state: MascotState, force = false): boolean {
    const anim = this.animationFor(state);
    if (!anim) return false;
    if (!force && !this.allowed(anim)) return false;
    // Pendant la danse, un état « de fond » (repos, ennui, inquiétude…) ne
    // l'arrête pas : elle reprend la danse. Seuls le travail et la réflexion
    // passent devant ; les réactions ponctuelles jouent, puis la danse revient.
    if (this.dance && anim.loop && this.tasks === 0 && !this.thinking && state !== "sleep") {
      if (this.current?.name !== this.danceAnim) this.playAnimation(this.danceAnim);
      return true;
    }
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
    // Le bâillement mène au sommeil.
    if (this.state === "yawn") {
      this.request("sleep", true);
      return;
    }
    const anim = this.manifest.animations.find((a) => a.name === name);
    if (anim?.next) {
      const target = this.manifest.animations.find((a) => a.name === anim.next);
      if (target) {
        this.current = target;
        // L'état suit l'animation qui joue (le coucou après le réveil n'est plus « wake »).
        const state = Object.entries(this.manifest.states).find(([, a]) => a === target.name)?.[0];
        if (state) this.state = state as MascotState;
        this.renderer.play(target);
        return;
      }
    }
    if (this.dance && this.tasks === 0 && !this.thinking) return this.playAnimation(this.danceAnim);
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
    // Elle parlait, la voix s'est tue : retour au repos.
    if (this.state === "talk" && Date.now() - this.lastTalk > 1500) this.request(this.baseState(), true);
    const idleMs = Date.now() - this.lastActivity;
    if (this.moodUntil && Date.now() > this.moodUntil) this.moodUntil = 0;
    if (!this.moodUntil) this.renderer.setMood(this.baseMood());
    if (this.tasks > 0 || this.thinking || this.dance) return;
    const calm = calmMode();
    if (idleMs > this.timings.sleepAfterMs && this.state !== "sleep" && this.state !== "yawn") {
      // En « Calme », elle s'endort sans bâiller.
      if (calm) this.request("sleep");
      else this.requestOr("yawn", "sleep");
    } else if (idleMs > this.timings.boredAfterMs && this.state === "idle" && !calm) this.request("bored");
  }

  /** Pousse au moteur ce qu'elle porte, si ça a changé. */
  private pushExtras() {
    const calm = calmMode();
    const next: MascotExtras = { ears: this.quiet && !calm, sign: this.asks.size > 0, umbrella: this.rainy && !calm };
    if (next.ears === this.extras.ears && next.sign === this.extras.sign && next.umbrella === this.extras.umbrella) return;
    this.extras = next;
    this.renderer.setExtras?.(next);
  }

  private wire() {
    const on = (topic: string, fn: (payload: any) => void) =>
      this.offs.push(this.bus.on(topic, (m) => fn(m.payload), "mascot"));

    on("app.ready", () => this.request("wake", true));
    on("task.started", () => {
      if (this.tasks === 0) this.tasksSince = Date.now();
      this.tasks++;
      this.activity();
      this.request("working");
    });
    on("task.finished", () => {
      this.tasks = Math.max(0, this.tasks - 1);
      this.setMood("happy", 30_000);
      // Le minuteur vient de sonner : elle a déjà les bras levés.
      if (Date.now() - this.timerDone < 1500) return;
      // Une longue tâche enfin finie : elle est émue.
      if (this.tasks === 0 && Date.now() - this.tasksSince > 10 * 60_000 && this.has("moved")) this.request("moved");
      else this.requestOr("success", "celebrate");
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
    // Un agent pose une question ou attend ta permission : la goutte s'interroge,
    // et tient la pancarte « ? » tant que la question est ouverte.
    on("agents.ask", (p: { id?: number } | null) => {
      if (typeof p?.id === "number") {
        this.asks.add(p.id);
        // Une rafale de questions sans réponse ne grossit pas sans fin : les plus vieilles s'oublient.
        if (this.asks.size > 50) this.asks.delete(this.asks.values().next().value as number);
        this.pushExtras();
      }
      this.requestOr("question", "alert");
    });
    on("agents.ask.closed", (p: { id?: number } | null) => {
      if (typeof p?.id === "number") this.asks.delete(p.id);
      this.pushExtras();
    });
    on("agents.event", (e: { kind?: string } | null) => e?.kind === "waiting" && this.has("question") && this.request("question"));
    // N'importe quel module peut montrer une émotion : bus.emit("mascot.emote", { emotion: "sad" }).
    on("mascot.emote", (p: EmotePayload | null) => this.emote(p));
    // La voix (zone Parler à Ondine) : la bouche suit les syllabes, les sourcils la ponctuation.
    // Parler à Ondine envoie `brow` ("question" / "exclaim") : même effet que `mark` « ? » / « ! ».
    on("mascot.talk", (p: { open?: number; mark?: string; brow?: string } | null) => {
      const open = typeof p?.open === "number" ? p.open : 0;
      const mark = p?.mark ?? (p?.brow === "question" ? "?" : p?.brow === "exclaim" ? "!" : undefined);
      this.lastTalk = Date.now();
      // Elle se met à parler (au repos ou attentive) : l'état « talk », la moufle qui accompagne.
      if (open > 0 && (this.state === "idle" || this.state === "listening") && this.has("talk")) this.request("talk");
      this.renderer.talk?.(open, mark === "?" || mark === "!" ? mark : null);
    });
    on("island.files-dropped", () => {
      this.activity();
      this.request("eating");
    });
    on("notify.alert", () => this.request("alert"));
    on("notify.shown", (n: { moduleId?: string; icon?: string } | null) => this.reactTo(REACTIONS_BY_MODULE[n?.moduleId ?? ""] ?? REACTIONS_BY_ICON[n?.icon ?? ""]));
    // Le mode concentration commence : Ondine se calme, et se bouche les oreilles tant que ça dure.
    on("agents.quiet", (q: { on?: boolean } | null) => {
      this.quiet = !!q?.on;
      this.pushExtras();
      if (this.quiet && this.has("calm")) this.request("calm");
    });
    // Les réactions aux modules (voir l'en-tête).
    on("shelf.downloaded", () => this.reactTo("starstruck", "happy"));
    on("timer.done", () => {
      if (!this.reactTo("cheer", "celebrate")) return;
      this.timerDone = Date.now();
    });
    on("clipboard.link-cleaned", () => this.reactTo("wink"));
    on("capture.done", (p: { ok?: boolean } | null) => p?.ok && this.reactTo("proud", "happy"));
    on("controls.usb-ejected", () => this.reactTo("wave", "happy"));
    on("system.disk-low", () => this.reactTo("worried"));
    on("notify.alert-end", () => this.state === "alert" && this.request(this.baseState(), true));
    on("mascot.hover-long", () => this.request("love"));
    on("mascot.clicked", () => this.onClick());
    // L'humeur suit le PC.
    on("system.cpu-busy", (p: { on?: boolean } | null) => {
      this.cpuBusy = !!p?.on;
      if (this.cpuBusy && moodFollowsPc() && !calmMode() && this.state !== "sleep") this.requestOr("worried", "annoyed");
    });
    on("system.battery-low", () => {
      if (!moodFollowsPc()) return;
      this.setMood("tired", 10 * 60_000);
      if (!calmMode()) this.requestOr("sad", "bored");
    });
    on("system.battery-full", () => moodFollowsPc() && !calmMode() && this.request("happy"));
    on("weather.updated", (w: WeatherLike | null) => {
      this.renderer.setWeather?.(w?.icon ?? null);
      this.rainy = isRainy(w);
      this.pushExtras();
    });
    on("mascot.play", (p: { animation?: string }) => p?.animation && this.playAnimation(p.animation));
    on("mascot.dance", (p: { on?: boolean; style?: string; bpm?: number | null; phase?: number } | null) => {
      const has = (name: string) => this.manifest.animations.some((a) => a.name === name);
      const styled = p?.style ? DANCE_ANIM[p.style as DanceStyle] : undefined;
      const anim = styled && has(styled) ? styled : "danse";
      const want = !!p?.on && has(anim);
      // Le temps de la musique (null : le tempo typique du style).
      this.renderer.setBeat?.(want ? beatFrom(p?.bpm, p?.phase, performance.now()) : null);
      if (want === this.dance && anim === this.danceAnim) return;
      const was = this.dance;
      this.dance = want;
      this.danceAnim = anim;
      if (want) {
        // Un nouveau style pendant la danse : seulement si elle dansait (pas au milieu d'une réaction).
        if (!was || this.current?.name?.startsWith("danse")) this.playAnimation(anim);
      } else if (was) this.request(this.baseState(), true);
    });
  }

  /** L'état qu'on montre pour une émotion demandée : elle-même, sinon une proche (deux pas au plus). */
  private stateFor(emotion: string | undefined): MascotState | undefined {
    let want = emotion;
    for (let i = 0; i < 3 && want; i++) {
      if ((MASCOT_STATES as readonly string[]).includes(want) && this.has(want as MascotState)) return want as MascotState;
      want = EMOTE_NEAR[want];
    }
    return undefined;
  }

  /** mascot.emote : l'émotion (ou une proche), dosée, mélangée, du bon côté. */
  private emote(p: EmotePayload | null) {
    const state = this.stateFor(p?.emotion);
    if (state === "talk") this.lastTalk = Date.now();
    if (!state || !this.request(state)) return;
    const intensity = typeof p?.intensity === "number" ? p.intensity : undefined;
    const mixState = p?.mix ? this.stateFor(p.mix) : undefined;
    const mix = mixState && mixState !== state ? this.animationFor(mixState) : undefined;
    const mirror = p?.side === "left";
    if (intensity !== undefined || mix || mirror) this.renderer.express?.({ intensity, mix, mixK: typeof p?.mixK === "number" ? p.mixK : undefined, mirror });
  }

  /**
   * Une petite réaction à une notification ou à un module : `want` si la
   * mascotte a l'émotion, sinon `instead` (les anciennes mascottes) ; pas
   * trop souvent, pas pendant une tâche ni le sommeil, jamais en « Calme ».
   * Renvoie vrai si elle a joué.
   */
  private reactTo(want: MascotState | undefined, instead?: MascotState): boolean {
    const state = want && this.has(want) ? want : instead && this.has(instead) ? instead : undefined;
    if (!state || calmMode()) return false;
    // Pendant une tâche ou une réflexion de Claude, on ne coupe pas pour si peu.
    if (this.tasks > 0 || this.thinking || this.state === "sleep") return false;
    const now = Date.now();
    if (now - this.lastReaction < REACTION_GAP_MS) return false;
    if (!this.request(state)) return false;
    this.lastReaction = now;
    return true;
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
    } else if (this.clicks.length === 2 && this.has("laugh")) {
      this.request("laugh");
    } else if (this.clicks.length === 1) {
      this.request("happy");
    }
  }
}
