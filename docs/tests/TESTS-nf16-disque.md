# Tests Windows NF16 : « Qu'est-ce qui remplit mon disque ? » (module Système)

Le panneau a été vu dans un navigateur (Chromium sous Linux, données du mode
démo) ; l'analyse, la Corbeille, les temporaires, les miniatures et les
téléchargements n'ont JAMAIS tourné sur un vrai Windows. La logique est testée
par `npm test` (tests/front/system-disk.test.ts) et `cargo test`
(modules/system_disk.rs : parcours, liens non suivis, dossiers exclus,
temporaires, téléchargements cochés).

Avant de commencer : faites un point de restauration ou une sauvegarde si vous
voulez, et mettez un ou deux fichiers sans importance dans la Corbeille.

## Où cliquer
- [ ] Île → onglet **Système** → « Disques » : chaque disque a un petit bouton 🔍 au bout de sa ligne (bulle : « Voir ce qui prend la place »).
- [ ] Réglages → Modules → Système → sous-menu **Disques** : « Prévenir quand un disque a moins de… » (le seuil d'avant, même valeur qu'avant la mise à jour) et « Vieux téléchargements : plus de (jours) » (90 par défaut). Les sous-menus « Général » et « Batterie » rangent les autres réglages du module.
- [ ] Mettre le seuil à 50 % (pour déclencher l'alerte) : la notification « Disque C:\ presque plein » arrive dans les 30 s, avec le bouton **« Voir ce qui prend la place »**. Le cliquer : l'île s'ouvre sur Système et l'analyse de C: démarre. Remettre le seuil à 10.
- [ ] Lanceur (Alt+Espace) : taper « disque » ou « place » → « Voir ce qui prend la place sur le disque » ; Entrée : l'analyse du disque le plus plein démarre.

## L'analyse
- [ ] C: (SSD, ~200 Go utilisés) : les dossiers apparaissent tout de suite et grossissent au fur et à mesure (les barres glissent, un dossier encore en lecture respire doucement). L'île reste fluide, on peut changer d'onglet pendant ce temps.
- [ ] Durée notée : ______ (attendu : moins d'une minute sur un SSD pour un disque de 250 Go). Processeur et mémoire dans le Gestionnaire des tâches : ______ (attendu : un cœur occupé, quelques dizaines de Mo au plus).
- [ ] À la fin : « Analysé en … s · N fichiers · N dossiers fermés ignorés ». Aucune fenêtre d'erreur, aucune demande d'administrateur.
- [ ] La taille totale ressemble à la place utilisée affichée par Windows (Paramètres → Système → Stockage), à quelques Go près (Windows compte aussi les fichiers système qu'on ne peut pas lire ; WinSxS peut paraître plus gros chez nous, les liens physiques sont comptés à chaque nom).
- [ ] « Arrêter » pendant l'analyse : elle s'arrête tout de suite (« Analyse arrêtée ») ; ce qui a déjà été lu reste affiché.
- [ ] Clic sur « Users » : on descend dedans (chemin « Disque C: › Users ») ; « ← » remonte ; un clic sur « Disque C: » dans le chemin ramène à la racine ; « ← » à la racine revient à l'onglet Système normal.
- [ ] « Ouvrir dans l'Explorateur » ouvre le dossier affiché. « Plus gros fichiers ici » (à la racine : pagefile.sys, hiberfil.sys) → « Montrer » sélectionne le fichier dans l'Explorateur.
- [ ] « Carte » : les mêmes dossiers en carte proportionnelle (le plus gros en couleur pleine) ; un clic sur une tuile descend ; « Barres » revient. Le choix est retenu à la prochaine ouverture.
- [ ] OneDrive avec des fichiers « en ligne seulement » : ils ne comptent pas (0 o), les fichiers téléchargés comptent.
- [ ] Une jonction (C:\Documents and Settings, ou un dossier créé avec `mklink /J`) n'est pas suivie : rien n'est compté deux fois.
- [ ] Un dossier mis dans Réglages → Confidentialité → dossiers exclus n'apparaît pas (« N dossiers exclus non comptés »).
- [ ] Une clé USB (bouton 🔍 sur sa ligne) : l'analyse marche aussi.
- [ ] Désactiver le module Système pendant une analyse : elle s'arrête (le processeur redescend).

## Faire de la place
- [ ] « 🧹 Faire de la place » : « Calcul de la place à gagner… » puis quatre lignes avec la place estimée (≈) : Vieux téléchargements, Fichiers temporaires, Cache des miniatures, Corbeille. « ← La carte » revient.
- [ ] **Vieux téléchargements** : « Choisir… » déplie la liste (nom, âge en jours, taille), tout est coché ; décocher un élément change « Coché : … ». « Envoyer à la Corbeille » → confirmation « Envoyer N éléments à la Corbeille ? » → « Confirmer » : les éléments sont DANS LA CORBEILLE (pas supprimés), notification « N éléments envoyés à la Corbeille », et « Annuler » quelques secondes les remet à leur place.
- [ ] Un fichier récent (moins de 90 jours), desktop.ini, ou un élément d'un sous-dossier n'est jamais proposé.
- [ ] **Fichiers temporaires** : « Nettoyer » → « Supprimer ces fichiers temporaires ? » → « Confirmer ». Notification « X Go libérés » (et « N fichiers en cours d'utilisation laissés »). Les fichiers de moins de 24 h et ceux ouverts par une appli (ex. : un document Word ouvert) restent dans %TEMP%. Aucune appli ouverte ne plante.
- [ ] **Cache des miniatures** : « Nettoyer » → confirmation → la plupart des fichiers sont « en cours d'utilisation » tant que l'Explorateur tourne (c'est normal) ; les miniatures se refont à l'ouverture d'un dossier d'images.
- [ ] **Corbeille** : « Vider la Corbeille » → « Vider la Corbeille ? C'est définitif. » → « Confirmer » : la Corbeille est vide (sans la fenêtre de Windows), notification « X Go libérés ». Corbeille déjà vide : ligne grisée, bouton inactif.
- [ ] « Annuler » sur une confirmation : rien n'est fait.
- [ ] Pendant un nettoyage : Ondine travaille, puis passe un coup de balai sur la largeur de l'île (onglet Système ouvert) et finit fière. Avec « réduire les animations » de Windows ou le réglage Calme : un simple geste, pas de traversée.
- [ ] Après le nettoyage, les lignes sont recalculées.

## Langues et apparence
- [ ] Langue anglaise : panneau en anglais (« Free up space », « 12 GB freed »…). Tutoiement : « Windows le refait quand tu ouvres un dossier ».
- [ ] Thème clair de l'île : barres et tuiles lisibles.
- [ ] Icônes au trait : 🔍 📂 🧹 🗑️ ⬇️ 🖼️ au trait.
