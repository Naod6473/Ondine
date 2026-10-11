# Sécurité et fluidité — corrections de la version 1.2.3

Première passe du 10 octobre 2026, à partir de `main` (`efa1baf`, version 1.2.2).
Reprise sur `main` (`e2d882b`, version 1.2.3), avec les ajouts de Claude,
sur la branche dédiée `codex/fluidity-security-123`, qui regroupe les corrections
pour revue et essais avant leur intégration à `main`.

Avant l'intégration, les 64 fichiers modifiés ou nouveaux ont été copiés dans
`work/avant-integration-1.2.3/files/`, avec un patch binaire, le manifeste des
fichiers et les identifiants Git. Un stash supplémentaire est conservé ; son
identifiant figure dans `work/avant-integration-1.2.3/stash-sha.txt`.

## Reprise sur la version 1.2.3

Les 18 nouveaux commits ont été intégrés par avance rapide. Les quatre
conflits (Cargo.lock, capacités Tauri, halo, vue Réseau) ont été résolus en
gardant les corrections précédentes et les nouvelles fonctions de Claude :
nano, bouche, accueil, scènes, dictée hors ligne, sons d'ambiance, reflets,
écran de veille, appairage QR et test de débit.

| Correction supplémentaire | Comportement obtenu |
| --- | --- |
| Bouton Réduire dans le style bouche | Le clic est reconnu grâce à son chemin d'origine, même si son bouton vient d'être retiré du DOM. La fermeture n'est plus immédiatement suivie d'une réouverture par le corps d'Ondine. Le défaut a été reproduit et le correctif vérifié dans l'aperçu. |
| Cartes d'accueil | Les nouvelles reçues entre deux images déclenchent un seul rendu. Les mesures des déplacements précèdent les animations. Les boutons gardent les actions du contenu courant, sans réutiliser la fermeture d'un ancien morceau ou document. |
| Code de l'accueil | La vue complète est chargée à la demande, avec le même garde contre les imports tardifs que Terminal et Réseau. Le test de débit de Claude reste présent dans la vue Réseau différée. |
| Nettoyage des cartes | Le retrait d'une carte utilise la collection de nettoyage des modules ; une carte déjà retirée ne reste pas retenue jusqu'à l'arrêt du module. |
| Bouche et écran de veille | Le plafond éco est calculé avec le temps écoulé. Les dessins s'arrêtent lorsque le document est caché ; les boucles reprennent à la réapparition. Un canvas n'est redimensionné que lorsque sa taille change. L'horloge tient aussi compte de la langue et de la date. |
| Autorisation tardive de webcam | Une caméra autorisée après la fermeture de la vue est immédiatement arrêtée. Une ancienne lecture de QR ne peut pas fournir un résultat à une nouvelle session. Les images réutilisent le canvas existant. |
| Images QR reçues | Les multiplications des dimensions sont vérifiées ; la longueur base64 est bornée avant décodage. Les grandes images couleur sont réduites avant conversion en gris et détection. |
| Files de travail | Les scans QR occupent les places de travail long. L'état réseau et l'arrêt d'un test de débit utilisent la file courte et restent disponibles lorsque les deux places longues sont occupées. |
| Nouvelles fenêtres | Les reflets n'ont accès qu'à leur apparence. L'écran de veille reçoit le contexte et les événements nécessaires, sans outils, modification des réglages ou accès aux identifiants. La commande des reflets est ajoutée au manifeste Tauri. |
| Champs du Réseau | Le nom/adresse et le port possèdent un nom accessible. |

Le mode nano se règle dans **Réglages → L'île → Apparence → Forme de l'île →
Taille de la mini-île → Nano**. Les notifications et certaines activités
peuvent l'élargir temporairement, comme prévu par la machine à états.

### Validation de cette reprise

- 734 tests d'interface réussis ; TypeScript et construction Vite réussis.
- 515 tests Rust réussis, un test préexistant ignoré ; Clippy sur toutes les cibles sans avertissement.
- Aperçu navigateur avec données fictives : cartes d'accueil et ouverture d'une
  carte Musique, français/anglais sans rechargement, nano et bouche, repli,
  chargement de Terminal et Réseau, maintien du test de débit lors d'un changement
  d'onglet ; aucune erreur de console sur ces parcours.
