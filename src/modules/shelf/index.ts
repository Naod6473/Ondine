// Module « Étagère » : ce qu'on fait des fichiers glissés sur l'île.
//
//   - cibles de dépôt : Étagère, Copier vers…, Déplacer vers…, un favori par
//     dossier choisi dans les réglages, Copier le chemin, Compresser, Corbeille ;
//   - vue agrandie : la liste de l'étagère, avec les mêmes actions.
//
// Tout le travail sur les fichiers est fait par le Rust (src-tauri/src/modules/shelf.rs),
// qui valide les chemins et propose « Annuler ». Ici, on ne fait qu'afficher et
// transmettre les chemins.

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { DropTarget, IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

interface ShelfItem {
  path: string;
  name: string;
  isDir: boolean;
  exists: boolean;
}

/** Copie locale de l'étagère, tenue à jour par le sujet "shelf.changed". */
let items: ShelfItem[] = [];
const redraws = new Set<() => void>();

function setItems(next: ShelfItem[]) {
  items = next;
  for (const r of redraws) r();
}

/** Le dernier morceau d'un chemin Windows (« C:\\a\\Docs » → « Docs »). */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Lance une action et montre l'erreur éventuelle dans l'île. Une erreur ici est
 * normale (dossier exclu, fichier disparu…) : on ne la compte pas comme un
 * plantage du module, d'où le try/catch au lieu de laisser remonter.
 */
async function attempt(api: ModuleApi, what: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (err) {
    api.log.warn(`${what} : ${errorText(err)}`);
    api.notify({ title: `${what} impossible`, body: errorText(err), icon: "⚠️", priority: "normal" });
  }
}

/** Résultat d'une copie ou d'un déplacement : s'il s'est arrêté en route, on le dit. */
interface BatchResult {
  error?: string | null;
}

function reportPartial(api: ModuleApi, what: string, r: BatchResult) {
  if (r.error) api.notify({ title: `${what} interrompu`, body: r.error, icon: "⚠️", priority: "normal" });
}

// ── Les actions (utilisées par les cibles de dépôt ET par la vue agrandie) ──

const actions = {
  addToShelf: (api: ModuleApi, paths: string[]) =>
    attempt(api, "Ajout à l'étagère", async () => {
      const r = await api.invoke<{ added: number }>("add", { paths });
      api.notify({ title: `${r.added} élément(s) posé(s) sur l'étagère`, icon: "🧺", priority: "low" });
    }),

  copyTo: (api: ModuleApi, paths: string[], dest?: string) =>
    attempt(api, "Copie", async () => {
      const folder = dest ?? (await Bridge.pickFolder("Copier vers…"));
      if (!folder) return; // boîte annulée
      reportPartial(api, "Copie", await api.invoke<BatchResult>("copy_to", { paths, dest: folder }));
    }),

  moveTo: (api: ModuleApi, paths: string[], dest?: string) =>
    attempt(api, "Déplacement", async () => {
      const folder = dest ?? (await Bridge.pickFolder("Déplacer vers…"));
      if (!folder) return;
      reportPartial(api, "Déplacement", await api.invoke<BatchResult>("move_to", { paths, dest: folder }));
    }),

  copyPaths: (api: ModuleApi, paths: string[]) =>
    attempt(api, "Copie du chemin", async () => {
      const r = await api.invoke<{ count: number }>("copy_paths", { paths });
      api.notify({ title: r.count > 1 ? `${r.count} chemins copiés` : "Chemin copié", icon: "📋", priority: "low" });
    }),

  compress: (api: ModuleApi, paths: string[]) =>
    attempt(api, "Compression", async () => {
      await api.invoke("compress", { paths });
    }),

  trash: (api: ModuleApi, paths: string[]) =>
    attempt(api, "Corbeille", async () => {
      await api.invoke("trash", { paths });
    }),
};

/** Lâcher sur un favori : copie ou déplacement selon le réglage. */
function toFavorite(api: ModuleApi, paths: string[], folder: string) {
  return api.settings().favoriteAction === "move" ? actions.moveTo(api, paths, folder) : actions.copyTo(api, paths, folder);
}

/** Les cibles, recalculées à chaque glisser (elles dépendent des réglages). */
function dropTargets(api: ModuleApi): DropTarget[] {
  const s = api.settings();
  const favorites = (s.favorites as string[]).slice(0, 6);
  const targets: DropTarget[] = [
    { id: "shelf-add", label: "Étagère", icon: "🧺", onDrop: (paths) => actions.addToShelf(api, paths) },
    { id: "shelf-copy", label: "Copier vers…", icon: "📄", onDrop: (paths) => actions.copyTo(api, paths) },
    { id: "shelf-move", label: "Déplacer vers…", icon: "📦", onDrop: (paths) => actions.moveTo(api, paths) },
    // Un favori = le nom du dossier ; copier ou déplacer dépend du réglage.
    ...favorites.map(
      (folder, i): DropTarget => ({
        id: `shelf-fav-${i}`,
        label: baseName(folder),
        icon: "⭐",
        onDrop: (paths) => toFavorite(api, paths, folder),
      }),
    ),
    { id: "shelf-path", label: "Copier le chemin", icon: "📋", onDrop: (paths) => actions.copyPaths(api, paths) },
  ];
  if (s.showCompress) targets.push({ id: "shelf-zip", label: "Compresser", icon: "🗜️", onDrop: (paths) => actions.compress(api, paths) });
  if (s.showTrash) targets.push({ id: "shelf-trash", label: "Corbeille", icon: "🗑️", onDrop: (paths) => actions.trash(api, paths) });
  return targets;
}

export const shelf: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("shelf.changed", (msg) => setItems((msg.payload as { items: ShelfItem[] }).items));
    // L'étagère vit côté Rust : au démarrage (ou après réactivation), on la relit.
    api
      .invoke<{ items: ShelfItem[] }>("list")
      .then((r) => setItems(r.items))
      .catch(() => {}); // hors de l'appli (navigateur) : étagère vide
  },

  views: {
    expanded(root, api) {
      const draw = () => {
        root.replaceChildren();
        if (!items.length) {
          root.append(
            el(
              "p",
              { class: "muted shelf-empty" },
              "L'étagère est vide. Glisse des fichiers sur l'île et lâche-les sur « 🧺 Étagère » pour les garder sous la main.",
            ),
          );
          return;
        }
        const all = () => items.filter((i) => i.exists).map((i) => i.path);
        const button = (label: string, title: string, run: () => unknown) =>
          el("button", { class: "btn small", title, onclick: api.handler(run) }, label);

        const favorites = (api.settings().favorites as string[]).slice(0, 6);
        const bar = el(
          "div",
          { class: "btn-row shelf-bar" },
          el("span", { class: "muted" }, `${items.length} élément(s)`),
          button("📄 Copier vers…", "Copier tout vers un dossier", () => actions.copyTo(api, all())),
          button("📦 Déplacer vers…", "Déplacer tout vers un dossier", () => actions.moveTo(api, all())),
          // Un favori = le nom du dossier ; copier ou déplacer dépend du réglage.
    ...favorites.map((f) => button(`⭐ ${baseName(f)}`, f, () => toFavorite(api, all(), f))),
          button("🗜️", "Tout compresser", () => actions.compress(api, all())),
          button("🗑️", "Tout envoyer à la Corbeille", () => actions.trash(api, all())),
          button("Vider", "Retirer tout de l'étagère (les fichiers ne bougent pas)", () =>
            attempt(api, "Vider l'étagère", () => api.invoke("clear").then(() => {})),
          ),
        );

        const list = el("ul", { class: "shelf-list" });
        for (const item of items) {
          const one = [item.path];
          list.append(
            el(
              "li",
              { class: `shelf-item ${item.exists ? "" : "missing"}`, title: item.path },
              el("span", { class: "shelf-icon" }, item.isDir ? "📁" : "📄"),
              el("span", { class: "shelf-name" }, item.name),
              item.exists ? null : el("span", { class: "muted" }, "introuvable"),
              el(
                "span",
                { class: "shelf-actions" },
                item.exists
                  ? el("button", { class: "icon-btn", title: "Montrer dans l'Explorateur", onclick: api.handler(() => attempt(api, "Explorateur", () => api.invoke("reveal", { paths: one }).then(() => {}))) }, "📂")
                  : null,
                item.exists ? el("button", { class: "icon-btn", title: "Copier le chemin", onclick: api.handler(() => actions.copyPaths(api, one)) }, "📋") : null,
                item.exists ? el("button", { class: "icon-btn", title: "Envoyer à la Corbeille", onclick: api.handler(() => actions.trash(api, one)) }, "🗑️") : null,
                el(
                  "button",
                  { class: "icon-btn", title: "Retirer de l'étagère", onclick: api.handler(() => attempt(api, "Retirer", () => api.invoke("remove", { paths: one }).then(() => {}))) },
                  "×",
                ),
              ),
            ),
          );
        }
        root.append(bar, list);
      };
      draw();
      redraws.add(draw);
      const off = api.onSettingsChange(draw);
      return () => {
        redraws.delete(draw);
        off();
      };
    },

    drop: dropTargets,
  },
};
