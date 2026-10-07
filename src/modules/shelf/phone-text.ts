// Petits textes du panneau « Vers le téléphone » (phone.ts), sans DOM : testés
// par tests/front/phone.test.ts.

/** Le compte à rebours : « 4:05 » (jamais en dessous de 0:00). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * La taille d'un fichier : « 512 o », « 2,4 Mo », « 350 Ko » (une décimale
 * sous 10). Traduite en anglais par les motifs de i18n-en.json (« 2.4 MB »).
 */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const n = v < 10 ? v.toFixed(1).replace(".", ",") : String(Math.round(v));
  return `${n} ${units[i]}`;
}
