// L'aquarium de gouttes : la logique pure (sans DOM), testée par
// tests/front/games.test.ts.
//
// La progression est tenue par le Rust (src-tauri/src/modules/games.rs, fichier
// %APPDATA%\Ondine\games.json) : c'est lui qui compte les gouttes gagnées
// (tâches d'agents finies, pauses, Pomodoros, parties gagnées), les achats et
// la tenue d'Ondine. Le catalogue et le barème sont dans aquarium.json, lu par
// les deux côtés (le Rust avec include_str!).
//
// Ce fichier refait les mêmes règles en TypeScript pour deux cas seulement :
// le mode démo et le navigateur (npm run dev), où rien n'arrive au Rust : la
// progression vit alors en mémoire, le temps de la session. Les tests vérifient
// que les deux côtés suivent le même barème.

import catalog from "./aquarium.json";

export type ItemKind = "decor" | "head" | "eyes" | "neck";
export type WearSlot = Exclude<ItemKind, "decor">;

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  price: number;
}

export interface Tally {
  win: number;
  lose: number;
  draw: number;
}

/** Ce que le Rust rend (`state`) : des nombres et des identifiants, rien d'autre. */
export interface AquaState {
  /** Les gouttes à dépenser. */
  drops: number;
  /** Toutes les gouttes gagnées depuis le début (l'aquarium grandit avec). */
  earned: number;
  /** Gagnées aujourd'hui (plafonnées à dailyCap), et le jour en question (« 2026-10-15 »). */
  today: number;
  day: string;
  owned: string[];
  wear: Record<WearSlot, string>;
  stats: Record<"connect4" | "ttt" | "race", Tally>;
  /** La dernière pause comptée (secondes depuis 1970), pour l'écart minimal. */
  lastPause: number;
}

export const ITEMS: Item[] = catalog.items as Item[];
export const REWARDS: Record<string, number> = catalog.rewards;
export const DAILY_CAP: number = catalog.dailyCap;
export const STAGES: number[] = catalog.stages;
export const PAUSE_GAP_SECS: number = catalog.pauseGapMins * 60;

export function emptyState(day = ""): AquaState {
  return {
    drops: 0,
    earned: 0,
    today: 0,
    day,
    owned: [],
    wear: { head: "none", eyes: "none", neck: "none" },
    stats: { connect4: { win: 0, lose: 0, draw: 0 }, ttt: { win: 0, lose: 0, draw: 0 }, race: { win: 0, lose: 0, draw: 0 } },
    lastPause: 0,
  };
}

export function itemOf(id: string): Item | undefined {
  return ITEMS.find((i) => i.id === id);
}

/** Le niveau de l'aquarium (1 à 6) selon les gouttes gagnées depuis le début. */
export function stageOf(earned: number): number {
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (earned >= STAGES[i]) s = i;
  return s + 1;
}

/** Ce qu'il faut encore gagner pour le niveau suivant (null au dernier). */
export function toNextStage(earned: number): number | null {
  const next = STAGES.find((s) => s > earned);
  return next === undefined ? null : next - earned;
}

/** « 2026-10-15 » : le jour local (le Rust fait pareil avec l'heure du PC). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Le nom de la récompense d'une partie (« connect4-win-hard »), ou null si elle ne rapporte rien. */
export function rewardKey(game: string, outcome: string, level: string): string | null {
  if (game === "race") return outcome === "win" || outcome === "second" ? `race-${outcome}` : null;
  if (game !== "connect4" && game !== "ttt") return null;
  if (outcome !== "win" && outcome !== "draw") return null;
  const key = `${game}-${outcome}-${level}`;
  return key in REWARDS ? key : null;
}

/**
 * Ajoute une récompense (sur une copie) : le compte du jour repart à zéro un
 * nouveau jour, et ne dépasse jamais DAILY_CAP. Renvoie l'état et le gain.
 */
