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

- [Installer](#installer)
- [Premiers pas](#premiers-pas)
- [Les onglets](#les-onglets) : [Musique](#musique) · [Contrôles](#contrôles) · [Étagère](#étagère) · [Presse-papiers](#presse-papiers) · [Capture](#capture) · [Minuteur](#minuteur) · [Notes](#notes) · [Agenda](#agenda) · [Terminal](#terminal) · [Système](#système) · [Accès distants](#accès-distants) · [Réseau](#réseau) · [Agents IA](#agents-ia) · [Demander à Claude](#demander-à-claude) · [Lanceur](#lanceur) · [Règles](#règles)
- [Sans onglet : Pauses et Météo](#sans-onglet--pauses-et-météo)
- [Réglages](#réglages)
- [Vie privée et sécurité](#vie-privée-et-sécurité)
- [Construire depuis les sources](#construire-depuis-les-sources)
- [Licence et crédits](#licence-et-crédits)

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

### Musique

<img src="docs/captures/fr/onglet-media.webp" width="696" alt="Onglet Musique : pochette, titre, barre de progression et boutons">

Ce qui joue en ce moment (Spotify, navigateur, VLC… tout ce qui apparaît dans
le panneau multimédia de Windows) : pochette, lecture/pause, précédent,
suivant, barre de progression cliquable. Ondine lit seulement ce que Windows
expose déjà.

- **Montrer l'île quand un nouveau morceau commence** (oui)
- **Afficher le morceau dans la pilule** (oui), avec **les boutons précédent / lecture / suivant** (oui)

### Contrôles

<img src="docs/captures/fr/onglet-controls.webp" width="696" alt="Onglet Contrôles : Wi-Fi, Bluetooth, mode avion, volume, micro, luminosité">

Le volume des haut-parleurs et du micro, la luminosité des écrans, le Wi-Fi,
le Bluetooth et le mode avion, sans ouvrir Windows. La sortie audio se choisit
sous le curseur du son. Les écrans externes doivent accepter le réglage DDC/CI
(souvent activé dans leur menu).

- **Raccourci pour couper / rétablir le micro** : Ctrl+Alt+M (ou Ctrl+Maj+M, Alt+Maj+M, Pause, aucun). Il marche partout, même en visio ; Ondine porte un petit badge tant que le micro est coupé.
- **Montrer un point quand une appli utilise le micro ou la caméra** (oui) : orange pour le micro, vert pour la caméra. Rien n'est écouté : Ondine lit seulement ce que Windows note pour sa page Confidentialité.

### Étagère

<img src="docs/captures/fr/onglet-shelf.webp" width="696" alt="Onglet Étagère : trois fichiers posés, avec leurs actions">

Glissez des fichiers sur l'île pour les garder sous la main. Ensuite :
les copier ou les déplacer (dossiers favoris compris), copier leur chemin, les
compresser en .zip, convertir ou réduire des images, renommer plusieurs
fichiers d'un coup (avec aperçu), les envoyer à la Corbeille, ou les faire
glisser hors de l'île vers l'Explorateur ou le Bureau (Ctrl : copier, Maj :
déplacer). Toute action sur les fichiers est annulable quelques secondes.

- **Dossiers favoris** : chacun devient une cible quand vous glissez des fichiers sur l'île ; **Lâcher sur un favori** copie (par défaut) ou déplace.
- **Cibles « Corbeille », « Compresser », « Images » et « Renommer »** (oui)
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

- **Nombre de copies gardées** : 50 (de 10 à 500 ; les épinglées ne comptent pas)
- **Nettoyer les liens copiés** (oui) : retire `utm_source`, `fbclid`, `gclid`… ; la notification propose de remettre l'original.

### Capture

<img src="docs/captures/fr/onglet-capture.webp" width="696" alt="Onglet Capture : texte, annoter, PNG, étagère, pipette et couleurs récentes">

Capturez une zone de l'écran avec l'outil de Windows, puis :
**Texte** (le texte de l'image est lu par l'OCR de Windows, sur votre PC, hors
ligne), **Annoter** (flèche, rectangle, crayon, surligneur, texte), **PNG** (enregistrer) ou **Étagère**.
Les mêmes actions marchent sur une image déjà copiée. La **pipette** fige
l'écran sous une loupe et copie la couleur d'un point ; les dernières couleurs
restent à portée de clic.

- **Copier le texte lu dans le presse-papiers** (oui)
- **Dossier des captures** : `Images\Ondine` par défaut
- **Format de la couleur copiée (pipette)** : HEX (`#3A7BD5`), RGB ou HSL

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

- **Pomodoro** : travail 25 min, pause courte 5 min, pause longue 15 min toutes les 4 séances ; **enchaîner automatiquement** (oui)
- **Jouer un son à la fin** (oui), **Afficher le temps dans la pilule** (oui), **Mode concentration pendant le Pomodoro** (oui)

### Notes

<img src="docs/captures/fr/onglet-notes.webp" width="696" alt="Onglet Notes : liste de choses à faire">

Des notes rapides et une liste de choses à faire, enregistrées sur votre PC
(`%APPDATA%\Ondine\notes.json`). Supprimer propose « Annuler ».

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

- **Afficher les rendez-vous des prochains** : 60 jours (7 à 365)
- **Rappel avant un rendez-vous** : 10 min (0 = jamais)
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

- **Prévenir quand un disque a moins de** 10 % de place libre ; **quand la batterie descend à** 20 % ; **quand la batterie est chargée** (oui)
- **L'humeur d'Ondine suit le PC** (oui) : elle transpire quand le processeur est à fond, fatigue quand la batterie est faible ou qu'il est tard.

### Accès distants

<img src="docs/captures/fr/onglet-remote.webp" width="696" alt="Onglet Accès distants : favoris SSH et RDP avec leur état">

Vos serveurs Bureau à distance (RDP) et SSH en favoris, ouverts en un clic
depuis l'île ou le lanceur. Enregistrés sur votre PC
(`%APPDATA%\Ondine\remote.json`), **sans aucun mot de passe**. « Tester »
vérifie seulement que le serveur répond.

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

<img src="docs/captures/fr/onglet-agents.webp" width="696" alt="Onglet Agents IA : lancer Claude Code, Codex ou Gemini CLI, sessions en cours, derniers messages">

Lance **Claude Code**, **Codex** ou **Gemini CLI** dans un de vos projets en un
clic. Un tableau montre les sessions en cours ; « Y aller » ramène devant la
bonne fenêtre. Une fois branchés (bloc **Brancher Claude Code, Codex ou Gemini**
en bas de l'onglet : un bouton copie la configuration à coller, puis
**Essayer**), les agents préviennent l'île : « attend votre permission », « a
fini ». Ils passent par la commande `ondine.exe notify` et un canal local
réservé à votre compte Windows : rien ne passe par Internet.

En option, l'île peut aussi être branchée comme **serveur MCP** : l'agent peut
alors vous envoyer un message, sa progression, lancer le minuteur ou vous poser
une question à choix. Le bouton **Concentration** (25 min, 1 h, 2 h ou jusqu'à
l'arrêt) met leurs notifications en attente et fait un résumé à la fin.
L'île n'exécute jamais rien, ne décide jamais à votre place, et ne lit ni ce que
vous tapez ni les réponses de l'IA.

- **Projets pour les agents** : jusqu'à 8 dossiers, un bouton chacun (dans l'onglet et le lanceur)
- **Ouvrir les agents dans** : une fenêtre de console (par défaut) ou Windows Terminal
- **Proposer Claude Code / Codex / Gemini CLI** (oui)
- **Prévenir quand Claude attend ma réponse ou ma permission** (oui), **quand Claude a fini** (oui)
- **Accepter les outils MCP** (oui)
- **Autoriser / Refuser depuis l'île** (**non** par défaut) : quand Claude Code ou Codex demande la permission d'utiliser un outil, l'île montre la commande avec « Autoriser » (à confirmer) et « Refuser ». Il faut aussi coller le hook d'autorisation. Sans réponse dans le délai choisi (1 min par défaut), la question repasse au terminal.
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
favoris, projets des agents et actions de l'île (« 10 min » lance un
minuteur). Il cherche aussi **dans l'île** : notes et tâches, presse-papiers,
étagère et captures. ↑ ↓ pour choisir, Entrée pour ouvrir.

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

## Sans onglet : Pauses et Météo

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
- **À propos** : **Signaler un problème** ouvre dans votre navigateur une issue GitHub préremplie (version, Windows, 40 dernières lignes du journal, chemins personnels masqués) ; vous relisez tout avant d'envoyer. **Ressources utilisées** : mémoire et processeur d'Ondine.
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
