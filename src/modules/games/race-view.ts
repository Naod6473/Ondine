// Course de gouttes : le suivi des listes de tâches des agents (RaceTracker,
// lancé au démarrage du module : la course avance même onglet fermé) et la
// vue de la course dans l'onglet Jeux.
//
// D'où vient la progression : « agents.todos » {session, done, total} du
// module Agents IA (la barre « 3/7 », agents_todos.rs). Une liste d'au moins
// 3 tâches, dont 2 encore à faire, lance une course ; les tâches finies la
// font avancer (race-logic.ts : un pas au hasard pour chaque goutte). La liste
// finie, ou l'agent qui « a fini » (« agents.event » done) : l'arrivée.
// Une liste effacée (session terminée) avant la fin : la course est annulée.
// Les paris ferment à mi-course. Rien n'est écrit : tout reste en mémoire.
//
// En mode démo (rien n'arrive des vrais agents), une fausse liste de 6 tâches
// avance toute seule quand on ouvre la course, pour les captures et la vidéo.

import { el } from "../../island/dom";
import { setText } from "../../core/perf";
import { demoOn } from "../../core/demo";
import { t } from "../../core/i18n";
import { reducedMotion } from "../../island/tab-pill";
import { stepSpring, type Spring } from "../../island/spring";
import { advance, betResult, finish, newRace, raceWorthy, RACERS, racerOf, standings, type Race, type RacerId } from "./race-logic";
import { wobble } from "./jelly-drop";
import { quietText, type Kit } from "./kit";

/** Le ressort des gouttes qui avancent : souple, un petit dépassement. */
const RUN = { stiffness: 140, damping: 0.55 };

interface TodoList {
  done: number;
  total: number;
}

export class RaceTracker {
  race: Race | null = null;
  /** Les listes connues (session → done / total), en mémoire. */
  private lists = new Map<string, TodoList>();
  private listeners = new Set<() => void>();
  private stops: (() => void)[] = [];
  private demoTimer = 0;
  /** Le gain de la dernière course (affiché à l'arrivée). */
  gained = 0;
  /** Vues de la course ouvertes : l'arrivée s'y lit, pas besoin d'un mot en plus. */
  watching = 0;

