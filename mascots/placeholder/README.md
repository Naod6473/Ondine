# Mascottes

Chaque dossier ici est une mascotte : `mascots/<id>/manifest.json` + ses fichiers
d'animation. L'île les trouve toute seule (au build), et l'écran Réglages → Mascotte
permet d'en choisir une et de tester chaque animation.

Voir ARCHITECTURE.md, section « La mascotte », pour le format du manifeste.
Le moteur `canvas-code` (dessin en code) est le seul branché pour l'instant ;
`spritesheet`, `lottie` et `rive` sont prévus dans `src/mascot/renderer.ts`.
