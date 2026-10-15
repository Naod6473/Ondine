# Tests Windows 1.2.5 : Ondine convertit

À vérifier sur Windows (le conteneur Linux ne peut pas le faire). Résultat attendu après la flèche.
Réglages → Modules → Ondine convertit : allumé par défaut. Préparer un dossier avec : une photo d'iPhone .heic, un .jpg avec position GPS, un .png, un .avif, un .tif, un PDF de 3 pages, un PDF protégé par mot de passe, une vidéo .mp4 et une .mov, un .wav, un .zip, un fichier .jpg abîmé (un .txt renommé).

## 1. Les pilules
- Glisser le .heic depuis l'Explorateur vers l'île (cachée, mini, puis ouverte) → l'île s'ouvre en mode dépôt (un peu moins haute, cibles en ligne), Ondine est surprise, les pilules sortent en éventail sous l'île une à une : JPG, PNG, WebP, PDF, Alléger, GIF, BMP, TIFF, ICO, puis « Conserver à côté ».
- Survoler une pilule → elle s'allume, les autres pâlissent, Ondine écoute, petit son.
- Survoler « Conserver à côté » une demi-seconde → un trait se remplit, la pilule tourne : « Remplacer l'original », puis « Sur le bureau », puis à nouveau « Conserver à côté ».
- Appuyer sur Maj pendant le glisser → « Remplacer l'original ».
- Glisser 3 photos → « Un seul PDF » et « Un seul ZIP ». Un .jpg et un .mp3 ensemble → seulement « Un seul ZIP ». Un .zip → « Extraire ».
- Choisir WebP pour un .heic, puis glisser un autre .heic → WebP est la première pilule.
- Île en bas de l'écran → les pilules sortent au-dessus. Île à gauche ou à droite → pas de pilules, l'Étagère marche comme avant.
- Module coupé → pas de pilules, l'Étagère marche comme avant.

## 2. Coexistence avec l'Étagère
- Lâcher dans l'île sur « Étagère » ou « Copier vers… » → comme avant, rien n'est converti.
- Lâcher sur une pilule → conversion, l'Étagère ne reçoit rien.
- Lâcher ailleurs (ni pilule ni cible) → rien, l'île se referme, pas de notification.
- Repartir sans lâcher → les pilules rentrent, l'île se referme.

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
- Lancer une conversion pendant qu'une autre tourne → pas de pilules (l'Étagère reste là).

## 4. Remplacer et Sur le bureau
- Remplacer : .png → JPG → l'original part à la Corbeille, la pilule dit « L'original est dans la Corbeille » ; « Annuler » → le .png revient à sa place, le .jpg part à la Corbeille.
- Remplacer avec un .heic → JPG → le .jpg prend le nom « photo.jpg » ; l'original .heic est dans la Corbeille.
- Clé USB sans Corbeille → l'original reste à sa place, la pilule le dit.
- Sur le bureau → le fichier est posé sur le Bureau (OneDrive compris), l'arc part vers la droite.

## 5. Accessibilité, styles, langue
- « Réduire les animations » de Windows ou mode Calme → les mêmes étapes en fondus, pas d'arc ni de paillettes, Ondine ne grimace pas.
- Style Studio → flou derrière les pilules ; autres styles → pas de flou. Thème clair de l'île → pilules lisibles.
- Ondine en anglais → « Shrink », « A single PDF », « 3.4 MB → 820 KB », « Oops, I can't do it ». Tutoiement → l'aide du réglage dit « survole ».
- Lecteur d'écran → le résultat est annoncé.
- Échelle 125 %, 150 %, deuxième écran → les pilules sont sous la souris là où on les voit ; les boutons de la pilule de résultat se cliquent (pas de clic qui traverse).

## 6. Confidentialité et performance
- Le journal (`ondine.log`) : « conversion Jpg de 1 élément(s) », « finie : 1/1 réussie(s) », jamais un nom ni un chemin.
- Pare-feu ou réseau coupé → tout marche pareil (rien ne part sur Internet).
- Rien n'est glissé → aucune charge en plus. Une vidéo d'une heure → l'île reste fluide.
