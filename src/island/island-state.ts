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
//   compact  --souris partie (réglage collapseSecs)--> hidden
//            (pas tant qu'une notification est affichée : voir `hold`)
//   expanded --souris partie (réglage collapseSecs)--> hidden
//            (ou compact si une notification est affichée)
//   expanded --clic sur la mascotte / bouton réduire--> compact
//   (tous)   --Échap-->                   hidden (ou ferme l'alerte si alert)
//   (tous)   --fichier glissé dessus-->   drop   (on retient l'état d'avant)
//   drop     --glisser annulé-->          état d'avant
//   drop     --fichier lâché-->           compact (montre le résultat)
//   (tous sauf drop) --alerte-->         alert  (on retient l'état d'avant)
//   alert    --alerte terminée-->         état d'avant (hidden devient compact)
//   menu de l'icône « Ouvrir l'île »  --> expanded
//
// Réglage « Toujours en mini » (alwaysMini) : l'état de repos devient compact
// au lieu de hidden. L'île ne disparaît plus ; elle redevient mini. Seul le mode
// présentation la cache encore (hide), et elle revient en mini après (restore).
//
// Format nano (réglage island.size = "nano", 1.2.3) : l'état compact a alors
// deux FORMES (`form`), sans changer d'état :
//   nano  la toute petite encoche qui ne montre qu'Ondine (au repos)
//   mini  la mini-île habituelle
// Elle passe en mini tant qu'il y a une raison (`wideReasons`) : la souris
// dessus depuis `nanoPreviewMs` (idée 1, sans clic), une notification affichée
// (hold), un « coup d'élargissement » (`pulse` : un morceau qui commence, un
// minuteur qui démarre ou sonne, un agent qui finit), ou une activité qui dure
// (`setBusy` : la voix). Sans raison, elle revient à l'encoche ; la souris
// partie, après `nanoRetractMs`.

export type IslandState = "hidden" | "peek" | "compact" | "expanded" | "drop" | "alert";

/** La forme de l'île compacte : l'encoche nano ou la mini-île. */
export type CompactForm = "nano" | "mini";

export interface IslandTimings {
  peekToCompactMs: number;
  peekToHiddenMs: number;
  /** Délai avant repli quand la souris n'est plus sur l'île (réglage collapseSecs). */
  collapseMs: number;
  /** Format nano : survol avant que l'encoche devienne mini-île (ms). */
  nanoPreviewMs?: number;
  /** Format nano : la souris partie, délai avant de revenir à l'encoche (ms). */
  nanoRetractMs?: number;
}

const NANO_PREVIEW_MS = 120;
const NANO_RETRACT_MS = 320;

export class IslandStateMachine {
  state: IslandState = "hidden";
  /** La souris est-elle sur l'île ? */
  hovering = false;
  /** Une alerte arrivée pendant un glisser, à montrer dès qu'il est fini. */
  private alertWaiting = false;
  /** État auquel revenir après `drop` ou `alert`. */
  private resume: IslandState = "hidden";
  /** Une notification est affichée : l'île compacte reste ouverte pour qu'on puisse la lire. */
  private holding = false;
  private timer: number | null = null;
  /** Réglage « Toujours en mini » : l'île se repose en compact, pas cachée. */
  private alwaysMini = false;
  /** Cachée exprès (mode présentation), même en « Toujours en mini ». */
  private forcedHidden = false;

  /** Format nano (réglage island.size). */
  private nano = false;
  /** Survol de la nano assez long : elle devient mini-île (idée 1). */
  private hoverWide = false;
  private formTimer: number | null = null;
  /** Un coup d'élargissement en cours (pulse), et sa fin. */
  private pulsing = false;
  private pulseTimer: number | null = null;
  /** Les activités qui gardent la mini-île tant qu'elles durent (setBusy). */
  private busy = new Set<string>();
  /** Un travail montré dans la mini-île (une conversion) : elle ne se replie pas (keepOpen). */
  private kept = new Set<string>();
  /** La forme affichée de l'île compacte (voir `form()`). */
  shownForm: CompactForm = "mini";

  /** Appelé à chaque transition. */
  onTransition: (from: IslandState, to: IslandState) => void = () => {};
  /** Appelé quand la forme de l'île compacte change (format nano). */
  onForm: (form: CompactForm) => void = () => {};

  constructor(public timings: IslandTimings) {}

  // ── Entrées ────────────────────────────────────────────────────────────────

