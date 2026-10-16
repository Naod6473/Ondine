// Ce que partagent les quatre jeux : se taire au bon moment (appel,
// présentation), les sons, les réactions d'Ondine, et la progression de
// l'aquarium (le Rust, ou la mémoire en démo / dans le navigateur).
//
// Se taire : les jeux se mettent en pause et ne font plus de bruit pendant
//   - un appel : le micro est utilisé par une appli (« controls.media-use »
//     du module Contrôles, comme Pauses) ou Notes d'appel enregistre
//     (« callnotes.state » {recording}) ;
//   - une présentation ou une appli en plein écran : l'île le détecte déjà
//     (island.ts, checkPresentation) et pose la classe « presenting » sur
//     <body> ; on la regarde (MutationObserver), sans redemander à Windows.
// Ondine : toutes ses réactions passent par le bus (« mascot.emote »,
// « mascot.look-at ») : c'est la vraie goutte de l'île (gum-engine.ts) qui
// réfléchit, regarde la colonne, boude ou fait la fête. En « Calme »
// (mascot.calm), elle ne garde que l'essentiel (début et fin de partie).

import { IS_TAURI } from "../../core/bridge";
import { demoOn } from "../../core/demo";
import type { ModuleApi } from "../../core/module-types";
import { calmMode } from "../../mascot/mascot-state";
import { sounds } from "../../island/sounds";
import { addResult, buy, buyProblem, cleanState, emptyState, wear, type AquaState, type WearSlot } from "./aquarium-logic";
import type { Level } from "./connect4-logic";

export type QuietReason = "call" | "presentation" | null;

/** Pourquoi les jeux se taisent en ce moment (null : ils peuvent jouer). */
export class Quiet {
  private mic = false;
  private recording = false;
  private presenting = false;
  private listeners = new Set<(r: QuietReason) => void>();
  private stops: (() => void)[] = [];
  private last: QuietReason = null;

  constructor(api: ModuleApi) {
    this.stops.push(
      api.on("controls.media-use", (msg) => {
        this.mic = ((msg.payload as { mic?: unknown[] } | null)?.mic ?? []).length > 0;
        this.changed();
      }),
      api.on("callnotes.state", (msg) => {
        this.recording = (msg.payload as { recording?: boolean } | null)?.recording === true;
        this.changed();
      }),
    );
    const look = () => {
      this.presenting = document.body.classList.contains("presenting");
      this.changed();
    };
    const watch = new MutationObserver(look);
    watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.stops.push(() => watch.disconnect());
    look();
  }

  reason(): QuietReason {
    if (this.mic || this.recording) return "call";
    if (this.presenting) return "presentation";
    return null;
  }

  quiet(): boolean {
    return this.reason() !== null;
  }

  /** Prévenu quand la raison change ; renvoie de quoi se désabonner. */
  onChange(fn: (r: QuietReason) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    const r = this.reason();
    if (r === this.last) return;
    this.last = r;
    for (const fn of this.listeners) fn(r);
  }

  stop() {
    for (const s of this.stops) s();
    this.listeners.clear();
  }
}

/** La phrase de la pause, pour l'interface. */
export function quietText(r: QuietReason): string {
  return r === "call" ? "En pause pendant l'appel" : "En pause pendant la présentation";
}

/** Les petits sons des jeux (réglage « Sons des jeux », et les sons de l'île). */
export type GameSound = "drop" | "land" | "tap" | "win" | "lose" | "draw" | "coin";

export class Kit {
  readonly quiet: Quiet;
  readonly store: AquaStore;

  constructor(readonly api: ModuleApi) {
    this.quiet = new Quiet(api);
    this.store = new AquaStore(api);
  }

  setting(key: string): unknown {
    return this.api.settings()[key];
  }

  /** Le niveau choisi dans les réglages (Normal par défaut). */
  level(): Level {
    const v = this.setting("level");
    return v === "easy" || v === "hard" ? v : "normal";
  }

  enabled(game: "connect4" | "ttt" | "aquarium" | "race"): boolean {
    return this.setting(game) !== false;
  }

  sound(name: GameSound) {
    if (this.quiet.quiet() || this.setting("sounds") === false) return;
    const play: Record<GameSound, () => void> = {
      drop: sounds.drop,
      land: sounds.plop,
      tap: sounds.tap,
      win: () => sounds.hatch("chime"),
      lose: sounds.jingleDown,
      draw: sounds.boing,
      coin: () => sounds.hatch("ring2"),
    };
    play[name]();
  }

