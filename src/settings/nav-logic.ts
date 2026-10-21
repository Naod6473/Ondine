// La navigation des Réglages en deux colonnes (1.2.4) : logique pure, sans
// DOM, testée dans tests/front/settings-nav.test.ts ; main.ts la dessine.
//
//   - 1re colonne : les sept rubriques fixes (NAV_GROUPS, layout.ts). Rien ne
//     s'y déplie ;
//   - 2e colonne : les pages de la rubrique choisie ; les sous-menus de la page
//     affichée se déplient sous elle. Dans « Modules », les modules sont rangés
//     sous les titres de leur catégorie (MODULE_CATEGORIES) ;
//   - à droite, la page, avec un fil d'Ariane (Rubrique › Page › Sous-menu).
//
// On y calcule aussi le sens du mouvement (une page « plus loin » arrive de la
// droite, une page « avant » de la gauche) et les étapes de la pastille en
// verre qui glisse d'une ligne à l'autre comme une goutte.

import { MODULE_CATEGORIES, NAV_GROUPS, type NavGroup } from "./layout";
import { IOS } from "../core/easing";

/** Ce que la navigation sait d'une page (le reste vit dans main.ts). */
export interface NavPage {
  id: string;
  group: NavGroup;
  label: string;
  /** Modules : la catégorie (MODULE_CATEGORIES). */
  category?: string;
  /** Les sous-menus, dans l'ordre. */
  subs: { id: string; label: string }[];
}

/** Un endroit des Réglages : une page, et peut-être un de ses sous-menus. */
export interface NavPlace {
  page: string;
  sub?: string | null;
}

/** L'icône de chaque rubrique (un emoji qui a son trait dans icon.ts : style épuré). */
export const RUBRIC_ICONS: Record<NavGroup, string> = {
  Ondine: "💧",
  Voix: "🎙️",
  "L'île": "🎨",
  Automatiser: "⚡",
  Modules: "🧩",
  Système: "🛡️",
  "À propos": "✨",
};

/** Sous cette largeur (px), la 2e colonne devient une bande de pages au-dessus du contenu. */
export const NARROW_PX = 900;

/** Les pages d'une rubrique, dans l'ordre de la liste. */
export function pagesOf(rubric: NavGroup, pages: NavPage[]): NavPage[] {
  return pages.filter((p) => p.group === rubric);
}

/** La rubrique d'une page (undefined si elle n'existe pas). */
export function rubricOf(pageId: string, pages: NavPage[]): NavGroup | undefined {
  return pages.find((p) => p.id === pageId)?.group;
}

/** Une ligne de la 2e colonne. */
export type Col2Item =
  | { kind: "cat"; id: string; label: string }
  | { kind: "page"; page: string; label: string; current: boolean; open: boolean }
  | { kind: "sub"; page: string; sub: string; label: string; current: boolean };

/**
 * Les lignes de la 2e colonne : les pages de la rubrique (sous les titres de
 * leur catégorie dans « Modules »), et les sous-menus de la page affichée
 * dépliés juste sous elle. `sub` : le sous-menu affiché.
 */
export function column2(rubric: NavGroup, pages: NavPage[], current: string, sub: string | null): Col2Item[] {
  const out: Col2Item[] = [];
  let lastCat = "";
  for (const p of pagesOf(rubric, pages)) {
    if (p.category && p.category !== lastCat) {
      lastCat = p.category;
      out.push({ kind: "cat", id: p.category, label: MODULE_CATEGORIES.find((c) => c.id === p.category)?.label ?? p.category });
    }
    const here = p.id === current;
    out.push({ kind: "page", page: p.id, label: p.label, current: here, open: here && p.subs.length > 0 });
    if (here) for (const s of p.subs) out.push({ kind: "sub", page: p.id, sub: s.id, label: s.label, current: s.id === sub });
  }
  return out;
}

/** Un morceau du fil d'Ariane : son texte, et où il mène (rien : c'est là où l'on est). */
export interface Crumb {
  label: string;
  to?: NavPlace;
  /** Un nom choisi par l'utilisateur (un profil) : pas de traduction. */
  plain?: boolean;
}

/**
 * Le fil d'Ariane d'une place : Rubrique › Page › Sous-menu. La rubrique mène
 * à sa première page, la page à son premier sous-menu ; le dernier morceau
 * est la place elle-même.
 */
