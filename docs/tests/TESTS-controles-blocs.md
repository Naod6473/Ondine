# Tests Windows 1.2.5 : Contrôles en blocs, Écrans, mode nettoyage, aide-mémoire

À vérifier sur Windows (le conteneur Linux ne le peut pas). Résultat attendu après la flèche.
Avant de commencer : quitter TOUTES les Ondine (Gestionnaire des tâches), sinon `npm.cmd run tauri dev` s'efface et c'est l'ancienne version qui reste.
Préparer si possible : un deuxième écran, une clé USB, un appareil Bluetooth, Excel ou Word.

## L'accueil de l'onglet

1. Ouvrir Contrôles → à gauche Connexions (Wi-Fi, Bluetooth, Avion, Micro, « Tout › »), au milieu les piliers Son et Écrans, à droite quatre blocs Écrans, Appareils, Outils, Alimentation avec leur sous-titre (mode d'affichage, « 1 USB · 2 Bluetooth », « 4 outils », « Maintenir 1 s »). Rien n'est coupé.
2. Les pastilles s'allument et s'éteignent d'un clic comme avant ; clic droit sur Wi-Fi → la liste des réseaux.
3. Glisser les piliers Son et Écrans → le volume et la luminosité changent ; la molette sur l'île règle toujours le volume.
4. Brancher une clé USB → elle apparaît en bas de l'accueil, « Éjecter » marche. Un appareil Bluetooth sous le seuil des Réglages → pastille rouge « Batterie faible » en bas.
5. Cliquer un bloc → la page s'ouvre en partant du bloc cliqué, le bouton ‹ revient à l'accueil. Tester les quatre blocs, « Tout › » et « Son › ».

## Les pages

6. « Son › » → choix de la sortie audio (haut-parleurs, casque…), volume des haut-parleurs et du micro (couper/réactiver), volume de chaque appli qui joue (le niveau vert bouge).
7. « Tout › » → les Wi-Fi à portée, « Se connecter » sur un réseau connu, « Ouvrir Windows » sur un nouveau.
8. Appareils → clés USB (éjecter) et batteries Bluetooth.
9. Outils → « Épingler » garde la fenêtre d'avant au premier plan (second appui la relâche) ; « Cacher les icônes du bureau » puis les réafficher.
10. Alimentation → Verrouiller : maintenir 1 s, l'anneau se remplit, le PC se verrouille. Lâcher avant → rien. (Veille, Redémarrer, Éteindre : au moins un essai de lâcher avant.)
11. Réglages → Contrôles → décocher « Boutons d'alimentation dans l'onglet » → le bloc Alimentation disparaît, les trois autres se rangent.

## Écrans

12. Bloc Écrans avec un seul écran → « PC seul » actif, les autres grisés, phrase « branchez-en un second ».
13. Avec deux écrans : cliquer Dupliquer, puis Étendre, puis « 2e écran seul », puis « PC seul » → Windows change comme avec Windows+P ; le bouton allumé suit, le sous-titre du bloc aussi.
14. Écran principal : cliquer le dessin de l'autre écran → il devient principal (la barre des tâches y passe), notification « … est l'écran principal ». Les écrans sont dessinés à l'échelle, dans l'ordre gauche-droite.
15. Luminosité : une ligne par écran réglable (écran externe : DDC/CI), le curseur change la luminosité.
16. Sombre et Veilleuse marchent depuis cette page.
17. « Éteindre seulement l'écran » → l'écran s'éteint après une demi-seconde, la musique continue ; bouger la souris → il se rallume.

## Mode nettoyage

18. Outils → Mode nettoyage → « Lancer (30 s) » → Ondine passe le chiffon, compte à rebours ; clavier et souris ne répondent plus (taper, cliquer, molette).
19. À la fin → notification « C'est propre ! », clavier et souris reviennent.
20. Relancer, puis maintenir Échap 2 secondes → arrêt avant la fin, « Nettoyage arrêté ».
21. Relancer, puis Ctrl+Alt+Suppr → l'écran de Windows s'affiche (Windows ne laisse pas bloquer ça) ; en revenant, le nettoyage continue ou s'est arrêté, mais le clavier n'est jamais bloqué au-delà du temps.
22. Réglages → Contrôles → Durée du mode nettoyage à 10 → le bouton dit « Lancer (10 s) » et ça dure 10 s.

## Aide-mémoire des raccourcis

23. Dans Excel, maintenir Ctrl gauche seul 1,5 s → l'île s'ouvre sur l'aide-mémoire, onglet « Excel ». Relâcher Ctrl → elle se referme.
24. Même chose dans l'Explorateur, Word, Chrome ou Edge, VS Code → la bonne liste. Dans une appli inconnue → « Cette appli » avec les raccourcis presque universels.
25. Pendant l'appui, cliquer « Garder ouvert » → relâcher Ctrl ne la ferme plus ; ‹ pour revenir.
26. Ctrl+C, Ctrl+V, Ctrl+clic, Ctrl+molette (zoom) → rien ne s'ouvre. Ctrl droit maintenu → toujours la dictée, pas l'aide-mémoire.
27. Onglets Windows et Ondine, puis taper « capture » dans Filtrer → seule la ligne Win+Maj+S reste.
28. Réglages → Contrôles → Aide-mémoire des raccourcis → « Désactivé » → Ctrl gauche maintenu n'ouvre plus rien ; Outils → Aide-mémoire → « Ouvrir » marche encore.
29. L'interface en anglais → les touches s'écrivent Shift, Enter, Esc, Space.

## Ailleurs

30. Mode Économie, « Réduire les animations » → les pages s'ouvrent en fondu court, le chiffon ne bouge plus.
31. Style Encoche et style Studio → les blocs et les pages restent lisibles.
32. Échelle 125 % et 150 % → rien n'est coupé, l'île grandit avec les pages.
