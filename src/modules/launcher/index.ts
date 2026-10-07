// Module « Lanceur » : une barre de recherche dans l'île, ouverte par un
// raccourci global (Alt+Espace par défaut, réglable).
//
// Le Rust (src-tauri/src/modules/launcher.rs) trouve les applications du menu
// Démarrer, les outils Windows et les fichiers récents, et les ouvre. Ici, on
// ajoute les actions de l'île (onglets, minuteur, terminal, réglages), on
// trie selon ce qui est tapé, et on gère le clavier : ↑ ↓ pour choisir,
// Entrée pour ouvrir, Échap pour refermer l'île.
//
// « Recherche dans l'île » (island-search.ts) : sous ces résultats, une
// section par module (notes, presse-papiers, étagère, captures).

import manifest from "./manifest.json";
import { Bridge } from "../../core/bridge";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import { magicWord } from "../../eggs/words";
import { el } from "../../island/dom";
import { agentIcon, icon, setLabel } from "../../island/icon";
import { reducedMotion } from "../../island/tab-pill";
import { ALL_MODULES } from "..";
import { normalize, score } from "./search";
import { type FoundGroup, MIN_QUERY, rowsOf, searchIsland, SECTIONS } from "./island-search";

/** Une entrée trouvée par le Rust. */
interface Item {
  id: number;
  name: string;
  kind: "app" | "tool" | "recent";
  detail: string;
}

interface Listing {
  items: Item[];
  /** Le raccourci réservé ("" = aucun). */
  hotkey: string;
  hotkeyError: string | null;
}

/** Une ligne de résultat, quelle que soit son origine. */
interface Result {
  key: string;
  name: string;
  detail: string;
  icon: string;
  tag: string;
  score: number;
  /** Une tâche déjà faite (recherche dans l'île) : texte barré. */
  done?: boolean;
  run: () => unknown;
}

const MAX_RESULTS = 30;
/** Quand l'île a aussi trouvé quelque chose, on montre moins d'applis et de fichiers. */
const MAX_WITH_ISLAND = 8;
/** On attend un peu après la dernière frappe avant de chercher dans l'île. */
const ISLAND_DELAY_MS = 140;
const ICONS = { app: "📦", tool: "🛠️", recent: "📄" };
const TAGS = { app: "Appli", tool: "Outil", recent: "Récent" };
/** À égalité de note : d'abord l'île, puis les applis, les outils, les fichiers. */
const KIND_BONUS = { action: 4, app: 3, tool: 2, recent: 1 };

let listing: Listing = { items: [], hotkey: "", hotkeyError: null };
/** Les serveurs favoris du module Accès distants (reçus par le bus « remote.changed »). */
let servers: { id: number; name: string; kind: "rdp" | "ssh" }[] = [];
/** Les projets et agents proposés (module Agents IA, sujet « agents.projects »). */
let agentProjects: { index: number; name: string }[] = [];
let agentTools: string[] = ["claude"];
const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" };
/** La vue affichée, si elle l'est : pour remettre le focus dans la recherche. */
let shown: { focus: () => void; redraw: () => void } | null = null;

async function load(api: ModuleApi) {
  try {
    listing = await api.invoke<Listing>("entries");
  } catch {
    return; // hors de l'appli (navigateur), ou module en panne : on garde l'ancienne liste
  }
  shown?.redraw();
}

function fail(api: ModuleApi, err: unknown) {
  api.notify({ title: errorText(err), icon: "⚠️", priority: "normal", key: "launcher-error" });
}

