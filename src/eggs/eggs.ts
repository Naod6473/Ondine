// Les surprises cachées d'Ondine (easter eggs) : qui déclenche quoi.
//
//   Lanceur, mot magique + Entrée (« easter.word ») :
//     « réveille-toi »  → pluie de code (Ondine bugge, puis esquive une goutte au ralenti)
//     « rétro »          → mode 8 bits (comme le code Konami)
//     « tonneau »        → l'île fait un tour complet
//     « la réponse »     → Ondine réfléchit… puis répond 42
//   Code Konami (↑ ↑ ↓ ↓ ← → ← → B A), île ouverte → mode 8 bits jusqu'à ce que l'île se cache
//   15 clics rapides sur Ondine → elle se divise en deux gouttes, puis se recolle
//   2 tours de souris autour d'elle → le tournis
//   De la musique et la mini-île → Ondine danse tant que ça joue (tous les jours,
//     ce n'est pas une surprise : seulement si la mascotte a une animation « danse »)
//   De temps en temps, mini-île tranquille → Ondine traverse la mini-île en
//     mangeant son contenu (≈ 6 s), puis tout revient (« le goûter »)
//   Le calendrier, à l'ouverture de l'île (une fois par jour) : 1er janvier,
//     14 février, 1er avril (poisson dans le dos), 21 juin (danser le jour de
//     la Fête de la musique), 14 juillet, 31 octobre (fantôme), décembre (neige) ; et avec la
//     Météo : jour de pluie, canicule.
//
// Et les réactions au PC (agents IA, nuit, volume, batterie…) : voir context.ts.
//
// Règles : réglage « Surprises » (toutes / le calendrier seulement / aucune),
// rien pendant une présentation, et avec « réduire les animations » ou en
// économie d'énergie, Ondine réagit sans les grands effets. Chaque surprise
// découverte entre dans le carnet des trésors (réglage mascot.treasures).

import type { Bus } from "../core/bus";
import type { NotificationQueue } from "../core/notifications";
import { perfMode } from "../core/perf";
import { settingsStore } from "../core/settings-store";
import type { IslandState } from "../island/island-state";
import { setRetroSound, sounds } from "../island/sounds";
import { reducedMotion } from "../island/tab-pill";
import type { MascotManifest } from "../mascot/types";
import { dayKey, isHot, isRainy, seasonOf, type WeatherLike } from "./calendar";
import { PcReactions } from "./context";
import { FxLayer } from "./fx-layer";
import { MascotFx } from "./mascot-fx";
import { TREASURES, treasure } from "./treasures";
import { KeySequence, SpinCounter, type MagicWord } from "./words";

/** Clics rapides (moins de 600 ms d'écart) pour que la goutte se divise. */
const SPLIT_CLICKS = 15;
const CLICK_GAP_MS = 600;
/** La neige revient au plus toutes les 20 minutes (et le tas grossit). */
const SNOW_EVERY_MS = 20 * 60_000;
/** Le goûter : au plus une fois toutes les 20 minutes, une chance sur quatre à chaque coup d'œil (30 s). */
const SNACK_EVERY_MS = 20 * 60_000;
const SNACK_CHECK_MS = 30_000;
const SNACK_CHANCE = 0.25;
/** La souris doit avoir quitté la mini-île depuis au moins… */
const SNACK_QUIET_MS = 8000;

export interface EggHooks {
  shell: HTMLElement;
  slot: HTMLElement;
  state(): IslandState;
  /** Le manifeste de la mascotte affichée (null : pas de mascotte). */
  manifest(): MascotManifest | null;
}

/** Lire et écrire un petit souvenir (« déjà joué aujourd'hui ») ; sans stockage, on rejoue. */
function recall(key: string): string | null {
  try {
    return localStorage.getItem(`ondine.eggs.${key}`);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(`ondine.eggs.${key}`, value);
  } catch {
    // pas de stockage : tant pis
  }
}

export class EasterEggs {
  private fx: FxLayer;
  private mfx: MascotFx;
  private konami = new KeySequence();
  private spin = new SpinCounter();
  private clicks: number[] = [];
  private retro = false;
  private busy = false;
  private weather: WeatherLike | null = null;
  private music = false;
  private dancing = false;
  private lastSnack = Date.now();
  private snackWanted = false;
  /** Dernière fois que la souris était sur l'île. */
  private lastHover = 0;
  private offs: (() => void)[] = [];
  private reactions: PcReactions;

