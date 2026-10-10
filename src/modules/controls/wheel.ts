// La molette sur l'île règle le volume (1.2.3) : l'île compte les crans et
// publie `island.wheel {delta}` (src/island/volume-wheel.ts) ; ici, le volume
// des haut-parleurs par défaut change, puis `controls.volume` dit le niveau à
// l'île (sa petite capsule). Un seul envoi au Rust à la fois : les crans
// arrivés pendant ce temps s'additionnent et partent ensemble.

import type { ModuleApi } from "../../core/module-types";
import { nextVolume } from "../../island/wheel-volume";

interface Level {
  volume: number;
  muted: boolean;
}

export function wireWheelVolume(api: ModuleApi): () => void {
  let pending = 0;
  let busy = false;
  /** Le dernier niveau connu (relu au premier cran, puis tenu ici pendant la rafale). */
  let known: Level | null = null;
  let knownAt = 0;

  const flush = async () => {
    if (busy || pending === 0) return;
    busy = true;
    try {
      while (pending !== 0) {
        const delta = pending;
        pending = 0;
        // Relu si on ne l'a pas vu depuis un moment (les touches du clavier, une autre appli).
        if (!known || performance.now() - knownAt > 1500) {
          const s = await api.invoke<{ speakers: Level | null }>("state");
          if (!s.speakers) return;
          known = s.speakers;
        }
        const next = nextVolume(known.volume, known.muted, delta);
        if (known.muted && !next.muted) await api.invoke("set_muted", { device: "speakers", muted: false });
        if (next.volume !== known.volume) await api.invoke("set_volume", { device: "speakers", volume: next.volume });
        known = next;
        knownAt = performance.now();
        api.emit("controls.volume", { volume: next.volume, muted: next.muted, source: "wheel" });
      }
    } catch (err) {
      known = null;
      api.log.warn(`volume à la molette impossible : ${String(err)}`);
    } finally {
      busy = false;
      pending = 0;
    }
  };

  return api.on("island.wheel", (msg) => {
    if (api.settings().wheelVolume === false) return;
    const d = Number((msg.payload as { delta?: number } | null)?.delta);
    if (!Number.isFinite(d) || d === 0) return;
    pending += Math.max(-20, Math.min(20, Math.round(d)));
    void flush();
  });
}
