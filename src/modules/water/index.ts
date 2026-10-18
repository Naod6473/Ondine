// Module « Eau » (1.2.5, coupé par défaut) : les verres d'eau de la journée.
//
// L'onglet suit la maquette « Eau » : le total du jour en grand (« 1,25 L »),
// « sur 2 L aujourd'hui », une barre de progression, le bouton « + 25 cl »
// (la taille du verre) et la semaine en 7 petites barres, aujourd'hui en
// blanc. Un appui long sur le bouton, ou « Annuler », retire le dernier verre.
//
// Le rappel : toutes les 30 s (60 s en économie d'énergie : "waterCheck" de
// src/core/perf.ts), on regarde s'il est l'heure (water-logic.ts : au début
// de la plage, puis `everyMin` après le dernier verre ou le dernier rappel ;
// plus rien une fois l'objectif atteint). L'alerte « Un verre d'eau ? »
// propose « + 25 cl » et « Plus tard » (30 min). Elle se tait, comme Pauses,
// pendant une présentation ou un plein écran (Bridge.deskState), un appel
// (micro utilisé, module Contrôles) et la concentration du Minuteur
// ("timer.focus") : elle attend que ce soit fini.
//
// Le carnet est tenu par le Rust (src-tauri/src/modules/water.rs,
// %APPDATA%\Ondine\water.json, 30 jours) ; chaque changement est redit sur le
// bus ("water.changed", le carnet entier) pour les autres fenêtres.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { currentLang } from "../../core/i18n";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { pacedInterval, setText } from "../../core/perf";
import { el } from "../../island/dom";
import {
  cleanLog,
  dateKey,
  dayTotal,
  glassLabel,
  goalLine,
  lastGlassAt,
  litres,
  progress,
  reminderBody,
  reminderDue,
  waterSettings,
  weekBars,
  weekdayLetter,
  type WaterLog,
} from "./water-logic";
import "../../styles/water.css";

/** « Plus tard » redemande dans… */
const SNOOZE_MS = 30 * 60_000;
/** Un appui de cette durée sur « + 25 cl » retire le dernier verre. */
const LONG_PRESS_MS = 600;

let log: WaterLog | null = null;
const redraws = new Set<() => void>();

function redrawAll() {
  for (const r of redraws) r();
}

function apply(raw: unknown) {
  const next = cleanLog(raw);
  if (!next) return;
  log = next;
  redrawAll();
}

/** Une commande du carnet (read, add, undo) ; le carnet à jour est redit sur le bus. */
async function run(api: ModuleApi, command: "read" | "add" | "undo", args?: unknown) {
  try {
    apply(await api.invoke<WaterLog>(command, args));
    if (command !== "read" && log) api.emit("water.changed", log);
  } catch (err) {
    api.notify({ title: "Eau", body: errorText(err), icon: "⚠️", priority: "low", key: "water-error" });
  }
}

/** Un verre de la taille réglée. */
async function drink(api: ModuleApi) {
  await run(api, "add", { ml: waterSettings(api.settings()).glassMl });
  api.emit("mascot.emote", { emotion: "happy" });
}

