# Architecture d'Ondine

Ondine est une appli Windows 10/11 qui vit en haut au centre de l'écran : une
« île » noire et une icône dans la zone de notification, rien dans la barre des
tâches. Pile : **Tauri 2** (WebView2) + **Rust** pour le système, **TypeScript +
Vite sans framework** pour l'interface.

Plusieurs techniques Windows (fenêtre qui ne prend pas le focus, clics
traversants, glisser-déposer dans WebView2, fenêtre de réglages créée au
démarrage) viennent de [Coucou](https://github.com/Louis-CFM/coucou) (MIT), qui
les a mises au point sur la même pile.

## Arborescence

```
ondine/
├─ README.md                  présentation, téléchargement
├─ CONTRIBUTING.md            lancer, tester, construire
├─ LICENSE · THIRD-PARTY.md   licence MIT, et ce qui vient d'ailleurs
├─ docs/                      ce document, les listes de tests
├─ package.json · vite.config.ts · tsconfig.json
├─ index.html                 page de l'île
├─ settings.html              page de la fenêtre de réglages
├─ annotate.html              page de la fenêtre d'annotation des captures
├─ scripts/gen-icons.mjs      dessine l'icône de l'appli (npm run icons)
├─ scripts/winget-manifests.mjs  refait les manifestes winget d'une version (télécharge l'installateur, SHA-256)
├─ packaging/winget/          manifestes winget prêts (Naod6473.Ondine), pas encore proposés à Microsoft ; README = comment les soumettre
├─ mascots/                   UNE MASCOTTE = UN DOSSIER (manifest.json + fichiers)
│  └─ goutte-gomme/           la goutte gomme, dessinée en code (gum.ts), par défaut ; ses cousines viennent de gum-family.ts
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
│  │  ├─ world-cities.ts · world-time.ts   villes et fuseaux, heure ailleurs (horloges, Lanceur)
│  │  ├─ whats-new.ts         « Quoi de neuf » après une mise à jour (changelog.ts lit CHANGELOG.md)
│  │  ├─ whats-new-mascots.ts les mascottes nouvelles de chaque version (carrousel de l'île)
│  │  └─ log.ts               journal côté front (écrit dans le fichier du Rust)
│  ├─ island/
│  │  ├─ island-state.ts      machine à états de l'île (sans DOM)
│  │  ├─ island.ts            dessin, souris, clavier, glisser-déposer
│  │  ├─ tips.ts              la bulle d'astuce à la première ouverture d'un onglet (règles : tip-state.ts)
│  │  └─ dom.ts               petite aide `el()` pour créer du HTML sans framework
│  ├─ mascot/
│  │  ├─ renderer.ts          contrat MascotRenderer + liste des moteurs
│  │  ├─ mascot-state.ts      machine à états de la mascotte, reliée au bus
│  │  ├─ catalog.ts           trouve et vérifie les mascottes de mascots/
│  │  ├─ types.ts             états, humeurs, format du manifeste
│  │  └─ renderers/            canvas-placeholder.ts, gum.ts, gum-anims.ts, gum-draw.ts, gum-shapes.ts, poses.ts, spritesheet.ts, overlays.ts
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
│  │  └─ weekly/              Bilan de la semaine (sans onglet)
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
      ├─ services/            réglages, journal, identifiants, bus, annulation, confidentialité, fichiers, ics, réseau local
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
visible (~30 fois au calme : souris immobile depuis 250 ms ou à plus de 200 px
de l'île, voir `poll_interval` ; ces rythmes suivent le mode de performance, voir « Modes de performance »), et bascule ce réglage quand la souris entre ou sort de la forme
de l'île, que le front lui envoie à chaque changement (`island_set_rect`). Pendant
qu'un bouton de souris est enfoncé au-dessus du panneau, tout le panneau prend la
souris : sinon Windows ne verrait pas l'île comme cible d'un glisser-déposer.

**Focus.** L'île ne prend le focus clavier que dans l'état `expanded` (ouvert par
un clic ou par le menu) : c'est ce qui permet à Échap de fonctionner. En sortant
de `expanded`, le focus est rendu à la fenêtre qui l'avait avant.

**Clavier et lecteurs d'écran.** Les onglets de l'île ouverte sont une liste
d'onglets ARIA (`tablist` / `tab` / `tabpanel`) : Tab entre sur l'onglet actif
puis passe à ⚙, ▴ et au contenu ; ← → (Début, Fin) déplacent le focus d'un
onglet à l'autre, Entrée ou Espace l'ouvre. Ouverte par le raccourci clavier,
l'île met le focus sur l'onglet actif. Un bouton-icône avec une bulle (`title`)
reçoit cette bulle comme nom (`aria-label`, voir `el()` dans dom.ts). Le focus
clavier est entouré de la couleur d'accent du thème (`:focus-visible`).

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

Les tailles de chaque état sont écrites dans `island.css`, mais le passage de
l'une à l'autre est fait par des ressorts en JS (`src/island/jelly.ts`, voir
« Les animations »). Quand l'île se cache, la fenêtre ne redevient une bande
qu'une fois les ressorts posés (au plus tard après 1,5 s).

### Les animations

- **Forme de l'île : une gelée à ressorts** (`src/island/jelly.ts`, calculs
  purs dans `spring.ts` et `contour.ts`, testés par `tests/front/jelly.test.ts`).
  - *Qui décide de la taille* : toujours le CSS (états, bords, `:has()` de
    l'alerte, `--fit-h`). `Jelly.retarget()` retire un instant ses styles en
    ligne, lit la taille voulue (`getComputedStyle`), les remet (rien n'est
    dessiné entre les deux). Il est appelé par `render()`, `applyFit()`,
    `applySettings()`, et par un `MutationObserver` (classe et `data-privacy`
    de l'île, `data-edge` / `data-align` / classe de `<body>`) ; en alerte,
    aussi quand le contenu change. `island.css` n'anime donc plus `width`,
    `height`, `border-radius` ni `padding` (une transition fausserait la lecture).
  - *Ressorts interruptibles* : 10 ressorts (largeur, hauteur, 4 marges,
    4 arrondis) avec position ET vitesse : un nouvel état en route ne change
    que la cible, l'île repart avec son élan. L'épaisseur (la hauteur en haut
    de l'écran) mène et dépasse un peu, la longueur suit : à l'ouverture l'île
    est d'abord haute et fine, à la fermeture elle s'aplatit encore large.
    En plus, un écrasement à volume constant selon la vitesse de l'épaisseur
    (`scale`, au plus 10 %, attaché au bord de l'écran).
  - *Survol* (mini-île) : elle grandit de 2,5 px (vraie taille, sans découpe)
    et se décale de 1,5 px vers la souris.
  - *Clic* (hors boutons et champs) : le bord le plus proche s'enfonce tant
    que le bouton est enfoncé, puis une onde fait le tour : le contour est
    une chaîne de 96 ressorts reliés à leurs voisins (`EdgeChain`), dessinée
    en `clip-path: path(…)`. Les points collés au bord de l'écran sont épinglés.
  - *Étirement* (bord intérieur, `gestures.ts`) : une bosse sort sous la
    souris, suit la souris le long du bord et penche au-delà du bout de
    l'île, puis revient en rebondissant. La boîte est agrandie du côté
    intérieur (compensé par le `padding` : le contenu ne bouge pas) pour
    laisser sortir la bosse dans la découpe.
  - *Alerte* : choc (creux au milieu du bord intérieur, onde, petit tassement).
  - *Pourquoi `clip-path`* : fond, transparence du thème Verre, reflet,
    contenu restent tels quels, simplement rognés (un SVG ou un canvas
    obligerait à redessiner chaque thème ; un `mask-image` coûterait une image
    par image). Une découpe ne fait que retirer : les crêtes de l'onde
    deviennent un léger gonflement global (`scale`). Pas de découpe au repos
    ni au survol (le liseré du thème Verre, une ombre intérieure, resterait
    rogné).
  - *Réglage* Réglages → Apparence → « Élasticité de l'île » :
    `island.elasticity` = `soft` (Doux), `normal`, `jelly` (Gelée) ; règle
    raideur, amortissement, écrasement et amplitude (`FEELS` dans spring.ts).
    En Studio, un peu plus de rebond (sauf le grand panneau).
  - *Performance* : une seule boucle `requestAnimationFrame`, qui s'arrête
    quand tout est posé (au repos : aucun calcul, plus aucun style en ligne).
    En éco, 30 images/s. Réduire les animations : la forme est prise tout de
    suite, aucune déformation.
  - *Ce qui attendait la fin des transitions* : la fenêtre qui redevient une
    bande (`islandSetCollapsed(true)`) et le panneau haut rendu
    (`islandSetTall(false)`) attendent `Jelly.whenSettled()` (au plus
    `SETTLE_FALLBACK_MS` = 1,5 s) ; le rectangle des clics traversants est
    envoyé à chaque changement de taille (`ResizeObserver`) et une dernière
    fois quand tout est posé (`onSettle`, échelle comprise).
  - *Réactions de la mascotte* : island.ts appelle, si le moteur la propose,
    `MascotRenderer.react?(kind, data)` avec `poke` (appui), `stretch` (on
    tire, `amount` px), `release` (on lâche), `shake` (allers-retours
    rapides pendant qu'on tire, `ShakeDetector`) ; `x`, `y` en px depuis le
    centre de la mascotte.
  - *Le saut de l'île* (`hop` dans island.ts) : une alerte qui arrive fait
    décoller l'île du bord (7 px, propriété `translate`, 420 ms) ; une
    notification normale en mini-île, moitié moins. Rien avec « Réduire les
    animations », en économie d'énergie ni en Classique sans animations. En
    mini-île, la bulle du titre du module Musique ondule tant que ça joue
    (classe `playing` sur `.media-compact`, `@keyframes media-bob`), avec les
    mêmes exceptions (`body[data-perf="eco"]`).
- **Arrivée du contenu** quand l'état change : les onglets puis les morceaux de
  la vue passent de flous à nets l'un après l'autre (`src/island/motion.ts`).
- **Deux intensités** (Réglages → Apparence → Animations) : « Classique » joue
  les effets de `motion.ts` en douceur, « Studio » (classe `motion-studio` sur
  `<body>`) les joue plus franchement. Effets : icône d'onglet qui vole, titres
  révélés, chiffres qui roulent, listes qui glissent (FLIP), boutons gélatine,
  notification qui sort de la pilule, reflet sous la souris, anneaux et barres
  qui se dessinent. Les mêmes servent dans la fenêtre des Réglages.
- **L'île qui s'adapte au contenu** (`src/island/fit.ts`) : un contenu à
  montrer en entier (un QR code) porte l'attribut `data-island-fit` ; l'île
  ouverte grandit alors juste assez (jusqu'à 480 px, variable CSS `--fit-h`),
  avec le même ressort, puis reprend sa taille quand il s'en va. La fenêtre
  passe d'abord au panneau haut (`island_set_tall`, 720 × 530).
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
  "tip": "Cliquez sur « Saluer » pour dire bonjour.",   // module à onglet : la bulle de la 1re ouverture
  "permissions": [],                  // files, clipboard, network, claude-api, credentials
  "settings": { "version": 1, "fields": [
    { "key": "name", "type": "string", "label": "Ton prénom", "default": "Simon" }
  ]},                                 // types : string, number, boolean, select, folders, files,
                                      // calendars, secret (jamais dans les réglages : coffre Windows)
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
  ramenée à quelque chose de valide (bornes, options) avant usage. Un champ
  `string` peut ajouter `"check": "cities"` (vérifications nommées de
  `src/settings/field-checks.ts`) : un avertissement s'affiche sous le champ.
  Un champ `"essential": true` (1 à 3 par module) reste visible en mode Simple
  de la fenêtre de réglages (voir « Fenêtre de réglages : mode Simple / Complet »).

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
| `task.started` / `task.finished` / `task.failed` | modules | working / success (sinon celebrate) / error (sinon annoyed) |
| `claude.thinking` / `claude.done` | modules Claude (phase 8) | thinking / idle |
| `notify.alert` / `notify.alert-end` | île | alert |
| `notify.shown` `{moduleId, icon, priority}` | île | petite réaction : Agenda → worried, ⚠️ → warning, 📋 → wink, 🎵 ✅ 🧺 → happy, 💬 → info (au plus une toutes les 4 s, pas pendant une tâche) |
| `agents.quiet` `{on: true}` | agents | calm |
| `mascot.clicked`, `mascot.hover-long` | île | annoyed, dizzy / love |
| `mascot.play` `{animation}` | réglages | joue une animation |
| `mascot.emote` `{emotion}` | tout module | montre cette émotion (un état, ex. `sad`), si la mascotte l'a |
| `agents.ask`, `agents.event` « waiting » | Agents IA | question (la goutte violette et son « ? ») |
| `mascot.state` | mascotte | |
| `mascot.dance` `{on}` | surprises (src/eggs/) | elle danse en boucle (musique + mini-île) ; les autres réactions passent puis la danse reprend |
| `shelf.downloaded`, `timer.done`, `clipboard.link-cleaned`, `capture.done`, `controls.usb-ejected`, `system.disk-low` | modules | une courte réaction de la mascotte (voir « La famille gomme ») |
| `agents.ask` / `agents.ask.closed` | Agents IA | la pancarte « ? » tant qu'une question est ouverte |
| `easter.word` `{word}` | Lanceur (mot magique + Entrée) | une surprise : `code-rain`, `retro`, `barrel-roll`, `answer` |
| `easter.snack` | réglages (bouton « Essayer ») | Ondine mange la mini-île au prochain passage en mini |
| `undo.offered` / `undo.done` / `undo.expired` | service d'annulation | bouton « Annuler » |
| `module.crashed` | Rust | l'île prévient |
| `shelf.changed` `{items}` | Étagère (Rust) | la vue de l'étagère se redessine |
| `media.changed` `{playing, artwork}` | Musique (Rust) | la pilule et l'onglet Musique se mettent à jour |
| `capture.done` `{action, ok, result, error}` | Capture (Rust) | notification ; l'onglet redemande le texte lu (`last`), qui n'est pas dans le message |
| `shelf.add` `{paths}` | Capture (Rust) | l'Étagère valide les chemins et les pose sur l'étagère |
| `clipboard.changed` `{count}` | Presse-papiers (Rust) | l'onglet redemande la liste (le message ne contient aucun texte copié) |
| `timer.done` `{title}` | Minuteur (front) | (la notification et le son sont faits par le module) |
| `timer.focus` `{on}` | Minuteur (front), mode concentration | l'île met ses notifications en attente pendant une séance de travail Pomodoro (sauf « critical » et celles du Minuteur), puis un résumé |
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
| `remote.changed` `{favorites: [{id, name, kind, wake}]}` | Accès distants (Rust, et front au démarrage) | le Lanceur met à jour ses serveurs (sans les adresses ni les MAC ; `wake` = a une adresse MAC) |
| `remote.connect` `{id}` | Lanceur (front) | Accès distants ouvre ce favori |
| `remote.wake` `{id}` | Lanceur (front) | Accès distants envoie le paquet Wake-on-LAN de ce favori |
| `remote.waking` `{id, name}` | Accès distants (Rust) | paquet parti : notification ⏰, le point du favori « respire » |
| `remote.wake-done` `{id, name, awake, secs, ms?}` ou `{error}` | Accès distants (Rust) | notification « NAS est réveillé » / « ne répond toujours pas » (ou l'erreur) |
| `shelf.phone` `{id, state}` | Étagère (Rust, fil du petit serveur) | « Vers le téléphone » : `sending` (le téléphone télécharge), puis `done` (notification), `expired` ou `stopped` ; le panneau se ferme |
| `agents.event` `{source, kind, title, body, project, at, changes?}` | Agents IA (Rust) | notification (✋ « attend ta permission » en priorité haute, ✅ « a fini », avec le bilan git `changes` s'il y en a un) et historique |
| `agents.projects` `{tools, projects: [{index, name}]}` | Agents IA (Rust) | le Lanceur propose « Claude Code · projet », « Codex · projet »… |
| `agents.launch` `{tool, index?}` | Lanceur (front) | Agents IA ouvre cet agent dans ce projet |
| `notes.open` `{kind: "note"\|"todo", id}` | Lanceur (front, recherche dans l'île) | l'onglet Notes s'ouvre sur cette note (éditeur) ou cette tâche (mise en avant) |
| `agents.changed` | Agents IA (Rust) | l'onglet redessine le tableau des sessions |
| `agents.ask` `{id, kind, who, question, detail, options, session, until}` | Agents IA (Rust : outil MCP ou permission) | alerte avec un bouton par choix (permission : Autoriser… / Refuser / Au terminal) |
| `agents.ask.closed` `{id, expired, gone}` | Agents IA (Rust) | remplace l'alerte par « Réponse envoyée », « Pas de réponse » ou « Réglé ailleurs » |
| `agents.progress` `{source, who, title, step, total}` | Agents IA (Rust, outil MCP) | notification « 3/7 » remplacée à chaque étape |
| `agents.quiet` `{on, summary?}` | Agents IA (Rust) | début / fin de la concentration ; à la fin, la notification du résumé |
| `claude.thinking` / `claude.done` | Agents IA (Rust) | la mascotte réfléchit tant qu'une session de Claude Code travaille |
| `agents.github-streak` `{days, stage}` | Agents IA (front) | série GitHub de 7, 30 ou 100 jours : la mascotte fête (`starstruck`) et un trésor entre au carnet (eggs.ts) |
| `capture.pick` | Lanceur (front) | Capture ouvre la pipette |
| `capture.color` `{ok, hex, text, error?}` | Capture (Rust) | notification « #3A7BD5 copié » ; l'onglet redemande l'historique (`colors`) |
| `agenda.join` `{key, minutes}` | Agenda (Rust) | alerte « Réunion dans 2 min : … » avec « Rejoindre » (une fois par réunion en ligne) |
| `media.pause` | Agenda (Rust, « Rejoindre ») | Musique met en pause ce qui joue (rien si c'est déjà en pause) |
| `controls.mic-set` `{muted}` | Agenda (front, « Rétablir le micro ») | Contrôles coupe ou rétablit le micro, puis publie `controls.mic-muted` (`source: "request"`) |
| `timer.work-session` `{seconds, completed}` | Minuteur (front) | une séance de travail Pomodoro s'arrête (finie, en pause, passée, remise à zéro, module coupé) : Bilan de la semaine ajoute le temps, et un Pomodoro si `completed` |
| `notes.todo-toggled` `{done}` | Notes (Rust) | une tâche cochée (`true`) ou décochée : Bilan de la semaine compte (jamais le texte de la tâche) |
| `weekly.show` | réglages (« Voir le bilan maintenant ») | Bilan de la semaine montre la semaine en cours (`peek`), sans rien consommer |
| `app.whats-new` | réglages (« Voir les nouveautés ») | l'île montre « Quoi de neuf dans Ondine X.Y.Z » pour la version installée |
| `controls.usb-added` `{root, letter, label, removable}` | Contrôles (Rust, fil de fond, réglage `usbNotify`) | notification 🔌 « Clé USB branchée » avec « Ouvrir » et « Éjecter » |
| `controls.usb-ejected` `{root, letter, label, removable, ok, veto?, blocker?, error?, code?}` | Contrôles (Rust, fil d'éjection) | notification ✅ « Vous pouvez retirer la clé E: en toute sécurité. », ou ⚠️ avec qui bloque ; la bande USB de l'onglet se met à jour |
| `shelf.hash-progress` `{job, percent}` | Étagère (Rust, cible « Empreinte ») | la notification « Empreinte SHA-256 : 45 % » (une fois par seconde, au-delà de 64 Mo) |
| `shelf.hashed` `{job, algo, compared, cancelled, results: [{name, hex, matches} ou {name, error}]}` | Étagère (Rust) | notification « Identique ✓ » / « Différente ✗ » ou l'empreinte, avec « Copier » (`hash_copy {job}`) ; le texte copié n'est jamais dans le message |
| `capture.gif` `{state: recording / encoding / done / cancelled / error, …}` | Capture (Rust) | notification avec « Arrêter », puis « Création du GIF… », puis « GIF enregistré » (« Montrer dans l'Explorateur ») ; le bouton de l'onglet suit l'état |

## Services communs (`src-tauri/src/services/`)

- **Réglages** (`settings.rs`) : `%APPDATA%\Ondine\settings.json`, champ
  `version` + fonction `migrate` pour faire évoluer le format ; écriture atomique ;
  un fichier abîmé est mis de côté, jamais effacé ; export dans
  `%APPDATA%\Ondine\exports\`, import depuis Réglages → Sauvegarde (refusé s'il
  vient d'une version plus récente).
- **Identifiants** (`credentials.rs`) : Gestionnaire d'identifiants Windows
  (crate `keyring` 3). Liste fermée de clés (`anthropic-api-key`,
  `github-token`, les liens iCal des agendas). Le front peut
  demander si une clé existe, en enregistrer ou en supprimer une, **jamais** la
  relire. Seul un module Rust avec la permission `credentials` peut la lire.
- **Journal** (`log.rs`) : `%LOCALAPPDATA%\Ondine\logs\ondine.log`, niveaux
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
- **Diagnostic** (`src-tauri/src/diagnostics.rs`) : « Signaler un problème »
  (Réglages → Général → À propos) ouvre dans le navigateur une issue GitHub
  préremplie (`bug.yml` : version, Windows, 40 dernières lignes du journal,
  chemins personnels masqués, adresse de 2000 caractères au plus) ; rien ne part
  sans la personne. Et la mémoire / le processeur d'Ondine et de ses processus
  WebView2 (sysinfo), lus toutes les 2 s seulement quand la fenêtre de réglages
  est visible sur la page Général.
- **Confidentialité** (`privacy.rs`) : aucune télémétrie. `check_path` refuse les
  chemins relatifs, inexistants ou situés dans un dossier exclu (après résolution
  des `..` et des liens). Un module qui envoie du contenu à l'API Claude déclare
  `claude-api` (affiché dans les réglages) et montre ce qui part avant l'envoi.
- **Réseau local** (`lan.rs`) : les adresses IPv4 des cartes réseau en marche
  (crate `sysinfo`, sans 127.0.0.1 ni 169.254.x.x), l'adresse de diffusion d'un
  réseau (`broadcast`), l'adresse de la route par défaut (une « connexion »
  UDP vers 192.0.2.1, adresse de documentation : aucun paquet ne part) et le
  choix de l'adresse privée à donner à un téléphone (`pick_private` : celle de
  la route par défaut si elle est privée et pas virtuelle, sinon une vraie carte
  avant une carte de VPN / machine virtuelle, 192.168 > 172.16 > 10). Utilisé
  par le Wake-on-LAN et « Vers le téléphone ».

## La mascotte

```
bus ──▶ MascotController (mascot-state.ts) ──▶ MascotRenderer (renderer.ts)
             états + règles du manifeste            canvas-code | spritesheet | poses | lottie | rive
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
  alert, eating, celebrate, love, bored, et les émotions de la goutte v2 :
  success, question, error, warning, info, sad, worried, surprise, shy, calm,
  wink, et ceux de la famille gomme : wave, laugh, proud, pout, starstruck,
  mischief, focus, moved, embarrassed, yawn, pensive, cheer. Un état que la mascotte n'a pas retombe sur `fallback` (et le contrôleur
  choisit l'ancien état équivalent quand il y en a un). Humeurs : neutral,
  happy, grumpy, tired.
- **Déclencheurs** : voir le tableau du bus ; plus l'inactivité (bored après
  `mascot.boredAfterSecs`, sleep après `mascot.sleepAfterSecs`) et le réveil
  dès que la souris revient sur l'île.