export function addReward(s: AquaState, key: string, now: Date): { state: AquaState; gained: number } {
  const out: AquaState = { ...s, wear: { ...s.wear }, owned: s.owned.slice() };
  const day = dayKey(now);
  if (out.day !== day) {
    out.day = day;
    out.today = 0;
  }
  const want = REWARDS[key] ?? 0;
  if (key === "pause") {
    const secs = Math.floor(now.getTime() / 1000);
    if (secs - out.lastPause < PAUSE_GAP_SECS) return { state: s, gained: 0 };
    out.lastPause = secs;
  }
  const gained = Math.max(0, Math.min(want, DAILY_CAP - out.today));
  out.drops += gained;
  out.earned += gained;
  out.today += gained;
  return { state: out, gained };
}

/** Note le résultat d'une partie (statistiques) et sa récompense. */
export function addResult(s: AquaState, game: string, outcome: string, level: string, now: Date): { state: AquaState; gained: number } {
  const stats = { ...s.stats };
  if (game === "connect4" || game === "ttt" || game === "race") {
    const t = { ...stats[game] };
    if (outcome === "win") t.win++;
    else if (outcome === "draw" || outcome === "second") t.draw++;
    else t.lose++;
    stats[game] = t;
  }
  const key = rewardKey(game, outcome, level);
  const base = { ...s, stats };
  return key ? addReward(base, key, now) : { state: base, gained: 0 };
}

/** Pourquoi on ne peut pas acheter (null : c'est possible). */
export function buyProblem(s: AquaState, id: string): string | null {
  const item = itemOf(id);
  if (!item) return "Objet inconnu";
  if (s.owned.includes(id)) return "Déjà à vous";
  if (s.drops < item.price) return "Pas assez de gouttes";
  return null;
}

export function buy(s: AquaState, id: string): AquaState {
  if (buyProblem(s, id)) return s;
  const item = itemOf(id)!;
  const out: AquaState = { ...s, drops: s.drops - item.price, owned: [...s.owned, id], wear: { ...s.wear } };
  // Un accessoire acheté, Ondine le met tout de suite.
  if (item.kind !== "decor") out.wear[item.kind] = id;
  return out;
}

/** Ondine met (ou retire, « none ») un accessoire qu'elle a. */
export function wear(s: AquaState, slot: WearSlot, id: string): AquaState {
  if (id !== "none") {
    const item = itemOf(id);
    if (!item || item.kind !== slot || !s.owned.includes(id)) return s;
  }
  return { ...s, wear: { ...s.wear, [slot]: id } };
}

/** Relit un état venu d'ailleurs (le Rust, un ancien fichier) : tout ce qui est inattendu est écarté. */
export function cleanState(raw: unknown): AquaState {
  const r = (raw ?? {}) as Partial<AquaState>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const base = emptyState(typeof r.day === "string" ? r.day : "");
  const owned = Array.isArray(r.owned) ? r.owned.filter((id): id is string => typeof id === "string" && !!itemOf(id)) : [];
  const wearOf = (slot: WearSlot) => {
    const id = (r.wear as Record<string, unknown> | undefined)?.[slot];
    return typeof id === "string" && owned.includes(id) && itemOf(id)?.kind === slot ? id : "none";
  };
  const tally = (t: unknown): Tally => {
    const x = (t ?? {}) as Partial<Tally>;
    return { win: n(x.win), lose: n(x.lose), draw: n(x.draw) };
  };
  const stats = (r.stats ?? {}) as Partial<AquaState["stats"]>;
  return {
    ...base,
    drops: n(r.drops),
    earned: n(r.earned),
    today: n(r.today),
    owned: [...new Set(owned)],
    wear: { head: wearOf("head"), eyes: wearOf("eyes"), neck: wearOf("neck") },
    stats: { connect4: tally(stats.connect4), ttt: tally(stats.ttt), race: tally(stats.race) },
    lastPause: n(r.lastPause),
  };
}
