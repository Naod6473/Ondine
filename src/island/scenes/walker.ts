// Le moteur de déplacement d'Ondine dans l'île (scènes : scenes.ts).
//
// Sa case (mascot-slot) garde sa place dans la grille de l'île : on la décale
// avec `translate` et on l'écrase avec `scale` (attaché en bas). Le dessin
// reste celui du moteur de la mascotte (gomme : gum-engine.ts), qui fait le
// reste : à chaque atterrissage on lui envoie `react("release")`, et sa gelée
// rebondit, ses bulles tremblent (comme quand on lâche l'île étirée).
//
// Les calculs (sauts, écrasement, places) sont dans scene-path.ts.
// Tout se fait en coordonnées de la fenêtre, à partir du « pied » d'Ondine
// (le milieu du bas de sa case).
//
// Interruptible : chaque déplacement reçoit un `Run` ; `run.cancel()` l'arrête
// à l'image suivante (la promesse rend false). `snapHome()` la remet chez elle
// d'un coup, `goHome()` en sautant.

import { hopAt, hopMs, LAND_START, planHops, type Pt } from "./scene-path";

/** Une scène en cours : annulée par un clic, une autre scène, un changement d'état de l'île. */
export class Run {
  cancelled = false;
  cancel() {
    this.cancelled = true;
  }
}

export interface WalkerHooks {
  slot: HTMLElement;
  shell: HTMLElement;
  /** Ce qui arrive à la mascotte (MascotRenderer.react) : la gelée rebondit à l'atterrissage. */
  react(kind: "release" | "poke", data: { x?: number; y?: number; amount?: number }): void;
  /** Elle regarde vers ce point (coordonnées de la fenêtre). */
  look(p: Pt): void;
  /** Elle quitte sa case (true) ou y revient (false) : `mascot.walk`. */
  onAway(away: boolean): void;
}

/** La taille d'Ondine pendant qu'elle se déplace (sa case de l'île ouverte est grande). */
export const WALK_SCALE = 0.62;

export class Walker {
  /** Son pied (fenêtre) quand elle n'est pas chez elle ; null = chez elle. */
  private foot: Pt | null = null;
  /** Sa taille (1 = celle de sa case). */
  private size = 1;
  private squash = { sx: 1, sy: 1 };
  private carried: { el: HTMLElement; side: number } | null = null;

  constructor(private readonly h: WalkerHooks) {}

  /** Elle est hors de sa case. */
  get away(): boolean {
    return this.foot !== null;
  }

  /** La taille de sa case (px, carrée). */
  slotSize(): number {
    return this.h.slot.offsetWidth || 0;
  }

  /** Sa taille actuelle (1 = sa case). */
  get scale(): number {
    return this.size;
  }

  /** Le pied chez elle : le milieu du bas de sa case, sans décalage. */
  homeFoot(): Pt {
    const s = this.h.shell.getBoundingClientRect();
    const slot = this.h.slot;
    return { x: s.left + this.h.shell.clientLeft + slot.offsetLeft + slot.offsetWidth / 2, y: s.top + this.h.shell.clientTop + slot.offsetTop + slot.offsetHeight };
  }

  /** Où est son pied maintenant. */
  current(): Pt {
    return this.foot ?? this.homeFoot();
  }

  /** Passe devant le contenu (rien à lire sous elle) ou derrière. */
  setFront(on: boolean) {
    this.h.slot.classList.toggle("ondine-front", on);
  }

  /** Tient un objet (une loupe, une lettre…) à côté d'elle, ou le lâche (null). `side` : 1 à droite, -1 à gauche. */
  carry(el: HTMLElement | null, side = 1) {
    this.carried = el ? { el, side } : null;
    this.apply();
  }

  /** Change de taille sur place (s'asseoir, se faire petite). */
  async resize(scale: number, ms: number, run: Run): Promise<boolean> {
    this.leave();
    const from = this.size;
    return this.animate(ms, run, (k) => {
      this.size = from + (scale - from) * (1 - Math.pow(1 - k, 3));
    });
  }