- **Moteurs branchés** : `canvas-code` (la goutte provisoire, plus utilisée par aucune mascotte mais gardée en secours), `gum` (la goutte gomme dessinée en code, `mascots/goutte-gomme/`)
  et `spritesheet` (aucune mascotte ne l'utilise pour l'instant). Une planche = une ligne d'images de même
  largeur. `"mode": "gaze"` choisit l'image d'après la souris (de la première,
  regard à gauche, à la dernière, regard à droite) et `nearFile` donne la planche
  « de près ». En attendant une vraie planche par état, `effect` (breathe, bounce,
  jump, shake, wobble…) anime le corps par du code et `overlay` (zzz, confetti,
  hearts…) dessine un effet autour.
- **Moteur `poses`** (`src/mascot/renderers/poses.ts` ; les deux gouttes en images qui
  l'utilisaient, `goutte/` et `goutte-classique/`, ont été retirées en 1.2.0, le moteur
  reste pour une mascotte faite d'images) : une
  image 256 × 256 par émotion, toutes cadrées pareil (même ligne de base). Le
  manifeste a une table `poses` : `"joie": { "file": "joie.png", "eyes": [...],
  "blink": "closed" }`. `eyes` = les yeux blancs (centre et rayons) où le code
  dessine les pupilles qui suivent la souris ; `blink` = la pose montrée quand
  la paupière arrive en bas. Une animation choisit `"pose"`, ou `"poses"` +
  `"poseMs"` pour une suite (agacée → colère), et peut ajouter `"look"` (`up`,
  `spin`), `"wide"`, `"variants"` (au repos, une variante passe de temps en
  temps) et `"fadeMs"`. Une animation dessinée image par image (bulle, glitch,
  danse…) est une suite de poses `"poses": ["danse-1", …]` : en boucle si
  l'animation boucle, avec un fondu court (≈ 40 % de `poseMs`) entre deux images. Changer de pose = un **fondu** (280 ms par défaut) : les
  deux images sont mélangées en mode `lighter` dans un calque hors écran, ce qui
  donne un vrai mélange de couleurs. Avec « réduire les animations », le corps
  ne bouge plus et les yeux ne clignent plus, mais le fondu reste.
- **Ajouter ta mascotte** : crée `mascots/<id>/` avec `manifest.json` et ses
  fichiers, relance l'appli, choisis-la dans Réglages → Mascotte et teste chaque
  animation. Un manifeste invalide est signalé, et l'île garde la provisoire.
  Tant que son moteur n'est pas branché, la provisoire la remplace.

### La famille gomme (`src/mascot/renderers/gum*.ts`, `src/mascot/gum-family.ts`)

La goutte gomme et ses cousines (Guimauve, Dragée, Berlingot, étoile, soleil,
lune, nuage, cœur, fleur, champignon, fantôme, flamme, plus « Ciel » et
« Météo ») partagent le manifeste `mascots/goutte-gomme/manifest.json` et le
moteur `gum` ; le catalogue fabrique les cousines à partir de `GUM_FAMILY`
(champ `gum.shape` du manifeste). Quatre fichiers :

- `gum-shapes.ts` : chaque forme est un **contour de N = 96 points** (sens des
  aiguilles d'une montre, premier point en haut, bas à y = 0,94), plus la place
  du visage, des reflets, la hauteur des sauts, le flottement et les décors.
  Tous les contours ayant les mêmes points dans le même ordre, on passe d'une
  forme à l'autre en faisant glisser chaque point (Ciel : soleil de 7 h à 20 h,
  lune la nuit ; Météo : soleil, lune ou nuage avec pluie, neige, orage, d'après
  l'icône de `weather.updated`).
- `gum-anims.ts` : les animations (une fonction par animation : t, p, humeur →
  ce qu'elle demande), traduites en **réglages chiffrés du visage** (`Face` :
  ouverture et courbe des yeux, paupière, sourcils, largeur, courbe et
  ouverture de la bouche, joues gonflées…), les poses des mains, et la gelée du
  contour (`JellyRim` : chaque point est tenu par un ressort et relié à ses
  voisins, une pichenette lance une onde qui s'éteint).
- `gum-engine.ts` : le moteur, sans rien de l'appli : ce qu'il lui faut
  (réglages de couleur et d'accessoires, boucle de dessin, « Réduire les
  animations ») lui est passé dans un `GumEnv`. `gum.ts` le branche sur l'appli
  (`GumRenderer` : settingsStore, `frameLoop` de core/perf.ts, Windows) ;
  `src/mascot/gum-standalone.ts` sur une page web (le site, ci-dessous).
  Rien n'y saute : le visage glisse vers sa cible, les
  yeux spéciaux (cœurs, étoiles, spirales) apparaissent en fondu, l'étirement et
  l'inclinaison suivent un ressort, elle se tasse avant un saut (on regarde
  l'animation 0,1 s plus loin), s'allonge en l'air et s'écrase en retombant, le
  visage traîne un peu derrière le corps, les mains suivent leur pose avec leur
  propre ressort, la couleur passe en fondu. Sans souris, de petits coups d'œil ;
  le clignement se ferme vite et se rouvre lentement. `react()` reçoit ce qui
  arrive à l'île (clic, étirement, lâcher, secousse). Avec « Réduire les
  animations », tout va directement à sa cible.
- `gum-draw.ts` : le dessin (couches de gomme, visage, moufles, accessoires,
  météo) et les teintes (`TINTS`, plus l'arc-en-ciel).

Réglages (Réglages → Mascotte → Style, seulement pour une mascotte gomme) :
`mascot.color` (`auto` = la couleur de la forme, une teinte de `TINTS`,
`rainbow`, ou `custom` = la couleur libre), `mascot.customColor` (`#rrggbb`,
défaut `#4da3ff` ; la roue teinte / saturation de `src/settings/color-wheel.ts`,
avec une glissière de luminosité et la valeur à taper ; `paletteFromHex` dérive
les quatre couleurs de la gomme : reflet plus clair, bas plus foncé avec la
teinte qui glisse, contour), `mascot.hands` (`always`,
`gestures`, `never`), `mascot.wearHead` (cap, straw, tophat, beanie, crown,
bow), `mascot.wearEyes` (round, sun, heart), `mascot.wearNeck` (pearls,
bowtie, scarf).

Ce qu'elle porte en plus (`MascotRenderer.setExtras`, poussé par
mascot-state.ts tant que ça dure) : les moufles sur les oreilles (pose `ears`,
pendant la concentration `agents.quiet`), la pancarte « ? » (pose `sign`, un
accessoire tenu par la moufle droite, d'`agents.ask` à `agents.ask.closed` ;
elle passe devant les poses des animations en boucle, danse comprise, et
s'affiche même sans mains ; un clic sur la mascotte ouvre alors l'onglet
Agents IA, en fermant l'alerte affichée s'il y en a une), le parapluie
(`weather.updated` qui annonce la pluie). Le moteur `poses` montre le « ? »
des effets pour la pancarte ; les autres moteurs ignorent `setExtras`.

Réactions aux modules (mascot-state.ts, courtes, pas pendant une tâche ni le
sommeil, au plus une toutes les 4 s) : `shelf.downloaded` → starstruck,
`timer.done` → cheer (le `task.finished` du minuteur qui suit ne la coupe pas),
`clipboard.link-cleaned` → wink, `capture.done {ok}` → proud,
`controls.usb-ejected` → wave, `system.disk-low` → worried.

Réglages → Mascotte → Apparence → Taille (`mascot.size` : `small`, `normal`,
`large`) : la place de la mascotte dans l'île ouverte (`data-mascot-size` sur
`.island`, island.css : 48 / 64 / 88 px ouverte, 56 / 72 / 92 px en alerte et
dépôt) et l'aperçu des réglages ; la mini-île garde ses 32 px.

Réglages → Mascotte → Humeur → « Calme : moins de gestes spontanés »
(`mascot.calm`, `calmMode()` dans mascot-state.ts). Coupé : l'ennui (elle passe
du repos au sommeil sans bâiller), la bouderie au réveil, les réactions aux
notifications et aux modules, les moufles sur les oreilles et le parapluie,
les émotions qui suivent le PC (processeur, batterie ; l'humeur de fond
reste), la danse et le goûter (src/eggs/eggs.ts), les visites au bord de
l'écran (island.ts). Gardé : réveil, sommeil, travail, réflexion, succès,
erreur, question et pancarte « ? », alerte, repas (dépôt de fichiers), les
réponses aux clics et au survol. Les surprises gardent leur propre réglage
(`mascot.surprises`). Nouveaux déclencheurs : avant de dormir elle bâille (`yawn`),
réveillée deux fois en 5 min elle boude (`pout`), deux clics rapides → `laugh`,
une tâche de plus de 10 min finie → `moved`, nouvelle version ou trésor trouvé →
`starstruck` ; le travail d'un agent joue `concentree` (au clavier) et la
réflexion `pensive` (main au menton).

#### Le site vitrine (`site/`, `src/mascot/gum-standalone.ts`, `vite.site.config.ts`)

La section « Les mascottes » de `site/index.html` dessine les quinze mascottes
en gomme en direct, avec le vrai moteur : `npm run build:site` construit
`src/mascot/gum-standalone.ts` en un seul fichier IIFE sans sourcemap,
`site/media/ondine-gomme.js`, qui est **committé** (GitHub Pages sert `site/`
tel quel). L'API : `OndineGomme.mount(canvas, { shape, anim, color, hands,
reducedMotion, maxFps })` → `{ play(name), pause(on), destroy() }`, plus
`OndineGomme.MASCOTS` (id, nom, forme) et `OndineGomme.GESTURES` (coucou, rire,
danse). Le script n'entraîne ni réglages, ni Tauri, ni core/perf.ts ni l'île
(test `tests/front/whats-new.test.ts`, qui suit les imports). Sur le site :
repos en boucle à 30 images/s au plus, en pause hors de l'écran
(IntersectionObserver), un geste à tour de rôle au survol ou au toucher ; sans
JavaScript, l'image fixe `site/media/mascottes/<id>.png` (256 px, fond
transparent, générée avec Playwright depuis le script construit) reste
affichée. Le site est en français et tutoie.

### Ondine sur le bureau (`src-tauri/src/pet.rs`, `src/pet/`, `pet.html`)

Une quatrième fenêtre, « pet », créée cachée au démarrage comme les autres
(mêmes BROWSER_ARGS) : sans bordure, transparente, hors de la barre des
tâches, au-dessus des fenêtres ou derrière (`mascot.petOnTop`). Elle est
montrée quand `mascot.enabled && mascot.pet` (`pet::apply`, au démarrage et
dans `apply_settings`). Deux tailles : la case de la mascotte (112 × 112) ou,
bulle ouverte, la case dans un coin et la bulle (420 × 480) du côté où l'écran
a de la place (`choose_layout`) ; la mascotte ne bouge pas à l'écran, seule la
fenêtre s'agrandit autour d'elle. Le Rust annonce le côté par l'événement
`pet-layout` avant de changer la fenêtre.

- **Déplacer** : un appui suivi d'un mouvement sur la mascotte appelle
  `pet_drag_start` ; un thread fait suivre la souris à la fenêtre (bulle
  comprise) jusqu'au lâcher, enregistre la place (`mascot.petX/petY`, px
  physiques du coin de la case, négatif = en bas à droite de l'écran
  principal), replace la bulle si besoin, puis envoie `pet-drag-end`.
- **Sortir de l'île** : dans l'île, tirer la mascotte hors de la forme puis la
  lâcher appelle `pet_place(atCursor)` (island.ts, `wireCarry`). `pet_back`
  la ramène (bouton ⤒ de la bulle, bouton 💧 de l'île ouverte). Portée
  au-dessus de l'île (`island::screen_point_on_island` : sa forme, ou la
  bande de réveil avec une marge), le Rust envoie `pet-over-island` (l'île se
  montre, la mascotte rapetisse) ; lâchée là, elle rentre.
- **Présentation, plein écran** : la boucle de la souris regarde toutes les
  2 s `presentation_busy` et cache la fenêtre le temps qu'il faut.
- **Aimant** : au lâcher, `snap` colle la case aux bords de la zone de travail
  (`Monitor::work_area`, barre des tâches exclue) à moins de 36 px, la case
  dépassant de 10 px pour que la gomme soit assise sur le bord.
- **Promenade** (`spawn_wander`, `mascot.petWander`) : toutes les 20 s, si
  personne n'a touché le PC depuis 90 s (pas bulle ouverte, ni présentation,
  ni « Calme »), quelques pas horizontaux (`pet-walk` → dandinement en CSS) ;
  le moindre geste l'arrête, la place est enregistrée.
- **Raccourci** (`mascot.petHotkey`, Ctrl+Alt+B par défaut, `pet::HOTKEYS`) :
  enregistré seulement quand elle est sur le bureau ; envoie `pet-hotkey`.
- **Menu de l'icône** : la case « Ondine sur le bureau » (`tray::sync_pet`).
- **Fichiers lâchés sur elle** : la cible de dépôt Windows de l'île
  (`drop_target.rs`) est posée aussi sur sa fenêtre (`unblock_window_drops`).
  La page publie `pet.files-dropped` ; l'île, qui a les cibles des modules,
  répond `island.drop-choices` (libellés), la bulle les propose, et le choix
  revient par `pet.drop-choice` : l'île fait le dépôt.
- **Pastille** : `notify.shown` / `notify.alert` (publiés par l'île) mettent
  une pastille sur elle ; un clic publie `island.open`.
- **Clics traversants** : la page envoie les cases de la mascotte et de la
  bulle (`pet_set_hit`) ; `spawn_hit_poll` lit la souris (30 fois par seconde
  près d'elle, 8 loin) et bascule `set_ignore_cursor_events`, rien ne change
  bouton enfoncé. Il envoie aussi la souris à la page (`pet-cursor`) pour que
  ses yeux la suivent.
- **Les onglets** : un second `ModuleRegistry`, en mode satellite
  (`{ satellite: true, only }`), ne démarre que les modules de
  `mascot.petTabs`, et par leur `satellite(api)` au lieu de `setup(api)` :
  seulement ce qu'il faut aux vues (Lanceur : les listes de projets et de
  serveurs ; Agents IA : se redessiner sur `agents.changed`). Les
  notifications de fond restent à l'île ; celles des vues (« Copié ») sont
  une ligne en haut de la bulle. `api.openIsland(tab)` vers un onglet absent
  de la bulle publie `island.open`, que l'île écoute. Les conversations et
  listes vivent dans le Rust : les deux fenêtres montrent la même chose.
- **La mascotte** : un `MascotController` sur le même bus que celle de l'île
  (humeurs, fêtes, sommeil). L'île n'a plus de mascotte (ni de visite au
  bord) tant qu'Ondine est sur le bureau ; la danse (`syncDance`, eggs.ts) se
  lance aussi quand elle est sur le bureau, même île cachée.

## Les surprises (`src/eggs/`)

Des easter eggs, tous dans l'île, sans fichier ni réseau. `eggs.ts` relie les
déclencheurs aux effets ; le réglage `mascot.surprises` (`all`, `seasonal`,
`none`) les filtre, rien ne se montre pendant une présentation, et avec
« réduire les animations » ou en économie d'énergie Ondine réagit (une
émotion) sans les grands effets.

| Déclencheur | Effet |
|---|---|
| Lanceur : « réveille-toi », « wake up » + Entrée | pluie de code (`fx-layer.ts`), Ondine bugge (`pluie-glitch`) puis esquive au ralenti une goutte (`esquive`, effet `dodge`) |
| Code Konami (île ouverte), ou « rétro » | mode 8 bits jusqu'à ce que l'île se cache : Ondine en gros pixels (`mascot-fx.ts`), sons en onde carrée, `body.retro` |
| 15 clics rapides sur Ondine | elle se divise en deux gouttes puis se recolle (filtre SVG « goo » : flou + seuil) |
| 2 tours de souris autour d'elle | le tournis (`etourdie`) |
| « tonneau », « barrel roll » | l'île fait un tour complet |
| « la réponse » | Ondine réfléchit, puis « 42 » |
| Mini-île tranquille (au plus toutes les 20 min, une chance sur 4 toutes les 30 s) | « le goûter » : elle traverse la mini-île en mangeant le contenu (`clip-path`), revient, le contenu réapparaît |
| Musique + mini-île | elle danse tant que ça joue (`mascot.dance`) |
| Calendrier (`calendar.ts`), à l'ouverture, une fois par jour | 1/1 et 14/7 feux d'artifice, 14/2 cœurs, 1/4 poisson en papier dans le dos (tombe au clic), 21/6 trésor de la danse, 31/10 fantôme, décembre neige qui s'entasse ; Météo : pluie (éclaboussures), canicule (`fondue`) |

- **Réactions au PC** (`context.ts`, permises sauf avec « Surprises : aucune ») :
  3 agents IA au travail → baguette de cheffe d'orchestre ; un agent qui finit
  après plus d'une heure → victoire ; 2 h – 6 h → bonnet de nuit et, une fois
  par nuit, « Il serait temps de dormir, non ? » ; PC allumé depuis plus de 7
  jours → toile d'araignée (`.egg-web`) ; 100e capture → flash ; vendredi dès
  17 h → lunettes de soleil ; lundi 8 h 30 – 10 h 30 → café ; volume à 100 % →
  mains sur les oreilles ; batterie ≤ 2 % débranchée → panique, puis
  soulagement au branchement ; même texte copié 5 fois → « C'est bon, je l'ai ! ».
  Les données viennent des modules (`Bridge.moduleInvoke`), seulement s'ils sont
  activés. Les accessoires sont dessinés en code par `MascotFx`.
- **Calques** : `FxLayer` pose un canvas sur toute l'île le temps d'un effet ;
  `MascotFx` pose un canvas plus grand que la mascotte et recopie à chaque image
  `canvas.mascot-canvas` (n'importe quel moteur), transformé. Rien ne tourne
  entre deux surprises.
- **Carnet des trésors** (`treasures.ts`) : chaque surprise trouvée est ajoutée
  à `mascot.treasures` (vérifié par le Rust) et annoncée une fois ; la page
  Mascotte des réglages montre le carnet (noms trouvés, indices pour les autres).
- Les animations propres à une surprise (`pluie-glitch`, `esquive`, `fondue`)
  sont lues dans le manifeste de la mascotte ; une mascotte qui ne les a pas
  (la famille gomme) montre une émotion à la place.

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
- **Par élément** : 📂 Montrer dans l'Explorateur, 📄 Copier vers…, 📦 Déplacer
  vers… (mêmes commandes `copy_to` / `move_to`, donc même annulation), 📋,
  📱 Vers le téléphone (fichiers seulement, voir plus bas), 🗑️, ×.
- **Sortir un élément en le glissant (Windows)** : appuyer sur une ligne puis
  bouger de 6 px appelle `drag_out`. Le Rust (`platform/drag_out.rs`) crée un
  objet de données du Shell (`SHCreateDataObject` avec les PIDL des fichiers)
  et lance `SHDoDragDrop` sur le thread principal (`run_on_main_thread`), avec
  une petite `IDropSource` (Échap annule, bouton relâché = lâcher). C'est la
  cible qui copie ou déplace (règles habituelles : même disque = déplacer,
  Ctrl = copier, Maj = déplacer) ; Ondine ne touche à rien. Après le lâcher,
  ce qui n'existe plus quitte l'étagère, puis on revérifie pendant ~2 min
  (l'Explorateur finit parfois le déplacement après coup). Pendant le glisser,
  la boucle de souris de l'île rend la fenêtre traversante partout sauf sur
  l'île et n'envoie plus la position (l'île ne se replie pas), et la cible de
  dépôt de l'île refuse ce qui vient d'elle-même. Désactivé en mode démo.
- La boîte « Choisir un dossier » est la commande `dialog_pick_folder`
  (plugin officiel `tauri-plugin-dialog`), appelée depuis le Rust uniquement :
  les pages n'ont pas accès au plugin directement.
- **📱 Vers le téléphone** (`shelf_phone.rs`, front `phone.ts` ; permission
  `network`) : sur un fichier de l'étagère (`phone_share {path}`, chemin validé
  et présent sur l'étagère). Le Rust choisit l'adresse privée du PC
  (`services/lan.rs` ; aucune → refus avec un message clair), ouvre un
  `TcpListener` (std, aucune crate) sur cette adresse et un port donné par
  Windows, et tire un jeton de 128 bits (`getrandom`). Seule l'adresse
  `http://IP:port/<jeton>/<nom encodé>` sert le fichier (GET ; HEAD = en-têtes
  seulement ; autre méthode = 405) ; toute autre adresse = 404 vide, une demande
  illisible = 400. Comparaison du jeton en temps constant ; nom trop long →
  `fichier.ext` dans l'adresse (le vrai nom part dans `Content-Disposition:
  attachment`). Envoi par morceaux de 64 Ko (gros fichiers), un fil par
  connexion (8 au plus). « Téléchargement complet » = tout écrit ET le
  téléphone ferme proprement la connexion (une annulation la réinitialise).
  Fin : un téléchargement complet, 5 minutes (un envoi commencé peut finir) ou
  `phone_stop` ; un nouveau partage arrête le précédent. Le fil prévient par
  `shelf.phone` `{id, state}`. L'île montre le QR code (`clipboard_qr.rs`,
  mêmes classes CSS que le Presse-papiers), l'adresse, le compte à rebours et
  « Arrêter » ; `phone_status` le retrouve si l'île redémarre. Le journal ne
  contient ni l'adresse ni le jeton. Pare-feu : Windows demande la première
  fois d'autoriser Ondine (réseaux privés).
- **Empreinte** (cible de dépôt, réglage `showHash` ; `src/modules/shelf/hash.ts`,
  `src-tauri/src/modules/shelf_hash.rs`) : `hash {paths}` calcule dans un thread
  (fichiers seulement, 5 au plus, un calcul à la fois), en lisant par blocs de
  1 Mo ; crates RustCrypto `sha2`, `sha1`, `md-5` (testées sur des vecteurs
  connus). Si le presse-papiers (lu par le Rust, jamais s'il est marqué
  sensible) contient une empreinte hexadécimale (32/40/64/128 chiffres → MD5,
  SHA-1, SHA-256, SHA-512 ; aussi dans une liste sha256sum ou certutil), le
  même algorithme est calculé et comparé ; sinon SHA-256. Résultat par
  `shelf.hashed`, progression par `shelf.hash-progress`, `hash_cancel` pour
  « Arrêter », `hash_copy {job}` recopie le résultat (une ligne `empreinte  nom`
  par fichier). La notification utilise `tone` (titre vert / rouge) et `wide`
  (île plus grande pour l'empreinte entière) de `api.notify`.

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
- **Mettre en pause** (`media.pause`, publié par l'Agenda quand on rejoint
  une réunion) : si quelque chose joue, un fil appelle `TryPauseAsync` sur la
  session SMTC en cours.

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
- **Épinglés et snippets** : enregistrés dans `%APPDATA%\Ondine\clipboard.json`
  (écriture via un fichier temporaire renommé). Un fichier abîmé est mis de
  côté, jamais effacé.
- **Coller** : le Rust met le texte dans le presse-papiers, rend le clavier à la
  fenêtre d'avant l'île (`set_activating(false)`), attend 150 ms, vérifie que
  la fenêtre au premier plan n'est pas l'île, puis simule Ctrl+V (`SendInput`).
  « Coller sans mise en forme » remet le texte actuel seul (les formats riches
  disparaissent) avant de coller.
- **Annuler** : retirer une copie, vider l'historique (les épinglés restent) et
  supprimer un snippet proposent « Annuler ».
- **QR code** (bouton ▦ d'une copie) : `clipboard_qr.rs` calcule la grille avec
  le crate `qrcode` (sans ses options d'image), la dessine en SVG (affiché dans
  l'île, data URL) ou en pixels (« Copier l'image », ~512 px, via arboard).
  Niveau de correction M, 1 000 caractères au plus (au-delà, le code serait
  trop serré pour un téléphone) : message clair sinon. Aucun service en ligne.
- **Décoder** (`src/modules/clipboard/decode.ts`, TypeScript pur, testé dans
  `tests/front/clipboard-decode.test.ts` avec beaucoup de faux positifs) :
  `detect` reconnaît sur l'aperçu un horodatage Unix (10 ou 13 chiffres, entre
  2000 et 2050), un JWT (`alg` dans l'en-tête), du JSON, du texte en `%xx`, ou du
  Base64 strict (standard ou URL) qui donne du texte UTF-8 lisible ; la ligne
  montre alors « Décoder », « Mettre en forme » ou « Lire la date ». Au clic, le
  front demande le texte entier (`full {id}`), `decode` le met en forme (JSON
  réindenté sans perdre les grands nombres, dates locale / UTC / ISO) et
  l'onglet l'affiche (`data-no-i18n`), avec « Copier » (`copy {text}`). Rien
  n'est journalisé ; les erreurs ne citent jamais le texte.
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
  `Images\Ondine` (dossier connu `FOLDERID_Pictures`, OneDrive compris). Le
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
- **Pipette** (`pick_color`, ou `capture.pick` depuis le Lanceur) : l'île se
  replie (450 ms), puis `platform/picker.rs` photographie tout le bureau
  (`BitBlt` + `CAPTUREBLT` depuis l'écran, tous les écrans) et l'affiche dans
  une fenêtre **Win32** (pas WebView2) sans bordure, au-dessus de tout, de la
  taille du bureau virtuel : l'écran a l'air figé. Le fil est en
  `PER_MONITOR_AWARE_V2` : tout est en pixels physiques, donc le pixel lu est
  bien celui sous la croix, même avec des écrans à 100 % et 150 %. Curseur en
  croix (`IDC_CROSS`), loupe 11 × 11 pixels agrandis (taille selon l'échelle
  de l'écran, placée de l'autre côté près d'un bord) avec pastille et
  `#RRGGBB`. Clic gauche ou Entrée = choisir (au relâchement : rien n'arrive à
  la fenêtre d'en dessous), Échap, clic droit ou perte du focus = annuler,
  flèches = bouger d'un pixel ; fermeture automatique après 2 minutes. La
  couleur est lue dans la photo (la loupe ne peut pas s'y retrouver).
  Pourquoi pas une page : une fenêtre WebView2 créée tard peut rester blanche,
  la photo pèserait des dizaines de Mo à envoyer, et une page étalée sur des
  écrans d'échelles différentes n'a qu'une échelle. La photo est effacée à la
  fermeture. Couleur copiée en HEX, RGB ou HSL (réglage `colorFormat`, calculs
  testés dans `modules/capture/color.rs`) ; historique des 8 dernières
  (sans doublon) dans `%APPDATA%\Ondine\colors.json`, pastilles cliquables
  dans l'onglet (`colors`, `copy_color {hex}` : seule une couleur `#RRGGBB`
  est acceptée).
