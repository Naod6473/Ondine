# Contribuer à Ondine

Ondine est une appli Windows 10/11 faite avec [Tauri 2](https://tauri.app) :
Rust pour le système, TypeScript sans framework pour l'interface. L'organisation
du code est décrite dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prérequis

- Windows 10 ou 11 (WebView2 est déjà installé)
- [Rust](https://rustup.rs), [Node 20+](https://nodejs.org)
- Visual Studio Build Tools avec « Développement Desktop en C++ »

## Lancer

```powershell
npm install
npm run tauri dev      # l'appli complète, rechargée à chaque modification
```

Si PowerShell refuse `npm` (« l'exécution de scripts est désactivée »), utilisez
`npm.cmd` à la place.

`npm run dev` seul ouvre l'île dans un navigateur (http://localhost:1420) : utile
pour travailler l'apparence, sans les fonctions Windows. La fenêtre de réglages est
sur http://localhost:1420/settings.html.

## Vérifier

```powershell
npm run typecheck                       # TypeScript
npm test                                # tests de l'interface (tests/front : île, réglages, traductions)
cd src-tauri; cargo test; cd ..         # tests Rust (réglages, bus, journal, chemins, modules)
```

## Tests à la main

Les listes de tests sur Windows et l'installation sur un autre PC :
[docs/tests/TESTS.md](docs/tests/TESTS.md) et [docs/tests/TESTS-nuit.md](docs/tests/TESTS-nuit.md).

## Construire l'installateur

```powershell
npm run tauri build    # src-tauri\target\release\bundle\nsis\Ondine_<version>_x64-setup.exe
```

`src-tauri\target\release\ondine.exe` fonctionne aussi sans installation.

## Où sont les fichiers

| Quoi | Où |
|------|----|
| Réglages | `%APPDATA%\Ondine\settings.json` |
| Exports de réglages | `%APPDATA%\Ondine\exports\` |
| Journal | `%LOCALAPPDATA%\Ondine\logs\ondine.log` |
| Clés API | Gestionnaire d'identifiants Windows |

## Règles du projet

- Les modules ne se parlent que par le bus.
- Aucune télémétrie. Un module qui envoie du contenu sur Internet le déclare et
  montre ce qui part avant l'envoi.
- Aucune suppression définitive : la Corbeille, avec une annulation de quelques secondes.
- Les clés et mots de passe vont dans le Gestionnaire d'identifiants Windows,
  jamais dans un fichier ni dans le journal.
- Les animations respectent « réduire les animations » de Windows.
- Du code simple et commenté, lisible par quelqu'un qui débute en Rust.
