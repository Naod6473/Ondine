// Ondine sur le bureau avec l'île-bouche (island.style = "mouth" et
// island.mouthFollow, 1.2.3) : c'est ELLE, là où elle se trouve, qui fait
// l'île. Mêmes trois formes que la bouche du haut de l'écran :
//   nano     elle-même, la bouche fermée (dans sa case de 112 px)
//   mini     la bouche entrouverte, le corps étiré, le texte de la mini-île dedans
//   ouverte  la grande bouche, avec la bulle (ses onglets) dedans, liseré fin
// Sur le bureau, elle se tient à l'endroit (le haut arrondi, les yeux
// au-dessus de la bouche) : c'est la pose debout de la goutte gomme, et la
// bouche s'ouvre vers l'intérieur de l'écran, du côté que le Rust a choisi
// pour la bulle (pet.rs, choose_layout : jamais hors de l'écran).
//
// Le contenu de la mini-île vient de l'île (« island.mouth » : forme, texte,
// icône, publié par island-forms.ts) ; le survol de la souris l'entrouvre
// aussi (sans clic), un clic l'ouvre en grand (la bulle). Le corps est dessiné
// par le même moteur que la bouche du haut (src/island/mouth.ts), avec la
// bouche remplie de la couleur de l'île (il n'y a pas d'île dessous).
//
// La taille de la bouche suit ici ses propres ressorts (il n'y a pas de gelée
// d'île dans cette fenêtre) : l'épaisseur mène, la longueur suit, et le
// pincement de 90 ms avant d'ouvrir depuis la nano.

import { Bridge } from "../core/bridge";
import type { Bus } from "../core/bus";
import type { Settings } from "../core/types";
import { el } from "../island/dom";
import { MouthBody } from "../island/mouth";
import { MOUTH_KEYS, type Box } from "../island/mouth-geom";
import { stepSpring, type Spring } from "../island/spring";
import { reducedMotion } from "../island/tab-pill";

type PetForm = "nano" | "mini" | "open";

/** La bouche, sur le bureau : épaisseur vive (elle mène), longueur un peu plus molle. */
const THICK = { stiffness: 380, damping: 0.5 };
const LONG = { stiffness: 300, damping: 0.55 };
/** La bulle ouverte : la bouche est la bulle moins le corps autour (lèvres, yeux, pointe). */
const OPEN = MOUTH_KEYS[2];
export const PET_MOUTH_INSET = { top: OPEN.eyeZone + OPEN.tipH, side: OPEN.side, bottom: OPEN.back };
/** La mini-île sur le bureau (maquette : 318 × 40). */
const MINI = { w: 318, h: 40 };
/** La fenêtre en mini : la plus petite bulle (pet.rs, BUBBLE_MIN_*). */
const MINI_ROOM = { w: 360, h: 120 };

export interface PetMouthHooks {
  root: HTMLElement;
  box: HTMLElement;
  slot: HTMLElement;
  bubble: HTMLElement;
  bus: Bus;
  /** La bulle est-elle ouverte ? */
  isOpen(): boolean;
  open(): void;
  pushHit(): void;
}

/** L'île-bouche part-elle avec Ondine sur le bureau ? */
export function petMouthOn(s: Settings): boolean {
  return s.island.style === "mouth" && s.island.mouthFollow !== false && s.mascot.enabled && !!s.mascot.pet;
}

export class PetMouth {
  private body: MouthBody | null = null;
  private form: PetForm = "nano";
  private island = { form: "nano", text: "", icon: "" };
  private hover = false;
  private hoverTimer = 0;
  private hoverWanted = false;
  /** La fenêtre est-elle agrandie pour la mini-île ? */
  private miniWindow = false;
  private shrinkTimer = 0;
  private pinchUntil = 0;
  private readonly mini = el("div", { class: "pet-mini", role: "status" });
  private sx: Spring = { x: 0, v: 0 };
  private sy: Spring = { x: 0, v: 0 };
  private sw: Spring = { x: 20, v: 0 };
  private sh: Spring = { x: 7, v: 0 };
  private started = false;
  private last = 0;

