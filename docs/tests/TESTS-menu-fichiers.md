# Tests Windows 1.2.5 : le menu de fichiers

À vérifier sur Windows (le conteneur Linux ne le peut pas). Résultat attendu après la flèche.
Préparer : une photo .png, un PDF, une vidéo .mp4, un dossier, deux dossiers favoris dans l'Étagère.

## L'île

1. Glisser la photo sur l'île → icônes rondes, Convertir ouvert avec les formats seuls (pas de ZIP ni d'Alléger) ; ZIP est en favori juste à côté de Convertir, Ranger, Outils, sur la même rangée, avec un reflet de verre. La pilule « Étagère (n) » se détache et se pose sous l'île, à droite.
2. Pendant le glisser, rester 0,4 s sur Ranger → l'anneau se remplit, Ranger s'ouvre. Ctrl → Outils, qui commence par ZIP, Alléger, Redimensionner…, Extraire. Alt → Ranger.
3. Lâcher sur l'île → rien ne se lance. L'île reste ouverte et le fichier reste en main.
4. Survoler WebP, puis cliquer → conversion, résultat dans la mini-île.
5. Lâcher, puis Échap → l'île se referme, rien n'est fait. Faire de même avec un clic sur le bureau, puis avec « Annuler ».
6. Lâcher, puis cliquer dans une autre fenêtre → l'île se referme sans rien faire.
7. Lâcher directement sur la pilule « Étagère » → le fichier est sur l'étagère tout de suite. La pilule remonte se fondre dans l'île et l'île fait un petit saut.
8. Lâcher, survoler la pilule d'option 0,5 s → « Remplacer l'original ». Un clic sur PNG remplace l'original (Corbeille).
9. Lâcher, survoler WebP, cliquer l'étoile → WebP apparaît en favori après ZIP, sur la rangée des bulles mères, après un séparateur. Au sixième favori → « Cinq favoris au plus ».
10. Glisser la photo et le PDF ensemble → WebP, GIF… grisés. Convertir s'ouvre quand même. Au survol : « Seulement pour les images » ou « Un type de fichier à la fois ». Un clic sur un choix grisé ne fait rien.
11. Glisser le dossier → Convertir est vide (éteint), Outils s'ouvre avec ZIP ; « Empreinte » et « Parler à Ondine » sont absentes. Glisser le dossier avec la photo → « Empreinte » est grisée (« Pas pour un dossier »).
12. Île à gauche, à droite, puis en bas → la pilule Étagère est sous l'île (ou au-dessus en bas), jamais coupée. Elle prend bien le lâcher et le clic.
13. Échelle 125 % et 150 %, deuxième écran → l'icône allumée est bien celle sous la souris. La pilule Étagère prend le clic.

## Ondine sur le bureau

14. Lâcher la photo sur Ondine au milieu de l'écran → cercle autour d'elle : Convertir en haut (formats seuls), Outils à gauche (ZIP, Alléger, Redimensionner…), Ranger à droite, favoris et Étagère en bas, l'option sous elle. Le favori ZIP se voit sans survol, avec le reflet.
15. Rester 0,4 s sur Ranger → ses choix sortent en arc. Cliquer « Copier vers… » → la boîte de dossier s'ouvre, puis le cercle se replie.
16. Pendant le cercle, cliquer sur une fenêtre derrière, entre deux bulles → le clic passe à la fenêtre, et le cercle s'annule.
17. Ondine dans un coin de l'écran, puis contre la barre des tâches → le cercle reste entier dans l'écran. Ondine glisse jusqu'à son centre, puis revient à sa place.
18. Échap → tout se replie, rien n'est fait.
19. L'étoile d'un choix du cercle → le favori apparaît aussi dans l'île au dépôt suivant.

## Réglages et animations

20. Réglages → Étagère → Pilules du dépôt : étoile, ← →, × sur les favoris → le menu de l'île suit. « Réinitialiser » remet ZIP seul en favori.
21. Passer de 1.2.4 à 1.2.5 → l'ordre et les pilules masquées sont gardés ; ZIP, Alléger, Redimensionner… passent dans Outils ; ZIP est favori. Depuis une version de test de la PR où tous les favoris avaient été retirés → aucun favori (cliquer « Réinitialiser » pour ravoir ZIP).
21 bis. Réglages → L'île → Apparence : changer la couleur (puis une couleur personnalisée) → le reflet des favoris, l'étoile et l'anneau prennent cette couleur, dans l'île et autour d'Ondine, en Classique comme en Studio.
22. Style Studio → verre dépoli sur les bulles et sur la pilule Étagère. Style Classique → pas de flou.
23. « Réduire les animations » ou mode Calme → des fondus, sans ressort. Mode Économie → aucune animation. Dans ces trois cas, le reflet des favoris reste visible mais ne bouge plus.
