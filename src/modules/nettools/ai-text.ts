// Petits textes de la surveillance des services IA (ai.ts), sans DOM :
// testés par tests/front/ai-status.test.ts.

export type AiLevel = "ok" | "degraded" | "down" | "unknown";

export interface AiReading {
  id: string;
  name: string;
  level: AiLevel;
  description: string;
  checkedAt: number;
}

export interface AiOutage {
  id: string;
  from: number;
  to: number | null;
  level: AiLevel;
}

export const AI_NAMES: Record<string, string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

/** « fonctionne », « perturbé », « en panne », « état inconnu ». */
export function levelText(level: AiLevel): string {
  return { ok: "fonctionne", degraded: "perturbé", down: "en panne", unknown: "état inconnu" }[level];
}

/** « 45 min », « 2 h 10 », « 3 j ». */
export function durationText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} h ${String(min % 60).padStart(2, "0")}` : `${h} h`;
  return `${Math.round(h / 24)} j`;
}

/** Une ligne de l'historique : « Claude · en panne · 45 min » ou « … · en cours ». */
export function outageText(o: AiOutage, now: number): string {
  const name = AI_NAMES[o.id] ?? o.id;
  const what = o.level === "down" ? "en panne" : "perturbé";
  return o.to === null ? `${name} · ${what} · en cours depuis ${durationText(now - o.from)}` : `${name} · ${what} · ${durationText(o.to - o.from)}`;
}

/** La notification quand un service change : « Claude a un incident » / « Claude fonctionne à nouveau ». */
export function changeTitle(r: AiReading): string {
  if (r.level === "down") return `${r.name} est en panne`;
  if (r.level === "degraded") return `${r.name} a un incident en cours`;
  return `${r.name} fonctionne à nouveau`;
}

/** Quel service fait tourner cet agent ? (source de agents.event) */
export function serviceOfAgent(source: string): string | null {
  const s = source.toLowerCase();
  if (s.includes("claude")) return "claude";
  if (s.includes("codex") || s.includes("openai") || s.includes("chatgpt")) return "chatgpt";
  if (s.includes("gemini")) return "gemini";
  return null;
}
