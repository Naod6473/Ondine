// L'île en gelée : sa forme suit des ressorts (et non plus des transitions
// CSS), elle se creuse sous un clic, se bombe sous la souris, et on peut en
// tirer une bosse comme de la guimauve.
//
// ── Qui décide de la taille ? ────────────────────────────────────────────────
// Toujours le CSS (island.css) : chaque état (data-state), chaque bord de
// l'écran, l'alerte qui grandit pour un long texte (:has(...)), l'île ouverte
// qui grandit pour un QR code (--fit-h, fit.ts)… Ce fichier ne fait que LIRE
// la taille voulue, puis y amène l'île en douceur :
//   1. measure() retire un instant nos styles en ligne (largeur, hauteur,
//      marges intérieures, arrondis) : l'élément reprend la taille que le CSS
//      lui donne, qu'on lit avec getComputedStyle. On remet nos styles tout de
//      suite, dans la même tâche : le navigateur ne dessine rien entre les
//      deux, on ne voit jamais la forme « sautée ». (C'est pour ça que
//      island.css n'anime plus ces propriétés : une transition fausserait la
//      lecture.)
//   2. Dix ressorts (largeur, hauteur, 4 marges, 4 arrondis) partent de là
//      où ils en sont, AVEC LEUR VITESSE, vers cette cible. Un nouvel état en
//      route ne fait que déplacer la cible : l'île repart avec son élan.
//   3. À chaque image, on écrit le résultat en styles en ligne. Une fois tout
//      posé, on efface ces styles : au repos, l'île est exactement celle du CSS.
//
// ── Pourquoi un `clip-path` pour les creux ? ─────────────────────────────────
// Plusieurs façons de déformer un élément HTML ont été comparées :
//   - transform (scale, skew) : déforme tout le rectangle d'un bloc, texte
//     compris ; impossible d'enfoncer un seul point du bord (c'était l'ancien
//     étirement) ;
//   - dessiner l'île dans un <svg> ou un <canvas> : il faudrait redessiner
//     chaque thème (couleur, « Verre » translucide, reflet sous la souris,
//     lignes du mode 8 bits…) à la main, et le contenu HTML resterait carré ;
//   - mask-image avec une image SVG générée : marche, mais il faut fabriquer
//     et décoder une image à chaque image affichée (plus lent) ;
//   - clip-path: path("…") : on découpe la boîte de l'élément le long d'un
//     contour qu'on calcule (contour.ts). Le fond, la transparence du thème
//     « Verre », le reflet, le contenu : tout reste tel quel, simplement
//     rogné. Le navigateur le fait sur la carte graphique, sans mise en page.
//   C'est ce qu'on garde. Sa limite : une découpe ne peut que RETIRER de la
//   boîte. D'où trois astuces pour ce qui doit dépasser :
//   - la bosse de l'étirement (vers l'extérieur) : la boîte est agrandie du
//     côté intérieur d'une « marge de bosse » (headroom), compensée par la
//     marge intérieure (padding) : le contenu ne bouge pas d'un pixel, et la
//     découpe redessine la forme au repos avec la bosse qui sort dans cette
//     marge ;
//   - les crêtes de l'onde (après un creux, le bord ressort un peu) : une
//     légère mise à l'échelle de toute l'île (« gonflement global »), au plus
//     quelques pourcents ;
//   - le survol : l'île grandit vraiment de 2 à 3 px (ajouté à sa taille,
//     sans découpe), et se décale d'un pixel ou deux vers la souris, comme
//     aimantée. Pas de découpe au survol : le liseré du thème « Verre » (une
//     ombre intérieure, collée aux bords de la boîte) disparaîtrait là où la
//     découpe rentre ; pendant un survol, qui peut durer, on le garde intact.
//   La découpe n'existe que pendant une déformation : au repos, plus aucun
//   clip-path (le liseré et les ombres reviennent entiers).
//
// ── Performance ──────────────────────────────────────────────────────────────
// Une seule boucle (requestAnimationFrame) pour tout, qui s'arrête dès que
// tout est posé : île au repos = aucun calcul, aucune image. En économie
// d'énergie (src/core/perf.ts), au plus 30 images par seconde. « Réduire les
// animations » de Windows (prefers-reduced-motion) : rien ne bouge, l'île
// prend directement sa forme.

