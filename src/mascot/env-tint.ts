// La teinte de l'environnement posée sur les reflets de la mascotte gomme : la
// couleur de la pochette du morceau en lecture. Le module Musique donne la
// pochette (une data URL, déjà demandée pour la mini-île) à setCover() ; on
// la réduit à 12 × 12 pixels et on garde sa couleur la plus vive en moyenne.
// Tout reste dans la fenêtre : rien n'est envoyé nulle part. (Le fond d'écran
// n'est pas lu : il faudrait le demander au système.)

import type { Rgb } from "./renderers/gum-draw";

let tint: Rgb | null = null;
/** Le numéro de la dernière pochette demandée (une ancienne qui finit de charger après est ignorée). */
let asked = 0;
let lastUrl: string | null = null;

/** La couleur de la pochette en cours, ou null (rien en lecture, pas de pochette). */
export function coverTint(): Rgb | null {
  return tint;
}

/**
 * La couleur d'une image (pixels RVBA) : la moyenne des pixels, chacun compté
 * selon sa saturation (le gris, le noir et le blanc d'une pochette comptent
 * peu). null si l'image est presque sans couleur.
 */
export function averageColor(data: ArrayLike<number>): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.5) continue;
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    const sat = max === 0 ? 0 : (max - min) / max;
    // Les pixels très sombres ne donnent pas de reflet.
    const w = a * sat * sat * (max > 40 ? 1 : 0.1);
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    total += w;
  }
  if (total < 0.5) return null;
  return [r / total, g / total, b / total];
}

/** La pochette du morceau en lecture (data URL), ou null quand plus rien ne joue. */
export function setCover(url: string | null) {
  if (url === lastUrl) return;
  lastUrl = url;
  const id = ++asked;
  if (!url || typeof Image === "undefined") {
    tint = null;
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (id !== asked) return;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 12;
      const x = c.getContext("2d", { willReadFrequently: true });
      if (!x) return;
      x.drawImage(img, 0, 0, 12, 12);
      tint = averageColor(x.getImageData(0, 0, 12, 12).data);
    } catch {
      tint = null; // une image d'ailleurs (illisible) : pas de teinte
    }
  };
  img.onerror = () => id === asked && (tint = null);
  img.src = url;
}
