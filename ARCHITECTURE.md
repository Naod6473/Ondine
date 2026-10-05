# Architecture d'Island

Island est une appli Windows 10/11 qui vit en haut au centre de l'écran : une
« île » noire et une icône dans la zone de notification, rien dans la barre des
tâches. Pile : **Tauri 2** (WebView2) + **Rust** pour le système, **TypeScript +
Vite sans framework** pour l'interface.

Plusieurs techniques Windows (fenêtre qui ne prend pas le focus, clics
traversants, glisser-déposer dans WebView2, fenêtre de réglages créée au
démarrage) viennent de [Coucou](https://github.com/Louis-CFM/coucou) (MIT), qui
les a mises au point sur la même pile.

## Arborescence

```
island/
├─ ARCHITECTURE.md            ce document
├─ README.md                  lancer, tester, construire
├─ package.json · vite.config.ts · tsconfig.json
├─ index.html                 page de l'île
├─ settings.html              page de la fenêtre de réglages
├─ annotate.html              page de la fenêtre d'annotation des captures
├─ scripts/gen-icons.mjs      dessine l'icône de l'appli (npm run icons)
├─ mascots/                   UNE MASCOTTE = UN DOSSIER (manifest.json + fichiers)
│  ├─ placeholder/            la mascotte provisoire, dessinée en code
│  └─ goutte/                 la goutte en planches de sprites (mascotte par défaut)
├─ src/                       ── FRONT (TypeScript) ──
│  ├─ main.ts                 démarrage de la fenêtre de l'île
│  ├─ core/                   le socle partagé par tout le front
│  │  ├─ bridge.ts            le SEUL fichier qui appelle Tauri
│  │  ├─ bus.ts               bus d'événements (relié au Rust et aux autres fenêtres)
│  │  ├─ notifications.ts     file de notifications avec priorités
│  │  ├─ module-types.ts      ce qu'est un module (manifeste, API, vues)
│  │  ├─ module-registry.ts   démarre, isole et met à l'écart les modules
│  │  ├─ settings-store.ts    réglages côté front (copie synchronisée)
│  │  ├─ types.ts             forme des réglages (miroir du Rust)
│  │  └─ log.ts               journal côté front (écrit dans le fichier du Rust)
│  ├─ island/
│  │  ├─ island-state.ts      machine à états de l'île (sans DOM)
│  │  ├─ island.ts            dessin, souris, clavier, glisser-déposer
│  │  └─ dom.ts               petite aide `el()` pour créer du HTML sans framework
│  ├─ mascot/
│  │  ├─ renderer.ts          contrat MascotRenderer + liste des moteurs
│  │  ├─ mascot-state.ts      machine à états de la mascotte, reliée au bus
│  │  ├─ catalog.ts           trouve et vérifie les mascottes de mascots/
│  │  ├─ types.ts             états, humeurs, format du manifeste
│  │  └─ renderers/            canvas-placeholder.ts, spritesheet.ts, overlays.ts
│  ├─ modules/
│  │  ├─ index.ts             LISTE DES MODULES (front)
│  │  ├─ shelf/               Étagère et dépôt de fichiers (phase 2)
│  │  ├─ clipboard/           Presse-papiers et snippets (phase 4)
│  │  ├─ capture/             Captures d'écran et OCR (phase 5)
│  │  ├─ timer/               Minuteur, Pomodoro, chrono (phase 6, front seulement)
│  │  ├─ notes/               Notes rapides et to-do (phase 6)
│  │  ├─ agenda/              Prochain rendez-vous depuis un .ics (phase 6)
│  │  ├─ terminal/            Ouvrir cmd / PowerShell en un clic (phase 7)
│  │  ├─ media/               Musique en cours de lecture (phase 3)
│  │  └─ hello/               module d'exemple : manifest.json + index.ts
│  ├─ settings/               fenêtre de réglages (formulaires générés)
│  ├─ annotate/               fenêtre d'annotation (dessin sur une capture)
│  └─ styles/                 island.css, settings.css
└─ src-tauri/                 ── BACKEND (Rust) ──
   ├─ tauri.conf.json         fenêtre de l'île, sécurité (CSP), installateur
   ├─ capabilities/           ce que les pages ont le droit d'appeler
   └─ src/
      ├─ main.rs · lib.rs     démarrage + liste des commandes Tauri
      ├─ tray.rs              icône de la zone de notification
      ├─ island/mod.rs        placement multi-écrans/DPI, clics traversants, souris
      ├─ platform/            tout le Win32 (windows.rs) ; other.rs = bouchons ; media.rs = SMTC ; ocr.rs = OCR
      ├─ services/            réglages, journal, identifiants, bus, annulation, confidentialité, fichiers, ics
      └─ modules/             registre des modules Rust + shelf.rs, clipboard.rs, capture.rs, notes.rs, agenda.rs, terminal.rs, media.rs, hello.rs
```

## L'île

### La fenêtre

Une fenêtre Tauri `island` : sans bordure, transparente, toujours au premier
plan, absente de la barre des tâches et d'Alt+Tab (`WS_EX_TOOLWINDOW`), et qui
**ne prend pas le focus** quand on clique dessus (`WS_EX_NOACTIVATE`).

Elle a deux tailles (en px logiques, multipliées par l'échelle de l'écran) :

| Taille   | Quand                     | Rôle |
|----------|---------------------------|------|
| 240 × 6  | île `hidden`              | bande invisible tout en haut : le survol (détecté par le Rust, 20 fois par seconde) ou un fichier glissé réveille l'île |
| 720 × 320| tous les autres états     | assez grande pour la plus grande vue ; seule la forme de l'île prend la souris |

**Clics traversants.** Tauri 2 ne sait rendre « transparente aux clics » que la
fenêtre entière. Le Rust lit donc la souris ~60 fois par seconde quand l'île est
visible, et bascule ce réglage quand la souris entre ou sort de la forme
de l'île, que le front lui envoie à chaque changement (`island_set_rect`). Pendant
qu'un bouton de souris est enfoncé au-dessus du panneau, tout le panneau prend la
souris : sinon Windows ne verrait pas l'île comme cible d'un glisser-déposer.

**Focus.** L'île ne prend le focus clavier que dans l'état `expanded` (ouvert par
un clic ou par le menu) : c'est ce qui permet à Échap de fonctionner. En sortant
de `expanded`, le focus est rendu à la fenêtre qui l'avait avant.

**Écrans et DPI.** Réglage `general.screen` : écran principal ou écran de la
souris. L'île se replace toute seule quand un écran est branché, débranché ou
change d'échelle (vérifié deux fois par seconde).

### La machine à états (`src/island/island-state.ts`)

| État       | Ce qu'on voit |
|------------|---------------|
| `hidden`   | rien (bande de réveil de 6 px) |
| `peek`     | un petit trait : la souris touche le haut-centre de l'écran |
| `compact`  | pilule : mascotte + vue compacte d'un module ou notification |
| `expanded` | panneau : onglets des modules, réglages, réduire |
| `drop`     | un fichier est glissé dessus : les cibles de dépôt des modules |
| `alert`    | notification prioritaire (high / critical) |

| De → vers | Déclencheur |
|-----------|-------------|
| hidden → peek | la souris touche la bande de réveil |
| peek → compact | survol maintenu 350 ms |
| peek → expanded, compact → expanded | clic |
| peek → hidden | souris partie depuis 300 ms |
| compact → hidden | souris partie depuis `island.collapseSecs` (1,5 s par défaut), sauf pendant une notification |
| expanded → hidden | souris partie depuis `island.collapseSecs` (→ compact si une notification est affichée) |
| expanded → compact | bouton ▴ |
| tout → hidden | Échap (en `alert`, Échap ferme seulement l'alerte) |
| tout → drop | un fichier entre ; l'état d'avant est retenu |
| drop → état d'avant | le glisser sort de l'île |
| drop → compact | le fichier est lâché (le résultat s'affiche) |
| tout sauf drop → alert | une notification high/critical arrive |
| alert → état d'avant | plus d'alerte (hidden/peek deviennent compact) |
| hidden/peek → compact | notification low/normal |
| menu « Ouvrir l'île » → expanded | |

Les transitions sont animées en CSS (`width`, `height`, `border-radius`, 280 ms,
dans `island.css`). Quand l'île se cache, la fenêtre ne redevient une bande
qu'après la fin de l'animation.

### Les animations

- **Forme de l'île** : transitions CSS sur largeur, hauteur, arrondi, avec un
  ressort (`--ease` en `linear()`, 420 ms, petit dépassement de 4 %).
  `TRANSITION_MS` dans island.ts doit suivre `--speed`.
- **Arrivée du contenu** quand l'état change : fondu, léger flou et glissement
  (Web Animations API, dans `render`).
- **Changement d'onglet** (`switchTab`) : on ne redessine pas toute la vue. La
  pastille de l'onglet actif (`src/island/tab-pill.ts`) se déplace avec deux
  ressorts, un par bord : le bord qui mène est raide, celui qui suit est mou,
  donc la pastille s'étire puis se rétracte (effet « verre liquide »).
  L'ancien contenu s'efface d'un côté pendant que le nouveau arrive de l'autre,
  dans la même case de grille (`.view-stage`).
- **Réduire les animations** (réglage d'accessibilité de Windows) : tout
  devient instantané (`reducedMotion()`, `prefers-reduced-motion`).

### La file de notifications (`src/core/notifications.ts`)

Un module **demande** l'attention (`api.notify({...})`), l'île **décide** :
une seule notification visible ; tri par priorité (`critical` > `high` > `normal`
> `low`) puis par arrivée ; une plus prioritaire passe devant tout de suite ;
`high`/`critical` ouvrent l'île en `alert`, `low`/`normal` s'affichent dans l'île
compacte (ou en bandeau dans l'île ouverte) ; même `key` = remplacement ;
`sticky` = reste jusqu'à fermeture ; 20 en attente au plus.

## Le système de modules

Chaque fonction est un module indépendant, activable dans Réglages → Modules.

### Le manifeste (`src/modules/<id>/manifest.json`)

Lu à la fois par le front (import) et par le Rust (`include_str!`).

```jsonc
{
  "id": "hello",                      // minuscules, chiffres, tirets
  "name": "Bonjour", "icon": "👋", "description": "…", "version": "0.1.0",
  "permissions": [],                  // files, clipboard, network, claude-api, credentials
  "settings": { "version": 1, "fields": [
    { "key": "name", "type": "string", "label": "Ton prénom", "default": "Simon" }
  ]},                                 // types : string, number, boolean, select, folders, files
  "views": ["compact", "expanded", "drop"],
  "commands": ["greet"],              // commandes Rust exposées
  "events": { "emits": ["hello.greeted"], "listens": ["hello.ping"] }
}
```

Ce qui est vérifié, et où :

- **Permissions** : le Rust refuse un module qui demande une permission inconnue.
  Chaque accès sensible du Rust passe par `ModuleContext`, qui vérifie la
  permission (`check_path` → `files`, `credential` → `credentials`…).
- **Commandes** : `module_invoke` refuse une commande non déclarée, ou un module
  désactivé.
- **Événements** : un module ne peut publier que ce qu'il déclare dans `emits`,
  et écouter que ce que couvre `listens` (front et Rust).
- **Réglages** : l'écran est généré depuis `settings.fields` ; chaque valeur est
  ramenée à quelque chose de valide (bornes, options) avant usage.

### Les deux moitiés d'un module

- **Front** (`src/modules/<id>/index.ts`) exporte un `IslandModule` :
  `setup(api)` et des `views` (`compact`, `expanded` : des fonctions qui montent
  la vue dans un élément ; `drop` : une liste de cibles de dépôt, ou une
  fonction `(api) => cibles` appelée à chaque glisser quand les cibles dépendent
  des réglages, comme les favoris de l'Étagère). Tout passe par
  `api` : `emit`, `on`, `invoke`, `settings`, `notify`, `handler`, `log`, et
  `closeIsland()` pour refermer l'île (ex. : après avoir collé un texte).
- **Rust** (facultatif, `src-tauri/src/modules/<id>.rs`) implémente
  `RustModule` : `invoke(ctx, commande, args)`, `on_event(ctx, message)` et
  `start(app)`, appelé une fois au démarrage pour lancer un travail de fond
  (un thread qui vérifie `modules::is_active` à chaque tour et rattrape ses
  propres paniques).
- **Vue compacte** : l'île montre celle du premier module (ordre de
  `src/modules/index.ts`) qui en a une à montrer. Un module peut dire « pas
  maintenant » avec `views.compactWhen(api)`, et prévenir l'île que sa réponse a
  changé avec `api.refreshCompact()`.

### Isolation : un module qui plante ne fait pas tomber l'île

- Front : `setup`, les vues, les abonnés du bus, les cibles de dépôt et les
  gestionnaires entourés par `api.handler` sont rattrapés. Chaque erreur est notée
  et comptée ; à 3, le module est arrêté jusqu'au redémarrage et l'île le dit.
- Rust : chaque commande et chaque événement passent par `catch_unwind` ; une
  panique devient une erreur. À 3, le module Rust est mis à l'écart.
  (C'est pourquoi `Cargo.toml` ne met **pas** `panic = "abort"`.)

### Ajouter un module

1. Crée `src/modules/<id>/manifest.json` (copie celui de `hello`).
2. Crée `src/modules/<id>/index.ts` qui exporte un `IslandModule`.
3. Ajoute-le dans `src/modules/index.ts`.
4. S'il a du code Rust : crée `src-tauri/src/modules/<id>.rs` (copie `hello.rs`),
   ajoute `mod <id>;` en haut de `modules/mod.rs` et une ligne dans
   `Registry::new()`.
5. `npm run tauri dev` : le module apparaît dans l'île et dans Réglages → Modules.

## Le bus d'événements

Un seul bus logique pour la fenêtre de l'île, la fenêtre de réglages et le Rust.
Publier dans une fenêtre livre le message tout de suite dans cette fenêtre, puis
le Rust le donne aux modules Rust intéressés et le renvoie aux autres fenêtres.
Sujets : `[a-z0-9._-]`, 64 caractères max ; abonnements exacts, `préfixe.*` ou
`*` ; messages de 64 Ko au plus.

Sujets standard (un module peut en publier d'autres, préfixés par son id) :

| Sujet | Publié par | Effet |
|-------|-----------|-------|
| `app.ready` | île | la mascotte se réveille |
| `island.state` `{from,to}` | île | |
| `island.files-dropped` `{count,target}` | île | la mascotte mange |
| `task.started` / `task.finished` / `task.failed` | modules | working / celebrate / annoyed |
| `claude.thinking` / `claude.done` | modules Claude (phase 8) | thinking / idle |
| `notify.alert` / `notify.alert-end` | île | alert |
| `mascot.clicked`, `mascot.hover-long` | île | annoyed, dizzy / love |
| `mascot.play` `{animation}` | réglages | joue une animation |
| `mascot.state` | mascotte | |
| `undo.offered` / `undo.done` / `undo.expired` | service d'annulation | bouton « Annuler » |
| `module.crashed` | Rust | l'île prévient |
| `shelf.changed` `{items}` | Étagère (Rust) | la vue de l'étagère se redessine |
| `media.changed` `{playing, artwork}` | Musique (Rust) | la pilule et l'onglet Musique se mettent à jour |
| `capture.done` `{action, ok, result, error}` | Capture (Rust) | notification ; l'onglet redemande le texte lu (`last`), qui n'est pas dans le message |
| `shelf.add` `{paths}` | Capture (Rust) | l'Étagère valide les chemins et les pose sur l'étagère |
| `clipboard.changed` `{count}` | Presse-papiers (Rust) | l'onglet redemande la liste (le message ne contient aucun texte copié) |
| `timer.done` `{title}` | Minuteur (front) | (la notification et le son sont faits par le module) |
| `notes.changed` `{notes, todos, open}` | Notes (Rust) | l'onglet redemande la liste (que des nombres dans le message) |
| `agenda.changed` `{count, next, errors, version}` | Agenda (Rust) | l'onglet et la pilule redemandent la liste (`upcoming`) |
| `agenda.reminder` `{key, minutes}` | Agenda (Rust) | notification « Dans 10 min : … » (île en alerte) |

## Services communs (`src-tauri/src/services/`)

- **Réglages** (`settings.rs`) : `%APPDATA%\Island\settings.json`, champ
  `version` + fonction `migrate` pour faire évoluer le format ; écriture atomique ;
  un fichier abîmé est mis de côté, jamais effacé ; export dans
  `%APPDATA%\Island\exports\`, import depuis Réglages → Sauvegarde (refusé s'il
  vient d'une version plus récente).
- **Identifiants** (`credentials.rs`) : Gestionnaire d'identifiants Windows
  (crate `keyring` 3). Liste fermée de clés (`anthropic-api-key`). Le front peut
  demander si une clé existe, en enregistrer ou en supprimer une, **jamais** la
  relire. Seul un module Rust avec la permission `credentials` peut la lire.
- **Journal** (`log.rs`) : `%LOCALAPPDATA%\Island\logs\island.log`, niveaux
  error/warn/info/debug (réglable), rotation à 1 Mo (3 anciens gardés), chaque
  ligne passe par `redact` qui masque ce qui ressemble à une clé. Règle : ne jamais
  journaliser de clé, de mot de passe, de texte copié ni de contenu de fichier.
- **Annulation** (`undo.rs`) : un module fait son action puis enregistre comment
  la défaire ; l'île affiche « Annuler » quelques secondes. **Jamais de suppression
  définitive** : supprimer = Corbeille.
- **Fichiers** (`files.rs`) : Corbeille (envoyer, ressortir), copier, déplacer,
  compresser en .zip, copier du texte, montrer dans l'Explorateur. Jamais
  d'écrasement : si le nom est pris, on crée « nom (2).ext ». Un déplacement entre
  deux disques = copie puis original à la Corbeille. Les liens symboliques ne sont
  pas suivis. Les chemins doivent avoir été validés avant (`ctx.check_path`).
- **Agenda .ics** (`ics.rs`) : lit le texte d'un fichier iCalendar (aucun
  téléchargement, rien d'exécuté) et déroule les répétitions. Voir « Module
  Agenda ».
- **Confidentialité** (`privacy.rs`) : aucune télémétrie. `check_path` refuse les
  chemins relatifs, inexistants ou situés dans un dossier exclu (après résolution
  des `..` et des liens). Un module qui envoie du contenu à l'API Claude déclare
  `claude-api` (affiché dans les réglages) et montre ce qui part avant l'envoi.

## La mascotte

```
bus ──▶ MascotController (mascot-state.ts) ──▶ MascotRenderer (renderer.ts)
             états + règles du manifeste            canvas-code | spritesheet | lottie | rive
```

- **Contrat `MascotRenderer`** : `mount`, `play(animation)`, `setState`,
  `setMood`, `lookAt(x, y)`, `onAnimationEnd`, `destroy`. Brancher un nouveau
  format = écrire une classe qui respecte ce contrat et l'ajouter à `RENDERERS`.
- **Manifeste** `mascots/<id>/manifest.json` :

```jsonc
{
  "id": "placeholder", "name": "Goutte (provisoire)", "version": "0.1.0",
  "renderer": "canvas-code",     // moteur
  "fallback": "idle",            // animation par défaut d'un état sans animation
  "states": { "idle": "idle", "sleep": "sleep" },   // état → animation
  "animations": [{
    "name": "sleep",
    "source": { "function": "sleep" },   // ou { "file": "sleep.png", "frames": 12, "fps": 24 }
    "durationMs": 3200, "loop": true,
    "priority": 1,                       // résiste aux interruptions moins prioritaires
    "transitionsTo": ["wake", "alert"],  // "*" = toutes
    "next": "idle"                       // facultatif, après une animation non bouclée
  }]
}
```

- **États** : idle, wake, sleep, happy, annoyed, dizzy, thinking, working,
  alert, eating, celebrate, love, bored. Humeurs : neutral, happy, grumpy, tired.
- **Déclencheurs** : voir le tableau du bus ; plus l'inactivité (bored après
  `mascot.boredAfterSecs`, sleep après `mascot.sleepAfterSecs`) et le réveil
  dès que la souris revient sur l'île.
- **Moteurs branchés** : `canvas-code` (la goutte provisoire, `mascots/placeholder/`)
  et `spritesheet` (`mascots/goutte/`). Une planche = une ligne d'images de même
  largeur. `"mode": "gaze"` choisit l'image d'après la souris (de la première,
  regard à gauche, à la dernière, regard à droite) et `nearFile` donne la planche
  « de près ». En attendant une vraie planche par état, `effect` (breathe, bounce,
  jump, shake, wobble…) anime le corps par du code et `overlay` (zzz, confetti,
  hearts…) dessine un effet autour.
- **Ajouter ta mascotte** : crée `mascots/<id>/` avec `manifest.json` et ses
  fichiers, relance l'appli, choisis-la dans Réglages → Mascotte et teste chaque
  animation. Un manifeste invalide est signalé, et l'île garde la provisoire.
  Tant que son moteur n'est pas branché, la provisoire la remplace.

## Module Étagère (phase 2)

Front : `src/modules/shelf/index.ts`. Rust : `src-tauri/src/modules/shelf.rs`.

- **Cibles de dépôt** : Étagère, Copier vers…, Déplacer vers… (boîte « Choisir
  un dossier »), un favori par dossier des réglages (copie ou déplacement selon
  le réglage, 6 au plus dans l'île), Copier le chemin, Compresser, Corbeille.
- **L'étagère** : une liste de chemins gardée en mémoire par le Rust, vidée à
  l'arrêt de l'île. Rien n'est copié. Les éléments déplacés suivent leur nouveau
  chemin ; ceux envoyés à la Corbeille quittent l'étagère (et y reviennent si on
  annule).
- **Annuler** (8 s) : copie → les copies vont à la Corbeille ; déplacement →
  chaque élément revient à sa place (refusé si quelque chose a pris sa place) ;
  Corbeille → les éléments ressortent ; compression → l'archive va à la Corbeille ;
  vider l'étagère → la liste revient.
- Chaque chemin reçu est validé par `ctx.check_path` (dossiers exclus compris),
  la destination aussi. Un seul chemin refusé = rien n'est fait.
- Une erreur normale (dossier exclu, fichier disparu) s'affiche dans l'île et ne
  compte pas comme un plantage du module.
- **Recevoir les fichiers (Windows)** : WebView2 pose sur sa fenêtre intérieure
  (`Chrome_RenderWidgetHostHWND`) une cible de dépôt qui refuse tout (🚫), et
  celle de wry/Tauri ne prend pas le relais sur toutes les machines. L'île pose
  donc la sienne à la place (`platform/drop_target.rs`), au premier clic, et
  envoie au front l'événement `file-drag` (`enter`/`over`/`leave`/`drop`, chemins,
  position en pixels physiques). Elle ne lit que la liste des chemins.
- La boîte « Choisir un dossier » est la commande `dialog_pick_folder`
  (plugin officiel `tauri-plugin-dialog`), appelée depuis le Rust uniquement :
  les pages n'ont pas accès au plugin directement.

## Module Musique (phase 3)

Front : `src/modules/media/index.ts`. Rust : `src-tauri/src/modules/media.rs`,
et l'accès à Windows dans `src-tauri/src/platform/media.rs`.

- **Source** : les « System Media Transport Controls » (SMTC) de Windows, ce que
  montre le panneau multimédia du système. Tout lecteur qui s'y déclare marche :
  Spotify, Edge/Chrome/Firefox, VLC, Lecteur multimédia… Crate `windows` 0.61,
  `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`.
- **Surveillance** : un thread lit l'état une fois par seconde et publie
  `media.changed` seulement si le titre, l'état, les boutons disponibles ou la
  position (saut de plus de 2,5 s) changent. Le front fait avancer la barre
  entre deux messages.
- **Pochette** : lue une fois par morceau, gardée par le Rust en data URL
  (4 Mo au plus), demandée par le front avec la commande `artwork` quand le
  numéro `artwork` du message change (le bus limite les messages à 64 Ko).
- **Vue compacte** seulement si quelque chose joue (`compactWhen`) ; sinon la
  vue compacte du module suivant. Un nouveau morceau qui joue montre l'île
  (notification basse), désactivable dans les réglages.
- **Confidentialité** : le module ne fait que lire ce que Windows expose déjà ;
  rien ne sort de l'ordinateur, aucun titre n'est écrit dans le journal.

## Module Presse-papiers (phase 4)

Front : `src/modules/clipboard/index.ts`. Rust : `src-tauri/src/modules/clipboard.rs`,
et l'accès à Windows dans `src-tauri/src/platform/windows.rs` (« Presse-papiers »).

- **Voir les copies** : un thread lit toutes les 400 ms le compteur de copies de
  Windows (`GetClipboardSequenceNumber`). Lire ce compteur ne touche pas au
  contenu ; on ne lit le texte (crate `arboard`) que quand il change.
- **Copies sensibles** : avant de lire, on regarde si l'appli d'origine a
  ajouté un des formats convenus pour « ne pas garder » :
  `ExcludeClipboardContentFromMonitorProcessing`, `Clipboard Viewer Ignore`, ou
  `CanIncludeInClipboardHistory` = 0 (ce que font KeePass, Bitwarden,
  1Password…). Si oui, la copie n'est jamais lue. Presse-papiers occupé pendant
  la vérification = considéré sensible.
- **Historique** : en mémoire seulement (disparaît à la fermeture), le plus
  récent en haut, sans doublons, 50 copies par défaut (réglage), 100 000
  caractères au plus par copie. Recherche sans tenir compte des majuscules,
  faite en Rust ; le front ne reçoit qu'un aperçu de 300 caractères.
- **Épinglés et snippets** : enregistrés dans `%APPDATA%\Island\clipboard.json`
  (écriture via un fichier temporaire renommé). Un fichier abîmé est mis de
  côté, jamais effacé.
- **Coller** : le Rust met le texte dans le presse-papiers, rend le clavier à la
  fenêtre d'avant l'île (`set_activating(false)`), attend 150 ms, vérifie que
  la fenêtre au premier plan n'est pas l'île, puis simule Ctrl+V (`SendInput`).
  « Coller sans mise en forme » remet le texte actuel seul (les formats riches
  disparaissent) avant de coller.
- **Annuler** : retirer une copie, vider l'historique (les épinglés restent) et
  supprimer un snippet proposent « Annuler ».
- **Confidentialité** : aucun texte copié dans le journal ni sur le bus ; rien ne
  sort de l'ordinateur.

## Module Capture (phase 5)

Front : `src/modules/capture/index.ts`. Rust : `src-tauri/src/modules/capture.rs`,
l'OCR dans `src-tauri/src/platform/ocr.rs`.

- **Capturer** : on ne dessine pas notre propre sélection ; on ouvre l'outil de
  Windows (`ShellExecuteW("ms-screenclip:")`, le même que Win+Maj+S). L'île se
  replie d'abord (400 ms) pour ne pas être sur l'image. Un thread attend que le
  compteur du presse-papiers change (2 minutes au plus) ; si ce qui arrive
  n'est pas une image (capture annulée puis autre chose copié), il abandonne
  sans rien dire. Une seule capture en attente à la fois.
- **Lire le texte** : `Windows.Media.Ocr`, hors ligne, dans la langue du profil
  (il faut le pack « Reconnaissance optique de caractères » de la langue,
  installé en général avec elle). L'image est réduite si elle dépasse
  `OcrEngine::MaxImageDimension`. Le texte est copié dans le presse-papiers
  (réglage) et gardé pour l'onglet ; le journal ne note que le nombre de
  caractères.
- **Enregistrer** : PNG (crate `image`) dans le dossier choisi, sinon
  `Images\Island` (dossier connu `FOLDERID_Pictures`, OneDrive compris). Le
  dossier passe par `check_path` (dossiers exclus) ; « Annuler » envoie le
  fichier à la Corbeille.
- **Vers l'étagère** : enregistre le PNG puis publie `shelf.add` ; l'Étagère
  (qui écoute ce sujet) valide le chemin et le pose sur l'étagère.
- **Annoter** : l'image (en PNG) est gardée par le Rust et la fenêtre
  « annotate » s'ouvre (créée cachée au démarrage, comme les réglages : sous
  WebView2 une fenêtre créée plus tard peut rester blanche). Elle lit l'image
  (`annotate_image`), dessine des formes (flèche, rectangle, crayon,
  surligneur, texte ; Annuler/Rétablir), puis renvoie le PNG fini
  (`annotate_export`). Le Rust le décode (ce qui le valide), puis le copie,
  l'enregistre ou le pose sur l'étagère.
- **Image déjà copiée** : les mêmes actions, sans ouvrir l'outil.
- **Onglets** : à partir de 5 modules, les onglets inactifs n'affichent que
  leur icône (le nom au survol).
- `modules::with_context(app, id, f)` donne un `ModuleContext` à un thread de
  fond (réglages, `check_path`, `offer_undo`) tant que le module est actif.

## Phase 6 : temps et organisation

### Module Minuteur (`src/modules/timer/`, front seulement)

- Trois sous-onglets (Minuteur, Pomodoro, Chrono) avec la même pastille
  « liquide » que les onglets de l'île (`TabPill`).
- On ne compte pas les secondes : on retient l'heure de fin (ou de départ) et
  on calcule ce qui reste, donc rien ne dérive si la fenêtre est en veille.
- À la fin : notification `high` (l'île s'ouvre en alerte), petit son généré
  (WebAudio, autorisé seulement après un premier clic dans l'île), et
  `task.finished` (la mascotte fait la fête).
- Pilule : le temps qui reste et une barre de progression, tant que ça tourne.

### Module Notes (`src/modules/notes/`, `src-tauri/src/modules/notes.rs`)

- Données dans `%APPDATA%\Island\notes.json` (écriture atomique ; un fichier
  abîmé est mis de côté). Supprimer une note ou des tâches propose « Annuler »
  et les remet à leur place.
- La liste des tâches garde un élément HTML par tâche (repéré par son numéro) :
  les animations (case cochée, texte barré, arrivée, départ) se font sans tout
  redessiner. Double-clic pour modifier une tâche.
- Le texte des notes ne passe jamais par le bus ni par le journal.

### Module Agenda (`src/modules/agenda/`, `src-tauri/src/modules/agenda.rs`)

- Réglage `icsFiles` (type `files`, extension `.ics`, 5 au plus) : la boîte
  « Ouvrir » de Windows (`dialog_pick_file`). Les chemins passent par
  `check_path` (dossiers exclus), la taille est limitée à 20 Mo.
- Un thread relit un fichier quand sa date de modification change (toutes les
  15 s), calcule les rendez-vous des 30 prochains jours (30 au plus), publie
  `agenda.changed` si la liste a changé et `agenda.reminder` une seule fois
  par rendez-vous, `reminderMin` minutes avant.
- Lecture du .ics (`services/ics.rs`) : lignes repliées, texte échappé,
  journées entières, heures UTC (`Z`) converties, `DURATION`, `RRULE`
  (DAILY/WEEKLY/MONTHLY/YEARLY avec INTERVAL, COUNT, UNTIL, BYDAY dont
  « 1MO » / « -1FR »), `EXDATE`, `RECURRENCE-ID`, `STATUS:CANCELLED`.
  **Limite** : une heure avec fuseau nommé (`TZID=…`) est lue comme une heure
  locale de l'ordinateur (juste si l'agenda est dans le même fuseau).
- Pilule : « Dans 12 min · Titre » quand un rendez-vous approche
  (`compactWithinMin`), puis « En cours » avec une barre qui se remplit.

## Phase 7 : automatisation

### Module Terminal (`src/modules/terminal/`, `src-tauri/src/modules/terminal.rs`)

- Ouvre `cmd.exe`, `powershell.exe`, `pwsh.exe` ou `wt.exe` (liste fermée,
  réglage « Terminal à ouvrir »), dans une nouvelle fenêtre de console
  (`CREATE_NEW_CONSOLE`), dans le dossier de départ (réglage, sinon le dossier
  utilisateur).
- « Admin » : `ShellExecuteW` avec le verbe `runas` (Windows affiche la
  confirmation UAC). Un programme lancé ainsi démarre dans System32 : le
  dossier est passé en paramètre (`cd /d "…"` ou `Set-Location -LiteralPath '…'`).
  Un chemin Windows ne peut pas contenir `"`, et l'apostrophe est doublée pour
  PowerShell : le nom du dossier ne peut pas devenir une commande.
- L'île ne tape jamais de commande : le seul paramètre est le dossier, validé
  par `check_path`.
- Cible de dépôt « Terminal ici » : un dossier déposé → terminal dedans ; un
  fichier → dans son dossier.

