// Les deux options de forme de l'île (1.2.3), branchées par island.ts :
//
//   island.size  = "normal" | "nano"   le format nano de la mini-île
//   island.style = "classic" | "mouth" l'île-bouche d'Ondine
//   island.mouthFollow (oui)           Ondine sortie : l'île part avec elle
//
// Format nano : l'état compact a deux formes (island-state.ts, `form`). Ici :
// le bus → les élargissements (nano-rules.ts), `data-form` sur l'île (les
// tailles sont dans island-mouth.css), les points d'état à côté de l'encoche
// (idée 3), et Ondine qui somnole dans l'encoche puis ouvre un œil quand la
// souris approche (idée 2).
//
// Île-bouche : le corps d'Ondine dessiné autour de l'île (mouth.ts), ses
// gestes à chaque transition (pincement avant d'ouvrir, rebond et clignement
// en refermant, petit saut d'une alerte, gloups d'un fichier avalé), le halo
// qui entoure le corps (halo.ts, setHaloShape), et Ondine sortie :
//   - « l'île part avec elle » (défaut) : la bouche du haut de l'écran
//     disparaît, c'est Ondine sur le bureau qui fait la bouche (src/pet/) ;
//     l'île lui envoie ce qu'il faut montrer (« island.mouth ») ;
//   - sinon : il reste en haut une bouche en gomme vide (sans yeux), qui
//     s'ouvre et se ferme comme d'habitude ; Ondine revenue, elle s'y refond
//     (les yeux réapparaissent, petit rebond).

import type { Bus } from "../core/bus";
import type { Settings } from "../core/types";
import type { MascotController } from "../mascot/mascot-state";
import { el } from "./dom";
import { setHaloShape } from "./halo";
import type { CompactForm, IslandState, IslandStateMachine } from "./island-state";
import { dirForEdge, distanceTo, dotPlaces, DOT_COLORS, nanoDots, PEEK_EYE_PX, type Box, type DotKind } from "./mouth-geom";
import { MouthBody } from "./mouth";
import { dotStatus, NANO_START, NANO_TOPICS, nanoStep, type NanoStatus } from "./nano-rules";
import { reducedMotion } from "./tab-pill";

/** Rien ne se passe depuis… (ms) : Ondine somnole dans l'encoche. */
const DOZE_AFTER_MS = 12_000;
/** Le pincement avant l'ouverture (maquette : 90 ms). */
const PINCH_MS = 90;
/** La fermeture : le clignement « gloups » une fois la bouche presque refermée. */
const CLOSE_BLINK_MS = 380;

export type IslandStyle = "classic" | "mouth";

export interface FormsHooks {
  shell: HTMLElement;
  root: HTMLElement;
  fsm: IslandStateMachine;
  bus: Bus;
  mascot(): MascotController | null;
  /** La forme voulue par le CSS a changé : la gelée la relit. */
  retarget(): void;
  /** Ondine est-elle sur le bureau ? */
  petOut(): boolean;
  /** La bouche du haut part (true) ou revient (false) : la fenêtre se fait bande, ou reprend sa taille. */
  awayChanged(away: boolean): void;
}

/** Le style de l'île d'après les réglages (valeur inconnue : classique). */
export function islandStyle(s: Settings): IslandStyle {
  return s.island.style === "mouth" ? "mouth" : "classic";
}

export class IslandForms {
  private style: IslandStyle = "classic";
  private nano = false;
  private follow = true;
  private mouth: MouthBody | null = null;
  private status: NanoStatus = NANO_START;
  private dots = el("div", { class: "nano-dots", "aria-hidden": "true" });
  private dotKey = "";
  private dozeTimer = 0;
  private dozing = false;
  /** La mascotte dort (mascot.state « sleep ») : les yeux de la bouche aussi. */
  private asleep = false;
  private winked = false;
  private pinchTimer = 0;
  private closeTimer = 0;
  /** Ondine sortie et « l'île part avec elle » : la bouche du haut est partie. */
  private awayNow = false;
  private homing = false;
  private lastMini = "";