- Audit npm, outils de développement inclus : aucune vulnérabilité connue.
- Audit du nouveau Cargo.lock avec la base RustSec locale : aucune vulnérabilité
  connue ; les deux avertissements préexistants décrits plus bas sont conservés.
- Aucun conflit Git restant. Les sauvegardes de la première passe sont conservées.

Le plus gros bloc JavaScript de la nouvelle construction fait **466,09 Ko**
minifiés (163,06 Ko compressés). Aucun bloc ne dépasse le seuil de 500 Ko de
Vite. La présence de six pages dans la version 1.2.3 modifie également le
découpage des blocs : ce chiffre n'est pas une comparaison directe de FPS ou
du poids total avec la version 1.2.2.

Les mesures natives WebView2, la dictée avec un vrai micro, l'appairage réel
entre PC et avec un téléphone, les reflets sur plusieurs écrans et les essais
de l'installateur restent à effectuer. L'aperçu navigateur ne les remplace pas.

## Corrections après revue (11 octobre 2026)

| Correction | Comportement obtenu |
| --- | --- |
| Pastille des onglets | Elle reprend sa vraie largeur à chaque image au lieu d'être étirée : les bouts arrondis et le liseré gardent leur forme, et les points de l'assistant restent ronds. |
| Certificat du téléphone | L'autorité d'Ondine porte des contraintes de nom : elle ne vaut que pour 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (et 127.0.0.0/8 pour les tests), sans aucun nom de domaine. Même avec sa clé, personne ne peut imiter un site d'Internet. |
| Page Téléphones | Une page **Réglages → Téléphones**, toujours visible (même en mode Simple), liste les téléphones appairés : nom, date de préparation, date du téléchargement du certificat, fin de validité, empreinte. Chaque téléphone a **sa propre autorité** : « Révoquer » efface sa clé privée, Ondine ne peut plus produire un certificat qu'il accepte, et les autres téléphones continuent. « Utiliser ce téléphone » choisit celui de l'Étagère et de la télécommande, qui affichent son nom. Les clés sont rangées une par téléphone dans le Gestionnaire d'identifiants (`phone-tls-<id>`) ; la partie publique est dans `phones.json`. L'ancienne autorité unique est effacée : il faut ajouter de nouveau son téléphone. |
| Accès aux outils de Parler à Ondine | Tant que « fileTools » ou « pcTools » n'est pas choisi, le premier appel d'un outil affiche une carte « Autoriser / Refuser » ; le choix est enregistré et modifiable dans les réglages. Un refus explicite retire les outils. Les personnes qui n'avaient jamais touché ces réglages sont donc interrogées au lieu de perdre les outils sans prévenir. |
| Accords à chaque action | Les petites actions locales (volume, son, luminosité, mode sombre, musique, minuteur, note, expression) redeviennent immédiates. Partager une information du PC avec l'IA, lire ou créer un fichier, ouvrir une application ou un site, l'Étagère, le Wi-Fi et le Bluetooth demandent toujours un accord. Une fois l'accès aux fichiers autorisé, la recherche par le nom est immédiate (les noms partent, jamais le contenu). |
| Préparer le téléphone | Le bouton « Première connexion » de l'Étagère et de la télécommande ouvre les réglages sur la page Téléphones, même si la fenêtre des réglages était déjà ouverte en arrière-plan. |
| Points mineurs | Activer le profil déjà actif n'écrit plus le fichier de réglages. Le petit serveur du certificat ne laisse plus une connexion lente l'occuper plus de 5 s. Changer son prénom rafraîchit à nouveau les vues des modules. |

## Inventaire de la première passe, conservé en 1.2.3

### Changements appliqués

