// Double-clic sur Ondine dans l'île (1.2.3) : une action au choix (réglage
// `mascot.doubleClick`, Réglages → Mascotte), « Parler à Ondine » par défaut.
// Sans DOM : testé par tests/front/mascot-double-click.test.ts.
//
// Les clics sur la mascotte ont déjà leur sens (mascot-state.ts, eggs.ts) :
// un clic → contente, deux → elle rit, trois → agacée, six → étourdie, et la
// série rapide de la surprise « split ». Un double-clic ne doit pas voler ces
// séries : chaque clic garde sa réaction (mascot.clicked part toujours), et
// l'action n'est lancée qu'un court instant APRÈS le deuxième clic, si aucun
// troisième n'est venu. Une série de trois clics ou plus ne lance rien, jusqu'à
// une pause.

export type DoubleClickAction = "ask" | "launcher" | "capture" | "note" | "none";

export const DOUBLE_CLICK_ACTIONS: readonly DoubleClickAction[] = ["ask", "launcher", "capture", "note", "none"];

/** Une valeur des réglages → une action connue (inconnue : « Parler à Ondine »). */
export function doubleClickActionOf(v: unknown): DoubleClickAction {
  return DOUBLE_CLICK_ACTIONS.includes(v as DoubleClickAction) ? (v as DoubleClickAction) : "ask";
}

/** Le module qui fait chaque action (pour vérifier qu'il est activé). */
export const ACTION_MODULE: Record<Exclude<DoubleClickAction, "none">, string> = {
  ask: "askclaude",
  launcher: "launcher",
  capture: "capture",
  note: "notes",
};

/** Au plus ce délai entre deux clics d'un double-clic (ms). */
export const DOUBLE_MS = 420;
/** L'action attend ce délai après le deuxième clic : un troisième l'annule (ms). */
export const CONFIRM_MS = 260;

/** Reconnaît un double-clic « net » dans une suite de clics. */
export class DoubleClick {
  private last = -Infinity;
  private count = 0;

  /**
   * Un clic sur la mascotte, à `now` (ms). Vrai si c'est le deuxième d'un
   * double-clic : appeler `confirm()` dans CONFIRM_MS.
   */
  click(now: number): boolean {
    this.count = now - this.last <= DOUBLE_MS ? this.count + 1 : 1;
    this.last = now;
    return this.count === 2;
  }

  /** À l'heure prévue : vrai si aucun autre clic n'est venu (on lance l'action). */
  confirm(now: number): boolean {
    const ok = this.count === 2 && now - this.last >= CONFIRM_MS - 1;
    if (ok) this.count = 0;
    return ok;
  }

  /** Un geste a interrompu la série (on a tiré Ondine…). */
  reset(): void {
    this.count = 0;
    this.last = -Infinity;
  }
}
