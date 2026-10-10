# Tests Windows 1.2.3 : fonctions (ambiance, « … écoute », QR code, écran de veille, débit)

Coche au fur et à mesure. Si quelque chose ne marche pas : le numéro du test, ce
que tu as vu (une capture si possible) et les dernières lignes de
`%LOCALAPPDATA%\Ondine\logs\ondine.log`.

La logique est testée sur Linux (`npm test`, `cargo test`) ; ici, ce qui touche
Windows, le son, la webcam et le réseau. **Rien de tout cela n'a encore tourné
sous Windows.**

## 1. Sons d'ambiance (Minuteur → « 🌧️ Ambiance »)

- [ ] 1.1 Ouvrir le Minuteur, sous-onglet « 🌧️ Ambiance » : trois sons (Pluie, Vagues, Bruit doux), un bouton « ▶ Écouter », un curseur de volume, la case « Lancer avec le Pomodoro ».
- [ ] 1.2 Choisir « Pluie », « ▶ Écouter » : le son monte en douceur (1,5 s), ressemble à de la pluie (ruissellement + gouttes), sans clic audible toutes les 10-12 s (boucle).
- [ ] 1.3 Pendant la pluie : des gouttes glissent sur l'île, le liquide monte un peu et bouge avec le son.
- [ ] 1.4 Passer à « Vagues » pendant que ça joue : fondu enchaîné, pas de coupure sèche. Une vague monte et se retire toutes les 9 s.
- [ ] 1.5 Pendant les vagues : une vague traverse le liquide de l'île **au moment** où le son est au plus fort (pas en décalé).
- [ ] 1.6 « Bruit doux » : un souffle grave, régulier, pas désagréable au casque.
- [ ] 1.7 Bouger le curseur de volume : le son suit tout de suite, sans à-coup. Fermer et rouvrir l'île : le volume est retenu (Réglages → Minuteur → « Sons d'ambiance : volume »).
- [ ] 1.8 « ⏹ Arrêter » : le son s'éteint en ~1 s, le liquide de l'île redescend.
- [ ] 1.9 Cocher « Lancer avec le Pomodoro », lancer un Pomodoro : le son choisi part. À la pause : il s'arrête. Un son lancé à la main, lui, n'est pas arrêté par la pause.
- [ ] 1.10 Pomodoro en cours + son : le « lac de concentration » habituel ne se superpose pas au liquide du son.
- [ ] 1.11 Réglages → Animations de l'île → « Sons d'ambiance : le liquide suit… » décoché : le son joue, l'île ne bouge plus avec lui.
- [ ] 1.12 Réglage Calme, puis « Réduire les animations » de Windows : le son joue, le liquide reste calme ou immobile.
- [ ] 1.13 Désactiver le module Minuteur pendant que le son joue : le son s'arrête.
- [ ] 1.14 Aucun accès Internet pendant tout ça (Moniteur de ressources → Réseau : rien de nouveau pour Ondine).

## 2. « Alex écoute… » (Équipe, deux PC appairés)

