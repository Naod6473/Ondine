// Le calendrier de contributions GitHub (onglet Agents IA) : la logique pure,
// sans DOM, testée dans tests/front/github.test.ts. L'affichage est dans
// github-view.ts ; les données viennent du Rust (modules/agents_github.rs,
// commande `github_calendar`).

/** Un jour, tel que le Rust l'envoie. */
export interface GithubDay {
  /** « 2025-10-08 » */
  date: string;
  count: number;
  /** 0 (rien) à 4 (le plus). */
  level: number;
}

/** La réponse de `github_calendar`. */
export interface GithubCalendar {
  login: string;
  total: number;
  /** Jours d'affilée avec une contribution (jusqu'à hier si rien encore aujourd'hui). */
  streak: number;
  today: number;
  /** Du dimanche d'il y a 52 semaines à aujourd'hui, sans trou. */
  days: GithubDay[];
  /** Quand GitHub a répondu (ms). */
  fetchedAt: number;
  /** Lu avec un jeton (les contributions privées comprises). */
  private: boolean;
  /** Rien n'a été demandé à GitHub (mémoire ou copie du disque). */
  fromCache?: boolean;
}

/** La grille de GitHub : 53 colonnes (semaines) de 7 lignes (dimanche en haut). */
export const WEEKS = 53;
/** Les paliers de série que la mascotte fête (une fois par palier et par série). */
export const STREAK_STAGES = [7, 30, 100] as const;
export type StreakStage = (typeof STREAK_STAGES)[number];
/** Durée de la vague d'allumage, en tout (ms) : chaque colonne part un peu après la précédente. */
export const WAVE_MS = 1200;

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Ce qui cloche dans un identifiant GitHub tapé dans les réglages ("" : rien).
 * Lettres, chiffres et tirets, 39 caractères au plus, pas de tiret au début.
 */
export function loginProblem(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length > 39) return "39 caractères au plus.";
  if (!/^[A-Za-z0-9-]+$/.test(v)) return "Lettres, chiffres et tirets seulement (pas d'espace, pas d'adresse : juste l'identifiant).";
  if (v.startsWith("-")) return "Un identifiant GitHub ne commence pas par un tiret.";
  return "";
}

/** Un nombre à la française : 1 234. */
function num(n: number): string {
  return n.toLocaleString("fr-FR");
}

/**
 * Les deux moitiés de l'en-tête, « 336 contributions cette année » et « série
 * de 12 jours » : la vue les affiche séparément pour que chacune se traduise.
 */
export function headlineParts(total: number, streak: number): [string, string] {
  const left = total === 1 ? "1 contribution cette année" : `${num(total)} contributions cette année`;
  const right = streak === 0 ? "pas de série en cours" : streak === 1 ? "série de 1 jour" : `série de ${num(streak)} jours`;
  return [left, right];
}

/** « 336 contributions cette année · série de 12 jours ». */
export function headline(total: number, streak: number): string {
  return headlineParts(total, streak).join(" · ");
}

/**
 * « 2025-10-08 » → « 8 octobre » (« 1er octobre » pour le premier) ; en
 * anglais « October 8 » (le mois n'est pas traduisible par un motif de
 * i18n-en.json, la vue choisit donc la langue ici).
 */
export function dayLabel(date: string, english = false): string {
  const [, m, d] = date.split("-").map(Number);
  if (!m || !d) return date;
  if (english) return `${MONTHS_EN[m - 1] ?? ""} ${d}`;
  return `${d === 1 ? "1er" : d} ${MONTHS_LONG[m - 1] ?? ""}`;
}

/** La bulle d'une case : « 3 contributions le 8 octobre », « Aucune contribution le 8 octobre ». */
export function dayTitle(count: number, date: string, english = false): string {
  const when = dayLabel(date, english);
  if (count === 0) return `Aucune contribution le ${when}`;
  if (count === 1) return `1 contribution le ${when}`;
  return `${num(count)} contributions le ${when}`;
}

/** Le niveau de couleur (0 à 4), toujours dans les bornes, même si GitHub change. */
export function levelClass(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(4, Math.round(level)));
}

