// Les fichiers modifiés en direct (onglet Agents IA, 1.2.4) : la logique sans
// DOM, testée dans tests/front/extras.test.ts. La vue est dans live-view.ts ;
// le calcul de +N −M et des lignes dans src-tauri/src/modules/agents_live.rs.

/** Un fichier modifié par un agent (commande « live »). */
export interface LiveFile {
  id: number;
  session: string;
  source: string;
  name: string;
  folder: string;
  added: number;
  removed: number;
  at: number;
  isNew: boolean;
  tooLarge: boolean;
}

/** Le changement d'un fichier (commande « live_diff ») : lignes [genre, texte]. */
export interface LiveDiff extends LiveFile {
  lines: [string, string][];
  cut: boolean;
}

/** « +12 −3 » (le signe moins typographique), « +40 » pour un fichier nouveau. */
export function liveCounts(f: Pick<LiveFile, "added" | "removed">): { plus: string; minus: string } {
  return { plus: f.added > 0 ? `+${f.added}` : "", minus: f.removed > 0 ? `−${f.removed}` : "" };
}

/** Les fichiers d'une session, les plus récents d'abord, 6 au plus (et combien de plus). */
export function filesOf(all: LiveFile[], session: string, max = 6): { shown: LiveFile[]; more: number } {
  const mine = all.filter((f) => f.session === session).sort((a, b) => b.at - a.at);
  return { shown: mine.slice(0, max), more: Math.max(0, mine.length - max) };
}

/** Le symbole affiché devant une ligne du changement. */
export function lineSymbol(kind: string): string {
  return kind === "+" ? "+" : kind === "-" ? "−" : kind === "~" ? "⋯" : " ";
}

/** La classe CSS d'une ligne. */
export function lineClass(kind: string): string {
  return kind === "+" ? "added" : kind === "-" ? "removed" : kind === "~" ? "gap" : "context";
}