  /**
   * Saute jusqu'à `to` en petits sauts de gomme, en prenant la taille `scale`
   * en route. Rend false si la scène a été annulée en chemin.
   */
  async hopTo(to: Pt, run: Run, scale = WALK_SCALE, speed = 1): Promise<boolean> {
    if (run.cancelled) return false;
    const start = this.current();
    const hops = planHops(start, to, Math.max(0.6, this.slotSize() / 64));
    if (!hops.length) {
      if (Math.abs(this.size - scale) > 0.01) return this.resize(scale, 160, run);
      return true;
    }
    this.leave();
    this.h.look(to);
    const fromScale = this.size;
    for (const [i, hop] of hops.entries()) {
      let landed = false;
      const ok = await this.animate(hopMs(hop) / speed, run, (k) => {
        const f = hopAt(hop, k);
        this.foot = { x: f.x, y: f.y };
        this.squash = { sx: f.sx, sy: f.sy };
        if (i === 0) this.size = fromScale + (scale - fromScale) * Math.min(1, k * 1.5);
        if (!landed && k >= LAND_START) {
          landed = true;
          this.h.react("release", { amount: 16 + hop.height });
        }
      });
      if (!ok) return false;
    }
    this.squash = { sx: 1, sy: 1 };
    this.size = scale;
    this.apply();
    return true;
  }

  /**
   * Glisse jusqu'à `to` sans sauter (nager, courir avec la progression),
   * avec un petit balancement `bob` (px).
   */
  async glideTo(goal: Pt | (() => Pt), ms: number, run: Run, bob = 0): Promise<boolean> {
    if (run.cancelled) return false;
    const from = this.current();
    // Une cible qui bouge (sa case pendant que l'île change de taille) : relue à chaque image.
    const target = typeof goal === "function" ? goal : () => goal;
    this.leave();
    this.h.look(target());
    return this.animate(ms, run, (k) => {
      const to = target();
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.foot = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(k * Math.PI * 4) * bob };
      const wobble = 1 + Math.sin(k * Math.PI * 6) * 0.03 * (bob ? 1 : 0);
      this.squash = { sx: 1 / wobble, sy: wobble };
    });
  }

  /** Place son pied d'un coup (sans animation). */
  place(to: Pt, scale = this.size) {
    this.leave();
    this.foot = to;
    this.size = scale;
    this.squash = { sx: 1, sy: 1 };
    this.apply();
  }

  /** Revient chez elle en sautant. */
  async goHome(run: Run, speed = 1.3): Promise<boolean> {
    if (!this.away) return true;
    this.setFront(false);
    // Sa case a pu bouger pendant le trajet (l'île change de taille) : on vise à nouveau, trois fois au plus.
    for (let i = 0; i < 3; i++) {
      if (!(await this.hopTo(this.homeFoot(), run, 1, speed))) return false;
      const home = this.homeFoot();
      const here = this.current();
      if (Math.hypot(home.x - here.x, home.y - here.y) < 3) break;
    }
    this.snapHome();
    return true;
  }

  /** Chez elle, tout de suite : plus aucun style en ligne. */
  snapHome() {
    const slot = this.h.slot;
    const was = this.away;
    this.foot = null;
    this.size = 1;
    this.squash = { sx: 1, sy: 1 };
    this.carried?.el.remove();
    this.carried = null;
    slot.style.removeProperty("translate");
    slot.style.removeProperty("scale");
    slot.classList.remove("ondine-away", "ondine-front");
    if (was) this.h.onAway(false);
  }

  private leave() {
    if (this.foot) return;
    this.foot = this.homeFoot();
    this.h.slot.classList.add("ondine-away");
    this.h.onAway(true);
  }

  /** Écrit la place et l'écrasement sur sa case (et l'objet qu'elle tient). */
  private apply() {
    const slot = this.h.slot;
    if (!this.foot) return;
    const home = this.homeFoot();
    slot.style.translate = `${(this.foot.x - home.x).toFixed(2)}px ${(this.foot.y - home.y).toFixed(2)}px`;
    slot.style.scale = `${(this.size * this.squash.sx).toFixed(4)} ${(this.size * this.squash.sy).toFixed(4)}`;
    if (this.carried) {
      const s = this.h.shell.getBoundingClientRect();
      const w = this.slotSize() * this.size;
      const el = this.carried.el;
      // Du côté de l'île (au bord droit, l'objet passe à sa gauche : jamais coupé).
      let x = this.foot.x - s.left + this.carried.side * w * 0.5;
      if (x < 12 || x > s.width - 12) x = this.foot.x - s.left - this.carried.side * w * 0.5;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${(this.foot.y - s.top - w * 0.55).toFixed(1)}px`;
    }
  }

  /** Une animation de `ms` ms, image par image ; false si annulée en route. */
  private animate(ms: number, run: Run, frame: (k: number) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (run.cancelled || !this.h.slot.isConnected) return resolve(false);
        const k = Math.min(1, (now - t0) / Math.max(1, ms));
        frame(k);
        this.apply();
        if (k >= 1) resolve(true);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}