- [ ] 2.1 Installer, ne rien toucher : Réglages → Équipe → « Partager ce que j'écoute » est **décoché**. Lancer une musique sur A : rien n'apparaît chez B.
- [ ] 2.2 Cocher le réglage sur A, jouer un morceau dans Spotify (ou Deezer, YouTube dans le navigateur) : en moins d'une minute, chez B, sous le nom de A : « ♪ A écoute « Titre » · Artiste ».
- [ ] 2.3 Mettre en pause sur A : la ligne disparaît chez B (moins d'une minute).
- [ ] 2.4 Chez B, cliquer la ligne : le navigateur ouvre la **page de recherche** du même morceau sur le même service (Spotify → open.spotify.com/search/…). Aucun compte demandé par Ondine.
- [ ] 2.5 Chez B, Réglages → Équipe → « Ouvrir le morceau d'un collègue sur » = YouTube Music : le clic ouvre music.youtube.com/search.
- [ ] 2.6 Un titre avec accents, guillemets, « & » ou « # » : la recherche est correcte.
- [ ] 2.7 A passe hors ligne : la ligne disparaît chez B.
- [ ] 2.8 **Ancienne version** : un PC en 1.2.2 appairé avec un PC en 1.2.3 qui partage : les deux restent en ligne, coucou et fichiers marchent toujours (rien n'est envoyé au 1.2.2).
- [ ] 2.9 Décocher le partage sur A : la ligne disparaît chez B.

## 3. QR code d'appairage (Équipe)

- [ ] 3.1 PC B : « 🔢 Mon code » : le code à 6 chiffres **et** un QR code s'affichent.
- [ ] 3.2 Lire ce QR avec un téléphone (appareil photo) : il contient `ondine://pair?v=1&ip=…` (rien d'autre : pas de nom, pas de clé secrète).
- [ ] 3.3 PC A : « ＋ Ajouter » : sous le formulaire, « Ou lisez son QR code : » et trois boutons.
- [ ] 3.4 « 🖥️ Lire mon écran » : le QR de B est visible sur l'écran de A (partage d'écran Teams, Bureau à distance, ou photo du QR ouverte) → « QR code lu : 192.168… » ; adresse et code sont remplis. « Ajouter » : appairage réussi.
- [ ] 3.5 Même chose sur un **deuxième écran** de A (le QR sur l'écran qui n'est pas celui de l'île).
- [ ] 3.6 « 🖥️ Lire mon écran » sans QR visible : « Aucun QR code d'Ondine à l'écran… ».
- [ ] 3.7 Capture du QR (Win+Maj+S, copiée) puis « 📋 Coller l'image » : le formulaire se remplit.
- [ ] 3.8 Copier un mot de passe depuis un gestionnaire, « 📋 Coller l'image » : refusé (contenu sensible), rien n'est lu.
- [ ] 3.9 Portable avec webcam : « 📷 Webcam » ; WebView2 demande l'autorisation la première fois ; la lumière de la caméra s'allume ; montrer l'écran de B : le formulaire se remplit et la webcam **s'éteint** tout de suite.
- [ ] 3.10 Webcam sans QR pendant une minute : elle s'éteint seule (« Webcam éteinte… »). Quitter le formulaire pendant qu'elle tourne : elle s'éteint aussi.
- [ ] 3.11 PC sans webcam, ou autorisation refusée : « Webcam indisponible ou refusée. », rien ne plante.
- [ ] 3.12 QR d'un PC C, mais adresse changée à la main vers un autre PC D avec son code : « ce n'est pas le PC du QR code » et **rien n'est ajouté**.
- [ ] 3.13 Le QR montré sur A lui-même et « Lire mon écran » sur A : son propre QR est ignoré.
- [ ] 3.14 Sans QR, le code à 6 chiffres tapé à la main marche comme avant.

## 4. Écran de veille

- [ ] 4.1 Installer : Réglages → Modules → Le PC au quotidien → « Écran de veille » est **désactivé**. Ne rien toucher 15 min : rien n'apparaît.
- [ ] 4.2 L'activer, délai 1 minute. Ne plus toucher souris et clavier : après ~1 min, l'écran de l'île devient sombre, l'heure et la date au centre, une eau bleue ondule en bas, la mascotte se promène au bord, se pose, repart.
- [ ] 4.3 Bouger la souris : l'écran de veille s'efface en moins d'une demi-seconde. L'appli qui était devant garde le clavier (taper du texte juste après : il arrive dans l'appli).
- [ ] 4.4 Toucher une touche (Maj seule) : même chose.
- [ ] 4.5 Lancer un diaporama PowerPoint (F5), attendre plus que le délai : pas d'écran de veille.
- [ ] 4.6 Une vidéo YouTube en plein écran (F11 ou bouton plein écran), sans toucher : pas d'écran de veille.
- [ ] 4.7 Appel Teams avec micro ou caméra ouverts, sans toucher : pas d'écran de veille.
- [ ] 4.8 Windows réglé pour verrouiller/éteindre l'écran après 2 min, délai Ondine 1 min : l'écran de veille apparaît à 1 min, puis Windows **verrouille et éteint quand même** à 2 min (Ondine n'empêche rien).
- [ ] 4.9 Session verrouillée (Win+L) plus longtemps que le délai, puis déverrouiller : pas d'écran de veille resté par-dessus.
- [ ] 4.10 « Afficher l'heure » décoché : plus d'heure. « Ondine se promène » décoché : elle reste assise au milieu.
- [ ] 4.11 « Réduire les animations » de Windows : eau figée, mascotte immobile, l'heure change quand même.
- [ ] 4.12 Deux écrans : l'écran de veille couvre l'écran où est l'île (l'autre écran reste tel quel — limite connue).
- [ ] 4.13 L'écran de veille n'apparaît pas dans la barre des tâches ni dans Alt+Tab.
- [ ] 4.14 Gestionnaire des tâches pendant 30 min d'écran de veille : processeur raisonnable (quelques %), mémoire stable.
- [ ] 4.15 Désactiver le module pendant qu'il est affiché : il disparaît en moins de 2 s.

## 5. Test de débit (Réseau)

- [ ] 5.1 Ouvrir l'onglet Réseau sans rien cliquer : aucune connexion vers speed.cloudflare.com (Moniteur de ressources → Réseau).
- [ ] 5.2 Cliquer « ⚡ Débit » : « Mesure de la latence… », puis « Réception… » et « Envoi… » avec le débit du moment et une barre d'avancement ; ~20 s en tout.
- [ ] 5.3 Pendant le test : une comète fait le tour du liseré de l'île et la lueur pulse ; **plus le débit monte, plus elle tourne et pulse vite**. Pas de clignotement brutal.
- [ ] 5.4 Fin : Réception, Envoi, Latence, une phrase (« Rapide : … ») et la note Cloudflare ; le liseré s'éteint avec un petit éclat.
- [ ] 5.5 Comparer avec speed.cloudflare.com dans le navigateur : ordre de grandeur proche (±20 %).
- [ ] 5.6 « ⏹ Arrêter » pendant le test : arrêt en moins d'une seconde, « Test de débit arrêté. », le liseré s'éteint.
- [ ] 5.7 Câble débranché / Wi-Fi coupé : message « speed.cloudflare.com ne répond pas… », pas de blocage.
- [ ] 5.8 Derrière un proxy d'entreprise : le test passe ou dit clairement qu'il ne peut pas.
- [ ] 5.9 Réglage Calme ou « Réduire les animations » : le liseré reste allumé mais immobile.
- [ ] 5.10 Cliquer Ping, Port ou DNS après un test : leur résultat remplace celui du débit.

## 6. Traductions

- [ ] 6.1 Langue anglaise : tous les nouveaux textes (Ambience, Speed, Listening, QR, Screensaver) sont en anglais.
- [ ] 6.2 Tutoiement : « Ou lis son QR code : », « Montre le QR code… », description de l'écran de veille au « tu ».
