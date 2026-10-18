# Tests Windows : paroles synchronisées et module Eau

Avant de commencer, quittez toutes les Ondine (Gestionnaire des tâches), puis lancez `npm.cmd run tauri dev`.

## Paroles (module Musique)

1. Lancez une chanson connue dans Spotify (ou le navigateur). Ouvrez l'onglet Musique : pas de bouton « Paroles » (réglage coupé par défaut).
2. Réglages → Modules → Musique : cochez « Paroles (LRCLIB) ». Lisez l'aide : titre, artiste, album et durée, vers lrclib.net.
3. Revenez à l'onglet Musique : un petit bouton « Paroles » est à droite des boutons de lecture. Cliquez dessus.
4. La carte se coupe en deux : à gauche la pochette réduite, le titre, la barre et précédent / lecture / suivant ; à droite « Recherche des paroles… » puis les paroles.
5. La ligne chantée est blanche, les autres estompées ; elle change pile au bon moment et la liste glisse avec un petit rebond. Le haut et le bas du volet sont fondus.
6. Cliquez sur une ligne plus loin : la musique saute à cet endroit, la ligne s'allume.
7. Avancez dans le morceau avec la barre : les paroles suivent.
8. Mettez en pause : la ligne ne bouge plus. Reprenez : elle repart.
9. Passez au morceau suivant (vue toujours ouverte) : les nouvelles paroles arrivent seules.
10. Un morceau sans paroles connues (un enregistrement perso) : « Pas de paroles pour ce morceau ». Un morceau instrumental : « Morceau instrumental : pas de paroles ».
11. Un morceau avec seulement le texte (sans horodatage) : « Paroles non synchronisées » et tout le texte, qu'on fait défiler à la molette.
12. Coupez le Wi-Fi, passez à un morceau jamais vu : « Paroles indisponibles pour l'instant (pas de connexion ?) ». Rebranchez, recliquez deux fois sur « Paroles » : elles arrivent.
13. Revenez à un morceau déjà vu : les paroles s'affichent tout de suite (gardées en mémoire).
14. Refermez l'île puis rouvrez-la : la vue Paroles est toujours ouverte. Recliquez « Paroles » : la carte redevient comme avant (aléatoire, répétition, volume).
15. Décochez « Paroles (LRCLIB) » : le bouton disparaît, la carte redevient normale.
16. Style Encoche puis Classique, et un thème clair (Givre) en Classique : les paroles restent lisibles.
17. Anglais (Réglages → Langue) : « Lyrics », « No lyrics for this track ». Les paroles elles-mêmes ne sont jamais traduites.
18. Mode démo, réglage Paroles coché : des paroles inventées défilent sur les deux morceaux de démo.

## Eau

19. Réglages → Modules → Eau : le module est coupé. Activez-le : un onglet « Eau » apparaît.
20. L'onglet montre « 0 L », « sur 2 L aujourd'hui », une barre vide, « + 25 cl » et 7 petites barres (aujourd'hui à droite, en blanc).
21. Cliquez trois fois sur « + 25 cl » : « 0,75 L », la barre avance, la barre du jour grandit. « Annuler » apparaît.
22. Cliquez « Annuler » : « 0,50 L ». Appuyez longuement sur « + 25 cl » (une demi-seconde) : « 0,25 L », sans ajouter de verre.
23. Réglages : taille du verre 33 cl → le bouton devient « + 35 cl » (pas de 5 cl) ; objectif 1,5 L → « sur 1,50 L aujourd'hui ».
24. Quittez et relancez Ondine : le total du jour est le même. Le fichier `%APPDATA%\Ondine\water.json` ne contient que des dates, des heures et des tailles.
25. Rappel : mettez « Un rappel toutes les » à 15 min et une plage qui contient l'heure actuelle. Sans boire, au plus 15 min après le dernier verre, l'île montre « Un verre d'eau ? » avec « + 25 cl » et « Plus tard ».
26. « + 25 cl » dans l'alerte ajoute un verre ; « Plus tard » redemande dans 30 min.
27. Lancez un Pomodoro (Minuteur, mode concentration) : pas de rappel pendant la séance ; il vient après.
28. Une présentation ou une vidéo en plein écran, puis un appel Teams (micro utilisé) : pas de rappel pendant.
29. Objectif atteint, ou en dehors de la plage d'heures : plus de rappel.
30. Le lendemain (ou changez la date de Windows) : le total repart de 0, la veille est dans les barres.
31. Mode démo : une semaine inventée (1,25 L aujourd'hui), « + 25 cl » marche sans rien écrire sur le disque.
32. Anglais : « Water », « of 2 L today », « 1.25 L », jours « M T W T F S S ».
