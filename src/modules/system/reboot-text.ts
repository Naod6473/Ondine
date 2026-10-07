// « Redémarrage en attente » (module Système) : les textes et la règle du
// rappel. Sans DOM ni Tauri, pour les tests (tests/front/reboot.test.ts).

/** Ce que le Rust répond (commande `reboot`, voir src-tauri/src/platform/reboot.rs). */
export interface RebootState {
  pending: boolean;
  /** Depuis quand (secondes depuis 1970) ; 0 = inconnu. */
  sinceSecs: number;
  /** « updates » (Windows Update) et/ou « servicing » (composants de Windows). */
  reasons: string[];
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Depuis quand on attend (secondes depuis 1970) : la date de Windows, sinon la première fois qu'on l'a vu. */
export function pendingSince(state: RebootState, firstSeenSecs: number, nowSecs: number): number {
  return state.sinceSecs > 0 && state.sinceSecs <= nowSecs ? state.sinceSecs : firstSeenSecs;
}

/** « Redémarrage en attente depuis 3 jours » (5 h, moins d'une heure ; sans date : « Redémarrage en attente »). */
export function pendingText(sinceSecs: number, nowSecs: number): string {
  if (!sinceSecs || sinceSecs > nowSecs) return "Redémarrage en attente";
  const secs = nowSecs - sinceSecs;
  const days = Math.floor(secs / DAY);
  if (days >= 2) return `Redémarrage en attente depuis ${days} jours`;
  if (days === 1) return "Redémarrage en attente depuis 1 jour";
  const hours = Math.floor(secs / HOUR);
  if (hours >= 1) return `Redémarrage en attente depuis ${hours} h`;
  return "Redémarrage en attente depuis moins d'une heure";
}

/** Pourquoi Windows attend : « (mises à jour de Windows) » ou « (composants de Windows) ». */
export function reasonText(reasons: string[]): string {
  return reasons.includes("updates") ? "(mises à jour de Windows)" : "(composants de Windows)";
}

/**
 * Faut-il rappeler le redémarrage maintenant ? Un rappel doux : seulement si
 * le réglage est coché, après un jour d'attente, au plus une fois par jour,
 * et jamais pendant un appel (micro utilisé) ni une présentation.
 */
export function shouldRemind(o: {
  enabled: boolean;
  state: RebootState;
  firstSeenSecs: number;
  nowSecs: number;
  /** Le dernier rappel (secondes depuis 1970), 0 = jamais. */
  lastRemindedSecs: number;
  micInUse: boolean;
  presenting: boolean;
}): boolean {
  if (!o.enabled || !o.state.pending) return false;
  const since = pendingSince(o.state, o.firstSeenSecs, o.nowSecs);
  if (!since || o.nowSecs - since < DAY) return false;
  if (o.lastRemindedSecs > 0 && o.nowSecs - o.lastRemindedSecs < DAY) return false;
  return !o.micInUse && !o.presenting;
}
