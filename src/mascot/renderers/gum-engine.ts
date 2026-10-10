// Le moteur de la famille « gomme » (mascots/goutte-gomme, et toutes les formes
// de gum-family.ts : Guimauve, Dragée, étoile, soleil, lune…). Tout est dessiné
// en code (gum-draw.ts), et le corps bouge comme une gelée.
//
// Ce fichier ne connaît ni les réglages, ni Tauri, ni core/perf.ts : tout ce
// qui vient de l'appli (couleur et accessoires choisis, boucle de dessin,
// « Réduire les animations ») lui est passé dans un `GumEnv`. gum.ts le
// branche sur l'appli ; gum-standalone.ts sur une simple page web (le site).
//
// Principe : chaque animation est une fonction qui, pour un instant donné,
// décrit l'image voulue (ANIMS de gum-anims.ts : yeux, bouche, couleur,
// étirement, mains…). Rien n'y saute d'un coup : tout ce que l'animation
// demande est une CIBLE, et la mascotte y va en douceur.
//   - Le visage : chaque réglage (ouverture des yeux, courbe de la bouche…)
//     glisse vers sa cible, chacun à sa vitesse : les yeux et la bouche vite,
//     les sourcils (un ressort qui dépasse un peu) et les joues après, ce qui
//     fait le « rattrapage » ; les yeux spéciaux (cœurs, spirales)
//     apparaissent en fondu.
//   - Une émotion peut être dosée (un peu / très) et mélangée à une autre
//     (mi-surprise mi-ravie) : express(), depuis mascot.emote.
//   - Anticipation : avant un geste, elle se tasse une fraction de seconde et
//     son regard part avant sa tête (les pupilles, puis le visage qui glisse
//     sur le volume).
//   - Le corps : un RESSORT pour l'étirement et l'inclinaison (il dépasse,
//     revient, se calme) ; avant un saut elle se tasse (on regarde un peu dans
//     le futur de l'animation pour le savoir), elle s'allonge en l'air selon sa
//     vitesse et s'écrase en retombant (des images clés : écrasée, étirée,
//     un peu écrasée, posée). Quand elle se déplace, le haut traîne derrière
//     (la traînée de gomme).
//   - Le contour : une chaîne de points reliés par des ressorts (une vraie
//     gelée). Un clic y lance une onde, les joues gonflent quand elle boude.
//   - Au repos, jamais deux fois la même chose : sa respiration varie, et de
//     temps en temps elle déplace son poids, soupire, fait la moue, regarde
//     ailleurs (moins souvent avec le réglage « Calme »).
//   - La lumière : le reflet glisse sur le volume vers la souris (ou suit
//     l'heure, comme le soleil), la gomme laisse passer la lumière, les bulles
//     remontent et tremblent aux sauts, les reflets prennent la teinte de la
//     pochette en lecture.
//   - La bouche suit la voix (talk(), mascot.talk), les sourcils montent sur
//     « ? » et « ! ».
//   - Le visage traîne un peu derrière le corps, les mains suivent leur pose
//     avec leur propre ressort, la couleur passe en fondu.
// Tout est lissé en fonction du temps écoulé (exp(-dt·k)) : même rendu à 30
// ou à 60 images par seconde.
// Avec « Réduire les animations » de Windows, tout va directement à sa cible,
// chaque animation est une image fixe, et on ne redessine plus tant que rien
// ne change.

import type { MascotExpression, MascotReaction, MascotRenderer, TalkMark } from "../renderer";
import { NO_EXTRAS, type AnimationSpec, type MascotExtras, type MascotManifest, type MascotState, type Mood } from "../types";
import { ANIMS, BLINK, blinkCurve, faceOf, HAND_FOR, HANDS, IDLE_ACT_SECS, IDLE_ACTS, idleAct, JellyRim, LANDING, landingSquash, skyShape, weatherLook, type DynamicShape, type Frame, type HandPose, type IdleAct } from "./gum-anims";
import {
  DEFAULT_CUSTOM,
  drawGum,
  FACE_BASE,
  FACE_KEYS,
  gumRadius,
  LIGHT_REST,
  NO_PROPS,
  palette,
  PROP_KEYS,
  TINT_NAMES,
  type EyeKind,
  type EyeWear,
  type Face,
  type GumTint,
  type Hand,
  type HeadWear,
  type NeckWear,
  type Palette,
  type Props,
  type Rgb,
  type WeatherFx,
} from "./gum-draw";
import { isShape, mixPts, N, normals, puffWeights, SHAPES, type GumShape, type Pt, type ShapeId } from "./gum-shapes";

/** Les réglages de la mascotte qui touchent au dessin (couleur, mains, accessoires). */
export interface GumPrefs {
  color: GumTint | "auto";
  /** La couleur libre (#rrggbb) quand `color` vaut "custom". */
  customColor: string;
  hands: "always" | "gestures" | "never";
  wear: { head: HeadWear; eyes: EyeWear; neck: NeckWear };
  /** Réglage « Calme » : moins de petits gestes spontanés au repos. */
  calm?: boolean;
}

/** Les réglages par défaut : couleur de la forme, mains toujours, rien sur elle. */
export const GUM_PREFS_DEFAULT: GumPrefs = { color: "auto", customColor: DEFAULT_CUSTOM, hands: "always", wear: { head: "none", eyes: "none", neck: "none" }, calm: false };

