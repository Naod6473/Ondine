// Les textes du trou noir (module « Ondine et les fenêtres »), en code pur
// testé (tests/front/windowlife.test.ts) : rien ne s'affiche quand il est
// vide, et le nombre de fenêtres s'accorde.

/** Le trou noir a-t-il quelque chose à montrer (mini-île, carte de l'Accueil) ? */
export function holeShown(count: number): boolean {
  return count > 0;
}

/** La ligne sous le nombre : « fenêtre avalée », « fenêtres avalées ». */
export function holeCountText(count: number): string {
  return count > 1 ? "fenêtres avalées" : "fenêtre avalée";
}

/** Le morceau de la phrase d'Ondine sur l'Accueil (minuscules, sans point). */
export function holePhrase(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "une fenêtre dans le trou noir" : `${count} fenêtres dans le trou noir`;
}
