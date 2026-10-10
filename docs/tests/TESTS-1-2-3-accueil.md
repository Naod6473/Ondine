# Tests Windows 1.2.3 : l'onglet Accueil (zone « accueil »)

Rien de ce qui suit n'a été vu à l'écran : il n'y a pas de navigateur sous
Linux. Seules les règles (ordre, moment, profils, phrase, actions rapides,
place de l'onglet) sont testées par `npm test` (tests/front/home.test.ts).
Pour avoir des cartes sans tout brancher : Réglages → Mode démo (musique,
agenda, agents inventés).

## Place de l'onglet
- [ ] Installation neuve (renommer `%APPDATA%\Ondine\settings.json`, le remettre après) : après l'assistant, l'Accueil (🏠) est le premier onglet, Parler à Ondine le deuxième, avec ou sans carte cochée.
- [ ] Mise à jour depuis 1.2.2 avec des onglets déjà rangés à la main : l'Accueil apparaît en tête, l'ordre des autres onglets n'a pas changé.
- [ ] Glisser l'onglet Accueil plus loin, fermer et rouvrir l'île, relancer Ondine : il reste à la place choisie.
- [ ] Réglages → Modules → Le PC au quotidien → Accueil : l'interrupteur « Activé » le cache ; le rallumer : il revient en tête.
- [ ] Ouvrir un autre onglet, laisser l'île se refermer, la rouvrir : elle s'ouvre sur l'Accueil. Couper « Ouvrir l'île sur l'Accueil » : elle se rouvre sur le dernier onglet.
- [ ] Une notification « Voir » (ex. Étagère) ou le Lanceur qui ouvre un onglet précis : c'est bien cet onglet qui s'ouvre, pas l'Accueil.
- [ ] Première ouverture de l'onglet : la bulle d'astuce « Glissez une carte pour la ranger… » apparaît une fois.

## Cartes vivantes
- [ ] Rien ne joue, aucun minuteur, aucun rendez-vous : l'Accueil est court (phrase, peut-être Batterie / À faire, actions rapides) ; sans aucune carte : « Rien de spécial pour l'instant : Ondine vous préviendra. »
- [ ] Lancer une musique (Spotify, navigateur) : la carte Musique arrive en gelée, large, avec la pochette, le titre, l'artiste, la barre qui avance et ⏮ ⏸ ⏭ qui marchent sans ouvrir la carte. Couper la musique : la carte s'efface.
- [ ] La carte Musique prend la couleur de la pochette (dégradé), qui change au morceau suivant ; en pause, la teinte s'en va.
- [ ] Lancer un minuteur de 2 min : la carte Minuteur apparaît, les chiffres roulent chaque seconde, la barre se remplit ; en pause : « En pause ». Pomodoro et chrono : leur carte à la place.
- [ ] Agenda avec un rendez-vous aujourd'hui : carte « Agenda » avec l'heure et le titre ; 15 min avant : la carte respire (liseré bleu) et passe devant, « Rejoindre » pour une réunion Teams / Meet / Zoom.
- [ ] Après 18 h avec des rendez-vous demain : la carte s'appelle « Demain », avec le premier rendez-vous et les suivants (taille large).
- [ ] Météo allumée avec une ville : carte Météo (icône, température, temps, ville et détail en large). Météo éteinte : pas de carte. Un clic ne l'ouvre pas (pas d'onglet).
- [ ] PC portable : carte Batterie (« 82 % », « Sur batterie » / « En charge » / « Branché »), relue toutes les 30 s. Sous le seuil « batterie faible » et débranché : elle respire et passe devant. PC fixe : pas de carte Batterie.
- [ ] Claude Code au travail : carte Agents IA « Claude · au travail · 4 min » ; quand il attend une permission : la carte respire et passe devant ; « a fini » reste 30 min.
- [ ] Notes : des tâches non cochées → carte « À faire » avec le nombre (les tâches en taille large). Toutes cochées : plus de carte.
- [ ] Étagère avec des fichiers : carte Étagère avec le nombre (les derniers fichiers en large).

## Ranger, retirer, deux tailles
- [ ] Glisser une carte sur une autre : les autres s'écartent en glissant, la carte suit la souris en restant dessous, et se pose en douceur à la nouvelle place. Le clic qui suit le glisser n'ouvre pas la carte.
- [ ] Fermer et rouvrir l'île, relancer Ondine : l'ordre est gardé.
- [ ] Clic droit sur une carte : « Grande taille » (elle prend deux cases) / « Petite taille » ; « Retirer de l'accueil » : elle disparaît et ne revient pas.
- [ ] Clic droit dans le vide de l'Accueil : « Ranger selon le moment » (si on a rangé à la main) et « Remettre les cartes retirées » (si on en a retiré) font ce qu'ils disent. Échap ou un clic ailleurs ferme le menu.
- [ ] Le menu ne sort pas de l'île, même avec un clic droit tout en bas à droite.