/** Ce que le moteur demande à son hôte (l'appli ou une page web). */
export interface GumEnv {
  /** Les réglages du moment (lus au montage, puis à chaque `onPrefsChange`). */
  prefs(): GumPrefs;
  /** Prévenu quand les réglages changent ; renvoie de quoi se désabonner. */
  onPrefsChange(fn: () => void): () => void;
  /**
   * La boucle de dessin : appelle `draw` à chaque image tant que `target` a
   * une taille ; renvoie la fonction qui l'arrête. (L'appli : frameLoop de
   * core/perf.ts, qui ralentit en économie d'énergie.)
   */
  frameLoop(target: Element, draw: (now: number) => void): () => void;
  /** « Réduire les animations » : tout va droit à sa cible. */
  reducedMotion(): boolean;
  /** Facultatif : la couleur de l'environnement (la pochette du morceau en lecture), posée sur les reflets. */
  envTint?(): Rgb | null;
}

const TAU = Math.PI * 2;

/** Raideur et amortissement du ressort de l'étirement (par seconde). */
const STIFF = 170;
const DAMP = 9;

/** L'anticipation avant un geste ponctuel (ms) : elle se tasse, le regard part. */
const ANTICIPATION_MS = 110;

/**
 * La vitesse (par seconde) à laquelle chaque réglage du visage rejoint sa
 * cible : les yeux et la bouche vite, la pupille comme un vrai œil, les joues
 * et les larmes lentement (elles « retombent » après l'expression).
 */
const FACE_RATE: Partial<Record<keyof Face, number>> = { pupil: 6, blush: 4, lines: 4, tears: 3, teary: 3, puff: 6, browA: 8, browTilt: 7, browAsym: 7 };

/** Mélange deux descriptions d'image (0 = a, 1 = b) : le corps, les accessoires, la pose dominante. */
function blendFrames(a: Frame, b: Frame, k: number): Frame {
  const m = (x: number | undefined, y: number | undefined, base: number) => (x ?? base) + ((y ?? base) - (x ?? base)) * k;
  const top = k < 0.5 ? a : b;
  const prop: Partial<Props> = {};
  for (const key of PROP_KEYS) prop[key] = m(a.prop?.[key], b.prop?.[key], 0);
  return {
    ...top,
    squash: m(a.squash, b.squash, 1),
    rot: m(a.rot, b.rot, 0),
    dx: m(a.dx, b.dx, 0),
    dy: m(a.dy, b.dy, 0),
    tip: m(a.tip, b.tip, 0),
    gaze: a.gaze && b.gaze ? { x: a.gaze.x + (b.gaze.x - a.gaze.x) * k, y: a.gaze.y + (b.gaze.y - a.gaze.y) * k } : top.gaze,
    blink: a.blink !== false && b.blink !== false,
    extra: a.extra && a.extra !== "none" ? a.extra : b.extra,
    prop,
  };
}

