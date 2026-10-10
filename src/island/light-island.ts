// L'île en verre clair (thème « Givre ») : la page relit ses feuilles de style
// et ajoute, juste après chaque règle qui a des couleurs, la même règle
// limitée au thème clair (calculs dans light-rules.ts). Fait une seule fois,
// à la première fois qu'un thème clair s'applique (quelques millisecondes) ;
// les règles ajoutées ne servent que sous `<html data-theme-tone="light">`,
// on les laisse donc en place quand on revient à un thème sombre.
//
// Pourquoi juste après l'originale : l'ordre et la spécificité restent ceux
// d'island.css (`:where` n'ajoute rien), donc une règle plus précise, ou
// écrite plus loin, garde le dessus exactement comme dans l'île sombre.
//
// Ce qui n'est pas retourné : les @keyframes (une lueur blanche animée reste
// blanche, elle passe vite), les couleurs posées en JS dans `style` (les
// modules utilisent des variables du thème), les dessins sur canvas (halo et
// liquide lisent eux-mêmes le fond de l'île, voir halo.ts et liquid.ts).

import "../styles/island-design.css";
import type { Settings } from "../core/types";
import { logger } from "../core/log";
import { lightRule, type Decl } from "./light-rules";
import { applyTheme, effectiveThemeId, themeFor } from "./themes";

const log = logger("island");

/** Les raccourcis qui peuvent porter des couleurs. */
const SHORTHANDS = ["background", "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "outline", "text-decoration"];

/** Les feuilles déjà passées (une feuille ajoutée plus tard, en dev, le sera à son tour). */
const done = new WeakSet<CSSStyleSheet>();

/** Ajoute les règles claires d'une liste de règles (en remontant : les index ne bougent pas). */
function scopeRules(list: CSSRuleList, insert: (text: string, index: number) => void): number {
  let added = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r instanceof CSSStyleRule) {
      const decls: Decl[] = [];
      for (let k = 0; k < r.style.length; k++) {
        const prop = r.style[k];
        const value = r.style.getPropertyValue(prop);
        if (value) decls.push({ prop, value, important: r.style.getPropertyPriority(prop) === "important" });
      }
      // Un raccourci qui contient var(…) ne se découpe pas : le navigateur le
      // garde entier (ses propriétés détaillées sont vides). On le lit tel quel.
      for (const prop of SHORTHANDS) {
        const value = r.style.getPropertyValue(prop);
        if (value.includes("var(")) decls.push({ prop, value, important: r.style.getPropertyPriority(prop) === "important" });
      }
      const text = lightRule(r.selectorText, decls);
      if (text) {
        try {
          insert(text, i + 1);
          added++;
        } catch {
          // Un sélecteur que le navigateur refuse une fois réécrit : on passe.
        }
      }
    } else if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule) {
      const g = r;
      added += scopeRules(g.cssRules, (t, at) => g.insertRule(t, at));
    }
  }
  return added;
}

/** Passe toutes les feuilles de la page qui ne l'ont pas encore été. */
function ensureLightRules() {
  const t0 = performance.now();
  let added = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    if (done.has(sheet)) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // une feuille d'ailleurs (illisible) : rien à faire
    }
    done.add(sheet);
    added += scopeRules(rules, (t, at) => sheet.insertRule(t, at));
  }
  if (added) log.debug(`île claire : ${added} règles ajoutées en ${Math.round(performance.now() - t0)} ms`);
}

/**
 * Applique le thème des réglages à la page de l'île (remplace l'appel direct
 * à applyTheme) : le style « Bouche d'Ondine » garde une île sombre, et un
 * thème clair prépare d'abord ses règles.
 */
export function applyIslandTheme(s: Settings) {
  const island = s.island as Settings["island"] & { style?: string };
  const id = effectiveThemeId(island.theme ?? "nuit", island.style);
  if (themeFor(id, island.color ?? "").light) ensureLightRules();
  applyTheme(id, island.color ?? "");
}
