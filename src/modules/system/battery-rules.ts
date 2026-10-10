// Les règles des halos de batterie (sans DOM, testées par tests/front/halo.test.ts).
// Le dessin est dans src/island/halo.ts, le branchement au bus dans battery-halo.ts.

export type ChargeHalo = "always" | "brief" | "never";

/** Les réglages du module Système qui touchent aux halos de batterie. */
export interface BatteryPrefs {
  chargeHalo: ChargeHalo;
  plug: boolean;
  unplug: boolean;
  full: boolean;
  low: boolean;
  critical: boolean;
  /** La notification « Batterie chargée » (ancien réglage, gardé). */
  fullAlert: boolean;
}

export function batteryPrefs(v: Record<string, unknown>): BatteryPrefs {
  const on = (key: string) => v[key] !== false;
  const charge = v.chargeHalo;
  return {
    chargeHalo: charge === "always" || charge === "never" ? charge : "brief",
    plug: on("haloPlug"),
    unplug: on("haloUnplug"),
    full: on("haloFull"),
    low: on("haloLow"),
    critical: on("haloCritical"),
    fullAlert: on("batteryFullAlert"),
  };
}

/** La vague du branchement seule (ms) ; puis « quelques secondes » d'aurore verte. */
export const PLUG_WAVE_MS = 2400;
export const BRIEF_CHARGE_MS = 7000;

/**
 * Combien de temps le halo vert reste au branchement : null = aucun halo,
 * 0 = tant que ça charge.
 */
export function chargeHaloMs(p: BatteryPrefs): number | null {
  if (p.chargeHalo === "always") return 0;
  if (p.chargeHalo === "brief") return BRIEF_CHARGE_MS;
  return p.plug ? PLUG_WAVE_MS : null;
}

/** La part du contour allumée pour un pourcentage (jamais moins qu'un petit bout visible). */
export function fillFor(percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(percent)) return 1;
  return Math.max(0.06, Math.min(1, percent / 100));
}
