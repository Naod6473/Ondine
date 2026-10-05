// Les réglages côté front : une copie locale, tenue à jour quand l'autre fenêtre
// (ou un import) les modifie. L'enregistrement se fait toujours dans le Rust.

import { Bridge, onTauriEvent } from "./bridge";
import { defaultSettings, type Settings } from "./types";
import type { ModuleManifest, SettingField } from "./module-types";

type Listener = (s: Settings) => void;

class SettingsStore {
  current: Settings = defaultSettings();
  private listeners: Listener[] = [];

  async connect(initial: Settings | null) {
    if (initial) this.current = initial;
    await onTauriEvent<Settings>("settings-changed", (s) => {
      this.current = s;
      this.notify();
    });
  }

  onChange(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Modifie une copie, l'applique tout de suite ici, puis l'enregistre. */
  async update(change: (draft: Settings) => void) {
    const draft = structuredClone(this.current);
    change(draft);
    this.current = draft;
    this.notify();
    try {
      await Bridge.settingsSave(draft);
    } catch (err) {
      console.warn("[réglages] non enregistrés", err);
    }
  }

  moduleEnabled(id: string): boolean {
    return this.current.modules[id]?.enabled ?? true;
  }

  /** Les réglages d'un module, complétés par les valeurs par défaut du manifeste. */
  moduleValues(manifest: ModuleManifest): Record<string, unknown> {
    const stored = this.current.modules[manifest.id]?.values ?? {};
    const out: Record<string, unknown> = {};
    for (const field of manifest.settings?.fields ?? []) {
      out[field.key] = coerce(field, stored[field.key]);
    }
    return out;
  }

  private notify() {
    for (const l of this.listeners) {
      try {
        l(this.current);
      } catch (err) {
        console.error("[réglages] abonné en erreur", err);
      }
    }
  }
}

/** Ramène une valeur enregistrée à quelque chose de valide pour ce champ. */
export function coerce(field: SettingField, value: unknown): unknown {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? value : field.default;
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return field.default;
      let v = value;
      if (field.min !== undefined) v = Math.max(field.min, v);
      if (field.max !== undefined) v = Math.min(field.max, v);
      return v;
    }
    case "select":
      return field.options.some((o) => o.value === value) ? value : field.default;
    case "string":
      return typeof value === "string" ? value.slice(0, field.maxLength ?? 500) : field.default;
    case "files":
    case "folders": {
      if (!Array.isArray(value)) return [...field.default];
      const folders = value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length < 1000);
      return [...new Set(folders)].slice(0, field.max ?? 20);
    }
  }
}

export const settingsStore = new SettingsStore();
