// Module « Presse-papiers » : historique des copies, épinglage, collage sans
// mise en forme et snippets.
//
// Tout vit côté Rust (src-tauri/src/modules/clipboard.rs) : la surveillance des
// copies, le filtrage des copies sensibles, la recherche, l'enregistrement.
// Ici, on affiche la liste et on transmet les clics. Le message
// "clipboard.changed" ne contient aucun texte : on redemande la liste.
//
// « Coller » : le Rust met le texte dans le presse-papiers, rend la main à la
// fenêtre où tu étais avant l'île, et y tape Ctrl+V. Puis l'île se referme.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";

/** Une copie, telle que le Rust l'envoie (seulement un aperçu du texte). */
interface ClipItem {
  id: number;
  preview: string;
  chars: number;
  pinned: boolean;
  /** Heure de la copie, en ms depuis 1970. */
  at: number;
}

interface SnippetItem {
  id: number;
  name: string;
  text: string;
}

interface ListResult {
  items: ClipItem[];
  snippets: SnippetItem[];
  total: number;
}

/** Ce que la vue retient entre deux ouvertures de l'île. */
const view = {
  tab: "history" as "history" | "snippets" | "password",
  query: "",
};

/** « à l'instant », « il y a 5 min », « il y a 2 h », sinon la date. */
function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(at).toLocaleDateString("fr-FR");
}

/** Lance une action ; une erreur (aucune fenêtre où coller…) s'affiche sans compter comme plantage. */
async function attempt(api: ModuleApi, what: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    api.log.warn(`${what} : ${errorText(err)}`);
    api.notify({ title: `${what} impossible`, body: errorText(err), icon: "⚠️", priority: "normal", key: "clipboard-error" });
    return false;
  }
}

/** Colle (une copie, un snippet, ou le presse-papiers en texte brut) puis referme l'île. */
async function paste(api: ModuleApi, command: "paste" | "paste_plain", args?: unknown) {
  if (await attempt(api, "Coller", () => api.invoke(command, args))) api.closeIsland();
}

async function copy(api: ModuleApi, args: unknown) {
  if (await attempt(api, "Copier", () => api.invoke("copy", args))) {
    api.notify({ title: "Copié", icon: "📋", priority: "low", key: "clipboard-copied" });
  }
}

/** Les choix du générateur de mots de passe (gardés pendant que l'île tourne). */
const pw = { length: 20, upper: true, lower: true, digits: true, symbols: true, ambiguous: false };

/** Les casses proposées par le bouton « Aa ». */
const CASES: [mode: string, label: string, title: string][] = [
  ["upper", "ABC", "Copier en MAJUSCULES"],
  ["lower", "abc", "Copier en minuscules"],
  ["title", "Abc", "Copier Avec Une Majuscule À Chaque Mot"],
  ["sentence", "Ab.", "Copier en phrase (majuscule au début de chaque phrase)"],
];

