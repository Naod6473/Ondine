// Le dépôt unifié (1.2.5) : la logique pure des pilules de l'île pendant un
// glisser, sans DOM ni Tauri (testée dans tests/front/drop-pills.test.ts).
//
// Un fichier glissé sur l'île : elle s'ouvre et montre TOUT dans le même
// style (maquette validée : animations-ile/maquette-depot-unifie.html,
// version A), en trois lignes de pilules :
//   - Convertir : les formats possibles pour CE fichier (convert-logic.ts),
//     « ZIP » (l'ancienne cible « Compresser ») et « Redimensionner… » (ce
//     que faisait l'outil « Images… » en plus d'Alléger : une largeur) ;
//   - Ranger : Étagère, Copier vers…, Déplacer vers…, les dossiers favoris,
//     Corbeille ;
//   - Outils : Parler à Ondine, Renommer…, Copier le chemin, Empreinte,
//     Terminal ici, les collègues d'Équipe, et toute autre cible de module.
//
// « Modulable au besoin » : chaque pilule se masque, et l'ordre de chaque
// ligne se change (Réglages → Étagère → Pilules du dépôt). Le choix est rangé
// dans les réglages de l'Étagère, sous « dropPills » (LAYOUT_KEY) :
//   { v: 1, order: { convert: [...], ranger: [...], outils: [...] }, hidden: [...] }
// Les anciens interrupteurs (cible « Corbeille », « Compresser », « Images et
// Renommer », « Empreinte », « Terminal ici », « Parler à Ondine ») sont repris
// la première fois (legacyHidden) : une cible masquée avant reste masquée.
//
// Ici : la liste par défaut, la fusion avec les cibles des modules présents,
// la migration, l'ordre, et les phrases qui disent ce qui va se passer.

import { formatLabel, type Dest, type FormatId } from "../modules/convert/convert-logic";

export type DropRow = "convert" | "ranger" | "outils";
export const ROWS: readonly DropRow[] = ["convert", "ranger", "outils"];
export const ROW_LABEL: Record<DropRow, string> = { convert: "Convertir", ranger: "Ranger", outils: "Outils" };

/** Où le choix est rangé (réglages de l'Étagère). */
export const LAYOUT_MODULE = "shelf";
export const LAYOUT_KEY = "dropPills";

/** Ce que l'on sait d'une pilule connue : sa ligne, son nom et son icône (au trait). */
export interface PillInfo {
  row: DropRow;
  label: string;
  /** Un emoji qui a son icône au trait (src/island/icon.ts), ou "" (un format : le nom seul). */
  icon: string;
}

/** Les formats, dans l'ordre par défaut de la ligne Convertir (puis l'ordre propre à chaque type). */
const FORMAT_KEYS: FormatId[] = ["jpg", "png", "webp", "pdf", "shrink", "gif", "bmp", "tiff", "ico", "mp4", "mp3", "m4a", "wav", "zip", "unzip"];

const fmt = (id: FormatId, icon = ""): [string, PillInfo] => [id, { row: "convert", label: formatLabel(id, false), icon }];

/** Toutes les pilules connues, dans l'ordre par défaut de chaque ligne. */
export const KNOWN: Record<string, PillInfo> = Object.fromEntries<PillInfo>([
  ...FORMAT_KEYS.filter((id) => id !== "zip" && id !== "unzip").map((id) => fmt(id)),
  fmt("zip", "🗜️"),
  fmt("unzip", "📂"),
  ["shelf-images", { row: "convert", label: "Redimensionner…", icon: "📏" }],
  ["shelf-add", { row: "ranger", label: "Étagère", icon: "🧺" }],
  ["shelf-copy", { row: "ranger", label: "Copier vers…", icon: "📄" }],
  ["shelf-move", { row: "ranger", label: "Déplacer vers…", icon: "📦" }],
  ["shelf-fav", { row: "ranger", label: "Dossiers favoris", icon: "📁" }],
  ["shelf-trash", { row: "ranger", label: "Corbeille", icon: "🗑️" }],
  ["askclaude-drop", { row: "outils", label: "Parler à Ondine", icon: "💬" }],
  ["shelf-rename", { row: "outils", label: "Renommer…", icon: "✏️" }],
  ["shelf-path", { row: "outils", label: "Copier le chemin", icon: "📋" }],
  ["shelf-hash", { row: "outils", label: "Empreinte", icon: "#️⃣" }],
  ["terminal-here", { row: "outils", label: "Terminal ici", icon: "🖥️" }],
  ["team", { row: "outils", label: "Collègues (Équipe)", icon: "🤝" }],
]);