- **GIF animé** (`gif_start {hint}`, `gif_stop`) : l'outil de capture de Windows
  ne dit pas où est la zone choisie, donc `platform/record.rs` ouvre sa propre
  sélection, sur le modèle de la pipette (photo du bureau assombrie, zone tracée
  claire avec sa taille ; clic seul ou Entrée = tout l'écran ; Échap, clic droit,
  perte du focus = annuler ; l'aide est traduite par le front). Puis, dans le
  même fil : `Grabber` copie la zone 10 fois par seconde (`BitBlt`, ou
  `StretchBlt` en `HALFTONE` si elle dépasse 960 px ; sans `CAPTUREBLT`, qui
  ferait clignoter la souris), dessine la souris (`GetCursorInfo`,
  `DrawIconEx`) ; `Outline` pose un cadre rouge à l'extérieur de la zone
  (fenêtres traversantes) ; l'île est retirée des captures
  (`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, sur le fil principal).
  Un deuxième fil écrit le GIF (`modules/capture/gif.rs`, crate `gif`, testé) :
  seul le rectangle qui a changé est écrit (`DisposalMethod::Keep`), une palette
  par image (NeuQuant), délais tirés de l'heure réelle des images (une image
  sautée si l'écriture prend du retard ne décale pas le rythme). Fichier
  `Capture … .gif` dans le dossier des captures, `shelf.add`, « Annuler »
  (Corbeille) ; un GIF raté part à la Corbeille. Étapes publiées sur
  `capture.gif`. Réglages `gifSeconds` (10 s, de 2 à 30) et `gifCursor`.
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
- Mode concentration (réglage `focusQuiet`, activé par défaut) : pendant une
  séance de travail Pomodoro qui tourne, `timer.focus {on: true}` ; l'île met
  la file de notifications en pause (raison « focus », `NotificationQueue.pause`
  accepte plusieurs raisons qui se chevauchent, comme le mode présentation),
  en laissant passer les « critical » et celles du Minuteur. Pause, passer,
  réinitialiser, fin de séance ou module coupé : `{on: false}`, résumé
  « N notifications pendant ta concentration ». « Ne pas déranger » de Windows
  n'est PAS activé : pas d'API publique fiable (FocusSessionManager est une
  fonction à accès limité, la clé de registre des notifications n'est relue
  qu'au redémarrage du service, WNF n'est pas documenté).
- Bilan de la semaine : chaque séance de travail Pomodoro qui s'arrête publie
  `timer.work-session {seconds, completed}`. `seconds` = ce que le compte à
  rebours a avancé depuis le départ (ou la reprise) : un PC en veille pendant
  la séance ne compte jamais plus que la séance. `completed` seulement à la
  fin naturelle d'une séance de travail (pas « Passer »).

### Module Notes (`src/modules/notes/`, `src-tauri/src/modules/notes.rs`)

- Données dans `%APPDATA%\Ondine\notes.json` (écriture atomique ; un fichier
  abîmé est mis de côté). Supprimer une note ou des tâches propose « Annuler »
  et les remet à leur place.
- La liste des tâches garde un élément HTML par tâche (repéré par son numéro) :
  les animations (case cochée, texte barré, arrivée, départ) se font sans tout
  redessiner. Double-clic pour modifier une tâche.
- Le texte des notes ne passe jamais par le bus ni par le journal.
- Cocher / décocher une tâche publie `notes.todo-toggled {done}` (pour le
  bilan de la semaine).

### Module Agenda (`src/modules/agenda/`, `src-tauri/src/modules/agenda.rs`)

- Réglage `calendars` (type `calendars`, 10 au plus, éditeur
  `src/settings/calendars-input.ts`) : une liste `{id, name, color, kind,
  path?}`. `kind: "file"` = un .ics choisi avec `dialog_pick_file` (chemin
  passé par `check_path`, 20 Mo au plus) ; `kind: "link"` = un lien iCal rangé
  dans le Gestionnaire d'identifiants sous `agenda-ical-url-<id>` (jamais dans
  settings.json). Lecture et nettoyage de la liste, migration et fusion :
  `services/ics_calendars.rs`.
- Migration (1.2) : les anciens réglages (`icsFiles` + un lien sous
  `agenda-ical-url`) deviennent des calendriers `f1`, `f2`… et `lien`, au
  démarrage, même module désactivé ; le lien est recopié sous
  `agenda-ical-url-lien` et l'ancienne clé effacée seulement après relecture.
  Tant que ce n'est pas enregistré, les anciens réglages sont lus tels quels.
- Un thread relit un fichier quand sa date de modification change (toutes les
  15 s) et retélécharge un lien toutes les 15 min, fusionne et trie les
  rendez-vous de tous les calendriers (`horizonDays` jours, 30 au plus), publie
  `agenda.changed` si la liste a changé et `agenda.reminder` une seule fois
  par rendez-vous, `reminderMin` minutes avant.
- Clic sur un rendez-vous : commande `open {calendar, key}`. Le lien vient du
  .ics (`URL`, sinon un lien Teams / Meet / Zoom / Webex dans
  `X-GOOGLE-CONFERENCE`, le lieu ou la description : `ics::event_link`) ; il
  reste dans le Rust (le front n'a que sa sorte) et n'est ouvert
  (`platform::shell_open`) que s'il commence par http(s).
- Lecture du .ics (`services/ics.rs`) : lignes repliées, texte échappé,
  journées entières, heures UTC (`Z`) converties, `DURATION`, `RRULE`
  (DAILY/WEEKLY/MONTHLY/YEARLY avec INTERVAL, COUNT, UNTIL, BYDAY dont
  « 1MO » / « -1FR »), `EXDATE`, `RECURRENCE-ID`, `STATUS:CANCELLED`.
  **Limite** : une heure avec fuseau nommé (`TZID=…`) est lue comme une heure
  locale de l'ordinateur (juste si l'agenda est dans le même fuseau).
- Pilule : « Dans 12 min · Titre » quand un rendez-vous approche
  (`compactWithinMin`), puis « En cours » avec une barre qui se remplit.
- Rejoindre une réunion : `joinMin` minutes avant (2 par défaut, 0 = jamais)
  un rendez-vous dont le lien est une réunion (Teams, Meet, Zoom, Webex :
  `link_kind` autre que `web`), le thread publie `agenda.join {key, minutes}`
  une seule fois (`joined`) et le compte aussi comme rappelé : pas de rappel
  en double. Le front montre « Réunion dans 2 min : Titre » avec
  « Rejoindre » → commande `join {calendar, key}` (ouvre le lien comme `open`,
  puis publie `media.pause`, et répond `{micMuted}` : le micro par défaut lu
  par Core Audio, seulement si le module Contrôles est actif) ; micro coupé →
  une alerte « Votre micro est coupé » propose « Rétablir le micro »
  (`controls.mic-set {muted: false}`).

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

- Stockage : `%APPDATA%\Ondine\rules.json` (écriture atomique ; un fichier
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
- **Recherche dans l'île** (`island-search.ts`, réglage `searchIsland`, activé
  par défaut) : à partir de 2 lettres, 140 ms après la dernière frappe, le
  front appelle `launcher.search {query}`. Le Rust du Lanceur appelle la
  commande `search {query, limit: 5}` de Notes, Presse-papiers, Étagère et
  Capture par `modules::invoke` (qui vérifie qu'ils sont activés et pas en
  panne) et renvoie `{groups: [{source, items}]}`. L'île montre une section
  par source, sous les applis (8 au plus dans ce cas). Fonctions communes dans
  `services/search.rs` : `normalize` (minuscules, accents retirés, blancs
  regroupés), `score` (début du texte 100 > début d'un mot 80 > chaque mot
  tapé commence un mot 70 > contenu 60 > chaque mot quelque part 40), `best`
  (note, puis le plus récent), `excerpt` (extrait d'une ligne autour du mot).
  - Notes : notes (première ligne = titre, qui compte plus que le reste) et
    tâches (une tâche faite passe après). Action : `notes.open`.
  - Presse-papiers : historique et snippets, extrait de 90 caractères. Les
    copies sensibles n'ont jamais été lues, donc jamais trouvées. Action :
    `open_found` → `clipboard.copy` (recopier).
  - Étagère : noms des éléments ; ceux qui sont maintenant dans un dossier
    exclu (ou disparus) sont écartés. Action : `shelf.open {path}` (chemin
    revalidé, doit être sur l'étagère).
  - Capture : les images du dossier des captures (nom + date en toutes
    lettres, « 6 octobre 2026 », pour trouver par le mois) et le dernier texte
    lu (gardé en mémoire seulement). Action : `capture.open {name}` (un simple
    nom de fichier, cherché dans le dossier des captures) ou `copy_last`.
  - Ouvrir un fichier (`launcher::open_checked`) : un dossier → Explorateur ;
    un exécutable n'est jamais lancé, seulement montré dans l'Explorateur.
  - Rien ne passe par le bus ni par le journal (seulement « résultat de l'île
    ouvert (source) »). En mode démo, des résultats inventés (`demo.ts`).
- **Calculs** (`calc.ts`, front seulement, testé dans `tests/front/calc.test.ts`) :
  `calculate(query, lang)` renvoie les réponses (titre, détail, texte à copier)
  si la recherche est un calcul, sinon `[]`. Elles passent avant tout (note
  1000). Un analyseur à descente récursive écrit à la main (pas d'`eval`) :
  `+ - * / × ÷ ^`, parenthèses, `%` (« 18 % de 240 », « 240 + 18 % »),
  racine, pi ; nombres à la française (virgule, espaces de milliers) ou à
  l'anglaise selon `currentLang()`. Puis : conversions « X unité en unité »
  (octets 1000 / 1024, bits — `B` octet, `b` bit —, débits, durées,
  températures, longueurs, masses, vitesses), « taille à débit » (temps de
  transfert), bases (`0x`, `0b`, `0o`, « en hex »…), sous-réseau IPv4 (un
  résumé puis une ligne par valeur), heures du monde (« 15 h Montréal »,
  « heure à Tokyo », par `src/core/world-time.ts`). Garde-fous contre les faux
  positifs : un nombre seul, une date, une version, un numéro de téléphone ou
  une IP seule ne donnent rien. Entrée → commande `copy {text}` du Lanceur
  (permission `clipboard`, le texte n'est pas journalisé) puis notification
  « Copié ».
- « guid » / « uuid » : « Nouveau GUID » (`crypto.randomUUID`) et sa version
  Windows `{MAJUSCULES}`, copiés de la même façon.

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
- **Horloges du monde** (`world-clocks.ts`, front seulement) : réglage
  `worldClocks`, des villes séparées par des virgules (4 au plus). La table
  des villes (`src/core/world-cities.ts`, ~200 villes, noms FR / EN, fuseau
  IANA ; un nom IANA tapé tel quel marche aussi) et les calculs
  (`src/core/world-time.ts` : `Intl.DateTimeFormat({ timeZone })`, donc les
  fuseaux de Windows, rien sur Internet) sont partagés avec le Lanceur. Une
  rangée sous les jauges, redessinée au début de chaque minute tant que
  l'onglet est ouvert. Le champ de réglage porte `"check": "cities"` :
  `src/settings/field-checks.ts` écrit sous le champ les villes inconnues ou
  en trop (un champ texte de manifeste peut ainsi demander une vérification
  nommée, sans que la valeur soit refusée).
- Redémarrage en attente (`platform/reboot.rs`, lecture seule) : `reboot` →
  `{pending, sinceSecs, reasons}`. Deux clés de HKLM : `…\WindowsUpdate\Auto
  Update\RebootRequired` (raison `updates`) et `…\Component Based
  Servicing\RebootPending` (`servicing`) ; la date = la dernière écriture de
  la clé (`RegQueryInfoKeyW`), la plus ancienne des deux. Une clé présente
  mais fermée à l'utilisateur compte comme « en attente, date inconnue ».
  `PendingFileRenameOperations` est ignoré (trop de faux positifs).
  `open_update` ouvre `ms-settings:windowsupdate` : Ondine ne redémarre
  jamais le PC. Le résumé pour le support ajoute une ligne quand c'est le cas.
- Côté front, `reboot.ts` : la ligne de l'onglet (relue chaque minute tant
  qu'il est ouvert) et le rappel doux (réglage `rebootReminder`) : un coup
  d'œil 2 min après le démarrage puis toutes les 10 min, notification au plus
  une fois par jour (date gardée dans `localStorage`), après un jour
  d'attente, jamais micro utilisé (`controls.media-use`, comme Pauses) ni en
  présentation ou plein écran (`Bridge.deskState().busy`), ni quand personne
  n'est là (5 min sans clavier ni souris : il attend le retour). La règle est
  dans `reboot-text.ts` (testée).

### Module Accès distants (`src/modules/remote/`, `src-tauri/src/modules/remote.rs`)

- Favoris RDP et SSH dans `%APPDATA%\Ondine\remote.json` : nom, type,
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
- Lanceur : il reçoit la liste par `remote.changed` (numéro, nom, type, `wake`)
  et demande l'ouverture par `remote.connect {id}`, le réveil par
  `remote.wake {id}` (« Réveiller NAS », pour un favori avec adresse MAC).
- **Wake-on-LAN** (`remote_wol.rs`) : adresse MAC facultative par favori
  (`mac` dans remote.json, absente des anciens fichiers ; lue sous les formes
  `AA:BB:…`, `AA-BB-…`, `AABB…`, rangée `AA:BB:CC:DD:EE:FF` ; une MAC abîmée à
  la main est oubliée, pas le favori). `wake {id}` : paquet magique (6 × FF puis
  16 × la MAC, 102 octets) en UDP port 9, std::net, envoyé 3 fois : vers
  255.255.255.255 par la route par défaut, puis depuis chaque carte IPv4 en
  marche vers 255.255.255.255 et son adresse de diffusion (`services/lan.rs`).
  Puis un fil teste le serveur (même `probe` que « Tester ») tout de suite puis
  toutes les 5 s, 2 min au plus → `remote.waking`, puis `remote.wake-done`.
  Un seul fil d'attente par favori (un deuxième clic renvoie le paquet). Le
  journal ne contient ni l'adresse ni la MAC. Venue du lanceur (bus, fil de
  l'interface), la demande est traitée dans un fil à part.

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

### Module Contrôles (`src/modules/controls/`, `src-tauri/src/modules/controls.rs`, `src-tauri/src/platform/audio.rs`)

- Volume et coupure des haut-parleurs et du micro **par défaut** de Windows,
  par Core Audio (`IMMDeviceEnumerator::GetDefaultAudioEndpoint` →
  `IAudioEndpointVolume`). Aucune permission : rien n'est lu ni envoyé.
- `state` → `{speakers, microphone}` (`{volume 0-100, muted}` ou `null` sans
  périphérique) ; `set_volume {device, volume}` ; `set_muted {device, muted}`.
- Bus : `controls.mic-set {muted}` (publié par l'Agenda, « Rétablir le
  micro ») coupe ou rétablit le micro dans un fil, puis publie
  `controls.mic-muted {muted, source: "request"}` (confirmation affichée comme
  pour le raccourci) ou `controls.mic-error`.
- Vue façon centre de contrôle, en verre liquide, sans défilement : à gauche
  une carte de pastilles (radios, mode avion, micro coupé), à droite des
  piliers verticaux (son, micro, un par écran) faits maison (`role="slider"`,
  pointeur + flèches du clavier). Le front relit le son chaque seconde
  (touches du clavier, autre appli) ; pendant un glissé, au plus un envoi
  toutes les 60 ms (150 ms pour un écran) et le pilier n'est pas écrasé.
- Luminosité (`platform/brightness.rs`) : `screens` → `[{id, name,
  brightness}]` (relu toutes les 5 s, c'est lent) ; `set_brightness {id,
  brightness}`. `internal` = écran du portable par WMI (`root\WMI`,
  `WmiMonitorBrightness` / `WmiMonitorBrightnessMethods.WmiSetBrightness`) ;
  `ext-N` = écran externe par DDC/CI (dxva2 `GetMonitorBrightness` /
  `SetMonitorBrightness`, N = rang parmi les écrans physiques, un verrou
  évite deux dialogues à la fois). Un écran qui ne répond pas n'est pas listé.
- Radios (`platform/radios.rs`, WinRT `Windows.Devices.Radios`) : `radios` →
  `[{kind: wifi|bluetooth|mobile, on, disabled}]` (relu toutes les 2 s) ;
  `set_radio {kind, on}` (demande `RequestAccessAsync` puis `SetStateAsync` sur
  chaque radio de la famille) ; `set_airplane {on}`. Pas d'API publique pour le
  vrai mode avion : on éteint tout en retenant ce qui était allumé, et on le
  rallume à la sortie (Wi-Fi + Bluetooth si l'île a redémarré entre-temps).
  NON VÉRIFIÉ : que Windows autorise une appli classique (hors Store).
- Mode sombre (`platform/theme.rs`) : `theme` → `{dark, mixed, night}` (relu
  toutes les 2 s avec les radios). Lecture de `AppsUseLightTheme` et
  `SystemUsesLightTheme` (HKCU `…\Themes\Personalize`) ; `set_dark {on}`
  écrit les deux, puis envoie `WM_SETTINGCHANGE` « ImmersiveColorSet » à
  toutes les fenêtres (`SendMessageTimeoutW`, `SMTO_ABORTIFHUNG`, dans un
  fil à part).
- Éclairage nocturne (`platform/nightlight.rs`) : la valeur binaire `Data` de
  la clé CloudStore `…\bluelightreductionstate`. Windows n'en publie pas le
  format : on ne le lit et on ne l'écrit que s'il a EXACTEMENT la forme connue
  (en-têtes, entiers LEB128, marque `10 00` = allumé), vérifiée par `parse`
  avant et après la modification (tests sur de vrais exemples). Sinon
  `night.supported = false`, rien n'est écrit, et `set_night` ouvre
  `ms-settings:nightlight` (réponse `{opened: true}`).
- Clés USB (`platform/eject.rs`) : `usb_drives` → `[{root, letter, label,
  removable, ejecting}]` : les lecteurs amovibles, et les disques « fixes »
  branchés en USB (`IOCTL_STORAGE_QUERY_PROPERTY`, `BusTypeUsb`), jamais le
  disque de Windows. `eject {root}` lance l'éjection dans un fil à part
  (méthode standard : volume → numéro de disque → nœud SetupDi → parent
  marqué `DN_REMOVABLE` → `CM_Request_Device_EjectW` avec un veto à remplir,
  donc sans fenêtre de Windows ; 3 essais). Le résultat part sur
  `controls.usb-ejected`. Refus : le programme vient du veto (types 3 et 4)
  ou de l'événement 225 de Kernel-PnP (`EvtQuery` sur `System` et
  `Microsoft-Windows-Kernel-PnP/Configuration`, les dernières secondes) ; le
  message est choisi par le front (`usb-text.ts`, testé). `open_drive
  {root}` ouvre la clé dans l'Explorateur.
- Le fil de fond compare la liste des clés à chaque tour (2 s) et publie
  `controls.usb-added` pour chaque nouvelle (pas celles déjà là au
  démarrage), si le réglage `usbNotify` est coché. Le journal ne note jamais
  le nom d'un volume ni d'un programme.

## Agents IA (`src/modules/agents/`, `src-tauri/src/modules/agents.rs`, `src-tauri/src/cli.rs`)

Les outils extérieurs préviennent l'île par une porte d'entrée locale.

- `ondine.exe notify [--source x] [--title t] [--message m]` (`main.rs` →
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
  forme `command` + `args` (Claude Code lance ondine.exe directement, sans
  Git Bash ni PowerShell, donc aucun échappement du chemin).
- Installation automatique (`hook_status`, `hook_install {tool}`,
  `hook_remove {tool}`, permission `files`, logique dans
  `modules/agents_hooks.rs`) : Ondine écrit les mêmes entrées que la copie
  dans `.claude\settings.json` (ou `CLAUDE_CONFIG_DIR`), `.codex\config.toml`
  (ou `CODEX_HOME`) ou `.gemini\settings.json`. Fusion : tout le reste est
  gardé ; les entrées dont le programme s'appelle `ondine.exe` (quel que soit
  le dossier) sont remplacées. Copie `nom.ondine-<date>.bak`, puis fichier
  temporaire renommé. Fichier invalide : refus, jamais réécrit. Codex : le
  texte TOML est modifié section par section (commentaires gardés), puis
  relu et comparé ; au moindre écart, refus. État affiché : Installé /
  Ancien chemin (un autre ondine.exe, refusé par le canal) / Non installé.
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
- « Reprendre » (`launch {…, resume: true}`) : les mots fixes de
  `Tool::resume_args` sont ajoutés après le chemin complet du programme
  (`--continue` pour Claude Code, `resume --last` pour Codex ; Gemini CLI :
  refus). À côté, la dernière phrase de la session (`last_sessions` →
  `[{index, found, text?, who?, at?}]`, logique dans `modules/agents_resume.rs`) :
  le dossier `~/.claude/projects/<dossier encodé>` (chaque caractère qui n'est
  pas une lettre ou un chiffre ASCII devient « - », comme Claude Code ; les
  noms de plus de 200 caractères sont retrouvés par leur début), son `.jsonl`
  le plus récent (hors `agent-*`), dont seule la fin est lue (256 Ko, puis
  2 Mo). Lignes cassées ignorées ; on garde le dernier texte `user` ou
  `assistant` (pas les résultats d'outils, les sous-agents, les commandes
  `<command-…>`), sur une ligne, coupé à 120 caractères. Réglage
  `resumePreview` (activé) ; jamais journalisé.
- Compteur de jetons (`modules/agents_usage.rs`, commande
  `usage {offsetMinutes, days}` → `{days: [{day, tool, model, input, output,
  cacheRead, cacheWrite, messages}], projects: [{name, tool, …}], tools,
  files, partial}`, réglage `usage`, activé) : quand l'onglet est ouvert
  (puis au plus toutes les 60 s, ou « ↻ »), lit les journaux de Claude Code
  (`~/.claude/projects/**/*.jsonl`, sous-agents compris : les lignes
  `assistant` avec `message.usage`, une réponse comptée une fois par
  `message.id` + `requestId`) et de Codex
  (`~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl` : la différence entre deux
  `token_count`), modifiés depuis le début de la période. Regroupé par jour
  local (`offsetMinutes` : celui de JavaScript), outil et modèle, et par
  projet (le nom du dossier seulement). Un fichier n'est relu que s'il a
  changé (date, taille) ; 3000 fichiers, 1 Go et 8 s au plus par passage,
  sinon `partial`. Gemini CLI n'écrit pas de compte de jetons : pas compté.
  Rien ne sort du PC ; le journal note seulement le volume lu.
- Compteur de jetons, suite (`src/modules/agents/usage-view.ts` : la section
  « Utilisation des agents » ; `src/modules/agents/cost.ts` : la logique pure,
  testée dans `tests/front/agents.test.ts`) :
  - la courbe des 30 jours : un SVG maison (320 × 56, une barre par jour,
    empilée par outil, couleurs Claude `#4a9ad8` / Codex `#c47a30` validées
    sur les fonds de l'île et pour le daltonisme, légende nommée), la date, le
    total et le coût du jour au survol dans la légende ; l'arrivée des barres
    est animée sauf avec « réduire les animations » ;
  - le coût estimé : réglage `prices` (texte multiligne, type `string` +
    `multiline` dans `form.ts` : une zone de texte), une ligne par modèle
    « début du nom ; entrée ; sortie ; cache lu ; cache écrit » en $ par
    million de jetons, virgule ou point ; la première ligne qui correspond au
    début du nom gagne ; cache lu / écrit absents = 10 % / 125 % de l'entrée.
    Grille par défaut INDICATIVE (Opus 15/75, Sonnet 3/15, Haiku 1/5,
    GPT-5 1,25/10, à vérifier chez les éditeurs). Affiché « ≈ 12,40 $ »
    (symbole après le nombre) sur le total, par modèle (« prix ? » si aucune
    ligne ne correspond) et par projet (au prix du modèle le plus utilisé par
    cet outil : les projets n'ont pas de modèle) ;
  - l'alerte de budget : réglage `dailyBudget` ($ par jour, 0 = désactivé).
    Quand le coût estimé du jour dépasse, une notification `high` (une seule
    par jour : le jour est noté dans `localStorage` de l'île,
    `agents.budget-alerted`) et `mascot.emote {emotion: "worried"}`. Vérifié
    à chaque relecture du compteur (onglet ouvert) et, depuis `setup()`, par
    `usage {days: 1}` toutes les 15 min (cadence `agentsBudget`) tant que le
    budget est > 0 ;
  - l'export CSV : le front construit le texte (`usageCsv` : bloc par jour,
    outil et modèle avec entrée, sortie, cache lu, cache écrit, réponses,
    coût estimé ; ligne vide ; bloc par projet ; séparateur « ; », virgule
    décimale, CRLF) et la commande `usage_csv {text}` (permission `files`,
    4 Mo au plus) l'écrit tel quel dans Téléchargements sous
    `jetons-agents-AAAA-MM-JJ.csv` (« (2) » si le nom est pris), UTF-8 avec
    BOM, puis `shelf.add` si l'Étagère est active, sinon l'Explorateur sur le
    fichier. Mode démo : courbe de 30 jours, coûts, « export » fictif.
- Historique gardé 7 jours (`modules/agents_history.rs`, fichier
  `%APPDATA%\Ondine\agents-history.json` : `{v, entries: [{at, kind, tool,
  project, durationMs, title, changes?}]}`) : chaque « a fini » et « vous
  attend » y est noté (le genre, l'outil, le NOM du dossier, la date, la
  durée — de la tâche depuis « au travail », ou de l'attente jusqu'au départ
  de l'agent —, le titre écrit par Ondine et le bilan git), jamais le contenu
  d'un message ni un chemin. Écrit via un fichier temporaire renommé, au plus
  une fois par seconde (`save_soon`), hors du thread de l'interface ; relu au
  démarrage (les « Derniers messages » de l'onglet, sans message, « il y a
  2 j ») ; purgé des entrées de plus de 7 jours au démarrage et chaque minute ;
  2000 entrées au plus ; un fichier abîmé est mis de côté. En mémoire,
  `MAX_HISTORY` (30) reste la limite de l'onglet.
- `weekly {offsetMinutes?}` (appelée par `weekly.rs`, pas par le front) :
  `{done, waitMinutes, projects, days, prices}` — tâches finies, minutes
  d'attente et projets (les plus actifs d'abord) des 7 derniers jours
  d'après l'historique, les jetons des 7 jours (`days`, comme `usage`) et le
  texte du réglage `prices` ; `null` si aucun agent dans la semaine. Le front
  du bilan calcule total et coût avec `cost.ts`.
- Bilan de fin de tâche (`modules/agents_git.rs`, réglage `showChanges`,
  activé) : à « a fini », le dossier du hook (`cwd`) passe par `check_path`.
  S'il est dans un dépôt git (un parent avec `.git`, jamais le dossier
  utilisateur ni la racine d'un disque) et que `git.exe` est trouvé dans le
  PATH (chemin complet), un fil lance `git status --porcelain=v1 -z -uall`
  puis `git diff --numstat -z HEAD` (`platform/devtools.rs` :
  `run_with_timeout`, 3 s au total, 4 Mo de sortie au plus, sans console ;
  `--no-optional-locks`, `core.fsmonitor=false`, `--no-ext-diff`,
  `--no-textconv`, `GIT_TERMINAL_PROMPT=0` : lecture seule, aucun programme du
  dépôt lancé). Les nouveaux fichiers sont comptés à la main (200 fichiers et
  1 Mo chacun au plus). L'événement reçoit `changes {files, added, removed,
  names, dir, vscode, terminal}` et la notification « Claude a fini · 3
  fichiers modifiés, +120 −14 » (alerte) propose « Ouvrir dans VS Code »
  (`open_vscode {path}` : `code.cmd` du PATH ou
  `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`, lancé par son chemin
  complet avec le dossier en seul paramètre) et « Terminal ici »
  (`terminal.open {path}`). Sans dépôt, sans git ou trop long : la
  notification d'avant.
- Tableau des sessions (`history` → `sessions`) : une ligne par session
  (`outil:session_id`) avec son état (`working`, `waiting`, `done`, `idle`
  après 1 h sans nouvelles) et depuis quand ; oubliée 2 h après sa dernière
  nouvelle ou à `SessionEnd`.
- « Y aller » (`focus {session}`) : `ondine.exe notify` envoie aussi les
  numéros de ses programmes parents (`ancestor_pids`, jusqu'à l'île ou
  l'Explorateur exclus) et sa console si elle est visible. L'île cherche la
  première fenêtre visible de ces programmes (`EnumWindows`), la restaure si
  elle est réduite, puis la passe devant (`SetForegroundWindow`, précédé d'un
  appui sur Alt pour que Windows l'autorise). Ces numéros ne servent qu'à ça.
- L'île comme serveur MCP (`ondine.exe mcp`, `cli.rs`) : un petit serveur
  MCP en stdio (JSON-RPC, une ligne par message ; versions 2024-11-05,
  2025-03-26 et 2025-06-18). Ne démarre pas l'île : il passe chaque appel
  par le même canal, devenu « dans les deux sens » (une ligne de demande,
  éventuellement une ligne de réponse). Quatre outils :
  - `ondine_notify {title, message?}` → message dans l'historique ;
  - `ondine_progress {title?, step, total}` → `agents.progress`, une
    notification discrète remplacée à chaque étape ;
  - `ondine_timer {minutes 1–180}` → `timer.start` ;
  - `ondine_ask {question, options 2–4, timeout_minutes 1–25}` →
    `agents.ask`, une alerte qui reste affichée avec un bouton par choix (et
    dans l'onglet) ;
  - `ondine_note`, `ondine_shelf`, `ondine_capture`, `ondine_open` : voir plus
    bas (« Les outils MCP en plus »). Le clic (`answer {id, choice}`) renvoie `{"answer": "…"}`
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
- Autoriser / Refuser depuis l'île (`ondine.exe permission --source
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
    chose pour `ondine_ask` ;
  - Gemini CLI : impossible (un hook peut refuser, pas autoriser).
- Les autres outils (`modules/agents_tools.rs`, front `agents/tools.ts`) :
  même liste des deux côtés, un identifiant par outil (réglage « Proposer … »,
  source des hooks, bouton). Lancement + reprise + hooks installés
  automatiquement (même mécanisme que ci-dessus, `HOOK_TOOLS` dans agents.rs,
  `hook_status` / `hook_install` / `hook_remove`) pour ceux dont la
  documentation officielle décrit le format des hooks :
  - GitHub Copilot CLI (`copilot`) : `%USERPROFILE%\.copilot\hooks\ondine.json`
    (ou `COPILOT_HOME\hooks\`), `{version: 1, hooks: {événement: [{type:
    "command", exec, args, timeoutSec}]}}` — `exec` + `args` : lancé sans
    shell, le JSON sur l'entrée standard ; `userPromptSubmitted` → au travail,
    `agentStop` → a fini, `notification` → attend (`notification_type`),
    `sessionEnd` ; `permissionRequest` n'est pas branché (ce hook attend une
    décision). Reprise `copilot --continue`.
  - Cursor CLI (`agent`) : `%USERPROFILE%\.cursor\hooks.json`, `{version: 1,
    hooks: {stop: [{command}]}}`, commande `"chemin" notify --source cursor`
    (forme cmd.exe), le JSON sur l'entrée standard (`hook_event_name`,
    `conversation_id`, `workspace_roots[0]` comme dossier) ; `beforeSubmitPrompt`,
    `stop`, `sessionEnd`. Reprise `agent --continue`. Que ces hooks se
    déclenchent aussi dans l'agent en ligne de commande vient du forum de
    Cursor, pas de la page officielle (voir « À tester »).
  - Qwen Code (`qwen`) : `%USERPROFILE%\.qwen\settings.json`, même forme que
    Claude Code (`hooks.Stop[].hooks[]`), commande PowerShell `$input | &
    'chemin' notify --source qwen` avec `shell: "powershell"` ;
    `UserPromptSubmit`, `Stop`, `Notification` (`permission_prompt`,
    `idle_prompt`), `SessionEnd`. Reprise `qwen --continue`.
  - Goose (`goose`) : un plugin à nous,
    `%USERPROFILE%\.agents\plugins\ondine\hooks\hooks.json` (+ `plugin.json`
    écrit à l'installation s'il manque), forme Claude Code, commande `'chemin'
    notify --source goose` (Goose lance avec `sh -c`) ; `UserPromptSubmit`,
    `Stop`, `SessionEnd` (le JSON reçu a `event`, `session_id`,
    `working_dir`). Reprise `goose session --resume`.
  - Lancement seulement (pas de hooks shell, ou un format non vérifié) :
    OpenCode (`opencode`, reprise `--continue` ; ses « plugins » sont du
    JavaScript), Kiro CLI (`kiro-cli`, reprise `chat --resume` ; ses hooks
    sont par projet dans `.kiro\hooks\`, pas dans un fichier utilisateur),
    Hermes (`hermes`, reprise `--continue` ; hooks shell dans `config.yaml`,
    format non vérifié), Aider (`aider`), Amp (`amp` ; pas de reprise de la
    dernière session documentée, seulement par identifiant).
  - Les événements des autres outils sont ramenés aux nôtres
    (`agents_tools::canonical_event` : `agentStop`, `stop` → Stop…), le numéro
    de session lu dans `session_id`, `conversation_id` ou `sessionId`, le
    dossier dans `cwd`, `working_dir` ou `workspace_roots[0]`. Le serveur MCP
    et le hook d'autorisation ne sont pas proposés pour ces outils (formats
    non vérifiés).
  - « Autre outil » : réglage `otherTool` (le mot de commande : lettres,
    chiffres, tirets, points, soulignés, 32 caractères au plus, ni option ni
    chemin ; `agents_tools::valid_word`), lancé comme les autres (chemin
    complet trouvé dans le PATH). `launch {tool: "other"}`. Le guide de
    l'onglet montre la ligne `"chemin\ondine.exe" notify --source other
    --event done` (`hook_config` → `other`) : `cli.rs` comprend `--event done |
    waiting | working | ended` sans JSON, et `understand` en fait « L'outil a
    fini » / « L'outil attend votre réponse ».
  - Les icônes des outils (`src/assets/icons-line/<outil>.svg`, `icon.ts`
    `agentIcon`) sont des pictogrammes au trait maison ; sans image en
    couleur, le pack couleur montre aussi le trait.
- Le résumé de l'agent dans « a fini » (réglage `doneSummary`, activé) : le
  hook `Stop` de Claude Code donne `transcript_path`. Le chemin n'est accepté
  que s'il est absolu, finit en `.jsonl` et se trouve (canonisé) sous
  `…\.claude\projects` (`agents_resume::transcript_path`) ; on y lit la
  dernière phrase (`last_message_cut`, 200 caractères), seulement si elle
  vient de l'assistant. Elle va dans `Event.summary` → le corps de la
  notification, avec « Copier » (`copy_text {text}`, presse-papiers). Les
  autres outils donnent parfois un chemin de transcription (Copilot
  `transcriptPath`, Cursor `transcript_path`) mais pas sous le dossier de
  Claude Code ni dans un format connu : ignoré. Jamais dans le journal.
- Bilan git cliquable : « Fichiers… » sur la notification du bilan ouvre
  l'île sur l'onglet et un panneau (`agents/report-view.ts`) demande
  `report_files {path}` → `{root, files: [{path, added, removed, untracked,
  exists}]}` (`agents_git::file_list` : les mêmes `git status` / `git diff
  --numstat`, 20 fichiers au plus, les plus changés d'abord). Chaque fichier
  a « Ouvrir » (`open_vscode_file {dir, file}` : `code <racine> -g <fichier>`
  par le chemin complet de VS Code, le chemin relatif vérifié par
  `safe_relative` — pas de `..`, pas absolu — puis joint à la racine et
  validé par `check_path`) et « Diff » (`{…, diff: true}` : `git show
  HEAD:<fichier>` en lecture seule dans `%TEMP%\ondine-diff\<date>\HEAD ·
  <nom>`, puis `code --diff <copie> <fichier>` ; pas pour un fichier nouveau).
  Seulement sur votre clic.
- Rappels d'attente (`modules/agents_wait.rs`, réglage `remindWaiting`,
  activé) : le fil d'entretien (5 s) regarde chaque session « waiting » ;
  à 10 min puis 30 min d'attente, un `agents.event` de type `info` (« Claude
  attend toujours votre réponse · depuis 10 min · site-ondine », avec « Y
  aller »), et c'est tout (`Session.reminded`). Rien pendant la
  concentration. En plus, côté front (`agents/wait-watch.ts`) : tant qu'une
  session attend et que l'île est en mini-île (`island.state` → `compact`),
  `mascot.emote {emotion: "wave"}` toutes les deux minutes.
- Les outils MCP en plus (`modules/agents_mcp_extra.rs`, déclarés dans
  `cli.rs`, même réglage `mcp` et même limite de débit) ; chaque demande
  porte le dossier courant de l'agent (`cwd`) :
  - `ondine_note {text}` (2000 caractères au plus) → bus `notes.add {text}`,
    que le module Notes écoute (nouvelle note en tête, mêmes limites que
    `note_save`) ; l'agent reçoit « Note ajoutée » ;
  - `ondine_shelf {path}` : `check_path`, un fichier existant, sous le dossier
    de la session (`cwd`) ou le dossier utilisateur (`under_allowed`) → bus
    `shelf.add {paths}` (le mécanisme de Capture) ;
  - `ondine_capture {reason?}` : une question de type `capture` (« Claude
    demande une capture d'écran », « Capturer » / « Refuser », 60 s) ; au
    clic, `capture.request {then: "save"}` que le front de Capture écoute
    (même outil de capture de Windows), puis `capture.done` revient au Rust
    d'Agents IA (`State.capture`), qui rend le chemin du PNG à l'agent (150 s
    au plus, une seule capture en attente) ; sans clic : refus ;
  - `ondine_open {target}` : une adresse http(s) (`web_url` : schéma, pas
    d'espace ni de contrôle, 2000 caractères) ou un fichier existant sous la
    session ou le dossier utilisateur ; question de type `open` (« Ouvrir » /
    « Refuser », 60 s) ; au clic, le lien part à `shell_open`, le fichier à
    `launcher::open_checked` (un programme est seulement montré dans
    l'Explorateur, jamais lancé).
- Mode concentration (`quiet_start {minutes: 25 | 60 | 120 | 0}`, 0 = jusqu'à
  `quiet_stop`) : les notifications des agents sont gardées (`held`, 100 au
  plus) au lieu d'être montrées, pas de fête de la mascotte, les questions
  attendent dans l'onglet sans s'ouvrir en grand, et les demandes de
  permission passent tout de suite au terminal. À la fin : `agents.quiet
  {on: false, summary}`, une seule notification (« Claude a fini 2 tâches ·
  Codex t'attend · 1 question en attente »). En mémoire seulement.
- Calendrier de contributions GitHub (`modules/agents_github.rs`, vue
  `src/modules/agents/github-view.ts`, logique pure `github-logic.ts`,
  commande `github_calendar` → `{login, total, streak, today, days: [{date,
  count, level}], fetchedAt, private, fromCache}`) : la grille 53 × 7 du
  profil, sous le compteur de jetons. Réglages `githubLogin` (texte, lettres,
  chiffres et tirets, 39 au plus, vérifié des deux côtés ; vide = rien n'est
  demandé) et `githubToken` (champ `secret` : la valeur va dans le
  Gestionnaire d'identifiants sous la clé « github-token », permission
  `credentials`, jamais dans les réglages). C'est la SEULE fonction de
  l'onglet qui parle à Internet : sans jeton, la page HTML
  `https://github.com/users/<login>/contributions` (les contributions
  publiques ; parseur tolérant par recherche de balises `<td data-date
  data-level>` et `<tool-tip for>`, testé sur un extrait figé) ; avec un jeton
  (lecture seule, read:user), GraphQL `api.github.com/graphql`
  (`contributionsCollection.contributionCalendar`, les privées comprises).
  Limites : au plus une demande toutes les 30 minutes par identifiant (en
  mémoire ; 2 minutes après une erreur), 10 s, 2 Mo, HTTPS seulement, jamais
  pendant une présentation (`presentation_busy`) ni le mode concentration (le
  calendrier déjà lu est montré). Copie sur disque `github-calendar.json`
  (dossier de données) pour l'affichage immédiat au démarrage. Le journal ne
  note que « calendrier GitHub : lu, N jours ». Le Rust complète les jours
  manquants (du dimanche d'il y a 52 semaines à aujourd'hui) et calcule la
  série (jours d'affilée, jusqu'à hier si rien encore aujourd'hui). Front :
  « 336 contributions cette année · série de 12 jours », mois en haut, Lun /
  Mer / Ven à gauche, cinq niveaux tirés de `--accent` ; au premier affichage
  de la session, les colonnes s'allument de gauche à droite (1,2 s) ; la case
  du jour pulse tant qu'elle est à zéro ; survol « 3 contributions le 8
  octobre » ; « ↻ » redemande (ou dit « Déjà à jour » si les 30 minutes ne
  sont pas passées). Rien ne bouge avec « réduire les animations » ni en mode
  éco. Séries : à 7, 30 et 100 jours, une fois par palier et par série (clé
  localStorage « premier jour:palier »), la vue publie `agents.github-streak
  {days, stage}` ; `src/eggs/eggs.ts` fait `starstruck` et range le trésor
  `github-<palier>` dans le carnet. Mode démo : une année inventée
  (`simon-demo`).

## Profils (`src-tauri/src/services/profiles.rs`, `src/settings/profiles-page.ts`)

- Réglage `profiles` : `{list, active, auto, base}`. Un profil (« Travail »,
  « Maison »…, 10 au plus) ne garde que ce qu'il remplace (`values`, champs
  facultatifs) : `tabOrder` et `modules` (onglets affichés), `theme` + `color`,
  `alwaysMini`.
- Changer de profil (`profile_activate {id}`, "" = aucun) : les réglages
  actuels sont rangés (ce que le profil actif remplace va dans ce profil, le
  reste dans `base`), puis on repart de `base` avec par-dessus le nouveau
  profil. Les retouches faites pendant un profil lui restent donc.
- Changement automatique (`auto`) : règle par profil, plage horaire (jours,
  début, fin, peut passer minuit) ou nom du Wi-Fi (`platform/wifi.rs`, API
  Native Wifi `WlanQueryInterface` ; Windows 11 24H2 exige la permission de
  localisation). Un fil regarde toutes les 30 s ; Wi-Fi avant heures, puis
  l'ordre de la liste. Il n'agit que quand la réponse change : un choix à la
  main tient jusqu'au prochain changement de situation.
- Menu de l'icône (`tray.rs`) : sous-menu « Profil » (case cochée devant
  l'actif), infobulle « Ondine · Travail ».

## Météo (`src/modules/weather/`, `src-tauri/src/modules/weather.rs`)

- Désactivée par défaut (réglage `on`), permission `network`. Rien ne part
  tant qu'elle n'est pas allumée avec une ville.
- Open-Meteo, en HTTPS seulement (ureq, TLS de Windows, 8 s au plus) :
  `geocoding-api.open-meteo.com` (la ville → coordonnées, quand la ville
  change ; « Lyon, FR » précise le pays), puis `api.open-meteo.com`
  (coordonnées arrondies à 2 décimales) au plus toutes les 30 minutes (une
  minute après un changement de ville ou d'unité). Erreurs : une ligne dans le
  journal, sans la ville.
- `weather.changed` (Rust) → le front redemande `current`, puis publie
  `weather.updated` (icône, température, description, ville, détail) que
  l'onglet Système affiche en ligne « Météo ».
- Pas d'onglet : vue compacte (icône + température + ville) quand aucun autre
  module n'occupe la pilule. Mode démo : une fausse météo (Lyon, 21°).

## Bilan de la semaine (`src/modules/weekly/`, `src-tauri/src/modules/weekly.rs`)

- Module sans onglet, sans permission. Réglages `day` ("1" lundi … "7"
  dimanche, "5" par défaut) et `time` ("17:00", par demi-heure). Le désactiver
  (Réglages → Onglets → Sans onglet) arrête tout : plus de comptes, plus de bilan.
- Les comptes sont tenus par le Rust, qui écoute `timer.work-session` et
  `notes.todo-toggled` (rien n'est compté en mode démo) : Pomodoros terminés,
  secondes de concentration (4 h au plus par séance), tâches cochées (moins les
  décochées, jamais sous zéro). Fichier `%APPDATA%\Ondine\weekly.json` :
  `{current: {until, tally}, closed, lastShown}`, que des nombres et des dates
  (heure du PC, à la minute) ; écrit via un fichier temporaire renommé, hors du
  thread de l'interface ; un fichier abîmé est mis de côté.
- Une « semaine » va d'un bilan au suivant (`next_slot` : le prochain jour et
  heure réglés, strictement après maintenant). Le front demande `due` toutes
  les minutes (cadence `weeklyCheck`) et une première fois 20 s après le
  démarrage : le Rust fait avancer les semaines (`roll`) et rend le bilan une
  seule fois (`take_due`), seulement s'il y a quelque chose (une minute de
  concentration au moins, ou un Pomodoro, ou une tâche). PC éteint à l'heure
  dite : le bilan sort encore dans les 2 jours, après il est oublié. Deux bilans
  sont toujours à 6 jours d'écart au moins (jour du bilan changé : la semaine
  trop courte s'ajoute à la suivante).
- Bilan : `mascot.emote {emotion: "celebrate"}` puis une notification
  `normal` de 15 s, « Le bilan de votre semaine » : « 3 Pomodoros terminés ·
  2 h 05 de concentration · 7 tâches cochées » (chaque morceau traduit par
  `t()`, `summary.ts`). `weekly.show` (bouton des réglages) montre `peek`, la
  semaine en cours. Mode démo : `due` reste vide, `peek` répond une fausse
  semaine.
- Carte « Agents IA » : `due` et `peek` ajoutent `agents` à leur réponse
  (`with_agents` : `modules::invoke(app, "agents", "weekly", {})` ; `null` si
  le module est désactivé ou sans agent dans la semaine). Le front
  (`agentsParts`, `summary.ts` ; coût via `src/modules/agents/cost.ts`)
  ajoute « Agents IA : 23 tâches finies, 2 h 10 d'attente de votre part,
  3,1 M de jetons (≈ 12 $), projets : site-ondine, Island ». Le bilan
  programmé ne sort toujours que si la semaine classique a quelque chose ;
  `peek` le montre aussi avec seulement des agents.

## Quoi de neuf (`src/core/whats-new.ts`, `src/core/changelog.ts`)

- Réglage `general.lastSeenVersion` (vérifié par le Rust : 40 caractères au
  plus, chiffres, lettres, `.`, `-`, `+`). Au démarrage de l'île, avant le mot
  de bienvenue : même version → rien ; rien de noté et pas encore de bienvenue
  (premier lancement) → la version est seulement notée ; sinon (mise à jour,
  y compris depuis une version d'avant ce réglage) → notée, et la
  notification. Jamais en mode démo ni dans un navigateur.
- `CHANGELOG.md` est intégré à la construction (`?raw` de Vite). `changelog.ts`
  lit les sections `## [X.Y.Z] · date` et leurs puces (une puce peut tenir sur
  plusieurs lignes) ; chaque puce est « français · English » : on garde la
  moitié de la langue de l'interface (coupure au premier « · » qui suit une
  fin de phrase). Trois puces au plus, 120 caractères chacune.
- Quand la version apporte de nouvelles mascottes (`whats-new-mascots.ts` :
  `NEW_MASCOTS`, version → ids ; pour 1.2.0, toute la famille gomme sauf la
  goutte gomme ; une version sans entrée garde le texte seul), la notification
  porte un contenu (`content` de `NotificationRequest`, monté dans l'alerte
  seulement et défait avec la carte) : le panneau
  `src/island/whats-new-panel.ts`. Un carrousel des vraies mascottes en gomme
  (moteur `gum`, un canvas chacune), trois à la fois (une seule en économie
  d'énergie), flèches, nom dessous ; à tour de rôle l'une fait coucou, rit ou
  danse (rien avec « Réduire les animations ») ; un clic choisit une carte,
  « Adopter » écrit `mascot.id` (et `mascot.enabled`) : l'île change de
  mascotte tout de suite, et elle fait coucou. Les puces du CHANGELOG sont
  sous le carrousel. « Plus tard » ou × ferment ; les moteurs sont détruits.
  Classe CSS `custom` sur la carte (île 660 × 268).
- Rouvrable : Réglages → Général → À propos → « Voir les nouveautés », et en
  mode démo la scène « Quoi de neuf » (Réglages → Captures d'écran). Le
  message `app.whats-new` peut porter `{ version }` (dans un navigateur :
  `window.ondineBus.inject("app.whats-new", { version: "1.2.0" })`).
- Notification `high` et `sticky` (l'île s'ouvre en alerte, plus grande quand
  le texte a plusieurs lignes : classe `lines`), avec « Tout voir » →
  commande `release_page_open` (Rust, `update.rs`) : ouvre
  `https://github.com/Naod6473/Ondine/releases/tag/v<version de l'appli>` dans
  le navigateur ; la version vient du Rust, pas de la page. Réglages →
  Général → À propos → « Voir les nouveautés » publie `app.whats-new`.

## Astuces d'onglet (`src/island/tips.ts`, `src/island/tip-state.ts`)

- Chaque module à onglet a un champ `tip` dans son manifeste : son geste
  principal en une phrase, au « vous » (test : `tests/front/tips.test.ts`
  vérifie la phrase, sa traduction anglaise et son tutoiement).
- La première fois qu'un onglet s'affiche dans l'île ouverte, une bulle
  (`.tip-bubble`, en bas à gauche du contenu) montre la phrase avec « OK ».
  L'onglet est noté dans `island.tipsSeen` (64 au plus, vérifié par le Rust)
  après « OK » ou 3 s à l'écran. La bulle disparaît quand l'île quitte l'état
  `expanded` : jamais par-dessus une alerte. Jamais en mode démo. Arrivée
  animée, sauf avec « réduire les animations ».
- Réglages → Onglets → Astuces : `island.tips` (oui) et « Revoir les
  astuces » (vide `tipsSeen`).

## Parler à Ondine (`src/modules/askclaude/`, `src-tauri/src/modules/askclaude.rs`, `askclaude_providers.rs`, `askclaude_tools.rs`, `askclaude_pc.rs`)

Une conversation avec Ondine (l'ancien « Demander à Claude » : l'identifiant
`askclaude` est gardé pour ne pas perdre les réglages ni la place de l'onglet).
Elle répond par l'API de Claude, d'OpenAI ou de Gemini, au choix (réglage
`provider`). Client HTTP `ureq` 3, TLS de Windows.

- Fournisseurs (`askclaude_providers.rs`) : une seule forme de conversation
  (`Turn` : vous ou Ondine, texte, fichier joint), traduite vers :
  - Claude : `POST https://api.anthropic.com/v1/messages`, en-têtes
    `x-api-key` et `anthropic-version: 2023-06-01` ;
  - OpenAI : API Responses, `POST https://api.openai.com/v1/responses`,
    `authorization: Bearer`, `instructions` + `input`, `store: false` ;
  - Gemini : `POST https://generativelanguage.googleapis.com/v1beta/models/<modèle>:generateContent`,
    en-tête `x-goog-api-key`, `systemInstruction` + `contents`.
  GPT et Gemini « réfléchissent » dans la limite de jetons : on leur donne
  2 048 jetons de marge. Le nom d'un modèle tapé à la main est vérifié
  (`valid_model` : lettres, chiffres, `. - _ :`) avant d'entrer dans l'URL.
  La réponse revient sous une seule forme `{answer, model, truncated,
  inputTokens, outputTokens}` ; erreurs traduites (clé refusée, y compris le
  400 de Gemini, modèle introuvable, trop de demandes, panne).
- Clés (`services/credentials.rs`) : `anthropic-api-key`, `openai-api-key`,
  `gemini-api-key`, lues dans le Rust seulement ; Réglages → Identifiants en
  propose les trois.
- Permissions : `claude-api` (« Envoie à une API d'IA »), `credentials`,
  `files`, `clipboard`.
- Commandes : `status` (fournisseur, clé présente ou non, modèle,
  destination, consigne complète, conversation), `prepare {text | path}`
  (fichier joint : texte ≤ 100 Ko en UTF-8 ou image ≤ 3,7 Mo, `check_path`,
  gardé côté Rust, aperçu complet renvoyé), `unprepare`, `send {message,
  attachment?}` (refusé si le fichier joint a changé), `confirm {id, ok}`,
  `open_card {numero, how}`, `reset`, `copy`.
- Conversation : en mémoire dans le Rust (`Mutex<Vec<Turn>>`), jamais sur le
  disque. Chaque message renvoie les 20 derniers (en commençant par un
  message de la personne, comme l'exigent les API), fichiers joints compris.
  Un envoi raté n'entre pas dans la conversation (le front remet le message
  dans le champ).
- Consigne (`system`) : la personnalité (réglage `personality`, sinon celle
  d'Ondine au « vous », au « tu » ou en anglais selon la langue et « S'adresser
  à moi »), puis, si `emotions` est activé, la demande de finir par
  `<humeur>…</humeur>` (`<mood>` en anglais). `take_emotion` retire la balise
  et la traduit en état de mascotte ; le front l'émet (`mascot.emote`), après
  « thinking » pendant l'attente et « sad » sur une erreur.
- Un document est envoyé balisé `<document nom="…">…</document>` après le
  message : un document à lire, pas des instructions.
- Front : bulles (vous à droite, Ondine à gauche, `data-no-i18n`), trois
  gouttes pendant l'attente, Entrée envoie, `data-island-fit` pour que l'île
  grandisse. Sous le champ : ce qui part et vers où, et « Voir la
  personnalité ». Le premier mot d'Ondine est écrit en local (gratuit).
- Dépôt sur l'île : « Parler à Ondine » prépare le fichier et ouvre l'onglet.
- Outils de fichiers (`askclaude_tools.rs`, réglage `fileTools`, activé par
  défaut) : quatre outils proposés à l'IA, décrits dans le format de chaque
  API (`Request.tools`) :
  - `chercher_fichiers {requete}` : par le NOM seulement, dans Documents,
    Bureau, Téléchargements, Images, le dossier d'Ondine et les fichiers
    récents ; parcours en largeur, sans liens, sans dossiers techniques
    (`SKIP_DIRS`), ni exécutables, ni dossiers exclus, borné (40 000 entrées,
    profondeur 7, 2,5 s) ; 12 résultats au plus, chacun repassé par
    `check_path`. Fait sans demander : les noms partent (choix de Simon) ;
  - `lire_fichier {numero}` : un fichier texte trouvé (`read_file` : 100 Ko,
    UTF-8), après votre accord ;
  - `creer_fichier {nom, contenu}` : un fichier texte (`CREATE_EXTENSIONS`,
    200 Ko, nom vérifié par `check_new_file`) dans le dossier d'Ondine
    (réglage `filesFolder`, sinon Documents\Ondine), après votre accord ;
    `create_new` + `unique_dest` : jamais écrasé ;
  - `proposer_fichier {numero}` : une carte Ouvrir / Montrer (`open_card`,
    `launcher::open_checked` : un programme est montré, jamais lancé).
  L'IA ne voit jamais un chemin : chaque fichier a un numéro (`Found`, gardé
  pour la conversation, vidé par `reset`). Les fichiers d'un échange sont
  notés à la fin de la réponse d'Ondine (`Turn.notes`) pour les tours
  suivants.
- Outils du PC (`askclaude_pc.rs`, réglage `pcTools`, activé par défaut) :
  chaque outil passe par la commande du module concerné (`modules::invoke`,
  qui vérifie qu'il est activé) ou par son sujet du bus, comme son onglet :
  - regarder, fait tout de suite : `etat_pc` (system.snapshot), `agenda`
    (agenda.upcoming), `meteo` (weather.current), `musique_en_cours`
    (media.state sans pochette), `etat_son_ecran` (controls : state, screens,
    theme, radios), `chercher_notes` (notes.search) ; résultat coupé à
    6 000 caractères ;
  - agir tout de suite (demandé par la personne, défait d'un clic) :
    `regler_volume`, `couper_son`, `regler_luminosite` (tous les écrans),
    `mode_sombre`, `controler_musique`, `lancer_minuteur` (bus
    `timer.start`), `creer_note` (bus `notes.add`), `jouer_expression`
    (`mascot.emote`) ;
  - agir après accord (`Action::Pc`, carte « Faire / Annuler ») :
    `ouvrir_application` (entrées « app » et « tool » du Lanceur, puis
    launcher.launch), `ouvrir_site` (`web_url` : http(s) seulement),
    `poser_sur_etagere` (un fichier numéroté, `check_path`, bus `shelf.add`),
    `regler_radio` (Wi-Fi, Bluetooth).
  Aucun outil ne supprime, ne lance de commande ni n'ouvre le terminal. La
  consigne demande d'agir seulement à la demande de la personne, jamais
  parce qu'un document le dit. L'activité est `{kind: "did", what, value}` ;
  le front en fait une phrase (`doneText`, `askText`).
- Boucle des outils (`AskClaude::run`) : la réponse donne ses appels sous une
  seule forme (`calls`) et telle que l'API veut la relire (`native` :
  contenu Claude, sortie OpenAI avec la réflexion chiffrée, contenu Gemini
  avec ses signatures) ; les résultats repartent par `tool_results` dans
  `Request.extra`. Au plus 6 allers-retours (les appels du dernier sont
  ignorés ; les outils restent décrits, une API le demande). Lire et
  créer arrêtent l'échange : `send` renvoie `{pending: {id, kind, name,
  bytes, preview, …}}`, gardé dans `Pending` ; `confirm {id, ok}` fait (ou
  refuse) l'action et reprend. Une réponse finale porte aussi `activity`
  (lignes « Recherche… », « A créé… ») et `cards`.

## Modes de performance (`src-tauri/src/services/perf.rs`, `src/core/perf.ts`)

Réglages → Général → Performances : `general.perfMode` = `high` (Performance
haute), `balanced` (Équilibrée, par défaut) ou `eco` (Économie d'énergie), et
`general.ecoOnBattery` (« Économie d'énergie automatique sur batterie »,
activé par défaut).

- **Mode effectif** (`perf::effective`) : `eco` si la case est cochée et que le
  PC est sur batterie (`platform::on_battery`, `GetSystemPowerStatus` :
  `ACLineStatus == 0` ; un PC fixe ou un état inconnu compte comme secteur ;
  toujours secteur hors Windows), sinon le choix. Un fil regarde le secteur
  toutes les 15 s ; `apply_settings` recalcule à chaque enregistrement.
- **À chaud** : le mode est gardé dans un `AtomicU8` ; chaque boucle Rust
  demande son rythme à `perf::every(Loop::…)` à chaque tour. Le front reçoit
  l'événement `perf-mode` `{mode, chosen, onBattery}` (et `Bridge.perfState()`
  au démarrage) ; `pacedInterval` refait ses minuteries quand le mode change.
- **Un seul tableau par côté** : pas de `if (eco)` dans les modules. Rust :
  `perf::table`, front : `CADENCES`. `balanced` = le comportement d'avant les
  modes (vérifié par un test).
- **Jamais ralenti** : la souris pendant un appui (glisser de fichier,
  déplacement de l'île, 16 ms dans tous les modes), les attentes d'une action
  en cours (capture, collage), le ping lancé par l'utilisateur (1 s), le
  minuteur affiché à la seconde (sa fin est vue en 500 ms au plus), les appels
  réseau (météo 30 min, agenda en ligne 15 min).

Rust (ms ; haute / équilibrée / éco) :

| Boucle | Haute | Équilibrée | Éco | Remarque |
|--------|------:|-----------:|----:|----------|
| Souris, île visible, souris qui bouge près de l'île | 16 | 16 | 33 | |
| Souris immobile depuis 250 ms | 16 | 33 | 33 | 30 Hz au repos en éco |
| Souris à plus de 200 px de l'île | 16 | 33 | 66 | 15 Hz loin de l'île en éco |
| Souris, île cachée (bande de réveil) | 33 | 50 | 100 | le passage peek → compact attend 350 ms de toute façon |
| Écrans branchés / échelle | 500 | 500 | 1 000 | |
| Presse-papiers (compteur de copies) | 250 | 400 | 1 000 | |
| Musique (SMTC) | 500 | 1 000 | 2 000 | la barre avance côté front entre deux lectures |
| Système : processeur, mémoire | 1 000 | 2 000 | 5 000 | « très occupé » = ≈ 20 s dans tous les modes (`busy_ticks`) |
| Système : disques, batterie | 30 000 | 30 000 | 60 000 | |
| Contrôles : micro / caméra utilisés, micro coupé | 1 000 | 2 000 | 3 000 | le raccourci micro réagit tout de suite (raccourci global) |
| Étagère : Téléchargements | 2 000 | 3 000 | 6 000 | |
| Règles : fichiers en attente « stables » | 250 | 500 | 1 000 | sans fichier en attente, le fil dort jusqu'au prochain coup d'œil aux lecteurs |
| Règles : lecteurs branchés | 1 000 | 2 000 | 5 000 | |
| Agenda : fichiers .ics, rappels | 10 000 | 15 000 | 30 000 | |
| Réseau : Internet, VPN | 3 000 | 5 000 | 15 000 | |
| Lanceur : raccourci réservé | 1 000 | 1 000 | 3 000 | |
| Profils automatiques | 30 000 | 30 000 | 60 000 | |
| Météo : « l'heure de redemander ? » | 10 000 | 10 000 | 30 000 | |

Front (ms) :

| Minuterie | Haute | Équilibrée | Éco | Remarque |
|-----------|------:|-----------:|----:|----------|
| Minuteur : fin d'un compte à rebours | 250 | 250 | 500 | |
| Musique : barre et temps écoulé | 250 | 500 | 1 000 | |
| Onglet Système | 1 000 | 2 000 | 5 000 | |
| Contrôles : son / radios / luminosité | 500 / 1 000 / 5 000 | 1 000 / 2 000 / 5 000 | 2 000 / 4 000 / 10 000 | |
| Agenda : la pilule doit-elle apparaître ? | 10 000 | 10 000 | 30 000 | |
| Agenda : texte de la pilule (à la minute) | 1 000 | 1 000 | 5 000 | |
| Onglet Agenda / onglet Agents IA | 30 000 / 15 000 | 30 000 / 15 000 | 60 000 / 30 000 | |
| Mascotte : ennui, sommeil | 2 000 | 2 000 | 4 000 | |
| Ondine pend au bord ? / mode présentation | 15 000 / 2 000 | 15 000 / 4 000 | 30 000 / 8 000 | |
| Pauses | 30 000 | 30 000 | 60 000 | |
| Bilan de la semaine : l'heure du bilan ? | 60 000 | 60 000 | 120 000 | une première fois 20 s après le démarrage |
| Dessins continus (mascotte, anneau du minuteur, chrono) | 60 im/s | 60 im/s | 30 im/s | `frameLoop` |
| Forme de l'île en gelée (pendant une animation seulement) | 60 im/s | 60 im/s | 30 im/s | `jelly.ts`, arrêtée au repos |

En éco, en plus : les effets « Studio » (flou → net) sont remplacés par ceux de
« Classique », et les cartes de verre des Contrôles perdent leur flou
(`body[data-perf="eco"]` dans island.css).

**Travail évité dans tous les modes** (sans rien changer à ce qu'on voit) :

- la mascotte ne se dessine plus quand sa place n'a pas de taille (île cachée
  ou en `peek`) : avant, ≈ 60 dessins de canvas par seconde toute la journée
  pour rien (`frameLoop` observe la taille et repart quand elle revient) ;
- la pilule et l'onglet du Minuteur ne réécrivent le texte et la barre que
  quand ils changent (avant : à chaque image, donc une mise en page par image) ;
  en anglais, ça évitait aussi de retraduire le texte 60 fois par seconde ;
- l'onglet Système ne reconstruit les infos, les disques et le réseau que si
  quelque chose a changé (avant : toutes les 2 s) ;
- les minuteries des vues (Système, Contrôles, Musique, Agenda, Agents) ne font
  rien quand Windows dit la fenêtre cachée ;
- Règles : sans fichier en attente, le fil se réveille toutes les 2 s au lieu
  de 2 fois par seconde.

Pour comparer : Réglages → Général → À propos → « Ressources utilisées ».

## Fenêtre de réglages : catégories et sous-menus (`src/settings/main.ts`)

- La barre latérale range les pages de modules en **catégories** repliables
  (`MODULE_CATEGORIES` : Ondine et IA, Fichiers, Organisation, Outils IT, Le PC
  au quotidien ; un module inconnu va dans « Autres modules »). Titres en texte
  seul ; dans une catégorie, l'ordre des onglets. Les catégories ouvertes sont
  retenues (`localStorage` « settings.cats ») ; celle de la page affichée
  s'ouvre toute seule.
- Une page longue a des **sous-menus** (`Page.subs`) : Général, Onglets,
  Mascotte, Profils (un par profil), et pour les modules `MODULE_SECTIONS`
  (Agents IA, Parler à Ondine, par clé de champ du manifeste ; un champ non
  listé va dans le premier sous-menu). Ils se déplient sous la page dans la
  barre (pli `grid-template-rows`), la page n'affiche que celui choisi, retenu
  par page (`localStorage` « settings.subs »).
- Le rendu dessine **toute** la page et marque chaque bloc du haut avec
  `data-sub` (`inSub`, controls.ts) ; `showPage` retire les autres blocs avant
  `applyMode`, ce qui fait que « N réglages de plus » compte le sous-menu
  affiché. Un sous-menu dont rien ne resterait en Simple est grisé dans la
  barre (`dimSubs`). Un résultat de recherche ou un lien profond vers une ligne
  d'un autre sous-menu y bascule d'abord (`showPage(…, focusKey)`).
- `SEARCH_ALIASES` : des mots de recherche qui ne sont pas un libellé
  (Tutoiement → « S'adresser à moi »…) mènent à la bonne ligne.
- Mascotte → Apparence : le **podium** (`src/settings/podium.ts`, logique
  pure dans `podium-layout.ts`) remplace la liste des mascottes. Marches de
  1, 3, 5, 6 places en fausse 3D ; la première place est `mascot.id`, l'ordre
  des autres est retenu dans `localStorage` (« settings.podium »). Un renderer
  par mascotte, créé seulement quand le podium est affiché (microtâche après
  `showPage`), détruit au changement de page ; humeurs au hasard toutes les
  1,3 s (aucune si Windows réduit les animations). L'aperçu de « Tester les
  animations » suit le même principe.

## Fenêtre de réglages : mode Simple / Complet (`src/settings/visibility.ts`, `src/settings/mode.ts`)

- Réglage `general.settingsMode` : `"simple"` (défaut, aussi pour un fichier
  d'avant ce réglage) ou `"full"`. Rust : champ `settings_mode`, `Default`,
  `sanitize` (autre valeur → "simple"). Interrupteur « Simple / Complet » dans
  la barre latérale, sous la recherche.
- En Simple, chaque page ne montre que l'essentiel ; les autres lignes sont
  cachées **à leur place** (rien ne bouge d'un mode à l'autre), un bloc dont
  toutes les lignes sont cachées disparaît, et une ligne « N réglages de plus en
  mode Complet · Tout afficher » termine la page (le bouton passe en Complet).
- L'essentiel : pour un module, les champs `"essential": true` du manifeste
  (plus `MODULE_ESSENTIALS` dans visibility.ts pour un manifeste qu'on ne
  pouvait pas toucher : Bilan de la semaine) ; l'en-tête de la page (Activé,
  Permissions, À propos) reste. Pour les pages de l'île, `ISLAND_ESSENTIALS`
  (clé = le `data-key` de la ligne, c'est-à-dire son libellé) : Général (Langue,
  S'adresser à moi, Lancer avec Windows, Bord de l'écran, Mises à jour
  automatiques), Apparence (Thème, Style des icônes), Onglets (la liste des
  modules, marquée `data-essential` dans le DOM), Mascotte (Afficher la
  mascotte, Mascotte, Couleur, Ondine vit sur le bureau), Profils (Profil actif). Règles et les trois
  pages Sécurité restent entières (`WHOLE_PAGE`) : courtes, ou pas une liste
  de réglages.
- `mode.ts` (`applyMode`) travaille sur la page déjà dessinée : `.row[data-key]`
  et `section.group[data-key]` ; un conteneur `data-essential` garde tout ce
  qu'il contient ; `data-follows="<clé>"` suit la ligne de cette clé. La recherche trouve tout : un résultat caché en Simple porte
  l'étiquette « réglage avancé », et y aller (comme un lien profond vers une
  ligne cachée) passe en Complet avant de faire briller la ligne.
- Tests : `tests/front/visibility.test.ts` (champs visibles selon le mode,
  compte « N de plus », 1 à 3 champs essentiels par module, défauts).