  /**
   * Une émotion d'Ondine (mascot.emote). `essential` : une fin de partie,
   * gardée même en « Calme ». Rien pendant un appel ou une présentation.
   */
  emote(emotion: string, essential = false, extra: { intensity?: number; mix?: string; mixK?: number } = {}) {
    if (this.quiet.quiet()) return;
    if (!essential && calmMode()) return;
    this.api.emit("mascot.emote", { emotion, ...extra });
  }

  /** Ondine regarde le centre de cet élément (1,5 s), sauf en « Calme ». */
  lookAt(target: Element | null, essential = false) {
    if (!target || this.quiet.quiet() || (!essential && calmMode())) return;
    const r = target.getBoundingClientRect();
    if (!r.width) return;
    this.api.emit("mascot.look-at", { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  }

  stop() {
    this.quiet.stop();
    this.store.stop();
  }
}

// ── La progression ───────────────────────────────────────────────────────────

/**
 * La progression de l'aquarium. Dans l'appli : le Rust (commandes `state`,
 * `result`, `buy`, `wear`). En démo et dans le navigateur, rien n'arrive au
 * Rust : les mêmes règles (aquarium-logic.ts), en mémoire.
 */
export class AquaStore {
  state: AquaState = emptyState();
  private listeners = new Set<(s: AquaState, gained: number) => void>();
  private off: () => void;
  /** En mémoire (démo, navigateur) : déjà préparé, et pour la démo ou non. */
  private local: "" | "plain" | "demo" = "";

  constructor(private api: ModuleApi) {
    this.off = api.on("games.changed", (msg) => {
      const gained = Number((msg.payload as { gained?: number } | null)?.gained) || 0;
      void this.refresh(gained);
    });
  }

  private useLocal(): boolean {
    return !IS_TAURI || demoOn();
  }

  async refresh(gained = 0): Promise<AquaState> {
    if (this.useLocal()) {
      // Le mode démo peut s'allumer après le démarrage : l'aquarium de
      // démonstration (déjà un peu garni) arrive alors à ce moment-là.
      const want = demoOn() ? "demo" : "plain";
      if (this.local !== want && this.local !== "demo") {
        this.local = want;
        if (want === "demo") this.state = { ...emptyState(), drops: 46, earned: 118, owned: ["algues", "coquillage", "corail", "cap"], wear: { head: "cap", eyes: "none", neck: "none" } };
      }
      this.emit(gained);
      return this.state;
    }
    try {
      this.state = cleanState(await this.api.invoke("state"));
    } catch (e) {
      this.api.log.warn(`aquarium : ${String(e)}`);
    }
    this.emit(gained);
    return this.state;
  }

  /** Une partie finie : renvoie les gouttes gagnées. */
  async result(game: "connect4" | "ttt" | "race", outcome: "win" | "lose" | "draw" | "second", level: Level | "" = ""): Promise<number> {
    if (this.useLocal()) {
      const r = addResult(this.state, game, outcome, level, new Date());
      this.state = r.state;
      this.emit(r.gained);
      return r.gained;
    }
    const before = this.state.drops;
    try {
      this.state = cleanState(await this.api.invoke("result", { game, outcome, level }));
    } catch (e) {
      this.api.log.warn(`aquarium : résultat non compté (${String(e)})`);
      return 0;
    }
    // (Le Rust publie « games.changed » : les vues se redessinent par là.)
    return Math.max(0, this.state.drops - before);
  }

  /** Achète un objet ; renvoie un message d'erreur, ou null si c'est fait. */
  async buy(id: string): Promise<string | null> {
    if (this.useLocal()) {
      const problem = buyProblem(this.state, id);
      if (problem) return problem;
      this.state = buy(this.state, id);
      this.emit(0);
      return null;
    }
    try {
      this.state = cleanState(await this.api.invoke("buy", { id }));
      return null;
    } catch (e) {
      return String(e).replace(/^Error:\s*/, "");
    }
  }

  async wear(slot: WearSlot, id: string): Promise<void> {
    if (this.useLocal()) {
      this.state = wear(this.state, slot, id);
      this.emit(0);
      return;
    }
    try {
      this.state = cleanState(await this.api.invoke("wear", { slot, id }));
    } catch (e) {
      this.api.log.warn(`aquarium : ${String(e)}`);
    }
  }

  onChange(fn: (s: AquaState, gained: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(gained: number) {
    for (const fn of this.listeners) fn(this.state, gained);
  }

  stop() {
    this.off();
    this.listeners.clear();
  }
}
