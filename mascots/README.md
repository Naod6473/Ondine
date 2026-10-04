# Mascottes

Chaque dossier ici est une mascotte : `mascots/<id>/manifest.json` + ses fichiers
d'animation. L'île les trouve toute seule (au build), et l'écran Réglages → Mascotte
permet d'en choisir une et de tester chaque animation.

Voir ARCHITECTURE.md, section « La mascotte », pour le format du manifeste.
Moteurs branchés : `canvas-code` (dessin en code, `placeholder/`) et `spritesheet`
(planches PNG, `goutte/`). `lottie` et `rive` sont prévus dans `src/mascot/renderer.ts`.

Format d'une planche : une seule ligne d'images, toutes de la même largeur, fond
transparent. Les deux planches de `goutte/` ont été recadrées à 7 × 256 × 256 à
partir des images fournies (corps posé sur la même ligne de base).
