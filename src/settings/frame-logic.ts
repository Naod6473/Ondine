// La fenêtre des Réglages (1.2.4) : ce que dit la pastille d'état en bas de la
// barre latérale, et le fond choisi. Logique pure, sans DOM, testée dans
// tests/front/settings-hero.test.ts ; frame.ts la dessine.

/** Le fond de la fenêtre : noir profond (défaut) ou les taches de couleur d'avant. */
export type Backdrop = "deep" | "blobs";

/** Une valeur retenue → un fond connu (tout le reste : noir profond). */
export function backdropOf(value: unknown): Backdrop {
  return value === "blobs" ? "blobs" : "deep";
}

export interface StatusInput {
  /** La version d'Ondine (vide dans un navigateur). */
  version: string;
  /** Le module Dictée, s'il existe : activé, et ses réglages (la touche à maintenir). */
  dictation?: { enabled: boolean; values: Record<string, unknown> } | null;
  /** Mises à jour automatiques (general.autoUpdate). */
  autoUpdate: boolean;
  /** Ce qu'a répondu « Rechercher maintenant » dans cette fenêtre, s'il a été cliqué. */
  note?: { tone: "ok" | "new" | "error"; version?: string } | null;
}

export interface StatusLine {
  /** Le texte, en morceaux traduits un par un (le second peut être une touche). */
  parts: string[];
  /** La couleur du point. */
  color: string;
  /** Entre les morceaux : « · », ou une espace avant une touche. */
  sep?: string;
}

/** Les noms de touches qu'on peut recevoir des réglages de la dictée → leur nom affiché. */
const KEY_NAMES: Record<string, string> = {
  rightctrl: "Ctrl droit",
  controlright: "Ctrl droit",
  rctrl: "Ctrl droit",
  rcontrol: "Ctrl droit",
  rightalt: "Alt droit",
  altright: "Alt droit",
  ralt: "Alt droit",
  altgr: "Alt Gr",
  rightshift: "Maj droite",
  shiftright: "Maj droite",
  capslock: "Verr. Maj",
  f13: "F13",
};

/** Le nom affiché d'une touche (« ControlRight » → « Ctrl droit ») ; inconnue : telle quelle. */
export function keyName(raw: string): string {
  const k = raw.trim();
  return KEY_NAMES[k.toLowerCase().replace(/[\s_+-]/g, "")] ?? k;
}

/** La touche à maintenir pour dicter, d'après les réglages du module (plusieurs noms possibles). */
export function dictationKey(values: Record<string, unknown>): string | null {
  for (const k of ["holdKey", "hotkey", "key", "shortcut"]) {
    const v = values[k];
    if (typeof v === "string" && v.trim() && v !== "off") return keyName(v);
  }
  return null;
}

/**
 * La pastille d'état : la dictée prête (et sa touche) si le module Dictée est
 * activé ; sinon la version d'Ondine et l'état des mises à jour (rien n'est
 * demandé à Internet pour l'écrire : seulement le réglage, ou ce qu'a dit
 * « Rechercher maintenant »).
 */
export function statusLine(s: StatusInput): StatusLine {
  if (s.dictation?.enabled) {
    const key = dictationKey(s.dictation.values ?? {});
    return { parts: key ? ["Prête · maintenir", key] : ["Dictée prête"], color: "#4cd98b", sep: " " };
  }
  const name = s.version ? `Ondine ${s.version}` : "Ondine";
  if (s.note?.tone === "new") return { parts: [name, s.note.version ? `version ${s.note.version} disponible` : "nouvelle version disponible"], color: "#ffc25a" };
  if (s.note?.tone === "error") return { parts: [name, "recherche impossible"], color: "#ff8a6b" };
  if (s.note?.tone === "ok") return { parts: [name, "à jour"], color: "#7cc4ff" };
  return s.autoUpdate ? { parts: [name, "mises à jour automatiques"], color: "#7cc4ff" } : { parts: [name, "mises à jour manuelles"], color: "#8e98ad" };
}
