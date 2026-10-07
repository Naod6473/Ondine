// Petits textes du module Agents IA, sans DOM ni Tauri (testés dans
// tests/front/agents.test.ts) : le bilan de fin de tâche et « il y a 2 h ».

/** Le bilan d'une fin de tâche (src-tauri/src/modules/agents_git.rs). */
export interface ChangeSummary {
  files: number;
  added: number;
  removed: number;
  /** Les fichiers les plus changés, 3 au plus (sans leur dossier). */
  names: string[];
}

/** « 3 fichiers modifiés, +120 −14 » (« 1 fichier modifié, +5 −0 »). */
export function changesLine(c: ChangeSummary): string {
  const s = c.files > 1 ? "s" : "";
  return `${c.files} fichier${s} modifié${s}, +${c.added} −${c.removed}`;
}

/** « main.rs, index.ts, README.md… » (« … » : il y en a d'autres). */
export function namesLine(c: ChangeSummary): string {
  return c.names.join(", ") + (c.files > c.names.length ? "…" : "");
}

/** « à l'instant », « il y a 5 min », « il y a 2 h », « il y a 3 j », sinon la date. */
export function since(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 30 * 86_400) return `il y a ${Math.floor(s / 86_400)} j`;
  return new Date(ms).toLocaleDateString("fr-FR");
}
