// Les règles des astuces d'onglet (tips.ts), sans DOM : testées dans
// tests/front/tips.test.ts.

/** Le réglage garde au plus ce nombre d'onglets (comme le Rust, settings.rs). */
export const MAX_TIPS_SEEN = 64;

/** Les réglages qui comptent pour les astuces (island.tips, island.tipsSeen). */
export interface TipPrefs {
  tips?: boolean;
  tipsSeen?: string[];
}

/** Faut-il montrer l'astuce de cet onglet ? Jamais en mode démo, ni réglage coupé, ni déjà vue. */
export function tipWanted(id: string, tip: string | undefined, prefs: TipPrefs, demo: boolean): boolean {
  return !!tip?.trim() && prefs.tips !== false && !demo && !(prefs.tipsSeen ?? []).includes(id);
}

/** La liste des onglets vus, avec `id` en plus (sans doublon, MAX_TIPS_SEEN au plus). */
export function withSeen(seen: string[], id: string): string[] {
  return seen.includes(id) ? seen : [...seen, id].slice(-MAX_TIPS_SEEN);
}
