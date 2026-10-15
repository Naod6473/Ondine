// Ce que partagent les pages Voix de la Dictée (Dictée, Statistiques,
// Dictionnaire, Styles) : l'appel au Rust du module, l'enregistrement d'un
// réglage du module, le passage à une autre page, l'écoute du bus.

import "../../styles/dictation.css";
import { Bridge, onTauriEvent } from "../../core/bridge";
import type { BusMessage } from "../../core/bus";
import { errorText } from "../../core/log";
import type { ModuleManifest } from "../../core/module-types";
import { settingsStore } from "../../core/settings-store";
import manifestJson from "../../modules/dictation/manifest.json";
import { el } from "../../island/dom";
import { toggle } from "../controls";

export const DICTATION_MANIFEST = manifestJson as ModuleManifest;

/** Appelle une commande du module (erreur si le module est coupé). */
export function dictationCall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return Bridge.moduleInvoke<T>("dictation", command, args);
}

/** Les réglages du module, complétés par les valeurs par défaut. */
export function dictationValues(): Record<string, unknown> {
  return settingsStore.moduleValues(DICTATION_MANIFEST);
}

/** Enregistre un réglage du module. */
export function saveDictationValue(key: string, value: unknown) {
  void settingsStore
    .update((d) => {
      const entry = (d.modules.dictation ??= { enabled: settingsStore.moduleEnabled("dictation"), values: {} });
      entry.values[key] = value;
    })
    .catch(() => {});
}

/** L'interrupteur du module (coupé par défaut). */
export function dictationToggle(onChange?: (on: boolean) => void): HTMLElement {
  return toggle(
    settingsStore.moduleEnabled("dictation"),
    (v) => {
      void settingsStore
        .update((d) => {
          d.modules.dictation = { enabled: v, values: d.modules.dictation?.values ?? {} };
        })
        .then(() => onChange?.(v))
        .catch(() => {});
    },
    "Activer la dictée",
  );
}

/** Va sur une autre page des Réglages (la fenêtre suit « settings.goto »). */
export function goToPage(id: string) {
  try {
    localStorage.setItem("settings.goto", id);
    window.dispatchEvent(new StorageEvent("storage", { key: "settings.goto", newValue: id }));
  } catch {
    // Stockage indisponible : on reste sur la page.
  }
}

/** Écoute un sujet du bus ; renvoie de quoi arrêter. */
export function onBusTopic(topic: string, handler: (payload: unknown) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  void onTauriEvent<BusMessage>("bus", (msg) => {
    if (msg.topic === topic) handler(msg.payload);
  }).then((s) => {
    if (stopped) s();
    else stop = s;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Un message d'erreur sous un bloc. */
export function errorLine(e: unknown): HTMLElement {
  return el("p", { class: "dict-error", role: "alert" }, errorText(e));
}
