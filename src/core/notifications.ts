// La file de notifications avec priorités.
//
// Un module DEMANDE l'attention (api.notify) ; c'est l'île qui décide quoi
// afficher, et quand. Règles :
//   - une seule notification affichée à la fois ;
//   - la file est triée par priorité (critical > high > normal > low), puis par
//     ordre d'arrivée ;
//   - une notification plus prioritaire que celle affichée la remplace tout de
//     suite (l'ancienne retourne en tête de file si elle n'avait pas fini) ;
//   - "high" et "critical" font passer l'île en état `alert` ; "low" et "normal"
//     s'affichent dans l'île compacte, sans la forcer à s'ouvrir en grand ;
//   - même `key` = même sujet : la nouvelle remplace l'ancienne (pas de doublons) ;
//   - au plus MAX_QUEUE en attente : au-delà, la moins prioritaire est abandonnée ;
//   - en pause (mode présentation, mode concentration), seules les "critical"
//     s'affichent (et celles des modules qu'une pause laisse passer, comme le
//     Minuteur pendant la concentration) ; les autres attendent la fin de la pause.

export type Priority = "low" | "normal" | "high" | "critical";

const RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, critical: 3 };
const MAX_QUEUE = 20;

export interface NotificationAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface NotificationRequest {
  moduleId: string;
  title: string;
  body?: string;
  icon?: string;
  priority?: Priority;
  /** Durée d'affichage ; défaut = réglage `island.notificationSecs`. */
  durationMs?: number;
  /** Reste affichée jusqu'à ce qu'on la ferme. */
  sticky?: boolean;
  /** Identifiant de sujet : une nouvelle notification de même clé remplace l'ancienne. */
  key?: string;
  actions?: NotificationAction[];
  /** Le titre en vert (« Identique ✓ ») ou en rouge (« Différente ✗ »). */
  tone?: "good" | "bad";
  /** En alerte, une île plus large et plus haute : pour un long texte (une empreinte entière). */
  wide?: boolean;
  /**
   * Un contenu dessiné par le demandeur à la place du corps de texte, dans
   * l'alerte seulement (en compact, le titre suffit) : il reçoit l'élément à
   * remplir et renvoie de quoi tout défaire (l'île l'appelle dès que la carte
   * disparaît). Le panneau « Quoi de neuf » et ses mascottes animées.
   */
  content?: (host: HTMLElement) => () => void;
}

export interface IslandNotification extends NotificationRequest {
  id: number;
  priority: Priority;
  createdAt: number;
}

export function isAlert(n: IslandNotification | null): boolean {
  return !!n && RANK[n.priority] >= RANK.high;
}

export class NotificationQueue {
  private queue: IslandNotification[] = [];
  private shown: IslandNotification | null = null;
  private timer: number | null = null;
  private nextId = 1;
  /**
   * Les pauses en cours : raison ("presentation", "focus"…) → modules dont les
   * notifications passent quand même. Plusieurs pauses peuvent se chevaucher :
   * la file ne repart que quand la dernière est levée.
   */
  private pauses = new Map<string, string[]>();

  /** Durée par défaut (ms), mise à jour depuis les réglages. */
  defaultDurationMs = 6000;
  /** Appelé chaque fois que la notification affichée change (null = aucune). */
  onShow: (n: IslandNotification | null) => void = () => {};

  current(): IslandNotification | null {
    return this.shown;
  }

  push(req: NotificationRequest): number {
    const n: IslandNotification = {
      ...req,
      id: this.nextId++,
      priority: req.priority ?? "normal",
      createdAt: Date.now(),
    };
    if (n.key) {
      this.queue = this.queue.filter((q) => q.key !== n.key);
      if (this.shown?.key === n.key) {
        this.shown = null; // remplacée ci-dessous
        this.clearTimer();
      }
    }
    // Plus prioritaire que l'affichée : elle passe devant (sauf en pause, s'il ne s'agit pas d'une critique).
    if (this.shown && RANK[n.priority] > RANK[this.shown.priority]) {
      this.queue.unshift(this.shown);
      this.shown = null;
      this.clearTimer();
    }
    this.queue.push(n);
    this.sort();
    if (this.queue.length > MAX_QUEUE) this.queue.pop();
    if (!this.shown) this.showNext();
    return n.id;
  }

  /**
   * Met la file en pause (true) pour une raison : plus rien ne s'affiche sauf
   * "critical" et les notifications des modules de `letThrough` ; celle
   * affichée retourne en file si elle ne passe pas. À la reprise (false), les
   * autres arrivent, sauf si une autre pause est encore en cours.
   */
  pause(on: boolean, reason = "presentation", letThrough: string[] = []) {
    if (on === this.pauses.has(reason)) return;
    if (on) this.pauses.set(reason, letThrough);
    else this.pauses.delete(reason);
    if (this.shown && !this.passes(this.shown)) {
      this.queue.unshift(this.shown);
      this.shown = null;
      this.clearTimer();
      this.onShow(null);
    } else if (!this.shown) {
      this.showNext();
    }
  }

  /** Une pause est-elle en cours (pour cette raison, ou pour n'importe laquelle) ? */
  isPaused(reason?: string): boolean {
    return reason ? this.pauses.has(reason) : this.pauses.size > 0;
  }

  /** Combien attendent (pour le résumé à la fin d'une présentation ou d'une concentration). */
  waiting(): number {
    return this.queue.length;
  }

  /** Ferme une notification (affichée ou en attente). */
  dismiss(id: number) {
    this.queue = this.queue.filter((q) => q.id !== id);
    if (this.shown?.id === id) {
      this.shown = null;
      this.clearTimer();
      this.showNext();
    }
  }

  /** Ferme celle qui est affichée (Échap, bouton ×). */
  dismissCurrent() {
    if (this.shown) this.dismiss(this.shown.id);
  }

  private showNext() {
    // En pause, seules passent les critiques et celles que la pause laisse passer.
    const i = this.queue.findIndex((q) => this.passes(q));
    this.shown = i >= 0 ? (this.queue.splice(i, 1)[0] ?? null) : null;
    if (this.shown && !this.shown.sticky) {
      const id = this.shown.id;
      this.timer = window.setTimeout(() => this.dismiss(id), this.shown.durationMs ?? this.defaultDurationMs);
    }
    this.onShow(this.shown);
  }

  /** Cette notification peut-elle s'afficher malgré les pauses en cours ? */
  private passes(n: IslandNotification): boolean {
    if (n.priority === "critical") return true;
    for (const letThrough of this.pauses.values()) {
      if (!letThrough.includes(n.moduleId)) return false;
    }
    return true;
  }

  private sort() {
    this.queue.sort((a, b) => RANK[b.priority] - RANK[a.priority] || a.createdAt - b.createdAt);
  }

  private clearTimer() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }
}