export class GumEngine implements MascotRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  /** Vrai : le canvas est à nous (créé ici), faux : celui de la page. */
  private ownCanvas = true;
  private observer: ResizeObserver | null = null;
  private seen: IntersectionObserver | null = null;
  /** Hors de l'écran (dans une page qui défile) : on ne dessine pas. */
  private visible = true;
  private stopFrames: () => void = () => {};
  private stopPrefs: () => void = () => {};
  private anim: AnimationSpec | null = null;
  private animStart = 0;
  private ended = false;
  private mood: Mood = "neutral";
  private endCallbacks: ((name: string) => void)[] = [];
  private lookTarget: { x: number; y: number } | null = null;
  /** La dernière fois que la souris a bougé près d'elle (pour le reflet, qui suit sinon l'heure). */
  private lookAtTime = -1e9;
  private pointer = { x: 0, y: 0, at: 0 };
  /** Les pupilles, et la tête qui suit (le visage glisse sur le volume, un peu après). */
  private look = { x: 0, y: 0 };
  private head = { x: 0, y: 0 };
  private saccade = { x: 0, y: 0, next: 0 };
  private nextBlink = performance.now() + 2000;
  private blinkStart = -1;
  private doubleBlink = false;
  private last = performance.now();
  private clock = 0;

  /** Le ressort de l'étirement et de l'inclinaison. */
  private jelly = { sq: 1, sqV: 0, rot: 0, rotV: 0 };
  private rim = new JellyRim();
  private face: Face = { ...FACE_BASE };
  /** La vitesse des sourcils levés (un ressort : ils dépassent un peu, puis retombent). */
  private browV = 0;
  private eyes: EyeKind = "normal";
  private eyesPrev: EyeKind = "normal";
  private eyesMix = 1;
  private faceLag = { y: 0, v: 0 };
  private prevDy = 0;
  private prevVy = 0;
  private tip = 0;
  private colors: Palette;
  private hands: [Hand & { vx: number; vy: number; vr: number }, Hand & { vx: number; vy: number; vr: number }];
  private handsAlpha = 1;
  private flinch = 0;
  /** L'île est étirée : la mascotte s'étire avec elle (en plus de son étirement à elle). */
  private hold = 0;

  /** Ce qu'elle sort le temps d'un geste (en fondu). */
  private props: Props = { ...NO_PROPS };
  /** Dosage et mélange de l'émotion en cours (express) ; miroir : le geste part de l'autre côté. */
  private intensity = 1;
  private mixFn: ((t: number, p: number, mood: Mood) => Frame) | null = null;
  private mixK = 0;
  private mirror = false;
  /** La fin de l'anticipation du geste en cours (performance.now()). */
  private anticUntil = 0;
  /** La voix : ouverture voulue de la bouche, quand elle est arrivée, le « ? » ou « ! » en cours. */
  private talkWant = 0;
  private talkAt = -1e9;
  private talkLevel = 0;
  private mark: TalkMark | null = null;
  private markAt = -1e9;
  /** L'intérêt quand la souris bouge vite près d'elle (yeux un peu plus grands). */
  private perk = 0;
  /** La lumière (le reflet la suit) et la teinte de l'environnement. */
  private light = { ...LIGHT_REST };
  private envTint: Rgb | null = null;
  private envK = 0;
  /** L'atterrissage en cours (secondes depuis le contact, -1 : aucun) et sa force. */
  private landT = -1;
  private landAmp = 0;
  /** La traînée de gomme (cisaillement), son ressort, et le déplacement d'avant. */
  private shear = 0;
  private shearV = 0;
  private prevDx = 0;
  /** Les bulles tremblent après un choc. */
  private jolt = 0;
  /** La respiration du repos : sa phase et sa période, qui varie un peu à chaque souffle. */
  private breath = 0;
  private breathPeriod = 3.2;
  /** Le petit geste du repos en cours, et quand viendra le prochain. */
  private act: { kind: IdleAct; start: number; side: number } | null = null;
  private lastAct: IdleAct | null = null;
  private nextAct = 6;
  /** Avec « Réduire les animations » : ce qu'on a dessiné la dernière fois (rien ne bouge : on ne redessine pas). */
  private lastSig = "";

  /** La forme : fixe, ou « ciel » / « météo » qui changent toutes seules. */
  private readonly dynamic: DynamicShape | null;
  private shape: GumShape;
  private fromShape: GumShape | null = null;
  private fromPts: Pt[] | null = null;
  private morph = 1;
  private weatherIcon: string | null = null;
  private weatherFx: WeatherFx = "none";
  private nextShapeCheck = 0;
  private prefs: GumPrefs;
  /** Ce qu'elle porte en plus (mascot-state.ts) : oreilles bouchées, pancarte, parapluie. */
  private extras: MascotExtras = NO_EXTRAS;
  /** Le parapluie apparaît et disparaît en fondu. */
  private umbrella = 0;

  constructor(
    manifest: MascotManifest | undefined,
    private readonly env: GumEnv,
  ) {
    this.prefs = env.prefs();
    const wanted = manifest?.gum?.shape ?? "goutte";
    this.dynamic = wanted === "ciel" || wanted === "meteo" ? wanted : null;
    this.shape = SHAPES[isShape(wanted) ? wanted : this.dynamic ? this.dynamicShape().shape : "goutte"];
    this.colors = palette(this.baseTint(), 0, this.prefs.customColor);
    const rest = HANDS.rest(0, 0, this.shape);
    this.hands = rest.map((h) => ({ x: 0, y: 0, r: 0, s: 1, thumb: 0, vx: 0, vy: 0, vr: 0, ...h })) as typeof this.hands;
  }

  /**
   * Se dessine dans `container` (un canvas créé ici, qui remplit sa taille), ou
   * directement dans un canvas déjà dans la page (le site).
   */
  mount(container: HTMLElement) {
    if (container instanceof HTMLCanvasElement) {
      this.canvas = container;
      this.ctx = container.getContext("2d")!;
      this.ownCanvas = false;
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    } else {
      this.canvas.className = "mascot-canvas";
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.canvas.style.display = "block";
      container.appendChild(this.canvas);
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }
    // Hors de l'écran (page des Réglages qui défile) : on ne calcule ni ne dessine rien.
    if (typeof IntersectionObserver !== "undefined") {
      this.seen = new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].isIntersecting;
        this.lastSig = "";
      });
      this.seen.observe(this.canvas);
    }
    this.resize();
    this.stopPrefs = this.env.onPrefsChange(() => {
      this.prefs = this.env.prefs();
      this.lastSig = "";
    });
    // Dans l'appli : arrêtée quand la place de la mascotte n'a pas de taille
    // (île cachée), 30 images/s au plus en économie d'énergie (src/core/perf.ts).
    this.stopFrames = this.env.frameLoop(this.canvas, (now) => this.frame(now));
  }

  play(animation: AnimationSpec) {
    this.anim = animation;
    const now = performance.now();
    this.animStart = now;
    this.ended = false;
    // Chaque nouvelle animation repart à pleine force, seule, du bon côté.
    this.intensity = 1;
    this.mixFn = null;
    this.mixK = 0;
    this.mirror = false;
    this.act = null;
    if (!this.env.reducedMotion()) {
      // Un geste ponctuel s'annonce : elle se tasse une fraction de seconde avant.
      if (!animation.loop) {
        this.anticUntil = now + ANTICIPATION_MS;
        this.animStart = this.anticUntil;
      }
      // Une pichenette : la gelée tremble un peu à chaque changement.
      this.jelly.sqV += 1.6;
    }
  }

  /**
   * Dose l'émotion qui vient de commencer (0 à 1), la mélange à une autre
   * animation (`mix`, avec la part `mixK`), ou la joue de l'autre côté
   * (`mirror` : elle pousse, file, grimpe vers la gauche).
   */
  express(e: MascotExpression) {
    this.intensity = Math.max(0, Math.min(1, e.intensity ?? 1));
    const fn = e.mix ? ANIMS[e.mix.source.function ?? e.mix.name] : undefined;
    this.mixFn = fn ?? null;
    this.mixK = fn ? Math.max(0, Math.min(1, e.mixK ?? 0.5)) : 0;
    this.mirror = !!e.mirror;
    this.lastSig = "";
  }

  /**
   * La voix (mascot.talk) : `open` de 0 à 1, envoyé au rythme des syllabes ;
   * sans nouvelle pendant un instant, la bouche se referme. `mark` : un « ? »
   * (sourcils qui montent, un seul plus haut) ou un « ! » (sourcils et yeux).
   */
  talk(open: number, mark?: TalkMark | null) {
    this.talkWant = Math.max(0, Math.min(1, Number.isFinite(open) ? open : 0));
    this.talkAt = performance.now();
    if (mark === "?" || mark === "!") {
      this.mark = mark;
      this.markAt = this.talkAt;
    }
  }

  setState(_state: MascotState) {
    // Tout passe par play().
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  lookAt(x: number | null, y: number | null) {
    if (x == null || y == null) {
      this.lookTarget = null;
      return;
    }
    const now = performance.now();
    // La souris qui file près d'elle l'intéresse : elle ouvre un peu plus les yeux.
    const dtp = Math.max(1, now - this.pointer.at);
    const speed = Math.hypot(x - this.pointer.x, y - this.pointer.y) / dtp; // px par ms
    if (dtp < 200 && Math.hypot(x, y) < 260) this.perk = Math.min(1, this.perk + Math.max(0, speed - 0.6) * 0.25);
    this.pointer = { x, y, at: now };
    this.lookAtTime = now;
    this.lookTarget = { x: x / (Math.abs(x) + 60), y: y / (Math.abs(y) + 60) };
  }

  /** La météo du module Météo (son icône), pour la mascotte « Météo ». */
  setWeather(icon: string | null) {
    this.weatherIcon = icon;
    this.nextShapeCheck = 0;
  }

  setExtras(extras: MascotExtras) {
    this.extras = extras;
  }

  /**
   * Ce qui arrive à l'île (gestures.ts, island.ts) : un clic qui l'enfonce, un
   * étirement, le lâcher, une secousse. x, y : en px par rapport au centre de
   * la mascotte.
   */
  react(kind: MascotReaction, data: { x?: number; y?: number; amount?: number } = {}) {
    if (this.env.reducedMotion()) return;
    const r = this.canvas.getBoundingClientRect();
    const R = Math.max(1, gumRadius(r.width, r.height));
    switch (kind) {
      case "poke": {
        // Le point du contour le plus proche du clic s'enfonce ; elle cligne fort.
        const px = (data.x ?? 0) / R;
        const py = (data.y ?? -R) / R;
        let best = 0;
        let bd = Infinity;
        this.shape.pts.forEach((p, i) => {
          const d = (p.x - px) ** 2 + (p.y - py) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        this.rim.poke(best, 2.4);
        this.jelly.sqV -= 2.2;
        this.flinch = 0.38;
        this.jolt = 1;
        break;
      }
      case "stretch":
        this.hold = Math.min(0.22, (data.amount ?? 0) / 180);
        break;
      case "release":
        this.hold = 0;
        this.jelly.sqV += Math.min(4, (data.amount ?? 20) * 0.06);
        this.jolt = 1;
        break;
      case "shake":
        this.jelly.rotV += (Math.random() < 0.5 ? -1 : 1) * 4;
        for (let k = 0; k < 3; k++) this.rim.poke(Math.floor(Math.random() * N), 1.2);
        this.jolt = 1;
        break;
    }
  }

  onAnimationEnd(cb: (name: string) => void) {
    this.endCallbacks.push(cb);
  }

  destroy() {
    this.stopFrames();
    this.stopPrefs();
    this.observer?.disconnect();
    this.seen?.disconnect();
    // Un canvas fourni par la page lui appartient : on l'efface seulement.
    if (this.ownCanvas) this.canvas.remove();
    else this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.endCallbacks = [];
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.lastSig = "";
  }

  /** La couleur de fond : celle choisie dans les réglages, sinon celle de la forme. */
  private baseTint(): GumTint {
    const c = this.prefs?.color ?? "auto";
    if (c !== "auto" && (TINT_NAMES as string[]).includes(c)) return c as GumTint;
    return this.shape.tint as GumTint;
  }

  private dynamicShape(): { shape: ShapeId; fx: WeatherFx } {
    const hour = new Date().getHours();
    if (this.dynamic === "meteo") return weatherLook(this.weatherIcon, hour);
    return { shape: skyShape(hour), fx: "none" };
  }

  /** Passe en douceur à une autre forme (le soleil qui devient lune…). */
  private morphTo(id: ShapeId) {
    if (id === this.shape.id) return;
    this.fromPts = this.currentPts();
    this.fromShape = this.shape;
    this.shape = SHAPES[id];
    this.morph = 0;
    this.jelly.sqV += 2.5;
  }

  /** Le contour de repos de l'instant (pendant un passage d'une forme à l'autre, le mélange des deux). */
  private currentPts(): Pt[] {
    if (!this.fromPts || this.morph >= 1) return this.shape.pts;
    const k = this.morph * this.morph * (3 - 2 * this.morph);
    return mixPts(this.fromPts, this.shape.pts, k);
  }

  /** La forme utilisée pour le visage et les décors, mélangée pendant un passage. */
  private blendedShape(): GumShape {
    const a = this.fromShape;
    const b = this.shape;
    if (!a || this.morph >= 1) return b;
    const k = this.morph * this.morph * (3 - 2 * this.morph);
    const mix = (x: number, y: number) => x + (y - x) * k;
    return {
      ...b,
      eyeY: mix(a.eyeY, b.eyeY),
      eyeDX: mix(a.eyeDX, b.eyeDX),
      mouthDY: mix(a.mouthDY, b.mouthDY),
      cheekDX: mix(a.cheekDX, b.cheekDX),
      faceX: mix(a.faceX, b.faceX),
      eyeScale: mix(a.eyeScale, b.eyeScale),
      float: mix(a.float, b.float),
      alpha: mix(a.alpha, b.alpha),
      gel: mix(a.gel, b.gel),
      shine: a.shine.map((v, i) => mix(v, b.shine[i])) as GumShape["shine"],
      dot: [mix(a.dot[0], b.dot[0]), mix(a.dot[1], b.dot[1])],
    };
  }

  /** Où est la lumière : vers la souris quand elle bouge près d'elle, sinon là où est le soleil à cette heure. */
  private lightTarget(now: number): { x: number; y: number } {
    if (this.lookTarget && now - this.lookAtTime < 4000) {
      return { x: LIGHT_REST.x + this.lookTarget.x * 0.55, y: LIGHT_REST.y + this.lookTarget.y * 0.4 };
    }
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    // De 7 h (à gauche) à 19 h (à droite), plus haut à midi ; la nuit, une lampe en haut à gauche.
    const k = Math.min(1, Math.max(0, (h - 7) / 12));
    if (h < 6 || h > 21) return { ...LIGHT_REST };
    return { x: -0.6 + 1.0 * k, y: -0.4 - Math.sin(k * Math.PI) * 0.15 };
  }

  private frame(now: number) {
    // Hors de l'écran : rien à calculer (le temps repart proprement au retour).
    if (!this.visible) {
      this.last = now;
      return;
    }
    // Pas de temps (limité : un onglet en veille ne doit pas faire exploser les ressorts).
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    const calm = this.env.reducedMotion();
    const anim = this.anim;
    const elapsed = anim ? Math.max(0, now - this.animStart) : now;
    const dur = anim?.durationMs ?? 4000;
    let t = elapsed / 1000;
    let p: number;
    if (!anim || anim.loop) {
      p = (elapsed % dur) / dur;
    } else {
      p = Math.min(1, elapsed / dur);
      if (p >= 1 && !this.ended) {
        this.ended = true;
        for (const cb of [...this.endCallbacks]) cb(anim.name);
      }
    }
    const name = anim?.source.function ?? anim?.name ?? "idle";
    const fn = ANIMS[name] ?? ANIMS.idle;
    // « Réduire les animations » : chaque animation est une image fixe (le
    // milieu d'un geste, un instant du repos).
    if (calm) {
      p = !anim || anim.loop ? 0.2 : 0.5;
      t = !anim || anim.loop ? 0.8 : (dur * p) / 1000;
    }

    // La forme « ciel » ou « météo » vérifie de temps en temps si elle doit changer.
    if (this.dynamic && this.clock > this.nextShapeCheck) {
      this.nextShapeCheck = this.clock + 20;
      const want = this.dynamicShape();
      this.weatherFx = want.fx;
      this.morphTo(want.shape);
      this.colors = this.colors ?? palette(this.baseTint(), 0, this.prefs.customColor);
    }
    if (this.morph < 1) this.morph = calm ? 1 : Math.min(1, this.morph + dt / 1.3);
    if (this.morph >= 1) {
      this.fromShape = null;
      this.fromPts = null;
    }

    // Rien ne bouge (« Réduire les animations ») : la même image qu'avant, on ne redessine pas.
    if (calm) {
      const env = this.env.envTint?.() ?? null;
      const tint = this.prefs.color;
      const sig = [
        name,
        this.ended,
        this.mood,
        this.intensity,
        this.mixK,
        this.mirror,
        this.extras.ears,
        this.extras.sign,
        this.extras.umbrella,
        this.lookTarget ? `${this.lookTarget.x.toFixed(2)},${this.lookTarget.y.toFixed(2)}` : "-",
        this.talkWant > 0 && now - this.talkAt < 180 ? this.talkWant.toFixed(1) : "0",
        this.flinch > 0,
        this.shape.id,
        this.weatherFx,
        env ? env.join() : "-",
        this.canvas.width,
        this.canvas.height,
      ].join("|");
      if (sig === this.lastSig && tint !== "rainbow") return;
      this.lastSig = sig;
    }
    const S = this.blendedShape();

    // 1. Ce que l'animation demande, mélangée à une autre, dosée, et du bon côté.
    let f = fn(t, p, this.mood);
    if (this.mixFn && this.mixK > 0) f = blendFrames(f, this.mixFn(t, p, this.mood), this.mixK);
    const k = this.intensity;
    if (k < 1) {
      f = {
        ...f,
        squash: 1 + ((f.squash ?? 1) - 1) * k,
        dx: (f.dx ?? 0) * k,
        dy: (f.dy ?? 0) * k,
        rot: (f.rot ?? 0) * k,
        tip: (f.tip ?? 0) * k,
        tintK: f.tintTo ? (f.tintK ?? 0) * k : f.tintK,
      };
    }
    // Au repos : la respiration change un peu à chaque souffle.
    if (name === "idle" && !calm) {
      this.breath += (dt / this.breathPeriod) * TAU;
      if (this.breath > TAU) {
        this.breath -= TAU;
        this.breathPeriod = 2.9 + Math.random() * 0.8;
      }
      f = { ...f, squash: 1 + Math.sin(this.breath) * 0.025 };
    }
    if (this.mirror) {
      f = { ...f, dx: -(f.dx ?? 0), rot: -(f.rot ?? 0), gaze: f.gaze ? { x: -f.gaze.x, y: f.gaze.y } : f.gaze };
    }

    // Les petits gestes du repos (jamais deux fois le même de suite ; plus rares en « Calme »).
    let act: ReturnType<typeof idleAct> | null = null;
    if (name === "idle" && !calm) {
      if (!this.act && this.clock > this.nextAct) {
        const pool = IDLE_ACTS.filter((a) => a !== this.lastAct && (!this.prefs.calm || a === "shift" || a === "sigh"));
        const kind = pool[Math.floor(Math.random() * pool.length)];
        this.act = { kind, start: this.clock, side: Math.random() < 0.5 ? -1 : 1 };
        this.lastAct = kind;
      }
      if (this.act) {
        const ka = (this.clock - this.act.start) / IDLE_ACT_SECS[this.act.kind];
        if (ka >= 1) {
          this.act = null;
          this.nextAct = this.clock + (this.prefs.calm ? 10 + Math.random() * 8 : 4 + Math.random() * 5);
        } else act = idleAct(this.act.kind, ka, this.act.side);
      }
    } else if (this.act) {
      this.act = null;
      this.nextAct = this.clock + 4 + Math.random() * 5;
    }
    if (act && act.w > 0) {
      f = { ...f, squash: (f.squash ?? 1) + act.squash * act.w, rot: (f.rot ?? 0) + act.rot * act.w, dx: (f.dx ?? 0) + act.dx * act.w, gaze: act.gaze && act.w > 0.3 ? act.gaze : f.gaze };
    }

    // 2. Le visage voulu, et le visage réel qui glisse vers lui.
    const want = faceOf(f);
    if (this.mixFn && this.mixK > 0) {
      const other = faceOf(this.mixFn(t, p, this.mood)).face;
      for (const key of FACE_KEYS) want.face[key] += (other[key] - want.face[key]) * this.mixK;
    }
    if (k < 1) {
      // Une émotion dosée : son visage, à mi-chemin du visage du repos.
      const rest = faceOf(ANIMS.idle(t, 0, this.mood)).face;
      for (const key of FACE_KEYS) want.face[key] = rest[key] + (want.face[key] - rest[key]) * k;
    }
    if (act && act.w > 0) for (const [key, v] of Object.entries(act.face) as [keyof Face, number][]) want.face[key] += (v - want.face[key]) * act.w;
    if (this.mirror) want.face.skew = -want.face.skew;
    // La voix : la bouche s'ouvre au rythme des syllabes ; « parle » sans voix babille toute seule.
    const talking = now - this.talkAt < 180;
    let talkGoal = talking ? this.talkWant : 0;
    if (!talking && name === "parle" && now - this.talkAt > 600) talkGoal = calm ? 0.3 : Math.max(0, Math.sin(t * 13) * 0.6 + Math.sin(t * 7.3) * 0.35);
    this.talkLevel += (talkGoal - this.talkLevel) * (calm ? 1 : 1 - Math.exp(-dt * 30));
    if (this.talkLevel > 0.02) {
      want.face.mouthO = Math.max(want.face.mouthO, this.talkLevel * 0.8);
      want.face.mouthW += (0.75 - want.face.mouthW) * this.talkLevel * 0.6;
      want.face.mouthA = Math.max(want.face.mouthA, 1);
    }
    // « ? » : les sourcils montent, un plus haut que l'autre ; « ! » : tous les deux, et les yeux s'ouvrent.
    const markAge = (now - this.markAt) / 1000;
    if (this.mark && markAge < 0.8) {
      const e = Math.sin(Math.min(1, markAge / 0.8) * Math.PI);
      want.face.browA = Math.max(want.face.browA, e);
      want.face.browRaise += (this.mark === "!" ? 1 : 0.7) * e;
      if (this.mark === "?") want.face.browAsym += 0.7 * e;
      else want.face.eyeSize *= 1 + 0.15 * e;
    }
    // La souris qui file près d'elle : elle s'y intéresse (yeux un peu plus grands, pupilles ouvertes).
    this.perk *= Math.exp(-dt * 1.5);
    if (!calm && this.perk > 0.01) {
      want.face.eyeSize *= 1 + 0.06 * this.perk;
      want.face.pupil += 0.12 * this.perk;
    }
    if (this.flinch > 0) {
      // Un clic : elle ferme fort les yeux une fraction de seconde.
      this.flinch -= dt;
      Object.assign(want.face, { eyeOpen: 0, eyeCurve: 1, mouthW: 0.6, mouthO: 0.35, mouthC: 0.2 });
    }
    for (const key of FACE_KEYS) {
      if (key === "browRaise") continue;
      const kk = calm ? 1 : 1 - Math.exp(-dt * (FACE_RATE[key] ?? 13));
      this.face[key] += (want.face[key] - this.face[key]) * kk;
    }
    // Les sourcils levés : un ressort, ils dépassent un peu et retombent après l'expression.
    if (calm) {
      this.face.browRaise = want.face.browRaise;
      this.browV = 0;
    } else {
      this.browV += (150 * (want.face.browRaise - this.face.browRaise) - 15 * this.browV) * dt;
      this.face.browRaise += this.browV * dt;
    }
    const kf = calm ? 1 : 1 - Math.exp(-dt * 13);
    if (want.kind !== this.eyes) {
      this.eyesPrev = this.eyes;
      this.eyes = want.kind;
      this.eyesMix = 0;
    }
    this.eyesMix = calm ? 1 : Math.min(1, this.eyesMix + dt / 0.24);
    this.tip += ((f.tip ?? 0) - this.tip) * kf;

    // Ce qu'elle sort le temps du geste (lunettes, écharpe, pile, jambes) : en fondu.
    const kp = calm ? 1 : 1 - Math.exp(-dt * 8);
    for (const key of PROP_KEYS) this.props[key] += ((f.prop?.[key] ?? 0) - this.props[key]) * kp;

    // 3. Clignement : toutes les 2,2 à 5,4 s ; la paupière se ferme en 70 ms
    // (en accélérant) et se rouvre en 130 ms (en ralentissant), une fois sur
    // cinq environ deux fois de suite. Pas avec « Réduire les animations ».
    let blink = 1;
    const canBlink = !calm && f.blink !== false && this.eyes === "normal" && want.face.eyeOpen > 0.45 && this.flinch <= 0;
    if (now > this.nextBlink && this.blinkStart < 0) {
      this.blinkStart = now;
      this.doubleBlink = Math.random() < BLINK.double;
    }
    if (this.blinkStart >= 0) {
      const b = blinkCurve(now - this.blinkStart);
      if (b === null) {
        if (this.doubleBlink) {
          this.blinkStart = now;
          this.doubleBlink = false;
        } else {
          this.blinkStart = -1;
          this.nextBlink = now + BLINK.minGapMs + Math.random() * (BLINK.maxGapMs - BLINK.minGapMs);
        }
      } else if (canBlink) blink = b;
    }

    // 4. Le regard : les pupilles partent vite vers leur cible, la tête suit
    // plus lentement (le visage glisse sur le volume) ; sans souris, de petits
    // coups d'œil au hasard. Pendant l'anticipation d'un geste, le regard part
    // déjà vers où le geste regardera.
    let target = f.gaze ?? this.lookTarget;
    if (!target) {
      if (this.clock > this.saccade.next) {
        this.saccade = { x: (Math.random() * 2 - 1) * 0.45, y: (Math.random() * 2 - 1) * 0.25, next: this.clock + 1.4 + Math.random() * 2.4 };
      }
      target = calm ? { x: 0, y: 0 } : this.saccade;
    }
    const anticipating = !calm && now < this.anticUntil;
    const kl = calm ? 1 : 1 - Math.exp(-dt * (anticipating ? 22 : 14));
    this.look.x += (target.x - this.look.x) * kl;
    this.look.y += (target.y - this.look.y) * kl;
    const kh = calm ? 1 : 1 - Math.exp(-dt * 5);
    this.head.x += (this.look.x - this.head.x) * kh;
    this.head.y += (this.look.y - this.head.y) * kh;

    // La lumière glisse doucement vers sa place ; la teinte de l'environnement aussi.
    const lt = this.lightTarget(now);
    const kL = calm ? 1 : 1 - Math.exp(-dt * 3);
    this.light.x += (lt.x - this.light.x) * kL;
    this.light.y += (lt.y - this.light.y) * kL;
    const env = this.env.envTint?.() ?? null;
    if (env) this.envTint = env;
    this.envK += ((env ? 1 : 0) - this.envK) * (calm ? 1 : 1 - Math.exp(-dt * 2));

    // 5. Le corps : sauts (plus ou moins hauts selon la forme), élan, atterrissage.
    const dy = (f.dy ?? 0) * S.hop;
    const vy = (dy - this.prevDy) / Math.max(dt, 1e-3);
    let extraSq = 0;
    if (!calm) {
      // Elle s'allonge dans les airs, selon sa vitesse.
      extraSq += Math.min(0.14, Math.abs(vy) * 0.035);
      // Elle se tasse juste avant de sauter : on regarde un peu dans le futur de l'animation.
      if (dy > -0.01) {
        const ahead = fn(t + 0.1, anim && !anim.loop ? Math.min(1, p + 100 / dur) : (p + 100 / dur) % 1, this.mood).dy ?? 0;
        if (ahead * S.hop < -0.06) extraSq -= 0.1;
      }
      // L'anticipation d'un geste : elle se tasse un instant.
      if (anticipating) extraSq -= 0.07 * Math.sin((1 - (this.anticUntil - now) / ANTICIPATION_MS) * Math.PI);
      // Elle s'écrase en retombant : des images clés (écrasée, étirée, un peu écrasée, posée).
      if (this.prevDy < -0.01 && dy >= -0.01 && this.prevVy > 0.4) {
        this.landT = 0;
        this.landAmp = Math.min(1.2, this.prevVy / 2.5);
        this.jelly.sqV -= Math.min(2, this.prevVy * 0.6);
        this.jolt = 1;
        const pts = this.shape.pts;
        for (let i = 0; i < N; i++) this.rim.vel[i] += 0.5 * Math.max(0, pts[i].y);
      }
      if (this.landT >= 0) {
        this.landT += dt;
        const v = landingSquash(this.landT);
        if (this.landT > LANDING[LANDING.length - 1][0]) this.landT = -1;
        extraSq += v * this.landAmp;
      }
      // Le visage traîne derrière le corps.
      const lag = this.faceLag;
      lag.v += (180 * (Math.max(-0.08, Math.min(0.08, vy * 0.018)) - lag.y) - 13 * lag.v) * dt;
      lag.y += lag.v * dt;
    } else {
      this.faceLag.y = 0;
      this.landT = -1;
    }
    this.prevVy = vy;
    this.prevDy = dy;

    // La traînée de gomme : quand elle se déplace sur le côté, le haut reste en arrière.
    const dxNow = f.dx ?? 0;
    if (!calm) {
      const vx = (dxNow - this.prevDx) / Math.max(dt, 1e-3);
      const goal = Math.max(-0.22, Math.min(0.22, -vx * 0.07));
      this.shearV += (120 * (goal - this.shear) - 11 * this.shearV) * dt;
      this.shear += this.shearV * dt;
    } else this.shear = this.shearV = 0;
    this.prevDx = dxNow;
    // Les bulles se calment après un choc.
    this.jolt = calm ? 0 : Math.max(this.jolt * Math.exp(-dt * 2.5), Math.min(1, Math.abs(this.jelly.sqV) * 0.12));

    // Le ressort de la gelée : étirement et inclinaison.
    const wantSq = (f.squash ?? 1) + extraSq + this.hold + (calm ? 0 : 0.02 * this.perk);
    const wantRot = f.rot ?? 0;
    const j = this.jelly;
    if (calm) {
      j.sq = wantSq;
      j.rot = wantRot;
      j.sqV = j.rotV = 0;
    } else {
      j.sqV += (STIFF * (wantSq - j.sq) - DAMP * j.sqV) * dt;
      j.sq += j.sqV * dt;
      j.rotV += (STIFF * (wantRot - j.rot) - DAMP * j.rotV) * dt;
      j.rot += j.rotV * dt;
      // garde-fou : jamais d'étirement absurde
      j.sq = Math.min(1.4, Math.max(0.7, j.sq));
    }

    // 6. Le contour en gelée : les joues gonflent, la flamme vacille, le fantôme ondule.
    const base = this.currentPts();
    const nrm = normals(base);
    if (!calm) {
      const puff = this.face.puff;
      const pw = puff > 0.01 ? puffWeights(base, S) : null;
      const time = this.clock;
      const shapeId = this.shape.id;
      this.rim.step(dt, (i) => {
        let tg = Math.sin((i / N) * TAU * 3 + time * 1.3) * 0.006;
        if (pw) tg += puff * 0.11 * pw[i];
        if (shapeId === "flamme") tg += Math.sin(time * 9 + i * 0.5) * 0.02 * Math.max(0, -base[i].y);
        if (shapeId === "fantome") tg += Math.sin(time * 4 + base[i].x * 6) * 0.03 * Math.max(0, base[i].y - 0.6) * 3;
        return tg;
      });
    } else this.rim.reset();
    const d = this.rim.disp;
    const tipBend = this.tip * (0.12 + Math.sin(this.clock * 2.2) * 0.05) * (this.mirror ? -1 : 1);
    const pts = base.map((q, i) => {
      // La pointe (le haut) se plie sur le côté.
      const tw = Math.max(0, (base[0].y + 0.45 - q.y) / 0.45) ** 2;
      return { x: q.x + nrm[i].x * d[i] + tipBend * tw, y: q.y + nrm[i].y * d[i] + Math.abs(tipBend) * tw * 0.15 };
    });

    // 7. La couleur : fondu vers la teinte voulue (l'arc-en-ciel tourne tout seul).
    const tint = f.tint ?? this.baseTint();
    const custom = this.prefs.customColor ?? DEFAULT_CUSTOM;
    let goal = palette(tint, this.clock, custom);
    if (f.tintTo && (f.tintK ?? 0) > 0) {
      const to = palette(f.tintTo, this.clock, custom);
      const kt = Math.min(1, f.tintK ?? 0);
      goal = goal.map((c, i) => c.map((v, ch) => v + (to[i][ch] - v) * kt)) as Palette;
    }
    const kc = calm || tint === "rainbow" ? 1 : 1 - Math.exp(-dt * 9);
    this.colors = this.colors.map((c, i) => c.map((v, ch) => v + (goal[i][ch] - v) * kc)) as Palette;

    // 8. Les mains : chacune suit sa pose avec son ressort. La pancarte « ? »
    // d'une question ouverte passe devant la pose de toute animation en boucle
    // (repos, danse, travail…) et des poses tranquilles ; un geste ponctuel
    // (coucou, bravo) la pose le temps du geste. Les moufles sur les oreilles
    // pendant la concentration ne remplacent que le repos.
    let pose: HandPose = f.hands ?? HAND_FOR[name] ?? "rest";
    const quietPose = pose === "rest" || pose === "think" || pose === "clasp";
    if (this.extras.sign && (quietPose || (anim?.loop ?? true))) pose = "sign";
    else if (this.extras.ears && pose === "rest") pose = "ears";
    const mode = this.prefs.hands;
    // La pancarte et la pile vide se montrent même sans mains : c'est une information, pas un geste.
    const showHands = mode === "always" || pose === "sign" || pose === "panic" || (mode === "gestures" && pose !== "rest");
    this.umbrella += ((this.extras.umbrella ? 1 : 0) - this.umbrella) * (calm ? 1 : 1 - Math.exp(-dt * 6));
    this.handsAlpha += ((showHands ? 1 : 0) - this.handsAlpha) * (calm ? 1 : 1 - Math.exp(-dt * 10));
    let goals = HANDS[pose](t, p, S);
    // Le geste de l'autre côté : les mains changent de côté.
    if (this.mirror) goals = [goals[1], goals[0]].map((g) => ({ ...g, x: -(g.x ?? 0), r: -(g.r ?? 0) })) as typeof goals;
    for (let i = 0; i < 2; i++) {
      const H = this.hands[i];
      const g = { x: 0, y: 0, r: 0, s: 1, thumb: 0, ...goals[i] };
      if (calm) {
        Object.assign(H, g);
      } else {
        H.vx += (190 * (g.x - H.x) - 15 * H.vx) * dt;
        H.x += H.vx * dt;
        H.vy += (190 * (g.y - H.y) - 15 * H.vy) * dt;
        H.y += H.vy * dt;
        H.vr += (160 * (g.r - H.r) - 14 * H.vr) * dt;
        H.r += H.vr * dt;
        H.s += (g.s - H.s) * kf;
        H.thumb += (g.thumb - H.thumb) * kf;
      }
    }
    // De l'autre côté, la moufle qui tient la pile ou qui toque est passée en second (gum-draw.ts dessine l'objet à la seconde).
    const swapHands = this.mirror && (pose === "panic" || pose === "tap");

    drawGum(this.ctx, this.canvas.width, this.canvas.height, {
      shape: S,
      pts,
      fromShape: this.fromShape ?? undefined,
      morph: this.morph,
      colors: this.colors,
      face: this.face,
      eyes: this.eyes,
      eyesPrev: this.eyesPrev,
      eyesMix: this.eyesMix,
      blink,
      look: this.look,
      head: this.head,
      light: this.light,
      shear: this.shear,
      props: this.props,
      jolt: this.jolt,
      envTint: this.envTint,
      envK: this.envK,
      faceLag: this.faceLag.y,
      squash: j.sq,
      rot: j.rot,
      dx: dxNow,
      dy,
      tip: this.tip,
      hands: this.handsAlpha > 0.02 ? (swapHands ? [this.hands[1], this.hands[0]] : this.hands) : null,
      handsAlpha: this.handsAlpha,
      handItem: pose === "heart" ? "heart" : pose === "sign" ? "sign" : pose === "panic" ? "battery" : null,
      leftFront: pose === "crossed",
      wear: this.prefs.wear,
      umbrella: this.umbrella,
      extra: f.extra ?? "none",
      weather: this.dynamic === "meteo" ? this.weatherFx : "none",
      t: this.clock,
    });
  }
}
