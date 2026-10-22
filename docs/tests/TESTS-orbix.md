# Tests Windows 1.2.5 : volume par appli, réseaux, alimentation, débit, égaliseur

À vérifier sur Windows (le conteneur Linux ne le peut pas). Résultat attendu après la flèche.

Avant de commencer : quitter **toutes** les Ondine (Gestionnaire des tâches), sinon `npm.cmd run tauri dev` s'efface et c'est l'ancienne version qui tourne.
Préparer : de la musique dans Spotify (ou le navigateur), une vidéo dans un autre onglet, un Wi-Fi déjà connu à portée.

## Où cliquer

Ouvrir l'île → onglet **Contrôles**. En bas de l'onglet, une nouvelle bande : **Applis**, **Réseaux**, puis quatre boutons ronds (cadenas, lune, flèche ronde, prise).

## Contrôles : la bande du bas

1. Onglet Contrôles, avec une clé USB branchée et le Bluetooth allumé → les cartes ne sont plus tassées : l'île grandit pour tout montrer, rien n'est coupé en bas.
2. Réglages → Contrôles → décocher « Boutons d'alimentation dans l'onglet » → les quatre boutons ronds disparaissent, Applis et Réseaux restent.

## Volume des applis

3. Cliquer **Applis** → la page glisse depuis la droite : Spotify (ou le navigateur), « Sons système », avec leur pourcentage. Une petite barre verte bouge sous le curseur de l'appli qui joue.
4. Baisser Spotify à 30 % → seul Spotify baisse, le volume général ne bouge pas. Le mélangeur de volume de Windows montre aussi 30 %.
5. Cliquer le haut-parleur de Spotify → Spotify est coupé (bouton rouge), les autres continuent. Recliquer → le son revient.
6. Lancer un son dans une nouvelle appli pendant que la page est ouverte → elle apparaît en 1 s environ. Fermer l'appli → elle disparaît.
7. Bouton retour (flèche en haut à gauche) → retour aux cartes de l'onglet.

## Réseaux Wi-Fi

8. Cliquer **Réseaux** (ou clic droit sur la pastille Wi-Fi) → la liste des Wi-Fi à portée : barres de signal, cadenas pour les réseaux protégés, le réseau actuel en premier (« Connecté »), puis les réseaux connus.
9. **Si un message parle de localisation** (Windows 11 24H2) → cliquer « Ouvrir les paramètres de localisation » : la page Windows s'ouvre. Autoriser « Permettre aux applications de bureau d'accéder à votre localisation », revenir → la liste s'affiche. Noter si Windows a demandé quelque chose de plus.
10. Sur un réseau connu (pas le réseau actuel) → « Se connecter » → le PC bascule dessus en quelques secondes, la liste le montre « Connecté ».
11. Sur le réseau actuel → « Se déconnecter » → le Wi-Fi se coupe (la pastille Wi-Fi reste allumée, sans réseau).
12. Sur un réseau jamais utilisé → bouton « Ouvrir Windows » → la liste des réseaux de Windows s'ouvre pour saisir le mot de passe. Ondine ne demande jamais de mot de passe.
13. « Autre réseau… » → même liste Windows.
14. PC sans Wi-Fi (ou carte désactivée) → un message clair, pas de liste vide muette.

## Boutons d'alimentation

15. Un simple clic sur le cadenas → rien ne se passe, un rappel dit de maintenir.
16. Maintenir le cadenas → un anneau se remplit en 1 s, puis le PC se verrouille.
17. Maintenir « Redémarrer » une demi-seconde puis lâcher → l'anneau se vide, rien ne se passe.
18. Au clavier : Tab jusqu'au bouton lune, maintenir Espace 1 s → mise en veille. (Lâcher avant annule aussi.)
19. Facultatif, en fin de test : maintenir « Éteindre » → le PC s'éteint après la notification « Arrêt en cours… ».

## Système : le débit

20. Onglet **Système** → une ligne « Débit » : « ↓ … · ↑ … », qui change chaque seconde. Lancer un gros téléchargement → la flèche du bas monte (comparer avec le Gestionnaire des tâches → Performances → Wi-Fi ou Ethernet ; un écart d'environ 10 % est normal).
21. Si le PC a Hyper-V, WSL ou un VPN → noter si le débit semble doublé.
22. Réglages → Système → cocher « Montrer le débit dans la mini-île pendant un gros téléchargement », fermer l'île, lancer un téléchargement rapide → la mini-île montre la vitesse au-delà de 1 Mo/s, puis revient à la normale 6 s après la fin.

## Musique : l'égaliseur

23. Musique qui joue, île fermée → les trois barres roses de la mini-île suivent le son : elles montent sur les coups forts, retombent dans les passages calmes, et restent basses en pause.
24. Monter le balance à gauche (Paramètres du son de Windows → Sortie → Gauche 100 / Droite 0) → la barre de gauche bouge plus que celle de droite.
25. Réglages → Musique → décocher « L'égaliseur de la mini-île suit le vrai son » → les barres reprennent leur ancienne danse automatique. Pareil en mode Économie.

## En anglais et en tutoiement

26. Réglages → Langue → English → les pages Applis et Réseaux, les boutons et le débit (« MB/s ») sont en anglais. Puis « S'adresser à moi : Tu » → plus de « vous » dans ces pages.