  constructor(
    private readonly hooks: EggHooks,
    private readonly bus: Bus,
    private readonly notifications: NotificationQueue,
  ) {
    this.fx = new FxLayer(hooks.shell);
    this.mfx = new MascotFx(hooks.slot);
    const on = (topic: string, fn: (payload: any) => void) => this.offs.push(this.bus.on(topic, (m) => fn(m.payload), "eggs"));
    on("easter.word", (p: { word?: MagicWord } | null) => p?.word && this.word(p.word));
    on("mascot.clicked", () => this.clicked());
    on("island.state", (p: { from: IslandState; to: IslandState }) => this.stateChanged(p.from, p.to));
    on("weather.updated", (line: WeatherLike | null) => (this.weather = line));
    // Bouton « Essayer » des réglages : au prochain passage en mini-île.
    on("easter.snack", () => {
      this.snackWanted = true;
      if (this.hooks.state() === "compact") void this.snack();
    });
    const timer = window.setInterval(() => this.maybeSnack(), SNACK_CHECK_MS);
    this.offs.push(() => window.clearInterval(timer));
    on("media.changed", (p: { playing?: boolean } | null) => {
      this.music = !!p?.playing;
      this.syncDance();
    });
    const keys = (e: KeyboardEvent) => {
      if (this.hooks.state() !== "expanded") return;
      if (this.konami.push(e.key) && this.allowed("secret") && this.hooks.manifest()) this.setRetro(!this.retro);
    };
    window.addEventListener("keydown", keys);
    this.offs.push(() => window.removeEventListener("keydown", keys));
    this.applyDay();
    // Les réactions au PC (context.ts) : permises sauf avec « Surprises : aucune ».
    this.reactions = new PcReactions({
      bus,
      notifications,
      fx: this.fx,
      mfx: this.mfx,
      shell: hooks.shell,
      state: () => hooks.state(),
      hasMascot: () => !!hooks.manifest(),
      allowed: () => this.allowed("seasonal"),
      visuals: () => this.visuals(),
      play: (a, e) => this.play(a, e),
      emote: (e) => this.emote(e),
      discover: (id) => this.discover(id),
      recall,
      remember,
    });
    // Le réglage change (Surprises : aucune…) : l'accessoire suit.
    this.offs.push(settingsStore.onChange(() => this.reactions.refresh()));
  }

  destroy() {
    this.reactions.destroy();
    for (const off of this.offs) off();
    this.fx.clear();
    this.mfx.destroy();
  }

  /** La souris (px de la fenêtre) : on compte les tours autour d'Ondine, et on note le survol de l'île. */
  pointer(x: number, y: number) {
    const s = this.hooks.shell.getBoundingClientRect();
    if (x >= s.left - 12 && x <= s.right + 12 && y >= s.top - 12 && y <= s.bottom + 12) this.lastHover = Date.now();
    if (!["compact", "expanded"].includes(this.hooks.state())) return;
    const m = this.hooks.slot.getBoundingClientRect();
    const dx = x - (m.left + m.width / 2);
    const dy = y - (m.top + m.height / 2);
    if (!this.spin.push(dx, dy, performance.now())) return;
    if (!this.allowed("secret") || !this.hooks.manifest() || this.mfx.splitting) return;
    this.play("etourdie", "dizzy");
    this.discover("spin");
  }

  // ── Règles ─────────────────────────────────────────────────────────────────

  /** Une surprise de ce genre peut-elle se montrer maintenant ? */
  private allowed(kind: "secret" | "seasonal"): boolean {
    const mode = settingsStore.current.mascot.surprises ?? "all";
    if (mode === "none" || (mode === "seasonal" && kind === "secret")) return false;
    return !document.body.classList.contains("presenting");
  }

  /** Les grands effets (pluie, feux d'artifice…) : pas avec « réduire les animations » ni en économie d'énergie. */
  private visuals(): boolean {
    return !reducedMotion() && perfMode() !== "eco";
  }

  /** Joue une animation de la mascotte si elle l'a, sinon montre une émotion. */
  private play(animation: string, emotion: string) {
    const m = this.hooks.manifest();
    if (!m) return;
    if (m.animations.some((a) => a.name === animation)) this.bus.emit("mascot.play", { animation }, "eggs");
    else this.bus.emit("mascot.emote", { emotion }, "eggs");
  }

  private emote(emotion: string) {
    if (this.hooks.manifest()) this.bus.emit("mascot.emote", { emotion }, "eggs");
  }

