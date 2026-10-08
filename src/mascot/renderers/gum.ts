// Le moteur de la famille « gomme » (mascots/goutte-gomme, et toutes les formes
// de gum-family.ts : Guimauve, Dragée, étoile, soleil, lune…). Tout est dessiné
// en code (gum-draw.ts), et le corps bouge comme une gelée.
//
// Principe : chaque animation est une fonction qui, pour un instant donné,
// décrit l'image voulue (ANIMS ci-dessous : yeux, bouche, couleur, étirement,
// mains…). Rien n'y saute d'un coup : tout ce que l'animation demande est une
// CIBLE, et la mascotte y va en douceur.
//   - Le visage : chaque réglage (ouverture des yeux, courbe de la bouche…)
//     glisse vers sa cible ; les yeux spéciaux (cœurs, spirales) apparaissent
//     en fondu.
//   - Le corps : un RESSORT pour l'étirement et l'inclinaison (il dépasse,
//     revient, se calme) ; avant un saut elle se tasse (on regarde un peu dans
//     le futur de l'animation pour le savoir), elle s'allonge en l'air selon sa
//     vitesse et s'écrase en retombant.
//   - Le contour : une chaîne de points reliés par des ressorts (une vraie
//     gelée). Un clic y lance une onde, les joues gonflent quand elle boude.
//   - Le visage traîne un peu derrière le corps, les mains suivent leur pose
//     avec leur propre ressort, la couleur passe en fondu.
// Avec « Réduire les animations » de Windows, tout va directement à sa cible.

import { frameLoop } from "../../core/perf";
import { settingsStore } from "../../core/settings-store";
import { NO_EXTRAS, type MascotExtras, type MascotRenderer, type MascotReaction } from "../renderer";
import type { AnimationSpec, MascotManifest, MascotState, Mood } from "../types";
import { reducedMotion } from "../../island/tab-pill";
import { ANIMS, faceOf, HAND_FOR, HANDS, JellyRim, skyShape, weatherLook, type DynamicShape, type HandPose } from "./gum-anims";
import {
  DEFAULT_CUSTOM,
  drawGum,
  FACE_BASE,
  isHexColor,
  FACE_KEYS,
  gumRadius,
  palette,
  TINT_NAMES,
  type EyeKind,
  type EyeWear,
  type Face,
  type GumTint,
  type Hand,
  type HeadWear,
  type NeckWear,
  type Palette,
  type WeatherFx,
} from "./gum-draw";
import { isShape, mixPts, N, normals, puffWeights, SHAPES, type GumShape, type Pt, type ShapeId } from "./gum-shapes";

const TAU = Math.PI * 2;

/** Les réglages de la mascotte qui touchent au dessin (couleur, mains, accessoires). */
function prefs() {
  const m = settingsStore.current.mascot as Partial<{ color: string; customColor: string; hands: string; wearHead: string; wearEyes: string; wearNeck: string }>;
  return {
    color: (m.color ?? "auto") as GumTint | "auto",
    customColor: isHexColor(m.customColor) ? m.customColor : DEFAULT_CUSTOM,
    hands: (m.hands ?? "always") as "always" | "gestures" | "never",
    wear: { head: (m.wearHead ?? "none") as HeadWear, eyes: (m.wearEyes ?? "none") as EyeWear, neck: (m.wearNeck ?? "none") as NeckWear },
  };
}

/** Raideur et amortissement du ressort de l'étirement (par seconde). */
const STIFF = 170;
const DAMP = 9;

