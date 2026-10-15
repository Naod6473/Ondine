// Module « Ondine convertit » (1.2.5) : un fichier glissé vers l'île, lâché
// sur une pilule de format, est converti.
//
// Pas d'onglet. Le geste (les pilules sous l'île, avaler, mâcher, recracher)
// est dessiné par l'île (src/island/convert-gesture.ts), qui publie le choix
// sur le bus (« convert.request »). Ici :
//   - on appelle le Rust (`start`, src-tauri/src/modules/convert.rs), qui
//     convertit dans un thread et répond par « convert.progress » et
//     « convert.done » ;
//   - la mini-île montre l'avancement (vue compacte) : « vacances.heic → JPG »,
//     « Je mâche… 42 % », puis « C'est prêt ! » ou la raison d'un échec ;
//   - « Ouvrir » (convert.open) et « Arrêter » (convert.cancel), demandés par
//     les pilules de l'île, passent par les commandes du module.
//
// Confidentialité : tout se fait sur ce PC ; rien n'est écrit dans le journal
// (ni nom ni contenu), rien ne part sur Internet.

import manifest from "./manifest.json";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { currentLang, t } from "../../core/i18n";
import { asDest, baseName, MAX_FILES, progressLine, summarize, workTitle, type Dest, type DoneMessage } from "./convert-logic";
import "../../styles/convert.css";

/** Ce que montre la mini-île (en mémoire seulement). */
interface Shown {
  title: string;
  line: string;
  state: "work" | "ok" | "fail";
}

let shown: Shown | null = null;
let dest: Dest = "keep";
let clearTimer = 0;
/** Les vues compactes montées, à redessiner quand l'avancement change. */
const redraws = new Set<() => void>();
/** La mini-île garde le résultat un peu plus que la pilule (10 s). */
const SHOWN_AFTER_MS = 11_000;

function redraw() {
  redraws.forEach((draw) => draw());
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_FILES) : [];
}

/** Un échec côté front (le Rust a refusé, ou n'est pas joignable) : même forme que le Rust. */
function failed(paths: string[], err: unknown): DoneMessage {
  const error = String(err).replace(/^Error:\s*/, "");
  return {
    job: 0,
    ok: false,
    total: paths.length,
    failed: paths.length,
    error,
    results: paths.map((p) => ({ name: baseName(p), out: null, outName: null, before: 0, after: 0, error })),
  };
}

function start(api: ModuleApi, payload: unknown) {
  const p = (payload ?? {}) as { paths?: unknown; format?: unknown; label?: unknown; dest?: unknown };
  const paths = strings(p.paths);
  if (!paths.length || typeof p.format !== "string") return;
  dest = asDest(p.dest);
  window.clearTimeout(clearTimer);
  shown = { title: workTitle(paths, typeof p.label === "string" ? p.label : p.format), line: "J'avale…", state: "work" };
  redraw();
  api.refreshCompact();
  api.invoke("start", { paths, format: p.format, dest }).catch((err) => api.emit("convert.done", failed(paths, err)));
}

export const convert: IslandModule = {
  manifest: manifest as ModuleManifest,

  setup(api) {
    const offs = [
      api.on("convert.request", (msg) => start(api, msg.payload)),
      api.on("convert.progress", (msg) => {
        const p = msg.payload as { index?: number; total?: number; fraction?: number } | null;
        if (shown?.state !== "work" || typeof p?.fraction !== "number") return;
        shown.line = progressLine(p.index ?? 0, p.total ?? 1, p.fraction);
        redraw();
      }),
      api.on("convert.done", (msg) => {
        const d = msg.payload as DoneMessage | null;
        if (!d || !shown) return;
        const s = summarize(d, dest, t, currentLang() !== "fr");
        shown = s.ok ? { title: "C'est prêt !", line: s.line, state: "ok" } : { title: "Oups, je n'y arrive pas", line: s.detail, state: "fail" };
        redraw();
        api.refreshCompact();
        window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => {
          shown = null;
          api.refreshCompact();
        }, SHOWN_AFTER_MS);
      }),
      // « Ouvrir » dans la pilule de résultat : seulement un fichier de la dernière conversion (vérifié par le Rust).
      api.on("convert.open", (msg) => {
        const path = (msg.payload as { path?: unknown } | null)?.path;
        if (typeof path !== "string") return;
        void api.invoke("open", { path }).catch((err) =>
          api.notify({ title: "Ondine convertit", body: String(err).replace(/^Error:\s*/, ""), icon: "🔀", priority: "low", key: "convert-open" }),
        );
      }),
      // Un clic sur la pilule qui se remplit : « Arrêter ».
      api.on("convert.cancel", () => void api.invoke("cancel").catch(() => undefined)),
    ];
    return () => {
      offs.forEach((off) => off());
      window.clearTimeout(clearTimer);
      shown = null;
    };
  },

  views: {
    // La mini-île pendant le travail et un moment après.
    compactWhen: () => shown !== null,

    compact(root) {
      const title = el("b", { class: "convert-compact-title" });
      const line = el("span", { class: "convert-compact-line" });
      root.append(el("div", { class: "convert-compact", role: "status" }, title, line));
      const draw = () => {
        if (!shown) return;
        // Le nom du fichier n'est pas traduit ; « C'est prêt ! » l'est.
        title.toggleAttribute("data-no-i18n", shown.state === "work");
        // La ligne d'un résultat est déjà traduite (summarize) ; « Je mâche… 42 % » ne l'est pas.
        line.toggleAttribute("data-no-i18n", shown.state !== "work");
        if (title.textContent !== shown.title) title.textContent = shown.title;
        if (line.textContent !== shown.line) line.textContent = shown.line;
        root.dataset.convert = shown.state;
      };
      draw();
      redraws.add(draw);
      return () => redraws.delete(draw);
    },
  },
};
