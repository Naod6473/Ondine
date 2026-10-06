// Module « Notes » : notes rapides et liste de choses à faire.
//
// Les données vivent dans le Rust (src-tauri/src/modules/notes.rs), qui les
// enregistre et propose « Annuler ». Ici, on affiche et on transmet.
//
// Pour que ça reste fluide, la liste des tâches n'est pas redessinée en entier
// à chaque changement : chaque tâche garde son élément HTML (repéré par son
// numéro), ce qui laisse les animations CSS se faire (case qui se coche, texte
// qui se barre, tâche qui arrive ou qui part).
//
// Le Lanceur (recherche dans l'île) publie « notes.open » { kind, id } : l'onglet
// s'ouvre alors sur cette note (dans l'éditeur) ou sur cette tâche (mise en avant).

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { reducedMotion, TabPill } from "../../island/tab-pill";

interface Note {
  id: number;
  text: string;
  updated: number;
}

interface Todo {
  id: number;
  text: string;
  done: boolean;
  created: number;
}

interface Data {
  notes: Note[];
  todos: Todo[];
}

let data: Data = { notes: [], todos: [] };
let pane: "todo" | "notes" = "todo";
const redraws = new Set<() => void>();
/** Ce que le Lanceur a demandé d'ouvrir, en attendant que la vue soit là. */
let wanted: { kind: "note" | "todo"; id: number } | null = null;
/** La vue affichée, si elle l'est : pour suivre une demande du Lanceur sur place. */
let jump: (() => void) | null = null;

async function refresh(api: ModuleApi) {
  try {
    data = await api.invoke<Data>("list");
  } catch {
    return; // hors de l'appli (navigateur)
  }
  for (const r of redraws) r();
}

/** Lance une commande ; une erreur (texte vide…) s'affiche sans compter comme plantage. */
async function attempt(api: ModuleApi, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    api.notify({ title: "Notes", body: errorText(err), icon: "⚠️", priority: "low", key: "notes-error" });
    return false;
  }
}

