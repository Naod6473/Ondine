// Le sous-onglet « Ambiance » du Minuteur (1.2.3) : choisir un son, le lancer,
// l'arrêter, régler le volume, et le laisser suivre le Pomodoro.
//
// Pendant qu'un son joue, « timer.ambient » part sur le bus : au lancement, à
// l'arrêt, au changement de volume, et le niveau du son quatre fois par
// seconde (seulement quand il a bougé). Le module « Animations de l'île »
// (liquid-moments.ts) en fait bouger le liquide de l'île : pluie sur la
// vitre, vague à chaque crête, surface qui ondule avec le son.
//
// Le choix du son est retenu dans ce navigateur (localStorage, une simple
// commodité) ; le volume et « Avec le Pomodoro » sont des réglages du module.

import type { ModuleApi } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import { errorText } from "../../core/log";
import { el } from "../../island/dom";
import { setText } from "../../core/perf";
import { ambientList, pickSound, WAVE_PERIOD_MS, type AmbientNews, type AmbientSound } from "./ambient-logic";
import { ambientLevel, ambientPlaying, playAmbient, setAmbientVolume, stopAmbient, unlockAmbient } from "./ambient";

/** Les enregistrements déposés dans src/assets/ambient/ (trouvés au build). */
const FILES = import.meta.glob<string>("../../assets/ambient/*.{mp3,ogg,wav,m4a}", { eager: true, query: "?url", import: "default" });
export const SOUNDS: AmbientSound[] = ambientList(FILES);

const CHOICE_KEY = "ondine.ambient.sound";
const LEVEL_EVERY_MS = 250;

function savedChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function saveChoice(id: string) {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch {
    // navigation privée, stockage bloqué : tant pis, la pluie par défaut
  }
}

let choice: AmbientSound = pickSound(SOUNDS, savedChoice());
/** Lancé par le Pomodoro (et donc arrêté par lui à la pause). */
let byPomodoro = false;
let levelTimer = 0;
let lastLevel = -1;
let lastLevelAt = 0;
let lastError = "";
const views = new Set<() => void>();

const volume = (api: ModuleApi) => Number(api.settings().ambientVolume ?? 40);

function news(api: ModuleApi, extra: Partial<AmbientNews> = {}) {
  const p = ambientPlaying();
  const payload: AmbientNews = p
    ? { on: true, sound: p.sound.id, kind: p.sound.kind, volume: volume(api), startedAt: p.startedAt, periodMs: WAVE_PERIOD_MS, ...extra }
    : { on: false };
  api.emit("timer.ambient", payload);
}

/** Le niveau du son, pour le liquide : 4 fois par seconde, seulement s'il a bougé. */
function startLevels(api: ModuleApi) {
  window.clearInterval(levelTimer);
  levelTimer = window.setInterval(() => {
    if (!ambientPlaying()) return window.clearInterval(levelTimer);
    const level = Math.round(ambientLevel() * 20) / 20;
    const now = Date.now();
    if (level === lastLevel && now - lastLevelAt < 3000) return;
    lastLevel = level;
    lastLevelAt = now;
    news(api, { level });
  }, LEVEL_EVERY_MS);
}

export async function startSound(api: ModuleApi, sound: AmbientSound, auto = false) {
  choice = sound;
  saveChoice(sound.id);
  byPomodoro = auto;
  lastError = "";
  try {
    await playAmbient(sound, volume(api));
    news(api);
    startLevels(api);
  } catch (err) {
    lastError = errorText(err);
  }
  for (const v of views) v();
}

export function stopSound(api: ModuleApi) {
  const was = !!ambientPlaying();
  stopAmbient();
  byPomodoro = false;
  window.clearInterval(levelTimer);
  if (was) news(api);
  for (const v of views) v();
}

/**
 * Appelé à chaque tour du Minuteur : avec le réglage « Lancer avec le
 * Pomodoro », le son part au début d'une séance de travail et s'arrête à la
 * pause (seulement s'il a été lancé ainsi : un son lancé à la main reste).
 */
