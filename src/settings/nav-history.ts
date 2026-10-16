// L'historique de navigation des Réglages (1.2.5) : le bouton « retour » de
// la souris et Alt+← reviennent à la page d'avant, Alt+→ (ou le bouton
// « suivant ») y retourne. Logique pure, sans DOM, testée dans
// tests/front/settings-nav.test.ts ; main.ts écoute la souris et le clavier.

import type { NavPlace } from "./nav-logic";

/** Deux places sont-elles la même (même page, même sous-menu) ? */
export function samePlace(a: NavPlace | null | undefined, b: NavPlace | null | undefined): boolean {
  return !!a && !!b && a.page === b.page && (a.sub ?? null) === (b.sub ?? null);
}

export class NavHistory {
  private back: NavPlace[] = [];
  private forward: NavPlace[] = [];
  private here: NavPlace | null = null;

  /** `max` : combien de places on garde derrière soi. */
  constructor(private readonly max = 50) {}

  /** La place affichée. */
  get current(): NavPlace | null {
    return this.here;
  }

  get canBack(): boolean {
    return this.back.length > 0;
  }

  get canForward(): boolean {
    return this.forward.length > 0;
  }

  /**
   * On arrive quelque part (clic, recherche, lien) : l'ancienne place passe
   * derrière, et ce qu'on pouvait « avancer » est oublié (comme un navigateur).
   */
  visit(place: NavPlace) {
    if (samePlace(this.here, place)) return;
    if (this.here) {
      this.back.push(this.here);
      if (this.back.length > this.max) this.back.shift();
    }
    this.forward = [];
    this.here = { page: place.page, sub: place.sub ?? null };
  }

  /** Revient d'un cran ; null s'il n'y a rien derrière. */
  goBack(): NavPlace | null {
    const prev = this.back.pop();
    if (!prev) return null;
    if (this.here) this.forward.push(this.here);
    this.here = prev;
    return prev;
  }

  /** Avance d'un cran (après un retour) ; null s'il n'y a rien devant. */
  goForward(): NavPlace | null {
    const next = this.forward.pop();
    if (!next) return null;
    if (this.here) this.back.push(this.here);
    this.here = next;
    return next;
  }

  /**
   * Une place a disparu (un module retiré, un profil supprimé) : on l'oublie,
   * pour que « retour » ne mène pas à une page vide.
   */
  forget(keep: (place: NavPlace) => boolean) {
    this.back = this.back.filter(keep);
    this.forward = this.forward.filter(keep);
  }
}
