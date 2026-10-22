// Système : le débit réseau en direct (1.2.5, idée d'Orbix). Le Rust compte
// les octets reçus et envoyés par les cartes réseau (jamais le contenu) ;
// ici, le texte (« 4,2 Mo/s ») et la règle de la mini-île (réglage netCompact).
// Testé dans tests/front/system-net-rate.test.ts.

/** Au-dessus de ce débit (reçu ou envoyé), la mini-île montre le débit. */
export const COMPACT_FROM = 1024 * 1024;
/** Elle le garde encore ce temps après être repassée en dessous (pas de clignotement). */
export const COMPACT_KEEP_MS = 6000;

/** Les unités (traduites à part : « Mo/s » → « MB/s », src/core/i18n-en.json). */
export type RateUnit = "o/s" | "ko/s" | "Mo/s" | "Go/s";

/** Octets par seconde → le nombre et l'unité : (« 4,2 », « Mo/s »). */
export function rateParts(bytesPerSec: number): { num: string; unit: RateUnit } {
  const b = Number.isFinite(bytesPerSec) && bytesPerSec > 0 ? bytesPerSec : 0;
  const fmt = (n: number, digits: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
  if (b < 1024) return { num: String(Math.round(b)), unit: "o/s" };
  if (b < 1024 ** 2) return { num: fmt(b / 1024, 0), unit: "ko/s" };
  if (b < 1024 ** 3) return { num: fmt(b / 1024 ** 2, b < 10 * 1024 ** 2 ? 1 : 0), unit: "Mo/s" };
  return { num: fmt(b / 1024 ** 3, 1), unit: "Go/s" };
}

/** Octets par seconde → « 820 o/s », « 85 ko/s », « 4,2 Mo/s », « 1,1 Go/s ». */
export function rateText(bytesPerSec: number): string {
  const p = rateParts(bytesPerSec);
  return `${p.num} ${p.unit}`;
}

/** « ↓ 4,2 Mo/s · ↑ 85 ko/s ». */
export function rateLine(down: number, up: number): string {
  return `↓ ${rateText(down)} · ↑ ${rateText(up)}`;
}

/**
 * La même ligne en morceaux pour l'interface : les nombres ne se traduisent
 * pas (data-no-i18n), les unités si (« Mo/s » → « MB/s »).
 */
export function rateNodes(down: number, up: number): Node[] {
  const part = (arrow: string, v: number) => {
    const p = rateParts(v);
    const num = document.createElement("span");
    num.dataset.noI18n = "";
    num.textContent = `${arrow} ${p.num}`;
    const unit = document.createElement("span");
    unit.textContent = p.unit;
    return [num, document.createTextNode(" "), unit];
  };
  return [...part("↓", down), document.createTextNode(" · "), ...part("↑", up)];
}

/**
 * La mini-île montre-t-elle le débit ? Oui dès qu'un sens dépasse
 * COMPACT_FROM ; non COMPACT_KEEP_MS après être repassé en dessous.
 */
export class CompactRate {
  private lastBusy = -Infinity;

  /** Une nouvelle mesure (à `now` ms) ; renvoie s'il faut montrer le débit. */
  push(down: number, up: number, now: number): boolean {
    if (down >= COMPACT_FROM || up >= COMPACT_FROM) this.lastBusy = now;
    return this.shown(now);
  }

  shown(now: number): boolean {
    return now - this.lastBusy < COMPACT_KEEP_MS;
  }

  reset() {
    this.lastBusy = -Infinity;
  }
}
