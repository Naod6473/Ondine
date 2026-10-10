// Le dessin du corps d'Ondine autour de sa bouche (île-bouche, 1.2.3).
//
// Même matière que la goutte gomme (src/mascot/renderers/gum-draw.ts), avec
// ses couches, dans le même ordre :
//   1. une ombre douce, vers l'intérieur de l'écran ;
//   2. le corps, en dégradé de bonbon (clair en haut à gauche, profond en bas) ;
//   3. la lueur intérieure (la lumière qui traverse la gomme) ;
//   4. le liseré clair à l'intérieur du bord, puis le contour foncé du bonbon ;
//   5. le grand reflet et le petit point brillant, le reflet du bas.
// La bouche est un TROU dans le corps (règle evenodd) : l'île, dessous, se voit
// au travers, avec une ombre intérieure (les lèvres ont de l'épaisseur).
// La langue, les yeux (#2a2840) et leurs reflets viennent par-dessus.
//
// Le corps est construit dans le repère local de la bouche (mouth-geom.ts :
// u le long, v en s'éloignant du bord), puis les couleurs sont posées dans le
// repère de l'écran : la lumière vient toujours d'en haut à gauche, même
// quand Ondine est tournée (bords gauche, droit ou bas).

import { css, type Palette } from "../mascot/renderers/gum-draw";
import { glintOffset, toLocal, type Box, type MouthLayout } from "./mouth-geom";

const TAU = Math.PI * 2;
const EYE = "#2a2840";

export interface MouthLook {
  /** Ouverture de chaque œil (0 à 1). */
  eyes: [number, number];
  /** La souris, en px depuis le milieu des yeux (dans la fenêtre), ou null. */
  look: { x: number; y: number } | null;
  /** Clignement en cours (0 à 1 : 1 = paupières fermées). */
  blink: number;
  /** Montrer les yeux (une bouche vide, Ondine sortie : non). */
  showEyes: boolean;
  /** Remplir la bouche (fenêtre d'Ondine sur le bureau, sans île dessous) : la couleur. */
  fill?: string;
  /** Arrondis de la bouche (px). */
  mouthR: number;
  /** Opacité générale (masquée : elle remonte). */
  alpha: number;
}

/** Un rectangle arrondi (rayons par coin : haut gauche, haut droit, bas droit, bas gauche). */
function roundRect(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: [number, number, number, number]) {
  const w = x1 - x0;
  const h = y1 - y0;
  const lim = (v: number) => Math.max(0, Math.min(v, w / 2, h / 2));
  const [tl, tr, br, bl] = r.map(lim);
  ctx.moveTo(x0 + tl, y0);
  ctx.lineTo(x1 - tr, y0);
  ctx.arcTo(x1, y0, x1, y0 + tr, tr);
  ctx.lineTo(x1, y1 - br);
  ctx.arcTo(x1, y1, x1 - br, y1, br);
  ctx.lineTo(x0 + bl, y1);
  ctx.arcTo(x0, y1, x0, y1 - bl, bl);
  ctx.lineTo(x0, y0 + tl);
  ctx.arcTo(x0, y0, x0 + tl, y0, tl);
  ctx.closePath();
}

/**
 * Le contour du corps dans le repère local : coins arrière petits, coins côté
 * yeux bien ronds, et la pointe de goutte au milieu du bord des yeux.
 */
function bodyPath(ctx: CanvasRenderingContext2D, L: MouthLayout) {
  const { u0, v0, u1, v1 } = L.local;
  const p = L.p;
  const w = u1 - u0;
  const h = v1 - v0;
  const rb = Math.max(0, Math.min(p.rBack, w / 2, h / 2));
  const rf = Math.max(0, Math.min(p.rFront, w / 2, h - rb));
  const mid = (u0 + u1) / 2;
  const tw = Math.min(p.tipW, w * 0.5) / 2;
  ctx.moveTo(u0 + rb, v0);
  ctx.lineTo(u1 - rb, v0);
  ctx.arcTo(u1, v0, u1, v0 + rb, rb);
  ctx.lineTo(u1, v1 - rf);
  // Le coin côté yeux, un peu « goutte » (une courbe plutôt qu'un quart de cercle).
  ctx.bezierCurveTo(u1, v1 - rf * 0.35, u1 - rf * 0.45, v1, u1 - rf, v1);
  // La pointe de goutte, si une forme en a une. Simon (1.2.3) préfère une forme
  // toute ronde, comme la gomme : les trois formes de référence n'en ont plus.
  if (p.tipH > 0.5 && tw > 0.5) {
    ctx.lineTo(mid + tw * 1.6, v1);
    ctx.bezierCurveTo(mid + tw * 0.6, v1, mid + tw * 0.1, v1 + p.tipH * 0.36, mid, v1 + p.tipH);
    ctx.bezierCurveTo(mid - tw * 0.1, v1 + p.tipH * 0.36, mid - tw * 0.6, v1, mid - tw * 1.6, v1);
  }
  ctx.lineTo(u0 + rf, v1);
  ctx.bezierCurveTo(u0 + rf * 0.45, v1, u0, v1 - rf * 0.35, u0, v1 - rf);
  ctx.lineTo(u0, v0 + rb);
  ctx.arcTo(u0, v0, u0 + rb, v0, rb);
  ctx.closePath();
}

