// Agents IA : tant qu'une session « vous attend » et que l'île est en
// mini-île (état « compact »), la mascotte fait coucou toutes les deux
// minutes (« mascot.emote { emotion: "wave" } », écouté par
// src/mascot/mascot-state.ts). Rien pendant la concentration, rien si le
// réglage `remindWaiting` est coupé. Les rappels en notification (10 puis
// 30 min) viennent du Rust (agents_wait.rs).

import type { ModuleApi } from "../../core/module-types";

/** L'intervalle entre deux coucous. */
export const WAVE_EVERY_MS = 2 * 60_000;

/** Faut-il faire coucou maintenant ? (logique pure, testée) */
export function waveDue(input: { waiting: number; islandState: string; quiet: boolean; enabled: boolean; lastWave: number; now: number }): boolean {
  if (!input.enabled || input.quiet || input.waiting === 0 || input.islandState !== "compact") return false;
  return input.now - input.lastWave >= WAVE_EVERY_MS;
}

/** Branche la surveillance ; rend la fonction qui l'arrête. */
export function startWaitWatch(api: ModuleApi): () => void {
  let islandState = "hidden";
  let waiting = 0;
  let quiet = false;
  let lastWave = 0;
  const refresh = async () => {
    try {
      const data = await api.invoke<{ sessions: { state: string }[]; quiet: unknown } | null>("history");
      waiting = data?.sessions.filter((s) => s.state === "waiting").length ?? 0;
      quiet = !!data?.quiet;
    } catch {
      waiting = 0;
    }
  };
  const tick = () => {
    const now = Date.now();
    if (waveDue({ waiting, islandState, quiet, enabled: api.settings().remindWaiting !== false, lastWave, now })) {
      lastWave = now;
      api.emit("mascot.emote", { emotion: "wave" });
    }
  };
  const offState = api.on("island.state", (msg) => {
    islandState = String((msg.payload as { to?: string } | null)?.to ?? "hidden");
  });
  const offChanged = api.on("agents.changed", () => void refresh());
  const offQuiet = api.on("agents.quiet", () => void refresh());
  void refresh();
  const timer = window.setInterval(tick, 15_000);
  return () => {
    offState();
    offChanged();
    offQuiet();
    window.clearInterval(timer);
  };
}
