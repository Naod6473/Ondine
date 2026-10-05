# Ondine

« L'île » intelligente pour Windows 10/11 : une interface en haut au centre de
l'écran, modulaire, avec une mascotte animée. Voir [ARCHITECTURE.md](ARCHITECTURE.md).

## Prérequis

- Windows 10 ou 11 (WebView2 est déjà installé)
- [Rust](https://rustup.rs), [Node 20+](https://nodejs.org)
- Visual Studio Build Tools avec « Développement Desktop en C++ »

## Lancer

```powershell
npm install
npm run tauri dev      # l'appli complète, rechargée à chaque modification
```

`npm run dev` seul ouvre l'île dans un navigateur (http://localhost:1420) : utile
pour travailler l'apparence, sans les fonctions Windows. La fenêtre de réglages est
sur http://localhost:1420/settings.html.

## Vérifier

```powershell
npm run typecheck                       # TypeScript
cd src-tauri; cargo test; cd ..         # tests Rust (réglages, bus, journal, chemins, modules)
```

## Tests à faire

La liste des tests et l'installation sur un autre PC : [TESTS.md](TESTS.md).

## Construire l'installateur

```powershell
npm run tauri build    # src-tauri\target\release\bundle\nsis\Ondine_0.1.0_x64-setup.exe
```

`src-tauri\target\release\ondine.exe` fonctionne aussi sans installation.

## Où sont les fichiers

| Quoi | Où |
|------|----|
| Réglages | `%APPDATA%\Ondine\settings.json` |
| Exports de réglages | `%APPDATA%\Ondine\exports\` |
| Journal | `%LOCALAPPDATA%\Ondine\logs\ondine.log` |
| Clés API | Gestionnaire d'identifiants Windows (entrées contenant « io.github.naod6473.island ») |
