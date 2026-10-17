// Le menu de fichiers (1.2.5) : ce que l'on propose pour un dépôt, sans DOM
// ni Tauri (testé dans tests/front/drop-menu.test.ts).
//
// Le même menu sert à deux endroits :
//   - dans l'île (drop-panel.ts) : trois bulles (Convertir, Ranger, Outils),
//     les choix du groupe ouvert en icônes rondes, les favoris en haut ;
//   - autour d'Ondine sur le bureau (src/pet/ring.ts) : le cercle de la
//     maquette (animations-ile/maquette-menu-cercle.html).
// L'île le calcule (elle connaît les cibles des modules et les formats
// d'Ondine convertit) et l'envoie à Ondine sur le bureau par le bus.
//
// Ici :
//   - les choix de chaque groupe, dans l'ordre des réglages (Pilules du dépôt) ;
//   - le dépôt mixte : des fichiers et un dossier, ou des types différents.
//     Les actions communes restent vives, les autres sont grisées avec la
//     raison (« Pas pour un dossier », « Seulement pour les images ») ; une
//     action qui ne va à AUCUN élément n'est pas montrée ;
//   - les favoris épinglés (au plus 5) : un favori qui ne va pas à ce dépôt
//     est grisé (« Ce favori ne va pas à ce fichier ») ;
//   - le groupe ouvert d'office (Convertir, sinon le premier qui a un choix vif).

import { formatLabel, kindOf, pillsFor, type FormatId, type Kind } from "../modules/convert/convert-logic";
import { arrange, arrangeFormats, bareLabel, keyOf, KNOWN, OTHER_ICON, ROW_LABEL, ROWS, rowOf, type DropLayout, type DropRow } from "./drop-pills-logic";

/** Le type d'un élément déposé : celui de convert-logic.ts, ou un dossier. */
export type ItemKind = Kind | "folder";

/** Une cible de dépôt d'un module, réduite à ce qui se montre (le registre garde le reste). */
export interface MenuTarget {
  id: string;
  label: string;
  icon: string;
}

/** Un choix du menu. */
export interface MenuItem {
  /** Un format (« jpg ») ou l'identifiant d'une cible (« shelf-fav-0 ») : ce qu'on épingle. */
  id: string;
  /** Sa clé de réglage (drop-pills-logic.ts, keyOf). */
  key: string;
  row: DropRow;
  type: "format" | "target";
  /** Le nom entier (« Un seul PDF », « Copier le chemin »). */
  label: string;
  /** Ce qui va dans la bulle : un emoji qui a son icône au trait, ou "" (le nom court, `face`). */
  icon: string;
  /** Le nom court dans la bulle d'un format (« PDF »). */
  face: string;
  /** Le petit mot sous la bulle (le nom, ou ce que donne un format : « image »). */
  caption: string;
  /** Grisé : pourquoi (dépôt mixte, favori qui ne va pas) ; sinon null. */
  off: string | null;
}

export interface DropMenu {
  groups: Record<DropRow, MenuItem[]>;
  favs: MenuItem[];
  /** Les types des éléments déposés (un par élément). */
  kinds: ItemKind[];
  /** Des types différents (ou fichiers et dossiers mêlés). */
  mixed: boolean;
  /** Un groupe sans aucun choix vif : sa bulle est grisée, voici pourquoi. */
  dead: Record<DropRow, string | null>;
  /** Le groupe ouvert d'office. */
  open: DropRow;
}

export interface MenuInput {
  paths: string[];
  /** Dossier ou non, par élément (convert.probe) ; null : pas encore su (deviné d'après l'extension). */
  dirs?: (boolean | null)[] | null;
  /** Les formats d'Ondine convertit pour ce dépôt (ConvertGesture.offer), null si elle est coupée ou occupée. */
  formats: FormatId[] | null;
  /** Le dernier format choisi pour ce type (il passe en premier). */
  last?: FormatId;
  targets: MenuTarget[];
  layout: DropLayout;
}

