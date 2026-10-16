// La pastille en verre sous la ligne choisie, dans les deux colonnes des
// Réglages (1.2.4). Elle glisse d'une ligne à l'autre comme une goutte (les
// étapes : glideFrames, nav-logic.ts), et son reflet suit la souris.
//
// Une seule pastille par colonne, gardée quand la colonne se redessine : elle
// part de la place où on l'a vue en dernier. Image fixe (« Réduire les
// animations » de Windows, ou mode Économie) : elle saute à sa place.

import { perfMode } from "../core/perf";
import { reducedMotion } from "../island/tab-pill";
import { glideFrames, IOS_EASE, type Span } from "./nav-logic";

/** Pas d'animation : réglage de Windows, ou mode Économie (comme les bandes, hero.ts). */
export function still(): boolean {
  return reducedMotion() || perfMode() === "eco";
}

export class GlassPill {
  readonly el = document.createElement("span");
  /** Là où on l'a posée en dernier (null : la prochaine fois, elle apparaît sans glisser). */
  private last: Span | null = null;
  private anim: Animation | null = null;
  private list: HTMLElement | null = null;

  constructor(className: string) {
    this.el.className = `glass-pill ${className}`;
    this.el.setAttribute("aria-hidden", "true");
  }

  /** Pose la pastille dans une liste (dessinée à nouveau) ; le reflet suit la souris dedans. */
  attach(list: HTMLElement) {
    this.list = list;
    list.prepend(this.el);
    list.addEventListener("pointermove", (e) => {
      const r = list.getBoundingClientRect();
      if (r.width) this.el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    });
  }

  /** La prochaine pose se fait sans glisser (nouvelle rubrique : la colonne arrive en cascade). */
  reset() {
    this.last = null;
  }

  /** Va sous `item` (null : la pastille s'efface). `glide` : en glissant depuis sa dernière place. */
  place(item: HTMLElement | null, glide = true) {
    if (!item || !item.isConnected || item.offsetParent === null || this.el.parentElement !== this.list) {
      this.el.style.opacity = "0";
      this.last = null;
      return;
    }
    const to: Span = { y: item.offsetTop, h: item.offsetHeight };
    const from = this.last;
    this.last = to;
    this.anim?.cancel();
    this.anim = null;
    this.el.style.opacity = "1";
    this.el.style.height = `${to.h}px`;
    this.el.style.transform = `translateY(${to.y}px)`;
    if (still()) return;
    if (!from || !glide) {
      // Elle apparaît sur place, un peu gonflée, puis se pose.
      this.anim = this.el.animate([{ opacity: 0, transform: `translateY(${to.y}px) scale(.92)` }, { opacity: 1, transform: `translateY(${to.y}px) scale(1)` }], { duration: 360, easing: IOS_EASE });
      return;
    }
    const path = glideFrames(from, to);
    if (!path) return;
    this.anim = this.el.animate(
      path.frames.map((f) => ({ transform: `translateY(${f.y}px) scaleX(${f.scaleX})`, height: `${f.h}px`, offset: f.offset })),
      { duration: path.duration, easing: IOS_EASE },
    );
  }
}
