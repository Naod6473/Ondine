// Module « Mail » : petits textes (date, taille, nom de fichier), sans DOM, testés
// par tests/front/mail.test.ts.

/** « 08:35 » aujourd'hui, sinon « 12/10 ». */
export function shortDate(ms: number, now = new Date()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = d.toDateString() === now.toDateString();
  const two = (n: number) => String(n).padStart(2, "0");
  return sameDay ? `${two(d.getHours())}:${two(d.getMinutes())}` : `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
}

/** 1536 → « 1,5 Ko ». */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const ko = bytes / 1024;
  if (ko < 1024) return `${ko.toFixed(ko < 10 ? 1 : 0).replace(".", ",")} Ko`;
  return `${(ko / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Le nom d'un fichier dans un chemin Windows. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
