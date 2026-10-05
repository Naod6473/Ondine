// Module « Minuteur » : minuteur, Pomodoro et chronomètre.
//
// Tout se passe ici, dans le front : pas besoin de Rust. On ne compte pas les
// secondes une par une (un onglet en veille peut en sauter) : on retient
// l'heure de FIN (ou de départ pour le chrono) et on calcule ce qui reste.
//
// La vue compacte (la pilule) montre ce qui tourne. À la fin d'un minuteur ou
// d'une séance Pomodoro, l'île s'ouvre en alerte, avec un petit son, et la
// mascotte fait la fête (sujet "task.finished").

import manifest from "./manifest.json";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { reducedMotion, TabPill } from "../../island/tab-pill";

// ── Les trois compteurs ──────────────────────────────────────────────────────

/** Un compte à rebours : en marche si `endsAt` est donné, sinon en pause. */
interface Countdown {
  /** Durée totale (ms), pour l'anneau de progression. */
  total: number;
  /** Ce qui reste (ms) quand il est en pause. */
  left: number;
  /** Heure de fin (Date.now()) quand il tourne. */
  endsAt: number | null;
}

type PomodoroPhase = "work" | "short" | "long";

const timer: Countdown = { total: 5 * 60_000, left: 5 * 60_000, endsAt: null };
const pomodoro = {
  phase: "work" as PomodoroPhase,
  /** Séances de travail terminées depuis la dernière remise à zéro. */
  done: 0,
  clock: { total: 25 * 60_000, left: 25 * 60_000, endsAt: null } as Countdown,
  /** La séance a démarré au moins une fois (sinon on suit le réglage de durée). */
  started: false,
};
const stopwatch = {
  /** Temps cumulé avant le dernier départ. */
  before: 0,
  startedAt: null as number | null,
  laps: [] as number[],
};

type Pane = "timer" | "pomodoro" | "stopwatch";
let pane: Pane = "timer";

const PHASE_LABEL: Record<PomodoroPhase, string> = { work: "Travail", short: "Pause courte", long: "Pause longue" };

function remaining(c: Countdown): number {
  return c.endsAt === null ? c.left : Math.max(0, c.endsAt - Date.now());
}

function running(c: Countdown): boolean {
  return c.endsAt !== null;
}

function start(c: Countdown) {
  if (c.endsAt === null && c.left > 0) c.endsAt = Date.now() + c.left;
}

function pause(c: Countdown) {
  if (c.endsAt !== null) {
    c.left = remaining(c);
    c.endsAt = null;
  }
}

function reset(c: Countdown, total = c.total) {
  c.total = total;
  c.left = total;
  c.endsAt = null;
}

function elapsed(): number {
  return stopwatch.before + (stopwatch.startedAt === null ? 0 : Date.now() - stopwatch.startedAt);
}

/** 65 000 → « 1:05 » ; 3 725 000 → « 1:02:05 ». Avec `cs`, les centièmes. */
function clock(ms: number, cs = false): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? `${h}:${String(m).padStart(2, "0")}` : String(m);
  const base = `${mm}:${String(s).padStart(2, "0")}`;
  return cs ? `${base},${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}` : base;
}

/** Arrondi à la seconde supérieure : « 0:01 » jusqu'à la toute fin, jamais « 0:00 » trop tôt. */
function countdownText(c: Countdown): string {
  return clock(Math.ceil(remaining(c) / 1000) * 1000);
}

// ── Son de fin (généré, pas de fichier) ──────────────────────────────────────

let audio: AudioContext | null = null;

/** À appeler lors d'un clic : le navigateur n'autorise le son qu'après une action de l'utilisateur. */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null; // pas de son, tant pis
  }
}