/** Construit un chemin dans le repère local, en coordonnées de la fenêtre (la matrice reste dans le chemin). */
function inFrame(ctx: CanvasRenderingContext2D, L: MouthLayout, draw: () => void) {
  ctx.save();
  ctx.transform(...L.frame.matrix);
  draw();
  ctx.restore();
}

/**
 * Dessine le corps d'Ondine autour de la bouche `mouth` (rectangle de la
 * fenêtre). Le canvas doit déjà être à l'échelle des pixels (ctx.scale(dpr)).
 */
export function drawMouthBody(ctx: CanvasRenderingContext2D, L: MouthLayout, mouth: Box, c: Palette, look: MouthLook) {
  if (look.alpha <= 0.01) return;
  const b = L.bounds;
  const thick = Math.max(4, Math.min(L.p.side, L.p.back, L.p.eyeZone));
  ctx.save();
  ctx.globalAlpha = look.alpha;

  const body = () => {
    ctx.beginPath();
    inFrame(ctx, L, () => bodyPath(ctx, L));
  };
  const hole = () => roundRect(ctx, mouth.x, mouth.y, mouth.x + mouth.w, mouth.y + mouth.h, [look.mouthR, look.mouthR, look.mouthR, look.mouthR]);

  // 1. L'ombre douce, vers l'intérieur de l'écran (là où pend la pointe).
  const away = L.frame.map(0, 1);
  const origin = L.frame.map(0, 0);
  ctx.save();
  ctx.shadowColor = css(c[3], 0.45);
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = (away.x - origin.x) * 5;
  ctx.shadowOffsetY = (away.y - origin.y) * 5;
  body();
  hole();
  ctx.fillStyle = css(c[2]);
  ctx.fill("evenodd");
  ctx.restore();

  // 2. Le corps : le bonbon, clair en haut à gauche, profond en bas.
  body();
  hole();
  const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.25, b.y + b.h);
  g.addColorStop(0, css(c[0]));
  g.addColorStop(0.38, css(c[1]));
  g.addColorStop(1, css(c[2]));
  ctx.fillStyle = g;
  ctx.fill("evenodd");

  ctx.save();
  body();
  hole();
  ctx.clip("evenodd");
  // Un second dégradé rond : le volume (le centre d'une gomme est plus clair).
  const R = Math.max(b.w, b.h);
  const vol = ctx.createRadialGradient(b.x + b.w * 0.3, b.y + b.h * 0.25, R * 0.02, b.x + b.w * 0.45, b.y + b.h * 0.5, R * 0.75);
  vol.addColorStop(0, css(c[0], 0.55));
  vol.addColorStop(0.5, css(c[1], 0));
  vol.addColorStop(1, css(c[2], 0.25));
  ctx.fillStyle = vol;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  // 3. La lueur intérieure, du côté des yeux : la lumière traverse la gomme.
  const mid = L.frame.map(L.frame.len / 2, L.local.v1 - L.p.eyeZone * 0.3);
  const glowR = Math.max(24, Math.min(b.w, b.h) * 0.9);
  const glow = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, glowR);
  glow.addColorStop(0, css(c[0], 0.5));
  glow.addColorStop(1, css(c[0], 0));
  ctx.fillStyle = glow;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  // 4. Le liseré clair à l'intérieur du bord (l'épaisseur translucide).
  body();
  ctx.lineWidth = Math.min(6, thick * 0.9);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.stroke();
  ctx.lineWidth = Math.min(2, thick * 0.4);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.stroke();
  // Les lèvres ont de l'épaisseur : une ombre au bord de la bouche, côté corps.
  ctx.beginPath();
  hole();
  ctx.lineWidth = 3;
  ctx.strokeStyle = css(c[3], 0.55);
  ctx.stroke();
  ctx.restore();

  // La bouche remplie (fenêtre d'Ondine sur le bureau : pas d'île dessous).
  if (look.fill) {
    ctx.beginPath();
    hole();
    ctx.fillStyle = look.fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.stroke();
    ctx.restore();
  }

  // Le contour fin, de la couleur foncée du bonbon (pas noir : plus doux).
  body();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = css(c[3]);
  ctx.stroke();
  ctx.beginPath();
  hole();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(c[3], 0.8);
  ctx.stroke();

  // 5. Les reflets : un grand ovale blanc en haut à gauche, un petit point, un trait en bas à droite.
  ctx.save();
  body();
  hole();
  ctx.clip("evenodd");
  const sx = b.x + Math.max(8, b.w * 0.16);
  const sy = b.y + Math.max(5, Math.min(b.h * 0.22, 14));
  const sw = Math.max(6, Math.min(b.w * 0.14, 40));
  const sh = Math.max(2.5, Math.min(thick * 0.35, 6));
  const shine = ctx.createLinearGradient(0, sy - sh, 0, sy + sh);
  shine.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  shine.addColorStop(1, "rgba(255, 255, 255, 0.35)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(sx, sy, sw, sh, -0.12, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(sx + sw + 4, sy + sh * 0.6, Math.max(1.2, sh * 0.45), 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.2, Math.min(2.5, thick * 0.3));
  ctx.beginPath();
  const gy = b.y + b.h - L.p.tipH - Math.max(3, thick * 0.35);
  ctx.moveTo(b.x + b.w * 0.74, gy);
  ctx.quadraticCurveTo(b.x + b.w * 0.86, gy, b.x + b.w - Math.max(5, thick * 0.6), gy - Math.max(3, thick * 0.4));
  ctx.stroke();
  ctx.restore();

  // La langue rose, côté bord (Ondine est à l'envers) : on la voit en mini.
  if (L.p.tongue > 0.02 && look.showEyes) {
    ctx.save();
    ctx.beginPath();
    hole();
    ctx.clip();
    inFrame(ctx, L, () => {
      const u = L.frame.len / 2;
      const tg = ctx.createRadialGradient(u, 2, 1, u, 0, 22);
      tg.addColorStop(0, "#ff8fb0");
      tg.addColorStop(1, "#e0485f");
      ctx.globalAlpha *= Math.min(1, L.p.tongue);
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.ellipse(u, -6 + 6 * Math.min(1, L.p.tongue), 20, 7, 0, 0, TAU);
      ctx.fill();
    });
    ctx.restore();
  }

  // Les yeux, et leurs reflets qui suivent la souris.
  if (look.showEyes) drawEyes(ctx, L, look);
  ctx.restore();
}

