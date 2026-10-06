// Les réglages, tels que le Rust les enregistre (src-tauri/src/services/settings.rs).
// Si tu modifies l'un, modifie l'autre.

export interface Settings {
  version: number;
  general: {
    /** "primary" = écran principal, "cursor" = l'écran où se trouve la souris. */
    screen: "primary" | "cursor";
    logLevel: "error" | "warn" | "info" | "debug";
    /** Langue de l'interface : "auto" (installateur, sinon Windows), "fr" ou "en". */
    language: "auto" | "fr" | "en";
    /** Vrai une fois le mot de bienvenue montré (premier démarrage). */
    welcomed: boolean;
    /** Mode démo : de fausses données pour les captures (src/core/demo.ts). */
    demo?: boolean;
    /** Chercher une nouvelle version au démarrage (puis chaque jour) et la proposer. */
    autoUpdate?: boolean;
  };
  island: {
    /** Replier l'île quand la souris n'est plus dessus depuis ce nombre de secondes. */
    collapseSecs: number;
    notificationSecs: number;
    /** L'ordre des onglets (ids de modules) ; vide = l'ordre d'origine. */
    tabOrder: string[];
    /** Le bord de l'écran où vit l'île. */
    edge: "top" | "left" | "right";
    /** Sa place le long du bord : coin de début, centre (à `offset`), coin de fin. */
    align: "start" | "center" | "end";
    /** Pour "center" : position du centre de l'île le long du bord (0 à 1). */
    offset: number;
    /** Thème de couleurs (src/island/themes.ts) ; "custom" = `color`. */
    theme: string;
    color: string;
    sounds: boolean;
    soundVolume: number;
    /** Raccourci clavier global qui ouvre l'île ("" = aucun). */
    hotkey: string;
    /** Partage d'écran, plein écran : l'île se cache et garde les notifications pour après. */
    presentationQuiet: boolean;
    /** Pack d'icônes : "color" (dessinées en couleur) ou "line" (au trait, sobres). */
    iconPack: "color" | "line";
    /** L'île reste en mini au lieu de disparaître. */
    alwaysMini: boolean;
    /** Style des animations : "classic" (sobre) ou "studio" (flou → net, chiffres qui roulent, gélatine). */
    motion: "classic" | "studio";
  };
  mascot: {
    enabled: boolean;
    id: string;
    boredAfterSecs: number;
    sleepAfterSecs: number;
    /** Ondine vient pendre au bord de l'écran quand on ne fait rien. */
    peek: boolean;
    peekEveryMins: number;
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
    general: { screen: "primary", logLevel: "info", language: "auto", welcomed: false, demo: false, autoUpdate: true },
    island: {
      collapseSecs: 1.5,
      notificationSecs: 6,
      tabOrder: [],
      edge: "top",
      align: "center",
      offset: 0.5,
      theme: "nuit",
      color: "#0c0d12",
      sounds: true,
      soundVolume: 0.5,
      hotkey: "Ctrl+Alt+O",
      presentationQuiet: true,
      iconPack: "color",
      alwaysMini: false,
      motion: "classic",
    },
    mascot: { enabled: true, id: "goutte", boredAfterSecs: 60, sleepAfterSecs: 180, peek: true, peekEveryMins: 5 },
    privacy: { excludedFolders: [] },
    modules: {},
  };
}
