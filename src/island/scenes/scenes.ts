// Ondine se déplace dans l'île : les 22 scènes de
// /animations-ile/ondine-se-deplace.md, branchées sur les vrais événements.
//
// Pour certaines actions, elle quitte sa case en petits sauts de gomme
// (walker.ts), va jusqu'à l'élément, agit (avec les gestes du moteur de la
// mascotte : pousse, assise, grimpe, tapote…), puis revient.
//
//   - Interruptible : un appui dans l'île, un clic sur elle, une autre scène
//     ou un changement d'état de l'île la ramène (Run.cancel).
//   - Jamais devant le texte qu'on lit : en route, elle passe DERRIÈRE le
//     contenu de l'île ; arrivée, elle ne passe devant que si sa place ne
//     cache aucun texte (pickSpot, scene-path.ts).
//   - « Réduire les animations » : rien. « Calme », déplacements coupés
//     (réglage ondineWalk du module Animations de l'île) ou économie
//     d'énergie : un simple geste dans sa case. Île-bouche (island.style =
//     "mouth") : rien, sauf la scène 1 où elle croque le fichier retiré.
//     (Les règles : scene-rules.ts.)
//
// Qui déclenche quoi :
//   - les nouvelles du bus (presse-papiers, musique, minuteur, agents…) ;
//   - un attribut `data-scene="<id>"` sur un bouton d'un module (le clic
//     déclenche la scène ; on photographie la ligne avant qu'elle disparaisse) ;
//   - `mascot.scene {scene, …}` publié par un module (Notes, Règles) ou par le
//     mode démo (`demo: true` : la scène se joue sur le premier élément venu) ;
//   - l'île elle-même (onglets, dépôt de fichier, liquide, repos).
//
// Fournit aussi `mascot.look-at {x, y}` (elle regarde ce point de la fenêtre)
// et publie `mascot.walk {active}` quand elle quitte sa case ou y revient.

import type { Bus } from "../../core/bus";
import { logger } from "../../core/log";
import { perfMode } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { calmMode, type MascotController } from "../../mascot/mascot-state";
import { reducedMotion } from "../tab-pill";
import { crossing, intersects, pickSpot, progressFoot, type Pt, type Rect, type SpotMode } from "./scene-path";
import { dayKey, IDLE_STROLL_MS, isEvening, isLoud, islandStyle, isSceneId, progressOf, SCENES, SceneGaps, sceneMode, walkSetting, weatherKind, type IslandStateName, type SceneId, type SceneMode } from "./scene-rules";
import { Run, Walker, WALK_SCALE } from "./walker";

const log = logger("scenes");

export interface SceneHost {
  shell: HTMLElement;
  slot: HTMLElement;
  content: HTMLElement;
  bus: Bus;
  state(): IslandStateName;
  mascot(): MascotController | null;
  react(kind: "release" | "poke", data: { x?: number; y?: number; amount?: number }): void;
  /** Ouvre l'île sur un onglet (mode démo). */
  open(tab?: string): void;
}

/** L'onglet où se joue chaque scène (mode démo : on l'ouvre d'abord). */
const DEMO_TAB: Partial<Record<SceneId, string>> = {
  "shelf-remove": "shelf",
  "shelf-add": "shelf",
  sweep: "shelf",
  "note-delete": "notes",
  "note-save": "notes",
  "timer-sit": "timer",
  "timer-bell": "timer",
  "pomodoro-stretch": "timer",
  "media-next": "media",
  "clip-new": "clipboard",
  volume: "controls",
  "agent-done": "agents",
  "agent-wait": "agents",
  "launcher-search": "launcher",
  capture: "capture",
  "team-send": "team",
  "team-receive": "team",
  "rules-run": "rules",
};

/** Les objets qu'elle tient (emoji : ils suivent la police de l'appli, rien à charger). */
const PROPS = { lens: "🔍", camera: "📷", letter: "✉️", file: "📄", broom: "🧹", gear: "⚙️", bell: "🔔", stamp: "✓", bulb: "💡" } as const;

const STORE_DAY = "ondine.scenes.dayEnd";

/** Les gestes qui tournent en boucle : il faut la ramener au repos à la fin de la scène. */
const LOOPING = new Set(["sit-edge", "sleep", "pensive", "focus", "listening"]);

/** Une scène en train de se jouer : ses objets, son annulation. */
class Act {
  private props: HTMLElement[] = [];
  /** Elle a pris une pose qui tourne en boucle (assise, endormie, danse…). */
  looped = false;
  constructor(
    private readonly s: Scenes,
    readonly run: Run,
    readonly mode: SceneMode,
    readonly demo: boolean,
  ) {}

  get ok(): boolean {
    return !this.run.cancelled;
  }

  wait(ms: number): Promise<boolean> {
    return new Promise((resolve) => window.setTimeout(() => resolve(!this.run.cancelled), ms));
  }

  emote(emotion: string, extra: { side?: "left" | "right"; intensity?: number } = {}) {
    if (!this.ok) return;
    if (LOOPING.has(emotion)) this.looped = true;
    this.s.mascot()?.emoteNow({ emotion, ...extra });
  }

  playAnimation(name: string) {
    if (!this.ok) return;
    this.looped = true;
    this.s.mascot()?.playAnimation(name);
  }

  /** Va près de `target` (élément ou rectangle). Rend la place, ou null (annulée, rien trouvé). */
  async to(target: Element | Rect | null, mode: SpotMode = "beside", scale = WALK_SCALE) {
    if (!target || !this.ok) return null;
    const rect = target instanceof Element ? target.getBoundingClientRect() : target;
    const size = this.s.walker.slotSize() * scale;
    const spot = pickSpot(rect, size, size, this.s.bounds(), this.s.texts(), mode, this.s.walker.current());
    this.s.walker.setFront(false);
    const ok = await this.s.walker.hopTo(spot.foot, this.run, scale);
    if (!ok) return null;
    this.s.walker.setFront(spot.front);
    return spot;
  }

  /** Saute jusqu'à ce pied (derrière le contenu). */
  async hop(foot: Pt, scale = WALK_SCALE, speed = 1): Promise<boolean> {
    this.s.walker.setFront(false);
    return this.s.walker.hopTo(foot, this.run, scale, speed);
  }

