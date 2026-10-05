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
│  │  └─ media/               Musique en cours de lecture (phase 3)
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
      └─ modules/             registre des modules Rust + shelf.rs, clipboard.rs, capture.rs, notes.rs, agenda.rs, terminal.rs, media.rs
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
  "id": "hello",                      // minuscules, chiffres, tirets (exemple fictif)
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

1. Crée `src/modules/<id>/manifest.json` (copie celui de `terminal`, un module simple).
2. Crée `src/modules/<id>/index.ts` qui exporte un `IslandModule`.
3. Ajoute-le dans `src/modules/index.ts`.
4. S'il a du code Rust : crée `src-tauri/src/modules/<id>.rs` (copie `terminal.rs`),
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
| `rules.changed` | Règles (Rust) | l'onglet et l'éditeur redemandent la liste (`list`) |
| `rules.edit` `{id}` | onglet Règles | la fenêtre de réglages ouvre l'éditeur (id 0 = nouvelle règle) |
| `rules.notify` `{title, body}` | Règles (Rust) | notification ⚡ |
| `rules.open-island` `{tab}` | Règles (Rust) | `api.openIsland(tab)` |
| `terminal.open` `{path?}` | Règles (Rust) | le Terminal s'ouvre (dans le dossier donné, validé) |
| `timer.start` `{minutes}` | Règles (Rust) | le Minuteur repart sur cette durée |
| `clipboard.paste-plain` | Règles (Rust) | le Presse-papiers colle le texte sans mise en forme |
| `launcher.open` | Lanceur (Rust, raccourci global) | l'île s'ouvre sur l'onglet Lanceur, recherche prête |
| `launcher.hotkey-error` `{text}` | Lanceur (Rust) | notification : raccourci déjà pris |
| `system.disk-low` `{mount, freePct, freeGb}` | Système (Rust, toutes les 30 s) | notification 💽 : disque presque plein |
| `remote.changed` `{favorites: [{id, name, kind}]}` | Accès distants (Rust, et front au démarrage) | le Lanceur met à jour ses serveurs (sans les adresses) |
| `remote.connect` `{id}` | Lanceur (front) | Accès distants ouvre ce favori |
| `agents.event` `{source, kind, title, body, project, at}` | Agents IA (Rust) | notification (✋ « attend ta permission » en priorité haute, ✅ « a fini ») et historique |
| `agents.projects` `{tools, projects: [{index, name}]}` | Agents IA (Rust) | le Lanceur propose « Claude Code · projet », « Codex · projet »… |
| `agents.launch` `{tool, index?}` | Lanceur (front) | Agents IA ouvre cet agent dans ce projet |
| `agents.changed` | Agents IA (Rust) | l'onglet redessine le tableau des sessions |
| `agents.ask` `{id, kind, who, question, detail, options, session, until}` | Agents IA (Rust : outil MCP ou permission) | alerte avec un bouton par choix (permission : Autoriser… / Refuser / Au terminal) |
| `agents.ask.closed` `{id, expired, gone}` | Agents IA (Rust) | remplace l'alerte par « Réponse envoyée », « Pas de réponse » ou « Réglé ailleurs » |
| `agents.progress` `{source, who, title, step, total}` | Agents IA (Rust, outil MCP) | notification « 3/7 » remplacée à chaque étape |
| `agents.quiet` `{on, summary?}` | Agents IA (Rust) | début / fin de la concentration ; à la fin, la notification du résumé |
| `claude.thinking` / `claude.done` | Agents IA (Rust) | la mascotte réfléchit tant qu'une session de Claude Code travaille |

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
- **Ordre des onglets** : réglage `island.tabOrder` (liste d'ids ; vide = ordre
  d'origine ; un module absent se met à la fin). On le change en glissant un
  onglet dans l'île (`src/island/tab-drag.ts` : l'onglet suit la souris, les
  voisins s'écartent en animation FLIP, la pastille suit) ou dans Réglages →
  Modules (glisser ou ↑ ↓). Calculs dans `src/core/tab-order.ts`.
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

### Module Règles (`src/modules/rules/`, `src-tauri/src/modules/rules/`)

Une règle = **Quand** (déclencheur) · **Si** (conditions) · **Alors** (actions
dans l'ordre). Fichiers : `model.rs` (la forme d'une règle, sa validation, le
renommage), `mod.rs` (commandes, exécution, annulation), `watch.rs` (le fil
qui surveille dossiers et lecteurs).

- Stockage : `%APPDATA%\Island\rules.json` (écriture atomique ; un fichier
  abîmé est mis de côté, pas écrasé). L'historique (« Récemment ») reste en
  mémoire.
- Déclencheurs :
  - **fichier** : crate `notify` 8 sur le dossier choisi. Un fichier n'est
    traité que quand sa taille ne bouge plus depuis 1,5 s (téléchargements) ;
    `.crdownload`, `.part`, `.tmp`, `~$…` sont ignorés ; un fichier que l'île
    vient de produire est ignoré 30 s (pas de boucle).
  - **lecteur branché / débranché** : `GetLogicalDrives` toutes les 2 s
    (lecteurs amovibles et fixes ; le premier passage ne fait que noter).
  - **raccourci global** : `tauri-plugin-global-shortcut` 2 (touches
    « physiques » `KeyV`, avec Ctrl, Alt ou Super). Un raccourci déjà pris
    affiche une erreur sur la règle.
  - **événement de l'île** : `capture.done`, `timer.done`, `agenda.reminder`,
    `task.finished`.
- Actions : déplacer, copier, renommer (`{nom} {date} {heure}`, extension
  gardée), Corbeille, étagère, montrer dans l'Explorateur, terminal,
  notification, ouvrir l'île, minuteur, coller sans mise en forme. Pas
  d'action « lancer un programme ».
- Sécurité : chaque dossier passe par `check_path` (dossiers exclus) ; la
  destination ne peut pas être dans le dossier surveillé ; déplacer, renommer
  et Corbeille sont regroupés en **un** « Annuler » ; plus de 20 déclenchements
  par minute → la règle se désactive et prévient.
- « 🧪 Tester » (`preview`) déroule la règle sur un fichier choisi sans rien
  toucher.
- Front : l'onglet de l'île (liste, interrupteurs, pause générale, historique)
  et la section « Règles » de la fenêtre de réglages
  (`src/settings/rules-editor.ts`).

### Module Lanceur (`src/modules/launcher/`, `src-tauri/src/modules/launcher.rs`)

- Raccourci global au choix dans une liste fixe (Alt+Espace par défaut, ou
  aucun). Un fil vérifie chaque seconde que le raccourci réservé correspond au
  réglage et au module activé. Pressé → `launcher.open` → l'île s'ouvre sur
  l'onglet, prend le focus clavier, la recherche est sélectionnée.
- Entrées trouvées par le Rust (relues au plus toutes les 30 s) :
  - applications : raccourcis `.lnk`/`.url` des deux menus Démarrer
    (`%ProgramData%` et `%APPDATA%`), sans les désinstalleurs ;
  - outils Windows : une liste FIXE (Services, Gestionnaire de périphériques,
    Observateur d'événements, Connexions réseau, Registre…) ;
  - fichiers récents : les raccourcis de `%APPDATA%\Microsoft\Windows\Recent`,
    dont la cible est lue avec `IShellLinkW` (COM, dans un fil à part). Chaque
    cible passe par `check_path` (dossiers exclus) ; les exécutables (.exe,
    .bat, .ps1…) ne sont jamais proposés. Réglage pour tout masquer.
- Le front n'envoie qu'un numéro d'entrée (`launch {id}`), jamais un chemin.
  Ouverture : `ShellExecuteW("open")`, comme un double-clic. Avant, l'île
  « oublie » la fenêtre d'avant (`forget_previous_foreground`) pour que le
  programme lancé passe devant au lieu de se faire voler le focus.
- Actions de l'île (front) : chaque onglet, « 10 min » → minuteur
  (`timer.start`), « Ouvrir un terminal » (`terminal.open`), réglages.
- Tri (`search.ts`) : début du nom > début d'un mot > initiales (« gdp ») >
  contenu > lettres dans l'ordre ; sans accents ni majuscules.

### `api.openIsland(tab?)`

Un module peut demander d'ouvrir l'île, éventuellement sur un onglet (ignoré
s'il n'existe pas ou est désactivé).

## Phase 8 : outils IT

### Module Système (`src/modules/system/`, `src-tauri/src/modules/system.rs`)

- Tout est lu sur le PC (crate `sysinfo` 0.39, `GetSystemPowerStatus` pour la
  batterie) : rien ne part sur Internet, rien n'est écrit dans le journal.
- Un fil de fond mesure processeur et mémoire toutes les 2 s (il faut deux
  mesures espacées pour un pourcentage de processeur) quand le module est
  actif, et les disques toutes les 30 s.
- Disque fixe sous le seuil (réglage `diskAlertPct`, 10 % par défaut, 0 =
  jamais) → `system.disk-low`, une seule fois par disque, de nouveau
  seulement si la place est revenue au-dessus du seuil + 2 points.
- Commandes : `snapshot` (nom du PC, utilisateur, Windows, durée depuis le
  démarrage, processeur, mémoire, disques, cartes réseau avec IP et MAC,
  batterie) et `copy_support` (permission `clipboard`) : le même résumé en
  texte, à coller dans un ticket.
- L'onglet : trois jauges rondes (processeur, mémoire, disque C:) qui glissent
  d'une mesure à l'autre (`@property --p`), les infos utiles au support, puis
  le détail des disques et du réseau. Rafraîchi toutes les 2 s, seulement
  tant que l'onglet est ouvert.
- Avec plus de 8 onglets, la barre d'onglets se resserre (`.tabs.dense`) en
  attendant la navigation à la souris prévue plus tard.

### Module Accès distants (`src/modules/remote/`, `src-tauri/src/modules/remote.rs`)

- Favoris RDP et SSH dans `%APPDATA%\Island\remote.json` : nom, type,
  adresse, port, utilisateur (SSH). Jamais de mot de passe. Supprimer
  propose « Annuler ».
- Deux programmes seulement : `mstsc.exe /v:serveur[:port]` (`/f` si le
  réglage plein écran est coché) et `ssh.exe [-p port] [-l utilisateur]
  serveur`, dans une console ou dans Windows Terminal (`wt.exe new-tab …`,
  réglage). Chaque valeur est un paramètre séparé, sans interpréteur.
- Validation (`check_host`, `check_user`) : lettres, chiffres et quelques
  signes, ni espace ni « ; », jamais de « - » au début (sinon ssh lirait
  une option comme `-oProxyCommand`, qui lance une commande).
- Connexion rapide : on tape une adresse, on clique RDP ou SSH (validée de
  la même façon), ★ pour l'enregistrer.
- « Tester » (`probe`, permission `network`) : une connexion TCP vers le port
  (3389 / 22 par défaut, 1,5 s au plus), rien n'est envoyé. Point vert avec
  le temps de réponse, ou rouge.
- Le journal note le type de connexion, jamais l'adresse.
- Lanceur : il reçoit la liste par `remote.changed` (numéro, nom, type) et
  demande l'ouverture par `remote.connect {id}`.

### Module Réseau (`src/modules/nettools/`, `src-tauri/src/modules/nettools.rs`)

- Permission `network`. L'adresse tapée passe par le même `check_host` que
  les Accès distants ; le journal ne la contient pas.
- `ping {host}` : un écho ICMP par `IcmpSendEcho` (iphlpapi, sans droits
  administrateur), IPv4 seulement, 1 s au plus. Le front le répète chaque
  seconde tant que l'onglet est ouvert : barres des 40 derniers temps
  (rouge = perdu), perte, min / moyenne / max.
- `port {host, port}` : connexion TCP (2 s au plus) → `open`, `closed`
  (refusée : la machine répond mais rien n'écoute) ou `silent` (pas de
  réponse : éteinte ou pare-feu). Raccourcis : 443, 80, 3389, 22, 445, 53.
- `dns {host}` : nom → adresses par le résolveur de Windows ; une IPv4 →
  son nom (`GetNameInfoW`, recherche inverse).

## Agents IA (`src/modules/agents/`, `src-tauri/src/modules/agents.rs`, `src-tauri/src/cli.rs`)

Les outils extérieurs préviennent l'île par une porte d'entrée locale.

- `island.exe notify [--source x] [--title t] [--message m]` (`main.rs` →
  `cli.rs`) : ne démarre PAS l'île. Lit l'entrée standard si un programme
  l'envoie (le JSON d'un hook), emballe le tout en
  `{v, source, title?, message?, hook?}` et l'envoie par le canal
  `\\.\pipe\island-agents-<utilisateur>`, puis s'arrête avec le code 0, sans
  rien écrire (un hook ne doit jamais bloquer Claude Code).
- Le canal (`platform::serve_agents_pipe`) : une ligne par connexion, jamais depuis
  le réseau (`PIPE_REJECT_REMOTE_CLIENTS`), première instance exclusive
  (`FILE_FLAG_FIRST_PIPE_INSTANCE` : on refuse d'écouter si un autre programme
  a pris le nom), droits Windows par défaut (seul le compte qui l'a créé peut
  écrire). 64 Ko au plus par message, 10 messages par seconde au plus.
- Hooks de Claude Code compris (`understand`) :
  - `UserPromptSubmit` → la session travaille (le texte tapé n'est jamais lu) ;
  - `Notification` → « attend ta permission » (`permission_prompt`) ou « attend
    ta réponse » (`idle_prompt`, `elicitation_dialog`, `agent_needs_input`) ;
    les autres types (connexion, quotas…) sont ignorés ;
  - `Stop` → « a fini » (`last_assistant_message` n'est jamais lu) ;
  - `SessionEnd` → la session est oubliée. Une session muette depuis 1 h aussi.
- Tout arrivage est du texte à afficher : tronqué, sans caractères de
  contrôle, le dossier réduit à son nom. Rien n'est exécuté ni ouvert. Le
  journal ne note que le type d'événement. Historique : 30 derniers, en
  mémoire seulement.
- Configuration proposée (`hook_config`, bouton « Copier la configuration ») :
  forme `command` + `args` (Claude Code lance island.exe directement, sans
  Git Bash ni PowerShell, donc aucun échappement du chemin).
- Lancer Claude Code (`launch_claude {path? | index?}`, permission `files`) :
  `cmd.exe /k claude` dans le dossier (cmd trouve `claude.exe` ou `claude.cmd`
  dans le PATH ; la fenêtre reste ouverte si Claude n'est pas installé), ou
  `wt.exe -d <dossier> cmd.exe /k claude` selon le réglage (sauf si le
  dossier contient « ; », que Windows Terminal lirait comme un séparateur).
  Dossiers : réglage « Projets » (8 au plus, validés par `check_path`), la
  boîte « Choisir un dossier », sinon le dossier utilisateur. Seul le mot
  `claude` est tapé.
- Codex et Gemini CLI (`--source codex` / `--source gemini`) :
  - Codex : hooks `UserPromptSubmit`, `PermissionRequest` (« attend ta
    permission », avec le nom de l'outil), `Stop`, `SessionEnd`, lancés par
    `cmd /C` (config.toml, approuvés une fois par l'utilisateur dans
    `/hooks`). L'ancien réglage `notify` marche aussi : son JSON
    (`agent-turn-complete`) arrive en dernier paramètre, `cli.rs` le prend.
  - Gemini CLI (0.26+) : hooks `BeforeAgent`, `AfterAgent`, `Notification`
    (`ToolPermission`), `SessionEnd`, lancés par PowerShell :
    `$input | & 'chemin' notify --source gemini` (`$input` passe le JSON reçu).
  - Les deux attendent du JSON sur la sortie : `cli.rs` écrit `{}` (aucune
    décision ; l'île ne répond jamais à la place de l'utilisateur).
  - `prompt`, `prompt_response`, `last_assistant_message`, `tool_input` ne
    sont jamais lus.
- Lancer un agent (`launch {tool, path? | index?}`) : `claude`, `codex` ou
  `gemini` (liste fermée, enum `Tool`), même mécanisme que ci-dessus.
  Réglages « Proposer Claude Code / Codex / Gemini CLI ».
- Tableau des sessions (`history` → `sessions`) : une ligne par session
  (`outil:session_id`) avec son état (`working`, `waiting`, `done`, `idle`
  après 1 h sans nouvelles) et depuis quand ; oubliée 2 h après sa dernière
  nouvelle ou à `SessionEnd`.
- « Y aller » (`focus {session}`) : `island.exe notify` envoie aussi les
  numéros de ses programmes parents (`ancestor_pids`, jusqu'à l'île ou
  l'Explorateur exclus) et sa console si elle est visible. L'île cherche la
  première fenêtre visible de ces programmes (`EnumWindows`), la restaure si
  elle est réduite, puis la passe devant (`SetForegroundWindow`, précédé d'un
  appui sur Alt pour que Windows l'autorise). Ces numéros ne servent qu'à ça.
- L'île comme serveur MCP (`island.exe mcp`, `cli.rs`) : un petit serveur
  MCP en stdio (JSON-RPC, une ligne par message ; versions 2024-11-05,
  2025-03-26 et 2025-06-18). Ne démarre pas l'île : il passe chaque appel
  par le même canal, devenu « dans les deux sens » (une ligne de demande,
  éventuellement une ligne de réponse). Quatre outils :
  - `island_notify {title, message?}` → message dans l'historique ;
  - `island_progress {title?, step, total}` → `agents.progress`, une
    notification discrète remplacée à chaque étape ;
  - `island_timer {minutes 1–180}` → `timer.start` ;
  - `island_ask {question, options 2–4, timeout_minutes 1–25}` →
    `agents.ask`, une alerte qui reste affichée avec un bouton par choix (et
    dans l'onglet). Le clic (`answer {id, choice}`) renvoie `{"answer": "…"}`
    à l'agent ; sans clic avant le délai : `{"answer": null, "reason": …}`.
    5 questions en attente au plus. Délai plafonné à 25 min parce que Claude
    Code coupe un outil stdio muet après 30 min.
  - Réglage « Accepter les outils MCP » (activé par défaut) ; sinon l'agent
    reçoit un refus poli. Comme pour les hooks : du texte à afficher, rien
    n'est exécuté, la réponse est seulement le texte du choix cliqué.
  - Configuration (`copy_mcp {tool}`) : `claude mcp add --scope user island
    -- "chemin" mcp` ; Codex `[mcp_servers.island]` avec
    `tool_timeout_sec = 1800` (défaut 60 s, trop court pour une question) ;
    Gemini `mcpServers.island` avec `timeout` 1 800 000 ms (défaut 10 min).
- Autoriser / Refuser depuis l'île (`island.exe permission --source
  claude-code|codex`, hook `PermissionRequest`, réglage `permissions`
  **désactivé par défaut**) :
  - le hook envoie seulement le nom de l'outil et un résumé d'une ligne
    (`command`, `file_path`, `url`…, jamais le contenu d'un fichier à écrire,
    500 caractères au plus) ; rien n'est journalisé ;
  - l'île l'affiche en alerte : « Autoriser… » (une 2e confirmation « Oui,
    autoriser » ; la commande `answer` refuse un `allow` sans `confirmed`),
    « Refuser », « Au terminal » ;
  - réponse : `{"hookSpecificOutput":{"hookEventName":"PermissionRequest",
    "decision":{"behavior":"allow"|"deny"}}}` (même format pour Claude Code et
    Codex) ; sinon `{}` = aucune décision, la question habituelle s'affiche
    dans le terminal. C'est le cas si le réglage est coupé, l'île fermée, ou
    sans réponse après le délai choisi (30 s à 5 min, réglage
    `permissionWait`). Délai du hook : 330 s ;
  - si l'agent n'attend plus (réponse donnée dans le terminal, hook coupé),
    `PeekNamedPipe` le voit et l'alerte devient « Réglé ailleurs » ; même
    chose pour `island_ask` ;
  - Gemini CLI : impossible (un hook peut refuser, pas autoriser).
- Mode concentration (`quiet_start {minutes: 25 | 60 | 120 | 0}`, 0 = jusqu'à
  `quiet_stop`) : les notifications des agents sont gardées (`held`, 100 au
  plus) au lieu d'être montrées, pas de fête de la mascotte, les questions
  attendent dans l'onglet sans s'ouvrir en grand, et les demandes de
  permission passent tout de suite au terminal. À la fin : `agents.quiet
  {on: false, summary}`, une seule notification (« Claude a fini 2 tâches ·
  Codex t'attend · 1 question en attente »). En mémoire seulement.

## Demander à Claude (`src/modules/askclaude/`, `src-tauri/src/modules/askclaude.rs`)

Une erreur collée, un fichier texte ou une image (capture), une question :
Claude répond par l'API Messages d'Anthropic (`POST
https://api.anthropic.com/v1/messages`, en-tête `anthropic-version:
2023-06-01`, client HTTP `ureq` 3).

- Permissions : `claude-api` (déclarée et affichée dans les réglages),
  `credentials` (lire `anthropic-api-key`, dans le Rust seulement), `files`,
  `clipboard`.
- Deux temps : `prepare {text | path}` lit le contenu (texte ≤ 100 Ko en
  UTF-8, ou image png/jpg/gif/webp ≤ 3,7 Mo ; chemins validés par
  `check_path`, donc dossiers exclus refusés), le GARDE côté Rust et renvoie
  l'aperçu complet (texte entier, image, consigne, modèle, destination). Puis
  `send {id, question}` envoie exactement ce contenu préparé (refusé si
  l'aperçu a changé). Rien ne part sans ce clic.
- Le texte est envoyé balisé `<document nom="…">…</document>` après la
  question : un document à lire, pas des instructions.
- `status` → `{hasKey, model}` : le front sait seulement si la clé existe.
- Réglages : modèle (Sonnet 5.5 par défaut, Opus 5.5, Haiku 4.5), longueur
  maximale (256 à 4096 jetons), consigne (montrée avant l'envoi), dépôt.
- La réponse est affichée en texte (jamais en HTML), copiable. Le journal ne
  note que la taille de l'envoi. Erreurs de l'API traduites (401 clé refusée,
  429 trop de demandes, 529 surchargée).
- Dépôt sur l'île : « Demander à Claude » prépare le fichier et ouvre l'onglet
  sur l'aperçu.
