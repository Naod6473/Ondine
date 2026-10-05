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

/** L'outil ouvert dans la vue (images ou renommer), et sur quels fichiers. */
let tool: { kind: "images" | "rename"; paths: string[] } | null = null;

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

/**
 * Un bouton en deux clics : le premier le transforme en « Confirmer ? »
 * pendant quelques secondes, le second lance l'action. Pour ce qui touche
 * tes fichiers d'un coup (Corbeille, compresser tout).
 */
function confirmButton(api: ModuleApi, cls: string, label: string, title: string, run: () => unknown): HTMLElement {
  const b = el("button", { class: cls, title }, label);
  let timer: number | undefined;
  const reset = () => {
    window.clearTimeout(timer);
    timer = undefined;
    b.textContent = label;
    b.classList.remove("confirming");
  };
  b.onclick = api.handler(() => {
    if (timer === undefined) {
      b.textContent = "Confirmer ?";
      b.classList.add("confirming");
      timer = window.setTimeout(reset, 4000);
      return;
    }
    reset();
    return run();
  });
  return b;
}

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
  // Les outils s'ouvrent dans l'île : on règle, on voit l'aperçu, puis on confirme.
  if (s.showTools !== false) {
    const open = (kind: "images" | "rename") => (paths: string[]) => {
      tool = { kind, paths };
      for (const r of redraws) r();
      api.openIsland("shelf");
    };
    targets.push({ id: "shelf-images", label: "Images…", icon: "🖼️", onDrop: open("images") });
    targets.push({ id: "shelf-rename", label: "Renommer…", icon: "✏️", onDrop: open("rename") });
  }
  if (s.showCompress) targets.push({ id: "shelf-zip", label: "Compresser", icon: "🗜️", onDrop: (paths) => actions.compress(api, paths) });
  if (s.showTrash) targets.push({ id: "shelf-trash", label: "Corbeille", icon: "🗑️", onDrop: (paths) => actions.trash(api, paths) });
  return targets;
}

// ── Les outils : images et renommage ─────────────────────────────────────────

/** Un groupe de boutons dont un seul est choisi. */
function segmented(options: [string, string][], value: string, onPick: (v: string) => void): HTMLElement {
  const box = el("div", { class: "tool-seg", role: "radiogroup" });
  for (const [v, label] of options) {
    const b = el("button", { class: `tool-seg-btn ${v === value ? "on" : ""}`, role: "radio", "aria-checked": String(v === value) }, label);
    b.onclick = () => {
      for (const o of box.children) {
        o.classList.toggle("on", o === b);
        o.setAttribute("aria-checked", String(o === b));
      }
      onPick(v);
    };
    box.append(b);
  }
  return box;
}

/** Les réglages choisis restent d'une fois sur l'autre. */
const toolPrefs = { format: "jpeg", maxWidth: "1920", quality: 85, pattern: "fichier-{n}", start: 1 };

