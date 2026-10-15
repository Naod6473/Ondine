// Ondine convertit (1.2.5) : le geste, dans la fenêtre de l'île.
//
// Un fichier glissé vers l'île : sous elle, des pilules de formats sortent en
// éventail (celles de CE fichier), et la pilule d'option (Conserver /
// Remplacer / Sur le bureau). Lâché sur une pilule : Ondine l'avale, mâche
// (la pilule choisie se remplit, le liquide de l'île monte avec la vraie
// progression), puis recrache le nouveau fichier (un arc vers sa place) et la
// pilule de résultat sort : « photo.jpg · 3,4 Mo → 820 Ko · Ouvrir · Annuler ».
// Échec : grimace, l'original ressort, une ligne dit pourquoi.
//
// Coexistence avec l'Étagère : DANS l'île, les cibles de dépôt de toujours
// (Étagère, Copier vers…, Corbeille…) ; SOUS l'île, les pilules de conversion.
// Deux zones nettes : lâcher dans l'île range, lâcher sur une pilule convertit,
// lâcher ailleurs ne fait rien (l'île se referme). L'île en mode dépôt est un
// peu moins haute quand les pilules sont là (classe convert-room, island.css).
//
// Qui fait quoi :
//   - ici : les pilules, le survol (positions envoyées par la cible de dépôt
//     de l'île, platform/drop_target.rs, Maj comprise), les animations, les
//     expressions d'Ondine, le liquide ;
//   - le module (src/modules/convert/) reçoit « convert.request », appelle le
//     Rust (`start`), et montre l'avancement dans la mini-île ;
//   - le Rust (modules/convert.rs) convertit et envoie « convert.progress »
//     puis « convert.done ».
// Le minutage et les poses sont dans convert-plan.ts (pur, testé).
//
// Accessibilité : « Réduire les animations » de Windows ou le mode Calme de
// la mascotte : les mêmes étapes en fondus (pas d'arc, pas de rebond, pas de
// paillettes) et Ondine ne fait pas de grimaces. Le flou derrière les
// pilules n'existe qu'en style Studio (convert.css). La pilule de résultat
// est annoncée aux lecteurs d'écran (role="status").

import type { Bus } from "../core/bus";
import { Bridge } from "../core/bridge";
import { currentLang, t } from "../core/i18n";
import { logger } from "../core/log";
import { settingsStore } from "../core/settings-store";
import { calmMode } from "../mascot/mascot-state";
import convertManifest from "../modules/convert/manifest.json";
import type { ModuleManifest } from "../core/module-types";
import {
  asDest,
  DEST_LABEL,
  nextDest,
  outKind,
  parseLast,
  pillsFor,
  remember,
  summarize,
  type Dest,
  type DoneMessage,
  type Kind,
  type LastChoices,
  type Pill,
  type Summary,
} from "../modules/convert/convert-logic";
import { arcPose, Dwell, expressionAt, fanK, hitPill, layoutPills, liquidLevel, optionY, PILL_H, retractK, swallowPose, T, type Slot, type WorkPhase } from "./convert-plan";
import { clamp, lerp, smooth, spr } from "./hatch-plan";
import { hideLiquid, showLiquid, updateLiquid } from "./liquid";
import { sounds } from "./sounds";
import { reducedMotion } from "./tab-pill";
import "../styles/convert.css";

const log = logger("convertit");

/** Le dernier format choisi par type : une commodité de cette fenêtre (localStorage). */
const LAST_KEY = "ondine.convert.last";
const LIQUID_ID = "convert";
/** La pilule de progression, au centre : sa largeur. */
const PROG_W = 280;
/** Le rouge doux d'un échec (comme la maquette). */
const FAIL_TINT = "#ff8f78";

export interface ConvertHooks {
  /** La fenêtre de l'île (les pilules vivent à côté de la forme de l'île). */
  root: HTMLElement;
  /** La forme de l'île. */
  shell: HTMLElement;
  /** La case de la mascotte (sa bouche est le point d'aspiration). */
  slot: HTMLElement;
  bus: Bus;
  /** Garder la mini-île ouverte pendant le travail (island-state.ts keepOpen). */
  keepOpen(on: boolean): void;
  /** Les pilules cliquables ont bougé : redonner au Rust le rectangle qui prend la souris. */
  rectChanged(): void;
}