/** Les actions de l'île qui correspondent à la recherche. */
function islandActions(api: ModuleApi, query: string): Result[] {
  const out: Result[] = [];
  const close = () => api.closeIsland();
  const add = (key: string, name: string, icon: string, words: string[], run: () => unknown) => {
    const best = Math.max(score(name, query), ...words.map((w) => score(w, query) - 5));
    if (best > 0) out.push({ key, name, detail: "", icon, tag: "Île", score: best + KIND_BONUS.action, run });
  };

  // « 10 », « 10 min », « minuteur 25 » → un minuteur de cette durée.
  const minutes = /^(?:minuteur\s*)?(\d{1,3})\s*(?:m|mn|min|minutes?)?$/.exec(normalize(query));
  if (minutes && settingsStore.moduleEnabled("timer")) {
    const n = Number(minutes[1]);
    if (n >= 1 && n <= 180) {
      out.push({
        key: "timer",
        name: `Lancer un minuteur de ${n} min`,
        detail: "",
        icon: "⏱️",
        tag: "Île",
        score: 120,
        run: () => (api.emit("timer.start", { minutes: n }), close()),
      });
    }
  }
  if (settingsStore.moduleEnabled("terminal")) {
    add("terminal", "Ouvrir un terminal", "🖥️", ["cmd", "powershell", "console", "invite de commandes"], async () => {
      await api.invoke("forget_focus"); // la console doit pouvoir passer devant
      api.emit("terminal.open", {});
      close();
    });
  }
  if (settingsStore.moduleEnabled("capture")) {
    // La pipette (module Capture) : l'île se replie, puis l'écran se fige sous une croix.
    add("pipette", "Pipette : copier une couleur de l'écran", "💧", ["pipette", "couleur", "color picker", "hex", "rgb"], () => {
      close();
      api.emit("capture.pick", {});
    });
  }
  add("settings", "Réglages de l'île", "⚙️", ["parametres", "options", "preferences"], async () => {
    await Bridge.openSettingsWindow();
    close();
  });
  // Les agents (Claude Code, Codex, Gemini) : un résultat par agent et par
  // projet (ou un seul par agent, dans le dossier utilisateur).
  if (settingsStore.moduleEnabled("agents")) {
    for (const tool of agentTools) {
      const name = AGENT_NAMES[tool] ?? tool;
      const words = [tool, name, "ia", "agent", "cli"];
      const launch = (index?: number) => async () => {
        await api.invoke("forget_focus"); // la console doit pouvoir passer devant
        api.emit("agents.launch", index === undefined ? { tool } : { tool, index });
        close();
      };
      if (!agentProjects.length) add(`agent-${tool}`, `Lancer ${name}`, agentIcon(tool), words, launch());
      for (const p of agentProjects) {
        add(`agent-${tool}-${p.index}`, `${name} · ${p.name}`, agentIcon(tool), words.map((w) => `${w} ${p.name}`).concat(words), launch(p.index));
      }
    }
  }
  // Les serveurs favoris : le module Accès distants ouvre la connexion.
  if (settingsStore.moduleEnabled("remote")) {
    for (const srv of servers) {
      const label = srv.kind === "rdp" ? "RDP" : "SSH";
      const best = Math.max(score(srv.name, query), score(`${label} ${srv.name}`, query) - 5);
      if (best > 0) {
        out.push({
          key: `remote-${srv.id}`,
          name: srv.name,
          detail: srv.kind === "rdp" ? "Bureau à distance" : "Terminal SSH",
          icon: srv.kind === "rdp" ? "🖥️" : "⌨️",
          tag: label,
          score: best + KIND_BONUS.app,
          run: () => (api.emit("remote.connect", { id: srv.id }), close()),
        });
      }
    }
  }
  // Un onglet par module affiché dans l'île.
  for (const m of ALL_MODULES) {
    const id = m.manifest.id;
    if (!m.views?.expanded || id === "launcher" || !settingsStore.moduleEnabled(id)) continue;
    add(`tab-${id}`, m.manifest.name, m.manifest.icon, [`onglet ${m.manifest.name}`], () => api.openIsland(id));
  }
  return out;
}

