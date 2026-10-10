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

## Retours de test (2e passe, zone « halos2 »)

### Le halo suit la musique
Cause trouvée : le module Musique publie `{playing: {status: "playing"}}`, le
halo testait `playing === true` : le halo de la musique ne s'allumait jamais.
Le halo vu pendant la musique était celui de la danse (musique + mini-île,
case « Le halo danse avec la mascotte »), qui ne regardait pas la case Musique.

30. « Le halo suit la musique » DÉCOCHÉ, lancer une musique (Spotify, YouTube…), île en mini-île : aucun halo (Ondine peut danser, mais sans halo).
31. Cocher la case PENDANT la lecture : le halo s'allume tout de suite et pulse avec le son (plus fort = plus de lueur et des ondes). La décocher pendant la lecture : il s'éteint tout de suite.
32. Mettre la musique en pause : le halo s'éteint. Changer de morceau : pas de clignotement.
33. Visio (micro utilisé) pendant la musique : le halo vert d'eau de la voix passe devant ; micro libéré : retour au halo de la musique.

### Liseré des minuteurs (Animations de l'île → Ondine et agents → « Minuteurs : un liseré… », coché par défaut)
34. Minuteur → 1 min, replier l'île (mini-île) : une ligne de lumière (rose-ambre) fait le tour de l'île et raccourcit en continu, sans à-coups. Même chose île ouverte.
35. Dans les 10 dernières secondes : la ligne vire au rouge et bat doucement une fois par seconde ; à 0 : un éclat avec étincelles, puis plus rien.
36. Pause : la ligne reste figée, plus pâle ; Reprendre : elle repart d'où elle était. « +1 min » : elle s'allonge. Réinitialiser : elle s'éteint.
37. Pomodoro travail : ligne tomate (et plus de cocon bleu nuit) ; fin de séance : fleur ; pause courte : ligne menthe, puis éclat menthe.
38. Lanceur → taper « 10 min » → Entrée, ou demander à Ondine « lance un minuteur de 2 minutes » : le liseré apparaît aussi.
39. Décocher la case pendant qu'un minuteur tourne : le liseré disparaît tout de suite ; la recocher : il revient au bon endroit.
40. Animations réduites (Windows) ou Calme : la ligne ne scintille plus, avance par petits pas toutes les 5 s.
41. Gestionnaire des tâches, minuteur de 25 min, mini-île : CPU d'Ondine faible (dessin à 12 images/s).
42. Mode démo → « Liseré d'un minuteur » : minuteur de 40 s avec tout le parcours (rouge à 10 s, éclat).

## Retours de test (3e passe, zone « halos3 ») : halos plus fins, « Où dessiner le halo »

Retour de Simon : le halo de la musique était trop large et gênait la vue.
Maintenant : un halo reste près de l'île (au plus ~6 px sur le contour, ~12 px
à l'extérieur, rien dehors à l'intérieur), un halo qui dure (musique, visio,
processeur, Internet coupé, concentration, agent au travail) est plus pâle.
La fenêtre de l'île ne grandit pas pour un halo (il est dessiné dans la
fenêtre qui existe déjà, la souris passe au travers).

43. Réglages → Animations de l'île → Général : « Où dessiner le halo » vaut « Sur le contour » par défaut (visible aussi en mode Simple). L'« Aperçu du halo » juste dessous montre une petite île : comète, musique, liseré d'un minuteur, éclat, toutes les 4 s. Changer le choix (et l'intensité) : l'aperçu change tout de suite.
44. « Le halo suit la musique » coché, une musique qui joue, mini-île puis île ouverte : le halo pulse avec le son sans jamais voiler le texte des fenêtres derrière (comparer avec la 1.2.1 si possible).
45. Les 3 choix, avec Mode démo → « Autres halos », « Halos de batterie », « Liseré d'un minuteur » :
    - À l'intérieur : la lumière est dans l'île, le long du bord ; rien ne dépasse dehors ; le texte de l'île reste lisible.
    - Sur le contour : un liseré fin sur le bord de l'île (comme le liseré des minuteurs) ; rien le long du bord de l'écran.
    - À l'extérieur : une lueur fine autour, qui ne passe pas sur l'île.
    Attendu dans les 3 : chaque forme se reconnaît (comète, vague, réservoir, pluie, éclat, gouttes, niveau, liseré qui rougit à la fin).
46. Refaire 45 avec l'île sur les 4 bords (Réglages → Apparence → Bord de l'écran : haut, bas, gauche, droite) : jamais de trait le long du bord de l'écran, la comète passe « derrière » le bord.
47. À l'intérieur ou sur le contour : cliquer sur l'île pendant un halo, et sur les boutons de l'île : tout répond normalement (le calque laisse passer la souris).
48. Un thème clair de l'île (Apparence → Thème) avec « À l'intérieur » : les couleurs restent visibles sur le fond clair de l'île.
49. Animations réduites (Windows) ou Calme : halo fixe dans les 3 choix.
50. Gestionnaire des tâches pendant une musique de 5 min avec le halo : CPU d'Ondine faible (30 i/s, comme avant).