## La carte s'ouvre sur place
- [ ] Clic sur la carte Minuteur : elle grandit en ressort jusqu'au Minuteur complet (sous-onglets, boutons qui marchent), sans changer d'onglet ; l'île grandit si besoin. Les autres cartes, la phrase et les actions se cachent.
- [ ] Clic sur l'en-tête de la carte ouverte (« ▴ ») ou Échap : elle se replie à sa place, les autres cartes reviennent en cascade ; l'île reprend sa taille. Un second Échap ferme l'île.
- [ ] Même chose avec Musique, Agents IA, Agenda, Notes, Étagère, Système (Batterie).
- [ ] Cliquer très vite deux fois sur une carte, ou sur une carte pendant l'arrivée en cascade : rien ne reste à moitié agrandi ni décalé.
- [ ] Une carte ouverte dont le module se coupe (le couper dans les Réglages) : elle se referme proprement.

## Selon le moment, la phrase d'Ondine
- [ ] Le matin (avant 11 h) : Agenda, Météo et À faire d'abord ; en journée : Agents IA et Minuteur d'abord ; le soir : les rendez-vous de demain, Musique. (Changer l'heure de Windows pour vérifier.) Couper « Ranger les cartes selon le moment » : l'ordre des modules.
- [ ] La phrase en haut : « Bonjour, Simon. » (« Bon après-midi » / « Bonsoir » selon l'heure, sans prénom : « Bonjour. »), puis au plus 3 morceaux tirés des cartes, la première lettre en majuscule : « 3 rendez-vous aujourd'hui, Claude a fini, 21° dehors. ». Elle suit les cartes quand elles changent.
- [ ] En anglais : « Good morning, Simon. 3 events today, Claude is done, 21° outside. » ; en tutoyant : « Claude t'attend ».
- [ ] « Afficher la phrase d'Ondine » coupé : plus de phrase.

## Carte « Reprendre »
- [ ] Poser un fichier sur l'étagère, écrire une note, terminer une session Claude Code : la carte « Reprendre » montre les trois, la plus récente en haut.
- [ ] Clic sur la ligne du fichier : il s'ouvre ; sur la note : l'onglet Notes s'ouvre sur cette note ; sur la session : la fenêtre de l'agent revient devant.
- [ ] Juste après un redémarrage d'Ondine, le fichier de l'étagère n'y est pas (l'étagère ne date pas ses fichiers) ; il revient au prochain fichier posé.
- [ ] Réglage « Carte « Reprendre » » coupé : plus de carte.

## Actions rapides
- [ ] Par défaut : Capture, Notes, 25 min, Parler à Ondine. Capture : l'île se ferme et l'outil de capture s'ouvre ; Notes : l'onglet Notes ; 25 min : la carte Minuteur apparaît avec 25:00 qui descend ; Parler à Ondine : son onglet.
- [ ] Réglages → Accueil → Action rapide 1 à 4 : Rechercher, Terminal, Pipette, Presse-papiers, Agents IA marchent ; « Aucune » retire le bouton ; un module éteint (ex. Capture) fait disparaître son bouton.

## Ondine montre la carte importante
- [ ] (Avec la branche scènes) Une carte urgente (agent qui attend, réunion dans 10 min, batterie faible) : en style bouche, les yeux d'Ondine regardent la carte ; en style classique, elle se pose à côté. Une seule fois par carte, pas à chaque seconde.
- [ ] Calme allumé, ou « Ondine regarde la carte importante » coupé : elle ne bouge pas.

## Design et animations
- [ ] Style classique : cartes en verre sombre, lisibles avec chaque thème de l'île (Nuit, clair…). Style bouche (Réglages de l'île-bouche) : cartes en gomme bleue avec un reflet en haut et une ombre douce, assorties à Ondine.
- [ ] À l'ouverture de l'île sur l'Accueil : les cartes arrivent l'une après l'autre en gelée (elles gonflent, s'écrasent un peu, se posent).
- [ ] Windows → Accessibilité → Effets d'animation coupés (« Réduire les animations ») : les cartes apparaissent en simple fondu, rien ne respire, ne glisse ni ne rebondit ; ouvrir une carte la montre directement.
- [ ] Mode Éco : les chiffres se mettent à jour toutes les 2 s, rien ne saccade.
- [ ] Au clavier : Tab arrive sur les cartes, Entrée ouvre la carte (ou la première ligne de « Reprendre »).

## Profils
- [ ] Créer deux profils Travail et Maison. Dans Travail, retirer la carte Musique et mettre Agents IA en premier ; passer à Maison : toutes les cartes, ordre automatique ; revenir à Travail : son rangement est revenu.
- [ ] Sans profil actif : le rangement « de base » est celui d'avant les profils.
