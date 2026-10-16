// La liste de tâches de l'agent en barre de progression (onglet Agents IA,
// 1.2.4) : la logique sans DOM, testée dans tests/front/agents.test.ts.
// Le Rust (src-tauri/src/modules/agents_todos.rs) comprend TodoWrite,
// TaskCreate / TaskUpdate / TaskList (Claude Code), update_plan (Codex) et
// write_todos (Gemini CLI), garde les listes en mémoire et ne donne ici que
// « fait / total » et la tâche en cours (120 caractères au plus).
// Idée reprise de CodeIsland (wxtsky, MIT), réécrite (voir THIRD-PARTY.md).

/** Le résumé d'une liste (champ `todos` d'une session, sujet « agents.todos »). */
export interface TodoSummary {
  done: number;
  total: number;
  /** La tâche en cours (sa forme « en train de »), s'il y en a une. */
  current?: string | null;
}

/** La barre d'une session : « 3/7 », la largeur remplie (0 à 100) et le texte à côté. */
export function todoBar(t: TodoSummary | null | undefined): { label: string; pct: number; text: string; finished: boolean } | null {
  if (!t || !Number.isFinite(t.total) || t.total <= 0) return null;
  const done = Math.max(0, Math.min(t.total, Math.floor(t.done) || 0));
  const total = Math.floor(t.total);
  const finished = done >= total;
  return {
    label: `${done}/${total}`,
    pct: Math.round((done / total) * 100),
    text: (t.current ?? "").trim(),
    finished,
  };
}

/**
 * Le liseré de l'île pour la session active : la part faite (0 à 1), ou null
 * pour l'éteindre (liste vide ou toutes les tâches faites). Un minimum visible
 * dès qu'une liste existe (0 sur 7 = un petit bout).
 */
export function todoFill(p: { done?: unknown; total?: unknown } | null | undefined): number | null {
  const total = typeof p?.total === "number" ? p.total : 0;
  const done = typeof p?.done === "number" ? p.done : 0;
  if (!(total > 0) || done >= total) return null;
  return Math.max(0.04, Math.min(1, done / total));
}
