// La roue de couleur libre de la mascotte (Réglages → Mascotte → Style →
// Couleur « Personnalisée ») : un disque teinte / saturation dessiné dans un
// canvas (la teinte tourne autour, la saturation va du centre blanc au bord),
// une glissière de luminosité, et la valeur « #rrggbb » qu'on peut taper.
//
// Pendant qu'on fait glisser, `onPreview` est appelé (au plus quelques fois
// par seconde) pour que l'aperçu de la mascotte suive ; `onCommit` au lâcher.

import { el } from "../island/dom";
import { hslToHex, isHexColor, rgbToHsl, type Rgb } from "../mascot/renderers/gum-draw";

const SIZE = 168;
/** La luminosité reste dans une plage de gomme (ni noir ni blanc). */
const L_MIN = 30;
const L_MAX = 85;
/** Pas plus d'un aperçu toutes les… (ms) pendant le glisser. */
const PREVIEW_EVERY_MS = 150;

const toRgb = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Dessine le disque pour une luminosité donnée (0-100). */
function paintDisc(ctx: CanvasRenderingContext2D, l: number) {
  const img = ctx.createImageData(SIZE, SIZE);
  const c = SIZE / 2;
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - c + 0.5;
      const dy = y - c + 0.5;
      const r = Math.hypot(dx, dy) / (c - 1);
      const i = (y * SIZE + x) * 4;
      if (r > 1.02) continue; // transparent en dehors
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const s = Math.min(1, r) * 100;
      const rgb = toRgb(hslToHex(h, s, l));
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      // Le bord est adouci sur un pixel.
      d[i + 3] = Math.round(255 * Math.min(1, (1.02 - r) * 40));
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function colorWheel(initial: string, onPreview: (hex: string) => void, onCommit: (hex: string) => void): HTMLElement {
  let [h, s, l] = rgbToHsl(toRgb(isHexColor(initial) ? initial : "#4da3ff"));
  l = Math.min(L_MAX, Math.max(L_MIN, Math.round(l)));

  const canvas = el("canvas", { class: "hue-wheel", width: SIZE, height: SIZE, role: "slider", tabindex: 0, "aria-label": "Teinte et saturation" }) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const marker = el("span", { class: "hue-marker", "aria-hidden": "true" });
  const disc = el("div", { class: "hue-disc" }, canvas, marker);
  const light = el("input", { type: "range", class: "hue-light", min: L_MIN, max: L_MAX, step: 1, "aria-label": "Luminosité" }) as HTMLInputElement;
  const hexInput = el("input", { type: "text", class: "hue-hex", maxlength: 7, spellcheck: "false", "aria-label": "Couleur exacte" }) as HTMLInputElement;
  const swatch = el("span", { class: "hue-swatch", "aria-hidden": "true" });

  let paintedL = -1;
  const hex = () => hslToHex(h, s, l);
  const draw = () => {
    if (paintedL !== l) {
      paintDisc(ctx, l);
      paintedL = l;
    }
    const c = SIZE / 2;
    const a = (h * Math.PI) / 180;
    const r = (s / 100) * (c - 1);
    marker.style.left = `${c + Math.cos(a) * r}px`;
    marker.style.top = `${c + Math.sin(a) * r}px`;
    const v = hex();
    marker.style.background = v;
    swatch.style.background = v;
    hexInput.value = v;
    light.value = String(l);
    canvas.setAttribute("aria-valuetext", v);
  };
  draw();

  // Le disque : on appuie et on glisse ; l'aperçu suit, l'enregistrement attend le lâcher.
  let lastPreview = 0;
  const pick = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    s = Math.min(100, Math.round((Math.hypot(dx, dy) / (rect.width / 2)) * 100));
    draw();
    const now = performance.now();
    if (now - lastPreview > PREVIEW_EVERY_MS) {
      lastPreview = now;
      onPreview(hex());
    }
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons & 1) pick(e);
  });
  canvas.addEventListener("pointerup", () => onCommit(hex()));
  // Au clavier : flèches gauche / droite pour la teinte, haut / bas pour la saturation.
  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") h = (h - step * 3 + 360) % 360;
    else if (e.key === "ArrowRight") h = (h + step * 3) % 360;
    else if (e.key === "ArrowUp") s = Math.min(100, s + step);
    else if (e.key === "ArrowDown") s = Math.max(0, s - step);
    else return;
    e.preventDefault();
    draw();
    onCommit(hex());
  });

  light.addEventListener("input", () => {
    l = Number(light.value);
    draw();
    const now = performance.now();
    if (now - lastPreview > PREVIEW_EVERY_MS) {
      lastPreview = now;
      onPreview(hex());
    }
  });
  light.addEventListener("change", () => onCommit(hex()));

  hexInput.addEventListener("change", () => {
    const v = hexInput.value.trim().toLowerCase();
    if (!isHexColor(v)) {
      hexInput.value = hex();
      return;
    }
    [h, s, l] = rgbToHsl(toRgb(v));
    l = Math.min(L_MAX, Math.max(L_MIN, Math.round(l)));
    draw();
    onCommit(hex());
  });

  return el("div", { class: "hue-picker" }, disc, el("div", { class: "hue-side" }, el("label", { class: "hue-row" }, el("span", {}, "Luminosité"), light), el("div", { class: "hue-row" }, swatch, hexInput)));
}
