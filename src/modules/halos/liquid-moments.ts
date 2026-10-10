// Les moments du liquide À L'INTÉRIEUR de l'île (dessiné par
// src/island/liquid.ts), branchés par le module « Animations de l'île ».
// Une case par moment (réglages « liquid… » du manifeste), sous la case
// maîtresse « Animations à l'intérieur de l'île » (liquid).
//
//   Remplissages : minuteurs et Pomodoro (timer.progress), empreintes et
//     envois de fichiers (shelf.hash-progress, team.progress), téléchargement
//     arrivé (shelf.downloaded : Ondine plonge), batterie (system.battery-*),
//     disque presque plein (system.disk-low), agents IA (claude.thinking,
//     agents.progress, agents.event « done » : la vague de fin).
//   Ambiances : musique (le niveau du son, commande `levels` ; le tempo
//     `media.tempo` {bpm} viendra de l'analyse faite pour les danses), voix
//     (voice.level), pluie (weather.updated), processeur (system.cpu-busy),
//     nuit, notification (notify.shown), concentration (timer.focus).
//   Ondine flotte quand l'île est pleine (liquid.ts émet mascot.emote).

import type { ModuleApi } from "../../core/module-types";
import { pacedInterval } from "../../core/perf";
import { hideLiquid, liquidDive, liquidDrop, liquidWave, setLiquidAmbience, showLiquid, updateLiquid, type LiquidAmbience } from "../../island/liquid";
import { isNight } from "../../island/liquid-rules";
import { levelFromPeak, mediaPlaying, timerHaloPlan, weatherKind } from "./halo-rules";

/**
 * Le remplissage remplace-t-il le liseré des minuteurs ? (réglage « Minuteurs :
 * avec le liseré / à la place du liseré »).
 */
export function ringReplaced(values: Record<string, unknown>): boolean {
  return values.liquid !== false && values.liquidTimer !== false && values.liquidTimerStyle === "replace";
}

const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0);

