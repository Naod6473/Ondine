# Tests Windows : « Se voir » avant une réunion (miroir)

Rien de tout cela n'a encore tourné sous Windows (WebView2) : seulement dans
Chromium, avec une fausse caméra et un faux micro. Il faut un PC avec webcam
et micro, le module Agenda avec un calendrier qui contient une réunion Teams,
Meet ou Zoom dans quelques minutes, et le module Contrôles activé.

Astuce : Réglages → Modules → Agenda → Avant une réunion → « Proposer de
rejoindre la réunion » à 10 min pour ne pas attendre.

## 1. L'autorisation de WebView2 (le plus important)

- [ ] Île, alerte « Réunion dans N min » → « Se voir », la toute première fois : une demande d'autorisation caméra / micro apparaît (boîte de WebView2 « tauri.localhost veut utiliser votre caméra et votre micro », ou rien si Windows l'accorde d'office). Noter **où** elle s'affiche (au-dessus de l'île ? derrière ? invisible ?) et si on peut cliquer « Autoriser » malgré l'île qui ne prend pas le focus.
- [ ] Autoriser, fermer l'aperçu, le rouvrir : la question n'est **pas** reposée. Quitter Ondine, la relancer, rouvrir l'aperçu : noter si la question revient (WebView2 retient-il l'autorisation d'une session à l'autre ?).
- [ ] Refuser : l'aperçu dit « Caméra refusée : autorisez-la dans Paramètres Windows → Confidentialité → Caméra. » (et pareil pour le micro), rien ne plante, l'île se ferme normalement.
- [ ] Paramètres Windows → Confidentialité → Caméra → « Autoriser les applications de bureau » coupé : même message, rien ne plante.

## 2. Avant une réunion

- [ ] Île, alerte « Réunion dans N min : Titre » : trois boutons, « Rejoindre », « Se voir » et ×.
- [ ] Cliquer « Se voir » : l'île grandit, l'image arrive en gelée (elle s'écrase un peu puis se pose), en miroir (lever la main droite : elle se lève à droite de l'image), coins arrondis. La lumière de la webcam s'allume.
- [ ] Sur l'image, en haut à gauche : un point vert (caméra) et un point orange (micro) tant qu'ils sont ouverts.
- [ ] Parler : la jauge « Micro » monte avec la voix et redescend doucement ; silence : elle reste presque vide.
- [ ] Ondine fait un clin d'œil une fois quand l'image arrive (pas en boucle).
- [ ] « Rejoindre » dans l'aperçu : la lumière de la webcam **s'éteint tout de suite**, puis Teams / Meet / Zoom s'ouvre et **trouve la caméra et le micro libres** (aperçu vidéo dans Teams, pas « caméra utilisée par une autre application »). La musique se met en pause comme avant.
- [ ] × dans l'aperçu : l'aperçu se ferme, la lumière de la webcam s'éteint.
- [ ] Laisser l'aperçu ouvert sans rien toucher : il se ferme seul au plus tard 5 minutes après le début de la réunion (10 minutes sans réunion), la webcam s'éteint.
- [ ] Une autre alerte plus importante arrive pendant l'aperçu (ou mode présentation) : l'aperçu disparaît et la webcam s'éteint ; elle ne se rallume pas toute seule ensuite.
- [ ] Le Gestionnaire des tâches pendant l'aperçu : l'île reste légère (pas de processeur qui s'emballe) ; après la fermeture, plus rien ne tourne.

## 3. Choisir la caméra et le micro

- [ ] Dans l'aperçu, menu « Caméra par défaut » : une liste en verre s'ouvre (vers le haut si la place manque), dans l'île, cliquable. Choisir une autre caméra (webcam USB) : l'image change.
- [ ] Menu « Micro par défaut » : choisir un casque ; la jauge suit ce micro-là.
- [ ] Fermer, rouvrir l'aperçu : la caméra et le micro choisis sont repris.
- [ ] Débrancher la webcam choisie, rouvrir l'aperçu : celle par défaut s'ouvre ; dans le menu, l'ancienne apparaît « (débranché) ».
- [ ] Brancher une webcam pendant l'aperçu : elle apparaît dans le menu sans rien faire.

## 4. Micro coupé

- [ ] Couper le micro avec le raccourci du module Contrôles (Ctrl+Alt+M par défaut), puis « Se voir » : un cadre rouge « Votre micro est coupé » avec « Rallumer le micro » ; la jauge reste vide.
- [ ] « Rallumer le micro » : le cadre disparaît, « Micro rétabli » s'affiche, la jauge bouge de nouveau.
- [ ] Recouper le micro avec le raccourci pendant l'aperçu : le cadre réapparaît tout de suite.
- [ ] Module Contrôles désactivé : pas de cadre (on ne sait pas rallumer le micro), rien ne plante.

## 5. Image sombre

- [ ] Pendant l'aperçu, cacher la webcam avec la main ou éteindre la lumière : en une seconde ou deux, « Image sombre : ajoutez de la lumière » apparaît en bas de l'image ; rallumer : il disparaît (sans clignoter à la limite).

## 6. Sans réunion : le Lanceur

- [ ] Lanceur (Alt+Espace), taper « miroir » (ou « caméra », « webcam ») : « Se voir : caméra et micro ». Entrée : l'île montre l'aperçu titré « Miroir : votre image et votre micro », sans « Rejoindre ».
- [ ] Module Agenda désactivé : le résultat n'apparaît pas.

## 7. Réglages

- [ ] Réglages → Modules → Agenda : deux sous-menus, « Calendriers » et « Avant une réunion ».
- [ ] « Avant une réunion » : « Proposer de rejoindre la réunion », « Aperçu caméra et micro » (Au clic / Automatique / Jamais), « Caméra préférée », « Micro préféré » (menus en verre). En mode Simple : seul « Aperçu caméra et micro » reste.
- [ ] Avant tout aperçu : les menus n'ont que « par défaut » et un mot explique que la liste viendra après un premier « Se voir ». Après un aperçu autorisé (et rouvrir les Réglages) : les vrais noms des caméras et micros. Noter si c'est le cas.
- [ ] « Automatique » : à l'alerte « Réunion dans N min », l'aperçu s'ouvre tout de suite à côté de « Rejoindre » (webcam allumée sans clic).
- [ ] « Jamais » : l'alerte n'a plus que « Rejoindre ».
- [ ] Changer un de ces réglages : pastille « Modifié », « Réinitialiser », Ctrl+Z ; Ctrl+K « caméra préférée » mène à la ligne ; l'export des réglages contient `mirrorMode`, `mirrorCamera`, `mirrorMic`.
- [ ] Choisir une caméra dans l'aperçu de l'île : la page des Réglages (ouverte) suit.

## 8. Accessibilité, animations, langues

- [ ] Paramètres Windows → Accessibilité → Effets d'animation coupés : l'image arrive sans gelée, la liste des menus sans ressort.
- [ ] Performances → Économie : l'aperçu marche, les menus n'ont plus de flou.
- [ ] Thème clair (Givre) : textes et menus lisibles.
- [ ] En anglais : « See myself », « Mirror: your picture and your microphone », « Turn the microphone back on ». Au tutoiement : « Miroir : ton image et ton micro », « Image sombre : ajoute de la lumière ».
- [ ] Narrateur : la jauge est annoncée « Niveau du micro », les menus « Caméra » et « Micro ».