  constructor(private readonly h: PetMouthHooks) {
    h.root.append(this.mini);
    this.mini.addEventListener("click", () => h.open());
    h.bus.on("island.mouth", (msg) => {
      const p = (msg.payload ?? {}) as { form?: string; text?: string; icon?: string };
      const wasAlert = this.island.form === "alert";
      this.island = { form: p.form ?? "nano", text: p.text ?? "", icon: p.icon ?? "" };
      this.mini.textContent = [this.island.icon, this.island.text].filter(Boolean).join(" ");
      // Une alerte : la bouche s'entrouvre avec un petit saut.
      if (this.island.form === "alert" && !wasAlert) this.body?.kick(1.2);
      void this.refresh();
    }, "pet");
    h.bus.on("mascot.state", (msg) => {
      const st = (msg.payload as { state?: string } | null)?.state;
      this.body?.setDozing(st === "sleep" || st === "yawn");
    }, "pet");
  }

  get on(): boolean {
    return this.body !== null;
  }

  apply(s: Settings) {
    const want = petMouthOn(s);
    this.h.box.dataset.mouth = want ? "1" : "";
    if (want && !this.body) {
      this.body = new MouthBody(this.h.root, {
        mouth: () => this.mouthRect(),
        mouthR: () => Math.min(28, Math.max(3.5, this.sh.x / 2)),
        dir: () => "up",
        fill: () => getComputedStyle(document.documentElement).getPropertyValue("--island-bg").trim() || "#0c0d12",
      });
      this.started = false;
      // Elle se refond en bouche : petit rebond, les yeux arrivent.
      this.body.kick(0.8);
    } else if (!want && this.body) {
      this.body.destroy();
      this.body = null;
      this.mini.classList.remove("on");
      if (this.miniWindow) void this.setMiniWindow(false);
    }
    void this.refresh();
  }

  /** La forme voulue : ouverte (bulle), mini (survol, notification, alerte), sinon nano. */
  private wanted(): PetForm {
    if (this.h.isOpen()) return "open";
    if (this.hover || this.island.form === "mini" || this.island.form === "alert") return "mini";
    return "nano";
  }

  /** Après un changement : la forme, la fenêtre, le texte. */
  async refresh() {
    if (!this.body) return;
    const next = this.wanted();
    const prev = this.form;
    if (next !== prev) {
      this.form = next;
      this.h.box.dataset.mform = next;
      if (prev === "nano" && !reducedMotion()) this.pinchUntil = performance.now() + 90;
      if (next === "nano" || (prev === "open" && next === "mini")) {
        window.setTimeout(() => {
          this.body?.kick(0.7);
          this.body?.blink();
        }, reducedMotion() ? 0 : 380);
      }
    }
    this.mini.classList.toggle("on", next === "mini" && !!this.mini.textContent);
    this.body.wake();
    // La fenêtre : ouverte, c'est la bulle (main.ts) ; mini, la plus petite bulle ; nano, la case.
    if (next === "mini" && !this.miniWindow) await this.setMiniWindow(true);
    else if (next === "nano" && this.miniWindow) {
      window.clearTimeout(this.shrinkTimer);
      // La bouche se referme d'abord, la fenêtre se resserre ensuite.
      this.shrinkTimer = window.setTimeout(() => this.form === "nano" && void this.setMiniWindow(false), reducedMotion() ? 0 : 450);
    } else if (next === "open") this.miniWindow = false;
  }

  private async setMiniWindow(on: boolean) {
    window.clearTimeout(this.shrinkTimer);
    this.miniWindow = on;
    const l = (await Bridge.petOpen(on, on ? MINI_ROOM : undefined)) ?? { open: on, right: true, up: true };
    // Pendant ce temps, la bulle a pu s'ouvrir : c'est elle qui décide.
    if (this.h.isOpen()) return;
    const d = this.h.box.dataset;
    d.open = String(on);
    d.side = l.right ? "right" : "left";
    d.toward = l.up ? "up" : "down";
    this.h.pushHit();
    this.body?.wake();
  }

  /** La bulle s'est fermée (main.ts) : retour à la mini-île ou à la nano. */
  closed() {
    this.miniWindow = false;
    void this.refresh();
  }