  /** Où est Ondine dans l'île (px CSS), pour viser les effets. */
  private focus() {
    const s = this.hooks.shell.getBoundingClientRect();
    const m = this.hooks.slot.getBoundingClientRect();
    return { x: m.left - s.left + m.width / 2, y: m.top - s.top + m.height / 2, size: Math.max(24, m.width) };
  }

  /** Un trésor trouvé : dans le carnet, avec une petite notification la première fois. */
  private discover(id: string) {
    const t = treasure(id);
    const list = settingsStore.current.mascot.treasures ?? [];
    if (!t || list.includes(id)) return;
    const next = [...list, id];
    void settingsStore.update((d) => {
      d.mascot.treasures = [...new Set([...(d.mascot.treasures ?? []), id])];
    });
    this.notifications.push({
      moduleId: "island",
      title: t.name,
      body: `Trésor trouvé (${next.length} / ${TREASURES.length}) : à retrouver dans Réglages → Mascotte.`,
      icon: "✨",
      priority: "low",
      key: "treasure",
    });
  }

  // ── Les mots magiques du Lanceur ───────────────────────────────────────────

  private word(word: MagicWord) {
    if (!this.allowed("secret")) return;
    switch (word) {
      case "code-rain":
        void this.codeRain();
        break;
      case "retro":
        if (this.hooks.manifest()) this.setRetro(!this.retro);
        break;
      case "barrel-roll":
        this.barrelRoll();
        break;
      case "answer":
        this.answer();
        break;
    }
  }

  /** La pluie de code : Ondine bugge, une goutte passe au ralenti, elle l'esquive, clin d'œil. */
  private async codeRain() {
    if (this.busy) return;
    this.busy = true;
    this.discover("code-rain");
    sounds.glitch();
    this.play("pluie-glitch", "surprise");
    if (!this.visuals()) {
      window.setTimeout(() => this.emote("wink"), 1500);
      this.busy = false;
      return;
    }
    const timers = [
      window.setTimeout(() => {
        sounds.whoosh();
        this.play("esquive", "surprise");
      }, 2200),
      window.setTimeout(() => this.emote("wink"), 4600),
    ];
    await this.fx.play("code-rain", { focus: this.focus() });
    timers.forEach((t) => window.clearTimeout(t));
    this.busy = false;
  }

  /** Le mode 8 bits : Ondine en gros pixels, sons de console, l'île en style rétro. */
  private setRetro(on: boolean) {
    if (on === this.retro) return;
    this.retro = on;
    document.body.classList.toggle("retro", on);
    this.mfx.setPixel(on);
    setRetroSound(on);
    if (on) {
      sounds.jingle();
      this.emote("success");
      this.discover("retro");
    } else sounds.jingleDown();
  }

  /** Le tonneau : l'île fait un tour complet sur elle-même ; Ondine a le tournis. */
  private barrelRoll() {
    this.discover("barrel-roll");
    if (this.visuals()) {
      this.hooks.shell.animate([{ rotate: "0deg" }, { rotate: "360deg" }], { duration: 1100, easing: "cubic-bezier(0.6, 0, 0.2, 1)" });
      sounds.whoosh();
    }
    window.setTimeout(() => this.play("etourdie", "dizzy"), this.visuals() ? 1000 : 0);
  }

  /** La réponse : Ondine réfléchit longtemps, puis répond. */
  private answer() {
    this.discover("answer");
    this.emote("thinking");
    window.setTimeout(() => {
      this.emote("info");
      this.notifications.push({ moduleId: "island", title: "42", body: "Il fallait bien que quelqu'un réponde.", icon: "💧", priority: "normal", key: "answer" });
    }, 2800);
  }

  // ── La division en deux gouttes ────────────────────────────────────────────

  private clicked() {
    // Le poisson d'avril tombe au premier clic.
    if (this.mfx.hasFish) {
      this.mfx.dropFish();
      remember("fish", dayKey(new Date()));
      window.setTimeout(() => this.emote("shy"), 250);
      this.discover("april-fool");
      return;
    }
    const now = Date.now();
    const last = this.clicks[this.clicks.length - 1] ?? 0;
    this.clicks = now - last < CLICK_GAP_MS ? [...this.clicks, now] : [now];
    if (this.clicks.length < SPLIT_CLICKS) return;
    this.clicks = [];
    if (!this.allowed("secret") || !this.hooks.manifest() || this.mfx.splitting) return;
    this.discover("split");
    if (!this.visuals()) {
      this.emote("surprise");
      return;
    }
    this.play("surpris", "surprise");
    void this.mfx.split().then(() => this.emote("happy"));
  }

