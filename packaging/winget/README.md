# Ondine dans winget

But : qu'on puisse installer Ondine avec

```
winget install Naod6473.Ondine
```

**Statut : préparé, pas encore soumis.** Rien n'a été envoyé à Microsoft : le
paquet n'existe pas encore dans le catalogue winget. Les README l'annoncent
comme « bientôt », clairement marqué « pas encore disponible ».

## Ce que contient ce dossier

```
packaging/winget/
├─ README.md                                   ce fichier
└─ manifests/n/Naod6473/Ondine/1.0.1/          même chemin que dans microsoft/winget-pkgs
   ├─ Naod6473.Ondine.yaml                     « version » : l'identifiant, la version, la langue par défaut
   ├─ Naod6473.Ondine.installer.yaml           l'installateur : URL, SHA-256, type, portée
   ├─ Naod6473.Ondine.locale.en-US.yaml        textes en anglais (langue par défaut)
   └─ Naod6473.Ondine.locale.fr-FR.yaml        textes en français
```

- Schéma des manifestes : **1.10.0** (accepté par le dépôt communautaire et par
  winget 1.10 ou plus récent).
- Installateur : `Ondine_1.0.1_x64-setup.exe` de la
  [release v1.0.1](https://github.com/Naod6473/Ondine/releases/tag/v1.0.1),
  type **`nullsoft`** (NSIS, généré par Tauri), architecture **x64**.
- Portée **`user`** : `tauri.conf.json` règle l'installateur NSIS en
  `installMode: "currentUser"` (installé pour le compte, sans droits
  d'administrateur, dans `%LOCALAPPDATA%`).
- `InstallerSha256` : calculé en téléchargeant vraiment l'installateur
  (`D56B5401…47AA`, 8 834 893 octets).
- Licence MIT, liens vers le dépôt, les issues, PRIVACY.md et LICENSE ; une
  description courte et longue en anglais et en français ; des mots-clés ;
  les nouveautés de la version (tirées de CHANGELOG.md).

## Refaire les manifestes pour une nouvelle version

Une fois la release GitHub **publiée** (l'installateur doit être en ligne) :

```
node scripts/winget-manifests.mjs 1.0.2
```

Le script (sans dépendance) télécharge l'installateur, vérifie que c'est bien
un installateur NSIS, calcule son SHA-256, lit la date et les nouveautés dans
CHANGELOG.md, et écrit les 4 fichiers dans
`packaging/winget/manifests/n/Naod6473/Ondine/1.0.2/`. Il ne soumet rien.

Important : **ne jamais remplacer l'installateur d'une release déjà publiée**
(même nom, nouveau fichier). winget compare l'empreinte SHA-256 : un fichier
remplacé fait échouer toutes les installations par winget de cette version.
Pour corriger, publiez une nouvelle version.

## Essayer avant de soumettre (sur Windows)

De préférence dans le **Bac à sable Windows** (Windows Sandbox), pour partir
d'un Windows propre comme le fait Microsoft :

```
winget validate --manifest packaging\winget\manifests\n\Naod6473\Ondine\1.0.1
winget settings --enable LocalManifestFiles          (une fois, en administrateur)
winget install --manifest packaging\winget\manifests\n\Naod6473\Ondine\1.0.1
```

Puis vérifiez :

1. Ondine s'installe sans question (winget lance l'installateur NSIS en mode
   silencieux, `/S`) et démarre.
2. L'entrée « Applications installées » : dans `regedit`,
   `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Ondine`,
   notez `DisplayName`, `Publisher` et `DisplayVersion`. Le nom de la clé
   (probablement `Ondine`) est le « ProductCode » ; vous pouvez l'ajouter au
   manifeste de l'installateur (`ProductCode: Ondine`), ce qui aide winget à
   reconnaître une installation faite sans lui. Remarque : sans
   `bundle.publisher` dans `tauri.conf.json`, Tauri prend le deuxième morceau
   de l'identifiant (`io.github.naod6473.ondine`) comme éditeur, donc
   `Publisher` vaut sans doute « github ». Ce n'est pas bloquant ; changer
   l'éditeur plus tard changerait aussi la clé `HKCU\Software\<éditeur>\Ondine`
   utilisée par l'installateur : à tester avant.
3. `winget list Ondine` la trouve ; `winget uninstall Naod6473.Ondine` la
   retire proprement.

## Soumettre (quand vous le déciderez)

Il faut un compte GitHub. Deux façons :

**A. Avec wingetcreate** (l'outil de Microsoft, le plus simple) :

```
winget install Microsoft.WingetCreate
wingetcreate submit --token <jeton GitHub> packaging\winget\manifests\n\Naod6473\Ondine\1.0.1
```

Le jeton est un « personal access token » GitHub (droit `public_repo`).
wingetcreate crée un fork de `microsoft/winget-pkgs` sur votre compte et ouvre
la demande de fusion (pull request) pour vous. Pour les versions suivantes,
`wingetcreate update Naod6473.Ondine --version 1.0.2 --urls <URL de
l'installateur> --submit` fait tout seul le nouveau manifeste (ou relancez le
script ci-dessus puis `wingetcreate submit`).

**B. À la main** : forkez <https://github.com/microsoft/winget-pkgs>, copiez
le dossier `manifests/n/Naod6473/Ondine/1.0.1/` au même endroit, faites une
pull request, et cochez la liste de contrôle du modèle de PR. À la première
contribution, un robot demande d'accepter le contrat de contribution (CLA) :
répondez par le commentaire qu'il indique.

Un seul dossier de version par pull request.

## Ce que Microsoft vérifie

1. **Les manifestes** : schéma, champs obligatoires, identifiant
   `Naod6473.Ondine` pas déjà pris, liens qui répondent.
2. **L'installateur** : téléchargé depuis l'URL, empreinte SHA-256 comparée,
   analyse antivirus (Microsoft Defender) et réputation de l'URL.
3. **L'installation** dans une machine virtuelle Windows propre, en mode
   silencieux : elle doit réussir sans clic, puis la désinstallation ; les
   entrées « Applications installées » sont relevées.
4. **Une relecture humaine** pour un nouveau paquet (étiquette
   « New-Package ») : comptez quelques jours à quelques semaines. Les robots
   posent des étiquettes en cas de souci (« Needs-Author-Feedback »,
   « Validation-Defender-Error », « Validation-Installation-Error »…) : il
   suffit en général de corriger le manifeste dans la même pull request.

## Sans signature de code, qu'est-ce qui change ?

- **Accepté quand même** : winget n'exige pas d'installateur signé ;
  l'intégrité vient de l'empreinte SHA-256 du manifeste, vérifiée avant de
  lancer l'installateur.
- **Antivirus** : un installateur NSIS non signé est un peu plus souvent pris
  pour suspect par une analyse automatique. Si la validation signale Defender
  (« Validation-Defender-Error »), envoyez le fichier à Microsoft comme faux
  positif (<https://www.microsoft.com/wdsi/filesubmission>) et indiquez-le
  dans la pull request.
- **SmartScreen** : l'avertissement « Windows a protégé votre ordinateur »
  concerne surtout les fichiers téléchargés par le navigateur ; en passant par
  winget, il ne devrait en général pas apparaître (à confirmer lors de
  l'essai). Mais rien n'indique « éditeur vérifié » : Windows affiche
  toujours l'éditeur comme inconnu.
- **Chaque version** demande un nouveau manifeste avec la nouvelle empreinte.
  Les mises à jour automatiques d'Ondine (signées minisign) continuent de
  fonctionner à côté ; `winget upgrade` ne verra une version qu'une fois son
  manifeste accepté.

## Après l'acceptation

Remplacer, dans README.md et README.en.md (section Installer), la ligne
« Bientôt : `winget install Naod6473.Ondine` — pas encore disponible » par la
commande, sans la mention « bientôt ».

## Points à confirmer

- `Publisher` de l'entrée « Applications installées » (voir plus haut) et,
  si vous le voulez, ajouter `ProductCode`.
- WebView2 : l'installateur de Tauri le télécharge s'il manque. Si la
  validation échoue faute de WebView2 dans la machine de test, ajouter au
  manifeste de l'installateur une dépendance au paquet
  `Microsoft.EdgeWebView2Runtime`.
- Le surnom (`Moniker: ondine`, pour `winget install ondine`) doit être libre
  dans le catalogue ; s'il est refusé, le retirer du manifeste en-US.
