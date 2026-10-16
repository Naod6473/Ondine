# Tests Windows 1.2.5 : Ondine convertit

À vérifier sur Windows (le conteneur Linux ne peut pas le faire). Résultat attendu après la flèche.
Réglages → Modules → Ondine convertit : allumé par défaut. Préparer un dossier avec : une photo d'iPhone .heic, un .jpg avec position GPS, un .png, un .avif, un .tif, un PDF de 3 pages, un PDF protégé par mot de passe, une vidéo .mp4 et une .mov, un .wav, un .zip, un fichier .jpg abîmé (un .txt renommé).

## 1. Le dépôt unifié
- Glisser le .heic depuis l'Explorateur vers l'île (cachée, mini, puis ouverte) → l'île s'ouvre en ressort, à la hauteur de son contenu, rien ne déborde. En-tête : Ondine surprise, le nom entier, « Image · 3,4 Mo » et la pilule d'option « Conserver à côté ». Trois lignes de pilules du même style (icône au trait + nom) : Convertir (JPG, PNG, WebP, PDF, Alléger, GIF, BMP, TIFF, ICO, Redimensionner…, ZIP), Ranger (Étagère, Copier vers…, Déplacer vers…, dossiers favoris, Corbeille), Outils (Parler à Ondine, Renommer…, Copier le chemin, Empreinte, Terminal ici). En bas : « Lâchez sur une pilule ».
- Survoler une pilule → elle prend la couleur d'Ondine et grossit un peu, Ondine la regarde, la phrase dit ce qui va se passer (« Convertir en JPG, à côté de l'original »).
- Aucune pilule ne sort sous l'île ni au-dessus (les anciennes pilules en éventail ont disparu).
- Survoler la pilule d'option une demi-seconde → elle tourne : « Remplacer l'original », puis « Sur le bureau », puis « Conserver à côté ». La phrase suit.
- Appuyer sur Maj pendant le glisser → « Remplacer l'original ».
- Glisser un dossier → « Dossier · N éléments », pas de pilule d'option, ligne Convertir réduite à ZIP.
- Glisser 3 photos → « 3 fichiers », « Images · 6 Mo », « Un seul PDF » et « Un seul ZIP ». Un .jpg et un .mp3 ensemble → seulement « Un seul ZIP ». Un .zip → « Extraire ».
- Un fichier sans format possible (un .txt) → pas de pilule d'option ; la ligne Convertir montre ZIP. Une ligne vide n'apparaît pas.
- Choisir WebP pour un .heic, puis glisser un autre .heic → WebP est la première pilule.
- Île à gauche ou à droite → même contenu, l'île s'étend vers le centre de l'écran, rien n'est coupé. Île en bas → elle grandit vers le haut.
- Module coupé → pas de formats ; la pilule ZIP est « Compresser » de l'Étagère ; Ranger et Outils comme avant.
- Échelle 125 %, 150 %, deuxième écran → la pilule allumée est bien celle sous la souris.
- Panneau haut : un fichier qui donne beaucoup de pilules (photo, avec des dossiers favoris et des collègues) → l'île grandit au-delà de 320 px sans être coupée, puis la fenêtre reprend sa taille quand l'île se referme.

## 2. Lâcher, et les pilules des autres modules
- Lâcher sur « Étagère », « Copier vers… », « Corbeille » → comme avant, rien n'est converti.
- Lâcher sur « Redimensionner… » (images) → la boîte de largeur d'avant (ancien « Images… »), le fichier réduit à côté de l'original.
- Lâcher sur ZIP → un ZIP à côté de l'original ; même résultat qu'avec l'ancien « Compresser ».
- Lâcher sur un format → conversion, l'Étagère ne reçoit rien.
- Lâcher ailleurs (entre deux pilules) → rien, l'île se referme, pas de notification.
- Repartir sans lâcher → l'île se referme.
- Réglages → Étagère → « Pilules du dépôt » : masquer « Corbeille » → elle n'apparaît plus au dépôt ; monter « Copier vers… » en premier → elle est la première de Ranger ; « Réinitialiser » → tout revient. Le choix reste après un redémarrage.
- Migration depuis la 1.2.4 : avec « Corbeille » ou « Terminal ici » coupés avant la mise à jour → ces pilules restent masquées, et sont cochées « masquées » dans la nouvelle liste.

