// Ce qu'est un module, côté front.
//
// Un module = un dossier src/modules/<id>/ avec :
//   - manifest.json : la carte d'identité (lue aussi par le Rust) ;
//   - index.ts      : exporte un `IslandModule` (setup + vues).
// Voir docs/ARCHITECTURE.md, « Ajouter un module ».

import type { BusHandler } from "./bus";
import type { Logger } from "./log";
import type { NotificationRequest } from "./notifications";

/** Ce qu'un module peut demander. Le Rust refuse toute autre valeur. */
export type Permission = "files" | "clipboard" | "network" | "claude-api" | "credentials";

export type ViewKind = "compact" | "expanded" | "drop";

/** Un champ de réglage : l'écran de réglages est généré à partir de cette liste. */
export type SettingField =
  | { key: string; type: "string"; label: string; help?: string; default: string; maxLength?: number }
  | { key: string; type: "number"; label: string; help?: string; default: number; min?: number; max?: number; step?: number }
  | { key: string; type: "boolean"; label: string; help?: string; default: boolean }
  | { key: string; type: "select"; label: string; help?: string; default: string; options: { value: string; label: string }[] }
  /** Une liste de dossiers, choisis avec la boîte « Choisir un dossier » de Windows. */
  | { key: string; type: "folders"; label: string; help?: string; default: string[]; max?: number }
  /** Une liste de fichiers, choisis avec la boîte « Ouvrir » de Windows (filtrée par extension). */
  | { key: string; type: "files"; label: string; help?: string; default: string[]; max?: number; extensions: string[] }
  /**
   * Une liste de calendriers (module Agenda) : fichiers .ics ou liens iCal,
   * chacun avec un nom et une couleur. L'adresse d'un lien n'est PAS dans les
   * réglages : elle va dans le Gestionnaire d'identifiants (« agenda-ical-url-<id> »).
   */
  | { key: string; type: "calendars"; label: string; help?: string; default: CalendarEntry[]; max?: number };

/** Un calendrier du module Agenda, tel que rangé dans les réglages. */
export interface CalendarEntry {
  /** 1 à 16 lettres minuscules ou chiffres (sert aussi à nommer la clé de son lien). */
  id: string;
  name: string;
  /** « #4fb8ff » */
  color: string;
  kind: "file" | "link";
  /** Le chemin du .ics (seulement pour kind = "file"). */
  path?: string;
}

export interface ModuleManifest {
  id: string;
  name: string;
  /** Un emoji pour l'instant (une image plus tard). */
  icon: string;
  description: string;
  version: string;
  permissions: Permission[];
  settings?: { version: number; fields: SettingField[] };
  views: ViewKind[];
  /** Commandes Rust que le module expose (appelées via api.invoke). */
  commands: string[];
  events: { emits: string[]; listens: string[] };
}

/** Ce que l'île donne à un module. Tout passe par ici : pas d'accès direct aux autres modules. */
export interface ModuleApi {
  readonly manifest: ModuleManifest;
  /** Publie sur le bus (le sujet doit être déclaré dans `events.emits`). */
  emit(topic: string, payload?: unknown): void;
  /** Écoute le bus (le sujet doit être couvert par `events.listens`). */
  on(pattern: string, handler: BusHandler): () => void;
  /** Appelle une commande Rust du module (déclarée dans `commands`). */
  invoke<T = unknown>(command: string, args?: unknown): Promise<T>;
  /** Réglages du module, valeurs par défaut comprises. */
  settings(): Record<string, unknown>;
  onSettingsChange(fn: (values: Record<string, unknown>) => void): () => void;
  /** Demande l'attention de l'île. C'est l'île qui décide quand et comment afficher. */
  notify(request: Omit<NotificationRequest, "moduleId">): number;
  /**
   * Entoure un gestionnaire d'événement (clic…) : si il lance une erreur, même
   * asynchrone, elle est attribuée à ce module au lieu de se perdre. À utiliser
   * pour tous les `onclick` des vues.
   */
  handler<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void;
  /**
   * Prévient l'île que `compactWhen` a peut-être changé de réponse (ex. : la
   * musique vient de démarrer). L'île change de vue compacte si besoin.
   */
  refreshCompact(): void;
  /**
   * Referme l'île (ex. : après avoir collé un texte dans l'appli d'avant).
   * Sans effet pendant une alerte ou un glisser-déposer.
   */
  closeIsland(): void;
  /**
   * Ouvre l'île en grand, sur l'onglet `tab` (id de module) s'il est donné et
   * actif. Sans effet pendant une alerte ou un glisser-déposer.
   */
  openIsland(tab?: string): void;
  log: Logger;
}

/** Monte une vue dans `el`. Peut renvoyer une fonction de nettoyage. */
export type ViewMount = (el: HTMLElement, api: ModuleApi) => void | (() => void);

/** Une cible de dépôt, affichée quand on glisse des fichiers sur l'île. */
export interface DropTarget {
  id: string;
  label: string;
  icon: string;
  onDrop(paths: string[], api: ModuleApi): void | Promise<void>;
}

export interface IslandModule {
  manifest: ModuleManifest;
  /** Appelé quand le module démarre (ou est réactivé). Peut renvoyer un nettoyage. */
  setup?(api: ModuleApi): void | (() => void);
  views?: {
    compact?: ViewMount;
    /**
     * Facultatif : la vue compacte n'est proposée que si cette fonction répond
     * true (ex. : Musique seulement quand quelque chose joue). L'île montre la
     * vue compacte du premier module, dans l'ordre de src/modules/index.ts, qui
     * en a une à montrer.
     */
    compactWhen?: (api: ModuleApi) => boolean;
    expanded?: ViewMount;
    /**
     * Les cibles de dépôt. Une liste fixe, ou une fonction appelée à chaque
     * glisser (pour des cibles qui dépendent des réglages, comme des favoris).
     */
    drop?: DropTarget[] | ((api: ModuleApi) => DropTarget[]);
  };
}
