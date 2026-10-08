# Mascottes

Chaque dossier ici est une mascotte : `mascots/<id>/manifest.json` + ses fichiers
d'animation. L'île les trouve toute seule (au build), et l'écran Réglages → Mascotte
permet d'en choisir une et de tester chaque animation.

Voir docs/ARCHITECTURE.md, section « La mascotte », pour le format du manifeste.
Moteurs branchés : `canvas-code` (dessin en code, gardé en secours), `gum` (la goutte gomme dessinée en code, `goutte-gomme/`, et ses cousines de `src/mascot/gum-family.ts` : Guimauve, Dragée, Berlingot, étoile, soleil, lune, nuage, cœur, fleur, champignon, fantôme, flamme, Ciel et Météo), `spritesheet`
(planches PNG en ligne, aucune mascotte ne l'utilise pour l'instant) et `poses` (une image par émotion avec fondus ;
les deux gouttes en images qui l'utilisaient ont été retirées en 1.2.0, le moteur reste pour une mascotte faite d'images).
`lottie` et `rive` sont prévus dans `src/mascot/renderer.ts`.

Format d'une pose (`poses`) : une image 256 × 256, fond transparent, le corps
posé sur la même ligne de base (y ≈ 244) et centré (x ≈ 128), à la même taille
que les autres poses. Les yeux blancs sont décrits dans le manifeste (`eyes`)
pour que le code y dessine les pupilles. Une animation image par image est une
suite d'images `<nom>-1.webp` … `<nom>-8.webp`, cadrées comme les poses, jouée
par `"poses": [...]` avec un fondu court entre deux images.

Format d'une planche (`spritesheet`) : une seule ligne d'images, toutes de la même
largeur, fond transparent.