  /** Un objet dans le calque des scènes (coordonnées de la fenêtre, centré). */
  prop(glyph: string, cls = "", at?: Pt): HTMLElement {
    const p = document.createElement("span");
    p.className = `ondine-prop ${cls}`.trim();
    p.textContent = glyph;
    p.setAttribute("aria-hidden", "true");
    this.s.layer.append(p);
    this.props.push(p);
    if (at) this.s.placeAt(p, at);
    return p;
  }

  /** Elle tient un objet à côté d'elle (il la suit). */
  hold(glyph: string, side = 1, cls = ""): HTMLElement {
    const p = this.prop(glyph, `held ${cls}`);
    this.s.walker.carry(p, side);
    return p;
  }

  drop() {
    this.s.walker.carry(null);
  }

  /** Garde un élément à retirer à la fin (un fantôme, un voile). */
  keep(el: HTMLElement) {
    this.props.push(el);
  }

  async home(): Promise<boolean> {
    return this.s.walker.goHome(this.run);
  }

  /** Retire ses objets (en fondu, sauf ceux qui s'en vont déjà tout seuls). */
  cleanup() {
    this.s.walker.carry(null);
    for (const p of this.props) {
      if (!p.isConnected) continue;
      if (reducedMotion()) p.remove();
      else p.animate([{ opacity: getComputedStyle(p).opacity }, { opacity: 0 }], { duration: 220, fill: "forwards" }).finished.then(() => p.remove(), () => p.remove());
    }
    this.props = [];
    this.s.mascot()?.setSceneExtras(null);
  }
}

export class Scenes {
  readonly walker: Walker;
  /** Le calque des objets et des fantômes, au-dessus du contenu, sans souris. */
  readonly layer: HTMLElement;
  private act: Act | null = null;
  private current: SceneId | null = null;
  /** Le retour à la maison après une interruption. */
  private homing: Run | null = null;
  private gaps = new SceneGaps();
  private gazeUntil = 0;
  private lastMove = Date.now();
  private lastPos = { x: -1, y: -1 };
  // Ce qu'on retient des nouvelles, pour voir ce qui change.
  private shelfNames: string[] | null = null;
  private clipCount: number | null = null;
  private trackKey = "";
  /** Les comptes à rebours qui tournent ("timer", "pomodoro"). */
  private running = new Set<string>();
  private progress = { value: 0, at: 0 };
  private weather: { kind: "rain" | "sun" | null; shown: boolean } = { kind: null, shown: true };
  private dropObserver: MutationObserver | null = null;
  private searchTimer = 0;

  constructor(private readonly h: SceneHost) {
    this.layer = document.createElement("div");
    this.layer.className = "ondine-scene-layer";
    this.layer.setAttribute("aria-hidden", "true");
    h.shell.append(this.layer);
    this.walker = new Walker({
      slot: h.slot,
      shell: h.shell,
      react: (kind, data) => h.react(kind, data),
      look: (p) => this.lookAt(p, 900),
      onAway: (active) => {
        h.shell.classList.toggle("ondine-walking", active);
        h.bus.emit("mascot.walk", { active });
      },
    });
    this.wireDom();
    this.wireBus();
    window.setInterval(() => this.idleCheck(), 5000);
    settingsStore.onChange(() => {
      if (!this.walkable()) this.interrupt(true);
    });
  }

  mascot(): MascotController | null {
    return this.h.mascot();
  }

  /** La mascotte regarde-t-elle un point imposé (mascot.look-at, sa route) ? L'île ne lui fait alors pas suivre la souris. */
  gazeHeld(): boolean {
    return performance.now() < this.gazeUntil;
  }

  /** La souris bouge (island.ts) : la promenade et la sieste du soir s'arrêtent. */
  pointer(x: number, y: number) {
    if (Math.abs(x - this.lastPos.x) < 2 && Math.abs(y - this.lastPos.y) < 2) return;
    this.lastPos = { x, y };
    this.lastMove = Date.now();
    if (this.current === "idle-stroll" || this.current === "day-end") this.interrupt();
  }

  /** L'île : son rectangle, un peu en retrait des bords arrondis. */
  bounds(): Rect {
    const r = this.h.shell.getBoundingClientRect();
    const inset = { x: 10, y: 4 };
    return { left: r.left + inset.x, top: r.top + inset.y, width: Math.max(0, r.width - inset.x * 2), height: Math.max(0, r.height - inset.y * 2) };
  }

