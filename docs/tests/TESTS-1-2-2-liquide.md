# Tests Windows 1.2.2 : le liquide à l'intérieur de l'île (zone « liquide »)

Ce qui ne peut pas être vérifié sous Linux. Pour tout voir sans attendre :
Réglages → Général → Captures d'écran → Mode démo, puis « Minuteur qui se
remplit », « Ambiances dans l'île » et « Ondine qui flotte ». Les réglages :
Réglages → Animations de l'île → À l'intérieur de l'île.

## Le socle
1. « Minuteur qui se remplit » : l'eau monte du bas de l'île avec le temps, avec des bulles ; dans les 10 dernières secondes elle s'agite ; à la fin elle déborde (gouttes), Ondine sursaute, met une bouée et flotte, puis l'eau s'en va (~3 s). Attendu : fluide, sans saccade, île ouverte comme mini-île.
2. Texte toujours lisible au-dessus du liquide (texte secondaire gris compris), avec chaque thème (Nuit, Océan, Prune, Forêt, Braise, Graphite, Verre sur un bureau blanc, Studio) et chaque couleur, opacité à 80 %.
3. Île en haut, en bas, à gauche, à droite : le liquide reste DANS l'île, suit ses coins arrondis et sa forme en gelée (clic, étirement), l'eau monte toujours du bas de l'écran.
4. Pendant un remplissage, cliquer sur l'île (hors boutons) : une vaguelette et des ronds partent du clic.
5. Déplacer l'île par son bord extérieur (ou laisser la fenêtre des réglages la pousser) : le liquide penche puis se remet à plat en oscillant. Avec la gelée, plus mou ; avec le sable, presque pas.
6. Windows → Accessibilité → Effets d'animation désactivés, OU mascotte en Calme : liquide figé (surface plate, pas de bulles, Ondine ne flotte pas), le niveau d'un minuteur avance toutes les 5 s.
7. Gestionnaire des tâches : sans liquide, Ondine ne consomme pas plus qu'avant ; pendant un minuteur de 25 min, CPU faible (24 i/s au calme, 60 quand ça bouge) ; en Performances → Économie, moitié moins. Île cachée : rien ne tourne.
8. Matière Eau / Gelée / Lumière / Sable, Couleur (celle de l'île, de la mascotte, nommée, Personnalisée + #ff6fb1), Opacité : le changement se voit tout de suite.
9. Décocher « Animations à l'intérieur de l'île », ou désactiver le module : plus aucun liquide. Décocher un moment pendant qu'il joue : il s'en va.
10. « Minuteurs : remplissage et liseré » = À la place du liseré : plus de liseré autour de l'île pendant un minuteur, seulement l'eau.

## Les moments
11. Pomodoro : l'eau monte pendant le travail (couleur choisie), descend pendant la pause (vert menthe) ; minuteur mis en pause : elle reste figée.
12. Étagère → Empreinte d'un gros fichier (> 64 Mo) : l'eau monte avec le pourcentage puis s'en va. Équipe → envoyer un fichier : pareil.
13. Un téléchargement arrive (Étagère, « Surveiller Téléchargements ») : l'eau monte d'un coup, Ondine plonge et ressort fière.
14. Portable : brancher le chargeur → eau verte jusqu'au niveau (~7 s) ; batterie faible → fond d'eau orange qui reste jusqu'au branchement (rouge si critique).
15. Disque presque plein : eau trouble près du haut ~8 s.
16. Claude Code travaille : un courant violet traverse l'île de gauche à droite ; à la fin, une vague, puis l'eau s'en va.
17. « Musique » cochée et un morceau qui joue : la surface ondule avec le son (rien n'est écouté : niveau seulement).
18. Parler à Ondine à voix haute : la surface vibre avec la voix.
19. Météo pluvieuse (module Météo) : gouttes qui glissent sur la vitre de l'île tant qu'il pleut.
20. Processeur à fond longtemps : petites bulles d'ébullition au fond.
21. « Nuit » cochée, après 22 h : un fond d'eau calme avec quelques étoiles.
22. Une notification arrive : une goutte tombe dans l'île et fait des ronds (pas pour Verr Maj / Copié).
23. Pomodoro avec mode concentration : l'eau devient lisse et immobile comme un lac.
