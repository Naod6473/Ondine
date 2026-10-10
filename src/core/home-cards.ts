// Les cartes de l'Accueil (module `home`, src/modules/home/).
//
// L'Accueil ne connaît aucun module : ce sont les modules qui lui proposent
// une carte, par un ajout court dans leur `setup` :
//
//   api.homeCard({
//     title: "Minuteur", icon: "⏱️",
//     moments: { day: 80 },                       // plus haut en journée
//     view: () => running ? { value: "18:40", sub: "Pomodoro" } : null,
//   });
//
// `view()` est relue à chaque seconde pendant que l'Accueil est affiché ;
// elle renvoie null quand le module n'a rien à dire (pas de musique = pas de
// carte musique). Le registre des modules (module-registry.ts) range chaque
// carte ici, avec le module qui la propose : une erreur dans `view()` compte
// pour ce module (et ne fait pas tomber l'Accueil), la carte disparaît quand
// le module s'arrête. Un clic agrandit la carte jusqu'à la vue complète du
// module (sa vue `expanded`), sans changer d'onglet.
//
// Ce fichier ne touche pas à la page : il est partagé par le registre, les
// modules et l'Accueil. Les règles (ordre, moment, phrase) sont dans
// src/modules/home/home-rules.ts.

/** Le moment de la journée : il change l'ordre des cartes et la phrase d'Ondine. */
export type HomeMoment = "morning" | "day" | "evening";
/** Deux tailles, comme les widgets d'un téléphone : une case, ou deux. */
export type HomeCardSize = "small" | "large";

/** Un petit bouton sur une carte (lecture / pause…). */
export interface HomeCardAction {
  /** Un pictogramme (emoji) ou un texte très court. */
  icon: string;
  /** L'infobulle et le nom lu par le lecteur d'écran (infinitif : « Mettre en pause »). */
  label: string;
  run(): void | Promise<void>;
}

/** Ce que la carte montre en ce moment. Tout est facultatif sauf ce qu'on veut voir. */
export interface HomeCardView {
  /** Le grand chiffre ou texte court (« 18:40 », « 82 % », « 21° ») : il roule quand il change. */
  value?: string;
  /** La ligne sous le chiffre (« Pomodoro · travail », « Réunion d'équipe »). */
  sub?: string;
  /** Remplace le titre de la carte (« Demain » le soir pour l'agenda). */
  title?: string;
  /** Une barre de progression, de 0 à 1. */
  progress?: number | null;
  /** Une image (data URL), comme la pochette du morceau. */
  image?: string | null;
  /** La teinte de la carte, en [r, g, b] (la couleur de la pochette). */
  tint?: readonly [number, number, number] | null;
  /** Quelques lignes « libellé · valeur » (taille large surtout). */
  rows?: { label: string; value: string }[];
  /** Jusqu'à 3 petits boutons. */
  actions?: HomeCardAction[];
  /**
   * La carte importante du moment (un agent qui attend, une réunion qui
   * commence, la batterie faible) : mise en avant, et Ondine la regarde.
   */
  urgent?: boolean;
  /**
   * Un morceau de la phrase d'Ondine, en minuscules, sans point
   * (« pluie vers 16 h », « Claude a fini »). Chaque morceau est traduit à
   * part (i18n-en.json, « patterns »).
   */
  phrase?: string | null;
}

/** Une ligne de la carte « Reprendre » : la dernière chose touchée dans un module. */
export interface HomeResumeItem {
  icon: string;
  /** Le nom de la chose (fichier, note, projet) : jamais traduit. */
  label: string;
  /** D'où elle vient (« Étagère », « Note », « Claude Code »). */
  detail: string;
  /** Quand (ms depuis 1970) : les plus récentes d'abord. */
  at: number;
  open(): void | Promise<void>;
}

/** Ce qui est donné à l'Accueil pour dessiner une carte. */
export interface HomeCardContext {
  moment: HomeMoment;
  size: HomeCardSize;
}

/** Ce qu'un module propose (`api.homeCard`). */
export interface HomeCardSpec {
  /** Pour un module qui propose plusieurs cartes ; sinon l'id du module suffit. */
  id?: string;
  title: string;
  icon: string;
  /** La taille au départ (avant qu'on la change d'un clic droit). Par défaut : petite. */
  size?: HomeCardSize;
  /** L'importance selon le moment, de 0 à 100 (50 par défaut) : l'ordre automatique des cartes. */
  moments?: Partial<Record<HomeMoment, number>>;
  /** Ce que montre la carte, ou null : rien à dire, pas de carte. */
  view(ctx: HomeCardContext): HomeCardView | null;
  /**
   * Facultatif : de quoi se mettre à jour (une commande Rust). Appelée à
   * l'arrivée sur l'Accueil puis toutes les `refreshMs` (30 s par défaut)
   * tant qu'il est affiché : jamais en arrière-plan.
   */
  load?(): Promise<void>;
  refreshMs?: number;
  /** Faux : un clic ne l'agrandit pas (module sans onglet, comme la Météo). */
  expandable?: boolean;
  /** Facultatif : une ligne pour la carte « Reprendre ». */
  resume?(): HomeResumeItem | null;
}

/** De quoi prévenir l'Accueil qu'une carte a changé, ou la retirer. */
export interface HomeCardHandle {
  /** Relit la carte tout de suite (sinon : à la prochaine seconde). */
  refresh(): void;
  remove(): void;
}

/** Une carte rangée ici, avec le module qui la propose. */
export interface HomeCardEntry {
  /** « media », ou « agents.reprise » pour une seconde carte du même module. */
  key: string;
  moduleId: string;
  spec: HomeCardSpec;
  /** Monte la vue complète du module dans `el` (null : pas de vue complète). */
  expand: ((el: HTMLElement) => () => void) | null;
  /** Lance `fn` à l'abri : une erreur compte pour le module, et `fallback` est rendu. */
  guard<T>(what: string, fn: () => T, fallback: T): T;
}

type Listener = () => void;

/** Les cartes proposées par les modules en marche (une liste par fenêtre). */
class HomeCards {
  private entries = new Map<string, HomeCardEntry>();
  private listeners = new Set<Listener>();

  add(entry: HomeCardEntry): () => void {
    this.entries.set(entry.key, entry);
    this.changed();
    return () => {
      if (this.entries.get(entry.key) !== entry) return;
      this.entries.delete(entry.key);
      this.changed();
    };
  }

  list(): HomeCardEntry[] {
    return [...this.entries.values()];
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error("[accueil] abonné en erreur", err);
      }
    }
  }
}

export const homeCards = new HomeCards();

/** La clé d'une carte : l'id du module, suivi de l'id de la carte s'il y en a un. */
export function homeCardKey(moduleId: string, id?: string): string {
  return id && id !== moduleId ? `${moduleId}.${id}` : moduleId;
}

/**
 * L'île s'ouvre-t-elle sur l'Accueil ? (module allumé, réglage « Ouvrir l'île
 * sur l'Accueil »). Lu par island.ts à chaque ouverture, sauf quand on
 * demande un onglet précis (`api.openIsland(tab)`).
 */
export function homeOnOpen(s: { modules: Record<string, { enabled: boolean; values: Record<string, unknown> } | undefined> }, enabled: boolean): boolean {
  return enabled && s.modules.home?.values?.openOnHome !== false;
}