  /** Les rectangles des textes affichés dans l'île (ce qu'on lit). */
  texts(): Rect[] {
    const out: Rect[] = [];
    const island = this.h.shell.getBoundingClientRect();
    const add = (r: DOMRect) => {
      if (r.width > 0 && r.height > 0 && intersects(r, island)) out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    const walk = document.createTreeWalker(this.h.content, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let n = 0;
    for (let node = walk.nextNode(); node && n < 600; node = walk.nextNode()) {
      if (!node.nodeValue?.trim()) continue;
      n++;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) add(r);
    }
    for (const f of this.h.content.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, img, svg")) add(f.getBoundingClientRect());
    return out;
  }

  /** Place un élément du calque, centré sur ce point de la fenêtre. */
  placeAt(el: HTMLElement, p: Pt) {
    const s = this.h.shell.getBoundingClientRect();
    el.style.left = `${(p.x - s.left).toFixed(1)}px`;
    el.style.top = `${(p.y - s.top).toFixed(1)}px`;
  }

  /** Elle regarde ce point de la fenêtre pendant `ms`. */
  lookAt(p: Pt, ms: number) {
    const m = this.h.mascot();
    if (!m) return;
    const r = this.h.slot.getBoundingClientRect();
    m.lookAt(p.x - (r.left + r.width / 2), p.y - (r.top + r.height / 2));
    this.gazeUntil = performance.now() + ms;
  }

  // ── Jouer, interrompre ─────────────────────────────────────────────────────

  private context(): Parameters<typeof sceneMode>[1] {
    const s = settingsStore.current;
    return {
      hasMascot: !!this.h.mascot() && this.h.slot.offsetWidth > 0,
      reduced: reducedMotion(),
      calm: calmMode(),
      walkOn: walkSetting(s.modules),
      mouth: islandStyle(s.island) === "mouth",
      eco: perfMode() === "eco",
      state: this.h.state(),
    };
  }

  modeOf(id: SceneId): SceneMode {
    return sceneMode(id, this.context());
  }

  /** Les déplacements sont-ils possibles en ce moment (pour une scène qui marche) ? */
  private walkable(): boolean {
    const c = this.context();
    return c.hasMascot && !c.reduced && c.walkOn && !c.calm && !c.mouth && !c.eco;
  }

  /**
   * Lance une scène : selon les règles, le simple geste, ou le script (qui
   * déplace Ondine), puis le retour à sa case. Une scène en cours est
   * remplacée (Ondine repart d'où elle est). Rend le mode joué.
   */
  play(id: SceneId, script: (a: Act) => Promise<void>, opts: { demo?: boolean } = {}): SceneMode {
    const mode = this.modeOf(id);
    if (mode === "off") return mode;
    const now = Date.now();
    if (!opts.demo && !this.gaps.ready(id, now)) return "off";
    this.gaps.mark(id, now);
    if (mode === "gesture") {
      const g = SCENES[id].gesture;
      if (g) this.h.mascot()?.emoteNow({ emotion: g });
      return mode;
    }
    this.stopCurrent();
    this.homing?.cancel();
    this.homing = null;
    const run = new Run();
    const act = new Act(this, run, mode, !!opts.demo);
    this.act = act;
    this.current = id;
    void (async () => {
      try {
        await script(act);
      } catch (err) {
        log.warn(`scène ${id} en erreur : ${String(err)}`);
      }
      if (this.act !== act) return; // une autre scène a pris la suite
      act.cleanup();
      this.act = null;
      this.current = null;
      if (run.cancelled) return;
      if (act.looped) this.h.mascot()?.settle();
      await this.walker.goHome(run);
    })();
    return mode;
  }

  /** Arrête la scène en cours sans la ramener (une autre scène prend la suite). */
  private stopCurrent(): boolean {
    if (!this.act) return false;
    const looped = this.act.looped;
    this.act.run.cancel();
    this.act.cleanup();
    this.act = null;
    this.current = null;
    return looped;
  }

  /**
   * Un clic, un autre geste, un changement d'état : la scène s'arrête et
   * Ondine revient (d'un coup si `snap`, ou si l'île ne permet plus de marcher).
   */
  interrupt(snap = false) {
    if (this.stopCurrent()) this.h.mascot()?.settle();
    if (!this.walker.away) return;
    if (snap || this.h.state() === "hidden" || this.h.state() === "peek" || reducedMotion()) {
      this.homing?.cancel();
      this.homing = null;
      this.walker.snapHome();
      return;
    }
    if (this.homing) return;
    const run = new Run();
    this.homing = run;
    void this.walker.goHome(run, 1.8).then(() => {
      if (this.homing === run) this.homing = null;
    });
  }

  // ── Trouver les éléments ───────────────────────────────────────────────────

  /** La vue de l'onglet ouvert (pas celle qui s'efface). */
  private view(): HTMLElement | null {
    return this.h.content.querySelector<HTMLElement>(".view-expanded:not(.leaving)");
  }

  /** L'élément est-il visible dans l'île (et dans la zone qui défile) ? */
  private visible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const view = el.closest(".view-expanded")?.getBoundingClientRect() ?? this.h.shell.getBoundingClientRect();
    return r.bottom > view.top + 4 && r.top < view.bottom - 4 && r.right > view.left && r.left < view.right;
  }

  /** Le premier élément visible pour ces sélecteurs, dans la vue ouverte (ou tout le contenu). */
  private find(selectors: string, within: ParentNode | null = this.view(), match?: (el: HTMLElement) => boolean): HTMLElement | null {
    if (!within) return null;
    const all = [...within.querySelectorAll<HTMLElement>(selectors)].filter((e) => this.visible(e));
    return (match ? all.find(match) : undefined) ?? all[0] ?? null;
  }

  /** Une copie de `el` posée au même endroit dans le calque (la vraie ligne va disparaître). */
  private ghost(el: HTMLElement): HTMLElement {
    const r = el.getBoundingClientRect();
    const s = this.h.shell.getBoundingClientRect();
    const copy = el.cloneNode(true) as HTMLElement;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) (copy as HTMLTextAreaElement).value = el.value;
    copy.removeAttribute("id");
    // Un parent de même classe : la copie garde le style de sa liste.
    const parent = el.parentElement;
    const box = document.createElement(parent?.tagName === "UL" || parent?.tagName === "OL" ? parent.tagName.toLowerCase() : "div");
    if (parent) box.className = parent.className;
    box.classList.add("ondine-ghost");
    Object.assign(box.style, { left: `${r.left - s.left}px`, top: `${r.top - s.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.append(copy);
    this.layer.append(box);
    return box;
  }

  private rectOf(el: HTMLElement): Rect {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // ── Les déclencheurs ───────────────────────────────────────────────────────

  private wireDom() {
    const shell = this.h.shell;
    // Un appui dans l'île la ramène (sauf sur un déclencheur, qui lance sa propre scène).
    shell.addEventListener(
      "pointerdown",
      (e) => {
        this.lastMove = Date.now();
        const t = e.target as HTMLElement;
        if (t.closest("[data-scene], .tabs .tab")) return;
        if (this.act || this.walker.away) this.interrupt();
      },
      true,
    );
    shell.addEventListener(
      "click",
      (e) => {
        const t = e.target as HTMLElement;
        const trigger = t.closest<HTMLElement>("[data-scene]");
        if (trigger && shell.contains(trigger)) this.onTrigger(trigger);
        const tab = t.closest<HTMLElement>(".tabs .tab");
        if (tab && !tab.classList.contains("active")) this.tabHop(tab);
      },
      true,
    );
    shell.addEventListener(
      "input",
      (e) => {
        const t = e.target as HTMLElement;
        if (!t.matches?.(".launch-search")) return;
        window.clearTimeout(this.searchTimer);
        const q = (t as HTMLInputElement).value.trim();
        if (q.length < 2) return;
        this.searchTimer = window.setTimeout(() => this.launcherSearch(), 450);
      },
      true,
    );
    shell.addEventListener(
      "pointerup",
      (e) => {
        const pill = (e.target as HTMLElement).closest?.<HTMLElement>(".ctl-pill");
        if (!pill) return;
        const v = Number(pill.getAttribute("aria-valuenow"));
        window.setTimeout(() => this.volume(Number.isFinite(v) ? v : 50, false, pill), 60);
      },
      true,
    );
    // Le liquide remplit l'île (liquid.ts : classe « liquid-float ») : elle nage.
    let floating = shell.classList.contains("liquid-float");
    new MutationObserver(() => {
      const on = shell.classList.contains("liquid-float");
      if (on && !floating && this.current !== "liquid-swim") this.swim();
      floating = on;
    }).observe(shell, { attributes: true, attributeFilter: ["class"] });
  }

  /** Un bouton marqué `data-scene` vient d'être cliqué. */
  private onTrigger(b: HTMLElement) {
    const id = b.dataset.scene;
    if (id === "shelf-remove") {
      const row = b.closest<HTMLElement>(".shelf-item");
      if (row) this.shelfRemove(row);
    } else if (id === "note-delete") {
      const row = b.closest<HTMLElement>(".todo-item") ?? this.find(".note-editor");
      if (row) this.noteDelete(row);
    }
  }

  private wireBus() {
    const on = (topic: string, fn: (p: any) => void) => this.h.bus.on(topic, (m) => fn(m.payload), "scenes");
    on("mascot.look-at", (p: { x?: unknown; y?: unknown } | null) => {
      if (typeof p?.x === "number" && typeof p?.y === "number") this.lookAt({ x: p.x, y: p.y }, 1500);
    });
    on("mascot.clicked", () => this.interrupt());
    on("mascot.scene", (p: { scene?: unknown; demo?: boolean; name?: string } | null) => {
      if (!isSceneId(p?.scene)) return;
      if (p?.demo) this.demo(p.scene, p);
      else this.fromModule(p.scene, p);
    });
    on("island.state", (p: { from?: IslandStateName; to?: IslandStateName } | null) => this.onState(p?.from, p?.to));
    on("shelf.changed", (p: { items?: { name?: string }[] } | null) => {
      const names = (p?.items ?? []).map((i) => String(i.name ?? ""));
      const before = this.shelfNames;
      this.shelfNames = names;
      if (!before) return;
      const added = names.filter((n) => !before.includes(n));
      if (added.length && names.length > before.length) window.setTimeout(() => this.shelfAdd(added[added.length - 1]), 80);
      else if (!names.length && before.length > 1) this.sweep("shelf");
    });
    on("clipboard.changed", (p: { count?: number } | null) => {
      const count = typeof p?.count === "number" ? p.count : null;
      const before = this.clipCount;
      this.clipCount = count;
      if (count === null || before === null) return;
      if (count > before) window.setTimeout(() => this.clipNew(), 250);
      // « Vider » garde les lignes épinglées : plusieurs lignes parties d'un coup.
      else if (before - count >= 2) this.sweep("clipboard");
    });
    // Historique plein : le nombre ne bouge plus, mais Animations de l'île signale chaque copie.
    on("halos.clip", (p: { action?: string } | null) => {
      if (p?.action === "copy") window.setTimeout(() => this.clipNew(), 250);
    });
    on("timer.progress", (p: { id?: string; phase?: string; state?: string } | null) => {
      const running = p?.state === "running";
      if (running) this.running.add(p?.id ?? "timer");
      else this.running.delete(p?.id ?? "timer");
      if (running && (p?.phase === "short" || p?.phase === "long")) this.pomodoroStretch();
      else if (running && this.current !== "timer-sit") this.timerSit();
      if (!this.running.size && this.current === "timer-sit") this.interrupt();
    });
    on("timer.done", () => this.timerBell());
    on("media.changed", (p: { playing?: { title?: string; artist?: string } | null } | null) => {
      const key = p?.playing ? `${p.playing.title ?? ""}|${p.playing.artist ?? ""}` : "";
      const before = this.trackKey;
      this.trackKey = key;
      if (before && key && key !== before) this.mediaNext();
    });
    on("halos.volume", (p: { volume?: number; muted?: boolean } | null) => this.volume(p?.volume ?? 0, p?.muted === true));
    on("agents.event", (p: { kind?: string; project?: string } | null) => {
      if (p?.kind === "done" || p?.kind === "waiting") this.agent(p.kind === "done" ? "agent-done" : "agent-wait", p.project ?? "");
    });
    on("capture.done", (p: { ok?: boolean } | null) => p?.ok && this.capture());
    on("team.event", (p: { kind?: string; from?: { name?: string }; name?: string } | null) => {
      if (p?.kind === "sent" || p?.kind === "received") this.team(p.kind === "sent" ? "team-send" : "team-receive", p.from?.name ?? "");
    });
    for (const topic of ["shelf.hash-progress", "team.progress", "agents.progress"]) {
      on(topic, (p) => {
        const f = progressOf(p);
        if (f !== null) this.onProgress(f);
      });
    }
    on("weather.updated", (p: { icon?: string } | null) => {
      const kind = weatherKind(p?.icon);
      if (kind !== this.weather.kind) this.weather = { kind, shown: false };
      if (this.h.state() === "expanded") this.weatherScene();
    });
  }

  /** `mascot.scene` publié par un module (Notes, Règles). */
  private fromModule(id: SceneId, p: { name?: string }) {
    if (id === "note-save") window.setTimeout(() => this.noteSave(), 120);
    else if (id === "rules-run") this.rulesRun(String(p.name ?? ""));
  }

  private onState(from: IslandStateName | undefined, to: IslandStateName | undefined) {
    if (!to) return;
    // L'île change d'état : la scène en cours s'arrête (sauf l'ouverture qu'on va jouer).
    if (this.act || this.walker.away) this.interrupt(true);
    this.watchDrops(to === "drop");
    if (to === "expanded" && this.h.shell.classList.contains("liquid-float")) return this.swim();
    if (to === "expanded" && (from === "compact" || from === "peek")) {
      if (this.dayEnd()) return;
      if (this.weatherScene()) return;
      this.islandOpen();
    }
    if (to === "alert") window.setTimeout(() => this.banner(), 60);
  }

  // ── Les scènes ─────────────────────────────────────────────────────────────

  /** (1) Retirer de l'étagère : elle pousse le fichier hors de l'île, il tombe. Île-bouche : elle le croque. */
  private shelfRemove(row: HTMLElement, demo = false) {
    const mode = this.modeOf("shelf-remove");
    if (mode !== "walk" && mode !== "crunch") return void this.play("shelf-remove", async () => {}, { demo });
    const ghost = this.ghost(row);
    const rect = this.rectOf(row);
    const played = this.play("shelf-remove", async (a) => {
      a.keep(ghost);
      if (demo) this.hideWhile(row, a);
      if (a.mode === "crunch") {
        const m = this.h.slot.getBoundingClientRect();
        const dx = m.left + m.width / 2 - (rect.left + rect.width / 2);
        const dy = m.top + m.height / 2 - (rect.top + rect.height / 2);
        a.emote("eating");
        await ghost.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0.2 }], { duration: 520, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" }).finished.catch(() => {});
        ghost.remove();
        await a.wait(600);
        return;
      }
      if (!(await a.to(rect, "left"))) return;
      a.emote("push");
      if (!(await a.wait(420))) return;
      const fall = Math.max(160, this.h.shell.getBoundingClientRect().bottom - rect.top + 40);
      ghost.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translateX(${rect.width * 0.35}px) rotate(4deg)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${rect.width * 0.55}px, ${fall}px) rotate(28deg)`, opacity: 0.6 },
        ],
        { duration: 950, easing: "cubic-bezier(0.45, 0, 0.8, 0.6)", fill: "forwards" },
      );
      await a.wait(1000);
    }, { demo });
    if (played !== "walk" && played !== "crunch") ghost.remove();
  }

  /** Mode démo : la vraie ligne ne disparaît pas (rien n'est retiré pour de vrai) ; on la cache le temps de la scène. */
  private hideWhile(row: HTMLElement, a: Act) {
    row.style.visibility = "hidden";
    const back = () => (row.style.visibility = "");
    void (async () => {
      while (a.ok && this.act === a) await a.wait(300);
      window.setTimeout(back, 400);
    })();
  }

  /** (1) Un fichier arrive sur l'étagère : elle le rattrape et le pose. */
  private shelfAdd(name: string, demo = false) {
    this.play(
      "shelf-add",
      async (a) => {
        const row = this.find(".shelf-item", undefined, (e) => e.querySelector(".shelf-name")?.textContent === name);
        if (!row) return;
        const spot = await a.to(row, "beside");
        if (!spot) return;
        a.emote("cheer");
        row.animate([{ transform: "translateY(-26px)", opacity: 0.3 }, { transform: "translateY(3px)", opacity: 1, offset: 0.7 }, { transform: "none", opacity: 1 }], { duration: 520, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" });
        await a.wait(1100);
      },
      { demo },
    );
  }

  /** (2) Supprimer une note ou une tâche : elle la froisse en boule et la lance. */
  private noteDelete(row: HTMLElement, demo = false) {
    if (this.modeOf("note-delete") !== "walk") return void this.play("note-delete", async () => {}, { demo });
    const ghost = this.ghost(row);
    const rect = this.rectOf(row);
    const played = this.play(
      "note-delete",
      async (a) => {
        a.keep(ghost);
        if (demo) this.hideWhile(row, a);
        if (!(await a.to(rect, "beside"))) return;
        a.emote("push");
        const toLeft = this.walker.current().x > rect.left + rect.width / 2;
        await ghost.animate(
          [
            { transform: "none", borderRadius: "8px", opacity: 1 },
            { transform: "scale(0.5, 0.4) rotate(-12deg)", borderRadius: "40%", opacity: 0.9, offset: 0.6 },
            { transform: "scale(0.12) rotate(-40deg)", borderRadius: "50%", opacity: 0.9 },
          ],
          { duration: 480, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", fill: "forwards" },
        ).finished.catch(() => {});
        if (!a.ok) return;
        const dx = (toLeft ? -1 : 1) * Math.max(140, rect.width * 0.7);
        ghost.animate(
          [
            { transform: "scale(0.12) rotate(-40deg)", opacity: 0.9 },
            { transform: `translate(${dx * 0.5}px, -40px) scale(0.12) rotate(120deg)`, opacity: 0.9, offset: 0.4 },
            { transform: `translate(${dx}px, 160px) scale(0.12) rotate(300deg)`, opacity: 0 },
          ],
          { duration: 800, easing: "linear", fill: "forwards" },
        );
        await a.wait(850);
      },
      { demo },
    );
    if (played !== "walk") ghost.remove();
  }

  /** (2) Une note enregistrée (on revient à la liste) : elle la tamponne. */
  private noteSave(demo = false) {
    this.play(
      "note-save",
      async (a) => {
        const card = this.find(".note-card, .note-editor") ?? (demo ? this.find(".todo-item") : null);
        if (!card) return;
        if (!(await a.to(card, "beside"))) return;
        a.emote("tap-glass");
        await a.wait(380);
        const r = card.getBoundingClientRect();
        const stamp = a.prop(PROPS.stamp, "stamp", { x: r.right - 16, y: r.top + 14 });
        stamp.animate([{ transform: "translate(-50%, -50%) scale(2.2) rotate(-18deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1) rotate(-12deg)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.3, 1.5, 0.5, 1)", fill: "forwards" });
        await a.wait(1300);
      },
      { demo },
    );
  }

  /** (3) Le minuteur tourne : elle s'assoit sur l'anneau qui se vide, tant qu'il tourne. */
  private timerSit(demo = false) {
    this.play(
      "timer-sit",
      async (a) => {
        const ring = this.find(".timer-ring");
        if (!ring) return;
        if (!(await a.to(ring, "on", 0.5))) return;
        a.emote("sit-edge");
        const until = demo ? Date.now() + 5000 : Infinity;
        while (a.ok && (demo ? Date.now() < until : this.running.size > 0) && this.find(".timer-ring")) await a.wait(500);
      },
      { demo },
    );
  }

  /** (3) Fin du minuteur : une petite cloche. */
  private timerBell(demo = false) {
    this.play(
      "timer-bell",
      async (a) => {
        const ring = this.find(".timer-ring");
        if (!ring) return;
        if (!(await a.to(ring, "beside"))) return;
        a.hold(PROPS.bell, 1, "swing");
        a.emote("cheer");
        await a.wait(1800);
      },
      { demo },
    );
  }

  /** (4) Une autre piste : elle appuie du pied sur « suivant », puis danse sur la pochette. */
  private mediaNext(demo = false) {
    this.play(
      "media-next",
      async (a) => {
        const view = this.view();
        if (!view?.querySelector(".media-cover")) return;
        const next = this.find('[data-scene-target="media-next"]', view);
        if (next) {
          if (!(await a.to(next, "on", 0.5))) return;
          a.emote("tap-glass");
          next.animate([{ transform: "none" }, { transform: "translateY(2px) scale(0.92)" }, { transform: "none" }], { duration: 260 });
          if (!(await a.wait(600))) return;
        }
        const cover = this.find(".media-cover", view);
        if (!cover || !(await a.to(cover, "on", 0.5))) return;
        a.playAnimation("danse");
        await a.wait(2600);
      },
      { demo },
    );
  }

  /** (5) Une copie : elle attrape la nouvelle ligne et la range en haut de l'historique. */
  private clipNew(demo = false) {
    this.play(
      "clip-new",
      async (a) => {
        const row = this.find(".clip-list > li");
        if (!row) return;
        if (!(await a.to(row, "left"))) return;
        a.emote("push", { side: "right" });
        row.animate([{ transform: "translateY(-14px) scale(0.96)", opacity: 0.4 }, { transform: "translateY(2px)", opacity: 1, offset: 0.7 }, { transform: "none", opacity: 1 }], { duration: 480, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" });
        await a.wait(1000);
      },
      { demo },
    );
  }

  /** (6) Le volume change : elle grimpe sur le curseur ; fort, elle se bouche les oreilles. */
  private volume(volume: number, muted: boolean, pill?: HTMLElement, demo = false) {
    const loud = isLoud(volume, muted);
    this.play(
      "volume",
      async (a) => {
        const target = pill && this.visible(pill) ? pill : this.find(".ctl-pill");
        if (target && (await a.to(target, "beside", 0.55))) a.emote("climb");
        else if (!target && !loud) return;
        if (loud) {
          await a.wait(target ? 700 : 0);
          this.h.mascot()?.setSceneExtras({ ears: true });
        }
        await a.wait(1500);
      },
      { demo },
    );
  }

  /** (7) Un agent a fini (elle tape sur sa carte) ou attend (elle agite le bras à côté). */
  private agent(id: "agent-done" | "agent-wait", project: string, demo = false) {
    this.play(
      id,
      async (a) => {
        const card = this.find(".agents-session", undefined, (e) => !!project && (e.textContent ?? "").includes(project));
        if (!card) return;
        if (!(await a.to(card, "beside"))) return;
        a.emote(id === "agent-done" ? "tap-glass" : "wave");
        await a.wait(id === "agent-done" ? 1600 : 2200);
      },
      { demo },
    );
  }

  /** (8) Recherche du Lanceur : elle fouille à la loupe, puis apporte le premier résultat. */
  private launcherSearch(demo = false) {
    this.play(
      "launcher-search",
      async (a) => {
        const first = this.find(".launch-item");
        if (!first) return;
        a.hold(PROPS.lens, 1, "wobble");
        if (!(await a.to(first, "right"))) return;
        a.emote("pensive");
        if (!(await a.wait(900))) return;
        a.drop();
        a.emote("push", { side: "left" });
        first.animate([{ transform: "none" }, { transform: "translateX(-6px) scale(1.02)" }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" });
        await a.wait(900);
      },
      { demo },
    );
  }

  /** (9) Capture : elle tient l'appareil photo, flash au déclenchement. */
  private capture(demo = false) {
    const flash = () => {
      const f = document.createElement("div");
      f.className = "ondine-flash";
      this.layer.append(f);
      f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 420, easing: "ease-out" }).finished.then(() => f.remove(), () => f.remove());
    };
    const mode = this.play(
      "capture",
      async (a) => {
        const spot = this.find(".capture-result, .capture-actions");
        if (spot && !(await a.to(spot, "beside"))) return;
        a.hold(PROPS.camera, 1);
        if (!(await a.wait(350))) return;
        flash();
        a.emote("proud");
        await a.wait(1400);
      },
      { demo },
    );
    if (mode === "gesture") flash();
  }

  /** (10) Équipe : elle porte la lettre jusqu'au collègue, ou traîne le fichier reçu jusqu'à vous. */
  private team(id: "team-send" | "team-receive", who: string, demo = false) {
    this.play(
      id,
      async (a) => {
        const peer = this.find(".team-peer", undefined, (e) => !!who && e.querySelector(".team-peer-name")?.textContent === who);
        if (!peer) return;
        if (id === "team-send") {
          a.hold(PROPS.letter, 1);
          if (!(await a.to(peer, "beside"))) return;
          a.drop();
          a.emote("wave");
          await a.wait(1300);
          return;
        }
        if (!(await a.to(peer, "beside"))) return;
        a.hold(PROPS.file, -1, "drag");
        if (!(await a.wait(300))) return;
        if (!(await a.home())) return;
        a.drop();
        a.emote("happy");
        await a.wait(800);
      },
      { demo },
    );
  }

  /** (11) Changer d'onglet : elle saute d'icône en icône jusqu'au nouvel onglet. */
  private tabHop(target: HTMLElement, demo = false) {
    this.play(
      "tab-hop",
      async (a) => {
        const tabs = [...(target.parentElement?.querySelectorAll<HTMLElement>(":scope > .tab") ?? [])];
        const from = tabs.findIndex((t) => t.classList.contains("active"));
        const to = tabs.indexOf(target);
        if (to < 0) return;
        const start = from < 0 ? to : from;
        const step = to >= start ? 1 : -1;
        const scale = 0.42;
        // Beaucoup d'onglets à traverser : elle saute plus vite (moins de 2 s en tout).
        const speed = Math.max(1.25, Math.abs(to - start) / 5);
        for (let i = start; a.ok; i += step) {
          const ic = tabs[i].querySelector<HTMLElement>(".tab-icon") ?? tabs[i];
          const r = ic.getBoundingClientRect();
          const size = this.walker.slotSize() * scale;
          // Sur l'icône (pas sur le nom de l'onglet), un peu au-dessus de son centre.
          if (!(await a.hop({ x: r.left + r.width / 2, y: Math.max(this.bounds().top + size, r.top + r.height * 0.7) }, scale, speed))) return;
          this.walker.setFront(true);
          if (i === to) break;
        }
        a.emote("happy");
        await a.wait(500);
      },
      { demo },
    );
  }

  /** (12) Une règle s'exécute : elle tourne une manivelle à côté de la ligne. */
  private rulesRun(name: string, demo = false) {
    this.play(
      "rules-run",
      async (a) => {
        const row = this.find(".rule-row", undefined, (e) => !!name && e.querySelector("b")?.textContent === name);
        if (!row) return;
        if (!(await a.to(row, "right"))) return;
        a.hold(PROPS.gear, -1, "spin");
        a.emote("focus");
        await a.wait(1800);
      },
      { demo },
    );
  }

  /** (13) L'île s'ouvre : elle pousse les bords depuis le milieu, puis va à sa place. */
  private islandOpen(demo = false) {
    this.play(
      "island-open",
      async (a) => {
        const s = this.h.shell.getBoundingClientRect();
        this.walker.place({ x: s.left + s.width / 2, y: s.top + s.height - 4 }, 0.55);
        a.emote("push", { side: "left" });
        if (!(await a.wait(450))) return;
        a.emote("push", { side: "right" });
        await a.wait(450);
      },
      { demo },
    );
  }

  /** (14) Une progression (empreinte, envoi à un collègue, étapes d'un agent) : sa course est la barre. */
  private onProgress(f: number) {
    this.progress = { value: f, at: Date.now() };
    if (this.current === "progress") return;
    if (f >= 1) return;
    this.play("progress", async (a) => {
      const size = () => this.walker.slotSize() * 0.5;
      while (a.ok) {
        const age = Date.now() - this.progress.at;
        if (age > 4000) return;
        const goal = progressFoot(this.bounds(), size(), this.progress.value);
        const here = this.walker.current();
        if (!this.walker.away || Math.abs(goal.x - here.x) > 3) {
          if (!this.walker.away) await a.hop(goal, 0.5);
          else await this.walker.glideTo(goal, 380, a.run, 2.5);
        } else await a.wait(200);
        if (this.progress.value >= 1) {
          a.emote("cheer");
          await a.wait(1200);
          return;
        }
      }
    });
  }

  /** (15) Un fichier glissé sur l'île : elle court sous la cible visée, bras ouverts. */
  private watchDrops(on: boolean) {
    this.dropObserver?.disconnect();
    this.dropObserver = null;
    if (!on) return;
    let last: Element | null = null;
    this.dropObserver = new MutationObserver(() => {
      const hover = this.h.content.querySelector<HTMLElement>(".drop-target.hover");
      if (!hover || hover === last) return;
      last = hover;
      this.play("drop-catch", async (a) => {
        if (!(await a.to(hover, "beside"))) return;
        a.emote("cheer");
        while (a.ok && hover.classList.contains("hover")) await a.wait(300);
      });
    });
    this.dropObserver.observe(this.h.content, { attributes: true, subtree: true, attributeFilter: ["class"] });
  }

  /** (16) Ménage (étagère ou presse-papiers vidés) : un coup de balai sur toute la largeur. */
  private sweep(tab: string, demo = false) {
    this.play(
      "sweep",
      async (a) => {
        if (!demo && !this.h.content.querySelector(`#tab-${tab}.active`)) return;
        const size = this.walker.slotSize() * 0.55;
        const path = crossing(this.bounds(), size, true);
        if (!(await a.hop(path[0], 0.55))) return;
        a.hold(PROPS.broom, 1, "sweep");
        for (const p of path.slice(1)) if (!(await a.hop(p, 0.55, 1.4))) return;
        a.drop();
        a.emote("proud");
        await a.wait(900);
      },
      { demo },
    );
  }

  /** (17) Une notification importante : elle tire la bannière depuis le bord, comme une banderole. */
  private banner() {
    if (this.h.state() !== "alert") return;
    this.play("banner", async (a) => {
      const card = this.h.content.querySelector<HTMLElement>(".notif.big");
      if (!card) return;
      // L'île finit de prendre sa taille d'alerte ; la bannière reste roulée en attendant.
      const settle = 320;
      const ms = 750;
      card.animate([{ clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0)" }], { duration: ms, delay: settle, easing: "ease-in-out", fill: "backwards" });
      if (!(await a.wait(settle))) return;
      const b = this.bounds();
      const size = this.walker.slotSize() * 0.5;
      this.walker.place({ x: b.left + b.width - size / 2, y: this.walker.homeFoot().y }, 0.5);
      this.walker.setFront(false);
      a.emote("push", { side: "left" });
      await this.walker.glideTo(() => this.walker.homeFoot(), ms, a.run, 1.5);
    });
  }

  /** (18) L'île ouverte au repos : elle se promène, s'assoit à côté d'un bouton, regarde une icône, bâille. */
  private idleCheck() {
    if (this.act || this.h.state() !== "expanded") return;
    if (Date.now() - this.lastMove < IDLE_STROLL_MS) return;
    this.idleStroll();
  }

  private idleStroll(demo = false) {
    this.play(
      "idle-stroll",
      async (a) => {
        const view = this.view();
        const buttons = view ? [...view.querySelectorAll<HTMLElement>("button")].filter((b) => this.visible(b)) : [];
        const seat = buttons[Math.floor(Math.random() * buttons.length)];
        if (!seat || !(await a.to(seat, "beside", 0.55))) return;
        a.emote("sit-edge");
        if (!(await a.wait(2200))) return;
        const icons = [...this.h.content.querySelectorAll<HTMLElement>(".tab-icon")];
        const ic = icons[Math.floor(Math.random() * icons.length)];
        if (ic) {
          const r = ic.getBoundingClientRect();
          this.lookAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 1600);
          if (!(await a.wait(1600))) return;
        }
        a.emote("yawn");
        await a.wait(2600);
      },
      { demo },
    );
  }

  /** (19) Pause du Pomodoro : ses étirements d'un bord à l'autre. */
  private pomodoroStretch(demo = false) {
    this.play(
      "pomodoro-stretch",
      async (a) => {
        const size = this.walker.slotSize() * 0.55;
        const path = crossing(this.bounds(), size, true);
        const first = path[0];
        const last = path[path.length - 1];
        if (!(await a.hop(first, 0.55))) return;
        a.emote("stretch");
        if (!(await a.wait(1600))) return;
        if (!(await a.hop(last, 0.55, 0.9))) return;
        a.emote("stretch", { side: "left" });
        await a.wait(1600);
      },
      { demo },
    );
  }

  /** (20) L'île remplie de liquide : elle nage d'un bord à l'autre tant qu'elle flotte. */
  private swim(demo = false) {
    this.play(
      "liquid-swim",
      async (a) => {
        const size = this.walker.slotSize() * 0.55;
        const until = demo ? Date.now() + 9000 : Infinity;
        let ltr = true;
        if (!(await a.hop(crossing(this.bounds(), size, true)[0], 0.55))) return;
        while (a.ok && (demo ? Date.now() < until : this.h.shell.classList.contains("liquid-float"))) {
          const path = crossing(this.bounds(), size, ltr);
          const end = path[path.length - 1];
          if (!(await this.walker.glideTo({ x: end.x, y: end.y - 8 }, 2800, a.run, 3))) return;
          ltr = !ltr;
        }
      },
      { demo },
    );
  }

  /** (21) Météo : sous son parapluie quand il pleut, elle s'éponge au soleil. Une fois par changement. */
  private weatherScene(demo?: "rain" | "sun"): boolean {
    const kind = demo ?? this.weather.kind;
    if (!kind || (!demo && this.weather.shown)) return false;
    const mode = this.play(
      "weather",
      async (a) => {
        // Jouée à l'ouverture : on laisse l'île prendre sa taille.
        if (!(await a.wait(450))) return;
        const size = this.walker.slotSize() * 0.55;
        if (kind === "rain") {
          this.h.mascot()?.setSceneExtras({ umbrella: true });
          const path = crossing(this.bounds(), size, true);
          if (!(await a.hop(path[0], 0.55))) return;
          for (const p of path.slice(1)) if (!(await a.hop(p, 0.55, 0.8))) return;
          await a.wait(400);
          return;
        }
        const b = this.bounds();
        if (!(await a.hop({ x: b.left + b.width / 2, y: b.top + b.height }, 0.55))) return;
        a.emote("relieved");
        await a.wait(2400);
      },
      { demo: !!demo },
    );
    if (mode !== "off" && !demo) this.weather.shown = true;
    return mode === "walk";
  }

  /** (22) Fin de journée : elle tire un interrupteur, l'île s'assombrit, elle s'endort dans un coin. Une fois par jour. */
  private dayEnd(demo = false): boolean {
    const now = new Date();
    const leave = settingsStore.current.modules?.halos?.values?.leaveTime;
    if (!demo) {
      if (!isEvening(now, leave)) return false;
      let seen = "";
      try {
        seen = localStorage.getItem(STORE_DAY) ?? "";
      } catch {
        /* stockage indisponible : la scène peut revenir */
      }
      if (seen === dayKey(now)) return false;
    }
    const mode = this.play(
      "day-end",
      async (a) => {
        if (!(await a.wait(450))) return;
        const b = this.bounds();
        const size = this.walker.slotSize() * 0.55;
        const corner = { x: b.left + b.width - size / 2, y: b.top + b.height };
        if (!(await a.hop(corner, 0.55))) return;
        const bulb = a.prop(PROPS.bulb, "switch", { x: corner.x - size * 0.3, y: corner.y - size * 1.4 });
        a.emote("push", { side: "right" });
        if (!(await a.wait(500))) return;
        bulb.animate([{ transform: "translate(-50%, -50%)" }, { transform: "translate(-50%, -30%)" }, { transform: "translate(-50%, -50%)" }], { duration: 260 });
        const dusk = document.createElement("div");
        dusk.className = "ondine-dusk";
        this.layer.prepend(dusk);
        a.keep(dusk);
        dusk.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1600, easing: "ease-in-out", fill: "forwards" });
        if (!(await a.wait(900))) return;
        a.emote("sleep");
        await a.wait(demo ? 5000 : 20_000);
      },
      { demo },
    );
    if (mode !== "off" && !demo) {
      try {
        localStorage.setItem(STORE_DAY, dayKey(now));
      } catch {
        /* rien */
      }
    }
    return mode === "walk";
  }

  // ── Mode démo ──────────────────────────────────────────────────────────────

  /** Joue une scène pour la vidéo (src/core/demo.ts) : l'onglet s'ouvre, la scène se joue sur le premier élément venu. */
  private demo(id: SceneId, p: { name?: string; kind?: string }) {
    const tab = DEMO_TAB[id];
    const opening = this.h.state() !== "expanded";
    if (tab || opening) this.h.open(tab);
    window.setTimeout(() => {
      const first = (sel: string) => this.find(sel);
      switch (id) {
        case "shelf-remove": {
          const row = first(".shelf-item");
          if (row) this.shelfRemove(row, true);
          break;
        }
        case "shelf-add":
          this.shelfAdd(first(".shelf-item:last-child .shelf-name")?.textContent ?? "", true);
          break;
        case "note-delete": {
          const row = first(".todo-item, .note-card");
          if (row) this.noteDelete(row, true);
          break;
        }
        case "note-save":
          return this.noteSave(true);
        case "timer-sit":
          return this.timerSit(true);
        case "timer-bell":
          return this.timerBell(true);
        case "media-next":
          return this.mediaNext(true);
        case "clip-new":
          return this.clipNew(true);
        case "volume":
          return this.volume(90, false, undefined, true);
        case "agent-done":
        case "agent-wait":
          return this.agent(id, first(".agents-session")?.textContent ?? "", true);
        case "launcher-search":
          return this.launcherSearch(true);
        case "capture":
          return this.capture(true);
        case "team-send":
        case "team-receive":
          return this.team(id, first(".team-peer-name")?.textContent ?? "", true);
        case "tab-hop": {
          const tabs = [...this.h.content.querySelectorAll<HTMLElement>(".tabs .tab")];
          const target = tabs[tabs.length - 1];
          // Le clic passe par l'écoute des onglets (wireDom) : la scène part de là.
          if (target && !target.classList.contains("active")) target.click();
          break;
        }
        case "rules-run":
          return this.rulesRun(first(".rule-row b")?.textContent ?? "", true);
        case "island-open":
          return this.islandOpen(true);
        case "progress":
          return this.demoProgress();
        case "drop-catch":
          // Il faut un vrai glisser de fichier (l'île passe en mode dépôt).
          break;
        case "sweep":
          return this.sweep("shelf", true);
        case "banner":
          // Une alerte inventée (priorité haute) : l'île passe en alerte, la scène suit.
          this.h.bus.inject("agents.event", { at: Date.now(), source: "claude-code", kind: "waiting", title: "Claude attend votre permission", body: "npm run build", project: "site-ondine" }, "demo");
          break;
        case "idle-stroll":
          return this.idleStroll(true);
        case "pomodoro-stretch":
          return this.pomodoroStretch(true);
        case "liquid-swim":
          return this.swim(true);
        case "weather":
          this.weatherScene(p.kind === "sun" ? "sun" : "rain");
          break;
        case "day-end":
          this.dayEnd(true);
          break;
      }
    }, tab || opening ? 650 : 150);
  }

  /** Une progression inventée de 0 à 100 % en 5 s. */
  private demoProgress() {
    const t0 = Date.now();
    const tick = () => {
      const f = Math.min(1, (Date.now() - t0) / 5000);
      this.onProgress(f);
      if (f < 1) window.setTimeout(tick, 250);
    };
    tick();
  }
}

/** Branche les scènes sur l'île (island.ts). */
export function attachScenes(host: SceneHost): Scenes {
  return new Scenes(host);
}
