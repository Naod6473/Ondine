// La machine à états de l'île. Aucun DOM, aucun Tauri : elle reçoit des
// « entrées » (souris, clic, glisser, alerte…) et annonce des transitions.
// C'est island.ts qui dessine et qui bouge la fenêtre.
//
// États :
//   hidden    rien de visible ; la fenêtre n'est qu'une bande invisible de 6 px en haut
//   peek      la souris touche le haut-centre de l'écran : un petit trait apparaît
//   compact   pilule avec la mascotte + la vue compacte d'un module ou une notification
//   expanded  grand panneau avec les vues des modules
//   drop      un fichier est glissé sur l'île : les cibles de dépôt s'affichent
//   alert     notification prioritaire (high/critical)
//
// Transitions (entrée → effet) :
//   hidden   --survol-->                 peek
//   hidden   --notification normale-->   compact (se referme seule ensuite)
//   peek     --survol prolongé (350 ms)--> compact
//   peek     --clic-->                    expanded
//   peek     --souris partie (300 ms)-->  hidden
//   compact  --clic-->                    expanded
//   compact  --souris partie (réglage compactHideSecs)--> hidden
//   expanded --souris partie (réglage expandedCollapseSecs)--> compact
//   expanded --clic sur la mascotte / bouton réduire--> compact
//   (tous)   --Échap-->                   hidden (ou ferme l'alerte si alert)
//   (tous)   --fichier glissé dessus-->   drop   (on retient l'état d'avant)
//   drop     --glisser annulé-->          état d'avant
//   drop     --fichier lâché-->           compact (montre le résultat)
//   (tous sauf drop) --alerte-->         alert  (on retient l'état d'avant)
//   alert    --alerte terminée-->         état d'avant (hidden devient compact)
//   menu de l'icône « Ouvrir l'île »  --> expanded

export type IslandState = "hidden" | "peek" | "compact" | "expanded" | "drop" | "alert";

export interface IslandTimings {
  peekToCompactMs: number;
  peekToHiddenMs: number;
  compactHideMs: number;
  expandedCollapseMs: number;
}

export class IslandStateMachine {
  state: IslandState = "hidden";
  /** La souris est-elle sur l'île ? */
  hovering = false;
  /** État auquel revenir après `drop` ou `alert`. */
  private resume: IslandState = "hidden";
  private timer: number | null = null;

  /** Appelé à chaque transition. */
  onTransition: (from: IslandState, to: IslandState) => void = () => {};

  constructor(public timings: IslandTimings) {}

  // ── Entrées ────────────────────────────────────────────────────────────────

  pointerEnter() {
    if (this.hovering) return;
    this.hovering = true;
    this.cancelTimer();
    if (this.state === "hidden") {
      this.go("peek");
      this.later(this.timings.peekToCompactMs, () => this.state === "peek" && this.go("compact"));
    }
  }

  pointerLeave() {
    if (!this.hovering) return;
    this.hovering = false;
    this.scheduleCollapse();
  }

  click() {
    if (this.state === "peek" || this.state === "compact") this.go("expanded");
  }

  /** Bouton « réduire » ou clic sur la mascotte en grand. */
  shrink() {
    if (this.state === "expanded") this.go("compact");
  }

  /** Menu de l'icône de notification, ou seconde instance lancée. */
  open() {
    if (this.state === "drop" || this.state === "alert") return;
    this.go("expanded");
  }

  /** Renvoie vrai si Échap a été utilisé ici. */
  escape(): "dismiss-alert" | "closed" | null {
    if (this.state === "alert") return "dismiss-alert";
    if (this.state === "hidden") return null;
    this.go("hidden");
    return "closed";
  }

  dragEnter() {
    if (this.state === "drop") return;
    if (this.state !== "alert") this.resume = this.state;
    this.go("drop");
  }

  dragLeave() {
    if (this.state !== "drop") return;
    this.go(this.resume);
    this.scheduleCollapse();
  }

  dropped() {
    if (this.state !== "drop") return;
    this.go("compact");
    this.scheduleCollapse();
  }

  /** Une notification prioritaire arrive. */
  alertStart() {
    if (this.state === "drop") return; // on ne coupe pas un glisser en cours
    if (this.state !== "alert") this.resume = this.state;
    this.go("alert");
  }

  /** Plus d'alerte à afficher. */
  alertEnd() {
    if (this.state !== "alert") return;
    this.go(this.resume === "hidden" || this.resume === "peek" ? "compact" : this.resume);
    this.scheduleCollapse();
  }

  /** Une notification normale : on montre l'île compacte si elle était cachée. */
  showCompact() {
    if (this.state === "hidden" || this.state === "peek") {
      this.go("compact");
      this.scheduleCollapse();
    }
  }

  // ── Mécanique ──────────────────────────────────────────────────────────────

  /** Programme la fermeture adaptée à l'état courant, si la souris n'est pas dessus. */
  private scheduleCollapse() {
    this.cancelTimer();
    if (this.hovering) return;
    switch (this.state) {
      case "peek":
        this.later(this.timings.peekToHiddenMs, () => this.go("hidden"));
        break;
      case "compact":
        this.later(this.timings.compactHideMs, () => this.go("hidden"));
        break;
      case "expanded":
        this.later(this.timings.expandedCollapseMs, () => {
          this.go("compact");
          this.scheduleCollapse();
        });
        break;
      default:
        break; // hidden, drop, alert : rien à programmer
    }
  }

  private go(to: IslandState) {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    this.cancelTimer();
    this.onTransition(from, to);
  }

  private later(ms: number, fn: () => void) {
    this.cancelTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private cancelTimer() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }
}
