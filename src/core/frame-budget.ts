/** Limite le dessin selon le temps écoulé, indépendamment des écrans 60/120/144 Hz. */
export class FrameBudget {
  private last = Number.NEGATIVE_INFINITY;
  due(now: number, fps: number): boolean {
    if (now - this.last + 0.01 < 1000 / fps) return false;
    this.last = now;
    return true;
  }
  reset() { this.last = Number.NEGATIVE_INFINITY; }
}
