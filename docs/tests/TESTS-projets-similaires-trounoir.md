# Tests Windows 1.2.5 : le trou noir (Ondine et les fenêtres)

À vérifier sur Windows (le conteneur Linux ne peut pas le faire). Résultat attendu après la flèche.
Réglages → Modules → Ondine et les fenêtres → allumer « Avaler une fenêtre lâchée sur l'île » (coupé par défaut).

## 1. Avaler
- Ouvrir le Bloc-notes, le glisser par sa barre de titre jusque sur l'île (en mini, cachée en bande, puis ouverte) et l'y garder un instant → l'île se montre si elle était cachée, s'assombrit avec un halo violet, Ondine ouvre la bouche.
- Lâcher → la fenêtre disparaît de l'écran, de la barre des tâches et d'Alt+Tab ; Ondine mange ; l'île fait « gloups ». Le Bloc-notes tourne toujours (Gestionnaire des tâches).
- Glisser une fenêtre vers le haut et la lâcher tout de suite sur l'île (geste « agrandir » de Windows) → elle n'est PAS avalée (il faut rester 0,3 s au-dessus).
- Glisser au-dessus de l'île puis repartir et lâcher ailleurs → rien n'est avalé, l'île reprend sa couleur.
- Redimensionner une fenêtre par un bord jusque sur l'île → jamais avalée.
- Recommencer avec l'île en bas, à gauche, à droite, à 100 %, 125 %, 150 %, et sur un deuxième écran → même chose.

## 2. Ce qui n'est jamais avalé
- Les Réglages d'Ondine, une fenêtre d'Ondine → rien (pas d'assombrissement).
- Une fenêtre en plein écran, l'Explorateur en mode bureau, la barre des tâches → rien.
- Une boîte de dialogue (Enregistrer sous… du Bloc-notes) → rien.
- Calculatrice ou Paramètres (applis du Store) → rien.
- Une fenêtre lancée « en tant qu'administrateur » (Ondine normale) → rien.
- Ondine lancée en administrateur : une fenêtre administrateur → avalée et recrachée normalement.

## 3. La liste et recracher
- Avaler 2 ou 3 fenêtres → la mini-île montre 🕳️, la pastille violette avec le nombre et les icônes (le titre en infobulle).
- Cliquer une icône → la fenêtre réapparaît à sa place d'avant le glisser (pas sur l'île), au premier plan, avec le focus ; Ondine la repousse, l'île brille un instant.
- Une fenêtre agrandie avant le glisser → ressort agrandie.
- Accueil → carte « Trou noir » : le nombre, les titres ; « Recracher la dernière », « Tout recracher » marchent.
- Icône de la zone de notification → « Tout recracher (n) » apparaît seulement s'il y a des fenêtres ; un clic les rend toutes.
- Fermer une fenêtre avalée depuis son programme (ex. Gestionnaire des tâches → Fin de tâche) → elle sort de la liste en une seconde.
- Mode Calme → la liste marche, Ondine ne fait pas de grimaces.

## 4. Tout ressort
- Avaler 2 fenêtres, puis Quitter (menu de l'icône) → elles réapparaissent à leur place, sans voler le focus.
- Avaler, puis couper le réglage → elles réapparaissent. Pareil en coupant le module entier.
- Avaler, puis Installer une mise à jour (si une est disponible) → elles réapparaissent avant l'installateur.
- Avaler 2 fenêtres, puis tuer ondine.exe dans le Gestionnaire des tâches → elles restent cachées ; relancer Ondine → elles réapparaissent tout de suite. `%APPDATA%\Ondine\trou-noir.json` existe pendant qu'elles sont avalées, puis disparaît.
- Même scénario mais fermer une des fenêtres (Fin de tâche de son programme) avant de relancer Ondine → aucune erreur, seule l'autre réapparaît.
- Le journal (`ondine.log`) : « trou noir : … » avec des nombres, jamais un titre de fenêtre.

## 5. Performance
- Réglage allumé, rien n'est déplacé → aucune charge en plus (Gestionnaire des tâches : CPU d'Ondine au repos inchangé).
- Pendant un glisser → déplacement fluide de la fenêtre, pas de saccade de la souris.
