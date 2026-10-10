// Les règles de l'Accueil, sans page ni horloge (testées par tests/front/home.test.ts) :
// le moment de la journée, l'ordre et la taille des cartes, ce qu'on garde
// par profil, la phrase d'Ondine et les actions rapides.

import type { HomeCardSize, HomeMoment, HomeResumeItem } from "../../core/home-cards";
import { mergeOrder } from "../../core/tab-order";

// ── Le moment de la journée ──────────────────────────────────────────────────

/** Le matin de 5 h à 11 h, la journée jusqu'à 18 h, le soir ensuite (et la nuit). */
export function momentOf(hour: number): HomeMoment {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "day";
  return "evening";
}

// ── La disposition des cartes, par profil ────────────────────────────────────

/** Ce qu'on a rangé à la main : gardé dans `modules.home.values.layouts`, une par profil. */
export interface HomeLayout {
  /** L'ordre choisi en glissant (clés des cartes) ; vide = ordre automatique. */
  order: string[];
  /** Les cartes retirées d'un clic droit. */
  hidden: string[];
  /** La taille choisie pour chaque carte (sinon celle que propose le module). */
  sizes: Record<string, HomeCardSize>;
}

/** Au plus : tant de cartes retenues, tant de profils (10 profils + l'île sans profil). */
const MAX_KEYS = 48;
const MAX_LAYOUTS = 12;
const KEY_RX = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function emptyLayout(): HomeLayout {
  return { order: [], hidden: [], sizes: {} };
}

function cleanKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((k): k is string => typeof k === "string" && KEY_RX.test(k)))].slice(0, MAX_KEYS);
}

/** Ramène une disposition enregistrée à quelque chose de valide. */
export function cleanLayout(raw: unknown): HomeLayout {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sizes: Record<string, HomeCardSize> = {};
  if (r.sizes && typeof r.sizes === "object") {
    for (const [k, v] of Object.entries(r.sizes as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (KEY_RX.test(k) && (v === "small" || v === "large")) sizes[k] = v;
    }
  }
  return { order: cleanKeys(r.order), hidden: cleanKeys(r.hidden), sizes };
}

/** La clé de la disposition : l'id du profil actif, ou « base » sans profil. */
export function layoutKey(activeProfile: string | undefined): string {
  const id = (activeProfile ?? "").trim();
  return id && KEY_RX.test(id) ? id : "base";
}

/**
 * La disposition d'un profil. Un profil qui n'a encore rien rangé part de
 * zéro (ordre automatique, toutes les cartes) : chaque profil a son accueil.
 */
export function layoutFor(layouts: unknown, key: string): HomeLayout {
  const all = (layouts && typeof layouts === "object" ? layouts : {}) as Record<string, unknown>;
  return cleanLayout(all[key]);
}

/** Toutes les dispositions avec celle-ci changée (les plus anciennes au-delà de MAX_LAYOUTS s'en vont). */
export function withLayout(layouts: unknown, key: string, layout: HomeLayout): Record<string, HomeLayout> {
  const all = (layouts && typeof layouts === "object" ? layouts : {}) as Record<string, unknown>;
  const out: Record<string, HomeLayout> = {};
  for (const [k, v] of Object.entries(all)) if (k !== key && KEY_RX.test(k)) out[k] = cleanLayout(v);
  out[key] = cleanLayout(layout);
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_LAYOUTS))) if (k !== key) delete out[k];
  return out;
}

// ── L'ordre des cartes ───────────────────────────────────────────────────────

/** Une carte qui a quelque chose à dire, telle que l'Accueil la voit pour la ranger. */
export interface CardInfo {
  key: string;
  /** L'importance selon le moment (0 à 100). */
  weight: number;
  urgent: boolean;
  size: HomeCardSize;
}

export interface PlacedCard {
  key: string;
  size: HomeCardSize;
  urgent: boolean;
}

/**
 * L'ordre affiché. Rangé à la main : l'ordre choisi, les nouvelles cartes
 * ensuite. Sinon (ou si `byMoment` est faux, l'ordre des modules) : la carte
 * importante d'abord, puis la plus utile à ce moment de la journée.
 */
export function arrangeCards(cards: readonly CardInfo[], layout: HomeLayout, byMoment = true): PlacedCard[] {
  const hidden = new Set(layout.hidden);
  const rank = new Map(layout.order.map((k, i) => [k, i]));
  const manual = layout.order.length > 0;
  return cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !hidden.has(c.key))
    .sort((a, b) => {
      if (manual) {
        const ra = rank.get(a.c.key);
        const rb = rank.get(b.c.key);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
      }
      if (a.c.urgent !== b.c.urgent) return a.c.urgent ? -1 : 1;
      if (byMoment && a.c.weight !== b.c.weight) return b.c.weight - a.c.weight;
      return a.i - b.i;
    })
    .map(({ c }) => ({ key: c.key, size: layout.sizes[c.key] ?? c.size, urgent: c.urgent }));
}