  pointerEnter() {
    if (this.hovering) return;
    this.hovering = true;
    this.cancelTimer();
    this.armHoverWide(true);
    if (this.state === "hidden") {
      this.go("peek");
      this.later(this.timings.peekToCompactMs, () => this.state === "peek" && this.go("compact"));
    }
  }

  pointerLeave() {
    if (!this.hovering) return;
    this.hovering = false;
    this.armHoverWide(false);
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

  /** Un module demande à refermer l'île (pas pendant une alerte ou un glisser). */
  close() {
    if (this.state === "alert" || this.state === "drop" || this.state === this.rest()) return;
    this.go(this.rest());
  }

  /** Renvoie vrai si Échap a été utilisé ici. */
  escape(): "dismiss-alert" | "closed" | null {
    if (this.state === "alert") return "dismiss-alert";
    if (this.state === this.rest() || this.state === "hidden") return null;
    this.go(this.rest());
    return "closed";
  }

  /** Active ou coupe « Toujours en mini ». */
  setAlwaysMini(on: boolean) {
    if (on === this.alwaysMini) return;
    this.alwaysMini = on;
    if (on && (this.state === "hidden" || this.state === "peek") && !this.forcedHidden) this.go("compact");
    else this.scheduleCollapse();
  }

  /** Cache l'île quoi qu'il arrive (mode présentation). */
  hide() {
    this.forcedHidden = true;
    if (this.state !== "hidden") this.go("hidden");
  }

  /** Fin du mode présentation : en « Toujours en mini », l'île revient. */
  restore() {
    this.forcedHidden = false;
    if (this.alwaysMini && this.state === "hidden") this.go("compact");
  }

  /** Au repos (cachée, ou mini en « Toujours en mini ») : ni survolée, ni notification affichée. */
  resting(): boolean {
    return this.state === this.rest() && !this.hovering && !this.holding;
  }

  /** L'état où l'île se repose quand personne ne s'en sert. */
  private rest(): IslandState {
    return this.alwaysMini && !this.forcedHidden ? "compact" : "hidden";
  }

  dragEnter() {
    if (this.state === "drop") return;
    // Une alerte affichée revient une fois le glisser fini.
    if (this.state === "alert") this.alertWaiting = true;
    else this.resume = this.state;
    this.go("drop");
  }

  dragLeave() {
    if (this.state !== "drop") return;
    if (this.showWaitingAlert()) return;
    this.go(this.resume);
    this.scheduleCollapse();
  }

  dropped() {
    if (this.state !== "drop") return;
    if (this.showWaitingAlert()) return;
    this.go("compact");
    this.scheduleCollapse();
  }

  /** Une notification prioritaire arrive. */
  alertStart() {
    // On ne coupe pas un glisser en cours : l'alerte attend sa fin.
    if (this.state === "drop") {
      this.alertWaiting = true;
      return;
    }
    if (this.state !== "alert") this.resume = this.state;
    this.go("alert");
  }

  /** Après un glisser : l'alerte arrivée (ou affichée) entre-temps, s'il y en a une. */
  private showWaitingAlert(): boolean {
    if (!this.alertWaiting) return false;
    this.alertWaiting = false;
    this.go("alert");
    return true;
  }

  /** Plus d'alerte à afficher. */
  alertEnd() {
    this.alertWaiting = false;
    if (this.state !== "alert") return;
    this.go(this.resume === "hidden" || this.resume === "peek" ? "compact" : this.resume);
    this.scheduleCollapse();
  }

  /**
   * Une notification est (ou n'est plus) affichée. Tant qu'elle l'est, l'île
   * compacte ne se replie pas : c'est la notification qui décide de sa durée.
   */
  hold(on: boolean) {
    if (on === this.holding) return;
    this.holding = on;
    if (on && this.state === "compact") this.cancelTimer();
    if (!on) this.scheduleCollapse();
    this.refreshForm();
  }

  /** Une notification normale : on montre l'île compacte si elle était cachée. */
  showCompact() {
    if (this.state === "hidden" || this.state === "peek") {
      this.go("compact");
      this.scheduleCollapse();
    }
  }

  // ── Format nano ────────────────────────────────────────────────────────────

  /** Active ou coupe le format nano (réglage island.size). */
  setNano(on: boolean) {
    if (on === this.nano) return;
    this.nano = on;
    this.hoverWide = this.hovering;
    this.refreshForm();
  }

  /** Format nano activé ? */
  get nanoOn(): boolean {
    return this.nano;
  }

  /**
   * Un « coup d'élargissement » : la nano devient mini-île pendant `ms`, puis
   * revient à l'encoche (un nouveau morceau, un minuteur qui démarre…).
   * Un nouveau coup prolonge le précédent.
   */
  pulse(ms: number) {
    if (this.pulseTimer != null) clearTimeout(this.pulseTimer);
    this.pulsing = true;
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null;
      this.pulsing = false;
      this.refreshForm();
    }, Math.max(0, ms));
    this.refreshForm();
  }

  /** Une activité qui dure (la voix) garde la mini-île tant qu'elle est vraie. */
  setBusy(key: string, on: boolean) {
    if (on === this.busy.has(key)) return;
    if (on) this.busy.add(key);
    else this.busy.delete(key);
    this.refreshForm();
  }

  /**
   * Un travail montré dans la mini-île (Ondine convertit : elle mâche, puis
   * la pilule de résultat) : tant qu'il dure, l'île compacte ne se replie pas
   * et la nano reste mini-île. Fini, elle se replie comme d'habitude.
   */
  keepOpen(key: string, on: boolean) {
    if (on === this.kept.has(key)) return;
    if (on) this.kept.add(key);
    else this.kept.delete(key);
    if (on && this.state === "compact") this.cancelTimer();
    if (!on) this.scheduleCollapse();
    this.refreshForm();
  }

  /** Les raisons d'être en mini-île en ce moment (pour les tests et le journal). */
  wideReasons(): string[] {
    const out: string[] = [];
    if (this.hoverWide) out.push("hover");
    if (this.holding) out.push("notification");
    if (this.pulsing) out.push("pulse");
    for (const k of this.busy) out.push(k);
    for (const k of this.kept) out.push(k);
    return out;
  }

  /** La forme voulue : nano seulement en format nano, état compact, et sans raison de s'élargir. */
  form(): CompactForm {
    if (!this.nano || this.state !== "compact") return "mini";
    return this.wideReasons().length ? "mini" : "nano";
  }

  /** La souris arrive (true) ou part (false) : la nano s'ouvre après un court survol, se rétracte peu après. */
  private armHoverWide(on: boolean) {
    if (this.formTimer != null) clearTimeout(this.formTimer);
    this.formTimer = null;
    if (!this.nano) {
      this.hoverWide = on;
      return;
    }
    if (on === this.hoverWide) return;
    const ms = on ? (this.timings.nanoPreviewMs ?? NANO_PREVIEW_MS) : (this.timings.nanoRetractMs ?? NANO_RETRACT_MS);
    this.formTimer = window.setTimeout(() => {
      this.formTimer = null;
      this.hoverWide = on;
      this.refreshForm();
    }, ms);
  }

  /** Annonce la forme si elle a changé. */
  private refreshForm() {
    const f = this.form();
    if (f === this.shownForm) return;
    this.shownForm = f;
    this.onForm(f);
  }

  // ── Mécanique ──────────────────────────────────────────────────────────────

  /** Programme la fermeture adaptée à l'état courant, si la souris n'est pas dessus. */
  private scheduleCollapse() {
    this.cancelTimer();
    if (this.hovering) return;
    if ((this.holding || this.kept.size) && this.state === "compact") return;
    switch (this.state) {
      case "peek":
        this.later(this.timings.peekToHiddenMs, () => this.go("hidden"));
        break;
      case "compact":
        if (this.rest() === "compact") break; // « Toujours en mini » : elle reste
        this.later(this.timings.collapseMs, () => this.go("hidden"));
        break;
      case "expanded":
        // D'un coup jusqu'à l'état de repos, sauf si une notification attend d'être lue.
        this.later(this.timings.collapseMs, () => this.go(this.holding || this.kept.size ? "compact" : this.rest()));
        break;
      default:
        break; // hidden, drop, alert : rien à programmer
    }
  }

  private go(to: IslandState) {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    // Une île cachée n'est plus survolée : le prochain survol doit la réveiller.
    if (to === "hidden") {
      this.hovering = false;
      this.hoverWide = false;
      if (this.formTimer != null) clearTimeout(this.formTimer);
      this.formTimer = null;
    }
    this.cancelTimer();
    // La forme d'abord (sans annonce) : le dessin de la transition la connaît déjà.
    this.shownForm = this.form();
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
