import { hideHalo, showHalo, updateHalo } from '../../island/halo';
import { speedLevel, speedRunning, type SpeedNews } from './speed-logic';
/** Le liseré de l'île pendant le test de débit (forme "speed" de halo.ts). */
const SPEED_HALO = "net-speed";

// ── Test de débit (1.2.3) : la dernière nouvelle, gardée si l'onglet se ferme ──
export let speed: SpeedNews | null = null;
export const speedViews = new Set<() => void>();

/** Une nouvelle du test : le liseré de l'île suit le débit, l'onglet se redessine. */
export function onSpeed(n: SpeedNews) {
  speed = n;
  if (speedRunning(n)) {
    const level = n.phase === "ping" ? 0.08 : speedLevel(n.mbps);
    if (n.phase === "ping" && (n.progress ?? 0) <= 0.03) showHalo({ id: SPEED_HALO, palette: "drop", shape: "speed", level, priority: "high" });
    else updateHalo(SPEED_HALO, { level });
  } else {
    hideHalo(SPEED_HALO);
    if (n.phase === "done") showHalo({ palette: "done", shape: "burst", durationMs: 1400, priority: "high" });
  }
  for (const v of speedViews) v();
}


export function setSpeed(next: SpeedNews) { speed = next; }