/** Trois petites notes douces, montantes. */
function chime() {
  if (!audio) return;
  const t0 = audio.currentTime + 0.05;
  [660, 880, 1100].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = t0 + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// ── Réglages Pomodoro ────────────────────────────────────────────────────────

function phaseMs(api: ModuleApi, phase: PomodoroPhase): number {
  const s = api.settings();
  const minutes = { work: s.workMin, short: s.shortMin, long: s.longMin }[phase] as number;
  return Math.max(1, minutes) * 60_000;
}

/** La phase qui suit `phase` (une pause longue toutes les `longEvery` séances). */
function nextPhase(api: ModuleApi): PomodoroPhase {
  if (pomodoro.phase !== "work") return "work";
  return pomodoro.done % (api.settings().longEvery as number) === 0 ? "long" : "short";
}

// ── Ce qui se passe à chaque instant ─────────────────────────────────────────

let wasActive = false;

/** Quelque chose tourne-t-il ? (pour la pilule) */
function anyActive(): boolean {
  return running(timer) || running(pomodoro.clock) || stopwatch.startedAt !== null;
}

function tick(api: ModuleApi) {
  if (running(timer) && remaining(timer) === 0) {
    reset(timer);
    finished(api, "Minuteur terminé", `${clock(timer.total)} écoulées`, "⏱️");
  }
  if (running(pomodoro.clock) && remaining(pomodoro.clock) === 0) {
    const ended = pomodoro.phase;
    if (ended === "work") pomodoro.done++;
    pomodoro.phase = nextPhase(api);
    reset(pomodoro.clock, phaseMs(api, pomodoro.phase));
    const auto = Boolean(api.settings().autoNext);
    if (auto) start(pomodoro.clock);
    finished(
      api,
      ended === "work" ? "Séance terminée : pause !" : "Pause terminée : au travail !",
      auto ? `${PHASE_LABEL[pomodoro.phase]} : ${clock(pomodoro.clock.total)}` : "Lance la suite quand tu es prêt.",
      ended === "work" ? "☕" : "🍅",
    );
  }
  // La pilule n'a besoin d'être changée que quand ça démarre ou s'arrête.
  const active = anyActive();
  if (active !== wasActive) {
    wasActive = active;
    api.refreshCompact();
  }
}

function finished(api: ModuleApi, title: string, body: string, icon: string) {
  if (api.settings().sound) chime();
  api.notify({ title, body, icon, priority: "high", key: "timer-done" });
  api.emit("timer.done", { title });
  api.emit("task.finished", { label: title });
}

// ── Petits éléments d'interface ──────────────────────────────────────────────

const RING_R = 52;
const RING_LEN = 2 * Math.PI * RING_R;

/** Un anneau de progression (SVG) avec le temps au milieu. */
function ring(): { root: SVGSVGElement; set: (fraction: number, text: string, sub?: string) => void } {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.classList.add("timer-ring");
  const track = document.createElementNS(ns, "circle");
  const bar = document.createElementNS(ns, "circle");
  for (const c of [track, bar]) {
    c.setAttribute("cx", "60");
    c.setAttribute("cy", "60");
    c.setAttribute("r", String(RING_R));
  }
  track.classList.add("track");
  bar.classList.add("bar");
  bar.setAttribute("stroke-dasharray", String(RING_LEN));
  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", "60");
  text.setAttribute("y", "60");
  text.classList.add("time");
  const sub = document.createElementNS(ns, "text");
  sub.setAttribute("x", "60");
  sub.setAttribute("y", "82");
  sub.classList.add("sub");
  svg.append(track, bar, text, sub);
  return {
    root: svg,
    set(fraction, t, s = "") {
      bar.setAttribute("stroke-dashoffset", String(RING_LEN * (1 - Math.min(1, Math.max(0, fraction)))));
      if (text.textContent !== t) text.textContent = t;
      if (sub.textContent !== s) sub.textContent = s;
    },
  };
}

// ── Le module ────────────────────────────────────────────────────────────────

export const timerModule: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    reset(pomodoro.clock, phaseMs(api, "work"));
    const interval = window.setInterval(() => tick(api), 250);
    // Une règle (raccourci, événement…) lance un minuteur.
    const offStart = api.on("timer.start", (msg) => {
      const minutes = Number((msg.payload as { minutes?: number } | null)?.minutes);
      if (!(minutes >= 1 && minutes <= 180)) return;
      reset(timer, minutes * 60_000);
      start(timer);
      pane = "timer";
      api.refreshCompact();
    });
    // Durée de travail changée dans les réglages : prise en compte si la séance n'a pas commencé.
    const off = api.onSettingsChange(() => {
      if (!pomodoro.started) reset(pomodoro.clock, phaseMs(api, pomodoro.phase));
      api.refreshCompact();
    });
    return () => {
      window.clearInterval(interval);
      off();
      offStart();
    };
  },

  views: {
    compactWhen: (api) => anyActive() && Boolean(api.settings().showCompact),

    compact(root) {
      const line = el("span", { class: "timer-compact-text" });
      const bar = el("span", { class: "timer-compact-bar" }, el("i"));
      root.append(el("div", { class: "timer-compact" }, line, bar));
      let frame = 0;
      const draw = () => {
        let icon = "⏱️";
        let text = "";
        let fraction = 0;
        if (running(timer)) {
          text = countdownText(timer);
          fraction = 1 - remaining(timer) / timer.total;
        } else if (running(pomodoro.clock)) {
          icon = pomodoro.phase === "work" ? "🍅" : "☕";
          text = `${PHASE_LABEL[pomodoro.phase]} · ${countdownText(pomodoro.clock)}`;
          fraction = 1 - remaining(pomodoro.clock) / pomodoro.clock.total;
        } else if (stopwatch.startedAt !== null) {
          text = clock(elapsed());
          fraction = (elapsed() % 60_000) / 60_000; // un tour par minute
        }
        line.textContent = `${icon} ${text}`;
        (bar.firstChild as HTMLElement).style.transform = `scaleX(${fraction})`;
        frame = requestAnimationFrame(draw);
      };
      draw();
      return () => cancelAnimationFrame(frame);
    },

    expanded(root, api) {
      // Les trois sous-onglets, avec la même pastille « liquide » que l'île.
      const panes: { id: Pane; label: string }[] = [
        { id: "timer", label: "⏱️ Minuteur" },
        { id: "pomodoro", label: "🍅 Pomodoro" },
        { id: "stopwatch", label: "⏲️ Chrono" },
      ];
      const segButtons = new Map<Pane, HTMLElement>();
      const seg = el("div", { class: "segmented" });
      for (const p of panes) {
        const b = el("button", { class: "seg", onclick: api.handler(() => show(p.id)) }, p.label);
        segButtons.set(p.id, b);
        seg.append(b);
      }
      const pill = new TabPill(seg);
      const body = el("div", { class: "timer-body" });
      root.append(seg, body);

      let frame = 0;
      let update: () => void = () => {};

      const show = (id: Pane, animate = true) => {
        pane = id;
        for (const [pid, b] of segButtons) b.classList.toggle("active", pid === id);
        if (animate) pill.moveTo(segButtons.get(id)!);
        body.replaceChildren();
        update = { timer: drawTimer, pomodoro: drawPomodoro, stopwatch: drawStopwatch }[id]();
        if (animate && !reducedMotion()) {
          body.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], {
            duration: 260,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          });
        }
      };

      const button = (label: string, title: string, run: () => void, cls = "btn small") =>
        el("button", { class: cls, title, onclick: api.handler(() => { unlockAudio(); run(); update(); }) }, label);

      // ── Minuteur ──
      const drawTimer = () => {
        const r = ring();
        const toggle = button("", "", () => (running(timer) ? pause(timer) : start(timer)), "btn primary");
        const presets = el(
          "div",
          { class: "btn-row timer-presets" },
          ...[1, 3, 5, 10, 15, 25, 45].map((m) =>
            button(`${m} min`, `Régler sur ${m} minutes`, () => {
              reset(timer, m * 60_000);
              start(timer);
            }),
          ),
          button("+1 min", "Ajouter une minute", () => {
            if (running(timer)) timer.endsAt! += 60_000;
            else timer.left += 60_000;
            timer.total += 60_000;
          }),
        );
        body.append(
          el(
            "div",
            { class: "timer-layout" },
            r.root,
            el(
              "div",
              { class: "timer-side" },
              presets,
              el("div", { class: "btn-row" }, toggle, button("↺ Réinitialiser", "Revenir au début", () => reset(timer))),
            ),
          ),
        );
        return () => {
          r.set(remaining(timer) / timer.total, countdownText(timer), running(timer) ? "" : "en pause");
          toggle.textContent = running(timer) ? "⏸ Pause" : "▶ Démarrer";
        };
      };

      // ── Pomodoro ──
      const drawPomodoro = () => {
        const r = ring();
        const toggle = button("", "", () => {
          pomodoro.started = true;
          if (running(pomodoro.clock)) pause(pomodoro.clock);
          else start(pomodoro.clock);
        }, "btn primary");
        const tomatoes = el("div", { class: "timer-tomatoes" });
        body.append(
          el(
            "div",
            { class: "timer-layout" },
            r.root,
            el(
              "div",
              { class: "timer-side" },
              tomatoes,
              el(
                "div",
                { class: "btn-row" },
                toggle,
                button("⏭ Passer", "Passer à la phase suivante", () => {
                  if (pomodoro.phase === "work") pomodoro.done++;
                  pomodoro.phase = nextPhase(api);
                  reset(pomodoro.clock, phaseMs(api, pomodoro.phase));
                }),
                button("↺ Réinitialiser", "Recommencer à zéro", () => {
                  pomodoro.phase = "work";
                  pomodoro.done = 0;
                  pomodoro.started = false;
                  reset(pomodoro.clock, phaseMs(api, "work"));
                }),
              ),
              el("p", { class: "muted timer-hint" }, "Les durées se règlent dans les réglages du module."),
            ),
          ),
        );
        return () => {
          const c = pomodoro.clock;
          r.set(remaining(c) / c.total, countdownText(c), PHASE_LABEL[pomodoro.phase]);
          toggle.textContent = running(c) ? "⏸ Pause" : "▶ Démarrer";
          const every = api.settings().longEvery as number;
          const inCycle = pomodoro.done % every;
          const want = `${"🍅".repeat(inCycle)}${"○".repeat(every - inCycle)} · ${pomodoro.done} séance(s)`;
          if (tomatoes.textContent !== want) tomatoes.textContent = want;
        };
      };

      // ── Chrono ──
      const drawStopwatch = () => {
        const big = el("div", { class: "timer-big" });
        const toggle = button("", "", () => {
          if (stopwatch.startedAt === null) stopwatch.startedAt = Date.now();
          else {
            stopwatch.before = elapsed();
            stopwatch.startedAt = null;
          }
        }, "btn primary");
        const laps = el("ol", { class: "timer-laps" });
        let shownLaps = -1;
        body.append(
          el(
            "div",
            { class: "timer-stopwatch" },
            big,
            el(
              "div",
              { class: "btn-row" },
              toggle,
              button("⚑ Tour", "Noter un temps intermédiaire", () => {
                if (stopwatch.startedAt !== null) stopwatch.laps.unshift(elapsed());
              }),
              button("↺ Réinitialiser", "Remettre à zéro", () => {
                stopwatch.before = 0;
                stopwatch.startedAt = null;
                stopwatch.laps = [];
              }),
            ),
            laps,
          ),
        );
        return () => {
          big.textContent = clock(elapsed(), true);
          toggle.textContent = stopwatch.startedAt === null ? (elapsed() ? "▶ Reprendre" : "▶ Démarrer") : "⏸ Pause";
          if (shownLaps !== stopwatch.laps.length) {
            shownLaps = stopwatch.laps.length;
            const n = stopwatch.laps.length;
            laps.replaceChildren(
              ...stopwatch.laps.map((t, i) => {
                const previous = stopwatch.laps[i + 1] ?? 0;
                return el("li", {}, el("span", { class: "muted" }, `Tour ${n - i}`), el("b", {}, clock(t, true)), el("span", { class: "muted" }, `+${clock(t - previous, true)}`));
              }),
            );
          }
        };
      };

      show(pane, false);
      requestAnimationFrame(() => pill.jumpTo(segButtons.get(pane)!));
      const loop = () => {
        update();
        frame = requestAnimationFrame(loop);
      };
      loop();
      return () => {
        cancelAnimationFrame(frame);
        pill.stop();
      };
    },
  },
};
