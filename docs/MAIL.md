# Module Mail : connecter sa messagerie

Le module ✉️ Mail (prototype) montre vos derniers mails dans l'île. Ondine vous
prévient quand un mail arrive. Elle peut résumer un mail ou proposer une réponse
avec l'IA de « Parler à Ondine ». Vous pouvez aussi envoyer un mail, avec une
pièce jointe.

Google et Microsoft n'acceptent plus qu'une appli se connecte avec l'adresse et
le mot de passe du compte. Il y a donc trois façons de se connecter, à choisir
dans **Réglages → Modules → Organisation → Mail → Messagerie** :

| Choix | Pour qui | À préparer |
|---|---|---|
| **Gmail (mot de passe d'application)** | Un compte Gmail, le plus simple | Un mot de passe d'application (2 minutes) |
| **Gmail (client Google Cloud)** | Gmail sans mot de passe d'application | Un projet Google Cloud (15 minutes) |
| **Outlook / Office 365** | Outlook.com, Hotmail, Live, Office 365 | Une inscription d'application Microsoft (10 minutes) |

Les champs des méthodes 2 et 3 (identifiants clients) n'apparaissent qu'en
mode **Complet** de la fenêtre de réglages (interrupteur dans la barre latérale).

Ce que vous saisissez reste sur votre PC. Les mots de passe, codes secrets et
jetons vont dans le Gestionnaire d'identifiants Windows, jamais dans
`settings.json`. Ondine demande seulement à lire et à envoyer des mails :
jamais à les supprimer ou à les modifier.

---

## 1. Gmail avec un mot de passe d'application (recommandé)

Un mot de passe d'application est un code de 16 lettres que Google crée pour
une seule appli. Ce n'est pas le mot de passe de votre compte. Vous pouvez le
révoquer à tout moment.

1. Activez la **validation en deux étapes** de votre compte Google, si ce n'est
   pas déjà fait :
   <https://myaccount.google.com/signinoptions/twosv>
2. Ouvrez la page des **mots de passe d'application** :
   <https://myaccount.google.com/apppasswords>
3. Donnez un nom (par exemple « Ondine »), puis cliquez sur **Créer**. Google
   affiche 16 lettres, par exemple `abcd efgh ijkl mnop`. Copiez-les : elles ne
   seront plus montrées.
4. Dans Ondine, ouvrez **Réglages → Mail** :
   - Messagerie : **Gmail (mot de passe d'application)** ;
   - Adresse Gmail : votre adresse ;
   - Mot de passe d'application Gmail : collez les 16 lettres (les espaces ne
     gênent pas).
5. Ouvrez l'onglet ✉️ Mail de l'île : vos derniers mails s'affichent.

Ondine lit les mails par IMAP (`imap.gmail.com`) et les envoie par SMTP
(`smtp.gmail.com`), deux connexions chiffrées. Gmail range les mails envoyés
dans « Messages envoyés ».

**Si Gmail refuse :**
- vérifiez l'adresse et les 16 lettres ;
- un compte Google Workspace (professionnel) peut avoir les mots de passe
  d'application désactivés par son administrateur : passez alors par la
  méthode 2 ;
- **révoquer** : <https://myaccount.google.com/apppasswords>, puis la
  corbeille à côté de « Ondine ». Le bouton ⏏ de l'onglet Mail efface aussi le
  mot de passe enregistré sur le PC.

---

## 2. Gmail avec un client Google Cloud (OAuth)

Avec cette méthode, la connexion se fait sur la page de Google, sans mot de
passe d'application. Il faut créer une fois un « client OAuth » dans Google
Cloud. C'est gratuit.

1. Créez un projet : <https://console.cloud.google.com/projectcreate> (nom :
   « Ondine »).
2. Activez l'**API Gmail** pour ce projet :
   <https://console.cloud.google.com/apis/library/gmail.googleapis.com> →
   **Activer**.
3. Configurez l'écran de consentement (Google Auth Platform) :
   <https://console.cloud.google.com/auth/overview> → **Commencer**.
   - Nom de l'application : « Ondine », votre adresse comme adresse
     d'assistance ;
   - Audience : **Externe** ;
   - Coordonnées : votre adresse.
4. Ajoutez-vous comme **utilisateur test** :
   <https://console.cloud.google.com/auth/audience> → « Utilisateurs tests » →
   **Ajouter des utilisateurs** → votre adresse Gmail.
