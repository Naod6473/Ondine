// L'assistant de premier lancement et les propositions d'onglets, sans DOM :
// les cartes « Ce que vous faites sur ce PC », ce qu'elles allument, les
// logiciels qui les pré-cochent, les profils qu'elles créent, et les règles
// des propositions (masquer un onglet oublié, le bon onglet au bon moment).
// Testé par tests/front/setup.test.ts. Le reste : setup.ts (l'assistant),
// suggestions.ts (les propositions), island/setup-panel.ts (le dessin).

/** Une carte de l'étape « Ce que vous faites sur ce PC ». */
export interface SetupCard {
  id: string;
  icon: string;
  label: string;
  /** Une ligne sous le titre : ce que la carte apporte. */
  desc: string;
  /** Les onglets (ids de modules) qu'elle allume, dans l'ordre de l'île. */
  modules: string[];
  /** Le profil créé quand on coche plusieurs cartes (Réglages → Profils). */
  profile?: string;
}

/**
 * Les cartes, d'après les vrais modules (src/modules/*). Les modules sans
 * onglet (Animations de l'île, Ondine et les fenêtres, Bilan, Pauses, Météo)
 * ne sont pas touchés ; Équipe reste éteint (il ouvre un port sur le réseau
 * local : on l'allume soi-même).
 */
export const SETUP_CARDS: readonly SetupCard[] = [
  { id: "office", icon: "💼", label: "Bureautique", desc: "Fichiers, copies, captures, rendez-vous", modules: ["shelf", "clipboard", "capture", "agenda", "notes", "timer", "launcher"], profile: "Travail" },
  { id: "dev", icon: "🤖", label: "Développement et agents IA", desc: "Agents IA, terminal, automatisations", modules: ["agents", "terminal", "clipboard", "launcher", "rules", "system"], profile: "Développement" },
  { id: "it", icon: "🛠️", label: "IT et support", desc: "Système, accès distants, réseau", modules: ["system", "remote", "nettools", "terminal", "capture", "clipboard"], profile: "Support" },
  { id: "meetings", icon: "🎥", label: "Réunions et visio", desc: "Micro coupé en un clic, agenda, minuteur", modules: ["controls", "agenda", "notes", "timer"], profile: "Réunions" },
  { id: "music", icon: "🎵", label: "Musique et création", desc: "Ce qui joue, le son, les captures", modules: ["media", "controls", "capture", "shelf"], profile: "Maison" },
  { id: "study", icon: "🎓", label: "Études", desc: "Notes, Pomodoro, agenda", modules: ["notes", "timer", "agenda", "capture", "shelf"], profile: "Études" },
];

/** Toujours là, en premier : Parler à Ondine. */
export const BASE_TABS: readonly string[] = ["askclaude"];
/** Jamais allumés ni éteints par les cartes : Équipe (un port ouvert sur le réseau local, on l'allume soi-même). */
export const NEVER_TOUCHED: readonly string[] = ["team"];
/** Aucune carte cochée : une île vraiment minimale, qui s'enrichit ensuite. */
export const MINIMAL_TABS: readonly string[] = ["askclaude", "shelf", "notes"];

/** Les logiciels trouvés sur le PC (src-tauri/src/services/apps.rs) → la carte qu'ils pré-cochent. */
export const APP_CARDS: Record<string, string> = {
  vscode: "dev",
  visualstudio: "dev",
  jetbrains: "dev",
  cursor: "dev",
  claude: "dev",
  git: "dev",
  docker: "dev",
  office: "office",
  pdf: "office",
  teams: "meetings",
  zoom: "meetings",
  webex: "meetings",
  slack: "meetings",
  spotify: "music",
  deezer: "music",
  vlc: "music",
  daw: "music",
  video: "music",
  graphics: "music",
  putty: "it",
  winscp: "it",
  remote: "it",
  wireshark: "it",
  sysinternals: "it",
  study: "study",
  onenote: "study",
};

/** Les cartes à pré-cocher d'après les logiciels trouvés (ordre des cartes). */
export function cardsFromApps(apps: readonly string[]): string[] {
  const wanted = new Set(apps.map((a) => APP_CARDS[a]).filter(Boolean));
  return SETUP_CARDS.filter((c) => wanted.has(c.id)).map((c) => c.id);
}

/** Les onglets voulus pour ces cartes (dans l'ordre où on les a cochées), parmi `tabIds`. */
export function tabsForCards(cards: readonly string[], tabIds: readonly string[]): string[] {
  const known = new Set(tabIds);
  const chosen = cards.map((id) => SETUP_CARDS.find((c) => c.id === id)).filter((c): c is SetupCard => !!c);
  const wanted = chosen.length ? [...BASE_TABS, ...chosen.flatMap((c) => c.modules)] : [...MINIMAL_TABS];
  return [...new Set(wanted)].filter((id) => known.has(id));
}