export function crumbs(place: NavPlace, pages: NavPage[], plainSubs: string[] = []): Crumb[] {
  const p = pages.find((x) => x.id === place.page);
  if (!p) return [];
  const first = pagesOf(p.group, pages)[0];
  const sub = place.sub ? p.subs.find((s) => s.id === place.sub) : undefined;
  const out: Crumb[] = [{ label: p.group, to: { page: first.id, sub: first.subs[0]?.id ?? null } }];
  // « À propos › À propos » : la page qui porte le nom de sa rubrique n'est pas répétée.
  if (p.label !== p.group) out.push({ label: p.label, to: { page: p.id, sub: p.subs[0]?.id ?? null } });
  if (sub) out.push({ label: sub.label, plain: plainSubs.includes(sub.id) });
  // Le dernier morceau, et un lien vers la place où l'on est déjà, ne mènent nulle part.
  out[out.length - 1].to = undefined;
  for (const c of out) if (c.to && c.to.page === place.page && (c.to.sub ?? null) === (place.sub ?? null)) c.to = undefined;
  return out;
}

/** La position d'une place dans l'ordre de lecture : [rubrique, page, sous-menu]. */
export function navOrder(place: NavPlace, pages: NavPage[]): [number, number, number] {
  const p = pages.find((x) => x.id === place.page);
  if (!p) return [-1, -1, -1];
  const rubric = NAV_GROUPS.indexOf(p.group);
  const page = pagesOf(p.group, pages).indexOf(p);
  const sub = Math.max(0, p.subs.findIndex((s) => s.id === place.sub));
  return [rubric, page, sub];
}

/**
 * Le sens du mouvement d'une place à l'autre : 1 (on avance : la page arrive
 * de la droite), -1 (on revient en arrière : de la gauche), 0 (même place :
 * elle se pose sur place).
 */
export function direction(from: NavPlace | null, to: NavPlace, pages: NavPage[]): 1 | -1 | 0 {
  if (!from) return 0;
  const a = navOrder(from, pages);
  const b = navOrder(to, pages);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i] ? 1 : -1;
  return 0;
}

/**
 * La page à ouvrir quand on choisit une rubrique : la dernière vue dans cette
 * rubrique (`remembered`, gardée d'une ouverture à l'autre), sinon sa première.
 */
export function pageForRubric(rubric: NavGroup, pages: NavPage[], remembered: Record<string, string>): string | undefined {
  const list = pagesOf(rubric, pages);
  const kept = remembered[rubric];
  return (list.find((p) => p.id === kept) ?? list[0])?.id;
}

/** Combien de pages compte chaque rubrique (le petit nombre à droite, dans la 1re colonne). */
export function rubricCounts(pages: NavPage[]): Record<NavGroup, number> {
  const out = Object.fromEntries(NAV_GROUPS.map((g) => [g, 0])) as Record<NavGroup, number>;
  for (const p of pages) out[p.group]++;
  return out;
}

// ── La pastille en verre ─────────────────────────────────────────────────────

/** La place d'une ligne dans sa liste : son haut et sa hauteur (px). */
export interface Span {
  y: number;
  h: number;
}

export interface GlideFrame {
  y: number;
  h: number;
  /** Un peu plus étroite quand elle file, un peu plus large quand elle s'écrase. */
  scaleX: number;
  /** Où tombe l'étape dans le trajet (0 à 1). */
  offset: number;
}

/**
 * Le trajet de la pastille d'une ligne à l'autre, comme une goutte : le bord
 * avant part d'abord et la pastille s'étire, puis le bord arrière la rattrape
 * et elle s'écrase un peu en arrivant avant de reprendre sa forme. null :
 * rien à animer (même place).
 */
export function glideFrames(from: Span, to: Span): { frames: GlideFrame[]; duration: number } | null {
  const d = to.y - from.y;
  if (!d && from.h === to.h) return null;
  const stretch = Math.abs(d) * 0.7;
  const lead = d > 0 ? { y: from.y + d * 0.18, h: from.h + stretch } : { y: from.y + d * 0.88, h: from.h + stretch };
  const squash = { y: to.y + (d > 0 ? 2 : d < 0 ? -2 : 0), h: Math.max(4, to.h - 3) };
  return {
    frames: [
      { y: from.y, h: from.h, scaleX: 1, offset: 0 },
      { y: lead.y, h: lead.h, scaleX: 0.94, offset: 0.38 },
      { y: squash.y, h: squash.h, scaleX: 1.04, offset: 0.72 },
      { y: to.y, h: to.h, scaleX: 1, offset: 1 },
    ],
    duration: Math.round(Math.min(620, 380 + Math.abs(d) * 0.6)),
  };
}

/** La courbe des transitions d'iOS : un départ franc, une arrivée très douce. */
export const IOS_EASE = IOS;
