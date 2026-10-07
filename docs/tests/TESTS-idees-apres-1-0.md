# Tests Windows : les 17 idées d'après la 1.0

Branche `idees-apres-1-0` (PR brouillon). Tout est vérifié sur Linux (tests
front et Rust, clippy pour Windows), mais **aucune de ces nouveautés n'a
encore tourné sous Windows** : c'est le but de cette liste.

## Lancer la branche

```powershell
cd C:\Users\Utilisateur\Island
git fetch origin
git checkout idees-apres-1-0
git pull
npm.cmd install
npm.cmd run tauri dev
```

Au premier lancement, « Quoi de neuf dans Ondine 1.0.1 » s'affiche une fois :
c'est voulu (le réglage qui retient la version vue est nouveau).

## Par où commencer (le code Windows le plus incertain)

1. **Capture GIF** (partie 2) : la sélection de zone, le cadre rouge, l'île
   absente du GIF, les menus visibles ou non.
2. **Éjecter une clé USB** (partie 3) : l'éjection, et le nom du programme
   qui bloque.
3. **Éclairage nocturne** (partie 3) : la bascule peut ne rien changer sur un
   Windows 11 récent ; dans ce cas, Ondine doit ouvrir la page des Paramètres.
4. **Vers le téléphone** (partie 4) : la fenêtre du pare-feu, puis Android et
   iPhone.
5. **Agents** (partie 5) : git et VS Code trouvés, « Reprendre » dans Windows
   Terminal.

## Changé après la relecture (à garder en tête)

- **Vers le téléphone** : la notification « reçu » n'arrive que si le
  téléphone confirme la fin du téléchargement. Sinon, le panneau reste ouvert
  jusqu'à la fin des 5 minutes (vous pouvez réessayer ou cliquer Arrêter).
- **Empreinte** : un texte copié où l'empreinte n'est qu'un détail (un
  message qui cite un commit git) ne déclenche plus de comparaison. Si le
  tableau entier de `Get-FileHash` n'est pas reconnu (chemin très long),
  copiez seulement la colonne Hash.
- **Éjection** : Ondine ne nomme un programme que si le refus de Windows est
  sans ambiguïté ; sinon, le message générique.

---

# Partie 1 : Lanceur : calculs, GUID, horloges du monde
Calculs dans le Lanceur, « Nouveau GUID », horloges du monde.

Avant de commencer : lancez Ondine depuis la branche (`npm run tauri dev`),
Lanceur et Système activés (Réglages → Modules), langue en français.

Le Lanceur s'ouvre avec **Alt+Espace**. À chaque test : tapez la recherche,
regardez le **premier résultat**, puis appuyez sur **Entrée** et collez
(Ctrl+V) dans le Bloc-notes pour voir ce qui a été copié.

## 1. Calculs

| Tapez | Premier résultat attendu | Entrée copie |
|---|---|---|
| `2 + 3 × 4` | 14 (étiquette « Calcul », icône boulier) | `14` |
| `(1,5 + 2) ^ 2` | 12,25 | `12,25` |
| `1 200 / 3` | 400 | `400` |
| `18 % de 240` | 43,2 | `43,2` |
| `240 + 18 %` | 283,2 | `283,2` |
| `15 %` | 0,15 | `0,15` |
| `12345 * 1000` | 12 345 000 (espaces entre les milliers) | `12345000` (sans espaces) |
| `1/3` | 0,3333333333 | |
| `racine de 2` | 1,4142135624 | |

1. Après Entrée : l'île se referme et une petite notification « Copié » montre
   la valeur copiée.
2. Le résultat apparaît **avant** les applis et les actions de l'île.
3. Ouvrez l'onglet Presse-papiers : la valeur copiée est dans l'historique
   (c'est normal, c'est une copie comme une autre).

## 2. Ce qui ne doit RIEN ajouter (faux positifs)

Tapez chacune de ces recherches : la liste doit être **exactement comme
avant** (applis, fichiers, notes…), sans ligne « Calcul » en tête.

`2024` · `rapport-2024.pdf` · `2026-10-07` · `07/10/2026` · `1.0.1` ·
`192.168.1.1` · `10:30` · `06 12 34 56 78` · `Windows 11` · `pi` · `Tokyo` ·
`10 min` (le minuteur doit toujours être proposé en premier) · `10`

## 3. Unités

| Tapez | Premier résultat attendu |
|---|---|
| `1 Go en Mio` | 953,674 Mio (étiquette « Conversion », icône règle) |
| `1 Gio en Mio` | 1 024 Mio |
| `100 Mbit/s en Mo/s` | 12,5 Mo/s ; détail « 100 Mbit/s = 12,5 Mo/s » |
| `100 Mbps en MB/s` | 12,5 MB/s |
| `1 Gb en Mo` (b minuscule = bit) | 125 Mo |
| `1 Go à 100 Mbit/s` | 1 min 20 s (étiquette « Durée », détail « … sans compter les pertes du réseau ») |
| `90 min en h` | 1,5 h |
| `20 °C en °F` | 68 °F (icône thermomètre) |
| `10 km -> mi` | 6,21371 mi |
| `5 lb en kg` | 2,26796 kg |

Entrée sur `100 Mbit/s en Mo/s` copie `12,5 Mo/s`.

## 4. Bases

| Tapez | Premier résultat | Entrée copie |
|---|---|---|
| `0x1F` | 31 (détail « hex 0x1F · bin 0b1 1111 ») | `31` |
| `0b1010` | 10 | `10` |
| `255 en hex` | 0xFF | `0xFF` |
| `0xFF en décimal` | 255 | `255` |
| `42 en binaire` | 0b10 1010 | `0b101010` (sans espace) |

## 5. Sous-réseau IPv4

1. Tapez `192.168.1.0/26`. Vous voyez 6 lignes, icône réseau :
   - « 192.168.1.0/26 · 62 hôtes », détail « 255.255.255.192 · 192.168.1.1 →
     192.168.1.62 · adresses privées (RFC 1918) » ;
   - « Masque : 255.255.255.192 » (détail « /26 · masque inverse 0.0.0.63 ») ;
   - « Réseau : 192.168.1.0 », « Première adresse : 192.168.1.1 »,
     « Dernière adresse : 192.168.1.62 », « Broadcast : 192.168.1.63 ».
2. Entrée sur la première ligne, puis collez dans le Bloc-notes : un résumé
   sur 6 lignes (Réseau, Masque, Première adresse, Dernière adresse,
   Broadcast, Hôtes : 62).
3. Rouvrez le Lanceur, tapez de nouveau `192.168.1.0/26`, descendez avec ↓
   sur « Broadcast » et Entrée : seul `192.168.1.63` est copié.
4. Tapez `192.168.1.10 255.255.255.0` : « 192.168.1.0/24 · 254 hôtes ».
5. Tapez `169.254.10.20/16` : le détail parle d'APIPA (pas de réponse DHCP).

## 6. Heures du monde dans le Lanceur

