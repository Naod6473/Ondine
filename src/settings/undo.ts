// Annuler un changement dans les Réglages (1.2.5) : après chaque changement,
// une petite bulle « Annuler » reste quelques secondes, et Ctrl+Z annule le
// dernier (Ctrl+Y le refait). Logique pure, sans DOM, testée dans
// tests/front/settings-undo.test.ts ; main.ts l'appelle depuis save().
//
// On ne garde pas des copies entières des réglages : seulement les champs qui
// ont changé (settingsDiff, le même calcul que l'enregistrement), dans les
// deux sens. Annuler remet ces champs-là, sans toucher à ce qu'une autre
// fenêtre a changé entre-temps.

import { settingsDiff, type SettingsPatch } from "../core/settings-transactions";

export interface UndoEntry {
  /** Le nom du réglage (le libellé de sa ligne), ou null s'il n'est pas connu. */
  label: string | null;
  /** Ce qui refait le changement. */
  redo: SettingsPatch[];
  /** Ce qui l'annule. */
  undo: SettingsPatch[];
  /** Quand il a été fait (ms), pour regrouper un glisser en un seul changement. */
  at: number;
  /** Les champs touchés, pour reconnaître le même réglage qui continue de changer. */
  paths: string;
}

const pathsOf = (patches: SettingsPatch[]) => patches.map((p) => p.path.join(".")).sort().join("|");

export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];

  /**
   * `max` : combien de changements on peut annuler. `mergeMs` : un même
   * réglage changé encore dans ce délai (une roue de couleur, un − + tenu)
   * reste un seul changement à annuler.
   */
  constructor(private readonly max = 10, private readonly mergeMs = 1200) {}

  /**
   * Retient un changement (les réglages avant et après). Renvoie l'entrée
   * (nouvelle ou complétée), ou null si rien n'a changé.
   */
  record(before: unknown, after: unknown, label: string | null, now: number): UndoEntry | null {
    const redo = settingsDiff(before, after);
    if (!redo.length) return null;
    const undo = settingsDiff(after, before);
    const paths = pathsOf(redo);
    // Un nouveau changement : on ne peut plus refaire ce qui avait été annulé.
    this.undone = [];
    const last = this.done[this.done.length - 1];
    if (last && last.paths === paths && now - last.at < this.mergeMs) {
      // Le même réglage qui continue de bouger : on garde le tout premier « avant ».
      last.redo = redo;
      last.at = now;
      last.label = label ?? last.label;
      return last;
    }
    const entry: UndoEntry = { label, redo, undo, at: now, paths };
    this.done.push(entry);
    if (this.done.length > this.max) this.done.shift();
    return entry;
  }

  /** Le dernier changement, à annuler ; null s'il n'y en a pas. */
  undo(): UndoEntry | null {
    const entry = this.done.pop() ?? null;
    if (entry) this.undone.push(entry);
    return entry;
  }

  /** Le dernier changement annulé, à refaire ; null s'il n'y en a pas. */
  redo(): UndoEntry | null {
    const entry = this.undone.pop() ?? null;
    if (entry) this.done.push(entry);
    return entry;
  }

  get size(): number {
    return this.done.length;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeKey = (k: string) => !["__proto__", "constructor", "prototype"].includes(k);

/**
 * Applique des changements de champs SUR l'objet (le brouillon que donne
 * settingsStore.update), au lieu d'en faire une copie.
 */
export function applyPatchInPlace(target: Record<string, unknown>, patches: readonly SettingsPatch[]) {
  for (const patch of patches) {
    if (!patch.path.length || patch.path.some((k) => !safeKey(k))) continue;
    let at = target;
    for (const key of patch.path.slice(0, -1)) {
      if (!record(at[key])) at[key] = {};
      at = at[key] as Record<string, unknown>;
    }
    const key = patch.path[patch.path.length - 1];
    if (patch.op === "remove") delete at[key];
    else at[key] = structuredClone(patch.value);
  }
}

/** Un champ de texte en cours de saisie : Ctrl+Z y annule la frappe, pas un réglage. */
export function typingTarget(tag: string, type: string | null, editable: boolean): boolean {
  if (editable) return true;
  const t = tag.toLowerCase();
  if (t === "textarea") return true;
  if (t !== "input") return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes((type ?? "text").toLowerCase());
}
