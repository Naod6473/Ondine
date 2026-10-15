# Tests 1.2.4 — version 1.2.4 (limites du forfait, fichiers modifiés en direct, modèles locaux, vos propres sons)

Pour tester :

```
git fetch
git checkout version-1-2-4
npm install
npm run tauri dev
```

Coche chaque ligne qui marche ; pour les autres, note ce que tu vois (ou une
capture). Tout a été développé sous Linux : **rien n'a encore tourné sous
Windows**. Les lignes **⚠** touchent une API Windows, un outil externe
(Claude Code, Codex, Gemini CLI, Ollama, LM Studio) ou une adresse Internet
que je n'ai pas pu essayer : à regarder en premier.

---

## 1. Limites du forfait (onglet Agents IA)

1. ☐ Onglet Agents IA : le bloc « Limites du forfait » est au-dessus du
   compteur de jetons, avec une carte Claude et une carte Codex.
2. ☐ ⚠ **Brancher la ligne d'état** (Claude) : le bouton écrit
   `statusLine` dans `%USERPROFILE%\.claude\settings.json` ; une copie
   `.bak` est faite à côté ; le reste du fichier (hooks, modèle…) est
   intact.
3. ☐ ⚠ Avec un forfait Pro ou Max : lancer `claude`, envoyer un message.
   Dans les secondes qui suivent, la carte Claude montre « 5 h » et
   « Semaine » en %, avec « remise à zéro dans … ».
4. ☐ ⚠ Une ligne d'état à vous existait avant : elle continue de s'afficher
   dans Claude Code (relancée par Ondine), et revient seule après
   « Débrancher ».
5. ☐ ⚠ **Débrancher** : `statusLine` retrouve sa valeur d'avant (ou
   disparaît s'il n'y en avait pas) ; une copie `.bak` est faite.
6. ☐ Couleurs : jauge normale sous 75 %, jaune de 75 à 89 %, rouge dès 90 %
   (pour tester sans attendre, regarde la jauge quand l'une des fenêtres
   est haute).
7. ☐ ⚠ **Codex** : après une session `codex`, la carte Codex montre ses
   limites (lues dans `%USERPROFILE%\.codex\sessions`), avec « lu il y a … ».