/** L'icône d'une cible inconnue (module ajouté plus tard) : une cible. */
export const OTHER_ICON = "🎯";

/**
 * La clé de réglage d'une cible de module : un favori (« shelf-fav-2 ») ou un
 * collègue (« team-ab12 », « team-chat-ab12 ») comptent pour leur groupe ;
 * « Compresser » (shelf-zip) est la pilule ZIP.
 */
export function keyOf(targetId: string): string {
  if (/^shelf-fav-\d+$/.test(targetId)) return "shelf-fav";
  if (targetId.startsWith("team-")) return "team";
  if (targetId === "shelf-zip") return "zip";
  return targetId;
}

/** La ligne d'une clé (une cible inconnue va dans Outils). */
export function rowOf(key: string): DropRow {
  return KNOWN[key]?.row ?? "outils";
}

export interface DropLayout {
  order: Record<DropRow, string[]>;
  hidden: string[];
}

/** La disposition par défaut : tout est montré, dans l'ordre de KNOWN. */
export function defaultLayout(): DropLayout {
  const order: Record<DropRow, string[]> = { convert: [], ranger: [], outils: [] };
  for (const [key, info] of Object.entries(KNOWN)) order[info.row].push(key);
  return { order, hidden: [] };
}

const isKey = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);

/**
 * Une disposition enregistrée, relue sans se fier au texte : null si elle
 * n'existe pas ou ne ressemble à rien (on prend alors la migration).
 */
export function parseLayout(raw: unknown): DropLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { v?: unknown; order?: unknown; hidden?: unknown };
  if (r.v !== 1 || !r.order || typeof r.order !== "object") return null;
  const src = r.order as Record<string, unknown>;
  const order: Record<DropRow, string[]> = { convert: [], ranger: [], outils: [] };
  for (const row of ROWS) {
    const list = Array.isArray(src[row]) ? (src[row] as unknown[]).filter(isKey) : [];
    order[row] = list.slice(0, 64);
  }
  const hidden = Array.isArray(r.hidden) ? (r.hidden as unknown[]).filter(isKey).slice(0, 128) : [];
  return normalize({ order, hidden });
}

/** Ce qu'on range dans les réglages. */
export function serialize(layout: DropLayout): { v: 1; order: Record<DropRow, string[]>; hidden: string[] } {
  return { v: 1, order: { convert: [...layout.order.convert], ranger: [...layout.order.ranger], outils: [...layout.order.outils] }, hidden: [...layout.hidden] };
}

/**
 * Remet une disposition d'aplomb : chaque clé connue dans SA ligne, une seule
 * fois ; une clé connue absente (ajoutée dans une version plus récente) est
 * insérée à sa place par défaut (après celle qui la précède) ; une clé
 * inconnue (une cible de module) reste dans Outils.
 */
export function normalize(layout: DropLayout): DropLayout {
  const seen = new Set<string>();
  const order: Record<DropRow, string[]> = { convert: [], ranger: [], outils: [] };
  for (const row of ROWS) {
    for (const key of layout.order[row] ?? []) {
      if (seen.has(key)) continue;
      const known = KNOWN[key];
      if (known ? known.row !== row : row !== "outils") continue;
      seen.add(key);
      order[row].push(key);
    }
  }
  const defaults = defaultLayout().order;
  for (const row of ROWS) {
    defaults[row].forEach((key, i) => {
      if (seen.has(key)) return;
      seen.add(key);
      // Après la clé qui la précède par défaut (si elle est là), sinon en tête.
      const before = defaults[row].slice(0, i).reverse().find((k) => order[row].includes(k));
      const at = before === undefined ? 0 : order[row].indexOf(before) + 1;
      order[row].splice(at, 0, key);
    });
  }
  const hidden = [...new Set(layout.hidden.filter(isKey))];
  return { order, hidden };
}

/** Les anciens réglages équivalents (valeurs telles qu'enregistrées, peut-être absentes). */
export interface LegacySettings {
  /** Étagère */
  showTrash?: unknown;
  showCompress?: unknown;
  showTools?: unknown;
  showHash?: unknown;
  /** Terminal : « Terminal ici » */
  terminalDrop?: unknown;
  /** Parler à Ondine */
  askDrop?: unknown;
}

/** Les pilules masquées d'après les anciens interrupteurs (seul un « non » explicite masque). */
export function legacyHidden(l: LegacySettings): string[] {
  const out: string[] = [];
  if (l.showTrash === false) out.push("shelf-trash");
  if (l.showCompress === false) out.push("zip");
  // « Images et Renommer » : les deux outils (Images… est devenu Redimensionner…).
  if (l.showTools === false) out.push("shelf-images", "shelf-rename");
  if (l.showHash === false) out.push("shelf-hash");
  if (l.terminalDrop === false) out.push("terminal-here");
  if (l.askDrop === false) out.push("askclaude-drop");
  return out;
}

