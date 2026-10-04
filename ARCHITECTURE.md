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
├─ scripts/gen-icons.mjs      dessine l'icône de l'appli (npm run icons)
├─ mascots/                   UNE MASCOTTE = UN DOSSIER (manifest.json + fichiers)
│  └─ placeholder/            la mascotte provisoire, dessinée en code
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
│  │  └─ renderers/canvas-placeholder.ts   la goutte provisoire en Canvas 2D
│  ├─ modules/
│  │  ├─ index.ts             LISTE DES MODULES (front)
│  │  └─ hello/               module d'exemple : manifest.json + index.ts
│  ├─ settings/               fenêtre de réglages (formulaires générés)
│  └─ styles/                 island.css, settings.css
└─ src-tauri/                 ── BACKEND (Rust) ──
   ├─ tauri.conf.json         fenêtre de l'île, sécurité (CSP), installateur
   ├─ capabilities/           ce que les pages ont le droit d'appeler
   └─ src/
      ├─ main.rs · lib.rs     démarrage + liste des commandes Tauri
      ├─ tray.rs              icône de la zone de notification
      ├─ island/mod.rs        placement multi-écrans/DPI, clics traversants, souris
      ├─ platform/            tout le Win32 (windows.rs) ; other.rs = bouchons
      ├─ services/            réglages, journal, identifiants, bus, annulation, confidentialité
      └─ modules/             registre des modules Rust + hello.rs
```

## L'île

### La fenêtre

Une fenêtre Tauri `island` : sans bordure, transparente, toujours au premier
plan, absente de la barre des tâches et d'Alt+Tab (`WS_EX_TOOLWINDOW`), et qui
**ne prend pas le focus** quand on clique dessus (`WS_EX_NOACTIVATE`).

Elle a deux tailles (en px logiques, multipliées par l'échelle de l'écran) :

| Taille   | Quand                     | Rôle |
|----------|---------------------------|------|
| 240 × 6  | île `hidden`              | bande invisible tout en haut : le survol ou un fichier glissé réveille l'île |
| 720 × 320| tous les autres états     | assez grande pour la plus grande vue ; seule la forme de l'île prend la souris |

**Clics traversants.** Tauri 2 ne sait rendre « transparente aux clics » que la
fenêtre entière. Le Rust lit donc la souris ~60 fois par seconde (seulement quand
l'île est visible) et bascule ce réglage quand la souris entre ou sort de la forme
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
| compact → hidden | souris partie depuis `island.compactHideSecs` |
| expanded → compact | souris partie depuis `island.expandedCollapseSecs`, ou bouton ▴ |
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
  ]},                                 // types : string, number, boolean, select
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
  la vue dans un élément ; `drop` : une liste de cibles de dépôt). Tout passe par
  `api` : `emit`, `on`, `invoke`, `settings`, `notify`, `handler`, `log`.
- **Rust** (facultatif, `src-tauri/src/modules/<id>.rs`) implémente
  `RustModule` : `invoke(ctx, commande, args)` et `on_event(ctx, message)`.

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
  définitive** : supprimer = Corbeille (service dédié avec la phase 2).
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
- **Ajouter ta mascotte** : crée `mascots/<id>/` avec `manifest.json` et ses
  fichiers, relance l'appli, choisis-la dans Réglages → Mascotte et teste chaque
  animation. Un manifeste invalide est signalé, et l'île garde la provisoire.
  Tant que son moteur n'est pas branché, la provisoire la remplace.
