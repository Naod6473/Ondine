// Ondine convertit (1.2.5) : le geste, dans la fenêtre de l'île.
//
// Dépôt unifié (maquette-depot-unifie.html, version A) : un fichier glissé
// vers l'île, elle s'ouvre et montre tout DANS l'île, en pilules du même
// style (drop-panel.ts) : la ligne « Convertir » (les formats de CE fichier,
// le dernier choix en premier), « Ranger », « Outils », et la pilule
// d'option (Conserver / Remplacer / Sur le bureau) dans l'en-tête.
//
// Ici, ce qui suit le lâcher sur une pilule de format : Ondine avale le
// fichier, mâche (la pilule choisie glisse dans le bas de la mini-île et s'y
// remplit, le liquide de l'île monte avec la vraie progression), puis
// recrache le nouveau fichier (un arc vers sa place) et la pilule de résultat
// prend la place de la progression, toujours DANS l'île : « photo.jpg ·
// 3,4 Mo → 820 Ko · Ouvrir · Annuler ». Échec : grimace, l'original ressort,
// une ligne dit pourquoi. La mini-île est plus haute pendant ce temps (classe
// convert-work, convert.css), et plus large s'il le faut pour le résultat.
//
// Qui fait quoi :
//   - drop-panel.ts : les pilules, le survol (positions envoyées par la cible
//     de dépôt de l'île, platform/drop_target.rs, Maj comprise), la pilule
//     d'option, la phrase qui dit ce qui va se passer ;
//   - ici : les animations après le lâcher, les expressions d'Ondine, le liquide ;
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
  outKind,
  parseLast,
  pillsFor,
  remember,
  summarize,
  type Dest,
  type DoneMessage,
  type FormatId,
  type Kind,
  type LastChoices,
  type Pill,
  type Summary,
} from "../modules/convert/convert-logic";
import { arcPose, expressionAt, liquidLevel, resultWidth, swallowPose, T, workY, type WorkPhase } from "./convert-plan";
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
/** La largeur de la mini-île pendant le travail (au moins ; plus si le résultat le demande). */
const WORK_W = 400;
/** Le rouge doux d'un échec (comme la maquette). */
const FAIL_TINT = "#ff8f78";

export interface ConvertHooks {
  /** La fenêtre de l'île (la couche du geste est posée sur la forme de l'île). */
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
  /** La forme voulue de l'île a changé (largeur du résultat) : la gelée la rejoint. */
  reshape(): void;
}

/** Ce que l'île propose de convertir pour ces fichiers. */
export interface ConvertOffer {
  kind: Kind;
  pills: Pill[];
  /** Le dernier format choisi pour ce type (il passe en premier). */
  last?: FormatId;
}

/** Une conversion demandée par un lâcher sur une pilule de format (drop-panel.ts). */
export interface ConvertStart {
  paths: string[];
  pill: Pill;
  kind: Kind;
  dest: Dest;
  /** Le point de lâcher (px CSS de la fenêtre). */
  from: { x: number; y: number };
  /** La pilule lâchée : son centre et sa largeur (la progression part de là). */
  slot: { x: number; y: number; w: number };
}

interface Work {
  startedAt: number;
  paths: string[];
  label: string;
  batch: boolean;
  kind: Kind;
  dest: Dest;
  from: { x: number; y: number };
  slot: { x: number; y: number; w: number };
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
export const SPIN_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none"/><path d="M13 2.5V5h-2.5" fill="none"/></svg>`;

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
  private readonly prog = document.createElement("button");
  private readonly progFill = document.createElement("span");
  private readonly progLabel = document.createElement("span");
  private readonly res = document.createElement("div");
  private readonly ghost = document.createElement("div");
  private readonly made = document.createElement("div");
  private readonly old = document.createElement("div");
  private readonly bin = document.createElement("div");
  private readonly sparks: HTMLElement[] = [];

  private listened = false;
  private work: Work | null = null;
  private frame = 0;
  private last = 0;
  private expression = "";

  constructor(private readonly hooks: ConvertHooks) {
    this.layer.className = "convert-layer";
    this.layer.setAttribute("aria-hidden", "true");
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
    this.layer.append(this.prog, this.res, this.old, this.bin, this.ghost, this.made, ...this.sparks);
    this.hooks.root.append(this.layer);
  }

  // ── Ce que l'île appelle ───────────────────────────────────────────────────

  private calm(): boolean {
    return reducedMotion() || calmMode();
  }

  /** Une conversion est en cours (pas encore finie) : pas de nouvelle ligne « Convertir ». */
  busy(): boolean {
    return !!this.work && !this.work.done;
  }

  /**
   * Les formats à proposer pour ces fichiers, ou null (module désactivé,
   * conversion en cours, rien à proposer).
   */
  offer(paths: string[]): ConvertOffer | null {
    if (!settingsStore.moduleEnabled("convert") || this.busy()) return null;
    const last = readLast();
    const offer = pillsFor(paths, last);
    return offer ? { ...offer, last: last[offer.kind] } : null;
  }

  /** Où va le résultat au départ (réglage « Où va le résultat, au départ »). */
  defaultDest(): Dest {
    return asDest(settingsStore.moduleValues(convertManifest as ModuleManifest).dest);
  }

  /** Un nouveau glisser commence : le résultat précédent (déjà fini) se range. */
  dragStarted() {
    if (this.work?.done) this.finish();
  }

