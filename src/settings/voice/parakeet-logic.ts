// Ce que le bloc « Parakeet sur le PC » des Réglages affiche (1.2.4), sans DOM
// (testé dans tests/front/parakeet.test.ts). Le bloc lui-même : parakeet-block.ts.

import type { SpeechStatus } from "../../core/bridge";

/** Les boutons proposés. */
export type ParakeetAction = "download" | "cancel" | "remove" | "retry";

export interface ParakeetView {
  /** Une ligne courte : où on en est. */
  title: string;
  /** Une phrase de plus (taille, erreur, mémoire). */
  detail: string;
  /** Le message d'erreur du Rust, tel quel (non traduit), après un échec. */
  error?: string;
  /** 0 à 100 pendant le téléchargement, sinon null. */
  percent: number | null;
  actions: ParakeetAction[];
}

/** Des octets en mégaoctets entiers (1 Mo = 1 000 000 octets). */
export function megabytes(bytes: number): number {
  return Math.max(0, Math.round((Number.isFinite(bytes) ? bytes : 0) / 1_000_000));
}

/** Le pourcentage entier, borné à 0..100 (jamais 100 avant la fin). */
export function percentOf(done: number, total: number): number {
  if (!(total > 0) || !(done > 0)) return 0;
  return Math.min(99, Math.floor((done / total) * 100));
}

/** La phrase de la taille, avant le téléchargement. */
export function sizeText(total: number): string {
  return `Environ ${megabytes(total)} Mo, une seule fois. Rien n'est téléchargé avant votre clic.`;
}

/** L'état à afficher. `status` null : hors de l'appli (aperçu dans un navigateur). */
export function parakeetView(status: SpeechStatus | null): ParakeetView {
  if (!status) return { title: "Disponible dans l'appli", detail: "Ouvrez les réglages depuis Ondine pour télécharger le modèle.", percent: null, actions: [] };
  if (!status.supported) return { title: "Indisponible ici", detail: "La reconnaissance sur le PC n'existe que dans Ondine pour Windows.", percent: null, actions: [] };
  switch (status.state) {
    case "downloading": {
      const percent = percentOf(status.done, status.total);
      return {
        title: `Téléchargement : ${percent} %`,
        detail: `${megabytes(status.done)} Mo sur ${megabytes(status.total)} Mo. Vous pouvez fermer les réglages, il continue.`,
        percent,
        actions: ["cancel"],
      };
    }
    case "ready":
      return {
        title: "Prêt",
        detail: status.loaded
          ? "Le modèle est sur le PC, en mémoire en ce moment (libéré après 5 minutes sans servir)."
          : "Le modèle est sur le PC. Il se charge au premier usage (quelques secondes).",
        percent: null,
        actions: ["remove"],
      };
    case "failed":
      return {
        title: "Le téléchargement a échoué",
        detail: "Réessayer reprend où il en était.",
        error: status.error ?? undefined,
        percent: null,
        actions: ["retry"],
      };
    default:
      return { title: "Pas encore téléchargé", detail: sizeText(status.total), percent: null, actions: ["download"] };
  }
}
