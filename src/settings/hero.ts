// La bande en tête d'une page des Réglages (1.2.4) : grand titre, une phrase
// courte, les boutons principaux, sur un fond noir où la couleur de la page
// respire. Version de départ, sans animation : la branche « fenêtre » la rend
// vivante (bulles, vague, gouttes de la famille gomme).

import { el } from "../island/dom";

export interface HeroOptions {
  /** Le titre de la page. */
  title: string;
  /** Une phrase courte sous le titre. */
  subtitle?: string;
  /** La couleur de la page (#rrggbb). */
  color: string;
  /** Les mascottes de la famille gomme qui vivent dans la bande (ids de gum-family). */
  mascots?: string[];
  /** Les boutons principaux de la page. */
  actions?: HTMLElement[];
}

/** La bande, à poser en haut de la page. */
export function hero(opts: HeroOptions): HTMLElement {
  const band = el(
    "section",
    { class: "page-hero" },
    el("h1", {}, opts.title),
    opts.subtitle ? el("p", {}, opts.subtitle) : null,
    opts.actions?.length ? el("div", { class: "page-hero-actions" }, ...opts.actions) : null,
  );
  band.style.setProperty("--page-color", opts.color);
  return band;
}