export class GumRenderer implements MascotRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private observer: ResizeObserver | null = null;
  private stopFrames: () => void = () => {};
  private stopPrefs: () => void = () => {};
  private anim: AnimationSpec | null = null;
  private animStart = 0;
  private ended = false;
  private mood: Mood = "neutral";
  private endCallbacks: ((name: string) => void)[] = [];
  private lookTarget: { x: number; y: number } | null = null;
  private look = { x: 0, y: 0 };
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

  /** La forme : fixe, ou « ciel » / « météo » qui changent toutes seules. */
  private readonly dynamic: DynamicShape | null;
  private shape: GumShape;
  private fromShape: GumShape | null = null;
  private fromPts: Pt[] | null = null;
  private morph = 1;
  private weatherIcon: string | null = null;
  private weatherFx: WeatherFx = "none";
  private nextShapeCheck = 0;
  private prefs = prefs();
  /** Ce qu'elle porte en plus (mascot-state.ts) : oreilles bouchées, pancarte, parapluie. */
  private extras: MascotExtras = NO_EXTRAS;
  /** Le parapluie apparaît et disparaît en fondu. */
  private umbrella = 0;

  constructor(manifest?: MascotManifest) {
    const wanted = manifest?.gum?.shape ?? "goutte";
    this.dynamic = wanted === "ciel" || wanted === "meteo" ? wanted : null;
    this.shape = SHAPES[isShape(wanted) ? wanted : this.dynamic ? this.dynamicShape().shape : "goutte"];
    this.colors = palette(this.baseTint(), 0, this.prefs.customColor);
    const rest = HANDS.rest(0, 0, this.shape);
    this.hands = rest.map((h) => ({ x: 0, y: 0, r: 0, s: 1, thumb: 0, vx: 0, vy: 0, vr: 0, ...h })) as typeof this.hands;
  }

  mount(container: HTMLElement) {
    this.canvas.className = "mascot-canvas";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.stopPrefs = settingsStore.onChange(() => (this.prefs = prefs()));
    // Arrêtée quand la place de la mascotte n'a pas de taille (île cachée),
    // 30 images/s au plus en économie d'énergie (src/core/perf.ts).
    this.stopFrames = frameLoop(this.canvas, (now) => this.frame(now));
  }

  play(animation: AnimationSpec) {
    this.anim = animation;
    this.animStart = performance.now();
    this.ended = false;
    // Une pichenette : la gelée tremble un peu à chaque changement.
    this.jelly.sqV += 1.6;
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
    if (reducedMotion()) return;
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
        break;
      }
      case "stretch":
        this.hold = Math.min(0.22, (data.amount ?? 0) / 180);
        break;
      case "release":
        this.hold = 0;
        this.jelly.sqV += Math.min(4, (data.amount ?? 20) * 0.06);
        break;
      case "shake":
        this.jelly.rotV += (Math.random() < 0.5 ? -1 : 1) * 4;
        for (let k = 0; k < 3; k++) this.rim.poke(Math.floor(Math.random() * N), 1.2);
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
    this.canvas.remove();
    this.endCallbacks = [];
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
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
      shine: a.shine.map((v, i) => mix(v, b.shine[i])) as GumShape["shine"],
      dot: [mix(a.dot[0], b.dot[0]), mix(a.dot[1], b.dot[1])],
    };
  }

  private frame(now: number) {
    // Pas de temps (limité : un onglet en veille ne doit pas faire exploser les ressorts).
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    const calm = reducedMotion();
    const anim = this.anim;
    const elapsed = anim ? now - this.animStart : now;
    const dur = anim?.durationMs ?? 4000;
    const t = elapsed / 1000;
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
    const f = fn(t, p, this.mood);

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
    const S = this.blendedShape();

    // 1. Le visage voulu, et le visage réel qui glisse vers lui.
    const want = faceOf(f);
    if (this.flinch > 0) {
      // Un clic : elle ferme fort les yeux une fraction de seconde.
      this.flinch -= dt;
      Object.assign(want.face, { eyeOpen: 0, eyeCurve: 1, mouthW: 0.6, mouthO: 0.35, mouthC: 0.2 });
    }
    const kf = calm ? 1 : 1 - Math.exp(-dt * 13);
    for (const k of FACE_KEYS) this.face[k] += (want.face[k] - this.face[k]) * kf;
    if (want.kind !== this.eyes) {
      this.eyesPrev = this.eyes;
      this.eyes = want.kind;
      this.eyesMix = 0;
    }
    this.eyesMix = calm ? 1 : Math.min(1, this.eyesMix + dt / 0.24);
    this.tip += ((f.tip ?? 0) - this.tip) * kf;

    // 2. Clignement : toutes les 2,5 à 5,5 s ; la paupière se ferme vite et se
    // rouvre plus lentement, parfois deux fois de suite.
    let blink = 1;
    const canBlink = f.blink !== false && this.eyes === "normal" && want.face.eyeOpen > 0.45 && this.flinch <= 0;
    if (now > this.nextBlink && this.blinkStart < 0) {
      this.blinkStart = now;
      this.doubleBlink = Math.random() < 0.2;
    }
    if (this.blinkStart >= 0) {
      const b = (now - this.blinkStart) / 200;
      blink = b < 0.35 ? 1 - (b / 0.35) ** 0.8 : ((b - 0.35) / 0.65) ** 1.6;
      if (b >= 1) {
        if (this.doubleBlink) {
          this.blinkStart = now;
          this.doubleBlink = false;
        } else {
          this.blinkStart = -1;
          this.nextBlink = now + 2500 + Math.random() * 3000;
        }
        blink = 1;
      }
      if (!canBlink) blink = 1;
    }

    // 3. Le regard glisse vers sa cible ; sans souris, de petits coups d'œil au hasard.
    let target = f.gaze ?? this.lookTarget;
    if (!target) {
      if (this.clock > this.saccade.next) {
        this.saccade = { x: (Math.random() * 2 - 1) * 0.45, y: (Math.random() * 2 - 1) * 0.25, next: this.clock + 1.4 + Math.random() * 2.4 };
      }
      target = calm ? { x: 0, y: 0 } : this.saccade;
    }
    const kl = calm ? 1 : 1 - Math.exp(-dt * 12);
    this.look.x += (target.x - this.look.x) * kl;
    this.look.y += (target.y - this.look.y) * kl;

    // 4. Le corps : sauts (plus ou moins hauts selon la forme), élan, atterrissage.
    const dy = (f.dy ?? 0) * S.hop;
    const vy = (dy - this.prevDy) / Math.max(dt, 1e-3);
    let extraSq = 0;
    if (!calm) {
      // Elle s'allonge dans les airs, selon sa vitesse.
      extraSq += Math.min(0.14, Math.abs(vy) * 0.035);
      // Elle se tasse juste avant de sauter : on regarde un peu dans le futur de l'animation.
      if (dy > -0.01) {
        const ahead = fn(t + 0.1, anim && !anim.loop ? Math.min(1, p + 100 / dur) : (p + 100 / dur) % 1, this.mood).dy ?? 0;
        if (ahead * S.hop < -0.03) extraSq -= 0.1;
      }
      // Elle s'écrase en retombant.
      if (this.prevDy < -0.01 && dy >= -0.01 && this.prevVy > 0.4) {
        this.jelly.sqV -= Math.min(4, this.prevVy * 1.5);
        const pts = this.shape.pts;
        for (let i = 0; i < N; i++) this.rim.vel[i] += 0.5 * Math.max(0, pts[i].y);
      }
      // Le visage traîne derrière le corps.
      const lag = this.faceLag;
      lag.v += (180 * (Math.max(-0.08, Math.min(0.08, vy * 0.018)) - lag.y) - 13 * lag.v) * dt;
      lag.y += lag.v * dt;
    } else this.faceLag.y = 0;
    this.prevVy = vy;
    this.prevDy = dy;

    // Le ressort de la gelée : étirement et inclinaison.
    const wantSq = (f.squash ?? 1) + extraSq + this.hold;
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

    // 5. Le contour en gelée : les joues gonflent, la flamme vacille, le fantôme ondule.
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
    const tipBend = this.tip * (0.12 + Math.sin(this.clock * 2.2) * 0.05);
    const pts = base.map((q, i) => {
      // La pointe (le haut) se plie sur le côté.
      const tw = Math.max(0, (base[0].y + 0.45 - q.y) / 0.45) ** 2;
      return { x: q.x + nrm[i].x * d[i] + tipBend * tw, y: q.y + nrm[i].y * d[i] + Math.abs(tipBend) * tw * 0.15 };
    });

    // 6. La couleur : fondu vers la teinte voulue (l'arc-en-ciel tourne tout seul).
    const tint = f.tint ?? this.baseTint();
    const custom = this.prefs.customColor;
    let goal = palette(tint, this.clock, custom);
    if (f.tintTo && (f.tintK ?? 0) > 0) {
      const to = palette(f.tintTo, this.clock, custom);
      const k = Math.min(1, f.tintK ?? 0);
      goal = goal.map((c, i) => c.map((v, ch) => v + (to[i][ch] - v) * k)) as Palette;
    }
    const kc = calm || tint === "rainbow" ? 1 : 1 - Math.exp(-dt * 9);
    this.colors = this.colors.map((c, i) => c.map((v, ch) => v + (goal[i][ch] - v) * kc)) as Palette;

    // 7. Les mains : chacune suit sa pose avec son ressort. La pancarte « ? »
    // d'une question ouverte passe devant la pose de toute animation en boucle
    // (repos, danse, travail…) et des poses tranquilles ; un geste ponctuel
    // (coucou, bravo) la pose le temps du geste. Les moufles sur les oreilles
    // pendant la concentration ne remplacent que le repos.
    let pose: HandPose = f.hands ?? HAND_FOR[name] ?? "rest";
    const quietPose = pose === "rest" || pose === "think" || pose === "clasp";
    if (this.extras.sign && (quietPose || (anim?.loop ?? true))) pose = "sign";
    else if (this.extras.ears && pose === "rest") pose = "ears";
    const mode = this.prefs.hands;
    // La pancarte se montre même sans mains : c'est une information, pas un geste.
    const showHands = mode === "always" || pose === "sign" || (mode === "gestures" && pose !== "rest");
    this.umbrella += ((this.extras.umbrella ? 1 : 0) - this.umbrella) * (calm ? 1 : 1 - Math.exp(-dt * 6));
    this.handsAlpha += ((showHands ? 1 : 0) - this.handsAlpha) * (calm ? 1 : 1 - Math.exp(-dt * 10));
    const goals = HANDS[pose](t, p, S);
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
      faceLag: this.faceLag.y,
      squash: j.sq,
      rot: j.rot,
      dx: f.dx ?? 0,
      dy,
      tip: this.tip,
      hands: this.handsAlpha > 0.02 ? this.hands : null,
      handsAlpha: this.handsAlpha,
      handItem: pose === "heart" ? "heart" : pose === "sign" ? "sign" : null,
      leftFront: pose === "crossed",
      wear: this.prefs.wear,
      umbrella: this.umbrella,
      extra: f.extra ?? "none",
      weather: this.dynamic === "meteo" ? this.weatherFx : "none",
      t: this.clock,
    });
  }
}
