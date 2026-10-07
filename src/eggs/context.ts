// Les réactions au PC : pas de code secret, Ondine réagit à ce qui se passe.
//
//   3 agents IA au travail en même temps  → cheffe d'orchestre (baguette, notes)
//   un agent qui finit après plus d'une heure → victoire et confettis
//   de 2 h à 6 h                          → bonnet de nuit ; une fois par nuit,
//                                           « Il serait temps de dormir, non ? »
//   PC allumé depuis plus de 7 jours        → une toile d'araignée dans un coin
//   100e capture                            → flash de photographe, elle prend la pose
//   vendredi à partir de 17 h               → lunettes de soleil
//   lundi de 8 h 30 à 10 h 30               → une tasse de café fumante
//   volume à 100 %                          → elle se bouche les oreilles
//   batterie à 2 % ou moins, débranchée     → panique ; branchée → soulagement
//   le même texte copié 5 fois de suite     → « C'est bon, je l'ai ! »
//
// Les données viennent des modules (Agents IA, Système, Contrôles,
// Presse-papiers), seulement s'ils sont activés, et rien ne sort du PC : on ne
// garde que des nombres et l'aperçu de la dernière copie, en mémoire.

import { Bridge } from "../core/bridge";
import type { Bus } from "../core/bus";
import type { NotificationQueue } from "../core/notifications";
import { settingsStore } from "../core/settings-store";
import type { IslandState } from "../island/island-state";
import { dayKey } from "./calendar";
import type { FxLayer } from "./fx-layer";
import type { Accessory, MascotFx } from "./mascot-fx";

/** Ce que les réactions utilisent d'EasterEggs. */
export interface ReactionKit {
  bus: Bus;
  notifications: NotificationQueue;
  fx: FxLayer;
  mfx: MascotFx;
  shell: HTMLElement;
  state(): IslandState;
  hasMascot(): boolean;
  /** Les réactions peuvent-elles se montrer (réglage, présentation) ? */
  allowed(): boolean;
  visuals(): boolean;
  play(animation: string, emotion: string): void;
  emote(emotion: string): void;
  discover(id: string): void;
  recall(key: string): string | null;
  remember(key: string, value: string): void;
}

const HOUR = 3600_000;
const WEEK_SECS = 7 * 24 * 3600;
const TICK_MS = 60_000;
/** Le volume est relu au plus toutes les… (île visible seulement). */
const VOLUME_EVERY_MS = 15_000;
const CAPTURES_GOAL = 100;
const SAME_COPIES = 5;

/** L'accessoire de l'heure (sans les données du PC), ou null. Pur : testé. */
export function clockAccessory(d: Date): Accessory | null {
  const day = d.getDay(); // 0 = dimanche
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (day === 5 && minutes >= 17 * 60) return "glasses";
  if (d.getHours() >= 2 && d.getHours() < 6) return "nightcap";
  if (day === 1 && minutes >= 8 * 60 + 30 && minutes < 10 * 60 + 30) return "coffee";
  return null;
}

/** Quel trésor pour quel accessoire. */
const ACCESSORY_TREASURE: Record<Accessory, string> = {
  ears: "loud",
  baton: "conductor",
  glasses: "friday",
  nightcap: "pyjama",
  coffee: "coffee",
};

interface AgentSession {
  id: string;
  state: string;
  since: number;
}

async function invoke<T>(module: string, command: string, args: unknown = null): Promise<T | null> {
  if (!settingsStore.moduleEnabled(module)) return null;
  try {
    return await Bridge.moduleInvoke<T>(module, command, args);
  } catch {
    return null; // hors de l'appli, ou module arrêté : pas de réaction
  }
}

export class PcReactions {
  private working = 0;
  private sessions = new Map<string, AgentSession>();
  private loud = false;
  private lastVolume = 0;
  private uptimeChecked = 0;
  private batteryWatch = 0;
  private panicked = false;
  private lastCopy = { key: "", at: 0, streak: 0 };
  private offs: (() => void)[] = [];

  constructor(private readonly kit: ReactionKit) {
    const on = (topic: string, fn: (payload: any) => void) => this.offs.push(kit.bus.on(topic, (m) => fn(m.payload), "eggs"));
    on("agents.changed", () => void this.agents());
    on("capture.done", (p: { ok?: boolean } | null) => p?.ok && this.capture());
    on("clipboard.changed", () => void this.clipboard());
    on("system.battery-low", () => this.watchBattery());
    on("island.state", (p: { to: IslandState }) => p.to !== "hidden" && this.visible());
    const tick = window.setInterval(() => {
      this.refresh();
      if (kit.state() !== "hidden") void this.volume();
    }, TICK_MS);
    this.offs.push(() => window.clearInterval(tick));
    void this.agents();
    this.refresh();
  }

  destroy() {
    for (const off of this.offs) off();
    window.clearInterval(this.batteryWatch);
  }

  /** Choisit l'accessoire du moment : le plus important gagne. */
  refresh() {
    const want: Accessory | null = !this.kit.allowed() || !this.kit.hasMascot()
      ? null
      : this.loud
        ? "ears"
        : this.working >= 3
          ? "baton"
          : clockAccessory(new Date());
    this.kit.mfx.setAccessory(want);
    if (want && this.kit.state() !== "hidden") this.kit.discover(ACCESSORY_TREASURE[want]);
  }

