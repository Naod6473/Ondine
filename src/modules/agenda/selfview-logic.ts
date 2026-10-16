// « Se voir » avant une réunion (module Agenda) : la logique sans page.
// La vue (selfview.ts) ouvre la caméra et le micro ; ici, de quoi décider
// sans DOM, testé par tests/front/selfview.test.ts :
//   - la jauge du micro : le niveau (0 à 1) d'un morceau de son ;
//   - « trop sombre » : la luminance moyenne d'une petite image, avec un
//     écart pour que l'indication ne clignote pas ;
//   - les caméras et micros : retrouver celui choisi (par son nom), et les
//     choix du menu.

/** Le réglage « Avant une réunion » : aperçu au clic, tout de suite, ou jamais. */
export type MirrorMode = "click" | "auto" | "off";

export function mirrorMode(value: unknown): MirrorMode {
  return value === "auto" || value === "off" ? value : "click";
}

/**
 * Le niveau d'un morceau de son (valeurs de −1 à 1, celles d'un
 * AnalyserNode) : la moyenne quadratique, en décibels, ramenée de
 * −60 dB (rien) … 0 dB (très fort) à 0 … 1.
 */
export function meterLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/**
 * La jauge suit la voix sans trembler : elle monte tout de suite et
 * redescend doucement (`fall` : la part gardée à chaque image).
 */
export function smoothLevel(previous: number, next: number, fall = 0.86): number {
  return next >= previous ? next : Math.max(next, previous * fall);
}

/**
 * La luminance moyenne (0 à 255) d'une image RGBA (getImageData), avec les
 * poids habituels (Rec. 601). Un point sur `step` suffit.
 */
export function meanLuma(rgba: ArrayLike<number>, step = 1): number {
  const px = Math.floor(rgba.length / 4);
  if (!px) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px; i += Math.max(1, step)) {
    const o = i * 4;
    sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    n++;
  }
  return sum / n;
}

/** En dessous : « trop sombre » ; il faut repasser au-dessus de DARK_OFF pour l'enlever. */
export const DARK_ON = 55;
export const DARK_OFF = 70;

/** L'image est-elle trop sombre ? `was` : la réponse précédente (l'écart évite le clignotement). */
export function tooDark(luma: number, was: boolean): boolean {
  return was ? luma < DARK_OFF : luma < DARK_ON;
}

/** Un appareil vu par la page (MediaDeviceInfo, sans DOM). */
export interface Device {
  deviceId: string;
  label: string;
  kind: string;
}

/** Les caméras (ou les micros) de la liste, sans les entrées fantômes « default » / « communications » de Chromium. */
export function devicesOf(list: Device[], kind: "videoinput" | "audioinput"): Device[] {
  return list.filter((d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications");
}

/**
 * L'appareil à ouvrir pour le nom choisi (on garde le NOM dans les réglages :
 * l'identifiant de la page peut changer, le nom reste). Rien de choisi, ou
 * plus branché : undefined = celui de Windows.
 */
export function pickDevice(list: Device[], kind: "videoinput" | "audioinput", wanted: string): string | undefined {
  if (!wanted) return undefined;
  return devicesOf(list, kind).find((d) => d.label === wanted)?.deviceId;
}

/**
 * Les choix du menu : [valeur, libellé], la valeur étant le nom de l'appareil
 * ("" = celui de Windows). Un appareil choisi mais débranché reste dans la
 * liste, pour qu'il revienne quand on le rebranche.
 */
export function deviceOptions(list: Device[], kind: "videoinput" | "audioinput", chosen: string): [string, string][] {
  const out: [string, string][] = [["", kind === "videoinput" ? "Caméra par défaut" : "Micro par défaut"]];
  const seen = new Set<string>();
  for (const d of devicesOf(list, kind)) {
    if (!d.label || seen.has(d.label)) continue;
    seen.add(d.label);
    out.push([d.label, d.label]);
  }
  if (chosen && !seen.has(chosen)) out.push([chosen, `${chosen} (débranché)`]);
  return out;
}

/** Le message quand la caméra (ou le micro) ne s'ouvre pas, d'après le nom de l'erreur de getUserMedia. */
export function openError(name: string, kind: "camera" | "mic"): string {
  if (name === "NotAllowedError" || name === "SecurityError") return kind === "camera" ? "Caméra refusée : autorisez-la dans Paramètres Windows → Confidentialité → Caméra." : "Micro refusé : autorisez-le dans Paramètres Windows → Confidentialité → Microphone.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return kind === "camera" ? "Aucune caméra trouvée." : "Aucun micro trouvé.";
  if (name === "NotReadableError" || name === "AbortError") return kind === "camera" ? "La caméra est déjà prise par une autre appli." : "Le micro est déjà pris par une autre appli.";
  return kind === "camera" ? "Impossible d'ouvrir la caméra." : "Impossible d'ouvrir le micro.";
}