/**
 * Un niveau à partir d'un nombre (pour le mode démo, qui invente les cases) :
 * 0 pour rien, puis quatre quarts jusqu'à `max`, comme les quartiles de GitHub.
 */
export function levelFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
}

/** Une colonne de la grille : 7 cases, du dimanche au samedi (null : pas encore arrivé). */
export type Column = (GithubDay | null)[];

/** L'étiquette d'un mois au-dessus de la colonne où il commence. */
export interface MonthLabel {
  col: number;
  label: string;
}

function dayOfWeek(date: string): number {
  // Le jour de la semaine sans fuseau : la date est lue comme UTC.
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? 0 : d.getUTCDay();
}

/**
 * Range les jours (déjà sans trou, du dimanche de départ à aujourd'hui) en
 * colonnes de 7 ; la dernière colonne est complétée par des cases vides
 * (null) pour les jours à venir de la semaine. Toujours 53 colonnes : si le
 * Rust en donne moins, des colonnes vides les précèdent.
 */
export function columns(days: GithubDay[]): Column[] {
  const cols: Column[] = [];
  let col: Column = [];
  const first = days[0];
  // Si la liste ne commence pas un dimanche, on cale les premières cases.
  if (first) for (let i = 0; i < dayOfWeek(first.date); i++) col.push(null);
  for (const d of days) {
    col.push(d);
    if (col.length === 7) {
      cols.push(col);
      col = [];
    }
  }
  if (col.length) {
    while (col.length < 7) col.push(null);
    cols.push(col);
  }
  while (cols.length < WEEKS) cols.unshift([null, null, null, null, null, null, null]);
  return cols.slice(-WEEKS);
}

/** Les mois à écrire au-dessus de la grille : là où un mois commence (la colonne du 1er). */
export function monthLabels(cols: Column[]): MonthLabel[] {
  const out: MonthLabel[] = [];
  let last = -1;
  cols.forEach((col, i) => {
    const firstDay = col.find((d): d is GithubDay => !!d);
    if (!firstDay) return;
    const month = Number(firstDay.date.slice(5, 7)) - 1;
    if (month === last) return;
    // Un mois qui ne tient que sur une colonne, en tête, s'écrirait sur le suivant : on le saute.
    const changesSoon = cols[i + 1]?.find((d): d is GithubDay => !!d && Number(d.date.slice(5, 7)) - 1 !== month);
    if (last === -1 && changesSoon) {
      last = month;
      return;
    }
    last = month;
    out.push({ col: i, label: MONTHS_SHORT[month] ?? "" });
  });
  return out;
}

/** Le palier atteint par une série (le plus haut), ou null. */
export function stageReached(streak: number): StreakStage | null {
  let stage: StreakStage | null = null;
  for (const s of STREAK_STAGES) if (streak >= s) stage = s;
  return stage;
}

/**
 * La clé d'une fête : « <premier jour de la série>:<palier> ». La même série
 * ne fête chaque palier qu'une fois, même après un redémarrage (la clé est
 * gardée dans localStorage) ; une nouvelle série repart de zéro.
 */
export function celebrationKey(cal: Pick<GithubCalendar, "days" | "streak">, stage: StreakStage): string | null {
  if (cal.streak <= 0) return null;
  let end = cal.days.length - 1;
  // Rien encore aujourd'hui : la série finit hier.
  if (end >= 0 && cal.days[end].count === 0) end--;
  const start = cal.days[end - cal.streak + 1];
  return start ? `${start.date}:${stage}` : null;
}

/** Le palier à fêter maintenant, ou null (déjà fêté, ou pas de palier). */
export function stageToCelebrate(cal: Pick<GithubCalendar, "days" | "streak">, remembered: string | null): StreakStage | null {
  const stage = stageReached(cal.streak);
  if (!stage) return null;
  const key = celebrationKey(cal, stage);
  return key && key !== remembered ? stage : null;
}

/** Le délai d'allumage d'une colonne pendant la vague (ms). */
export function waveDelay(col: number): number {
  return Math.round((col / (WEEKS - 1)) * WAVE_MS);
}

/** « Mis à jour à 14:32 ». */
export function updatedLabel(fetchedAt: number): string {
  if (!fetchedAt) return "";
  const d = new Date(fetchedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Mis à jour à ${hh}:${mm}`;
}
