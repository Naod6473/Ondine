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
//   - en pause (mode présentation), seules les "critical" s'affichent ; les
//     autres attendent la fin de la pause.

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
  private paused = false;

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
   * Met la file en pause (true) : plus rien ne s'affiche sauf "critical", et
   * celle affichée retourne en file. À la reprise (false), elles arrivent.
   */
  pause(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    if (on && this.shown && this.shown.priority !== "critical") {
      this.queue.unshift(this.shown);
      this.shown = null;
      this.clearTimer();
      this.onShow(null);
    } else if (!on && !this.shown) {
      this.showNext();
    }
  }

  /** Combien attendent (pour le résumé à la fin d'une présentation). */
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
    // En pause, seules les critiques passent.
    const i = this.paused ? this.queue.findIndex((q) => q.priority === "critical") : 0;
    this.shown = i >= 0 ? (this.queue.splice(i, 1)[0] ?? null) : null;
    if (this.shown && !this.shown.sticky) {
      const id = this.shown.id;
      this.timer = window.setTimeout(() => this.dismiss(id), this.shown.durationMs ?? this.defaultDurationMs);
    }
    this.onShow(this.shown);
  }

  private sort() {
    this.queue.sort((a, b) => RANK[b.priority] - RANK[a.priority] || a.createdAt - b.createdAt);
  }

  private clearTimer() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }
}
