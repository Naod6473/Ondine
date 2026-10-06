// La goutte « gomme » : une goutte ronde et brillante, comme un bonbon gélifié.
// Tout est dessiné en Canvas 2D, à partir d'une simple description (GumPose) :
// forme et couleur du corps, yeux, sourcils, bouche, joues, effet autour.
//
// L'effet gomme vient de plusieurs couches posées l'une sur l'autre :
//   1. une ombre douce sous la goutte ;
//   2. le corps, avec un dégradé clair en haut à gauche, plus foncé en bas ;
//   3. une lueur intérieure en bas (la lumière qui traverse la gomme) ;
//   4. un liseré clair à l'intérieur du bord (l'épaisseur translucide) ;
//   5. un grand reflet blanc en haut à gauche et un petit point brillant.

import { drawHeart, drawOverlay, type Overlay } from "./overlays";

const TAU = Math.PI * 2;

export type GumTint = "blue" | "red" | "yellow" | "green" | "violet" | "pink";
export type GumEyes = "open" | "wide" | "happy" | "closed" | "half" | "spiral" | "heart" | "x";
export type GumMouth = "none" | "smile" | "flat" | "o" | "open" | "frown" | "wavy";
export type GumBrows = "none" | "angry" | "worried" | "raised";

export interface GumPose {
  tint?: GumTint;
  /** Écrasement vertical (1 = normal, > 1 = étirée, < 1 = écrasée). */
  squash?: number;
  /** Penche la goutte (radians). */
  rot?: number;
  /** Décalages du corps, en fraction du rayon. */
  dx?: number;
  dy?: number;
  eyes?: GumEyes;
  /** Ouverture des yeux (0 à 1), pour cligner. */
  eyeOpen?: number;
  brows?: GumBrows;
  mouth?: GumMouth;
  mouthOpen?: number;
  /** Joues roses (0 à 1). */
  blush?: number;
  extra?: Overlay;
  /** Où regardent les yeux (-1 à 1). */
  look?: { x: number; y: number };
  /** Temps en secondes (spirales, effets). */
  t?: number;
}

/** Les teintes : clair (reflet), milieu, profond (bas du corps), contour. */
const TINTS: Record<GumTint, [string, string, string, string]> = {
  blue: ["#c9f0ff", "#5cc8ff", "#1f86e0", "#145a9e"],
  red: ["#ffd2d6", "#ff6b78", "#e02842", "#9c1530"],
  yellow: ["#fff3c4", "#ffd24a", "#f59e0b", "#a8640a"],
  green: ["#d4ffe2", "#5fe08f", "#1fae5c", "#13703b"],
  violet: ["#ecdcff", "#b98cff", "#7b4dea", "#4f2aa3"],
  pink: ["#ffe0ee", "#ff9cc6", "#f0609e", "#a3305f"],
};

/** Le contour de la goutte (ronde, avec une petite pointe molle en haut). */
function bodyPath(ctx: CanvasRenderingContext2D, R: number) {
  ctx.beginPath();
  ctx.moveTo(R * 0.05, -R * 0.98);
  ctx.bezierCurveTo(R * 0.6, -R * 0.82, R * 1.1, -R * 0.34, R * 1.1, R * 0.2);
  ctx.bezierCurveTo(R * 1.1, R * 0.76, R * 0.64, R * 0.94, 0, R * 0.94);
  ctx.bezierCurveTo(-R * 0.64, R * 0.94, -R * 1.1, R * 0.76, -R * 1.1, R * 0.2);
  ctx.bezierCurveTo(-R * 1.1, -R * 0.34, -R * 0.56, -R * 0.8, -R * 0.05, -R * 0.98);
  // le bout arrondi de la pointe
  ctx.quadraticCurveTo(0, -R * 1.03, R * 0.05, -R * 0.98);
  ctx.closePath();
}

