// « Qu'est-ce qui remplit mon disque ? » : la logique sans DOM (testée dans
// tests/front/system-disk.test.ts). La vue est dans disk-view.ts, l'analyse
// et le nettoyage en Rust (src-tauri/src/modules/system_disk.rs).

/** Un dossier de la vue (`disk_view`). */
export interface DiskChild {
  id: number;
  name: string;
  bytes: number;
  done: boolean;
  /** Il a lui-même des sous-dossiers : on peut y descendre. */
  more: boolean;
}

/** Ce que renvoie `disk_view {job, node}`. */
export interface DiskView {
  job: number;
  done: boolean;
  cancelled: boolean;
  files: number;
  dirs: number;
  skipped: number;
  excluded: number;
  folded: boolean;
  elapsedMs: number;
  total: number;
  node: { id: number; name: string; path: string; bytes: number; done: boolean };
  crumbs: { id: number; name: string }[];
  children: DiskChild[];
  here: number;
  big: { name: string; bytes: number; path: string }[];
  rest: number;
}

/** Ce que renvoie `disk_estimate`. */
export interface DiskEstimate {
  trash: { bytes: number; items: number } | null;
  temp: { bytes: number; files: number; partial: boolean };
  thumbs: { bytes: number; files: number } | null;
  downloads: { days: number; bytes: number; items: { path: string; name: string; bytes: number; days: number; dir: boolean }[] };
}

