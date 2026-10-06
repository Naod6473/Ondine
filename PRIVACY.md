# Vie privée · Privacy

**Français** · [English](#english)

Ondine n'a **aucune télémétrie** : pas de statistiques, pas de rapport de plantage,
pas de compte. Tout reste sur votre PC (`%APPDATA%\Ondine` et `%LOCALAPPDATA%\Ondine`).

Ondine ne se connecte à Internet que dans ces cas :

| Quand | Vers | Ce qui part |
|---|---|---|
| Une fois par jour, et sur « Rechercher maintenant » (désactivable : Réglages → Mises à jour automatiques) | github.com | Une simple demande du fichier `latest.json` de la dernière version. Rien sur vous ni sur votre PC. |
| Vous cliquez « Installer » une mise à jour | github.com | Le téléchargement de l'installateur. |
| Vous utilisez « Demander à Claude » | api.anthropic.com | Le texte que vous avez choisi, avec **votre** clé API, après vous avoir montré ce qui part. |
| Vous avez ajouté des liens iCal dans Agenda | les adresses que vous avez données | La lecture de vos calendriers (toutes les 15 minutes). |
| Vous avez activé l'alerte « changement d'IP publique » (Outils IT, désactivée par défaut) | api.ipify.org | Une demande de votre adresse IP publique. |
| Vous lancez un ping, un test de port, un accès RDP/SSH ou un agent IA | la machine ou le service que vous avez choisi | Ce que vous avez demandé. |
| Vous avez activé la Météo (désactivée par défaut) et saisi une ville, au plus toutes les 30 minutes | geocoding-api.open-meteo.com, api.open-meteo.com | Le nom de la ville (une fois, quand elle change), puis ses coordonnées arrondies à 2 décimales (environ 1 km). |
| Vous cliquez « Signaler un problème » (Réglages → Général → À propos) | github.com, dans votre navigateur | Rien tant que vous n'envoyez pas : la page d'une nouvelle issue s'ouvre, préremplie avec la version, Windows et les 40 dernières lignes du journal (chemins personnels masqués). Vous relisez, modifiez ou abandonnez. |

Les clés et mots de passe sont rangés dans le Gestionnaire d'identifiants de Windows,
jamais en clair dans un fichier.

<a id="english"></a>
## English

Ondine has **no telemetry**: no analytics, no crash reports, no account. Everything
stays on your PC (`%APPDATA%\Ondine` and `%LOCALAPPDATA%\Ondine`).

This program will not transfer any information to other networked systems unless
specifically requested by the user, with one exception: the update check.

- **Update check** (once a day and on "Check now"; can be turned off in Settings →
  Automatic updates): a plain request for the latest release's `latest.json` on
  github.com. Nothing about you or your PC is sent.
- **Installing an update** (you click "Install"): downloads the installer from github.com.
- **Ask Claude**: sends the text you chose to api.anthropic.com with **your** API
  key, after showing you what will be sent.
- **Calendar**: reads the iCal links you entered (every 15 minutes).
- **Public IP alert** (IT tools, off by default): asks api.ipify.org for your public IP.
- **Ping, port test, RDP/SSH, AI agents**: connect to the host or service you chose.
- **Weather** (off by default; once you turn it on and enter a city, at most every
  30 minutes): sends the city name to geocoding-api.open-meteo.com (once, when it
  changes), then its coordinates rounded to 2 decimals (about 1 km) to api.open-meteo.com.
- **Report a problem** (Settings → General → About): opens a new GitHub issue page in
  your browser, prefilled with the version, Windows and the last 40 log lines
  (personal paths hidden). Nothing is sent until you review it and click Submit.

Keys and passwords are stored in the Windows Credential Manager, never in plain text.
