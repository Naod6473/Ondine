# Tests sous Windows : l'onglet Agents IA en pilules (1.2.4)

Captures avant / après : `captures-agents-pilules/` (avant-*.png, apres-*.png).

## Rien de branché

1. Pour repartir de zéro : Options avancées → « Retirer » sur chaque agent
   branché (ou un profil Windows neuf). Ouvrir l'île → onglet Agents IA.
   Attendu : en haut, trois pilules (Claude Code, Codex, Gemini CLI) et « ＋ » ;
   à droite, de petites pilules (forfait, « Jetons », la concentration 🎧, et
   « GitHub » seulement si un identifiant est réglé). Dessous, une seule
   phrase : « Choisissez un agent pour le brancher ou le lancer. »
   Plus de grand guide en bas de l'onglet.
2. Survoler une pilule : elle prend la couleur de son agent (orange pour
   Claude, vert d'eau pour Codex, bleu pour Gemini).

## Premier clic

3. Cliquer sur Claude Code. Attendu : la pilule est mise en avant, et une
   petite carte : « Claude Code · L'île saura quand il attend ou a fini. »,
   « Brancher Claude Code », « Plus tard », « Options avancées » replié.
4. « Brancher Claude Code » → « Modifier son fichier de réglages ? »
   « Confirmer » / « Annuler ». « Annuler » revient en arrière.
5. « Confirmer ». Attendu : notification « Hooks installés · Relancez Claude
   Code… », un `settings.ondine-<date>.bak` à côté de
   `%USERPROFILE%\.claude\settings.json`, vos autres réglages gardés ; la carte
   laisse place à la carte de Claude Code (« Aucune session », la ligne
   « ▶ projet · Lancer »).
6. Cliquer sur Codex, puis « Plus tard ». Attendu : sa carte normale, avec un
   lien « Brancher » en haut à droite. Fermer et rouvrir l'île : pas de carte
   « Brancher » pour Codex (le « Plus tard » est retenu), et la pilule choisie
   en dernier est toujours au premier plan.

## Options avancées

7. Sur la carte de Claude Code, cliquer sur « Configurer ». Attendu : la carte
   « Brancher » avec « Fermer » ; « Options avancées » montre l'état
   (« Installé · C:\…\settings.json »), « Copier la configuration »,
   « Copier la config MCP », « Copier le hook d'autorisation », « Retirer »,
   « Essayer » et la ligne `…\ondine.exe notify`. Les explications sont dans
   les bulles (survol).
8. « Essayer » : une notification « Claude a fini ». « Copier la config
   MCP » : la commande est dans le presse-papiers.
9. Réglages → Agents IA → activer « Autoriser / Refuser depuis l'île ».
   Attendu : la carte de Claude Code redevient « Il manque une nouveauté :
   rebranchez-le. » avec « Rebrancher Claude Code ».

## Une session

10. Lancer Claude Code depuis la ligne « Lancer » (choisir un projet dans la
    liste, ou « Autre dossier… »). Lui faire faire une tâche avec une liste de
    tâches. Attendu : la pilule Claude Code passe en tête, son logo respire ;
    la carte montre la session (point vert, projet, « travaille depuis… »,
    « ↗ Y aller », « VS Code »), la barre « 3/7 » et la tâche en cours, les
    fichiers modifiés en direct.
11. Lui faire demander une permission (mode normal). Attendu : badge orange
    « ! » sur la pilule ; si « Autoriser / Refuser » est activé, la question
    est en haut de la carte avec « Autoriser… » (confirmation sur place) /
    « Refuser » / « Au terminal ». Attendre 10 secondes : la confirmation
    « Vraiment autoriser ? » ne se referme pas toute seule.
12. Ouvrir une deuxième session de Claude Code : la pilule montre « 2 ».
13. Quand Claude a fini : badge vert « ✓ ». Sur la session : « ↻ Reprendre »
    et la dernière phrase en petit. Les derniers messages de Claude seulement,
    3 au plus, puis « Afficher N de plus ».
14. Clavier : Tab jusqu'à une pilule, flèches gauche / droite pour passer de
    l'une à l'autre, Entrée pour la choisir.

## Petites pilules de droite

15. Avec la ligne d'état branchée (carte du forfait) : la pilule montre
    « 5 h · 42 % » (jaune dès 75 %, rouge dès 90 %). Un clic : la carte des
    limites (Claude et Codex) à la place de celle de l'agent, « ‹ » pour
    revenir. Codex a sa propre petite pilule seulement s'il a des chiffres.
16. « Jetons » : le compteur et sa courbe. « GitHub » : le calendrier.
17. 🎧 : « 25 min / 1 h / 2 h / Jusqu'à l'arrêt ». Pendant la concentration,
    la pilule est violette avec l'heure de fin ; « Arrêter » dans sa carte.

## Ajouter un outil

18. « ＋ » : la liste des autres outils (Copilot CLI, Cursor CLI…). Cliquer
    sur Aider : sa pilule s'ajoute et sa carte montre « Lancer ». « Configurer »
    → Options avancées : la ligne à lancer en fin de tâche et « Retirer de la
    rangée ».
19. Ajouter Cursor CLI : sa carte « Brancher Cursor CLI » s'ouvre.

## Mini-île et accessibilité

20. Une notification de Claude en mini-île (pack « Épurées ») : le logo est
    orange ; Codex vert d'eau. Pack couleur : un léger halo de la même couleur.
21. Windows → Accessibilité → Effets d'animation désactivés : plus de fondu
    entre les cartes ni de respiration du logo.
22. Langue anglaise et tutoiement : les textes de l'onglet sont traduits
    (« Connect Claude Code », « Later », « Advanced options » ; « Choisis un
    agent… »).
