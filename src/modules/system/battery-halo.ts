// Les halos de batterie autour de l'île, et leurs notifications.
//
//   branché      une vague menthe → émeraude → cyan part de la prise (à gauche)
//                et remplit le contour jusqu'au niveau de charge, « En charge · 56 % » ;
//                puis le halo vert reste (réglage « Halo pendant la charge » :
//                toujours / quelques secondes / jamais)
//   chargée      un éclat vert et doré avec des étincelles, « Batterie chargée »
//   débranché    un bref balayage blanc, « Sur batterie · 82 % »
//   faible       des vagues orange quelques secondes, puis une petite braise
//                orange reste au bord de l'île jusqu'au branchement ; Ondine bâille
//   critique     des vagues rouges qui battent vite comme un cœur, jusqu'au
//                branchement ou à « Compris » ; Ondine panique, puis est
//                soulagée quand on branche le chargeur
//
// Les événements viennent du Rust (src-tauri/src/modules/system.rs) : rien
// n'arrive sur un PC fixe. Chaque halo peut être coupé dans les réglages du
// module ; « Animations de l'île » coupe tous les halos d'un coup.

import type { ModuleApi } from "../../core/module-types";
import { hideHalo, showHalo, updateHalo, haloShown } from "../../island/halo";
import { calmMode } from "../../mascot/mascot-state";
import { batteryPrefs, chargeHaloMs, fillFor, PLUG_WAVE_MS } from "./battery-rules";

interface BatteryState {
  percent: number | null;
  charging: boolean;
  plugged: boolean;
}

const CHARGE = "battery-charge";
const LOW = "battery-low";
const EMBER = "battery-ember";
const CRITICAL = "battery-critical";

/** Branche les halos de batterie ; renvoie de quoi tout arrêter. */
export function watchBattery(api: ModuleApi): () => void {
  const prefs = () => batteryPrefs(api.settings());
  /** La batterie est critique (Ondine panique tant que ça dure). */
  let critical = false;
  let panicTimer = 0;
  let chargeTimer = 0;

  const emote = (emotion: string) => {
    if (!calmMode()) api.emit("mascot.emote", { emotion });
  };
  const stopPanic = () => {
    critical = false;
    window.clearInterval(panicTimer);
    panicTimer = 0;
    hideHalo(CRITICAL);
  };
  /** Le halo vert de la charge, depuis la prise (à gauche), jusqu'au niveau. */
  const showCharge = (percent: number | null) => {
    const ms = chargeHaloMs(prefs());
    if (ms == null) return;
    showHalo({ id: CHARGE, palette: "charge", shape: "sweep", from: "left", fill: fillFor(percent), rhythm: "calm", durationMs: ms });
    // « Toujours » : le niveau suit la charge (relu chaque minute, c'est très léger).
    window.clearInterval(chargeTimer);
    if (ms === 0) {
      chargeTimer = window.setInterval(async () => {
        if (!haloShown(CHARGE)) return window.clearInterval(chargeTimer);
        const b = await api.invoke<BatteryState | null>("battery").catch(() => null);
        if (b?.plugged) updateHalo(CHARGE, { fill: fillFor(b.percent) });
      }, 60_000);
    }
  };

  const offPlug = api.on("system.battery-plug", (msg) => {
    const p = (msg.payload ?? {}) as { plugged?: boolean; percent?: number; charging?: boolean };
    const pct = typeof p.percent === "number" ? p.percent : null;
    const pr = prefs();
    if (p.plugged) {
      // Ouf : plus de panique, plus de braise.
      const wasWorried = critical || haloShown(LOW) || haloShown(EMBER);
      stopPanic();
      hideHalo(LOW);
      hideHalo(EMBER);
      if (wasWorried) emote("relieved");
      if (pr.plug || pr.chargeHalo === "always") showCharge(pct);
      api.notify({ title: pct != null ? `En charge · ${pct} %` : "En charge", icon: "🔌", priority: "low", key: "battery", durationMs: PLUG_WAVE_MS });
    } else {
      hideHalo(CHARGE);
      window.clearInterval(chargeTimer);
      if (pr.unplug) showHalo({ id: "battery-unplug", palette: "white", shape: "sweep", from: "center", rhythm: "fast", durationMs: 1100 });
      api.notify({ title: pct != null ? `Sur batterie · ${pct} %` : "Sur batterie", icon: "🔋", priority: "low", key: "battery", durationMs: PLUG_WAVE_MS });
    }
  });

  const offLow = api.on("system.battery-low", (msg) => {
    const p = (msg.payload ?? {}) as { percent?: number };
    api.notify({ title: "Batterie faible", body: `Plus que ${p.percent ?? "?"} % : pensez à brancher le chargeur.`, icon: "🪫", priority: "normal", key: "battery" });
    if (!prefs().low) return;
    showHalo({ id: LOW, palette: "low", shape: "waves", rhythm: "medium", durationMs: 8000 });
    // Puis une petite braise reste au bord de l'île jusqu'au branchement.
    showHalo({ id: EMBER, palette: "low", shape: "cocoon", fill: 0.14, from: "left", priority: "low" });
    emote("yawn");
  });

  const offCritical = api.on("system.battery-critical", (msg) => {
    const p = (msg.payload ?? {}) as { percent?: number };
    hideHalo(LOW);
    api.notify({
      title: "Batterie critique",
      body: `Plus que ${p.percent ?? "?"} % : branchez le chargeur maintenant.`,
      icon: "🪫",
      priority: "high",
      sticky: true,
      key: "battery",
      actions: [{ label: "Compris", run: () => stopPanic() }],
    });
    if (!prefs().critical) return;
    critical = true;
    showHalo({ id: CRITICAL, palette: "critical", shape: "waves", rhythm: "heartbeat", priority: "high" });
    showHalo({ id: EMBER, palette: "critical", shape: "cocoon", fill: 0.14, from: "left", priority: "low" });
    emote("panic");
    // Elle panique de nouveau de temps en temps, tant que ça dure.
    window.clearInterval(panicTimer);
    panicTimer = window.setInterval(() => critical && emote("panic"), 45_000);
  });

  const offFull = api.on("system.battery-full", () => {
    const pr = prefs();
    if (pr.fullAlert) api.notify({ title: "Batterie chargée", body: "Vous pouvez débrancher le chargeur.", icon: "🔋", priority: "low", key: "battery" });
    if (!pr.full) return;
    hideHalo(CHARGE);
    window.clearInterval(chargeTimer);
    showHalo({ id: "battery-full", palette: "full", shape: "burst", durationMs: 2800 });
  });

  // Au démarrage, déjà en charge avec « Toujours » : le halo vert tout de suite.
  void api
    .invoke<BatteryState | null>("battery")
    .then((b) => {
      if (b?.plugged && b.charging && prefs().chargeHalo === "always") showCharge(b.percent);
    })
    .catch(() => undefined);

  return () => {
    for (const off of [offPlug, offLow, offCritical, offFull]) off();
    stopPanic();
    window.clearInterval(chargeTimer);
    for (const id of [CHARGE, LOW, EMBER]) hideHalo(id);
  };
}
