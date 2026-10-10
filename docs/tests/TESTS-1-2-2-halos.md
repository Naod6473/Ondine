# Tests Windows 1.2.2 : halos de l'île (zone « halos »)

Ce qui ne peut pas être vérifié sous Linux. Pour tout voir sans attendre :
Réglages → Général → Captures d'écran → Mode démo, puis « Halos de batterie »
et « Autres halos ».

## Le socle
1. Mode démo, « Autres halos » : chaque halo apparaît autour de l'île (mini-île comprise), suit ses coins arrondis, déborde de 10 à 30 px, sans trait le long du haut de l'écran. Attendu : couleurs qui bougent, fondus doux, rien de saccadé.
2. Pendant un halo, cliquer sur l'île : une onde de couleur part de l'endroit du clic.
3. Île sur le bord gauche ou droit (Réglages → Apparence) : le halo suit l'île, la comète passe « derrière » le bord de l'écran.
4. Windows → Accessibilité → Effets d'animation désactivés, OU mascotte en Calme : le halo est fixe (pas de vagues ni d'étincelles).
5. Gestionnaire des tâches : sans halo, Ondine ne consomme pas plus qu'avant ; pendant une aurore (Animations de l'île → « Couleurs du ciel au repos »), noter le CPU (attendu : faible, 30 i/s).
6. Thème clair de Windows : les couleurs restent visibles (plus foncées).
7. Réglages → Animations de l'île → Intensité Discret / Normal / Vif, Couleurs Arc-en-ciel / Couleur de ma mascotte : le changement se voit au halo suivant. Désactiver le module : plus aucun halo (batterie comprise).

## Batterie (portable)
8. Brancher le chargeur : vague verte de gauche à droite jusqu'au niveau, « En charge · 56 % ». Avec « Halo pendant la charge » = Toujours : le halo vert reste ; Quelques secondes : ~7 s ; Jamais : seulement la vague.
9. Débrancher : bref balayage blanc, « Sur batterie · 82 % » (dans les 2 s, 5 s en éco).
10. Seuil faible réglé haut (ex. 50 %) sur batterie : vagues orange quelques secondes, puis petite braise orange au bord jusqu'au branchement ; Ondine bâille.
11. Seuil critique réglé haut (ex. 30 %) : alerte « Batterie critique » avec « Compris », halo rouge qui bat vite ; Ondine panique. « Compris » arrête le halo rouge ; brancher : Ondine soulagée, plus de braise.
12. Batterie à 100 % branchée : éclat vert et doré avec étincelles.
13. PC fixe : aucun halo de batterie, aucune notification.

## Autres halos
14. Mettre le PC en veille puis le réveiller : lever de soleil, Ondine s'étire.
15. Brancher une clé USB : vague ; l'éjecter depuis Contrôles : vague dans l'autre sens, Ondine fait au revoir.
16. Télécharger un fichier (Étagère, « Surveiller Téléchargements » coché) : une goutte, puis des ronds dans l'eau.
17. Ondine → Parler à Ondine, envoyer une question : trois gouttes qui se courent après jusqu'à la réponse.
18. Visio (Teams, Zoom…) : le halo vert d'eau suit le niveau de votre voix ; se tait quand le micro est coupé/libéré. Vérifier qu'aucune autre appli ne signale qu'Ondine enregistre.
19. Minuteur → Pomodoro avec « mode concentration » : cocon bleu nuit qui se remplit comme une jauge ; à la fin de la séance, une fleur.
20. Réglage « Heure de partir » à l'heure actuelle + 1 min (un jour de semaine) : coucher de soleil, « C'est l'heure de partir », écharpe.
21. Premier usage le matin (avant midi) : éclat doux et « Bonjour ! » avec la météo (si Météo activée), une seule fois par jour.
22. Wi-Fi faible (s'éloigner de la box) : le halo grésille. Sous Windows 11 24H2 sans la localisation pour les applis de bureau : rien (attendu).
23. Couper le Wi-Fi (module Réseau activé) : rouge qui respire ; le rétablir : balayage vert.
24. Capture d'écran (module Capture) : flash blanc. Lâcher un fichier sur l'île : vague depuis le centre.
25. Disque sous le seuil (Système → « Prévenir quand un disque a moins de », mettre 50) : réservoir qui monte (et déborde en gouttes si le disque est plein à plus de 95 %).

## Clavier et presse-papiers
26. Verr Maj, Verr Num : comète bleue et « Verr Maj · Activé » / « Désactivé ». Vérifier que l'état affiché est le bon (risque : GetKeyState lu hors fil d'interface).
27. Ctrl+C sur un texte : « Copié » + début du texte ; Ctrl+X : « Coupé » ; Ctrl+V : « Collé ». Copier un mot de passe depuis un gestionnaire (Bitwarden, KeePass, 1Password) : « Copié » sans texte. Ctrl+C dans un terminal sans sélection : rien.
28. Touches de volume du clavier : barre qui suit (« Volume · 45 % », « Son coupé »).
29. Taper vite : aucune prise de focus, rien ne gêne la frappe.
