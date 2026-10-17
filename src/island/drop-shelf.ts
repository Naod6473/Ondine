// Le petit rond « Étagère » du menu de fichiers (1.2.5), à côté de l'île.
//
// Pendant un dépôt, il se détache de l'île et se colle à côté (sous elle,
// au-dessus pour une île en bas, ou à côté quand la fenêtre a la place :
// drop-shelf-logic.ts), toujours visible : lâcher le fichier dessus le pose
// sur l'étagère tout de suite (le seul lâcher qui agit). Un clic dessus,
// fichier tenu, fait de même. Une fois l'action faite ou annulée, il revient
// se fondre dans l'île, qui fait un petit saut de gelée (island.ts, hop).
//
// Animations : un ressort en Studio et en Classique ; « Réduire les
// animations » et mode Calme : un fondu ; mode Économie : rien. Le verre
// dépoli derrière lui n'existe qu'en style Studio (island.css).

import { perfMode } from "../core/perf";
import { calmMode } from "../mascot/mascot-state";
import { el } from "./dom";
import { mergePlan, shelfPlace, type Rect, type ShelfPlace } from "./drop-shelf-logic";
import { lineIcon } from "./icon";
import { reducedMotion } from "./tab-pill";

export interface DropShelfHooks {
  /** La fenêtre de l'île (le rond y est posé, hors de la forme de l'île). */
  host: HTMLElement;
  /** La forme de l'île. */
  shell: HTMLElement;
  /** Le rond a bougé : redonner au Rust le rectangle qui prend la souris. */
  rectChanged(): void;
  /** Le rond s'est fondu dans l'île : le petit saut. */
  merged(): void;
  /** Un clic dessus (le fichier tenu). */
  clicked(): void;
}

export class DropShelf {
  readonly node: HTMLButtonElement;
  private readonly count: HTMLElement;
  private place: ShelfPlace | null = null;
  private observer: ResizeObserver | null = null;
  private shown = false;
  private leaving: Animation | null = null;

  constructor(private readonly hooks: DropShelfHooks) {
    this.count = el("span", { class: "dps-count", "data-no-i18n": "" });
    const ic = el("span", { class: "dps-icon", "aria-hidden": "true" });
    ic.append(lineIcon("🧺"));
    this.node = el("button", { type: "button", class: "drop-shelf", "aria-label": "Poser sur l'étagère" }, ic, el("span", { class: "dps-name" }, "Étagère"), this.count) as HTMLButtonElement;
    this.node.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.clicked();
    });
  }

  private quiet(): boolean {
    return reducedMotion() || calmMode();
  }

  /** Le rond se détache de l'île (`n` : le nombre d'éléments déjà sur l'étagère). */
  show(n: number) {
    this.setCount(n);
    this.leaving?.cancel();
    this.leaving = null;
    if (this.shown) return;
    this.shown = true;
    this.node.classList.remove("hot", "bump");
    this.hooks.host.append(this.node);
    this.observer?.disconnect();
    // La forme de l'île change (ressorts de la gelée) : le rond la suit.
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.hooks.shell);
    this.layout();
    if (perfMode() === "eco" || typeof this.node.animate !== "function" || !this.place) return;
    const from = mergePlan(this.place, this.shellRect(), this.size(), document.body.dataset.edge);
    this.node.animate(
      this.quiet()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translate(${from.dx}px, ${from.dy}px) scale(${from.scale})` },
            { opacity: 1, offset: 0.35 },
            { opacity: 1, transform: "none" },
          ],
      // Le ressort de la maquette (il dépasse un peu, puis se pose).
      { duration: this.quiet() ? 180 : 560, delay: this.quiet() ? 0 : 140, easing: this.quiet() ? "ease-out" : "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" },
    );
  }

  setCount(n: number) {
    const text = String(Math.max(0, n));
    if (this.count.textContent !== text) this.count.textContent = text;
  }

  /** Un fichier posé dessus : le nombre saute. */
  bump(n: number) {
    this.setCount(n);
    this.node.classList.remove("bump");
    void this.node.offsetWidth;
    this.node.classList.add("bump");
  }

  /** Visé pendant le glisser (ou survolé, fichier tenu). */
  setHot(on: boolean) {
    this.node.classList.toggle("hot", on);
  }

  /** La souris (px CSS de la fenêtre) est-elle sur le rond ? Un peu de marge : on vise vite. */
  contains(pos: { x: number; y: number }): boolean {
    if (!this.shown) return false;
    const r = this.node.getBoundingClientRect();
    return r.width > 0 && pos.x >= r.left - 8 && pos.x <= r.right + 8 && pos.y >= r.top - 8 && pos.y <= r.bottom + 8;
  }

  /** Le rectangle qui doit prendre la souris (px CSS), ou null. */
  rect(): Rect | null {
    if (!this.shown) return null;
    const r = this.node.getBoundingClientRect();
    return r.width > 0 ? { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 } : null;
  }

  /** Le rond revient se fondre dans l'île (`merge`), ou disparaît tout de suite. */
  hide(merge = true) {
    if (!this.shown) return;
    this.shown = false;
    this.observer?.disconnect();
    this.observer = null;
    const done = () => {
      this.leaving = null;
      if (this.shown) return;
      this.node.remove();
      this.hooks.rectChanged();
    };
    if (!merge || !this.place || perfMode() === "eco" || typeof this.node.animate !== "function") {
      done();
      return;
    }
    const to = mergePlan(this.place, this.shellRect(), this.size(), document.body.dataset.edge);
    const anim = this.node.animate(
      this.quiet()
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: "none" },
            { opacity: 1, offset: 0.6 },
            { opacity: 0, transform: `translate(${to.dx}px, ${to.dy}px) scale(${to.scale})` },
          ],
      // Elle part tout de suite (l'île se replie en même temps) et accélère en y entrant.
      { duration: this.quiet() ? 200 : 440, easing: this.quiet() ? "ease-out" : "cubic-bezier(.45,0,.4,1)", fill: "forwards" },
    );
    this.leaving = anim;
    anim.finished.then(
      () => {
        done();
        // La gelée de l'île encaisse le rond qui revient (rien en mode calme).
        if (!this.quiet()) this.hooks.merged();
      },
      () => undefined,
    );
  }

  private size() {
    return { w: this.node.offsetWidth || 112, h: this.node.offsetHeight || 36 };
  }

  private shellRect(): Rect {
    const r = this.hooks.shell.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  private layout() {
    if (!this.shown) return;
    const edge = document.body.dataset.edge ?? "top";
    const align = document.body.dataset.align ?? "center";
    this.place = shelfPlace(this.shellRect(), this.size(), { w: window.innerWidth, h: window.innerHeight }, edge, align);
    this.node.dataset.side = this.place.side;
    this.node.style.left = `${this.place.x}px`;
    this.node.style.top = `${this.place.y}px`;
    this.hooks.rectChanged();
  }
}
