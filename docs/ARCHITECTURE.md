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
│  │  ├─ scenes/              Ondine se déplace dans l'île (les 22 scènes, moteur de sauts)
│  │  └─ dom.ts               petite aide `el()` pour créer du HTML sans framework
│  ├─ mascot/
│  │  ├─ renderer.ts          contrat MascotRenderer + liste des moteurs
│  │  ├─ mascot-state.ts      machine à états de la mascotte, reliée au bus
│  │  ├─ catalog.ts           trouve et vérifie les mascottes de mascots/
│  │  ├─ types.ts             états, humeurs, format du manifeste
│  │  └─ renderers/            canvas-placeholder.ts, gum.ts, gum-anims.ts, gum-draw.ts, gum-shapes.ts, poses.ts, spritesheet.ts, overlays.ts
│  ├─ modules/
│  │  ├─ index.ts             LISTE DES MODULES (front)
│  │  ├─ home/                Accueil : la première page de l'île ouverte, faite de cartes (1.2.3)
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

**Les quatre bords.** `island.edge` = `top`, `bottom`, `left` ou `right`
(`Placement`, `frame_in` testé dans island/mod.rs). En bas, l'île se pose sur
la barre des tâches (le bas de la zone de travail), et s'ouvre vers le haut
(island.css `body[data-edge="bottom"]`, jelly.ts : marge de bosse en haut,
points collés en bas). L'aimant (`snap`) choisit le bord le plus proche des
quatre.

