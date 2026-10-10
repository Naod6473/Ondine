# Tests Windows 1.2.2 : zone « ui2 » (retours de test : icônes, défilement, bulle d'Ondine)

À vérifier sur Windows (le conteneur Linux ne peut pas le faire). Résultat attendu après la flèche.

## 1. Les icônes
- Réglages → Apparence → Icônes « Épurées » → dans la colonne de gauche, Équipe (trois silhouettes), Animations de l'île (baguette magique) et Ondine et les fenêtres (fenêtre) sont au trait, de la même épaisseur et de la même taille que leurs voisines ; plus aucun emoji 🤝 🌈 🪟.
- Icônes « Couleur » → les trois icônes de Simon (personnages, baguette étoile, goutte dans la fenêtre), sans bord noir ni carré, nettes à 100 %, 125 % et 150 %.
- Thème clair de Windows / thème « Verre » de l'île → pas de halo sale autour des trois icônes couleur.
- Onglets → Ordre des onglets et « Sans onglet » → mêmes icônes (plus d'emoji dans « Sans onglet »).
- Île : allumer Équipe → son onglet et son menu montrent la bonne icône dans les deux styles ; notification « Nouveau collègue » → même icône.
- Lanceur : taper « équipe » → la ligne de l’onglet Équipe a la bonne icône.

## 2. Les barres de défilement de l'île
- Ouvrir le Lanceur avec beaucoup de fichiers récents (ou Presse-papiers, Agents IA) → aucune barre Windows grise avec ses flèches à droite.
- Survoler la liste → une fine pastille grise translucide, arrondie, apparaît à droite ; sortir la souris → elle s'efface en douceur.
- Molette sans survoler la barre (au clavier : ↓ dans le Lanceur) → la pastille apparaît pendant le défilement, puis s'efface environ 1 s après.
- Survoler la pastille → elle s'épaissit un peu ; on peut la saisir et la faire glisser.
- Le texte ne bouge pas d'un pixel quand la pastille apparaît ou disparaît.
- « Réduire les animations » de Windows → elle apparaît et disparaît d'un coup.

## 3. La bulle d'Ondine sur le bureau
- Sortir Ondine sur le bureau, choisir 4 ou 5 onglets (Réglages → Mascotte → « Les onglets de sa bulle »), cliquer sur elle → la rangée du haut ne montre que des icônes ; le survol d'une icône affiche son nom en infobulle ; Narrateur lit le nom.
- Passer d'un onglet à l'autre (Étagère vide, Presse-papiers, Lanceur, Agents IA) → la bulle change de largeur ET de hauteur en glissant (sans rebond), la mascotte ne bouge pas, rien n'est coupé pendant le trajet.
- Taper dans le Lanceur de la bulle → la bulle s'allonge avec les résultats ; effacer → elle se resserre.
- Parler à Ondine : une longue réponse qui s'écrit → la bulle s'élargit puis grandit en douceur, sans trembler à chaque mot ; au-delà de 640 × 560 (ou de la place à l'écran), le contenu défile.
- Ondine dans chaque coin de l'écran (bas à droite, haut à gauche…), puis sur un petit écran ou à 150 % → la bulle reste entière à l'écran, du côté où il y a de la place, sans jamais passer sous la barre des tâches.
- Bulle à gauche ou vers le haut (Ondine en bas à droite) qui grandit → la fenêtre s'agrandit vers la gauche / le haut sans que la mascotte ni la bulle ne sautent (au pire un tremblement d'une image : à signaler).
- Clics : à côté de la bulle (zone transparente), les clics passent bien à la fenêtre du dessous, y compris juste après qu'elle s'est resserrée.
- Déplacer Ondine bulle ouverte vers l'autre bord → la bulle se replace et se borne à la nouvelle place.
- Mode Calme ou « Réduire les animations » → la bulle prend sa taille d'un coup.