function toolPanel(api: ModuleApi, t: { kind: "images" | "rename"; paths: string[] }, close: () => void): HTMLElement {
  const n = t.paths.length;
  const head = el(
    "div",
    { class: "tool-head" },
    el("button", { class: "icon-btn", title: "Retour à l'étagère", onclick: close }, "‹"),
    el("b", {}, t.kind === "images" ? `🖼️ ${n} image(s)` : `✏️ Renommer ${n} fichier(s)`),
  );
  const panel = el("div", { class: "tool" }, head);

  if (t.kind === "images") {
    const quality = el("input", { type: "range", min: 40, max: 100, step: 5, value: toolPrefs.quality, class: "tool-range" }) as HTMLInputElement;
    const qualityRow = el("label", { class: "tool-row" }, el("span", { class: "muted" }, "Qualité JPEG"), quality, el("span", { class: "tool-val" }, `${toolPrefs.quality}`));
    quality.oninput = () => {
      toolPrefs.quality = Number(quality.value);
      qualityRow.querySelector(".tool-val")!.textContent = quality.value;
    };
    const showQuality = () => qualityRow.classList.toggle("hidden", toolPrefs.format !== "jpeg");
    showQuality();
    const go = el("button", { class: "btn small primary" }, `Créer ${n > 1 ? `${n} images` : "l'image"}`);
    go.onclick = api.handler(() =>
      attempt(api, "Images", async () => {
        const r = await api.invoke<{ count: number; failed: number; error?: string | null }>("images", {
          paths: t.paths,
          format: toolPrefs.format,
          maxWidth: Number(toolPrefs.maxWidth),
          quality: toolPrefs.quality,
        });
        if (r.failed) api.notify({ title: `${r.failed} image(s) non traitée(s)`, body: r.error ?? "", icon: "⚠️", priority: "normal" });
        close();
      }),
    );
    panel.append(
      el("div", { class: "tool-row" }, el("span", { class: "muted" }, "Format"), segmented([["same", "Garder"], ["png", "PNG"], ["jpeg", "JPEG"]], toolPrefs.format, (v) => {
        toolPrefs.format = v;
        showQuality();
      })),
      el(
        "div",
        { class: "tool-row" },
        el("span", { class: "muted" }, "Largeur max."),
        segmented([["0", "Garder"], ["3840", "3840"], ["1920", "1920"], ["1280", "1280"], ["800", "800"], ["400", "400"]], toolPrefs.maxWidth, (v) => (toolPrefs.maxWidth = v)),
      ),
      qualityRow,
      el("p", { class: "muted tool-note" }, "Les originaux ne bougent pas : les nouvelles images sont créées à côté (ex. « photo-1920.jpg »). Annulable quelques secondes."),
      el("div", { class: "btn-row" }, go),
    );
    return panel;
  }

  // Renommer : modèle, numéro de départ, aperçu, puis confirmation en deux clics.
  const pattern = el("input", { class: "clip-input tool-pattern", type: "text", value: toolPrefs.pattern, maxlength: 120, spellcheck: "false" }) as HTMLInputElement;
  const start = el("input", { class: "clip-input tool-start", type: "number", min: 0, max: 99999, value: toolPrefs.start }) as HTMLInputElement;
  const preview = el("ul", { class: "tool-preview" });
  const go = confirmButton(api, "btn small primary", `Renommer ${n > 1 ? `les ${n} fichiers` : "le fichier"}`, "Renommer (annulable quelques secondes)", () =>
    attempt(api, "Renommer", async () => {
      await api.invoke("rename", { paths: t.paths, pattern: toolPrefs.pattern, start: toolPrefs.start });
      close();
    }),
  );
  let timer: number | undefined;
  const refresh = () => {
    toolPrefs.pattern = pattern.value;
    toolPrefs.start = Math.max(0, Math.floor(Number(start.value) || 0));
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        const plan = await api.invoke<{ from: string; to: string }[]>("rename_preview", { paths: t.paths, pattern: toolPrefs.pattern, start: toolPrefs.start });
        preview.replaceChildren(
          ...plan.slice(0, 6).map((p) => el("li", {}, el("span", { class: "muted" }, p.from), " → ", el("b", {}, p.to))),
          ...(plan.length > 6 ? [el("li", { class: "muted" }, `… et ${plan.length - 6} autre(s)`)] : []),
        );
        go.removeAttribute("disabled");
      } catch (err) {
        preview.replaceChildren(el("li", { class: "net-bad" }, `⚠️ ${errorText(err)}`));
        go.setAttribute("disabled", "");
      }
    }, 150);
  };
  pattern.oninput = refresh;
  start.oninput = refresh;
  refresh();
  panel.append(
    el("div", { class: "tool-row" }, el("span", { class: "muted" }, "Nouveau nom"), pattern, el("span", { class: "muted" }, "à partir de"), start),
    el("p", { class: "muted tool-note" }, "{n} = numéro, {nom} = l'ancien nom. L'extension est gardée. Exemple : « vacances-{n} »."),
    preview,
    el("div", { class: "btn-row" }, go),
  );
  return panel;
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
        if (tool) {
          root.append(toolPanel(api, tool, () => {
            tool = null;
            draw();
          }));
          return;
        }
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
          button("🖼️", "Convertir ou réduire les images de l'étagère", () => {
            tool = { kind: "images", paths: all() };
            draw();
          }),
          button("✏️", "Renommer les fichiers de l'étagère", () => {
            tool = { kind: "rename", paths: all() };
            draw();
          }),
          confirmButton(api, "btn small", "🗜️", "Tout compresser", () => actions.compress(api, all())),
          confirmButton(api, "btn small", "🗑️", "Tout envoyer à la Corbeille", () => actions.trash(api, all())),
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
                item.exists ? confirmButton(api, "icon-btn", "🗑️", "Envoyer à la Corbeille", () => actions.trash(api, one)) : null,
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
