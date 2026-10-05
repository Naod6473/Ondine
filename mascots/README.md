# Mascottes

Chaque dossier ici est une mascotte : `mascots/<id>/manifest.json` + ses fichiers
d'animation. L'île les trouve toute seule (au build), et l'écran Réglages → Mascotte
permet d'en choisir une et de tester chaque animation.

Voir ARCHITECTURE.md, section « La mascotte », pour le format du manifeste.
Moteurs branchés : `canvas-code` (dessin en code, `placeholder/`), `spritesheet`
(planches PNG, `goutte-v1/`) et `poses` (une image par émotion avec fondus,
`goutte/`). `lottie` et `rive` sont prévus dans `src/mascot/renderer.ts`.

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

Format d'une planche : une seule ligne d'images, toutes de la même largeur, fond
transparent. Les deux planches de `goutte-v1/` ont été recadrées à 7 × 256 × 256 à
partir des images fournies (corps posé sur la même ligne de base).
