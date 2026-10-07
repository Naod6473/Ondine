// Étagère : la cible de dépôt « Empreinte » (SHA-256 d'un fichier).
//
// Le Rust (src-tauri/src/modules/shelf_hash.rs) lit le fichier par blocs dans
// un thread. Si le presse-papiers contient une empreinte (MD5, SHA-1, SHA-256,
// SHA-512), il calcule le même algorithme et dit si c'est identique. Ici, on
// lance le calcul et on montre le résultat dans une notification, avec
// « Copier ». Le texte copié ne quitte jamais le Rust : seul « identique : oui
// / non » arrive ici.

import { errorText } from "../../core/log";
import type { DropTarget, ModuleApi } from "../../core/module-types";

/** Ce que le Rust répond quand le calcul démarre. */
interface HashStarted {
  job: number;
  algo: string;
  /** Une empreinte copiée sert de comparaison. */
  compare: boolean;
  count: number;
}

/** Le résultat d'un fichier : son empreinte, ou une erreur (fichier illisible…). */
interface HashResult {
  name: string;
  hex?: string;
  /** null : rien à comparer. */
  matches?: boolean | null;
  error?: string;
}

/** Le message "shelf.hashed". */
interface HashDone {
  job: number;
  algo: string;
  compared: boolean;
  cancelled?: boolean;
  error?: string;
  results: HashResult[];
}

const KEY = "shelf-hash";

/** Le calcul en cours (pour la notification de progression). */
let running: HashStarted | null = null;
/**
 * Le dernier calcul déjà terminé. Un petit fichier peut finir (« shelf.hashed »)
 * AVANT que la réponse de `hash` arrive ici : sans ce numéro, la progression
 * s'afficherait par-dessus le résultat et ne partirait plus.
 */
let lastDone = 0;

/** La cible de dépôt. */
export function hashTarget(api: ModuleApi): DropTarget {
  return { id: "shelf-hash", label: "Empreinte", icon: "#️⃣", onDrop: (paths) => startHash(api, paths) };
}

/** Le titre pendant le calcul : « SHA-256… », « SHA-256 : 45 % ». */
function progressTitle(r: HashStarted, percent?: number): string {
  const what = r.compare ? `Comparaison ${r.algo}` : `Empreinte ${r.algo}`;
  return percent === undefined ? `${what}…` : `${what} : ${percent} %`;
}

function showProgress(api: ModuleApi, r: HashStarted, percent?: number) {
  api.notify({
    title: progressTitle(r, percent),
    icon: "⏳",
    priority: "low",
    key: KEY,
    sticky: true,
    actions: [{ label: "Arrêter", run: async () => void (await api.invoke("hash_cancel").catch(() => {})) }],
  });
}

async function startHash(api: ModuleApi, paths: string[]) {
  try {
    const started = await api.invoke<HashStarted>("hash", { paths });
    // Déjà fini (petit fichier) : le résultat est affiché, rien à montrer de plus.
    if (started.job <= lastDone) return;
    running = started;
    showProgress(api, running);
  } catch (err) {
    api.notify({ title: "Empreinte impossible", body: errorText(err), icon: "⚠️", priority: "normal", key: KEY });
  }
}

/** « Copier » : le Rust recopie le résultat de ce calcul (empreinte seule, ou une ligne par fichier). */
function copyAction(api: ModuleApi, job: number) {
  return {
    label: "Copier",
    run: async () => {
      try {
        await api.invoke("hash_copy", { job });
        api.notify({ title: "Empreinte copiée", icon: "📋", priority: "low", key: KEY });
      } catch (err) {
        api.notify({ title: "Copie impossible", body: errorText(err), icon: "⚠️", priority: "low", key: KEY });
      }
    },
  };
}

/** Le résultat : identique ✓ (vert), différente ✗ (rouge), ou l'empreinte seule. */
export function resultNotice(done: HashDone): { title: string; body: string; icon: string; tone?: "good" | "bad" } {
  const ok = done.results.filter((r) => r.hex);
  const failed = done.results.filter((r) => !r.hex);
  const errors = failed.map((r) => `${r.name} : ${r.error ?? "illisible"}`).join(" · ");
  if (done.results.length === 1 && ok.length === 1) {
    // (Ni phrase ni mot à traduire : l'algorithme, le nom, l'empreinte.)
    const r = ok[0];
    const body = `${done.algo} · ${r.name} · ${r.hex}`;
    if (done.compared) {
      return r.matches ? { title: "Identique ✓", body, icon: "✅", tone: "good" } : { title: "Différente ✗", body, icon: "❌", tone: "bad" };
    }
    return { title: `${done.algo} · ${r.name}`, body: r.hex!, icon: "#️⃣" };
  }
  if (!ok.length) return { title: "Empreinte impossible", body: errors, icon: "⚠️", tone: "bad" };
  const lines = ok.map((r) => (done.compared ? `${r.name} ${r.matches ? "✓" : "✗"}` : `${r.name} : ${r.hex!.slice(0, 12)}…`));
  const body = [lines.join(" · "), errors].filter(Boolean).join(" · ");
  if (!done.compared) return { title: `Empreintes ${done.algo} (${ok.length} fichiers)`, body, icon: "#️⃣" };
  const same = ok.filter((r) => r.matches).length;
  return same === ok.length && !failed.length
    ? { title: `Identiques ✓ (${same} fichiers)`, body, icon: "✅", tone: "good" }
    : { title: `Différentes ✗ : ${ok.length - same + failed.length} sur ${done.results.length}`, body, icon: "❌", tone: "bad" };
}

/** Écoute la progression et le résultat. Renvoie de quoi arrêter d'écouter. */
export function listenHash(api: ModuleApi): () => void {
  const offProgress = api.on("shelf.hash-progress", (msg) => {
    const p = msg.payload as { job: number; percent: number };
    if (running && running.job === p.job) showProgress(api, running, p.percent);
  });
  const offDone = api.on("shelf.hashed", (msg) => {
    const done = msg.payload as HashDone;
    running = null;
    lastDone = Math.max(lastDone, done.job);
    if (done.cancelled) {
      api.notify({ title: "Empreinte arrêtée", icon: "⏹️", priority: "low", key: KEY });
      return;
    }
    if (done.error) {
      api.notify({ title: "Empreinte impossible", body: done.error, icon: "⚠️", priority: "normal", key: KEY });
      return;
    }
    const n = resultNotice(done);
    const copyable = done.results.some((r) => r.hex);
    // En alerte : l'île s'ouvre assez pour montrer l'empreinte entière.
    api.notify({ ...n, priority: "high", wide: true, key: KEY, durationMs: 30_000, actions: copyable ? [copyAction(api, done.job)] : [] });
  });
  return () => {
    offProgress();
    offDone();
  };
}
