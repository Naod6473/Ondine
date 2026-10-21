// Une goutte qui tombe et rebondit comme de la gelée (jetons du Puissance 4,
// symboles du morpion, gouttes de la course à l'arrivée).
//
// La chute suit la pesanteur (elle accélère) et s'étire selon sa vitesse ;
// au contact, elle rebondit un peu (une part de sa vitesse, vers le haut) et
// s'écrase : l'écrasement revient ensuite par un ressort qui dépasse un peu
// (stepSpring de src/island/spring.ts, le même calcul que l'île), d'où le
// petit « tremblé » de gomme. Le volume est gardé : écrasée en hauteur, la
// goutte s'élargit d'autant.
//
// Rien ne bouge avec « Réduire les animations » : la goutte est posée tout de
// suite. Pas de boucle permanente : l'animation s'arrête une fois posée.

import { stepSpring, type Spring } from "../../island/spring";
import { reducedMotion } from "../../island/tab-pill";
import { EASE_OUT } from "../../core/easing";

/** Pesanteur (px/s²) et part de la vitesse gardée au rebond. */
const GRAVITY = 3200;
const BOUNCE = 0.3;
/** Le ressort de l'écrasement : raide et peu amorti (la gomme tremble). */
const SQUASH = { stiffness: 520, damping: 0.32 };

/**
 * Fait tomber `node` de `height` px au-dessus de sa place (posée par le CSS)
 * jusqu'à elle. `onLand` est appelé au premier contact (un son). Renvoie de
 * quoi arrêter (la goutte est alors posée).
 */
export function fallInto(node: HTMLElement, height: number, onLand?: (impact: number) => void): () => void {
  const place = () => {
    node.style.transform = "";
  };
  if (reducedMotion() || height <= 0) {
    place();
    onLand?.(0);
    return place;
  }
  let y = -height;
  let v = 0;
  let landed = false;
  const squash: Spring = { x: 0, v: 0 };
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min(1 / 20, (now - last) / 1000);
    last = now;
    v += GRAVITY * dt;
    y += v * dt;
    if (y >= 0) {
      y = 0;
      const impact = v;
      if (!landed) {
        landed = true;
        onLand?.(impact);
      }
      // Le choc écrase la goutte (au plus 38 %), puis elle rebondit.
      squash.v -= Math.min(9, impact / 260);
      v = impact > 120 ? -impact * BOUNCE : 0;
    }
    stepSpring(squash, 0, SQUASH, dt);
    // En l'air, elle s'étire avec la vitesse ; posée, c'est le ressort qui joue.
    const stretch = y < 0 ? Math.min(0.22, Math.abs(v) / 5200) : 0;
    const sy = Math.max(0.62, 1 + stretch + squash.x * 0.12);
    const sx = 1 / sy;
    node.style.transform = `translateY(${y.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    const resting = y === 0 && v === 0 && Math.abs(squash.x) < 0.01 && Math.abs(squash.v) < 0.05;
    if (resting) {
      place();
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  // L'origine en bas : l'écrasement se fait contre le fond.
  node.style.transformOrigin = "50% 100%";
  node.style.transform = `translateY(${y}px)`;
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    place();
  };
}

/** Un petit « boing » sur place (un symbole qui apparaît, une goutte qui gagne). */
export function wobble(node: HTMLElement, amount = 1): void {
  if (reducedMotion()) return;
  node.animate(
    [
      { transform: "scale(0.4, 0.4)" },
      { transform: `scale(${1 + 0.18 * amount}, ${1 - 0.14 * amount})`, offset: 0.45 },
      { transform: `scale(${1 - 0.08 * amount}, ${1 + 0.08 * amount})`, offset: 0.7 },
      { transform: "scale(1, 1)" },
    ],
    { duration: 520, easing: EASE_OUT },
  );
}