export function liquidMoments(api: ModuleApi): () => void {
  const settings = () => api.settings();
  const on = (key: string) => settings().liquid !== false && settings()[key] !== false;
  const offs: (() => void)[] = [];
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
  const listen = (topic: string, fn: (p: Record<string, unknown>) => void) =>
    offs.push(api.on(topic, (msg) => fn((msg.payload ?? {}) as Record<string, unknown>)));
  /** Les liquides et ambiances allumés, et la case qui les commande (pour les éteindre quand on la décoche). */
  const shown = new Map<string, string>();
  const ambient = new Map<LiquidAmbience, string>();
  const show = (key: string, id: string, o: Parameters<typeof showLiquid>[0]) => {
    if (!on(key)) return;
    shown.set(id, key);
    showLiquid({ ...o, id });
  };
  const hide = (id: string) => {
    shown.delete(id);
    hideLiquid(id);
  };
  const ambience = (key: string, name: LiquidAmbience, want: boolean) => {
    const yes = want && on(key);
    if (yes) ambient.set(name, key);
    else ambient.delete(name);
    setLiquidAmbience(name, yes);
  };

  // ── Minuteurs : l'eau monte avec le temps (ou descend pendant une pause Pomodoro) ──
  listen("timer.progress", (p) => {
    const plan = timerHaloPlan(p);
    if (!plan) return;
    const id = `liquid-${plan.action === "done" ? plan.id.replace(/-done$/, "") : plan.id}`;
    if (plan.action === "hide") return hide(id);
    if (plan.action === "done") {
      // Elle arrive en haut, déborde doucement, puis s'en va.
      if (!shown.has(id)) return;
      show("liquidTimer", id, { level: 1, overflow: true, priority: "normal", durationMs: 3200 });
      return;
    }
    const rest = plan.palette === "rest";
    show("liquidTimer", id, {
      endsAt: plan.endsAt,
      total: plan.total,
      direction: rest ? "drain" : "fill",
      // En pause : figée à ce qui est fait (fill = ce qui reste).
      level: rest ? plan.fill : 1 - plan.fill,
      tint: rest ? "rest" : undefined,
      overflow: !rest,
      priority: "normal",
    });
  });

  // ── Fichiers : empreinte (Étagère), envoi à un collègue (Équipe), téléchargement arrivé ──
  const progress = (id: string, percent: unknown) => {
    const lv = pct(percent);
    show("liquidFiles", id, { level: lv, priority: "normal", durationMs: 30_000 });
    if (lv >= 1) later(() => hide(id), 1400);
  };
  listen("shelf.hash-progress", (p) => progress("liquid-hash", p.percent));
  listen("shelf.hashed", () => later(() => hide("liquid-hash"), 900));
  listen("team.progress", (p) => progress("liquid-team", p.percent));
  listen("shelf.downloaded", () => {
    if (!on("liquidFiles")) return;
    show("liquidFiles", "liquid-download", { level: 0.85, bubbles: 2.5, priority: "normal", durationMs: 2800 });
    if (on("liquidOndine")) liquidDive();
  });

  // ── Batterie : eau verte qui monte en charge, fond orange qui baisse quand elle est faible ──
  listen("system.battery-plug", (p) => {
    if (p.plugged) {
      hide("liquid-battery-low");
      if (p.charging !== false) show("liquidBattery", "liquid-battery", { level: Math.max(0.08, pct(p.percent)), tint: "charge", bubbles: p.fast === true ? 3 : 1.6, durationMs: 7000 });
    } else hide("liquid-battery");
  });
  listen("system.battery-full", () => show("liquidBattery", "liquid-battery", { level: 1, tint: "charge", bubbles: 0.6, durationMs: 4000 }));
  listen("system.battery-low", (p) => show("liquidBattery", "liquid-battery-low", { level: Math.max(0.05, pct(p.percent)), tint: "low", bubbles: 0, priority: "low" }));
  listen("system.battery-critical", (p) => show("liquidBattery", "liquid-battery-low", { level: Math.max(0.04, pct(p.percent)), tint: "critical", bubbles: 0, priority: "low" }));

  // ── Disque presque plein : une eau trouble qui stagne près du haut ──
  listen("system.disk-low", (p) => {
    const free = typeof p.freePct === "number" ? p.freePct : 5;
    show("liquidDisk", "liquid-disk", { level: Math.max(0.82, Math.min(0.96, 1 - free / 100)), tint: "murky", murky: true, bubbles: 0, durationMs: 8000 });
  });

  // ── Agents IA : un courant tant qu'il travaille, puis une vague de fin ──
  const agentDone = () => {
    if (!shown.has("liquid-agent") && !shown.has("liquid-agent-steps")) return;
    if (on("liquidAgents")) liquidWave();
    later(() => {
      hide("liquid-agent");
      hide("liquid-agent-steps");
    }, 1500);
  };
  listen("claude.thinking", () => show("liquidAgents", "liquid-agent", { level: 0.34, current: true, tint: "agent", bubbles: 0.5, priority: "low" }));
  listen("claude.done", agentDone);
  listen("agents.event", (p) => {
    if (p.kind === "done") agentDone();
  });
  listen("agents.progress", (p) => {
    const total = typeof p.total === "number" && p.total > 0 ? p.total : 0;
    const step = typeof p.step === "number" ? p.step : 0;
    if (!total) return;
    show("liquidAgents", "liquid-agent-steps", { level: Math.max(0.06, step / total), current: true, tint: "agent", priority: "normal", durationMs: 120_000 });
    if (step >= total) agentDone();
  });

  // ── Musique : la surface ondule avec le son (et au tempo, quand il est donné) ──
  let playing = false;
  let stopLevel: (() => void) | null = null;
  const syncMusic = () => {
    const want = playing && on("liquidMusic");
    if (!want) {
      stopLevel?.();
      stopLevel = null;
      return hide("liquid-music");
    }
    if (stopLevel) return;
    show("liquidMusic", "liquid-music", { level: 0.28, wobble: 0, priority: "low" });
    let busy = false;
    stopLevel = pacedInterval(() => {
      if (busy) return;
      busy = true;
      api
        .invoke<{ mic: number | null; out: number | null }>("levels", { mic: false, out: true })
        .then((l) => updateLiquid("liquid-music", { wobble: levelFromPeak(l.out) }))
        .catch(() => undefined)
        .finally(() => (busy = false));
    }, "halosLevel", true);
  };
  listen("media.changed", (p) => {
    const now = mediaPlaying(p);
    if (now === null || now === playing) return;
    playing = now;
    syncMusic();
  });
  // Le tempo mesuré pour les danses (une autre zone le publiera) : { bpm }.
  const tempo = (p: Record<string, unknown>) => {
    if (typeof p.bpm === "number") updateLiquid("liquid-music", { bpm: p.bpm });
  };
  listen("media.tempo", tempo);
  listen("mascot.dance", tempo);

  // ── Voix (Parler à Ondine) : la surface vibre avec le micro ──
  listen("voice.listening", (p) => {
    if (p.on) show("liquidVoice", "liquid-voice", { level: 0.3, vibrate: true, wobble: 0, bubbles: 0.4, priority: "high" });
    else hide("liquid-voice");
  });
  listen("voice.level", (p) => {
    if (typeof p.level === "number") updateLiquid("liquid-voice", { wobble: p.level });
  });

  // ── Ambiances ──
  listen("weather.updated", (p) => ambience("liquidRain", "rain", weatherKind(p?.icon) !== null));
  listen("system.cpu-busy", (p) => ambience("liquidCpu", "boil", p.on === true));
  listen("timer.focus", (p) => ambience("liquidFocus", "still", p.on === true));
  listen("notify.shown", (p) => {
    // Pas pour les petits retours du clavier (Verr Maj, Copié…) : trop fréquents.
    if (p.moduleId === "halos" || !on("liquidNotify")) return;
    liquidDrop();
  });
  const night = () => ambience("liquidNight", "stars", isNight(new Date()));
  const stopClock = pacedInterval(night, "halosClock");
  later(night, 3000);

  // Une case décochée pendant que ça joue : éteint tout de suite.
  offs.push(
    api.onSettingsChange(() => {
      for (const [id, key] of [...shown]) if (!on(key)) hide(id);
      for (const [name, key] of [...ambient]) if (!on(key)) ambience(key, name, false);
      syncMusic();
      night();
    }),
  );

  return () => {
    for (const off of offs) off();
    for (const t of timers) window.clearTimeout(t);
    stopClock();
    stopLevel?.();
    for (const id of [...shown.keys()]) hideLiquid(id);
    for (const name of ["rain", "boil", "stars", "still"] as const) setLiquidAmbience(name, false);
  };
}
