// Le rangement des Réglages (1.2.2) : quelles pages, dans quel groupe, et où
// vont les réglages qui ont changé de page. Données pures, sans DOM, pour être
// testées dans tests/front (settings-layout.test.ts) ; main.ts les dessine.
//
// Règle d'or : seules les PAGES bougent. Chaque réglage garde sa clé dans son
// module (`modules.<id>.values.<clé>`) : rien n'est renommé ni remis à zéro.
// Une page peut afficher les champs de plusieurs modules (Animations et halos :
// le module Animations de l'île et les halos de batterie du module Système).

/** Les cinq groupes de la barre latérale, dans l'ordre. */
export const NAV_GROUPS = ["Ondine", "L'île", "Automatiser", "Modules", "Sécurité et système"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/**
 * Les catégories de modules dans la barre (texte seul, repliables). Un module
 * qui n'est dans aucune va dans « Autres modules ». Dans une catégorie, les
 * modules gardent l'ordre des onglets.
 */
export const MODULE_CATEGORIES: { id: string; label: string; modules: string[] }[] = [
  { id: "ai", label: "IA", modules: ["agents"] },
  { id: "files", label: "Fichiers", modules: ["shelf", "clipboard", "capture", "launcher"] },
  { id: "organize", label: "Organisation", modules: ["timer", "notes", "agenda", "pauses", "weekly"] },
  { id: "it", label: "Outils IT", modules: ["terminal", "system", "remote", "nettools", "team"] },
  { id: "daily", label: "Le PC au quotidien", modules: ["media", "controls", "weather"] },
  { id: "other", label: "Autres modules", modules: [] },
];

/**
 * Les modules qui n'ont plus de page à eux dans « Modules » : leur page vit
 * ailleurs (leurs réglages et leur interrupteur « Activé » y sont).
 *   - rules : la page Règles (Automatiser) ;
 *   - askclaude : « Parler à Ondine », dans le groupe Ondine (même id de page) ;
 *   - halos : la page Animations et halos (L'île) ;
 *   - windowlife : une section de la page Comportement (L'île).
 */
export const MODULES_ELSEWHERE = ["rules", "askclaude", "halos", "windowlife"];

/** Une partie d'un sous-menu : un bloc de champs d'un module. */
export interface FieldBlock {
  /** Titre du bloc (null : pas de titre). */
  title: string | null;
  module: string;
  keys: string[];
}

/** Un sous-menu de la page Animations et halos. */
export interface AnimationSub {
  id: string;
  label: string;
  blocks: FieldBlock[];
}

/**
 * La page « Animations et halos » : le module Animations de l'île (halos,
 * liquide, liseré des minuteurs, « Où dessiner le halo ») et les halos de
 * batterie du module Système. Chaque sous-menu commence par un interrupteur
 * « Tout » (dans Style : le module lui-même). Un champ de « halos » absent
 * d'ici (ajouté plus tard) tombe dans Style ; le test vérifie qu'il n'y en a pas.
 */
export const ANIMATION_SUBS: AnimationSub[] = [
  { id: "style", label: "Style", blocks: [{ title: "Le halo", module: "halos", keys: ["intensity", "colors", "place"] }] },
  {
    id: "pc",
    label: "Le PC",
    blocks: [
      { title: "Moments", module: "halos", keys: ["wake", "usb", "download", "disk", "wifi", "network", "cpu", "capture", "shelfDrop"] },
      { title: "Batterie", module: "system", keys: ["chargeHalo", "haloPlug", "haloUnplug", "haloFull", "haloLow", "haloCritical"] },
    ],
  },
  { id: "agents", label: "Ondine et les agents", blocks: [{ title: "Moments", module: "halos", keys: ["think", "agents", "update", "streak"] }] },
  { id: "keys", label: "Son et clavier", blocks: [{ title: "Moments", module: "halos", keys: ["music", "voice", "dance", "volumeKeys", "capsLock", "numLock", "clipboard", "clipText"] }] },
  { id: "day", label: "Ma journée", blocks: [{ title: "Moments", module: "halos", keys: ["morning", "leaveTime", "meeting", "weather", "sky", "focus", "timerRing"] }] },
  // Le liquide à l'intérieur de l'île (src/island/liquid.ts, modules/halos/liquid-moments.ts).
  {
    id: "inside",
    label: "Le liquide",
    blocks: [
      { title: "Le liquide", module: "halos", keys: ["liquid", "liquidMatter", "liquidColor", "liquidCustom", "liquidOpacity"] },
      {
        title: "Moments",
        module: "halos",
        keys: ["liquidTimer", "liquidTimerStyle", "liquidFiles", "liquidBattery", "liquidDisk", "liquidAgents", "liquidMusic", "liquidVoice", "liquidRain", "liquidCpu", "liquidNight", "liquidNotify", "liquidFocus", "liquidOndine"],
      },
    ],
  },
];

/** La clé (`data-key`) de l'interrupteur « Tout » d'un sous-menu. */
export function allKey(sub: string): string {
  return `tout:${sub}`;
}

/**
 * Des champs de module montrés sur une autre page que celle du module : la
 * page du module ne les affiche plus et met à leur place un lien.
 */
export const MOVED_FIELDS: Record<string, { keys: string[]; label: string; page: string; sub: string }> = {
  system: { keys: ["chargeHalo", "haloPlug", "haloUnplug", "haloFull", "haloLow", "haloCritical"], label: "Halos de batterie", page: "animations", sub: "pc" },
};

/** Un endroit des Réglages : une page, et peut-être un de ses sous-menus. */
export interface Place {
  page: string;
  sub?: string;
}

/**
 * Les anciennes pages et sous-menus (avant 1.2.2) → leur nouvelle place.
 * Sert à la page retenue d'une ouverture à l'autre, aux liens profonds
 * (`go("module:halos")`…) et aux anciens noms dans la recherche.
 */
const MOVED_PAGES: Record<string, Place> = {
  "module:halos": { page: "animations" },
  "module:windowlife": { page: "behavior", sub: "windows" },
};
const MOVED_SUBS: Record<string, Record<string, Place>> = {
  general: {
    start: { page: "general" },
    island: { page: "behavior", sub: "island" },
    updates: { page: "updates" },
    perf: { page: "perf" },
    about: { page: "about" },
  },
  "module:halos": {
    general: { page: "animations", sub: "style" },
    inside: { page: "animations", sub: "inside" },
    pc: { page: "animations", sub: "pc" },
    ondine: { page: "animations", sub: "agents" },
    keys: { page: "animations", sub: "keys" },
    day: { page: "animations", sub: "day" },
  },
};

/**
 * La place actuelle d'une page (et d'un sous-menu) donnés par leur ancien
 * nom. Une place qui n'a pas bougé est rendue telle quelle.
 */
export function resolvePlace(page: string, sub?: string): Place {
  const bySub = sub ? MOVED_SUBS[page]?.[sub] : undefined;
  if (bySub) return bySub;
  const moved = MOVED_PAGES[page];
  if (moved) {
    const to = moved.sub ?? sub;
    return to ? { page: moved.page, sub: to } : { page: moved.page };
  }
  return sub ? { page, sub } : { page };
}

/**
 * Les anciens noms des pages et sous-menus, pour la recherche : on tape
 * « Animations de l'île » ou « Événements du PC », on arrive au bon endroit.
 */
export const FORMER_NAMES: Record<string, { name: string; sub?: string }[]> = {
  animations: [
    { name: "Animations de l'île" },
    { name: "Halos" },
    { name: "Halos de batterie", sub: "pc" },
    { name: "Liseré des minuteurs", sub: "day" },
    { name: "À l'intérieur de l'île", sub: "inside" },
    { name: "Événements du PC", sub: "pc" },
    { name: "Ondine et agents", sub: "agents" },
    { name: "Clavier et presse-papiers", sub: "keys" },
    { name: "Moments de la journée", sub: "day" },
  ],
  behavior: [{ name: "Ondine et les fenêtres", sub: "windows" }, { name: "Comportement de l'île", sub: "island" }],
  general: [{ name: "Langue et démarrage" }],
};
