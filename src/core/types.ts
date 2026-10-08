// Les réglages, tels que le Rust les enregistre (src-tauri/src/services/settings.rs).
// Si tu modifies l'un, modifie l'autre.

/** Mode de performance (src-tauri/src/services/perf.rs). */
export type PerfMode = "high" | "balanced" | "eco";

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
    /** Lancer Ondine à l'ouverture de session Windows. */
    autostart?: boolean;
    /** Rythme des boucles : haute, équilibrée, économie d'énergie (src/core/perf.ts). */
    perfMode?: PerfMode;
    /** Sur batterie (PC débranché) : économie d'énergie, quel que soit `perfMode`. */
    ecoOnBattery?: boolean;
    /** En français : vouvoyer ("vous") ou tutoyer ("tu") l'utilisateur (src/core/i18n.ts). */
    address?: "vous" | "tu";
    /** La dernière version lancée : « Quoi de neuf » une fois après une mise à jour (src/core/whats-new.ts). */
    lastSeenVersion?: string;
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
    /** L'île en gelée (src/island/spring.ts) : "soft" (doux, presque sans rebond),
        "normal", "jelly" (gelée : rebonds et déformations plus francs). */
    elasticity: "soft" | "normal" | "jelly";
    /** Une bulle d'Ondine explique chaque onglet la première fois (src/island/tips.ts). */
    tips: boolean;
    /** Les onglets (ids de modules) dont l'astuce a déjà été vue. */
    tipsSeen: string[];
  };
  mascot: {
    enabled: boolean;
    id: string;
    boredAfterSecs: number;
    sleepAfterSecs: number;
    /** Ondine vient pendre au bord de l'écran quand on ne fait rien. */
    peek: boolean;
    peekEveryMins: number;
    /** Les surprises cachées (src/eggs/) : toutes, le calendrier seulement, aucune. */
    surprises: "all" | "seasonal" | "none";
    /** Le carnet des trésors : les ids des surprises déjà trouvées. */
    treasures: string[];
    /** Famille gomme : la couleur ("auto" = celle de la forme, sinon une teinte de gum-draw.ts). */
    color: string;
    /** Famille gomme : les mains toujours, seulement pour les gestes, ou jamais. */
    hands: "always" | "gestures" | "never";
    /** Famille gomme : les accessoires (sur la tête, sur les yeux, au cou ; "none" = aucun). */
    wearHead: string;
    wearEyes: string;
    wearNeck: string;
  };
  privacy: {
    excludedFolders: string[];
  };
  modules: Record<string, { enabled: boolean; values: Record<string, unknown> }>;
  /** Les profils (« Travail », « Maison »…), voir src-tauri/src/services/profiles.rs. */
  profiles?: Profiles;
}

/** Ce qu'un profil peut remplacer ; un champ absent = pas remplacé. */
export interface ProfileValues {
  tabOrder?: string[];
  /** Les onglets affichés : id de module → activé. */
  modules?: Record<string, boolean>;
  theme?: string;
  color?: string;
  alwaysMini?: boolean;
}

export interface ProfileRule {
  /** "none" (à la main seulement), "hours" (plage horaire) ou "wifi". */
  kind: "none" | "hours" | "wifi";
  /** 1 = lundi … 7 = dimanche. */
  days: number[];
  /** "HH:MM" ; une fin avant le début = la plage passe minuit. */
  start: string;
  end: string;
  ssid: string;
}

export interface Profile {
  id: string;
  name: string;
  values: ProfileValues;
  rule: ProfileRule;
}

export interface Profiles {
  list: Profile[];
  /** L'id du profil actif, "" = aucun. */
  active: string;
  /** Changer de profil tout seul selon les règles. */
  auto: boolean;
  /** Les réglages hors profil, gardés par le Rust pendant qu'un profil est actif. */
  base: ProfileValues;
}

/** Valeurs par défaut, identiques à celles du Rust (pour `npm run dev` dans un navigateur). */
export function defaultSettings(): Settings {
  return {
    version: 2,
    general: { screen: "primary", logLevel: "info", language: "auto", welcomed: false, demo: false, autoUpdate: true, autostart: true, perfMode: "balanced", ecoOnBattery: true, address: "vous", lastSeenVersion: "" },
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
      alwaysMini: true,
      motion: "classic",
      elasticity: "normal",
      tips: true,
      tipsSeen: [],
    },
    mascot: { enabled: true, id: "goutte-gomme", boredAfterSecs: 60, sleepAfterSecs: 180, peek: true, peekEveryMins: 5, surprises: "all", treasures: [], color: "auto", hands: "always", wearHead: "none", wearEyes: "none", wearNeck: "none" },
    privacy: { excludedFolders: [] },
    modules: {},
    profiles: { list: [], active: "", auto: false, base: {} },
  };
}
