# Tests Windows 1.2.3 : dictée hors ligne, pancarte, pont de fichier, nouvel appareil

Rien de cette liste n'a tourné sous Windows : le code Windows a seulement été
compilé (clippy, cible Windows). À vérifier en premier : la dictée hors ligne
(le moteur SAPI de bureau existe-t-il encore sur ce Windows 11 ?).

## Dictée 100 % hors ligne (Parler à Ondine)
- [ ] Réglages → Parler à Ondine → Voix et sons → Reconnaissance de la voix : le choix « Hors ligne (rien ne quitte le PC) » est là, entre « Reconnaissance vocale de Windows » et « Transcription par l'API ».
- [ ] Choisir « Hors ligne », Ctrl+Alt+V, dire « Quel temps fait-il demain ? » : les mots s'écrivent en direct sous le micro, l'écoute s'arrête seule environ 1 s après la fin de la phrase, la question part à Ondine.
- [ ] Même chose avec le Wi-Fi coupé (ou le câble débranché) : la dictée marche quand même (seule la réponse de l'IA échoue, comme attendu).
- [ ] Paramètres Windows → Confidentialité → Voix → « Reconnaissance vocale en ligne » coupée : la dictée hors ligne marche toujours.
- [ ] Ctrl+Alt+V puis ne rien dire : « Je n'ai rien entendu. » au bout de quelques secondes, rien n'est envoyé.
- [ ] Ctrl+Alt+V, commencer à parler, Échap : tout est annulé, le point rouge disparaît.
- [ ] Ctrl+Alt+V, parler, 2e appui sur Ctrl+Alt+V avant la fin : la phrase en cours est gardée.
- [ ] Mode du micro « Maintenir pour parler » : tenir Ctrl+Alt+V, dire deux phrases avec une pause, relâcher : les deux phrases sont gardées.
- [ ] Le halo de l'île tremble avec la voix pendant l'écoute hors ligne.
- [ ] Langue de l'appli English : la dictée hors ligne écoute en anglais (si la reconnaissance vocale anglaise est installée).
- [ ] Journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) : une ligne « dictée hors ligne (Microsoft Speech Recognizer …) », jamais le texte dit.
- [ ] Sur un PC sans la reconnaissance vocale du français (ou après l'avoir retirée) : le message « la dictée hors ligne a besoin de la reconnaissance vocale du français, installée sur ce PC : Paramètres Windows → Heure et langue → Langue et région → Français (France) → Options de langue → Reconnaissance vocale → Télécharger… » s'affiche ; le bouton « ⚙️ Ouvrir les paramètres Windows » ouvre Langue et région.
- [ ] Suivre le chemin du message dans Paramètres Windows : il existe bien tel quel sur ce Windows (noter les écarts de libellé).
- [ ] En hors ligne, quand ça échoue, aucun bouton « Passer à la transcription par l'API » n'apparaît.
- [ ] Revenir à « Reconnaissance vocale de Windows », couper « Reconnaissance vocale en ligne » dans Windows, Ctrl+Alt+V : l'erreur propose « 🔒 Passer à la dictée hors ligne » ; un clic change le réglage et réécoute tout de suite, la dictée marche.
- [ ] Réglages → Parler à Ondine → Général → « Ce qui part » : en hors ligne, la phrase dit que rien ne quitte le PC ; sans le moteur, elle dit où l'installer.
- [ ] Micro refusé aux applications de bureau (Confidentialité → Microphone) : message du micro et bouton vers la bonne page.
- [ ] Une visio qui prend le micro (Teams) : la discrétion bloque toujours l'écoute hors ligne.
- [ ] Qualité : dicter 5 phrases courantes et noter combien sont justes (pour comparer avec la dictée en ligne).

## Pancarte d'Ondine
- [ ] Onglet Équipe (module activé), Mon statut → « En réunion » : Ondine lève au-dessus de sa tête une pancarte en bois clair « En réunion », la planche monte avec un petit rebond de gelée, puis redescend au bout de 6 s.
- [ ] « Concentration » → « Occupé » ; « Absent » → « Pause » ; « Disponible » ou « Automatique » → pas de pancarte.
- [ ] Un clic sur Ondine pendant qu'elle tient la pancarte : elle la baisse tout de suite (sans autre réaction).
- [ ] Règle avec l'action Mascotte → « Une pancarte avec un texte », texte « Pause café » : la pancarte s'affiche avec ce texte (plus de notification 🪧 avec la goutte gomme). L'aide sous le champ parle des 14 caractères.
- [ ] Texte long (« Réunion très importante ») : « Réunion très… », la planche ne sort pas du dessin, le texte reste lisible.
- [ ] Un agent IA pose une question pendant la pancarte : le « ? » remplace le mot ; une fois la question réglée, le mot revient s'il reste du temps.
- [ ] Mascotte « poses » (pas gomme) : l'action de règle montre la notification 🪧 avec le texte, et le « ? ».
- [ ] « Réduire les animations » de Windows : la pancarte apparaît et disparaît sans mouvement.
- [ ] Langue English : la pancarte du statut dit « In a meeting » / « Busy ».
- [ ] Mini-île, île en bas de l'écran, île sur un côté : la pancarte reste visible et entière.

## Pont de fichier à travers l'île (Équipe)
- [ ] Deux PC appairés : glisser un fichier sur l'île, le lâcher sur la cible du collègue : une petite feuille bleue plonge dans l'île, s'écrase un peu, file vers la droite et ressort ; un rond à la couleur du collègue s'allume au bord droit puis s'éteint. Notification « Proposé » comme avant.
- [ ] Chez le collègue : l'acceptation est toujours demandée ; une fois le fichier reçu, la feuille entre par la gauche de son île et se pose au milieu, puis disparaît en fondu.
- [ ] Pendant le passage, un clic sur l'île ou un nouveau glisser : l'animation s'arrête net, rien ne reste affiché.
- [ ] Deux envois de suite : une seule feuille à la fois.
- [ ] Cible du chat à deux (💬 Prénom) : même animation.
- [ ] Envoi refusé (fichier trop gros, collègue hors ligne) : pas d'animation, l'erreur habituelle.
- [ ] « Réduire les animations » : seulement le rond du collègue qui s'allume et s'éteint en fondu.
- [ ] L'île reste collée à son bord et centrée pendant toute l'animation.

## Règle « un nouvel appareil apparaît sur le réseau local »
- [ ] Éditeur de règles : Quand → « Le réseau change » → « un nouvel appareil apparaît sur le réseau local » ; l'aide parle du ping toutes les 3 s et du premier tour sans alerte.
- [ ] Sans règle de ce type : aucune ligne « balayage doux » dans le journal, aucun ping (Moniteur de ressources → Réseau).
- [ ] Créer la règle avec l'action Notification « Nouvel appareil : {nom} » : le journal dit « balayage doux du réseau local démarré » et « réseau … jamais vu, premier tour pour apprendre » ; aucune notification pendant le premier tour (~13 min).
- [ ] Après le premier tour, brancher un appareil jamais vu (téléphone d'un ami sur le Wi-Fi, Raspberry Pi) : en moins de ~15 min, notification avec son nom ou son IP et sa MAC ; une seule fois.
- [ ] `%APPDATA%\Ondine\network-devices.json` : MAC, IP, dates, et `nets` ; rien d'autre.
- [ ] Désactiver la règle (ou tout mettre en pause) : « balayage du réseau local arrêté » dans le journal, plus de pings.
- [ ] VPN branché : le balayage reste sur le Wi-Fi / Ethernet local, jamais sur le réseau du VPN.
- [ ] Changer de Wi-Fi (autre box) : un nouveau premier tour sans alerte.
- [ ] Wireshark ou Moniteur de ressources : un seul ping toutes les 3 s environ, uniquement vers le /24 local, aucune connexion vers Internet ni vers des ports.
