# Tests Windows 1.2.2 : premier lancement (zone « accueil »)

Ce qui ne peut pas être vérifié sous Linux (aucun navigateur ici : le panneau
n'a été vu par personne, à regarder en premier). Pour le voir sans
réinstaller : Réglages → Général → Premiers pas → « Refaire l'assistant », ou
Mode démo → « Premier lancement » (rien n'est enregistré).

## Vrai premier lancement
1. Renommer `%APPDATA%\Ondine\settings.json` (le remettre après), lancer Ondine. Attendu : l'île s'ouvre en grand toute seule avec « Bonjour, je suis Ondine. Et vous ? », le champ prénom a déjà le curseur (on peut taper tout de suite), la mascotte fait coucou. L'ancien mot de bienvenue n'apparaît plus.
2. Taper un prénom, Entrée : étape 2. Les points d'étape glissent (pastille qui s'étire), l'étape sort d'un côté pendant que la suivante arrive, et l'île change de hauteur avec un rebond doux. Rien ne déborde ni n'est coupé, à aucune étape (les hauteurs sont estimées, pas mesurées).
3. Langue English : tout le panneau passe en anglais sur place ; Français + « en vous tutoyant » : les textes passent au tu.
4. Étape 2 : sur un PC avec VS Code / Claude Code, Spotify, Teams ou PuTTY, les cartes Développement, Musique, Réunions, IT sont pré-cochées avec un petit ✓ « Trouvé sur ce PC » (après 1 à 2 s au plus). Cocher / décocher : la rangée d'icônes « N onglets » suit, les nouvelles icônes arrivent avec un rebond.
5. Continuer avec Bureautique seule : l'île n'a plus que Parler à Ondine + les onglets de Bureautique, dans cet ordre ; Réglages → Onglets montre les autres éteints ; Équipe n'a pas bougé. Avec Bureautique + Musique : Réglages → Profils contient « Travail » et « Maison » (non actifs, sans règle). Aucune carte + Continuer : 3 onglets (Parler à Ondine, Étagère, Notes). « Passer » : rien ne change.
6. Étape 3 : les mascottes bougent ; « Adopter » change la mascotte de l'île tout de suite.
7. Étape 4 : « En bas », « À gauche »… : l'île part au bord choisi pendant l'assistant et le panneau reste lisible ; « Épurées » : les icônes de l'aperçu passent au trait.
8. Étape 5 : coller une clé, « Continuer » sans cliquer « Enregistrer » : la clé est enregistrée quand même (Gestionnaire d'identifiants Windows → « anthropic-api-key »), elle n'apparaît pas dans settings.json. Parler à Ondine répond ensuite.
9. « C'est prêt, Simon ! », la rangée des onglets, « Ouvrir l'île » : l'île s'ouvre sur le premier onglet, avec le focus clavier ; le premier mot de Parler à Ondine dit « Bonjour Simon ! ».
10. Relancer Ondine : plus d'assistant. Quitter Ondine au milieu de l'assistant puis relancer : il revient.
11. Pendant l'assistant, × ou Échap : il se ferme, ne revient pas au démarrage suivant, rien d'autre n'a changé. Le focus revient à la fenêtre d'avant (le texte tapé ensuite va dans l'appli d'avant, pas dans l'île).

## Reprendre la configuration d'un autre PC
12. Sur un PC : Réglages → Sauvegarde → Exporter. Sur l'autre (premier lancement) : « Reprendre la configuration de mon autre PC », choisir le .json : la boîte « Ouvrir » s'affiche devant l'île, puis « Vos réglages de l'autre PC sont là. » ; onglets, mascotte, prénom sont ceux de l'autre PC. Un fichier d'un dossier exclu (Confidentialité) est refusé.

## Installation existante
13. Mettre à jour depuis 1.2.1 : pas d'assistant (« Quoi de neuf » comme d'habitude). Réglages → Général : Prénom (vide) et « Refaire l'assistant », qui l'ouvre dans l'île.

## Le prénom ailleurs
14. Prénom rempli : bonjour du matin « Bonjour Simon ! » (Animations de l'île), titre du bilan « Le bilan de votre semaine, Simon » (Réglages → Bilan → Voir maintenant), bulle d'Ondine sur le bureau : « 👋 Bonjour Simon ! » en haut à la première ouverture du jour. Prénom vide : comme avant.

## Propositions (Réglages → Onglets → Propositions)
15. Contrôles éteint, brancher une clé USB (après l'assistant) : en ~6 s, « Une clé USB ! Voulez-vous l'onglet Contrôles ? » ; « Ajouter l'onglet » allume Contrôles et ouvre l'île dessus. Rebrancher : plus jamais proposé.
16. Contrôles éteint, lancer une visio (caméra ou micro dans Teams/Zoom) : « Une visio ? … » une seule fois. La dictée d'Ondine seule ne la déclenche pas.
17. Étagère éteinte, glisser un fichier sur l'île : « Voulez-vous l'Étagère ? » une fois.
18. Onglet oublié : fermer Ondine, mettre dans settings.json `"usageSince": 20000` (island) et rien pour un onglet dans `tabSeenAt`, relancer, attendre 1 min 30 : « Masquer l'onglet … ? » ; « Masquer » l'éteint, « Le garder » ne fait rien ; jamais deux fois pour le même onglet.
19. « Propositions d'Ondine » coupé : plus rien de tout ça. « Revoir les propositions » : elles peuvent revenir.
20. Gestionnaire des tâches : avec Contrôles allumé ou toutes les propositions faites, le fil des bons moments ne fait plus rien (pas de CPU en plus).

## Animations
21. Windows → Effets d'animation désactivés, OU mascotte en Calme : l'assistant change d'étape d'un coup, sans glissement ni rebond, la pastille saute directement.
