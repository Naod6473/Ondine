# Tests Windows 1.2.5 : les mini-jeux (module Jeux)

À vérifier sur Windows (le conteneur Linux ne peut pas le faire). Résultat attendu après la flèche.
Réglages → Modules → Jeux : allumé par défaut, catégorie « Au quotidien ».

## 1. Lancer
- Ouvrir l'île → un onglet « Jeux » (icône manette au trait) avec quatre pastilles : Puissance 4, Morpion, Aquarium, Course.
- Lanceur : taper « jouer », « puissance 4 », « aquarium », « course » → l'action apparaît ; Entrée → l'onglet Jeux s'ouvre sur ce jeu.
- Lanceur : « morpion » → « Morpion express » ; Entrée → le Lanceur se ferme, la mini-île montre la grille.
- Appui long (un peu plus d'une demi-seconde, sans bouger) sur Ondine dans l'île → morpion express. Un clic court → les réactions habituelles ; un glisser → Ondine se déplace comme avant, pas de morpion.
- Couper un jeu dans les réglages → sa pastille et son action du Lanceur disparaissent ; couper « Morpion express » → l'appui long ne fait plus rien.

## 2. Puissance 4
- Cliquer une colonne (ou ← → puis Entrée, ou 1 à 7) → la goutte tombe en gelée, rebondit, s'écrase un peu.
- Ondine réfléchit (visage pensif), regarde une ou deux colonnes, puis celle qu'elle joue, et y lâche sa goutte.
- Gagner → Ondine boude ; perdre → elle fait la fête ; nul → elle est gênée. La ligne gagnante brille ; le score « Vous · Ondine · Nuls » se met à jour ; « +N 💧 » s'affiche si l'aquarium y gagne.
- Facile → on la bat sans effort. Malin → elle répond en moins d'une seconde même en milieu de partie, et bat un joueur moyen.
- Changer de niveau en cours de partie → s'applique à la partie suivante ; « Rejouer » → nouvelle partie, celui qui commence alterne.
- Fermer l'onglet en pleine partie, le rouvrir → la partie est là.

## 3. Morpion
- Onglet Morpion → vous jouez ✕, Ondine ○ ; en Malin, impossible de la battre (10 parties) ; en Facile, elle laisse passer des coups.
- « Dans la mini-île » → la partie express s'ouvre dans la mini-île.
- Express : la barre se vide en 30 s et repart à chaque coup ; 30 s sans jouer → la mini-île se range seule. Partie finie → le résultat reste ~3 s puis une petite notification le rappelle.
- La croix de l'alerte → elle se ferme sans erreur.

## 4. Aquarium
- Ouvrir la pastille → l'aquarium (eau, sable, poissons, bulles, Ondine qui nage) ; le nombre de gouttes, le niveau, « Encore N gouttes pour grandir ».
- Lancer Claude Code, attendre qu'il ait fini une tâche (notification « fini » allumée) → +5 gouttes, sans notification de plus.
- S'absenter 5 min et revenir → +3 gouttes (une fois par absence, pas plus d'une fois toutes les 20 min).
- Finir un Pomodoro → +4 gouttes. Gagner une partie → les gouttes du niveau.
- Plus de 150 gouttes gagnées dans la journée → les gains s'arrêtent jusqu'au lendemain.
- Acheter un décor → il apparaît dans l'aquarium ; un accessoire → Ondine le porte ; « Porter dans l'île » → Ondine le porte aussi dans l'île (Réglages → Apparence suit).
- Pas assez de gouttes → l'infobulle du bouton dit « Pas assez de gouttes », un clic ne débite rien.
- Quitter Ondine et relancer → gouttes, objets et tenue sont là. `%APPDATA%\Ondine\games.json` ne contient que des nombres et des noms d'objets.
- Abîmer `games.json` (texte au hasard) puis relancer → un aquarium vide, l'ancien fichier mis de côté, pas de plantage.
- Réduire les animations (Windows) → l'aquarium est une image fixe ; mode Calme → plus lent ; Économie d'énergie → moins de bulles.

## 5. Course de gouttes
- Demander à Claude Code un travail avec une liste d'au moins 3 tâches → la pastille Course montre « Claude Code · 0/5 » et 4 gouttes au départ.
- Parier sur une couleur avant la mi-course → la pastille se colore ; après la mi-course → les paris sont fermés.
- Chaque tâche finie → les gouttes avancent (au hasard). Liste finie → l'arrivée, la gagnante rebondit ; si vous aviez parié sur elle → +8 gouttes (2e → +2).
- Onglet fermé pendant l'arrivée → une petite notification 🏁 ; onglet ouvert → pas de notification.
- Arrêter la session de l'agent avant la fin → la course disparaît sans gagnante.

## 6. Pause et silence
- Pendant un appel Teams/Zoom (micro utilisé) ou des Notes d'appel qui enregistrent → les jeux affichent « En pause pendant l'appel », plus de sons ni de grimaces ; le morpion express se range.
- PowerPoint en diaporama, une vidéo ou un jeu en plein écran → même chose (« pendant la présentation »).
- Fin de l'appel → on reprend où on en était.
- Réglage « Sons des jeux » coupé → aucun son.

## 7. Langues et mode démo
- Langue anglaise → tous les textes des jeux en anglais ; « tutoiement » → « À toi de jouer », « Tu as gagné ! ».
- Mode démo → un aquarium déjà garni (46 gouttes), une course de démonstration qui avance seule ; rien n'est écrit dans `games.json`.

## 8. Performance
- Onglet Jeux fermé → aucune charge (Gestionnaire des tâches : CPU d'Ondine au repos inchangé).
- Aquarium ouvert → l'animation reste fluide, CPU raisonnable ; île cachée → elle s'arrête.
