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
- [ ] Ne rien dire : « Je n'ai rien entendu. », et rien n'est transcrit.
- [ ] Mode avion (aucun réseau) : la dictée Parakeet marche quand même.
- [ ] Moteur « Windows » choisi, dictée de Windows qui échoue (reconnaissance en ligne coupée dans Paramètres) avec le modèle Parakeet téléchargé : le bouton « 🔒 Passer à Parakeet sur le PC » apparaît ; un clic change le réglage et réécoute.
- [ ] Réglages → Parler à Ondine → Général → « Ce qui part » avec Parakeet choisi : « Quand vous parlez à Ondine, le modèle Parakeet écrit vos mots sur le PC : rien ne le quitte… ».

## Textes
- [ ] « S'adresser à moi » = tutoiement : « Rien n'est téléchargé avant ton clic », « rien de ce que tu dis n'est envoyé », « télécharge-le dans les Réglages ».
- [ ] Langue anglaise : tout le bloc est en anglais (« Not downloaded yet », « Downloading: 42% », « Download », « Cancel », « Delete », « Confirm deletion »). Seul le détail technique d'un échec reste en français.