export const water: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    let lastAskedAt: number | null = null;
    let snoozeUntil: number | null = null;
    let focus = false;
    let micInUse = false;

    const offs = [
      // Sans carnet dans le message (le mode démo qui s'allume ou s'éteint) : on relit.
      api.on("water.changed", (msg) => (msg.payload ? apply(msg.payload) : void run(api, "read"))),
      api.on("timer.focus", (msg) => void (focus = !!(msg.payload as { on?: boolean } | null)?.on)),
      api.on("controls.media-use", (msg) => {
        micInUse = ((msg.payload as { mic?: string[] } | null)?.mic ?? []).length > 0;
      }),
    ];
    void run(api, "read");

    const check = async () => {
      if (!log) return;
      const now = new Date();
      const s = waterSettings(api.settings());
      // Minuit passé : on relit le carnet (le Rust donne la nouvelle date).
      if (log.today !== dateKey(now)) {
        await run(api, "read");
        if (!log) return;
      }
      const input = { lastGlassAt: lastGlassAt(log, now), lastAskedAt, snoozeUntil, totalMl: dayTotal(log) };
      if (!reminderDue(now, s, input)) return;
      // Concentration, appel : on attend que ce soit fini.
      if (focus || micInUse) return;
      const desk = await Bridge.deskState();
      if (!desk || desk.busy) return; // hors de l'appli, ou présentation / plein écran
      lastAskedAt = Date.now();
      snoozeUntil = null;
      api.notify({
        title: "Un verre d'eau ?",
        body: reminderBody(dayTotal(log), s.goalMl, currentLang()),
        icon: "🥛",
        priority: "high",
        key: "water",
        durationMs: 20_000,
        actions: [
          { label: glassLabel(s.glassMl), run: () => void drink(api) },
          { label: "Plus tard", run: () => void (snoozeUntil = Date.now() + SNOOZE_MS) },
        ],
      });
    };
    const stopTimer = pacedInterval(() => void check(), "waterCheck");

    return () => {
      stopTimer();
      offs.forEach((off) => off());
      log = null;
    };
  },

  views: {
    expanded(root, api) {
      const total = el("div", { class: "water-total" });
      const goal = el("div", { class: "water-goal" });
      const fill = el("i", { class: "water-fill" });
      const bar = el("div", { class: "water-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Objectif du jour" }, fill);

      // « + 25 cl » : un clic ajoute un verre, un appui long retire le dernier.
      const add = el("button", { class: "water-add", type: "button" }) as HTMLButtonElement;
      let pressTimer = 0;
      let longPressed = false;
      const cancelPress = () => window.clearTimeout(pressTimer);
      add.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        longPressed = false;
        cancelPress();
        pressTimer = window.setTimeout(() => {
          longPressed = true;
          void run(api, "undo");
        }, LONG_PRESS_MS);
      });
      add.addEventListener("pointerup", cancelPress);
      add.addEventListener("pointerleave", cancelPress);
      add.addEventListener("pointercancel", cancelPress);
      add.addEventListener(
        "click",
        api.handler(() => {
          if (longPressed) {
            longPressed = false;
            return;
          }
          return drink(api);
        }),
      );
      const undo = el("button", { class: "water-undo", type: "button", title: "Retirer le dernier verre", onclick: api.handler(() => run(api, "undo")) }, "Annuler");

      const week = el("div", { class: "water-week", role: "img", "aria-label": "Les 7 derniers jours" });
      const box = el(
        "div",
        { class: "water" },
        el("div", { class: "water-main" }, total, goal, bar, el("div", { class: "water-actions" }, add, undo)),
        week,
      );
      root.append(box);

      let shownWeek = "";
      const draw = () => {
        const s = waterSettings(api.settings());
        const lang = currentLang();
        const today = log ? dayTotal(log) : 0;
        setText(total, litres(today, lang));
        setText(goal, goalLine(s.goalMl, lang));
        const p = progress(today, s.goalMl);
        fill.style.setProperty("--water-p", `${(p * 100).toFixed(1)}%`);
        bar.setAttribute("aria-valuenow", String(Math.round(p * 100)));
        box.classList.toggle("done", p >= 1);
        setText(add, glassLabel(s.glassMl));
        add.disabled = !log;
        undo.hidden = !log || !(log.days[log.today]?.length);

        const bars = log ? weekBars(log, s.goalMl) : [];
        const key = JSON.stringify([bars.map((b) => [b.day, b.ml]), s.goalMl, lang]);
        if (key === shownWeek) return;
        shownWeek = key;
        week.replaceChildren(
          ...bars.map((b) =>
            el(
              "span",
              { class: b.today ? "water-day today" : "water-day", title: litres(b.ml, lang) },
              el("i", { style: `--h:${Math.max(b.ml ? 0.06 : 0.03, b.height).toFixed(3)}` }),
              el("b", { "data-no-i18n": true }, weekdayLetter(b.weekday, lang)),
            ),
          ),
        );
      };
      draw();
      redraws.add(draw);
      const offSettings = api.onSettingsChange(() => draw());
      return () => {
        redraws.delete(draw);
        offSettings();
        cancelPress();
      };
    },
  },
};