| Domaine | Comportement obtenu |
| --- | --- |
| Travail Rust | Les commandes des modules exécutent leurs opérations synchrones dans `spawn_blocking`. Les échanges IA sont sérialisés ; les travaux longs disposent de deux places, les appels courts de huit places distinctes. Les dialogues, imports, exports, profils et annulations sortent aussi du thread qui reçoit les commandes. |
| Réglages | L'interface répond immédiatement, puis sauvegarde les seuls champs modifiés. Les changements rapides en attente sont regroupés. Les fenêtres fusionnent leurs modifications et ignorent les événements anciens. Un échec revient au dernier état enregistré et affiche l'erreur. La mémoire Rust n'est validée qu'après l'écriture réussie. |
| Effets Windows | Une couleur ou un autre réglage visuel ne réapplique plus les effets du démarrage, des raccourcis, de la mascotte sur le bureau ou du mode de performance. |
| Animations | La pastille des onglets utilise une transformation pour sa largeur. Sa géométrie et celle du halo sont mises en cache puis invalidées quand elles changent. Les boucles de dessin s'arrêtent lorsque la page est cachée ou sans taille ; le plafond éco est calculé avec le temps écoulé, même sur un écran à 120 ou 144 Hz. |
| Chargement | Les vues développées Terminal et Réseau, ainsi que les dictionnaires anglais et de tutoiement, sont chargées à la demande. Un import arrivé après la fermeture d'une vue ne la remonte pas. |
| Mémoire | Les désabonnements exécutés quittent leur collection de nettoyage ; les vues fermées ne restent plus retenues jusqu'à l'arrêt du module. Les abonnements aux réglages ne redessinent plus chaque module pour un changement sans rapport. Le mode démo et la langue restent pris en compte. |
| Clavier et erreurs | Les champs de réglages disposent de noms accessibles. Les groupes de choix se parcourent avec les flèches, Début et Fin. Les erreurs de sauvegarde restent visibles. |
| Dossiers exclus | Une copie, un déplacement, une compression ou une mise à la Corbeille refuse un parent contenant un dossier exclu. Les lectures récursives sont revérifiées. Les comparaisons de chemins Windows respectent les composants et la casse Unicode. |
| IA | Les outils PC et fichiers sont désactivés par défaut pour une nouvelle configuration. Recherches de fichiers, notes, agenda et autres accès ou actions demandés par l'IA attendent un accord. Les choix explicites existants sont conservés. Une désactivation ou une exclusion ajoutée pendant un aperçu est revérifiée lors de la confirmation. Les commandes rapides locales restent immédiates. |
| IPC Tauri | Les commandes applicatives sont déclarées dans le manifeste de construction. L'île, les réglages, la mascotte et l'annotation possèdent des capacités distinctes. L'annotation accède uniquement aux commandes de capture prévues. La mascotte ne peut pas élargir ses onglets autorisés ni changer les réglages globaux. L'ancienne sauvegarde de l'objet complet est retirée. |
| CI et publication | L'audit npm inclut les outils de développement. Une publication exige une CI réussie sur le commit exact de `main`. Ces modifications de workflow sont locales et prendront effet après leur intégration sur GitHub. |

## Téléphone : tout reste dans Ondine

Le navigateur mobile reste le client du partage et de la télécommande. Les
deux utilisent HTTPS, sans repli vers HTTP pour les fichiers ou les actions.

La première connexion se prépare dans **Réglages → Téléphones → Ajouter un
téléphone**. Ondine fournit un QR pour télécharger le certificat public
de ce PC. Comparer son nom et son empreinte avec les détails du certificat sur
le téléphone avant de l'installer. Le guide distingue Android et iPhone ; le
profil iPhone contient uniquement le certificat. Revenir ensuite dans
l'Étagère ou les Contrôles pour ouvrir le QR HTTPS.

Le lien initial en HTTP ne sert que le certificat public, expire après trois
minutes et se ferme après un téléchargement. Son intégrité est vérifiée par
la comparaison de l'empreinte sur les deux appareils. La clé privée reste dans
le Gestionnaire d'identifiants Windows, hors des clés exposées à l'interface
et des exports. L'autorité dure deux ans ; les certificats de session durent
au plus sept jours. L'expiration demande un nouvel appairage. Révoquer un téléphone efface la
clé de son autorité : il faut aussi retirer le certificat du téléphone.