function drawEyes(ctx: CanvasRenderingContext2D, L: MouthLayout, look: MouthLook) {
  const p = L.p;
  const lk = look.look ? toLocal(L.dir, look.look.x, look.look.y) : { x: 0, y: 0 };
  // Dans le repère local, v va vers la pointe : pour le reflet, « en haut » de l'œil à l'écran.
  const off = glintOffset(lk.x, lk.y);
  inFrame(ctx, L, () => {
    L.eyes.forEach((e, i) => {
      const open = Math.max(0, Math.min(1, look.eyes[i])) * (1 - Math.max(0, Math.min(1, look.blink)));
      const rx = p.eyeW / 2;
      const ry = p.eyeH / 2;
      if (open < 0.12) {
        // Fermé : un petit trait courbe (elle dort, ou elle cligne).
        ctx.strokeStyle = EYE;
        ctx.lineWidth = Math.max(1.4, ry * 0.45);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(e.u - rx, e.v);
        ctx.quadraticCurveTo(e.u, e.v + ry * 0.7, e.u + rx, e.v);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = EYE;
      ctx.beginPath();
      ctx.ellipse(e.u, e.v, rx, ry * open, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      const gr = Math.min(rx, ry * open) * 0.38;
      ctx.arc(e.u - rx * 0.28 + off.x * rx, e.v - ry * open * 0.3 + off.y * ry * open, gr, 0, TAU);
      ctx.fill();
    });
  });
}