/** Ce que l'île doit faire d'un lâcher. */
export type DropOutcome = "converted" | "missed" | "none";

type Phase = "idle" | "open" | "closing" | "work";

interface Work {
  startedAt: number;
  paths: string[];
  label: string;
  batch: boolean;
  kind: Kind;
  dest: Dest;
  from: { x: number; y: number };
  slot: Slot;
  fraction: number;
  shown: number;
  done: DoneMessage | null;
  summary: Summary | null;
  /** Quand elle recrache (ou grimace), en ms. */
  endAt: number | null;
  ok: boolean;
  liquid: boolean;
  liquidLevel: number;
  /** La pilule de résultat : quand elle sort, et jusqu'à quand elle reste. */
  resultFrom: number;
  resultUntil: number;
  hovering: boolean;
  foldAt: number | null;
  /** Les moments où l'on a redonné le rectangle au Rust. */
  rectPushed: Set<string>;
}

/** Une icône de fichier au trait (pas de logo, pas d'emoji : la couleur du texte). */
function fileIcon(kind: Kind | "bin"): string {
  const sheet = `<path d="M13 4h11l7 7v23H13z" fill="none"/><path d="M24 4v7h7" fill="none"/>`;
  const inner: Record<Kind | "bin", string> = {
    image: `<rect x="16.5" y="17" width="11" height="9" rx="1.5" fill="none"/><path d="M17 25l3.5-3.5 2.5 2.5 1.5-1.5 2.5 2.5" fill="none"/>`,
    pdf: `<path d="M17 18h10M17 22h10M17 26h6" fill="none"/>`,
    video: `<path d="M19.5 18v9l7-4.5z" fill="none"/>`,
    audio: `<path d="M24 17v8.5a2.2 2.2 0 1 1-1.5-2.1V19l-4 1v7a2.2 2.2 0 1 1-1.5-2.1V18.6z" fill="none"/>`,
    zip: `<path d="M21 6v3M21 11v3M21 16v3" fill="none"/><rect x="19.5" y="20" width="3" height="5" rx="1" fill="none"/>`,
    other: `<path d="M17 20h10M17 24h7" fill="none"/>`,
    bin: "",
  };
  if (kind === "bin") {
    return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M12 13h20M18 13v-3h8v3M15 13l1.5 21h11L29 13" fill="none"/><path d="M20 18v12M24 18v12" fill="none"/></svg>`;
  }
  return `<svg viewBox="0 0 44 44" aria-hidden="true">${sheet}${inner[kind]}</svg>`;
}

/** Les flèches qui tournent de la pilule d'option (au trait). */
const SPIN_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none"/><path d="M13 2.5V5h-2.5" fill="none"/></svg>`;

function readLast(): LastChoices {
  try {
    return parseLast(localStorage.getItem(LAST_KEY));
  } catch {
    return {};
  }
}

function writeLast(last: LastChoices) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    // stockage indisponible : la première pilule restera celle par défaut
  }
}

export class ConvertGesture {
  private readonly layer = document.createElement("div");
  private readonly pillsBox = document.createElement("div");
  private readonly opt = document.createElement("div");
  private readonly prog = document.createElement("button");
  private readonly progFill = document.createElement("span");
  private readonly progLabel = document.createElement("span");
  private readonly res = document.createElement("div");
  private readonly ghost = document.createElement("div");
  private readonly made = document.createElement("div");
  private readonly old = document.createElement("div");
  private readonly bin = document.createElement("div");
  private readonly sparks: HTMLElement[] = [];

  private phase: Phase = "idle";
  private paths: string[] = [];
  private kind: Kind = "other";
  private pills: Pill[] = [];
  private pillEls: HTMLElement[] = [];
  private widths: number[] = [];
  private slots: Slot[] = [];
  private optCenter = { x: 0, y: 0, w: 0 };
  private hot: number[] = [];
  private hovered = -1;
  private onOpt = false;
  private dest: Dest = "keep";
  private dwell = new Dwell();
  private openedAt = 0;
  private closingAt = 0;
  private listened = false;
  private work: Work | null = null;
  private frame = 0;
  private last = 0;
  private expression = "";

