// La recherche du lanceur : on note chaque entrée selon sa ressemblance avec
// ce qui est tapé, sans tenir compte des majuscules ni des accents.
//   « fire »  → Firefox (le nom commence par ça)
//   « code »  → Visual Studio Code (un mot commence par ça)
//   « gdp »   → Gestionnaire de périphériques (les initiales)
//   « fox »   → Firefox (contenu dans le nom)
//   « ffx »   → Firefox (lettres dans l'ordre, en dernier recours)

/** « Éditeur du Registre » → « editeur du registre ». */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Note de 0 (aucun rapport) à 100 (le nom commence par la recherche). */
export function score(name: string, query: string): number {
  const n = normalize(name);
  const q = normalize(query);
  if (!q) return 1;
  if (n.startsWith(q)) return 100 - Math.min(20, n.length - q.length) / 2;
  const words = n.split(/[\s\-_.()]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 80;
  // Plusieurs mots tapés : chacun doit commencer un mot du nom (« ges per »).
  const parts = q.split(/\s+/);
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 75;
  if (q.length >= 2 && words.map((w) => w[0]).join("").startsWith(q)) return 70;
  if (n.includes(q)) return 60;
  // Les lettres dans l'ordre, pas forcément collées.
  let i = 0;
  for (const c of n) if (c === q[i]) i++;
  return i === q.length && q.length >= 2 ? 30 : 0;
}
