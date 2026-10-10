// Le pont de fichier à travers l'île (1.2.3) : le mouvement, sans DOM.
//
// Un fichier lâché sur la cible d'un collègue (module Équipe) : une petite
// feuille de gomme plonge dans l'île par le haut, s'écrase en gelée, puis file
// à travers l'île et ressort par le bord droit, vers le collègue (un rond à sa
// couleur s'allume au bord). À l'arrivée chez le destinataire (fichier reçu),
// le chemin inverse : elle entre par le bord gauche et se pose au milieu.
//
// Deux ressorts (src/island/spring.ts) en fractions de la boîte de l'île
// (0 = bord gauche / haut, 1 = bord droit / bas) : l'île peut changer de taille
// en route, la feuille suit. L'écrasement vient de la vitesse (volume gardé :
// sx × sy = 1). La partie DOM est dans bridge.ts.

import { stepSpring, type Spring, type SpringParams } from "../../island/spring";

/** La plongée : vive, un rebond en arrivant dans l'île. */
export const DIVE: SpringParams = { stiffness: 140, damping: 0.5 };
/** La traversée : une glissade qui accélère, sans rebond. */
export const CROSS: SpringParams = { stiffness: 30, damping: 0.85 };
/** Le fondu de la fin (secondes). */
export const FADE_S = 0.35;
/** Au-delà, tout s'arrête quoi qu'il arrive (secondes). */
export const MAX_S = 4;

export interface BridgeState {
  /** 1 : envoi (sort à droite) ; -1 : réception (entre par la gauche). */
  dir: 1 | -1;
  phase: "dive" | "cross" | "land" | "done";
  x: Spring;
  y: Spring;
  /** Temps écoulé (s), et depuis le début de la phase. */
  t: number;
  tPhase: number;
}

export function startBridge(dir: 1 | -1): BridgeState {
  return dir === 1
    ? { dir, phase: "dive", x: { x: 0.5, v: 0 }, y: { x: -0.9, v: 0 }, t: 0, tPhase: 0 }
    : { dir, phase: "cross", x: { x: -0.2, v: 0 }, y: { x: 0.5, v: 0 }, t: 0, tPhase: 0 };
}

function go(s: BridgeState, phase: BridgeState["phase"]) {
  s.phase = phase;
  s.tPhase = 0;
}

/** Fait avancer le pont de `dt` secondes. */
export function stepBridge(s: BridgeState, dt: number): void {
  if (s.phase === "done") return;
  s.t += dt;
  s.tPhase += dt;
  if (s.t > MAX_S) return go(s, "done");
  switch (s.phase) {
    case "dive":
      stepSpring(s.y, 0.5, DIVE, dt);
      // Arrivée dans l'île (après le petit rebond) : elle file vers le bord.
      if (s.tPhase > 0.32 && Math.abs(s.y.x - 0.5) < 0.12) go(s, "cross");
      break;
    case "cross":
      stepSpring(s.y, 0.5, DIVE, dt);
      if (s.dir === 1) {
        // Une cible derrière le bord : le ressort tire encore quand elle le passe.
        stepSpring(s.x, 1.35, CROSS, dt);
        if (s.x.x > 1.12) go(s, "done");
      } else {
        stepSpring(s.x, 0.5, DIVE, dt);
        if (s.tPhase > 0.5 && Math.abs(s.x.x - 0.5) < 0.03 && Math.abs(s.x.v) < 0.3) go(s, "land");
      }
      break;
    case "land":
      stepSpring(s.x, 0.5, DIVE, dt);
      if (s.tPhase >= FADE_S) go(s, "done");
      break;
  }
}

/** L'allure de la feuille : écrasement (selon la vitesse), penchée, opacité. */
export function bridgeLook(s: BridgeState): { sx: number; sy: number; rot: number; alpha: number } {
  const vx = Math.abs(s.x.v);
  const vy = Math.abs(s.y.v);
  // Elle s'étire dans le sens où elle file (largeur pour la traversée, hauteur pour la plongée).
  const k = Math.min(0.5, (vx - vy * 0.6) * 0.18);
  const sx = 1 + Math.max(-0.35, k);
  const sy = 1 / sx;
  const rot = Math.max(-0.35, Math.min(0.35, s.x.v * 0.08));
  let alpha = 1;
  if (s.phase === "dive") alpha = Math.min(1, s.tPhase / 0.12);
  else if (s.phase === "land") alpha = Math.max(0, 1 - s.tPhase / FADE_S);
  else if (s.phase === "cross" && s.dir === 1) alpha = Math.max(0, Math.min(1, (1.12 - s.x.x) / 0.15));
  else if (s.phase === "done") alpha = 0;
  return { sx, sy, rot, alpha };
}