/** Ce que l'assistant écrit dans les réglages pour ces cartes. */
export interface TabPlan {
  /** Chaque onglet connu (sauf NEVER_TOUCHED) → allumé ou non. */
  modules: Record<string, boolean>;
  /** L'ordre complet (island.tabOrder) : les onglets voulus d'abord, puis les autres à leur place d'origine. */
  order: string[];
}

export function planFromCards(cards: readonly string[], tabIds: readonly string[]): TabPlan {
  const on = tabsForCards(cards, tabIds);
  const set = new Set(on);
  return {
    modules: Object.fromEntries(tabIds.filter((id) => !NEVER_TOUCHED.includes(id)).map((id) => [id, set.has(id)])),
    order: [...on, ...tabIds.filter((id) => !set.has(id))],
  };
}

/** Un profil à créer (Réglages → Profils), sans règle : on le choisit à la main ou on lui en donne une. */
export interface CardProfile {
  name: string;
  modules: Record<string, boolean>;
  tabOrder: string[];
}

/**
 * Plusieurs cartes cochées : un profil par carte (« Bureautique » → Travail,
 * avec ses onglets), sauf un profil du même nom qui existe déjà. Une seule
 * carte : rien (le profil serait l'île elle-même).
 */
export function profilesFromCards(cards: readonly string[], tabIds: readonly string[], existing: readonly string[]): CardProfile[] {
  if (cards.length < 2) return [];
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  const out: CardProfile[] = [];
  for (const id of cards) {
    const card = SETUP_CARDS.find((c) => c.id === id);
    if (!card?.profile || taken.has(card.profile.toLowerCase())) continue;
    taken.add(card.profile.toLowerCase());
    const plan = planFromCards([id], tabIds);
    out.push({ name: card.profile, modules: plan.modules, tabOrder: plan.order });
  }
  return out;
}

/** Un prénom propre : sans caractère de contrôle, 40 caractères au plus (comme le Rust). */
export function cleanFirstName(raw: string): string {
  return [...raw.replace(/\p{Cc}/gu, "")].slice(0, 40).join("").trim();
}

/** « Bonjour Simon ! », ou « Bonjour ! » sans prénom. */
export function helloText(name: string | undefined): string {
  const n = cleanFirstName(name ?? "");
  return n ? `Bonjour ${n} !` : "Bonjour !";
}

// ── Les propositions (suggestions.ts) ────────────────────────────────────────

/** Un onglet jamais ouvert depuis ce nombre de jours : Ondine propose de le masquer. */
export const HIDE_AFTER_DAYS = 21;

/** Le numéro du jour local (jours depuis le 1er janvier 1970, à l'heure du PC). */
export function dayNumber(ms: number): number {
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);
}

export interface UsagePrefs {
  suggestions?: boolean;
  suggested?: string[];
  tabSeenAt?: Record<string, number>;
  usageSince?: number;
}

/**
 * Le prochain onglet à proposer de masquer, ou null : allumé, pas ouvert
 * depuis HIDE_AFTER_DAYS jours (ou depuis le début du compte s'il ne l'a
 * jamais été), jamais proposé. Jamais s'il reste 3 onglets ou moins.
 */
export function staleTab(shown: readonly string[], prefs: UsagePrefs, today: number): string | null {
  const since = prefs.usageSince ?? 0;
  if (prefs.suggestions === false || since <= 0 || shown.length <= 3) return null;
  const done = new Set(prefs.suggested ?? []);
  for (const id of shown) {
    const last = Math.max(prefs.tabSeenAt?.[id] ?? 0, since);
    if (today - last >= HIDE_AFTER_DAYS && !done.has(`hide-${id}`)) return id;
  }
  return null;
}

/** Les bons moments, et l'onglet qu'ils proposent. */
export const HINTS: Record<string, { module: string; title: string; body: string; icon: string }> = {
  usb: { module: "controls", icon: "🔌", title: "Une clé USB ! Voulez-vous l'onglet Contrôles ?", body: "Il l'éjecte en un clic, et règle le son, le micro et l'écran." },
  visio: { module: "controls", icon: "🎥", title: "Une visio ? L'onglet Contrôles coupe le micro en un clic.", body: "Il montre aussi quelle appli utilise le micro ou la caméra." },
  drop: { module: "shelf", icon: "🧺", title: "Voulez-vous l'Étagère ?", body: "Les fichiers glissés sur l'île y restent sous la main." },
};

/** Faut-il proposer ce bon moment ? Une seule fois par cas, propositions permises, onglet éteint. */
export function hintWanted(kind: string, prefs: UsagePrefs, moduleOn: boolean, welcomed: boolean): boolean {
  return !!HINTS[kind] && welcomed && prefs.suggestions !== false && !moduleOn && !(prefs.suggested ?? []).includes(kind);
}

/** La liste des propositions faites, avec `kind` en plus (64 au plus, comme le Rust). */
export function withSuggested(list: readonly string[], kind: string): string[] {
  return list.includes(kind) ? [...list] : [...list, kind].slice(-64);
}
