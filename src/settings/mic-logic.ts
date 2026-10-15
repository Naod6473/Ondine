// Logique sans page des blocs « Micro » et « Dis Ondine » des réglages de
// Parler à Ondine (1.2.4, mic-block.ts) : la liste des micros, l'avertissement
// des moteurs de Windows, le bilan de « Tester le micro », l'état du mot
// d'appel. Testée par tests/front/mic.test.ts.

/** Un micro du PC (platform/voice.rs `MicDevice`). */
export interface Mic {
  id: string;
  name: string;
  default: boolean;
  communications: boolean;
}

/** La réponse de la commande `mics` du module askclaude. */
export interface MicList {
  supported: boolean;
  mics: Mic[];
  chosen: string;
  testing?: boolean;
}

/** Les choix de la liste « Micro » : [valeur, libellé]. Le premier est celui de Windows. */
export function micOptions(list: Mic[], chosen: string): [string, string][] {
  const def = list.find((m) => m.default);
  const out: [string, string][] = [["", def ? `Micro par défaut de Windows (${def.name})` : "Micro par défaut de Windows"]];
  for (const m of list) out.push([m.id, m.communications && !m.default ? `${m.name} · communication` : m.name]);
  // Le micro choisi n'est plus branché : il reste choisi (il reviendra).
  if (chosen && !list.some((m) => m.id === chosen)) out.push([chosen, "Micro choisi (débranché : celui par défaut en attendant)"]);
  return out;
}

/**
 * Le moteur choisi n'écoutera pas le micro choisi : la reconnaissance vocale
 * de Windows (WinRT) écoute toujours le micro par défaut de Windows. Le moteur
 * hors ligne (SAPI), Parakeet et l'API prennent le micro choisi.
 */
export function micEngineWarning(engine: string, chosen: string, list: Mic[]): string | null {
  if (engine !== "windows" && engine !== "") return null;
  if (!chosen) return null;
  if (list.find((m) => m.id === chosen)?.default) return null;
  return "La reconnaissance vocale de Windows écoute toujours le micro par défaut de Windows, pas celui choisi ici : faites-en le micro par défaut dans les paramètres du son de Windows, ou passez à Parakeet (sur le PC).";
}

/** Le bilan de « Tester le micro » (événement « mic-test » final). */
export interface MicTestEnd {
  done: true;
  info?: { name: string; format: string; peak: number; muted: boolean | null; volume: number | null; fellBack: boolean };
  problem?: string | null;
  fix?: string | null;
}

/** Une phrase du Rust (« le micro … ») commence par une majuscule à l'écran. */
export function sentence(text: string): string {
  const t = text.trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : t;
}

/** Ce que dit « Tester le micro » à la fin. */
export function micTestText(end: MicTestEnd): { ok: boolean; text: string; note: string | null } {
  const note = end.info?.fellBack ? "Le micro choisi est introuvable : c'est celui par défaut de Windows qui a été écouté." : null;
  if (end.problem) return { ok: false, text: sentence(end.problem), note };
  const name = end.info?.name || "Micro";
  const level = Math.round((end.info?.peak ?? 0) * 100);
  return { ok: true, text: `Ondine vous entend avec « ${name} » (niveau max ${level} %).`, note };
}

/** L'état du mot d'appel (commande `wake_state`). */
export interface WakeState {
  supported: boolean;
  on: boolean;
  paused: string;
  parakeet: boolean;
}

/** La ligne d'état sous « Dis Ondine ». `wanted` : le réglage est allumé. */
export function wakeText(s: WakeState | null, wanted: boolean): string {
  if (!s || !s.supported) return "Windows seulement.";
  if (!s.parakeet) return "Il faut d'abord le modèle Parakeet : téléchargez-le dans le bloc « Parakeet sur le PC » de cette page.";
  if (!wanted) return "Coupé : le micro ne s'ouvre qu'avec le raccourci ou le bouton 🎙️.";
  if (s.on) return "À l'écoute du mot d'appel, sur le PC. Un point rouge reste visible sur l'île.";
  switch (s.paused) {
    case "busy":
      return "En pause : Ondine écoute déjà (raccourci, dictée ou notes d'appel).";
    case "discreet":
      return "En pause : discrétion (visio, présentation ou concentration).";
    case "locked":
      return "En pause : le PC est verrouillé.";
    case "eco":
      return "En pause : mode Économie d'énergie.";
    case "parakeet":
      return "En pause : le modèle Parakeet manque.";
    case "off":
      return "Démarrage…";
    default:
      return "En pause.";
  }
}