  /** L'expression d'Ondine pendant le glisser : surprise à l'ouverture, attentive sur une pilule. */
  react(phase: "open" | "hover" | "idle") {
    if (phase === "idle") {
      this.expression = "";
      return;
    }
    this.express(phase, 0);
  }

  /** Le fichier est lâché sur une pilule de format : Ondine l'avale, et c'est parti. */
  start(req: ConvertStart) {
    this.listen();
    if (this.work) this.finish();
    writeLast(remember(readLast(), req.kind, req.pill.id));
    this.work = {
      startedAt: performance.now(),
      paths: req.paths,
      label: req.pill.label,
      batch: req.paths.length > 1,
      kind: req.kind,
      dest: req.dest,
      from: req.from,
      slot: req.slot,
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
    this.layer.classList.add("on", "working");
    // La mini-île s'agrandit pour garder la pilule dedans (convert.css).
    this.hooks.shell.classList.add("convert-work");
    this.hooks.shell.style.setProperty("--convert-w", `${WORK_W}px`);
    this.ghost.innerHTML = fileIcon(req.kind);
    this.made.innerHTML = fileIcon(outKind(req.pill.id, req.kind));
    this.old.innerHTML = fileIcon(req.kind);
    this.progLabel.textContent = req.pill.label;
    this.prog.classList.remove("bad");
    this.res.classList.remove("bad");
    this.res.replaceChildren();
    this.hooks.keepOpen(true);
    this.express("swallow", 0);
    [120, 420, 760].forEach((ms) => window.setTimeout(() => this.work && !this.work.done && sounds.chomp(), ms));
    // Le module appelle le Rust (src/modules/convert/index.ts).
    this.hooks.bus.emit("convert.request", { paths: req.paths, format: req.pill.id, label: req.pill.label, dest: req.dest, kind: req.kind });
    log.info(`conversion demandée : ${req.pill.id}, ${req.paths.length} élément(s), ${req.dest}`);
    this.kick();
  }

  /** Le rectangle des pilules cliquables (progression, résultat), en px CSS, ou null. */
  hitRect(): { x: number; y: number; w: number; h: number } | null {
    const w = this.work;
    if (!w) return null;
    const r = (w.endAt ? this.res : this.prog).getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 };
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

  // ── Expressions, liquide ───────────────────────────────────────────────────

  private express(phase: WorkPhase | "open" | "hover", t: number) {
    if (this.calm()) return;
    const e = expressionAt(phase, t, !!this.work?.batch);
    if (!e || e.anim === this.expression) return;
    this.expression = e.anim;
    this.hooks.bus.emit("mascot.play", { animation: e.anim, emotion: e.emotion });
  }

  // ── Les états ──────────────────────────────────────────────────────────────

  /** Tout est fini : la couche se vide, l'île peut se replier. */
  private finish() {
    const hadWork = !!this.work;
    if (this.work?.liquid) hideLiquid(LIQUID_ID);
    this.work = null;
    this.expression = "";
    this.layer.classList.remove("on", "working");
    for (const n of [this.prog, this.res, this.ghost, this.made, this.old, this.bin, ...this.sparks]) n.style.opacity = "0";
    this.res.replaceChildren();
    this.res.classList.remove("live");
    this.layer.setAttribute("aria-hidden", "true");
    this.hooks.shell.classList.remove("convert-work");
    this.hooks.shell.style.removeProperty("--convert-w");
    if (hadWork) {
      this.hooks.keepOpen(false);
      this.hooks.rectChanged();
      this.hooks.reshape();
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
      more = this.work ? this.drawWork(now, dt) : false;
    } catch (err) {
      log.warn(`geste de conversion : ${String(err)}`);
      this.finish();
    }
    if (more) this.frame = requestAnimationFrame((n) => this.tick(n));
  }

  /** La forme de l'île : le sens (1 = l'île s'ouvre vers le bas), son centre, son rectangle. */
  private anchor(): { dir: 1 | -1; cx: number; rect: DOMRect } {
    const rect = this.hooks.shell.getBoundingClientRect();
    const bottom = document.body.dataset.edge === "bottom";
    return { dir: bottom ? -1 : 1, cx: rect.left + rect.width / 2, rect };
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

  /** Après le lâcher : avaler, mâcher, recracher (ou grimacer), le résultat. */
  private drawWork(now: number, dt: number): boolean {
    const w = this.work!;
    const calm = this.calm();
    const { dir, cx, rect } = this.anchor();
    const mouth = this.mouth();
    const t = (now - w.startedAt) / 1000;

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

    // La pilule de progression : de la place de la pilule choisie vers le bas
    // de la mini-île (le haut pour une île en bas), qui rétrécit en même temps.
    const progY = workY(rect, dir);
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

    // Recraché : l'arc du nouveau fichier (il sort de l'île vers sa place),
    // l'original qui part à la Corbeille.
    if (w.endAt && w.ok) {
      const edgeY = dir === 1 ? rect.bottom : rect.top;
      const land = { x: cx - 170, y: clamp(edgeY + dir * 40, 24, window.innerHeight - 24) };
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

    // La pilule de résultat, à la place de la progression, dans l'île.
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
    // La mini-île s'élargit si le résultat est plus large qu'elle (jamais coupé).
    const need = resultWidth(this.res.scrollWidth, WORK_W, window.innerWidth);
    this.hooks.shell.style.setProperty("--convert-w", `${need}px`);
    this.hooks.reshape();
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
