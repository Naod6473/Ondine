// La pilule de la Dictée, sans DOM (testé dans tests/front/dictation.test.ts) :
// ce qu'elle montre selon l'état envoyé par le Rust (modules/dictation.rs,
// « pill-state »), les messages, le chronomètre d'un appel, et le lissage
// des neuf bulles.

/** L'état envoyé par le Rust. */
export interface PillView {
  phase: "idle" | "listening" | "handsFree" | "thinking";
  engine: string;
  edge: "bottom" | "left" | "right";
  key: string;
  call: boolean;
  callStartedAt: number | null;
  message: PillMessage | null;
}

export interface PillMessage {
  id: number;
  kind: string;
  text?: string | null;
  fix?: string | null;
}

export const IDLE_VIEW: PillView = { phase: "idle", engine: "windows", edge: "bottom", key: "rightCtrl", call: false, callStartedAt: null, message: null };

/** Ce que la pilule dessine. */
export type PillMode = "rest" | "hover" | "listening" | "handsFree" | "thinking" | "call";

/** L'écoute passe avant l'appel (on peut dicter pendant un appel), l'appel avant le survol. */
export function pillMode(v: PillView, hover: boolean): PillMode {
  if (v.phase === "listening") return "listening";
  if (v.phase === "handsFree") return "handsFree";
  if (v.phase === "thinking") return "thinking";
  if (v.call) return "call";
  return hover ? "hover" : "rest";
}

/** Le micro est ouvert : le point rouge se voit. */
export function micOpen(v: PillView): boolean {
  return v.phase === "listening" || v.phase === "handsFree";
}

/** Le nom de la touche, pour les infobulles. */
export function keyLabel(id: string): string {
  switch (id) {
    case "rightAlt":
      return "Alt droit";
    case "rightShift":
      return "Maj droite";
    case "ctrlWin":
      return "Ctrl + Windows";
    default:
      return "Ctrl droit";
  }
}

/** Ce que fait le bouton d'un message. */
export type MessageAction = "settings" | "fix" | null;

export interface MessageContent {
  text: string;
  action: MessageAction;
  /** Le libellé du bouton d'action (sinon seulement « Fermer »). */
  actionLabel: string | null;
  /** Se ferme tout seul après ce délai (ms), 0 : attend un clic. */
  autoCloseMs: number;
}

/** La phrase et le bouton d'un message de la pilule. */
export function messageContent(m: PillMessage): MessageContent {
  switch (m.kind) {
    case "copied":
      return { text: "Aucun champ de texte : votre dictée est dans le presse-papiers.", action: null, actionLabel: null, autoCloseMs: 7000 };
    case "nothing":
      return { text: "Je n'ai rien entendu.", action: null, actionLabel: null, autoCloseMs: 3500 };
    case "empty":
      return { text: "Pas encore de dictée à recoller.", action: null, actionLabel: null, autoCloseMs: 3500 };
    case "failed":
      return { text: "La dictée n'a pas pu être collée.", action: null, actionLabel: null, autoCloseMs: 6000 };
    case "parakeet":
      return { text: "La reconnaissance sur le PC n'est pas encore installée.", action: "settings", actionLabel: "Ouvrir les Réglages", autoCloseMs: 0 };
    case "noKey":
      return { text: "Pas de clé OpenAI ou Gemini pour la transcription par l'API.", action: "settings", actionLabel: "Ouvrir les Réglages", autoCloseMs: 0 };
    default: {
      const text = (m.text ?? "").trim() || "La dictée n'a pas marché.";
      // La phrase du Rust commence par une minuscule : une majuscule, un point.
      const sentence = text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?…]$/.test(text) ? "" : ".");
      return m.fix
        ? { text: sentence, action: "fix", actionLabel: "Ouvrir les Paramètres Windows", autoCloseMs: 0 }
        : { text: sentence, action: null, actionLabel: null, autoCloseMs: 9000 };
    }
  }
}

/** Le temps écoulé d'un appel, « 12:48 » ou « 1:02:03 ». */
export function callClock(startedAt: number | null, now: number): string {
  if (startedAt === null || !Number.isFinite(startedAt)) return "0:00";
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const BAND_COUNT = 9;

/**
 * Les bulles suivent les niveaux reçus : elles montent vite et retombent
 * doucement (`dt` en secondes depuis l'image précédente).
 */
export function smoothBands(prev: number[], target: number[], dt: number): number[] {
  const up = 1 - Math.exp(-dt * 30);
  const down = 1 - Math.exp(-dt * 9);
  const out: number[] = [];
  for (let i = 0; i < BAND_COUNT; i++) {
    const p = prev[i] ?? 0;
    const t = Math.min(1, Math.max(0, target[i] ?? 0));
    out.push(p + (t - p) * (t > p ? up : down));
  }
  return out;
}

/** Les bulles sont-elles toutes posées (plus rien à animer) ? */
export function bandsAtRest(a: number[], b: number[]): boolean {
  for (let i = 0; i < BAND_COUNT; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 0.005) return false;
  return true;
}
