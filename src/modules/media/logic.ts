// Module « Musique » : les calculs de la carte, sans DOM (testés dans
// tests/front/media.test.ts). La carte elle-même est dans index.ts.

/** Miroir de `NowPlaying` (src-tauri/src/platform/media.rs). */
export interface NowPlaying {
  app: string;
  title: string;
  artist: string;
  album: string;
  status: "playing" | "paused" | "stopped" | "changing";
  positionMs: number | null;
  durationMs: number | null;
  canToggle: boolean;
  canNext: boolean;
  canPrevious: boolean;
  /** Le lecteur accepte-t-il qu'on change la position ? */
  canSeek: boolean;
  /** Aléatoire et répétition (1.2.4) ; absents d'un ancien message : « non ». */
  shuffle?: boolean;
  repeat?: RepeatMode;
  canShuffle?: boolean;
  canRepeat?: boolean;
}

export type RepeatMode = "none" | "track" | "list";

/** Le volume du lecteur (commande `volume`) : null = le lecteur n'a pas de son à régler. */
export interface PlayerVolume {
  volume: number | null;
  muted: boolean;
}

/** 83 000 → « 1:23 » ; une heure et plus → « 1:02:03 ». */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Le temps qui reste, avec un signe moins (« -2:13 »), comme les lecteurs.
 * Arrondi vers le haut : on ne lit jamais « -0:00 » tant que ça joue encore.
 */
export function remaining(positionMs: number, durationMs: number): string {
  const left = Math.max(0, durationMs - Math.max(0, positionMs));
  return `-${clock(Math.ceil(left / 1000) * 1000)}`;
}

/**
 * Le niveau de l'icône du volume : 0 = coupé (ou à zéro), 1 = bas (moins
 * d'un tiers), 2 = moyen, 3 = fort. Un volume inconnu montre l'icône moyenne.
 */
export function volumeLevel(volume: number | null, muted = false): 0 | 1 | 2 | 3 {
  if (volume === null || Number.isNaN(volume)) return 2;
  if (muted || volume <= 0) return 0;
  if (volume < 34) return 1;
  if (volume < 67) return 2;
  return 3;
}

/** La répétition suivante au clic, comme Spotify : rien → la liste → le morceau → rien. */
export function nextRepeat(mode: RepeatMode | undefined): RepeatMode {
  return mode === "list" ? "track" : mode === "track" ? "none" : "list";
}

/** Un bouton de la carte : utilisable, allumé (en couleur) et son libellé. */
export interface ButtonState {
  enabled: boolean;
  on: boolean;
  label: string;
}

export interface Buttons {
  shuffle: ButtonState;
  repeat: ButtonState;
  previous: ButtonState;
  toggle: ButtonState;
  next: ButtonState;
  volume: ButtonState;
}

/** L'état de chaque bouton de la carte, d'après le lecteur et son volume. */
export function buttons(p: NowPlaying, vol: PlayerVolume | null): Buttons {
  const playing = p.status === "playing";
  const canShuffle = p.canShuffle === true;
  const canRepeat = p.canRepeat === true;
  const shuffleOn = canShuffle && p.shuffle === true;
  const repeat = canRepeat ? (p.repeat ?? "none") : "none";
  const hasVolume = !!vol && vol.volume !== null;
  return {
    shuffle: {
      enabled: canShuffle,
      on: shuffleOn,
      label: !canShuffle ? "Aléatoire indisponible pour ce lecteur" : shuffleOn ? "Aléatoire activé" : "Aléatoire désactivé",
    },
    repeat: {
      enabled: canRepeat,
      on: repeat !== "none",
      label: !canRepeat
        ? "Répétition indisponible pour ce lecteur"
        : repeat === "track"
          ? "Répéter ce morceau"
          : repeat === "list"
            ? "Répéter la liste"
            : "Répétition désactivée",
    },
    previous: { enabled: p.canPrevious, on: false, label: "Précédent" },
    toggle: { enabled: p.canToggle, on: playing, label: playing ? "Pause" : "Lecture" },
    next: { enabled: p.canNext, on: false, label: "Suivant" },
    volume: {
      enabled: hasVolume,
      on: hasVolume && !vol!.muted,
      label: hasVolume ? "Volume du lecteur, pas celui du PC" : "Volume indisponible pour ce lecteur",
    },
  };
}

