// Contrôles : la logique sans DOM des pages « Applis » (volume de chaque
// appli), « Réseaux » (Wi-Fi à portée) et des boutons d'alimentation.
// Testée dans tests/front/orbix-ideas.test.ts.

/** Une appli du mélangeur (commande `app_volumes`). */
export interface AppVolume {
  key: string;
  name: string;
  volume: number;
  muted: boolean;
  active: boolean;
  peak: number;
}

/** Un réseau Wi-Fi à portée (commande `wifi_networks`). */
export interface WifiNetwork {
  ssid: string;
  signal: number;
  secure: boolean;
  known: boolean;
  connected: boolean;
}

/** Ce que renvoie `wifi_networks` : la liste, ou pourquoi elle manque. */
export type WifiAnswer = { networks: WifiNetwork[] } | { error: "location" | "no-adapter" | "failed"; message: string };

/** Les actions d'alimentation, dans l'ordre des boutons. */
export const POWER_ACTIONS = ["lock", "sleep", "restart", "shutdown"] as const;
export type PowerAction = (typeof POWER_ACTIONS)[number];

/** Le temps d'appui avant que l'action parte (ms). Lâcher avant annule. */
export const HOLD_MS = 1000;

export const POWER_NAMES: Record<PowerAction, string> = {
  lock: "Verrouiller",
  sleep: "Mettre en veille",
  restart: "Redémarrer",
  shutdown: "Éteindre",
};

/** Le message qui confirme l'action (le PC ne répond plus juste après). */
export const POWER_DONE: Record<PowerAction, string> = {
  lock: "PC verrouillé",
  sleep: "Mise en veille…",
  restart: "Redémarrage en cours…",
  shutdown: "Arrêt en cours…",
};

/** Qualité du signal (0 à 100) → nombre de barres allumées (1 à 4). */
export function wifiBars(signal: number): 1 | 2 | 3 | 4 {
  if (signal >= 75) return 4;
  if (signal >= 50) return 3;
  if (signal >= 25) return 2;
  return 1;
}

/** Ce qu'on dit d'un réseau sous son nom. */
export function wifiDetail(n: WifiNetwork): string {
  if (n.connected) return "Connecté";
  if (n.known) return "Connu : un clic pour s'y connecter";
  return n.secure ? "Nouveau réseau protégé" : "Nouveau réseau ouvert";
}

/**
 * Le niveau affiché d'une appli : il monte tout de suite et redescend en
 * douceur (comme un vumètre), pour que la barre ne clignote pas entre deux
 * lectures. `before` : ce qui était affiché ; `peak` : la nouvelle lecture.
 */
export function meterLevel(before: number, peak: number): number {
  const p = Math.max(0, Math.min(1, peak));
  return p >= before ? p : Math.max(p, before * 0.6);
}

/** La liste a-t-elle changé de forme (applis arrivées ou parties) ? Sinon on met à jour sur place. */
export function sameApps(a: AppVolume[], b: AppVolume[]): boolean {
  return a.length === b.length && a.every((x, i) => x.key === b[i].key && x.name === b[i].name);
}
