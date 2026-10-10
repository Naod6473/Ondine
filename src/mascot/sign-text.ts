// La pancarte d'Ondine (1.2.3) : le mot qu'elle lève, sans DOM ni canvas.
//
// N'importe qui sur le bus peut lui faire lever une pancarte :
//   bus.emit("mascot.sign", { text: "Occupé", secs: 8 })
// (une règle « Mascotte → pancarte », le statut d'Équipe…). `text` vide :
// elle la baisse. Le dessin est dans gum-draw.ts (`drawSign`), la tenue dans
// mascot-state.ts (combien de temps, la pancarte « ? » des agents d'abord).

/** Au plus tant de caractères sur la planche (au-delà : coupé avec « … »). */
export const SIGN_MAX_CHARS = 14;
/** Durée par défaut, et bornes (secondes). */
export const SIGN_DEFAULT_SECS = 8;
export const SIGN_MIN_SECS = 2;
export const SIGN_MAX_SECS = 600;

/**
 * Le texte tel qu'il s'écrit sur la pancarte : sans caractère de contrôle ni
 * d'inversion de texte, espaces resserrés, 14 caractères au plus (les emojis
 * comptent pour un). Rien d'utilisable : "".
 */
export function cleanSignText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Contrôles (C0, C1), et marques de direction / inversion (U+200E-U+200F, U+202A-U+202E, U+2066-U+2069).
  const text = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  if (chars.length <= SIGN_MAX_CHARS) return text;
  return chars.slice(0, SIGN_MAX_CHARS - 1).join("").trimEnd() + "…";
}

/** Combien de temps la tenir (secondes), bornée ; absente ou invalide : 8 s. */
export function signSeconds(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : SIGN_DEFAULT_SECS;
  return Math.min(SIGN_MAX_SECS, Math.max(SIGN_MIN_SECS, Math.round(n)));
}

/**
 * La taille de la planche et du texte, en part du rayon R de la mascotte :
 * le « ? » tient sur la petite planche carrée d'origine, à côté d'elle ; un
 * mot est écrit sur une planche levée au-dessus de sa tête, aussi large que
 * le mot (2,4 R au plus, la largeur du dessin), puis le texte rapetisse.
 */
export function signLayout(text: string, measure: (fontPx: number) => number, R: number): { w: number; h: number; font: number } {
  const t = text || "?";
  if (t === "?") return { w: R * 0.62, h: R * 0.5, font: R * 0.42 };
  const h = R * 0.42;
  let font = R * 0.3;
  const pad = R * 0.24;
  const maxW = R * 2.4;
  let w = measure(font) + pad;
  if (w > maxW) {
    font = Math.max(R * 0.16, font * ((maxW - pad) / (w - pad)));
    w = Math.min(maxW, measure(font) + pad);
  }
  return { w: Math.max(R * 0.62, w), h, font };
}

/** Le statut d'Équipe → le mot de la pancarte (rien pour « disponible »). */
export function statusSign(status: string): string {
  switch (status) {
    case "focus":
      return "Occupé";
    case "meeting":
      return "En réunion";
    case "away":
      return "Pause";
    default:
      return "";
  }
}
