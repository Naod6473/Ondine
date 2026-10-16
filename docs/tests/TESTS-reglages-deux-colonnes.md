# Tests Windows : Réglages en deux colonnes (1.2.4)

À vérifier sur Windows (WebView2), en thème sombre puis clair, avec un
fichier de réglages d'avant (1.2.4) : rien ne doit être perdu.

| # | Quoi faire | Résultat attendu |
|---|---|---|
| 1 | Mettre à jour depuis 1.2.4, ouvrir les Réglages. | La fenêtre s'ouvre sur la dernière page vue. À gauche : la recherche, sept rubriques (Ondine, Voix, L'île, Automatiser, Modules, Système, À propos), Simple / Complet en bas. Tous les réglages d'avant sont à leur valeur. |
| 2 | Cliquer chaque rubrique l'une après l'autre. | La 2e colonne montre les pages de la rubrique, en cascade ; la pastille en verre glisse dans la 1re colonne en s'étirant comme une goutte. Rien ne se déplie dans la 1re colonne. |
| 3 | Modules. | Les pages sont rangées sous les titres IA, Fichiers, Organisation, Outils IT, Le PC au quotidien. Dictée et Notes d'appel n'y sont pas (elles sont dans Voix). |
| 4 | Modules → Agents IA, puis un de ses sous-menus. | Les sous-menus se déplient sous « Agents IA » dans la 2e colonne, en cascade ; la page n'affiche que le sous-menu choisi ; la pastille glisse dans la 2e colonne. |
| 5 | Aller d'une page à une page plus bas, puis remonter. | La page arrive de la droite en descendant, de la gauche en remontant. |
| 6 | Fil d'Ariane en haut de la page : cliquer la rubrique, puis la page. | La rubrique mène à sa première page, la page à son premier sous-menu. Le dernier morceau n'est pas cliquable. |
| 7 | Changer de rubrique, revenir à L'île. | L'île rouvre la dernière page vue dans L'île. Fermer et rouvrir les Réglages : même page, même sous-menu. |
| 8 | Bouton « retour » de la souris (sur le côté), puis « suivant ». Puis Alt+← et Alt+→. | Retour à la page d'avant, puis de nouveau la page d'après ; même chose au clavier. |
| 9 | Ouvrir un menu de choix (ex. Langue, Performances). | Une liste en verre sort de la pilule avec un ressort ; coche sur le choix actuel ; une pastille suit la souris. Choisir : la valeur change et est enregistrée comme avant. |
| 10 | Menu de choix au clavier : Tab jusqu'à la pilule, ↓, ↓, Entrée ; puis rouvrir et Échap. | ↓ ouvre, ↓ descend, Entrée choisit et referme ; Échap referme sans rien changer ; Tab referme et passe au champ suivant. Narrateur annonce une liste et le choix. |
| 11 | Changer un réglage (ex. Thème). | Une bulle « Thème modifié · Annuler » apparaît en bas quelques secondes ; la ligne porte « Modifié » et « Réinitialiser ». |
| 12 | Ctrl+Z, puis Ctrl+Y. | Le thème revient, puis repasse au nouveau. Ctrl+Z dans un champ de texte (prénom, recherche) annule la frappe, pas un réglage. |
| 13 | « Réinitialiser » sur une ligne modifiée ; « Réinitialiser la page » en haut d'Apparence. | La ligne reprend sa valeur d'origine. Pour la page : une confirmation s'affiche dans la page (pas de fenêtre Windows) ; confirmer remet toutes les lignes modifiées ; Ctrl+Z les rend. |
| 14 | Ctrl+K depuis n'importe quelle page ; puis « / » hors d'un champ de texte. | Le curseur va dans la recherche. Taper « sons » : « Sons de clic » a son interrupteur dans le résultat, qui se change sans quitter la recherche. |
| 15 | Animations et halos → préréglage « Calme », puis « Tout animé », puis Ctrl+Z. | Calme : halo discret, musique, ciel, Verr Maj… coupés, agents et minuteurs gardés. Tout animé : tout allumé. Ctrl+Z revient à Calme en une fois. Changer un moment à la main : « Personnalisé ». |
| 16 | Apparence et Comportement : Thème, Style de l'île, Style des icônes, Bord de l'écran. | Des vignettes au trait ; cliquer ou flèches change le choix et l'île suit. La mascotte garde son podium. |
| 17 | Une page de module longue (ex. Presse-papiers) : défiler. | La ligne « Activé » et les permissions en pilules restent collées en haut. |
| 18 | Réduire la fenêtre sous 900 px de large, puis sous 700 px. | Sous 900 : les pages de la rubrique en bande au-dessus du contenu, les sous-menus en pilules. Sous 700 : la 1re colonne ne garde que les icônes. Aucun défilement de côté. |
| 19 | Performances → mode Économie. | Plus de flou derrière les colonnes, le fond ne bouge plus, la pastille saute sans glisser. Réglages Windows → Accessibilité → Effets d'animation coupés : pareil pour le mouvement. |
| 20 | Fond des Réglages en « blobs » et en « deep », avec Mica. | Les colonnes restent lisibles ; en sombre le fond reste noir profond. Le défilement reste fluide (pas de saccade due au flou). |
| 21 | En anglais (Langue : English) et au tutoiement. | Les rubriques, le fil d'Ariane, « Modifié », « Annuler », les préréglages sont traduits ; au tutoiement « tes propres réglages », « qui te servent ». |
| 22 | Lien profond (une notification qui ouvre une page de réglage, « settings.goto »). | La bonne rubrique, la bonne page et le bon sous-menu s'ouvrent ; la ligne brille. |
