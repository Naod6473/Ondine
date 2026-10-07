// Module « Minuteur » : minuteur, Pomodoro et chronomètre.
//
// Tout se passe ici, dans le front : pas besoin de Rust. On ne compte pas les
// secondes une par une (un onglet en veille peut en sauter) : on retient
// l'heure de FIN (ou de départ pour le chrono) et on calcule ce qui reste.
//
// La vue compacte (la pilule) montre ce qui tourne. À la fin d'un minuteur ou
// d'une séance Pomodoro, l'île s'ouvre en alerte, avec un petit son, et la
// mascotte fait la fête (sujet "task.finished").
//
// Bilan de la semaine : chaque séance de travail Pomodoro qui s'arrête publie
// "timer.work-session" {seconds, completed} (voir « Séances de travail » plus bas).
//
// Mode concentration (réglage « focusQuiet ») : pendant une séance de travail
// Pomodoro qui tourne, on publie "timer.focus" {on: true} ; l'île met alors
// ses notifications en attente (voir island.ts, wireFocus). En pause, à l'arrêt
// ou à la fin de la séance : {on: false}, et elles arrivent avec un résumé.
//
// Et « Ne pas déranger » de Windows ? Il n'existe pas d'API publique simple :
//   - FocusSessionManager (WinRT, Windows 11) est une « fonction à accès
//     limité » : il faut un jeton demandé à Microsoft ;
//   - la clé de registre NOC_GLOBAL_SETTING_TOASTS_ENABLED (ou ToastEnabled)
//     n'est relue par Windows qu'au redémarrage de son service de
//     notifications, et resterait coupée si Ondine plantait en pleine séance ;
//   - WNF / Focus Assist : non documentés, peuvent casser à chaque mise à jour.
// On ne touche donc pas à Windows : seule l'île se tait. Pour couper aussi les
// bannières de Windows, une séance « Focus » de l'appli Horloge active « Ne pas
// déranger » (Windows 11).

import manifest from "./manifest.json";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { frameLoop, pacedInterval, setText } from "../../core/perf";
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
/** Le mode concentration est-il annoncé à l'île en ce moment ? */
let focusOn = false;

/** Annonce le début ou la fin de la concentration, quand ça change. */
function syncFocus(api: ModuleApi, force?: boolean) {
  const wanted = force ?? (Boolean(api.settings().focusQuiet) && running(pomodoro.clock) && pomodoro.phase === "work");
  if (wanted === focusOn) return;
  focusOn = wanted;
  api.emit("timer.focus", { on: wanted });
}

// ── Séances de travail, pour le bilan de la semaine ─────────────────────────
//
// Quand une séance de travail Pomodoro s'arrête (finie, mise en pause, passée,
// remise à zéro, module coupé), on publie "timer.work-session"
// {seconds, completed} : le module Bilan de la semaine fait les comptes.
// `seconds` = ce que le compte à rebours a avancé : un PC en veille pendant la
// séance ne compte jamais plus que la séance elle-même.

/** Ce qui restait (ms) quand la séance de travail a commencé à tourner ; null = rien ne tourne. */
let workFrom: number | null = null;

/** La séance de travail en cours s'arrête : on publie sa durée. */
function endWork(api: ModuleApi, completed: boolean) {
  if (workFrom === null) return;
  const left = completed ? 0 : remaining(pomodoro.clock);
  const seconds = Math.max(0, Math.round((workFrom - left) / 1000));
  workFrom = null;
  if (seconds > 0 || completed) api.emit("timer.work-session", { seconds, completed });
}

/** Suit la séance de travail : commence à compter quand elle tourne, publie quand elle s'arrête. */
function trackWork(api: ModuleApi) {
  const working = pomodoro.phase === "work" && running(pomodoro.clock);
  if (working && workFrom === null) workFrom = remaining(pomodoro.clock);
  else if (!working) endWork(api, false);
}

/** Quelque chose tourne-t-il ? (pour la pilule) */
function anyActive(): boolean {
  return running(timer) || running(pomodoro.clock) || stopwatch.startedAt !== null;
}

