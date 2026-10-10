// Module « Animations de l'île » : le halo de lumière autour de l'île
// (dessiné par src/island/halo.ts) branché sur les moments du PC, d'Ondine et
// des agents. Pas d'onglet : seulement des réglages, une case par moment.
//
// Désactiver le module éteint TOUS les halos (y compris ceux de la batterie,
// réglés dans le module Système, et « Ondine réfléchit »). L'intensité et les
// couleurs choisies ici s'appliquent à tous.
//
// D'où viennent les moments :
//   le Rust de ce module (src-tauri/src/modules/halos.rs) : sortie de veille,
//     Verr Maj / Verr Num, Copié / Coupé / Collé, touches de volume, Wi-Fi faible,
//     et le niveau du micro ou du son (commande `levels`) ;
//   les autres modules, par le bus : clés USB (Contrôles), téléchargements
//     (Étagère), disque presque plein et processeur (Système), météo, réseau,
//     captures, agents IA, Minuteur (le liseré qui se vide), Agenda, danse de
//     la mascotte, musique ;
//   l'île : un fichier lâché dessus.
// « Ondine réfléchit » et « Mise à jour disponible » sont appelés directement
// (ondineThinking dans halo.ts, et core/updates.ts).

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { pacedInterval } from "../../core/perf";
import type { IslandModule, ModuleManifest } from "../../core/module-types";
import { haloShown, hideHalo, mascotPalette, showHalo, updateHalo, type HaloOptions } from "../../island/halo";
import { MIN_PERIOD_MS, skyPalette } from "../../island/halo-palettes";
import { beatFrom, haloBeatMs, sameBeat, type Beat } from "../../mascot/beat";
import { calmMode } from "../../mascot/mascot-state";
import { dayKey, leaveDue, levelFromPeak, mediaPlaying, meetingCometMs, morningDue, parseTime, sessionProgress, timerHaloPlan, weatherKind, type TimerProgress } from "./halo-rules";

/** Un petit retour (Verr Maj, Copié…) : une ligne dans l'île, vite repartie. */
const KEY_NOTE_MS = 1600;