/** Le nom d'un fichier dans son chemin. */
function nameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Le type de chaque élément : dossier (su ou deviné : pas d'extension), sinon d'après l'extension. */
export function itemKinds(paths: string[], dirs?: (boolean | null)[] | null): ItemKind[] {
  return paths.map((p, i) => {
    const dir = dirs?.[i];
    if (dir === true) return "folder";
    if (dir === false) return kindOf(p);
    return /\.[^.\\/]+$/.test(nameOf(p)) ? kindOf(p) : "folder";
  });
}

/** Les éléments, au pluriel, pour dire à qui va une action. */
const KIND_FOR: Record<ItemKind, string> = {
  image: "les images",
  pdf: "les PDF",
  video: "les vidéos",
  audio: "les sons",
  zip: "les archives ZIP",
  other: "les fichiers",
  folder: "les dossiers",
};

/**
 * Pourquoi une action est grisée : elle va aux éléments de type `ok`, mais le
 * dépôt contient aussi d'autres types (`present`).
 */
export function offReason(ok: ItemKind[], present: ItemKind[]): string {
  const missing = [...new Set(present.filter((k) => !ok.includes(k)))];
  // Chaque type sait le faire, mais pas tous ensemble (PNG d'une image et d'un PDF).
  if (missing.length === 0) return "Un type de fichier à la fois";
  if (missing.length === 1 && missing[0] === "folder") return "Pas pour un dossier";
  const okHere = [...new Set(present.filter((k) => ok.includes(k)))];
  if (okHere.length === 1) return `Seulement pour ${KIND_FOR[okHere[0]]}`;
  return "Pas pour tous les éléments";
}

/** Toutes les raisons possibles (pour les traductions). */
export const OFF_REASONS = ["Pas pour un dossier", "Pas pour tous les éléments", "Un type de fichier à la fois", ...Object.values(KIND_FOR).map((k) => `Seulement pour ${k}`)];

/** Un favori qui ne va pas à ce dépôt. */
export const FAV_OFF = "Ce favori ne va pas à ce fichier";

/** Les types qu'une cible accepte (les autres acceptent tout). */
const TARGET_KINDS: Record<string, ItemKind[]> = {
  // Redimensionner : des images seulement.
  "shelf-images": ["image"],
  // Empreinte : des fichiers (les dossiers n'ont pas d'empreinte, shelf_hash.rs).
  "shelf-hash": ["image", "pdf", "video", "audio", "zip", "other"],
  // Parler à Ondine : un fichier à lire.
  "askclaude-drop": ["image", "pdf", "video", "audio", "zip", "other"],
};

/** Vive (null), grisée (la raison) ou absente (undefined) pour ces types. */
function applies(ok: ItemKind[] | undefined, kinds: ItemKind[]): string | null | undefined {
  if (!ok) return null;
  const n = kinds.filter((k) => ok.includes(k)).length;
  if (n === kinds.length) return null;
  if (n === 0) return undefined;
  return offReason(ok, kinds);
}

/** Ce que donne un format, sous sa bulle (« image », « un seul fichier »). */
export function formatCaption(id: FormatId, many: boolean): string {
  switch (id) {
    case "pdf":
      return many ? "un seul fichier" : "document";
    case "zip":
      return many ? "un seul fichier" : "archive";
    case "shrink":
      return "plus léger";
    case "unzip":
      return "le contenu";
    case "mp4":
      return "vidéo";
    case "mp3":
    case "m4a":
    case "wav":
      return "son";
    default:
      return "image";
  }
}

function formatItem(id: FormatId, many: boolean, off: string | null): MenuItem {
  // « Alléger » et « Extraire » ont leur icône ; les autres formats, leur nom dans la bulle.
  const icon = KNOWN[id]?.icon ?? "";
  const face = formatLabel(id, false);
  return {
    id,
    key: id,
    row: "convert",
    type: "format",
    label: formatLabel(id, many),
    icon: id === "zip" ? "" : icon,
    face,
    caption: id === "shrink" || id === "unzip" ? face : formatCaption(id, many),
    off,
  };
}

function targetItem(t: MenuTarget, off: string | null): MenuItem {
  const key = keyOf(t.id);
  const label = key === "zip" ? "ZIP" : bareLabel(t.label);
  const icon = key === "zip" ? "" : (KNOWN[key]?.icon ?? (t.icon && !t.icon.includes(":") ? t.icon : OTHER_ICON));
  return { id: t.id, key, row: rowOf(key), type: "target", label, icon, face: label, caption: key === "zip" ? "archive" : label.replace(/(?:…|\.\.\.)$/, ""), off };
}

/** Le menu pour ce dépôt. */
export function buildMenu(input: MenuInput): DropMenu {
  const { paths, layout } = input;
  const kinds = itemKinds(paths, input.dirs);
  const distinct = [...new Set(kinds)];
  const mixed = distinct.length > 1;
  const many = paths.length > 1;
  const groups: Record<DropRow, MenuItem[]> = { convert: [], ranger: [], outils: [] };

  // ── Les formats : ceux de tout le dépôt sont vifs ; en dépôt mixte, ceux
  // d'une partie seulement sont grisés.
  const live = input.formats ?? [];
  const support = new Map<FormatId, ItemKind[]>();
  if (input.formats && mixed) {
    for (const k of distinct) {
      const sample = paths[kinds.indexOf(k)];
      // Un dossier compte comme « autre » pour Ondine convertit (le ZIP seul).
      for (const p of pillsFor([sample])?.pills ?? []) support.set(p.id, [...(support.get(p.id) ?? []), k]);
    }
  }
  const greyed = [...support.keys()].filter((id) => !live.includes(id));
  const ids = arrangeFormats(layout, [...live, ...greyed], input.last);
  for (const id of ids) groups.convert.push(formatItem(id, many, live.includes(id) ? null : offReason(support.get(id) ?? [], kinds)));
  const hasZip = ids.includes("zip");

  // ── Les cibles des modules, ligne par ligne, dans l'ordre des réglages.
  const byRow: Record<DropRow, MenuTarget[]> = { convert: [], ranger: [], outils: [] };
  for (const t of input.targets) byRow[rowOf(keyOf(t.id))].push(t);
  for (const row of ROWS) {
    for (const t of arrange(layout, row, byRow[row], (x) => keyOf(x.id))) {
      const key = keyOf(t.id);
      // « Compresser » de l'Étagère : seulement si Ondine convertit ne propose pas déjà le ZIP.
      if (key === "zip" && hasZip) continue;
      const off = applies(TARGET_KINDS[key], kinds);
      if (off === undefined) continue;
      groups[row].push(targetItem(t, off));
    }
  }

  // ── Les favoris : retrouvés parmi les choix, sinon grisés (ou oubliés : module coupé).
  const all = ROWS.flatMap((r) => groups[r]);
  const favs: MenuItem[] = [];
  for (const id of layout.favs) {
    const found = all.find((i) => i.id === id);
    if (found) {
      favs.push(found);
      continue;
    }
    if (KNOWN[id]?.row === "convert" && id !== "shelf-images") {
      favs.push(formatItem(id as FormatId, many, FAV_OFF));
      continue;
    }
    const t = input.targets.find((x) => x.id === id);
    if (t) favs.push(targetItem(t, FAV_OFF));
  }

  const dead = {} as Record<DropRow, string | null>;
  for (const row of ROWS) dead[row] = groups[row].some((i) => !i.off) ? null : `Rien dans ${ROW_LABEL[row]} pour ce dépôt`;
  const open = ROWS.find((r) => !dead[r]) ?? "convert";
  return { groups, favs, kinds, mixed, dead, open };
}

/** Toutes les phrases « Rien dans … pour ce dépôt » (pour les traductions). */
export const DEAD_REASONS = ROWS.map((r) => `Rien dans ${ROW_LABEL[r]} pour ce dépôt`);

/** L'étiquette du type, au centre du cercle (« PNG », « Dossier », « 3 éléments »). */
export function typeTag(paths: string[], kinds: ItemKind[]): string {
  if (paths.length > 1) return `${paths.length} éléments`;
  if (kinds[0] === "folder") return "Dossier";
  const ext = /\.([^.\\/]+)$/.exec(nameOf(paths[0] ?? ""))?.[1];
  return ext ? ext.toUpperCase().slice(0, 6) : "Fichier";
}

// ── Les touches ──────────────────────────────────────────────────────────────

/** Ctrl ouvre Outils, Alt ouvre Ranger (Maj reste pour Remplacer). */
export function rowForKeys(ctrl: boolean, alt: boolean): DropRow | null {
  if (ctrl && !alt) return "outils";
  if (alt && !ctrl) return "ranger";
  return null;
}

/** La touche montrée sous chaque bulle mère. */
export const ROW_KEY: Record<DropRow, string> = { convert: "", ranger: "Alt", outils: "Ctrl" };

// ── Pour Ondine sur le bureau ────────────────────────────────────────────────

/** Ce que l'île envoie à Ondine sur le bureau (« island.drop-menu »). */
export interface DropMenuMessage {
  id: number;
  title: string;
  meta: string;
  tag: string;
  /** La pilule d'option a un sens (des formats, pas un dossier). */
  option: boolean;
  dest: "keep" | "replace" | "desk";
  menu: DropMenu;
  /** L'étagère est là (bulle « Étagère ») : le nombre d'éléments posés, sinon null. */
  shelf: number | null;
  /** Les phrases de chaque choix, déjà traduites (« Convertir en JPG, à côté de l'original »). */
  says: Record<string, string>;
}

/** Une destination reçue d'une autre fenêtre (Conserver, Remplacer, Bureau), sinon undefined. */
export function parseDest(v: unknown): "keep" | "replace" | "desk" | undefined {
  return v === "keep" || v === "replace" || v === "desk" ? v : undefined;
}

/** Relit un message reçu par le bus (il vient d'une autre fenêtre) : null s'il ne ressemble à rien. */
export function parseMenuMessage(raw: unknown): DropMenuMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<DropMenuMessage>;
  if (typeof m.id !== "number" || !m.menu || typeof m.menu !== "object") return null;
  const g = (m.menu as Partial<DropMenu>).groups;
  if (!g || !ROWS.every((r) => Array.isArray(g[r]))) return null;
  return m as DropMenuMessage;
}
