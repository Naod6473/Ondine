// Petits textes du module Agents IA, sans DOM ni Tauri (testés dans
// tests/front/agents.test.ts) : le bilan de fin de tâche et « il y a 2 h ».

/** Le bilan d'une fin de tâche (src-tauri/src/modules/agents_git.rs). */
export interface ChangeSummary {
  files: number;
  added: number;
  removed: number;
  /** Les fichiers les plus changés, 3 au plus (sans leur dossier). */
  names: string[];
}

/** « 3 fichiers modifiés, +120 −14 » (« 1 fichier modifié, +5 −0 »). */
export function changesLine(c: ChangeSummary): string {
  const s = c.files > 1 ? "s" : "";
  return `${c.files} fichier${s} modifié${s}, +${c.added} −${c.removed}`;
}

/** « main.rs, index.ts, README.md… » (« … » : il y en a d'autres). */
export function namesLine(c: ChangeSummary): string {
  return c.names.join(", ") + (c.files > c.names.length ? "…" : "");
}

/** « à l'instant », « il y a 5 min », « il y a 2 h », « il y a 3 j », sinon la date. */
export function since(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 30 * 86_400) return `il y a ${Math.floor(s / 86_400)} j`;
  return new Date(ms).toLocaleDateString("fr-FR");
}

// ── Le compteur de jetons (commande « usage », src-tauri/src/modules/agents_usage.rs) ──

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Le nombre de réponses des agents. */
  messages: number;
}
/** Un jour local (« 2026-10-08 »), un outil (« claude-code », « codex ») et un modèle. */
export interface UsageDay extends UsageTokens {
  day: string;
  tool: string;
  model: string;
}
/** Un projet (le nom de son dossier) sur toute la période lue. */
export interface UsageProject extends UsageTokens {
  name: string;
  tool: string;
}
export interface UsageReport {
  days: UsageDay[];
  projects: UsageProject[];
  tools: string[];
  files: number;
  /** Trop de journaux : seuls les plus récents ont été lus. */
  partial: boolean;
}

export type UsagePeriod = "today" | "week" | "month";

/** Le jour local « AAAA-MM-JJ » (la forme des `UsageDay.day`). */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Le premier jour d'une période : aujourd'hui, il y a 6 jours, il y a 29 jours. */
export function periodFrom(period: UsagePeriod, now = new Date()): string {
  const back = { today: 0, week: 6, month: 29 }[period];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return dayKey(d);
}

export function totalTokens(t: UsageTokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function sumTokens(rows: UsageTokens[]): UsageTokens {
  const sum: UsageTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
  for (const r of rows) {
    sum.input += r.input;
    sum.output += r.output;
    sum.cacheRead += r.cacheRead;
    sum.cacheWrite += r.cacheWrite;
    sum.messages += r.messages;
  }
  return sum;
}

/** Les jetons par outil et modèle, les plus gros d'abord. */
export function byModel(rows: UsageDay[]): { tool: string; model: string; total: number; messages: number }[] {
  const map = new Map<string, { tool: string; model: string; total: number; messages: number }>();
  for (const r of rows) {
    const key = `${r.tool}/${r.model}`;
    const m = map.get(key) ?? { tool: r.tool, model: r.model, total: 0, messages: 0 };
    m.total += totalTokens(r);
    m.messages += r.messages;
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
}

/** « 985 », « 12,3 k », « 123 k », « 1,2 M », « 2 G » : des jetons, en bref. */
export function tokensShort(n: number): string {
  if (!(n >= 1000)) return String(Math.max(0, Math.round(n || 0)));
  const short = (x: number, unit: string) => `${(x < 100 ? x.toFixed(1) : String(Math.round(x))).replace(".", ",").replace(/,0$/, "")} ${unit}`;
  if (n < 1e6) return short(n / 1e3, "k");
  if (n < 1e9) return short(n / 1e6, "M");
  return short(n / 1e9, "G");
}

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** « claude-opus-5-5 » → « Opus 5.5 », « claude-3-5-haiku-20241022 » → « Haiku 3.5 », « gpt-5-codex » → « GPT-5 Codex ». */
export function modelLabel(id: string): string {
  const s = id.trim().toLowerCase();
  if (!s || s.startsWith("<") || s === "?") return "—";
  const m = s
    .replace(/\[.*\]$/, "")
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-(latest|preview)$/, "");
  const after = m.match(/^(opus|sonnet|haiku)-(\d+(?:-\d+)*)$/);
  if (after) return `${cap(after[1])} ${after[2].replace(/-/g, ".")}`;
  const before = m.match(/^(\d+(?:-\d+)*)-(opus|sonnet|haiku)$/);
  if (before) return `${cap(before[2])} ${before[1].replace(/-/g, ".")}`;
  if (m.startsWith("gpt-")) return `GPT-${m.slice(4).split("-").map((w, i) => (i ? cap(w) : w)).join(" ")}`;
  if (/^o\d/.test(m)) return m;
  return cap(m);
}
