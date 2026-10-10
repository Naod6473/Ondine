// Le test de débit du module Réseau (1.2.3) : petits calculs sans DOM, testés
// par tests/front/speed.test.ts. Le test lui-même tourne dans le Rust
// (src-tauri/src/modules/nettools_speed.rs), qui publie « nettools.speed ».

/** Une nouvelle du test (« nettools.speed »). */
export interface SpeedNews {
  phase: "ping" | "down" | "up" | "done" | "error" | "stopped";
  /** Débit du moment (Mbit/s), pendant « down » et « up ». */
  mbps?: number;
  /** Latence (ms), une fois mesurée. */
  ping?: number;
  /** Avancement de tout le test, 0 à 1. */
  progress?: number;
  /** Fin : débits moyens (Mbit/s). */
  down?: number;
  up?: number;
  server?: string;
  error?: string;
}

/** Ce qu'on fait en ce moment, pour l'écran. */
export const PHASE_LABEL: Record<string, string> = {
  ping: "Mesure de la latence…",
  down: "Réception…",
  up: "Envoi…",
};

/** Le test tourne-t-il encore d'après cette nouvelle ? */
export function speedRunning(n: SpeedNews | null): boolean {
  return !!n && (n.phase === "ping" || n.phase === "down" || n.phase === "up");
}

/**
 * Le débit ramené à 0..1 pour le liseré de l'île (échelle logarithmique :
 * 1 Mbit/s → 0, 10 → 0,33, 100 → 0,67, 1 000 et plus → 1). Le liseré tourne et
 * pulse d'autant plus vite (speedLapMs, speedBeatMs dans halo-palettes.ts).
 */
export function speedLevel(mbps: number | undefined): number {
  if (!mbps || !Number.isFinite(mbps) || mbps <= 1) return 0;
  return Math.min(1, Math.log10(mbps) / 3);
}

/** « 245 Mbit/s », « 12,5 Mbit/s », « 1,2 Gbit/s ». */
export function mbpsText(mbps: number | undefined): string {
  const v = mbps && Number.isFinite(mbps) && mbps > 0 ? mbps : 0;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")} Gbit/s`;
  if (v >= 100) return `${Math.round(v)} Mbit/s`;
  return `${v.toFixed(1).replace(".", ",")} Mbit/s`;
}

/** Ce que permet ce débit de réception, en une phrase. */
export function speedVerdict(down: number | undefined): string {
  const d = down ?? 0;
  if (d >= 100) return "Très rapide : tout passe, même plusieurs vidéos 4K à la fois.";
  if (d >= 25) return "Rapide : visio en HD et vidéo 4K sans souci.";
  if (d >= 8) return "Correct : visio et vidéo HD.";
  if (d >= 2) return "Lent : la visio peut saccader.";
  return "Très lent : seulement les pages simples et les messages.";
}
