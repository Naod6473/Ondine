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

1. ☐ Choisis « Claude Code », puis « 📋 Copier la configuration ».
2. ☐ Colle-la dans `%USERPROFILE%\.claude\settings.json`.
   - S'il y a déjà un bloc `"hooks"`, fusionne-les.
   - Puis relance Claude Code.
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

## 3. 💬 Demander à Claude (API, payante)

1. ☐ Réglages → Identifiants : colle ta clé API Anthropic. Elle se crée sur
   https://console.anthropic.com.
2. ☐ Onglet 💬 :
   - colle une erreur, puis « Préparer l'envoi » ;
   - **vérifie** que l'aperçu montre tout ce qui part : la consigne, le
     modèle et le texte entier ;
   - tape une question, puis « Envoyer à Claude » ;
   - une réponse en français s'affiche.
3. ☐ « 📋 Copier » copie la réponse.
4. ☐ Dépose une **capture** (.png) sur l'île → cible « Demander à Claude » :
   - l'onglet s'ouvre sur l'aperçu avec l'image ;
   - envoie, et Claude décrit l'image.
5. ☐ Dépose un fichier `.log` ou `.txt` : son texte entier s'affiche dans
   l'aperçu.
6. ☐ Dépose un fichier situé dans un **dossier exclu** (Réglages →
   Confidentialité) : il est refusé.
7. ☐ Mets une fausse clé : le message « clé API refusée » s'affiche.
8. ☐ Dans le journal, il n'y a que « demande envoyée à Claude (N octets) » :
   ni la clé, ni le texte.

---

## 4. Ce que je dois savoir après tes tests

- 1.2 : l'onglet SSH avec port dans Windows Terminal.
- 2.1 : « Y aller » trouve-t-il la bonne fenêtre (console et Windows Terminal) ?
- 2.3 : la console qui clignote avec Codex, et le texte qui passe par
  PowerShell avec Gemini.
- 2.4 : « island » est-il connecté dans `/mcp` ?
- 2.5, test 6 : la question du terminal arrive-t-elle tout de suite, ou
  seulement après le délai ?
