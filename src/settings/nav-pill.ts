// La pastille de la barre latérale des réglages : elle glisse d'une page à
// l'autre comme celle des onglets de l'île (tab-pill.ts), mais à la verticale.
//
// Ses deux bords (haut et bas) ont chacun un ressort : celui qui part en avant
// est raide, celui qui suit est plus mou. La pastille s'étire pendant le
// trajet, puis se rétracte en arrivant avec un petit rebond.

import { reducedMotion } from "../island/tab-pill";

interface Spring {
  x: number;
  v: number;
}

const LEAD = 640;
const TRAIL = 250;
const DAMPING_RATIO = 0.8;

function step(s: Spring, target: number, stiffness: number, dt: number) {
  const damping = 2 * Math.sqrt(stiffness) * DAMPING_RATIO;
  s.v += (stiffness * (target - s.x) - damping * s.v) * dt;
  s.x += s.v * dt;
}

export class NavPill {
  readonly el = document.createElement("span");
  private top: Spring = { x: 0, v: 0 };
  private bottom: Spring = { x: 0, v: 0 };
  private target: HTMLElement | null = null;
  private frame = 0;
  private last = 0;

  constructor(container: HTMLElement) {
    this.el.className = "nav-pill";
    container.prepend(this.el);
  }

  /** Sans animation (premier affichage). */
  jumpTo(item: HTMLElement) {
    this.target = item;
    const { t, b } = this.edges(item);
    this.top = { x: t, v: 0 };
    this.bottom = { x: b, v: 0 };
    this.paint(0);
  }

  moveTo(item: HTMLElement) {
    if (!this.target || reducedMotion()) return this.jumpTo(item);
    this.target = item;
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  /** La cible a peut-être bougé (liste filtrée, fenêtre redimensionnée). */
  refresh() {
    if (this.target?.isConnected) this.jumpTo(this.target);
    else this.el.style.opacity = "0";
  }

  private edges(item: HTMLElement) {
    return { t: item.offsetTop, b: item.offsetTop + item.offsetHeight };
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (!this.target?.isConnected) return;
    const dt = Math.min(0.032, (now - this.last) / 1000);
    this.last = now;
    const { t, b } = this.edges(this.target);
    const down = t > this.top.x;
    step(this.top, t, down ? TRAIL : LEAD, dt);
    step(this.bottom, b, down ? LEAD : TRAIL, dt);
    const speed = Math.abs(this.top.v) + Math.abs(this.bottom.v);
    this.paint(speed);
    if (Math.abs(this.top.x - t) < 0.3 && Math.abs(this.bottom.x - b) < 0.3 && speed < 5) {
      this.top = { x: t, v: 0 };
      this.bottom = { x: b, v: 0 };
      this.paint(0);
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private paint(speed: number) {
    const h = Math.max(8, this.bottom.x - this.top.x);
    const squash = Math.min(0.1, speed / 12000); // un peu plus étroite quand elle file
    this.el.style.opacity = "1";
    this.el.style.height = `${h}px`;
    this.el.style.transform = `translateY(${this.top.x}px) scaleX(${1 - squash})`;
  }
}
