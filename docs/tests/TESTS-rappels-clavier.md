# Tests Windows : rappels des tâches et langue du clavier

Avant de commencer, quittez toutes les Ondine (Gestionnaire des tâches), puis lancez `npm.cmd run tauri dev`. Pour la langue du clavier, ajoutez une 2e langue dans Windows (Paramètres → Heure et langue → Langue et région, par exemple Anglais (États-Unis)).

## Rappels des tâches (onglet Notes → À faire)

1. Survolez une tâche : une petite horloge apparaît à droite, avant le ×. Cliquez dessus : un choix s'ouvre sous la tâche (jour = aujourd'hui, heure vide, « Dans 30 min », « Ce soir 18:00 » avant 18 h, « Demain 9:00 »).
2. Choisissez « Dans 30 min » : l'heure s'affiche à droite de la ligne, en jaune (moins de 30 min).
3. Rouvrez l'horloge, mettez une heure dans 2 minutes, « Valider » (ou Entrée). Échap referme le choix sans fermer l'île.
4. À l'heure (à 15 s près), l'île s'ouvre en alerte : le texte de la tâche, « Il est 15:00 », boutons « 10 min » et « Fait ».
5. « 10 min » : l'heure de la tâche avance de 10 minutes. Au rappel suivant, « Fait » : la tâche est cochée, son heure reste éteinte, sans horloge.
6. Décochez une tâche faite dont l'heure est passée : pas d'alerte en retard.
7. Une tâche avec une heure dans 3 min, lancez un Pomodoro (concentration) : rien à l'heure. Arrêtez le Pomodoro : l'alerte arrive (« Prévu à … » si plus de 2 min de retard).
8. Pareil avec un diaporama PowerPoint ou une vidéo en plein écran : rien pendant, l'alerte après.
9. Deux tâches avec une heure dans 2 min, mettez le PC en veille 5 min puis réveillez-le : une seule alerte « 2 rappels manqués », avec « Voir les tâches ».
10. Quittez Ondine avant l'heure d'un rappel, relancez-la après : le rappel manqué arrive dans les 15 s.
11. « Retirer le rappel » (dans le choix de l'heure) : l'heure disparaît de la ligne.
12. Le fichier %APPDATA%\Ondine\notes.json d'avant (sans heures) se relit tel quel ; une tâche sans heure n'y gagne aucun champ.
13. Style Encoche puis Classique : l'horloge, l'heure jaune et le choix de l'heure sont lisibles dans les deux.
14. Langue de l'appli en anglais : « In 30 min », « Tomorrow 9:00 », « It's 15:00 », « 2 missed reminders ».

## Langue du clavier

15. Dans le Bloc-notes, faites Win + Espace (ou Alt + Maj) pour passer en anglais : un aperçu court « Clavier en anglais », pastilles FR puis EN (EN allumée), avec une comète bleue comme pour Verr Maj.
16. Revenez en français : « Clavier en français », pastilles EN puis FR.
17. Lancement d'Ondine : aucun aperçu.
18. Réglez Windows sur « Utiliser une méthode d'entrée différente pour chaque fenêtre » (Paramètres → Heure et langue → Saisie → Paramètres de clavier avancés). Mettez une fenêtre en anglais, une autre en français, passez de l'une à l'autre (Alt + Tab) : aucun aperçu.
19. Avec le réglage Windows par défaut (même langue partout) : changez de langue dans une fenêtre, puis passez à une autre : un seul aperçu (celui du changement).
20. Réglages → Animations et halos → Son et clavier : décochez « Langue du clavier » : plus d'aperçu. Recochez.
21. Testez aussi une appli du Store (Calculatrice) et une console (Terminal) : notez si l'aperçu vient ou non (ces fenêtres peuvent ne pas donner leur langue).
