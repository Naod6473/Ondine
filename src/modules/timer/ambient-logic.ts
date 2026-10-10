// Les sons d'ambiance du Minuteur (1.2.3) : la liste, les noms, le volume et
// ce que fait le liquide de l'île pour chaque son. Sans DOM ni WebAudio, pour
// être testé (tests/front/ambient.test.ts) ; le son lui-même : ambient.ts.
//
// Deux sortes de sons :
//   - générés dans l'appli (WebAudio, aucun fichier) : pluie, vagues, bruit doux ;
//   - de vrais enregistrements, déposés dans src/assets/ambient/ (mp3, ogg,
//     wav ou m4a, boucles d'une à deux minutes, libres de droits CC0) : ils
//     apparaissent tout seuls dans la liste au prochain build, nommés d'après
//     le fichier (« cafe.ogg » → « Café », voir FILE_LABELS). Aucun n'est
//     fourni pour l'instant : Simon ajoutera café, forêt… quand il les aura.

/** Comment le son est fait, et donc comment le liquide le suit. */
export type AmbientKind = "rain" | "waves" | "noise" | "file";

export interface AmbientSound {
  id: string;
  label: string;
  icon: string;
  kind: AmbientKind;
  /** Un enregistrement : son adresse (donnée par Vite). */
  url?: string;
}

/** Les sons générés, toujours là. */
export const GENERATED: AmbientSound[] = [
  { id: "rain", label: "Pluie", icon: "🌧️", kind: "rain" },
  { id: "waves", label: "Vagues", icon: "🌊", kind: "waves" },
  { id: "noise", label: "Bruit doux", icon: "🌫️", kind: "noise" },
];

/** Les noms (et pictogrammes) des enregistrements attendus, d'après le nom du fichier. */
export const FILE_LABELS: Record<string, { label: string; icon: string }> = {
  cafe: { label: "Café", icon: "☕" },
  foret: { label: "Forêt", icon: "🌲" },
  feu: { label: "Feu de cheminée", icon: "🔥" },
  ville: { label: "Ville", icon: "🏙️" },
  oiseaux: { label: "Oiseaux", icon: "🐦" },
  riviere: { label: "Rivière", icon: "🏞️" },
  orage: { label: "Orage", icon: "⛈️" },
  train: { label: "Train", icon: "🚆" },
  bibliotheque: { label: "Bibliothèque", icon: "📚" },
};

/** « ../../assets/ambient/Café du coin.ogg » → « cafe-du-coin » (un identifiant sûr). */
export function fileId(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const base = name.replace(/\.[^.]+$/, "");
  return base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Le nom montré d'un fichier inconnu : « mer-du-nord » → « Mer du nord ». */
function niceName(id: string): string {
  const words = id.replace(/-/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Son";
}

/**
 * La liste complète : les sons générés, puis les enregistrements trouvés
 * (`files` : chemin → adresse, comme le donne import.meta.glob), par nom.
 */
export function ambientList(files: Record<string, string>): AmbientSound[] {
  const seen = new Set(GENERATED.map((s) => s.id));
  const recorded: AmbientSound[] = [];
  for (const [path, url] of Object.entries(files)) {
    const id = fileId(path);
    if (!id || seen.has(`file-${id}`)) continue;
    seen.add(`file-${id}`);
    const known = FILE_LABELS[id];
    recorded.push({ id: `file-${id}`, label: known?.label ?? niceName(id), icon: known?.icon ?? "🎧", kind: "file", url });
  }
  recorded.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  return [...GENERATED, ...recorded];
}

/** Le son choisi s'il existe encore, sinon le premier (la pluie). */
export function pickSound(list: AmbientSound[], id: string | null | undefined): AmbientSound {
  return list.find((s) => s.id === id) ?? list[0];
}

/** Volume réglé (0 à 100) → gain : courbe au carré, plus fine dans les sons faibles. */
export function volumeGain(percent: number): number {
  const v = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)) / 100;
  return v * v * 0.8;
}

/** Une vague toutes les 9 secondes (elle monte, se retire) : le liquide suit le même rythme. */
export const WAVE_PERIOD_MS = 9000;

/** Ce que le Minuteur publie (« timer.ambient ») pendant qu'un son joue. */
export interface AmbientNews {
  on: boolean;
  sound?: string;
  kind?: AmbientKind;
  /** Volume réglé, 0 à 100. */
  volume?: number;
  /** Le niveau du son en ce moment (0 à 1), mesuré 4 fois par seconde. */
  level?: number;
  /** Les vagues : l'heure (Date.now()) du début du premier cycle, et la durée d'un cycle. */
  startedAt?: number;
  periodMs?: number;
}

/** Ce que fait le liquide de l'île pour ce son (liquid-moments.ts). */
export interface AmbientLiquidPlan {
  level: number;
  wobble: number;
  bubbles: number;
  /** Des gouttes sur la vitre de l'île (ambiance « rain » de liquid.ts). */
  rain: boolean;
  /** Une vague traverse l'île à chaque crête (ms) ; 0 = jamais. */
  waveEveryMs: number;
}

/** Le plan du liquide : plus haut et plus agité quand le son est plus fort. */
export function ambientLiquidPlan(n: AmbientNews): AmbientLiquidPlan | null {
  if (!n.on) return null;
  const vol = Math.max(0, Math.min(100, n.volume ?? 40)) / 100;
  const level = Math.max(0, Math.min(1, n.level ?? vol * 0.5));
  const base = 0.18 + 0.14 * vol;
  switch (n.kind) {
    case "rain":
      return { level: base, wobble: 0.25 + 0.5 * level, bubbles: 1.5, rain: true, waveEveryMs: 0 };
    case "waves":
      return { level: base + 0.04, wobble: 0.35 + 0.6 * level, bubbles: 0.4, rain: false, waveEveryMs: n.periodMs && n.periodMs > 2000 ? n.periodMs : WAVE_PERIOD_MS };
    case "noise":
      return { level: base, wobble: 0.12 + 0.3 * level, bubbles: 0.2, rain: false, waveEveryMs: 0 };
    default:
      return { level: base, wobble: 0.15 + 0.7 * level, bubbles: 0.6, rain: false, waveEveryMs: 0 };
  }
}

/**
 * Dans combien de ms arrive la prochaine crête de vague, à `now` (Date.now()).
 * Le volume suit un sinus qui part de zéro à `startedAt` : crête au quart du cycle.
 */
export function nextCrestIn(now: number, startedAt: number, periodMs: number): number {
  const p = Math.max(1, periodMs);
  const crest = startedAt + p / 4;
  const since = (((now - crest) % p) + p) % p;
  return since === 0 ? 0 : p - since;
}