  // ── La souris ──────────────────────────────────────────────────────────────

  pointer(x: number, y: number) {
    if (!this.body) return;
    this.body.pointer(x, y);
    const b = this.body.bounds();
    const s = this.h.slot.getBoundingClientRect();
    const inBody = !!b && x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;
    const inSlot = x >= s.left && x <= s.right && y >= s.top && y <= s.bottom;
    const over = inBody || inSlot;
    if (over === this.hoverWanted) return;
    this.hoverWanted = over;
    window.clearTimeout(this.hoverTimer);
    // Comme l'encoche nano : un court survol l'entrouvre, elle se referme peu après le départ de la souris.
    this.hoverTimer = window.setTimeout(() => {
      this.hover = over;
      void this.refresh();
    }, over ? 120 : 320);
  }

  /** Les rectangles qui prennent la souris : le corps (et le texte de la mini-île). */
  hitRects(): { x: number; y: number; w: number; h: number }[] | null {
    if (!this.body) return null;
    const b = this.body.bounds();
    const s = this.h.slot.getBoundingClientRect();
    const out = [{ x: Math.round(s.left), y: Math.round(s.top), w: Math.round(s.width), h: Math.round(s.height) }];
    if (b) out.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
    if (this.h.isOpen()) {
      const r = this.h.bubble.getBoundingClientRect();
      out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  }

  // ── La bouche ──────────────────────────────────────────────────────────────

  /** Où doit être la bouche pour la forme voulue (px de la fenêtre). */
  private target(): Box {
    const box = this.h.box.querySelector(".pet-mascot")?.getBoundingClientRect() ?? new DOMRect(0, 0, 112, 112);
    if (this.form === "open") {
      const r = this.h.bubble.getBoundingClientRect();
      if (r.width > 0) return { x: r.left + PET_MOUTH_INSET.side, y: r.top + PET_MOUTH_INSET.top, w: r.width - 2 * PET_MOUTH_INSET.side, h: r.height - PET_MOUTH_INSET.top - PET_MOUTH_INSET.bottom };
    }
    if (this.form === "mini" && this.miniWindow) {
      const right = this.h.box.dataset.side !== "left";
      const up = this.h.box.dataset.toward !== "down";
      const x = right ? box.right + 4 : box.left - 4 - MINI.w;
      // À la hauteur de sa bouche fermée : la bouche s'étire de côté.
      const y = up ? box.bottom - 10 - MOUTH_KEYS[1].back - MINI.h : box.top + MOUTH_KEYS[1].eyeZone + MOUTH_KEYS[1].tipH + 6;
      return { x, y, w: MINI.w, h: MINI.h };
    }
    // Nano : sa bouche fermée, en bas de sa case (elle se tient debout).
    const cx = box.left + box.width / 2;
    return { x: cx - 10, y: box.bottom - 10 - MOUTH_KEYS[0].back - 7, w: 20, h: 7 };
  }

  /** La bouche en ressorts (appelé à chaque image par MouthBody). */
  private mouthRect(): Box {
    let t = this.target();
    const now = performance.now();
    if (now < this.pinchUntil) t = { x: t.x + t.w / 2 - 7, y: t.y + t.h / 2 - 2, w: 14, h: 4 };
    if (!this.started || reducedMotion()) {
      this.started = true;
      this.sx = { x: t.x, v: 0 };
      this.sy = { x: t.y, v: 0 };
      this.sw = { x: t.w, v: 0 };
      this.sh = { x: t.h, v: 0 };
    } else {
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
      stepSpring(this.sh, t.h, THICK, dt);
      stepSpring(this.sy, t.y, THICK, dt);
      stepSpring(this.sw, t.w, LONG, dt);
      stepSpring(this.sx, t.x, LONG, dt);
    }
    this.last = now;
    const r = { x: this.sx.x, y: this.sy.x, w: Math.max(4, this.sw.x), h: Math.max(2, this.sh.x) };
    // Le texte de la mini-île suit la bouche.
    if (this.form === "mini") Object.assign(this.mini.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    this.h.pushHit();
    return r;
  }
}
