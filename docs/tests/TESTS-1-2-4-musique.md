# Tests Windows 1.2.4 : la carte Musique (zone « musique »)

La carte a été vue dans un navigateur (mode démo, Chromium sous Linux) ; rien
de ce qui touche Windows (aléatoire, répétition, volume du lecteur, ouvrir le
lecteur) n'a tourné sur un vrai PC. Les calculs (temps restant, niveau de
l'icône du volume, état des boutons, envois limités) sont testés par
`npm test` (tests/front/media.test.ts), la reconnaissance du lecteur par
`cargo test` (platform/media.rs).

## Carte ouverte (onglet Musique)
- [ ] Spotify qui joue : pochette à gauche, pastille de couleur devant le titre, « Artiste · Album » dessous, « Spotify » en petit. Les icônes sont au trait (plus d'emoji ⏮ ⏸ ⏭).
- [ ] Grand bouton lecture rond et blanc au milieu : pause / lecture marchent, l'icône change aussitôt.
- [ ] Précédent et Suivant marchent ; la scène « Morceau suivant » d'Ondine (elle appuie du pied sur Suivant) marche toujours.
- [ ] Temps écoulé à gauche (« 1:42 »), temps restant à droite (« -2:13 ») ; les deux avancent chaque seconde.
- [ ] Barre de progression grise au repos ; sous la souris elle prend la couleur de la pochette et un petit bouton rond apparaît. Cliquer : le morceau saute là. Glisser : la barre et les temps suivent la souris, le morceau saute au lâcher. Flèches gauche / droite au clavier : ±5 s.
- [ ] Un lecteur qui refuse qu'on change la position (radio, certains sites) : la barre reste grise, sans bouton rond.
- [ ] La couleur (pastille, barre sous la souris, Aléatoire / Répétition actifs, lueur douce en haut à gauche de la carte) vient de la pochette et change au morceau suivant. Une pochette très sombre donne quand même une couleur visible. En pause, la couleur reste.
- [ ] Clic sur la pochette : la fenêtre de Spotify passe devant (même réduite). Pareil avec Edge, Chrome, Firefox (la fenêtre du navigateur), VLC, le Lecteur multimédia de Windows (appli du Store).

## Aléatoire et répétition
- [ ] Spotify : clic sur Aléatoire → il passe en couleur, et Spotify montre bien l'aléatoire activé ; re-clic → gris.
- [ ] Répétition : clic → en couleur « Répéter la liste », clic → icône avec un « 1 » « Répéter ce morceau », clic → gris. Spotify suit à chaque fois.
- [ ] Changer l'aléatoire ou la répétition dans Spotify lui-même : la carte suit en une à deux secondes.
- [ ] Un lecteur qui ne les expose pas (YouTube dans le navigateur, VLC…) : les deux boutons sont grisés, l'infobulle dit « indisponible pour ce lecteur ».

## Volume du lecteur
- [ ] Spotify qui joue : le volume à droite montre le niveau de Spotify dans le mélangeur de volume de Windows (clic droit sur 🔊 → Mélangeur de volume), PAS le volume général.
- [ ] Glisser la barre de volume : Spotify baisse / monte en direct, sans saccade ; le mélangeur de Windows bouge pour Spotify seulement. Le volume du PC (icône 🔊) ne change pas.
- [ ] L'icône change selon le niveau : barrée à 0 ou coupé, une onde sous 34, deux sous 67, trois au-dessus.
- [ ] Clic sur l'icône du haut-parleur : le son de Spotify est coupé (icône barrée, « 0 ») ; re-clic : il revient au même niveau.
- [ ] Chrome / Edge / Firefox qui jouent une vidéo : le volume règle le navigateur seulement (dans le mélangeur, la ligne du navigateur).
- [ ] Lecteur multimédia de Windows (appli du Store) : le volume marche aussi.
- [ ] Lecteur qui n'a pas encore joué de son : le volume est grisé (« Volume indisponible pour ce lecteur »), « – » à la place du nombre.
- [ ] Spotify sur un casque Bluetooth qui n'est pas la sortie par défaut : le volume le trouve quand même.

## Mini-île
- [ ] Musique qui joue, île repliée : pochette, « Titre · Artiste » (qui défile s'il est long) et l'égaliseur, de la couleur de la pochette. Pas de boutons au repos.
- [ ] Souris sur la mini-île : la pochette et l'égaliseur se replient en gelée, lecture / pause et suivant apparaissent ; la goutte danse à côté. Les deux boutons marchent sans ouvrir l'île.
- [ ] Réglages → Musique → décocher « Boutons précédent / lecture / suivant dans la pilule » : sous la souris, plus de boutons (pochette et égaliseur restent).
- [ ] La goutte danse toujours au tempo de la musique (réglage « La mascotte danse au tempo de la musique »).

## Styles et animations
- [ ] Réglages → Apparence → Icônes « Couleur » puis « Épurées » : la carte et la mini-île sont correctes dans les deux.
- [ ] Thème clair (Givre) : textes, boutons et barres restent lisibles.
- [ ] « Réduire les animations » de Windows : pas d'égaliseur qui bouge, pas d'ondulation du titre, les boutons de la mini-île apparaissent en fondu, pas de zoom au survol.
- [ ] Mode Éco : égaliseur immobile.
- [ ] Anglais (Réglages → Langue) : infobulles « Shuffle on », « Repeat the list », « Player volume »… ; tutoiement : rien ne change (pas de « vous » dans ces textes).

## Mode démo
- [ ] Réglages → Mode démo : la carte montre « Lumière d'été », Aléatoire allumé, volume 68 ; Aléatoire, Répétition et le volume réagissent ; clic sur la pochette ne fait rien.
