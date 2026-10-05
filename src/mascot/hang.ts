// Ondine qui vient pendre au bord de l'écran, tête en bas, sans ouvrir l'île.
//
// De temps en temps, quand personne ne touche le PC (voir island.ts), une
// petite goutte descend du bord où vit l'île, accrochée comme une goutte au
// plafond : elle se balance, cligne des yeux, regarde la souris, puis remonte.
// Un clic sur elle ouvre l'île. Réglage « mascot.peek » pour la désactiver.
//
// Elle utilise le même moteur de dessin que la mascotte de l'île (un second
// exemplaire), tourné d'un demi-tour (en haut) ou d'un quart de tour (sur un côté).

import type { Edge } from "../island/gestures";
import { reducedMotion } from "../island/tab-pill";
import { el } from "../island/dom";
import type { CatalogEntry } from "./catalog";
import { createRenderer, type MascotRenderer } from "./renderer";

/** Combien de temps elle reste (ms), et la durée de sa descente / remontée. */
const STAY_MS = 6500;
const MOVE_MS = 650;

/** Le demi-tour ou quart de tour selon le bord : sa base se colle au bord de l'écran. */
const SPIN: Record<Edge, number> = { top: 180, left: 90, right: -90 };

export interface HangHooks {
  edge(): Edge;
  align(): string;
  /** La mascotte à dessiner (null : pas de mascotte). */
  entry(): CatalogEntry | null;
  /** Un clic sur elle. */
  onClick(): void;
  /** Elle arrive (true) ou est repartie (false). */
  onShowChange(on: boolean): void;
}

export class Hanger {
  private box: HTMLElement | null = null;
  private renderer: MascotRenderer | null = null;
  private timers: number[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: HangHooks,
  ) {}

  get showing(): boolean {
    return this.box !== null;
  }

  /** Le rectangle où elle se trouve (pour que seul ce coin prenne la souris). */
  rect(): DOMRect | null {
    return this.box?.querySelector(".hang-mascot")?.getBoundingClientRect() ?? null;
  }

  show() {
    if (this.box) return;
    const entry = this.hooks.entry();
    if (!entry) return;
    const edge = this.hooks.edge();
    const slot = el("div", { class: "hang-mascot" });
    const box = el("div", { class: "hang", "data-edge": edge, "data-align": this.hooks.align(), title: "Ondine" }, el("div", { class: "hang-sway" }, slot));
    box.style.setProperty("--spin", `${SPIN[edge]}deg`);
    box.addEventListener("click", () => {
      this.hide(true);
      this.hooks.onClick();
    });
    this.root.append(box);
    this.box = box;

    const renderer = createRenderer(entry.manifest, entry.assets);
    renderer.mount(slot);
    this.renderer = renderer;
    const play = (state: string) => {
      const name = entry.manifest.states[state as keyof typeof entry.manifest.states];
      const anim = entry.manifest.animations.find((a) => a.name === name);
      if (anim) renderer.play(anim);
    };
    // Un petit étonnement en arrivant (si la mascotte l'a), puis le repos.
    play(entry.manifest.states.surprise ? "surprise" : "idle");
    this.timers.push(window.setTimeout(() => play("idle"), 900));
    // Un clin d'œil avant de repartir.
    if (entry.manifest.states.wink) this.timers.push(window.setTimeout(() => play("wink"), STAY_MS - 1200));
    this.timers.push(window.setTimeout(() => this.hide(), STAY_MS));

    this.hooks.onShowChange(true);
    requestAnimationFrame(() => box.classList.add("in"));
  }

  /** Elle remonte (ou disparaît tout de suite si `now`). */
  hide(now = false) {
    const box = this.box;
    if (!box) return;
    this.box = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const renderer = this.renderer;
    this.renderer = null;
    const done = () => {
      renderer?.destroy();
      box.remove();
      this.hooks.onShowChange(false);
    };
    if (now || reducedMotion()) return done();
    box.classList.remove("in");
    box.classList.add("out");
    window.setTimeout(done, MOVE_MS);
  }

  /**
   * Elle suit la souris des yeux. (x, y) : la souris en px de la fenêtre. Comme
   * elle est tournée, on « détourne » la direction avant de la donner au dessin.
   */
  lookAt(x: number, y: number) {
    const r = this.rect();
    if (!r || !this.renderer) return;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const a = (SPIN[this.hooks.edge()] * Math.PI) / 180;
    this.renderer.lookAt(dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a));
  }
}