  constructor(private readonly h: FormsHooks) {
    h.root.append(this.dots);
    h.fsm.onForm = (f) => this.onForm(f);
    for (const topic of NANO_TOPICS) {
      h.bus.on(topic, (msg) => {
        const step = nanoStep(this.status, topic, msg.payload as Record<string, unknown> | null);
        this.status = step.status;
        if (step.pulse) h.fsm.pulse(step.pulse);
        if (step.busy) h.fsm.setBusy(step.busy[0], step.busy[1]);
        this.drawDots();
        if (step.pulse || step.busy?.[1]) this.wakeUp();
      });
    }
    // Ondine qui dort pour de bon (inactivité, sa machine à états) : la bouche dort aussi.
    h.bus.on("mascot.state", (msg) => {
      const st = (msg.payload as { state?: string } | null)?.state;
      this.asleep = st === "sleep" || st === "yawn";
      this.mouth?.setDozing(this.dozing || this.asleep);
    });
    // Un clic sur le corps d'Ondine (autour de la bouche) ouvre l'île, comme un clic sur l'île.
    h.root.addEventListener("click", (e) => {
      // Une fermeture retire le bouton avant que son clic remonte ici. Le
      // chemin d'origine reste fiable même si l'ancienne vue est démontée.
      const inside = e.composedPath().some((node) => node instanceof Element && node.matches(".island, .hang"));
      if (!this.mouth || this.away || inside) return;
      const b = this.mouth.bounds();
      if (b && e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) h.fsm.click();
    });
  }

  /**
   * La bouche du haut est-elle partie avec Ondine ? Pas pendant qu'on la porte
   * au-dessus de l'île (elle revient l'accueillir), ni quand on demande l'île
   * entière (un onglet absent de sa bulle : l'île s'ouvre en haut le temps qu'il faut).
   */
  get away(): boolean {
    return this.awayNow && !this.homing && this.h.fsm.state !== "expanded";
  }

  // ── Réglages ───────────────────────────────────────────────────────────────

  apply(s: Settings) {
    const style = islandStyle(s);
    const nano = s.island.size === "nano";
    this.follow = s.island.mouthFollow !== false;
    document.body.dataset.islandStyle = style;
    document.body.dataset.islandSize = nano ? "nano" : "normal";
    if (nano !== this.nano) {
      this.nano = nano;
      this.h.fsm.setNano(nano);
    }
    if (style !== this.style) {
      this.style = style;
      if (style === "mouth") {
        this.mouth = new MouthBody(this.h.root, {
          mouth: () => this.mouthBox(),
          mouthR: () => parseFloat(getComputedStyle(this.h.shell).borderBottomLeftRadius) || 0,
          dir: () => dirForEdge(document.body.dataset.edge ?? "top"),
          openness: () => (this.h.fsm.state === "hidden" || this.h.fsm.state === "peek" ? 0 : null),
        });
        setHaloShape(() => this.mouth?.shape() ?? null);
      } else {
        this.mouth?.destroy();
        this.mouth = null;
        setHaloShape(null);
      }
    }
    this.syncPet();
    this.h.shell.dataset.form = this.h.fsm.shownForm;
    this.drawDots();
    this.mouth?.wake();
    this.armDoze();
    this.publishMini();
  }

  private shownAway = false;
  /** La forme de l'île compacte à la transition d'avant (pour savoir si la bouche s'ouvre). */
  private prevForm: CompactForm = "mini";

  /** Ondine part sur le bureau ou revient : la bouche du haut suit. */
  private syncPet() {
    const out = this.style === "mouth" && this.h.petOut();
    const away = out && this.follow;
    const wasAway = this.awayNow;
    this.awayNow = away;
    if (this.away !== this.shownAway) {
      this.shownAway = this.away;
      document.body.classList.toggle("mouth-away", this.away);
      this.h.awayChanged(this.away);
    }
    if (!this.mouth) return;
    // Sans « l'île part avec elle » : une bouche vide, sans yeux.
    this.mouth.setEyes(!out || away);
    this.mouth.setRetreat(this.away ? "hidden" : this.retreatFor(this.h.fsm.state));
    // De retour : un petit rebond en reprenant sa place.
    if (wasAway && !away) this.mouth.kick(1);
  }

