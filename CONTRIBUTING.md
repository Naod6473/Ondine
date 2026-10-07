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
[docs/tests/TESTS.md](docs/tests/TESTS.md), [docs/tests/TESTS-nuit.md](docs/tests/TESTS-nuit.md)
et [docs/tests/TESTS-idees-apres-1-0.md](docs/tests/TESTS-idees-apres-1-0.md) (les nouveautés d'après la 1.0).

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

## Traduire, ajouter une langue

L'interface est écrite en français, directement dans le code. Une autre langue
ne réécrit pas le code : `src/core/i18n.ts` regarde chaque texte affiché (et
les attributs `title`, `placeholder`, `aria-label`) et le remplace par sa
traduction s'il la connaît. Un texte inconnu reste en français, rien ne casse.

Les traductions anglaises sont dans `src/core/i18n-en.json`, en deux parties :

- `"exact"` : le texte entier, tel qu'il s'affiche, espaces du début et de la
  fin enlevés (`"Réglages": "Settings"`). Majuscules, ponctuation et espaces
  insécables (avant `:` `?` `!` `»`) doivent être identiques au code.
- `"patterns"` : les textes avec une partie variable, `[expression régulière,
  remplacement]` ; `(…)` capture une partie, `$1`, `$2` la remettent
  (`["^Dans (\\d+) min : (.+)$", "In $1 min: $2"]`). L'expression couvre le
  texte entier (`^…$`) ; la première qui correspond gagne, donc les plus
  précises d'abord.

Chaque nouveau texte d'interface ajoute sa ligne (à la fin de la partie).

**Vouvoiement / tutoiement** : en français, l'interface vouvoie (« Vérifiez
votre connexion ») ; boutons et libellés sont à l'infinitif. Le réglage
« S'adresser à moi » (`general.address`) peut la faire tutoyer, avec le même
mécanisme : `src/core/i18n-fr-tu.json` (même forme) donne la version au « tu »
de chaque phrase au « vous ». Une nouvelle phrase au « vous » ajoute aussi sa
ligne là ; le test `tests/front/i18n-fr-tu.test.ts` refuse une entrée dont le
texte n'existe plus dans le code.
Ce que l'utilisateur tape ou copie n'est jamais traduit (`textarea`, zones
éditables, et tout ce qui est marqué `data-no-i18n`).

**Ajouter une langue** (l'allemand, par exemple) :

1. `src/core/i18n-de.json`, de la même forme que `i18n-en.json` ;
2. dans `src/core/i18n.ts`, une ligne dans `DICTIONARIES` (`de: german`) ;
3. le choix « Langue » : la valeur `"de"` dans `src/core/types.ts`
   (`general.language`), dans la liste acceptée par `sanitize` de
   `src-tauri/src/services/settings.rs`, et l'option dans la page Général des
   réglages (`src/settings/main.ts`) ;
4. la langue « automatique » : `system_language` de
   `src-tauri/src/platform/windows.rs` (et `other.rs`) ne reconnaît que le
   français, le reste devient l'anglais ; et `app_language` de `lib.rs` ;
5. les rares textes écrits côté Rust (menu de l'icône dans `tray.rs`), qui
   choisissent aujourd'hui entre français et anglais.

## Règles du projet

- Les modules ne se parlent que par le bus.
- Aucune télémétrie. Un module qui envoie du contenu sur Internet le déclare et
  montre ce qui part avant l'envoi.
- Aucune suppression définitive : la Corbeille, avec une annulation de quelques secondes.
- Les clés et mots de passe vont dans le Gestionnaire d'identifiants Windows,
  jamais dans un fichier ni dans le journal.
- Les animations respectent « réduire les animations » de Windows.
- Du code simple et commenté, lisible par quelqu'un qui débute en Rust.