/** Dessine la goutte gomme centrée dans un canvas de w × h pixels. */
export function drawGum(ctx: CanvasRenderingContext2D, w: number, h: number, pose: GumPose) {
  const tint = TINTS[pose.tint ?? "blue"];
  const [light, mid, deep, rim] = tint;
  const S = Math.min(w, h);
  const R = S * 0.33;
  const squash = pose.squash ?? 1;
  const sx = 1 / Math.sqrt(squash);
  const sy = squash;
  const t = pose.t ?? 0;
  const look = pose.look ?? { x: 0, y: 0 };
  // Les pieds restent posés : on étire à partir du bas de la goutte.
  const footY = h / 2 + R * 0.98;
  const cx = w / 2 + (pose.dx ?? 0) * R;
  const cy = footY - R * 0.94 * sy + (pose.dy ?? 0) * R;

  ctx.clearRect(0, 0, w, h);

  // 1. Ombre au sol (elle rétrécit quand la goutte saute).
  const lift = Math.max(0, -(pose.dy ?? 0));
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.28 * (1 - Math.min(0.7, lift))})`;
  ctx.filter = `blur(${R * 0.06}px)`;
  ctx.beginPath();
  ctx.ellipse(w / 2 + (pose.dx ?? 0) * R, footY + R * 0.04, R * 0.78 * sx * (1 - lift * 0.4), R * 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pose.rot ?? 0);
  ctx.scale(sx, sy);

  // 2. Le corps.
  bodyPath(ctx, R);
  const body = ctx.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, -R * 0.1, -R * 0.1, R * 1.45);
  body.addColorStop(0, light);
  body.addColorStop(0.45, mid);
  body.addColorStop(1, deep);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  bodyPath(ctx, R);
  ctx.clip();
  // 3. Lueur intérieure en bas : la lumière traverse la gomme.
  const glow = ctx.createRadialGradient(R * 0.1, R * 0.75, 0, R * 0.1, R * 0.75, R * 0.85);
  glow.addColorStop(0, hexA(light, 0.75));
  glow.addColorStop(1, hexA(light, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  // 4. Liseré clair à l'intérieur du bord.
  bodyPath(ctx, R);
  ctx.lineWidth = R * 0.16;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.stroke();
  bodyPath(ctx, R);
  ctx.lineWidth = R * 0.05;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.stroke();
  ctx.restore();

  // Contour fin, de la couleur foncée du bonbon (pas noir : plus doux).
  bodyPath(ctx, R);
  ctx.lineWidth = R * 0.045;
  ctx.strokeStyle = rim;
  ctx.stroke();

  // 5. Les reflets.
  ctx.save();
  ctx.translate(-R * 0.48, -R * 0.36);
  ctx.rotate(-0.75);
  const shine = ctx.createLinearGradient(0, -R * 0.12, 0, R * 0.12);
  shine.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  shine.addColorStop(1, "rgba(255, 255, 255, 0.35)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.3, R * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(-R * 0.12, -R * 0.66, R * 0.06, 0, TAU);
  ctx.fill();
  // reflet du bas, à droite (la lumière renvoyée par le sol)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineCap = "round";
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.arc(0, R * 0.12, R * 0.78, 0.18 * Math.PI, 0.36 * Math.PI);
  ctx.stroke();

  // Le visage, un peu décalé vers là où elle regarde (effet de volume).
  const fx = look.x * R * 0.12;
  const fy = look.y * R * 0.08;
  drawFace(ctx, pose, R, fx, fy, t, rim);
  ctx.restore();

  drawOverlay(ctx, pose.extra ?? "none", w / 2, cy, R, t);
}

const INK = "#1a1630";

function drawFace(ctx: CanvasRenderingContext2D, pose: GumPose, R: number, fx: number, fy: number, t: number, rim: string) {
  const eyeY = R * 0.12 + fy;
  const eyeDX = R * 0.38;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Joues.
  const blush = pose.blush ?? 0.55;
  if (blush > 0) {
    for (const side of [-1, 1]) {
      const bx = side * R * 0.62 + fx;
      const by = eyeY + R * 0.26;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.2);
      g.addColorStop(0, `rgba(255, 120, 170, ${0.55 * blush})`);
      g.addColorStop(1, "rgba(255, 120, 170, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(bx, by, R * 0.2, R * 0.12, 0, 0, TAU);
      ctx.fill();
    }
  }

  for (const side of [-1, 1]) drawEye(ctx, pose, side * eyeDX + fx, eyeY, R, side, t);

  // Sourcils.
  const brows = pose.brows ?? "none";
  if (brows !== "none") {
    ctx.strokeStyle = INK;
    ctx.lineWidth = R * 0.065;
    for (const side of [-1, 1]) {
      const ex = side * eyeDX + fx;
      const by = eyeY - R * 0.33;
      ctx.beginPath();
      if (brows === "raised") {
        ctx.arc(ex, by + R * 0.08, R * 0.14, 1.2 * Math.PI, 1.8 * Math.PI);
      } else {
        const tilt = brows === "angry" ? -0.09 : 0.08;
        ctx.moveTo(ex + side * R * 0.15, by - tilt * R);
        ctx.lineTo(ex - side * R * 0.13, by + tilt * R);
      }
      ctx.stroke();
    }
  }

  drawMouth(ctx, pose, fx, eyeY + R * 0.3, R, rim);
}

function drawEye(ctx: CanvasRenderingContext2D, pose: GumPose, x: number, y: number, R: number, side: number, t: number) {
  const kind = pose.eyes ?? "open";
  const open = pose.eyeOpen ?? 1;
  const ew = R * 0.15;
  const eh = R * 0.19;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = R * 0.07;
  ctx.beginPath();
  switch (kind) {
    case "open":
    case "wide": {
      const k = kind === "wide" ? 1.3 : 1;
      const lx = (pose.look?.x ?? 0) * ew * 0.25;
      const ly = (pose.look?.y ?? 0) * eh * 0.2;
      const hh = Math.max(R * 0.03, eh * k * open);
      ctx.ellipse(x, y, ew * k, hh, 0, 0, TAU);
      ctx.fill();
      if (open > 0.5) {
        // deux reflets, comme une bille de verre
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x - ew * 0.32 + lx, y - hh * 0.38 + ly, ew * 0.38 * k, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + ew * 0.38 + lx, y + hh * 0.42 + ly, ew * 0.16 * k, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case "half":
      ctx.ellipse(x, y + eh * 0.25, ew, eh * 0.6, 0, 0, Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - ew * 1.25, y + eh * 0.25);
      ctx.lineTo(x + ew * 1.25, y + eh * 0.25);
      ctx.stroke();
      break;
    case "closed":
      ctx.arc(x, y - eh * 0.2, ew * 1.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    case "happy":
      ctx.arc(x, y + eh * 0.45, ew * 1.25, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      break;
    case "x":
      ctx.moveTo(x - ew, y - ew);
      ctx.lineTo(x + ew, y + ew);
      ctx.moveTo(x - ew, y + ew);
      ctx.lineTo(x + ew, y - ew);
      ctx.stroke();
      break;
    case "spiral": {
      ctx.lineWidth = R * 0.045;
      for (let i = 0; i <= 36; i++) {
        const a = (i / 36) * 2.3 * TAU + t * 8 * side;
        const r = (i / 36) * ew * 1.5;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.stroke();
      break;
    }
    case "heart":
      drawHeart(ctx, x, y, ew * 2.4, "#ff3d7f");
      break;
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, pose: GumPose, x: number, y: number, R: number, rim: string) {
  const kind = pose.mouth ?? "smile";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = R * 0.055;
  ctx.beginPath();
  switch (kind) {
    case "smile":
      ctx.arc(x, y - R * 0.07, R * 0.12, 0.22 * Math.PI, 0.78 * Math.PI);
      ctx.stroke();
      break;
    case "frown":
      ctx.arc(x, y + R * 0.1, R * 0.11, 1.22 * Math.PI, 1.78 * Math.PI);
      ctx.stroke();
      break;
    case "flat":
      ctx.moveTo(x - R * 0.09, y);
      ctx.lineTo(x + R * 0.09, y);
      ctx.stroke();
      break;
    case "wavy":
      for (let i = 0; i <= 16; i++) {
        const px = x - R * 0.13 + (i / 16) * R * 0.26;
        const py = y + Math.sin((i / 16) * 2 * TAU) * R * 0.025;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    case "o": {
      const o = 0.6 + (pose.mouthOpen ?? 0.5) * 0.8;
      ctx.ellipse(x, y + R * 0.02, R * 0.06 * o, R * 0.075 * o, 0, 0, TAU);
      ctx.fill();
      break;
    }
    case "open": {
      // une bouche en D, avec une langue rose
      const m = Math.max(0.15, pose.mouthOpen ?? 0.7);
      ctx.moveTo(x - R * 0.15, y - R * 0.04);
      ctx.lineTo(x + R * 0.15, y - R * 0.04);
      ctx.quadraticCurveTo(x + R * 0.15, y + R * 0.2 * m, x, y + R * 0.2 * m);
      ctx.quadraticCurveTo(x - R * 0.15, y + R * 0.2 * m, x - R * 0.15, y - R * 0.04);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#ff7a9c";
      ctx.beginPath();
      ctx.ellipse(x, y + R * 0.2 * m, R * 0.1, R * 0.08, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "none":
      break;
  }
  void rim;
}

/** "#rrggbb" + opacité → "rgba(…)". */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
