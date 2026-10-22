// L'aide-mémoire des raccourcis (1.2.5) : les listes. Pas de DOM ici
// (testé dans tests/front/controls-blocks.test.ts).
//
// Les raccourcis sont ceux d'un clavier français (AZERTY) et des logiciels
// en français : dans Word ou Excel en français, Ctrl+G met en gras (pas
// Ctrl+B). Les touches s'écrivent comme sur le clavier : Ctrl, Maj, Alt,
// Win, Entrée, Suppr, Échap, ↑ ↓ ← →. Un « + » sépare les touches à
// presser ensemble.

export interface Shortcut {
  keys: string;
  what: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export interface AppSheet {
  /** Le nom affiché. */
  name: string;
  /** Les programmes (nom de l'exécutable sans .exe, en minuscules). */
  programs: string[];
  groups: ShortcutGroup[];
}

const s = (keys: string, what: string): Shortcut => ({ keys, what });

/** Partout où l'on écrit du texte : la liste de secours pour une appli inconnue. */
export const TEXT_SHEET: AppSheet = {
  name: "Toutes les applis",
  programs: [],
  groups: [
    {
      title: "Texte",
      items: [
        s("Ctrl+C", "Copier"),
        s("Ctrl+X", "Couper"),
        s("Ctrl+V", "Coller"),
        s("Ctrl+Z", "Annuler"),
        s("Ctrl+Y", "Rétablir"),
        s("Ctrl+A", "Tout sélectionner"),
      ],
    },
    {
      title: "Fichier",
      items: [s("Ctrl+S", "Enregistrer"), s("Ctrl+P", "Imprimer"), s("Ctrl+F", "Rechercher"), s("Ctrl+N", "Nouveau"), s("Ctrl+W", "Fermer"), s("Alt+F4", "Quitter l'appli")],
    },
  ],
};

export const APP_SHEETS: AppSheet[] = [
  {
    name: "Explorateur de fichiers",
    programs: ["explorer"],
    groups: [
      {
        title: "Dossiers",
        items: [s("Ctrl+Maj+N", "Nouveau dossier"), s("Alt+↑", "Dossier parent"), s("Alt+←", "Dossier précédent"), s("Ctrl+L", "Barre d'adresse"), s("Ctrl+E", "Rechercher"), s("Ctrl+T", "Nouvel onglet")],
      },
      {
        title: "Fichiers",
        items: [s("F2", "Renommer"), s("Alt+Entrée", "Propriétés"), s("Ctrl+Maj+C", "Copier le chemin"), s("Alt+P", "Volet d'aperçu"), s("Maj+Suppr", "Supprimer sans la Corbeille"), s("Ctrl+W", "Fermer la fenêtre")],
      },
    ],
  },
  {
    name: "Excel",
    programs: ["excel"],
    groups: [
      {
        title: "Cellules",
        items: [s("F2", "Modifier la cellule"), s("Alt+Entrée", "Retour à la ligne dans la cellule"), s("F4", "Figer la référence ($)"), s("Ctrl+1", "Format de cellule"), s("Ctrl+;", "Date du jour"), s("Alt+=", "Somme automatique")],
      },
      {
        title: "Se déplacer",
        items: [s("Ctrl+→", "Aller au bout des données"), s("Ctrl+Maj+→", "Sélectionner jusqu'au bout"), s("Ctrl+Espace", "Sélectionner la colonne"), s("Maj+Espace", "Sélectionner la ligne"), s("Ctrl+Maj+L", "Filtres"), s("Ctrl+Pg.suiv", "Feuille suivante")],
      },
    ],
  },
  {
    name: "Word",
    programs: ["winword"],
    groups: [
      {
        title: "Mise en forme",
        items: [s("Ctrl+G", "Gras"), s("Ctrl+I", "Italique"), s("Ctrl+U", "Souligné"), s("Ctrl+E", "Centrer"), s("Maj+F3", "Changer la casse"), s("Ctrl+Espace", "Effacer la mise en forme")],
      },
      {
        title: "Document",
        items: [s("Ctrl+Entrée", "Saut de page"), s("Ctrl+K", "Insérer un lien"), s("Ctrl+H", "Remplacer"), s("F7", "Orthographe"), s("Ctrl+Alt+M", "Commentaire"), s("Ctrl+Z", "Annuler")],
      },
    ],
  },
  {
    name: "PowerPoint",
    programs: ["powerpnt"],
    groups: [
      {
        title: "Diaporama",
        items: [s("F5", "Depuis le début"), s("Maj+F5", "Depuis la diapo affichée"), s(".", "Écran noir (pendant le diaporama)"), s("Échap", "Quitter le diaporama")],
      },
      {
        title: "Mise en forme",
        items: [s("Ctrl+G", "Gras"), s("Ctrl+I", "Italique"), s("Ctrl+E", "Centrer"), s("Ctrl+K", "Insérer un lien")],
      },
    ],
  },
  {
    name: "Outlook",
    programs: ["outlook", "olk"],
    groups: [
      {
        title: "Courrier",
        items: [s("Ctrl+Maj+M", "Nouveau message"), s("Ctrl+R", "Répondre"), s("Ctrl+Maj+R", "Répondre à tous"), s("Ctrl+F", "Transférer"), s("Ctrl+Entrée", "Envoyer"), s("Ctrl+Q", "Marquer comme lu")],
      },
      {
        title: "Naviguer",
        items: [s("Ctrl+1", "Courrier"), s("Ctrl+2", "Calendrier"), s("Ctrl+E", "Rechercher"), s("Suppr", "Supprimer")],
      },
    ],
  },
  {
    name: "Navigateur",
    programs: ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc"],
    groups: [
      {
        title: "Onglets",
        items: [s("Ctrl+T", "Nouvel onglet"), s("Ctrl+Maj+T", "Rouvrir l'onglet fermé"), s("Ctrl+W", "Fermer l'onglet"), s("Ctrl+Tab", "Onglet suivant"), s("Ctrl+1", "Premier onglet"), s("Ctrl+L", "Barre d'adresse")],
      },
      {
        title: "Page",
        items: [s("Ctrl+F", "Rechercher dans la page"), s("Ctrl+D", "Ajouter aux favoris"), s("Ctrl+0", "Zoom à 100 %"), s("Ctrl+F5", "Recharger sans le cache"), s("Ctrl+Maj+N", "Fenêtre privée (Chrome, Edge)"), s("Ctrl+Maj+P", "Fenêtre privée (Firefox)")],
      },
    ],
  },
  {
    name: "Visual Studio Code",
    programs: ["code", "cursor", "windsurf"],
    groups: [
      {
        title: "Fichiers",
        items: [s("Ctrl+P", "Ouvrir un fichier"), s("Ctrl+Maj+P", "Toutes les commandes"), s("Ctrl+Maj+F", "Rechercher dans les fichiers"), s("Ctrl+B", "Barre latérale"), s("Ctrl+ù", "Terminal")],
      },
      {
        title: "Code",
        items: [s("Ctrl+:", "Commenter la ligne"), s("Alt+↑", "Monter la ligne"), s("Maj+Alt+↓", "Dupliquer la ligne"), s("Ctrl+D", "Occurrence suivante"), s("F2", "Renommer le symbole"), s("F12", "Aller à la définition")],
      },
    ],
  },
  {
    name: "Teams",
    programs: ["ms-teams", "teams"],
    groups: [
      {
        title: "En réunion",
        items: [s("Ctrl+Maj+M", "Couper / rétablir le micro"), s("Ctrl+Maj+O", "Caméra"), s("Ctrl+Maj+K", "Lever la main"), s("Ctrl+Maj+E", "Partager l'écran"), s("Ctrl+Maj+H", "Raccrocher")],
      },
      {
        title: "Conversations",
        items: [s("Ctrl+N", "Nouvelle conversation"), s("Ctrl+E", "Rechercher"), s("Ctrl+.", "Tous les raccourcis de Teams")],
      },
    ],
  },
  {
    name: "Bloc-notes",
    programs: ["notepad"],
    groups: [
      {
        title: "Texte",
        items: [s("Ctrl+T", "Nouvel onglet"), s("Ctrl+F", "Rechercher"), s("Ctrl+H", "Remplacer"), s("Ctrl+G", "Aller à la ligne"), s("F5", "Date et heure"), s("Ctrl+W", "Fermer l'onglet")],
      },
    ],
  },
];

export const WINDOWS_SHEET: AppSheet = {
  name: "Windows",
  programs: [],
  groups: [
    {
      title: "Fenêtres",
      items: [s("Alt+Tab", "Passer d'une fenêtre à l'autre"), s("Win+D", "Afficher le bureau"), s("Win+↑", "Agrandir"), s("Win+←", "Ancrer à gauche"), s("Win+Tab", "Vue des tâches"), s("Win+Ctrl+→", "Bureau virtuel suivant")],
    },
    {
      title: "Outils",
      items: [s("Win+V", "Historique du presse-papiers"), s("Win+Maj+S", "Capture d'écran"), s("Win+.", "Emojis"), s("Win+E", "Explorateur"), s("Win+L", "Verrouiller"), s("Ctrl+Maj+Échap", "Gestionnaire des tâches")],
    },
    {
      title: "Réglages",
      items: [s("Win+I", "Paramètres"), s("Win+P", "Mode d'affichage (projeter)"), s("Win+A", "Paramètres rapides"), s("Win+N", "Notifications"), s("Win+X", "Menu du bouton Démarrer")],
    },
  ],
};

/** Les raccourcis d'Ondine (ceux d'origine : ils se changent dans les Réglages). */
export const ONDINE_SHEET: AppSheet = {
  name: "Ondine",
  programs: [],
  groups: [
    {
      title: "Partout",
      items: [
        s("Alt+Espace", "Lanceur"),
        s("Ctrl droit (maintenu)", "Dictée"),
        s("Ctrl+Alt+V", "Parler à Ondine"),
        s("Ctrl+Alt+M", "Couper / rétablir le micro"),
        s("Ctrl gauche (maintenu)", "Cet aide-mémoire"),
        s("Ctrl+Alt+Maj+V", "Recoller la dernière dictée"),
      ],
    },
    {
      title: "Sur l'île",
      items: [s("Molette", "Volume"), s("Échap", "Fermer l'île")],
    },
  ],
};

/** La liste de l'appli (« excel » → Excel) ; la liste « Toutes les applis » sinon. */
export function sheetFor(program: string | null | undefined): AppSheet {
  const p = (program ?? "").toLowerCase();
  return APP_SHEETS.find((a) => a.programs.includes(p)) ?? TEXT_SHEET;
}

/** « Ctrl+Maj+N » → ["Ctrl", "Maj", "N"] ; « Ctrl++ » garde le « + ». */
export function splitKeys(keys: string): string[] {
  const out: string[] = [];
  for (const part of keys.split(/\+(?=.)/)) {
    if (part === "" && out.length) out[out.length - 1] += "+";
    else out.push(part);
  }
  return out;
}

/** Le nom des touches sur un clavier anglais (l'aide-mémoire en anglais). */
const KEYS_EN: Record<string, string> = { Maj: "Shift", Entrée: "Enter", Suppr: "Del", Échap: "Esc", Espace: "Space", "Pg.suiv": "PgDn", Molette: "Wheel" };

/** « Maj » → « Shift » quand l'interface n'est pas en français. */
export function keyName(key: string, french: boolean): string {
  return french ? key : (KEYS_EN[key] ?? key);
}

/** Les groupes qui correspondent au filtre (sur la touche ou l'action, sans accents ni casse). */
export function filterGroups(groups: ShortcutGroup[], query: string): ShortcutGroup[] {
  const norm = (x: string) =>
    x
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
  const q = norm(query.trim());
  if (!q) return groups;
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => norm(`${i.keys} ${i.what}`).includes(q)) })).filter((g) => g.items.length > 0);
}
