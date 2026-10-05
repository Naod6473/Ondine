// Les réglages, tels que le Rust les enregistre (src-tauri/src/services/settings.rs).
// Si tu modifies l'un, modifie l'autre.

export interface Settings {
  version: number;
  general: {
    /** "primary" = écran principal, "cursor" = l'écran où se trouve la souris. */
    screen: "primary" | "cursor";
    logLevel: "error" | "warn" | "info" | "debug";
  };
  island: {
    /** Replier l'île quand la souris n'est plus dessus depuis ce nombre de secondes. */
    collapseSecs: number;
    notificationSecs: number;
  };
  mascot: {
    enabled: boolean;
    id: string;
    boredAfterSecs: number;
    sleepAfterSecs: number;
  };
  privacy: {
    excludedFolders: string[];
  };
  modules: Record<string, { enabled: boolean; values: Record<string, unknown> }>;
}

/** Valeurs par défaut, identiques à celles du Rust (pour `npm run dev` dans un navigateur). */
export function defaultSettings(): Settings {
  return {
    version: 2,
    general: { screen: "primary", logLevel: "info" },
    island: { collapseSecs: 1.5, notificationSecs: 6 },
    mascot: { enabled: true, id: "goutte", boredAfterSecs: 60, sleepAfterSecs: 180 },
    privacy: { excludedFolders: [] },
    modules: {},
  };
}