/**
 * La disposition à utiliser : celle enregistrée, sinon (première fois) celle
 * par défaut avec les cibles masquées par les anciens réglages.
 */
export function effectiveLayout(saved: unknown, legacy: LegacySettings = {}): DropLayout {
  const parsed = parseLayout(saved);
  if (parsed) return parsed;
  const base = defaultLayout();
  return { ...base, hidden: legacyHidden(legacy) };
}

/** Ajoute à Outils les cibles inconnues de modules présents (pour les réglages). */
export function withExtras(layout: DropLayout, keys: string[]): DropLayout {
  const all = new Set(ROWS.flatMap((r) => layout.order[r]));
  const extra = keys.filter((k) => isKey(k) && !all.has(k) && !KNOWN[k]);
  if (!extra.length) return layout;
  return { ...layout, order: { ...layout.order, outils: [...layout.order.outils, ...new Set(extra)] } };
}

/** Monte (delta < 0) ou descend une pilule dans sa ligne. */
export function moveKey(layout: DropLayout, key: string, delta: number): DropLayout {
  const row = ROWS.find((r) => layout.order[r].includes(key));
  if (!row) return layout;
  const list = [...layout.order[row]];
  const from = list.indexOf(key);
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return layout;
  list.splice(from, 1);
  list.splice(to, 0, key);
  return { ...layout, order: { ...layout.order, [row]: list } };
}

/** Montre ou masque une pilule. */
export function setShown(layout: DropLayout, key: string, shown: boolean): DropLayout {
  const hidden = layout.hidden.filter((k) => k !== key);
  if (!shown) hidden.push(key);
  return { ...layout, hidden };
}

export function isShown(layout: DropLayout, key: string): boolean {
  return !layout.hidden.includes(key);
}

/** La ligne n'a pas été réordonnée (l'ordre par défaut) ? */
export function rowIsDefault(layout: DropLayout, row: DropRow): boolean {
  const def = defaultLayout().order[row];
  const mine = layout.order[row].filter((k) => def.includes(k));
  return mine.every((k, i) => k === def[i]);
}

/**
 * Range des éléments d'une ligne selon la disposition : les masqués partent,
 * les autres suivent l'ordre choisi (les clés inconnues à la fin, dans leur
 * ordre d'arrivée). Plusieurs éléments d'une même clé (les favoris) restent
 * ensemble, dans leur ordre.
 */
export function arrange<T>(layout: DropLayout, row: DropRow, items: T[], key: (item: T) => string): T[] {
  const order = layout.order[row];
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  return items
    .map((item, i) => ({ item, i, k: key(item) }))
    .filter((x) => isShown(layout, x.k))
    .sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i)
    .map((x) => x.item);
}

/**
 * Les formats de la ligne Convertir. Ligne jamais réordonnée : l'ordre propre
 * au type (convert-logic.ts, pillsFor) ; sinon l'ordre choisi. Le dernier
 * format choisi pour ce type reste en premier (`first`).
 */
export function arrangeFormats(layout: DropLayout, ids: FormatId[], first?: FormatId): FormatId[] {
  const shown = ids.filter((id) => isShown(layout, id));
  const sorted = rowIsDefault(layout, "convert") ? shown : arrange(layout, "convert", shown, (id) => id);
  if (first && sorted.includes(first)) return [first, ...sorted.filter((id) => id !== first)];
  return sorted;
}

// ── Les textes ───────────────────────────────────────────────────────────────

