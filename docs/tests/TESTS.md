# Tests à faire — phase 8 (Outils IT) et Agents IA

Tout est dans `main` (PR #8 et #9). Coche au fur et à mesure. Si quelque chose
ne marche pas, note le numéro du test et envoie-moi :
- ce que tu as vu (une capture si possible) ;
- les dernières lignes du journal : `%LOCALAPPDATA%\Ondine\logs\ondine.log`.

Le journal ne contient jamais de clé ni de contenu.

---

## 0. Installer sur un autre ordinateur (Windows 10 ou 11)

Ouvre **PowerShell** (pas besoin d'être administrateur ; Windows demandera
l'autorisation quand il le faut).

### 0.1 Les outils (une seule fois)

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

- La dernière commande installe le compilateur C++ de Microsoft dont Rust a
  besoin. Elle est longue (10 à 20 min) : laisse-la finir.
- WebView2 est déjà dans Windows 10/11, rien à faire.

**Ferme PowerShell et rouvre-le** (pour qu'il trouve les nouveaux programmes),
puis vérifie :

```powershell
git --version
node --version            # v20 ou plus
rustup default stable-msvc
cargo --version
```

Si `winget` n'existe pas : installe « App Installer » depuis le Microsoft Store,
ou télécharge à la main :
- Git : https://git-scm.com ;
- Node LTS : https://nodejs.org ;
- Rust : https://rustup.rs ;
- Build Tools : https://visualstudio.microsoft.com/visual-cpp-build-tools/, en
  cochant « Développement Desktop en C++ ».

### 0.2 Le projet

```powershell
cd $HOME
git clone https://github.com/Naod6473/Ondine.git
cd Ondine
npm.cmd install
npm.cmd run tauri dev
```

- `npm.cmd` (et pas `npm`) : PowerShell bloque parfois `npm.ps1`.
- La première compilation est longue (plusieurs minutes). Les suivantes sont
  rapides.
- L'île apparaît en haut au centre de l'écran.

### 0.3 Sur un ordinateur où le projet est déjà là

```powershell
cd $HOME\Ondine            # ou ton dossier
git checkout main
git pull
npm.cmd install
npm.cmd run tauri dev
```

### 0.4 (Facultatif) Vérifier et construire l'installateur

```powershell
npm.cmd run typecheck
cd src-tauri; cargo test; cd ..
npm.cmd run tauri build    # → src-tauri\target\release\bundle\nsis\Island_0.1.0_x64-setup.exe
```

**Important pour les agents :** les configurations copiées depuis l'île
contiennent le chemin de l'`ondine.exe` qui tourne. En mode dev, c'est
`…\Ondine\src-tauri\target\debug\ondine.exe`. Si tu installes ensuite la
version construite, recopie les configurations depuis cette version.

---

## 1. Outils IT (phase 8)

### 1.1 📊 Système

- ☐ Le nom du PC, Windows, le processeur, la mémoire, les disques et le
  réseau s'affichent.
- ☐ L'utilisation du processeur bouge toutes les quelques secondes.
- ☐ Sur un portable : la batterie s'affiche.

### 1.2 📡 Accès distants

- ☐ Ajouter un favori **RDP** (un PC de ton réseau). Le point vert ou rouge
  dit s'il répond.
- ☐ « Se connecter » ouvre le Bureau à distance (mstsc) sur ce PC.
- ☐ Ajouter un favori **SSH** avec un port (ex. 2222) et un utilisateur, puis
  « Se connecter ».
  - **À vérifier :** avec Windows Terminal, un nouvel onglet s'ouvre avec
    `ssh -p 2222 …`. Dis-moi s'il s'ouvre correctement.
- ☐ Supprimer un favori, puis « Annuler » : il revient.
- ☐ Dans le lanceur (Alt+Espace), taper le nom d'un favori le propose.

### 1.3 🌐 Réseau

- ☐ Ping `google.com` : les temps s'affichent chaque seconde, et le ping
  s'arrête avec « ⏹ Arrêter ».
- ☐ Port `google.com` 443 → « ouvert » ; port 81 → « pas de réponse » ;
  `127.0.0.1` sur un port inutilisé → « fermé ».
- ☐ DNS `google.com` → adresses IPv4 et IPv6.
- ☐ DNS `8.8.8.8` → un nom (dns.google).

---

## 2. 🤖 Agents IA

Dans l'onglet 🤖, ouvre « Brancher Claude Code, Codex ou Gemini ».

### 2.1 Claude Code prévient l'île

1. ☐ Choisis « Claude Code » : l'état s'affiche (« Installé », « Ancien
   chemin » ou « Non installé ») avec le chemin complet du fichier.
2. ☐ « ⚡ Installer automatiquement », puis relance Claude Code.
   - L'état passe à « Installé » ; une copie `settings.json.ondine-<date>.bak`
     est à côté ; les autres hooks (Coucou…) et réglages sont toujours là.
   - Avec un ancien hook vers `target\debug\ondine.exe` : « Ancien chemin »,
     et l'installation le remplace.
   - « Retirer » n'enlève que les entrées d'Ondine.
   - À la main (autre possibilité) : « 📋 Copier la configuration », à
     coller dans le fichier affiché (fusionner s'il y a déjà un bloc `"hooks"`).
3. ☐ « Essayer » : la notification « ✅ Claude a fini · Island » apparaît.
4. ☐ Dans Claude Code, demande une tâche :
   - la mascotte réfléchit ;
   - le tableau montre « Claude · projet · travaille depuis… ».
5. ☐ À la fin : « ✅ Claude a fini ».
6. ☐ Quand Claude demande une permission, l'île s'ouvre avec
   « ✋ Claude attend ta permission ».
7. ☐ **« ↗ Y aller »** (dans la notification ou en cliquant une ligne du
   tableau) ramène la fenêtre de Claude devant, même réduite.
   - **À vérifier :** est-ce la bonne fenêtre ? Teste avec une console
     classique ET avec Windows Terminal.

### 2.2 Lancer un agent

- ☐ Dans les réglages du module, ajoute 1 ou 2 dossiers de projets.
- ☐ Choisis « Claude Code », puis clique un projet : une console s'ouvre dans
  ce dossier avec `claude`.
- ☐ Même chose avec Codex et Gemini, s'ils sont installés.
  - S'ils ne le sont pas : la console reste ouverte avec le message d'erreur
    de Windows (c'est voulu).
- ☐ Réglage « Ouvrir les agents dans : Windows Terminal » → ça s'ouvre dans
  un onglet de Windows Terminal.
- ☐ Lanceur (Alt+Espace), taper `claude` → « Claude Code · projet ».
- ☐ Recherche dans l'île : créer une note « Idées été », une tâche « Appeler
  Léa », copier « Rendez-vous médecin », poser un fichier sur l'étagère, faire
  une capture enregistrée. Dans le Lanceur, taper `ete`, `LEA`, `medecin`, le
  nom du fichier, `octobre` (ou le mois du jour) : chaque élément apparaît dans
  sa section. Entrée sur la note → l'onglet Notes s'ouvre dans l'éditeur ; sur
  la tâche → la tâche est mise en avant ; sur la copie → « Copié », Ctrl+V la
  colle ; sur le fichier ou la capture → il s'ouvre.
- ☐ Recherche dans l'île et confidentialité : ajouter le dossier du fichier
  de l'étagère aux dossiers exclus → il n'apparaît plus. Désactiver le module
  Presse-papiers → sa section disparaît. Décocher « Chercher aussi dans l'île »
  → plus aucune section.

### 2.3 Codex et Gemini (si installés)

- ☐ **Codex :**
  1. Choisis « Codex », copie la configuration et colle-la à la fin de
     `%USERPROFILE%\.codex\config.toml`.
  2. Relance Codex, puis tape `/hooks` pour approuver les hooks.
  3. Une tâche finie doit donner « ✅ Codex a fini ».
  - **À vérifier :** est-ce qu'une console noire clignote à chaque hook ?
- ☐ **Gemini CLI** (version 0.26 ou plus) :
  1. Choisis « Gemini », copie la configuration et fusionne-la dans
     `%USERPROFILE%\.gemini\settings.json`.
  2. Une tâche finie doit donner « ✅ Gemini a fini ».
  - **À vérifier** (rien n'est garanti ici) : le texte passe-t-il bien par
    PowerShell ?

### 2.4 L'île comme serveur MCP

1. ☐ Choisis « Claude Code », puis « 🔌 Copier la config MCP ».
2. ☐ Colle la commande copiée dans PowerShell, une fois. Elle ressemble à
   `claude mcp add --scope user island -- "…\ondine.exe" mcp`.
3. ☐ Relance Claude Code et tape `/mcp` : « island » doit être connecté.
   - **À vérifier :** s'il est en erreur, envoie-moi la capture.
4. ☐ Demande à Claude :
   « Pose-moi une question avec ondine_ask, avec 3 choix ».
   - Une alerte « ❓ Claude te demande » s'affiche avec 3 boutons.
   - Clique un choix : Claude doit dire lequel tu as choisi.
5. ☐ Demande : « Montre une progression de 5 étapes avec ondine_progress ».
   Une notification « 1/5… 5/5 » doit s'afficher.
6. ☐ Demande : « Lance un minuteur de 1 minute avec ondine_timer ». Le
   minuteur de l'île démarre.
7. ☐ Ferme l'alerte de question avec × sans répondre : la question reste dans
   l'onglet 🤖, où tu peux encore répondre.
8. ☐ (Facultatif) Même chose avec Codex ou Gemini, en utilisant leur config
   MCP.

### 2.5 Autoriser / Refuser depuis l'île (désactivé par défaut)

1. ☐ Réglages du module Agents IA : active « Autoriser / Refuser depuis
   l'île ».
2. ☐ Onglet 🤖 → « 🔐 Copier le hook d'autorisation ».
   - Ajoute-le dans `%USERPROFILE%\.claude\settings.json`, en le fusionnant
     avec le bloc `"hooks"` existant.
   - Puis relance Claude Code.
3. ☐ Demande à Claude une commande qui demande une permission (par exemple
   « lance `git status` »). L'île affiche « 🔐 Claude veut utiliser Bash »
   avec la commande.
4. ☐ « Refuser » : Claude dit que c'est refusé.
5. ☐ « Autoriser… » puis « Oui, autoriser » : la commande s'exécute.
6. ☐ **LE TEST IMPORTANT.** Ne réponds pas dans l'île.
   - La question de Claude apparaît-elle **tout de suite** dans le terminal,
     ou **seulement après 1 minute** ?
   - Si tu réponds dans le terminal, l'alerte de l'île doit devenir
     « Réglé ailleurs ».
7. ☐ « Au terminal » : la question passe au terminal et sa fenêtre passe
   devant.
8. ☐ Désactive le réglage : plus rien ne s'affiche dans l'île, et la question
   arrive directement dans le terminal.

### 2.6 Mode concentration

- ☐ Onglet 🤖 → « 🎧 Concentration » → « 25 min ». Le bandeau violet apparaît.
- ☐ Fais finir une tâche à Claude : aucune notification, mais « 1 en
  attente » s'affiche dans le bandeau.
- ☐ « Arrêter » : une seule notification résume, par exemple « Claude a fini
  une tâche ».
- ☐ Pendant la concentration, une demande de permission (si 2.5 est actif)
  arrive directement dans le terminal.

---

## 3. 💬 Parler à Ondine (API, payante)

1. ☐ Réglages → Identifiants : colle ta clé API Anthropic (https://console.anthropic.com).
   Facultatif : une clé OpenAI (https://platform.openai.com) et une clé Gemini
   (https://aistudio.google.com).
2. ☐ Onglet 💬 :
   - Ondine dit bonjour (ce premier message ne coûte rien) ;
   - écris « Bonjour, qui es-tu ? » puis Entrée : trois petites gouttes,
     puis une réponse courte et joyeuse ; la mascotte réfléchit puis joue une
     humeur ;
   - pose une 2e question qui dépend de la 1re (« et en une phrase ? ») :
     Ondine se souvient.
3. ☐ « Voir la personnalité » montre la consigne exacte ; la phrase du bas dit
   vers quelle adresse partent les messages.
4. ☐ Réglages du module → Fournisseur d'IA : GPT, puis Gemini. L'en-tête de
   l'onglet change, la conversation continue avec le nouveau fournisseur.
   Sans clé : le bandeau 🔑 le dit.
5. ☐ Si un modèle GPT ou Gemini n'existe pas : « modèle introuvable ». Mets
   alors le bon nom dans les réglages et dis-moi lequel marche.
6. ☐ « 📎 Joindre un fichier… » ou dépôt d'une **capture** sur l'île → cible
   « Parler à Ondine » : l'onglet s'ouvre, l'image s'affiche en entier ;
   envoie, Ondine décrit l'image. « Retirer » enlève le fichier.
7. ☐ Dépose un fichier situé dans un **dossier exclu** : il est refusé.
8. ☐ Mets une fausse clé : « clé API refusée », la mascotte est triste, ton
   message revient dans le champ.
9. ☐ « Recommencer » efface tout. Quitte et relance l'île : rien n'est gardé.
10. ☐ Dans le journal, il n'y a que « message envoyé à … (N octets) » : ni la
    clé, ni le texte.
11. ☐ Réglages → Général → S'adresser à moi : Tu. « Recommencer », puis
    écris : Ondine tutoie.

### 3.1 Les fichiers d'Ondine

1. ☐ Réglages → Parler à Ondine → sous-menu « Fichiers » : « Ondine peut
   chercher et créer des fichiers » est coché, le dossier est vide.
2. ☐ Écris « Tu trouves ma dernière facture ? » (avec une facture dans
   Documents ou Téléchargements) : une petite ligne « 🔎 Recherche … » au-dessus
   de la réponse, et une carte du fichier. « Ouvrir » l'ouvre, 📂 le montre
   dans l'Explorateur.
3. ☐ « Lis-moi le fichier texte … » (un .txt ou .md trouvé) : une demande
   d'accord montre le début du fichier et l'adresse où il partira.
   « Refuser » : Ondine n'insiste pas. Redemande, « Autoriser » : elle
   répond avec son contenu.
4. ☐ « Crée-moi une liste de courses » : la demande montre le nom, le
   dossier (Documents\Ondine) et TOUT le contenu. « Créer » : le fichier est
   là, avec une carte ✨. Redemande le même nom : un nouveau fichier
   « liste… (2).md », l'ancien n'est pas écrasé.
5. ☐ Demande un fichier .bat ou .exe : Ondine dit qu'elle ne peut pas.
6. ☐ Mets un dossier à toi dans « Dossier des fichiers créés par Ondine »
   (D:\… par exemple) : le prochain fichier y va.
7. ☐ Un fichier dans un **dossier exclu** n'apparaît jamais dans les
   recherches.
8. ☐ Pendant une demande d'accord, « Envoyer » est remplacé par « Répondez
   d'abord à Ondine » ; « Recommencer » annule tout.
9. ☐ Fais les points 2 à 4 avec GPT, puis avec Gemini.
10. ☐ Décoche « Ondine peut chercher et créer des fichiers » : elle ne
    cherche plus, et la phrase sous le champ disparaît.

## 4. 💧 Ondine sur le bureau

1. ☐ Dans l'île ouverte, attrape la mascotte et tire-la hors de l'île : elle
   grossit un peu une fois dehors ; lâche-la sur le bureau. Elle disparaît de
   l'île et apparaît sous la souris.
2. ☐ Attrape-la et déplace-la : elle suit la souris. Relance l'appli : elle
   est toujours là.
3. ☐ Hors d'elle, les clics passent au travers (clique sur une icône du
   bureau juste à côté).
4. ☐ Clique sur elle : la bulle s'ouvre à côté, avec Parler à Ondine,
   Lanceur et Agents IA ; le champ prend le clavier. Mets-la au bord droit,
   puis en haut de l'écran : la bulle s'ouvre de l'autre côté, vers le bas.
5. ☐ Bulle ouverte, déplace Ondine : la bulle suit.
6. ☐ Écris-lui dans la bulle : elle réfléchit puis joue son humeur, sur le
   bureau. La même conversation est dans l'onglet de l'île.
7. ☐ Lance de la musique : elle danse sur le bureau. Lance un minuteur
   court : elle fête la fin.
8. ☐ Réglages → Mascotte → Ondine sur le bureau : décoche Agents IA, coche
   Notes ; la bulle suit. Décoche « Au-dessus des fenêtres » : elle passe
   derrière les fenêtres.
9. ☐ Le bouton ⤒ de la bulle la ramène dans l'île (et les visites au bord
   reviennent). Ressors-la, puis porte-la tout en haut de l'écran : l'île se
   montre, Ondine rapetisse ; lâche-la : elle rentre. Ressors-la encore, ouvre
   l'île : le bouton 💧 la fait rentrer aussi.
10. ☐ Lance un diaporama PowerPoint ou une vidéo en plein écran : elle
    disparaît, puis revient à la fin.
11. ☐ Lâche-la près de la barre des tâches, puis près d'un bord : elle s'y
    colle.
12. ☐ Glisse un fichier depuis l'Explorateur sur elle : elle s'étonne, la
    bulle propose « Parler à Ondine », « Étagère »… ; choisis-en une.
13. ☐ Ctrl+Alt+B ouvre et ferme sa bulle. Le menu de l'icône près de
    l'horloge : « Ondine sur le bureau » la rentre, puis la ressort.
14. ☐ Lance un minuteur de 10 s : une pastille ⏱️ apparaît sur elle ; un clic
    ouvre l'île.
15. ☐ Ne touche plus au PC 2 minutes : elle fait quelques pas ; bouge la
    souris, elle s'arrête.
16. ☐ Avec deux écrans (ou une mise à l'échelle 125 % / 150 %) : elle reste
    nette et à sa place ; écran débranché, elle revient en bas à droite.

### 4.1 Les Réglages en sous-menus

1. ☐ Modules : rangés en 5 catégories (Ondine et IA, Fichiers, Organisation,
   Outils IT, Le PC au quotidien). Un clic sur un titre la replie ou la
   déplie ; en rouvrant les Réglages, elles sont comme tu les as laissées.
2. ☐ Mascotte, Général, Onglets, Profils, Agents IA, Parler à Ondine : un clic
   déplie leurs sous-menus juste en dessous, la page n'affiche que celui
   choisi. Ferme et rouvre : tu reviens au même sous-menu.
3. ☐ Mode Simple : les sous-menus sans rien à montrer sont grisés ; on peut
   quand même les ouvrir (« Tout afficher »).
4. ☐ Recherche « lunettes », « jeton GitHub », « tutoiement » : un clic ouvre
   le bon sous-menu et fait briller la ligne.
5. ☐ Rien n'a disparu : chaque réglage d'avant se retrouve (la recherche aide).
   Icônes couleur et épurées : Apparence → Style des icônes, la barre suit.
6. ☐ Mascotte → Apparence : le podium montre les 15 mascottes, qui changent
   d'humeur. Glisse-en une sur la première marche : elle fait la fête et
   l'île change de mascotte tout de suite. Double-clic et Entrée aussi.
   Ferme et rouvre les Réglages : l'ordre des marches est gardé.

---

## 5. Ce que je dois savoir après tes tests

- 1.2 : l'onglet SSH avec port dans Windows Terminal.
- 2.1 : « Y aller » trouve-t-il la bonne fenêtre (console et Windows Terminal) ?
- 2.3 : la console qui clignote avec Codex, et le texte qui passe par
  PowerShell avec Gemini.
- 2.4 : « island » est-il connecté dans `/mcp` ?
- 2.5, test 6 : la question du terminal arrive-t-elle tout de suite, ou
  seulement après le délai ?
- 4.1 : les plis de la barre des Réglages sont-ils fluides ? Un réglage
  manque-t-il quelque part ?
- 4 : le déplacement d'Ondine est-il fluide, et la bulle s'ouvre-t-elle du
  bon côté ? Les clics passent-ils bien au travers à côté d'elle ?