(Les heures dépendent du jour : vérifiez avec l'horloge de Windows et un site
d'heure si besoin. Paris et Montréal sont à 6 h d'écart, sauf entre le
25 octobre et le 1er novembre 2026 : 5 h, car les deux pays ne changent pas
d'heure le même dimanche. Ondine doit suivre ce décalage tout seul.)

1. `15 h Montréal` → « 15 h 00 à Montréal = 21 h 00 ici », icône horloge,
   étiquette « Heure », détail « Montréal : −6 h par rapport à ici ».
   Entrée puis collez : « 15 h 00 à Montréal = 21 h 00 à Paris » (« ici »
   devient le nom de votre ville si le fuseau du PC est dans la liste).
2. `15h30 à Tokyo` → l'heure ici correspondante.
3. `23 h Montréal` → « …, le lendemain ».
4. `heure à Tokyo` et `heure Tokyo` → l'heure actuelle à Tokyo, avec
   « (demain) » si c'est déjà demain là-bas ; détail : la date là-bas et
   l'écart.
5. `heure au Caire` → « … au Caire » (et pas « à Le Caire »).
6. `15 h en min` → 900 min (une conversion, pas une heure).

## 7. Nouveau GUID

1. Tapez `guid` : deux lignes « Nouveau GUID » et « Nouveau GUID au format
   Windows » (icône carte d'identité).
2. Entrée sur la première, collez : un GUID en minuscules, par exemple
   `3f2b8c1e-9d4a-4c1b-8e2f-0a1b2c3d4e5f`.
3. Recommencez : le GUID est différent à chaque fois.
4. `uuid` → mêmes lignes. La seconde copie `{3F2B8C1E-…}` (majuscules,
   accolades).
5. `g` ou `gu` seuls ne proposent pas encore le GUID.

## 8. Horloges du monde (onglet Système)

1. Réglages → Système : un champ « Horloges du monde », vide. Tapez
   `Montréal, Tokyo` puis cliquez ailleurs.
2. Ouvrez l'onglet Système de l'île : sous les jauges, deux cases :
   « Montréal », l'heure là-bas en gros, et « −6 h » ; « Tokyo », l'heure,
   et « demain · +7 h » si c'est déjà demain à Tokyo (le soir), sinon « +7 h ».
   Survol d'une case : la date là-bas.
3. Laissez l'onglet ouvert au passage d'une minute : les heures changent
   toutes seules.
4. Dans le réglage, tapez `Montral, Tokyo` : en rouge sous le champ
   « Ville inconnue, ignorée : Montral ». L'onglet Système ne montre que Tokyo.
5. Tapez `Paris, Londres, Tokyo, Sydney, Lima` : « 4 villes au plus. En trop :
   Lima ». L'onglet montre les 4 premières.
6. Essayez aussi sans accents ni majuscules (`sao paulo, new york`), un nom
   anglais (`Vienna`), `UTC`.
7. Videz le champ : la rangée d'horloges disparaît de l'onglet.

## 9. Anglais, tutoiement, icônes

1. Réglages → Général → Langue : anglais. Dans le Lanceur :
   `1,234.5 * 2` → 2,469 ; `18% of 240` → 43.2 ; `3 pm in Tokyo` →
   « 15:00 in Tokyo = 08:00 here » ; `192.168.1.0/24` → « … · 254 hosts »,
   lignes « Mask: … ». Étiquettes « Calc », « Time ». Le réglage s'appelle
   « World clocks » ; l'avertissement « Unknown city, ignored: … ».
   Les horloges de l'onglet affichent « Montreal ».
2. Revenez en français, « S'adresser à moi » : tutoiement. Lanceur vide
   (recherche effacée) : le message dit « Tape le nom d'une appli… ou un
   calcul (…) ».
3. Réglages → Apparence → Icônes « Épurées » : les icônes des calculs
   (boulier, règle, horloge, carte d'identité, thermomètre, sablier, globe)
   sont au trait, de la couleur du texte, pas des emojis en couleur.

## 10. Rien de cassé

1. Le Lanceur trouve toujours les applis (`bloc`), les outils (`services`),
   les fichiers récents, les notes ; « 10 min » lance un minuteur.
2. L'onglet Système : jauges, infos, « Copier pour le support » et
   « Préparer un ticket » marchent comme avant.
3. Le journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) ne contient aucun
   résultat copié.

---

# Partie 2 : Presse-papiers, empreinte SHA-256, capture GIF
Décodeur du presse-papiers, empreinte d'un fichier (SHA-256), capture animée en GIF.

Avant de commencer : lancez Ondine depuis la branche (`npm run tauri dev`),
modules Presse-papiers, Étagère et Capture activés (Réglages → Modules), langue
en français, vouvoiement. Gardez le Bloc-notes ouvert pour coller (Ctrl+V) ce
qui est copié.

Le journal d'Ondine est dans `%LOCALAPPDATA%\Ondine` : à la fin de chaque partie,
ouvrez-le et vérifiez qu'il ne contient **aucun** texte copié, décodé ni
empreinte (seulement des comptes : « empreinte SHA-256 de 1 fichier(s) »,
« GIF enregistré (42 images, 4.2 s, 350 Ko, 0 sautées) »…).

---

## 1. Décodeur du presse-papiers (onglet Presse-papiers)

Pour chaque ligne : copiez le texte (Ctrl+C dans le Bloc-notes), ouvrez l'onglet
Presse-papiers. Sur la copie, à gauche des boutons habituels, un bouton
apparaît (ou pas). Cliquez dessus.

| Copiez | Bouton attendu | Ce que l'onglet doit montrer |
|---|---|---|
| `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzaW1vbiIsIm5hbWUiOiJTaW1vbiIsInJvbGUiOiJzdXBwb3J0IiwiaWF0IjoxNzU5ODMxMjAwLCJleHAiOjE4OTM0NTYwMDB9.--aE0lHiJBD9F4NiS-gPcxoZ9euNalplHcyAcINVOyw` | Décoder | « Jeton JWT », en orange « Signature non vérifiée : … », Algorithme HS256, « Émis le (iat) » 2025-10-07 12:00:00 (UTC+02:00) « il y a … j », « Expire le (exp) » 2030-01-01 01:00:00 (UTC+01:00) « dans 3 ans » et **encore valide** en vert ; blocs « En-tête » et « Contenu » en JSON avec retraits |
| le même jeton précédé de `Bearer ` | Décoder | la même chose |
| `Qm9uam91ciBTaW1vbiwgY2VjaSBlc3QgdW4gdGVzdCBkJ09uZGluZSAh` | Décoder | « Base64 décodé », Texte : `Bonjour Simon, ceci est un test d'Ondine !` |
| `https://exemple.fr/recherche?q=caf%C3%A9%20cr%C3%A8me&lang=fr` | Décoder | « Adresse décodée » : `…?q=café crème&lang=fr`, Paramètres : `q = café crème` et `lang = fr` |
| `{"nom":"Ondine","version":"1.0.1","modules":["clipboard","shelf"],"id":12345678901234567890}` | Mettre en forme | « JSON mis en forme », une valeur par ligne, et l'id **exactement** `12345678901234567890` (pas arrondi) |
| `1759831200` | Lire la date | « Horodatage Unix (secondes) » : Heure locale 2025-10-07 12:00:00 (UTC+02:00), UTC 2025-10-07 10:00:00 UTC, ISO 8601 2025-10-07T10:00:00.000Z |
| `1759831200000` | Lire la date | « Horodatage Unix (millisecondes) », mêmes dates |
| `0612345678`, `3017620422003`, `Bonjour`, `Password123`, `getElementById`, un GUID | **aucun** | (ce ne sont pas des choses à décoder) |

1. Le résultat s'affiche en police à chasse fixe ; chaque bloc a **Copier** :
   collez dans le Bloc-notes, c'est le texte décodé (le JSON avec ses retraits).
   Le petit 📋 au bout d'une date copie cette date seule.
2. « Décodé sur votre PC : rien n'est envoyé ni enregistré. » est écrit en haut ;
   **‹ Retour** revient à la liste.
3. Copiez un JSON compact de plus de 300 caractères (par exemple la réponse
   d'une API) : le bouton « Mettre en forme » apparaît quand même, et le
   résultat contient bien **tout** le texte (pas seulement le début).
4. Copiez le jeton d'exemple de jwt.io (sans date d'expiration) : « Émis le
   (iat) » 2018-01-18 02:30:22 (UTC+01:00), « il y a 9 ans », pas de ligne
   « Expire le ».
5. Le bouton **Aa** marche toujours comme avant, à côté.
6. Réglages → Général → **Langue** : English. Les boutons deviennent « Decode »,
   « Format », « Read the date » ; le titre « Decoded Base64 », etc. Le texte
   décodé, lui, n'est pas traduit. Puis Français et **Tutoiement** : « Décodé
   sur ton PC… ». Remettez le vouvoiement.
7. Réglages → Apparence → **Style des icônes** : Épurées. Le bouton Décoder et
   les 📋 ont une icône au trait.

## 2. Empreinte d'un fichier (cible de dépôt de l'Étagère)

1. Réglages → Modules → Étagère : la case **Cible « Empreinte » (SHA-256)** est
   cochée, avec son aide (« Si le presse-papiers contient une empreinte… »).
2. Copiez un mot quelconque (pour que le presse-papiers ne contienne pas
   d'empreinte). Glissez un petit fichier (un PDF) sur l'île : parmi les
   cibles, **Empreinte** avec l'icône #️⃣. Lâchez dessus.
   → l'île s'ouvre en alerte, plus large que d'habitude : titre
   `SHA-256 · nom.pdf`, et dessous l'empreinte **entière** (64 caractères),
   bouton **Copier**. Elle reste 30 secondes.
3. Dans PowerShell : `Get-FileHash .\nom.pdf` → la même empreinte (en
   majuscules chez PowerShell). Cliquez **Copier** dans l'île, collez : seule
   l'empreinte, en minuscules.
4. **Comparer** : copiez la ligne `Hash` de PowerShell (les 64 caractères),
   relâchez le même fichier sur **Empreinte** → titre **Identique ✓** en
   **vert**, icône ✅, dessous `SHA-256 · nom.pdf · …`.
   Changez un caractère de l'empreinte copiée, recommencez → **Différente ✗**
   en **rouge**, icône ❌.
5. Copiez la sortie de `Get-FileHash -Algorithm MD5 .\nom.pdf` (tout le
   tableau, ou juste le Hash) → la comparaison se fait en **MD5**
   (`MD5 · nom.pdf · …`). Pareil avec la sortie entière de
   `certutil -hashfile nom.pdf SHA1` (trois lignes) → SHA-1, et avec
   `Get-FileHash -Algorithm SHA512` → SHA-512.
6. **Gros fichier** : glissez un ISO de plusieurs Go (par exemple une image
   d'installation de Windows) sur **Empreinte**.
   - Une petite notification « Empreinte SHA-256… » puis « Empreinte SHA-256 :
     12 % » qui avance chaque seconde, avec **Arrêter**.
   - L'île reste fluide (survolez-la, ouvrez un onglet) ; dans le Gestionnaire
     des tâches, la mémoire d'Ondine ne grimpe pas (le fichier est lu par
     morceaux de 1 Mo).
   - À la fin, l'empreinte est la même que `Get-FileHash` (comptez une à
     quelques minutes, comme PowerShell).
   - Recommencez et cliquez **Arrêter** au milieu → « Empreinte arrêtée ».
7. Glissez **trois** fichiers ensemble → « Empreintes SHA-256 (3 fichiers) »
   avec une ligne courte par fichier ; **Copier** puis collez : trois lignes
   `empreinte  nom` (la forme de sha256sum).
   Avec une empreinte copiée qui correspond à l'un d'eux : « Différentes ✗ :
   2 sur 3 » en rouge, `a.pdf ✓ · b.pdf ✗ · c.pdf ✗`.
8. Glissez **six** fichiers → « Empreinte impossible » : « 5 fichiers au plus
   à la fois (vous en avez glissé 6) ». Glissez un
   **dossier** seul → « aucun fichier (les dossiers n'ont pas d'empreinte) ».
9. Copiez un mot de passe depuis votre gestionnaire (KeePass, Bitwarden…) puis
   déposez un fichier : pas de comparaison (`SHA-256 · nom`), le presse-papiers
   marqué sensible n'est pas lu.
10. Décochez le réglage → la cible **Empreinte** n'apparaît plus.
11. Style des icônes « Épurées » : la cible a une icône # au trait ; ✅ et ❌ aussi.
12. Anglais : « Hash », « Identical ✓ », « Different ✗ », « SHA-256 hash: 12% ».

## 3. Capture animée en GIF (onglet Capture) — à vérifier de près

Ce code (fenêtre de sélection, copie de l'écran, cadre rouge, île cachée du
GIF) n'a **pas pu être lancé** pendant le développement (Linux) : il a
seulement été vérifié par le compilateur pour Windows. Merci de bien regarder
chaque point, et de noter ce qui cloche (avec une capture si possible).

### 3.1 Le bouton et la sélection

1. Onglet Capture : une nouvelle ligne **GIF animé :** avec le bouton
   **🎞️ Enregistrer un GIF**.
2. Cliquez dessus. L'île se replie ; une demi-seconde après, l'écran se
   **fige et s'assombrit**, la souris devient une **croix**, et en haut de
   l'écran où est la souris un bandeau foncé dit « Glissez pour choisir la
   zone du GIF · Clic : tout l'écran · Échap : annuler ».
3. Appuyez sur **Échap** → tout redevient normal, **aucune** notification, le
   bouton redevient « Enregistrer un GIF ». Pareil avec un **clic droit**, et
   avec **Alt+Tab**.
4. Recommencez et tracez une zone en glissant (dans un sens puis dans
   l'autre) : la zone redevient **claire**, avec un cadre blanc et noir, et
   sa taille (« 640 × 480 ») dans une étiquette dessous (dedans si la zone
   touche le bas de l'écran). Pas de clignotement en bougeant la souris.
   Pendant ce temps, le bouton de l'onglet dit « ⏳ GIF en cours… » (grisé).

### 3.2 L'enregistrement

5. Relâchez : l'écran redevient normal (pas assombri), un **cadre rouge** de
   3 pixels entoure la zone (à l'extérieur), et l'île montre
   **« Enregistrement du GIF (10 s au plus) »** avec **Arrêter**.
   - Vous pouvez cliquer à travers le cadre rouge (il laisse passer la souris)
     et il ne prend pas le focus (la fenêtre où vous tapiez le garde).
   - Le pointeur de la souris **ne clignote pas** pendant l'enregistrement.
6. Pendant quelques secondes : tapez du texte, bougez une fenêtre, ouvrez un
   **menu** (clic droit sur le Bureau) et faites apparaître une **bulle**
   d'aide (survol d'un bouton) dans la zone. Puis cliquez **Arrêter** dans
   l'île.
7. → « Création du GIF… » (⏳), puis **« GIF enregistré (6 s, 420 Ko) »** avec
   le nom du fichier et **Montrer dans l'Explorateur**, puis la notification
   « « Capture 2026-… .gif » enregistrée » avec **Annuler**.
   **Montrer dans l'Explorateur** ouvre `Images\Ondine` avec le fichier
   sélectionné. Le GIF est aussi **sur l'étagère**.
8. Ouvrez le GIF (glissez-le dans Edge, ou double-clic) et vérifiez :
   - il tourne **en boucle**, à la bonne vitesse (comparez avec une montre :
     6 s d'enregistrement ≈ 6 s d'animation, plus une pause d'1 s à la fin) ;
   - c'est bien **la zone choisie**, ni décalée ni rognée ;
   - **pas** d'image sombre au début (la fenêtre de sélection ne doit pas
     être sur le GIF), **pas** de cadre rouge ;
   - le **pointeur** est visible, et sa pointe est exactement là où vous
     cliquiez (le I du texte aussi, quand vous survolez du texte) ;
   - le **menu** et la **bulle** apparaissent sur le GIF. S'ils manquent,
     dites-le : il faudrait remettre le drapeau CAPTUREBLT, qui fait
     clignoter la souris ;
   - le texte reste lisible, les couleurs correctes (un peu de grain sur les
     dégradés et les photos est normal : 256 couleurs par image).
9. **L'île absente du GIF** : refaites un GIF en traçant une zone qui
   **contient l'île** (le haut de l'écran) et ouvrez l'île pendant
   l'enregistrement. Sur l'écran vous la voyez, sur le GIF elle ne doit **pas**
   apparaître (Windows 10 version 2004 ou plus, Windows 11). Si elle apparaît,
   regardez le journal : « l'île ne peut pas être retirée du GIF ». Après le
   GIF, une capture d'écran normale (Win+Maj+S) doit de nouveau montrer l'île.
10. **Durée maximale** : lancez un GIF et ne touchez à rien → il s'arrête seul
    au bout de **10 s**. Réglages → Capture → « Durée maximale d'un GIF
    (secondes) » : 3 → arrêt au bout de 3 s. On ne peut pas dépasser 30.
11. **Tout l'écran** : au lieu de tracer, faites un **simple clic** → tout
    l'écran sous la souris est enregistré. Le GIF fait **960 pixels** de
    large (réduit, texte encore lisible), la souris est à la bonne place. Avec
    **Entrée** après avoir tracé une zone → c'est la zone tracée.
12. **Plusieurs écrans** (si possible avec des échelles différentes, 100 % et
    150 %) : le bandeau d'aide s'affiche sur l'écran où est la souris ; une
    zone sur l'écran secondaire, puis une zone à cheval sur les deux écrans →
    le GIF correspond exactement à ce qui était dans le cadre rouge (pas de
    décalage, pas d'agrandissement).
13. Dans l'onglet, pendant l'enregistrement, le bouton devient
    **⏹️ Arrêter le GIF** et arrête bien. Cliquer deux fois de suite sur
    « Enregistrer un GIF » → la 2e fois : « GIF impossible · un GIF est déjà
    en cours ».
14. Réglage « Montrer la souris dans les GIF » décoché → plus de pointeur sur
    le GIF.
15. **Annuler** (dans les secondes qui suivent) → le GIF part à la Corbeille.
16. Verrouillez la session (Win+L) pendant un enregistrement, revenez : le GIF
    s'écrit quand même et reste lisible.
17. Pendant un GIF de 30 s en plein écran : le Gestionnaire des tâches ne doit
    pas montrer Ondine au-dessus de quelques centaines de Mo, et le processeur
    redescend à la fin. Le journal indique combien d'images ont été
    « sautées » (0 ou peu sur un PC récent, en version installée ; plus en
    `tauri dev`, compilé sans optimisation).
18. Lanceur (Alt+Espace) : tapez `gif` ou `Capture 2026` → le GIF apparaît
    parmi les captures et s'ouvre.
19. Style des icônes « Épurées » : 🎞️ (pellicule) et 🔴 (bouton d'enregistrement) ont
    une icône au trait. Anglais : « Record a GIF », « Recording the GIF (10 s
    max) », « GIF saved (6 s, 420 KB) », et le bandeau de la sélection
    « Drag to choose the GIF area · Click: whole screen · Esc: cancel ».
    Tutoiement : « Glisse pour choisir la zone du GIF… ».
20. Avec « Effets d'animation » désactivés dans Windows (Paramètres →
    Accessibilité → Effets visuels) : rien de nouveau ne bouge (la sélection
    et le cadre n'ont pas d'animation).

Pas de vidéo MP4 : seulement le GIF (c'était prévu ainsi).

---

# Partie 3 : Contrôles et Système : clés USB, mode sombre, veilleuse, redémarrage en attente
Le code Windows de ces trois nouveautés n'a jamais
tourné : il a seulement été vérifié par le compilateur (clippy pour Windows).
Merci de tester de préférence avec un **compte standard** (pas administrateur),
sauf mention contraire, et de noter la version de Windows (`winver`).

Pour chaque test : ce que vous faites → ce que vous devez voir. Si ce que vous
voyez est différent, notez-le tel quel (copie d'écran bienvenue).

---

## A. Onglet Contrôles : la disposition

1. Ouvrez l'onglet **Contrôles**, sans clé USB branchée.
   → Les pastilles rondes sont sur **quatre colonnes** : Wi-Fi, Bluetooth,
   (Mobile), Avion, Micro, Épingler, **Sombre**, **Veilleuse**. Aucun nom
   n'est coupé (« Bluetooth », « Épingler », « Veilleuse » entiers). Les
   piliers (son, micro, écrans) sont à droite comme avant. Pas de barre de
   défilement, pas de bande en bas.
2. Sur un PC sans Wi-Fi ni Bluetooth (fixe) : seulement Micro, Épingler,
   Sombre, Veilleuse sur une ligne, centrée.
3. Branchez une clé USB, onglet ouvert.
   → En moins de 2 s, une bande apparaît en bas : « Clés USB et disques
   amovibles », puis une pastille allongée avec le nom de la clé (ex.
   « KINGSTON »), sa lettre (« E: ») et un bouton **Éjecter**. Tout tient
   encore dans la hauteur de l'onglet, sans défilement (les pastilles se
   serrent un peu). Les piliers restent utilisables.
4. Clé sans nom de volume → la pastille dit « Clé USB ». Survol de la
   pastille → bulle « KINGSTON (E:) » ou « Clé USB (E:) ».
5. Deux ou trois clés en même temps → les pastilles sont côte à côte ; s'il
   n'y a plus de place, la bande défile horizontalement (pas toute la page).
6. Retirez la clé sans l'éjecter → la bande disparaît en moins de 2 s, sans
   message d'erreur.

## B. Éjecter une clé USB

7. **Cas simple** : clé branchée, aucun fichier ouvert dessus. Cliquez
   **Éjecter**.
   → Le bouton devient « Éjection… » (grisé), puis en 1 à 3 s une
   notification ✅ « **Vous pouvez retirer la clé E: en toute sécurité.** ».
   La clé disparaît de la bande, et de l'Explorateur (« Ce PC »). Souvent,
   le voyant de la clé s'éteint. **Aucune fenêtre de Windows** ne doit
   s'ouvrir.
8. Rebranchez la même clé → elle revient dans la bande.
9. **Un programme bloque (cmd)** : ouvrez une invite de commandes, tapez
   `E:` puis Entrée (l'invite « E:\> » garde la clé ouverte). Cliquez
   **Éjecter**.
   → Notification ⚠️ « **La clé E: n'est pas éjectée** », avec si possible
   « « cmd.exe » utilise encore ce lecteur. Fermez-le puis réessayez. ».
   Si le message est seulement « Un programme utilise encore la clé.
   Fermez-le puis réessayez. », notez-le (le nom du programme n'a pas été
   trouvé), puis faites le test 12. Le bouton redevient « Éjecter ».
   Fermez l'invite de commandes, cliquez **Éjecter** → ✅ comme au test 7.
10. **Un document ouvert** : ouvrez un fichier de la clé dans Word ou Excel
    (ou une vidéo en lecture dans VLC / Films et TV). **Éjecter**.
    → ⚠️ avec « « WINWORD.EXE » utilise encore ce lecteur… » (ou
    EXCEL.EXE, vlc.exe…), ou le message général. Notez lequel.
11. **Explorateur** : ouvrez une fenêtre de l'Explorateur sur E:\ (et si
    possible sélectionnez un fichier avec le volet d'aperçu ouvert).
    **Éjecter**.
    → Le plus souvent Windows ferme la fenêtre et l'éjection réussit (✅).
    S'il refuse : « L'Explorateur de fichiers utilise encore ce lecteur.
    Fermez ses fenêtres puis réessayez. ». Notez ce qui se passe.
12. **Si le nom du programme manquait aux tests 9 ou 10** : ouvrez
    l'Observateur d'événements → Journaux Windows → **Système**, cherchez un
    événement **225** (source Kernel-PnP) à l'heure du test. S'il existe :
    onglet Détails → **Affichage XML**, copiez-moi le XML (il contient le
    chemin du programme, rien de personnel). Regardez aussi dans Journaux
    des applications et des services → Microsoft → Windows → Kernel-PnP →
    **Configuration**.
13. **Disque dur USB** (externe, alimenté ou non) : branchez-le.
    → Il apparaît dans la bande (nom du volume, ou « Disque USB » sans nom).
    **Éjecter** → ✅ « Vous pouvez retirer **le disque** G: en toute
    sécurité. ». Un disque à plusieurs partitions : une pastille par lettre ;
    éjecter l'une éjecte tout le disque (les autres lettres disparaissent
    aussi), c'est normal.
14. **Disques internes** : vérifiez que C: et les autres disques internes
    (D: interne, SSD NVMe…) n'apparaissent **jamais** dans la bande.
15. **Carte SD dans le lecteur intégré du portable** (si vous en avez un) :
    → La carte apparaît dans la bande. **Éjecter** → soit ✅, soit « Windows
    ne propose pas de retirer ce lecteur en toute sécurité. ». Ensuite,
    retirez la carte et remettez-la : revient-elle dans l'Explorateur ?
    (Sur certains PC, l'icône « Retirer le périphérique » de Windows arrête
    tout le lecteur de cartes jusqu'au redémarrage ; Ondine utilise la même
    méthode. Notez précisément ce qui se passe.)
16. Double-clic rapide sur **Éjecter** → une seule éjection (le bouton est
    grisé « Éjection… » pendant ce temps), pas deux notifications.
17. Clé retirée pendant l'éjection (arrachée) → pas de plantage ;
    notification ⚠️ éventuelle « Le lecteur n'est plus visible : il a
    peut-être déjà été retiré. ».

## C. Notification « clé branchée »

18. Onglet fermé (île repliée), branchez une clé.
    → En moins de 2 à 3 s, notification 🔌 « **Clé USB branchée : KINGSTON
    (E:)** » avec deux boutons **Ouvrir** et **Éjecter** (disque USB :
    « Disque USB branché : … »).
19. **Ouvrir** → une fenêtre de l'Explorateur s'ouvre sur E:\.
20. Rebranchez, **Éjecter** depuis la notification → elle est remplacée par
    le résultat (✅ « Vous pouvez retirer la clé E: en toute sécurité. »).
21. Les clés déjà branchées **au démarrage d'Ondine** ne déclenchent pas de
    notification.
22. Réglages → Contrôles → décochez « **Prévenir quand une clé USB est
    branchée** » → plus de notification à l'arrivée d'une clé, mais la bande
    de l'onglet fonctionne toujours. Recochez.
23. En présentation (PowerPoint en diaporama) : la notification attend la
    fin de la présentation (comme les autres notifications d'Ondine).

## D. Mode sombre

24. Windows en mode clair. Cliquez la pastille **Sombre**.
    → En 1 à 2 s, la barre des tâches, le menu Démarrer, les Paramètres et
    l'Explorateur passent en sombre. La pastille s'allume (lueur violette).
    Paramètres → Personnalisation → Couleurs → « Choisir votre mode » =
    **Sombre**.
25. Cliquez de nouveau → tout repasse en clair ; Paramètres = **Clair**.
26. Dans les Paramètres de Windows, choisissez « Personnalisé » (Windows en
    sombre, applis en clair) → en moins de 2 s, la pastille s'éteint ; bulle
    « Mode sombre de Windows : en partie (applis ou barre des tâches) ». Un
    clic → les deux en sombre.
27. Changez le mode dans les Paramètres de Windows → la pastille suit en
    moins de 2 s.
28. Ondine ne doit pas se figer pendant le changement, même si une appli
    est « Ne répond pas ».

## E. Éclairage nocturne

29. Survolez la pastille **Veilleuse**. Deux cas possibles, notez lequel :
    - bulle « Éclairage nocturne : désactivé » (ou « activé ») : Ondine a
      reconnu la valeur de Windows → tests 30 à 33 ;
    - bulle « Éclairage nocturne : ouvrir les paramètres de Windows » :
      forme inconnue → test 34.
30. Allumez l'éclairage nocturne depuis les paramètres rapides de Windows
    (Win+A) → en moins de 2 s, la pastille s'allume (lueur orange).
    Éteignez → elle s'éteint.
31. Cliquez la pastille **Veilleuse** → l'écran devient plus chaud
    (orangé) en 1 à 2 s ; le bouton « Éclairage nocturne » de Win+A est
    allumé. Recliquez → retour à la normale.
    **Important** : si la pastille s'allume mais que l'écran ne change PAS,
    notez-le avec la version de Windows (`winver`) : sur certaines versions
    récentes de Windows 11, Windows pourrait ignorer ce changement.
32. Après les tests 31, ouvrez Paramètres → Système → Écran → Éclairage
    nocturne : la page s'affiche normalement, l'interrupteur est dans le bon
    état, l'intensité et la programmation n'ont pas changé.
33. Redémarrez le PC (ou fermez la session) → l'éclairage nocturne est dans
    l'état laissé, et la page des Paramètres fonctionne toujours.
34. Forme inconnue : cliquez la pastille → la page **Éclairage nocturne**
    des Paramètres s'ouvre, la pastille reste éteinte, rien d'autre ne
    change. Envoyez-moi alors le résultat de cette commande (des dates et
    un état allumé / éteint, rien de personnel) :
    `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate" /v Data`
    une fois éclairage éteint, une fois allumé.

## F. Redémarrage en attente (onglet Système)

35. Sans redémarrage en attente : onglet **Système** → aucune ligne
    nouvelle sous les jauges.
36. Simulation (PC de test, invite de commandes **en administrateur**) :
    `reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired" /f`
    → en moins d'une minute (onglet ouvert), une ligne ambrée sous les
    jauges : « 🔄 **Redémarrage en attente depuis moins d'une heure (mises à
    jour de Windows)** » et un bouton **Ouvrir Windows Update**.
37. **Ouvrir Windows Update** → la page Windows Update des Paramètres
    s'ouvre. Le PC ne redémarre **jamais** de lui-même.
38. **📋 Copier pour le support**, collez dans le Bloc-notes → une ligne
    « Redémarrage en attente : oui, depuis … (mises à jour de Windows) ».
    Sans redémarrage en attente, cette ligne n'existe pas.
39. Supprimez la clé de test :
    `reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired" /f`
    → la ligne disparaît en moins d'une minute.
40. Vrai cas (après des mises à jour installées, sans redémarrer) : la ligne
    donne une durée plausible (« depuis 3 jours », « depuis 5 h »). Avec un
    compte standard, si seule la raison « composants de Windows » est
    présente et que Windows n'en donne pas la date, la ligne dit seulement
    « Redémarrage en attente (composants de Windows) » : notez-le.

## G. Le rappel doux

Il faut un redémarrage en attente depuis **plus d'un jour** (vrai cas, ou la
clé du test 36 laissée 24 h sans redémarrer ; la mise en veille ne gêne pas).

41. Ondine lancée, PC utilisé normalement → dans les 10 minutes (2 min
    après le démarrage d'Ondine au plus tôt), une notification 🔄
    « Redémarrage en attente depuis 1 jour » (ou N jours) : « Windows attend
    un redémarrage pour terminer ses mises à jour. Redémarrez quand cela
    vous arrange. », boutons **Ouvrir Windows Update** et **Plus tard**.
42. **Plus tard** → la notification se ferme ; pas d'autre rappel avant
    24 h, même en relançant Ondine.
43. (Si possible, le lendemain) Laissez un enregistrement en cours dans
    l'appli Enregistreur vocal (micro utilisé) → pas de rappel tant qu'il
    enregistre ; il arrive dans les 10 min après l'arrêt.
44. (Si possible) PowerPoint en diaporama → pas de rappel pendant le
    diaporama.
45. Personne devant le PC (plus de 5 min sans clavier ni souris) → pas de
    rappel ; il vient après votre retour.
46. Réglages → Système → décochez « **Rappeler un redémarrage en attente** »
    → plus jamais de rappel ; la ligne de l'onglet reste.

## H. Langue, tutoiement, apparence, démo

47. Réglages → Général → Langue : English → « Dark », « Night light »,
    « USB drives and removable disks », « Eject », « Ejecting… »,
    notifications « USB drive plugged in: KINGSTON (E:) », « You can safely
    remove the USB drive E:. », « Restart pending for 3 days (Windows
    updates) », « Open Windows Update ».
48. Français, « S'adresser à moi » : tu → « Tu peux retirer la clé E: en
    toute sécurité. », « … Ferme-le puis réessaie. », « … Redémarre quand ça
    t'arrange. ».
49. Apparence → icônes **Épurées** : les pictogrammes 🔌 (clé branchée), ✅,
    ⚠️ et 🔄 (ligne de l'onglet Système, rappel) sont dessinés au trait,
    pas en emoji. Les pastilles Sombre (croissant de lune) et Veilleuse
    (soleil couchant) sont au trait dans les deux styles.
50. « Réduire les animations » de Windows activé, puis mode Économie : rien
    de nouveau ne bouge (les pastilles gardent le comportement des autres).
51. Mode démo (Réglages → Général → Captures d'écran → Mode démo) :
    l'onglet Contrôles montre une clé « KINGSTON E: » ; **Éjecter** → ✅
    « Vous pouvez retirer la clé E: en toute sécurité. » et la clé
    disparaît. Sombre et Veilleuse s'allument et s'éteignent sans toucher à
    Windows.

---

# Partie 4 : Accès distants et Étagère : Wake-on-LAN, vers le téléphone
Avant de commencer : `npm run tauri dev` (ou l'installateur construit depuis la
branche `idees-apres-1-0`). Il vous faut un téléphone sur le **même Wi-Fi** que le PC et, pour le
réveil, une machine qui accepte le Wake-on-LAN (NAS, PC de test, serveur…).

---

## ⚠️ À regarder en premier : le pare-feu de Windows (Vers le téléphone)

C'est LE point qui peut tout bloquer, à vérifier la toute première fois.

1. Étagère : glissez un petit fichier (une photo, un PDF) sur l'île → cible
   « Étagère ».
2. Onglet Étagère : sur la ligne du fichier, cliquez sur **📱** (« Vers le
   téléphone »).
3. **Attendu** : une fenêtre de Windows « Le Pare-feu Windows a bloqué
   certaines fonctionnalités de cette application » (ou « Autoriser
   l'accès ») apparaît pour **ondine.exe** (en `tauri dev`, c'est aussi
   ondine.exe dans `src-tauri\target\debug`).
   - Cochez **Réseaux privés** et cliquez **Autoriser**.
   - Notez ce que la fenêtre propose exactement (cases cochées par défaut ?
     demande-t-elle des droits administrateur ?) : je l'ai seulement écrit,
     pas vu.
4. Vérifiez dans Paramètres → Réseau et Internet → Wi-Fi → (votre réseau) que
   le profil est **Privé**. S'il est **Public**, le pare-feu bloque le
   téléphone tant qu'Ondine n'est pas autorisé aussi sur les réseaux publics :
   **essayez les deux cas** et dites-moi ce qui se passe (message clair ou pas).
5. Si vous avez cliqué « Annuler » par erreur : Pare-feu Windows Defender →
   « Autoriser une application… » → ondine.exe → cochez Privé. Refaites le test.
6. **Testez aussi après avoir REFUSÉ** : le téléphone doit simplement ne rien
   trouver (la page ne se charge pas). Ondine ne doit ni planter ni bloquer.

---

## A. Vers le téléphone (onglet Étagère)

### A1. Le panneau
1. Cliquez 📱 sur un fichier de l'étagère.
2. **Attendu** : la liste est remplacée par un panneau : QR code noir sur blanc
   à gauche ; à droite « 📱 Vers le téléphone », le nom et la taille
   (« 2,4 Mo »), « Scannez le QR code avec l'appareil photo du téléphone. »,
   l'adresse en texte (`http://192.168.x.x:port/<32 caractères>/nom`), le
   rappel « même Wi-Fi / pare-feu », un bouton « ⏹ Arrêter » et « Expire dans
   4:59 » qui descend chaque seconde.
3. Vérifiez que l'adresse commence bien par **l'IP Wi-Fi du PC** (comparez avec
   `ipconfig`), pas par celle d'un VPN, de WSL (vEthernet) ou de VirtualBox.
   Si vous avez un VPN ou Hyper-V/WSL, testez avec et sans.
4. Le bouton 📱 n'apparaît **pas** sur un dossier de l'étagère, ni sur un
   élément « introuvable ».

### A2. Le téléchargement — Android (Chrome)
1. Ouvrez l'appareil photo du téléphone, visez le QR code, touchez le lien.
2. **Attendu** : le navigateur télécharge le fichier (pas d'affichage dans la
   page), avec son **vrai nom** (accents compris : essayez « Relevé été.pdf »).
3. Pendant l'envoi d'un gros fichier, le panneau dit « Le téléphone
   télécharge… ».
4. À la fin : notification « Le téléphone a reçu le fichier » (avec le nom),
   le panneau se ferme et la liste revient.
5. **Important** : ouvrez le fichier sur le téléphone, vérifiez qu'il est
   complet (une photo s'affiche en entier, un PDF s'ouvre).
6. Retouchez le même lien sur le téléphone : il ne doit plus rien charger
   (serveur fermé).

### A3. Le téléchargement — iPhone (Safari)
Mêmes étapes que A2. Safari demande souvent « Télécharger ? » : acceptez.
Le fichier va dans l'app Fichiers → Téléchargements. Dites-moi si la
notification « reçu » arrive bien **une seule fois** et au bon moment.

### A4. Si possible : Firefox ou Samsung Internet sur Android
Un navigateur qui télécharge en **deux fois** (une demande pour voir, une pour
télécharger) pourrait tomber sur un serveur déjà fermé. Si le fichier n'arrive
pas mais que l'île dit « reçu », notez quel navigateur : c'est à corriger.

### A5. Gros fichier
Envoyez une vidéo de plus de 500 Mo. **Attendu** : ça marche, la mémoire
d'Ondine ne monte pas (Gestionnaire des tâches), et si l'envoi dure plus de
5 minutes, il va quand même au bout (le compte à rebours reste à 0:00 avec
« Le téléphone télécharge… »).

### A6. Arrêter, expirer, remplacer
1. Ouvrez un partage, cliquez « ⏹ Arrêter » : la liste revient tout de suite ;
   le lien sur le téléphone ne charge plus.
2. Ouvrez un partage et attendez 5 minutes sans scanner : notification « Lien
   vers le téléphone expiré », le panneau se ferme.
3. Un seul partage à la fois : pendant un partage, le panneau remplace la
   liste (pas d'autre 📱 à cliquer). Refermez puis rouvrez l'île, changez
   d'onglet et revenez : le même panneau est là, le compte à rebours a continué.
4. Pendant un partage, désactivez le module Étagère (Réglages → Modules) : le
   lien doit cesser de marcher en 1 à 2 s.

### A7. Sécurité (avec le navigateur d'un autre PC ou du téléphone)
1. Pendant un partage, ouvrez `http://IP:port/` (sans le reste) : page vide,
   erreur 404, rien d'autre.
2. Changez une lettre du long code dans l'adresse : 404.
3. Après le téléchargement : plus rien ne répond sur ce port.

### A8. Pas de réseau local
Désactivez le Wi-Fi (et débranchez le câble), cliquez 📱.
**Attendu** : notification « Envoi vers le téléphone impossible » avec « aucun
réseau local trouvé : connectez le PC au Wi-Fi… ». Pas de panneau.
(Même chose en partage de connexion d'un téléphone ? Dites-moi : c'est
souvent du 192.168.x.x, ça devrait marcher.)

### A9. Réglages et textes
- Réglages → Modules → Étagère : la permission **« Réseau »** apparaît
  maintenant, et la description parle de « Vers le téléphone ».
- Langue anglaise : « To the phone », « Scan the QR code… », « Expires in »,
  la taille « 2.4 MB ».
- « S'adresser à moi » = tutoiement : « Scanne le QR code… », « …accepte,
  sinon le téléphone ne trouvera pas le PC. »
- Icônes « Épurées » : 📱 doit être une icône au trait (un téléphone), pas un
  emoji.
- Mode démo : 📱 montre un faux panneau (adresse inventée), rien ne s'ouvre.

---

## B. Réveiller (Wake-on-LAN, onglet Accès distants)

### B1. Ajouter l'adresse MAC
1. Sur la machine à réveiller, allumée : relevez sa MAC (`ipconfig /all` sur
   Windows, ou `arp -a` depuis votre PC après un ping vers elle).
2. Onglet Accès distants → ✎ sur son favori (ou ＋ Ajouter). Nouveau champ
   **« Adresse MAC (réveil) »**.
3. Essayez `aa-bb-cc-dd-ee-ff` (avec la vraie) : enregistrez, rouvrez ✎ → elle
   est affichée `AA:BB:CC:DD:EE:FF`. Essayez aussi sans séparateurs.
4. Essayez une MAC fausse (`AA:BB:CC`) : message « adresse MAC invalide : 12
   chiffres hexadécimaux… », rien n'est enregistré.
5. Vos anciens favoris (sans MAC) sont toujours là, sans changement. Ouvrez
   `%APPDATA%\Ondine\remote.json` : seuls les favoris avec une MAC ont une
   ligne `"mac"`.

### B2. Réveiller depuis l'onglet
1. Mettez la machine en veille ou éteignez-la (Wake-on-LAN activé dans son
   BIOS / sa carte réseau).
2. Survolez son favori : bouton **⏰** (« Réveiller (Wake-on-LAN) »).
   Seulement sur les favoris qui ont une MAC.
3. Cliquez ⏰. **Attendu** : notification « Réveil de NAS… », le ⏰ reste
   visible et « respire », le point d'état respire aussi.
4. Quand la machine répond (port RDP 3389 / SSH 22, ou celui du favori) :
   notification « NAS est réveillé » + « Il répond après 35 s. », point vert.
5. Si elle ne se réveille pas : après 2 minutes, « NAS ne répond toujours
   pas » + « Vérifiez que le Wake-on-LAN est activé… », point rouge.
6. Sur une machine déjà allumée : « NAS est réveillé » + « Il répondait déjà. »
   presque tout de suite.
7. Avec Wireshark (si vous l'avez) : filtre `udp.port == 9` → des paquets de
   102 octets vers 255.255.255.255 et vers l'adresse de diffusion de chaque
   carte (ex. 192.168.1.255), envoyés 3 fois.

### B3. Réveiller depuis le lanceur
1. Alt+Espace, tapez « réveiller » ou le nom du favori.
2. **Attendu** : « Réveiller NAS » (icône ⏰, détail « Wake-on-LAN ») pour les
   favoris avec MAC seulement ; Entrée → l'île se ferme, puis les mêmes
   notifications qu'en B2.
3. Après avoir ajouté/retiré une MAC dans l'onglet, le lanceur suit (le
   résultat apparaît/disparaît).

### B4. Cas particuliers
- Plusieurs cartes réseau (câble + Wi-Fi, ou VPN) : le réveil doit marcher
  quand la machine est sur l'un des deux réseaux.
- Deux clics sur ⏰ : un seul « est réveillé » à la fin.
- Textes en anglais : « Waking NAS… », « NAS is awake », « Responding after
  35 s. », « Wake up NAS » dans le lanceur. En tutoiement : « Vérifie que le
  Wake-on-LAN est activé… ».
- Icônes « Épurées » : ⏰ doit être un réveil au trait.
- Mode démo : le favori « Poste de l'accueil » a un ⏰ ; cliquez → « Réveil
  de… » puis « … est réveillé » au bout de 4 s, sans rien envoyer.
- Journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) : « paquet de réveil
  envoyé (N envois) », jamais l'adresse ni la MAC ; pour le téléphone, « serveur
  ouvert sur le réseau local », jamais l'adresse ni le code secret.

---

# Partie 5 : Agents IA et Agenda : bilan de fin de tâche, Reprendre, rejoindre la réunion
Trois nouveautés : le bilan de fin de tâche (Agents IA), « Reprendre » la
dernière session (Agents IA), « Rejoindre » une réunion (Agenda). Rien de tout
cela n'a pu être lancé sous Windows : seuls les tests Linux et les deux
`cargo clippy` (Linux et Windows) sont passés. Les points marqués
**INCERTAIN** sont ceux à regarder de près.

Préparation : Ondine compilé depuis la branche, Claude Code installé et
branché (onglet Agents IA → Brancher → Installer automatiquement), Git pour
Windows installé, au moins un projet dans Réglages → Agents IA → « Projets pour
les agents » (de préférence un dépôt git).

---

## 1. Bilan de fin de tâche

### 1.1 Le bilan apparaît
1. Dans un projet qui est un dépôt git, modifiez un fichier suivi (ajoutez
   quelques lignes), et créez un nouveau fichier texte de 5 lignes.
2. Lancez Claude Code dans ce projet et demandez-lui une petite tâche
   (« ajoute un commentaire en haut de README.md »), attendez qu'il finisse.
3. Vous devez voir une **alerte** (île ouverte en grand) :
   - titre : « Claude a fini · 3 fichiers modifiés, +N −M » (les chiffres
     correspondent à `git diff --numstat HEAD` + les lignes du nouveau fichier) ;
   - dessous : les noms des fichiers les plus changés (3 au plus, « … » s'il y
     en a d'autres) puis « · Projet <nom> » ;
   - les boutons « ↗ Y aller », « Ouvrir dans VS Code » (si VS Code est
     installé), « Terminal ici » (si le module Terminal est activé).
4. L'alerte disparaît seule après 15 s environ.
5. Dans l'onglet Agents IA, « Derniers messages » : la ligne « a fini » porte
   aussi « · 3 fichiers modifiés, +N −M ».

### 1.2 Les boutons
1. « Ouvrir dans VS Code » : VS Code s'ouvre **sur le dossier du projet**,
   devant l'île, **sans fenêtre noire** qui clignote. **INCERTAIN** : VS Code
   installé « pour l'utilisateur » (`%LOCALAPPDATA%\Programs\Microsoft VS
   Code\Code.exe`) et « pour tous » (`C:\Program Files\Microsoft VS Code`) :
   testez celui que vous avez ; si possible un dossier avec espaces et accents
   (« D:\Mes projets\Île »).
2. « Terminal ici » : l'onglet Terminal s'ouvre, dans le dossier du projet.
3. « ↗ Y aller » : comme avant, la fenêtre de Claude Code passe devant.

### 1.3 Sans bilan : comme avant
1. Dossier qui n'est **pas** un dépôt git → notification « a fini » habituelle
   (pilule compacte, « ↗ Y aller »), sans chiffres.
2. Dépôt git **sans aucun changement** → notification habituelle.
3. Réglages → Agents IA → décochez « Montrer ce qui a changé quand un agent a
   fini » → notification habituelle même avec des changements.
4. (Si possible) Renommez temporairement le dossier de Git ou testez sur un PC
   sans Git → notification habituelle, aucune erreur affichée.
5. Un projet lancé directement dans votre dossier utilisateur
   (`C:\Users\vous`) → pas de bilan (volontaire : jamais git sur tout le
   dossier utilisateur).

### 1.4 Essayer
1. Onglet Agents IA → Brancher → « Essayer » : la fausse fin de tâche se passe
   maintenant dans le **premier projet** du réglage. Si c'est un dépôt git avec
   des changements, le bilan s'affiche ; sinon la notification habituelle.

### 1.5 Rapidité et discrétion
1. Dans un très gros dépôt (beaucoup de fichiers), la notification arrive au
   plus 3 s après la fin de Claude, et l'île reste fluide pendant ce temps.
2. Aucune fenêtre de console ne s'ouvre quand git est lancé.
3. Le journal d'Ondine ne contient aucun nom de fichier du projet.
4. **INCERTAIN** : Codex. Le bilan ne marche que si Codex envoie son dossier
   (`cwd`) dans le hook « Stop ». Faites une petite tâche avec Codex dans un
   dépôt et dites-moi si le bilan apparaît.

## 2. Reprendre la dernière session

### 2.1 Le bouton et la dernière phrase
1. Ouvrez l'onglet Agents IA. Sous la ligne « ▶ Claude Code … Autre
   dossier… », chaque projet a sa ligne : « 📁 nom », puis « ↻ Reprendre »
   **si Claude Code a déjà été utilisé dans ce projet**.
2. À côté, en petit : « Vous : … » ou « Claude : … » (la dernière phrase
   échangée, sur une ligne, coupée vers 120 caractères avec « … »), puis
   « · il y a 2 h » (ou « à l'instant », « il y a 5 min », « il y a 3 j »).
3. Vérifiez que la phrase est bien la dernière de la session (pas un résultat
   d'outil, pas une commande comme `/clear`).
4. **INCERTAIN** : un projet au chemin long ou avec accents
   (« D:\Mes projets\Île-v1.2 ») : la phrase doit aussi apparaître. Claude Code
   range ses sessions dans `%USERPROFILE%\.claude\projects\D--Mes-projets--le-v1-2`
   (chaque caractère spécial devient « - ») ; si le bouton manque, envoyez-moi
   le nom du dossier que vous voyez là.

### 2.2 Le lancement
1. Cliquez « ↻ Reprendre » : une console (ou Windows Terminal selon le
   réglage « Ouvrir les agents dans ») s'ouvre dans le projet avec
   `claude --continue` ; la conversation précédente est reprise.
2. Recommencez avec « Ouvrir les agents dans : Windows Terminal ».
   **INCERTAIN** : que Windows Terminal transmette bien `--continue`.
3. Choisissez la puce « Codex » : « ↻ Reprendre » est proposé sur chaque
   projet (sans phrase) et ouvre `codex resume --last`. Si Codex n'a aucune
   session, il le dit lui-même dans la console.
4. Puce « Gemini CLI » : pas de bouton « Reprendre ».
5. « 📁 nom » ouvre toujours une **nouvelle** session, comme avant.

### 2.3 Confidentialité
1. Réglages → Agents IA → décochez « Afficher la dernière phrase de la session
   à côté de « Reprendre » » → le bouton reste, la phrase et la date
   disparaissent (attendre 30 s ou rouvrir l'onglet).
2. Le journal ne contient jamais la phrase (seulement « ouvre claude (reprise)
   dans … »).
3. En anglais (Réglages → Langue) : « ↻ Resume », « You: »/« Claude: », « 2 h
   ago » ; la phrase elle-même n'est pas traduite. En « tu » : « Toi : ».

## 3. Rejoindre la réunion

Préparation : un calendrier dans l'Agenda avec un rendez-vous **Teams** (ou
Meet / Zoom / Webex) qui commence dans 5 minutes, et un autre rendez-vous avec
un simple lien web ou sans lien à la même heure. Lancez une musique (Spotify,
YouTube dans le navigateur…).

### 3.1 L'alerte
1. 2 minutes avant la réunion (à 15 s près), une **alerte** apparaît :
   « Réunion dans 2 min : <titre> », 🎥, avec l'heure et le lieu, et le bouton
   « Rejoindre ».
2. Elle reste affichée jusqu'au début de la réunion environ (5 min au plus).
3. Une seule alerte par réunion, même si l'île est rouverte ou les calendriers
   relus. Le rendez-vous au simple lien web n'a **pas** d'alerte « Rejoindre »
   (seulement le rappel habituel).
4. Le rappel « Dans 10 min : … » arrive toujours 10 min avant, comme avant.
   Avec « Rappel avant un rendez-vous » à 2 min, vous ne devez voir **qu'une**
   alerte (celle de « Rejoindre »).

### 3.2 Rejoindre
1. Cliquez « Rejoindre » : le lien s'ouvre (Teams / navigateur) **et la
   musique se met en pause**. **INCERTAIN** : la pause par Windows (SMTC) avec
   votre lecteur ; si rien ne se met en pause, dites-moi lequel.
2. Musique déjà en pause → elle ne repart pas.
3. Coupez le micro avec le raccourci (Ctrl+Alt+M par défaut) avant de cliquer
   « Rejoindre » : une deuxième alerte « Votre micro est coupé » (🔇) apparaît,
   avec « Rétablir le micro ». Cliquez-le : le micro est rétabli, la
   confirmation « Micro rétabli » s'affiche, le badge d'Ondine disparaît.
4. Micro non coupé → pas de deuxième alerte.
5. Micro coupé ailleurs (paramètres Windows, bouton du casque reconnu par
   Windows) : l'alerte micro apparaît aussi (l'état est lu au moment du clic).
6. Module Contrôles désactivé : pas d'alerte micro (personne pour le
   rétablir), le reste marche.

### 3.3 Réglage
1. Réglages → Agenda → « Proposer de rejoindre la réunion (minutes avant,
   0 = jamais) » : 2 par défaut. Mettez 5 → l'alerte arrive 5 min avant.
   Mettez 0 → plus jamais d'alerte « Rejoindre » (le rappel habituel reste).
2. Le bouton « Rejoindre » du rappel « Dans 10 min » fait maintenant la même
   chose (ouvre, met la musique en pause, prévient pour le micro).

## 4. Apparence
1. Style d'icônes « Épurées » : 🎥 et 🔇 ont bien leur icône au trait.
2. « Réduire les animations » activé : rien de nouveau n'anime.
3. Thème clair et sombre : la ligne « Vous : … · il y a 2 h » reste lisible,
   et une phrase très longue ne déborde pas de l'onglet (coupée avec « … »).

---

# Partie 6 : Bilan de la semaine, Quoi de neuf, astuces, winget
Bilan de la semaine, « Quoi de neuf » après une mise à jour, astuces à la
première ouverture d'un onglet, et manifestes winget (rien de soumis).

Avant de commencer : lancez Ondine depuis la branche (`npm run tauri dev`),
langue en français, vouvoiement, **mode démo éteint** (Réglages → Général →
Captures d'écran). Pour modifier un fichier de `%APPDATA%\Ondine`, **quittez
d'abord Ondine** (icône près de l'horloge → Quitter), sinon il le réécrit.

---

## 1. Quoi de neuf dans Ondine

### 1.1 Premier démarrage de cette branche (déjà installée avant)

1. Lancez Ondine. Au bout de quelques secondes, l'île s'ouvre en alerte :
   **« Quoi de neuf dans Ondine 1.0.1 »**, icône ✨, avec trois lignes
   commençant par « • » :
   - Au premier lancement : la mascotte Gomme et la mini-île toujours affichée.
   - « Y aller » ramène bien la fenêtre de Windows Terminal dans la version installée.
   - Plus besoin du « Visual C++ Redistributable » sur un PC neuf.
2. L'alerte est plus haute que d'habitude : les trois lignes se lisent en
   entier, rien n'est coupé, les boutons **Tout voir** et **OK** sont visibles.
3. Cliquez **Tout voir** : le navigateur ouvre
   `https://github.com/Naod6473/Ondine/releases/tag/v1.0.1`.
4. Quittez et relancez Ondine : **plus rien** (une seule fois par version).

(C'est normal de la voir ici : la version reste 1.0.1, mais le réglage qui
retient la version vue est nouveau, donc Ondine considère que vous venez de
mettre à jour.)

### 1.2 Simuler une mise à jour

1. Quittez Ondine. Ouvrez `%APPDATA%\Ondine\settings.json` dans le Bloc-notes,
   trouvez `"lastSeenVersion": "1.0.1"` et remplacez par `"1.0.0"`. Enregistrez.
2. Relancez Ondine : « Quoi de neuf dans Ondine 1.0.1 » revient, une fois.
3. **OK** la ferme.

### 1.3 Premier lancement (pas de « Quoi de neuf »)

1. Quittez Ondine. Dans `settings.json`, mettez `"lastSeenVersion": ""` et
   `"welcomed": false`. Enregistrez, relancez.
2. Vous voyez le **mot de bienvenue** habituel, et **pas** « Quoi de neuf ».
3. Relancez encore : ni l'un ni l'autre.

### 1.4 Bouton des réglages, anglais, mode démo

1. Réglages → Général → À propos → ligne **Nouveautés** → **Voir les
   nouveautés** : la même notification s'affiche dans l'île.
2. Passez en anglais (Réglages → Général → Langue → English) et recliquez
   **See what's new** : titre « What's new in Ondine 1.0.1 », lignes en
   anglais (« On first launch: the Gomme mascot… »), boutons **See all** / OK.
3. Revenez en français. Allumez le mode démo, quittez, mettez
   `"lastSeenVersion": "1.0.0"`, relancez : **pas** de « Quoi de neuf » au
   démarrage. Éteignez le mode démo et relancez : elle arrive.

---

## 2. Astuces à la première ouverture d'un onglet

1. Réglages → Onglets → tout en bas, groupe **Astuces** : cliquez **Revoir les
   astuces**. Le texte « Les astuces reviendront à la prochaine ouverture de
   chaque onglet. » s'affiche à côté.
2. Ouvrez l'île sur l'onglet **Étagère** : en bas à gauche, une petite bulle
   (icône goutte, petite pointe vers la mascotte) dit « Glissez un fichier sur
   l'île pour le poser ici. » avec un bouton **OK**. Elle arrive en glissant
   doucement.
3. Cliquez **OK** : la bulle disparaît. Refermez et rouvrez l'île sur
   l'Étagère : plus de bulle.
4. Ouvrez l'onglet **Presse-papiers** et restez-y plus de 3 secondes sans
   cliquer OK, puis passez à un autre onglet : la bulle du Presse-papiers ne
   reviendra plus (lue). Passez en revanche **très vite** (moins de 3 s) sur
   un onglet jamais vu : sa bulle reviendra la fois suivante.
5. Faites le tour : chaque onglet a sa phrase, une seule, au « vous »
   (Capture, Minuteur, Notes, Agenda, Terminal, Système, Accès distants,
   Réseau, Agents IA, Demander à Claude, Lanceur, Règles, Musique, Contrôles).
   Vérifiez qu'elle ne cache rien d'important (sinon, notez lequel).
6. **Jamais par-dessus une alerte** : Revoir les astuces, ouvrez l'onglet
   Minuteur (la bulle s'affiche), lancez « 1 min » et laissez l'île ouverte.
   À la fin, l'alerte « Minuteur terminé » prend l'île : pas de bulle
   dessus. L'alerte fermée, l'île rouverte sur le Minuteur, la bulle peut
   revenir si elle n'avait pas été lue.
7. Coupez **Astuces à la première ouverture d'un onglet**, puis Revoir les
   astuces : aucune bulle nulle part. Rallumez : elles reviennent.
8. **Mode démo** allumé : aucune bulle. Éteignez-le.
9. **Anglais** : la bulle de l'Étagère dit « Drag a file onto the island to
   put it here. ». **Tutoiement** (Réglages → Général → S'adresser à moi →
   Tutoiement) : « Glisse un fichier sur l'île pour le poser ici. »
10. **Réduire les animations** (Paramètres de Windows → Accessibilité → Effets
    visuels → Effets d'animation : désactivé) : la bulle apparaît d'un coup,
    sans glisser.
11. Apparence → Style des icônes → **Épurées** : l'icône de la bulle est une
    goutte au trait.

---

## 3. Bilan de la semaine

Le module est dans Réglages → Onglets → **Sans onglet** (activé par défaut),
et a sa page : Réglages → Modules → **Bilan de la semaine** (icône 🎉).

### 3.1 Les réglages

1. Page du module : **Jour du bilan** (Vendredi) et **Heure du bilan**
   (17:00, par demi-heure), et le groupe **Aperçu** avec **Voir le bilan
   maintenant**.
2. Cliquez **Voir le bilan maintenant** sans avoir rien fait : notification
   « Votre semaine jusqu'ici » : « Rien de compté pour l'instant : lancez un
   Pomodoro ou cochez une tâche dans Notes. »

### 3.2 Ce qui est compté

1. Réglages du Minuteur : **Pomodoro : travail** = 1 minute.
2. Onglet Minuteur → Pomodoro → **Démarrer** ; attendez la fin de la séance
   (« Séance terminée : pause ! »).
3. Relancez une séance de travail (Passer jusqu'à « Travail », Démarrer),
   attendez ~30 s puis **Pause** ; puis **Passer**.
4. Onglet Notes : ajoutez trois tâches, cochez-en deux, décochez-en une.
5. **Voir le bilan maintenant** : « 1 Pomodoro terminé · 2 min de
   concentration · 1 tâche cochée » (la concentration peut être 1 ou 2 min
   selon vos temps ; la séance « passée » compte son temps mais pas comme
   Pomodoro).
6. Ouvrez `%APPDATA%\Ondine\weekly.json` : seulement des nombres et des dates
   (`until`, `pomodoros`, `focusSecs`, `todos`), **aucun texte de tâche**.

### 3.3 Le vrai bilan, à l'heure dite

1. Réglez **Jour du bilan** = aujourd'hui et **Heure du bilan** = la
   prochaine demi-heure (ex. il est 14 h 10 → 14:30).
2. Au plus une minute après l'heure : la mascotte fait la fête (confettis) et
   une notification 🎉 **« Le bilan de votre semaine »** : « 1 Pomodoro
   terminé · 2 min de concentration · 1 tâche cochée ». Elle reste ~15 s.
3. Elle ne revient pas les minutes suivantes, ni au redémarrage.
4. **Voir le bilan maintenant** juste après : « Rien de compté pour
   l'instant… » (une nouvelle semaine a commencé).

### 3.4 PC éteint à l'heure dite

1. Quittez Ondine. Dans `weekly.json`, mettez dans `current.until` une date
   d'**hier** à la même heure (ex. `"2026-10-08T14:30"`) et vérifiez que
   `current.tally` contient quelque chose (ex. `"todos": 3`). Si
   `lastShown` a moins de 6 jours, mettez `"lastShown": ""`.
2. Relancez Ondine : environ **20 secondes** après le démarrage, le bilan
   arrive (« 3 tâches cochées »).
3. Recommencez avec une date d'il y a **3 jours** : **pas** de bilan (trop
   tard), et `current.until` repart sur le prochain jour réglé.

### 3.5 Rien de spécial

1. Semaine vide (rien fait) : à l'heure dite, **aucune** notification.
2. **Mode démo** allumé : terminer un Pomodoro ou cocher une tâche ne change
   pas `weekly.json` ; **Voir le bilan maintenant** montre une fausse semaine
   (« 9 Pomodoros terminés · 3 h 35 de concentration · 14 tâches cochées »).
3. Module **désactivé** (Réglages → Onglets → Sans onglet) : rien n'est compté,
   pas de bilan ; « Voir le bilan maintenant » répond « Activez d'abord le
   module. »
4. **Anglais** : « Your week in review » : « 1 Pomodoro completed · 2 min of
   focus · 1 task checked off ».
5. Mode concentration du Pomodoro allumé : si le bilan tombe pendant une
   séance de travail, il attend la pause (comme les autres notifications).

---

## 4. winget (rien à soumettre)

Facultatif, de préférence dans le **Bac à sable Windows** :

1. `winget validate --manifest packaging\winget\manifests\n\Naod6473\Ondine\1.0.1`
   → « Validation du manifeste réussie » (des avertissements éventuels sont à
   noter).
2. En administrateur, une fois : `winget settings --enable LocalManifestFiles`.
3. `winget install --manifest packaging\winget\manifests\n\Naod6473\Ondine\1.0.1`
   → téléchargement, vérification de l'empreinte, installation **sans
   question** ; Ondine démarre.
4. `regedit` → `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Ondine` :
   notez `Publisher` (sans doute « github ») et `DisplayVersion` (1.0.1).
5. `winget uninstall Naod6473.Ondine` (ou par « Applications installées ») :
   Ondine disparaît proprement.
6. README.md / README.en.md, section Installer : la ligne « Bientôt :
   `winget install Naod6473.Ondine` — pas encore disponible » est bien là.

Ne lancez **pas** `wingetcreate submit` : la soumission se fera quand vous
le déciderez (voir packaging/winget/README.md).