  /** Ondine sur le bureau est portée au-dessus de l'île : la bouche réapparaît pour l'accueillir. */
  setHoming(on: boolean) {
    this.homing = on;
    this.syncPet();
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  /** Appelé par island.ts à chaque transition (avant render). */
  onTransition(from: IslandState, to: IslandState) {
    this.h.shell.dataset.form = this.h.fsm.shownForm;
    if (from === "expanded" || to === "expanded") this.syncPet();
    if (to !== "compact") this.setDoze(false);
    this.armDoze();
    const before = this.prevForm;
    this.prevForm = this.h.fsm.shownForm;
    const m = this.mouth;
    if (!m) return;
    m.setRetreat(this.away ? "hidden" : this.retreatFor(to));
    // L'ouverture de la bouche : 0 fermée (cachée, trait), 0,5 nano, 1 mini, 2 grande ouverte.
    const rank = (s: IslandState, form: CompactForm) => (s === "hidden" || s === "peek" ? 0 : s === "compact" ? (form === "nano" ? 0.5 : 1) : 2);
    const r0 = rank(from, before);
    const r1 = rank(to, this.prevForm);
    if (r1 > r0 && r0 <= 0.5) this.pinch();
    else if (r1 < r0 && to !== "hidden") this.closing();
    if (to === "alert") m.kick(1.2);
    // Le fichier lâché : grande bouche « aah », puis elle l'avale (gloups).
    if (from === "drop" && to === "compact") {
      m.kick(1.6);
      window.setTimeout(() => m.blink(), 220);
    }
    m.wake();
  }

  private onForm(f: CompactForm) {
    this.prevForm = f;
    this.h.shell.dataset.form = f;
    this.h.retarget();
    this.drawDots();
    if (f === "mini") {
      this.setDoze(false);
      this.pinch();
    } else this.closing();
    this.armDoze();
    this.mouth?.wake();
    this.publishMini();
  }

  private retreatFor(s: IslandState) {
    return s === "hidden" ? "hidden" : s === "peek" ? "peek" : "shown";
  }

  /** Avant d'ouvrir : la bouche se pince un court instant (anticipation). */
  private pinch() {
    if (this.style !== "mouth" || reducedMotion()) return;
    const sh = this.h.shell;
    window.clearTimeout(this.pinchTimer);
    sh.classList.add("mouth-pinch");
    this.pinchTimer = window.setTimeout(() => sh.classList.remove("mouth-pinch"), PINCH_MS);
  }

  /** En refermant : un petit rebond, puis Ondine cligne des yeux (« gloups »). */
  private closing() {
    const m = this.mouth;
    if (!m) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      m.kick(0.7);
      m.blink();
    }, reducedMotion() ? 0 : CLOSE_BLINK_MS);
  }

  /** Visite au bord, en style bouche : elle s'étire un peu vers le bas et cligne (pas de goutte en plus). */
  visit() {
    if (!this.mouth || this.away) return;
    this.setDoze(false);
    this.mouth.kick(1.4);
    window.setTimeout(() => this.mouth?.blink(), 300);
    window.setTimeout(() => this.mouth?.blink(), 700);
  }

  // ── La bouche ──────────────────────────────────────────────────────────────

  /** Le rectangle de la bouche : l'île ; cachée (ou trait), une bouche fermée au bord. */
  private mouthBox(): Box | null {
    const r = this.h.shell.getBoundingClientRect();
    const st = this.h.fsm.state;
    if (st !== "hidden" && st !== "peek" && r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
    const edge = document.body.dataset.edge ?? "top";
    const side = edge === "left" || edge === "right";
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const [w, hh] = side ? [7, 20] : [20, 7];
    const x = edge === "left" ? 11 : edge === "right" ? window.innerWidth - 11 - w : cx - w / 2;
    const y = edge === "top" ? 11 : edge === "bottom" ? window.innerHeight - 11 - hh : cy - hh / 2;
    return { x, y, w, h: hh };
  }

  /** La zone qui prend la souris : l'île, et le corps d'Ondine autour en style bouche. */
  hitRect(): Box | null {
    if (this.away) return { x: 0, y: 0, w: 0, h: 0 };
    const r = this.h.shell.getBoundingClientRect();
    const b = this.mouth?.bounds();
    if (!b) return null;
    const x0 = Math.min(r.left, b.x);
    const y0 = Math.min(r.top, b.y);
    return { x: x0, y: y0, w: Math.max(r.right, b.x + b.w) - x0, h: Math.max(r.bottom, b.y + b.h) - y0 };
  }

  /** La forme de l'île a pu bouger (gelée posée, contenu) : le corps et les points suivent. */
  reshaped() {
    this.mouth?.wake();
    this.placeDots();
  }

  // ── La souris ──────────────────────────────────────────────────────────────

  pointer(x: number, y: number) {
    this.mouth?.pointer(x, y);
    if (!this.dozing) return;
    // Elle somnole : la souris approche, elle ouvre un œil (et la regarde).
    const r = this.h.shell.getBoundingClientRect();
    const near = distanceTo({ x: r.left, y: r.top, w: r.width, h: r.height }, x, y) <= PEEK_EYE_PX;
    if (near && !this.winked) {
      this.winked = true;
      if (this.style === "classic") {
        const mc = this.h.mascot();
        if (mc && !mc.request("wink")) mc.request("wake");
      }
    } else if (!near && this.winked) {
      this.winked = false;
      if (this.style === "classic") this.h.mascot()?.request("sleep");
    }
  }

  // ── Ondine somnole dans l'encoche (idée 2) ─────────────────────────────────

  /** Relance l'attente avant la somnolence (seulement en nano, au repos). */
  private armDoze() {
    window.clearTimeout(this.dozeTimer);
    if (!this.dozeAllowed()) return;
    this.dozeTimer = window.setTimeout(() => this.dozeAllowed() && this.setDoze(true), DOZE_AFTER_MS);
  }

  private dozeAllowed(): boolean {
    const nanoRest = this.nano && this.h.fsm.state === "compact" && this.h.fsm.shownForm === "nano";
    return nanoRest && !this.away;
  }

  /** Quelque chose se passe : elle se réveille. */
  private wakeUp() {
    this.setDoze(false);
    this.armDoze();
  }

  private setDoze(on: boolean) {
    if (on === this.dozing) return;
    this.dozing = on;
    this.winked = false;
    this.h.shell.classList.toggle("dozing", on);
    this.mouth?.setDozing(on || this.asleep);
    if (this.style === "classic") {
      const mc = this.h.mascot();
      if (on) mc?.request("sleep");
      else mc?.activity();
    }
  }

  // ── Les points d'état (idée 3) ─────────────────────────────────────────────

  private drawDots() {
    const compact = this.h.fsm.state === "compact" && !this.away;
    const show = this.nano && compact && this.h.fsm.shownForm === "nano";
    // Le mot d'appel écoute : son point rouge reste aussi sur l'île de taille normale.
    const kinds: DotKind[] = show ? nanoDots(dotStatus(this.status)) : compact && this.status.wake ? ["wake"] : [];
    const key = kinds.join(",");
    if (key !== this.dotKey) {
      this.dotKey = key;
      this.dots.replaceChildren(
        ...kinds.map((k) => {
          const d = el("i", { class: `nano-dot dot-${k}` });
          d.style.setProperty("--dot", DOT_COLORS[k]);
          return d;
        }),
      );
    }
    this.placeDots();
  }

  /** Les points se posent à côté de l'encoche (ou du corps d'Ondine en style bouche). */
  private placeDots() {
    const n = this.dots.childElementCount;
    if (!n) return;
    const r = this.mouth?.bounds() ?? (() => {
      const b = this.h.shell.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    })();
    const places = dotPlaces(n, r, document.body.dataset.edge ?? "top", document.body.dataset.align ?? "center");
    [...this.dots.children].forEach((d, i) => {
      const p = places[i];
      (d as HTMLElement).style.left = `${Math.round(r.x + p.x)}px`;
      (d as HTMLElement).style.top = `${Math.round(r.y + p.y)}px`;
    });
  }

  // ── Ondine sortie : ce qu'elle doit montrer dans sa bouche ─────────────────

  /**
   * Après chaque dessin de l'île : si Ondine est sortie avec l'île (style
   * bouche), on lui dit quoi montrer : sa forme (nano, mini, alerte) et le
   * texte de la mini-île (« island.mouth », lu par src/pet/main.ts).
   */
  publishMini() {
    if (this.style !== "mouth" || !this.h.petOut() || !this.follow) {
      if (this.lastMini) {
        this.lastMini = "";
        this.h.bus.emit("island.mouth", { form: "off" });
      }
      return;
    }
    const st = this.h.fsm.state;
    const content = this.h.shell.querySelector(".island-content");
    const text = st === "compact" || st === "alert" ? (content?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 140) : "";
    const icon = (content?.querySelector(".notif-icon")?.textContent ?? "").trim().slice(0, 8);
    const form = st === "alert" ? "alert" : st === "compact" ? this.h.fsm.shownForm : "nano";
    const payload = { form, text, icon, dots: nanoDots(dotStatus(this.status)) };
    const key = JSON.stringify(payload);
    if (key === this.lastMini) return;
    this.lastMini = key;
    this.h.bus.emit("island.mouth", payload);
  }
}
