// Ondine convertit (1.2.5) : la logique pure du module, sans DOM ni Tauri
// (testée dans tests/front/convert.test.ts).
//
//   - le type d'un fichier d'après son extension, et les pilules de formats à
//     montrer pour CE fichier (ou ce lot), dans la ligne « Convertir » de
//     l'île (src/island/drop-panel.ts). La première pilule est le dernier
//     format choisi pour ce type ;
//   - la pilule d'option (Conserver / Remplacer / Sur le bureau) et son tour ;
//   - les textes de l'île et des pilules : progression (« Je mâche… 42 % »,
//     « 3/12 · 42 % »), résultat (« photo.jpg · 3,4 Mo → 820 Ko »), échec en
//     une ligne.
//
// Le Rust (src-tauri/src/modules/convert_logic.rs) a la même liste de formats
// par type et revérifie tout : ici, on ne fait que proposer.

export type Kind = "image" | "pdf" | "video" | "audio" | "zip" | "other";
export type FormatId = "jpg" | "png" | "webp" | "gif" | "bmp" | "tiff" | "ico" | "shrink" | "pdf" | "mp4" | "mp3" | "m4a" | "wav" | "zip" | "unzip";
export type Dest = "keep" | "replace" | "desk";

/** Au plus tant de fichiers d'un coup (même limite côté Rust). */
export const MAX_FILES = 100;

const IMAGE_EXT = ["jpg", "jpeg", "jfif", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "heic", "heif", "avif"];
const VIDEO_EXT = ["mp4", "m4v", "mov", "wmv", "avi", "mkv", "3gp"];
const AUDIO_EXT = ["mp3", "m4a", "wav", "wma", "aac", "flac"];

/** Le nom d'un fichier dans son chemin (« C:\\a\\photo.jpg » → « photo.jpg »). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** L'extension en minuscules, sans le point (« » s'il n'y en a pas). */
export function extOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Le type d'après l'extension. Un dossier (sans extension, on ne peut pas le
 * savoir d'ici) compte comme « autre » : il n'a droit qu'au ZIP, comme lui.
 */
export function kindOf(path: string): Kind {
  const ext = extOf(path);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext === "zip") return "zip";
  return "other";
}

/** Le type d'un lot : le même pour tous, sinon « autre » (seul le ZIP reste). */
export function commonKind(paths: string[]): Kind {
  const kinds = paths.map(kindOf);
  return kinds.every((k) => k === kinds[0]) ? (kinds[0] ?? "other") : "other";
}

/**
 * Les formats proposés par type, dans l'ordre des pilules (avant le « dernier
 * choix »). « ZIP » partout (sauf pour une archive) : c'est l'ancienne cible
 * « Compresser » de l'Étagère (dépôt unifié, 1.2.5).
 */
const FORMATS: Record<Kind, FormatId[]> = {
  image: ["jpg", "png", "webp", "pdf", "shrink", "gif", "bmp", "tiff", "ico", "zip"],
  pdf: ["png", "jpg", "zip"],
  video: ["mp4", "shrink", "mp3", "m4a", "wav", "zip"],
  audio: ["mp3", "m4a", "wav", "zip"],
  zip: ["unzip"],
  other: ["zip"],
};

/** Le format d'un fichier, s'il est l'un de ceux qu'on écrit (pour ne pas proposer « JPG » pour un JPG). */
function ownFormat(path: string): FormatId | null {
  const ext = extOf(path);
  const map: Record<string, FormatId> = {
    jpg: "jpg", jpeg: "jpg", jfif: "jpg", png: "png", webp: "webp", gif: "gif", bmp: "bmp", tif: "tiff", tiff: "tiff", ico: "ico",
    mp4: "mp4", m4v: "mp4", mp3: "mp3", m4a: "m4a", wav: "wav",
  };
  return map[ext] ?? null;
}

export interface Pill {
  id: FormatId;
  label: string;
}

