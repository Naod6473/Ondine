# Ondine Portal

Une petite Ondine pour un **Meta Portal** (testé pour le Portal Mini, Android 10),
installée avec [OpenPortal](https://openportal.cc/). Elle ne fait qu'une chose :
on lui parle, elle répond avec Claude, à voix haute et par écrit.

> Branche `ondine-portal`, **à ne jamais fusionner dans `main`**. L'appli
> Windows n'est pas touchée : tout est dans `portal/` et dans
> `.github/workflows/portal-apk.yml`.

## Ce qu'elle fait

- **Deux façons de l'appeler** (au choix dans la page de réglages) :
  - *Toucher Ondine* (par défaut) : le micro reste fermé ; on touche la goutte, elle écoute une phrase ;
  - *Micro permanent* : elle attend « Dis Ondine » (ou « Hey / OK Ondine »), comme sur le PC.
    Après sa réponse, on a 6 secondes pour enchaîner sans redire « Dis Ondine ».
- **La voix est reconnue sur le Portal** (sherpa-onnx, modèle français en continu) :
  seul le texte de la question part chez Claude, jamais le son.
- **Réponse de Claude** avec la personnalité d'Ondine (courte, faite pour l'oral),
  la mémoire des 10 derniers échanges (oubliée après 10 minutes de silence),
  et l'humeur jouée par la goutte (le même moteur que le site).
- **Réponse à voix haute** avec le moteur de synthèse vocale d'Android ; sans moteur,
  elle s'affiche seulement. Touchez Ondine pendant qu'elle parle pour la faire taire.
- **Page de réglages** sur le réseau local : touchez la roue sur le Portal, puis
  scannez le QR code avec votre téléphone, ou ouvrez l'adresse affichée sur un PC et
  tapez le code à 6 chiffres. On y règle : la clé Claude, le modèle, le mode du micro,
  la voix (vitesse, hauteur), Vous/Tu, la mascotte et sa couleur, la personnalité,
  et on peut poser une question au Portal depuis le clavier.

## Installer

1. Récupérer l'APK : onglet **Actions** du dépôt → *portal-apk* → dernier passage
   vert → artefact **ondine-portal-apk** (un zip qui contient `app-release.apk`).
2. Sur https://openportal.cc/ (Chrome ou Edge, câble USB de données), glisser
   `app-release.apk` sur la page.
3. Lancer **Ondine** sur le Portal, accepter le micro.
4. Pour la voix : si le Portal n'a pas de voix française, installer un moteur de
   synthèse vocale avec OpenPortal (par exemple **RHVoice** depuis F-Droid, ou
   **sherpa-onnx TTS Engine** avec une voix française), puis le choisir dans les
   paramètres Android du Portal (Synthèse vocale). La page de réglages dit si une voix est prête.
5. Toucher la roue, ouvrir la page de réglages, coller la clé de l'API Claude.

Le bouton de confidentialité du Portal coupe le micro : Ondine n'entend alors plus rien.

## Construire soi-même

```bash
bash portal/scripts/prepare.sh   # AAR sherpa-onnx 1.13.8, modèle français, goutte du site
cd portal && gradle testReleaseUnitTest assembleRelease
```

Il faut Java 17, Gradle 8.14 et le SDK Android (34).

## Les fichiers

| Fichier | Rôle |
| --- | --- |
| `MainActivity.kt` | L'écran, les états (prête, écoute, réfléchit, parle) |
| `Ears.kt` | Le micro et la reconnaissance (toucher ou permanent) |
| `WakeWord.kt` | « Dis Ondine » dans le texte (la même règle que le PC) |
| `Brain.kt` | L'appel à l'API Claude et la personnalité |
| `Mood.kt` | L'humeur en fin de réponse → animation de la goutte |
| `Voice.kt` | La voix (synthèse vocale d'Android) |
| `ConfigServer.kt` | La page de réglages (port 8787, réseau local seulement) |
| `Pairing.kt` | Le jeton, le code à 6 chiffres, le QR code |
| `Settings.kt` | Les réglages ; la clé chiffrée par le Keystore |
| `assets/face/` | L'écran de la goutte |
| `assets/config/` | La page de réglages |

## Sécurité

- La page de réglages n'accepte que les adresses du réseau local, et seulement
  avec le jeton (QR code) ou le code à 6 chiffres (5 essais, puis il change).
  « Déconnecter tous les navigateurs » change le jeton.
- La page est en HTTP simple (pas de certificat possible sur un réseau local) :
  la clé Claude traverse le Wi-Fi en clair, une seule fois, quand on la saisit.
  Elle est ensuite chiffrée sur le Portal et n'est jamais renvoyée.
- Rien n'est enregistré : ni le son, ni les conversations.

## Limites connues

- Pas encore essayé sur un vrai Portal : le micro peut être réservé par le
  système (« Hey Portal »), et l'écoute permanente peut chauffer.
- L'appli doit rester au premier plan (pas de service en arrière-plan).
- Modèle de reconnaissance : `sherpa-onnx-streaming-zipformer-fr-2023-04-14`
  (≈ 70 Mo), plus léger mais moins précis que Parakeet sur le PC.