8. ☐ ⚠ **Demander à Codex** : réponse en 15 s au plus ; sans Codex installé,
   un message clair (« Codex n'est pas installé… »). Aucune fenêtre de
   console ne reste ouverte (Gestionnaire des tâches : pas de `codex.exe`
   orphelin).
9. ☐ Réglages → Agents IA → Jetons et budget → « Limites du forfait »
   coupé : le bloc disparaît de l'onglet.

## 2. Fichiers modifiés en direct (onglet Agents IA)

1. ☐ ⚠ Agents IA → « Installer automatiquement » pour Claude Code (à refaire
   si les hooks étaient déjà installés) : `PostToolUse` avec le matcher
   `Edit|MultiEdit|Write` apparaît dans `settings.json`, à côté des autres
   hooks ; une copie `.bak` est faite.
2. ☐ ⚠ Demander à Claude Code de modifier un fichier : sous sa session, une
   puce `nom.ext +N −M` arrive avec une petite gelée.
3. ☐ ⚠ Plusieurs modifications du même fichier : une seule puce, les
   nombres s'additionnent ; 7 fichiers ou plus : « + 1 autre ».
4. ☐ ⚠ Clic sur une puce : le changement s'ouvre sous le tableau, lignes
   ajoutées en vert, retirées en rouge, « ⋯ » entre deux morceaux ; « ✕ »
   le ferme. Rien ne s'ouvre dans un autre programme.
5. ☐ ⚠ Création d'un nouveau fichier (Write) : « nouveau », +N seulement.
6. ☐ ⚠ Gros fichier (plus de 200 Ko) : « Changement trop gros pour être
   montré : seulement les nombres. »
7. ☐ ⚠ Un fichier dans un **dossier exclu** (Réglages → Confidentialité) :
   aucune puce, rien dans l'île.
8. ☐ ⚠ Nouveau message tapé dans Claude Code : les puces de la session
   disparaissent (la liste repart de zéro).
9. ☐ ⚠ Gemini CLI (hooks installés de nouveau) : `AfterTool` avec
   `write_file|replace` ; une modification de fichier donne aussi sa puce.
10. ☐ « Réduire les animations » de Windows, ou Réglages → Mascotte →
    Calme, ou le mode éco : les puces arrivent sans gelée.
11. ☐ Réglages → Agents IA → Notifications → « Montrer les fichiers modifiés
    en direct » coupé : plus aucune puce.
12. ☐ ⚠ Claude Code ne ralentit pas visiblement après chaque modification
    (le hook se termine en moins d'une seconde).

## 3. Modèles locaux et OpenRouter (Parler à Ondine)

1. ☐ Réglages → Parler à Ondine → Fournisseur et modèles : « Modèle local
   (Ollama, LM Studio…) » et « OpenRouter » dans la liste ; les champs
   « Adresse du serveur local », « Modèle local », « Modèle OpenRouter ».
2. ☐ ⚠ **Ollama** lancé (`ollama serve`, un modèle téléchargé) : choisir
   « Modèle local », adresse vide. Le bloc « Modèles du serveur » apparaît ;
   « Lister les modèles du serveur » montre les modèles ; un clic en
   choisit un (le champ « Modèle local » se remplit).
3. ☐ ⚠ Parler à Ondine dans l'île : la réponse arrive ; aucun
   `<think>…</think>` ni réflexion n'apparaît.
4. ☐ ⚠ « Ce qui part » (sous-menu Général) : « Vos messages restent sur
   votre PC : … vers le serveur local localhost:11434 … ».
5. ☐ ⚠ Un modèle sans outils (par exemple gemma) avec les outils de fichiers
   autorisés : la réponse arrive quand même (conversation simple), une
   ligne « le modèle ne gère pas les outils » est dans le journal.
6. ☐ ⚠ Un modèle avec outils (par exemple llama3.1, qwen3) : « cherche mon
   fichier facture » déclenche la recherche de fichiers comme avec Claude.
7. ☐ ⚠ **LM Studio** : adresse `http://localhost:1234/v1`, serveur démarré ;
   même essai.
8. ☐ Adresse `http://192.168.1.20:11434/v1` : refusée, avec le message
   « http:// n'est accepté que pour ce PC… utilisez https:// ».
   `https://…` vers une autre machine : accepté.
9. ☐ ⚠ Serveur local arrêté : message « impossible de joindre le serveur
   local : est-il lancé (Ollama, LM Studio…) ? ».
10. ☐ « Modèle local » choisi sans modèle : l'île affiche « Choisissez le
    modèle du serveur local » et « Ouvrir les réglages ».
11. ☐ ⚠ **OpenRouter** : Réglages → Identifiants → « Clé API OpenRouter »
    (la clé n'est jamais réaffichée). Fournisseur OpenRouter, modèle vide
    (`openrouter/auto`) : une réponse arrive ; « Ce qui part » dit
    « openrouter.ai ».
12. ☐ ⚠ OpenRouter, « Lister les modèles du serveur » : une longue liste,
    un champ « Filtrer les modèles » ; « · sans outils » à côté de ceux qui
    ne les gèrent pas.
13. ☐ ⚠ La voix (transcription par l'API) avec un modèle local : elle passe
    par OpenAI ou Gemini s'il y a une clé, sinon un message clair.
14. ☐ Anglais et tutoiement : les nouveaux textes sont traduits.

## 4. Vos propres sons (Réglages → Apparence → Sons)

1. ☐ Le groupe Sons montre « Vos propres sons » avec « Ouvrir le dossier des
   sons » et « Recharger les sons », puis les noms possibles et « Aucun son
   remplacé pour l'instant. »
2. ☐ ⚠ « Ouvrir le dossier des sons » : `%APPDATA%\Ondine\sounds` est créé
   et s'ouvre dans l'Explorateur.
3. ☐ ⚠ Y poser `tap.wav` (court), puis « Recharger les sons » : « 1 son
   remplacé : tap » ; « ▶ Essayer » et un clic dans l'île jouent votre son.
4. ☐ ⚠ `open.mp3`, `close.ogg`, `drop.m4a` : chacun remplace son son
   (ouvrir / fermer l'île, déposer un fichier).
5. ☐ ⚠ Un fichier de plus de 2 Mo (`boing.wav`) : ignoré, le son d'origine
   reste, une ligne « sons : « boing.wav » ignoré (plus de 2 Mo) » dans le
   journal (`%LOCALAPPDATA%\Ondine`).
6. ☐ ⚠ Un faux fichier (un .txt renommé `pop.wav`) : ignoré, le son
   d'origine reste, une ligne au journal.
7. ☐ ⚠ `tap.wav` et `tap.mp3` ensemble : le .wav est pris, une ligne dit que
   le .mp3 est ignoré.
8. ☐ ⚠ Un long fichier (1 min) : il s'arrête après 4 s.
9. ☐ « Sons de clic » coupé : vos sons se taisent aussi. Le volume des sons
   s'applique à vos fichiers.
10. ☐ Retirer les fichiers, « Recharger les sons » : les sons d'origine
    reviennent.