/** Le libellé d'une pilule (« Un seul PDF » pour plusieurs images). */
export function formatLabel(id: FormatId, many: boolean): string {
  switch (id) {
    case "jpg": return "JPG";
    case "png": return "PNG";
    case "webp": return "WebP";
    case "gif": return "GIF";
    case "bmp": return "BMP";
    case "tiff": return "TIFF";
    case "ico": return "ICO";
    case "shrink": return "Alléger";
    case "pdf": return many ? "Un seul PDF" : "PDF";
    case "mp4": return "MP4";
    case "mp3": return "MP3";
    case "m4a": return "M4A";
    case "wav": return "WAV";
    case "zip": return many ? "Un seul ZIP" : "ZIP";
    case "unzip": return "Extraire";
  }
}

/** Le dernier format choisi, par type (gardé dans le navigateur de l'île). */
export type LastChoices = Partial<Record<Kind, FormatId>>;

/**
 * Les pilules pour ces fichiers, ou null s'il n'y a rien à proposer (aucun
 * fichier, trop de fichiers). La première est le dernier format choisi pour
 * ce type, s'il est proposé.
 */
export function pillsFor(paths: string[], last: LastChoices = {}): { kind: Kind; pills: Pill[] } | null {
  if (!paths.length || paths.length > MAX_FILES) return null;
  const kind = commonKind(paths);
  const many = paths.length > 1;
  let ids = [...FORMATS[kind]];
  // Le format qu'ils ont déjà (tous) n'est pas proposé : « Alléger » le remplace.
  const own = ownFormat(paths[0]);
  if (own && paths.every((p) => ownFormat(p) === own)) ids = ids.filter((id) => id !== own);
  // Plusieurs fichiers : on peut toujours en faire un seul ZIP (à la fin).
  if (many && !ids.includes("zip")) ids.push("zip");
  const first = last[kind];
  if (first && ids.includes(first)) ids = [first, ...ids.filter((id) => id !== first)];
  return { kind, pills: ids.map((id) => ({ id, label: formatLabel(id, many) })) };
}

/** Le type du fichier produit (pour son icône) : une image, un PDF, un ZIP… */
export function outKind(id: FormatId, from: Kind): Kind {
  switch (id) {
    case "pdf": return "pdf";
    case "zip": return "zip";
    case "unzip": return "other";
    case "mp3": case "m4a": case "wav": return "audio";
    case "mp4": return "video";
    case "shrink": return from;
    default: return "image";
  }
}

/** Retient le choix pour ce type. */
export function remember(last: LastChoices, kind: Kind, id: FormatId): LastChoices {
  return { ...last, [kind]: id };
}

/** Relit les derniers choix (texte JSON) : tout ce qui n'est pas un format connu est ignoré. */
export function parseLast(text: string | null): LastChoices {
  const out: LastChoices = {};
  try {
    const raw = JSON.parse(text ?? "{}") as Record<string, unknown>;
    for (const kind of Object.keys(FORMATS) as Kind[]) {
      const v = raw[kind];
      if (typeof v === "string" && FORMATS[kind].concat("zip").includes(v as FormatId)) out[kind] = v as FormatId;
    }
  } catch {
    // illisible : on repart de zéro
  }
  return out;
}

// ── La pilule d'option ───────────────────────────────────────────────────────

export const DEST_ORDER: Dest[] = ["keep", "replace", "desk"];

export const DEST_LABEL: Record<Dest, string> = {
  keep: "Conserver à côté",
  replace: "Remplacer l'original",
  desk: "Sur le bureau",
};

/** Ce que dit l'île une fois le fichier recraché. */
export const DEST_DONE: Record<Dest, string> = {
  keep: "À côté de l'original",
  replace: "L'original est dans la Corbeille",
  desk: "Posé sur le bureau",
};

export function asDest(v: unknown): Dest {
  return v === "replace" || v === "desk" ? v : "keep";
}

/** Le tour suivant de la pilule d'option. */
export function nextDest(d: Dest): Dest {
  return DEST_ORDER[(DEST_ORDER.indexOf(d) + 1) % DEST_ORDER.length];
}

// ── Les textes ───────────────────────────────────────────────────────────────