function tick(api: ModuleApi) {
  if (running(timer) && remaining(timer) === 0) {
    reset(timer);
    finished(api, "Minuteur terminé", `${clock(timer.total)} écoulées`, "⏱️");
  }
  trackWork(api);
  if (running(pomodoro.clock) && remaining(pomodoro.clock) === 0) {
    const ended = pomodoro.phase;
    if (ended === "work") {
      pomodoro.done++;
      endWork(api, true);
    }
    pomodoro.phase = nextPhase(api);
    reset(pomodoro.clock, phaseMs(api, pomodoro.phase));
    const auto = Boolean(api.settings().autoNext);
    if (auto) start(pomodoro.clock);
    finished(
      api,
      ended === "work" ? "Séance terminée : pause !" : "Pause terminée : au travail !",
      auto ? `${PHASE_LABEL[pomodoro.phase]} : ${clock(pomodoro.clock.total)}` : "Lancez la suite quand vous êtes prêt.",
      ended === "work" ? "☕" : "🍅",
    );
  }
  // Une séance de travail enchaînée après une pause commence à compter.
  trackWork(api);
  syncFocus(api);
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
  let lastOffset = "";
  return {
    root: svg,
    set(fraction, t, s = "") {
      // Seulement si l'anneau a bougé (en pause, rien n'est réécrit à chaque image).
      const offset = (RING_LEN * (1 - Math.min(1, Math.max(0, fraction)))).toFixed(2);
      if (offset !== lastOffset) bar.setAttribute("stroke-dashoffset", (lastOffset = offset));
      setText(text, t);
      setText(sub, s);
    },
  };
}

// ── Le module ────────────────────────────────────────────────────────────────

export const timerModule: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    reset(pomodoro.clock, phaseMs(api, "work"));
    // Toutes les 250 ms (500 en économie d'énergie : src/core/perf.ts).
    const stopTick = pacedInterval(() => tick(api), "timerTick");
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
      stopTick();
      off();
      offStart();
      // Module coupé en pleine séance : le temps déjà passé compte pour le bilan.
      endWork(api, false);
      // Et les notifications de l'île reprennent.
      syncFocus(api, false);
    };
  },

  views: {
    compactWhen: (api) => anyActive() && Boolean(api.settings().showCompact),

    compact(root) {
      const line = el("span", { class: "timer-compact-text" });
      const bar = el("span", { class: "timer-compact-bar" }, el("i"));
      root.append(el("div", { class: "timer-compact" }, line, bar));
      const fill = bar.firstChild as HTMLElement;
      let shownFraction = "";
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
        // Le texte change une fois par seconde : on ne le réécrit qu'à ce moment-là.
        setText(line, `${icon} ${text}`);
        const f = fraction.toFixed(4);
        if (f !== shownFraction) {
          shownFraction = f;
          fill.style.transform = `scaleX(${f})`;
          // Le design Studio dessine un petit anneau à la place de la barre (island.css).
          bar.style.setProperty("--p", f);
        }
      };
      draw();
      return frameLoop(root, draw);
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
          setText(toggle, running(timer) ? "⏸ Pause" : "▶ Démarrer");
        };
      };

      // ── Pomodoro ──
      const drawPomodoro = () => {
        const r = ring();
        const toggle = button("", "", () => {
          pomodoro.started = true;
          if (running(pomodoro.clock)) pause(pomodoro.clock);
          else start(pomodoro.clock);
          trackWork(api);
          syncFocus(api);
        }, "btn primary");
        const tomatoes = el("div", { class: "timer-tomatoes" });
        const focusHint = el("p", { class: "muted timer-hint" });
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
                  // Le temps passé compte, mais la séance n'est pas « terminée ».
                  endWork(api, false);
                  if (pomodoro.phase === "work") pomodoro.done++;
                  pomodoro.phase = nextPhase(api);
                  reset(pomodoro.clock, phaseMs(api, pomodoro.phase));
                  syncFocus(api);
                }),
                button("↺ Réinitialiser", "Recommencer à zéro", () => {
                  endWork(api, false);
                  pomodoro.phase = "work";
                  pomodoro.done = 0;
                  pomodoro.started = false;
                  reset(pomodoro.clock, phaseMs(api, "work"));
                  syncFocus(api);
                }),
              ),
              el("p", { class: "muted timer-hint" }, "Les durées se règlent dans les réglages du module."),
              focusHint,
            ),
          ),
        );
        return () => {
          const c = pomodoro.clock;
          r.set(remaining(c) / c.total, countdownText(c), PHASE_LABEL[pomodoro.phase]);
          setText(toggle, running(c) ? "⏸ Pause" : "▶ Démarrer");
          const every = api.settings().longEvery as number;
          const inCycle = pomodoro.done % every;
          const want = `${"🍅".repeat(inCycle)}${"○".repeat(every - inCycle)} · ${pomodoro.done} séance(s)`;
          setText(tomatoes, want);
          const hint = focusOn ? "🔕 Concentration : les notifications de l'île attendent la fin de la séance." : "";
          setText(focusHint, hint);
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
          setText(big, clock(elapsed(), true));
          setText(toggle, stopwatch.startedAt === null ? (elapsed() ? "▶ Reprendre" : "▶ Démarrer") : "⏸ Pause");
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
      // À chaque image (le chrono affiche les centièmes), 30 par seconde en
      // économie d'énergie ; rien n'est réécrit si rien n'a changé (setText).
      update();
      const stopLoop = frameLoop(root, () => update());
      return () => {
        stopLoop();
        pill.stop();
      };
    },
  },
};