export const clipboard: IslandModule = {
  manifest: manifest as ModuleManifest,

  // Un lien copié a été nettoyé (Rust) : on le dit, avec « Remettre » l'original.
  setup(api) {
    return api.on("clipboard.link-cleaned", (msg) => {
      const n = (msg.payload as { removed?: number } | null)?.removed ?? 0;
      api.notify({
        title: "Lien nettoyé",
        body: `${n} traqueur${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""} (utm, fbclid…).`,
        icon: "🧹",
        priority: "low",
        key: "clipboard-link",
        actions: [{ label: "Remettre", run: async () => void (await attempt(api, "Remettre le lien", () => api.invoke("restore_link"))) }],
      });
    });
  },

  views: {
    expanded(root, api) {
      // ── En-tête, construit une seule fois (la recherche garde le focus) ──
      const search = el("input", {
        class: "clip-search",
        type: "search",
        placeholder: "Rechercher…",
        value: view.query,
        spellcheck: "false",
      });
      const tabButton = (tab: typeof view.tab, label: string) =>
        el("button", { class: `tab ${view.tab === tab ? "active" : ""}`, "data-tab": tab, onclick: api.handler(() => setTab(tab)) }, label);
      const tabs = el("div", { class: "clip-tabs" }, tabButton("history", "Historique"), tabButton("snippets", "Snippets"), tabButton("password", "🔑 Mot de passe"));
      const plain = el(
        "button",
        {
          class: "btn small",
          title: "Colle le contenu actuel du presse-papiers en texte brut (sans gras, couleurs ni liens) dans la fenêtre d'avant",
          onclick: api.handler(() => paste(api, "paste_plain")),
        },
        "Coller sans mise en forme",
      );
      const body = el("div", { class: "clip-body" });
      root.append(el("div", { class: "clip-head" }, search, tabs, plain), body);

      let last: ListResult = { items: [], snippets: [], total: 0 };
      /** Le formulaire de snippet ouvert (on ne redessine pas par-dessus). */
      let editing: SnippetItem | "new" | null = null;
      let alive = true;

      const setTab = (tab: typeof view.tab) => {
        view.tab = tab;
        editing = null;
        for (const b of tabs.querySelectorAll<HTMLElement>(".tab")) b.classList.toggle("active", b.dataset.tab === tab);
        draw();
      };

      const refresh = async () => {
        try {
          last = await api.invoke<ListResult>("list", { query: view.query });
        } catch {
          return; // hors de l'appli (navigateur) : liste vide
        }
        // (L'onglet mot de passe ne se redessine pas : il garderait le même mot de passe affiché.)
        if (alive && !editing && view.tab !== "password") draw();
      };

      // ── Le corps : la liste de l'onglet choisi ──
      const draw = () => {
        body.replaceChildren();
        if (view.tab === "history") drawHistory();
        else if (view.tab === "password") drawPassword();
        else if (editing) drawForm(editing);
        else drawSnippets();
      };

      const drawHistory = () => {
        if (!last.items.length) {
          body.append(
            el(
              "p",
              { class: "muted" },
              view.query
                ? "Aucune copie ne contient ce texte."
                : "Rien pour l'instant. Copie du texte (Ctrl+C) n'importe où : il apparaîtra ici. Les mots de passe copiés depuis un gestionnaire sont ignorés.",
            ),
          );
          return;
        }
        const list = el("ul", { class: "clip-list" });
        for (const item of last.items) {
          list.append(
            el(
              "li",
              { class: `clip-item ${item.pinned ? "pinned" : ""}` },
              el(
                "button",
                { class: "clip-text", title: "Coller dans la fenêtre d'avant", onclick: api.handler(() => paste(api, "paste", { id: item.id })) },
                item.preview,
              ),
              el("span", { class: "muted clip-meta" }, item.pinned ? "épinglé" : ago(item.at)),
              el(
                "span",
                { class: "clip-actions" },
                el(
                  "button",
                  {
                    class: "icon-btn",
                    title: item.pinned ? "Désépingler" : "Épingler (gardé même après redémarrage)",
                    onclick: api.handler(() => attempt(api, "Épingler", () => api.invoke("pin", { id: item.id, pinned: !item.pinned }))),
                  },
                  item.pinned ? "📍" : "📌",
                ),
                el("button", { class: "icon-btn", title: "Copier", onclick: api.handler(() => copy(api, { id: item.id })) }, "📋"),
                el(
                  "button",
                  {
                    class: "icon-btn clip-case",
                    title: "Changer la casse (MAJUSCULES, minuscules…)",
                    onclick: api.handler((e: Event) => {
                      // Les boutons de l'élément laissent place aux quatre casses.
                      const actions = (e.currentTarget as HTMLElement).parentElement!;
                      const back = [...actions.childNodes];
                      actions.replaceChildren(
                        ...CASES.map(([mode, label, title]) =>
                          el(
                            "button",
                            {
                              class: "icon-btn clip-case-pick",
                              title,
                              onclick: api.handler(async () => {
                                actions.replaceChildren(...back);
                                if (await attempt(api, "Changer la casse", () => api.invoke("transform", { id: item.id, mode }))) {
                                  api.notify({ title: "Copié dans la nouvelle casse", icon: "🔠", priority: "low", key: "clipboard-copied" });
                                }
                              }),
                            },
                            label,
                          ),
                        ),
                        el("button", { class: "icon-btn", title: "Fermer", onclick: () => actions.replaceChildren(...back) }, "‹"),
                      );
                    }),
                  },
                  "Aa",
                ),
                el(
                  "button",
                  { class: "icon-btn", title: "Retirer de l'historique", onclick: api.handler(() => attempt(api, "Retirer", () => api.invoke("delete", { id: item.id }))) },
                  "×",
                ),
              ),
            ),
          );
        }
        const pinned = last.items.filter((i) => i.pinned).length;
        const footer = el(
          "div",
          { class: "btn-row clip-foot" },
          el("span", { class: "muted" }, `${last.total} copie(s)${pinned ? `, ${pinned} épinglée(s)` : ""}`),
          el(
            "button",
            {
              class: "btn small",
              title: "Efface l'historique (les éléments épinglés restent)",
              onclick: api.handler(() => attempt(api, "Vider", () => api.invoke("clear"))),
            },
            "Vider",
          ),
        );
        body.append(list, footer);
      };

      // ── Générateur de mots de passe ──
      const drawPassword = () => {
        const out = el("code", { class: "pw-out" }, "…");
        const length = el("input", { type: "range", min: 8, max: 64, value: pw.length, class: "tool-range" }) as HTMLInputElement;
        const lengthVal = el("span", { class: "tool-val" }, String(pw.length));
        let current = "";
        const make = async () => {
          try {
            const r = await api.invoke<{ password: string }>("password_generate", pw);
            current = r.password;
            out.textContent = current;
          } catch (err) {
            current = "";
            out.textContent = `⚠️ ${errorText(err)}`;
          }
        };
        length.oninput = () => {
          pw.length = Number(length.value);
          lengthVal.textContent = length.value;
          void make();
        };
        const check = (key: "upper" | "lower" | "digits" | "symbols" | "ambiguous", label: string) => {
          const box = el("input", { type: "checkbox" }) as HTMLInputElement;
          box.checked = pw[key];
          box.onchange = () => {
            pw[key] = box.checked;
            void make();
          };
          return el("label", { class: "pw-check" }, box, label);
        };
        const copyBtn = el(
          "button",
          {
            class: "btn small primary",
            title: "Copié en secret : ni l'historique de Windows, ni celui de l'île ne le gardent",
            onclick: api.handler(async () => {
              if (!current) return;
              if (await attempt(api, "Copier le mot de passe", () => api.invoke("password_copy", { password: current }))) {
                api.notify({ title: "Mot de passe copié", body: "Effacé du presse-papiers dans 30 secondes.", icon: "🔑", priority: "low", key: "clipboard-copied" });
              }
            }),
          },
          "Copier",
        );
        body.append(
          el(
            "div",
            { class: "pw" },
            el("div", { class: "pw-row" }, out, el("button", { class: "icon-btn", title: "Un autre", onclick: api.handler(make) }, "↻"), copyBtn),
            el("label", { class: "tool-row" }, el("span", { class: "muted" }, "Longueur"), length, lengthVal),
            el("div", { class: "tool-row" }, check("upper", "ABC"), check("lower", "abc"), check("digits", "123"), check("symbols", "#$%"), check("ambiguous", "Garder 0 O l 1")),
            el("p", { class: "muted tool-note" }, "Tiré au hasard par Windows, sur ton PC. Jamais enregistré ni écrit dans le journal ; effacé du presse-papiers au bout de 30 s."),
          ),
        );
        void make();
      };

      const drawSnippets = () => {
        const add = el("button", { class: "btn small", onclick: api.handler(() => openForm("new")) }, "+ Nouveau snippet");
        if (!last.snippets.length) {
          body.append(
            el(
              "p",
              { class: "muted" },
              view.query
                ? "Aucun snippet ne contient ce texte."
                : "Un snippet est un texte que tu colles souvent (adresse, signature, réponse type). Crée-le une fois, colle-le en un clic.",
            ),
            add,
          );
          return;
        }
        const list = el("ul", { class: "clip-list" });
        for (const s of last.snippets) {
          list.append(
            el(
              "li",
              { class: "clip-item" },
              el(
                "button",
                { class: "clip-text", title: "Coller dans la fenêtre d'avant", onclick: api.handler(() => paste(api, "paste", { snippet: s.id })) },
                el("b", {}, s.name),
                el("span", { class: "muted" }, ` · ${s.text.slice(0, 200)}`),
              ),
              el(
                "span",
                { class: "clip-actions" },
                el("button", { class: "icon-btn", title: "Copier", onclick: api.handler(() => copy(api, { snippet: s.id })) }, "📋"),
                el("button", { class: "icon-btn", title: "Modifier", onclick: api.handler(() => openForm(s)) }, "✏️"),
                el(
                  "button",
                  { class: "icon-btn", title: "Supprimer", onclick: api.handler(() => attempt(api, "Supprimer", () => api.invoke("snippet_delete", { id: s.id }))) },
                  "×",
                ),
              ),
            ),
          );
        }
        body.append(el("div", { class: "btn-row" }, add), list);
      };

      const openForm = (target: SnippetItem | "new") => {
        editing = target;
        draw();
      };

      const drawForm = (target: SnippetItem | "new") => {
        const current = target === "new" ? null : target;
        const name = el("input", { class: "clip-input", type: "text", placeholder: "Nom (ex. : Adresse)", maxlength: 80, value: current?.name ?? "" });
        const text = el("textarea", { class: "clip-input clip-textarea", placeholder: "Le texte à coller", spellcheck: "false" }, current?.text ?? "");
        const save = async () => {
          const ok = await attempt(api, "Enregistrer le snippet", () =>
            api.invoke("snippet_save", { id: current?.id, name: name.value, text: text.value }),
          );
          if (ok) {
            editing = null;
            await refresh();
          }
        };
        const cancel = () => {
          editing = null;
          draw();
        };
        body.append(
          el(
            "div",
            { class: "clip-form" },
            name,
            text,
            el(
              "div",
              { class: "btn-row" },
              el("button", { class: "btn small", onclick: api.handler(save) }, "Enregistrer"),
              el("button", { class: "btn small", onclick: api.handler(cancel) }, "Annuler"),
            ),
          ),
        );
        name.focus();
      };

      // ── Recherche : on redemande la liste un instant après la dernière frappe ──
      let timer = 0;
      search.addEventListener("input", () => {
        view.query = search.value;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 150);
      });
      // Entrée = coller le premier résultat.
      search.addEventListener(
        "keydown",
        api.handler((e: KeyboardEvent) => {
          if (e.key !== "Enter") return;
          if (view.tab === "history" && last.items[0]) return paste(api, "paste", { id: last.items[0].id });
          if (view.tab === "snippets" && last.snippets[0]) return paste(api, "paste", { snippet: last.snippets[0].id });
        }),
      );

      const off = api.on("clipboard.changed", () => void refresh());
      draw();
      void refresh();
      search.focus();
      return () => {
        alive = false;
        window.clearTimeout(timer);
        off();
      };
    },
  },
};