const nf = (n: number, digits = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** 1536 → « 1,5 Ko », 3 200 000 000 → « 3 Go » (une décimale sous 10). */
export function bytesText(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${nf(Math.max(0, Math.round(n || 0)))} octets`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${nf(v, v < 10 ? 1 : 0)} ${units[i]}`;
}

/** « 12 s », « 2 min 5 s ». */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** La part d'un élément, en % arrondi (« < 1 % » pour un tout petit). */
export function shareText(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0 %";
  const p = (part / total) * 100;
  return p < 1 ? "< 1 %" : `${Math.round(p)} %`;
}

/** Un morceau de la vue : un sous-dossier, les fichiers du dossier, ou le reste. */
export interface Block {
  key: string;
  label: string;
  bytes: number;
  kind: "dir" | "files" | "rest";
  /** Pour un dossier : son id dans l'analyse. */
  id?: number;
  more?: boolean;
  done?: boolean;
}

/**
 * Les morceaux à dessiner, du plus gros au plus petit : les sous-dossiers,
 * « Fichiers de ce dossier » et « Autres » (petits ou trop profonds) ; les
 * morceaux vides sont écartés, `max` au plus (le reste rejoint « Autres »).
 */
export function blocksOf(v: DiskView, max = 14): Block[] {
  const list: Block[] = v.children.map((c) => ({ key: `d${c.id}`, label: c.name, bytes: c.bytes, kind: "dir", id: c.id, more: c.more, done: c.done }));
  if (v.here > 0) list.push({ key: "files", label: "Fichiers de ce dossier", bytes: v.here, kind: "files" });
  list.sort((a, b) => b.bytes - a.bytes);
  let rest = v.rest;
  const kept = list.filter((b) => b.bytes > 0 || (b.kind === "dir" && !b.done));
  const shown = kept.slice(0, max);
  for (const b of kept.slice(max)) rest += b.bytes;
  if (rest > 0) shown.push({ key: "rest", label: "Autres (petits ou trop profonds)", bytes: rest, kind: "rest" });
  return shown;
}

/** Un rectangle de la carte, en fractions (0 à 1) de la carte. */
export interface Tile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Une carte proportionnelle simple (« squarified » : des tuiles aussi carrées
 * que possible). `ratio` = largeur / hauteur de la carte. Les tailles nulles
 * sont ignorées. Résultat en fractions de la carte.
 */
export function treemap(items: { key: string; bytes: number }[], ratio = 2): Tile[] {
  const list = items.filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const total = list.reduce((s, i) => s + i.bytes, 0);
  if (!total) return [];
  // On travaille dans un rectangle ratio × 1, puis on ramène en fractions.
  const out: Tile[] = [];
  let x = 0,
    y = 0,
    w = ratio,
    h = 1;
  const area = (b: number) => (b / total) * ratio;
  let row: { key: string; a: number }[] = [];
  const worst = (r: { a: number }[], side: number) => {
    const s = r.reduce((t, i) => t + i.a, 0);
    const max = Math.max(...r.map((i) => i.a));
    const min = Math.min(...r.map((i) => i.a));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const lay = () => {
    const s = row.reduce((t, i) => t + i.a, 0);
    if (w >= h) {
      // Une colonne à gauche, de largeur s / h.
      const cw = s / h;
      let cy = y;
      for (const i of row) {
        const ch = i.a / cw;
        out.push({ key: i.key, x: x / ratio, y: cy, w: cw / ratio, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const i of row) {
        const cw = i.a / rh;
        out.push({ key: i.key, x: cx / ratio, y, w: cw / ratio, h: rh });
        cx += cw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };
  for (const it of list) {
    const next = { key: it.key, a: area(it.bytes) };
    const side = Math.min(w, h);
    if (row.length && worst([...row, next], side) > worst(row, side)) lay();
    row.push(next);
  }
  if (row.length) lay();
  return out;
}

/** La ligne d'état sous le chemin. */
export function statusParts(v: DiskView): string[] {
  const parts: string[] = [];
  if (v.cancelled) parts.push("Analyse arrêtée");
  else if (v.done) parts.push(`Analysé en ${elapsedText(v.elapsedMs)}`);
  else parts.push("Analyse en cours…");
  parts.push(`${nf(v.files)} fichiers`);
  if (v.skipped > 0) parts.push(`${nf(v.skipped)} dossiers fermés ignorés`);
  if (v.excluded > 0) parts.push(`${nf(v.excluded)} dossiers exclus non comptés`);
  return parts;
}

/** Une ligne du nettoyage. */
export interface CleanLine {
  kind: "trash" | "temp" | "thumbs" | "downloads";
  icon: string;
  label: string;
  bytes: number;
  detail: string;
  /** Le libellé du bouton. */
  action: string;
  /** La question de confirmation. */
  confirm: string;
  /** Rien à gagner : la ligne est grisée. */
  empty: boolean;
}

/** Les lignes du nettoyage, dans l'ordre : téléchargements d'abord (ils vont à la Corbeille, qu'on peut vider ensuite). */
export function cleanLines(e: DiskEstimate): CleanLine[] {
  const out: CleanLine[] = [];
  const dl = e.downloads;
  out.push({
    kind: "downloads",
    icon: "⬇️",
    label: `Vieux téléchargements (plus de ${dl.days} jours)`,
    bytes: dl.bytes,
    detail: `${nf(dl.items.length)} éléments · envoyés à la Corbeille`,
    action: "Choisir…",
    confirm: "",
    empty: dl.items.length === 0,
  });
  out.push({
    kind: "temp",
    icon: "🧹",
    label: "Fichiers temporaires",
    bytes: e.temp.bytes,
    detail: `${nf(e.temp.files)} fichiers de plus de 24 h · les fichiers ouverts sont laissés`,
    action: "Nettoyer",
    confirm: "Supprimer ces fichiers temporaires ? Les applis les recréent au besoin.",
    empty: e.temp.files === 0,
  });
  if (e.thumbs) {
    out.push({
      kind: "thumbs",
      icon: "🖼️",
      label: "Cache des miniatures",
      bytes: e.thumbs.bytes,
      detail: "Windows le refait quand vous ouvrez un dossier",
      action: "Nettoyer",
      confirm: "Supprimer le cache des miniatures ? L'Explorateur le refera.",
      empty: e.thumbs.files === 0,
    });
  }
  if (e.trash) {
    out.push({
      kind: "trash",
      icon: "🗑️",
      label: "Corbeille",
      bytes: e.trash.bytes,
      detail: `${nf(e.trash.items)} éléments`,
      action: "Vider la Corbeille",
      confirm: "Vider la Corbeille ? C'est définitif.",
      empty: e.trash.items === 0,
    });
  }
  return out;
}

/** Ce que coûtent les téléchargements cochés. */
export function checkedBytes(items: { path: string; bytes: number }[], checked: Set<string>): number {
  return items.reduce((s, i) => s + (checked.has(i.path) ? i.bytes : 0), 0);
}

/** Le résultat d'un nettoyage, en une phrase pour la notification. */
export function cleanResult(kind: CleanLine["kind"], r: { freed: number; files: number; skipped: number; trashed?: number }): { title: string; body: string } {
  if (kind === "downloads") {
    return { title: `${nf(r.files)} éléments envoyés à la Corbeille`, body: "Videz la Corbeille pour libérer la place." };
  }
  const title = `${bytesText(r.freed)} libérés`;
  const body = r.skipped > 0 ? `${nf(r.skipped)} fichiers en cours d'utilisation laissés.` : "";
  return { title, body };
}

/** « C:\ » → « Disque C: » ; un autre chemin → son dernier nom. */
export function rootLabel(path: string): string {
  const drive = /^([a-z]:)\\?$/i.exec(path);
  if (drive) return `Disque ${drive[1].toUpperCase()}`;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
