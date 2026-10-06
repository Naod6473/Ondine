// Le seul fichier du front qui parle à Tauri. Toutes les commandes Rust passent ici.
//
// Hors de Tauri (page ouverte dans un navigateur avec `npm run dev`), chaque appel
// ne fait rien et renvoie null : on peut travailler l'apparence de l'île sans
// lancer l'appli complète.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings } from "./types";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Étiquette de la fenêtre courante : "island" ou "settings". */
export function windowLabel(fallback: string): string {
  return IS_TAURI ? getCurrentWindow().label : fallback;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[island] ${cmd} a échoué`, err);
    return null;
  }
}

/** Comme `call`, mais renvoie l'erreur à l'appelant (pour l'afficher). */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("disponible seulement dans l'appli");
  return invoke<T>(cmd, args);
}

export interface ScreenInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface BootInfo {
  settings: Settings;
  screen: ScreenInfo;
  version: string;
  rustModules: { id: string; crashed: boolean }[];
  /** L'appli tourne en administrateur (glisser-déposer bloqué par Windows). */
  elevated: boolean;
  /** Windows 11 : la fenêtre de réglages a le fond Mica (la page laisse son fond transparent). */
  mica?: boolean;
}

export interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  // Réglages
  settingsSave: (settings: Settings) => callOrThrow<void>("settings_save", { settings }),
  settingsExport: () => callOrThrow<string>("settings_export"),
  settingsImport: (text: string) => callOrThrow<void>("settings_import", { text }),
  privacyCheckFolder: (path: string) => callOrThrow<string>("privacy_check_folder", { path }),
  /** Boîte « Choisir un dossier » de Windows. null si on annule (ou hors de l'appli). */
  pickFolder: (title?: string) => call<string | null>("dialog_pick_folder", { title: title ?? null }),
  /** Boîte « Ouvrir » de Windows, filtrée par extensions (ex. ["ics"]). */
  pickFile: (title: string, extensions: string[]) => call<string | null>("dialog_pick_file", { title, extensions }),
  openSettingsWindow: () => call<void>("settings_open_window"),
  /** Cache la fenêtre qui appelle (fenêtre d'annotation). */
  windowHide: () => call<void>("window_hide"),

  // Fenêtre de l'île
  islandSetCollapsed: (collapsed: boolean) => call<void>("island_set_collapsed", { collapsed }),
  islandSetRect: (x: number, y: number, width: number, height: number) =>
    call<void>("island_set_rect", { x, y, width, height }),
  islandSetFocus: (focused: boolean) => call<void>("island_set_focus", { focused }),
  islandReposition: () => call<void>("island_reposition"),
  /** On attrape l'île : la fenêtre suit la souris jusqu'au lâcher, puis s'aimante à un bord. */
  islandDragStart: () => call<void>("island_drag_start"),
  /** Depuis quand personne n'a touché le PC, et si une présentation / un plein écran est en cours. */
  uiLanguage: () => call<string>("ui_language"),
  deskState: () => call<{ idleMs: number; busy: boolean }>("desk_state"),

  // Journal
  log: (level: string, source: string, message: string) => call<void>("log_write", { level, source, message }),
  openLogsFolder: () => call<void>("logs_open_folder"),

  // Identifiants : on peut demander si une clé existe, jamais la lire.
  credentialExists: (key: string) => call<boolean>("credential_exists", { key }),
  credentialSet: (key: string, value: string) => callOrThrow<void>("credential_set", { key, value }),
  credentialDelete: (key: string) => callOrThrow<void>("credential_delete", { key }),

  // Bus, modules, annulation
  busPublish: (topic: string, payload: unknown, source: string) =>
    call<void>("bus_publish", { topic, payload: payload ?? null, source }),
  moduleInvoke: <T>(module: string, command: string, args: unknown) =>
    callOrThrow<T>("module_invoke", { module, command, args: args ?? null }),
  undoRun: (id: number) => callOrThrow<string>("undo_run", { id }),

  // Mises à jour (voir src-tauri/src/update.rs). null = déjà à jour.
  updateCheck: () => callOrThrow<UpdateInfo | null>("update_check"),
  /** Télécharge et installe : Ondine se ferme puis se relance toute seule. */
  updateInstall: () => callOrThrow<void>("update_install"),

  quit: () => call<void>("app_quit"),

  /** Active un profil ("" = aucun) : le Rust range les réglages et pose ceux du profil. */
  profileActivate: (id: string) => callOrThrow<void>("profile_activate", { id }),
  /** Le nom du Wi-Fi connecté (pour la règle d'un profil), ou null. */
  wifiName: () => call<string | null>("profile_wifi_name"),
  // Diagnostic (src-tauri/src/diagnostics.rs)
  /** Ouvre dans le navigateur une issue GitHub préremplie (rien n'est envoyé sans la personne). */
  bugReportOpen: () => callOrThrow<void>("bug_report_open"),
  /** Mémoire et processeur d'Ondine (+ WebView2). null si la fenêtre n'est pas visible. */
  selfUsage: () => call<SelfUsage | null>("self_usage"),
};

export interface SelfUsage {
  memoryBytes: number;
  /** Part de tout le processeur (0-100) ; null à la première mesure. */
  cpuPercent: number | null;
  processes: number;
}

/** Écoute un événement Tauri envoyé par le Rust. Sans effet hors de Tauri. */
export async function onTauriEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

/**
 * Glisser-déposer de fichiers. ATTENTION (à vérifier sur ta machine) : la
 * position fournie par Tauri est en pixels PHYSIQUES ; on la divise par
 * devicePixelRatio pour retrouver les pixels CSS.
 */
export interface DragDropEvent {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  position?: { x: number; y: number };
}

export async function onDragDrop(handler: (e: DragDropEvent) => void): Promise<() => void> {
  if (!IS_TAURI) return () => {};
  // Sous Windows, c'est la cible de dépôt de l'île (src-tauri/src/platform/drop_target.rs)
  // qui envoie "file-drag". On écoute aussi celle de Tauri, au cas où elle marche.
  const offOwn = await listen<DragDropEvent>("file-drag", (e) => handler(e.payload));
  const offTauri = await getCurrentWebview().onDragDropEvent((event) => handler(event.payload as DragDropEvent));
  return () => {
    offOwn();
    offTauri();
  };
}