  constructor(private kit: Kit) {
    this.stops.push(
      kit.api.on("agents.todos", (msg) => {
        const p = (msg.payload ?? {}) as { session?: unknown; done?: unknown; total?: unknown };
        if (typeof p.session !== "string" || !p.session) return;
        if (typeof p.done === "number" && typeof p.total === "number") this.update(p.session, p.done, p.total);
        else this.forget(p.session);
      }),
      kit.api.on("agents.event", (msg) => {
        const p = (msg.payload ?? {}) as { kind?: unknown; session?: unknown };
        if (p.kind === "done" && this.race && !this.race.finished && p.session === this.race.session) this.arrive(finish(this.race));
      }),
    );
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  /** Une liste a bougé. */
  update(session: string, done: number, total: number) {
    this.lists.set(session, { done, total });
    const r = this.race;
    if (r && !r.finished && r.session === session) {
      const next = advance(r, done, total);
      if (next.finished) return this.arrive(next);
      this.race = next;
      return this.changed();
    }
    // Pas de course en cours (ou la précédente est finie) : celle-ci en vaut une ?
    if ((!r || r.finished) && raceWorthy(done, total) && this.kit.enabled("race")) {
      this.race = newRace(session, done, total);
      this.gained = 0;
    }
    this.changed();
  }

  private forget(session: string) {
    this.lists.delete(session);
    if (this.race && !this.race.finished && this.race.session === session) {
      // La session s'arrête avant la fin : pas d'arrivée, pas de gagnante.
      this.race = null;
      this.pickAnother();
    }
    this.changed();
  }

  /** Une autre liste en cours peut prendre la suite. */
  private pickAnother() {
    for (const [s, l] of this.lists) {
      if (raceWorthy(l.done, l.total)) {
        this.race = newRace(s, l.done, l.total);
        return;
      }
    }
  }

  private arrive(r: Race) {
    this.race = r;
    this.stopDemo();
    const res = betResult(r);
    this.changed();
    if (!res) return;
    this.kit.emote(res === "win" ? "cheer" : res === "second" ? "happy" : "sad", true);
    this.kit.sound(res === "win" ? "win" : res === "second" ? "coin" : "draw");
    void this.kit.store.result("race", res).then((g) => {
      this.gained = g;
      this.changed();
      // Un mot discret dans la mini-île (seulement si vous aviez parié et
      // que la course n'est pas sous vos yeux).
      if (this.watching) return;
      const name = colorName(r.bet!);
      this.kit.api.notify({
        title: res === "win" ? `La goutte ${name} a gagné la course !` : `La goutte ${name} finit ${res === "second" ? "2e" : "plus loin"}`,
        body: g ? `+${g} gouttes pour l'aquarium` : undefined,
        icon: "🏁",
        priority: "low",
        key: "games-race",
      });
    });
  }

  /** Vous pariez sur une goutte (avant la mi-course). */
  bet(id: RacerId): boolean {
    const r = this.race;
    if (!r || r.finished || r.bet || !betsOpen(r)) return false;
    this.race = { ...r, bet: id };
    this.kit.sound("tap");
    this.kit.emote("wink");
    this.changed();
    return true;
  }

  /** Mode démo : une fausse liste de tâches qui avance toute seule. */
  startDemo() {
    if (!demoOn() || this.demoTimer || (this.race && !this.race.finished)) return;
    let done = 0;
    this.update("demo", 0, 6);
    this.demoTimer = window.setInterval(() => {
      if (this.kit.quiet.quiet()) return;
      done++;
      this.update("demo", done, 6);
      if (done >= 6) this.stopDemo();
    }, 2600);
  }

  private stopDemo() {
    window.clearInterval(this.demoTimer);
    this.demoTimer = 0;
  }

  stop() {
    this.stopDemo();
    for (const s of this.stops) s();
    this.listeners.clear();
  }
}

/**
 * Le nom de la couleur, déjà traduit : il est glissé dans une phrase dont le
 * reste est traduit à l'affichage (motifs de i18n-en.json, « La goutte (.+) gagne »).
 */
function colorName(id: RacerId): string {
  return t(racerOf(id).name);
}

/** Les paris ferment à mi-course. */
export function betsOpen(r: Race): boolean {
  return !r.finished && r.done / Math.max(1, r.total) < 0.5;
}

/** « Claude Code », « Codex »… d'après l'id de session (« claude-code:abc »). */
function agentName(session: string): string {
  const tool = session.split(":")[0];
  const names: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", gemini: "Gemini CLI", demo: "Claude Code" };
  return names[tool] ?? t("Un agent IA");
}

/** Monte la vue de la course dans `root`. */
export function mountRace(root: HTMLElement, kit: Kit, tracker: RaceTracker): () => void {
  tracker.startDemo();
  tracker.watching++;
  const head = el("div", { class: "race-head" });
  const lanes = el("div", { class: "race-lanes" });
  const bets = el("div", { class: "race-bets", role: "radiogroup", "aria-label": "Votre pari" });
  const note = el("div", { class: "games-status", "aria-live": "polite" });
  const gain = el("div", { class: "games-gain" });
  root.append(el("div", { class: "race", "data-island-fit": "" }, head, lanes, el("div", { class: "race-foot" }, bets, note, gain)));

  const drops: HTMLElement[] = [];
  const springs: Spring[] = RACERS.map(() => ({ x: 0, v: 0 }));
  const betButtons = new Map<RacerId, HTMLButtonElement>();
  for (const r of RACERS) {
    const drop = el("span", { class: "race-drop", style: `--c: ${r.color}` });
    drops.push(drop);
    lanes.append(el("div", { class: "race-lane" }, el("span", { class: "race-track" }), drop, el("span", { class: "race-flag" })));
    const b = el("button", { class: "race-bet", role: "radio", style: `--c: ${r.color}`, title: `Parier sur la goutte ${t(r.name)}`, onclick: kit.api.handler(() => tracker.bet(r.id)) }, el("span", { class: "race-dot" }), t(r.name));
    betButtons.set(r.id, b);
    bets.append(b);
  }

  let raf = 0;
  let last = performance.now();
  let shownFinish = false;
  /** Les gouttes rejoignent leur place au ressort (sans boucle une fois posées). */
  const run = () => {
    if (raf) return;
    last = performance.now();
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(1 / 20, (now - last) / 1000);
      last = now;
      const r = tracker.race;
      const width = lanes.clientWidth - 30;
      let moving = false;
      drops.forEach((d, i) => {
        const target = (r?.pos[i] ?? 0) * width;
        if (reducedMotion()) springs[i] = { x: target, v: 0 };
        else stepSpring(springs[i], target, RUN, dt);
        if (Math.abs(springs[i].x - target) > 0.3 || Math.abs(springs[i].v) > 2) moving = true;
        // Plus elle file, plus elle s'étire (une goutte qui court).
        const s = Math.min(0.3, Math.abs(springs[i].v) / 600);
        d.style.transform = `translateX(${springs[i].x.toFixed(1)}px) scale(${(1 + s).toFixed(3)}, ${(1 - s * 0.6).toFixed(3)})`;
      });
      if (moving) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const paint = () => {
    const r = tracker.race;
    root.classList.toggle("paused", kit.quiet.quiet());
    root.classList.toggle("empty", !r);
    if (!r) {
      setText(head, "Pas de course pour l'instant");
      setText(note, "La course part quand un agent IA travaille sur une liste d'au moins 3 tâches (la barre « 3/7 » de l'onglet Agents IA).");
      gain.replaceChildren();
      betButtons.forEach((b) => (b.disabled = true));
      return run();
    }
    setText(head, `${agentName(r.session)} · ${Math.min(r.done, r.total)}/${r.total}${r.finished ? " · arrivée" : ""}`);
    const order = standings(r);
    betButtons.forEach((b, id) => {
      b.disabled = !!r.bet || !betsOpen(r);
      b.classList.toggle("on", r.bet === id);
      b.setAttribute("aria-checked", String(r.bet === id));
    });
    drops.forEach((d, i) => {
      d.classList.toggle("lead", order[0] === RACERS[i].id && r.done > 0);
      d.classList.toggle("winner", r.finished && order[0] === RACERS[i].id);
    });
    const mine = r.bet ? colorName(r.bet) : "";
    let text: string;
    if (kit.quiet.quiet()) text = quietText(kit.quiet.reason());
    else if (r.finished) {
      const res = betResult(r);
      const win = colorName(order[0]);
      if (!r.bet) text = `La goutte ${win} gagne.`;
      else if (res === "win") text = `Votre goutte ${mine} gagne !`;
      else if (res === "second") text = `La goutte ${win} gagne. Votre goutte ${mine} finit 2e.`;
      else text = `La goutte ${win} gagne. Votre goutte ${mine} finit plus loin.`;
    } else if (r.bet) text = `Votre pari : la goutte ${mine}. Les tâches de l'agent la font avancer.`;
    else if (betsOpen(r)) text = "Pariez sur une goutte : chaque tâche finie fait avancer la course.";
    else text = "Les paris sont fermés (mi-course).";
    setText(note, text);
    gain.replaceChildren(...(r.finished && tracker.gained ? [el("span", { class: "games-gain-pill" }, `+${tracker.gained} 💧`)] : []));
    if (r.finished && !shownFinish) {
      const w = drops[RACERS.findIndex((x) => x.id === order[0])];
      if (w) window.setTimeout(() => wobble(w, 1.2), 500);
    }
    shownFinish = r.finished;
    run();
  };
  const stops = [tracker.onChange(paint), kit.quiet.onChange(paint), kit.store.onChange(paint)];
  // Au montage, les gouttes partent de leur place actuelle (sans rejouer la course).
  const width0 = () => lanes.clientWidth - 30;
  requestAnimationFrame(() => {
    tracker.race?.pos.forEach((p, i) => (springs[i] = { x: p * width0(), v: 0 }));
    paint();
  });
  paint();
  return () => {
    cancelAnimationFrame(raf);
    tracker.watching--;
    for (const s of stops) s();
  };
}