export function ambientFollowPomodoro(api: ModuleApi, working: boolean) {
  if (!api.settings().ambientWithPomodoro) return;
  const p = ambientPlaying();
  if (working && !p) void startSound(api, choice, true);
  else if (!working && p && byPomodoro) stopSound(api);
}

/** Le module s'arrête (coupé, île fermée) : le son aussi. */
export function ambientTeardown(api: ModuleApi) {
  stopSound(api);
}

/** Le sous-onglet. Renvoie la mise à jour (appelée à chaque image, ne réécrit que ce qui change). */
export function drawAmbient(api: ModuleApi, body: HTMLElement): () => void {
  const chips = SOUNDS.map((s) =>
    el(
      "button",
      { class: "btn small ambient-chip", "data-id": s.id, title: s.kind === "file" ? "Enregistrement" : "Fabriqué par Ondine, sans fichier", onclick: api.handler(() => (unlockAmbient(), ambientPlaying() ? startSound(api, s) : ((choice = s), saveChoice(s.id), redraw()))) },
      `${s.icon} ${s.label}`,
    ),
  );
  const toggle = el("button", { class: "btn primary", onclick: api.handler(() => (unlockAmbient(), ambientPlaying() ? stopSound(api) : startSound(api, choice))) }, "▶ Écouter");
  const slider = el("input", { class: "ambient-volume", type: "range", min: 0, max: 100, step: 1, "aria-label": "Volume" }) as HTMLInputElement;
  slider.value = String(volume(api));
  const volText = el("small", { class: "muted ambient-vol-text", "data-no-i18n": true });
  // En glissant : le son suit tout de suite ; au lâcher : le réglage est enregistré.
  slider.addEventListener("input", () => {
    setAmbientVolume(Number(slider.value));
    setText(volText, `${slider.value} %`);
  });
  slider.addEventListener(
    "change",
    api.handler(async () => {
      const v = Math.round(Number(slider.value));
      await settingsStore.update((d) => {
        const entry = (d.modules.timer ??= { enabled: true, values: {} });
        entry.values.ambientVolume = v;
      });
      if (ambientPlaying()) news(api);
    }),
  );
  const withPomo = el("input", { type: "checkbox" }) as HTMLInputElement;
  withPomo.checked = Boolean(api.settings().ambientWithPomodoro);
  withPomo.addEventListener(
    "change",
    api.handler(() =>
      settingsStore.update((d) => {
        const entry = (d.modules.timer ??= { enabled: true, values: {} });
        entry.values.ambientWithPomodoro = withPomo.checked;
      }),
    ),
  );
  const status = el("p", { class: "muted timer-hint ambient-status" });
  body.append(
    el(
      "div",
      { class: "ambient" },
      el("div", { class: "chips ambient-chips" }, ...chips),
      el("div", { class: "btn-row ambient-row" }, toggle, el("span", { class: "ambient-vol-icon", "aria-hidden": "true" }, "🔈"), slider, volText),
      el("label", { class: "team-check" }, withPomo, "Lancer avec le Pomodoro (et arrêter à la pause)"),
      status,
    ),
  );
  let shown = "";
  const redraw = () => {
    shown = "";
  };
  views.add(redraw);
  const update = () => {
    if (!body.isConnected) {
      views.delete(redraw);
      return;
    }
    const p = ambientPlaying();
    const key = `${p?.sound.id ?? ""}|${choice.id}|${lastError}`;
    if (key === shown) return;
    shown = key;
    for (const c of chips) {
      c.classList.toggle("active", c.dataset.id === choice.id);
      c.classList.toggle("playing", c.dataset.id === p?.sound.id);
    }
    setText(toggle, p ? "⏹ Arrêter" : "▶ Écouter");
    toggle.classList.toggle("playing", !!p);
    setText(volText, `${slider.value} %`);
    setText(status, lastError ? `⚠️ ${lastError}` : p ? "Le liquide de l'île suit le son." : "Pluie, vagues et bruit doux sont fabriqués par Ondine, sans fichier ni Internet.");
  };
  return update;
}
