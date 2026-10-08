// Agents IA : le bilan de fin de tâche cliquable. « 3 fichiers modifiés,
// +120 −14 » → la liste des fichiers changés du dépôt (commande
// « report_files », git en lecture seule, 20 au plus), dans un panneau de
// l'onglet, avec pour chaque fichier « Ouvrir » (VS Code sur ce fichier dans
// le dossier : `code <dossier> -g <fichier>`) et « Diff » (`code --diff` entre
// la version validée, copiée dans un fichier temporaire, et le fichier
// actuel). Tout n'agit que sur votre clic.

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { fileCounts, type FileChange } from "./tools";

/** Le bilan à détailler : le dossier de la session, et le titre de la notification. */
export interface ReportRequest {
  dir: string;
  title: string;
  /** VS Code est installé (le Rust l'a vu au moment du bilan). */
  vscode: boolean;
}

/** Ce que l'onglet veut montrer en s'ouvrant (posé par la notification, lu par la vue). */
let pending: ReportRequest | null = null;

/** La notification « a fini · bilan » demande la liste : l'île s'ouvre sur l'onglet. */
export function requestFiles(api: ModuleApi, req: ReportRequest) {
  pending = req;
  api.openIsland("agents");
  listeners.forEach((l) => l());
}

/** La vue de l'onglet écoute : une demande arrive pendant qu'elle est ouverte. */
const listeners = new Set<() => void>();

/** Ouvre VS Code sur un fichier du dépôt (ou sa comparaison avec HEAD). */
async function openFile(api: ModuleApi, dir: string, file: string, diff: boolean) {
  try {
    await api.invoke("open_vscode_file", { dir, file, diff });
  } catch (err) {
    api.notify({ title: "VS Code", body: errorText(err), icon: "⚠️", priority: "low", key: "agents-error" });
  }
}

/**
 * Branche le panneau des fichiers sur `box` (vide tant qu'aucun bilan n'est
 * demandé). Rend la fonction qui le débranche.
 */
export function mountFilesPanel(api: ModuleApi, box: HTMLElement): () => void {
  const draw = async () => {
    const req = pending;
    if (!req) return box.replaceChildren();
    pending = null;
    const close = el("button", { class: "btn small", title: "Fermer la liste", onclick: api.handler(() => box.replaceChildren()) }, "✕");
    box.replaceChildren(el("div", { class: "agents-files-head" }, el("b", {}, req.title), close), el("p", { class: "muted" }, "Lecture du dépôt…"));
    let files: FileChange[];
    const vscode = req.vscode;
    try {
      const r = await api.invoke<{ root: string; files: FileChange[] }>("report_files", { path: req.dir });
      files = r.files;
    } catch (err) {
      return box.replaceChildren(el("div", { class: "agents-files-head" }, el("b", {}, req.title), close), el("p", { class: "muted" }, errorText(err)));
    }
    const rows = files.map((f) =>
      el(
        "li",
        { class: `agents-file${f.exists ? "" : " gone"}` },
        // Le chemin vient de git (un nom de fichier) : jamais traduit.
        el("code", { "data-no-i18n": true }, f.path),
        el("small", { class: "muted" }, fileCounts(f)),
        f.exists && vscode ? el("button", { class: "btn small", title: "Ouvrir ce fichier dans VS Code", onclick: api.handler(() => openFile(api, req.dir, f.path, false)) }, "Ouvrir") : null,
        f.exists && vscode && !f.untracked
          ? el("button", { class: "btn small", title: "Comparer avec la version validée (VS Code)", onclick: api.handler(() => openFile(api, req.dir, f.path, true)) }, "Diff")
          : null,
      ),
    );
    box.replaceChildren(
      el("div", { class: "agents-files-head" }, el("b", {}, req.title), close),
      rows.length ? el("ul", { class: "agents-files" }, ...rows) : el("p", { class: "muted" }, "Plus rien de changé dans ce dépôt."),
      ...(files.length >= 20 ? [el("p", { class: "muted" }, "Les 20 fichiers les plus changés.")] : []),
    );
  };
  listeners.add(draw);
  void draw();
  return () => listeners.delete(draw);
}