/**
 * Un nom lisible pour l'appli qui joue. Windows donne « Spotify.exe », ou pour
 * une appli du Store quelque chose comme « Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic ».
 * Les navigateurs ont leur nom (« MSEdge » → Edge, le code de Firefox → Firefox).
 */
export function appName(id: string): string {
  const last = id.split("!").pop() ?? id;
  if (/^[0-9A-F]{16}$/i.test(last)) return "Firefox";
  if (/^msedge(\.exe)?$/i.test(last)) return "Edge";
  return last.replace(/\.exe$/i, "").replace(/^Microsoft\./, "").replace(/_[a-z0-9]{13}$/, "") || id;
}

type Rgb = readonly [number, number, number];

/**
 * La couleur de la carte d'après celle de la pochette : assez claire pour se
 * voir sur l'île noire (une pochette sombre est éclaircie, sans changer de teinte), et une
 * version douce pour la lueur. null : la couleur d'accent du thème.
 */
export function cardTint(rgb: Rgb | null): { tint: string; soft: string } | null {
  if (!rgb) return null;
  let [r, g, b] = rgb.map((v) => Math.max(0, Math.min(255, v)));
  // Une couleur vive : on l'éclaire jusqu'à ce que son canal le plus fort
  // atteigne 235 (même teinte, même saturation).
  const top = Math.max(r, g, b);
  if (top > 0 && top < 235) [r, g, b] = [r, g, b].map((v) => (v * 235) / top);
  // Luminance perçue (0…255) : sous 110, on mélange avec du blanc.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 110) {
    const k = Math.min(0.6, (110 - lum) / 160);
    [r, g, b] = [r, g, b].map((v) => v + (255 - v) * k);
  }
  const c = [r, g, b].map((v) => Math.round(v)).join(", ");
  return { tint: `rgb(${c})`, soft: `rgba(${c}, 0.35)` };
}

/**
 * Limite les envois pendant un glissé (le volume) : le premier part tout de
 * suite, puis au plus un toutes les `gapMs` ; la dernière valeur part
 * toujours, à la fin. `flush()` envoie tout de suite la valeur en attente
 * (quand on lâche). Les minuteries sont passées en paramètre pour les tests.
 */
export function throttle<T>(
  send: (v: T) => void,
  gapMs = 120,
  timers: { now: () => number; later: (fn: () => void, ms: number) => unknown; cancel: (t: unknown) => void } = {
    now: () => performance.now(),
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  },
) {
  let last = -Infinity;
  let pending: { v: T } | null = null;
  let timer: unknown = null;
  const fire = () => {
    timer = null;
    if (!pending) return;
    const { v } = pending;
    pending = null;
    last = timers.now();
    send(v);
  };
  return {
    push(v: T) {
      pending = { v };
      const wait = last + gapMs - timers.now();
      if (wait <= 0 && timer === null) fire();
      else if (timer === null) timer = timers.later(fire, Math.max(0, wait));
    },
    flush() {
      if (timer !== null) timers.cancel(timer);
      timer = null;
      fire();
    },
  };
}

// ── L'égaliseur de la mini-île sur le vrai son (1.2.5) ──────────────────────

/** Ce que renvoie la commande `levels` (0 à 1) : ensemble, gauche, droite. */
export interface Levels {
  level: number;
  left: number;
  right: number;
}

/** La hauteur des barres (px) : au repos, au plus haut (comme .media-eq dans island.css). */
export const EQ_MIN = 3;
export const EQ_MAX = 14;

/**
 * Les trois hauteurs suivantes (gauche, ensemble, droite) : la barre monte
 * tout de suite vers le niveau, et redescend en douceur (comme un vumètre),
 * pour ne pas trembler entre deux lectures. Le niveau passe par une racine
 * carrée : la musique douce bouge déjà un peu (l'oreille entend en
 * logarithme, l'indicateur de Windows est linéaire).
 */
export function eqHeights(before: readonly number[], l: Levels): [number, number, number] {
  const target = [l.left, l.level, l.right].map((v) => EQ_MIN + Math.sqrt(Math.max(0, Math.min(1, Number(v) || 0))) * (EQ_MAX - EQ_MIN));
  return target.map((t, i) => {
    const b = before[i] ?? EQ_MIN;
    const next = t >= b ? t : Math.max(t, b - (b - EQ_MIN) * 0.35);
    return Math.round(next * 10) / 10;
  }) as [number, number, number];
}