/** Lu et écrit sans jamais planter (localStorage peut être fermé). */
function remember(key: string, value?: string): string {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export const halos: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const on = (key: string) => api.settings()[key] !== false;
    /** Un halo, si sa case est cochée. */
    const halo = (key: string, o: HaloOptions) => {
      if (on(key)) showHalo(o);
    };
    const emote = (emotion: string) => {
      if (!calmMode()) api.emit("mascot.emote", { emotion });
    };
    const offs: (() => void)[] = [];
    /** La météo d'avant (pour ne réagir qu'au changement), et sa ligne pour le bonjour du matin. */
    let lastWeather: "rain" | "storm" | null = null;
    let weatherLine = "";
    let wasOffline = false;
    const listen = (topic: string, fn: (p: Record<string, unknown>) => void) =>
      offs.push(api.on(topic, (msg) => fn((msg.payload ?? {}) as Record<string, unknown>)));
    /** Le petit retour des événements du clavier : une ligne, et une comète de couleur dessous. */
    const keyNote = (title: string, icon: string, body?: string) =>
      api.notify({ title, body, icon, priority: "low", key: "halo-key", durationMs: KEY_NOTE_MS });

    // ── Le PC ──────────────────────────────────────────────────────────────
    listen("halos.wake", () => {
      halo("wake", { id: "wake", palette: "sunrise", shape: "rise", durationMs: 5000 });
      if (on("wake")) emote("stretch");
    });
    listen("controls.usb-added", () => halo("usb", { id: "usb", palette: "usb", shape: "sweep", from: "left", rhythm: "medium", durationMs: 2200 }));
    listen("controls.usb-ejected", (p) => {
      if (p.ok === false) return;
      halo("usb", { id: "usb", palette: "usb", shape: "sweep", from: "right", rhythm: "medium", durationMs: 1800 });
      if (on("usb")) emote("goodbye");
    });
    listen("shelf.downloaded", () => halo("download", { id: "download", palette: "drop", shape: "ripple", from: "center", rhythm: "medium", durationMs: 2600 }));
    listen("system.disk-low", (p) => {
      const free = typeof p.freePct === "number" ? p.freePct : 5;
      halo("disk", { id: "disk", palette: "disk", shape: "reservoir", fill: 1 - free / 100, durationMs: 6000 });
    });
    listen("halos.wifi", () => halo("wifi", { id: "wifi", palette: "wifi", shape: "crackle", durationMs: 4500 }));
    listen("weather.updated", (p) => {
      // Une fois par changement de temps : il se met à pleuvoir, l'orage arrive.
      const kind = weatherKind(p?.icon);
      if (kind === lastWeather) return;
      lastWeather = kind;
      if (kind) halo("weather", { id: "weather", palette: kind === "storm" ? "storm" : "rain", shape: "rain", durationMs: 8000 });
      weatherLine = p?.icon ? `${String(p.icon)} ${String(p.temp ?? "")} · ${String(p.label ?? "")}` : "";
    });
    listen("nettools.internet", (p) => {
      if (p.up === false) halo("network", { id: "network", palette: "offline", shape: "breathe", rhythm: "calm", priority: "normal" });
      else {
        hideHalo("network");
        if (wasOffline) halo("network", { id: "network-up", palette: "online", shape: "sweep", from: "left", rhythm: "medium", durationMs: 1600 });
      }
      wasOffline = p.up === false;
    });
    listen("capture.done", (p) => {
      if (p.ok !== false) halo("capture", { id: "capture", palette: "white", shape: "breathe", rhythm: 600, durationMs: 600 });
    });
    listen("island.files-dropped", () => halo("shelfDrop", { id: "drop", palette: "shelf", shape: "ripple", from: "center", rhythm: "medium", durationMs: 1800 }));
    listen("system.cpu-busy", (p) => {
      if (p.on) halo("cpu", { id: "cpu", palette: "cpu", shape: "breathe", rhythm: "slow", priority: "low" });
      else hideHalo("cpu");
    });

    // ── Agents IA ──────────────────────────────────────────────────────────
    listen("claude.thinking", () => halo("agents", { id: "agent-work", palette: "work", shape: "aurora", priority: "low" }));
    listen("claude.done", () => hideHalo("agent-work"));
    listen("agents.event", (p) => {
      if (p.kind === "done") {
        hideHalo("agent-work");
        hideHalo("agent-wait");
        halo("agents", { id: "agent-done", palette: "done", shape: "burst", durationMs: 3000 });
      } else if (p.kind === "waiting") {
        // « On a besoin de vous » : jusqu'à ce qu'on ouvre l'île (vu), 3 min au plus.
        halo("agents", { id: "agent-wait", palette: "waiting", shape: "comet", rhythm: 1600, priority: "high", durationMs: 180_000 });
      }
    });
    listen("agents.ask", () => halo("agents", { id: "agent-wait", palette: "waiting", shape: "comet", rhythm: 1600, priority: "high" }));
    listen("agents.ask.closed", () => hideHalo("agent-wait"));
    listen("island.state", (p) => {
      if (p.to === "expanded") hideHalo("agent-wait");
    });

    // ── Minuteurs : un liseré qui fait le tour de l'île et se vide ─────────
    // Minuteur (et les « 10 min » du Lanceur, d'Ondine, des Règles), Pomodoro
    // travail et pause. Le Minuteur ne publie qu'aux changements (lancé, pause,
    // +1 min, fini…) : halo.ts recalcule la longueur à chaque image depuis
    // `endsAt`, sans saut. En pause : figé. À la fin : un éclat.
    const timers = new Map<string, TimerProgress>();
    const showTimer = (p: TimerProgress, fresh: boolean) => {
      const plan = timerHaloPlan(p);
      if (!plan) return;
      if (plan.action === "hide" || !on("timerRing")) {
        hideHalo(plan.action === "done" ? plan.id.replace(/-done$/, "") : plan.id);
        return;
      }
      if (plan.action === "done") {
        hideHalo(plan.id.replace(/-done$/, ""));
        if (fresh) showHalo({ id: plan.id, palette: plan.palette, shape: "burst", priority: "high", durationMs: 2600 });
        return;
      }
      showHalo({ id: plan.id, palette: plan.palette, shape: "progress", endsAt: plan.endsAt, total: plan.total, fill: plan.fill, priority: "normal" });
    };
    listen("timer.progress", (p) => {
      const id = String(p.id ?? "");
      if (p.state === "running" || p.state === "paused") timers.set(id, p);
      else timers.delete(id);
      showTimer(p, true);
    });

    // ── Concentration (Minuteur) : un cocon qui se remplit comme une jauge, puis une fleur ──
    // (Avec le liseré des minuteurs, la séance a déjà sa jauge : pas de cocon en plus.)
    let focusTimer = 0;
    listen("timer.focus", (p) => {
      window.clearInterval(focusTimer);
      if (!p.on || on("timerRing")) return hideHalo("focus");
      const endsAt = typeof p.endsAt === "number" ? p.endsAt : null;
      const total = typeof p.total === "number" ? p.total : 0;
      const fill = () => Math.max(0.05, sessionProgress(Date.now(), endsAt, total));
      halo("focus", { id: "focus", palette: "focus", shape: "cocoon", from: "left", fill: fill(), priority: "low" });
      focusTimer = window.setInterval(() => updateHalo("focus", { fill: fill() }), 15_000);
    });
    listen("timer.work-session", (p) => {
      // Le liseré a déjà son éclat de fin.
      if (p.completed && !on("timerRing")) halo("focus", { id: "focus-bloom", palette: "bloom", shape: "burst", durationMs: 2800 });
    });

    // ── Rendez-vous : une comète toutes les 30 s, de plus en plus vite ─────
    let meetingTimer = 0;
    let meetingWait = 0;
    const meeting = (minutes: number) => {
      if (!on("meeting")) return;
      window.clearInterval(meetingTimer);
      window.clearTimeout(meetingWait);
      const at = Date.now() + minutes * 60_000;
      const comet = () => {
        const left = at - Date.now();
        if (left <= 0) return window.clearInterval(meetingTimer);
        const ms = meetingCometMs(left);
        showHalo({ id: "meeting", palette: "meeting", shape: "comet", rhythm: ms, durationMs: ms });
      };
      // Seulement dans les 5 dernières minutes.
      meetingWait = window.setTimeout(
        () => {
          comet();
          meetingTimer = window.setInterval(comet, 30_000);
        },
        Math.max(0, (minutes - 5) * 60_000),
      );
    };
    listen("agenda.reminder", (p) => meeting(typeof p.minutes === "number" ? p.minutes : 10));
    listen("agenda.join", (p) => meeting(typeof p.minutes === "number" ? p.minutes : 2));

    // ── Série du jour, danse ───────────────────────────────────────────────
    listen("agents.github-streak", () => {
      const today = dayKey(new Date());
      if (remember("halos.streak") === today) return;
      remember("halos.streak", today);
      halo("streak", { id: "streak", palette: "rainbow", shape: "burst", durationMs: 3200 });
    });
    // La danse vient de la musique (src/eggs/ : musique + mini-île) : elle
    // obéit aussi à « Le halo suit la musique ». Sans tempo mesuré, elle laisse
    // la place au halo qui suit vraiment le son quand il tourne (plus bas,
    // syncLevels). Avec le tempo (mascot.dance {bpm, phase}, src/eggs/dance.ts),
    // c'est elle qui se montre : le halo bat sur les mêmes temps que la
    // mascotte (un temps, ou deux au-delà de ~133 BPM : jamais plus de ~2
    // éclats par seconde), un éclat vif pour l'électro.
    let dancing = false;
    let danceBeat: Beat | null = null;
    let danceFlash = false;
    let danceShown: Beat | null = null;
    let levelsOn: "voice" | "music" | null = null;
    /** La danse a un vrai tempo, et le halo de la danse est permis : il passe devant celui du son. */
    const beatDance = () => dancing && danceBeat !== null && on("dance") && on("music");
    const syncDance = () => {
      if (dancing && on("dance") && on("music") && (danceBeat || levelsOn !== "music")) {
        const now = performance.now();
        // Une mesure presque pareille à la précédente : on ne touche à rien (pas de saut de la lueur).
        if (danceBeat && danceShown && sameBeat(danceShown, danceBeat, now) && haloShown("dance")) return;
        danceShown = danceBeat;
        showHalo({
          id: "dance",
          palette: mascotPalette(),
          shape: "breathe",
          rhythm: danceBeat ? haloBeatMs(danceBeat.bpm, MIN_PERIOD_MS) : 520,
          beatAt: danceBeat?.at ?? null,
          flash: danceBeat !== null && danceFlash,
          priority: "low",
        });
      } else {
        danceShown = null;
        hideHalo("dance");
      }
    };
    listen("mascot.dance", (p) => {
      dancing = p.on === true;
      danceBeat = dancing ? beatFrom(p.bpm, p.phase, performance.now()) : null;
      danceFlash = p.style === "electro";
      // Le tempo arrive ou se perd : le halo du son laisse la place, ou la reprend.
      syncLevels();
    });

    // ── Petits événements du clavier et du presse-papiers ──────────────────
    listen("halos.lock-key", (p) => {
      const caps = p.key === "caps";
      if (!on(caps ? "capsLock" : "numLock")) return;
      showHalo({ id: "key", palette: caps ? "caps" : "num", shape: "comet", rhythm: 1100, durationMs: 1100 });
      keyNote(`${caps ? "Verr Maj" : "Verr Num"} · ${p.on ? "Activé" : "Désactivé"}`, caps ? "⇪" : "🔢");
    });
    listen("halos.clip", (p) => {
      if (!on("clipboard")) return;
      const action = p.action === "cut" ? "cut" : p.action === "paste" ? "paste" : "copy";
      showHalo({ id: "key", palette: action, shape: "comet", rhythm: 1100, durationMs: 1100 });
      const title = action === "cut" ? "Coupé" : action === "paste" ? "Collé" : "Copié";
      const text = on("clipText") && typeof p.text === "string" ? p.text : undefined;
      keyNote(title, action === "cut" ? "✂️" : "📋", text);
    });
    listen("halos.volume", (p) => {
      if (!on("volumeKeys")) return;
      const volume = typeof p.volume === "number" ? p.volume : 0;
      showHalo({ id: "volume", palette: "volume", shape: "sweep", from: "left", fill: p.muted ? 0.02 : volume / 100, rhythm: "fast", durationMs: 1400 });
      keyNote(p.muted ? "Son coupé" : `Volume · ${volume} %`, p.muted ? "🔇" : "🔊");
    });

    // ── Visio et musique : le halo suit un niveau sonore ───────────────────
    let micInUse = false;
    let playing = false;
    let stopLevels: (() => void) | null = null;
    const syncLevels = () => {
      const mic = micInUse && on("voice");
      const out = !mic && playing && on("music") && !beatDance();
      const want = mic ? "voice" : out ? "music" : null;
      // Rien n'a changé (un réglage d'un autre moment) : on ne relance pas la lecture du niveau.
      if (want === levelsOn && (want === null || stopLevels)) return syncDance();
      levelsOn = want;
      if (!want) {
        stopLevels?.();
        stopLevels = null;
        hideHalo("voice");
        hideHalo("music");
        return syncDance();
      }
      const id = want;
      hideHalo(mic ? "music" : "voice");
      showHalo({ id, palette: mic ? "voice" : "music", shape: "level", priority: "low" });
      stopLevels?.();
      let busy = false;
      stopLevels = pacedInterval(() => {
        if (busy) return;
        busy = true;
        api
          .invoke<{ mic: number | null; out: number | null }>("levels", { mic, out })
          .then((l) => updateHalo(id, { level: levelFromPeak(mic ? l.mic : l.out) }))
          .catch(() => undefined)
          .finally(() => (busy = false));
      }, "halosLevel", true);
      syncDance();
    };
    // Parler à Ondine à voix haute : le halo tremble avec la voix tant que le micro écoute
    // (niveau envoyé par le Rust du module, ~15 fois par seconde).
    listen("voice.listening", (p) => {
      if (p.on) showHalo({ id: "ondine-voice", palette: "voice", shape: "level", priority: "high" });
      else hideHalo("ondine-voice");
    });
    listen("voice.level", (p) => {
      if (typeof p.level === "number") updateHalo("ondine-voice", { level: p.level });
    });
    listen("controls.media-use", (p) => {
      const now = Array.isArray(p.mic) && p.mic.length > 0;
      if (now === micInUse) return;
      micInUse = now;
      syncLevels();
    });
    listen("media.changed", (p) => {
      // Le module Musique publie le morceau ({playing: {status: "playing"…}}), pas un booléen.
      const now = mediaPlaying(p);
      if (now === null || now === playing) return;
      playing = now;
      syncLevels();
    });

    // ── Les moments de la journée : heure de partir, bonjour, couleurs du ciel ──
    let skyHour = -1;
    const clock = async () => {
      const now = new Date();
      // Heure de partir (réglage, du lundi au vendredi).
      if (leaveDue(now, parseTime(api.settings().leaveTime), remember("halos.leave"))) {
        remember("halos.leave", dayKey(now));
        showHalo({ id: "leave", palette: "sunset", shape: "set", durationMs: 7000 });
        api.notify({ title: "C'est l'heure de partir", body: "Bonne soirée !", icon: "🧣", priority: "normal", key: "halo-leave" });
        emote("scarf");
      }
      // Bonjour du matin : la première activité de la journée.
      if (on("morning") && remember("halos.morning") !== dayKey(now)) {
        const desk = await Bridge.deskState().catch(() => null);
        if (morningDue(now, desk?.idleMs ?? 0, remember("halos.morning"))) {
          remember("halos.morning", dayKey(now));
          showHalo({ id: "morning", palette: "morning", shape: "burst", durationMs: 3000 });
          api.notify({ title: "Bonjour !", body: weatherLine || undefined, icon: "🌅", priority: "low", key: "halo-morning" });
        }
      }
      // Les couleurs du ciel au repos (désactivé par défaut), changées à chaque heure.
      if (on("sky")) {
        if (now.getHours() !== skyHour) {
          skyHour = now.getHours();
          showHalo({ id: "sky", palette: skyPalette(skyHour).dark, shape: "aurora", rhythm: "slow", priority: "low" });
        }
      } else if (skyHour >= 0) {
        skyHour = -1;
        hideHalo("sky");
      }
    };
    const stopClock = pacedInterval(() => void clock(), "halosClock");
    // Une case cochée ou décochée pendant que ça joue : prise en compte tout de
    // suite (avant, la musique, la visio et la danse attendaient le prochain
    // changement de morceau ou de micro, et restaient allumées).
    offs.push(
      api.onSettingsChange(() => {
        syncLevels();
        for (const p of timers.values()) showTimer(p, false);
      }),
    );
    // Un premier coup d'œil peu après le démarrage (le bonjour d'un PC allumé le matin).
    const first = window.setTimeout(() => void clock(), 5000);

    return () => {
      for (const off of offs) off();
      stopClock();
      window.clearTimeout(first);
      window.clearInterval(focusTimer);
      window.clearInterval(meetingTimer);
      window.clearTimeout(meetingWait);
      stopLevels?.();
      for (const id of ["wake", "usb", "download", "disk", "wifi", "weather", "network", "network-up", "capture", "drop", "cpu", "agent-work", "agent-wait", "agent-done", "focus", "focus-bloom", "timer-timer", "timer-pomodoro", "timer-timer-done", "timer-pomodoro-done", "meeting", "streak", "dance", "key", "volume", "voice", "music", "leave", "morning", "sky"]) hideHalo(id);
    };
  },
};
