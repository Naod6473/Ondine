// Mises à jour des logiciels : la logique sans DOM (testée dans
// tests/front/updates.test.ts). Le Rust (src-tauri/src/modules/updates.rs)
// lance winget et tient la file ; ici, ce qu'on en dit à l'écran.

/** Une appli qui a une mise à jour (`status`, côté Rust). */
export interface Pkg {
  name: string;
  id: string;
  version: string;
  available: string;
  source: string;
  truncated: boolean;
  explicit: boolean;
  ignored: boolean;
}

export type Phase = "prepare" | "download" | "install";

/** Comment une mise à jour s'est terminée (updates_parse.rs, `Outcome`). */
export type Outcome =
  | "ok"
  | "reboot"
  | "upToDate"
  | "admin"
  | "cancelled"
  | "inUse"
  | "busy"
  | "diskFull"
  | "network"
  | "hash"
  | "policy"
  | "noInstaller"
  | "notFound"
  | "unsupported"
  | "timeout"
  | "failed";

export interface Job {
  id: string;
  name: string;
  version: string;
  available: string;
  source: string;
}

export interface Running extends Job {
  phase: Phase;
  pct: number | null;
  startedAt: number;
}

export interface Done {
  id: string;
  name: string;
  available: string;
  outcome: Outcome;
  code: string;
  at: number;
}

export interface Status {
  missing: boolean;
  checking: boolean;
  lastCheck: number | null;
  error: string | null;
  packages: Pkg[];
  ignored: string[];
  queue: Job[];
  current: Running | null;
  done: Done[];
  batch: { total: number; done: number };
}

export const EMPTY_STATUS: Status = {
  missing: false,
  checking: false,
  lastCheck: null,
  error: null,
  packages: [],
  ignored: [],
  queue: [],
  current: null,
  done: [],
  batch: { total: 0, done: 0 },
};

/** La phrase courte de chaque résultat (affichée sous le nom de l'appli). */
export const OUTCOME_TEXT: Record<Outcome, string> = {
  ok: "Mise à jour faite",
  reboot: "Mise à jour faite · redémarrage demandé",
  upToDate: "Déjà à jour",
  admin: "Demande les droits d'administrateur",
  cancelled: "Annulée (autorisation refusée ?)",
  inUse: "L'appli est ouverte : fermez-la puis réessayez",
  busy: "Une autre installation est en cours",
  diskFull: "Disque plein",
  network: "Téléchargement impossible (réseau)",
  hash: "Fichier téléchargé suspect : refusé",
  policy: "Bloquée par une stratégie de l'entreprise",
  noInstaller: "Pas d'installateur pour ce PC",
  notFound: "winget ne trouve plus cette appli",
  unsupported: "À mettre à jour depuis l'appli elle-même",
  timeout: "Trop longue : arrêtée",
  failed: "Échec",
};

/** Réussie (l'appli sort de la liste), avec ou sans redémarrage. */
export function succeeded(o: Outcome): boolean {
  return o === "ok" || o === "reboot" || o === "upToDate";
}

/** La ligne de résultat : la phrase, et le code de winget pour un échec inconnu. */
export function outcomeLine(d: Pick<Done, "outcome" | "code">): string {
  const text = OUTCOME_TEXT[d.outcome] ?? OUTCOME_TEXT.failed;
  return d.outcome === "failed" && d.code ? `${text} (${d.code})` : text;
}

export const PHASE_TEXT: Record<Phase, string> = {
  prepare: "Préparation…",
  download: "Téléchargement…",
  install: "Installation…",
};

/** Il y a combien de temps (secondes Unix → « à l'instant », « il y a 5 min »…). */
export function agoText(at: number | null, nowSecs: number): string {
  if (!at) return "Jamais vérifié";
  const s = Math.max(0, nowSecs - at);
  if (s < 60) return "Vérifié à l'instant";
  if (s < 3600) return `Vérifié il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `Vérifié il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "Vérifié hier" : `Vérifié il y a ${d} jours`;
}

/** « 1 mise à jour », « 3 mises à jour », « Tout est à jour ». */
export function countText(n: number): string {
  if (n <= 0) return "Tout est à jour";
  return n === 1 ? "1 mise à jour" : `${n} mises à jour`;
}

/** Les applis à proposer (sans les ignorées), dans l'ordre de winget. */
export function visible(st: Status): Pkg[] {
  return st.packages.filter((p) => !p.ignored);
}

/** L'état d'une ligne de la liste. */
export type RowState =
  | { kind: "idle" }
  | { kind: "queued"; position: number }
  | { kind: "running"; phase: Phase; pct: number | null }
  | { kind: "done"; outcome: Outcome; code: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function rowState(st: Status, id: string): RowState {
  if (st.current && same(st.current.id, id)) return { kind: "running", phase: st.current.phase, pct: st.current.pct };
  const q = st.queue.findIndex((j) => same(j.id, id));
  if (q >= 0) return { kind: "queued", position: q + 1 };
  const d = st.done.find((x) => same(x.id, id));
  if (d) return { kind: "done", outcome: d.outcome, code: d.code };
  return { kind: "idle" };
}

/**
 * Les résultats à montrer sous la liste : ceux des applis qui n'y sont plus
 * (réussies), les plus récents d'abord. Les échecs restent sur leur ligne.
 */
export function finished(st: Status): Done[] {
  return st.done.filter((d) => !st.packages.some((p) => same(p.id, d.id))).sort((a, b) => b.at - a.at);
}

/** La file tourne-t-elle (une en cours, ou en attente) ? */
export function busy(st: Status): boolean {
  return !!st.current || st.queue.length > 0;
}

/** « 2 sur 5 » pendant une série. */
export function batchText(st: Status): string {
  const { total, done } = st.batch;
  if (!busy(st) || total <= 1) return "";
  return `${Math.min(done + 1, total)} sur ${total}`;
}

/** La notification de fin de série. */
export function finishedNote(r: { ok: number; failed: number; reboot: number }): { title: string; body?: string; tone?: "good" | "bad" } | null {
  const { ok, failed, reboot } = r;
  if (ok + failed === 0) return null;
  const title =
    failed === 0 ? (ok === 1 ? "1 appli mise à jour" : `${ok} applis mises à jour`) : ok === 0 ? (failed === 1 ? "La mise à jour a échoué" : `${failed} mises à jour ont échoué`) : `${ok} à jour, ${failed} en échec`;
  const body = reboot > 0 ? (reboot === 1 ? "Une appli demande de redémarrer le PC." : `${reboot} applis demandent de redémarrer le PC.`) : failed > 0 ? "Ouvrez l'onglet pour voir pourquoi." : undefined;
  return { title, body, tone: failed === 0 ? "good" : ok === 0 ? "bad" : undefined };
}

/** « 128.0 → 129.0.1 » ; une version inconnue de winget (« Unknown », « < 1.2 ») reste telle quelle. */
export function versionText(p: Pick<Pkg, "version" | "available">): string {
  return `${p.version} → ${p.available}`;
}
