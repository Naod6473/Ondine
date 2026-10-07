// Les vérifications de certains champs texte des réglages (`check` dans le
// manifeste d'un module). Elles ne refusent rien : elles écrivent un
// avertissement sous le champ, pour qu'une faute de frappe se voie tout de
// suite au lieu de rester sans effet.
//
//   "cities" : des villes séparées par des virgules (Système → Horloges du
//              monde) ; une ville inconnue ou en trop est signalée.
//
// Pur (aucun DOM) : testé dans tests/front/world-time.test.ts.

import type { FieldCheck } from "../core/module-types";
import { MAX_CLOCKS, parseCityList } from "../core/world-cities";

/** Les avertissements à montrer sous le champ (une ligne chacun), [] si tout va bien. */
export function fieldWarnings(check: FieldCheck, value: string): string[] {
  const lines: string[] = [];
  switch (check) {
    case "cities": {
      const { unknown, extra } = parseCityList(value);
      if (unknown.length === 1) lines.push(`Ville inconnue, ignorée : ${unknown[0]}`);
      else if (unknown.length > 1) lines.push(`Villes inconnues, ignorées : ${unknown.join(", ")}`);
      if (extra.length) lines.push(`${MAX_CLOCKS} villes au plus. En trop : ${extra.join(", ")}`);
      break;
    }
  }
  return lines;
}