/** « 820 Ko », « 3,4 Mo », « 1,2 Go » (à la française). */
export function formatBytes(n: number, intl = false): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} ${intl ? "B" : "o"}`;
  const units = intl ? ["KB", "MB", "GB", "TB"] : ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const text = v >= 100 || u === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "").replace(".", intl ? "." : ",");
  return `${text} ${units[u]}`;
}

/** Le titre de l'île pendant le travail : « vacances.heic → JPG », « 12 fichiers → Un seul PDF ». */
export function workTitle(paths: string[], label: string): string {
  return paths.length === 1 ? `${baseName(paths[0])} → ${label}` : `${paths.length} fichiers → ${label}`;
}

/** La ligne de progression : « Je mâche… 42 % » ou « 3/12 · 42 % ». */
export function progressLine(index: number, total: number, fraction: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  if (total <= 1) return `Je mâche… ${pct} %`;
  return `${Math.min(total, Math.max(1, index + 1))}/${total} · ${pct} %`;
}

/** Le résultat d'un fichier, tel que le Rust l'envoie (« convert.done »). */
export interface ItemResult {
  name: string;
  out: string | null;
  outName: string | null;
  before: number;
  after: number;
  error: string | null;
}

export interface DoneMessage {
  job: number;
  ok: boolean;
  total: number;
  failed: number;
  cancelled?: boolean;
  dest?: Dest;
  /** Combien d'originaux sont partis à la Corbeille (« Remplacer »). */
  replaced?: number;
  note?: string | null;
  undoId?: number | null;
  error?: string | null;
  results: ItemResult[];
}

/** Une raison en une ligne, avec une majuscule (« Cette image semble abîmée »). */
export function sentence(text: string): string {
  const t = text.trim().replace(/^Error:\s*/i, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Ce que montre la pilule de résultat. */
export interface Summary {
  ok: boolean;
  /** Le nom mis en avant (le nouveau fichier, ou l'original qui n'a pas bougé). */
  name: string;
  /** Le reste de la ligne : tailles avant → après, ou la raison de l'échec. */
  detail: string;
  /** Ce que dit l'île (deuxième ligne). */
  line: string;
  /** Le fichier à ouvrir (« Ouvrir »), s'il y en a un. */
  open: string | null;
  undoId: number | null;
}

/**
 * La pilule de résultat. Les textes sont déjà traduits (`tr`, le t() de
 * i18n.ts ; `intl` : tailles en KB/MB) parce qu'ils mêlent un nom, des
 * tailles et une raison : le traducteur de la page ne les reconnaîtrait pas.
 */
export function summarize(done: DoneMessage, dest: Dest, tr: (fr: string) => string = (fr) => fr, intl = false): Summary {
  const results = done.results ?? [];
  const made = results.filter((r) => r.out);
  const failed = results.filter((r) => r.error);
  const firstError = tr(sentence(failed[0]?.error ?? done.error ?? ""));
  const undoId = typeof done.undoId === "number" ? done.undoId : null;
  if (!made.length) {
    const name = results.length === 1 ? results[0].name : results.length ? tr(`${results.length} fichiers`) : "";
    const cancelled = done.cancelled || /^arrêté$/i.test(failed[0]?.error ?? "");
    return {
      ok: false,
      name,
      detail: tr(cancelled ? "Conversion arrêtée" : "") || firstError || tr("Je n'y arrive pas"),
      line: tr(cancelled ? "Conversion arrêtée" : "L'original n'a pas bougé"),
      open: null,
      undoId: null,
    };
  }
  // Avant → après : seulement les fichiers réussis (les échecs fausseraient la comparaison).
  const before = made.reduce((s, r) => s + (r.before || 0), 0);
  const after = made.reduce((s, r) => s + (r.after || 0), 0);
  const sizes = before && after ? `${formatBytes(before, intl)} → ${formatBytes(after, intl)}` : "";
  const name = made.length === 1 ? (made[0].outName ?? made[0].name) : tr(`${made.length} fichiers`);
  const fails = failed.length ? `${tr(`${failed.length} échec${failed.length > 1 ? "s" : ""}`)}${intl ? ":" : " :"} ${firstError}` : "";
  const detail = [sizes, fails].filter(Boolean).join(" · ");
  const line = tr(done.note ? sentence(done.note) : DEST_DONE[done.dest ?? dest]);
  return { ok: true, name, detail, line, open: made[0].out, undoId };
}
