# Tests Windows : Mises à jour des logiciels (winget)

Rien de cette fonction n'a encore tourné sur Windows : la lecture de la sortie
de winget est testée sur des sorties écrites à la main (français, anglais,
chinois, noms coupés), pas sur un vrai winget. Si une ligne ne marche pas, une
copie de ce qu'affiche `winget upgrade` dans un terminal aide beaucoup.

## Où cliquer

- **L'onglet** : ouvrir l'île, onglet **Mises à jour des logiciels** (icône
  flèche dans un cercle, après Réseau).
- **Les réglages** : Réglages → Modules → **Outils IT** → **Mises à jour des
  logiciels**, sous-menus **Vérification** et **Applis ignorées**.
- **Le Lanceur** : Alt+Espace, taper « mises à jour » ou « winget ».

## Liste et vérification

- [ ] Premier passage dans l'onglet : « Cliquez sur « Vérifier » pour voir les applis qui ont une nouvelle version. » Rien n'est parti sur Internet (aucune vérification sans clic).
- [ ] « 🔄 Vérifier » : le bouton passe à « Vérification… », « winget lit ses sources… » sous le titre, **aucune fenêtre de console ne s'ouvre**. Après quelques secondes : « N mises à jour » et la liste.
- [ ] Comparer avec `winget upgrade` dans un terminal : mêmes applis, mêmes ID, mêmes versions « 1.0 → 2.0 » (Windows en français ; si possible un PC en anglais aussi).
- [ ] Une appli au nom très long : le nom est coupé proprement à l'écran, l'ID est entier. (Si winget coupe lui-même un ID avec « … », l'appli est laissée de côté : à signaler.)
- [ ] Une appli marquée par winget « nécessite un ciblage explicite » (second tableau) : elle est dans la liste et se met à jour comme les autres.
- [ ] Tout est à jour : « ✅ Toutes vos applis connues de winget sont à jour. »
- [ ] Fermer et relancer Ondine : la liste de la dernière vérification est toujours là, « Vérifié il y a … » avance chaque minute onglet ouvert.
- [ ] Sans réseau : « Vérifier » donne une phrase d'erreur courte (celle de winget), pas un plantage.

## Mettre à jour une appli

- [ ] « Mettre à jour » sur une ligne : le bouton devient « Confirmer ? » (il se gonfle un peu) ; sans second clic en 4 s, il redevient « Mettre à jour ».
- [ ] Second clic : la ligne montre « Préparation… », puis « Téléchargement… 45 % » avec une barre qui avance, puis « Installation… ». Aucune fenêtre de console.
- [ ] Pendant ce temps, Ondine travaille (expression « au travail ») ; à la fin elle est contente, puis l'appli disparaît de la liste et apparaît sous « Terminées » avec « Mise à jour faite ».
- [ ] Une notification « 1 appli mise à jour » (avec « Voir »).
- [ ] Une appli ouverte pendant sa mise à jour (ex. Notepad++ ouvert) : soit elle se ferme et se met à jour, soit « L'appli est ouverte : fermez-la puis réessayez » et le bouton « Réessayer ».
- [ ] Une appli qui demande de redémarrer (un .msi) : « Mise à jour faite · redémarrage demandé », Ondine bâille, la notification le dit. Ondine ne redémarre jamais le PC.

## L'administrateur

- [ ] Une appli installée pour tous les utilisateurs (ex. 7-Zip, Git installés « pour tous ») : la fenêtre de Windows « Voulez-vous autoriser… » apparaît. **Oui** : la mise à jour continue. **Non** : « Annulée (autorisation refusée ?) ».
- [ ] Si le résultat est « Demande les droits d'administrateur » : le bouton « En administrateur » ouvre une console après la fenêtre de Windows ; winget y fait la mise à jour et attend une touche à la fin.
- [ ] Le pied de l'onglet dit honnêtement qu'Ondine ne peut pas valider la fenêtre de l'administrateur à votre place.

## Tout mettre à jour, la file

- [ ] « Tout mettre à jour (N) » : une bande « Mettre à jour N applis ? » avec ce qui peut se passer ; « Annuler » la referme sans rien lancer.
- [ ] « Tout mettre à jour » dans la bande : une seule à la fois ; en haut « 2 sur 5 · Firefox » avec un point qui respire ; les autres sont « En attente (2) », « En attente (3) »…
- [ ] « Retirer » sur une appli en attente : elle sort de la file, les autres continuent. « Vider la file » : celle en cours continue, les autres ne commencent pas.
- [ ] Celle en cours n'a pas de bouton pour l'arrêter (normal : couper un installateur en plein travail peut abîmer l'appli).
- [ ] À la fin : notification « 4 à jour, 1 en échec » (ou « 5 applis mises à jour ») ; l'échec reste sur sa ligne avec sa raison courte.
- [ ] Pendant la file, « Vérifier » est grisé.

## Ne plus proposer

- [ ] Survoler une ligne : l'icône « Ne plus proposer cette appli » apparaît ; un clic l'enlève de la liste et du compte.
- [ ] En bas : « 1 appli ignorée » ouvre les Réglages sur **Applis ignorées** ; l'ID est dans la zone de texte. Effacer la ligne : l'appli revient dans la liste.
- [ ] Ctrl+Z dans les Réglages après avoir effacé la ligne : elle revient (et l'appli ressort de la liste).

## Vérification automatique et pastille

- [ ] Réglages → Vérification : « Vérifier automatiquement » vaut **Jamais (seulement d'un clic)** au départ (menu en verre).
- [ ] Passer à « Chaque jour » (et avoir une dernière vérification de plus d'un jour, ou aucune) : environ 3 minutes après le démarrage d'Ondine, une vérification se fait seule ; s'il y a du nouveau, une notification discrète « 3 mises à jour de logiciels disponibles » avec « Voir ».
- [ ] Une petite pastille bleue dans le coin haut gauche de l'île (à côté de l'emplacement de la rouge des services IA) tant que des mises à jour attendent ; elle s'éteint quand tout est à jour, ignoré, ou si on coupe « Pastille sur l'île ». Elle ne pulse pas.
- [ ] Île sur un côté de l'écran : la pastille va dans le bas de l'île, sans gêner.
- [ ] Couper le module (Activé) : la pastille et l'onglet disparaissent.

## winget absent

- [ ] Sur un PC sans App Installer (ou une session Windows Sandbox) : « winget n'est pas installé sur ce PC. » et « Installer App Installer », qui ouvre sa page dans le Microsoft Store.

## Lanceur, réglages, langues

- [ ] Alt+Espace, « mises à jour » : « Chercher les mises à jour des logiciels » ; Entrée ouvre l'onglet et lance la vérification. L'onglet lui-même est aussi proposé.
- [ ] Ctrl+K dans les Réglages, « winget » ou « ignorées » : mène à la bonne ligne. La pastille « Modifié », « Réinitialiser » et l'export des réglages marchent pour les trois réglages.
- [ ] Mode Simple des Réglages : « Vérifier automatiquement » et « Prévenir… » restent visibles.
- [ ] En anglais (Langue : English) et au tutoiement : tous les textes de l'onglet et des réglages sont traduits (« Check », « Update all (3) », « Clique sur « Vérifier »… »).
- [ ] Windows « réduire les animations », puis Performances → Économie : la barre sans pourcentage ne glisse plus, le point de la file ne respire plus.
- [ ] Journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) : l'ID et le résultat de chaque mise à jour, rien d'autre.
