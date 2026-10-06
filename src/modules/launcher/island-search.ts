// « Recherche dans l'île » : ce que le Lanceur trouve dans les données de
// l'île elle-même, en plus des applis et des fichiers récents.
//
// Le Rust (commande "search" du Lanceur) demande à chaque module de chercher
// dans ses propres données — Notes, Presse-papiers, Étagère, Capture — et
// renvoie au plus 5 résultats par module, déjà triés. Ici, on transforme ces
// résultats en lignes du Lanceur, une section par module, chacune avec son
// action naturelle :
//   - une note ou une tâche → l'onglet Notes s'ouvre dessus ;
//   - une copie ou un snippet → recopié dans le presse-papiers ;
//   - un élément de l'étagère → ouvert (un programme est seulement montré
//     dans l'Explorateur) ;
//   - une capture → ouverte ; le dernier texte lu → recopié.

import type { ModuleApi } from "../../core/module-types";

/** Un résultat tel que le module l'a renvoyé. */
export interface FoundItem {
  kind: string;
  id?: number;
  path?: string;
  name?: string;
  title: string;
  detail?: string;
  done?: boolean;
  pinned?: boolean;
  at?: number;
}

/** Les résultats d'un module. */
export interface FoundGroup {
  source: "notes" | "clipboard" | "shelf" | "capture";
  items: FoundItem[];
}

/** Une ligne du Lanceur venue de la recherche dans l'île. */
export interface FoundRow {
  key: string;
  name: string;
  detail: string;
  icon: string;
  tag: string;
  /** Une tâche déjà faite (texte barré). */
  done: boolean;
  run: () => unknown;
}

/** Le titre de chaque section, dans l'ordre où le Rust les renvoie. */
export const SECTIONS: Record<FoundGroup["source"], { icon: string; label: string }> = {
  notes: { icon: "📝", label: "Notes et tâches" },
  clipboard: { icon: "📋", label: "Presse-papiers" },
  shelf: { icon: "🧺", label: "Étagère" },
  capture: { icon: "✂️", label: "Captures" },
};

/** Moins de 2 lettres : on ne cherche pas dans l'île (trop de résultats). */
export const MIN_QUERY = 2;

/** Demande au Rust ce qui correspond à `query`. */
export async function searchIsland(api: ModuleApi, query: string): Promise<FoundGroup[]> {
  if (query.trim().length < MIN_QUERY) return [];
  const r = await api.invoke<{ groups?: FoundGroup[] }>("search", { query });
  return Array.isArray(r?.groups) ? r.groups.filter((g) => g.source in SECTIONS && Array.isArray(g.items)) : [];
}

/** « il y a 5 min », « hier », sinon la date. */
function ago(ms: number | undefined): string {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 2 * 86400) return "hier";
  return new Date(ms).toLocaleDateString("fr-FR");
}

/** Les lignes d'une section, avec leur action. */
export function rowsOf(api: ModuleApi, group: FoundGroup): FoundRow[] {
  const close = () => api.closeIsland();
  // Les actions qui passent par le Rust (recopier, ouvrir un fichier).
  const open = (it: FoundItem) => api.invoke<{ revealed?: boolean } | null>("open_found", { source: group.source, kind: it.kind, id: it.id, path: it.path, name: it.name });

  return group.items.map((it, i): FoundRow => {
    const key = `found-${group.source}-${it.kind}-${it.id ?? it.path ?? it.name ?? i}`;
    const base = { key, name: it.title, detail: it.detail ?? "", done: false };
    switch (group.source) {
      case "notes":
        return {
          ...base,
          icon: it.kind === "todo" ? (it.done ? "☑️" : "✅") : "📝",
          tag: it.kind === "todo" ? "Tâche" : "Note",
          detail: it.kind === "todo" ? (it.done ? "Faite" : "À faire") : base.detail,
          done: it.kind === "todo" && it.done === true,
          // L'onglet Notes écoute « notes.open » : il s'ouvre sur cette note ou cette tâche.
          run: () => {
            api.emit("notes.open", { kind: it.kind, id: it.id });
            api.openIsland("notes");
          },
        };
      case "clipboard":
        return {
          ...base,
          icon: it.kind === "snippet" ? "🔖" : it.pinned ? "📌" : "📋",
          tag: it.kind === "snippet" ? "Snippet" : "Copie",
          detail: it.kind === "snippet" ? base.detail : ago(it.at),
          run: async () => {
            await open(it);
            api.notify({ title: "Copié", body: "Recopié dans le presse-papiers", icon: "📋", priority: "low", key: "launcher-copied" });
            close();
          },
        };
      case "shelf":
        return {
          ...base,
          icon: it.kind === "dir" ? "📁" : "📄",
          tag: "Étagère",
          run: async () => {
            const r = await open(it);
            if (r?.revealed) {
              api.notify({ title: "Programme montré dans l'Explorateur", body: "Il n'est pas lancé depuis l'île.", icon: "🧺", priority: "low", key: "launcher-revealed" });
            }
            close();
          },
        };
      case "capture":
        return {
          ...base,
          icon: it.kind === "text" ? "🔤" : "🖼️",
          tag: "Capture",
          run: async () => {
            await open(it);
            if (it.kind === "text") {
              api.notify({ title: "Copié", body: "Le texte lu est dans le presse-papiers", icon: "📋", priority: "low", key: "launcher-copied" });
            }
            close();
          },
        };
    }
  });
}
