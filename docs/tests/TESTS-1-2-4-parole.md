# Tests Windows 1.2.4 : la reconnaissance vocale sur le PC (zone « parole »)

Rien de ce qui suit n'a tourné sous Windows. Sous Linux, seuls les calculs
sont testés (`cargo test` : rééchantillonnage, découpage au calme, mots et
moments, tours de parole, empreintes SHA-256, catalogue des modèles ;
`npm test` : tests/front/parakeet.test.ts). Le moteur (sherpa-onnx) a été lié
et lancé sous Linux avec sa bibliothèque officielle 1.13.8, sans modèle (Hugging
Face n'est pas joignable d'ici) : jamais une vraie phrase reconnue.

## Construction (CI Windows)
- [ ] La vérification « ci » passe sur la PR : `cargo test --locked` et `cargo clippy` téléchargent d'abord la bibliothèque de sherpa-onnx (ligne « Downloading sherpa-onnx libs from https://github.com/k2-fsa/… » dans le journal de l'étape Rust). Noter le temps de l'étape « Tests Rust » avant / après.
- [ ] La construction de l'installateur (release) passe ; noter la taille de `Ondine_1.2.4_x64-setup.exe` (attendu : environ 6 Mo de plus que la 1.2.3) et de `ondine.exe` installé (environ 20 Mo de plus).
- [ ] Licences : construire une fois avec la carte d'édition de liens (`$env:RUSTFLAGS="-C link-arg=/MAP:ondine.map"; cargo build --release`), chercher « espeak » dans `ondine.map`. Rien : parfait. Des lignes : le dire (eSpeak NG est sous GPL-3.0, voir THIRD-PARTY.md).

## Rien ne part avant le clic
- [ ] Installation neuve : Réglages → Parler à Ondine → Voix et sons → bloc « Parakeet sur le PC » : « Pas encore téléchargé », « Environ 700 Mo, une seule fois. Rien n'est téléchargé avant votre clic. », un bouton « Télécharger ».
- [ ] Le dossier `%LOCALAPPDATA%\Ondine\Models` n'existe pas tant qu'on n'a pas cliqué (et le Moniteur de ressources / Réseau ne montre aucune connexion d'Ondine vers huggingface.co).
- [ ] La phrase « Tout se fait sur le PC : rien de ce que vous dites n'est envoyé… » et le crédit « Modèle Parakeet de NVIDIA (licence CC-BY-4.0), moteur sherpa-onnx (Apache-2.0) » sont sous le bloc.