5. Ajoutez les **autorisations** (« Accès aux données ») :
   <https://console.cloud.google.com/auth/scopes> → **Ajouter ou supprimer des
   champs d'application**, puis cochez ou collez :
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
6. Créez le **client** : <https://console.cloud.google.com/auth/clients> →
   **Créer un client** → type **Application de bureau** → nom « Ondine » →
   **Créer**. Google affiche un **ID client** (qui se termine par
   `.apps.googleusercontent.com`) et un **code secret du client**.
7. Dans Ondine, ouvrez **Réglages → Mail** :
   - Messagerie : **Gmail (client Google Cloud)** ;
   - Identifiant client Google : l'ID client ;
   - Code secret du client Google : le code secret.
8. Dans l'onglet ✉️ Mail, cliquez sur **Se connecter**. La page de Google
   s'ouvre dans le navigateur. Google prévient que l'appli n'est pas validée :
   c'est normal en mode Test. Cliquez sur **Continuer**, puis acceptez.

**Limites tant que l'appli reste en mode Test :**
- seuls les utilisateurs tests (100 au plus) peuvent se connecter ;
- Google demande de se reconnecter environ tous les 7 jours.

Pour ouvrir l'appli à tout le monde, il faut la faire **valider par Google**.
Lire les mails est une autorisation « restreinte » : la validation demande un
audit de sécurité, long et payant. Pour une diffusion large, la méthode 1 est
plus réaliste.

**Révoquer :** <https://myaccount.google.com/connections>, puis « Ondine » →
supprimer l'accès. Ou le bouton ⏏ de l'onglet Mail.

---

## 3. Outlook, Hotmail et Office 365 (Microsoft)

Il faut une « inscription d'application » chez Microsoft. Elle est gratuite et
ne demande aucun code secret. Un compte Microsoft suffit. Si le portail
demande un annuaire ou un abonnement, le compte Azure gratuit en crée un :
<https://azure.microsoft.com/free>.

1. Ouvrez les **inscriptions d'applications** :
   <https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade>
   (ou, dans le portail Azure :
   <https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade>)
   → **Nouvelle inscription**.
2. Remplissez :
   - Nom : « Ondine » ;
   - Types de comptes pris en charge : **Comptes dans un annuaire
     d'organisation et comptes Microsoft personnels** (Outlook.com, Hotmail et
     Office 365) ;
   - URI de redirection : plateforme **Client public/natif (mobile et
     bureau)**, valeur `http://localhost`.
   Cliquez sur **Inscrire**.
3. Menu **Authentification** : tout en bas, mettez **Autoriser les flux de
   clients publics** sur **Oui**, puis **Enregistrer**. Vérifiez que
   `http://localhost` figure bien dans « Applications mobiles et de bureau ».
4. Menu **Autorisations de l'API** → **Ajouter une autorisation** →
   **Microsoft Graph** → **Autorisations déléguées**. Cochez :
   - `Mail.Read`
   - `Mail.Send`
   - `User.Read` (souvent déjà présente)
   - `offline_access`

   Cliquez sur **Ajouter des autorisations**.
5. Menu **Vue d'ensemble** : copiez l'**ID d'application (client)**, par
   exemple `1b2c3d4e-…`.
6. Dans Ondine, ouvrez **Réglages → Mail** :
   - Messagerie : **Outlook / Office 365** ;
   - Identifiant client Microsoft : collez l'ID.
7. Dans l'onglet ✉️ Mail, cliquez sur **Se connecter**. La page de Microsoft
   s'ouvre : choisissez le compte, puis acceptez.

**Compte professionnel (Office 365 d'une entreprise) :** l'administrateur peut
interdire aux utilisateurs d'autoriser une appli. Microsoft affiche alors
« Approbation de l'administrateur requise ». L'administrateur doit cliquer sur
**Accorder un consentement d'administrateur** dans « Autorisations de l'API »,
ou autoriser Ondine dans son annuaire.

**Révoquer :** compte personnel : <https://account.live.com/consent/Manage> ;
compte professionnel : <https://myapps.microsoft.com> ou l'administrateur. Ou
le bouton ⏏ de l'onglet Mail.

---

## Pour tous les utilisateurs d'Ondine, plus tard

Les identifiants clients (Google et Microsoft) ne sont pas des secrets : ils
nomment l'appli. Une fois les inscriptions faites par l'auteur d'Ondine, ses
identifiants pourront être intégrés dans l'appli. Chaque utilisateur n'aura
alors plus qu'à cliquer sur **Se connecter**. Pour Gmail en OAuth, cela
suppose la validation de Google, voir la méthode 2.