  constructor(private readonly hooks: ConvertHooks) {
    this.layer.className = "convert-layer";
    this.layer.setAttribute("aria-hidden", "true");
    this.pillsBox.className = "convert-pills";
    this.opt.className = "convert-pill convert-choice";
    this.prog.className = "convert-pill convert-prog";
    this.prog.type = "button";
    this.prog.title = "Arrêter";
    this.progFill.className = "convert-fill";
    this.progLabel.className = "convert-prog-label";
    this.prog.append(this.progFill, this.progLabel);
    this.prog.addEventListener("click", () => {
      if (this.work && !this.work.done) this.hooks.bus.emit("convert.cancel", null);
    });
    this.res.className = "convert-pill convert-res";
    this.res.setAttribute("role", "status");
    this.res.addEventListener("mouseenter", () => this.work && (this.work.hovering = true));
    this.res.addEventListener("mouseleave", () => {
      if (!this.work) return;
      this.work.hovering = false;
      this.work.resultUntil = Math.max(this.work.resultUntil, performance.now() + 2500);
    });
    for (const f of [this.ghost, this.made, this.old]) f.className = "convert-file";
    this.bin.className = "convert-file convert-bin";
    this.bin.innerHTML = fileIcon("bin");
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("i");
      s.className = "convert-spark";
      this.sparks.push(s);
    }
    this.layer.append(this.pillsBox, this.opt, this.prog, this.res, this.old, this.bin, this.ghost, this.made, ...this.sparks);
    this.hooks.root.append(this.layer);
  }

  // ── Ce que l'île appelle ───────────────────────────────────────────────────

  /** Le module est-il là pour convertir ? (activé, et une île en haut ou en bas) */
  private available(): boolean {
    const edge = document.body.dataset.edge ?? "top";
    return settingsStore.moduleEnabled("convert") && (edge === "top" || edge === "bottom");
  }

  private calm(): boolean {
    return reducedMotion() || calmMode();
  }

  /** Un fichier (ou plusieurs) arrive au-dessus de l'île. */
  enter(paths: string[]) {
    if (!this.available()) return;
    // Une conversion en cours : pas de nouvelles pilules (l'Étagère reste là).
    if (this.work && !this.work.done) return;
    if (this.work) this.finish();
    const offer = pillsFor(paths, readLast());
    if (!offer) return;
    this.listen();
    this.paths = paths;
    this.kind = offer.kind;
    this.pills = offer.pills;
    this.dest = asDest(settingsStore.moduleValues(convertManifest as ModuleManifest).dest);
    this.dwell = new Dwell();
    this.hovered = -1;
    this.onOpt = false;
    this.buildPills();
    this.phase = "open";
    this.openedAt = performance.now();
    this.layer.classList.add("on");
    this.hooks.shell.classList.add("convert-room");
    this.express("open", 0);
    this.kick();
  }

  /** La souris bouge pendant le glisser (px CSS de la fenêtre ; Maj enfoncée ?). */
  over(pos: { x: number; y: number } | undefined, shift: boolean) {
    if (this.phase !== "open") return;
    if (shift && this.dest !== "replace") {
      this.dest = "replace";
      this.setOptLabel(true);
    }
    const h = pos ? hitPill(this.slots, pos.x, pos.y) : -1;
    if (h !== this.hovered) {
      this.hovered = h;
      if (h >= 0) {
        this.express("hover", 0);
        sounds.tap();
      }
    }
    const o = this.optCenter;
    this.onOpt = !!pos && o.w > 0 && Math.abs(pos.x - o.x) <= o.w / 2 + 6 && Math.abs(pos.y - o.y) <= PILL_H / 2 + 6;
    this.kick();
  }

  /** Le glisser est parti (ou annulé). */
  leave() {
    if (this.phase !== "open") return;
    this.close();
  }

  /**
   * Le fichier est lâché. "converted" : sur une pilule (l'île ne fait rien
   * d'autre) ; "missed" : les pilules étaient là mais pas sous la souris
   * (l'île garde ses cibles de dépôt) ; "none" : pas de pilules.
   */
  drop(paths: string[], pos: { x: number; y: number } | undefined): DropOutcome {
    if (this.phase !== "open") return "none";
    const index = pos ? hitPill(this.slots, pos.x, pos.y) : -1;
    if (index < 0 || !pos) {
      this.close();
      return "missed";
    }
    const pill = this.pills[index];
    const list = paths.length ? paths : this.paths;
    writeLast(remember(readLast(), this.kind, pill.id));
    this.hooks.shell.classList.remove("convert-room");
    this.work = {
      startedAt: performance.now(),
      paths: list,
      label: pill.label,
      batch: list.length > 1,
      kind: this.kind,
      dest: this.dest,
      from: { x: pos.x, y: pos.y },
      slot: this.slots[index],
      fraction: 0,
      shown: 0,
      done: null,
      summary: null,
      endAt: null,
      ok: false,
      liquid: false,
      liquidLevel: 0,
      resultFrom: 0,
      resultUntil: 0,
      hovering: false,
      foldAt: null,
      rectPushed: new Set(),
    };
    this.phase = "work";
    this.layer.classList.add("working");
    // La pilule choisie devient la pilule de progression ; l'icône du fichier
    // part du point de lâcher vers la bouche.
    this.pillEls[index]?.classList.add("chosen");
    this.ghost.innerHTML = fileIcon(this.kind);
    this.made.innerHTML = fileIcon(outKind(pill.id, this.kind));
    this.old.innerHTML = fileIcon(this.kind);
    this.progLabel.textContent = pill.label;
    this.prog.classList.remove("bad");
    this.res.classList.remove("bad");
    this.res.replaceChildren();
    this.hooks.keepOpen(true);
    this.express("swallow", 0);
    [120, 420, 760].forEach((ms) => window.setTimeout(() => this.phase === "work" && !this.work?.done && sounds.chomp(), ms));
    // Le module appelle le Rust (src/modules/convert/index.ts).
    this.hooks.bus.emit("convert.request", { paths: list, format: pill.id, label: pill.label, dest: this.dest, kind: this.kind });
    log.info(`conversion demandée : ${pill.id}, ${list.length} élément(s), ${this.dest}`);
    this.kick();
    return "converted";
  }

  /** Le rectangle des pilules cliquables (progression, résultat), en px CSS, ou null. */
  hitRect(): { x: number; y: number; w: number; h: number } | null {
    const w = this.work;
    if (!w) return null;
    const rects: DOMRect[] = [];
    if (!w.endAt) rects.push(this.prog.getBoundingClientRect());
    if (w.endAt) rects.push(this.res.getBoundingClientRect());
    const shown = rects.filter((r) => r.width > 0 && r.height > 0);
    if (!shown.length) return null;
    const left = Math.min(...shown.map((r) => r.left)) - 4;
    const top = Math.min(...shown.map((r) => r.top)) - 4;
    const right = Math.max(...shown.map((r) => r.right)) + 4;
    const bottom = Math.max(...shown.map((r) => r.bottom)) + 4;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // ── Le bus ─────────────────────────────────────────────────────────────────

  private listen() {
    if (this.listened) return;
    this.listened = true;
    this.hooks.bus.on("convert.progress", (msg) => {
      const p = msg.payload as { fraction?: number; index?: number; total?: number } | null;
      if (!this.work || this.work.done || typeof p?.fraction !== "number") return;
      this.work.fraction = Math.max(this.work.fraction, clamp(p.fraction));
      this.kick();
    });
    this.hooks.bus.on("convert.done", (msg) => {
      const d = msg.payload as DoneMessage | null;
      if (!this.work || this.work.done || !d) return;
      this.work.done = d;
      this.work.summary = summarize(d, this.work.dest, t, currentLang() !== "fr");
      this.work.ok = this.work.summary.ok;
      if (this.work.ok) this.work.fraction = 1;
      this.kick();
    });
  }

  // ── Construction ───────────────────────────────────────────────────────────

  private buildPills() {
    this.pillEls = this.pills.map((p) => {
      const b = document.createElement("div");
      b.className = "convert-pill";
      b.textContent = p.label;
      return b;
    });
    this.pillsBox.replaceChildren(...this.pillEls);
    this.setOptLabel(false);
    // Les largeurs sont mesurées une fois (pilules posées, invisibles).
    this.widths = this.pillEls.map((b) => Math.ceil(b.getBoundingClientRect().width) || 64);
    this.hot = this.pills.map(() => 0);
  }

  private setOptLabel(turned: boolean) {
    const label = document.createElement("span");
    label.textContent = DEST_LABEL[this.dest];
    const icon = document.createElement("span");
    icon.className = "convert-spin";
    icon.innerHTML = SPIN_ICON;
    const bar = document.createElement("span");
    bar.className = "convert-dwell";
    this.opt.replaceChildren(icon, label, bar);
    if (turned) {
      this.opt.classList.remove("turned");
      void this.opt.offsetWidth;
      this.opt.classList.add("turned");
      sounds.toggle(true);
    }
  }

  // ── Expressions, liquide ───────────────────────────────────────────────────

  private express(phase: WorkPhase | "open" | "hover", t: number) {
    if (this.calm()) return;
    const e = expressionAt(phase, t, !!this.work?.batch);
    if (!e || e.anim === this.expression) return;
    this.expression = e.anim;
    this.hooks.bus.emit("mascot.play", { animation: e.anim, emotion: e.emotion });
  }

  // ── Les états ──────────────────────────────────────────────────────────────

  private close() {
    this.phase = "closing";
    this.closingAt = performance.now();
    this.hooks.shell.classList.remove("convert-room");
    this.expression = "";
    this.kick();
  }

  /** Tout est fini : la couche se vide, l'île peut se replier. */
  private finish() {
    const hadWork = !!this.work;
    if (this.work?.liquid) hideLiquid(LIQUID_ID);
    this.work = null;
    this.phase = "idle";
    this.expression = "";
    this.layer.classList.remove("on");
    this.pillsBox.replaceChildren();
    this.pillEls = [];
    this.slots = [];
    this.optCenter = { x: 0, y: 0, w: 0 };
    for (const n of [this.opt, this.prog, this.res, this.ghost, this.made, this.old, this.bin, ...this.sparks]) n.style.opacity = "0";
    this.res.replaceChildren();
    this.res.classList.remove("live");
    this.layer.classList.remove("working");
    this.layer.setAttribute("aria-hidden", "true");
    this.hooks.shell.classList.remove("convert-room");
    if (hadWork) {
      this.hooks.keepOpen(false);
      this.hooks.rectChanged();
    }
  }

  private kick() {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number) {
    this.frame = 0;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let more = false;
    try {
      more = this.phase === "work" ? this.drawWork(now, dt) : this.phase === "idle" ? false : this.drawOpen(now, dt);
    } catch (err) {
      log.warn(`geste de conversion : ${String(err)}`);
      this.finish();
    }
    if (more) this.frame = requestAnimationFrame((n) => this.tick(n));
  }

  /** Le bord de l'île côté pilules, le sens, le centre. */
  private anchor(): { anchor: number; dir: 1 | -1; cx: number; rect: DOMRect } {
    const rect = this.hooks.shell.getBoundingClientRect();
    const bottom = document.body.dataset.edge === "bottom";
    return { anchor: bottom ? rect.top : rect.bottom, dir: bottom ? -1 : 1, cx: rect.left + rect.width / 2, rect };
  }

  /** La bouche d'Ondine (le centre de sa case, un peu plus bas), sinon la gauche de l'île. */
  private mouth(): { x: number; y: number } {
    const s = this.hooks.slot.getBoundingClientRect();
    if (s.width > 4) return { x: s.left + s.width / 2, y: s.top + s.height * 0.6 };
    const r = this.hooks.shell.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + r.height / 2 };
  }

  private place(node: HTMLElement, x: number, y: number, s: number, o: number, extra = "") {
    const w = node.offsetWidth || 0;
    const h = node.offsetHeight || 0;
    node.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px) scale(${Math.max(0, s).toFixed(3)})${extra}`;
    node.style.opacity = clamp(o).toFixed(3);
  }

  /** Les pilules ouvertes (ou qui rentrent). Renvoie true s'il faut encore des images. */
  private drawOpen(now: number, dt: number): boolean {
    const calm = this.calm();
    const { anchor, dir, cx } = this.anchor();
    const maxW = Math.min(window.innerWidth - 24, 700);
    this.slots = layoutPills(this.widths, cx, anchor, dir, maxW);
    const t = (now - this.openedAt) / 1000;
    const closing = this.phase === "closing";
    const back = closing ? retractK((now - this.closingAt) / 1000) : 1;
    let moving = closing ? back > 0 : false;
    this.pillEls.forEach((el, i) => {
      const slot = this.slots[i];
      const k = fanK(t, i, calm) * back;
      if (k < 0.999 || Math.abs(k - 1) > 0.002) moving = true;
      const target = i === this.hovered && !closing ? 1 : 0;
      this.hot[i] += (target - this.hot[i]) * (1 - Math.exp(-dt * 18));
      if (Math.abs(target - this.hot[i]) > 0.01) moving = true;
      el.classList.toggle("hot", i === this.hovered && !closing);
      const x = calm ? slot.x : lerp(cx, slot.x, k);
      const y = calm ? slot.y : lerp(anchor - dir * 14, slot.y, k);
      const s = calm ? 1 : lerp(0.3, 1, k) * (1 + 0.12 * this.hot[i]);
      const dim = this.hovered >= 0 && i !== this.hovered ? 0.75 : 1;
      this.place(el, x, y, s, clamp(k * 3) * dim);
    });
    // La pilule d'option, une rangée en dessous, sortie après les autres.
    const oy = optionY(this.slots, anchor, dir);
    const ko = fanK(t - 0.04, this.pillEls.length, calm) * back;
    this.optCenter = { x: cx, y: oy, w: this.opt.offsetWidth };
    this.place(this.opt, cx, calm ? oy : lerp(anchor - dir * 14, oy, ko), calm ? 1 : lerp(0.3, 1, ko), clamp(ko * 3));
    if (Math.abs(ko - 1) > 0.002) moving = true;
    if (!closing) {
      if (this.dwell.update(this.onOpt, now)) {
        this.dest = nextDest(this.dest);
        this.setOptLabel(true);
      }
      const bar = this.opt.querySelector<HTMLElement>(".convert-dwell");
      const d = this.dwell.progress(now);
      if (bar) bar.style.transform = `scaleX(${d.toFixed(3)})`;
      if (d > 0) moving = true;
    }
    if (closing && back <= 0) {
      this.finish();
      return false;
    }
    // Ouvertes et posées : plus rien ne bouge, sauf le survol (over relance).
    return moving || this.onOpt;
  }

  /** Après le lâcher : avaler, mâcher, recracher (ou grimacer), le résultat. */
  private drawWork(now: number, dt: number): boolean {
    const w = this.work!;
    const calm = this.calm();
    const { anchor, dir, cx } = this.anchor();
    const mouth = this.mouth();
    const t = (now - w.startedAt) / 1000;

    // Les autres pilules rentrent ; la choisie se cache (la progression prend sa place).
    const back = retractK(t);
    this.pillEls.forEach((el, i) => {
      const slot = this.slots[i];
      if (!slot) return;
      if (el.classList.contains("chosen")) {
        el.style.opacity = "0";
        return;
      }
      this.place(el, slot.x, slot.y, calm ? 1 : lerp(0.6, 1, back), back);
    });
    this.place(this.opt, this.optCenter.x, this.optCenter.y, calm ? 1 : lerp(0.6, 1, back), back);

    // L'icône avalée.
    if (t < T.swallow) {
      const p = swallowPose(t / T.swallow, w.from, mouth, calm);
      this.place(this.ghost, p.x, p.y, p.s, p.o, ` rotate(${p.r.toFixed(3)}rad)`);
    } else this.ghost.style.opacity = "0";

    // Elle mâche : la progression (lissée) remplit la pilule et l'île.
    const target = w.done ? (w.ok ? 1 : w.shown) : w.fraction;
    w.shown += (target - w.shown) * (1 - Math.exp(-dt * (w.done ? 9 : 5)));
    if (t >= T.swallow && !w.endAt) {
      this.express("chew", t - T.swallow);
      const level = liquidLevel(w.shown);
      if (!w.liquid) {
        w.liquid = true;
        w.liquidLevel = level;
        showLiquid({ id: LIQUID_ID, level, priority: "high" });
      } else if (Math.abs(level - w.liquidLevel) > 0.01) {
        w.liquidLevel = level;
        updateLiquid(LIQUID_ID, { level });
      }
    }
    // Le moment de recracher : le travail est fini, elle a mâché assez longtemps,
    // et la pilule est pleine (ou c'est un échec : tout de suite).
    if (!w.endAt && w.done && t >= T.swallow + T.minChew && (!w.ok || w.shown > 0.97)) {
      w.endAt = now;
      w.resultFrom = now + (w.ok ? (T.arc - 0.05) * 1000 : 600);
      w.resultUntil = w.resultFrom + (w.ok ? T.result : T.failure) * 1000;
      this.fillResult();
      if (w.ok) {
        sounds.plop();
        if (w.liquid) hideLiquid(LIQUID_ID);
        w.liquid = false;
      } else {
        this.prog.classList.add("bad");
        if (w.liquid) updateLiquid(LIQUID_ID, { tint: FAIL_TINT });
        window.setTimeout(() => {
          if (this.work === w && w.liquid) {
            hideLiquid(LIQUID_ID);
            w.liquid = false;
          }
        }, 700);
      }
    }
    const te = w.endAt ? (now - w.endAt) / 1000 : -1;
    if (w.endAt) this.express(w.ok ? "spit" : "fail", te);

    // La pilule de progression : de la place de la pilule choisie vers le centre.
    const progY = anchor + dir * (12 + PILL_H / 2);
    const kp = calm ? smooth(t / 0.3) : spr(t - 0.05, 7.5, 12.5);
    const width = lerp(w.slot.w, PROG_W, clamp(kp, 0, 1.1));
    this.prog.style.width = `${width.toFixed(1)}px`;
    let progO = 1;
    if (w.endAt && w.ok) progO = 1 - smooth((te - (T.arc - 0.2)) / 0.25);
    // Échec : la pilule rougie s'efface quand celle du résultat (la raison) sort à sa place.
    else if (w.endAt) progO = 1 - smooth((now - w.resultFrom) / 200);
    let shake = "";
    if (w.endAt && !w.ok && !calm && te < 0.6) shake = ` translateX(${(Math.sin(te * 55) * 6 * (1 - te / 0.6)).toFixed(1)}px)`;
    this.place(this.prog, calm ? cx : lerp(w.slot.x, cx, kp), calm ? progY : lerp(w.slot.y, progY, kp), 1, progO * (calm ? smooth(t / 0.3) : 1), shake);
    this.progFill.style.transform = `scaleX(${clamp(w.shown).toFixed(4)})`;
    const d = w.done;
    const label = t < T.swallow ? w.label : d && !w.ok ? w.label : `${w.label} · ${Math.round(clamp(w.shown) * 100)} %`;
    if (this.progLabel.textContent !== label) this.progLabel.textContent = label;
    this.prog.classList.toggle("dark", w.shown > 0.45 && !(d && !w.ok));
    if (t > 0.8 && !w.rectPushed.has("prog")) {
      w.rectPushed.add("prog");
      this.hooks.rectChanged();
    }

    // Recraché : l'arc du nouveau fichier, l'original qui part à la Corbeille.
    if (w.endAt && w.ok) {
      const land = { x: cx - 170, y: clamp(progY + dir * 64, 24, window.innerHeight - 24) };
      if (w.dest === "desk") land.x = cx + 210;
      const a = arcPose(te / T.arc, te - T.arc, mouth, land, calm, dir);
      const fade = 1 - smooth((te - T.arc - 0.7) / 0.35);
      this.place(this.made, a.x, a.y, a.s, a.o * fade, calm ? "" : ` scale(${a.sx.toFixed(3)}, ${a.sy.toFixed(3)})`);
      // Paillettes à l'arrivée.
      const su = te - T.arc;
      this.sparks.forEach((s, i) => {
        if (calm || su < 0 || su > 0.6) {
          s.style.opacity = "0";
          return;
        }
        const ang = (i / this.sparks.length) * Math.PI * 2 + 0.3;
        const r = 14 + (1 - Math.pow(1 - su / 0.6, 3)) * 34;
        this.place(s, land.x + Math.cos(ang) * r, land.y + Math.sin(ang) * r * 0.8, 1 - su / 0.6, 1 - su / 0.6);
      });
      if (w.dest === "replace" && (w.done?.replaced ?? 1) > 0) {
        const binAt = { x: cx + 170, y: land.y };
        const bo = smooth((te - 0.1) / 0.3) * fade;
        const bump = !calm && te > 0.95 && te < 1.35 ? Math.sin(((te - 0.95) / 0.4) * Math.PI) * 0.14 : 0;
        this.place(this.bin, binAt.x, binAt.y, 1 + bump, bo);
        const u = clamp((te - 0.2) / 0.75);
        if (calm) this.place(this.old, binAt.x, binAt.y, 1, (1 - smooth(u * 2)) * 0.5);
        else {
          const p = arcPose(u, -1, mouth, binAt, false, dir);
          this.place(this.old, p.x, p.y, lerp(0.6, 0.25, smooth(u)), 0.5 * (1 - clamp((u - 0.8) * 5)));
        }
      }
    } else if (w.endAt && !w.ok) {
      // Elle recrache l'original, intact : il repart d'où il venait.
      const u = clamp(te / 0.85);
      const p = calm ? { ...w.from, s: 1, o: smooth(u * 2) } : arcPose(u, -1, mouth, w.from, false, dir);
      const fade = 1 - smooth((te - 1.3) / 0.4);
      this.place(this.ghost, p.x, p.y, calm ? 1 : lerp(0.2, 1, smooth(u)), p.o * fade);
    }

    // La pilule de résultat.
    if (w.endAt && now >= w.resultFrom) {
      if (w.hovering) w.resultUntil = Math.max(w.resultUntil, now + 1500);
      if (!w.foldAt && now >= w.resultUntil) w.foldAt = now;
      const tr = (now - w.resultFrom) / 1000;
      const k = calm ? smooth(tr / 0.3) : spr(tr, 7.5, 12.5);
      const out = w.foldAt ? 1 - smooth((now - w.foldAt) / 1000 / T.fold) : 1;
      this.place(this.res, cx, progY - (calm ? 0 : (1 - clamp(k)) * 10 * dir), (calm ? 1 : lerp(0.85, 1, clamp(k, 0, 1.1))) * lerp(0.6, 1, out), clamp(k * 3) * out);
      if (!w.rectPushed.has("res") && tr > 0.4) {
        w.rectPushed.add("res");
        this.hooks.rectChanged();
      }
      if (w.foldAt && out <= 0) {
        this.finish();
        return false;
      }
    } else this.res.style.opacity = "0";
    return true;
  }

  /** Remplit la pilule de résultat (texte sûr : les noms passent par textContent). */
  private fillResult() {
    const w = this.work;
    const s = w?.summary;
    if (!w || !s) return;
    this.res.classList.toggle("bad", !s.ok);
    const name = document.createElement("em");
    name.setAttribute("data-no-i18n", "");
    name.textContent = s.name;
    const text = document.createElement("span");
    text.className = "convert-res-text";
    text.append(name);
    if (s.detail) {
      const detail = document.createElement("span");
      // Déjà traduit par summarize() (un mélange de tailles et de raisons).
      detail.setAttribute("data-no-i18n", "");
      detail.textContent = s.detail;
      text.append(" · ", detail);
    }
    const buttons: HTMLElement[] = [];
    if (s.ok && s.open) {
      const path = s.open;
      buttons.push(this.button("Ouvrir", false, () => {
        this.hooks.bus.emit("convert.open", { path });
        this.foldSoon();
      }));
    }
    if (s.ok && s.undoId !== null) {
      const id = s.undoId;
      const undo = this.button("Annuler", true, async () => {
        undo.disabled = true;
        try {
          await Bridge.undoRun(id);
          text.replaceChildren(document.createTextNode("Annulé"));
        } catch (err) {
          text.replaceChildren(document.createTextNode(String(err).replace(/^Error:\s*/, "")));
        }
        this.foldSoon(1800);
      });
      buttons.push(undo);
    }
    if (!s.ok) buttons.push(this.button("Fermer", true, () => this.foldSoon(0)));
    this.res.replaceChildren(text, ...buttons);
    // Fini : la pilule de progression ne prend plus la souris (« Arrêter » n'a plus de sens).
    this.layer.classList.remove("working");
    // Le résultat est annoncé (role="status") et ses boutons se cliquent.
    this.layer.removeAttribute("aria-hidden");
    this.res.classList.add("live");
  }

  private button(label: string, main: boolean, run: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `convert-btn${main ? " main" : ""}`;
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      run();
    });
    return b;
  }

  /** La pilule de résultat se range bientôt (après un clic). */
  private foldSoon(ms = 600) {
    const w = this.work;
    if (!w) return;
    w.hovering = false;
    w.resultUntil = Math.min(w.resultUntil, performance.now() + ms);
    this.kick();
  }
}
