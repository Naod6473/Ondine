<p align="center"><img src="src-tauri/icons/128x128@2x.png" width="96" alt=""></p>

<h1 align="center">Ondine</h1>

<p align="center">
<b>Une île au sommet de l'écran pour Windows 10 et 11.</b><br>
<i>A little island at the top of your Windows screen.</i>
</p>

<p align="center"><a href="https://ondine.pissits.com"><b>ondine.pissits.com</b></a> · <a href="https://github.com/Naod6473/Ondine/releases/latest">Télécharger · Download</a></p>

---

**Français** · [English](#english)

Ondine vit en haut de l'écran, comme l'île dynamique d'un iPhone. Approchez la
souris : une pilule apparaît, avec Ondine, la petite goutte qui réagit à ce qui
se passe. Cliquez : l'île s'ouvre sur vos outils.

### Ce qu'elle sait faire

| | |
|---|---|
| **Musique** | Ce qui joue (Spotify, navigateur…), lecture, pause, barre de progression cliquable |
| **Contrôles** | Son, micro, luminosité, Wi-Fi, Bluetooth, mode avion, sortie audio |
| **Étagère** | Glissez des fichiers sur l'île pour les garder sous la main |
| **Presse-papiers** | Historique, épinglage, coller sans mise en forme |
| **Captures** | Capture d'écran, texte lu dans l'image (OCR), annotations |
| **Minuteur** | Minuteur, Pomodoro, chronomètre, dans la pilule |
| **Agenda** | Le prochain rendez-vous, depuis un fichier ou un lien iCal |
| **Notes** | Notes rapides et choses à faire |
| **Agents IA** | Lancez Claude Code, Codex ou Gemini CLI ; leurs notifications arrivent dans l'île |
| **Demander à Claude** | Collez une erreur, posez une question (avec votre propre clé API) |
| **Outils IT** | Système, réseau (ping, ports, DNS), accès distants RDP et SSH, terminal |
| **Règles** | « Quand un fichier arrive… alors… », raccourcis, clés USB |

Et aussi : trois mascottes, des thèmes de couleur, deux packs d'icônes, deux
styles d'animation, l'île sur le bord de votre choix, le français et l'anglais.

### Vie privée

- **Aucune télémétrie.** La seule connexion automatique : une fois par jour, Ondine
  demande à GitHub s'il existe une nouvelle version (désactivable dans les Réglages).
  Le détail est dans [PRIVACY.md](PRIVACY.md).
- « Demander à Claude » envoie le texte choisi à l'API d'Anthropic, avec **votre**
  clé, seulement après vous avoir montré ce qui part.
- Les clés sont rangées dans le Gestionnaire d'identifiants de Windows.
- Rien n'est supprimé définitivement : tout passe par la Corbeille, avec une annulation.

### Installer

Téléchargez l'installateur dans les [versions publiées](https://github.com/Naod6473/Ondine/releases).
Tant qu'il n'est pas signé, Windows peut afficher « Windows a protégé votre
ordinateur » : cliquez sur **Informations complémentaires**, puis **Exécuter quand
même**. L'installateur est construit par GitHub Actions à partir de ce dépôt.

### Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md) et [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

<a id="english"></a>
**English**

Ondine lives at the top of your screen, like an iPhone's Dynamic Island. Move
the mouse up: a pill appears, with Ondine, a little water drop that reacts to
what happens. Click: the island opens onto your tools.

- **Music** (now playing, controls, seek bar), **quick controls** (volume, mic,
  brightness, Wi-Fi, Bluetooth, airplane mode), **shelf** for files, **clipboard**
  history, **screenshots** with OCR, **timer**, **calendar**, **notes**.
- **AI agents**: launch Claude Code, Codex or Gemini CLI; their notifications
  show up in the island. **Ask Claude** with your own API key.
- **IT tools**: system info, network (ping, ports, DNS), RDP and SSH favorites,
  terminal, automation rules.
- **No telemetry.** Nothing leaves your PC unless you send it, and you see what
  is sent first; the only automatic request is a daily update check on GitHub
  (can be turned off). See [PRIVACY.md](PRIVACY.md). Nothing is ever deleted for
  good: the Recycle Bin, with undo.

Download: [releases](https://github.com/Naod6473/Ondine/releases). French and English.
Until the installer is code-signed, Windows may show "Windows protected your PC":
click **More info**, then **Run anyway**. It is built by GitHub Actions from this repository.

---

### Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate
by [SignPath Foundation](https://signpath.org). Team roles and details:
[CODE_SIGNING.md](CODE_SIGNING.md). Privacy: [PRIVACY.md](PRIVACY.md).

---

MIT · [LICENSE](LICENSE) · [THIRD-PARTY.md](THIRD-PARTY.md). Claude, Gemini and
Codex are trademarks of their owners; Ondine is not affiliated with them.