/** Ce qu'on montre pour la recherche `query`, le meilleur d'abord. */
function results(api: ModuleApi, query: string): Result[] {
  const q = query.trim();
  const found: Result[] = listing.items.map((it) => ({
    key: `${it.kind}-${it.id}`,
    name: it.name,
    detail: it.kind === "app" ? "" : it.detail,
    icon: ICONS[it.kind],
    tag: TAGS[it.kind],
    // Sans recherche, seuls les fichiers récents sont proposés (dans leur ordre).
    score: q ? score(it.name, q) + (score(it.name, q) > 0 ? KIND_BONUS[it.kind] : 0) : it.kind === "recent" ? 1 : 0,
    run: async () => {
      await api.invoke("launch", { id: it.id });
      api.closeIsland();
    },
  }));
  const all = [...(q ? islandActions(api, q) : []), ...found].filter((r) => r.score > 0);
  // Tri stable : à note égale, l'ordre d'origine (récents du plus récent au plus ancien).
  return all.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

/** « Super+Shift+Space » → « Win+Maj+Espace ». */
function prettyHotkey(keys: string): string {
  return keys.replace("Super", "Win").replace("Shift", "Maj").replace("Space", "Espace");
}

export const launcher: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    // Le raccourci global a été pressé (message du Rust).
    api.on("launcher.open", () => {
      api.openIsland("launcher");
      // L'île était peut-être déjà ouverte, sans le focus clavier : on le reprend.
      void Bridge.islandSetFocus(true);
      shown?.focus();
      void load(api);
    });
    api.on("agents.projects", (msg) => {
      const p = msg.payload as { projects?: typeof agentProjects; tools?: string[] } | null;
      if (Array.isArray(p?.projects)) agentProjects = p.projects;
      if (Array.isArray(p?.tools)) agentTools = p.tools;
    });
    api.on("remote.changed", (msg) => {
      const list = (msg.payload as { favorites?: typeof servers } | null)?.favorites;
      if (Array.isArray(list)) servers = list;
    });
    api.on("launcher.hotkey-error", (msg) => {
      const text = (msg.payload as { text?: string } | null)?.text ?? "raccourci du lanceur indisponible";
      api.notify({ title: text, icon: "⌨️", priority: "normal", key: "launcher-hotkey" });
      void load(api);
    });
    void load(api);
  },

  views: {
    expanded(root, api) {
      const search = el("input", {
        class: "clip-search launch-search",
        type: "search",
        placeholder: "Une appli, un fichier, une note, une copie… (ou « 10 min »)",
        spellcheck: "false",
        autocomplete: "off",
      }) as HTMLInputElement;
      const list = el("ul", { class: "launch-list" });
      // La recherche dans l'île : les derniers résultats reçus, et pour quelle recherche.
      let found: { query: string; groups: FoundGroup[] } = { query: "", groups: [] };
      let searchTimer = 0;
      let searchSeq = 0;
      const foot = el("div", { class: "launch-foot muted" });
      root.append(el("div", { class: "launch" }, search, list, foot));

      let current: Result[] = [];
      let selected = 0;
      let first = true;

      const select = (i: number) => {
        selected = Math.max(0, Math.min(current.length - 1, i));
        const items = list.querySelectorAll(".launch-item");
        items.forEach((n, k) => n.classList.toggle("sel", k === selected));
        items[selected]?.scrollIntoView({ block: "nearest" });
      };

      /** Cherche dans l'île un instant après la dernière frappe ; une réponse en retard est ignorée. */
      const askIsland = () => {
        window.clearTimeout(searchTimer);
        const query = search.value.trim();
        if (query.length < MIN_QUERY) {
          found = { query: "", groups: [] };
          return;
        }
        const seq = ++searchSeq;
        searchTimer = window.setTimeout(async () => {
          const groups = await searchIsland(api, query).catch(() => [] as FoundGroup[]);
          if (seq !== searchSeq || search.value.trim() !== query) return;
          found = { query, groups };
          draw();
        }, ISLAND_DELAY_MS);
      };

      /** Une ligne de résultat (bouton). */
      const item = (r: Result, i: number) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              class: `launch-item${i === selected ? " sel" : ""}${r.done ? " done" : ""}`,
              title: r.detail || r.name,
              onclick: api.handler(() => run(r)),
              onmousemove: () => selected !== i && select(i),
            },
            el("span", { class: "launch-icon" }, icon(r.icon)),
            el("span", { class: "launch-text" }, el("b", {}, r.name), r.detail ? el("small", { class: "muted" }, r.detail) : null),
            el("span", { class: "launch-tag" }, r.tag),
          ),
        );

      const run = async (r: Result | undefined) => {
        if (!r) return;
        try {
          await r.run();
          search.value = "";
        } catch (err) {
          fail(api, err);
          void load(api); // l'entrée a peut-être disparu : on relit
        }
      };

      const draw = () => {
        // Les résultats de l'île ne valent que pour la recherche qui les a demandés.
        const groups = found.query === search.value.trim() ? found.groups : [];
        const flat = results(api, search.value).slice(0, groups.length ? MAX_WITH_ISLAND : MAX_RESULTS);
        current = [...flat];
        selected = 0;
        const rows: HTMLElement[] = flat.map((r, i) => item(r, i));
        for (const g of groups) {
          const section = SECTIONS[g.source];
          rows.push(el("li", { class: "launch-section muted" }, icon(section.icon), " ", el("span", {}, section.label)));
          for (const row of rowsOf(api, g)) {
            const r: Result = { ...row, score: 0 };
            rows.push(item(r, current.length));
            current.push(r);
          }
        }
        list.replaceChildren(...rows);
        if (!current.length) {
          list.append(el("li", { class: "muted launch-empty" }, search.value.trim() ? "Rien trouvé." : "Tapez le nom d'une appli, d'un fichier, d'un onglet, ou un mot de vos notes."));
        }
        setLabel(
          foot,
          listing.hotkeyError
            ? `⚠️ ${listing.hotkeyError}`
            : listing.hotkey
              ? `${prettyHotkey(listing.hotkey)} pour ouvrir · ↑ ↓ pour choisir · Entrée pour ouvrir`
              : "↑ ↓ pour choisir · Entrée pour ouvrir",
        );
        foot.classList.toggle("bad", Boolean(listing.hotkeyError));
        // Petite entrée en cascade à l'ouverture seulement (pas à chaque frappe).
        if (first && !reducedMotion()) {
          [...list.querySelectorAll<HTMLElement>(".launch-item")].slice(0, 7).forEach((n, i) =>
            n.animate([{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], {
              duration: 260,
              delay: i * 22,
              easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
              fill: "backwards",
            }),
          );
        }
        first = false;
      };

      search.addEventListener("input", () => {
        draw();
        askIsland();
      });
      search.addEventListener(
        "keydown",
        api.handler((e: KeyboardEvent) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); // sinon le curseur saute au début / à la fin du texte
            select(selected + (e.key === "ArrowDown" ? 1 : -1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            // Un mot magique (« réveille-toi », « rétro »…) : une surprise d'Ondine (src/eggs/).
            const word = settingsStore.current.mascot.surprises === "all" ? magicWord(search.value) : null;
            if (word) {
              api.emit("easter.word", { word });
              search.value = "";
              draw();
              return;
            }
            return run(current[selected]);
          }
          // Échap : l'île s'en occupe (elle se referme).
        }),
      );

      shown = {
        focus: () => {
          search.focus();
          search.select();
        },
        redraw: draw,
      };
      draw();
      search.focus();
      void load(api);
      return () => {
        window.clearTimeout(searchTimer);
        shown = null;
      };
    },
  },
};