/**
 * L'ordre à enregistrer après un glisser : `visible` est l'ordre affiché ; les
 * cartes absentes en ce moment (rien à dire) gardent leur place relative.
 */
export function orderAfterDrag(visible: readonly string[], previous: readonly string[]): string[] {
  const all = [...previous];
  for (const k of visible) if (!all.includes(k)) all.push(k);
  return mergeOrder([...visible], all).slice(0, MAX_KEYS);
}

/** Retire une carte (clic droit → « Retirer de l'accueil »). */
export function hideCard(layout: HomeLayout, key: string): HomeLayout {
  return { ...layout, hidden: [...new Set([...layout.hidden, key])].slice(0, MAX_KEYS) };
}

/** Change la taille d'une carte. */
export function resizeCard(layout: HomeLayout, key: string, size: HomeCardSize): HomeLayout {
  return { ...layout, sizes: { ...layout.sizes, [key]: size } };
}

/** L'importance d'une carte à ce moment (50 si le module ne dit rien). */
export function weightAt(moments: Partial<Record<HomeMoment, number>> | undefined, moment: HomeMoment): number {
  const w = moments?.[moment];
  return typeof w === "number" && Number.isFinite(w) ? Math.max(0, Math.min(100, w)) : 50;
}

// ── La phrase d'Ondine ───────────────────────────────────────────────────────

/** Au plus tant de morceaux dans la phrase : elle tient sur une ligne. */
export const PHRASE_PARTS = 3;

/** « Bonjour, Simon. » selon le moment ; sans prénom, « Bonjour. ». */
export function greeting(moment: HomeMoment, firstName: string): string {
  const hello = { morning: "Bonjour", day: "Bon après-midi", evening: "Bonsoir" }[moment];
  const name = firstName.trim();
  return name ? `${hello}, ${name}.` : `${hello}.`;
}

/**
 * La phrase d'Ondine, fabriquée sur le PC à partir des cartes (sans IA) :
 * le salut, puis au plus PHRASE_PARTS morceaux, dans l'ordre des cartes
 * (l'importante d'abord). Chaque morceau reste à part (traduit à part) ; le
 * premier prend une majuscule à l'affichage (CSS), pas dans le texte.
 */
export function composePhrase(moment: HomeMoment, firstName: string, parts: readonly (string | null | undefined)[]): { greeting: string; parts: string[] } {
  const clean = parts.map((p) => (p ?? "").trim()).filter((p) => p.length > 0 && p.length <= 80);
  return { greeting: greeting(moment, firstName), parts: [...new Set(clean)].slice(0, PHRASE_PARTS) };
}

// ── La carte « Reprendre » ───────────────────────────────────────────────────

/** Au plus 3 lignes, les plus récentes d'abord, rien de plus vieux qu'une semaine. */
export function pickResume<T extends Pick<HomeResumeItem, "at">>(items: readonly (T | null | undefined)[], now: number, max = 3): T[] {
  const week = 7 * 86_400_000;
  return items
    .filter((x): x is T => !!x && Number.isFinite(x.at) && now - x.at < week)
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
}

// ── Les actions rapides ──────────────────────────────────────────────────────

/** Une action rapide : son bouton, et le module sans lequel elle n'a pas de sens. */
export interface QuickAction {
  id: string;
  icon: string;
  label: string;
  module: string;
}

/** Le catalogue (les choix des réglages action1 … action4 du manifeste). */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "capture", icon: "📸", label: "Capture", module: "capture" },
  { id: "note", icon: "📝", label: "Notes", module: "notes" },
  { id: "timer25", icon: "⏱️", label: "25 min", module: "timer" },
  { id: "askclaude", icon: "💬", label: "Parler à Ondine", module: "askclaude" },
  { id: "launcher", icon: "🔎", label: "Rechercher", module: "launcher" },
  { id: "terminal", icon: "⌨️", label: "Terminal", module: "terminal" },
  { id: "color", icon: "🎨", label: "Pipette", module: "capture" },
  { id: "clipboard", icon: "📋", label: "Presse-papiers", module: "clipboard" },
  { id: "agents", icon: "🤖", label: "Agents IA", module: "agents" },
];

/** Les actions rapides à montrer : celles choisies, sans doublon, dont le module est allumé (4 au plus). */
export function pickQuickActions(chosen: readonly unknown[], moduleOn: (id: string) => boolean): QuickAction[] {
  const out: QuickAction[] = [];
  for (const id of chosen) {
    const a = QUICK_ACTIONS.find((x) => x.id === id);
    if (a && moduleOn(a.module) && !out.includes(a)) out.push(a);
  }
  return out.slice(0, 4);
}

/** La carte la plus importante, pour qu'Ondine la regarde : la première urgente, s'il y en a une. */
export function lookTarget(cards: readonly PlacedCard[]): string | null {
  return cards.find((c) => c.urgent)?.key ?? null;
}