Installer une autorité ajoute une confiance sur le téléphone. N'utiliser cette
fonction qu'avec son propre PC et retirer l'autorité si le PC est compromis,
si l'appairage expire ou si Ondine n'est plus utilisé. Ne jamais contourner
une alerte de certificat dans le navigateur. Une clé Windows est protégée par
le compte utilisateur, pas contre un logiciel malveillant exécuté sous ce
même compte.

## Vérifications de la première passe (1.2.2)

- 590 tests d'interface réussis ; vérification TypeScript et construction Vite réussies.
- 486 tests Rust réussis, un test préexistant ignoré ; Clippy sur toutes les cibles sans avertissement.
- Tests TLS sur sockets réelles : certificat accepté, autorité inconnue refusée,
  mauvaise adresse refusée ; téléchargement, expiration et arrêt du partage.
  Les certificats des tests restent en mémoire et ne touchent pas au trousseau utilisateur.
- Audit npm : aucune vulnérabilité, dépendances de développement incluses.
- Audit RustSec avec cargo-audit 0.22.2 : aucune vulnérabilité ; deux
  avertissements conservés, `proc-macro-error` non maintenu et `glib` 0.18
  avec un avis d'unsoundness. Ils étaient déjà documentés dans
  `src-tauri/.cargo/audit.toml` et concernent des dépendances du chemin Linux de Tauri.
- Aperçu navigateur : ouverture des vues différées, changement anglais/français,
  tutoiement et navigation clavier des choix, sans erreur de console.

Dans la première passe sur 1.2.2, le principal fichier JavaScript minifié passe de **894,21 à 564,33 Ko**
(-36,9 %). Les dictionnaires sont des fichiers séparés, téléchargés quand la
langue les demande. Cette mesure porte sur ce fichier, pas sur le poids total
de l'application ni sur un gain de FPS. Vite signalait encore ce bloc de plus
de 500 Ko : le découpage des autres modules reste à poursuivre.

## Validation native avant publication

La fluidité « parfaite » ne peut pas être déduite des tests unitaires.
Mesurer une version de production dans WebView2, sur le PC cible, à 60 Hz et
à sa fréquence maximale, secteur puis batterie :

1. Répéter ouverture/repli et changement d'onglet, déplacer l'île, puis faire
   défiler les listes pendant une copie ou une compression volumineuse et une
   réponse IA lente. Vérifier aussi l'annulation et les dialogues de fichiers.
2. Enregistrer une trace de performance de 30 secondes par scénario. Comparer
   les percentiles 95/99 du temps des images et des interactions au budget de
   l'écran : 16,7 ms à 60 Hz, 8,3 ms à 120 Hz. Repérer les tâches longues et
   les recalculs de mise en page avant de choisir une nouvelle optimisation.
3. Ouvrir/fermer les mêmes vues 100 fois et comparer la mémoire après collecte
   et stabilisation. Vérifier la CPU au repos, page cachée et après réapparition.
4. Essayer le véritable appairage sur Android/iPhone, le téléchargement d'un
   fichier volumineux, l'arrêt et la télécommande. Vérifier les permissions
   natives de chaque fenêtre, les dossiers exclus et un échec réel de sauvegarde.

Ces essais natifs, l'installation du certificat sur un téléphone réel et le
parcours complet de l'installateur n'ont pas été effectués ici.

## Suite du travail

Le streaming réel des réponses IA avec annulation coopérative n'est pas ajouté :
l'affichage progressif actuel suit encore une réponse réseau complète. La
morphologie générale de l'île anime toujours certaines dimensions ; sa
conversion complète vers des transformations demande les traces natives.
Le découpage des autres gros modules et une navigation par favoris restent
des évolutions de produit, au-delà des corrections présentes.

La protection de `main` doit être configurée dans GitHub. La signature Windows
Authenticode nécessite un certificat et sa configuration de publication ;
elle ne se confond pas avec la signature Tauri des mises à jour. Aucun de ces
réglages distants n'a été modifié.
