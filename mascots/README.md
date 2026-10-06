# Mascottes

Chaque dossier ici est une mascotte : `mascots/<id>/manifest.json` + ses fichiers
d'animation. L'île les trouve toute seule (au build), et l'écran Réglages → Mascotte
permet d'en choisir une et de tester chaque animation.

Voir ARCHITECTURE.md, section « La mascotte », pour le format du manifeste.
Moteurs branchés : `canvas-code` (dessin en code, gardé en secours), `gum` (la goutte gomme dessinée en code, `goutte-gomme/`), `spritesheet`
(planches PNG en ligne, aucune mascotte ne l'utilise pour l'instant) et `poses` (une image par émotion avec fondus,
`goutte/` et `goutte-classique/`). `lottie` et `rive` sont prévus dans `src/mascot/renderer.ts`.

Format d'une pose (`goutte/`) : une image 256 × 256, fond transparent, le corps
posé sur la même ligne de base (y ≈ 244) et centré (x ≈ 128), à la même taille
que les autres poses. Les yeux blancs sont décrits dans le manifeste (`eyes`)
pour que le code y dessine les pupilles. Les émotions de la goutte v2 ont été
découpées dans les planches fournies (2 gouttes par planche), remises à la même
hauteur et alignées sur les pieds.

Les animations de `goutte/anim/` (bulle, glitch, colère, électrique, joie,
alerte, fondue, pleurs, mange un fichier, danse) sont des suites d'images
`<nom>-1.webp` … `<nom>-8.webp`, cadrées comme les poses (même échelle par
animation, recentrées sur les pieds), jouées par `"poses": [...]` avec un fondu
court entre deux images. Les yeux blancs de chaque image sont dans `eyes`.

Format d'une planche (`spritesheet`) : une seule ligne d'images, toutes de la même
largeur, fond transparent.

`goutte-classique/` : la première goutte, refaite au format `poses` avec les mêmes
24 poses et 11 animations que `goutte/`. Ses images sont fabriquées par un script
(visage vierge repeint, puis traits, couleurs et mouvements dessinés en code).
