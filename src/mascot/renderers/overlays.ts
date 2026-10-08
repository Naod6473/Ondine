// Les effets dessinés autour d'une mascotte (Zzz, confettis, cœurs…), partagés
// par tous les moteurs Canvas : la goutte provisoire et les planches de sprites.

import type { Overlay } from "../types";

export type { Overlay };

const TAU = Math.PI * 2;

/** Dessine `overlay` autour d'une mascotte centrée en (cx, cy), de rayon R, au temps t (s). */
export function drawOverlay(ctx: CanvasRenderingContext2D, overlay: Overlay, cx: number, cy: number, R: number, t: number) {
  ctx.save();
  ctx.fillStyle = "#e8ecf4";
  ctx.strokeStyle = "#e8ecf4";
  ctx.lineWidth = Math.max(1, R * 0.06);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  switch (overlay) {
    case "zzz": {
      for (let i = 0; i < 3; i++) {
        const phase = (t * 0.5 + i / 3) % 1;
        ctx.globalAlpha = 1 - phase;
        ctx.font = `bold ${R * (0.3 + phase * 0.25)}px system-ui, sans-serif`;
        ctx.fillText("z", cx + R * (0.9 + phase * 0.5), cy - R * (0.7 + phase * 0.9));
      }
      break;
    }
    case "dots":
      for (let i = 0; i < 3; i++) {
        const on = Math.floor(t * 3) % 4 > i;
        ctx.globalAlpha = on ? 1 : 0.25;
        ctx.beginPath();
        ctx.arc(cx + R * (0.85 + i * 0.25), cy - R * 1.0, R * 0.07, 0, TAU);
        ctx.fill();
      }
      break;
    case "bang":
      ctx.fillStyle = "#ffcf4a";
      ctx.font = `900 ${R * 0.8}px system-ui, sans-serif`;
      ctx.fillText("!", cx + R * 1.15, cy - R * 0.85 + Math.sin(t * 10) * R * 0.05);
      break;
    case "sweat":
      ctx.fillStyle = "#9fd7ff";
      ctx.beginPath();
      ctx.ellipse(cx + R * 0.95, cy - R * 0.5 + ((t * 0.8) % 1) * R * 0.4, R * 0.08, R * 0.12, 0, 0, TAU);
      ctx.fill();
      break;
    case "steam":
      for (const side of [-1, 1]) {
        const phase = (t * 1.5 + (side > 0 ? 0.5 : 0)) % 1;
        ctx.globalAlpha = 1 - phase;
        ctx.beginPath();
        ctx.arc(cx + side * R * (0.9 + phase * 0.3), cy - R * (0.9 + phase * 0.5), R * (0.08 + phase * 0.1), 0, TAU);
        ctx.fill();
      }
      break;
    case "stars":
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * TAU) / 3;
        ctx.fillStyle = "#ffe066";
        ctx.font = `${R * 0.35}px system-ui, sans-serif`;
        ctx.fillText("★", cx + Math.cos(a) * R * 0.9, cy - R * 1.05 + Math.sin(a) * R * 0.18);
      }
      break;
    case "hearts":
      for (let i = 0; i < 2; i++) {
        const phase = (t * 0.6 + i * 0.5) % 1;
        ctx.globalAlpha = 1 - phase;
        drawHeart(ctx, cx + (i ? 1 : -1) * R * 0.9, cy - R * (0.8 + phase * 0.8), R * 0.28, "#ff6f9c");
      }
      break;
    case "confetti": {
      const colors = ["#ffcf4a", "#ff6f9c", "#7be0a8", "#8ab8ff"];
      for (let i = 0; i < 14; i++) {
        const seed = Math.sin(i * 91.7) * 1000;
        const rx = (seed - Math.floor(seed)) * 2 - 1;
        const phase = (t * 0.7 + i / 14) % 1;
        ctx.globalAlpha = 1 - phase;
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(cx + rx * R * 1.6, cy - R * 1.4 + phase * R * 1.4, R * 0.1, R * 0.16);
      }
      break;
    }
    case "question": {
      // Un « ? » violet qui se balance doucement au-dessus de la tête.
      ctx.fillStyle = "#b48cff";
      ctx.font = `900 ${R * 0.75}px system-ui, sans-serif`;
      ctx.translate(cx + R * 1.1, cy - R * 0.95 + Math.sin(t * 3) * R * 0.05);
      ctx.rotate(Math.sin(t * 2) * 0.15);
      ctx.fillText("?", 0, 0);
      break;
    }
    case "check": {
      // Une coche verte qui se trace, puis reste.
      const k = Math.min(1, t / 0.45);
      const x0 = cx + R * 0.85, y0 = cy - R * 0.75;
      ctx.strokeStyle = "#5fe08a";
      ctx.lineWidth = Math.max(2, R * 0.13);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      const a = Math.min(1, k / 0.35); // premier trait (court), puis le long
      ctx.lineTo(x0 + R * 0.15 * a, y0 + R * 0.15 * a);
      if (k > 0.35) {
        const b = (k - 0.35) / 0.65;
        ctx.lineTo(x0 + R * 0.15 + R * 0.35 * b, y0 + R * 0.15 - R * 0.4 * b);
      }
      ctx.stroke();
      break;
    }
    case "sparkles": {
      // Trois petites étincelles à quatre branches qui s'allument à tour de rôle (fière, étoiles plein les yeux).
      ctx.fillStyle = "#fff6c8";
      for (let i = 0; i < 3; i++) {
        const k = Math.sin(((t * 0.7 + i / 3) % 1) * Math.PI);
        const x = cx + [-1.05, 1.1, 0.8][i] * R;
        const y = cy - [0.6, 0.85, 1.2][i] * R;
        const ro = R * 0.13 * k;
        const ri = R * 0.035 * k;
        ctx.beginPath();
        for (let j = 0; j < 8; j++) {
          const a = -Math.PI / 2 + (j * Math.PI) / 4;
          const r = j % 2 ? ri : ro;
          if (j === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "none":
      break;
  }
  ctx.restore();
}

export function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const s = size / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.7);
  ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 1.2, y - s * 0.1, x, y + s * 0.7);
  ctx.fill();
  ctx.restore();
}