  /** L'île devient visible : volume, toile d'araignée, mot de la nuit. */
  private visible() {
    this.refresh();
    void this.volume();
    void this.uptime();
    const now = new Date();
    if (now.getHours() >= 2 && now.getHours() < 6 && this.kit.allowed() && this.kit.recall("night") !== dayKey(now)) {
      this.kit.remember("night", dayKey(now));
      this.kit.play("fatigue", "bored");
      this.kit.notifications.push({ moduleId: "island", title: "Il serait temps de dormir, non ?", icon: "🌙", priority: "low", key: "night" });
    }
  }

  // ── Agents IA ──────────────────────────────────────────────────────────────

  private async agents() {
    const h = await invoke<{ working: number; sessions: AgentSession[] }>("agents", "history");
    if (!h) return;
    const before = this.working;
    this.working = h.working ?? 0;
    const now = Date.now();
    for (const s of h.sessions ?? []) {
      const prev = this.sessions.get(s.id);
      // Une session qui travaillait depuis plus d'une heure vient de finir.
      if (prev?.state === "working" && s.state === "done" && now - prev.since > HOUR && this.kit.allowed()) {
        this.kit.play("victoire", "celebrate");
        this.kit.discover("marathon");
      }
    }
    this.sessions = new Map((h.sessions ?? []).map((s) => [s.id, s]));
    if ((before >= 3) !== (this.working >= 3)) this.refresh();
  }

  // ── Captures ───────────────────────────────────────────────────────────────

  private capture() {
    const n = (Number(this.kit.recall("captures")) || 0) + 1;
    this.kit.remember("captures", String(n));
    if (n !== CAPTURES_GOAL || !this.kit.allowed()) return;
    if (this.kit.visuals()) void this.kit.fx.play("flash");
    this.kit.emote("wink");
    this.kit.discover("photographer");
  }

  // ── Presse-papiers ─────────────────────────────────────────────────────────

  private async clipboard() {
    const list = await invoke<{ items: { preview: string; chars: number; at: number }[] }>("clipboard", "list", { query: "" });
    const items = list?.items ?? [];
    if (!items.length) return;
    // La plus récente (les épinglées passent devant dans la liste).
    const top = items.reduce((a, b) => (b.at > a.at ? b : a));
    if (top.at === this.lastCopy.at) return; // épinglé, supprimé… pas une nouvelle copie
    const key = `${top.chars}:${top.preview}`;
    const streak = key === this.lastCopy.key ? this.lastCopy.streak + 1 : 1;
    this.lastCopy = { key, at: top.at, streak };
    if (streak !== SAME_COPIES || !this.kit.allowed()) return;
    this.kit.emote("wink");
    this.kit.notifications.push({ moduleId: "island", title: "C'est bon, je l'ai !", icon: "📋", priority: "low", key: "copycat" });
    this.kit.discover("copycat");
  }

  // ── Volume ─────────────────────────────────────────────────────────────────

  private async volume() {
    const now = Date.now();
    if (now - this.lastVolume < VOLUME_EVERY_MS) return;
    this.lastVolume = now;
    const s = await invoke<{ speakers: { volume: number; muted: boolean } | null }>("controls", "state");
    const loud = !!s?.speakers && s.speakers.volume >= 100 && !s.speakers.muted;
    if (loud === this.loud) return;
    this.loud = loud;
    if (loud && this.kit.allowed()) this.kit.play("agacee-colere", "annoyed");
    this.refresh();
  }

  // ── PC jamais redémarré ────────────────────────────────────────────────────

  private async uptime() {
    if (Date.now() - this.uptimeChecked < HOUR) return;
    this.uptimeChecked = Date.now();
    const s = await invoke<{ uptimeSecs: number }>("system", "snapshot");
    const web = !!s && s.uptimeSecs > WEEK_SECS && this.kit.allowed();
    let el = this.kit.shell.querySelector<HTMLElement>(".egg-web");
    if (web && !el) {
      el = document.createElement("span");
      el.className = "egg-web";
      el.setAttribute("aria-hidden", "true");
      this.kit.shell.append(el);
      this.kit.discover("cobweb");
    } else if (!web) el?.remove();
  }

  // ── Batterie presque vide ──────────────────────────────────────────────────

  /** Après « batterie faible », on regarde la batterie chaque minute jusqu'à ce qu'on branche. */
  private watchBattery() {
    if (this.batteryWatch) return;
    const check = async () => {
      const s = await invoke<{ battery: { percent: number | null; plugged: boolean } | null }>("system", "snapshot");
      const b = s?.battery;
      if (!b || b.percent == null) return this.stopBattery();
      if (b.plugged) {
        if (this.panicked && this.kit.allowed()) {
          this.kit.emote("calm");
          this.kit.discover("battery");
        }
        return this.stopBattery();
      }
      if (b.percent <= 2 && !this.panicked && this.kit.allowed()) {
        this.panicked = true;
        this.kit.play("attention", "warning");
      }
    };
    this.batteryWatch = window.setInterval(() => void check(), TICK_MS);
    void check();
  }

  private stopBattery() {
    window.clearInterval(this.batteryWatch);
    this.batteryWatch = 0;
    this.panicked = false;
  }
}