## Télécharger, annuler, reprendre, supprimer
- [ ] « Télécharger » : la pastille passe à « Téléchargement : 0 % », la barre avance, « N Mo sur 700 Mo. Vous pouvez fermer les réglages, il continue. ». Un bouton « Annuler » seulement.
- [ ] Fermer la fenêtre des réglages pendant le téléchargement puis la rouvrir : le pourcentage a continué.
- [ ] « Annuler » vers 20 % : retour à « Pas encore téléchargé » ; dans `Models\parakeet-tdt-0.6b-v3-int8\`, plus aucun fichier `.part`.
- [ ] Relancer, couper le Wi-Fi vers 30 % : après un moment, « Le téléchargement a échoué » avec la raison (en petit) et « Réessayer ». Rebrancher, « Réessayer » : le pourcentage repart d'à peu près où il en était (pas de 0).
- [ ] À la fin : « Prêt », « Le modèle est sur le PC. Il se charge au premier usage (quelques secondes). », bouton « Supprimer ». Dossiers `Models\parakeet-tdt-0.6b-v3-int8` (4 fichiers, ~670 Mo) et `Models\diarizer` (2 fichiers, ~30 Mo).
- [ ] Journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) : « téléchargement des modèles demandé » puis « modèles téléchargés et vérifiés ».
- [ ] Abîmer un fichier (ouvrir `tokens.txt`, changer un caractère en gardant la même taille, enregistrer) : Parakeet le lit quand même (seule la taille est revérifiée au démarrage). Le supprimer puis « Télécharger » : il revient, vérifié.
- [ ] « Supprimer » : le bouton devient « Confirmer la suppression » ; attendre 5 s : il redevient « Supprimer ». Cliquer deux fois : retour à « Pas encore téléchargé », dossiers effacés.
- [ ] Derrière un proxy d'entreprise (si possible) : le téléchargement passe (TLS de Windows, certificats de l'entreprise).

## Parler à Ondine avec Parakeet
- [ ] Voix et sons → Reconnaissance de la voix → « Parakeet sur le PC (rien ne quitte le PC) ». L'aide du choix parle de Parakeet et du téléchargement « juste en dessous ».
- [ ] Modèle PAS téléchargé : Ctrl+Alt+V → le point rouge s'allume à peine (ou pas), puis l'erreur « La reconnaissance sur le PC a besoin du modèle Parakeet (environ 700 Mo, une seule fois) : téléchargez-le dans les Réglages. » et le bouton « ⬇️ Télécharger le modèle Parakeet ».
- [ ] Ce bouton ouvre les Réglages sur Parler à Ondine, sous-menu « Voix et sons », bloc Parakeet visible (aussi quand la fenêtre des réglages était déjà ouverte sur une autre page).
- [ ] Modèle téléchargé : Ctrl+Alt+V, dire « Quel temps fait-il demain à Lyon ? » : point rouge et niveau du micro pendant qu'on parle, arrêt au silence, « … » (transcription), puis la question écrite correctement avec sa ponctuation, envoyée comme d'habitude.
- [ ] Premier usage après le démarrage : la transcription prend quelques secondes de plus (chargement) ; les suivantes sont rapides (moins d'une seconde pour une phrase sur un PC récent). Noter les temps.
- [ ] Gestionnaire des tâches : la mémoire d'Ondine monte d'environ 700 Mo au premier usage, puis redescend 5 à 6 minutes après le dernier usage (journal : « modèle libéré »). Dans les Réglages, le bloc dit « en mémoire en ce moment » tant qu'il est chargé (rouvrir la page pour voir le changement).
- [ ] En anglais : appli en anglais, dire une phrase en anglais : bien écrite. Puis dire une phrase en espagnol ou en allemand : Parakeet la reconnaît seul (25 langues).
- [ ] Mode « Maintenir pour parler » : tant que les touches sont tenues, ça écoute ; au relâchement, le texte arrive.
- [ ] Échap pendant l'écoute : annulé, rien n'est écrit.
- [ ] Ne rien dire dans une pièce calme, bon micro : « Je n'ai rien entendu. » (ou, si le micro capte très peu, « Le micro « … » capte à peine un son… »), et rien n'est transcrit.
- [ ] Mode avion (aucun réseau) : la dictée Parakeet marche quand même.
- [ ] Moteur « Windows » choisi, dictée de Windows qui échoue (reconnaissance en ligne coupée dans Paramètres) avec le modèle Parakeet téléchargé : le bouton « 🔒 Passer à Parakeet sur le PC » apparaît ; un clic change le réglage et réécoute.
- [ ] Réglages → Parler à Ondine → Général → « Ce qui part » avec Parakeet choisi : « Quand vous parlez à Ondine, le modèle Parakeet écrit vos mots sur le PC : rien ne le quitte… ».

## Choisir le micro (Réglages → Parler à Ondine → Voix et sons → bloc « Micro »)
- [ ] Le bloc « Micro » est visible aussi en mode Simple. La liste montre « Micro par défaut de Windows (<nom>) » puis chaque micro branché, avec « · communication » pour le micro de communication par défaut (souvent le casque) quand il n'est pas celui par défaut.
- [ ] Brancher un casque USB pendant que la page est ouverte, cliquer « Actualiser » : il apparaît. Le débrancher, « Actualiser » : s'il était choisi, la ligne « Micro choisi (débranché : celui par défaut en attendant) » reste.
- [ ] « Tester le micro » avec le micro par défaut, en parlant : la barre bouge pendant ~4 s, puis « Ondine vous entend avec « <nom> » (niveau max N %). » et le format en petit (« 48000 Hz, 2 voies, virgule flottante 32 bits » par exemple). Noter le nom, le format et N.
- [ ] Même test en choisissant le casque (ou un autre micro) dans la liste : le nom du casque s'affiche, la barre bouge quand on parle dans le casque, pas quand on parle loin de lui.
- [ ] Micro coupé dans Windows (Paramètres → Système → Son → Entrée → le micro → Désactiver le son, ou volume à 0) : « Tester le micro » dit « Le micro « … » est coupé dans Windows… » (ou « Le volume du micro « … » est à 0… ») et propose « Ouvrir les paramètres du son de Windows », qui ouvre la bonne page.
- [ ] Paramètres Windows → Confidentialité → Microphone → « Autoriser les applications de bureau » coupé : « Tester le micro » donne la phrase « Windows refuse le micro… » ou « Le micro « … » ne donne aucun son : Windows le bloque peut-être… », avec un bouton vers les Paramètres Windows. Le remettre.
- [ ] Parakeet choisi + micro du casque choisi : Ctrl+Alt+V, parler dans le casque : la question est bien écrite. Journal : une ligne « écoute : micro « <nom du casque> » ouvert, 48000 Hz, … » puis « écoute : micro « … » fermé, niveau max N % en X s ». Rien de ce qui a été dit n'est dans le journal.
- [ ] Micro choisi débranché, Ctrl+Alt+V : ça marche avec celui par défaut ; journal « (micro choisi introuvable : celui par défaut de Windows) ».
- [ ] Parakeet + micro coupé dans Windows : Ctrl+Alt+V → l'île dit « Le micro « … » est coupé dans Windows… » avec « ⚙️ Ouvrir les paramètres Windows » (page Son) et « 🎙️ Choisir le micro » (ouvre les Réglages sur Voix et sons).
- [ ] Parakeet + voix faible (parler loin du micro, à voix basse) : la phrase est quand même écrite (avant : « Je n'ai rien entendu »).
- [ ] Moteur « Reconnaissance vocale de Windows » + un micro choisi qui n'est pas celui par défaut : sous la liste, l'avertissement « La reconnaissance vocale de Windows écoute toujours le micro par défaut de Windows… » avec « Ouvrir les paramètres du son de Windows » et « Passer à Parakeet ». Choisir « Micro par défaut de Windows » : l'avertissement disparaît. Passer le moteur à « Hors ligne » : il disparaît aussi.
- [ ] Moteur « Windows », micro par défaut muet (coupé) : Ctrl+Alt+V, attendre : « Le micro « … » est coupé dans Windows… » au lieu de « Je n'ai rien entendu ».
- [ ] Moteur « Hors ligne » + micro du casque choisi (pas celui par défaut) : parler dans le casque, la dictée hors ligne l'écrit (le moteur de bureau prend le micro choisi). Si ça écoute quand même le micro par défaut, noter la ligne du journal « dictée hors ligne : le micro choisi … ».
- [ ] Dictée (module Dictée, moteur Parakeet) et Notes d'appel (côté micro) : avec le casque choisi ici, ils écoutent le casque (journal : « bulles : micro « … » ouvert », « notes d'appel : micro « … » ouvert »).

## Raccourci personnalisé
- [ ] Voix et sons → « Raccourci pour parler à Ondine » : la liste propose Ctrl + Alt + V, Alt + Maj + V, Ctrl + Alt + Entrée, Aucun et « Personnalisé… ».
- [ ] « Personnalisé… » : le bouton dit « Appuyez sur la combinaison (Échap pour annuler) ». Appuyer sur Ctrl+Alt+K : « Ctrl + Alt + K » s'affiche, le raccourci marche tout de suite (dans la seconde), Ctrl+Alt+V ne fait plus rien.
- [ ] Clavier AZERTY : Ctrl+Alt+A s'affiche « Ctrl + Alt + A » et c'est bien la touche A qui déclenche (pas Q).
- [ ] Pendant l'enregistrement, Échap annule (l'ancien raccourci reste). « Effacer » retire le raccourci (plus aucun).
- [ ] Refusés avec une phrase sous le champ, sans rien changer : K seul, Maj+K, Alt+F4, Ctrl+C, Ctrl+Alt+Suppr (Windows l'avale sans doute : rien ne se passe), Win+L (idem). F9 seul est accepté ; F12 seul est refusé.
- [ ] Un raccourci déjà pris par un autre logiciel (par exemple celui d'un logiciel de capture, ou Ctrl+Alt+V réglé dans un autre outil) : dans les 2 s, sous le champ, « Ctrl + Alt + … est déjà pris par un autre logiciel : choisissez un autre raccourci… ». Choisir un autre raccourci : la phrase disparaît.
- [ ] « Raccourci « Regarde ça » » : même champ, mêmes règles ; le même raccourci que pour parler est ignoré pour « Regarde ça ».
- [ ] Réglage enregistré, fermer et rouvrir Ondine : le raccourci personnalisé marche toujours.

## « Dis Ondine » (mot d'appel)
- [ ] Mode Complet, Voix et sons → bloc « « Dis Ondine » » : l'interrupteur est COUPÉ ; la ligne dit « Coupé : le micro ne s'ouvre qu'avec le raccourci ou le bouton 🎙️. » ; aucun point rouge sur l'île, Windows ne montre pas le micro utilisé par Ondine.
- [ ] Sans le modèle Parakeet : l'interrupteur est grisé et la ligne renvoie au bloc « Parakeet sur le PC ».
- [ ] Modèle téléchargé, allumer : un encadré explique (micro ouvert en permanence, tout sur le PC, rien d'enregistré ni d'envoyé avant le mot, point rouge, pauses). « Annuler » : rien ne change. « Activer l'écoute permanente » : la ligne passe à « À l'écoute du mot d'appel… » ; un petit point rouge apparaît à côté de l'île (taille normale et mini) ; l'icône micro de Windows montre Ondine.
- [ ] Dire « Dis Ondine » (pause) : Parler à Ondine s'ouvre et écoute ; dire la question : elle part comme d'habitude.
- [ ] Dire d'une traite « Hey Ondine, quel temps fait-il demain ? » : l'onglet s'ouvre et la question « Quel temps fait-il demain ? » part directement.
- [ ] Essayer aussi « Hé Ondine », « OK Ondine », et en anglais « Hey Ondine ». Noter ceux qui ne marchent pas.
- [ ] Parler normalement 5 minutes sans dire le mot (ou une vidéo qui parle) : rien ne se déclenche. Noter toute fausse alerte (ce qui a été dit).
- [ ] Au repos, silence : le Gestionnaire des tâches montre un processeur ~0 % pour Ondine ; la mémoire ne monte de ~700 Mo qu'après la première phrase entendue (Parakeet chargé), et redescend 5 à 6 min après la dernière.
- [ ] Pauses : lancer une visio (Teams / Zoom / Meet qui prend le micro) → la ligne dit « En pause : discrétion… », le point rouge disparaît ; raccrocher → il revient. Pareil avec un diaporama PowerPoint en plein écran, Win+L (verrouillé), le mode Économie d'énergie (Réglages → Performances), et pendant une dictée ou des notes d'appel (« Ondine écoute déjà »).
- [ ] Couper l'interrupteur : le point rouge disparaît dans la seconde, Windows ne montre plus Ondine sur le micro.
- [ ] Journal : « mot d'appel : micro « … » ouvert », « mot d'appel reconnu », jamais ce qui a été dit.

## Parler à Ondine : un affichage fluide (branche fluide)
Avec chaque moteur (Parakeet, dictée de Windows, hors ligne, API si une clé est rangée). Réglages par défaut (« Agrandir l'île avec la conversation » activé), puis refaire les cases marquées ⟳ avec ce réglage coupé.
- [ ] Vos mots en direct (dictée de Windows, hors ligne, et maintenant Parakeet) : la bulle pointillée prend toute sa largeur dès le début ; les mots déjà écrits ne bougent plus quand un mot s'ajoute ; chaque nouveau mot apparaît en fondu doux (léger flou qui s'éclaircit), sans clignotement de toute la vue ni du champ « Écrire à Ondine… ».
- [ ] Quand le moteur se reprend (fin de phrase réécrite, ex. « il » → « île en ») : l'ancien mot s'efface pendant que le nouveau apparaît au même endroit (fondu croisé), sans saut.
- [ ] Une phrase longue qui passe à la ligne : la bulle grandit en glissant (≈ ¼ s), l'île grandit avec elle, en douceur, sans à-coups ni rebonds répétés. ⟳
- [ ] Parakeet : des mots s'écrivent maintenant PENDANT que vous parlez (environ chaque seconde), pas seulement à la fin. Le texte envoyé reste la transcription complète de la fin (s'il diffère un peu des mots en direct, la différence passe en fondu).
- [ ] Parakeet : pendant une pause dans la phrase, rien ne bouge ; le premier mot en direct peut tarder 2 à 3 s la première fois (le modèle se charge), ensuite ~1 s.
- [ ] Parakeet, Gestionnaire des tâches : pendant que vous parlez, le processeur d'Ondine monte (noter le pourcentage, attendu : nettement moins de la moitié du PC) ; il retombe à ~0 % dès que vous vous taisez. Noter le modèle de processeur.
- [ ] Parakeet + Réglages → Performances → Économie : plus de mots en direct (seulement le texte final), comme avant.
- [ ] Fin de l'écoute : le point rouge s'arrête et « Parlez, je m'arrête… » s'efface en douceur dès « J'écris ce que vous avez dit… » (le libellé change en fondu).
- [ ] La bulle en direct devient votre message SANS clignoter : le pointillé s'efface, la bulle se resserre à la taille du texte en glissant, le texte remonte en douceur ; « Bonjour ! Je suis Ondine… » (premier message) s'efface sans faire sauter le reste ; les trois gouttes « Ondine réfléchit » arrivent puis s'effacent.
- [ ] Pendant l'échange (vous parlez → Ondine répond), l'île ne fait pas le yoyo : elle peut grandir, elle ne rétrécit qu'une fois, à la fin, si la réponse est courte. ⟳
- [ ] La réponse d'Ondine s'écrit à un rythme régulier, lettre par lettre (plus de paquets de lettres), chaque lettre en fondu ; un mot ne saute jamais à la ligne en s'écrivant (il est déjà à sa place). Les « plop » et la bouche suivent comme avant.
- [ ] Réponse plus longue que la place (réglage coupé, ou 2e/3e question) : la conversation défile vers le bas en glissant, sans sauter à chaque lettre. Remonter avec la molette pendant qu'elle écrit : elle ne vous ramène pas en bas ; redescendre tout en bas : elle suit de nouveau. ⟳
- [ ] Une commande rapide avec un chiffre (« volume 30 ») : la réponse « Volume réglé à 30 % » s'écrit sans que les chiffres « roulent » à chaque lettre.
- [ ] Ondine sur le bureau avec l'onglet Parler à Ondine dans sa bulle : même fluidité dans sa bulle.
- [ ] Windows → Accessibilité → Effets visuels → « Effets d'animation » coupés : vos mots et la réponse s'affichent tout de suite, sans aucun fondu ni glissement, le défilement va en bas d'un coup ; tout marche.
- [ ] Mascotte « Calme » : pareil (affichage direct, réponse en une fois).
- [ ] Mode Économie : tout reste fluide mais sans flou sur les mots ; la réponse s'écrit à ~30 images par seconde.
- [ ] Ouvrir l'onglet pendant une conversation déjà là : on arrive en bas de la conversation, sans défilement animé.

## Textes
- [ ] « S'adresser à moi » = tutoiement : « Rien n'est téléchargé avant ton clic », « rien de ce que tu dis n'est envoyé », « télécharge-le dans les Réglages ».
- [ ] Tutoiement : « Appuie sur la combinaison », « Parle quelques secondes… », « Ondine t'entend avec « … » », « tant que tu n'as pas dit « Dis Ondine » ».
- [ ] Langue anglaise : « Test the microphone », « Record a shortcut », « Custom… », « Ctrl + Shift + K » (Shift, pas Maj), « « Hey Ondine » to talk to her ».
- [ ] Langue anglaise : tout le bloc est en anglais (« Not downloaded yet », « Downloading: 42% », « Download », « Cancel », « Delete », « Confirm deletion »). Seul le détail technique d'un échec reste en français.