## 3. Convertir
- .heic → JPG → Ondine avale l'icône, mâche (vite puis concentrée), la pilule se remplit avec le liquide de l'île, puis elle recrache le fichier en arc, la pilule « vacances.jpg · 3,4 Mo → 820 Ko · Ouvrir · Annuler » sort. Le .jpg est à côté de l'original, même date (réglage « Garder la date d'origine »).
- Sans l'extension HEIF du Store → échec en une ligne : « Il manque l'extension de Windows pour ce format… ». L'original n'a pas bougé.
- Convertir deux fois le même fichier → « photo (2).jpg », jamais d'écrasement.
- « Ouvrir » → le fichier s'ouvre dans son appli. « Annuler » → le nouveau fichier part à la Corbeille, la pilule dit « Annulé ».
- Dossier de l'original ouvert dans l'Explorateur → le nouveau fichier y est sélectionné. Dossier fermé → rien ne s'ouvre.
- Photo avec GPS → JPG, « Retirer les métadonnées » allumé : Propriétés → Détails, plus de GPS ni d'appareil. Réglage coupé : le GPS est là. Photo prise de côté → bien tournée.
- Qualité Petite / Normale / Haute → la taille change nettement (JPG et Alléger).
- .png → ICO, GIF, BMP, TIFF, WebP → chaque fichier s'ouvre dans Photos.
- .avif et .tif → JPG (AVIF demande l'extension AV1).
- 3 photos → Un seul PDF → un PDF de 3 pages A4, chaque image entière.
- PDF de 3 pages → PNG → un dossier « nom du PDF » avec page 1.png, page 2.png, page 3.png lisibles. PDF protégé → « Ce PDF est protégé par un mot de passe ».
- .mov → MP4, .mp4 → Alléger (plus petit), .mp4 → MP3 (le son seul), .wav → M4A, .mp3 → WAV → chaque fichier se lit. Une longue vidéo : la progression avance vraiment ; cliquer la pilule qui se remplit → « Conversion arrêtée », aucun fichier à moitié écrit (Corbeille).
- 3 fichiers → Un seul ZIP → un ZIP qui contient les 3. Un .zip → Extraire → un dossier avec le contenu, rien en dehors.
- Le fichier abîmé → grimace d'Ondine, l'original ressort de sa bouche, une ligne : « Cette image semble abîmée ». Le fichier est intact.
- Lot de 12 photos dont une abîmée → la mini-île compte « 3/12 · 42 % », les 11 autres sont converties, le résultat dit « 1 échec : … ».
- Lancer une conversion pendant qu'une autre tourne → pas de ligne Convertir (Ranger et Outils restent là).

## 4. Remplacer et Sur le bureau
- Remplacer : .png → JPG → l'original part à la Corbeille, la pilule dit « L'original est dans la Corbeille » ; « Annuler » → le .png revient à sa place, le .jpg part à la Corbeille.
- Remplacer avec un .heic → JPG → le .jpg prend le nom « photo.jpg » ; l'original .heic est dans la Corbeille.
- Clé USB sans Corbeille → l'original reste à sa place, la pilule le dit.
- Sur le bureau → le fichier est posé sur le Bureau (OneDrive compris), l'arc part vers la droite.

## 5. Accessibilité, styles, langue
- « Réduire les animations » de Windows ou mode Calme → les pilules du dépôt arrivent en fondu, sans grossir ; les mêmes étapes en fondus, pas d'arc ni de paillettes, Ondine ne grimace pas. Mode Économie → les pilules sont là tout de suite, sans animation.
- Style épuré → les pilules du dépôt gardent leurs icônes au trait.
- Style Studio → flou derrière les pilules ; autres styles → pas de flou. Thème clair de l'île → pilules lisibles.
- Ondine en anglais → « Shrink », « A single PDF », « 3.4 MB → 820 KB », « Oops, I can't do it ». Tutoiement → l'aide du réglage dit « survole ».
- Lecteur d'écran → le résultat est annoncé.
- Échelle 125 %, 150 %, deuxième écran → les boutons de la pilule de résultat se cliquent (pas de clic qui traverse).

## 6. Confidentialité et performance
- Le journal (`ondine.log`) : « conversion Jpg de 1 élément(s) », « finie : 1/1 réussie(s) », jamais un nom ni un chemin.
- Pare-feu ou réseau coupé → tout marche pareil (rien ne part sur Internet).
- Rien n'est glissé → aucune charge en plus. Une vidéo d'une heure → l'île reste fluide.