**L'île s'écarte des fenêtres** (`island/avoid.rs` : le calcul pur, testé ;
`island/dodge.rs` : le reste). Des sources donnent un rectangle à éviter :
`settings` (la fenêtre de réglages : ses événements Moved / Resized, montrée
par `show_window`, cachée par CloseRequested / `window_hide`), `foreground` et
`toast` (module Ondine et les fenêtres). `escape` : la maison libre → elle y
reste ; sinon elle glisse le long de son bord (côté le plus proche) ; bord
couvert → le bord libre le plus proche ; plus rien → le coin le plus loin,
« acculée ». La place trouvée est **provisoire** (`Placement::current`,
jamais enregistrée) ; plus rien ne gêne → elle rentre. La fenêtre de l'île y
va au ressort (thread de ~60 Hz, un peu amorti, interruptible ; acculée : un
tremblement de 3 px) ; Réduire les animations de Windows
(`winlife::reduced_motion`) ou mode Calme → directement. Le front reçoit
`island-placement` {edge, align, phase: flee | cornered | home, soft} : le
`data-edge` / `data-align` de `<body>` suivent, et Ondine a peur (`scared`,
`panic` acculée) puis est soulagée (`relieved`). Une source « douce »
(premier plan, bulle) : marge plus petite, ni peur, ni coin. Réglage
`island.avoidSettings` (oui). Le module peut aussi la **percher** sur la barre
de titre de la fenêtre active (`set_perch`, `perched_frame`, île du haut).
Scène démo « L'île s'écarte ».

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
  `data-island-fit="both"` : en largeur aussi (`--fit-w`, de 420 px ou la
  largeur des onglets jusqu'à 700 px), d'après la largeur naturelle
  (`max-content`) de la partie marquée `data-island-fit-w` (les bulles de
  Parler à Ondine). La mesure est continue (ResizeObserver sur le contenu
  marqué, texte observé) ; la gelée passe en « glisse » (`Jelly.setGlide` :
  ressort amorti sans rebond, qui garde sa vitesse) et `settle` ne la laisse
  rétrécir que nettement : pas de saut à chaque mot. Avec
  `data-island-fit-hold` sur le contenu marqué (un échange en cours dans
  Parler à Ondine), elle ne rétrécit pas du tout ; l'attribut retiré, elle
  reprend la bonne taille (l'observateur suit aussi ces attributs).
- **Changement d'onglet** (`switchTab`) : on ne redessine pas toute la vue. La
  pastille de l'onglet actif (`src/island/tab-pill.ts`) se déplace avec deux
  ressorts, un par bord : le bord qui mène est raide, celui qui suit est mou,
  donc la pastille s'étire puis se rétracte (effet « verre liquide »).
  L'ancien contenu s'efface d'un côté pendant que le nouveau arrive de l'autre,
  dans la même case de grille (`.view-stage`).
- **Barres de défilement** (`src/island/scrollbars.ts`, island.css) : pas de
  barre Windows à flèches dans l'île ni dans la bulle d'Ondine, mais une fine
  pastille grise translucide (`::-webkit-scrollbar`, 8 px de place toujours
  réservée : le contenu ne bouge pas). Elle n'apparaît qu'au survol d'une zone
  qui défile ou pendant le défilement, puis s'efface : une animation Web de la
  variable `--sb-a` (déclarée par `@property`, lue par la pastille), pas une
  transition CSS qui écraserait celles des zones. Ne pas mettre
  `scrollbar-width` / `scrollbar-color` dans ces pages : Chromium ignorerait
  alors ces règles.
- **Réduire les animations** (réglage d'accessibilité de Windows) : tout
  devient instantané (`reducedMotion()`, `prefers-reduced-motion`).

### Le halo de l'île (`src/island/halo.ts`, `halo-palettes.ts`, `halo-stack.ts`)

Un liseré de lumière qui court sur le contour de l'île et déborde autour, en
dégradés animés (jamais une couleur plate), avec des vagues qui partent de
l'île comme des ronds dans l'eau. Un `<canvas>` transparent sous l'île, de la
taille de la fenêtre, `pointer-events: none` ; branché par `attachHalo()` dans
le constructeur de `Island`.

- **API** (pour tous les modules et les autres zones) :
  `showHalo({ id?, palette, shape, rhythm, durationMs, fill, from, priority, level })`
  → id ; `updateHalo(id, { level?, fill?, palette? })` ; `hideHalo(id)` ;
  `haloAllowed(clé)` (module activé et case cochée) ; `ondineThinking(on)`
  (« Ondine réfléchit », trois gouttes). Par le bus : `island.halo`
  `{action: "show" | "hide" | "level" | "think", …}` (le module doit déclarer
  `island.halo` dans `emits`).
- **Formes** : `aurora`, `breathe`, `comet`, `sweep` (jusqu'à `fill`, depuis
  `from`), `burst` (flash + étincelles), `ripple` (une goutte tombe : fronts
  des deux côtés + ronds dans l'eau), `waves`, `drops`, `crackle`,
  `reservoir` (déborde en gouttes au-delà de 95 %), `rain` (palette `storm` :
  éclairs), `rise` / `set` (soleil qui monte ou descend), `cocoon`, `level`
  (suit `updateHalo(id, {level})`), `progress` (liseré d'un minuteur : se
  vide jusqu'à `endsAt` sur `total` ms, recalculé à chaque image, 12 i/s loin
  de la fin ; rouge dans les 10 dernières secondes (`progressWarn`) ; sans
  `endsAt` : figé à `fill`, la boucle s'arrête ; animations réduites / Calme :
  un pas toutes les 5 s). `fill` < 1 coupe n'importe quelle autre forme
  (une braise, une jauge).
- **Palettes** : `PALETTES` dans halo-palettes.ts, à UN seul endroit, écrites
  pour fond sombre ; sur fond clair (`prefers-color-scheme: light`),
  `forLightBackground` les fonce, sauf palette avec ses couleurs `light`. Les
  couleurs s'additionnent (`lighter`) en sombre. Réglages du module
  « Animations de l'île » : Couleurs (Selon l'état / Arc-en-ciel / Couleur de
  ma mascotte) et Intensité (Discret / Normal / Vif, `INTENSITY`).
- **Rythmes** : `slow` 6 s, `calm` 3 s, `medium` 1,5 s, `fast` 0,6 s,
  `heartbeat` (deux battements puis repos) ou une période en ms, jamais sous
  `MIN_PERIOD_MS` (450 ms : pas de clignotement fatigant).
- **Priorités** (`HaloStack`) : une seule demande montrée, la plus prioritaire
  puis la plus récente ; fondu au ressort (entrée qui dépasse un peu, sortie
  douce) ; la précédente revient quand elle finit. Même id = remplacement ;
  même id et même forme = continuité (le volume qu'on monte).
- **Géométrie** : à chaque image, la boîte de l'île (`getBoundingClientRect`,
  arrondis lus dans le style calculé, la gelée comprise) échantillonnée par
  `sampleContour` (contour.ts). Le côté collé au bord de l'écran est retiré des
  points (`visibleRun`) : une comète passe derrière le bord. Une mini-île a une
  lueur plus fine. Un appui sur l'île pendant un halo lance une onde de
  couleur depuis ce point.
- **Où le dessiner** (réglage `place` du module, 1.2.2, `PLACE` dans
  halo-palettes.ts) : `inside` (lueur interne, découpée sur l'île, rien ne
  dépasse ; ondes et étincelles vers le centre), `edge` (défaut : un liseré
  fin à cheval sur le bord, ~6 px au plus) ou `outside` (lueur fine autour,
  découpée hors de l'île, ~12 px au plus, `haloReach`). Dedans et sur le
  contour, le calque passe par-dessus l'île (`z-index: 1`, toujours
  `pointer-events: none`) et ne trace que la partie visible du contour (pas
  le côté collé à l'écran) ; les couleurs suivent alors le fond de l'île (un
  thème clair). Toute forme qui gonfle est tassée (`swell`, 1,3 × au plus) ;
  un halo qui reste (musique, visio, processeur, réseau…) est plus pâle
  (`lastingDim`, × 0,7). La fenêtre ne grandit jamais pour un halo : il est
  dessiné dans le panneau qui existe déjà. Aperçu en direct dans les
  réglages (`haloPreview`).
- **Performance** : une boucle `requestAnimationFrame` seulement quand un halo
  se voit (rien quand l'île est cachée ni sans halo) ; 30 i/s en éco et pour
  les halos lents (aurore, cocon, niveau, balayage arrivé). **Réduire les
  animations** ou **Calme** : un halo fixe dessiné une fois, sans vagues ni
  étincelles.
- Le module **Animations de l'île** (`src/modules/halos/`, Rust
  `modules/halos.rs`, `platform/halos.rs`) est l'interrupteur maître : coupé,
  aucun halo (`halosEnabled()`). Ses moments : sortie de veille (le fil dort
  1 s, l'horloge a sauté de plus d'une minute → `halos.wake`), Verr Maj /
  Verr Num (`GetKeyState`), Copié / Coupé / Collé (`GetAsyncKeyState` sur
  Ctrl, C, X, V seulement, aucun crochet ; Copié / Coupé seulement si le
  numéro du presse-papiers change dans 1,2 s ; le début du texte, 40
  caractères, jamais si le presse-papiers est marqué sensible), touches de
  volume, Wi-Fi sous 35 % (`wlanSignalQuality` : refusé sans la localisation
  depuis Windows 11 24H2), et `levels` : le niveau instantané du micro ou de
  la sortie (`IAudioMeterInformation::GetPeakValue`, aucun flux ouvert, rien
  n'est écouté). Le reste vient du bus (voir le tableau). Logique pure :
  `halo-rules.ts` (heure de partir en semaine, bonjour du matin, météo,
  comète des rendez-vous, jauge, niveau), testée par `tests/front/halo.test.ts`.
- **Batterie** (module Système, `battery-halo.ts`, règles `battery-rules.ts`) :
  branché = vague verte jusqu'au niveau + « En charge · 56 % », puis halo
  vert (`chargeHalo` : toujours / quelques secondes / jamais) ; chargée =
  éclat vert et doré ; débranché = balayage blanc + « Sur batterie · 82 % » ;
  faible = vagues orange 8 s puis une braise (`fill` 0,14) jusqu'au
  branchement, `mascot.emote` yawn ; critique = vagues rouges en battement de
  cœur jusqu'au branchement ou « Compris », `panic` (de nouveau toutes les
  45 s), puis `relieved` au branchement.

### Le liquide à l'intérieur de l'île (`src/island/liquid.ts`, `liquid-rules.ts`, `src/modules/halos/liquid-moments.ts`)

Un liquide (eau, gelée, lumière, sable) qui remplit l'île DERRIÈRE son
contenu : une surface qui ondule, des bulles, une légère physique. Un
`<canvas>` premier enfant de l'île, `z-index: -1` (l'île crée sa pile avec
`translate`) : au-dessus de son fond, sous le texte et la mascotte, rogné par
la découpe de la gelée ; il suit donc les 4 bords et la mini-île. La gravité
reste celle de l'écran (l'eau monte du bas de l'île). Branché par
`attachLiquid()` dans le constructeur de `Island`.

- **API** : `showLiquid({ id?, level, endsAt, total, direction: "fill" | "drain",
  tint, murky, bubbles, current, wobble, vibrate, bpm, overflow, priority,
  durationMs })` → id ; `updateLiquid(id, {…})` ; `hideLiquid(id)` ;
  `liquidDrop()` (une goutte et des ronds), `liquidWave()` (une vague
  traverse), `liquidDive()` (Ondine plonge et ressort) ;
  `setLiquidAmbience("rain" | "boil" | "stars" | "still", on)` ;
  `liquidEnabled()`, `liquidAllowed(clé)`. Par le bus : `island.liquid`
  `{action: "show" | "update" | "hide" | "drop" | "wave" | "dive" | "ambience", …}`
  (le déclarer dans `emits`). Priorités : la même `HaloStack` que les halos.
- **Physique** (`liquid-rules.ts`, testé par `tests/front/liquid.test.ts`) :
  48 colonnes reliées à leurs voisines (`stepSurface`, petits pas de 1/240 s) ;
  vaguelette au clic (`splash`), bulle qui éclate, goutte qui tombe ; la pente
  est un ressort poussé par l'accélération de l'île à l'écran
  (`window.screenX` + boîte de l'île : déplacement, écart d'une fenêtre,
  étirement de la gelée) ; une accélération verticale soulève la surface.
  Matières (`FEEL`) : la gelée a des vagues lentes et molles, la lumière
  s'additionne (`lighter`) avec des étincelles, le sable presque sans vagues
  ni bulles, avec un grain.
- **Lisibilité** : `readablePaint` assombrit la couleur (puis baisse
  l'opacité) juste assez pour que le texte secondaire (`--muted`) garde 4,5:1
  sur le fond de l'île, vu au pire sur un bureau blanc pour un fond
  transparent (thème Verre) ; une lumière qui devrait disparaître est posée
  normalement. Vérifié pour chaque thème et chaque couleur par les tests.
- **Ondine** : île pleine (≥ 90 %) → `mascot.emote` `calm` une fois et elle
  flotte (classe `liquid-float` : `translate` / `rotate` en CSS sur
  `.mascot-canvas`, rien dans le moteur des mascottes) ; débordement d'un
  minuteur → `surprised` et une bouée dessinée derrière elle ; téléchargement
  → `liquid-dive` (`hide` puis `proud`).
- **Performance** : aucune boucle sans liquide, île cachée (ou en trait) ni
  page cachée ; 60 i/s quand ça bouge (bulles, vagues, pente, agitation),
  24 i/s quand seule la surface ondule ; moitié en éco. Le lac
  (concentration) posé : la boucle s'arrête (redessin toutes les secondes s'il
  suit un minuteur). Réglages et couleurs du thème lus une fois par changement.
  **Réduire les animations** ou **Calme** : figé (surface plate, sans bulles),
  redessiné toutes les 5 s s'il suit un minuteur.
- **Moments** (`liquid-moments.ts`, appelé par le module Animations de
  l'île) : minuteurs (`timer.progress` : monte, descend en pause Pomodoro,
  s'agite dans les 10 dernières secondes, déborde ; « off » qui suit « done »
  ignoré 3,2 s), fichiers (`shelf.hash-progress`, `team.progress`,
  `shelf.downloaded`), batterie (`system.battery-*` : vert en charge, fond
  orange ou rouge quand elle est faible), disque (`system.disk-low` : eau
  trouble), agents (`claude.thinking` : courant ; `agents.progress` : niveau ;
  fin : vague), musique (commande `levels`, et `media.tempo` / `mascot.dance`
  `{bpm}` quand le tempo sera publié), voix (`voice.level`), pluie
  (`weather.updated`), processeur (`system.cpu-busy`), nuit (22 h – 6 h),
  notification (`notify.shown`, sauf les petits retours du clavier),
  concentration (`timer.focus`).
- **Réglages** (L'île → Animations et halos, sous-menu « Le liquide ») : `liquid` (oui), `liquidMatter` (`water`), `liquidColor`
  (`island` : l'accent du thème ; ou mascotte, couleurs nommées,
  `custom` + `liquidCustom`), `liquidOpacity` (50 %), `liquidTimerStyle`
  (`both` : avec le liseré, ou `replace` : `ringReplaced()` coupe le liseré
  dans halos/index.ts), une case par moment (`liquidMusic` et `liquidNight`
  décochées par défaut). Scènes démo : « Minuteur qui se remplit »,
  « Ambiances dans l'île », « Ondine qui flotte ».

### Format nano et île-bouche (1.2.3, `src/island/island-forms.ts`)

Deux options d'Apparence (Réglages → L'île → Apparence → « Forme de l'île »),
branchées par `IslandForms` (island.ts n'a que quelques appels : réglages,
transitions, souris, `pushRect`, fin de `render`). Styles : `src/styles/island-mouth.css`,
chargé après island.css (index.html, pet.html). Tests : `tests/front/island-state.test.ts`
(formes), `tests/front/mouth.test.ts` (géométrie, règles).

| Réglage | Valeurs | Défaut |
|---|---|---|
| `island.size` | `normal`, `nano` | `normal` |
| `island.style` | `classic`, `mouth` | `classic` |
| `island.mouthFollow` | oui / non (seulement en style bouche) | oui |

**Format nano.** L'état `compact` garde son nom mais a deux formes
(`IslandStateMachine.form()` : `nano` | `mini`, annoncées par `onForm`, posées en
`data-form` sur l'île) : l'encoche de 76 × 34 qui ne montre qu'Ondine (34 × 76 sur
un côté), ou la mini-île. Raisons d'être en mini (`wideReasons`) : le survol depuis
120 ms (idée 1 ; retour à l'encoche 320 ms après le départ de la souris, sans clic),
une notification affichée (`hold`), un coup d'élargissement (`pulse(ms)`) ou une
activité qui dure (`setBusy`). `src/island/nano-rules.ts` traduit le bus : nouveau
morceau ou reprise (`media.changed`), minuteur qui démarre ou sonne
(`timer.progress`, `timer.done`), agent qui commence, finit ou attend
(`claude.thinking`, `agents.event`, `agents.ask`) → `pulse` ; la voix
(`voice.listening`) → `setBusy`. Ce qui dure sans demander d'attention devient un
point coloré à côté de l'encoche (idée 3, `.nano-dots`, `dotPlaces`) : musique
(vert), agent au travail (violet), minuteur (or), voix (rose), trois au plus.
Idée 2 : 12 s sans rien en nano → Ondine somnole (`sleep`, classe `dozing`) ; la
souris à moins de 140 px → elle ouvre un œil (`wink`, et en style bouche un seul œil
ouvert, celui du côté de la souris) ; le survol la réveille. Seule l'encoche (et
pas toute la bande de 240 px du bord) déclenche le survol.

**Île-bouche.** Ondine est suspendue tête en bas au bord de l'écran ; l'île est sa
bouche. L'île garde tout (contenu, gelée, clics) ; `MouthBody` (`src/island/mouth.ts`)
dessine le corps autour dans un `<canvas class="mouth-body">` de la taille de la
fenêtre, AU-DESSUS de l'île (`z-index: 1`, `pointer-events: none`), la bouche y
étant un trou (règle evenodd). À chaque image où quelque chose bouge, il relit le
rectangle de l'île (gelée comprise) et pose le corps autour (`layoutMouth`,
`src/island/mouth-geom.ts`) : les mesures sont interpolées entre les trois formes de
la maquette d'après l'épaisseur de la bouche (`openness` : 7 px → nano, 41 → mini,
200 → ouverte). Le corps suit donc la même gelée que l'île.
- *Tailles* (island-mouth.css) : nano = bouche fermée 20 × 7 à 11 px du bord (corps
  66 × 58 + pointe 15) ; mini = 318 × 40 à 6 px (corps 334 × 76, langue rose côté
  bord) ; ouverte = les tailles habituelles de l'île, à 4 px (liseré de 4 px, yeux
  étirés). La lèvre entre bouche et bord est `top` (ou `bottom`, `left`, `right`),
  avec une transition CSS ; jamais `translate`. Volume conservé : lèvres et zone des
  yeux ne font que diminuer quand la bouche s'ouvre (testé).
- *Matière* (`src/island/mouth-draw.ts`) : les couches de gum-draw.ts (ombre,
  dégradé de bonbon, volume, lueur intérieure, liseré clair, contour foncé `c[3]`,
  grand reflet, point brillant, reflet du bas), dans la palette de `mascot.color`
  (`mascotPalette`, « auto » = le bleu de la goutte, arc-en-ciel et couleur libre
  compris). Le corps est construit dans le repère de la bouche puis coloré dans
  celui de l'écran : la lumière reste en haut à gauche quand Ondine tourne.
- *Gestes* : pincement de 90 ms avant d'ouvrir depuis la nano (classe
  `mouth-pinch`, une cible de 14 × 4 pour la gelée) ; en refermant, petit rebond
  (`kick`) et clignement 380 ms plus tard ; alerte : `kick` + le choc de jelly.ts ;
  dépôt : grande bouche (état `drop`), puis gloups (rebond + clignement) ; clignements
  au repos (2,6 à 5,8 s, pas en Calme) ; reflets des yeux qui suivent la souris
  (`glintOffset`). Masquée : le corps glisse derrière le bord (ressort `retreat`) ;
  aperçu (`peek`) : seule la pointe dépasse. Bords bas, gauche, droit : `dirForEdge`
  (la tête reste vers le bord). Les visites au bord (hang.ts) sont remplacées par un
  étirement et deux clignements (`visit`) : Ondine y est déjà.
- *Halo et liseré* : `setHaloShape` (halo.ts) leur donne le rectangle et les arrondis
  du corps au lieu de ceux de l'île.
- *Souris* : `pushRect` envoie au Rust le rectangle de l'île ET du corps
  (`hitRect`) ; un clic sur le corps ouvre l'île. Le reste de la fenêtre laisse passer
  les clics ; la fenêtre 720 × 320 a déjà la place des yeux et de la pointe (24 px
  sous l'île ouverte), aucun changement côté Rust.
- *Réduire les animations* : ni pincement, ni rebond, ni clignement ; masquée = fondu.
- *Performance* : une boucle `requestAnimationFrame` qui s'arrête 24 images après le
  dernier changement (30 i/s en éco) ; rien au repos.
- *Ondine sortie* (Ondine sur le bureau). Avec `mouthFollow` (défaut) : la bouche du
  haut part (`body.mouth-away`, la fenêtre de l'île redevient la bande, sa machine à
  états continue) et c'est Ondine qui fait l'île-bouche là où elle est (voir « Ondine
  sur le bureau ») ; l'île lui publie `island.mouth` {form: nano | mini | alert | off,
  text, icon, dots} à chaque dessin. Portée au-dessus de l'île, ou l'île entière
  demandée (un onglet absent de sa bulle), la bouche du haut revient le temps qu'il
  faut. Sans `mouthFollow` : une bouche en gomme vide (sans yeux) reste au bord et
  marche comme d'habitude ; Ondine revenue, les yeux réapparaissent avec un rebond.
- Les scènes où Ondine se déplace lisent `island.style` (pas jouées en style bouche).

### La file de notifications (`src/core/notifications.ts`)

Un module **demande** l'attention (`api.notify({...})`), l'île **décide** :
une seule notification visible ; tri par priorité (`critical` > `high` > `normal`
> `low`) puis par arrivée ; une plus prioritaire passe devant tout de suite ;
`high`/`critical` ouvrent l'île en `alert`, `low`/`normal` s'affichent dans l'île
compacte (ou en bandeau dans l'île ouverte) ; même `key` = remplacement ;
`sticky` = reste jusqu'à fermeture ; 20 en attente au plus.

### Version 1.2.3 : verre clair, molette, double-clic, halo pochette, reflets

**L'île en verre clair** (thème « Givre », `src/island/themes.ts`,
`light-island.ts`, `light-rules.ts`, `src/styles/island-design.css`). Un
thème peut être clair (`light: true`) et donner son texte (`fg`) :
`applyTheme` pose alors `--island-fg` et `<html data-theme-tone="light">`.
island.css est écrit pour une île sombre (texte clair, surfaces en blanc
translucide) ; plutôt que de dupliquer ses règles, `applyIslandTheme` relit
une fois les feuilles de la page (CSSOM) et insère, **juste après chaque
règle qui a des couleurs**, la même règle limitée au thème clair :
`:where(:root[data-theme-tone="light"]) <sélecteur>`. `:where` n'ajoute pas
de spécificité et l'insertion juste après garde l'ordre : la cascade reste
exactement celle de l'île sombre. Les couleurs (`flipColor`) : une couleur
neutre suit l'échelle papier (#fafbfd) → encre (#1b1e2b) à l'envers (le
blanc translucide d'une pastille devient de l'encre translucide, même
opacité) ; un texte (ou un trait d'icône) est foncé juste assez pour 4,5:1
sur le pire fond du verre (son blanc à 88 % au-dessus d'un bureau noir,
#dcdde0) ; un élément de couleur vive (pastille rouge, `var(--glow)`) est
laissé tel quel, texte compris ; le texte d'une surface qui devient sombre
(bouton `var(--accent)`, foncé en clair) est seulement retourné
(`ownBackground`) ; une ombre reste une ombre ; ni les masques ni les images
`url(…)` ne changent. Un raccourci qui contient `var(…)` est lu entier (le
navigateur ne le découpe pas). Pas retournés : les `@keyframes`, les couleurs
posées en JS dans `style`, les canvas (halo et liquide lisent le fond de
l'île : `readablePaint` éclaircit le liquide au lieu de le foncer sur une île
claire, et `cssToHex` voit un fond clair translucide au-dessus d'un bureau
noir). La matière (grain SVG en `data:`, reflet, liseré) est dans
island-design.css. Le style île-bouche (`island.style = "mouth"`) garde une
île sombre (`effectiveThemeId`). La bulle d'Ondine sur le bureau suit le même
thème (src/pet/main.ts).

**Molette = volume** (`src/island/volume-wheel.ts`, `wheel-volume.ts`,
`src/modules/controls/wheel.ts`). Au simple survol, sans clic : la fenêtre ne
prend pas le focus, mais Windows envoie la molette à la fenêtre sous la souris
(« Faire défiler les fenêtres inactives », actif par défaut) et la forme de
l'île prend la souris dès qu'elle la survole. Mini-île, trait, alerte et
format nano : partout ; île ouverte : seulement sur la mascotte (ailleurs, la
molette fait défiler). L'île compte les crans (2 % par cran, petits pas d'un
pavé tactile additionnés) et publie `island.wheel {delta}` ; le module
Contrôles (réglage `wheelVolume`, oui) change le volume des haut-parleurs par
défaut (un envoi à la fois, les crans arrivés entre-temps partent ensemble ;
monter rétablit le son coupé) et répond `controls.volume {volume, muted,
source: "wheel"}` ; une capsule (haut-parleur au trait + jauge) apparaît sur
le bord intérieur de l'île, en gelée, et s'efface 1,3 s après le dernier cran.

**Double-clic sur Ondine** (`src/island/mascot-double-click.ts`, réglage
`mascot.doubleClick` : `ask` (Parler à Ondine, défaut), `launcher`, `capture`,
`note`, `none` ; Réglages → Mascotte → Humeur). Les clics gardent leurs
réactions (`mascot.clicked` part à chaque clic : sourire, rire, agacement,
étourdissement, surprise « split ») ; l'action ne part que 260 ms après le
deuxième clic si aucun troisième n'est venu (`DoubleClick`, testé). Une
pancarte « ? » (agent qui attend) et Ondine qu'on tire hors de l'île gardent
la priorité. Actions : `registry.onOpenRequest("askclaude")`,
`launcher.open`, `capture.request {then: "save"}`, `notes.quick` (nouveau :
l'onglet Notes s'ouvre sur une note neuve). Module de l'action désactivé :
une ligne dans l'île.

**Halo aux couleurs de la pochette** (`src/island/cover-palette.ts`,
`src/mascot/env-tint.ts`, module halos). La pochette déjà réduite à 12 × 12
pour les reflets de la mascotte donne aussi 2 ou 3 couleurs : pixels rangés
en 12 tranches de teinte (pondérés par la saturation), les trois plus
présentes, rendues vives (`coverPalette` ; une pochette grise : null).
`onCoverColors` prévient le module halos : le halo de la musique (forme
`level`) et celui de la danse prennent ces couleurs, et les changent sans
s'éteindre au morceau suivant. Réglage `musicCover` (oui) dans « Son et
clavier » ; le choix « Arc-en-ciel » / « Couleur de ma mascotte » l'emporte.
Rien ne quitte la fenêtre.

**Plusieurs écrans : les reflets** (`src-tauri/src/island/mirrors.rs`,
`mirror.html`, `src/mirror/main.ts`, `src/styles/mirror.css`). Réglage
`island.otherScreens` (coupé par défaut ; L'île → Comportement). Choix : l'île
reste UNE fenêtre (un seul état : une notification, un minuteur, une page) et
chaque autre écran reçoit un « reflet », une petite fenêtre (76 × 24 px
logiques, au même bord et à la même place que l'île, `mirror_frame` sur
`frame_sized`) qui montre une encoche aux couleurs du thème avec Ondine qui
somnole (SVG + respiration CSS, rien sans « Réduire les animations »). Une
île qui suit seulement la souris (`general.screen = "cursor"`, qui existait)
ne montre rien sur les autres écrans et saute d'écran même ouverte ; une île
complète par écran multiplierait l'état et le coût. Les reflets sont
transparents aux clics, hors Alt+Tab et barre des tâches ; c'est la boucle de
la souris qui regarde s'il en touche un (`hover`, une liste vide quand c'est
coupé) : l'écran touché devient l'écran de l'île (`chosen_monitor`, lu par
`target_monitor`, oublié au redémarrage), la fenêtre y va, l'île s'ouvre en
mini-île (`mirror-arrive` → `showCompact`), un reflet apparaît sur l'écran
quitté. La vérification des écrans (2 fois par seconde) place, montre ou cache
les reflets (`sync` : écran débranché, présentation en cours, réglage coupé)
et leur renvoie l'apparence quand elle change (`eval` de
`window.__ondineMirror`). Une fenêtre de reflet est créée à la demande (hors
du fil principal), et montrée seulement après que sa page a demandé son
apparence (`mirror_look`) : jamais un rectangle blanc. Capacité : `mirror-*`
dans `capabilities/default.json`.

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
- **Carte d'accueil** (facultatif, 1.2.3) : `api.homeCard({ title, icon, view })`
  dans `setup` propose une carte à l'onglet Accueil (voir « Accueil »).
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
| `mascot.emote` `{emotion, intensity?, mix?, mixK?, side?}` | tout module | montre cette émotion (un état, ex. `sad`) ; si la mascotte ne l'a pas, une expression proche (`EMOTE_NEAR`, types.ts). `intensity` (0 à 1) la dose, `mix` (un autre id) + `mixK` la mélange, `side: "left"` la joue de l'autre côté. Les ids de la 1.2.2 : panic, scared, relieved, stretch, yawn, surprised, listening, sunglasses, scarf, goodbye, push, sit-edge (en boucle : renvoyer `idle` pour finir), laugh, hide, tap-glass, climb, talk |
| `mascot.talk` `{open, mark?}` | voix (Parler à Ondine) | la bouche suit la voix : `open` de 0 à 1 au rythme des syllabes (sans message pendant 180 ms, elle se referme) ; `mark` `"?"` ou `"!"` : les sourcils montent. Au repos ou attentive, elle passe en `talk`, puis revient au repos 1,5 s après le dernier message |
| `agents.ask`, `agents.event` « waiting » | Agents IA | question (la goutte violette et son « ? ») |
| `mascot.state` | mascotte | |
| `mascot.look-at` `{x, y}` | tout module (l'Accueil…) | elle regarde ce point (px de la fenêtre de l'île) pendant 1,5 s ; la souris ne la fait pas regarder ailleurs entre-temps (src/island/scenes/) |
| `mascot.long-press` | île (appui long de 550 ms sur Ondine, sans la déplacer) | 1.2.4 : le module Jeux ouvre le morpion express dans la mini-île |
| `games.play` `{game}` | Lanceur, Jeux | 1.2.4 : `connect4`, `ttt`, `aquarium`, `race` ouvrent l'onglet Jeux sur ce jeu ; `ttt-express` : le morpion de la mini-île |
| `games.changed` `{gained}` | Jeux (Rust, games.rs) | 1.2.4 : l'aquarium a changé (gouttes gagnées, achat) ; les vues redemandent `state` |
| `pauses.taken` `{minutes}` | Pauses | 1.2.4 : une vraie absence (5 min au moins), une fois par absence ; l'aquarium y gagne des gouttes |
| `mascot.walk` `{active}` | île (src/island/scenes/) | elle quitte sa case (`true`) ou y revient (`false`) pendant une scène |
| `mascot.scene` `{scene, name?, demo?}` | Notes, Règles, mode démo | joue une scène d'Ondine qui se déplace (`note-save`, `rules-run` {name}…) ; `demo: true` : sur le premier élément venu, l'onglet s'ouvre d'abord |
| `mascot.dance` `{on}` | surprises (src/eggs/) | elle danse en boucle (musique + mini-île) ; les autres réactions passent puis la danse reprend |
| `shelf.downloaded`, `timer.done`, `clipboard.link-cleaned`, `capture.done`, `controls.usb-ejected`, `system.disk-low` | modules | une courte réaction de la mascotte (voir « La famille gomme ») |
| `agents.ask` / `agents.ask.closed` | Agents IA | la pancarte « ? » tant qu'une question est ouverte |
| `mascot.sign` `{text, secs?}` | Règles (action pancarte), Équipe (statut changé à la main) | 1.2.3 : elle lève une pancarte avec ce mot (14 caractères, 8 s par défaut, 2 s à 10 min) au-dessus de sa tête ; `text` vide ou un clic sur elle : elle la baisse ; le « ? » d'un agent passe avant (`src/mascot/sign-text.ts`) |
| `easter.word` `{word}` | Lanceur (mot magique + Entrée) | une surprise : `code-rain`, `retro`, `barrel-roll`, `answer` |
| `easter.snack` | réglages (bouton « Essayer ») | Ondine mange la mini-île au prochain passage en mini |
| `undo.offered` / `undo.done` / `undo.expired` | service d'annulation | bouton « Annuler » |
| `module.crashed` | Rust | l'île prévient |
| `shelf.changed` `{items}` | Étagère (Rust) | la vue de l'étagère se redessine |
| `media.changed` `{playing, artwork}` | Musique (Rust) | la pilule et l'onglet Musique se mettent à jour |
| `capture.done` `{action, ok, result, error}` | Capture (Rust) | notification ; l'onglet redemande le texte lu (`last`), qui n'est pas dans le message |
| `shelf.add` `{paths}` | Capture (Rust) | l'Étagère valide les chemins et les pose sur l'étagère |
| `clipboard.changed` `{count}` | Presse-papiers (Rust) | l'onglet redemande la liste (le message ne contient aucun texte copié) |
| `clipboard.secret-ignored` `{kind, decodable}` | Presse-papiers (Rust) | 1.2.4 : une copie qui ressemblait à une clé n'a pas été gardée ; petite notification « Clé ignorée » (`kind` = la famille, jamais le texte) |
| `timer.done` `{title}` | Minuteur (front) | (la notification et le son sont faits par le module) |
| `dictation.state` `{phase, engine}` | Dictée (Rust) | 1.2.4 : `phase` = `idle`, `listening`, `handsFree` ou `thinking` ; `engine` = `parakeet`, `windows`, `offline` ou `api` |
| `dictation.history` `{entry}` | Dictée (Rust) | une dictée vient d'être collée (`entry` null si l'historique n'est pas gardé) : les pages Voix se rechargent |
| `callnotes.start` / `callnotes.stop` | pilule, page Dictée | 1.2.4 : demandent à Notes d'appel de commencer / d'arrêter l'enregistrement |
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
| `timer.progress` `{id, phase, state, endsAt, total, left}` | Minuteur (front) | un compte à rebours change (`id` "timer" ou "pomodoro", `state` running / paused / off / done) : Animations de l'île dessine le liseré qui se vide (réglage `timerRing`), un éclat à `done` |
| `timer.work-session` `{seconds, completed}` | Minuteur (front) | une séance de travail Pomodoro s'arrête (finie, en pause, passée, remise à zéro, module coupé) : Bilan de la semaine ajoute le temps, et un Pomodoro si `completed` |
| `notes.todo-toggled` `{done}` | Notes (Rust) | une tâche cochée (`true`) ou décochée : Bilan de la semaine compte (jamais le texte de la tâche) |
| `weekly.show` | réglages (« Voir le bilan maintenant ») | Bilan de la semaine montre la semaine en cours (`peek`), sans rien consommer |
| `app.whats-new` | réglages (« Voir les nouveautés ») | l'île montre « Quoi de neuf dans Ondine X.Y.Z » pour la version installée |
| `controls.usb-added` `{root, letter, label, removable}` | Contrôles (Rust, fil de fond, réglage `usbNotify`) | notification 🔌 « Clé USB branchée » avec « Ouvrir » et « Éjecter » |
| `controls.usb-ejected` `{root, letter, label, removable, ok, veto?, blocker?, error?, code?}` | Contrôles (Rust, fil d'éjection) | notification ✅ « Vous pouvez retirer la clé E: en toute sécurité. », ou ⚠️ avec qui bloque ; la bande USB de l'onglet se met à jour |
| `shelf.hash-progress` `{job, percent}` | Étagère (Rust, cible « Empreinte ») | la notification « Empreinte SHA-256 : 45 % » (une fois par seconde, au-delà de 64 Mo) |
| `shelf.hashed` `{job, algo, compared, cancelled, results: [{name, hex, matches} ou {name, error}]}` | Étagère (Rust) | notification « Identique ✓ » / « Différente ✗ » ou l'empreinte, avec « Copier » (`hash_copy {job}`) ; le texte copié n'est jamais dans le message |
| `system.battery-plug` `{plugged, percent, charging}` | Système (Rust, à chaque tour) | chargeur branché / débranché (jamais au démarrage, rien sur un PC fixe) : halo vert ou blanc, « En charge · 56 % » |
| `system.battery-critical` `{percent}` | Système (Rust) | sous `batteryCriticalPct` (10 %), une fois jusqu'au branchement : alerte « Batterie critique », halo rouge, Ondine panique |
| `island.halo` `{action, id, palette, shape, …}` | tout module (le déclarer dans `emits`) | allume, règle ou éteint un halo (`action: "think"` : Ondine réfléchit), voir « Le halo de l'île » |
| `island.liquid` `{action, id, level, …}` | tout module (le déclarer dans `emits`) | remplit l'île de liquide, le règle ou le vide ; `drop`, `wave`, `dive`, `ambience` {name, on} : voir « Le liquide à l'intérieur de l'île » |
| `media.tempo` `{bpm}` | (à venir : analyse du tempo pour les danses) | la surface du liquide pulse au temps de la musique |
| `halos.wake` `{secs}` / `halos.lock-key` `{key, on}` / `halos.clip` `{action, text?}` / `halos.volume` `{volume, muted}` / `halos.wifi` `{quality}` | Animations de l'île (Rust) | les halos correspondants et une ligne dans l'île (« Verr Maj · Activé », « Copié ») |
| `capture.gif` `{state: recording / encoding / done / cancelled / error, …}` | Capture (Rust) | notification avec « Arrêter », puis « Création du GIF… », puis « GIF enregistré » (« Montrer dans l'Explorateur ») ; le bouton de l'onglet suit l'état |
| `voice.listening` `{on, look}` | Parler à Ondine (Rust) | début / fin de l'écoute à voix haute : le halo de l'île (zone halos) et la mascotte peuvent s'y brancher |
| `voice.level` `{level}` | Parler à Ondine (Rust, ~15 fois par seconde pendant l'écoute, 0 à la fin) | niveau du micro 0..1 : le halo tremble avec la voix |
| `askclaude.voice` `{kind, …}` | Parler à Ondine (Rust) | pour le front du module : `open {look, hold}`, `partial {text}`, `transcribing`, `final {text, look}`, `empty`, `cancel`, `blocked {why: call / presentation / focus}`, `error {message}` |
| `mascot.talk` `{open, brow?}` | Parler à Ondine (front) | à chaque syllabe de la réponse qui s'écrit : la bouche s'ouvre (0..1) et se referme seule (~120 ms) ; `{open: 0}` à la fin ; `brow` : `"question"` sur « ? », `"exclaim"` sur « ! » (animation : zone mascottes) |
| `team.changed` | Équipe (Rust) | l'onglet redemande l'état (`state`) : collègues, présence, demandes, voisines |
| `team.event` `{kind, from, …}` | Équipe (Rust) | ce qui arrive d'un collègue : `ping`, `ask`, `answer`, `visit`, `incoming` (à accepter), `received`, `sent`, `declined`, `invite`, `invite-reply`, `poll`, `vote`, `pomodoro`, `announce`, `status-report`, `rdp-reply`, `paired`, `pair-failed`… → notifications |
| `team.progress` `{id, name, percent, dir}` | Équipe (Rust) | la notification « Envoi / Réception en cours » remplacée à chaque étape |
| `callnotes.start` / `callnotes.stop` | pilule de dictée (1.2.4) | Notes d'appel commence / arrête l'enregistrement d'un appel |
| `callnotes.state` `{recording, startedAt}` | Notes d'appel (Rust) | début / fin d'un enregistrement : la pilule passe au corail avec le temps écoulé ; l'île montre le point rouge |
| `callnotes.changed` `{id}` / `callnotes.error` `{message}` | Notes d'appel (Rust) | la page redemande la note (jamais de texte dans le message) / un démarrage par la pilule a échoué |

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
  (Réglages → Sécurité et système → À propos) ouvre dans le navigateur une issue GitHub
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
- **Reconnaissance vocale sur le PC** (`speech.rs`, `speech_models.rs`,
  `speech_audio.rs`, 1.2.4) : Parakeet par sherpa-onnx, modèles téléchargés au
  clic. Voir « 1.2.4 : reconnaissance vocale sur le PC (Parakeet) ».

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
  mischief, focus, moved, embarrassed, yawn, pensive, cheer, et ceux de la 1.2.2 (demandés par mascot.emote) : panic, scared, relieved, stretch, surprised, listening, sunglasses, scarf, goodbye, push, sit-edge, hide, tap-glass, climb, talk. Un état que la mascotte n'a pas retombe sur `fallback` (et le contrôleur
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
  le clignement se ferme en 70 ms et se rouvre en 130 ms (toutes les 2,2 à
  5,4 s, deux fois de suite une fois sur cinq environ). `react()` reçoit ce qui
  arrive à l'île (clic, étirement, lâcher, secousse). Avec « Réduire les
  animations », tout va directement à sa cible, chaque animation est une image
  fixe, et on ne redessine plus tant que rien ne change.
  Depuis la 1.2.2 (tout lissé selon le temps écoulé, même rendu à 30 ou 60 i/s) :
  - *Yeux* : un iris (l'encre teintée par la couleur du bonbon) et une pupille
    qui se dilate (contente, amoureuse : `Face.pupil` > 1) ou se serre
    (surprise, peur) ; les pupilles partent avant la tête (`look` rapide, `head`
    lent : le visage glisse sur le volume) ; le point de lumière reste où est la
    lampe quand l'œil tourne ; l'œil s'aplatit un peu de côté.
  - *Lumière* (`GumScene.light`) : vers la souris quand elle bouge près d'elle,
    sinon l'heure (de gauche à 7 h à droite à 19 h). Le reflet glisse dans le
    corps, le dégradé, la lueur du bas (à l'opposé de la lampe) et l'ombre
    suivent. Les reflets prennent un peu la couleur de la pochette en lecture
    (`src/mascot/env-tint.ts`, que le module Musique nourrit ; rien ne sort).
  - *Gomme translucide*, par forme (`GumShape.gel`, `bubbles`, `bubbleKind`) :
    lueur du bas et bord qui s'éclaircit selon `gel` (berlingot 1, dragée 0,2) ;
    bulles d'air qui remontent et tremblent après un choc (`jolt`), pores de la
    guimauve, braises du soleil et de la flamme, rien dans le nuage.
  - *Expressions* : chaque réglage du visage a sa vitesse (`FACE_RATE` : yeux et
    bouche vite, sourcils en ressort qui dépasse, joues lentes : le
    rattrapage) ; anticipation de 110 ms avant un geste ponctuel (elle se tasse,
    le regard part) ; `express()` dose, mélange et retourne ; `talk()` ouvre la
    bouche et lève les sourcils sur « ? » / « ! » ; au repos, la respiration
    varie et un petit geste (`idleAct` : poids, soupir, moue, regard, fredonne)
    passe toutes les 4 à 9 s (10 à 18 s avec « Calme », poids et soupir seulement).
  - *Corps* : atterrissage en images clés (`LANDING`), traînée de gomme
    (cisaillement selon la vitesse de côté), ombre qui respire (plus large
    écrasée, plus floue en l'air), yeux un peu plus grands quand la souris file
    près d'elle.
  - *Accessoires d'un geste* (`Frame.prop`, en fondu) : lunettes de soleil qui
    descendent du front, écharpe, pile vide qui clignote (pose `panic`),
    petites jambes (assise, `swing` les balance), ronds de tapotement.
  - Hors de l'écran (IntersectionObserver), rien n'est calculé.
- `gum-draw.ts` : le dessin (couches de gomme, visage, moufles, accessoires,
  météo) et les teintes (`TINTS`, plus l'arc-en-ciel).

Sur le podium des Réglages (`src/settings/podium.ts`), chaque mascotte a sa
couleur (`PODIUM_TINT` de gum-family.ts, `GumEngine.setTintOverride`) ; celle
de la première marche garde la couleur des réglages.

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
reste), la danse (un simple hochement en musique à la place) et le goûter (src/eggs/eggs.ts), les visites au bord de
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

### Ondine se déplace dans l'île (`src/island/scenes/`)

Pour certaines actions, Ondine quitte sa case (`mascot-slot`), va jusqu'à
l'élément de l'île en petits sauts de gomme, agit, puis revient (les 22 scènes
de `animations-ile/ondine-se-deplace.md`, toutes retenues par Simon).

- **Fichiers** : `scene-path.ts` (sans DOM : découpe en sauts `planHops`,
  instant d'un saut `hopAt` = élan tassé, vol en arc étiré, atterrissage écrasé
  avec un petit rebond, volume gardé ; la place près d'un élément `pickSpot` ;
  traversée `crossing` ; pied d'une progression `progressFoot`),
  `scene-rules.ts` (sans DOM : la liste `SCENES` avec numéro, nom, geste de
  repli, états où marcher, délai entre deux fois ; `sceneMode` ; petits
  calculs : progression, volume fort, météo, heure du soir), `walker.ts` (le
  moteur), `scenes.ts` (les scènes et leurs déclencheurs). Tests :
  `tests/front/scenes.test.ts`. Branché par `attachScenes()` dans le
  constructeur de `Island`.
- **Le moteur** (`Walker`) raisonne sur le « pied » d'Ondine (milieu du bas de
  sa case, coordonnées de la fenêtre). La case garde sa place dans la grille
  de l'île : on la décale avec `translate` et on l'écrase avec `scale`
  (attaché en bas, classe `ondine-away`) ; jamais `translate` de `.island`.
  Elle voyage à 62 % de sa taille (`WALK_SCALE`). Le dessin reste celui du
  moteur de la mascotte : à chaque atterrissage, `MascotRenderer.react("release")`
  fait rebondir la gelée de la gomme et trembler ses bulles ; les gestes sont
  ceux de gum-anims.ts, demandés par `MascotController.emoteNow` (pousse,
  assise au bord, grimpe, tapote la vitre, coucou, étirement, bâillement,
  sommeil, danse par `playAnimation("danse")`) et `setSceneExtras` (parapluie,
  moufles sur les oreilles) ; `settle()` la remet au repos après une pose en
  boucle. Les objets tenus (emoji : loupe, lettre, balai, cloche, manivelle,
  appareil photo, ampoule) et les « fantômes » des lignes retirées vivent dans
  un calque `.ondine-scene-layer` posé dans l'île, sans souris.
- **Interruptible** : chaque scène reçoit un `Run` ; un appui dans l'île (sauf
  sur un déclencheur), un clic sur elle (`mascot.clicked`), une autre scène ou
  un changement d'état de l'île l'annule à l'image suivante. Elle revient en
  sautant (une scène remplacée : elle repart d'où elle est), ou d'un coup quand
  l'île change d'état (`snapHome`, plus aucun style en ligne). Le retour vise
  de nouveau sa case si l'île a changé de taille en route.
- **Jamais devant le texte qu'on lit** : en route, l'île porte la classe
  `ondine-walking` et le contenu passe au-dessus d'elle (`z-index` des
  éléments de la grille). Arrivée, `pickSpot` essaie les places (à gauche, à
  droite, sur l'élément, dessous, sur son bord) et garde la première qui ne
  touche aucun rectangle de texte (`Range.getClientRects` des nœuds texte, et
  champs, images) ; elle passe alors devant (`ondine-front`), sinon elle reste
  derrière.
- **Règles** (`sceneMode`) : rien avec « Réduire les animations », sans
  mascotte dans l'île (Ondine sur le bureau), île cachée ; un simple geste dans
  sa case avec « Calme », le réglage coupé ou en économie d'énergie, et en
  mini-île (pas la place de marcher) ; les scènes spontanées (13, 18, 20, 21,
  22) disparaissent en Calme. Île-bouche (`island.style` = "mouth", lu
  prudemment : absent = classique) : rien, sauf la scène 1 où le fichier retiré
  file vers elle et disparaît (« crunch »).
- **Réglage** : `modules.halos.values.ondineWalk` (activé par défaut),
  Réglages → Animations et halos → Style → bloc « Ondine » (layout.ts).
- **Déclencheurs** : les nouvelles du bus (`shelf.changed`, `clipboard.changed`
  et `halos.clip`, `timer.progress` / `timer.done`, `media.changed`,
  `halos.volume`, `agents.event`, `capture.done`, `team.event`,
  `shelf.hash-progress` / `team.progress` / `agents.progress`,
  `weather.updated`, `island.state`) ; un attribut `data-scene` sur un bouton
  de module (× de l'Étagère, × d'une tâche et « Supprimer » d'une note : la
  ligne est photographiée au clic, avant de disparaître) et
  `data-scene-target="media-next"` (bouton suivant de la Musique) ;
  `mascot.scene` publié par Notes (retour à la liste après une note
  enregistrée) et Règles (une règle vient de s'exécuter, d'après l'historique) ;
  l'île elle-même (clic sur un onglet, cible de dépôt survolée, classe
  `liquid-float`, souris immobile 25 s, ouverture le soir une fois par jour,
  retenue dans `localStorage`).
- **Les scènes** : 1 retirer de l'étagère (elle pousse la ligne, qui tombe) et
  fichier qui arrive (rattrapé) ; 2 tâche ou note supprimée (froissée en
  boule, lancée) et note enregistrée (tampon ✓) ; 3 assise sur le bord de
  l'anneau du minuteur tant qu'il tourne, cloche à la fin ; 4 pied sur
  « suivant » puis danse sur la pochette ; 5 la nouvelle copie poussée en
  haut ; 6 grimpe à côté du volume, moufles au-delà de 80 % ; 7 tape la carte
  de l'agent qui a fini, coucou à côté de celui qui attend ; 8 loupe près du
  premier résultat du Lanceur, puis elle le pousse ; 9 appareil photo et
  flash ; 10 lettre portée au collègue, fichier reçu traîné jusqu'à sa case ;
  11 d'icône en icône jusqu'au nouvel onglet ; 12 manivelle à côté de la
  règle ; 13 elle pousse les bords de l'île qui s'ouvre (au plus toutes les
  2 min) ; 14 sa course le long du bas est la progression ; 15 bras ouverts
  à côté de la cible de dépôt survolée ; 16 balai sur toute la largeur
  (étagère ou presse-papiers vidés) ; 17 elle tire la bannière d'une alerte
  depuis le bord droit (clip-path qui se déroule derrière elle) ; 18 promenade
  au repos ; 19 étirements d'un bord à l'autre pendant la pause du Pomodoro ;
  20 nage tant que l'île est pleine de liquide ; 21 parapluie ou coup de
  chaud, à l'ouverture après un changement de temps ; 22 interrupteur, voile
  sombre, sommeil dans le coin. Une scène ne se joue que si son élément est
  visible dans l'onglet ouvert.
- **`mascot.look-at {x, y}`** : elle regarde ce point pendant 1,5 s
  (`Scenes.gazeHeld()` : island.ts ne lui fait pas suivre la souris
  entre-temps). **`mascot.walk {active}`** : publié au départ et au retour.
- **Mode démo** : `mascot.scene {scene, demo: true}` ouvre l'onglet de la
  scène (`DEMO_TAB`) puis la joue sur le premier élément venu (la ligne
  « retirée » est seulement cachée le temps de la scène) ; demo.ts a le tour
  `ondine-walk` (toutes les scènes, sauf le dépôt qui demande un vrai glisser)
  et `ondine:<scène>` ; Réglages → Captures d'écran : un bouton et une liste.
  Dans un navigateur, `window.ondineScenes` donne le moteur.

### Ondine sur le bureau (`src-tauri/src/pet.rs`, `src/pet/`, `pet.html`)

Une quatrième fenêtre, « pet », créée cachée au démarrage comme les autres
(mêmes BROWSER_ARGS) : sans bordure, transparente, hors de la barre des
tâches, au-dessus des fenêtres ou derrière (`mascot.petOnTop`). Elle est
montrée quand `mascot.enabled && mascot.pet` (`pet::apply`, au démarrage et
dans `apply_settings`). Deux tailles : la case de la mascotte (112 × 112) ou,
bulle ouverte, la case dans un coin et la bulle du côté où l'écran a de la
place (`choose_layout`, d'après la zone de travail) ; la mascotte ne bouge pas
à l'écran, seule la fenêtre s'agrandit autour d'elle. Le Rust annonce le côté
par l'événement `pet-layout` avant de changer la fenêtre, avec `maxW`/`maxH` :
la plus grande bulle qui tient de ce côté.

- **Taille de la bulle** (1.2.2) : comme l'île qui suit son contenu (`fit.ts`),
  la bulle prend la taille de son contenu, en largeur et en hauteur, entre
  360 × 120 et 640 × 560 (`src/pet/bubble-size.ts`, mêmes bornes dans
  `pet.rs`, un test le vérifie). `src/pet/main.ts` la mesure (largeur
  « max-content », puis hauteur pour cette largeur, sans rien dessiner entre
  les deux), suit le contenu (MutationObserver) et l'anime avec la glisse de
  l'île (`GLIDE` de jelly.ts, ressort amorti sans rebond ; d'un coup avec
  « Réduire les animations » ou « Calme »). La fenêtre suit par `pet_bubble` :
  elle grandit AVANT la glisse (rien n'est coupé en route) et ne se resserre
  qu'une fois la bulle posée ; place et taille changent d'un seul appel
  (`platform::set_bounds`, SetWindowPos), pour qu'une bulle qui grandit vers
  la gauche ou le haut ne fasse pas sauter la mascotte. Les onglets de la
  bulle sont des icônes seules (nom en infobulle et `aria-label`).

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
- **Île-bouche** (1.2.3, `src/pet/pet-mouth.ts`, avec `island.style = "mouth"` et
  `island.mouthFollow`) : c'est elle qui fait l'île. Debout (pointe en haut, yeux
  au-dessus de la bouche : la pose de la goutte sur le bureau), dessinée par le même
  `MouthBody`, bouche remplie de la couleur de l'île. Nano : elle-même, bouche
  fermée, dans sa case (la gomme d'origine reste là, invisible, pour qu'on
  l'attrape). Mini (survol 120 ms, ou `island.mouth` mini / alerte, avec un petit
  saut) : la fenêtre prend la plus petite bulle (`pet_open` 360 × 120, du côté choisi
  par `choose_layout`, donc jamais hors de l'écran) et la bouche 318 × 40 s'étire de
  côté, le texte de la mini-île dedans (`.pet-mini`, un clic l'ouvre). Ouverte (un
  clic) : la bulle est la bouche (`PET_MOUTH_INSET` : 19 px pour les yeux et la
  pointe, 4 px de liseré), ses onglets dedans. La bouche suit ses propres ressorts
  (épaisseur vive, longueur plus molle), pincement de 90 ms en partant de la nano,
  rebond et clignement en refermant. Zone cliquable : la case, le corps, la bulle
  (`hitRects`). La pastille des notifications est cachée (la bouche les montre).
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
| Musique + mini-île | elle danse tant que ça joue (`mascot.dance`), dans le style et au tempo de la musique (voir « La danse selon la musique ») ; en « Calme », un simple hochement |
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

### La danse selon la musique (`src/eggs/dance.ts`, `src/mascot/beat.ts`, `src/mascot/renderers/gum-dances.ts`)

- **Quand** : eggs.ts (musique + mini-île ou bureau). **Comment** : `MusicDance`
  demande le tempo au module Musique (voir plus bas) et choisit le style
  (`danceStyle`) : Calme ou animations réduites → `nod` (simple hochement) ;
  sinon le réglage `media.danceStyle` ; sinon le genre du lecteur
  (`styleFromGenre`, expressions régulières FR/EN) ; sinon le tempo et
  l'énergie (`guessStyle`) ; sinon pop. Un style deviné ne change qu'après 3
  mesures de suite (`steadyStyle`). Publie `mascot.dance` {on, style, bpm,
  phase} à chaque changement et à chaque mesure (phase : où on en est dans le
  temps à l'envoi ; chaque fenêtre en déduit l'instant d'un temps, `beatFrom`).
- **Les danses** (manifeste goutte-gomme, partagé par les 15 mascottes) :
  `danse-rock` (hochements, air guitar), `danse-metal` (headbang, cornes),
  `danse-rap` (rebond des genoux, bras croisés, casquette), `danse-rnb`
  (balancement, claquements de doigts sur 2 et 4), `danse-pop` (pas de côté,
  clap), `danse-electro` (bras en l'air), `danse-reggae` (balancement,
  contretemps), `danse-jazz` (ondulation, yeux mi-clos), `danse-hochement`.
  `danse` seule reste pour les règles et les mascottes sans styles. Accessoires :
  `Props.cap`, `guitar`, `snap`, `clap`, `Hand.horns` (gum-draw.ts).
- **Le temps** : pour une animation `danse*`, le moteur donne `t = temps / 2`
  (les temps tombent sur les entiers de `2t` ; à 120 BPM, t = secondes).
  `BeatFollower` rattrape le temps de la musique sans saut ni recul (±35 % de
  vitesse au plus) ; sans tempo mesuré (aperçu des réglages, démo, navigateur),
  le tempo typique du style (`STYLE_BPM`). `MascotRenderer.setBeat`.
- **Le halo** (`src/modules/halos/`, seulement si `halos.dance` ET
  `halos.music`) : avec un tempo mesuré, le halo de la danse (forme `breathe`
  + `beatAt`) bat sur les mêmes temps (un temps, ou deux au-delà de ~133 BPM :
  `haloBeatMs`, jamais sous `MIN_PERIOD_MS`), un éclat (`flash`) pour l'électro,
  et passe devant le halo qui suit le niveau du son ; sans tempo, comme avant.
- **Démo** : `media.tempo` inventé (tempo du morceau de démo), scène
  « Danses selon la musique » (un genre après l'autre).

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
  `TcpListener` (std) protégé par TLS (`services/phone_tls.rs`, rustls) sur cette adresse et un port donné par
  Windows, et tire un jeton de 128 bits (`getrandom`). Seule l'adresse
  `https://IP:port/<jeton>/<nom encodé>` sert le fichier (GET ; HEAD = en-têtes
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
  Le certificat de ce PC est préparé dans Réglages → Confidentialité : clé
  privée dans le Gestionnaire d'identifiants, certificat public à installer sur
  le téléphone après comparaison de l'empreinte. Le lien HTTP de préparation
  ne sert que le certificat public, pendant trois minutes. Fichiers et
  télécommande restent exclusivement en HTTPS. Voir `SECURITE-FLUIDITE.md`.
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
- **Genre** : le champ `genre` de `media.changed` (`Genres` des propriétés
  SMTC, trois au plus ; souvent vide, beaucoup de lecteurs ne le donnent pas).
- **Tempo** (1.2.2, la danse de la mascotte) : commande `tempo` {on} (redite
  toutes les 10 s par `src/eggs/dance.ts` tant qu'elle danse ; sans nouvelle
  depuis 30 s, ou réglage `danceTempo` décoché, le fil s'arrête). Le fil lit
  l'indicateur de niveau des haut-parleurs (`platform::halos::Meter`, gardé
  ouvert, périphérique relu toutes les 3 s) toutes les 10 ms (20 ms en éco) et
  publie `media.tempo` {bpm, phase, confidence, energy} une fois par seconde,
  `{bpm: null}` quand le rythme est perdu. L'estimation (`media_tempo.rs`,
  pure, testée avec des signaux fabriqués) : attaques (montée du niveau en
  échelle log, lissée sur 20 ms), autocorrélation sur 8 s aux écarts
  fractionnaires (pas de 0,5 BPM de 60 à 200, penchant doux pour ~120 BPM
  contre les erreurs d'octave), phase par peigne (les temps récents comptent
  plus), recalage (même tempo à 4 % : lissé ; double ou moitié : ignoré ; trois
  mesures ailleurs : nouveau tempo ; 1,5 s de silence ou nouveau morceau :
  tout repart de zéro). Un seul nombre par lecture, jamais le son ; rien n'est
  gardé au-delà de 8 s ni envoyé.
- Réglages : `danceTempo` (activé), `danceStyle` (`auto`, `rock`, `metal`,
  `rap`, `rnb`, `pop`, `electro`, `reggae`, `jazz`).

### La carte Musique 1.2.4 (`src/modules/media/index.ts`, `logic.ts`)

Refaite d'après la maquette « Musique » (et la carte Spotify de Coucou, MIT,
pour la mise en page et la technique du volume ; dessins et code à nous).

- **Vue ouverte**, construite une fois puis mise à jour en place (un message du
  lecteur n'interrompt plus un glissé) : pochette de 84 px dans un bouton
  (« Ouvrir le lecteur », commande `open`), pastille de couleur devant le titre,
  artiste · album, nom de l'appli (`appName` : « MSEdge » → Edge, le code de
  Firefox → Firefox). Progression : écoulé à gauche, restant « -2:13 » à droite
  (`remaining`, arrondi vers le haut). Boutons : Aléatoire, Précédent, grand
  bouton lecture rond et plein, Suivant (`data-scene-target="media-next"`
  gardé), Répétition (rien → liste → morceau, icône « 1 » pour le morceau).
  Aléatoire et Répétition sont en couleur quand ils sont actifs, grisés quand
  le lecteur ne les expose pas (`buttons()` dans logic.ts). Volume DU LECTEUR :
  icône à 4 niveaux (`volumeLevel` : coupé ou 0, < 34, < 67, plus), clic =
  couper / remettre le son, barre, nombre ; grisé si le lecteur n'a pas de
  session audio.
- **Barres glissables** (`slider()`) : grises au repos ; sous la souris, au
  clavier (focus) ou pendant un glissé, le remplissage prend la couleur et un
  bouton rond de 14 px apparaît. Flèches : ±5 s (position), ±5 (volume). Le
  volume part au plus une fois toutes les 120 ms pendant un glissé, la dernière
  valeur toujours, tout de suite au lâcher (`throttle`, testé avec de fausses
  minuteries).
- **Couleur** : `coverTint()` (env-tint.ts), gardée pour le morceau en cours
  (env-tint l'efface en pause), éclaircie sans changer de teinte (`cardTint` :
  canal le plus fort à 235, mélange de blanc si elle reste sombre). Posée en
  `--media-tint` / `--media-tint-soft` sur la carte et la mini-île ; sans
  pochette colorée, l'accent du thème. Une lueur radiale douce
  (`.media-glow`) en haut à gauche de la carte, plus forte en lecture.
  `onCoverColors` fait repeindre quand la couleur arrive.
- **Mini-île** : au repos pochette + titre · artiste + égaliseur (couleur de
  la pochette) ; sous la souris (`.island:hover`) ou au clavier
  (`:focus-within`), pochette et égaliseur se replient et lecture / suivant
  apparaissent, seulement si `compactControls` est coché. La goutte, à côté,
  danse déjà tant que la musique joue en mini-île (eggs.ts, inchangé).
- **Icônes** : SVG au trait (formes pleines pour lecture, pause et les
  triangles), identiques avec les icônes « Couleur » et « Épurées » : ce sont
  des commandes, pas des pictogrammes. Les actions de la carte d'Accueil
  gardent leurs emojis (home-cards).
- **Animations réduites** : ni égaliseur ni ondulation, apparitions en fondu
  (transitions limitées à l'opacité et aux couleurs), pas de zoom au survol.
  Éco : égaliseur et ondulation coupés. La barre avance avec `pacedInterval`
  (rien quand la page est cachée).

Côté Rust (`modules/media.rs`, `platform/media.rs`) :

- `NowPlaying` gagne `shuffle`, `repeat` (`none` / `track` / `list`),
  `canShuffle`, `canRepeat` (GSMTC : `IsShuffleActive`, `AutoRepeatMode`,
  `IsShuffleEnabled`, `IsRepeatEnabled`) ; un changement de l'un d'eux
  republie `media.changed` (`differs`).
- Commandes `shuffle` {on} (`TryChangeShuffleActiveAsync`), `repeat` {mode}
  (`TryChangeAutoRepeatModeAsync`, `parse_repeat`), `volume` {value?, muted?}
  (sans argument : lecture ; `volume_args` vérifie 0…100), `open`. Un
  changement accepté est noté tout de suite dans l'état (`remember`) : pas de
  republication en double.
- **Volume du lecteur** : Core Audio, sessions de TOUTES les sorties actives
  (`IAudioSessionManager2` → `IAudioSessionControl2` → `ISimpleAudioVolume`).
  Le programme d'une session est reconnu par `player_matches(app_id,
  chemin)` : « Spotify.exe » = même nom de fichier ; alias de navigateurs
  (« MSEdge », « Chrome », le code hexadécimal de Firefox) ; appli du Store
  « Paquet_éditeur!Appli » = dossier `WindowsApps\Paquet_…__éditeur` ; sinon le
  même nom sans « .exe ». Repli quand le programme est illisible :
  l'identifiant de la session le nomme (`session_matches`). Toutes les
  sessions du lecteur reçoivent le même niveau ; le volume du PC n'est jamais
  touché.
- **Ouvrir le lecteur** : la première fenêtre visible (de premier plan vers
  l'arrière) d'un programme qui correspond passe devant (restaurée si
  réduite, astuce de la touche Alt, comme « Y aller » des agents) ; sans
  fenêtre, une appli du Store est lancée par `explorer.exe
  shell:AppsFolder\<id>` (identifiant vérifié par `launchable_aumid` :
  lettres, chiffres, `._-` et un seul `!`).
- **Démo** (`src/core/demo.ts`) : aléatoire, répétition et volume inventés
  (`state.player`), `open` ne fait rien.

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
- **Clés et jetons** (1.2.4, réglage « Ignorer les clés et jetons », activé par
  défaut) : une copie qui EST une clé d'API ou un jeton est lue mais pas gardée.
  Voir « 1.2.4 » à la fin (« Le Presse-papiers ignore les clés et jetons »).
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
- Liseré de l'île : `syncProgress` (à chaque tick) publie `timer.progress`
  seulement quand la signature change (lancé, pause, reprise, +1 min, phase,
  fin) ; `done` juste avant la remise à zéro. `timer.start` accepte aussi
  `seconds` (10 à 600), pour la scène de démo « Liseré d'un minuteur ».
  Avec `timerRing`, pas de cocon de concentration (la séance a déjà sa jauge).

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
- 1.2.2 : déclencheurs sans fichier, sondés par `rules/sense.rs` à chaque
  tour du fil de fond (`schedule` heure + jours, avec balayage facultatif
  d'un dossier ; `unlock` par `platform/session.rs` ; `clipboard` lien /
  e-mail / code / texte, presse-papiers marqué sensible ignoré, texte jamais
  journalisé ; `network` coupure / retour d'Internet et VPN, toutes les
  10 s, confirmé par deux lectures ; `battery` / `power`) ou reçus du bus
  (`agent` ← `agents.event`, `music` ← `media.changed`). Conditions `days`,
  `from` / `to`, `olderThanDays`. Actions `addNote` (`notes.add`, `kind`
  `todo`), `unzip` (`rules/unzip.rs` : noms protégés, 10 000 entrées et
  4 Go au plus, jamais d'écrasement, annulable), `copyPath`, `mascot`
  (`mascot.dance` / `mascot.emote` / `mascot.sign {text, secs}`), `quiet`
  (`rules.quiet {on}` : l'île met les notifications en pause). Compteur
  « déclenchée N fois cette semaine » (`fired` dans le fichier des règles).
  1.2.3 : `network` `newDevice` (un nouvel appareil sur le réseau local,
  `rules/newdevice.rs`, voir la section 1.2.3 en fin de document).

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
- **Recherche web** (1.2.2) : la dernière ligne, dès qu'on tape quelque chose,
  est « Recherche web : « … » sur Google » (réglage `searchEngine` : Google par
  défaut, DuckDuckGo, Bing, Qwant, Ecosia ; `launcher::ENGINES`). Entrée ou
  clic → commande `web_search {query}` : le Rust construit l'adresse
  (`search_url` : blancs regroupés, 500 caractères, encodage `%XX`, espace
  = `+`), la revalide par `web_url` et l'ouvre dans le navigateur par défaut
  (`shell_open`). Rien ne part avant ; le journal ne note que le moteur.

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
- Batterie (lue à chaque tour, `GetSystemPowerStatus`) : `system.battery-low`
  (`batteryLowPct`, 20 %), `system.battery-critical` (`batteryCriticalPct`,
  10 %), `system.battery-full` (toujours ; `batteryFullAlert` ne règle plus que
  la notification), `system.battery-plug` au branchement / débranchement. Les
  halos (voir « Le halo de l'île ») : `chargeHalo`, `haloPlug`, `haloUnplug`,
  `haloFull`, `haloLow`, `haloCritical`. Commande légère `battery`.
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
- Services IA (`nettools_ai.rs`, réglage `aiStatus`, **désactivé** par
  défaut) : toutes les 5 min, lecture des pages d'état publiques de Claude
  (`status.anthropic.com/api/v2/status.json`), ChatGPT
  (`status.openai.com/api/v2/status.json`, format Statuspage) et Gemini
  (`status.cloud.google.com/incidents.json`, incidents en cours dont le
  produit contient « Gemini »). Vert / orange / rouge, historique des pannes
  sur 7 jours (`ai-status.json`). En pause pendant la concentration
  (`timer.focus`), le calme des agents, une présentation ou sans Internet.
  Bus : `nettools.ai-status {services, change}` (notifications, point rouge
  de la mini-île, conseil « Claude a un incident en cours » sur les
  événements d'agents) et `mascot.emote` (inquiet / soulagé).

### Module Contrôles (`src/modules/controls/`, `src-tauri/src/modules/controls.rs`, `src-tauri/src/platform/audio.rs`)

- 1.2.2 : `bt_batteries` (`platform/bt_battery.rs`, propriété
  `DEVPKEY_Bluetooth_Battery` des périphériques `BTH*`, aucun appareil
  contacté) et alerte `controls.bt-battery-low` sous le réglage
  `btBatteryLow` (15 %), réarmée à +5 % ; `desktop_icons` /
  `set_desktop_icons` (« Bureau propre », `platform/desktop_icons.rs`) ;
  télécommande sur le téléphone (`controls_remote.rs`, réglage `phoneRemote`
  **désactivé** par défaut, permission `network`) : serveur HTTPS du réseau
  local avec jeton de 128 bits, un seul téléphone, actions fixes (musique,
  volume, minuteur, diapositive par Page suivante / précédente), arrêt après
  10 min sans action ou 3 h ; publie `controls.remote {state}`.
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

### Module Équipe (`src/modules/team/`, `src-tauri/src/modules/team.rs`, `team_net.rs`, `team_proto.rs`)

Les Ondine d'un même réseau local se parlent directement : aucun serveur,
aucun compte, rien sur Internet. **Désactivé par défaut**
(`MODULES_OFF_BY_DEFAULT`, dans services/settings.rs et core/settings-store.ts) :
éteint, aucun port n'est ouvert.

- **Ports fixes** : UDP **47820** (découverte), TCP **47821** (appairage et
  échanges). L'écoute TCP est sur toutes les cartes, mais une connexion qui ne
  vient pas d'une adresse privée / locale au lien est fermée tout de suite
  (16 à la fois au plus). Comme « Vers le téléphone », on laisse le pare-feu
  de Windows demander l'autorisation la première fois (réseaux privés).
- **Découverte** : « je suis là » (nom, couleur, empreinte de la clé) toutes
  les 30 s sur l'adresse de diffusion de chaque carte, seulement si
  « Visible » ; « qui est là ? » sur « Chercher ». Rien n'est jamais accepté
  sur la foi d'une annonce. Repli : l'adresse IP tapée à la main.
- **Appairage** : B affiche un code à 6 chiffres (3 min, UN essai : le code
  est consommé dès la connexion). A le tape. SPAKE2 (crate `spake2`) en tire
  une clé sans l'envoyer (un intrus au milieu n'a qu'un essai, pas d'attaque
  hors ligne), puis Noise `XXpsk3` (crate `snow`) avec cette clé : chacun
  apprend la clé publique X25519 de l'autre, puis sa fiche (nom, couleur,
  mascotte, « mon PC »), chiffrée. Depuis 1.2.3, le code est aussi montré
  en QR code (voir « Fonctions 1.2.3 » plus bas).
- **Échanges** : une connexion TCP par message ; poignée de main Noise `IK`
  (l'appelant connaît la clé de l'autre et prouve la sienne ; l'appelé refuse
  toute clé hors de « Mes collègues »), puis ChaCha20-Poly1305, clé neuve à
  chaque connexion. Trames : 2 octets de longueur + message Noise (≤ 65 535) ;
  dans le canal, 1 octet (0 = JSON, 1 = morceau de fichier) + le contenu.
  Chaque message (`Msg`, JSON de 60 Ko au plus) est vérifié champ par champ
  (`Msg::check`) : longueurs, valeurs connues, pas de caractère de contrôle ni
  d'inversion de texte. Tests : deux pairs simulés en mémoire
  (team_proto.rs, en bas).
- **Clés** : la clé privée X25519 est dans le Gestionnaire d'identifiants
  (`team-identity-key`, hors de `KNOWN_KEYS` : le front ne peut ni la lire,
  ni l'écrire, ni demander si elle existe). Les clés publiques des collègues
  sont dans `%APPDATA%\Ondine\team.json` (avec l'empreinte, vérifiée à la
  lecture ; un fichier abîmé est mis de côté).
- **Rien n'est exécuté** : texte, fichier, demande d'aide, demande de l'IT
  (état du PC, Bureau à distance) attendent « Accepter » (`pending`, 50 au
  plus, 30 min). Un fichier accepté : c'est le destinataire qui vient le
  chercher (`Pull`), dans `Téléchargements\Ondine`, sous un nom assaini
  (`safe_file_name` : pas de chemin, de `:`, de nom réservé), jamais
  d'écrasement (`unique_dest`), empreinte SHA-256 vérifiée, marque du Web
  (`Zone.Identifier`) ; un fichier à moitié reçu va à la Corbeille. Taille
  maximale : réglage `maxMb`. Un dossier est zippé en mémoire (200 Mo au plus,
  dossiers exclus passés).
- **Présence** : toutes les 60 s (et dès que le statut change) à chaque
  collègue connu ; hors ligne après 2 min 30 sans nouvelles. Statut
  automatique : `timer.focus` → concentration, rendez-vous à heure fixe en
  cours (`agenda::in_meeting`, plages seulement) → en réunion, 10 min sans
  activité → absent. Modifiable à la main.
- **Collègues** : geste (la mascotte de l'île du destinataire fait
  `mascot.emote`), « Tu es dispo ? », visite (visit.ts : la mascotte du
  collègue, à sa couleur, traverse la carte de l'alerte avec un ressort ;
  posée d'emblée avec « Réduire les animations » ou Calme ; une fenêtre de
  traversée de tout l'écran aurait été trop lourde), texte (montré avant
  l'envoi, copié à l'acceptation), fichiers (glisser sur l'île : une cible
  par collègue en ligne), café / déjeuner, sondage (2 à 4 choix), Pomodoro
  d'équipe (chacun « Rejoint » : `timer.start`), annonce.
- **IT** : « Demander de l'aide » (le résumé de `system::support_text` et
  l'image copiée), état du PC et Bureau à distance (`mstsc /v:<IPv4 locale>`)
  seulement après « Autoriser » à chaque fois, inventaire seulement des PC
  qui ont allumé `shareInventory` et marqué le demandeur « IT ».
- **Mes PC** (appairage « mon PC ») : la batterie passe dans la présence ;
  presse-papiers partagé (`clipboardSync`, texte seulement, jamais un élément
  marqué sensible, sans écho) ; même mascotte (`mascotSync`).
- **Pas de file d'attente** : un collègue éteint ne reçoit rien (« ne répond
  pas »).
- **Chat** (1.2.2, `team_chat.rs`, front `chat.ts` / `chat-logic.ts`) : icône
  💬 dans l'en-tête de l'onglet → liste (salon « Toute l'équipe », puis les
  collègues en ligne avec leur pastille, et ceux qui ont un historique) → fil
  en bulles (classes `.ask-bubble` de Parler à Ondine). Quatre messages de
  plus dans le protocole, vérifiés comme les autres : `chat` (4 000
  caractères au plus, `MAX_CHAT`), `chat-typing` (« … écrit », au plus toutes
  les 3 s, effacé après 6 s), `chat-read` (« Lu » : le numéro du dernier de MES
  messages qu'il a reçus ; envoyé une fois par nouveau message) et
  `chat-react` (👍 😂 ❤️, une par personne, la même l'enlève). Les messages des
  collègues appairés arrivent **directement** (pas de `pending`) ; rien n'est
  ouvert ni exécuté : un lien est un bouton, et `chat_open_link` n'ouvre (par
  `shell_open`) qu'un lien http(s) sans espace ni caractère invisible, présent
  tel quel dans la conversation. Le salon n'a pas de serveur : le message part
  à chaque collègue en ligne, chacun le range dans son salon (on n'y voit que
  ses collègues appairés). Notification dans l'île compacte avec « Répondre »
  (une alerte avec la zone de saisie, `content`, qui prend le clavier le temps
  de répondre) et « Ouvrir » ; en concentration ou en réunion, discrète
  (priorité basse, 4 s). Une réaction reçue fait `mascot.emote` côté front,
  sauf concentration, réunion, Calme ou animations réduites. Glisser un
  fichier pendant une conversation à deux : sa cible passe en premier
  (`chat_files` = `send_files`, toujours à accepter) et une ligne 📤 / 📥 est
  ajoutée au fil des deux côtés. **Historique** : en mémoire (500 messages par
  conversation), effacé à la fermeture ; réglage `chatKeep` (éteint par
  défaut) : `%APPDATA%\Ondine\team-chat.bin`, ChaCha20-Poly1305 (`ONDCHAT1`
  + nonce + texte chiffré), clé tirée au hasard dans le Gestionnaire
  d'identifiants (`team-chat-key`, hors de `KNOWN_KEYS`), 7 jours, réécrit au
  plus toutes les 2 s par l'entretien (`team_chat::tick`). L'éteindre efface
  la clé puis ce fichier interne. `chatReceipts` (allumé) : « … écrit » et
  « Lu » dans les deux sens. Mode démo : une conversation avec Léa (elle
  « écrit… » puis répond) et la scène `team-chat`.

## Agents IA (`src/modules/agents/`, `src-tauri/src/modules/agents.rs`, `src-tauri/src/cli.rs`)

Les outils extérieurs préviennent l'île par une porte d'entrée locale.

L'onglet (refait en 1.2.4, voir « Agents IA : la rangée de pilules » plus
bas) : une pilule par agent en haut, une seule carte dessous. Le gros guide
« Brancher un outil » a disparu : chaque agent a sa carte « Brancher »
(premier clic) et ses « Options avancées » (lien « Configurer »).

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
    complet trouvé dans le PATH). `launch {tool: "other"}`. La carte
    « Configurer » de l'outil (Options avancées) montre la ligne `"chemin\ondine.exe" notify --source other
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

## Accueil (`src/modules/home/`, `src/core/home-cards.ts`, `src/styles/home.css`)

Le premier onglet de l'île ouverte (1.2.3) : une carte par module qui a
quelque chose à dire, la phrase d'Ondine en haut, la carte « Reprendre », et
4 actions rapides en bas. Module front seulement, sans permission.

- **Les cartes viennent des modules.** L'Accueil ne connaît aucun module :
  chacun propose sa carte dans son `setup` avec `api.homeCard(spec)`
  (`HomeCardSpec`, `src/core/home-cards.ts`) :
  `title`, `icon`, `size` (`small` ou `large`), `moments` (importance 0 à 100
  le matin / en journée / le soir), `view(ctx)` qui renvoie ce que montre la
  carte (`value` qui roule, `sub`, `progress`, `image`, `tint`, `rows`,
  `actions`, `urgent`, `phrase`) ou **null quand le module n'a rien à dire**
  (pas de musique = pas de carte), `load()` + `refreshMs` (une commande Rust,
  appelée seulement pendant que l'Accueil est affiché), `expandable`, et
  `resume()` (une ligne pour « Reprendre »). Le registre range la carte dans
  `homeCards` avec son module : une erreur dans `view()` compte pour ce
  module (isolation habituelle, 3 erreurs = module mis à l'écart), la carte
  disparaît quand le module s'arrête ; une fenêtre satellite n'en a pas.
- **Qui propose quoi** : Musique (large, teintée par la pochette via
  `coverTint()`, ⏮ ⏯ ⏭), Agents IA (sessions, « vous attend » = urgente,
  dernière session pour Reprendre), Minuteur (compte à rebours, Pomodoro,
  chrono), Agenda (prochain rendez-vous ; le soir après 18 h, ceux de demain
  comme le récap ; urgente 15 min avant, « Rejoindre »), Météo (si allumée),
  Système (batterie, rien sur un PC fixe ; faible = urgente), Notes (tâches à
  faire ; dernière note pour Reprendre), Étagère (fichiers posés ; le dernier
  pour Reprendre, daté quand il arrive : rien après un redémarrage).
- **Ordre** (`home-rules.ts`, `arrangeCards`) : automatique, la carte
  urgente d'abord puis la plus importante à ce moment (matin 5 h-11 h,
  journée 11 h-18 h, soir ; réglage `byMoment`). Glisser une carte enregistre
  l'ordre (les cartes silencieuses gardent leur place relative) ; clic droit :
  petite / grande taille, retirer, « Ranger selon le moment », « Remettre les
  cartes retirées ». Tout ça est rangé **par profil** dans
  `modules.home.values.layouts` (clé = id du profil actif, « base » sans
  profil ; 12 au plus) : chaque profil a son accueil, sans toucher au Rust des
  profils.
- **La carte s'ouvre sur place** : un clic monte la vue `expanded` du module
  dans la carte (`registry.mountView`), qui prend toute la place (les autres
  cartes, la phrase et les actions se cachent) ; la racine de l'Accueil porte
  `data-island-fit`, l'île grandit donc jusqu'au contenu (fit.ts). Un clic sur
  l'en-tête ou Échap la referme. Animation FLIP en ressort, interrompue
  proprement par un autre clic.
- **La phrase d'Ondine** (`composePhrase`) : « Bonjour, Simon. » selon le
  moment, puis au plus 3 morceaux `phrase` des cartes, dans leur ordre
  (« 3 rendez-vous aujourd'hui, Claude a fini, 21° dehors. »). Rien d'IA ;
  chaque morceau est un `<span>` traduit à part (motifs de `i18n-en.json`),
  la majuscule du premier est faite en CSS.
- **Actions rapides** : réglages `action1` … `action4` (catalogue
  `QUICK_ACTIONS`), seulement si leur module est allumé : capture
  (`capture.request`), pipette (`capture.pick`), minuteur 25 min
  (`timer.start`), terminal (`terminal.open`), sinon l'onglet du module.
- **Ondine montre la carte importante** : quand la première carte urgente
  change, l'Accueil publie `mascot.look-at {x, y}` (centre de la carte, en px
  de la fenêtre de l'île ; branché par l'agent scènes : les yeux en style
  bouche, Ondine qui se pose à côté en classique). Pas en Calme, ni avec le
  réglage `look` coupé.
- **Design** : verre sombre en style classique ; en style bouche
  (`island.style = "mouth"`, lu seulement), classe `.home-gum` : relief, reflet
  et ombre aux couleurs de la goutte gomme. Les chiffres roulent grâce à
  `watchContent` (motion.ts) : les cartes sont mises à jour sur place
  (`setText`), jamais redessinées. Entrée en cascade en gelée (WAAPI,
  `jellyIn`) ; avec « Réduire les animations », un simple fondu, rien ne
  respire ni ne glisse.
- **Place dans la rangée** : `ALL_MODULES` commence par `home` (premier onglet
  d'une nouvelle installation ; l'assistant de premier lancement le met dans
  `BASE_TABS`). Une île déjà rangée (`island.tabOrder` non vide sans `home`) :
  `LEAD_TABS` de `tab-order.ts` le met en tête sans bousculer le reste ; une
  fois glissé ailleurs, il est dans la liste et garde sa place. Réglage
  `openOnHome` (oui par défaut) : l'île se rouvre sur l'Accueil (island.ts,
  `onTransition`), sauf quand un onglet précis est demandé (`openIsland(tab)`).

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
- Rouvrable : Réglages → À propos → « Voir les nouveautés », et en
  mode démo la scène « Quoi de neuf » (Réglages → Captures d'écran). Le
  message `app.whats-new` peut porter `{ version }` (dans un navigateur :
  `window.ondineBus.inject("app.whats-new", { version: "1.2.0" })`).
- Notification `high` et `sticky` (l'île s'ouvre en alerte, plus grande quand
  le texte a plusieurs lignes : classe `lines`), avec « Tout voir » →
  commande `release_page_open` (Rust, `update.rs`) : ouvre
  `https://github.com/Naod6473/Ondine/releases/tag/v<version de l'appli>` dans
  le navigateur ; la version vient du Rust, pas de la page. Réglages →
  À propos → « Voir les nouveautés » publie `app.whats-new`.

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

## L'éclosion de l'île (`src/island/hatch.ts`, `hatch-plan.ts`, `src/core/hatch-start.ts`)

Au premier lancement (avant l'assistant) et après une mise à jour (avant
« Quoi de neuf »), `main.ts` attend `startHatch` : une animation de 9,2 s à
vitesse réelle, réglage `island.hatch` (oui par défaut, Réglages → Apparence →
Animations, avec un bouton « Voir » qui publie `app.hatch`).

- *Le déroulé* (hatch-plan.ts, pur, testé par tests/front/hatch.test.ts) :
  une goutte sort du haut de l'écran et s'étire en île (ressorts) ; éclat de
  paillettes (tirage fixe : le même à chaque fois) ; Ondine sort, fait coucou,
  écrit bonjour ; elle aspire les paillettes en spirale (bouche grande
  ouverte, elle gonfle), puis les souffle dans trois anneaux : chaque
  paillette arrive pile quand la courbe de son anneau atteint sa part ; fête ;
  repli en goutte (l'île s'affine en s'allongeant, puis se rétracte en
  mini-île, Ondine y glisse en tournant) ; boing et deux respirations ; deux
  lumières partent des coins du haut et se rejoignent en bas dans une
  étincelle. Un clic passe au repli.
- *Le dessin* (hatch.ts) : deux canvas sur toute la fenêtre (derrière et
  devant Ondine) et, entre les deux, la vraie mascotte gomme
  (`GumRenderer`, avec ses réglages) dans une case de 120 px déplacée et
  étirée par `transform` ; ses expressions viennent du moteur (wake, coucou,
  surpris, eating, parle, celebrate, happy). Seule la bouche grande ouverte
  de l'aspiration est dessinée par-dessus, comme `drawMouth` de gum-draw.ts.
  Couleurs de l'île : celles du thème (un thème trop transparent est rendu
  presque opaque). En Studio, un voile sombre autour de l'île.
- *Dans l'île* (island.ts, `hatch()`) : `body.hatching` cache la vraie île et
  son halo ; la fenêtre reste grande (720 × 320, pas de repli en bande
  pendant ce temps) ; c'est l'éclosion qui envoie le rectangle des clics. À
  la fin, la vraie île revient en fondu (`body.hatched`).
- *Jamais* : réglage coupé, Réduire les animations, mode Calme, mode démo,
  île sur un autre bord que le haut, île-bouche, Ondine sur le bureau.
- *Les anneaux* (hatch-start.ts) : premier lancement → Onglets, Modules,
  Batterie (Mascottes sur un PC sans batterie, ou si le module Système ne
  répond pas en 600 ms) ; mise à jour → Nouveautés (les puces du CHANGELOG),
  Mascottes, Réglages gardés.
- *Sons* : `sounds.hatch(cue)` (sounds.ts), aux moments de `soundCues()`.
- Idée tirée de notch-launch-animation de Bora Kurt (MIT), aucun code repris.

## Premier lancement (`src/core/setup.ts`, `setup-plan.ts`, `suggestions.ts`, `src/island/setup-panel.ts`)

- **L'assistant** remplace l'ancien mot de bienvenue : au premier démarrage
  (`general.welcomed` faux, vraie appli, hors démo), une alerte qui reste
  (« high », sticky, clé `setup`) dont le contenu (`content`) est le panneau
  de l'assistant, DANS l'île. Cinq étapes passables (Passer ; × ou Échap
  passent tout, via le nouveau `onDismiss` des notifications) : prénom +
  langue + Vous/Tu (ou « Reprendre la configuration de mon autre PC » :
  `settings_import_pick`, boîte « Ouvrir » puis import comme Réglages →
  Sauvegarde, `check_path` compris) ; les cartes « Vous faites quoi sur ce
  PC ? » ; la mascotte (le carrousel de `whats-new-panel.ts`, option
  `hint`) ; le bord de l'île et le style des icônes (en direct) ; la clé de
  l'API (`credential_set` « anthropic-api-key », jamais dans les réglages).
  Puis « C'est prêt, Simon ! » et « Ouvrir l'île ». `welcomed` passe à vrai à
  l'arrivée sur « C'est prêt » ou à la fermeture ; une installation déjà
  accueillie ne le voit pas. Réglages → Général → « Refaire l'assistant »
  publie `app.setup`. Scène démo « Premier lancement » : même panneau, rien
  n'est enregistré, faux logiciels.
- **Les cartes** (`SETUP_CARDS`, setup-plan.ts) : Bureautique, Développement
  et agents IA, IT et support, Réunions et visio, Musique et création, Études.
  Chacune allume ses onglets ; `planFromCards` écrit `modules.<id>.enabled`
  (tous les modules à onglet, sauf Équipe, jamais touché) et un
  `island.tabOrder` complet (Parler à Ondine, puis les onglets dans l'ordre
  des cartes cochées). Aucune carte + Continuer : l'île minimale (Parler à
  Ondine, Étagère, Notes). Les modules sans onglet ne sont pas touchés.
  Plusieurs cartes : un profil par carte (Travail, Développement…, sans
  règle, `profilesFromCards`), sauf nom déjà pris.
- **Détection locale** (`services/apps.rs`, commande `apps_detect`) : noms des
  raccourcis des deux menus Démarrer, DisplayName des clés Uninstall (HKLM,
  HKCU, WOW6432Node), et quelques exécutables dans le PATH (le fichier existe ?
  rien n'est lancé). Seuls les ids d'une liste fixe (`APPS`) sortent du Rust ;
  `APP_CARDS` les relie aux cartes, pré-cochées tant qu'on n'y a pas touché.
- **Le prénom** (`general.firstName`, 40 caractères, nettoyé des deux côtés) :
  « Bonjour Simon ! » du matin (Animations de l'île), le titre du bilan de la
  semaine, le premier mot de Parler à Ondine, et la bulle du bureau (une fois
  par jour). Réglages → Général → Prénom.
- **Les propositions** (`suggestions.ts`, règles pures dans setup-plan.ts,
  réglage `island.suggestions`, oui) : jamais rien de fait tout seul, une fois
  par cas (`island.suggested`). Le bon moment : premier fichier glissé sur
  l'île (`island.state` → drop) → Étagère ; première clé USB ou première visio
  → Contrôles. Ces deux-là viennent du Rust (`services/hints.rs`, un fil de
  ~6 s, seulement si Contrôles est éteint et le cas pas encore proposé :
  lecteurs amovibles, micro/caméra pris par une autre appli qu'Ondine →
  événement `island-hint`). L'onglet oublié : `island.tabSeenAt` (jour de la
  dernière ouverture, noté par island.ts une fois par jour), `usageSince` (fin
  de l'assistant, ou premier démarrage en 1.2.2) ; 21 jours sans ouverture →
  « Masquer l'onglet … ? », au plus une par regard (6 h), jamais s'il reste
  3 onglets. « Revoir les propositions » (Réglages → Onglets) vide la liste.
- **Animations** : la hauteur de l'alerte suit l'étape (`data-step`,
  island.css), donc la gelée de l'île s'y ajuste au ressort ; points d'étape
  avec la pastille à ressorts de `tab-pill.ts` ; l'étape sort comme un
  onglet (`tabOut`) et la suivante arrive en cascade (`staggerIn`) ; les
  icônes d'onglets de l'aperçu arrivent avec un rebond. Réduire les
  animations ou Calme : tout change d'un coup.
- Tests : `tests/front/setup.test.ts` (cartes ↔ vrais modules, ids du Rust ↔
  `APP_CARDS`, plan, profils, prénom, propositions) ; Rust : `services::apps`,
  `services::hints`, `settings::first_name_and_suggestions_are_checked`.

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
  grandisse. Rien sous le champ (île épurée en 1.2.2) : ce qui part et vers
  où, et la consigne exacte, sont dans les Réglages du module
  (`src/settings/askclaude-page.ts`, sous-menus Général et Personnalité).
  Le premier mot d'Ondine est écrit en local (gratuit).
- Dépôt sur l'île : « Parler à Ondine » prépare le fichier et ouvre l'onglet.
- Affichage fluide (1.2.4, `flow.ts`, calculs dans `flow-logic.ts`) : la
  liste des bulles (`.ask-thread`) n'est jamais refaite d'un bloc. `draw()`
  refait ce qui l'entoure ; `syncThread` met la liste à jour par clés (`hello`,
  `b<i>`, `pending`, `live`, `typing`) et signatures : une bulle inchangée
  reste (pas de clignotement), une bulle qui s'en va s'efface sans prendre de
  place (`leave`, la liste est `position: relative`), les autres glissent à
  leur nouvelle place (FLIP). Sujets `askclaude.voice` `partial` et
  `transcribing` : seulement la bulle en direct, regroupés par image
  (`scheduleLive`, rAF + filet de 120 ms) ; `LiveWords` compare les mots
  (`diffWords`) : les mots stables ne bougent pas, les nouveaux arrivent en
  fondu (`.ask-in`), une fin réécrite passe en fondu croisé (`.ask-swap`,
  deux textes empilés en `inline-grid`). La bulle en direct a toute sa largeur
  (85 %) : rien ne pousse les mots. À `final`, elle devient votre message
  (`morphBubble` : lignes du haut et du bas effacées sur place, taille qui
  glisse, pointillé en `::after` qui s'efface). La réponse : `speak()`
  (plops.ts) fixe le moment de chaque lettre d'avance (`revealTimes`, un pas
  régulier + pauses après la ponctuation) et avance image par image (rAF,
  filet `setTimeout` si la fenêtre ne dessine plus ; ~30 images/s en éco) ;
  `Typewriter` ajoute chaque morceau en fondu (`.ask-ch`) et garde la fin du
  mot en cours invisible à sa place (`.ask-ghost`, `wordEnd`). `HeightTween` :
  la hauteur du texte (`.ask-bubble-text` autour de `.ask-flow`) glisse quand
  une ligne s'ajoute, donc l'île (fit.ts) grandit ligne par ligne.
  `ScrollFollow` : défilement amorti vers le bas, seulement si vous étiez en
  bas. Pendant un échange (écoute, envoi, réponse qui s'écrit) la vue porte
  `data-island-fit-hold` (`FIT_HOLD_ATTR`) : l'île grandit mais ne rétrécit
  pas (`settle(…, hold)`), une seule fois à la fin. Aucun texte n'est changé
  dans un élément sans enfants (les chiffres « rouleraient », motion.ts).
  « Réduire les animations » ou mascotte Calme (`instant()`) : affichage
  direct. `voice.level` n'est écouté que par le halo (jamais un redessin de
  la vue). Jelly (`start()`) pose la forme actuelle des ressorts avant le
  premier pas : plus d'image où l'île montre d'un coup sa nouvelle taille.
- Parakeet, mots en direct (`askclaude_voice.rs`, `LivePartials`) : pendant
  la capture, le son est aussi gardé en mémoire pour un fil à part qui le
  réécrit en entier (`stt::transcribe`) quand `LiveSchedule::tick` le dit :
  toutes les ~0,9 s de son, seulement si vous parlez
  (`SilenceGate::talking`, moins de 500 ms de silence), jamais deux à la fois
  (un tour sauté si la précédente n'est pas finie), et pas plus de la moitié
  du temps (`live_every` : au moins 2 × la durée de la dernière, 4 s au plus).
  Coupé en mode Économie. À la fin de la capture, `drop` attend la
  transcription en cours et plus rien ne part ; puis `transcribing` et la
  transcription complète (le texte final).
- Outils de fichiers (`askclaude_tools.rs`, réglage `fileTools`, désactivé par
  défaut) : quatre outils proposés à l'IA, décrits dans le format de chaque
  API (`Request.tools`) :
  - `chercher_fichiers {requete}` : par le NOM seulement, dans Documents,
    Bureau, Téléchargements, Images, le dossier d'Ondine et les fichiers
    récents ; parcours en largeur, sans liens, sans dossiers techniques
    (`SKIP_DIRS`), ni exécutables, ni dossiers exclus, borné (40 000 entrées,
    profondeur 7, 2,5 s) ; 12 résultats au plus, chacun repassé par
    `check_path`. Attend l'accord avant la recherche et le partage des noms ;
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
- Outils du PC (`askclaude_pc.rs`, réglage `pcTools`, désactivé par défaut) :
  chaque outil passe par la commande du module concerné (`modules::invoke`,
  qui vérifie qu'il est activé) ou par son sujet du bus, comme son onglet :
  - regarder, après accord : `etat_pc` (system.snapshot), `agenda`
    (agenda.upcoming), `meteo` (weather.current), `musique_en_cours`
    (media.state sans pochette), `etat_son_ecran` (controls : state, screens,
    theme, radios), `chercher_notes` (notes.search) ; résultat coupé à
    6 000 caractères ;
  - agir après accord :
    `regler_volume`, `couper_son`, `regler_luminosite` (tous les écrans),
    `mode_sombre`, `controler_musique`, `lancer_minuteur` (bus
    `timer.start`, écouté par l'onglet Minuteur ; le module n'a pas de
    Rust, d'où `modules::module_enabled` au lieu de `is_active`),
    `creer_note` (notes.note_save, comme le bouton de l'onglet),
    `jouer_expression` (`mascot.emote`) ;
  - agir après accord (`Action::Pc`, carte « Faire / Annuler ») :
    `ouvrir_application` (entrées « app » et « tool » du Lanceur, puis
    launcher.launch), `ouvrir_site` (`web_url` : http(s) seulement),
    `chercher_web` (adresse de `launcher::search_url` avec le moteur du
    Lanceur, puis comme `ouvrir_site` ; Ondine ne voit pas les résultats),
    `poser_sur_etagere` (un fichier numéroté, `check_path`, bus `shelf.add`),
    `regler_radio` (Wi-Fi, Bluetooth).
  Aucun outil ne supprime, ne lance de commande ni n'ouvre le terminal. La
  consigne demande d'agir seulement à la demande de la personne, jamais
  parce qu'un document le dit. L'activité est `{kind: "did", what, value}` ;
  le front en fait une phrase (`doneText`, `askText`).
  Les commandes rapides reconnues directement dans le message humain, sans
  appel à l'IA, gardent leur exécution locale immédiate (`plan_local`). Les
  anciens réglages explicitement activés restent conservés ; une désactivation
  pendant une demande d'accord est revérifiée au moment de confirmer.
- **Voix** (1.2.2, `askclaude_voice.rs`, `platform/voice.rs`, front
  `index.ts` + `plops.ts`) :
  - raccourci global `voiceHotkey` (Ctrl+Alt+V par défaut, choix proposés
    `HOTKEYS`, personnalisé depuis 1.2.4, ou aucun) ; `micMode` : `once` (appuyer, arrêt au silence ou
    au 2e appui) ou `hold` (maintenir, arrêt au relâchement) ; Échap = un
    raccourci global posé seulement pendant l'écoute ; bouton 🎙️ dans
    l'onglet (commande `listen`, `voice_stop`). Un fil vérifie chaque
    seconde que les raccourcis suivent les réglages ;
  - reconnaissance `voiceEngine` : `windows` (défaut) = `SpeechRecognizer`
    (WinRT, marche sans paquet MSIX ; dictée libre = service en ligne de
    Microsoft, réglage Windows « Reconnaissance vocale en ligne », erreur
    0x80045509 traduite), langue de l'appli (fr-FR / en-US) si elle est dans
    `SupportedTopicLanguages` (sinon une variante, sinon celle de la voix de
    Windows), sous-titres par `HypothesisGenerated`, niveau par
    `IAudioMeterInformation` ; `api` = capture WASAPI en mémoire (mono),
    fin au silence (`SilenceGate`), WAV 16 kHz, puis OpenAI
    `audio/transcriptions` (gpt-4o-mini-transcribe) ou Gemini (audio en
    `inline_data`) ; avec Claude : clé OpenAI, sinon Gemini, sinon une
    erreur claire. Personne n'a parlé : rien ne part. Rien sur le disque ;
    `offline` (1.2.3) = dictée 100 % hors ligne, moteur SAPI de bureau
    (voir « 1.2.3 : dictée hors ligne, pancarte, pont de fichier, nouvel
    appareil ») ;
  - échec de la dictée : `voice::Failure {message, fix, detail}`. L'état
    « Unknown » (6) et les HRESULT inconnus sont expliqués par les réglages
    de Windows LUS dans le registre (reconnaissance en ligne, stratégie
    `InputPersonalization`, micro des applis de bureau) ; `detail` (étape,
    code, langues, réglages) va dans le journal. L'événement `error` porte
    `fix` (page ms-settings d'une liste fixe, ouverte par `voice_fix`) et
    `apiTo` (une clé OpenAI ou Gemini est rangée : bouton « Passer à la
    transcription par l'API », qui change `voiceEngine` puis réécoute) ;
  - discrétion (`discreet`) : micro pris par une autre appli
    (`media_use`), `presentation_busy`, `timer.focus` / `agents.quiet` →
    `blocked`, et `voice_state.discreet` coupe les plops ;
  - « Regarde ça » (`lookHotkey`, aucun par défaut) : image de la fenêtre
    active (pas une fenêtre d'Ondine ; `record::Grabber`, 1600 px au plus,
    PNG en mémoire), reprise par `prepare {look: true}` et montrée comme
    un fichier joint : elle ne part qu'au clic ;
  - front : une seule fenêtre « s'en occupe » (`owner` : la bulle d'Ondine
    sur le bureau si l'onglet y est, sinon l'île) : ouvrir l'onglet,
    `mascot.emote` surprised puis listening, envoyer le texte. La réponse
    s'écrit petit à petit (`speak`, ~55 caractères/s, 7 s au plus) avec une
    goutte par syllabe (Web Audio, timbre par mascotte `TIMBRES`, hauteur
    `moodShift`), `mascot.emote talk` au début, `mascot.talk` à chaque
    syllabe, l'humeur à la fin ; animations réduites / Calme : texte d'un
    coup. Mains libres (`handsFree`) : `listen {handsFree}` après la réponse ;
  - commandes rapides (`askclaude_quick.rs`, `quick {text}`, réglage
    `quickCommands`) : minuteur, volume, son, luminosité, musique, note,
    mode sombre, FR et EN, en `Call` d'outil du PC faits par
    `askclaude_pc::plan` ; le tour est gardé dans la conversation (« C'est
    fait ! », note pour l'IA). Une question (« ? ») n'en est jamais une.
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

Réglages → Performances et journal : `general.perfMode` = `high` (Performance
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
| Système : disques | 30 000 | 30 000 | 60 000 | la batterie est lue à chaque tour (processeur), c'est très léger |
| Contrôles : micro / caméra utilisés, micro coupé | 1 000 | 2 000 | 3 000 | le raccourci micro réagit tout de suite (raccourci global) |
| Étagère : Téléchargements | 2 000 | 3 000 | 6 000 | |
| Règles : fichiers en attente « stables » | 250 | 500 | 1 000 | sans fichier en attente, le fil dort jusqu'au prochain coup d'œil aux lecteurs |
| Règles : lecteurs branchés | 1 000 | 2 000 | 5 000 | |
| Agenda : fichiers .ics, rappels | 10 000 | 15 000 | 30 000 | |
| Réseau : Internet, VPN | 3 000 | 5 000 | 15 000 | |
| Lanceur : raccourci réservé | 1 000 | 1 000 | 3 000 | |
| Profils automatiques | 30 000 | 30 000 | 60 000 | |
| Météo : « l'heure de redemander ? » | 10 000 | 10 000 | 30 000 | |
| Animations de l'île : touches (Verr Maj, Ctrl+C/X/V, volume) | 40 | 50 | 100 | seulement si une de ces cases est cochée |
| Animations de l'île : veille, Wi-Fi (sinon) | 1 000 | 1 000 | 3 000 | le Wi-Fi est lu toutes les 10 s |

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
| Halo de l'île (pendant un halo seulement) | 60 im/s | 60 im/s | 30 im/s | `halo.ts` ; 30 im/s pour les halos lents ; arrêté sans halo ou île cachée |
| Animations de l'île : heure de partir, bonjour, ciel | 30 000 | 30 000 | 60 000 | `halosClock` |
| Animations de l'île : niveau du micro / de la musique | 66 | 80 | 160 | `halosLevel`, seulement micro utilisé ou musique (réglage) |
| Accueil : cartes relues (seulement Accueil affiché) | 1 000 | 1 000 | 2 000 | `homeTick` ; les `load()` des cartes toutes les 5 à 30 s |

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

Pour comparer : Réglages → À propos → « Ressources utilisées ».

## Ondine et les fenêtres (`src/modules/windowlife/`, `src-tauri/src/modules/windowlife.rs`, `src-tauri/src/platform/winlife.rs`)

Module sans onglet. Un thread (4 fois par seconde, 2 en éco ; 30 quand la
souris est tout près de l'île) lit la fenêtre au premier plan
(`winlife::foreground` : place sans bordure invisible, agrandie, à Ondine…)
et publie ce qu'il voit ; le front en fait des expressions (`mascot.emote`,
rien en mode Calme). Réglages (les intrusifs coupés par défaut) :
`avoidForeground` (non : source `foreground` de dodge.rs, sauf fenêtre
agrandie ou plein écran), `perchTitle` (non), `throwSnap` (non : à la fin
d'un déplacement, island/mod.rs appelle `throw_window` ; un geste de plus de
1800 px/s colle la fenêtre au premier plan à la moitié gauche / droite,
l'agrandit (haut) ou la restaure (bas), `push`), `fullscreenHop`
(`surprised` ; le mode présentation cache toujours l'île), `sitEdge`
(`sit-edge`), `mouseShake` (`laugh` / `hide`), `toastRoom` (heuristique :
fenêtres `Windows.UI.Core.CoreWindow` petites dans le coin bas droit → source
`toast`), `nightSunglasses` (21 h – 6 h, 9 pixels de la nouvelle fenêtre au
premier plan, au plus toutes les 15 min), `agendaClimb` (`agenda.reminder` →
`climb`), `lockGoodbye` (`OpenInputDesktop` refusé = verrouillé : `goodbye`,
puis `stretch`), `tidyForgotten` (non) + `forgottenMins` (une notification
propose « Réduire » : commande `minimize`, jamais fermer). Le « pont » de
fichiers à travers l'île n'est pas fait (l'Étagère sait déjà glisser un
fichier vers l'Explorateur). Et `swallow` (non) : le « trou noir », voir
« 1.2.4 : le trou noir » à la fin.

## Fenêtre de réglages : catégories et sous-menus (`src/settings/main.ts`)

> Depuis 1.2.4, la barre est remplacée par deux colonnes (voir « deux colonnes,
> verre liquide, annuler » plus bas) ; le rangement des pages ci-dessous reste.

- **Rangement 1.2.2** (`src/settings/layout.ts`, données pures testées dans
  `tests/front/settings-layout.test.ts`) : cinq groupes dans la barre
  (`NAV_GROUPS`, six depuis 1.2.4 avec **Voix** en premier, voir plus bas) :
  - **Ondine** : Général (prénom, langue, Vous / Tu, Lancer avec Windows,
    Refaire l'assistant), Mascotte, Parler à Ondine (page du module
    `askclaude`, id `module:askclaude` inchangé) ;
  - **L'île** : Apparence, Comportement (sous-menus « Comportement de l'île »
    et « Ondine et les fenêtres » : le module `windowlife`, son interrupteur
    Activé et ses champs), Animations et halos (voir plus bas), Onglets ;
  - **Automatiser** : Règles, Profils ;
  - **Modules** : les catégories (`MODULE_CATEGORIES`) ; les modules rangés
    ailleurs (`MODULES_ELSEWHERE` : rules, askclaude, halos, windowlife) n'y
    sont plus ;
  - **Sécurité et système** : Confidentialité, Identifiants, Sauvegarde, Mises
    à jour, Performances et journal, À propos (avec le mode démo).

  Seules les pages bougent : chaque réglage garde sa clé dans son module
  (`modules.<id>.values.<clé>`) ou dans `general` / `island`. Une page peut
  afficher les champs de plusieurs modules (`fieldRows(man, champs)`
  enregistre dans le bon module). Une page qui suit un module (`Page.module`,
  ou `Sub.module` pour une section) porte le point « désactivé » dans la barre.
- **Animations et halos** (id `animations`) : `ANIMATION_SUBS` range les champs
  du module Animations de l'île et les halos de batterie du module Système
  (`MOVED_FIELDS.system` : la page Système ne les montre plus et met un lien
  à leur place) en Style, Le PC, Ondine et les agents, Son et clavier, Ma
  journée, Le liquide. Chaque sous-menu commence par **« Tout »** (clé
  `tout:<sous-menu>`) : allumé si au moins un moment l'est ; le couper met les
  oui/non à faux et un choix qui a « Jamais » (`chargeHalo`) à `never` ; le
  rallumer remet tout (un choix éteint reprend son défaut). Dans Style,
  « Tout » est l'interrupteur du module. Un champ de `halos` non rangé (ajouté
  plus tard) tombe dans Style ; le test l'interdit.
- **Anciennes places** : `resolvePlace(page, sous-menu)` mène une page d'avant
  1.2.2 à sa nouvelle place (`module:halos` → `animations`,
  `module:windowlife` → `behavior`/`windows`, `general` + `updates` / `perf`
  / `about` / `island` → leur page…). Servent la page retenue dans
  `localStorage` et tout lien profond `go(page, clé, sous-menu)`. La
  recherche connaît les anciens noms (`FORMER_NAMES` : « Animations de
  l'île », « Ondine et les fenêtres », « Halos de batterie »…).
- La barre latérale range les pages de modules en **catégories** repliables
  (`MODULE_CATEGORIES` : IA, Fichiers, Organisation, Outils IT, Le PC
  au quotidien ; un module inconnu va dans « Autres modules »). Titres en texte
  seul ; dans une catégorie, l'ordre des onglets. Les catégories ouvertes sont
  retenues (`localStorage` « settings.cats ») ; celle de la page affichée
  s'ouvre toute seule.
- Une page longue a des **sous-menus** (`Page.subs`) : Comportement, Animations
  et halos, Onglets, Mascotte, Profils (un par profil), et pour les modules `MODULE_SECTIONS`
  (Agents IA, Parler à Ondine, par clé de champ du manifeste ; un champ non
  listé va dans le premier sous-menu). Ils se déplient sous la page dans la
  barre (pli `grid-template-rows`), la page n'affiche que celui choisi, retenu
  par page (`localStorage` « settings.subs »).
- Le rendu dessine **toute** la page et marque chaque bloc du haut avec
  `data-sub` (`inSub`, controls.ts) ; `showPage` retire les autres blocs avant
  `applyMode`, ce qui fait que « N réglages de plus » compte le sous-menu
  affiché. Un sous-menu dont rien ne resterait en Simple est caché dans la
  barre (`dimSubs`, classe `dim`) et n'est jamais affiché vide : la page ouvre
  le premier sous-menu qui a quelque chose (il revient en Complet). Un résultat de recherche ou un lien profond vers une ligne
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
  S'adresser à moi, Lancer avec Windows), Comportement (Bord de l'écran,
  Toujours en mini, Raccourci ; plus Activé et l'essentiel du manifeste de
  windowlife), Apparence (Thème, Style des icônes, Élasticité), Animations et
  halos (les trois réglages du halo et chaque « Tout » : aucun sous-menu vide),
  Performances et journal (Performances, Économie d'énergie, Mode utilisé),
  Onglets (la liste des modules, marquée `data-essential` dans le DOM), Mascotte
  (Afficher la mascotte, Mascotte, Couleur, Ondine vit sur le bureau, et une
  ligne par sous-menu), Profils (Profil actif). Règles, Confidentialité,
  Identifiants, Sauvegarde, Mises à jour et À propos restent entières
  (`WHOLE_PAGE`) : courtes, ou pas une liste de réglages.
- `mode.ts` (`applyMode`) travaille sur la page déjà dessinée : `.row[data-key]`
  et `section.group[data-key]` ; un conteneur `data-essential` garde tout ce
  qu'il contient ; `data-follows="<clé>"` suit la ligne de cette clé. La recherche trouve tout : un résultat caché en Simple porte
  l'étiquette « réglage avancé », et y aller (comme un lien profond vers une
  ligne cachée) passe en Complet avant de faire briller la ligne.
- Tests : `tests/front/visibility.test.ts` (champs visibles selon le mode,
  compte « N de plus », 1 à 3 champs essentiels par module, défauts).

## Fenêtre de réglages : nouveau style et bandes vivantes (1.2.4, `src/settings/hero.ts`, `frame.ts`, `src/styles/settings-frame.css`)

- **Style** : `settings-frame.css`, chargé après `settings.css` (settings.html),
  redéfinit les jetons et la disposition : fond `--win-bg` (#020306 en
  sombre), barre latérale sans verre ni trait, tout le contenu dans UNE carte
  (`.content`, #070a10, rayon 26 px), blocs `.group-body` en cartes (#0b0f16,
  rayon 18 px), titres de groupes en petites capitales espacées. Thème clair :
  même structure, surfaces claires ; les bandes restent sombres. La pastille
  de la page active (`.nav-pill`) et les pilules prennent `--page-color`, posée
  sur `#app` par `showPage`.
- **Fond des Réglages** (Apparence → « Fenêtre des Réglages ») : `html[data-backdrop]`
  vaut `deep` (défaut, fond plein même avec Mica) ou `blobs` (les taches
  d'avant derrière une carte en verre, sans flou en éco). Préférence de cette
  fenêtre seulement, dans `localStorage` (« settings.backdrop »), comme l'ordre
  du podium : rien dans le fichier de réglages ni dans le Rust.
- **Pastille d'état** (bas de la barre, `frame-logic.ts` `statusLine`) : si le
  module `dictation` existe et est activé, « Prête · maintenir <touche> »
  (touche lue dans `modules.dictation.values` : `holdKey`, `hotkey`, `key` ou
  `shortcut`, nom affiché par `keyName`) ; sinon « Ondine <version> · mises à
  jour automatiques / manuelles », ou ce qu'a répondu « Rechercher maintenant »
  dans cette fenêtre. Aucune requête réseau pour l'écrire.
- **La bande** `hero({ title, subtitle?, color, mascots?, actions? })` (contrat
  inchangé) : un canvas de fond (la couleur de la page qui respire en haut à
  droite, période 7 s ; des bulles qui montent et que la souris écarte ; la
  vague de derrière), les mascottes (un `GumEngine` par goutte, dans un
  `div.page-hero-mascot` déplacé en `transform`), puis un canvas de devant (la
  vague de devant, au-dessus des gouttes qui y trempent) et le texte.
  **Une seule boucle** `requestAnimationFrame` pour toutes les bandes ; les
  moteurs gomme reçoivent cette boucle comme hôte (`GumEnv.frameLoop` qui
  s'inscrit dans la bande), ils n'ont pas de boucle à eux. La boucle s'arrête
  fenêtre cachée (`document.hidden`), bande hors écran (IntersectionObserver)
  ou retirée de la page (la bande est alors jetée : moteurs détruits).
  `reducedMotion()` ou mode éco (`perfMode()`) : image fixe, redessinée
  seulement à un changement de taille ou à un clic (l'expression change, sans
  saut) ; le changement de mode est suivi à chaud (`onPerfChange`, media query).
  Un clic sur une goutte : `react("poke")`, un geste du manifeste gomme
  (surprise, rire, coucou…) et un saut qui fait un rond dans l'eau en
  retombant. De temps en temps : un petit saut, un geste, un regard vers une
  voisine ; les yeux suivent la souris sur la bande.
- Logique pure, testée (`tests/front/settings-hero.test.ts`) : `hero-sea.ts`
  (bulles, poussée de la souris, vague et ronds, nage et saut, zone de nage
  jamais sous le texte, nombre de gouttes selon la largeur) et `hero-theme.ts`
  (couleurs par groupe `GROUP_COLORS`, par catégorie de modules
  `CATEGORY_COLORS`, par page `PAGE_COLORS`, contrastes AA vérifiés contre
  l'encre #04121a et le fond des bandes ; troupes `PAGE_CASTS` ou tirées de
  l'id de la page par `castFor` ; une bande Voix sans mascottes retrouve sa
  troupe par sa couleur, `COLOR_PAGES`).
- **Dans `main.ts`** : `showPage` pose la bande de la page (titre, `Page.sub`
  limité à deux lignes, `Page.actions`, `Page.cast`) puis les **pilules** des
  sous-menus (`subPills`, mêmes choix que la barre : `chosenSubs`, points
  « désactivé », sous-menus cachés en Simple via `dimSubs`). La bande est
  gardée (`heroKeep`) quand la même page se redessine (sous-menu, réglage
  changé) : ses gouttes continuent ; seule la suite de la page glisse.
- **Groupe Voix** (`NAV_GROUPS[0]`) : `VOICE_NAV` range `VOICE_PAGES` (icônes
  `VOICE_ICONS` de `voice/pages.ts`) avant Ondine. Leur `render(page)` reçoit
  la page affichée elle-même (elles dessinent leur bande) ; ce qu'il renvoie
  est appelé quand on la quitte (autre page, recherche). Une page Voix
  affichée n'est pas redessinée pour un réglage changé ailleurs. Point
  « désactivé » via `module`, recherche par leur nom, liens profonds
  `go("voice:dictation")` / « settings.goto ». `dictation` et `callnotes` sont
  dans `MODULES_ELSEWHERE` (pas de seconde page dans Modules).

## Fenêtre de réglages : deux colonnes, verre liquide, annuler (1.2.4, `src/settings/main.ts`, `nav-logic.ts`, `src/styles/settings-nav.css`)

Remplace la barre latérale repliable de 1.2.2 (catégories et sous-menus
dépliés dans la barre, `nav-pill.ts` retiré). Rien n'est renommé : mêmes
pages, mêmes ids, mêmes clés de réglages, mêmes liens profonds
(`go(page, clé, sous-menu)`, « settings.goto », `resolvePlace`).

- **1re colonne** (`.rail`, `drawRail`) : la recherche en haut, les **sept
  rubriques** fixes (`NAV_GROUPS` : Ondine, Voix, L'île, Automatiser,
  Modules, Système, À propos ; « Sécurité et système » s'appelle Système,
  À propos est une rubrique : page `about`, sous-menus « Version et
  nouveautés » et « Captures d'écran »), chacune avec son icône
  (`RUBRIC_ICONS`, emoji tracé par icon.ts en style épuré) et son nombre de
  pages ; Simple / Complet et la pastille d'état en bas. Rien ne s'y déplie.
- **2e colonne** (`.col2`, `drawCol2`, lignes calculées par `column2`) : les
  pages de la rubrique (Modules : sous les titres de `MODULE_CATEGORIES`), et
  les sous-menus de la page affichée dépliés juste sous elle. Choisir une
  rubrique rouvre sa dernière page vue (`pageForRubric`, `localStorage`
  « settings.rubrics ») ; « settings.page » et « settings.subs » gardent
  leur rôle. « settings.cats » n'existe plus (effacé au démarrage).
- **Contenu** : le fil d'Ariane `Rubrique › Page › Sous-menu` (`crumbs` :
  la rubrique mène à sa première page, la page à son premier sous-menu, le
  dernier morceau ne mène nulle part ; un nom de profil n'est pas traduit),
  puis la bande (hero.ts, inchangée), les outils de la page (préréglages,
  « Réinitialiser la page ») et les blocs. Sous 900 px (`NARROW_PX`) la
  2e colonne devient une bande de pages au-dessus du contenu et les
  sous-menus reviennent en pilules (`subPills`) ; sous 700 px la 1re colonne
  ne garde que les icônes.
- **Mouvement façon iOS** (courbe `IOS_EASE`, `cubic-bezier(.32,.72,0,1)`) :
  une pastille en verre par colonne (`glass-pill.ts`) glisse d'une ligne à
  l'autre comme une goutte (`glideFrames` : quatre étapes WAAPI, elle
  s'étire puis s'écrase un peu ; le reflet suit la souris via `--mx`) ; la
  2e colonne arrive en cascade au changement de rubrique, les sous-menus en
  cascade quand ils se déplient ; la page arrive de la droite quand on va
  plus loin dans l'ordre de lecture, de la gauche quand on revient
  (`direction`, sur `[rubrique, page, sous-menu]`). `still()` =
  `reducedMotion() || perfMode() === "eco"` : tout saute à sa place.
- **Verre liquide** (`settings-nav.css`) : colonnes translucides
  (`backdrop-filter` flou et saturation) au-dessus d'un fond aux taches de
  couleur qui bougent lentement (`.nav-backdrop`, plus discret en fond
  « deep », noir profond en sombre) ; interrupteurs au pouce bombé qui
  s'étire à l'appui. Mode Économie (`body[data-perf="eco"]`) : plus de flou
  ni de taches qui bougent.
- **Menu de choix** (`glass-select.ts`) : tout `<select>` des Réglages
  (`controls.ts select()`, `rules-editor.ts`, et ceux qu'une page crée elle-
  même, habillés par `upgradeSelects` au dessin de la page et par un
  MutationObserver) devient une pilule et une liste en verre
  (`role="listbox"`, options `role="option"`, coche sur le choix actuel,
  pastille qui suit la souris ou les flèches, ↑ ↓ Début Fin, lettre, Entrée,
  Échap, Tab). Le vrai `<select>` reste caché dans la page : choisir change
  sa valeur et envoie `input` et `change` ; `select.value = …` écrit par le
  code met la pilule à jour (accesseurs `value` / `selectedIndex` de
  l'instance).
- **« Modifié »** (`modified.ts`) : après chaque dessin (`markModified`),
  une ligne dont la valeur diffère de son origine porte la pastille
  « Modifié » et « Réinitialiser ». Origine : le `default` du manifeste pour
  un champ de module (la ligne porte `data-field="<module>.<clé>"`, posé par
  `fieldRows`), `defaultSettings()` aux chemins de `ISLAND_PATHS` (par page,
  par libellé de ligne) pour les pages de l'île. « Réinitialiser la page »
  demande confirmation dans la page (pas de `confirm()`), puis remet toutes
  les lignes modifiées en un seul changement annulable.
- **Annuler** (`undo.ts`, `UndoStack`) : `save()` retient, pour chaque
  changement, les champs changés dans les deux sens (`settingsDiff`) ; un
  même réglage changé encore dans les 1,2 s reste un seul changement. Une
  bulle « <réglage> modifié · Annuler » reste quelques secondes ; Ctrl+Z
  annule (dix changements au plus), Ctrl+Y ou Ctrl+Maj+Z refait, sauf dans
  un champ de texte en cours de saisie (`typingTarget`). Annuler ne remet
  que ces champs-là : ce qu'une autre fenêtre a changé entre-temps reste.
  Changer de mode Simple / Complet n'est pas retenu.
- **Chercher partout** : Ctrl+K, ou « / » hors d'un champ de texte, met le
  curseur dans la recherche. Dans les résultats, un réglage simple
  (interrupteur, menu de choix, segmenté) des pages `INLINE_PAGES` et des
  champs de modules se change sur place (`inlineControl`) ; le reste mène à
  sa ligne, comme avant.
- **Préréglages** (`presets.ts`) : en haut d'Animations et halos (Calme,
  Équilibré, Tout animé, calculés depuis le manifeste `halos` par
  `animationPresets`) et d'Apparence (Sobre, Classique, Expressif sur
  `island.motion` et `island.elasticity`). Un clic applique tout en un seul
  changement annulable ; le préréglage qui correspond aux réglages actuels
  est allumé (`activePreset`), sinon « Personnalisé ».
- **Vignettes** (`vignettes.ts`) : Thème, Taille de la mini-île, Style de
  l'île, Style des icônes et Bord de l'écran se choisissent sur de petits
  dessins SVG au trait (groupe `role="radiogroup"`, flèches). Le podium de la
  mascotte ne change pas.
- **Pages de modules** : la ligne « Activé » et les permissions du manifeste
  (en pilules) restent collées en haut (`section.module-bar`, `position:
  sticky`).
- **Retour / suivant** (`nav-history.ts`, `NavHistory`) : chaque place
  visitée (page, sous-menu) est retenue ; le bouton 4 de la souris
  (« retour », `button === 3`), Alt+← et la touche « Précédent » reviennent,
  le bouton 5, Alt+→ et « Suivant » avancent. Une place qui disparaît (module
  retiré) est oubliée (`forget`).
- Tests : `tests/front/settings-nav.test.ts` (colonnes, fil d'Ariane, sens du
  mouvement, trajet de la pastille, historique) et
  `tests/front/settings-undo.test.ts` (annuler, préréglages, « Modifié ») ;
  à faire sur Windows : `docs/tests/TESTS-reglages-deux-colonnes.md`.

## 1.2.3 : dictée hors ligne, pancarte, pont de fichier, nouvel appareil

### Dictée 100 % hors ligne (`platform/voice.rs` `dictate_offline`, `askclaude_voice.rs`)

Troisième choix du réglage `voiceEngine` de Parler à Ondine : `offline`
(« Hors ligne (rien ne quitte le PC) »), à côté de `windows` (défaut,
inchangé) et `api`.

- **Le choix** : le moteur de reconnaissance « de bureau » de Windows (SAPI 5 :
  `SpInprocRecognizer` + `ISpRecoGrammar::LoadDictation`), par la crate
  `windows` déjà là (fonction `Win32_Media_Speech` en plus, aucune autre
  dépendance, rien à compiler en C++, rien à télécharger). Il tourne dans le
  processus d'Ondine, sur le micro par défaut (`SpMMAudioIn`) : rien ne
  quitte le PC.
- **Pourquoi pas les autres pistes** : `Windows.Media.SpeechRecognition` (le
  moteur `windows`) ne fait la dictée libre qu'avec le service en ligne de
  Microsoft ; hors ligne il ne reconnaît que des listes de phrases fixées
  d'avance (contraintes « liste » ou « grammaire »), pas une question libre.
  whisper.cpp demande cmake et un compilateur C++ sur la CI. Un modèle
  téléchargé à la demande (Vosk, Whisper en Rust pur) pèserait 40 Mo à
  plusieurs centaines de Mo, plus une bibliothèque native à charger : gardé
  comme repli si le moteur de bureau manque sur trop de PC (voir les limites).
- **Langue** : celle de l'appli (fr-FR ou en-US). Le moteur est un jeton de la
  catégorie `SPCAT_RECOGNIZERS` dont l'attribut `Language` vaut le LCID
  (`40C` pour le français, `409` puis `809` pour l'anglais : `offline_lcids`).
  Pas de jeton : `offline_missing` → la phrase « la dictée hors ligne a besoin
  de la reconnaissance vocale du français, installée sur ce PC : Paramètres
  Windows → Heure et langue → Langue et région → Français (France) → Options
  de langue → Reconnaissance vocale → Télécharger (Windows 10 : …) » et
  `Fix::Pack` (bouton « Ouvrir les paramètres Windows » → `ms-settings:regionlanguage`).
- **Écoute** : événements SAPI lus toutes les 40 ms (`SetNotifyWin32Event`,
  `WaitForNotifyEvent`, `GetEvents`) : `SPEI_HYPOTHESIS` → sous-titres en direct
  (`partial`), `SPEI_RECOGNITION` → une phrase gardée, `SPEI_FALSE_RECOGNITION`
  → bruit oublié. L'objet porté par chaque événement est libéré par
  `event_text` (à la place de `SpClearEvent`). Le moteur de bureau dicte sans
  fin : en mode « once », `EndGate` termine 1 s après la dernière phrase
  reconnue (2,5 s si des mots devinés n'ont jamais été confirmés), ou au
  délai du début si personne ne parle ; en mode « hold », la touche relâchée.
  Échap, 2e appui et garde-fou de durée comme avant. Niveau du micro par le
  même `Meter`.
- **Erreurs** : micro refusé (`MIC_TEXT`, `Fix::Mic`), pas de micro, codes
  SAPI `0x800450xx` (moteur mal installé → la phrase du pack). En hors ligne,
  jamais de bouton « Passer à la transcription par l'API » (`apiTo` vide).
  À l'inverse, quand la dictée en ligne de Windows échoue et que le moteur
  hors ligne est installé, l'erreur porte `offline: true` et l'onglet propose
  « 🔒 Passer à la dictée hors ligne » (change le réglage puis réécoute).
- **Réglages** : « Ce qui part » (askclaude-page.ts, commande `status` →
  `voice.offline {ready, name}`) dit que rien ne quitte le PC, ou que la
  reconnaissance de la langue manque et où l'installer.
- **Limites** : moteur plus ancien, un peu moins précis que la dictée en
  ligne ; pas de ponctuation automatique. Windows 11 a retiré l'appli
  « Reconnaissance vocale Windows » (remplacée par l'Accès vocal) ; le moteur
  SAPI de bureau et ses jetons sont installés avec la reconnaissance vocale
  de la langue, mais leur présence sur les dernières versions de Windows 11
  n'a pas pu être vérifiée d'ici : à confirmer sur le PC de Simon (liste de
  tests). S'il manque, le message le dit clairement.
- Tests (Linux, sans Windows) : `offline_lcids`, `offline_missing` (page et
  phrase), `EndGate` (silence, mots jamais confirmés, bruit, « hold »), stub
  sans moteur.

### La pancarte d'Ondine (`src/mascot/sign-text.ts`, `mascot-state.ts`, `gum-draw.ts`)

La pancarte « ? » des agents (1.2.0) sait maintenant porter un mot court.

- Bus `mascot.sign {text, secs?}` (existait déjà pour l'action de règle
  « Mascotte → pancarte », qui ne montrait qu'une notification) : le mot est
  nettoyé (`cleanSignText` : sans contrôle ni inversion de texte, 14
  caractères au plus, « … » au-delà), traduit par `t()` (le canvas n'est pas
  vu par i18n.ts : « Occupé » → « Busy »), tenu `signSeconds` (8 s ; 2 s à
  10 min), puis baissé. `text` vide ou un clic sur la mascotte : baissé (le
  clic ne fait alors rien d'autre). Une question d'agent ouverte passe avant
  (le « ? » reste prioritaire).
- `MascotExtras.signText` ; la famille gomme (`drawsSignText = true`) le
  dessine : `drawWordSign` lève une planche en bois clair AU-DESSUS de sa
  tête, au bout d'un long manche tenu par la moufle droite, aussi large que
  le mot (`signLayout` : jusqu'à 2,4 R, puis le texte rapetisse), encre des
  yeux. La moufle suit son ressort (la pancarte monte en gelée) ; « Réduire
  les animations » : posée d'un coup. Le « ? » garde sa petite planche.
  Les mascottes « poses » montrent toujours « ? » ; le module Règles affiche
  alors le texte en notification (`signTextDrawn()`).
- Qui la lève : l'action de règle (inchangée, aide ajoutée dans l'éditeur),
  et l'onglet Équipe quand on change son statut à la main (`statusSign` :
  En réunion, Occupé pour Concentration, Pause pour Absent ; 6 s).
- Tests : `tests/front/sign-text.test.ts`.

### Le pont de fichier à travers l'île (`src/modules/team/bridge.ts`, `bridge-path.ts`)

Un fichier lâché sur la cible d'un collègue (module Équipe, et la cible du
chat à deux) part comme avant (`send_files` / `chat_files`, toujours à
accepter par le destinataire) ; en plus, une petite feuille de gomme (dégradé
de la goutte, coin replié) plonge dans l'île par le haut, s'écrase en gelée,
file à travers l'île et ressort par le bord droit, où un rond à la couleur du
collègue s'allume. Chez le destinataire, à l'arrivée du fichier (`received`),
le chemin inverse : elle entre par la gauche et se pose au milieu.

- Mouvement (`bridge-path.ts`, sans DOM) : deux ressorts de spring.ts en
  fractions de la boîte de l'île (elle peut changer de taille en route),
  écrasement selon la vitesse (sx × sy = 1), garde-fou de 4 s.
- Dessin (`bridge.ts`) : un calque `.team-bridge` dans `.island` (qui rogne :
  la feuille passe À TRAVERS l'île), `pointer-events: none`, rien n'anime
  `translate` de `.island`. Interruptible : un clic, un nouveau glisser ou un
  autre pont l'enlève. « Réduire les animations » : seulement le rond du
  collègue, en fondu.
- Tests : `tests/front/team-bridge.test.ts`.

### Règle « un nouvel appareil apparaît sur le réseau local » (`src-tauri/src/modules/rules/newdevice.rs`)

Déclencheur `{type: "network", change: "newDevice"}` (éditeur : Quand → Le
réseau change → « un nouvel appareil apparaît sur le réseau local ») ;
`{nom}` = « nom DNS (IP, MAC) » ou « IP (MAC) ».

- Coupé par défaut : rien ne tourne tant qu'aucune règle active ne le demande
  (et pas en pause) ; `sense.rs` démarre le fil `newdevice::start` à la
  première règle, le lâche (il s'arrête) sinon.
- Balayage doux du réseau local de ce PC seulement : la carte Wi-Fi /
  Ethernet avec une adresse privée (pas un VPN, `platform::netwatch::local_nets`),
  son /24 au plus (`targets`) ; UN ping (une demande d'écho ICMP, 400 ms)
  toutes les 3 s, un tour complet ≈ 13 min, puis 5 min de pause. Aucun port
  essayé, rien vers Internet. Le ping sert à ce que Windows apprenne
  l'adresse MAC des appareils silencieux.
- Toutes les minutes et à la fin d'un tour : la table ARP de Windows
  (`platform::netwatch::neighbors`, `GetIpNetTable2`, lue sans rien envoyer).
  Une adresse MAC jamais vue → la règle part. La liste des déjà vus :
  `%APPDATA%\Ondine\network-devices.json` (MAC, dernière IP, dates ;
  500 au plus), même fichier et même forme que le scanner de la PR #62, plus
  `nets` : les réseaux (« 192.168.1.0/24 via 192.168.1.1 ») dont un premier
  tour complet a été fait. Sur un réseau jamais vu, ce premier tour apprend
  sans prévenir.
- Repris de la PR #62 (branche `bilan-du-jour`, non modifiée) : `targets`,
  `network_label`, les adresses MAC, `Known` (sans la table des fabricants),
  et `local_nets` / `neighbors` de `platform/netwatch.rs` (copiés à
  l'identique pour que la fusion de #62 reste simple).
- Tests : `newdevice.rs` (le /24 privé seulement, apprendre avant de
  prévenir, fichier relu y compris celui de #62, le tour, les textes).

## Fonctions 1.2.3 : ambiance, « … écoute », QR code, écran de veille, débit

Cinq ajouts indépendants, chacun éteint par défaut ou lancé d'un clic.

### Sons d'ambiance (`src/modules/timer/ambient*.ts`, sous-onglet « 🌧️ Ambiance » du Minuteur)

- `ambient-logic.ts` (pur, testé par `tests/front/ambient.test.ts`) : la liste
  des sons, le volume (courbe au carré), le plan du liquide
  (`ambientLiquidPlan`) et l'heure de la prochaine crête (`nextCrestIn`).
- `ambient.ts` : le moteur WebAudio. **Aucun fichier** : pluie (bruit rose
  filtré + gouttes semées dans une boucle de 12 s + grondement brun), vagues
  (bruit brun dont volume et clarté suivent un LFO de 9 s qui part de zéro :
  la crête tombe à `startedAt + période/4`), bruit doux (brun filtré). Fondus
  d'entrée et de sortie interruptibles, un analyseur pour le niveau.
- **Place pour les enregistrements** : tout fichier `mp3/ogg/wav/m4a` déposé
  dans `src/assets/ambient/` est trouvé au build (`import.meta.glob`) et
  s'ajoute à la liste (noms connus dans `FILE_LABELS` : `cafe`, `foret`,
  `feu`…). Le dossier est vide (`.gitkeep`) : n'y mettre que des
  enregistrements CC0 dont la source est notée.
- `ambient-pane.ts` : le sous-onglet (choix, lancer/arrêter, volume, « Lancer
  avec le Pomodoro »). Publie `timer.ambient` `{on, sound, kind, volume,
  level, startedAt, periodMs}` au lancement, à l'arrêt, et le niveau 4 fois
  par seconde quand il bouge. Réglages du Minuteur : `ambientVolume` (40),
  `ambientWithPomodoro` (non). Le choix du son reste dans `localStorage`.
- `halos/liquid-moments.ts` écoute `timer.ambient` (réglage `liquidAmbient`
  des Animations de l'île, oui par défaut) : liquide « liquid-ambient » dont
  le niveau et l'agitation suivent le son, gouttes sur la vitre pour la pluie,
  une `liquidWave` à chaque crête des vagues ; le lac de concentration du
  Pomodoro se tait pendant ce temps. Calme et « Réduire les animations »
  passent par les règles habituelles du liquide.

### « Alex écoute… » (Équipe : `team_listen.rs`, `team_proto.rs`, `team/index.ts`)

- Réglage `shareListening` (non par défaut). Quand il est allumé, le module
  Équipe écoute `media.changed` (module Musique) ; `track_from_media` ne
  garde que titre, artiste et service reconnu, seulement en lecture, nettoyés
  des caractères de contrôle. Toutes les 2 boucles de ménage, `sync` envoie
  `Msg::Listening {title, artist, app}` aux collègues en ligne… **qui
  l'annoncent**.
- **Compatibilité** : `Hello` gagne `features: ["listening"]` (absent = vide,
  `serde(default)`, pas écrit s'il est vide). Une ancienne version ignore ce
  champ inconnu et ne reçoit jamais `listening` (elle ne connaît pas ce « t »
  et couperait la connexion). Test `listening_stays_compatible_with_older_versions`.
- Chez le collègue : une ligne « ♪ Alex écoute « Titre » · Artiste » (liste et
  fiche) ; le clic appelle `listen_open`, qui ouvre dans le navigateur une
  **page de recherche publique** (`search_url` : Spotify, Deezer, Apple Music,
  Tidal ou YouTube Music ; réglage `listenOpen`, « le même service que lui »
  par défaut). Aucun compte, aucune API.

### QR code d'appairage (`team_qr.rs`, `team/qr.ts`)

- « 🔢 Mon code » montre aussi un QR (`clipboard_qr::make`, déjà là) qui
  contient `ondine://pair?v=1&ip=…&code=…&fp=…&mine=0|1` : adresse, code,
  **empreinte** de la clé (16 hex) et « mon PC ». `parse` est strict (IP
  locale seulement, 6 chiffres, `v=1`).
- Lecture sur l'autre PC, décodage hors ligne avec la crate pure Rust `rqrr` :
  1. **« Lire mon écran »** (`qr_scan {source: "screen"}`) : capture de tout
     le bureau (`platform::record::desktop_area`) — le QR est visible par un
     partage d'écran Teams, le Bureau à distance, une VM, une photo ouverte ;
  2. **« Coller l'image »** : une capture copiée (refusée si le presse-papiers
     est marqué sensible) ;
  3. **« Webcam »** : `getUserMedia` dans la page, une image en gris toutes les
     400 ms (640 px de large au plus) vers `qr_frame`, arrêt au bout d'une
     minute ; rien n'est enregistré.
  Notre propre QR est ignoré (même empreinte).
- Le QR remplit le formulaire ; « Ajouter » fait l'appairage SPAKE2 habituel,
  puis `pair_with(…, expected)` **refuse** si l'empreinte reçue n'est pas celle
  du QR. Le code à 6 chiffres reste possible sans QR.

### Écran de veille (`src-tauri/src/modules/screensaver.rs`, `src/screensaver/`, `screensaver.html`)

- Module `screensaver` (🌙), dans `MODULES_OFF_BY_DEFAULT` (Rust et front).
  Réglages : `delay` (10 min, 1 à 120), `clock`, `walk`.
- Un fil lit `platform::idle_ms()` (GetLastInputInfo) toutes les 2 s. Au-delà
  du délai, et si rien ne l'interdit (`busy()` : présentation
  SHQueryUserNotificationState, fenêtre au premier plan en plein écran hors
  bureau, micro ou caméra utilisés, session verrouillée), il place la fenêtre
  `screensaver` (créée cachée une fois, non activante, toujours au-dessus) sur
  l'écran de l'île et envoie `screensaver {on, clock, walk}`. Affiché, il lit
  l'inactivité 6 fois par seconde : dès qu'elle repart en arrière (souris,
  clavier), `{on: false}`, fondu de 280 ms, fenêtre cachée.
- Ondine n'appelle jamais `SetThreadExecutionState` : Windows verrouille et
  éteint l'écran à l'heure prévue, par-dessus.
- La page (`main.ts`) dessine trois couches d'eau aux couleurs de la goutte
  gomme, l'heure et la date (qui dérivent lentement, pour les écrans OLED) et
  la mascotte réglée (son propre `MascotController` sur un bus local, jamais
  relié au Rust) qui se promène (`walk.ts`, pur, testé par
  `tests/front/screensaver.test.ts`). 30 images/s (20 en économie), rien quand
  elle est cachée ; « Réduire les animations » : tout est figé sauf l'heure.

### Test de débit (`src-tauri/src/modules/nettools_speed.rs`, `nettools/speed-logic.ts`)

- Bouton « ⚡ Débit » de l'onglet Réseau, **seulement sur clic** : commandes
  `speed_start` / `speed_stop`. Serveur documenté : `speed.cloudflare.com`
  (`/__down?bytes=N`, `/__up`), sans compte, avec `ureq` (déjà là).
- Phases : latence (5 requêtes vides, médiane), réception (4 flux, 8 s,
  250 Mo au plus), envoi (2 flux, 6 s, 60 Mo au plus). Toutes les 250 ms :
  `nettools.speed {phase, mbps, ping, progress}`, puis `done {down, up, ping,
  server}`, `error` ou `stopped`.
- Pendant le test, le halo `net-speed` (forme `speed` de `halo.ts`) : une
  comète fait le tour du liseré et la lueur pulse, d'autant plus vite que le
  débit monte (`speedLevel` logarithmique → `speedLapMs` 3,2 s → 0,7 s,
  `speedBeatMs` 1,6 s → `MIN_PERIOD_MS`). Immobile avec « Réduire les
  animations » ou le réglage Calme.

## 1.2.4 : reconnaissance vocale sur le PC (Parakeet)

`src-tauri/src/services/speech.rs` (contrat et moteur), `speech_models.rs`
(téléchargement), `speech_audio.rs` (calculs), `src/settings/voice/parakeet-block.ts`
(+ `parakeet-logic.ts`, `parakeet-link.ts`). Technique reprise de Coucou (MIT).

- **Le moteur** : [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 1.13.8
  (Apache-2.0), crate `sherpa-onnx`, fonction `static` : la bibliothèque C++
  précompilée (onnxruntime compris) est liée dans `ondine.exe`, rien à
  installer à côté. Son script de construction (`sherpa-onnx-sys/build.rs`)
  télécharge `sherpa-onnx-v1.13.8-win-x64-static-MT-Release-lib.tar.bz2` sur
  les « releases » GitHub de k2-fsa au premier `cargo build` (rangé dans
  `target/sherpa-onnx-prebuilt/`) : pas de cmake ni de compilation C++. La
  version « MT » (runtime C statique) va avec notre `+crt-static`
  (`src-tauri/.cargo/config.toml`). Variables utiles : `SHERPA_ONNX_LIB_DIR`
  (un dossier de bibliothèques déjà là, rien n'est téléchargé) et
  `SHERPA_ONNX_ARCHIVE_DIR` (l'archive déjà téléchargée, pour un PC derrière
  un proxy d'entreprise : le script vérifie les certificats avec sa propre
  liste, pas celle de Windows).
- **Windows seulement** : la dépendance est dans
  `[target.'cfg(windows)'.dependencies]`. Sous Linux (tests, CI d'audit),
  rien n'est compilé ni téléchargé ; `speech::SUPPORTED` est faux, `ready()`
  aussi, `transcribe` répond « n'existe que dans Ondine pour Windows ».
  Pour vérifier le code Windows depuis Linux :
  `SHERPA_ONNX_LIB_DIR=<dossier vide> cargo clippy --target x86_64-pc-windows-msvc`
  (clippy n'édite pas les liens : un dossier vide suffit).
- **Les modèles** (`speech_models.rs`) : Parakeet TDT 0.6B v3 int8 (NVIDIA,
  CC-BY-4.0 : 4 fichiers, 670 Mo) et la séparation des voix (segmentation
  pyannote 3.0, MIT, 1,5 Mo ; empreinte de voix 3D-Speaker CAM++,
  Apache-2.0, 28 Mo). Adresses Hugging Face à un commit fixe (`/resolve/<sha1>/`),
  taille et SHA-256 de chaque fichier écrits dans le code. Rangés dans
  `%LOCALAPPDATA%\Ondine\Models\<jeu>\`.
- **Téléchargement** : seulement par la commande `speech_download` (bouton
  « Télécharger »). Un fil à part, `ureq` (TLS de Windows), 256 Ko à la fois
  dans `<fichier>.part`, empreinte calculée en route ; à la fin, taille ET
  SHA-256 comparées, puis renommage. Un fichier qui ne correspond pas est
  jeté. Un réseau coupé : le « .part » reste, le clic suivant reprend
  (`Range: bytes=N-`, empreinte recalculée sur ce qui est déjà là ; un
  serveur qui renvoie tout repart de zéro). « Annuler » (`speech_cancel`)
  arrête et jette les « .part ». « Supprimer » (`speech_remove`) libère le
  modèle et efface les dossiers (refusé pendant un téléchargement). Progrès :
  événement Tauri `speech-models` (4 fois par seconde au plus) avec
  `{state, done, total, error, supported, loaded}`.
- **Chargement** : au premier usage (`OfflineRecognizer`, `nemo_transducer`,
  2 à 4 fils de calcul), gardé dans un `Arc`, une transcription à la fois
  (verrou `DECODE`). Un fil le libère après 5 minutes sans servir (jamais
  pendant une transcription), puis s'arrête ; le suivant se charge à nouveau.
- **Contrat** (appelé par la dictée et les notes d'appel) :
  `SAMPLE_RATE` (16 kHz), `ready()`, `transcribe(samples, lang)` (le texte),
  `transcribe_speakers(samples, lang)` (`Vec<Turn>` : voix 0, 1, 2… dans
  l'ordre où elles parlent, début, fin, texte), `to_16k_mono(son, voies, Hz)`.
  `lang` n'est pas utilisé : Parakeet v3 reconnaît seul la langue parmi ses
  25. Sans le modèle : `Err(speech::MISSING)` (phrase claire, traduite).
- **Calculs** (`speech_audio.rs`, testés sous Linux) : rééchantillonnage
  « sinc » fenêtré (Blackman, 32 coefficients, coupure à 92 % de la moitié de
  la plus basse fréquence), moyenne des voies ; découpage en morceaux de 28 s
  au plus, coupés dans la fenêtre de 0,1 s la plus calme des 8 dernières
  secondes ; morceaux de mots de Parakeet (« ▁dem », « ande ») recollés avec
  leur moment ; tours de parole : chaque mot va à la voix qui parle en son
  milieu (sinon la plus proche à moins de 2 s, sinon celle du mot d'avant),
  une pause de 1,4 s ou 40 s de parole commencent un nouveau tour. Séparation
  des voix : `OfflineSpeakerDiarization`, nombre de voix libre, seuil 0,7 ;
  sans ses modèles ou en cas d'échec, tout est la voix 0.
- **Parler à Ondine** : `voiceEngine = "parakeet"` (« Parakeet sur le PC »).
  `askclaude_voice.rs` capte le micro comme pour l'API (WASAPI, `SilenceGate`,
  point rouge), puis `to_16k_mono` et `speech::transcribe` : rien ne part. Le
  modèle manque : l'erreur porte `models: true` et l'onglet propose
  « ⬇️ Télécharger le modèle Parakeet », qui ouvre les Réglages sur
  `module:askclaude#voice` (`followGoto` de `settings/main.ts` comprend
  maintenant « page#sous-menu »). La dictée de Windows échoue et le modèle
  est là : `parakeet: true`, bouton « 🔒 Passer à Parakeet sur le PC ».
- **Réglages** : `parakeetBlock()` (un `group` à poser où l'on veut ; un seul
  écouteur de `speech-models` pour toutes ses copies) : état (pas encore
  téléchargé / téléchargement x % / prêt / échec), barre de progrès,
  Télécharger, Annuler, Supprimer (2e clic de confirmation), et la phrase
  « Tout se fait sur le PC : rien de ce que vous dites n'est envoyé », avec le
  crédit CC-BY de NVIDIA. Posé dans Parler à Ondine → Voix et sons ; les pages
  Dictée et Notes d'appel l'appellent aussi.
- **Taille** : `ondine.exe` grossit d'environ 20 Mo (la bibliothèque et
  onnxruntime), l'installateur d'environ 6 Mo (compressé). Les modèles ne sont
  jamais dans l'installateur.

## Notes d'appel (1.2.4, `src-tauri/src/modules/callnotes.rs`, `callnotes_audio.rs`, `callnotes_text.rs`, `src/modules/callnotes/`, `src/settings/voice/callnotes-page.ts`)

Un appel enregistré d'un clic (bouton « Enregistrer un appel » de la page
Notes d'appel du groupe Voix, ou la pilule de dictée par `callnotes.start` /
`callnotes.stop`), écrit personne par personne, avec un résumé. Inspiré du
Notetaker de Coucou (MIT, voir THIRD-PARTY.md). Module `callnotes`, activé
par défaut (rien ne s'enregistre sans clic), sans onglet.

- **Capture** (`platform/voice.rs` `capture(Source, stop, chunk)`, `#[cfg(windows)]`) :
  deux fils, le micro par défaut (`eCapture`) et la sortie par défaut ouverte
  en WASAPI partagé avec `AUDCLNT_STREAMFLAGS_LOOPBACK` (`eRender` : ce que
  jouent les haut-parleurs, la voix des autres ; aucun robot dans la
  réunion). Le loopback ne donne rien quand le PC se tait : `silence_to_add`
  complète par du silence dès qu'il manque plus de 200 ms, pour que les deux
  côtés restent alignés. Un côté qui ne s'ouvre pas : le micro empêche le
  départ, le son du PC donne seulement un avertissement (`warning`).
- **Audio** (`callnotes_audio.rs`, pur) : `Downsampler` (fréquence de
  l'appareil → 16 kHz, moyenne), `WavWriter` / `read_wav` (16 bits mono, un
  fichier coupé se relit), `Live` (morceaux de 1,5 à 12 s qui finissent sur
  une pause, pour les mots en direct), `segments` (coupe au plus calme, le
  silence écarté). Les fichiers sont TEMPORAIRES :
  `%TEMP%\Ondine-callnotes\<id>-mic.wav` et `-pc.wav`, effacés dès que la
  transcription est écrite (et jamais mis à la Corbeille). Au démarrage,
  `stale_audio` efface ceux d'une note écrite ou supprimée.
- **Pendant l'appel** : un fil par seconde transcrit les morceaux `Live` avec
  `speech::transcribe` (Parakeet) : les mots en direct (micro = « me », PC =
  « pc »), gardés en mémoire seulement ; la page les redemande (`get`) sur
  `callnotes.changed`. Il arrête aussi tout seul : module coupé, micro perdu,
  4 h passées. L'île montre une vue compacte (point rouge, temps, « Arrêter »)
  et rappelle « Prévenez les participants que vous enregistrez » à chaque début.
- **À la fin** (réglage `engine`) :
  - `parakeet` (défaut) : micro en morceaux de 30 s (`transcribe`) → « Vous » ;
    son du PC entier par `speech::transcribe_speakers` → tours par voix.
    Rien du PC mais plusieurs voix dans le micro : tout le monde est
    « Personne 1 », « Personne 2 »… (`build_room`). Parakeet pas prêt : erreur
    claire qui renvoie au téléchargement (jamais de passage à l'API tout seul) ;
  - `api` (choisi par la personne) : morceaux d'une minute vers OpenAI ou
    Gemini (`askclaude_voice::stt_key` / `transcribe`, clé de Parler à
    Ondine, module activé). Les voix du PC ne sont pas séparées.
  `callnotes_text::build` fusionne micro et PC dans l'ordre du temps, retire
  l'écho des autres capté par le micro (`removing_echo` : 60 % des mots en
  commun au même moment) et numérote les voix dans l'ordre où elles parlent
  (« Personne 2 », « Personne 3 »… ; renommables, `rename_speaker`, les
  choses à faire suivent).
- **Résumé** (`summarize`) : l'IA de Parler à Ondine (`askclaude::provider` /
  `model`, sa clé lue par `ctx.credential`), d'un clic ou tout seul si
  `autoSummary` (coupé par défaut). Part : la transcription écrite, balisée
  `<transcription>` (200 000 caractères au plus), jamais l'audio. Réponse :
  du JSON (`parse_summary` : titre, résumé, points clés, choses à faire avec
  qui et quand), jamais exécuté ; sans JSON, le texte devient le résumé.
- **Notes** : `%APPDATA%\Ondine\callnotes\<id>.json` (id = chiffres, l'heure
  de début en ms), écriture via un `.tmp` renommé. Statuts `recording`,
  `processing`, `ready`, `failed` (« Réessayer » ; Ondine fermée pendant un
  appel : reprise toute seule avec Parakeet, sinon au clic). Supprimer =
  Corbeille + « Annuler » (`files::to_trash` / `restore_from_trash`).
- **Commandes** : `status` (état, moteur, Parakeet prêt, destinations de ce
  qui part), `list`, `get`, `start`, `stop`, `rename`, `rename_speaker`,
  `toggle_todo`, `delete`, `summarize`, `retry`, `copy` (Markdown dans le
  presse-papiers), `export` (boîte « Enregistrer sous » de Windows, dossier
  vérifié par `check_path` : dossiers exclus refusés), `to_notes` (bus
  `notes.add` : le résumé et les points clés en note, les choses à faire en
  tâches).
- **Page** (`callnotes-page.ts`, logique pure `callnotes-logic.ts`, styles
  `src/styles/callnotes.css`) : `hero()` et « Enregistrer un appel », bandeau
  rouge pendant l'appel, liste à gauche, note à droite (titre renommable,
  « Aujourd'hui, 10:00 · 32 min · 3 personnes », Copier en Markdown,
  Exporter, Envoyer vers Notes, Supprimer, onglets Résumé / Transcription,
  points clés, cases à cocher, extrait coloré par personne), puis les
  réglages du module et « Ce qui part ». Le temps avance par `pacedInterval`
  (rythme du mode de performance), le point rouge respire en CSS (fixe avec
  « Réduire les animations »).
- Tests : Rust (`callnotes_text` : assemblage micro + PC, écho, renommage,
  Markdown, résumé, nettoyage ; `callnotes_audio` : 16 kHz, WAV, morceaux ;
  `voice::silence_to_add`), front (`tests/front/callnotes.test.ts`).

## 1.2.4 : la dictée partout (`src-tauri/src/modules/dictation*.rs`, `src-tauri/src/platform/dictation.rs`, `src-tauri/src/pill.rs`, `src/pill/`, `src/settings/voice/`)

Module `dictation`, **coupé par défaut** (`MODULES_OFF_BY_DEFAULT`, des deux
côtés). Technique de la touche, du collage et de la pilule reprise de Flow de
Coucou (MIT) et adaptée ; textes, dessins et goutte sont ceux d'Ondine.

- **La touche** (`platform/dictation.rs`) : un crochet clavier bas niveau
  (`WH_KEYBOARD_LL`) dans son propre fil, qui regarde sans jamais avaler une
  touche et ignore les frappes simulées (`LLKHF_INJECTED`). Réglage `holdKey` :
  `rightCtrl` (défaut), `rightAlt`, `rightShift`, `ctrlWin` (Ctrl + Windows ;
  une touche fantôme 0xE8 empêche le menu Démarrer de s'ouvrir). Le crochet
  n'existe que module allumé (le fil « sync » le crée et le lâche).
- **La machine à états** (`dictation_logic.rs`, `KeyLogic`, testée) : appui →
  l'écoute commence tout de suite (pas de premier mot perdu) ; relâché après
  0,30 s → colle ; relâché avant → attend 0,40 s un second appui (mains
  libres jusqu'au prochain appui), sinon annule ; Échap ou une autre touche
  pendant l'appui (un raccourci) → annule. Une écoute dure 5 min au plus.
- **Les moteurs** (`Engine::pick`, réglage `engine`) : `auto` = Parakeet
  (`services::speech`, si `ready()`) sinon la dictée de Windows ; `windows`
  (`voice::dictate`, session continue), `offline` (`voice::dictate_offline`),
  `parakeet` (`voice::record` en mémoire → `resample_16k` →
  `speech::transcribe`), `api` (`voice::record` → `askclaude_voice::wav_16k`
  → `askclaude_voice::transcribe`, clé OpenAI puis Gemini lue par le module,
  qui a la permission `credentials`). Pour les moteurs de Windows, une
  seconde capture WASAPI partagée (`voice::monitor`, rien n'est gardé) sert
  seulement aux bulles.
- **Les bulles** : `bands::levels` — fenêtre de Hann, FFT 512 points, neuf
  bandes logarithmiques de 90 Hz à 7 kHz, en dB ramenés à 0..1 —, envoyées à
  la pilule (`pill-bands`) au plus ~30 fois par seconde. Sans spectre :
  `bands::from_level` à partir du niveau du micro.
- **Le texte** (`dictation_text.rs`, testé) : snippets à la voix (le nom d'un
  snippet du Presse-papiers, lu par `modules::invoke("clipboard", "list")`,
  mis de côté sous une marque ⟦n⟧), remplacements du dictionnaire, noms bien
  écrits (mots entiers, sans tenir compte des majuscules ni des séparateurs),
  puis, **si `cleanup` est allumé** (coupé par défaut) et que le style de
  l'appli n'est pas « Tel quel » : le texte (jamais l'audio) part vers l'IA
  choisie dans Parler à Ondine (`askclaude::model_from` lit son fournisseur
  et son modèle), 8 s au plus, sinon le texte tel quel. Une réponse
  invraisemblable (trop longue, marques perdues) est ignorée.
- **Le collage** (`platform/dictation.rs`) : attend que la touche soit
  relâchée, cherche un champ de texte (curseur de Windows via
  `GetGUIThreadInfo`, sinon UI Automation : zone de saisie, document
  modifiable, terminal ; fonctionnalité Cargo `Win32_UI_Accessibility`).
  Sûr qu'il n'y en a pas (bureau, Explorateur, bouton, fenêtre d'Ondine) :
  la dictée reste dans le presse-papiers et la pilule le dit. Sinon : le texte
  entre dans le presse-papiers par `copy_secret` (exclu de l'historique
  d'Ondine, de Win+V et du cloud), Ctrl+V simulé, puis l'ancien texte revient
  700 ms après si rien d'autre n'a été copié entre-temps. Raccourci
  `pasteHotkey` (Ctrl+Alt+Maj+V par défaut) : recolle la dernière dictée.
- **Ce qui est gardé** (`dictation_store.rs`, `%APPDATA%\Ondine\dictation.json`,
  écrit par fichier temporaire renommé ; un fichier illisible est mis de
  côté) : l'historique (`keepDays`, 30 jours par défaut, 0 = rien), les
  chiffres de chaque jour (mots, temps de parole, dictées, mains libres,
  applis), le dictionnaire, les styles par appli (programme au premier plan,
  `outlook`, `slack`…). Les statistiques (mots, temps gagné par rapport à 40
  mots/min, vitesse, jours d'affilée, mots par jour, applis) sont calculées
  sur le PC.
- **La pilule** (`pill.rs`, `pill.html`, `src/pill/`) : fenêtre transparente
  créée cachée au démarrage, toujours au-dessus, non activante, posée en bas
  au centre de la zone de travail de l'écran de la souris, ou debout sur le
  bord gauche / droit (`edge`). Clics traversants : la page envoie ses cases
  (`pill_hit`), un fil lit la souris (30 fois/s près d'elle, 8 loin, rien de
  plus qu'un sommeil quand elle est cachée). Elle ne peut appeler que
  `pill_state`, `pill_hit` et `pill_action` du module (`module_invoke`
  refuse le reste ; capacité `capabilities/pill.json`). États : repos (barre
  de verre ; cachée en présentation si `discreet`), survol (Dicter,
  Enregistrer un appel, Réglages), écoute (la goutte gomme « concentree »
  dessinée par le vrai moteur, montée seulement pendant l'écoute, un point
  rouge tant que le micro est ouvert, neuf bulles), mains libres (Annuler,
  Coller), appel (corail, chronomètre, Arrêter → `callnotes.stop` ; suit
  `callnotes.state {recording, startedAt}`), message (copié, rien entendu,
  Parakeet pas installé, pas de clé, erreur avec bouton vers les Paramètres
  Windows). Les phrases sont composées par le front (`pill-logic.ts`), donc
  traduites. Au repos : 0 % de CPU (pas de goutte, pas de boucle). Mouvements
  réduits ou Calme : rien ne rebondit, les bulles sautent à leur niveau.
- **Les pages Voix** (`src/settings/voice/`) : Dictée (bande « Bonjour
  <prénom> », interrupteur, historique avec recherche / copier / supprimer,
  tuiles, carte Notes d'appel, réglages du module), Statistiques, Dictionnaire
  (noms, remplacements, snippets à la voix), Styles (Tel quel / Naturel /
  Soigné par appli, remise au propre et ce qui part). Logique pure dans
  `dictation-format.ts`, testée.


## 1.2.4 : le micro choisi, le raccourci personnalisé, « Dis Ondine » (`platform/voice.rs`, `askclaude_voice.rs`, `askclaude_wake.rs`, `src/core/hotkey.ts`, `src/settings/hotkey-input.ts`, `mic-block.ts`, `mic-logic.ts`)

- **Le micro** : réglage `micDevice` de Parler à Ondine (vide = micro par
  défaut de Windows), dessiné par `mic-block.ts` (Réglages → Parler à Ondine →
  Voix et sons, bloc « Micro », visible aussi en mode Simple). Commande `mics` :
  `IMMDeviceEnumerator::EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)`, id
  et `PKEY_Device_FriendlyName`, celui par défaut (`eConsole`) et celui de
  communication (`eCommunications`). Le fil des raccourcis recopie le réglage
  chaque seconde dans `voice::set_mic` (même module coupé) ; toutes les
  captures WASAPI l'ouvrent (`open_stream` / `pick_device`) : Parler à Ondine
  en Parakeet et en API (`record_info`), bulles et Parakeet de la dictée
  (`monitor`, `record`), côté micro des notes d'appel (`capture`), mot
  d'appel (`watch`). Débranché : le micro par défaut, et une ligne au journal.
  La reconnaissance de Windows (WinRT) écoute toujours le micro par défaut :
  la page le dit (`micEngineWarning`) avec « Ouvrir les paramètres du son de
  Windows » (`Fix::Sound`, `ms-settings:sound`) et « Passer à Parakeet ». Le
  moteur hors ligne (SAPI) prend le micro choisi : son numéro waveIn
  (`waveInMessage(DRV_QUERYFUNCTIONINSTANCEID)` = l'id de l'appareil) passe à
  `ISpMMSysAudio::SetDeviceId`.
- **Formats** : le format de mixage est lu tel quel (`SampleKind` : virgule
  flottante 32 bits, entiers 8, 16, 24, 32 bits ; `mix_to_mono`, testé), puis
  ramené à 16 kHz avant Parakeet (`speech::to_16k_mono`).
- **Un micro muet est expliqué** (`silent_mic`, testé) : coupé ou volume à 0
  dans Windows (`IAudioEndpointVolume`), que des zéros (bloqué par la
  confidentialité, ou pas le bon micro), à peine un son. Parakeet / API : quand
  le seuil de silence n'a rien entendu ; Windows / hors ligne : quand rien
  n'est reconnu et que le niveau max (`IAudioMeterInformation`) est resté
  plat. L'île propose alors « 🎙️ Choisir le micro ». Seuil de parole abaissé à
  −44 dBFS ; avec Parakeet, une voix faible (crête ≥ 0,02) est écrite quand
  même. Le journal note le micro ouvert, son format, son volume, s'il est
  coupé, et le niveau max à la fermeture (jamais ce qui est dit).
- **Tester le micro** : commande `mic_test {device}` (4 s, compte comme une
  capture d'Ondine), événement Tauri `mic-test` : `{level}` ~15 fois par
  seconde, puis `{done, info, problem, fix}`. Rien n'est gardé.
- **Raccourci personnalisé** : type de champ `hotkey` des manifestes
  (`module-types.ts`, `coerce` → `coerceHotkey`, `form.ts` →
  `hotkeyInput`) : choix proposés + « Personnalisé… » (on clique, on appuie,
  Échap annule, « Effacer »). Forme `Shortcut` du greffon (« Ctrl+Alt+K »,
  modificateurs Ctrl, Alt, Shift, Super). Lettres et chiffres lus par
  `keyCode` (touche virtuelle de Windows : bon sur AZERTY). Règles
  identiques des deux côtés (`hotkeyProblem` / `check_hotkey`, testées) : un
  modificateur sauf F1–F24, pas Maj seule, pas F12 seule, pas Alt+F4,
  Ctrl+Alt+Suppr, Win+L…, ni Ctrl+C/V/X/Z/S…. Un refus du Rust (déjà pris)
  est gardé (`hotkey_errors`, commande `hotkeys`) et écrit sous le champ
  (`showHotkeyProblem`, après l'événement DOM `hotkey-saved`).
- **« Dis Ondine »** (`askclaude_wake.rs`, réglage `wakeWord`, COUPÉ par
  défaut, confirmation explicite dans les Réglages) : `voice::watch` garde le
  micro choisi ouvert (en mémoire), `Downsampler` → 16 kHz, `WakeGate` (trames
  de 30 ms, seuil d'énergie au-dessus du bruit de fond qui s'adapte, testé)
  découpe les passages parlés ; seulement alors Parakeet écrit les 2,4
  premières secondes, dans un autre fil (file de 2, le reste oublié) ;
  `wake_rest` (testé) reconnaît « dis / hey / hé / ok Ondine » (distance
  d'édition 1, « on dîne » collé) au début. Mot seul : `listen` (comme le
  raccourci) ; suivi d'une question : `heard_text` (événements `open` puis
  `final`). Pause (micro fermé) : réglage ou module coupé, hors Windows,
  Parakeet absent, Ondine écoute déjà (`voice::ondine_capturing`, compteur des
  captures), discrétion, PC verrouillé (`session::locked`), mode Économie
  d'énergie (`perf::mode`). L'état part sur le bus (`voice.wake {on,
  paused}`) : point rouge `wake` de l'île (nano-rules.ts, montré en premier,
  aussi sur l'île de taille normale en compact) ; commande `wake_state` pour
  les Réglages. Pas de VAD silero ni de keyword spotter de sherpa-onnx : il
  faudrait un modèle de plus à télécharger (et le spotter n'a pas de modèle
  français).

## 1.2.4 : limites du forfait, fichiers modifiés en direct, modèles locaux, vos propres sons

### Limites du forfait (`src-tauri/src/modules/agents_plan.rs`, `src/modules/agents/plan.ts`, `plan-view.ts`)

Onglet Agents IA, au-dessus du compteur de jetons : la fenêtre de 5 h et la
semaine de Claude et de Codex, en % utilisé, avec l'heure de remise à zéro.
Couleurs : normale, jaune dès 75 %, rouge dès 90 % (`planLevel`, testé).
Réglage `planLimits` (activé, groupe « Jetons et budget »).

- **Claude** : Claude Code donne `rate_limits.five_hour / seven_day`
  (`used_percentage`, `resets_at` en secondes) à sa **ligne d'état**, sur
  l'entrée standard (forfaits Pro et Max). « Brancher la ligne d'état »
  écrit `"statusLine": { "type": "command", "command": "\"C:/…/ondine.exe\" statusline" }`
  dans `~/.claude/settings.json` avec la même installation sûre que les
  hooks (lecture, fusion, copie `.bak`, jamais d'écrasement). Une ligne
  d'état déjà là est gardée dans `%APPDATA%\Ondine\statusline-previous.json`
  et relancée par `ondine.exe statusline` (son texte reste affiché) ;
  « Débrancher » la remet. `ondine.exe statusline` n'envoie à l'île que les
  chiffres (`source: "plan"`), par le canal nommé des agents ; rien n'est
  écrit sur le disque. État : installed / stale / other / absent / unreadable.
- **Codex** : les journaux `~/.codex/sessions/**/rollout-*.jsonl` (événement
  `token_count`, `rate_limits.primary / secondary`), lus sur le PC, le plus
  récent d'abord, avec un cache par taille et date. « Demander à Codex »
  (sur un clic) lance `codex app-server` (JSON-RPC
  `account/rateLimits/read`, 15 s au plus, puis arrêt de l'arbre) : c'est
  Codex qui contacte OpenAI, Ondine n'envoie rien.

### Fichiers modifiés en direct (`src-tauri/src/modules/agents_live.rs`, `src/modules/agents/live-logic.ts`, `live-view.ts`)

Sous chaque session du tableau « En cours », les fichiers que l'agent vient de
modifier, avec `+N −M` ; un clic ouvre le changement dans un panneau de
l'onglet, en lecture seule. Réglage `liveFiles` (activé, groupe
Notifications).

- Hooks : `PostToolUse` (matcher `Edit|MultiEdit|Write`) pour Claude Code,
  `AfterTool` (matcher `write_file|replace`) pour Gemini CLI, ajoutés aux
  configurations de l'installation automatique (il faut les réinstaller une
  fois). Codex : pas de hook d'écriture vérifié, rien d'ajouté.
- Le calcul se fait dans `ondine.exe notify` (lecture de 4 Mo au plus) :
  diff ligne à ligne (plus longue sous-suite commune, 3 lignes de contexte,
  « ⋯ » entre deux morceaux ; au-delà de 200 Ko, 4 000 lignes ou 1 M de
  cases : seulement les nombres). Claude donne `structuredPatch` : il est
  repris tel quel. Seul un message réduit (chemin, nombres, 300 lignes au
  plus, toujours sous les 64 Ko du canal) part vers l'île ; le contenu
  entier du fichier ne traverse jamais le canal.
- Dans l'île : `check_path` (dossiers exclus) avant de garder quoi que ce
  soit, puis encore avant de montrer le changement ; 20 messages par seconde
  au plus ; 24 fichiers en mémoire, rien sur le disque. Les fichiers d'une
  session sont oubliés à son message suivant (`working`) ou à sa fin.
- Animation : une petite gelée à l'arrivée d'une puce (seulement les
  nouvelles), coupée avec « Réduire les animations », Calme et le mode éco.

### Modèles locaux et OpenRouter (`src-tauri/src/modules/askclaude_compat.rs`, `src/settings/askclaude-models.ts`)

Deux fournisseurs de plus dans Parler à Ondine, en API « Chat Completions » :
`local` (Ollama, LM Studio, tout serveur compatible OpenAI, réglages
`localUrl` et `localModel`) et `openrouter` (`openrouterModel`, vide =
`openrouter/auto`).

- Adresse (`server_base`, testée) : http seulement pour localhost,
  127.0.0.1 ou [::1] ; https pour toute autre machine ; pas d'identifiant
  (@), de « ? », de « # », d'IPv6 autre que [::1], de « .. ». Aucune
  redirection suivie ; un serveur sur ce PC est joint sans proxy (300 s pour
  le premier chargement du modèle).
- Clés dans le Gestionnaire d'identifiants : `openrouter-api-key`, et
  `local-llm-api-key` (facultative ; un serveur local n'en demande pas).
- Réponses non diffusées en continu (le module ne diffuse pas) ; la
  réflexion du modèle (`<think>…</think>`, `reasoning_content`) est retirée
  et n'est jamais montrée ni renvoyée.
- Outils d'Ondine : proposés seulement si le modèle les gère. Si le serveur
  les refuse (`refuses_tools`), la même question repart sans eux et le
  modèle est retenu (`no_tools`) pour la suite ; la liste d'OpenRouter
  (`supported_parameters`) le dit aussi d'avance.
- « Lister les modèles du serveur » (Réglages → Parler à Ondine → Fournisseur
  et modèles) : `GET <adresse>/models`, sur un clic ; un clic sur un modèle le
  choisit.
- « Ce qui part » donne la vraie destination : `localhost:11434` et « Vos
  messages restent sur votre PC » pour un serveur local (`onThisPc`).
- La voix (transcription par l'API) reste à OpenAI ou Gemini, comme avec Claude.

### Vos propres sons (`src-tauri/src/services/custom_sounds.rs`, `src/island/custom-sounds.ts`, `src/settings/sounds-page.ts`)

Un fichier de `%APPDATA%\Ondine\sounds` nommé comme un son d'Ondine (`tap`,
`open`, `close`, `toggle`, `drop`, `boing`, `plop`, `jingle`, `jingle-down`,
`glitch`, `whoosh`, `chomp`, `pop`) en `.wav`, `.mp3`, `.ogg` ou `.m4a`
remplace ce son. Les noms sont les mêmes des deux côtés (test front).

- Le Rust (`resolve`, testé) choisit d'après le nom et la taille : 2 Mo au
  plus, non vide, un seul fichier par son (ordre .wav, .mp3, .ogg, .m4a). Il
  vérifie l'en-tête (`looks_like` : RIFF/WAVE, ID3 ou trame MP3, OggS, ftyp)
  et renvoie les octets en base64 (commande `sounds_custom`). Un fichier
  ignoré : le son d'origine reste, une ligne au journal.
- L'île décode avec Web Audio (`decodeAudioData`) ; un fichier illisible est
  ignoré de même. `sounds.ts` joue votre fichier (4 s au plus, au volume des
  sons) à la place du son fabriqué. Les sons de l'éclosion ne sont pas
  remplaçables.
- Réglages → Apparence → Sons : « Ouvrir le dossier des sons »
  (`sounds_open_folder`, crée le dossier s'il manque), « Recharger les sons »
  (ici, et dans l'île par l'événement `sounds.reload`), les noms possibles.

## 1.2.4 : nouveautés tirées des projets similaires

### Le Presse-papiers ignore les clés et jetons (`clipboard_secrets.rs`)

Idée reprise de winbar (laurennguyen1304, MIT), motifs et code réécrits (crédit
dans THIRD-PARTY.md). Réglage `ignoreSecrets` du module Presse-papiers
(« Ignorer les clés et jetons », activé par défaut ; activé aussi si le réglage
est illisible).

- **Où** : au même endroit que le filtre « sensible », dans la boucle `watch`
  de `clipboard.rs`, juste après la lecture du texte et AVANT « liens propres »
  (un `https://u:mdp@hôte` ne doit pas devenir « le lien d'origine » gardé pour
  « Remettre »). L'historique vit en Rust : une copie ignorée n'entre jamais
  dans `Store.clips`, donc ni dans la liste, ni dans `search` (Lanceur).
- **Reconnaissance** (`clipboard_secrets::detect`, pure, sans le crate
  `regex`) : une petite fonction par famille (préfixe, longueur minimale,
  alphabet, parfois un mélange chiffres / minuscules / majuscules pour les
  préfixes courts). Anthropic `sk-ant-` (≥ 32), OpenAI `sk-proj-` /
  `sk-svcacct-` / `sk-admin-` (≥ 32) ou `sk-` (≥ 32, mélangé), GitHub `ghp_`
  `gho_` `ghu_` `ghs_` `ghr_` (36) et `github_pat_` (≥ 40), GitLab `glpat-`
  (≥ 20), AWS `AKIA`/`ASIA` + 16 majuscules/chiffres (avec un chiffre), Google
  `AIza` + 35, Slack `xox[abprs]-` (≥ 20, avec un chiffre), Stripe `sk_live_` /
  `rk_live_` (≥ 24), npm `npm_` + 36, Hugging Face `hf_` (≥ 30, majuscules et
  minuscules), JWT signé (`eyJ….eyJ….sig`, trois parties ≥ 16 en Base64 URL),
  adresse `schéma://utilisateur:motdepasse@hôte` (sauf mots de passe
  d'exemple : `password`, `${…}`, `***`…).
- **Contre les faux positifs** : seule la copie ENTIÈRE compte, une fois
  retirés les emballages courants (espaces, `export `, `NOM=`, `NOM: `,
  `"nom": "…",`, `Bearer `, guillemets). S'il reste une espace ou un saut de
  ligne, c'est du texte : on garde. Exception : un bloc
  `-----BEGIN … PRIVATE KEY-----` suivi d'au moins 64 caractères Base64, où
  qu'il soit (un en-tête cité seul ou un certificat public ne comptent pas).
  Tests : vrais positifs par famille et emballage, faux positifs (phrases,
  liens, `ssh://git@…`, hash git, UUID, `sha256:…`, data URL d'image, Base64
  de texte, `sk-learn…`, `hf_hub_download`, `sk_test_`…). Les fausses clés des
  tests sont fabriquées morceau par morceau (aucune en entier dans le code).
- **Quand une copie est ignorée** : `Store.ignored` ne retient que la famille
  et le numéro de copie Windows (jamais le texte) ; le journal dit seulement
  « copie ressemblant à une clé, ignorée » (debug, sans la famille) ; le bus
  reçoit `clipboard.secret-ignored {kind, decodable}` → notification basse
  « Clé ignorée ». `list` ajoute `ignored {kind, decodable}` tant que le
  numéro de copie n'a pas changé : l'onglet montre une ligne discrète
  « 🔒 Clé ignorée · Jeton GitHub ». Une nouvelle copie ordinaire l'efface.
- **Décoder la copie en cours** : pour un JWT (`decodable`), la ligne propose
  « Décoder » ; le front appelle `current`, qui relit le presse-papiers
  seulement si la copie ignorée y est encore (même numéro, pas sensible, même
  famille reconnue), et `decode.ts` l'affiche. Rien n'est gardé.
- **Ailleurs** : Équipe (`team_net::sync_clipboard`) n'envoie pas une clé à
  mes autres PC (même réglage, via `clipboard::secret_to_skip`) ; les halos
  « Copié » n'affichent jamais le début d'une clé (toujours, réglage ou non).
  Non touché : les règles « quand je copie… » (rien n'y est gardé) et les
  actions explicites (« Coller une image », QR d'Équipe).
- Mode démo : `clipboard.secret-ignored` est dans `REAL_DATA` (src/core/demo.ts).

### Agents IA : la liste de tâches en barre, et la discrétion devant le terminal (`src-tauri/src/modules/agents_todos.rs`, `agents_discreet.rs`, `src/modules/agents/todos-logic.ts`)

Deux idées de CodeIsland (wxtsky, MIT, macOS), réécrites (THIRD-PARTY.md).

**La liste de tâches de l'agent** (réglage `taskProgress`, activé, groupe
Notifications) : sous la session du tableau « En cours », une barre fine
« 3/7 » et la tâche en cours (sa forme « en train de », `activeForm`).

- Même chemin que les fichiers en direct : hook `PostToolUse` → `ondine.exe
  notify` (`cli.rs`) → `agents_todos::compact` (essayé avant
  `agents_live::compact`) → le canal → `route` (`msg.todos`) → `todos_note`.
- Formes comprises (`update_of`, tout JSON inattendu ignoré sans bruit) :
  - liste entière (`{mode: "replace"}`) : Claude Code `TodoWrite`
    (`todos [{content, status, activeForm}]`), Codex `update_plan`
    (`plan [{step, status}]`, paramètres éventuellement en texte JSON),
    Gemini CLI `write_todos` (`todos [{description, status}]`), et la
    réponse de `TaskList` (`tasks [{id, subject, status}]`) ;
  - par numéro (`{mode: "patch"}`) : `TaskCreate` (`subject`, `activeForm` ;
    le numéro est lu dans la réponse : `task.id`, `id`, `taskId` ou « #3 »
    dans un texte ; sinon le suivant), `TaskUpdate` (`taskId`, `status`,
    `subject`, `activeForm` ; `deleted` = retirée). Une mise à jour d'un
    numéro inconnu sans texte est ignorée.
  - États ramenés à `pending` / `in_progress` / `completed` ; `cancelled`
    et `deleted` ne comptent pas.
- Envoyé : la session et les tâches seulement (pas le reste du hook),
  50 tâches au plus, chaque texte sur une ligne, coupé à 120 caractères.
- Dans l'île (`todos::Store`) : 30 listes au plus, 20 mises à jour par
  seconde au plus, en mémoire seulement, jamais journalisé. Oubliée à
  `SessionEnd`, ou quand la session quitte le tableau (2 h ; une liste
  arrivée avant tout autre hook de sa session est gardée 2 h). Gardée
  d'un message à l'autre (contrairement aux fichiers en direct).
- `history` ajoute `todos {done, total, current?}` à chaque session ; le
  sujet `agents.todos {session, done?, total?, current?}` redessine
  l'onglet (une fois par rafale) et allume, dans le module Animations
  (case « Agents IA »), un liseré `progress` figé (`id: agent-todos`,
  palette `work`, `todoFill`) : la part faite, éteint quand tout est fait,
  à « a fini » et à `claude.done`.
- Hooks : le matcher `PostToolUse` de Claude Code devient
  `Edit|MultiEdit|Write|TodoWrite|TaskCreate|TaskUpdate|TaskList` ;
  Gemini `AfterTool` : `write_file|replace|write_todos` ; Codex : un
  nouveau bloc `[[hooks.PostToolUse]] matcher = "update_plan"` (la
  documentation des hooks de Codex range `update_plan` parmi les « local
  function tools » vus par PostToolUse ; non essayé sous Windows). Même
  installation sûre (fusion, `.bak`, TOML relu et comparé). `hook_status`
  rend aussi `incomplete` (`agents_hooks::incomplete` : des hooks d'Ondine
  sont là, mais un événement ou un matcher d'aujourd'hui manque) :
  « ✅ Installé, sans les dernières nouveautés (liste de tâches) :
  réinstallez pour les ajouter ». Codex demande d'approuver le nouveau
  hook une fois dans `/hooks`.

**Rester discrète quand vous regardez déjà le terminal** (réglage
`quietWhenWatching`, activé, groupe Notifications) :

- À « vous attend » ou « a fini » (`discreet::stay_discreet` : réglage +
  genre, la recherche n'est faite qu'alors), `watching_session` compare la
  fenêtre au premier plan (`platform::foreground_window`, sa fenêtre du
  haut) à celle de la session, cherchée comme « Y aller »
  (`platform::agent_windows` : la console du hook, sinon
  `pick_agent_window` ; la recherche est partagée avec
  `focus_agent_window`, une seule liste des fenêtres pour toutes les
  sessions). Si c'est elle, et qu'aucune AUTRE session du tableau n'a la
  même fenêtre (`discreet::watching` : deux onglets de Windows Terminal
  ont la même fenêtre, on ne sait pas lequel est affiché), alors pas
  d'`agents.event` (donc ni notification, ni son, ni halo d'appel, ni
  scène) ni de `task.finished` (fête). Le tableau est mis à jour
  (`agents.changed`), l'historique aussi, le bilan git est calculé pour
  l'historique sans notification (`report_then_show(…, show: false)`).
- Les rappels de 10 / 30 min (`agents_wait.rs`, inchangé) suivent l'état
  de la session : si vous quittez la fenêtre, ils arrivent comme avant
  (et aussi si elle est encore devant : la discrétion ne vise que le
  passage à « vous attend » / « a fini »).
- Hors Windows : `foreground_window` rend 0, jamais discrète.

### Notifications de Windows (`src-tauri/src/modules/winnotifs.rs`, `src-tauri/src/platform/winnotifs.rs`, `src/modules/winnotifs/`, `src/settings/winnotifs-group.ts`)

Les notifications des autres applis (celles du Centre de notifications)
s'affichent aussi dans l'île. Module à petit onglet (🔔, catégorie « Le PC au
quotidien »), **désactivé par défaut** (`MODULES_OFF_BY_DEFAULT`, Rust et
front) : il lit le contenu des notifications des autres applis.

- **Sans paquet du Store.** `Windows.UI.Notifications.Management.UserNotificationListener`
  marche pour une appli ordinaire une fois que Windows l'autorise (Paramètres →
  Confidentialité → Notifications). Technique reprise de windows-dynamic-island
  et de PILLAR (MIT, THIRD-PARTY.md), réécrite. L'événement
  `NotificationChanged` demande une identité de paquet (erreur 0x80070490 chez
  ces projets) : la liste est donc **relue** (`GetNotificationsAsync(Toast)`).
- **Le thread** (`run`) : module coupé → il dort 3 s et oublie tout ; lecteur
  absent (Windows 10 d'avant 1607) → état `unavailable`, nouvel essai toutes les
  5 min ; accès demandé une fois par activation (`RequestAccessAsync` sur le fil
  de fond ; si Windows refuse de répondre hors du fil de l'interface, la demande
  est relancée par `run_on_main_thread` et attendue sur le fil de fond) ; refusé
  → état `denied`, `GetAccessStatus` toutes les 10 s pour repartir dès que la
  case est cochée ; autorisé → relecture au rythme `perf::Loop::WinNotifs`
  (1 000 / 1 500 / 4 000 ms en haute / équilibrée / éco). « Vérifier de
  nouveau » (commande `recheck`) réveille le fil et redemande l'accès.
- **Les nouvelles** (`fresh_ids`, testé) : le premier tour (démarrage,
  réactivation, accès accordé) note tout comme vu ; ensuite, un id jamais vu =
  nouvelle ; un id disparu est oublié. Au plus 5 d'un coup (sortie de veille).
  Pour chacune : appli (nom affiché, AUMID), lignes de texte du modèle
  ToastGeneric (`extract` : 1re ligne = titre, 4 lignes de corps au plus,
  120 / 400 caractères), filtres (`app_allowed` : « Applis à ignorer »,
  « Seulement ces applis », noms séparés par des virgules, comparés au nom et
  à l'AUMID en minuscules), logo (`AppInfo.DisplayInfo.GetLogo` 32 × 32, 48 Ko
  au plus, data URL gardée en mémoire, 64 applis au plus).
- **Bus** : `winnotifs.new` `{id, app, key, icon, title, body}` (`key` = FNV-1a
  de l'appli, jamais l'AUMID ; `body` vide si « Montrer le texte du message »
  est décoché) et `winnotifs.status` `{state, remove}` (`state` : off,
  starting, allowed, denied, unavailable, error ; `remove` : unknown, ok,
  refused). Commandes : `status`, `recheck`, `open_settings`
  (`ms-settings:privacy-notifications`), `icon {key}`, `open_app {key}`
  (`shell:AppsFolder\AUMID`, AUMID vérifié par `aumid_ok`), `remove {id}`.
- **Dans l'île** : `api.notify` priorité `normal`, titre « Appli · Titre »,
  icône `app:<key>` (logo enregistré par `setAppIcon` de `icon.ts`, sinon 🔔),
  bouton « Ouvrir » (l'appli). La file habituelle s'applique : concentration
  (Pomodoro), mode présentation, Calme des Règles. Windows refuse : une
  notification une fois par démarrage du module, avec « Ouvrir les réglages de
  Windows ».
- **L'onglet** : l'état de l'accès (et les boutons quand Windows refuse), les
  20 dernières (réglage `history`, oui par défaut), « Effacer la liste ». Tout
  en mémoire du front : effacé quand le module s'arrête ou que le réglage est
  décoché. Réglages → Notifications de Windows : un bloc « Accès de Windows »
  (état, « Ouvrir les réglages de Windows », « Vérifier de nouveau »).
- **Retirer du Centre de notifications** (`removeFromCenter`, non par défaut) :
  à la fermeture de la notification de l'île (`onDismiss` : temps écoulé, ×,
  « Ouvrir »), `remove {id}` appelle `RemoveNotification`. Rien ne garantit
  que Windows l'accepte sans paquet : une erreur, ou la même notification
  encore là 0,8 s plus tard à la lecture suivante = `remove: "refused"`, le
  module n'essaie plus jusqu'au redémarrage et l'onglet comme la page des
  réglages le disent.
- **Confidentialité** : contenus en mémoire seulement (bus, onglet) ; le
  journal ne reçoit que les changements d'état et les erreurs de Windows
  (jamais un titre ni un texte ; le bus ne journalise que le sujet). Les
  textes des notifications sont marqués `data-no-i18n` dans l'onglet.
- **Limites** : Windows montre toujours sa propre bulle en même temps (la
  cacher demanderait de toucher aux réglages de notification des autres
  applis) ; « Ne pas déranger » de Windows n'est pas lu (les notifications
  vont quand même au Centre, donc dans l'île).

### Le trou noir (`src-tauri/src/modules/windowlife_hole.rs`, `windowlife.rs`, `platform/winlife.rs`, `src/modules/windowlife/`, `src/styles/windowlife.css`)

Idée et technique de windows-dynamic-island (Nazim Ferragh, MIT), réécrites
(THIRD-PARTY.md). Réglage `swallow` du module Ondine et les fenêtres
(« Avaler une fenêtre lâchée sur l'île », essentiel, **coupé par défaut** :
l'île est en haut au centre, là où l'on lance une fenêtre pour l'agrandir ;
une fenêtre qui disparaît surprend). `lockGoodbye` n'est plus essentiel
(3 au plus par module, test de visibility).

- **Le glisser** : réglage allumé, `winlife::watch_drags` ouvre un fil avec
  sa boucle de messages et `SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART…END,
  WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS)` : deux événements par
  déplacement, aucun crochet souris, rien d'injecté. Au début : la fenêtre
  principale (`GA_ROOT`), sa place (`GetWindowPlacement` : place normale +
  agrandie) et sa taille ; à la fin : la souris (`GetCursorPos`). Réglage
  coupé : le `DragWatch` est lâché (WM_QUIT, `UnhookWinEvent`).
- **Pendant** (fil du module, 30 tours/s seulement pendant un déplacement) :
  `DragTrack::step` (pur, testé) ; la souris sur l'île =
  `island::screen_point_on_island` (px physiques, forme de l'île avec une
  marge, bande de réveil avec 40 px ; tous les bords, toutes les échelles).
  Armée après 0,3 s au-dessus (`ARM_SECS`, contre le geste « agrandir » de
  Windows) ; une taille qui change = redimensionnement, jamais avalée.
  Armée ou non → `windowlife.hole-hover {over}` : island.ts montre l'île si
  elle était cachée (`fsm.pointerEnter`), classe `hole-over` (assombrie,
  halo violet : filtre + ombre, la gelée garde la forme) ; le front fait
  `surprised` (bouche ouverte). Lâchée armée sur l'île → `hole::swallow`
  dans un fil à part.
- **Le tri** (`may_swallow`, testé) : refusées les fenêtres d'Ondine, cachées
  ou « cloaked », non principales (enfant, outil, avec propriétaire = boîte
  de dialogue), de Windows (`SHELL_CLASSES` : bureau Progman / WorkerW, barres
  des tâches, Démarrer, vue des tâches, menus, et les applis du Store
  `ApplicationFrameWindow`), plein écran, qui ne répondent pas
  (`IsHungAppWindow`), sans titre, et d'un programme administrateur quand
  Ondine ne l'est pas (`TokenElevation` du programme ; illisible = refusée).
  Une fenêtre refusée ne donne aucun retour visuel.
- **Avaler** : notée dans la liste (`static HOLE`, 24 au plus) et dans
  `%APPDATA%\Ondine\trou-noir.json` (hwnd, pid, classe, titre, place ;
  écrit par fichier temporaire + renommage, supprimé quand la liste est
  vide) AVANT d'être cachée par `ShowWindowAsync(SW_HIDE)` (jamais bloqué par
  un programme occupé), et rien d'autre. Toujours visible 600 ms plus tard :
  réaffichée (`SW_SHOWNA`), retirée, `windowlife.swallowed {ok:false,
  reason}` (bulle). Sinon `{ok:true}` : `eating`, île `hole-gulp`. L'icône
  (WM_GETICON 150 ms au plus, sinon celle de la classe ; 32 × 32, masque pour
  les vieilles icônes) reste en mémoire, PNG en data URL.
- **Recracher** (`spit`, un clic) : place d'avant remise pendant qu'elle est
  encore cachée (`SetWindowPlacement` avec `SW_HIDE`, sauf programme qui ne
  répond pas), puis `SW_SHOW` / `SW_SHOWMAXIMIZED`, `BringWindowToTop`,
  `SetForegroundWindow`, `forget_previous_foreground`. `windowlife.spat` :
  `push`, île `hole-spit`. Pas encore réaffichée au bout de 600 ms : gardée
  dans la liste (le tri la retirera).
- **Tout recracher** (`release_all`, sans voler le focus) : commande
  `spit_all` (bouton de la mini-île, action de la carte), entrée « Tout
  recracher (n) » du menu de l'icône (tray.rs, seulement s'il y en a,
  `sync_hole`), réglage ou module coupé (fil du module), `RunEvent::Exit`
  (lib.rs : `.build().run(…)`), juste avant l'installateur d'une mise à jour
  et avant `app.restart()` (update.rs), panique du fil principal (crochet de
  panique). Au démarrage (`start`, même module coupé) : `recover_at_start`
  relit le fichier et réaffiche celles qui existent encore, au même
  programme, toujours cachées (`to_recover`, testé), puis l'efface.
- **Le tri de chaque seconde** (`Hole::sweep`) : une fenêtre fermée (ou dont
  le numéro est passé à un autre programme), ou réaffichée par son propre
  programme, sort de la liste. `windowlife.hole {count}` à chaque changement :
  le front relit `hole_list` (le bus est limité à 64 Ko : les icônes passent
  par la commande).
- **Le front** : vue compacte (`views: ["compact"]`, pas d'onglet ;
  `compactWhen` = liste non vide, après Musique et Notes d'appel dans
  `ALL_MODULES`) : 🕳️, la pastille violette avec le nombre, 5 icônes au plus
  (un clic recrache, titre en infobulle, `data-no-i18n`), « Tout recracher ».
  Carte de l'Accueil « Trou noir » (`expandable: false`) : le nombre, les
  titres, « Recracher la dernière », « Tout recracher », un morceau de phrase
  (`hole-logic.ts`, testé). Réactions de la mascotte jamais en mode Calme.
- **Confidentialité** : rien ne sort du PC ; le journal ne note que des
  nombres et des raisons, jamais un titre ; le titre n'est écrit sur le
  disque que dans le fichier de secours, le temps que la fenêtre est avalée.
- **Pas fait** : point dans la forme nano (la vue compacte n'apparaît qu'en
  mini-île), raccourci clavier global (le menu de l'icône en tient lieu),
  bureaux virtuels (une fenêtre avalée sur un bureau ressort sur le bureau
  courant), aperçu de la fenêtre (le projet d'origine prend une capture).

### Agents IA : la rangée de pilules (`src/modules/agents/pills-logic.ts`, `pills-view.ts`, `setup-view.ts`, `index.ts`)

L'onglet était une longue colonne (lanceur, questions, état, concentration,
tableau, forfait, jetons, GitHub, messages, guide d'installation). Il devient
une rangée de pilules et UNE carte, façon coucou (MIT, idée réécrite : voir
THIRD-PARTY.md). Aucune commande Rust nouvelle : tout passe par `history`,
`hook_status`, `hook_install`, `projects`, `plan`… comme avant.

- **Pilules** (`buildPills`) : une par agent, par son identifiant de
  lancement (`claude`, `codex`…, `tools.ts` ; une source de hooks
  `claude-code` → `claude` par `pillOfSource`). Toujours Claude Code, Codex
  et Gemini CLI (sauf décochés dans « Proposer … » et sans session ni
  hooks), puis les outils ajoutés avec « + », ceux dont les hooks sont déjà
  écrits, ceux qui ont une session. Ordre : attend, puis travaille, puis les
  autres (tri stable). Chaque pilule : l'icône maison de l'agent
  (`agentIcon`), son nom, sa couleur (`AGENT_COLORS`, variable CSS
  `--agent`), un badge rond « ! » (attend : une session `waiting` ou une
  question rattachée par `askPill`), « ✓ » (a fini et plus rien ne
  travaille), « ✕ » (hooks sur un ancien chemin ou fichier illisible), et le
  nombre de sessions en cours s'il y en a plusieurs. Boutons, `aria-pressed`
  sur celle au premier plan, flèches gauche / droite / Début / Fin
  (`arrowKeys`).
- **Branché** (`plugState`) : `ready`, `update` (installé sans la liste de
  tâches, ou sans le hook d'autorisation alors que le réglage
  `permissions` est activé, Claude Code et Codex seulement), `stale`, `off`,
  `broken`, `none` (outil sans hooks), `unknown` (état pas lu). `needsSetup`
  vaut pour `update`, `stale`, `off`, `broken`.
- **Carte** (`cardFor`) : une petite pilule de droite ouverte → sa carte ;
  aucun agent choisi → accueil (« Choisissez un agent… », et les questions
  en attente, jamais cachées) ; « Configurer » → carte « Brancher » ; pas
  branché et pas de « Plus tard » → carte « Brancher » ; sinon la carte de
  l'agent. La pilule au premier plan (`defaultPill`) : le choix retenu,
  sinon une qui attend ou travaille, sinon un agent branché, sinon aucune.
- **Carte « Brancher »** (`setup-view.ts`) : une phrase, « Brancher
  <agent> » (confirmation sur place, puis `hook_install` : fusion, copie
  `.bak`, inchangé), « Plus tard ». Repliés dans « Options avancées » :
  l'état et le fichier, la copie de sécurité, Copier la configuration /
  la config MCP / le hook d'autorisation, Retirer, Essayer, la ligne
  `ondine.exe notify` ; pour un outil sans hooks, la ligne « autre outil » ;
  « Retirer de la rangée » pour un outil ajouté. Les explications sont dans
  les bulles (`title`). Une fois branché, la carte laisse place à celle de
  l'agent ; « Configurer » (lien de sa carte) la rouvre.
- **Carte de l'agent** : ses questions (Autoriser… avec confirmation,
  Refuser, Au terminal ; la ligne est gardée d'un dessin à l'autre pour que
  « Vraiment autoriser ? » ne se referme pas), ses sessions (projet, état,
  « ↗ Y aller », « ↻ Reprendre » si la session est finie, « VS Code » si le
  projet est connu, la barre « 3/7 », la dernière phrase, les fichiers en
  direct), « Lancer » réduit à une ligne (liste des projets, « Dossier
  utilisateur » sans projet, « Autre dossier… », « Reprendre » avec la
  dernière phrase), ses derniers messages (3, puis « Afficher N de plus »).
  La liste d'un bilan (`report-view.ts`) et le changement d'un fichier
  (`live-view.ts`) s'affichent au-dessus de la carte.
- **Petites pilules de droite** : forfait de Claude (« 5 h · 42 % », sinon
  « Sem. · … », « Forfait » sans chiffres ; `planPill`, couleur jaune / rouge
  aux mêmes seuils que les jauges) et de Codex (seulement avec des
  chiffres), « Jetons » (réglage `usage`), « GitHub » (seulement avec un
  identifiant), la concentration (icône 🎧, l'heure de fin quand elle est en
  cours). Un clic ouvre leur carte à la place de celle de l'agent, avec
  « ‹ » pour revenir ; le compteur de jetons n'est relu que sa carte
  ouverte (l'alerte de budget garde sa relecture de fond).
- **Redessin** : la rangée et la carte ne sont reconstruites que si ce
  qu'elles montrent change (clé JSON), pour garder le focus clavier, une
  liste déroulante ouverte, une confirmation en cours ; un fondu de 200 ms
  quand on change de carte, coupé par « Réduire les animations » et le
  mode éco (`extras.css`).
- **Mémoire locale** (navigateur de l'île, `localStorage`, rien
  d'important) : `agents.pill` (la pilule choisie), `agents.pills-added`,
  `agents.pills-later` (listes d'identifiants relues par `parseIds`).
- **Mini-île** : la pastille d'une notification d'agent prend sa couleur
  (`extras.css`, `.notif-icon:has([data-icon="logo:…"])` : le logo au
  trait en est rempli, le logo en couleur a un halo).
- Mode démo : `agents.plan` et `agents.live` ont maintenant une réponse
  inventée (`demo.ts`).
- Tests : `tests/front/agents-pills.test.ts`.
## Mini-jeux (1.2.4, `src/modules/games/`, `src-tauri/src/modules/games.rs`, `src/styles/games.css`)
Le module « Jeux » (🎮, catégorie « Au quotidien ») : un onglet à quatre
pastilles (`TabPill`, comme le Minuteur). Toutes les parties vivent dans un
objet `Live` créé au démarrage du module : fermer l'onglet ne perd rien.
- **Lancer.** L'onglet ; le Lanceur (« jouer », « puissance 4 », « morpion »,
  « aquarium », « course » → `games.play {game}`) ; un **appui long sur
  Ondine** (550 ms sans bouger, `island.ts` `wireCarry` → `mascot.long-press` ;
  le geste n'était pris par rien, le clic qui suit est mangé) → morpion express.
- **Le kit commun (`kit.ts`).** `Quiet` : pause et silence pendant un appel
  (`controls.media-use` avec le micro pris, `callnotes.state` qui enregistre)
  et pendant une présentation ou une appli en plein écran (la classe
  `presenting` posée par `island.ts`, observée par un `MutationObserver`).
  `Kit.emote` / `lookAt` passent par `mascot.emote` / `mascot.look-at`, se
  taisent pendant une pause et, en mode Calme, ne gardent que l'essentiel.
  Les sons sont ceux de l'île (réglage « Sons des jeux »).
- **Puissance 4 (`connect4-logic.ts`, `connect4-view.ts`, `jelly-drop.ts`).**
  Plateau 7 × 6 en tableau plat (lignes de bas en haut) + hauteurs. IA :
  négamax alpha-bêta, ordre des coups depuis le centre, approfondissement
  itératif avec un **budget de nœuds** (exception `OutOfBudget` : on garde la
  dernière profondeur finie). Évaluation : les 69 fenêtres de 4 + la colonne
  du milieu. Niveaux : Facile (profondeur 1, 34 % de coups au hasard, sauf
  quand elle peut gagner tout de suite ; elle oublie parfois de bloquer),
  Normal (4, 8 %, gagne et bloque toujours ce qui est immédiat), Malin (jusqu'à 12, 150 000
  nœuds, quelques dizaines de ms). Ondine « réfléchit » (`pensive`), regarde
  deux colonnes puis la sienne (`mascot.look-at` sur la colonne), lâche une
  goutte en gelée (gravité + rebond + écrasement au ressort), boude si vous
  gagnez, fête si elle gagne, `mischief` quand elle prépare un coup gagnant.
  Clavier : ← → Entrée, 1 à 7.
- **Morpion (`ttt-logic.ts`, `ttt-view.ts`).** Minimax complet (9 cases).
  Malin ne perd jamais (testé sur toutes les parties) ; Facile (45 %) et
  Normal (20 %) jouent parfois au hasard, mais prennent toujours un coup
  gagnant. **Express** : une alerte de l'île (`notify` haute, `sticky`, clé
  `games-ttt`) dont le `content` est la grille ; `games.css` agrandit l'alerte
  (`:has(.ttt-mini)`). Fermée après 30 s sans jouer, 2,8 s après la fin
  (remplacée par une petite notification du résultat), ou à un appel.
- **Aquarium (`aquarium-logic.ts`, `aquarium-view.ts`, `aquarium.json`).**
  Le catalogue et les gains sont dans `aquarium.json`, lu par le front et par
  le Rust (`include_str!`). Gains : tâche finie d'un agent (`agents.event`
  done) 5, pause faite (`pauses.taken`, au plus une toutes les 20 min) 3,
  Pomodoro fini (`timer.work-session` completed) 4, parties (selon le niveau),
  course gagnée 8 ; **150 gouttes par jour au plus**. Dépenses : 9 décors,
  12 accessoires de la famille gomme (chapeaux, lunettes, cou). L'aquarium
  grandit par paliers (gouttes gagnées en tout). Dessin : un canvas (eau,
  sable, décors, poissons, bulles) + l'Ondine gomme (`GumEngine`, tenue de
  l'aquarium) ; Réduire les animations : une image fixe ; Calme : plus lent ;
  Économie : moins de bulles ; le flou seulement en Studio. « Porter dans
  l'île » copie la tenue dans `mascot.wearHead/Eyes/Neck`. Pas de notification
  quand on gagne des gouttes.
- **Stockage.** `games.rs` : `%APPDATA%\Ondine\games.json` (gouttes, gains
  du jour, objets, tenue, victoires/défaites ; écrit en .tmp puis renommé ;
  un fichier abîmé est mis de côté). Commandes `state`, `result`, `buy`,
  `wear` ; chaque changement publie `games.changed`. Les gains venus du bus
  sont comptés côté Rust (même onglet fermé) ; rien n'est compté en mode
  démo. En mode démo et dans le navigateur, `AquaStore` garde tout en mémoire
  (mêmes règles, `aquarium-logic.ts`) avec un aquarium déjà garni.
- **Course (`race-logic.ts`, `race-view.ts`).** `agents.todos {session, done,
  total}` : une liste d'au moins 3 tâches dont 2 à faire lance une course de
  4 gouttes ; chaque tâche finie fait avancer chaque goutte d'un pas au hasard
  (plafonné avant l'arrivée) ; la liste finie ou l'agent « done » : l'arrivée.
  Pari sur une couleur jusqu'à mi-course ; gagnante 8 gouttes, 2e 2 gouttes.
  Une session effacée avant la fin annule la course. En mode démo, une fausse
  liste de 6 tâches avance toute seule.
- **Réglages** (6) : un interrupteur par jeu, le niveau d'Ondine, les sons.
- **Tests** : `tests/front/games.test.ts` (IA, règles, gains), `games.rs`
  (gains, plafond, achats, fichier), `games_manifest_is_valid`.
- **Limites.** Une tâche d'agent n'est comptée que si `agents.event` done est
  publié (pas en mode discret ni si « Prévenir quand c'est fini » est coupé).
  La pause pendant une présentation suit le réglage « presentationQuiet ».
## Conversion de fichiers (Ondine convertit)
1.2.4. Un fichier glissé sur l'île : elle s'ouvre et montre tout en pilules
(« dépôt unifié », version A de la maquette : tout dans l'île) ; lâché sur un
format, Ondine l'avale, mâche, recrache le nouveau fichier. Idées reprises de Filee (MIT, voir THIRD-PARTY.md), réécrites.
- **Qui fait quoi** :
  - `src/island/drop-panel.ts` : le contenu de l'île en mode dépôt
    (en-tête, trois lignes de pilules, phrase), le survol et le choix au
    lâcher (`DropChoice` : un format ou une cible) ;
  - `src/island/drop-pills-logic.ts` (pur, testé) : les pilules connues
    (ligne, libellé, icône), la disposition (ordre, masquées), la reprise des
    anciens interrupteurs, l'en-tête (`headerFor`) et les phrases ;
  - `src/settings/drop-pills-group.ts` : Réglages → Étagère → « Pilules du
    dépôt » ;
  - `src/island/convert-gesture.ts` : le travail, une fois le format choisi
    (avaler, mâcher, liquide, pilules de progression et de résultat) ;
  - `src/island/convert-plan.ts` : son minutage et ses poses, en fonctions
    pures testées (`pillDelay`, `workY`, `resultWidth`, `Dwell`,
    `swallowPose`, `arcPose`, `expressionAt`, `liquidLevel`) ;
  - `src/modules/convert/` : le module (manifeste, vue compacte « Je mâche…
    42 % », appels au Rust), et `convert-logic.ts` (pur, testé : pilules
    proposées, libellés, tailles, résumé du résultat) ;
  - `src-tauri/src/modules/convert.rs` : le travail ; `convert_logic.rs`
    (pur, testé) : formats, noms libres, PDF, extraction de ZIP ;
  - `src-tauri/src/platform/convert.rs` : ce que Windows sait déjà faire
    (WIC, `Windows.Data.Pdf`, `MediaTranscoder`, sélection dans
    l'Explorateur). Sous les autres systèmes, « disponible seulement sous
    Windows ».
- **Le glisser** : la cible de dépôt de l'île (`platform/drop_target.rs`)
  envoie maintenant `shift` (touche Maj, `MK_SHIFT`) avec `file-drag`. Dans
  un navigateur (npm run dev, démo), `bridge.ts` traduit le glisser-déposer
  HTML5 en ces mêmes événements (noms de fichiers, pas de chemins).
- **Le dépôt unifié** : plus aucune pilule hors de l'île. `island.ts`,
  `onDrag` : `enter` → `DropPanel.prepare(paths)` (et `convert.probe` pour
  la taille ou le nombre d'éléments d'un dossier) puis `fsm.dragEnter` ;
  `over` → `DropPanel.over(pos, shift)` (pilule visée : couleur d'Ondine,
  léger grossissement, Ondine la regarde) ; `drop` → `DropPanel.drop` rend
  un format (`convert.start`) ou une cible (`registry.drop`, comme avant),
  sinon rien et l'île se referme (`fsm.dragLeave`, pas de notification).
  - L'île en mode dépôt fait 700 px de large ; sa hauteur suit le contenu
    (`ResizeObserver` → `fitDrop`, `--drop-h`, ressort). Si elle dépasse le
    panneau de 320 px (380 sur un côté), `Bridge.islandSetTall` demande le
    panneau haut, rendu dès que l'état n'est plus `drop`.
  - En-tête : Ondine surprise, nom (ou « N fichiers »), type et taille (ou
    « Dossier · N éléments »), et la pilule d'option. Pas de pilule
    d'option pour un dossier, ni sans format possible.
  - Lignes Convertir (formats de `pillsFor`, puis « Redimensionner… » pour
    des images, puis ZIP), Ranger (Étagère, Copier, Déplacer, dossiers
    favoris, Corbeille), Outils (Parler à Ondine, Renommer, Chemin, Empreinte,
    Terminal ici, collègues). Une ligne vide est masquée. Les cibles
    viennent toujours de `dropTargets()` des modules ; celles qu'on ne
    connaît pas vont dans Outils.
  - Sans doublons : la pilule ZIP est `zip` d'Ondine convertit, ou
    `shelf-zip` (« Compresser ») si ce module est coupé ; « Images… »
    devient « Redimensionner… » (même boîte de largeur qu'avant).
  - Réglages : `modules.shelf.values.dropPills` = `{v:1, order, hidden}`.
    Tant qu'il n'existe pas, `legacyHidden` reprend les anciens
    interrupteurs (`showTrash`, `showCompress`, `showTools`, `showHash`,
    `showDrop` du terminal et de Demander) : une pilule masquée avant le
    reste. Une ligne jamais réordonnée garde l'ordre propre au type de
    fichier (`arrangeFormats`).
  - Île à gauche ou à droite : même contenu, l'île s'étend vers le centre.
    Île en bas : elle grandit vers le haut. Pendant le travail, la mini-île
    prend la classe `convert-work` (place pour la pilule de progression,
    `workY`), puis s'élargit à la pilule de résultat (`resultWidth`).
  - Animations : arrivée des pilules en ressort décalé (`pillDelay`), fondu
    en mode Calme ou « Réduire les animations », rien en mode Économie.
- `probe {paths}` (Rust) : `{dir, size, count}` par chemin (10 000 éléments
  comptés au plus), rien d'autre ; la démo répond pour un nom sans extension
  par un dossier de 214 éléments.
- **Les pilules** : `pillsFor` (dernier format choisi en premier, retenu par
  type dans `localStorage` « ondine.convert.last » ; pas le format que les
  fichiers ont déjà ; « Un seul ZIP » toujours possible pour plusieurs).
  Images : JPG, PNG, WebP, PDF (« Un seul PDF » pour plusieurs), Alléger,
  GIF, BMP, TIFF, ICO. PDF : PNG, JPG (une image par page). Vidéo : MP4,
  Alléger, MP3, M4A, WAV (le son seul). Son : MP3, M4A, WAV. ZIP : Extraire.
  La pilule d'option (Conserver à côté / Remplacer l'original / Sur le
  bureau, en haut de l'île) tourne après 0,5 s de survol (`Dwell`), à la
  touche Maj (Remplacer) ou au clic ; sa valeur de départ est le réglage
  `dest`.
- **Le travail** (Rust, `start {paths, format, dest}`) : un thread, une
  conversion à la fois (« j'ai déjà la bouche pleine »), 100 fichiers au plus,
  chaque chemin validé (`privacy::check_path`), un fichier après l'autre, un
  échec n'arrête pas les autres ; `cancel` (clic sur la pilule qui se
  remplit). `convert.progress {job, index, total, fraction, name}` (au plus
  toutes les 100 ms), puis `convert.done {job, ok, format, dest, total,
  failed, cancelled, replaced, note, undoId, results: [{name, out, outName,
  before, after, error}]}`. Le nom et le chemin ne vont qu'au front (bus
  local), jamais au journal.
  - Images : crate `image` (orientation EXIF appliquée, métadonnées gardées
    ou retirées selon le réglage), repli sur WIC pour HEIC/AVIF/TIFF ;
    qualité Petite/Normale/Haute (JPEG 70/85/94, Alléger : côté le plus long
    1280/1920/2560). WebP : sans perte seulement (le crate `image` n'écrit
    pas de WebP avec perte).
  - Images → un PDF : `PdfWriter` (pages A4, images en JPEG/DCTDecode, 300
    pages au plus), écrit à la main, sans dépendance.
  - PDF → images : `Windows.Data.Pdf` (96/150/220 ppp), « page 01.png »…
    dans un dossier au nom du PDF.
  - Vidéo et son : `MediaTranscoder` (profils MP4/M4A/MP3/WAV, progression
    réelle, annulation ; fichier à moitié écrit à la Corbeille).
  - ZIP : `files::zip_into` (même code que « Compresser ») ; extraction
    sûre (`enclosed_name`, 20 000 éléments et 16 Gio au plus).
  - Ensuite : date d'origine recopiée (réglage), « Remplacer » (l'original à
    la Corbeille seulement après une réussite, le nouveau prend son nom s'il
    est libre), « Annuler » 10 s par le service d'annulation (remet
    l'original, envoie le nouveau à la Corbeille), sélection du fichier dans
    l'Explorateur si une de ses fenêtres montre déjà le dossier
    (`IShellWindows`, `SHOpenFolderAndSelectItems`, rien n'est ouvert sinon).
  - `open {path}` : seulement un fichier de la dernière conversion.
- **Jamais d'écrasement** : `free_path` donne « photo (2).jpg » ; le même nom
  que l'original n'est jamais écrit par-dessus.
- **L'île pendant le travail** : `IslandStateMachine.keepOpen("convert")`
  garde la mini-île (et la nano en mini) tant qu'Ondine mâche et que la
  pilule de résultat est là ; `island.ts` agrandit le rectangle qui prend la
  souris aux pilules cliquables (`convert.hitRect()`), et ne montre pas la
  notification « Annuler » de `undo.offered` pour ce module (le bouton est
  dans la pilule de résultat).
- **Mascotte** : `mascot.play {animation, emotion}` ; une mascotte sans
  l'animation de la goutte gomme (surpris, ecoute, eating, mange-vite,
  concentree, sursaut, fiere, celebrate, oups, genee) joue l'émotion proche
  (`mascot-state.ts`). Mode Calme ou « Réduire les animations » : les mêmes
  étapes en fondus, pas de grimaces, pas de paillettes. Flou derrière les
  pilules seulement en style Studio.
- **Traductions** : la pilule de résultat mêle un nom, des tailles et une
  raison ; `summarize` reçoit `t()` et l'unité (Ko/KB) et rend des textes
  déjà traduits (`data-no-i18n` sur ces nœuds).
- **Démo** : `demo.ts` simule `convert.start` (avancement puis résultat ; un
  nom qui contient « abîm » échoue).
- **Pas fait (plus tard)** : FFmpeg, LibreOffice, Règles, « Envoyer vers »,
  vidéo → GIF (MediaTranscoder ne sait pas écrire de GIF : il faudrait
  décoder les images une à une), WebP avec perte, métadonnées gardées pour
  HEIC (WIC les lit, on ne les recopie pas).