  // ── Le calendrier ──────────────────────────────────────────────────────────

  // ── Le goûter : Ondine mange la mini-île ────────────────────────────────────

  private maybeSnack() {
    if (this.hooks.state() !== "compact" || Date.now() - this.lastSnack < SNACK_EVERY_MS) return;
    if (Math.random() >= SNACK_CHANCE) return;
    void this.snack();
  }

  /**
   * Ondine part vers la droite en mangeant le contenu de la mini-île (il
   * disparaît derrière elle, bouchée par bouchée), s'arrête au bout, contente,
   * revient à sa place, et le contenu réapparaît en fondu. Environ 6 secondes.
   * Pas si la souris est sur l'île, pas pendant une notification, seulement
   * quand l'île est en haut de l'écran (sur un côté, la mini-île est verticale).
   */
  private async snack() {
    const { shell, slot } = this.hooks;
    const content = shell.querySelector<HTMLElement>(".island-content");
    const edge = document.body.dataset.edge ?? "top";
    const ready =
      this.hooks.state() === "compact" &&
      !!content &&
      !content.querySelector(".notif") &&
      edge === "top" &&
      !this.busy &&
      !this.mfx.splitting &&
      Date.now() - this.lastHover > SNACK_QUIET_MS &&
      this.allowed("secret") &&
      !!this.hooks.manifest() &&
      this.visuals();
    if (!ready || !content) return;
    this.busy = true;
    this.syncDance();
    this.snackWanted = false;
    this.lastSnack = Date.now();
    const s = slot.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    // Jusqu'au bout du contenu, Ondine en entier encore dans l'île.
    const far = Math.max(0, c.right - s.right);
    const go = 2600;
    const pause = 900;
    const back = 900;
    const total = go + pause + back;
    const at = (ms: number) => ms / total;
    slot.classList.add("egg-snacking");
    const walk = slot.animate(
      [
        { transform: "translateX(0) rotate(0deg)", offset: 0 },
        { transform: `translateX(${far * 0.5}px) rotate(4deg)`, offset: at(go * 0.5), easing: "ease-in-out" },
        { transform: `translateX(${far}px) rotate(0deg)`, offset: at(go) },
        { transform: `translateX(${far}px) rotate(0deg)`, offset: at(go + pause), easing: "cubic-bezier(0.5, 0, 0.2, 1)" },
        { transform: "translateX(0) rotate(0deg)", offset: 1 },
      ],
      { duration: total, easing: "cubic-bezier(0.3, 0, 0.3, 1)" },
    );
    // Ce qu'elle a mangé disparaît derrière elle (le bord gauche suit son dos).
    const behind = (px: number) => `inset(0 0 0 ${Math.max(0, px)}px)`;
    const eaten = content.animate(
      [
        { clipPath: behind(0), opacity: 1, offset: 0 },
        { clipPath: behind(s.right - c.left - 6), opacity: 1, offset: at(go * 0.08) },
        { clipPath: behind(s.right - c.left + far - 6), opacity: 1, offset: at(go) },
        { clipPath: behind(c.width + 20), opacity: 0, offset: at(go + 1) },
        { clipPath: behind(c.width + 20), opacity: 0, offset: 1 },
      ],
      { duration: total, easing: "cubic-bezier(0.3, 0, 0.3, 1)", fill: "forwards" },
    );
    const timers = [
      window.setTimeout(() => this.play("mange-vite", "eating"), 150),
      window.setTimeout(() => this.play("mange-vite", "eating"), 1500),
      ...[300, 700, 1100, 1650, 2050, 2450].map((ms) => window.setTimeout(() => sounds.chomp(), ms)),
      window.setTimeout(() => this.emote("happy"), go + 100),
    ];
    try {
      await walk.finished;
    } catch {
      // annulée (l'île a changé d'état) : on remet tout en place quand même
    }
    timers.forEach((t) => window.clearTimeout(t));
    walk.cancel();
    slot.classList.remove("egg-snacking");
    // Le contenu revient : flou → net, du bas vers le haut, comme une goutte qui se reforme.
    eaten.cancel();
    content.animate(
      [
        { opacity: 0, filter: "blur(6px)", transform: "translateY(4px) scale(0.98)" },
        { opacity: 1, filter: "blur(0)", transform: "none" },
      ],
      { duration: 520, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    this.discover("snack");
    this.busy = false;
    this.syncDance();
  }

  private stateChanged(from: IslandState, to: IslandState) {
    // Un goûter en cours s'arrête si l'île change d'état (les animations sont annulées).
    if (from === "compact" && to !== "compact") {
      this.hooks.slot.getAnimations().forEach((a) => a.cancel());
      this.hooks.shell.querySelector<HTMLElement>(".island-content")?.getAnimations().forEach((a) => a.cancel());
    }
    this.syncDance();
    if (to === "compact" && this.snackWanted) window.setTimeout(() => void this.snack(), 600);
    if (to === "hidden" && this.retro) this.setRetro(false);
    if (to !== "hidden") this.applyDay();
    if (from === "expanded" && to !== "expanded") this.fx.clear();
    if (to === "expanded") this.opened();
  }

  /** Les surprises de toute la journée : poisson d'avril dans le dos, fantôme d'Halloween. */
  private applyDay() {
    const today = new Date();
    const season = this.allowed("seasonal") && this.hooks.manifest() ? seasonOf(today) : null;
    const fish = season === "april-fool" && recall("fish") !== dayKey(today);
    if (fish !== this.mfx.hasFish) this.mfx.setFish(fish);
    this.hooks.slot.classList.toggle("egg-ghost", season === "halloween" && !reducedMotion());
  }

  /** Une fois par jour et par surprise. */
  private once(id: string): boolean {
    const today = dayKey(new Date());
    if (recall(id) === today) return false;
    remember(id, today);
    return true;
  }

  /** L'île vient de s'ouvrir : une surprise de saison ? */
  private opened() {
    if (!this.allowed("seasonal") || this.busy) return;
    const season = seasonOf(new Date());
    const fx = this.visuals();
    switch (season) {
      case "new-year":
        if (!this.once(season)) break;
        this.discover(season);
        this.play("victoire", "celebrate");
        if (fx) void this.fireworks();
        return;
      case "valentine":
        if (!this.once(season)) break;
        this.discover(season);
        this.emote("love");
        if (fx) void this.fx.play("hearts");
        return;
      case "bastille":
        if (!this.once(season)) break;
        this.discover(season);
        this.play("victoire", "celebrate");
        if (fx) void this.fireworks(["#3b6cff", "#ffffff", "#ff4b4b"]);
        return;
      case "halloween":
        if (!this.once(season)) break;
        this.discover(season);
        this.emote("surprise");
        return;
      case "music-day":
        break;
      case "snow":
        if (this.snow()) return;
        break;
    }
    // Pas de surprise de saison : la météo, peut-être.
    if (isRainy(this.weather) && this.once("rain")) {
      this.discover("rain");
      this.emote("happy");
      if (fx) void this.fx.play("splash", { focus: this.focus() });
    } else if (isHot(this.weather) && this.once("heat")) {
      this.discover("heat");
      this.play("fondue", "worried");
    }
  }

  private async fireworks(colors?: string[]) {
    const pops = [600, 1300, 1900, 2600, 3300].map((ms) => window.setTimeout(() => sounds.pop(), ms));
    await this.fx.play("fireworks", { colors });
    pops.forEach((t) => window.clearTimeout(t));
  }

  /** Décembre : la neige tombe dans l'île et un petit tas grossit au fil de la journée. */
  private snow(): boolean {
    const today = dayKey(new Date());
    const [day, at, level] = (recall("snow") ?? "").split("|");
    const sameDay = day === today;
    if (sameDay && Date.now() - Number(at) < SNOW_EVERY_MS) return false;
    const from = sameDay ? Number(level) || 0 : 0;
    const to = Math.min(1, from + 0.25);
    remember("snow", `${today}|${Date.now()}|${to}`);
    this.discover("snow");
    this.emote("happy");
    if (this.visuals()) void this.fx.play("snow", { pile: { from, to } });
    return true;
  }

  /** De la musique et la mini-île : Ondine danse (et le 21 juin, c'est un trésor). */
  private syncDance() {
    const want = this.music && this.hooks.state() === "compact" && !this.busy && !!this.hooks.manifest();
    if (want === this.dancing) return;
    this.dancing = want;
    this.bus.emit("mascot.dance", { on: want }, "eggs");
    if (want && seasonOf(new Date()) === "music-day" && this.allowed("seasonal")) this.discover("music-day");
  }
}
