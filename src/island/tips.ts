// Les astuces : la première fois qu'on ouvre un onglet, une petite bulle
// d'Ondine explique son geste principal en une phrase (« Glissez un fichier
// sur l'île pour le poser ici. »), avec « OK ».
//
// - La phrase est dans le manifeste du module (champ `tip`).
// - Les onglets déjà vus sont gardés dans le réglage island.tipsSeen (vérifié
//   par le Rust) ; island.tips les coupe toutes ; « Revoir les astuces »
//   (Réglages → Onglets) vide la liste.
// - Un onglet compte comme vu quand on clique sur « OK », ou quand la bulle
//   est restée 3 secondes à l'écran : une bulle à peine entrevue (on passe
//   vite d'un onglet à l'autre, une alerte arrive) reviendra la fois suivante.
// - Seulement dans l'île ouverte : jamais par-dessus une alerte (l'île la
//   retire en quittant l'état « expanded »), jamais en mode démo. L'arrivée
//   de la bulle suit « réduire les animations » (island.css).

import { settingsStore } from "../core/settings-store";
import { el } from "./dom";
import { icon } from "./icon";
import { tipWanted, withSeen } from "./tip-state";

/** Au bout de ce temps à l'écran, la bulle compte comme lue. */
const SEEN_AFTER_MS = 3000;

export class Tips {
  /** L'onglet dont la bulle est ouverte : elle reste, même déjà notée, jusqu'à « OK » ou un autre onglet. */
  private open: string | null = null;
  private bubble: HTMLElement | null = null;

  /**
   * L'onglet `id` vient de s'afficher dans l'île ouverte : pose sa bulle dans
   * `host` (le contenu de l'île, vidé à chaque redessin), si c'est le moment.
   */
  show(id: string | null, tip: string | undefined, host: HTMLElement) {
    const s = settingsStore.current;
    const demo = s.general.demo === true;
    // Déjà ouverte pour cet onglet (et pas encore fermée par « OK ») : elle reste.
    const keep = !!id && !!tip && id === this.open && s.island.tips !== false && !demo;
    if (!id || !tip || !(keep || tipWanted(id, tip, s.island, demo))) {
      this.hide();
      return;
    }
    if (id !== this.open) this.remove();
    this.open = id;
    // Déjà là (même contenu, pas redessiné) : rien à faire.
    if (this.bubble?.isConnected && this.bubble.parentElement === host) return;
    this.bubble?.remove();
    const ok = el("button", { class: "btn small", onclick: () => this.dismiss(id) }, "OK");
    const bubble = el(
      "div",
      { class: "tip-bubble", role: "status" },
      el("span", { class: "tip-icon", "aria-hidden": "true" }, icon("💧")),
      el("span", { class: "tip-text" }, tip),
      ok,
    );
    // Un clic dans la bulle ne doit pas refermer ou ouvrir l'île (voir island.ts).
    bubble.addEventListener("click", (e) => e.stopPropagation());
    host.append(bubble);
    this.bubble = bubble;
    // Restée à l'écran assez longtemps : l'onglet est noté comme vu.
    window.setTimeout(() => {
      if (bubble.isConnected && this.bubble === bubble) this.remember(id);
    }, SEEN_AFTER_MS);
  }

  /** L'île quitte la vue ouverte (repliée, alerte…) : plus de bulle. */
  hide() {
    this.remove();
    this.open = null;
  }

  /** « OK » : la bulle s'en va, et l'onglet est noté. */
  private dismiss(id: string) {
    this.remember(id);
    this.hide();
  }

  private remove() {
    this.bubble?.remove();
    this.bubble = null;
  }

  private remember(id: string) {
    const seen = settingsStore.current.island.tipsSeen ?? [];
    if (seen.includes(id)) return;
    void settingsStore.update((d) => {
      d.island.tipsSeen = withSeen(d.island.tipsSeen ?? [], id);
    });
  }
}