import { ECO_FPS, perfMode } from "../core/perf";
import {
  EdgeChain,
  nearestU,
  pointAt,
  perimeter,
  sampleContour,
  contourPath,
  type Bump,
  type Radii,
  type Rect,
} from "./contour";
import { horizontal, type Edge } from "./gestures";
import { studioOn } from "./motion";
import { feelFor, rubber, springAtRest, squashScale, stepSpring, type Elasticity, type Feel, type Spring, type SpringParams } from "./spring";
import { reducedMotion } from "./tab-pill";

/** La forme voulue par le CSS. */
interface Shape {
  w: number;
  h: number;
  /** Marges intérieures : haut, droite, bas, gauche. */
  pad: [number, number, number, number];
  r: Radii;
}

/** Les propriétés en ligne que pilote ce fichier (effacées pour lire le CSS, et au repos). */
/** La « glisse » de l'île ouverte qui suit son contenu (fit.ts) : amortie, sans rebond. */
const GLIDE: SpringParams = { stiffness: 150, damping: 1 };
const OWNED = [
  "width",
  "height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const;
/** Les effets (sans incidence sur la taille lue) : effacés au repos. */
const EFFECTS = ["scale", "transform", "transform-origin", "clip-path"] as const;

/** Le gonflement au survol (px), à l'amplitude normale. */
const HOVER_INFLATE = 2.5;
/** De combien l'île se décale vers la souris au survol (px). */
const HOVER_MAGNET = 1.5;
/** Le ressort du survol : vif, presque sans rebond. */
const HOVER_SPRING: SpringParams = { stiffness: 320, damping: 0.75 };
/** Le « choc » d'une alerte (l'épaisseur rentre un peu) : son ressort. */
const THUMP_SPRING: SpringParams = { stiffness: 520, damping: 0.3 };
/** La profondeur d'un creux sous un clic (px) : petite île / grande île. */
const POKE_SMALL = 4;
const POKE_BIG = 8;
/** La largeur du creux (px, demi-largeur de la cloche). */
const POKE_WIDTH = 26;
/** La marge de bosse s'agrandit par paliers (px) : moins de mises en page. */
const HEADROOM_STEP = 8;

export interface JellyHooks {
  edge(): Edge;
  /** "start", "center" ou "end" (data-align sur <body>). */
  align(): string;
  /** L'état de l'île (data-state). */
  state(): string;
  /** Tout s'est posé (la boucle s'arrête) : forme finale à jour. */
  onSettle?(): void;
}

const zero = (): Spring => ({ x: 0, v: 0 });

export class Jelly {
  private target: Shape | null = null;
  /** Les ressorts de la forme (mêmes clés que Shape, à plat). */
  private s = {
    w: zero(),
    h: zero(),
    pt: zero(),
    pr: zero(),
    pb: zero(),
    pl: zero(),
    tl: zero(),
    tr: zero(),
    br: zero(),
    bl: zero(),
  };
  private elasticity: Elasticity = "normal";
  /** Survol : 0 → 1 (gonflé), et le décalage aimanté (px, le long du bord). */
  private hover = zero();
  private hoverTarget = 0;
  private magnet = zero();
  private magnetTarget = 0;
  /** Le contour en ressorts (creux d'un clic, onde, choc d'une alerte). */
  private chain = new EdgeChain(96);
  /** Le choc d'une alerte : l'épaisseur rentre de `thump` (fraction), puis revient. */
  private thump = zero();
  /** La bosse de l'étirement : hauteur et penchant (px), sa place le long du bord. */
  private bumpDepth = zero();
  private bumpShift = zero();
  private bumpCenter = 0;
  private pulling = false;
  private lastPull = { depth: 0, shift: 0, at: 0 };
  /** La marge de bosse actuelle (px), du côté intérieur. */
  private headroom = 0;

  private raf = 0;
  private timer = 0;
  private last = 0;
  private settleCbs: (() => void)[] = [];
  /** Des styles en ligne sont posés (sinon, l'île est celle du CSS). */
  private styled = false;

  constructor(
    private readonly shell: HTMLElement,
    private readonly hooks: JellyHooks,
  ) {}

  /** Le réglage « Élasticité ». */
  setElasticity(e: Elasticity) {
    this.elasticity = e;
  }

  /** La « glisse » : l'île ouverte suit un contenu qui grandit (fit.ts). */
  private glide = false;

  /**
   * Glisse (true) : la taille de l'île ouverte suit sa cible avec un ressort
   * amorti, sans rebond (GLIDE). Une cible qui bouge à chaque mot ne la fait
   * pas sautiller : la vitesse est gardée, la cible rattrapée en douceur.
   */
  setGlide(on: boolean) {
    this.glide = on;
  }

  /** La boucle tourne-t-elle ? */
  get running(): boolean {
    return this.raf !== 0 || this.timer !== 0;
  }

  /** `cb` dès que tout est posé (tout de suite si c'est déjà le cas). */
  whenSettled(cb: () => void) {
    if (!this.running) cb();
    else this.settleCbs.push(cb);
  }

  // ── La forme voulue ────────────────────────────────────────────────────────

  /** Relit la forme voulue par le CSS ; l'île y va en ressort si elle a changé. */
  retarget() {
    const next = this.measure();
    const prev = this.target;
    this.target = next;
    if (!prev || reducedMotion()) {
      // Première mesure, ou animations réduites : la forme tout de suite.
      this.snap();
      return;
    }
    if (!sameShape(prev, next)) this.start();
  }

  /** Lit la forme que le CSS donne à l'île, sans nos styles en ligne. */
  private measure(): Shape {
    const st = this.shell.style;
    const saved = OWNED.map((p) => st.getPropertyValue(p));
    for (const p of OWNED) st.removeProperty(p);
    const cs = getComputedStyle(this.shell);
    const px = (v: string) => parseFloat(v) || 0;
    const shape: Shape = {
      w: px(cs.width),
      h: px(cs.height),
      pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
      r: {
        tl: px(cs.borderTopLeftRadius),
        tr: px(cs.borderTopRightRadius),
        br: px(cs.borderBottomRightRadius),
        bl: px(cs.borderBottomLeftRadius),
      },
    };
    OWNED.forEach((p, i) => saved[i] && st.setProperty(p, saved[i]));
    return shape;
  }

  /** Tout à sa place, sans animation (et sans aucun style en ligne). */
  private snap() {
    this.stop();
    const t = this.target;
    if (t) {
      const set = (sp: Spring, x: number) => {
        sp.x = x;
        sp.v = 0;
      };
      set(this.s.w, t.w);
      set(this.s.h, t.h);
      [this.s.pt, this.s.pr, this.s.pb, this.s.pl].forEach((sp, i) => set(sp, t.pad[i]));
      set(this.s.tl, t.r.tl);
      set(this.s.tr, t.r.tr);
      set(this.s.br, t.r.br);
      set(this.s.bl, t.r.bl);
    }
    this.hover = zero();
    this.hoverTarget = 0;
    this.magnet = zero();
    this.magnetTarget = 0;
    this.thump = zero();
    this.bumpDepth = zero();
    this.bumpShift = zero();
    this.pulling = false;
    this.chain.reset();
    this.headroom = 0;
    this.clearStyles();
    this.settled();
  }

  // ── Les entrées ────────────────────────────────────────────────────────────

  /**
   * La souris (coordonnées de la fenêtre) : en mini-île (compact), l'île
   * gonfle un peu et penche vers elle. Ailleurs, ou souris dehors : rien.
   */
  pointer(x: number, y: number) {
    let want = 0;
    let magnet = 0;
    if (this.hooks.state() === "compact" && !reducedMotion() && !this.pulling) {
      const r = this.shell.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width > 0) {
        want = 1;
        // -1 (bout gauche ou haut) à 1 (bout droit ou bas), le long du bord.
        const side = horizontal(this.hooks.edge()) ? (x - (r.left + r.width / 2)) / (r.width / 2) : (y - (r.top + r.height / 2)) / (r.height / 2);
        magnet = Math.max(-1, Math.min(1, side)) * HOVER_MAGNET * this.feel().amp;
      }
    }
    if (want === this.hoverTarget && Math.abs(magnet - this.magnetTarget) < 0.05) return;
    this.hoverTarget = want;
    this.magnetTarget = magnet;
    this.start();
  }

  /** La souris quitte l'île (ou l'île change d'état) : elle dégonfle. */
  pointerOut() {
    if (this.hoverTarget === 0 && this.magnetTarget === 0) return;
    this.hoverTarget = 0;
    this.magnetTarget = 0;
    this.start();
  }

  /** Un appui (hors boutons) en (x, y) : le bord le plus proche s'enfonce. */
  press(x: number, y: number) {
    if (!this.canDeform()) return;
    const rect = this.rect();
    const local = this.toLocal(x, y);
    this.pinGlued(rect);
    const u = nearestU(rect, local.x, local.y);
    const big = Math.min(rect.w, rect.h) > 80;
    const depth = (big ? POKE_BIG : POKE_SMALL) * this.feel().amp;
    this.chain.press(u, depth, POKE_WIDTH / Math.max(1, perimeter(rect)));
    this.start();
  }

  /** On relâche : le creux revient, l'onde fait le tour. */
  release() {
    this.chain.release();
    this.start();
  }

  /** Une alerte arrive : l'île encaisse un choc (un creux au milieu du bord intérieur, puis une onde). */
  shock() {
    if (!this.canDeform()) return;
    const rect = this.rect();
    this.pinGlued(rect);
    const inner = this.innerMiddle(rect);
    const amp = this.feel().amp;
    this.chain.impulse(nearestU(rect, inner.x, inner.y), 320 * amp, 0.07);
    this.thump.v += 2.2 * amp;
    this.start();
  }

  /**
   * L'étirement (gestures.ts) : `amount` px vers le centre de l'écran (déjà
   * « élastique », négatif = on pousse), la souris en (x, y). La bosse suit la
   * souris le long du bord ; au-delà du bout de l'île, son sommet penche.
   */
  pull(amount: number, x: number, y: number) {
    if (reducedMotion() || !this.target) return;
    const rect = this.rect();
    const local = this.toLocal(x, y);
    const top = horizontal(this.hooks.edge());
    const len = top ? rect.w : rect.h;
    const along = top ? local.x : local.y;
    const r = Math.max(rect.r.tl, rect.r.tr, rect.r.br, rect.r.bl);
    const margin = Math.min(len / 2, r * 0.6 + 12);
    const center = Math.max(margin, Math.min(len - margin, along));
    const now = performance.now();
    const dt = Math.max(0.008, (now - this.lastPull.at) / 1000);
    const shift = rubber(along - center, 22);
    // La vitesse de la souris : gardée pour que le retour parte avec cet élan.
    if (this.pulling) {
      this.bumpDepth.v = (amount - this.lastPull.depth) / dt;
      this.bumpShift.v = (shift - this.lastPull.shift) / dt;
    }
    this.pulling = true;
    this.chain.release();
    this.hoverTarget = 0;
    this.bumpCenter = center;
    this.bumpDepth.x = amount;
    this.bumpShift.x = shift;
    this.lastPull = { depth: amount, shift, at: now };
    this.start();
  }

  /** On lâche la bosse : elle revient en rebondissant. */
  letGo() {
    if (!this.pulling) return;
    this.pulling = false;
    // Une vitesse trop vieille (souris arrêtée avant de lâcher) ne compte plus.
    if (performance.now() - this.lastPull.at > 80) this.bumpDepth.v = this.bumpShift.v = 0;
    this.start();
  }

  // ── Le calcul, image par image ─────────────────────────────────────────────

  private feel(): Feel {
    const big = (this.target?.w ?? 0) > 600 || this.hooks.state() === "expanded";
    return feelFor(this.elasticity, studioOn(), big);
  }

  /** Les déformations ont-elles un sens maintenant ? */
  private canDeform(): boolean {
    if (reducedMotion() || !this.target) return false;
    const st = this.hooks.state();
    // Trop petite pour se creuser, ou en plein déplacement.
    if (st === "hidden" || st === "peek") return false;
    return !this.shell.classList.contains("moving");
  }

  private start() {
    if (reducedMotion()) {
      this.snap();
      return;
    }
    if (this.running) return;
    this.last = performance.now();
    this.schedule();
  }

  private schedule() {
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    this.raf = this.timer = 0;
  }

  private tick = () => {
    this.raf = 0;
    if (reducedMotion()) {
      this.snap();
      return;
    }
    const t = performance.now();
    const dt = Math.min(1 / 20, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    const resting = this.step(dt);
    if (resting) {
      this.finish();
      return;
    }
    this.paint();
    if (perfMode() === "eco") {
      // Économie d'énergie : une image sur deux (comme frameLoop dans perf.ts).
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.schedule();
      }, 1000 / ECO_FPS - 1000 / 60);
    } else this.schedule();
  };

  /** Avance tous les ressorts de `dt` s ; vrai si tout est posé. */
  private step(dt: number): boolean {
    const t = this.target;
    if (!t) return true;
    const f = this.feel();
    // L'épaisseur (hauteur en haut de l'écran, largeur sur un côté) mène, la longueur suit.
    const top = horizontal(this.hooks.edge());
    // En glisse (contenu qui grandit, fit.ts) : un seul ressort amorti, sans rebond.
    const glide = this.glide && this.hooks.state() === "expanded";
    const pw = glide ? GLIDE : top ? f.trail : f.lead;
    const ph = glide ? GLIDE : top ? f.lead : f.trail;
    const s = this.s;
    let rest = true;
    const go = (sp: Spring, to: number, p: SpringParams) => {
      stepSpring(sp, to, p, dt);
      if (!springAtRest(sp, to)) rest = false;
    };
    go(s.w, t.w, pw);
    go(s.h, t.h, ph);
    go(s.pt, t.pad[0], ph);
    go(s.pb, t.pad[2], ph);
    go(s.pr, t.pad[1], pw);
    go(s.pl, t.pad[3], pw);
    go(s.tl, t.r.tl, f.lead);
    go(s.tr, t.r.tr, f.lead);
    go(s.br, t.r.br, f.lead);
    go(s.bl, t.r.bl, f.lead);
    // Le survol ne compte plus hors de la mini-île.
    if (this.hooks.state() !== "compact") this.hoverTarget = this.magnetTarget = 0;
    stepSpring(this.hover, this.hoverTarget, HOVER_SPRING, dt);
    stepSpring(this.magnet, this.magnetTarget, HOVER_SPRING, dt);
    if (!springAtRest(this.hover, this.hoverTarget, 0.01, 0.05) || !springAtRest(this.magnet, this.magnetTarget, 0.05, 0.5)) rest = false;
    stepSpring(this.thump, 0, THUMP_SPRING, dt);
    if (!springAtRest(this.thump, 0, 0.002, 0.02)) rest = false;
    this.chain.step(dt, f.edge);
    if (!this.chain.atRest()) rest = false;
    if (!this.pulling) {
      stepSpring(this.bumpDepth, 0, f.bump, dt);
      stepSpring(this.bumpShift, 0, f.bump, dt);
      if (!springAtRest(this.bumpDepth, 0, 0.2, 3) || !springAtRest(this.bumpShift, 0, 0.2, 3)) rest = false;
    } else rest = false;
    return rest;
  }

  /** Tout est posé : la forme finale, puis on prévient. */
  private finish() {
    const t = this.target;
    if (t) {
      const set = (sp: Spring, x: number) => {
        sp.x = x;
        sp.v = 0;
      };
      set(this.s.w, t.w);
      set(this.s.h, t.h);
      [this.s.pt, this.s.pr, this.s.pb, this.s.pl].forEach((sp, i) => set(sp, t.pad[i]));
      set(this.s.tl, t.r.tl);
      set(this.s.tr, t.r.tr);
      set(this.s.br, t.r.br);
      set(this.s.bl, t.r.bl);
    }
    this.hover.x = this.hoverTarget;
    this.magnet.x = this.magnetTarget;
    this.hover.v = this.magnet.v = 0;
    this.thump = zero();
    this.bumpDepth = zero();
    this.bumpShift = zero();
    this.chain.reset();
    this.headroom = 0;
    // Gonflée au survol : on garde la forme gonflée (statique) ; sinon, plus
    // aucun style en ligne, le CSS reprend la main.
    if (this.hover.x > 0 || this.magnet.x !== 0) this.paint();
    else this.clearStyles();
    this.settled();
  }

  private settled() {
    const cbs = this.settleCbs;
    this.settleCbs = [];
    for (const cb of cbs) cb();
    this.hooks.onSettle?.();
  }

  private clearStyles() {
    if (!this.styled) return;
    const st = this.shell.style;
    for (const p of OWNED) st.removeProperty(p);
    for (const p of EFFECTS) st.removeProperty(p);
    this.styled = false;
  }

  // ── Le dessin ──────────────────────────────────────────────────────────────

  /** La forme au repos à cet instant (taille des ressorts + gonflement du survol). */
  private rect(): Rect {
    const top = horizontal(this.hooks.edge());
    const inflate = Math.max(0, this.hover.x) * HOVER_INFLATE * this.feel().amp;
    // Le gonflement : 2 × sur la longueur (les deux bouts), 1 × sur l'épaisseur (le bord collé ne bouge pas).
    let w = this.s.w.x + (top ? 2 : 1) * inflate;
    let h = this.s.h.x + (top ? 1 : 2) * inflate;
    // Un dépassement ne sort jamais de la fenêtre (la forme voulue, elle, n'est jamais rognée).
    w = Math.max(0, Math.min(w, Math.max(this.target?.w ?? 0, window.innerWidth)));
    h = Math.max(0, Math.min(h, Math.max(this.target?.h ?? 0, window.innerHeight)));
    return { w, h, r: { tl: this.s.tl.x, tr: this.s.tr.x, br: this.s.br.x, bl: this.s.bl.x } };
  }

  /** Une position de la fenêtre → coordonnées de la forme au repos. */
  private toLocal(x: number, y: number) {
    const b = this.shell.getBoundingClientRect();
    const rect = this.rect();
    // La boîte peut être mise à l'échelle (écrasement) : on ramène à la forme.
    const e = this.hooks.edge();
    const sx = b.width / Math.max(1, rect.w + (horizontal(e) ? 0 : this.headroom));
    const sy = b.height / Math.max(1, rect.h + (horizontal(e) ? this.headroom : 0));
    // La marge de bosse est du côté intérieur : à gauche (bord droit) ou en haut (bord du bas).
    const ox = e === "right" ? this.headroom : 0;
    const oy = e === "bottom" ? this.headroom : 0;
    return { x: (x - b.left) / (sx || 1) - ox, y: (y - b.top) / (sy || 1) - oy };
  }

  /** Le milieu du bord intérieur (celui qui regarde le centre de l'écran). */
  private innerMiddle(rect: Rect) {
    const e = this.hooks.edge();
    if (e === "left") return { x: rect.w, y: rect.h / 2 };
    if (e === "right") return { x: 0, y: rect.h / 2 };
    if (e === "bottom") return { x: rect.w / 2, y: 0 };
    return { x: rect.w / 2, y: rect.h };
  }

  /** Épingle les points du contour collés au bord de l'écran (ils ne doivent pas se creuser). */
  private pinGlued(rect: Rect) {
    const e = this.hooks.edge();
    const a = this.hooks.align();
    const glued = (u: number) => {
      const p = pointAt(rect, u);
      const onTop = p.y <= 0.5;
      const onBottom = p.y >= rect.h - 0.5;
      const onLeft = p.x <= 0.5;
      const onRight = p.x >= rect.w - 0.5;
      if (e === "top") return onTop || (a === "start" && onLeft) || (a === "end" && onRight);
      if (e === "bottom") return onBottom || (a === "start" && onLeft) || (a === "end" && onRight);
      const ends = (a === "start" && onTop) || (a === "end" && onBottom);
      return (e === "left" ? onLeft : onRight) || ends;
    };
    this.chain.pin(glued);
  }

  /** Le point d'attache des mises à l'échelle : le milieu du bord collé à l'écran (ou le coin). */
  private origin(): string {
    const e = this.hooks.edge();
    const a = this.hooks.align();
    const pos = a === "start" ? "0%" : a === "end" ? "100%" : "50%";
    if (e === "left") return `0% ${pos}`;
    if (e === "right") return `100% ${pos}`;
    if (e === "bottom") return `${pos} 100%`;
    return `${pos} 0%`;
  }

  /** Écrit la forme de cette image en styles en ligne. */
  private paint() {
    const t = this.target;
    if (!t) return;
    const f = this.feel();
    const e = this.hooks.edge();
    // « top » : l'île est couchée le long d'un bord horizontal (haut ou bas).
    const top = horizontal(e);
    const rect = this.rect();
    const st = this.shell.style;
    this.styled = true;

    // La marge de bosse : seulement si la bosse sort, par paliers, avec un peu
    // d'hystérésis (elle ne rétrécit que si elle est nettement trop grande).
    const out = Math.max(0, this.bumpDepth.x);
    const need = out > 0.5 ? out + 2 : 0;
    if (need > this.headroom || need < this.headroom - 2 * HEADROOM_STEP) this.headroom = need ? Math.ceil(need / HEADROOM_STEP) * HEADROOM_STEP : 0;
    const hr = this.headroom;

    const pad = [this.s.pt.x, this.s.pr.x, this.s.pb.x, this.s.pl.x].map((v) => Math.max(0, v));
    if (e === "top") pad[2] += hr;
    else if (e === "bottom") pad[0] += hr;
    else if (e === "left") pad[1] += hr;
    else pad[3] += hr;
    st.width = `${rect.w + (top ? 0 : hr)}px`;
    st.height = `${rect.h + (top ? hr : 0)}px`;
    st.paddingTop = `${pad[0]}px`;
    st.paddingRight = `${pad[1]}px`;
    st.paddingBottom = `${pad[2]}px`;
    st.paddingLeft = `${pad[3]}px`;

    // La découpe : pendant un creux, une onde ou une bosse.
    const bumpOn = this.pulling || Math.abs(this.bumpDepth.x) > 0.2 || Math.abs(this.bumpShift.x) > 0.2;
    const chainOn = !this.chain.atRest();
    if ((bumpOn || chainOn) && rect.w > 1 && rect.h > 1) {
      const bump: Bump | null = bumpOn
        ? {
            along: e === "left" ? { x: 1, y: 0 } : e === "right" ? { x: -1, y: 0 } : e === "bottom" ? { x: 0, y: -1 } : { x: 0, y: 1 },
            center: this.bumpCenter,
            depth: this.bumpDepth.x,
            shift: this.bumpShift.x,
            // La base s'élargit à mesure qu'on tire (la guimauve s'étale).
            width: Math.min((top ? rect.w : rect.h) * 0.35, 30 + Math.abs(this.bumpDepth.x) * 0.9),
          }
        : null;
      const points = sampleContour(rect, 5);
      const path = contourPath(points, { x: e === "right" ? hr : 0, y: e === "bottom" ? hr : 0 }, (u) => this.chain.at(u), bump);
      st.clipPath = `path("${path}")`;
      // La découpe dessine déjà les coins : la boîte, elle, reste carrée
      // (sinon ses propres arrondis rogneraient la bosse).
      st.borderRadius = "0";
    } else {
      st.removeProperty("clip-path");
      st.borderTopLeftRadius = `${Math.max(0, rect.r.tl)}px`;
      st.borderTopRightRadius = `${Math.max(0, rect.r.tr)}px`;
      st.borderBottomRightRadius = `${Math.max(0, rect.r.br)}px`;
      st.borderBottomLeftRadius = `${Math.max(0, rect.r.bl)}px`;
    }

    // L'écrasement : selon la vitesse de l'épaisseur (volume conservé), le
    // choc d'une alerte, et le gonflement global des crêtes de l'onde.
    const thickV = top ? this.s.h.v : this.s.w.v;
    let [sa, sl] = squashScale(thickV, f.squash);
    sa *= 1 - Math.max(-0.08, Math.min(0.08, this.thump.x * 0.04));
    const thick = Math.max(20, top ? rect.h : rect.w);
    const swell = 1 + Math.min(0.03, (this.chain.maxOut() * 0.5) / thick);
    sa *= swell;
    sl *= swell;
    // Toujours dans la fenêtre.
    const len = top ? rect.w : rect.h;
    const room = top ? window.innerWidth : window.innerHeight;
    if (len * sl > room && len > 0) sl = Math.max(1, room / len);
    const scaled = Math.abs(sa - 1) > 0.0005 || Math.abs(sl - 1) > 0.0005;
    if (scaled) {
      st.transformOrigin = this.origin();
      st.scale = top ? `${sl.toFixed(4)} ${sa.toFixed(4)}` : `${sa.toFixed(4)} ${sl.toFixed(4)}`;
    } else st.removeProperty("scale");

    // L'aimant du survol : un pixel ou deux vers la souris, le long du bord.
    const m = this.magnet.x;
    if (Math.abs(m) > 0.02) st.transform = top ? `translateX(${m.toFixed(2)}px)` : `translateY(${m.toFixed(2)}px)`;
    else st.removeProperty("transform");
  }
}

function sameShape(a: Shape, b: Shape): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return (
    close(a.w, b.w) &&
    close(a.h, b.h) &&
    a.pad.every((v, i) => close(v, b.pad[i])) &&
    close(a.r.tl, b.r.tl) &&
    close(a.r.tr, b.r.tr) &&
    close(a.r.br, b.r.br) &&
    close(a.r.bl, b.r.bl)
  );
}
