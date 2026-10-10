// La molette de la souris sur l'île règle le volume (1.2.3) : les calculs,
// sans DOM (testés par tests/front/wheel-volume.test.ts).
//
// Une molette classique envoie environ 100 px par cran ; un pavé tactile,
// beaucoup de petits pas. On additionne donc les pas et on rend un nombre
// entier de points de volume : 2 % par cran, comme le volet de Windows.

/** Points de volume par cran de molette. */
export const STEP_PER_NOTCH = 2;
/** Combien de px font un cran (Chromium : ~100 px par cran à 100 %). */
const PX_PER_NOTCH = 100;
/** Au plus, par événement (une molette libre, un pavé lancé) : 5 crans. */
const MAX_PER_EVENT = 5 * STEP_PER_NOTCH;

/** Additionne la molette et rend les points de volume à ajouter (vers le haut = plus fort). */
export class WheelVolume {
  private rest = 0;
  private lastAt = 0;

  /**
   * `deltaY` et `deltaMode` d'un WheelEvent, `now` en ms. Rend un entier (0 :
   * pas encore assez pour un point). Un reste vieux de plus d'une demi-seconde
   * est oublié, et un changement de sens repart de zéro.
   */
  push(deltaY: number, deltaMode: number, now: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    // deltaMode 1 = lignes (≈ 3 par cran), 2 = pages.
    const px = deltaMode === 1 ? deltaY * (PX_PER_NOTCH / 3) : deltaMode === 2 ? deltaY * PX_PER_NOTCH * 3 : deltaY;
    if (now - this.lastAt > 500 || (this.rest !== 0 && Math.sign(-px) !== Math.sign(this.rest))) this.rest = 0;
    this.lastAt = now;
    // Molette vers le haut (deltaY négatif) = plus fort.
    this.rest += (-px / PX_PER_NOTCH) * STEP_PER_NOTCH;
    const whole = Math.trunc(this.rest);
    this.rest -= whole;
    // (« || 0 » : pas de -0.)
    return Math.max(-MAX_PER_EVENT, Math.min(MAX_PER_EVENT, whole)) || 0;
  }
}

/**
 * Le volume après `delta` points : entre 0 et 100. Monter le son le rétablit
 * s'il était coupé (comme les touches de Windows) ; le baisser jusqu'à 0 ne
 * le coupe pas.
 */
export function nextVolume(volume: number, muted: boolean, delta: number): { volume: number; muted: boolean } {
  const v = Math.round(Math.max(0, Math.min(100, (Number.isFinite(volume) ? volume : 0) + delta)));
  return { volume: v, muted: muted && delta <= 0 };
}

/** Le niveau des ondes du haut-parleur : 0 (coupé ou muet), 1 (moins de la moitié), 2. */
export function speakerLevel(volume: number, muted: boolean): 0 | 1 | 2 {
  return muted || volume <= 0 ? 0 : volume < 50 ? 1 : 2;
}

/**
 * La molette règle-t-elle le volume ici ? Dans la mini-île (et le trait, le
 * format nano, une alerte) : partout sur l'île. Dans l'île ouverte : seulement
 * sur la mascotte (ailleurs, la molette fait défiler les listes).
 */
export function wheelSetsVolume(state: string, onMascot: boolean): boolean {
  if (state === "compact" || state === "peek" || state === "alert") return true;
  return state === "expanded" && onMascot;
}