/** « il y a 5 min », « hier », sinon la date. */
function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 2 * 86400) return "hier";
  return new Date(ms).toLocaleDateString("fr-FR");
}

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Fait apparaître un élément en douceur. */
function enter(node: HTMLElement) {
  if (reducedMotion()) return;
  node.animate([{ opacity: 0, transform: "translateY(-6px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: EASE });
}

/** Fait disparaître un élément (il se replie), puis le retire. */
function leave(node: HTMLElement) {
  if (reducedMotion()) return node.remove();
  const h = node.offsetHeight;
  node.classList.add("leaving"); // ne compte plus dans l'ordre de la liste
  node.style.overflow = "hidden";
  node
    .animate(
      [
        { opacity: 1, height: `${h}px`, transform: "none" },
        { opacity: 0, height: "0px", transform: "translateX(12px)" },
      ],
      { duration: 240, easing: EASE },
    )
    .finished.then(
      () => node.remove(),
      () => node.remove(),
    );
}

export const notes: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    api.on("notes.changed", () => void refresh(api));
    api.on("notes.open", (msg) => {
      const p = msg.payload as { kind?: string; id?: number } | null;
      if (typeof p?.id !== "number") return;
      wanted = { kind: p.kind === "todo" ? "todo" : "note", id: p.id };
      pane = wanted.kind === "todo" ? "todo" : "notes";
      jump?.(); // l'onglet était déjà affiché
    });
    void refresh(api).then(() => {
      const open = data.todos.filter((t) => !t.done).length;
      if (api.settings().showTodoCount && open) {
        api.notify({ title: `${open} tâche(s) à faire`, icon: "✅", priority: "low", key: "notes-start" });
      }
    });
  },

  views: {
    expanded(root, api) {
      const segButtons = {
        todo: el("button", { class: "seg", onclick: api.handler(() => show("todo")) }, "✅ À faire"),
        notes: el("button", { class: "seg", onclick: api.handler(() => show("notes")) }, "📝 Notes"),
      };
      const seg = el("div", { class: "segmented" }, segButtons.todo, segButtons.notes);
      const pill = new TabPill(seg);
      const body = el("div", { class: "notes-body" });
      root.append(seg, body);

      let draw: () => void = () => {};

      const show = (p: typeof pane, animate = true) => {
        pane = p;
        segButtons.todo.classList.toggle("active", p === "todo");
        segButtons.notes.classList.toggle("active", p === "notes");
        if (animate) pill.moveTo(segButtons[p]);
        body.replaceChildren();
        draw = p === "todo" ? todoPane() : notesPane();
        draw();
        if (animate && !reducedMotion()) {
          body.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
        }
      };

      // ── À faire ────────────────────────────────────────────────────────────
      const todoPane = () => {
        const input = el("input", { class: "clip-input notes-add", type: "text", placeholder: "Ajouter une tâche… (Entrée)", maxlength: 300 });
        input.addEventListener(
          "keydown",
          api.handler(async (e: KeyboardEvent) => {
            if (e.key !== "Enter" || !input.value.trim()) return;
            const text = input.value;
            input.value = "";
            await attempt(api, () => api.invoke("todo_add", { text }));
          }),
        );
        const list = el("ul", { class: "todo-list" });
        const footer = el("div", { class: "btn-row notes-foot" });
        const empty = el("p", { class: "muted" }, "Rien à faire. Écris une tâche ci-dessus et appuie sur Entrée.");
        body.append(input, list, footer);
        requestAnimationFrame(() => input.focus());

        /** Les éléments déjà affichés, par numéro de tâche. */
        const rows = new Map<number, { li: HTMLElement; text: HTMLElement }>();

        const row = (t: Todo) => {
          const check = el("button", {
            class: "todo-check",
            title: "Cocher / décocher",
            onclick: api.handler(() => attempt(api, () => api.invoke("todo_toggle", { id: t.id }))),
          });
          const text = el("span", { class: "todo-text", title: "Double-clic pour modifier" }, t.text);
          text.addEventListener("dblclick", () => edit(t.id, text));
          const del = el(
            "button",
            { class: "icon-btn todo-del", title: "Supprimer", onclick: api.handler(() => attempt(api, () => api.invoke("todo_delete", { id: t.id }))) },
            "×",
          );
          const li = el("li", { class: "todo-item", "data-id": String(t.id) }, check, text, del);
          return { li, text };
        };

        /** Modifier une tâche sur place : Entrée valide, Échap annule. */
        const edit = (id: number, text: HTMLElement) => {
          const before = text.textContent ?? "";
          const field = el("input", { class: "clip-input todo-edit", type: "text", value: before, maxlength: 300 });
          text.replaceWith(field);
          field.focus();
          field.select();
          let done = false;
          const finish = async (save: boolean) => {
            if (done) return;
            done = true;
            field.replaceWith(text);
            if (save && field.value.trim() && field.value !== before) {
              text.textContent = field.value;
              await attempt(api, () => api.invoke("todo_edit", { id, text: field.value }));
            }
          };
          field.addEventListener("keydown", (e) => {
            e.stopPropagation(); // Échap ne doit pas fermer l'île
            if (e.key === "Enter") void finish(true);
            if (e.key === "Escape") void finish(false);
          });
          field.addEventListener("blur", () => void finish(true));
        };

        return () => {
          // Les tâches à faire d'abord, les terminées ensuite (chacune dans leur ordre).
          const ordered = [...data.todos.filter((t) => !t.done), ...data.todos.filter((t) => t.done)];
          const seen = new Set<number>();
          ordered.forEach((t, i) => {
            seen.add(t.id);
            let r = rows.get(t.id);
            const isNew = !r;
            if (!r) {
              r = row(t);
              rows.set(t.id, r);
            }
            r.li.classList.toggle("done", t.done);
            if (r.text.isConnected && r.text.textContent !== t.text) r.text.textContent = t.text;
            // Remettre à la bonne place seulement si besoin (sinon l'animation saute).
            const live = [...list.children].filter((c) => !c.classList.contains("leaving"));
            if (live[i] !== r.li) list.insertBefore(r.li, live[i] ?? null);
            if (isNew) enter(r.li);
          });
          for (const [id, r] of rows) {
            if (!seen.has(id)) {
              rows.delete(id);
              leave(r.li);
            }
          }
          if (!ordered.length) list.after(empty);
          else empty.remove();

          const open = data.todos.filter((t) => !t.done).length;
          const finished = data.todos.length - open;
          footer.replaceChildren(
            el("span", { class: "muted" }, open ? `${open} à faire` : data.todos.length ? "Tout est fait 🎉" : ""),
            finished
              ? el(
                  "button",
                  { class: "btn small", onclick: api.handler(() => attempt(api, () => api.invoke("todo_clear_done"))) },
                  `Retirer les terminées (${finished})`,
                )
              : "",
          );
        };
      };

      // ── Notes ──────────────────────────────────────────────────────────────
      let openNote: number | "new" | null = null;

      const notesPane = () => {
        const host = el("div", { class: "notes-pane" });
        body.append(host);

        const list = () => {
          host.replaceChildren(
            el("div", { class: "btn-row" }, el("button", { class: "btn small", onclick: api.handler(() => open("new")) }, "+ Nouvelle note")),
          );
          if (!data.notes.length) {
            host.append(el("p", { class: "muted" }, "Pas encore de note. Une idée, un numéro, une liste de courses : note-le ici."));
            return;
          }
          const grid = el("div", { class: "note-grid" });
          for (const n of data.notes) {
            const [first, ...rest] = n.text.split("\n");
            grid.append(
              el(
                "button",
                { class: "note-card", onclick: api.handler(() => open(n.id)) },
                el("b", {}, first.slice(0, 80)),
                el("span", { class: "muted" }, rest.join(" ").slice(0, 120)),
                el("small", { class: "muted" }, ago(n.updated)),
              ),
            );
          }
          host.append(grid);
        };

        const open = (id: number | "new") => {
          openNote = id;
          draw();
          if (!reducedMotion()) host.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE });
        };

        /** L'éditeur : enregistre tout seul, un instant après la dernière frappe. */
        const editor = (id: number | "new") => {
          const note = id === "new" ? null : data.notes.find((n) => n.id === id);
          let savedId = note?.id ?? null;
          const area = el("textarea", { class: "clip-input note-editor", placeholder: "Écris ta note… (enregistrée automatiquement)", spellcheck: "true" }, note?.text ?? "");
          const status = el("span", { class: "muted note-status" }, note ? `Modifiée ${ago(note.updated)}` : "");
          let timer = 0;
          const save = async () => {
            window.clearTimeout(timer);
            if (!area.value.trim()) return;
            const r = await api.invoke<{ id: number }>("note_save", { id: savedId ?? undefined, text: area.value }).catch((err) => {
              status.textContent = errorText(err);
              return null;
            });
            if (r) {
              savedId = r.id;
              status.textContent = "Enregistrée";
            }
          };
          area.addEventListener("input", () => {
            status.textContent = "…";
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void save(), 600);
          });
          area.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              void back();
            }
          });
          const back = async () => {
            await save();
            openNote = null;
            draw();
          };
          host.replaceChildren(
            el(
              "div",
              { class: "btn-row note-bar" },
              el("button", { class: "btn small", title: "Retour à la liste (Échap)", onclick: api.handler(back) }, "← Notes"),
              status,
              el("span", { class: "spacer" }),
              savedId !== null || note
                ? el(
                    "button",
                    {
                      class: "btn small",
                      title: "Supprimer la note (annulable)",
                      onclick: api.handler(async () => {
                        window.clearTimeout(timer);
                        if (savedId !== null) await attempt(api, () => api.invoke("note_delete", { id: savedId }));
                        openNote = null;
                        draw();
                      }),
                    },
                    "🗑 Supprimer",
                  )
                : null,
            ),
            area,
          );
          requestAnimationFrame(() => {
            area.focus();
            area.setSelectionRange(area.value.length, area.value.length); // curseur à la fin
          });
        };

        // Pendant qu'on écrit, les messages "notes.changed" ne redessinent pas l'éditeur.
        return () => (openNote === null ? list() : host.querySelector(".note-editor") ? undefined : editor(openNote));
      };

      const redraw = () => draw();
      redraws.add(redraw);

      /** Suit la demande du Lanceur : ouvre la note, ou met la tâche en avant. */
      const follow = () => {
        const w = wanted;
        if (!w) return;
        wanted = null;
        if (w.kind === "note") {
          openNote = data.notes.some((n) => n.id === w.id) ? w.id : null;
          show("notes", false);
          pill.jumpTo(segButtons.notes);
          return;
        }
        show("todo", false);
        pill.jumpTo(segButtons.todo);
        highlight(w.id);
      };

      /** Fait clignoter doucement une tâche et la fait défiler jusqu'à elle. */
      const highlight = (id: number) => {
        const li = body.querySelector<HTMLElement>(`.todo-item[data-id="${id}"]`);
        if (!li) return;
        li.scrollIntoView({ block: "nearest" });
        li.classList.add("found");
        window.setTimeout(() => li.classList.remove("found"), 1600);
      };
      jump = follow;

      show(pane, false);
      requestAnimationFrame(() => pill.jumpTo(segButtons[pane]));
      if (wanted) requestAnimationFrame(follow);
      void refresh(api);
      return () => {
        if (jump === follow) jump = null;
        redraws.delete(redraw);
        pill.stop();
      };
    },
  },
};
