<p align="center"><img src="src-tauri/icons/128x128@2x.png" width="96" alt=""></p>

<h1 align="center">Ondine</h1>

<p align="center">
<b>Une île au sommet de l'écran pour Windows 10 et 11.</b><br>
<i>A little island at the top of your Windows screen.</i>
</p>

<p align="center">
<a href="https://ondine.pissits.com"><b>ondine.pissits.com</b></a> ·
<a href="https://github.com/Naod6473/Ondine/releases/latest">Télécharger</a> ·
<a href="README.en.md"><b>English version</b></a>
</p>

<p align="center"><img src="docs/captures/fr/ile-ouverte.webp" width="776" alt="L'île d'Ondine ouverte sur l'onglet Musique, en haut de l'écran"></p>

---

Ondine vit en haut de l'écran, comme l'île dynamique d'un iPhone. Approchez la
souris : une pilule apparaît, avec Ondine, la petite goutte qui réagit à ce qui
se passe. Cliquez : l'île s'ouvre sur vos outils (musique, presse-papiers,
captures, minuteur, agenda, notes, agents IA, outils réseau…), sans changer de
fenêtre.

Gratuite, open source (MIT), **sans télémétrie**, en français et en anglais.
La vidéo de présentation est sur le site : [ondine.pissits.com](https://ondine.pissits.com).

## Sommaire

- [Nouveautés](#nouveautés)
- [Installer](#installer)
- [Premiers pas](#premiers-pas)
- [Les onglets](#les-onglets) : [Musique](#musique) · [Contrôles](#contrôles) · [Étagère](#étagère) · [Presse-papiers](#presse-papiers) · [Capture](#capture) · [Minuteur](#minuteur) · [Notes](#notes) · [Agenda](#agenda) · [Terminal](#terminal) · [Système](#système) · [Accès distants](#accès-distants) · [Réseau](#réseau) · [Agents IA](#agents-ia) · [Demander à Claude](#demander-à-claude) · [Lanceur](#lanceur) · [Règles](#règles)
- [Sans onglet : Pauses, Météo et Bilan de la semaine](#sans-onglet--pauses-météo-et-bilan-de-la-semaine)
- [Réglages](#réglages)
- [Vie privée et sécurité](#vie-privée-et-sécurité)
- [Construire depuis les sources](#construire-depuis-les-sources)
- [Licence et crédits](#licence-et-crédits)

---

## Nouveautés

Ce qui arrive dans la prochaine version (la liste complète est dans le
[CHANGELOG](CHANGELOG.md)). Cliquez sur une image pour lire le détail.

<table>
<tr>
<td width="50%" valign="top"><a href="#lanceur"><img src="docs/captures/fr/lanceur-calcul.webp" width="380" alt="Lanceur : 192.168.1.0/26 donne le nombre d'hôtes, le masque, le réseau et la première adresse"></a><br><b><a href="#lanceur">Calculs dans le Lanceur</a></b> : opérations, pourcentages, unités, octets, sous-réseaux IPv4 et heure dans une autre ville ; Entrée copie le résultat.</td>
<td width="50%" valign="top"><a href="#presse-papiers"><img src="docs/captures/fr/presse-papiers-decoder.webp" width="380" alt="Presse-papiers : un jeton JWT décodé, avec son algorithme et ses dates d'émission et d'expiration"></a><br><b><a href="#presse-papiers">Décoder une copie</a></b> : un jeton JWT, du Base64, une adresse encodée, du JSON compact ou une date Unix, lus en clair sur votre PC.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="#étagère"><img src="docs/captures/fr/etagere-telephone.webp" width="380" alt="Étagère : le QR code « Vers le téléphone » pour Présentation.pptx, qui expire dans 4:59"></a><br><b><a href="#étagère">Vers le téléphone</a></b> : un fichier de l'étagère part sur le téléphone par un QR code, sur le même Wi-Fi, sans passer par Internet.</td>
<td width="50%" valign="top"><a href="#contrôles"><img src="docs/captures/fr/onglet-controls.webp" width="380" alt="Onglet Contrôles : les pastilles Sombre et Veilleuse allumées, et une clé USB KINGSTON avec Éjecter"></a><br><b><a href="#contrôles">Sombre, Veilleuse et clés USB</a></b> : le mode sombre et l'éclairage nocturne de Windows en un clic, et «&nbsp;Éjecter&nbsp;» pour chaque clé USB branchée.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="#système"><img src="docs/captures/fr/systeme-horloges.webp" width="380" alt="Onglet Système : les horloges de Montréal (−6 h) et de Tokyo (+7 h)"></a><br><b><a href="#système">Horloges du monde</a></b> : jusqu'à 4 villes dans l'onglet Système, avec l'écart d'heure (et «&nbsp;demain&nbsp;» si le jour change).</td>
<td width="50%" valign="top"><a href="#capture"><img src="docs/captures/fr/onglet-capture.webp" width="380" alt="Onglet Capture : la nouvelle ligne GIF animé, avec Enregistrer un GIF"></a><br><b><a href="#capture">GIF animé</a></b> : une zone de l'écran filmée en GIF animé, rangée avec vos captures et posée sur l'étagère.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="#agents-ia"><img src="docs/captures/fr/agent-bilan.webp" width="347" alt="Alerte : Claude a fini, 3 fichiers modifiés, +120 −14, avec Y aller, Ouvrir dans VS Code et Terminal ici"></a><br><b><a href="#agents-ia">Quand un agent a fini</a></b> : les fichiers modifiés et «&nbsp;Ouvrir dans VS Code&nbsp;» ; dans l'onglet, «&nbsp;Reprendre&nbsp;» rouvre la dernière session.</td>
<td width="50%" valign="top"><a href="#agenda"><img src="docs/captures/fr/agenda-rejoindre.webp" width="293" alt="Alerte : Réunion dans 2 min, Revue du site, Google Meet, avec Rejoindre"></a><br><b><a href="#agenda">Rejoindre la réunion</a></b> : deux minutes avant une visio, un clic l'ouvre, met la musique en pause et prévient si le micro est coupé.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="#mises-à-jour"><img src="docs/captures/fr/quoi-de-neuf.webp" width="358" alt="Alerte : Quoi de neuf dans Ondine 1.0.1, trois nouveautés, avec Tout voir et OK"></a><br><b><a href="#mises-à-jour">Quoi de neuf</a></b> : après une mise à jour, l'île montre une fois les principales nouveautés de la version.</td>
<td width="50%" valign="top"><a href="#les-onglets"><img src="docs/captures/fr/astuce-onglet.webp" width="380" alt="Onglet Étagère vide, avec la bulle d'astuce : Glissez un fichier sur l'île pour le poser ici"></a><br><b><a href="#les-onglets">Une astuce par onglet</a></b> : la première fois qu'un onglet s'ouvre, une bulle explique son geste principal en une phrase.</td>
</tr>
</table>

Et aussi :

- **Empreinte SHA-256** : glissez un fichier sur la cible « Empreinte » ; si vous avez copié une empreinte, Ondine dit si elle est identique ([Étagère](#étagère)).
- **Réveiller un PC** à distance (Wake-on-LAN), depuis l'onglet ou le Lanceur ([Accès distants](#accès-distants)).
- **Redémarrage en attente** : l'onglet Système le signale, avec un rappel doux ([Système](#système)).
- **Bilan de la semaine** : Pomodoros terminés, temps de concentration et tâches cochées ([Sans onglet](#sans-onglet--pauses-météo-et-bilan-de-la-semaine)).

---

## Installer

1. Ouvrez la [dernière version publiée](https://github.com/Naod6473/Ondine/releases/latest)
   et téléchargez **`Ondine_<version>_x64-setup.exe`**.
2. Lancez-le. L'installateur propose le français ou l'anglais ; Ondine reprendra
   cette langue au premier lancement. Il s'installe pour votre compte seulement :
   pas besoin d'être administrateur.
3. L'installateur n'est pas signé avec un certificat de code (ces certificats
   sont payants, et Ondine est un projet gratuit). Windows affiche donc
   probablement **« Windows a protégé votre ordinateur »** (SmartScreen) :
   cliquez sur **Informations complémentaires**, puis sur **Exécuter quand
   même**. Ce message signifie seulement que Windows ne connaît pas
   l'éditeur, pas qu'un problème a été détecté.
   L'installateur est construit par GitHub Actions à partir du code public de
   ce dépôt ([release.yml](.github/workflows/release.yml)).

**Bientôt : `winget install Naod6473.Ondine`** — *pas encore disponible* : le
paquet n'a pas encore été proposé au catalogue winget de Microsoft. En
attendant, utilisez l'installateur ci-dessus.

Au premier démarrage, Ondine vous dit bonjour en haut de l'écran et explique
comment l'ouvrir. Elle se lance ensuite avec Windows (réglage
**Lancer avec Windows**).

### Mises à jour

Au démarrage puis une fois par jour, Ondine regarde sur GitHub si une nouvelle
version existe et vous la propose ; **rien ne s'installe sans votre accord**.
Vous pouvez aussi chercher tout de suite (Réglages → Général → Mises à jour →
**Rechercher maintenant**) ou couper la vérification (**Mises à jour
automatiques**). Les mises à jour sont vérifiées par une signature (clé de
mise à jour de Tauri) avant d'être installées.

Au premier démarrage après une mise à jour, l'île montre une fois **« Quoi de
neuf dans Ondine X.Y.Z »** : les trois principales nouveautés de la version
(tirées du [CHANGELOG](CHANGELOG.md), intégré à l'appli), et **Tout voir**, qui
ouvre la page de la version sur GitHub. Pour la revoir : Réglages → Général →
À propos → **Voir les nouveautés**.

<p align="center"><img src="docs/captures/fr/quoi-de-neuf.webp" width="656" alt="Alerte : Quoi de neuf dans Ondine 1.0.1, trois nouveautés, avec Tout voir et OK"></p>

### Désinstaller

Paramètres de Windows → **Applications** → **Applications installées** →
Ondine → **Désinstaller**. La désinstallation retire aussi le lancement avec
Windows. Vos réglages et notes restent dans `%APPDATA%\Ondine` et le journal
dans `%LOCALAPPDATA%\Ondine` : supprimez ces dossiers pour tout effacer. Une clé
API éventuelle se retire depuis Réglages → Identifiants (avant de désinstaller)
ou depuis le Gestionnaire d'identifiants de Windows.

---

## Premiers pas

<p align="center"><img src="docs/captures/fr/mini-ile.webp" width="396" alt="La mini-île : la pilule avec le prochain rendez-vous"></p>

| Pour… | Faites… |
|---|---|
| Faire apparaître l'île | Approchez la souris du **haut de l'écran, au centre** : un petit trait, puis la pilule (la « mini-île ») |
| Ouvrir l'île | **Cliquez** sur la pilule, ou **Ctrl+Alt+O** de n'importe où (un second appui la referme) |
| Ouvrir le lanceur | **Alt+Espace** (recherche d'applis, de fichiers, de notes…) |
| Refermer | Éloignez la souris (l'île se replie après 1,5 s), ou **Échap** |
| Changer d'onglet | Cliquez sur une icône en haut de l'île ; flèches ← → au clavier. Glissez une icône pour réordonner |
| Déposer un fichier | Glissez-le sur l'île : les cibles s'affichent (étagère, corbeille, favoris, compresser…) |
| Déplacer l'île | Attrapez-la par son bord collé à l'écran et posez-la ailleurs (haut, gauche, droite) |
| Ouvrir les réglages | Le bouton **⚙** en haut à droite de l'île, ou l'icône d'Ondine près de l'horloge (clic droit → Réglages) |
| Quitter | Icône près de l'horloge → **Quitter** |

La pilule montre ce qui compte en ce moment : le morceau qui joue, le temps du
minuteur, le prochain rendez-vous, la météo, ou une notification (un agent IA
qui a fini, un fichier téléchargé…).

<p align="center"><img src="docs/captures/fr/notification-agent.webp" width="396" alt="Notification dans la pilule : Claude a fini, avec un bouton Y aller"></p>

Quand l'île est cachée et que vous ne touchez plus au PC depuis un moment,
Ondine descend parfois du bord de l'écran, tête en bas, puis remonte (réglable
dans Réglages → Mascotte).

<p align="center"><img src="docs/captures/fr/visite.webp" width="220" alt="Ondine pendue au bord de l'écran"></p>

**Mode démo.** Réglages → Général → Captures d'écran → **Mode démo** : l'île
montre de fausses données (musique, agenda, notes, presse-papiers…) au lieu des
vôtres, et aucune action n'est faite pour de vrai. Pratique pour faire des
captures ou une démonstration ; toutes les images de cette page ont été faites
ainsi. Des boutons jouent aussi des scènes (« Claude a fini », « Fichier
téléchargé »…). Pensez à l'éteindre ensuite.

---

## Les onglets

Chaque onglet est un module. On peut les éteindre, les réordonner (Réglages →
Onglets) et régler chacun dans sa page des Réglages. Ci-dessous, les réglages
principaux de chacun, avec leur valeur par défaut.

La première fois que vous ouvrez un onglet, une petite bulle d'Ondine explique
son geste principal en une phrase (« Glissez un fichier sur l'île pour le poser
ici. ») ; **OK** la referme. Voir [Réglages → Onglets](#onglets).

### Musique

<img src="docs/captures/fr/onglet-media.webp" width="696" alt="Onglet Musique : pochette, titre, barre de progression et boutons">

Ce qui joue en ce moment (Spotify, navigateur, VLC… tout ce qui apparaît dans
le panneau multimédia de Windows) : pochette, lecture/pause, précédent,
suivant, barre de progression cliquable. Ondine lit seulement ce que Windows
expose déjà.

- **Montrer l'île quand un nouveau morceau commence** (oui)
- **Afficher le morceau dans la pilule** (oui), avec **les boutons précédent / lecture / suivant** (oui)

### Contrôles

<img src="docs/captures/fr/onglet-controls.webp" width="696" alt="Onglet Contrôles : Wi-Fi, Bluetooth, mode avion, micro, Sombre, Veilleuse, volume, luminosité, et une clé USB avec Éjecter">

Le volume des haut-parleurs et du micro, la luminosité des écrans, le Wi-Fi,
le Bluetooth et le mode avion, sans ouvrir Windows. La sortie audio se choisit
sous le curseur du son. Les écrans externes doivent accepter le réglage DDC/CI
(souvent activé dans leur menu).

Deux pastilles de plus : **Sombre** passe Windows en mode sombre ou clair
(applis et barre des tâches ensemble), **Veilleuse** allume ou éteint
l'éclairage nocturne. Si Ondine ne reconnaît pas la façon dont votre Windows
range l'éclairage nocturne, elle n'y touche pas et ouvre la page des
Paramètres à la place.

**Clés USB et disques amovibles** : quand une clé (ou un disque USB) est
branchée, une bande en bas de l'onglet la montre avec son nom, sa lettre et un
bouton **Éjecter** (la méthode « Retirer le périphérique en toute sécurité »
de Windows). Si un programme la garde ouverte, Ondine dit lequel quand Windows
le sait (par exemple WINWORD.EXE), sinon pourquoi Windows refuse.

- **Raccourci pour couper / rétablir le micro** : Ctrl+Alt+M (ou Ctrl+Maj+M, Alt+Maj+M, Pause, aucun). Il marche partout, même en visio ; Ondine porte un petit badge tant que le micro est coupé.
- **Montrer un point quand une appli utilise le micro ou la caméra** (oui) : orange pour le micro, vert pour la caméra. Rien n'est écouté : Ondine lit seulement ce que Windows note pour sa page Confidentialité.
- **Prévenir quand une clé USB est branchée** (oui) : une notification avec **Ouvrir** et **Éjecter**.

### Étagère

<img src="docs/captures/fr/onglet-shelf.webp" width="696" alt="Onglet Étagère : trois fichiers posés, avec leurs actions">

Glissez des fichiers sur l'île pour les garder sous la main. Ensuite :
les copier ou les déplacer (dossiers favoris compris), copier leur chemin, les
compresser en .zip, convertir ou réduire des images, renommer plusieurs
fichiers d'un coup (avec aperçu), les envoyer à la Corbeille, ou les faire
glisser hors de l'île vers l'Explorateur ou le Bureau (Ctrl : copier, Maj :
déplacer). Toute action sur les fichiers est annulable quelques secondes.

**📱 Vers le téléphone** (sur un fichier de l'étagère) : l'île montre un QR code ;
visez-le avec l'appareil photo du téléphone, et le navigateur du téléphone
télécharge le fichier. Le téléphone doit être sur **le même Wi-Fi** que le PC :
Ondine ouvre un tout petit serveur sur le réseau local seulement (jamais sur
Internet), qui sert ce seul fichier à une adresse secrète (un jeton au hasard de
128 bits), puis se ferme après un téléchargement complet, au bout de 5 minutes
ou sur « Arrêter ». La première fois, Windows peut demander d'autoriser Ondine
sur les **réseaux privés** : acceptez, sinon le téléphone ne trouvera pas le PC.

<img src="docs/captures/fr/etagere-telephone.webp" width="696" alt="Étagère : le QR code « Vers le téléphone » pour Présentation.pptx, son adresse sur le réseau local, Arrêter et le temps restant">

- **Dossiers favoris** : chacun devient une cible quand vous glissez des fichiers sur l'île ; **Lâcher sur un favori** copie (par défaut) ou déplace.
- **Cibles « Corbeille », « Compresser », « Images » et « Renommer »** (oui)
- **Cible « Empreinte » (SHA-256)** (oui) : glissez un fichier dessus pour calculer son SHA-256 (un ISO de plusieurs Go marche, avec **Arrêter**). Si le presse-papiers contient une empreinte (MD5, SHA-1, SHA-256 ou SHA-512, seule ou dans une liste `sha256sum` / `certutil`), le même algorithme est calculé et l'île dit **Identique ✓** (en vert) ou **Différente ✗** (en rouge). Le résultat s'affiche en entier, avec **Copier** ; 5 fichiers au plus à la fois.
- **Poser sur l'étagère chaque nouveau fichier téléchargé** (oui) : le dossier Téléchargements est regardé toutes les 3 secondes.

### Presse-papiers

<img src="docs/captures/fr/onglet-clipboard.webp" width="696" alt="Onglet Presse-papiers : historique des copies avec recherche et épinglage">

L'historique de vos copies de texte, avec recherche et épinglage ; **Coller sans
mise en forme** ; des **snippets** (vos textes fréquents) ; le bouton **Aa**
pour changer la casse ; un QR code d'une copie ; un générateur de **mots de
passe** (copiés en secret, effacés du presse-papiers au bout de 30 s, jamais
enregistrés). Les copies que Windows signale comme sensibles (gestionnaires de
mots de passe) sont ignorées. L'historique reste en mémoire et disparaît à la
fermeture ; seuls les éléments épinglés et les snippets sont enregistrés.

Un bouton apparaît sur une copie qu'il sait lire : **Décoder** pour un jeton
**JWT** (en-tête et contenu en JSON lisible, dates `iat` / `nbf` / `exp` en
clair ; la signature n'est **pas** vérifiée), du **Base64** qui donne du texte
ou une adresse encodée (`%20`) ; **Mettre en forme** pour du JSON compact ;
**Lire la date** pour un horodatage Unix (10 ou 13 chiffres). Le résultat
s'affiche dans l'onglet, avec **Copier** ; tout se fait sur votre PC, rien
n'est écrit dans le journal.

<img src="docs/captures/fr/presse-papiers-decoder.webp" width="696" alt="Presse-papiers : un jeton JWT décodé, avec l'avertissement sur la signature, l'algorithme, la date d'émission et la date d'expiration (encore valide)">

- **Nombre de copies gardées** : 50 (de 10 à 500 ; les épinglées ne comptent pas)
- **Nettoyer les liens copiés** (oui) : retire `utm_source`, `fbclid`, `gclid`… ; la notification propose de remettre l'original.

### Capture

<img src="docs/captures/fr/onglet-capture.webp" width="696" alt="Onglet Capture : texte, annoter, PNG, étagère, pipette et couleurs récentes, Enregistrer un GIF">

Capturez une zone de l'écran avec l'outil de Windows, puis :
**Texte** (le texte de l'image est lu par l'OCR de Windows, sur votre PC, hors
ligne), **Annoter** (flèche, rectangle, crayon, surligneur, texte), **PNG** (enregistrer) ou **Étagère**.
Les mêmes actions marchent sur une image déjà copiée. La **pipette** fige
l'écran sous une loupe et copie la couleur d'un point ; les dernières couleurs
restent à portée de clic.

**Enregistrer un GIF** : tracez une zone de l'écran (un simple clic prend tout
l'écran, Échap annule) ; elle est filmée à 10 images par seconde, avec un cadre
rouge autour, jusqu'à **Arrêter** ou la durée maximale. Le GIF animé va dans le
dossier des captures et sur l'étagère (**Montrer dans l'Explorateur**,
**Annuler**). Une zone de plus de 960 pixels est réduite ; l'île n'apparaît pas
sur le GIF (Windows 10 version 2004 ou plus). Pas de vidéo MP4.

- **Copier le texte lu dans le presse-papiers** (oui)
- **Dossier des captures** : `Images\Ondine` par défaut
- **Format de la couleur copiée (pipette)** : HEX (`#3A7BD5`), RGB ou HSL
- **Durée maximale d'un GIF** : 10 secondes (de 2 à 30)
- **Montrer la souris dans les GIF** (oui)

### Minuteur

<img src="docs/captures/fr/minuteur-pomodoro.webp" width="696" alt="Onglet Minuteur : Pomodoro en cours, mode concentration">

Minuteur (durées toutes prêtes, de 1 à 45 min), **Pomodoro** et **chronomètre**.
Le temps qui reste s'affiche dans la pilule, et l'île vous prévient (avec un
petit son) quand c'est fini. Depuis le lanceur, tapez « 10 min » pour lancer
un minuteur.

**Mode concentration** : pendant une séance de travail Pomodoro, les
notifications de l'île attendent (sauf les urgentes) et arrivent à la pause,
avec un résumé. Les bannières de Windows ne sont pas coupées (pour cela,
lancez une séance « Focus » dans l'appli Horloge de Windows 11).

Les séances de travail Pomodoro comptent pour le
[bilan de la semaine](#sans-onglet--pauses-météo-et-bilan-de-la-semaine).

- **Pomodoro** : travail 25 min, pause courte 5 min, pause longue 15 min toutes les 4 séances ; **enchaîner automatiquement** (oui)
- **Jouer un son à la fin** (oui), **Afficher le temps dans la pilule** (oui), **Mode concentration pendant le Pomodoro** (oui)

### Notes

<img src="docs/captures/fr/onglet-notes.webp" width="696" alt="Onglet Notes : liste de choses à faire">

Des notes rapides et une liste de choses à faire, enregistrées sur votre PC
(`%APPDATA%\Ondine\notes.json`). Supprimer propose « Annuler ». Les tâches
cochées comptent pour le
[bilan de la semaine](#sans-onglet--pauses-météo-et-bilan-de-la-semaine).

- **Rappeler les tâches à faire au démarrage** (non)

### Agenda

<img src="docs/captures/fr/onglet-agenda.webp" width="696" alt="Onglet Agenda : prochain rendez-vous avec lien Teams, puis ceux de demain">

Vos prochains rendez-vous, venant de plusieurs calendriers (jusqu'à 10), chacun
avec son nom et sa couleur : un **fichier .ics** (export d'Outlook, Google
Agenda, Thunderbird…), relu dès qu'il change, ou l'**adresse secrète iCal**
d'un agenda en ligne, retéléchargée toutes les 15 minutes. Un clic sur un
rendez-vous ouvre son lien (Teams, Meet, Zoom…). Lecture seule ; les adresses
sont rangées dans le Gestionnaire d'identifiants de Windows, jamais dans les
réglages.

Deux minutes avant une réunion en ligne (Teams, Meet, Zoom, Webex), une alerte
« Réunion dans 2 min » propose **Rejoindre** : le lien s'ouvre, la musique se
met en pause, et si votre micro est coupé (onglet Contrôles activé),
une deuxième alerte le dit, avec **Rétablir le micro**. Une seule proposition
par rendez-vous ; elle remplace le rappel s'il tombe au même moment.

<p align="center"><img src="docs/captures/fr/agenda-rejoindre.webp" width="536" alt="Alerte : Réunion dans 2 min, Revue du site, 17:15 – 18:00, Google Meet, avec Rejoindre"></p>

- **Afficher les rendez-vous des prochains** : 60 jours (7 à 365)
- **Rappel avant un rendez-vous** : 10 min (0 = jamais)
- **Proposer de rejoindre la réunion** : 2 min avant (0 = jamais, jusqu'à 30)
- **Afficher le prochain rendez-vous dans la pilule** (oui) quand il commence dans moins de 30 min
- **Récap du soir** : les rendez-vous du lendemain à 18 h (0 = jamais)

### Terminal

<img src="docs/captures/fr/onglet-terminal.webp" width="696" alt="Onglet Terminal : Windows PowerShell, cmd, pwsh, Windows Terminal, Admin">

Ouvre cmd, Windows PowerShell, PowerShell 7 ou Windows Terminal en un clic,
dans le dossier de votre choix, aussi **en administrateur**. Déposez un
dossier sur l'île pour y ouvrir un terminal. L'île ne tape jamais de commande
à votre place.

- **Terminal à ouvrir** : Windows PowerShell (par défaut), cmd, PowerShell 7, Windows Terminal
- **Dossier de départ** : votre dossier utilisateur par défaut
- **Proposer « Terminal ici » quand on dépose un dossier sur l'île** (oui)

### Système

<img src="docs/captures/fr/onglet-system.webp" width="696" alt="Onglet Système : processeur, mémoire, disque, IP, batterie, météo">

L'état du PC d'un coup d'œil : processeur, mémoire, disques, adresses IP et
MAC, batterie, version de Windows, météo (si elle est activée). **Copier pour
le support** copie un résumé à coller dans un ticket. Tout est lu sur le PC.

Quand Windows attend un redémarrage (mises à jour installées, composants de
Windows), une ligne le dit : « Redémarrage en attente depuis 3 jours (mises à
jour de Windows) », avec un bouton **Ouvrir Windows Update**. Le résumé pour
le support le mentionne aussi. Ondine ne redémarre jamais le PC elle-même.

- **Prévenir quand un disque a moins de** 10 % de place libre ; **quand la batterie descend à** 20 % ; **quand la batterie est chargée** (oui)
- **L'humeur d'Ondine suit le PC** (oui) : elle transpire quand le processeur est à fond, fatigue quand la batterie est faible ou qu'il est tard.
- **Horloges du monde** (vide) : jusqu'à 4 villes séparées par des virgules, par exemple `Montréal, Tokyo`. L'onglet montre l'heure de chacune, « demain » ou « hier » si le jour diffère, et l'écart avec ici (« +6 h »). Environ 200 grandes villes connues (noms français ou anglais, sans accents si vous voulez) et `UTC` ; une ville inconnue est signalée sous le champ. Les heures sont calculées sur le PC.
- **Rappeler un redémarrage en attente** (oui) : une notification douce, au plus une fois par jour, après un jour d'attente, jamais pendant un appel (micro utilisé) ni une présentation.

<img src="docs/captures/fr/systeme-horloges.webp" width="696" alt="Onglet Système, plus bas : les horloges de Montréal (08:02, −6 h) et de Tokyo (21:02, +7 h), puis les disques et le réseau">

### Accès distants

<img src="docs/captures/fr/onglet-remote.webp" width="696" alt="Onglet Accès distants : favoris SSH et RDP avec leur état">

Vos serveurs Bureau à distance (RDP) et SSH en favoris, ouverts en un clic
depuis l'île ou le lanceur. Enregistrés sur votre PC
(`%APPDATA%\Ondine\remote.json`), **sans aucun mot de passe**. « Tester »
vérifie seulement que le serveur répond.

**⏰ Réveiller (Wake-on-LAN)** : donnez à un favori son adresse MAC (facultatif ;
`AA:BB:CC:DD:EE:FF`, `AA-BB-…` ou `AABBCCDDEEFF` ; serveur allumé, `arp -a` la
donne). Le bouton ⏰ envoie le « paquet magique » sur le réseau local (sur chaque
carte réseau), puis teste le serveur toutes les 5 s pendant 2 min au plus : l'île
dit « NAS est réveillé » dès qu'il répond, ou qu'il ne répond toujours pas. Le
lanceur propose aussi « Réveiller NAS ». Le Wake-on-LAN doit être activé sur la
machine à réveiller (BIOS et carte réseau), sur le même réseau local.

- **Ouvrir SSH dans** : une fenêtre de console (par défaut) ou Windows Terminal
- **Bureau à distance en plein écran** (non) ; **Tester les serveurs à l'ouverture de l'onglet** (oui)

### Réseau

<img src="docs/captures/fr/onglet-nettools.webp" width="696" alt="Onglet Réseau : ping en continu avec graphique">

Ping en continu (avec un petit graphique), test d'un port (ouvert, fermé ou
bloqué, avec des raccourcis HTTPS, RDP, SSH, partage…) et recherche DNS, sans
ouvrir de console. Ondine surveille aussi Internet, les VPN et une liste de
serveurs, et prévient quand ça coupe.

- **Prévenir quand Internet coupe ou revient** (oui), **quand un VPN se coupe ou se branche** (oui)
- **Surveiller ces serveurs** : jusqu'à 10, séparés par des virgules (`nas.local, 192.168.1.10:443`), vérifiés toutes les minutes
- **Surveiller mon adresse IP publique** (non) : le seul réglage de ce module qui contacte un site extérieur (api.ipify.org, toutes les 10 min)

### Agents IA

<img src="docs/captures/fr/onglet-agents.webp" width="696" alt="Onglet Agents IA : lancer Claude Code, Codex ou Gemini CLI, Reprendre la dernière session du projet, sessions en cours">

Lance **Claude Code**, **Codex** ou **Gemini CLI** dans un de vos projets en un
clic. Un tableau montre les sessions en cours ; « Y aller » ramène devant la
bonne fenêtre, y compris dans Windows Terminal. Une fois branchés, les agents
préviennent l'île : « attend votre permission », « a fini ». Ils passent par la
commande `ondine.exe notify` et un canal local réservé à votre compte Windows :
rien ne passe par Internet, et l'île n'accepte que les messages de sa propre
copie d'`ondine.exe`.

**Reprendre** : à côté de chaque projet, ce bouton rouvre Claude Code là où
vous l'aviez laissé (`claude --continue` ; pour Codex : `codex resume --last`),
avec, en petit, la dernière phrase échangée et sa date (« il y a 2 h »). Cette
phrase est lue à la fin du fichier de session de Claude Code, sur votre PC :
elle n'est ni envoyée ni écrite dans le journal.

**Bilan de fin de tâche** : quand un agent a fini dans un dépôt git, la
notification dit ce qui a changé (« 3 fichiers modifiés, +120 −14 », et les
fichiers les plus touchés), avec **Ouvrir dans VS Code** (si VS Code est
installé) et **Terminal ici**. Ondine lance `git status` et `git diff --numstat`
en lecture seule, 3 secondes au plus ; sans git ou hors d'un dépôt, la
notification reste comme avant.

<p align="center"><img src="docs/captures/fr/agent-bilan.webp" width="636" alt="Alerte : Claude a fini, 3 fichiers modifiés, +120 −14 (index.html, style.css, README.md), avec Y aller, Ouvrir dans VS Code et Terminal ici"></p>

**Brancher un agent, en 3 étapes :**

1. Dans l'onglet Agents IA, ouvrez **Brancher Claude Code, Codex ou Gemini**,
   choisissez l'outil, puis cliquez sur **⚡ Installer automatiquement**. Ondine
   ajoute ses hooks dans le fichier de l'outil (`%USERPROFILE%\.claude\settings.json`
   pour Claude Code, `%USERPROFILE%\.codex\config.toml` pour Codex,
   `%USERPROFILE%\.gemini\settings.json` pour Gemini CLI) en gardant tout le
   reste, y compris les hooks d'autres programmes. Une copie `.bak` est faite
   avant chaque écriture, et **Retirer** enlève seulement ce qu'Ondine a ajouté.
2. Relancez l'agent, puis cliquez sur **Essayer** : une notification doit apparaître.
3. Pour **autoriser ou refuser depuis l'île** : activez le réglage
   « Autoriser / Refuser depuis l'île » (Réglages → Agents IA), puis cliquez à
   nouveau sur **Installer automatiquement**. L'agent ne demande rien en mode
   automatique (« auto mode » de Claude Code) : laissez-le en mode normal.

Si l'état affiche **Ancien chemin** (par exemple après une mise à jour ou un
déplacement d'Ondine), cliquez simplement à nouveau sur **Installer
automatiquement**. La copie à la main reste possible, sous **Ou à la main**.

En option, l'île peut aussi être branchée comme **serveur MCP** : l'agent peut
alors vous envoyer un message, sa progression, lancer le minuteur ou vous poser
une question à choix. Le bouton **Concentration** (25 min, 1 h, 2 h ou jusqu'à
l'arrêt) met leurs notifications en attente et fait un résumé à la fin.
L'île n'exécute rien de ce que les agents lui envoient (elle lance seulement
git, en lecture seule, pour le bilan), ne décide jamais à votre place, et ne lit
pas ce que vous tapez : seule la dernière phrase d'une session est montrée à
côté de « Reprendre ».

- **Projets pour les agents** : jusqu'à 8 dossiers, un bouton chacun (dans l'onglet et le lanceur)
- **Ouvrir les agents dans** : une fenêtre de console (par défaut) ou Windows Terminal
- **Proposer Claude Code / Codex / Gemini CLI** (oui)
- **Afficher la dernière phrase de la session à côté de « Reprendre »** (oui)
- **Prévenir quand Claude attend ma réponse ou ma permission** (oui), **quand Claude a fini** (oui)
- **Montrer ce qui a changé quand un agent a fini** (oui) : le bilan git ci-dessus
- **Accepter les outils MCP** (oui)
- **Autoriser / Refuser depuis l'île** (**non** par défaut) : quand Claude Code ou Codex demande la permission d'utiliser un outil, l'île montre la commande avec « Autoriser » (à confirmer) et « Refuser ». Après l'avoir activé, réinstallez les hooks (étape 3 ci-dessus). Sans réponse dans le délai choisi (1 min par défaut), la question repasse au terminal.
- **La mascotte réfléchit pendant que Claude travaille** (oui)

### Demander à Claude

<img src="docs/captures/fr/onglet-askclaude.webp" width="696" alt="Onglet Demander à Claude : ce qui part vers l'API, avant l'envoi">

Collez une erreur, ou déposez un fichier texte ou une capture sur l'île, posez
votre question : Claude répond. **Ce module envoie du contenu à l'API Claude**
(api.anthropic.com), avec **votre** clé API (Réglages → Identifiants) : avant
chaque envoi, l'île vous montre exactement ce qui part, et rien ne part sans
votre clic. Les fichiers des dossiers exclus sont refusés. La réponse est
seulement affichée : rien n'est exécuté.

- **Modèle** : Claude Sonnet 5.5 (par défaut), Claude Opus 5.5 ou Claude Haiku 4.5
- **Longueur maximale de la réponse** : 1 024 jetons
- **Consigne donnée à Claude** : vide = « Répondez en français, simplement et brièvement… » ; elle est montrée avant chaque envoi
- **Proposer « Demander à Claude » quand on dépose un fichier sur l'île** (oui)

### Lanceur

<img src="docs/captures/fr/lanceur-recherche.webp" width="696" alt="Lanceur : recherche « no » qui trouve Notes, la pipette, Claude Code et un fichier récent">

**Alt+Espace** ouvre une recherche : applications du menu Démarrer, outils
Windows (Services, Gestionnaire de périphériques…), fichiers récents, serveurs
favoris (et « Réveiller … » pour ceux qui ont une adresse MAC), projets des agents et actions de l'île (« 10 min » lance un
minuteur). Il cherche aussi **dans l'île** : notes et tâches, presse-papiers,
étagère et captures. ↑ ↓ pour choisir, Entrée pour ouvrir.

Il **calcule** aussi : quand la recherche est un calcul, la réponse vient en
premier et **Entrée la copie** (petite notification « Copié »).

<img src="docs/captures/fr/lanceur-calcul.webp" width="696" alt="Lanceur : 192.168.1.0/26 donne 62 hôtes, le masque 255.255.255.192, le réseau et la première adresse">

- Calculs : `2 + 3 × 4`, `(1,5 + 2) ^ 2`, `1 200 / 3`, `18 % de 240`, `240 + 18 %`, `15 %` (= 0,15), `racine de 2`. Nombres à la française (virgule, espaces de milliers).
- Unités : `1 Go en Mio`, `100 Mbit/s en Mo/s`, `90 min en h`, `20 °C en °F`, `10 km -> mi`, `5 lb en kg`. Octets : Ko, Mo, Go, To en puissances de 1000, Kio, Mio, Gio, Tio en 1024 (KB, MiB… aussi ; B = octet, b = bit).
- Temps de transfert : `1 Go à 100 Mbit/s` → 1 min 20 s.
- Bases : `0x1F`, `0b1010`, `255 en hex`, `0xFF en décimal`, `42 en binaire`.
- Sous-réseau IPv4 : `192.168.1.0/26` ou `192.168.1.10 255.255.255.0` → réseau, masque, première et dernière adresse, broadcast, nombre d'hôtes (Entrée sur la première ligne copie le résumé, sur une autre ligne cette valeur seule).
- Heures du monde : `15 h Montréal`, `15h30 à Tokyo` → « 15 h 00 à Montréal = 21 h 00 ici » ; `heure à Tokyo` → l'heure là-bas. Environ 200 villes connues, calculé sur le PC.
- `guid` : un GUID neuf (en minuscules, ou au format Windows `{…}` en majuscules).

- **Raccourci** : Alt+Espace (ou Ctrl+Espace, Ctrl+Alt+Espace, Ctrl+Maj+Espace, Win+Maj+Espace, aucun)
- **Proposer les fichiers ouverts récemment** (oui) ; **Chercher aussi dans l'île** (oui, 5 résultats au plus par source). Les dossiers exclus ne sont jamais montrés.

### Règles

<img src="docs/captures/fr/onglet-rules.webp" width="696" alt="Onglet Règles : ranger les PDF, clé USB branchée, historique">

Des automatisations « **Quand… alors…** ». Quand : un fichier arrive dans un
dossier (avec conditions : extensions, nom, taille), une clé USB est branchée
ou retirée, un raccourci clavier est pressé, ou un événement de l'île. Alors :
déplacer, copier, renommer, mettre à la Corbeille, poser sur l'étagère, montrer
dans l'Explorateur, ouvrir un terminal, afficher une notification, ouvrir un
onglet, lancer un minuteur, coller sans mise en forme. Des modèles sont prêts à
l'emploi. Tout déplacement propose « Annuler », rien n'est supprimé
définitivement, et **aucune règle ne peut lancer de programme**. Les règles se
créent dans Réglages → Règles ; l'onglet les montre, avec leur historique, et
peut tout mettre en pause.

---

## Sans onglet : Pauses, Météo et Bilan de la semaine

<p align="center"><img src="docs/captures/fr/mini-meteo.webp" width="396" alt="La météo dans la mini-île : 21° à Lyon"></p>

**Météo** — la température et le temps dans votre ville, dans la mini-île quand
elle n'a rien d'autre à montrer, et en détail dans l'onglet Système.
**Désactivée tant que vous ne cochez pas « Afficher la météo »** : rien ne part
sur Internet avant. Service : [Open-Meteo](https://open-meteo.com) (gratuit,
sans compte), au plus toutes les 30 minutes ; il reçoit le nom de la ville,
puis ses coordonnées arrondies (environ 1 km). Réglages : **Votre ville**
(« Lyon » ou « Lyon, FR »), **Unité** °C ou °F, **Dans la mini-île** (oui).

**Pauses** — vous rappelle de faire une petite pause après un long moment
devant l'écran (**toutes les 50 minutes d'écran** par défaut, 0 = jamais). Se
tait pendant une présentation, un appel (**Ne rien dire pendant un appel**,
oui) ou si vous venez déjà de vous arrêter. Ondine regarde seulement depuis
quand la souris et le clavier sont utilisés.

**Bilan de la semaine** — chaque semaine, une notification résume ce que vous
avez fait : **Pomodoros terminés**, **temps de concentration** (séances de
travail du Minuteur) et **tâches cochées** dans Notes, et la mascotte fait la
fête. Seulement s'il s'est passé quelque chose. Si le PC était éteint à l'heure
dite, le bilan arrive au démarrage suivant (dans les 2 jours), une seule fois
par semaine. Les compteurs restent sur votre PC (`%APPDATA%\Ondine\weekly.json`)
et ne contiennent que des nombres, jamais le texte de vos tâches. Réglages :
**Jour du bilan** (vendredi) et **Heure du bilan** (17:00) ; **Voir le bilan
maintenant** montre la semaine en cours. Pour ne plus le recevoir, désactivez
le module (Réglages → Onglets → Sans onglet).

<p align="center"><img src="docs/captures/fr/bilan-semaine.webp" width="636" alt="Alerte : Votre semaine jusqu'ici, 9 Pomodoros terminés, 3 h 35 de concentration, 14 tâches cochées"></p>

---

## Réglages

La fenêtre de réglages s'ouvre avec le bouton ⚙ de l'île ou depuis l'icône
près de l'horloge. Une recherche en haut à gauche trouve n'importe quel
réglage. Chaque module a sa page (interrupteur, permissions, description
complète, réglages).

<img src="docs/captures/fr/reglages-general.webp" width="700" alt="Réglages, page Général">

### Général

- **Langue** : Automatique (la langue choisie à l'installation, sinon celle de Windows), Français ou English
- **Lancer avec Windows** (oui)
- **Sur quel écran ?** : l'écran principal ou celui où se trouve la souris
- **Toujours en mini** (non) : l'île reste en pilule au lieu de disparaître
- **Replier l'île** après 1,5 s ; **Durée des notifications** : 6 s
- **Raccourci pour ouvrir l'île** : Ctrl+Alt+O (ou Ctrl+Maj+O, Alt+Maj+O, Ctrl+Alt+I, aucun)
- **Bord de l'écran** : en haut, à gauche ou à droite
- **Mode présentation** (oui) : pendant un diaporama, une vidéo ou un jeu en plein écran, l'île se cache et garde les notifications pour la fin
- **Mises à jour** : automatiques (oui), rechercher maintenant, version installée
- **Performances** : Performance haute, **Équilibrée** (par défaut) ou Économie d'énergie ; **Économie d'énergie automatique sur batterie** (oui)
- **Journal** : niveau et dossier (`%LOCALAPPDATA%\Ondine\logs`) ; il ne contient jamais de clé ni de contenu de fichier
- **À propos** : **Voir les nouveautés** remontre « Quoi de neuf » de la version installée ; **Signaler un problème** ouvre dans votre navigateur une issue GitHub préremplie (version, Windows, 40 dernières lignes du journal, chemins personnels masqués) ; vous relisez tout avant d'envoyer. **Ressources utilisées** : mémoire et processeur d'Ondine.
- **Captures d'écran** : le [mode démo](#premiers-pas)

### Apparence

<img src="docs/captures/fr/reglages-look.webp" width="700" alt="Réglages, page Apparence : thèmes, icônes, animations, sons">

- **Thème** : Nuit (par défaut), Océan, Prune, Forêt, Braise, Graphite, Verre, Studio, ou une **couleur personnalisée** (trop claire, l'île l'assombrit juste assez pour rester lisible)
- **Style des icônes** : **Couleur** (les icônes dessinées pour Ondine) ou **Épurées** (au trait, qui prennent la couleur du texte ; Phosphor)
- **Style des animations** : **Classique** (sobre) ou **Studio** (les éléments arrivent flous puis nets, les chiffres roulent, les boutons rebondissent)
- **Sons de clic** (oui) et leur volume ; les sons sont fabriqués sur place, sans fichier

Les animations respectent « Réduire les animations » de Windows.

### Onglets

<img src="docs/captures/fr/reglages-tabs.webp" width="700" alt="Réglages, page Onglets : ordre et activation des modules">

Activez ou désactivez chaque module, et rangez les onglets (glisser une ligne,
ou ↑ ↓ ; « Ordre d'origine » pour revenir au départ). On peut aussi glisser les
onglets directement dans l'île.

- **Astuces à la première ouverture d'un onglet** (oui) : la petite bulle qui explique le geste principal d'un onglet, la première fois seulement (jamais en mode démo ni par-dessus une alerte)
- **Revoir les astuces** : elles reviendront à la prochaine ouverture de chaque onglet

### Mascotte

Afficher ou non la mascotte, et laquelle : **Goutte** (par défaut), **Goutte
classique** ou **Goutte gomme** (on peut ajouter les siennes dans le dossier
`mascots/`, voir [mascots/README.md](mascots/README.md)). Elle **s'ennuie**,
puis **s'endort** si rien ne se passe ; elle peut venir **pendre au bord de
l'écran** (au plus une visite toutes les N minutes, jamais pendant une
présentation). Un aperçu permet d'essayer toutes ses animations.

### Profils

« Travail », « Maison »… Un profil change d'un coup les onglets affichés et leur
ordre, la couleur de l'île et « Toujours en mini ». On le choisit dans les
réglages ou dans le menu de l'icône près de l'horloge ; il peut aussi **changer
tout seul**, selon les jours et les heures, ou le nom du Wi-Fi.

### Confidentialité, Identifiants, Sauvegarde

- **Confidentialité** : le rappel de ce que l'île promet (aucune télémétrie, ce qui part vers Claude toujours montré avant) et les **dossiers exclus** : aucun module ne lira ni n'enverra un fichier situé dans ces dossiers (ni le lanceur, ni l'étagère, ni « Demander à Claude »).
- **Identifiants** : la **clé API Anthropic**, rangée dans le Gestionnaire d'identifiants de Windows. L'île peut seulement savoir si une clé existe : elle ne peut jamais la réafficher.
- **Sauvegarde** : **exporter** vos réglages dans un fichier .json (`%APPDATA%\Ondine\exports`) ou en **importer**. Les clés ne font jamais partie de l'export.

<img src="docs/captures/fr/reglages-agents.webp" width="700" alt="Réglages, page d'un module (Agents IA) : interrupteur, permissions, à propos, réglages">

---

## Vie privée et sécurité

- **Aucune télémétrie** : pas de statistiques, pas de rapport de plantage, pas de compte.
- La seule connexion automatique : une fois par jour, Ondine demande à GitHub
  s'il existe une nouvelle version (désactivable). Tout le reste (Demander à
  Claude, liens iCal, météo, IP publique, ping…) n'a lieu que si vous l'activez
  ou le demandez. La liste complète : [PRIVACY.md](PRIVACY.md).
- « Demander à Claude » envoie le texte choisi à l'API d'Anthropic, avec **votre**
  clé, seulement après vous avoir montré ce qui part.
- « Vers le téléphone » (Étagère) et « Réveiller » (Accès distants) restent sur
  le réseau local, seulement quand vous cliquez : rien ne part sur Internet.
- Les clés et liens secrets sont rangés dans le Gestionnaire d'identifiants de
  Windows, jamais en clair dans un fichier ni dans le journal.
- Rien n'est supprimé définitivement : tout passe par la Corbeille, avec une annulation.
- Vous avez trouvé une faille ? Signalez-la en privé : [SECURITY.md](SECURITY.md).

### Signature

L'installateur et `Ondine.exe` ne sont pas signés Authenticode (d'où
l'avertissement SmartScreen à l'installation). Ils sont construits uniquement par
GitHub Actions à partir de ce dépôt. Les mises à jour automatiques, elles, sont
signées (minisign) : Ondine refuse toute mise à jour dont la signature ne
correspond pas à la clé intégrée à l'application. Détails :
[CODE_SIGNING.md](CODE_SIGNING.md).

---

## Construire depuis les sources

Ondine est faite avec [Tauri 2](https://tauri.app) : Rust pour le système,
TypeScript sans framework pour l'interface.

**Prérequis (Windows 10 ou 11)**

- [Node.js](https://nodejs.org) 20 ou plus récent
- [Rust](https://rustup.rs) (stable)
- Visual Studio Build Tools avec la charge de travail **« Développement Desktop en C++ »** (outils de build MSVC)
- WebView2 (déjà présent sur Windows 11 et sur Windows 10 à jour ; sinon, le [runtime Evergreen](https://developer.microsoft.com/microsoft-edge/webview2/))

**Lancer, construire, tester**

```powershell
git clone https://github.com/Naod6473/Ondine.git
cd Ondine
npm ci                       # les dépendances, exactement celles de package-lock.json
npm.cmd run tauri dev        # l'appli complète, rechargée à chaque modification
npm.cmd run tauri build      # l'installateur : src-tauri\target\release\bundle\nsis\Ondine_<version>_x64-setup.exe
```

`src-tauri\target\release\ondine.exe` fonctionne aussi sans installation.
`npm.cmd` évite le refus de PowerShell (« l'exécution de scripts est
désactivée ») ; si `npm` marche chez vous, c'est pareil.

`npm run dev` seul ouvre l'île dans un navigateur (http://localhost:1420, et
http://localhost:1420/settings.html pour les réglages) : utile pour travailler
l'apparence, sans les fonctions Windows.

```powershell
npm run typecheck                    # TypeScript
npm test                             # tests de l'interface (île, réglages, traductions)
cd src-tauri; cargo test; cd ..      # tests Rust
```

Pour aller plus loin : [CONTRIBUTING.md](CONTRIBUTING.md) (règles du projet,
traductions, emplacement des fichiers) et
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (organisation du code, modules,
bus, réglages). Les listes de tests à la main sont dans
[docs/tests/TESTS.md](docs/tests/TESTS.md). L'historique des versions :
[CHANGELOG.md](CHANGELOG.md).

---

## Licence et crédits

Ondine est sous licence **MIT** : voir [LICENSE](LICENSE).

- Icônes « Épurées » : [Phosphor Icons](https://phosphoricons.com) (MIT).
- Astuces Win32 reprises de [Coucou](https://github.com/Louis-CFM/coucou) (MIT).
- Musique de la vidéo de présentation : *Lovely Swindler*, Amarià (CC BY 3.0).
- Tout ce qui vient d'ailleurs, avec les licences : [THIRD-PARTY.md](THIRD-PARTY.md).

Claude, Gemini et Codex sont des marques de leurs propriétaires (Anthropic,
Google, OpenAI) ; Ondine n'est affiliée à aucun d'eux.