/** Le libellé d'une cible dans une pilule : sans son pictogramme du début (« 💬 Alex » → « Alex »). */
export function bareLabel(label: string): string {
  return label.replace(/^(?:\p{Extended_Pictographic}|[#*0-9]️?⃣)️?\s*/u, "").trim() || label;
}

/** Où va le résultat, pour la phrase sous les pilules. */
export function destText(dest: Dest, many: boolean): string {
  switch (dest) {
    case "keep":
      return many ? "à côté des originaux" : "à côté de l'original";
    case "replace":
      return many ? "à la place des originaux (Corbeille, avec Annuler)" : "à la place de l'original (Corbeille, avec Annuler)";
    case "desk":
      return "sur le bureau";
  }
}

/** Ce que fera une pilule de format (« Convertir en JPG, à côté de l'original »). */
export function formatSay(id: FormatId, dest: Dest, many: boolean): string {
  const where = destText(dest, many);
  switch (id) {
    case "shrink":
      return `Alléger, ${where}`;
    case "zip":
      return many ? `Faire un seul ZIP, ${where}` : `Faire un ZIP, ${where}`;
    case "unzip":
      return `Extraire le contenu, ${where}`;
    case "pdf":
      return many ? `Faire un seul PDF, ${where}` : `Convertir en PDF, ${where}`;
    default:
      return `Convertir en ${formatLabel(id, false)}, ${where}`;
  }
}

/** Ce que fera une cible de module. `label` : son libellé ; `favoriteMove` : un favori déplace. */
export function targetSay(targetId: string, label: string, many: boolean, favoriteMove = false): string {
  switch (keyOf(targetId)) {
    case "shelf-add":
      return "Poser sur l'étagère";
    case "shelf-copy":
      return "Choisir un dossier où copier";
    case "shelf-move":
      return "Choisir un dossier où déplacer";
    case "shelf-fav":
      return `${favoriteMove ? "Déplacer" : "Copier"} dans ${label}`;
    case "shelf-trash":
      return "Envoyer à la Corbeille, avec Annuler";
    case "shelf-images":
      return "Redimensionner à une largeur, à côté de l'original";
    case "zip":
      return many ? "Faire un seul ZIP, à côté des originaux" : "Faire un ZIP, à côté de l'original";
    case "askclaude-drop":
      return "Demander à Ondine à propos de ce fichier";
    case "shelf-rename":
      return "Renommer, seul ou en lot";
    case "shelf-path":
      return many ? "Copier les chemins" : "Copier le chemin du fichier";
    case "shelf-hash":
      return "Calculer l'empreinte SHA-256";
    case "terminal-here":
      return "Ouvrir un terminal dans son dossier";
    case "team":
      return `Proposer à ${label}`;
    default:
      return label;
  }
}

/** La phrase quand rien n'est survolé. */
export const IDLE_SAY = "Lâchez sur une pilule";
/** …et sur la pilule d'option. */
export const OPTION_SAY = "Survolez une demi-seconde pour changer : Conserver, Remplacer, Sur le bureau";

// ── L'en-tête ────────────────────────────────────────────────────────────────

/** Ce que le Rust dit d'un chemin (convert.probe) : un dossier, sa taille ou son nombre d'éléments. */
export interface Probe {
  dir: boolean;
  size: number;
  count: number | null;
}

/** Le type lisible d'un fichier, d'après le type de convert-logic.ts. */
const KIND_NAME: Record<string, string> = { image: "Image", pdf: "PDF", video: "Vidéo", audio: "Son", zip: "Archive ZIP", other: "Fichier" };
/** …et pour un lot du même type (un lot mêlé est « autre » : pas de type). */
const KIND_PLURAL: Record<string, string> = { image: "Images", pdf: "PDF", video: "Vidéos", audio: "Sons", zip: "Archives ZIP" };

/**
 * L'en-tête de l'île : le nom (ou « 3 fichiers ») et « Image · 3,4 Mo »,
 * « Dossier · 214 éléments ». `probes` peut manquer (pas encore là) :
 * on dit alors ce qu'on sait (le type d'après l'extension).
 */
export function headerFor(
  names: string[],
  kind: string,
  probes: (Probe | null)[] | null,
  size: (bytes: number) => string,
): { title: string; meta: string; folder: boolean } {
  const n = names.length;
  const known = probes && probes.length === n && probes.every(Boolean) ? (probes as Probe[]) : null;
  // Sans extension, c'est sans doute un dossier, en attendant la réponse du Rust.
  const guessDir = (name: string) => !/\.[^.\\/]+$/.test(name);
  const dirs = known ? known.map((p) => p.dir) : names.map(guessDir);
  const folder = n > 0 && dirs.every(Boolean);
  if (n === 1) {
    const p = known?.[0];
    if (folder) {
      const count = p?.count;
      return { title: names[0], meta: typeof count === "number" ? `Dossier · ${count} élément${count > 1 ? "s" : ""}` : "Dossier", folder };
    }
    const what = KIND_NAME[kind] ?? "Fichier";
    return { title: names[0], meta: p ? `${what} · ${size(p.size)}` : what, folder };
  }
  const total = known ? known.reduce((s, p) => s + (p.dir ? 0 : p.size), 0) : 0;
  const mixed = !folder && dirs.some(Boolean);
  const title = folder ? `${n} dossiers` : mixed ? `${n} éléments` : `${n} fichiers`;
  const parts: string[] = [];
  if (!folder && KIND_PLURAL[kind]) parts.push(KIND_PLURAL[kind]);
  if (known && total > 0) parts.push(size(total));
  return { title, meta: parts.join(" · "), folder };
}
