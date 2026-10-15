// Les calculs du texte qui bouge dans Parler à Ondine, sans page ni horloge
// (testés par Node, tests/front/ask-flow.test.ts). Le dessin est dans flow.ts.
//
//   - vos mots en direct : quels mots restent (ne bougent pas), lesquels
//     arrivent (fondu doux) et lesquels le moteur a corrigés (fondu croisé) ;
//   - la réponse d'Ondine : le moment de chaque lettre (rythme régulier,
//     petites pauses après la ponctuation) et la fin du mot en cours, gardée
//     en place invisible pour qu'un mot ne saute pas à la ligne en s'écrivant.

/** Les mots d'un texte dit (séparés par des espaces). */
export function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Ce qui change entre deux sous-titres. */
export interface WordDiff {
  /** Les `keep` premiers mots sont les mêmes : ils ne bougent pas. */
  keep: number;
  /** Les anciens mots après `keep`, réécrits par le moteur (fondu croisé). */
  replaced: string[];
  /** Les nouveaux mots après `keep`. */
  added: string[];
}

/**
 * Compare les sous-titres d'avant et de maintenant, mot à mot depuis le
 * début. Le moteur ajoute d'habitude des mots à la fin ; parfois il réécrit
 * la fin de la phrase (« il » devient « île en »).
 */
export function diffWords(before: readonly string[], after: readonly string[]): WordDiff {
  let keep = 0;
  while (keep < before.length && keep < after.length && before[keep] === after[keep]) keep++;
  return { keep, replaced: before.slice(keep), added: after.slice(keep) };
}

/** Au-delà de ce nombre de caractères réécrits, pas de fondu croisé (trop long pour un bloc sur une ligne). */
export const CROSSFADE_MAX_CHARS = 48;

/** Une pause après la ponctuation (ms), comme quand on parle. */
export const PAUSES: Readonly<Record<string, number>> = { ".": 220, "!": 220, "?": 220, ",": 110, ";": 140, ":": 140, "\n": 160 };

/** La vitesse d'écriture (caractères par seconde) : ~55, plus vite pour un long texte (7 s au plus, hors pauses). */
export function revealSpeed(length: number): number {
  return Math.max(55, length / 7);
}

/**
 * `times[k]` : le moment (ms depuis le début) où `k` caractères sont
 * visibles. Un pas régulier par caractère, plus une pause après la
 * ponctuation (avant le caractère qui la suit). Une lettre par pas, jamais
 * par paquets ; `times[length]` : la fin.
 */
export function revealTimes(text: string, cps = revealSpeed(text.length)): number[] {
  const step = 1000 / cps;
  const out = new Array<number>(text.length + 1);
  out[0] = 0;
  for (let k = 1; k <= text.length; k++) out[k] = out[k - 1] + step + (k >= 2 ? PAUSES[text[k - 2]] ?? 0 : 0);
  return out;
}

/** Combien de caractères sont visibles à `elapsed` ms : le plus grand k tel que times[k] <= elapsed. */
export function shownAt(times: readonly number[], elapsed: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= elapsed) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * La fin du mot qui s'écrit : `n` caractères sont visibles, le reste du mot
 * (jusqu'à l'espace suivant) est gardé invisible à sa place.
 */
export function wordEnd(text: string, n: number): number {
  if (n <= 0 || n >= text.length) return Math.max(0, Math.min(n, text.length));
  // Entre deux mots : rien à garder.
  if (/\s/.test(text[n]) || /\s/.test(text[n - 1])) return n;
  const m = /\s/.exec(text.slice(n));
  return m ? n + m.index : text.length;
}
