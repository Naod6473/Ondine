# Tests sous Windows : liste de tâches des agents et discrétion (1.2.4)

À faire avec Claude Code (récent), et si possible Codex et Gemini CLI.

## Préparer

1. Onglet Agents IA → pilule Claude Code. Avec des hooks installés par la
   1.2.4, sa carte dit « Il manque une nouveauté : rebranchez-le. »
   (depuis la refonte en pilules, voir TESTS-agents-pilules.md).
2. Cliquer sur « Rebrancher Claude Code » puis « Confirmer ». Attendu : la
   carte de l'agent revient (Options avancées : « Installé ») ; un
   `settings.ondine-<date>.bak` à côté de `%USERPROFILE%\.claude\settings.json` ;
   dans le fichier, `PostToolUse` a le matcher
   `Edit|MultiEdit|Write|TodoWrite|TaskCreate|TaskUpdate|TaskList` et vos
   autres hooks sont gardés.
3. Relancer Claude Code.

## Liste de tâches

4. Demander à Claude une tâche en plusieurs étapes (« fais une liste de 4
   tâches puis traite-les une par une »). Attendu : sous la session (carte de
   l'agent), une barre fine « 0/4 » puis « 1/4 »… et à côté le texte de la
   tâche en cours (« Lit le code… »). Un fin liseré bleu autour de l'île
   avance avec les tâches (case « Agents IA : au travail… » des Animations).
5. À la fin (4/4, ou « Claude a fini ») : le liseré s'éteint ; la barre reste
   verte « 4/4 » sur la carte.
6. Si votre Claude Code utilise TaskCreate / TaskUpdate (selon la version) :
   même résultat, les tâches retirées ne comptent plus.
7. Quitter Claude Code (`/exit`) : la session et sa barre disparaissent.
8. Réglages → Agents IA → Notifications → décocher « Montrer la liste de
   tâches de l'agent » : plus de barre ni de liseré.
9. Codex : réinstaller ses hooks, approuver le nouveau hook dans `/hooks`,
   demander une tâche avec un plan. Attendu : la barre « 2/5 » avec l'étape en
   cours. Si rien n'apparaît, le noter (le hook PostToolUse de Codex pour
   `update_plan` n'a pas pu être essayé).
10. Gemini CLI : réinstaller, demander une tâche qui utilise sa liste de
    tâches (`write_todos`). Attendu : la barre.

## Discrétion devant le terminal

11. Lancer une tâche dans Claude Code et RESTER sur sa fenêtre de terminal
    jusqu'à « a fini ». Attendu : pas de son, pas de notification, pas de
    halo ni de fête de la mascotte ; la carte passe quand même à « a fini »
    (ouvrir l'île pour vérifier).
12. Refaire en passant sur une autre fenêtre (navigateur) avant la fin.
    Attendu : notification « Claude a fini » comme avant.
13. Même chose avec « vous attend » (une permission demandée) : silence si
    vous êtes sur la fenêtre, notification sinon. Rester 10 min sur une autre
    fenêtre : le rappel « attend toujours » arrive.
14. Deux sessions dans deux onglets d'un même Windows Terminal : la fin de
    l'une, onglet affiché ou non, donne une notification (Ondine ne sait pas
    quel onglet est devant).
15. Claude Code dans le terminal intégré de VS Code, VS Code devant :
    discrète. Autre fenêtre devant : notification.
16. Décocher « Rester discrète quand vous regardez déjà le terminal » :
    notifications comme avant, même devant le terminal.
17. « Y aller » marche toujours (la recherche de fenêtre a été partagée).
